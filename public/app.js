import { TABLES, formatTime, toCsv, toMarkdown, transcriptText } from "./export.js";
import { BrowserRecognizer, MeetingCapture, isHallucination } from "./recorder.js";

const SEGMENT_SECONDS = 20;
const LIVE_ANALYSIS_SECONDS = 90;

const $ = (id) => document.getElementById(id);
const el = {
  list: $("note-list"), search: $("search"), newNote: $("new-note"), engineInfo: $("engine-info"),
  editor: $("editor"), empty: $("empty"), title: $("title"), content: $("content"),
  saveState: $("save-state"), exportMd: $("export-md"), exportCsv: $("export-csv"), del: $("delete-note"),
  source: $("source"), mode: $("mode"), includeMic: $("include-mic"), autoAnalyze: $("auto-analyze"),
  record: $("record"), timer: $("timer"), meterBar: $("meter-bar"), download: $("download-audio"),
  recStatus: $("rec-status"), transcript: $("transcript"), transcriptCount: $("transcript-count"),
  interim: $("interim"), clearTranscript: $("clear-transcript"),
  analyze: $("analyze"), analysisStatus: $("analysis-status"), summary: $("summary"), tables: $("tables"),
};

const state = {
  config: { claude: false, serverTranscription: false },
  notes: [],
  note: null,
  capture: null,
  recognizer: null,
  uploads: Promise.resolve(),
  pendingUploads: 0,
  analyzing: false,
  analyzedLength: -1,
  saveTimer: null,
  tickTimer: null,
  audioUrl: null,
};

// ---------------------------------------------------------------------------
// API

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle("error", isError);
}

// ---------------------------------------------------------------------------
// Liste des notes

async function refreshList() {
  state.notes = await api("/api/notes");
  renderList();
}

function renderList() {
  const q = el.search.value.trim().toLowerCase();
  el.list.replaceChildren(
    ...state.notes
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .map((n) => {
        const li = document.createElement("li");
        li.textContent = n.title || "Sans titre";
        li.classList.toggle("active", n.id === state.note?.id);
        const date = document.createElement("span");
        date.className = "date";
        date.textContent = new Date(n.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
        li.append(date);
        li.addEventListener("click", () => openNote(n.id));
        return li;
      }),
  );
}

async function openNote(id) {
  if (state.capture) {
    setStatus(el.recStatus, "Arrêtez l'enregistrement avant de changer de note.", true);
    return;
  }
  await flushSave();
  state.note = await api(`/api/notes/${id}`);
  state.analyzedLength = -1;
  el.empty.hidden = true;
  el.editor.hidden = false;
  el.title.value = state.note.title;
  el.content.value = state.note.content;
  el.download.hidden = true;
  setStatus(el.recStatus, "");
  setStatus(el.analysisStatus, "");
  renderTranscript();
  renderAnalysis();
  renderList();
}

async function newNote() {
  if (state.capture) return;
  const title = `Réunion du ${new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`;
  const note = await api("/api/notes", { method: "POST", body: JSON.stringify({ title }) });
  await refreshList();
  await openNote(note.id);
  el.title.select();
}

// ---------------------------------------------------------------------------
// Sauvegarde automatique

function scheduleSave() {
  el.saveState.textContent = "Modifications…";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 800);
}

