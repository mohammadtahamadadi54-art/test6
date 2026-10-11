// منطق کسب‌وکار پنل ادمین — مستقل از Express و قابل تست
const { db, P, getOrder, setStatus, audit } = require("./db"), { HttpError } = require("./http");
const STATUSES = ["pending", "paid", "failed"];

function stats() {
  const t = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='paid' THEN usd END),0) rev, COALESCE(SUM(status='paid'),0) paid, COALESCE(SUM(status='pending'),0) pending, COALESCE(SUM(status='failed'),0) failed FROM orders").get();
  const days = db.prepare("SELECT date(created/1000,'unixepoch') d, ROUND(SUM(usd),2) rev FROM orders WHERE status='paid' AND created>? GROUP BY d ORDER BY d").all(Date.now() - 14 * 864e5);
  const methods = db.prepare("SELECT method, COUNT(*) n FROM orders WHERE status='paid' GROUP BY method").all();
  const sold = {};
  for (const o of db.prepare("SELECT lines FROM orders WHERE status='paid' AND lines IS NOT NULL").all()) for (const l of JSON.parse(o.lines)) sold[l.id] = (sold[l.id] || 0) + l.q;
  const top = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, q]) => ({ n: P(+id)?.n, q }));
  return { ...t, days, methods, top, low: db.prepare("SELECT COUNT(*) c FROM products WHERE s<=5").get().c };
}

function listOrders({ status, q, page, limit } = {}) {
  limit = Math.min(Math.max(+limit || 50, 1), 100); page = Math.max(+page || 1, 1);
  const w = [], a = [];
  if (status) { if (!STATUSES.includes(status)) throw new HttpError(400, "وضعیت نامعتبر"); w.push("status=?"); a.push(status); }
  if (q) { const like = `%${String(q).slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`; w.push("(no LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')"); a.push(like, like, like); }
  const W = w.length ? "WHERE " + w.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) c FROM orders ${W}`).get(...a).c;
  const items = db.prepare(`SELECT no,items,usd,irr,method,name,email,phone,track,status,created FROM orders ${W} ORDER BY created DESC LIMIT ? OFFSET ?`)
    .all(...a, limit, (page - 1) * limit).map(o => ({ ...o, items: JSON.parse(o.items) }));
  return { items, total, page, limit };
}

function setOrderStatus(no, status, by, ip) {
  const o = getOrder(no); if (!o) throw new HttpError(404, "سفارش پیدا نشد");
  if (!STATUSES.includes(status)) throw new HttpError(400, "وضعیت نامعتبر");
  if (o.status === status) return;
  setStatus(no, status); audit(by, "order.status", no, { from: o.status, to: status }, ip);
}

function updateProduct(id, body, by, ip) {
  const old = P(+id), p = Number(body?.p), s = Number(body?.s);
  if (!old) throw new HttpError(404, "محصول پیدا نشد");
  if (!(p > 0 && p < 10000) || !Number.isInteger(s) || s < 0 || s > 100000) throw new HttpError(400, "قیمت یا موجودی نامعتبر است.");
  const price = Math.round(p * 100) / 100;
  db.prepare("UPDATE products SET p=?, s=? WHERE id=?").run(price, s, old.id);
  audit(by, "product.update", String(old.id), { name: old.n, from: { p: old.p, s: old.s }, to: { p: price, s } }, ip);
}
const auditLog = limit => db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(+limit || 50, 1), 200));
const products = () => db.prepare("SELECT * FROM products ORDER BY id").all();
module.exports = { stats, listOrders, setOrderStatus, updateProduct, auditLog, products, STATUSES };
