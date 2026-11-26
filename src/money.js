// 원화 금액: 내부는 정수 원(지출은 음수, 수입은 양수).

const fmt = new Intl.NumberFormat('ko-KR');

export function formatWon(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = fmt.format(Math.abs(v)) + '원';
  if (v < 0) return '−' + s;
  if (sign && v > 0) return '+' + s;
  return s;
}

// "12,000" "12000원" "-3,500" "(3,500)" "1.5만" "3만 2천" 같은 입력을 정수 원으로.
// 읽을 수 없으면 null.
export function parseWon(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  let s = String(input ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₩원\s]/g, '').replace(/,/g, '');
  if (/^[−-]/.test(s)) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Math.round(Number(s));
    return neg ? -v : v;
  }
  // 한글 단위: 억·만·천
  const m = s.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)천)?(\d+)?$/);
  if (!m || !m.slice(1).some(Boolean)) return null;
  const v = Math.round((Number(m[1] || 0) * 1e8) + (Number(m[2] || 0) * 1e4) + (Number(m[3] || 0) * 1e3) + Number(m[4] || 0));
  return neg ? -v : v;
}
