const { randomDelay, retry, createBrowser } = require('../utils/helpers');
const { upsertProduct, insertPrice, hasPriceToday } = require('../db/database');

const SUPERMARKET = 'jumbo';
const BASE_URL = 'https://www.jumbo.com';

/**
 * Jumbo top-level categories with product counts (~17,800 total).
 * Scraped from their GraphQL categoriesTree endpoint.
 */
const CATEGORIES = [
  { path: '/producten/aardappelen,-groente-en-fruit/', name: 'aardappelen, groente & fruit' },
  { path: '/producten/verse-maaltijden-en-gemak/', name: 'verse maaltijden & gemak' },
  { path: '/producten/vlees,-vis-en-vega/', name: 'vlees, vis & vega' },
  { path: '/producten/brood-en-gebak/', name: 'brood & gebak' },
  { path: '/producten/vleeswaren,-kaas-en-tapas/', name: 'vleeswaren, kaas & tapas' },
  { path: '/producten/zuivel,-eieren,-boter/', name: 'zuivel, eieren & boter' },
  { path: '/producten/vega-en-plantaardig/', name: 'vega & plantaardig' },
  { path: '/producten/conserven,-soepen,-sauzen,-olien/', name: 'conserven, soepen & sauzen' },
  { path: '/producten/wereldkeukens,-kruiden,-pasta-en-rijst/', name: 'wereldkeuken, kruiden & pasta' },
  { path: '/producten/ontbijt,-broodbeleg-en-bakproducten/', name: 'ontbijt & broodbeleg' },
  { path: '/producten/koek,-snoep,-chocolade-en-chips/', name: 'koek, snoep & chocolade' },
  { path: '/producten/koffie-en-thee/', name: 'koffie & thee' },
  { path: '/producten/frisdrank-en-sappen/', name: 'frisdrank & sappen' },
  { path: '/producten/bier-en-wijn/', name: 'bier & wijn' },
  { path: '/producten/diepvries/', name: 'diepvries' },
  { path: '/producten/drogisterij-en-baby/', name: 'drogisterij & baby' },
  { path: '/producten/huishouden-en-dieren/', name: 'huishouden & dieren' },
  { path: '/producten/nonfood-en-servicebalie/', name: 'non-food' },
];

/**
 * Extract products from the current Jumbo page.
 *
 * Jumbo DOM (March 2026):
 * - Cards: article.product-container
 * - Name: h3 > a.title-link
 * - Unit: [data-testid="jum-card-subtitle"]
 * - Price: .current-price > span.whole + span.fractional
 * - Sale: .old-price or [class*="promotion"] present
 * - URL: a.title-link[href]
 */
async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('article.product-container');
    const items = [];

    cards.forEach((card) => {
      try {
        const titleLink = card.querySelector('a.title-link');
        const name = titleLink?.textContent?.trim();
        if (!name) return;

        const href = titleLink?.getAttribute('href') || '';
        const url = href ? `https://www.jumbo.com${href}` : null;

        // Price: span.whole + span.fractional inside .current-price
        const currentPrice = card.querySelector('.current-price');
        if (!currentPrice) return;

        const wholeEl = currentPrice.querySelector('span.whole');
        const fracEl = currentPrice.querySelector('span.fractional');
        let price = null;
        if (wholeEl && fracEl) {
          price = parseFloat(`${wholeEl.textContent.trim()}.${fracEl.textContent.trim()}`);
        }
        if (!price || isNaN(price)) return;

        // Check for old/original price (sale indicator)
        let originalPrice = null;
        let isSale = false;
        const oldPriceEl = card.querySelector('.old-price');
        if (oldPriceEl) {
          const oldWhole = oldPriceEl.querySelector('span.whole');
          const oldFrac = oldPriceEl.querySelector('span.fractional');
          if (oldWhole && oldFrac) {
            originalPrice = parseFloat(
              `${oldWhole.textContent.trim()}.${oldFrac.textContent.trim()}`
            );
            // Only mark as sale if original price is actually higher
            if (originalPrice > price) {
              isSale = true;
            } else {
              originalPrice = null;
            }
          }
        }

        // Unit size: try multiple selectors, then parse from title as fallback
        let unit = null;
        const unitSelectors = [
          '[data-testid="jum-card-subtitle"]',
          '.jum-card-subtitle',
          '.subtitle',
          '[class*="subtitle"]',
        ];
        for (const sel of unitSelectors) {
          const el = card.querySelector(sel);
          if (el) {
            const text = el.textContent.trim();
            if (text) { unit = text; break; }
          }
        }
        // Last resort: parse unit from product title
        if (!unit && name) {
          const unitMatch = name.match(
            /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|l|liter|stuks?|st)\b/i
          );
          const multiMatch = name.match(
            /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|l)\b/i
          );
          const perStukMatch = name.match(/\bper\s+stuk\b/i);
          if (multiMatch) {
            unit = `${multiMatch[1]} x ${multiMatch[2]} ${multiMatch[3]}`;
          } else if (unitMatch) {
            unit = `${unitMatch[1]} ${unitMatch[2]}`;
          } else if (perStukMatch) {
            unit = 'per stuk';
          }
        }

        // Brand: Jumbo-brand products start with "Jumbo "
        let brand = null;
        if (name.startsWith('Jumbo ')) brand = 'Jumbo';

        items.push({ name, brand, price, originalPrice, isSale, unit, url });
      } catch {
        // skip
      }
    });

    return items;
  });
}

