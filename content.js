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
  videoLink: 'a[href^="/watch?"], a[href^="/shorts/"]',
  mastheadCenter: "ytd-masthead #center", // flex row holding the search box
};
const CLASSES = ["yth-hidden", "yth-dimmed"];
const BUTTON_ID = "yth-settings-button";
const PANEL_ID = "yth-settings-panel";
const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;
const HIDE_BTN_CLASS = "yth-hide-btn";
const TOAST_ID = "yth-toast";
const TOAST_MS = 5000;
// Material "visibility_off" icon (Apache 2.0).
const EYE_OFF_PATH =
  "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";

let settings = DEFAULTS;
let manualHidden = {};
let scheduled = false;
let lastCount = -1;

// Prefer the outer grid cell: hiding only the inner lockup leaves an empty box and the grid can't reflow.
function findCard(el) {
  return el.closest(SEL.card) ?? el.closest(SEL.lockup);
}

// Hide/Gray out choice; applies to watched and manually hidden videos.
function modeClass() {
  return settings.mode === "dim" ? "yth-dimmed" : "yth-hidden";
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
  const cls = modeClass();
  let count = 0;
  for (const bar of document.querySelectorAll(SEL.progress)) {
    const card = findCard(bar);
    if (!card || card.matches(".yth-hidden, .yth-dimmed") || !shouldFilter(parsePercent(bar.style.width), settings.threshold)) continue;
    if (isChannelAllowed(settings.allowedChannels, cardChannelIds(card))) continue;
    card.classList.add(cls);
    count++;
  }
  return count;
}

function cardVideoId(card) {
  const link = card.querySelector(SEL.videoLink);
  return link ? videoIdFromHref(link.getAttribute("href")) : null;
}

// Every distinct video card on the page (inner lockups collapse into their grid cell).
function allCards() {
  const found = [...document.querySelectorAll(`${SEL.card}, ${SEL.lockup}`)].map(findCard);
  return new Set(found);
}

function makeHideButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = HIDE_BTN_CLASS;
  button.title = "Hide this video";
  button.setAttribute("aria-label", button.title);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", EYE_OFF_PATH);
  svg.append(path);
  button.append(svg);
  return button;
}

// Adds hide buttons to new cards and hides manually hidden videos. Returns how many were hidden.
function applyManual() {
  if (!settings.manualEnabled) {
    for (const button of document.querySelectorAll(`.${HIDE_BTN_CLASS}`)) button.remove();
    return 0;
  }
  // Recomputed every pass, so a hide that crosses 48h while the tab is open shows again on the next DOM change.
  const ids = activeHiddenIds(manualHidden, Date.now());
  const cls = modeClass();
  let count = 0;
  for (const card of allCards()) {
    if (!card.querySelector(`:scope > .${HIDE_BTN_CLASS}`)) card.append(makeHideButton());
    if (ids.has(cardVideoId(card))) {
      card.classList.add(cls);
      count++;
    }
  }
  return count;
}

async function setManuallyHidden(id, hidden) {
  if (!chrome.runtime?.id) return; // extension was reloaded; this content script is orphaned
  const { manuallyHidden } = await chrome.storage.local.get(LOCAL_DEFAULTS);
  const now = Date.now();
  // Prune expired hides on every write so the list doesn't grow forever.
  const current = normalizeHidden(manuallyHidden, now);
  const live = activeHiddenIds(current, now);
  const kept = Object.entries(current).filter(([key]) => key !== id && live.has(key));
  await chrome.storage.local.set({ manuallyHidden: Object.fromEntries(hidden ? [...kept, [id, now]] : kept) });
}

function showUndoToast(id) {
  document.getElementById(TOAST_ID)?.remove();
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.setAttribute("role", "status");
  const label = document.createElement("span");
  label.textContent = settings.mode === "dim" ? "Video grayed out" : "Video hidden";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => {
    toast.remove();
    setManuallyHidden(id, false);
  });
  toast.append(label, undo);
  document.body.append(toast);
  setTimeout(() => toast.remove(), TOAST_MS);
}

function onHideClick(e) {
  const button = e.target.closest?.(`.${HIDE_BTN_CLASS}`);
  if (!button) return;
  // Cards are links; don't open the video.
  e.preventDefault();
  e.stopPropagation();
  // Read the id at click time: YouTube recycles card elements for different videos.
  const id = cardVideoId(button.parentElement);
  if (!id) return;
  setManuallyHidden(id, true);
  showUndoToast(id);
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

// Overrides YouTube's videos-per-row (0 = YouTube's default).
function applyGridSize() {
  const root = document.documentElement;
  const perRow = Number(settings.tilesPerRow);
  if (Number.isInteger(perRow) && perRow >= MIN_PER_ROW && perRow <= MAX_PER_ROW) {
    root.dataset.ythPerRow = String(perRow);
    root.style.setProperty("--yth-per-row", String(perRow));
  } else {
    delete root.dataset.ythPerRow;
    root.style.removeProperty("--yth-per-row");
  }
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
  // Manual first so applyWatched skips (and doesn't double count) cards already hidden or dimmed.
  const manual = applyManual();
  reportCount(manual + applyWatched() + applyShorts());
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(apply);
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = stored;
  applyGridSize();
  schedule();
});

chrome.storage.local.get(LOCAL_DEFAULTS, (stored) => {
  manualHidden = normalizeHidden(stored.manuallyHidden, Date.now());
  schedule();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.manuallyHidden) {
    manualHidden = normalizeHidden(changes.manuallyHidden.newValue, Date.now());
    schedule();
  }
  if (area !== "sync") return;
  const updates = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue]));
  settings = { ...settings, ...updates };
  applyGridSize();
  schedule();
});

// Capture phase so YouTube's own link/click handlers never see the hide click.
document.addEventListener("click", onHideClick, true);

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
