'use strict';
/*
 * Verbindung zu openHAB über die REST-Schnittstelle:
 * alle Items laden, Zustandsänderungen über den Ereignisstrom (SSE) mitlesen, Befehle senden.
 */
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

class OpenHAB extends EventEmitter {
  constructor({ url, token, log = console.log }) {
    super();
    this.basis = new URL(url.replace(/\/$/, '') + '/');
    Object.assign(this, { token, log });
    this.items = new Map();
    this.verbunden = false; this.fehler = null; this.geladen = null;
  }

  _anfrage(methode, pfad, body, typ = 'text/plain') {
    const u = new URL(pfad.replace(/^\//, ''), this.basis);
    const mod = u.protocol === 'https:' ? https : http;
    return new Promise((ja, nein) => {
      const req = mod.request(u, { method: methode, headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json', ...(body != null ? { 'Content-Type': typ } : {}) }, timeout: 20000 }, (res) => {
        let d = ''; res.setEncoding('utf8');
        res.on('data', (c) => { d += c; });
        res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300) ? ja(d) : nein(new Error(`openHAB antwortet ${res.statusCode} auf ${methode} ${u.pathname}`)));
      });
      req.on('timeout', () => req.destroy(new Error('openHAB antwortet nicht')));
      req.on('error', nein);
      if (body != null) req.write(body);
      req.end();
    });
  }

  async laden() {
    const liste = JSON.parse(await this._anfrage('GET', 'rest/items?metadata=semantics&fields=name,label,type,state,tags,groupNames,category,stateDescription,commandDescription,metadata'));
    this.items = new Map(liste.map((i) => [i.name, kurz(i)]));
    this.geladen = Date.now(); this.verbunden = true; this.fehler = null;
    this.emit('modell');
    return this.items;
  }

  async befehl(name, wert) {
    if (!this.items.has(name)) throw new Error('Unbekanntes Item: ' + name);
    await this._anfrage('POST', 'rest/items/' + encodeURIComponent(name), String(wert));
  }

  async zustand(name) { return this._anfrage('GET', 'rest/items/' + encodeURIComponent(name) + '/state'); }

  /** Ereignisstrom: Zustände live, Modelländerungen lösen ein Neuladen aus */
  starten() {
    const verbinden = async () => {
      try { await this.laden(); } catch (e) { this.verbunden = false; this.fehler = e.message; this.log('openHAB nicht erreichbar: ' + e.message); this._neu = setTimeout(verbinden, 15000); return; }
      const u = new URL('rest/events?topics=openhab/items/*/statechanged,openhab/items/*/added,openhab/items/*/removed,openhab/items/*/updated', this.basis);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(u, { headers: { Authorization: 'Bearer ' + this.token, Accept: 'text/event-stream' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); this.fehler = 'Ereignisstrom: ' + res.statusCode; this._neu = setTimeout(verbinden, 15000); return; }
        this.log('openHAB-Ereignisstrom verbunden');
        let puffer = ''; res.setEncoding('utf8');
        res.on('data', (c) => {
          puffer += c; let i;
          while ((i = puffer.indexOf('\n\n')) >= 0) {
            const block = puffer.slice(0, i); puffer = puffer.slice(i + 2);
            const daten = block.split('\n').filter((z) => z.startsWith('data:')).map((z) => z.slice(5).trim()).join('');
            if (daten) this._ereignis(daten);
          }
        });
        res.on('end', () => { this.verbunden = false; this.emit('verbindung'); this._neu = setTimeout(verbinden, 3000); });
      });
      req.on('error', (e) => { this.verbunden = false; this.fehler = e.message; this.emit('verbindung'); this._neu = setTimeout(verbinden, 15000); });
      req.end();
      this._sse = req;
    };
    verbinden();
  }

  _ereignis(text) {
    let e; try { e = JSON.parse(text); } catch (x) { return; }
    const m = /^openhab\/items\/([^/]+)\/(\w+)$/.exec(e.topic || '');
    if (!m) return;
    const [, name, art] = m;
    if (art === 'statechanged') {
      let p = {}; try { p = JSON.parse(e.payload); } catch (x) { /* leer */ }
      const i = this.items.get(name);
      if (i) { i.state = String(p.value); this.emit('zustand', name, i.state); }
    } else {
      clearTimeout(this._modellTimer);
      this._modellTimer = setTimeout(() => this.laden().catch((x) => this.log('Neuladen fehlgeschlagen: ' + x.message)), 1500);
    }
  }

  stoppen() { clearTimeout(this._neu); if (this._sse) this._sse.destroy(); }
}

/** nur was die Oberfläche braucht */
function kurz(i) {
  const sd = i.stateDescription || {};
  const cd = i.commandDescription || {};
  const sem = i.metadata && i.metadata.semantics ? i.metadata.semantics.value : null;
  const o = { name: i.name, label: i.label || '', type: i.type, state: i.state, tags: i.tags || [], groupNames: i.groupNames || [] };
  if (sem) o.sem = sem;
  if (sd.pattern) o.pattern = sd.pattern;
  if (sd.readOnly) o.readOnly = true;
  const opt = (sd.options && sd.options.length ? sd.options : cd.commandOptions) || [];
  if (opt.length) o.options = opt.map((x) => ({ value: x.value || x.command, label: x.label || x.value || x.command }));
  return o;
}

module.exports = OpenHAB;
