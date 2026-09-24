// App mobile Notes Réunion : fonctionne seule (micro du téléphone) ou
// connectée au PC, qui capte alors le son de la réunion.
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { formatTime, toCsv, toMarkdown, transcriptText } from "../../public/export.js";
import { MeetingCapture, isHallucination } from "../../public/recorder.js";
import { renderTables } from "../../public/tables.js";
import { PcLink, PcNotes, parsePairing } from "./pc.js";
import { scanQr } from "./scanner.js";
import { Services } from "./services.js";
import { LocalNotes, loadSettings, saveSettings } from "./storage.js";

const SEGMENT_SECONDS = 20;
const LIVE_ANALYSIS_SECONDS = 90;
const CLIENT_ID = crypto.randomUUID();

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(
  [
    "back", "view-title", "link-chip", "open-settings", "view-list", "view-note", "view-settings",
    "new-local", "new-pc", "pc-section", "pc-list", "local-list", "list-status",
    "title", "note-where", "record", "timer", "meter-bar", "pc-controls", "pc-record", "pc-state",
    "auto-analyze", "services", "rec-status", "content", "analyze", "analysis-status", "summary", "tables",
    "transcript", "transcript-count", "share-md", "share-csv", "delete-note",
    "pair-status", "scan", "manual-url", "manual-token", "manual-connect", "unpair",
    "anthropic-key", "whisper-key", "whisper-url", "whisper-model", "save-keys", "keys-status", "toast",
  ].map((id) => [id.replace(/-(\w)/g, (_, c) => c.toUpperCase()), $(id)]),
);

let settings = loadSettings();
const link = new PcLink(CLIENT_ID);
const stores = { local: new LocalNotes(), pc: new PcNotes(link) };
const services = new Services(link, () => settings);

const state = {
  view: "list",
  where: null, // "local" | "pc"
  note: null,
  saveTimer: null,
  capture: null,
  uploads: Promise.resolve(),
  pendingUploads: 0,
  analyzing: false,
  analyzedSignature: -1,
  lastLiveAnalysis: 0,
  tickTimer: null,
  offset: 0,
};

// ---------------------------------------------------------------------------
// Utilitaires d'affichage

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle("error", isError);
}

let toastTimer;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function renderChip() {
  const labels = {
    off: "📱 Téléphone seul",
    searching: "💻 Recherche du PC…",
    online: "💻 PC connecté",
    offline: "💻 PC injoignable",
  };
  el.linkChip.textContent = labels[link.status];
  el.linkChip.className = `chip ${link.status === "online" ? "online" : link.status === "offline" ? "offline" : ""}`;
}

// ---------------------------------------------------------------------------
// Navigation (#/, #/note/<local|pc>/<id>, #/settings)

async function route() {
  const [, view, where, id] = location.hash.split("/");
  if (state.capture && !(view === "note" && where === state.where && id === state.note?.id)) {
    // Pas de changement d'écran pendant l'enregistrement.
    history.replaceState(null, "", `#/note/${state.where}/${state.note.id}`);
    toast("Arrêtez l'enregistrement avant de quitter la note.");
    return;
  }
  await flushSave();
  if (view === "note" && stores[where] && id) return showNote(where, id);
  if (view === "settings") return showSettings();
  return showList();
}

