import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";

const TOKEN = "t".repeat(32);
let server;
let base;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "notes-test-"));
  // L'app doit connaître son port pour valider Host/Origin : on en réserve un libre.
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  server = await new Promise((resolve) => {
    const s = createApp({ dataDir, token: TOKEN, port }).listen(port, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("la page locale du PC accède à l'API sans jeton", async () => {
  const res = await fetch(`${base}/api/notes`);
  assert.equal(res.status, 200);
});

test("un site tiers ouvert sur le PC est refusé (Origin étrangère)", async () => {
  const res = await fetch(`${base}/api/notes`, { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 401);
});

test("DNS rebinding : Host inattendu refusé", async () => {
  // fetch() ignore l'en-tête Host : on passe par http.request.
  const status = await new Promise((resolve, reject) => {
    http.get(`${base}/api/notes`, { headers: { Host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject);
  });
  assert.equal(status, 401);
});

test("le téléphone doit présenter le jeton", async () => {
  const headers = { Origin: "https://localhost" };
  assert.equal((await fetch(`${base}/api/notes`, { headers })).status, 401);
  const wrong = await fetch(`${base}/api/notes`, { headers: { ...headers, Authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);
  const ok = await fetch(`${base}/api/notes`, { headers: { ...headers, Authorization: `Bearer ${TOKEN}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://localhost");
});

test("le préflight CORS de l'app mobile est accepté", async () => {
  const res = await fetch(`${base}/api/notes`, {
    method: "OPTIONS",
    headers: { Origin: "https://localhost", "Access-Control-Request-Method": "PUT" },
  });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
});

test("le jeton de jumelage n'est jamais donné au téléphone", async () => {
  const res = await fetch(`${base}/api/pairing`, {
    headers: { Origin: "https://localhost", Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 403);
  const local = await (await fetch(`${base}/api/pairing`)).json();
  assert.equal(local.token, TOKEN);
  assert.match(local.svg, /<svg/);
  assert.equal(JSON.parse(local.payload).token, TOKEN);
});

test("les modifications et commandes sont diffusées en direct", async () => {
  const phone = { Origin: "https://localhost", Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  // Sans page PC ouverte, la télécommande échoue proprement.
  const noPc = await fetch(`${base}/api/remote`, { method: "POST", headers: phone, body: '{"action":"stop"}' });
  assert.equal(noPc.status, 409);

  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/events?role=pc`, { signal: ctrl.signal });
  const reader = stream.body.getReader();
  const received = [];
  const pump = (async () => {
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) return;
      buf += new TextDecoder().decode(value);
      for (const m of buf.matchAll(/data: (.+)\n\n/g)) received.push(JSON.parse(m[1]));
      buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
    }
  })();

  await new Promise((r) => setTimeout(r, 50));
  const created = await (await fetch(`${base}/api/notes`, {
    method: "POST", headers: { ...phone, "X-Client-Id": "tel-1" }, body: '{"title":"Depuis le téléphone"}',
  })).json();
  const cmd = await fetch(`${base}/api/remote`, {
    method: "POST", headers: phone, body: JSON.stringify({ action: "start", noteId: created.id }),
  });
  assert.equal(cmd.status, 202);
  await new Promise((r) => setTimeout(r, 50));
  ctrl.abort();
  await pump;

  assert.ok(received.some((e) => e.type === "note" && e.id === created.id && e.source === "tel-1"));
  assert.ok(received.some((e) => e.type === "command" && e.action === "start" && e.noteId === created.id));
});
