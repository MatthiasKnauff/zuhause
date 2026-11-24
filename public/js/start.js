// Startseite: frei zusammenstellbar, getrennt für PC und Handy.
// PC: am Griff ziehen · Handy: lange drücken und ziehen · Ecke unten rechts = Größe · × = entfernen
import { h, icon, live, api, melde, dialog, leeren, zahl, de, grad } from './kern.js';
import { M, S, st, item, lichter, lichtAn, aussenTemp, punktName } from './modell.js';
import { geraetInhalt, heizInhalt, alleLichterInhalt, hausInhalt, heuteInhalt, raumInhalt, kopf, kipp, wertText } from './widgets.js';
import { befehl } from './kern.js';

const BESONDERE = [
  { art: 'alleLichter', name: 'Alle Lichter', text: 'Schalter: links aus, rechts an' },
  { art: 'haus', name: 'Ganzes Haus', text: 'Eco · Automatik · Komfort' },
  { art: 'heuteAnders', name: 'Heute anders', text: 'Heizung heute nach anderer Vorlage' },
];
const neueId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const liste = () => S.ich.start[S.ansicht];
const passt = (e, art, ref) => e.art === art && (e.ref || null) === (ref || null);
export const aufStart = (art, ref) => liste().some((e) => passt(e, art, ref));

async function speichern() {
  try { await api('ich/start/' + S.ansicht, 'PUT', { elemente: liste() }); }   // die Objekte bleiben dieselben – Karten halten Verweise darauf
  catch (e) { melde('Startseite nicht gespeichert: ' + e.message, true); }
}

/** Stern auf anderen Seiten: Element auf die Startseite (dieses Geräts) legen oder wieder herunternehmen */
export function stern(art, ref, groesse = 's') {
  const an = aufStart(art, ref);
  return h('button', {
    class: 'stern' + (an ? ' an' : ''), title: an ? 'Von der Startseite nehmen' : 'Auf die Startseite', 'aria-pressed': an ? 'true' : 'false',
    onclick: async (e) => {
      e.stopPropagation();
      if (aufStart(art, ref)) S.ich.start[S.ansicht] = liste().filter((x) => !passt(x, art, ref));
      else liste().push({ id: neueId(), art, ...(ref ? { ref } : {}), groesse });
      const btn = e.currentTarget; const jetzt = aufStart(art, ref);
      btn.classList.toggle('an', jetzt); btn.setAttribute('aria-pressed', jetzt ? 'true' : 'false'); btn.querySelector('svg').setAttribute('fill', jetzt ? 'currentColor' : 'none');
      await speichern();
      melde(aufStart(art, ref) ? 'Auf der Startseite (' + (S.ansicht === 'pc' ? 'PC' : 'Handy') + ')' : 'Von der Startseite genommen');
    },
  }, icon('stern', 18, { fill: an ? 'currentColor' : 'none' }));
}

// ------------------------------------------------------------------ Inhalt eines Elements
function inhalt(e) {
  const g = e.ref && M.geraete.get(e.ref);
  switch (e.art) {
    case 'geraet': return g ? live(() => geraetInhalt(g, e.groesse, true)) : fehlt(e);
    case 'heizung': return g ? live(() => heizInhalt(g, e.groesse)) : fehlt(e);
    case 'raum': { const r = M.raeume.find((x) => x.name === e.ref); return r ? h('a', { class: 'ganz', href: '#/raeume/' + encodeURIComponent(r.name) }, live(() => raumInhalt(r))) : fehlt(e); }
    case 'punkt': {
      const i = item(e.ref); if (!i) return fehlt(e);
      const geraetName = [...M.geraete.values()].find((x) => x.alle.includes(i.name));
      return live(() => kopf(punktName(i), geraetName ? geraetName.label : '', i.type === 'Switch' && !i.readOnly ? kipp(st(i.name) === 'ON', (x) => befehl(i.name, x ? 'ON' : 'OFF'), punktName(i)) : h('span', { class: 'gross' }, wertText(i))));
    }
    case 'alleLichter': return live(() => alleLichterInhalt());
    case 'haus': return live(() => hausInhalt());
    case 'heuteAnders': return live(() => heuteInhalt(() => neuZeichnen()));
    default: return fehlt(e);
  }
}
const fehlt = (e) => h('div', { class: 'leise' }, '„' + (e.ref || e.art) + '“ gibt es in openHAB nicht mehr.');

// ------------------------------------------------------------------ Seite
let raster = null; let neuZeichnen = () => {};

