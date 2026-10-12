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
};

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
  module.exports = { DEFAULTS, parsePercent, shouldFilter, pageKey, channelKey, parseChannelList, isChannelAllowed };
}
