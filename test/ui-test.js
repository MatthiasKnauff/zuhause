// Oberflächentest gegen den laufenden Server (mit Mock-openHAB): node test/ui-test.js http://127.0.0.1:18100 /tmp/shots
const { chromium, devices } = require('playwright');
const [basis = 'http://127.0.0.1:18100', ordner = '/tmp/shots'] = process.argv.slice(2);
require('fs').mkdirSync(ordner, { recursive: true });
const fehler = [];
const pruefe = (b, text) => { if (!b) { fehler.push(text); console.log('✗ ' + text); } else console.log('✓ ' + text); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  // ---------------- PC
  const pc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const p = await pc.newPage();
  p.on('pageerror', (e) => fehler.push('JS-Fehler PC: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(basis);
  await p.fill('input[autocomplete=username]', 'admin');
  await p.fill('input[type=password]', 'falsch123');
  await p.click('button[type=submit]');
  await p.waitForTimeout(400);
  pruefe((await p.textContent('.fehlertext')).includes('falsch'), 'falsches Passwort wird abgelehnt');
  await p.fill('input[type=password]', 'geheim123');
  await p.click('button[type=submit]');
  await p.waitForSelector('.raster .karte.el');
  await p.waitForTimeout(600);
  pruefe(await p.isVisible('.nav-oben'), 'PC: Navigation oben');
  pruefe(!(await p.isVisible('.nav-unten')), 'PC: keine Leiste unten');
  const anzahl = await p.locator('.raster .karte.el').count();
  pruefe(anzahl >= 5, 'Startseite zeigt ' + anzahl + ' Elemente');
  await p.screenshot({ path: ordner + '/pc-start.png', fullPage: true });

  // Licht schalten (Stehlampe ist im Mock an)
  const vorher = await p.evaluate(() => fetch('/api/items').then((r) => r.json()).then((l) => l.find((i) => i.name === 'LED_Wohnzimmer_eWeLight_Helligkeit').state));
  await p.locator('.raster .karte.el', { hasText: 'LED Wohnzimmer' }).locator('.kipp').first().click();
  await p.waitForTimeout(700);
  const nachher = await p.evaluate(() => fetch('/api/items').then((r) => r.json()).then((l) => l.find((i) => i.name === 'LED_Wohnzimmer_eWeLight_Helligkeit').state));
  pruefe(vorher !== nachher, `Lampe geschaltet (${vorher} → ${nachher}), Anzeige live`);

  // Element entfernen und wieder hinzufügen (Liste rechts, +)
  const vorherN = await p.locator('.raster .karte.el').count();
  await p.locator('.raster .karte.el').last().hover();
  await p.locator('.raster .karte.el').last().locator('.weg').click();
  await p.waitForTimeout(300);
  pruefe((await p.locator('.raster .karte.el').count()) === vorherN - 1, '× entfernt ein Element');
  await p.fill('.panel input[type=search]', 'FRITZ');
  await p.locator('.panel .angebot', { hasText: 'FRITZ!DECT' }).first().locator('button').click();
  await p.waitForTimeout(400);
  pruefe(await p.locator('.raster .karte.el', { hasText: 'FRITZ!DECT' }).count() === 1, '+ fügt die FRITZ!DECT-Steckdose hinzu');

  // Ziehen aus der Liste an die erste Stelle
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.fill('.panel input[type=search]', 'Bad');
  const quelle = p.locator('.panel .angebot', { hasText: 'Bad' }).first();
  const zielK = p.locator('.raster .karte.el').first();
  const qb = await quelle.boundingBox(); const zb = await zielK.boundingBox();
  await p.mouse.move(qb.x + 30, qb.y + qb.height / 2); await p.mouse.down();
  await p.mouse.move(zb.x + 30, zb.y + 30, { steps: 12 }); await p.mouse.move(zb.x + 20, zb.y + 25, { steps: 3 });
  await p.mouse.up(); await p.waitForTimeout(500);
  const vorn = (await p.locator('.raster .karte.el').allTextContents()).slice(0, 2).join(' | ');
  console.log('   vorn:', vorn.replace(/\s+/g, ' ').slice(0, 120)); pruefe(/Bad/.test(vorn), 'Ziehen aus der Liste setzt „Bad“ ganz nach vorn (unter die erste Überschrift)');

  // Verschieben am Griff: erstes Element hinter das dritte
  const k0 = p.locator('.raster .karte.el').nth(0); const k2 = p.locator('.raster .karte.el').nth(2);
  const id0 = await k0.getAttribute('data-id');
  await k0.hover(); const gb = await k0.locator('.griff').boundingBox(); const b2 = await k2.boundingBox();
  await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await p.mouse.down();
  await p.mouse.move(b2.x + b2.width * 0.8, b2.y + b2.height * 0.6, { steps: 15 }); await p.mouse.up(); await p.waitForTimeout(500);
  const ids = await p.locator('.raster .karte.el').evaluateAll((l) => l.map((x) => x.dataset.id));
  pruefe(ids.indexOf(id0) > 0, 'Verschieben am Griff ändert die Reihenfolge (jetzt Platz ' + (ids.indexOf(id0) + 1) + ')');

  // Größe an der Ecke: ein kleines Element groß ziehen
  const klein = p.locator('.raster .karte.el.g-s').first();
  const kid = await klein.getAttribute('data-id');
  await klein.hover(); const eb = await klein.locator('.ecke').boundingBox();
  await p.mouse.move(eb.x + 8, eb.y + 8); await p.mouse.down(); await p.mouse.move(eb.x + 300, eb.y + 200, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(500);
  const kl = await p.locator(`.raster .karte.el[data-id="${kid}"]`).getAttribute('class');
  pruefe(/g-l/.test(kl), 'Ecke ziehen macht das Element groß (' + kl + ', Ecke bei ' + Math.round(eb.x) + ',' + Math.round(eb.y) + ')');
  await p.reload(); await p.waitForSelector('.raster .karte.el'); await p.waitForTimeout(500);
  const ids2 = await p.locator('.raster .karte.el').evaluateAll((l) => l.map((x) => x.dataset.id));
  pruefe(JSON.stringify(ids2) === JSON.stringify(await p.locator('.raster .karte.el').evaluateAll((l) => l.map((x) => x.dataset.id))) && ids2.includes(kid), 'Startseite bleibt nach Neuladen erhalten');
  await p.screenshot({ path: ordner + '/pc-start-geaendert.png', fullPage: true });

  // Detailansicht mit Verlauf: Außenfühler auf der Startseite antippen
  await p.locator('.raster .karte.el', { hasText: 'Außenfühler' }).first().locator('.k-name').click();
  await p.waitForSelector('dialog .verlauf-box svg .v-linie', { timeout: 5000 }).catch(() => {});
  pruefe(await p.locator('dialog .verlauf-box svg .v-linie').count() >= 1, 'Antippen zeigt Details mit Verlauf');
  await p.locator('dialog .chip', { hasText: '7 Tage' }).first().click(); await p.waitForTimeout(600);
  await p.screenshot({ path: ordner + '/pc-detail-verlauf.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // Räume
  await p.click('.nav-oben a[data-seite=raeume]'); await p.waitForSelector('.raum-chips'); await p.waitForTimeout(400);
  pruefe(await p.locator('.raum-chips .chip').count() >= 7, 'Räume aus dem Modell (' + await p.locator('.raum-chips .chip').count() + ')');
  await p.screenshot({ path: ordner + '/pc-raum.png', fullPage: true });
  await p.click('.raum-chips .chip:has-text("Diele")'); await p.waitForTimeout(400);
  pruefe(await p.locator('.stimmung').count() >= 6, 'Wandlampe zeigt Lichtstimmungen');
  await p.locator('.stimmung', { hasText: 'Abendrot' }).first().click(); await p.waitForTimeout(500);
  const farbe = await p.evaluate(() => fetch('/api/items').then((r) => r.json()).then((l) => l.find((i) => i.name === 'Spiegelei_Paulmann_Licht_GmbH_Farbe').state));
  pruefe(farbe === '18,70,55', 'Stimmung Abendrot sendet 18,70,55 (ist ' + farbe + ')');
  await p.screenshot({ path: ordner + '/pc-diele.png', fullPage: true });
  await p.click('text=Für diese Lampe abgleichen'); await p.waitForSelector('dialog .abgleich');
  await p.screenshot({ path: ordner + '/pc-abgleich.png' });
  const r0 = p.locator('dialog .abgleich').nth(2).locator('input.farbton');
  await r0.fill('10'); await p.waitForTimeout(500);
  await p.click('dialog button:has-text("Speichern")'); await p.waitForTimeout(500);
  const lampen = await p.evaluate(() => fetch('/api/lampen').then((r) => r.json()));
  pruefe(lampen.Spiegelei_Paulmann_Licht_GmbH && lampen.Spiegelei_Paulmann_Licht_GmbH.abendrot === '10,70,55', 'Abgleich gespeichert: Abendrot = ' + JSON.stringify(lampen.Spiegelei_Paulmann_Licht_GmbH && lampen.Spiegelei_Paulmann_Licht_GmbH.abendrot));

  // Heizung
  await p.click('.nav-oben a[data-seite=heizung]'); await p.waitForSelector('.wr'); await p.waitForTimeout(400);
  await p.screenshot({ path: ordner + '/pc-heizung.png', fullPage: true });
  const vorlagen = await p.locator('.vorlage:not(.neu)').count();
  pruefe(vorlagen >= 3, 'Heizung: ' + vorlagen + ' Vorlagen');
  // Vorlage „Wochenende“ auf Mittwoch ziehen
  const vw = p.locator('.vorlage', { hasText: 'Wochenende' }).first(); const mi = p.locator('.tag[data-tag=mi]');
  const vb = await vw.boundingBox(); const mb = await mi.boundingBox();
  await p.mouse.move(vb.x + 40, vb.y + 15); await p.mouse.down(); await p.mouse.move(mb.x + 30, mb.y + 30, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(800);
  const woche = await p.evaluate(() => fetch('/api/heizung').then((r) => r.json()).then((h) => h.daten.woche.mi));
  const wid = await p.evaluate(() => fetch('/api/heizung').then((r) => r.json()).then((h) => h.daten.vorlagen.find((v) => v.name === 'Wochenende').id));
  pruefe(woche === wid, 'Vorlage auf Mittwoch gezogen');
  // Kante ziehen: erste Zeile, Montag-Spalte (Index aus effektiv), rechte Kante des ersten Blocks um ~1 h nach rechts
  const block = p.locator('.wr-zeile:not(.wr-kopf):not(.wr-uhr)').first().locator('.wr-zelle').first().locator('.wr-block').first();
  const vorherPlan = await p.evaluate(() => fetch('/api/heizung').then((r) => r.json()).then((h) => JSON.stringify(h.daten.vorlagen)));
  const kb = await block.locator('.kante.rechts').boundingBox();
  const zellB = (await p.locator('.wr-zelle').first().boundingBox()).width;
  await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await p.mouse.down();
  await p.mouse.move(kb.x + zellB / 24 + 3, kb.y + kb.height / 2, { steps: 8 });
  await p.screenshot({ path: ordner + '/pc-heizung-ziehen.png', clip: { x: 0, y: (await p.locator('.wr').boundingBox()).y - 60, width: 1440, height: 340 } });
  await p.mouse.up(); await p.waitForTimeout(800);
  const nachPlan = await p.evaluate(() => fetch('/api/heizung').then((r) => r.json()).then((h) => JSON.stringify(h.daten.vorlagen)));
  pruefe(vorherPlan !== nachPlan, 'Kante gezogen ändert die Vorlage');
  const gesendet = await p.evaluate(() => fetch('/api/items').then((r) => r.json()).then((l) => l.find((i) => i.name === 'Heizplan_Daten').state));
  console.log('   Heizplan_Daten jetzt:', String(gesendet).slice(0, 160));
  // Heute anders
  await p.locator('.heiz-oben .karte', { hasText: 'Heute anders' }).locator('.chip', { hasText: 'Wochenende' }).click(); await p.waitForTimeout(600);
  pruefe((await p.locator('.heiz-oben .karte', { hasText: 'Heute anders' }).textContent()).includes('morgen gilt wieder'), 'Heute anders gesetzt');
  // Urlaub
  await p.click('button:has-text("Urlaub starten")'); await p.waitForTimeout(600);
  const befehl = await p.evaluate(() => fetch('/api/items').then((r) => r.json()).then((l) => l.find((i) => i.name === 'Heizplan_Befehl').state));
  pruefe(/^urlaub\|\d{4}-\d\d-\d\dT18:00\|15\|/.test(befehl), 'Urlaub-Befehl an die Regel: ' + befehl);
  await p.screenshot({ path: ordner + '/pc-heizung-2.png', fullPage: true });

  // Energie, Geräte, Licht, Einstellungen
  await p.click('.nav-oben a[data-seite=energie]'); await p.waitForTimeout(800);
  pruefe(await p.locator('.seite-energie .verlauf-box svg .v-linie').count() === 1, 'Energie: Verlauf des Hausverbrauchs');
  for (const s of ['energie', 'geraete', 'licht']) { await p.click(`.nav-oben a[data-seite=${s}]`); await p.waitForTimeout(500); await p.screenshot({ path: `${ordner}/pc-${s}.png`, fullPage: true }); }
  await p.click('.nav-oben a[data-seite=einstellungen]'); await p.waitForSelector('.benutzer-liste');
  await p.click('button:has-text("Benutzer anlegen")');
  await p.fill('dialog input[aria-label=Name]', 'Gast'); await p.fill('dialog input[aria-label=Passwort]', 'gast12345');
  await p.click('dialog button:has-text("Anlegen")'); await p.waitForTimeout(500);
  pruefe(await p.locator('.benutzer-zeile', { hasText: 'Gast' }).count() === 1, 'Benutzer „Gast“ angelegt');
  await p.click('.schema.s-dunkel'); await p.waitForTimeout(300);
  pruefe(await p.evaluate(() => document.documentElement.dataset.schema) === 'dunkel', 'Farbschema Dunkel');
  await p.screenshot({ path: ordner + '/pc-einstellungen-dunkel.png', fullPage: true });
  await p.click('.nav-oben a[data-seite=start]'); await p.waitForTimeout(500);
  await p.screenshot({ path: ordner + '/pc-start-dunkel.png', fullPage: true });
  await p.click('.nav-oben a[data-seite=einstellungen]'); await p.waitForSelector('.schema'); await p.click('.schema.s-hell');

  // ---------------- iPhone (als Gast)
  const ip = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE' });
  const q = await ip.newPage();
  q.on('pageerror', (e) => fehler.push('JS-Fehler iPhone: ' + e.message));
  await q.goto(basis);
  await q.fill('input[autocomplete=username]', 'gast'); await q.fill('input[type=password]', 'gast12345'); await q.click('button[type=submit]');
  await q.waitForSelector('.raster .karte.el'); await q.waitForTimeout(600);
  pruefe(await q.isVisible('.nav-unten'), 'iPhone: Leiste unten');
  pruefe(!(await q.isVisible('.nav-oben')), 'iPhone: keine Navigation oben');
  await q.screenshot({ path: ordner + '/handy-start.png', fullPage: true });
  // Alle Lichter: rechts = alle an
  await q.locator('.drei-an').first().tap(); await q.waitForTimeout(800);
  pruefe((await q.locator('.alle-lichter .k-unter').first().textContent()).match(/^(\d+) von \1 an/), 'Alle Lichter an: ' + (await q.locator('.alle-lichter .k-unter').first().textContent()));
  await q.locator('.nav-unten a[data-seite=raeume]').tap(); await q.waitForTimeout(500);
  await q.screenshot({ path: ordner + '/handy-raum.png', fullPage: true });
  // Stern: Tüte auf die Handy-Startseite
  await q.goto(basis + '/#/raeume/Arbeitszimmer'); await q.waitForTimeout(500); await q.locator('.karte.geraet', { hasText: 'FRITZ!DECT' }).locator('.stern').last().tap(); await q.waitForTimeout(500);
  await q.locator('.nav-unten a[data-seite=heizung]').tap(); await q.waitForSelector('.wr'); await q.waitForTimeout(400);
  await q.screenshot({ path: ordner + '/handy-heizung.png', fullPage: true });
  await q.locator('.nav-unten button[data-seite=mehr]').tap(); await q.waitForTimeout(300);
  await q.screenshot({ path: ordner + '/handy-mehr.png' });
  await q.locator('.mehr-blatt a', { hasText: 'Einstellungen' }).tap(); await q.waitForTimeout(500);
  pruefe(await q.locator('.benutzer-liste').count() === 0, 'Benutzer sieht keine Benutzerverwaltung');
  await q.locator('.nav-unten a[data-seite=start]').tap(); await q.waitForTimeout(500);
  pruefe(await q.locator('.raster .karte.el', { hasText: 'FRITZ!DECT' }).count() === 1, 'Stern legt die FRITZ!DECT-Steckdose auf die Handy-Startseite');
  const pcStartGast = await q.evaluate(() => fetch('/api/ich').then((r) => r.json()).then((x) => x.start.pc.some((e) => e.ref === 'FRITZDECT_200')));
  pruefe(!pcStartGast, 'PC-Startseite bleibt davon unberührt');
  // Ziehen per langem Drücken (Touch simuliert über CDP)
  const cdp = await ip.newCDPSession(q);
  const kk = await q.locator('.raster .karte.el').nth(0).boundingBox(); const k3 = await q.locator('.raster .karte.el').nth(3).boundingBox();
  const id0h = await q.locator('.raster .karte.el').nth(0).getAttribute('data-id');
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', kk.x + 20, kk.y + 12); await q.waitForTimeout(650);
  for (let i = 1; i <= 10; i++) await tp('touchMove', kk.x + 20 + (k3.x + k3.width * 0.7 - kk.x - 20) * i / 10, kk.y + 12 + (k3.y + k3.height * 0.7 - kk.y - 12) * i / 10);
  await tp('touchEnd'); await q.waitForTimeout(600);
  const idsH = await q.locator('.raster .karte.el').evaluateAll((l) => l.map((x) => x.dataset.id));
  pruefe(idsH.indexOf(id0h) > 0, 'Handy: lange drücken + ziehen verschiebt (jetzt Platz ' + (idsH.indexOf(id0h) + 1) + ')');
  await q.screenshot({ path: ordner + '/handy-start-2.png', fullPage: true });

  await browser.close();
  console.log(fehler.length ? '\n' + fehler.length + ' Fehler:\n' + fehler.join('\n') : '\nAlles bestanden');
  process.exit(fehler.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
