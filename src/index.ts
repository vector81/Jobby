import { launchBrowser, closeBrowser } from './browser';
import { loginSeek, searchSeek, applyToSeekJob, Job } from './seek';
import * as fs from 'fs';
import config from './config.json';

const JOBS_FILE = 'E:\\job-auto-applier\\jobs.json';

function loadJobs(): Job[] {
  if (fs.existsSync(JOBS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

function saveJobs(jobs: Job[]): void {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function printSummary(jobs: Job[]): void {
  const applied = jobs.filter((j) => j.applied);
  const failed = jobs.filter((j) => !j.applied);

  console.log('\n════════════════════════════════════');
  console.log('           SESSION SUMMARY          ');
  console.log('════════════════════════════════════');
  console.log(`✅ Successfully applied: ${applied.length}`);
  console.log(`❌ Failed / skipped:    ${failed.length}`);
  console.log(`📋 Total jobs found:    ${jobs.length}`);
  console.log(`💾 Saved to:            ${JOBS_FILE}`);

  if (applied.length > 0) {
    console.log('\n📨 Applied to:');
    for (const j of applied) {
      console.log(`   • ${j.title} at ${j.company} (${j.workType})`);
    }
  }

  console.log('\n════════════════════════════════════\n');
}

async function main() {
  console.log('\n╔══════════════════════════════════╗');
  console.log('║      JOB AUTO-APPLIER v2.0       ║');
  console.log('╚══════════════════════════════════╝\n');

  console.log(`🎯 Job types:  ${(config.search.keywords as string[]).join(', ')}`);
  console.log(`📍 Location:   ${config.search.location}`);
  console.log(`📄 Max apps:   ${config.application.maxApplications}\n`);

  const page = await launchBrowser();

  // Step 1: Log in
  await loginSeek(page);

  // Step 2: Search all keywords
  const freshJobs = await searchSeek(page);

  // Step 3: Merge with existing jobs (avoid duplicates)
  const existingJobs = loadJobs();
  const existingUrls = new Set(existingJobs.map((j) => j.url));
  const newJobs = freshJobs.filter((j) => !existingUrls.has(j.url));
  const allJobs = [...existingJobs, ...newJobs];
  saveJobs(allJobs);

  console.log(`\n🆕 New jobs this session: ${newJobs.length}`);

  // Step 4: Apply to unapplied jobs
  const toApply = allJobs
    .filter((j) => !j.applied)
    .slice(0, config.application.maxApplications);

  console.log(`\n🚀 Starting applications for ${toApply.length} jobs...\n`);
  console.log('━'.repeat(50));

  let successCount = 0;

  for (let i = 0; i < toApply.length; i++) {
    const job = toApply[i];
    console.log(`\n[${i + 1}/${toApply.length}]`);

    const success = await applyToSeekJob(page, job);

    // Update job record
    const jobInList = allJobs.find((j) => j.url === job.url);
    if (jobInList) {
      jobInList.applied = success;
      jobInList.appliedAt = success ? new Date().toISOString() : undefined;
    }

    saveJobs(allJobs);

    if (success) successCount++;

    // Delay between applications
    if (i < toApply.length - 1) {
      const delay = config.application.delayBetweenApplications;
      console.log(`\n⏳ Waiting ${delay / 1000}s before next application...`);
      await page.waitForTimeout(delay);
    }
  }

  printSummary(toApply);

  console.log('Browser staying open — press Ctrl+C to exit.\n');
  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message);
  closeBrowser();
  process.exit(1);
});