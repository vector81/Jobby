import { Page } from 'playwright';
import * as fs from 'fs';

interface Config {
  search: {
    keywords: string[];
    location: string;
    maxPages: number;
  };
  personal: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    resumePath: string;
  };
}

const config: Config = JSON.parse(fs.readFileSync(`${__dirname}/config.json`, 'utf-8'));

// ── Pre-defined answers to common screening questions ──────────────────────────
const SCREENING_ANSWERS: Record<string, string> = {
  'right to work':        'Yes',
  'work in australia':    'Yes',
  'australian citizen':   'Yes',
  'visa':                 'Yes',
  'salary':               '65000',
  'expected salary':      '65000',
  'salary expectation':   '65000',
  'years of experience':  '2',
  'how many years':       '2',
  'experience':           '2',
  'notice period':        '2 weeks',
  'available':            'Immediately',
  'start date':           'Immediately',
  'full time':            'Yes',
  'part time':            'Yes',
};

// Saved answers — loaded from file so they persist between runs
const ANSWERS_FILE = 'E:\\job-auto-applier\\saved-answers.json';
let savedAnswers: Record<string, string> = {};
try {
  if (fs.existsSync(ANSWERS_FILE)) {
    savedAnswers = JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf-8'));
    console.log(`📚 Loaded ${Object.keys(savedAnswers).length} saved answers from previous sessions`);
  }
} catch {}

function persistAnswer(question: string, answer: string): void {
  savedAnswers[question] = answer;
  try { fs.writeFileSync(ANSWERS_FILE, JSON.stringify(savedAnswers, null, 2)); } catch {}
}

