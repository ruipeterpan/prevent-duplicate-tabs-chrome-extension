/* Local patch for the installed Prevent Duplicate Tabs 1.8.2 build.
 * The bundled upstream UI and explicit allow-duplicate commands are retained.
 * Alfred's openerTabId is not evidence of an intentional duplicate.
 */

export function tabAddress(tab, ignoreParameters = false) {
  // A pending destination takes precedence over the page being left behind.
  const address = tab.pendingUrl || tab.url;
  if (!address) return null;
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!ignoreParameters) return address;
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

export function applyExactMatchFix(detector, statistics, api = chrome) {
  let tail = Promise.resolve();
  let sequence = 0;
  const creationOrder = new Map();
  const getTab = id => api.tabs.get(id).catch(() => null);
  const samePrivacyContext = (a, b) => Boolean(a.incognito) === Boolean(b.incognito);

  function enqueue(work) {
    // One queue for tab events AND startup/settings scans. No URL cache or cooldown.
    tail = tail.then(async () => {
      await detector.ready;
      return work();
    }).catch(error => console.error("Exact-match check failed:", error));
    return tail;
  }

  const upstreamSettings = detector.getTabDuplicateSettingsForTab.bind(detector);
  function settingsFor(tab) {
    const address = tabAddress(tab);
    if (!address || !detector.currentSettings?.enabled) return null;
    const settings = upstreamSettings({ ...tab, url: address });
    return settings && {
      ...settings,
      normalizedUrl: tabAddress(tab, settings.ignoreParameters),
    };
  }

  function order(a, b) {
    // Events record actual creation order; pre-existing tabs come first.
    // After a worker restart, IDs are only a deterministic tie-breaker.
    return (creationOrder.get(a.id) ?? 0) - (creationOrder.get(b.id) ?? 0)
      || a.id - b.id;
  }

  function matches(tab, anchor, settings) {
    return tab.id !== undefined
      && samePrivacyContext(tab, anchor)
      && (settings.scopeWindowId === undefined || tab.windowId === settings.scopeWindowId)
      && tabAddress(tab, settings.ignoreParameters) === settings.normalizedUrl;
  }

  async function focus(tab) {
    const window = await api.windows.get(tab.windowId);
    if (window.state === "minimized") {
      await api.windows.update(tab.windowId, { state: "normal" });
    }
    await api.tabs.update(tab.id, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
  }

  async function close(tabId) {
    await api.tabs.remove(tabId);
    // Chrome closes an empty window itself. Never remove a window after a stale
    // emptiness check, which could close a newly opened, unrelated tab.
    try {
      await statistics.incrementTabsClosedCount();
    } catch (error) {
      console.error("Tab closed; statistics update failed:", error);
    }
  }

  async function reconcile(tabId) {
    const anchor = await getTab(tabId);
    if (!anchor || detector.isBypassTab(tabId)) return;
    const settings = settingsFor(anchor);
    if (!settings) return;
    const group = (await api.tabs.query({}))
      .filter(tab => matches(tab, anchor, settings))
      .sort(order);
    if (group.length < 2) return;

    const keepNew = settings.duplicateAction.startsWith("close-old-");
    const survivor = keepNew ? group.at(-1) : group[0];
    const switchToSurvivor = settings.duplicateAction === "close-new-switch-existing"
      || settings.duplicateAction === "close-old-switch-new";
    const activeWillClose = group.some(tab => tab.id !== survivor.id && tab.active);

    // Focus first. If activation fails, leave the duplicate available to the user.
    if (switchToSurvivor || activeWillClose) await focus(survivor);

    for (const candidate of group) {
      if (candidate.id === survivor.id || detector.isBypassTab(candidate.id)) continue;
      // A tab can navigate or disappear while an API call is pending. Re-read
      // both tabs immediately before closing rather than trust the event snapshot.
      const [currentSurvivor, currentCandidate] = await Promise.all([
        getTab(survivor.id), getTab(candidate.id),
      ]);
      if (!currentSurvivor || !matches(currentSurvivor, anchor, settings)) return;
      if (!currentCandidate || !matches(currentCandidate, anchor, settings)) continue;
      await close(candidate.id);
    }
  }

  // Retain only the explicit context-menu bypass. The upstream heuristic treats
  // Alfred URL launches (which also have an opener and adjacent placement) as
  // Chrome's intentional Duplicate Tab command, leaving them exempt indefinitely.
  detector.evaluateNativeTabDuplicate = async () => {};
  detector.resolvePendingNativeTabDuplicate = async () => {};
  detector.pendingNativeDuplicateOpener.clear();
  detector.onTabCreated = tab => {
    if (tab.id === undefined) return Promise.resolve();
    creationOrder.set(tab.id, ++sequence);
    return detector.processTab(tab, tab.id);
  };
  detector.processTab = (_snapshot, tabId) => enqueue(() => reconcile(tabId));
  detector.getTabDuplicateSettingsForTab = settingsFor;
  detector.scanExistingTabs = () => enqueue(async () => {
    if (!detector.currentSettings?.enabled) return;
    const tabs = await api.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) await reconcile(tab.id);
    }
  });
  detector.closeTabAndMaybeWindow = close;
  api.tabs.onRemoved.addListener(id => creationOrder.delete(id));
  api.tabs.onUpdated.addListener((id, change, tab) => {
    // The upstream listener waits for a committed URL or completion. Also check
    // a pending destination when a previously blank tab starts navigating.
    if (change.status === "loading" || change.pendingUrl) {
      return detector.processTab(tab, id);
    }
  });
}