function showView(name, title) {
  state.view = name;
  for (const v of ["list", "note", "settings"]) el[`view${v[0].toUpperCase()}${v.slice(1)}`].hidden = v !== name;
  el.viewTitle.textContent = title;
  el.back.hidden = name === "list";
  el.openSettings.hidden = name === "settings";
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Liste

async function showList() {
  showView("list", "Notes");
  state.note = null;
  await renderList();
}

async function renderList() {
  el.newPc.hidden = !link.online;
  el.pcSection.hidden = !link.online;
  setStatus(el.listStatus, link.status === "offline"
    ? "PC injoignable : vérifiez que l'application tourne sur le PC et que le téléphone est sur le même réseau (Wi-Fi ou partage de connexion USB)."
    : "");

  el.localList.replaceChildren(...noteItems(await stores.local.list(), "local"));
  if (link.online) {
    try {
      el.pcList.replaceChildren(...noteItems(await stores.pc.list(), "pc"));
    } catch (err) {
      setStatus(el.listStatus, err.message, true);
    }
  }
}

function noteItems(notes, where) {
  if (!notes.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Aucune note";
    return [li];
  }
  return notes.map((n) => {
    const li = document.createElement("li");
    li.textContent = n.title || "Sans titre";
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = formatDate(n.updatedAt);
    li.append(date);
    if (where === "pc" && link.pcState.recording && link.pcState.noteId === n.id) li.classList.add("recording");
    li.addEventListener("click", () => (location.hash = `#/note/${where}/${n.id}`));
    return li;
  });
}

async function createNote(where) {
  const title = `Réunion du ${new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`;
  try {
    const note = await stores[where].create({ title });
    location.hash = `#/note/${where}/${note.id}`;
  } catch (err) {
    toast(err.message);
  }
}

// ---------------------------------------------------------------------------
// Note

async function showNote(where, id) {
  try {
    state.note = await stores[where].get(id);
  } catch (err) {
    toast(err.message);
    location.hash = "#/";
    return;
  }
  state.where = where;
  state.analyzedSignature = -1;
  showView("note", where === "pc" ? "💻 Note du PC" : "📱 Note");
  el.title.value = state.note.title;
  el.content.value = state.note.content;
  setStatus(el.recStatus, "");
  setStatus(el.analysisStatus, "");
  el.timer.textContent = "00:00";
  renderNoteWhere();
  renderRecorder();
  renderTranscript();
  renderAnalysis();
}

function renderNoteWhere() {
  el.noteWhere.textContent = state.where === "pc"
    ? `Stockée sur le PC${link.online ? "" : " (PC injoignable : lecture seule)"} · créée le ${formatDate(state.note.createdAt)}`
    : `Stockée sur ce téléphone · créée le ${formatDate(state.note.createdAt)}`;
}

/** Le PC enregistre cette note : le téléphone l'affiche en direct sans la modifier. */
function pcRecordsThisNote() {
  return state.where === "pc" && link.pcState.recording && link.pcState.noteId === state.note?.id;
}

function isReadOnly() {
  return pcRecordsThisNote() || (state.where === "pc" && !link.online);
}

function renderRecorder() {
  const recording = Boolean(state.capture);
  el.record.textContent = recording ? "■ Arrêter l'enregistrement" : "🎙 Enregistrer avec le micro du téléphone";
  el.record.classList.toggle("active", recording);
  el.record.disabled = isReadOnly();

  el.pcControls.hidden = state.where !== "pc" || !link.online || recording;
  if (!el.pcControls.hidden) {
    const pc = link.pcState;
    if (pcRecordsThisNote()) {
      el.pcRecord.textContent = "■ Arrêter l'enregistrement du PC";
      el.pcState.textContent = "Le PC enregistre la réunion : transcription et tableaux arrivent ici en direct.";
    } else {
      el.pcRecord.textContent = "💻 Enregistrer le son de la réunion sur le PC";
      el.pcState.textContent = !pc.pcOnline
        ? "Ouvrez la page de l'application sur le PC pour l'enregistrer à distance."
        : pc.recording
          ? "Le PC enregistre déjà une autre note."
          : "Capte tous les participants de l'appel. Un clic de confirmation sera demandé sur le PC.";
    }
    el.pcRecord.disabled = !pc.pcOnline || (pc.recording && !pcRecordsThisNote());
  }

  const readOnly = isReadOnly();
  el.title.readOnly = readOnly;
  el.content.readOnly = readOnly;
  el.summary.contentEditable = readOnly ? "false" : "true";
  el.analyze.disabled = readOnly || state.analyzing;
  el.deleteNote.disabled = readOnly || recording;

  const svc = services.describe();
  el.services.textContent = `Transcription : ${
    svc.transcription === "PC" ? "par le PC" : svc.transcription === "direct" ? "directe (clé du téléphone)" : "non configurée"
  } · Analyse : ${svc.analysis}`;
}

function renderTranscript() {
  const segments = state.note.transcript;
  el.transcript.replaceChildren(
    ...segments.map((s) => {
      const p = document.createElement("p");
      const time = document.createElement("time");
      time.textContent = formatTime(s.t);
      p.append(time, document.createTextNode(s.text));
      return p;
    }),
  );
  el.transcriptCount.textContent = segments.length ? `(${segments.length})` : "";
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function renderAnalysis() {
  el.summary.textContent = state.note.analysis.resume ?? "";
  renderTables(el.tables, state.note.analysis, scheduleSave, { readOnly: isReadOnly() });
}

async function reloadNote() {
  const fresh = await stores[state.where].get(state.note.id);
  if (state.note?.id !== fresh.id) return;
  state.note = fresh;
  if (document.activeElement !== el.title) el.title.value = fresh.title;
  if (document.activeElement !== el.content) el.content.value = fresh.content;
  renderTranscript();
  renderAnalysis();
}

// --- Sauvegarde ---------------------------------------------------------------

function scheduleSave() {
  if (isReadOnly()) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 800);
}

async function save() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const { note, where } = state;
  if (!note) return;
  try {
    const { title, content, transcript, analysis } = note;
    await stores[where].update(note.id, { title, content, transcript, analysis });
  } catch (err) {
    toast(`Échec de la sauvegarde : ${err.message}`);
  }
}

