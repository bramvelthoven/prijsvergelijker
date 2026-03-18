const { randomDelay, retry, createBrowser } = require('../utils/helpers');
const { upsertProduct, insertPrice, hasPriceToday } = require('../db/database');

const SUPERMARKET = 'dirk';
const BASE_URL = 'https://www.dirk.nl';

/**
 * Dirk categories and subcategories.
 * Dirk loads all products per subcategory on a single page (no pagination needed).
 * We scrape at subcategory level to get all products.
 */
const CATEGORIES = [
  {
    name: 'aardappelen, groente & fruit',
    subcategories: [
      '/boodschappen/aardappelen-groente-fruit/aardappelen',
      '/boodschappen/aardappelen-groente-fruit/biologisch-agf',
      '/boodschappen/aardappelen-groente-fruit/fruit',
      '/boodschappen/aardappelen-groente-fruit/fruitconserven',
      '/boodschappen/aardappelen-groente-fruit/gedroogd-fruit-noten',
      '/boodschappen/aardappelen-groente-fruit/groente',
      '/boodschappen/aardappelen-groente-fruit/groenteconserven',
      '/boodschappen/aardappelen-groente-fruit/sla-verse-kruiden',
    ],
  },
  {
    name: 'vlees & vis',
    subcategories: [
      '/boodschappen/vlees-vis/rundvlees',
      '/boodschappen/vlees-vis/varkensvlees',
      '/boodschappen/vlees-vis/kip',
      '/boodschappen/vlees-vis/gehakt',
      '/boodschappen/vlees-vis/vis',
      '/boodschappen/vlees-vis/vegetarisch',
      '/boodschappen/vlees-vis/maaltijden',
      '/boodschappen/vlees-vis/overig-vlees',
    ],
  },
  {
    name: 'brood, beleg & koek',
    subcategories: [
      '/boodschappen/brood-beleg-koek/brood',
      '/boodschappen/brood-beleg-koek/bolletjes-croissants',
      '/boodschappen/brood-beleg-koek/beschuit-knackebrod-crackers',
      '/boodschappen/brood-beleg-koek/zoet-beleg',
      '/boodschappen/brood-beleg-koek/hartig-beleg',
      '/boodschappen/brood-beleg-koek/koek-gebak',
    ],
  },
  {
    name: 'zuivel & kaas',
    subcategories: [
      '/boodschappen/zuivel-kaas/melk',
      '/boodschappen/zuivel-kaas/yoghurt-kwark-toetjes',
      '/boodschappen/zuivel-kaas/kaas',
      '/boodschappen/zuivel-kaas/eieren',
      '/boodschappen/zuivel-kaas/boter-margarine',
      '/boodschappen/zuivel-kaas/room-creme-fraiche',
    ],
  },
  {
    name: 'dranken, sap, koffie & thee',
    subcategories: [
      '/boodschappen/dranken-sap-koffie-thee/frisdrank',
      '/boodschappen/dranken-sap-koffie-thee/water',
      '/boodschappen/dranken-sap-koffie-thee/sap',
      '/boodschappen/dranken-sap-koffie-thee/koffie',
      '/boodschappen/dranken-sap-koffie-thee/thee',
      '/boodschappen/dranken-sap-koffie-thee/bier',
      '/boodschappen/dranken-sap-koffie-thee/wijn',
      '/boodschappen/dranken-sap-koffie-thee/sterke-drank',
      '/boodschappen/dranken-sap-koffie-thee/siroop-limonade',
    ],
  },
  {
    name: 'voorraadkast',
    subcategories: [
      '/boodschappen/voorraadkast/pasta-rijst-noodles',
      '/boodschappen/voorraadkast/sauzen',
      '/boodschappen/voorraadkast/soepen',
      '/boodschappen/voorraadkast/kruiden-specerijen',
      '/boodschappen/voorraadkast/olie-azijn',
      '/boodschappen/voorraadkast/wereldkeuken',
      '/boodschappen/voorraadkast/meel-bakproducten',
      '/boodschappen/voorraadkast/suiker-zoetjes',
    ],
  },
  {
    name: 'maaltijden, salades & tapas',
    subcategories: [
      '/boodschappen/maaltijden-salades-tapas/maaltijden',
      '/boodschappen/maaltijden-salades-tapas/salades',
      '/boodschappen/maaltijden-salades-tapas/tapas-borrel',
      '/boodschappen/maaltijden-salades-tapas/soepen',
    ],
  },
  {
    name: 'diepvries',
    subcategories: [
      '/boodschappen/diepvries/diepvries-snacks',
      '/boodschappen/diepvries/diepvries-maaltijden',
      '/boodschappen/diepvries/diepvries-groente',
      '/boodschappen/diepvries/diepvries-aardappel',
      '/boodschappen/diepvries/diepvries-ijs',
      '/boodschappen/diepvries/diepvries-vis',
      '/boodschappen/diepvries/diepvries-vlees',
      '/boodschappen/diepvries/diepvries-brood-gebak',
    ],
  },
  {
    name: 'huishoud & huisdieren',
    subcategories: [
      '/boodschappen/huishoud-huisdieren/schoonmaakmiddelen',
      '/boodschappen/huishoud-huisdieren/wasmiddelen',
      '/boodschappen/huishoud-huisdieren/afwasmiddelen-benodigdheden',
      '/boodschappen/huishoud-huisdieren/toiletpapier-tissues',
      '/boodschappen/huishoud-huisdieren/huisdieren',
    ],
  },
  {
    name: 'kind & drogisterij',
    subcategories: [
      '/boodschappen/kind-drogisterij/babyvoeding',
      '/boodschappen/kind-drogisterij/luiers',
      '/boodschappen/kind-drogisterij/haarverzorging',
      '/boodschappen/kind-drogisterij/mondverzorging',
      '/boodschappen/kind-drogisterij/lichaamsverzorging',
    ],
  },
  {
    name: 'snacks & snoep',
    subcategories: [
      '/boodschappen/snacks-snoep/chips',
      '/boodschappen/snacks-snoep/noten-zoutjes',
      '/boodschappen/snacks-snoep/chocolade',
      '/boodschappen/snacks-snoep/snoep-drop',
      '/boodschappen/snacks-snoep/koek',
    ],
  },
];

