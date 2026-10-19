// Settings section for channel groups (storage.local "groups"). Loaded after popup.js and uses its helpers.
const groupList = document.getElementById("groupList");
const newGroupName = document.getElementById("newGroupName");
const openGroupIds = new Set();
let groups = [];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function saveGroups(next, focusKey) {
  groups = next;
  renderGroups(focusKey);
  chrome.storage.local.set({ groups: next });
}

// "@handle", "handle", or a pasted channel URL → { key, name }, or null.
function parseChannelInput(text) {
  const value = text.trim();
  if (!value) return null;
  if (!value.includes("/")) return { key: value, name: value.startsWith("@") ? value : `@${value}` };
  try {
    const path = new URL(value, "https://www.youtube.com").pathname;
    const key = channelKey(path);
    return key ? { key, name: decodeURIComponent(path.split("/")[1]) } : null;
  } catch {
    return null;
  }
}

function groupItem(group, index) {
  const item = el("details", { className: "group", open: openGroupIds.has(group.id) });
  item.addEventListener("toggle", () => (item.open ? openGroupIds.add(group.id) : openGroupIds.delete(group.id)));
  const count = `${group.hideFromFeed ? "hidden from feed · " : ""}${group.channels.length}`;
  item.append(el("summary", {}, group.name, el("span", { className: "group-count", textContent: count })));

  const name = el("input", { type: "text", value: group.name, maxLength: 200 });
  name.setAttribute("aria-label", "Group name");
  name.addEventListener("change", () => saveGroups(renameGroup(groups, group.id, name.value)));
  const up = el("button", { type: "button", className: "btn icon", textContent: "↑", title: "Move up", disabled: index === 0 });
  up.addEventListener("click", () => saveGroups(moveGroup(groups, group.id, -1)));
  const down = el("button", { type: "button", className: "btn icon", textContent: "↓", title: "Move down", disabled: index === groups.length - 1 });
  down.addEventListener("click", () => saveGroups(moveGroup(groups, group.id, 1)));
  // Two clicks to delete: no confirm() dialog, which Chrome may block in the embedded panel.
  const remove = el("button", { type: "button", className: "btn", textContent: "Delete" });
  remove.addEventListener("click", () => {
    if (remove.dataset.armed) return saveGroups(deleteGroup(groups, group.id));
    remove.dataset.armed = "1";
    remove.textContent = "Sure?";
  });

  const channels = el(
    "ul",
    { className: "group-channels" },
    ...group.channels.map((channel) => {
      const drop = el("button", { type: "button", textContent: "×", title: `Remove ${channel.name}` });
      drop.addEventListener("click", () => saveGroups(setChannelInGroup(groups, group.id, channel, false)));
      return el("li", {}, el("span", { textContent: channel.name, title: `@${channel.key}` }), drop);
    }),
  );

  const add = el("input", { type: "text", placeholder: "@handle or channel URL" });
  add.dataset.focus = `${group.id}:add`;
  add.setAttribute("aria-label", `Add a channel to ${group.name}`);
  const addBtn = el("button", { type: "button", className: "btn", textContent: "Add" });
  const addChannel = () => {
    const channel = parseChannelInput(add.value);
    if (channel) saveGroups(setChannelInGroup(groups, group.id, channel, true), add.dataset.focus);
  };
  addBtn.addEventListener("click", addChannel);
  add.addEventListener("keydown", (e) => e.key === "Enter" && addChannel());

  const hideBox = el("input", { type: "checkbox", checked: Boolean(group.hideFromFeed) });
  hideBox.addEventListener("change", () => saveGroups(setGroupHideFromFeed(groups, group.id, hideBox.checked)));
  const hideRow = el("label", { title: "Its videos still show when you open the group" }, hideBox, "Hide from the Subscriptions feed");

  item.append(el("div", { className: "row" }, name, up, down, remove), hideRow, channels, el("div", { className: "row" }, add, addBtn));
  return item;
}

function renderGroups(focusKey) {
  groupList.replaceChildren(...groups.map(groupItem));
  const hiddenFromFeed = groups.filter((g) => g.hideFromFeed).length;
  setStatus("groups", groups.length ? `${plural(groups.length, "group")}${hiddenFromFeed ? ` · ${hiddenFromFeed} hidden` : ""}` : "None");
  if (focusKey) groupList.querySelector(`[data-focus="${focusKey}"]`)?.focus();
}

function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;
  const id = Date.now().toString(36);
  openGroupIds.add(id);
  newGroupName.value = "";
  saveGroups(addGroup(groups, name, id), `${id}:add`);
}
document.getElementById("addGroupBtn").addEventListener("click", createGroup);
newGroupName.addEventListener("keydown", (e) => e.key === "Enter" && createGroup());

// Sync settings in this section, saved here because popup.js skips the groups section.
const groupView = document.getElementById("groupView");
const hideGroupedInGuide = document.getElementById("hideGroupedInGuide");
chrome.storage.sync.get({ groupView: DEFAULTS.groupView, hideGroupedInGuide: DEFAULTS.hideGroupedInGuide }, (s) => {
  groupView.value = s.groupView;
  hideGroupedInGuide.checked = s.hideGroupedInGuide;
});
groupView.addEventListener("change", () => chrome.storage.sync.set({ groupView: groupView.value }));
hideGroupedInGuide.addEventListener("change", () => chrome.storage.sync.set({ hideGroupedInGuide: hideGroupedInGuide.checked }));

chrome.storage.local.get({ groups: [] }, (s) => {
  groups = normalizeGroups(s.groups);
  renderGroups();
});
chrome.storage.onChanged.addListener((changes, area) => {
  // e.g. a backup import: popup.js's loadForm() doesn't fill this section
  if (area === "sync" && changes.groupView) groupView.value = changes.groupView.newValue ?? DEFAULTS.groupView;
  if (area === "sync" && changes.hideGroupedInGuide) hideGroupedInGuide.checked = changes.hideGroupedInGuide.newValue ?? DEFAULTS.hideGroupedInGuide;
  if (area !== "local" || !changes.groups) return;
  const next = normalizeGroups(changes.groups.newValue);
  if (JSON.stringify(next) === JSON.stringify(groups)) return; // our own save, already rendered
  groups = next;
  renderGroups();
});
