const fs = require('fs');
const path = require('path');
const { getAllProductsWithPrices, close } = require('./db/database');

const EXPORT_DIR = path.join(__dirname, 'exports');

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

function exportJSON() {
  const products = getAllProductsWithPrices();

  const data = products.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    unit: p.unit,
    supermarket: p.supermarket,
    url: p.url,
    created_at: p.created_at,
    price_history: p.price_history.map((h) => ({
      price: h.price,
      original_price: h.original_price,
      is_sale: !!h.is_sale,
      date: h.scraped_at,
    })),
  }));

  const filename = `prices_${getDateString()}.json`;
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`JSON geexporteerd: ${filepath} (${data.length} producten)`);

  // Also write a "latest" file for the frontend
  const latestPath = path.join(EXPORT_DIR, 'prices_latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Latest JSON: ${latestPath}`);

  return data;
}

function exportCSV() {
  const products = getAllProductsWithPrices();

  const rows = [];
  for (const p of products) {
    for (const h of p.price_history) {
      rows.push({
        product_id: p.id,
        name: p.name,
        brand: p.brand || '',
        category: p.category || '',
        unit: p.unit || '',
        supermarket: p.supermarket,
        url: p.url || '',
        price: h.price,
        original_price: h.original_price,
        is_sale: h.is_sale ? 'ja' : 'nee',
        date: h.scraped_at,
      });
    }
  }

  if (rows.length === 0) {
    console.log('Geen data om te exporteren');
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = String(row[h]);
          // Escape values containing commas or quotes
          return val.includes(',') || val.includes('"')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        })
        .join(',')
    ),
  ];

  const filename = `prices_${getDateString()}.csv`;
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, csvLines.join('\n'), 'utf-8');
  console.log(`CSV geexporteerd: ${filepath} (${rows.length} rijen)`);
}

function getDateString() {
  return new Date().toISOString().slice(0, 10);
}

// Main
ensureExportDir();
console.log('Exporteren van prijsdata...\n');

try {
  exportJSON();
  console.log('');
  exportCSV();
} catch (error) {
  console.error('Export fout:', error.message);
  process.exit(1);
} finally {
  close();
}

console.log('\nExport voltooid!');
