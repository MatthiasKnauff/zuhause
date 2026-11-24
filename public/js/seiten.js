// Seiten: Räume, Licht, Energie, Geräte, Benutzer & Einstellungen
import { h, icon, api, melde, dialog, leeren, live, zahl, de, grad } from './kern.js';
import { M, S, st, lichtAn, raumTemp } from './modell.js';
import { geraetInhalt, alleWerte, alleLichterInhalt, wertText, lichtSchalten } from './widgets.js';
import { stern } from './start.js';
import { darstellungAnwenden } from './app.js';

const KLASSEN = { licht: 'Licht', heizung: 'Heizung', steckdose: 'Steckdosen & Schalter', sensor: 'Sensoren', zaehler: 'Zähler', sonst: 'Sonstiges' };
const ORDNUNG = ['heizung', 'licht', 'steckdose', 'sensor', 'zaehler', 'sonst'];

function geraetKarte(g, { mitRaum = false, alle = false } = {}) {
  const groesse = g.klasse === 'licht' && (g.p.farbe || g.p.ct) ? 'voll' : g.klasse === 'heizung' ? 'voll' : 'l';
  const art = g.klasse === 'heizung' ? 'heizung' : 'geraet';
  const k = h('div', { class: 'karte geraet k-' + g.klasse + (groesse === 'voll' && g.klasse === 'licht' ? ' breit' : '') });
  const werte = h('div', { class: 'alle-werte', hidden: !alle });
  k.append(h('div', { class: 'karte-ecke' }, S.ich.benutzer.rolle === 'admin' ? h('button', { class: 'stern', title: 'Name und Raum ändern', 'aria-label': g.label + ': Name und Raum ändern', onclick: (e) => { e.stopPropagation(); umbenennen(g); } }, icon('stift', 16)) : null, stern(art, g.name, g.klasse === 'heizung' || g.p.dimmer || g.p.farbe ? 'm' : 's')),
    live(() => geraetInhalt(g, groesse, mitRaum)), werte);
  if (alle && g.alle.length > 1) werte.append(live(() => alleWerte(g)));
  return k;
}

/** Name, Raum und Sichtbarkeit eines Geräts in dieser App ändern (openHAB bleibt unverändert) – nur Admins */
function umbenennen(g) {
  const alt = (S.namen.geraete || {})[g.name] || {};
  const name = h('input', { type: 'text', value: alt.label || '', placeholder: g.label, maxlength: 60, 'aria-label': 'Name' });
  const raum = h('select', { 'aria-label': 'Raum' },
    h('option', { value: '' }, 'wie in openHAB' + (g.openhabRaum ? ' (' + M.raumName(g.openhabRaum) + ')' : ' (keiner)')),
    M.alleRaeume.map((r) => h('option', { value: r.name, selected: alt.raum === r.name }, r.label)));
  const weg = h('input', { type: 'checkbox', checked: !!alt.versteckt });
  dialog('Gerät: ' + g.label, h('div', null,
    h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Name'), name),
    h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Raum'), raum),
    h('label', { class: 'haken', style: { marginTop: '12px' } }, weg, 'Ausblenden (nur noch unter Geräte → Ausgeblendet)'),
    h('p', { class: 'leise klein' }, 'In openHAB heißt es „' + g.openhabLabel + '“ (' + g.name + '). Die Änderung gilt nur in dieser App und für alle Benutzer; leer lassen = Name aus openHAB.')), {
    knoepfe: [{ text: 'Speichern', klasse: 'knopf', aktion: async () => {
      const geraete = { ...(S.namen.geraete || {}) };
      const e = {};
      if (name.value.trim()) e.label = name.value.trim();
      if (raum.value) e.raum = raum.value;
      if (weg.checked) e.versteckt = true;
      if (Object.keys(e).length) geraete[g.name] = e; else delete geraete[g.name];
      S.namen = await api('namen', 'PUT', { geraete });
      melde('Gespeichert'); window.dispatchEvent(new Event('modell-neu'));
    } }],
  });
}

