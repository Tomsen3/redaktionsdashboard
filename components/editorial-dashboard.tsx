'use client';
/* oxlint-disable typescript/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Archive, BarChart3, Bell, CalendarDays, Check, ChevronRight, CircleUserRound,
  ClipboardCheck, Clock3, ExternalLink, FileImage, Filter, Grid2X2, ImageIcon, LayoutList,
  Link2, PackageCheck, Pencil, Plus, Sparkles, Users, X,
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
import { addDays, generateSchedule, mondayOfWeek, movePost, postingDensity, reassignTask as validateReassign } from '@/lib/editorial-engine.mjs';
import { supabase } from '@/lib/supabase-client';
import { mapFormat, mapItem, mapMaterial, mapPost, mapPostRule, mapQuickLink, mapTask, mapTaskRule } from '@/lib/data-mappers';

type View = 'Übersicht' | 'Redaktionsplan' | 'Kalender' | 'Aufgaben' | 'Materialien';
type Filters = { person: string; time: string; status: string; format: string };

const TODAY = new Date().toISOString().slice(0, 10);
const nav: { name: View; label: string; icon: typeof Grid2X2 }[] = [
  { name: 'Übersicht', label: 'Startseite', icon: Grid2X2 },
  { name: 'Redaktionsplan', label: 'Redaktionsanlässe', icon: LayoutList },
  { name: 'Kalender', label: 'Kalender', icon: CalendarDays },
  { name: 'Aufgaben', label: 'Aufgaben', icon: ClipboardCheck },
  { name: 'Materialien', label: 'Material', icon: FileImage },
];

const formatDate = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`));
const fullDate = (value: string) => new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`));
const itemFor = (items: any[], id: string) => items.find((item) => item.id === id) ?? { title: '', format: '', category: '', people: [], publishOwner: '' };
const statusLabel = (status: string) => ({ in_arbeit: 'in Arbeit', blockiert: 'blockiert', geplant: 'geplant', vorgesehen: 'vorgesehen', offen: 'offen', erledigt: 'erledigt' }[status] || status);
const timeBucket = (date: string) => date < TODAY ? 'Überfällig' : date === TODAY ? 'Heute' : date <= addDays(TODAY, 6) ? 'Diese Woche' : 'Später';

// Ordnet UI-Feldnamen den Supabase-Spalten zu, damit updateTask generisch bleibt.
const TASK_COLUMN: Record<string, string> = { title: 'title', owner: 'owner_name', dueDate: 'due_date', status: 'status', priority: 'priority', notes: 'notes' };

function FilterBar({ filters, onChange, formatNames }: { filters: Filters; onChange: (filters: Filters) => void; formatNames: string[] }) {
  const choices = {
    person: ['Alle', 'Tom', 'Norbert'],
    time: ['Alle', 'Überfällig', 'Heute', 'Diese Woche', 'Später'],
    status: ['Alle', 'offen', 'in_arbeit', 'geplant', 'blockiert', 'erledigt'],
    format: ['Alle', ...formatNames],
  };
  return (
    <div className="filterbar" aria-label="Kombinierbare Filter">
      <div className="filter-title"><Filter size={16} /> Filter kombinieren</div>
      {(Object.keys(choices) as (keyof Filters)[]).map((key) => (
        <Select key={key} value={filters[key]} onValueChange={(value) => onChange({ ...filters, [key]: value as string })}>
          <SelectTrigger aria-label={key} className={cn('filter-select', filters[key] !== 'Alle' && 'active')}><SelectValue /></SelectTrigger>
          <SelectContent>{choices[key].map((choice) => <SelectItem key={choice} value={choice}>{statusLabel(choice)}</SelectItem>)}</SelectContent>
        </Select>
      ))}
      {Object.values(filters).some((value) => value !== 'Alle') && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ person: 'Alle', time: 'Alle', status: 'Alle', format: 'Alle' })}>
          <X /> Zurücksetzen
        </Button>
      )}
    </div>
  );
}

function Metric({ label, value, detail, tone = 'neutral', icon: Icon, action, onClick }: { label: string; value: string; detail: string; tone?: string; icon: typeof CalendarDays; action: string; onClick?: () => void }) {
  return <article className={cn('metric', `metric-${tone}`)}>
    <Icon className="metric-icon" />
    <div className="metric-value"><strong>{value}</strong><span>{label}</span></div>
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
  const [formats, setFormats] = useState<any[]>([]);
  const [postRules, setPostRules] = useState<any[]>([]);
  const [taskRules, setTaskRules] = useState<any[]>([]);
  const [filters, setFilters] = useState<Filters>({ person: 'Alle', time: 'Alle', status: 'Alle', format: 'Alle' });

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
      const [itemsRes, postsRes, tasksRes, materialsRes, quickLinksRes, formatsRes, postRulesRes, taskRulesRes] = await Promise.all([
        supabase.from('editorial_items').select('*, editorial_formats(name, category, logic_type)').is('archived_at', null).order('created_at'),
        supabase.from('posts').select('*').is('archived_at', null).order('planned_date'),
        supabase.from('tasks').select('*').is('archived_at', null).order('due_date'),
        supabase.from('materials').select('*').order('due_date'),
        supabase.from('quick_links').select('*').order('sort_order'),
        supabase.from('editorial_formats').select('*').eq('active', true).order('category').order('name'),
        supabase.from('post_rules').select('*').eq('active', true),
        supabase.from('task_rules').select('*').eq('active', true),
      ]);
      if (cancelled) return;
      if (itemsRes.error) console.error('Redaktionsanlässe konnten nicht geladen werden', itemsRes.error);
      if (postsRes.error) console.error('Posts konnten nicht geladen werden', postsRes.error);
      if (tasksRes.error) console.error('Aufgaben konnten nicht geladen werden', tasksRes.error);
      if (materialsRes.error) console.error('Materialien konnten nicht geladen werden', materialsRes.error);
      if (quickLinksRes.error) console.error('Schnellzugriff-Links konnten nicht geladen werden', quickLinksRes.error);
      if (formatsRes.error) console.error('Formate konnten nicht geladen werden', formatsRes.error);
      if (postRulesRes.error) console.error('Post-Regeln konnten nicht geladen werden', postRulesRes.error);
      if (taskRulesRes.error) console.error('Aufgaben-Regeln konnten nicht geladen werden', taskRulesRes.error);
      setItems((itemsRes.data ?? []).map(mapItem));
      setPosts((postsRes.data ?? []).map(mapPost));
      setTasks((tasksRes.data ?? []).map(mapTask));
      setMaterials((materialsRes.data ?? []).map(mapMaterial));
      setQuickLinks((quickLinksRes.data ?? []).map(mapQuickLink));
      setFormats((formatsRes.data ?? []).map(mapFormat));
      setPostRules((postRulesRes.data ?? []).map(mapPostRule));
      setTaskRules((taskRulesRes.data ?? []).map(mapTaskRule));
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

    const channel = supabase
      .channel('redaktionsdashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editorial_items' }, applyChange(setItems, mapItem))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, applyChange(setPosts, mapPost))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, applyChange(setTasks, mapTask))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, applyChange(setMaterials, mapMaterial))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_links' }, applyChange(setQuickLinks, mapQuickLink))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'editorial_formats' }, applyChange(setFormats, mapFormat))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_rules' }, applyChange(setPostRules, mapPostRule))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_rules' }, applyChange(setTaskRules, mapTaskRule))
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [session]);

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

  const updateTask = useCallback((id: string, changes: Record<string, string>) => {
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
  const [taskDraft, setTaskDraft] = useState({ title: '', owner: 'Tom', dueDate: '', status: 'offen', priority: 50, notes: '', editorialItemId: '' });

  const startEditingTask = useCallback((task: any) => {
    setEditingTask(task);
    setCreatingTask(false);
    setTaskDraft({ title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status, priority: task.priority ?? 50, notes: task.notes ?? '', editorialItemId: task.editorialItemId });
  }, []);

  const startCreatingTask = useCallback(() => {
    setEditingTask(null);
    setCreatingTask(true);
    setTaskDraft({ title: '', owner: 'Tom', dueDate: TODAY, status: 'offen', priority: 50, notes: '', editorialItemId: items[0]?.id ?? '' });
  }, [items]);

  const saveTaskEdit = useCallback(() => {
    if (!taskDraft.title.trim() || !taskDraft.dueDate) return;
    if (editingTask) {
      updateTask(editingTask.id, { title: taskDraft.title.trim(), owner: taskDraft.owner, dueDate: taskDraft.dueDate, status: taskDraft.status, priority: taskDraft.priority, notes: taskDraft.notes });
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
  const openItem = items.find((item) => item.id === openItemId) ?? null;
  const detailPosts = posts.filter((post) => post.editorialItemId === openItemId).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const detailTasks = tasks.filter((task) => task.editorialItemId === openItemId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const detailMaterials = materials.filter((material) => material.editorialItemId === openItemId);

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
    eventEnd: '',
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
    setItemDraft((current: any) => ({
      ...current,
      formatId,
      contentOwner: format?.defaultContentOwner ?? current.contentOwner,
      graphicsOwner: format?.defaultGraphicsOwner ?? current.graphicsOwner,
      approvalOwner: format?.defaultApprovalOwner ?? current.approvalOwner,
      publishOwner: format?.defaultPublishOwner ?? current.publishOwner,
    }));
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
      event_start: format.logicType === 'event' && itemDraft.eventStart ? `${itemDraft.eventStart}T12:00:00Z` : null,
      event_end: format.logicType === 'event' && itemDraft.eventEnd ? `${itemDraft.eventEnd}T12:00:00Z` : null,
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
      }))).select('id, post_rule_id');
      if (error) console.error('Postings konnten nicht angelegt werden', error);
      insertedPosts = data ?? [];
    }

    if (newTasks.length) {
      // Temporäre generateSchedule-IDs (nur lokal) auf die echten Supabase-IDs der
      // gerade angelegten Posts ummappen, damit tasks.post_id gültig auf posts.id zeigt.
      const ruleIdToRealPostId = Object.fromEntries(insertedPosts.map((row2) => [row2.post_rule_id, row2.id]));
      const tempIdToRealPostId = Object.fromEntries(newPosts.map((post: any) => [post.id, ruleIdToRealPostId[post.postRuleId]]));
      const { error } = await supabase.from('tasks').insert(newTasks.map((task: any) => ({
        editorial_item_id: task.editorialItemId,
        post_id: task.postId ? tempIdToRealPostId[task.postId] ?? null : null,
        title: task.title,
        owner_name: task.owner,
        due_date: task.dueDate,
        status: task.status,
        task_type: task.type,
        relative_offset_days: task.relativeOffsetDays ?? null,
        auto_generated: task.autoGenerated,
      })));
      if (error) console.error('Aufgaben konnten nicht angelegt werden', error);
    }

    setSavingItem(false);
    setCreatingItem(false);
    // Item/Posts/Tasks erscheinen automatisch über die bestehende Realtime-Subscription.
  }, [formats, itemDraft, postRules, taskRules]);

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
      (filters.format === 'Alle' || item.format === filters.format);
  });
  const visibleTasks = tasks.filter((task) => {
    const item = itemFor(items, task.editorialItemId);
    return (filters.person === 'Alle' || task.owner === filters.person) &&
      (filters.time === 'Alle' || timeBucket(task.dueDate) === filters.time) &&
      (filters.status === 'Alle' || task.status === filters.status) &&
      (filters.format === 'Alle' || item.format === filters.format);
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const visibleMaterials = materials.filter((material) => {
    const item = itemFor(items, material.editorialItemId);
    return (filters.person === 'Alle' || item.people.includes(filters.person)) &&
      (filters.time === 'Alle' || timeBucket(material.dueDate) === filters.time) &&
      (filters.status === 'Alle' || material.status === filters.status) &&
      (filters.format === 'Alle' || item.format === filters.format);
  });

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
              <SidebarMenuItem><SidebarMenuButton tooltip="Formate & Regeln"><Sparkles /><span>Formate & Regeln</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton tooltip="Archiv"><Archive /><span>Archiv</span></SidebarMenuButton></SidebarMenuItem>
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
          {view !== 'Übersicht' && <FilterBar filters={filters} onChange={setFilters} formatNames={formats.map((format) => format.name)} />}

          {view === 'Übersicht' && <Overview items={items} posts={posts} tasks={tasks} conflict={conflict} onNavigate={setView} onResolve={resolveConflict} onEditTask={startEditingTask} onOpenItem={setOpenItemId} quickLinks={quickLinks} onEditLink={startEditingLink} onCreateItem={startCreatingItem} />}
          {view === 'Redaktionsplan' && <EditorialPlan items={items} posts={visiblePosts} onOpenItem={setOpenItemId} onCreateItem={startCreatingItem} />}
          {view === 'Kalender' && <CalendarView items={items} posts={visiblePosts} onMovePost={startMovingPost} />}
          {view === 'Aufgaben' && <TasksView items={items} tasks={visibleTasks} onComplete={completeTask} onEdit={startEditingTask} onCreate={startCreatingTask} />}
          {view === 'Materialien' && <MaterialsView items={items} materials={visibleMaterials} />}
        </div>

        <TaskEditDialog items={items} editing={editingTask} creating={creatingTask} draft={taskDraft} setDraft={setTaskDraft} onSave={saveTaskEdit} onCancel={cancelTaskEdit} onDelete={deleteTask} />
        <PostMoveDialog items={items} moving={movingPost} date={moveDate} setDate={setMoveDate} onSave={saveMovePost} onCancel={cancelMovePost} />
        <ItemDetailDialog item={openItem} posts={detailPosts} tasks={detailTasks} materials={detailMaterials} onClose={() => setOpenItemId(null)} onEditTask={startEditingTask} onMovePost={startMovingPost} />
        <QuickLinkEditDialog editing={editingLink} draft={linkDraft} setDraft={setLinkDraft} onSave={saveLinkEdit} onCancel={cancelLinkEdit} />
        <ItemCreateDialog open={creatingItem} formats={formats} draft={itemDraft} setDraft={setItemDraft} onChooseFormat={chooseItemFormat} onSave={saveItemCreate} onCancel={cancelCreatingItem} saving={savingItem} error={itemSaveError} />

        <nav className="mobile-nav" aria-label="Mobile Hauptnavigation">{nav.map(({ name, label, icon: Icon }) => (
          <button key={name} className={view === name ? 'active' : ''} onClick={() => setView(name)}><Icon /><span>{name === 'Redaktionsplan' ? 'Anlässe' : label}</span></button>
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

function EditorialPlan({ items, posts, onOpenItem, onCreateItem }: { items: any[]; posts: any[]; onOpenItem: (itemId: string) => void; onCreateItem: () => void }) {
  const openRow = (event: any, itemId: string) => { if (event.key && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault?.(); onOpenItem(itemId); };
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Alle Veröffentlichungen</p><h1>Redaktionsplan</h1></div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Badge variant="outline">{posts.length} Ergebnisse</Badge><Button size="sm" onClick={onCreateItem}><Plus /> Neuer Redaktionsanlass</Button></div></div>
    <div className="desktop-table"><table><thead><tr><th>Datum</th><th>Inhalt</th><th>Posting</th><th>Status</th><th>Verantwortung</th><th>Kanäle</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{[...posts].sort((a,b) => a.plannedDate.localeCompare(b.plannedDate)).map((post) => { const item = itemFor(items, post.editorialItemId); return <tr key={post.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><td><strong>{formatDate(post.plannedDate)}</strong>{post.lateEntry && <small>neu geplant</small>}</td><td><span className="category-line">{item.category}</span><strong>{item.title}</strong><small>{item.format}</small></td><td>{post.type}{post.conditional && <small>bedingt</small>}</td><td><Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge></td><td><span>{item.contentOwner}</span><small>→ {item.publishOwner}</small></td><td><div className="channel-dots" aria-label="Instagram Facebook LinkedIn"><i>IG</i><i>FB</i><i>IN</i></div></td><td><ChevronRight size={17} /></td></tr>; })}</tbody></table></div>
    <div className="mobile-cards">{posts.map((post) => { const item = itemFor(items, post.editorialItemId); return <article className="plan-card" key={post.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onOpenItem(item.id)} onKeyDown={(event) => openRow(event, item.id)} aria-label={`${item.title}: Details öffnen`}><div><span className="category-line">{item.format}</span><h3>{item.title}</h3></div><Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge><div className="plan-card-row"><strong>{fullDate(post.plannedDate)}</strong><span>{post.type}</span></div><div className="meta"><span><Users /> {item.contentOwner} / {item.publishOwner}</span><span>IG · FB · IN</span></div></article>; })}</div>
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
function ItemDetailDialog({ item, posts, tasks, materials, onClose, onEditTask, onMovePost }: { item: any; posts: any[]; tasks: any[]; materials: any[]; onClose: () => void; onEditTask: (task: any) => void; onMovePost: (post: any) => void }) {
  const row: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border, #e5e5e5)', textAlign: 'left', width: '100%', background: 'none', border: 'none', borderBottomWidth: 1, borderBottomStyle: 'solid' };
  const sectionHeading: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '20px 0 8px', fontSize: 14, fontWeight: 600 };
  const empty: CSSProperties = { fontSize: 13, opacity: 0.7, padding: '4px 0' };
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="task-dialog" style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>{item?.title}</DialogTitle>
          <DialogDescription>{[item?.format, item?.category].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <h3 style={sectionHeading}><CalendarDays size={16} /> Postings</h3>
          {posts.length ? posts.map((post) => (
            <div style={row} key={post.id}>
              <span>{formatDate(post.plannedDate)}</span>
              <span>{post.type}{post.conditional && <small> · bedingt</small>}</span>
              <Badge className={cn('status-badge', `status-${post.status}`)} variant={post.status === 'blockiert' ? 'destructive' : 'secondary'}>{statusLabel(post.status)}</Badge>
              <Button variant="ghost" size="sm" onClick={() => onMovePost(post)}>Verschieben</Button>
            </div>
          )) : <p style={empty}>Keine Postings vorhanden.</p>}

          <h3 style={sectionHeading}><ClipboardCheck size={16} /> Aufgaben</h3>
          {tasks.length ? tasks.map((task) => (
            <button type="button" style={row} key={task.id} onClick={() => onEditTask(task)} aria-label={`${task.title} bearbeiten`}>
              <span>{formatDate(task.dueDate)}</span>
              <span>{task.title}</span>
              <span>{task.owner}</span>
              <Badge className={cn('status-badge', task.blocked ? 'status-problem' : `status-${task.status}`)} variant={task.blocked ? 'destructive' : 'secondary'}>{task.blocked ? 'blockiert' : statusLabel(task.status)}</Badge>
            </button>
          )) : <p style={empty}>Keine Aufgaben vorhanden.</p>}

          <h3 style={sectionHeading}><FileImage size={16} /> Materialien</h3>
          {materials.length ? materials.map((material) => (
            <div style={row} key={material.id}>
              <span>{material.title}</span>
              <span>{(material.url || material.fileReference) ? <a href={material.url || material.fileReference} target="_blank" rel="noreferrer">{material.source || 'Link öffnen'} <Link2 size={12} /></a> : (material.source || '—')}</span>
              <Badge className={cn('status-badge', `status-${material.status}`)} variant={material.status === 'vorhanden' ? 'secondary' : material.status === 'fehlt' ? 'destructive' : 'outline'}>{material.status}</Badge>
              <span />
            </div>
          )) : <p style={empty}>Keine Materialien vorhanden.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Schließen</Button></DialogFooter>
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
              <SelectTrigger id="item-format" className="task-form-select"><SelectValue /></SelectTrigger>
              <SelectContent>{formats.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name} ({entry.category})</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label htmlFor="item-title"><span>Titel</span><Input id="item-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="z. B. Guitar Factory Herbst 2026" /></label>
          <label htmlFor="item-subtitle"><span>Untertitel (optional)</span><Input id="item-subtitle" value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>

          {logicType === 'event' && <>
            <label htmlFor="item-event-start"><span>Beginn</span><Input id="item-event-start" type="date" value={draft.eventStart} onChange={(event) => setDraft({ ...draft, eventStart: event.target.value })} /></label>
            <label htmlFor="item-event-end"><span>Ende (optional)</span><Input id="item-event-end" type="date" value={draft.eventEnd} onChange={(event) => setDraft({ ...draft, eventEnd: event.target.value })} /></label>
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

function TaskEditDialog({ items, editing, creating, draft, setDraft, onSave, onCancel, onDelete }: { items: any[]; editing: any; creating: boolean; draft: { title: string; owner: string; dueDate: string; status: string; priority: number; notes: string; editorialItemId: string }; setDraft: (draft: any) => void; onSave: () => void; onCancel: () => void; onDelete: (id: string) => void }) {
  const open = Boolean(editing) || creating;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="task-dialog">
        <DialogHeader><DialogTitle>{creating ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}</DialogTitle><DialogDescription>{editing ? itemFor(items, editing.editorialItemId).title : 'Manuell anlegen'}</DialogDescription></DialogHeader>
        <div className="task-form">
          {creating && <label htmlFor="task-item"><span>Redaktionsanlass</span><Select value={draft.editorialItemId} onValueChange={(id) => setDraft({ ...draft, editorialItemId: id as string })}><SelectTrigger id="task-item" className="task-form-select"><SelectValue /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></label>}
          <label htmlFor="task-title"><span>Aufgabe</span><Input id="task-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label htmlFor="task-owner"><span>Verantwortlich</span><Select value={draft.owner} onValueChange={(owner) => setDraft({ ...draft, owner: owner as string })}><SelectTrigger id="task-owner" className="task-form-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Tom">Tom</SelectItem><SelectItem value="Norbert">Norbert</SelectItem></SelectContent></Select></label>
          <label htmlFor="task-due-date"><span>Fällig am</span><Input id="task-due-date" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
          <label htmlFor="task-status"><span>Status</span><Select value={draft.status} onValueChange={(status) => setDraft({ ...draft, status: status as string })}><SelectTrigger id="task-status" className="task-form-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="offen">offen</SelectItem><SelectItem value="in_arbeit">in Arbeit</SelectItem><SelectItem value="erledigt">erledigt</SelectItem><SelectItem value="gestrichen">gestrichen</SelectItem></SelectContent></Select></label>
          <label htmlFor="task-priority"><span>Priorität (0–100)</span><Input id="task-priority" type="number" min={0} max={100} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} /></label>
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
    <div className="task-list">{tasks.map((task) => { const item = itemFor(items, task.editorialItemId); return <article key={task.id} className={cn('task-row', task.status === 'erledigt' && 'done', task.blocked && 'blocked-row')}><button className="task-check" onClick={() => onComplete(task.id)} aria-label={`${task.title} als erledigt markieren`}>{task.status === 'erledigt' && <Check />}</button><div className="task-date"><strong>{formatDate(task.dueDate)}</strong><small>{timeBucket(task.dueDate)}</small></div><div className="task-main"><span className="category-line">{item.format}</span><strong>{task.title}</strong><small>{item.title}</small></div><div className="task-owner"><CircleUserRound /><span>{task.owner}</span></div><div className="task-actions">{task.blocked ? <Badge className="status-badge status-problem" variant="destructive">blockiert</Badge> : <Badge className={cn('status-badge', `status-${task.status}`)} variant="secondary">{statusLabel(task.status)}</Badge>}<Button variant="ghost" size="icon-sm" onClick={() => onEdit(task)} aria-label={`${task.title} bearbeiten`}><Pencil /></Button></div></article>; })}{!tasks.length && <div className="empty-state"><PackageCheck /><h3>Keine Treffer</h3><p>Mit dieser Filterkombination sind keine Aufgaben offen.</p></div>}</div>
  </section>;
}

function MaterialsView({ items, materials: visible }: { items: any[]; materials: any[] }) {
  const present = visible.filter((material) => material.status === 'vorhanden').length;
  return <section className="panel wide-panel"><div className="panel-heading"><div><p className="eyebrow">Pflichtmaterial und Quellen</p><h1>Materialien</h1></div><div className="material-progress"><Progress value={visible.length ? present / visible.length * 100 : 0}><ProgressLabel>Verfügbar</ProgressLabel><span className="progress-count">{present}/{visible.length}</span></Progress></div></div>
    <div className="material-grid">{visible.map((material) => { const item = itemFor(items, material.editorialItemId); return <article className="material-card" key={material.id}><div className={cn('material-icon', material.status)}>{material.type === 'Bild' ? <FileImage /> : material.type === 'Audio' ? <Clock3 /> : <PackageCheck />}</div><div className="material-copy"><span className="category-line">{item.title}</span><strong>{material.title}</strong><small>{material.type} · Quelle: {(material.url || material.fileReference) ? <a href={material.url || material.fileReference} target="_blank" rel="noreferrer">{material.source || 'Link öffnen'} <Link2 size={12} /></a> : (material.source || '—')}</small></div><div className="material-state"><Badge className={cn('status-badge', `status-${material.status}`)} variant={material.status === 'vorhanden' ? 'secondary' : material.status === 'fehlt' ? 'destructive' : 'outline'}>{material.status}</Badge>{material.dueDate && <small>bis {formatDate(material.dueDate)}</small>}</div></article>; })}
    {!visible.length && <div className="empty-state"><PackageCheck /><h3>Keine Materialien</h3><p>Für diese Filterkombination liegen keine Materialien vor.</p></div>}</div>
  </section>;
}
