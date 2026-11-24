// Bedienelemente für Geräte: Licht (mit Lichtstimmungen und Abgleich), Heizung, Steckdosen, Sensoren, Alle Lichter, Haus-Modus
import { h, icon, live, befehl, api, melde, dialog, gedrosselt, leeren, verlaufBild, zahl, einheit, de, leer, zeit, grad, hsbZuCss, hsbZuHex, hexZuHsb, kelvinCss, zuMin, zuHHMM } from './kern.js';
import { M, S, st, item, lichtAn, helligkeit, lichter, planRaum, punktName, punktArt, teilName, maxTeile, raumthermostate } from './modell.js';

// ------------------------------------------------------------------ Lichtstimmungen (bewusst gedämpft – billige RGB-LEDs mischen grelle Farben schlecht)
export const STIMMUNGEN = [
  { id: 'kerze', name: 'Kerze', hsb: '28,75,35', anzeige: '#f4a259' },
  { id: 'warmweiss', name: 'Warmweiß', hsb: '32,45,70', anzeige: '#fbd9a6' },
  { id: 'abendrot', name: 'Abendrot', hsb: '18,70,55', anzeige: '#ee8b5f' },
  { id: 'bernstein', name: 'Bernstein', hsb: '38,80,55', anzeige: '#f3b443' },
  { id: 'rose', name: 'Rosé', hsb: '350,30,50', anzeige: '#e7a8b4' },
  { id: 'daemmerblau', name: 'Dämmerblau', hsb: '215,35,40', anzeige: '#8ea8cf' },
];
export const WEISS = [
  { id: 'kerze', name: 'Kerze', k: 2200, b: 35 },
  { id: 'gemuetlich', name: 'Gemütlich', k: 2700, b: 60 },
  { id: 'lesen', name: 'Lesen', k: 4000, b: 85 },
  { id: 'hell', name: 'Hell', k: 5000, b: 100 },
];
const stimmungWert = (g, s) => (S.lampen[g.name] && S.lampen[g.name][s.id]) || s.hsb;
function stimmungAktiv(g, s) {
  if (!g.p.farbe) return false;
  const [a, b, c] = String(st(g.p.farbe.name)).split(',').map(Number);
  const [x, y, z] = stimmungWert(g, s).split(',').map(Number);
  const dh = Math.min(Math.abs(a - x), 360 - Math.abs(a - x));
  return c > 0 && dh <= 6 && Math.abs(b - y) <= 8 && Math.abs(c - z) <= 8;
}

// ------------------------------------------------------------------ kleine Bausteine
export function kipp(an, aktion, label = 'Ein/Aus') {
  return h('button', { class: 'kipp' + (an ? ' an' : ''), role: 'switch', 'aria-checked': an ? 'true' : 'false', 'aria-label': label, onclick: (e) => { e.stopPropagation(); aktion(!an); } }, h('span'));
}
export function regler({ wert, min = 0, max = 100, schritt = 1, beiAenderung, klasse = '', stil, label }) {
  const r = h('input', { type: 'range', min, max, step: schritt, value: Number.isFinite(wert) ? wert : min, class: 'regler ' + klasse, 'aria-label': label });
  if (stil) r.style.background = stil;
  const senden = gedrosselt(beiAenderung, 350);
  r.addEventListener('input', () => { senden(Number(r.value)); });
  return r;
}
export function wertText(i) {
  if (!i) return '–';
  const s = st(i.name);
  if (leer(s)) return '–';
  if (i.options) { const o = i.options.find((x) => x.value === s); if (o) return o.label; }
  if (i.tags.includes('LowBattery')) return s === 'ON' ? '⚠ ja' : 'nein';
  if (i.type === 'Switch') return s === 'ON' ? 'an' : 'aus';
  if (i.type === 'String' && /modus|mode/i.test(i.label + i.name)) { const MO = { AUTOMATIC: 'Automatik', MANUAL: 'Manuell', BOOST: 'Boost', VACATION: 'Urlaub' }; if (MO[s]) return MO[s]; }
  if (i.type === 'Contact') return /fenster|tür/i.test(i.label) ? (s === 'OPEN' ? 'offen' : 'geschlossen') : (s === 'OPEN' ? 'offen' : 'zu');
  if (i.type === 'DateTime') return zeit(s);
  if (i.type === 'Color') { const b = String(s).split(','); return b[2] === '0' ? 'aus' : 'Farbe ' + b.join(' / '); }
  if (i.type === 'Dimmer' || i.type === 'Rollershutter') return de(zahl(s), 0) + ' %';
  if (i.type.startsWith('Number')) {
    const n = zahl(s); let e = einheit(s);
    if (!Number.isFinite(n)) return String(s);
    if (e === 'K') return new Intl.NumberFormat('de-DE').format(Math.round(n)) + ' K';
    if (!e && /ventil|batterieladung|feuchte/i.test(i.label)) e = '%';
    if (!e && /aktueller verbrauch|leistung/i.test(i.label)) e = 'W';
    if (!e && /zählerstand/i.test(i.label)) e = 'kWh';
    const stellen = e === 'W' && n >= 100 ? 0 : (e === 'kWh' && n > 1000 ? 0 : 1);
    return de(n, stellen) + (e ? ' ' + e.replace('°C', '°C') : '');
  }
  return String(s);
}
const sendeLicht = (g, an) => {
  const p = g.p;
  if (p.schalter) return befehl(p.schalter.name, an ? 'ON' : 'OFF');
  if (p.dimmer) return befehl(p.dimmer.name, an ? 'ON' : 'OFF');
  if (p.farbe) return befehl(p.farbe.name, an ? 'ON' : 'OFF');
};
export const lichtSchalten = sendeLicht;

