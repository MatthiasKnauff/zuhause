'use strict';
/* Gesetzliche Feiertage je Bundesland (Kürzel wie NW, BY …) und Brückentage */

const LAENDER = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tag = (j, m, t) => new Date(j, m - 1, t, 12);
const plus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

/** Ostersonntag (Gauß / anonymer gregorianischer Algorithmus) */
function ostern(j) {
  const a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), t = ((h + l - 7 * m + 114) % 31) + 1;
  return tag(j, monat, t);
}

/** Map ISO-Datum → Name */
function feiertage(jahr, land = 'NW') {
  const o = ostern(jahr);
  const liste = [
    [tag(jahr, 1, 1), 'Neujahr'],
    [plus(o, -2), 'Karfreitag'],
    [plus(o, 1), 'Ostermontag'],
    [tag(jahr, 5, 1), 'Tag der Arbeit'],
    [plus(o, 39), 'Christi Himmelfahrt'],
    [plus(o, 50), 'Pfingstmontag'],
    [tag(jahr, 10, 3), 'Tag der Deutschen Einheit'],
    [tag(jahr, 12, 25), '1. Weihnachtstag'],
    [tag(jahr, 12, 26), '2. Weihnachtstag'],
  ];
  const nur = (laender, d, n) => { if (laender.includes(land)) liste.push([d, n]); };
  nur(['BW', 'BY', 'ST'], tag(jahr, 1, 6), 'Heilige Drei Könige');
  nur(['BE', 'MV'], tag(jahr, 3, 8), 'Frauentag');
  nur(['BB'], o, 'Ostersonntag');
  nur(['BB'], plus(o, 49), 'Pfingstsonntag');
  nur(['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], plus(o, 60), 'Fronleichnam');
  nur(['SL'], tag(jahr, 8, 15), 'Mariä Himmelfahrt');
  nur(['TH'], tag(jahr, 9, 20), 'Weltkindertag');
  nur(['BB', 'MV', 'SN', 'ST', 'TH', 'HB', 'HH', 'NI', 'SH'], tag(jahr, 10, 31), 'Reformationstag');
  nur(['BW', 'BY', 'NW', 'RP', 'SL'], tag(jahr, 11, 1), 'Allerheiligen');
  if (land === 'SN') { const d = tag(jahr, 11, 22); while (d.getDay() !== 3) d.setDate(d.getDate() - 1); liste.push([d, 'Buß- und Bettag']); }
  return new Map(liste.map(([d, n]) => [iso(d), n]));
}

/** Brückentag: Werktag zwischen Feiertag und Wochenende (Freitag nach Donnerstag-Feiertag, Montag vor Dienstag-Feiertag) */
function brueckentage(jahr, land = 'NW') {
  const ft = new Map([...feiertage(jahr - 1, land), ...feiertage(jahr, land), ...feiertage(jahr + 1, land)]);
  const out = new Map();
  for (const [s, name] of ft) {
    const d = new Date(s + 'T12:00:00');
    if (d.getFullYear() !== jahr) continue;
    if (d.getDay() === 4) { const f = plus(d, 1); if (!ft.has(iso(f))) out.set(iso(f), 'Brückentag nach ' + name); }
    if (d.getDay() === 2) { const m = plus(d, -1); if (!ft.has(iso(m))) out.set(iso(m), 'Brückentag vor ' + name); }
  }
  return out;
}

/** Was gilt an einem Datum? → {art: 'feiertag'|'brueckentag', name} oder null */
function besonderer(isoDatum, land, mitBruecken) {
  const j = Number(isoDatum.slice(0, 4));
  const f = feiertage(j, land).get(isoDatum);
  if (f) return { art: 'feiertag', name: f };
  if (mitBruecken) { const b = brueckentage(j, land).get(isoDatum); if (b) return { art: 'brueckentag', name: b }; }
  return null;
}

module.exports = { LAENDER, feiertage, brueckentage, besonderer, iso, ostern };
