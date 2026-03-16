# Prijsscraper — Supermarkt Prijzen Tracker

Scrape dagelijks productprijzen van Nederlandse supermarkten en sla ze op in een lokale SQLite database. Track prijshistorie en detecteer graaiflatie.

## Ondersteunde supermarkten

| Supermarkt | Status | Producten (geschat) |
|------------|--------|---------------------|
| Albert Heijn | Actief — alle 27 categorieen | ~10.000+ |
| Jumbo | Actief — alle 18 categorieen | ~17.800 |
| Dirk | Actief — alle 11 categorieen | ~3.000+ |
| Lidl | Niet beschikbaar (geen online catalog) | — |

## Installatie

```bash
cd scraper
npm install
npx playwright install chromium
```

## Gebruik

### Eenmalig scrapen

```bash
node scrape.js
```

Scrapet **alle producten** van AH, Jumbo en Dirk. Dit duurt ca. 30-60 minuten vanwege rate limiting en pagination. Een Chromium-venster opent tijdelijk (headless wordt geblokkeerd door de supermarkten).

### Dagelijks automatisch scrapen

```bash
node schedule.js
```

Start een scheduler die elke dag om 06:00 (Amsterdam tijdzone) automatisch scrapet.

```bash
# Met pm2 als achtergrondproces:
npm install -g pm2
pm2 start schedule.js --name prijsscraper
pm2 save
```

### Data exporteren

```bash
node export.js
```

Exporteert alle prijsdata naar JSON en CSV in de `exports/` map.

## Projectstructuur

```
/scraper
  scrape.js           ← hoofdscript, scrape alle supermarkten
  schedule.js         ← dagelijkse scheduler (06:00)
  export.js           ← exporteer data naar JSON/CSV
  /scrapers
    ah.js             ← Albert Heijn (27 categorieen, paginatie)
    jumbo.js          ← Jumbo (18 categorieen, button-paginatie)
    dirk.js           ← Dirk (11 categorieen, subcategoriepagina's)
    lidl.js           ← Lidl (niet beschikbaar)
  /db
    database.js       ← SQLite setup en helpers
  /utils
    helpers.js        ← browser setup, delays, retry, user agents
  /exports            ← gegenereerde export bestanden
  prices.db           ← SQLite database (wordt automatisch aangemaakt)
```

## Database schema

**products** — unieke producten per supermarkt
- `id`, `name`, `brand`, `category`, `unit`, `supermarket`, `url`, `created_at`
- Unique constraint op `(name, supermarket)` — geen duplicaten

**prices** — prijshistorie per product
- `id`, `product_id`, `price`, `original_price`, `is_sale`, `scraped_at`
- Maximaal 1 prijs per product per dag

## Hoe het werkt

Elke scraper:
1. Opent een Chromium-browser in headed mode (headless wordt geblokkeerd)
2. Navigeert door alle categorieen en paginapagina's
3. Extraheert productnaam, prijs, eenheid, URL en actie-informatie
4. Slaat nieuwe producten op en voegt prijsrecords toe
5. Slaat producten over waarvoor vandaag al een prijs is opgeslagen

**Rate limiting**: 1-3 seconden willekeurige vertraging tussen requests, zware resources (afbeeldingen, fonts) worden geblokkeerd.

## Een nieuwe supermarkt toevoegen

1. Maak een nieuw bestand in `/scrapers` (bijv. `plus.js`)
2. Exporteer een `run()` functie die `{ scraped, inserted, errors }` teruggeeft
3. Gebruik `createBrowser()` uit `utils/helpers.js` voor de browser setup
4. Gebruik `upsertProduct()` en `insertPrice()` uit `db/database.js`
5. Voeg de scraper toe aan het `scrapers` array in `scrape.js`

## Juridische/ethische overwegingen

- **robots.txt**: Respecteer disallow-regels van websites
- **Rate limiting**: Willekeurige vertragingen tussen requests (1-3s)
- **Persoonlijk gebruik**: Bedoeld voor persoonlijk prijsonderzoek
- **Geen inloggen**: Alleen openbaar beschikbare productpagina's
- **Frequentie**: Maximaal eenmaal per dag per supermarkt
- **Resources**: Zware resources (afbeeldingen) worden niet geladen
