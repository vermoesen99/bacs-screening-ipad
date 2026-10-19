// Automatische tests voor de reken- en beslisregels.  Uitvoeren: npm test  (of: node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const CFG = require('../src/config.js');
const S = require('../src/sample-data.js');

const VANDAAG = '2026-10-19';

function basisDossier(extra) {
  return Object.assign({
    modus: 'diep', klant: { naam: 'Test' }, bezoek: { datum: VANDAAG },
    gebouwen: [{ id: 'g1', naam: 'Gebouw', nietResidentieel: 'ja', eigenaarInstallaties: 'Eigenaar' }],
    groepen: [], verwarming: [], koeling: [], screening: { methode: 'm1', items: {} }
  }, extra || {});
}
function verw(id, kw, groepId, gekoppeld, gebouwId) {
  return { id, naam: id, vermogenKW: kw, groepId: groepId || '', gekoppeld: gekoppeld || 'ja', gebouwId: gebouwId || 'g1' };
}
const issueCodes = (d) => E.validate(d, CFG, VANDAAG).map((i) => i.code);

// ---------------------------------------------------------------- werkvoorbeeld

test('werkvoorbeeld uit de opdracht: school 2×180 kW gekoppeld + 90 kW koeling', () => {
  const d = S.school();
  const b = E.beslis(d, CFG, VANDAAG);
  const g = b.perGebouw[0];
  assert.equal(g.verwarming.maxKW, 360, 'verwarmingsgroep = 360 kW');
  assert.equal(g.koeling.maxKW, 90, 'koelgroep = 90 kW');
  assert.equal(g.verwarming.antwoord, 'ja', 'verwarming overschrijdt 290 kW');
  assert.equal(g.koeling.antwoord, 'nee', 'koeling overschrijdt 290 kW niet');
  assert.equal(g.uitkomst, E.UITKOMST.PLICHTIG);
  assert.deepEqual(g.basis, ['verwarming'], 'potentieel plichtig op basis van verwarming');
  assert.equal(g.startScreening, true, 'technische screening start');
  assert.equal(g.toekomst.antwoord, 'ja', 'toekomstige 70 kW-drempel afzonderlijk getoond');
  assert.deepEqual(g.toekomst.basis, ['verwarming', 'koeling']);
  assert.equal(g.conformiteitsverklaring, false, 'geen definitieve conformiteitsverklaring');
  assert.equal(g.termijnVerstreken, true, 'termijn 31/12/2025 is verstreken op 19/10/2026');
  assert.equal(b.verwarming.siteTotaalKW, 360);
});

test('rapporten bevatten disclaimer en geen conformiteitsverklaring', () => {
  const d = S.school();
  for (const html of [E.renderKlantenfiche(d, CFG, VANDAAG), E.renderTechnischRapport(d, CFG, VANDAAG)]) {
    assert.match(html, /vervangt geen formele keuring/);
    assert.match(html, /geen definitieve juridische conformiteitsverklaring/);
    assert.match(html, /Potentieel BACS-plichtig/);
    assert.ok(!/is conform|voldoet aan de BACS-verplichting/i.test(html));
    assert.match(html, /vlaanderen\.be\/gebouwautomatisering/);
  }
});

// ---------------------------------------------------------------- vermogensberekening

test('gekoppelde opwekkers worden per groep opgeteld', () => {
  const d = basisDossier({
    groepen: [{ id: 'a', soort: 'verwarming', naam: 'A' }, { id: 'b', soort: 'verwarming', naam: 'B' }],
    verwarming: [verw('v1', '100', 'a'), verw('v2', '150', 'a'), verw('v3', '200', 'b')]
  });
  const r = E.computeGroups(d, 'verwarming');
  const tot = Object.fromEntries(r.groepen.map((g) => [g.id, g.totaalKW]));
  assert.equal(tot.a, 250);
  assert.equal(tot.b, 200);
  assert.equal(r.siteTotaalKW, 450, 'sitetotaal is informatief');
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.verwarming.maxKW, 250, 'wettelijke toets gebruikt alleen de gekoppelde groep');
  assert.equal(b.uitkomst, E.UITKOMST.NIET, '450 kW site, maar geen gekoppelde groep > 290 kW');
});

test('niet-gekoppelde installaties worden niet samengeteld', () => {
  const d = basisDossier({ verwarming: [verw('v1', '200', '', 'nee'), verw('v2', '200', '', 'nee')] });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.verwarming.maxKW, 200);
  assert.equal(b.uitkomst, E.UITKOMST.NIET);
});

