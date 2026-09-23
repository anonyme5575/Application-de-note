// Extraction des idées et informations d'une transcription de réunion
// sous forme de tableaux. Deux moteurs :
//  - Claude (si ANTHROPIC_API_KEY est défini) : compréhension du contexte,
//    attribution des responsables, reformulation.
//  - Heuristique locale par mots-clés (hors ligne, gratuite, moins précise).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { emptyAnalysis } from "./store.js";

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

let client = null;

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function analyzeWithClaude(transcript, notes = "") {
  client ??= new Anthropic();
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

// ---------------------------------------------------------------------------
// Heuristique locale

// \b de JavaScript ignore les lettres accentuées (« décidé » ne matcherait
// pas) : on construit des frontières de mots Unicode.
const L = "[\\p{L}\\p{N}]";
function words(pattern) {
  return new RegExp(`(?<!${L})(?:${pattern})(?!${L})`, "iu");
}

const RE = {
  question: new RegExp(`\\?\\s*$|^(?:est-ce que|est ce que|pourquoi|comment|quand|qui|quel(?:le)?s?|combien|où)(?!${L})`, "iu"),
  decision: words(
    "on a décidé|nous avons décidé|j'ai décidé|décision|c'est décidé|c'est acté|acté|on valide|validé|on part sur|on retient|retenu|approuvé|on garde|on arrête",
  ),
  action: words(
    "je vais|tu vas|il va|elle va|on va|nous allons|vous allez|ils vont|je m'en occupe|s'en occupe|se charge|chargée? de|doit|doivent|devra|devront|il faut|faudra|à faire|todo|prochaine étape|envoyer|préparer|relancer",
  ),
  idee: words(
    "idée|on pourrait|nous pourrions|il faudrait peut-être|propose|proposition|suggère|suggere|suggestion|et si|pourquoi pas|ce serait bien|ça serait bien|piste|imaginer",
  ),
  info: /\d|%|€|\$|(?<![\p{L}\p{N}])(?:budget|chiffre|coût|prix|délai|date|deadline|client|contrat|version|résultat|objectif)(?![\p{L}\p{N}])/iu,
};

const DEADLINE = words(
  "aujourd'hui|demain|après-demain|ce soir|cette semaine|la semaine prochaine|semaine prochaine|le mois prochain|fin (?:du mois|de semaine|de la semaine|d'année)|(?:avant|d'ici|pour) (?:le |la )?(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|fin|demain)[^,.;]{0,20}|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain)?|le \\d{1,2}(?: (?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre))?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?",
);

const OWNER = new RegExp(
  `(?<!${L})(\\p{Lu}\\p{Ll}+)\\s+(?:va|doit|devra|s'en occupe|se charge|prend|prépare|envoie|relance)(?!${L})`,
  "u",
);
const FIRST_PERSON = words("je vais|je m'en occupe|je me charge|je prends|je dois");

export function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 3);
}

export function analyzeHeuristic(transcript, notes = "") {
  const out = emptyAnalysis();
  const sentences = splitSentences(`${transcript} ${notes}`);
  const seen = new Set();

  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (RE.question.test(sentence)) {
      out.questions.push({ question: sentence, statut: "ouverte", reponse: "" });
    } else if (RE.decision.test(sentence)) {
      out.decisions.push({ decision: sentence, contexte: "" });
    } else if (RE.action.test(sentence)) {
      const owner = sentence.match(OWNER)?.[1] ?? (FIRST_PERSON.test(sentence) ? "Moi" : "");
      out.actions.push({
        tache: sentence,
        responsable: owner,
        echeance: sentence.match(DEADLINE)?.[0] ?? "",
      });
    } else if (RE.idee.test(sentence)) {
      out.idees.push({ idee: sentence, auteur: "" });
    } else if (RE.info.test(sentence)) {
      out.informations.push({ sujet: guessTopic(sentence), detail: sentence });
    }
  }

  const total = sentences.length;
  out.resume = total
    ? `Analyse locale par mots-clés de ${total} phrase(s) : ${out.decisions.length} décision(s), ${out.actions.length} action(s), ${out.idees.length} idée(s), ${out.informations.length} information(s), ${out.questions.length} question(s). Configurez ANTHROPIC_API_KEY pour une analyse contextuelle plus fiable.`
    : "Transcription vide : rien à analyser.";
  return out;
}

function guessTopic(sentence) {
  const match = sentence.match(RE.info);
  if (match && /[a-z]/i.test(match[0]) && match[0].length > 2) {
    return match[0][0].toUpperCase() + match[0].slice(1).toLowerCase();
  }
  return "Donnée";
}

export async function analyze(transcript, notes = "") {
  if (claudeAvailable()) {
    return { engine: "claude", analysis: await analyzeWithClaude(transcript, notes) };
  }
  return { engine: "local", analysis: analyzeHeuristic(transcript, notes) };
}
