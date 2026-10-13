const test = require("node:test");
const assert = require("node:assert");
const { MANUAL_TTL_MS, normalizeHidden, activeHiddenIds, msUntilNextExpiry, videoIdFromHref, parsePercent, shouldFilter, pageKey, channelKey, channelHref, parseLines, channelInList, invalidKeywordLines, compileKeywords, parseAgeDays, videoTypes, makeBackup, sanitizeBackup, DEFAULTS, assessHealth, dayKey, mergeStats, summarizeStats, MAX_GROUPS, normalizeGroups, addGroup, renameGroup, deleteGroup, moveGroup, setChannelInGroup, groupsForChannel, groupMatches } = require("../lib.js");

test("dayKey gives local calendar days, counting back across month ends", () => {
  const now = new Date(2026, 2, 1, 12).getTime(); // 1 Mar 2026, local noon
  assert.strictEqual(dayKey(now), "2026-03-01");
  assert.strictEqual(dayKey(now, 1), "2026-02-28");
  assert.strictEqual(dayKey(now, 29), "2026-01-31");
});

test("mergeStats adds today's batch, keeps the first reason, and drops days past 30", () => {
  const now = new Date(2026, 9, 12, 12).getTime();
  const old = { days: { "2026-09-01": { aaaaaaaaaaa: "watched" }, "2026-10-12": { bbbbbbbbbbb: "manual" } } };
  const merged = mergeStats(old, new Map([["bbbbbbbbbbb", "keyword"], ["ccccccccccc", "age"]]), now);
  assert.deepStrictEqual(merged, { days: { "2026-10-12": { bbbbbbbbbbb: "manual", ccccccccccc: "age" } } });
  assert.deepStrictEqual(mergeStats(undefined, new Map([["ddddddddddd", "shorts"]]), now), { days: { "2026-10-12": { ddddddddddd: "shorts" } } });
});

test("summarizeStats counts unique videos per window and by reason", () => {
  const now = new Date(2026, 9, 12, 12).getTime();
  const stats = {
    days: {
      "2026-10-12": { a: "watched", b: "manual" },
      "2026-10-10": { a: "watched", c: "keyword" }, // a seen again: counted once
      "2026-09-20": { d: "age" }, // within 30 days, outside 7
    },
  };
  assert.deepStrictEqual(summarizeStats(stats, now), { today: 2, week: 3, month: 4, byReason: { watched: 1, manual: 1, keyword: 1, age: 1 } });
  assert.deepStrictEqual(summarizeStats(undefined, now), { today: 0, week: 0, month: 0, byReason: {} });
});

test("assessHealth reports nothing on a healthy page", () => {
  assert.deepStrictEqual(assessHealth({ videoLinks: 60, cards: 30, progressLike: 4, progressMatched: 4, mastheadFound: true }), []);
  // Few links (e.g. an empty feed) is not evidence of breakage.
  assert.deepStrictEqual(assessHealth({ videoLinks: 2, cards: 0, progressLike: 0, progressMatched: 0, mastheadFound: true }), []);
});

test("assessHealth flags unrecognized cards, progress bars and masthead", () => {
  assert.deepStrictEqual(assessHealth({ videoLinks: 40, cards: 0, progressLike: 0, progressMatched: 0, mastheadFound: true }), ["cards"]);
  assert.deepStrictEqual(assessHealth({ videoLinks: 40, cards: 20, progressLike: 3, progressMatched: 0, mastheadFound: true }), ["progress"]);
  assert.deepStrictEqual(assessHealth({ videoLinks: 40, cards: 20, progressLike: 0, progressMatched: 0, mastheadFound: false }), ["masthead"]);
});

test("backup round-trips settings, manual hides and groups", () => {
  const settings = { ...DEFAULTS, threshold: 65, mode: "dim", blockedKeywords: ["reaction"] };
  const local = { manuallyHidden: { dQw4w9WgXcQ: 1700000000000 }, groups: [{ id: "g1", name: "Coding", channels: [{ key: "fireship", name: "Fireship" }] }] };
  const restored = sanitizeBackup(JSON.parse(JSON.stringify(makeBackup(settings, local, "0.14.0", 0))));
  assert.deepStrictEqual(restored.settings, settings);
  assert.deepStrictEqual(restored.local, local);
  assert.strictEqual(restored.skipped, 0);
});

