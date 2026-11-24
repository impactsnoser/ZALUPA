import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const BACKEND = new URL("https://zalupa-production-8e1dec14.up.railway.app");
const PORT = Number(process.env.PORT || 8443);
const HOST = process.env.HOST || "0.0.0.0";

const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function proxyApi(req, res) {
  const headers = { ...req.headers, host: BACKEND.host };
  delete headers["content-length"];
  const upstream = httpsRequest(
    new URL(req.url || "/api", BACKEND),
    { method: req.method, headers },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    console.error("API proxy error:", error.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: "Backend API is temporarily unavailable" }));
    } else {
      res.destroy(error);
    }
  });
  req.pipe(upstream);
}

async function serveFile(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  const relative = decoded.replace(/^\/+/, "");
  let file = resolve(ROOT, relative || "index.html");
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = resolve(file, "index.html");
    await stat(file);
  } catch {
    // Client-side routes fall back to the app shell; missing asset URLs stay 404.
    if (extname(file)) {
      res.writeHead(404).end("Not found");
      return;
    }
    file = resolve(ROOT, "index.html");
  }

  const cache = file.endsWith("index.html")
    ? "no-store, no-cache, must-revalidate"
    : "public, max-age=31536000, immutable";
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  void serveFile(req, res, pathname).catch((error) => {
    console.error("Static file error:", error.message);
    if (!res.headersSent) res.writeHead(500).end("Internal server error");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NEXORA frontend and API proxy listening on ${HOST}:${PORT}`);
});
