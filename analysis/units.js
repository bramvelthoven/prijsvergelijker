const { getDb } = require('../db/database');

/**
 * Parse a messy unit string into { quantity (in base unit), type ("g"|"ml"|"stuk") }.
 * Returns null if unparseable.
 */
function parseUnit(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.trim();

  // Strip prefixes: "N+ dagen houdbaar • ", "Diepvries • ", "Gesponsord • "
  s = s.replace(/^\d+\+?\s*dagen?\s*houdbaar\s*•\s*/i, '');
  s = s.replace(/^Diepvries\s*•\s*/i, '');
  s = s.replace(/^Gesponsord\s*•\s*/i, '');

  // Strip suffixes: " • Met/Zonder doos", " • Zonder doos", etc.
  s = s.replace(/\s*•\s*(Met|Zonder)\s+\w+$/i, '');

  // Strip ", verpakt" suffix
  s = s.replace(/,\s*verpakt$/i, '');

  // Strip "(ca. N stuks)" suffix — e.g. "1 kg (ca. 10 stuks)"
  s = s.replace(/\s*\(ca\.\s*\d+\s*stuks?\)/i, '');

  s = s.trim();
  if (!s) return null;

  // --- "per stuk" / "per bos" / "per bosje" / "per paar" / "per set" / "per rol" / "per pakket" ---
  if (/^per\s+(stuk|bos|bosje|paar|set|rol|pakket)$/i.test(s)) {
    return { qty: 1, type: 'stuk' };
  }

  // --- "Per 1,5 kilo" ---
  const perKilo = s.match(/^per\s+([\d.,]+)\s*kilo$/i);
  if (perKilo) {
    const kg = parseDecimal(perKilo[1]);
    return kg ? { qty: kg * 1000, type: 'g' } : null;
  }

  // --- "Per bos" ---
  if (/^Per\s+bos$/i.test(s)) {
    return { qty: 1, type: 'stuk' };
  }

  // --- "N personen" / "N pers | ..." / "N-N pers | ..." → skip, not a measurable unit ---
  if (/^\d+(-\d+)?\s*pers/i.test(s)) return null;

  // --- "Diepvries" alone (no quantity after) ---
  if (/^Diepvries$/i.test(s)) return null;

  // --- "N+ dagen houdbaar" alone (no quantity after) ---
  if (/^\d+\+?\s*dagen?\s*houdbaar$/i.test(s)) return null;

  // --- Non-unit types: wasbeurten, rollen, meter, tabletten, cm ---
  if (/wasbeurten|rollen|meter|tabletten|capsules|cups/i.test(s)) return null;
  if (/^\d+\s*m\s*x\s*/i.test(s)) return null; // e.g. "1 m x 6 cm", "5m x 6cm"

  // --- Multipack: "N x QTY UNIT" ---
  const multipack = s.match(
    /^(\d+)\s*x\s*([\d.,]+)\s*(g|gr|gram|kg|kilo|ml|cl|l|liter|lt|stuks?|stuk|st)\b\.?/i
  );
  if (multipack) {
    const count = parseInt(multipack[1], 10);
    const inner = parseDecimal(multipack[2]);
    const unit = normalizeUnitName(multipack[3]);
    if (!inner || !unit) return null;
    const baseQty = toBaseUnit(inner, unit);
    if (baseQty === null) return null;
    return { qty: count * baseQty.qty, type: baseQty.type };
  }

  // --- Multipack of multipacks: "N x N x QTY UNIT" (e.g. "4 x 6 x 330 ml") ---
  const doubleMulti = s.match(
    /^(\d+)\s*x\s*(\d+)\s*x\s*([\d.,]+)\s*(g|gr|gram|kg|kilo|ml|cl|l|liter|lt)\b\.?/i
  );
  if (doubleMulti) {
    const outer = parseInt(doubleMulti[1], 10);
    const inner = parseInt(doubleMulti[2], 10);
    const qty = parseDecimal(doubleMulti[3]);
    const unit = normalizeUnitName(doubleMulti[4]);
    if (!qty || !unit) return null;
    const baseQty = toBaseUnit(qty, unit);
    if (baseQty === null) return null;
    return { qty: outer * inner * baseQty.qty, type: baseQty.type };
  }

  // --- Multipack with stuks subunit: "N x N stuks" ---
  const multiStuk = s.match(/^(\d+)\s*x\s*(\d+)\s*stuks?$/i);
  if (multiStuk) {
    return { qty: parseInt(multiStuk[1]) * parseInt(multiStuk[2]), type: 'stuk' };
  }

  // --- Simple: "QTY UNIT" (e.g. "500 g", "0,75 l", "1.5 LITER") ---
  const simple = s.match(
    /^(ca\.?\s*)?([\d.,]+)\s*(g|gr|gram|kg|kilo|ml|cl|l|liter|lt|stuks?|stuk|st)\b\.?$/i
  );
  if (simple) {
    const qty = parseDecimal(simple[2]);
    const unit = normalizeUnitName(simple[3]);
    if (!qty || !unit) return null;
    const baseQty = toBaseUnit(qty, unit);
    return baseQty;
  }

  // --- "los per 500 g" ---
  const losPer = s.match(/^los\s+per\s+([\d.,]+)\s*(g|kg|ml|l)\b/i);
  if (losPer) {
    const qty = parseDecimal(losPer[1]);
    const unit = normalizeUnitName(losPer[2]);
    if (!qty || !unit) return null;
    return toBaseUnit(qty, unit);
  }

  // --- "N stuks" ---
  const stuks = s.match(/^(\d+)\s*stuks?$/i);
  if (stuks) {
    return { qty: parseInt(stuks[1], 10), type: 'stuk' };
  }

  // --- Bare number with decimal (e.g. "0.33 cl") already caught above ---

  return null;
}

