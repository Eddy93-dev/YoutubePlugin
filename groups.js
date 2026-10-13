// Channel groups on YouTube: a "Groups" section in the left guide, and filtering Subscriptions to one group.
// Shares globals with lib.js, panel.js and content.js (content.js calls ensureGroupsUI from run()).
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

// Groups whose channels are left out of the plain Subscriptions feed (not while a group is open there).
function subscriptionsFeedHiddenGroups() {
  if (!location.pathname.startsWith(SUBSCRIPTIONS_PATH) || activeGroup()) return [];
  return channelGroups.filter((g) => g.hideFromFeed && g.channels.length);
}

function setActiveGroup(id) {
  activeGroupId = id;
  storageSet(sessionStorage, ACTIVE_GROUP_KEY, id);
  renderGroupsSection();
  scheduleFullPass();
}

// Same-page navigation by clicking one of YouTube's own links to the same place (guide entries, cards in the
// Subscriptions grid even while hidden) when there is one; YouTube doesn't route plain links, so a full load otherwise.
function navigateTo(href) {
  const ours = `#${GROUPS_SECTION_ID}, #yth-group-feed`;
  const link = [...document.querySelectorAll(`ytd-app a[href="${CSS.escape(href)}"]`)].find((a) => !a.closest(ours));
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

// Avatars of subscribed channels, from the guide's own entries: lowercased handle/id and display name → image URL.
// By name too, because a channel added by hand may be stored under a different handle (filtering matches names too).
function guideAvatars() {
  const avatars = new Map();
  for (const a of document.querySelectorAll("ytd-guide-renderer ytd-guide-entry-renderer a#endpoint[href]")) {
    const key = channelKey(a.getAttribute("href"));
    const src = a.querySelector("img")?.src;
    if (!key || !src) continue;
    avatars.set(key.toLowerCase(), src);
    if (a.title) avatars.set(a.title.trim().toLowerCase(), src);
  }
  return avatars;
}

function lookupAvatar(avatars, key, name) {
  return avatars.get(key.toLowerCase()) ?? avatars.get(name.trim().toLowerCase());
}

// The channel's initial, until (or unless) a picture is known.
function avatarPlaceholder(channel) {
  const span = h("span", { className: "yth-group-avatar", textContent: channel.name.replace(/^@/, "").charAt(0).toUpperCase() });
  span.dataset.key = channel.key;
  span.dataset.name = channel.name;
  return span;
}

function avatarImage(channel, src) {
  const img = h("img", { className: "yth-group-avatar", src, alt: "" });
  img.addEventListener(
    "error",
    () => {
      const fallback = avatarPlaceholder(channel);
      delete fallback.dataset.key; // broken picture: don't retry it on every pass
      img.replaceWith(fallback);
    },
    { once: true },
  );
  return img;
}

// Guide pictures load lazily (and "Show more" entries appear later): swap placeholders as pictures turn up.
function fillAvatarPlaceholders(section) {
  const waiting = section.querySelectorAll("span.yth-group-avatar[data-key]");
  if (!waiting.length) return;
  const avatars = guideAvatars();
  for (const span of waiting) {
    const channel = { key: span.dataset.key, name: span.dataset.name };
    const src = lookupAvatar(avatars, channel.key, channel.name);
    if (src) span.replaceWith(avatarImage(channel, src));
  }
}

function channelRow(channel, avatars, group) {
  const href = channelHref(channel.key);
  // Live guide picture first (current), then the one saved when the channel was added.
  const src = lookupAvatar(avatars, channel.key, channel.name) ?? channel.avatar;
  const avatar = src ? avatarImage(channel, src) : avatarPlaceholder(channel);
  const link = h("a", { className: "yth-group-channel", href, title: channel.name }, avatar, h("span", { textContent: channel.name }));
  link.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
    e.preventDefault();
    navigateTo(href);
  });
  const remove = h("button", { type: "button", className: "yth-group-remove", textContent: "×", title: `Remove from ${group.name}` });
  remove.setAttribute("aria-label", `Remove ${channel.name} from ${group.name}`);
  remove.addEventListener("click", () => saveChannelGroups(setChannelInGroup(channelGroups, group.id, channel, false)));
  return h("div", { className: "yth-group-channel-row" }, link, remove);
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
  // Eye: whether this group's channels show in the plain Subscriptions feed (struck through = hidden from it).
  const hidden = Boolean(group.hideFromFeed);
  const eye = h("button", {
    type: "button",
    className: "yth-group-eye",
    title: hidden ? "Hidden from the Subscriptions feed. Click to show it there again" : "Click to hide this group from the Subscriptions feed",
  }, icon(hidden ? EYE_OFF_PATH : EYE_PATH));
  eye.setAttribute("aria-pressed", String(hidden));
  eye.setAttribute("aria-label", `Hide ${group.name} from the Subscriptions feed`);
  eye.addEventListener("click", () => saveChannelGroups(setGroupHideFromFeed(channelGroups, group.id, !hidden)));
  const row = h(
    "div",
    { className: "yth-group" + (active ? " yth-active" : "") + (hidden ? " yth-feed-hidden" : "") },
    h("div", { className: "yth-group-head" }, open, eye, toggle),
  );
  if (expanded) {
    const list = group.channels.length
      ? group.channels.map((c) => channelRow(c, avatars, group))
      : [h("p", { className: "yth-group-empty", textContent: "No channels yet. Use the folder button next to a channel." })];
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
  if (section?.parentElement === home && !section.nextElementSibling) return fillAvatarPlaceholders(section);
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

// --- Adding channels: a folder button on Subscriptions entries in the guide and on channel pages, both opening
// a small picker with a checkbox per group. ---
const PICK_CLASS = "yth-group-pick";
const CHANNEL_BUTTON_ID = "yth-channel-groups";
const PICKER_ID = "yth-group-picker";
const FOLDER_ADD_PATH =
  "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z";
let pickerAnchor = null;

function subscriptionsGuideSection() {
  return document
    .querySelector(`ytd-guide-renderer #sections a#endpoint[href="${SUBSCRIPTIONS_PATH}"]`)
    ?.closest("ytd-guide-section-renderer");
}

function makePickButton(extraClass, label) {
  const button = h("button", { type: "button", className: `${PICK_CLASS} ${extraClass}`, title: "Add to group" }, icon(FOLDER_ADD_PATH));
  button.setAttribute("aria-label", label);
  return button;
}

// Every subscribed channel in the guide (entries appear lazily, e.g. after "Show more") gets a folder button, and
// is left out of the list when it's in a group and "hide grouped channels" is on.
function ensureGuidePickButtons() {
  const section = subscriptionsGuideSection();
  if (!section) return;
  const grouped = settings.hideGroupedInGuide ? channelGroups.flatMap((g) => g.channels.flatMap((c) => [c.key, c.name])) : [];
  for (const entry of section.querySelectorAll("ytd-guide-entry-renderer")) {
    const link = entry.querySelector("a#endpoint");
    const href = link?.getAttribute("href");
    if (!href || !CHANNEL_PATH.test(href)) continue;
    if (!entry.querySelector(`:scope > .${PICK_CLASS}`)) {
      entry.classList.add("yth-guide-channel");
      entry.append(makePickButton("yth-guide-pick", "Add channel to a group"));
    }
    const hide = grouped.length > 0 && channelInList(grouped, [channelKey(href), link.title]);
    if (entry.classList.contains("yth-guide-grouped") !== hide) entry.classList.toggle("yth-guide-grouped", hide);
  }
}

// YouTube keeps earlier pages in the DOM, hidden (e.g. the "You" page also has a #page-header), so look only
// inside the channel page that is showing.
function channelPageHeader() {
  return document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden]) #page-header');
}

