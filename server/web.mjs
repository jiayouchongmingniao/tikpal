import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIKPAL_KEY_HEADER,
  buildAccessDeniedBody,
  getTikpalWebProxyApiAccessDecision,
  isLoopbackRemoteAddress
} from "./accessControl.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(process.env.TIKPAL_WEB_DIST_DIR ?? path.join(APP_DIR, "dist"));
const HOST = process.env.TIKPAL_WEB_HOST ?? "0.0.0.0";
const PORT = Number(process.env.TIKPAL_WEB_PORT ?? 4173);
const API_ORIGIN = new URL(process.env.TIKPAL_API_ORIGIN ?? "http://127.0.0.1:8787");
const PORTABLE_API_KEY = process.env.TIKPAL_PORTABLE_API_KEY ?? "";
const ALLOW_REMOTE_UI_API = process.env.TIKPAL_WEB_ALLOW_REMOTE_UI_API ?? "0";
const REMOTE_MODE_INJECTION = "<script>window.__TIKPAL_REMOTE_MODE__=true;</script>";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp4", "video/mp4"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function getRequestHostName(request) {
  const rawHost = String(request.headers.host ?? "").trim().toLowerCase();
  if (!rawHost) return "";

  if (rawHost.startsWith("[")) {
    const closeIndex = rawHost.indexOf("]");
    return (closeIndex === -1 ? rawHost.slice(1) : rawHost.slice(1, closeIndex)).replace(/\.$/, "");
  }

  const lastColonIndex = rawHost.lastIndexOf(":");
  const hasSingleColon = lastColonIndex !== -1 && rawHost.indexOf(":") === lastColonIndex;
  return (hasSingleColon ? rawHost.slice(0, lastColonIndex) : rawHost).replace(/\.$/, "");
}

function isRemoteBrowserClient(request) {
  const hostName = getRequestHostName(request);
  return !isLoopbackRemoteAddress(request.socket.remoteAddress)
    || (hostName !== "" && !isLoopbackRemoteAddress(hostName));
}

function getAccessControlRemoteAddress(request) {
  if (!isLoopbackRemoteAddress(request.socket.remoteAddress)) return request.socket.remoteAddress;

  const hostName = getRequestHostName(request);
  return hostName !== "" && !isLoopbackRemoteAddress(hostName)
    ? hostName
    : request.socket.remoteAddress;
}

function allowsFullRemoteUi() {
  return String(ALLOW_REMOTE_UI_API ?? "0").trim() === "1";
}

function shouldServeRemoteControl(request) {
  return isRemoteBrowserClient(request) && !allowsFullRemoteUi();
}

function isRemoteActionProxyRequest(request, pathname) {
  return isRemoteBrowserClient(request)
    && String(request.method ?? "").toUpperCase() === "POST"
    && pathname === "/api/v1/remote/actions";
}

function maybeInjectPortableKey(request, pathname) {
  const headers = { ...request.headers };
  if (
    isRemoteActionProxyRequest(request, pathname)
    && PORTABLE_API_KEY.trim()
    && !headers[TIKPAL_KEY_HEADER]
  ) {
    headers[TIKPAL_KEY_HEADER] = PORTABLE_API_KEY.trim();
  }
  return headers;
}

function isInsideDist(filePath) {
  const relative = path.relative(DIST_DIR, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseRangeHeader(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
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
  const proxyHeaders = maybeInjectPortableKey(request, target.pathname);
  const accessDecision = getTikpalWebProxyApiAccessDecision({
    method: request.method,
    pathname: target.pathname,
    headers: proxyHeaders,
    remoteAddress: getAccessControlRemoteAddress(request),
    portableApiKey: PORTABLE_API_KEY,
    allowRemoteUiApi: ALLOW_REMOTE_UI_API
  });

  if (!accessDecision.allowed) {
    send(
      response,
      accessDecision.status ?? 403,
      JSON.stringify(buildAccessDeniedBody(accessDecision)),
      {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tikpal-Key,X-Tikpal-Local-Ui"
      }
    );
    return;
  }

  target.protocol = API_ORIGIN.protocol;
  target.hostname = API_ORIGIN.hostname;
  target.port = API_ORIGIN.port;

  const proxyRequest = http.request(
    target,
    {
      method: request.method,
      headers: {
        ...proxyHeaders,
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

async function sendHtmlEntry(request, response, file, commonHeaders) {
  let body = await readFile(file.filePath, "utf8");
  if (shouldServeRemoteControl(request)) {
    body = body.includes("</head>")
      ? body.replace("</head>", `${REMOTE_MODE_INJECTION}</head>`)
      : `${REMOTE_MODE_INJECTION}${body}`;
  }

  const payload = Buffer.from(body);
  response.writeHead(200, {
    ...commonHeaders,
    "Content-Length": payload.length
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  response.end(payload);
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
  const isMutableMedia = extension === ".mp4";
  const commonHeaders = {
    "Content-Type": MIME_TYPES.get(extension) ?? "application/octet-stream",
    "Cache-Control": isMutableMedia ? "no-store" : isAsset ? "public, max-age=31536000, immutable" : "no-store"
  };

  if (extension === ".html") {
    await sendHtmlEntry(request, response, file, commonHeaders);
    return;
  }

  if (isMutableMedia) {
    commonHeaders["Accept-Ranges"] = "bytes";
    const requestedRange = request.headers.range;
    if (requestedRange) {
      const range = parseRangeHeader(requestedRange, file.info.size);
      if (!range) {
        response.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${file.info.size}`
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        ...commonHeaders,
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${file.info.size}`
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      createReadStream(file.filePath, range).pipe(response);
      return;
    }
  }

  response.writeHead(200, {
    ...commonHeaders,
    "Content-Length": file.info.size
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