test('verwarming en koeling worden nooit samengeteld', () => {
  const d = basisDossier({
    groepen: [{ id: 'h', soort: 'verwarming', naam: 'H' }, { id: 'k', soort: 'koeling', naam: 'K' }],
    verwarming: [verw('v1', '200', 'h')],
    koeling: [verw('k1', '200', 'k')]
  });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.verwarming.maxKW, 200);
  assert.equal(b.koeling.maxKW, 200);
  assert.equal(b.uitkomst, E.UITKOMST.NIET, '200 + 200 mag niet als 400 kW getoetst worden');
});

test('koeling alleen kan de verplichting activeren', () => {
  const d = basisDossier({ groepen: [{ id: 'k', soort: 'koeling', naam: 'K' }], koeling: [verw('k1', '160', 'k'), verw('k2', '160', 'k')] });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG);
  assert.deepEqual(b.basis, ['koeling']);
});

test('decimale komma en spaties worden correct gelezen', () => {
  assert.equal(E.parseKW('7,1'), 7.1);
  assert.equal(E.parseKW(' 1 200 '), 1200);
  assert.equal(E.parseKW(''), null);
  assert.ok(Number.isNaN(E.parseKW('abc')));
  assert.ok(Number.isNaN(E.parseKW('12kW')));
  const d = basisDossier({ groepen: [{ id: 'a', soort: 'verwarming' }], verwarming: [verw('v1', '145,5', 'a'), verw('v2', '145,5', 'a')] });
  assert.equal(E.computeGroups(d, 'verwarming').groepen[0].totaalKW, 291);
});

// ---------------------------------------------------------------- drempels

test('drempel is strikt "meer dan": 290 kW valt er niet onder, 290,1 kW wel', () => {
  const mk = (kw) => basisDossier({ verwarming: [verw('v1', kw, '', 'nee')] });
  assert.equal(E.beslis(mk('290'), CFG, VANDAAG).uitkomst, E.UITKOMST.NIET);
  assert.equal(E.beslis(mk('290,1'), CFG, VANDAAG).uitkomst, E.UITKOMST.PLICHTIG);
  const t70 = E.beslis(mk('70'), CFG, VANDAAG).perGebouw[0];
  assert.equal(t70.toekomst.antwoord, 'nee', '70 kW valt niet onder "meer dan 70 kW"');
  const t71 = E.beslis(mk('71'), CFG, VANDAAG).perGebouw[0];
  assert.equal(t71.toekomst.antwoord, 'ja');
  assert.equal(t71.uitkomst, E.UITKOMST.NIET);
  assert.equal(t71.startScreening, true, 'screening aanbevolen ter voorbereiding');
});

test('drempels zijn configureerbaar', () => {
  const cfg = E.mergeConfig(CFG, { drempels: { huidig: { kW: 70, deadline: '2029-12-31' } } });
  assert.equal(cfg.drempels.toekomstig.kW, 70, 'samenvoegen behoudt de andere waarden');
  const d = basisDossier({ verwarming: [verw('v1', '100', '', 'nee')] });
  assert.equal(E.beslis(d, CFG, VANDAAG).uitkomst, E.UITKOMST.NIET);
  const b = E.beslis(d, cfg, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG);
  assert.equal(b.termijnVerstreken, false);
});

// ---------------------------------------------------------------- beslissingsboom

test('beslissingsboom: residentieel gebouw valt buiten toepassing', () => {
  const d = basisDossier({ verwarming: [verw('v1', '500', '', 'nee')] });
  d.gebouwen[0].nietResidentieel = 'nee';
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.BUITEN);
  assert.equal(b.startScreening, false);
});

test('beslissingsboom: onbekende bestemming geeft "onvolledig", ook boven drempel', () => {
  const d = basisDossier({ verwarming: [verw('v1', '500', '', 'nee')] });
  d.gebouwen[0].nietResidentieel = '';
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.ONVOLLEDIG);
  assert.match(b.uitleg, /Indien niet-residentieel: potentieel plichtig/);
  assert.ok(issueCodes(d).includes('BESTEMMING_ONBEKEND'));
});

