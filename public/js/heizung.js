// Heizung: Haus-Modus, Heute anders, Feiertage, Vorlagen, Woche, alle Räume (Kanten mit der Maus ziehen), Urlaub
import { h, icon, api, melde, dialog, leeren, live, de, zuMin, zuHHMM, TAGE, TAGKURZ, TAGLANG, datumKurz, zeit } from './kern.js';
import { M, S, st, planRaum, ohneUmlaut, maxTeile, teilName } from './modell.js';
import { hausInhalt, hausKompakt, heizInhalt, verlaufBox, wertText } from './widgets.js';
import { kachel } from './seiten.js';
import { stern } from './start.js';

let ziel = null;
const istAdmin = () => S.ich.benutzer.rolle === 'admin';
const V = (id) => S.heizung.daten.vorlagen.find((v) => v.id === id);
const vname = (id) => (V(id) ? V(id).name : '?');
const tageMit = (id) => TAGE.filter((t) => S.heizung.daten.woche[t] === id);

async function laden() { S.heizung = await api('heizung'); }
async function aendern(pfad, methode, koerper, text) {
  try { const r = await api(pfad, methode, koerper); if (r && r.daten) S.heizung = r; else await laden(); if (text) melde(text); }
  catch (e) { melde(e.message, true); }
  zeichnen();
}

// Reiter wie in der MAX!-Heizungs-App: Räume · Wochenplan · Urlaub · Verlauf · Geräte
const REITER = [['raeume', 'Räume'], ['plan', 'Wochenplan'], ['urlaub', 'Urlaub'], ['verlauf', 'Verlauf'], ['geraete', 'Geräte']];
let reiter = 'raeume';
export async function heizungSeite(z, arg) {
  ziel = z; if (REITER.some(([id]) => id === arg)) reiter = arg;
  try { await laden(); } catch (e) { leeren(z, h('p', { class: 'fehlerbox' }, e.message)); return; }
  zeichnen();
}

function zeichnen() {
  if (!ziel || !ziel.isConnected) return;
  const H = S.heizung;
  const y = window.scrollY;
  if (!H.verfuegbar) {
    leeren(ziel, h('h1', null, 'Heizung'), h('div', { class: 'karte fehlerbox' },
      h('b', null, 'Der Heizplan ist noch nicht verfügbar.'),
      h('p', null, 'In openHAB fehlt das Item „Heizplan_Daten“ oder die Regel heizplan.js läuft noch nicht. Die Raumthermostate kannst du trotzdem bedienen:')), raumKarten());
    return;
  }
  const kopf = h('div', { class: 'seitenkopf kompakt' }, h('div', null, h('h1', null, 'Heizung'), statusZeile()));
  const tabs = h('nav', { class: 'reiter', 'aria-label': 'Heizung' }, REITER.map(([id, n]) => h('a', { href: '#/heizung/' + id, class: id === reiter ? 'aktiv' : '' }, n)));
  let inhalt;
  if (reiter === 'plan') inhalt = [h('div', { class: 'heiz-oben' }, heuteKarte(), feiertagKarte()), vorlagenKarte(), wocheKarte(), rasterKarte()];
  else if (reiter === 'urlaub') inhalt = [h('div', { class: 'heiz-unten' }, urlaubKarte(), istAdmin() ? einstellKarte() : null)];
  else if (reiter === 'verlauf') inhalt = [verlaufTab()];
  else if (reiter === 'geraete') inhalt = [geraeteTab()];
  else inhalt = [h('div', { class: 'kachel-raster' }, h('div', { class: 'kachel g-m nicht-klickbar' }, live(() => hausKompakt()))), h('div', { class: 'kachel-raster heiz-kacheln' }, [...M.geraete.values()].filter((g) => g.klasse === 'heizung').map(kachel))];
  leeren(ziel, kopf, tabs, inhalt);
  window.scrollTo(0, y);
}

