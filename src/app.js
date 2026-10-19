/*
 * BACS-screening — gebruikersinterface (vanilla JavaScript, geen build nodig).
 * Afhankelijk van: BACS_DEFAULT_CONFIG (config.js), BACSEngine (engine.js), BACS_SAMPLES (sample-data.js).
 */
(function () {
  'use strict';
  var E = window.BACSEngine;
  var DEFAULT_CFG = window.BACS_DEFAULT_CONFIG;
  var SAMPLES = window.BACS_SAMPLES;
  var esc = E.esc;

  // Oude localStorage-sleutels (versie 1.0): worden bij de eerste start eenmalig naar IndexedDB gemigreerd.
  var KEY_DOSSIERS = 'bacs.dossiers.v1';
  var KEY_CONFIG = 'bacs.config.v1';
  var KEY_PREFS = 'bacs.prefs.v1';
  var BACKUP_FORMAAT = 'bacs-screening-backup';
  var BACKUP_HERINNERING_DAGEN = 7;

  // ------------------------------------------------------------------ opslag
  //
  // Primair: IndexedDB (database "bacs-screening": store "dossiers" per dossier, store "kv" voor
  // configuratie en voorkeuren). Terugval: localStorage, als IndexedDB niet beschikbaar is.

  function promisify(req) {
    return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; });
  }
  function lsGet(k, fb) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function lsSet(k, v) { window.localStorage.setItem(k, JSON.stringify(v)); }

  var opslag = {
    modus: 'geen',
    db: null,
    init: function () {
      return new Promise(function (res) {
        var req;
        try { req = window.indexedDB.open('bacs-screening', 1); } catch (e) { req = null; }
        if (!req) { opslag.modus = opslag.lsBeschikbaar() ? 'ls' : 'geen'; return res(); }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('dossiers')) db.createObjectStore('dossiers', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = function () { opslag.db = req.result; opslag.modus = 'idb'; res(); };
        req.onerror = req.onblocked = function () { opslag.modus = opslag.lsBeschikbaar() ? 'ls' : 'geen'; res(); };
      });
    },
    lsBeschikbaar: function () { try { window.localStorage.setItem('bacs.test', '1'); window.localStorage.removeItem('bacs.test'); return true; } catch (e) { return false; } },
    store: function (naam, mode) { return opslag.db.transaction(naam, mode || 'readonly').objectStore(naam); },
    klaar: function (tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { rej(tx.error); }; }); },

    /** Leest alles in. Migreert eenmalig de oude localStorage-gegevens. */
    laadAlles: function () {
      if (opslag.modus === 'ls') return Promise.resolve({ dossiers: lsGet(KEY_DOSSIERS, null), config: lsGet(KEY_CONFIG, null), prefs: lsGet(KEY_PREFS, {}) || {} });
      if (opslag.modus !== 'idb') return Promise.resolve({ dossiers: null, config: null, prefs: {} });
      return Promise.all([
        promisify(opslag.store('dossiers').getAll()),
        promisify(opslag.store('kv').get('config')),
        promisify(opslag.store('kv').get('prefs')),
        promisify(opslag.store('kv').get('geinitialiseerd'))
      ]).then(function (r) {
        if (r[3]) return { dossiers: r[0], config: r[1] || null, prefs: r[2] || {} };
        // Eerste start met IndexedDB: oude gegevens overnemen.
        var oud = { dossiers: lsGet(KEY_DOSSIERS, null), config: lsGet(KEY_CONFIG, null), prefs: lsGet(KEY_PREFS, {}) || {} };
        var tx = opslag.db.transaction(['dossiers', 'kv'], 'readwrite');
        (oud.dossiers || []).forEach(function (d) { tx.objectStore('dossiers').put(d); });
        if (oud.config) tx.objectStore('kv').put(oud.config, 'config');
        tx.objectStore('kv').put(oud.prefs, 'prefs');
        tx.objectStore('kv').put(true, 'geinitialiseerd');
        return opslag.klaar(tx).then(function () { return oud.dossiers ? oud : { dossiers: null, config: oud.config, prefs: oud.prefs }; });
      });
    },
    bewaarDossier: function (d) {
      if (opslag.modus === 'ls') return opslag.bewaarAlle(state.dossiers);
      if (opslag.modus !== 'idb') return Promise.reject(new Error('geen opslag'));
      var tx = opslag.db.transaction('dossiers', 'readwrite');
      tx.objectStore('dossiers').put(d);
      return opslag.klaar(tx);
    },
    bewaarAlle: function (lijst) {
      if (opslag.modus === 'ls') { try { lsSet(KEY_DOSSIERS, lijst); return Promise.resolve(true); } catch (e) { return Promise.reject(e); } }
      if (opslag.modus !== 'idb') return Promise.reject(new Error('geen opslag'));
      var tx = opslag.db.transaction('dossiers', 'readwrite');
      var st = tx.objectStore('dossiers');
      st.clear();
      lijst.forEach(function (d) { st.put(d); });
      return opslag.klaar(tx);
    },
    bewaarKV: function (k, v) {
      if (opslag.modus === 'ls') { try { lsSet(k === 'config' ? KEY_CONFIG : KEY_PREFS, v); return Promise.resolve(true); } catch (e) { return Promise.reject(e); } }
      if (opslag.modus !== 'idb') return Promise.reject(new Error('geen opslag'));
      var tx = opslag.db.transaction('kv', 'readwrite');
      if (v === null || v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
      return opslag.klaar(tx);
    }
  };

  function opslagFout(e) {
    state.opslagOk = false;
    updateSaveState();
    toast(e && e.name === 'QuotaExceededError' ? 'Opslag is vol. Verwijder foto’s of maak een back-up en verwijder oude dossiers.' : 'Opslaan lukt niet. Maak een back-up via “Back-up maken”.');
  }
  function opslagOk() { state.opslagOk = true; state.laatstOpgeslagen = new Date(); updateSaveState(); }
  function bewaarPrefs() { return opslag.bewaarKV('prefs', state.prefs).catch(opslagFout); }

  var state = {
    view: 'lijst',
    dossiers: [],
    huidigId: null,
    stap: 'klant',
    cfgOverride: null,
    cfg: null,
    prefs: {},
    filters: { q: '', uitkomst: '', modus: '', type: '' },
    open: {},          // geopende installatiekaarten / eisen
    rapportTab: 'fiche',
    gapFilter: '',
    laatstOpgeslagen: null,
    opslagOk: true
  };

  function zetConfig(override) {
    state.cfgOverride = override || null;
    state.cfg = E.mergeConfig(DEFAULT_CFG, state.cfgOverride || {});
  }
  /** Bewaart de volledige lijst (na toevoegen, verwijderen, importeren). */
  function bewaarDossiers() {
    clearTimeout(saveTimer); wachtend = {};
    return opslag.bewaarAlle(state.dossiers).then(opslagOk, opslagFout);
  }
  var saveTimer = null, wachtend = {};
  /** Bewaart het huidige dossier kort na een wijziging. */
  function planOpslaan(d) {
    d = d || huidig();
    if (!d) return;
    d.gewijzigd = new Date().toISOString();
    wachtend[d.id] = d;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(spoelOpslag, 400);
  }
  function spoelOpslag() {
    var lijst = Object.keys(wachtend).map(function (k) { return wachtend[k]; });
    wachtend = {};
    return Promise.all(lijst.map(function (d) { return opslag.bewaarDossier(d); })).then(opslagOk, opslagFout);
  }

  // ------------------------------------------------------------------ hulpfuncties

  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 9); }
  function vandaag() { return E.isoVandaag(); }
  function huidig() { return state.dossiers.filter(function (d) { return d.id === state.huidigId; })[0] || null; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function getPath(obj, path) {
    var segs = path.split('.'), o = obj;
    for (var i = 0; i < segs.length; i++) {
      if (o == null) return undefined;
      var m = segs[i].split('#');
      if (m.length === 2) o = (o[m[0]] || []).filter(function (x) { return x.id === m[1]; })[0];
      else o = o[segs[i]];
    }
    return o;
  }
  function setPath(obj, path, val) {
    var segs = path.split('.'), o = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      var m = segs[i].split('#');
      if (m.length === 2) { o = (o[m[0]] || (o[m[0]] = [])).filter(function (x) { return x.id === m[1]; })[0]; if (!o) return; }
      else { if (o[segs[i]] == null || typeof o[segs[i]] !== 'object') o[segs[i]] = {}; o = o[segs[i]]; }
    }
    o[segs[segs.length - 1]] = val;
  }

  // ------------------------------------------------------------------ formulierbouwstenen

  function v(d, path) { var x = getPath(d, path); return x == null ? '' : x; }
  function fld(d, label, path, opt) {
    opt = opt || {};
    if (opt.diep && d.modus !== 'diep') return '';
    var id = 'f_' + path.replace(/[^a-zA-Z0-9]/g, '_');
    var val = v(d, path);
    var attrs = ' id="' + id + '" data-path="' + esc(path) + '"' + (opt.rerender ? ' data-rerender="1"' : '') + (opt.placeholder ? ' placeholder="' + esc(opt.placeholder) + '"' : '');
    var ctl;
    if (opt.type === 'select') {
      ctl = '<select' + attrs + '><option value="">— kies —</option>' + opt.options.map(function (o) {
        var ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(ov) + '"' + (String(ov) === String(val) ? ' selected' : '') + '>' + esc(ol) + '</option>';
      }).join('') + '</select>';
    } else if (opt.type === 'textarea') {
      ctl = '<textarea' + attrs + '>' + esc(val) + '</textarea>';
    } else if (opt.type === 'kw' || opt.type === 'm2') {
      ctl = '<div class="unitinput"><input type="text" inputmode="decimal" autocomplete="off"' + attrs + ' value="' + esc(val) + '"><span>' + (opt.type === 'kw' ? 'kW' : 'm²') + '</span></div>';
    } else {
      ctl = '<input type="' + (opt.type || 'text') + '"' + attrs + ' value="' + esc(val) + '"' + (opt.type === 'text' || !opt.type ? ' autocomplete="off"' : '') + '>';
    }
    return '<div class="field' + (opt.full ? ' full' : '') + '"><label for="' + id + '"' + (opt.req ? ' class="req"' : '') + '>' + esc(label) + '</label>' + ctl + (opt.hint ? '<div class="hint">' + opt.hint + '</div>' : '') + '</div>';
  }
  function seg(d, path, options, opt) {
    opt = opt || {};
    var val = v(d, path);
    var name = 'r_' + path.replace(/[^a-zA-Z0-9]/g, '_');
    return '<div class="seg' + (opt.status ? ' status' : '') + '" role="radiogroup"' + (opt.label ? ' aria-label="' + esc(opt.label) + '"' : '') + '>' + options.map(function (o) {
      return '<label><input type="radio" name="' + name + '" value="' + esc(o[0]) + '" data-path="' + esc(path) + '"' + (opt.rerender ? ' data-rerender="1"' : '') + (String(val) === String(o[0]) ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div>';
  }
  function segFld(d, label, path, options, opt) {
    opt = opt || {};
    if (opt.diep && d.modus !== 'diep') return '';
    return '<div class="field' + (opt.full ? ' full' : '') + '"><span class="lbl' + (opt.req ? ' req' : '') + '">' + esc(label) + '</span>' + seg(d, path, options, { label: label, rerender: opt.rerender, status: opt.status }) + (opt.hint ? '<div class="hint">' + opt.hint + '</div>' : '') + '</div>';
  }
  var JNO = [['ja', 'Ja'], ['nee', 'Nee'], ['onbekend', 'Onbekend']];
  var JN = [['ja', 'Ja'], ['nee', 'Nee']];
  var STATUS5 = [['ja', 'Voldoet'], ['deels', 'Deels'], ['nee', 'Voldoet niet'], ['onbekend', 'Onbekend'], ['nvt', 'N.v.t.']];

  function bijlagen(d, path, compact) {
    if (d.modus !== 'diep') return '';
    var lijst = getPath(d, path) || [];
    return '<div class="field full"><span class="lbl">Foto’s en documenten</span><div class="att">' +
      lijst.map(function (b, i) {
        var thumb = b.dataUrl ? '<img src="' + esc(b.dataUrl) + '" alt="">' : '<span class="ic">' + esc((b.naam.split('.').pop() || 'doc').slice(0, 4).toUpperCase()) + '</span>';
        return '<span class="file">' + thumb + '<span class="nm" title="' + esc(b.naam) + '">' + esc(b.naam) + '</span><button class="btn ghost sm" data-act="del-bijlage" data-path="' + esc(path) + '" data-i="' + i + '" aria-label="Verwijder ' + esc(b.naam) + '">✕</button></span>';
      }).join('') +
      '<label class="btn sm">Foto nemen<input type="file" accept="image/*" capture="environment" data-upload="' + esc(path) + '"></label>' +
      '<label class="btn sm">+ ' + (compact ? 'Bijlage' : 'Foto of document') + '<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" data-upload="' + esc(path) + '"></label></div>' +
      (compact ? '' : '<div class="hint">Foto’s worden verkleind bewaard in dit dossier; van andere documenten wordt alleen de bestandsnaam vastgelegd.</div>') + '</div>';
  }

  function pill(cls, label) { return '<span class="pill p-' + esc(cls) + '">' + esc(label) + '</span>'; }

  // ------------------------------------------------------------------ nieuwe objecten

  function nieuwGebouw(n) {
    return {
      id: uid('g'), naam: 'Gebouw ' + n, type: '', bouwjaar: '', oppervlakte: '', geklimatiseerdeOppervlakte: '',
      nieuwBestaand: '', nietResidentieel: '', eigenaarGebouw: '', eigenaarInstallaties: '', gebruiker: '',
      heeftRuimteverwarming: '', heeftRuimtekoeling: '', heeftVentilatie: '',
      uitzondering: { ingeroepen: false, typeId: '', motivatie: '', bewijs: '', bijlagen: [] }, bijzondereSituaties: '', opmerkingen: ''
    };
  }
  function nieuwDossier(modus) {
    var now = new Date().toISOString();
    return {
      id: uid('d'), modus: modus, status: 'concept', aangemaakt: now, gewijzigd: now,
      klant: { naam: '', contactpersoon: '', contactEmail: '', contactTel: '' },
      site: { naam: '', adres: '' },
      bezoek: { datum: vandaag(), adviseur: state.prefs.adviseur || '' },
      opmerkingen: '', gebouwen: [nieuwGebouw(1)], structuur: [], groepen: [], verwarming: [], koeling: [],
      snelleChecklist: {}, screening: { methode: 'm1', aantalIAQSensoren: '', items: {} }
    };
  }
  function nieuweUnit(d, soort) {
    var n = (d[soort] || []).length + 1;
    var u = {
      id: uid(soort === 'verwarming' ? 'v' : 'k'), naam: (soort === 'verwarming' ? 'Warmteopwekker ' : 'Koelinstallatie ') + n, type: '', fabrikant: '', model: '', bouwjaar: '',
      vermogenKW: '', centraalLokaal: '', gebouwId: d.gebouwen.length === 1 ? d.gebouwen[0].id : '', locatieId: '', gekoppeld: '', groepId: '', ventilatie: '',
      regelsysteem: '', protocol: '', meetpunten: '', storingsinfo: '', bijlagen: [], opmerkingen: ''
    };
    if (soort === 'verwarming') { u.energiedrager = ''; u.hoofdverwarming = ''; }
    return u;
  }

  // ------------------------------------------------------------------ stappen

  var STAP_LABEL = {
    klant: 'Klant en gebouw', structuur: 'Structuur en groepen', verwarming: 'Verwarming', koeling: 'Koeling',
    beslissing: 'Beslissingsboom', uitzondering: 'Uitzonderingen', checklist: 'Korte checklist', screening: 'Technische screening',
    gaps: 'Gaps en actieplan', rapport: 'Rapport'
  };
  function stappen(d) {
    return d.modus === 'diep'
      ? ['klant', 'structuur', 'verwarming', 'koeling', 'beslissing', 'uitzondering', 'screening', 'gaps', 'rapport']
      : ['klant', 'structuur', 'verwarming', 'koeling', 'beslissing', 'checklist', 'rapport'];
  }
  function issueStap(i) {
    if (i.ref && i.ref.stap) return i.ref.stap;
    if (i.ref && i.ref.soort) return i.ref.groepId && i.code === 'LEGE_GROEP' ? 'structuur' : i.ref.soort;
    return 'klant';
  }

  // ------------------------------------------------------------------ hoofdrender

  function render() {
    $$('.nav button').forEach(function (b) { b.setAttribute('aria-current', b.dataset.view === (state.view === 'dossier' ? 'lijst' : state.view) ? 'page' : 'false'); });
    var main = $('#main');
    if (state.view === 'dossier' && huidig()) main.innerHTML = viewDossier();
    else if (state.view === 'beheer') main.innerHTML = viewBeheer();
    else if (state.view === 'bronnen') main.innerHTML = viewBronnen();
    else { state.view = 'lijst'; main.innerHTML = viewLijst(); }
    if (state.view === 'dossier') { refreshLive(); laadRapportPreview(); }
    if (state.view === 'beheer') vulOpslagInfo();
  }

  // ------------------------------------------------------------------ dossierlijst

  function viewLijst() {
    var cfg = state.cfg, f = state.filters;
    var rows = state.dossiers.map(function (d) { return { d: d, a: E.analyse(d, cfg, vandaag()) }; });
    var kpi = {
      tot: rows.length,
      plichtig: rows.filter(function (r) { return r.a.beslissing.uitkomst === E.UITKOMST.PLICHTIG; }).length,
      onv: rows.filter(function (r) { return r.a.beslissing.uitkomst === E.UITKOMST.ONVOLLEDIG; }).length,
      toek: rows.filter(function (r) { return r.a.beslissing.uitkomst !== E.UITKOMST.PLICHTIG && r.a.beslissing.toekomstPlichtig; }).length
    };
    var q = f.q.trim().toLowerCase();
    var gefilterd = rows.filter(function (r) {
      var d = r.d;
      if (f.uitkomst && r.a.beslissing.uitkomst !== f.uitkomst) return false;
      if (f.modus && d.modus !== f.modus) return false;
      if (f.type && !(d.gebouwen || []).some(function (g) { return g.type === f.type; })) return false;
      if (!q) return true;
      var hay = [d.klant && d.klant.naam, d.site && d.site.naam, d.site && d.site.adres, d.bezoek && d.bezoek.adviseur]
        .concat((d.gebouwen || []).map(function (g) { return g.naam + ' ' + g.type; })).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) { return String(b.d.gewijzigd).localeCompare(String(a.d.gewijzigd)); });

    var types = {};
    state.dossiers.forEach(function (d) { (d.gebouwen || []).forEach(function (g) { if (g.type) types[g.type] = 1; }); });

    var h = '<div class="wrap stack">' +
      '<div class="section-head"><div class="stack-sm"><div class="eyebrow">Klantendossiers</div><h1>Dossiers</h1></div>' +
      '<div class="btnrow"><button class="btn primary" data-act="nieuw" data-modus="snel">Nieuwe snelle screening</button>' +
      '<button class="btn primary" data-act="nieuw" data-modus="diep">Nieuwe dieptescreening</button>' +
      '<label class="btn">Dossier importeren<input type="file" accept="application/json,.json" data-import="dossier" hidden></label>' +
      '<button class="btn" data-act="backup">Back-up maken</button></div></div>' +
      (backupTeOud() ? '<div class="note warn section-head"><span>' + (state.prefs.laatsteBackup ? 'Je laatste back-up is van ' + new Date(state.prefs.laatsteBackup).toLocaleDateString('nl-BE') + '.' : 'Je hebt nog geen back-up gemaakt.') +
        ' Je dossiers staan alleen op dit toestel; bewaar regelmatig een back-up in Bestanden of iCloud Drive.</span><button class="btn primary sm" data-act="backup">Back-up maken</button></div>' : '') +
      '<div class="kpis">' +
      '<div class="kpi"><div class="k">Dossiers</div><div class="v">' + kpi.tot + '</div></div>' +
      '<div class="kpi warm"><div class="k">Potentieel plichtig</div><div class="v">' + kpi.plichtig + '</div></div>' +
      '<div class="kpi warn"><div class="k">Onvolledige gegevens</div><div class="v">' + kpi.onv + '</div></div>' +
      '<div class="kpi acc"><div class="k">Plichtig bij ' + cfg.drempels.toekomstig.kW + ' kW</div><div class="v">' + kpi.toek + '</div></div>' +
      '</div>' +
      '<div class="filters"><input class="inp search" type="search" id="flt-q" placeholder="Zoek op klant, site, adres, gebouw of adviseur" value="' + esc(f.q) + '" data-filter="q" aria-label="Zoeken">' +
      '<select class="inp" id="flt-u" data-filter="uitkomst" aria-label="Filter op uitkomst"><option value="">Alle uitkomsten</option>' +
      Object.keys(E.UITKOMST_LABEL).map(function (k) { return '<option value="' + k + '"' + (f.uitkomst === k ? ' selected' : '') + '>' + esc(E.UITKOMST_LABEL[k]) + '</option>'; }).join('') + '</select>' +
      '<select class="inp" id="flt-m" data-filter="modus" aria-label="Filter op modus"><option value="">Beide modi</option><option value="snel"' + (f.modus === 'snel' ? ' selected' : '') + '>Snelle screening</option><option value="diep"' + (f.modus === 'diep' ? ' selected' : '') + '>Dieptescreening</option></select>' +
      '<select class="inp" id="flt-t" data-filter="type" aria-label="Filter op gebouwtype"><option value="">Alle gebouwtypes</option>' + Object.keys(types).sort().map(function (t) { return '<option' + (f.type === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>';

    if (!gefilterd.length) {
      h += '<div class="panel empty">' + (rows.length ? 'Geen dossiers voor deze zoekopdracht.' : 'Nog geen dossiers. Start een snelle screening of laad de voorbeelden.') +
        '<div class="btnrow" style="justify-content:center;margin-top:12px"><button class="btn" data-act="voorbeelden">Voorbeelddossiers laden</button></div></div>';
    } else {
      h += '<div class="tablewrap"><table class="t"><thead><tr><th>Site en klant</th><th>Type</th><th>Bezoek</th><th>Modus</th><th>Uitkomst</th><th class="num">Verwarming</th><th class="num">Koeling</th><th>Aandacht</th><th></th></tr></thead><tbody>' +
        gefilterd.map(function (r) {
          var d = r.d, b = r.a.beslissing;
          var maxV = Math.max.apply(null, [0].concat(b.perGebouw.map(function (g) { return g.verwarming.maxKW; })));
          var maxK = Math.max.apply(null, [0].concat(b.perGebouw.map(function (g) { return g.koeling.maxKW; })));
          var fout = r.a.issues.filter(function (i) { return i.niveau === 'fout'; }).length;
          var w = r.a.issues.filter(function (i) { return i.niveau === 'waarschuwing'; }).length;
          return '<tr class="click" data-act="open" data-id="' + esc(d.id) + '"><td><strong>' + (esc(d.site && d.site.naam) || '<em>Naamloze site</em>') + '</strong>' + (d.voorbeeld ? ' <span class="tag">voorbeeld</span>' : '') + '<div class="sub">' + esc(d.klant && d.klant.naam) + (d.bezoek && d.bezoek.adviseur ? ' · ' + esc(d.bezoek.adviseur) : '') + '</div></td>' +
            '<td>' + esc((d.gebouwen || []).map(function (g) { return g.type; }).filter(Boolean).join(', ') || '—') + '<div class="sub">' + (d.gebouwen || []).length + ' gebouw(en)</div></td>' +
            '<td class="mono">' + E.fmtDatum(d.bezoek && d.bezoek.datum) + '</td>' +
            '<td>' + pill(d.modus, d.modus === 'diep' ? 'Diep' : 'Snel') + '</td>' +
            '<td>' + pill(b.uitkomst, b.label) + (b.toekomstPlichtig && b.uitkomst !== E.UITKOMST.PLICHTIG ? '<div class="sub">plichtig bij ' + state.cfg.drempels.toekomstig.kW + ' kW</div>' : '') + '</td>' +
            '<td class="num kw">' + E.fmtKW(maxV) + '</td><td class="num kw">' + E.fmtKW(maxK) + '</td>' +
            '<td>' + (fout ? pill('fout', fout + ' fout' + (fout > 1 ? 'en' : '')) + ' ' : '') + (w ? pill('waarschuwing', w + ' aandacht') : '') + (!fout && !w ? '<span class="muted small">—</span>' : '') + '</td>' +
            '<td class="num"><div class="btnrow" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn ghost sm" data-act="dup" data-id="' + esc(d.id) + '">Dupliceer</button><button class="btn ghost sm danger" data-act="del-dossier" data-id="' + esc(d.id) + '">Verwijder</button></div></td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<div class="section-head"><p class="small muted">De maximale vermogens zijn de grootste gekoppelde groep per soort. Dossiers worden alleen op dit toestel bewaard; gebruik een back-up om ze op een ander toestel te zetten.</p>' +
        (state.dossiers.some(function (d) { return d.voorbeeld; }) ? '<button class="btn ghost sm danger" data-act="del-voorbeelden">Voorbeelddossiers verwijderen</button>' : '') + '</div>';
    }
    h += '<div class="disclaimer">' + esc(cfg.disclaimer) + '</div></div>';
    return h;
  }

  // ------------------------------------------------------------------ dossierweergave

  function viewDossier() {
    var d = huidig();
    var st = stappen(d);
    if (st.indexOf(state.stap) < 0) state.stap = st[0];
    var idx = st.indexOf(state.stap);
    var h = '<div class="wrap">' +
      '<div class="dossier-head"><div class="ttl stack-sm"><div class="eyebrow">' + (d.modus === 'diep' ? 'Technische dieptescreening' : 'Snelle screening') + '</div>' +
      '<h1>' + (esc(d.site && d.site.naam) || 'Nieuwe screening') + '</h1><div class="muted small">' + esc(d.klant && d.klant.naam) + (d.site && d.site.adres ? ' · ' + esc(d.site.adres) : '') + '</div></div>' +
      '<div class="btnrow"><span class="savestate" id="savestate"></span>' +
      (d.modus === 'snel' ? '<button class="btn" data-act="naar-diep">Omzetten naar dieptescreening</button>' : '') +
      '<button class="btn" data-act="opslaan">Opslaan</button><button class="btn" data-act="export-dossier">Exporteer</button><button class="btn ghost" data-act="naar-lijst">← Dossiers</button></div></div>' +
      '<div class="layout"><nav class="stepper" aria-label="Stappen" data-live="stepper"></nav>' +
      '<section class="content stack" id="stepcontent">' + renderStap(d, state.stap) +
      '<div class="stepfoot">' + (idx > 0 ? '<button class="btn" data-act="stap" data-stap="' + st[idx - 1] + '">← ' + esc(STAP_LABEL[st[idx - 1]]) + '</button>' : '<span></span>') +
      (idx < st.length - 1 ? '<button class="btn primary" data-act="stap" data-stap="' + st[idx + 1] + '">' + esc(STAP_LABEL[st[idx + 1]]) + ' →</button>' : '') + '</div></section>' +
      '<aside class="rail" data-live="rail" aria-label="Live resultaat"></aside></div></div>';
    return h;
  }

  function renderStap(d, s) {
    switch (s) {
      case 'klant': return stapKlant(d);
      case 'structuur': return stapStructuur(d);
      case 'verwarming': return stapInventaris(d, 'verwarming');
      case 'koeling': return stapInventaris(d, 'koeling');
      case 'beslissing': return stapBeslissing(d);
      case 'uitzondering': return stapUitzondering(d);
      case 'checklist': return stapChecklist(d);
      case 'screening': return stapScreening(d);
      case 'gaps': return stapGaps(d);
      case 'rapport': return stapRapport(d);
    }
    return '';
  }

  // ---- stap 1
  function stapKlant(d) {
    var cfg = state.cfg;
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 1</div><h2>Klant en gebouw</h2><p class="muted small">Velden met * zijn nodig voor de toepasselijkheidsbeslissing.' + (d.modus === 'snel' ? ' In de snelle screening worden alleen de essentiële gegevens gevraagd.' : '') + '</p></div>';
    h += '<div class="panel"><div class="grid">' +
      fld(d, 'Klantnaam', 'klant.naam', { req: true }) +
      fld(d, 'Contactpersoon', 'klant.contactpersoon') +
      fld(d, 'E-mail contactpersoon', 'klant.contactEmail', { type: 'email', diep: true }) +
      fld(d, 'Telefoon contactpersoon', 'klant.contactTel', { type: 'tel', diep: true }) +
      fld(d, 'Naam gebouw of site', 'site.naam', { req: true }) +
      fld(d, 'Adres', 'site.adres') +
      fld(d, 'Datum plaatsbezoek', 'bezoek.datum', { type: 'date' }) +
      fld(d, 'Uitvoerende adviseur', 'bezoek.adviseur') +
      fld(d, 'Opmerkingen', 'opmerkingen', { type: 'textarea', full: true }) +
      '</div></div>';
    h += '<div class="section-head"><h3>Gebouwen en gebouwzones</h3><button class="btn" data-act="add-gebouw">+ Gebouw toevoegen</button></div>';
    d.gebouwen.forEach(function (g, i) {
      var p = 'gebouwen#' + g.id + '.';
      h += '<div class="panel"><div class="section-head" style="margin-bottom:12px"><div class="eyebrow">Gebouw ' + (i + 1) + '</div>' +
        (d.gebouwen.length > 1 ? '<button class="btn ghost sm danger" data-act="del-gebouw" data-id="' + esc(g.id) + '">Verwijder gebouw</button>' : '') + '</div><div class="grid">' +
        fld(d, 'Naam gebouw of zone', p + 'naam', { req: true }) +
        fld(d, 'Type gebouw', p + 'type', { type: 'select', options: cfg.gebouwtypes, req: true }) +
        segFld(d, 'Niet-residentieel gebouw?', p + 'nietResidentieel', JNO, { req: true }) +
        segFld(d, 'Nieuw of bestaand', p + 'nieuwBestaand', [['nieuw', 'Nieuw'], ['bestaand', 'Bestaand']], { req: true }) +
        fld(d, 'Bouwjaar (indien gekend)', p + 'bouwjaar', { diep: true, placeholder: 'bv. 1978' }) +
        fld(d, 'Bruikbare vloeroppervlakte', p + 'oppervlakte', { type: 'm2' }) +
        fld(d, 'Waarvan geklimatiseerd', p + 'geklimatiseerdeOppervlakte', { type: 'm2', diep: true, hint: 'Bepaalt het minimum aantal binnenklimaatsensoren (eis G).' }) +
        fld(d, 'Eigenaar gebouw', p + 'eigenaarGebouw', { diep: true }) +
        fld(d, 'Eigenaar of houder zakelijk recht van de technische installaties', p + 'eigenaarInstallaties', { req: true, hint: 'Hier ligt de verplichting. Bij casco-verhuur is dat vaak de huurder.' }) +
        fld(d, 'Gebruiker of huurder', p + 'gebruiker', { diep: true }) +
        '<div class="subhead">Aanwezige installaties</div>' +
        segFld(d, 'Ruimteverwarming', p + 'heeftRuimteverwarming', JNO) +
        segFld(d, 'Ruimtekoeling', p + 'heeftRuimtekoeling', JNO) +
        segFld(d, 'Ventilatie', p + 'heeftVentilatie', JNO) +
        fld(d, 'Opmerkingen bij dit gebouw', p + 'opmerkingen', { type: 'textarea', full: true, diep: true }) +
        '</div></div>';
    });
    return h;
  }

  // ---- stap 2
  function stapStructuur(d) {
    var cfg = state.cfg;
    var gebOpts = d.gebouwen.map(function (g) { return [g.id, g.naam || '(naamloos)']; });
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 2</div><h2>Gebouwstructuur en installatiegrenzen</h2>' +
      '<p class="muted small">Leg vast welke installaties hydraulisch of koeltechnisch met elkaar verbonden zijn. Alleen gekoppelde opwekkers worden samengeteld; niet automatisch alle opwekkers van de site.</p></div>';
    h += '<div class="note">' + esc(cfg.berekeningsregel) + '</div>';

    h += '<div class="section-head"><h3>Onderdelen van de site</h3><div class="btnrow">' + cfg.structuurSoorten.map(function (s) {
      return '<button class="btn sm" data-act="add-structuur" data-soort="' + s.id + '">+ ' + esc(s.label) + '</button>';
    }).join('') + '</div></div>';
    if (!d.structuur.length) h += '<div class="panel empty small">Nog geen onderdelen. Voeg bijvoorbeeld een stookplaats of koelcentrale toe; die kan je daarna aan installatiegroepen en opwekkers koppelen.</div>';
    else {
      h += '<div class="tablewrap"><table class="t"><thead><tr><th>Soort</th><th>Naam</th><th>Gebouw</th><th>Opmerking</th><th></th></tr></thead><tbody>' +
        d.structuur.map(function (s) {
          var p = 'structuur#' + s.id + '.';
          return '<tr><td style="min-width:150px"><select class="inp" data-path="' + p + 'soort" aria-label="Soort">' + cfg.structuurSoorten.map(function (o) { return '<option value="' + o.id + '"' + (o.id === s.soort ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></td>' +
            '<td style="min-width:160px"><input class="inp" type="text" data-path="' + p + 'naam" value="' + esc(s.naam) + '" aria-label="Naam"></td>' +
            '<td style="min-width:140px"><select class="inp" data-path="' + p + 'gebouwId" aria-label="Gebouw"><option value="">—</option>' + gebOpts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === s.gebouwId ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></td>' +
            '<td style="min-width:180px"><input class="inp" type="text" data-path="' + p + 'opmerkingen" value="' + esc(s.opmerkingen) + '" aria-label="Opmerking"></td>' +
            '<td class="num"><button class="btn ghost sm danger" data-act="del-structuur" data-id="' + esc(s.id) + '">Verwijder</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    ['verwarming', 'koeling'].forEach(function (soort) {
      var groepen = d.groepen.filter(function (g) { return g.soort === soort; });
      var locSoort = soort === 'verwarming' ? 'stookplaats' : 'koelcentrale';
      var locOpts = d.structuur.filter(function (s) { return s.soort === locSoort || s.soort === 'systeem'; }).map(function (s) { return [s.id, s.naam || '(naamloos)']; });
      h += '<div class="section-head"><h3>' + (soort === 'verwarming' ? 'Hydraulische kringen (verwarming)' : 'Koeltechnische kringen (koeling)') + '</h3><button class="btn sm" data-act="add-groep" data-soort="' + soort + '">+ Installatiegroep</button></div>';
      if (!groepen.length) { h += '<div class="panel empty small">Nog geen ' + (soort === 'verwarming' ? 'verwarmings' : 'koel') + 'groepen. Installaties zonder groep worden afzonderlijk beoordeeld.</div>'; return; }
      h += '<div class="groups">' + groepen.map(function (g) {
        var p = 'groepen#' + g.id + '.';
        var leden = (d[soort] || []).filter(function (u) { return u.groepId === g.id; });
        return '<div class="gcard"><div class="field"><label for="gn_' + g.id + '">Naam groep</label><input id="gn_' + g.id + '" class="inp" type="text" data-path="' + p + 'naam" value="' + esc(g.naam) + '"></div>' +
          '<div class="field"><span class="lbl">Bedient gebouw(en)</span><div class="btnrow">' + gebOpts.map(function (o) {
            return '<label class="check"><input type="checkbox" data-path="' + p + 'gebouwIds" data-multi="' + esc(o[0]) + '"' + ((g.gebouwIds || []).indexOf(o[0]) >= 0 ? ' checked' : '') + '>' + esc(o[1]) + '</label>';
          }).join('') + '</div></div>' +
          '<div class="field"><label for="gl_' + g.id + '">' + (soort === 'verwarming' ? 'Stookplaats' : 'Koelcentrale') + '</label><select id="gl_' + g.id + '" class="inp" data-path="' + p + 'locatieId"><option value="">—</option>' + locOpts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === g.locatieId ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="gb_' + g.id + '">Koppeling en bewijs</label><textarea id="gb_' + g.id + '" class="inp" data-path="' + p + 'beschrijving" placeholder="bv. gemeenschappelijke collector, zie hydraulisch schema">' + esc(g.beschrijving) + '</textarea></div>' +
          '<div class="units">' + (leden.length ? leden.length + ' installatie(s): ' + leden.map(function (u) { return esc(u.naam); }).join(', ') : 'Nog geen installaties toegewezen.') + '</div>' +
          '<div><button class="btn ghost sm danger" data-act="del-groep" data-id="' + esc(g.id) + '">Verwijder groep</button></div></div>';
      }).join('') + '</div>';
    });
    return h;
  }

  // ---- stap 3/4
  function stapInventaris(d, soort) {
    var cfg = state.cfg, warm = soort === 'verwarming';
    var lijst = d[soort] || [];
    var groepOpts = d.groepen.filter(function (g) { return g.soort === soort; }).map(function (g) { return [g.id, g.naam || '(naamloze groep)']; });
    var locSoort = warm ? 'stookplaats' : 'koelcentrale';
    var locOpts = d.structuur.filter(function (s) { return s.soort === locSoort || s.soort === 'systeem' || s.soort === 'gebouwdeel'; }).map(function (s) { return [s.id, s.naam || '(naamloos)']; });
    var gebOpts = d.gebouwen.map(function (g) { return [g.id, g.naam || '(naamloos)']; });
    var koppel = warm ? 'Hydraulisch gekoppeld aan andere warmteopwekkers?' : 'Koeltechnisch gekoppeld aan andere koelinstallaties?';
    var h = '<div class="stack-sm"><div class="eyebrow">Stap ' + (warm ? 3 : 4) + '</div><h2>Inventaris ' + (warm ? 'verwarming' : 'koeling') + '</h2>' +
      '<p class="muted small">' + (warm ? 'Voeg alle warmteopwekkers toe. Het vermogen wordt per hydraulisch gekoppelde groep opgeteld.' : 'Voeg alle koelinstallaties toe. Koeling wordt afzonderlijk van verwarming beoordeeld en nooit opgeteld.') + '</p></div>';
    h += '<div class="panel stack-sm" data-live="groepen-' + soort + '"></div>';
    h += '<div class="section-head"><h3>' + lijst.length + ' ' + (warm ? 'warmteopwekker(s)' : 'koelinstallatie(s)') + '</h3><button class="btn primary" data-act="add-unit" data-soort="' + soort + '">+ ' + (warm ? 'Warmteopwekker' : 'Koelinstallatie') + '</button></div>';
    if (!lijst.length) h += '<div class="panel empty">Nog geen ' + (warm ? 'warmteopwekkers' : 'koelinstallaties') + '.</div>';
    lijst.forEach(function (u) {
      var p = soort + '#' + u.id + '.';
      var open = state.open[u.id];
      h += '<details class="unit ' + (warm ? 'warm' : 'cool') + '" data-openkey="' + esc(u.id) + '"' + (open ? ' open' : '') + '><summary><span class="nm" data-unitsum="' + esc(u.id) + '"></span></summary><div class="body"><div class="grid">' +
        '<div class="subhead">Identificatie</div>' +
        fld(d, 'Identificatienaam', p + 'naam', { req: true }) +
        fld(d, warm ? 'Type installatie' : 'Type koelinstallatie', p + 'type', { type: 'select', options: warm ? cfg.verwarmingTypes : cfg.koelingTypes, req: true }) +
        fld(d, 'Fabrikant', p + 'fabrikant', { diep: true }) +
        fld(d, 'Model', p + 'model', { diep: true }) +
        fld(d, 'Bouwjaar', p + 'bouwjaar', { diep: true }) +
        (warm ? fld(d, 'Energiedrager', p + 'energiedrager', { type: 'select', options: cfg.energiedragers }) : '') +
        fld(d, warm ? 'Nominaal thermisch vermogen' : 'Nominaal thermisch koelvermogen', p + 'vermogenKW', { type: 'kw', req: true, hint: 'Van het typeplaatje of de technische fiche.' }) +
        '<div class="subhead">Installatiegrenzen</div>' +
        (gebOpts.length > 1 ? fld(d, 'Gebouw', p + 'gebouwId', { type: 'select', options: gebOpts, req: true }) : '') +
        (locOpts.length ? fld(d, warm ? 'Stookplaats / gebouwdeel' : 'Koelcentrale / gebouwdeel', p + 'locatieId', { type: 'select', options: locOpts }) : '') +
        segFld(d, koppel, p + 'gekoppeld', JNO, { req: true }) +
        '<div class="field"><label for="f_' + (p + 'groepId').replace(/[^a-zA-Z0-9]/g, '_') + '" class="req">' + (warm ? 'Hydraulische installatiegroep' : 'Koeltechnische installatiegroep') + '</label>' +
        '<select id="f_' + (p + 'groepId').replace(/[^a-zA-Z0-9]/g, '_') + '" data-path="' + p + 'groepId"><option value="">Geen groep (afzonderlijk)</option>' + groepOpts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === u.groepId ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' +
        '<button class="btn ghost sm" style="align-self:flex-start" data-act="groep-voor-unit" data-soort="' + soort + '" data-id="' + esc(u.id) + '">+ Nieuwe groep met deze installatie</button></div>' +
        (warm ? segFld(d, 'Hoofdverwarming', p + 'hoofdverwarming', JN, { req: true }) : '') +
        segFld(d, 'Werking', p + 'centraalLokaal', [['centraal', 'Centraal'], ['lokaal', 'Lokaal']]) +
        segFld(d, 'Gekoppeld aan ventilatie', p + 'ventilatie', JN, { diep: true }) +
        (d.modus === 'diep' ? '<div class="subhead">Regeling en data</div>' : '') +
        fld(d, 'Aanwezig regelsysteem', p + 'regelsysteem', { diep: true }) +
        fld(d, 'Communicatieprotocol', p + 'protocol', { type: 'select', options: cfg.protocollen, diep: true }) +
        fld(d, 'Beschikbare meetpunten', p + 'meetpunten', { diep: true, placeholder: 'bv. aanvoer/retour, energiemeter' }) +
        fld(d, 'Storings- of rendementsinformatie', p + 'storingsinfo', { diep: true }) +
        bijlagen(d, p + 'bijlagen') +
        fld(d, 'Opmerkingen', p + 'opmerkingen', { type: 'textarea', full: true, diep: true }) +
        '</div><div class="btnrow" style="margin-top:12px"><button class="btn sm" data-act="dup-unit" data-soort="' + soort + '" data-id="' + esc(u.id) + '">Dupliceer</button><button class="btn ghost sm danger" data-act="del-unit" data-soort="' + soort + '" data-id="' + esc(u.id) + '">Verwijder</button></div></div></details>';
    });
    return h;
  }

  function meter(kw, soort, compact) {
    var cfg = state.cfg, thr = cfg.drempels.huidig.kW, thrT = cfg.drempels.toekomstig.kW;
    var max = Math.max(thr * 1.3, kw * 1.08);
    var pct = function (x) { return Math.min(100, x / max * 100).toFixed(1) + '%'; };
    return '<div class="meter ' + (soort === 'verwarming' ? 'warm' : 'cool') + '">' +
      (compact ? '' : '') +
      '<div class="track" role="img" aria-label="' + E.fmtKW(kw) + ' ten opzichte van ' + thrT + ' en ' + thr + ' kW"><div class="fill" style="width:' + pct(kw) + '"></div><div class="mark t" style="left:' + pct(thrT) + '"></div><div class="mark" style="left:' + pct(thr) + '"></div></div>' +
      '<div class="scale"><span style="left:' + pct(thrT) + '">' + thrT + '</span><span style="left:' + pct(thr) + '">' + thr + ' kW</span></div></div>';
  }

  function groepenPaneel(a, soort) {
    var res = a.beslissing[soort];
    var thr = state.cfg.drempels.huidig.kW;
    var h = '<div class="section-head"><h3>Vermogen per ' + (soort === 'verwarming' ? 'hydraulisch' : 'koeltechnisch') + ' gekoppelde groep</h3>' +
      '<div class="totalline"><span>Totaal geïnstalleerd op de site <b>' + E.fmtKW(res.siteTotaalKW) + '</b></span><span>informatief, niet voor de toets</span></div></div>';
    if (!res.groepen.length) return h + '<p class="muted small">Nog geen installaties.</p>';
    h += '<div class="groups">' + res.groepen.map(function (g) {
      var st = g.totaalKW > thr ? pill('POTENTIEEL_PLICHTIG', '> ' + thr + ' kW') : pill('NIET_PLICHTIG_HUIDIG', '≤ ' + thr + ' kW');
      if (g.ontbrekend || g.ongeldig) st += ' ' + pill('onbekend', 'vermogen ontbreekt');
      if (g.onzekereKoppeling) st += ' ' + pill('onbekend', 'koppeling onzeker');
      return '<div class="gcard' + (g.virtueel ? ' virt' : '') + '"><div class="meter"><div class="top"><span>' + esc(g.naam) + '</span><b>' + E.fmtKW(g.totaalKW) + '</b></div></div>' + meter(g.totaalKW, soort) +
        '<div class="btnrow">' + st + '</div><div class="units">' + g.units.map(function (u) { return esc(u.naam || '(naamloos)') + ' <span class="mono">' + E.fmtKW(E.parseKW(u.vermogenKW)) + '</span>'; }).join(' · ') + (g.virtueel ? '<br>Niet in een groep: afzonderlijk beoordeeld.' : '') + '</div></div>';
    }).join('') + '</div>';
    return h;
  }

  // ---- stap 5
  var BRANCHES = {
    S1: { ja: 'Ja → verder', nee: 'Nee → buiten toepassing', onbekend: 'Onbekend → onvolledig' },
    S2: { ja: 'Ja → betrouwbare toets', onbekend: 'Nee → voorlopige toets' },
    S3: { ja: 'Ja → plichtig (verwarming)', nee: 'Nee → toets koeling', onbekend: 'Onzeker → niet uit te sluiten' },
    S4: { ja: 'Ja → plichtig (koeling)', nee: 'Nee → niet plichtig', onbekend: 'Onzeker → niet uit te sluiten' },
    S5: { ja: 'Ja → plichtig bij lagere drempel', nee: 'Nee', onbekend: 'Onzeker' },
    S6: { ja: 'Ja → beoordeling instantie', nee: 'Nee', onbekend: 'Onvolledig gestaafd' },
    S7: { ja: 'Ja → screening', nee: 'Nee' }
  };
  function boom(g) {
    function node(st, extra) {
      var br = BRANCHES[st.id] || {};
      return '<div class="tnode a-' + esc(st.antwoord) + (extra ? ' extra' : '') + '"><div class="num">' + st.id.slice(1) + '</div>' +
        '<div><div class="q">' + esc(st.vraag) + '</div><div class="why">' + esc(st.toelichting) + '</div></div>' +
        '<div class="branches">' + Object.keys(br).map(function (k) { return '<span class="br ' + k + (k === st.antwoord ? ' on' : '') + '">' + esc(br[k]) + '</span>'; }).join('') + '</div></div>';
    }
    var h = '<div class="tree">' + g.stappen.slice(0, 4).map(function (s) { return node(s); }).join('');
    h += '<div class="tnode outcome"><div class="num">=</div><div class="toutcome ' + g.uitkomst + '" style="grid-column:2 / -1"><div class="eyebrow">Uitkomst</div><div class="verdict-big ' + g.uitkomst + '">' + esc(g.label) +
      (g.basis.length ? ' — op basis van ' + esc(g.basis.join(' en ')) : '') + '</div><p class="small">' + esc(g.uitleg) + '</p>' +
      (g.voorlopig ? '<p class="small" style="color:var(--warn);margin-top:4px">Voorlopig: niet alle vermogens of koppelingen zijn gekend.</p>' : '') + '</div></div>';
    h += g.stappen.slice(4).map(function (s) { return node(s, true); }).join('') + '</div>';
    return h;
  }

  function stapBeslissing(d) {
    var a = E.analyse(d, state.cfg, vandaag()), cfg = state.cfg;
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 5</div><h2>Automatische beslissingsboom</h2>' +
      '<p class="muted small">De boom toetst elk gebouw afzonderlijk: eerst de bestemming, dan de grootste gekoppelde verwarmingsgroep en de grootste gekoppelde koelgroep, elk tegen de eigen drempel van meer dan ' + cfg.drempels.huidig.kW + ' kW.</p></div>';
    if (!a.beslissing.perGebouw.length) return h + '<div class="note bad">Registreer eerst een gebouw in stap 1.</div>';
    a.beslissing.perGebouw.forEach(function (g) {
      h += '<div class="panel stack"><div class="section-head"><h3>' + esc(g.gebouwNaam) + '</h3>' + pill(g.uitkomst, g.label) + '</div>' + boom(g) +
        '<div class="grid"><div class="stack-sm"><div class="meter"><div class="top"><span>Verwarming · grootste gekoppelde groep</span><b>' + E.fmtKW(g.verwarming.maxKW) + '</b></div></div>' + meter(g.verwarming.maxKW, 'verwarming') + '</div>' +
        '<div class="stack-sm"><div class="meter"><div class="top"><span>Koeling · grootste gekoppelde groep</span><b>' + E.fmtKW(g.koeling.maxKW) + '</b></div></div>' + meter(g.koeling.maxKW, 'koeling') + '</div></div>' +
        '<div class="note' + (g.toekomst.plichtig ? ' warn' : '') + '"><strong>Toekomstige drempel:</strong> ' +
        (g.toekomst.antwoord === 'ja' ? 'een gekoppelde groep overschrijdt ' + cfg.drempels.toekomstig.kW + ' kW (' + esc(g.toekomst.basis.join(' en ')) + '). De verplichting geldt dan uiterlijk vanaf ' + E.fmtDatum(cfg.drempels.toekomstig.deadline) + '.' :
          g.toekomst.antwoord === 'nee' ? 'geen gekoppelde groep boven ' + cfg.drempels.toekomstig.kW + ' kW.' : 'met de huidige gegevens niet uit te sluiten.') + '</div>' +
        (g.uitkomst === E.UITKOMST.PLICHTIG && g.termijnVerstreken ? '<div class="note bad">De wettelijke termijn van ' + E.fmtDatum(cfg.drempels.huidig.deadline) + ' is verstreken. Een BACS dat aan de eisen voldoet, is nu al vereist.</div>' : '') +
        '<p class="small muted">Verantwoordelijke: ' + (esc((d.gebouwen.filter(function (x) { return x.id === g.gebouwId; })[0] || {}).eigenaarInstallaties) || '<strong>nog vast te stellen</strong>') + '. ' + esc(cfg.verantwoordelijkheid) + '</p></div>';
    });
    if (a.beslissing.startScreening) {
      var volgende = d.modus === 'diep' ? 'screening' : 'checklist';
      h += '<div class="btnrow"><button class="btn primary" data-act="stap" data-stap="' + volgende + '">Start de technische screening →</button>' +
        (d.modus === 'snel' ? '<button class="btn" data-act="naar-diep">Volledige dieptescreening starten</button>' : '') + '</div>';
    }
    h += '<div class="disclaimer">Deze beslissing is een screening en geen definitieve juridische conformiteitsverklaring. ' + esc(cfg.disclaimer) + '</div>';
    return h;
  }

  // ---- stap uitzondering (diep)
  function stapUitzondering(d) {
    var cfg = state.cfg;
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 6</div><h2>Uitzonderingen en bijzondere situaties</h2>' +
      '<p class="muted small">Documenteer hier situaties die een uitzondering kunnen rechtvaardigen. De app kent nooit zelf een uitzondering toe: zonder motivering en bewijs blijft ze als onvolledig gemarkeerd, en ook met bewijs blijft de beoordeling bij de bevoegde instantie.</p></div>';
    h += cfg.uitzonderingen.map(function (u) { return '<div class="note"><strong>' + esc(u.titel) + '.</strong> ' + esc(u.toelichting) + '</div>'; }).join('');
    d.gebouwen.forEach(function (g) {
      var p = 'gebouwen#' + g.id + '.';
      var uz = E.uitzonderingStatus(g);
      g.uitzondering = g.uitzondering || { bijlagen: [] };
      h += '<div class="panel stack"><div class="section-head"><h3>' + esc(g.naam || 'Gebouw') + '</h3>' + pill(uz.status === 'ingeroepen-gestaafd' ? 'waarschuwing' : uz.status === 'ingeroepen-onvolledig' ? 'fout' : 'info', E.UITZONDERING_LABEL[uz.status]) + '</div>' +
        '<div class="grid">' + segFld(d, 'Ruimteverwarming', p + 'heeftRuimteverwarming', JNO, { rerender: true }) + segFld(d, 'Ruimtekoeling', p + 'heeftRuimtekoeling', JNO, { rerender: true }) + segFld(d, 'Ventilatie', p + 'heeftVentilatie', JNO, { rerender: true }) + '</div>' +
        (uz.kandidaat ? '<div class="note warn">Volgens de ingevulde gegevens heeft dit gebouw slechts één van de drie installaties. Dat kan op de uitzondering wijzen, maar moet gestaafd worden.</div>' : '') +
        '<label class="check"><input type="checkbox" data-path="' + p + 'uitzondering.ingeroepen" data-rerender="1"' + (g.uitzondering.ingeroepen ? ' checked' : '') + '> Uitzondering inroepen voor dit gebouw</label>';
      if (g.uitzondering.ingeroepen) {
        h += '<div class="grid">' + fld(d, 'Soort uitzondering', p + 'uitzondering.typeId', { type: 'select', options: cfg.uitzonderingen.map(function (x) { return [x.id, x.titel]; }), full: true }) +
          fld(d, 'Motivering', p + 'uitzondering.motivatie', { type: 'textarea', full: true, req: true, hint: 'Beschrijf waarom de verplichting technisch, functioneel of economisch niet haalbaar zou zijn.' }) +
          fld(d, 'Omschrijving bewijsstukken', p + 'uitzondering.bewijs', { full: true, req: true, placeholder: 'bv. technische plannen, inventaris, offertes' }) +
          bijlagen(d, p + 'uitzondering.bijlagen') + '</div>';
      }
      h += '<div class="grid">' + fld(d, 'Andere bijzondere situaties', p + 'bijzondereSituaties', { type: 'textarea', full: true, placeholder: 'bv. geplande afbraak, gedeelde installaties met derden, casco-verhuur' }) + '</div></div>';
    });
    return h;
  }

  // ---- snelle checklist
  function stapChecklist(d) {
    var cfg = state.cfg, a = E.analyse(d, cfg, vandaag());
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 6</div><h2>Korte checklist</h2><p class="muted small">Twaalf vragen die samen een eerste beeld geven van de eisen A tot G. Voor bewijsstukken en een volledige gapanalyse: zet het dossier om naar een dieptescreening.</p></div>';
    var eisById = {};
    cfg.eisen.forEach(function (e) { eisById[e.id] = e; });
    h += '<div class="panel">' + cfg.snelleChecklist.map(function (q) {
      var e = eisById[q.eis] || {};
      return '<div class="qrow"><span class="tag" title="' + esc(e.titel) + '">' + esc(q.eis) + '</span><div>' + esc(q.vraag) + (e.vanaf && vandaag() < e.vanaf ? ' <span class="muted small">(verplicht vanaf ' + E.fmtDatum(e.vanaf) + ')</span>' : '') + '</div>' +
        seg(d, 'snelleChecklist.' + q.id, [['ja', 'Ja'], ['deels', 'Deels'], ['nee', 'Nee'], ['onbekend', '?'], ['nvt', 'n.v.t.']], { status: true, label: q.vraag }) + '</div>';
    }).join('') + '</div>';
    h += '<div class="panel stack-sm" data-live="snelstatus"></div>';
    return h;
  }

  // ---- dieptescreening
  function relevantieHints(d) {
    var hints = {};
    var elek = (d.verwarming || []).filter(function (u) { return u.energiedrager === 'Elektriciteit' && u.centraalLokaal !== 'lokaal'; });
    if (elek.length) hints.A4 = 'Elektrische centrale opwekker(s) in de inventaris: ' + elek.map(function (u) { return u.naam; }).join(', ') + '.';
    var gasLoc = {};
    (d.verwarming || []).forEach(function (u) { if (u.energiedrager === 'Aardgas') gasLoc[u.locatieId || u.groepId || u.id] = 1; });
    if (Object.keys(gasLoc).length > 1) hints.A6 = 'Aardgas op ' + Object.keys(gasLoc).length + ' plaatsen in de inventaris: meting per stookplaats nodig.';
    var andere = (d.verwarming || []).filter(function (u) { return ['Stookolie', 'Biomassa', 'Andere'].indexOf(u.energiedrager) >= 0; });
    if (andere.length) hints.A7 = 'Andere brandstof in de inventaris: ' + andere.map(function (u) { return u.naam + ' (' + u.energiedrager + ')'; }).join(', ') + '.';
    if ((d.verwarming || []).some(function (u) { return u.energiedrager === 'Warmtenet' || u.type === 'Warmtenetaansluiting'; })) hints.A8 = 'Warmtenetaansluiting in de inventaris.';
    if ((d.verwarming || []).some(function (u) { return u.type === 'WKK'; })) hints.A3 = 'WKK in de inventaris: eigen elektriciteitsproductie meten.';
    if ((d.verwarming || []).length && (d.koeling || []).length) hints.D3 = 'Er zijn zowel verwarmings- als koelinstallaties: controleer per ruimte op gelijktijdig verwarmen en koelen.';
    var proto = {};
    (d.verwarming || []).concat(d.koeling || []).forEach(function (u) { if (u.protocol) proto[u.protocol] = 1; });
    if (Object.keys(proto).length) hints.B2 = 'Protocollen in de inventaris: ' + Object.keys(proto).join(', ') + '.';
    var nodig = E.vereisteSensoren(d);
    if (nodig !== null) hints.G4 = 'Minimum op basis van de geklimatiseerde oppervlakte: ' + nodig + ' meetpunt(en) (1 per 100 m²; in lokalen > 100 m² mag 1 per lokaal).';
    return hints;
  }

  function stapScreening(d) {
    var cfg = state.cfg, s = E.evaluateScreening(d, cfg, vandaag()), hints = relevantieHints(d);
    var q = d.snelleChecklist || {};
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 7</div><h2>Technische screening</h2><p class="muted small">' + esc(cfg.scopeToelichting) + '</p></div>';
    h += '<div class="panel stack-sm"><span class="lbl small muted" style="font-weight:600">Methode</span>' + seg(d, 'screening.methode', [['m1', cfg.methodes.m1.label], ['m2', cfg.methodes.m2.label]], { rerender: true, label: 'Methode' }) +
      '<div class="grid" style="margin-top:8px">' + fld(d, 'Aantal aanwezige binnenklimaatsensoren', 'screening.aantalIAQSensoren', { hint: s.vereisteSensoren !== null ? 'Vereist: ' + s.vereisteSensoren + ' (op basis van geklimatiseerde oppervlakte).' : 'Vul de geklimatiseerde oppervlakte in bij stap 1 om het minimum te berekenen.' }) + '</div></div>';
    s.eisen.forEach(function (e) {
      var open = state.open['eis-' + e.id] !== undefined ? state.open['eis-' + e.id] : e.id === s.eisen[0].id;
      var snel = cfg.snelleChecklist.filter(function (x) { return x.eis === e.id && q[x.id]; });
      h += '<details class="eis" data-openkey="eis-' + e.id + '"' + (open ? ' open' : '') + '><summary><span class="tag">' + esc(e.id) + '</span><h3>' + esc(e.titel) + '</h3>' +
        (e.toekomstig ? pill('info', 'verplicht vanaf ' + E.fmtDatum(e.vanaf)) : '') + '<span data-live="eis-' + e.id + '">' + pill(e.status, E.EIS_STATUS_LABEL[e.status]) + '</span></summary><div class="items">' +
        '<p class="small muted" style="padding-top:10px">' + esc(e.samenvatting) + (snel.length ? ' · Snelle checklist: ' + snel.map(function (x) { return x.id + ' = ' + (E.ITEM_STATUS_LABEL[q[x.id]] || q[x.id]).toLowerCase(); }).join(', ') : '') + '</p>' +
        e.items.map(function (it) {
          var p = 'screening.items.' + it.id + '.';
          return '<div class="item"><span class="tag">' + esc(it.id) + '</span><div>' + esc(it.tekst) + '</div>' +
            (hints[it.id] ? '<div class="hint2">' + esc(hints[it.id]) + '</div>' : '') +
            '<div class="ctrl"><div class="segwrap">' + seg(d, p + 'status', STATUS5, { status: true, label: it.id }) + '</div>' +
            '<input class="inp" type="text" data-path="' + p + 'bewijs" value="' + esc(it.bewijs) + '" placeholder="Bewijsstuk (bv. screenshot, fiche, meterlijst)" aria-label="Bewijs ' + esc(it.id) + '">' +
            '<input class="inp" type="text" data-path="' + p + 'opmerking" value="' + esc(it.opmerking) + '" placeholder="Opmerking of motivering n.v.t." aria-label="Opmerking ' + esc(it.id) + '">' +
            bijlagen(d, p + 'bijlagen', true) + '</div></div>';
        }).join('') + '</div></details>';
    });
    return h;
  }

  // ---- gaps
  function stapGaps(d) {
    var cfg = state.cfg, a = E.analyse(d, cfg, vandaag());
    var prios = ['hoog', 'verifiëren', 'middel', 'toekomst'];
    var g = state.gapFilter ? a.gaps.filter(function (x) { return x.prioriteit === state.gapFilter; }) : a.gaps;
    var h = '<div class="stack-sm"><div class="eyebrow">Stap 8</div><h2>Gapanalyse en actieplan</h2><p class="muted small">Elke vereiste die niet als “voldoet” of “n.v.t.” is beoordeeld, verschijnt hier met een voorgestelde oplossing. Onbekende punten komen eerst in de verificatiefase.</p></div>';
    // per eis
    var per = {};
    a.screening.eisen.forEach(function (e) { per[e.id] = { tot: e.items.length, ok: e.items.filter(function (i) { return i.status === 'ja' || i.status === 'nvt'; }).length, gap: e.items.filter(function (i) { return i.status === 'nee' || i.status === 'deels'; }).length }; });
    h += '<div class="panel stack-sm"><h3>Stand per eis</h3><div class="bars">' + a.screening.eisen.map(function (e) {
      var p = per[e.id], ver = p.tot - p.ok - p.gap;
      return '<div class="barrow"><span class="tag">' + esc(e.id) + '</span><div class="b" title="' + esc(e.titel) + '"><i style="width:' + (p.ok / p.tot * 100) + '%;background:var(--ok)"></i><i style="width:' + (p.gap / p.tot * 100) + '%;background:var(--bad)"></i><i style="width:' + (ver / p.tot * 100) + '%;background:var(--warn)"></i></div><span class="mono small">' + p.ok + '/' + p.tot + '</span></div>';
    }).join('') + '</div><div class="totalline small"><span><b style="color:var(--ok)">■</b> voldoet / n.v.t.</span><span><b style="color:var(--bad)">■</b> tekort</span><span><b style="color:var(--warn)">■</b> te verifiëren</span></div></div>';

    h += '<div class="section-head"><h3>' + a.gaps.length + ' tekortkoming(en)</h3><div class="btnrow"><button class="btn sm' + (!state.gapFilter ? ' primary' : '') + '" data-act="gapfilter" data-v="">Alle</button>' +
      prios.map(function (p) { var n = a.gaps.filter(function (x) { return x.prioriteit === p; }).length; return n ? '<button class="btn sm' + (state.gapFilter === p ? ' primary' : '') + '" data-act="gapfilter" data-v="' + p + '">' + p + ' (' + n + ')</button>' : ''; }).join('') + '</div></div>';
    if (!g.length) h += '<div class="panel empty">Geen tekortkomingen in deze selectie.</div>';
    else h += '<div class="tablewrap"><table class="t"><thead><tr><th>Item</th><th>Tekortkoming</th><th>Stand</th><th>Prioriteit</th><th>Voorgestelde oplossing</th></tr></thead><tbody>' +
      g.map(function (x) { return '<tr><td><span class="tag">' + esc(x.itemId.length > 6 ? x.eisId : x.itemId) + '</span></td><td>' + esc(x.tekst) + '</td><td>' + pill(x.status, E.ITEM_STATUS_LABEL[x.status] || x.status) + '</td><td>' + esc(x.prioriteit) + '</td><td class="small">' + esc(x.oplossing) + '</td></tr>'; }).join('') + '</tbody></table></div>';

    h += '<h3>Actieplan</h3><div class="panel stack">' + (a.actieplan.length ? a.actieplan.map(function (f) {
      return '<div class="phase"><h3>' + esc(f.label) + ' <span class="muted small mono">' + esc(f.termijn) + '</span></h3><ul>' + f.acties.map(function (x) { return '<li>' + esc(x.oplossing) + ' <span class="muted small">(' + esc(x.itemId.length > 6 ? x.eisId : x.itemId) + ')</span></li>'; }).join('') + '</ul></div>';
    }).join('') : '<p class="muted">Geen acties.</p>') +
      '<div class="phase"><h3>Algemene vervolgstappen</h3><ul>' + cfg.vervolgstappen.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ul></div></div>';
    return h;
  }

  // ---- rapport
  function stapRapport(d) {
    var inFrame = false;
    try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
    var h = '<div class="stack-sm"><div class="eyebrow">Stap ' + stappen(d).length + '</div><h2>Rapport</h2><p class="muted small">De klantenfiche vat de toepasselijkheid en de belangrijkste aandachtspunten samen. Het technisch rapport bevat de volledige inventaris, beslissingsboom, screening, gapanalyse en het actieplan.</p></div>';
    h += '<div class="tabs" role="tablist"><button role="tab" data-act="rtab" data-v="fiche" aria-selected="' + (state.rapportTab === 'fiche') + '">Korte klantenfiche</button><button role="tab" data-act="rtab" data-v="tech" aria-selected="' + (state.rapportTab === 'tech') + '">Uitgebreid technisch rapport</button></div>';
    h += '<div class="btnrow"><button class="btn primary" data-act="r-print">Afdrukken of opslaan als PDF</button><button class="btn" data-act="r-download">Bewaren of delen</button><button class="btn" data-act="r-copy">Kopieer HTML</button><button class="btn ghost" data-act="markeer-afgerond">' + (d.status === 'afgerond' ? 'Markeer als concept' : 'Markeer dossier als afgerond') + '</button></div>';
    if (inFrame) h += '<div class="note warn small">In deze ingesloten weergave kunnen downloaden en afdrukken geblokkeerd zijn. Gebruik in dat geval “Kopieer HTML” of open de app lokaal (zie README).</div>';
    h += '<iframe class="preview" id="rapportframe" title="Voorbeeld rapport" sandbox="allow-same-origin allow-modals"></iframe>';
    return h;
  }
  function rapportHtml(d) {
    return state.rapportTab === 'tech' ? E.renderTechnischRapport(d, state.cfg, vandaag()) : E.renderKlantenfiche(d, state.cfg, vandaag());
  }
  function laadRapportPreview() {
    var f = $('#rapportframe');
    if (f && huidig()) f.srcdoc = rapportHtml(huidig());
  }

  // ------------------------------------------------------------------ live bijwerken

  function refreshLive() {
    var d = huidig();
    if (!d) return;
    var cfg = state.cfg;
    var a = E.analyse(d, cfg, vandaag());
    var st = stappen(d);
    var perStap = {};
    a.issues.forEach(function (i) { var s = issueStap(i); if (!perStap[s] || i.niveau === 'fout') perStap[s] = perStap[s] === 'fout' ? 'fout' : i.niveau; });

    var stepper = $('[data-live="stepper"]');
    if (stepper) stepper.innerHTML = st.map(function (s, i) {
      var lvl = perStap[s];
      return '<button data-act="stap" data-stap="' + s + '"' + (s === state.stap ? ' aria-current="step"' : '') + '><span class="n">' + (i + 1) + '</span><span>' + esc(STAP_LABEL[s]) + '</span>' + (lvl && lvl !== 'info' ? '<span class="dot ' + lvl + '" title="' + (lvl === 'fout' ? 'Fout' : 'Aandacht') + '"></span>' : '<span></span>') + '</button>';
    }).join('');

    var rail = $('[data-live="rail"]');
    if (rail) {
      var b = a.beslissing;
      var h = '<div class="panel"><div class="eyebrow">Live resultaat</div><div class="verdict-big ' + b.uitkomst + '">' + esc(b.label) + '</div>' +
        '<p class="small muted">Voorlopige screening, geen conformiteitsverklaring.</p></div>';
      b.perGebouw.forEach(function (g) {
        h += '<div class="panel stack-sm">' + (b.perGebouw.length > 1 ? '<div class="section-head"><strong class="small">' + esc(g.gebouwNaam) + '</strong>' + pill(g.uitkomst, g.uitkomst === E.UITKOMST.PLICHTIG ? 'plichtig' : g.uitkomst === E.UITKOMST.NIET ? 'niet plichtig' : g.uitkomst === E.UITKOMST.ONVOLLEDIG ? 'onvolledig' : 'buiten') + '</div>' : '') +
          '<div class="meter"><div class="top"><span>Verwarming</span><b>' + E.fmtKW(g.verwarming.maxKW) + '</b></div></div>' + meter(g.verwarming.maxKW, 'verwarming') +
          '<div class="meter"><div class="top"><span>Koeling</span><b>' + E.fmtKW(g.koeling.maxKW) + '</b></div></div>' + meter(g.koeling.maxKW, 'koeling') +
          '<p class="small muted">Grootste gekoppelde groep per soort. ' + (g.toekomst.antwoord === 'ja' ? 'Boven ' + cfg.drempels.toekomstig.kW + ' kW: plichtig uiterlijk vanaf ' + E.fmtDatum(cfg.drempels.toekomstig.deadline) + '.' : '') + '</p></div>';
      });
      var fouten = a.issues.filter(function (i) { return i.niveau !== 'info'; });
      h += '<div class="panel stack-sm"><div class="section-head"><strong class="small">Ontbrekend of tegenstrijdig</strong><span class="mono small">' + fouten.length + '</span></div>' +
        (fouten.length ? '<ul class="small" style="margin:0;padding-left:16px;display:grid;gap:6px">' + fouten.slice(0, 6).map(function (i) {
          return '<li><button class="btn ghost sm" style="white-space:normal;text-align:left;padding:2px 4px" data-act="stap" data-stap="' + issueStap(i) + '"><span style="color:var(--' + (i.niveau === 'fout' ? 'bad' : 'warn') + ')">●</span> ' + esc(i.tekst) + '</button></li>';
        }).join('') + '</ul>' + (fouten.length > 6 ? '<p class="small muted">en ' + (fouten.length - 6) + ' meer (zie technisch rapport)</p>' : '') : '<p class="small muted">Geen problemen gevonden.</p>') + '</div>';
      rail.innerHTML = h;
    }

    ['verwarming', 'koeling'].forEach(function (s) {
      var el = $('[data-live="groepen-' + s + '"]');
      if (el) el.innerHTML = groepenPaneel(a, s);
    });
    $$('[data-unitsum]').forEach(function (el) {
      var id = el.getAttribute('data-unitsum');
      var u = (d.verwarming || []).concat(d.koeling || []).filter(function (x) { return x.id === id; })[0];
      if (!u) return;
      var grp = d.groepen.filter(function (g) { return g.id === u.groepId; })[0];
      var kw = E.parseKW(u.vermogenKW);
      el.parentNode.innerHTML = '<span class="nm" data-unitsum="' + esc(id) + '">' + esc(u.naam || '(naamloos)') + '</span>' +
        (u.type ? '<span class="muted small">' + esc(u.type) + '</span>' : '') +
        (grp ? '<span class="tag">' + esc(grp.naam) + '</span>' : '<span class="tag">afzonderlijk</span>') +
        (u.gekoppeld === 'ja' || u.gekoppeld === 'nee' ? '' : pill('onbekend', 'koppeling?')) +
        '<span class="kw mono">' + (kw === null ? '<span style="color:var(--warn)">kW ontbreekt</span>' : isNaN(kw) ? '<span style="color:var(--bad)">ongeldig</span>' : E.fmtKW(kw)) + '</span>';
    });
    var snel = $('[data-live="snelstatus"]');
    if (snel) {
      snel.innerHTML = '<h3>Indicatieve stand per eis</h3><div class="tablewrap"><table class="t"><tbody>' + a.screening.snelPerEis.map(function (e) {
        return '<tr><td style="width:44px"><span class="tag">' + e.id + '</span></td><td>' + esc(e.titel) + (e.toekomstig ? ' <span class="muted small">(toekomstig)</span>' : '') + '</td><td class="num">' + pill(e.status, E.EIS_STATUS_LABEL[e.status]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    a.screening.eisen.forEach(function (e) {
      var el = $('[data-live="eis-' + e.id + '"]');
      if (el) el.innerHTML = pill(e.status, E.EIS_STATUS_LABEL[e.status]);
    });
    updateSaveState();
  }
  function updateSaveState() {
    var el = $('#savestate');
    if (!el) return;
    if (!state.opslagOk) { el.textContent = 'Niet opgeslagen — exporteer als back-up'; el.style.color = 'var(--bad)'; return; }
    el.style.color = '';
    el.textContent = state.laatstOpgeslagen ? 'Opgeslagen ' + state.laatstOpgeslagen.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : 'Automatisch opslaan aan';
  }

  // ------------------------------------------------------------------ beheer

  function viewBeheer() {
    var c = state.cfg;
    var aangepast = !!state.cfgOverride;
    var num = function (label, id, val, hint) { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input class="inp" id="' + id + '" type="text" inputmode="decimal" value="' + esc(val) + '">' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>'; };
    var dat = function (label, id, val) { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input class="inp" id="' + id + '" type="date" value="' + esc(val) + '"></div>'; };
    return '<div class="wrap stack">' +
      '<div class="section-head"><div class="stack-sm"><div class="eyebrow">Beheer</div><h1>Wettelijke parameters</h1><p class="muted small">Wijzigingen gelden meteen voor alle dossiers in deze browser. ' + (aangepast ? '<strong>Aangepast ten opzichte van de standaard.</strong>' : 'Je gebruikt de standaardconfiguratie (' + esc(DEFAULT_CFG.configVersie) + ').') + '</p></div>' +
      '<div class="btnrow"><button class="btn" data-act="cfg-export">Exporteer configuratie</button><label class="btn">Importeer<input type="file" accept=".json,application/json" data-import="config" hidden></label><button class="btn danger" data-act="cfg-reset">Herstel standaard</button></div></div>' +
      '<div class="panel stack"><h2>Gegevens en back-up</h2>' +
      '<ul class="small" id="opslaginfo" style="margin:0;padding-left:18px;display:grid;gap:4px"><li>Opslag controleren…</li></ul>' +
      '<p class="small muted">Een back-up bevat alle dossiers (met foto’s) en je aangepaste parameters. Bewaar ze op iPad via “Bewaar in Bestanden” in iCloud Drive, zodat je ze bij verlies of een nieuw toestel kan terugzetten.</p>' +
      '<div class="btnrow"><button class="btn primary" data-act="backup">Back-up maken</button></div>' +
      '<div class="grid"><div class="field"><label for="restore-file">Back-up terugzetten</label><input type="file" id="restore-file" accept="application/json,.json"></div>' +
      '<div class="field"><span class="lbl">Werkwijze</span><div class="seg" role="radiogroup" aria-label="Werkwijze terugzetten">' +
      '<label><input type="radio" name="restore-mode" value="samenvoegen" checked><span>Samenvoegen</span></label><label><input type="radio" name="restore-mode" value="vervangen"><span>Alles vervangen</span></label></div>' +
      '<div class="hint">Samenvoegen houdt van elk dossier de meest recente versie. Vervangen wist eerst alle dossiers op dit toestel.</div></div></div>' +
      '<div class="btnrow"><button class="btn" data-act="restore">Terugzetten</button></div></div>' +
      '<div class="panel stack"><h2>Drempels en termijnen</h2><div class="grid">' +
      num('Huidige drempel (kW, strikt “meer dan”)', 'c-thr', c.drempels.huidig.kW) + dat('Huidige termijn', 'c-thrd', c.drempels.huidig.deadline) +
      num('Toekomstige drempel (kW)', 'c-thrt', c.drempels.toekomstig.kW) + dat('Toekomstige termijn (uiterlijk)', 'c-thrtd', c.drempels.toekomstig.deadline) +
      num('Kleine warmteopwekkers buiten scope A–D (kW)', 'c-klein', c.kleineVerwarmingKW, 'Alleen als ze niet in de hoofdverwarming voorzien.') +
      dat('Verlichtingseis (F) verplicht vanaf', 'c-f', c.verlichtingVerplichtVanaf) +
      '<div class="field"><label for="c-versie">Configuratieversie</label><input class="inp" id="c-versie" type="text" value="' + esc(c.configVersie) + '"></div>' +
      dat('Bronnen geraadpleegd op', 'c-ger', c.geraadpleegdOp) +
      '<div class="field full"><label for="c-disc">Disclaimer</label><textarea class="inp" id="c-disc">' + esc(c.disclaimer) + '</textarea></div>' +
      '<div class="field full"><label for="c-verant">Toelichting verantwoordelijkheid</label><textarea class="inp" id="c-verant">' + esc(c.verantwoordelijkheid) + '</textarea></div>' +
      '</div><div class="btnrow"><button class="btn primary" data-act="cfg-save-form">Parameters opslaan</button></div></div>' +
      '<div class="panel stack"><h2>Volledige configuratie</h2><p class="muted small">Technische eisen (A–G en hun items), toelichtingen, voorgestelde oplossingen, checklistvragen, fases, bronnen en keuzelijsten. Bewerk de JSON en sla op; de app controleert de structuur voor ze wordt toegepast.</p>' +
      '<textarea class="inp json" id="c-json" spellcheck="false" aria-label="Configuratie als JSON">' + esc(JSON.stringify(c, null, 2)) + '</textarea>' +
      '<div class="btnrow"><button class="btn primary" data-act="cfg-save-json">JSON valideren en opslaan</button><span class="small" id="c-json-msg"></span></div></div></div>';
  }
  function valideerConfig(c) {
    var fouten = [];
    function isNum(x) { return typeof x === 'number' && isFinite(x) && x >= 0; }
    function isDate(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x); }
    if (!c || typeof c !== 'object') return ['Geen geldig object.'];
    if (!c.drempels || !c.drempels.huidig || !isNum(c.drempels.huidig.kW)) fouten.push('drempels.huidig.kW moet een getal zijn.');
    if (!c.drempels || !c.drempels.toekomstig || !isNum(c.drempels.toekomstig.kW)) fouten.push('drempels.toekomstig.kW moet een getal zijn.');
    if (c.drempels && c.drempels.huidig && !isDate(c.drempels.huidig.deadline)) fouten.push('drempels.huidig.deadline moet JJJJ-MM-DD zijn.');
    if (c.drempels && c.drempels.toekomstig && !isDate(c.drempels.toekomstig.deadline)) fouten.push('drempels.toekomstig.deadline moet JJJJ-MM-DD zijn.');
    if (!Array.isArray(c.eisen) || !c.eisen.length) fouten.push('eisen moet een niet-lege lijst zijn.');
    else c.eisen.forEach(function (e, i) {
      if (!e.id || !e.titel || !Array.isArray(e.items)) fouten.push('eisen[' + i + '] mist id, titel of items.');
      else e.items.forEach(function (it, j) { if (!it.id || !it.tekst) fouten.push('eisen[' + i + '].items[' + j + '] mist id of tekst.'); });
    });
    if (!c.methodes || !c.methodes.m1 || !c.methodes.m2) fouten.push('methodes.m1 en methodes.m2 zijn verplicht.');
    if (!Array.isArray(c.snelleChecklist)) fouten.push('snelleChecklist moet een lijst zijn.');
    if (!Array.isArray(c.fases)) fouten.push('fases moet een lijst zijn.');
    if (!Array.isArray(c.bronnen)) fouten.push('bronnen moet een lijst zijn.');
    return fouten;
  }
  function pasConfigToe(c) {
    var f = valideerConfig(c);
    if (f.length) return f;
    zetConfig(c);
    opslag.bewaarKV('config', c).catch(opslagFout);
    return [];
  }

  // ------------------------------------------------------------------ bronnen

  function viewBronnen() {
    var c = state.cfg;
    return '<div class="wrap stack" style="max-width:860px">' +
      '<div class="stack-sm"><div class="eyebrow">Over deze tool</div><h1>Regels en bronnen</h1></div>' +
      '<div class="note warn">' + esc(c.disclaimer) + '</div>' +
      '<div class="panel stack-sm"><h2>Officiële bronnen</h2>' + c.bronnen.map(function (b) { return '<p><a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.titel) + '</a><br><span class="small muted mono" style="overflow-wrap:anywhere">' + esc(b.url) + '</span></p>'; }).join('') +
      '<p class="small muted">Regelgeving: ' + esc(c.regelgeving) + ' Geraadpleegd op ' + E.fmtDatum(c.geraadpleegdOp) + '.</p></div>' +
      '<div class="panel stack-sm"><h2>Toepassingsregels</h2><ul style="margin:0;padding-left:18px;display:grid;gap:6px">' +
      '<li>Niet-residentiële gebouwen (nieuw en bestaand) waarvan het nominale thermische vermogen van het verwarmingssysteem <em>of</em> het koelsysteem meer dan ' + c.drempels.huidig.kW + ' kW bedraagt. Termijn: ' + E.fmtDatum(c.drempels.huidig.deadline) + '.</li>' +
      '<li>' + esc(c.berekeningsregel) + '</li>' +
      '<li>De grens daalt uiterlijk op ' + E.fmtDatum(c.drempels.toekomstig.deadline) + ' naar meer dan ' + c.drempels.toekomstig.kW + ' kW.</li>' +
      '<li>' + esc(c.verantwoordelijkheid) + '</li>' +
      '<li>Uitzonderingen worden gedocumenteerd, maar nooit automatisch toegekend.</li></ul></div>' +
      '<div class="panel stack-sm"><h2>Technische vereisten</h2><p class="small muted">' + esc(c.methodes.m1.label) + ' of ' + esc(c.methodes.m2.label) + '.</p>' +
      c.eisen.map(function (e) { return '<div class="qrow"><span class="tag">' + esc(e.id) + '</span><div><strong>' + esc(e.titel) + '</strong><div class="small muted">' + esc(e.samenvatting) + '</div></div><span class="mono small muted">' + e.items.length + ' items</span></div>'; }).join('') + '</div></div>';
  }

  // ------------------------------------------------------------------ acties

  function download(naam, inhoud, type) {
    try {
      var blob = new Blob([inhoud], { type: type });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = naam;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { toast('Downloaden lukt hier niet. Gebruik “Kopieer”.'); }
  }
  function kopieer(tekst) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tekst).then(function () { toast('Gekopieerd naar het klembord.'); }, function () { toast('Kopiëren werd geweigerd door de browser.'); });
    } else toast('Kopiëren is niet beschikbaar in deze browser.');
  }
  function bestandsnaam(d, suffix) {
    var base = ((d.site && d.site.naam) || (d.klant && d.klant.naam) || 'dossier').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'bacs-' + base + '-' + suffix;
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var d = huidig();
    switch (act) {
      case 'nav': state.view = el.dataset.view; render(); window.scrollTo(0, 0); return;
      case 'nieuw': {
        var nd = nieuwDossier(el.dataset.modus);
        state.dossiers.unshift(nd); bewaarDossiers();
        state.huidigId = nd.id; state.stap = 'klant'; state.view = 'dossier'; render(); window.scrollTo(0, 0); return;
      }
      case 'open': if (e.target.closest('button') && e.target.closest('button') !== el) return;
        state.huidigId = el.dataset.id; state.stap = 'klant'; state.view = 'dossier'; render(); window.scrollTo(0, 0); return;
      case 'dup': {
        e.stopPropagation();
        var src = state.dossiers.filter(function (x) { return x.id === el.dataset.id; })[0];
        var cp = JSON.parse(JSON.stringify(src));
        cp.id = uid('d'); cp.voorbeeld = false; cp.site = cp.site || {}; cp.site.naam = (cp.site.naam || 'Dossier') + ' (kopie)';
        cp.aangemaakt = cp.gewijzigd = new Date().toISOString();
        state.dossiers.unshift(cp); bewaarDossiers(); render(); toast('Dossier gedupliceerd.'); return;
      }
      case 'del-dossier': {
        e.stopPropagation();
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Bevestig verwijderen'; setTimeout(function () { if (el.isConnected) { el.dataset.confirm = ''; el.textContent = 'Verwijder'; } }, 4000); return; }
        state.dossiers = state.dossiers.filter(function (x) { return x.id !== el.dataset.id; }); bewaarDossiers(); render(); toast('Dossier verwijderd.'); return;
      }
      case 'voorbeelden': {
        var ids = state.dossiers.map(function (x) { return x.id; });
        SAMPLES.alle().forEach(function (s) { if (ids.indexOf(s.id) < 0) state.dossiers.push(s); });
        bewaarDossiers(); render(); toast('Voorbeelddossiers geladen.'); return;
      }
      case 'backup': spoelOpslag(); maakBackup(); return;
      case 'restore': {
        var vervang = ($('input[name="restore-mode"]:checked') || {}).value === 'vervangen';
        if (vervang && el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.classList.add('danger'); el.textContent = 'Bevestig: alles vervangen'; return; }
        terugzetten(); return;
      }
      case 'del-voorbeelden': {
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Bevestig verwijderen voorbeelden'; return; }
        state.dossiers = state.dossiers.filter(function (x) { return !x.voorbeeld; }); bewaarDossiers(); render(); toast('Voorbeelddossiers verwijderd.'); return;
      }
      case 'naar-lijst': state.view = 'lijst'; render(); window.scrollTo(0, 0); return;
      case 'stap': state.stap = el.dataset.stap; render(); window.scrollTo(0, 0); return;
      case 'opslaan': bewaarDossiers().then(function () { toast(state.opslagOk ? 'Dossier opgeslagen.' : 'Opslaan mislukt.'); }); return;
      case 'naar-diep': d.modus = 'diep'; planOpslaan(); render(); toast('Omgezet naar dieptescreening. De extra velden zijn nu zichtbaar.'); return;
      case 'export-dossier': deelBestand(bestandsnaam(d, 'dossier.json'), JSON.stringify(d, null, 2), 'application/json'); return;
      case 'add-gebouw': d.gebouwen.push(nieuwGebouw(d.gebouwen.length + 1)); planOpslaan(); render(); return;
      case 'del-gebouw': {
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Bevestig'; return; }
        d.gebouwen = d.gebouwen.filter(function (g) { return g.id !== el.dataset.id; }); planOpslaan(); render(); return;
      }
      case 'add-structuur': d.structuur.push({ id: uid('s'), soort: el.dataset.soort, naam: '', gebouwId: d.gebouwen.length === 1 ? d.gebouwen[0].id : '', opmerkingen: '' }); planOpslaan(); render(); return;
      case 'del-structuur': d.structuur = d.structuur.filter(function (s) { return s.id !== el.dataset.id; }); planOpslaan(); render(); return;
      case 'add-groep': {
        var n = d.groepen.filter(function (g) { return g.soort === el.dataset.soort; }).length + 1;
        d.groepen.push({ id: uid('grp'), soort: el.dataset.soort, naam: (el.dataset.soort === 'verwarming' ? 'Verwarmingsgroep ' : 'Koelgroep ') + n, gebouwIds: d.gebouwen.length === 1 ? [d.gebouwen[0].id] : [], locatieId: '', beschrijving: '' });
        planOpslaan(); render(); return;
      }
      case 'del-groep': {
        d.groepen = d.groepen.filter(function (g) { return g.id !== el.dataset.id; });
        ['verwarming', 'koeling'].forEach(function (s) { (d[s] || []).forEach(function (u) { if (u.groepId === el.dataset.id) u.groepId = ''; }); });
        planOpslaan(); render(); return;
      }
      case 'groep-voor-unit': {
        var u = d[el.dataset.soort].filter(function (x) { return x.id === el.dataset.id; })[0];
        var nn = d.groepen.filter(function (g) { return g.soort === el.dataset.soort; }).length + 1;
        var grp = { id: uid('grp'), soort: el.dataset.soort, naam: (el.dataset.soort === 'verwarming' ? 'Verwarmingsgroep ' : 'Koelgroep ') + nn, gebouwIds: u.gebouwId ? [u.gebouwId] : [], locatieId: u.locatieId || '', beschrijving: '' };
        d.groepen.push(grp); u.groepId = grp.id; if (!u.gekoppeld) u.gekoppeld = 'ja';
        state.open[u.id] = true; planOpslaan(); render(); toast('Groep “' + grp.naam + '” aangemaakt.'); return;
      }
      case 'add-unit': {
        var nu = nieuweUnit(d, el.dataset.soort);
        d[el.dataset.soort].push(nu); state.open[nu.id] = true; planOpslaan(); render();
        var f = document.getElementById('f_' + (el.dataset.soort + '#' + nu.id + '.naam').replace(/[^a-zA-Z0-9]/g, '_'));
        if (f) { f.focus(); f.select(); f.scrollIntoView({ block: 'center' }); }
        return;
      }
      case 'dup-unit': {
        var orig = d[el.dataset.soort].filter(function (x) { return x.id === el.dataset.id; })[0];
        var c = JSON.parse(JSON.stringify(orig)); c.id = uid(el.dataset.soort === 'verwarming' ? 'v' : 'k'); c.naam = orig.naam + ' (kopie)';
        d[el.dataset.soort].splice(d[el.dataset.soort].indexOf(orig) + 1, 0, c); state.open[c.id] = true; planOpslaan(); render(); return;
      }
      case 'del-unit': {
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Bevestig verwijderen'; return; }
        d[el.dataset.soort] = d[el.dataset.soort].filter(function (x) { return x.id !== el.dataset.id; }); planOpslaan(); render(); return;
      }
      case 'del-bijlage': {
        var lijst = getPath(d, el.dataset.path) || [];
        lijst.splice(Number(el.dataset.i), 1); setPath(d, el.dataset.path, lijst); planOpslaan(); rerenderStap(); return;
      }
      case 'gapfilter': state.gapFilter = el.dataset.v; rerenderStap(); return;
      case 'rtab': state.rapportTab = el.dataset.v; rerenderStap(); return;
      case 'r-download': deelBestand(bestandsnaam(d, state.rapportTab === 'tech' ? 'technisch-rapport.html' : 'klantenfiche.html'), rapportHtml(d), 'text/html'); return;
      case 'r-print': {
        var fr = $('#rapportframe');
        var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        try {
          if (ios) {
            // iPad/iPhone: het hoofdvenster afdrukken met enkel het rapport zichtbaar, op volle lengte.
            var hoogte = fr.contentDocument.documentElement.scrollHeight;
            var oud = fr.style.height;
            fr.style.height = hoogte + 'px';
            document.body.classList.add('print-rapport');
            setTimeout(function () {
              window.print();
              setTimeout(function () { document.body.classList.remove('print-rapport'); fr.style.height = oud; }, 500);
            }, 50);
          } else { fr.contentWindow.focus(); fr.contentWindow.print(); }
        } catch (x) { toast('Afdrukken lukt hier niet. Gebruik “Bewaren of delen” en druk af vanuit Bestanden of Safari.'); }
        return;
      }
      case 'r-copy': kopieer(rapportHtml(d)); return;
      case 'markeer-afgerond': d.status = d.status === 'afgerond' ? 'concept' : 'afgerond'; planOpslaan(); rerenderStap(); toast(d.status === 'afgerond' ? 'Dossier gemarkeerd als afgerond.' : 'Dossier terug in concept.'); return;
      case 'cfg-save-form': {
        var c2 = JSON.parse(JSON.stringify(state.cfg));
        var pn = function (id) { return E.parseKW($('#' + id).value); };
        c2.drempels.huidig.kW = pn('c-thr'); c2.drempels.huidig.deadline = $('#c-thrd').value;
        c2.drempels.toekomstig.kW = pn('c-thrt'); c2.drempels.toekomstig.deadline = $('#c-thrtd').value;
        c2.kleineVerwarmingKW = pn('c-klein'); c2.verlichtingVerplichtVanaf = $('#c-f').value;
        c2.configVersie = $('#c-versie').value; c2.geraadpleegdOp = $('#c-ger').value;
        c2.disclaimer = $('#c-disc').value; c2.verantwoordelijkheid = $('#c-verant').value;
        (c2.eisen || []).forEach(function (eis) { if (eis.id === 'F') eis.vanaf = c2.verlichtingVerplichtVanaf; });
        var fouten = pasConfigToe(c2);
        if (fouten.length) toast(fouten[0]); else { render(); toast('Parameters opgeslagen.'); }
        return;
      }
      case 'cfg-save-json': {
        var msg = $('#c-json-msg'), parsed;
        try { parsed = JSON.parse($('#c-json').value); } catch (x) { msg.textContent = 'Geen geldige JSON: ' + x.message; msg.style.color = 'var(--bad)'; return; }
        var fj = pasConfigToe(parsed);
        if (fj.length) { msg.textContent = fj.join(' '); msg.style.color = 'var(--bad)'; return; }
        render(); toast('Configuratie opgeslagen.'); return;
      }
      case 'cfg-reset': {
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Bevestig herstel'; return; }
        opslag.bewaarKV('config', null).catch(opslagFout);
        zetConfig(null); render(); toast('Standaardconfiguratie hersteld.'); return;
      }
      case 'cfg-export': download('bacs-configuratie-' + (state.cfg.configVersie || 'export') + '.json', JSON.stringify(state.cfg, null, 2), 'application/json'); return;
    }
  }

  function rerenderStap() {
    var sc = window.scrollY;
    render();
    window.scrollTo(0, sc);
  }

  function onInput(e) {
    var t = e.target;
    if (t.dataset.filter) {
      state.filters[t.dataset.filter] = t.value;
      if (t.dataset.filter === 'q') {
        var pos = t.selectionStart; render();
        var n = $('#flt-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* */ } }
      }
      return;
    }
    if (!t.dataset.path || t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    var d = huidig(); if (!d) return;
    setPath(d, t.dataset.path, t.value);
    if (t.dataset.path === 'bezoek.adviseur') { state.prefs.adviseur = t.value; clearTimeout(onInput._p); onInput._p = setTimeout(bewaarPrefs, 800); }
    planOpslaan();
    clearTimeout(onInput._t); onInput._t = setTimeout(refreshLive, 150);
  }

  function onChange(e) {
    var t = e.target;
    if (t.dataset.filter) { state.filters[t.dataset.filter] = t.value; render(); return; }
    if (t.dataset.import) { importeer(t); return; }
    if (t.dataset.upload) { upload(t); return; }
    if (!t.dataset.path) return;
    var d = huidig(); if (!d) return;
    if (t.type === 'radio' || t.tagName === 'SELECT') setPath(d, t.dataset.path, t.value);
    else if (t.type === 'checkbox' && t.dataset.multi) {
      var arr = (getPath(d, t.dataset.path) || []).slice();
      var i = arr.indexOf(t.dataset.multi);
      if (t.checked && i < 0) arr.push(t.dataset.multi);
      if (!t.checked && i >= 0) arr.splice(i, 1);
      setPath(d, t.dataset.path, arr);
    } else if (t.type === 'checkbox') setPath(d, t.dataset.path, t.checked);
    else return; // tekstvelden zijn al bijgewerkt via input
    planOpslaan();
    if (t.dataset.rerender) rerenderStap(); else refreshLive();
  }

  function leesJsonBestand(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return Promise.resolve(null);
    return new Promise(function (res) {
      var r = new FileReader();
      r.onload = function () {
        try { res(JSON.parse(r.result)); } catch (x) { toast('Dit bestand is geen geldige JSON.'); res(null); }
      };
      r.onerror = function () { toast('Het bestand kon niet gelezen worden.'); res(null); };
      r.readAsText(file);
    });
  }
  function normaliseerDossier(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.gebouwen)) return null;
    ['structuur', 'groepen', 'verwarming', 'koeling'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    d.screening = d.screening || { methode: 'm1', items: {} }; d.screening.items = d.screening.items || {};
    d.snelleChecklist = d.snelleChecklist || {};
    d.modus = d.modus === 'diep' ? 'diep' : 'snel';
    d.klant = d.klant || {}; d.site = d.site || {}; d.bezoek = d.bezoek || {};
    if (!d.id) d.id = uid('d');
    return d;
  }
  /** Haalt dossiers en configuratie uit een back-up, één dossier of een lijst dossiers. */
  function interpreteerImport(data) {
    if (data && data.formaat === BACKUP_FORMAAT) {
      return { dossiers: (data.dossiers || []).map(normaliseerDossier).filter(Boolean), config: data.configuratie || null, isBackup: true, gemaakt: data.gemaakt };
    }
    var lijst = Array.isArray(data) ? data : [data];
    return { dossiers: lijst.map(normaliseerDossier).filter(Boolean), config: null, isBackup: false };
  }
  /** Voegt dossiers toe. Bij samenvoegen wint de meest recent gewijzigde versie van hetzelfde dossier. */
  function voegSamen(nieuw) {
    var n = 0;
    nieuw.forEach(function (d) {
      var i = -1;
      state.dossiers.forEach(function (x, j) { if (x.id === d.id) i = j; });
      if (i < 0) { state.dossiers.unshift(d); n++; }
      else if (String(d.gewijzigd || '') > String(state.dossiers[i].gewijzigd || '')) { state.dossiers[i] = d; n++; }
    });
    return n;
  }

  function importeer(input) {
    leesJsonBestand(input).then(function (data) {
      if (!data) return;
      if (input.dataset.import === 'config') {
        var f = pasConfigToe(data.formaat === BACKUP_FORMAAT ? data.configuratie : data);
        if (f.length) toast('Configuratie niet geïmporteerd: ' + f[0]); else { render(); toast('Configuratie geïmporteerd.'); }
        return;
      }
      var imp = interpreteerImport(data);
      var n = voegSamen(imp.dossiers);
      bewaarDossiers(); render();
      toast(imp.dossiers.length ? n + ' dossier(s) toegevoegd of bijgewerkt.' : 'Geen geldig dossier gevonden in dit bestand.');
    });
  }

  function terugzetten() {
    var input = $('#restore-file');
    var vervangen = ($('input[name="restore-mode"]:checked') || {}).value === 'vervangen';
    if (!input || !input.files || !input.files[0]) { toast('Kies eerst een back-upbestand.'); return; }
    leesJsonBestand(input).then(function (data) {
      if (!data) return;
      var imp = interpreteerImport(data);
      if (!imp.dossiers.length && !imp.config) { toast('In dit bestand staan geen dossiers.'); return; }
      var n;
      if (vervangen) { state.dossiers = imp.dossiers; n = imp.dossiers.length; }
      else n = voegSamen(imp.dossiers);
      if (imp.config && valideerConfig(imp.config).length === 0) { zetConfig(imp.config); opslag.bewaarKV('config', imp.config).catch(opslagFout); }
      bewaarDossiers().then(function () {
        render();
        toast((vervangen ? 'Back-up teruggezet: ' : 'Samengevoegd: ') + n + ' dossier(s)' + (imp.gemaakt ? ' (back-up van ' + new Date(imp.gemaakt).toLocaleDateString('nl-BE') + ')' : '') + '.');
      });
    });
  }

  /** Bied een bestand aan: op iPad via het deelvenster (Bewaar in Bestanden, AirDrop, mail), anders als download. */
  function deelBestand(naam, inhoud, type) {
    try {
      var file = new File([inhoud], naam, { type: type });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: naam }).then(function () { return true; }, function (e) {
          if (e && e.name === 'AbortError') return false;
          download(naam, inhoud, type); return true;
        });
      }
    } catch (e) { /* terugval hieronder */ }
    download(naam, inhoud, type);
    return Promise.resolve(true);
  }

  function maakBackup() {
    var data = { formaat: BACKUP_FORMAAT, versie: 1, app: 'BACS-screening', gemaakt: new Date().toISOString(), configuratie: state.cfgOverride, dossiers: state.dossiers };
    deelBestand('bacs-backup-' + vandaag() + '.json', JSON.stringify(data), 'application/json').then(function (ok) {
      if (!ok) return;
      state.prefs.laatsteBackup = new Date().toISOString();
      bewaarPrefs(); render(); toast('Back-up gemaakt.');
    });
  }
  function backupTeOud() {
    if (!state.dossiers.some(function (d) { return !d.voorbeeld; })) return false;
    if (!state.prefs.laatsteBackup) return true;
    return (Date.now() - new Date(state.prefs.laatsteBackup).getTime()) / 864e5 > BACKUP_HERINNERING_DAGEN;
  }

  function vulOpslagInfo() {
    var el = $('#opslaginfo');
    if (!el) return;
    var regels = ['Opslag: <strong>' + (opslag.modus === 'idb' ? 'IndexedDB op dit toestel' : opslag.modus === 'ls' ? 'browseropslag (beperkt)' : 'niet beschikbaar') + '</strong>'];
    var sm = navigator.storage;
    var p1 = sm && sm.persisted ? sm.persisted().catch(function () { return null; }) : Promise.resolve(null);
    var p2 = sm && sm.estimate ? sm.estimate().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([p1, p2]).then(function (r) {
      regels.push('Blijvende opslag: ' + (r[0] === true ? '<strong style="color:var(--ok)">toegekend</strong>' : r[0] === false ? '<strong style="color:var(--warn)">niet toegekend</strong> — open de app via het icoon op je beginscherm en maak regelmatig een back-up' : 'onbekend'));
      if (r[1] && r[1].usage !== undefined) regels.push('In gebruik: ' + (r[1].usage / 1048576).toFixed(1) + ' MB');
      regels.push('Laatste back-up: ' + (state.prefs.laatsteBackup ? new Date(state.prefs.laatsteBackup).toLocaleString('nl-BE') : '<strong>nog nooit</strong>'));
      regels.push('Weergave: ' + (isStandalone() ? 'geïnstalleerde app' : 'browsertabblad'));
      if (el.isConnected) el.innerHTML = regels.map(function (x) { return '<li>' + x + '</li>'; }).join('');
    });
  }
  function isStandalone() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ service worker (offline + updates)

  var swHerladen = false;
  function registreerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    try {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        function toonUpdate(w) {
          var bar = $('#updatebar');
          if (!bar || !w || !reg.active || reg.active === w) return;
          bar.hidden = false;
          bar.querySelector('button').onclick = function () { swHerladen = true; w.postMessage('skipWaiting'); };
        }
        if (reg.waiting && navigator.serviceWorker.controller) toonUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) toonUpdate(nw); });
        });
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
      }).catch(function () { /* offline of niet toegestaan: app werkt gewoon verder */ });
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (swHerladen) location.reload(); });
    } catch (e) { /* bv. ingesloten weergave */ }
  }

  function upload(input) {
    var d = huidig(); if (!d) return;
    var path = input.dataset.upload;
    var files = Array.prototype.slice.call(input.files || []);
    var lijst = (getPath(d, path) || []).slice();
    var todo = files.length;
    if (!todo) return;
    files.forEach(function (file) {
      if (/^image\//.test(file.type)) {
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var max = 900, s = Math.min(1, max / Math.max(img.width, img.height));
            var cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            lijst.push({ naam: file.name, type: 'image/jpeg', grootte: file.size, dataUrl: cv.toDataURL('image/jpeg', 0.7) });
            klaar();
          };
          img.onerror = function () { lijst.push({ naam: file.name, type: file.type, grootte: file.size }); klaar(); };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      } else { lijst.push({ naam: file.name, type: file.type, grootte: file.size }); klaar(); }
    });
    function klaar() { if (--todo === 0) { setPath(d, path, lijst); planOpslaan(d); spoelOpslag(); rerenderStap(); } }
  }

  // ------------------------------------------------------------------ start

  function start() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('toggle', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-openkey');
      if (k) state.open[k] = e.target.open;
    }, true);
    // Wijzigingen meteen wegschrijven als de app naar de achtergrond gaat (iPad: app wisselen of scherm uit).
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && Object.keys(wachtend).length) { clearTimeout(saveTimer); spoelOpslag(); } });
    window.addEventListener('pagehide', function () { if (Object.keys(wachtend).length) spoelOpslag(); });

    $('#main').innerHTML = '<div class="wrap empty">Dossiers laden…</div>';
    opslag.init().then(opslag.laadAlles).then(function (data) {
      state.prefs = data.prefs || {};
      zetConfig(data.config);
      if (Array.isArray(data.dossiers)) state.dossiers = data.dossiers;
      else { state.dossiers = SAMPLES.alle(); bewaarDossiers(); }
      if (opslag.modus === 'geen') { state.opslagOk = false; toast('Deze browser laat geen opslag toe. Maak een back-up voor je de app sluit.'); }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      render();
    }).catch(function () {
      zetConfig(null); state.dossiers = SAMPLES.alle(); state.opslagOk = false;
      render(); toast('De opgeslagen dossiers konden niet geladen worden.');
    });
    registreerServiceWorker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