// ------------------------------------------------------------------ Räume
let alleZeigen = false;
export function raeumeSeite(z, raumName) {
  const r = M.raeume.find((x) => x.name === raumName) || M.raeume[0];
  if (!r) { leeren(z, h('h1', null, 'Räume'), h('p', { class: 'leise' }, 'In openHAB sind noch keine Räume (Locations) im semantischen Modell angelegt.')); return; }
  const chips = h('div', { class: 'raum-chips' }, M.raeume.map((x) => h('a', { class: 'chip' + (x === r ? ' aktiv' : ''), href: '#/raeume/' + encodeURIComponent(x.name) },
    x.label, live(() => { const t = raumTemp(x.name); return Number.isFinite(t) ? h('span', { class: 'leise' }, ' · ' + grad(t)) : ''; }, 'inline'))));
  const sortiert = [...r.geraete].sort((a, b) => ORDNUNG.indexOf(a.klasse) - ORDNUNG.indexOf(b.klasse) || a.label.localeCompare(b.label, 'de'));
  const lichtIm = r.geraete.filter((g) => g.klasse === 'licht');
  const raster = h('div', { class: 'karten-raster' }, sortiert.map((g) => geraetKarte(g, { alle: alleZeigen })));
  leeren(z,
    chips,
    h('div', { class: 'seitenkopf' }, h('div', null, h('h1', null, r.label), h('p', { class: 'leise' }, r.geraete.length + ' Geräte · ' + (r.extra ? 'in openHAB keinem Raum zugeordnet' : 'aus dem openHAB-Raummodell'))),
      h('div', { class: 'kopf-rechts' },
        h('span', { class: 'karte-ecke statisch' }, stern('raum', r.name, 's')),
        h('label', { class: 'haken' }, h('input', { type: 'checkbox', checked: alleZeigen, onchange: (e) => { alleZeigen = e.target.checked; raeumeSeite(z, r.name); } }), 'Alle Werte zeigen'),
        lichtIm.length ? live(() => { const an = lichtIm.filter((g) => lichtAn(g)); return an.length ? h('button', { class: 'knopf leicht', onclick: () => an.forEach((g) => lichtSchalten(g, false)) }, 'Alle Lichter im Raum aus') : h('span', { class: 'leise klein' }, 'alle Lichter aus'); }, 'inline') : null)),
    r.geraete.length ? raster : h('p', { class: 'leise' }, 'In diesem Raum sind keine Geräte.'));
}

// ------------------------------------------------------------------ Licht
export function lichtSeite(z) {
  const teile = [h('div', { class: 'seitenkopf' }, h('h1', null, 'Licht')), h('div', { class: 'karte' }, h('div', { class: 'karte-ecke' }, stern('alleLichter', null, 'm')), live(() => alleLichterInhalt()))];
  for (const r of M.raeume) {
    const l = r.geraete.filter((g) => g.klasse === 'licht');
    if (!l.length) continue;
    teile.push(h('h2', { class: 'abschnitt' }, r.label), h('div', { class: 'karten-raster' }, l.map((g) => geraetKarte(g))));
  }
  leeren(z, teile);
}

