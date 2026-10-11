// نشست‌های سمت سرور: توکن تصادفی در کوکی، فقط هشِ آن در دیتابیس (قابل ابطال هنگام خروج)
const crypto = require("crypto"), { db } = require("./db"), cfg = require("./config");
const TTL = 8 * 3600e3, hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const create = (ip, ua) => {
  const token = crypto.randomBytes(32).toString("base64url"), csrf = crypto.randomBytes(16).toString("hex"), now = Date.now();
  db.prepare("INSERT INTO sessions(id,csrf,ip,ua,created,expires) VALUES(?,?,?,?,?,?)").run(hash(token), csrf, ip ?? null, String(ua || "").slice(0, 200), now, now + TTL);
  return { token, csrf };
};
const find = token => token ? db.prepare("SELECT * FROM sessions WHERE id=? AND expires>?").get(hash(token), Date.now()) || null : null;
const destroy = token => db.prepare("DELETE FROM sessions WHERE id=?").run(hash(token));
const purge = () => db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
const flags = `HttpOnly; SameSite=Strict; Path=/${cfg.prod ? "; Secure" : ""}`;
const setCookie = (res, token) => res.setHeader("Set-Cookie", `adm=${token}; ${flags}; Max-Age=${TTL / 1000}`);
const clearCookie = res => res.setHeader("Set-Cookie", `adm=; ${flags}; Max-Age=0`);
module.exports = { create, find, destroy, purge, setCookie, clearCookie, TTL };
