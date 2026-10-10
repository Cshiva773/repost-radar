// Records the README demo: signs in to the mock UI, fills Settings, approves a match, shows the
// evidence pack and notice, dismisses the next match, then tours Sources and Originals.
// Run against `vite --mode mock` (see .github/workflows/demo.yml); writes a .webm to OUTPUT_DIR.
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.DEMO_URL ?? 'http://localhost:3100';
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'demo-output';
const MOCK_PASSWORD = 'change-me-local-only';
const VIEWPORT = { width: 1280, height: 800 };
const TYPING_DELAY_MS = 35;

const pause = (page, milliseconds) => page.waitForTimeout(milliseconds);

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`);
  await pause(page, 800);
  await page.getByLabel('Password').pressSequentially(MOCK_PASSWORD, { delay: TYPING_DELAY_MS });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await pause(page, 2200);
}

async function fillSettings(page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Legal name').pressSequentially('Dana Example', { delay: TYPING_DELAY_MS });
  await page.getByLabel('Contact email').pressSequentially('dana@example.com', { delay: TYPING_DELAY_MS });
  await page.getByLabel('Mailing address').pressSequentially('1 Example Street, Springfield', { delay: TYPING_DELAY_MS });
  await page.getByRole('button', { name: 'Save' }).click();
  await pause(page, 1400);
}

async function approveTopMatch(page) {
  await page.getByRole('link', { name: 'Review' }).click();
  await pause(page, 1500);
  await page.locator('main ul li a').first().click();
  await page.getByRole('heading', { name: /Candidate #/ }).waitFor();
  await pause(page, 2500);
  await page.getByPlaceholder(/Note \(optional\)/).pressSequentially('My photo from the 2025 trip', { delay: TYPING_DELAY_MS });
  await page.getByRole('heading', { name: /Candidate #/ }).click();
  await page.keyboard.press('a');
  await pause(page, 2200);
  await page.getByRole('checkbox').check();
  await pause(page, 900);
  await page.getByRole('button', { name: 'Approve and build pack' }).click();
  await page.getByRole('link', { name: 'Download ZIP' }).waitFor({ timeout: 15_000 });
  await pause(page, 1200);
  await page.locator('textarea[aria-label="Notice text"]').scrollIntoViewIfNeeded();
  await pause(page, 3000);
}

async function dismissNextMatch(page) {
  await page.getByRole('link', { name: /← Pending/ }).click();
  await pause(page, 1500);
  await page.locator('main ul li a').first().click();
  await page.getByRole('heading', { name: /Candidate #/ }).waitFor();
  await pause(page, 2000);
  await page.keyboard.press('d');
  await pause(page, 2200);
}

async function tourManagement(page) {
  await page.getByRole('link', { name: 'Sources' }).click();
  await pause(page, 2500);
  await page.getByRole('link', { name: 'Originals' }).click();
  await pause(page, 2500);
}

async function recordDemo() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', recordVideo: { dir: OUTPUT_DIR, size: VIEWPORT } });
  const page = await context.newPage();
  await signIn(page);
  await fillSettings(page);
  await approveTopMatch(page);
  await dismissNextMatch(page);
  await tourManagement(page);
  await context.close();
  await browser.close();
  const videoFile = (await readdir(OUTPUT_DIR)).find((fileName) => fileName.endsWith('.webm'));
  if (!videoFile) throw new Error('Playwright wrote no video');
  await rename(join(OUTPUT_DIR, videoFile), join(OUTPUT_DIR, 'demo.webm'));
  console.log(`Demo recorded to ${join(OUTPUT_DIR, 'demo.webm')}`);
}

recordDemo().catch((error) => {
  console.error('Demo recording failed', error);
  process.exit(1);
});
