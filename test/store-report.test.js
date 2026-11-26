import test from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, addTransaction, updateTransaction, deleteTransaction, accountBalance, emptyState, load, save, sampleState, KEY } from '../src/store.js';
import { monthReport, trend } from '../src/report.js';
import { computeMonth } from '../src/budget.js';

test('계좌 시작 잔액은 수입, 옮기기는 두 계좌에 짝으로', () => {
  let s = addAccount(emptyState(), { name: '통장', opening: 500000, date: '2026-11-01' });
  s = addAccount(s, { name: '지갑', date: '2026-11-01' });
  const [a, b] = s.accounts.map(x => x.id);
  s = addTransaction(s, { date: '2026-11-02', account: a, amount: -100000, transferAccount: b, payee: '현금 찾기' });
  assert.equal(accountBalance(s, a), 400000); assert.equal(accountBalance(s, b), 100000);
  assert.equal(computeMonth(s, '2026-11').toBudget, 500000);
  const t = s.transactions.find(x => x.account === a && x.transferId);
  s = updateTransaction(s, t.id, { amount: -70000 });
  assert.equal(accountBalance(s, b), 70000);
  s = deleteTransaction(s, t.id);
  assert.equal(s.transactions.length, 1);
});

test('넣을 때 규칙 적용, 분류를 고치면 규칙을 배운다', () => {
  let s = addAccount(emptyState(), { name: '카드' });
  const a = s.accounts[0].id;
  s.rules = [{ id: 'r', op: 'contains', value: '마트', category: 'c5' }];
  s = addTransaction(s, { date: '2026-11-01', account: a, payee: '동네마트', amount: -1000 });
  assert.equal(s.transactions[0].category, 'c5');
  for (let i = 2; i <= 4; i++) s = addTransaction(s, { date: `2026-11-0${i}`, account: a, payee: '김밥집', amount: -5000 });
  for (const t of s.transactions.filter(x => x.payee === '김밥집')) s = updateTransaction(s, t.id, { category: 'c6' });
  assert.equal(s.lastLearned, 'created');
  assert.ok(s.rules.some(r => r.op === 'is' && r.value === '김밥집' && r.category === 'c6'));
});

test('저장 실패해도 죽지 않음', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(load(broken), null); assert.equal(save(broken, emptyState()), false);
  const mem = new Map(); const st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = sampleState(new Date(2026, 10, 26));
  assert.equal(save(st, s), true); assert.ok(mem.has(KEY));
  assert.equal(load(st).transactions.length, s.transactions.length);
});

test('월 보고: 분류별 지출·비율·미분류·흐름', () => {
  const s = sampleState(new Date(2026, 10, 26));
  const r = monthReport(s, '2026-10');
  assert.equal(r.income, 1200000);
  assert.equal(r.rows[0].name, '장보기'); assert.equal(r.rows[0].spent, 86000);
  assert.ok(r.rows.some(x => x.name === '미분류' && x.spent === 32000));
  assert.ok(Math.abs(r.rows.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
  const sk = s.transactions.find(t => t.payee === 'SK텔레콤'); assert.equal(sk.category, 'c2');
  assert.equal(trend(s, '2026-11', 6).length, 6);
});
