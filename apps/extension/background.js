// Adds "Check against Repost Radar" to the right-click menu on images. The check itself runs in
// result.html, an extension page that can ask for permission to read images from other sites.
const CHECK_MENU_ID = 'repost-radar-check-image';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: CHECK_MENU_ID, title: 'Check against Repost Radar', contexts: ['image'] });
});

chrome.contextMenus.onClicked.addListener((clickInfo) => {
  if (clickInfo.menuItemId !== CHECK_MENU_ID || !clickInfo.srcUrl) return;
  const resultUrl = new URL(chrome.runtime.getURL('result.html'));
  resultUrl.searchParams.set('src', clickInfo.srcUrl);
  if (clickInfo.pageUrl) resultUrl.searchParams.set('page', clickInfo.pageUrl);
  chrome.tabs.create({ url: resultUrl.toString() });
});
