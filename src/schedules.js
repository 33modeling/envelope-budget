// 반복 거래: 시작일·주기(매일·매주·매월·매년, n마다)·끝(없음·횟수·날짜)·주말이면 앞/뒤로 옮기기.
// 매월 31일처럼 그 달에 없는 날은 그 달 마지막 날로 잡는다.
import { addDays, addMonths, daysInMonth, weekday } from './months.js';

export const FREQ = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };

function nth(s, i) {
  const n = Math.max(1, s.interval || 1);
  if (s.frequency === 'daily') return addDays(s.start, i * n);
  if (s.frequency === 'weekly') return addDays(s.start, i * n * 7);
  const months = s.frequency === 'yearly' ? i * n * 12 : i * n;
  const m = addMonths(s.start.slice(0, 7), months);
  const day = Math.min(Number(s.start.slice(8, 10)), daysInMonth(m));
  return `${m}-${String(day).padStart(2, '0')}`;
}

export function skipWeekend(date, mode) {
  if (!mode) return date;
  const w = weekday(date);
  if (w !== 0 && w !== 6) return date;
  if (mode === 'after') return addDays(date, w === 6 ? 2 : 1);
  return addDays(date, w === 6 ? -1 : -2);
}

// from~to(포함) 사이 날짜들. 각 항목: { due(원래 날짜), date(주말 옮긴 날짜) }
export function occurrences(s, from, to, limit = 500) {
  const out = [];
  if (!s.start) return out;
  for (let i = 0; i < 5000 && out.length < limit; i++) {
    if (s.endMode === 'count' && i >= (s.endCount || 0)) break;
    const due = nth(s, i);
    if (s.endMode === 'date' && s.endDate && due > s.endDate) break;
    const date = skipWeekend(due, s.weekend);
    if (date > to && due > to) break;
    // 주말 때문에 시작일·구간 앞으로 당겨진 날짜도 그 회차로 친다
    if ((date >= from || due >= from) && date <= to) out.push({ due, date });
  }
  return out;
}

export function nextOccurrence(s, after) {
  return occurrences(s, after, '9999-12-31', 1)[0] || null;
}

export function occurrenceId(s, due) { return `sch:${s.id}:${due}`; }

// 상태: 끝남·놓침(지난 날짜인데 안 넣음)·오늘·곧(7일 안)·예정. next 는 아직 안 넣은 첫 번째 날짜.
export function scheduleStatus(s, transactions, today, upcomingDays = 7) {
  const posted = new Set(transactions.filter(t => t.scheduleId === s.id).map(t => t.occurrence));
  const horizon = addDays(today, 3660);
  const next = occurrences(s, s.start, horizon, 5000).find(o => !posted.has(o.due)) || null;
  if (!next) return { status: 'completed', next: null };
  if (next.date < today) return { status: 'missed', next };
  if (next.date === today) return { status: 'due', next };
  if (next.date <= addDays(today, upcomingDays)) return { status: 'upcoming', next };
  return { status: 'scheduled', next };
}

// 오늘까지 도래했는데 아직 안 넣은 거래를 만든다(자동 넣기 켠 것만, 또는 all).
export function dueTransactions(schedules, transactions, today, { all = false, makeId }) {
  const posted = new Set(transactions.filter(t => t.scheduleId).map(t => `${t.scheduleId}|${t.occurrence}`));
  const out = [];
  for (const s of schedules) {
    if (!all && !s.autoPost) continue;
    for (const o of occurrences(s, s.start, today, 2000)) {
      if (posted.has(`${s.id}|${o.due}`)) continue;
      out.push({
        id: makeId(), date: o.date, account: s.account, payee: s.payee, amount: s.amount,
        category: s.category || null, memo: s.name || '', scheduleId: s.id, occurrence: o.due,
      });
    }
  }
  return out;
}

export function describeSchedule(s) {
  const n = Math.max(1, s.interval || 1);
  const day = Number(s.start?.slice(8, 10));
  let t;
  if (s.frequency === 'monthly') t = (n > 1 ? `${n}달마다 ` : '매월 ') + `${day}일`;
  else if (s.frequency === 'weekly') t = (n > 1 ? `${n}주마다 ` : '매주 ') + '일월화수목금토'[weekday(s.start)] + '요일';
  else if (s.frequency === 'yearly') t = (n > 1 ? `${n}년마다 ` : '매년 ') + `${Number(s.start.slice(5, 7))}월 ${day}일`;
  else t = n > 1 ? `${n}일마다` : '매일';
  if (s.weekend === 'before') t += '(주말이면 금요일)';
  if (s.weekend === 'after') t += '(주말이면 월요일)';
  if (s.endMode === 'count') t += `, ${s.endCount}번`;
  if (s.endMode === 'date' && s.endDate) t += `, ${s.endDate}까지`;
  return t;
}
