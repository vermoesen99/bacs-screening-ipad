/*
 * Voorbeelddossiers. Fictieve gegevens, alleen voor demonstratie en tests.
 * Dossier 1 is het werkvoorbeeld uit de opdracht (school, 2 × 180 kW gekoppeld, 90 kW koeling).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BACS_SAMPLES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function school() {
    return {
      id: 'voorbeeld-school', voorbeeld: true, modus: 'diep', status: 'concept',
      aangemaakt: '2026-10-12T09:00:00.000Z', gewijzigd: '2026-10-12T11:30:00.000Z',
      klant: { naam: 'Gemeente Voorbeeldegem (fictief)', contactpersoon: 'An Peeters, technische dienst', contactEmail: 'technische.dienst@voorbeeldegem.example', contactTel: '' },
      site: { naam: 'Basisschool De Linde (voorbeeld)', adres: 'Schoolstraat 1, 9999 Voorbeeldegem' },
      bezoek: { datum: '2026-10-12', adviseur: 'Voorbeeldadviseur' },
      opmerkingen: 'Werkvoorbeeld uit de opdracht. Ketels in cascade op één collector.',
      gebouwen: [{
        id: 'g1', naam: 'Hoofdgebouw', type: 'School', bouwjaar: '1978', oppervlakte: '3200', geklimatiseerdeOppervlakte: '2900',
        nieuwBestaand: 'bestaand', nietResidentieel: 'ja',
        eigenaarGebouw: 'Gemeente Voorbeeldegem', eigenaarInstallaties: 'Gemeente Voorbeeldegem', gebruiker: 'Schoolbestuur De Linde',
        heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'ja', heeftVentilatie: 'ja',
        uitzondering: { ingeroepen: false, typeId: '', motivatie: '', bewijs: '', bijlagen: [] },
        bijzondereSituaties: '', opmerkingen: ''
      }],
      structuur: [
        { id: 's1', soort: 'stookplaats', naam: 'Stookplaats kelder', gebouwId: 'g1', opmerkingen: 'Gemeenschappelijke collector' },
        { id: 's2', soort: 'koelcentrale', naam: 'Dak – koelmachine', gebouwId: 'g1', opmerkingen: 'Bedient enkel het ICT-lokaal en de turnzaal' },
        { id: 's3', soort: 'zone', naam: 'Klaslokalen vleugel A', gebouwId: 'g1', opmerkingen: '' }
      ],
      groepen: [
        { id: 'hg1', soort: 'verwarming', naam: 'Ketelgroep stookplaats kelder', gebouwIds: ['g1'], locatieId: 's1', beschrijving: 'Ketel 1 en 2 hydraulisch gekoppeld via collector' },
        { id: 'kg1', soort: 'koeling', naam: 'Koelkring dak', gebouwIds: ['g1'], locatieId: 's2', beschrijving: 'Eén koelmachine, geen andere gekoppelde koelinstallatie' }
      ],
      verwarming: [
        { id: 'v1', naam: 'Ketel 1', type: 'Gasketel', fabrikant: 'Voorbeeldmerk', model: 'CondensPro 180', bouwjaar: '2012', energiedrager: 'Aardgas', vermogenKW: '180',
          hoofdverwarming: 'ja', centraalLokaal: 'centraal', gebouwId: 'g1', locatieId: 's1', gekoppeld: 'ja', groepId: 'hg1', ventilatie: 'nee',
          regelsysteem: 'Cascaderegelaar ketelfabrikant', protocol: 'Modbus RTU', meetpunten: 'Aanvoer-/retourtemperatuur', storingsinfo: 'Storingscodes op display', bijlagen: [], opmerkingen: '' },
        { id: 'v2', naam: 'Ketel 2', type: 'Gasketel', fabrikant: 'Voorbeeldmerk', model: 'CondensPro 180', bouwjaar: '2012', energiedrager: 'Aardgas', vermogenKW: '180',
          hoofdverwarming: 'ja', centraalLokaal: 'centraal', gebouwId: 'g1', locatieId: 's1', gekoppeld: 'ja', groepId: 'hg1', ventilatie: 'nee',
          regelsysteem: 'Cascaderegelaar ketelfabrikant', protocol: 'Modbus RTU', meetpunten: 'Aanvoer-/retourtemperatuur', storingsinfo: 'Storingscodes op display', bijlagen: [], opmerkingen: '' }
      ],
      koeling: [
        { id: 'k1', naam: 'Koelmachine 1', type: 'Luchtgekoelde koelmachine (chiller)', fabrikant: 'Voorbeeldkoeling', model: 'AirChill 90', bouwjaar: '2016', vermogenKW: '90',
          centraalLokaal: 'centraal', gebouwId: 'g1', locatieId: 's2', gekoppeld: 'nee', groepId: 'kg1', ventilatie: 'nee',
          regelsysteem: 'Eigen regelaar', protocol: 'Fabrikantspecifiek', meetpunten: 'Geen', storingsinfo: 'Alarmrelais', bijlagen: [], opmerkingen: '' }
      ],
      snelleChecklist: { Q1: 'deels', Q2: 'nee', Q3: 'nee', Q4: 'onbekend', Q5: 'deels', Q6: 'nee', Q7: 'nee', Q8: 'deels', Q9: 'onbekend', Q10: 'nvt', Q11: 'deels', Q12: 'nee' },
      screening: {
        methode: 'm1', aantalIAQSensoren: '4',
        items: {
          A1: { status: 'ja', bewijs: 'Digitale hoofdmeter met datalogger netbeheerder', opmerking: '' },
          A2: { status: 'nvt', bewijs: '', opmerking: 'Geen injectie: geen eigen productie aanwezig.' },
          A3: { status: 'nvt', bewijs: '', opmerking: 'Geen PV of WKK.' },
          A4: { status: 'nvt', bewijs: '', opmerking: 'Geen elektrische centrale opwekker.' },
          A5: { status: 'ja', bewijs: 'Hoofdgasmeter met pulsuitgang', opmerking: '' },
          A6: { status: 'nvt', bewijs: '', opmerking: 'Eén stookplaats.' },
          A7: { status: 'nvt', bewijs: '', opmerking: 'Enkel aardgas.' },
          A8: { status: 'nvt', bewijs: '', opmerking: 'Geen warmtenet.' },
          A9: { status: 'onbekend', bewijs: '', opmerking: 'Meterspecificaties opvragen.' },
          A10: { status: 'nee', bewijs: '', opmerking: 'Alleen maandelijkse manuele aflezing.' },
          A11: { status: 'nee', bewijs: '', opmerking: '' },
          A12: { status: 'nee', bewijs: '', opmerking: '' },
          B1: { status: 'deels', bewijs: '', opmerking: 'Ketels via Modbus op cascaderegelaar; koelmachine niet gekoppeld.' },
          B2: { status: 'deels', bewijs: '', opmerking: '' },
          B3: { status: 'nee', bewijs: '', opmerking: '' },
          B4: { status: 'nee', bewijs: '', opmerking: '' },
          C1: { status: 'nee' }, C2: { status: 'nee' }, C3: { status: 'nee' }, C4: { status: 'nee' },
          D1: { status: 'deels', bewijs: '', opmerking: 'Storingscodes zichtbaar, geen rendementsbewaking.' },
          D2: { status: 'ja', bewijs: 'Weersafhankelijke cascaderegeling', opmerking: '' },
          D3: { status: 'onbekend', bewijs: '', opmerking: 'Turnzaal heeft radiatoren én koeling: nagaan.' },
          E1: { status: 'nvt', bewijs: '', opmerking: 'Geen hernieuwbare productie of restwarmte.' },
          F1: { status: 'deels', bewijs: '', opmerking: 'Detectie in sanitair en gangen, niet in klassen.' },
          G1: { status: 'deels', bewijs: '', opmerking: 'Kamerthermostaten in 4 zones.' },
          G2: { status: 'nee' }, G3: { status: 'nee' },
          G4: { status: 'nee', bewijs: '', opmerking: '4 meetpunten t.o.v. 29 vereist.' },
          G5: { status: 'nee' }, G6: { status: 'nee' }
        }
      }
    };
  }

  function gemeentehuis() {
    return {
      id: 'voorbeeld-gemeentehuis', voorbeeld: true, modus: 'snel', status: 'concept',
      aangemaakt: '2026-10-05T08:00:00.000Z', gewijzigd: '2026-10-05T10:00:00.000Z',
      klant: { naam: 'Stad Voorbeeldstad (fictief)', contactpersoon: 'Jan Claes', contactEmail: '', contactTel: '' },
      site: { naam: 'Administratief centrum (voorbeeld)', adres: 'Markt 10, 9998 Voorbeeldstad' },
      bezoek: { datum: '2026-10-05', adviseur: 'Voorbeeldadviseur' },
      opmerkingen: 'Twee gebouwen. Koppeling van de ketel in het annexgebouw is nog niet bevestigd.',
      gebouwen: [
        { id: 'g1', naam: 'Stadhuis', type: 'Gemeentehuis', bouwjaar: '1995', oppervlakte: '4800', geklimatiseerdeOppervlakte: '4200', nieuwBestaand: 'bestaand', nietResidentieel: 'ja',
          eigenaarGebouw: 'Stad Voorbeeldstad', eigenaarInstallaties: 'Stad Voorbeeldstad', gebruiker: 'Stadsdiensten', heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'ja', heeftVentilatie: 'ja',
          uitzondering: { ingeroepen: false, bijlagen: [] }, bijzondereSituaties: '' },
        { id: 'g2', naam: 'Annex', type: 'Administratief centrum', bouwjaar: '', oppervlakte: '900', geklimatiseerdeOppervlakte: '', nieuwBestaand: 'bestaand', nietResidentieel: 'ja',
          eigenaarGebouw: 'Stad Voorbeeldstad', eigenaarInstallaties: '', gebruiker: 'OCMW', heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'nee', heeftVentilatie: 'onbekend',
          uitzondering: { ingeroepen: false, bijlagen: [] }, bijzondereSituaties: 'Annex wordt mogelijk afgebroken in 2028.' }
      ],
      structuur: [{ id: 's1', soort: 'stookplaats', naam: 'Stookplaats stadhuis', gebouwId: 'g1' }, { id: 's2', soort: 'stookplaats', naam: 'Stookplaats annex', gebouwId: 'g2' }],
      groepen: [
        { id: 'hg1', soort: 'verwarming', naam: 'Ketelgroep stadhuis', gebouwIds: ['g1'], locatieId: 's1' },
        { id: 'kg1', soort: 'koeling', naam: 'VRF stadhuis', gebouwIds: ['g1'] }
      ],
      verwarming: [
        { id: 'v1', naam: 'Ketel A', type: 'Gasketel', vermogenKW: '250', hoofdverwarming: 'ja', centraalLokaal: 'centraal', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'hg1', energiedrager: 'Aardgas' },
        { id: 'v2', naam: 'Warmtepomp A', type: 'Warmtepomp', vermogenKW: '60', hoofdverwarming: 'ja', centraalLokaal: 'centraal', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'hg1', energiedrager: 'Elektriciteit' },
        { id: 'v3', naam: 'Ketel annex', type: 'Gasketel', vermogenKW: '', hoofdverwarming: 'ja', centraalLokaal: 'centraal', gebouwId: 'g2', gekoppeld: 'onbekend', groepId: '', energiedrager: 'Aardgas' }
      ],
      koeling: [
        { id: 'k1', naam: 'VRF buitenunit 1', type: 'VRF/VRV-systeem', vermogenKW: '56', centraalLokaal: 'centraal', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'kg1' },
        { id: 'k2', naam: 'VRF buitenunit 2', type: 'VRF/VRV-systeem', vermogenKW: '56', centraalLokaal: 'centraal', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'kg1' },
        { id: 'k3', naam: 'Split serverlokaal', type: 'Split-/multisplitsysteem', vermogenKW: '7,1', centraalLokaal: 'lokaal', gebouwId: 'g1', gekoppeld: 'nee', groepId: '' }
      ],
      snelleChecklist: { Q1: 'ja', Q2: 'deels', Q3: 'nee', Q4: 'onbekend', Q5: 'ja', Q6: 'deels', Q7: 'nee', Q8: 'onbekend', Q9: 'ja', Q10: 'nvt', Q11: 'deels', Q12: 'deels' },
      screening: { methode: 'm1', items: {} }
    };
  }

  function woonzorg() {
    return {
      id: 'voorbeeld-wzc', voorbeeld: true, modus: 'snel', status: 'afgerond',
      aangemaakt: '2026-09-22T08:00:00.000Z', gewijzigd: '2026-09-22T12:00:00.000Z',
      klant: { naam: 'vzw Zorg Voorbeeld (fictief)', contactpersoon: 'Sara Wouters' },
      site: { naam: 'Woonzorgcentrum Hof ten Voorbeeld', adres: 'Zorglaan 5, 9997 Voorbeeldberg' },
      bezoek: { datum: '2026-09-22', adviseur: 'Voorbeeldadviseur' },
      opmerkingen: 'Onder 290 kW, maar boven 70 kW.',
      gebouwen: [{ id: 'g1', naam: 'Woonzorgcentrum', type: 'Woonzorgcentrum', bouwjaar: '2008', oppervlakte: '2600', geklimatiseerdeOppervlakte: '2300', nieuwBestaand: 'bestaand', nietResidentieel: 'ja',
        eigenaarGebouw: 'vzw Zorg Voorbeeld', eigenaarInstallaties: 'Energiedienstenbedrijf (ESCO-contract)', gebruiker: 'vzw Zorg Voorbeeld', heeftRuimteverwarming: 'ja', heeftRuimtekoeling: 'ja', heeftVentilatie: 'ja',
        uitzondering: { ingeroepen: false, bijlagen: [] }, bijzondereSituaties: 'Installaties in eigendom van ESCO: verplichting ligt vermoedelijk bij de ESCO.' }],
      structuur: [],
      groepen: [{ id: 'hg1', soort: 'verwarming', naam: 'Ketels', gebouwIds: ['g1'] }],
      verwarming: [
        { id: 'v1', naam: 'Ketel 1', type: 'Gasketel', vermogenKW: '120', hoofdverwarming: 'ja', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'hg1', energiedrager: 'Aardgas' },
        { id: 'v2', naam: 'Ketel 2', type: 'Gasketel', vermogenKW: '120', hoofdverwarming: 'ja', gebouwId: 'g1', gekoppeld: 'ja', groepId: 'hg1', energiedrager: 'Aardgas' }
      ],
      koeling: [{ id: 'k1', naam: 'Koelmachine', type: 'Luchtgekoelde koelmachine (chiller)', vermogenKW: '85', gebouwId: 'g1', gekoppeld: 'nee', groepId: '' }],
      snelleChecklist: { Q1: 'ja', Q2: 'ja', Q3: 'ja', Q4: 'onbekend', Q5: 'ja', Q6: 'ja', Q7: 'deels', Q8: 'deels', Q9: 'ja', Q10: 'nvt', Q11: 'ja', Q12: 'deels' },
      screening: { methode: 'm1', items: {} }
    };
  }

  return { school: school, gemeentehuis: gemeentehuis, woonzorg: woonzorg, alle: function () { return [school(), gemeentehuis(), woonzorg()]; } };
});
