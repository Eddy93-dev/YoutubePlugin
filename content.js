// YouTube changes its markup often — all selectors live here.
const SEL = {
  progress:
    "ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
  card:
    "ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer, " +
    "ytd-playlist-renderer, ytd-radio-renderer, ytd-grid-playlist-renderer",
  lockup: "yt-lockup-view-model", // newer card; sits inside a grid cell on Home/Subscriptions, standalone in the sidebar
  channelLink: 'a[href^="/@"], a[href^="/channel/"]',
  title: "#video-title, h3",
  metadataText: ".ytContentMetadataViewModelMetadataText, ytd-channel-name #text",
  ageText: ".ytContentMetadataViewModelMetadataText, #metadata-line span, .inline-metadata-item",
  badge: "badge-shape, .badge, ytd-badge-supported-renderer .badge",
  anyVideoLink: 'a[href^="/watch?"], a[href^="/playlist?"]',
  // Anything on a card that looks like a sized progress bar; used only to notice when SEL.progress stops matching.
  progressLike: '[class*="rogress"][style*="width"], [id*="rogress"][style*="width"]',
  shortsBlocks:
    "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), " +
    'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  shortsGuide: "ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer", // hidden but not counted in the badge
  shortsLink: 'a[href^="/shorts/"]',
  videoLink: 'a[href^="/watch?"], a[href^="/shorts/"]',
};
const ANY_CARD = `${SEL.card}, ${SEL.lockup}`;
// yth-group-out: outside the channel group Subscriptions is filtered to (a view, not a filter: no stats, badge or peek).
const CLASSES = ["yth-hidden", "yth-dimmed", "yth-group-out"];
const CARD_CLASS = "yth-card"; // cards carrying our hide button (positioning + hover)
const MIN_PER_ROW = 2;
const MAX_PER_ROW = 10;
const HIDE_BTN_CLASS = "yth-hide-btn";
const TOAST_ID = "yth-toast";
const PEEK_BAR_ID = "yth-peek-bar";
const HEALTH_DELAY_MS = 5000;
const STATS_FLUSH_MS = 10000;
const TOAST_MS = 5000;
// Past this many changed subtrees in one frame (initial load, big re-render), one full pass is cheaper.
const FULL_PASS_THRESHOLD = 200;
// Material "visibility_off" / "visibility" icons (Apache 2.0).
const EYE_OFF_PATH =
  "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";
const EYE_PATH =
  "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";

let settings = DEFAULTS;
let manualHidden = {};
let lastCount = -1;
let scheduled = false;
let fullPassPending = false;
const pendingRoots = new Set();
let expiryTimer;
let pointer = null;
let healthTimer;
let lastHealthKey = null;
const pendingStats = new Map(); // videoId → reason, not yet written
const recordedToday = new Set(); // videoIds already counted today in this tab
let statsDay = null;
let statsTimer = null;
let peeking = false;

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

// Everything that may name a card's channel: link handles/IDs, link text, and metadata text
// (newer cards show the channel name as plain text with no link).
function cardChannelIds(card) {
  const ids = [...card.querySelectorAll(SEL.channelLink)].flatMap((a) => [
    channelKey(new URL(a.href).pathname),
    a.textContent,
  ]);
  for (const el of card.querySelectorAll(SEL.metadataText)) ids.push(el.textContent);
  // Channel pages leave the channel off their own cards; the URL says whose page it is.
  if (pageKey(location.pathname) === "filterChannel") ids.push(channelKey(location.pathname));
  return ids;
}

function cardVideoId(card) {
  const link = card.querySelector(SEL.videoLink);
  return link ? videoIdFromHref(link.getAttribute("href")) : null;
}

function isWatched(card) {
  const bar = card.querySelector(SEL.progress);
  return !!bar && shouldFilter(parsePercent(bar.style.width), settings.threshold);
}

// Upload age in days from the card's "… ago" metadata, or null if it shows none (e.g. live or scheduled).
function cardAgeDays(card) {
  for (const el of card.querySelectorAll(SEL.ageText)) {
    const days = parseAgeDays(el.textContent);
    if (days !== null) return days;
  }
  return null;
}

// Special types (live, upcoming, members, playlist) from the card's badges, overlays, metadata and links.
function cardTypes(card) {
  const all = (sel, read) => [...card.querySelectorAll(sel)].map(read);
  return videoTypes({
    badgeClasses: all(SEL.badge, (e) => String(e.className)),
    badgeTexts: all(SEL.badge, (e) => e.textContent.trim()),
    overlayStyles: all("[overlay-style]", (e) => e.getAttribute("overlay-style")),
    metaTexts: all(SEL.ageText, (e) => e.textContent.trim()),
    hrefs: all(SEL.anyVideoLink, (e) => e.getAttribute("href")),
  });
}

