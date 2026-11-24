'use strict';
/* Benutzer (Admin / Benutzer), Anmeldungen und persönliche Einstellungen (Darstellung, Startseiten) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITZUNG_TAGE = 90;
const STANDARD_DARSTELLUNG = { schema: 'hell', akzent: '#ea580c', nachtDunkel: false, schrift: 'normal' };
// Vorlage für neue Startseiten – aufgebaut wie die Übersichtsseite in openHAB (Klima, Heizung, Licht, Geräte, Energie)
const t = (id, text) => ({ id, art: 'titel', text, groesse: 's' });
const g = (id, ref, groesse = 's', art = 'geraet') => ({ id, art, ref, groesse });
const VORLAGE = (x) => [
  t(x + 't1', 'Klima'),
  g(x + 'k1', 'Aussentemperatur_LUMI'), g(x + 'k2', 'Thermostat_Schlafzimmer'), g(x + 'k3', 'Termostat_Office__TZE284_wtikaxzs'),
  t(x + 't2', 'Heizung'),
  { id: x + 'h0', art: 'haus', groesse: 'm' }, { id: x + 'h9', art: 'heuteAnders', groesse: 'm' },
  g(x + 'h1', 'Heizung_Wohnzimmer', 's', 'heizung'), g(x + 'h2', 'Heizung_Kueche', 's', 'heizung'), g(x + 'h3', 'Heizung_Arbeitszimmer', 's', 'heizung'),
  g(x + 'h4', 'Heizung_Schlafzimmer', 's', 'heizung'), g(x + 'h5', 'Heizung_Bad', 's', 'heizung'),
  t(x + 't3', 'Licht'),
  { id: x + 'l0', art: 'alleLichter', groesse: 'm' },
  ...['Spiegelei_Paulmann_Licht_GmbH', 'Schreibtischlampe_shellyplugs5adcfc192168179218', 'Stehlampe_shelly18caab55fc066192168179203', 'LED_Wohnzimmer_eWeLight',
    'LED_Schlafzimmer_192168179219', 'Nachttischlampe', 'London_shellyplugs5b0ccb__192168179212', 'Tute', 'Igel_Paulmann_Licht_GmbH', 'Balkon_Kugel__TZ3000_q50zhdsc'].map((r, i) => g(x + 'l' + (i + 1), r)),
  t(x + 't4', 'Geräte'),
  ...['Kaffeemaschine__TZ3000_2putqrmw', 'PC_shellyunie8db84d6593f__192168179205', 'Drucker', '_3D_Drucker_Shelly_PlugS', 'Kameras'].map((r, i) => g(x + 'g' + (i + 1), r)),
  t(x + 't5', 'Energie'),
  g(x + 'e1', 'BitShake_Stromzahler', 'm'),
];
const STANDARD_START = { pc: VORLAGE('p'), handy: VORLAGE('h') };
const ARTEN = ['geraet', 'heizung', 'punkt', 'raum', 'alleLichter', 'haus', 'heuteAnders', 'titel'];

const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');

class Benutzer {
  constructor(datenDir, log = console.log) {
    this.dir = datenDir; this.log = log;
    fs.mkdirSync(path.join(datenDir, 'einstellungen'), { recursive: true });
    this.liste = this._lies('benutzer.json') || [];
    this.sitzungen = this._lies('sitzungen.json') || {};
  }
  _lies(n) { try { return JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8')); } catch (e) { return null; } }
  _schreib(n, o) { const p = path.join(this.dir, n); fs.writeFileSync(p + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(p + '.tmp', p); }

  /** ersten Admin aus den Umgebungsvariablen anlegen */
  einrichten(name, passwort) {
    if (this.liste.length) return;
    if (!passwort || passwort.length < 8) throw new Error('ADMIN_PASSWORT fehlt oder ist kürzer als 8 Zeichen');
    this.anlegen({ name, passwort, rolle: 'admin' });
    this.log('Admin „' + name + '“ angelegt');
  }

  oeffentlich(b) { return { id: b.id, name: b.name, rolle: b.rolle, zuletzt: b.zuletzt || null }; }
  alle() { return this.liste.map((b) => this.oeffentlich(b)); }
  finde(id) { return this.liste.find((b) => b.id === id); }

  anlegen({ name, passwort, rolle }) {
    name = String(name || '').trim();
    if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(name)) throw new Error('Name: 2–30 Zeichen, Buchstaben, Ziffern, Leerzeichen');
    if (this.liste.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new Error('Diesen Namen gibt es schon');
    if (!passwort || String(passwort).length < 8) throw new Error('Passwort: mindestens 8 Zeichen');
    if (!['admin', 'benutzer'].includes(rolle)) throw new Error('Rolle: admin oder benutzer');
    const salt = crypto.randomBytes(16).toString('hex');
    const b = { id: crypto.randomBytes(6).toString('hex'), name, rolle, salt, hash: hash(passwort, salt) };
    this.liste.push(b); this._schreib('benutzer.json', this.liste);
    return this.oeffentlich(b);
  }

  aendern(id, { passwort, rolle, name }) {
    const b = this.finde(id); if (!b) throw new Error('Unbekannter Benutzer');
    if (rolle !== undefined) {
      if (!['admin', 'benutzer'].includes(rolle)) throw new Error('Rolle: admin oder benutzer');
      if (b.rolle === 'admin' && rolle !== 'admin' && this.liste.filter((x) => x.rolle === 'admin').length === 1) throw new Error('Mindestens ein Admin muss bleiben');
      b.rolle = rolle;
    }
    if (name !== undefined && name !== b.name) {
      name = String(name).trim();
      if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(name)) throw new Error('Name: 2–30 Zeichen');
      if (this.liste.some((x) => x !== b && x.name.toLowerCase() === name.toLowerCase())) throw new Error('Diesen Namen gibt es schon');
      b.name = name;
    }
    if (passwort !== undefined && passwort !== '') {
      if (String(passwort).length < 8) throw new Error('Passwort: mindestens 8 Zeichen');
      b.salt = crypto.randomBytes(16).toString('hex'); b.hash = hash(passwort, b.salt);
      for (const [k, s] of Object.entries(this.sitzungen)) if (s.benutzer === id) delete this.sitzungen[k];
      this._schreib('sitzungen.json', this.sitzungen);
    }
    this._schreib('benutzer.json', this.liste);
    return this.oeffentlich(b);
  }

  loeschen(id) {
    const b = this.finde(id); if (!b) throw new Error('Unbekannter Benutzer');
    if (b.rolle === 'admin' && this.liste.filter((x) => x.rolle === 'admin').length === 1) throw new Error('Der letzte Admin kann nicht gelöscht werden');
    this.liste = this.liste.filter((x) => x !== b); this._schreib('benutzer.json', this.liste);
    for (const [k, s] of Object.entries(this.sitzungen)) if (s.benutzer === id) delete this.sitzungen[k];
    this._schreib('sitzungen.json', this.sitzungen);
    try { fs.unlinkSync(path.join(this.dir, 'einstellungen', id + '.json')); } catch (e) { /* keine */ }
  }

  /** Anmeldung → Sitzungs-ID oder null */
  anmelden(name, passwort) {
    const b = this.liste.find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
    const h = hash(passwort || '', b ? b.salt : 'x');
    if (!b || !crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(b.hash, 'hex'))) return null;
    const id = crypto.randomBytes(32).toString('hex');
    this.sitzungen[id] = { benutzer: b.id, bis: Date.now() + SITZUNG_TAGE * 86400e3 };
    for (const [k, s] of Object.entries(this.sitzungen)) if (s.bis < Date.now()) delete this.sitzungen[k];
    b.zuletzt = Date.now();
    this._schreib('sitzungen.json', this.sitzungen); this._schreib('benutzer.json', this.liste);
    return id;
  }
  abmelden(sid) { delete this.sitzungen[sid]; this._schreib('sitzungen.json', this.sitzungen); }

  /** Sitzung prüfen (und verlängern) → Benutzer oder null */
  sitzung(sid) {
    const s = sid && this.sitzungen[sid];
    if (!s || s.bis < Date.now()) return null;
    const b = this.finde(s.benutzer); if (!b) return null;
    if (s.bis - Date.now() < (SITZUNG_TAGE - 1) * 86400e3) { s.bis = Date.now() + SITZUNG_TAGE * 86400e3; b.zuletzt = Date.now(); this._schreib('sitzungen.json', this.sitzungen); }
    return b;
  }

  // ------------------------------------------------------------ Einstellungen je Benutzer
  einstellungen(id) {
    const e = this._lies(path.join('einstellungen', id + '.json')) || {};
    return { darstellung: { ...STANDARD_DARSTELLUNG, ...(e.darstellung || {}) }, start: e.start || JSON.parse(JSON.stringify(STANDARD_START)) };
  }
  darstellungSetzen(id, d) {
    const e = this.einstellungen(id);
    if (d.schema !== undefined) { if (!['hell', 'dunkel', 'warm', 'kuehl'].includes(d.schema)) throw new Error('Unbekanntes Farbschema'); e.darstellung.schema = d.schema; }
    if (d.akzent !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(d.akzent)) throw new Error('Akzentfarbe als #rrggbb'); e.darstellung.akzent = d.akzent; }
    if (d.nachtDunkel !== undefined) e.darstellung.nachtDunkel = !!d.nachtDunkel;
    if (d.schrift !== undefined) { if (!['klein', 'normal', 'gross'].includes(d.schrift)) throw new Error('Schriftgröße klein/normal/gross'); e.darstellung.schrift = d.schrift; }
    this._schreib(path.join('einstellungen', id + '.json'), e);
    return e.darstellung;
  }
  /** Startseite auf die Vorlage zurücksetzen */
  startVorlage(id, geraet) {
    if (!['pc', 'handy'].includes(geraet)) throw new Error('pc oder handy');
    const e = this.einstellungen(id); e.start[geraet] = JSON.parse(JSON.stringify(STANDARD_START[geraet]));
    this._schreib(path.join('einstellungen', id + '.json'), e);
    return e.start[geraet];
  }
  startSetzen(id, geraet, elemente) {
    if (!['pc', 'handy'].includes(geraet)) throw new Error('pc oder handy');
    if (!Array.isArray(elemente) || elemente.length > 60) throw new Error('Höchstens 60 Elemente');
    const sauber = elemente.map((x, i) => {
      if (!ARTEN.includes(x.art)) throw new Error('Unbekannte Elementart');
      if (!['s', 'm', 'l'].includes(x.groesse)) throw new Error('Größe s/m/l');
      return { id: String(x.id || 'e' + Date.now() + i).slice(0, 40), art: x.art, ...(x.ref ? { ref: String(x.ref).slice(0, 200) } : {}),
        ...(x.art === 'titel' ? { text: String(x.text || 'Abschnitt').slice(0, 40) } : {}), groesse: x.groesse };
    });
    const e = this.einstellungen(id); e.start[geraet] = sauber;
    this._schreib(path.join('einstellungen', id + '.json'), e);
    return sauber;
  }
}

module.exports = { Benutzer, STANDARD_START };
