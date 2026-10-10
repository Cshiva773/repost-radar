import { apiRequest, element, FILING_PAGE_BY_PLATFORM, webAppUrl } from './api.js';

const APPROVED_PAGE_SIZE = 5;
const approvedListContainer = document.getElementById('approved-list');

async function copyNotice(candidateId, copyButton) {
  try {
    const noticeDetails = await (await apiRequest(`/candidates/${candidateId}/notice`)).json();
    if (!noticeDetails.noticeText) throw new Error(noticeDetails.message || 'The notice is not ready yet');
    await navigator.clipboard.writeText(noticeDetails.noticeText);
    copyButton.textContent = 'Copied';
  } catch (error) {
    copyButton.textContent = 'Not ready';
    copyButton.title = error.message;
  }
}

function renderApprovedCandidate(candidate) {
  const filingPage = FILING_PAGE_BY_PLATFORM[candidate.platform];
  const copyButton = element('button', { className: 'primary', textContent: 'Copy notice' });
  copyButton.addEventListener('click', () => void copyNotice(candidate.candidateId, copyButton));
  const actionList = [copyButton];
  if (filingPage) actionList.push(element('a', { className: 'button', href: filingPage.url, target: '_blank', rel: 'noreferrer', textContent: `Open ${filingPage.label}` }));
  const title = candidate.postTitle || candidate.postUrl;
  return element('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, [
    element('p', { style: 'margin:0 0 4px', textContent: `#${candidate.candidateId} · ${title.length > 60 ? `${title.slice(0, 57)}…` : title}` }),
    element('div', { className: 'row' }, actionList),
  ]);
}

async function loadApproved() {
  try {
    const candidatePage = await (await apiRequest(`/candidates?status=approved&sort=newest&pageSize=${APPROVED_PAGE_SIZE}`)).json();
    if (!candidatePage.candidateList.length) {
      approvedListContainer.replaceChildren(element('p', { className: 'muted', textContent: 'No approved matches yet.' }));
      return;
    }
    const reviewLink = element('a', { href: await webAppUrl('/queue/decided'), target: '_blank', className: 'muted', textContent: 'All decisions in Repost Radar' });
    approvedListContainer.replaceChildren(...candidatePage.candidateList.map(renderApprovedCandidate), reviewLink);
  } catch (error) {
    approvedListContainer.replaceChildren(element('p', { className: 'message danger', textContent: error.message }));
  }
}

document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
void loadApproved();
