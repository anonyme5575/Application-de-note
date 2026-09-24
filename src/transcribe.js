// Transcription côté serveur PC, configurée par variables d'environnement.
import { transcribeAudio } from "./whisper.js";

export function transcriptionConfig() {
  return {
    url: process.env.TRANSCRIPTION_API_URL || "https://api.openai.com/v1/audio/transcriptions",
    key: process.env.TRANSCRIPTION_API_KEY || "",
    model: process.env.TRANSCRIPTION_MODEL || "whisper-1",
    language: process.env.TRANSCRIPTION_LANGUAGE || "fr",
  };
}

export function transcriptionAvailable() {
  const { url, key } = transcriptionConfig();
  // Un serveur local (localhost) n'exige généralement pas de clé.
  return Boolean(key) || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);
}

export function transcribe(buffer, mimeType, prompt = "") {
  return transcribeAudio(new Blob([buffer], { type: mimeType }), { ...transcriptionConfig(), prompt });
}