// ------------------------------------------------------------------ Gerätekarten-Inhalte
/** Kopfzeile einer Karte: Symbol, Name, Zusatz rechts */
export function kopf(titel, unter, rechts, sym) {
  return h('div', { class: 'k-kopf' },
    sym ? h('span', { class: 'k-sym' }, icon(sym, 16)) : null,
    h('div', { class: 'k-titel' }, h('div', { class: 'k-name' }, titel), unter ? h('div', { class: 'k-unter' }, unter) : null),
    rechts || null);
}

/** Licht: an/aus, Helligkeit, Farbtemperatur, Lichtstimmungen (je nach Größe) */
export function lichtInhalt(g, groesse = 'm', mitRaum = false) {
  const an = lichtAn(g); const p = g.p;
  const hell = helligkeit(g);
  const teile = [];
  const unter = [an ? (Number.isFinite(hell) ? 'an · ' + de(hell, 0) + ' %' : 'an') : 'aus', mitRaum && g.raum ? M.raumName(g.raum) : null, p.leistung && an ? wertText(p.leistung) : null].filter(Boolean).join(' · ');
  teile.push(kopf(g.label, unter, kipp(an, (x) => sendeLicht(g, x), g.label + ' ein/aus'), 'licht'));
  if (groesse === 's') return h('div', { class: 'licht-klein' + (an ? ' leuchtet' : '') }, teile);
  if (p.dimmer || p.farbe) {
    teile.push(h('label', { class: 'zeile' }, h('span', { class: 'leise' }, 'Helligkeit'),
      regler({ wert: Number.isFinite(hell) ? hell : 0, label: 'Helligkeit ' + g.label, klasse: 'hell', beiAenderung: (v) => befehl((p.dimmer || p.farbe).name, v) })));
  }
  if (p.ct) {
    const k = zahl(st(p.ct.name));
    teile.push(h('label', { class: 'zeile' }, h('span', { class: 'leise' }, 'Farbtemperatur'),
      regler({ wert: Number.isFinite(k) ? k : 2700, min: 2200, max: 6500, schritt: 100, label: 'Farbtemperatur ' + g.label, klasse: 'ct', beiAenderung: (v) => befehl(p.ct.name, v + ' K') })));
  }
  if (groesse === 'l' || groesse === 'voll') {
    if (p.ct && !p.farbe) teile.push(weissKnoepfe(g));
    if (p.farbe) teile.push(stimmungen(g, groesse === 'voll'));
  }
  return h('div', { class: 'licht' + (an ? ' leuchtet' : '') }, teile);
}
function weissKnoepfe(g) {
  const k = zahl(st(g.p.ct.name));
  return h('div', { class: 'chips' }, WEISS.map((w) => h('button', {
    class: 'chip' + (Math.abs(k - w.k) < 60 && lichtAn(g) ? ' aktiv' : ''), style: { '--muster': kelvinCss(w.k) },
    onclick: async () => { await befehl(g.p.ct.name, w.k + ' K'); if (g.p.dimmer) await befehl(g.p.dimmer.name, w.b); },
  }, h('span', { class: 'punkt' }), w.name)));
}
function stimmungen(g, mitMehr) {
  const kn = h('div', { class: 'stimmungen' }, STIMMUNGEN.map((s) => h('button', {
    class: 'stimmung' + (stimmungAktiv(g, s) ? ' aktiv' : ''), title: s.name,
    onclick: () => befehl(g.p.farbe.name, stimmungWert(g, s)),
  }, h('span', { class: 'farbfeld', style: { background: s.anzeige } }), h('span', null, s.name))));
  const teile = [h('div', { class: 'leise klein' }, 'Lichtstimmungen'), kn];
  if (g.p.ct && g.p.farbe) teile.push(weissKnoepfe(g));
  if (mitMehr) {
    const eigen = h('input', { type: 'color', value: hsbZuHex(String(st(g.p.farbe.name)).split(',').slice(0, 2).join(',') + ',100'), 'aria-label': 'Eigene Farbe' });
    eigen.addEventListener('change', () => { const [hh, ss] = hexZuHsb(eigen.value).split(','); const b = Math.max(20, helligkeit(g) || 60); befehl(g.p.farbe.name, `${hh},${ss},${b}`); });
    const zeile = h('div', { class: 'zeile-knopfe' },
      h('button', { class: 'knopf leicht', onclick: () => abgleichDialog(g) }, 'Für diese Lampe abgleichen'),
      h('label', { class: 'knopf leicht farbwahl' }, 'Eigene Farbe', eigen));
    if (g.p.effekt && g.p.effekt.options) {
      const sel = h('select', { 'aria-label': 'Effekt', onchange: (e) => befehl(g.p.effekt.name, e.target.value) },
        h('option', { value: '' }, 'Kein Effekt'), g.p.effekt.options.map((o) => h('option', { value: o.value, selected: st(g.p.effekt.name) === o.value }, o.label)));
      zeile.append(sel);
    }
    teile.push(zeile, h('div', { class: 'leise klein' }, 'Mischt die Lampe schräg? Mit „Abgleichen“ stellst du jede Stimmung für genau diese Lampe ein.'));
  }
  return h('div', { class: 'stimmungsblock' }, teile);
}

