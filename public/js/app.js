// Start der App: Anmeldung, Darstellung, Navigation (PC oben, Handy unten), Seitenwechsel, Live-Verbindung
import { h, icon, api, melde, leeren, geaendert, allesNeu, bereicheLeeren } from './kern.js';
import { M, S, aufbauen } from './modell.js';
import { startSeite } from './start.js';
import { heizungSeite } from './heizung.js';
import { raeumeSeite, lichtSeite, energieSeite, geraeteSeite, einstellungenSeite, kuerzel } from './seiten.js';

const app = document.getElementById('app');
const HANDY_BREITE = 760;

const SEITEN = [
  { id: 'start', name: 'Start', sym: 'haus' },
  { id: 'raeume', name: 'Räume', sym: 'raum' },
  { id: 'licht', name: 'Licht', sym: 'licht' },
  { id: 'heizung', name: 'Heizung', sym: 'heizung' },
  { id: 'energie', name: 'Energie', sym: 'energie' },
  { id: 'geraete', name: 'Geräte', sym: 'geraete' },
  { id: 'einstellungen', name: 'Benutzer', sym: 'benutzer' },
];
const UNTEN = ['start', 'raeume', 'licht', 'heizung'];

// ------------------------------------------------------------------ Darstellung (Farbschema je Benutzer)
export function darstellungAnwenden() {
  const d = (S.ich && S.ich.darstellung) || { schema: 'hell', akzent: '#ea580c', schrift: 'normal' };
  const std = new Date().getHours();
  const nacht = d.nachtDunkel && (std >= 21 || std < 7);
  const schema = nacht ? 'dunkel' : d.schema;
  const r = document.documentElement;
  r.dataset.schema = schema; r.dataset.schrift = d.schrift;
  r.style.setProperty('--akzent', d.akzent);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(r).getPropertyValue('--grund').trim() || '#f4f6f9';
}
setInterval(darstellungAnwenden, 60e3);

// ------------------------------------------------------------------ Anmeldung
function anmeldeSeite(fehler) {
  darstellungAnwenden();
  const name = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', 'aria-label': 'Benutzername', placeholder: 'Benutzername', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Passwort', placeholder: 'Passwort', required: true });
  const meldung = h('p', { class: 'fehlertext', role: 'alert' }, fehler || '');
  const form = h('form', { class: 'anmelden karte', onsubmit: async (e) => {
    e.preventDefault(); meldung.textContent = '';
    try { await api('anmelden', 'POST', { benutzer: name.value, passwort: pw.value }); starten(); }
    catch (x) { meldung.textContent = x.message; pw.select(); }
  } },
  h('div', { class: 'logo gross' }, h('span', { class: 'logo-sym' }, icon('haus', 26)), 'Zuhause'),
  name, pw, meldung, h('button', { class: 'knopf voll', type: 'submit' }, 'Anmelden'));
  leeren(app, h('div', { class: 'anmelde-seite' }, form));
  name.focus();
}

// ------------------------------------------------------------------ Gerüst
let hauptEl = null; let verbunden = true;
function geruest() {
  const admin = S.ich.benutzer.rolle === 'admin';
  const seiten = SEITEN.map((s) => (s.id === 'einstellungen' && !admin ? { ...s, name: 'Einstellungen' } : s));
  const oben = h('header', { class: 'kopfleiste' },
    h('a', { class: 'logo', href: '#/start' }, h('span', { class: 'logo-sym' }, icon('haus', 18)), 'Zuhause'),
    h('nav', { class: 'nav-oben', 'aria-label': 'Hauptmenü' }, seiten.map((s) => h('a', { href: '#/' + s.id, dataset: { seite: s.id } }, s.name))),
    h('div', { class: 'kopf-status' }, h('span', { class: 'verbindung', id: 'verbindung' }), h('a', { class: 'kuerzel', href: '#/einstellungen', title: S.ich.benutzer.name }, kuerzel(S.ich.benutzer.name))));
  const unten = h('nav', { class: 'nav-unten', 'aria-label': 'Hauptmenü' },
    UNTEN.map((id) => { const s = SEITEN.find((x) => x.id === id); return h('a', { href: '#/' + s.id, dataset: { seite: s.id } }, icon(s.sym, 22), h('span', null, s.name)); }),
    h('button', { dataset: { seite: 'mehr' }, onclick: mehrMenue }, icon('mehr', 22), h('span', null, 'Mehr')));
  hauptEl = h('main', { class: 'haupt', id: 'haupt' });
  leeren(app, oben, hauptEl, unten);
  verbindungZeigen();
}
function mehrMenue() {
  const admin = S.ich.benutzer.rolle === 'admin';
  const zu = () => m.remove();
  const m = h('div', { class: 'mehr-hintergrund', onclick: (e) => { if (e.target === m) zu(); } },
    h('div', { class: 'mehr-blatt' },
      ['energie', 'geraete', 'einstellungen'].map((id) => { const s = SEITEN.find((x) => x.id === id); return h('a', { href: '#/' + id, onclick: zu }, icon(s.sym, 20), id === 'einstellungen' ? (admin ? 'Benutzer & Einstellungen' : 'Einstellungen') : s.name); }),
      h('button', { onclick: async () => { await api('abmelden', 'POST', {}); location.reload(); } }, icon('abmelden', 20), 'Abmelden')));
  document.body.append(m);
}
function verbindungZeigen() {
  const el = document.getElementById('verbindung'); if (!el) return;
  leeren(el, h('span', { class: 'status-punkt ' + (verbunden ? 'gruen' : 'rot') }), h('span', { class: 'nur-pc' }, verbunden ? 'openHAB verbunden' : 'openHAB getrennt'));
  document.body.classList.toggle('getrennt', !verbunden);
}

