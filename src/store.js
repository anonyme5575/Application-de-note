// Stockage des notes dans un fichier JSON local (data/notes.json).
// Les écritures sont sérialisées pour éviter que deux sauvegardes simultanées
// ne s'écrasent, et passent par un fichier temporaire + rename (atomique).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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

export class NoteStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, "notes.json");
    this.dataDir = dataDir;
    this.notes = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.notes) return this.notes;
    try {
      this.notes = JSON.parse(await readFile(this.file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.notes = [];
    }
    return this.notes;
  }

  persist() {
    this.queue = this.queue.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.notes, null, 2));
      await rename(tmp, this.file);
    });
    return this.queue;
  }

  async list() {
    const notes = await this.load();
    return notes
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    const notes = await this.load();
    return notes.find((n) => n.id === id) ?? null;
  }

  async create(fields = {}) {
    const notes = await this.load();
    const now = new Date().toISOString();
    const note = {
      id: randomUUID(),
      title: "Nouvelle note",
      content: "",
      transcript: [],
      analysis: emptyAnalysis(),
      ...pickEditable(fields),
      createdAt: now,
      updatedAt: now,
    };
    notes.push(note);
    await this.persist();
    return note;
  }

  async update(id, fields) {
    const note = await this.get(id);
    if (!note) return null;
    Object.assign(note, pickEditable(fields), { updatedAt: new Date().toISOString() });
    await this.persist();
    return note;
  }

  async remove(id) {
    const notes = await this.load();
    const index = notes.findIndex((n) => n.id === id);
    if (index === -1) return false;
    notes.splice(index, 1);
    await this.persist();
    return true;
  }
}

// Seuls ces champs peuvent être modifiés par le client.
function pickEditable(fields) {
  const out = {};
  if (typeof fields.title === "string") out.title = fields.title.slice(0, 200);
  if (typeof fields.content === "string") out.content = fields.content;
  if (Array.isArray(fields.transcript)) {
    out.transcript = fields.transcript
      .filter((s) => s && typeof s.text === "string")
      .map((s) => ({ t: Number(s.t) || 0, text: s.text }));
  }
  if (fields.analysis && typeof fields.analysis === "object") {
    out.analysis = { ...emptyAnalysis(), ...fields.analysis };
  }
  return out;
}
