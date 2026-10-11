require("dotenv").config();
const path = require("path"), e = process.env;
const prod = e.NODE_ENV === "production";
const admin = { user: e.ADMIN_USER || "Admin", pass: e.ADMIN_PASS || "" };

// در حالت production نبودِ رمز قوی = توقف راه‌اندازی (fail fast)
if (admin.pass.length < 10) {
  if (prod) throw new Error("ADMIN_PASS باید حداقل ۱۰ کاراکتر باشد.");
  console.warn("[config] ADMIN_PASS تنظیم نشده یا کوتاه است؛ ورود به پنل ادمین غیرفعال است.");
}
module.exports = {
  prod, admin,
  port: +e.PORT || 3000,
  baseUrl: e.BASE_URL || "http://localhost:3000",
  trustProxy: e.TRUST_PROXY === "1",           // پشت Nginx/Cloudflare برای IP درست
  dbFile: e.DB_FILE || path.join(__dirname, "..", "orders.db"),
  rate: +e.USD_IRR || 0,
  zarinpal: { merchant: e.ZARINPAL_MERCHANT, base: e.ZARINPAL_SANDBOX === "1" ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com" },
  nowpayments: { key: e.NOWPAYMENTS_KEY, ipn: e.NOWPAYMENTS_IPN_SECRET }
};
