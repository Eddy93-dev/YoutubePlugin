// Channel groups on YouTube: a "Groups" section in the left guide, and filtering Subscriptions to one group.
// Shares globals with lib.js, panel.js and content.js (content.js calls ensureGroupsSection / updateGroupBar from run()).
const GROUPS_SECTION_ID = "yth-groups";
const GROUP_BAR_ID = "yth-group-bar";
const ACTIVE_GROUP_KEY = "yth-active-group"; // sessionStorage: survives reloads of this tab only
const EXPANDED_GROUPS_KEY = "yth-expanded-groups"; // localStorage
const SUBSCRIPTIONS_PATH = "/feed/subscriptions";
const SVG_NS = "http://www.w3.org/2000/svg";
const FOLDER_PATH = "M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z";
const CHEVRON_PATH = "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z";

let channelGroups = [];
let activeGroupId = storageGet(sessionStorage, ACTIVE_GROUP_KEY);
// The first navigation (page load) and the ones we start ourselves keep the active group; others clear it.
let groupNavPending = true;
let expandedGroups = new Set(readJsonArray(storageGet(localStorage, EXPANDED_GROUPS_KEY)));

// Web storage can throw (blocked site data); it's a convenience here, so failures just fall back.
function storageGet(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(store, key, value) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // not remembered; harmless
  }
}
function readJsonArray(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function icon(path) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

// The group Subscriptions is filtered to right now, or null.
function activeGroup() {
  if (!location.pathname.startsWith(SUBSCRIPTIONS_PATH)) return null;
  return channelGroups.find((g) => g.id === activeGroupId) ?? null;
}

function setActiveGroup(id) {
  activeGroupId = id;
  storageSet(sessionStorage, ACTIVE_GROUP_KEY, id);
  renderGroupsSection();
  scheduleFullPass();
}

// Same-page navigation through YouTube's own guide link when there is one; a full load otherwise.
function navigateTo(href) {
  const link = document.querySelector(`ytd-guide-renderer a#endpoint[href="${CSS.escape(href)}"]`);
  if (link) link.click();
  else location.assign(href);
}

function openGroup(id) {
  if (id === activeGroupId && activeGroup()) {
    setActiveGroup(null); // clicking the active group again shows everything
    return;
  }
  expandedGroups.add(id);
  saveExpanded();
  setActiveGroup(id);
  if (!location.pathname.startsWith(SUBSCRIPTIONS_PATH)) {
    groupNavPending = true;
    navigateTo(SUBSCRIPTIONS_PATH);
  }
}

function saveExpanded() {
  storageSet(localStorage, EXPANDED_GROUPS_KEY, JSON.stringify([...expandedGroups]));
}

// Avatars of subscribed channels, from the guide's own entries (lowercased key → image URL).
function guideAvatars() {
  const avatars = new Map();
  for (const a of document.querySelectorAll("ytd-guide-renderer ytd-guide-entry-renderer a#endpoint[href]")) {
    const key = channelKey(a.getAttribute("href"));
    const src = a.querySelector("img")?.src;
    if (key && src) avatars.set(key.toLowerCase(), src);
  }
  return avatars;
}

function channelRow(channel, avatars) {
  const href = channelHref(channel.key);
  const src = avatars.get(channel.key.toLowerCase());
  const avatar = src
    ? h("img", { className: "yth-group-avatar", src, alt: "" })
    : h("span", { className: "yth-group-avatar", textContent: channel.name.replace(/^@/, "").charAt(0).toUpperCase() });
  const link = h("a", { className: "yth-group-channel", href, title: channel.name }, avatar, h("span", { textContent: channel.name }));
  link.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
    e.preventDefault();
    navigateTo(href);
  });
  return link;
}

