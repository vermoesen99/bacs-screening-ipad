// Genereert voorbeeldrapporten en voorbeelddossiers in examples/.
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const CFG = require('../src/config.js');
const S = require('../src/sample-data.js');
const out = path.join(__dirname, '..', 'examples');
const VANDAAG = process.argv[2] || '2026-10-19';
fs.mkdirSync(out, { recursive: true });
const school = S.school();
fs.writeFileSync(path.join(out, 'klantenfiche-voorbeeld.html'), E.renderKlantenfiche(school, CFG, VANDAAG));
fs.writeFileSync(path.join(out, 'technisch-rapport-voorbeeld.html'), E.renderTechnischRapport(school, CFG, VANDAAG));
for (const d of S.alle()) fs.writeFileSync(path.join(out, `dossier-${d.id}.json`), JSON.stringify(d, null, 2));
console.log('Voorbeelden geschreven naar examples/ (rapportdatum ' + VANDAAG + ')');
