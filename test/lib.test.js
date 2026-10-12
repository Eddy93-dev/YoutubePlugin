const test = require("node:test");
const assert = require("node:assert");
const { parsePercent, shouldFilter, pageKey, channelKey, parseChannelList, isChannelAllowed } = require("../lib.js");

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
