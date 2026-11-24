'use strict';
/*
 * Zuhause – eigene Smart-Home-Oberfläche für openHAB. Ohne Fremdpakete.
 *
 * Umgebungsvariablen:
 *   OPENHAB_URL      z. B. http://192.168.131.14:8080 (Pflicht)
 *   OPENHAB_TOKEN    API-Token aus dem openHAB-Profil (Pflicht)
 *   ADMIN_BENUTZER   erster Admin, Standard „admin“
 *   ADMIN_PASSWORT   Passwort des ersten Admins (Pflicht beim ersten Start, mind. 8 Zeichen)
 *   PORT             Standard 8080
 *   DATEN            Datenordner, Standard /daten
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const OpenHAB = require('./openhab');
const { Heizung } = require('./heizung');
const { Benutzer } = require('./benutzer');

const cfg = {
  ohUrl: process.env.OPENHAB_URL, ohToken: process.env.OPENHAB_TOKEN,
  admin: process.env.ADMIN_BENUTZER || 'admin', adminPw: process.env.ADMIN_PASSWORT || '',
  port: Number(process.env.PORT || 8080), daten: process.env.DATEN || '/daten',
};
const log = (m) => console.log(new Date().toLocaleString('sv-SE') + ' ' + m);
if (!cfg.ohUrl || !cfg.ohToken) { console.error('OPENHAB_URL und OPENHAB_TOKEN fehlen.'); process.exit(1); }
fs.mkdirSync(cfg.daten, { recursive: true });

const benutzer = new Benutzer(cfg.daten, log);
try { benutzer.einrichten(cfg.admin, cfg.adminPw); } catch (e) { console.error(e.message); process.exit(1); }
const oh = new OpenHAB({ url: cfg.ohUrl, token: cfg.ohToken, log });
const heizung = new Heizung(oh, cfg.daten, log);
oh.starten();

// Lichtstimmungen je Lampe (Abgleich), für alle Benutzer gleich
const lampenDatei = path.join(cfg.daten, 'lampen.json');
let lampen = {}; try { lampen = JSON.parse(fs.readFileSync(lampenDatei, 'utf8')); } catch (e) { /* noch keine */ }

// Eigene Namen und Raumzuordnung je Gerät (überschreiben die Vorgaben aus openHAB nur in dieser App)
const namenDatei = path.join(cfg.daten, 'namen.json');
let namen = { geraete: {} }; try { namen = JSON.parse(fs.readFileSync(namenDatei, 'utf8')); } catch (e) { /* noch keine */ }
function namenSetzen(k) {
  const g = {};
  for (const [n, v] of Object.entries((k && k.geraete) || {})) {
    if (!/^[A-Za-z0-9_]{1,120}$/.test(n) || !v || typeof v !== 'object') continue;
    const e = {};
    if (typeof v.label === 'string' && v.label.trim()) e.label = v.label.trim().slice(0, 60);
    if (typeof v.raum === 'string' && /^[A-Za-z0-9_:]{1,120}$/.test(v.raum)) e.raum = v.raum;
    if (v.versteckt === true) e.versteckt = true;
    if (Object.keys(e).length) g[n] = e;
  }
  namen = { geraete: g }; fs.writeFileSync(namenDatei, JSON.stringify(namen, null, 1)); return namen;
}

// ------------------------------------------------------------------ Live-Ereignisse an die Browser
const zuhoerer = new Set();
const senden = (art, daten) => { const z = `event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`; for (const r of zuhoerer) r.write(z); };
oh.on('zustand', (name, state) => senden('zustand', { name, state }));
oh.on('modell', () => senden('modell', {}));
oh.on('verbindung', () => senden('verbindung', { verbunden: oh.verbunden }));
setInterval(() => { for (const r of zuhoerer) r.write(': ping\n\n'); }, 25000);

