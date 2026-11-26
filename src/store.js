// 상태(계좌·분류·거래·배정·반복·규칙)와 저장. 저장은 이 기기 localStorage(실패해도 앱은 동작).
import { applyRules, learnRule } from './rules.js';
import { addMonths, today } from './months.js';

export const KEY = 'envelope-budget/v1';
export const VERSION = 1;

let seq = 0;
export function makeId(prefix = 'id') {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_CATEGORIES = [
  ['고정비', ['월세·관리비', '통신비', '보험', '구독']],
  ['생활', ['장보기', '식비', '교통', '생활용품', '의료']],
  ['여유', ['외식·카페', '문화·여가', '쇼핑', '경조사']],
  ['모으기', ['비상금', '여행']],
];

export function emptyState() {
  const categories = [];
  let n = 0;
  for (const [group, names] of DEFAULT_CATEGORIES) for (const name of names) categories.push({ id: `c${++n}`, group, name, carryOverspend: false });
  return { version: VERSION, accounts: [], categories, transactions: [], budgets: {}, schedules: [], rules: [], settings: { upcomingDays: 7 } };
}

export function validState(s) {
  return s && typeof s === 'object' && Array.isArray(s.accounts) && Array.isArray(s.categories) && Array.isArray(s.transactions)
    && Array.isArray(s.schedules) && Array.isArray(s.rules) && s.budgets && typeof s.budgets === 'object';
}

export function load(storage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return validState(s) ? { ...emptyState(), ...s } : null;
  } catch { return null; }
}

export function save(storage, state) {
  try { storage?.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function accountBalance(state, accountId, upTo = null) {
  let b = 0;
  for (const t of state.transactions) if (t.account === accountId && (!upTo || t.date <= upTo)) b += t.amount;
  return b;
}

// 거래 넣기. transferAccount 가 있으면 맞은편 거래를 같이 만든다(분류 없음). 규칙은 분류가 비었을 때만 적용.
export function addTransaction(state, input) {
  const tx = { id: input.id || makeId('t'), date: input.date, account: input.account, payee: (input.payee || '').trim(),
    amount: Math.round(input.amount), category: input.category || null, memo: (input.memo || '').trim() };
  for (const k of ['scheduleId', 'occurrence', 'imported']) if (input[k]) tx[k] = input[k];
  if (input.transferAccount && input.transferAccount !== input.account) {
    const pairId = makeId('t');
    const a = { ...tx, category: null, transferId: pairId, transferAccount: input.transferAccount };
    const b = { ...tx, id: pairId, account: input.transferAccount, amount: -tx.amount, category: null, transferId: tx.id, transferAccount: tx.account };
    delete b.scheduleId; delete b.occurrence;
    return { ...state, transactions: [...state.transactions, a, b] };
  }
  const { tx: ruled } = applyRules(state.rules, tx);
  return { ...state, transactions: [...state.transactions, ruled] };
}

export function updateTransaction(state, id, patch) {
  const old = state.transactions.find(t => t.id === id);
  if (!old) return state;
  let transactions = state.transactions.map(t => (t.id === id ? { ...t, ...patch } : t));
  if (old.transferId) {
    const mirror = {};
    if ('date' in patch) mirror.date = patch.date;
    if ('amount' in patch) mirror.amount = -patch.amount;
    if ('payee' in patch) mirror.payee = patch.payee;
    if ('memo' in patch) mirror.memo = patch.memo;
    transactions = transactions.map(t => (t.id === old.transferId ? { ...t, ...mirror } : t));
  }
  let next = { ...state, transactions };
  if ('category' in patch && patch.category && patch.category !== old.category && !old.transferId) {
    const learned = learnRule(next.rules, next.transactions, next.transactions.find(t => t.id === id).payee, () => makeId('r'));
    next = { ...next, rules: learned.rules };
    next.lastLearned = learned.changed;
  }
  return next;
}

export function deleteTransaction(state, id) {
  const t = state.transactions.find(x => x.id === id);
  const drop = new Set([id, t?.transferId].filter(Boolean));
  return { ...state, transactions: state.transactions.filter(x => !drop.has(x.id)) };
}

export function addAccount(state, { name, kind = 'bank', opening = 0, date = today() }) {
  const id = makeId('a');
  let next = { ...state, accounts: [...state.accounts, { id, name: name.trim(), kind }] };
  if (opening) next = addTransaction(next, { date, account: id, payee: '시작 잔액', amount: opening, category: opening > 0 ? 'income' : null });
  return next;
}

export function sampleState(now = new Date()) {
  let s = emptyState();
  const t = today(now); const m = t.slice(0, 7); const pm = addMonths(m, -1);
  s = addAccount(s, { name: '생활비 통장', opening: 1200000, date: `${pm}-01` });
  s = addAccount(s, { name: '신용카드', kind: 'card', opening: 0 });
  const [bank, card] = s.accounts.map(a => a.id);
  s.rules = [
    { id: 'r1', op: 'contains', value: '스타벅스', category: 'c10' },
    { id: 'r2', op: 'contains', value: '마트', category: 'c5' },
    { id: 'r3', op: 'startsWith', value: '지하철', category: 'c7' },
    { id: 'r4', op: 'is', value: 'SKT', category: 'c2', rename: 'SK텔레콤' },
  ];
  s.schedules = [
    { id: 's1', name: '월세', payee: '집주인', amount: -550000, account: bank, category: 'c1', start: `${pm}-25`, frequency: 'monthly', interval: 1, endMode: 'never', weekend: 'before', autoPost: true },
    { id: 's2', name: '월급', payee: '회사', amount: 2800000, account: bank, category: 'income', start: `${pm}-10`, frequency: 'monthly', interval: 1, endMode: 'never', weekend: 'before', autoPost: true },
  ];
  const add = (d, acc, payee, amount) => { s = addTransaction(s, { date: d, account: acc, payee, amount }); };
  add(`${pm}-03`, card, '이마트 마트', -86000);
  add(`${pm}-05`, card, '스타벅스 강남점', -6500);
  add(`${pm}-12`, card, '지하철 교통카드', -55000);
  add(`${pm}-18`, card, '동네 식당', -32000);
  add(`${pm}-20`, card, 'SKT', -49000);
  add(`${m}-02`, card, '홈플러스 마트', -64000);
  add(`${m}-03`, card, '스타벅스 역삼점', -5800);
  s.budgets[pm] = { hold: 0, assigned: { c1: 550000, c2: 50000, c5: 300000, c6: 200000, c7: 60000, c10: 50000, c13: 100000 } };
  s.budgets[m] = { hold: 0, assigned: { c1: 550000, c2: 50000, c5: 300000, c6: 200000, c7: 60000, c10: 30000 } };
  return s;
}
