const PAGE_URL = chrome.runtime.getURL("src/sync-page.html");

chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.tabs.query({ url: PAGE_URL });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: PAGE_URL });
});
