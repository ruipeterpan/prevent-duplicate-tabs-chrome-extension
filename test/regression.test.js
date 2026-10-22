import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { applyExactMatchFix, tabAddress } from "../extension/exact-match-fix.js";
import { fakeChrome } from "./fake-chrome.js";

const originalSource = await readFile(new URL("../reference/background.original.js", import.meta.url), "utf8");
const calendar = "https://calendar.google.com/calendar/u/0/r";

async function setup({ fixed = true, errors = [] } = {}) {
  const fake = fakeChrome();
  const sandbox = {
    chrome: fake.api, URL, setTimeout: () => 1, clearTimeout() {},
    console: { error: (...args) => errors.push(args), warn() {}, log() {} },
  };
  vm.runInNewContext(originalSource + "\nglobalThis.detector = _; globalThis.statistics = o;", sandbox);
  await sandbox.detector.ready;
  if (fixed) applyExactMatchFix(sandbox.detector, sandbox.statistics, fake.api);
  return { ...fake, detector: sandbox.detector, errors };
}

test("upstream reproduction: Alfred opener + adjacent tab becomes permanently exempt", async () => {
  const f = await setup({ fixed: false });
  f.add(1, "https://example.org/");
  await f.launch(10, calendar, 1);
  await f.launch(11, calendar, 10);
  assert.equal(f.tabs.size, 3);
  assert.equal(f.detector.bypassTabIds.has(11), true);
  await f.detector.processTab(await f.api.tabs.get(11), 11);
  assert.equal(f.tabs.has(11), true);
});

