// 월 보고: 분류별 지출(많은 순, 비율), 수입·지출·남김, 최근 여러 달 흐름.
import { INCOME } from './budget.js';
import { addMonths, monthOf } from './months.js';

export function monthReport(state, month) {
  const byCat = new Map(); let income = 0; let spent = 0; let uncategorized = 0;
  for (const t of state.transactions) {
    if (t.transferId || monthOf(t.date) !== month) continue;
    if (t.category === INCOME) { income += t.amount; continue; }
    if (!t.category) { uncategorized += t.amount; continue; }
    byCat.set(t.category, (byCat.get(t.category) || 0) + t.amount);
  }
  const names = Object.fromEntries(state.categories.map(c => [c.id, c]));
  const rows = [];
  for (const [id, amt] of byCat) {
    spent += amt;
    rows.push({ id, name: names[id]?.name || '지운 분류', group: names[id]?.group || '', spent: -amt });
  }
  if (uncategorized) { spent += uncategorized; rows.push({ id: null, name: '미분류', group: '', spent: -uncategorized }); }
  const total = rows.reduce((s, r) => s + Math.max(0, r.spent), 0);
  rows.sort((a, b) => b.spent - a.spent);
  for (const r of rows) r.share = total > 0 && r.spent > 0 ? r.spent / total : 0;
  const groups = new Map();
  for (const r of rows) groups.set(r.group || '기타', (groups.get(r.group || '기타') || 0) + r.spent);
  return { month, income, spent: -spent, net: income + spent, rows, groups: [...groups].map(([name, v]) => ({ name, spent: v })).sort((a, b) => b.spent - a.spent) };
}

export function trend(state, month, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    const r = monthReport(state, m);
    out.push({ month: m, income: r.income, spent: r.spent });
  }
  return out;
}
