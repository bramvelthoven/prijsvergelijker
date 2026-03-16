const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { getDb, close } = require('../db/database');
const { migrate } = require('../db/migrate');
const {
  searchProducts,
  compareProducts,
  getProductHistory,
  getMatchedGroups,
  getCanonicalCategories,
  getProductsByCanonicalCategory,
  getStats,
} = require('../analysis/queries');
const {
  getPriceChanges,
  getInflationByCategory,
  getInflationBySupermarket,
  findFakeSales,
  findShrinkflation,
} = require('../analysis/inflation');

// Ensure migrations have run
migrate();

const PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

function parseQuery(urlStr) {
  const parsed = url.parse(urlStr, true);
  return { pathname: parsed.pathname, query: parsed.query };
}

const server = http.createServer((req, res) => {
  const { pathname, query } = parseQuery(req.url);

  // --- API Routes ---
  try {
    if (pathname === '/api/stats') {
      return sendJson(res, getStats());
    }

    if (pathname === '/api/search') {
      const q = query.q || '';
      if (!q) return sendJson(res, { error: 'Missing ?q= parameter' }, 400);
      return sendJson(res, searchProducts(q, { limit: parseInt(query.limit) || 50 }));
    }

    if (pathname === '/api/compare') {
      const q = query.q || '';
      if (!q) return sendJson(res, { error: 'Missing ?q= parameter' }, 400);
      return sendJson(res, compareProducts(q));
    }

    if (pathname.startsWith('/api/product/') && pathname.endsWith('/history')) {
      const id = parseInt(pathname.split('/')[3]);
      if (isNaN(id)) return sendJson(res, { error: 'Invalid product ID' }, 400);
      const db = getDb();
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!product) return sendJson(res, { error: 'Product not found' }, 404);
      const history = getProductHistory(id);
      return sendJson(res, { product, history });
    }

    if (pathname === '/api/inflation') {
      const days = parseInt(query.days) || 30;
      const byCategory = getInflationByCategory({ days });
      const bySupermarket = getInflationBySupermarket({ days });
      return sendJson(res, { byCategory, bySupermarket, days });
    }

    if (pathname === '/api/graaiflatie') {
      const threshold = parseInt(query.threshold) || 10;
      const days = parseInt(query.days) || 30;
      const changes = getPriceChanges({ days, minChange: threshold });
      return sendJson(res, { changes, threshold, days });
    }

    if (pathname === '/api/sales-fraud') {
      const minPct = parseInt(query.min_pct) || 80;
      return sendJson(res, findFakeSales({ minSalePct: minPct }));
    }

    if (pathname === '/api/shrinkflation') {
      return sendJson(res, findShrinkflation());
    }

    if (pathname === '/api/categories') {
      return sendJson(res, getCanonicalCategories());
    }

    if (pathname === '/api/category') {
      const name = query.name || '';
      if (!name) return sendJson(res, { error: 'Missing ?name= parameter' }, 400);
      return sendJson(res, getProductsByCanonicalCategory(name));
    }

    if (pathname === '/api/matches') {
      const confirmed = query.confirmed !== 'false';
      return sendJson(res, getMatchedGroups({ confirmed, limit: parseInt(query.limit) || 200 }));
    }
  } catch (err) {
    console.error('API error:', err.message);
    return sendJson(res, { error: 'Internal server error' }, 500);
  }

  // --- Static files (path traversal safe) ---
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\nPrijsanalyse Dashboard`);
  console.log(`Open in browser: http://localhost:${PORT}\n`);
});

process.on('SIGINT', () => {
  console.log('\nServer afgesloten.');
  close();
  process.exit(0);
});
