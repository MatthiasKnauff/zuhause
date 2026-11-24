'use strict';
/*
 * Heizung über openHAB: Vorlagen (z. B. Büro-Tag) mit eigenem Muster je Raum, Wochenzuordnung,
 * Feiertage/Brückentage, „Heute anders“. Daraus entsteht der Wochenplan der nächsten 7 Tage;
 * er geht an das Item Heizplan_Daten – die Heizplan-Regel in openHAB schreibt ihn in die Thermostate.
 */
const fs = require('fs');
const path = require('path');
const F = require('./feiertage');

const TAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
const TAGNAME = { mo: 'Montag', di: 'Dienstag', mi: 'Mittwoch', do: 'Donnerstag', fr: 'Freitag', sa: 'Samstag', so: 'Sonntag' };
const ITEM_PLAN = 'Heizplan_Daten', ITEM_STATUS = 'Heizplan_Status', ITEM_BEFEHL = 'Heizplan_Befehl';
const tagKey = (d) => TAGE[(d.getDay() + 6) % 7];
const zuMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const zuHHMM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const kopie = (o) => JSON.parse(JSON.stringify(o));

function pruefeMuster(p) {
  if (!Array.isArray(p) || !p.length || p.length > 6) throw new Error('Jeder Raum braucht 1 bis 6 Schaltpunkte je Vorlage');
  const zeiten = new Set();
  for (const [z, t] of p) {
    if (!/^\d{2}:\d{2}$/.test(z) || zuMin(z) >= 1440 || zuMin(z) % 5) throw new Error('Ungültige Uhrzeit ' + z);
    if (zeiten.has(z)) throw new Error('Doppelte Uhrzeit ' + z);
    zeiten.add(z);
    const v = Number(t); if (!(v >= 4.5 && v <= 30.5) || Math.round(v * 2) !== v * 2) throw new Error('Temperatur 4,5–30,5 °C in 0,5er-Schritten');
  }
  return p.map(([z, t]) => [z, Number(t)]).sort((a, b) => zuMin(a[0]) - zuMin(b[0]));
}

class Heizung {
  constructor(oh, datenDir, log = console.log) {
    Object.assign(this, { oh, log });
    this.datei = path.join(datenDir, 'heizung.json');
    try { this.d = JSON.parse(fs.readFileSync(this.datei, 'utf8')); } catch (e) { this.d = null; }
    this._tag = null;
    // Testserver: keinen Heizplan von selbst an openHAB geben – sonst würde die Testinstanz mit ihren eigenen
    // Vorlagen nachts den Plan der Produktivinstanz überschreiben. Bedienung von Hand geht weiterhin.
    this.automatisch = process.env.APP_ENV !== 'test';
    oh.on('modell', () => this._bereit());
    oh.on('zustand', (n) => { if (n === ITEM_PLAN && !this.d) this._bereit(); });
    setInterval(() => { const h = F.iso(new Date()); if (this.automatisch && h !== this._tag) { this._tag = h; this.abgleichen().catch((e) => this.log('Heizplan: ' + e.message)); } }, 60000);
  }

  _speichern() { fs.writeFileSync(this.datei + '.tmp', JSON.stringify(this.d, null, 1)); fs.renameSync(this.datei + '.tmp', this.datei); }

  /** aktueller Plan aus openHAB (Räume mit Cube-ID, Namen und Tagesprogrammen) */
  planImItem() {
    const i = this.oh.items.get(ITEM_PLAN);
    if (!i) return null;
    try { const p = JSON.parse(i.state); return p && p.raeume ? p : null; } catch (e) { return null; }
  }

  verfuegbar() { return !!this.oh.items.get(ITEM_PLAN); }