// ------------------------------------------------------------------ HTTP-Helfer
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const ipVon = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const fehlversuche = {};
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function koerper(req) {
  return new Promise((ja, nein) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 2e6) { nein(new Error('Zu groß')); req.destroy(); } });
    req.on('end', () => { try { ja(d ? JSON.parse(d) : {}); } catch (e) { nein(new Error('Ungültiges JSON')); } });
  });
}
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const OEFFENTLICH = path.join(__dirname, '..', 'public');
// Testserver deutlich kennzeichnen – er bedient dasselbe Haus wie die Produktivinstanz
const TESTBANNER = process.env.APP_ENV === 'test'
  ? `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff4c2;color:#5c4a00;font:13px system-ui,sans-serif;text-align:center;padding:3px 8px;pointer-events:none">Testserver – wird ${String(process.env.APP_VERSION || '').replace(/[<>&"]/g, '')} · Heizplan wird hier nicht automatisch übertragen</div>`
  : '';
function datei(res, name) {
  const p = path.normalize(path.join(OEFFENTLICH, name));
  if (!p.startsWith(OEFFENTLICH)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, d) => {
    if (e) return datei(res, 'index.html');   // Einzelseiten-App: unbekannte Pfade → index.html
    if (TESTBANNER && path.basename(p) === 'index.html') d = Buffer.from(String(d).replace('<body>', '<body>' + TESTBANNER));
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(d);
  });
}
const nurAdmin = (b) => { if (b.rolle !== 'admin') throw Object.assign(new Error('Nur für Admins'), { code: 403 }); };