function statusZeile() {
  const s = S.heizung.status;
  const teile = [];
  if (s) {
    teile.push(h('span', { class: 'status-punkt ' + (s.fehler ? 'rot' : 'gruen') }));
    teile.push(h('span', null, s.meldung || ''));
    if (Number.isFinite(s.duty)) teile.push(h('span', { class: 'leise' }, ' · Funk-Auslastung ' + s.duty + ' %'));
    if (s.zeit) teile.push(h('span', { class: 'leise' }, ' · ' + zeit(s.zeit)));
  } else teile.push(h('span', { class: 'leise' }, 'Noch keine Rückmeldung der Heizplan-Regel.'));
  return h('p', { class: 'statuszeile' }, teile, h('button', { class: 'knopf leicht klein', onclick: () => aendern('heizung/senden', 'POST', {}, 'Abgleich mit den Thermostaten gestartet') }, 'Jetzt abgleichen'));
}

// ------------------------------------------------------------------ Heute anders
function heuteKarte() {
  const H = S.heizung; const heute = H.effektiv[0];
  const aus = H.daten.ausnahmen[heute.datum];
  const geplant = H.daten.woche[heute.key];
  const zeitFeld = h('input', { type: 'time', value: (aus && aus.verlaengern) || '23:30', step: 900, 'aria-label': 'länger bis' });
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('span', { class: 'k-sym' }, icon('kalender', 16)), h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Heute anders'),
      h('div', { class: 'k-unter' }, aus ? `heute „${vname(heute.vorlage)}“${aus.verlaengern ? ', länger bis ' + aus.verlaengern : ''} · morgen gilt wieder der normale Plan` : `heute ist „${vname(geplant)}“${heute.grund ? ' (' + heute.grund + ')' : ''} geplant`))),
    h('div', { class: 'chips' }, H.daten.vorlagen.map((v) => h('button', {
      class: 'chip' + (heute.vorlage === v.id ? ' aktiv' : ''),
      onclick: () => aendern('heizung/heute', 'POST', { vorlage: v.id === geplant && !heute.grund ? null : v.id }, 'Heute: ' + v.name),
    }, v.name))),
    h('div', { class: 'zeile-knopfe' },
      h('button', { class: 'knopf leicht', onclick: () => aendern('heizung/heute', 'POST', { vorlage: heute.vorlage, verlaengern: zeitFeld.value }, 'Heute länger warm bis ' + zeitFeld.value) }, 'Heute Abend länger bis'), zeitFeld,
      aus ? h('button', { class: 'knopf leicht', onclick: () => aendern('heizung/heute', 'POST', { vorlage: null }, 'Heute wieder nach Plan') }, 'Zurück zum Plan') : null));
}

// ------------------------------------------------------------------ Feiertage
function feiertagKarte() {
  const H = S.heizung; const d = H.daten;
  const land = istAdmin()
    ? h('select', { 'aria-label': 'Bundesland', onchange: (e) => aendern('heizung/einstellungen', 'PUT', { land: e.target.value }, 'Feiertage: ' + H.laender[e.target.value]) },
      Object.entries(H.laender).map(([k, n]) => h('option', { value: k, selected: k === d.land }, n)))
    : h('b', null, H.laender[d.land]);
  const vor = istAdmin()
    ? h('select', { 'aria-label': 'Vorlage an Feiertagen', onchange: (e) => aendern('heizung/einstellungen', 'PUT', { feiertagVorlage: e.target.value }, 'Feiertage wie ' + vname(e.target.value)) },
      d.vorlagen.map((v) => h('option', { value: v.id, selected: v.id === (d.feiertagVorlage || d.woche.so) }, v.name)))
    : h('b', null, vname(d.feiertagVorlage || d.woche.so));
  const naechste = H.kommend.filter((k) => k.art === 'feiertag' || d.bruecken).slice(0, 5);
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('span', { class: 'k-sym' }, icon('kalender', 16)), h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Feiertage'), h('div', { class: 'k-unter' }, 'automatisch wie ', vname(d.feiertagVorlage || d.woche.so)))),
    h('div', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Bundesland'), land),
    istAdmin() ? h('div', { class: 'formzeile' }, h('span', { class: 'leise' }, 'an Feiertagen'), vor) : null,
    h('label', { class: 'haken' }, h('input', { type: 'checkbox', checked: d.bruecken, disabled: !istAdmin(), onchange: (e) => aendern('heizung/einstellungen', 'PUT', { bruecken: e.target.checked }, e.target.checked ? 'Brückentage wie Feiertage' : 'Brückentage normal') }), 'Brückentage wie Feiertage'),
    h('ul', { class: 'feiertage' }, naechste.length ? naechste.map((k) => h('li', null, h('b', null, datumKurz(k.datum)), ' ', k.name, k.art === 'bruecke' ? h('span', { class: 'marke' }, 'Brückentag') : null)) : h('li', { class: 'leise' }, 'In den nächsten 90 Tagen keine.')));
}

