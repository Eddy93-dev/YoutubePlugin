const form = document.getElementById("form");
const out = document.getElementById("thresholdOut");
const CHECKBOXES = ["watchedEnabled", "filterSubscriptions", "filterHome", "filterSearch", "filterWatch", "hideShorts"];

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
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of CHECKBOXES) form[key].checked = s[key];
  form.threshold.value = s.threshold;
  form.mode.value = s.mode;
  form.tilesPerRow.value = String(s.tilesPerRow);
  form.allowedChannels.value = s.allowedChannels.join("\n");
  render();
});

chrome.commands.getAll((commands) => {
  const shortcut = commands.find((c) => c.name === "toggle-watched")?.shortcut;
  document.getElementById("shortcutHint").textContent = shortcut
    ? `${shortcut} toggles this filter.`
    : "Set a toggle shortcut at chrome://extensions/shortcuts.";
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
    allowedChannels: parseChannelList(form.allowedChannels.value),
  });
});
