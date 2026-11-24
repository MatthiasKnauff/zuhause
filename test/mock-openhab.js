'use strict';
/*
 * Nachgebautes openHAB für Tests: REST-Items, Befehle, Ereignisstrom (SSE).
 * Nutzt die echten Items aus einem openHAB-JSONDB-Export (Item.json + Metadata.json).
 */
const http = require('http');
const fs = require('fs');

function mockOpenhab({ port, itemDatei, metaDatei, token = 'test-token', aufraeumen = true }) {
  const roh = JSON.parse(fs.readFileSync(itemDatei, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(metaDatei, 'utf8'));
  const items = new Map();
  for (const [name, { value: v }] of Object.entries(roh)) {
    items.set(name, { name, label: v.label || '', type: v.itemType, tags: v.tags || [], groupNames: v.groupNames || [], category: v.category || '', state: 'NULL' });
  }
  // Modell so, wie es nach modell-aufraeumen.js aussieht
  if (aufraeumen) {
    const lab = { Wohnzimmer: 'Wohnzimmer', Arbeitszimmer: 'Arbeitszimmer', Schlafzimmer: 'Schlafzimmer', Bad: 'Bad', Diele: 'Diele', Stehlampe_shelly18caab55fc066192168179203: 'Stehlampe', Schreibtischlampe_shellyplugs5adcfc192168179218: 'Schreibtischlampe', LED_Wohnzimmer_eWeLight: 'LED Wohnzimmer', Kaffeemaschine__TZ3000_2putqrmw: 'Kaffeemaschine', Spiegelei_Paulmann_Licht_GmbH: 'Wandlampe', Igel_Paulmann_Licht_GmbH: 'Igel', Balkon_Kugel__TZ3000_q50zhdsc: 'Balkon-Kugel', London_shellyplugs5b0ccb__192168179212: 'London', PC_shellyunie8db84d6593f__192168179205: 'PC', LED_Schlafzimmer_192168179219: 'LED Schlafzimmer', _3D_Drucker_Shelly_PlugS: '3D-Drucker', Aussentemperatur_LUMI: 'Außensensor', Termostat_Office__TZE284_wtikaxzs: 'Klimasensor Arbeitszimmer', Thermostat_Schlafzimmer: 'Klimasensor Schlafzimmer' };
    for (const [n, l] of Object.entries(lab)) if (items.has(n)) items.get(n).label = l;
    for (const n of ['Heizung_Wohnzimmer', 'Heizung_Schlafzimmer']) items.get(n).tags = ['RadiatorControl'];
    items.get('Thermostat_Schlafzimmer').tags = ['TemperatureSensor'];
    items.get('Kaffeemaschine__TZ3000_2putqrmw').tags = ['PowerOutlet'];
  }
  for (const [k, { value: v }] of Object.entries(meta)) {
    const [ns, name] = k.split(':');
    if (ns === 'stateDescription' && items.has(name)) items.get(name).stateDescription = { pattern: (v.configuration || {}).pattern, readOnly: false, options: [] };
  }
  // Heizplan-Items wie aus heizplan.items
  const tage = (p) => Object.fromEntries(['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'].map((t) => [t, p(t)]));
  const werk = [['07:30', 20], ['16:30', 4.5]];
  const plan = { version: 1, raeume: {
    1: { name: 'Wohnzimmer', tage: tage((t) => (t === 'sa' || t === 'so') ? [['08:00', 21], ['23:00', 17]] : t === 'fr' ? [['07:30', 20], ['14:00', 4.5]] : werk) },
    2: { name: 'Küche', tage: tage((t) => (t === 'sa' || t === 'so') ? [['08:00', 21], ['23:00', 17]] : t === 'fr' ? [['07:30', 20], ['14:00', 4.5]] : werk) },
    3: { name: 'Bad', tage: tage((t) => [['06:00', 21], ['08:00', 17], ['19:00', 21], ['21:00', 17]]) },
  } };
  for (const [n, s] of [['Heizplan_Daten', JSON.stringify(plan)], ['Heizplan_Status', JSON.stringify({ meldung: 'Alle Thermostate haben den aktuellen Plan.', duty: 12 })], ['Heizplan_Befehl', 'NULL']]) {
    items.set(n, { name: n, label: n, type: 'String', tags: [], groupNames: [], category: '', state: s });
  }
  // Zustände
  const zufall = (i) => i.name.includes('Temperatur') ? '21.4 °C' : i.name.includes('Solltemperatur') ? '21.5 °C' : '0';
  for (const i of items.values()) {
    if (i.state !== 'NULL') continue;
    if (i.type === 'Switch') i.state = /Niedriger_Batteriestatus|LED_aus|Firmware/.test(i.name) ? 'OFF' : (/Stehlampe.*Output|Kaffeemaschine.*Betrieb/.test(i.name) ? 'ON' : 'OFF');
    else if (i.type === 'Dimmer') i.state = i.name.startsWith('LED_Wohnzimmer') ? '70' : '0';
    else if (i.type === 'Color') i.state = i.name.startsWith('Spiegelei') ? '280,60,60' : '0,0,0';
    else if (i.type === 'Contact') i.state = 'CLOSED';
    else if (i.type === 'Number:Temperature') i.state = /Solltemperatur/.test(i.name) ? '21.5 °C' : /Farbtemperatur/.test(i.name) ? '3700 K' : (i.name.startsWith('Aussen') ? '6.4 °C' : '21.4 °C');
    else if (i.type === 'Number:Dimensionless') i.state = '55 %';
    else if (i.type === 'Number:Power') i.state = /Stehlampe/.test(i.name) ? '8.2 W' : '0 W';
    else if (i.type === 'Number:Energy') i.state = '12.4 kWh';
    else if (i.type === 'Number') i.state = /Ventilposition/.test(i.name) ? '64' : /Aktueller_Verbrauch/.test(i.name) ? '312' : /Zahlerstand/.test(i.name) ? '18402.123' : /Auslastungsgrad/.test(i.name) ? '12' : '3';
    else if (i.type === 'String') i.state = /_Modus$/.test(i.name) ? 'AUTOMATIC' : 'NULL';
    else if (i.type === 'DateTime') i.state = '2026-11-24T06:30:00.000+0100';
    else if (i.type === 'Group') i.state = 'NULL';
    else i.state = zufall(i);
  }
  const stand = { befehle: [], items, verbindungen: 0 };
  const sse = new Set();
  const senden = (i, alt) => {
    const ev = { topic: `openhab/items/${i.name}/statechanged`, payload: JSON.stringify({ type: 'String', value: i.state, oldType: 'String', oldValue: alt }), type: 'ItemStateChangedEvent' };
    for (const r of sse) r.write('event: message\ndata: ' + JSON.stringify(ev) + '\n\n');
  };
  const setze = (i, cmd) => {
    const alt = i.state; let neu = cmd;
    if (i.type === 'Dimmer') neu = cmd === 'ON' ? '100' : cmd === 'OFF' ? '0' : cmd;
    if (i.type === 'Color') { const [h, s, b] = (alt || '0,0,0').split(','); neu = cmd === 'ON' ? `${h},${s},100` : cmd === 'OFF' ? `${h},${s},0` : /^\d+$/.test(cmd) ? `${h},${s},${cmd}` : cmd; }
    if (i.type.startsWith('Number:Temperature') && /^[\d.]+$/.test(cmd)) neu = cmd + (i.name.includes('Farbtemperatur') ? ' K' : ' °C');
    i.state = neu; senden(i, alt);
  };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/rest/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': verbunden\n\n'); sse.add(res); stand.verbindungen++;
      req.on('close', () => sse.delete(res)); return;
    }
    if (url.pathname === '/rest/items' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([...items.values()]));
    }
    const m = /^\/rest\/items\/([^/]+)(\/state)?$/.exec(url.pathname);
    if (m && items.has(m[1])) {
      const i = items.get(m[1]);
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(m[2] ? i.state : JSON.stringify(i)); }
      let b = ''; req.on('data', (d) => { b += d; });
      req.on('end', () => { stand.befehle.push([i.name, b]); setze(i, b); res.writeHead(200); res.end(); });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(port);
  stand.server = server; stand.setze = setze;
  return stand;
}
module.exports = mockOpenhab;
if (require.main === module) {
  const [port, a, b] = process.argv.slice(2);
  mockOpenhab({ port: Number(port || 18090), itemDatei: a, metaDatei: b });
  console.log('Mock-openHAB läuft');
}
