const test = require("node:test");
const assert = require("node:assert");
const { MANUAL_TTL_MS, normalizeHidden, activeHiddenIds, videoIdFromHref, parsePercent, shouldFilter, pageKey, channelKey, parseChannelList, isChannelAllowed } = require("../lib.js");

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
  assert.strictEqual(pageKey("/@someone"), null);
});

test("channelKey extracts handles and channel ids", () => {
  assert.strictEqual(channelKey("/@SomeOne/videos"), "someone");
  assert.strictEqual(channelKey("/channel/UCabc"), "ucabc");
  assert.strictEqual(channelKey("/watch"), null);
});

test("parseChannelList drops blank lines and whitespace", () => {
  assert.deepStrictEqual(parseChannelList(" @a \n\n  Some Name\n"), ["@a", "Some Name"]);
});

test("isChannelAllowed matches handle, id or display name, ignoring case and @", () => {
  const allowed = ["@SomeOne", "Cool Channel"];
  assert.strictEqual(isChannelAllowed(allowed, ["someone"]), true);
  assert.strictEqual(isChannelAllowed(allowed, [null, " cool channel "]), true);
  assert.strictEqual(isChannelAllowed(allowed, ["other", "Other Name"]), false);
  assert.strictEqual(isChannelAllowed([], ["someone"]), false);
});