export function startSeite(ziel) {
  const name = S.ich.benutzer.name;
  const std = new Date().getHours();
  const gruss = std < 11 ? 'Guten Morgen' : std < 18 ? 'Guten Tag' : 'Guten Abend';
  const pc = S.ansicht === 'pc';
  const kopfzeile = h('div', { class: 'seitenkopf' },
    h('div', null, h('h1', null, gruss + ', ' + name), live(() => {
      const t = aussenTemp(); const an = lichter().filter((g) => lichtAn(g)).length;
      return h('p', { class: 'leise' }, [new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }), Number.isFinite(t) ? 'draußen ' + grad(t) : null, an === 1 ? '1 Lampe an' : an + ' Lampen an'].filter(Boolean).join(' · '));
    })),
    h('div', { class: 'kopf-rechts' },
      h('span', { class: 'leise klein nur-pc' }, 'Am Griff verschieben · Ecke zieht die Größe · × entfernt'),
      h('span', { class: 'leise klein nur-handy' }, 'Lange drücken zum Verschieben'),
      h('button', { class: 'knopf leicht', onclick: () => (pc ? panelUmschalten() : hinzufuegenDialog()) }, icon('plus', 16), pc ? 'Elemente hinzufügen' : 'Hinzufügen')));
  raster = h('div', { class: 'raster', id: 'raster' });
  const panel = h('aside', { class: 'panel', id: 'panel', hidden: !panelOffen || !pc });
  neuZeichnen = () => {
    leeren(raster, liste().map(karte));
    if (!liste().length) raster.append(h('div', { class: 'leer-hinweis' }, 'Noch leer. ', pc ? 'Zieh Elemente aus der Liste rechts hierher.' : 'Tippe auf „Hinzufügen“ oder auf den Stern bei einem Gerät.'));
    if (pc && panelOffen) panelFuellen(panel);
  };
  neuZeichnen();
  leeren(ziel, h('div', { class: 'start' + (panelOffen && pc ? ' mit-panel' : '') }, h('section', { class: 'start-haupt' }, kopfzeile, raster), panel));
}

function karte(e) {
  const k = h('div', { class: 'karte el g-' + e.groesse, dataset: { id: e.id } });
  const griff = h('span', { class: 'griff nur-pc', title: 'Ziehen zum Verschieben', 'aria-hidden': 'true' }, icon('griff', 14));
  const weg = h('button', { class: 'weg', 'aria-label': 'Von der Startseite entfernen', title: 'Von der Startseite entfernen', onclick: (ev) => { ev.stopPropagation(); S.ich.start[S.ansicht] = liste().filter((x) => x.id !== e.id); k.remove(); speichern(); } }, '×');
  const ecke = h('span', { class: 'ecke', title: 'Ziehen: klein · mittel · groß', 'aria-hidden': 'true' });
  k.append(griff, weg, inhalt(e), ecke);
  griff.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ziehenStart(ev, k, e); });
  ecke.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); groesseStart(ev, k, e); });
  // Handy: lange drücken
  let timer = null, p0 = null;
  k.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || ev.target.closest('.ecke,.weg,input')) return;
    p0 = [ev.clientX, ev.clientY];
    timer = setTimeout(() => { timer = null; if (navigator.vibrate) navigator.vibrate(15); ziehenStart(ev, k, e, true); }, 450);
  });
  const abbruch = (ev) => { if (timer && (!p0 || ev.type !== 'pointermove' || Math.hypot(ev.clientX - p0[0], ev.clientY - p0[1]) > 8)) { clearTimeout(timer); timer = null; } };
  k.addEventListener('pointermove', abbruch); k.addEventListener('pointerup', abbruch); k.addEventListener('pointercancel', abbruch);
  k.addEventListener('contextmenu', (ev) => { if (ziehen) ev.preventDefault(); });
  return k;
}

// ------------------------------------------------------------------ Ziehen (verschieben und aus der Liste hinzufügen)
let ziehen = null;
document.addEventListener('touchmove', (e) => { if (ziehen) e.preventDefault(); }, { passive: false });