// ------------------------------------------------------------------ Energie
export function energieSeite(z) {
  const mitLeistung = [...M.geraete.values()].filter((g) => g.p.leistung);
  const zaehler = mitLeistung.find((g) => g.klasse === 'zaehler' || /zähler|zaehler|meter|bitshake/i.test(g.name + g.label));
  const geraete = mitLeistung.filter((g) => g !== zaehler);
  leeren(z,
    h('div', { class: 'seitenkopf' }, h('h1', null, 'Energie')),
    zaehler ? h('div', { class: 'karte energie-gesamt' }, h('div', { class: 'karte-ecke' }, stern('geraet', zaehler.name, 'm')), live(() => {
      const w = zahl(st(zaehler.p.leistung.name));
      return h('div', null, h('div', { class: 'leise' }, zaehler.label + ' · Haus gesamt'), h('div', { class: 'riesig' }, de(w, 0), h('small', null, ' W')),
        zaehler.p.energie ? h('div', { class: 'leise' }, 'Zählerstand ' + wertText(zaehler.p.energie)) : null);
    })) : null,
    h('h2', { class: 'abschnitt' }, 'Verbraucher jetzt'),
    h('div', { class: 'karte' }, live(() => {
      const werte = geraete.map((g) => ({ g, w: zahl(st(g.p.leistung.name)) })).filter((x) => Number.isFinite(x.w)).sort((a, b) => b.w - a.w);
      const max = Math.max(1, ...werte.map((x) => x.w));
      const summe = werte.reduce((s, x) => s + x.w, 0);
      return h('div', { class: 'balken-liste' }, h('div', { class: 'leise klein' }, 'Summe der gemessenen Geräte: ' + de(summe, 0) + ' W'),
        werte.map(({ g, w }) => h('div', { class: 'balken-zeile' }, h('span', { class: 'b-name' }, g.label, h('small', { class: 'leise' }, g.raum ? ' · ' + M.raumName(g.raum) : '')),
          h('span', { class: 'b-balken' }, h('i', { style: { width: (w / max * 100) + '%' } })), h('span', { class: 'b-wert' }, de(w, w >= 100 ? 0 : 1) + ' W'))));
    })),
    h('h2', { class: 'abschnitt' }, 'Zählerstände'),
    h('div', { class: 'karte' }, live(() => h('div', { class: 'liste-werte' }, [...M.geraete.values()].filter((g) => g.p.energie).map((g) => h('div', { class: 'wertzeile' }, h('span', null, g.label, h('small', { class: 'leise' }, g.raum ? ' · ' + M.raumName(g.raum) : '')), h('span', null, wertText(g.p.energie))))))));
}

// ------------------------------------------------------------------ Geräte
let suche = '';
export function geraeteSeite(z) {
  const s = h('input', { type: 'search', placeholder: 'Gerät oder Raum suchen …', value: suche, 'aria-label': 'Geräte suchen' });
  const box = h('div');
  const fuelle = () => {
    const q = suche.trim().toLowerCase();
    const alle = [...M.geraete.values()].filter((g) => !g.versteckt && (!q || (g.label + ' ' + g.openhabLabel + ' ' + M.raumName(g.raum) + ' ' + KLASSEN[g.klasse]).toLowerCase().includes(q)));
    leeren(box, ORDNUNG.map((k) => {
      const l = alle.filter((g) => g.klasse === k).sort((a, b) => a.label.localeCompare(b.label, 'de'));
      return l.length ? [h('h2', { class: 'abschnitt' }, KLASSEN[k] + ' (' + l.length + ')'), h('div', { class: 'karten-raster' }, l.map((g) => geraetKarte(g, { mitRaum: true, alle: alleZeigen })))] : null;
    }), alle.length ? null : h('p', { class: 'leise' }, 'Nichts gefunden.'),
    M.versteckt.length ? [h('h2', { class: 'abschnitt' }, 'Ausgeblendet (' + M.versteckt.length + ')'), h('div', { class: 'karten-raster' }, M.versteckt.map((g) => geraetKarte(g, { mitRaum: true })))] : null);
  };
  s.addEventListener('input', () => { suche = s.value; fuelle(); });
  fuelle();
  leeren(z, h('div', { class: 'seitenkopf' }, h('div', null, h('h1', null, 'Geräte'), h('p', { class: 'leise' }, M.geraete.size + ' Geräte aus openHAB')),
    h('div', { class: 'kopf-rechts' }, s, h('label', { class: 'haken' }, h('input', { type: 'checkbox', checked: alleZeigen, onchange: (e) => { alleZeigen = e.target.checked; fuelle(); } }), 'Alle Werte'))), box);
}

// ------------------------------------------------------------------ Benutzer & Einstellungen
export async function einstellungenSeite(z) {
  const admin = S.ich.benutzer.rolle === 'admin';
  const teile = [h('div', { class: 'seitenkopf' }, h('h1', null, admin ? 'Benutzer & Einstellungen' : 'Einstellungen'))];
  const spalten = h('div', { class: 'zwei-spalten' });
  if (admin) spalten.append(await benutzerKarte(z));
  spalten.append(darstellungKarte(), passwortKarte());
  if (admin) spalten.append(await verbindungKarte());
  teile.push(spalten);
  leeren(z, teile);
}

