import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeHeuristic, splitSentences } from "../src/analyze.js";

const TRANSCRIPT = `Bonjour à tous, on commence la réunion. Le budget du projet est de 45 000 € pour 2026.
On a décidé de lancer la version mobile en premier. Marie va préparer la maquette avant vendredi.
Je vais relancer le client demain. On pourrait aussi ajouter un mode hors ligne.
Est-ce que l'équipe support est prévenue ?`;

test("splitSentences découpe sur la ponctuation et ignore les fragments", () => {
  assert.deepEqual(splitSentences("Oui. Ceci est une phrase. Et une autre ici ?"), [
    "Ceci est une phrase.",
    "Et une autre ici ?",
  ]);
});

test("analyzeHeuristic classe chaque phrase dans le bon tableau", () => {
  const a = analyzeHeuristic(TRANSCRIPT);

  assert.equal(a.decisions.length, 1);
  assert.match(a.decisions[0].decision, /version mobile/);

  assert.equal(a.actions.length, 2);
  const [maquette, relance] = a.actions;
  assert.equal(maquette.responsable, "Marie");
  assert.match(maquette.echeance, /vendredi/);
  assert.equal(relance.responsable, "Moi");
  assert.equal(relance.echeance, "demain");

  assert.equal(a.idees.length, 1);
  assert.match(a.idees[0].idee, /hors ligne/);

  assert.equal(a.informations.length, 1);
  assert.match(a.informations[0].detail, /45 000 €/);
  assert.equal(a.informations[0].sujet, "Budget");

  assert.equal(a.questions.length, 1);
  assert.equal(a.questions[0].statut, "ouverte");

  assert.match(a.resume, /1 décision/);
});

test("analyzeHeuristic dédoublonne et gère une entrée vide", () => {
  assert.equal(analyzeHeuristic("On a décidé de partir. On a décidé de partir.").decisions.length, 1);
  assert.equal(analyzeHeuristic("").resume, "Transcription vide : rien à analyser.");
});