function groupRow(group, avatars) {
  const expanded = expandedGroups.has(group.id);
  const active = group.id === activeGroup()?.id;
  const open = h(
    "button",
    { type: "button", className: "yth-group-open", title: active ? "Show all subscriptions" : `Show only ${group.name} on Subscriptions` },
    icon(FOLDER_PATH),
    h("span", { className: "yth-group-name", textContent: group.name }),
    h("span", { className: "yth-group-count", textContent: group.channels.length }),
  );
  open.setAttribute("aria-pressed", String(active));
  open.addEventListener("click", () => openGroup(group.id));
  const toggle = h("button", { type: "button", className: "yth-group-toggle", title: expanded ? "Collapse" : "Expand" }, icon(CHEVRON_PATH));
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.addEventListener("click", () => {
    if (expandedGroups.has(group.id)) expandedGroups.delete(group.id);
    else expandedGroups.add(group.id);
    saveExpanded();
    renderGroupsSection();
  });
  const row = h("div", { className: "yth-group" + (active ? " yth-active" : "") }, h("div", { className: "yth-group-head" }, open, toggle));
  if (expanded) {
    const list = group.channels.length
      ? group.channels.map((c) => channelRow(c, avatars))
      : [h("p", { className: "yth-group-empty", textContent: "No channels yet. Add them from the settings panel." })];
    row.append(h("div", { className: "yth-group-channels" }, ...list));
  }
  return row;
}

// Inline "new group" field under the header.
function newGroupForm() {
  const input = h("input", { type: "text", className: "yth-group-input", placeholder: "Group name, then Enter", maxLength: 200 });
  input.setAttribute("aria-label", "New group name");
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep YouTube's and our own shortcuts out of the text field
    if (e.key === "Escape") input.remove();
    if (e.key !== "Enter" || !input.value.trim()) return;
    saveChannelGroups(addGroup(channelGroups, input.value, Date.now().toString(36)));
  });
  return input;
}

function renderGroupsSection() {
  const section = document.getElementById(GROUPS_SECTION_ID);
  if (!section) return;
  const avatars = guideAvatars();
  const add = h("button", { type: "button", className: "yth-group-add", title: "New group", textContent: "+" });
  const header = h("div", { className: "yth-groups-header" }, h("h3", { textContent: "Groups" }), add);
  add.addEventListener("click", () => {
    const input = section.querySelector(".yth-group-input") ?? newGroupForm();
    header.after(input);
    input.focus();
  });
  section.replaceChildren(header, ...channelGroups.map((g) => groupRow(g, avatars)));
  if (!channelGroups.length) section.append(h("p", { className: "yth-group-empty", textContent: "Sort your subscriptions into groups with +." }));
}

// Keeps our section at the end of the guide's first section (Home, Shorts), i.e. just above Subscriptions.
// It goes inside that section rather than between sections: YouTube re-orders #sections' children when a
// foreign node sits among them. YouTube can re-render the guide, so this runs on every pass.
function ensureGroupsSection() {
  const home = document.querySelector('ytd-guide-renderer #sections a#endpoint[href="/"]')?.closest("ytd-guide-section-renderer");
  if (!home) return;
  let section = document.getElementById(GROUPS_SECTION_ID);
  if (section?.parentElement === home && !section.nextElementSibling) return;
  section ??= h("div", { id: GROUPS_SECTION_ID });
  home.append(section);
  renderGroupsSection();
}

function updateGroupBar() {
  const group = activeGroup();
  document.documentElement.toggleAttribute("data-yth-group", Boolean(group)); // hides the feed's shelves (content.css)
  let bar = document.getElementById(GROUP_BAR_ID);
  if (!group) {
    bar?.remove();
    return;
  }
  if (!bar) {
    const all = h("button", { type: "button", textContent: "Show all" });
    all.addEventListener("click", () => setActiveGroup(null));
    bar = h("div", { id: GROUP_BAR_ID }, h("span"), all);
    bar.setAttribute("role", "status");
    document.body.append(bar);
  }
  bar.firstChild.textContent = `${group.name} · ${group.channels.length} channel${group.channels.length === 1 ? "" : "s"}`;
}

function saveChannelGroups(next) {
  channelGroups = next;
  renderGroupsSection();
  scheduleFullPass();
  if (chrome.runtime?.id) chrome.storage.local.set({ groups: next }); // gone after the extension reloads
}

chrome.storage.local.get({ groups: [] }, (stored) => {
  channelGroups = normalizeGroups(stored.groups);
  renderGroupsSection();
  scheduleFullPass();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.groups) return;
  channelGroups = normalizeGroups(changes.groups.newValue);
  renderGroupsSection();
  scheduleFullPass();
});
document.addEventListener("yt-navigate-finish", () => {
  if (!groupNavPending && location.pathname.startsWith(SUBSCRIPTIONS_PATH)) setActiveGroup(null);
  groupNavPending = false;
  renderGroupsSection(); // highlight follows the page
});
