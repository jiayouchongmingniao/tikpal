import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync, spawnSync } from "node:child_process";
import ts from "typescript";

const server = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
const shell = readFileSync(new URL("../deploy/chromium/tikpal-physical-display-prepare.sh", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/components/AmbientScreen.tsx", import.meta.url), "utf8");
function section(source, start, end) {
  assert.ok(source.includes(start) && source.includes(end), `Missing fixture boundary: ${start}`);
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));
function backend(min = "0", max = "100", turzx = false) {
  const commands = [];
  const ctx = vm.createContext({
    DDC_BRIGHTNESS_MIN: min, DDC_BRIGHTNESS_MAX: max, DDCUTIL_BIN: "ddcutil",
    API_MODE: "mpc", TURZX_BRIGHTNESS_COMMAND: "turzx", TURZX_BRIGHTNESS_TIMEOUT_MS: 100,
    system: { display: { brightnessPercent: 45 } }, clampPercent,
    ddcutilArgs: (args) => args,
    readTurzxBrightnessSnapshot: async () => turzx ? { controllable: true, brightnessPercent: 80, transport: "turzx-hid" } : null,
    runCommand: async (cmd) => { commands.push(cmd); return ""; },
    displayBrightnessSnapshotCache: null, displayBrightnessUnavailableUntilMs: 0,
    console: { error() {} }
  });
  vm.runInContext(section(server, "function ddcBrightnessLimits()", "function ddcutilReadCommand")
    + section(server, "async function setDisplayBrightnessPercent(", "function buildRuntimeSnapshot("), ctx);
  return { ctx, commands };
}
const limited = backend("10", "48");
for (const [input, expected] of [[0, 10], [10, 10], [30, 30], [45, 45], [48, 48], [64, 48], [100, 48], [5, 10]]) {
  await limited.ctx.setDisplayBrightnessPercent(input);
  assert.equal(limited.commands.at(-1), `ddcutil setvcp 10 ${expected}`);
  assert.equal(limited.ctx.system.display.brightnessPercent, expected);
  assert.equal(limited.ctx.system.display.maxBrightnessPercent, 48);
}
const ordinary = backend();
const panel207 = backend("10", "45");
await panel207.ctx.setDisplayBrightnessPercent(48);
assert.equal(panel207.commands.at(-1), "ddcutil setvcp 10 45");
assert.equal(panel207.ctx.system.display.maxBrightnessPercent, 45);
await ordinary.ctx.setDisplayBrightnessPercent(100);
assert.equal(ordinary.commands.at(-1), "ddcutil setvcp 10 100");
const hid = backend("10", "48", true);
await hid.ctx.setDisplayBrightnessPercent(80);
assert.equal(hid.commands.at(-1), "turzx set 80");
for (const [min, max] of [["", "48"], ["x", "48"], ["49", "48"], ["0", "101"], ["-1", "48"], ["10.5", "48"]]) {
  const invalid = backend(min, max);
  await assert.rejects(invalid.ctx.setDisplayBrightnessPercent(45), /Invalid/);
  assert.equal(invalid.commands.length, 0);
}

// Exercise the real room side-effect entrypoint with a high preset and a night-level value.
const room = limited.ctx;
room.applySystemAction = ({ value }) => room.setDisplayBrightnessPercent(value);
vm.runInContext(section(server, "async function applyRoomExperienceSideEffects(", "async function applyRoomExperienceAction("), room);
await room.applyRoomExperienceSideEffects({ brightnessPercent: 72 });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(limited.commands.at(-1), "ddcutil setvcp 10 48");
vm.runInContext(section(server, "async function applyBrightnessSafely(", "async function stopSceneSourceSafely("), room);
await room.applyBrightnessSafely(5);
assert.equal(limited.commands.at(-1), "ddcutil setvcp 10 10");

const shellFunction = section(shell, "safe_ddc_values()", "disable_display_power_keys()");
function shellRun(min, max, brightness) {
  return spawnSync("bash", ["-c", `set -e\nlog() { printf '%s\\n' "$*" >&2; }\nrun_optional_ddc() { printf '%s\\n' "$*"; }\n${shellFunction}\nsafe_ddc_values`], {
    encoding: "utf8", env: { ...process.env, TIKPAL_DDC_BRIGHTNESS_MIN: min, TIKPAL_DDC_BRIGHTNESS_MAX: max,
      TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS: brightness, TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST: "50", TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE: "" }
  });
}
for (const [input, expected] of [["0", 10], ["30", 30], ["45", 45], ["48", 48], ["100", 48]]) {
  const result = shellRun("10", "48", input);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`--brief setvcp 10 ${expected}\n`));
}
for (const [min, max] of [["", "48"], ["x", "48"], ["49", "48"], ["0", "101"]]) {
  const result = shellRun(min, max, "45");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
}
assert.ok(shellRun("0", "100", "100").stdout.includes("--brief setvcp 10 100\n"));
assert.ok(shellRun("10", "45", "100").stdout.includes("--brief setvcp 10 45\n"));

