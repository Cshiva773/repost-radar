// Browser side of test areas M, O and P (test sheet, 10 Nov), against a running local stack after
// scripts/journey-check.sh (which leaves the creator priya@example.com fully set up). Never stops at a failure:
// every case prints "RESULT <id> <PASS|FAIL> <what was seen>" and is appended to journey-results.tsv.
//   node apps/web/scripts/journeyUi.mjs
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const REPO_ROOT = process.env.REPO_ROOT ?? process.cwd();
const RESULTS_FILE = process.env.RESULTS_FILE ?? join(REPO_ROOT, 'journey-results.tsv');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const PRIYA_LOGIN = { email: 'priya@example.com', password: 'priya-password-1234' };
const STEP_TIMEOUT_MS = 15_000;

function record(caseId, verdict, observedText) {
  console.log(`RESULT ${caseId} ${verdict} ${observedText}`);
  appendFileSync(RESULTS_FILE, `${caseId}\t${verdict}\t${observedText}\n`);
}

// Runs one case; an exception is a FAIL with its message, never the end of the run
async function runCase(caseId, caseBody) {
  try {
    const [verdict, observedText] = await caseBody();
    record(caseId, verdict, observedText);
  } catch (error) {
    record(caseId, 'FAIL', `error: ${String(error.message).split('\n')[0]}`);
  }
}

function compose(commandText, extraEnvironment = {}) {
  execSync(`docker compose ${commandText}`, { cwd: REPO_ROOT, stdio: 'ignore', env: { ...process.env, ...extraEnvironment } });
}

