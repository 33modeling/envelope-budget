import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, coverOverspending, holdForNextMonth, moveMoney, setAssigned, copyPreviousMonth, assignAverage, INCOME } from '../src/budget.js';

const base = () => ({
  categories: [{ id: 'food', group: '생활', name: '식비' }, { id: 'fun', group: '여유', name: '여가', carryOverspend: false }, { id: 'debt', group: '생활', name: '병원', carryOverspend: true }],
  transactions: [{ id: 't0', date: '2026-01-01', account: 'a', amount: 1000000, category: INCOME }],
  budgets: {},
});
const tx = (s, date, amount, category) => ({ ...s, transactions: [...s.transactions, { id: 't' + s.transactions.length, date, account: 'a', amount, category }] });

test('수입은 배정할 돈, 배정하면 줄어든다', () => {
  let s = setAssigned(base(), '2026-01', 'food', 300000);
  const t = computeMonth(s, '2026-01');
  assert.equal(t.income, 1000000);
  assert.equal(t.toBudget, 700000);
  assert.equal(t.rows.food.available, 300000);
});

test('남은 돈은 다음 달로 넘어가고, 배정할 돈도 이어진다', () => {
  let s = setAssigned(base(), '2026-01', 'food', 300000);
  s = tx(s, '2026-01-10', -120000, 'food');
  s = setAssigned(s, '2026-02', 'food', 100000);
  const t = computeMonth(s, '2026-02');
  assert.equal(t.rows.food.carriedIn, 180000);
  assert.equal(t.rows.food.available, 280000);
  assert.equal(t.fromLastMonth, 700000);
  assert.equal(t.toBudget, 600000);
});

test('초과: 이월 끄면 봉투는 0부터, 다음 달 배정할 돈에서 빠진다', () => {
  let s = setAssigned(base(), '2026-01', 'fun', 50000);
  s = tx(s, '2026-01-20', -80000, 'fun');
  const jan = computeMonth(s, '2026-01');
  assert.equal(jan.rows.fun.available, -30000);
  assert.equal(jan.rows.fun.overspent, true);
  const feb = computeMonth(s, '2026-02');
  assert.equal(feb.rows.fun.carriedIn, 0);
  assert.equal(feb.lastMonthOverspent, -30000);
  assert.equal(feb.toBudget, 1000000 - 50000 - 30000);
});

test('초과: 이월 켜면 빚이 봉투로 넘어가고 배정할 돈은 그대로', () => {
  let s = tx(base(), '2026-01-05', -40000, 'debt');
  const feb = computeMonth(s, '2026-02');
  assert.equal(feb.rows.debt.carriedIn, -40000);
  assert.equal(feb.lastMonthOverspent, 0);
  assert.equal(feb.toBudget, 1000000);
});

test('봉투 옮기기와 초과 메우기(내주는 쪽 한도까지)', () => {
  let s = setAssigned(base(), '2026-01', 'food', 100000);
  s = setAssigned(s, '2026-01', 'fun', 10000);
  s = tx(s, '2026-01-03', -30000, 'fun');
  s = coverOverspending(s, '2026-01', 'fun', 'food');
  let t = computeMonth(s, '2026-01');
  assert.equal(t.rows.fun.available, 0);
  assert.equal(t.rows.food.available, 80000);
  s = moveMoney(s, '2026-01', 'food', 'toBudget', 50000);
  t = computeMonth(s, '2026-01');
  assert.equal(t.rows.food.available, 30000);
  assert.equal(t.toBudget, 1000000 - 30000 - 30000); // 식비 30,000 + 여가 10,000+20,000
  // 내주는 봉투가 모자라면 있는 만큼만
  s = tx(s, '2026-01-04', -100000, 'fun');
  s = coverOverspending(s, '2026-01', 'fun', 'food');
  t = computeMonth(s, '2026-01');
  assert.equal(t.rows.food.available, 0);
  assert.equal(t.rows.fun.available, -70000);
});

test('다음 달로 미루기는 이번 달에서 빼고 다음 달에 더한다', () => {
  let s = holdForNextMonth(base(), '2026-01', 400000);
  assert.equal(computeMonth(s, '2026-01').toBudget, 600000);
  assert.equal(computeMonth(s, '2026-02').fromLastMonth, 1000000);
  s = holdForNextMonth(s, '2026-01', 5000000);
  assert.equal(computeMonth(s, '2026-01').held, 1000000);
});

test('지난달 복사와 3개월 평균', () => {
  let s = setAssigned(base(), '2026-01', 'food', 120000);
  s = copyPreviousMonth(s, '2026-02');
  assert.equal(computeMonth(s, '2026-02').rows.food.assigned, 120000);
  s = tx(s, '2026-01-02', -90000, 'food'); s = tx(s, '2026-02-02', -60000, 'food'); s = tx(s, '2026-03-02', -30000, 'food');
  s = assignAverage(s, '2026-04', 3);
  assert.equal(computeMonth(s, '2026-04').rows.food.assigned, 60000);
});

test('계좌 옮기기와 미분류는 봉투에 안 들어간다', () => {
  let s = base();
  s.transactions.push({ id: 'x1', date: '2026-01-02', account: 'a', amount: -50000, category: null, transferId: 'x2' });
  s.transactions.push({ id: 'x3', date: '2026-01-02', account: 'a', amount: -7000, category: null });
  const t = computeMonth(s, '2026-01');
  assert.equal(t.toBudget, 1000000);
  assert.equal(t.uncategorized, -7000);
});
