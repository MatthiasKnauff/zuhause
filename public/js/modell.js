// Haus-Modell aus dem semantischen Modell von openHAB: Räume → Geräte → Werte
import { merke, zahl, leer } from './kern.js';

export const M = { items: new Map(), kinder: new Map(), raeume: [], geraete: new Map(), ohneRaum: [] };

const GERAETE_TAGS = ['Equipment', 'LightSource', 'Lightbulb', 'PowerOutlet', 'RadiatorControl', 'Thermostat', 'TemperatureSensor', 'Sensor', 'WallSwitch', 'Camera', 'NetworkAppliance', 'Battery', 'Inverter', 'ElectricMeter', 'WhiteGood', 'Speaker', 'Screen', 'Window', 'Door', 'Blinds', 'HVAC', 'Fan'];
const istOrt = (i) => i && (i.tags.includes('Location') || String(i.sem || '').startsWith('Location') || ['Room', 'LivingRoom', 'Kitchen', 'Bathroom', 'Bedroom', 'Office', 'Corridor', 'Floor', 'Outdoor', 'Garden', 'Terrace', 'Carport', 'Garage', 'Cellar', 'Attic'].some((t) => i.tags.includes(t)));
const istGeraetGruppe = (i) => i && i.type === 'Group' && !istOrt(i) && (GERAETE_TAGS.some((t) => i.tags.includes(t)) || String(i.sem || '').startsWith('Equipment'));

/** Wert eines Items (merkt die Abhängigkeit für die Live-Anzeige) */
export function st(name) { merke(name); const i = M.items.get(name); return i ? i.state : undefined; }
export function item(name) { return M.items.get(name); }