async function flushSave() {
  if (state.saveTimer) await save();
}

// --- Enregistrement avec le micro du téléphone ---------------------------------

async function startRecording() {
  if (!services.describe().transcription) {
    setStatus(el.recStatus, link.online
      ? "Le PC n'a pas de transcription configurée : ajoutez TRANSCRIPTION_API_KEY dans son fichier .env, ou une clé de transcription dans les Réglages du téléphone."
      : "Aucune transcription disponible : connectez le PC, ou saisissez une clé de transcription dans les Réglages.", true);
    return;
  }
  const capture = new MeetingCapture({
    source: "mic",
    includeMic: true,
    onEnded: () => state.capture === capture && stopRecording(),
  });
  try {
    setStatus(el.recStatus, "Autorisez l'accès au micro…");
    await capture.start();
  } catch (err) {
    setStatus(el.recStatus, err.name === "NotAllowedError" ? "Accès au micro refusé (Paramètres Android › Applications › Notes Réunion › Autorisations)." : err.message, true);
    return;
  }
  state.capture = capture;
  const last = state.note.transcript.at(-1);
  state.offset = last ? last.t + SEGMENT_SECONDS : 0;
  const offset = state.offset;
  capture.startSegments(SEGMENT_SECONDS, (blob, t) => queueUpload(blob, offset + t));
  // L'écran reste allumé : Android coupe le micro d'une app en arrière-plan.
  KeepAwake.keepAwake().catch(() => {});
  state.lastLiveAnalysis = performance.now();
  state.tickTimer = setInterval(tick, 100);
  renderRecorder();
  updateRecStatus();
}

function tick() {
  const capture = state.capture;
  if (!capture) return;
  el.timer.textContent = formatTime(state.offset + capture.elapsed());
  el.meterBar.style.width = `${Math.min(100, capture.level() * 400)}%`;
  if (el.autoAnalyze.checked && performance.now() - state.lastLiveAnalysis > LIVE_ANALYSIS_SECONDS * 1000) {
    state.lastLiveAnalysis = performance.now();
    runAnalysis({ auto: true });
  }
}

function updateRecStatus() {
  if (!state.capture) return;
  const parts = ["Enregistrement en cours. Laissez l'app ouverte."];
  if (state.pendingUploads) parts.push(`${state.pendingUploads} segment(s) en cours de transcription…`);
  setStatus(el.recStatus, parts.join(" "));
}

function queueUpload(blob, t) {
  state.pendingUploads++;
  updateRecStatus();
  const note = state.note;
  state.uploads = state.uploads.then(async () => {
    try {
      const prompt = note.transcript.slice(-3).map((s) => s.text).join(" ");
      addSegment(note, t, await services.transcribe(blob, prompt));
    } catch (err) {
      setStatus(el.recStatus, `Transcription : ${err.message}`, true);
    } finally {
      state.pendingUploads--;
      updateRecStatus();
    }
  });
}

function addSegment(note, t, text) {
  text = text.trim();
  if (!text || isHallucination(text)) return;
  note.transcript.push({ t, text });
  note.transcript.sort((a, b) => a.t - b.t);
  if (state.note === note) renderTranscript();
  scheduleSave();
}

async function stopRecording() {
  const capture = state.capture;
  if (!capture) return;
  state.capture = null;
  clearInterval(state.tickTimer);
  el.meterBar.style.width = "0";
  KeepAwake.allowSleep().catch(() => {});
  renderRecorder();
  await capture.stop();
  setStatus(el.recStatus, "Enregistrement arrêté. Finalisation de la transcription…");
  await state.uploads;
  setStatus(el.recStatus, "Enregistrement terminé.");
  await flushSave();
  if (el.autoAnalyze.checked) runAnalysis({ auto: true });
}

