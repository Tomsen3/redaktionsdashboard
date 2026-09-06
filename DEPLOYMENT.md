# Deployment auf GitHub Pages

Diese Anleitung richtet sich an jemanden, der das Projekt zum ersten Mal
deployt – inklusive Begründung der Entscheidungen, nicht nur der Klickwege.

## Warum GitHub Pages statt Cloudflare/OpenAI-Sites-Hosting?

Die Anwendung ist seit der Umstellung auf ein reines Vite-Setup (siehe
ARCHITEKTUR.md) eine rein statische Webseite: HTML, CSS und JavaScript ohne
eigene Serverlaufzeit. Die gesamte Fachlogik läuft im Browser, die
Datenhaltung übernimmt Supabase direkt vom Client aus. Für so eine
Anwendung ist ein kostenpflichtiger oder komplexer Hosting-Dienst nicht
nötig – GitHub Pages ist kostenlos, wartungsarm und wird bereits für andere
Sikra-/Tom-Projekte genutzt (z. B. `tomsen3.github.io/planungsassistent`).

## Einmalige Ersteinrichtung

### 1. GitHub-Repository anlegen

1. Neues (privates oder öffentliches) Repository erstellen, z. B.
   `redaktionsdashboard`.
2. Diesen Projektordner als Inhalt des Repositorys pushen (siehe Abschnitt
   "Erster Push" unten).

### 2. Secrets für den Build hinterlegen

Repository → Settings → Secrets and variables → Actions → "New repository
secret":

- `VITE_SUPABASE_URL` – aus dem Supabase-Dashboard, Project Settings → API
- `VITE_SUPABASE_PUBLISHABLE_KEY` – ebenfalls dort, "Publishable key"

Hinweis zur Einordnung: Dieser Key ist bewusst für den Einsatz im Browser
gedacht (vergleichbar mit einem Stripe-Publishable-Key) und daher kein
Geheimnis im klassischen Sinn. Er wird trotzdem als Secret hinterlegt,
damit er nicht direkt im Repository-Code auftaucht und bei Bedarf ohne
Codeänderung ausgetauscht werden kann. Ein `service_role`-Key darf hier
niemals eingetragen werden.

### 3. GitHub Pages aktivieren

Repository → Settings → Pages → "Build and deployment" → Source:
**GitHub Actions** auswählen (nicht "Deploy from a branch"). Der
mitgelieferte Workflow `.github/workflows/deploy.yml` übernimmt den Rest.

### 4. Eigene Subdomain einrichten (redaktion.singende-krankenhaeuser.de)

Gleiches Muster wie bei `chat.singende-krankenhaeuser.de`, nur mit
GitHub Pages statt EC2 als Ziel:

1. Bei Wix (DNS-Verwaltung der Domain `singende-krankenhaeuser.de`) einen
   **CNAME-Eintrag** anlegen:
   - Name/Host: `redaktion`
   - Ziel/Wert: `<github-benutzername>.github.io`
   - TTL: Standardwert belassen
2. Im GitHub-Repository unter Settings → Pages → "Custom domain":
   `redaktion.singende-krankenhaeuser.de` eintragen und speichern. GitHub
   legt dabei automatisch eine `CNAME`-Datei im veröffentlichten Ordner an
   – das übernimmt bei uns aber bereits der Workflow selbst (Schritt
   "CNAME für eigene Domain hinzufügen"), damit sie bei jedem automatischen
   Deploy erhalten bleibt.
3. "Enforce HTTPS" aktivieren, sobald GitHub das Zertifikat ausgestellt hat
   (kann nach dem ersten DNS-Abgleich einige Minuten bis Stunden dauern).

Falls stattdessen (z. B. übergangsweise) die kostenlose GitHub-Adresse
genutzt werden soll (`https://<benutzername>.github.io/redaktionsdashboard/`
statt eigener Subdomain), muss zusätzlich in `vite.config.ts` die Zeile
`base: '/'` auf `base: '/redaktionsdashboard/'` geändert werden – sonst
werden CSS/JS/Bilder unter der falschen Pfadbasis gesucht und die Seite
bleibt weiß.

## Laufender Betrieb

Jeder Push auf den Branch `main` löst automatisch aus:

1. Abhängigkeiten installieren (`npm ci`)
2. Die 4 bestehenden Fachlogik-Tests laufen lassen (`npm test`) – schlägt
   einer fehl, wird nicht deployt
3. Produktionsbuild erzeugen (`npm run build`)
4. CNAME-Datei für die eigene Domain in den Build-Ordner schreiben
5. Ergebnis auf GitHub Pages veröffentlichen

Der Fortschritt ist im Repository unter dem Reiter "Actions" einsehbar.
Ein manueller Deploy-Anstoß ist über "Actions" → "Deploy auf GitHub Pages"
→ "Run workflow" möglich.

## Erster Push (falls das Repository noch leer ist)

```bash
git init
git add .
git commit -m "Initialer Import: Redaktionsdashboard (statischer Build)"
git branch -M main
git remote add origin https://github.com/<benutzername>/redaktionsdashboard.git
git push -u origin main
```

Nach diesem Push starten Actions-Workflow und Deployment automatisch,
sofern Secrets und Pages-Einstellung (siehe oben) bereits gesetzt sind.
