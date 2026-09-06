import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, movePost, postingDensity, reassignTask } from '../lib/editorial-engine.mjs';

const item = {
  id: 'schnupper-f', formatId: 'schnupperkurs', logicType: 'event',
  eventStart: '2026-09-11', createdAt: '2026-09-05',
  contentOwner: 'Tom', publishOwner: 'Norbert',
};
const postRules = [
  { id: 'p1', formatId: 'schnupperkurs', postType: 'Hauptankündigung', offsetDays: -10, priority: 90, conditional: false },
  { id: 'p2', formatId: 'schnupperkurs', postType: 'Erinnerung', offsetDays: -1, priority: 95, conditional: false },
];
const taskRules = [
  { id: 'text', postType: 'Hauptankündigung', title: 'Text finalisieren', offsetDays: -2, ownerRole: 'content', taskType: 'text' },
  { id: 'publish', postType: '*', title: 'Veröffentlichen', offsetDays: 0, ownerRole: 'publish', taskType: 'ausspielung' },
];

test('Late Entry erzeugt keine rückwirklich überfälligen Aufgaben', () => {
  const result = generateSchedule({ item, postRules, taskRules, today: '2026-09-05' });
  assert.equal(result.posts[0].plannedDate, '2026-09-07');
  assert.equal(result.posts[0].lateEntry, true);
  assert.ok(result.tasks.every((task) => task.dueDate >= '2026-09-05'));
  assert.equal(result.tasks.find((task) => task.title === 'Veröffentlichen')?.owner, 'Norbert');
});

test('Relative Aufgabenfristen wandern mit einem Posting', () => {
  const result = generateSchedule({ item, postRules, taskRules, today: '2026-09-05' });
  const moved = movePost(result.posts, result.tasks, result.posts[1].id, '2026-09-12');
  const publishing = moved.tasks.find((task) => task.postId === result.posts[1].id && task.title === 'Veröffentlichen');
  assert.equal(publishing.dueDate, '2026-09-12');
});

test('Mehr als drei redaktionelle Postings pro Woche erzeugen einen Konflikt', () => {
  const posts = ['07', '09', '10', '12'].map((day, index) => ({ id: String(index), plannedDate: `2026-09-${day}`, status: 'vorgesehen' }));
  assert.equal(postingDensity(posts)['2026-09-07'].level, 'conflict');
  assert.equal(postingDensity(posts)['2026-09-07'].count, 4);
});

test('Eine Aufgabe kann von Tom an Norbert übergeben werden', () => {
  const tasks = [{ id: 'task-1', title: 'Grafik finalisieren', owner: 'Tom' }];
  const reassigned = reassignTask(tasks, 'task-1', 'Norbert');
  assert.equal(reassigned[0].owner, 'Norbert');
  assert.equal(tasks[0].owner, 'Tom');
  assert.throws(() => reassignTask(tasks, 'task-1', 'Unbekannt'));
});
