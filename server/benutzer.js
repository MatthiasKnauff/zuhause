'use strict';
/* Benutzer (Admin / Benutzer), Anmeldungen und persönliche Einstellungen (Darstellung, Startseiten) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITZUNG_TAGE = 90;
const STANDARD_DARSTELLUNG = { schema: 'hell', akzent: '#ea580c', nachtDunkel: false, schrift: 'normal' };
const STANDARD_START = {
  pc: [
    { id: 's1', art: 'heizung', ref: 'Heizung_Wohnzimmer', groesse: 'm' },
    { id: 's2', art: 'geraet', ref: 'Aussentemperatur_LUMI', groesse: 's' },
    { id: 's3', art: 'geraet', ref: 'BitShake_Stromzahler', groesse: 's' },
    { id: 's4', art: 'alleLichter', groesse: 'm' },
    { id: 's5', art: 'geraet', ref: 'LED_Wohnzimmer_eWeLight', groesse: 's' },
    { id: 's6', art: 'haus', groesse: 's' },
  ],
  handy: [
    { id: 'h1', art: 'alleLichter', groesse: 'm' },
    { id: 'h2', art: 'heizung', ref: 'Heizung_Wohnzimmer', groesse: 'l' },
    { id: 'h3', art: 'geraet', ref: 'Stehlampe_shelly18caab55fc066192168179203', groesse: 's' },
    { id: 'h4', art: 'geraet', ref: 'BitShake_Stromzahler', groesse: 's' },
    { id: 'h5', art: 'haus', groesse: 'm' },
  ],
};
const ARTEN = ['geraet', 'heizung', 'punkt', 'raum', 'alleLichter', 'haus', 'heuteAnders'];

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
  startSetzen(id, geraet, elemente) {
    if (!['pc', 'handy'].includes(geraet)) throw new Error('pc oder handy');
    if (!Array.isArray(elemente) || elemente.length > 60) throw new Error('Höchstens 60 Elemente');
    const sauber = elemente.map((x, i) => {
      if (!ARTEN.includes(x.art)) throw new Error('Unbekannte Elementart');
      if (!['s', 'm', 'l'].includes(x.groesse)) throw new Error('Größe s/m/l');
      return { id: String(x.id || 'e' + Date.now() + i).slice(0, 40), art: x.art, ...(x.ref ? { ref: String(x.ref).slice(0, 200) } : {}), groesse: x.groesse };
    });
    const e = this.einstellungen(id); e.start[geraet] = sauber;
    this._schreib(path.join('einstellungen', id + '.json'), e);
    return sauber;
  }
}

module.exports = { Benutzer, STANDARD_START };
