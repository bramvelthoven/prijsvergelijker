const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');

const SCRAPE_SCRIPT = path.join(__dirname, 'scrape.js');
const GENERATE_SCRIPT = path.join(__dirname, 'generate-site.js');

console.log('Prijsscraper scheduler gestart');
console.log('Scraping wordt elke dag om 06:00 uitgevoerd');
console.log('Druk op Ctrl+C om te stoppen\n');

// Run daily at 06:00
cron.schedule('0 6 * * *', () => {
  console.log(`\n[${new Date().toLocaleString('nl-NL')}] Dagelijkse scrape gestart...`);

  execFile('node', [SCRAPE_SCRIPT], { cwd: __dirname }, (error, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (error) {
      console.error(`Scrape proces fout: ${error.message}`);
      return;
    }
    console.log('Dagelijkse scrape voltooid, site genereren...');

    execFile('node', [GENERATE_SCRIPT], { cwd: __dirname }, (err2, out2, serr2) => {
      if (out2) console.log(out2);
      if (serr2) console.error(serr2);
      if (err2) {
        console.error(`Site generatie fout: ${err2.message}`);
      } else {
        console.log('Statische site bijgewerkt');
      }
    });
  });
}, {
  timezone: 'Europe/Amsterdam',
});

// Keep the process alive
process.on('SIGINT', () => {
  console.log('\nScheduler gestopt');
  process.exit(0);
});
