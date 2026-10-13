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
  hideLive: false,
  hideUpcoming: false,
  hideMembers: false,
  hidePlaylists: false,
  hideHomeShelves: false,
  hideSponsored: false,
  groupView: "filter", // "filter": Subscriptions narrowed to the group; "feed": the group's channels' latest uploads
};

// chrome.storage.local: can outgrow sync's 8KB-per-item quota. manuallyHidden is { videoId: hiddenAtMs }.
// health: last layout check from content.js, { problems: string[], page, checkedAt }.
// stats: per-day filtered videos for the settings panel, see mergeStats.
// groups: the user's channel groups, see normalizeGroups.
const LOCAL_DEFAULTS = { manuallyHidden: {}, health: { problems: [] }, stats: { days: {} }, groups: [] };
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

// "/@Handle/videos" → "Handle", "/channel/UC123" → "UC123". Case is kept (channel ids are case-sensitive in
// URLs); comparisons go through normalizeChannel.
function channelKey(pathname) {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (first?.startsWith("@")) return decodeURIComponent(first).slice(1).trim() || null;
  if (first === "channel" && second) return second;
  return null;
}

// Inverse of channelKey: a channel's URL path.
function channelHref(key) {
  return /^UC[\w-]{22}$/.test(key) ? `/channel/${key}` : `/@${key}`;
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

// Which special types a card is, from signals content.js collects: badge classes and texts, thumbnail
// overlay styles, metadata texts and link hrefs. Class/attribute signals work in any UI language; text
// signals are English fallbacks. Returns a subset of ["live", "upcoming", "members", "playlist"].
function videoTypes({ badgeClasses = [], badgeTexts = [], overlayStyles = [], metaTexts = [], hrefs = [] }) {
  const types = [];
  const anyText = (list, re) => list.some((t) => re.test(t));
  if (
    badgeClasses.some((c) => /BadgeShapeLive|badge-shape--live|live-now/.test(c)) ||
    overlayStyles.includes("LIVE") ||
    anyText(metaTexts, /\bwatching\b/i)
  ) {
    types.push("live");
  }
  if (
    overlayStyles.includes("UPCOMING") ||
    anyText(badgeTexts, /^(upcoming|premiere)$/i) ||
    anyText(metaTexts, /\b(scheduled for|premieres|waiting)\b/i)
  ) {
    types.push("upcoming");
  }
  if (badgeClasses.some((c) => /members-only|MembersOnly/.test(c)) || anyText(badgeTexts, /^members (only|first)$/i)) {
    types.push("members");
  }
  if (hrefs.some((h) => /[?&]list=/.test(h))) types.push("playlist");
  return types;
}

const STATS_DAYS = 30;

// Local calendar day "YYYY-MM-DD", optionally `daysAgo` days back (setDate handles DST-length days).
function dayKey(now, daysAgo = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// stats = { days: { "YYYY-MM-DD": { videoId: reason } } }. Adds today's batch (first reason seen wins)
// and drops days older than STATS_DAYS.
function mergeStats(stats, batch, now) {
  const today = dayKey(now);
  const cutoff = dayKey(now, STATS_DAYS - 1);
  const days = Object.fromEntries(Object.entries(stats?.days ?? {}).filter(([day]) => day >= cutoff));
  const todays = { ...days[today] };
  for (const [id, reason] of batch) if (!(id in todays)) todays[id] = reason;
  return { days: { ...days, [today]: todays } };
}

// Unique videos filtered today / last 7 days / last 30 days, plus the 30-day count per reason.
function summarizeStats(stats, now) {
  const days = stats?.days ?? {};
  const uniqueOver = (n) => {
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      for (const [id, reason] of Object.entries(days[dayKey(now, i)] ?? {})) if (!seen.has(id)) seen.set(id, reason);
    }
    return seen;
  };
  const month = uniqueOver(STATS_DAYS);
  const byReason = {};
  for (const reason of month.values()) byReason[reason] = (byReason[reason] ?? 0) + 1;
  return { today: uniqueOver(1).size, week: uniqueOver(7).size, month: month.size, byReason };
}

const MIN_LINKS_FOR_HEALTH = 6;

// Signs that YouTube's markup no longer matches our selectors, from counts content.js takes on a settled page.
// Returns problem codes: "cards" (videos shown but none recognized), "progress" (progress-like bars on cards
// but none matching the watched-bar selector), "masthead" (settings button couldn't be placed).
function assessHealth({ videoLinks, cards, progressLike, progressMatched, mastheadFound }) {
  const problems = [];
  if (videoLinks >= MIN_LINKS_FOR_HEALTH && cards === 0) problems.push("cards");
  if (progressLike > 0 && progressMatched === 0) problems.push("progress");
  if (!mastheadFound) problems.push("masthead");
  return problems;
}

const BACKUP_APP = "youtube-watched-hider";
const MAX_LIST_ITEMS = 500;
const MAX_LINE_LENGTH = 200;

function makeBackup(settings, local, version, now) {
  return { app: BACKUP_APP, version, exportedAt: new Date(now).toISOString(), settings, local };
}

// Validates an imported backup (untrusted file content). Keeps only known keys with the right types,
// clamps sizes, and returns { settings, local, skipped }. Throws an Error with a user-facing message.
function sanitizeBackup(data) {
  if (!data || typeof data !== "object" || data.app !== BACKUP_APP || typeof data.settings !== "object" || !data.settings) {
    throw new Error("This isn't a YouTube Watched Hider backup file.");
  }
  const settings = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(data.settings)) {
    const fallback = DEFAULTS[key];
    if (fallback === undefined) continue; // unknown key, e.g. from a newer version
    const clean = sanitizeSetting(key, value, fallback);
    if (clean === undefined) skipped++;
    else settings[key] = clean;
  }
  const local = {};
  const hidden = data.local?.manuallyHidden;
  if (hidden && typeof hidden === "object" && !Array.isArray(hidden)) {
    local.manuallyHidden = Object.fromEntries(
      Object.entries(hidden).filter(([id, at]) => VIDEO_ID.test(id) && Number.isFinite(at)),
    );
  }
  if (Array.isArray(data.local?.groups)) local.groups = normalizeGroups(data.local.groups);
  return { settings, local, skipped };
}