// ------------------------------------------------------------------ Vorlagen
const FARBE = (t, basis) => (t <= basis ? 'transparent' : t >= 21 ? 'var(--warm2)' : t >= 19 ? 'var(--warm1)' : 'var(--warm0)');
function segmente(punkte) {
  const p = [...punkte].map(([t, v]) => [zuMin(t), v]).sort((a, b) => a[0] - b[0]);
  if (!p.length) return { p, seg: [], basis: 0 };
  const basis = Math.min(...p.map((x) => x[1]));
  const seg = [];
  if (p[0][0] > 0) seg.push({ von: 0, bis: p[0][0], t: p[p.length - 1][1], links: null, rechts: 0 });
  p.forEach(([m, v], i) => seg.push({ von: m, bis: i + 1 < p.length ? p[i + 1][0] : 1440, t: v, links: i, rechts: i + 1 < p.length ? i + 1 : null }));
  return { p, seg, basis };
}
/** schmale Zeitleiste einer Vorlage (für Karten) */
function leiste(punkte, mitText = false) {
  const { seg, basis } = segmente(punkte || []);
  return h('div', { class: 'leiste' }, seg.filter((s) => s.t > basis).map((s) => h('span', { class: 'block', style: { left: s.von / 14.4 + '%', width: (s.bis - s.von) / 14.4 + '%', background: FARBE(s.t, basis) }, title: `${zuHHMM(s.von)}–${zuHHMM(s.bis)} ${de(s.t)} °C` }, mitText ? de(s.t) + '°' : null)));
}
function vorlageText(v) {
  const rid = S.heizung.raeume[0] && S.heizung.raeume[0].id;
  const { seg, basis } = segmente(v.muster[rid] || []);
  const warm = seg.filter((s) => s.t > basis);
  if (!warm.length) return 'ganztägig ' + de(basis) + ' °C';
  return warm.map((s) => zuHHMM(s.von).replace(/^0/, '') + '–' + zuHHMM(s.bis).replace(/^0/, '')).join(', ') + ' (' + S.heizung.raeume[0].name + ')';
}
function vorlagenKarte() {
  const H = S.heizung;
  const rid = H.raeume[0] && H.raeume[0].id;
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Vorlagen'), h('div', { class: 'k-unter' }, 'auf einen Tag ziehen · antippen zum Bearbeiten · gelten für alle Räume, jeder Raum hat sein eigenes Muster'))),
    h('div', { class: 'vorlagen' }, H.daten.vorlagen.map((v) => {
      const k = h('div', { class: 'vorlage', tabindex: 0, role: 'button', 'aria-label': 'Vorlage ' + v.name + ' bearbeiten', dataset: { id: v.id } },
        h('div', { class: 'vorlage-kopf' }, h('span', { class: 'griff' }, icon('griff', 12)), h('b', null, v.name), h('span', { class: 'leise klein' }, tageMit(v.id).map((t) => TAGKURZ[t]).join(' '))),
        leiste(v.muster[rid]), h('div', { class: 'leise klein' }, vorlageText(v)));
      k.addEventListener('pointerdown', (e) => vorlageZiehen(e, k, v));
      k.addEventListener('keydown', (e) => { if (e.key === 'Enter') vorlageEditor(v); });
      return k;
    }), h('button', { class: 'vorlage neu', onclick: () => vorlageEditor(null) }, icon('plus', 16), 'Neue Vorlage')));
}

