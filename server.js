const express = require("express"), path = require("path");
const cfg = require("./src/config"), { db } = require("./src/db"), sec = require("./src/security"), http = require("./src/http"), sessions = require("./src/sessions");
const app = express();
app.disable("x-powered-by"); if (cfg.trustProxy) app.set("trust proxy", 1);
app.use(http.logger, sec.headers, express.json({ limit: "20kb" }));

app.get("/healthz", (_, res) => { db.prepare("SELECT 1").get(); res.json({ ok: true }); });
app.use(require("./src/shop.routes"));
app.use("/api/admin", require("./src/admin.routes"));
app.get("/admin", (_, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (_, res) => res.status(404).json({ error: "not found" }));
app.use(http.errorHandler);

const server = app.listen(cfg.port, () => console.log("Game Store Madadi → " + cfg.baseUrl));
sessions.purge(); setInterval(sessions.purge, 3600e3).unref();
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGTERM", stop); process.on("SIGINT", stop);
