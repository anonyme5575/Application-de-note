// Définition des tableaux et exports (Markdown, CSV). Fonctions pures,
// partagées entre le navigateur et les tests Node.

export const TABLES = [
  { key: "decisions", label: "Décisions", cols: [["decision", "Décision"], ["contexte", "Contexte"]] },
  {
    key: "actions",
    label: "Actions",
    cols: [["tache", "Tâche"], ["responsable", "Responsable"], ["echeance", "Échéance"]],
  },
  { key: "idees", label: "Idées", cols: [["idee", "Idée"], ["auteur", "Auteur"]] },
  { key: "informations", label: "Informations clés", cols: [["sujet", "Sujet"], ["detail", "Détail"]] },
  {
    key: "questions",
    label: "Questions",
    cols: [["question", "Question"], ["statut", "Statut"], ["reponse", "Réponse"]],
  },
];

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function transcriptText(transcript) {
  return transcript.map((s) => `[${formatTime(s.t)}] ${s.text}`).join("\n");
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ") || " ";
}

export function toMarkdown(note) {
  const a = note.analysis ?? {};
  const lines = [`# ${note.title}`, "", `_${new Date(note.createdAt).toLocaleString("fr-FR")}_`, ""];
  if (a.resume) lines.push("## Résumé", "", a.resume, "");
  for (const table of TABLES) {
    const rows = a[table.key] ?? [];
    if (!rows.length) continue;
    lines.push(`## ${table.label}`, "");
    lines.push(`| ${table.cols.map(([, label]) => label).join(" | ")} |`);
    lines.push(`| ${table.cols.map(() => "---").join(" | ")} |`);
    for (const row of rows) lines.push(`| ${table.cols.map(([k]) => mdCell(row[k])).join(" | ")} |`);
    lines.push("");
  }
  if (note.content?.trim()) lines.push("## Notes", "", note.content.trim(), "");
  if (note.transcript?.length) lines.push("## Transcription", "", "```", transcriptText(note.transcript), "```", "");
  return lines.join("\n");
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV unique (séparateur « ; » pour Excel en français), une ligne par élément. */
export function toCsv(note) {
  const a = note.analysis ?? {};
  const rows = [["Catégorie", "Élément", "Détail / Responsable", "Échéance / Statut", "Réponse"]];
  for (const table of TABLES) {
    for (const row of a[table.key] ?? []) {
      const values = table.cols.map(([k]) => row[k] ?? "");
      while (values.length < 4) values.push("");
      rows.push([table.label, ...values]);
    }
  }
  // BOM UTF-8 pour qu'Excel affiche correctement les accents.
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