async function save() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const note = state.note;
  if (!note) return;
  try {
    const saved = await api(`/api/notes/${note.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: note.title, content: note.content, transcript: note.transcript, analysis: note.analysis,
      }),
    });
    el.saveState.textContent = "Enregistré";
    const item = state.notes.find((n) => n.id === note.id);
    if (item) Object.assign(item, { title: saved.title, updatedAt: saved.updatedAt });
    renderList();
  } catch (err) {
    el.saveState.textContent = `Échec de la sauvegarde : ${err.message}`;
  }
}

async function flushSave() {
  if (state.saveTimer) await save();
}

// ---------------------------------------------------------------------------
// Transcription

function renderTranscript() {
  const segments = state.note.transcript;
  el.transcript.replaceChildren(...segments.map(segmentNode));
  el.transcriptCount.textContent = segments.length ? `(${segments.length} segments)` : "";
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function segmentNode(segment) {
  const p = document.createElement("p");
  const time = document.createElement("time");
  time.textContent = formatTime(segment.t);
  p.append(time, document.createTextNode(segment.text));
  return p;
}

function addSegment(t, text) {
  text = text.trim();
  if (!text || isHallucination(text)) return;
  state.note.transcript.push({ t, text });
  state.note.transcript.sort((a, b) => a.t - b.t);
  renderTranscript();
  scheduleSave();
}

function queueUpload(blob, t) {
  state.pendingUploads++;
  updateRecStatus();
  // Envoi séquentiel : la fin du texte précédent sert de contexte au suivant.
  state.uploads = state.uploads.then(async () => {
    try {
      const form = new FormData();
      form.append("audio", blob, "segment.webm");
      form.append("prompt", state.note.transcript.slice(-3).map((s) => s.text).join(" "));
      const { text } = await api("/api/transcribe", { method: "POST", body: form });
      addSegment(t, text);
    } catch (err) {
      setStatus(el.recStatus, `Transcription : ${err.message}`, true);
    } finally {
      state.pendingUploads--;
      updateRecStatus();
    }
  });
}

// ---------------------------------------------------------------------------
// Enregistrement

async function startRecording() {
  const mode = el.mode.value;
  if (mode === "browser" && !BrowserRecognizer.supported()) {
    setStatus(el.recStatus, "La reconnaissance vocale du navigateur n'est disponible que sur Chrome ou Edge.", true);
    return;
  }

  const capture = new MeetingCapture({
    source: el.source.value,
    includeMic: el.includeMic.checked,
    onEnded: () => state.capture === capture && stopRecording(),
  });
  try {
    setStatus(el.recStatus, el.source.value === "meeting"
      ? "Choisissez l'onglet ou l'écran de la réunion et cochez « Partager l'audio »…"
      : "Autorisez l'accès au micro…");
    await capture.start();
  } catch (err) {
    setStatus(el.recStatus, err.name === "NotAllowedError" ? "Partage refusé ou annulé." : err.message, true);
    return;
  }

  state.capture = capture;
  // Reprise d'un enregistrement dans la même note : les horodatages continuent.
  const last = state.note.transcript.at(-1);
  const offset = last ? last.t + SEGMENT_SECONDS : 0;
  state.offset = offset;

  if (mode === "server") {
    capture.startSegments(SEGMENT_SECONDS, (blob, t) => queueUpload(blob, offset + t));
  } else {
    state.recognizer = new BrowserRecognizer({
      onFinal: (text) => addSegment(offset + capture.elapsed(), text),
      onInterim: (text) => (el.interim.textContent = text),
      onError: (error) => setStatus(el.recStatus, `Reconnaissance vocale : ${error}`, true),
    });
    state.recognizer.start();
  }

  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  el.download.hidden = true;
  el.record.textContent = "■ Arrêter";
  el.record.classList.add("active");
  for (const input of [el.source, el.mode, el.includeMic, el.newNote, el.del]) input.disabled = true;
  state.lastLiveAnalysis = performance.now();
  state.tickTimer = setInterval(tick, 100);
  updateRecStatus(capture.warnings.join(" "));
}

function tick() {
  const capture = state.capture;
  if (!capture) return;
  el.timer.textContent = formatTime(state.offset + capture.elapsed());
  el.meterBar.style.width = `${Math.min(100, capture.level() * 400)}%`;
  if (
    el.autoAnalyze.checked &&
    performance.now() - state.lastLiveAnalysis > LIVE_ANALYSIS_SECONDS * 1000
  ) {
    state.lastLiveAnalysis = performance.now();
    runAnalysis({ auto: true });
  }
}

function updateRecStatus(extra = "") {
  if (!state.capture) return;
  const parts = ["Enregistrement en cours."];
  if (el.mode.value === "server") {
    parts.push(`Transcription par segments de ${SEGMENT_SECONDS} s.`);
    if (state.pendingUploads) parts.push(`${state.pendingUploads} segment(s) en cours de transcription…`);
  }
  if (extra) parts.push(extra);
  setStatus(el.recStatus, parts.join(" "));
}

async function stopRecording() {
  const capture = state.capture;
  if (!capture) return;
  state.capture = null;
  clearInterval(state.tickTimer);
  state.recognizer?.stop();
  state.recognizer = null;
  el.interim.textContent = "";
  el.meterBar.style.width = "0";
  el.record.textContent = "● Démarrer l'enregistrement";
  el.record.classList.remove("active");
  for (const input of [el.source, el.mode, el.includeMic, el.newNote, el.del]) input.disabled = false;

  const audio = await capture.stop();
  if (audio.size) {
    state.audioUrl = URL.createObjectURL(audio);
    el.download.hidden = false;
  }

  setStatus(el.recStatus, "Enregistrement arrêté. Finalisation de la transcription…");
  await state.uploads;
  setStatus(el.recStatus, "Enregistrement terminé.");
  await flushSave();
  if (el.autoAnalyze.checked) runAnalysis({ auto: true });
}

function downloadAudio() {
  const a = document.createElement("a");
  a.href = state.audioUrl;
  a.download = `${slug(state.note.title)}.webm`;
  a.click();
}

// ---------------------------------------------------------------------------
// Analyse en tableaux

async function runAnalysis({ auto = false } = {}) {
  const note = state.note;
  const transcript = transcriptText(note.transcript);
  const signature = transcript.length + note.content.length;
  if (state.analyzing) return;
  if (auto && signature === state.analyzedLength) return;
  if (!transcript.trim() && !note.content.trim()) {
    if (!auto) setStatus(el.analysisStatus, "Rien à analyser : enregistrez une réunion ou écrivez des notes.", true);
    return;
  }

  state.analyzing = true;
  el.analyze.disabled = true;
  setStatus(el.analysisStatus, state.config.claude ? "Analyse par Claude en cours…" : "Analyse locale…");
  try {
    const { engine, analysis } = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ transcript, notes: note.content }),
    });
    if (state.note !== note) return; // L'utilisateur a changé de note entre-temps.
    note.analysis = analysis;
    state.analyzedLength = signature;
    renderAnalysis();
    scheduleSave();
    const when = new Date().toLocaleTimeString("fr-FR", { timeStyle: "short" });
    setStatus(el.analysisStatus, `Analyse ${engine === "claude" ? "Claude" : "locale"} mise à jour à ${when}.`);
  } catch (err) {
    setStatus(el.analysisStatus, `Analyse impossible : ${err.message}`, true);
  } finally {
    state.analyzing = false;
    el.analyze.disabled = false;
  }
}

function renderAnalysis() {
  const analysis = state.note.analysis;
  el.summary.textContent = analysis.resume ?? "";
  el.tables.replaceChildren(...TABLES.map((table) => tableBlock(table, analysis)));
}

function tableBlock(table, analysis) {
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
    renderAnalysis();
    scheduleSave();
    el.tables.querySelector(`[data-table="${table.key}"] tbody tr:last-child td`)?.focus();
  });
  head.append(h3, add);

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
      td.contentEditable = "true";
      td.textContent = row[key] ?? "";
      td.addEventListener("input", () => {
        row[key] = td.textContent;
        scheduleSave();
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
      renderAnalysis();
      scheduleSave();
    });
    del.append(btn);
  });

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(t);
  block.append(head, wrap);
  return block;
}

// ---------------------------------------------------------------------------
// Export

function slug(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "note";
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Initialisation

function applyConfig() {
  const { claude, serverTranscription, model } = state.config;
  const serverOption = el.mode.querySelector('option[value="server"]');
  if (!serverTranscription) {
    serverOption.disabled = true;
    serverOption.textContent += " (non configuré)";
    el.mode.value = "browser";
  }
  el.engineInfo.textContent = [
    `Analyse : ${claude ? `Claude (${model})` : "locale par mots-clés"}`,
    `Transcription serveur : ${serverTranscription ? "active" : "non configurée"}`,
  ].join(" · ");
}

function bindEvents() {
  el.newNote.addEventListener("click", newNote);
  el.search.addEventListener("input", renderList);
  el.title.addEventListener("input", () => {
    state.note.title = el.title.value;
    scheduleSave();
  });
  el.content.addEventListener("input", () => {
    state.note.content = el.content.value;
    scheduleSave();
  });
  el.summary.addEventListener("input", () => {
    state.note.analysis.resume = el.summary.textContent;
    scheduleSave();
  });
  el.record.addEventListener("click", () => (state.capture ? stopRecording() : startRecording()));
  el.download.addEventListener("click", downloadAudio);
  el.analyze.addEventListener("click", () => runAnalysis());
  el.clearTranscript.addEventListener("click", () => {
    if (!state.note.transcript.length || !confirm("Effacer toute la transcription de cette note ?")) return;
    state.note.transcript = [];
    renderTranscript();
    scheduleSave();
  });
  el.del.addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${state.note.title} » ?`)) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    await api(`/api/notes/${state.note.id}`, { method: "DELETE" });
    state.note = null;
    el.editor.hidden = true;
    el.empty.hidden = false;
    await refreshList();
    if (state.notes.length) openNote(state.notes[0].id);
  });
  el.exportMd.addEventListener("click", () =>
    download(toMarkdown(state.note), `${slug(state.note.title)}.md`, "text/markdown;charset=utf-8"));
  el.exportCsv.addEventListener("click", () =>
    download(toCsv(state.note), `${slug(state.note.title)}.csv`, "text/csv;charset=utf-8"));
  window.addEventListener("beforeunload", (e) => {
    if (state.capture || state.saveTimer) e.preventDefault();
  });
}

async function init() {
  bindEvents();
  state.config = await api("/api/config");
  applyConfig();
  await refreshList();
  if (state.notes.length) await openNote(state.notes[0].id);
}

init().catch((err) => {
  el.empty.textContent = `Impossible de joindre le serveur : ${err.message}`;
});