function geist(quelle, x, y) {
  const r = quelle.getBoundingClientRect();
  const g = quelle.cloneNode(true); g.classList.add('geist');
  Object.assign(g.style, { width: r.width + 'px', height: r.height + 'px', left: '0px', top: '0px' });
  document.body.append(g);
  return { el: g, dx: x - r.left, dy: y - r.top };
}
function ziehenStart(ev, k, e, touch = false) {
  const gst = geist(k, ev.clientX, ev.clientY);
  k.classList.add('zieht');
  ziehen = { k, e, gst, neu: false, pid: ev.pointerId };
  bewegen(ev.clientX, ev.clientY);
  if (touch) document.body.classList.add('kein-scroll');
  window.addEventListener('pointermove', beiBewegung); window.addEventListener('pointerup', beiEnde); window.addEventListener('pointercancel', beiEnde);
}
/** aus der Elementliste in das Raster ziehen */
function ziehenNeu(ev, zeile, vorlage) {
  const gst = geist(zeile, ev.clientX, ev.clientY);
  const k = h('div', { class: 'karte el platzhalter g-' + vorlage.groesse });
  ziehen = { k, e: vorlage, gst, neu: true, pid: ev.pointerId, drin: false };
  bewegen(ev.clientX, ev.clientY);
  window.addEventListener('pointermove', beiBewegung); window.addEventListener('pointerup', beiEnde); window.addEventListener('pointercancel', beiEnde);
}
const beiBewegung = (ev) => { if (ziehen && ev.pointerId === ziehen.pid) bewegen(ev.clientX, ev.clientY); };
function bewegen(x, y) {
  const z = ziehen; z.gst.el.style.transform = `translate(${x - z.gst.dx}px, ${y - z.gst.dy}px)`;
  // Rand: automatisch scrollen
  if (y < 70) window.scrollBy(0, -12); else if (y > innerHeight - 90) window.scrollBy(0, 12);
  const unter = document.elementFromPoint(x, y);
  const rasterDrin = unter && unter.closest('#raster');
  if (z.neu && !rasterDrin) { if (z.drin) { z.k.remove(); z.drin = false; } return; }
  if (!rasterDrin) return;
  const ziel = unter.closest('.karte.el');
  if (!ziel || ziel === z.k) { if (z.neu && !z.drin) { raster.append(z.k); z.drin = true; } return; }
  const r = ziel.getBoundingClientRect();
  const danach = (y > r.bottom - r.height * 0.25) || (x > r.left + r.width / 2 && y > r.top + r.height * 0.25);
  const ref = danach ? ziel.nextSibling : ziel;
  if (ref !== z.k && z.k.nextSibling !== ref) raster.insertBefore(z.k, ref);
  if (z.neu) z.drin = true;
}
async function beiEnde(ev) {
  if (!ziehen || ev.pointerId !== ziehen.pid) return;
  const z = ziehen; ziehen = null;
  window.removeEventListener('pointermove', beiBewegung); window.removeEventListener('pointerup', beiEnde); window.removeEventListener('pointercancel', beiEnde);
  document.body.classList.remove('kein-scroll');
  z.gst.el.remove(); z.k.classList.remove('zieht');
  if (z.neu) {
    if (!z.drin) return;
    const neu = { id: neueId(), ...z.e };
    const ids = [...raster.querySelectorAll('.karte.el')].map((x) => (x === z.k ? neu.id : x.dataset.id));
    const alle = [...liste(), neu];
    S.ich.start[S.ansicht] = ids.map((id) => alle.find((x) => x.id === id)).filter(Boolean);
    neuZeichnen(); await speichern(); return;
  }
  const ids = [...raster.querySelectorAll('.karte.el')].map((x) => x.dataset.id);
  const vorher = liste().map((x) => x.id).join();
  S.ich.start[S.ansicht] = ids.map((id) => liste().find((x) => x.id === id)).filter(Boolean);
  if (vorher !== ids.join()) await speichern();
}

