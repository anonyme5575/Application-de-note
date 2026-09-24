import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAvailable, MODEL } from "./src/analyze.js";
import { createApp } from "./src/app.js";
import { lanUrls, loadOrCreateToken } from "./src/pairing.js";
import { transcriptionAvailable } from "./src/transcribe.js";

try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env : on utilise les variables d'environnement existantes.
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, "data");
// 0.0.0.0 : joignable par le téléphone (avec le jeton de jumelage).
// HOST=127.0.0.1 désactive l'accès depuis le téléphone.
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const mobileOrigins = process.env.MOBILE_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);

const token = await loadOrCreateToken(dataDir);
const app = createApp({ dataDir, token, port, mobileOrigins });

app.listen(port, host, () => {
  console.log(`Application de note : http://localhost:${port}`);
  console.log(`  Analyse      : ${claudeAvailable() ? `Claude (${MODEL})` : "heuristique locale (ANTHROPIC_API_KEY absent)"}`);
  console.log(`  Transcription: ${transcriptionAvailable() ? "serveur (Whisper)" : "navigateur uniquement (TRANSCRIPTION_API_KEY absent)"}`);
  if (host === "0.0.0.0") {
    const urls = lanUrls(port);
    console.log(`  Téléphone    : ${urls.length ? urls.map((u) => u.url).join(", ") : "aucun réseau détecté"} (bouton « Téléphone » pour le QR code)`);
  }
});
