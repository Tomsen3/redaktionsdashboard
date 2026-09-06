# Funktionsstand

Stand: 6. September 2026 (aktualisiert nach Supabase-Anbindung)

## Implementiert

### Oberfläche

- Startseite/Übersicht im Corporate Design
- Redaktionsplan
- Kalenderansicht
- Aufgabenansicht
- Materialansicht
- responsive Desktop- und Mobilnavigation
- kombinierbare Filter nach Person, Zeit, Status und Format
- pastellige Statuskennzeichnungen, Konflikt- und Blockadehinweise
- Postingdichte mit Zielkorridor von zwei bis drei redaktionellen Postings pro Woche

### Redaktionslogik

- drei Steuerungsarten: terminbasiert, publikationsbasiert und ereignis-/materialabhängig
- automatische Postings aus Formatregeln
- automatische Aufgaben aus Aufgabenregeln
- relative Fälligkeiten
- Late-Entry-Regel ohne rückwirkliche Überfälligkeitslawine
- bedingtes Last-Call-Posting mit vorgelagerter Entscheidungsaufgabe
- automatische Anpassung relativer Aufgaben bei Postingverschiebung
- Konflikterkennung ab vier Postings pro Woche
- Materialblockaden
- Modul F und Schnupperkurs Modul F als verknüpfte Beispielanlässe
- Come Together im Schema als wiederholbare Sonderveranstaltung
- Tom als Standard für Inhalt, Grafik und Freigabe; Norbert für Ausspielung
- ein redaktionelles Posting mit getrennten Statuswerten für Instagram, Facebook und LinkedIn

### Aufgaben

- Aufgaben als erledigt markieren oder wieder öffnen
- Titel bearbeiten
- Fälligkeit bearbeiten
- Status bearbeiten
- Verantwortung zwischen Tom und Norbert übergeben
- Übergabe wirkt unmittelbar auf Liste und Personenfilter

### Datenbankvorbereitung

- SQL-Baseline für alle fachlichen Tabellen
- Fremdschlüssel, Prüfbedingungen und Standardwerte
- automatische `updated_at`-Trigger für zentrale Tabellen
- Seed-Daten für Formate, Postregeln, Aufgabenregeln, Modul F und Schnupperkurs Modul F
- RLS für alle Tabellen im `public`-Schema
- Teamzugriff über aktive Einträge in `app_members`
- keine Schreib- oder Leserechte für anonyme Besucher
- keine Löschrechte für normale Teammitglieder

### Prüfung

- automatisierter Test für Late Entry
- automatisierter Test für relative Fälligkeiten
- automatisierter Test für Postingdichte-Konflikte
- automatisierter Test für Aufgabenübergabe
- Produktionsbuild erfolgreich
- anwendungsspezifisches Linting erfolgreich

## Teilweise implementiert

- Material wird dargestellt und bewertet; bewusste Entscheidung (Tom, 06.09.2026): kein Datei-Upload, nur Links auf Canva/Drive/SharePoint – Storage-Buckets daher nicht vorgesehen.
- Kanalstatus sind im Schema modelliert (`post_channels`); die Oberfläche zeigt die Kanäle weiterhin nur statisch (IG/FB/LinkedIn-Punkte), speichert aber keine einzelnen Veröffentlichungsstände – bewusst zurückgestellt, da aktuell keine automatische Veröffentlichung stattfindet.
- WebMCP-Aktionen sind registriert, sofern die Browserumgebung die Schnittstelle unterstützt; sie sind nicht Voraussetzung für die normale Nutzung.
- Kalenderansicht zeigt jetzt den echten aktuellen Monat (vorher fest auf September 2026 verdrahtet), bleibt aber eine reine Anzeige ohne Navigation zu anderen Monaten.

## Real angebunden (06.09.2026)

- Supabase-Projekt `redaktionsdashboard` (eu-central-1, Free Tier, 0 €/Monat) angelegt, Schema eingespielt.
- Auth: einfache Magic-Link-Anmeldung (`supabase.auth.signInWithOtp`) vor der Oberfläche vorgeschaltet.
- `components/editorial-dashboard.tsx` liest Redaktionsanlässe, Posts, Aufgaben und Materialien direkt aus Supabase (`lib/supabase-client.ts`, `lib/data-mappers.ts`) statt aus lokalen Fixtures.
- Echtzeit-Synchronisierung über `postgres_changes`-Subscriptions auf allen vier Tabellen – Änderungen einer Person erscheinen ohne Neuladen bei der anderen.
- Konfliktbehandlung bei gleichzeitiger Bearbeitung: bewusst "Last write wins", keine Sperren/Merge-Logik (Tom-Entscheidung, 06.09.2026 – bei zwei Nutzern unnötige Komplexität).
- Audit-Log (`editorial_audit_log`) wird jetzt automatisch per Trigger auf `editorial_items`, `posts`, `tasks`, `materials` befüllt – als einfache Nachvollziehbarkeit statt komplexer Konfliktlösung.
- Tom ist als aktives Mitglied in `app_members` eingetragen; Norbert wird eingeladen, sobald das Dashboard produktiv geht.
- Erstbefüllung: Posting-/Aufgabenplan für die zwei vorhandenen Redaktionsanlässe (Modul F, Schnupperkurs Modul F) wurde einmalig mit der bestehenden `editorial-engine.mjs`-Logik berechnet und in `posts`/`tasks` persistiert. Neue Anlässe erzeugen aktuell noch **keine** automatischen Posts/Aufgaben (siehe "Noch offen").

## Noch offen

- Tom und Norbert vollständig als aktive `app_members` einrichten (Norbert fehlt noch, folgt bei Produktivstart)
- automatische Posting-/Aufgabenerzeugung beim Anlegen eines *neuen* Redaktionsanlasses (aktuell nur einmalig für die zwei Bestandsanlässe berechnet, keine Trigger-/App-Logik für künftige Anlässe)
- RLS-Integrationstests mit getrennten Rollen/Benutzern ausführen
- funktionale Anlage und Detailansicht eines Redaktionsanlasses (Formular fehlt weiterhin)
- funktionale Verwaltung von Formaten und Regeln
- Archivansicht
- echte Canva-, Homepage-, Medien- und Social-Media-Verknüpfungen
- kanalbezogene Planung, Veröffentlichung und Fehlerbehandlung persistieren
- globale Lint-Meldungen in unveränderten UI-Katalogdateien bereinigen oder gezielt ausschließen
- ~~Umbau auf reinen statischen Build für GitHub-Pages-Hosting~~ erledigt (06.09.2026): reines Vite-React-Setup, kein Next.js/Cloudflare-Worker mehr; Deployment auf GitHub Pages und Einrichtung der Subdomain stehen noch aus (siehe DEPLOYMENT.md)
- Deployment (GitHub Pages) und Subdomain-Einrichtung über Wix-DNS (analog zu chat.singende-krankenhaeuser.de)

## Wichtig für die Übergabe

Der ausgelieferte Stand ist ein echtes Mehrbenutzersystem mit persistenter Datenhaltung und Echtzeit-Synchronisierung über Supabase. Änderungen bleiben nach Neuladen erhalten. Nicht produktionsfertig ist weiterhin: das Erzeugen automatischer Posts/Aufgaben bei *neuen* Redaktionsanlässen (nur für die zwei Bestandsanlässe einmalig erledigt) sowie das Hosting/die Subdomain (Code ist GitHub-Pages-fertig, Deployment und DNS-Einrichtung von redaktion.singende-krankenhaeuser.de stehen noch aus, siehe DEPLOYMENT.md).
