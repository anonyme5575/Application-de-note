// Jumelage du téléphone : jeton secret persistant + adresses réseau du PC,
// encodés dans un QR code que l'app mobile scanne.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";

export async function loadOrCreateToken(dataDir) {
  const file = path.join(dataDir, "pairing.json");
  try {
    const { token } = JSON.parse(await readFile(file, "utf8"));
    if (typeof token === "string" && token.length >= 32) return token;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const token = randomBytes(24).toString("base64url");
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, JSON.stringify({ token }), { mode: 0o600 });
  return token;
}

export function tokenMatches(expected, given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Adresses IPv4 du PC joignables par le téléphone : Wi-Fi/Ethernet, et
 * l'interface créée par le partage de connexion USB du téléphone.
 */
export function lanUrls(port) {
  const urls = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      // Interfaces virtuelles (Docker, VPN, WSL) : rarement joignables par le téléphone.
      const virtual = /docker|veth|br-|vmnet|vbox|virtualbox|wsl|tun|tap|utun|zt|tailscale/i.test(name);
      urls.push({ url: `http://${addr.address}:${port}`, name, virtual });
    }
  }
  // Les réseaux privés classiques d'abord, les interfaces virtuelles en dernier.
  const rank = (u) => (u.virtual ? 2 : /^http:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(u.url) ? 0 : 1);
  return urls.sort((a, b) => rank(a) - rank(b)).map(({ url, name }) => ({ url, name }));
}

export const PAIRING_APP_ID = "notes-reunion";

export function pairingPayload(urls, token) {
  return JSON.stringify({ app: PAIRING_APP_ID, v: 1, urls: urls.map((u) => u.url), token });
}

export function qrSvg(text) {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}
