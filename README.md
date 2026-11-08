# Sterne versenken

Schiffe versenken im Weltall – für zwei Spieler, direkt von Handy zu Handy.
Kein Server, keine Cloud, kein Internet nötig.

## Spielmodi

| Modus | Beschreibung |
| --- | --- |
| **Spiel eröffnen / beitreten** | Zwei Android-Handys verbinden sich direkt über Bluetooth und WLAN (Google Nearby Connections). Ein Handy eröffnet, das andere tritt bei. |
| **Ein Gerät** | Zu zweit auf einem Handy, das Gerät wird nach jedem Zug weitergegeben. Die Flotten bleiben verdeckt. |
| **Training** | Gegen den Computer in drei Stufen (Kadett, Kommandant, Admiral). |

Flotte: Flaggschiff (5), Schlachtkreuzer (4), Fregatte (3), Korvette (3), Jägerstaffel (2) auf einem 10×10-Feld.

Regeln (einstellbar, der eröffnende Spieler entscheidet):

- **Nach Treffer nochmals schiessen** (Standard: an)
- **Schiffe dürfen sich berühren** (Standard: aus – dann bleibt rund um jedes Schiff ein Feld frei)

## Installieren

Jeder Push baut per GitHub Actions eine APK (`.github/workflows/android.yml`).

- **Neueste Version von `main`:** unter *Releases → latest* die Datei `sterneversenken.apk` herunterladen.
- **Andere Branches:** im Actions-Lauf unter *Artifacts → sterneversenken-apk* herunterladen und entpacken.

Auf dem Handy „Installation aus unbekannten Quellen“ erlauben und die APK öffnen.
Beim ersten Spiel mit zwei Handys fragt die App nach den Berechtigungen **Standort** und
**Geräte in der Nähe**. Google Nearby braucht beide, auch auf neuen Android-Versionen.
Fehlt eine, zeigt die App an, welche, und öffnet auf Wunsch direkt die Einstellungen.

### Updates

Die App sucht beim Start auf GitHub nach einer neueren Version (Release `latest`, Datei `version.json`).
Gibt es eine, erscheint im Menü „Update verfügbar“. Ein Tipp lädt die APK herunter und öffnet den
Android-Installer. Beim ersten Mal fragt Android, ob die App „Unbekannte Apps installieren“ darf.
Von Hand: *Einstellungen → App → Nach Updates suchen*. Fürs Spielen selbst braucht die App kein Internet.

Alle Builds sind mit demselben Sideload-Schlüssel (`app/sideload.jks`) signiert. So lassen sich neue
Versionen einfach über die alte installieren. Der Schlüssel ist bewusst öffentlich und nur fürs
direkte Installieren gedacht – für den Play Store bräuchte es einen eigenen, geheimen Schlüssel.

Voraussetzungen: Android 8 oder neuer, Google-Play-Dienste (für das Spiel mit zwei Handys).

## Aufbau

```
web/                 Das Spiel (HTML/CSS/JS, ohne Build-Schritt)
  js/engine.js       Regeln, Flotte, Zugreihenfolge
  js/ai.js           Computergegner
  js/netgame.js      Protokoll zwischen zwei Geräten (inkl. Wiederverbinden)
  js/net.js          Transport: Android-Nearby oder Browser-Simulation
  js/main.js         Bildschirme und Spielabläufe
app/                 Android-Hülle: WebView, Nearby-Brücke und Updater (Kotlin)
tests/               Tests für Spiellogik, KI und Protokoll (node --test)
```

Die Android-App lädt `web/` als Assets in eine WebView. Die Verbindung läuft über
`NearbyBridge.kt`: Ein Gerät macht sich sichtbar, das andere sucht und verbindet sich. Jedes Gerät kennt nur
die eigene Flotte; Schüsse und Ergebnisse gehen als kleine JSON-Nachrichten hin und her. Wer am Zug ist,
wird aus dem Schussverlauf berechnet. Deshalb geht eine Partie nach einem Verbindungsabbruch nahtlos
weiter. Nach Spielende legen beide Geräte ihre Aufstellung offen, und die App prüft, ob alle Meldungen
ehrlich waren.

## Entwickeln

```sh
npm test                 # Spiellogik, KI und Protokoll testen
npm run serve            # Spiel im Browser: http://localhost:8080
```

Im Browser gehen „Ein Gerät“ und „Training“. Das Netzwerkspiel lässt sich mit zwei Tabs simulieren:
`http://localhost:8080/?sim` in zwei Tabs öffnen, in einem „Spiel eröffnen“, im anderen „Spiel beitreten“.

APK lokal bauen (Android SDK nötig, z. B. über Android Studio):

```sh
./gradlew assembleRelease
```

Schiffsnamen und -grössen stehen zentral in `web/js/engine.js` (`FLEET`), die Grafiken in `web/js/ships.js`.

## Schriften

Orbitron und Share Tech Mono, beide unter der SIL Open Font License (siehe `web/fonts/`).
