import test from 'node:test';
import assert from 'node:assert/strict';
import { isItemComplete } from '../lib/editorial-engine.mjs';

const eventItem = { id: 'item-1', logicType: 'event', eventStart: '2026-01-10', eventEnd: '2026-01-11' };

test('Anlass mit zukünftigem Termin ist nicht abgeschlossen, egal wie die Aufgaben stehen', () => {
  const future = { ...eventItem, eventStart: '2099-01-10', eventEnd: '2099-01-11' };
  const tasks = [{ id: 't1', editorialItemId: 'item-1', status: 'erledigt' }];
  assert.equal(isItemComplete(future, tasks, '2026-09-06'), false);
});

test('Anlass mit verstrichenem Termin und offenen Aufgaben ist nicht abgeschlossen', () => {
  const tasks = [
    { id: 't1', editorialItemId: 'item-1', status: 'erledigt' },
    { id: 't2', editorialItemId: 'item-1', status: 'offen' },
  ];
  assert.equal(isItemComplete(eventItem, tasks, '2026-09-06'), false);
});

test('Anlass mit verstrichenem Termin und ausschließlich erledigten/gestrichenen Aufgaben ist abgeschlossen', () => {
  const tasks = [
    { id: 't1', editorialItemId: 'item-1', status: 'erledigt' },
    { id: 't2', editorialItemId: 'item-1', status: 'gestrichen' },
    { id: 't3', editorialItemId: 'other-item', status: 'offen' },
  ];
  assert.equal(isItemComplete(eventItem, tasks, '2026-09-06'), true);
});

test('Anlass mit verstrichenem Termin und ganz ohne zugehörige Aufgaben gilt als abgeschlossen', () => {
  assert.equal(isItemComplete(eventItem, [], '2026-09-06'), true);
});

test('Publikations-Format nutzt das Ziel-Veröffentlichungsdatum als Anker', () => {
  const pubItem = { id: 'item-2', logicType: 'publication', publicationTargetDate: '2026-01-01' };
  assert.equal(isItemComplete(pubItem, [], '2026-09-06'), true);
  assert.equal(isItemComplete({ ...pubItem, publicationTargetDate: '2099-01-01' }, [], '2026-09-06'), false);
});
