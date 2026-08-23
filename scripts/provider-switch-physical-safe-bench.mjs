#!/usr/bin/env node
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = parseArgs({
  options: {
    url: { type: "string", default: "http://192.168.10.115:4173/side-panel" },
    proxy: { type: "string", default: "" },
    rounds: { type: "string", default: "34" },
    timeout: { type: "string", default: "30000" },
    seed: { type: "string", default: String(Date.now()) },
    warmupTarget: { type: "string", default: "spotify" },
    out: { type: "string", default: "/tmp/provider-switch-115-safe.jsonl" },
  },
});

const url = args.values.url;
const proxyServer = args.values.proxy || undefined;
const totalRounds = Number(args.values.rounds);
const timeoutMs = Number(args.values.timeout);
let seed = Number(args.values.seed);
const warmupTarget = args.values.warmupTarget || "";
const outPath = args.values.out;

function nextSeed() {
  seed += 1;
  return seed;
}

async function withPage(browser, fn) {
  const context = await browser.newContext(
    proxyServer ? { proxy: { server: proxyServer } } : {}
  );
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function openSidePanel(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-web-mode-provider]", {
    state: "attached",
    timeout: 20000,
  });
}

async function measureSwitch(page, targetId, timeoutMs) {
  return page.evaluate(
    async ({ targetId, timeoutMs }) => {
      const targetEl = document.querySelector(
        `[data-web-mode-provider="${targetId}"]`
      );
      if (!targetEl) return { targetId, status: "missing", durationMs: 0 };
      if (targetEl.classList.contains("is-active"))
        return { targetId, status: "already-active", durationMs: 0 };

      const startTs = performance.now();
      targetEl.click();

      return await new Promise((resolve) => {
        let settled = false;
        const failTextEl = document.querySelector(".web-mode-panel-footer");
        const timer = setTimeout(() => {
          finish({
            targetId,
            status: targetEl.classList.contains("is-failed")
              ? "failed"
              : "timeout",
            durationMs: performance.now() - startTs,
            failText: failTextEl?.textContent ?? null,
          });
        }, timeoutMs);

        function finish(value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          observer.disconnect();
          resolve(value);
        }

        const observer = new MutationObserver(() => {
          if (targetEl.classList.contains("is-active")) {
            finish({
              targetId,
              status: "success",
              durationMs: performance.now() - startTs,
            });
          } else if (targetEl.classList.contains("is-failed")) {
            finish({
              targetId,
              status: "failed",
              durationMs: performance.now() - startTs,
              failText: failTextEl?.textContent ?? null,
            });
          }
        });

        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    },
    { targetId, timeoutMs }
  );
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function summarize(results) {
  const successes = results.filter((r) => r.status === "success");
  const failures = results.filter((r) => r.status !== "success");
  const durations = successes.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    total: results.length,
    successes: successes.length,
    failures: failures.length,
    minMs: durations[0] ?? 0,
    medianMs: percentile(durations, 50),
    meanMs: durations.length
      ? Number(
          (
            durations.reduce((s, v) => s + v, 0) / durations.length
          ).toFixed(2)
        )
      : 0,
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
    maxMs: durations[durations.length - 1] ?? 0,
  };
}

async function main() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const warmupResult = warmupTarget
      ? await withPage(browser, async (page) => {
          await openSidePanel(page);
          return measureSwitch(page, warmupTarget, Math.max(timeoutMs, 120000));
        })
      : null;

    const allResults = [];
    for (let round = 1; round <= totalRounds; round += 1) {
      try {
        const measured = await withPage(browser, async (page) => {
          await openSidePanel(page);
          const providers = await page.$$eval(
            "[data-web-mode-provider]",
            (els) =>
              els.map((el) => ({
                id: el.getAttribute("data-web-mode-provider"),
                active: el.classList.contains("is-active"),
              }))
          );
          const current = providers.find((p) => p.active)?.id ?? null;
          const candidates = providers.filter((p) => p.id !== current);
          if (!candidates.length) {
            return {
              round,
              targetId: current,
              status: "no-candidate",
              durationMs: 0,
              seed: nextSeed(),
            };
          }
          const rng = mulberry32(nextSeed());
          const target =
            candidates[Math.floor(rng() * candidates.length)];
          const result = await measureSwitch(
            page,
            target.id,
            timeoutMs
          );
          return { round, seed, ...result };
        });
        allResults.push(measured);
      } catch (error) {
        allResults.push({
          round,
          targetId: null,
          status: "driver-error",
          durationMs: 0,
          seed,
          error: error?.message ?? String(error),
        });
      }

      fs.appendFileSync(
        outPath,
        JSON.stringify(allResults[allResults.length - 1]) + "\n"
      );
    }

    const summary = summarize(allResults);
    const payload = {
      url,
      warmupTarget,
      timeoutMs,
      warmupResult,
      summary,
      results: allResults,
    };
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

