// "Latest uploads" group view (settings: groupView = "feed"): instead of narrowing Subscriptions to a group, show the
// group's channels' uploads newest first, paged from each channel's Videos tab through YouTube's own browse API
// (30 per page, more as you scroll). Shares globals with groups.js and content.js.
const GROUP_FEED_ID = "yth-group-feed";
const FEED_CONCURRENCY = 6;
const FEED_STEP = 36; // cards added per scroll step
const FEED_PRELOAD_PX = 1200; // start loading this far before the bottom is reached

let feedLoadToken = 0;
let innertubeVersion = null;

function groupFeedActive() {
  return settings.groupView === "feed" && activeGroup() !== null;
}

// YouTube's web client version, from the page's inline config; the browse API wants it.
function clientVersion() {
  innertubeVersion ??= [...document.scripts]
    .map((s) => s.textContent.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1])
    .find(Boolean);
  if (!innertubeVersion) throw new Error("no client version");
  return innertubeVersion;
}

async function browse(body) {
  const context = { client: { clientName: "WEB", clientVersion: clientVersion(), hl: "en" } }; // English "… ago"
  const res = await fetch("/youtubei/v1/browse?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, ...body }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
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

// Fallback when the Videos tab can't be read: the public uploads feed (15 newest, exact dates).
async function channelUploads(channel, id) {
  const res = await fetch(`/feeds/videos.xml?channel_id=${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseChannelFeed(await res.text()).map((v) => ({ ...v, channel, viewsText: formatViews(v.views) }));
}

// Loads one more page of a channel (cs: { channel, id, videos, token, started, exhausted, failed }).
async function loadNextPage(cs) {
  try {
    cs.id ??= await resolveChannelId(cs.channel);
    const json = await browse(cs.started ? { continuation: cs.token } : { browseId: cs.id, params: VIDEOS_TAB_PARAMS });
    const { videos, token } = parseBrowseVideos(json);
    if (!cs.started && !videos.length) throw new Error("no videos tab"); // e.g. a Shorts-only channel
    const before = cs.videos.length;
    cs.videos = appendChannelPage(cs.videos, videos.map((v) => ({ ...v, channel: cs.channel })), Date.now());
    cs.started = true;
    cs.token = token;
    cs.exhausted = !token || cs.videos.length === before; // no progress: stop rather than loop
  } catch {
    cs.exhausted = true;
    if (cs.started) return; // keep what's loaded
    try {
      cs.videos = await channelUploads(cs.channel, cs.id);
      cs.started = true;
    } catch {
      cs.failed = true; // listed in the header; the rest still load
    }
  }
}

// Videos safe to show (see feedCutoff), newest first.
function visibleVideos(state) {
  const cutoff = feedCutoff(state.channels);
  return state.channels
    .flatMap((cs) => cs.videos)
    .filter((v) => v.published >= cutoff && !(settings.hideShorts && v.isShort))
    .sort((a, b) => b.published - a.published);
}

function feedCard(video) {
  const href = `/watch?v=${video.videoId}`;
  const thumb = h(
    "a",
    { className: "yth-feed-thumb", href },
    h("img", { src: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, alt: "", loading: "lazy" }),
  );
  const badge = video.isShort ? "Short" : video.duration;
  if (badge) thumb.append(h("span", { className: "yth-feed-badge", textContent: badge }));
  const title = h("a", { className: "yth-feed-title", href, title: video.title, textContent: video.title });
  const channel = h("a", { className: "yth-feed-channel", href: channelHref(video.channel.key), textContent: video.channel.name });
  const meta = [video.viewsText, video.ageText || formatAge(video.published, Date.now())].filter(Boolean).join(" · ");
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

// Cards are re-rendered as pages arrive; reusing them keeps thumbnails from reloading every time.
function cachedCard(state, video) {
  let card = state.cards.get(video.videoId);
  if (!card) {
    card = feedCard(video);
    state.cards.set(video.videoId, card);
  }
  return card;
}

function renderGroupFeed(state) {
  const { feed, group, channels } = state;
  const videos = visibleVideos(state);
  const total = channels.length;
  const ready = channels.filter((cs) => cs.started || cs.exhausted).length;
  const everything = channels.every((cs) => cs.exhausted);
  const failed = channels.filter((cs) => cs.failed).map((cs) => cs.channel.name);
  const status = [
    ready < total ? `Loading ${ready} of ${total} channels…` : `${videos.length} videos from ${total} channel${total === 1 ? "" : "s"}`,
    failed.length ? `Couldn't load: ${failed.join(", ")}` : "",
  ].filter(Boolean);
  const header = h("div", { className: "yth-feed-header" }, h("h2", { textContent: `${group.name} · latest uploads` }), h("p", { textContent: status.join(" · ") }));
  const children = [header];
  if (!total) children.push(h("p", { className: "yth-feed-empty", textContent: "This group has no channels yet." }));
  else if (!videos.length && everything) children.push(h("p", { className: "yth-feed-empty", textContent: "No uploads found." }));
  children.push(h("div", { className: "yth-feed-grid" }, ...videos.map((v) => cachedCard(state, v))));
  state.sentinel.textContent = state.filling ? "Loading more…" : everything && videos.length ? "That's everything." : "";
  children.push(state.sentinel);
  feed.replaceChildren(...children);
}

function feedIsLive(state) {
  return state.token === feedLoadToken && state.feed.isConnected;
}

function nearBottom(state) {
  return state.sentinel.getBoundingClientRect().top < innerHeight + FEED_PRELOAD_PX;
}

// Loads pages of the channels furthest behind until `target` videos show and the bottom is out of reach.
async function fillGroupFeed(state) {
  if (state.filling) return;
  state.filling = true;
  renderGroupFeed(state);
  try {
    while (feedIsLive(state)) {
      if (visibleVideos(state).length >= state.target && !nearBottom(state)) break;
      const picks = channelsToLoad(state.channels, FEED_CONCURRENCY);
      if (!picks.length) break;
      await Promise.all(picks.map(loadNextPage));
      if (feedIsLive(state)) renderGroupFeed(state);
    }
  } finally {
    state.filling = false;
    if (feedIsLive(state)) renderGroupFeed(state);
    else state.observer.disconnect();
  }
}

function loadGroupFeed(feed, group) {
  const state = {
    token: ++feedLoadToken,
    feed,
    group,
    channels: group.channels.map((channel) => ({ channel, id: channel.id ?? null, videos: [], token: null, started: false, exhausted: false })),
    cards: new Map(),
    target: FEED_STEP,
    filling: false,
    sentinel: h("div", { className: "yth-feed-sentinel" }),
  };
  // More as the bottom comes into reach.
  state.observer = new IntersectionObserver(
    (entries) => {
      if (!feedIsLive(state)) return state.observer.disconnect();
      if (!entries.some((e) => e.isIntersecting)) return;
      state.target = visibleVideos(state).length + FEED_STEP;
      fillGroupFeed(state);
    },
    { rootMargin: `0px 0px ${FEED_PRELOAD_PX}px 0px` },
  );
  state.observer.observe(state.sentinel);
  fillGroupFeed(state);
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