async function waitForApi() {
  for (let attemptNumber = 0; attemptNumber < 60; attemptNumber++) {
    try { if ((await fetch(`${BASE_URL}/api/health`)).ok) return; } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('API did not come back');
}

async function signIn(page, username, password) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/queue/**', { timeout: STEP_TIMEOUT_MS });
}

async function textOf(page, selector) {
  return (await page.locator(selector).allInnerTexts()).join(' | ');
}

async function saveSettings(page, fieldValueByLabel) {
  await page.goto(`${BASE_URL}/settings`);
  await page.getByLabel('Display name').waitFor();
  for (const [fieldLabel, fieldValue] of Object.entries(fieldValueByLabel)) await page.getByLabel(fieldLabel, { exact: true }).fill(fieldValue);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved.').waitFor({ timeout: STEP_TIMEOUT_MS });
  await page.waitForTimeout(800);
  return textOf(page, 'form [role="status"]');
}

async function checklistText(page) {
  await page.goto(`${BASE_URL}/queue/pending`);
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await page.waitForTimeout(1500);
  const checklist = page.getByText(/\d of 3 done/);
  return (await checklist.count()) ? checklist.first().innerText() : 'no checklist';
}

async function newCreatorJourney(browser) {
  const page = await (await browser.newContext()).newPage();
  await runCase('M1', async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Your name').fill('Uma');
    await page.getByLabel('Email').fill('uma@example.com');
    await page.getByLabel('Password').fill('uma-password-12345');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/queue/pending', { timeout: STEP_TIMEOUT_MS });
    const headerText = await page.locator('header').innerText();
    const progressText = await checklistText(page);
    const isOk = headerText.includes('Uma') && progressText.includes('0 of 3 done');
    return [isOk ? 'PASS' : 'FAIL', `browser: landed on Review; header shows ${headerText.includes('Uma') ? 'Uma' : 'no name'}; checklist "${progressText}"`];
  });
  await runCase('M6', async () => {
    await page.goBack();
    await page.waitForTimeout(1500);
    const afterBack = page.url();
    const formShownAfterBack = await page.getByRole('button', { name: 'Create account' }).count();
    await page.goto(`${BASE_URL}/signup`);
    await page.waitForTimeout(1500);
    const afterTyped = page.url();
    const isOk = !formShownAfterBack && afterTyped.endsWith('/queue/pending');
    return [isOk ? 'PASS' : 'FAIL', `Back → ${new URL(afterBack).pathname} (sign-up form shown: ${Boolean(formShownAfterBack)}); typed /signup → ${new URL(afterTyped).pathname}`];
  });
  await runCase('M9', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: STEP_TIMEOUT_MS });
    return ['PASS', 'still signed in after reload (Sign out visible)'];
  });
  await runCase('O1', async () => {
    const noteText = await saveSettings(page, { 'Legal name': 'Uma Writer', 'Mailing address': '' });
    const linkLabel = await page.locator('form [role="status"] a').first().innerText().catch(() => 'no link');
    await page.locator('form [role="status"] a').first().click();
    await page.waitForTimeout(1000);
    const isOk = noteText.includes('Still needed for your notices: mailing address') && linkLabel.includes('Add originals') && page.url().endsWith('/originals');
    return [isOk ? 'PASS' : 'FAIL', `note "${noteText}"; link "${linkLabel}" → ${new URL(page.url()).pathname}`];
  });
  await runCase('O8', async () => {
    await page.goto(`${BASE_URL}/settings`);
    await page.getByLabel('Display name').waitFor();
    await page.waitForTimeout(800);
    const legalName = await page.getByLabel('Legal name', { exact: true }).inputValue();
    const noteCount = await page.locator('form [role="status"]').count();
    const progressText = await checklistText(page);
    const isOk = legalName === 'Uma Writer' && progressText.includes('0 of 3 done');
    return [isOk ? 'PASS' : 'FAIL', `after reload legal name "${legalName}", note shown: ${noteCount > 0}; Review checklist "${progressText}"`];
  });
  await runCase('O2', async () => {
    const noteText = await saveSettings(page, { 'Mailing address': '5 Uma Street' });
    const progressText = await checklistText(page);
    const isOk = noteText.includes('Next, add the photos you want to protect.') && noteText.includes('Add originals') && progressText.includes('1 of 3 done');
    return [isOk ? 'PASS' : 'FAIL', `note "${noteText}"; Review checklist "${progressText}"`];
  });
  await runCase('O5', async () => {
    const noteText = await saveSettings(page, { 'Legal name': '   ' });
    const progressText = await checklistText(page);
    const isOk = noteText.includes('legal name') && progressText.includes('0 of 3 done');
    return [isOk ? 'PASS' : 'FAIL', `note "${noteText}"; Review checklist "${progressText}"`];
  });
  await runCase('O6', async () => {
    await saveSettings(page, { 'Legal name': 'Uma Writer' });
    await page.goto(`${BASE_URL}/originals`);
    await page.locator('input[type="file"]').setInputFiles({ name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not really a picture') });
    await page.waitForTimeout(3000);
    const pageText = await page.locator('main').innerText();
    const fileLine = pageText.split('\n').find((lineText) => lineText.includes('holiday.jpg')) ?? 'no line for the file';
    const hasNote = pageText.includes('None of those files were added');
    return [hasNote ? 'PASS' : 'FAIL', `file line "${fileLine.trim()}"; next-step note ${hasNote ? 'shown' : 'not shown (nothing says what to do next)'}`];
  });
  await page.context().close();
}

async function setUpCreatorJourney(browser) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, PRIYA_LOGIN.email, PRIYA_LOGIN.password);
  await runCase('O3', async () => {
    const noteText = await saveSettings(page, { 'Display name': 'Priya K' });
    const progressText = await checklistText(page);
    const isOk = noteText.includes("You're set up.") && noteText.includes('Go to Review') && progressText === 'no checklist';
    return [isOk ? 'PASS' : 'FAIL', `note "${noteText}"; Review checklist: ${progressText}`];
  });
  await runCase('P1', async () => {
    await page.goto(`${BASE_URL}/queue/decided`);
    await page.locator('a[href^="/candidates/"]').first().click();
    await page.waitForURL('**/candidates/**');
    await page.getByRole('link', { name: 'Repost Radar' }).click();
    await page.waitForTimeout(800);
    const afterClick = new URL(page.url()).pathname;
    await page.goto(`${BASE_URL}/settings`);
    await page.getByRole('link', { name: 'Repost Radar' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const afterEnter = new URL(page.url()).pathname;
    const isOk = afterClick === '/queue/pending' && afterEnter === '/queue/pending';
    return [isOk ? 'PASS' : 'FAIL', `click from a match → ${afterClick}; Enter from Settings → ${afterEnter}`];
  });
  await runCase('O4', async () => {
    const noteText = await saveSettings(page, { 'Mailing address': '' });
    const progressText = await checklistText(page);
    await saveSettings(page, { 'Mailing address': '7 Creator Lane' });
    const isOk = noteText.includes('mailing address') && noteText.includes('Go to Review') && progressText.includes('2 of 3 done');
    return [isOk ? 'PASS' : 'FAIL', `browser: note "${noteText}"; Review checklist "${progressText}"`];
  });
  await runCase('O7', async () => {
    await page.goto(`${BASE_URL}/sources`);
    await page.getByRole('button', { name: 'Pause' }).first().click();
    await page.getByRole('button', { name: 'Resume' }).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    const sourcesText = await page.locator('main').innerText();
    const hasNote = sourcesText.includes('No source is switched on yet');
    const pausedChecklist = await checklistText(page);
    await page.goto(`${BASE_URL}/sources`);
    await page.getByRole('button', { name: 'Resume' }).first().click();
    await page.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    const resumedChecklist = await checklistText(page);
    const isOk = hasNote && pausedChecklist.includes('2 of 3 done') && resumedChecklist === 'no checklist';
    return [isOk ? 'PASS' : 'FAIL', `after pausing the only source: note ${hasNote ? 'shown' : 'not shown'}, checklist "${pausedChecklist}"; after resuming: ${resumedChecklist}`];
  });
  await page.context().close();
}

async function operatorJourney(browser) {
  const page = await (await browser.newContext()).newPage();
  await runCase('P2', async () => {
    await page.goto(`${BASE_URL}/login`);
    const hintCount = await page.getByText('ADMIN_USERNAME').count();
    await signIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    return [hintCount === 0 ? 'PASS' : 'FAIL', `browser: no operator hint on the page (${hintCount} found); "${ADMIN_USERNAME}" in the Email field signs in`];
  });
  await page.context().close();
}

async function signupPageWhileApiStarts(browser) {
  await runCase('M8', async () => {
    compose('stop api');
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE_URL}/signup`);
    await page.waitForTimeout(2000);
    compose('start api');
    await waitForApi();
    await page.waitForTimeout(5000);
    const saysOff = await page.getByText('Sign-up is turned off').count();
    const buttonDisabled = await page.getByRole('button', { name: 'Create account' }).isDisabled();
    await page.context().close();
    const isOk = !saysOff && !buttonDisabled;
    return [isOk ? 'PASS' : 'FAIL', `after the API came up (sign-up is ON): page ${saysOff ? 'still says "Sign-up is turned off"' : 'does not claim it is off'}, button ${buttonDisabled ? 'disabled' : 'enabled'}, without a reload`];
  });
}

async function signupTurnedOff(browser) {
  await runCase('M7', async () => {
    compose('up -d --wait api', { SIGNUP_ENABLED: 'false' });
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
    await page.waitForTimeout(1500);
    const linkCount = await page.getByRole('link', { name: 'Create an account' }).count();
    await page.goto(`${BASE_URL}/signup`);
    await page.waitForTimeout(1500);
    const saysOff = await page.getByText('Sign-up is turned off').count();
    const buttonDisabled = await page.getByRole('button', { name: 'Create account' }).isDisabled();
    const apiStatus = (await fetch(`${BASE_URL}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'off@example.com', password: 'off-password-12345' }) })).status;
    await page.context().close();
    compose('up -d --wait api');
    const isOk = linkCount === 0 && saysOff > 0 && buttonDisabled && apiStatus === 403;
    return [isOk ? 'PASS' : 'FAIL', `sign-in page link: ${linkCount ? 'shown' : 'hidden'}; /signup says off: ${saysOff > 0}, button disabled: ${buttonDisabled}; API ${apiStatus}`];
  });
}

const browser = await chromium.launch();
await newCreatorJourney(browser);
await setUpCreatorJourney(browser);
await operatorJourney(browser);
await signupPageWhileApiStarts(browser);
await signupTurnedOff(browser);
await browser.close();
