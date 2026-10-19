# Ontwerp — BACS-screening Vlaanderen

Dit document beschrijft de architectuur, de schermstructuur, het datamodel, de reken- en beslisregels, de technische checklist, het dashboard en het rapportmodel.

> De applicatie is een screenings- en ondersteuningstool. Ze vervangt geen formele keuring, geen inspectie door een energiedeskundige, geen juridisch advies en geen officiële conformiteitsverklaring.

Bronnen (geraadpleegd op 19/10/2026):
- [Gebouwautomatisering en controlesystemen voor niet-residentiële gebouwen verplicht tegen eind 2025](https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025)
- [Technische vereisten voor een BACS](https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025/technische-vereisten-voor-een-bacs-building-automation-and-control-system)

---

## 1. Architectuur

```
┌──────────────────────────── browser ────────────────────────────┐
│  index.html                                                      │
│   ├── src/config.js       wettelijke parameters (standaard)      │
│   ├── src/engine.js       reken- en beslismotor + rapporten      │
│   ├── src/sample-data.js  voorbeelddossiers                      │
│   ├── src/app.js          wizard, dashboard, beheer (UI)         │
│   └── src/styles.css                                            │
│                                                                  │
│  IndexedDB 'bacs-screening': dossiers · kv (config, prefs)       │
│  sw.js: offline cache van de app-bestanden (geen dossiers)       │
└──────────────────────────────────────────────────────────────────┘
          ▲  dezelfde engine.js / config.js
┌─────────┴────────── Node (tests en scripts) ─────────────────────┐
│  tests/engine.test.js     node:test, geen externe pakketten      │
│  scripts/build.js         bundelt tot één HTML-bestand           │
│  scripts/generate-examples.js  voorbeeldrapporten                │
└──────────────────────────────────────────────────────────────────┘
```

Keuzes en motivering:

| Keuze | Waarom |
|---|---|
| Vanilla JavaScript, geen framework, geen build nodig | Werkt offline op een laptop of tablet tijdens het plaatsbezoek; geen afhankelijkheden die verouderen. |
| Strikte scheiding UI ↔ engine | `engine.js` is puur (geen DOM). Dezelfde code draait in de browser en in de tests, en kan later in een backend of andere UI hergebruikt worden. |
| Configuratie als data (`config.js` + overschrijving in Beheer) | Drempels, termijnen, eisen, toelichtingen en oplossingen wijzigen zonder code aan te passen. De override wordt diep samengevoegd met de standaard, zodat nieuwe standaardvelden na een update vanzelf verschijnen. |
| Opslag in IndexedDB (per dossier) met terugval op localStorage, plus back-up/terugzetten als JSON | Werkt zonder server en offline op de iPad. `navigator.storage.persist()` vraagt blijvende opslag aan; de app herinnert na 7 dagen aan een back-up. Zie §8 voor de stap naar een server. |
| Installeerbare web-app (manifest + service worker) | Via Safari op het beginscherm van de iPad; offline bruikbaar; updates via een melding "Nieuwe versie beschikbaar". |
| Rapporten als zelfstandige HTML | Afdrukbaar als PDF via de browser, downloadbaar, en identiek gegenereerd in Node voor de voorbeeldrapporten. |

## 2. Schermstructuur

```
Topbalk: Dossiers · Beheer · Regels en bronnen

Dossiers (dashboard)
 ├─ KPI's: aantal dossiers · potentieel plichtig · onvolledig · plichtig bij 70 kW
 ├─ Zoeken (klant, site, adres, gebouw, adviseur) + filters (uitkomst, modus, gebouwtype)
 ├─ Tabel: site/klant · type · bezoek · modus · uitkomst · max. kW verwarming/koeling · aandachtspunten
 └─ Acties: nieuwe snelle screening · nieuwe dieptescreening · importeren · dupliceren · verwijderen

Dossier (wizard, 3 kolommen)
 ├─ Links: stappen met rode/oranje stip bij fouten/aandachtspunten
 ├─ Midden: de stap
 └─ Rechts: live resultaat (uitkomst, meters t.o.v. 70/290 kW, ontbrekende of tegenstrijdige gegevens)

  Snelle screening              Dieptescreening
  1 Klant en gebouw*            1 Klant en gebouw
  2 Structuur en groepen        2 Structuur en groepen
  3 Verwarming*                 3 Verwarming
  4 Koeling*                    4 Koeling
  5 Beslissingsboom             5 Beslissingsboom
  6 Korte checklist (12 vragen) 6 Uitzonderingen
  7 Rapport (klantenfiche)      7 Technische screening (eisen A–G of methode 2)
                                8 Gaps en actieplan
                                9 Rapport (fiche + technisch rapport)
  * alleen essentiële velden

Beheer: drempels/termijnen (formulier) · volledige configuratie (JSON, gevalideerd) · export/import/herstel
Regels en bronnen: disclaimer, officiële bronnen, toepassingsregels, overzicht eisen
```

