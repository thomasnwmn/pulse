import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve("out");
const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
try { await stat(resolve(root, "index.html")); } catch { console.error("Build the dashboard first: npm run build"); process.exit(1); }
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain", ".ico": "image/x-icon", ".zip": "application/zip", ".gz": "application/gzip", ".woff2": "font/woff2" };
const server = createServer(async (request, response) => {
  for (const header of config.headers[0].headers) response.setHeader(header.key, header.value);
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    try { if ((await stat(file)).isDirectory()) file = resolve(file, "index.html"); } catch { if (!extname(file)) file += ".html"; }
    const data = await readFile(file);
    response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    response.setHeader("Content-Length", data.length);
    if (path === "/downloads/manifest.json") response.setHeader("Cache-Control", "no-cache");
    response.writeHead(200); response.end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404); response.end("Not found"); }
});
server.listen(3000, "127.0.0.1", () => console.log("Static dashboard preview: http://127.0.0.1:3000"));
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
