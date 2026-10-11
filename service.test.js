process.env.DB_FILE = ":memory:"; process.env.NODE_ENV = "test";
const test = require("node:test"), assert = require("node:assert");
const { db, P } = require("../src/db"), svc = require("../src/admin.service"), sessions = require("../src/sessions");

const order = (no, status, usd, lines, name = "علی") => db.prepare("INSERT INTO orders(no,items,usd,irr,method,name,email,phone,status,created,lines) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .run(no, JSON.stringify(["x"]), usd, null, "crypto", name, name + "@t.com", "09120000000", status, Date.now(), JSON.stringify(lines));

test("تأیید دستی پرداخت موجودی را یک‌بار کم و برگشت آن را جبران می‌کند", () => {
  order("T1", "pending", 10, [{ id: 1, q: 2 }]); const s0 = P(1).s;
  svc.setOrderStatus("T1", "paid", "Admin", "::1"); assert.equal(P(1).s, s0 - 2);
  svc.setOrderStatus("T1", "paid", "Admin", "::1"); assert.equal(P(1).s, s0 - 2);   // تکراری = بدون اثر
  svc.setOrderStatus("T1", "failed", "Admin", "::1"); assert.equal(P(1).s, s0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='order.status'").get().c, 2);
});
test("وضعیت یا سفارش نامعتبر خطا می‌دهد", () => {
  assert.throws(() => svc.setOrderStatus("T1", "hacked", "A"), { status: 400 });
  assert.throws(() => svc.setOrderStatus("NOPE", "paid", "A"), { status: 404 });
});
test("listOrders: فیلتر، جست‌وجوی امن و صفحه‌بندی", () => {
  order("T2", "paid", 20, [{ id: 2, q: 1 }], "سارا"); order("T3", "paid", 30, [{ id: 2, q: 1 }], "رضا");
  assert.equal(svc.listOrders({ status: "paid" }).total, 2);
  assert.equal(svc.listOrders({ q: "سارا" }).total, 1);
  assert.equal(svc.listOrders({ q: "%" }).total, 0);                                  // % به‌عنوان wildcard تفسیر نمی‌شود
  assert.equal(svc.listOrders({ q: "' OR 1=1 --" }).total, 0);
  assert.equal(svc.listOrders({ limit: 1 }).items.length, 1);
  assert.throws(() => svc.listOrders({ status: "x" }), { status: 400 });
});
test("updateProduct: اعتبارسنجی و ثبت در audit", () => {
  svc.updateProduct(5, { p: "21.5", s: 7 }, "Admin", "::1"); assert.deepEqual([P(5).p, P(5).s], [21.5, 7]);
  for (const bad of [{ p: -1, s: 1 }, { p: 5, s: 1.5 }, { p: "abc", s: 1 }, { p: 5, s: -2 }]) assert.throws(() => svc.updateProduct(5, bad), { status: 400 });
  assert.throws(() => svc.updateProduct(999, { p: 1, s: 1 }), { status: 404 });
  assert.ok(svc.auditLog(10).some(a => a.action === "product.update"));
});
test("stats درآمد فقط سفارش‌های پرداخت‌شده را می‌شمارد", () => {
  const s = svc.stats(); assert.equal(s.rev, 50); assert.equal(s.paid, 2); assert.ok(s.top.length);
});
test("sessions: ساخت، یافتن، ابطال و انقضا", () => {
  const { token, csrf } = sessions.create("::1", "ua"); assert.equal(sessions.find(token).csrf, csrf);
  assert.ok(!db.prepare("SELECT 1 FROM sessions WHERE id=?").get(token));            // توکن خام ذخیره نمی‌شود
  sessions.destroy(token); assert.equal(sessions.find(token), null);
  const t2 = sessions.create("::1", "ua").token; db.prepare("UPDATE sessions SET expires=1").run(); assert.equal(sessions.find(t2), null);
});
