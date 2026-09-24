// Extracteur local par mots-clés : hors ligne et gratuit, mais bien moins
// fiable que Claude. Sans dépendance, partagé entre le serveur et le mobile.

export function emptyAnalysis() {
  return {
    resume: "",
    decisions: [],
    actions: [],
    idees: [],
    informations: [],
    questions: [],
  };
}

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