/** Vorlage auf einen Wochentag ziehen (Maus sofort, Finger nach kurzem Halten) – kurzes Antippen öffnet den Editor */
function vorlageZiehen(e, k, v) {
  if (e.button > 0) return;
  const x0 = e.clientX, y0 = e.clientY; let gst = null; let ziel = null; const touch = e.pointerType === 'touch';
  let bereit = !touch; const t = touch ? setTimeout(() => { bereit = true; k.classList.add('bereit'); }, 300) : null;
  const mv = (m) => {
    if (!gst) {
      if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
      if (!bereit) { ende(); return; }
      gst = k.cloneNode(true); gst.classList.add('geist'); gst.style.width = k.offsetWidth + 'px'; document.body.append(gst);
    }
    m.preventDefault();
    gst.style.transform = `translate(${m.clientX - 40}px, ${m.clientY - 20}px)`;
    const u = document.elementFromPoint(m.clientX, m.clientY);
    const tg = u && u.closest('.tag[data-tag]');
    if (ziel && ziel !== tg) ziel.classList.remove('ueber');
    ziel = tg; if (ziel) ziel.classList.add('ueber');
  };
  const blockiere = (ev) => { if (gst) ev.preventDefault(); };
  const ende = async (u) => {
    clearTimeout(t); k.classList.remove('bereit');
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', ende); window.removeEventListener('pointercancel', ende);
    document.removeEventListener('touchmove', blockiere);
    if (gst) {
      gst.remove();
      if (ziel) { ziel.classList.remove('ueber'); const woche = { ...S.heizung.daten.woche, [ziel.dataset.tag]: v.id }; await aendern('heizung/woche', 'PUT', { woche }, TAGLANG[ziel.dataset.tag] + ': ' + v.name); }
    } else if (u && u.type === 'pointerup') vorlageEditor(v);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', ende); window.addEventListener('pointercancel', ende);
  document.addEventListener('touchmove', blockiere, { passive: false });
}

/** Editor: Name und Schaltpunkte je Raum */
function vorlageEditor(v) {
  const H = S.heizung;
  const neu = !v;
  const arbeit = neu ? { id: null, name: '', muster: Object.fromEntries(H.raeume.map((r) => [r.id, [['06:30', 21], ['22:00', 17]]])) } : JSON.parse(JSON.stringify(v));
  for (const r of H.raeume) if (!arbeit.muster[r.id]) arbeit.muster[r.id] = [['06:30', 21], ['22:00', 17]];
  const name = h('input', { type: 'text', value: arbeit.name, placeholder: 'z. B. Homeoffice', maxlength: 40, 'aria-label': 'Name der Vorlage' });
  const raeumeBox = h('div', { class: 'editor-raeume' });
  const fuelle = () => leeren(raeumeBox, H.raeume.map((r) => {
    const p = arbeit.muster[r.id];
    const vorschau = leiste(p, true);
    return h('div', { class: 'editor-raum' },
      h('div', { class: 'editor-raum-kopf' }, h('b', null, r.name), vorschau,
        r.id !== H.raeume[0].id ? h('button', { class: 'knopf leicht klein', onclick: () => { arbeit.muster[r.id] = JSON.parse(JSON.stringify(arbeit.muster[H.raeume[0].id])); fuelle(); } }, 'wie ' + H.raeume[0].name) : null),
      h('div', { class: 'punkte' }, p.map((pt, i) => h('span', { class: 'punkt-feld' },
        h('input', { type: 'time', value: pt[0], step: 300, 'aria-label': r.name + ' ab', onchange: (e) => { pt[0] = e.target.value; fuelle(); } }),
        h('input', { type: 'number', min: 4.5, max: 30.5, step: 0.5, value: pt[1], 'aria-label': r.name + ' Temperatur', onchange: (e) => { pt[1] = Number(e.target.value); fuelle(); } }), '°',
        p.length > 1 ? h('button', { class: 'rund klein', 'aria-label': 'Punkt entfernen', onclick: () => { p.splice(i, 1); fuelle(); } }, '×') : null)),
      p.length < 6 ? h('button', { class: 'knopf leicht klein', onclick: () => { const l = p[p.length - 1]; p.push([zuHHMM(Math.min(1435, zuMin(l[0]) + 60)), l[1]]); fuelle(); } }, '+ Punkt') : null));
  }));
  fuelle();
  const benutzt = neu ? [] : tageMit(v.id);
  const knoepfe = [];
  if (!neu) knoepfe.push({ text: 'Löschen', klasse: 'knopf leicht gefahr', aktion: async () => {
    if (benutzt.length) { melde('Erst den Tagen ' + benutzt.map((t) => TAGKURZ[t]).join(', ') + ' eine andere Vorlage geben', true); return false; }
    await aendern('heizung/vorlagen', 'PUT', { vorlagen: H.daten.vorlagen.filter((x) => x.id !== v.id) }, 'Vorlage gelöscht');
  } });
  knoepfe.push({ text: 'Speichern', klasse: 'knopf', aktion: async () => {
    arbeit.name = name.value.trim(); if (!arbeit.name) { melde('Bitte einen Namen geben', true); return false; }
    for (const id of Object.keys(arbeit.muster)) arbeit.muster[id].sort((a, b) => zuMin(a[0]) - zuMin(b[0]));
    const liste = neu ? [...H.daten.vorlagen, arbeit] : H.daten.vorlagen.map((x) => (x.id === v.id ? arbeit : x));
    await aendern('heizung/vorlagen', 'PUT', { vorlagen: liste }, 'Vorlage „' + arbeit.name + '“ gespeichert');
  } });
  dialog(neu ? 'Neue Vorlage' : 'Vorlage „' + v.name + '“', h('div', null,
    h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Name'), name),
    benutzt.length ? h('p', { class: 'leise klein' }, 'Gilt für: ' + benutzt.map((t) => TAGLANG[t]).join(', ')) : null,
    h('p', { class: 'leise klein' }, 'Jeder Punkt heißt „ab dieser Uhrzeit diese Temperatur“. Höchstens 6 Punkte pro Tag, Uhrzeiten im 5-Minuten-Raster.'),
    raeumeBox), { breit: true, knoepfe });
}

// ------------------------------------------------------------------ Woche
function wocheKarte() {
  const H = S.heizung;
  const effJe = Object.fromEntries(H.effektiv.map((t) => [t.key, t]));
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Diese Woche'), h('div', { class: 'k-unter' }, 'Vorlage je Wochentag · gilt für alle Räume · Vorlage hierher ziehen oder Tag antippen'))),
    h('div', { class: 'woche' }, TAGE.map((t, i) => {
      const e = effJe[t];
      const heute = new Date(); const tagDatum = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - ((heute.getDay() + 6) % 7) + i, 12);
      const diese = e && e.datum === new Date(tagDatum - tagDatum.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
      const abw = diese && e.vorlage !== H.daten.woche[t];
      return h('button', { class: 'tag' + (e && e.heute ? ' heute' : '') + (!diese ? ' vorbei' : '') + (abw ? ' abweichend' : ''), dataset: { tag: t }, onclick: () => tagWahl(t) },
        h('div', { class: 'leise klein' }, datumKurz(new Date(tagDatum - tagDatum.getTimezoneOffset() * 60e3).toISOString().slice(0, 10)), e && e.heute ? ' · heute' : ''),
        h('b', null, vname(H.daten.woche[t])),
        abw ? h('div', { class: 'hinweis' }, (e.grund || 'anders') + ': ' + vname(e.vorlage)) : null);
    })));
}
function tagWahl(t) {
  const H = S.heizung;
  const d = dialog(TAGLANG[t], h('div', { class: 'chips senkrecht' }, H.daten.vorlagen.map((v) => h('button', {
    class: 'chip gross' + (H.daten.woche[t] === v.id ? ' aktiv' : ''),
    onclick: async () => { d.schliessen(); await aendern('heizung/woche', 'PUT', { woche: { ...H.daten.woche, [t]: v.id } }, TAGLANG[t] + ': ' + v.name); },
  }, h('b', null, v.name), h('small', null, vorlageText(v))))));
}

