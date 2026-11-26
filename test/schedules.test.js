import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, skipWeekend, scheduleStatus, dueTransactions, describeSchedule } from '../src/schedules.js';

test('매월 31일은 짧은 달의 마지막 날', () => {
  const s = { id: 's', start: '2026-01-31', frequency: 'monthly', interval: 1, endMode: 'never' };
  assert.deepEqual(occurrences(s, '2026-01-01', '2026-04-30').map(o => o.due), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('주말 옮기기: 2026-11-28 토요일', () => {
  assert.equal(skipWeekend('2026-11-28', 'before'), '2026-11-27');
  assert.equal(skipWeekend('2026-11-28', 'after'), '2026-11-30');
  assert.equal(skipWeekend('2026-11-29', 'before'), '2026-11-27');
  assert.equal(skipWeekend('2026-11-26', 'after'), '2026-11-26');
});

test('n주마다·횟수 끝·날짜 끝·매년', () => {
  assert.deepEqual(occurrences({ start: '2026-01-01', frequency: 'weekly', interval: 2, endMode: 'count', endCount: 3 }, '2026-01-01', '2026-12-31').map(o => o.due),
    ['2026-01-01', '2026-01-15', '2026-01-29']);
  assert.equal(occurrences({ start: '2026-01-10', frequency: 'monthly', endMode: 'date', endDate: '2026-06-09' }, '2026-01-01', '2027-01-01').length, 5);
  assert.deepEqual(occurrences({ start: '2024-02-29', frequency: 'yearly' }, '2024-01-01', '2026-12-31').map(o => o.due), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('상태와 자동 넣기(겹치지 않게)', () => {
  const s = { id: 'rent', name: '월세', payee: '집주인', amount: -500000, account: 'a', category: 'c1', start: '2026-10-25', frequency: 'monthly', autoPost: true };
  assert.equal(scheduleStatus(s, [], '2026-11-26').status, 'missed');
  let n = 0;
  const due = dueTransactions([s], [], '2026-11-26', { makeId: () => 'x' + n++ });
  assert.deepEqual(due.map(t => t.date), ['2026-10-25', '2026-11-25']);
  assert.equal(dueTransactions([s], due, '2026-11-26', { makeId: () => 'y' }).length, 0);
  const st = scheduleStatus(s, due, '2026-11-26');
  assert.equal(st.status, 'scheduled'); assert.equal(st.next.date, '2026-12-25');
  assert.equal(scheduleStatus(s, due, '2026-12-20').status, 'upcoming');
  assert.equal(scheduleStatus(s, due, '2026-12-25').status, 'due');
  assert.equal(scheduleStatus({ ...s, endMode: 'count', endCount: 2 }, due, '2026-11-26').status, 'completed');
  assert.equal(describeSchedule({ ...s, weekend: 'before' }), '매월 25일(주말이면 금요일)');
});

test('시작일이 주말이라 앞으로 당겨져도 첫 회차를 넣는다', () => {
  const s = { id: 'pay', start: '2026-10-10', frequency: 'monthly', weekend: 'before', autoPost: true, amount: 1, account: 'a' };
  assert.deepEqual(occurrences(s, s.start, '2026-11-26').map(o => o.date), ['2026-10-09', '2026-11-10']);
  assert.equal(dueTransactions([s], [], '2026-11-26', { makeId: () => 'x' }).length, 2);
});
