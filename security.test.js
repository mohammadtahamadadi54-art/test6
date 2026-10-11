const test = require("node:test"), assert = require("node:assert");
const sec = require("../src/security");
const res = () => ({ h: {}, code: 200, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json() { return this; } });

test("verifier: فقط نام‌کاربری و رمز درست پذیرفته می‌شود", () => {
  const v = sec.makeVerifier("Admin", "S3cret-pass-1");
  assert.ok(v("Admin", "S3cret-pass-1"));
  assert.ok(!v("admin", "S3cret-pass-1")); assert.ok(!v("Admin", "wrong")); assert.ok(!v("", ""));
});
test("verifier: رمز خالی همیشه رد می‌شود (ادمین غیرفعال)", () => assert.ok(!sec.makeVerifier("Admin", "")("Admin", "")));
test("limiter: بعد از max درخواست ۴۲۹ می‌دهد", () => {
  const l = sec.limiter({ windowMs: 60000, max: 2 }); let n = 0; const req = { ip: "1.1.1.1" };
  for (let i = 0; i < 2; i++) l(req, res(), () => n++);
  const r = res(); l(req, r, () => n++);
  assert.equal(n, 2); assert.equal(r.code, 429); assert.ok(r.h["Retry-After"]);
});
test("lockout: بعد از ۵ شکست قفل و با ok باز می‌شود", () => {
  const k = sec.lockout(); for (let i = 0; i < 5; i++) k.fail("x");
  assert.ok(k.blocked("x")); k.ok("x"); assert.ok(!k.blocked("x"));
});
test("cookie parser و هدرهای امنیتی", () => {
  assert.equal(sec.cookie({ headers: { cookie: "a=1; adm=tok123; b=2" } }, "adm"), "tok123");
  assert.equal(sec.cookie({ headers: {} }, "adm"), "");
  const r = res(); sec.headers({ path: "/api/x" }, r, () => {});
  assert.equal(r.h["X-Frame-Options"], "DENY"); assert.equal(r.h["Cache-Control"], "no-store");
});
