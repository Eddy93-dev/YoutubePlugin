const form = document.getElementById("form");
const out = document.getElementById("thresholdOut");
const CHECKBOXES = ["watchedEnabled", "filterSubscriptions", "filterHome", "filterSearch", "filterWatch", "hideShorts"];

function render() {
  out.value = `${form.threshold.value}%`;
  document.getElementById("watchedOptions").disabled = !form.watchedEnabled.checked;
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of CHECKBOXES) form[key].checked = s[key];
  form.threshold.value = s.threshold;
  form.mode.value = s.mode;
  form.allowedChannels.value = s.allowedChannels.join("\n");
  render();
});

chrome.commands.getAll((commands) => {
  const shortcut = commands.find((c) => c.name === "toggle-watched")?.shortcut;
  document.getElementById("shortcutHint").textContent = shortcut
    ? `${shortcut} toggles this filter.`
    : "Set a toggle shortcut at chrome://extensions/shortcuts.";
});

form.addEventListener("input", render);
// Save on "change" (slider release, textarea blur), not "input": storage.sync caps writes per minute.
form.addEventListener("change", () => {
  chrome.storage.sync.set({
    ...Object.fromEntries(CHECKBOXES.map((key) => [key, form[key].checked])),
    threshold: Number(form.threshold.value),
    mode: form.mode.value,
    allowedChannels: parseChannelList(form.allowedChannels.value),
  });
});