function sanitizeSetting(key, value, fallback) {
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return undefined;
    return value.filter((v) => typeof v === "string").map((v) => v.slice(0, MAX_LINE_LENGTH)).slice(0, MAX_LIST_ITEMS);
  }
  if (typeof value !== typeof fallback) return undefined;
  if (key === "mode") return value === "hide" || value === "dim" ? value : undefined;
  if (key === "groupView") return value === "filter" || value === "feed" ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return value;
}

// --- Channel groups: [{ id, name, channels: [{ key, name }] }], key = channelKey() of the channel's URL ---
const MAX_GROUPS = 50;
const MAX_GROUP_CHANNELS = 500;

const cleanText = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_LINE_LENGTH) : "");

// Channel avatar URL, only from YouTube's image hosts (imported backups are untrusted); "" otherwise.
function cleanAvatar(v) {
  if (typeof v !== "string" || v.length > 1000) return "";
  try {
    const url = new URL(v);
    return url.protocol === "https:" && /^yt\d\.(ggpht|googleusercontent)\.com$/.test(url.hostname) ? v : "";
  } catch {
    return "";
  }
}

const CHANNEL_ID = /^UC[\w-]{22}$/;

// { key, name } plus avatar and id (the UC… channel id, needed for its uploads feed) when known.
function makeChannel(key, name, avatar, id) {
  const channel = { key, name };
  const clean = cleanAvatar(avatar);
  if (clean) channel.avatar = clean;
  if (typeof id === "string" && CHANNEL_ID.test(id)) channel.id = id;
  return channel;
}

// Remembers a resolved channel id on that channel in every group.
function setChannelId(groups, key, id) {
  const k = normalizeChannel(key);
  return groups.map((g) => ({
    ...g,
    channels: g.channels.map((c) => (normalizeChannel(c.key) === k ? makeChannel(c.key, c.name, c.avatar, id) : c)),
  }));
}

