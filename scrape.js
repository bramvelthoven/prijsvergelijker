const ah = require('./scrapers/ah');
const jumbo = require('./scrapers/jumbo');
const lidl = require('./scrapers/lidl');
const dirk = require('./scrapers/dirk');
const { getTodayStats, close } = require('./db/database');
const { migrate } = require('./db/migrate');
const { normalizeAllUnits, normalizeAllNames } = require('./analysis/units');

const scrapers = [
  { name: 'Albert Heijn', module: ah },
  { name: 'Jumbo', module: jumbo },
  { name: 'Lidl', module: lidl },
  { name: 'Dirk', module: dirk },
];

async function runAll() {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log(`Prijsscraper gestart — ${new Date().toLocaleString('nl-NL')}`);
  console.log('Scraping AH + Jumbo + Dirk (alle categorieen)');
  console.log('='.repeat(60));

  const results = [];

  for (const scraper of scrapers) {
    const scraperStart = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${scraper.name}`);
    console.log('─'.repeat(60));

    try {
      const stats = await scraper.module.run();
      const elapsed = ((Date.now() - scraperStart) / 1000).toFixed(0);
      results.push({ name: scraper.name, ...stats });
      console.log(
        `\n[${scraper.name}] Klaar in ${elapsed}s: ${stats.scraped} producten, ${stats.inserted} nieuwe prijzen, ${stats.errors} fouten`
      );
    } catch (error) {
      console.error(`[${scraper.name}] FOUT: ${error.message}`);
      results.push({ name: scraper.name, scraped: 0, inserted: 0, errors: 1 });
    }
  }

  // Print summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('SAMENVATTING');
  console.log('='.repeat(60));

  const totals = results.reduce(
    (acc, r) => ({
      scraped: acc.scraped + r.scraped,
      inserted: acc.inserted + r.inserted,
      errors: acc.errors + r.errors,
    }),
    { scraped: 0, inserted: 0, errors: 0 }
  );

  for (const r of results) {
    const status = r.errors > 0 ? '(met fouten)' : 'OK';
    console.log(`  ${r.name}: ${r.scraped} producten, ${r.inserted} prijzen ${status}`);
  }

  console.log(`\n  TOTAAL: ${totals.scraped} producten, ${totals.inserted} prijzen, ${totals.errors} fouten`);
  console.log(`  Tijd: ${totalTime} minuten`);

  const dbStats = getTodayStats();
  console.log(`  Database vandaag: ${dbStats.products} producten, ${dbStats.prices} prijsrecords`);
  console.log('='.repeat(60));

  // Post-processing: normalize units and names
  console.log('\nPost-processing...');
  try {
    migrate();
    normalizeAllUnits();
    normalizeAllNames();
    console.log('Post-processing klaar.');
  } catch (err) {
    console.error('Post-processing fout:', err.message);
  }

  console.log('='.repeat(60));

  close();
}

runAll().catch((error) => {
  console.error('Onverwachte fout:', error);
  close();
  process.exit(1);
});
