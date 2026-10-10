import { apiRequest, DEFAULT_API_URL, readSettings } from './api.js';

const settingsForm = document.getElementById('settings-form');
const apiUrlInput = document.getElementById('api-url');
const apiTokenInput = document.getElementById('api-token');
const statusText = document.getElementById('status');

// A self-hosted API on another host needs permission to be called (localhost is granted in the
// manifest). Requested first thing in the submit handler: Chrome only allows it during a user gesture,
// and it resolves to true at once when access is already granted.
function requestApiPermission(apiUrl) {
  return chrome.permissions.request({ origins: [`${new URL(apiUrl).origin}/*`] });
}

async function saveAndTest(submitEvent) {
  submitEvent.preventDefault();
  const apiUrl = apiUrlInput.value.trim() || DEFAULT_API_URL;
  const permissionRequest = requestApiPermission(apiUrl);
  statusText.textContent = 'Testing…';
  if (!(await permissionRequest)) {
    statusText.textContent = 'Permission to reach that API was not granted.';
    return;
  }
  await chrome.storage.local.set({ apiUrl, apiToken: apiTokenInput.value.trim() });
  try {
    const sessionDetails = await (await apiRequest('/auth/me')).json();
    statusText.textContent = `Connected as ${sessionDetails.username}.`;
  } catch (error) {
    statusText.textContent = error.message;
  }
}

readSettings().then(({ apiUrl, apiToken }) => {
  apiUrlInput.value = apiUrl;
  apiTokenInput.value = apiToken;
});
settingsForm.addEventListener('submit', (submitEvent) => void saveAndTest(submitEvent));
