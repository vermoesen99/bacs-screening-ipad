// Bouwt:
//  - index.html + sw.js        de installeerbare web-app (voor GitHub Pages of een andere webserver)
//  - dist/bacs-screening.html  één zelfstandig bestand (offline openen op een computer)
//  - dist/artifact.html        zelfde inhoud zonder documentskelet (voor een Claude-artifact)
// Uitvoeren na elke wijziging in src/: node scripts/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const TITLE = 'BACS-screening Vlaanderen';
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">';
const PWA_HEAD = `<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#16232a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BACS-screening">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">`;
const BODY = `<header class="topbar"><div class="wrap">
<div class="brand"><b>BACS-screening</b><span class="badge-kw">&gt; 290 kW</span><span>Vlaanderen · niet-residentieel</span></div>
<nav class="nav" aria-label="Hoofdmenu"><button data-act="nav" data-view="lijst">Dossiers</button><button data-act="nav" data-view="beheer">Beheer</button><button data-act="nav" data-view="bronnen">Regels en bronnen</button></nav>
</div></header>
<main id="main"></main>
<div id="updatebar" class="updatebar" role="status" hidden><span>Nieuwe versie beschikbaar.</span><button class="btn sm">Herladen</button></div>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
const SCRIPTS = ['src/config.js', 'src/engine.js', 'src/sample-data.js', 'src/app.js'];
const APP_FILES = ['index.html', 'manifest.webmanifest', 'src/styles.css', ...SCRIPTS,
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

// 1. web-app
const indexHtml = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
${PWA_HEAD}
${FONTS}
<link rel="stylesheet" href="src/styles.css">
</head>
<body>
${BODY}
${SCRIPTS.map((s) => `<script src="${s}"></script>`).join('\n')}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), indexHtml);

// 2. service worker: de cacheversie is een hash van alle app-bestanden, zodat elke wijziging
//    automatisch als nieuwe versie wordt opgepikt (melding "Nieuwe versie beschikbaar").
const hash = crypto.createHash('sha256');
APP_FILES.forEach((f) => hash.update(fs.readFileSync(path.join(root, f))));
const versie = hash.digest('hex').slice(0, 10);
const sw = rd('scripts/sw.template.js')
  .replace('__VERSIE__', versie)
  .replace('__BESTANDEN__', JSON.stringify(['./', ...APP_FILES], null, 2));
fs.writeFileSync(path.join(root, 'sw.js'), sw);

// 3. zelfstandige versie en artifactversie
const css = rd('src/styles.css');
const js = SCRIPTS.map((s) => `/* ---- ${s} ---- */\n` + rd(s).replace(/<\/script/gi, '<\\/script')).join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/bacs-screening.html'), `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
${FONTS}
<style>${css}</style>
</head>
<body>
${BODY}
<script>${js}</script>
</body>
</html>
`);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${FONTS}
<style>${css}</style>
${BODY}
<script>${js}</script>
`);
console.log(`Gebouwd: index.html, sw.js (versie ${versie}), dist/bacs-screening.html, dist/artifact.html`);