/** Abgleich: jede Stimmung für eine Lampe nachstellen – die Lampe zeigt beim Schieben sofort das Ergebnis */
export function abgleichDialog(g) {
  const werte = Object.fromEntries(STIMMUNGEN.map((s) => [s.id, stimmungWert(g, s)]));
  const vorher = st(g.p.farbe.name);
  const senden = gedrosselt((v) => befehl(g.p.farbe.name, v), 300);
  const zeilen = STIMMUNGEN.map((s) => {
    const [hh, ss, bb] = werte[s.id].split(',').map(Number);
    const vorschau = h('span', { class: 'farbfeld gross', style: { background: hsbZuCss(werte[s.id]) } });
    const setze = (i, v) => { const a = werte[s.id].split(',').map(Number); a[i] = v; werte[s.id] = a.join(','); vorschau.style.background = hsbZuCss(werte[s.id]); senden(werte[s.id]); };
    const r = (i, w, max, cls) => { const x = h('input', { type: 'range', min: i === 2 ? 5 : 0, max, value: w, class: 'regler ' + cls, 'aria-label': s.name + ' ' + ['Farbton', 'Sättigung', 'Helligkeit'][i] }); x.addEventListener('input', () => setze(i, Number(x.value))); return x; };
    const rr = [r(0, hh, 359, 'farbton'), r(1, ss, 100, 'saett'), r(2, bb, 100, 'hell')];
    const standard = () => { werte[s.id] = s.hsb; s.hsb.split(',').forEach((v, i) => { rr[i].value = v; }); vorschau.style.background = hsbZuCss(s.hsb); senden(s.hsb); };
    return h('div', { class: 'abgleich' },
      h('div', { class: 'abgleich-kopf' }, h('span', { class: 'farbfeld gross', style: { background: s.anzeige }, title: 'so soll es aussehen' }), h('b', null, s.name), h('span', { class: 'pfeil' }, '→'), vorschau,
        h('button', { class: 'knopf leicht klein', onclick: () => senden(werte[s.id]) }, 'Zeigen'),
        h('button', { class: 'knopf leicht klein', onclick: standard }, 'Standard')),
      h('div', { class: 'abgleich-regler' }, rr));
  });
  const box = h('div', null, h('p', { class: 'leise' }, 'Links die gewünschte Wirkung. Schiebe die Regler, bis die Lampe so aussieht – sie zeigt jede Änderung sofort.'), zeilen);
  dialog('Abgleich: ' + g.label, box, {
    breit: true,
    knoepfe: [
      { text: 'Alle zurücksetzen', klasse: 'knopf leicht', aktion: async () => { delete S.lampen[g.name]; await api('lampen/' + g.name, 'PUT', {}); melde('Standardwerte für ' + g.label); } },
      { text: 'Speichern', klasse: 'knopf', aktion: async () => { S.lampen[g.name] = await api('lampen/' + g.name, 'PUT', werte); melde('Abgleich gespeichert'); } },
    ],
    beimSchliessen: () => { if (!leer(vorher)) befehl(g.p.farbe.name, vorher).catch(() => {}); },
  });
}

