# performa — Benutzerhandbuch

[English](user-manual.en.md) · Deutsch

performa ist eine kleine Desktop-App (macOS + Windows) zum Erfassen deiner Arbeitszeiten auf Jira-Cloud-Vorgängen — mit Timer, Wochen-Timesheet, Erinnerungen an vergessene Worklogs und einem Dashboard.

## Inhalt

- [Was ist performa?](#was-ist-performa)
- [Erste Schritte](#erste-schritte)
- [Die Oberfläche im Überblick](#die-oberfläche-im-überblick)
- [Start-Tab (Dashboard)](#start-tab-dashboard)
- [Arbeit erfassen](#arbeit-erfassen)
- [Der Timer](#der-timer)
- [System-Tray / Menüleiste](#system-tray--menüleiste)
- [Timesheet](#timesheet)
- [Missing Worklogs](#missing-worklogs)
- [Vorlagen](#vorlagen)
- [Einstellungen](#einstellungen)
- [Schutz beim Beenden](#schutz-beim-beenden)
- [Updates](#updates)
- [Daten & Datenschutz](#daten--datenschutz)
- [Problemlösung & FAQ](#problemlösung--faq)

## Was ist performa?

performa spricht direkt mit deiner Jira-Cloud-Site und schreibt **native Jira-Worklogs**. Weil die Einträge in Jira selbst landen, erscheinen sie automatisch in jedem Tool, das Jira-Worklogs abbildet — auch in **ActivityTimeline**.

Zwei Grundprinzipien, die du kennen solltest:

- **Dein API-Token erreicht nie die Web-Ebene.** Die gesamte Jira-Kommunikation läuft im nativen (Rust-)Kern der App; das Token liegt im Anmeldespeicher des Betriebssystems (macOS-Schlüsselbund / Windows-Anmeldeinformationsverwaltung), nicht in einer Konfigurationsdatei.
- **Abrechenbar als Standard.** Ein als *non-billable* markiertes Worklog wird mit einem führenden `~` im Jira-Kommentar gespeichert — die ActivityTimeline-Konvention —, sodass die Einordnung den Weg durch Jira übersteht.

## Erste Schritte

### Installation

Lade das aktuelle Release von der GitHub-Releases-Seite des Projekts herunter:

- **macOS**: `.dmg` (Builds für Apple Silicon und Intel)
- **Windows**: `.msi`- oder `.exe`-Installer

### Mit Jira verbinden

Beim ersten Start zeigt performa den Verbindungsbildschirm. Du brauchst drei Dinge:

| Feld | Was du einträgst |
| --- | --- |
| **Jira site** | Dein Jira-Cloud-Host, z. B. `dein-team.atlassian.net` (mit oder ohne `https://`) |
| **Email** | Die E-Mail-Adresse deines Atlassian-Kontos |
| **API token** | Ein persönliches Atlassian-API-Token |

Klicke auf **Create an API token ↗** im Verbindungsbildschirm (oder öffne [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)), erstelle ein Token und füge es in das Feld ein.

Mit **Connect** prüft performa die Zugangsdaten gegen Jira, bevor sie gespeichert werden — ein Tippfehler in Site oder Token führt zu einer Fehlermeldung statt zu einer kaputten Einrichtung. Bei Erfolg wandert das Token in den Schlüsselbund des Betriebssystems und das Hauptfenster öffnet sich.

> Falls die App den Schlüsselbund beim Start einmal nicht lesen kann, zeigt sie den Fehler mit einem **Retry**-Button an, statt bei „Loading…“ hängen zu bleiben.

## Die Oberfläche im Überblick

Das Hauptfenster besteht aus:

- **Kopfzeile** — das performa-Zeichen, deine Konto-E-Mail, ein **Settings**-Link und **Sign out** (fragt nach Bestätigung; beim Abmelden wird das Token aus dem Schlüsselbund entfernt).
- **Update-Banner** — erscheint nur, wenn ein neueres Release existiert ([Updates](#updates)).
- **Timer-Leiste** — erscheint nur, während ein Timer läuft ([Der Timer](#der-timer)).
- **Vier Tabs**: **Start**, **Log work**, **Timesheet**, **Missing worklog**. Die App öffnet sich auf **Start**.

## Start-Tab (Dashboard)

Der Start-Tab ist die Startseite und zeigt vier Bereiche. Bereiche ohne Inhalt werden ausgeblendet.

### Due dates (Fälligkeiten)

Vorgänge, die **dir zugewiesen** sind und deren Fälligkeitsdatum zwischen **vor 7 Tagen und in 14 Tagen** liegt, das nächstliegende zuerst. Vorgänge in einer *Done*-Statuskategorie sind ausgenommen — ein überfälliger Vorgang erscheint hier also nur, solange er noch offen ist.

Jeder Vorgang trägt ein Fälligkeits-Badge:

- **overdue** (rote Umrandung) — das Fälligkeitsdatum ist überschritten
- **today** (hervorgehoben) — heute fällig
- **due …** (neutral) — bevorstehend, mit Wochentag und Datum

Die Zeilen sind voll ausgestattete Vorgangszeilen:

- **☆ / ★** pinnt den Vorgang an den Anfang der Log-work-Liste ([Arbeit erfassen](#arbeit-erfassen))
- Ein Klick auf den **Vorgangsschlüssel** öffnet den Vorgang im Browser
- Ein Klick auf die **Zusammenfassung** springt zum Log-work-Tab mit bereits geöffnetem Erfassungsformular für diesen Vorgang
- **▶ start** startet einen Timer für den Vorgang

### This week (Diese Woche)

Dieselben Diagramme wie die aktuelle Woche im Timesheet: Tagesbalken gegen dein Tagesziel und ein Fortschrittsring gegen das Wochenziel, dazu die bisher erfasste Gesamtzeit. Der Bereich aktualisiert sich automatisch, sobald du Arbeit erfasst.

### Templates (Vorlagen)

Deine gespeicherten Worklog-Vorlagen als Ein-Klick-Chips — siehe [Vorlagen](#vorlagen). Ausgeblendet, solange du keine hast.

### Missing worklogs

Eine Vorschau der aktuellen Funde des Worklog-Wächters. Ein Klick auf einen Eintrag (oder **Open tab**) springt zum Missing-worklog-Tab. Ausgeblendet, wenn nichts fehlt.

## Arbeit erfassen

Der Tab **Log work** ist ein zweistufiger Ablauf: Vorgang finden, dann das Worklog ausfüllen.

### Einen Vorgang finden

Das Suchfeld interpretiert deine Eingabe auf drei Arten:

| Eingabe | Verhalten |
| --- | --- |
| *(leer)* | Deine offenen Vorgänge (dir zugewiesen, nicht Done), zuletzt aktualisierte zuerst |
| Ein Vorgangsschlüssel wie `ABC-123` | Exakte Suche nach genau diesem Vorgang |
| Beliebiger anderer Text | Volltextsuche über Zusammenfassungen und Inhalte |

Die Ergebnisse aktualisieren sich beim Tippen (mit kurzer Verzögerung). Die Anfrage wird im nativen Kern der App in JQL übersetzt — du musst nie selbst JQL schreiben.

**Gepinnte Vorgänge** (★) stehen immer oben in der Standardliste, abgetrennt durch eine kräftigere Linie. Pinne oder entpinne jeden Vorgang über den Stern in seiner Zeile; Pins werden lokal auf deinem Rechner gespeichert. Während einer aktiven Textsuche werden stattdessen die reinen Suchergebnisse angezeigt.

Jede Ergebniszeile bietet dieselben Aktionen wie auf dem Dashboard: im Browser öffnen (Schlüssel), auswählen (Zusammenfassung), pinnen (Stern) und Timer starten (▶).

### Das Worklog-Formular

Nach Auswahl eines Vorgangs füllst du aus:

- **Time spent** — Dauer in Jira-Syntax:

  | Eingabe | Bedeutung |
  | --- | --- |
  | `1h 30m` | 1 Stunde 30 Minuten |
  | `45m` | 45 Minuten |
  | `2h` | 2 Stunden |
  | `1d` | 1 Arbeitstag = 8 Stunden |
  | `1w` | 1 Arbeitswoche = 5 Tage |
  | `1.5h` oder `0,25h` | Dezimalzahlen mit Punkt oder Komma |
  | `2` | Eine nackte Zahl zählt als Stunden |

  Ein Live-Hinweis unter dem Feld zeigt, wie die Eingabe verstanden wurde (z. B. `= 1h 30m`).

- **Date** — vorbelegt mit heute; Daten in der Zukunft sind nicht erlaubt.
- **Start time** — vorbelegt mit der aktuellen Uhrzeit.
- **Comment** *(optional)* — wird als Jira-Worklog-Kommentar gespeichert.
- **Non-billable** — markiert den Eintrag als nicht abrechenbar (gespeichert als führendes `~` im Jira-Kommentar; siehe [Was ist performa?](#was-ist-performa)). Die Checkbox wird bei jedem neu ausgewählten Vorgang zurückgesetzt, damit die Abrechenbarkeit nie vom vorherigen Eintrag „durchsickert“.

Mit **Log work** speicherst du. Eine Erfolgsmeldung bestätigt den Eintrag, und das Formular leert sich für den nächsten.

### My logged time (Meine erfasste Zeit)

Unter dem Formular zeigt die Historie **deine** bisherigen Worklogs auf diesem Vorgang (die 10 neuesten plus deine Gesamtsumme). Sie aktualisiert sich sofort nach dem Erfassen.

## Der Timer

Starte einen Timer mit dem **▶ start**-Button in jeder Vorgangszeile (Start-Tab oder Log-work-Tab). Es kann nur ein Timer gleichzeitig laufen — die übrigen Start-Buttons sind währenddessen deaktiviert.

Während er läuft:

- Die **Timer-Leiste** über den Tabs zeigt den Vorgang und eine laufende Uhr.
- Das [System-Tray](#system-tray--menüleiste) spiegelt den Timer.

Mit **Stop** (in der Timer-Leiste oder im Tray) beendest du ihn. Das Erfassungsfenster öffnet sich mit:

- **Time spent**, vorbelegt mit der verstrichenen Zeit, **aufgerundet auf die nächsten 15 Minuten** (mindestens 15 Minuten) — vor dem Speichern frei änderbar.
- **Datum und Startzeit**, vorbelegt mit dem Start des Timers.

Du kannst das Worklog vervollständigen (Kommentar, Abrechenbarkeit) und speichern — oder die erfasste Zeit mit **Discard** verwerfen; das Verwerfen fragt nach Bestätigung, weil die Zeit sonst verloren wäre.

> Der Timer basiert auf der Uhrzeit (Wanduhr) und überlebt App-Neustarts: Beendest du die App mit laufendem Timer (siehe [Schutz beim Beenden](#schutz-beim-beenden)) und öffnest sie später wieder, läuft der Timer mit der korrekten Gesamtzeit weiter.

## System-Tray / Menüleiste

performa legt ein Symbol in die macOS-Menüleiste bzw. das Windows-System-Tray:

- **macOS**: Während ein Timer läuft, erscheint eine Live-Anzeige neben dem Symbol — `▶ ABC-123 12:34` (Stunden:Minuten:Sekunden ab einer Stunde).
- **Windows**: Tray-Symbole können keinen Text anzeigen; dieselbe Anzeige erscheint deshalb als **Tooltip beim Überfahren** des Symbols. Alles andere funktioniert identisch.

Das Tray-Menü bietet:

- **Stop timer…** *(nur aktiv, während ein Timer läuft)* — holt das Fenster in den Vordergrund und öffnet das reguläre Erfassungsfenster
- **Open performa** — zeigt und fokussiert das Fenster
- **Quit performa** — beendet die App; das läuft über den normalen Schließen-Pfad, der [Schutz beim Beenden](#schutz-beim-beenden) greift also weiterhin

## Timesheet

Der Tab **Timesheet** zeigt jeweils eine Woche.

- Navigiere mit **← / →**; die aktuelle Woche ist die rechteste erreichbare (keine zukünftigen Wochen). Die Beschriftung zeigt „This week“, „Last week“ oder den Datumsbereich.
- **Diagramme**: Tagesbalken gemessen an deinem Tagesziel (eine Linie markiert das Ziel) und ein Ring mit dem Wochenfortschritt gegen das Wochenziel (Tagesstunden × 5 Arbeitstage). Samstag/Sonntag sind standardmäßig ausgeblendet, erscheinen aber automatisch, sobald dort Zeit erfasst ist — oder dauerhaft, wenn du die [Einstellung](#einstellungen) auf die volle Woche stellst.
- Darunter sind die Worklogs nach Tagen gruppiert (neuester Tag zuerst) mit Tagessummen. Jede Zeile zeigt Vorgangsschlüssel (Klick → Browser), Zusammenfassung, Kommentar, Startzeit, Dauer und ggf. ein `non-billable`-Kennzeichen.

Aktionen pro Zeile:

- **↻ Log again today** — öffnet ein vorbefülltes Formular (gleicher Vorgang, Dauer, Kommentar, Abrechenbarkeit) mit **heutigem Datum und aktueller Uhrzeit**: ideal für wiederkehrende Einträge. Das Fenster bietet zusätzlich **Save as template** ([Vorlagen](#vorlagen)).
- **✎ Edit** — jedes Feld des bestehenden Worklogs ändern (Dauer, Datum, Uhrzeit, Kommentar, Abrechenbarkeit).
- **🗑 Delete** — löscht das Worklog nach einer zweiten Inline-Bestätigung (✓ / ✕).

## Missing Worklogs

Der Tab **Missing worklog** ist ein Sicherheitsnetz gegen vergessene Zeiteinträge.

**Was er meldet:** Vorgänge, auf denen **du** in den **letzten 24 Stunden** kommentiert oder den Status geändert hast, ohne dass in **etwa ±3 Stunden** um diese Aktivität ein Worklog existiert. Aktivität der letzten 10 Minuten wird noch nicht gemeldet (Karenzzeit — vielleicht hast du sie einfach *noch* nicht erfasst). Die Prüfung läuft automatisch **alle 2 Minuten**, solange du angemeldet bist; **Check now** stößt sie manuell an, und der Tab zeigt den Zeitpunkt der letzten Prüfung.

Jeder Fund zeigt:

- den Vorgang und was du getan hast — ein zitierter Kommentarauszug oder die Statusänderung (`Alt → Neu`), mit Zeitangabe
- eine Zähler-Markierung am Tab; der Tab **blinkt, bis du ihn ansiehst** (das Ansehen bestätigt die aktuellen Funde)
- eine **Desktop-Benachrichtigung**, **einmal pro Fund** ([siehe FAQ](#problemlösung--faq), falls du keine Benachrichtigungen siehst)

Ein Klick auf einen Fund öffnet ein Inline-Erfassungsformular, vorbelegt mit **Datum und Uhrzeit der gemeldeten Aktivität** — das entstehende Worklog deckt sie ab, und die Erinnerung verschwindet bei der nächsten Prüfung.

> **Eskalationsvorgänge:** Bei Vorgängen im Projekt `DEV` wird die Zeit stattdessen auf dem **verknüpften Ursprungsvorgang** erfasst (dem Vorgang mit der Verknüpfung „is an escalation for“). Das Formular zeigt beide Vorgänge, damit immer klar ist, wohin die Zeit geht.

## Vorlagen

Vorlagen machen wiederkehrende Einträge (Daily Standup, Support-Dienst, …) zur Ein-Klick-Sache.

- **Erstellen:** Drücke im Timesheet **↻** an einem Worklog und hake **Save as template on the start tab** an, bevor du erfasst. Die Vorlage speichert Vorgang, Dauer, Kommentar und Abrechenbarkeit.
- **Verwenden:** Klicke auf dem Start-Tab auf einen Vorlagen-Chip. Das Erfassungsformular öffnet sich vorbefüllt — mit heutigem Datum und aktueller Uhrzeit —, und eine Bestätigung erfasst den Eintrag.
- **Entfernen:** Das **✕** an jedem Chip löscht die Vorlage.

Vorlagen werden lokal auf deinem Rechner gespeichert, nicht in Jira.

## Einstellungen

Der **Settings**-Link in der Kopfzeile öffnet denselben Bildschirm wie bei der ersten Verbindung:

- **Appearance** — heller / dunkler Modus.
- **Daily work hours** — 0,5–24 h; daraus ergeben sich die Tagesziel-Linie und, × 5, der Wochenziel-Ring in den Diagrammen.
- **Timesheet days** — **Mon–Fri** (Wochenenden ausgeblendet, außer sie enthalten erfasste Zeit) oder **Full week**.
- **Zugangsdaten** — Site, E-Mail oder Token ändern. Bleibt das Token-Feld leer, wird das gespeicherte Token beibehalten — du musst es also nicht neu eingeben, um z. B. einen Tippfehler in der E-Mail zu korrigieren. Beim Speichern wird erneut gegen Jira geprüft.

Appearance, Stunden und die Wochenend-Einstellung wirken **sofort** als Live-Vorschau — **Cancel** stellt die Werte vom Öffnen des Bildschirms wieder her.

**Sign out** (in der Kopfzeile, mit Bestätigung) löscht das Token aus dem Schlüsselbund des Betriebssystems und kehrt zum Verbindungsbildschirm zurück.

## Schutz beim Beenden

Beim Beenden mit unerledigten Dingen erscheint eine Warnung, statt still Daten zu verlieren:

- **Timer läuft noch** — zeigt Vorgang und verstrichene Zeit; stoppe den Timer, um sie zu erfassen, oder wähle **Quit anyway**, um die Zeit zu verwerfen.
- **Unerfasste Arbeit offen** — im Missing-worklog-Tab warten Funde; geh zurück und erfasse sie, oder wähle **Quit anyway**.

Das gilt gleichermaßen für den Schließen-Button des Fensters und für **Quit performa** im Tray-Menü.

## Updates

performa prüft **stündlich** auf ein neueres Release auf GitHub. Gibt es eins, erscheint ein Banner mit:

- **Update & restart** — lädt das Update mit Fortschrittsanzeige herunter, installiert es und startet die App neu
- **Release notes** — öffnet die Release-Seite im Browser
- **✕** — blendet das Banner **für diese Version** aus; das nächste Release bringt es zurück

## Daten & Datenschutz

| Daten | Wo sie liegen |
| --- | --- |
| API-Token | Schlüsselbund des Betriebssystems (macOS-Schlüsselbund / Windows-Anmeldeinformationsverwaltung) |
| Site & E-Mail | Zusammen mit dem Token im Schlüsselbund-Eintrag |
| Worklogs | In Jira — performa speichert keine Kopie |
| Pins, Vorlagen, Einstellungen (Theme, Stunden, Wochenenden) | Lokal im Speicher der App |
| Timer-Zustand, Gesehen-/Benachrichtigt-Markierungen, ausgeblendete Update-Version | Lokal im Speicher der App |

performa kommuniziert **ausschließlich** mit deiner Jira-Cloud-Site (alle Worklog-Operationen) und GitHub (Update-Prüfung). Es gibt keine Telemetrie.

## Problemlösung & FAQ

**„Jira returned 401/403“ beim Verbinden oder Erfassen.**
Token, E-Mail oder Site sind falsch, oder das Token wurde widerrufen. Erstelle ein neues API-Token und trage es in den Einstellungen ein (für Korrekturen an Site/E-Mail musst du kein gültiges Token neu eingeben).

**Ich bekomme keine Desktop-Benachrichtigungen.**
Die erste Benachrichtigung löst die Berechtigungsabfrage des Betriebssystems aus — wurde sie abgelehnt, erlaube Benachrichtigungen für performa in den Systemeinstellungen (macOS: Systemeinstellungen → Mitteilungen). Beachte, dass unsignierte Entwicklungs-Builds unter einer anderen App-Identität erscheinen können als die paketierte App.

**Wo ist die Tray-Uhr unter Windows?**
Windows-Tray-Symbole können keinen Text neben dem Symbol anzeigen (eine Plattform-Beschränkung). Fahre mit der Maus über das performa-Symbol, um den laufenden Timer im Tooltip zu sehen; alle Menü-Aktionen funktionieren normal.

**Erscheinen meine Worklogs in ActivityTimeline?**
Ja. performa schreibt native Jira-Worklogs, die ActivityTimeline automatisch übernimmt. Die Nicht-abrechenbar-Markierung (`~`-Präfix im Kommentar) folgt ActivityTimelines eigener Konvention.

**Die App zeigt „Could not read stored credentials“.**
Der Schlüsselbund des Betriebssystems konnte nicht gelesen werden (z. B. weil er gesperrt war). Entsperre den Schlüsselbund bzw. melde dich am System an und drücke **Retry**.

**Kann ich Zeit in der Zukunft erfassen?**
Nein — das Datumsfeld ist auf heute begrenzt.

**Können zwei Timer gleichzeitig laufen?**
Nein. Stoppe zuerst den laufenden Timer; alle anderen Start-Buttons sind währenddessen deaktiviert.
