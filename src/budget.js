// 봉투식 예산 계산. 달마다 봉투(분류)별로
//   남은 돈 = 이번 달 배정 + 이번 달 쓴 돈(음수) + 지난달에서 넘어온 돈
// 지난달 남은 돈이 양수면 그대로 넘어온다. 음수(초과)면 봉투의 '초과 이월'이 켜져 있을 때만
// 빚으로 넘어오고, 꺼져 있으면 봉투는 0에서 다시 시작하고 그 초과액을 이번 달 '배정할 돈'에서 뺀다.
// 배정할 돈 = 이번 달 수입 + 지난달 배정할 돈 + 지난달 미뤄 둔 돈 + 지난달 초과(이월 안 한 것) − 이번 달 배정 합계 − 이번 달 미뤄 둔 돈
import { addMonths, monthOf, monthRange } from './months.js';

export const INCOME = 'income'; // 거래 분류가 이것이면 '배정할 돈'으로 들어가는 수입

export function firstMonth(state, fallback) {
  let m = null;
  for (const t of state.transactions) {
    const mm = monthOf(t.date);
    if (!m || mm < m) m = mm;
  }
  for (const mm of Object.keys(state.budgets || {})) if (!m || mm < m) m = mm;
  return m || fallback;
}

// 달·분류별 쓴 돈(지출은 음수), 달별 수입, 미분류 지출
export function monthlyActivity(transactions) {
  const spent = {}; const income = {}; const uncategorized = {};
  for (const t of transactions) {
    if (t.transferId) continue; // 계좌 사이 옮기기는 예산과 무관
    const m = monthOf(t.date);
    if (t.category === INCOME) income[m] = (income[m] || 0) + t.amount;
    else if (t.category) {
      spent[m] ??= {};
      spent[m][t.category] = (spent[m][t.category] || 0) + t.amount;
    } else uncategorized[m] = (uncategorized[m] || 0) + t.amount;
  }
  return { spent, income, uncategorized };
}

// month 까지 계산해 그 달의 표를 돌려준다.
export function computeMonth(state, month) {
  const cats = state.categories;
  const start = firstMonth(state, month);
  const act = monthlyActivity(state.transactions);
  const months = start <= month ? monthRange(start, month) : [month];
  let prev = { leftover: {}, toBudget: 0, held: 0, overspentNotCarried: 0 };
  let result = null;
  for (const m of months) {
    const b = (state.budgets || {})[m] || {};
    const assigned = b.assigned || {};
    const held = Math.max(0, b.hold || 0);
    const rows = {};
    let totalAssigned = 0; let totalSpent = 0; let totalLeft = 0; let overspentNotCarried = 0;
    for (const c of cats) {
      const a = assigned[c.id] || 0;
      const s = (act.spent[m] || {})[c.id] || 0;
      const p = prev.leftover[c.id] || 0;
      const carriedIn = p >= 0 ? p : (c.carryOverspend ? p : 0);
      const left = a + s + carriedIn;
      rows[c.id] = { assigned: a, spent: s, carriedIn, available: left, overspent: left < 0 };
      totalAssigned += a; totalSpent += s; totalLeft += left;
      if (left < 0 && !c.carryOverspend) overspentNotCarried += left;
    }
    const income = act.income[m] || 0;
    const fromLast = prev.toBudget + prev.held;
    const toBudget = income + fromLast + prev.overspentNotCarried - totalAssigned - held;
    result = {
      month: m, rows, income, fromLastMonth: fromLast, lastMonthOverspent: prev.overspentNotCarried,
      totalAssigned, totalSpent, totalAvailable: totalLeft, held, toBudget,
      uncategorized: act.uncategorized[m] || 0,
    };
    prev = { leftover: Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.available])), toBudget, held, overspentNotCarried };
  }
  return result;
}

// ---- 배정 바꾸기(모두 새 state 를 돌려줌) ----
function withAssigned(state, month, fn) {
  const budgets = { ...(state.budgets || {}) };
  const b = { hold: 0, ...(budgets[month] || {}) };
  b.assigned = { ...(b.assigned || {}) };
  fn(b);
  for (const [k, v] of Object.entries(b.assigned)) if (!v) delete b.assigned[k];
  budgets[month] = b;
  return { ...state, budgets };
}

export function setAssigned(state, month, catId, amount) {
  return withAssigned(state, month, b => { b.assigned[catId] = Math.round(amount) || 0; });
}

// 봉투 사이 옮기기: from 이 'toBudget' 이면 배정할 돈에서, to 가 'toBudget' 이면 되돌리기
export function moveMoney(state, month, from, to, amount) {
  amount = Math.round(amount);
  if (!(amount > 0) || from === to) return state;
  return withAssigned(state, month, b => {
    if (from !== 'toBudget') b.assigned[from] = (b.assigned[from] || 0) - amount;
    if (to !== 'toBudget') b.assigned[to] = (b.assigned[to] || 0) + amount;
  });
}

// 초과한 봉투 메우기: 메울 수 있는 만큼(내주는 쪽의 남은 돈 한도)만 옮긴다.
export function coverOverspending(state, month, catId, from) {
  const t = computeMonth(state, month);
  const need = -(t.rows[catId]?.available || 0);
  if (need <= 0) return state;
  const have = from === 'toBudget' ? t.toBudget : (t.rows[from]?.available || 0);
  if (have <= 0) return state;
  return moveMoney(state, month, from, catId, Math.min(need, have));
}

// 배정할 돈 일부를 다음 달로 미루기(이번 달 배정할 돈이 양수일 때만, 그 한도 안에서)
export function holdForNextMonth(state, month, amount) {
  const t = computeMonth(state, month);
  const avail = t.toBudget + t.held;
  if (avail <= 0) return state;
  const v = Math.max(0, Math.min(Math.round(amount), avail));
  const budgets = { ...(state.budgets || {}) };
  budgets[month] = { assigned: {}, ...(budgets[month] || {}), hold: v };
  return { ...state, budgets };
}

export function copyPreviousMonth(state, month) {
  const prev = ((state.budgets || {})[addMonths(month, -1)] || {}).assigned || {};
  return withAssigned(state, month, b => { b.assigned = { ...prev }; });
}

// 지난 n 달 평균 지출만큼 배정
export function assignAverage(state, month, n = 3) {
  const act = monthlyActivity(state.transactions);
  return withAssigned(state, month, b => {
    for (const c of state.categories) {
      let sum = 0;
      for (let i = 1; i <= n; i++) sum += ((act.spent[addMonths(month, -i)] || {})[c.id] || 0);
      const avg = Math.round(-sum / n);
      b.assigned[c.id] = avg > 0 ? avg : 0;
    }
  });
}

export function clearMonth(state, month) {
  return withAssigned(state, month, b => { b.assigned = {}; });
}
