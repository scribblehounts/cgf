import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Large limit because pasted screenshots are sent as base64 in the request body.
app.use(express.json({ limit: "30mb" }));

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL; // optional: overrides whatever the app requests

/* =========================================================================
 * Durable file-backed key/value database.
 * Every record is stored as its own JSON file in DATA_DIR, written atomically.
 * This persists across restarts/reboots and is shared by every device that
 * opens the site — so the Variant Lab history lives "forever" on the server.
 * No external database or native modules required.
 * ========================================================================= */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const fileFor = (key) => path.join(DATA_DIR, encodeURIComponent(key) + ".json");

function kvGet(key) {
  try { return JSON.parse(fs.readFileSync(fileFor(key), "utf8")); }
  catch { return undefined; }
}
function kvSet(key, value) {
  const f = fileFor(key), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, f); // atomic replace
}
function kvDel(key) { try { fs.unlinkSync(fileFor(key)); } catch {} }
function kvList(prefix = "") {
  try {
    return fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"))
      .map((f) => decodeURIComponent(f.slice(0, -5)))
      .filter((k) => k.startsWith(prefix));
  } catch { return []; }
}

app.get("/api/store", (req, res) => res.json({ keys: kvList(String(req.query.prefix || "")) }));
app.get("/api/store/:key", (req, res) => {
  const v = kvGet(req.params.key);
  res.json({ key: req.params.key, value: v === undefined ? null : v });
});
app.put("/api/store/:key", (req, res) => {
  const body = req.body || {};
  const value = body && typeof body === "object" && "value" in body ? body.value : body;
  try { kvSet(req.params.key, value); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.delete("/api/store/:key", (req, res) => { kvDel(req.params.key); res.json({ ok: true }); });

/* ---- AI proxy: the API key lives ONLY here on the server, never in the browser ---- */
app.post("/api/messages", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  try {
    const body = { ...req.body };
    if (MODEL) body.model = MODEL;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

/* ---- Serve the built React app ---- */
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

app.listen(PORT, () => console.log(`Cutline running on http://127.0.0.1:${PORT}  (database: ${DATA_DIR})`));
