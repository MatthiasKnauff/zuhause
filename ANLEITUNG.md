# Zuhause – Installation

Eigene Smart-Home-Oberfläche auf openHAB. Läuft als eigener Docker-Container, ohne Fremdpakete.
Die Heizung bleibt in openHAB (MAX!-Binding). Wochenplan und Urlaub schreibt die Regel `heizplan.js` direkt in die Thermostate. Darum läuft die Heizung auch weiter, wenn openHAB oder die App ausfallen.

## 1. Vorher: MAX!-Cube in openHAB prüfen

Zu Hause gehört der Cube openHAB (MAX!-Binding). Die Bridge muss in openHAB aktiv sein
(Einstellungen → Things → Cube). Die eigenständige MAX!-Heizungs-App läuft im Büro an einem
anderen Cube und hat damit nichts zu tun.

## 2. Heizplan-Regel aktualisieren (neu: Urlaub mit Enddatum)

1. Die beiliegende `heizplan/heizplan.js` ersetzt die alte Datei unter `conf/automation/js/heizplan.js`, an derselben Stelle wie bisher.
2. openHAB lädt sie von selbst neu.
3. Die Items `Heizplan_Daten`, `Heizplan_Status` und `Heizplan_Befehl` hast du schon, da ändert sich nichts.

## 3. API-Token in openHAB anlegen

1. In openHAB unten links auf dein Profil klicken, dann **API-Token anlegen**. Als Name passt z. B. `zuhause`.
2. Den Token kopieren. Er wird nur einmal angezeigt.

## 4. Über die Deploy-Automatik einrichten

1. In der Deploy-Automatik: **Neues Projekt**, Name `Zuhause`, Vorlage **Eigenes Programm (ZIP hochladen)**, diese ZIP auswählen.
2. Port im Container `8080`, Datenordner im Container `/daten`.
3. Testserver und Produktivserver wählen, Ports eintragen (z. B. Test `8035`, Produktiv `8034`).
   Beim Produktivserver als Domain `zuhause.knauff.info` – dann legt die App den Proxy-Host selbst an (Schritt 5 entfällt).
4. Umgebungsvariablen je Server:
   ```
   OPENHAB_URL=http://192.168.131.14:8080
   OPENHAB_TOKEN=<Token aus Schritt 3>
   ADMIN_BENUTZER=Matthias
   ADMIN_PASSWORT=<mindestens 8 Zeichen>
   ```
5. Danach: jeder Push → Testserver, jede Freigabe → Produktiv. Daten liegen in den Volumes `zuhause-test` und `zuhause-prod`.

**Testserver:** Er bedient dasselbe Haus wie die Produktivinstanz. Oben steht „Testserver – wird vX.Y.Z“.
Den Heizplan gibt er **nicht von selbst** an openHAB weiter (sonst würde er nachts mit seinen eigenen Vorlagen
den Plan der Produktivinstanz überschreiben). Was du dort von Hand änderst, wirkt aber wie gewohnt.

## 5. Von außen: zuhause.knauff.info

1. Im **Nginx Proxy Manager** einen neuen Proxy Host anlegen:
   - Domain: `zuhause.knauff.info`
   - Forward: `http` · Server-IP · Port `8034`
   - **Websockets Support** einschalten (für die Live-Anzeige)
2. Im Reiter SSL ein Let's-Encrypt-Zertifikat holen und **Force SSL** einschalten.
3. Beim Domain-Anbieter muss `zuhause` auf deine Adresse zeigen, so wie bei `openhab.knauff.info`.

Die Anmeldung schützt die App: 90 Tage angemeldet bleiben, nach 5 Fehlversuchen 15 Minuten Sperre. Hinter https wird das Cookie als „Secure“ gesetzt.

## 6. Aufs iPhone

`https://zuhause.knauff.info` in Safari öffnen, dann **Teilen → Zum Home-Bildschirm**. Die App startet danach ohne Browserleiste.

## Bedienung kurz

- **Startseite:** getrennt für PC und Handy, für jeden Benutzer eigene.
  - Am PC am Griff links ziehen, am Handy lange drücken und ziehen.
  - Die Ecke unten rechts ändert die Größe: klein, mittel, groß.
  - **×** nimmt ein Element weg.
  - Neue Elemente kommen am PC aus der Leiste rechts, am Handy über „Hinzufügen“, auf allen anderen Seiten über den **Stern**.
- **Räume:** entstehen automatisch aus dem openHAB-Modell. Ein neues Gerät erscheint ohne Einrichtung.
- **Licht:**
  - Farblampen haben sechs gedämpfte Lichtstimmungen.
  - Wenn eine Lampe Farben seltsam mischt: **Für diese Lampe abgleichen**. Die Lampe zeigt beim Schieben sofort, wie es aussieht, und der Abgleich gilt nur für sie.
- **Heizung:**
  - Vorlagen auf Wochentage ziehen.
  - In „Ganze Woche · alle Räume“ die Blockkanten mit der Maus ziehen.
  - **Heute anders** gilt nur heute.
  - Feiertage und Brückentage (Bundesland einstellbar, Standard NRW) laufen automatisch wie die Feiertags-Vorlage.
  - **Urlaub** schreibt ein Enddatum in die Thermostate; danach kehren sie von selbst zum Wochenplan zurück.
- **Benutzer:**
  - Admins legen Benutzer an.
  - Jeder Benutzer stellt Farbschema, Akzent, Nachtmodus und Schriftgröße selbst ein.

## Gut zu wissen

- Die App sendet den wirksamen Plan der nächsten 7 Tage an `Heizplan_Daten`, auch nachts beim Tageswechsel. Dann schreibt `heizplan.js` ihn in die Thermostate. Der Cube wird dafür kurz von openHAB getrennt, das ist normal.
- Hast du Gerätenamen und Räume noch nicht aufgeräumt, lohnt sich vorher `modell-aufraeumen.js` aus dem letzten Paket. Die App nutzt die Bezeichnungen aus openHAB.
- Daten liegen im Docker-Volume `zuhause-prod` (Test: `zuhause-test`): Benutzer, Startseiten, Vorlagen und Lampen-Abgleich.