// ------------------------------------------------------------------ Seitenwechsel
let letzteAnsicht = null;
async function zeigen() {
  if (!hauptEl) return;
  const [id = 'start', arg] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const neu = innerWidth < HANDY_BREITE ? 'handy' : 'pc';
  S.ansicht = neu; letzteAnsicht = neu;
  for (const a of document.querySelectorAll('[data-seite]')) a.classList.toggle('aktiv', a.dataset.seite === id || (a.dataset.seite === 'mehr' && ['energie', 'geraete', 'einstellungen'].includes(id)));
  document.querySelector('.mehr-hintergrund')?.remove();
  bereicheLeeren();
  const ziel = h('div', { class: 'seite seite-' + id });
  leeren(hauptEl, ziel);
  window.scrollTo(0, 0);
  try {
    if (id === 'raeume') raeumeSeite(ziel, arg);
    else if (id === 'licht') lichtSeite(ziel);
    else if (id === 'heizung') await heizungSeite(ziel);
    else if (id === 'energie') energieSeite(ziel);
    else if (id === 'geraete') geraeteSeite(ziel);
    else if (id === 'einstellungen') await einstellungenSeite(ziel);
    else startSeite(ziel);
  } catch (e) { console.error(e); leeren(ziel, h('div', { class: 'karte fehlerbox' }, 'Die Seite konnte nicht angezeigt werden: ' + e.message)); }
  document.title = (SEITEN.find((s) => s.id === id) || SEITEN[0]).name + ' · Zuhause';
}
window.addEventListener('hashchange', zeigen);
let rz = null;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if ((innerWidth < HANDY_BREITE ? 'handy' : 'pc') !== letzteAnsicht) zeigen(); }, 250); });

// ------------------------------------------------------------------ Live-Verbindung
let quelle = null;
function liveVerbinden() {
  if (quelle) quelle.close();
  quelle = new EventSource('/api/ereignisse');
  quelle.addEventListener('zustand', (e) => {
    const { name, state } = JSON.parse(e.data);
    const i = M.items.get(name); if (!i) return;
    i.state = state;
    if (name === 'Heizplan_Status' && S.heizung) { try { S.heizung.status = JSON.parse(state); } catch (x) { /* egal */ } }
    geaendert(name);
  });
  quelle.addEventListener('modell', async () => { try { aufbauen(await api('items')); allesNeu(); } catch (x) { /* nächstes Mal */ } });
  quelle.addEventListener('verbindung', (e) => { verbunden = JSON.parse(e.data).verbunden; verbindungZeigen(); });
  quelle.onopen = () => { if (!verbunden) { verbunden = true; verbindungZeigen(); } };
  quelle.onerror = () => { verbunden = false; verbindungZeigen(); };
}
// Nach dem Aufwachen (Handy) alles frisch holen
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.ich) return;
  try { aufbauen(await api('items')); allesNeu(); darstellungAnwenden(); } catch (e) { /* abgemeldet → Anmeldeseite */ }
  if (!quelle || quelle.readyState === 2) liveVerbinden();
});
window.addEventListener('abgemeldet', () => { if (quelle) quelle.close(); S.ich = null; hauptEl = null; anmeldeSeite('Bitte (neu) anmelden.'); });

async function starten() {
  try { S.ich = await api('ich'); } catch (e) { anmeldeSeite(); return; }
  darstellungAnwenden();
  const [items, lampen, status] = await Promise.all([api('items'), api('lampen').catch(() => ({})), api('status').catch(() => null)]);
  aufbauen(items); S.lampen = lampen; S.status = status;
  if (status) verbunden = status.openhab.verbunden;
  try { S.heizung = await api('heizung'); } catch (e) { S.heizung = null; }
  geruest();
  liveVerbinden();
  await zeigen();
  if (!items.length) melde('openHAB liefert noch keine Daten – Verbindung prüfen', true);
}
starten();
