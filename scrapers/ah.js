const { randomDelay, retry, createBrowser } = require('../utils/helpers');
const { upsertProduct, insertPrice, hasPriceToday } = require('../db/database');

const SUPERMARKET = 'ah';
const BASE_URL = 'https://www.ah.nl';
const MAX_PAGES_PER_CATEGORY = 60;

/**
 * All AH top-level product categories.
 */
const CATEGORIES = [
  { path: '/producten/6401/groente-aardappelen', name: 'groente & aardappelen' },
  { path: '/producten/20885/fruit-verse-sappen', name: 'fruit & verse sappen' },
  { path: '/producten/1301/maaltijden-salades', name: 'maaltijden & salades' },
  { path: '/producten/9344/vlees', name: 'vlees' },
  { path: '/producten/1651/vis', name: 'vis' },
  { path: '/producten/20128/vegetarisch-vegan-en-plantaardig', name: 'vegetarisch & vegan' },
  { path: '/producten/5481/vleeswaren', name: 'vleeswaren' },
  { path: '/producten/1192/kaas', name: 'kaas' },
  { path: '/producten/1730/zuivel-eieren', name: 'zuivel & eieren' },
  { path: '/producten/1355/bakkerij', name: 'bakkerij' },
  { path: '/producten/4246/glutenvrij', name: 'glutenvrij' },
  { path: '/producten/20824/borrel-chips-snacks', name: 'borrel, chips & snacks' },
  { path: '/producten/1796/pasta-rijst-wereldkeuken', name: 'pasta, rijst & wereldkeuken' },
  { path: '/producten/6409/soepen-sauzen-kruiden-olie', name: 'soepen, sauzen & kruiden' },
  { path: '/producten/20129/koek-snoep-chocolade', name: 'koek, snoep & chocolade' },
  { path: '/producten/6405/ontbijtgranen-beleg', name: 'ontbijtgranen & beleg' },
  { path: '/producten/2457/tussendoortjes', name: 'tussendoortjes' },
  { path: '/producten/5881/diepvries', name: 'diepvries' },
  { path: '/producten/1043/koffie-thee', name: 'koffie & thee' },
  { path: '/producten/20130/frisdrank-sappen-water', name: 'frisdrank, sappen & water' },
  { path: '/producten/6406/bier-wijn-aperitieven', name: 'bier, wijn & aperitieven' },
  { path: '/producten/1045/drogisterij', name: 'drogisterij' },
  { path: '/producten/11717/gezondheid-en-sport', name: 'gezondheid & sport' },
  { path: '/producten/1165/huishouden', name: 'huishouden' },
  { path: '/producten/18521/baby-en-kind', name: 'baby & kind' },
  { path: '/producten/18519/huisdier', name: 'huisdier' },
  { path: '/producten/1057/koken-tafelen-vrije-tijd', name: 'koken, tafelen & vrije tijd' },
];

/**
 * Extract products from a single AH category page.
 *
 * AH DOM (March 2026):
 * - Cards: article[data-testid="product-card"]
 * - Name: a[href*="/producten/product/"] title="Bekijk {name}"
 * - Price: [data-testid="price-amount"] > span.integer + span.fractional
 * - Bonus: price class contains "highlight" or shield is present
 * - Unit: [data-testid="product-unit-size"]
 */