/**
 * Parse a decimal string that may use , or . as separator.
 */
function parseDecimal(str) {
  if (!str) return null;
  // "1,5" → "1.5", "0,75" → "0.75"
  const normalized = str.replace(',', '.');
  const val = parseFloat(normalized);
  return isNaN(val) || val <= 0 ? null : val;
}

/**
 * Normalize unit name variants to a canonical form.
 */
function normalizeUnitName(unit) {
  const u = unit.toLowerCase().replace(/\.$/, '');
  switch (u) {
    case 'g':
    case 'gr':
    case 'gram':
      return 'g';
    case 'kg':
    case 'kilo':
      return 'kg';
    case 'ml':
      return 'ml';
    case 'cl':
      return 'cl';
    case 'l':
    case 'liter':
    case 'lt':
      return 'l';
    case 'stuk':
    case 'stuks':
    case 'st':
      return 'stuk';
    default:
      return null;
  }
}

/**
 * Convert a quantity + unit to base unit (g or ml or stuk).
 */
function toBaseUnit(qty, unit) {
  switch (unit) {
    case 'g':
      return { qty, type: 'g' };
    case 'kg':
      return { qty: qty * 1000, type: 'g' };
    case 'ml':
      return { qty, type: 'ml' };
    case 'cl':
      return { qty: qty * 10, type: 'ml' };
    case 'l':
      return { qty: qty * 1000, type: 'ml' };
    case 'stuk':
      return { qty, type: 'stuk' };
    default:
      return null;
  }
}

/**
 * Calculate price per standard unit (per kg, per liter, or per stuk).
 */
function calcPricePerUnit(price, qty, type) {
  if (!price || !qty || qty <= 0) return null;
  switch (type) {
    case 'g':
      return (price / qty) * 1000; // price per kg
    case 'ml':
      return (price / qty) * 1000; // price per liter
    case 'stuk':
      return price / qty; // price per stuk
    default:
      return null;
  }
}

/**
 * Run unit normalization on all products in the database.
 * Updates unit_quantity, unit_type, price_per_unit for each product.
 */
function normalizeAllUnits() {
  const db = getDb();

  const products = db
    .prepare(
      `SELECT p.id, p.unit, p.name, p.supermarket,
              (SELECT price FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1) as latest_price
       FROM products p`
    )
    .all();

  const update = db.prepare(
    'UPDATE products SET unit_quantity = ?, unit_type = ?, price_per_unit = ? WHERE id = ?'
  );

  let parsed = 0;
  let skipped = 0;

  const updateAll = db.transaction(() => {
    for (const product of products) {
      const result = parseUnit(product.unit);
      if (result) {
        const ppu = calcPricePerUnit(product.latest_price, result.qty, result.type);
        update.run(result.qty, result.type, ppu, product.id);
        parsed++;
      } else {
        update.run(null, null, null, product.id);
        skipped++;
      }
    }
  });

  updateAll();

  console.log(`Unit normalization: ${parsed} parsed, ${skipped} skipped (of ${products.length} total)`);
  return { parsed, skipped, total: products.length };
}

/**
 * Generate a normalized name by stripping store prefixes and lowercasing.
 */
function normalizeName(name, supermarket) {
  let n = name.trim();

  // Strip store-brand prefixes
  const prefixes = [
    'AH Biologisch ',
    'AH Biologische ',
    'AH Terra Plant Based ',
    'AH Excellent ',
    'AH Basic ',
    'AH ',
    'Jumbo Biologische ',
    'Jumbo Biologisch ',
    'Jumbo ',
    '1 de Beste ',
  ];

  for (const prefix of prefixes) {
    if (n.startsWith(prefix)) {
      n = n.slice(prefix.length);
      break;
    }
  }

  return n.toLowerCase().trim();
}

/**
 * Update normalized_name for all products.
 */
function normalizeAllNames() {
  const db = getDb();

  const products = db.prepare('SELECT id, name, supermarket FROM products').all();
  const update = db.prepare('UPDATE products SET normalized_name = ? WHERE id = ?');

  const updateAll = db.transaction(() => {
    for (const p of products) {
      update.run(normalizeName(p.name, p.supermarket), p.id);
    }
  });

  updateAll();
  console.log(`Name normalization: ${products.length} products updated`);
}

module.exports = {
  parseUnit,
  parseDecimal,
  normalizeUnitName,
  toBaseUnit,
  calcPricePerUnit,
  normalizeAllUnits,
  normalizeName,
  normalizeAllNames,
};