test("sanitizeBackup rejects files that aren't backups", () => {
  for (const bad of [null, "text", [], {}, { app: "other", settings: {} }, { app: "youtube-watched-hider" }]) {
    assert.throws(() => sanitizeBackup(bad), /isn't a YouTube Watched Hider backup/);
  }
});

test("sanitizeBackup keeps only known, well-typed values and clamps lists", () => {
  const { settings, local, skipped } = sanitizeBackup({
    app: "youtube-watched-hider",
    settings: {
      threshold: "80", // wrong type
      mode: "explode", // not an allowed value
      hideShorts: true,
      maxAgeDays: Infinity, // not finite (JSON can't carry it, but guard anyway)
      futureSetting: 1, // unknown key: ignored, not counted
      blockedChannels: ["@ok", 42, "x".repeat(500), ...Array(600).fill("@many")],
    },
    local: { manuallyHidden: { dQw4w9WgXcQ: 5, "not-an-id": 5, abcdefghijk: "soon" } },
  });
  assert.deepStrictEqual(Object.keys(settings).sort(), ["blockedChannels", "hideShorts"]);
  assert.strictEqual(settings.blockedChannels.length, 500);
  assert.strictEqual(settings.blockedChannels[1].length, 200);
  assert.strictEqual(skipped, 3);
  assert.deepStrictEqual(local, { manuallyHidden: { dQw4w9WgXcQ: 5 } });
});

test("videoTypes detects live, upcoming, members-only and playlist/mix cards", () => {
  // Live search result as YouTube rendered it in testing: badge class + "watching" metadata.
  assert.deepStrictEqual(videoTypes({ badgeClasses: ["ytBadgeShapeHost ytBadgeShapeLive ytBadgeShapeModern"], metaTexts: ["4.8k watching"] }), ["live"]);
  assert.deepStrictEqual(videoTypes({ overlayStyles: ["LIVE"] }), ["live"]);
  assert.deepStrictEqual(videoTypes({ overlayStyles: ["UPCOMING"] }), ["upcoming"]);
  assert.deepStrictEqual(videoTypes({ metaTexts: ["Scheduled for 10/20/26, 8:00 PM"] }), ["upcoming"]);
  assert.deepStrictEqual(videoTypes({ metaTexts: ["120 waiting"] }), ["upcoming"]);
  assert.deepStrictEqual(videoTypes({ badgeClasses: ["badge badge-style-type-members-only"] }), ["members"]);
  assert.deepStrictEqual(videoTypes({ badgeTexts: ["Members only"] }), ["members"]);
  // Mix link as seen in testing, and a regular playlist.
  assert.deepStrictEqual(videoTypes({ hrefs: ["/watch?v=abc&list=RD_jH2oTNRe7g&start_radio=1"] }), ["playlist"]);
  assert.deepStrictEqual(videoTypes({ hrefs: ["/playlist?list=PL123"] }), ["playlist"]);
});

test("videoTypes leaves ordinary videos untyped", () => {
  assert.deepStrictEqual(
    videoTypes({ badgeClasses: ["ytBadgeShapeHost"], badgeTexts: ["22 products", "New"], overlayStyles: ["DEFAULT"], metaTexts: ["1.2M views", "3 days ago"], hrefs: ["/watch?v=abc"] }),
    [],
  );
  assert.deepStrictEqual(videoTypes({}), []);
});

test("parseAgeDays reads full and abbreviated English relative ages", () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
  assert.strictEqual(parseAgeDays("3 days ago"), 3);
  assert.strictEqual(parseAgeDays("1 day ago"), 1);
  near(parseAgeDays("22 hr ago"), 22 / 24);
  near(parseAgeDays("5 hours ago"), 5 / 24);
  assert.strictEqual(parseAgeDays("2 weeks ago"), 14);
  assert.strictEqual(parseAgeDays("3 wk ago"), 21);
  assert.strictEqual(parseAgeDays("1 mo ago"), 30);
  assert.strictEqual(parseAgeDays("11 months ago"), 330);
  assert.strictEqual(parseAgeDays("2 years ago"), 730);
  assert.strictEqual(parseAgeDays("Streamed 1 yr ago"), 365);
  near(parseAgeDays("45 minutes ago"), 45 / 1440);
  near(parseAgeDays("10 min ago"), 10 / 1440);
  near(parseAgeDays("30 seconds ago"), 30 / 86400);
});

test("parseAgeDays returns null for text without an age", () => {
  assert.strictEqual(parseAgeDays("1.2M views"), null);
  assert.strictEqual(parseAgeDays("Scheduled for 5/1/26"), null);
  assert.strictEqual(parseAgeDays(""), null);
});

test("compileKeywords matches plain words case-insensitively and /patterns/ as regexes", () => {
  const matches = compileKeywords(["Reaction", "/live ?stream/", "/^\\[ad\\]/"]);
  assert.strictEqual(matches("My REACTION to the finale"), true);
  assert.strictEqual(matches("Sunday LiveStream"), true);
  assert.strictEqual(matches("Sunday live stream"), true);
  assert.strictEqual(matches("[AD] new phone"), true);
  assert.strictEqual(matches("Cooking pasta"), false);
  assert.strictEqual(compileKeywords([])("anything"), false);
});