/** Heizung eines Raums: Ist, Soll mit −/+, Modus, Ventil, Fenster, nächster Schaltpunkt */
export function heizInhalt(g, groesse = 'm') {
  const p = g.p;
  const ist = p.temp ? zahl(st(p.temp.name)) : NaN;
  const soll = p.soll ? zahl(st(p.soll.name)) : NaN;
  const modus = p.modus ? st(p.modus.name) : null;
  const MODI = { AUTOMATIC: 'Automatik', MANUAL: 'Manuell', BOOST: 'Boost', VACATION: 'Urlaub' };
  const naechst = naechsterPunkt(g);
  const ventile = (p.ventile || []).map((v) => zahl(st(v.name))).filter(Number.isFinite);   // alle Heizkörper des Raums, z. B. Küche: 40 / 35 %
  const fensterAuf = p.fenster && st(p.fenster.name) === 'OPEN';
  const info = [MODI[modus] || null, naechst && modus === 'AUTOMATIC' ? naechst : null, ventile.length ? (ventile.length > 1 ? 'Ventile ' : 'Ventil ') + ventile.map((v) => de(v, 0)).join(' / ') + ' %' : null, fensterAuf ? 'Fenster offen' : null].filter(Boolean).join(' · ');
  const stelle = (d) => { if (!p.soll || !Number.isFinite(soll)) return; const v = Math.min(30.5, Math.max(4.5, soll + d)); befehl(p.soll.name, v + ' °C'); };
  const sollBox = h('div', { class: 'soll' },
    h('button', { class: 'rund kalt', 'aria-label': 'kälter', onclick: (e) => { e.stopPropagation(); stelle(-0.5); } }, '−'),
    h('div', { class: 'soll-wert' }, h('div', { class: 'gross akzent' }, Number.isFinite(soll) ? de(soll) + '°' : '–'), h('div', { class: 'leise klein' }, 'Soll')),
    h('button', { class: 'rund warm', 'aria-label': 'wärmer', onclick: (e) => { e.stopPropagation(); stelle(0.5); } }, '+'));
  const titel = g.raum ? M.raumName(g.raum) : g.label;
  if (groesse === 's') {
    return h('div', { class: 'heiz klein' + (fensterAuf ? ' fenster' : '') }, kopf(titel, MODI[modus] || '', null, 'thermo'),
      h('div', { class: 'heiz-zeile' }, h('div', { class: 'ist' }, Number.isFinite(ist) ? de(ist) : '–', h('small', null, ' °C')), sollBox));
  }
  const teile = [kopf(titel, info, null, 'thermo'),
    h('div', { class: 'heiz-zeile' }, h('div', { class: 'ist gross2' }, Number.isFinite(ist) ? de(ist) : '–', h('small', null, ' °C')), sollBox)];
  if ((groesse === 'l' || groesse === 'voll') && p.modus) {
    teile.push(h('div', { class: 'chips' }, ['AUTOMATIC', 'MANUAL', 'BOOST'].map((m) => h('button', { class: 'chip' + (modus === m ? ' aktiv' : ''), onclick: () => befehl(p.modus.name, m) }, MODI[m]))));
  }
  if (groesse === 'voll') {
    const bat = p.batterie.filter((b) => st(b.name) === 'ON');
    const mt = maxTeile(g);
    if (mt) teile.push(h('div', { class: 'leise klein', style: { marginTop: '8px' } }, 'MAX!: ' + mt));
    for (const r of raumthermostate(g.raum)) {
      const w = [r.p.temp && wertText(r.p.temp), r.p.feuchte && wertText(r.p.feuchte)].filter(Boolean).join(' · ');
      teile.push(h('div', { class: 'leise klein' }, r.label + ': ' + (w || '–')));
    }
    teile.push(h('div', { class: 'leise klein' }, [p.fenster ? 'Fenster ' + wertText(p.fenster) : null, bat.length ? '⚠ Batterie schwach: ' + bat.map((b) => teilName(b.quelle) || b.name).join(', ') : 'Batterien in Ordnung'].filter(Boolean).join(' · ')));
  }
  return h('div', { class: 'heiz' + (fensterAuf ? ' fenster' : '') }, teile);
}
/** „bis 22:00, dann 17 °C“ aus dem heutigen Plan */
function naechsterPunkt(g) {
  const H = S.heizung; if (!H || !H.daten || !H.effektiv || !H.effektiv.length) return null;
  const rid = planRaum(g.raum); if (!rid) return null;
  const heute = H.effektiv[0];
  const v = H.daten.vorlagen.find((x) => x.id === heute.vorlage);
  const punkte = v && v.muster[rid]; if (!punkte) return null;
  const jetzt = new Date().getHours() * 60 + new Date().getMinutes();
  const n = [...punkte].sort((a, b) => zuMin(a[0]) - zuMin(b[0])).find(([t]) => zuMin(t) > jetzt);
  return n ? `bis ${n[0]}, dann ${de(n[1])} °C` : null;
}

