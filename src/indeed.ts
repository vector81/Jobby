import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface Config {
  search: {
    keywords: string;
    location: string;
    platforms: string[];
  };
  personal: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    resumePath: string;
  };
  application: {
    maxApplications: number;
    delayBetweenApplications: number;
  };
  login?: {
    indeed?: { email: string; password: string };
    seek?: { email: string; password: string };
  };
}

const configPath = path.join(__dirname, 'config.json');
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

interface Job {
  title: string;
  company: string;
  location: string;
  url: string;
  applied: boolean;
}

export async function loginIndeed(page: Page): Promise<boolean> {
  const loginConfig = config.login?.indeed;
  
  if (!loginConfig?.email || !loginConfig?.password) {
    console.log('No Indeed login credentials in config - continuing without login');
    return false;
  }
  
  console.log('Logging into Indeed...');
  await page.goto('https://au.indeed.com/auth');
  await page.waitForLoadState('networkidle');
  
  // Check if already logged in
  const userAvatar = page.locator('[data-testid="user-avatar"], .user-avatar, [aria-label="User"]').first();
  if (await userAvatar.isVisible().catch(() => false)) {
    console.log('Already logged into Indeed');
    return true;
  }
  
  // Enter email
  const emailInput = page.locator('input[type="email"], input[id="email"], input[name="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(loginConfig.email);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }
  
  // Enter password
  const passwordInput = page.locator('input[type="password"], input[id="password"], input[name="password"]').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(loginConfig.password);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }
  
  // Verify login success
  if (await userAvatar.isVisible().catch(() => false)) {
    console.log('✓ Successfully logged into Indeed');
    return true;
  }
  
  console.log('⚠ Login may have failed - continuing anyway');
  return false;
}

export async function searchIndeed(page: Page): Promise<Job[]> {
  const keywords = config.search.keywords;
  const location = config.search.location;
  const searchUrl = `https://au.indeed.com/jobs?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}`;
  
  console.log(`Searching Indeed: ${keywords} in ${location}`);
  await page.goto(searchUrl);
  await page.waitForLoadState('networkidle');
  
  const jobs: Job[] = [];
  
  // Get job cards
  const jobCards = await page.locator('.jobsearch-ResultsList > li').all();
  
  for (const card of jobCards) {
    try {
      const titleEl = card.locator('.jobTitle');
      const companyEl = card.locator('.companyName');
      const locationEl = card.locator('.companyLocation');
      const linkEl = card.locator('a');
      
      const title = await titleEl.textContent().catch(() => '');
      const company = await companyEl.textContent().catch(() => '');
      const location = await locationEl.textContent().catch(() => '');
      const url = await linkEl.getAttribute('href').catch(() => '');
      
      if (title && url) {
        jobs.push({
          title: title.trim(),
          company: company?.trim() || 'Unknown',
          location: location?.trim() || 'Unknown',
          url: url.startsWith('http') ? url : `https://au.indeed.com${url}`,
          applied: false
        });
      }
    } catch (e) {
      // Skip failed cards
    }
  }
  
  console.log(`Found ${jobs.length} jobs`);
  return jobs;
}

export async function applyToJob(page: Page, job: Job): Promise<boolean> {
  try {
    console.log(`Applying to: ${job.title} at ${job.company}`);
    
    await page.goto(job.url);
    await page.waitForLoadState('networkidle');
    
    // Click apply button
    const applyButton = page.locator('button[data-testid="apply-button"], button:has-text("Apply"), button:has-text("Apply now")').first();
    
    if (await applyButton.isVisible().catch(() => false)) {
      await applyButton.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Fill form fields
    const { firstName, lastName, email, phone, resumePath } = config.personal;
    
    // Try to fill common field patterns
    await fillInputByLabel(page, 'first name', firstName);
    await fillInputByLabel(page, 'last name', lastName);
    await fillInputByLabel(page, 'full name', `${firstName} ${lastName}`);
    await fillInputByLabel(page, 'email', email);
    await fillInputByLabel(page, 'phone', phone);
    await fillInputByLabel(page, 'telephone', phone);
    
    // Upload resume if exists
    if (resumePath && fs.existsSync(resumePath)) {
      const resumeInput = page.locator('input[type="file"]').first();
      if (await resumeInput.isVisible().catch(() => false)) {
        await resumeInput.setInputFiles(resumePath);
      }
    }
    
    // Submit application
    const submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Send application")').first();
    
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();
      console.log(`✓ Applied to ${job.title}`);
      return true;
    }
    
    console.log(`✗ Could not submit for ${job.title}`);
    return false;
    
  } catch (e) {
    console.log(`✗ Error applying to ${job.title}:`, e);
    return false;
  }
}

async function fillInputByLabel(page: Page, label: string, value: string): Promise<void> {
  // Try various label matching strategies
  const patterns = [
    `input[id*="${label.toLowerCase().replace(/\s/g, '')}"]`,
    `input[name*="${label.toLowerCase().replace(/\s/g, '')}"]`,
    `input[placeholder*="${label}"i]`,
    `input[id*="${label.split(' ')[0].toLowerCase()}"]`
  ];
  
  for (const pattern of patterns) {
    const input = page.locator(pattern).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(value);
      return;
    }
  }
}
