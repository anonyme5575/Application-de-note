// Analyse côté serveur PC : Claude si une clé est configurée, sinon
// l'extracteur local.
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, analyzeWithClaude } from "./claude.js";
import { analyzeHeuristic } from "./heuristic.js";

export { MODEL };

let client = null;

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function analyze(transcript, notes = "") {
  if (claudeAvailable()) {
    client ??= new Anthropic();
    return { engine: "claude", analysis: await analyzeWithClaude(client, transcript, notes) };
  }
  return { engine: "local", analysis: analyzeHeuristic(transcript, notes) };
}