/** Steckdose / Schalter */
export function steckdoseInhalt(g, groesse = 'm', mitRaum = false) {
  const p = g.p; const an = p.schalter && st(p.schalter.name) === 'ON';
  const unter = [an ? 'an' : 'aus', p.leistung ? wertText(p.leistung) : null, mitRaum && g.raum ? M.raumName(g.raum) : null].filter(Boolean).join(' · ');
  const teile = [kopf(g.label, unter, p.schalter ? kipp(an, (x) => befehl(p.schalter.name, x ? 'ON' : 'OFF'), g.label) : null, 'stecker')];
  if (groesse !== 's' && p.schalterAlle.length > 1) {
    teile.push(h('div', { class: 'liste-werte' }, p.schalterAlle.slice(1).map((s) => h('div', { class: 'wertzeile' }, h('span', null, punktName(s)), kipp(st(s.name) === 'ON', (x) => befehl(s.name, x ? 'ON' : 'OFF'), punktName(s))))));
  }
  if ((groesse === 'l' || groesse === 'voll') && p.energie) teile.push(h('div', { class: 'leise klein' }, 'Verbrauch gesamt ' + wertText(p.energie)));
  return h('div', { class: 'dose' + (an ? ' aktiv' : '') }, teile);
}

/** Sensoren / Zähler: Hauptwerte groß */
export function sensorInhalt(g, groesse = 'm', mitRaum = false) {
  const p = g.p;
  const werte = [p.temp && ['thermo', wertText(p.temp)], p.feuchte && ['tropfen', wertText(p.feuchte)], p.leistung && ['energie', wertText(p.leistung)], p.energie && ['welle', wertText(p.energie)]].filter(Boolean);
  const unter = mitRaum && g.raum ? M.raumName(g.raum) : '';
  if (!werte.length) {
    // nichts Typisches gefunden (z. B. Taster): Batterie bzw. die ersten Werte zeigen
    const bat = p.batterie.length ? (p.batterie.some((b) => st(b.name) === 'ON') ? '⚠ Batterie schwach' : 'Batterie in Ordnung') : null;
    const rest = g.alle.map(item).filter((i) => i && i.type !== 'DateTime' && !leer(i.state) && !i.tags.includes('LowBattery')).slice(0, groesse === 's' ? 1 : 3);
    return h('div', { class: 'sensor' }, kopf(g.label, unter, null, null), h('div', { class: 'leise klein', style: { marginTop: '8px' } }, [bat, ...rest.map((i) => i.label + ': ' + wertText(i))].filter(Boolean).join(' · ') || 'keine Werte'));
  }
  return h('div', { class: 'sensor' }, kopf(g.label, unter, null, null),
    h('div', { class: 'sensor-werte' + (groesse === 's' ? ' klein' : '') }, werte.slice(0, groesse === 's' ? 1 : 4).map(([sym, w], i) => h('div', { class: 'sw' + (i === 0 ? ' haupt' : '') }, icon(sym, 14), h('span', null, w)))),
    groesse !== 's' && groesse !== 'voll' && verlaufItem(g) ? sparkline(verlaufItem(g)) : null);
}

