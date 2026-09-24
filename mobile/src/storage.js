// Notes stockées sur le téléphone (fichier JSON privé de l'app) et réglages.
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { emptyAnalysis } from "../../src/heuristic.js";

const FILE = "notes.json";

export class LocalNotes {
  constructor() {
    this.notes = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.notes) return this.notes;
    try {
      const { data } = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      this.notes = JSON.parse(typeof data === "string" ? data : await data.text());
    } catch {
      this.notes = []; // Premier lancement : pas encore de fichier.
    }
    return this.notes;
  }

  persist() {
    // Écritures sérialisées : deux sauvegardes rapprochées ne s'entremêlent pas.
    const snapshot = JSON.stringify(this.notes);
    this.queue = this.queue.then(() =>
      Filesystem.writeFile({ path: FILE, data: snapshot, directory: Directory.Data, encoding: Encoding.UTF8 }),
    );
    return this.queue;
  }

  async list() {
    const notes = await this.load();
    return notes
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    const note = (await this.load()).find((n) => n.id === id);
    if (!note) throw new Error("Note introuvable");
    return structuredClone(note);
  }

  async create(fields = {}) {
    const now = new Date().toISOString();
    const note = {
      id: crypto.randomUUID(),
      title: "Nouvelle note",
      content: "",
      transcript: [],
      analysis: emptyAnalysis(),
      ...fields,
      createdAt: now,
      updatedAt: now,
    };
    (await this.load()).push(note);
    await this.persist();
    return structuredClone(note);
  }

  async update(id, fields) {
    const notes = await this.load();
    const index = notes.findIndex((n) => n.id === id);
    if (index === -1) throw new Error("Note introuvable");
    const { title, content, transcript, analysis } = fields;
    notes[index] = {
      ...notes[index],
      ...Object.fromEntries(Object.entries({ title, content, transcript, analysis }).filter(([, v]) => v !== undefined)),
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return structuredClone(notes[index]);
  }

  async remove(id) {
    const notes = await this.load();
    const index = notes.findIndex((n) => n.id === id);
    if (index !== -1) notes.splice(index, 1);
    await this.persist();
  }
}

// Réglages : petits, lus au démarrage. localStorage est persistant dans la
// WebView de l'app (effacé seulement avec les données de l'app).
const SETTINGS_KEY = "notes-reunion-settings";

export const DEFAULT_SETTINGS = {
  pairing: null, // { urls: string[], token: string }
  anthropicKey: "",
  whisperUrl: "https://api.openai.com/v1/audio/transcriptions",
  whisperKey: "",
  whisperModel: "whisper-1",
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : les réglages restent valables pour cette session.
  }
}
