// Shared by content script, popup, background (globals) and node tests (module.exports).
const DEFAULTS = {
  watchedEnabled: true,
  threshold: 80,
  mode: "hide",
  filterSubscriptions: true,
  filterHome: true,
  filterSearch: true,
  filterWatch: true,
  filterChannel: true,
  allowedChannels: [],
  blockedChannels: [],
  blockedKeywords: [],
  hideShorts: false,
  tilesPerRow: 0, // 0 = YouTube's default
  manualEnabled: true,
  keyboardShortcuts: true,
  maxAgeDays: 0, // 0 = off
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

// Milliseconds until the soonest still-active hide expires, or null if none are active.
function msUntilNextExpiry(hidden, now) {
  let soonest = null;
  for (const at of Object.values(hidden)) {
    const left = at + MANUAL_TTL_MS - now;
    if (left > 0 && (soonest === null || left < soonest)) soonest = left;
  }
  return soonest;
}

const VIDEO_ID =/^[\w-]{11}$/;

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

// "/@name", "/channel/UC…", "/c/name", "/user/name", optionally followed by a tab such as "/videos".
const CHANNEL_PATH = /^\/(@[^/]+|(channel|c|user)\/[^/]+)(\/|$)/;

// Settings key of the page toggle that governs this path, or null if the watched filter never runs here.
function pageKey(pathname) {
  if (pathname.startsWith("/feed/subscriptions")) return "filterSubscriptions";
  if (pathname === "/") return "filterHome";
  if (pathname === "/results") return "filterSearch";
  if (pathname === "/watch") return "filterWatch";
  if (CHANNEL_PATH.test(pathname)) return "filterChannel";
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

function parseLines(text) {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ids: handles, channel IDs or display names found on a card; list entries match any of them.
function channelInList(list, ids) {
  const set = new Set(list.map(normalizeChannel));
  return ids.some((id) => id && set.has(normalizeChannel(id)));
}

const AGE_UNIT_DAYS = { s: 1 / 86400, mi: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 30, y: 365 };
// Full and abbreviated English units: "3 days ago", "22 hr ago", "1 mo ago", "2 wk ago", "Streamed 5 years ago".
const AGE_PATTERN = /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\s+ago\b/i;

// Age in days from YouTube's relative upload text, or null if the text has none.
function parseAgeDays(text) {
  const m = AGE_PATTERN.exec(text);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  const key = unit.startsWith("mo") ? "mo" : unit.startsWith("mi") ? "mi" : unit[0];
  return Number(m[1]) * AGE_UNIT_DAYS[key];
}

// "/pattern/flags" → RegExp (always case-insensitive; g/y dropped since test() with them is stateful), else null.
function keywordRegex(line) {
  const m = line.match(/^\/(.+)\/([a-z]*)$/);
  if (!m) return null;
  const flags = [...new Set(m[2].replace(/[gy]/g, "") + "i")].join("");
  return new RegExp(m[1], flags); // throws on an invalid pattern
}

// Lines that look like /patterns/ but don't compile, so settings can point them out.
function invalidKeywordLines(lines) {
  return lines.filter((line) => {
    try {
      keywordRegex(line);
      return false;
    } catch {
      return true;
    }
  });
}

// Title matcher: plain lines are case-insensitive substrings, /pattern/ lines are regexes. Invalid patterns never match.
function compileKeywords(lines) {
  const tests = [];
  for (const line of lines) {
    let re;
    try {
      re = keywordRegex(line);
    } catch {
      continue; // reported in settings via invalidKeywordLines
    }
    const needle = line.toLowerCase();
    tests.push(re ? (title) => re.test(title) : (title) => title.toLowerCase().includes(needle));
  }
  return (title) => tests.some((matches) => matches(title));
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULTS,
    LOCAL_DEFAULTS,
    MANUAL_TTL_MS,
    normalizeHidden,
    activeHiddenIds,
    msUntilNextExpiry,
    videoIdFromHref,
    parsePercent,
    shouldFilter,
    pageKey,
    channelKey,
    parseLines,
    channelInList,
    invalidKeywordLines,
    compileKeywords,
    parseAgeDays,
  };
}
