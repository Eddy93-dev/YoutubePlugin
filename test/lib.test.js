const test = require("node:test");
const assert = require("node:assert");
const { MANUAL_TTL_MS, normalizeHidden, activeHiddenIds, msUntilNextExpiry, videoIdFromHref, parsePercent, shouldFilter, pageKey, channelKey, parseLines, channelInList, invalidKeywordLines, compileKeywords, parseAgeDays } = require("../lib.js");

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

test("channelKey extracts handles and channel ids", () => {
  assert.strictEqual(channelKey("/@SomeOne/videos"), "someone");
  assert.strictEqual(channelKey("/channel/UCabc"), "ucabc");
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
