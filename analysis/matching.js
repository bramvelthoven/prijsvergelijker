const { getDb } = require('../db/database');
const { normalizeName } = require('./units');

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Check if two products have compatible units (both weight, both volume, or both stuk).
 */
function unitsCompatible(a, b) {
  if (!a.unit_type && !b.unit_type) return true;
  if (!a.unit_type || !b.unit_type) return true; // allow if one is unknown
  return a.unit_type === b.unit_type;
}

/**
 * Strip trailing weight/volume from a name for matching purposes.
 * E.g. "Douwe Egberts Aroma Rood 500g" → "douwe egberts aroma rood"
 */
function stripTrailingUnit(name) {
  return name
    .replace(/\s+\d+[\d.,]*\s*(g|gr|gram|kg|ml|cl|l|liter|stuks?)\s*$/i, '')
    .trim();
}

/**
 * Auto-match products across supermarkets.
 * Returns { created, skipped } counts.
 */
function autoMatch({ dryRun = false, category = null } = {}) {
  const db = getDb();

  console.log('Starting auto-matching...');

  // Get all products not yet in a match group, with latest price
  let query = `
    SELECT p.id, p.name, p.supermarket, p.category, p.unit, p.unit_type, p.unit_quantity,
           p.normalized_name,
           pr.price as latest_price
    FROM products p
    LEFT JOIN product_match_members mm ON mm.product_id = p.id
    LEFT JOIN prices pr ON pr.id = (
      SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
    )
    WHERE mm.match_id IS NULL`;

  const params = [];
  if (category) {
    query += ` AND (p.category LIKE ? OR EXISTS (
      SELECT 1 FROM category_map cm
      WHERE cm.supermarket = p.supermarket AND cm.original_category = p.category
      AND cm.canonical_category = ?
    ))`;
    params.push(`%${category}%`, category);
  }

  query += ' ORDER BY p.normalized_name';

  const products = db.prepare(query).all(...params);

  // Group by supermarket
  const byStore = { ah: [], jumbo: [], dirk: [] };
  for (const p of products) {
    if (byStore[p.supermarket]) {
      byStore[p.supermarket].push(p);
    }
  }

  console.log(
    `  Unmatched: AH=${byStore.ah.length}, Jumbo=${byStore.jumbo.length}, Dirk=${byStore.dirk.length}`
  );

  const insertMatch = db.prepare(
    'INSERT INTO product_matches (canonical_name, match_type, confidence, confirmed) VALUES (?, ?, ?, ?)'
  );
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO product_match_members (match_id, product_id) VALUES (?, ?)'
  );

  let created = 0;
  let skipped = 0;

  // Build index of normalized names per store
  const storeIndex = {};
  for (const store of ['ah', 'jumbo', 'dirk']) {
    storeIndex[store] = new Map();
    for (const p of byStore[store]) {
      const norm = p.normalized_name || normalizeName(p.name, p.supermarket);
      const stripped = stripTrailingUnit(norm);
      if (!storeIndex[store].has(stripped)) {
        storeIndex[store].set(stripped, []);
      }
      storeIndex[store].get(stripped).push(p);
    }
  }

  const matched = new Set();

  const createMatch = db.transaction((members, canonicalName, matchType, confidence, confirmed) => {
    if (dryRun) return;
    const result = insertMatch.run(canonicalName, matchType, confidence, confirmed ? 1 : 0);
    for (const member of members) {
      insertMember.run(result.lastInsertRowid, member.id);
      matched.add(member.id);
    }
    created++;
  });

  // --- Tier 1: Exact normalized name match ---
  console.log('  Tier 1: Exact normalized name matching...');
  const allNames = new Set();
  for (const store of ['ah', 'jumbo', 'dirk']) {
    for (const key of storeIndex[store].keys()) {
      allNames.add(key);
    }
  }

  for (const name of allNames) {
    const members = [];
    const stores = new Set();

    for (const store of ['ah', 'jumbo', 'dirk']) {
      const candidates = storeIndex[store].get(name);
      if (candidates) {
        for (const c of candidates) {
          if (!matched.has(c.id)) {
            members.push(c);
            stores.add(store);
            break; // one per store
          }
        }
      }
    }

    if (stores.size >= 2) {
      // Check unit compatibility
      const compatMembers = members.filter((m, i, arr) =>
        i === 0 ? true : unitsCompatible(m, arr[0])
      );
      if (compatMembers.length >= 2 && new Set(compatMembers.map((m) => m.supermarket)).size >= 2) {
        createMatch(compatMembers, name, 'exact', 0.95, true);
      }
    }
  }
  console.log(`    Tier 1 matches: ${created}`);

  // --- Tier 2: Close Levenshtein match (distance <= 3) within same category ---
  console.log('  Tier 2: Fuzzy name matching (Levenshtein, within category)...');
  const tier2Start = created;

  // Build category-based index for efficient comparison
  const catIndex = new Map(); // canonical_category → { store → [{ name, product }] }
  const catStmt = db.prepare(
    'SELECT canonical_category FROM category_map WHERE supermarket = ? AND original_category = ?'
  );

  for (const store of ['ah', 'jumbo', 'dirk']) {
    for (const [name, products] of storeIndex[store]) {
      const prod = products.find((p) => !matched.has(p.id));
      if (!prod) continue;
      const catRow = prod.category ? catStmt.get(prod.supermarket, prod.category) : null;
      const cat = catRow ? catRow.canonical_category : (prod.category || '_unknown');
      if (!catIndex.has(cat)) catIndex.set(cat, { ah: [], jumbo: [], dirk: [] });
      catIndex.get(cat)[store].push({ name, product: prod });
    }
  }

  // Compare within each category
  for (const [cat, stores] of catIndex) {
    // Use AH as base, find matches in Jumbo/Dirk
    for (const { name: ahName, product: ahProd } of stores.ah) {
      if (matched.has(ahProd.id)) continue;

      const candidates = [];
      for (const store of ['jumbo', 'dirk']) {
        for (const { name: otherName, product: otherProd } of stores[store]) {
          if (matched.has(otherProd.id)) continue;

          const dist = levenshtein(ahName, otherName);
          const maxLen = Math.max(ahName.length, otherName.length);
          if (maxLen === 0) continue;

          if (dist <= 3 && dist / maxLen < 0.2) {
            if (unitsCompatible(ahProd, otherProd)) {
              candidates.push({ product: otherProd, distance: dist, store });
            }
          }
        }
      }

      if (candidates.length > 0) {
        const members = [ahProd];
        const confidence = Math.max(0.7, 1 - candidates[0].distance * 0.1);
        for (const c of candidates) {
          members.push(c.product);
        }
        createMatch(members, ahName, 'fuzzy', confidence, false);
      }
    }
  }

  console.log(`    Tier 2 matches: ${created - tier2Start}`);

  console.log(`\nAuto-matching complete: ${created} match groups created`);
  return { created, skipped };
}