// ------------------------------------------------------------------ Routen (angemeldet)
const routen = [
  ['GET', /^\/api\/ich$/, (m, k, b) => ({ benutzer: benutzer.oeffentlich(b), ...benutzer.einstellungen(b.id) })],
  ['PUT', /^\/api\/ich\/darstellung$/, (m, k, b) => benutzer.darstellungSetzen(b.id, k)],
  ['PUT', /^\/api\/ich\/start\/(pc|handy)$/, (m, k, b) => benutzer.startSetzen(b.id, m[1], k.elemente)],
  ['PUT', /^\/api\/ich\/passwort$/, (m, k, b) => benutzer.aendern(b.id, { passwort: k.passwort })],
  ['GET', /^\/api\/status$/, () => ({ openhab: { verbunden: oh.verbunden, fehler: oh.fehler, items: oh.items.size, geladen: oh.geladen }, heizung: heizung.verfuegbar() })],
  ['GET', /^\/api\/items$/, () => [...oh.items.values()]],
  ['POST', /^\/api\/item\/([A-Za-z0-9_]+)$/, async (m, k) => { await oh.befehl(m[1], k.wert); }],
  ['GET', /^\/api\/lampen$/, () => lampen],
  ['GET', /^\/api\/namen$/, () => namen],
  ['PUT', /^\/api\/namen$/, (m, k, b) => { nurAdmin(b); return namenSetzen(k); }],
  ['PUT', /^\/api\/lampen\/([A-Za-z0-9_]+)$/, (m, k) => {
    const st = {};
    for (const [id, v] of Object.entries(k || {})) { if (!/^[a-z]{2,20}$/.test(id) || !/^\d{1,3},\d{1,3},\d{1,3}$/.test(v)) throw new Error('Ungültige Stimmung'); st[id] = v; }
    lampen[m[1]] = st; fs.writeFileSync(lampenDatei, JSON.stringify(lampen)); return st;
  }],
  // Heizung
  ['GET', /^\/api\/heizung$/, () => heizung.ansicht()],
  ['PUT', /^\/api\/heizung\/vorlagen$/, async (m, k) => { await heizung.vorlagenSetzen(k.vorlagen); return heizung.ansicht(); }],
  ['PUT', /^\/api\/heizung\/woche$/, async (m, k) => { await heizung.wocheSetzen(k.woche); return heizung.ansicht(); }],
  ['POST', /^\/api\/heizung\/heute$/, async (m, k) => { await heizung.heuteAnders(k.vorlage, k.verlaengern); return heizung.ansicht(); }],
  ['PUT', /^\/api\/heizung\/einstellungen$/, async (m, k, b) => { nurAdmin(b); await heizung.einstellungen(k); return heizung.ansicht(); }],
  ['POST', /^\/api\/heizung\/urlaub$/, async (m, k) => { await heizung.urlaub(k.raeume, k.temp, k.bis); }],
  ['DELETE', /^\/api\/heizung\/urlaub$/, async (m, k) => { await heizung.urlaubEnde(k.raeume); }],
  ['POST', /^\/api\/heizung\/haus$/, async (m, k) => { await heizung.hausModus(k.modus); }],
  ['POST', /^\/api\/heizung\/senden$/, async () => { await heizung.senden(); }],
  // Benutzerverwaltung
  ['GET', /^\/api\/benutzer$/, (m, k, b) => { nurAdmin(b); return benutzer.alle(); }],
  ['POST', /^\/api\/benutzer$/, (m, k, b) => { nurAdmin(b); return benutzer.anlegen(k); }],
  ['PUT', /^\/api\/benutzer\/([0-9a-f]+)$/, (m, k, b) => { nurAdmin(b); return benutzer.aendern(m[1], k); }],
  ['DELETE', /^\/api\/benutzer\/([0-9a-f]+)$/, (m, k, b) => { nurAdmin(b); if (m[1] === b.id) throw new Error('Du kannst dich nicht selbst löschen'); benutzer.loeschen(m[1]); }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (url.pathname === '/api/anmelden' && req.method === 'POST') {
      const ip = ipVon(req); const f = fehlversuche[ip];
      if (f && f.n >= 5 && f.bis > Date.now()) return json(res, 429, { fehler: 'Zu viele Fehlversuche – bitte 15 Minuten warten.' });
      const k = await koerper(req);
      const sid = benutzer.anmelden(k.benutzer, k.passwort);
      if (!sid) { fehlversuche[ip] = { n: (f && f.bis > Date.now() ? f.n : 0) + 1, bis: Date.now() + 15 * 60e3 }; log('Fehlgeschlagene Anmeldung von ' + ip); return json(res, 401, { fehler: 'Benutzername oder Passwort falsch' }); }
      delete fehlversuche[ip];
      res.setHeader('Set-Cookie', `sitzung=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 86400}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/gesund') return json(res, 200, { ok: true, openhab: oh.verbunden });
    if (url.pathname.startsWith('/api/')) {
      const sid = cookies(req).sitzung;
      const b = benutzer.sitzung(sid);
      if (!b) return json(res, 401, { fehler: 'Bitte anmelden' });
      if (url.pathname === '/api/abmelden' && req.method === 'POST') { benutzer.abmelden(sid); res.setHeader('Set-Cookie', 'sitzung=; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/ereignisse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
        res.write('retry: 3000\n\n'); zuhoerer.add(res); req.on('close', () => zuhoerer.delete(res)); return;
      }
      if (req.method !== 'GET' && req.headers['x-zuhause'] !== '1') return json(res, 403, { fehler: 'Ungültige Anfrage' });
      for (const [methode, muster, f] of routen) {
        const m = req.method === methode && muster.exec(url.pathname);
        if (!m) continue;
        const k = req.method === 'GET' ? {} : await koerper(req);
        const erg = await f(m, k, b);
        return json(res, 200, erg === undefined ? { ok: true } : erg);
      }
      return json(res, 404, { fehler: 'Unbekannte Funktion' });
    }
    return datei(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (e) {
    if (!res.headersSent) json(res, e.code === 403 ? 403 : 400, { fehler: e.message });
  }
});
server.listen(cfg.port, () => log(`Zuhause läuft auf Port ${cfg.port} · openHAB ${cfg.ohUrl}`));
const ende = () => { oh.stoppen(); for (const r of zuhoerer) r.end(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGTERM', ende); process.on('SIGINT', ende);
