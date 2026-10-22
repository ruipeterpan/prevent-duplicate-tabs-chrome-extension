export function event() {
  const listeners = [];
  return {
    addListener: listener => listeners.push(listener),
    async emit(...args) { await Promise.all(listeners.map(listener => listener(...args))); },
  };
}

export function fakeChrome() {
  const tabs = new Map();
  const windows = new Map([[1, { id: 1, state: "normal" }]]);
  const removed = [];
  const operations = [];
  const settings = {
    enabled: true, preventionScope: "everywhere", targetPages: [], targetDomains: [],
    targetPageSkips: [], exceptions: [], domainExceptions: [], siteRules: [],
    globalSettings: {
      duplicateAction: "close-new-switch-existing", ignoreParameters: false,
      duplicateScope: "all-windows",
    },
  };
  const sync = { extensionSettings: JSON.stringify(settings) };
  const local = {};
  const storageArea = values => ({
    async get(keys) {
      if (typeof keys === "string") return { [keys]: values[keys] };
      return Object.fromEntries(keys.map(key => [key, values[key]]));
    },
    async set(items) { Object.assign(values, items); },
  });
  const api = {
    tabs: {
      onCreated: event(), onUpdated: event(), onRemoved: event(),
      async query(filter) {
        return [...tabs.values()].filter(tab => filter.windowId === undefined
          || tab.windowId === filter.windowId).map(tab => ({ ...tab }));
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error("No tab with id " + id);
        return { ...tabs.get(id) };
      },
      async update(id, changes) {
        const tab = tabs.get(id);
        if (!tab) throw new Error("No tab with id " + id);
        operations.push(["activate", id]);
        if (changes.active) {
          for (const other of tabs.values()) {
            if (other.windowId === tab.windowId) other.active = false;
          }
        }
        Object.assign(tab, changes);
        return { ...tab };
      },
      async remove(id) {
        if (!tabs.delete(id)) throw new Error("No tab with id " + id);
        removed.push(id);
        operations.push(["remove", id]);
        await api.tabs.onRemoved.emit(id);
      },
    },
    windows: {
      async get(id) {
        if (!windows.has(id)) throw new Error("No window " + id);
        return { ...windows.get(id) };
      },
      async update(id, changes) {
        operations.push(["window", id, changes]);
        Object.assign(windows.get(id), changes);
      },
      async remove() { throw new Error("Window removal should not be needed"); },
    },
    storage: { sync: storageArea(sync), local: storageArea(local), onChanged: event() },
    runtime: { onInstalled: event(), lastError: undefined },
    contextMenus: { create() {}, removeAll(callback) { callback(); }, onClicked: event() },
  };
  function add(id, url, extra = {}) {
    const tab = { id, url, windowId: 1, index: tabs.size, active: false,
      incognito: false, status: "complete", ...extra };
    tabs.set(id, tab);
    return tab;
  }
  async function launch(id, url, openerTabId, { commit = true, ...extra } = {}) {
    const opener = tabs.get(openerTabId);
    const tab = add(id, "", { pendingUrl: url, openerTabId,
      index: opener ? opener.index + 1 : tabs.size, active: true, status: "loading", ...extra });
    await api.tabs.onCreated.emit({ ...tab });
    if (commit && tabs.has(id)) {
      tab.url = url;
      delete tab.pendingUrl;
      tab.status = "complete";
      await api.tabs.onUpdated.emit(id, { url, status: "complete" }, { ...tab });
    }
  }
  return { api, tabs, windows, removed, operations, settings, add, launch, sync };
}
