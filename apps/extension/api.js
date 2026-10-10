// Shared by the extension pages: settings in chrome.storage.local and calls to the Repost Radar API
// with the personal access token (Settings > Browser extension tokens in the web app).
export const DEFAULT_API_URL = 'http://localhost:3000/api';

// Where each platform explains how to file a copyright notice (official pages, linked to the form)
export const FILING_PAGE_BY_PLATFORM = {
  reddit: { label: "Reddit's copyright form", url: 'https://support.reddithelp.com/hc/en-us/articles/360043076292-Copyright-overview' },
  bluesky: { label: "Bluesky's copyright policy", url: 'https://bsky.social/about/support/copyright' },
};

export async function readSettings() {
  const { apiUrl, apiToken } = await chrome.storage.local.get(['apiUrl', 'apiToken']);
  return { apiUrl: (apiUrl || DEFAULT_API_URL).replace(/\/+$/, ''), apiToken: apiToken || '' };
}

export async function apiRequest(requestPath, requestInit = {}) {
  const { apiUrl, apiToken } = await readSettings();
  if (!apiToken) throw new Error('Add your API token in the extension options first.');
  const apiResponse = await fetch(`${apiUrl}${requestPath}`, {
    ...requestInit, headers: { ...(requestInit.headers || {}), Authorization: `Bearer ${apiToken}` },
  });
  if (!apiResponse.ok) {
    const errorBody = await apiResponse.json().catch(() => ({}));
    throw new Error(errorBody.message || `Repost Radar answered HTTP ${apiResponse.status}`);
  }
  return apiResponse;
}

// Asset thumbnails need the token too, so they are fetched and shown as blob URLs
export async function fetchImageObjectUrl(requestPath) {
  const imageResponse = await apiRequest(requestPath);
  return URL.createObjectURL(await imageResponse.blob());
}

// The web app lives next to the API (nginx serves both); used for "Open in Repost Radar" links
export async function webAppUrl(appPath) {
  const { apiUrl } = await readSettings();
  return `${apiUrl.replace(/\/api$/, '')}${appPath}`;
}

export function element(tagName, properties = {}, childList = []) {
  const createdElement = Object.assign(document.createElement(tagName), properties);
  createdElement.append(...childList);
  return createdElement;
}
