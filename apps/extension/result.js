import { apiRequest, element, fetchImageObjectUrl, webAppUrl } from './api.js';

const searchParams = new URLSearchParams(location.search);
const imageUrl = searchParams.get('src') ?? '';
const outcomeCard = document.getElementById('outcome');

function showOutcome(...childList) {
  outcomeCard.replaceChildren(...childList);
}

function showError(message, ...extraList) {
  showOutcome(element('p', { className: 'message danger', textContent: message }), ...extraList);
}

// Images on sites outside the manifest's platform CDNs need the user's go-ahead, given with a click
function offerSitePermission(imageOrigin) {
  const allowButton = element('button', { className: 'primary', textContent: `Allow reading images from ${new URL(imageOrigin).host}` });
  allowButton.addEventListener('click', async () => {
    if (await chrome.permissions.request({ origins: [`${imageOrigin}/*`] })) void runCheck();
  });
  showError('The extension is not allowed to read images from this site yet.', element('div', { className: 'row' }, [allowButton]));
}

async function fetchProbeImage() {
  const imageOrigin = new URL(imageUrl).origin;
  if (!(await chrome.permissions.contains({ origins: [`${imageOrigin}/*`] }))) return { imageOrigin, imageBlob: undefined };
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Could not download the image (HTTP ${imageResponse.status})`);
  return { imageOrigin, imageBlob: await imageResponse.blob() };
}

async function renderMatch(checkMatch) {
  const thumbnail = element('img', { className: 'thumb', alt: `Original #${checkMatch.assetId}` });
  fetchImageObjectUrl(checkMatch.imagePath).then((objectUrl) => { thumbnail.src = objectUrl; }).catch(() => undefined);
  const badge = element('span', { className: checkMatch.isMatch ? 'badge approve' : 'badge', textContent: checkMatch.isMatch ? 'Match' : 'Not a match' });
  const details = element('div', {}, [
    element('div', { className: 'row' }, [badge, element('strong', { textContent: `${Math.round(checkMatch.confidence * 100)}% confidence` })]),
    element('p', { className: 'muted', textContent: `Original #${checkMatch.assetId} · PDQ distance ${checkMatch.pdqDistance}/256 · CLIP ${checkMatch.embedSimilarity.toFixed(3)}` }),
  ]);
  return element('li', {}, [thumbnail, details]);
}

async function renderResult(checkResult) {
  const bestMatch = checkResult.matchList[0];
  const headline = bestMatch?.isMatch
    ? element('p', { className: 'message approve', textContent: `This looks like your original #${bestMatch.assetId}.` })
    : element('p', { className: 'message', textContent: `No match above ${Math.round(checkResult.reviewThreshold * 100)}%. The closest originals are below.` });
  const matchList = element('ul', { className: 'match-list' }, await Promise.all(checkResult.matchList.map(renderMatch)));
  const appLink = element('a', { className: 'button', href: await webAppUrl('/originals'), target: '_blank', textContent: 'Open Repost Radar' });
  const watchHint = element('p', { className: 'muted', textContent: 'Found it somewhere you do not watch yet? Add the community or account under Sources so future copies are caught and queued for review.' });
  showOutcome(headline, checkResult.matchList.length ? matchList : element('p', { className: 'muted', textContent: 'You have no fingerprinted originals yet.' }), watchHint, element('div', { className: 'row' }, [appLink]));
}

async function runCheck() {
  showOutcome(element('p', { className: 'muted', textContent: 'Checking…' }));
  try {
    const { imageOrigin, imageBlob } = await fetchProbeImage();
    if (!imageBlob) return offerSitePermission(imageOrigin);
    const checkForm = new FormData();
    checkForm.append('file', imageBlob, 'checked-image');
    await renderResult(await (await apiRequest('/checks', { method: 'POST', body: checkForm })).json());
  } catch (error) {
    const optionsButton = element('button', { textContent: 'Open options' });
    optionsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
    showError(error.message, element('div', { className: 'row' }, [optionsButton]));
  }
}

document.getElementById('probe').src = imageUrl;
document.getElementById('source').textContent = searchParams.get('page') ? `From ${searchParams.get('page')}` : imageUrl;
void runCheck();
