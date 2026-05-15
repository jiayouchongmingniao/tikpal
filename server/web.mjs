import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(process.env.TIKPAL_WEB_DIST_DIR ?? path.join(APP_DIR, "dist"));
const HOST = process.env.TIKPAL_WEB_HOST ?? "0.0.0.0";
const PORT = Number(process.env.TIKPAL_WEB_PORT ?? 4173);
const API_ORIGIN = new URL(process.env.TIKPAL_API_ORIGIN ?? "http://127.0.0.1:8787");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function isInsideDist(filePath) {
  const relative = path.relative(DIST_DIR, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveStaticFile(urlPathname) {
  const cleanPath = decodeURIComponent(urlPathname).replace(/^\/+/, "");
  const candidate = path.resolve(DIST_DIR, cleanPath || "index.html");
  if (!isInsideDist(candidate)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return { filePath: candidate, info };
  } catch {
    // Fall through to SPA fallback.
  }

  const fallback = path.resolve(DIST_DIR, "index.html");
  try {
    const info = await stat(fallback);
    return { filePath: fallback, info };
  } catch {
    return null;
  }
}

function proxyApi(request, response) {
  const target = new URL(request.url ?? "/", API_ORIGIN);
  target.protocol = API_ORIGIN.protocol;
  target.hostname = API_ORIGIN.hostname;
  target.port = API_ORIGIN.port;

  const proxyRequest = http.request(
    target,
    {
      method: request.method,
      headers: {
        ...request.headers,
        host: API_ORIGIN.host
      }
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    }
  );

  proxyRequest.on("error", (error) => {
    send(
      response,
      502,
      JSON.stringify({
        error: "API_UNAVAILABLE",
        message: error.message
      }),
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    );
  });

  request.pipe(proxyRequest);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (url.pathname.startsWith("/api/")) {
    proxyApi(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  const file = await resolveStaticFile(url.pathname);
  if (!file) {
    send(response, 503, "Tikpal web build is missing. Run npm run build first.", {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    return;
  }

  const extension = path.extname(file.filePath);
  const isAsset = file.filePath.includes(`${path.sep}assets${path.sep}`);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES.get(extension) ?? "application/octet-stream",
    "Content-Length": file.info.size,
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-store"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(file.filePath).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`tikpal-web serving ${DIST_DIR} on http://${HOST}:${PORT}`);
  console.log(`tikpal-web proxying /api to ${API_ORIGIN.origin}`);
});
