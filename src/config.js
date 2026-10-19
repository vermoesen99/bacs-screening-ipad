/*
 * BACS-screening — standaardconfiguratie van de wettelijke parameters.
 *
 * Alle drempels, deadlines, technische eisen, toelichtingen en voorgestelde
 * oplossingen staan hier centraal. In de applicatie kan een beheerder deze
 * waarden aanpassen via "Beheer"; de aangepaste versie wordt bewaard naast
 * (en samengevoegd met) deze standaard. Wijzig dit bestand om de standaard
 * voor alle gebruikers aan te passen.
 *
 * Bronstand: vlaanderen.be, geraadpleegd op 19/10/2026 (incl. wijzigingen
 * van 4 februari 2026 rond < 12 kW en binnenluchtkwaliteit).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BACS_DEFAULT_CONFIG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    configVersie: '2026-10-19',
    geraadpleegdOp: '2026-10-19',

    disclaimer:
      'Deze screening is een hulpmiddel voor een eerste inschatting. Ze vervangt geen formele keuring, ' +
      'geen inspectie door een erkend energiedeskundige, geen juridisch advies en geen officiële ' +
      'conformiteitsverklaring. De uitkomst is gebaseerd op de gegevens die tijdens het plaatsbezoek ' +
      'werden verzameld en op de regelgeving zoals geconfigureerd op de vermelde datum.',

    bronnen: [
      {
        id: 'verplichting',
        titel: 'Gebouwautomatisering en controlesystemen voor niet-residentiële gebouwen verplicht tegen eind 2025',
        url: 'https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025'
      },
      {
        id: 'technisch',
        titel: 'Technische vereisten voor een BACS (Building Automation and Control System)',
        url: 'https://www.vlaanderen.be/gebouwautomatisering-en-controlesystemen-voor-niet-residentiele-gebouwen-verplicht-tegen-eind-2025/technische-vereisten-voor-een-bacs-building-automation-and-control-system'
      }
    ],
    regelgeving: 'Artikel 11.1/1.2 van het Energiedecreet en artikel 9.4.1 van het Energiebesluit.',

    // Drempels: de verplichting geldt bij MEER DAN (strikt groter dan) de drempel.
    drempels: {
      huidig: { kW: 290, deadline: '2025-12-31', label: 'Huidige drempel' },
      toekomstig: { kW: 70, deadline: '2029-12-31', label: 'Toekomstige drempel (uiterlijk)' }
    },
    // Verwarmingssystemen kleiner dan deze waarde die niet in de hoofdverwarming voorzien,
    // vallen buiten de scope van eisen A–D (niet buiten de vermogensberekening).
    kleineVerwarmingKW: 12,
    verlichtingVerplichtVanaf: '2028-01-01',

    verantwoordelijkheid:
      'De verplichting rust op de eigenaar of de houder van het zakelijk recht van het verwarmings-, ' +
      'koel- of gecombineerde systeem. Meestal is dat de gebouweigenaar, maar niet altijd: bij casco-verhuur ' +
      'plaatst vaak de huurder de installaties en ligt de verplichting dan bij de huurder.',

    berekeningsregel:
      'Het nominale vermogen is de som van alle opwekkers of installaties die hydraulisch (verwarming) of ' +
      'koeltechnisch (koeling) gekoppeld zijn. Verwarming en koeling worden afzonderlijk getoetst, elk aan ' +
      'een eigen drempel. Ze worden nooit samengeteld.',

    gebouwtypes: [
      'School', 'Sporthal', 'Gemeentehuis', 'Administratief centrum', 'Woonzorgcentrum',
      'Zorginstelling', 'Cultureel gebouw', 'Bibliotheek', 'Zwembad', 'Kantoor',
      'Ander publiek gebouw', 'Ander niet-residentieel gebouw'
    ],
    structuurSoorten: [
      { id: 'gebouwdeel', label: 'Gebouwdeel' },
      { id: 'stookplaats', label: 'Stookplaats' },
      { id: 'koelcentrale', label: 'Koelcentrale' },
      { id: 'zone', label: 'Zone' },
      { id: 'systeem', label: 'Afzonderlijk technisch systeem' }
    ],
    verwarmingTypes: [
      'Gasketel', 'Stookolieketel', 'Warmtepomp', 'Warmtenetaansluiting', 'Biomassa-installatie',
      'WKK', 'Elektrische ketel', 'Andere'
    ],
    koelingTypes: [
      'Luchtgekoelde koelmachine (chiller)', 'Watergekoelde koelmachine', 'Omkeerbare warmtepomp (koelbedrijf)',
      'VRF/VRV-systeem', 'Split-/multisplitsysteem', 'Rooftop-unit', 'Koudenetaansluiting', 'Andere'
    ],
    energiedragers: ['Aardgas', 'Stookolie', 'Elektriciteit', 'Warmtenet', 'Biomassa', 'Andere'],
    protocollen: ['BACnet/IP', 'BACnet MS/TP', 'Modbus TCP', 'Modbus RTU', 'KNX', 'M-Bus', 'LonWorks',
      'OPC UA', 'MQTT', 'Fabrikantspecifiek', 'Geen', 'Onbekend'],

    uitzonderingen: [
      {
        id: 'een-installatie',
        titel: 'Gebouw beschikt over slechts één van: ruimteverwarming, ruimtekoeling, ventilatie',
        toelichting:
          'Vlaanderen stelt gebouwen vrij waar de verplichting technisch, functioneel of economisch niet ' +
          'haalbaar is, vertaald naar gebouwen met slechts één van deze drie installaties. Leg vast welke ' +
          'installaties aanwezig zijn en voeg bewijs toe (plannen, inventaris, foto’s).'
      },
      {
        id: 'andere',
        titel: 'Andere bijzondere situatie (te motiveren)',
        toelichting:
          'Documenteer de situatie volledig. De app trekt hier geen conclusie uit: de beoordeling ligt bij ' +
          'de bevoegde instantie of de energiedeskundige.'
      }
    ],

    methodes: {
      m1: {
        label: 'Methode 1 — 7 technische vereisten (A t.e.m. G)',
        eisen: ['A', 'B', 'C', 'D', 'E', 'F', 'G']
      },
      m2: {
        label: 'Methode 2 — Klasse B volgens NBN EN ISO 52120-1:2022 + eisen A, B en G',
        eisen: ['A', 'B', 'G'],
        extraItems: [
          {
            id: 'M2',
            tekst: 'Het BACS voldoet aantoonbaar aan klasse B volgens NBN EN ISO 52120-1:2022.',
            oplossing: 'Laat een klasse-B-evaluatie volgens NBN EN ISO 52120-1 uitvoeren en documenteer per functie het bereikte niveau.',
            fase: 'platform'
          }
        ]
      }
    },

    scopeToelichting:
      'Eisen A tot D gelden voor de technische bouwsystemen voor verwarming (behalve systemen < 12 kW die niet ' +
      'in de hoofdverwarming voorzien), koeling, ventilatie en sanitair warm water indien gekoppeld aan een ' +
      'centrale opwekker.',

    // Fases voor het actieplan, in volgorde van uitvoering.
    fases: [
      { id: 'verificatie', label: 'Verifiëren en documenteren', termijn: 'Onmiddellijk' },
      { id: 'organisatorisch', label: 'Organisatorische maatregelen', termijn: '0–3 maanden' },
      { id: 'meting', label: 'Meet- en sensorinfrastructuur', termijn: '3–9 maanden' },
      { id: 'platform', label: 'BACS-platform en communicatie', termijn: '3–12 maanden' },
      { id: 'regeling', label: 'Regeling en optimalisatie', termijn: '6–12 maanden' },
      { id: 'toekomst', label: 'Voorbereiding toekomstige eisen', termijn: 'Vóór de wettelijke datum' }
    ],

    eisen: [
      {
        id: 'A',
        titel: 'Energiegebruik monitoren en bijhouden',
        samenvatting: 'Meting van elektriciteit, aardgas, andere brandstoffen en warmte, met vaste uitleesfrequentie en 5 jaar dataopslag.',
        kern: true,
        items: [
          { id: 'A1', tekst: 'Elektriciteit: afname van het net wordt gemeten.', oplossing: 'Koppel de digitale hoofdmeter (P1/S0/M-Bus of datalogger van de netbeheerder) aan het BACS/EMS.', fase: 'meting' },
          { id: 'A2', tekst: 'Elektriciteit: injectie in het net wordt gemeten.', oplossing: 'Lees het injectieregister van de hoofdmeter uit of plaats een bidirectionele meter.', fase: 'meting' },
          { id: 'A3', tekst: 'Elektriciteit: eigen productie (bv. PV, WKK) wordt gemeten.', oplossing: 'Plaats een productiemeter per installatie of lees de omvormer uit via Modbus/API.', fase: 'meting' },
          { id: 'A4', tekst: 'Elke elektrische centrale opwekker (bv. warmtepomp, elektrische ketel) heeft een eigen meting.', oplossing: 'Plaats een tussenmeter (MID, communicerend) per elektrische centrale opwekker.', fase: 'meting' },
          { id: 'A5', tekst: 'Aardgas: afname van het net wordt gemeten.', oplossing: 'Voorzie pulsuitlezing of datalogger op de hoofdgasmeter.', fase: 'meting' },
          { id: 'A6', tekst: 'Aardgas: bij meerdere verbruikers is er een meting per stookplaats.', oplossing: 'Plaats een communicerende gas-submeter per stookplaats.', fase: 'meting' },
          { id: 'A7', tekst: 'Andere brandstof (stookolie, biomassa…): meting per stookplaats.', oplossing: 'Plaats een brandstofteller of niveaumeting met datalogging per stookplaats.', fase: 'meting' },
          { id: 'A8', tekst: 'Warmte: aftakking per gebouw van het warmtenet wordt gemeten.', oplossing: 'Plaats een communicerende warmtemeter (M-Bus) op de aftakking per gebouw.', fase: 'meting' },
          { id: 'A9', tekst: 'De meters voldoen aan de kwaliteitsvoorwaarden van het EPC NR.', oplossing: 'Controleer de meters op de EPC NR-kwaliteitsvoorwaarden en vervang niet-conforme meters.', fase: 'meting' },
          { id: 'A10', tekst: 'Elektriciteitsmeters worden minstens op kwartierbasis uitgelezen.', oplossing: 'Configureer de datalogger of het BACS op kwartierregistratie.', fase: 'platform' },
          { id: 'A11', tekst: 'Andere meters worden minstens op uurbasis uitgelezen.', oplossing: 'Configureer uurregistratie voor gas-, brandstof- en warmtemeters.', fase: 'platform' },
          { id: 'A12', tekst: 'Data worden minstens 5 jaar bewaard; de eerste 13 maanden in volle granulariteit (nadien mag maandbasis).', oplossing: 'Voorzie een database of EMS-opslag met bewaarbeleid van minstens 5 jaar en een back-up.', fase: 'platform' }
        ]
      },
      {
        id: 'B',
        titel: 'Communicatie en interoperabiliteit',
        samenvatting: 'Communicatie met verbonden technische bouwsystemen, interoperabel over technologieën, toestellen en fabrikanten.',
        kern: true,
        items: [
          { id: 'B1', tekst: 'Het BACS communiceert met de verbonden technische bouwsystemen in het gebouw.', oplossing: 'Koppel de opwekkers, ventilatie en meters aan één centraal BACS/GBS.', fase: 'platform' },
          { id: 'B2', tekst: 'Gegevensuitwisseling gebeurt via gestandaardiseerde protocollen (ISO, EN…), bv. BACnet, Modbus, KNX, M-Bus.', oplossing: 'Voorzie gateways naar een open protocol (bv. BACnet/IP) voor installaties met een gesloten protocol.', fase: 'platform' },
          { id: 'B3', tekst: 'Er zijn API’s, software of data-uitwisselingsstandaarden die vastleggen hoe gegevens worden uitgewisseld.', oplossing: 'Vraag de leverancier om een gedocumenteerde API of exportfunctie (bv. REST, OPC UA, MQTT, CSV).', fase: 'platform' },
          { id: 'B4', tekst: 'Het systeem werkt samen met installaties van verschillende technologieën en fabrikanten.', oplossing: 'Neem interoperabiliteit (multivendor, open protocol) op als eis in het lastenboek.', fase: 'platform' }
        ]
      },
      {
        id: 'C',
        titel: 'Energiegebruik analyseren en bijsturen',
        samenvatting: 'Visualisatie, vergelijking, alarmen per meting en een alarmprocedure.',
        kern: false,
        items: [
          { id: 'C1', tekst: 'Energiegebruik wordt gevisualiseerd per energiedrager en per meting, voor verschillende periodes.', oplossing: 'Activeer dashboards (grafieken/tabellen) per energiedrager en meter in het BACS/EMS.', fase: 'platform' },
          { id: 'C2', tekst: 'Vergelijking is mogelijk met het verleden, periodes, targets en andere meters of gebouwen.', oplossing: 'Stel referentieperiodes en targets in en voorzie benchmarking tussen gebouwen.', fase: 'platform' },
          { id: 'C3', tekst: 'Per energiemeting kan minstens één tijds- en/of gebruiksgebonden alarm worden ingesteld.', oplossing: 'Configureer per meter een alarm (bv. nachtverbruik boven drempel).', fase: 'organisatorisch' },
          { id: 'C4', tekst: 'Er is een schriftelijke alarmprocedure: hoe alarmen worden opgesteld, hoe, wanneer en naar wie ze gaan, en welke acties volgen.', oplossing: 'Stel een alarmprocedure op met verantwoordelijken, escalatie en opvolging.', fase: 'organisatorisch' }
        ]
      },
      {
        id: 'D',
        titel: 'Energie-efficiëntie controleren en optimaliseren',
        samenvatting: 'Rendementsverliezen opsporen, optimaal regelen en energievernietiging voorkomen.',
        kern: false,
        items: [
          { id: 'D1', tekst: 'Rendementsverliezen van technische bouwsystemen kunnen worden opgespoord (diagnose van de opwekker uitgelezen, of bijkomende meters).', oplossing: 'Lees de diagnostiek van de opwekkers uit of plaats bijkomende meters (bv. warmtemeter + energiemeter voor rendementsbepaling).', fase: 'meting' },
          { id: 'D2', tekst: 'De technische bouwsystemen worden geregeld zodat ze optimaal werken.', oplossing: 'Optimaliseer regelstrategieën: weersafhankelijke regeling, tijdsprogramma’s, cascadesturing.', fase: 'regeling' },
          { id: 'D3', tekst: 'Waar verwarming en koeling in dezelfde ruimte aanwezig zijn, voorkomt een regeling energievernietiging.', oplossing: 'Voorzie vergrendeling of een dode zone tussen verwarmen en koelen per ruimte.', fase: 'regeling' }
        ]
      },
      {
        id: 'E',
        titel: 'Hernieuwbare energie en energieopslag',
        samenvatting: 'Optimaliseren van eigen gebruik van hernieuwbare energie en/of restwarmte.',
        kern: false,
        items: [
          { id: 'E1', tekst: 'Het BACS kan het eigen gebruik van hernieuwbare energie en/of restwarmte optimaliseren (bv. opslag, load-shifting).', oplossing: 'Stuur flexibele verbruikers (warmtepomp, buffer, laadpalen) aan op basis van PV-productie.', fase: 'regeling' }
        ]
      },
      {
        id: 'F',
        titel: 'Verlichting (vanaf 2028)',
        samenvatting: 'Automatische uitschakeling bij afwezigheid; koppeling met het BACS is niet nodig.',
        kern: false,
        vanaf: '2028-01-01',
        items: [
          { id: 'F1', tekst: 'Verlichting schakelt automatisch uit bij afwezigheid, in alle ruimtes behalve technische ruimtes, bergingen en ruimtes waar dit een veiligheidsrisico vormt.', oplossing: 'Plaats aanwezigheids- of afwezigheidsdetectie per ruimte.', fase: 'toekomst' }
        ]
      },
      {
        id: 'G',
        titel: 'Binnenmilieukwaliteit monitoren',
        samenvatting: 'Temperatuur, relatieve vochtigheid en CO₂, minstens 1 meting per 100 m², gekoppeld aan het BACS, kwartierdata 13 maanden.',
        kern: true,
        items: [
          { id: 'G1', tekst: 'Temperatuur wordt gemeten.', oplossing: 'Plaats communicerende multisensoren (T/RV/CO₂).', fase: 'meting' },
          { id: 'G2', tekst: 'Relatieve vochtigheid wordt gemeten.', oplossing: 'Plaats communicerende multisensoren (T/RV/CO₂).', fase: 'meting' },
          { id: 'G3', tekst: 'CO₂ wordt gemeten met meters die voldoen aan het KB van 7 februari 2024.', oplossing: 'Gebruik CO₂-sensoren die voldoen aan het KB van 7 februari 2024.', fase: 'meting' },
          { id: 'G4', tekst: 'Minstens 1 meting per 100 m² geklimatiseerde bruikbare vloeroppervlakte (in lokalen > 100 m² mag 1 per lokaal).', oplossing: 'Vul het aantal sensoren aan tot het vereiste minimum.', fase: 'meting' },
          { id: 'G5', tekst: 'De sensoren zijn verbonden met het BACS.', oplossing: 'Koppel de sensoren via een open protocol aan het BACS.', fase: 'platform' },
          { id: 'G6', tekst: 'De data worden per kwartier bijgehouden, voor minstens 13 maanden.', oplossing: 'Configureer kwartierlogging met minstens 13 maanden opslag.', fase: 'platform' }
        ]
      }
    ],

    // Korte checklist voor de snelle screening. Elke vraag verwijst naar een eis.
    snelleChecklist: [
      { id: 'Q1', eis: 'B', vraag: 'Is er een centraal gebouwbeheersysteem (BACS/GBS) aanwezig?', oplossing: 'Voorzie een centraal BACS/GBS waarop opwekkers, ventilatie, meters en sensoren samenkomen.', fase: 'platform' },
      { id: 'Q2', eis: 'A', vraag: 'Worden afname, injectie en eigen productie van elektriciteit automatisch op kwartierbasis uitgelezen?', oplossing: 'Koppel hoofd- en productiemeters met kwartierlogging aan het BACS/EMS.', fase: 'meting' },
      { id: 'Q3', eis: 'A', vraag: 'Wordt gas of andere brandstof per stookplaats gemeten en minstens per uur uitgelezen?', oplossing: 'Plaats communicerende submeters per stookplaats met uurregistratie.', fase: 'meting' },
      { id: 'Q4', eis: 'A', vraag: 'Worden de meetgegevens minstens 5 jaar bewaard?', oplossing: 'Voorzie dataopslag met een bewaartermijn van minstens 5 jaar.', fase: 'platform' },
      { id: 'Q5', eis: 'B', vraag: 'Communiceren de installaties via een open protocol of gedocumenteerde API?', oplossing: 'Voorzie gateways naar een open protocol (bv. BACnet/IP, Modbus) of een gedocumenteerde API.', fase: 'platform' },
      { id: 'Q6', eis: 'C', vraag: 'Kan het verbruik gevisualiseerd en vergeleken worden (historiek, targets, andere meters)?', oplossing: 'Activeer dashboards met vergelijking t.o.v. historiek, targets en andere gebouwen.', fase: 'platform' },
      { id: 'Q7', eis: 'C', vraag: 'Zijn er alarmen per meting én een schriftelijke alarmprocedure?', oplossing: 'Configureer alarmen per meter en stel een alarmprocedure op.', fase: 'organisatorisch' },
      { id: 'Q8', eis: 'D', vraag: 'Kunnen rendementsverliezen van de opwekkers opgespoord worden?', oplossing: 'Lees de diagnostiek van de opwekkers uit of plaats warmte- en energiemeters.', fase: 'meting' },
      { id: 'Q9', eis: 'D', vraag: 'Wordt gelijktijdig verwarmen en koelen in dezelfde ruimte voorkomen?', oplossing: 'Voorzie vergrendeling of een dode zone tussen verwarmen en koelen.', fase: 'regeling' },
      { id: 'Q10', eis: 'E', vraag: 'Wordt het eigen gebruik van hernieuwbare energie of restwarmte geoptimaliseerd?', oplossing: 'Stuur flexibele verbruikers aan op basis van eigen productie (load-shifting, buffer).', fase: 'regeling' },
      { id: 'Q11', eis: 'F', vraag: 'Schakelt de verlichting automatisch uit bij afwezigheid?', oplossing: 'Plaats aanwezigheids- of afwezigheidsdetectie (verplicht vanaf 2028).', fase: 'toekomst' },
      { id: 'Q12', eis: 'G', vraag: 'Worden temperatuur, RV en CO₂ (≥ 1 per 100 m²) gemeten en aan het BACS gekoppeld?', oplossing: 'Plaats communicerende T/RV/CO₂-sensoren (≥ 1 per 100 m²) gekoppeld aan het BACS.', fase: 'meting' }
    ],

    vervolgstappen: [
      'Laat de screening bevestigen door een energiedeskundige; gebruik daarbij het stavingsstuk van het VEKA.',
      'Bevestig de hydraulische en koeltechnische koppelingen met schema’s of plannen.',
      'Leg vast wie eigenaar of houder van het zakelijk recht van de technische installaties is.',
      'Verzamel bewijsstukken per eis (fiches, screenshots, procedures, meterlijsten).',
      'Stel een lastenboek op voor ontbrekende meet-, sensor- en BACS-functies.'
    ]
  };
});