Tussentijds opslaan gebeurt automatisch (400 ms na elke wijziging) en met de knop *Opslaan*. Een snelle screening kan op elk moment omgezet worden naar een dieptescreening; alle gegevens blijven behouden en de checklistantwoorden verschijnen als referentie bij de eisen.

## 3. Datamodel

Eén **dossier** per klantbezoek/site. Alle collecties gebruiken stabiele `id`'s; verwijzingen gaan via id.

```
Dossier
 ├─ id, modus ('snel'|'diep'), status ('concept'|'afgerond'), aangemaakt, gewijzigd, voorbeeld?
 ├─ klant   { naam, contactpersoon, contactEmail, contactTel }
 ├─ site    { naam, adres }
 ├─ bezoek  { datum (JJJJ-MM-DD), adviseur }
 ├─ opmerkingen
 ├─ gebouwen[]  Gebouw
 │    id, naam, type, bouwjaar, oppervlakte, geklimatiseerdeOppervlakte (m²),
 │    nieuwBestaand ('nieuw'|'bestaand'), nietResidentieel ('ja'|'nee'|'onbekend'),
 │    eigenaarGebouw, eigenaarInstallaties, gebruiker,
 │    heeftRuimteverwarming | heeftRuimtekoeling | heeftVentilatie ('ja'|'nee'|'onbekend'),
 │    uitzondering { ingeroepen, typeId, motivatie, bewijs, bijlagen[] },
 │    bijzondereSituaties, opmerkingen
 ├─ structuur[]  Onderdeel
 │    id, soort ('gebouwdeel'|'stookplaats'|'koelcentrale'|'zone'|'systeem'), naam, gebouwId, opmerkingen
 ├─ groepen[]  Installatiegroep (= hydraulische of koeltechnische kring)
 │    id, soort ('verwarming'|'koeling'), naam, gebouwIds[], locatieId → structuur, beschrijving (koppeling + bewijs)
 ├─ verwarming[]  Warmteopwekker
 │    id, naam, type, fabrikant, model, bouwjaar, energiedrager, vermogenKW (tekst, komma toegestaan),
 │    hoofdverwarming ('ja'|'nee'), centraalLokaal, gebouwId, locatieId, gekoppeld ('ja'|'nee'|'onbekend'),
 │    groepId → groepen, ventilatie, regelsysteem, protocol, meetpunten, storingsinfo, bijlagen[], opmerkingen
 ├─ koeling[]  Koelinstallatie  (idem, zonder energiedrager en hoofdverwarming)
 ├─ snelleChecklist { Q1..Q12: 'ja'|'deels'|'nee'|'onbekend'|'nvt' }
 └─ screening { methode ('m1'|'m2'), aantalIAQSensoren,
                items { A1..G6, M2: { status, bewijs, opmerking, bijlagen[] } } }

Bijlage { naam, type, grootte, dataUrl? }   (foto's verkleind tot 900 px JPEG; andere bestanden alleen metadata)
```

Configuratie (`config.js`): `drempels.huidig {kW, deadline}`, `drempels.toekomstig {kW, deadline}`, `kleineVerwarmingKW`, `verlichtingVerplichtVanaf`, `eisen[] {id, titel, samenvatting, kern, vanaf?, items[] {id, tekst, oplossing, fase}}`, `methodes {m1, m2}`, `snelleChecklist[]`, `fases[]`, `uitzonderingen[]`, `bronnen[]`, keuzelijsten, disclaimer en toelichtingen.

## 4. Reken- en beslisregels

### 4.1 Vermogensberekening (`computeGroups`)
1. Per soort (verwarming, koeling) apart. **Nooit samenstellen.**
2. Elke installatie met een geldige `groepId` van dezelfde soort telt mee in die groep. Totaal = Σ nominaal vermogen.
3. Een installatie zonder groep vormt een eigen (virtuele) groep: ze wordt afzonderlijk beoordeeld.
4. Een groep hoort bij de gebouwen in `gebouwIds`; is die lijst leeg, dan wordt ze afgeleid uit de gebouwen van de installaties.
5. Het **sitetotaal** wordt getoond maar is informatief en wordt niet voor de toets gebruikt.
6. Invoer: komma of punt, spaties toegestaan. Leeg = ontbrekend; niet-numeriek of negatief = ongeldig.