/**
 * Get unconfirmed match suggestions for interactive review.
 */
function getUnconfirmedMatches({ category = null, limit = 50 } = {}) {
  const db = getDb();

  let query = `
    SELECT m.id, m.canonical_name, m.match_type, m.confidence
    FROM product_matches m
    WHERE m.confirmed = 0`;

  const params = [];

  if (category) {
    query += ` AND EXISTS (
      SELECT 1 FROM product_match_members mm
      JOIN products p ON p.id = mm.product_id
      WHERE mm.match_id = m.id AND (
        p.category LIKE ? OR EXISTS (
          SELECT 1 FROM category_map cm
          WHERE cm.supermarket = p.supermarket AND cm.original_category = p.category
          AND cm.canonical_category = ?
        )
      )
    )`;
    params.push(`%${category}%`, category);
  }

  query += ' ORDER BY m.confidence DESC LIMIT ?';
  params.push(limit);

  const matches = db.prepare(query).all(...params);

  const memberStmt = db.prepare(
    `SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.price_per_unit,
            pr.price as latest_price
     FROM product_match_members mm
     JOIN products p ON p.id = mm.product_id
     LEFT JOIN prices pr ON pr.id = (
       SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1
     )
     WHERE mm.match_id = ?
     ORDER BY p.supermarket`
  );

  return matches.map((m) => ({
    ...m,
    members: memberStmt.all(m.id),
  }));
}

/**
 * Confirm or reject a match.
 */
function confirmMatch(matchId, confirmed) {
  const db = getDb();
  if (confirmed) {
    db.prepare('UPDATE product_matches SET confirmed = 1 WHERE id = ?').run(matchId);
  } else {
    // Delete the match and its members
    db.prepare('DELETE FROM product_match_members WHERE match_id = ?').run(matchId);
    db.prepare('DELETE FROM product_matches WHERE id = ?').run(matchId);
  }
}

module.exports = {
  levenshtein,
  autoMatch,
  getUnconfirmedMatches,
  confirmMatch,
};
