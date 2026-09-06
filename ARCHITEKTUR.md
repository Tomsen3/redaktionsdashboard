# Architektur des Redaktionsdashboards

## Überblick

Das Dashboard ist eine rein clientseitige React-Anwendung auf Basis von Vite. Persistente Datenhaltung, Auth und Echtzeit-Synchronisierung laufen über Supabase (siehe SUPABASE.md und FUNKTIONSSTAND.md für den aktuellen Anbindungsstand).

```text
Browser
  └─ React-Dashboard
      ├─ Ansichten und Interaktionen
      ├─ lokale Beispieldaten / React State
      └─ Redaktionslogik in lib/editorial-engine.mjs

Vorbereitet, noch nicht verbunden
  └─ Supabase
      ├─ Auth
      ├─ PostgreSQL + RLS
      └─ optional Storage
```

## Frontend

### Laufzeit und Build

- React 19
- TypeScript/TSX
- Reines Vite-Setup (kein Next.js/Vinext, keine React Server Components, kein Cloudflare-Worker)
- Statischer Produktionsbuild (`npm run build` erzeugt `dist/`, ausrollbar auf jedem einfachen Static-Hosting wie GitHub Pages)
- Tailwind CSS 4 und projektbezogene globale Styles
- Shadcn/Base UI für zugängliche Bedienelemente
- Lucide Icons

Der Einstieg erfolgt über `index.html` und `src/main.tsx`. Die vollständige Dashboard-Oberfläche liegt in `components/editorial-dashboard.tsx`; das gemeinsame Designsystem befindet sich weiterhin in `app/globals.css` (Pfad historisch bedingt).

### Zustandsmodell

Die aktuelle Anwendung lädt keine Daten von einem Backend. Redaktionsanlässe, Regeln und Materialien werden in `components/editorial-dashboard.tsx` als Fixtures definiert. Posts und Aufgaben werden beim Laden über `seedData()` und die Funktionen aus `lib/editorial-engine.mjs` erzeugt.

Änderungen wie Aufgabenübergabe, Statuswechsel, Terminänderung und Konfliktauflösung leben ausschließlich im React State. Ein Neuladen des Browsers setzt sie zurück.

### Fachliche Logik

`lib/editorial-engine.mjs` kapselt die unabhängig testbare Domänenlogik:

- Berechnung termin-, publikations- und materialabhängiger Postingtermine
- relative Aufgabenfristen
- Late-Entry-Regel
- bedingte Postings mit Entscheidungsaufgabe
- Verschiebung von Aufgaben zusammen mit einem Posting
- Postingdichte pro Kalenderwoche
- Materialblockaden
- kombinierbare Filter
- Übergabe einer Aufgabe zwischen Tom und Norbert

Instagram, Facebook und LinkedIn sind Kanalzustände eines einzigen redaktionellen Postings und keine drei getrennten redaktionellen Posts.

### Ansichten

- Übersicht mit Kennzahlen, Hinweisen, Aufgaben und Postingdichte
- Redaktionsplan
- Kalender
- Aufgaben inklusive Bearbeitungsdialog
- Materialien
- Desktop-Sidebar und mobile Navigation

### WebMCP

Wenn die Browserumgebung `document.modelContext` bereitstellt, registriert das Dashboard drei optionale Aktionen: Aufgabe übergeben, Aufgabe abschließen und Dichtekonflikt lösen. Fehlt diese Schnittstelle, funktioniert die normale Bedienoberfläche weiterhin.

## Vorgesehene Supabase-Architektur

Die geplante Datenhaltung verwendet Supabase Auth als Identitätsschicht und PostgreSQL als persistente Datenbank. Aktive Mitglieder der kleinen internen Redaktion werden über `public.app_members` autorisiert. Die Tabellen im exponierten `public`-Schema sind durch Row Level Security geschützt.

```text
React Client
  ├─ VITE_SUPABASE_URL
  └─ VITE_SUPABASE_PUBLISHABLE_KEY
          │
          ▼
Supabase Data API
  ├─ Auth-Sitzung
  ├─ Grants
  └─ RLS: aktive app_members
          │
          ▼
PostgreSQL-Tabellen
  ├─ Formate und Regeln
  ├─ Redaktionsanlässe
  ├─ Posts und Kanalstatus
  ├─ Aufgaben und Materialien
  └─ Änderungsprotokoll
```

Ein `service_role`- oder Secret-Key gehört niemals in das Frontend oder in eine `VITE_`-Variable. Administrative Mitgliedschaftsänderungen müssen über einen vertrauenswürdigen Server-/Admin-Prozess erfolgen.

## Datenfluss nach der geplanten Anbindung

1. Ein angemeldetes, aktives Teammitglied lädt Formate, Anlässe, Posts, Aufgaben und Materialien.
2. Bei der Anlage eines Redaktionsanlasses werden passende Post- und Aufgabenregeln ausgewertet.
3. Die daraus entstehenden Datensätze werden möglichst in einer serverseitigen Transaktion gespeichert.
4. Änderungen an Postingterminen aktualisieren abhängige relative Aufgabenfristen.
5. Materialmängel und Postingdichte werden aus dem aktuellen Datenbestand abgeleitet.
6. Kanalbezogene Veröffentlichungsstände werden getrennt in `post_channels` gepflegt.

## Deployment

`npm run build` erzeugt einen rein statischen Ordner `dist/` (HTML/CSS/JS, keine eigene Serverlaufzeit nötig). Ausgerollt wird über GitHub Pages via `.github/workflows/deploy.yml`, das bei jedem Push auf `main` automatisch baut, testet und veröffentlicht. Details und die Ersteinrichtung stehen in [DEPLOYMENT.md](DEPLOYMENT.md).

## Architekturgrenzen der aktuellen Version

- keine Servermutation/Transaktion für automatische Generierung (läuft clientseitig gegen Supabase)
- keine Upload-Oberfläche und keine eingerichteten Storage-Buckets
- GitHub-Pages-Deployment und die Subdomain-Einrichtung sind vorbereitet, aber noch nicht produktiv geschaltet (siehe DEPLOYMENT.md)
