// Client d'une API de transcription compatible Whisper
// (POST multipart "file" + "model", réponse { text }).
// Isomorphe : utilisé par le serveur PC et par l'app mobile.

/**
 * @param {Blob} audio
 * @param {{url: string, key?: string, model: string, language?: string, prompt?: string}} opts
 */
export async function transcribeAudio(audio, { url, key, model, language = "fr", prompt = "" }) {
  const type = audio.type || "audio/webm";
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : "webm";

  const form = new FormData();
  form.append("file", audio, `segment.${ext}`);
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