export function geraetInhalt(g, groesse = 'm', mitRaum = false) {
  if (g.klasse === 'licht') return lichtInhalt(g, groesse, mitRaum);
  if (g.klasse === 'heizung') return heizInhalt(g, groesse);
  if (g.klasse === 'steckdose') return steckdoseInhalt(g, groesse, mitRaum);
  return sensorInhalt(g, groesse, mitRaum);
}

/** Alle Werte eines Geräts (Schalter bedienbar, Rest als Text) */
const ARTEN = [['bedienung', 'Bedienung'], ['messung', 'Messwerte'], ['zustand', 'Batterie & Verbindung'], ['technik', 'Technik']];
/** Alle Werte eines Geräts – verständlich benannt und sortiert; bei mehrteiligen Geräten (Heizung) je Teil */
export function alleWerte(g) {
  // gleiche Namen innerhalb eines Geräts unterscheiden (z. B. zwei Fühler in einem Zigbee-Thermostat, zwei Leistungswerte eines Shelly)
  const anzahl = {};
  for (const n of g.alle) { const i = item(n); if (i) { const k = punktName(i) + '|' + ((g.teilVon && g.teilVon[n]) || ''); anzahl[k] = (anzahl[k] || 0) + 1; } }
  const fuehler = g.alle.some((n) => /luftfeu|humid/i.test(n)) && g.alle.some((n) => !/luftfeu|humid/i.test(n) && /temp|termostat|thermostat/i.test(n));
  const gesehen = new Set(); const doppelt = new Set();
  for (const n of g.alle) { const i = item(n); if (!i || fuehler) continue; const k = punktName(i) + '|' + ((g.teilVon && g.teilVon[n]) || ''); if (anzahl[k] > 1) { if (gesehen.has(k)) doppelt.add(n); gesehen.add(k); } }
  const name = (i) => {
    const k = punktName(i) + '|' + ((g.teilVon && g.teilVon[i.name]) || '');
    if (anzahl[k] < 2) return punktName(i);
    if (fuehler) return punktName(i) + (/luftfeu|humid/i.test(i.name) ? ' · Feuchtefühler' : ' · Temperaturfühler');
    return doppelt.has(i.name) ? punktName(i) + ' (' + i.label + ')' : punktName(i);
  };
  const art = (i) => (doppelt.has(i.name) ? 'technik' : punktArt(i));   // gleiche Werte doppelt (z. B. Shelly deutsch + englisch): zweiten unter Technik
  const zeile = (i) => {
    const bedienbar = !i.readOnly && i.type === 'Switch' && !i.tags.includes('LowBattery') && !i.tags.includes('Alarm');
    return h('div', { class: 'wertzeile' }, h('span', { class: 'leise' }, name(i)), bedienbar ? kipp(st(i.name) === 'ON', (x) => befehl(i.name, x ? 'ON' : 'OFF'), punktName(i)) : h('span', null, wertText(i)));
  };
  const werte = g.alle.map(item).filter(Boolean);
  // Herkunft (Untergerät) aus der Gruppenzugehörigkeit
  const teil = (i) => (g.teilVon && g.teilVon[i.name]) || null;
  const teile = [...new Set(werte.map(teil))];
  const block = (liste) => ARTEN.map(([artId, titel]) => {
    const l = liste.filter((i) => art(i) === artId);
    if (!l.length) return null;
    const inhalt = l.map(zeile);
    if (artId === 'technik') return h('details', { class: 'werte-gruppe' }, h('summary', { class: 'leise klein' }, titel + ' (' + l.length + ')'), inhalt);
    return h('div', { class: 'werte-gruppe' }, h('div', { class: 'werte-titel leise klein' }, titel), inhalt);
  });
  if (teile.length > 1) {
    return h('div', { class: 'liste-werte' }, teile.sort((a, b) => teilName(a).localeCompare(teilName(b), 'de')).map((t) => h('div', { class: 'werte-teil' },
      h('div', { class: 'werte-teil-name' }, teilName(t) || 'Gerät'), block(werte.filter((i) => teil(i) === t)))));
  }
  return h('div', { class: 'liste-werte' }, block(werte));
}