async function benutzerKarte(z) {
  const liste = await api('benutzer');
  const RN = { admin: 'Admin', benutzer: 'Benutzer' };
  const zuletzt = (t) => !t ? 'noch nie angemeldet' : Date.now() - t < 5 * 60e3 ? 'gerade eben' : new Date(t).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const bearbeiten = (b) => {
    const name = h('input', { type: 'text', value: b ? b.name : '', 'aria-label': 'Name', autocomplete: 'off' });
    const rolle = h('select', { 'aria-label': 'Rolle' }, h('option', { value: 'benutzer', selected: !b || b.rolle === 'benutzer' }, 'Benutzer'), h('option', { value: 'admin', selected: b && b.rolle === 'admin' }, 'Admin'));
    const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: b ? 'leer lassen = unverändert' : 'mindestens 8 Zeichen', 'aria-label': 'Passwort' });
    const knoepfe = [];
    if (b && b.id !== S.ich.benutzer.id) knoepfe.push({ text: 'Löschen', klasse: 'knopf leicht gefahr', aktion: async () => { if (!confirm(b.name + ' wirklich löschen?')) return false; await api('benutzer/' + b.id, 'DELETE'); melde(b.name + ' gelöscht'); einstellungenSeite(z); } });
    knoepfe.push({ text: b ? 'Speichern' : 'Anlegen', klasse: 'knopf', aktion: async () => {
      if (b) await api('benutzer/' + b.id, 'PUT', { name: name.value, rolle: rolle.value, passwort: pw.value });
      else await api('benutzer', 'POST', { name: name.value, rolle: rolle.value, passwort: pw.value });
      melde(b ? 'Gespeichert' : name.value + ' angelegt'); einstellungenSeite(z);
    } });
    dialog(b ? b.name + ' bearbeiten' : 'Benutzer anlegen', h('div', null,
      h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Name'), name),
      h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Rolle'), rolle),
      h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Passwort'), pw)), { knoepfe });
  };
  return h('div', { class: 'karte' },
    h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Benutzer')), h('button', { class: 'knopf', onclick: () => bearbeiten(null) }, icon('plus', 16), 'Benutzer anlegen')),
    h('div', { class: 'benutzer-liste' }, liste.map((b) => h('div', { class: 'benutzer-zeile' },
      h('span', { class: 'kuerzel' }, kuerzel(b.name)),
      h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, b.name, b.id === S.ich.benutzer.id ? h('span', { class: 'leise' }, ' (du)') : null), h('div', { class: 'k-unter' }, 'zuletzt aktiv: ' + zuletzt(b.zuletzt))),
      h('span', { class: 'marke' + (b.rolle === 'admin' ? ' akzent' : '') }, RN[b.rolle]),
      h('button', { class: 'knopf leicht klein', onclick: () => bearbeiten(b) }, 'Bearbeiten')))),
    h('p', { class: 'leise klein' }, 'Admin: Benutzer anlegen und alles einstellen. Benutzer: bedienen und die eigenen Startseiten (Handy und PC) gestalten.'));
}
export const kuerzel = (n) => String(n).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