// ------------------------------------------------------------------ Alle Räume · ganze Woche (Kanten ziehen)
function rasterKarte() {
  const H = S.heizung;
  const kopfzeile = h('div', { class: 'wr-zeile wr-kopf' }, h('div', { class: 'wr-raum' }), H.effektiv.map((t) => h('div', { class: 'wr-tag' + (t.heute ? ' heute' : '') }, datumKurz(t.datum), h('small', null, vname(t.vorlage)))));
  const uhr = h('div', { class: 'wr-zeile wr-uhr' }, h('div', { class: 'wr-raum' }), H.effektiv.map(() => h('div', { class: 'wr-tag' }, h('span', null, '0'), h('span', null, '6'), h('span', null, '12'), h('span', null, '18'), h('span', null, '24'))));
  const zeilen = H.raeume.map((r) => h('div', { class: 'wr-zeile' }, h('div', { class: 'wr-raum' }, r.name), H.effektiv.map((t) => zelle(r, t))));
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Ganze Woche · alle Räume'), h('div', { class: 'k-unter' }, 'Blockkante mit der Maus ziehen = früher/später · Block ziehen = ganze Heizzeit verschieben · ändert die Vorlage des Tages'))),
    h('div', { class: 'wr' }, kopfzeile, uhr, zeilen),
    h('div', { class: 'legende leise klein' }, h('span', null, h('i', { style: { background: 'var(--warm2)' } }), 'ab 21 °C'), h('span', null, h('i', { style: { background: 'var(--warm1)' } }), '19–20,5 °C'), h('span', null, h('i', { style: { background: 'var(--warm0)' } }), 'leicht erhöht'), h('span', null, 'leer = abgesenkt')));
}
function zelle(r, tag) {
  const v = V(tag.vorlage);
  const punkte = v && v.muster[r.id];
  const z = h('div', { class: 'wr-zelle' + (tag.heute ? ' heute' : '') });
  if (!punkte) { z.append(h('span', { class: 'leise klein' }, '–')); return z; }
  const { p, seg, basis } = segmente(punkte);
  for (const s of seg) {
    if (s.t <= basis) continue;
    const b = h('div', { class: 'wr-block', style: { left: s.von / 14.4 + '%', width: (s.bis - s.von) / 14.4 + '%', background: FARBE(s.t, basis) }, title: `${zuHHMM(s.von)}–${zuHHMM(s.bis)} · ${de(s.t)} °C · Vorlage „${v.name}“` });
    if (s.links !== null) { const k = h('span', { class: 'kante links' }); k.addEventListener('pointerdown', (e) => kanteZiehen(e, z, v, r, p, [s.links])); b.append(k); }
    if (s.rechts !== null) { const k = h('span', { class: 'kante rechts' }); k.addEventListener('pointerdown', (e) => kanteZiehen(e, z, v, r, p, [s.rechts])); b.append(k); }
    if (s.links !== null && s.rechts !== null) b.addEventListener('pointerdown', (e) => { if (!e.target.classList.contains('kante')) kanteZiehen(e, z, v, r, p, [s.links, s.rechts]); });
    z.append(b);
  }
  return z;
}
/** Schaltpunkt(e) ziehen; idx = ein Punkt (Kante) oder zwei (ganzer Block) */
function kanteZiehen(e, zelleEl, v, r, p, idx) {
  e.preventDefault(); e.stopPropagation();
  const rect = zelleEl.getBoundingClientRect();
  const start = idx.map((i) => p[i][0]);
  const min = (idx[0] > 0 ? p[idx[0] - 1][0] + 5 : 0);
  const max = (idx[idx.length - 1] < p.length - 1 ? p[idx[idx.length - 1] + 1][0] - 5 : 1435);
  const x0 = e.clientX;
  const tipp = h('div', { class: 'zieh-tipp' }); document.body.append(tipp);
  const tage = tageMit(v.id).map((t) => TAGKURZ[t]).join(', ');
  let neu = start.slice();
  const mv = (m) => {
    let d = Math.round(((m.clientX - x0) / rect.width) * 1440 / 15) * 15;
    d = Math.max(min - start[0], Math.min(max - start[start.length - 1], d));
    neu = start.map((s) => s + d);
    const q = p.map((x) => x.slice()); idx.forEach((i, k) => { q[i][0] = neu[k]; });
    leeren(zelleEl, ...zelleBloecke(q));
    tipp.textContent = neu.map(zuHHMM).join(' – ') + ' · ' + r.name + ' · Vorlage „' + v.name + '“' + (tage ? ' (' + tage + ')' : '');
    tipp.style.transform = `translate(${m.clientX + 12}px, ${m.clientY - 36}px)`;
  };
  const up = async () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    tipp.remove();
    if (neu.every((x, i) => x === start[i])) { zeichnen(); return; }
    const muster = JSON.parse(JSON.stringify(v.muster));
    const q = p.map((x) => x.slice()); idx.forEach((i, k) => { q[i][0] = neu[k]; });
    muster[r.id] = q.map(([m, t]) => [zuHHMM(m), t]);
    const liste = S.heizung.daten.vorlagen.map((x) => (x.id === v.id ? { ...x, muster } : x));
    await aendern('heizung/vorlagen', 'PUT', { vorlagen: liste }, `${r.name}: ${neu.map(zuHHMM).join('–')} in „${v.name}“`);
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  mv(e);
}
function zelleBloecke(q) {
  const { seg, basis } = segmente(q.map(([m, t]) => [zuHHMM(m), t]));
  return seg.filter((s) => s.t > basis).map((s) => h('div', { class: 'wr-block aktiv', style: { left: s.von / 14.4 + '%', width: (s.bis - s.von) / 14.4 + '%', background: FARBE(s.t, basis) } }));
}

