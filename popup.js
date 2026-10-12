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

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of CHECKBOXES) form[key].checked = s[key];
  form.threshold.value = s.threshold;
  form.mode.value = s.mode;
  form.tilesPerRow.value = String(s.tilesPerRow);
  form.maxAgeDays.value = String(s.maxAgeDays);
  form.allowedChannels.value = s.allowedChannels.join("\n");
  form.blockedChannels.value = s.blockedChannels.join("\n");
  form.blockedKeywords.value = s.blockedKeywords.join("\n");
  render();
});

chrome.commands.getAll((commands) => {
  const shortcut = commands.find((c) => c.name === "toggle-watched")?.shortcut;
  document.getElementById("shortcutHint").textContent = shortcut
    ? `${shortcut} toggles this filter.`
    : "Set a toggle shortcut at chrome://extensions/shortcuts.";
});

chrome.storage.local.get(LOCAL_DEFAULTS, (s) => {
  manualHidden = normalizeHidden(s.manuallyHidden, Date.now());
  render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.manuallyHidden) return;
  manualHidden = normalizeHidden(changes.manuallyHidden.newValue, Date.now());
  render();
});

document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;

form.addEventListener("input", render);
// Save on "change" (slider release, textarea blur), not "input": storage.sync caps writes per minute.
form.addEventListener("change", () => {
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
