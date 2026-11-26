import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseDate, guessColumns, rowsToTransactions, toCSV, decodeBytes, isDuplicate, detectDelimiter } from '../src/csv.js';
import { parseWon, formatWon } from '../src/money.js';

test('따옴표·쉼표·줄바꿈·BOM', () => {
  const rows = parseCSV('﻿날짜,가맹점,금액\r\n2026-11-01,"카페, 역삼",-4500\n2026.11.02,"말 ""따옴"" 표",12000\n\n');
  assert.deepEqual(rows, [['날짜', '가맹점', '금액'], ['2026-11-01', '카페, 역삼', '-4500'], ['2026.11.02', '말 "따옴" 표', '12000']]);
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
});

test('날짜·금액 읽기', () => {
  assert.equal(parseDate('2026.11.02 13:22'), '2026-11-02');
  assert.equal(parseDate('20261102'), '2026-11-02');
  assert.equal(parseDate('26/1/5'), '2026-01-05');
  assert.equal(parseDate('2026년 3월 4일'), '2026-03-04');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseWon('1,234원'), 1234);
  assert.equal(parseWon('(3,500)'), -3500);
  assert.equal(parseWon('1.5만'), 15000);
  assert.equal(parseWon('3만2천'), 32000);
  assert.equal(parseWon('abc'), null);
  assert.equal(formatWon(-12000), '−12,000원');
});

test('은행식 출금·입금 열과 카드식 양수 지출', () => {
  const head = ['거래일자', '적요', '출금액', '입금액', '메모'];
  const map = guessColumns(head);
  assert.deepEqual(map, { date: 0, payee: 1, outflow: 2, inflow: 3, memo: 4 });
  const { transactions, errors } = rowsToTransactions([['2026-11-01', '편의점', '3,000', '', ''], ['2026-11-02', '급여', '', '2,500,000', '11월'], ['합계', '', '', '', '']], map);
  assert.deepEqual(transactions.map(t => t.amount), [-3000, 2500000]);
  assert.deepEqual(errors, [3]);
  const card = rowsToTransactions([['2026-11-03', '식당', '15,000']], { date: 0, payee: 1, amount: 2 }, { flip: true });
  assert.equal(card.transactions[0].amount, -15000);
});

test('EUC-KR 자동 판별', () => {
  const euc = new Uint8Array([0xb3, 0xaf, 0xc2, 0xa5]); // "날짜"
  assert.equal(decodeBytes(euc), '날짜');
  assert.equal(decodeBytes(new TextEncoder().encode('날짜')), '날짜');
});

test('내보내기는 수식 글자를 막고 다시 읽을 수 있다', () => {
  const state = { accounts: [{ id: 'a', name: '통장' }], categories: [{ id: 'c', group: '생활', name: '식비' }],
    transactions: [{ id: '1', date: '2026-11-01', account: 'a', payee: '=HYPERLINK("x")', amount: -5000, category: 'c', memo: '점심, 둘이' }] };
  const csv = toCSV(state);
  assert.ok(csv.startsWith('﻿날짜,계좌,가게,분류,금액,메모'));
  const rows = parseCSV(csv);
  assert.deepEqual(rows[1], ['2026-11-01', '통장', '\'=HYPERLINK("x")', '생활: 식비', '-5000', '점심, 둘이']);
  assert.equal(isDuplicate(state.transactions, { account: 'a', date: '2026-11-01', amount: -5000, payee: '=hyperlink("x")' }), true);
});
