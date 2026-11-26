import './styles.css';
import { INCOME, assignAverage, clearMonth, computeMonth, copyPreviousMonth, coverOverspending, holdForNextMonth, moveMoney, setAssigned } from './budget.js';
import { formatWon, parseWon } from './money.js';
import { addDays, addMonths, isValidDate, monthLabel, today } from './months.js';
import { OPS, applyRules, rankRules, ruleMatches } from './rules.js';
import { FREQ, describeSchedule, dueTransactions, occurrences, scheduleStatus } from './schedules.js';
import { decodeBytes, guessColumns, isDuplicate, parseCSV, rowsToTransactions, toCSV } from './csv.js';
import { monthReport, trend } from './report.js';
import { accountBalance, addAccount, addTransaction, deleteTransaction, emptyState, load, makeId, sampleState, save, updateTransaction, validState } from './store.js';

let storage = null;
try { storage = window.localStorage; } catch { storage = null; }

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n, o) => formatWon(n, o);

let state = load(storage) || emptyState();
const ui = { tab: 'budget', month: today().slice(0, 7), reportMonth: today().slice(0, 7), account: 'all', search: '', csv: null };

function commit(next, msg) {
  state = next;
  if (!save(storage, state)) toast('이 기기에 저장하지 못했어요(사생활 보호 창일 수 있어요)');
  else if (msg) toast(msg);
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function postDueSchedules() {
  const txs = dueTransactions(state.schedules, state.transactions, today(), { makeId: () => makeId('t') });
  if (!txs.length) return;
  let s = state;
  for (const t of txs) s = addTransaction(s, t);
  state = s; save(storage, state);
  setTimeout(() => toast(`반복 거래 ${txs.length}건을 넣었어요`), 300);
}

const catName = id => (id === INCOME ? '수입' : state.categories.find(c => c.id === id)?.name || '');
const accName = id => state.accounts.find(a => a.id === id)?.name || '지운 계좌';
const groupsOf = () => {
  const m = new Map();
  for (const c of state.categories) { if (!m.has(c.group)) m.set(c.group, []); m.get(c.group).push(c); }
  return [...m];
};
function categoryOptions(sel, { none = true, income = true } = {}) {
  let h = none ? `<option value="">분류 없음</option>` : '';
  if (income) h += `<option value="${INCOME}" ${sel === INCOME ? 'selected' : ''}>수입(배정할 돈)</option>`;
  for (const [g, cs] of groupsOf()) {
    h += `<optgroup label="${esc(g)}">` + cs.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>';
  }
  return h;
}
const accountOptions = sel => state.accounts.map(a => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const monthBar = (key, m) => `<div class="monthbar"><button class="icon" data-act="month" data-key="${key}" data-d="-1" aria-label="지난달">◀</button>
  <h2>${monthLabel(m)}</h2><button class="icon" data-act="month" data-key="${key}" data-d="1" aria-label="다음 달">▶</button></div>`;

// ---------- 예산 ----------
function budgetView() {
  const m = ui.month; const t = computeMonth(state, m);
  const tb = t.toBudget;
  let h = monthBar('month', m);
  h += `<section class="card summary ${tb < 0 ? 'neg' : tb === 0 ? 'zero' : 'pos'}">
    <div class="label">${tb < 0 ? '배정이 돈보다 많아요' : '배정할 돈'}</div><div class="big">${won(tb)}</div>
    <dl class="mini"><div><dt>이번 달 수입</dt><dd>${won(t.income)}</dd></div><div><dt>지난달에서</dt><dd>${won(t.fromLastMonth)}</dd></div>
    ${t.lastMonthOverspent ? `<div><dt>지난달 초과</dt><dd class="neg">${won(t.lastMonthOverspent)}</dd></div>` : ''}
    <div><dt>이번 달 배정</dt><dd>${won(-t.totalAssigned)}</dd></div>${t.held ? `<div><dt>다음 달로 미룸</dt><dd>${won(-t.held)}</dd></div>` : ''}</dl>
    <div class="row wrap"><button data-act="hold">${t.held ? '미룬 돈 바꾸기' : '다음 달로 미루기'}</button><button data-act="copyPrev">지난달 배정 복사</button>
    <button data-act="avg3">3개월 평균으로</button><button data-act="clearMonth" class="ghost">배정 비우기</button></div></section>`;
  if (t.uncategorized) h += `<button class="warn wide" data-act="goUncat">미분류 거래 ${won(t.uncategorized)} — 눌러서 분류 정하기</button>`;
  if (!state.accounts.length) h += `<section class="card empty"><p>먼저 계좌를 만들고 시작 잔액을 넣으면, 그 돈이 '배정할 돈'이 돼요.</p>
    <div class="row wrap"><button class="primary" data-act="newAccount">계좌 만들기</button><button data-act="sample">예시 데이터로 둘러보기</button></div></section>`;
  for (const [g, cs] of groupsOf()) {
    const sum = cs.reduce((a, c) => ({ as: a.as + t.rows[c.id].assigned, sp: a.sp + t.rows[c.id].spent, av: a.av + t.rows[c.id].available }), { as: 0, sp: 0, av: 0 });
    h += `<section class="card group"><div class="ghead"><h3>${esc(g)}</h3><span>배정 ${won(sum.as)} · 남음 ${won(sum.av)}</span></div>
      <div class="thead"><span>봉투 · 쓴 돈</span><span>배정</span><span>남은 돈 / 배정</span></div>`;
    for (const c of cs) {
      const r = t.rows[c.id];
      const cls = r.available < 0 ? 'neg' : r.available === 0 ? 'zero' : 'pos';
      h += `<div class="env"><div class="ename"><b>${esc(c.name)}</b><small>쓴 돈 ${won(-r.spent)}${r.carriedIn ? ` · 이월 ${won(r.carriedIn, { sign: true })}` : ''}${c.carryOverspend ? ' · 초과 이월' : ''}</small></div>
        <input class="amt" inputmode="numeric" aria-label="${esc(c.name)} 배정" data-assign="${c.id}" value="${r.assigned ? r.assigned.toLocaleString('ko-KR') : ''}" placeholder="0">
        <button class="pill ${cls}" data-act="env" data-id="${c.id}">${r.available < 0 ? '초과 ' : ''}${won(r.available)}</button></div>`;
    }
    h += '</section>';
  }
  return h;
}

function envelopeSheet(id) {
  const m = ui.month; const t = computeMonth(state, m); const c = state.categories.find(x => x.id === id); const r = t.rows[id];
  const others = state.categories.filter(x => x.id !== id);
  const opts = (filter) => `<option value="toBudget">배정할 돈 (${won(t.toBudget)})</option>` + others.filter(filter).map(x => `<option value="${x.id}">${esc(x.name)} (${won(t.rows[x.id].available)})</option>`).join('');
  let h = `<h2>${esc(c.name)}</h2><p class="muted">${monthLabel(m)} · 남은 돈 <b class="${r.available < 0 ? 'neg' : ''}">${won(r.available)}</b></p>`;
  if (r.available < 0) h += `<form data-form="cover" class="stack"><label>초과 ${won(-r.available)} 메우기 — 어디서 가져올까요?<select name="from">${opts(x => t.rows[x.id].available > 0)}</select></label>
    <button class="primary">메우기</button></form>`;
  h += `<form data-form="move" class="stack"><label>얼마를<input name="amount" inputmode="numeric" required placeholder="예: 30,000"></label>
    <label>어디로 보낼까요?<select name="to">${opts(() => true)}</select></label><button>이 봉투에서 옮기기</button></form>
    <form data-form="pull" class="stack"><label>다른 봉투에서 가져오기<select name="from">${opts(x => t.rows[x.id].available > 0)}</select></label>
    <label>얼마를<input name="amount" inputmode="numeric" required placeholder="예: 30,000"></label><button>가져오기</button></form>
    <label class="check"><input type="checkbox" data-act="carry" ${c.carryOverspend ? 'checked' : ''}> 초과한 돈을 다음 달 이 봉투로 넘기기(끄면 다음 달 배정할 돈에서 빠짐)</label>`;
  openDialog(h, { env: id });
}

// ---------- 거래 ----------
function txView() {
  const accs = state.accounts;
  let h = `<div class="chips"><button class="chip ${ui.account === 'all' ? 'on' : ''}" data-act="acc" data-id="all">전체<small>${won(accs.reduce((s, a) => s + accountBalance(state, a.id), 0))}</small></button>`
    + accs.map(a => `<button class="chip ${ui.account === a.id ? 'on' : ''}" data-act="acc" data-id="${a.id}">${esc(a.name)}<small>${won(accountBalance(state, a.id))}</small></button>`).join('')
    + `<button class="chip ${ui.account === 'uncat' ? 'on' : ''}" data-act="acc" data-id="uncat">미분류</button></div>`;
  h += `<div class="row"><input type="search" id="search" placeholder="가게·메모 찾기" value="${esc(ui.search)}" aria-label="거래 찾기"><button class="primary" data-act="newTx" ${accs.length ? '' : 'disabled'}>+ 거래</button></div>`;
  if (!accs.length) h += `<p class="card empty">계좌가 없어요. <button data-act="newAccount">계좌 만들기</button></p>`;
  const q = ui.search.trim().toLowerCase();
  const list = state.transactions.filter(t => (ui.account === 'all' || (ui.account === 'uncat' ? !t.category && !t.transferId : t.account === ui.account))
    && (!q || `${t.payee} ${t.memo}`.toLowerCase().includes(q))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let last = '';
  h += '<section class="card list">';
  if (!list.length && accs.length) h += '<p class="muted pad">거래가 없어요.</p>';
  for (const t of list.slice(0, 400)) {
    if (t.date !== last) { last = t.date; h += `<div class="day">${t.date.slice(5).replace('-', '월 ')}일</div>`; }
    const sub = t.transferId ? `옮기기 → ${esc(accName(t.transferAccount))}` : t.category ? esc(catName(t.category)) : '<span class="tag">미분류</span>';
    h += `<button class="tx" data-act="editTx" data-id="${t.id}"><span><b>${esc(t.payee || '(이름 없음)')}</b><small>${sub}${ui.account === 'all' ? ' · ' + esc(accName(t.account)) : ''}${t.scheduleId ? ' · 반복' : ''}</small></span>
      <span class="${t.amount < 0 ? '' : 'pos'}">${won(t.amount, { sign: true })}</span></button>`;
  }
  if (list.length > 400) h += `<p class="muted pad">최근 400건만 보여요. 찾기로 좁혀 보세요.</p>`;
  return h + '</section>';
}

function txForm(tx) {
  const isNew = !tx; tx = tx || { date: today(), account: ui.account !== 'all' && ui.account !== 'uncat' ? ui.account : state.accounts[0]?.id, amount: 0 };
  const kind = tx.transferId ? 'transfer' : tx.amount > 0 ? 'in' : 'out';
  const h = `<h2>${isNew ? '거래 넣기' : '거래 고치기'}</h2><form data-form="tx" class="stack" data-id="${tx.id || ''}">
    <div class="seg" role="radiogroup">${[['out', '지출'], ['in', '수입'], ['transfer', '계좌 옮기기']].map(([v, l]) => `<label><input type="radio" name="kind" value="${v}" ${kind === v ? 'checked' : ''} ${!isNew && (v === 'transfer') !== (kind === 'transfer') ? 'disabled' : ''}><span>${l}</span></label>`).join('')}</div>
    <label>금액<input name="amount" inputmode="numeric" required value="${tx.amount ? Math.abs(tx.amount).toLocaleString('ko-KR') : ''}" placeholder="예: 12,000 또는 1.2만"></label>
    <label>가게·내용<input name="payee" value="${esc(tx.payee)}" autocomplete="off" list="payees" placeholder="예: 스타벅스 역삼점"></label><p class="hint" id="ruleHint"></p>
    <label class="for-cat">분류<select name="category">${categoryOptions(tx.category)}</select></label>
    <div class="two"><label>날짜<input type="date" name="date" required value="${tx.date}"></label><label>계좌<select name="account">${accountOptions(tx.account)}</select></label></div>
    <label class="for-transfer">받는 계좌<select name="transferAccount">${accountOptions(tx.transferAccount || state.accounts.find(a => a.id !== tx.account)?.id)}</select></label>
    <label>메모<input name="memo" value="${esc(tx.memo)}"></label>
    <div class="row"><button class="primary grow">저장</button>${isNew ? '' : '<button type="button" class="danger" data-act="delTx">지우기</button>'}</div></form>
    <datalist id="payees">${[...new Set(state.transactions.map(t => t.payee).filter(Boolean))].slice(-200).map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
  openDialog(h, { tx: tx.id });
  syncTxForm();
}

function syncTxForm() {
  const f = $('form[data-form="tx"]'); if (!f) return;
  const kind = f.kind.value;
  f.classList.toggle('is-transfer', kind === 'transfer');
  const hint = $('#ruleHint');
  const amt = parseWon(f.amount.value) || 0;
  const probe = { payee: f.payee.value, amount: kind === 'in' ? amt : -amt };
  const hit = rankRules(state.rules).filter(r => ruleMatches(r, probe)).pop();
  hint.textContent = kind !== 'transfer' && hit && !f.category.value ? `규칙: ${catName(hit.category) || '분류 그대로'}${hit.rename ? ` · 이름 → ${hit.rename}` : ''}` : '';
}

// ---------- 반복 ----------
const STATUS = { missed: ['놓침', 'neg'], due: ['오늘', 'warn'], upcoming: ['곧', 'warn'], scheduled: ['예정', ''], completed: ['끝남', 'zero'] };
function schedView() {
  const td = today();
  let h = `<div class="row"><p class="muted grow">월세·월급·구독처럼 되풀이되는 거래. '자동 넣기'를 켜면 날짜가 되면 앱을 열 때 들어가요.</p><button class="primary" data-act="newSched" ${state.accounts.length ? '' : 'disabled'}>+ 반복</button></div><section class="card list">`;
  if (!state.schedules.length) h += '<p class="muted pad">반복 거래가 없어요.</p>';
  const rows = state.schedules.map(s => ({ s, st: scheduleStatus(s, state.transactions, td, state.settings.upcomingDays) }))
    .sort((a, b) => ((a.st.next?.date || '9') < (b.st.next?.date || '9') ? -1 : 1));
  for (const { s, st } of rows) {
    const [label, cls] = STATUS[st.status];
    h += `<div class="sched"><button class="tx" data-act="editSched" data-id="${s.id}"><span><b>${esc(s.name || s.payee)}</b><small>${esc(describeSchedule(s))} · ${esc(accName(s.account))}${s.autoPost ? ' · 자동' : ''}</small>
      <small>${st.next ? `다음 ${st.next.date}` : ''} <span class="badge ${cls}">${label}</span></small></span><span class="${s.amount > 0 ? 'pos' : ''}">${won(s.amount, { sign: true })}</span></button>
      ${st.status === 'missed' || st.status === 'due' ? `<button class="small" data-act="postSched" data-id="${s.id}">지금 넣기</button>` : ''}</div>`;
  }
  h += '</section>';
  const soon = [];
  for (const s of state.schedules) for (const o of occurrences(s, td, addDays(td, 30))) soon.push({ s, o });
  soon.sort((a, b) => (a.o.date < b.o.date ? -1 : 1));
  if (soon.length) {
    h += `<section class="card"><h3>다가올 30일</h3><ul class="plain">${soon.slice(0, 30).map(({ s, o }) => `<li><span>${o.date.slice(5)} ${esc(s.name || s.payee)}</span><span>${won(s.amount, { sign: true })}</span></li>`).join('')}</ul>
      <p class="muted">합계 ${won(soon.reduce((a, x) => a + x.s.amount, 0), { sign: true })}</p></section>`;
  }
  return h;
}

function schedForm(s) {
  const isNew = !s; s = s || { start: today(), frequency: 'monthly', interval: 1, endMode: 'never', weekend: '', autoPost: true, amount: 0, account: state.accounts[0]?.id };
  openDialog(`<h2>${isNew ? '반복 거래 만들기' : '반복 거래 고치기'}</h2><form data-form="sched" class="stack" data-id="${s.id || ''}">
    <label>이름<input name="name" value="${esc(s.name)}" placeholder="예: 월세"></label>
    <div class="seg">${[['out', '지출'], ['in', '수입']].map(([v, l]) => `<label><input type="radio" name="kind" value="${v}" ${(s.amount > 0 ? 'in' : 'out') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="two"><label>금액<input name="amount" inputmode="numeric" required value="${s.amount ? Math.abs(s.amount).toLocaleString('ko-KR') : ''}"></label><label>가게·내용<input name="payee" value="${esc(s.payee)}"></label></div>
    <div class="two"><label>계좌<select name="account">${accountOptions(s.account)}</select></label><label>분류<select name="category">${categoryOptions(s.category)}</select></label></div>
    <div class="two"><label>시작일<input type="date" name="start" required value="${s.start}"></label><label>주기<select name="frequency">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${s.frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="two"><label>몇 번째마다<input name="interval" type="number" min="1" max="99" value="${s.interval || 1}"></label>
    <label>주말이면<select name="weekend"><option value="">그대로</option><option value="before" ${s.weekend === 'before' ? 'selected' : ''}>앞 금요일</option><option value="after" ${s.weekend === 'after' ? 'selected' : ''}>뒤 월요일</option></select></label></div>
    <div class="two"><label>끝<select name="endMode"><option value="never">계속</option><option value="count" ${s.endMode === 'count' ? 'selected' : ''}>횟수</option><option value="date" ${s.endMode === 'date' ? 'selected' : ''}>날짜</option></select></label>
    <label>횟수 또는 끝 날짜<input name="endValue" value="${esc(s.endMode === 'count' ? s.endCount : s.endMode === 'date' ? s.endDate : '')}" placeholder="12 또는 2027-12-31"></label></div>
    <label class="check"><input type="checkbox" name="autoPost" ${s.autoPost ? 'checked' : ''}> 날짜가 되면 자동으로 넣기</label>
    <div class="row"><button class="primary grow">저장</button>${isNew ? '' : '<button type="button" class="danger" data-act="delSched">지우기</button>'}</div></form>`, { sched: s.id });
}

// ---------- 규칙 ----------
function rulesView() {
  let h = `<div class="row"><p class="muted grow">가게 이름으로 분류를 자동으로 정해요. 분류를 같은 가게에 세 번 같은 것으로 고르면 규칙이 저절로 생겨요.</p><button class="primary" data-act="newRule">+ 규칙</button></div>
    <section class="card"><label>가게 이름 넣어 보기<input id="ruleTest" placeholder="예: 스타벅스 강남점"></label><p class="hint" id="ruleTestOut"></p></section>
    <section class="card list"><p class="muted pad">위에서부터 차례로 적용하고, 아래(더 구체적인) 규칙이 이겨요.</p>`;
  const ranked = rankRules(state.rules);
  if (!ranked.length) h += '<p class="muted pad">규칙이 없어요.</p>';
  for (const r of ranked) {
    h += `<button class="tx" data-act="editRule" data-id="${r.id}"><span><b>‘${esc(r.value)}’${OPS[r.op]?.label || ''}</b><small>→ ${esc(catName(r.category) || '분류 그대로')}${r.rename ? ` · 이름 ‘${esc(r.rename)}’` : ''}${r.amountMin != null || r.amountMax != null ? ` · ${r.amountMin != null ? won(r.amountMin) : ''}~${r.amountMax != null ? won(r.amountMax) : ''}` : ''}${r.learned ? ' · 배운 규칙' : ''}${r.enabled === false ? ' · 꺼짐' : ''}</small></span></button>`;
  }
  const n = state.transactions.filter(t => !t.category && !t.transferId).length;
  return h + `</section><button class="wide" data-act="applyRules" ${n ? '' : 'disabled'}>미분류 거래 ${n}건에 규칙 적용</button>`;
}

function ruleForm(r) {
  const isNew = !r; r = r || { op: 'contains', value: '', category: '' };
  openDialog(`<h2>${isNew ? '규칙 만들기' : '규칙 고치기'}</h2><form data-form="rule" class="stack" data-id="${r.id || ''}">
    <div class="two"><label>가게 이름이<input name="value" required value="${esc(r.value)}" placeholder="예: 스타벅스"></label>
    <label>조건<select name="op">${Object.entries(OPS).map(([k, v]) => `<option value="${k}" ${r.op === k ? 'selected' : ''}>${v.label.replace(/^[을와로]\s?/, '')}</option>`).join('')}</select></label></div>
    <label>분류를<select name="category">${categoryOptions(r.category, { none: true })}</select></label>
    <label>이름 바꾸기(선택)<input name="rename" value="${esc(r.rename)}" placeholder="예: 스타벅스"></label>
    <div class="two"><label>지출 최소(선택)<input name="amountMin" inputmode="numeric" value="${r.amountMin ?? ''}"></label><label>지출 최대(선택)<input name="amountMax" inputmode="numeric" value="${r.amountMax ?? ''}"></label></div>
    <label class="check"><input type="checkbox" name="enabled" ${r.enabled === false ? '' : 'checked'}> 켜기</label>
    <div class="row"><button class="primary grow">저장</button>${isNew ? '' : '<button type="button" class="danger" data-act="delRule">지우기</button>'}</div></form>`, { rule: r.id });
}

// ---------- 보고 ----------
function reportView() {
  const m = ui.reportMonth; const r = monthReport(state, m); const t = computeMonth(state, m);
  let h = monthBar('reportMonth', m);
  h += `<section class="stats"><div class="stat"><span>수입</span><b class="pos">${won(r.income)}</b></div><div class="stat"><span>지출</span><b>${won(r.spent)}</b></div>
    <div class="stat"><span>남김</span><b class="${r.net < 0 ? 'neg' : ''}">${won(r.net, { sign: true })}</b></div></section>`;
  h += `<section class="card"><h3>분류별 지출</h3>`;
  if (!r.rows.length) h += '<p class="muted">이 달 지출이 없어요.</p>';
  const max = Math.max(1, ...r.rows.map(x => x.spent));
  for (const x of r.rows) {
    const as = x.id ? t.rows[x.id]?.assigned || 0 : 0;
    h += `<div class="bar"><div class="bl"><span>${esc(x.name)}<small>${esc(x.group)}</small></span><span>${won(x.spent)} <small>${Math.round(x.share * 100)}%</small></span></div>
      <div class="track"><i style="width:${Math.max(0, x.spent) / max * 100}%" class="${as && x.spent > as ? 'over' : ''}"></i></div>${as ? `<small class="muted">배정 ${won(as)}${x.spent > as ? ` · ${won(x.spent - as)} 넘음` : ''}</small>` : ''}</div>`;
  }
  h += '</section>';
  if (r.groups.length > 1) h += `<section class="card"><h3>묶음별</h3><ul class="plain">${r.groups.map(g => `<li><span>${esc(g.name)}</span><span>${won(g.spent)}</span></li>`).join('')}</ul></section>`;
  const tr = trend(state, m, 6); const tmax = Math.max(1, ...tr.map(x => Math.max(x.income, x.spent)));
  h += `<section class="card"><h3>최근 6달</h3><div class="trend">${tr.map(x => `<div class="tcol"><div class="tbars"><i class="inc" style="height:${x.income / tmax * 100}%"></i><i class="exp" style="height:${Math.max(0, x.spent) / tmax * 100}%"></i></div><small>${Number(x.month.slice(5))}월</small></div>`).join('')}</div>
    <p class="legend"><span class="sw inc"></span>수입 <span class="sw exp"></span>지출</p></section>`;
  return h;
}

// ---------- 더보기 ----------
function moreView() {
  let h = `<section class="card"><div class="ghead"><h3>계좌</h3><button class="small" data-act="newAccount">+ 계좌</button></div><ul class="plain">`
    + state.accounts.map(a => `<li><button class="link" data-act="editAccount" data-id="${a.id}">${esc(a.name)}</button><span>${won(accountBalance(state, a.id))}</span></li>`).join('') + '</ul></section>';
  h += `<section class="card"><div class="ghead"><h3>분류(봉투)</h3><button class="small" data-act="newCat">+ 분류</button></div>`;
  for (const [g, cs] of groupsOf()) h += `<p class="gname">${esc(g)}</p><div class="chips wrap">${cs.map(c => `<button class="chip" data-act="editCat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>`;
  h += '</section>';
  h += `<section class="card"><h3>CSV 가져오기</h3><p class="muted">은행·카드사에서 받은 CSV. 글자 깨짐은 '글자 인코딩'에서 EUC-KR 을 골라 보세요.</p>
    <div class="two"><label>파일<input type="file" id="csvFile" accept=".csv,.txt,text/csv"></label><label>글자 인코딩<select id="csvEnc"><option value="auto">자동</option><option value="utf-8">UTF-8</option><option value="euc-kr">EUC-KR</option></select></label></div>
    <div id="csvMap"></div></section>`;
  h += `<section class="card"><h3>내보내기·백업</h3><div class="row wrap"><button data-act="exportCsv">거래 CSV 받기</button><button data-act="backup">전체 백업(JSON)</button>
    <label class="btn">백업 되살리기<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
    <div class="row wrap"><button data-act="sample">예시 데이터 넣기</button><button class="danger" data-act="wipe">모두 지우기</button></div>
    <p class="muted">모든 자료는 이 기기 브라우저에만 저장돼요. 서버로 보내지 않아요.</p></section>`;
  return h;
}

function csvMapView() {
  const c = ui.csv; if (!c) return '';
  const header = c.hasHeader ? c.rows[0] : c.rows[0].map((_, i) => `${i + 1}열`);
  const col = (k, label) => `<label>${label}<select data-csvcol="${k}"><option value="">없음</option>${header.map((h, i) => `<option value="${i}" ${c.map[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`;
  const body = c.rows.slice(c.hasHeader ? 1 : 0);
  return `<p class="muted">${esc(c.name)} · ${body.length}줄</p>
    <label class="check"><input type="checkbox" id="csvHeader" ${c.hasHeader ? 'checked' : ''}> 첫 줄이 열 이름</label>
    <div class="two">${col('date', '날짜')}${col('payee', '가게·내용')}</div>
    <div class="two">${col('amount', '금액(한 열)')}${col('category', '분류(선택)')}</div>
    <div class="two">${col('outflow', '출금 열')}${col('inflow', '입금 열')}</div>
    <div class="two">${col('memo', '메모(선택)')}<label>넣을 계좌<select id="csvAcc">${accountOptions(c.account)}</select></label></div>
    <label class="check"><input type="checkbox" id="csvFlip" ${c.flip ? 'checked' : ''}> 금액이 양수면 지출(카드 명세서처럼)</label>
    <div class="scroll"><table><tbody>${c.rows.slice(0, 4).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <button class="primary wide" data-act="csvImport" ${state.accounts.length ? '' : 'disabled'}>가져오기</button>${state.accounts.length ? '' : '<p class="hint">먼저 계좌를 만드세요.</p>'}`;
}

function simpleForm(kind, item) {
  if (kind === 'account') {
    openDialog(`<h2>${item ? '계좌 고치기' : '계좌 만들기'}</h2><form data-form="account" class="stack" data-id="${item?.id || ''}">
      <label>이름<input name="name" required value="${esc(item?.name)}" placeholder="예: 생활비 통장"></label>
      ${item ? '' : `<label>시작 잔액(지금 들어 있는 돈)<input name="opening" inputmode="numeric" placeholder="예: 1,000,000"></label><p class="hint">시작 잔액은 '수입'으로 들어가 배정할 돈이 돼요. 카드 빚이면 앞에 - 를 붙이세요.</p>`}
      <div class="row"><button class="primary grow">저장</button>${item ? '<button type="button" class="danger" data-act="delAccount">지우기</button>' : ''}</div></form>`, { account: item?.id });
  } else {
    openDialog(`<h2>${item ? '분류 고치기' : '분류 만들기'}</h2><form data-form="cat" class="stack" data-id="${item?.id || ''}">
      <label>이름<input name="name" required value="${esc(item?.name)}"></label>
      <label>묶음<input name="group" required list="groups" value="${esc(item?.group || groupsOf()[0]?.[0] || '생활')}"></label>
      <datalist id="groups">${groupsOf().map(([g]) => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="row"><button class="primary grow">저장</button>${item ? '<button type="button" class="danger" data-act="delCat">지우기</button>' : ''}</div></form>`, { cat: item?.id });
  }
}

// ---------- 틀 ----------
const TABS = [['budget', '예산', '◫'], ['tx', '거래', '≡'], ['sched', '반복', '↻'], ['rules', '규칙', '⚑'], ['report', '보고', '▤'], ['more', '더보기', '…']];
function render() {
  const view = { budget: budgetView, tx: txView, sched: schedView, rules: rulesView, report: reportView, more: moreView }[ui.tab];
  $('#main').innerHTML = view();
  $('#nav').innerHTML = TABS.map(([k, l, i]) => `<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}" aria-current="${ui.tab === k ? 'page' : 'false'}"><span aria-hidden="true">${i}</span>${l}</button>`).join('');
  if (ui.tab === 'more') $('#csvMap').innerHTML = csvMapView();
}

let dialogCtx = {};
function openDialog(html, ctx = {}) {
  dialogCtx = ctx;
  const d = $('#dialog');
  $('#dialogBody').innerHTML = html;
  if (!d.open) d.showModal();
}
function closeDialog() { $('#dialog').close(); dialogCtx = {}; }

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id; const m = ui.month;
  switch (b.dataset.act) {
    case 'month': ui[b.dataset.key] = addMonths(ui[b.dataset.key], Number(b.dataset.d)); render(); break;
    case 'env': envelopeSheet(id); break;
    case 'hold': {
      const t = computeMonth(state, m);
      openDialog(`<h2>다음 달로 미루기</h2><p class="muted">이번 달 수입 가운데 다음 달에 쓸 돈을 따로 떼어 둬요. 최대 ${won(t.toBudget + t.held)}.</p>
        <form data-form="hold" class="stack"><label>미룰 돈<input name="amount" inputmode="numeric" value="${t.held ? t.held.toLocaleString('ko-KR') : ''}" placeholder="0 이면 취소"></label>
        <button class="primary">저장</button></form>`);
      break;
    }
    case 'copyPrev': commit(copyPreviousMonth(state, m), '지난달 배정을 복사했어요'); break;
    case 'avg3': commit(assignAverage(state, m, 3), '지난 3달 평균 지출로 배정했어요'); break;
    case 'clearMonth': if (confirm(`${monthLabel(m)} 배정을 모두 비울까요?`)) commit(clearMonth(state, m)); break;
    case 'goUncat': ui.tab = 'tx'; ui.account = 'uncat'; render(); break;
    case 'newAccount': simpleForm('account'); break;
    case 'editAccount': simpleForm('account', state.accounts.find(a => a.id === id)); break;
    case 'newCat': simpleForm('cat'); break;
    case 'editCat': simpleForm('cat', state.categories.find(c => c.id === id)); break;
    case 'sample':
      if (!state.transactions.length || confirm('지금 자료를 지우고 예시 데이터를 넣을까요?')) { state = sampleState(); postDueSchedules(); commit(state, '예시 데이터를 넣었어요'); }
      break;
    case 'wipe': if (confirm('모든 자료를 지울까요? 되돌릴 수 없어요.')) commit(emptyState(), '모두 지웠어요'); break;
    case 'acc': ui.account = id; render(); break;
    case 'newTx': txForm(); break;
    case 'editTx': txForm(state.transactions.find(t => t.id === id)); break;
    case 'delTx': if (confirm('이 거래를 지울까요?')) { commit(deleteTransaction(state, dialogCtx.tx), '지웠어요'); closeDialog(); } break;
    case 'newSched': schedForm(); break;
    case 'editSched': schedForm(state.schedules.find(s => s.id === id)); break;
    case 'delSched': if (confirm('반복 거래를 지울까요? 이미 넣은 거래는 남아요.')) { commit({ ...state, schedules: state.schedules.filter(s => s.id !== dialogCtx.sched) }); closeDialog(); } break;
    case 'postSched': {
      const s = state.schedules.filter(x => x.id === id);
      const txs = dueTransactions(s, state.transactions, today(), { all: true, makeId: () => makeId('t') });
      let n = state; for (const t of txs) n = addTransaction(n, t);
      commit(n, `${txs.length}건 넣었어요`); break;
    }
    case 'newRule': ruleForm(); break;
    case 'editRule': ruleForm(state.rules.find(r => r.id === id)); break;
    case 'delRule': commit({ ...state, rules: state.rules.filter(r => r.id !== dialogCtx.rule) }); closeDialog(); break;
    case 'applyRules': {
      let n = 0;
      const transactions = state.transactions.map(t => {
        if (t.category || t.transferId) return t;
        const { tx } = applyRules(state.rules, t); if (tx.category) n++; return tx;
      });
      commit({ ...state, transactions }, `${n}건에 분류를 정했어요`); break;
    }
    case 'delAccount': {
      const used = state.transactions.some(t => t.account === dialogCtx.account || t.transferAccount === dialogCtx.account);
      if (used) { alert('거래가 있는 계좌는 지울 수 없어요. 거래를 먼저 지우세요.'); break; }
      commit({ ...state, accounts: state.accounts.filter(a => a.id !== dialogCtx.account) }); closeDialog(); break;
    }
    case 'delCat': {
      const cid = dialogCtx.cat;
      const used = state.transactions.some(t => t.category === cid) || state.schedules.some(s => s.category === cid);
      if (used && !confirm('이 분류를 쓴 거래가 있어요. 지우면 그 거래들은 미분류가 돼요. 지울까요?')) break;
      const budgets = Object.fromEntries(Object.entries(state.budgets).map(([k, v]) => { const a = { ...(v.assigned || {}) }; delete a[cid]; return [k, { ...v, assigned: a }]; }));
      commit({ ...state, categories: state.categories.filter(c => c.id !== cid), budgets,
        transactions: state.transactions.map(t => (t.category === cid ? { ...t, category: null } : t)),
        rules: state.rules.filter(r => r.category !== cid), schedules: state.schedules.map(s => (s.category === cid ? { ...s, category: null } : s)) });
      closeDialog(); break;
    }
    case 'exportCsv': download(`가계부-거래-${today()}.csv`, toCSV(state), 'text/csv;charset=utf-8'); break;
    case 'backup': download(`가계부-백업-${today()}.json`, JSON.stringify(state, null, 1), 'application/json'); break;
    case 'csvImport': importCsv(); break;
    case 'close': closeDialog(); break;
    default: break;
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.assign) {
    const v = parseWon(el.value); if (el.value.trim() && v == null) { toast('금액을 읽지 못했어요'); render(); return; }
    commit(setAssigned(state, ui.month, el.dataset.assign, v || 0));
  } else if (el.dataset.act === 'carry') {
    commit({ ...state, categories: state.categories.map(c => (c.id === dialogCtx.env ? { ...c, carryOverspend: el.checked } : c)) });
  } else if (el.id === 'csvFile' || el.id === 'csvEnc') {
    const f = $('#csvFile').files[0]; if (!f) return;
    try {
      const text = decodeBytes(new Uint8Array(await f.arrayBuffer()), $('#csvEnc').value);
      const rows = parseCSV(text);
      if (!rows.length) { toast('읽을 줄이 없어요'); return; }
      ui.csv = { name: f.name, rows, hasHeader: true, map: guessColumns(rows[0]), flip: false, account: ui.csv?.account || state.accounts[0]?.id };
    } catch { toast('파일을 읽지 못했어요'); ui.csv = null; }
    $('#csvMap').innerHTML = csvMapView();
  } else if (el.dataset.csvcol) {
    ui.csv.map[el.dataset.csvcol] = el.value === '' ? undefined : Number(el.value);
    if (el.dataset.csvcol === 'amount' && el.value !== '') { ui.csv.map.outflow = undefined; ui.csv.map.inflow = undefined; }
    if ((el.dataset.csvcol === 'outflow' || el.dataset.csvcol === 'inflow') && el.value !== '') ui.csv.map.amount = undefined;
    $('#csvMap').innerHTML = csvMapView();
  } else if (el.id === 'csvHeader') {
    ui.csv.hasHeader = el.checked; ui.csv.map = el.checked ? guessColumns(ui.csv.rows[0]) : {}; $('#csvMap').innerHTML = csvMapView();
  } else if (el.id === 'csvFlip') ui.csv.flip = el.checked;
  else if (el.id === 'csvAcc') ui.csv.account = el.value;
  else if (el.id === 'restore') {
    try {
      const s = JSON.parse(await el.files[0].text());
      if (!validState(s)) throw new Error('bad');
      if (confirm('지금 자료를 백업 파일로 바꿀까요?')) commit({ ...emptyState(), ...s }, '되살렸어요');
    } catch { toast('백업 파일이 아니에요'); }
  }
  if (el.form?.dataset.form === 'tx') syncTxForm();
});

document.addEventListener('input', e => {
  if (e.target.id === 'search') { ui.search = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); }
  if (e.target.id === 'ruleTest') {
    const probe = { payee: e.target.value, amount: -1 };
    const hits = rankRules(state.rules).filter(r => ruleMatches(r, probe));
    const out = applyRules(state.rules, { ...probe, category: null }).tx;
    $('#ruleTestOut').textContent = e.target.value ? (hits.length ? `맞는 규칙 ${hits.length}개 → ${catName(out.category) || '분류 없음'}${out.payee !== probe.payee ? ` · 이름 ‘${out.payee}’` : ''}` : '맞는 규칙이 없어요') : '';
  }
  if (e.target.form?.dataset.form === 'tx') syncTxForm();
});

function importCsv() {
  const c = ui.csv;
  if (c.map.date == null || (c.map.amount == null && c.map.outflow == null && c.map.inflow == null)) { toast('날짜와 금액 열을 골라 주세요'); return; }
  const byName = {};
  for (const x of state.categories) { byName[x.name.toLowerCase()] = x.id; byName[`${x.group}: ${x.name}`.toLowerCase()] = x.id; }
  byName['수입'] = INCOME;
  const { transactions, errors } = rowsToTransactions(c.rows.slice(c.hasHeader ? 1 : 0), c.map, { flip: c.flip, categoryByName: byName });
  let s = state; let added = 0; let dup = 0;
  for (const t of transactions) {
    const tx = { ...t, account: c.account, imported: true };
    if (isDuplicate(s.transactions, tx)) { dup++; continue; }
    s = addTransaction(s, tx); added++;
  }
  ui.csv = null;
  commit(s, `${added}건 넣음${dup ? ` · 겹쳐서 ${dup}건 건너뜀` : ''}${errors.length ? ` · 못 읽은 줄 ${errors.length}개` : ''}`);
}

document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  const fid = f.dataset.id;
  const m = ui.month;
  switch (f.dataset.form) {
    case 'tx': {
      const amt = parseWon(v.amount);
      if (amt == null || amt === 0) { toast('금액을 넣어 주세요'); return; }
      if (!isValidDate(v.date)) { toast('날짜를 확인해 주세요'); return; }
      const amount = v.kind === 'in' ? Math.abs(amt) : -Math.abs(amt);
      if (fid) {
        const old = state.transactions.find(t => t.id === fid);
        const patch = { date: v.date, payee: v.payee.trim(), amount, memo: v.memo.trim() };
        if (!old.transferId) { patch.category = v.category || null; patch.account = v.account; }
        const next = updateTransaction(state, fid, patch);
        const learned = next.lastLearned; delete next.lastLearned;
        commit(next, learned === 'created' ? `‘${patch.payee}’ 규칙을 새로 배웠어요` : learned === 'updated' ? `‘${patch.payee}’ 규칙을 고쳤어요` : '고쳤어요');
      } else {
        if (v.kind === 'transfer' && v.transferAccount === v.account) { toast('받는 계좌가 같아요'); return; }
        commit(addTransaction(state, { date: v.date, account: v.account, payee: v.payee || (v.kind === 'transfer' ? '계좌 옮기기' : ''), amount,
          category: v.kind === 'transfer' ? null : v.category || null, memo: v.memo, transferAccount: v.kind === 'transfer' ? v.transferAccount : null }), '넣었어요');
      }
      closeDialog(); break;
    }
    case 'sched': {
      const amt = parseWon(v.amount);
      if (!amt) { toast('금액을 넣어 주세요'); return; }
      const s = { id: fid || makeId('s'), name: v.name.trim(), payee: v.payee.trim() || v.name.trim(), amount: v.kind === 'in' ? Math.abs(amt) : -Math.abs(amt),
        account: v.account, category: v.category || null, start: v.start, frequency: v.frequency, interval: Math.max(1, Number(v.interval) || 1),
        weekend: v.weekend || '', endMode: v.endMode, autoPost: !!v.autoPost };
      if (s.endMode === 'count') { s.endCount = Math.max(1, Number(v.endValue) || 1); }
      if (s.endMode === 'date') { if (!isValidDate(v.endValue)) { toast('끝 날짜를 2027-12-31 처럼 넣어 주세요'); return; } s.endDate = v.endValue; }
      const schedules = fid ? state.schedules.map(x => (x.id === fid ? s : x)) : [...state.schedules, s];
      state = { ...state, schedules }; postDueSchedules(); commit(state, '저장했어요'); closeDialog(); break;
    }
    case 'rule': {
      const num = x => (String(x).trim() ? Math.abs(parseWon(x) ?? 0) : null);
      const r = { id: fid || makeId('r'), op: v.op, value: v.value.trim(), category: v.category || null, rename: v.rename.trim() || undefined,
        amountMin: num(v.amountMin), amountMax: num(v.amountMax), enabled: !!v.enabled };
      if (!r.category && !r.rename) { toast('분류나 이름 바꾸기 가운데 하나는 정해 주세요'); return; }
      commit({ ...state, rules: fid ? state.rules.map(x => (x.id === fid ? r : x)) : [...state.rules, r] }, '저장했어요'); closeDialog(); break;
    }
    case 'account': {
      if (fid) commit({ ...state, accounts: state.accounts.map(a => (a.id === fid ? { ...a, name: v.name.trim() } : a)) });
      else commit(addAccount(state, { name: v.name, opening: parseWon(v.opening) || 0 }), '계좌를 만들었어요');
      closeDialog(); break;
    }
    case 'cat': {
      if (fid) commit({ ...state, categories: state.categories.map(c => (c.id === fid ? { ...c, name: v.name.trim(), group: v.group.trim() } : c)) });
      else commit({ ...state, categories: [...state.categories, { id: makeId('c'), name: v.name.trim(), group: v.group.trim(), carryOverspend: false }] });
      closeDialog(); break;
    }
    case 'move': {
      const a = parseWon(v.amount); if (!(a > 0)) { toast('금액을 넣어 주세요'); return; }
      commit(moveMoney(state, m, dialogCtx.env, v.to, a), '옮겼어요'); envelopeSheet(dialogCtx.env); break;
    }
    case 'pull': {
      const a = parseWon(v.amount); if (!(a > 0)) { toast('금액을 넣어 주세요'); return; }
      commit(moveMoney(state, m, v.from, dialogCtx.env, a), '가져왔어요'); envelopeSheet(dialogCtx.env); break;
    }
    case 'hold': commit(holdForNextMonth(state, m, Math.abs(parseWon(v.amount) || 0)), '저장했어요'); closeDialog(); break;
    case 'cover': commit(coverOverspending(state, m, dialogCtx.env, v.from), '메웠어요'); envelopeSheet(dialogCtx.env); break;
    default: break;
  }
});

$('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(); });
postDueSchedules();
render();
