import { createHmac } from "node:crypto";

function normalizeHost(rawHost) {
  const value = String(rawHost ?? "").trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/+$/, "");
  }
  return `https://${value.replace(/\/+$/, "")}`;
}

function buildRecognizeUrl(host) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    throw new Error("ACRCloud host is not configured");
  }
  return new URL("/v1/identify", normalizedHost);
}

function buildSignature({ accessKey, accessSecret, timestamp, dataType }) {
  const stringToSign = [
    "POST",
    "/v1/identify",
    accessKey,
    dataType,
    "1",
    String(timestamp)
  ].join("\n");

  return createHmac("sha1", accessSecret)
    .update(stringToSign)
    .digest("base64");
}

function pickPrimaryArtist(musicEntry) {
  if (!Array.isArray(musicEntry?.artists) || musicEntry.artists.length === 0) return null;
  return String(musicEntry.artists[0]?.name ?? "").trim() || null;
}

function parseRecognitionPayload(body) {
  const musicEntry = Array.isArray(body?.metadata?.music) ? body.metadata.music[0] : null;
  if (!musicEntry?.title) return null;

  return {
    title: String(musicEntry.title).trim(),
    artist: pickPrimaryArtist(musicEntry),
    album: String(musicEntry?.album?.name ?? "").trim() || null,
    confidence: Number.isFinite(Number(musicEntry?.score)) ? Number(musicEntry.score) : null,
    acrid: String(musicEntry?.acrid ?? "").trim() || null,
    raw: body
  };
}

export async function recognizeWithAcrCloud({
  host,
  accessKey,
  accessSecret,
  audioBuffer,
  contentType = "audio/wav",
  filename = "sample.wav",
  fetchImpl = fetch,
  timeoutMs = 15000
}) {
  if (!accessKey || !accessSecret) {
    throw new Error("ACRCloud credentials are not configured");
  }

  const identifyUrl = buildRecognizeUrl(host);
  const timestamp = Math.floor(Date.now() / 1000);
  const dataType = "audio";
  const signature = buildSignature({
    accessKey,
    accessSecret,
    timestamp,
    dataType
  });

  const form = new FormData();
  form.set("access_key", accessKey);
  form.set("sample_bytes", String(audioBuffer.length));
  form.set("timestamp", String(timestamp));
  form.set("signature", signature);
  form.set("data_type", dataType);
  form.set("signature_version", "1");
  form.set("sample", new Blob([audioBuffer], { type: contentType }), filename);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(identifyUrl, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("ACRCloud request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new Error(`ACRCloud request failed: ${response.status}`);
  }

  const statusCode = String(body?.status?.code ?? "");
  if (statusCode === "3003" || statusCode === "1001" || statusCode === "2004") {
    return null;
  }

  if (statusCode !== "0") {
    const message = String(body?.status?.msg ?? "").trim();
    throw new Error(message || "ACRCloud recognition failed");
  }

  return parseRecognitionPayload(body);
}
