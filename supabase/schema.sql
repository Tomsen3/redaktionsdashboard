-- Redaktionsdashboard v1 – idempotent baseline for a fresh Supabase project.
-- Run in the SQL editor, then add Tom and Norbert to app_members via a trusted admin process.

create extension if not exists pgcrypto;

create table if not exists public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.editorial_formats (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null check (category in (
    'Weiterbildung/Qualifizierung', 'Mitgliederformate', 'Sonderveranstaltungen',
    'Redaktionelle Formate', 'Rückblick/Zertifizierung'
  )),
  logic_type text not null check (logic_type in ('event', 'publication', 'event_material')),
  repeatable boolean not null default false,
  default_cta text,
  default_template_url text,
  default_qr_required boolean not null default false,
  default_content_owner text not null default 'Tom',
  default_graphics_owner text not null default 'Tom',
  default_approval_owner text not null default 'Tom',
  default_publish_owner text not null default 'Norbert',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_rules (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references public.editorial_formats(id) on delete cascade,
  post_type text not null,
  offset_days integer not null,
  conditional boolean not null default false,
  decision_offset_days integer,
  min_gap_days integer not null default 2,
  priority integer not null default 50 check (priority between 0 and 100),
  active boolean not null default true,
  unique (format_id, post_type)
);

create table if not exists public.task_rules (
  id uuid primary key default gen_random_uuid(),
  format_id uuid references public.editorial_formats(id) on delete cascade,
  post_type text not null,
  task_type text not null,
  title text not null,
  offset_days integer not null,
  owner_role text not null check (owner_role in ('content', 'graphics', 'approval', 'publish')),
  reduced_on_repeat boolean not null default false,
  active boolean not null default true
);

create table if not exists public.editorial_items (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references public.editorial_formats(id),
  parent_item_id uuid references public.editorial_items(id),
  title text not null,
  subtitle text,
  status text not null default 'entwurf' check (status in (
    'entwurf', 'geplant', 'in_vorbereitung', 'kommuniziert', 'durchgeführt', 'abgeschlossen', 'archiviert'
  )),
  description text,
  target_group text,
  event_start timestamptz,
  event_end timestamptz,
  event_location text,
  publication_target_date date,
  event_reference_date date,
  material_ready_date date,
  priority integer not null default 50 check (priority between 0 and 100),
  cta text,
  target_url text,
  canva_url text,
  qr_required boolean not null default false,
  content_owner text not null default 'Tom',
  graphics_owner text not null default 'Tom',
  approval_owner text not null default 'Tom',
  publish_owner text not null default 'Norbert',
  created_by uuid references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    event_start is not null or publication_target_date is not null or event_reference_date is not null
  )
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  editorial_item_id uuid not null references public.editorial_items(id) on delete cascade,
  post_rule_id uuid references public.post_rules(id),
  post_type text not null,
  planned_date date not null,
  regular_date date,
  actual_date date,
  status text not null default 'vorgesehen' check (status in (
    'vorgesehen', 'in_arbeit', 'freigegeben', 'eingeplant', 'veröffentlicht', 'blockiert', 'verschoben', 'entfallen'
  )),
  conditional boolean not null default false,
  conditional_state text not null default 'not_required' check (conditional_state in (
    'not_required', 'pending', 'approved', 'declined', 'sold_out', 'closed'
  )),
  condition_check_date date,
  priority integer not null default 50 check (priority between 0 and 100),
  content_text text,
  notes text,
  late_entry boolean not null default false,
  manually_adjusted boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_channels (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  channel text not null check (channel in ('Instagram', 'Facebook', 'LinkedIn')),
  status text not null default 'vorgesehen' check (status in (
    'vorgesehen', 'eingeplant', 'veröffentlicht', 'fehlgeschlagen', 'entfallen'
  )),
  scheduled_at timestamptz,
  published_at timestamptz,
  published_url text,
  channel_text_override text,
  unique (post_id, channel)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  editorial_item_id uuid not null references public.editorial_items(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  task_rule_id uuid references public.task_rules(id),
  title text not null,
  owner_name text not null,
  due_date date not null,
  status text not null default 'offen' check (status in ('offen', 'in_arbeit', 'erledigt', 'gestrichen')),
  priority integer not null default 50 check (priority between 0 and 100),
  task_type text not null,
  auto_generated boolean not null default true,
  relative_offset_days integer,
  blocked boolean not null default false,
  block_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  editorial_item_id uuid not null references public.editorial_items(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  material_type text not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'fehlt' check (status in ('fehlt', 'angefragt', 'vorhanden', 'nicht_erforderlich')),
  source_type text,
  source_name text,
  url text,
  file_reference text,
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.editorial_audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  changes jsonb not null default '{}'::jsonb
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists editorial_formats_updated_at on public.editorial_formats;
create trigger editorial_formats_updated_at before update on public.editorial_formats
for each row execute function public.set_updated_at();
drop trigger if exists editorial_items_updated_at on public.editorial_items;
create trigger editorial_items_updated_at before update on public.editorial_items
for each row execute function public.set_updated_at();
drop trigger if exists posts_updated_at on public.posts;
create trigger posts_updated_at before update on public.posts
for each row execute function public.set_updated_at();
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
drop trigger if exists materials_updated_at on public.materials;
create trigger materials_updated_at before update on public.materials
for each row execute function public.set_updated_at();

alter table public.app_members enable row level security;
alter table public.editorial_formats enable row level security;
alter table public.post_rules enable row level security;
alter table public.task_rules enable row level security;
alter table public.editorial_items enable row level security;
alter table public.posts enable row level security;
alter table public.post_channels enable row level security;
alter table public.tasks enable row level security;
alter table public.materials enable row level security;
alter table public.editorial_audit_log enable row level security;

drop policy if exists "members_read_self" on public.app_members;
create policy "members_read_self" on public.app_members for select to authenticated
using ((select auth.uid()) = user_id and active);

-- All editorial data is shared by the small internal editorial team. Membership,
-- not row ownership, is the authorization boundary.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'editorial_formats','post_rules','task_rules','editorial_items','posts',
    'post_channels','tasks','materials','editorial_audit_log'
  ] loop
    execute format('drop policy if exists "team_read" on public.%I', table_name);
    execute format(
      'create policy "team_read" on public.%I for select to authenticated using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active))',
      table_name
    );
    execute format('drop policy if exists "team_insert" on public.%I', table_name);
    execute format(
      'create policy "team_insert" on public.%I for insert to authenticated with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active))',
      table_name
    );
    execute format('drop policy if exists "team_update" on public.%I', table_name);
    execute format(
      'create policy "team_update" on public.%I for update to authenticated using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active)) with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active))',
      table_name
    );
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into public.editorial_formats
  (slug, name, category, logic_type, repeatable, default_cta, default_qr_required)
values
  ('modul', 'Weiterbildungsmodul', 'Weiterbildung/Qualifizierung', 'event', true, 'Informationen / Anmeldung', false),
  ('schnupperkurs', 'Schnupperkurs', 'Weiterbildung/Qualifizierung', 'event', true, 'Teilnehmen / Schnupperkurs besuchen', false),
  ('come-together', 'Come Together', 'Sonderveranstaltungen', 'event', true, 'Termin ansehen', true),
  ('mitgliederangebot', 'Mitgliederangebot', 'Mitgliederformate', 'event', true, 'Mehr erfahren', false),
  ('lied-des-monats', 'Lied des Monats', 'Redaktionelle Formate', 'publication', true, 'Anhören', true),
  ('rueckblick', 'Rückblick', 'Rückblick/Zertifizierung', 'event_material', false, 'Weiterlesen', false),
  ('zertifizierung', 'Zertifizierung', 'Rückblick/Zertifizierung', 'event_material', false, 'Weiterlesen', false)
on conflict (slug) do update set
  name = excluded.name, category = excluded.category, logic_type = excluded.logic_type,
  repeatable = excluded.repeatable, default_cta = excluded.default_cta,
  default_qr_required = excluded.default_qr_required;

insert into public.post_rules (format_id, post_type, offset_days, conditional, decision_offset_days, priority)
select id, 'Hauptankündigung', -25, false, null, 80 from public.editorial_formats where slug = 'modul'
on conflict (format_id, post_type) do nothing;
insert into public.post_rules (format_id, post_type, offset_days, conditional, decision_offset_days, priority)
select id, 'Erinnerung', -11, false, null, 85 from public.editorial_formats where slug = 'modul'
on conflict (format_id, post_type) do nothing;
insert into public.post_rules (format_id, post_type, offset_days, conditional, decision_offset_days, priority)
select id, 'Last Call', -4, true, -8, 90 from public.editorial_formats where slug = 'modul'
on conflict (format_id, post_type) do nothing;
insert into public.post_rules (format_id, post_type, offset_days, conditional, decision_offset_days, priority)
select id, 'Hauptankündigung', -10, false, null, 90 from public.editorial_formats where slug = 'schnupperkurs'
on conflict (format_id, post_type) do nothing;
insert into public.post_rules (format_id, post_type, offset_days, conditional, decision_offset_days, priority)
select id, 'Erinnerung', -1, false, null, 95 from public.editorial_formats where slug = 'schnupperkurs'
on conflict (format_id, post_type) do nothing;

insert into public.task_rules (format_id, post_type, task_type, title, offset_days, owner_role, reduced_on_repeat)
select null, '*', 'daten', 'Daten und Materialien prüfen', -8, 'content', false
where not exists (select 1 from public.task_rules where format_id is null and post_type='*' and task_type='daten');
insert into public.task_rules (format_id, post_type, task_type, title, offset_days, owner_role, reduced_on_repeat)
select null, '*', 'text', 'Postingtext finalisieren', -6, 'content', true
where not exists (select 1 from public.task_rules where format_id is null and post_type='*' and task_type='text');
insert into public.task_rules (format_id, post_type, task_type, title, offset_days, owner_role, reduced_on_repeat)
select null, '*', 'grafik', 'Grafik finalisieren', -4, 'graphics', true
where not exists (select 1 from public.task_rules where format_id is null and post_type='*' and task_type='grafik');
insert into public.task_rules (format_id, post_type, task_type, title, offset_days, owner_role, reduced_on_repeat)
select null, '*', 'freigabe', 'Inhalt und Grafik freigeben', -2, 'approval', false
where not exists (select 1 from public.task_rules where format_id is null and post_type='*' and task_type='freigabe');
insert into public.task_rules (format_id, post_type, task_type, title, offset_days, owner_role, reduced_on_repeat)
select null, '*', 'ausspielung', 'Einplanen und veröffentlichen', 0, 'publish', false
where not exists (select 1 from public.task_rules where format_id is null and post_type='*' and task_type='ausspielung');

-- Example editorial items. Posts/tasks can be generated by the application engine
-- after insertion; the fixed IDs keep parent/child links reproducible.
insert into public.editorial_items (
  id, format_id, title, subtitle, status, description, target_group,
  event_start, event_end, event_location, priority, cta, target_url,
  content_owner, graphics_owner, approval_owner, publish_owner, created_at
)
select
  '10000000-0000-4000-8000-000000000001', id,
  'Modul F', 'Mit der Stimme zur Stärke', 'geplant',
  'Singen als Prävention – psychische Gesundheit stärken', 'Teilnehmende der Weiterbildung',
  '2026-10-16 09:00:00+02', '2026-10-18 16:00:00+02', 'Zell am Main', 80,
  'Informationen / Anmeldung', 'https://singende-krankenhaeuser.de/termine',
  'Tom', 'Tom', 'Tom', 'Norbert', '2026-08-20 09:00:00+02'
from public.editorial_formats where slug = 'modul'
on conflict (id) do nothing;

insert into public.editorial_items (
  id, format_id, parent_item_id, title, subtitle, status, description, target_group,
  event_start, event_end, event_location, priority, cta, target_url,
  content_owner, graphics_owner, approval_owner, publish_owner, created_at
)
select
  '10000000-0000-4000-8000-000000000002', id,
  '10000000-0000-4000-8000-000000000001', 'Schnupperkurs Modul F',
  'Online kennenlernen', 'in_vorbereitung',
  'Kostenfreier Online-Schnupperkurs mit Jan Henning Foh und Monika Ananda Wiese',
  'Interessierte an Modul F', '2026-09-11 18:00:00+02', '2026-09-11 19:00:00+02',
  'Online', 95, 'Teilnehmen / Schnupperkurs besuchen',
  'https://singende-krankenhaeuser.de/termine', 'Tom', 'Tom', 'Tom', 'Norbert',
  '2026-09-05 09:00:00+02'
from public.editorial_formats where slug = 'schnupperkurs'
on conflict (id) do nothing;
