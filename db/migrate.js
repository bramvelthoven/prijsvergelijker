const { getDb, close } = require('./database');

/**
 * Run idempotent schema migrations.
 * Safe to run repeatedly — uses IF NOT EXISTS and checks for existing columns.
 */
function migrate() {
  const db = getDb();

  console.log('Running migrations...');

  // Helper: check if a column exists on a table
  const hasColumn = (table, column) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  };

  // --- Add new columns to products ---
  const newProductCols = [
    ['normalized_name', 'TEXT'],
    ['unit_quantity', 'REAL'],
    ['unit_type', 'TEXT'],
    ['price_per_unit', 'REAL'],
  ];

  for (const [col, type] of newProductCols) {
    if (!hasColumn('products', col)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${col} ${type}`);
      console.log(`  Added products.${col}`);
    }
  }

  // --- New tables ---

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      match_type TEXT,
      confidence REAL,
      confirmed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_match_members (
      match_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL UNIQUE,
      FOREIGN KEY (match_id) REFERENCES product_matches(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_match_members_match ON product_match_members(match_id);
    CREATE INDEX IF NOT EXISTS idx_match_members_product ON product_match_members(product_id);

    CREATE TABLE IF NOT EXISTS category_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_category TEXT NOT NULL,
      supermarket TEXT NOT NULL,
      original_category TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_category_map_unique
      ON category_map(supermarket, original_category);

    CREATE TABLE IF NOT EXISTS unit_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      old_unit TEXT,
      new_unit TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_unit_changes_product ON unit_changes(product_id);
  `);

  console.log('  Ensured tables: product_matches, product_match_members, category_map, unit_changes');

  // --- Seed category_map ---
  const catCount = db.prepare('SELECT COUNT(*) as cnt FROM category_map').get().cnt;
  if (catCount === 0) {
    console.log('  Seeding category_map...');
    const mappings = [
      // groente & fruit
      ['groente & fruit', 'ah', 'groente & aardappelen'],
      ['groente & fruit', 'ah', 'fruit & verse sappen'],
      ['groente & fruit', 'jumbo', 'aardappelen, groente & fruit'],
      ['groente & fruit', 'dirk', 'aardappelen, groente & fruit'],

      // vlees & vis
      ['vlees & vis', 'ah', 'vlees'],
      ['vlees & vis', 'ah', 'vis'],
      ['vlees & vis', 'jumbo', 'vlees, vis & vega'],
      ['vlees & vis', 'dirk', 'vlees & vis'],

      // zuivel & eieren
      ['zuivel & eieren', 'ah', 'zuivel & eieren'],
      ['zuivel & eieren', 'jumbo', 'zuivel, eieren & boter'],
      ['zuivel & eieren', 'dirk', 'zuivel & kaas'],

      // kaas & vleeswaren
      ['kaas & vleeswaren', 'ah', 'kaas'],
      ['kaas & vleeswaren', 'ah', 'vleeswaren'],
      ['kaas & vleeswaren', 'jumbo', 'vleeswaren, kaas & tapas'],

      // brood & bakkerij
      ['brood & bakkerij', 'ah', 'bakkerij'],
      ['brood & bakkerij', 'jumbo', 'brood & gebak'],
      ['brood & bakkerij', 'dirk', 'brood, beleg & koek'],

      // ontbijt & beleg
      ['ontbijt & beleg', 'ah', 'ontbijtgranen & beleg'],
      ['ontbijt & beleg', 'jumbo', 'ontbijt & broodbeleg'],

      // snoep & snacks
      ['snoep & snacks', 'ah', 'koek, snoep & chocolade'],
      ['snoep & snacks', 'ah', 'borrel, chips & snacks'],
      ['snoep & snacks', 'jumbo', 'koek, snoep & chocolade'],
      ['snoep & snacks', 'dirk', 'snacks & snoep'],

      // dranken
      ['dranken', 'ah', 'frisdrank, sappen & water'],
      ['dranken', 'ah', 'bier, wijn & aperitieven'],
      ['dranken', 'jumbo', 'frisdrank & sappen'],
      ['dranken', 'jumbo', 'bier & wijn'],
      ['dranken', 'dirk', 'dranken, sap, koffie & thee'],

      // koffie & thee
      ['koffie & thee', 'ah', 'koffie & thee'],
      ['koffie & thee', 'jumbo', 'koffie & thee'],

      // diepvries
      ['diepvries', 'ah', 'diepvries'],
      ['diepvries', 'jumbo', 'diepvries'],
      ['diepvries', 'dirk', 'diepvries'],

      // maaltijden
      ['maaltijden', 'ah', 'maaltijden & salades'],
      ['maaltijden', 'jumbo', 'verse maaltijden & gemak'],
      ['maaltijden', 'dirk', 'maaltijden, salades & tapas'],

      // pasta, rijst & wereldkeuken
      ['pasta & wereldkeuken', 'ah', 'pasta, rijst & wereldkeuken'],
      ['pasta & wereldkeuken', 'ah', 'soepen, sauzen & kruiden'],
      ['pasta & wereldkeuken', 'jumbo', 'wereldkeuken, kruiden & pasta'],
      ['pasta & wereldkeuken', 'jumbo', 'conserven, soepen & sauzen'],
      ['pasta & wereldkeuken', 'dirk', 'voorraadkast'],

      // huishouden
      ['huishouden', 'ah', 'huishouden'],
      ['huishouden', 'jumbo', 'huishouden & dieren'],
      ['huishouden', 'dirk', 'huishoud & huisdieren'],

      // drogisterij & baby
      ['drogisterij', 'ah', 'drogisterij'],
      ['drogisterij', 'ah', 'gezondheid & sport'],
      ['drogisterij', 'ah', 'baby & kind'],
      ['drogisterij', 'jumbo', 'drogisterij & baby'],
      ['drogisterij', 'dirk', 'kind & drogisterij'],

      // vega & plantaardig
      ['vega & plantaardig', 'ah', 'vegetarisch & vegan'],
      ['vega & plantaardig', 'jumbo', 'vega & plantaardig'],

      // tussendoortjes
      ['tussendoortjes', 'ah', 'tussendoortjes'],

      // huisdier
      ['huisdier', 'ah', 'huisdier'],

      // non-food
      ['non-food', 'ah', 'koken, tafelen & vrije tijd'],
      ['non-food', 'jumbo', 'non-food'],

      // glutenvrij
      ['glutenvrij', 'ah', 'glutenvrij'],
    ];

    const insert = db.prepare(
      'INSERT OR IGNORE INTO category_map (canonical_category, supermarket, original_category) VALUES (?, ?, ?)'
    );
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    insertMany(mappings);
    console.log(`  Inserted ${mappings.length} category mappings`);
  }

  console.log('Migrations complete.');
}

// Run if called directly
if (require.main === module) {
  try {
    migrate();
  } finally {
    close();
  }
}

module.exports = { migrate };