// ------------------------------------------------------------------ Urlaub / Abwesend
function urlaubKarte() {
  const H = S.heizung;
  const morgen = new Date(Date.now() + 7 * 86400e3); morgen.setHours(18, 0, 0, 0);
  const lokal = (d) => new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const bis = h('input', { type: 'datetime-local', value: lokal(morgen), step: 1800, 'aria-label': 'Urlaub bis' });
  const temp = h('input', { type: 'number', min: 4.5, max: 30.5, step: 0.5, value: 15, 'aria-label': 'Temperatur im Urlaub' });
  const haken = H.raeume.map((r) => h('input', { type: 'checkbox', checked: true, value: r.id }));
  const gewaehlt = () => haken.filter((x) => x.checked).map((x) => x.value);
  const imUrlaub = [...M.geraete.values()].filter((g) => g.klasse === 'heizung' && g.p.modus && st(g.p.modus.name) === 'VACATION').map((g) => M.raumName(g.raum) || g.label);
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('span', { class: 'k-sym' }, icon('koffer', 16)), h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Urlaub'), h('div', { class: 'k-unter' }, imUrlaub.length ? 'Urlaub läuft in: ' + imUrlaub.join(', ') : 'Die Thermostate halten die Temperatur bis zum Ende und kehren dann von selbst zum Wochenplan zurück – auch ohne openHAB.'))),
    h('div', { class: 'formzeile' }, h('span', { class: 'leise' }, 'bis'), bis),
    h('div', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Temperatur'), h('span', null, temp, ' °C')),
    h('div', { class: 'chips' }, H.raeume.map((r, i) => h('label', { class: 'chip haken' }, haken[i], r.name))),
    h('div', { class: 'zeile-knopfe' },
      h('button', { class: 'knopf', onclick: () => { const ids = gewaehlt(); if (!ids.length) return melde('Keinen Raum gewählt', true); aendern('heizung/urlaub', 'POST', { raeume: ids, temp: Number(temp.value), bis: bis.value }, 'Urlaub wird an die Thermostate gesendet …'); } }, 'Urlaub starten'),
      h('button', { class: 'knopf leicht', onclick: () => aendern('heizung/urlaub', 'DELETE', { raeume: gewaehlt() }, 'Urlaub wird beendet …') }, 'Urlaub beenden')));
}