/** Bezeichnungen aufräumen: „Drucker (shellyplug-s-b4d78e@192.168.179.213)“ → „Drucker“ */
export function schoen(label, name) {
  let l = String(label || '').replace(/\s*\([^)]*(@|\d+\.\d+\.\d+\.\d+)[^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!l) l = String(name).replace(/_/g, ' ');
  return l;
}
// ------------------------------------------------------------------ Verständliche Namen
/** Bezeichnungen von Werten, die openHAB/die Bindings kryptisch oder englisch liefern */
const PUNKT_NAMEN = [
  [/^(output|betrieb|energie-status|switch|steckdose)$/i, 'Ein/Aus'],
  [/^betrieb (\d)$/i, 'Ausgang $1'],
  [/^(power consumption|stromverbrauch|leistung)$/i, 'Leistung jetzt'],
  [/^schnitt letzte minute 1$/i, 'Leistung Ø letzte Minute'],
  [/^(total energy consumption|gesamtverbrauch|energieverbrauch)$/i, 'Verbrauch gesamt'],
  [/^average energy - last 3 minutes$/i, 'Verbrauch Ø 3 Minuten'],
  [/^energy - previous minute$/i, 'Verbrauch letzte Minute'],
  [/^energy - (\d) minutes ago$/i, 'Verbrauch vor $1 Minuten'],
  [/^aktueller verbrauch$/i, 'Leistung jetzt'],
  [/^zählerstand$/i, 'Zählerstand'],
  [/^innentemperatur$/i, 'Temperatur im Gerät'],
  [/^elektrische spannung$/i, 'Spannung'],
  [/^device firmware$/i, 'Firmware'],
  [/^firmwareaktualisierung verfügbar$/i, 'Firmware-Update verfügbar'],
  [/^connectivity$/i, 'Verbindung'],
  [/^alert$/i, 'Blinken (Suchen)'],
  [/^dauer$/i, 'Übergangszeit'],
  [/^zuletzt gesehen$/i, 'Zuletzt erreichbar'],
  [/^letzte aktualisierung$/i, 'Zuletzt gemeldet'],
  [/^letzte aktivität$/i, 'Zuletzt aktiv'],
  [/^eingang\/taste( \d)?$/i, 'Taster am Gerät$1'],
  [/^ereignis-anzahl$/i, 'Taster: Anzahl Ereignisse'],
  [/^letztes ereignis$/i, 'Taster: letztes Ereignis'],
  [/^ausgangsname$/i, 'Name im Gerät'],
  [/^gerätename$/i, 'Name im Gerät'],
  [/^betriebs-led aus$/i, 'Betriebs-LED aus'],
  [/^status-led aus$/i, 'Status-LED aus'],
  [/^auto-an-timer$/i, 'Automatisch an nach'],
  [/^auto-aus timer$/i, 'Automatisch aus nach'],
  [/^autom\. ein\/aus timer aktiv$/i, 'Automatik-Timer aktiv'],
  [/^laufzeit$/i, 'Laufzeit seit Neustart'],
  [/^signalstärke$/i, 'Funksignal'],
  [/^niedriger batteriestatus$/i, 'Batterie schwach'],
  [/^batterieladung$/i, 'Batterie'],
  [/^tür-\/fenster-zustand$/i, 'Fenster'],
  [/^externes schalten$/i, 'Schalten von außen gesperrt'],
  [/^tastensperre$/i, 'Tastensperre'],
  [/^modus\b.*$/i, 'Modus'],
  [/^solltemperatur$/i, 'Soll-Temperatur'],
  [/^temperatur$/i, 'Temperatur'],
  [/^ventilposition$/i, 'Ventil'],
  [/^auslastungsgrad$/i, 'Funk-Auslastung'],
  [/^freie speicherplätze$/i, 'Freie Speicherplätze'],
  [/^farbeffekt$/i, 'Effekt'],
];
/** Teil eines Geräts, aus dem ein Wert stammt (bei der Heizung: Wandthermostat, Heizkörper, Fensterkontakt …) */
export function teilName(quelle) {
  if (!quelle) return '';
  const i = M.items.get(quelle);
  const l = schoen(i && i.label, quelle);
  if (/^WT[_ ]/i.test(quelle)) return 'MAX!-Wandthermostat';
  if (/^HT[_ ]/i.test(quelle)) { const n = /(\d)\s*$/.exec(l.trim()); return 'MAX!-Heizkörperthermostat' + (n ? ' ' + n[1] : ''); }
  if (/^FK[_ ]/i.test(quelle)) return 'MAX!-Fensterkontakt';
  if (/cube/i.test(quelle)) return 'MAX!-Cube';
  return l;
}
/** verständlicher Name eines Werts; Messwerte zweier Sensoren eines Geräts werden über den Item-Namen unterschieden */
export function punktName(i) {
  if (!i) return '';
  let l = String(i.label || '').trim() || String(i.name).replace(/_/g, ' ');
  for (const [re, neu] of PUNKT_NAMEN) if (re.test(l)) { l = l.replace(re, neu); break; }
  return l;
}
/** Art eines Werts für die Gruppierung in „Alle Werte“ */
export function punktArt(i) {
  const l = String(i.label || '');
  if (i.tags.includes('LowBattery') || /batterie|signal|funk|zuletzt|letzte aktual|letzte aktiv|verbindung|connectivity/i.test(l) || i.type === 'DateTime') return 'zustand';
  if (/LED aus|timer|firmware|ausgangsname|gerätename|laufzeit|alert|dauer|ereignis|eingang|tastensperre|externes|speicherpl|minute|average/i.test(l)) return 'technik';
  if (!i.readOnly && /^(Switch|Dimmer|Color|Rollershutter)/.test(i.type)) return 'bedienung';
  if (i.tags.includes('Setpoint') || (i.tags.includes('Control') && !i.readOnly)) return 'bedienung';
  if (/modus/i.test(l) && i.type === 'String') return 'bedienung';
  return 'messung';
}

/** Geräte, die openHAB keinem Raum zuordnet, kommen in eine dieser Gruppen */
export const EXTRA_RAEUME = [
  { name: 'zh:draussen', label: 'Draußen' },
  { name: 'zh:technik', label: 'Haustechnik' },
];
/** Vorgaben für Gerätenamen, die so aus den Bindings kommen und wenig sagen (eigene Namen gehen immer vor) */
const GERAETE_NAMEN = [
  [/^FRITZ!?DECT ?200$/i, 'FRITZ!DECT-Steckdose'],
  [/^BitShake Stromz(ä|a)hler$/i, 'Stromzähler'],
  [/^Eco[ _-]?Taster$/i, 'Eco-Taster (Heizung)'],
  [/^Außensensor$/i, 'Außenfühler'],
  [/^Klimasensor (.+)$/i, 'Raumthermostat $1'],
];
const INTERN = /^Heizplan_|^alle_Lichter$|^Heizungsmodus_alle$/;

export const ohneUmlaut = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

export function aufbauen(liste) {
  M.items = new Map(liste.map((i) => [i.name, i]));
  M.kinder = new Map();
  for (const i of liste) for (const g of i.groupNames) { if (!M.kinder.has(g)) M.kinder.set(g, []); M.kinder.get(g).push(i.name); }
  M.geraete = new Map();
  const orte = liste.filter((i) => i.type === 'Group' && istOrt(i));
  const ortVon = new Map();
  for (const o of orte) for (const k of M.kinder.get(o.name) || []) ortVon.set(k, o.name);
  // Geräte = oberste Geräte-Gruppen (Untergruppen wie die Thermostate einer Raumheizung gehören zum Gerät)
  for (const i of liste) {
    if (!istGeraetGruppe(i)) continue;
    if (i.groupNames.some((g) => istGeraetGruppe(M.items.get(g)))) continue;
    const raum = i.groupNames.find((g) => istOrt(M.items.get(g))) || null;
    M.geraete.set(i.name, geraet(i, raum));
  }
  // Einzelne Items, die in keinem Gerät stecken (direkt im Raum oder ganz ohne Modell), werden ebenfalls Geräte –
  // sonst fehlen z. B. Steckdosen oder Lampen, die in openHAB nicht als Equipment angelegt sind.
  const inGeraet = (i, tiefe = 0) => tiefe < 8 && i.groupNames.some((g) => { const gi = M.items.get(g); return gi && (istGeraetGruppe(gi) || inGeraet(gi, tiefe + 1)); });
  const ortVonItem = (i, tiefe = 0) => {
    if (tiefe > 8) return null;
    for (const g of i.groupNames) { if (istOrt(M.items.get(g))) return g; }
    for (const g of i.groupNames) { const gi = M.items.get(g); const o = gi && ortVonItem(gi, tiefe + 1); if (o) return o; }
    return null;
  };
  for (const i of liste) {
    if (i.type === 'Group' || !EINZEL_TYPEN.test(i.type) || INTERN.test(i.name) || inGeraet(i)) continue;
    M.geraete.set(i.name, geraet(i, ortVonItem(i), [{ ...i, quelle: null }]));
  }
  // Namen und Räume: Vorgaben für kryptische Namen, Geräte ohne Raum nach Draußen bzw. Haustechnik, dann die eigenen Einstellungen
  const eigene = (S.namen && S.namen.geraete) || {};
  for (const g of M.geraete.values()) {
    g.openhabLabel = g.label; g.openhabRaum = g.raum;
    for (const [re, neu] of GERAETE_NAMEN) if (re.test(g.label) && (!/^Raumthermostat/.test(neu) || g.klasse === 'raumthermostat')) { g.label = g.label.replace(re, neu); break; }
    if (!g.raum) g.raum = /au(ss|ß)en|outdoor|wetter|garten|balkon/i.test(g.name + ' ' + g.openhabLabel) ? 'zh:draussen' : 'zh:technik';
    const e = eigene[g.name];
    if (e) { if (e.label) g.label = e.label; if (e.raum && (e.raum.startsWith('zh:') || orte.some((o) => o.name === e.raum))) g.raum = e.raum; g.versteckt = !!e.versteckt; }
  }
  const reihenfolge = ['wohnzimmer', 'kueche', 'arbeitszimmer', 'buero', 'schlafzimmer', 'kinderzimmer', 'bad', 'diele', 'flur', 'balkon', 'garten'];
  const rang = (o) => { const x = reihenfolge.indexOf(ohneUmlaut(o.label || o.name)); return x < 0 ? 99 : x; };
  M.raeume = orte.filter((o) => !o.groupNames.some((g) => istOrt(M.items.get(g))) || (M.kinder.get(o.name) || []).some((k) => M.geraete.has(k)))
    .sort((a, b) => rang(a) - rang(b) || (a.label || a.name).localeCompare(b.label || b.name, 'de'))
    .map((o) => ({ name: o.name, label: schoen(o.label, o.name), geraete: [...M.geraete.values()].filter((g) => g.raum === o.name && !g.versteckt) }));
  for (const x of EXTRA_RAEUME) {
    const geraete = [...M.geraete.values()].filter((g) => g.raum === x.name && !g.versteckt);
    if (geraete.length) M.raeume.push({ ...x, geraete, extra: true });
  }
  M.ohneRaum = [];
  M.versteckt = [...M.geraete.values()].filter((g) => g.versteckt);
  M.alleRaeume = [...orte.map((o) => ({ name: o.name, label: schoen(o.label, o.name) })), ...EXTRA_RAEUME];
  M.raumName = (n) => { const r = M.alleRaeume.find((x) => x.name === n); return r ? r.label : ''; };
}

/** alle Werte unterhalb einer Gruppe */
function punkte(name, tiefe = 0) {
  const r = [];
  for (const k of M.kinder.get(name) || []) {
    const i = M.items.get(k); if (!i) continue;
    if (i.type === 'Group' && tiefe < 3) r.push(...punkte(k, tiefe + 1).map((p) => ({ ...p, quelle: p.quelle || k })));
    else if (i.type !== 'Group') r.push({ name: k, quelle: null });
  }
  return r;
}

const hat = (i, ...t) => t.every((x) => i.tags.includes(x));
const NEBEN = /LED aus|Timer|Firmware|Taste|Eingang|Externes|Tastensperre|Batterie|Alarm|Alert/i;

const EINZEL_TYPEN = /^(Switch|Dimmer|Color|Rollershutter|Contact|Number)/;

function geraet(g, raum, einzeln) {
  const alle = einzeln || punkte(g.name).map((p) => ({ ...M.items.get(p.name), quelle: p.quelle }));
  const finde = (f, bevorzugt) => { const x = alle.filter(f); return (bevorzugt && x.find(bevorzugt)) || x[0]; };
  const wand = (i) => /^WT|Wand/i.test(i.quelle || i.name);
  const p = {
    schalter: finde((i) => i.type === 'Switch' && ((hat(i, 'Switch') && (hat(i, 'Power') || hat(i, 'Light'))) || !!einzeln) && !NEBEN.test(i.label)),
    schalterAlle: alle.filter((i) => i.type === 'Switch' && hat(i, 'Switch') && (hat(i, 'Power') || hat(i, 'Light')) && !NEBEN.test(i.label)),
    dimmer: finde((i) => i.type === 'Dimmer'),
    farbe: finde((i) => i.type === 'Color'),
    ct: finde((i) => i.tags.includes('ColorTemperature') || /farbtemperatur/i.test(i.label)),
    effekt: finde((i) => i.type === 'String' && /effekt|effect/i.test(i.label)),
    leistung: finde((i) => i.type.startsWith('Number') && ((hat(i, 'Power') && hat(i, 'Measurement')) || i.type === 'Number:Power' || /aktueller verbrauch|leistung/i.test(i.label)) && !/schnitt|minute|average/i.test(i.label)),
    energie: finde((i) => (i.type === 'Number:Energy' || /zählerstand|zaehlerstand/i.test(i.label)) && !/minute|average/i.test(i.label), (i) => /gesamt|total|zähler/i.test(i.label)),
    temp: finde((i) => i.type.startsWith('Number') && hat(i, 'Temperature') && hat(i, 'Measurement') && !/innentemperatur/i.test(i.label), wand),
    feuchte: finde((i) => hat(i, 'Humidity')),
    soll: finde((i) => hat(i, 'Setpoint'), wand),
    modus: finde((i) => i.type === 'String' && /modus$|mode$/i.test(i.name) && /^(WT|HT)|thermo/i.test(i.quelle || i.name), wand),
    ventil: finde((i) => /ventil|valve/i.test(i.label)),
    fenster: finde((i) => i.type === 'Contact' && /fenster|tür|window|door/i.test(i.label)),
    batterie: alle.filter((i) => hat(i, 'LowBattery')),
  };
  // Geräte, deren Leistung/Temperatur nur Nebenwerte sind (Innentemperatur einer Steckdose) bleiben trotzdem Steckdosen
  let klasse = 'sonst';
  const label = schoen(g.label, g.name);
  if (g.tags.includes('RadiatorControl') || g.tags.includes('Thermostat') || p.soll) klasse = 'heizung';
  else if (g.tags.includes('LightSource') || g.tags.includes('Lightbulb') || alle.some((i) => hat(i, 'Light')) || /lampe|licht|leuchte|\bled\b|kugel/i.test(label) || ((p.dimmer || p.farbe || p.ct) && !p.leistung)) klasse = 'licht';
  else if (/th?ermostat/i.test(g.name + ' ' + label) && !p.soll) klasse = 'raumthermostat';   // andere Raumthermostate (z. B. Zigbee), nur Messwerte
  else if (g.tags.includes('TemperatureSensor') || (!p.schalter && (p.temp || p.feuchte))) klasse = 'sensor';
  else if (g.tags.includes('PowerOutlet') || p.schalter) klasse = 'steckdose';
  else if (p.leistung || p.energie) klasse = 'zaehler';
  return { name: g.name, label, raum, klasse, p, alle: alle.map((i) => i.name), teilVon: Object.fromEntries(alle.map((i) => [i.name, i.quelle || null])) };
}

// ------------------------------------------------------------------ Zustände
export function lichtAn(g) {
  const p = g.p;
  if (p.schalter) return st(p.schalter.name) === 'ON';
  if (p.dimmer) return zahl(st(p.dimmer.name)) > 0;
  if (p.farbe) return zahl(String(st(p.farbe.name)).split(',')[2]) > 0;
  return false;
}
export function helligkeit(g) {
  if (g.p.dimmer) return zahl(st(g.p.dimmer.name));
  if (g.p.farbe) return zahl(String(st(g.p.farbe.name)).split(',')[2]);
  return NaN;
}
/** Bestandteile einer MAX!-Raumheizung, z. B. „Wandthermostat · 2 Heizkörperthermostate · Fensterkontakt“ */
export function maxTeile(g) {
  const q = new Set(Object.values(g.teilVon || {}).filter(Boolean));
  const n = (re) => [...q].filter((x) => re.test(x)).length;
  const wt = n(/^WT[_ ]/i), ht = n(/^HT[_ ]/i), fk = n(/^FK[_ ]/i);
  return [wt ? (wt > 1 ? wt + ' Wandthermostate' : 'Wandthermostat') : null, ht ? (ht > 1 ? ht + ' Heizkörperthermostate' : 'Heizkörperthermostat') : null, fk ? (fk > 1 ? fk + ' Fensterkontakte' : 'Fensterkontakt') : null].filter(Boolean).join(' · ');
}
/** andere Raumthermostate (nicht MAX!) im selben Raum */
export const raumthermostate = (raum) => [...M.geraete.values()].filter((x) => x.klasse === 'raumthermostat' && x.raum === raum && !x.versteckt);
export const lichter = () => [...M.geraete.values()].filter((g) => g.klasse === 'licht' && !g.versteckt && (g.p.schalter || g.p.dimmer || g.p.farbe));
export const geschaltet = (g) => g.p.schalter ? st(g.p.schalter.name) === 'ON' : false;
export function aussenTemp() {
  const g = [...M.geraete.values()].find((x) => /aussen|außen|outdoor/i.test(x.name + ' ' + x.label) && x.p.temp);
  return g ? zahl(st(g.p.temp.name)) : NaN;
}
export function raumTemp(raumName) {
  const r = M.raeume.find((x) => x.name === raumName); if (!r) return NaN;
  const h = r.geraete.find((g) => g.klasse === 'heizung' && g.p.temp) || r.geraete.find((g) => (g.klasse === 'raumthermostat' || g.klasse === 'sensor') && g.p.temp);
  return h ? zahl(st(h.p.temp.name)) : NaN;
}
export const verfuegbar = (name) => !leer(M.items.get(name) && M.items.get(name).state);

/** gemeinsamer App-Zustand */
export const S = { ich: null, lampen: {}, heizung: null, ansicht: 'pc', status: null };

/** Cube-Raum-ID des Heizplans zu einem openHAB-Raum (über den Namen) */
export function planRaum(raumName) {
  if (!S.heizung || !raumName) return null;
  const l = ohneUmlaut(M.raumName(raumName) || raumName);
  const r = S.heizung.raeume.find((x) => ohneUmlaut(x.name) === l) || S.heizung.raeume.find((x) => l.includes(ohneUmlaut(x.name)) || ohneUmlaut(x.name).includes(l));
  return r ? r.id : null;
}