function currentPageChannel() {
  const key = channelKey(location.pathname);
  if (!key) return null; // old /c/ and /user/ URLs: no stable key
  const header = channelPageHeader();
  const name = header?.querySelector("h1")?.textContent.trim() || `@${key}`;
  const avatar = header?.querySelector("yt-avatar-shape img, yt-decorated-avatar-view-model img")?.src;
  return { key, name, avatar };
}

// "Groups" button next to Subscribe on channel pages; its label lists the groups the channel is in.
function ensureChannelPageButton() {
  const channel = pageKey(location.pathname) === "filterChannel" ? currentPageChannel() : null;
  const actions = channelPageHeader()?.querySelector("yt-flexible-actions-view-model");
  if (!channel || !actions) return;
  let button = document.getElementById(CHANNEL_BUTTON_ID);
  if (!button) {
    button = makePickButton("yth-channel-pick", "Channel groups");
    button.id = CHANNEL_BUTTON_ID;
    button.append(h("span"));
  }
  if (button.parentElement?.parentElement !== actions) {
    button.parentElement?.remove(); // our wrapper in a header YouTube re-rendered or replaced
    actions.append(h("div", { className: "ytFlexibleActionsViewModelAction" }, button));
  }
  const names = groupsForChannel(channelGroups, channel.key).map((g) => g.name);
  const label = names.length ? names.join(", ") : "Add to group";
  if (button.lastChild.textContent !== label) button.lastChild.textContent = label;
}

