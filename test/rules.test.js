import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, rankRules, probableCategory, learnRule, normalizeName } from '../src/rules.js';

const rules = [
  { id: 'r1', op: 'contains', value: '스타벅스', category: 'cafe' },
  { id: 'r2', op: 'is', value: '스타벅스 회사점', category: 'work' },
  { id: 'r3', op: 'startsWith', value: 'GS25', category: 'snack', rename: 'GS25 편의점' },
  { id: 'r4', op: 'contains', value: '쿠팡', category: 'big', amountMin: 100000 },
];

test('구체적인 규칙이 나중에 적용돼 이긴다', () => {
  assert.deepEqual(rankRules(rules).map(r => r.id), ['r1', 'r4', 'r3', 'r2']);
  assert.equal(applyRules(rules, { payee: '스타벅스 회사점', amount: -5000 }).tx.category, 'work');
  assert.equal(applyRules(rules, { payee: '스타벅스 강남점', amount: -5000 }).tx.category, 'cafe');
});

test('대소문자·공백 무시, 이름 바꾸기, 금액 조건', () => {
  assert.equal(normalizeName('  GS25   역삼 '), 'gs25 역삼');
  const r = applyRules(rules, { payee: 'gs25 역삼점', amount: -3000 }).tx;
  assert.equal(r.category, 'snack'); assert.equal(r.payee, 'GS25 편의점');
  assert.equal(applyRules(rules, { payee: '쿠팡', amount: -20000 }).tx.category, undefined);
  assert.equal(applyRules(rules, { payee: '쿠팡', amount: -200000 }).tx.category, 'big');
});

test('이미 분류가 있으면 건드리지 않고, 계좌 옮기기는 무시', () => {
  assert.equal(applyRules(rules, { payee: '스타벅스', amount: -1, category: 'mine' }).tx.category, 'mine');
  assert.equal(applyRules(rules, { payee: '스타벅스', amount: -1, transferId: 'x' }).tx.category, undefined);
});

test('최근 5건 중 3건이 같은 분류면 규칙을 배운다', () => {
  const t = (d, c) => ({ id: d, date: d, payee: '김밥천국', amount: -5000, category: c });
  const txs = [t('2026-01-01', 'food'), t('2026-01-02', 'food'), t('2026-01-03', null)];
  assert.equal(probableCategory(txs, '김밥천국'), null);
  txs.push(t('2026-01-04', 'food'));
  assert.equal(probableCategory(txs, ' 김밥천국 '), 'food');
  let { rules: r, changed } = learnRule([], txs, '김밥천국', () => 'new');
  assert.equal(changed, 'created'); assert.equal(r[0].op, 'is'); assert.equal(r[0].category, 'food');
  ({ changed } = learnRule(r, txs, '김밥천국', () => 'x'));
  assert.equal(changed, null);
  txs.push(t('2026-02-01', 'out'), t('2026-02-02', 'out'), t('2026-02-03', 'out'));
  ({ rules: r, changed } = learnRule(r, txs, '김밥천국', () => 'x'));
  assert.equal(changed, 'updated'); assert.equal(r[0].category, 'out'); assert.equal(r.length, 1);
});
