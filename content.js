// YouTube changes its markup often — all selectors live here.
const SEL = {
  progress:
    "ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
  card: "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model",
  channelLink: 'a[href^="/@"], a[href^="/channel/"]',
  shortsBlocks:
    "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
  shortsGuide: 'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  shortsLink: 'a[href^="/shorts/"]',
};
const CLASSES = ["yth-hidden", "yth-dimmed"];

let settings = DEFAULTS;
let scheduled = false;
let lastCount = -1;

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
    const card = bar.closest(SEL.card);
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
  const cards = [...document.querySelectorAll(SEL.shortsLink)].map((a) => a.closest(SEL.card)).filter(Boolean);
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

function apply() {
  scheduled = false;
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

document.addEventListener("yt-navigate-finish", schedule);
// childList only: our own class changes don't retrigger the observer.
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
