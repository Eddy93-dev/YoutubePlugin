// YouTube changes its markup often — all selectors live here.
const SEL = {
  progress:
    "ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
  card: "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer",
  lockup: "yt-lockup-view-model", // newer card; sits inside a grid cell on Home/Subscriptions, standalone in the sidebar
  channelLink: 'a[href^="/@"], a[href^="/channel/"]',
  shortsBlocks:
    "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
  shortsGuide: 'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  shortsLink: 'a[href^="/shorts/"]',
  mastheadCenter: "ytd-masthead #center", // flex row holding the search box
};
const CLASSES = ["yth-hidden", "yth-dimmed"];
const BUTTON_ID = "yth-settings-button";
const PANEL_ID = "yth-settings-panel";
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;

let settings = DEFAULTS;
let scheduled = false;
let lastCount = -1;

// Prefer the outer grid cell: hiding only the inner lockup leaves an empty box and the grid can't reflow.
function findCard(el) {
  return el.closest(SEL.card) ?? el.closest(SEL.lockup);
}

function watchedFilterActive() {
  const key = pageKey(location.pathname);
  return settings.watchedEnabled && key !== null && settings[key];
}

function cardChannelIds(card) {
  return [...card.querySelectorAll(SEL.channelLink)].flatMap((a) => [
    channelKey(new URL(a.href).pathname),
    a.textContent,
  ]);
}

// Returns how many cards were filtered.
function applyWatched() {
  if (!watchedFilterActive()) return 0;
  const cls = settings.mode === "dim" ? "yth-dimmed" : "yth-hidden";
  let count = 0;
  for (const bar of document.querySelectorAll(SEL.progress)) {
    const card = findCard(bar);
    if (!card || !shouldFilter(parsePercent(bar.style.width), settings.threshold)) continue;
    if (isChannelAllowed(settings.allowedChannels, cardChannelIds(card))) continue;
    card.classList.add(cls);
    count++;
  }
  return count;
}

// Returns how many shelves/cards were hidden (sidebar entries aren't counted).
function applyShorts() {
  if (!settings.hideShorts) return 0;
  for (const el of document.querySelectorAll(SEL.shortsGuide)) el.classList.add("yth-hidden");
  const blocks = [...document.querySelectorAll(SEL.shortsBlocks)];
  const cards = [...document.querySelectorAll(SEL.shortsLink)].map(findCard).filter(Boolean);
  const hidden = new Set([...blocks, ...cards]);
  for (const el of hidden) el.classList.add("yth-hidden");
  return hidden.size;
}

function reportCount(count) {
  if (count === lastCount || !chrome.runtime?.id) return; // runtime.id is gone after the extension reloads
  lastCount = count;
  // Badge is cosmetic; ignore failures (e.g. service worker restarting).
  chrome.runtime.sendMessage({ count }).catch(() => {});
}

// Settings button next to the search box; opens popup.html in an in-page panel.
function ensureSettingsButton() {
  if (document.getElementById(BUTTON_ID)) return;
  const center = document.querySelector(SEL.mastheadCenter);
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

function apply() {
  scheduled = false;
  ensureSettingsButton();
  if (settings.hideShorts && location.pathname.startsWith("/shorts/")) {
    location.replace("/");
    return;
  }
  // Reset first so loosened settings (higher threshold, shorts off) un-hide cards.
  for (const el of document.querySelectorAll(".yth-hidden, .yth-dimmed")) el.classList.remove(...CLASSES);
  reportCount(applyWatched() + applyShorts());
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(apply);
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = stored;
  schedule();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const updates = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue]));
  settings = { ...settings, ...updates };
  schedule();
});

// Clicks inside the iframe never reach this document, so any click here outside the button closes the panel.
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(`#${BUTTON_ID}, #${PANEL_ID}`)) closePanel();
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

document.addEventListener("yt-navigate-finish", schedule);
// childList only: our own class changes don't retrigger the observer.
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
