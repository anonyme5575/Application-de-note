// Lecture du QR code de jumelage avec la caméra arrière.
import jsQR from "jsqr";

/**
 * Ouvre la caméra dans un panneau plein écran et résout avec le texte du
 * premier QR code accepté par `accept`, ou null si l'utilisateur annule.
 * @param {(text: string) => boolean} accept
 */
export async function scanQr(accept) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 } },
    audio: false,
  });

  const overlay = document.createElement("div");
  overlay.className = "scanner";
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  const hint = document.createElement("p");
  hint.textContent = "Visez le QR code affiché par le PC (bouton « Connecter le téléphone »).";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Annuler";
  const frame = document.createElement("div");
  frame.className = "scanner-frame";
  overlay.append(video, frame, hint, cancel);
  document.body.append(overlay);
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      for (const t of stream.getTracks()) t.stop();
      overlay.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));

    const tick = () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        // Réduit l'image : plus rapide, et suffisant pour un QR code à l'écran.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          if (accept(code.data)) return finish(code.data);
          hint.textContent = "Ce QR code ne vient pas de l'application de notes du PC.";
        }
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}