// Execute actual gesture and queue code after stripping TS annotations.
const callbacks = [];
const sent = [];
let release;
const firstResponse = new Promise((resolve) => { release = resolve; });
const front = vm.createContext({
  brightnessMin: 10, brightnessMax: 48, brightnessPercent: 45, clampPercent,
  useCallback: (fn) => fn, system: { volume: { percent: 50 }, display: { brightnessPercent: 45, controllable: true } },
  requestStateRef: { current: { brightness: { queued: null, inFlight: false }, volume: { queued: null, inFlight: false } } },
  dragStateRef: { current: null }, adjustCommitTimersRef: { current: {} },
  adjustOverlay: null, setAdjustOverlay: (value) => { front.adjustOverlay = typeof value === "function" ? value(front.adjustOverlay) : value; },
  clearAdjustCommitTimer() {}, ADJUST_COMMIT_DELAY_MS: 1, DRAG_PIXELS_PER_PERCENT: 1, WHEEL_PIXELS_PER_PERCENT: 1,
  window: { setTimeout: (fn) => { callbacks.push(fn); return callbacks.length; } },
  onSystemAction: async (type, value) => { sent.push(value); if (sent.length === 1) await firstResponse;
    return { system: { display: { brightnessPercent: value === 48 ? 47 : value } } }; },
  onPlaybackAction: async (type, value) => ({ system: { volume: { percent: value } } }),
  friendlyError: (msg) => msg, t: (msg) => msg
});
const clampHook = ui.slice(ui.indexOf("  const clampAdjustPercent ="), ui.indexOf("}, [brightnessMin, brightnessMax]);") + "}, [brightnessMin, brightnessMax]);".length);
const gestures = section(ui, "  const dispatchAdjust =", "  function handleAmbientWheelCapture(");
vm.runInContext(ts.transpile(clampHook + gestures, { target: ts.ScriptTarget.ES2022 }), front);
front.startAdjust("brightness", 1, 100);
front.updateAdjust(-500);
assert.equal(front.adjustOverlay.percent, 48);
callbacks.pop()();
front.updateAdjust(500);
front.finishAdjust();
assert.equal(front.adjustOverlay.percent, 10);
release();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(sent, [48, 10]);
front.applyWheelAdjust("brightness", { deltaY: -1000, preventDefault() {}, stopPropagation() {} });
callbacks.pop()();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(front.adjustOverlay.percent, 47, "Use backend response, not requested 48");
front.startAdjust("volume", 2, 100);
front.updateAdjust(-500);
assert.equal(front.adjustOverlay.percent, 100);
front.brightnessMin = 0;
front.brightnessMax = 100;
front.startAdjust("brightness", 3, 100);
front.updateAdjust(-500);
assert.equal(front.adjustOverlay.percent, 100, "Unconfigured devices retain full range");
execFileSync("bash", ["-n", "deploy/chromium/tikpal-physical-display-prepare.sh"]);
console.log("Brightness limits: backend, presets, shell, gestures, queue, response and volume checks passed");