function closeGroupPicker() {
  document.getElementById(PICKER_ID)?.remove();
  pickerAnchor = null;
}

function pickerBody(channel) {
  const inGroups = new Set(groupsForChannel(channelGroups, channel.key).map((g) => g.id));
  const rows = channelGroups.map((g) => {
    const box = h("input", { type: "checkbox", checked: inGroups.has(g.id) });
    box.addEventListener("change", () => saveChannelGroups(setChannelInGroup(channelGroups, g.id, channel, box.checked)));
    return h("label", {}, box, h("span", { textContent: g.name }));
  });
  const input = h("input", { type: "text", placeholder: "New group, then Enter", maxLength: 200 });
  input.setAttribute("aria-label", "New group name");
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closeGroupPicker();
    if (e.key !== "Enter" || !input.value.trim()) return;
    const id = Date.now().toString(36);
    saveChannelGroups(setChannelInGroup(addGroup(channelGroups, input.value, id), id, channel, true));
    openGroupPicker(pickerAnchor, channel); // redraw with the new group ticked
    document.querySelector(`#${PICKER_ID} input[type="text"]`)?.focus();
  });
  return [h("p", { className: "yth-picker-title", textContent: `Add ${channel.name} to` }), ...rows, input];
}

function openGroupPicker(anchor, channel) {
  closeGroupPicker();
  pickerAnchor = anchor;
  const picker = h("div", { id: PICKER_ID }, ...pickerBody(channel));
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", `Groups for ${channel.name}`);
  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  const below = rect.bottom + 6;
  const top = below + picker.offsetHeight > innerHeight ? Math.max(8, rect.top - picker.offsetHeight - 6) : below;
  picker.style.top = `${top}px`;
  picker.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - picker.offsetWidth - 8))}px`;
  picker.querySelector("input")?.focus();
}

function channelForPickButton(button) {
  if (button.id === CHANNEL_BUTTON_ID) return currentPageChannel();
  const link = button.closest("ytd-guide-entry-renderer")?.querySelector("a#endpoint");
  const key = link && channelKey(link.getAttribute("href"));
  return key ? { key, name: link.title || `@${key}`, avatar: link.querySelector("img")?.src } : null;
}

// Capture phase, so the guide entry's own link and ripple never see clicks on our button.
function onPickClick(e) {
  const button = e.target.closest?.(`.${PICK_CLASS}`);
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  if (pickerAnchor === button) return closeGroupPicker();
  const channel = channelForPickButton(button);
  if (channel) openGroupPicker(button, channel);
}

document.addEventListener("click", onPickClick, true);
window.addEventListener(
  "pointerdown",
  (e) => {
    if (e.target.closest?.(`.${PICK_CLASS}`)) return e.stopPropagation(); // no ripple; click toggles the picker
    if (pickerAnchor && !e.target.closest?.(`#${PICKER_ID}`)) closeGroupPicker();
  },
  true,
);
document.addEventListener("keydown", (e) => e.key === "Escape" && pickerAnchor && closeGroupPicker(), true);
document.addEventListener("yt-navigate-finish", closeGroupPicker);

// Called from content.js run() on every pass.
function ensureGroupsUI() {
  ensureGroupsSection();
  ensureGuidePickButtons();
  ensureChannelPageButton();
  updateGroupBar();
  updateGroupFeed();
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
