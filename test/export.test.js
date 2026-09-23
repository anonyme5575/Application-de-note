import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTime, toCsv, toMarkdown } from "../public/export.js";
import { isHallucination } from "../public/recorder.js";

const note = {
  title: "Point hebdo",
  createdAt: "2026-09-23T10:00:00.000Z",
  content: "Participants : Marie, Paul",
  transcript: [{ t: 65, text: "On valide le budget." }],
  analysis: {
    resume: "Budget validé.",
    decisions: [{ decision: "Budget | validé", contexte: "" }],
    actions: [{ tache: 'Envoyer le "devis"', responsable: "Paul", echeance: "lundi; matin" }],
    idees: [],
    informations: [],
    questions: [],
  },
};

test("formatTime", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(3725), "1:02:05");
});

test("toMarkdown produit des tableaux et échappe les barres verticales", () => {
  const md = toMarkdown(note);
  assert.match(md, /^# Point hebdo/);
  assert.match(md, /\| Décision \| Contexte \|/);
  assert.match(md, /Budget \\\| validé/);
  assert.match(md, /\[01:05\] On valide le budget\./);
  assert.doesNotMatch(md, /## Idées/);
});

test("toCsv utilise ; et échappe les guillemets", () => {
  const lines = toCsv(note).replace(/^﻿/, "").split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], 'Actions;"Envoyer le ""devis""";Paul;"lundi; matin";');
});

test("isHallucination filtre les sous-titres fantômes de Whisper", () => {
  assert.ok(isHallucination("Sous-titres réalisés par la communauté d'Amara.org"));
  assert.ok(isHallucination("  "));
  assert.ok(!isHallucination("Merci Paul pour le point sur le budget."));
});
