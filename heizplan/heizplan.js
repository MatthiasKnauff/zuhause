/*
 * Heizplan für MAX! – schreibt Wochenprogramme über den MAX! Cube direkt in die Thermostate.
 * Ablage: <openHAB>/conf/automation/js/heizplan.js   (benötigt das Add-on „JavaScript Scripting“)
 *
 * Ablauf eines Abgleichs:
 *   1. MAX!-Cube-Bridge in openHAB kurz deaktivieren (der Cube erlaubt nur eine Verbindung).
 *   2. Selbst mit dem Cube verbinden; er schickt dabei die Konfiguration aller Geräte (C:-Zeilen)
 *      samt aktuell gespeichertem Wochenprogramm.
 *   3. Plan (Item Heizplan_Daten) mit dem Programm jedes Geräts vergleichen; nur abweichende Tage senden.
 *   4. Bridge wieder aktivieren. Was wegen des Funk-Limits nicht mehr ging, folgt beim nächsten Lauf (alle 15 min).
 */

// ===================================================================================
// Kodierung (reine Funktionen, ohne openHAB – werden auch im Test benutzt)
// ===================================================================================
const Codec = (() => {
  const TAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
  // Tagesnummer im MAX!-Protokoll: 0 = Samstag … 6 = Freitag
  const MAX_TAG = { sa: 0, so: 1, mo: 2, di: 3, mi: 4, do: 5, fr: 6 };
  const SLOTS_PRO_TAG = 13;
  const SLOTS_PRO_NACHRICHT = 7;
  const MAX_PUNKTE = 6; // 6 Schaltpunkte ergeben höchstens 7 Slots = genau eine Funknachricht

  const zuMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m) throw new Error('Ungültige Uhrzeit: ' + hhmm);
    const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (v < 0 || v >= 1440 || v % 5 !== 0) throw new Error('Uhrzeit muss zwischen 00:00 und 23:55 im 5-Minuten-Raster liegen: ' + hhmm);
    return v;
  };
  const zuHHMM = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

  const pruefeTemp = (t) => {
    const v = Number(t);
    if (!(v >= 4.5 && v <= 30.5) || Math.round(v * 2) !== v * 2) throw new Error('Temperatur muss 4,5–30,5 °C in 0,5er-Schritten sein: ' + t);
    return v;
  };

  /** Benachbarte Slots mit gleicher Temperatur zusammenfassen. Slot = {temp, bis(Minuten)} */
  const normalisiere = (slots) => {
    const out = [];
    for (const s of slots) {
      if (out.length && out[out.length - 1].temp === s.temp) out[out.length - 1].bis = s.bis;
      else out.push({ temp: s.temp, bis: s.bis });
    }
    return out;
  };

  /**
   * Schaltpunkte [["06:00",21],["22:00",17]] → Slots.
   * Vor dem ersten Schaltpunkt gilt die Temperatur des letzten (über Mitternacht).
   */
  const punkteZuSlots = (punkte) => {
    if (!Array.isArray(punkte) || punkte.length === 0) throw new Error('Jeder Tag braucht mindestens einen Schaltpunkt');
    const p = punkte.map(([z, t]) => ({ min: zuMin(z), temp: pruefeTemp(t) })).sort((a, b) => a.min - b.min);
    for (let i = 1; i < p.length; i++) if (p[i].min === p[i - 1].min) throw new Error('Doppelte Uhrzeit: ' + zuHHMM(p[i].min));
    const slots = [];
    if (p[0].min > 0) slots.push({ temp: p[p.length - 1].temp, bis: p[0].min });
    p.forEach((x, i) => slots.push({ temp: x.temp, bis: i + 1 < p.length ? p[i + 1].min : 1440 }));
    return normalisiere(slots);
  };

  /** Slots → Schaltpunkte (Umkehrung von punkteZuSlots) */
  const slotsZuPunkte = (slots) => {
    const n = normalisiere(slots);
    let start = 0;
    const punkte = n.map((s) => { const p = [zuHHMM(start), s.temp]; start = s.bis; return p; });
    // 00:00-Punkt weglassen, wenn er nur die Temperatur des Vortagesendes fortsetzt
    if (punkte.length > 1 && punkte[0][1] === punkte[punkte.length - 1][1]) punkte.shift();
    return punkte;
  };

  const slotsGleich = (a, b) => {
    const x = normalisiere(a), y = normalisiere(b);
    return x.length === y.length && x.every((s, i) => s.temp === y[i].temp && s.bis === y[i].bis);
  };

  const hex2 = (n) => (n & 0xff).toString(16).padStart(2, '0');

  /** Slots → Bytes: 16 Bit je Slot = (Temp·2) << 9 | (Ende in 5-min-Schritten) */
  const slotBytes = (slots) => {
    const b = [];
    for (const s of slots) {
      const w = (Math.round(s.temp * 2) << 9) | (s.bis / 5);
      b.push((w >> 8) & 0xff, w & 0xff);
    }
    return b;
  };

  /** Hex-Inhalt des Cube-Befehls „s:“ (ConfigWeekProfile = 0x10) für einen Tag eines Geräts */
  const wochenprofilHex = (rfAddress, roomId, tag, slots) => {
    if (!/^[0-9a-fA-F]{6}$/.test(rfAddress)) throw new Error('Ungültige RF-Adresse: ' + rfAddress);
    if (!(tag in MAX_TAG)) throw new Error('Unbekannter Tag: ' + tag);
    if (slots.length > SLOTS_PRO_NACHRICHT) throw new Error('Zu viele Schaltpunkte an einem Tag');
    return '00' + '00' + '10' + '000000' + rfAddress.toLowerCase() + hex2(roomId) + hex2(MAX_TAG[tag]) +
      slotBytes(slots).map(hex2).join('');
  };

  /** Bytes eines C:-Datensatzes → {typ, roomId, programm:{mo:[slots],…}} oder null */
  const leseC = (bytes) => {
    const u = Array.from(bytes, (x) => x & 0xff);
    const typ = u[4];
    if (typ !== 1 && typ !== 2 && typ !== 3) return null; // nur Heizkörper-, Heizkörper+- und Wandthermostat
    const start = 18 + (bytes.length < 211 ? 4 : 11); // wie im openHAB-MAX!-Binding (CMessage)
    if (u.length < start + 26 * 7) return null;
    const programm = {};
    for (const [tag, nr] of Object.entries(MAX_TAG)) {
      const slots = [];
      for (let i = 0; i < SLOTS_PRO_TAG; i++) {
        const o = start + nr * 26 + i * 2;
        const w = (u[o] << 8) | u[o + 1];
        const s = { temp: (w >> 9) / 2, bis: (w & 0x1ff) * 5 };
        slots.push(s);
        if (s.bis >= 1440) break;
      }
      programm[tag] = slots;
    }
    return { typ, roomId: u[5], rf: u.slice(1, 4).map(hex2).join(''), programm };
  };

  /** Plan prüfen; wirft Fehler mit verständlicher Meldung */
  const pruefePlan = (plan) => {
    if (!plan || typeof plan !== 'object' || !plan.raeume) throw new Error('Plan ohne Räume');
    for (const [rid, raum] of Object.entries(plan.raeume)) {
      for (const tag of TAGE) {
        const punkte = raum.tage && raum.tage[tag];
        try {
          if (punkte.length > MAX_PUNKTE) throw new Error('höchstens ' + MAX_PUNKTE + ' Schaltpunkte pro Tag');
          if (punkteZuSlots(punkte).length > SLOTS_PRO_NACHRICHT) throw new Error('zu viele Wechsel');
        } catch (e) {
          throw new Error((raum.name || 'Raum ' + rid) + ', ' + tag + ': ' + e.message);
        }
      }
    }
    return plan;
  };

  /** Raumbefehl „Temperatur/Modus“ (0x40, an alle Geräte des Raums): Urlaub bis Datum oder zurück auf Automatik */
  const urlaubHex = (rfAddress, roomId, temp, bisIso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(bisIso);
    if (!m) throw new Error('Ungültiges Datum: ' + bisIso);
    const [jahr, monat, tag, std, min] = m.slice(1).map(Number);
    const t = Math.round(pruefeTemp(temp) * 2);
    return '000440000000' + rfAddress.toLowerCase() + hex2(roomId) + hex2(0x80 | t) +
      hex2(((monat & 0x0e) << 4) | tag) + hex2(((monat & 1) << 7) | (jahr - 2000)) + hex2(std * 2 + (min >= 30 ? 1 : 0));
  };
  const automatikHex = (rfAddress, roomId) => '000440000000' + rfAddress.toLowerCase() + hex2(roomId) + '00';

  return { TAGE, MAX_TAG, MAX_PUNKTE, urlaubHex, automatikHex, punkteZuSlots, slotsZuPunkte, slotsGleich, wochenprofilHex, leseC, pruefePlan, normalisiere, zuHHMM };
})();

