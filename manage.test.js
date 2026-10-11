process.env.DB_FILE = ":memory:"; process.env.NODE_ENV = "test";
const test = require("node:test"), assert = require("node:assert");
const { db, P, getRate } = require("../src/db"), mg = require("../src/admin.manage");
const good = { n: "Test Game", p: 9.99, s: 3, g: "Indie", d: "Me", y: 2024, r: 4, sales: 1, c: ["#112233", "#445566"], pl: ["PC"] };

test("افزودن/ویرایش/حذف محصول و نمایش در فید ویترین", () => {
  const id = mg.createProduct(good, "A", "::1"); assert.equal(P(id).n, "Test Game");
  mg.saveProduct(id, { ...good, p: 12.5, hidden: true }, "A", "::1"); assert.equal(P(id).hidden, 1);
  assert.ok(mg.listProducts().find(x => x.id === id).pl.includes("PC"));
  mg.deleteProduct(id, "A", "::1"); assert.equal(P(id), undefined);
});
test("اعتبارسنجی محصول: رنگ، تصویر، قیمت", () => {
  for (const bad of [{ c: ["red", "#fff"] }, { img: "http://evil/x.png" }, { img: "../../etc/passwd" }, { p: -5 }, { n: "" }])
    assert.throws(() => mg.createProduct({ ...good, ...bad }), { status: 400 });
});
test("حذف سفارش پرداخت‌شده موجودی را برمی‌گرداند", () => {
  db.prepare("INSERT INTO orders(no,items,usd,method,name,email,phone,status,created,lines) VALUES('D1','[\"x\"]',5,'crypto','n','a@b.c','0912',?,?,?)").run("pending", Date.now(), JSON.stringify([{ id: 1, q: 2 }]));
  const s0 = P(1).s; require("../src/db").setStatus("D1", "paid"); assert.equal(P(1).s, s0 - 2);
  mg.deleteOrder("D1", "A", "::1"); assert.equal(P(1).s, s0); assert.equal(db.prepare("SELECT COUNT(*) c FROM orders WHERE no='D1'").get().c, 0);
});
test("تنظیمات: نرخ دلار پویا و CSV ایمن", () => {
  mg.saveSettings({ rate: 650000, announce: "سلام", maintenance: true }, "A", "::1"); assert.equal(getRate(), 650000); assert.equal(mg.getSettings().maintenance, true);
  assert.throws(() => mg.saveSettings({ rate: -1 }), { status: 400 });
  db.prepare("INSERT INTO orders(no,items,usd,method,name,email,phone,status,created) VALUES('C1','[\"x\"]',1,'crypto','=HYPERLINK(1)','a@b.c','0912','paid',?)").run(Date.now());
  assert.match(mg.ordersCsv(), /"'=HYPERLINK/);
});
