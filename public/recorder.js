// Capture audio d'une réunion et découpage en segments pour la transcription.
//
// Le son des autres participants d'un appel (Zoom, Teams, Meet…) ne passe pas
// par le micro : il sort des haut-parleurs. Pour le capter, on utilise le
// partage d'écran/onglet du navigateur (getDisplayMedia) avec l'option
// « Partager l'audio », puis on le mixe avec le micro via Web Audio.

// Phrases que Whisper « hallucine » typiquement sur du silence ou du bruit.
const HALLUCINATIONS = [
  /sous-titr(es|age) (réalisés?|fait) par/i,
  /amara\.org/i,
  /merci d'avoir regardé/i,
  /abonnez-vous/i,
  /^\W*(merci|musique)\W*$/i,
];

export function isHallucination(text) {
  return !text.trim() || HALLUCINATIONS.some((re) => re.test(text));
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export class MeetingCapture {
  /**
   * @param {{source: "meeting"|"mic", includeMic: boolean, onEnded: () => void}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.tracks = [];
    this.warnings = [];
  }

  async start() {
    this.ctx = new AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    if (this.opts.source === "meeting") {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Ce navigateur ne permet pas de capturer le son de l'ordinateur. Utilisez Chrome ou Edge.");
      }
      // La vidéo est obligatoire pour que Chrome propose le partage audio.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: "include",
        selfBrowserSurface: "exclude",
      });
      this.tracks.push(...display.getTracks());
      const audioTracks = display.getAudioTracks();
      if (!audioTracks.length) {
        this.stopTracks();
        throw new Error(
          "Aucun son partagé. Relancez et cochez « Partager l'audio » (onglet de la réunion ou écran entier sous Windows).",
        );
      }
      this.connect(new MediaStream(audioTracks));
      // L'utilisateur clique sur « Arrêter le partage » du navigateur.
      for (const track of display.getTracks()) track.addEventListener("ended", () => this.opts.onEnded());
    }

    if (this.opts.source === "mic" || this.opts.includeMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.tracks.push(...mic.getTracks());
        this.connect(mic);
      } catch (err) {
        if (this.opts.source === "mic") {
          this.stopTracks();
          throw new Error(`Accès au micro refusé : ${err.message}`);
        }
        this.warnings.push("Micro inaccessible : seul le son de l'ordinateur est enregistré.");
      }
    }

    this.stream = this.dest.stream;
    this.mimeType = pickMimeType();
    this.levelBuffer = new Float32Array(this.analyser.fftSize);
    this.startedAt = performance.now();

    // Enregistrement complet, téléchargeable à la fin.
    this.fullChunks = [];
    this.fullRecorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : {});
    this.fullRecorder.ondataavailable = (e) => e.data.size && this.fullChunks.push(e.data);
    this.fullRecorder.start(1000);
  }

  connect(stream) {
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.dest);
    node.connect(this.analyser);
  }

  /** Niveau sonore instantané (RMS, 0..1). */
  level() {
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const v of this.levelBuffer) sum += v * v;
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  elapsed() {
    return (performance.now() - this.startedAt) / 1000;
  }

  /**
   * Découpe l'audio en fichiers autonomes de `seconds` secondes.
   * Un MediaRecorder avec timeslice produit des fragments sans en-tête
   * (illisibles seuls) : on redémarre donc un enregistreur par segment.
   */
  startSegments(seconds, onSegment) {
    this.segmenting = true;
    const next = () => {
      if (!this.segmenting) return;
      const startT = this.elapsed();
      const chunks = [];
      let peak = 0;
      const rec = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : {});
      const sampler = setInterval(() => (peak = Math.max(peak, this.level())), 200);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(sampler);
        const blob = new Blob(chunks, { type: rec.mimeType || this.mimeType });
        // Segment silencieux : inutile de l'envoyer (et source d'hallucinations).
        if (blob.size > 0 && peak > 0.01) onSegment(blob, startT);
      };
      rec.start();
      this.segmentTimer = setTimeout(() => {
        next();
        rec.stop();
      }, seconds * 1000);
      this.currentSegment = rec;
    };
    next();
  }

  async stop() {
    this.segmenting = false;
    clearTimeout(this.segmentTimer);
    if (this.currentSegment?.state === "recording") this.currentSegment.stop();
    if (this.fullRecorder?.state === "recording") {
      await new Promise((resolve) => {
        this.fullRecorder.onstop = resolve;
        this.fullRecorder.stop();
      });
    }
    this.stopTracks();
    await this.ctx?.close();
    return new Blob(this.fullChunks, { type: this.mimeType || "audio/webm" });
  }

  stopTracks() {
    for (const t of this.tracks) t.stop();
    this.tracks = [];
  }
}

/**
 * Reconnaissance vocale du navigateur (Web Speech API, Chrome/Edge).
 * Elle écoute uniquement le micro par défaut : les participants distants ne
 * sont captés que si leur voix sort des haut-parleurs et revient dans le micro.
 */
export class BrowserRecognizer {
  static supported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  constructor({ lang = "fr-FR", onFinal, onInterim, onError }) {
    const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.rec = new Impl();
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      onInterim(interim);
    };
    this.rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") onError(e.error);
    };
    // Chrome coupe la reconnaissance après un silence : on la relance.
    this.rec.onend = () => this.running && this.rec.start();
  }

  start() {
    this.running = true;
    this.rec.start();
  }

  stop() {
    this.running = false;
    this.rec.stop();
  }
}