  /** Beim ersten Start: Vorlagen aus dem vorhandenen Plan bilden – gleiche Tage = eine Vorlage, damit sich nichts ändert */
  _bereit() {
    if (this.d) { this._tag = F.iso(new Date()); if (this.automatisch) this.abgleichen().catch((e) => this.log('Heizplan: ' + e.message)); return; }
    const plan = this.planImItem();
    if (!plan) return;
    const gruppen = new Map();
    for (const t of TAGE) {
      const sig = JSON.stringify(Object.entries(plan.raeume).map(([id, r]) => [id, r.tage[t]]));
      if (!gruppen.has(sig)) gruppen.set(sig, []);
      gruppen.get(sig).push(t);
    }
    const vorlagen = []; const woche = {};
    let n = 0;
    for (const tage of gruppen.values()) {
      const id = 'v' + (++n);
      const name = tage.length === 1 ? TAGNAME[tage[0]] : TAGNAME[tage[0]].slice(0, 2) + '–' + TAGNAME[tage[tage.length - 1]].slice(0, 2);
      vorlagen.push({ id, name: tage.includes('sa') || tage.includes('so') ? 'Wochenende' : (n === 1 ? 'Büro-Tag' : name), muster: Object.fromEntries(Object.entries(plan.raeume).map(([rid, r]) => [rid, r.tage[tage[0]]])) });
      for (const t of tage) woche[t] = id;
    }
    vorlagen.push({ id: 'abwesend', name: 'Abwesend', muster: Object.fromEntries(Object.keys(plan.raeume).map((rid) => [rid, [['00:00', 12]]])) });
    this.d = { vorlagen, woche, ausnahmen: {}, land: 'NW', bruecken: true, feiertagVorlage: woche.so, eco: 17, komfort: 21 };
    this._speichern();
    this.log('Heizplan: ' + vorlagen.length + ' Vorlagen aus dem vorhandenen Plan gebildet');
    this._tag = F.iso(new Date());
  }

  vorlage(id) { return this.d.vorlagen.find((v) => v.id === id); }