export interface Job {
  title: string;
  company: string;
  location: string;
  workType: string;
  salary: string;
  url: string;
  applied: boolean;
  appliedAt?: string;
  platform: string;
  keyword: string;
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────────

export async function loginSeek(page: Page): Promise<void> {
  console.log('🔐 Checking Seek login status...');
  await page.goto('https://www.seek.com.au', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Strictly check for the profile avatar/menu that only appears when logged in
  const isLoggedIn = await page.evaluate(() => {
    return !!(
      document.querySelector('[data-automation="header-profile"]') ||
      document.querySelector('[data-testid="header-profile-menu"]') ||
      document.querySelector('[aria-label="Account menu"]')
    );
  });

  if (isLoggedIn) {
    console.log('✅ Already logged into Seek — skipping login!\n');
    return;
  }

  // Not logged in — send to login page and wait for user
  console.log('🔐 Not logged in. Please log into Seek in the browser window.');
  console.log('   Waiting up to 90 seconds...\n');
  await page.goto('https://www.seek.com.au/oauth/login', { waitUntil: 'domcontentloaded' });

  try {
    // Wait until one of the logged-in indicators appears
    await page.waitForSelector(
      '[data-automation="header-profile"], [data-testid="header-profile-menu"], [aria-label="Account menu"]',
      { timeout: 90000 }
    );
    console.log('✅ Logged in successfully — saved for next time!\n');
  } catch {
    console.log('⚠️  Could not confirm login — continuing anyway\n');
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

export async function searchSeek(page: Page): Promise<Job[]> {
  const allJobs: Job[] = [];
  const seenUrls = new Set<string>();

  for (const keyword of config.search.keywords) {
    console.log(`\n🔍 Searching: "${keyword}" in ${config.search.location}`);

    for (let pageNum = 1; pageNum <= config.search.maxPages; pageNum++) {
      const url =
        `https://www.seek.com.au/jobs?` +
        `keywords=${encodeURIComponent(keyword)}` +
        `&where=${encodeURIComponent(config.search.location)}` +
        `&page=${pageNum}`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);

      const jobs = await page.evaluate((kw: string) => {
        const results: any[] = [];
        const cards = document.querySelectorAll('article');
        cards.forEach((card) => {
          try {
            const titleEl =
              card.querySelector('h3 a') ||
              card.querySelector('[data-automation="jobTitle"]') ||
              card.querySelector('a[id^="job-title"]');
            const title = titleEl?.textContent?.trim() || '';
            const linkEl = card.querySelector('a[href*="/job/"]') as HTMLAnchorElement;
            const href = linkEl?.getAttribute('href') || '';
            if (!title || !href) return;
            const companyEl =
              card.querySelector('[data-automation="job-list-view-job-advertiser"]') ||
              card.querySelector('a[data-automation="jobCompany"]');
            const company = companyEl?.textContent?.trim() || 'Unknown';
            const locationEl = card.querySelector('[data-automation="job-list-item-location"]');
            const location = locationEl?.textContent?.trim() || 'Unknown';
            const workTypeEl = card.querySelector('[data-automation="job-list-item-work-type"]');
            const workType = workTypeEl?.textContent?.trim() || '';
            const salaryEl = card.querySelector('[data-automation="job-list-item-salary"]');
            const salary = salaryEl?.textContent?.trim() || 'Not listed';
            results.push({ title, company, location, workType, salary, href, keyword: kw });
          } catch {}
        });
        return results;
      }, keyword);

      let added = 0;
      for (const j of jobs) {
        const jobUrl = j.href.startsWith('http') ? j.href : `https://www.seek.com.au${j.href}`;
        if (seenUrls.has(jobUrl)) continue;
        seenUrls.add(jobUrl);
        const workType = classifyWorkType(j.workType, j.title);
        allJobs.push({
          title: j.title, company: j.company, location: j.location,
          workType, salary: j.salary, url: jobUrl,
          applied: false, platform: 'seek', keyword: j.keyword
        });
        console.log(`   ✔ ${j.title} — ${j.company}`);
        console.log(`     📍 ${j.location} | 💼 ${workType} | 💰 ${j.salary}`);
        added++;
      }
      console.log(`   Page ${pageNum}: ${added} new jobs extracted`);
      if (added === 0 && pageNum > 1) break;
    }
  }

  console.log(`\n📋 Total unique jobs found: ${allJobs.length}`);
  return allJobs;
}

function classifyWorkType(raw: string, title: string): string {
  const text = (raw + ' ' + title).toLowerCase();
  if (text.includes('remote')) return '🌐 Remote';
  if (text.includes('hybrid')) return '🔀 Hybrid';
  if (text.includes('on-site') || text.includes('onsite') || text.includes('in office')) return '🏢 On-site';
  if (raw) return raw;
  return '❓ Not specified';
}

// ─── APPLY ────────────────────────────────────────────────────────────────────

export async function applyToSeekJob(page: Page, job: Job): Promise<boolean> {
  console.log(`\n📨 Applying to: ${job.title} at ${job.company}`);
  console.log(`   📍 ${job.location} | 💼 ${job.workType} | 💰 ${job.salary}`);

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Click Apply / Quick Apply
    const applySelectors = [
      '[data-automation="job-detail-apply"]',
      'button:has-text("Quick apply")',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
    ];
    let clicked = false;
    for (const sel of applySelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('   🖱️  Clicking Apply...');
        await btn.click();
        await page.waitForTimeout(3000);
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      console.log('   ⚠️  No Apply button found — skipping');
      return false;
    }

    // Multi-step flow — loop up to 8 steps
    for (let step = 1; step <= 8; step++) {
      await page.waitForTimeout(2000);
      console.log(`\n   ── Step ${step} ──`);

      // Check if already done
      const isDone = await page.evaluate(() => {
        const body = document.body.innerText.toLowerCase();
        return body.includes('application submitted') ||
               body.includes("you've applied") ||
               body.includes('successfully applied') ||
               body.includes('thank you for applying');
      });
      if (isDone) {
        console.log(`   🎉 Application confirmed for ${job.title}!`);
        return true;
      }

      // 1. Skip cover letter — handles radio buttons AND regular buttons
      const skippedCL = await page.evaluate(() => {
        // Search labels, buttons, and role=button elements
        const allEls = Array.from(document.querySelectorAll('label, button, [role="button"]'));
        const target = allEls.find(el => {
          const t = el.textContent?.toLowerCase() || '';
          return t.includes("don't include a cover letter") ||
                 t.includes("don't attach") ||
                 t.includes("no cover letter") ||
                 t.includes("without cover");
        }) as HTMLElement | undefined;
        if (target) {
          // If it's a label for a radio, click the radio input
          const forId = target.getAttribute('for');
          if (forId) {
            const radio = document.getElementById(forId) as HTMLInputElement;
            if (radio) { radio.click(); return true; }
          }
          target.click();
          return true;
        }
        return false;
      });
      if (skippedCL) {
        console.log('   📝 Selected "Don\'t include a cover letter"');
        await page.waitForTimeout(1500);
      }

      // 2. Answer screening questions
      await answerScreeningQuestions(page, job);

      // 3. Scroll to bottom to reveal all buttons
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      // 4. Try Continue FIRST (don't submit too early)
      const continued = await clickButtonByText(page, ['continue', 'next', 'proceed']);
      if (continued) {
        console.log('   ➡️  Clicked Continue — moving to next step');
        await page.waitForTimeout(2000);
        continue;
      }

      // 5. Only try Submit if no Continue button found
      // Use JS to find and click the submit button directly — bypasses all overlays
      const submitClicked = await page.evaluate(() => {
        // Find by text content
        const allBtns = Array.from(document.querySelectorAll('button'));
        const submitBtn = allBtns.find(b => {
          const text = b.textContent?.trim().toLowerCase() || '';
          return text.includes('submit application') || text === 'submit';
        });
        if (submitBtn) {
          submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      });

      if (submitClicked) {
        console.log('   ✅ Submit button clicked via JS...');
        console.log('   ⏳ Waiting for confirmation page...');

        // Wait for page to change
        try {
          await page.waitForFunction(() => {
            const body = document.body.innerText.toLowerCase();
            return body.includes('application has been sent') ||
                   body.includes('keep it up') ||
                   body.includes('application submitted') ||
                   body.includes("you've applied") ||
                   body.includes('thank you for applying') ||
                   body.includes('you might also like');
          }, { timeout: 15000 });
          console.log(`   🎉 Confirmed! Application submitted for ${job.title}!`);
        } catch {
          console.log(`   ✅ Submit clicked — confirmation not detected but moving on`);
        }
        return true;
      }

      console.log('   ⚠️  No actionable button found — stopping');
      break;
    }

    console.log(`   ⚠️  Could not complete application for ${job.title}`);
    return false;

  } catch (e: any) {
    const msg = e.message || '';
    if (msg.includes('closed') || msg.includes('Target')) {
      console.log('   ⚠️  Browser tab closed unexpectedly — job may have opened external site');
    } else {
      console.log(`   ❌ Error: ${msg}`);
    }
    return false;
  }
}

// ─── SCREENING QUESTIONS ──────────────────────────────────────────────────────

async function answerScreeningQuestions(page: Page, job: Job): Promise<void> {
  // Find all visible questions on the page
  const questions = await page.evaluate(() => {
    const results: Array<{ label: string; type: string; id: string; options: string[] }> = [];

    // Look for label + input pairs
    document.querySelectorAll('label').forEach((label) => {
      const text = label.textContent?.trim().toLowerCase() || '';
      const forId = label.getAttribute('for') || '';
      const input = forId ? document.getElementById(forId) : label.querySelector('input, select, textarea');

      if (!input) return;

      const tagName = input.tagName.toLowerCase();
      const inputType = (input as HTMLInputElement).type?.toLowerCase() || '';

      let type = 'text';
      if (tagName === 'select') type = 'select';
      else if (inputType === 'radio') type = 'radio';
      else if (inputType === 'checkbox') type = 'checkbox';
      else if (tagName === 'textarea') type = 'textarea';

      // Get options for select/radio
      const options: string[] = [];
      if (type === 'select') {
        (input as HTMLSelectElement).querySelectorAll('option').forEach(o => {
          if (o.value) options.push(o.textContent?.trim() || '');
        });
      }

      results.push({ label: text, type, id: input.id || '', options });
    });

    return results;
  });

  for (const q of questions) {
    if (!q.label) continue;

    // Find best answer from our lookup table
    const answer = findAnswer(q.label, q.options);
    if (!answer) continue;

    console.log(`   ❓ "${q.label}" → "${answer}"`);

    // Save for future jobs (persisted to file)
    persistAnswer(q.label, answer);

    try {
      if (q.type === 'select') {
        await page.selectOption(`#${q.id}`, { label: answer }).catch(() =>
          page.selectOption(`#${q.id}`, { value: answer })
        );
      } else if (q.type === 'radio') {
        // Find radio button with matching label text
        await page.evaluate(({ questionLabel, answerText }) => {
          const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
          for (const radio of radios) {
            const container = radio.closest('label') || radio.parentElement;
            if (container?.textContent?.toLowerCase().includes(answerText.toLowerCase())) {
              (radio as HTMLInputElement).click();
              return;
            }
          }
        }, { questionLabel: q.label, answerText: answer });
      } else if (q.type === 'text' || q.type === 'textarea') {
        if (q.id) {
          const el = page.locator(`#${q.id}`).first();
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
            await el.fill(answer);
          }
        }
      }
    } catch {
      // Skip if can't fill
    }
  }
}

function findAnswer(questionText: string, options: string[]): string | null {
  const q = questionText.toLowerCase();

  // Check saved answers first
  for (const [key, val] of Object.entries(savedAnswers)) {
    if (q.includes(key.toLowerCase())) return val;
  }

  // Check pre-defined answers
  for (const [key, val] of Object.entries(SCREENING_ANSWERS)) {
    if (q.includes(key.toLowerCase())) {
      // If it's a select with options, find best matching option
      if (options.length > 0) {
        const match = options.find(o => o.toLowerCase().includes(val.toLowerCase()) || val.toLowerCase().includes(o.toLowerCase()));
        return match || options[0];
      }
      return val;
    }
  }

  // Yes/No questions — default Yes
  if (options.includes('Yes') && options.includes('No')) return 'Yes';

  return null;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function clickButtonByText(page: Page, texts: string[]): Promise<boolean> {
  return await page.evaluate((searchTexts: string[]) => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
    const btn = buttons.find(el => {
      const t = (el.textContent?.trim() || (el as HTMLInputElement).value || '').toLowerCase();
      return searchTexts.some(s => t === s || t.includes(s));
    }) as HTMLElement | undefined;
    if (btn && !btn.hasAttribute('disabled')) {
      btn.click();
      return true;
    }
    return false;
  }, texts);
}