### 4.2 Beslissingsboom (`beslis`, per gebouw)

| Stap | Vraag | Effect |
|---|---|---|
| S1 | Niet-residentieel? | nee → **Buiten toepassing**; onbekend → **Onvolledig** |
| S2 | Alle vermogens en koppelingen gekend? | nee → uitkomst wordt als *voorlopig* gemarkeerd |
| S3 | Grootste gekoppelde verwarmingsgroep **> 290 kW**? | ja → plichtig (verwarming) |
| S4 | Grootste gekoppelde koelgroep **> 290 kW**? | ja → plichtig (koeling) |
| = | Uitkomst | S3 of S4 ja → **Potentieel BACS-plichtig**; anders, als S3/S4 onzeker → **Onvolledig**; anders **Niet plichtig onder de huidige drempel** |
| S5 | Groep > 70 kW (uiterlijk 31/12/2029)? | Afzonderlijk getoond; verandert de huidige uitkomst niet |
| S6 | Uitzondering ingeroepen en gestaafd? | Alleen documentatie; **verandert de uitkomst nooit** |
| S7 | Technische screening starten? | ja als plichtig of plichtig onder de toekomstige drempel |

Een toets S3/S4 is:
- **ja** als de grootste groep strikt boven de drempel ligt (ook als andere gegevens nog ontbreken: dat kan het totaal alleen verhogen);
- **nee** als geen vermogen ontbreekt én het *slechtste geval* ≤ drempel. Het slechtste geval is de som van alle installaties van die soort in het gebouw wanneer een koppeling onbekend is, anders de grootste groep;
- **onbekend** in alle andere gevallen. Zo leidt onvolledige informatie nooit tot een stille "niet plichtig".

Het dossier krijgt de zwaarste uitkomst van zijn gebouwen (plichtig > onvolledig > niet plichtig > buiten). Er wordt nooit een conformiteitsverklaring gegenereerd (`conformiteitsverklaring: false`).

Termijn: als vandaag na `drempels.huidig.deadline` valt, meldt de app dat de termijn verstreken is.

### 4.3 Uitzonderingen
- *Kandidaat*: precies één van ruimteverwarming, ruimtekoeling en ventilatie is "ja" en de andere twee "nee". De app toont dit als aandachtspunt, niet als vrijstelling.
- *Ingeroepen, onvolledig*: motivering (≥ 20 tekens) of bewijs ontbreekt → fout.
- *Ingeroepen, gestaafd*: gedocumenteerd, "te beoordelen door de bevoegde instantie". Uitkomst blijft ongewijzigd.

### 4.4 Validatie: ontbrekende en tegenstrijdige gegevens

| Code | Niveau | Betekenis |
|---|---|---|
| GEEN_GEBOUW, BESTEMMING_ONBEKEND | fout | Geen gebouw of bestemming niet bevestigd |
| VERMOGEN_ONTBREEKT, VERMOGEN_ONGELDIG | fout | Leeg, niet-numeriek of negatief vermogen |
| VERMOGEN_NUL, VERMOGEN_HOOG | waarschuwing | 0 kW of > 10 000 kW (vermoedelijk W i.p.v. kW) |
| KOPPELING_ONBEKEND | waarschuwing | Koppeling niet ingevuld |
| GEKOPPELD_ZONDER_GROEP | waarschuwing | "Gekoppeld" maar geen groep |
| TEGENSTRIJDIGE_KOPPELING | fout | "Niet gekoppeld" in een groep met andere installaties |
| GROEP_VERKEERDE_SOORT, GROEP_ONBEKEND, GEBOUW_ONBEKEND | fout/waarschuwing | Verwijzing naar verkeerde of verwijderde groep/gebouw |
| GEBOUW_BUITEN_GROEP | waarschuwing | Installatie in ander gebouw dan de groep bedient |
| VERWARMING_/KOELING_TEGENSTRIJDIG | fout | "Geen ruimteverwarming/-koeling" maar wel installaties |
| …_NIET_GEINVENTARISEERD | waarschuwing | Installatie aanwezig maar niet ingevoerd |
| OPPERVLAKTE_TEGENSTRIJDIG, BOUWJAAR_ONGELDIG, NIEUW_OUD_BOUWJAAR | fout/waarschuwing | Gebouwgegevens kloppen niet |
| EIGENAAR_INSTALLATIES_ONBEKEND | waarschuwing | Verantwoordelijke niet vastgelegd |
| UITZONDERING_ZONDER_MOTIVERING/_BEWIJS, UITZONDERING_NIET_CONSISTENT | fout/waarschuwing | Zie §4.3 |
| SENSOREN_TEGENSTRIJDIG | fout | G4 "voldoet" maar minder sensoren dan ⌈geklimatiseerde m² / 100⌉ |
| NVT_ZONDER_MOTIVERING, BEWIJS_ONTBREEKT | waarschuwing/info | Screeningsitem zonder motivering of bewijs |
| CHECKLIST_TEGENSTRIJDIG | waarschuwing | Geen BACS, maar wel alarmen/visualisatie/open communicatie |