  /** Wochenplan der nächsten 7 Tage (ab heute) mit Begründung je Tag */
  effektiv(ab = new Date()) {
    const plan = this.planImItem();
    const tage = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(ab.getFullYear(), ab.getMonth(), ab.getDate() + i, 12);
      const datum = F.iso(d); const key = tagKey(d);
      const aus = this.d.ausnahmen[datum];
      const bes = F.besonderer(datum, this.d.land, this.d.bruecken);
      let vid = this.d.woche[key], grund = null;
      if (bes) { vid = this.d.feiertagVorlage || this.d.woche.so; grund = bes.name; }
      if (aus) { vid = aus.vorlage; grund = aus.verlaengern ? 'heute länger bis ' + aus.verlaengern : 'heute anders'; }
      tage.push({ datum, key, vorlage: vid, grund, verlaengern: aus ? aus.verlaengern || null : null, heute: i === 0 });
    }
    const raeume = {};
    if (plan) {
      for (const [rid, r] of Object.entries(plan.raeume)) {
        raeume[rid] = { name: r.name, tage: {} };
        for (const t of tage) {
          const v = this.vorlage(t.vorlage);
          let p = kopie((v && v.muster[rid]) || r.tage[t.key]);
          if (t.verlaengern) p = verlaengere(p, t.verlaengern);
          raeume[rid].tage[t.key] = p;
        }
      }
    }
    return { tage, plan: { version: 1, raeume } };
  }

  /** wirksamen Plan an openHAB geben, wenn er sich vom aktuellen unterscheidet */
  async abgleichen() {
    if (!this.d) return false;
    const heute = F.iso(new Date());
    for (const k of Object.keys(this.d.ausnahmen)) if (k < heute) delete this.d.ausnahmen[k];
    const { plan } = this.effektiv();
    const ist = this.planImItem();
    if (!ist || !Object.keys(plan.raeume).length) return false;
    const gleich = Object.entries(plan.raeume).every(([id, r]) => ist.raeume[id] && JSON.stringify(ist.raeume[id].tage) === JSON.stringify(r.tage));
    if (gleich) return false;
    await this.oh.befehl(ITEM_PLAN, JSON.stringify(plan));
    this.log('Heizplan an openHAB übergeben');
    return true;
  }

  ansicht() {
    const plan = this.planImItem();
    let status = null; try { status = JSON.parse(this.oh.items.get(ITEM_STATUS).state); } catch (e) { /* noch keiner */ }
    const heute = new Date();
    const kommend = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + i, 12);
      const b = F.besonderer(F.iso(d), this.d ? this.d.land : 'NW', this.d ? this.d.bruecken : true);
      if (b) kommend.push({ datum: F.iso(d), key: tagKey(d), ...b });
    }
    return {
      verfuegbar: this.verfuegbar() && !!this.d,
      daten: this.d,
      raeume: plan ? Object.entries(plan.raeume).map(([id, r]) => ({ id, name: r.name })) : [],
      effektiv: this.d ? this.effektiv().tage : [],
      status, kommend, laender: F.LAENDER,
    };
  }

  // ------------------------------------------------------------ Änderungen
  _pruefe() { if (!this.d) throw new Error('Heizplan noch nicht verfügbar – läuft die Heizplan-Regel in openHAB?'); }

  async vorlagenSetzen(liste) {
    this._pruefe();
    if (!Array.isArray(liste) || !liste.length) throw new Error('Mindestens eine Vorlage');
    const ids = new Set();
    const neu = liste.map((v) => {
      const id = String(v.id || ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)));
      if (ids.has(id)) throw new Error('Doppelte Vorlage');
      ids.add(id);
      const name = String(v.name || '').trim().slice(0, 40);
      if (!name) throw new Error('Jede Vorlage braucht einen Namen');
      const muster = {};
      for (const [rid, p] of Object.entries(v.muster || {})) muster[rid] = pruefeMuster(p);
      return { id, name, muster };
    });
    for (const t of TAGE) if (!ids.has(this.d.woche[t])) throw new Error(`Die Vorlage für ${TAGNAME[t]} kann nicht gelöscht werden – erst einen anderen Tag zuweisen`);
    this.d.vorlagen = neu; this._speichern();
    await this.abgleichen();
  }

  async wocheSetzen(woche) {
    this._pruefe();
    for (const t of TAGE) if (!this.vorlage(woche[t])) throw new Error('Unbekannte Vorlage für ' + TAGNAME[t]);
    this.d.woche = Object.fromEntries(TAGE.map((t) => [t, woche[t]]));
    this._speichern(); await this.abgleichen();
  }

  async heuteAnders(vorlage, verlaengern) {
    this._pruefe();
    const heute = F.iso(new Date());
    if (!vorlage) delete this.d.ausnahmen[heute];
    else {
      if (!this.vorlage(vorlage)) throw new Error('Unbekannte Vorlage');
      if (verlaengern && !/^\d{2}:\d{2}$/.test(verlaengern)) throw new Error('Ungültige Uhrzeit');
      this.d.ausnahmen[heute] = { vorlage, ...(verlaengern ? { verlaengern } : {}) };
    }
    this._speichern(); await this.abgleichen();
  }

  async einstellungen(e) {
    this._pruefe();
    if (e.land !== undefined) { if (!F.LAENDER[e.land]) throw new Error('Unbekanntes Bundesland'); this.d.land = e.land; }
    if (e.bruecken !== undefined) this.d.bruecken = !!e.bruecken;
    if (e.feiertagVorlage !== undefined) { if (!this.vorlage(e.feiertagVorlage)) throw new Error('Unbekannte Vorlage'); this.d.feiertagVorlage = e.feiertagVorlage; }
    for (const k of ['eco', 'komfort']) if (e[k] !== undefined) { const v = Number(e[k]); if (!(v >= 4.5 && v <= 30.5)) throw new Error('Temperatur 4,5–30,5 °C'); this.d[k] = v; }
    this._speichern(); await this.abgleichen();
  }

  /** Urlaub mit Enddatum – schreibt die Heizplan-Regel direkt in die Thermostate */
  async urlaub(raeume, temp, bis) {
    this._pruefe();
    const t = Number(temp);
    if (!(t >= 4.5 && t <= 30.5)) throw new Error('Temperatur 4,5–30,5 °C');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(bis) || !(new Date(bis) > new Date())) throw new Error('Das Ende muss in der Zukunft liegen');
    const ids = (raeume || []).map(String).filter((id) => this.planImItem().raeume[id]);
    if (!ids.length) throw new Error('Keine Räume gewählt');
    await this.oh.befehl(ITEM_BEFEHL, ['urlaub', bis, t, ids.join(',')].join('|'));
  }
  async urlaubEnde(raeume) {
    this._pruefe();
    const ids = (raeume || []).map(String);
    await this.oh.befehl(ITEM_BEFEHL, ['urlaub-ende', ids.join(',')].join('|'));
  }
  async senden() { await this.oh.befehl(ITEM_BEFEHL, 'senden'); }

  /** Je Raum das führende Thermostat (Wandthermostat bevorzugt): {soll, modus} Item-Namen */
  thermostate() {
    const items = this.oh.items;
    const ort = (name, tiefe = 0) => {
      const i = items.get(name); if (!i || tiefe > 6) return null;
      for (const g of i.groupNames) { const gi = items.get(g); if (gi && (gi.tags.includes('Location') || String(gi.sem || '').startsWith('Location'))) return g; }
      for (const g of i.groupNames) { const o = ort(g, tiefe + 1); if (o) return o; }
      return null;
    };
    const jeOrt = new Map();
    for (const i of items.values()) {
      if (!i.tags.includes('Setpoint') || !i.type.startsWith('Number')) continue;
      const geraet = i.groupNames[0];
      const modus = [...items.values()].find((x) => x.groupNames.includes(geraet) && x.type === 'String' && (/Modus$|Mode$/i.test(x.name) || x.tags.includes('Mode')));
      const o = ort(i.name) || geraet;
      const wand = /^WT|Wand/i.test(geraet);
      const bisher = jeOrt.get(o);
      if (!bisher || (wand && !bisher.wand)) jeOrt.set(o, { ort: o, soll: i.name, modus: modus ? modus.name : null, wand });
    }
    return [...jeOrt.values()];
  }

  /** Ganzes Haus: eco / komfort (dauerhaft, manuell) oder auto (zurück zum Wochenplan) */
  async hausModus(modus) {
    if (!['eco', 'komfort', 'auto'].includes(modus)) throw new Error('Unbekannter Modus');
    const eco = this.d ? this.d.eco : 17, komfort = this.d ? this.d.komfort : 21;
    for (const t of this.thermostate()) {
      if (modus === 'auto') { if (t.modus) await this.oh.befehl(t.modus, 'AUTOMATIC'); continue; }
      if (t.modus) await this.oh.befehl(t.modus, 'MANUAL');
      await this.oh.befehl(t.soll, String(modus === 'eco' ? eco : komfort));
    }
  }
}

/** letzte Absenkung des Tages (Schaltpunkt mit niedrigerer Temperatur als davor) auf die gewünschte Uhrzeit schieben */
function verlaengere(punkte, bis) {
  const z = zuMin(bis);
  const p = [...punkte].sort((a, b) => zuMin(a[0]) - zuMin(b[0]));
  let k = -1;
  for (let i = 1; i < p.length; i++) if (p[i][1] < p[i - 1][1]) k = i;
  if (k < 0 || zuMin(p[k][0]) >= z) return punkte;
  if (p.slice(k + 1).some(([t]) => zuMin(t) <= z)) return punkte;   // dazwischen liegt noch ein Schaltpunkt
  p[k] = [zuHHMM(z), p[k][1]];
  return p;
}

module.exports = { Heizung, TAGE, verlaengere, pruefeMuster };