const AKZENTE = ['#ea580c', '#dc2626', '#db2777', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#65a30d', '#a16207'];
function darstellungKarte() {
  const d = S.ich.darstellung;
  const setze = async (x) => {
    Object.assign(d, x); darstellungAnwenden();
    try { S.ich.darstellung = await api('ich/darstellung', 'PUT', x); } catch (e) { melde(e.message, true); }
    leeren(karte, ...inhalt());
  };
  const karte = h('div', { class: 'karte' });
  const inhalt = () => [
    h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Darstellung'), h('div', { class: 'k-unter' }, 'gilt für dich auf allen Geräten'))),
    h('div', { class: 'formblock' }, h('div', { class: 'leise' }, 'Farbschema'), h('div', { class: 'schemata' }, [['hell', 'Hell'], ['dunkel', 'Dunkel'], ['warm', 'Warm'], ['kuehl', 'Kühl']].map(([id, n]) => h('button', { class: 'schema s-' + id + (d.schema === id ? ' aktiv' : ''), onclick: () => setze({ schema: id }) }, h('span', { class: 'schema-bild' }, h('i'), h('i'), h('i')), n)))),
    h('div', { class: 'formblock' }, h('div', { class: 'leise' }, 'Akzentfarbe'), h('div', { class: 'akzente' },
      AKZENTE.map((a) => h('button', { class: 'akzent-wahl' + (d.akzent === a ? ' aktiv' : ''), style: { background: a }, 'aria-label': 'Akzent ' + a, onclick: () => setze({ akzent: a }) })),
      (() => { const x = h('input', { type: 'color', value: d.akzent, 'aria-label': 'Eigene Akzentfarbe' }); x.addEventListener('change', () => setze({ akzent: x.value })); return h('label', { class: 'knopf leicht klein farbwahl' }, 'Eigene …', x); })())),
    h('label', { class: 'haken' }, h('input', { type: 'checkbox', checked: d.nachtDunkel, onchange: (e) => setze({ nachtDunkel: e.target.checked }) }), 'Nachts automatisch dunkel (21–7 Uhr)'),
    h('div', { class: 'formblock' }, h('div', { class: 'leise' }, 'Schriftgröße'), h('div', { class: 'chips' }, [['klein', 'A−'], ['normal', 'Normal'], ['gross', 'A+']].map(([id, n]) => h('button', { class: 'chip' + (d.schrift === id ? ' aktiv' : ''), onclick: () => setze({ schrift: id }) }, n)))),
  ];
  leeren(karte, ...inhalt());
  return karte;
}

function passwortKarte() {
  const a = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'mindestens 8 Zeichen', 'aria-label': 'Neues Passwort' });
  const b = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'wiederholen', 'aria-label': 'Passwort wiederholen' });
  return h('div', { class: 'karte' }, h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Mein Passwort'), h('div', { class: 'k-unter' }, 'angemeldet als ' + S.ich.benutzer.name))),
    h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Neu'), a), h('label', { class: 'formzeile' }, h('span', { class: 'leise' }, 'Wiederholen'), b),
    h('div', { class: 'zeile-knopfe' }, h('button', { class: 'knopf', onclick: async () => {
      if (a.value !== b.value) return melde('Die beiden Eingaben sind verschieden', true);
      try { await api('ich/passwort', 'PUT', { passwort: a.value }); melde('Passwort geändert – bitte neu anmelden'); setTimeout(() => location.reload(), 1200); } catch (e) { melde(e.message, true); }
    } }, 'Ändern'), h('button', { class: 'knopf leicht', onclick: async () => { await api('abmelden', 'POST', {}); location.reload(); } }, icon('abmelden', 16), 'Abmelden')));
}

async function verbindungKarte() {
  const s = await api('status');
  return h('div', { class: 'karte' }, h('div', { class: 'k-kopf' }, h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, 'Verbindungen'), h('div', { class: 'k-unter' }, 'nur für Admins sichtbar'))),
    h('div', { class: 'wertzeile' }, h('span', null, h('b', null, 'openHAB'), h('br'), h('small', { class: 'leise' }, s.openhab.items + ' Items · API-Token hinterlegt' + (s.openhab.fehler ? ' · ' + s.openhab.fehler : ''))), h('span', null, h('span', { class: 'status-punkt ' + (s.openhab.verbunden ? 'gruen' : 'rot') }), s.openhab.verbunden ? 'verbunden' : 'getrennt')),
    h('div', { class: 'wertzeile' }, h('span', null, h('b', null, 'MAX!-Heizung'), h('br'), h('small', { class: 'leise' }, 'über openHAB · Wochenplan und Urlaub schreibt die Regel heizplan.js')), h('span', null, h('span', { class: 'status-punkt ' + (s.heizung ? 'gruen' : 'rot') }), s.heizung ? 'Heizplan da' : 'Heizplan fehlt')),
    h('p', { class: 'leise klein' }, 'Das Bundesland für die Feiertage stellst du auf der Seite Heizung ein.'));
}