// --- Enregistrement par le PC (télécommande) ----------------------------------

async function togglePcRecording() {
  const action = pcRecordsThisNote() ? "stop" : "start";
  try {
    await flushSave();
    await link.request("/api/remote", { method: "POST", body: JSON.stringify({ action, noteId: state.note.id }) });
    setStatus(el.recStatus, action === "start"
      ? "Demande envoyée : sur le PC, cliquez « Démarrer maintenant » et choisissez l'onglet ou l'écran de la réunion en cochant « Partager l'audio »."
      : "Arrêt demandé au PC.");
  } catch (err) {
    setStatus(el.recStatus, err.message, true);
  }
}

// --- Analyse ----------------------------------------------------------------

async function runAnalysis({ auto = false } = {}) {
  const note = state.note;
  if (!note || state.analyzing || isReadOnly()) return;
  const transcript = transcriptText(note.transcript);
  const signature = transcript.length + note.content.length;
  if (auto && signature === state.analyzedSignature) return;
  if (!transcript.trim() && !note.content.trim()) {
    if (!auto) setStatus(el.analysisStatus, "Rien à analyser : enregistrez la réunion ou écrivez des notes.", true);
    return;
  }
  state.analyzing = true;
  el.analyze.disabled = true;
  setStatus(el.analysisStatus, "Analyse en cours…");
  try {
    const { engine, analysis } = await services.analyze(transcript, note.content);
    if (state.note !== note) return;
    note.analysis = analysis;
    state.analyzedSignature = signature;
    renderAnalysis();
    scheduleSave();
    const when = new Date().toLocaleTimeString("fr-FR", { timeStyle: "short" });
    setStatus(el.analysisStatus, `Analyse ${engine === "claude" ? "Claude" : "locale"} mise à jour à ${when}.`);
  } catch (err) {
    setStatus(el.analysisStatus, `Analyse impossible : ${err.message}`, true);
  } finally {
    state.analyzing = false;
    el.analyze.disabled = isReadOnly();
  }
}

// --- Partage ------------------------------------------------------------------

function slug(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "note";
}

async function shareFile(filename, content, type) {
  try {
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8,
      });
      await Share.share({ title: state.note.title, files: [uri], dialogTitle: "Partager la note" });
    } else {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (err) {
    if (!/cancel/i.test(err.message)) toast(err.message);
  }
}

// ---------------------------------------------------------------------------
// Réglages

function showSettings() {
  showView("settings", "Réglages");
  el.anthropicKey.value = settings.anthropicKey;
  el.whisperKey.value = settings.whisperKey;
  el.whisperUrl.value = settings.whisperUrl;
  el.whisperModel.value = settings.whisperModel;
  setStatus(el.keysStatus, "");
  renderPairStatus();
}

function renderPairStatus() {
  const p = settings.pairing;
  el.unpair.hidden = !p;
  if (!p) {
    setStatus(el.pairStatus, "Aucun PC associé.");
  } else if (link.online) {
    setStatus(el.pairStatus, `✅ Connecté à ${link.base}. Analyse : ${link.config.claude ? "Claude" : "locale"}, transcription : ${link.config.serverTranscription ? "active" : "non configurée"}.`);
  } else if (link.status === "searching") {
    setStatus(el.pairStatus, "Recherche du PC…");
  } else {
    setStatus(el.pairStatus, `PC associé mais injoignable (${p.urls.join(", ")}). ${link.offlineReason ?? ""}`, true);
  }
}

async function pair(pairing) {
  settings = { ...settings, pairing };
  saveSettings(settings);
  link.setPairing(pairing);
  renderPairStatus();
  const ok = await link.connect();
  renderPairStatus();
  toast(ok ? "PC connecté." : "PC associé, mais injoignable pour l'instant.");
}

async function scanPairing() {
  try {
    const text = await scanQr((t) => Boolean(parsePairing(t)));
    if (text) await pair(parsePairing(text));
  } catch (err) {
    toast(err.name === "NotAllowedError" ? "Accès à la caméra refusé." : err.message);
  }
}

