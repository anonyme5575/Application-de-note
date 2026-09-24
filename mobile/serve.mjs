// Sert www/ dans un navigateur pour tester l'app sans téléphone.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT) || 5173;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" };
http
  .createServer(async (req, res) => {
    const file = path.join("www", path.normalize(new URL(req.url, "http://x").pathname).replace(/^(\.\.[/\\])+/, ""));
    const target = (await stat(file).catch(() => null))?.isFile() ? file : "www/index.html";
    res.setHeader("Content-Type", types[path.extname(target)] ?? "application/octet-stream");
    createReadStream(target).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`App mobile (web) : http://127.0.0.1:${port}`));
