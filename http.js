const crypto = require("crypto");
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const ah = f => (req, res, next) => Promise.resolve().then(() => f(req, res, next)).catch(next);

// لاگ ساختاریِ JSON (بدون بدنهٔ درخواست تا رمز/اطلاعات خریدار در لاگ نیفتد)
const logger = (req, res, next) => {
  const t = process.hrtime.bigint(); req.id = crypto.randomUUID(); res.setHeader("X-Request-Id", req.id);
  res.on("finish", () => console.log(JSON.stringify({ ts: new Date().toISOString(), id: req.id, m: req.method, u: req.path, s: res.statusCode, ms: Number(process.hrtime.bigint() - t) / 1e6 | 0, ip: req.ip })));
  next();
};
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const s = err.status >= 400 && err.status < 600 ? err.status : 500;
  if (s >= 500) console.error(JSON.stringify({ id: req.id, err: err.stack }));
  res.status(s).json({ error: err instanceof HttpError ? err.message : s < 500 ? "درخواست نامعتبر" : "خطای داخلی سرور." });
};
module.exports = { HttpError, ah, logger, errorHandler };
