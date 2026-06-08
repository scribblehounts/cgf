import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

/*
 * The app uses Claude.ai's `window.storage` API for persistence. Here we point
 * it at our own server-side database (see /api/store in server.js), so data is
 * saved on the droplet permanently and is shared across every device/browser.
 *
 * localStorage is kept as a fast cache + offline fallback. On first load against
 * the server, any data that was previously saved only in localStorage is pushed
 * up to the database automatically (one-time migration).
 */
const API = "/api/store";

async function srvGet(k) {
  const r = await fetch(`${API}/${encodeURIComponent(k)}`);
  if (!r.ok) throw new Error("store get failed");
  return (await r.json()).value;
}
async function srvSet(k, v) {
  const r = await fetch(`${API}/${encodeURIComponent(k)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: v }),
  });
  if (!r.ok) throw new Error("store set failed");
}
async function srvDel(k) {
  await fetch(`${API}/${encodeURIComponent(k)}`, { method: "DELETE" });
}
async function srvList(prefix) {
  const r = await fetch(`${API}?prefix=${encodeURIComponent(prefix || "")}`);
  if (!r.ok) throw new Error("store list failed");
  return (await r.json()).keys || [];
}

window.storage = {
  async get(k) {
    try {
      const v = await srvGet(k);
      if (v !== null && v !== undefined) {
        localStorage.setItem(k, JSON.stringify(v)); // refresh cache
        return { key: k, value: v };
      }
      // Server has nothing yet — migrate an existing local copy up, if any.
      const cached = localStorage.getItem(k);
      if (cached != null) {
        const parsed = JSON.parse(cached);
        srvSet(k, parsed).catch(() => {});
        return { key: k, value: parsed };
      }
      return null;
    } catch {
      const cached = localStorage.getItem(k); // server unreachable -> use cache
      return cached == null ? null : { key: k, value: JSON.parse(cached) };
    }
  },
  async set(k, v) {
    localStorage.setItem(k, JSON.stringify(v)); // instant local cache
    try { await srvSet(k, v); } catch {}        // durable server write
    return { key: k, value: v };
  },
  async delete(k) {
    localStorage.removeItem(k);
    try { await srvDel(k); } catch {}
    return { key: k, deleted: true };
  },
  async list(prefix = "") {
    try { return { keys: await srvList(prefix) }; }
    catch { return { keys: Object.keys(localStorage).filter((x) => x.startsWith(prefix)) }; }
  },
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
