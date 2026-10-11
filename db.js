const Database = require("better-sqlite3"), cfg = require("./config");
const db = new Database(cfg.dbFile);
db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");

// مهاجرت‌های نسخه‌دار (user_version) — هر مهاجرت فقط یک‌بار و داخل تراکنش اجرا می‌شود
const MIGRATIONS = [
  d => d.exec(`
    CREATE TABLE IF NOT EXISTS orders(no TEXT PRIMARY KEY, items TEXT, usd REAL, irr INTEGER, method TEXT, name TEXT, email TEXT, phone TEXT,
      ref TEXT, track TEXT, status TEXT DEFAULT 'pending', created INTEGER);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, n TEXT, p REAL, s INTEGER)`),
  d => { if (!d.prepare("PRAGMA table_info(orders)").all().some(c => c.name === "lines")) d.exec("ALTER TABLE orders ADD COLUMN lines TEXT"); },
  d => d.exec(`
    CREATE TABLE sessions(id TEXT PRIMARY KEY, csrf TEXT NOT NULL, ip TEXT, ua TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT);
    CREATE INDEX idx_orders_status ON orders(status, created);
    CREATE INDEX idx_audit_ts ON audit_log(ts)`),
  d => d.exec(`
    ALTER TABLE products ADD COLUMN meta TEXT;
    ALTER TABLE products ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT)`)
];
for (let v = db.pragma("user_version", { simple: true }); v < MIGRATIONS.length; v++)
  db.transaction(() => { MIGRATIONS[v](db); db.pragma(`user_version = ${v + 1}`); })();

const CATALOG = {
  1:{n:"GTA V",p:14.99,s:12},2:{n:"Cyberpunk 2077",p:29.99,s:8},3:{n:"Red Dead Redemption 2",p:39.99,s:5},
  4:{n:"Elden Ring",p:49.99,s:10},5:{n:"Minecraft",p:19.99,s:50},6:{n:"Forza Horizon 5",p:34.99,s:7},
  7:{n:"EA Sports FC",p:59.99,s:20},8:{n:"Resident Evil 4",p:39.99,s:6},9:{n:"God of War",p:29.99,s:9},
  10:{n:"The Witcher 3",p:24.99,s:15},11:{n:"Hogwarts Legacy",p:44.99,s:0},12:{n:"Call of Duty",p:59.99,s:30}
};
for (const [id, g] of Object.entries(CATALOG)) db.prepare("INSERT OR IGNORE INTO products(id,n,p,s) VALUES(?,?,?,?)").run(+id, g.n, g.p, g.s);

// اطلاعات کامل ویترین (پلتفرم، ژانر، رنگ، ...) برای بازی‌های اولیه؛ بعداً از پنل ادمین قابل ویرایش است
const META = {"1":{"pl":["PC","PS5","Xbox"],"g":"Open World","r":4.8,"y":2013,"c":["#2e7d32","#0b3d1a"],"d":"Rockstar Games","sales":190,"img":""},"2":{"pl":["PC","PS5","Xbox"],"g":"Action RPG","r":4.5,"y":2020,"c":["#f5e600","#7a2cff"],"d":"CD Projekt Red","sales":30,"img":""},"3":{"pl":["PC","PS5","Xbox"],"g":"Open World","r":4.9,"y":2018,"c":["#a33","#2a0a0a"],"d":"Rockstar Games","sales":60,"img":""},"4":{"pl":["PC","PS5","Xbox"],"g":"RPG","r":4.9,"y":2022,"c":["#d4a017","#2b2410"],"d":"FromSoftware","sales":25,"img":""},"5":{"pl":["PC","PS5","Xbox"],"g":"Indie","r":4.7,"y":2011,"c":["#4caf50","#6d4c2f"],"d":"Mojang","sales":300,"img":""},"6":{"pl":["PC","Xbox"],"g":"Racing","r":4.6,"y":2021,"c":["#ff7a00","#0a4a8a"],"d":"Playground Games","sales":40,"img":""},"7":{"pl":["PC","PS5","Xbox"],"g":"Sports","r":4,"y":2025,"c":["#00c853","#002b36"],"d":"EA Sports","sales":35,"img":""},"8":{"pl":["PC","PS5","Xbox"],"g":"Horror","r":4.8,"y":2023,"c":["#b71c1c","#111"],"d":"Capcom","sales":10,"img":""},"9":{"pl":["PC","PS5"],"g":"Action","r":4.9,"y":2018,"c":["#5c6bc0","#1a1a2e"],"d":"Santa Monica Studio","sales":23,"img":""},"10":{"pl":["PC","PS5","Xbox"],"g":"RPG","r":4.9,"y":2015,"c":["#8d99ae","#2b2d42"],"d":"CD Projekt Red","sales":50,"img":""},"11":{"pl":["PC","PS5","Xbox"],"g":"Adventure","r":4.4,"y":2023,"c":["#7b1fa2","#1b0f3a"],"d":"Avalanche Software","sales":22,"img":""},"12":{"pl":["PC","PS5","Xbox"],"g":"FPS","r":4.2,"y":2024,"c":["#455a64","#10171a"],"d":"Activision","sales":50,"img":""}};
for (const [id, m] of Object.entries(META)) db.prepare("UPDATE products SET meta=? WHERE id=? AND meta IS NULL").run(JSON.stringify(m), +id);
const getSetting = (k, d = null) => { const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k); return r ? r.v : d; };
const setSetting = (k, v) => db.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
const getRate = () => +getSetting("rate", cfg.rate) || 0;   // نرخ دلار: مقدار پنل ادمین، وگرنه .env

const P = id => db.prepare("SELECT * FROM products WHERE id=?").get(id);
const getOrder = no => db.prepare("SELECT * FROM orders WHERE no=?").get(String(no || ""));

// تغییر وضعیت + همگام‌سازی موجودی در یک تراکنش اتمیک (پرداخت→کم، برگشت از پرداخت→برگردان)
const setStatus = db.transaction((no, status, track) => {
  const o = getOrder(no); if (!o) return false;
  db.prepare("UPDATE orders SET status=?, track=COALESCE(?,track) WHERE no=?").run(status, track ?? null, no);
  const lines = o.lines ? JSON.parse(o.lines) : [];
  if (status === "paid" && o.status !== "paid") for (const l of lines) db.prepare("UPDATE products SET s=MAX(s-?,0) WHERE id=?").run(l.q, l.id);
  if (o.status === "paid" && status !== "paid") for (const l of lines) db.prepare("UPDATE products SET s=s+? WHERE id=?").run(l.q, l.id);
  return true;
});

const audit = (actor, action, target, detail, ip) =>
  db.prepare("INSERT INTO audit_log(ts,actor,action,target,detail,ip) VALUES(?,?,?,?,?,?)")
    .run(Date.now(), actor ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null, ip ?? null);

function totals(lines) { // محاسبه به سنت؛ ۱۰٪ تخفیف از ۱۰۰ دلار به بالا + ۹٪ مالیات
  const sub = lines.reduce((a, l) => a + Math.round(P(l.id).p * 100) * l.q, 0);
  const disc = sub >= 10000 ? Math.round(sub * 0.1) : 0;
  const tax = Math.round((sub - disc) * 0.09);
  return (sub - disc + tax) / 100;
}
module.exports = { db, P, getOrder, setStatus, audit, totals, getSetting, setSetting, getRate };
