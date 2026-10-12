// Shared by content script, popup, background (globals) and node tests (module.exports).
const DEFAULTS = {
  watchedEnabled: true,
  threshold: 80,
  mode: "hide",
  filterSubscriptions: true,
  filterHome: true,
  filterSearch: true,
  filterWatch: true,
  allowedChannels: [],
  hideShorts: false,
  tilesPerRow: 0, // 0 = YouTube's default
  manualEnabled: true,
};

// chrome.storage.local: can outgrow sync's 8KB-per-item quota. manuallyHidden is { videoId: hiddenAtMs }.
const LOCAL_DEFAULTS = { manuallyHidden: {} };
const MANUAL_TTL_MS = 48 * 60 * 60 * 1000;

// v0.5.0 stored a plain array of ids; treat those as hidden now.
function normalizeHidden(value, now) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((id) => [id, now]));
  return value && typeof value === "object" ? value : {};
}

// Ids that should currently be hidden; each hide expires MANUAL_TTL_MS after it was made.
function activeHiddenIds(hidden, now) {
  const active = Object.entries(hidden).filter(([, at]) => now - at < MANUAL_TTL_MS);
  return new Set(active.map(([id]) => id));
}

const VIDEO_ID = /^[\w-]{11}$/;

// "/watch?v=ID…" or "/shorts/ID" → ID, otherwise null.
function videoIdFromHref(href) {
  const url = new URL(href, "https://www.youtube.com");
  const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
  return id && VIDEO_ID.test(id) ? id : null;
}

function parsePercent(width) {
  const n = parseFloat(width);
  return Number.isFinite(n) ? n : null;
}

function shouldFilter(percent, threshold) {
  return percent !== null && percent >= threshold;
}

// Settings key of the page toggle that governs this path, or null if the watched filter never runs here.
function pageKey(pathname) {
  if (pathname.startsWith("/feed/subscriptions")) return "filterSubscriptions";
  if (pathname === "/") return "filterHome";
  if (pathname === "/results") return "filterSearch";
  if (pathname === "/watch") return "filterWatch";
  return null;
}

const normalizeChannel = (s) => s.trim().toLowerCase().replace(/^@/, "");

// "/@Handle/videos" → "handle", "/channel/UC123" → "uc123".
function channelKey(pathname) {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (first?.startsWith("@")) return normalizeChannel(decodeURIComponent(first));
  if (first === "channel" && second) return normalizeChannel(second);
  return null;
}

function parseChannelList(text) {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ids: handles, channel IDs or display names found on a card; allowed entries match any of them.
function isChannelAllowed(allowed, ids) {
  const set = new Set(allowed.map(normalizeChannel));
  return ids.some((id) => id && set.has(normalizeChannel(id)));
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULTS, LOCAL_DEFAULTS, MANUAL_TTL_MS, normalizeHidden, activeHiddenIds, videoIdFromHref, parsePercent, shouldFilter, pageKey, channelKey, parseChannelList, isChannelAllowed };
}
