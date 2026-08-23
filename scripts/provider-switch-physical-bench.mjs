#!/usr/bin/env node
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const args = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4173/side-panel" },
    proxy: { type: "string", default: "" },
    runs: { type: "string", default: "10" },
    rounds: { type: "string", default: "34" },
    timeout: { type: "string", default: "12000" },
    seed: { type: "string", default: String(Date.now()) },
    warmupTarget: { type: "string", default: "" },
    postSwitchWaitMs: { type: "string", default: "160" },
  },
});

const url = args.values.url;
const proxyServer = args.values.proxy || undefined;
const totalRuns = Number(args.values.runs);
const roundsPerRun = Number(args.values.rounds);
const timeoutMs = Number(args.values.timeout);
const seed = Number(args.values.seed);
const warmupTarget = args.values.warmupTarget || undefined;
const postSwitchWaitMs = Number(args.values.postSwitchWaitMs);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(proxyServer ? { proxy: { server: proxyServer } } : {});
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-web-mode-provider]", {
    state: "attached",
    timeout: 15000,
  });

  await page.evaluate(() => {
    const MAX_WAIT_DEFAULT = 12000;
    const STABILITY_MS = 160;

    function readProviders() {
      return [
        ...document.querySelectorAll("[data-web-mode-provider]"),
      ].map((el) => ({
        id: el.getAttribute("data-web-mode-provider"),
        active: el.classList.contains("is-active"),
        failed: el.classList.contains("is-failed"),
      }));
    }

    function getActiveProvider() {
      return readProviders().find((p) => p.active)?.id ?? null;
    }

    function seededRandom(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function percentile(sorted, p) {
      if (!sorted.length) return 0;
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    }

    function runStats(items) {
      const durations = items
        .filter((x) => x.status === "success")
        .map((x) => x.durationMs)
        .sort((a, b) => a - b);
      return {
        successes: items.filter((x) => x.status === "success").length,
        failures: items.filter((x) => x.status !== "success").length,
        medianMs: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        maxMs: durations[durations.length - 1] ?? 0,
      };
    }

    async function switchOnce(targetId, timeoutMs, postSwitchWaitMs) {
      const targetEl = document.querySelector(
        `[data-web-mode-provider="${targetId}"]`
      );
      if (!targetEl) {
        return { targetId, status: "missing", durationMs: 0 };
      }
      if (targetEl.classList.contains("is-active")) {
        return { targetId, status: "already-active", durationMs: 0 };
      }

      const startTs = performance.now();
      targetEl.click();

      const result = await new Promise((resolve) => {
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

      if (result.status === "success" && postSwitchWaitMs > 0) {
        await new Promise((r) => setTimeout(r, postSwitchWaitMs));
      }

      return result;
    }

    async function runSuite({ totalRuns, roundsPerRun, timeoutMs, seed, warmupTarget, postSwitchWaitMs }) {
      const rand = seededRandom(seed);
      const runs = [];
      if (warmupTarget) {
        const warmupTargetEl = document.querySelector(
          `[data-web-mode-provider="${warmupTarget}"]`
        );
        if (warmupTargetEl) {
          await switchOnce(warmupTarget, Math.max(timeoutMs, 120000), 0);
        }
      }
      for (let run = 1; run <= totalRuns; run += 1) {
        const results = [];
        for (let round = 1; round <= roundsPerRun; round += 1) {
          const current = getActiveProvider();
          const all = readProviders();
          const candidates = all.filter((p) => p.id !== current);
          const target = candidates[Math.floor(rand() * candidates.length)];
          if (!target) {
            results.push({
              targetId: current,
              status: "no-candidate",
              durationMs: 0,
            });
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          const measured = await switchOnce(target.id, timeoutMs, postSwitchWaitMs);
          results.push(measured);
        }
        const stats = runStats(results);
        runs.push({ index: run, results, ...stats });
      }

      const successes = runs.flatMap((r) =>
        r.results.filter((x) => x.status === "success")
      );
      const allDurations = successes
        .map((x) => x.durationMs)
        .sort((a, b) => a - b);

      return {
        summary: {
          totalRuns,
          roundsPerRun,
          totalSwitches: runs.reduce((s, r) => s + r.results.length, 0),
          totalSuccesses: successes.length,
          totalFailures: runs.reduce((s, r) => s + r.failures, 0),
          aggregateMedianMs: percentile(allDurations, 50),
          aggregateP95Ms: percentile(allDurations, 95),
          aggregateMaxMs: allDurations[allDurations.length - 1] ?? 0,
        },
        runs,
      };
    }

    window.__providerSwitchSuite = { runSuite, getSuiteState: readProviders };
  });

  const results = await page.evaluate(
    async ({ totalRuns, roundsPerRun, timeoutMs, seed, warmupTarget, postSwitchWaitMs }) => {
      return window.__providerSwitchSuite.runSuite({
        totalRuns,
        roundsPerRun,
        timeoutMs,
        seed,
        warmupTarget,
        postSwitchWaitMs,
      });
    },
    { totalRuns, roundsPerRun, timeoutMs, seed, warmupTarget, postSwitchWaitMs }
  );

  await browser.close();

  const successes = results.runs.flatMap((r) =>
    r.results.filter((x) => x.status === "success")
  );
  const failures = results.runs.flatMap((r) =>
    r.results.filter((x) => x.status !== "success")
  );
  const durations = successes
    .map((x) => x.durationMs)
    .sort((a, b) => a - b);
  const aggregate = {
    totalSwitches: successes.length + failures.length,
    successes: successes.length,
    failures: failures.length,
    minMs: durations[0] ?? 0,
    medianMs: percentile(durations, 50),
    meanMs: durations.length
      ? Number((durations.reduce((s, v) => s + v, 0) / durations.length).toFixed(2))
      : 0,
    p90Ms: percentile(durations, 90),
    p95Ms: percentile(durations, 95),
    maxMs: durations[durations.length - 1] ?? 0,
  };

  console.log(
    JSON.stringify(
      {
        summary: results.summary,
        aggregate,
        runs: results.runs.map((r) => ({
          index: r.index,
          successes: r.successes,
          failures: r.failures,
          medianMs: r.medianMs,
          p95Ms: r.p95Ms,
          maxMs: r.maxMs,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
