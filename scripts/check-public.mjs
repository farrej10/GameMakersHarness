import { chromium } from 'playwright';

const baseUrl = new URL(process.argv[2] || 'https://farrej10.github.io/GameMakersHarness/');
const browser = await chromium.launch({ headless: true });

try {
  const landing = await browser.newPage();
  const landingFailures = [];
  landing.on('requestfailed', (request) => landingFailures.push(request.url()));
  await landing.goto(baseUrl.href, { waitUntil: 'networkidle' });
  // A client-side redirect can abort a request from the source landing page.
  // Reload the final URL so only failures from the deployed landing count.
  landingFailures.length = 0;
  await landing.reload({ waitUntil: 'networkidle' });
  const links = await landing.locator('a[href]').evaluateAll((elements) =>
    elements.map((element) => element.href),
  );
  if (landingFailures.length || links.length !== 2) {
    throw new Error(`Landing check failed: ${landingFailures.length} failed requests, ${links.length} game links.`);
  }
  console.log(`PASS landing ${landing.url()}`);

  for (const link of links) {
    const page = await browser.newPage();
    const failures = [];
    page.on('requestfailed', (request) => failures.push(request.url()));
    await page.goto(link, { waitUntil: 'networkidle' });
    const title = (await page.locator('[data-testid="game-title"]').textContent())?.trim();
    const state = (await page.locator('[data-testid="game-state"]').textContent())?.trim();
    if (!title || title === 'Loading game…' || state !== 'READY' || failures.length) {
      throw new Error(`${link} failed: title=${title}, state=${state}, failed requests=${failures.length}.`);
    }
    console.log(`PASS game ${title} ${link}`);
    await page.close();
  }
} finally {
  await browser.close();
}