function einstellKarte() {
  const d = S.heizung.daten;
  const f = (k, label) => { const x = h('input', { type: 'number', min: 4.5, max: 30.5, step: 0.5, value: d[k], 'aria-label': label }); x.addEventListener('change', () => aendern('heizung/einstellungen', 'PUT', { [k]: Number(x.value) }, label + ': ' + x.value + ' °C')); return h('div', { class: 'formzeile' }, h('span', { class: 'leise' }, label), h('span', null, x, ' °C')); };
  return h('div', { class: 'karte' }, h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Ganzes Haus – Temperaturen'), h('div', { class: 'k-unter' }, 'für die Knöpfe Eco und Komfort'))), f('eco', 'Eco'), f('komfort', 'Komfort'));
}

/** Verlauf: je Raum Ist und Soll (7 Tage) */
function verlaufTab() {
  const hz = [...M.geraete.values()].filter((g) => g.klasse === 'heizung' && g.p.temp);
  return h('div', { class: 'verlauf-raster' }, hz.map((g) => h('div', { class: 'karte' }, verlaufBox(g.p.temp, M.raumName(g.raum) || g.label, g.p.soll))));
}
/** Geräte: alle MAX!-Teile je Raum mit Batterie, Ventil, Modus, Fenster */
function geraeteTab() {
  const hz = [...M.geraete.values()].filter((g) => g.klasse === 'heizung');
  return h('div', { class: 'max-raster' }, hz.map((g) => {
    const teile = [...new Set(Object.values(g.teilVon || {}).filter(Boolean))].sort();
    return h('div', { class: 'karte' }, h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, M.raumName(g.raum) || g.label), h('div', { class: 'k-unter' }, maxTeile(g)))),
      live(() => h('div', { class: 'liste-werte' }, teile.map((t) => {
        const werte = g.alle.filter((n) => g.teilVon[n] === t).map((n) => M.items.get(n)).filter(Boolean);
        const finde = (re) => werte.find((i) => re.test(i.label + ' ' + i.name));
        const bat = werte.find((i) => i.tags.includes('LowBattery'));
        const info = [finde(/ventil/i), finde(/modus/i), finde(/fenster|tür/i), finde(/^((?!soll).)*temperatur/i)].filter(Boolean).map((i) => wertText(i));
        return h('div', { class: 'wertzeile' }, h('span', null, h('b', null, teilName(t)), h('br'), h('small', { class: 'leise' }, info.join(' · '))),
          h('span', { class: bat && st(bat.name) === 'ON' ? 'warnung' : 'leise' }, bat ? (st(bat.name) === 'ON' ? '⚠ Batterie' : 'Batterie ok') : ''));
      }))));
  }));
}
function raumKarten() {
  const hz = [...M.geraete.values()].filter((g) => g.klasse === 'heizung');
  return h('div', { class: 'karten-raster' }, hz.map((g) => h('div', { class: 'karte' }, h('div', { class: 'karte-ecke' }, stern('heizung', g.name, 'm')), live(() => heizInhalt(g, 'l')))));
}
export { ohneUmlaut, planRaum };
