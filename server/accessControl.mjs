import { timingSafeEqual } from "node:crypto";

export const TIKPAL_KEY_HEADER = "x-tikpal-key";

const SAFE_REMOTE_GET_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/system/health",
  "/api/v1/remote/state",
  "/api/v1/remote/catalog",
  "/api/v1/openapi.json",
  "/api/v1/swagger.json",
  "/api/v1/docs",
  "/api/v1/media/artwork",
  "/api/v1/media/library-cover"
]);

export function normalizeRemoteAddress(address) {
  const value = String(address ?? "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length);
  if (value === "0:0:0:0:0:0:0:1") return "::1";
  return value;
}

export function isLoopbackRemoteAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function getHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const lowerName = name.toLowerCase();
  const value = headers[lowerName] ?? headers[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function constantTimeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function hasValidTikpalKey(headers, portableApiKey = process.env.TIKPAL_PORTABLE_API_KEY ?? "") {
  const expected = String(portableApiKey ?? "").trim();
  if (!expected) return false;
  const actual = String(getHeader(headers, TIKPAL_KEY_HEADER) ?? "").trim();
  if (!actual) return false;
  return constantTimeEqual(actual, expected);
}

export function isSafeRemoteApiRead(method, pathname) {
  return String(method ?? "").toUpperCase() === "GET" && SAFE_REMOTE_GET_PATHS.has(String(pathname ?? ""));
}

export function isRemoteActionRequest(method, pathname) {
  return String(method ?? "").toUpperCase() === "POST" && String(pathname ?? "") === "/api/v1/remote/actions";
}

export function getTikpalApiAccessDecision({
  method,
  pathname,
  headers,
  remoteAddress,
  portableApiKey = process.env.TIKPAL_PORTABLE_API_KEY ?? ""
}) {
  const normalizedMethod = String(method ?? "GET").toUpperCase();
  const normalizedPath = String(pathname ?? "");

  if (normalizedMethod === "OPTIONS") {
    return { allowed: true, reason: "cors_preflight", local: false };
  }

  if (isLoopbackRemoteAddress(remoteAddress)) {
    return { allowed: true, reason: "loopback", local: true };
  }

  if (isSafeRemoteApiRead(normalizedMethod, normalizedPath)) {
    return { allowed: true, reason: "safe_remote_read", local: false };
  }

  if (isRemoteActionRequest(normalizedMethod, normalizedPath)) {
    if (hasValidTikpalKey(headers, portableApiKey)) {
      return { allowed: true, reason: "keyed_remote_action", local: false };
    }

    const configured = String(portableApiKey ?? "").trim().length > 0;
    return {
      allowed: false,
      status: 403,
      error: "FORBIDDEN",
      message: configured
        ? "X-Tikpal-Key is required for portable remote actions"
        : "TIKPAL_PORTABLE_API_KEY is not configured on this device"
    };
  }

  return {
    allowed: false,
    status: 403,
    error: "FORBIDDEN",
    message: "This API path is only available to the local kiosk UI. Use /api/v1/remote/* from a portable controller."
  };
}

export function buildAccessDeniedBody(decision) {
  return {
    error: decision?.error ?? "FORBIDDEN",
    message: decision?.message ?? "Request is not allowed from this client"
  };
}