test("the generated Chrome worker installs the patch before initialization", async () => {
  const f = fakeChrome();
  const entry = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  const importLine = 'import { applyExactMatchFix } from "./exact-match-fix.js";';
  assert.ok(entry.startsWith(importLine));
  const sandbox = {
    chrome: f.api, URL, setTimeout: () => 1, clearTimeout() {}, console,
    applyExactMatchFix: (detector, statistics) => applyExactMatchFix(detector, statistics, f.api),
  };
  vm.runInNewContext(entry.replace(importLine, "") + "\nglobalThis.detector = _;", sandbox);
  await sandbox.detector.ready;
  await f.launch(10, calendar);
  await f.launch(11, calendar, 10);
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("fixed: fresh Calendar followed by six Alfred launches leaves one Calendar", async () => {
  const f = await setup();
  f.add(1, "https://example.org/");
  await f.launch(10, calendar, 1);
  for (let id = 11; id < 17; id++) await f.launch(id, calendar, 10);
  assert.deepEqual([...f.tabs.keys()], [1, 10]);
  assert.equal(f.tabs.get(10).active, true);
  assert.equal(f.detector.bypassTabIds.size, 0);
  assert.equal(f.removed.length, 6);
});

test("different accounts, query values, fragments and trailing slashes stay distinct", async () => {
  const f = await setup();
  f.add(10, calendar);
  const distinct = [calendar.replace("/u/0/", "/u/1/"), calendar + "?x=1",
    calendar + "#event", calendar + "/"];
  for (const [i, url] of distinct.entries()) await f.launch(20 + i, url, 10);
  assert.equal(f.tabs.size, 5);
  assert.equal(f.removed.length, 0);
});

test("duplicate can be detected while navigation is still pending", async () => {
  const f = await setup();
  f.add(10, calendar);
  await f.launch(11, calendar, 10, { commit: false });
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("blank creation is checked again when its URL becomes available", async () => {
  const f = await setup();
  f.add(10, calendar);
  const blank = f.add(11, "", { active: true });
  await f.api.tabs.onCreated.emit({ ...blank });
  assert.equal(f.tabs.has(11), true);
  blank.url = calendar;
  await f.api.tabs.onUpdated.emit(11, { url: calendar }, { ...blank });
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("blank creation is checked as soon as a pending destination is exposed", async () => {
  const f = await setup();
  f.add(10, calendar);
  const blank = f.add(11, "", { active: true });
  await f.api.tabs.onCreated.emit({ ...blank });
  blank.pendingUrl = calendar;
  await f.api.tabs.onUpdated.emit(11, { status: "loading" }, { ...blank });
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("overlapping creation and update events retain a stable survivor", async () => {
  const f = await setup();
  f.add(10, calendar, { active: true });
  await Promise.all(Array.from({ length: 20 }, (_, i) => f.launch(i + 20, calendar, 10)));
  assert.deepEqual([...f.tabs.keys()], [10]);
  assert.equal(f.removed.length, 20);
});

test("creation order does not assume tab IDs are chronological", async () => {
  const f = await setup();
  await f.launch(200, calendar);
  await f.launch(100, calendar, 200);
  assert.deepEqual([...f.tabs.keys()], [200]);
});

test("late update from the original tab cannot close the original", async () => {
  const f = await setup();
  f.add(10, calendar);
  const second = f.add(11, calendar);
  await f.api.tabs.onUpdated.emit(10, { status: "complete" }, await f.api.tabs.get(10));
  assert.deepEqual([...f.tabs.keys()], [10]);
  await f.api.tabs.onUpdated.emit(11, { url: calendar }, { ...second });
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("a target navigating away is not mistaken for its previous Calendar URL", async () => {
  const f = await setup();
  f.add(10, calendar, { pendingUrl: "https://example.org/" });
  await f.launch(11, calendar, 10);
  assert.equal(f.tabs.size, 2);
});

test("matching works across windows and restores a minimized target", async () => {
  const f = await setup();
  f.windows.set(2, { id: 2, state: "minimized" });
  f.add(10, calendar, { windowId: 2 });
  await f.launch(11, calendar);
  assert.deepEqual([...f.tabs.keys()], [10]);
  assert.equal(f.windows.get(2).state, "normal");
  assert.equal(f.windows.get(2).focused, true);
  const removeIndex = f.operations.findIndex(op => op[0] === "remove");
  assert.ok(f.operations.slice(0, removeIndex).some(op => op[0] === "activate" && op[1] === 10));
});

test("normal and incognito tabs never deduplicate each other", async () => {
  const f = await setup();
  f.add(10, calendar, { incognito: true });
  await f.launch(11, calendar);
  assert.equal(f.tabs.size, 2);
});

test("current-window scope preserves a match in another window", async () => {
  const f = await setup();
  f.detector.currentSettings.globalSettings.duplicateScope = "current-window";
  f.windows.set(2, { id: 2, state: "normal" });
  f.add(10, calendar, { windowId: 2 });
  await f.launch(11, calendar);
  assert.equal(f.tabs.size, 2);
});

test("disabled prevention leaves duplicates open", async () => {
  const f = await setup();
  f.detector.currentSettings.enabled = false;
  f.add(10, calendar);
  await f.launch(11, calendar, 10);
  assert.equal(f.tabs.size, 2);
});

test("explicit allow-duplicate bypass still works", async () => {
  const f = await setup();
  f.add(10, calendar);
  f.detector.bypassCreateCount = 1;
  await f.launch(11, calendar, 10);
  await f.detector.scanExistingTabs();
  assert.equal(f.tabs.size, 2);
  assert.equal(f.detector.bypassTabIds.has(11), true);
});

test("worker restart handles fresh events without an in-memory URL index", async () => {
  const first = await setup();
  first.add(10, calendar);
  const second = await setup();
  second.add(10, calendar);
  await second.launch(11, calendar, 10);
  assert.deepEqual([...second.tabs.keys()], [10]);
});

test("startup scan and new events share the same queue", async () => {
  const f = await setup();
  f.add(10, calendar);
  f.add(11, calendar);
  await Promise.all([f.detector.scanExistingTabs(), f.launch(12, calendar, 11)]);
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("activation failure leaves both tabs available and does not poison the queue", async () => {
  const f = await setup();
  f.add(10, calendar);
  const update = f.api.tabs.update;
  f.api.tabs.update = async () => { throw new Error("Cannot activate"); };
  const oldConsoleError = console.error;
  console.error = () => {};
  try { await f.launch(11, calendar); } finally { console.error = oldConsoleError; }
  assert.equal(f.tabs.size, 2);
  f.api.tabs.update = update;
  await f.detector.scanExistingTabs();
  assert.deepEqual([...f.tabs.keys()], [10]);
});

test("a survivor that disappears during focus never causes both tabs to be closed", async () => {
  const f = await setup();
  f.add(10, calendar);
  const update = f.api.windows.update;
  f.api.windows.update = async (...args) => { await update(...args); f.tabs.delete(10); };
  await f.launch(11, calendar);
  assert.deepEqual([...f.tabs.keys()], [11]);
});

test("a duplicate that navigates during focus is left open", async () => {
  const f = await setup();
  f.add(10, calendar);
  const update = f.api.windows.update;
  f.api.windows.update = async (...args) => {
    await update(...args);
    f.tabs.get(11).pendingUrl = "https://example.org/";
  };
  await f.launch(11, calendar, undefined, { commit: false });
  assert.equal(f.tabs.size, 2);
});

test("exact matching excludes internal pages and preserves all URL components", () => {
  assert.equal(tabAddress({ url: "chrome://newtab/" }), null);
  assert.equal(tabAddress({ url: calendar, pendingUrl: "about:blank" }), null);
  assert.equal(tabAddress({ url: calendar + "?x=1#event" }), calendar + "?x=1#event");
});
