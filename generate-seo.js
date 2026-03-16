const fs = require('fs');
const path = require('path');
const { getDb } = require('./db/database');

const OUT_DIR = path.join(__dirname, 'web', 'public');
const SITE_URL = 'https://prijsvergelijker-seven.vercel.app'; // Update when custom domain is set
const SN = { ah: 'Albert Heijn', jumbo: 'Jumbo', dirk: 'Dirk' };

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtP(p) {
  return p != null ? `\u20AC${p.toFixed(2)}` : '';
}

function writeFile(filepath, content) {
  const full = path.join(OUT_DIR, filepath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Shared HTML template
function htmlPage({ title, description, canonical, body, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE_URL}${canonical}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛒</text></svg>">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}${canonical}">
  <meta property="og:locale" content="nl_NL">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
  <style>
    :root { --bg:#0a0c10;--bg2:#13161d;--bg3:#1a1e28;--border:#262d3a;--text:#e4e8f0;--text2:#8892a4;--text3:#505a6e;--blue:#5ba0f5;--green:#44c76a;--red:#f06050;--yellow:#e8b84a; }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
    .header{background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:12px}
    .header a{color:var(--text);text-decoration:none;font-size:20px;font-weight:700;display:flex;align-items:center;gap:8px}
    .container{max-width:1000px;margin:0 auto;padding:24px}
    h1{font-size:22px;margin-bottom:8px;letter-spacing:-0.3px}
    h2{font-size:17px;margin:24px 0 12px;color:var(--text2)}
    p.desc{color:var(--text2);margin-bottom:24px;font-size:15px;line-height:1.6}
    a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
    .breadcrumb{font-size:12px;color:var(--text3);margin-bottom:16px}
    .breadcrumb a{color:var(--text3)}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e2430;font-size:13px}
    th{color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;background:var(--bg2)}
    .store{display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600}
    .store-ah{background:rgba(0,100,200,0.12);color:var(--blue)}
    .store-jumbo{background:rgba(230,180,40,0.12);color:var(--yellow)}
    .store-dirk{background:rgba(60,190,100,0.12);color:var(--green)}
    .price{font-weight:600;font-variant-numeric:tabular-nums}
    .sale{color:var(--green);font-size:10px;font-weight:700;padding:2px 6px;background:rgba(68,199,106,0.12);border-radius:4px;margin-left:4px}
    .card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
    .cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:16px 0}
    .cat-link{display:block;padding:14px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;font-size:14px;transition:border-color 0.2s}
    .cat-link:hover{border-color:var(--blue);text-decoration:none}
    .cat-link .cnt{color:var(--text3);font-size:12px}
    .cta{display:inline-block;margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;font-weight:600;font-size:14px}
    .cta:hover{text-decoration:none;background:#1d4ed8}
    .footer{text-align:center;padding:32px 20px;color:var(--text3);font-size:12px;border-top:1px solid #1e2430;margin-top:48px}
    @media(max-width:640px){.container{padding:14px}h1{font-size:18px}th,td{padding:8px 6px;font-size:12px}}
  </style>
</head>
<body>
  <div class="header"><a href="/"><span>🛒</span> Prijsvergelijker</a></div>
  <div class="container">${body}</div>
  <div class="footer">Prijzen worden dagelijks automatisch verzameld van ah.nl, jumbo.com en dirk.nl<br>&copy; ${new Date().getFullYear()} Prijsvergelijker</div>
</body>
</html>`;
}

function badge(s) {
  return `<span class="store store-${s}">${SN[s]||s}</span>`;
}

function generateSEO() {
  const db = getDb();
  console.log('Generating SEO pages...\n');

  const categories = db.prepare(`
    SELECT DISTINCT canonical_category, COUNT(*) as cnt
    FROM category_map cm
    JOIN products p ON p.category = cm.original_category AND p.supermarket = cm.supermarket
    GROUP BY canonical_category
    ORDER BY cnt DESC
  `).all();

  // If no category_map data, fall back to stats
  const cats = categories.length > 0 ? categories :
    JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'data', 'categories.json'), 'utf8')).map(c => ({
      canonical_category: c.canonical_category, cnt: c.product_count
    }));

  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const stores = db.prepare('SELECT supermarket, COUNT(*) as c FROM products GROUP BY supermarket ORDER BY c DESC').all();

  // === 1. Category index page: /categorieen/index.html ===
  let catListHtml = `<h1>Alle supermarkt categorieen</h1>
    <p class="desc">Vergelijk prijzen per categorie bij Albert Heijn, Jumbo en Dirk. Blader door ${cats.length} categorieen met ${totalProducts.toLocaleString('nl-NL')} producten.</p>
    <div class="cat-grid">`;
  for (const c of cats) {
    const slug = slugify(c.canonical_category);
    catListHtml += `<a class="cat-link" href="/categorie/${slug}/">${esc(c.canonical_category)} <span class="cnt">${c.cnt || c.product_count} producten</span></a>`;
  }
  catListHtml += '</div>';

  writeFile('categorieen/index.html', htmlPage({
    title: 'Alle supermarkt categorieen — Prijsvergelijker',
    description: `Vergelijk prijzen in ${cats.length} categorieen bij Albert Heijn, Jumbo en Dirk. Vind de goedkoopste boodschappen.`,
    canonical: '/categorieen/',
    body: catListHtml,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Supermarkt Categorieen',
      description: `${cats.length} categorieen met ${totalProducts} producten`,
      url: `${SITE_URL}/categorieen/`,
    }
  }));
  console.log('  categorieen/index.html');

  // === 2. Individual category pages: /categorie/[slug]/index.html ===
  const catProductStmt = db.prepare(`
    SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.price_per_unit, p.normalized_name,
           pr.price, pr.original_price, pr.is_sale
    FROM products p
    JOIN category_map cm ON cm.original_category = p.category AND cm.supermarket = p.supermarket
    LEFT JOIN prices pr ON pr.id = (SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1)
    WHERE cm.canonical_category = ?
    ORDER BY pr.price ASC
  `);

  for (const c of cats) {
    const slug = slugify(c.canonical_category);
    const products = catProductStmt.all(c.canonical_category);
    const count = products.length;

    let body = `<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/categorieen/">Categorieen</a> &rsaquo; ${esc(c.canonical_category)}</div>`;
    body += `<h1>${esc(c.canonical_category)} — prijzen vergelijken</h1>`;
    body += `<p class="desc">Vergelijk ${count} producten in de categorie ${esc(c.canonical_category)} bij Albert Heijn, Jumbo en Dirk. Gesorteerd van goedkoop naar duur.</p>`;

    if (count > 0) {
      body += '<table><tr><th>Winkel</th><th>Product</th><th>Prijs</th><th>Per eenheid</th></tr>';
      for (const p of products.slice(0, 200)) {
        const ppuType = p.unit_type === 'g' ? '/kg' : p.unit_type === 'ml' ? '/l' : '/stuk';
        const ppu = p.price_per_unit ? `${fmtP(p.price_per_unit)}${ppuType}` : '';
        const sale = p.is_sale ? '<span class="sale">ACTIE</span>' : '';
        body += `<tr><td>${badge(p.supermarket)}</td><td><a href="/product/${p.id}/">${esc(p.name)}</a> ${sale}</td><td class="price">${fmtP(p.price)}</td><td style="color:var(--text3);font-size:12px">${ppu}</td></tr>`;
      }
      if (count > 200) body += `<tr><td colspan="4" style="color:var(--text3);text-align:center">... en ${count - 200} meer producten</td></tr>`;
      body += '</table>';
    }

    body += '<a class="cta" href="/">Zoek en vergelijk alle producten &rarr;</a>';

    writeFile(`categorie/${slug}/index.html`, htmlPage({
      title: `${c.canonical_category} prijzen vergelijken — AH, Jumbo, Dirk`,
      description: `Vergelijk ${count} ${c.canonical_category} producten bij Albert Heijn, Jumbo en Dirk. Vind de laagste prijs en bespaar op je boodschappen.`,
      canonical: `/categorie/${slug}/`,
      body,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${c.canonical_category} — Prijsvergelijker`,
        description: `${count} producten in ${c.canonical_category}`,
        url: `${SITE_URL}/categorie/${slug}/`,
      }
    }));
    console.log(`  categorie/${slug}/index.html (${count} products)`);
  }

  // === 3. Comparison pages for matched products (multi-store) ===
  // These are the most SEO-valuable: "komkommer prijs vergelijken AH Jumbo Dirk"
  const matchGroups = db.prepare(`
    SELECT m.id, m.canonical_name
    FROM product_matches m
    WHERE m.confirmed = 1
    ORDER BY m.canonical_name
  `).all();

  const matchMemberStmt = db.prepare(`
    SELECT p.id, p.name, p.supermarket, p.unit, p.unit_type, p.price_per_unit, p.category,
           pr.price, pr.original_price, pr.is_sale
    FROM product_match_members mm
    JOIN products p ON p.id = mm.product_id
    LEFT JOIN prices pr ON pr.id = (SELECT id FROM prices WHERE product_id = p.id ORDER BY scraped_at DESC LIMIT 1)
    WHERE mm.match_id = ?
    ORDER BY pr.price ASC
  `);

  let compareCount = 0;
  for (const m of matchGroups) {
    const members = matchMemberStmt.all(m.id);
    if (members.length < 2) continue;

    const slug = slugify(m.canonical_name);
    const cheapest = members[0];
    const cheapestStore = SN[cheapest.supermarket] || cheapest.supermarket;
    const category = members[0].category || '';

    let body = `<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/categorieen/">Categorieen</a> &rsaquo; ${esc(m.canonical_name)}</div>`;
    body += `<h1>${esc(m.canonical_name)} — prijs vergelijken</h1>`;
    body += `<p class="desc">Vergelijk de prijs van ${esc(m.canonical_name)} bij ${members.map(m => SN[m.supermarket]).join(', ')}. Goedkoopst bij ${cheapestStore} voor ${fmtP(cheapest.price)}.</p>`;

    body += '<div class="card"><table><tr><th>Winkel</th><th>Product</th><th>Prijs</th><th>Per eenheid</th><th></th></tr>';
    for (let i = 0; i < members.length; i++) {
      const p = members[i];
      const ppuType = p.unit_type === 'g' ? '/kg' : p.unit_type === 'ml' ? '/l' : '/stuk';
      const ppu = p.price_per_unit ? `${fmtP(p.price_per_unit)}${ppuType}` : '';
      const sale = p.is_sale ? ' <span class="sale">ACTIE</span>' : '';
      const diff = i === 0 ? '<span style="color:var(--green);font-weight:600">Goedkoopst</span>' :
        `<span style="color:var(--red)">+${Math.round((p.price - cheapest.price) / cheapest.price * 100)}%</span>`;
      body += `<tr><td>${badge(p.supermarket)}</td><td>${esc(p.name)}${sale}<br><span style="color:var(--text3);font-size:11px">${esc(p.unit || '')}</span></td><td class="price">${fmtP(p.price)}</td><td style="color:var(--text3);font-size:12px">${ppu}</td><td>${diff}</td></tr>`;
    }
    body += '</table></div>';

    body += '<a class="cta" href="/">Vergelijk meer producten &rarr;</a>';

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: m.canonical_name,
      category: category,
      offers: members.map(p => ({
        '@type': 'Offer',
        price: p.price,
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Organization', name: SN[p.supermarket] || p.supermarket },
      })),
    };

    writeFile(`vergelijk/${slug}/index.html`, htmlPage({
      title: `${m.canonical_name} prijs vergelijken — AH, Jumbo, Dirk`,
      description: `${m.canonical_name} is het goedkoopst bij ${cheapestStore} (${fmtP(cheapest.price)}). Vergelijk prijzen bij Albert Heijn, Jumbo en Dirk.`,
      canonical: `/vergelijk/${slug}/`,
      body,
      jsonLd,
    }));
    compareCount++;
  }
  console.log(`  ${compareCount} comparison pages generated`);

  // === 4. Content pages ===

  // /over/ (about page — needed for AdSense)
  writeFile('over/index.html', htmlPage({
    title: 'Over Prijsvergelijker — Supermarktprijzen vergelijken',
    description: 'Prijsvergelijker verzamelt dagelijks prijzen van Albert Heijn, Jumbo en Dirk. Lees meer over hoe het werkt.',
    canonical: '/over/',
    body: `<h1>Over Prijsvergelijker</h1>
      <div class="card" style="padding:20px;line-height:1.8">
        <p>Prijsvergelijker is een onafhankelijke website die dagelijks de prijzen van duizenden producten bij Nederlandse supermarkten verzamelt en vergelijkt.</p>
        <h2 style="margin-top:20px">Hoe werkt het?</h2>
        <p>Elke ochtend scannen we automatisch de webshops van Albert Heijn, Jumbo en Dirk. We slaan alle prijzen op in een database en berekenen prijsveranderingen, inflatie en aanbiedingen.</p>
        <h2>Welke supermarkten?</h2>
        <p>Op dit moment vergelijken we prijzen van:</p>
        <ul style="margin:8px 0 8px 24px">
          <li><strong>Albert Heijn</strong> — ${stores.find(s=>s.supermarket==='ah')?.c.toLocaleString('nl-NL')||'~20.000'} producten</li>
          <li><strong>Jumbo</strong> — ${stores.find(s=>s.supermarket==='jumbo')?.c.toLocaleString('nl-NL')||'~15.000'} producten</li>
          <li><strong>Dirk</strong> — ${stores.find(s=>s.supermarket==='dirk')?.c.toLocaleString('nl-NL')||'~2.000'} producten</li>
        </ul>
        <h2>Zijn de prijzen correct?</h2>
        <p>We doen ons best om de prijzen zo accuraat mogelijk weer te geven. Prijzen worden dagelijks bijgewerkt maar kunnen afwijken van de daadwerkelijke winkelprijzen. Controleer altijd de prijs bij de supermarkt zelf.</p>
        <h2>Contact</h2>
        <p>Vragen of suggesties? Neem contact op via GitHub.</p>
      </div>
      <a class="cta" href="/">Ga naar de prijsvergelijker &rarr;</a>`,
  }));
  console.log('  over/index.html');

  // /privacy/ (needed for AdSense)
  writeFile('privacy/index.html', htmlPage({
    title: 'Privacybeleid — Prijsvergelijker',
    description: 'Lees het privacybeleid van Prijsvergelijker. Informatie over cookies, gegevensverwerking en uw rechten.',
    canonical: '/privacy/',
    body: `<h1>Privacybeleid</h1>
      <div class="card" style="padding:20px;line-height:1.8">
        <p><em>Laatst bijgewerkt: ${new Date().toLocaleDateString('nl-NL', {year:'numeric',month:'long',day:'numeric'})}</em></p>
        <h2>Welke gegevens verzamelen we?</h2>
        <p>Prijsvergelijker verzamelt geen persoonsgegevens. We slaan geen accountgegevens, e-mailadressen of andere persoonlijke informatie op.</p>
        <h2>Cookies</h2>
        <p>We gebruiken geen tracking cookies. Als we in de toekomst advertenties tonen, kunnen advertentiepartners (zoals Google AdSense) cookies plaatsen. U wordt hierover geinformeerd via een cookiebanner.</p>
        <h2>Externe diensten</h2>
        <p>Deze website wordt gehost op Vercel. Vercel kan serverlogboeken bijhouden die IP-adressen bevatten. Zie het <a href="https://vercel.com/legal/privacy-policy" rel="noopener">Vercel privacybeleid</a> voor meer informatie.</p>
        <h2>Prijsdata</h2>
        <p>Alle prijsinformatie op deze website is afkomstig van publiek beschikbare webshops van Albert Heijn (ah.nl), Jumbo (jumbo.com) en Dirk (dirk.nl). We zijn niet verbonden aan deze supermarkten.</p>
        <h2>Uw rechten</h2>
        <p>Onder de AVG heeft u recht op inzage, correctie en verwijdering van uw persoonsgegevens. Aangezien wij geen persoonsgegevens verzamelen, zijn deze rechten in de praktijk niet van toepassing.</p>
        <h2>Contact</h2>
        <p>Voor vragen over dit privacybeleid kunt u contact opnemen via GitHub.</p>
      </div>`,
  }));
  console.log('  privacy/index.html');

  // === 5. sitemap.xml ===
  const today = new Date().toISOString().slice(0, 10);
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Main pages
  const mainPages = ['/', '/categorieen/', '/over/', '/privacy/'];
  for (const p of mainPages) {
    sitemap += `  <url><loc>${SITE_URL}${p}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  }

  // Category pages
  for (const c of cats) {
    sitemap += `  <url><loc>${SITE_URL}/categorie/${slugify(c.canonical_category)}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }

  // Comparison pages
  for (const m of matchGroups) {
    const slug = slugify(m.canonical_name);
    sitemap += `  <url><loc>${SITE_URL}/vergelijk/${slug}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
  }

  sitemap += '</urlset>';
  writeFile('sitemap.xml', sitemap);
  const totalUrls = mainPages.length + cats.length + matchGroups.length;
  const sitemapSize = (Buffer.byteLength(sitemap) / 1024).toFixed(0);
  console.log(`  sitemap.xml (${totalUrls} URLs, ${sitemapSize} KB)`);

  // === 6. robots.txt ===
  writeFile('robots.txt', `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`);
  console.log('  robots.txt');

  console.log('\nSEO generation complete!');
}

module.exports = { generateSEO };