function cardTitle(card) {
  return card.querySelector(SEL.title)?.textContent.trim() ?? "";
}

// Why an automatic filter applies to this card ("watched", "channel", "keyword", "age", "type"), or null.
// The "never hide" list overrides all of them.
function autoFilterReason(card, ctx) {
  const channelIds = ctx.usesChannelLists ? cardChannelIds(card) : [];
  if (channelInList(settings.allowedChannels, channelIds)) return null;
  if (ctx.watchedActive && isWatched(card)) return "watched";
  // Not on channel pages: opening a blocked channel's page is deliberate, and hiding every card there
  // makes YouTube keep loading more to fill the screen.
  if (!ctx.onChannelPage && channelInList(settings.blockedChannels, channelIds)) return "channel";
  if (ctx.matchesKeyword(cardTitle(card))) return "keyword";
  // Age and type filters skip channel pages too: hiding most of a channel's uploads (older ones, its
  // live tab) would make YouTube page through the whole back catalog.
  if (ctx.onChannelPage) return null;
  if (ctx.maxAgeDays > 0 && cardAgeDays(card) > ctx.maxAgeDays) return "age";
  if (ctx.hiddenTypes.size > 0 && cardTypes(card).some((t) => ctx.hiddenTypes.has(t))) return "type";
  return null;
}

function makeHideButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = HIDE_BTN_CLASS;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
  button.append(svg);
  return button;
}

// "hide" on normal cards; "show" on manually hidden ones (visible when grayed out) to undo the hide.
function setButtonState(button, isManual) {
  const state = isManual ? "show" : "hide";
  if (button.dataset.state === state) return;
  button.dataset.state = state;
  button.title = isManual ? "Show this video again" : "Hide this video";
  button.setAttribute("aria-label", button.title);
  button.querySelector("path").setAttribute("d", isManual ? EYE_PATH : EYE_OFF_PATH);
}

function syncHideButton(card, isManual) {
  let button = card.querySelector(`:scope > .${HIDE_BTN_CLASS}`);
  if (!settings.manualEnabled) {
    button?.remove();
    card.classList.remove(CARD_CLASS);
    return;
  }
  if (!button) {
    button = makeHideButton();
    card.classList.add(CARD_CLASS);
    card.append(button);
  }
  setButtonState(button, isManual);
}

// Decides one card's state from scratch. ctx holds values that are the same for every card in a pass.
function processCard(card, ctx) {
  card.classList.remove(...CLASSES);
  if (ctx.group && !groupMatches(ctx.group, cardChannelIds(card))) {
    card.classList.add("yth-group-out");
    return;
  }
  const id = cardVideoId(card);
  const isManual = settings.manualEnabled && ctx.manualIds.has(id);
  syncHideButton(card, isManual);
  if (settings.hideShorts && card.querySelector(SEL.shortsLink)) {
    card.classList.add("yth-hidden");
    recordStat(id, "shorts");
    return;
  }
  const reason = isManual ? "manual" : autoFilterReason(card, ctx);
  if (!reason) return;
  card.classList.add(ctx.cls);
  recordStat(id, reason);
}

// Stats: remember each filtered video once per day with its reason, and write in batches.
function recordStat(id, reason) {
  if (!id) return;
  const today = dayKey(Date.now());
  if (today !== statsDay) {
    statsDay = today;
    recordedToday.clear();
  }
  if (recordedToday.has(id)) return;
  recordedToday.add(id);
  pendingStats.set(id, reason);
  statsTimer ??= setTimeout(flushStats, STATS_FLUSH_MS);
}

async function flushStats() {
  statsTimer = null;
  if (!pendingStats.size || !chrome.runtime?.id) return;
  const batch = new Map(pendingStats);
  pendingStats.clear();
  try {
    const { stats } = await chrome.storage.local.get(LOCAL_DEFAULTS);
    await chrome.storage.local.set({ stats: mergeStats(stats, batch, Date.now()) });
  } catch (err) {
    console.warn("YouTube Watched Hider: couldn't save stats", err);
  }
}

// Cards at or inside root (inner lockups collapse into their grid cell).
function cardsIn(root) {
  const cards = new Set();
  const own = findCard(root);
  if (own) cards.add(own);
  for (const el of root.querySelectorAll(ANY_CARD)) cards.add(findCard(el));
  return cards;
}

