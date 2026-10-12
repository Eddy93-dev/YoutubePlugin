importScripts("lib.js");

chrome.action.setBadgeBackgroundColor({ color: "#606060" });

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || typeof msg?.count !== "number") return;
  chrome.action.setBadgeText({ tabId, text: msg.count > 0 ? String(msg.count) : "" });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-watched") return;
  const { watchedEnabled } = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ watchedEnabled: !watchedEnabled });
});