/** Alle Lichter: Schalter mit Mittelstellung – links alle aus, rechts alle an, Mitte = teils */
export function alleLichterInhalt(gross = true, liste) {
  const alle = liste || lichter();
  const an = alle.filter((g) => lichtAn(g)).length;
  const lage = an === 0 ? 'aus' : an === alle.length ? 'an' : 'teils';
  const setze = async (x) => { await Promise.allSettled(alle.map((g) => sendeLicht(g, x))); };
  const schalter = h('div', { class: 'drei lage-' + lage, role: 'group', 'aria-label': 'Alle Lichter' },
    h('button', { class: 'drei-aus', onclick: () => setze(false) }, 'Alle aus'),
    h('span', { class: 'drei-knopf', 'aria-hidden': 'true' }),
    h('button', { class: 'drei-an', onclick: () => setze(true) }, 'Alle an'));
  // Wischen auf dem Knopf: nach links = aus, nach rechts = an
  let x0 = null;
  schalter.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  schalter.addEventListener('pointerup', (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 30) setze(e.clientX > x0); x0 = null; });
  return h('div', { class: 'alle-lichter' }, kopf(liste ? 'Lichter im Raum' : 'Alle Lichter', `${an} von ${alle.length} an · links alle aus, rechts alle an`, null, 'licht'), gross ? schalter : schalter);
}

/** Ganzes Haus: Eco / Automatik / Komfort */
export function hausInhalt() {
  const H = S.heizung;
  const modi = [['eco', 'Eco', H && H.daten ? de(H.daten.eco) + ' °C' : ''], ['auto', 'Automatik', 'Wochenplan'], ['komfort', 'Komfort', H && H.daten ? de(H.daten.komfort) + ' °C' : '']];
  // aktueller Zustand aus den Modi der Thermostate
  const mo = [...M.geraete.values()].filter((g) => g.klasse === 'heizung' && g.p.modus).map((g) => st(g.p.modus.name));
  const alleAuto = mo.length && mo.every((m) => m === 'AUTOMATIC');
  return h('div', { class: 'haus' }, kopf('Ganzes Haus', alleAuto ? 'alle Räume im Wochenplan' : 'einige Räume manuell', null, 'haus'),
    h('div', { class: 'chips voll' }, modi.map(([id, name, unter]) => h('button', {
      class: 'chip gross' + (id === 'auto' && alleAuto ? ' aktiv' : ''),
      onclick: async () => { try { await api('heizung/haus', 'POST', { modus: id }); melde(name + ' für alle Räume'); } catch (e) { melde(e.message, true); } },
    }, h('b', null, name), h('small', null, unter)))));
}

/** Heute anders: Vorlage für heute wählen */
export function heuteInhalt(neuLaden) {
  const H = S.heizung;
  if (!H || !H.verfuegbar) return h('div', null, kopf('Heute anders', 'Heizplan noch nicht verfügbar', null, 'kalender'));
  const heute = H.effektiv[0];
  const geplant = H.daten.woche[heute.key];
  const aus = H.daten.ausnahmen[heute.datum];
  return h('div', { class: 'heute' }, kopf('Heute anders', aus ? 'heute: „' + name(H, aus.vorlage) + '“ · morgen wieder normal' : 'heute ist „' + name(H, heute.vorlage) + '“ geplant', null, 'kalender'),
    h('div', { class: 'chips' }, H.daten.vorlagen.map((v) => h('button', {
      class: 'chip' + (heute.vorlage === v.id ? ' aktiv' : ''),
      onclick: async () => { try { S.heizung = await api('heizung/heute', 'POST', { vorlage: v.id === geplant ? null : v.id }); melde(v.id === geplant ? 'Heute wieder nach Plan' : 'Heute: ' + v.name); neuLaden && neuLaden(); } catch (e) { melde(e.message, true); } },
    }, v.name))));
}
const name = (H, id) => { const v = H.daten.vorlagen.find((x) => x.id === id); return v ? v.name : id; };

/** Raum als Kachel: Temperatur, Lichter, kurz alles aus */
export function raumInhalt(r) {
  const t = (() => { const g = r.geraete.find((x) => x.klasse === 'heizung' && x.p.temp) || r.geraete.find((x) => x.p.temp && (x.klasse === 'raumthermostat' || x.klasse === 'sensor')); return g ? zahl(st(g.p.temp.name)) : NaN; })();
  const l = r.geraete.filter((g) => g.klasse === 'licht');
  const an = l.filter((g) => lichtAn(g));
  return h('div', { class: 'raumkachel' }, kopf(r.label, [Number.isFinite(t) ? grad(t) : null, l.length ? an.length + ' von ' + l.length + ' Lichtern an' : null].filter(Boolean).join(' · '), an.length ? h('button', { class: 'knopf leicht klein', onclick: (e) => { e.stopPropagation(); an.forEach((g) => sendeLicht(g, false)); } }, 'Licht aus') : null, 'raum'));
}