function shortsBlocksIn(root) {
  const own = root.closest(SEL.shortsBlocks);
  return own ? [own, ...root.querySelectorAll(SEL.shortsBlocks)] : root.querySelectorAll(SEL.shortsBlocks);
}

function processRoot(root, ctx) {
  for (const card of cardsIn(root)) processCard(card, ctx);
  if (!settings.hideShorts) return;
  for (const block of shortsBlocksIn(root)) block.classList.add("yth-hidden");
}

function filteredCount() {
  const marked = document.querySelectorAll(".yth-hidden, .yth-dimmed").length;
  return marked - document.querySelectorAll(`:is(${SEL.shortsGuide}).yth-hidden`).length;
}

function reportCount(count) {
  if (count === lastCount || !chrome.runtime?.id) return; // runtime.id is gone after the extension reloads
  lastCount = count;
  // Badge is cosmetic; ignore failures (e.g. service worker restarting).
  chrome.runtime.sendMessage({ count }).catch(() => {});
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

// Re-run when the next manual hide expires, so it comes back even if the page is idle.
function armExpiryTimer() {
  clearTimeout(expiryTimer);
  const ms = msUntilNextExpiry(manualHidden, Date.now());
  if (ms === null) return;
  expiryTimer = setTimeout(() => {
    scheduleFullPass();
    armExpiryTimer();
  }, ms + 1000); // +1s so the hide has certainly expired when we check
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

// Hides the button's video, or shows it again if it's already manually hidden.
function toggleManual(button) {
  // Read the id at action time: YouTube recycles card elements for different videos.
  const id = cardVideoId(button.parentElement);
  if (!id) return;
  if (button.dataset.state === "show") {
    setManuallyHidden(id, false);
    return;
  }
  setManuallyHidden(id, true);
  showUndoToast(id);
}

function onHideClick(e) {
  const button = e.target.closest?.(`.${HIDE_BTN_CLASS}`);
  if (!button) return;
  // Cards are links; don't open the video.
  e.preventDefault();
  e.stopPropagation();
  toggleManual(button);
}

// Peek: temporarily show everything the extension hid, outlined, with a bar to leave peek mode.
function setPeek(on) {
  peeking = on;
  document.documentElement.toggleAttribute("data-yth-peek", on);
  updatePeekBar();
}

function updatePeekBar() {
  let bar = document.getElementById(PEEK_BAR_ID);
  if (!peeking) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = PEEK_BAR_ID;
    bar.setAttribute("role", "status");
    const label = document.createElement("span");
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Done";
    done.addEventListener("click", () => setPeek(false));
    bar.append(label, done);
    document.body.append(bar);
  }
  const n = filteredCount();
  bar.firstChild.textContent = `Peeking at ${n} hidden item${n === 1 ? "" : "s"} · press P to hide again`;
}

function isTyping(e) {
  const el = e.composedPath()[0];
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

// H: hide (or show again) the video under the mouse. P: peek. Plain keys only, never while typing.
function onShortcut(e) {
  if (e.key === "Escape" && peeking) setPeek(false);
  if (!settings.keyboardShortcuts || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isTyping(e)) return;
  const key = e.key.toLowerCase();
  if (key === "p") {
    setPeek(!peeking);
  } else if (key === "h") {
    // Look up what's under the pointer now, not what was last hovered: after a hide the next card slides
    // into place under a still mouse, so repeated H hides one video after another.
    // All layers, not just the top one: YouTube's hover-preview player floats above the card.
    const card = pointer && document.elementsFromPoint(pointer.x, pointer.y).map(findCard).find(Boolean);
    const button = card?.querySelector(`:scope > .${HIDE_BTN_CLASS}`);
    if (!button) return; // nothing under the pointer, or manual hiding is off
    toggleManual(button);
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
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

// Layout check: a few seconds after a video page settles, look for signs that YouTube's markup no longer
// matches our selectors, and record the result for the settings panel (only when it changes).
function scheduleHealthCheck() {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(checkHealth, HEALTH_DELAY_MS);
}

function checkHealth() {
  const page = pageKey(location.pathname);
  if (!page || !chrome.runtime?.id) return;
  const main = document.querySelector("ytd-page-manager") ?? document.body;
  const cards = [...cardsIn(main)];
  const problems = assessHealth({
    videoLinks: main.querySelectorAll('a[href^="/watch?v="]').length,
    cards: cards.length,
    progressLike: cards.filter((c) => c.querySelector(SEL.progressLike)).length,
    progressMatched: cards.filter((c) => c.querySelector(SEL.progress)).length,
    mastheadFound: Boolean(document.getElementById(BUTTON_ID)),
  });
  const key = problems.join(",");
  if (key === lastHealthKey) return;
  lastHealthKey = key;
  chrome.storage.local.set({ health: { problems, page, checkedAt: Date.now() } }).catch((err) => {
    console.warn("YouTube Watched Hider: couldn't save layout check", err);
  });
}

// Page-wide CSS switches on <html>: which page this is, and the Home clean-up toggles (pure CSS in content.css).
function applyPageFlags() {
  const root = document.documentElement;
  const page = pageKey(location.pathname) ?? "";
  if (root.dataset.ythPage !== page) root.dataset.ythPage = page;
  root.toggleAttribute("data-yth-hide-shelves", Boolean(settings.hideHomeShelves));
  root.toggleAttribute("data-yth-hide-sponsored", Boolean(settings.hideSponsored));
}

// Full pass after settings, storage, navigation or expiry changes; otherwise only the subtrees that changed.
function run() {
  scheduled = false;
  ensureSettingsButton();
  ensureGroupsSection();
  updateGroupBar();
  applyPageFlags();
  if (settings.hideShorts && location.pathname.startsWith("/shorts/")) {
    location.replace("/");
    return;
  }
  const ctx = {
    manualIds: activeHiddenIds(manualHidden, Date.now()),
    cls: modeClass(),
    watchedActive: watchedFilterActive(),
    matchesKeyword: compileKeywords(settings.blockedKeywords),
    usesChannelLists: settings.allowedChannels.length > 0 || settings.blockedChannels.length > 0,
    onChannelPage: pageKey(location.pathname) === "filterChannel",
    group: activeGroup(),
    maxAgeDays: Number(settings.maxAgeDays) || 0,
    hiddenTypes: new Set(
      [
        settings.hideLive && "live",
        settings.hideUpcoming && "upcoming",
        settings.hideMembers && "members",
        settings.hidePlaylists && "playlist",
      ].filter(Boolean),
    ),
  };
  if (fullPassPending || pendingRoots.size > FULL_PASS_THRESHOLD) {
    fullPassPending = false;
    pendingRoots.clear();
    // Clears shelves and guide entries too, so loosened settings un-hide them.
    for (const el of document.querySelectorAll(".yth-hidden, .yth-dimmed, .yth-group-out")) el.classList.remove(...CLASSES);
    processRoot(document.documentElement, ctx);
  } else {
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) if (root.isConnected) processRoot(root, ctx);
  }
  reportCount(filteredCount());
  if (peeking) updatePeekBar();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(run);
}

function scheduleFullPass() {
  fullPassPending = true;
  schedule();
}

function onMutations(records) {
  for (const record of records) {
    if (record.type === "attributes") {
      // Only the enclosing card can change; never rescan a big container whose style YouTube tweaks.
      const card = findCard(record.target);
      if (card) pendingRoots.add(card);
    } else {
      for (const node of record.addedNodes) {
        // Skip our own hide buttons: their card was just processed.
        if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains(HIDE_BTN_CLASS)) pendingRoots.add(node);
      }
    }
  }
  if (pendingRoots.size) schedule();
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = stored;
  applyGridSize();
  scheduleFullPass();
});

chrome.storage.local.get(LOCAL_DEFAULTS, (stored) => {
  manualHidden = normalizeHidden(stored.manuallyHidden, Date.now());
  armExpiryTimer();
  scheduleFullPass();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.manuallyHidden) {
    manualHidden = normalizeHidden(changes.manuallyHidden.newValue, Date.now());
    armExpiryTimer();
    scheduleFullPass();
  }
  if (area !== "sync") return;
  const updates = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue]));
  settings = { ...settings, ...updates };
  applyGridSize();
  scheduleFullPass();
});

// Capture phase so YouTube's own link/click handlers never see the hide click.
document.addEventListener("click", onHideClick, true);
document.addEventListener("keydown", onShortcut, true);
// Last pointer position, for the H shortcut.
document.addEventListener(
  "pointermove",
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  },
  { capture: true, passive: true },
);

document.addEventListener("yt-navigate-finish", () => {
  scheduleFullPass();
  scheduleHealthCheck();
});
scheduleHealthCheck();
// Write any pending stats when the tab is hidden or closed, instead of waiting for the timer.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushStats();
});
// href: YouTube recycles card elements by swapping links in place. style: progress bar widths update in place.
// Our own changes are class / d / aria attributes, which aren't observed, so we don't retrigger ourselves.
new MutationObserver(onMutations).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["href", "style"],
});
