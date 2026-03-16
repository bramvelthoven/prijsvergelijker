const { getDb } = require('../db/database');

/**
 * Calculate price changes for products over a given period.
 * Returns products with their first and latest price in the period.
 */
function getPriceChanges({ days = 30, category = null, supermarket = null, minChange = 0 } = {}) {
  const db = getDb();

  let query = `
    WITH first_prices AS (
      SELECT product_id, price, scraped_at,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at ASC) as rn
      FROM prices
      WHERE DATE(scraped_at) >= DATE('now', ?)
    ),
    latest_prices AS (
      SELECT product_id, price, scraped_at,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at DESC) as rn
      FROM prices
      WHERE DATE(scraped_at) >= DATE('now', ?)
    )
    SELECT p.id, p.name, p.supermarket, p.category, p.unit, p.unit_type, p.price_per_unit,
           fp.price as first_price, fp.scraped_at as first_date,
           lp.price as latest_price, lp.scraped_at as latest_date,
           CASE WHEN fp.price > 0 THEN ROUND((lp.price - fp.price) / fp.price * 100, 2) ELSE 0 END as pct_change,
           ROUND(lp.price - fp.price, 2) as abs_change
    FROM products p
    JOIN first_prices fp ON fp.product_id = p.id AND fp.rn = 1
    JOIN latest_prices lp ON lp.product_id = p.id AND lp.rn = 1
    WHERE fp.price != lp.price`;

  const params = [`-${days} days`, `-${days} days`];

  if (category) {
    query += ` AND (p.category LIKE ? OR EXISTS (
      SELECT 1 FROM category_map cm
      WHERE cm.supermarket = p.supermarket AND cm.original_category = p.category
      AND cm.canonical_category = ?
    ))`;
    params.push(`%${category}%`, category);
  }

  if (supermarket) {
    query += ' AND p.supermarket = ?';
    params.push(supermarket);
  }

  if (minChange > 0) {
    query += ' AND ABS((lp.price - fp.price) / fp.price * 100) >= ?';
    params.push(minChange);
  }

  query += ' ORDER BY pct_change DESC';

  return db.prepare(query).all(...params);
}

/**
 * Get inflation summary per category.
 */
function getInflationByCategory({ days = 30 } = {}) {
  const db = getDb();

  return db
    .prepare(
      `WITH first_prices AS (
        SELECT product_id, price,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at ASC) as rn
        FROM prices
        WHERE DATE(scraped_at) >= DATE('now', ?)
      ),
      latest_prices AS (
        SELECT product_id, price,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at DESC) as rn
        FROM prices
        WHERE DATE(scraped_at) >= DATE('now', ?)
      )
      SELECT COALESCE(cm.canonical_category, p.category) as category,
             COUNT(*) as products,
             ROUND(AVG(CASE WHEN fp.price > 0 THEN (lp.price - fp.price) / fp.price * 100 END), 2) as avg_change_pct,
             ROUND(MAX(CASE WHEN fp.price > 0 THEN (lp.price - fp.price) / fp.price * 100 END), 2) as max_increase_pct,
             SUM(CASE WHEN lp.price > fp.price THEN 1 ELSE 0 END) as increased,
             SUM(CASE WHEN lp.price < fp.price THEN 1 ELSE 0 END) as decreased
      FROM products p
      JOIN first_prices fp ON fp.product_id = p.id AND fp.rn = 1
      JOIN latest_prices lp ON lp.product_id = p.id AND lp.rn = 1
      LEFT JOIN category_map cm ON cm.supermarket = p.supermarket AND cm.original_category = p.category
      WHERE fp.price != lp.price
      GROUP BY COALESCE(cm.canonical_category, p.category)
      ORDER BY avg_change_pct DESC`
    )
    .all(`-${days} days`, `-${days} days`);
}

/**
 * Get inflation summary per supermarket.
 */
function getInflationBySupermarket({ days = 30 } = {}) {
  const db = getDb();

  return db
    .prepare(
      `WITH first_prices AS (
        SELECT product_id, price,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at ASC) as rn
        FROM prices
        WHERE DATE(scraped_at) >= DATE('now', ?)
      ),
      latest_prices AS (
        SELECT product_id, price,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY scraped_at DESC) as rn
        FROM prices
        WHERE DATE(scraped_at) >= DATE('now', ?)
      )
      SELECT p.supermarket,
             COUNT(*) as products,
             ROUND(AVG(CASE WHEN fp.price > 0 THEN (lp.price - fp.price) / fp.price * 100 END), 2) as avg_change_pct,
             SUM(CASE WHEN lp.price > fp.price THEN 1 ELSE 0 END) as increased,
             SUM(CASE WHEN lp.price < fp.price THEN 1 ELSE 0 END) as decreased
      FROM products p
      JOIN first_prices fp ON fp.product_id = p.id AND fp.rn = 1
      JOIN latest_prices lp ON lp.product_id = p.id AND lp.rn = 1
      WHERE fp.price != lp.price
      GROUP BY p.supermarket
      ORDER BY avg_change_pct DESC`
    )
    .all(`-${days} days`, `-${days} days`);
}

/**
 * Find products "on sale" most of the time (fake discount detection).
 */
function findFakeSales({ minSalePct = 80 } = {}) {
  const db = getDb();

  return db
    .prepare(
      `SELECT p.id, p.name, p.supermarket, p.category, p.unit,
              COUNT(*) as total_prices,
              SUM(pr.is_sale) as sale_count,
              ROUND(CAST(SUM(pr.is_sale) AS REAL) / COUNT(*) * 100, 1) as sale_pct,
              MIN(pr.price) as min_price,
              MAX(pr.price) as max_price,
              AVG(pr.price) as avg_price
       FROM products p
       JOIN prices pr ON pr.product_id = p.id
       GROUP BY p.id
       HAVING total_prices >= 3 AND sale_pct >= ?
       ORDER BY sale_pct DESC, total_prices DESC`
    )
    .all(minSalePct);
}

/**
 * Find shrinkflation: products where the unit string changed.
 */
function findShrinkflation() {
  const db = getDb();

  return db
    .prepare(
      `SELECT uc.id, uc.old_unit, uc.new_unit, uc.detected_at,
              p.id as product_id, p.name, p.supermarket, p.category
       FROM unit_changes uc
       JOIN products p ON p.id = uc.product_id
       ORDER BY uc.detected_at DESC`
    )
    .all();
}

module.exports = {
  getPriceChanges,
  getInflationByCategory,
  getInflationBySupermarket,
  findFakeSales,
  findShrinkflation,
};