/**
 * Get total page count from pagination on current page.
 */
async function getMaxPage(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return 0;
    // Jumbo shows "1 2 3 4 5 ... 742" — the last number before "Volgende"
    const buttons = nav.querySelectorAll('button');
    let max = 0;
    for (const btn of buttons) {
      const num = parseInt(btn.textContent.trim());
      if (!isNaN(num) && num > max) max = num;
    }
    return max;
  });
}

/**
 * Click the "Volgende" (next) pagination button.
 * Returns true if successful, false if no next button.
 */
async function goToNextPage(page) {
  try {
    const nextBtn = page.locator('button:has-text("Volgende")');
    if ((await nextBtn.count()) === 0) return false;
    if (await nextBtn.isDisabled()) return false;

    await nextBtn.click();
    await page.waitForTimeout(2000);

    // Wait for products to load
    await page.waitForSelector('article.product-container', { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function scrapeJumbo() {
  const stats = { scraped: 0, inserted: 0, errors: 0 };
  let browser, page;

  async function ensureBrowser() {
    try {
      if (page) await page.evaluate(() => true);
      return;
    } catch {
      console.log('[JUMBO] Browser crashed, restarting...');
      try { await browser.close(); } catch {}
    }
    const ctx = await createBrowser();
    browser = ctx.browser;
    page = ctx.page;
    // Re-accept cookies on new browser
    try {
      await page.goto(`${BASE_URL}/producten/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      await page.click('#onetrust-accept-btn-handler', { timeout: 3000 });
      await page.waitForTimeout(500);
    } catch {}
  }

  try {
    const ctx = await createBrowser();
    browser = ctx.browser;
    page = ctx.page;

    console.log('[JUMBO] Starting full store scrape...');

    // Navigate to products to accept cookies
    await page.goto(`${BASE_URL}/producten/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    try {
      await page.click('#onetrust-accept-btn-handler', { timeout: 5000 });
      await randomDelay(500, 1000);
    } catch {}

    for (const category of CATEGORIES) {
      console.log(`\n[JUMBO] Category: ${category.name}`);
      let totalInCategory = 0;
      let pageNum = 1;

      try {
        await ensureBrowser();
        // Navigate to category
        await page.goto(`${BASE_URL}${category.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(3000);

        // Scroll to load lazy content
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(500);
        }

        const maxPage = await getMaxPage(page);
        console.log(`[JUMBO]   ${maxPage} pages in this category`);

        // Scrape first page
        let products = await extractProducts(page);
        totalInCategory += products.length;
        processProducts(products, category.name, stats);
        console.log(`[JUMBO]   Page 1: ${products.length} products`);

        // Paginate through remaining pages
        while (pageNum < maxPage) {
          try {
            await randomDelay(1000, 2500);

            const hasNext = await goToNextPage(page);
            if (!hasNext) break;

            pageNum++;
            products = await extractProducts(page);
            totalInCategory += products.length;
            processProducts(products, category.name, stats);

            if (pageNum % 5 === 0 || pageNum === maxPage) {
              console.log(
                `[JUMBO]   Page ${pageNum}/${maxPage}: ${totalInCategory} total`
              );
            }

            if (products.length === 0) break;
          } catch (error) {
            console.error(`[JUMBO]   Error on page ${pageNum}: ${error.message}`);
            stats.errors++;
            break; // Move to next category on navigation error
          }
        }

        console.log(`[JUMBO]   ${category.name}: ${totalInCategory} products`);
      } catch (error) {
        console.error(
          `[JUMBO]   Failed category "${category.name}": ${error.message}`
        );
        stats.errors++;
      }
    }
  } catch (error) {
    console.error(`[JUMBO] Fatal error: ${error.message}`);
    stats.errors++;
  } finally {
    try { await browser.close(); } catch {}
  }

  return stats;
}

function processProducts(products, categoryName, stats) {
  for (const product of products) {
    try {
      const productId = upsertProduct({
        name: product.name,
        brand: product.brand || null,
        category: categoryName,
        unit: product.unit || null,
        supermarket: SUPERMARKET,
        url: product.url,
      });

      if (hasPriceToday(productId)) {
        stats.scraped++;
        continue;
      }

      insertPrice({
        productId,
        price: product.price,
        originalPrice: product.originalPrice || product.price,
        isSale: product.isSale || false,
      });

      stats.scraped++;
      stats.inserted++;
    } catch (error) {
      console.error(`[JUMBO] Error saving "${product.name}": ${error.message}`);
      stats.errors++;
    }
  }
}

async function run() {
  return retry(() => scrapeJumbo(), { maxRetries: 2, label: 'Jumbo scraper' });
}

module.exports = { run, scrapeJumbo, CATEGORIES };
