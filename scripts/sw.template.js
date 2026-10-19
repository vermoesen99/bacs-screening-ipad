/*
 * Service worker van BACS-screening (gegenereerd door scripts/build.js — niet rechtstreeks aanpassen).
 * - Bewaart alle app-bestanden lokaal, zodat de app volledig offline werkt.
 * - Lettertypes van Google Fonts worden bij het eerste gebruik bewaard; offline vallen ze terug op systeemlettertypes.
 * - Een nieuwe versie wacht tot de gebruiker op "Herladen" tikt.
 * De dossiers zelf staan NIET in deze cache maar in IndexedDB op het toestel.
 */
const VERSIE = '__VERSIE__';
const CACHE = 'bacs-app-' + VERSIE;
const FONT_CACHE = 'bacs-fonts';
const BESTANDEN = __BESTANDEN__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Lettertypes: uit de cache, op de achtergrond vernieuwen.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App-bestanden: eerst de cache (snel en offline), anders het netwerk.
  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('index.html').then((idx) => idx || fetch(req));
        return fetch(req);
      })
    )
  );
});
