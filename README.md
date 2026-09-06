# Redaktionsdashboard

Übertragbarer Quellcode der aktuellen Redaktionsdashboard-Version für Singende Krankenhäuser e. V.

Die Anwendung enthält die fünf Ansichten Übersicht, Redaktionsplan, Kalender, Aufgaben und Materialien. Die fachliche Termin- und Aufgabenlogik ist implementiert und getestet. Seit dem 06.09.2026 ist die Anwendung an ein echtes Supabase-Projekt angebunden: Daten werden persistent gehalten, Änderungen werden per Echtzeit-Synchronisierung zwischen angemeldeten Teammitgliedern abgeglichen. Anmeldung erfolgt per Magic Link (E-Mail).

## Voraussetzungen

- Node.js 22.13 oder neuer
- npm (wird zusammen mit Node.js installiert)
- optional: ein Supabase-Projekt für die spätere persistente Datenhaltung

## Installation

```bash
npm ci
```

Konfigurationsvorlage kopieren und mit den Supabase-Projektdaten befüllen (URL und Publishable Key, siehe Supabase-Dashboard → Project Settings → API):

```bash
cp .env.example .env.local
```

Ohne gültige `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` startet die Anwendung zwar, kann aber keine Daten laden und keine Anmeldung durchführen.

## Entwicklung starten

```bash
npm run dev
```

Die ausgegebene lokale Adresse im Browser öffnen.

## Tests und Qualitätsprüfung

```bash
npm test
npm run build
```

Optional:

```bash
npm run lint
npm run format
```

Der vollständige globale Lint-Lauf kann derzeit noch Meldungen aus unveränderten, mitgelieferten UI-Katalogdateien enthalten. Die anwendungsspezifischen Dateien wurden separat geprüft.

## Produktionsstart

Zuerst bauen, das Ergebnis liegt danach in `dist/` und kann lokal geprüft werden:

```bash
npm run build
npm run preview
```

Für das eigentliche Deployment auf GitHub Pages siehe [DEPLOYMENT.md](DEPLOYMENT.md).

## Supabase – aktueller Stand

Bereits erledigt (06.09.2026): Projekt `redaktionsdashboard` angelegt, `supabase/schema.sql` eingespielt, Tom als aktives Mitglied in `public.app_members` eingetragen, Oberfläche liest/schreibt echte Daten, Echtzeit-Synchronisierung aktiv, Audit-Log-Trigger eingerichtet.

Für ein neues/anderes Supabase-Projekt (z. B. bei einem Umzug) gilt weiterhin:

1. Ein leeres Supabase-Projekt anlegen.
2. `supabase/schema.sql` im SQL Editor ausführen.
3. Auth-Konten für die Teammitglieder per Magic Link (Anmeldemaske der Anwendung) oder im Supabase-Dashboard anlegen.
4. Die betreffenden Benutzer-UUIDs über einen vertrauenswürdigen Admin-Prozess in `public.app_members` eintragen.
5. `.env.local` anhand von `.env.example` mit der neuen Projekt-URL und dem Publishable Key ergänzen.

Noch offen: Norbert als zweites `app_members`-Mitglied eintragen, sobald das Dashboard produktiv geht (siehe FUNKTIONSSTAND.md).

## Projektaufbau

- `index.html` / `src/main.tsx` – Vite-Einstiegspunkt (mountet die Dashboard-Komponente)
- `app/globals.css` – globale Styles und Designsystem (Name historisch bedingt, keine Next.js-Abhängigkeit mehr)
- `app/webmcp.d.ts` – Typdeklaration für die optionale WebMCP-Anbindung
- `components/` – Dashboard-Oberfläche und UI-Bausteine
- `lib/` – fachliche Posting- und Aufgabenlogik sowie der Supabase-Client
- `public/` – Logo, Bildmaterial und Favicon (werden 1:1 in den Build übernommen)
- `tests/` – automatisierte Tests der Redaktionslogik
- `supabase/schema.sql` – vollständige Baseline mit Tabellen, Seeds, Triggern, Rechten und RLS-Policies
- `.github/workflows/deploy.yml` – GitHub-Actions-Workflow für den automatischen Pages-Deploy

Weitere Dokumentation:

- [ARCHITEKTUR.md](ARCHITEKTUR.md)
- [FUNKTIONSSTAND.md](FUNKTIONSSTAND.md)
- [SUPABASE.md](SUPABASE.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)

## Weitergabe

Das Quellcode-ZIP enthält keine Abhängigkeiten, Build-Ausgaben, lokalen Caches, Git-Historie oder Zugangsdaten. Nach dem Entpacken genügt `npm ci`, um die exakt im Lockfile festgelegten Abhängigkeiten zu installieren.
