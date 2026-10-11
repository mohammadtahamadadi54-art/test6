const crypto = require("crypto");
const sha = x => crypto.createHash("sha256").update(String(x)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// رمز با scrypt هش می‌شود و مقایسه زمان‌ثابت است
function makeVerifier(user, pass) {
  const salt = crypto.randomBytes(16), hash = crypto.scryptSync(String(pass), salt, 64);
  return (u, p) => {
    const a = safeEqual(u, user), b = crypto.timingSafeEqual(crypto.scryptSync(String(p), salt, 64), hash);
    return Boolean(pass) && a && b;
  };
}
function limiter({ windowMs, max, keyFn = req => req.ip }) {
  const hits = new Map();
  setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = keyFn(req), n = Date.now(); let h = hits.get(k);
    if (!h || h.reset < n) hits.set(k, h = { n: 0, reset: n + windowMs });
    if (++h.n > max) { res.setHeader("Retry-After", Math.ceil((h.reset - n) / 1000)); return res.status(429).json({ error: "درخواست بیش از حد؛ کمی بعد دوباره تلاش کنید." }); }
    next();
  };
}
function lockout({ max = 5, lockMs = 600000 } = {}) {
  const m = new Map();
  return {
    blocked: k => (m.get(k)?.until || 0) > Date.now(),
    fail: k => { const v = m.get(k) || { n: 0, until: 0 }; if (++v.n >= max) { v.until = Date.now() + lockMs; v.n = 0; } m.set(k, v); },
    ok: k => m.delete(k)
  };
}
const cookie = (req, name) => {
  for (const p of (req.headers.cookie || "").split(";")) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim(); }
  return "";
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const headers = (req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
};
module.exports = { safeEqual, makeVerifier, limiter, lockout, cookie, headers };