test('beslissingsboom: volledige stappenreeks in vaste volgorde', () => {
  const b = E.beslis(S.school(), CFG, VANDAAG).perGebouw[0];
  assert.deepEqual(b.stappen.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  assert.deepEqual(b.stappen.map((s) => s.antwoord), ['ja', 'ja', 'ja', 'nee', 'ja', 'nee', 'ja']);
});

test('beslissingsboom: geen installaties = niet plichtig, met waarschuwing als er wel verwarming is', () => {
  const d = basisDossier();
  d.gebouwen[0].heeftRuimteverwarming = 'ja';
  assert.equal(E.beslis(d, CFG, VANDAAG).uitkomst, E.UITKOMST.NIET);
  assert.ok(issueCodes(d).includes('VERWARMING_NIET_GEINVENTARISEERD'));
});

test('beslissingsboom: meerdere gebouwen worden apart beoordeeld', () => {
  const d = S.gemeentehuis();
  const b = E.beslis(d, CFG, VANDAAG);
  const [stadhuis, annex] = b.perGebouw;
  assert.equal(stadhuis.verwarming.maxKW, 310);
  assert.equal(stadhuis.uitkomst, E.UITKOMST.PLICHTIG);
  assert.equal(annex.uitkomst, E.UITKOMST.ONVOLLEDIG, 'annex: vermogen ontbreekt');
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG, 'dossier toont de zwaarste uitkomst');
  assert.equal(stadhuis.koeling.maxKW, 112, 'split serverlokaal is niet gekoppeld aan de VRF-groep');
});

test('woonzorgcentrum: onder huidige drempel, boven toekomstige', () => {
  const g = E.beslis(S.woonzorg(), CFG, VANDAAG).perGebouw[0];
  assert.equal(g.uitkomst, E.UITKOMST.NIET);
  assert.equal(g.toekomst.plichtig, true);
  const gp = E.gaps(S.woonzorg(), CFG, VANDAAG).map((x) => x.itemId);
  assert.ok(gp.includes('T70'), 'gapanalyse vermeldt de toekomstige drempel');
});

// ---------------------------------------------------------------- uitzonderingen

test('uitzondering wordt nooit automatisch toegekend', () => {
  const d = basisDossier({ verwarming: [verw('v1', '400', '', 'nee')] });
  Object.assign(d.gebouwen[0], { heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'nee', heeftVentilatie: 'nee' });
  let b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitzondering.status, 'kandidaat');
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG, 'kandidaat verandert de uitkomst niet');

  d.gebouwen[0].uitzondering = { ingeroepen: true, typeId: 'een-installatie', motivatie: 'kort', bewijs: '' };
  b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitzondering.status, 'ingeroepen-onvolledig');
  const codes = issueCodes(d);
  assert.ok(codes.includes('UITZONDERING_ZONDER_MOTIVERING'));
  assert.ok(codes.includes('UITZONDERING_ZONDER_BEWIJS'));

  d.gebouwen[0].uitzondering = { ingeroepen: true, typeId: 'een-installatie', motivatie: 'Het gebouw heeft enkel radiatorverwarming, geen koeling of mechanische ventilatie.', bewijs: 'Technische plannen 2019' };
  b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitzondering.status, 'ingeroepen-gestaafd');
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG, 'ook gestaafd blijft de beoordeling bij de bevoegde instantie');
  assert.match(b.uitzonderingLabel, /te beoordelen/);
});

test('uitzondering "één installatie" die niet strookt met de installaties wordt gesignaleerd', () => {
  const d = basisDossier();
  Object.assign(d.gebouwen[0], { heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'ja', heeftVentilatie: 'nee',
    uitzondering: { ingeroepen: true, typeId: 'een-installatie', motivatie: 'Volgens de klant enkel verwarming aanwezig.', bewijs: 'mondeling' } });
  assert.ok(issueCodes(d).includes('UITZONDERING_NIET_CONSISTENT'));
});

// ---------------------------------------------------------------- ontbrekende en tegenstrijdige gegevens

test('ontbrekend vermogen: geen stille "niet plichtig"', () => {
  const d = basisDossier({ groepen: [{ id: 'a', soort: 'verwarming' }], verwarming: [verw('v1', '200', 'a'), verw('v2', '', 'a')] });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.ONVOLLEDIG);
  assert.equal(b.voorlopig, true);
  assert.ok(issueCodes(d).includes('VERMOGEN_ONTBREEKT'));
  assert.ok(E.gaps(d, CFG, VANDAAG).some((g) => g.itemId === 'DATA'));
});

