# Supabase-Dokumentation

## Aktueller Status

`supabase/schema.sql` ist eine idempotente Baseline für ein neues Supabase-Projekt. Sie enthält Tabellen, Beziehungen, Constraints, Trigger, Rechte, RLS-Policies sowie repräsentative Stammdaten. Sie wurde noch nicht gegen eine reale Projektinstanz ausgeführt; im aktuellen Frontend ist noch kein Supabase-Client aktiv.

## Environment-Variablen

Für die spätere Browseranbindung sind vorgesehen:

- `VITE_SUPABASE_URL` – API-URL des Supabase-Projekts
- `VITE_SUPABASE_PUBLISHABLE_KEY` – öffentlicher Publishable Key für den Browser

Keine geheimen Schlüssel in `.env.example` oder in `VITE_`-Variablen eintragen. Insbesondere darf ein `service_role`- oder Secret-Key ausschließlich in einer vertrauenswürdigen Serverumgebung verwendet werden.

## Tabellen

### `app_members`

Interne Zugriffsgrenze des Redaktionsteams. Verknüpft einen Supabase-Auth-Benutzer mit Anzeigename und Aktivstatus. Normale Benutzer dürfen nur ihren eigenen aktiven Eintrag lesen; Anlage und Pflege erfolgen administrativ.

### `editorial_formats`

Wiederverwendbare Formatdefinitionen mit Kategorie, Steuerungslogik, Wiederholbarkeit, Standard-CTA, Designvorlage, QR-Vorgabe und Standardverantwortlichkeiten. Enthält die verbindlichen Kategorien Weiterbildung/Qualifizierung, Mitgliederformate, Sonderveranstaltungen, Redaktionelle Formate und Rückblick/Zertifizierung.

### `post_rules`

Definiert je Format die automatisch vorgesehenen Postingtypen, relative Tagesabstände, Priorität, Mindestabstand und optionale Bedingungen/Entscheidungstermine.

### `task_rules`

Definiert Aufgaben je Postingtyp oder global für alle Postingtypen. Speichert Titel, relative Frist, Rollenverantwortung und die Information, ob eine Aufgabe bei Wiederholungen reduziert werden kann.

### `editorial_items`

Konkrete Redaktionsanlässe oder Ausgaben. Enthält Titel, Status, Terminanker, Zielgruppe, CTA, Links, Verantwortlichkeiten und optionale Eltern-Kind-Verknüpfungen. So kann etwa der Schnupperkurs Modul F mit Modul F verbunden werden.

### `posts`

Ein redaktionelles Posting pro Inhalt. Enthält geplanten, regulären und tatsächlichen Termin, Status, Bedingungsstatus, Priorität, Text, Notizen sowie Kennzeichen für Late Entry und manuelle Verschiebung.

### `post_channels`

Kanalbezogener Ausspielungsstatus eines Posts für Instagram, Facebook und LinkedIn. Ein identischer Inhalt bleibt ein redaktionelles Posting; diese Tabelle hält lediglich separate Planungs-, Veröffentlichungs- und Fehlerstände je Kanal.

### `tasks`

Konkrete Aufgaben zu Redaktionsanlass und optionalem Posting. Enthält Verantwortliche, Fälligkeit, Status, Typ, Priorität, relative Frist und Blockadegrund.

### `materials`

Benötigte Daten, Texte, Bilder, Audios, Links, Canva-Vorlagen oder andere Materialien. Enthält Pflichtstatus, Quelle, URL/Dateireferenz, Fälligkeit und Bearbeitungsstand.

### `editorial_audit_log`

Vorbereitete Historie für Änderungen an Redaktionsdaten. Die Tabelle ist vorhanden, wird in der aktuellen Version aber noch nicht automatisch befüllt. Vor produktiver Nutzung sollte sie ausschließlich über eine kontrollierte, append-only Servermutation oder einen abgesicherten Trigger geschrieben werden.

## Beziehungen

- `editorial_items.format_id` → `editorial_formats.id`
- `editorial_items.parent_item_id` → `editorial_items.id`
- `post_rules.format_id` → `editorial_formats.id`
- `task_rules.format_id` → `editorial_formats.id` (optional für globale Regeln)
- `posts.editorial_item_id` → `editorial_items.id`
- `posts.post_rule_id` → `post_rules.id`
- `post_channels.post_id` → `posts.id`
- `tasks.editorial_item_id` → `editorial_items.id`
- `tasks.post_id` → `posts.id`
- `tasks.task_rule_id` → `task_rules.id`
- `materials.editorial_item_id` → `editorial_items.id`
- `materials.post_id` → `posts.id`
- `app_members.user_id` und Audit-Benutzer → `auth.users.id`

