/*
 * BACS-screening — reken- en beslismotor.
 *
 * Pure functies zonder DOM-afhankelijkheden: werkt in de browser (window.BACSEngine)
 * en in Node (require), zodat dezelfde logica getest kan worden.
 *
 * Kernregels
 *  - Verwarming en koeling worden afzonderlijk beoordeeld, nooit samengeteld.
 *  - Alleen hydraulisch (verwarming) of koeltechnisch (koeling) gekoppelde opwekkers worden opgeteld,
 *    per installatiegroep. De wettelijke toets gebruikt de grootste groep per gebouw.
 *  - "Meer dan" de drempel: strikt groter dan (290 kW exact valt er niet onder).
 *  - Ontbrekende of onzekere gegevens leiden nooit tot een stille "niet plichtig": als een
 *    overschrijding niet uitgesloten kan worden, is de uitkomst "onvolledig".
 *  - Een uitzondering wordt nooit automatisch toegekend.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BACSEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UITKOMST = {
    PLICHTIG: 'POTENTIEEL_PLICHTIG',
    NIET: 'NIET_PLICHTIG_HUIDIG',
    ONVOLLEDIG: 'ONVOLLEDIG',
    BUITEN: 'BUITEN_TOEPASSING'
  };
  var UITKOMST_LABEL = {
    POTENTIEEL_PLICHTIG: 'Potentieel BACS-plichtig',
    NIET_PLICHTIG_HUIDIG: 'Niet BACS-plichtig onder de huidige drempel',
    ONVOLLEDIG: 'Onvoldoende gegevens voor een beslissing',
    BUITEN_TOEPASSING: 'Buiten toepassingsgebied (residentieel gebouw)'
  };
  // Ernst voor het samenvatten van meerdere gebouwen: hoogste wint.
  var UITKOMST_ERNST = { BUITEN_TOEPASSING: 0, NIET_PLICHTIG_HUIDIG: 1, ONVOLLEDIG: 2, POTENTIEEL_PLICHTIG: 3 };

  var ITEM_STATUS_LABEL = {
    ja: 'Voldoet', deels: 'Gedeeltelijk', nee: 'Voldoet niet', onbekend: 'Onbekend', nvt: 'Niet van toepassing', open: 'Niet beoordeeld'
  };
  var EIS_STATUS_LABEL = {
    voldoet: 'Lijkt te voldoen', gedeeltelijk: 'Gedeeltelijk', 'voldoet-niet': 'Voldoet niet',
    'te-verifieren': 'Te verifiëren', nvt: 'Niet van toepassing', open: 'Niet beoordeeld'
  };

  // ---------- hulpfuncties ----------

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /** Diepe samenvoeging: objecten worden gemengd, arrays en waarden overschreven. */
  function mergeConfig(base, override) {
    if (!isObj(override)) return clone(base);
    var out = clone(base);
    Object.keys(override).forEach(function (k) {
      if (isObj(out[k]) && isObj(override[k])) out[k] = mergeConfig(out[k], override[k]);
      else out[k] = clone(override[k]);
    });
    return out;
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /** Leest een vermogen in. null = niet ingevuld, NaN = ongeldig. Aanvaardt een komma als decimaalteken. */
  function parseKW(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function txt(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function fmtKW(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 }).format(n) + ' kW';
  }
  function fmtDatum(iso) {
    if (!iso) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
  }
  function isoVandaag(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function issue(niveau, code, tekst, ref) { return { niveau: niveau, code: code, tekst: tekst, ref: ref || null }; }

  // ---------- vermogensberekening ----------

  /**
   * Groepeert de opwekkers van één soort ('verwarming' | 'koeling') per gekoppelde installatiegroep
   * en berekent per groep het totale nominale vermogen.
   */
  function computeGroups(dossier, soort) {
    var units = (dossier && dossier[soort]) || [];
    var groepDefs = ((dossier && dossier.groepen) || []).filter(function (g) { return g.soort === soort; });
    var allGroepDefsById = {};
    ((dossier && dossier.groepen) || []).forEach(function (g) { allGroepDefsById[g.id] = g; });
    var gebouwIds = {};
    ((dossier && dossier.gebouwen) || []).forEach(function (g) { gebouwIds[g.id] = g; });
    var koppelWoord = soort === 'verwarming' ? 'hydraulisch' : 'koeltechnisch';
    var unitWoord = soort === 'verwarming' ? 'Warmteopwekker' : 'Koelinstallatie';

    var issues = [];
    var groepen = groepDefs.map(function (g) {
      return {
        id: g.id, naam: txt(g.naam) || '(naamloze groep)', virtueel: false,
        gebouwIds: (g.gebouwIds || []).filter(function (id) { return gebouwIds[id]; }),
        units: [], totaalKW: 0, ontbrekend: 0, ongeldig: 0, onzekereKoppeling: 0
      };
    });
    var byId = {};
    groepen.forEach(function (g) { byId[g.id] = g; });

    var siteTotaal = 0;
    units.forEach(function (u) {
      var naam = txt(u.naam) || '(naamloos)';
      var kw = parseKW(u.vermogenKW);
      var g = u.groepId ? byId[u.groepId] : null;

      if (u.groepId && !g) {
        var other = allGroepDefsById[u.groepId];
        issues.push(issue('fout', other ? 'GROEP_VERKEERDE_SOORT' : 'GROEP_ONBEKEND',
          other
            ? unitWoord + ' “' + naam + '” zit in groep “' + txt(other.naam) + '”, maar dat is een ' + other.soort + 'sgroep. Ze wordt afzonderlijk geteld.'
            : unitWoord + ' “' + naam + '” verwijst naar een groep die niet meer bestaat. Ze wordt afzonderlijk geteld.',
          { soort: soort, unitId: u.id }));
      }
      if (!g) {
        if (u.gekoppeld === 'ja') {
          issues.push(issue('waarschuwing', 'GEKOPPELD_ZONDER_GROEP',
            unitWoord + ' “' + naam + '” is ' + koppelWoord + ' gekoppeld, maar niet aan een installatiegroep toegewezen. Wijs ze toe aan de groep waarmee ze gekoppeld is.',
            { soort: soort, unitId: u.id }));
        }
        g = {
          id: 'los-' + u.id, naam: naam + ' (afzonderlijk)', virtueel: true,
          gebouwIds: u.gebouwId && gebouwIds[u.gebouwId] ? [u.gebouwId] : [],
          units: [], totaalKW: 0, ontbrekend: 0, ongeldig: 0, onzekereKoppeling: 0
        };
        groepen.push(g);
      }
      g.units.push(u);

      if (kw === null) {
        g.ontbrekend++;
        issues.push(issue('fout', 'VERMOGEN_ONTBREEKT', unitWoord + ' “' + naam + '”: nominaal vermogen ontbreekt.', { soort: soort, unitId: u.id }));
      } else if (isNaN(kw) || kw < 0) {
        g.ongeldig++;
        issues.push(issue('fout', 'VERMOGEN_ONGELDIG', unitWoord + ' “' + naam + '”: “' + txt(u.vermogenKW) + '” is geen geldig vermogen in kW.', { soort: soort, unitId: u.id }));
      } else {
        if (kw === 0) issues.push(issue('waarschuwing', 'VERMOGEN_NUL', unitWoord + ' “' + naam + '”: vermogen is 0 kW. Controleer het typeplaatje.', { soort: soort, unitId: u.id }));
        if (kw > 10000) issues.push(issue('waarschuwing', 'VERMOGEN_HOOG', unitWoord + ' “' + naam + '”: ' + fmtKW(kw) + ' is ongewoon hoog. Controleer of het niet in W werd ingevuld.', { soort: soort, unitId: u.id }));
        g.totaalKW += kw;
        siteTotaal += kw;
      }
      if (u.gekoppeld !== 'ja' && u.gekoppeld !== 'nee') {
        g.onzekereKoppeling++;
        issues.push(issue('waarschuwing', 'KOPPELING_ONBEKEND',
          unitWoord + ' “' + naam + '”: niet bekend of ze ' + koppelWoord + ' gekoppeld is aan andere installaties.',
          { soort: soort, unitId: u.id }));
      }
      if (u.gebouwId && !gebouwIds[u.gebouwId]) {
        issues.push(issue('waarschuwing', 'GEBOUW_ONBEKEND', unitWoord + ' “' + naam + '” verwijst naar een gebouw dat niet meer bestaat.', { soort: soort, unitId: u.id }));
      }
    });

    groepen.forEach(function (g) {
      g.totaalKW = round2(g.totaalKW);
      if (!g.virtueel) {
        // Gebouwen afleiden uit de opwekkers als de groep er zelf geen heeft.
        if (g.gebouwIds.length === 0) {
          g.units.forEach(function (u) { if (u.gebouwId && gebouwIds[u.gebouwId] && g.gebouwIds.indexOf(u.gebouwId) < 0) g.gebouwIds.push(u.gebouwId); });
        } else {
          g.units.forEach(function (u) {
            if (u.gebouwId && gebouwIds[u.gebouwId] && g.gebouwIds.indexOf(u.gebouwId) < 0) {
              issues.push(issue('waarschuwing', 'GEBOUW_BUITEN_GROEP',
                unitWoord + ' “' + (txt(u.naam) || '(naamloos)') + '” staat in een ander gebouw dan de groep “' + g.naam + '” bedient. Controleer de installatiegrenzen.',
                { soort: soort, unitId: u.id, groepId: g.id }));
            }
          });
        }
        if (g.units.length === 0) {
          issues.push(issue('info', 'LEGE_GROEP', 'Installatiegroep “' + g.naam + '” bevat nog geen installaties.', { soort: soort, groepId: g.id }));
        }
        if (g.units.length > 1) {
          g.units.forEach(function (u) {
            if (u.gekoppeld === 'nee') {
              issues.push(issue('fout', 'TEGENSTRIJDIGE_KOPPELING',
                unitWoord + ' “' + (txt(u.naam) || '(naamloos)') + '” staat als “niet gekoppeld” aangeduid, maar zit samen met andere installaties in groep “' + g.naam + '”. Pas de koppeling of de groep aan.',
                { soort: soort, unitId: u.id, groepId: g.id }));
            }
          });
        }
      }
    });

    return { soort: soort, groepen: groepen, issues: issues, siteTotaalKW: round2(siteTotaal) };
  }

  // ---------- beslissingsboom ----------

  function groepenVoorGebouw(res, gebouw, aantalGebouwen) {
    return res.groepen.filter(function (g) {
      return g.gebouwIds.indexOf(gebouw.id) >= 0 || (g.gebouwIds.length === 0 && aantalGebouwen === 1);
    });
  }

  function toetsSoort(groepen, drempel) {
    var max = 0, maxGroep = null, som = 0, onzeker = false, ontbrekend = false;
    groepen.forEach(function (g) {
      som += g.totaalKW;
      if (g.totaalKW > max) { max = g.totaalKW; maxGroep = g; }
      if (g.onzekereKoppeling > 0) onzeker = true;
      if (g.ontbrekend > 0 || g.ongeldig > 0) ontbrekend = true;
    });
    // Slechtste geval bij onzekere koppeling: alle installaties van het gebouw gekoppeld.
    var slechtsteGeval = onzeker ? round2(som) : max;
    var antwoord;
    if (max > drempel) antwoord = 'ja';
    else if (!ontbrekend && slechtsteGeval <= drempel) antwoord = 'nee';
    else antwoord = 'onbekend';
    return { antwoord: antwoord, maxKW: max, maxGroep: maxGroep, slechtsteGevalKW: slechtsteGeval, onzeker: onzeker, ontbrekend: ontbrekend, aantalGroepen: groepen.length };
  }

  function uitzonderingStatus(gebouw) {
    var u = (gebouw && gebouw.uitzondering) || {};
    var sys = [gebouw && gebouw.heeftRuimteverwarming, gebouw && gebouw.heeftRuimtekoeling, gebouw && gebouw.heeftVentilatie];
    var ja = sys.filter(function (s) { return s === 'ja'; }).length;
    var nee = sys.filter(function (s) { return s === 'nee'; }).length;
    var kandidaat = ja === 1 && nee === 2;
    var motivatieOk = txt(u.motivatie).length >= 20;
    var bewijsOk = (u.bijlagen && u.bijlagen.length > 0) || txt(u.bewijs).length > 0;
    var status;
    if (u.ingeroepen) status = motivatieOk && bewijsOk ? 'ingeroepen-gestaafd' : 'ingeroepen-onvolledig';
    else status = kandidaat ? 'kandidaat' : 'geen';
    return { status: status, kandidaat: kandidaat, motivatieOk: motivatieOk, bewijsOk: bewijsOk, typeId: u.typeId || null };
  }
  var UITZONDERING_LABEL = {
    geen: 'Geen uitzondering ingeroepen',
    kandidaat: 'Mogelijke uitzondering (slechts één installatie) — niet ingeroepen, te onderzoeken',
    'ingeroepen-onvolledig': 'Uitzondering ingeroepen, maar motivering en/of bewijs ontbreken',
    'ingeroepen-gestaafd': 'Uitzondering ingeroepen en gedocumenteerd — te beoordelen door de bevoegde instantie'
  };

  /**
   * Beslissing per gebouw.
   * @returns {object} { gebouwId, stappen[], uitkomst, basis[], verwarming, koeling, toekomst, ... }
   */
  function beslisGebouw(gebouw, verw, koel, cfg, vandaag, aantalGebouwen) {
    var thr = cfg.drempels.huidig.kW, thrT = cfg.drempels.toekomstig.kW;
    var hv = groepenVoorGebouw(verw, gebouw, aantalGebouwen);
    var kv = groepenVoorGebouw(koel, gebouw, aantalGebouwen);
    var tv = toetsSoort(hv, thr), tk = toetsSoort(kv, thr);
    var tvT = toetsSoort(hv, thrT), tkT = toetsSoort(kv, thrT);
    var stappen = [];

    var nr = gebouw.nietResidentieel;
    stappen.push({
      id: 'S1', vraag: 'Is het een niet-residentieel gebouw?',
      antwoord: nr === 'ja' ? 'ja' : nr === 'nee' ? 'nee' : 'onbekend',
      toelichting: nr === 'nee' ? 'Residentiële gebouwen vallen buiten deze verplichting.' : nr === 'ja' ? 'De verplichting geldt voor nieuwe en bestaande niet-residentiële gebouwen.' : 'Bestemming nog niet bevestigd.'
    });

    var volledig = !tv.onzeker && !tv.ontbrekend && !tk.onzeker && !tk.ontbrekend;
    stappen.push({
      id: 'S2', vraag: 'Zijn alle vermogens en koppelingen gekend?',
      antwoord: volledig ? 'ja' : 'onbekend',
      toelichting: volledig ? 'Alle installaties hebben een vermogen en een gekende koppeling.' :
        [tv.ontbrekend || tk.ontbrekend ? 'er ontbreken vermogens' : null, tv.onzeker || tk.onzeker ? 'niet alle koppelingen zijn gekend' : null].filter(Boolean).join(' en ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.'
    });

    function toelichting(t, soortWoord) {
      if (t.aantalGroepen === 0) return 'Geen ' + soortWoord + 'sinstallaties geregistreerd.';
      var s = 'Grootste gekoppelde groep: ' + fmtKW(t.maxKW) + (t.maxGroep ? ' (' + t.maxGroep.naam + ')' : '') + '.';
      if (t.antwoord === 'onbekend') {
        if (t.ontbrekend) s += ' Er ontbreken vermogens, dus een overschrijding is niet uit te sluiten.';
        else if (t.onzeker) s += ' Bij onzekere koppeling kan het totaal oplopen tot ' + fmtKW(t.slechtsteGevalKW) + '.';
      }
      return s;
    }
    stappen.push({ id: 'S3', vraag: 'Overschrijdt een hydraulisch gekoppelde verwarmingsgroep ' + thr + ' kW?', antwoord: tv.antwoord, waardeKW: tv.maxKW, toelichting: toelichting(tv, 'verwarming') });
    stappen.push({ id: 'S4', vraag: 'Overschrijdt een koeltechnisch gekoppelde koelgroep ' + thr + ' kW?', antwoord: tk.antwoord, waardeKW: tk.maxKW, toelichting: toelichting(tk, 'koel') });

    var basis = [];
    if (tv.antwoord === 'ja') basis.push('verwarming');
    if (tk.antwoord === 'ja') basis.push('koeling');

    var uitkomst;
    if (stappen[0].antwoord === 'nee') uitkomst = UITKOMST.BUITEN;
    else if (stappen[0].antwoord === 'onbekend') uitkomst = UITKOMST.ONVOLLEDIG;
    else if (basis.length) uitkomst = UITKOMST.PLICHTIG;
    else if (tv.antwoord === 'onbekend' || tk.antwoord === 'onbekend') uitkomst = UITKOMST.ONVOLLEDIG;
    else uitkomst = UITKOMST.NIET;

    // Toekomstige drempel, apart getoond.
    var toekomstAntwoord = tvT.antwoord === 'ja' || tkT.antwoord === 'ja' ? 'ja' : (tvT.antwoord === 'onbekend' || tkT.antwoord === 'onbekend') ? 'onbekend' : 'nee';
    var toekomstBasis = [];
    if (tvT.antwoord === 'ja') toekomstBasis.push('verwarming');
    if (tkT.antwoord === 'ja') toekomstBasis.push('koeling');
    stappen.push({
      id: 'S5', vraag: 'Overschrijdt een gekoppelde groep de toekomstige drempel van ' + thrT + ' kW (uiterlijk ' + fmtDatum(cfg.drempels.toekomstig.deadline) + ')?',
      antwoord: uitkomst === UITKOMST.BUITEN ? 'nvt' : toekomstAntwoord,
      toelichting: toekomstBasis.length ? 'Op basis van ' + toekomstBasis.join(' en ') + '.' : (toekomstAntwoord === 'onbekend' ? 'Niet uit te sluiten met de huidige gegevens.' : 'Geen groep boven ' + thrT + ' kW.')
    });

    var uz = uitzonderingStatus(gebouw);
    stappen.push({
      id: 'S6', vraag: 'Is een uitzondering ingeroepen en gestaafd?',
      antwoord: uz.status === 'ingeroepen-gestaafd' ? 'ja' : uz.status === 'ingeroepen-onvolledig' ? 'onbekend' : 'nee',
      toelichting: UITZONDERING_LABEL[uz.status] + '. De app kent nooit zelf een uitzondering toe.'
    });

    var termijnVerstreken = vandaag > cfg.drempels.huidig.deadline;
    var toekomstPlichtig = uitkomst !== UITKOMST.BUITEN && toekomstAntwoord === 'ja';
    var startScreening = uitkomst === UITKOMST.PLICHTIG || toekomstPlichtig;
    stappen.push({
      id: 'S7', vraag: 'Technische screening starten?',
      antwoord: startScreening ? 'ja' : 'nee',
      toelichting: uitkomst === UITKOMST.PLICHTIG
        ? 'Potentieel plichtig: toets het BACS aan de technische vereisten.'
        : toekomstPlichtig ? 'Nu niet plichtig, maar wel onder de toekomstige drempel: screening aanbevolen ter voorbereiding.' : 'Geen screening nodig op basis van de huidige gegevens.'
    });

    var uitleg;
    if (uitkomst === UITKOMST.PLICHTIG) {
      uitleg = 'Het gebouw is potentieel BACS-plichtig op basis van ' + basis.join(' en ') + ' (groep boven ' + thr + ' kW). ' +
        (termijnVerstreken ? 'De wettelijke termijn (' + fmtDatum(cfg.drempels.huidig.deadline) + ') is verstreken.' : 'Wettelijke termijn: ' + fmtDatum(cfg.drempels.huidig.deadline) + '.');
    } else if (uitkomst === UITKOMST.NIET) {
      uitleg = 'Geen gekoppelde verwarmings- of koelgroep boven ' + thr + ' kW.' +
        (toekomstPlichtig ? ' Let op: het gebouw valt vermoedelijk wel onder de verplichting zodra de drempel daalt naar ' + thrT + ' kW (uiterlijk ' + fmtDatum(cfg.drempels.toekomstig.deadline) + ').' : '');
    } else if (uitkomst === UITKOMST.ONVOLLEDIG) {
      uitleg = stappen[0].antwoord === 'onbekend'
        ? 'De bestemming (niet-residentieel) is nog niet bevestigd.' + (basis.length ? ' Indien niet-residentieel: potentieel plichtig op basis van ' + basis.join(' en ') + '.' : '')
        : 'Een overschrijding van ' + thr + ' kW kan met de huidige gegevens niet worden uitgesloten. Vervolledig vermogens en koppelingen.';
    } else {
      uitleg = 'Residentieel gebouw: valt buiten deze verplichting.';
    }

    return {
      gebouwId: gebouw.id, gebouwNaam: txt(gebouw.naam) || '(naamloos gebouw)',
      stappen: stappen, uitkomst: uitkomst, label: UITKOMST_LABEL[uitkomst], uitleg: uitleg,
      basis: basis, verwarming: tv, koeling: tk, verwarmingGroepen: hv, koelingGroepen: kv,
      toekomst: { antwoord: toekomstAntwoord, plichtig: toekomstPlichtig, basis: toekomstBasis, drempelKW: thrT, deadline: cfg.drempels.toekomstig.deadline },
      uitzondering: uz, uitzonderingLabel: UITZONDERING_LABEL[uz.status],
      termijnVerstreken: termijnVerstreken, voorlopig: !volledig, startScreening: startScreening,
      conformiteitsverklaring: false // de app geeft nooit een definitieve juridische conformiteitsverklaring
    };
  }

  function beslis(dossier, cfg, vandaag) {
    vandaag = vandaag || isoVandaag();
    var verw = computeGroups(dossier, 'verwarming');
    var koel = computeGroups(dossier, 'koeling');
    var gebouwen = dossier.gebouwen || [];
    var perGebouw = gebouwen.map(function (g) { return beslisGebouw(g, verw, koel, cfg, vandaag, gebouwen.length); });
    var totaal = perGebouw.length
      ? perGebouw.reduce(function (a, b) { return UITKOMST_ERNST[b.uitkomst] > UITKOMST_ERNST[a] ? b.uitkomst : a; }, UITKOMST.BUITEN)
      : UITKOMST.ONVOLLEDIG;
    return {
      verwarming: verw, koeling: koel, perGebouw: perGebouw,
      uitkomst: totaal, label: UITKOMST_LABEL[totaal],
      startScreening: perGebouw.some(function (b) { return b.startScreening; }),
      toekomstPlichtig: perGebouw.some(function (b) { return b.toekomst.plichtig; })
    };
  }

  // ---------- validatie dossier ----------

  function validate(dossier, cfg, vandaag, beslissing) {
    vandaag = vandaag || isoVandaag();
    var b = beslissing || beslis(dossier, cfg, vandaag);
    var out = [].concat(b.verwarming.issues, b.koeling.issues);
    var gebouwen = dossier.gebouwen || [];
    var diep = dossier.modus === 'diep';
    if (!txt(dossier.klant && dossier.klant.naam)) out.push(issue('waarschuwing', 'KLANT_ONTBREEKT', 'Klantnaam ontbreekt.', { stap: 'klant' }));
    if (!txt(dossier.bezoek && dossier.bezoek.datum)) out.push(issue('info', 'BEZOEKDATUM_ONTBREEKT', 'Datum van het plaatsbezoek ontbreekt.', { stap: 'klant' }));
    if (!gebouwen.length) out.push(issue('fout', 'GEEN_GEBOUW', 'Registreer minstens één gebouw.', { stap: 'klant' }));
    var jaar = Number(vandaag.slice(0, 4));
    gebouwen.forEach(function (g) {
      var n = txt(g.naam) || '(naamloos gebouw)';
      if (g.nietResidentieel !== 'ja' && g.nietResidentieel !== 'nee') out.push(issue('fout', 'BESTEMMING_ONBEKEND', n + ': bevestig of het een niet-residentieel gebouw is.', { stap: 'klant', gebouwId: g.id }));
      if (!txt(g.eigenaarInstallaties)) out.push(issue('waarschuwing', 'EIGENAAR_INSTALLATIES_ONBEKEND', n + ': eigenaar of houder van het zakelijk recht van de technische installaties is niet ingevuld. Daar ligt de verplichting.', { stap: 'klant', gebouwId: g.id }));
      var bj = Number(g.bouwjaar);
      if (txt(g.bouwjaar) && (!isFinite(bj) || bj < 1500 || bj > jaar + 3)) out.push(issue('waarschuwing', 'BOUWJAAR_ONGELDIG', n + ': bouwjaar “' + txt(g.bouwjaar) + '” lijkt niet te kloppen.', { stap: 'klant', gebouwId: g.id }));
      if (g.nieuwBestaand === 'nieuw' && isFinite(bj) && txt(g.bouwjaar) && bj < jaar - 5) out.push(issue('waarschuwing', 'NIEUW_OUD_BOUWJAAR', n + ': aangeduid als nieuw gebouw, maar bouwjaar ' + bj + '.', { stap: 'klant', gebouwId: g.id }));
      var opp = parseKW(g.oppervlakte), kopp = parseKW(g.geklimatiseerdeOppervlakte);
      if (opp !== null && !isNaN(opp) && kopp !== null && !isNaN(kopp) && kopp > opp) out.push(issue('fout', 'OPPERVLAKTE_TEGENSTRIJDIG', n + ': geklimatiseerde oppervlakte is groter dan de totale oppervlakte.', { stap: 'klant', gebouwId: g.id }));
      var bg = b.perGebouw.filter(function (x) { return x.gebouwId === g.id; })[0];
      if (bg) {
        if (g.heeftRuimteverwarming === 'nee' && bg.verwarmingGroepen.some(function (x) { return x.units.length; })) out.push(issue('fout', 'VERWARMING_TEGENSTRIJDIG', n + ': aangeduid zonder ruimteverwarming, maar er zijn warmteopwekkers geregistreerd.', { stap: 'klant', gebouwId: g.id }));
        if (g.heeftRuimtekoeling === 'nee' && bg.koelingGroepen.some(function (x) { return x.units.length; })) out.push(issue('fout', 'KOELING_TEGENSTRIJDIG', n + ': aangeduid zonder ruimtekoeling, maar er zijn koelinstallaties geregistreerd.', { stap: 'klant', gebouwId: g.id }));
        if (g.heeftRuimteverwarming === 'ja' && !bg.verwarmingGroepen.length) out.push(issue('waarschuwing', 'VERWARMING_NIET_GEINVENTARISEERD', n + ': heeft ruimteverwarming, maar er zijn nog geen warmteopwekkers ingevoerd.', { stap: 'verwarming', gebouwId: g.id }));
        if (g.heeftRuimtekoeling === 'ja' && !bg.koelingGroepen.length) out.push(issue('waarschuwing', 'KOELING_NIET_GEINVENTARISEERD', n + ': heeft ruimtekoeling, maar er zijn nog geen koelinstallaties ingevoerd.', { stap: 'koeling', gebouwId: g.id }));
      }
      var u = g.uitzondering || {};
      if (u.ingeroepen) {
        var uz = uitzonderingStatus(g);
        if (!uz.motivatieOk) out.push(issue('fout', 'UITZONDERING_ZONDER_MOTIVERING', n + ': uitzondering ingeroepen zonder voldoende motivering (minstens één volledige zin).', { stap: 'uitzondering', gebouwId: g.id }));
        if (!uz.bewijsOk) out.push(issue('fout', 'UITZONDERING_ZONDER_BEWIJS', n + ': uitzondering ingeroepen zonder bewijsstuk.', { stap: 'uitzondering', gebouwId: g.id }));
        if (u.typeId === 'een-installatie' && !uz.kandidaat) out.push(issue('waarschuwing', 'UITZONDERING_NIET_CONSISTENT', n + ': uitzondering “slechts één installatie” ingeroepen, maar de aanwezige installaties (verwarming/koeling/ventilatie) bevestigen dat niet.', { stap: 'uitzondering', gebouwId: g.id }));
      }
    });
    // Screening-consistentie
    var s = evaluateScreening(dossier, cfg, vandaag);
    out = out.concat(s.issues);
    if (!diep) {
      var q = dossier.snelleChecklist || {};
      if (q.Q1 === 'nee' && (q.Q5 === 'ja' || q.Q6 === 'ja' || q.Q7 === 'ja')) {
        out.push(issue('waarschuwing', 'CHECKLIST_TEGENSTRIJDIG', 'Checklist: geen centraal BACS aangeduid, maar wel open communicatie, visualisatie of alarmen. Controleer of een EMS of ander platform die functies levert.', { stap: 'screening' }));
      }
    }
    var volgorde = { fout: 0, waarschuwing: 1, info: 2 };
    out.sort(function (a, z) { return volgorde[a.niveau] - volgorde[z.niveau]; });
    return out;
  }

  // ---------- technische screening ----------

  function eisenVoorMethode(cfg, methode) {
    var m = cfg.methodes[methode] || cfg.methodes.m1;
    var eisen = cfg.eisen.filter(function (e) { return m.eisen.indexOf(e.id) >= 0; });
    if (m.extraItems && m.extraItems.length) {
      eisen = [{ id: 'KB', titel: 'Klasse B (NBN EN ISO 52120-1:2022)', samenvatting: 'Bijkomende voorwaarde voor methode 2.', kern: true, items: m.extraItems }].concat(eisen);
    }
    return eisen;
  }

  function eisStatus(statussen) {
    var s = statussen.filter(function (x) { return x !== 'nvt'; });
    if (!statussen.length) return 'open';
    if (!s.length) return 'nvt';
    if (s.every(function (x) { return x === 'open'; })) return 'open';
    if (s.every(function (x) { return x === 'ja'; })) return 'voldoet';
    var heeftNee = s.some(function (x) { return x === 'nee'; });
    var heeftDeels = s.some(function (x) { return x === 'deels'; });
    var heeftJa = s.some(function (x) { return x === 'ja'; });
    if (heeftNee && !heeftJa && !heeftDeels) return 'voldoet-niet';
    if (heeftNee || heeftDeels) return 'gedeeltelijk';
    return 'te-verifieren';
  }

  function vereisteSensoren(dossier) {
    var tot = 0, gekend = false;
    (dossier.gebouwen || []).forEach(function (g) {
      var k = parseKW(g.geklimatiseerdeOppervlakte);
      if (k !== null && !isNaN(k) && k > 0) { tot += Math.ceil(k / 100); gekend = true; }
    });
    return gekend ? tot : null;
  }

  function evaluateScreening(dossier, cfg, vandaag) {
    vandaag = vandaag || isoVandaag();
    var sc = dossier.screening || {};
    var methode = sc.methode === 'm2' ? 'm2' : 'm1';
    var items = sc.items || {};
    var diep = dossier.modus === 'diep';
    var issues = [];
    var eisen = eisenVoorMethode(cfg, methode).map(function (e) {
      var toekomstig = !!(e.vanaf && vandaag < e.vanaf);
      var its = e.items.map(function (it) {
        var a = items[it.id] || {};
        var st = a.status || 'open';
        if (diep && st === 'ja' && !txt(a.bewijs) && !(a.bijlagen && a.bijlagen.length)) {
          issues.push(issue('info', 'BEWIJS_ONTBREEKT', 'Eis ' + it.id + ' staat op “voldoet”, maar zonder bewijsstuk.', { stap: 'screening', itemId: it.id }));
        }
        if (diep && st === 'nvt' && !txt(a.opmerking)) {
          issues.push(issue('waarschuwing', 'NVT_ZONDER_MOTIVERING', 'Eis ' + it.id + ' staat op “niet van toepassing” zonder motivering.', { stap: 'screening', itemId: it.id }));
        }
        return { id: it.id, tekst: it.tekst, oplossing: it.oplossing, fase: it.fase, status: st, bewijs: txt(a.bewijs), opmerking: txt(a.opmerking), bijlagen: a.bijlagen || [] };
      });
      var st = eisStatus(its.map(function (x) { return x.status; }));
      return { id: e.id, titel: e.titel, samenvatting: e.samenvatting, kern: !!e.kern, toekomstig: toekomstig, vanaf: e.vanaf || null, status: st, items: its };
    });

    // Sensoraantal versus G4
    var nodig = vereisteSensoren(dossier);
    var aantal = parseKW(sc.aantalIAQSensoren);
    if (diep && nodig !== null && aantal !== null && !isNaN(aantal) && items.G4 && items.G4.status === 'ja' && aantal < nodig) {
      issues.push(issue('fout', 'SENSOREN_TEGENSTRIJDIG', 'Eis G4 staat op “voldoet”, maar ' + aantal + ' sensoren is minder dan de ' + nodig + ' die de geklimatiseerde oppervlakte vereist (1 per 100 m², behalve grote lokalen).', { stap: 'screening', itemId: 'G4' }));
    }
    // Snelle checklist per eis
    var q = dossier.snelleChecklist || {};
    var snel = {};
    cfg.snelleChecklist.forEach(function (v) { (snel[v.eis] = snel[v.eis] || []).push(q[v.id] || 'open'); });
    var snelPerEis = cfg.eisen.map(function (e) {
      return { id: e.id, titel: e.titel, status: eisStatus(snel[e.id] || []), toekomstig: !!(e.vanaf && vandaag < e.vanaf) };
    });
    return { methode: methode, methodeLabel: (cfg.methodes[methode] || {}).label, eisen: eisen, snelPerEis: snelPerEis, issues: issues, vereisteSensoren: nodig, aantalSensoren: aantal };
  }

  // ---------- gapanalyse en actieplan ----------

  function gaps(dossier, cfg, vandaag, beslissing) {
    vandaag = vandaag || isoVandaag();
    var b = beslissing || beslis(dossier, cfg, vandaag);
    var out = [];
    var diep = dossier.modus === 'diep';

    if (b.uitkomst === UITKOMST.ONVOLLEDIG) {
      out.push({ eisId: '—', itemId: 'DATA', tekst: 'Toepasselijkheid nog niet vast te stellen.', status: 'onbekend', prioriteit: 'hoog', fase: 'verificatie',
        oplossing: 'Vervolledig de nominale vermogens (typeplaatjes) en bevestig de koppelingen met hydraulische of koeltechnische schema’s.' });
    }
    (dossier.gebouwen || []).forEach(function (g) {
      if (!txt(g.eigenaarInstallaties)) {
        out.push({ eisId: '—', itemId: 'EIG-' + g.id, tekst: 'Verantwoordelijke voor de technische installaties niet vastgelegd (' + (txt(g.naam) || 'gebouw') + ').', status: 'onbekend', prioriteit: 'hoog', fase: 'verificatie',
          oplossing: 'Bepaal wie eigenaar of houder van het zakelijk recht van de installaties is (bv. huurcontract, casco-verhuur).' });
      }
    });

    function prio(status, kern, toekomstig) {
      if (toekomstig) return 'toekomst';
      if (status === 'onbekend' || status === 'open') return 'verifiëren';
      return kern ? 'hoog' : 'middel';
    }

    if (diep) {
      var s = evaluateScreening(dossier, cfg, vandaag);
      s.eisen.forEach(function (e) {
        e.items.forEach(function (it) {
          if (it.status === 'ja' || it.status === 'nvt') return;
          out.push({
            eisId: e.id, eisTitel: e.titel, itemId: it.id, tekst: it.tekst, status: it.status,
            prioriteit: prio(it.status, e.kern, e.toekomstig),
            fase: e.toekomstig ? 'toekomst' : (it.status === 'onbekend' || it.status === 'open') ? 'verificatie' : it.fase,
            oplossing: (it.status === 'onbekend' || it.status === 'open') ? 'Controleer ter plaatse en verzamel bewijs. Indien niet aanwezig: ' + lc(it.oplossing) : it.oplossing
          });
        });
      });
    } else {
      var q = dossier.snelleChecklist || {};
      var eisById = {};
      cfg.eisen.forEach(function (e) { eisById[e.id] = e; });
      cfg.snelleChecklist.forEach(function (v) {
        var st = q[v.id] || 'open';
        if (st === 'ja' || st === 'nvt') return;
        var e = eisById[v.eis] || {};
        var toekomstig = !!(e.vanaf && vandaag < e.vanaf);
        out.push({
          eisId: v.eis, eisTitel: e.titel, itemId: v.id, tekst: v.vraag, status: st,
          prioriteit: prio(st, e.kern, toekomstig),
          fase: toekomstig ? 'toekomst' : (st === 'onbekend' || st === 'open') ? 'verificatie' : v.fase,
          oplossing: (st === 'onbekend' || st === 'open') ? 'Na te gaan tijdens de dieptescreening. Indien afwezig: ' + lc(v.oplossing) : v.oplossing
        });
      });
    }
    if (b.toekomstPlichtig && b.uitkomst !== UITKOMST.PLICHTIG) {
      out.push({ eisId: '—', itemId: 'T70', tekst: 'Het gebouw valt vermoedelijk onder de verplichting zodra de drempel daalt naar ' + cfg.drempels.toekomstig.kW + ' kW.', status: 'nee', prioriteit: 'toekomst', fase: 'toekomst',
        oplossing: 'Plan de BACS-investering vóór ' + fmtDatum(cfg.drempels.toekomstig.deadline) + ' en neem BACS-eisen op bij elke vervanging van installaties.' });
    }
    return out;
  }
  function lc(s) { s = txt(s); return s ? s.charAt(0).toLowerCase() + s.slice(1) : ''; }

  function actieplan(dossier, cfg, vandaag, lijst) {
    var g = lijst || gaps(dossier, cfg, vandaag);
    return cfg.fases.map(function (f) {
      return { id: f.id, label: f.label, termijn: f.termijn, acties: g.filter(function (x) { return x.fase === f.id; }) };
    }).filter(function (f) { return f.acties.length; });
  }

  /** Alles in één keer, voor scherm en rapport. */
  function analyse(dossier, cfg, vandaag) {
    vandaag = vandaag || isoVandaag();
    var b = beslis(dossier, cfg, vandaag);
    var s = evaluateScreening(dossier, cfg, vandaag);
    var g = gaps(dossier, cfg, vandaag, b);
    return {
      vandaag: vandaag, beslissing: b, screening: s, gaps: g,
      actieplan: actieplan(dossier, cfg, vandaag, g),
      issues: validate(dossier, cfg, vandaag, b)
    };
  }

  // ---------- rapporten ----------

  function esc(v) {
    return txt(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function janee(v) { return v === 'ja' ? 'Ja' : v === 'nee' ? 'Nee' : v ? esc(v) : '—'; }

  var RAPPORT_CSS = [
    '@page{size:A4;margin:16mm 14mm}',
    ':root{--ink:#1d2a30;--muted:#5b6a70;--line:#d5dcdf;--soft:#f2f5f6;--accent:#0f5e6e;--warm:#b4532a;--cool:#2c6fa8;--ok:#2f7a4b;--warn:#a96b00;--bad:#b3261e;color-scheme:light}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#fff;color:var(--ink);font:10.5pt/1.5 "IBM Plex Sans",-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.page{max-width:820px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left,0px)) 40px}',
    'h1{font:600 22pt/1.15 "Archivo","IBM Plex Sans",Arial,sans-serif;margin:0 0 4px;letter-spacing:-.01em}',
    'h2{font:600 13pt/1.25 "Archivo","IBM Plex Sans",Arial,sans-serif;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--ink);break-after:avoid}',
    'h3{font-size:11pt;margin:16px 0 6px;break-after:avoid}',
    'p{margin:0 0 8px}',
    '.eyebrow{font:600 8pt/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}',
    '.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 20px;margin:14px 0;font-size:9.5pt}',
    '.meta dt{color:var(--muted);font-size:8pt;text-transform:uppercase;letter-spacing:.06em}.meta dd{margin:0 0 6px}',
    '.disclaimer{border:1px solid var(--line);background:var(--soft);padding:10px 12px;font-size:9pt;color:var(--muted);margin:14px 0}',
    '.verdict{border:2px solid var(--ink);padding:14px 16px;margin:14px 0;break-inside:avoid}',
    '.verdict .lbl{font:600 15pt/1.2 "Archivo",Arial,sans-serif}',
    '.verdict.plichtig{border-color:var(--warm)}.verdict.plichtig .lbl{color:var(--warm)}',
    '.verdict.niet{border-color:var(--ok)}.verdict.niet .lbl{color:var(--ok)}',
    '.verdict.onvolledig{border-color:var(--warn)}.verdict.onvolledig .lbl{color:var(--warn)}',
    'table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:9.5pt;font-variant-numeric:tabular-nums}',
    'th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}',
    'th{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}',
    'td.num,th.num{text-align:right;white-space:nowrap}',
    'tr{break-inside:avoid}',
    '.bar{position:relative;height:10px;background:var(--soft);min-width:120px}',
    '.bar i{position:absolute;left:0;top:0;bottom:0}.bar b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink)}.bar b.t{background:var(--muted)}',
    '.pill{display:inline-block;padding:1px 7px;border-radius:99px;font-size:8pt;font-weight:600;border:1px solid currentColor;white-space:nowrap}',
    '.s-ja,.s-voldoet,.s-nee-ok{color:var(--ok)}.s-nee,.s-voldoet-niet{color:var(--bad)}.s-deels,.s-gedeeltelijk{color:var(--warn)}',
    '.s-onbekend,.s-te-verifieren,.s-open,.s-nvt{color:var(--muted)}.s-ja-ans{color:var(--accent)}',
    '.tree{list-style:none;padding:0;margin:6px 0;counter-reset:s}',
    '.tree li{display:grid;grid-template-columns:28px 1fr auto;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line);break-inside:avoid}',
    '.tree li:before{counter-increment:s;content:counter(s);font:600 9pt "IBM Plex Mono",monospace;color:var(--accent)}',
    '.small{font-size:8.5pt;color:var(--muted)}',
    '.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}',
    '.box{border:1px solid var(--line);padding:10px 12px;break-inside:avoid}',
    '.box .k{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.box .v{font:600 16pt/1.2 "Archivo",Arial,sans-serif}',
    'ol.acties,ul.acties{padding-left:18px;margin:4px 0 10px}ol.acties li,ul.acties li{margin-bottom:5px}',
    '.foot{margin-top:28px;padding-top:8px;border-top:1px solid var(--line);font-size:8pt;color:var(--muted)}',
    'a{color:var(--accent)}',
    '.scroll{overflow-x:auto}',
    '@media print{.page{padding:0}a{color:inherit;text-decoration:none}}'
  ].join('\n');

  function vermogenTabel(groepen, soort, cfg) {
    if (!groepen.length) return '<p class="small">Geen ' + (soort === 'verwarming' ? 'verwarmings' : 'koel') + 'installaties geregistreerd.</p>';
    var thr = cfg.drempels.huidig.kW, thrT = cfg.drempels.toekomstig.kW;
    var schaal = Math.max(thr * 1.25, Math.max.apply(null, groepen.map(function (g) { return g.totaalKW; })) * 1.1);
    var kleur = soort === 'verwarming' ? 'var(--warm)' : 'var(--cool)';
    var rows = groepen.map(function (g) {
      var w = Math.min(100, g.totaalKW / schaal * 100);
      var status = g.totaalKW > thr ? '<span class="pill s-nee">&gt; ' + thr + ' kW</span>' : g.totaalKW > thrT ? '<span class="pill s-deels">&gt; ' + thrT + ' kW</span>' : '<span class="pill s-ja">≤ ' + thrT + ' kW</span>';
      if (g.ontbrekend || g.ongeldig) status += ' <span class="pill s-onbekend">onvolledig</span>';
      if (g.onzekereKoppeling) status += ' <span class="pill s-onbekend">koppeling?</span>';
      return '<tr><td>' + esc(g.naam) + '<div class="small">' + g.units.map(function (u) { return esc(u.naam || '(naamloos)') + ' ' + fmtKW(parseKW(u.vermogenKW)); }).join(' · ') + '</div></td>' +
        '<td class="num">' + fmtKW(g.totaalKW) + '</td>' +
        '<td><div class="bar"><i style="width:' + w.toFixed(1) + '%;background:' + kleur + '"></i><b class="t" style="left:' + (thrT / schaal * 100).toFixed(1) + '%"></b><b style="left:' + (thr / schaal * 100).toFixed(1) + '%"></b></div></td>' +
        '<td>' + status + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table><thead><tr><th>Gekoppelde groep</th><th class="num">Vermogen</th><th>t.o.v. ' + thrT + ' / ' + thr + ' kW</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function verdictKlasse(u) {
    return u === UITKOMST.PLICHTIG ? 'plichtig' : u === UITKOMST.NIET ? 'niet' : u === UITKOMST.ONVOLLEDIG ? 'onvolledig' : '';
  }

  function rapportKop(dossier, a, titel, cfg) {
    var k = dossier.klant || {}, s = dossier.site || {}, bz = dossier.bezoek || {};
    return '<div class="eyebrow">BACS-screening · Vlaanderen</div><h1>' + esc(titel) + '</h1>' +
      '<div class="small">' + esc(s.naam || '') + (s.adres ? ' — ' + esc(s.adres) : '') + '</div>' +
      '<dl class="meta">' +
      '<div><dt>Klant</dt><dd>' + (esc(k.naam) || '—') + '</dd></div>' +
      '<div><dt>Contactpersoon</dt><dd>' + (esc(k.contactpersoon) || '—') + '</dd></div>' +
      '<div><dt>Plaatsbezoek</dt><dd>' + fmtDatum(bz.datum) + '</dd></div>' +
      '<div><dt>Adviseur</dt><dd>' + (esc(bz.adviseur) || '—') + '</dd></div>' +
      '<div><dt>Rapportdatum</dt><dd>' + fmtDatum(a.vandaag) + '</dd></div>' +
      '<div><dt>Screening</dt><dd>' + (dossier.modus === 'diep' ? 'Technische dieptescreening' : 'Snelle screening') + '</dd></div>' +
      '</dl>' +
      '<div class="disclaimer"><strong>Belangrijk.</strong> ' + esc(cfg.disclaimer) + '</div>';
  }

  function beslissingBlok(a, cfg, compact) {
    var b = a.beslissing;
    var html = '<div class="verdict ' + verdictKlasse(b.uitkomst) + '"><div class="small">Voorlopige toepasselijkheid (huidige drempel: meer dan ' + cfg.drempels.huidig.kW + ' kW)</div><div class="lbl">' + esc(b.label) + '</div>';
    b.perGebouw.forEach(function (g) {
      html += '<p style="margin-top:8px"><strong>' + esc(g.gebouwNaam) + ':</strong> ' + esc(g.uitleg) + (g.voorlopig ? ' <em>(voorlopig: gegevens onvolledig)</em>' : '') + '</p>';
    });
    html += '<p class="small" style="margin:6px 0 0">Dit is geen definitieve juridische conformiteitsverklaring.</p></div>';
    html += '<div class="cols">';
    b.perGebouw.forEach(function (g) {
      html += '<div class="box"><div class="k">' + esc(g.gebouwNaam) + ' · verwarming</div><div class="v">' + fmtKW(g.verwarming.maxKW) + '</div><div class="small">grootste gekoppelde groep · ' + (g.verwarming.antwoord === 'ja' ? 'boven' : g.verwarming.antwoord === 'nee' ? 'niet boven' : 'onzeker t.o.v.') + ' ' + cfg.drempels.huidig.kW + ' kW</div></div>';
      html += '<div class="box"><div class="k">' + esc(g.gebouwNaam) + ' · koeling</div><div class="v">' + fmtKW(g.koeling.maxKW) + '</div><div class="small">grootste gekoppelde groep · ' + (g.koeling.antwoord === 'ja' ? 'boven' : g.koeling.antwoord === 'nee' ? 'niet boven' : 'onzeker t.o.v.') + ' ' + cfg.drempels.huidig.kW + ' kW</div></div>';
      html += '<div class="box"><div class="k">Toekomstige drempel (' + cfg.drempels.toekomstig.kW + ' kW)</div><div class="v">' + (g.toekomst.antwoord === 'ja' ? 'Overschreden' : g.toekomst.antwoord === 'nee' ? 'Niet overschreden' : 'Onzeker') + '</div><div class="small">uiterlijk vanaf ' + fmtDatum(cfg.drempels.toekomstig.deadline) + (g.toekomst.basis.length ? ' · ' + g.toekomst.basis.join(' en ') : '') + '</div></div>';
    });
    html += '</div>';
    if (!compact) {
      html += '<p class="small">Totaal geïnstalleerd op de site (informatief, niet gebruikt voor de toets): verwarming ' + fmtKW(b.verwarming.siteTotaalKW) + ', koeling ' + fmtKW(b.koeling.siteTotaalKW) + '. ' + esc(cfg.berekeningsregel) + '</p>';
    }
    return html;
  }

  function bronnenBlok(cfg) {
    return '<h2>Bronnen</h2><ul class="acties">' + cfg.bronnen.map(function (b) {
      return '<li><a href="' + esc(b.url) + '">' + esc(b.titel) + '</a><div class="small">' + esc(b.url) + '</div></li>';
    }).join('') + '</ul><p class="small">Regelgeving: ' + esc(cfg.regelgeving) + ' Parameters: configuratieversie ' + esc(cfg.configVersie) + ', bronnen geraadpleegd op ' + fmtDatum(cfg.geraadpleegdOp) + '.</p>';
  }

  function statusPill(st, labels) {
    return '<span class="pill s-' + esc(st) + '">' + esc((labels || ITEM_STATUS_LABEL)[st] || st) + '</span>';
  }

  function doc(titel, body) {
    return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(titel) + '</title>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500;600&display=swap">' +
      '<style>' + RAPPORT_CSS + '</style></head><body><div class="page">' + body + '</div></body></html>';
  }

  /** Korte klantenfiche (1–2 pagina's). */
  function renderKlantenfiche(dossier, cfg, vandaag) {
    var a = analyse(dossier, cfg, vandaag);
    var s = a.screening;
    var body = rapportKop(dossier, a, 'Klantenfiche BACS-screening', cfg);
    body += '<h2>Toepasselijkheid</h2>' + beslissingBlok(a, cfg, true);
    body += '<h2>Vermogen per gekoppelde groep</h2><h3>Verwarming</h3>' + vermogenTabel(a.beslissing.verwarming.groepen, 'verwarming', cfg) +
      '<h3>Koeling</h3>' + vermogenTabel(a.beslissing.koeling.groepen, 'koeling', cfg);
    body += '<h2>Indicatieve stand per eis</h2><div class="scroll"><table><thead><tr><th>Eis</th><th>Omschrijving</th><th>Stand</th></tr></thead><tbody>';
    var rows = dossier.modus === 'diep' ? s.eisen : s.snelPerEis;
    rows.forEach(function (e) {
      body += '<tr><td><strong>' + esc(e.id) + '</strong></td><td>' + esc(e.titel) + (e.toekomstig ? ' <span class="small">(verplicht vanaf ' + fmtDatum(e.vanaf || cfg.verlichtingVerplichtVanaf) + ')</span>' : '') + '</td><td>' + statusPill(e.status, EIS_STATUS_LABEL) + '</td></tr>';
    });
    body += '</tbody></table></div>';
    var top = a.gaps.filter(function (g) { return g.prioriteit === 'hoog' || g.prioriteit === 'verifiëren'; }).slice(0, 6);
    body += '<h2>Belangrijkste aandachtspunten</h2>';
    body += top.length ? '<ol class="acties">' + top.map(function (g) { return '<li><strong>' + esc(g.tekst) + '</strong><br><span class="small">' + esc(g.oplossing) + '</span></li>'; }).join('') + '</ol>' : '<p>Geen prioritaire aandachtspunten op basis van de ingevulde gegevens.</p>';
    body += '<h2>Vervolgstappen</h2><ol class="acties">' + cfg.vervolgstappen.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ol>';
    body += '<h2>Verantwoordelijkheid</h2><p>' + esc(cfg.verantwoordelijkheid) + '</p>' +
      (dossier.gebouwen || []).map(function (g) { return '<p class="small">' + esc(g.naam || 'Gebouw') + ': eigenaar/houder zakelijk recht installaties: <strong>' + (esc(g.eigenaarInstallaties) || 'nog vast te stellen') + '</strong>.</p>'; }).join('');
    body += bronnenBlok(cfg);
    body += '<div class="foot">Opgemaakt met de BACS-screeningstool. ' + esc(cfg.disclaimer) + '</div>';
    return doc('Klantenfiche BACS — ' + txt(dossier.site && dossier.site.naam || dossier.klant && dossier.klant.naam), body);
  }

  /** Uitgebreid technisch rapport. */
  function renderTechnischRapport(dossier, cfg, vandaag) {
    var a = analyse(dossier, cfg, vandaag);
    var b = a.beslissing, s = a.screening;
    var gebouwNaam = {};
    (dossier.gebouwen || []).forEach(function (g) { gebouwNaam[g.id] = g.naam; });
    var body = rapportKop(dossier, a, 'Technisch rapport BACS-screening', cfg);

    body += '<h2>1. Samenvatting</h2>' + beslissingBlok(a, cfg, false);

    body += '<h2>2. Gebouwen en verantwoordelijkheid</h2><div class="scroll"><table><thead><tr><th>Gebouw</th><th>Type</th><th>Nieuw/bestaand</th><th>Bouwjaar</th><th class="num">Opp.</th><th>Eigenaar gebouw</th><th>Eigenaar installaties</th><th>Gebruiker</th></tr></thead><tbody>' +
      (dossier.gebouwen || []).map(function (g) {
        return '<tr><td>' + esc(g.naam) + '</td><td>' + esc(g.type) + '</td><td>' + esc(g.nieuwBestaand) + '</td><td>' + esc(g.bouwjaar) + '</td><td class="num">' + (txt(g.oppervlakte) ? esc(g.oppervlakte) + ' m²' : '—') + '</td><td>' + esc(g.eigenaarGebouw) + '</td><td>' + (esc(g.eigenaarInstallaties) || '<em>onbekend</em>') + '</td><td>' + esc(g.gebruiker) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="small">' + esc(cfg.verantwoordelijkheid) + '</p>';

    if ((dossier.structuur || []).length) {
      var soortLbl = {};
      cfg.structuurSoorten.forEach(function (x) { soortLbl[x.id] = x.label; });
      body += '<h3>Site-indeling</h3><div class="scroll"><table><thead><tr><th>Onderdeel</th><th>Soort</th><th>Gebouw</th><th>Opmerking</th></tr></thead><tbody>' +
        dossier.structuur.map(function (x) { return '<tr><td>' + esc(x.naam) + '</td><td>' + esc(soortLbl[x.soort] || x.soort) + '</td><td>' + esc(gebouwNaam[x.gebouwId] || '') + '</td><td>' + esc(x.opmerkingen) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }

    body += '<h2>3. Vermogensberekening</h2><p>' + esc(cfg.berekeningsregel) + '</p><h3>Verwarming — per hydraulisch gekoppelde groep</h3>' + vermogenTabel(b.verwarming.groepen, 'verwarming', cfg) +
      '<h3>Koeling — per koeltechnisch gekoppelde groep</h3>' + vermogenTabel(b.koeling.groepen, 'koeling', cfg);

    function inventaris(lijst, soort) {
      if (!lijst.length) return '<p class="small">Geen installaties.</p>';
      return '<div class="scroll"><table><thead><tr><th>Naam</th><th>Type</th><th>Fabrikant / model</th><th>Bouwjaar</th>' + (soort === 'verwarming' ? '<th>Drager</th><th>Hoofdverw.</th>' : '') + '<th class="num">kW</th><th>Gekoppeld</th><th>Regeling / protocol</th><th>Meetpunten / diagnose</th></tr></thead><tbody>' +
        lijst.map(function (u) {
          return '<tr><td>' + esc(u.naam) + '<div class="small">' + esc(gebouwNaam[u.gebouwId] || '') + (u.centraalLokaal ? ' · ' + esc(u.centraalLokaal) : '') + (u.ventilatie === 'ja' ? ' · gekoppeld aan ventilatie' : '') + '</div></td><td>' + esc(u.type) + '</td><td>' + esc([u.fabrikant, u.model].filter(Boolean).join(' ')) + '</td><td>' + esc(u.bouwjaar) + '</td>' +
            (soort === 'verwarming' ? '<td>' + esc(u.energiedrager) + '</td><td>' + janee(u.hoofdverwarming) + '</td>' : '') +
            '<td class="num">' + fmtKW(parseKW(u.vermogenKW)) + '</td><td>' + janee(u.gekoppeld) + '</td><td>' + esc([u.regelsysteem, u.protocol].filter(Boolean).join(' · ')) + '</td><td>' + esc([u.meetpunten, u.storingsinfo].filter(Boolean).join(' · ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    body += '<h2>4. Inventaris</h2><h3>Warmteopwekkers</h3>' + inventaris(dossier.verwarming || [], 'verwarming') + '<h3>Koelinstallaties</h3>' + inventaris(dossier.koeling || [], 'koeling');
    var klein = (dossier.verwarming || []).filter(function (u) { var k = parseKW(u.vermogenKW); return k !== null && k < cfg.kleineVerwarmingKW && u.hoofdverwarming === 'nee'; });
    if (klein.length) body += '<p class="small">' + klein.length + ' warmteopwekker(s) &lt; ' + cfg.kleineVerwarmingKW + ' kW buiten de hoofdverwarming vallen buiten de scope van eisen A–D (ze tellen wel mee in de vermogenstoets van hun groep).</p>';

    body += '<h2>5. Beslissingsboom</h2>';
    b.perGebouw.forEach(function (g) {
      body += '<h3>' + esc(g.gebouwNaam) + '</h3><ol class="tree">' + g.stappen.map(function (st) {
        return '<li><div><strong>' + esc(st.vraag) + '</strong><div class="small">' + esc(st.toelichting) + '</div></div><div>' + statusPill(st.antwoord === 'ja' ? 'ja-ans' : st.antwoord, { 'ja-ans': 'Ja', nee: 'Nee', onbekend: 'Onbekend', nvt: 'n.v.t.' }) + '</div></li>';
      }).join('') + '</ol>';
    });

    body += '<h2>6. Uitzonderingen en bijzondere situaties</h2>';
    (dossier.gebouwen || []).forEach(function (g) {
      var u = g.uitzondering || {};
      var bg = b.perGebouw.filter(function (x) { return x.gebouwId === g.id; })[0];
      body += '<p><strong>' + esc(g.naam) + ':</strong> ' + esc(bg ? bg.uitzonderingLabel : '') + '.</p>';
      if (u.ingeroepen) body += '<p class="small">Motivering: ' + (esc(u.motivatie) || '—') + '<br>Bewijs: ' + (esc(u.bewijs) || '—') + (u.bijlagen && u.bijlagen.length ? ' (' + u.bijlagen.length + ' bijlage(n))' : '') + '</p>';
      if (txt(g.bijzondereSituaties)) body += '<p class="small">Bijzondere situaties: ' + esc(g.bijzondereSituaties) + '</p>';
    });
    body += '<p class="small">Een uitzondering wordt in deze tool nooit automatisch toegekend; de beoordeling ligt bij de energiedeskundige of de bevoegde instantie.</p>';

    body += '<h2>7. Technische screening</h2><p>' + esc(s.methodeLabel) + '. ' + esc(cfg.scopeToelichting) + '</p>';
    if (dossier.modus === 'diep') {
      s.eisen.forEach(function (e) {
        body += '<h3>' + esc(e.id) + '. ' + esc(e.titel) + ' ' + statusPill(e.status, EIS_STATUS_LABEL) + (e.toekomstig ? ' <span class="small">verplicht vanaf ' + fmtDatum(e.vanaf) + '</span>' : '') + '</h3>' +
          '<div class="scroll"><table><thead><tr><th style="width:44px">Item</th><th>Vereiste</th><th>Stand</th><th>Bewijs / opmerking</th></tr></thead><tbody>' +
          e.items.map(function (it) {
            return '<tr><td>' + esc(it.id) + '</td><td>' + esc(it.tekst) + '</td><td>' + statusPill(it.status) + '</td><td>' + esc(it.bewijs) + (it.bijlagen.length ? ' <span class="small">(' + it.bijlagen.length + ' bijlage(n))</span>' : '') + (it.opmerking ? '<div class="small">' + esc(it.opmerking) + '</div>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      });
      if (s.vereisteSensoren !== null) body += '<p class="small">Binnenklimaat: ' + s.vereisteSensoren + ' meetpunten vereist op basis van de geklimatiseerde oppervlakte (1 per 100 m²; minder in lokalen &gt; 100 m²); ' + (s.aantalSensoren !== null && !isNaN(s.aantalSensoren) ? s.aantalSensoren + ' vastgesteld.' : 'aantal aanwezig niet ingevuld.') + '</p>';
    } else {
      body += '<p class="small">Snelle screening: alleen de korte checklist werd doorlopen.</p><div class="scroll"><table><thead><tr><th>Vraag</th><th>Eis</th><th>Antwoord</th></tr></thead><tbody>' +
        cfg.snelleChecklist.map(function (v) { var st = (dossier.snelleChecklist || {})[v.id] || 'open'; return '<tr><td>' + esc(v.vraag) + '</td><td>' + esc(v.eis) + '</td><td>' + statusPill(st) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }

    body += '<h2>8. Gapanalyse</h2>';
    if (a.gaps.length) {
      body += '<div class="scroll"><table><thead><tr><th>Eis</th><th>Tekortkoming</th><th>Stand</th><th>Prioriteit</th><th>Voorgestelde oplossing</th></tr></thead><tbody>' +
        a.gaps.map(function (g) { return '<tr><td>' + esc(g.itemId) + '</td><td>' + esc(g.tekst) + '</td><td>' + statusPill(g.status) + '</td><td>' + esc(g.prioriteit) + '</td><td>' + esc(g.oplossing) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else body += '<p>Geen tekortkomingen vastgesteld op basis van de ingevulde gegevens.</p>';

    body += '<h2>9. Actieplan</h2>';
    a.actieplan.forEach(function (f) {
      body += '<h3>' + esc(f.label) + ' <span class="small">· ' + esc(f.termijn) + '</span></h3><ul class="acties">' + f.acties.map(function (x) { return '<li>' + esc(x.oplossing) + ' <span class="small">(' + esc(x.itemId) + ')</span></li>'; }).join('') + '</ul>';
    });
    body += '<h3>Algemene vervolgstappen</h3><ol class="acties">' + cfg.vervolgstappen.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ol>';

    var open = a.issues.filter(function (i) { return i.niveau !== 'info'; });
    body += '<h2>10. Datakwaliteit</h2>' + (open.length ? '<ul class="acties">' + open.map(function (i) { return '<li><strong>' + (i.niveau === 'fout' ? 'Fout' : 'Aandacht') + ':</strong> ' + esc(i.tekst) + '</li>'; }).join('') + '</ul>' : '<p>Geen ontbrekende of tegenstrijdige gegevens gedetecteerd.</p>');
    if (txt(dossier.opmerkingen)) body += '<h3>Opmerkingen adviseur</h3><p>' + esc(dossier.opmerkingen) + '</p>';

    body += bronnenBlok(cfg);
    body += '<div class="foot">Opgemaakt met de BACS-screeningstool. ' + esc(cfg.disclaimer) + '</div>';
    return doc('Technisch rapport BACS — ' + txt(dossier.site && dossier.site.naam || dossier.klant && dossier.klant.naam), body);
  }

  return {
    UITKOMST: UITKOMST, UITKOMST_LABEL: UITKOMST_LABEL, ITEM_STATUS_LABEL: ITEM_STATUS_LABEL, EIS_STATUS_LABEL: EIS_STATUS_LABEL,
    UITZONDERING_LABEL: UITZONDERING_LABEL,
    mergeConfig: mergeConfig, parseKW: parseKW, fmtKW: fmtKW, fmtDatum: fmtDatum, isoVandaag: isoVandaag,
    computeGroups: computeGroups, beslis: beslis, validate: validate, evaluateScreening: evaluateScreening,
    eisenVoorMethode: eisenVoorMethode, eisStatus: eisStatus, vereisteSensoren: vereisteSensoren,
    gaps: gaps, actieplan: actieplan, analyse: analyse, uitzonderingStatus: uitzonderingStatus,
    renderKlantenfiche: renderKlantenfiche, renderTechnischRapport: renderTechnischRapport, esc: esc
  };
});
