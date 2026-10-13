// "Latest uploads" group view (settings: groupView = "feed"): instead of narrowing Subscriptions to a group, show the
// group's channels' recent uploads, read from each channel's public uploads feed (15 newest each). Fast, and it
// doesn't make YouTube page through the whole Subscriptions history. Shares globals with groups.js and content.js.
const GROUP_FEED_ID = "yth-group-feed";
const FEED_TTL_MS = 10 * 60 * 1000;
const FEED_CONCURRENCY = 6;
const FEED_MAX_VIDEOS = 300;

const feedCache = new Map(); // channel id → { at, videos }
let feedLoadToken = 0;

function groupFeedActive() {
  return settings.groupView === "feed" && activeGroup() !== null;
}

// The channel's UC… id: its key may already be one; otherwise read once from its page and remember it.
async function resolveChannelId(channel) {
  if (/^UC[\w-]{22}$/.test(channel.key)) return channel.key;
  if (channel.id) return channel.id;
  const res = await fetch(channelHref(channel.key));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const id = channelIdFromHtml(await res.text());
  if (!id) throw new Error("no channel id");
  saveChannelGroups(setChannelId(channelGroups, channel.key, id));
  return id;
}

async function channelUploads(channel) {
  const id = await resolveChannelId(channel);
  const cached = feedCache.get(id);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.videos;
  const res = await fetch(`/feeds/videos.xml?channel_id=${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const videos = parseChannelFeed(await res.text()).map((v) => ({ ...v, channel }));
  feedCache.set(id, { at: Date.now(), videos });
  return videos;
}

// Runs fn over items with at most `limit` in flight; onEach after every item, success or not.
async function forEachLimited(items, limit, fn, onEach) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } finally {
        onEach();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function feedCard(video, now) {
  const href = `/watch?v=${video.videoId}`;
  const thumb = h(
    "a",
    { className: "yth-feed-thumb", href },
    h("img", { src: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, alt: "", loading: "lazy" }),
  );
  if (video.isShort) thumb.append(h("span", { className: "yth-feed-badge", textContent: "Short" }));
  const title = h("a", { className: "yth-feed-title", href, title: video.title, textContent: video.title });
  const channel = h("a", { className: "yth-feed-channel", href: channelHref(video.channel.key), textContent: video.channel.name });
  const meta = [formatViews(video.views), formatAge(video.published, now)].filter(Boolean).join(" · ");
  const card = h("div", { className: "yth-feed-card" }, thumb, h("div", { className: "yth-feed-meta" }, title, channel, h("span", { textContent: meta })));
  for (const link of card.querySelectorAll("a")) {
    link.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // new-tab clicks go through
      e.preventDefault();
      navigateTo(link.getAttribute("href"));
    });
  }
  return card;
}

// Cards are re-rendered as each channel arrives; reusing them keeps thumbnails from reloading every time.
function cachedCard(state, video, now) {
  let card = state.cards.get(video.videoId);
  if (!card) {
    card = feedCard(video, now);
    state.cards.set(video.videoId, card);
  }
  return card;
}

function renderGroupFeed(feed, group, state) {
  const now = Date.now();
  const videos = state.videos
    .filter((v) => !(settings.hideShorts && v.isShort))
    .sort((a, b) => b.published - a.published)
    .slice(0, FEED_MAX_VIDEOS);
  const total = group.channels.length;
  const loading = state.done < total;
  const status = [
    loading ? `Loading ${state.done} of ${total} channels…` : `${videos.length} recent uploads from ${total} channel${total === 1 ? "" : "s"}`,
    state.failed.length ? `Couldn't load: ${state.failed.join(", ")}` : "",
  ].filter(Boolean);
  const header = h("div", { className: "yth-feed-header" }, h("h2", { textContent: `${group.name} · latest uploads` }), h("p", { textContent: status.join(" · ") }));
  const children = [header];
  if (!total) children.push(h("p", { className: "yth-feed-empty", textContent: "This group has no channels yet." }));
  else if (!videos.length && !loading) children.push(h("p", { className: "yth-feed-empty", textContent: "No uploads found." }));
  children.push(h("div", { className: "yth-feed-grid" }, ...videos.map((v) => cachedCard(state, v, now))));
  feed.replaceChildren(...children);
}

async function loadGroupFeed(feed, group) {
  const token = ++feedLoadToken;
  const state = { videos: [], done: 0, failed: [], cards: new Map() };
  renderGroupFeed(feed, group, state);
  await forEachLimited(
    group.channels,
    FEED_CONCURRENCY,
    async (channel) => {
      try {
        state.videos.push(...(await channelUploads(channel)));
      } catch {
        state.failed.push(channel.name); // shown in the header; the rest still load
      }
    },
    () => {
      state.done++;
      if (token === feedLoadToken && feed.isConnected) renderGroupFeed(feed, group, state);
    },
  );
}

// Called from ensureGroupsUI() on every pass: shows, refreshes or removes the feed view.
function updateGroupFeed() {
  const on = groupFeedActive();
  document.documentElement.toggleAttribute("data-yth-group-feed", on); // hides YouTube's own grid (content.css)
  let feed = document.getElementById(GROUP_FEED_ID);
  if (!on) {
    if (feed) {
      feed.remove();
      feedLoadToken++; // drop results still on their way
    }
    return;
  }
  const host = document.querySelector('ytd-browse[page-subtype="subscriptions"]:not([hidden]) #primary');
  if (!host) return;
  if (feed?.parentElement !== host) {
    feed?.remove();
    feed = h("div", { id: GROUP_FEED_ID });
    host.prepend(feed);
  }
  const group = activeGroup();
  // Reload when the group or its channels change (or Shorts hiding is toggled), not on every pass.
  const signature = JSON.stringify([group.id, group.channels.map((c) => c.key), settings.hideShorts]);
  if (feed.dataset.signature === signature) return;
  feed.dataset.signature = signature;
  loadGroupFeed(feed, group);
}