/**
 * Extract products from a Dirk subcategory page.
 *
 * Dirk DOM (March 2026):
 * - Cards: article[data-product-id]
 * - Name: p.title (inside a.bottom link)
 * - Unit: span.subtitle
 * - Price: Two formats:
 *     >= €1: span.hasEuros.price-large (euros) + span.price-small (cents)
 *     < €1:  span.price-large (cents only, no hasEuros class, no price-small)
 * - Sale: presence of .old-price, .from-price, or "van X.XX" text
 * - URL: a.top[href] or a.bottom[href]
 */
async function extractProducts(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('article[data-product-id]');
    const items = [];

    cards.forEach((card) => {
      try {
        // Product name
        const titleEl = card.querySelector('p.title');
        const name = titleEl?.textContent?.trim();
        if (!name) return;

        // URL
        const linkEl = card.querySelector('a.bottom') || card.querySelector('a.top');
        const href = linkEl?.getAttribute('href') || '';
        const url = href ? `https://www.dirk.nl${href}` : null;

        // Price: Dirk has two formats:
        // 1. >= €1: span.hasEuros.price-large (euros) + span.price-small (cents)
        // 2. < €1:  span.price-large without hasEuros (just cents, no price-small)
        const priceDiv = card.querySelector('.price-container .price');
        if (!priceDiv) return;

        const largEl = priceDiv.querySelector('span.price-large');
        const smallEl = priceDiv.querySelector('span.price-small');
        let price = null;

        if (largEl && largEl.classList.contains('hasEuros') && smallEl) {
          // Normal price: euros.cents
          price = parseFloat(`${largEl.textContent.trim()}.${smallEl.textContent.trim()}`);
        } else if (largEl && !largEl.classList.contains('hasEuros')) {
          // Cents-only price (< €1): "85" means €0.85
          price = parseInt(largEl.textContent.trim()) / 100;
        } else if (largEl && smallEl) {
          // Fallback
          price = parseFloat(`${largEl.textContent.trim()}.${smallEl.textContent.trim()}`);
        }

        if (!price || isNaN(price)) return;

        // Check for sale/action — only mark as sale when we have a confirmed discount
        let originalPrice = null;
        let isSale = false;

        // Old price (doorgehaalde prijs)
        const oldPriceContainer = card.querySelector('.old-price, .from-price');
        if (oldPriceContainer) {
          const oldEuros = oldPriceContainer.querySelector(
            'span.price-large, span.hasEuros'
          );
          const oldCents = oldPriceContainer.querySelector('span.price-small');
          if (oldEuros && oldCents) {
            const parsed = parseFloat(
              `${oldEuros.textContent.trim()}.${oldCents.textContent.trim()}`
            );
            // Only mark as sale if original price is actually higher
            if (parsed > price) {
              originalPrice = parsed;
              isSale = true;
            }
          }
        }

        // Unit
        const unitEl = card.querySelector('span.subtitle');
        const unit = unitEl?.textContent?.trim() || null;

        // Brand from logo alt text
        let brand = null;
        const logoEl = card.querySelector('.logos img[alt]');
        if (logoEl) {
          const alt = logoEl.getAttribute('alt');
          if (alt && alt.toLowerCase().includes('1 de beste')) brand = '1 de Beste';
        }

        items.push({ name, brand, price, originalPrice, isSale, unit, url });
      } catch {
        // skip
      }
    });

    return items;
  });
}

