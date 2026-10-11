const r = require("express").Router(), crypto = require("crypto"), cfg = require("./config"), sec = require("./security");
const { db, P, getOrder, setStatus, totals, getSetting, getRate } = require("./db");
const ZARINPAL_MERCHANT = cfg.zarinpal.merchant, ZP = cfg.zarinpal.base, NOWPAYMENTS_KEY = cfg.nowpayments.key,
  NOWPAYMENTS_IPN_SECRET = cfg.nowpayments.ipn, BASE_URL = cfg.baseUrl;
r.use("/api/payments/create", sec.limiter({ windowMs: 60e3, max: 20 }));
r.use("/api/payments/status", sec.limiter({ windowMs: 60e3, max: 120 }));

r.get("/api/config", (_, res) => res.json({ rate: getRate(), announce: getSetting("announce", ""), maintenance: getSetting("maintenance") === "1", methods: { zarinpal: !!(ZARINPAL_MERCHANT && getRate()), crypto: !!NOWPAYMENTS_KEY } }));

r.post("/api/payments/create", async (req, res) => {
  try {
    if (getSetting("maintenance") === "1") return res.status(503).json({ error: "فروشگاه موقتاً بسته است؛ کمی بعد دوباره تلاش کنید." });
    const RATE = getRate();
    const { items, customer = {}, method } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 20) return res.status(400).json({ error: "سبد خرید نامعتبر است." });
    const lines = [];
    for (const it of items) {
      const id = +it.id, q = +it.q, g = P(id);
      if (!g || g.hidden || !Number.isInteger(q) || q < 1 || q > 10) return res.status(400).json({ error: "سبد خرید نامعتبر است." });
      if (!g.s) return res.status(400).json({ error: `«${g.n}» ناموجود است.` });
      lines.push({ id, q });
    }
    const name = String(customer.name || "").trim().slice(0, 80), email = String(customer.email || "").trim().slice(0, 120), phone = String(customer.phone || "").trim().slice(0, 20);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[0-9+]{10,14}$/.test(phone)) return res.status(400).json({ error: "اطلاعات خریدار نامعتبر است." });

    const usd = totals(lines), no = "GSM-" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const names = JSON.stringify(lines.map(l => `${P(l.id).n} ×${l.q}`));
    let url, ref = null, irr = null;

    if (method === "zarinpal") {
      if (!ZARINPAL_MERCHANT || !RATE) return res.status(503).json({ error: "درگاه ریالی فعال نیست." });
      irr = Math.round(usd * RATE);
      const r = await (await fetch(`${ZP}/pg/v4/payment/request.json`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT, amount: irr, currency: "IRR", description: `سفارش ${no}`,
          callback_url: `${BASE_URL}/api/payments/zarinpal/callback?no=${no}`, metadata: { email, mobile: phone } })
      })).json();
      if (r.data?.code !== 100) return res.status(502).json({ error: "اتصال به درگاه ریالی ناموفق بود." });
      ref = r.data.authority; url = `${ZP}/pg/StartPay/${ref}`;
    } else if (method === "crypto") {
      if (!NOWPAYMENTS_KEY) return res.status(503).json({ error: "درگاه دلاری فعال نیست." });
      const r = await (await fetch("https://api.nowpayments.io/v1/invoice", {
        method: "POST", headers: { "x-api-key": NOWPAYMENTS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ price_amount: usd, price_currency: "usd", order_id: no, order_description: `Game Store Madadi ${no}`,
          ipn_callback_url: `${BASE_URL}/api/payments/crypto/ipn`, success_url: `${BASE_URL}/?order=${no}`, cancel_url: `${BASE_URL}/?order=${no}` })
      })).json();
      if (!r.invoice_url) return res.status(502).json({ error: "اتصال به درگاه دلاری ناموفق بود." });
      ref = String(r.id || ""); url = r.invoice_url;
    } else return res.status(400).json({ error: "روش پرداخت نامعتبر است." });

    db.prepare("INSERT INTO orders(no,items,usd,irr,method,name,email,phone,ref,created,lines) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(no, names, usd, irr, method, name, email, phone, ref, Date.now(), JSON.stringify(lines));
    res.json({ url, orderNo: no });
  } catch (e) { console.error(e); res.status(500).json({ error: "خطای داخلی سرور." }); }
});

// بازگشت کاربر از زرین‌پال → تأیید (verify) سمت سرور
r.get("/api/payments/zarinpal/callback", async (req, res) => {
  const o = getOrder(req.query.no);
  if (!o || o.method !== "zarinpal") return res.redirect("/");
  if (o.status === "pending") {
    if (req.query.Status === "OK" && req.query.Authority === o.ref) {
      try {
        const r = await (await fetch(`${ZP}/pg/v4/payment/verify.json`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ merchant_id: ZARINPAL_MERCHANT, amount: o.irr, authority: o.ref })
        })).json();
        if ([100, 101].includes(r.data?.code)) setStatus(o.no, "paid", String(r.data.ref_id));
        else setStatus(o.no, "failed");
      } catch (e) { console.error(e); /* pending می‌ماند؛ می‌توان بعداً دوباره verify کرد */ }
    } else setStatus(o.no, "failed");
  }
  res.redirect("/?order=" + o.no);
});

// وب‌هوک NOWPayments با امضای HMAC-SHA512
const sortObj = o => Array.isArray(o) ? o.map(sortObj) : o && typeof o === "object" ? Object.keys(o).sort().reduce((a, k) => (a[k] = sortObj(o[k]), a), {}) : o;
r.post("/api/payments/crypto/ipn", (req, res) => {
  if (!NOWPAYMENTS_IPN_SECRET) return res.sendStatus(503);
  const h = Buffer.from(crypto.createHmac("sha512", NOWPAYMENTS_IPN_SECRET).update(JSON.stringify(sortObj(req.body || {}))).digest("hex"));
  const s = Buffer.from(req.get("x-nowpayments-sig") || "");
  if (h.length !== s.length || !crypto.timingSafeEqual(h, s)) return res.sendStatus(401);
  const b = req.body, o = getOrder(b.order_id);
  if (o && o.method === "crypto" && o.status === "pending") {
    if (b.payment_status === "finished" && Math.abs(+b.price_amount - o.usd) < 0.01) setStatus(o.no, "paid", String(b.payment_id));
    else if (["failed", "expired"].includes(b.payment_status)) setStatus(o.no, "failed");
  }
  res.sendStatus(200);
});

r.get("/api/payments/status/:no", (req, res) => {
  const o = getOrder(req.params.no);
  if (!o) return res.status(404).json({ error: "سفارش پیدا نشد" });
  res.json({ orderNo: o.no, status: o.status, method: o.method, usd: o.usd, irr: o.irr, track: o.track, items: JSON.parse(o.items) });
});

r.get("/api/games", (_, res) => res.json(db.prepare("SELECT id,n,p,s,meta FROM products WHERE hidden=0 ORDER BY id").all().map(({ meta, ...g }) => ({ ...g, ...JSON.parse(meta || "{}") }))));


module.exports = r;
