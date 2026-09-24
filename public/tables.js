// Rendu des tableaux d'analyse (cellules modifiables), partagé entre la page
// du PC et l'app mobile.
import { TABLES } from "./export.js";

/**
 * @param {HTMLElement} container
 * @param {object} analysis objet modifié en place
 * @param {() => void} onChange appelé après chaque modification
 * @param {{readOnly?: boolean}} [options]
 */
export function renderTables(container, analysis, onChange, options = {}) {
  const rerender = () => renderTables(container, analysis, onChange, options);
  container.replaceChildren(
    ...TABLES.map((table) => tableBlock(table, analysis, onChange, rerender, options.readOnly)),
  );
}

function tableBlock(table, analysis, onChange, rerender, readOnly) {
  const rows = (analysis[table.key] ??= []);
  const block = document.createElement("div");
  block.className = "table-block";

  const head = document.createElement("div");
  head.className = "panel-head";
  const h3 = document.createElement("h3");
  h3.textContent = table.label;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = rows.length;
  h3.append(badge);
  const add = document.createElement("button");
  add.className = "btn small";
  add.type = "button";
  add.textContent = "+ Ajouter";
  add.addEventListener("click", () => {
    rows.push(Object.fromEntries(table.cols.map(([k]) => [k, ""])));
    rerender();
    onChange();
    block.ownerDocument.querySelector(`[data-table="${table.key}"] tbody tr:last-child td`)?.focus();
  });
  head.append(h3);
  if (!readOnly) head.append(add);

  const t = document.createElement("table");
  t.dataset.table = table.key;
  const thead = t.createTHead().insertRow();
  for (const [, label] of table.cols) {
    const th = document.createElement("th");
    th.textContent = label;
    thead.append(th);
  }
  thead.append(document.createElement("th"));

  const tbody = t.createTBody();
  if (!rows.length) {
    const td = tbody.insertRow().insertCell();
    td.colSpan = table.cols.length + 1;
    td.className = "empty-row";
    td.textContent = "Aucun élément";
  }
  rows.forEach((row, index) => {
    const tr = tbody.insertRow();
    for (const [key] of table.cols) {
      const td = tr.insertCell();
      td.contentEditable = readOnly ? "false" : "true";
      td.textContent = row[key] ?? "";
      td.addEventListener("input", () => {
        row[key] = td.textContent;
        onChange();
      });
    }
    const del = tr.insertCell();
    del.className = "del";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Supprimer la ligne";
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      rows.splice(index, 1);
      rerender();
      onChange();
    });
    if (!readOnly) del.append(btn);
  });

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(t);
  block.append(head, wrap);
  return block;
}
