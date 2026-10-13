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
  renderStatuses(bad.length > 0);
}

// One-line summaries on the section headers, so collapsed sections still show what's on.
const PAGE_TOGGLES = ["filterSubscriptions", "filterHome", "filterSearch", "filterWatch", "filterChannel"];
const TYPE_TOGGLES = ["hideLive", "hideUpcoming", "hideMembers", "hidePlaylists"];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const setStatus = (key, text) => {
  document.getElementById(`status-${key}`).textContent = text;
};
const countChecked = (keys) => keys.filter((key) => form[key].checked).length;
const joinParts = (parts, empty) => parts.filter(Boolean).join(" · ") || empty;

function renderStatuses(hasInvalidKeyword) {
  setStatus("general", joinParts([form.mode.value === "dim" ? "Gray out" : "Hide", form.keyboardShortcuts.checked && "keys on"]));
  setStatus(
    "watched",
    form.watchedEnabled.checked ? `${form.threshold.value}% · ${plural(countChecked(PAGE_TOGGLES), "page")}` : "Off",
  );
  const keywords = parseLines(form.blockedKeywords.value).length;
  const types = countChecked(TYPE_TOGGLES);
  setStatus(
    "content",
    joinParts(
      [
        hasInvalidKeyword && "⚠ invalid pattern",
        keywords && plural(keywords, "keyword"),
        form.maxAgeDays.value !== "0" && `> ${form.maxAgeDays.selectedOptions[0].text}`,
        types && plural(types, "type"),
      ],
      "Off",
    ),
  );
  const blocked = parseLines(form.blockedChannels.value).length;
  const never = parseLines(form.allowedChannels.value).length;
  setStatus("channels", joinParts([blocked && `${blocked} hidden`, never && `${never} never`], "None"));
  setStatus("manual", form.manualEnabled.checked ? `${activeHiddenIds(manualHidden, Date.now()).size} hidden` : "Off");
  setStatus(
    "cleanup",
    joinParts([form.hideShorts.checked && "Shorts", form.hideHomeShelves.checked && "shelves", form.hideSponsored.checked && "ads"], "Off"),
  );
  setStatus("layout", form.tilesPerRow.value === "0" ? "Auto" : `${form.tilesPerRow.value} per row`);
}

// Remember which sections are open (per browser; a convenience, so storage failures just keep the defaults).
const OPEN_SECTIONS_KEY = "yth-open-sections";
const sections = [...document.querySelectorAll("details.section")];
try {
  const saved = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY));
  if (Array.isArray(saved)) for (const section of sections) section.open = saved.includes(section.dataset.section);
} catch {
  // unavailable or corrupt: keep the open/closed defaults from the HTML
}
for (const section of sections) {
  section.addEventListener("toggle", () => {
    try {
      localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(sections.filter((s) => s.open).map((s) => s.dataset.section)));
    } catch {
      // not remembered this time; harmless
    }
  });
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
  setStatus("data", today ? `${today} filtered today` : "");
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
    const backup = makeBackup(
      settings,
      { manuallyHidden: local.manuallyHidden, groups: local.groups },
      chrome.runtime.getManifest().version,
      Date.now(),
    );
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
    const groupNote = local.groups ? `, ${plural(local.groups.length, "group")}` : "";
    backupStatus.textContent = `Imported ${Object.keys(settings).length} settings${groupNote} and ${hiddenCount} hidden video${hiddenCount === 1 ? "" : "s"}.${skippedNote}`;
  } catch (err) {
    backupStatus.textContent = `Import failed: ${err instanceof SyntaxError ? "the file isn't valid JSON." : err.message}`;
  }
});

form.addEventListener("input", render);
// Save on "change" (slider release, textarea blur), not "input": storage.sync caps writes per minute.
form.addEventListener("submit", (e) => e.preventDefault());
form.addEventListener("change", (e) => {
  if (e.target === importFile || e.target.closest("#groups")) return; // groups save themselves, see popup-groups.js
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
