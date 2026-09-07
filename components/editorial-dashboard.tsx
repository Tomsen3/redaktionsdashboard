'use client';
/* oxlint-disable typescript/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Archive, BarChart3, Bell, CalendarDays, Check, ChevronRight, CircleUserRound,
  ClipboardCheck, Clock3, Copy, ExternalLink, FileImage, Filter, FolderPlus, Grid2X2, ImageIcon, LayoutList,
  Link2, MapPin, PackageCheck, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, Users, X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { addDays, generateSchedule, isItemComplete, mondayOfWeek, movePost, postingDensity, reassignTask as validateReassign } from '@/lib/editorial-engine.mjs';
import { supabase } from '@/lib/supabase-client';
import { mapFormat, mapFormatQuickLink, mapItem, mapMaterial, mapPost, mapPostRule, mapQuickLink, mapTask, mapTaskRule } from '@/lib/data-mappers';

type View = 'Übersicht' | 'Redaktionsanlässe' | 'Redaktionsplan' | 'Kalender' | 'Aufgaben' | 'Materialien' | 'Formate & Regeln' | 'Archiv';
type Filters = { person: string; time: string; status: string; format: string; item: string };

const TODAY = new Date().toISOString().slice(0, 10);
// 'Redaktionsplan' zeigt weiterhin die Postings-Liste (unveränderter Inhalt), heißt in der
// Oberfläche aber jetzt "Postings" – die neue, eigenständige Ansicht "Redaktionsanlässe"
// (1 Zeile pro Anlass) übernimmt die Bezeichnung, die vorher hier (missverständlich) stand.
const nav: { name: View; label: string; mobileLabel?: string; icon: typeof Grid2X2 }[] = [
  { name: 'Übersicht', label: 'Startseite', icon: Grid2X2 },
  { name: 'Redaktionsanlässe', label: 'Redaktionsanlässe', mobileLabel: 'Anlässe', icon: LayoutList },
  { name: 'Redaktionsplan', label: 'Postings', icon: Send },
  { name: 'Kalender', label: 'Kalender', icon: CalendarDays },
  { name: 'Aufgaben', label: 'Aufgaben', icon: ClipboardCheck },
  { name: 'Materialien', label: 'Material', icon: FileImage },
];

const formatDate = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`));
const fullDate = (value: string) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`));
const itemFor = (items: any[], id: string) => items.find((item) => item.id === id) ?? { title: '', format: '', category: '', people: [], publishOwner: '' };
const statusLabel = (status: string) => ({ in_arbeit: 'in Arbeit', blockiert: 'blockiert', geplant: 'geplant', vorgesehen: 'vorgesehen', offen: 'offen', erledigt: 'erledigt' }[status] || status);
const materialStatusLabel = (status: string) => ({ fehlt: 'fehlt', angefragt: 'angefragt', vorhanden: 'vorhanden', nicht_erforderlich: 'nicht erforderlich' }[status] || status);
// Färbt den Fortschritts-Pill (erledigte/gesamt Aufgaben eines Anlasses) entlang eines
// Grünverlaufs ein: wenig erledigt = dunkles Grün, viel erledigt = helles Grün. Die
// Schriftfarbe wird über die wahrgenommene Helligkeit (YIQ-Formel) automatisch zwischen
// Weiß und einem dunklen Grün gewählt, damit der Text bei jedem Mischton lesbar bleibt.
const progressPillStyle = (done: number, total: number): CSSProperties => {
  if (!total) return {};
  const ratio = Math.max(0, Math.min(1, done / total));
  const dark = { r: 27, g: 67, b: 50 }; // dunkles Tannengrün
  const light = { r: 216, g: 243, b: 220 }; // helles Mintgrün
  const mix = (from: number, to: number) => Math.round(from + (to - from) * ratio);
  const r = mix(dark.r, light.r);
  const g = mix(dark.g, light.g);
  const b = mix(dark.b, light.b);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return { backgroundColor: `rgb(${r}, ${g}, ${b})`, borderColor: 'transparent', color: brightness > 150 ? '#1b4332' : '#ffffff' };
};

// SharePoint-Materialablage: Wurzelordner "Redaktionsdashboard Material" unter 500
// Kommunikation & Marketing/520 Website & Social Media auf der Vereins-Site. Jede der fünf
// Format-Kategorien hat dort einen eigenen Unterordner (Ordnernamen mit "-" statt "/", da "/"
// in SharePoint-Ordnernamen nicht erlaubt ist). Pro Redaktionsanlass wird kein eigener
// Unterordner-Link in der DB gepflegt – der Ordnername "{Titel} – {Termin}" wird stattdessen
// bei Bedarf clientseitig gebildet (siehe prepareSharePointFolder in EditorialDashboard).
const SHAREPOINT_MATERIAL_ROOT = '/sites/SingendekrankenhuserHomepage/Freigegebene Dokumente/500 Kommunikation & Marketing/520 Website & Social Media/Redaktionsdashboard Material';
const CATEGORY_FOLDER_NAMES: Record<string, string> = {
  'Weiterbildung/Qualifizierung': 'Weiterbildung-Qualifizierung',
  'Mitgliederformate': 'Mitgliederformate',
  'Sonderveranstaltungen': 'Sonderveranstaltungen',
  'Redaktionelle Formate': 'Redaktionelle Formate',
  'Rückblick/Zertifizierung': 'Rückblick-Zertifizierung',
};
// Datumspräfix "JJJJ_MM_TT" für die Ordner-Namenskonvention – wird sowohl bei der Modul/
// Schnupperkurs-Struktur (siehe unten) als auch bei alleinstehenden Anlässen (kein erkanntes
// Paar, z. B. "Modul E" oder Mitgliederangebote) einheitlich VOR den Titel gesetzt.
const sharepointDatePrefix = (item: any) => (keyDateFor(item) ?? '').replaceAll('-', '_');

// Erkennt automatisch, ob ein Anlass zu einem "Schnupperkurs + Modul"-Paar gehört: Ein Titel,
// der mit "Schnupperkurs " beginnt, wird mit einem Anlass ohne dieses Präfix abgeglichen (z. B.
// "Schnupperkurs Modul F" ↔ "Modul F"). Gibt es einen anderen Anlass mit genau diesem
// Gegenstück-Titel, gehören beide zum selben Modul. Gibt bei Treffer beide Anlässe zurück
// (nicht nur den gefundenen Namen), weil sharepointRelativePath für beide Ordnerebenen jeweils
// den EIGENEN Termin des betroffenen Anlasses braucht (Schnupperkurs und Weiterbildung finden
// nicht zwangsläufig am selben Tag statt). Sucht bewusst über eine übergebene, ungefilterte
// Liste (aktive + archivierte Anlässe), damit ein aktiver Filter das Gegenstück nicht
// "unsichtbar" macht.
const SCHNUPPERKURS_PREFIX = 'Schnupperkurs ';
const findModulePair = (item: any, allItems: any[]): { moduleItem: any; schnupperkursItem: any } | null => {
  let moduleItem: any;
  let schnupperkursItem: any;
  if (item.title.startsWith(SCHNUPPERKURS_PREFIX)) {
    const moduleTitle = item.title.slice(SCHNUPPERKURS_PREFIX.length).trim();
    moduleItem = allItems.find((entry) => entry.id !== item.id && entry.title === moduleTitle);
    schnupperkursItem = item;
  } else {
    schnupperkursItem = allItems.find((entry) => entry.id !== item.id && entry.title === `${SCHNUPPERKURS_PREFIX}${item.title}`);
    moduleItem = item;
  }
  return moduleItem && schnupperkursItem ? { moduleItem, schnupperkursItem } : null;
};

// Baut die relative Ordner-Pfadkette unterhalb des Kategorie-Ordners. Bei erkanntem
// Schnupperkurs/Modul-Paar zwei Ebenen: {Termin-der-Weiterbildung}_{Modultitel} als
// Oberordner (immer dasselbe Datum, egal ob vom Schnupperkurs- oder Modul-Anlass aus geöffnet
// – so landen beide zuverlässig im selben Oberordner) und darunter entweder schlicht "Modul"
// (kein eigenes Datum – steht ja schon im Oberordner) oder {eigener Termin}_Schnupperkurs
// (mit eigenem Datum, da der Schnupperkurstermin vom Modultermin abweichen kann). Ohne
// erkanntes Paar bleibt es bei der flachen Struktur "{JJJJ_MM_TT}_Titel".
const sharepointRelativePath = (item: any, allItems: any[]): string[] => {
  const pair = findModulePair(item, allItems);
  if (pair) {
    const modulePrefix = sharepointDatePrefix(pair.moduleItem);
    const topFolder = modulePrefix ? `${modulePrefix}_${pair.moduleItem.title}` : pair.moduleItem.title;
    const isSchnupperkurs = item.id === pair.schnupperkursItem.id;
    if (isSchnupperkurs) {
      // Der Schnupperkurs bekommt sein EIGENES Datum als Präfix, weil es vom Modul-Termin im
      // Oberordner abweichen kann.
      const schnupperkursPrefix = sharepointDatePrefix(pair.schnupperkursItem);
      return [topFolder, schnupperkursPrefix ? `${schnupperkursPrefix}_Schnupperkurs` : 'Schnupperkurs'];
    }
    // Die Weiterbildung selbst bekommt KEIN eigenes Datumspräfix mehr – das steht schon im
    // Oberordner (derselbe Termin), ein zweites Mal wäre redundant.
    return [topFolder, 'Modul'];
  }
  const dateLabel = sharepointDatePrefix(item);
  return [dateLabel ? `${dateLabel}_${item.title}` : item.title];
};

// Baut die URL für den "In SharePoint öffnen"-Button. Bei erkanntem Modul/Schnupperkurs-Paar
// wird direkt bis zum Oberordner verlinkt (erstes Segment aus sharepointRelativePath), nicht
// nur bis zum Kategorie-Ordner – spart einen Navigationsschritt, wenn man dort nur noch
// "Modul" oder "Schnupperkurs" ergänzen will. Ohne erkanntes Paar bleibt es beim
// Kategorie-Ordner, da es dort keinen verlässlich schon existierenden Zwischenordner gibt.
// Wichtig: Die App kann NICHT prüfen, ob der Oberordner in SharePoint schon existiert (kein
// Lesezugriff) – existiert er noch nicht, zeigt SharePoint vermutlich eine Fehlerseite statt
// sauber zum Kategorie-Ordner zurückzuspringen.
const sharepointOpenUrl = (item: any, allItems: any[]) => {
  const folderName = CATEGORY_FOLDER_NAMES[item.category];
  if (!folderName) return null;
  const segments = sharepointRelativePath(item, allItems);
  const pathParts = [SHAREPOINT_MATERIAL_ROOT, folderName];
  if (segments.length > 1) pathParts.push(segments[0]);
  const path = pathParts.join('/');
  return `https://singendekrankenhaeuser.sharepoint.com/sites/SingendekrankenhuserHomepage/Freigegebene%20Dokumente/Forms/AllItems.aspx?id=${encodeURIComponent(path)}`;
};
const timeBucket = (date: string) => date < TODAY ? 'Überfällig' : date === TODAY ? 'Heute' : date <= addDays(TODAY, 6) ? 'Diese Woche' : 'Später';

// Vorbelegte Standard-Uhrzeiten je Format (Anlegen-Dialog, siehe chooseItemFormat) – reine
// Starthilfe, jederzeit manuell überschreibbar. Nur für Formate mit einem verlässlichen, immer
// gleichen Muster hinterlegt. "Besondere Veranstaltung" (Sonderveranstaltungen) deckt von
// Come-together/Sommerakademie bis Liedernacht oder Online-Vortrag zu unterschiedliche Zeiten
// ab und bekommt deshalb bewusst KEINEN Standard.
const DEFAULT_EVENT_TIMES: Record<string, { startTime: string; endTime: string; multiDay: boolean }> = {
  schnupperkurs: { startTime: '18:00', endTime: '18:45', multiDay: false },
  modul: { startTime: '18:00', endTime: '13:00', multiDay: true }, // Fr 18:00 – So 13:00
  mitgliederangebot: { startTime: '18:00', endTime: '19:00', multiDay: false },
};
// "Besondere Veranstaltung" ist in der Datenbank ein einziges Format für sehr unterschiedliche
// Anlässe (Come-together/Sommerakademie ebenso wie Liedernächte oder Vorträge außer der Reihe)
// – ein pauschaler Format-Standard wäre hier falsch. Come-together und Sommerakademie finden
// aber deutlich regelmäßiger nach demselben Wochenend-Muster statt wie die Weiterbildungsmodule
// und bekommen deshalb, anhand des eingetippten Titels erkannt, denselben Vorschlag. Alles
// andere unter "Besondere Veranstaltung" bleibt ohne Vorbelegung.
const isWeekendSonderformat = (title: string) => {
  const normalized = title.trim().toLowerCase();
  return normalized.startsWith('come-together') || normalized.startsWith('come together') || normalized.startsWith('sommerakademie');
};
// Datum des nächsten Wochentags ab (einschließlich) referenceDate; targetDay: 0=So … 6=Sa.
const nextWeekday = (referenceDate: string, targetDay: number) => {
  const date = new Date(`${referenceDate}T12:00:00`);
  const diff = (targetDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
};
// Grob gerasterter Zeitraum für den Archiv-Filter, bezogen auf das Archivierungsdatum
// (nicht den ursprünglichen Veranstaltungstermin) – analog zu timeBucket, aber rückwärtsgewandt.
const archivedPeriod = (value?: string) => {
  if (!value) return 'Unbekannt';
  const daysAgo = Math.floor((new Date(`${TODAY}T12:00:00`).getTime() - new Date(`${value.slice(0, 10)}T12:00:00`).getTime()) / 86400000);
  if (daysAgo <= 30) return 'Letzte 30 Tage';
  if (daysAgo <= 365) return 'Dieses Jahr';
  return 'Älter';
};
// Ermittelt das für Sortierung/Filterung relevante "Leitdatum" eines Redaktionsanlasses:
// Veranstaltungstermin bei Formaten mit Termin, sonst Ziel- bzw. Bezugsdatum. Spiegelt den
// "anchor" aus generateSchedule() in editorial-engine.mjs, arbeitet aber auf den bereits
// gemappten Item-Feldern (camelCase) statt auf der rohen DB-Zeile.
const keyDateFor = (item: any) => (
  item.logicType === 'publication' ? item.publicationTargetDate
    : item.logicType === 'event_material' ? (item.materialReadyDate || item.eventReferenceDate)
    : item.eventStart
) || '';

// Ordnet UI-Feldnamen den Supabase-Spalten zu, damit updateTask generisch bleibt.
const TASK_COLUMN: Record<string, string> = { title: 'title', owner: 'owner_name', dueDate: 'due_date', status: 'status', priority: 'priority', notes: 'notes', referenceUrl: 'reference_url' };

function FilterBar({ filters, onChange, formatNames, itemOptions, view }: { filters: Filters; onChange: (filters: Filters) => void; formatNames: string[]; itemOptions: { id: string; title: string }[]; view: View }) {
  // Redaktionsanlässe selbst haben keinen eigenen Status (nur Postings/Aufgaben/Materialien
  // haben einen) – der Status-Filter würde dort nie etwas ausblenden und wird deshalb gar
  // nicht erst angezeigt. Materialien nutzen einen eigenen Status-Wertebereich (fehlt/
  // angefragt/vorhanden/nicht_erforderlich) statt des Aufgaben-/Posting-Status – ohne diese
  // Unterscheidung würde eine Auswahl dort immer eine leere Liste zeigen, weil die Werte nie
  // zueinander passen.
  const showStatus = view !== 'Redaktionsanlässe';
  const isMaterialStatus = view === 'Materialien';
  const statusChoices = isMaterialStatus ? ['Alle', 'fehlt', 'angefragt', 'vorhanden', 'nicht_erforderlich'] : ['Alle', 'offen', 'in_arbeit', 'geplant', 'blockiert', 'erledigt'];
  const statusLabelFor = isMaterialStatus ? materialStatusLabel : statusLabel;
  const choices: Record<string, string[]> = {
    person: ['Alle', 'Tom', 'Norbert'],
    time: ['Alle', 'Überfällig', 'Heute', 'Diese Woche', 'Später'],
    ...(showStatus ? { status: statusChoices } : {}),
    format: ['Alle', ...formatNames],
  };
  const filterLabels: Record<string, string> = { person: 'Person', time: 'Zeitraum', status: 'Status', format: 'Format' };
  return (
    <div className="filterbar" aria-label="Kombinierbare Filter">
      <div className="filter-title"><Filter size={16} /> Filter kombinieren</div>
      {Object.keys(choices).map((key) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label htmlFor={`filter-${key}`} style={{ fontSize: 11, color: 'var(--muted-foreground, #6b7280)' }}>{filterLabels[key]}</label>
          <Select value={filters[key as keyof Filters]} onValueChange={(value) => onChange({ ...filters, [key]: value as string })}>
            <SelectTrigger id={`filter-${key}`} aria-label={filterLabels[key]} className={cn('filter-select', filters[key as keyof Filters] !== 'Alle' && 'active')}><SelectValue>{key === 'status' ? statusLabelFor(filters.status) : statusLabel(filters[key as keyof Filters])}</SelectValue></SelectTrigger>
            <SelectContent>{choices[key].map((choice) => <SelectItem key={choice} value={choice}>{key === 'status' ? statusLabelFor(choice) : statusLabel(choice)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ))}
      {/* Anlass-Filter: eigener Select, weil hier (anders als bei Format) die eindeutige id als
          Wert genutzt werden muss – Anlass-Titel sind nicht garantiert eindeutig. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label htmlFor="filter-item" style={{ fontSize: 11, color: 'var(--muted-foreground, #6b7280)' }}>Anlass</label>
        <Select value={filters.item} onValueChange={(value) => onChange({ ...filters, item: value as string })}>
          <SelectTrigger id="filter-item" aria-label="Anlass" className={cn('filter-select', filters.item !== 'Alle' && 'active')}><SelectValue>{filters.item === 'Alle' ? 'Alle Anlässe' : (itemOptions.find((option) => option.id === filters.item)?.title ?? 'Alle Anlässe')}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="Alle">Alle Anlässe</SelectItem>
            {itemOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {Object.values(filters).some((value) => value !== 'Alle') && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ person: 'Alle', time: 'Alle', status: 'Alle', format: 'Alle', item: 'Alle' })}>
          <X /> Zurücksetzen
        </Button>
      )}
    </div>
  );
}

function Metric({ label, value, detail, tone = 'neutral', icon: Icon, action, onClick }: { label: string; value: string; detail: string; tone?: string; icon: typeof CalendarDays; action: string; onClick?: () => void }) {
  return <article className={cn('metric', `metric-${tone}`)}>
    <Icon className="metric-icon" />
    <div className="metric-value" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong>{value}</strong><span>{label}</span></div>
    <small>{detail}</small>
    <button type="button" onClick={onClick}>{action} <ChevronRight /></button>
  </article>;
}

function AuthGate() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const sendLink = async () => {
    if (!email.trim()) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setStatus(error ? 'error' : 'sent');
  };

  return (
    <div className="auth-gate" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 360, width: '100%', display: 'grid', gap: 16, textAlign: 'center' }}>
        <div className="brand-copy" style={{ display: 'grid', justifyItems: 'center' }}>
          <strong>Redaktionsdashboard</strong>
          <span>Singende Krankenhäuser</span>
        </div>
        {status === 'sent'
          ? <p>Anmeldelink an <strong>{email}</strong> gesendet. Bitte E-Mail-Postfach prüfen.</p>
          : <>
            <label htmlFor="auth-email" style={{ display: 'grid', gap: 6, textAlign: 'left' }}>
              <span>E-Mail-Adresse</span>
              <Input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tom@singende-krankenhaeuser.de" />
            </label>
            <Button onClick={sendLink} disabled={!email.trim() || status === 'sending'}>
              {status === 'sending' ? 'Sende Link …' : 'Anmeldelink senden'}
            </Button>
            {status === 'error' && <p style={{ color: 'var(--destructive, crimson)' }}>Anmeldung fehlgeschlagen. Bitte erneut versuchen.</p>}
          </>}
      </div>
    </div>
  );
}

export function EditorialDashboard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<View>('Übersicht');
  const [items, setItems] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [quickLinks, setQuickLinks] = useState<any[]>([]);
  const [formatQuickLinks, setFormatQuickLinks] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const formatsRef = useRef<any[]>([]);
  useEffect(() => { formatsRef.current = formats; }, [formats]);
  const [postRules, setPostRules] = useState<any[]>([]);
  const [taskRules, setTaskRules] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({ person: 'Alle', time: 'Alle', status: 'Alle', format: 'Alle', item: 'Alle' });

  // Materialien haben einen eigenen Status-Wertebereich (fehlt/angefragt/vorhanden/
  // nicht_erforderlich) statt des Aufgaben-/Posting-Status (offen/in_arbeit/…). Wechselt man
  // die Ansicht mit aktivem Status-Filter, würde der alte Wert sonst unbemerkt zu einer leeren
  // Liste führen, weil er im neuen Wertebereich gar nicht vorkommt – hier wird er in dem Fall
  // automatisch auf "Alle" zurückgesetzt.
  useEffect(() => {
    const materialStatuses = ['fehlt', 'angefragt', 'vorhanden', 'nicht_erforderlich'];
    setFilters((current) => {
      if (current.status === 'Alle') return current;
      const isMaterialStatus = materialStatuses.includes(current.status);
      const validForView = view === 'Materialien' ? isMaterialStatus : !isMaterialStatus;
      return validForView ? current : { ...current, status: 'Alle' };
    });
  }, [view]);

  // Archiv: dieselben Datensätze wie oben, aber mit gesetztem archived_at. Getrennte States
  // statt eines gemeinsamen "alle Datensätze"-Arrays, damit die aktiven Ansichten (Übersicht,
  // Redaktionsanlässe, Kalender usw.) unverändert einfach über die "normalen" States laufen
  // und nicht bei jedem Rendern nach archived_at filtern müssen.
  const [archivedItems, setArchivedItems] = useState<any[]>([]);
  const [archivedPosts, setArchivedPosts] = useState<any[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<any[]>([]);

  // Auth-Session laden und auf Änderungen (Anmeldung/Abmeldung) reagieren.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Daten laden + Echtzeit-Synchronisierung, sobald eine Anmeldung besteht.
  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    const loadAll = async () => {
      const [itemsRes, postsRes, tasksRes, materialsRes, quickLinksRes, formatQuickLinksRes, formatsRes, postRulesRes, taskRulesRes, archivedItemsRes, archivedPostsRes, archivedTasksRes] = await Promise.all([
        supabase.from('editorial_items').select('*, editorial_formats(name, category, logic_type)').is('archived_at', null).order('created_at'),
        supabase.from('posts').select('*').is('archived_at', null).order('planned_date'),
        supabase.from('tasks').select('*').is('archived_at', null).order('due_date'),
        supabase.from('materials').select('*').order('due_date'),
        supabase.from('quick_links').select('*').order('sort_order'),
        supabase.from('format_quick_links').select('*').order('sort_order'),
        supabase.from('editorial_formats').select('*').eq('active', true).order('category').order('name'),
        supabase.from('post_rules').select('*').eq('active', true),
        supabase.from('task_rules').select('*').eq('active', true),
        supabase.from('editorial_items').select('*, editorial_formats(name, category, logic_type)').not('archived_at', 'is', null).order('archived_at', { ascending: false }),
        supabase.from('posts').select('*').not('archived_at', 'is', null),
        supabase.from('tasks').select('*').not('archived_at', 'is', null),
      ]);
      if (cancelled) return;
      if (itemsRes.error) console.error('Redaktionsanlässe konnten nicht geladen werden', itemsRes.error);
      if (postsRes.error) console.error('Posts konnten nicht geladen werden', postsRes.error);
      if (tasksRes.error) console.error('Aufgaben konnten nicht geladen werden', tasksRes.error);
      if (materialsRes.error) console.error('Materialien konnten nicht geladen werden', materialsRes.error);
      if (quickLinksRes.error) console.error('Schnellzugriff-Links konnten nicht geladen werden', quickLinksRes.error);
      if (formatQuickLinksRes.error) console.error('Format-Schnellzugriff-Links konnten nicht geladen werden', formatQuickLinksRes.error);
      if (formatsRes.error) console.error('Formate konnten nicht geladen werden', formatsRes.error);
      if (postRulesRes.error) console.error('Post-Regeln konnten nicht geladen werden', postRulesRes.error);
      if (taskRulesRes.error) console.error('Aufgaben-Regeln konnten nicht geladen werden', taskRulesRes.error);
      if (archivedItemsRes.error) console.error('Archivierte Redaktionsanlässe konnten nicht geladen werden', archivedItemsRes.error);
      if (archivedPostsRes.error) console.error('Archivierte Postings konnten nicht geladen werden', archivedPostsRes.error);
      if (archivedTasksRes.error) console.error('Archivierte Aufgaben konnten nicht geladen werden', archivedTasksRes.error);
      setItems((itemsRes.data ?? []).map(mapItem));
      setPosts((postsRes.data ?? []).map(mapPost));
      setTasks((tasksRes.data ?? []).map(mapTask));
      setMaterials((materialsRes.data ?? []).map(mapMaterial));
      setQuickLinks((quickLinksRes.data ?? []).map(mapQuickLink));
      setFormatQuickLinks((formatQuickLinksRes.data ?? []).map(mapFormatQuickLink));
      setFormats((formatsRes.data ?? []).map(mapFormat));
      setPostRules((postRulesRes.data ?? []).map(mapPostRule));
      setTaskRules((taskRulesRes.data ?? []).map(mapTaskRule));
      setArchivedItems((archivedItemsRes.data ?? []).map(mapItem));
      setArchivedPosts((archivedPostsRes.data ?? []).map(mapPost));
      setArchivedTasks((archivedTasksRes.data ?? []).map(mapTask));
    };

    void loadAll();

    // Upsert/Entfernen einer Zeile in einem State-Array anhand ihrer id.
    const applyChange = <T,>(setter: (updater: (current: T[]) => T[]) => void, mapRow: (row: any) => T) =>
      (payload: any) => {
        setter((current) => {
          if (payload.eventType === 'DELETE') return current.filter((entry: any) => entry.id !== payload.old.id);
          const mapped = mapRow(payload.new);
          const exists = current.some((entry: any) => (entry as any).id === (mapped as any).id);
          return exists ? current.map((entry: any) => (entry.id === (mapped as any).id ? mapped : entry)) : [...current, mapped];
        });
      };

    // Wie applyChange, aber für Tabellen mit archived_at: routet je nach aktuellem
    // archived_at-Wert der Zeile zwischen aktivem und Archiv-State um, statt beide
    // unabhängig zu pflegen. So landet z. B. ein Post nach dem Archivieren seines
    // Redaktionsanlasses automatisch im Archiv-State, ein reaktivierter Datensatz
    // ebenso automatisch zurück im aktiven State – ohne dass die Views selbst
    // filtern müssten.
    const applyArchivableChange = <T,>(
      setActive: (updater: (current: T[]) => T[]) => void,
      setArchived: (updater: (current: T[]) => T[]) => void,
      mapRow: (row: any) => T,
    ) => (payload: any) => {
      if (payload.eventType === 'DELETE') {
        setActive((current) => current.filter((entry: any) => entry.id !== payload.old.id));
        setArchived((current) => current.filter((entry: any) => entry.id !== payload.old.id));
        return;
      }
      const mapped = mapRow(payload.new);
      const upsert = (current: T[]) => {
        const exists = current.some((entry: any) => entry.id === (mapped as any).id);
        return exists ? current.map((entry: any) => (entry as any).id === (mapped as any).id ? mapped : entry) : [...current, mapped];
      };
      if (payload.new.archived_at) {
        setActive((current) => current.filter((entry: any) => entry.id !== (mapped as any).id));
        setArchived(upsert);
      } else {
        setArchived((current) => current.filter((entry: any) => entry.id !== (mapped as any).id));
        setActive(upsert);
      }
    };

    // Für editorial_items reicht die generische applyChange()-Logik nicht: Realtime-Payloads
    // enthalten nie die verknüpften Formatdaten (die kommen nur bei einer expliziten Abfrage
    // mit .select(..., editorial_formats(...)) mit). Ohne diese Anreicherung würden Format und
    // Kategorie eines Redaktionsanlasses nach jeder Änderung (Anlegen, Termin bearbeiten usw.)
    // in der Oberfläche verschwinden, auch wenn der Datensatz in Supabase korrekt ist. Zusätzlich
    // wird hier – analog zu applyArchivableChange – zwischen aktivem und Archiv-State geroutet.
    const applyItemChange = (payload: any) => {
      if (payload.eventType === 'DELETE') {
        setItems((current) => current.filter((entry) => entry.id !== payload.old.id));
        setArchivedItems((current) => current.filter((entry) => entry.id !== payload.old.id));
        return;
      }
      const format = formatsRef.current.find((entry) => entry.id === payload.new.format_id);
      const enrichedRow = { ...payload.new, editorial_formats: format ? { name: format.name, category: format.category, logic_type: format.logicType } : payload.new.editorial_formats };
      const mapped = mapItem(enrichedRow);
      const upsert = (current: any[]) => {
        const exists = current.some((entry) => entry.id === mapped.id);
        return exists ? current.map((entry) => (entry.id === mapped.id ? mapped : entry)) : [...current, mapped];
      };
      if (payload.new.archived_at) {
        setItems((current) => current.filter((entry) => entry.id !== mapped.id));
        setArchivedItems(upsert);
      } else {
        setArchivedItems((current) => current.filter((entry) => entry.id !== mapped.id));
        setItems(upsert);
      }
    };

    const channel = supabase
      .channel('redaktionsdashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editorial_items' }, applyItemChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, applyArchivableChange(setPosts, setArchivedPosts, mapPost))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, applyArchivableChange(setTasks, setArchivedTasks, mapTask))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, applyChange(setMaterials, mapMaterial))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_links' }, applyChange(setQuickLinks, mapQuickLink))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'format_quick_links' }, applyChange(setFormatQuickLinks, mapFormatQuickLink))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editorial_formats' }, applyChange(setFormats, mapFormat))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_rules' }, applyChange(setPostRules, mapPostRule))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_rules' }, applyChange(setTaskRules, mapTaskRule))
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session]);

  // Sprung von einer Zeile in "Redaktionsanlässe" zu den Aufgaben genau dieses Anlasses: setzt
  // den regulären Anlass-Filter (siehe FilterBar) und wechselt in die Aufgaben-Ansicht. Der
  // Filter bleibt danach wie jeder andere FilterBar-Filter aktiv, bis er dort geändert oder über
  // "Zurücksetzen" gelöscht wird.
  const viewTasksForItem = useCallback((itemId: string) => {
    setFilters((current) => ({ ...current, item: itemId }));
    setView('Aufgaben');
  }, []);

  const density = postingDensity(posts);
  const conflictWeekKey = Object.keys(density).find((key) => density[key].level === 'conflict') ?? mondayOfWeek(TODAY);
  const conflict = density[conflictWeekKey];

  const completeTask = useCallback((id: string) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status: task.status === 'erledigt' ? 'offen' : 'erledigt' } : task));
    const task = tasks.find((entry) => entry.id === id);
    const nextStatus = task?.status === 'erledigt' ? 'offen' : 'erledigt';
    supabase.from('tasks').update({ status: nextStatus }).eq('id', id).then(({ error }) => {
      if (error) console.error('Aufgabe konnte nicht aktualisiert werden', error);
    });
  }, [tasks]);

  const updateTask = useCallback((id: string, changes: Record<string, any>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
    const columns = Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [TASK_COLUMN[key] ?? key, value]),
    );
    supabase.from('tasks').update(columns).eq('id', id).then(({ error }) => {
      if (error) console.error('Aufgabe konnte nicht gespeichert werden', error);
    });
  }, []);

  const [editingTask, setEditingTask] = useState<any>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: '', owner: 'Tom', dueDate: '', status: 'offen', priority: 50, notes: '', editorialItemId: '', referenceUrl: '' });

  const startEditingTask = useCallback((task: any) => {
    setEditingTask(task);
    setCreatingTask(false);
    setTaskDraft({ title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status, priority: task.priority ?? 50, notes: task.notes ?? '', editorialItemId: task.editorialItemId, referenceUrl: task.referenceUrl ?? '' });
  }, []);

  const startCreatingTask = useCallback(() => {
    setEditingTask(null);
    setCreatingTask(true);
    setTaskDraft({ title: '', owner: 'Tom', dueDate: TODAY, status: 'offen', priority: 50, notes: '', editorialItemId: items[0]?.id ?? '', referenceUrl: '' });
  }, [items]);

  const saveTaskEdit = useCallback(() => {
    if (!taskDraft.title.trim() || !taskDraft.dueDate) return;
    if (editingTask) {
      updateTask(editingTask.id, { title: taskDraft.title.trim(), owner: taskDraft.owner, dueDate: taskDraft.dueDate, status: taskDraft.status, priority: taskDraft.priority, notes: taskDraft.notes, referenceUrl: taskDraft.referenceUrl.trim() || null });
      setEditingTask(null);
      return;
    }
    if (creatingTask) {
      if (!taskDraft.editorialItemId) return;
      // Neue, manuell angelegte Aufgabe. Erscheint automatisch über die bereits
      // bestehende Echtzeit-Subscription (postgres_changes INSERT), sobald
      // Supabase die Zeile bestätigt hat – kein lokales Vor-Einfügen nötig.
      supabase.from('tasks').insert({
        editorial_item_id: taskDraft.editorialItemId,
        title: taskDraft.title.trim(),
        owner_name: taskDraft.owner,
        due_date: taskDraft.dueDate,
        status: taskDraft.status,
        priority: taskDraft.priority,
        notes: taskDraft.notes || null,
        reference_url: taskDraft.referenceUrl.trim() || null,
        task_type: 'manuell',
        auto_generated: false,
      }).then(({ error }) => {
        if (error) console.error('Aufgabe konnte nicht angelegt werden', error);
      });
      setCreatingTask(false);
    }
  }, [editingTask, creatingTask, taskDraft, updateTask]);

  const cancelTaskEdit = useCallback(() => { setEditingTask(null); setCreatingTask(false); }, []);

  const deleteTask = useCallback((id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Diese Aufgabe wirklich löschen?')) return;
    setTasks((current) => current.filter((task) => task.id !== id));
    supabase.from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).then(({ error }) => {
      if (error) console.error('Aufgabe konnte nicht gelöscht werden', error);
    });
    setEditingTask(null);
  }, []);

  const [movingPost, setMovingPost] = useState<any>(null);
  const [moveDate, setMoveDate] = useState('');

  const startMovingPost = useCallback((post: any) => {
    setMovingPost(post);
    setMoveDate(post.plannedDate);
  }, []);

  const cancelMovePost = useCallback(() => setMovingPost(null), []);

  const [openItemId, setOpenItemId] = useState<string | null>(null);

  // Öffnet den passenden Kategorie-Unterordner in SharePoint in einem neuen Tab. Kopiert
  // bewusst NICHTS mehr pauschal in die Zwischenablage (frühere Version) – bei mehrstufigen
  // Pfaden (Modul/Schnupperkurs-Gruppierung, siehe sharepointRelativePath) lässt sich ein
  // zusammengefügter Pfad nicht sinnvoll in SharePoints "Neuer Ordner"-Dialog einfügen. Das
  // Kopieren einzelner Ebenen übernehmen stattdessen die Chips im Detaildialog (copySegment).
  const openSharePointFolder = useCallback((item: any) => {
    const url = sharepointOpenUrl(item, [...items, ...archivedItems]);
    if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  }, [items, archivedItems]);
  const openItem = items.find((item) => item.id === openItemId) ?? null;
  const detailPosts = posts.filter((post) => post.editorialItemId === openItemId).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const detailTasks = tasks.filter((task) => task.editorialItemId === openItemId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const detailMaterials = materials.filter((material) => material.editorialItemId === openItemId);

  // Dieselbe "Details öffnen"-Mechanik wie oben, aber für die Archiv-Ansicht: eigener
  // State/eigene Ableitung, damit ein Klick in der Archiv-Liste nicht versehentlich auch den
  // normalen Detaildialog für aktive Anlässe öffnet (beide Dialoge sind gleichzeitig gemountet).
  const [openArchivedItemId, setOpenArchivedItemId] = useState<string | null>(null);
  const openArchivedItem = archivedItems.find((item) => item.id === openArchivedItemId) ?? null;
  const archivedDetailPosts = archivedPosts.filter((post) => post.editorialItemId === openArchivedItemId).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const archivedDetailTasks = archivedTasks.filter((task) => task.editorialItemId === openArchivedItemId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const archivedDetailMaterials = materials.filter((material) => material.editorialItemId === openArchivedItemId);

  const [editingLink, setEditingLink] = useState<any>(null);
  const [linkDraft, setLinkDraft] = useState({ label: '', url: '' });

  const startEditingLink = useCallback((link: any) => {
    setEditingLink(link);
    setLinkDraft({ label: link.label, url: link.url });
  }, []);

  const cancelLinkEdit = useCallback(() => setEditingLink(null), []);

  const saveLinkEdit = useCallback(() => {
    if (!editingLink || !linkDraft.label.trim()) return;
    const changes = { label: linkDraft.label.trim(), url: linkDraft.url.trim() };
    setQuickLinks((current) => current.map((link) => link.id === editingLink.id ? { ...link, ...changes } : link));
    supabase.from('quick_links').update(changes).eq('id', editingLink.id).then(({ error }) => {
      if (error) console.error('Schnellzugriff-Link konnte nicht gespeichert werden', error);
    });
    setEditingLink(null);
  }, [editingLink, linkDraft]);

  const emptyItemDraft = useCallback(() => ({
    formatId: formats[0]?.id ?? '',
    title: '',
    subtitle: '',
    eventStart: TODAY,
    eventStartTime: '09:00',
    eventEnd: '',
    eventEndTime: '17:00',
    location: '',
    instructors: '',
    publicationTargetDate: TODAY,
    eventReferenceDate: TODAY,
    materialReadyDate: '',
    contentOwner: formats[0]?.defaultContentOwner ?? 'Tom',
    graphicsOwner: formats[0]?.defaultGraphicsOwner ?? 'Tom',
    approvalOwner: formats[0]?.defaultApprovalOwner ?? 'Tom',
    publishOwner: formats[0]?.defaultPublishOwner ?? 'Norbert',
  }), [formats]);

  const [creatingItem, setCreatingItem] = useState(false);
  const [itemDraft, setItemDraft] = useState<any>(emptyItemDraft());
  const [savingItem, setSavingItem] = useState(false);
  const [itemSaveError, setItemSaveError] = useState('');

  const startCreatingItem = useCallback(() => {
    setItemDraft(emptyItemDraft());
    setItemSaveError('');
    setCreatingItem(true);
  }, [emptyItemDraft]);

  const cancelCreatingItem = useCallback(() => { setCreatingItem(false); setItemSaveError(''); }, []);

  // Bei Formatwechsel im Formular die Verantwortlichen auf die Format-Vorgaben zurücksetzen.
  const chooseItemFormat = useCallback((formatId: string) => {
    const format = formats.find((entry) => entry.id === formatId);
    const defaults = format ? DEFAULT_EVENT_TIMES[format.slug] : undefined;
    setItemDraft((current: any) => {
      const next = {
        ...current,
        formatId,
        contentOwner: format?.defaultContentOwner ?? current.contentOwner,
        graphicsOwner: format?.defaultGraphicsOwner ?? current.graphicsOwner,
        approvalOwner: format?.defaultApprovalOwner ?? current.approvalOwner,
        publishOwner: format?.defaultPublishOwner ?? current.publishOwner,
      };
      if (!defaults) return next;
      next.eventStartTime = defaults.startTime;
      next.eventEndTime = defaults.endTime;
      // Bei Modulen (freitags bis sonntags) zusätzlich das nächste passende Wochenende
      // vorschlagen, statt nur die Uhrzeit zu setzen – bleibt wie alles hier änderbar.
      if (defaults.multiDay) {
        const friday = nextWeekday(current.eventStart || TODAY, 5);
        next.eventStart = friday;
        next.eventEnd = nextWeekday(friday, 0); // 0 = Sonntag, ab dem gefundenen Freitag
      }
      return next;
    });
  }, [formats]);

  const saveItemCreate = useCallback(async () => {
    const format = formats.find((entry) => entry.id === itemDraft.formatId);
    if (!format || !itemDraft.title.trim()) return;
    setSavingItem(true);
    setItemSaveError('');

    const row = {
      format_id: format.id,
      title: itemDraft.title.trim(),
      subtitle: itemDraft.subtitle.trim() || null,
      event_start: format.logicType === 'event' && itemDraft.eventStart ? new Date(`${itemDraft.eventStart}T${itemDraft.eventStartTime || '09:00'}:00`).toISOString() : null,
      event_end: format.logicType === 'event' && itemDraft.eventEnd ? new Date(`${itemDraft.eventEnd}T${itemDraft.eventEndTime || '17:00'}:00`).toISOString() : null,
      event_location: format.logicType === 'event' ? (itemDraft.location.trim() || null) : null,
      instructors: format.logicType === 'event' ? (itemDraft.instructors.trim() || null) : null,
      publication_target_date: format.logicType === 'publication' ? itemDraft.publicationTargetDate || null : null,
      event_reference_date: format.logicType === 'event_material' ? itemDraft.eventReferenceDate || null : null,
      material_ready_date: format.logicType === 'event_material' ? itemDraft.materialReadyDate || null : null,
      content_owner: itemDraft.contentOwner,
      graphics_owner: itemDraft.graphicsOwner,
      approval_owner: itemDraft.approvalOwner,
      publish_owner: itemDraft.publishOwner,
    };

    const { data: inserted, error: insertError } = await supabase.from('editorial_items').insert(row).select().single();
    if (insertError || !inserted) {
      console.error('Redaktionsanlass konnte nicht angelegt werden', insertError);
      setItemSaveError('Anlegen fehlgeschlagen. Bitte erneut versuchen.');
      setSavingItem(false);
      return;
    }

    // Sofort lokal übernehmen (inkl. Format/Kategorie) statt nur auf die Echtzeit-Zustellung zu
    // warten, die für editorial_items bei alleiniger Nutzung unzuverlässig/verzögert ankommen kann.
    setItems((current) => [...current, mapItem({ ...inserted, editorial_formats: { name: format.name, category: format.category, logic_type: format.logicType } })]);

    // Zeitplan (Posts + Aufgaben) über dieselbe Logik erzeugen, die auch die
    // Kalender-/Aufgabenautomatik im laufenden Betrieb nutzt.
    const scheduleItem = {
      id: inserted.id,
      formatId: format.id,
      logicType: format.logicType,
      eventStart: row.event_start ? row.event_start.slice(0, 10) : undefined,
      eventEnd: row.event_end ? row.event_end.slice(0, 10) : undefined,
      publicationTargetDate: row.publication_target_date ?? undefined,
      eventReferenceDate: row.event_reference_date ?? undefined,
      materialReadyDate: row.material_ready_date ?? undefined,
      contentOwner: row.content_owner,
      graphicsOwner: row.graphics_owner,
      approvalOwner: row.approval_owner,
      publishOwner: row.publish_owner,
    };
    const { posts: newPosts, tasks: newTasks } = generateSchedule({ item: scheduleItem, postRules, taskRules, today: TODAY });

    let insertedPosts: any[] = [];
    if (newPosts.length) {
      const { data, error } = await supabase.from('posts').insert(newPosts.map((post: any) => ({
        editorial_item_id: post.editorialItemId,
        post_rule_id: post.postRuleId,
        post_type: post.type,
        planned_date: post.plannedDate,
        regular_date: post.regularDate,
        status: post.status,
        conditional: post.conditional,
        conditional_state: post.conditionalState,
        late_entry: post.lateEntry,
        priority: post.priority,
      }))).select('*');
      if (error) console.error('Postings konnten nicht angelegt werden', error);
      insertedPosts = data ?? [];
      if (insertedPosts.length) setPosts((current) => [...current, ...insertedPosts.map(mapPost)]);
    }

    if (newTasks.length) {
      // Temporäre generateSchedule-IDs (nur lokal) auf die echten Supabase-IDs der
      // gerade angelegten Posts ummappen, damit tasks.post_id gültig auf posts.id zeigt.
      const ruleIdToRealPostId = Object.fromEntries(insertedPosts.map((row2) => [row2.post_rule_id, row2.id]));
      const tempIdToRealPostId = Object.fromEntries(newPosts.map((post: any) => [post.id, ruleIdToRealPostId[post.postRuleId]]));
      const { data: insertedTasks, error } = await supabase.from('tasks').insert(newTasks.map((task: any) => ({
        editorial_item_id: task.editorialItemId,
        post_id: task.postId ? tempIdToRealPostId[task.postId] ?? null : null,
        title: task.title,
        owner_name: task.owner,
        due_date: task.dueDate,
        status: task.status,
        task_type: task.type,
        relative_offset_days: task.relativeOffsetDays ?? null,
        auto_generated: task.autoGenerated,
      }))).select('*');
      if (error) console.error('Aufgaben konnten nicht angelegt werden', error);
      if (insertedTasks?.length) setTasks((current) => [...current, ...insertedTasks.map(mapTask)]);
    }

    setSavingItem(false);
    setCreatingItem(false);
    // Für Norbert (zweites Gerät) kommt der neue Anlass zusätzlich über die
    // Realtime-Subscription an; hier oben ist er dank der lokalen Übernahme
    // aber sofort sichtbar, ohne auf die Zustellung warten zu müssen.
  }, [formats, itemDraft, postRules, taskRules]);

  const applyItemUpdate = useCallback((updatedItem: any) => {
    setItems((current) => current.map((entry) => (entry.id === updatedItem.id ? updatedItem : entry)));
  }, []);

  const saveMovePost = useCallback(() => {
    if (!movingPost || !moveDate) return;
    const { posts: updatedPosts, tasks: updatedTasks } = movePost(posts, tasks, movingPost.id, moveDate);
    setPosts(updatedPosts);
    setTasks(updatedTasks);
    supabase.from('posts').update({ planned_date: moveDate, manually_adjusted: true }).eq('id', movingPost.id).then(({ error }) => {
      if (error) console.error('Termin konnte nicht verschoben werden', error);
    });
    // Nur die Aufgaben in Supabase nachziehen, deren Fälligkeit von diesem Post abhängt.
    updatedTasks
      .filter((task: any) => task.postId === movingPost.id && task.relativeOffsetDays != null)
      .forEach((task: any) => {
        supabase.from('tasks').update({ due_date: task.dueDate }).eq('id', task.id).then(({ error }) => {
          if (error) console.error('Aufgabenfrist konnte nicht aktualisiert werden', error);
        });
      });
    setMovingPost(null);
  }, [movingPost, moveDate, posts, tasks]);

  const reassignTaskTo = useCallback((id: string, owner: string) => {
    setTasks((current) => validateReassign(current, id, owner));
    supabase.from('tasks').update({ owner_name: owner }).eq('id', id).then(({ error }) => {
      if (error) console.error('Übergabe konnte nicht gespeichert werden', error);
    });
  }, []);

  // Löscht ein einzelnes Posting (Soft-Delete über archived_at, analog zu deleteTask oben).
  // Zugehörige Aufgaben (task.postId) bleiben bestehen – eine Kaskaden-Archivierung ist erst
  // beim Löschen eines ganzen Redaktionsanlasses vorgesehen (separate Funktion).
  const deletePost = useCallback((id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Dieses Posting wirklich löschen?')) return;
    setPosts((current) => current.filter((post) => post.id !== id));
    supabase.from('posts').update({ archived_at: new Date().toISOString() }).eq('id', id).then(({ error }) => {
      if (error) console.error('Posting konnte nicht gelöscht werden', error);
    });
  }, []);

  // Verschiebt einen ganzen Redaktionsanlass ins Archiv (setzt archived_at) inkl. Kaskaden-
  // Archivierung aller zugehörigen Postings und Aufgaben. Die aktiven Ansichten filtern
  // ohnehin schon nach "archived_at is null" beim Laden, dadurch verschwinden Postings/
  // Aufgaben automatisch mit; die Echtzeit-Routen (applyArchivableChange/applyItemChange)
  // sorgen dafür, dass alles gleichzeitig im Archiv-State auftaucht. Anders als beim früheren,
  // gleichnamigen Vorgehen ist das hier reversibel (siehe reactivateItem) und läuft daher ohne
  // Sicherheitsabfrage – die gibt es nur noch bei der endgültigen Löschung (hardDeleteItem).
  const performArchiveItem = useCallback((id: string) => {
    const now = new Date().toISOString();
    setItems((current) => current.filter((entry) => entry.id !== id));
    setPosts((current) => current.filter((post) => post.editorialItemId !== id));
    setTasks((current) => current.filter((task) => task.editorialItemId !== id));
    setOpenItemId((current) => (current === id ? null : current));
    supabase.from('editorial_items').update({ archived_at: now }).eq('id', id).then(({ error }) => {
      if (error) console.error('Redaktionsanlass konnte nicht archiviert werden', error);
    });
    supabase.from('posts').update({ archived_at: now }).eq('editorial_item_id', id).then(({ error }) => {
      if (error) console.error('Postings des Anlasses konnten nicht archiviert werden', error);
    });
    supabase.from('tasks').update({ archived_at: now }).eq('editorial_item_id', id).then(({ error }) => {
      if (error) console.error('Aufgaben des Anlasses konnten nicht archiviert werden', error);
    });
  }, []);

  // Manueller Auslöser über die "Ins Archiv verschieben"-Buttons in den Listen/Detailansichten.
  const archiveItem = useCallback((id: string) => {
    performArchiveItem(id);
  }, [performArchiveItem]);

  // Endgültiges, unwiderrufliches Löschen eines bereits archivierten Redaktionsanlasses. Die
  // Fremdschlüssel von posts/tasks/materials auf editorial_items stehen alle auf ON DELETE
  // CASCADE, ein DELETE hier räumt also automatisch mit auf – separate DELETEs auf posts/tasks
  // sind anders als bei performArchiveItem nicht nötig.
  const hardDeleteItem = useCallback((id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Diesen Redaktionsanlass endgültig löschen? Das kann nicht rückgängig gemacht werden – inklusive aller zugehörigen Postings, Aufgaben und Materialien.')) return;
    setArchivedItems((current) => current.filter((entry) => entry.id !== id));
    setArchivedPosts((current) => current.filter((post) => post.editorialItemId !== id));
    setArchivedTasks((current) => current.filter((task) => task.editorialItemId !== id));
    setMaterials((current) => current.filter((material) => material.editorialItemId !== id));
    supabase.from('editorial_items').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('Redaktionsanlass konnte nicht endgültig gelöscht werden', error);
    });
  }, []);

  // Reaktiviert einen archivierten Anlass NICHT durch bloßes Zurücksetzen von archived_at,
  // sondern öffnet den normalen Anlegen-Dialog, vorausgefüllt mit den Daten des archivierten
  // Anlasses. Grund: Ein reaktivierter Anlass (z. B. eine wiederholte Veranstaltung) braucht
  // ohnehin einen neuen, aktuellen Termin und einen frischen Posting-/Aufgaben-Zeitplan – ein
  // 1:1-Zurückholen der alten, längst verstrichenen Termine wäre nicht sinnvoll nutzbar.
  const reactivateItem = useCallback((item: any) => {
    setItemDraft({
      formatId: item.formatId,
      title: item.title,
      subtitle: item.subtitle ?? '',
      eventStart: item.eventStart || TODAY,
      eventStartTime: item.eventStartTime || '09:00',
      eventEnd: item.eventEnd || '',
      eventEndTime: item.eventEndTime || '17:00',
      location: item.location ?? '',
      instructors: item.instructors ?? '',
      publicationTargetDate: item.publicationTargetDate || TODAY,
      eventReferenceDate: item.eventReferenceDate || TODAY,
      materialReadyDate: item.materialReadyDate ?? '',
      contentOwner: item.contentOwner,
      graphicsOwner: item.graphicsOwner,
      approvalOwner: item.approvalOwner,
      publishOwner: item.publishOwner,
    });
    setItemSaveError('');
    setCreatingItem(true);
  }, []);

  // "Material hinzufügen": eigenständiger, schlanker Anlegen-Dialog (kein Bearbeiten
  // bestehender Materialien vorgesehen – dafür reicht aktuell direktes Ändern in Supabase).
  // itemId ist optional vorbelegt, wenn der Dialog aus der Detailansicht eines konkreten
  // Anlasses heraus geöffnet wird (ItemDetailDialog); aus der globalen Materialien-Ansicht
  // heraus (MaterialsView) muss der Anlass frei gewählt werden.
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [materialDraft, setMaterialDraft] = useState({ editorialItemId: '', postId: '', materialType: 'Text', title: '', required: true, status: 'fehlt', url: '', dueDate: '', notes: '' });

  const startCreatingMaterial = useCallback((itemId?: string) => {
    setMaterialDraft({ editorialItemId: itemId || items[0]?.id || '', postId: '', materialType: 'Text', title: '', required: true, status: 'fehlt', url: '', dueDate: '', notes: '' });
    setCreatingMaterial(true);
  }, [items]);

  const cancelCreatingMaterial = useCallback(() => setCreatingMaterial(false), []);

  const saveMaterialCreate = useCallback(() => {
    if (!materialDraft.editorialItemId || !materialDraft.title.trim()) return;
    supabase.from('materials').insert({
      editorial_item_id: materialDraft.editorialItemId,
      post_id: materialDraft.postId || null,
      material_type: materialDraft.materialType,
      title: materialDraft.title.trim(),
      required: materialDraft.required,
      status: materialDraft.status,
      url: materialDraft.url.trim() || null,
      due_date: materialDraft.dueDate || null,
      notes: materialDraft.notes.trim() || null,
    }).select().single().then(({ data, error }) => {
      if (error || !data) { console.error('Material konnte nicht angelegt werden', error); return; }
      // Sofort lokal übernehmen statt nur auf die Echtzeit-Zustellung zu warten (analog zu
      // saveItemCreate) – materials ist ohnehin schon per Realtime abonniert, das hier sorgt
      // nur für sofortige Sichtbarkeit ohne Wartezeit.
      setMaterials((current) => [...current, mapMaterial(data)]);
    });
    setCreatingMaterial(false);
  }, [materialDraft]);

  // Verwaltung der formatspezifischen Schnellzugriff-Links (FormatsAndRulesView). Ein
  // gemeinsamer Dialog-Zustand für Anlegen UND Bearbeiten: formatLinkDraft.id === null
  // bedeutet "wird neu angelegt", sonst wird der bestehende Link mit dieser id aktualisiert.
  const [formatLinkDraft, setFormatLinkDraft] = useState<any>(null);

  const startCreatingFormatLink = useCallback((formatId: string) => {
    setFormatLinkDraft({ id: null, formatId, label: '', url: '' });
  }, []);

  const startEditingFormatLink = useCallback((link: any) => {
    setFormatLinkDraft({ id: link.id, formatId: link.formatId, label: link.label, url: link.url });
  }, []);

  const cancelFormatLinkEdit = useCallback(() => setFormatLinkDraft(null), []);

  const saveFormatLinkEdit = useCallback(() => {
    if (!formatLinkDraft || !formatLinkDraft.label.trim()) return;
    const label = formatLinkDraft.label.trim();
    const url = formatLinkDraft.url.trim();
    if (formatLinkDraft.id) {
      setFormatQuickLinks((current) => current.map((link) => link.id === formatLinkDraft.id ? { ...link, label, url } : link));
      supabase.from('format_quick_links').update({ label, url }).eq('id', formatLinkDraft.id).then(({ error }) => {
        if (error) console.error('Format-Link konnte nicht gespeichert werden', error);
      });
    } else {
      supabase.from('format_quick_links').insert({ format_id: formatLinkDraft.formatId, label, url }).select().single().then(({ data, error }) => {
        if (error || !data) { console.error('Format-Link konnte nicht angelegt werden', error); return; }
        setFormatQuickLinks((current) => [...current, mapFormatQuickLink(data)]);
      });
    }
    setFormatLinkDraft(null);
  }, [formatLinkDraft]);

  const deleteFormatLink = useCallback((id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Diesen Link wirklich löschen?')) return;
    setFormatQuickLinks((current) => current.filter((link) => link.id !== id));
    supabase.from('format_quick_links').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('Format-Link konnte nicht gelöscht werden', error);
    });
  }, []);

  // Automatische Archivierung: sobald ein aktiver Anlass isItemComplete() erfüllt (Termin
  // verstrichen + alle zugehörigen Aufgaben erledigt/gestrichen), wird er ohne weiteres Zutun
  // archiviert. Läuft bei jeder Änderung an items/tasks erneut – ein bereits archivierter Anlass
  // taucht danach nicht mehr in "items" auf und wird beim nächsten Durchlauf übersprungen.
  useEffect(() => {
    items.filter((item) => isItemComplete(item, tasks, TODAY)).forEach((item) => performArchiveItem(item.id));
  }, [items, tasks, performArchiveItem]);

  const resolveConflict = useCallback(() => {
    if (!conflict || conflict.level !== 'conflict') return;
    const weekPosts = posts.filter((post) => mondayOfWeek(post.plannedDate) === conflictWeekKey && post.status !== 'entfallen');
    const candidate = [...weekPosts].sort((a, b) => a.priority - b.priority)[0];
    if (!candidate) return;
    const newDate = addDays(candidate.plannedDate, 7);
    setPosts((current) => current.map((post) => post.id === candidate.id ? { ...post, plannedDate: newDate, status: 'vorgesehen', manuallyAdjusted: true } : post));
    supabase.from('posts').update({ planned_date: newDate, status: 'vorgesehen', manually_adjusted: true }).eq('id', candidate.id).then(({ error }) => {
      if (error) console.error('Termin konnte nicht verschoben werden', error);
    });
    return candidate;
  }, [conflict, conflictWeekKey, posts]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn('WebMCP tool registration failed', error);
    const register = (tool: Parameters<typeof context.registerTool>[0]) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(report); } catch (error) { report(error); }
    };
    register({
      name: 'reassign_editorial_task', title: 'Redaktionsaufgabe übergeben',
      description: 'Weist eine vorhandene Redaktionsaufgabe Tom oder Norbert zu und speichert die Änderung.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, owner: { type: 'string', enum: ['Tom', 'Norbert'] } }, required: ['taskId', 'owner'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const taskId = typeof input === 'object' && input !== null && 'taskId' in input ? String(input.taskId) : '';
        const owner = typeof input === 'object' && input !== null && 'owner' in input ? String(input.owner) : '';
        reassignTaskTo(taskId, owner);
        return { taskId, owner };
      },
    });
    register({
      name: 'complete_editorial_task', title: 'Redaktionsaufgabe abschließen',
      description: 'Markiert eine vorhandene Aufgabe im sichtbaren Redaktionsdashboard als erledigt.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const taskId = typeof input === 'object' && input !== null && 'taskId' in input ? String(input.taskId) : '';
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw new Error('Unbekannte taskId');
        updateTask(taskId, { status: 'erledigt' });
        return { taskId, status: 'erledigt' };
      },
    });
    register({
      name: 'apply_density_conflict_suggestion', title: 'Dichtekonflikt lösen',
      description: 'Verschiebt den Post mit der niedrigsten Priorität in der überlasteten Kalenderwoche eine Woche nach hinten.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        const moved = resolveConflict();
        return moved ? { postId: moved.id, plannedDate: addDays(moved.plannedDate, 7) } : { moved: false };
      },
    });
    return () => lifecycle.abort();
  }, [tasks, updateTask, reassignTaskTo, resolveConflict]);

  const visiblePosts = posts.filter((post) => {
    const item = itemFor(items, post.editorialItemId);
    return (filters.person === 'Alle' || item.people.includes(filters.person)) &&
      (filters.time === 'Alle' || timeBucket(post.plannedDate) === filters.time) &&
      (filters.status === 'Alle' || post.status === filters.status) &&
      (filters.format === 'Alle' || item.format === filters.format) &&
      (filters.item === 'Alle' || post.editorialItemId === filters.item);
  });
  const visibleTasks = tasks.filter((task) => {
    const item = itemFor(items, task.editorialItemId);
    return (filters.person === 'Alle' || task.owner === filters.person) &&
      (filters.time === 'Alle' || timeBucket(task.dueDate) === filters.time) &&
      (filters.status === 'Alle' || task.status === filters.status) &&
      (filters.format === 'Alle' || item.format === filters.format) &&
      (filters.item === 'Alle' || task.editorialItemId === filters.item);
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const visibleMaterials = materials.filter((material) => {
    const item = itemFor(items, material.editorialItemId);
    return (filters.person === 'Alle' || item.people.includes(filters.person)) &&
      (filters.time === 'Alle' || timeBucket(material.dueDate) === filters.time) &&
      (filters.status === 'Alle' || material.status === filters.status) &&
      (filters.format === 'Alle' || item.format === filters.format) &&
      (filters.item === 'Alle' || material.editorialItemId === filters.item);
  });
  // Redaktionsanlässe selbst haben keinen eigenen "Status" (das gilt nur für Postings/Aufgaben) –
  // der Status-Filter wird hier daher bewusst nicht angewendet, Person/Zeitraum/Format/Anlass schon.
  const visibleItems = items.filter((item) => {
    const date = keyDateFor(item);
    return (filters.person === 'Alle' || item.people.includes(filters.person)) &&
      (filters.format === 'Alle' || item.format === filters.format) &&
      (filters.time === 'Alle' || (Boolean(date) && timeBucket(date) === filters.time)) &&
      (filters.item === 'Alle' || item.id === filters.item);
  });
  // Für den Anlass-Select in der FilterBar: alle Anlässe (unabhängig von anderen aktiven
  // Filtern), alphabetisch sortiert – analog zu formatNames unten.
  const itemOptions = [...items].map((item) => ({ id: item.id, title: item.title })).sort((a, b) => a.title.localeCompare(b.title, 'de'));

  if (session === undefined) return null;
  if (session === null) return <AuthGate />;

  return (
    <SidebarProvider style={{ '--sidebar-width': '218px' } as CSSProperties}>
      <Sidebar collapsible="icon" className="editorial-sidebar">
        <SidebarHeader className="brand-lockup">
          <div className="brand-mark"><img src="/assets/logo-singende-krankenhaeuser.png" alt="Logo Singende Krankenhäuser" width={70} height={112} loading="eager" /></div>
          <div className="brand-copy"><strong>Singende</strong><span>Krankenhäuser</span></div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Arbeitsbereich</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu>{nav.map(({ name, label, icon: Icon }) => (
              <SidebarMenuItem key={name}><SidebarMenuButton isActive={view === name} tooltip={name} onClick={() => setView(name)}>
                <Icon /><span>{label}</span>
              </SidebarMenuButton></SidebarMenuItem>
            ))}</SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Verwaltung</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton isActive={view === 'Formate & Regeln'} tooltip="Formate & Regeln" onClick={() => setView("Formate & Regeln")}><Sparkles /><span>Formate & Regeln</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton isActive={view === 'Archiv'} tooltip="Archiv" onClick={() => setView('Archiv')}><Archive /><span>Archiv</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="sidebar-brand-footer">
          <div className="sidebar-brand-blob"><span>Musik</span><span>Mensch</span><span>Miteinander</span></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="topbar">
          <div className="topbar-title"><SidebarTrigger className="md:hidden" /><div><strong>Redaktionsdashboard</strong><span>Gemeinsam mehr Musik im Leben</span></div></div>
          <div className="topbar-motto">Singen. Verbinden. Wirken.</div>
          <div className="topbar-user">
            <span>Angemeldet als {session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>Abmelden</Button>
          </div>
        </header>

        <div className="workspace">
          {view !== 'Übersicht' && view !== 'Formate & Regeln' && view !== 'Archiv' && <FilterBar filters={filters} onChange={setFilters} formatNames={formats.map((format) => format.name)} itemOptions={itemOptions} view={view} />}

          {view === 'Übersicht' && <Overview items={items} posts={posts} tasks={tasks} conflict={conflict} onNavigate={setView} onResolve={resolveConflict} onEditTask={startEditingTask} onOpenItem={setOpenItemId} quickLinks={quickLinks} onEditLink={startEditingLink} onCreateItem={startCreatingItem} />}
          {view === 'Redaktionsanlässe' && <EditorialItemsView items={visibleItems} tasks={tasks} onOpenItem={setOpenItemId} onCreateItem={startCreatingItem} onViewTasksForItem={viewTasksForItem} onArchiveItem={archiveItem} onOpenFolder={openSharePointFolder} />}
          {view === 'Redaktionsplan' && <EditorialPlan items={items} posts={visiblePosts} onOpenItem={setOpenItemId} onCreateItem={startCreatingItem} onDeletePost={deletePost} />}
          {view === 'Kalender' && <CalendarView items={items} posts={visiblePosts} onMovePost={startMovingPost} />}
          {view === 'Aufgaben' && <TasksView items={items} tasks={visibleTasks} onComplete={completeTask} onEdit={startEditingTask} onCreate={startCreatingTask} />}
          {view === 'Materialien' && <MaterialsView items={items} materials={visibleMaterials} onCreate={() => startCreatingMaterial()} />}
          {view === 'Formate & Regeln' && <FormatsAndRulesView formats={formats} postRules={postRules} formatQuickLinks={formatQuickLinks} onCreateLink={startCreatingFormatLink} onEditLink={startEditingFormatLink} onDeleteLink={deleteFormatLink} />}
          {view === 'Archiv' && <ArchivView items={archivedItems} onOpenItem={setOpenArchivedItemId} onReactivate={reactivateItem} onHardDelete={hardDeleteItem} />}
        </div>

        <TaskEditDialog items={items} editing={editingTask} creating={creatingTask} draft={taskDraft} setDraft={setTaskDraft} onSave={saveTaskEdit} onCancel={cancelTaskEdit} onDelete={deleteTask} />
        <PostMoveDialog items={items} moving={movingPost} date={moveDate} setDate={setMoveDate} onSave={saveMovePost} onCancel={cancelMovePost} />
        <MaterialEditDialog items={items} posts={posts} open={creatingMaterial} draft={materialDraft} setDraft={setMaterialDraft} onSave={saveMaterialCreate} onCancel={cancelCreatingMaterial} />
        <ItemDetailDialog item={openItem} posts={detailPosts} tasks={detailTasks} materials={detailMaterials} onClose={() => setOpenItemId(null)} onEditTask={startEditingTask} onMovePost={startMovingPost} onDeletePost={deletePost} onArchiveItem={archiveItem} onCreateMaterial={startCreatingMaterial} onPrepareFolder={openSharePointFolder} folderPathSegments={openItem ? sharepointRelativePath(openItem, [...items, ...archivedItems]) : []} onItemUpdated={applyItemUpdate} />
        <ItemDetailDialog
          item={openArchivedItem}
          posts={archivedDetailPosts}
          tasks={archivedDetailTasks}
          materials={archivedDetailMaterials}
          archived
          onClose={() => setOpenArchivedItemId(null)}
          onEditTask={() => {}}
          onMovePost={() => {}}
          onDeletePost={() => {}}
          onReactivate={reactivateItem}
          onHardDelete={hardDeleteItem}
          onPrepareFolder={openSharePointFolder}
          folderPathSegments={openArchivedItem ? sharepointRelativePath(openArchivedItem, [...items, ...archivedItems]) : []}
          onItemUpdated={() => {}}
        />
        <QuickLinkEditDialog editing={editingLink} draft={linkDraft} setDraft={setLinkDraft} onSave={saveLinkEdit} onCancel={cancelLinkEdit} />
        <FormatLinkEditDialog draft={formatLinkDraft} setDraft={setFormatLinkDraft} onSave={saveFormatLinkEdit} onCancel={cancelFormatLinkEdit} />
        <ItemCreateDialog open={creatingItem} formats={formats} draft={itemDraft} setDraft={setItemDraft} onChooseFormat={chooseItemFormat} onSave={saveItemCreate} onCancel={cancelCreatingItem} saving={savingItem} error={itemSaveError} />

        <nav className="mobile-nav" aria-label="Mobile Hauptnavigation">{nav.map(({ name, label, mobileLabel, icon: Icon }) => (
          <button key={name} className={view === name ? 'active' : ''} onClick={() => setView(name)}><Icon /><span>{mobileLabel ?? label}</span></button>
        ))}</nav>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Overview({ items, posts, tasks, conflict, onNavigate, onResolve, onEditTask, onOpenItem, quickLinks, onEditLink, onCreateItem }: any) {
  const [taskPeople, setTaskPeople] = useState<string[]>(['Tom']);
  const [taskTimes, setTaskTimes] = useState<string[]>(['Überfällig']);
  const open = tasks.filter((task: any) => task.status !== 'erledigt');
  const blocked = posts.filter((post: any) => post.status === 'blockiert');
  const nextPosts = [...posts].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)).slice(0, 5);
  const overviewTasks = [...open].filter((task: any) =>
    (!taskPeople.length || taskPeople.includes(task.owner)) &&
    (!taskTimes.length || taskTimes.includes(timeBucket(task.dueDate)))
  ).sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  const toggle = (value: string, values: string[], setter: (values: string[]) => void) => setter(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  const weekCounts = [2, 3, conflict?.count || 3, 2];
  return <>
    <div className="overview-top">
      <section className="metrics-grid">
        <Metric label="Geplante Posts diese Woche" value={String(conflict?.count || 0)} detail="" tone="green" icon={CalendarDays} action="Zum Kalender" onClick={() => onNavigate('Kalender')} />
        <Metric label="Offene Aufgaben" value={String(open.length)} detail="" tone="orange" icon={ClipboardCheck} action="Zu den Aufgaben" onClick={() => onNavigate('Aufgaben')} />
        <Metric label={'Material\u00adprobleme'} value={String(blocked.length)} detail="" tone="danger" icon={ImageIcon} action="Details ansehen" onClick={() => onNavigate('Materialien')} />
      </section>
      <aside className="overview-actions">
        <button type="button" className="primary-create" onClick={onCreateItem}><Plus /> Neuer Redaktionsanlass</button>
        <div className="brand-quote">„ Musik berührt dort,<br />wo Worte oft nicht reichen.“<span /></div>
      </aside>
    </div>

    <div className="overview-middle">
      <section className="panel publications-panel">
        <div className="panel-heading compact"><h2><CalendarDays /> Nächste Veröffentlichungen</h2><button type="button" onClick={() => onNavigate('Redaktionsplan')}>Alle anzeigen <ChevronRight /></button></div>
        <div className="publication-table">
          <div className="publication-head"><span>Datum</span><span>Titel</span><span>Kategorie</span><span>Status</span><span>Verantwortlich</span><span /></div>
          {nextPosts.map((post: any, index: number) => { const item = itemFor(items, post.editorialItemId); return <div className="publication-row" key={post.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenItem(item.id); } }} aria-label={`${item.title}: Details öffnen`}>
            <span className="publication-date">{fullDate(post.plannedDate)}</span>
            <span className={cn('post-thumb', `thumb-${index % 4}`)} aria-hidden="true"><b>{item.format === 'Schnupperkurs' ? 'SK' : item.format === 'Lied des Monats' ? 'LM' : item.format === 'Zertifizierung' ? 'ZE' : 'MF'}</b></span>
            <strong>{item.title}</strong>
            <span className="soft-category">{item.category?.split('/')[0]}</span>
            <Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge>
            <span>{item.publishOwner}</span>
          </div>; })}
          {!nextPosts.length && <div className="overview-task-empty">Noch keine Postings geplant.</div>}
        </div>
      </section>
      <aside className="overview-notices">
        <section className="panel notices-panel"><div className="panel-heading compact"><h2><Bell /> Aktuelle Hinweise</h2></div>
          <div className="notice danger"><i /><div><strong>{tasks.filter((t: any) => t.status !== 'erledigt' && t.dueDate < TODAY).length} Aufgaben überfällig</strong><button type="button" onClick={() => onNavigate('Aufgaben')}>Jetzt erledigen <ChevronRight /></button></div></div>
          <div className="notice warning"><i /><div><strong>Hohe Postingdichte ({conflict?.count || 0} Posts)</strong>{conflict?.level === 'conflict' ? <button type="button" onClick={onResolve}>Vorschlag anwenden <ChevronRight /></button> : <button type="button" onClick={() => onNavigate('Kalender')}>Zum Kalender <ChevronRight /></button>}</div></div>
          <div className="notice info"><i>i</i><div><strong>{blocked.length} Redaktionsanlässe mit fehlendem Material.</strong><button type="button" onClick={() => onNavigate('Materialien')}>Zum Material <ChevronRight /></button></div></div>
        </section>
        <div className="small-brand-card">Gemeinsames Singen<br />macht den Unterschied.<span /></div>
      </aside>
    </div>

    <section className="panel overview-tasks">
      <div className="panel-heading compact"><h2><ClipboardCheck /> Aufgaben</h2><span className="filter-hint">ⓘ Filter kombinierbar (mehrfach auswählbar)</span><button type="button" onClick={() => onNavigate('Aufgaben')}>Alle anzeigen <ChevronRight /></button></div>
      <div className="task-chips" aria-label="Kombinierbare Aufgabenfilter">
        <button type="button" className={!taskPeople.length && !taskTimes.length ? 'active' : ''} onClick={() => { setTaskPeople([]); setTaskTimes([]); }}>Alle</button>
        {['Tom','Norbert'].map((person) => <button type="button" key={person} className={taskPeople.includes(person) ? 'active' : ''} onClick={() => toggle(person, taskPeople, setTaskPeople)}>{person}{taskPeople.includes(person) && ' ×'}</button>)}
        {['Überfällig','Diese Woche'].map((time) => <button type="button" key={time} className={taskTimes.includes(time) ? 'active' : ''} onClick={() => toggle(time, taskTimes, setTaskTimes)}>{time}{taskTimes.includes(time) && ' ×'}</button>)}
      </div>
      <div className="overview-task-table"><div className="overview-task-head"><span>Aufgabe</span><span>Zugehöriger Post</span><span>Fällig bis</span><span>Posting am</span><span>Verantwortlich</span><span>Status</span></div>
        {overviewTasks.map((task: any) => { const item = itemFor(items, task.editorialItemId); const post = posts.find((entry: any) => entry.id === task.postId); const overdue = task.dueDate < TODAY; return <div className="overview-task-row" key={task.id} role="button" tabIndex={0} onClick={() => onEditTask(task)} onKeyDown={(event: any) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEditTask(task); } }} aria-label={`${task.title} bearbeiten`}><strong>{task.title}</strong><span>{item.title}</span><span className={overdue ? 'overdue-date' : ''}>{formatDate(task.dueDate)}</span><span>{post ? formatDate(post.plannedDate) : '—'}</span><span>{task.owner}</span><Badge className={cn('status-badge', overdue || task.blocked ? 'status-problem' : `status-${task.status}`)} variant={overdue || task.blocked ? 'destructive' : 'secondary'}>{task.blocked ? 'blockiert' : overdue ? 'Überfällig' : statusLabel(task.status)}</Badge></div>; })}
        {!overviewTasks.length && <div className="overview-task-empty">Für diese Filterkombination gibt es aktuell keine Aufgabe.</div>}
      </div>
    </section>

    <div className="overview-bottom">
      <section className="panel density-card"><div className="panel-heading compact"><h2><BarChart3 /> Postingdichte</h2></div><div className="density-content"><div className="mini-bars">{weekCounts.map((count: number, index: number) => <div key={index}><span style={{ height: `${count * 17}px` }} className={index === 2 ? 'current' : ''} /><small /></div>)}</div><div className="density-copy"><strong>Aktuelle Woche</strong><b>{conflict?.count || 0} Posts geplant</b><p>{conflict?.level === 'conflict' ? 'Das ist mehr als üblich.' : 'Im normalen Rahmen.'}</p><button type="button" onClick={() => onNavigate('Kalender')}>Details <ChevronRight /></button></div></div></section>
      <section className="panel quick-links"><div className="panel-heading compact"><h2><Link2 /> Schnellzugriff</h2></div>{[...quickLinks].sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((link: any) => <span key={link.id}><i>{link.label.slice(0, 1)}</i>{link.url ? <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a> : <em>{link.label} (kein Link hinterlegt)</em>}<ExternalLink /><button type="button" className="quick-link-edit" onClick={() => onEditLink(link)} aria-label={`${link.label} bearbeiten`}><Pencil size={12} /></button></span>)}</section>
      <section className="visual-brand-card"><img src="/assets/editorial-music.png" alt="Notenblatt neben einer akustischen Gitarre" loading="lazy" /><div>Mehr als Musik.<br />Mehr als ein Moment.<br />Mehr Miteinander.<i /></div></section>
    </div>
  </>;
}

// Neue Übersicht "Redaktionsanlässe": 1 Zeile pro Anlass (statt pro Posting wie in
// EditorialPlan/"Postings"), chronologisch nach Leitdatum sortiert, mit Fortschrittsanzeige
// (X von Y Aufgaben erledigt – bewusst über ALLE Aufgaben des Anlasses berechnet, unabhängig
// von der aktuellen Personen-/Status-Filterung, damit der Fortschritt immer den echten Stand
// zeigt). Wiederverwendet dieselben CSS-Klassen wie EditorialPlan (desktop-table/mobile-cards/
// plan-card), damit sich am Design nichts ändert. Klick auf die Zeile öffnet wie gewohnt die
// Anlass-Detailansicht; der separate "Aufgaben"-Button springt direkt in die Aufgaben-Ansicht,
// gefiltert auf genau diesen Anlass.
function EditorialItemsView({ items, tasks, onOpenItem, onCreateItem, onViewTasksForItem, onArchiveItem, onOpenFolder }: { items: any[]; tasks: any[]; onOpenItem: (itemId: string) => void; onCreateItem: () => void; onViewTasksForItem: (itemId: string) => void; onArchiveItem: (itemId: string) => void; onOpenFolder: (item: any) => void }) {
  const sorted = [...items].sort((a, b) => (keyDateFor(a) || '9999-12-31').localeCompare(keyDateFor(b) || '9999-12-31'));
  const openRow = (event: any, itemId: string) => { if (event.key && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault?.(); onOpenItem(itemId); };
  const statsFor = (itemId: string) => {
    const itemTasks = tasks.filter((task) => task.editorialItemId === itemId);
    return { total: itemTasks.length, done: itemTasks.filter((task) => task.status === 'erledigt').length };
  };
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Alle Anlässe im Überblick</p><h1>Redaktionsanlässe</h1></div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Badge variant="outline">{sorted.length} Anlässe</Badge><Button size="sm" onClick={onCreateItem}><Plus /> Neuer Redaktionsanlass</Button></div></div>
    <div className="desktop-table"><table><thead><tr><th>Termin/Ziel</th><th>Anlass</th><th>Fortschritt</th><th>Verantwortung</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{sorted.map((item) => { const date = keyDateFor(item); const { total, done } = statsFor(item.id); return <tr key={item.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><td><strong>{date ? formatDate(date) : '—'}</strong></td><td><span className="category-line">{item.category}</span><strong>{item.title}</strong>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}<small>{item.format}</small></td><td>{total ? <Badge variant="outline" style={progressPillStyle(done, total)}>{done}/{total} erledigt</Badge> : <small>keine Aufgaben</small>}</td><td><span>{item.contentOwner}</span><small>→ {item.publishOwner}</small></td><td style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onViewTasksForItem(item.id); }}>Aufgaben <ChevronRight size={14} /></Button><Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); onOpenFolder(item); }} aria-label={`${item.title}: SharePoint-Ordner öffnen`} title="Passenden Kategorie-Ordner in SharePoint öffnen"><FolderPlus size={15} /></Button><Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); onArchiveItem(item.id); }} aria-label={`${item.title}: Ins Archiv verschieben`}><Archive size={15} /></Button></td></tr>; })}</tbody></table></div>
    <div className="mobile-cards">{sorted.map((item) => { const date = keyDateFor(item); const { total, done } = statsFor(item.id); return <article className="plan-card" key={item.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><div><span className="category-line">{item.format}{date && ` · ${formatDate(date)}`}</span><h3>{item.title}</h3>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}</div>{total ? <Badge variant="outline" style={progressPillStyle(done, total)}>{done}/{total}</Badge> : <small>keine Aufgaben</small>}<div className="plan-card-row"><strong>{date ? fullDate(date) : 'kein Termin'}</strong><span>{item.contentOwner} → {item.publishOwner}</span></div><div className="meta"><button type="button" onClick={(event) => { event.stopPropagation(); onViewTasksForItem(item.id); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Aufgaben <ChevronRight size={12} /></button><button type="button" onClick={(event) => { event.stopPropagation(); onOpenFolder(item); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FolderPlus size={12} /> SharePoint-Ordner öffnen</button><button type="button" onClick={(event) => { event.stopPropagation(); onArchiveItem(item.id); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Archive size={12} /> Ins Archiv verschieben</button></div></article>; })}</div>
    {!sorted.length && <div className="empty-state"><PackageCheck /><h3>Keine Redaktionsanlässe</h3><p>Für diese Filterkombination gibt es aktuell keine Anlässe.</p></div>}
  </section>;
}

// Archiv-Ansicht: eigene lokale Suche/Filter (bewusst getrennt von der globalen FilterBar,
// die für Archiv-Ansichten ausgeblendet ist, siehe view-Switch weiter unten) – Format- und
// Zeitraum-Filter beziehen sich hier auf die archivierten Anlässe selbst, nicht auf Postings/
// Aufgaben, die im Archiv gar nicht einzeln aufgelistet werden.
function ArchivView({ items, onOpenItem, onReactivate, onHardDelete }: { items: any[]; onOpenItem: (itemId: string) => void; onReactivate: (item: any) => void; onHardDelete: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState('Alle');
  const [periodFilter, setPeriodFilter] = useState('Alle');

  const formatOptions = Array.from(new Set(items.map((item) => item.format).filter(Boolean))).sort((a, b) => (a as string).localeCompare(b as string, 'de'));

  const filtered = items
    .filter((item) => !search.trim() || item.title.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((item) => formatFilter === 'Alle' || item.format === formatFilter)
    .filter((item) => periodFilter === 'Alle' || archivedPeriod(item.archivedAt) === periodFilter)
    .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));

  const openRow = (event: any, itemId: string) => { if (event.key && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault?.(); onOpenItem(itemId); };

  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Abgeschlossene und archivierte Anlässe</p><h1>Archiv</h1></div><Badge variant="outline">{filtered.length} Anlässe</Badge></div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      <Input placeholder="Suche nach Titel …" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 240 }} />
      <Select value={formatFilter} onValueChange={(value) => setFormatFilter(value as string)}>
        <SelectTrigger className="task-form-select" style={{ width: 200 }}><SelectValue placeholder="Format" /></SelectTrigger>
        <SelectContent><SelectItem value="Alle">Alle Formate</SelectItem>{formatOptions.map((name) => <SelectItem key={name as string} value={name as string}>{name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as string)}>
        <SelectTrigger className="task-form-select" style={{ width: 180 }}><SelectValue placeholder="Zeitraum" /></SelectTrigger>
        <SelectContent><SelectItem value="Alle">Alle Zeiträume</SelectItem><SelectItem value="Letzte 30 Tage">Letzte 30 Tage</SelectItem><SelectItem value="Dieses Jahr">Dieses Jahr</SelectItem><SelectItem value="Älter">Älter</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="desktop-table"><table><thead><tr><th>Archiviert am</th><th>Anlass</th><th>Termin</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{filtered.map((item) => { const date = keyDateFor(item); return <tr key={item.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><td><strong>{item.archivedAt ? formatDate(item.archivedAt.slice(0, 10)) : '—'}</strong></td><td><span className="category-line">{item.category}</span><strong>{item.title}</strong>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}<small>{item.format}</small></td><td>{date ? formatDate(date) : '—'}</td><td style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); onReactivate(item); }} aria-label={`${item.title}: Reaktivieren`}><RotateCcw size={15} /></Button><Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); onHardDelete(item.id); }} aria-label={`${item.title}: Endgültig löschen`}><Trash2 size={15} /></Button></td></tr>; })}</tbody></table></div>
    <div className="mobile-cards">{filtered.map((item) => { const date = keyDateFor(item); return <article className="plan-card" key={item.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><div><span className="category-line">{item.format}{item.archivedAt && ` · archiviert ${formatDate(item.archivedAt.slice(0, 10))}`}</span><h3>{item.title}</h3>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}</div><div className="plan-card-row"><strong>{date ? fullDate(date) : 'kein Termin'}</strong></div><div className="meta"><button type="button" onClick={(event) => { event.stopPropagation(); onReactivate(item); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><RotateCcw size={12} /> Reaktivieren</button><button type="button" onClick={(event) => { event.stopPropagation(); onHardDelete(item.id); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Trash2 size={12} /> Endgültig löschen</button></div></article>; })}</div>
    {!filtered.length && <div className="empty-state"><PackageCheck /><h3>Keine archivierten Anlässe</h3><p>Für diese Filterkombination gibt es aktuell nichts im Archiv.</p></div>}
  </section>;
}

function EditorialPlan({ items, posts, onOpenItem, onCreateItem, onDeletePost }: { items: any[]; posts: any[]; onOpenItem: (itemId: string) => void; onCreateItem: () => void; onDeletePost: (id: string) => void }) {
  const openRow = (event: any, itemId: string) => { if (event.key && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault?.(); onOpenItem(itemId); };
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Alle Veröffentlichungen</p><h1>Postings</h1></div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Badge variant="outline">{posts.length} Ergebnisse</Badge><Button size="sm" onClick={onCreateItem}><Plus /> Neuer Redaktionsanlass</Button></div></div>
    <div className="desktop-table"><table><thead><tr><th>Datum</th><th>Inhalt</th><th>Posting</th><th>Status</th><th>Verantwortung</th><th>Kanäle</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{[...posts].sort((a,b) => a.plannedDate.localeCompare(b.plannedDate)).map((post) => { const item = itemFor(items, post.editorialItemId); return <tr key={post.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><td><strong>{formatDate(post.plannedDate)}</strong>{post.lateEntry && <small>neu geplant</small>}</td><td><span className="category-line">{item.category}</span><strong>{item.title}</strong>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}<small>{item.format}{item.eventStart && ` · Termin: ${formatDate(item.eventStart)}${item.eventEnd && item.eventEnd !== item.eventStart ? `–${formatDate(item.eventEnd)}` : ''}`}</small></td><td>{post.type}{post.conditional && <small>bedingt</small>}</td><td><Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge></td><td><span>{item.contentOwner}</span><small>→ {item.publishOwner}</small></td><td><div className="channel-dots" aria-label="Instagram Facebook LinkedIn"><i>IG</i><i>FB</i><i>IN</i></div></td><td style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Button variant="ghost" size="icon-sm" onClick={(event) => { event.stopPropagation(); onDeletePost(post.id); }} aria-label={`${item.title}: Termin löschen`}><Trash2 size={15} /></Button><ChevronRight size={17} /></td></tr>; })}</tbody></table></div>
    <div className="mobile-cards">{posts.map((post) => { const item = itemFor(items, post.editorialItemId); return <article className="plan-card" key={post.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><div><span className="category-line">{item.format}{item.eventStart && ` · Termin: ${formatDate(item.eventStart)}`}</span><h3>{item.title}</h3>{item.subtitle && <small style={{ display: 'block' }}>{item.subtitle}</small>}</div><Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge><div className="plan-card-row"><strong>{fullDate(post.plannedDate)}</strong><span>{post.type}</span></div><div className="meta"><span><Users /> {item.contentOwner} / {item.publishOwner}</span><span>IG · FB · IN</span></div><div className="meta"><button type="button" onClick={(event) => { event.stopPropagation(); onDeletePost(post.id); }} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Trash2 size={14} /> Termin löschen</button></div></article>; })}</div>
  </section>;
}

function CalendarView({ items, posts, onMovePost }: { items: any[]; posts: any[]; onMovePost: (post: any) => void }) {
  const [cursor] = useState(() => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(1); return d; });
  const monthLabel = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(cursor);
  const firstWeekday = (cursor.getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const dayNumber = index - firstWeekday + 1;
    return dayNumber >= 1 && dayNumber <= daysInMonth ? dayNumber : 0;
  });
  const iso = (day: number) => `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return <section className="panel wide-panel calendar-panel"><div className="panel-heading"><div><p className="eyebrow">Monatsansicht</p><h1 style={{ textTransform: 'capitalize' }}>{monthLabel}</h1></div><div className="density-key"><span className="ok" />2–3 ideal <span className="danger" />mehr als 3</div></div>
    <div className="weekday-row">{['Mo','Di','Mi','Do','Fr','Sa','So'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{cells.map((day, index) => { const date = day > 0 ? iso(day) : ''; const dayPosts = posts.filter((post) => post.plannedDate === date); return <div key={index} className={cn('calendar-day', !date && 'muted-day', date === TODAY && 'today')}><span>{day > 0 ? day : ''}</span>{dayPosts.map((post) => <button key={post.id} type="button" onClick={() => onMovePost(post)} aria-label={`${itemFor(items, post.editorialItemId).title}: ${post.type}, Termin verschieben`} className={cn('calendar-event', post.status === 'blockiert' && 'blocked')}><strong>{itemFor(items, post.editorialItemId).title}</strong><small>{post.type}</small></button>)}</div>; })}</div>
  </section>;
}

// Gemeinsamer Bearbeiten-Dialog für Aufgaben, wird sowohl von der Startseite
// (Übersicht) als auch von der vollen Aufgaben-Ansicht (TasksView) genutzt.
// Zustand (editing/draft) liegt dafür zentral in EditorialDashboard.
// Redaktionsanlass-Detailansicht: zeigt zu einem Anlass alle Postings, Aufgaben
// (mit Status + Bearbeiter) und Materialien gemeinsam. Klick auf eine Aufgabe
// bzw. "Verschieben" bei einem Posting öffnet die bereits vorhandenen Dialoge
// (TaskEditDialog / PostMoveDialog) obendrüber, statt eigene Bearbeitungslogik
// zu duplizieren. Da diese Ansicht neu ist, gibt es dafür noch keine eigenen
// CSS-Klassen im Stylesheet — Layout daher wie bei AuthGate per Inline-Style.
function ItemDetailDialog({ item, posts, tasks, materials, archived, onClose, onEditTask, onMovePost, onDeletePost, onArchiveItem, onReactivate, onHardDelete, onCreateMaterial, onPrepareFolder, folderPathSegments, onItemUpdated }: { item: any; posts: any[]; tasks: any[]; materials: any[]; archived?: boolean; onClose: () => void; onEditTask: (task: any) => void; onMovePost: (post: any) => void; onDeletePost: (id: string) => void; onArchiveItem?: (id: string) => void; onReactivate?: (item: any) => void; onHardDelete?: (id: string) => void; onCreateMaterial?: (itemId: string) => void; onPrepareFolder?: (item: any) => void; folderPathSegments?: string[]; onItemUpdated: (item: any) => void }) {
  const row: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border, #e5e5e5)', textAlign: 'left', width: '100%', background: 'none', border: 'none', borderBottomWidth: 1, borderBottomStyle: 'solid' };
  const sectionHeading: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '20px 0 8px', fontSize: 14, fontWeight: 600 };
  const empty: CSSProperties = { fontSize: 13, opacity: 0.7, padding: '4px 0' };

  const [editingDetails, setEditingDetails] = useState(false);
  // Kurze visuelle Bestätigung ("✓") am jeweils geklickten Ordner-Ebenen-Chip – rein lokal,
  // weil das Kopieren einer einzelnen Ebene keinen Zustand außerhalb des Dialogs betrifft.
  const [copiedSegment, setCopiedSegment] = useState<string | null>(null);
  const copySegment = (segment: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(segment).catch(() => {});
    }
    setCopiedSegment(segment);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => setCopiedSegment((current) => (current === segment ? null : current)), 2000);
    }
  };
  const [detailDraft, setDetailDraft] = useState<any>(null);
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    setEditingDetails(false);
    setDetailDraft(item ? {
      title: item.title ?? '',
      subtitle: item.subtitle ?? '',
      eventStart: item.eventStart ?? '',
      eventStartTime: item.eventStartTime ?? '09:00',
      eventEnd: item.eventEnd ?? '',
      eventEndTime: item.eventEndTime ?? '17:00',
      location: item.location ?? '',
      instructors: item.instructors ?? '',
    } : null);
  }, [item?.id]);

  const saveDetails = async () => {
    if (!item || !detailDraft) return;
    if (!detailDraft.title.trim()) return;
    setSavingDetails(true);
    const { data, error } = await supabase.from('editorial_items').update({
      title: detailDraft.title.trim(),
      subtitle: detailDraft.subtitle.trim() || null,
      event_start: detailDraft.eventStart ? new Date(`${detailDraft.eventStart}T${detailDraft.eventStartTime || '09:00'}:00`).toISOString() : null,
      event_end: detailDraft.eventEnd ? new Date(`${detailDraft.eventEnd}T${detailDraft.eventEndTime || '17:00'}:00`).toISOString() : null,
      event_location: detailDraft.location || null,
      instructors: detailDraft.instructors || null,
    }).eq('id', item.id).select('*, editorial_formats(name, category, logic_type)').single();
    if (error || !data) {
      console.error('Veranstaltungsdetails konnten nicht gespeichert werden', error);
    } else {
      // Sofort lokal übernehmen statt nur auf die Echtzeit-Zustellung zu warten – so ist die
      // Änderung garantiert sofort sichtbar, unabhängig von deren Timing/Zuverlässigkeit.
      onItemUpdated(mapItem(data));
    }
    setSavingDetails(false);
    setEditingDetails(false);
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="task-dialog" style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>{item?.title}</DialogTitle>
          <DialogDescription>{[item?.subtitle, item?.format, item?.category].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ padding: '12px 14px', border: '1px solid var(--border, #e5e5e5)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ ...sectionHeading, margin: 0 }}><MapPin size={16} /> Veranstaltungsdetails</h3>
              {!editingDetails && !archived && <Button variant="ghost" size="sm" onClick={() => setEditingDetails(true)}><Pencil size={14} /> Bearbeiten</Button>}
            </div>
            {!editingDetails ? (
              <div style={{ display: 'grid', gap: 4, fontSize: 14, marginTop: 8 }}>
                <span>Titel: {item?.title}{item?.subtitle ? ` – ${item.subtitle}` : ''}</span>
                <span>Termin: {item?.eventStart ? `${fullDate(item.eventStart)}${item.eventStartTime ? `, ${item.eventStartTime} Uhr` : ''}${item?.eventEnd ? ` – ${fullDate(item.eventEnd)}${item.eventEndTime ? `, ${item.eventEndTime} Uhr` : ''}` : ''}` : 'kein Termin hinterlegt'}</span>
                <span>Ort: {item?.location || '—'}</span>
                <span>Dozent(en): {item?.instructors || '—'}</span>
              </div>
            ) : (
              <div className="task-form" style={{ marginTop: 10 }}>
                <label htmlFor="detail-title"><span>Titel</span><Input id="detail-title" value={detailDraft?.title} onChange={(event) => setDetailDraft({ ...detailDraft, title: event.target.value })} /></label>
                <label htmlFor="detail-subtitle"><span>Untertitel</span><Input id="detail-subtitle" value={detailDraft?.subtitle} onChange={(event) => setDetailDraft({ ...detailDraft, subtitle: event.target.value })} /></label>
                <label htmlFor="detail-event-start"><span>Beginn</span><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Input id="detail-event-start" type="date" value={detailDraft?.eventStart} onChange={(event) => setDetailDraft({ ...detailDraft, eventStart: event.target.value })} /><Input type="time" value={detailDraft?.eventStartTime} onChange={(event) => setDetailDraft({ ...detailDraft, eventStartTime: event.target.value })} /></div></label>
                <label htmlFor="detail-event-end"><span>Ende (optional)</span><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Input id="detail-event-end" type="date" value={detailDraft?.eventEnd} onChange={(event) => setDetailDraft({ ...detailDraft, eventEnd: event.target.value })} /><Input type="time" value={detailDraft?.eventEndTime} onChange={(event) => setDetailDraft({ ...detailDraft, eventEndTime: event.target.value })} /></div></label>
                <label htmlFor="detail-location"><span>Ort</span><Input id="detail-location" value={detailDraft?.location} onChange={(event) => setDetailDraft({ ...detailDraft, location: event.target.value })} /></label>
                <label htmlFor="detail-instructors"><span>Dozent(en)</span><Input id="detail-instructors" value={detailDraft?.instructors} onChange={(event) => setDetailDraft({ ...detailDraft, instructors: event.target.value })} placeholder="z. B. Anna Beispiel, Max Mustermann" /></label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', gridColumn: '1 / -1' }}>
                  <Button variant="outline" size="sm" onClick={() => setEditingDetails(false)} disabled={savingDetails}>Abbrechen</Button>
                  <Button size="sm" onClick={saveDetails} disabled={savingDetails || !detailDraft?.title?.trim()}>{savingDetails ? 'Speichert …' : 'Speichern'}</Button>
                </div>
              </div>
            )}
          </div>

          <h3 style={sectionHeading}><CalendarDays size={16} /> Postings</h3>
          {posts.length ? posts.map((post) => (
            <div style={row} key={post.id}>
              <span>{formatDate(post.plannedDate)}</span>
              <span>{post.type}{post.conditional && <small> · bedingt</small>}</span>
              <Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge>
              {archived ? <span /> : <div style={{ display: 'flex', gap: 4 }}><Button variant="ghost" size="sm" onClick={() => onMovePost(post)}>Verschieben</Button><Button variant="ghost" size="sm" onClick={() => onDeletePost(post.id)} aria-label="Termin löschen"><Trash2 size={14} /></Button></div>}
            </div>
          )) : <p style={empty}>Keine Postings vorhanden.</p>}

          <h3 style={sectionHeading}><ClipboardCheck size={16} /> Aufgaben</h3>
          {tasks.length ? tasks.map((task) => (
            archived ? (
              <div style={row} key={task.id}>
                <span>{formatDate(task.dueDate)}</span>
                <span>{task.title}</span>
                <span>{task.owner}</span>
                <Badge className={cn('status-badge', `status-${task.status}`)} variant="secondary">{statusLabel(task.status)}</Badge>
              </div>
            ) : (
              <button type="button" style={row} key={task.id} onClick={() => onEditTask(task)} aria-label={`${task.title} bearbeiten`}>
                <span>{formatDate(task.dueDate)}</span>
                <span>{task.title}</span>
                <span>{task.owner}</span>
                <Badge className={cn('status-badge', task.blocked ? 'status-problem' : `status-${task.status}`)} variant={task.blocked ? 'destructive' : 'secondary'}>{task.blocked ? 'blockiert' : statusLabel(task.status)}</Badge>
              </button>
            )
          )) : <p style={empty}>Keine Aufgaben vorhanden.</p>}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ ...sectionHeading, margin: 0 }}><FileImage size={16} /> Materialien</h3>
            {!archived && <Button variant="ghost" size="sm" onClick={() => onCreateMaterial?.(item.id)}><Plus size={14} /> Material</Button>}
          </div>
          {item && (
            <div style={{ margin: '0 0 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={empty}>Empfohlener SharePoint-Ordner:</span>
                <Button variant="outline" size="sm" onClick={() => onPrepareFolder?.(item)}><FolderPlus size={13} /> In SharePoint öffnen</Button>
              </div>
              {/* Jede Ordner-Ebene einzeln kopierbar, statt ein einzelner zusammengefügter Text:
                  Beim Anlegen mehrerer neuer Unterordner nacheinander (z. B. "Modul F" → "Schnupperkurs"
                  → "06.11.2026") braucht man pro Ebene genau den einen Namen, nicht den ganzen Pfad
                  auf einmal – der ließe sich in SharePoints "Neuer Ordner"-Dialog nicht sinnvoll einfügen. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ color: 'var(--muted-foreground, #6b7280)' }}>{item.category}</span>
                {(folderPathSegments ?? []).map((segment) => (
                  <span key={segment} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--muted-foreground, #6b7280)' }}>/</span>
                    <button
                      type="button"
                      onClick={() => copySegment(segment)}
                      title="Diesen Ordnernamen kopieren"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, padding: '2px 8px', background: 'none', cursor: 'pointer', fontSize: 13 }}
                    >
                      {copiedSegment === segment ? <Check size={12} /> : <Copy size={12} />} {segment}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {materials.length ? materials.map((material) => (
            <div style={row} key={material.id}>
              <span>{material.title}</span>
              <span>{(material.url || material.fileReference) ? <a href={material.url || material.fileReference} target="_blank" rel="noreferrer">{material.source || 'Link öffnen'} <Link2 size={12} /></a> : (material.source || '—')}</span>
              <Badge className={cn('status-badge', `status-${material.status}`)} variant={material.status === 'vorhanden' ? 'secondary' : material.status === 'fehlt' ? 'destructive' : 'outline'}>{materialStatusLabel(material.status)}</Badge>
              <span />
            </div>
          )) : <p style={empty}>Keine Materialien vorhanden.</p>}
        </div>
        <DialogFooter>
          {item && !archived && <Button variant="outline" onClick={() => onArchiveItem?.(item.id)} style={{ marginRight: 'auto' }}><Archive size={14} /> Ins Archiv verschieben</Button>}
          {item && archived && <div style={{ display: 'flex', gap: 8, marginRight: 'auto' }}>
            <Button variant="outline" onClick={() => onReactivate?.(item)}><RotateCcw size={14} /> Reaktivieren</Button>
            <Button variant="destructive" onClick={() => onHardDelete?.(item.id)}><Trash2 size={14} /> Endgültig löschen</Button>
          </div>}
          <Button variant="outline" onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Dialog zum Verschieben eines Kalendertermins (Post). Nutzt dieselben
// task-dialog/task-form-Klassen wie TaskEditDialog, damit sich am Design nichts ändert.
function PostMoveDialog({ items, moving, date, setDate, onSave, onCancel }: { items: any[]; moving: any; date: string; setDate: (date: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <Dialog open={Boolean(moving)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>Termin verschieben</DialogTitle><DialogDescription>{moving ? `${itemFor(items, moving.editorialItemId).title} – ${moving.type}` : ''}</DialogDescription></DialogHeader>
        <div className="task-form">
          <label htmlFor="post-move-date"><span>Neues Datum</span><Input id="post-move-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onCancel}>Abbrechen</Button><Button onClick={onSave} disabled={!date}>Verschieben</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Dialog zum Bearbeiten eines Schnellzugriff-Links (Label + URL). Nutzt dieselben
// task-dialog/task-form-Klassen wie TaskEditDialog, damit sich am Design nichts ändert.
function QuickLinkEditDialog({ editing, draft, setDraft, onSave, onCancel }: { editing: any; draft: { label: string; url: string }; setDraft: (draft: { label: string; url: string }) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>Schnellzugriff bearbeiten</DialogTitle><DialogDescription>Beschriftung und Ziel-Link anpassen</DialogDescription></DialogHeader>
        <div className="task-form">
          <label htmlFor="link-label"><span>Beschriftung</span><Input id="link-label" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label htmlFor="link-url"><span>Link (URL)</span><Input id="link-url" type="url" placeholder="https://…" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onCancel}>Abbrechen</Button><Button onClick={onSave} disabled={!draft.label.trim()}>Speichern</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemCreateDialog({ open, formats, draft, setDraft, onChooseFormat, onSave, onCancel, saving, error }: { open: boolean; formats: any[]; draft: any; setDraft: (draft: any) => void; onChooseFormat: (formatId: string) => void; onSave: () => void; onCancel: () => void; saving: boolean; error: string }) {
  const format = formats.find((entry) => entry.id === draft.formatId);
  const logicType = format?.logicType;
  const missingRequiredDate =
    (logicType === 'event' && !draft.eventStart) ||
    (logicType === 'publication' && !draft.publicationTargetDate) ||
    (logicType === 'event_material' && !draft.eventReferenceDate && !draft.materialReadyDate);
  const owners: [string, string][] = [
    ['contentOwner', 'Inhalt'],
    ['graphicsOwner', 'Grafik'],
    ['approvalOwner', 'Freigabe'],
    ['publishOwner', 'Veröffentlichung'],
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>Neuer Redaktionsanlass</DialogTitle><DialogDescription>Format wählen, Titel und Termin(e) eintragen – Postings und Aufgaben werden danach automatisch erzeugt.</DialogDescription></DialogHeader>
        <div className="task-form">
          <label htmlFor="item-format"><span>Format</span>
            <Select value={draft.formatId} onValueChange={(id) => onChooseFormat(id as string)}>
              <SelectTrigger id="item-format" className="task-form-select"><SelectValue placeholder="Format wählen">{format ? (format.category === 'Rückblick/Zertifizierung' ? format.name : `${format.name} (${format.category})`) : undefined}</SelectValue></SelectTrigger>
              <SelectContent>{formats.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.category === 'Rückblick/Zertifizierung' ? entry.name : `${entry.name} (${entry.category})`}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label htmlFor="item-title"><span>Titel</span><Input id="item-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => {
            const format = formats.find((entry) => entry.id === draft.formatId);
            if (format?.slug !== 'besondere-veranstaltung' || !isWeekendSonderformat(draft.title)) return;
            const friday = nextWeekday(draft.eventStart || TODAY, 5);
            setDraft({ ...draft, eventStart: friday, eventEnd: nextWeekday(friday, 0), eventStartTime: '18:00', eventEndTime: '13:00' });
          }} placeholder="z. B. Guitar Factory Herbst 2026" /></label>
          <label htmlFor="item-subtitle"><span>Untertitel (optional)</span><Input id="item-subtitle" value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>

          {logicType === 'event' && <>
            <label htmlFor="item-event-start"><span>Beginn</span><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Input id="item-event-start" type="date" value={draft.eventStart} onChange={(event) => setDraft({ ...draft, eventStart: event.target.value })} /><Input id="item-event-start-time" type="time" value={draft.eventStartTime} onChange={(event) => setDraft({ ...draft, eventStartTime: event.target.value })} /></div></label>
            <label htmlFor="item-event-end"><span>Ende (optional)</span><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Input id="item-event-end" type="date" value={draft.eventEnd} onChange={(event) => setDraft({ ...draft, eventEnd: event.target.value })} /><Input id="item-event-end-time" type="time" value={draft.eventEndTime} onChange={(event) => setDraft({ ...draft, eventEndTime: event.target.value })} /></div></label>
            <label htmlFor="item-location"><span>Ort (optional)</span><Input id="item-location" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
            <label htmlFor="item-instructors"><span>Dozent(en) (optional)</span><Input id="item-instructors" value={draft.instructors} onChange={(event) => setDraft({ ...draft, instructors: event.target.value })} placeholder="z. B. Anna Beispiel, Max Mustermann" /></label>
          </>}
          {logicType === 'publication' && <label htmlFor="item-publication-date"><span>Ziel-Veröffentlichungsdatum</span><Input id="item-publication-date" type="date" value={draft.publicationTargetDate} onChange={(event) => setDraft({ ...draft, publicationTargetDate: event.target.value })} /></label>}
          {logicType === 'event_material' && <>
            <label htmlFor="item-reference-date"><span>Bezugstermin</span><Input id="item-reference-date" type="date" value={draft.eventReferenceDate} onChange={(event) => setDraft({ ...draft, eventReferenceDate: event.target.value })} /></label>
            <label htmlFor="item-material-date"><span>Material fertig ab (optional)</span><Input id="item-material-date" type="date" value={draft.materialReadyDate} onChange={(event) => setDraft({ ...draft, materialReadyDate: event.target.value })} /></label>
          </>}

          {owners.map(([key, label]) => (
            <label key={key} htmlFor={`item-${key}`}><span>{label}</span>
              <Select value={draft[key]} onValueChange={(owner) => setDraft({ ...draft, [key]: owner as string })}>
                <SelectTrigger id={`item-${key}`} className="task-form-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Tom">Tom</SelectItem><SelectItem value="Norbert">Norbert</SelectItem></SelectContent>
              </Select>
            </label>
          ))}
          {error && <p style={{ color: 'var(--destructive, crimson)', fontSize: 13 }}>{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Abbrechen</Button>
          <Button onClick={onSave} disabled={saving || !draft.title.trim() || !draft.formatId || missingRequiredDate}>{saving ? 'Wird angelegt …' : 'Anlegen'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LOGIC_LABELS: Record<string, string> = {
  event: 'Mit Termin',
  publication: 'Frei veröffentlicht',
  event_material: 'Nachbereitend',
};

// Kurze Zusatzerklärungen, die sich nicht aus den reinen Zahlen ergeben.
// Schlüssel = Format-Slug in editorial_formats. Bei neuen Formaten einfach ergänzen.
const FORMAT_NOTES: Record<string, string> = {
  'mitgliederangebot': 'Ein Format für drei Angebote: Guitar Factory, Ukulele Factory, Singleiter in Aktion – der genaue Titel wird beim Anlegen frei vergeben.',
  'besondere-veranstaltung': 'Deckt z. B. Sommerakademie, Come Together und Liedernächte ab.',
  'zertifizierung': 'Das Posting selbst ist bereits der Rückblick – kein separater Rückblick-Post nötig.',
  'rueckblick': 'Wird bei Bedarf als eigener Folge-Eintrag zu einem Weiterbildungsmodul oder einer Besonderen Veranstaltung angelegt.',
  'impuls': 'Deckt auch Themen wie Kongress/Messe/Fachtagung und Tool/Artikel ab.',
  'veranstaltungsueberblick': 'Wird manuell je nach Terminlage angelegt, kein automatischer Rhythmus.',
};

function describeOffset(offsetDays?: number) {
  if (offsetDays == null) return '';
  if (offsetDays < 0) return `${Math.abs(offsetDays)} Tage vorher`;
  if (offsetDays > 0) return `${offsetDays} Tage danach`;
  return 'am Termin selbst';
}

function formatTimingSummary(format: any, postRules: any[]) {
  if (format.logicType === 'publication') return 'Kein fester Termin – wird frei eingeplant.';
  const rules = postRules.filter((rule) => rule.formatId === format.id);
  if (!rules.length) return 'Kein fester Automatismus hinterlegt – wird bei Bedarf individuell angelegt.';
  const main = rules.find((rule) => rule.postType === 'Hauptankündigung');
  const reminder = rules.find((rule) => rule.postType === 'Erinnerung');
  const lastCall = rules.find((rule) => rule.postType === 'Last Call');
  const parts: string[] = [];
  if (main) parts.push(`Hauptpost ${describeOffset(main.offsetDays)}`);
  if (reminder) parts.push(`Erinnerung ${describeOffset(reminder.offsetDays)}`);
  if (lastCall) parts.push(`optionaler Last Call ${describeOffset(lastCall.offsetDays)}`);
  return parts.join(' · ');
}

function FormatsAndRulesView({ formats, postRules, formatQuickLinks, onCreateLink, onEditLink, onDeleteLink }: { formats: any[]; postRules: any[]; formatQuickLinks: any[]; onCreateLink: (formatId: string) => void; onEditLink: (link: any) => void; onDeleteLink: (id: string) => void }) {
  const grouped = formats.reduce((acc: Record<string, any[]>, format) => {
    (acc[format.category] ||= []).push(format);
    return acc;
  }, {});
  return (
    <section className="panel wide-panel">
      <div className="panel-heading"><div><p className="eyebrow">Wie die Automatik entscheidet</p><h1>Formate & Regeln</h1></div></div>
      <p style={{ maxWidth: 720, margin: '0 0 24px', fontSize: 14, color: 'var(--muted-foreground, #6b7280)' }}>
        Jeder Redaktionsanlass gehört zu einem <strong>Format</strong>. Das Format legt fest, wie viele Tage vor oder nach dem Termin die Hauptankündigung, eine Erinnerung oder ein optionaler Last Call automatisch geplant werden. Formate ohne festen Termin (z. B. „Lied des Monats“) werden frei eingeplant.
      </p>
      {Object.entries(grouped).map(([category, list]) => (
        <div key={category} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{category}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {list.map((format) => { const links = formatQuickLinks.filter((link) => link.formatId === format.id); return (
              <div key={format.id} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <strong>{format.name}</strong>
                  <Badge variant="outline">{LOGIC_LABELS[format.logicType] ?? format.logicType}</Badge>
                </div>
                <p style={{ margin: '0 0 4px', fontSize: 14 }}>{formatTimingSummary(format, postRules)}</p>
                {FORMAT_NOTES[format.slug] && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground, #6b7280)' }}>{FORMAT_NOTES[format.slug]}</p>}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {links.map((link) => (
                    <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <Link2 size={12} />
                      {link.url ? <a href={link.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}>{link.label}</a> : <span style={{ flex: 1 }}>{link.label} <small style={{ color: 'var(--muted-foreground, #6b7280)' }}>(keine URL hinterlegt)</small></span>}
                      <Button variant="ghost" size="icon-sm" onClick={() => onEditLink(link)} aria-label={`${link.label} bearbeiten`}><Pencil size={12} /></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => onDeleteLink(link.id)} aria-label={`${link.label} löschen`}><Trash2 size={12} /></Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => onCreateLink(format.id)} style={{ alignSelf: 'flex-start', marginTop: links.length ? 4 : 0 }}><Plus size={13} /> Link hinzufügen</Button>
                </div>
              </div>
            ); })}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 13, color: 'var(--muted-foreground, #6b7280)' }}>Hinweis: Die automatische Erzeugung von Aufgaben (z. B. „Material besorgen“) ist technisch vorbereitet, aber noch nicht mit Regeln befüllt – Aufgaben werden aktuell weiterhin manuell angelegt.</p>
    </section>
  );
}

// Anlegen/Bearbeiten eines formatspezifischen Schnellzugriff-Links. draft.id === null heißt
// "wird neu angelegt" (siehe startCreatingFormatLink), sonst wird der bestehende Link mit
// dieser id aktualisiert (startEditingFormatLink) – ein gemeinsamer Dialog für beide Fälle,
// analog zu TaskEditDialog (editing vs. creating).
function FormatLinkEditDialog({ draft, setDraft, onSave, onCancel }: { draft: any; setDraft: (draft: any) => void; onSave: () => void; onCancel: () => void }) {
  const open = Boolean(draft);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>{draft?.id ? 'Link bearbeiten' : 'Link hinzufügen'}</DialogTitle><DialogDescription>Schnellzugriff-Link für dieses Format, z. B. Canva-Vorlage oder SharePoint-Ordner.</DialogDescription></DialogHeader>
        <div className="task-form">
          <label htmlFor="format-link-label"><span>Bezeichnung</span><Input id="format-link-label" value={draft?.label ?? ''} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label htmlFor="format-link-url"><span>URL</span><Input id="format-link-url" type="url" value={draft?.url ?? ''} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://…" /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button onClick={onSave} disabled={!draft?.label?.trim()}>{draft?.id ? 'Speichern' : 'Anlegen'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Anlegen-Dialog für ein neues Material (siehe startCreatingMaterial/saveMaterialCreate).
// Bewusst nur zum Anlegen – ein Bearbeiten bestehender Materialien ist (Stand jetzt) noch
// nicht vorgesehen, analog zum bisherigen Funktionsumfang von QuickLinkEditDialog.
function MaterialEditDialog({ items, posts, open, draft, setDraft, onSave, onCancel }: { items: any[]; posts: any[]; open: boolean; draft: any; setDraft: (draft: any) => void; onSave: () => void; onCancel: () => void }) {
  // Nur Postings des gerade gewählten Anlasses zur Auswahl anbieten – ein Material kann
  // optional einem einzelnen Posting statt dem ganzen Anlass zugeordnet werden (z. B. "dieses
  // Bild nur für die Erinnerung", nicht für die Hauptankündigung).
  const postsForItem = posts.filter((post) => post.editorialItemId === draft.editorialItemId);
  const selectedItem = items.find((entry: any) => entry.id === draft.editorialItemId);
  const selectedPost = postsForItem.find((post: any) => post.id === draft.postId);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>Material hinzufügen</DialogTitle><DialogDescription>Wird dem gewählten Redaktionsanlass zugeordnet.</DialogDescription></DialogHeader>
        <div className="task-form">
          <label htmlFor="material-item"><span>Redaktionsanlass</span><Select value={draft.editorialItemId} onValueChange={(id) => setDraft({ ...draft, editorialItemId: id as string, postId: '' })}><SelectTrigger id="material-item" className="task-form-select"><SelectValue placeholder="Anlass wählen">{selectedItem?.title}</SelectValue></SelectTrigger><SelectContent>{items.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></label>
          <label htmlFor="material-post"><span>Posting (optional)</span><Select value={draft.postId || 'kein'} onValueChange={(id) => setDraft({ ...draft, postId: id === 'kein' ? '' : (id as string) })}><SelectTrigger id="material-post" className="task-form-select"><SelectValue>{draft.postId ? (selectedPost ? `${selectedPost.type} · ${formatDate(selectedPost.plannedDate)}` : '') : 'Ganzer Anlass (kein bestimmtes Posting)'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="kein">Ganzer Anlass (kein bestimmtes Posting)</SelectItem>{postsForItem.map((post: any) => <SelectItem key={post.id} value={post.id}>{post.type} · {formatDate(post.plannedDate)}</SelectItem>)}</SelectContent></Select></label>
          <label htmlFor="material-title"><span>Titel</span><Input id="material-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label htmlFor="material-type"><span>Art</span><Select value={draft.materialType} onValueChange={(value) => setDraft({ ...draft, materialType: value as string })}><SelectTrigger id="material-type" className="task-form-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Text">Text</SelectItem><SelectItem value="Audio">Audio</SelectItem><SelectItem value="Video">Video</SelectItem><SelectItem value="E-Mail">E-Mail</SelectItem><SelectItem value="Link">Link</SelectItem></SelectContent></Select></label>
          <label htmlFor="material-required"><span>Pflicht?</span><Select value={draft.required ? 'ja' : 'nein'} onValueChange={(value) => setDraft({ ...draft, required: value === 'ja' })}><SelectTrigger id="material-required" className="task-form-select"><SelectValue>{draft.required ? 'Ja, erforderlich' : 'Optional'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ja">Ja, erforderlich</SelectItem><SelectItem value="nein">Optional</SelectItem></SelectContent></Select></label>
          <label htmlFor="material-status"><span>Status</span><Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value as string })}><SelectTrigger id="material-status" className="task-form-select"><SelectValue>{materialStatusLabel(draft.status)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="fehlt">fehlt</SelectItem><SelectItem value="angefragt">angefragt</SelectItem><SelectItem value="vorhanden">vorhanden</SelectItem><SelectItem value="nicht_erforderlich">nicht erforderlich</SelectItem></SelectContent></Select></label>
          <label htmlFor="material-url"><span>Link (optional)</span><Input id="material-url" type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="z. B. Canva/SharePoint/Drive-Link" /></label>
          <label htmlFor="material-due-date"><span>Fällig bis (optional)</span><Input id="material-due-date" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
          <label htmlFor="material-notes"><span>Notiz</span><Textarea id="material-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button onClick={onSave} disabled={!draft.title.trim() || !draft.editorialItemId}>Anlegen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskEditDialog({ items, editing, creating, draft, setDraft, onSave, onCancel, onDelete }: { items: any[]; editing: any; creating: boolean; draft: { title: string; owner: string; dueDate: string; status: string; priority: number; notes: string; editorialItemId: string; referenceUrl: string }; setDraft: (draft: any) => void; onSave: () => void; onCancel: () => void; onDelete: (id: string) => void }) {
  const open = Boolean(editing) || creating;
  const selectedItem = items.find((item) => item.id === draft.editorialItemId);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>{creating ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}</DialogTitle><DialogDescription>{editing ? itemFor(items, editing.editorialItemId).title : 'Manuell anlegen'}</DialogDescription></DialogHeader>
        <div className="task-form">
          {creating && <label htmlFor="task-item"><span>Redaktionsanlass</span><Select value={draft.editorialItemId} onValueChange={(id) => setDraft({ ...draft, editorialItemId: id as string })}><SelectTrigger id="task-item" className="task-form-select"><SelectValue placeholder="Anlass wählen">{selectedItem?.title}</SelectValue></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></label>}
          <label htmlFor="task-title"><span>Aufgabe</span><Input id="task-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label htmlFor="task-owner"><span>Verantwortlich</span><Select value={draft.owner} onValueChange={(owner) => setDraft({ ...draft, owner: owner as string })}><SelectTrigger id="task-owner" className="task-form-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Tom">Tom</SelectItem><SelectItem value="Norbert">Norbert</SelectItem></SelectContent></Select></label>
          <label htmlFor="task-due-date"><span>Fällig am</span><Input id="task-due-date" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
          <label htmlFor="task-status"><span>Status</span><Select value={draft.status} onValueChange={(status) => setDraft({ ...draft, status: status as string })}><SelectTrigger id="task-status" className="task-form-select"><SelectValue>{statusLabel(draft.status)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="offen">offen</SelectItem><SelectItem value="in_arbeit">in Arbeit</SelectItem><SelectItem value="erledigt">erledigt</SelectItem><SelectItem value="gestrichen">gestrichen</SelectItem></SelectContent></Select></label>
          <label htmlFor="task-priority"><span>Priorität (0–100)</span><Input id="task-priority" type="number" min={0} max={100} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} /></label>
          <label htmlFor="task-reference-url"><span>Link (optional)</span><Input id="task-reference-url" type="url" value={draft.referenceUrl} onChange={(event) => setDraft({ ...draft, referenceUrl: event.target.value })} placeholder="z. B. Link zu Canva/SharePoint/Drive" /></label>
          <label htmlFor="task-notes"><span>Notiz</span><Textarea id="task-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div>
        <DialogFooter>
          {editing && <Button variant="destructive" onClick={() => onDelete(editing.id)} style={{ marginRight: 'auto' }}>Löschen</Button>}
          <Button variant="outline" onClick={onCancel}>Abbrechen</Button>
          <Button onClick={onSave} disabled={!draft.title.trim() || !draft.dueDate || (creating && !draft.editorialItemId)}>{creating ? 'Anlegen' : 'Änderungen speichern'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TasksView({ items, tasks, onComplete, onEdit, onCreate }: { items: any[]; tasks: any[]; onComplete: (id: string) => void; onEdit: (task: any) => void; onCreate: () => void }) {
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Nach Fälligkeit sortiert</p><h1>Aufgaben</h1></div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Badge variant="outline">{tasks.filter((task) => task.status !== 'erledigt').length} offen</Badge><Button size="sm" onClick={onCreate}><Plus /> Neue Aufgabe</Button></div></div>
    <div className="task-list">{tasks.map((task) => { const item = itemFor(items, task.editorialItemId); return <article key={task.id} className={cn('task-row', task.status === 'erledigt' && 'done', task.blocked && 'blocked-row')}><button className="task-check" onClick={() => onComplete(task.id)} aria-label={`${task.title} als erledigt markieren`}>{task.status === 'erledigt' && <Check />}</button><div className="task-date"><strong>{formatDate(task.dueDate)}</strong><small>{timeBucket(task.dueDate)}</small></div><div className="task-main"><span className="category-line">{item.format}</span><strong>{task.title}</strong><small>{item.title}{item.subtitle && ` · ${item.subtitle}`}</small></div><div className="task-owner"><CircleUserRound /><span>{task.owner}</span></div><div className="task-actions">{task.blocked ? <Badge className="status-badge status-problem" variant="destructive">blockiert</Badge> : <Badge className={cn('status-badge', `status-${task.status}`)} variant="secondary">{statusLabel(task.status)}</Badge>}<Button variant="ghost" size="icon-sm" onClick={() => onEdit(task)} aria-label={`${task.title} bearbeiten`}><Pencil /></Button></div></article>; })}{!tasks.length && <div className="empty-state"><PackageCheck /><h3>Keine Treffer</h3><p>Mit dieser Filterkombination sind keine Aufgaben offen.</p></div>}</div>
  </section>;
}

function MaterialsView({ items, materials: visible, onCreate }: { items: any[]; materials: any[]; onCreate: () => void }) {
  const present = visible.filter((material) => material.status === 'vorhanden').length;
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Pflichtmaterial und Quellen</p><h1>Materialien</h1></div><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><div className="material-progress"><Progress value={visible.length ? present / visible.length * 100 : 0}><ProgressLabel>Verfügbar</ProgressLabel><span className="progress-count">{present}/{visible.length}</span></Progress></div><Button size="sm" onClick={onCreate}><Plus /> Material hinzufügen</Button></div></div>
    <div className="material-grid">{visible.map((material) => { const item = itemFor(items, material.editorialItemId); return <article className="material-card" key={material.id}><div className={cn('material-icon', material.status)}>{material.type === 'Bild' ? <FileImage /> : material.type === 'Audio' ? <Clock3 /> : <PackageCheck />}</div><div className="material-copy"><span className="category-line">{item.title}</span><strong>{material.title}</strong><small>{material.type} · Quelle: {(material.url || material.fileReference) ? <a href={material.url || material.fileReference} target="_blank" rel="noreferrer">{material.source || 'Link öffnen'} <Link2 size={12} /></a> : (material.source || '—')}</small>{item.format && <small>Empfohlener SharePoint-Ordner: {item.format}</small>}</div><div className="material-state"><Badge className={cn('status-badge', `status-${material.status}`)} variant={material.status === 'vorhanden' ? 'secondary' : material.status === 'fehlt' ? 'destructive' : 'outline'}>{materialStatusLabel(material.status)}</Badge>{material.dueDate && <small>bis {formatDate(material.dueDate)}</small>}</div></article>; })}
    {!visible.length && <div className="empty-state"><PackageCheck /><h3>Keine Materialien</h3><p>Für diese Filterkombination liegen keine Materialien vor.</p></div>}</div>
  </section>;
}
