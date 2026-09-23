// Transcription d'un segment audio via un endpoint compatible Whisper
// (POST multipart "file" + "model", réponse { text }).
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

export async function transcribe(buffer, mimeType, prompt = "") {
  const { url, key, model, language } = transcriptionConfig();
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), `segment.${ext}`);
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "json");
  // La fin du segment précédent aide à garder la continuité (noms, vocabulaire).
  if (prompt) form.append("prompt", prompt.slice(-400));

  const res = await fetch(url, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Transcription échouée (${res.status}) : ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.text ?? "").trim();
}