async function scrapeDirk() {
  const stats = { scraped: 0, inserted: 0, errors: 0 };
  let browser, page;

  async function ensureBrowser() {
    try {
      // Test if browser is still alive
      if (page) await page.evaluate(() => true);
      return;
    } catch {
      // Browser crashed, create new one
      console.log('[DIRK] Browser crashed, restarting...');
      try { await browser.close(); } catch {}
    }
    const ctx = await createBrowser();
    browser = ctx.browser;
    page = ctx.page;
  }

  try {
    const ctx = await createBrowser();
    browser = ctx.browser;
    page = ctx.page;

    console.log('[DIRK] Starting full store scrape...');

    for (const category of CATEGORIES) {
      console.log(`\n[DIRK] Category: ${category.name}`);
      let totalInCategory = 0;

      for (const subPath of category.subcategories) {
        try {
          await ensureBrowser();
          await randomDelay(1000, 2500);

          await page.goto(`${BASE_URL}${subPath}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await page.waitForTimeout(3000);

          // Scroll to load all products (Dirk loads all on one page)
          let prevHeight = 0;
          for (let i = 0; i < 15; i++) {
            await page.evaluate(() => window.scrollBy(0, 1000));
            await page.waitForTimeout(500);
            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            if (newHeight === prevHeight) break;
            prevHeight = newHeight;
          }

          const products = await extractProducts(page);
          totalInCategory += products.length;
          processProducts(products, category.name, stats);

          const subName = subPath.split('/').pop();
          console.log(`[DIRK]   ${subName}: ${products.length} products`);
        } catch (error) {
          const subName = subPath.split('/').pop();
          console.error(`[DIRK]   Failed "${subName}": ${error.message}`);
          stats.errors++;
        }
      }

      console.log(`[DIRK]   ${category.name}: ${totalInCategory} products`);
    }
  } catch (error) {
    console.error(`[DIRK] Fatal error: ${error.message}`);
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
      console.error(`[DIRK] Error saving "${product.name}": ${error.message}`);
      stats.errors++;
    }
  }
}

async function run() {
  return retry(() => scrapeDirk(), { maxRetries: 2, label: 'Dirk scraper' });
}

module.exports = { run, scrapeDirk, CATEGORIES };
