# BACS-screening Vlaanderen

Nederlandstalige webapplicatie waarmee een energieadviseur tijdens een klantbezoek nagaat of een niet-residentieel gebouw onder de Vlaamse BACS-verplichting valt, het gekoppelde verwarmings- en koelvermogen berekent, een technische screening uitvoert (eisen A–G of methode 2), tekortkomingen en oplossingen oplijst en een klantenrapport opmaakt.

> **Screeningstool.** De uitkomst vervangt geen formele keuring, geen inspectie door een energiedeskundige, geen juridisch advies en geen officiële conformiteitsverklaring.

## Op je iPad installeren via GitHub Pages (zonder command line)

**1. Repository maken**
1. Log in op [github.com](https://github.com) en klik rechtsboven op **+ → New repository**.
2. Naam: `bacs-screening`. Kies **Public** (GitHub Pages is gratis voor publieke repositories). Vink niets anders aan en klik **Create repository**.
   In de code zitten alleen fictieve voorbeelden; je echte dossiers blijven op je iPad en komen nooit op GitHub.

**2. Bestanden uploaden**
1. Pak de zip uit op je computer.
2. Klik in de lege repository op **uploading an existing file**.
3. Open de uitgepakte map en sleep **alle bestanden en mappen erin** (dus `index.html`, `sw.js`, `manifest.webmanifest`, `icons`, `src`, … — niet de bovenliggende map zelf).
4. Wacht tot alles geladen is en klik onderaan op **Commit changes**.
   Controleer daarna dat `index.html` rechtstreeks op de startpagina van de repository staat.

**3. GitHub Pages inschakelen**
1. In de repository: **Settings → Pages**.
2. Bij *Build and deployment*: Source **Deploy from a branch**, Branch **main**, map **/ (root)**, klik **Save**.
3. Na 1 à 2 minuten verschijnt bovenaan: *Your site is live at* `https://<gebruikersnaam>.github.io/bacs-screening/`.

**4. Op de iPad installeren**
1. Open dat adres in **Safari** (niet in Chrome of een andere app).
2. Tik op **Deel** (vierkant met pijl) → **Zet op beginscherm** → **Voeg toe**.
3. Open de app voortaan **altijd via het icoon**. Zo werkt ze offline en blijven de gegevens bewaard.
4. Open de app één keer met internet; daarna werkt ze ook zonder verbinding.

**5. Back-ups**
- De dossiers staan alleen op je iPad. Tik regelmatig op **Back-up maken** en kies **Bewaar in Bestanden → iCloud Drive**. De app herinnert je eraan na 7 dagen.
- Terugzetten: **Beheer → Gegevens en back-up**, kies het bestand, kies *Samenvoegen* of *Alles vervangen*, tik **Terugzetten**.
- Zo zet je dossiers ook over naar een nieuwe iPad of naar een computer.

**6. Een nieuwe versie plaatsen**
1. Upload de gewijzigde bestanden opnieuw via **Add file → Upload files** (zelfde namen overschrijven de oude) en klik **Commit changes**.
2. Na 1 à 2 minuten toont de app op je iPad *Nieuwe versie beschikbaar → Herladen*. Je dossiers blijven behouden.

> Werkt het niet? Controleer in **Settings → Pages** of de site live is, en in de repository of `index.html` en `sw.js` in de hoofdmap staan (niet in een submap).

## Snel starten op een computer

**Zonder installatie:** open `dist/bacs-screening.html` in een recente browser (Chrome, Edge, Firefox, Safari). Alles zit in dat ene bestand; het werkt ook offline (lettertypes vallen dan terug op systeemlettertypes).

**Met Node 18+ (ontwikkeling):**

```bash
npm test            # 35 automatische tests (rekenregels, beslissingsboom, ontbrekende/tegenstrijdige data)
npm run build       # maakt index.html, sw.js (offline cache), dist/bacs-screening.html en dist/artifact.html
npm run examples    # schrijft voorbeeldrapporten en voorbeelddossiers in examples/
npm start           # lokale server op http://localhost:8080 (optioneel)
```

Bij de eerste start laadt de app drie fictieve voorbeelddossiers:

| Dossier | Situatie | Verwachte uitkomst |
|---|---|---|
| Basisschool De Linde | Werkvoorbeeld: 2 × 180 kW gekoppelde ketels, 90 kW koeling | Potentieel plichtig op basis van verwarming (360 kW), koeling 90 kW onder drempel, 70 kW-drempel afzonderlijk overschreden |
| Administratief centrum | 2 gebouwen; annex met ontbrekend vermogen en onbekende koppeling | Stadhuis plichtig (310 kW), annex onvolledig |
| Woonzorgcentrum | 240 kW verwarming, 85 kW koeling, installaties van een ESCO | Niet plichtig onder 290 kW, wel boven 70 kW |

## Projectstructuur

```
src/config.js          wettelijke parameters, eisen A–G, checklist, oplossingen (standaard)
src/engine.js          reken- en beslismotor, validatie, gapanalyse, rapporten (puur, ook in Node)
src/sample-data.js     voorbeelddossiers
src/app.js             gebruikersinterface (wizard, dashboard, beheer, opslag in IndexedDB, back-up)
index.html, sw.js      installeerbare web-app en service worker (offline); sw.js wordt gegenereerd
manifest.webmanifest   app-naam en iconen voor het beginscherm
icons/                 app-iconen
src/styles.css         opmaak (licht en donker thema)
tests/engine.test.js   automatische tests (node:test)
scripts/               build, voorbeeldrapporten, lokale server
docs/ONTWERP.md        architectuur, schermen, datamodel, beslisregels, checklist, rapportmodel
examples/              klantenfiche, technisch rapport en dossiers als JSON
dist/                  gebouwde versies
```

## Gebruik in het kort

1. **Dossiers** → *Nieuwe snelle screening* of *Nieuwe dieptescreening*.
2. Doorloop de stappen. Het paneel rechts toont live de uitkomst, de meters t.o.v. 70 en 290 kW, en wat ontbreekt of tegenstrijdig is.
3. Leg in *Structuur en groepen* vast welke opwekkers hydraulisch of koeltechnisch gekoppeld zijn. Alleen die worden samengeteld.
4. *Rapport* → klantenfiche of technisch rapport; download als HTML of druk af als PDF.
5. Dossiers worden automatisch op het toestel bewaard (IndexedDB). Maak regelmatig een back-up via *Back-up maken*.

## Wettelijke parameters aanpassen

- **In de app:** *Beheer* → drempels, termijnen, disclaimer via het formulier, of de volledige configuratie (eisen, items, oplossingen, checklist, fases, bronnen) als JSON. De app valideert de structuur voor ze iets toepast. Exporteer de configuratie om ze op andere toestellen te importeren.
- **Voor iedereen (standaard):** pas `src/config.js` aan, verhoog `configVersie` en `geraadpleegdOp`, en voer `npm test && npm run build` uit.

Elke rapport vermeldt de configuratieversie en de raadpleegdatum van de bronnen.

## Verder uitbreiden

- Nieuwe eis of item: voeg het toe in `config.js` → het verschijnt automatisch in de screening, de gapanalyse en de rapporten.
- Nieuwe controle op tegenstrijdige gegevens: voeg ze toe in `validate()` in `engine.js`, met een test in `tests/engine.test.js`.
- Server en meerdere gebruikers: vervang het `opslag`-object in `app.js` door API-aanroepen; zie `docs/ONTWERP.md` §8.
- Na een wijziging in `src/`: voer `node scripts/build.js` uit. Dat vernieuwt `sw.js`, zodat geïnstalleerde apps de nieuwe versie oppikken. Zonder Node: verhoog in `sw.js` handmatig de waarde van `VERSIE`.

## Bronnen

- [Gebouwautomatisering en controlesystemen voor niet-residentiële gebouwen verplicht tegen eind 2025](https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025)
- [Technische vereisten voor een BACS](https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025/technische-vereisten-voor-een-bacs-building-automation-and-control-system)
- Regelgeving: artikel 11.1/1.2 Energiedecreet en artikel 9.4.1 Energiebesluit.
