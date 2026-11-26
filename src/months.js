// 날짜는 'YYYY-MM-DD', 달은 'YYYY-MM' 글자로 다룬다(시간대 영향 없음).

const pad = n => String(n).padStart(2, '0');

export function monthOf(date) { return String(date).slice(0, 7); }

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date, n) {
  const dt = toDate(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

export function weekday(date) { return toDate(date).getUTCDay(); } // 0=일

export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}

export function isValidDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return fromDate(toDate(d)) === d;
}
