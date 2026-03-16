// Lidl does not have a full online grocery webshop like AH, Jumbo, or Dirk.
// Their website (lidl.nl) primarily shows weekly offers/folders, not a browsable
// product catalog with prices. Their permanent assortment is not listed online.
//
// Options for future implementation:
// 1. Scrape weekly offers from https://www.lidl.nl/aanbiedingen
//    - This only covers sale items, not the full assortment
// 2. Use the Lidl Plus API (requires authentication/app)
// 3. Use third-party sources that aggregate Lidl prices
//
// For now this scraper is disabled since we can't reliably get full product data.

async function run() {
  console.log(
    '[LIDL] Skipped — Lidl has no online product catalog. Only weekly offers available.'
  );
  return { scraped: 0, inserted: 0, errors: 0 };
}

module.exports = { run };
