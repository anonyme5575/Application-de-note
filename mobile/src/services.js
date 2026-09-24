// Choix du service de transcription et d'analyse.
// Priorité au PC quand il est connecté : les clés API restent sur le PC.
// Sinon, appel direct des API avec les clés saisies dans les réglages.
import Anthropic from "@anthropic-ai/sdk";
import { analyzeWithClaude } from "../../src/claude.js";
import { analyzeHeuristic } from "../../src/heuristic.js";
import { transcribeAudio } from "../../src/whisper.js";

export class Services {
  /**
   * @param {import("./pc.js").PcLink} link
   * @param {() => object} getSettings
   */
  constructor(link, getSettings) {
    this.link = link;
    this.getSettings = getSettings;
  }

  /** Décrit où partiront l'audio et le texte, pour l'afficher à l'utilisateur. */
  describe() {
    const s = this.getSettings();
    const pc = this.link.online ? this.link.config : null;
    return {
      transcription: pc?.serverTranscription ? "PC" : s.whisperKey ? "direct" : null,
      analysis: pc ? (pc.claude ? "PC (Claude)" : "PC (locale)") : s.anthropicKey ? "Claude" : "locale",
    };
  }

  async transcribe(blob, prompt) {
    const s = this.getSettings();
    if (this.link.online && this.link.config?.serverTranscription) {
      const form = new FormData();
      form.append("audio", blob, "segment.webm");
      form.append("prompt", prompt);
      const { text } = await this.link.request("/api/transcribe", { method: "POST", body: form, timeout: 120_000 });
      return text;
    }
    if (s.whisperKey) {
      return transcribeAudio(blob, { url: s.whisperUrl, key: s.whisperKey, model: s.whisperModel, prompt });
    }
    throw new Error(
      this.link.online
        ? "Le PC n'a pas de transcription configurée, et aucune clé de transcription n'est saisie dans les Réglages."
        : "Aucune transcription disponible : connectez le PC ou saisissez une clé de transcription dans les Réglages.",
    );
  }

  async analyze(transcript, notes) {
    const s = this.getSettings();
    if (this.link.online) {
      return this.link.request("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ transcript, notes }),
        timeout: 300_000,
      });
    }
    if (s.anthropicKey) {
      // Appel direct depuis le téléphone : la clé est stockée sur cet appareil.
      const client = new Anthropic({ apiKey: s.anthropicKey, dangerouslyAllowBrowser: true });
      return { engine: "claude", analysis: await analyzeWithClaude(client, transcript, notes) };
    }
    return { engine: "local", analysis: analyzeHeuristic(transcript, notes) };
  }
}
