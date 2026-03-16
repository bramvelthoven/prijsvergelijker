const { getDb } = require('../db/database');

/**
 * Get database overview stats.
 */
function getStats() {
  const db = getDb();

  const perStore = db
    .prepare(
      `SELECT supermarket, COUNT(*) as products,
              COUNT(unit_type) as with_units
       FROM products GROUP BY supermarket ORDER BY products DESC`
    )
    .all();

  const totalPrices = db.prepare('SELECT COUNT(*) as cnt FROM prices').get().cnt;

  const dateRange = db
    .prepare(
      'SELECT MIN(DATE(scraped_at)) as first_date, MAX(DATE(scraped_at)) as last_date, COUNT(DISTINCT DATE(scraped_at)) as days FROM prices'
    )
    .get();

  const categories = db
    .prepare('SELECT COUNT(DISTINCT category) as cnt FROM products WHERE category IS NOT NULL')
    .get().cnt;

  return { perStore, totalPrices, dateRange, categories };
}

/**
 * Search products by name. Returns latest price info.
 */
function searchProducts(term, { limit = 50, supermarket = null } = {}) {
  const db = getDb();

  let query = `
    SELECT p.id, p.name, p.brand, p.category, p.unit, p.supermarket, p.url,
           p.normalized_name, p.unit_quantity, p.unit_type, p.price_per_unit,
           pr.price as latest_price, pr.original_price, pr.is_sale, pr.scraped_at
    FROM products p
    LEFT JOIN prices pr ON pr.id = (
      SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
    )
    WHERE p.name LIKE ?`;

  const params = [`%${term}%`];

  if (supermarket) {
    query += ' AND p.supermarket = ?';
    params.push(supermarket);
  }

  query += ' ORDER BY p.supermarket, p.name LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params);
}

/**
 * Compare products across supermarkets for a given search term.
 * Groups by normalized_name similarity.
 */
function compareProducts(term) {
  const db = getDb();

  const products = db
    .prepare(
      `SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.unit_quantity, p.price_per_unit,
              p.normalized_name,
              pr.price as latest_price, pr.original_price, pr.is_sale
       FROM products p
       LEFT JOIN prices pr ON pr.id = (
         SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
       )
       WHERE p.name LIKE ? OR p.normalized_name LIKE ?
       ORDER BY p.normalized_name, p.supermarket`
    )
    .all(`%${term}%`, `%${term}%`);

  // Group by similar normalized_name
  const groups = new Map();
  for (const p of products) {
    const key = p.normalized_name || p.name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(p);
  }

  // Only return groups with 2+ stores
  const multiStore = [];
  const singleStore = [];

  for (const [name, items] of groups) {
    const stores = new Set(items.map((i) => i.supermarket));
    if (stores.size > 1) {
      multiStore.push({ name, items });
    } else {
      singleStore.push({ name, items });
    }
  }

  return { multiStore, singleStore };
}

/**
 * Get price history for a product.
 */
function getProductHistory(productId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT price, original_price, is_sale, DATE(scraped_at) as date
       FROM prices WHERE product_id = ? ORDER BY scraped_at ASC`
    )
    .all(productId);
}

/**
 * Get matched product groups (confirmed matches).
 */
function getMatchedGroups({ confirmed = true, limit = 100 } = {}) {
  const db = getDb();

  const matches = db
    .prepare(
      `SELECT m.id, m.canonical_name, m.match_type, m.confidence, m.confirmed
       FROM product_matches m
       WHERE m.confirmed = ?
       ORDER BY m.canonical_name
       LIMIT ?`
    )
    .all(confirmed ? 1 : 0, limit);

  const memberStmt = db.prepare(
    `SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.price_per_unit,
            pr.price as latest_price, pr.original_price, pr.is_sale
     FROM product_match_members mm
     JOIN products p ON p.id = mm.product_id
     LEFT JOIN prices pr ON pr.id = (
       SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
     )
     WHERE mm.match_id = ?
     ORDER BY pr.price ASC`
  );

  return matches.map((m) => ({
    ...m,
    members: memberStmt.all(m.id),
  }));
}

/**
 * Get the canonical category for a product.
 */
function getCanonicalCategory(supermarket, originalCategory) {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT canonical_category FROM category_map WHERE supermarket = ? AND original_category = ?'
    )
    .get(supermarket, originalCategory);
  return row ? row.canonical_category : originalCategory;
}

/**
 * Get products by canonical category.
 */
function getProductsByCanonicalCategory(canonicalCategory) {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.id, p.name, p.supermarket, p.category, p.unit, p.unit_type, p.unit_quantity, p.price_per_unit,
              p.normalized_name,
              pr.price as latest_price, pr.original_price, pr.is_sale
       FROM products p
       JOIN category_map cm ON cm.supermarket = p.supermarket AND cm.original_category = p.category
       LEFT JOIN prices pr ON pr.id = (
         SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
       )
       WHERE cm.canonical_category = ?
       ORDER BY p.normalized_name`
    )
    .all(canonicalCategory);
}

/**
 * Get all canonical categories with product counts.
 */
function getCanonicalCategories() {
  const db = getDb();
  return db
    .prepare(
      `SELECT cm.canonical_category, COUNT(DISTINCT p.id) as product_count
       FROM category_map cm
       JOIN products p ON p.supermarket = cm.supermarket AND p.category = cm.original_category
       GROUP BY cm.canonical_category
       ORDER BY product_count DESC`
    )
    .all();
}

module.exports = {
  getStats,
  searchProducts,
  compareProducts,
  getProductHistory,
  getMatchedGroups,
  getCanonicalCategory,
  getProductsByCanonicalCategory,
  getCanonicalCategories,
};
