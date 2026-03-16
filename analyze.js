const { close } = require('./db/database');
const { migrate } = require('./db/migrate');
const { normalizeAllUnits, normalizeAllNames } = require('./analysis/units');
const { getStats, searchProducts, compareProducts, getCanonicalCategories } = require('./analysis/queries');
const { autoMatch, getUnconfirmedMatches, confirmMatch } = require('./analysis/matching');
const {
  getPriceChanges,
  getInflationByCategory,
  getInflationBySupermarket,
  findFakeSales,
  findShrinkflation,
} = require('./analysis/inflation');
const readline = require('readline');

const STORE_COLORS = {
  ah: '\x1b[34m',     // blue
  jumbo: '\x1b[33m',  // yellow
  dirk: '\x1b[32m',   // green
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

function colorStore(store) {
  return `${STORE_COLORS[store] || ''}${store}${RESET}`;
}

function formatPrice(price) {
  if (price == null) return '-';
  return `€${price.toFixed(2)}`;
}

function formatPPU(ppu, type) {
  if (ppu == null) return '';
  const unitLabel = type === 'g' ? '/kg' : type === 'ml' ? '/l' : '/stuk';
  return `${DIM}(${formatPrice(ppu)}${unitLabel})${RESET}`;
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdStats() {
  const stats = getStats();

  console.log(`\n${BOLD}Database Overzicht${RESET}`);
  console.log('═'.repeat(50));

  console.log(`\n${BOLD}Producten per supermarkt:${RESET}`);
  let totalProducts = 0;
  for (const s of stats.perStore) {
    totalProducts += s.products;
    console.log(
      `  ${colorStore(s.supermarket).padEnd(20)} ${String(s.products).padStart(7)} producten  (${s.with_units} met eenheid)`
    );
  }
  console.log(`  ${'Totaal'.padEnd(11)} ${String(totalProducts).padStart(7)} producten`);

  console.log(`\n${BOLD}Prijsrecords:${RESET} ${stats.totalPrices.toLocaleString('nl-NL')}`);
  console.log(
    `${BOLD}Periode:${RESET} ${stats.dateRange.first_date} t/m ${stats.dateRange.last_date} (${stats.dateRange.days} dagen)`
  );
  console.log(`${BOLD}Categorieën:${RESET} ${stats.categories}`);

  const cats = getCanonicalCategories();
  if (cats.length) {
    console.log(`\n${BOLD}Canonieke categorieën:${RESET}`);
    for (const c of cats) {
      console.log(`  ${c.canonical_category.padEnd(25)} ${String(c.product_count).padStart(6)} producten`);
    }
  }

  console.log();
}

function cmdSearch(term) {
  if (!term) {
    console.error('Gebruik: node analyze.js search <zoekterm>');
    return;
  }

  const results = searchProducts(term, { limit: 30 });

  if (results.length === 0) {
    console.log(`Geen producten gevonden voor "${term}"`);
    return;
  }

  console.log(`\n${BOLD}Zoekresultaten voor "${term}" (${results.length}):${RESET}\n`);

  for (const p of results) {
    const sale = p.is_sale ? ` ${RED}ACTIE${RESET} (was ${formatPrice(p.original_price)})` : '';
    const ppu = formatPPU(p.price_per_unit, p.unit_type);
    console.log(
      `  ${colorStore(p.supermarket).padEnd(18)} ${formatPrice(p.latest_price).padStart(7)}  ${p.name}${sale} ${ppu}`
    );
    if (p.unit) {
      console.log(`${' '.repeat(27)}${DIM}${p.unit}${RESET}`);
    }
  }
  console.log();
}

function cmdCompare(term) {
  if (!term) {
    console.error('Gebruik: node analyze.js compare <zoekterm>');
    return;
  }

  const { multiStore, singleStore } = compareProducts(term);

  if (multiStore.length === 0 && singleStore.length === 0) {
    console.log(`Geen producten gevonden voor "${term}"`);
    return;
  }

  if (multiStore.length > 0) {
    console.log(`\n${BOLD}Prijsvergelijking voor "${term}":${RESET}\n`);

    for (const group of multiStore.slice(0, 15)) {
      console.log(`${BOLD}${group.name}${RESET}`);

      // Sort by price
      const sorted = group.items
        .filter((i) => i.latest_price != null)
        .sort((a, b) => a.latest_price - b.latest_price);

      if (sorted.length === 0) continue;

      const cheapest = sorted[0].latest_price;

      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const diff =
          i === 0
            ? `${GREEN}← goedkoopst${RESET}`
            : `${RED}(+${Math.round(((p.latest_price - cheapest) / cheapest) * 100)}%)${RESET}`;
        const ppu = formatPPU(p.price_per_unit, p.unit_type);
        const sale = p.is_sale ? ` ${DIM}ACTIE${RESET}` : '';
        console.log(
          `  ${colorStore(p.supermarket).padEnd(18)} ${formatPrice(p.latest_price).padStart(7)}  ${diff}${sale} ${ppu}`
        );
      }
      console.log();
    }
  }

  if (singleStore.length > 0 && multiStore.length === 0) {
    console.log(`\n${DIM}Producten gevonden bij slechts 1 winkel:${RESET}`);
    for (const group of singleStore.slice(0, 10)) {
      const p = group.items[0];
      console.log(
        `  ${colorStore(p.supermarket).padEnd(18)} ${formatPrice(p.latest_price).padStart(7)}  ${p.name}`
      );
    }
    console.log();
  }
}

function cmdNormalize() {
  console.log('Running unit normalization...');
  normalizeAllUnits();
  console.log('Running name normalization...');
  normalizeAllNames();
}

function cmdMatch({ category, dryRun } = {}) {
  autoMatch({ category, dryRun });
}

async function cmdSuggestMatches({ category } = {}) {
  const suggestions = getUnconfirmedMatches({ category, limit: 100 });

  if (suggestions.length === 0) {
    console.log('Geen onbevestigde matches gevonden. Eerst `node analyze.js match` uitvoeren.');
    return;
  }

  console.log(`\n${BOLD}Match suggesties (${suggestions.length}):${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  for (let i = 0; i < suggestions.length; i++) {
    const match = suggestions[i];

    console.log(
      `${BOLD}[${i + 1}/${suggestions.length}]${RESET} "${match.canonical_name}" ${DIM}(${match.match_type}, confidence: ${match.confidence?.toFixed(2) || '?'})${RESET}`
    );

    for (const m of match.members) {
      const ppu = formatPPU(m.price_per_unit, m.unit_type);
      console.log(
        `  ${colorStore(m.supermarket).padEnd(18)} ${formatPrice(m.latest_price).padStart(7)}  ${m.name} ${DIM}(${m.unit || '?'})${RESET} ${ppu}`
      );
    }

    const answer = await ask('  Bevestigen? [Y/n/skip/quit] ');
    const a = answer.trim().toLowerCase();

    if (a === 'q' || a === 'quit') {
      console.log('Gestopt.');
      break;
    } else if (a === 'n') {
      confirmMatch(match.id, false);
      console.log(`  ${RED}Verwijderd${RESET}\n`);
    } else if (a === 'skip' || a === 's') {
      console.log(`  ${DIM}Overgeslagen${RESET}\n`);
    } else {
      // Default: yes
      confirmMatch(match.id, true);
      console.log(`  ${GREEN}Bevestigd${RESET}\n`);
    }
  }

  rl.close();
}

function cmdInflation({ days = 30, category = null } = {}) {
  console.log(`\n${BOLD}Inflatie-analyse (afgelopen ${days} dagen)${RESET}\n`);

  // Per supermarket
  const byStore = getInflationBySupermarket({ days });
  if (byStore.length > 0) {
    console.log(`${BOLD}Per supermarkt:${RESET}`);
    for (const s of byStore) {
      const arrow = s.avg_change_pct > 0 ? RED : GREEN;
      console.log(
        `  ${colorStore(s.supermarket).padEnd(18)} ${arrow}${s.avg_change_pct > 0 ? '+' : ''}${s.avg_change_pct}%${RESET}  (${s.increased}↑ ${s.decreased}↓ van ${s.products} producten)`
      );
    }
    console.log();
  }

  // Per category
  const byCat = getInflationByCategory({ days });
  if (byCat.length > 0) {
    console.log(`${BOLD}Per categorie:${RESET}`);
    for (const c of byCat.slice(0, 20)) {
      const arrow = c.avg_change_pct > 0 ? RED : GREEN;
      console.log(
        `  ${(c.category || 'onbekend').padEnd(30)} ${arrow}${c.avg_change_pct > 0 ? '+' : ''}${c.avg_change_pct}%${RESET}  (${c.increased}↑ ${c.decreased}↓)`
      );
    }
    console.log();
  }

  if (byStore.length === 0 && byCat.length === 0) {
    console.log('Nog geen prijsveranderingen gevonden. Meer data nodig (minstens 2 scrape-runs op verschillende dagen).');
  }
}

function cmdGraaiflatie({ threshold = 10, days = 30 } = {}) {
  const changes = getPriceChanges({ days, minChange: threshold });

  if (changes.length === 0) {
    console.log(`Geen producten gevonden met >${threshold}% prijsverandering in de afgelopen ${days} dagen.`);
    return;
  }

  // Split increases and decreases
  const increases = changes.filter((c) => c.pct_change > 0);
  const decreases = changes.filter((c) => c.pct_change < 0);

  if (increases.length > 0) {
    console.log(`\n${BOLD}${RED}Grootste prijsstijgingen (>${threshold}%):${RESET}\n`);
    for (const p of increases.slice(0, 50)) {
      console.log(
        `  ${RED}+${p.pct_change}%${RESET}  ${colorStore(p.supermarket).padEnd(18)} ${formatPrice(p.first_price)} → ${formatPrice(p.latest_price)}  ${p.name}`
      );
    }
  }

  if (decreases.length > 0) {
    console.log(`\n${BOLD}${GREEN}Grootste prijsdalingen (>${threshold}%):${RESET}\n`);
    for (const p of decreases.slice(-20).reverse()) {
      console.log(
        `  ${GREEN}${p.pct_change}%${RESET}  ${colorStore(p.supermarket).padEnd(18)} ${formatPrice(p.first_price)} → ${formatPrice(p.latest_price)}  ${p.name}`
      );
    }
  }
  console.log();
}

function cmdSalesFraud() {
  const fakes = findFakeSales({ minSalePct: 80 });

  if (fakes.length === 0) {
    console.log('Geen nep-aanbiedingen gevonden (producten die >80% van de tijd "in de aanbieding" zijn).');
    console.log('Meer prijsdata nodig (minstens 3 scrape-runs).');
    return;
  }

  console.log(`\n${BOLD}Verdachte "permanente aanbiedingen":${RESET}\n`);
  for (const p of fakes.slice(0, 50)) {
    console.log(
      `  ${RED}${p.sale_pct}%${RESET} actie  ${colorStore(p.supermarket).padEnd(18)} ${p.name}  ${DIM}(${p.sale_count}/${p.total_prices} keer in actie)${RESET}`
    );
  }
  console.log();
}

function cmdShrinkflation() {
  const changes = findShrinkflation();

  if (changes.length === 0) {
    console.log('Geen verpakkingswijzigingen gedetecteerd.');
    return;
  }

  console.log(`\n${BOLD}Verpakkingswijzigingen (mogelijke shrinkflation):${RESET}\n`);
  for (const c of changes) {
    console.log(
      `  ${colorStore(c.supermarket).padEnd(18)} ${c.name}`
    );
    console.log(
      `    ${RED}${c.old_unit}${RESET} → ${c.new_unit}  ${DIM}(${c.detected_at})${RESET}`
    );
  }
  console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse flags
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      flags[key] = val;
      if (val !== true) i++;
    }
  }

  // Get the search term (first non-flag argument after command)
  const term = args
    .slice(1)
    .filter((a) => !a.startsWith('--'))
    .join(' ');

  // Ensure migration has run
  migrate();

  try {
    switch (command) {
      case 'stats':
        cmdStats();
        break;

      case 'search':
        cmdSearch(term);
        break;

      case 'compare':
        cmdCompare(term);
        break;

      case 'normalize':
        cmdNormalize();
        break;

      case 'match':
        cmdMatch({ category: flags.category, dryRun: flags['dry-run'] === true });
        break;

      case 'suggest-matches':
        await cmdSuggestMatches({ category: flags.category });
        break;

      case 'inflation':
        cmdInflation({ days: parseInt(flags.days) || 30, category: flags.category || null });
        break;

      case 'graaiflatie':
        cmdGraaiflatie({
          threshold: parseInt(flags.threshold) || 10,
          days: parseInt(flags.days) || 30,
        });
        break;

      case 'sales-fraud':
        cmdSalesFraud();
        break;

      case 'shrinkflation':
        cmdShrinkflation();
        break;

      default:
        console.log(`
${BOLD}Prijsanalyse CLI${RESET}

Gebruik:
  node analyze.js stats                          Database overzicht
  node analyze.js search <zoekterm>              Zoek producten
  node analyze.js compare <zoekterm>             Vergelijk prijzen tussen winkels
  node analyze.js normalize                      Normaliseer eenheden & namen
  node analyze.js match [--category ...]         Auto-match producten tussen winkels
  node analyze.js suggest-matches [--category .] Interactief matches bevestigen
  node analyze.js inflation [--days 30]          Inflatie per categorie/winkel
  node analyze.js graaiflatie [--threshold 10]   Grootste prijsstijgingen
  node analyze.js sales-fraud                    Nep-aanbiedingen detecteren
  node analyze.js shrinkflation                  Verpakkingswijzigingen
`);
    }
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error('Fout:', err.message);
  close();
  process.exit(1);
});
