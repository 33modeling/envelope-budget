// CSV 읽기·쓰기. 은행·카드사 파일(UTF-8, UTF-8 BOM, UTF-16, EUC-KR)을 읽고 열을 골라 거래로 바꾼다.
import { isValidDate } from './months.js';
import { parseWon } from './money.js';
import { normalizeName } from './rules.js';

export function decodeBytes(bytes, encoding = 'auto') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (encoding !== 'auto') return new TextDecoder(encoding).decode(u8);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    try { return new TextDecoder('euc-kr').decode(u8); } catch { return new TextDecoder('utf-8').decode(u8); }
  }
}

export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ','; let bestN = -1;
  for (const d of [',', ';', '\t', '|']) {
    const n = head.split(d).length;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

export function parseCSV(text, delimiter) {
  text = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (ch === d) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

// 2026-11-26, 2026.11.26, 2026/11/26, 20261126, 26.11.26, 2026년 11월 26일, 날짜 뒤 시각은 버림
export function parseDate(s) {
  s = String(s ?? '').trim();
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) { const k = s.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/); if (k) m = k; }
  if (!m) { const k = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/); if (k) m = [k[0], '20' + k[1], k[2], k[3]]; }
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isValidDate(d) ? d : null;
}

const GUESS = {
  date: /날짜|일자|거래일|이용일|승인일|date/i,
  payee: /가게|가맹점|이용처|적요|내용|거래처|받는|보낸|payee|merchant|description/i,
  amount: /^금액$|이용금액|승인금액|거래금액|amount/i,
  outflow: /출금|지출|찾으신|withdraw|outflow|debit/i,
  inflow: /입금|수입|맡기신|deposit|inflow|credit/i,
  memo: /메모|비고|memo|note/i,
  category: /분류|카테고리|category/i,
};

export function guessColumns(header) {
  const map = {};
  for (const [k, re] of Object.entries(GUESS)) {
    const i = header.findIndex((h, idx) => re.test(h) && !Object.values(map).includes(idx));
    if (i >= 0) map[k] = i;
  }
  if (map.amount != null) { delete map.outflow; delete map.inflow; }
  return map;
}

// rows(머리줄 뺀 것)와 열 지정 → 거래 후보. 금액 열 하나면 음수=지출(flip 이면 반대), 출금·입금 열이면 출금을 음수로.
export function rowsToTransactions(rows, map, { flip = false, categoryByName = {} } = {}) {
  const out = []; const errors = [];
  rows.forEach((r, i) => {
    const date = parseDate(r[map.date]);
    let amount = null;
    if (map.amount != null) {
      amount = parseWon(r[map.amount]);
      if (amount != null && flip) amount = -amount;
    } else {
      const o = parseWon(r[map.outflow]) || 0; const n = parseWon(r[map.inflow]) || 0;
      amount = (r[map.outflow] || r[map.inflow]) ? n - Math.abs(o) : null;
    }
    if (!date || amount == null) { errors.push(i + 1); return; }
    const catName = map.category != null ? normalizeName(r[map.category]) : '';
    out.push({
      date, amount, payee: (r[map.payee] ?? '').trim(), memo: map.memo != null ? (r[map.memo] ?? '').trim() : '',
      category: catName ? categoryByName[catName] || null : null,
    });
  });
  return { transactions: out, errors };
}

export function isDuplicate(existing, tx) {
  const key = normalizeName(tx.payee);
  return existing.some(e => e.account === tx.account && e.date === tx.date && e.amount === tx.amount && normalizeName(e.payee) === key);
}

// 내보내기: 엑셀이 수식으로 읽을 글자(= + - @ 탭)로 시작하는 글은 앞에 ' 를 붙인다.
const FORMULA = /^[=+\-@\t\r]/;
function cell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (FORMULA.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(state) {
  const acc = Object.fromEntries(state.accounts.map(a => [a.id, a.name]));
  const cat = Object.fromEntries(state.categories.map(c => [c.id, `${c.group}: ${c.name}`]));
  cat.income = '수입';
  const lines = [['날짜', '계좌', '가게', '분류', '금액', '메모'].join(',')];
  const txs = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of txs) {
    const c = t.transferId ? `옮기기: ${acc[t.transferAccount] || ''}` : (cat[t.category] || '');
    lines.push([t.date, acc[t.account] || '', t.payee || '', c, t.amount, t.memo || ''].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