## 5. Technische checklist

**Snelle screening**: 12 vragen (Q1–Q12), elk gekoppeld aan een eis, met antwoorden ja/deels/nee/onbekend/n.v.t. Ze leveren een indicatieve stand per eis.

**Dieptescreening**: alle items van de geconfigureerde eisen, per item status + bewijs + opmerking + bijlagen.
- **Methode 1**: eisen A–G (7 eisen, 31 items).
- **Methode 2**: klasse B volgens NBN EN ISO 52120-1:2022 (item M2) + eisen A, B en G.
- Scope A–D: verwarming (behalve < 12 kW buiten de hoofdverwarming), koeling, ventilatie, SWW indien gekoppeld aan centrale opwekker.
- Eis F (verlichting) is vóór 01/01/2028 als *toekomstig* gemarkeerd.
- De app geeft per item contextuele hints uit de inventaris (bv. elektrische centrale opwekkers → A4, meerdere gasstookplaatsen → A6, verwarming én koeling → D3, vereist aantal sensoren → G4).

Eisstatus: alle relevante items "voldoet" → *lijkt te voldoen*; alleen "voldoet niet" → *voldoet niet*; mix met tekort → *gedeeltelijk*; voldoet + onbekend → *te verifiëren*; alles n.v.t. → *n.v.t.*

## 6. Gapanalyse en actieplan
Elk item dat niet "voldoet" of "n.v.t." is, wordt een gap met:
- **prioriteit**: *hoog* (kerneisen A, B, G en klasse B), *middel* (C, D, E), *verifiëren* (onbekend/niet beoordeeld), *toekomst* (F vóór 2028, 70 kW-drempel);
- **fase**: verifiëren → organisatorisch → meting → platform → regeling → toekomst (met indicatieve termijnen uit de configuratie);
- **voorgestelde oplossing** uit de configuratie.

Extra gaps: toepasselijkheid niet vast te stellen, verantwoordelijke niet vastgelegd, toekomstige 70 kW-plicht.

## 7. Dashboard en rapportmodel

**Dashboard**: KPI-tegels, zoek- en filterbalk, dossiertabel. Binnen een dossier toont de rechterkolom live de uitkomst, vermogensmeters met markeringen op 70 en 290 kW, en de lijst met ontbrekende of tegenstrijdige gegevens (klikbaar naar de juiste stap).

**Korte klantenfiche** (1–2 A4): kop met klant/site/bezoek/adviseur · disclaimer · uitkomst per gebouw · vermogen per gekoppelde groep · toekomstige drempel · indicatieve stand per eis · belangrijkste aandachtspunten (max. 6) · vervolgstappen · verantwoordelijkheid · bronnen.

**Uitgebreid technisch rapport**: 1 Samenvatting · 2 Gebouwen en verantwoordelijkheid (+ site-indeling) · 3 Vermogensberekening · 4 Inventaris · 5 Beslissingsboom · 6 Uitzonderingen en bijzondere situaties · 7 Technische screening per eis en item · 8 Gapanalyse · 9 Actieplan · 10 Datakwaliteit · Bronnen + configuratieversie.

Beide rapporten vermelden expliciet dat ze geen definitieve juridische conformiteitsverklaring zijn.

## 8. Uitbreidingsrichtingen
- **Server en meerdere gebruikers**: vervang `store` in `app.js` door API-aanroepen; het dossierformaat is al JSON. `engine.js` kan ongewijzigd in Node draaien voor server-side validatie en rapporten.
- **Echte bestandsopslag**: bijlagen naar een objectopslag; in het dossier enkel een verwijzing.
- **PDF op de server**: de rapport-HTML is printklaar (A4, `@page`) en kan met een headless browser naar PDF.
- **VEKA-stavingsstuk**: export van de itemstatussen naar het stavingsformaat van het VEKA.
- **Versiebeheer van configuratie**: `configVersie` wordt al in elk rapport vermeld; bewaar ze per dossier om oude rapporten reproduceerbaar te houden.
