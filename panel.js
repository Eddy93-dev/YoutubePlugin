// Settings button next to YouTube's search box, opening popup.html in an in-page panel.
// Loaded before content.js, which calls ensureSettingsButton() on every pass.
const MASTHEAD_CENTER = "ytd-masthead #center"; // flex row holding the search box
const BUTTON_ID = "yth-settings-button";
const PANEL_ID = "yth-settings-panel";
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;

function ensureSettingsButton() {
  if (document.getElementById(BUTTON_ID)) return;
  const center = document.querySelector(MASTHEAD_CENTER);
  if (!center) return;
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.title = "YouTube Watched Hider settings";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", PANEL_ID);
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/icon32.png");
  icon.alt = "";
  button.append(icon);
  button.addEventListener("click", togglePanel);
  center.append(button);
}

function togglePanel() {
  if (document.getElementById(PANEL_ID)) return closePanel();
  const button = document.getElementById(BUTTON_ID);
  const rect = button.getBoundingClientRect();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.top = `${rect.bottom + 8}px`;
  panel.style.left = `${Math.max(8, rect.right - 308)}px`;
  const frame = document.createElement("iframe");
  const theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
  frame.src = chrome.runtime.getURL(`popup.html?theme=${theme}`);
  frame.title = button.title;
  panel.append(frame);
  document.body.append(panel);
  button.setAttribute("aria-expanded", "true");
}

function closePanel() {
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(BUTTON_ID)?.setAttribute("aria-expanded", "false");
}

// Close on any press outside the panel. Capture on window runs before YouTube's handlers, many of which
// (e.g. channel tabs) stop click propagation, so a bubbling document "click" listener sometimes never fired.
// Presses inside the panel's iframe never reach this document, so they don't close it.
window.addEventListener(
  "pointerdown",
  (e) => {
    if (!e.target.closest?.(`#${BUTTON_ID}, #${PANEL_ID}`)) closePanel();
  },
  true,
);
// A press inside some other iframe (e.g. an embed) never reaches this document either; window blur is the only signal.
window.addEventListener("blur", () => {
  setTimeout(() => {
    if (!document.activeElement?.closest?.(`#${PANEL_ID}`)) closePanel();
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

// The embedded popup reports its size and forwards Escape.
window.addEventListener("message", (e) => {
  if (e.origin !== EXT_ORIGIN) return;
  const frame = document.querySelector(`#${PANEL_ID} iframe`);
  if (e.data?.yth === "close") closePanel();
  if (e.data?.yth === "size" && frame) {
    const maxHeight = window.innerHeight - frame.getBoundingClientRect().top - 16;
    frame.style.width = `${e.data.width}px`;
    frame.style.height = `${Math.min(e.data.height, maxHeight)}px`;
  }
});