test("compileKeywords skips invalid patterns and is stateless with a g flag", () => {
  const matches = compileKeywords(["/(unclosed/", "/news/g"]);
  assert.strictEqual(matches("(unclosed"), false);
  assert.strictEqual(matches("news today"), true);
  assert.strictEqual(matches("news today"), true); // a stateful /g regex would fail the second call
});

test("invalidKeywordLines reports only broken patterns", () => {
  assert.deepStrictEqual(invalidKeywordLines(["word", "/ok/", "/(bad/", "/[x/i"]), ["/(bad/", "/[x/i"]);
});

test("videoIdFromHref extracts ids from watch and shorts links", () => {
  assert.strictEqual(videoIdFromHref("/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assert.strictEqual(videoIdFromHref("https://www.youtube.com/watch?v=abc-_123XYZ"), "abc-_123XYZ");
  assert.strictEqual(videoIdFromHref("/shorts/abc-_123XYZ"), "abc-_123XYZ");
  assert.strictEqual(videoIdFromHref("/watch?v=tooShort"), null);
  assert.strictEqual(videoIdFromHref("/@channel"), null);
});

test("normalizeHidden migrates the old id array and rejects junk", () => {
  assert.deepStrictEqual(normalizeHidden(["aaaaaaaaaaa", "bbbbbbbbbbb"], 5), { aaaaaaaaaaa: 5, bbbbbbbbbbb: 5 });
  assert.deepStrictEqual(normalizeHidden({ aaaaaaaaaaa: 1 }, 5), { aaaaaaaaaaa: 1 });
  assert.deepStrictEqual(normalizeHidden(undefined, 5), {});
});

test("activeHiddenIds drops hides older than 48 hours", () => {
  assert.strictEqual(MANUAL_TTL_MS, 48 * 60 * 60 * 1000);
  const now = 10 * MANUAL_TTL_MS;
  const hidden = { fresh: now - 1000, almost: now - MANUAL_TTL_MS + 1, stale: now - MANUAL_TTL_MS };
  assert.deepStrictEqual([...activeHiddenIds(hidden, now)], ["fresh", "almost"]);
});

test("msUntilNextExpiry returns the soonest remaining time, ignoring expired hides", () => {
  const now = 10 * MANUAL_TTL_MS;
  assert.strictEqual(msUntilNextExpiry({}, now), null);
  assert.strictEqual(msUntilNextExpiry({ old: now - MANUAL_TTL_MS }, now), null);
  assert.strictEqual(msUntilNextExpiry({ a: now - 1000, b: now - 5000, old: now - 2 * MANUAL_TTL_MS }, now), MANUAL_TTL_MS - 5000);
});

test("parsePercent reads inline width styles", () => {
  assert.strictEqual(parsePercent("80%"), 80);
  assert.strictEqual(parsePercent("100%"), 100);
  assert.strictEqual(parsePercent("33.5%"), 33.5);
  assert.strictEqual(parsePercent(""), null);
});

test("shouldFilter is inclusive at the threshold", () => {
  assert.strictEqual(shouldFilter(80, 80), true);
  assert.strictEqual(shouldFilter(79, 80), false);
  assert.strictEqual(shouldFilter(null, 80), false);
});

test("pageKey maps paths to page toggles", () => {
  assert.strictEqual(pageKey("/feed/subscriptions"), "filterSubscriptions");
  assert.strictEqual(pageKey("/"), "filterHome");
  assert.strictEqual(pageKey("/results"), "filterSearch");
  assert.strictEqual(pageKey("/watch"), "filterWatch");
  assert.strictEqual(pageKey("/feed/history"), null);
  assert.strictEqual(pageKey("/playlist"), null);
});

test("pageKey recognizes channel pages and their tabs", () => {
  for (const path of ["/@someone", "/@someone/videos", "/@some.one/streams", "/channel/UCabc", "/channel/UCabc/videos", "/c/Name", "/user/name/videos"]) {
    assert.strictEqual(pageKey(path), "filterChannel", path);
  }
  assert.strictEqual(pageKey("/channel"), null);
  assert.strictEqual(pageKey("/c"), null);
});

test("channelKey extracts handles and channel ids, channelHref turns them back into paths", () => {
  assert.strictEqual(channelKey("/@SomeOne/videos"), "SomeOne");
  assert.strictEqual(channelHref("SomeOne"), "/@SomeOne");
  assert.strictEqual(channelHref("UC-9-kyTW8ZkZNDHQJ6FgpwQ"), "/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ");
  assert.strictEqual(channelKey("/channel/UCabc"), "UCabc");
  assert.strictEqual(channelKey("/watch"), null);
});

test("parseLines drops blank lines and whitespace", () => {
  assert.deepStrictEqual(parseLines(" @a \n\n  Some Name\n"), ["@a", "Some Name"]);
});

test("channelInList matches handle, id or display name, ignoring case and @", () => {
  const allowed = ["@SomeOne", "Cool Channel"];
  assert.strictEqual(channelInList(allowed, ["someone"]), true);
  assert.strictEqual(channelInList(allowed, [null, " cool channel "]), true);
  assert.strictEqual(channelInList(allowed, ["other", "Other Name"]), false);
  assert.strictEqual(channelInList([], ["someone"]), false);
});

test("group helpers add, rename, move and delete without mutating", () => {
  const empty = [];
  let groups = addGroup(empty, "  Gaming ", "a");
  groups = addGroup(groups, "Coding", "b");
  assert.deepStrictEqual(empty, []);
  assert.deepStrictEqual(groups.map((g) => g.name), ["Gaming", "Coding"]);
  assert.strictEqual(addGroup(groups, "   ", "c"), groups, "blank names are ignored");
  assert.strictEqual(renameGroup(groups, "a", "Games")[0].name, "Games");
  assert.strictEqual(renameGroup(groups, "a", "")[0].name, "Gaming");
  assert.deepStrictEqual(moveGroup(groups, "b", -1).map((g) => g.id), ["b", "a"]);
  assert.strictEqual(moveGroup(groups, "a", -1), groups, "no-op at the top");
  assert.deepStrictEqual(deleteGroup(groups, "a").map((g) => g.id), ["b"]);
  const full = Array.from({ length: MAX_GROUPS }, (_, i) => ({ id: String(i), name: "g", channels: [] }));
  assert.strictEqual(addGroup(full, "one more", "x"), full);
});

test("setChannelInGroup adds once, removes, and groupsForChannel/groupMatches find it", () => {
  let groups = [{ id: "a", name: "Tech", channels: [] }, { id: "b", name: "Fun", channels: [] }];
  groups = setChannelInGroup(groups, "a", { key: "@LinusTechTips", name: "Linus Tech Tips" }, true);
  groups = setChannelInGroup(groups, "a", { key: "linustechtips", name: "Linus Tech Tips" }, true);
  assert.deepStrictEqual(groups[0].channels, [{ key: "linustechtips", name: "Linus Tech Tips" }]);
  assert.deepStrictEqual(groupsForChannel(groups, "@LinusTechTips").map((g) => g.id), ["a"]);
  assert.ok(groupMatches(groups[0], ["linustechtips"]));
  assert.ok(groupMatches(groups[0], ["Linus Tech Tips"]), "matches cards that only show the name");
  assert.ok(!groupMatches(groups[1], ["linustechtips"]));
  assert.deepStrictEqual(setChannelInGroup(groups, "a", { key: "linustechtips" }, false)[0].channels, []);
});

test("normalizeGroups drops malformed entries and duplicates", () => {
  const groups = normalizeGroups([
    { id: "a", name: "Ok", channels: [{ key: "@X", name: "X" }, { key: "x" }, { name: "no key" }, null] },
    { id: "a", name: "Duplicate id", channels: [] },
    { id: "b", name: "  ", channels: [] },
    "junk",
    { id: "c", name: "No channels" },
  ]);
  assert.deepStrictEqual(groups, [
    { id: "a", name: "Ok", channels: [{ key: "X", name: "X" }] },
    { id: "c", name: "No channels", channels: [] },
  ]);
  assert.deepStrictEqual(normalizeGroups({ not: "an array" }), []);
});

test("channel avatars are kept only from YouTube's image hosts and survive re-adding", () => {
  const ok = "https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj";
  let groups = [{ id: "a", name: "Tech", channels: [] }];
  groups = setChannelInGroup(groups, "a", { key: "one", name: "One", avatar: ok }, true);
  groups = setChannelInGroup(groups, "a", { key: "two", name: "Two", avatar: "https://evil.example/x.png" }, true);
  assert.deepStrictEqual(groups[0].channels, [{ key: "one", name: "One", avatar: ok }, { key: "two", name: "Two" }]);
  const readded = setChannelInGroup(groups, "a", { key: "One", name: "One renamed" }, true);
  assert.deepStrictEqual(readded[0].channels[0], { key: "One", name: "One renamed", avatar: ok }, "keeps place and avatar");
  const imported = normalizeGroups([{ id: "a", name: "T", channels: [{ key: "x", avatar: "javascript:alert(1)" }, { key: "y", avatar: ok }] }]);
  assert.deepStrictEqual(imported[0].channels, [{ key: "x", name: "x" }, { key: "y", name: "y", avatar: ok }]);
});