// A channel page's own id, from its canonical link.
function channelIdFromHtml(html) {
  return html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ?? null;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return XML_ENTITIES[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

// A channel's uploads feed (/feeds/videos.xml) → [{ videoId, title, published (ms), author, views, isShort }].
// Regex-parsed: DOMParser needs TrustedHTML on YouTube, and the feed's format is small and fixed.
function parseChannelFeed(xml) {
  const tag = (entry, name) => entry.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
  return xml
    .split("<entry>")
    .slice(1)
    .map((entry) => ({
      videoId: tag(entry, "yt:videoId") ?? "",
      title: decodeXml(tag(entry, "title") ?? ""),
      published: Date.parse(tag(entry, "published") ?? ""),
      author: decodeXml(tag(entry, "name") ?? ""),
      views: Number(entry.match(/<media:statistics views="(\d+)"/)?.[1] ?? NaN),
      isShort: /<link rel="alternate" href="https:\/\/www\.youtube\.com\/shorts\//.test(entry),
    }))
    .filter((v) => VIDEO_ID.test(v.videoId) && Number.isFinite(v.published));
}

// --- Paging a channel's Videos tab through YouTube's own browse API (what its pages use to load more) ---
const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";
const DAY_MS = 86400000;

// First value of `key` anywhere inside o (depth-first), or undefined.
function findKey(o, key) {
  if (!o || typeof o !== "object") return undefined;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const found = findKey(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function lockupVideo(lockup) {
  const meta = lockup.metadata?.lockupMetadataViewModel;
  const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [])
    .flatMap((row) => row.metadataParts ?? [])
    .map((part) => part.text?.content ?? "");
  const videoId = lockup.contentId;
  const title = meta?.title?.content ?? "";
  if (!VIDEO_ID.test(videoId ?? "") || !title) return null;
  return {
    videoId,
    title,
    ageText: parts.find((t) => parseAgeDays(t) !== null) ?? "",
    viewsText: parts.find((t) => /\bviews?\b/i.test(t)) ?? "",
    duration: findKey(lockup.contentImage, "thumbnailBadgeViewModel")?.text ?? "",
    watched: watchedPercent(lockup.contentImage),
  };
}

// The red "watched" bar's percentage, or null. Only in signed-in responses (see sapisidHash). Newer lockups use
// thumbnailOverlayProgressBarViewModel.startPercent, older renderers thumbnailOverlayResumePlaybackRenderer.
function watchedPercent(thumbnail) {
  const value =
    findKey(thumbnail, "thumbnailOverlayProgressBarViewModel")?.startPercent ??
    findKey(thumbnail, "thumbnailOverlayResumePlaybackRenderer")?.percentDurationWatched;
  const percent = Number(value);
  return value !== undefined && Number.isFinite(percent) ? percent : null;
}

// Authorization value YouTube's own pages send so its API answers as the signed-in user:
// "SAPISIDHASH <time>_<sha1 of '<time> <SAPISID cookie> <origin>'>".
async function sapisidHash(sapisid, origin, nowSeconds) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${nowSeconds} ${sapisid} ${origin}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${nowSeconds}_${hex}`;
}

// One browse response (first page or continuation) → { videos: [{ videoId, title, ageText, viewsText, duration }],
// token } where token fetches the next page (null at the end). Only the continuation that sits in the same list as
// the videos counts: side panels (e.g. the channel's About panel) carry continuations of their own.
function parseBrowseVideos(json) {
  const videos = [];
  let token = null;
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      const isVideoList = o.some((item) => item?.richItemRenderer);
      for (const item of o) {
        if (isVideoList && item?.continuationItemRenderer) {
          token = findKey(item.continuationItemRenderer, "continuationCommand")?.token ?? token;
        } else walk(item);
      }
      return;
    }
    if (o.lockupViewModel?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      const video = lockupVideo(o.lockupViewModel);
      if (video) videos.push(video);
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(json);
  return { videos, token };
}

// Appends a page of a channel's videos (newest first) to what's loaded: skips ones already there and dates each
// from its "… ago" text, kept strictly older than the one before so the channel's order survives coarse ages.
function appendChannelPage(loaded, page, now) {
  const seen = new Set(loaded.map((v) => v.videoId));
  const out = [...loaded];
  for (const video of page) {
    if (seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    const days = parseAgeDays(video.ageText);
    const approx = days === null ? now : now - days * DAY_MS;
    const last = out[out.length - 1];
    out.push({ ...video, published: last ? Math.min(approx, last.published - 1) : approx });
  }
  return out;
}

// Group feed paging over channels [{ videos (newest first), exhausted }]. A video is safe to show once no channel can
// still have an unloaded video newer than it: everything at or after the oldest loaded video of the channel that is
// furthest behind. So the list only ever grows at the bottom. -Infinity when every channel is fully loaded.
function feedCutoff(channels) {
  const open = channels.filter((c) => !c.exhausted);
  if (!open.length) return -Infinity;
  return Math.max(...open.map((c) => (c.videos.length ? c.videos[c.videos.length - 1].published : Infinity)));
}

// The channels holding the cutoff back (furthest behind first), to load their next page.
function channelsToLoad(channels, limit) {
  const oldest = (c) => (c.videos.length ? c.videos[c.videos.length - 1].published : Infinity);
  return channels
    .filter((c) => !c.exhausted)
    .sort((a, b) => oldest(b) - oldest(a))
    .slice(0, limit);
}

// "3 days ago", like YouTube's cards.
function formatAge(ms, now) {
  const seconds = Math.max(0, (now - ms) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

// 82000 → "82K views".
function formatViews(n) {
  if (!Number.isFinite(n)) return "";
  const [value, suffix] = n >= 1e9 ? [n / 1e9, "B"] : n >= 1e6 ? [n / 1e6, "M"] : n >= 1e3 ? [n / 1e3, "K"] : [n, ""];
  const shown = value < 10 && suffix ? value.toFixed(1).replace(/\.0$/, "") : String(Math.floor(value));
  return `${shown}${suffix} view${n === 1 ? "" : "s"}`;
}

// Validates stored or imported groups (may be untrusted): drops malformed entries and duplicates, caps sizes.
function normalizeGroups(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const groups = [];
  for (const g of value) {
    const id = cleanText(g?.id);
    const name = cleanText(g?.name);
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    const keys = new Set();
    const channels = [];
    for (const c of Array.isArray(g.channels) ? g.channels : []) {
      const key = cleanText(c?.key).replace(/^@/, "");
      if (!key || keys.has(normalizeChannel(key))) continue;
      keys.add(normalizeChannel(key));
      channels.push(makeChannel(key, cleanText(c.name) || key, c.avatar, c.id));
    }
    groups.push({ id, name, channels: channels.slice(0, MAX_GROUP_CHANNELS) });
    if (groups.length === MAX_GROUPS) break;
  }
  return groups;
}

// id is supplied by the caller (e.g. Date.now().toString(36)) so this stays pure.
function addGroup(groups, name, id) {
  const clean = cleanText(name);
  if (!clean || groups.length >= MAX_GROUPS) return groups;
  return [...groups, { id, name: clean, channels: [] }];
}

function renameGroup(groups, id, name) {
  const clean = cleanText(name);
  return clean ? groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) : groups;
}

function deleteGroup(groups, id) {
  return groups.filter((g) => g.id !== id);
}

// Moves a group one place up (-1) or down (+1); no-op at the ends.
function moveGroup(groups, id, step) {
  const from = groups.findIndex((g) => g.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= groups.length) return groups;
  const next = [...groups];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// Adds (on) or removes the channel { key, name, avatar? } in one group. Re-adding refreshes name and avatar.
function setChannelInGroup(groups, id, channel, on) {
  const key = cleanText(channel.key).replace(/^@/, "");
  if (!key) return groups;
  return groups.map((g) => {
    if (g.id !== id) return g;
    const rest = g.channels.filter((c) => normalizeChannel(c.key) !== normalizeChannel(key));
    if (!on) return { ...g, channels: rest };
    if (rest.length >= MAX_GROUP_CHANNELS) return g;
    const old = g.channels.find((c) => normalizeChannel(c.key) === normalizeChannel(key));
    const added = makeChannel(key, cleanText(channel.name) || key, channel.avatar || old?.avatar, channel.id || old?.id);
    // Keep its place when it was already in the group.
    return { ...g, channels: old ? g.channels.map((c) => (c === old ? added : c)) : [...rest, added] };
  });
}

function groupsForChannel(groups, key) {
  const k = normalizeChannel(key ?? "");
  return groups.filter((g) => g.channels.some((c) => normalizeChannel(c.key) === k));
}

// ids: what cardChannelIds() found on a card; matches a channel's handle/id or its display name.
function groupMatches(group, ids) {
  return channelInList(group.channels.flatMap((c) => [c.key, c.name]), ids);
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
    channelHref,
    parseLines,
    channelInList,
    invalidKeywordLines,
    compileKeywords,
    parseAgeDays,
    videoTypes,
    makeBackup,
    sanitizeBackup,
    assessHealth,
    dayKey,
    mergeStats,
    summarizeStats,
    MAX_GROUPS,
    normalizeGroups,
    addGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    setChannelInGroup,
    groupsForChannel,
    groupMatches,
    setChannelId,
    channelIdFromHtml,
    parseChannelFeed,
    formatAge,
    formatViews,
    VIDEOS_TAB_PARAMS,
    parseBrowseVideos,
    sapisidHash,
    appendChannelPage,
    feedCutoff,
    channelsToLoad,
  };
}
