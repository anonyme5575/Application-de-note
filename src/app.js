// Application HTTP : API des notes, transcription, analyse, et liaison avec
// l'app mobile (jeton d'accès, événements en direct, commandes à distance).
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, claudeAvailable, MODEL } from "./analyze.js";
import { lanUrls, pairingPayload, qrSvg, tokenMatches } from "./pairing.js";
import { NoteStore } from "./store.js";
import { transcribe, transcriptionAvailable } from "./transcribe.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Origines de l'app mobile (WebView Capacitor). Surchargeable pour les tests.
const DEFAULT_MOBILE_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"];

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * @param {{dataDir: string, token: string, port: number, mobileOrigins?: string[]}} opts
 */
export function createApp({ dataDir, token, port, mobileOrigins = DEFAULT_MOBILE_ORIGINS }) {
  const store = new NoteStore(dataDir);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  const localOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const events = new EventHub();
  let pcState = { recording: false, noteId: null };

  const app = express();
  app.disable("x-powered-by");

  // --- CORS pour l'app mobile -------------------------------------------------
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && mobileOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Client-Id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      // Chrome : autorise une page « locale » à joindre une adresse du réseau privé.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (req.method === "OPTIONS") return res.status(204).end();
    }
    next();
  });

  // --- Authentification ---------------------------------------------------------
  // La page du PC (même machine, même origine) passe sans jeton. Tout le reste
  // (téléphone, autre machine du réseau) doit présenter le jeton de jumelage.
  // Le contrôle de Host bloque le « DNS rebinding » ; celui d'Origin empêche
  // un site ouvert dans le navigateur du PC d'appeler l'API.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isLocalPage =
      LOOPBACK.has(req.socket.remoteAddress) &&
      localHosts.has(req.headers.host) &&
      (!origin || localOrigins.has(origin));
    if (isLocalPage) {
      req.isPc = true;
      return next();
    }
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (tokenMatches(token, bearer ?? req.query.token)) return next();
    res.status(401).json({ error: "Jeton de jumelage manquant ou invalide. Rescannez le QR code du PC." });
  });

  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(publicDir));

  const clientId = (req) => String(req.headers["x-client-id"] ?? "");
  const notifyNote = (req, id, deleted = false) =>
    events.send({ type: "note", id, deleted, source: clientId(req) });

  // --- Configuration et jumelage -----------------------------------------------
  app.get("/api/config", (_req, res) => {
    res.json({ claude: claudeAvailable(), model: MODEL, serverTranscription: transcriptionAvailable() });
  });

  app.get("/api/ping", (_req, res) => res.json({ ok: true, app: "notes-reunion" }));

  app.get("/api/pairing", async (req, res) => {
    // Le jeton n'est jamais renvoyé au téléphone : seulement à la page du PC.
    if (!req.isPc) return res.status(403).json({ error: "Réservé à la page du PC." });
    const urls = lanUrls(port);
    const payload = pairingPayload(urls, token);
    res.json({ urls, token, payload, svg: await qrSvg(payload) });
  });

  // --- Notes ------------------------------------------------------------------
  app.get("/api/notes", async (_req, res) => res.json(await store.list()));

  app.post("/api/notes", async (req, res) => {
    const note = await store.create(req.body);
    notifyNote(req, note.id);
    res.status(201).json(note);
  });

  app.get("/api/notes/:id", async (req, res) => {
    const note = await store.get(req.params.id);
    return note ? res.json(note) : res.status(404).json({ error: "Note introuvable" });
  });

  app.put("/api/notes/:id", async (req, res) => {
    const note = await store.update(req.params.id, req.body);
    if (!note) return res.status(404).json({ error: "Note introuvable" });
    notifyNote(req, note.id);
    res.json(note);
  });

  app.delete("/api/notes/:id", async (req, res) => {
    const ok = await store.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: "Note introuvable" });
    notifyNote(req, req.params.id, true);
    res.status(204).end();
  });

  // --- Transcription et analyse -----------------------------------------------
  app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    if (!transcriptionAvailable()) {
      return res.status(503).json({ error: "Transcription non configurée sur le PC (TRANSCRIPTION_API_KEY)." });
    }
    if (!req.file) return res.status(400).json({ error: "Aucun fichier audio reçu." });
    try {
      const text = await transcribe(req.file.buffer, req.file.mimetype, req.body.prompt ?? "");
      res.json({ text });
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: err.message });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const transcript = String(req.body.transcript ?? "");
    const notes = String(req.body.notes ?? "");
    if (!transcript.trim() && !notes.trim()) {
      return res.status(400).json({ error: "Rien à analyser : transcription et notes vides." });
    }
    try {
      res.json(await analyze(transcript, notes));
    } catch (err) {
      console.error(err);
      const status = err instanceof Anthropic.RateLimitError ? 429
        : err instanceof Anthropic.AuthenticationError ? 401
        : 502;
      res.status(status).json({ error: err.message });
    }
  });

  // --- Temps réel et télécommande -----------------------------------------------
  // Flux SSE : modifications de notes, état d'enregistrement du PC, commandes.
  app.get("/api/events", (req, res) => {
    const role = req.query.role === "pc" && req.isPc ? "pc" : "phone";
    events.add(res, role);
    res.write(`data: ${JSON.stringify({ type: "pc-state", ...pcState, pcOnline: events.count("pc") })}\n\n`);
    if (role === "pc") events.send({ type: "pc-online", pcOnline: events.count("pc") });
    req.on("close", () => {
      events.remove(res);
      if (role === "pc") events.send({ type: "pc-online", pcOnline: events.count("pc") });
    });
  });

  app.get("/api/status", (_req, res) => res.json({ ...pcState, pcOnline: events.count("pc") }));

  // La page du PC publie son état d'enregistrement.
  app.post("/api/pc-state", (req, res) => {
    if (!req.isPc) return res.status(403).json({ error: "Réservé à la page du PC." });
    pcState = { recording: Boolean(req.body.recording), noteId: req.body.noteId ?? null };
    events.send({ type: "pc-state", ...pcState, pcOnline: events.count("pc") });
    res.status(204).end();
  });

  // Le téléphone demande au PC de démarrer, arrêter ou analyser.
  app.post("/api/remote", (req, res) => {
    const action = req.body.action;
    if (!["start", "stop", "analyze"].includes(action)) {
      return res.status(400).json({ error: "Action inconnue." });
    }
    if (!events.count("pc")) {
      return res.status(409).json({ error: "La page de l'application n'est pas ouverte sur le PC." });
    }
    events.send({ type: "command", action, noteId: req.body.noteId ?? null, source: clientId(req) }, "pc");
    res.status(202).json({ ok: true });
  });

  app.locals.events = events;
  return app;
}

class EventHub {
  constructor() {
    this.clients = new Map();
    this.heartbeat = setInterval(() => {
      for (const res of this.clients.keys()) res.write(": ping\n\n");
    }, 25_000);
    this.heartbeat.unref();
  }

  add(res, role) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    this.clients.set(res, role);
  }

  remove(res) {
    this.clients.delete(res);
  }

  count(role) {
    let n = 0;
    for (const r of this.clients.values()) if (r === role) n++;
    return n;
  }

  send(event, role = null) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const [res, r] of this.clients) if (!role || r === role) res.write(data);
  }
}