test('ontbrekend vermogen maar al boven drempel: plichtig, gemarkeerd als voorlopig', () => {
  const d = basisDossier({ groepen: [{ id: 'a', soort: 'verwarming' }], verwarming: [verw('v1', '300', 'a'), verw('v2', '', 'a')] });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.PLICHTIG);
  assert.equal(b.voorlopig, true);
});

test('ongeldig en verdacht vermogen worden gemeld', () => {
  const d = basisDossier({ verwarming: [verw('v1', 'abc', '', 'nee'), verw('v2', '-5', '', 'nee'), verw('v3', '0', '', 'nee'), verw('v4', '180000', '', 'nee')] });
  const codes = issueCodes(d);
  assert.equal(codes.filter((c) => c === 'VERMOGEN_ONGELDIG').length, 2);
  assert.ok(codes.includes('VERMOGEN_NUL'));
  assert.ok(codes.includes('VERMOGEN_HOOG'));
});

test('onbekende koppeling: slechtste geval bepaalt of uitsluiten mogelijk is', () => {
  // 2 × 100 kW, koppeling onbekend → max 200, slechtste geval 200 ≤ 290 → niet plichtig
  let d = basisDossier({ verwarming: [verw('v1', '100', '', 'onbekend'), verw('v2', '100', '', 'onbekend')] });
  assert.equal(E.beslis(d, CFG, VANDAAG).uitkomst, E.UITKOMST.NIET);
  assert.ok(issueCodes(d).includes('KOPPELING_ONBEKEND'));
  // 2 × 200 kW, koppeling onbekend → slechtste geval 400 > 290 → onvolledig
  d = basisDossier({ verwarming: [verw('v1', '200', '', 'onbekend'), verw('v2', '200', '', 'onbekend')] });
  const b = E.beslis(d, CFG, VANDAAG).perGebouw[0];
  assert.equal(b.uitkomst, E.UITKOMST.ONVOLLEDIG);
  assert.equal(b.verwarming.slechtsteGevalKW, 400);
});

test('tegenstrijdig: "niet gekoppeld" in een groep met andere installaties', () => {
  const d = basisDossier({ groepen: [{ id: 'a', soort: 'verwarming', naam: 'A' }], verwarming: [verw('v1', '100', 'a', 'ja'), verw('v2', '100', 'a', 'nee')] });
  assert.ok(issueCodes(d).includes('TEGENSTRIJDIGE_KOPPELING'));
});

test('tegenstrijdig: verwarmingsinstallatie in een koelgroep wordt afzonderlijk geteld', () => {
  const d = basisDossier({ groepen: [{ id: 'k', soort: 'koeling', naam: 'K' }], verwarming: [verw('v1', '200', 'k'), verw('v2', '200', 'k')] });
  const r = E.computeGroups(d, 'verwarming');
  assert.ok(r.groepen.every((g) => g.virtueel && g.totaalKW === 200));
  assert.ok(issueCodes(d).includes('GROEP_VERKEERDE_SOORT'));
});

test('verwijzing naar verwijderde groep of gebouw wordt gemeld', () => {
  const d = basisDossier({ verwarming: [verw('v1', '100', 'weg', 'ja', 'g9')] });
  const codes = issueCodes(d);
  assert.ok(codes.includes('GROEP_ONBEKEND'));
  assert.ok(codes.includes('GEBOUW_ONBEKEND'));
});

test('gekoppeld zonder groep geeft waarschuwing', () => {
  const d = basisDossier({ verwarming: [verw('v1', '100', '', 'ja')] });
  assert.ok(issueCodes(d).includes('GEKOPPELD_ZONDER_GROEP'));
});

test('tegenstrijdige gebouwgegevens worden gemeld', () => {
  const d = basisDossier({ verwarming: [verw('v1', '100', '', 'nee')] });
  Object.assign(d.gebouwen[0], { heeftRuimteverwarming: 'nee', oppervlakte: '1000', geklimatiseerdeOppervlakte: '1200', bouwjaar: '3020', eigenaarInstallaties: '' });
  const codes = issueCodes(d);
  assert.ok(codes.includes('VERWARMING_TEGENSTRIJDIG'));
  assert.ok(codes.includes('OPPERVLAKTE_TEGENSTRIJDIG'));
  assert.ok(codes.includes('BOUWJAAR_ONGELDIG'));
  assert.ok(codes.includes('EIGENAAR_INSTALLATIES_ONBEKEND'));
});

