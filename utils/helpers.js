const { chromium } = require('playwright');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(minMs = 1000, maxMs = 3000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function retry(fn, { maxRetries = 3, label = 'operation' } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxRetries;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(
        `[RETRY] ${label} - attempt ${attempt}/${maxRetries} failed: ${error.message}`
      );
      if (isLast) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Create a browser + page configured for scraping Dutch supermarkets.
 * Uses headed mode locally, headless "new" mode in CI (GitHub Actions).
 */
async function createBrowser() {
  const isCI = !!process.env.CI;
  const browser = await chromium.launch({
    headless: isCI ? 'new' : false,
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(isCI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : []),
    ],
  });

  const context = await browser.newContext({
    userAgent: getRandomUserAgent(),
    viewport: { width: 1366, height: 768 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Block heavy resources to speed up loading
  await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf}', (route) =>
    route.abort()
  );

  return { browser, page };
}

module.exports = { getRandomUserAgent, randomDelay, retry, createBrowser, USER_AGENTS };
