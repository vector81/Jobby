import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';

// Store the profile in the project folder so login is saved between runs
const PROFILE_DIR = 'E:\\job-auto-applier\\browser-profile';

let context: BrowserContext | null = null;

export async function launchBrowser(): Promise<Page> {
  console.log('🚀 Launching browser with saved profile...');

  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 300,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--start-maximized'
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: null
  });

  const page = context.pages()[0] || await context.newPage();
  console.log('✅ Browser ready\n');
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
}