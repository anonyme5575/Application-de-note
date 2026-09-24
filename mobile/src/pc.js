// Liaison avec le PC : recherche de l'adresse joignable (Wi-Fi ou partage de
// connexion USB), requêtes authentifiées, événements en direct.

const PING_TIMEOUT_MS = 3000;
const RETRY_MS = 10_000;

export class PcLink extends EventTarget {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.pairing = null;
    this.base = null;
    this.status = "off"; // off | searching | online | offline
    this.config = null;
    this.pcState = { recording: false, noteId: null, pcOnline: 0 };
  }

  get online() {
    return this.status === "online";
  }

  setPairing(pairing) {
    this.disconnect();
    this.pairing = pairing;
    if (pairing) this.connect();
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new Event("status"));
  }

  /** Essaie chaque adresse du PC et garde la première qui répond. */
  async connect() {
    clearTimeout(this.retryTimer);
    if (!this.pairing || this.connecting) return this.online;
    this.connecting = true;
    this.setStatus("searching");
    try {
      for (const url of this.pairing.urls) {
        try {
          const res = await fetch(`${url}/api/ping`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(PING_TIMEOUT_MS),
          });
          if (res.status === 401) throw new PairingError();
          if (!res.ok) continue;
          this.base = url;
          this.config = await this.request("/api/config");
          this.openEvents();
          this.setStatus("online");
          return true;
        } catch (err) {
          if (err instanceof PairingError) throw err;
          // Adresse injoignable (autre réseau) : on essaie la suivante.
        }
      }
      this.markOffline();
      return false;
    } catch (err) {
      this.markOffline(err.message);
      return false;
    } finally {
      this.connecting = false;
    }
  }

  async checkAlive() {
    if (this.checking || !this.base) return;
    this.checking = true;
    try {
      const res = await fetch(`${this.base}/api/ping`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      this.markOffline();
    } finally {
      this.checking = false;
    }
  }

  markOffline(reason = "") {
    this.events?.close();
    this.events = null;
    this.base = null;
    this.offlineReason = reason;
    this.setStatus(this.pairing ? "offline" : "off");
    clearTimeout(this.retryTimer);
    if (this.pairing) this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    this.events?.close();
    this.events = null;
    this.base = null;
    this.pairing = null;
    this.setStatus("off");
  }

  headers() {
    return { Authorization: `Bearer ${this.pairing.token}`, "X-Client-Id": this.clientId };
  }

  async request(path, options = {}) {
    if (!this.base) throw new Error("PC non connecté.");
    let res;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...options,
        headers: {
          ...this.headers(),
          ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        },
        signal: options.signal ?? AbortSignal.timeout(options.timeout ?? 30_000),
      });
    } catch (err) {
      if (err.name !== "TimeoutError") this.markOffline();
      throw new Error(`PC injoignable : ${err.message}`);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  openEvents() {
    this.events?.close();
    // EventSource ne permet pas d'en-têtes : le jeton passe dans l'URL.
    const url = `${this.base}/api/events?token=${encodeURIComponent(this.pairing.token)}`;
    const source = new EventSource(url);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "pc-state" || event.type === "pc-online") {
        this.pcState = { ...this.pcState, ...event };
      }
      this.dispatchEvent(new CustomEvent("event", { detail: event }));
    };
    source.onerror = () => {
      // EventSource réessaie indéfiniment sans jamais signaler la coupure : on
      // vérifie nous-mêmes que le PC répond, sinon on repasse en recherche.
      if (this.events === source) this.checkAlive();
    };
    this.events = source;
  }
}

class PairingError extends Error {
  constructor() {
    super("Le PC refuse la clé de jumelage : rescannez son QR code.");
  }
}

/** Notes stockées sur le PC, même interface que LocalNotes. */
export class PcNotes {
  constructor(link) {
    this.link = link;
  }

  list() {
    return this.link.request("/api/notes");
  }

  get(id) {
    return this.link.request(`/api/notes/${id}`);
  }

  create(fields) {
    return this.link.request("/api/notes", { method: "POST", body: JSON.stringify(fields) });
  }

  update(id, fields) {
    return this.link.request(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify(fields) });
  }

  remove(id) {
    return this.link.request(`/api/notes/${id}`, { method: "DELETE" });
  }
}

/** Lit le contenu d'un QR code de jumelage (affiché par la page du PC). */
export function parsePairing(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.app !== "notes-reunion" || !Array.isArray(data.urls) || typeof data.token !== "string") return null;
  const urls = data.urls.filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
  return urls.length ? { urls, token: data.token } : null;
}