if (typeof module !== 'undefined' && typeof rules === 'undefined') {
  module.exports = Codec; // für Tests außerhalb von openHAB
} else {
  // =================================================================================
  // openHAB-Teil
  // =================================================================================
  const ITEM_DATEN = 'Heizplan_Daten';
  const ITEM_STATUS = 'Heizplan_Status';
  const ITEM_BEFEHL = 'Heizplan_Befehl';
  const MAX_VERSUCHE = 2;       // danach gilt ein Tag als „nicht bestätigt“ und wird nicht weiter gesendet
  const DUTY_GRENZE = 60;       // Funk-Auslastung in %, ab der der Lauf aufhört (Reserve für normale Befehle)
  const MAX_SENDUNGEN = 12;     // höchstens so viele Tages-Befehle pro Lauf

  const log = (m) => console.info('[Heizplan] ' + m);
  const J = {
    Socket: Java.type('java.net.Socket'),
    InetSocketAddress: Java.type('java.net.InetSocketAddress'),
    BufferedReader: Java.type('java.io.BufferedReader'),
    InputStreamReader: Java.type('java.io.InputStreamReader'),
    OutputStreamWriter: Java.type('java.io.OutputStreamWriter'),
    UTF8: Java.type('java.nio.charset.StandardCharsets').UTF_8,
    Base64: Java.type('java.util.Base64'),
    Files: Java.type('java.nio.file.Files'),
    Paths: Java.type('java.nio.file.Paths'),
    Thread: Java.type('java.lang.Thread'),
    System: Java.type('java.lang.System'),
    HexFormat: Java.type('java.util.HexFormat'),
  };

  const verzeichnis = String(J.System.getProperty('openhab.userdata') || '/openhab/userdata');
  const DATEI_PLAN = J.Paths.get(verzeichnis, 'heizplan.json');
  const DATEI_ZUSTAND = J.Paths.get(verzeichnis, 'heizplan-zustand.json');

  const leseDatei = (p) => { try { return J.Files.exists(p) ? JSON.parse(String(J.Files.readString(p, J.UTF8))) : null; } catch (e) { log('Datei unlesbar: ' + p + ' – ' + e); return null; } };
  const schreibeDatei = (p, o) => J.Files.writeString(p, JSON.stringify(o, null, 1), J.UTF8);

  const konfig = (thing, key) => { const v = thing.rawThing.getConfiguration().get(key); return v === null || v === undefined ? null : String(v); };

  /** MAX!-Bridge und Namen der Thermostate (RF-Adresse → Label/Raum) aus der Thing-Liste */
  const maxThings = () => {
    const alle = things.getThings();
    const bridge = alle.find((t) => String(t.thingTypeUID) === 'max:bridge');
    const namen = {};
    alle.filter((t) => String(t.thingTypeUID).startsWith('max:')).forEach((t) => {
      const rf = (konfig(t, 'rfAddress') || '').toLowerCase();
      if (rf) namen[rf] = { label: String(t.label), raum: konfig(t, 'room') || '' };
    });
    return { bridge, namen };
  };

  /** Thing aktivieren/deaktivieren (openhab-js, sonst über den ThingManager) */
  const setzeAktiv = (thing, an) => {
    if (typeof thing.setEnabled === 'function') { thing.setEnabled(an); return; }
    const ThingUID = Java.type('org.openhab.core.thing.ThingUID');
    osgi.getService('org.openhab.core.thing.ThingManager').setEnabled(new ThingUID(String(thing.uid)), an);
  };

  /** Geräte so, wie der Cube sie kennt (RF-Adresse, Raum-ID, Typ), mit Namen aus openHAB */
  const geraeteAus = (programme, namen) => Object.entries(programme).map(([rf, c]) => ({
    rf, roomId: c.roomId, wand: c.typ === 3,
    label: (namen[rf] && namen[rf].label) || ('Thermostat ' + rf),
    raum: (namen[rf] && namen[rf].raum) || '',
  }));

  const status = (obj) => { obj.zeit = new Date().toISOString(); items.getItem(ITEM_STATUS).postUpdate(JSON.stringify(obj)); };

  /** Verbindung zum Cube; liefert Funktionen zum Lesen/Senden */
  const cubeVerbinden = (ip, port) => {
    const sock = new J.Socket();
    sock.connect(new J.InetSocketAddress(ip, port), 10000);

    const rd = new J.BufferedReader(new J.InputStreamReader(sock.getInputStream(), J.UTF8));
    const wr = new J.OutputStreamWriter(sock.getOutputStream(), J.UTF8);
    const lesenBis = (praefix, ms) => {
      const zeilen = [];
      sock.setSoTimeout(ms);
      for (;;) {
        let z;
        try { z = rd.readLine(); } catch (e) { throw new Error('Keine Antwort „' + praefix + '“ vom Cube (' + e + ')'); }
        if (z === null) throw new Error('Cube hat die Verbindung geschlossen');
        z = String(z); zeilen.push(z);
        if (z.startsWith(praefix)) return zeilen;
      }
    };
    return {
      begruessung: () => lesenBis('L:', 20000),
      senden: (hex) => {
        const b64 = String(J.Base64.getEncoder().encodeToString(J.HexFormat.of().parseHex(hex)));
        wr.write('s:' + b64 + '\r\n'); wr.flush();
        const z = lesenBis('S:', 30000).pop();
        const [duty, verworfen] = z.substring(2).split(',');
        return { duty: parseInt(duty, 16), verworfen: verworfen === '1' };
      },
      schliessen: () => { try { sock.close(); } catch (e) { /* egal */ } },
    };
  };

  /** C:-Zeilen auswerten → { rf: {programm, roomId} } */
  const programmeAus = (zeilen) => {
    const res = {};
    for (const z of zeilen) {
      if (!z.startsWith('C:')) continue;
      const [rf, b64] = z.substring(2).split(',');
      try {
        const c = Codec.leseC(J.Base64.getDecoder().decode(b64));
        if (c) res[rf.toLowerCase()] = c;
      } catch (e) { log('C-Daten für ' + rf + ' nicht lesbar: ' + e); }
    }
    return res;
  };

  /** Plan aus den Thermostaten übernehmen (je Raum: Wandthermostat bevorzugt) */
  const planAusGeraeten = (geraete, programme) => {
    const raeume = {};
    for (const g of [...geraete].sort((a, b) => (b.wand ? 1 : 0) - (a.wand ? 1 : 0))) {
      const p = programme[g.rf];
      if (!p || raeume[g.roomId]) continue;
      const tage = {};
      Codec.TAGE.forEach((t) => { tage[t] = Codec.slotsZuPunkte(p.programm[t]); });
      raeume[g.roomId] = { name: g.raum || ('Raum ' + g.roomId), tage };
    }
    return { version: 1, raeume };
  };

  let laeuft = false;

  /** Hauptlauf. modus: 'abgleich' oder 'einlesen' */
  const lauf = (modus) => {
    if (laeuft) { log('Lauf läuft bereits'); return; }
    laeuft = true;
    const { bridge, namen } = maxThings();
    const plan = leseDatei(DATEI_PLAN);
    const zustand = leseDatei(DATEI_ZUSTAND) || { versuche: {} };
    if (!bridge) { status({ meldung: 'Keine MAX!-Cube-Bridge in openHAB gefunden.', fehler: true }); laeuft = false; return; }
    if (modus === 'abgleich' && !plan) modus = 'einlesen';

    const ip = konfig(bridge, 'ipAddress');
    const port = Number(konfig(bridge, 'port') || 62910);
    let cube = null; let gesendet = 0; let duty = null; let limit = false; let meldung = '';
    const tagStatus = {}; // roomId → tag → ok|offen|fehler

    try {
      setzeAktiv(bridge, false);
      J.Thread.sleep(4000); // Binding gibt die Verbindung frei
      cube = cubeVerbinden(ip, port);
      const programme = programmeAus(cube.begruessung());
      const geraete = geraeteAus(programme, namen);

      if (modus === 'einlesen') {
        const neu = planAusGeraeten(geraete, programme);
        if (!Object.keys(neu.raeume).length) throw new Error('Keine Wochenprogramme im Cube gefunden.');
        schreibeDatei(DATEI_PLAN, neu);
        items.getItem(ITEM_DATEN).postUpdate(JSON.stringify(neu));
        zustand.versuche = {};
        meldung = 'Wochenprogramme aus ' + Object.keys(neu.raeume).length + ' Räumen übernommen.';
        Object.keys(neu.raeume).forEach((r) => { tagStatus[r] = {}; Codec.TAGE.forEach((t) => { tagStatus[r][t] = 'ok'; }); });
      } else {
        // offene Aufträge ermitteln: Plan ≠ Programm im Gerät
        const auftraege = [];
        for (const [rid, raum] of Object.entries(plan.raeume)) {
          tagStatus[rid] = {};
          const imRaum = geraete.filter((g) => String(g.roomId) === String(rid));
          for (const tag of Codec.TAGE) {
            const soll = Codec.punkteZuSlots(raum.tage[tag]);
            let st = 'ok';
            for (const g of imRaum) {
              const ist = programme[g.rf];
              if (ist && Codec.slotsGleich(ist.programm[tag], soll)) continue;
              const hex = Codec.wochenprofilHex(g.rf, Number(rid), tag, soll);
              const key = g.rf + '/' + tag;
              const v = zustand.versuche[key];
              const anzahl = v && v.hex === hex ? v.n : 0;
              if (anzahl >= MAX_VERSUCHE) { st = 'fehler'; continue; }
              if (st !== 'fehler') st = 'offen';
              auftraege.push({ key, hex, rid, tag, label: g.label });
            }
            tagStatus[rid][tag] = imRaum.length ? st : 'fehler';
          }
        }
        // senden, solange das Funk-Limit es zulässt
        for (const a of auftraege) {
          if (gesendet >= MAX_SENDUNGEN || (duty !== null && duty >= DUTY_GRENZE)) { limit = true; break; }
          const r = cube.senden(a.hex);
          duty = r.duty;
          if (r.verworfen) { limit = true; log('Cube hat Befehl verworfen (Funk-Limit): ' + a.label + ' ' + a.tag); break; }
          const v = zustand.versuche[a.key];
          zustand.versuche[a.key] = { hex: a.hex, n: (v && v.hex === a.hex ? v.n : 0) + 1 };
          gesendet++;
          log('Gesendet: ' + a.label + ', ' + a.tag);
          J.Thread.sleep(1500);
        }
        const offen = auftraege.length - gesendet;
        meldung = auftraege.length === 0 ? 'Alle Thermostate haben den aktuellen Plan.'
          : gesendet + ' Tagesprogramme übertragen' + (offen > 0 ? ', ' + offen + ' folgen' + (limit ? ' nach der Funkpause' : '') + ' beim nächsten Lauf (alle 15 min).' : '; Bestätigung beim nächsten Lauf.');
      }
      schreibeDatei(DATEI_ZUSTAND, zustand);
      status({ meldung, duty, tage: tagStatus, fehler: false, fehlerZaehler: 0 });
    } catch (e) {
      log('Fehler: ' + e);
      let alt = null; try { alt = JSON.parse(String(items.getItem(ITEM_STATUS).state)); } catch (x) { /* kein alter Status */ }
      status({ meldung: 'Fehler: ' + e.message, tage: (alt && alt.tage) || tagStatus, fehler: true, fehlerZaehler: ((alt && alt.fehlerZaehler) || 0) + 1 });
    } finally {
      if (cube) cube.schliessen();
      try { setzeAktiv(bridge, true); } catch (e) { log('Bridge konnte nicht wieder aktiviert werden: ' + e); }
      laeuft = false;
    }
  };

  /** Urlaub mit Enddatum (das Binding kann das nicht) bzw. Urlaub beenden – direkt über den Cube */
  const urlaubLauf = (auftrag) => {
    if (laeuft) { log('Lauf läuft bereits – Urlaub später erneut senden'); return; }
    laeuft = true;
    const { bridge } = maxThings();
    let cube = null;
    try {
      if (!bridge) throw new Error('Keine MAX!-Cube-Bridge gefunden');
      setzeAktiv(bridge, false);
      J.Thread.sleep(4000);
      cube = cubeVerbinden(konfig(bridge, 'ipAddress'), Number(konfig(bridge, 'port') || 62910));
      const programme = programmeAus(cube.begruessung());
      const geraete = Object.entries(programme).map(([rf, c]) => ({ rf, roomId: c.roomId, wand: c.typ === 3 }));
      let ok = 0;
      for (const rid of auftrag.raeume) {
        const g = geraete.filter((x) => String(x.roomId) === String(rid)).sort((a, b) => b.wand - a.wand)[0];
        if (!g) { log('Raum ' + rid + ': kein Thermostat gefunden'); continue; }
        const hex = auftrag.art === 'urlaub' ? Codec.urlaubHex(g.rf, Number(rid), auftrag.temp, auftrag.bis) : Codec.automatikHex(g.rf, Number(rid));
        const r = cube.senden(hex);
        if (r.verworfen) { log('Cube hat den Urlaubsbefehl verworfen (Funk ' + r.duty + ' %)'); break; }
        ok++; J.Thread.sleep(1500);
      }
      let alt = {}; try { alt = JSON.parse(String(items.getItem(ITEM_STATUS).state)); } catch (x) { /* leer */ }
      alt.meldung = auftrag.art === 'urlaub' ? `Urlaub bis ${auftrag.bis.replace('T', ' ')} an ${ok} Räume gesendet.` : `Urlaub in ${ok} Räumen beendet.`;
      status(alt);
    } catch (e) {
      log('Urlaub: ' + e); status({ meldung: 'Urlaub nicht gesendet: ' + e.message, fehler: true });
    } finally {
      if (cube) cube.schliessen();
      try { if (bridge) setzeAktiv(bridge, true); } catch (e) { log('Bridge konnte nicht wieder aktiviert werden: ' + e); }
      laeuft = false;
    }
  };

  // --- Regeln ---------------------------------------------------------------------
  rules.JSRule({
    name: 'Heizplan: neuer Plan gespeichert',
    id: 'heizplan_speichern',
    triggers: [triggers.ItemCommandTrigger(ITEM_DATEN)],
    execute: (event) => {
      try {
        const plan = Codec.pruefePlan(JSON.parse(String(event.receivedCommand)));
        plan.version = 1; plan.geaendert = new Date().toISOString();
        schreibeDatei(DATEI_PLAN, plan);
        items.getItem(ITEM_DATEN).postUpdate(JSON.stringify(plan));
        lauf('abgleich');
      } catch (e) {
        log('Plan abgelehnt: ' + e.message);
        const alt = leseDatei(DATEI_PLAN);
        if (alt) items.getItem(ITEM_DATEN).postUpdate(JSON.stringify(alt));
        status({ meldung: 'Plan nicht gespeichert: ' + e.message, fehler: true });
      }
    },
  });

  rules.JSRule({
    name: 'Heizplan: Befehl',
    id: 'heizplan_befehl',
    triggers: [triggers.ItemCommandTrigger(ITEM_BEFEHL)],
    execute: (event) => {
      const b = String(event.receivedCommand);
      // urlaub|2026-12-24T18:00|15|1,2,3   ·   urlaub-ende|1,2,3
      if (b.startsWith('urlaub|')) { const [, bis, temp, ids] = b.split('|'); urlaubLauf({ art: 'urlaub', bis, temp: Number(temp), raeume: ids.split(',') }); return; }
      if (b.startsWith('urlaub-ende|')) { urlaubLauf({ art: 'ende', raeume: b.split('|')[1].split(',') }); return; }
      lauf(b === 'einlesen' ? 'einlesen' : 'abgleich');
    },
  });

  rules.JSRule({
    name: 'Heizplan: Abgleich alle 15 Minuten',
    id: 'heizplan_zyklisch',
    triggers: [triggers.GenericCronTrigger('0 7/15 * * * ?')],
    execute: () => {
      const s = items.getItem(ITEM_STATUS).state;
      let st = null; try { st = JSON.parse(String(s)); } catch (e) { /* noch kein Status */ }
      if (!st) return;
      const offen = st.tage && Object.values(st.tage).some((t) => Object.values(t).includes('offen'));
      // nach Verbindungsfehlern höchstens dreimal automatisch neu versuchen, damit die Bridge nicht dauernd aus- und eingeschaltet wird
      if (st.fehler ? (st.fehlerZaehler || 0) < 3 : offen) lauf('abgleich');
    },
  });

  rules.JSRule({
    name: 'Heizplan: Start',
    id: 'heizplan_start',
    triggers: [triggers.SystemStartlevelTrigger(100)],
    execute: () => {
      const plan = leseDatei(DATEI_PLAN);
      if (plan) items.getItem(ITEM_DATEN).postUpdate(JSON.stringify(plan));
      setTimeout(() => lauf(plan ? 'abgleich' : 'einlesen'), 60000);
    },
  });
}