## Row Level Security und Rechte

RLS ist für jede Tabelle im exponierten `public`-Schema aktiviert.

### `app_members`

- Policy `members_read_self`
- `SELECT` nur auf den eigenen, aktiven Mitgliedseintrag
- kein clientseitiges `INSERT`, `UPDATE` oder `DELETE`

### Redaktionsdaten

Für `editorial_formats`, `post_rules`, `task_rules`, `editorial_items`, `posts`, `post_channels`, `tasks`, `materials` und `editorial_audit_log` gelten:

- `team_read`: Lesen nur für authentifizierte Benutzer mit aktivem `app_members`-Eintrag
- `team_insert`: Einfügen nur für aktive Teammitglieder
- `team_update`: Aktualisieren nur für aktive Teammitglieder; `USING` und `WITH CHECK` prüfen die Mitgliedschaft
- keine Delete-Policy und kein `DELETE`-Grant für Teammitglieder
- `anon` erhält keine Grants oder Policies

Das Schema gewährt `authenticated` nur `SELECT`, `INSERT` und `UPDATE`. RLS und Grants wirken gemeinsam. Der `service_role`-Zugang umgeht RLS und darf nicht im Browser verwendet werden.

## Trigger und Funktionen

`public.set_updated_at()` aktualisiert bei Änderungen automatisch das Feld `updated_at` auf zentralen Tabellen. Die Funktion läuft als `security invoker`, verwendet einen leeren `search_path` und ist für `public`, `anon` und `authenticated` nicht direkt ausführbar; sie wird nur von Triggern aufgerufen.

## Storage-Buckets

In der aktuellen Version sind keine Supabase-Storage-Buckets angelegt oder im Schema definiert. Bild-, Audio- und Dokumentreferenzen werden fachlich in `materials` vorbereitet, die Oberfläche nutzt jedoch noch lokale Assets unter `public/assets/`.

Für eine spätere Einführung empfiehlt sich erst nach Festlegung der Datenschutz- und Freigabelogik eine Trennung, beispielsweise:

- privater Bucket für redaktionelle Rohmaterialien
- optional öffentlicher oder signiert ausgelieferter Bucket für freigegebene Veröffentlichungsassets

Diese Namen sind Vorschläge und ausdrücklich kein implementierter Bestandteil. Vor Einführung müssen Policies für Lesen, Upload, Änderung und Löschung festgelegt und mit echten Benutzerrollen getestet werden. Ein Storage-Upsert benötigt neben `INSERT` auch `SELECT` und `UPDATE`.

## Installation der Baseline

Die Datei `supabase/schema.sql` kann in einem neuen Projekt im SQL Editor ausgeführt werden. Danach müssen die Auth-Benutzer über einen vertrauenswürdigen Admin-Prozess in `app_members` eingetragen werden.

Beispiel für einen administrativ ausgeführten Eintrag:

```sql
insert into public.app_members (user_id, display_name)
values ('AUTH-USER-UUID', 'Tom');
```

Das Beispiel niemals mit einer erfundenen UUID ausführen. Die echte UUID muss aus `auth.users` stammen.

## Noch erforderliche Verifikation

Vor Produktivbetrieb:

1. Schema in einer separaten Testinstanz ausführen.
2. Migration/Schema-Diff prüfen.
3. Rechte und RLS mit `anon`, einem Nichtmitglied sowie je einem aktiven und inaktiven Mitglied testen.
4. `SELECT`, `INSERT`, `UPDATE` und verweigertes `DELETE` explizit prüfen.
5. Datenbank-Advisors ausführen und Befunde beheben.
6. Erst nach Festlegung der Storage-Architektur Buckets und Objekt-Policies ergänzen.

Die aktuelle Baseline enthält keine klassischen Dateien unter `supabase/migrations/`. `supabase/schema.sql` ist die vorhandene, vollständige Schema-Definition und wird deshalb unverändert als maßgebliche SQL-Quelle mitgeliefert.