export { live };

// ------------------------------------------------------------------ Verlauf und Detailansicht
const verlaufCache = new Map();
async function verlaufLaden(name, stunden) {
  const k = name + '|' + stunden; const c = verlaufCache.get(k);
  if (c && Date.now() - c.zeit < 5 * 60e3) return c.daten;
  const d = await api('verlauf/' + name + '?stunden=' + stunden);
  verlaufCache.set(k, { zeit: Date.now(), daten: d });
  return d;
}
/** Hauptmesswert eines Geräts für den Verlauf (Temperatur, sonst Leistung, sonst Feuchte) */
export function verlaufItem(g) { return g.p.temp || g.p.leistung || g.p.feuchte || null; }
const einheitVon = (i) => (i.type.includes('Temperature') || /temp/i.test(i.label) ? '°C' : i.type.includes('Power') || /leistung|verbrauch|power/i.test(i.label) ? 'W' : /feuchte|humid/i.test(i.label) ? '%' : '');

/** Kleine Linie der letzten 24 Stunden (füllt große Kacheln sinnvoll) */
export function sparkline(i) {
  const box = h('div', { class: 'spark' });
  verlaufLaden(i.name, 24).then((d) => box.append(verlaufBild(d.punkte, { klein: true }))).catch(() => {});
  return box;
}
/** Diagramm mit Umschalter 24 h / 7 Tage / 30 Tage */
export function verlaufBox(i, titel) {
  const box = h('div', { class: 'verlauf-box' });
  const bild = h('div'); const zahlen = h('div', { class: 'verlauf-zahlen' });
  const e = einheitVon(i);
  let stunden = 24;
  const zeige = async () => {
    leeren(bild, h('div', { class: 'leise klein' }, 'Verlauf wird geladen …'));
    try {
      const d = await verlaufLaden(i.name, stunden);
      leeren(bild, verlaufBild(d.punkte, { einheit: e, stellen: e === 'W' ? 0 : 1, breite: bild.clientWidth || 600 }));
      const w = d.punkte.map((p) => p[1]);
      leeren(zahlen, w.length ? [h('span', null, 'min ' + de(Math.min(...w), e === 'W' ? 0 : 1) + ' ' + e), h('span', null, 'Ø ' + de(w.reduce((s, x) => s + x, 0) / w.length, e === 'W' ? 0 : 1) + ' ' + e), h('span', null, 'max ' + de(Math.max(...w), e === 'W' ? 0 : 1) + ' ' + e)] : []);
    } catch (x) { leeren(bild, h('div', { class: 'leise klein' }, x.message)); leeren(zahlen); }
    for (const b of knoepfe.querySelectorAll('.chip')) b.classList.toggle('aktiv', Number(b.dataset.h) === stunden);
  };
  const knoepfe = h('div', { class: 'chips' }, [[24, '24 Std.'], [168, '7 Tage'], [720, '30 Tage']].map(([s, n]) => h('button', { class: 'chip', dataset: { h: s }, onclick: () => { stunden = s; zeige(); } }, n)));
  box.append(h('div', { class: 'verlauf-kopf' }, h('b', null, titel || punktName(i)), knoepfe), bild, zahlen);
  zeige();
  return box;
}
/** Detailansicht eines Geräts: volle Bedienung, Verlauf, alle Werte */
export function geraetDetail(g) {
  const vi = verlaufItem(g);
  const inhalt = h('div', null,
    live(() => geraetInhalt(g, 'voll', true)),
    vi ? verlaufBox(vi) : null,
    g.klasse === 'heizung' && g.p.soll ? verlaufBox(g.p.soll, 'Soll-Temperatur') : null,
    g.alle.length > 1 ? h('details', { class: 'detail-werte' }, h('summary', { class: 'leise' }, 'Alle Werte (' + g.alle.length + ')'), live(() => alleWerte(g))) : null);
  dialog(g.label, inhalt, { breit: true });
}