// ------------------------------------------------------------------ Größe an der Ecke ziehen
function groesseStart(ev, k, e) {
  const r = k.getBoundingClientRect();
  const spalten = getComputedStyle(raster).gridTemplateColumns.split(' ').length;
  const spaltB = (raster.clientWidth - (spalten - 1) * 14) / spalten;
  const zeileH = parseFloat(getComputedStyle(raster).gridAutoRows) || 120;
  const x0 = ev.clientX, y0 = ev.clientY, alt = e.groesse;
  k.classList.add('groesse-aendern');
  const mv = (m) => {
    const w = r.width + m.clientX - x0, hh = r.height + m.clientY - y0;
    const breit = w > spaltB * 1.45; const hoch = hh > zeileH * 1.6;
    const g = !breit ? 's' : hoch ? 'l' : 'm';
    if (g !== e.groesse) { e.groesse = g; k.className = k.className.replace(/\bg-[sml]\b/, 'g-' + g); }
  };
  const up = async () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    k.classList.remove('groesse-aendern');
    if (e.groesse !== alt) { neuZeichnen(); await speichern(); }
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------------ Elemente hinzufügen (PC: Leiste rechts, Handy: Dialog)
let panelOffen = true; let suche = '';
function panelUmschalten() { panelOffen = !panelOffen; const p = document.getElementById('panel'); p.hidden = !panelOffen; p.parentElement.classList.toggle('mit-panel', panelOffen); if (panelOffen) panelFuellen(p); }

function angebot() {
  const q = suche.trim().toLowerCase();
  const treffer = (t) => !q || t.toLowerCase().includes(q);
  const gruppen = [];
  gruppen.push(['Besonderes', BESONDERE.filter((b) => treffer(b.name)).map((b) => ({ art: b.art, name: b.name, text: b.text, groesse: 'm' }))]);
  gruppen.push(['Räume', M.raeume.filter((r) => treffer(r.label)).map((r) => ({ art: 'raum', ref: r.name, name: r.label, text: r.geraete.length + ' Geräte', groesse: 's' }))]);
  const KL = { licht: 'Licht', heizung: 'Heizung', steckdose: 'Steckdose', sensor: 'Sensor', zaehler: 'Zähler', sonst: 'Gerät' };
  for (const r of M.raeume) {
    const g = r.geraete.filter((x) => treffer(x.label + ' ' + r.label + ' ' + KL[x.klasse] + ' ' + x.openhabLabel));
    if (g.length) gruppen.push([r.label, g.map((x) => ({ art: x.klasse === 'heizung' ? 'heizung' : 'geraet', ref: x.name, name: x.label, text: KL[x.klasse], groesse: x.klasse === 'heizung' || (x.klasse === 'licht' && (x.p.farbe || x.p.dimmer)) ? 'm' : 's' }))]);
  }
  if (q.length >= 2) {
    const w = [];
    for (const g of M.geraete.values()) for (const n of g.alle) { const i = item(n); if (i && treffer(punktName(i) + ' ' + i.label + ' ' + g.label)) w.push({ art: 'punkt', ref: n, name: punktName(i) + ' · ' + g.label, text: wertText(i), groesse: 's' }); }
    if (w.length) gruppen.push(['Einzelwerte', w.slice(0, 40)]);
  }
  return gruppen.filter(([, l]) => l.length);
}
function zeileFuer(v, beiPlus) {
  const da = aufStart(v.art, v.ref);
  const z = h('div', { class: 'angebot' + (da ? ' da' : '') },
    h('span', { class: 'griff' }, icon('griff', 12)),
    h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, v.name), h('div', { class: 'k-unter' }, da ? 'schon auf der Startseite' : v.text)),
    h('button', { class: 'rund klein', 'aria-label': v.name + ' hinzufügen', onclick: () => beiPlus(v) }, icon('plus', 14)));
  z.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch' || ev.target.closest('button')) return; ev.preventDefault(); ziehenNeu(ev, z, { art: v.art, ...(v.ref ? { ref: v.ref } : {}), groesse: v.groesse }); });
  return z;
}
async function hinzu(v) {
  liste().push({ id: neueId(), art: v.art, ...(v.ref ? { ref: v.ref } : {}), groesse: v.groesse });
  neuZeichnen(); await speichern(); melde(v.name + ' hinzugefügt');
}
function panelFuellen(p) {
  const s = h('input', { type: 'search', placeholder: 'Suchen: Raum, Gerät, Wert …', value: suche, 'aria-label': 'Elemente suchen' });
  const lst = h('div', { class: 'panel-liste' });
  const fuelle = () => leeren(lst, angebot().map(([t, l]) => h('div', null, h('h3', null, t), l.map((v) => zeileFuer(v, hinzu)))));
  s.addEventListener('input', () => { suche = s.value; fuelle(); });
  fuelle();
  leeren(p, h('div', { class: 'panel-kopf' }, h('h2', null, 'Elemente hinzufügen'), h('button', { class: 'rund klein', 'aria-label': 'Leiste schließen', onclick: panelUmschalten }, icon('schliessen', 14))),
    h('p', { class: 'leise klein' }, 'In die Startseite ziehen oder + drücken.'), s, lst);
}
function hinzufuegenDialog() {
  const s = h('input', { type: 'search', placeholder: 'Suchen …', value: suche, 'aria-label': 'Elemente suchen' });
  const lst = h('div', { class: 'panel-liste' });
  const fuelle = () => leeren(lst, angebot().map(([t, l]) => h('div', null, h('h3', null, t), l.map((v) => zeileFuer(v, async (x) => { await hinzu(x); fuelle(); })))));
  s.addEventListener('input', () => { suche = s.value; fuelle(); });
  fuelle();
  dialog('Zur Startseite hinzufügen', h('div', null, s, lst));
}