async function scrapePage(page, categoryPath, pageNum) {
  const url =
    pageNum === 0
      ? `${BASE_URL}${categoryPath}`
      : `${BASE_URL}${categoryPath}?page=${pageNum}&withOffset=true`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(400);
  }

  return page.evaluate(() => {
    const cards = document.querySelectorAll('article[data-testid="product-card"]');
    const items = [];

    cards.forEach((card) => {
      try {
        const linkEl = card.querySelector('a[href*="/producten/product/"]');
        const rawTitle = linkEl?.getAttribute('title') || '';
        const name = rawTitle.replace(/^Bekijk\s+/, '').trim();
        if (!name) return;

        const href = linkEl?.getAttribute('href') || '';
        const url = href ? `https://www.ah.nl${href}` : null;

        const priceContainer = card.querySelector('[data-testid="price-amount"]');
        if (!priceContainer) return;

        const intEl = priceContainer.querySelector('span[class*="integer"]');
        const fracEl = priceContainer.querySelector('span[class*="fractional"]');
        let price = null;
        if (intEl && fracEl) {
          price = parseFloat(`${intEl.textContent.trim()}.${fracEl.textContent.trim()}`);
        }
        if (!price || isNaN(price)) return;

        const isHighlight = priceContainer.className.includes('highlight');
        const shieldEl = card.querySelector('[data-testid="product-shield"]');
        const isSale = isHighlight || !!shieldEl;

        const unitEl = card.querySelector('[data-testid="product-unit-size"]');
        const unit = unitEl?.textContent?.trim() || null;

        let brand = null;
        if (name.startsWith('AH ')) brand = 'AH';

        items.push({ name, brand, price, originalPrice: null, isSale, unit, url });
      } catch {
        // skip
      }
    });

    // Find max page from pagination links
    let maxPage = 0;
    const pageLinks = document.querySelectorAll('a[href*="page="]');
    for (const a of pageLinks) {
      const match = a.getAttribute('href').match(/page=(\d+)/);
      if (match) maxPage = Math.max(maxPage, parseInt(match[1]));
    }

    return { products: items, maxPage };
  });
}

async function scrapeAH() {
  const stats = { scraped: 0, inserted: 0, errors: 0 };
  const { browser, page } = await createBrowser();

  try {
    console.log('[AH] Starting full store scrape...');
    await page.goto(`${BASE_URL}/producten`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Accept cookies
    try {
      await page.click('[data-testid="cookie-dialog-accept"]', { timeout: 4000 });
      await randomDelay(500, 1000);
    } catch {}

    for (const category of CATEGORIES) {
      console.log(`\n[AH] Category: ${category.name}`);
      let totalInCategory = 0;

      try {
        const firstResult = await retry(
          () => scrapePage(page, category.path, 0),
          { maxRetries: 2, label: `AH ${category.name} p0` }
        );

        const maxPage = Math.min(firstResult.maxPage, MAX_PAGES_PER_CATEGORY);
        totalInCategory += firstResult.products.length;
        processProducts(firstResult.products, category.name, stats);

        console.log(
          `[AH]   Page 0: ${firstResult.products.length} products (${maxPage} pages total)`
        );

        for (let pageNum = 1; pageNum <= maxPage; pageNum++) {
          try {
            await randomDelay(1000, 2500);

            const result = await retry(
              () => scrapePage(page, category.path, pageNum),
              { maxRetries: 2, label: `AH ${category.name} p${pageNum}` }
            );

            totalInCategory += result.products.length;
            processProducts(result.products, category.name, stats);

            if (pageNum % 5 === 0 || pageNum === maxPage) {
              console.log(`[AH]   Page ${pageNum}/${maxPage}: ${totalInCategory} total`);
            }

            if (result.products.length === 0) break;
          } catch (error) {
            console.error(`[AH]   Error on page ${pageNum}: ${error.message}`);
            stats.errors++;
          }
        }

        console.log(`[AH]   ${category.name}: ${totalInCategory} products`);
      } catch (error) {
        console.error(`[AH]   Failed category "${category.name}": ${error.message}`);
        stats.errors++;
      }
    }
  } catch (error) {
    console.error(`[AH] Fatal error: ${error.message}`);
    stats.errors++;
  } finally {
    await browser.close();
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
      console.error(`[AH] Error saving "${product.name}": ${error.message}`);
      stats.errors++;
    }
  }
}

async function run() {
  return retry(() => scrapeAH(), { maxRetries: 2, label: 'Albert Heijn scraper' });
}

module.exports = { run, scrapeAH, CATEGORIES };
