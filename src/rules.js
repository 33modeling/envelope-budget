// 자동 분류 규칙: 가게 이름 조건 → 분류(와 이름 바꾸기).
// 순서: 더 구체적인 조건일수록 점수가 높고, 점수가 낮은 규칙부터 적용해 나중(더 구체적인) 규칙이 이긴다.
// 같은 점수는 만든 순서(id)로 정해 늘 같은 결과가 나온다.

export const OPS = {
  is: { label: '와 같음', score: 10 },
  startsWith: { label: '로 시작', score: 5 },
  contains: { label: '을 포함', score: 0 },
};

export function normalizeName(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function ruleScore(rule) {
  const base = OPS[rule.op]?.score ?? 0;
  const amt = rule.amountMin != null || rule.amountMax != null ? 1 : 0;
  // 모든 조건이 '같음'이면 두 배(정확히 일치하는 규칙을 맨 뒤에)
  return (rule.op === 'is' ? base * 2 : base) + amt;
}

export function rankRules(rules) {
  return [...rules].sort((a, b) => ruleScore(a) - ruleScore(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function ruleMatches(rule, tx) {
  if (rule.enabled === false) return false;
  const name = normalizeName(tx.payee); const v = normalizeName(rule.value);
  if (!v) return false;
  let ok = false;
  if (rule.op === 'is') ok = name === v;
  else if (rule.op === 'startsWith') ok = name.startsWith(v);
  else ok = name.includes(v);
  if (!ok) return false;
  const spend = -tx.amount; // 지출 금액(양수)
  if (rule.amountMin != null && spend < rule.amountMin) return false;
  if (rule.amountMax != null && spend > rule.amountMax) return false;
  return true;
}

// 거래에 규칙을 적용해 새 거래를 돌려준다. 이미 분류가 있는 거래는 onlyEmpty 일 때 건드리지 않는다.
export function applyRules(rules, tx, { onlyEmpty = true } = {}) {
  if (tx.transferId) return { tx, applied: [] };
  let out = { ...tx }; const applied = [];
  for (const r of rankRules(rules)) {
    if (!ruleMatches(r, out)) continue;
    if (r.category && !(onlyEmpty && tx.category)) out.category = r.category;
    if (r.rename) out.payee = r.rename;
    applied.push(r.id);
  }
  return { tx: out, applied };
}

// 같은 가게의 최근 거래 5개 가운데 3개 이상이 같은 분류면 그 분류를 돌려준다.
export function probableCategory(transactions, payee) {
  const key = normalizeName(payee);
  if (!key) return null;
  const recent = transactions
    .filter(t => !t.transferId && normalizeName(t.payee) === key)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5);
  const count = new Map();
  for (const t of recent) if (t.category) count.set(t.category, (count.get(t.category) || 0) + 1);
  let best = null;
  for (const [c, n] of count) if (!best || n > best.n) best = { c, n };
  return best && best.n >= 3 ? best.c : null;
}

// 분류를 손으로 고친 뒤 부른다: 배울 만하면 '같음' 규칙을 만들거나 고친다. 새 rules 배열을 돌려준다.
export function learnRule(rules, transactions, payee, makeId) {
  const cat = probableCategory(transactions, payee);
  if (!cat) return { rules, changed: null };
  const key = normalizeName(payee);
  const existing = rules.filter(r => r.op === 'is' && normalizeName(r.value) === key && r.category && !r.rename && r.amountMin == null && r.amountMax == null);
  if (existing.length) {
    if (existing.every(r => r.category === cat)) return { rules, changed: null };
    const ids = new Set(existing.map(r => r.id));
    return { rules: rules.map(r => (ids.has(r.id) ? { ...r, category: cat } : r)), changed: 'updated' };
  }
  const rule = { id: makeId(), op: 'is', value: String(payee).trim(), category: cat, learned: true };
  return { rules: [...rules, rule], changed: 'created' };
}
