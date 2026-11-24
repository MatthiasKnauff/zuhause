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
  const reihenfolge = ['wohnzimmer', 'kueche', 'arbeitszimmer', 'buero', 'schlafzimmer', 'kinderzimmer', 'bad', 'diele', 'flur', 'balkon', 'garten'];
  const rang = (o) => { const x = reihenfolge.indexOf(ohneUmlaut(o.label || o.name)); return x < 0 ? 99 : x; };
  M.raeume = orte.filter((o) => !o.groupNames.some((g) => istOrt(M.items.get(g))) || (M.kinder.get(o.name) || []).some((k) => M.geraete.has(k)))
    .sort((a, b) => rang(a) - rang(b) || (a.label || a.name).localeCompare(b.label || b.name, 'de'))
    .map((o) => ({ name: o.name, label: schoen(o.label, o.name), geraete: [...M.geraete.values()].filter((g) => g.raum === o.name) }));
  M.ohneRaum = [...M.geraete.values()].filter((g) => !g.raum);
  M.raumName = (n) => { const r = M.raeume.find((x) => x.name === n); return r ? r.label : ''; };
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

function geraet(g, raum) {
  const alle = punkte(g.name).map((p) => ({ ...M.items.get(p.name), quelle: p.quelle }));
  const finde = (f, bevorzugt) => { const x = alle.filter(f); return (bevorzugt && x.find(bevorzugt)) || x[0]; };
  const wand = (i) => /^WT|Wand/i.test(i.quelle || i.name);
  const p = {
    schalter: finde((i) => i.type === 'Switch' && hat(i, 'Switch') && (hat(i, 'Power') || hat(i, 'Light')) && !NEBEN.test(i.label)),
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
  else if (g.tags.includes('TemperatureSensor') || (!p.schalter && (p.temp || p.feuchte))) klasse = 'sensor';
  else if (g.tags.includes('PowerOutlet') || p.schalter) klasse = 'steckdose';
  else if (p.leistung || p.energie) klasse = 'zaehler';
  return { name: g.name, label, raum, klasse, p, alle: alle.map((i) => i.name) };
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
export const lichter = () => [...M.geraete.values()].filter((g) => g.klasse === 'licht' && (g.p.schalter || g.p.dimmer || g.p.farbe));
export const geschaltet = (g) => g.p.schalter ? st(g.p.schalter.name) === 'ON' : false;
export function aussenTemp() {
  const g = [...M.geraete.values()].find((x) => /aussen|außen|outdoor/i.test(x.name + ' ' + x.label) && x.p.temp);
  return g ? zahl(st(g.p.temp.name)) : NaN;
}
export function raumTemp(raumName) {
  const r = M.raeume.find((x) => x.name === raumName); if (!r) return NaN;
  const h = r.geraete.find((g) => g.klasse === 'heizung' && g.p.temp) || r.geraete.find((g) => g.klasse === 'sensor' && g.p.temp);
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