test('geen gebouw: dossier onvolledig', () => {
  const d = basisDossier({ gebouwen: [] });
  assert.equal(E.beslis(d, CFG, VANDAAG).uitkomst, E.UITKOMST.ONVOLLEDIG);
  assert.ok(issueCodes(d).includes('GEEN_GEBOUW'));
});

test('screening: G4 "voldoet" met te weinig sensoren is tegenstrijdig', () => {
  const d = S.school();
  d.screening.items.G4 = { status: 'ja', bewijs: 'sensorlijst' };
  const s = E.evaluateScreening(d, CFG, VANDAAG);
  assert.equal(s.vereisteSensoren, 29);
  assert.ok(s.issues.some((i) => i.code === 'SENSOREN_TEGENSTRIJDIG'));
});

test('screening: n.v.t. zonder motivering en voldoet zonder bewijs worden gemeld', () => {
  const d = basisDossier({ screening: { methode: 'm1', items: { A2: { status: 'nvt' }, A1: { status: 'ja' } } } });
  const codes = issueCodes(d);
  assert.ok(codes.includes('NVT_ZONDER_MOTIVERING'));
  assert.ok(codes.includes('BEWIJS_ONTBREEKT'));
});

test('snelle checklist: geen BACS maar wel alarmen is tegenstrijdig', () => {
  const d = basisDossier({ modus: 'snel', snelleChecklist: { Q1: 'nee', Q7: 'ja' } });
  assert.ok(issueCodes(d).includes('CHECKLIST_TEGENSTRIJDIG'));
});

// ---------------------------------------------------------------- screening en gaps

test('eisstatus wordt correct samengevat', () => {
  assert.equal(E.eisStatus(['ja', 'ja']), 'voldoet');
  assert.equal(E.eisStatus(['ja', 'nvt']), 'voldoet');
  assert.equal(E.eisStatus(['nee', 'nee']), 'voldoet-niet');
  assert.equal(E.eisStatus(['ja', 'nee']), 'gedeeltelijk');
  assert.equal(E.eisStatus(['deels']), 'gedeeltelijk');
  assert.equal(E.eisStatus(['ja', 'onbekend']), 'te-verifieren');
  assert.equal(E.eisStatus(['nvt', 'nvt']), 'nvt');
  assert.equal(E.eisStatus(['open', 'open']), 'open');
});

test('methode 2 toetst klasse B + A, B en G', () => {
  const d = S.school();
  d.screening.methode = 'm2';
  const s = E.evaluateScreening(d, CFG, VANDAAG);
  assert.deepEqual(s.eisen.map((e) => e.id), ['KB', 'A', 'B', 'G']);
});

test('verlichting (F) is vóór 2028 een toekomstige eis met lage prioriteit', () => {
  const d = S.school();
  const f = E.evaluateScreening(d, CFG, VANDAAG).eisen.find((e) => e.id === 'F');
  assert.equal(f.toekomstig, true);
  const gF = E.gaps(d, CFG, VANDAAG).find((g) => g.itemId === 'F1');
  assert.equal(gF.prioriteit, 'toekomst');
  const f2028 = E.evaluateScreening(d, CFG, '2028-02-01').eisen.find((e) => e.id === 'F');
  assert.equal(f2028.toekomstig, false);
});

test('gapanalyse en actieplan voor het werkvoorbeeld', () => {
  const d = S.school();
  const g = E.gaps(d, CFG, VANDAAG);
  const ids = g.map((x) => x.itemId);
  assert.ok(ids.includes('A10') && ids.includes('C4') && ids.includes('G5'));
  assert.ok(!ids.includes('A1'), 'voldaan item is geen gap');
  assert.ok(!ids.includes('A2'), 'n.v.t. is geen gap');
  assert.equal(g.find((x) => x.itemId === 'A9').fase, 'verificatie', 'onbekend → eerst verifiëren');
  const plan = E.actieplan(d, CFG, VANDAAG, g);
  const order = CFG.fases.map((f) => f.id);
  const idx = plan.map((f) => order.indexOf(f.id));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'fases in vaste volgorde');
});

test('alle voorbeelddossiers produceren een analyse zonder uitzonderingen', () => {
  for (const d of S.alle()) {
    const a = E.analyse(d, CFG, VANDAAG);
    assert.ok(a.beslissing && a.screening && Array.isArray(a.gaps));
    assert.ok(E.renderTechnischRapport(d, CFG, VANDAAG).length > 1000);
  }
});
