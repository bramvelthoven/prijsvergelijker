const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'prices.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      unit TEXT,
      supermarket TEXT NOT NULL,
      url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_supermarket
      ON products (name, supermarket);

    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price REAL NOT NULL,
      original_price REAL,
      is_sale INTEGER DEFAULT 0,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_prices_product_id ON prices (product_id);
    CREATE INDEX IF NOT EXISTS idx_prices_scraped_at ON prices (scraped_at);
  `);
}

/**
 * Upsert a product: insert if new, return existing if already present.
 * Match on name + supermarket.
 */
function upsertProduct({ name, brand, category, unit, supermarket, url }) {
  const db = getDb();

  // Match by URL first (most precise), fall back to name+supermarket+unit, then name+supermarket
  const existing = (url && db
    .prepare('SELECT id, unit FROM products WHERE url = ?')
    .get(url)) ||
    (unit && db
    .prepare('SELECT id, unit FROM products WHERE name = ? AND supermarket = ? AND unit = ?')
    .get(name, supermarket, unit)) ||
    db.prepare('SELECT id, unit FROM products WHERE name = ? AND supermarket = ? AND url IS NULL')
    .get(name, supermarket);

  if (existing) {
    // Detect unit changes (shrinkflation)
    if (unit && existing.unit && unit !== existing.unit) {
      try {
        db.prepare(
          'INSERT INTO unit_changes (product_id, old_unit, new_unit) VALUES (?, ?, ?)'
        ).run(existing.id, existing.unit, unit);
      } catch (e) {
        // unit_changes table may not exist yet if migration hasn't run
      }
    }

    // Update fields that may have changed
    db.prepare(
      `UPDATE products SET brand = ?, category = ?, unit = ?, url = ? WHERE id = ?`
    ).run(brand, category, unit, url, existing.id);
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO products (name, brand, category, unit, supermarket, url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, brand, category, unit, supermarket, url);

  return result.lastInsertRowid;
}

/**
 * Insert a new price record for a product.
 */
function insertPrice({ productId, price, originalPrice, isSale }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO prices (product_id, price, original_price, is_sale)
       VALUES (?, ?, ?, ?)`
    )
    .run(productId, price, originalPrice ?? price, isSale ? 1 : 0);

  return result.lastInsertRowid;
}

/**
 * Check if a price was already scraped today for a given product.
 */
function hasPriceToday(productId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM prices
       WHERE product_id = ? AND DATE(scraped_at) = DATE('now')
       LIMIT 1`
    )
    .get(productId);
  return !!row;
}

/**
 * Get all products with their full price history.
 */
function getAllProductsWithPrices() {
  const db = getDb();

  const products = db.prepare('SELECT * FROM products ORDER BY supermarket, category, name').all();

  const priceStmt = db.prepare(
    'SELECT price, original_price, is_sale, scraped_at FROM prices WHERE product_id = ? ORDER BY scraped_at ASC'
  );

  return products.map((product) => ({
    ...product,
    price_history: priceStmt.all(product.id),
  }));
}

/**
 * Get summary stats for the latest scrape run.
 */
function getTodayStats() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT product_id) as products, COUNT(*) as prices
       FROM prices WHERE DATE(scraped_at) = DATE('now')`
    )
    .get();
  return row;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  upsertProduct,
  insertPrice,
  hasPriceToday,
  getAllProductsWithPrices,
  getTodayStats,
  close,
};
