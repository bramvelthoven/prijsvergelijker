const fs = require('fs');
const path = require('path');
const { getDb, close } = require('./db/database');
const { migrate } = require('./db/migrate');
const { normalizeAllUnits, normalizeAllNames } = require('./analysis/units');
const { getStats, getCanonicalCategories, getProductsByCanonicalCategory } = require('./analysis/queries');
const { getPriceChanges, getInflationByCategory, getInflationBySupermarket, findFakeSales, findShrinkflation } = require('./analysis/inflation');

const OUT_DIR = path.join(__dirname, 'web', 'public', 'data');

migrate();

function writeJson(filename, data) {
  const filepath = path.join(OUT_DIR, filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data));
  const size = (fs.statSync(filepath).size / 1024).toFixed(0);
  console.log(`  ${filename} (${size} KB)`);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function generate() {
  const db = getDb();
  console.log('Generating static site data...\n');

  // Ensure normalization is up to date
  normalizeAllUnits();
  normalizeAllNames();

  // 1. Stats
  const stats = getStats();
  writeJson('stats.json', stats);

  // 2. Categories
  const categories = getCanonicalCategories();
  writeJson('categories.json', categories);

  // 3. Per-category product lists (split into separate files)
  for (const cat of categories) {
    const products = getProductsByCanonicalCategory(cat.canonical_category);
    const slug = slugify(cat.canonical_category);
    writeJson(`categories/${slug}.json`, products);
  }

  // 4. Inflation data
  writeJson('inflation.json', {
    byCategory: getInflationByCategory({ days: 30 }),
    bySupermarket: getInflationBySupermarket({ days: 30 }),
    days: 30,
  });

  // 5. Graaiflatie — top price changes
  const changes = getPriceChanges({ days: 30, minChange: 5 });
  writeJson('graaiflatie.json', {
    changes: changes.slice(0, 200), // cap at 200 to keep small
    threshold: 5,
    days: 30,
  });

  // 6. Sales fraud
  writeJson('sales-fraud.json', findFakeSales({ minSalePct: 80 }));

  // 7. Shrinkflation
  writeJson('shrinkflation.json', findShrinkflation());

  // 8. Search index — lightweight: id, name, supermarket, normalized_name, price, unit info
  const searchIndex = db.prepare(`
    SELECT p.id, p.name, p.supermarket, p.category, p.unit, p.unit_type,
           p.unit_quantity, p.price_per_unit, p.normalized_name,
           pr.price, pr.original_price, pr.is_sale
    FROM products p
    LEFT JOIN prices pr ON pr.id = (
      SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
    )
    ORDER BY p.supermarket, p.name
  `).all();

  // Split search index into per-store files to keep each under ~3MB
  const byStore = { ah: [], jumbo: [], dirk: [] };
  for (const p of searchIndex) {
    // Compact: short keys to save space
    const compact = {
      i: p.id, n: p.name, s: p.supermarket, c: p.category,
      u: p.unit, ut: p.unit_type, uq: p.unit_quantity, pp: p.price_per_unit,
      nn: p.normalized_name, p: p.price, op: p.original_price, sa: p.is_sale,
    };
    if (byStore[p.supermarket]) byStore[p.supermarket].push(compact);
  }
  for (const [store, products] of Object.entries(byStore)) {
    writeJson(`products-${store}.json`, products);
  }

  // 9. Price history for products that have >1 price record (for detail views)
  const productsWithHistory = db.prepare(`
    SELECT DISTINCT product_id FROM prices
    GROUP BY product_id HAVING COUNT(*) > 1
  `).all();

  if (productsWithHistory.length > 0) {
    const historyMap = {};
    const histStmt = db.prepare(
      'SELECT price, original_price, is_sale, DATE(scraped_at) as date FROM prices WHERE product_id = ? ORDER BY scraped_at ASC'
    );
    for (const { product_id } of productsWithHistory) {
      historyMap[product_id] = histStmt.all(product_id);
    }
    writeJson('history.json', historyMap);
  }

  // 10. Matched product groups (confirmed)
  const matches = db.prepare(`
    SELECT m.id, m.canonical_name, m.confidence
    FROM product_matches m WHERE m.confirmed = 1
    ORDER BY m.canonical_name
  `).all();

  const memberStmt = db.prepare(`
    SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.price_per_unit,
           pr.price, pr.original_price, pr.is_sale
    FROM product_match_members mm
    JOIN products p ON p.id = mm.product_id
    LEFT JOIN prices pr ON pr.id = (
      SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
    )
    WHERE mm.match_id = ?
    ORDER BY pr.price ASC
  `);

  const matchData = matches.map(m => ({
    ...m,
    members: memberStmt.all(m.id),
  }));
  writeJson('matches.json', matchData);

  // 11. Build timestamp
  writeJson('meta.json', {
    generated_at: new Date().toISOString(),
    product_count: searchIndex.length,
    price_count: stats.totalPrices,
    date_range: stats.dateRange,
  });

  console.log('\nDone! Static files written to web/public/data/');

  // Generate SEO pages (static HTML, sitemap, robots.txt)
  console.log('');
  const { generateSEO } = require('./generate-seo');
  generateSEO();
}

try {
  generate();
} finally {
  close();
}
