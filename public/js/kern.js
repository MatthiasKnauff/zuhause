// Grundbausteine: DOM-Helfer, Server-Zugriff, Live-Aktualisierung, Meldungen, Dialoge, Formate

/** Element bauen: h('div', {class:'x', onclick: f}, 'Text', kind, [kinder]) – Texte werden nie als HTML gesetzt */
export function h(tag, attr, ...kinder) {
  const el = document.createElementNS(tag.startsWith('svg:') ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag.replace('svg:', ''));
  if (attr) for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  anhaengen(el, kinder);
  return el;
}
function anhaengen(el, kinder) {
  for (const k of kinder) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) anhaengen(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const leeren = (el, ...k) => { el.replaceChildren(); anhaengen(el, k); return el; };

/** kleine Symbole (Strich-Icons) */
const PFADE = {
  haus: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  raum: 'M4 20V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v15M2 20h20M9 20v-6h6v6',
  licht: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  heizung: 'M5 21V8a2 2 0 0 1 4 0v13M10 21V8a2 2 0 0 1 4 0v13M15 21V8a2 2 0 0 1 4 0v13M3 21h18',
  energie: 'M13 2L4 14h7l-1 8 9-12h-7z',
  geraete: 'M4 6h16v10H4zM8 20h8M12 16v4',
  mehr: 'M5 12h.01M12 12h.01M19 12h.01',
  benutzer: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  stern: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  griff: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  plus: 'M12 5v14M5 12h14',
  suche: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  thermo: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  tropfen: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z',
  stecker: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  fenster: 'M4 4h16v16H4zM12 4v16M4 12h16',
  stift: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  pfeil: 'M9 6l6 6-6 6',
  zurueck: 'M15 6l-6 6 6 6',
  schliessen: 'M6 6l12 12M18 6L6 18',
  kalender: 'M4 6h16v14H4zM4 10h16M9 3v5M15 3v5',
  koffer: 'M4 8h16v12H4zM9 8V5h6v3',
  abmelden: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  welle: 'M3 12h3l3-7 4 14 3-7h5',
};
export function icon(name, groesse = 18, extra = {}) {
  const s = h('svg:svg', { viewBox: '0 0 24 24', width: groesse, height: groesse, fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'mehr' || name === 'griff' ? 3.2 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...extra });
  s.append(h('svg:path', { d: PFADE[name] || '' }));
  return s;
}

// ------------------------------------------------------------------ Server
export async function api(pfad, methode = 'GET', koerper) {
  const opt = { method: methode, headers: { 'X-Zuhause': '1' }, credentials: 'same-origin' };
  if (koerper !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(koerper); }
  const r = await fetch('/api/' + pfad, opt);
  let d = null; try { d = await r.json(); } catch (e) { /* leer */ }
  if (r.status === 401 && pfad !== 'anmelden') { window.dispatchEvent(new Event('abgemeldet')); throw new Error('Bitte neu anmelden'); }
  if (!r.ok) throw new Error((d && d.fehler) || 'Fehler ' + r.status);
  return d;
}

/** Befehl an ein Item – mit Meldung, falls es nicht klappt */
export async function befehl(name, wert) {
  try { await api('item/' + name, 'POST', { wert: String(wert) }); }
  catch (e) { melde('Konnte nicht schalten: ' + e.message, true); throw e; }
}

// ------------------------------------------------------------------ Meldungen
export function melde(text, fehler = false) {
  const box = document.getElementById('meldungen');
  const m = h('div', { class: 'meldung' + (fehler ? ' fehler' : '') }, text);
  box.append(m);
  setTimeout(() => m.classList.add('weg'), fehler ? 5000 : 2600);
  setTimeout(() => m.remove(), fehler ? 5600 : 3200);
}

// ------------------------------------------------------------------ Dialog
export function dialog(titel, inhalt, { knoepfe = [], breit = false, beimSchliessen, extras = [] } = {}) {
  const d = h('dialog', { class: 'dialog' + (breit ? ' breit' : '') });
  const zu = () => { d.close(); };
  d.addEventListener('close', () => { d.remove(); if (beimSchliessen) beimSchliessen(); });
  d.addEventListener('click', (e) => { if (e.target === d) zu(); });
  d.append(...[
    h('div', { class: 'dialog-kopf' }, h('h2', null, titel), h('span', { class: 'dialog-extras' }, extras.filter(Boolean), h('button', { class: 'rund', 'aria-label': 'Schließen', onclick: zu }, icon('schliessen', 16)))),
    h('div', { class: 'dialog-inhalt' }, inhalt),
    knoepfe.length ? h('div', { class: 'dialog-fuss' }, knoepfe.map((k) => h('button', { class: k.klasse || 'knopf', onclick: async () => { try { const r = await k.aktion(); if (r !== false) zu(); } catch (e) { melde(e.message, true); } } }, k.text))) : null,
  ].filter(Boolean));
  document.body.append(d);
  d.showModal();
  return { schliessen: zu, el: d };
}

// ------------------------------------------------------------------ Formate
const DE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const DE2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
export const zahl = (s) => { const m = /^-?[\d.]+(?:E-?\d+)?/i.exec(String(s ?? '')); return m ? Number(m[0]) : NaN; };
export const einheit = (s) => { const m = /^-?[\d.]+(?:E-?\d+)?\s*(.*)$/i.exec(String(s ?? '')); return m ? m[1] : ''; };
export const de = (n, stellen = 1) => (Number.isFinite(n) ? (stellen === 2 ? DE2 : stellen === 0 ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }) : DE).format(n) : '–');
export const leer = (s) => s === undefined || s === null || s === 'NULL' || s === 'UNDEF' || s === '';
export const zeit = (iso) => { const d = new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
export const TAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
export const TAGKURZ = { mo: 'Mo', di: 'Di', mi: 'Mi', do: 'Do', fr: 'Fr', sa: 'Sa', so: 'So' };
export const TAGLANG = { mo: 'Montag', di: 'Dienstag', mi: 'Mittwoch', do: 'Donnerstag', fr: 'Freitag', sa: 'Samstag', so: 'Sonntag' };
export const zuMin = (t) => { const [a, b] = String(t).split(':').map(Number); return a * 60 + b; };
export const zuHHMM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const datumKurz = (iso) => { const d = new Date(iso + 'T12:00'); return TAGKURZ[TAGE[(d.getDay() + 6) % 7]] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; };
export const grad = (n) => de(n) + ' °C';

// ------------------------------------------------------------------ Live: Bereiche, die sich bei Zustandsänderungen neu zeichnen
let sammler = null;
const bereiche = new Set();
/** Wert lesen und merken, dass der aktuelle Bereich davon abhängt */
export function merke(name) { if (sammler && name) sammler.add(name); }
/** Bereich, der sich selbst neu zeichnet, wenn sich eines der darin gelesenen Items ändert */
export function live(baue, klasse = 'live') {
  const el = h('div', { class: klasse });
  const b = { el, baue, namen: new Set() };
  zeichne(b);
  bereiche.add(b);
  return el;
}
function zeichne(b) {
  const alt = sammler; sammler = new Set();
  try { leeren(b.el, b.baue()); } catch (e) { console.error(e); leeren(b.el, h('div', { class: 'leise' }, 'Anzeige-Fehler: ' + e.message)); }
  b.namen = sammler; sammler = alt;
}
let bedient = null;   // Bereich, in dem gerade ein Regler gezogen wird – nicht unter dem Finger neu zeichnen
document.addEventListener('pointerdown', (e) => { bedient = e.target.closest && e.target.closest('.live'); });
document.addEventListener('pointerup', () => { setTimeout(() => { bedient = null; }, 400); });
document.addEventListener('pointercancel', () => { bedient = null; });
let offen = new Set(); let geplant = false;
export function geaendert(name) {
  offen.add(name);
  if (geplant) return; geplant = true;
  setTimeout(() => {
    geplant = false; const n = offen; offen = new Set();
    for (const b of [...bereiche]) {
      if (!b.el.isConnected) { bereiche.delete(b); continue; }
      if (![...n].some((x) => b.namen.has(x))) continue;
      const beschaeftigt = b.el === bedient || (bedient && (b.el.contains(bedient) || bedient.contains(b.el))) || (b.el.contains(document.activeElement) && document.activeElement.matches('input[type=text],input[type=number],input[type=time],input[type=search],select'));
      if (beschaeftigt) { for (const x of n) if (b.namen.has(x)) geaendert(x); continue; }   // später nachholen
      zeichne(b);
    }
  }, bedient ? 450 : 120);
}
export function allesNeu() { for (const b of [...bereiche]) { if (!b.el.isConnected) bereiche.delete(b); else zeichne(b); } }
export function bereicheLeeren() { for (const b of [...bereiche]) if (!b.el.isConnected) bereiche.delete(b); }

/** Wert gedrosselt senden (Regler): sofort der erste, dann höchstens alle 300 ms, der letzte immer */
export function gedrosselt(f, ms = 300) {
  let t = 0, warte = null, letzt;
  return (...a) => {
    letzt = a; const jetzt = Date.now();
    if (jetzt - t >= ms) { t = jetzt; f(...a); return; }
    clearTimeout(warte); warte = setTimeout(() => { t = Date.now(); f(...letzt); }, ms - (jetzt - t));
  };
}

/** Farben: HSB (openHAB) ↔ CSS */
export function hsbZuCss(hsb, mindestHell = 45) {
  const [hh, s, b] = String(hsb).split(',').map(Number);
  if (![hh, s, b].every(Number.isFinite)) return '#ccc';
  const l = (b / 100) * (1 - s / 200); const sl = l === 0 || l === 1 ? 0 : ((b / 100) - l) / Math.min(l, 1 - l);
  return `hsl(${hh} ${Math.round(sl * 100)}% ${Math.max(mindestHell, Math.round(l * 100))}%)`;
}
export function hexZuHsb(hex) {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = Math.round(hh * 60 + 360) % 360;
  return `${hh},${max ? Math.round(d / max * 100) : 0},${Math.round(max * 100)}`;
}
export function hsbZuHex(hsb) {
  const [hh, s, v] = String(hsb).split(',').map(Number); const S = s / 100, V = v / 100;
  const f = (n) => { const k = (n + hh / 60) % 6; return Math.round((V - V * S * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Farbtemperatur (Kelvin) als Anzeigefarbe */
export function kelvinCss(k) {
  const t = Math.max(0, Math.min(1, (k - 2200) / (6500 - 2200)));
  const hue = 32 + t * 180; const sat = 90 - t * 70; return `hsl(${hue} ${sat}% ${78 + t * 10}%)`;
}

// ------------------------------------------------------------------ Verlauf als kleines Liniendiagramm (SVG, ohne Bibliothek)
/** punkte: [[zeitMs, wert], …]; klein = nur Linie (Sparkline), sonst mit Achsen, Min/Max und Zeitmarken */
export function verlaufBild(punkte, { einheit = '', klein = false, stellen = 1, breite = 600, zweite = null } = {}) {
  // Zeichenfläche in echten Pixeln der Box, damit die Schrift am Handy und am großen Bildschirm gleich groß bleibt
  const B = Math.max(260, Math.round(breite)), H = klein ? 60 : Math.round(Math.min(240, Math.max(170, B * 0.32))), L = klein ? 0 : 44, R = klein ? 0 : 8, O = klein ? 4 : 10, U = klein ? 4 : 24;
  const svg = h('svg:svg', { viewBox: `0 0 ${B} ${H}`, class: 'verlauf' + (klein ? ' klein' : ''), preserveAspectRatio: klein ? 'none' : 'xMidYMid meet', role: 'img' });
  if (!punkte || punkte.length < 2) { if (!klein) svg.append(h('svg:text', { x: B / 2, y: H / 2, 'text-anchor': 'middle', class: 'v-text' }, 'Kein Verlauf gespeichert')); return svg; }
  const t0 = punkte[0][0], t1 = punkte[punkte.length - 1][0];
  const alleW = punkte.concat(zweite || []).map((p) => p[1]);
  let min = Math.min(...alleW), max = Math.max(...alleW);
  if (max - min < 0.5) { max += 0.25; min -= 0.25; }
  const x = (t) => L + (t - t0) / (t1 - t0 || 1) * (B - L - R);
  const y = (v) => O + (1 - (v - min) / (max - min)) * (H - O - U);
  const linie = punkte.map(([t, v], i) => (i ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  svg.append(h('svg:path', { d: linie + ` L ${x(t1).toFixed(1)} ${H - U} L ${x(t0).toFixed(1)} ${H - U} Z`, class: 'v-flaeche' }), h('svg:path', { d: linie, class: 'v-linie', 'vector-effect': 'non-scaling-stroke' }));
  // zweite Linie (z. B. Soll zur Ist-Temperatur) als Treppe, gestrichelt
  if (zweite && zweite.length > 1) {
    const z = zweite.filter(([t]) => t >= t0 && t <= t1);
    const d = z.map(([t, v], i) => (i ? 'H' + x(t).toFixed(1) + ' V' : 'M' + x(t).toFixed(1) + ' ') + y(v).toFixed(1)).join(' ') + (z.length ? ' H' + x(t1).toFixed(1) : '');
    svg.append(h('svg:path', { d, class: 'v-linie2', 'vector-effect': 'non-scaling-stroke' }));
  }
  if (klein) return svg;
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(h('svg:line', { x1: L, x2: B - R, y1: y(v), y2: y(v), class: 'v-gitter', 'vector-effect': 'non-scaling-stroke' }),
      h('svg:text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'v-text' }, de(v, stellen) + (einheit === '%' ? ' %' : einheit === '°C' ? '°' : '')));
  }
  const tage = (t1 - t0) > 36 * 3600e3;
  for (let i = 0; i <= 4; i++) {
    const t = t0 + (t1 - t0) * i / 4; const d = new Date(t);
    svg.append(h('svg:text', { x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', class: 'v-text' },
      tage ? d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' }) : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })));
  }
  return svg;
}
