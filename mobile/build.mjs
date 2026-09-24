// Construit l'app web embarquée dans l'APK (dossier www/).
// Le code partagé avec le PC (public/, src/) est importé et empaqueté ici.
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });
await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110"],
  outfile: "www/app.js",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
await copyFile("src/index.html", "www/index.html");
await copyFile("src/style.css", "www/style.css");