function manualPairing() {
  const url = el.manualUrl.value.trim().replace(/\/+$/, "");
  const token = el.manualToken.value.trim();
  if (!/^https?:\/\/[^/]+$/.test(url) || !token) {
    toast("Saisissez l'adresse (ex. http://192.168.1.20:3000) et la clé.");
    return;
  }
  pair({ urls: [url], token });
}

function saveKeys() {
  settings = {
    ...settings,
    anthropicKey: el.anthropicKey.value.trim(),
    whisperKey: el.whisperKey.value.trim(),
    whisperUrl: el.whisperUrl.value.trim() || "https://api.openai.com/v1/audio/transcriptions",
    whisperModel: el.whisperModel.value.trim() || "whisper-1",
  };
  saveSettings(settings);
  setStatus(el.keysStatus, "Enregistré.");
}

// ---------------------------------------------------------------------------
// Événements du PC

link.addEventListener("status", () => {
  renderChip();
  if (state.view === "list") renderList();
  if (state.view === "note") {
    renderNoteWhere();
    renderRecorder();
    renderAnalysis();
  }
  if (state.view === "settings") renderPairStatus();
});

link.addEventListener("event", async (e) => {
  const event = e.detail;
  if (event.type === "note" && event.source !== CLIENT_ID) {
    if (state.view === "list") return renderList();
    if (state.view === "note" && state.where === "pc" && event.id === state.note?.id) {
      if (event.deleted) {
        toast("Cette note a été supprimée sur le PC.");
        location.hash = "#/";
      } else if (!state.saveTimer && !state.capture && !state.analyzing) {
        await reloadNote().catch(() => {});
      }
    }
  } else if (event.type === "pc-state" || event.type === "pc-online") {
    if (state.view === "list") renderList();
    if (state.view === "note") {
      const wasReadOnly = el.content.readOnly;
      renderRecorder();
      if (wasReadOnly !== isReadOnly()) {
        if (!state.capture) setStatus(el.recStatus, pcRecordsThisNote() ? "" : "Le PC a terminé l'enregistrement.");
        // Fin d'enregistrement sur le PC : on récupère la version finale.
        if (state.where === "pc") await reloadNote().catch(() => {});
        else renderAnalysis();
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Initialisation

function bindEvents() {
  window.addEventListener("hashchange", route);
  el.back.addEventListener("click", () => (location.hash = "#/"));
  el.openSettings.addEventListener("click", () => (location.hash = "#/settings"));
  el.linkChip.addEventListener("click", () => (location.hash = "#/settings"));
  el.newLocal.addEventListener("click", () => createNote("local"));
  el.newPc.addEventListener("click", () => createNote("pc"));

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
  el.pcRecord.addEventListener("click", togglePcRecording);
  el.analyze.addEventListener("click", () => runAnalysis());
  el.shareMd.addEventListener("click", () =>
    shareFile(`${slug(state.note.title)}.md`, toMarkdown(state.note), "text/markdown"));
  el.shareCsv.addEventListener("click", () =>
    shareFile(`${slug(state.note.title)}.csv`, toCsv(state.note), "text/csv"));
  el.deleteNote.addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${state.note.title} » ?`)) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try {
      await stores[state.where].remove(state.note.id);
      location.hash = "#/";
    } catch (err) {
      toast(err.message);
    }
  });

  el.scan.addEventListener("click", scanPairing);
  el.manualConnect.addEventListener("click", manualPairing);
  el.unpair.addEventListener("click", () => {
    if (!confirm("Oublier ce PC ? Il faudra rescanner son QR code.")) return;
    settings = { ...settings, pairing: null };
    saveSettings(settings);
    link.setPairing(null);
    renderPairStatus();
  });
  el.saveKeys.addEventListener("click", saveKeys);

  if (Capacitor.isNativePlatform()) {
    App.addListener("backButton", () => {
      if (state.capture) return toast("Arrêtez l'enregistrement avant de quitter.");
      if (state.view === "list") App.exitApp();
      else location.hash = "#/";
    });
    // Retour dans l'app : le réseau a pu changer (Wi-Fi, câble USB).
    App.addListener("resume", () => settings.pairing && !link.online && link.connect());
  }
}

async function init() {
  bindEvents();
  renderChip();
  if (settings.pairing) {
    link.setPairing(settings.pairing);
  }
  await route();
}

init().catch((err) => toast(err.message));
