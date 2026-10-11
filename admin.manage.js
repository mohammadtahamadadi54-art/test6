// مدیریت کامل فروشگاه: محصولات، سفارش‌ها، مشتریان، تنظیمات — مستقل از Express و قابل تست
const { db, P, getOrder, setStatus, audit, getSetting, setSetting, getRate } = require("./db"), { HttpError } = require("./http");
const bad = m => new HttpError(400, m), COL = /^#[0-9a-fA-F]{3,8}$/;
const str = (v, max, name, req = true) => { v = String(v ?? "").trim(); if (req && !v) throw bad(name + " الزامی است."); if (v.length > max) throw bad(name + " بیش از حد طولانی است."); return v; };

function cleanProduct(b = {}) {
  const n = str(b.n, 80, "نام بازی"), p = Math.round(Number(b.p) * 100) / 100, s = Number(b.s);
  if (!(p > 0 && p < 10000) || !Number.isInteger(s) || s < 0 || s > 100000) throw bad("قیمت یا موجودی نامعتبر است.");
  const pl = (Array.isArray(b.pl) ? b.pl : []).map(x => str(x, 12, "پلتفرم")).slice(0, 6);
  const r = Number(b.r ?? 0), y = Number(b.y ?? new Date().getFullYear()), sales = Number(b.sales ?? 0);
  if (!(r >= 0 && r <= 5) || !Number.isInteger(y) || y < 1970 || y > 2100 || !Number.isInteger(sales) || sales < 0) throw bad("امتیاز، سال یا تعداد فروش نامعتبر است.");
  const c = (Array.isArray(b.c) ? b.c : []).slice(0, 2);
  if (c.length !== 2 || !c.every(x => COL.test(x))) throw bad("رنگ‌ها نامعتبر است.");
  const img = String(b.img || "").trim();
  if (img && !/^\/?images\/[\w.-]+$/.test(img)) throw bad("مسیر تصویر نامعتبر است.");
  return { n, p, s, hidden: b.hidden ? 1 : 0, meta: { pl, g: str(b.g, 30, "ژانر"), r, y, c, d: str(b.d, 60, "سازنده", false), sales, img: img.replace(/^\//, "") } };
}
const listProducts = () => db.prepare("SELECT id,n,p,s,hidden,meta FROM products ORDER BY id").all().map(({ meta, ...g }) => ({ ...g, ...JSON.parse(meta || "{}") }));
function createProduct(b, by, ip) {
  const c = cleanProduct(b), id = db.prepare("INSERT INTO products(n,p,s,hidden,meta) VALUES(?,?,?,?,?)").run(c.n, c.p, c.s, c.hidden, JSON.stringify(c.meta)).lastInsertRowid;
  audit(by, "product.create", String(id), { name: c.n, p: c.p, s: c.s }, ip); return Number(id);
}
function saveProduct(id, b, by, ip) {
  const old = P(+id); if (!old) throw new HttpError(404, "محصول پیدا نشد");
  const c = cleanProduct(b);
  db.prepare("UPDATE products SET n=?,p=?,s=?,hidden=?,meta=? WHERE id=?").run(c.n, c.p, c.s, c.hidden, JSON.stringify(c.meta), old.id);
  audit(by, "product.update", String(old.id), { name: c.n, from: { p: old.p, s: old.s, hidden: old.hidden }, to: { p: c.p, s: c.s, hidden: c.hidden } }, ip);
}
function deleteProduct(id, by, ip) {
  const old = P(+id); if (!old) throw new HttpError(404, "محصول پیدا نشد");
  db.prepare("DELETE FROM products WHERE id=?").run(old.id); audit(by, "product.delete", String(old.id), { name: old.n }, ip);
}
const deleteOrder = db.transaction((no, by, ip) => {
  const o = getOrder(no); if (!o) throw new HttpError(404, "سفارش پیدا نشد");
  if (o.status === "paid") setStatus(no, "failed");           // موجودی کالاها برمی‌گردد
  db.prepare("DELETE FROM orders WHERE no=?").run(no); audit(by, "order.delete", no, { name: o.name, usd: o.usd, was: o.status }, ip);
});
const customers = () => db.prepare("SELECT MAX(name) name, lower(email) email, MAX(phone) phone, COUNT(*) orders, ROUND(COALESCE(SUM(CASE WHEN status='paid' THEN usd END),0),2) spent, MAX(created) last FROM orders GROUP BY lower(email) ORDER BY spent DESC, last DESC LIMIT 300").all();
const cell = v => { v = String(v ?? ""); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };   // جلوگیری از CSV injection
const ordersCsv = () => "\ufeff" + [["no", "name", "email", "phone", "items", "usd", "irr", "method", "status", "track", "created"]].concat(
  db.prepare("SELECT no,name,email,phone,items,usd,irr,method,status,track,created FROM orders ORDER BY created DESC").all()
    .map(o => [o.no, o.name, o.email, o.phone, JSON.parse(o.items).join(" | "), o.usd, o.irr, o.method, o.status, o.track, new Date(o.created).toISOString()])).map(r => r.map(cell).join(",")).join("\r\n");
const getSettings = () => ({ rate: getRate(), announce: getSetting("announce", ""), maintenance: getSetting("maintenance") === "1" });
function saveSettings(b = {}, by, ip) {
  const rate = Number(b.rate), announce = str(b.announce, 200, "اطلاعیه", false);
  if (!Number.isInteger(rate) || rate < 0 || rate > 1e9) throw bad("نرخ دلار نامعتبر است (عدد صحیح، صفر = غیرفعال).");
  setSetting("rate", rate); setSetting("announce", announce); setSetting("maintenance", b.maintenance ? "1" : "0");
  audit(by, "settings.update", null, { rate, maintenance: !!b.maintenance, announce: announce.slice(0, 60) }, ip);
}
module.exports = { listProducts, createProduct, saveProduct, deleteProduct, deleteOrder, customers, ordersCsv, getSettings, saveSettings };
