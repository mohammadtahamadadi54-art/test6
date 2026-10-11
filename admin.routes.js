const crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path"), express = require("express"), { Router } = express, cfg = require("./config");
const sec = require("./security"), sessions = require("./sessions"), svc = require("./admin.service");
const { ah, HttpError } = require("./http"), { audit, db, getSetting, setSetting } = require("./db"), mg = require("./admin.manage");
const envVerify = sec.makeVerifier(cfg.admin.user, cfg.admin.pass), lock = sec.lockout(), r = Router();
// رمز تغییرداده‌شده از پنل (هش scrypt در دیتابیس) بر رمز .env اولویت دارد
const verify = (u, p) => {
  const st = getSetting("admin_pw"); if (!st) return envVerify(u, p);
  const [salt, h] = st.split(":");
  return sec.safeEqual(u, cfg.admin.user) && crypto.timingSafeEqual(crypto.scryptSync(String(p), Buffer.from(salt, "hex"), 64), Buffer.from(h, "hex"));
};
const who = cfg.admin.user;

r.post("/login", sec.limiter({ windowMs: 15 * 60e3, max: 20 }), ah(async (req, res) => {
  const b = req.body || {}, u = typeof b.username === "string" ? b.username : "", p = typeof b.password === "string" ? b.password : "";
  const key = req.ip + "|" + u.toLowerCase().slice(0, 50);
  if (lock.blocked(key)) throw new HttpError(429, "به‌دلیل تلاش‌های ناموفق، ۱۰ دقیقه ورود قفل است.");
  if (p.length > 200 || !verify(u, p)) {
    lock.fail(key); audit(null, "login.fail", u.slice(0, 50), null, req.ip);
    await new Promise(ok => setTimeout(ok, 500)); // کند کردن حمله‌ٔ حدس رمز
    throw new HttpError(401, "نام کاربری یا رمز عبور اشتباه است.");
  }
  lock.ok(key);
  const s = sessions.create(req.ip, req.get("user-agent")); sessions.setCookie(res, s.token);
  audit(who, "login.ok", null, null, req.ip);
  res.json({ ok: true, csrf: s.csrf });
}));

// همهٔ مسیرهای بعدی: نشست معتبر + برای تغییرها توکن CSRF
r.use((req, res, next) => {
  const token = sec.cookie(req, "adm"), s = sessions.find(token);
  if (!s) return res.status(401).json({ error: "unauthorized" });
  if (!["GET", "HEAD"].includes(req.method)) {
    const c = String(req.get("x-csrf-token") || "");
    if (c.length !== s.csrf.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(s.csrf))) return res.status(403).json({ error: "توکن امنیتی نامعتبر است." });
  }
  req.admin = { token, session: s }; next();
});

r.get("/me", (req, res) => res.json({ ok: true, user: who, csrf: req.admin.session.csrf }));
r.post("/logout", (req, res) => { sessions.destroy(req.admin.token); sessions.clearCookie(res); audit(who, "logout", null, null, req.ip); res.json({ ok: true }); });
r.get("/stats", (_, res) => res.json(svc.stats()));
r.get("/orders", (req, res) => res.json(svc.listOrders(req.query)));
r.patch("/orders/:no", (req, res) => { svc.setOrderStatus(req.params.no, req.body?.status, who, req.ip); res.json({ ok: true }); });
r.get("/products", (_, res) => res.json(mg.listProducts()));
r.post("/products", (req, res) => res.json({ ok: true, id: mg.createProduct(req.body, who, req.ip) }));
r.put("/products/:id", (req, res) => { mg.saveProduct(req.params.id, req.body, who, req.ip); res.json({ ok: true }); });
r.delete("/products/:id", (req, res) => { mg.deleteProduct(req.params.id, who, req.ip); res.json({ ok: true }); });
r.delete("/orders/:no", (req, res) => { mg.deleteOrder(req.params.no, who, req.ip); res.json({ ok: true }); });
r.get("/customers", (_, res) => res.json(mg.customers()));
r.get("/settings", (_, res) => res.json(mg.getSettings()));
r.put("/settings", (req, res) => { mg.saveSettings(req.body, who, req.ip); res.json({ ok: true }); });
r.get("/export/orders.csv", (req, res) => { audit(who, "export.orders", null, null, req.ip); res.type("text/csv; charset=utf-8").attachment("orders.csv").send(mg.ordersCsv()); });
r.get("/backup", ah(async (req, res) => {
  const f = path.join(os.tmpdir(), "gsm-" + crypto.randomBytes(6).toString("hex") + ".db"); await db.backup(f);
  audit(who, "backup.download", null, null, req.ip);
  res.download(f, "gsm-backup-" + new Date().toISOString().slice(0, 10) + ".db", () => fs.unlink(f, () => {}));
}));
// آپلود تصویر بازی (فقط JPG/PNG/WEBP با بررسی امضای فایل، حداکثر ۳ مگابایت)
r.post("/upload", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "3mb" }), (req, res) => {
  const b = req.body; if (!Buffer.isBuffer(b) || b.length < 12) throw new HttpError(400, "فایل تصویر ارسال نشد.");
  const ext = b[0] === 0xff && b[1] === 0xd8 ? "jpg" : b.slice(0, 4).toString("hex") === "89504e47" ? "png" : b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" ? "webp" : null;
  if (!ext) throw new HttpError(400, "فقط تصویر JPG، PNG یا WEBP مجاز است.");
  const name = "up-" + crypto.randomBytes(6).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(__dirname, "..", "public", "images", name), b); audit(who, "image.upload", name, null, req.ip);
  res.json({ ok: true, path: "images/" + name });
});
r.get("/sessions", (req, res) => res.json(db.prepare("SELECT id,ip,ua,created FROM sessions WHERE expires>? ORDER BY created DESC").all(Date.now()).map(s => ({ cur: s.id === req.admin.session.id, ip: s.ip, ua: s.ua, created: s.created }))));
r.delete("/sessions", (req, res) => { const n = db.prepare("DELETE FROM sessions WHERE id<>?").run(req.admin.session.id).changes; audit(who, "sessions.revoke", String(n), null, req.ip); res.json({ ok: true, n }); });
r.post("/password", sec.limiter({ windowMs: 15 * 60e3, max: 10 }), (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== "string" || typeof next !== "string" || current.length > 200) throw new HttpError(400, "ورودی نامعتبر است.");
  if (!verify(cfg.admin.user, current)) throw new HttpError(403, "رمز فعلی اشتباه است.");
  if (next.length < 10 || next.length > 200) throw new HttpError(400, "رمز جدید باید حداقل ۱۰ کاراکتر باشد.");
  const salt = crypto.randomBytes(16); setSetting("admin_pw", salt.toString("hex") + ":" + crypto.scryptSync(next, salt, 64).toString("hex"));
  db.prepare("DELETE FROM sessions WHERE id<>?").run(req.admin.session.id); audit(who, "password.change", null, null, req.ip); res.json({ ok: true });
});
r.get("/audit", (req, res) => res.json(svc.auditLog(req.query.limit)));
module.exports = r;
