import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, claudeAvailable, MODEL } from "./src/analyze.js";
import { NoteStore } from "./src/store.js";
import { transcribe, transcriptionAvailable } from "./src/transcribe.js";

try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env : on utilise les variables d'environnement existantes.
}

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new NoteStore(process.env.DATA_DIR || path.join(here, "data"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/config", (_req, res) => {
  res.json({
    claude: claudeAvailable(),
    model: MODEL,
    serverTranscription: transcriptionAvailable(),
  });
});

app.get("/api/notes", async (_req, res) => res.json(await store.list()));

app.post("/api/notes", async (req, res) => res.status(201).json(await store.create(req.body)));

app.get("/api/notes/:id", async (req, res) => {
  const note = await store.get(req.params.id);
  return note ? res.json(note) : res.status(404).json({ error: "Note introuvable" });
});

app.put("/api/notes/:id", async (req, res) => {
  const note = await store.update(req.params.id, req.body);
  return note ? res.json(note) : res.status(404).json({ error: "Note introuvable" });
});

app.delete("/api/notes/:id", async (req, res) => {
  const ok = await store.remove(req.params.id);
  return ok ? res.status(204).end() : res.status(404).json({ error: "Note introuvable" });
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!transcriptionAvailable()) {
    return res.status(503).json({ error: "Transcription serveur non configurée (TRANSCRIPTION_API_KEY)." });
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

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
app.listen(port, host, () => {
  console.log(`Application de note : http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`  Analyse      : ${claudeAvailable() ? `Claude (${MODEL})` : "heuristique locale (ANTHROPIC_API_KEY absent)"}`);
  console.log(`  Transcription: ${transcriptionAvailable() ? "serveur (Whisper)" : "navigateur uniquement (TRANSCRIPTION_API_KEY absent)"}`);
});
