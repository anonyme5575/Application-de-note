// Extraction par Claude des idées et informations d'une transcription de
// réunion, sous forme de tableaux. Module isomorphe : utilisé par le serveur
// PC et embarqué dans l'app mobile ; le client Anthropic est fourni par
// l'appelant.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = "claude-opus-5";

const AnalysisSchema = z.object({
  resume: z.string().describe("Résumé de la réunion en 3 à 6 phrases"),
  decisions: z.array(
    z.object({
      decision: z.string(),
      contexte: z.string().describe("Pourquoi / sur quelle base, vide si inconnu"),
    }),
  ),
  actions: z.array(
    z.object({
      tache: z.string(),
      responsable: z.string().describe("Personne ou équipe, vide si non mentionné"),
      echeance: z.string().describe("Échéance telle qu'énoncée, vide si non mentionnée"),
    }),
  ),
  idees: z.array(
    z.object({
      idee: z.string(),
      auteur: z.string().describe("Vide si inconnu"),
    }),
  ),
  informations: z.array(
    z.object({
      sujet: z.string(),
      detail: z.string().describe("Fait, chiffre, date ou donnée partagée"),
    }),
  ),
  questions: z.array(
    z.object({
      question: z.string(),
      statut: z.enum(["ouverte", "répondue"]),
      reponse: z.string().describe("Vide si la question reste ouverte"),
    }),
  ),
});

const SYSTEM_PROMPT = `Tu analyses la transcription d'une réunion (appel ou visioconférence) pour en produire un compte rendu structuré en tableaux.

La transcription provient d'une reconnaissance vocale automatique : elle contient des fautes, des mots mal reconnus, des phrases coupées et aucun nom de locuteur. Reconstitue le sens à partir du contexte, sans inventer d'information absente.

Règles :
- Rédige en français, de façon concise : une ligne par élément, formulée pour être compréhensible hors contexte.
- Décisions : uniquement ce qui a été acté ou validé, pas ce qui a été simplement évoqué.
- Actions : tâches concrètes à réaliser. Renseigne le responsable et l'échéance seulement s'ils sont dits ou clairement déductibles ; sinon laisse le champ vide.
- Idées : propositions, pistes et suggestions non encore actées.
- Informations : faits, chiffres, dates, contraintes et données partagées pendant la réunion.
- Questions : questions soulevées ; marque-les "répondue" seulement si la réponse figure dans la transcription.
- Un même élément ne doit apparaître que dans un seul tableau.
- Les notes manuelles de l'utilisateur, si présentes, sont fiables : sers-t'en pour corriger les noms propres et compléter le contexte.
- Si la transcription est trop courte ou vide de contenu, renvoie des tableaux vides et un résumé qui le signale.`;

/** @param {import("@anthropic-ai/sdk").default} client */
export async function analyzeWithClaude(client, transcript, notes = "") {
  const userContent = [
    notes.trim() ? `<notes_manuelles>\n${notes.trim()}\n</notes_manuelles>` : "",
    `<transcription>\n${transcript}\n</transcription>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(AnalysisSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude a refusé d'analyser cette transcription.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("La réponse de Claude a été tronquée (transcription trop longue).");
  }
  if (!response.parsed_output) {
    throw new Error("Réponse de Claude illisible.");
  }
  return response.parsed_output;
}
