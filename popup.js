const form = document.getElementById("form");
const out = document.getElementById("thresholdOut");
const CHECKBOXES = [
  "watchedEnabled",
  "filterSubscriptions",
  "filterHome",
  "filterSearch",
  "filterWatch",
  "filterChannel",
  "hideShorts",
  "manualEnabled",
  "keyboardShortcuts",
  "hideLive",
  "hideUpcoming",
  "hideMembers",
  "hidePlaylists",
  "hideHomeShelves",
  "hideSponsored",
];
const manualCount = document.getElementById("manualCount");
const keywordErrors = document.getElementById("keywordErrors");
let manualHidden = {};

// Embedded as an iframe by content.js: follow YouTube's theme, report size, forward Escape.
if (window.top !== window) {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  const post = (msg) => parent.postMessage(msg, "https://www.youtube.com");
  const root = document.documentElement;
  new ResizeObserver(() => post({ yth: "size", width: root.scrollWidth, height: root.scrollHeight })).observe(document.body);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post({ yth: "close" });
  });
}

function render() {
  out.value = `${form.threshold.value}%`;
  document.getElementById("watchedOptions").disabled = !form.watchedEnabled.checked;
  const n = activeHiddenIds(manualHidden, Date.now()).size;
  manualCount.textContent = `${n} video${n === 1 ? "" : "s"} hidden.`;
  const bad = invalidKeywordLines(parseLines(form.blockedKeywords.value));
  keywordErrors.hidden = bad.length === 0;
  keywordErrors.textContent = `Invalid pattern${bad.length === 1 ? "" : "s"}, ignored: ${bad.join(", ")}`;
}

function loadForm(s) {
  for (const key of CHECKBOXES) form[key].checked = s[key];
  form.threshold.value = s.threshold;
  form.mode.value = s.mode;
  form.tilesPerRow.value = String(s.tilesPerRow);
  form.maxAgeDays.value = String(s.maxAgeDays);
  form.allowedChannels.value = s.allowedChannels.join("\n");
  form.blockedChannels.value = s.blockedChannels.join("\n");
  form.blockedKeywords.value = s.blockedKeywords.join("\n");
  render();
}

chrome.storage.sync.get(DEFAULTS, loadForm);

chrome.commands.getAll((commands) => {
  const shortcut = commands.find((c) => c.name === "toggle-watched")?.shortcut;
  document.getElementById("shortcutHint").textContent = shortcut
    ? `${shortcut} toggles this filter.`
    : "Set a toggle shortcut at chrome://extensions/shortcuts.";
});

const PAGE_NAMES = {
  filterSubscriptions: "Subscriptions",
  filterHome: "Home",
  filterSearch: "search results",
  filterWatch: "the watch page",
  filterChannel: "channel pages",
};
const HEALTH_MESSAGES = {
  cards: (page) => `Videos on ${page} weren't recognized, so nothing there can be filtered.`,
  progress: () => "Watched-progress bars weren't recognized, so watched videos won't be hidden.",
  masthead: () => "The settings button couldn't be added next to the search bar.",
};

function renderHealth(health) {
  const problems = (health?.problems ?? []).filter((p) => HEALTH_MESSAGES[p]);
  document.getElementById("healthAlert").hidden = problems.length === 0;
  document.getElementById("healthProblems").replaceChildren(
    ...problems.map((p) => {
      const item = document.createElement("li");
      item.textContent = HEALTH_MESSAGES[p](PAGE_NAMES[health.page] ?? "this page");
      return item;
    }),
  );
}

const REASON_LABELS = {
  watched: "watched",
  manual: "hidden by you",
  keyword: "keyword",
  channel: "blocked channel",
  age: "too old",
  type: "video type",
  shorts: "Shorts",
};

function renderStats(stats) {
  const { today, week, month, byReason } = summarizeStats(stats, Date.now());
  document.getElementById("statsSummary").textContent =
    month === 0 ? "Nothing filtered yet." : `Filtered today: ${today} · 7 days: ${week} · 30 days: ${month}`;
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${REASON_LABELS[reason] ?? reason} ${n}`);
  document.getElementById("statsReasons").textContent = parts.length ? `Last 30 days by reason: ${parts.join(", ")}` : "";
}

chrome.storage.local.get(LOCAL_DEFAULTS, (s) => {
  manualHidden = normalizeHidden(s.manuallyHidden, Date.now());
  renderHealth(s.health);
  renderStats(s.stats);
  render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.health) renderHealth(changes.health.newValue);
  if (changes.stats) renderStats(changes.stats.newValue);
  if (changes.manuallyHidden) {
    manualHidden = normalizeHidden(changes.manuallyHidden.newValue, Date.now());
    render();
  }
});

document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

// --- Backup: export / import ---
const MAX_BACKUP_BYTES = 1_000_000;
const backupStatus = document.getElementById("backupStatus");
const importFile = document.getElementById("importFile");
const view = new URLSearchParams(location.search).get("view");
// Chrome closes the toolbar popup when a file picker opens, so the toolbar popup imports from a full tab.
const isToolbarPopup = window.top === window && view !== "tab";
if (view === "tab") document.body.classList.add("tab-view");

document.getElementById("exportBtn").addEventListener("click", async () => {
  try {
    const [settings, local] = await Promise.all([chrome.storage.sync.get(DEFAULTS), chrome.storage.local.get(LOCAL_DEFAULTS)]);
    const backup = makeBackup(settings, { manuallyHidden: local.manuallyHidden }, chrome.runtime.getManifest().version, Date.now());
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `youtube-watched-hider-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupStatus.textContent = "Backup downloaded.";
  } catch (err) {
    backupStatus.textContent = `Export failed: ${err.message}`;
  }
});

document.getElementById("importBtn").addEventListener("click", () => {
  if (isToolbarPopup) {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=tab") });
    window.close();
    return;
  }
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = ""; // so picking the same file again still fires "change"
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("the file is too large to be a backup.");
    const { settings, local, skipped } = sanitizeBackup(JSON.parse(await file.text()));
    await chrome.storage.sync.set(settings);
    await chrome.storage.local.set(local);
    loadForm(await chrome.storage.sync.get(DEFAULTS));
    const hiddenCount = Object.keys(local.manuallyHidden ?? {}).length;
    const skippedNote = skipped ? ` Skipped ${skipped} invalid value${skipped === 1 ? "" : "s"}.` : "";
    backupStatus.textContent = `Imported ${Object.keys(settings).length} settings and ${hiddenCount} hidden video${hiddenCount === 1 ? "" : "s"}.${skippedNote}`;
  } catch (err) {
    backupStatus.textContent = `Import failed: ${err instanceof SyntaxError ? "the file isn't valid JSON." : err.message}`;
  }
});

form.addEventListener("input", render);
// Save on "change" (slider release, textarea blur), not "input": storage.sync caps writes per minute.
form.addEventListener("change", (e) => {
  if (e.target === importFile) return;
  chrome.storage.sync.set({
    ...Object.fromEntries(CHECKBOXES.map((key) => [key, form[key].checked])),
    threshold: Number(form.threshold.value),
    mode: form.mode.value,
    tilesPerRow: Number(form.tilesPerRow.value),
    maxAgeDays: Number(form.maxAgeDays.value),
    allowedChannels: parseLines(form.allowedChannels.value),
    blockedChannels: parseLines(form.blockedChannels.value),
    blockedKeywords: parseLines(form.blockedKeywords.value),
  });
});
