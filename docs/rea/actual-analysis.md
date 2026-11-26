# Actual Budget 기능 분석과 봉투 가계부 제작 (REA, 2026-11-26)

## 요약

- 공개 가계부 앱 Actual Budget(actualbudget/actual, MIT)의 예산·거래·규칙·반복 거래·보고·CSV 코드를 REA(Reverse Engineer Anything, `rea-agents` 6.8.0)로 정적 분석했다. 코드는 내려받아 읽기만 했다. `npm install`·빌드·실행·로그인은 하지 않았다.
- 분석한 동작을 바탕으로 한국어 봉투식 가계부 웹앱 **봉투 가계부**(`33modeling/envelope-budget`)를 새로 만들었다(`b547a7a`). Actual 코드는 옮기지 않았고, 계산 규칙과 순서만 참고해 순수 JavaScript로 다시 작성했다.
- 넣은 기능: 봉투식 예산(월별 배정·남은 돈 이월·초과 표시와 초과 처리 두 방식·옮기기·메우기·미루기), 계좌와 거래(시작 잔액, 계좌 옮기기), 반복 거래(주기·끝·주말 옮기기·자동 넣기·상태), 자동 분류 규칙(점수 순서, 규칙 배우기), 월 보고, CSV 가져오기·내보내기, JSON 백업. 금액은 원화 정수.
- 뺀 것: 은행 자동 연동, 여러 기기 동기화(CRDT), 예산 템플릿(목표 문법), 분할 거래, 여러 통화, 사용자 정의 보고서, Monte Carlo 같은 고급 보고.

## 분석 대상과 방법

| 항목 | 내용 |
|---|---|
| 대상 | <https://github.com/actualbudget/actual> (MIT, `LICENSE.txt` "Copyright James Long"), commit `660d834bafc3` (2026-11-26) |
| 고른 이유 | 공개 웹 가계부 가운데 봉투식(envelope) 예산을 가장 온전히 구현했고, 반복 거래·규칙·보고·CSV 가져오기가 모두 있다. 프런트엔드와 계산 코어(loot-core)가 같은 저장소에 있다 |
| 받은 범위 | `packages/desktop-client/src/components/{budget,transactions,rules,schedules,reports}/`, `packages/loot-core/src/server/{budget,rules,transactions,schedules}/`, `packages/loot-core/src/shared/`, 두 패키지의 `package.json`, `LICENSE.txt`, `README.md` (얕은 sparse clone, 파일 471개, 3.9 MB) |
| 도구 | REA 6.8.0을 `npx -y rea-agents@6.8.0`으로 그때그때 실행(전역 설치·MCP 설정 없음), Node 22.23.4 |
| 원칙 | 대상 코드는 실행하지 않음. 공개 소스만 사용. 서버·브라우저 관찰 명령은 쓰지 않음 |
| 재현 | `docs/rea/scripts/run-rea.sh` (명령 전체), 실행 기록은 `docs/rea/evidence/rea-runs.json` |

### 실행한 REA 명령

| 명령 | 입력 | 결과 | 남긴 파일 |
|---|---|---|---|
| `import-reference-source` | 받은 소스 전체 | 4초. HistoricalSourceGraph 항목 508개(파일 471·폴더 37), 관계 3,903개(내부 493·외부 3,410), 파싱 실패 0 | 요약만: `reference-source.summary.json` |
| `analyze-javascript-application` | 기능 묶음 7개의 파일 84개(`--source-paths-json`) | 25초, 파싱 실패 0, AST 노드 102,218개. 구조 그래프 2,966 노드·3,303 간선(imports 1,967·contains 924·exposes 408), 의미 그래프 52,511 노드·58,292 관계, 함수 지문 1,598개, unknown 22,251개. 결과 121 MB | 요약만: `app-analysis.summary-view.json` |
| `inspect-analysis-view` ×3 | 위 Evidence | summary, modules(참조, 459개 중 100개), javascript-facts(핵심 12개 파일) | `app-analysis.*-view.json` |
| `trace-application-feature` ×4 | 모듈 `budget/envelope.ts`·`rules/rule-utils.ts`·`shared/schedules.ts`·`export/export-to-csv.ts`, 양방향 | 11~14초. 시드 4~23개. 시드 주변은 export(`exposes`)와 import(대부분 unavailable·not-found) | `trace-feature-*.summary.json` |
| `trace-javascript-semantics` ×9 | 함수 지문 7개(호출자), 속성 `skipWeekend`·`carryover` | 11초씩. `setBudget` 호출 12곳, `getDateWithSkippedWeekend` 2곳, `getProbableCategory` 1곳(resolved). `rankRules`·`recurConfigToRSchedule`·`coverOverspending`·`transferCategory`는 0곳(다른 파일에서 부름). 속성 두 개는 ambiguous | `trace-semantics-*.json` |

`docs/rea/evidence/feature-facts.json`은 위 그래프에서 기능 묶음별로 파일 수·이름 있는 함수·export·import·저장소 접근·unknown 수를 모은 파생 자료다(`scripts/facts.py`). 고른 파일과 묶음은 `selection.json`·`selection-groups.json`에 있다.

### REA로 하지 못한 것

- **`#` 별칭 import**: Actual은 `#server/db`, `#shared/months` 같은 package.json `imports` 별칭을 쓴다. 분석기 import 간선 1,967개 가운데 unavailable 1,509·not-found 304이고, 소스 파일로 이어진 것은 상대 경로 import(`./util` 등)뿐이었다. 파일 사이 관계는 `import-reference-source`의 내부 관계 493개로 봤다.
- **다른 파일의 함수 호출**: 의미 추적은 가져온 함수를 따라가지 않는다(unknown 사유 "imported from outside this source", "Unsupported MemberExpression call target"). 그래서 `rankRules`(호출은 `transaction-rules.ts`), `coverOverspending`·`transferCategory`(호출은 `budget/app.ts`의 핸들러 표)는 호출자 0으로 나왔다. `setBudget`처럼 같은 파일 안에서 부르는 것만 잡혔다(`actions.ts` 239·261·275·310·388·612·619·649·684·717·723·756행).
- **스프레드시트 셀 의존**: 봉투 계산은 `sheet.get().createDynamic(이름, { dependencies: [...], run })`으로 셀 이름 문자열(`leftover-<id>`, `${prev}!carryover-<id>`)을 잇는다. REA는 이 문자열 의존을 관계로 보지 않으므로, 계산식은 `envelope.ts`(`createCategory` 33행, `createSummary` 98행)를 직접 읽어 정리했다. `carryover` 속성 추적도 `base.ts` 271행 한 곳에서 ambiguous로 끝났다.
- **객체 속성 흐름**: `skipWeekend`는 `schedules.ts`(306·486행)·`rule-utils.ts`(229행)·`occurrences.ts`(43행)·`schedules/app.ts`(530행)에서 읽히는 것까지는 잡혔지만 모두 ambiguous(받는 객체를 알 수 없음)였다.
- **외부 라이브러리 안쪽**: 반복 날짜는 `@rschedule`, CSV는 `csv-parse`·`csv-stringify`, 날짜는 `date-fns`가 한다. 설치하지 않았으므로 볼 수 없어, Actual 쪽 호출부(`recurConfigToRSchedule` 201행, `parseCSV` 141행)와 옵션만 읽었다.
- **양방향 기능 추적**: `trace-application-feature`는 artifact의 `contains` 간선을 타고 그래프 전체(2,966 노드)로 퍼진다(결과 14 MB씩). 시드에 바로 붙은 간선만 따로 걸러 요약했다.
- **화면 관찰**: Actual 서버를 띄워야 해서 `analyze-web-bundle`·`capture-browser-scenario`는 쓰지 않았다.

## Actual 코드 구조 (분석한 84개 파일)

| 기능 묶음 | 파일 | 이름 있는 함수 | export | 상대 import | 많이 쓰는 별칭·패키지 |
|---|---:|---:|---:|---:|---|
| 봉투 예산(계산·메뉴·요약) | 28 | 197 | 101 | 60 | @actual-app/components(63), #hooks(40), #components(33) |
| 달·금액 도우미 | 4 | 113 | 110 | 3 | date-fns(2), #shared(2) |
| 거래(목록·옮기기·합치기) | 12 | 119 | 51 | 16 | @actual-app/core(21), #hooks(20) |
| 규칙(조건·동작·순서·편집기) | 16 | 163 | 69 | 21 | @actual-app/components(27), #server(19), #shared(16) |
| 반복 거래 | 9 | 76 | 43 | 6 | @actual-app/components(27), #server(19) |
| 보고(지출·현금 흐름) | 13 | 39 | 31 | 28 | @actual-app/core(28) |
| CSV 가져오기·내보내기 | 2 | 9 | 3 | 3 | csv-parse, csv-stringify |

브라우저 저장소 접근은 `BudgetTable.tsx`의 sessionStorage 3곳(96·101·238행, 펼친 묶음 기억)만 잡혔다. 자료는 loot-core가 SQLite(`#server/db`)에 둔다.

## 기능별 비교

| # | Actual 기능 | 어떻게 만들었나 (근거) | 봉투 가계부 |
|---|---|---|---|
| 1 | 봉투 남은 돈 | `envelope.ts` `createCategory`(33행): `leftover = budget + sum-amount + (지난달 carryover ? 지난달 leftover : 지난달 leftover-pos)`. `leftover-pos`는 음수면 0(REA: export `createCategory`, 기능 추적 envelope-sheet) | **구현** `computeMonth`. 양수는 그대로, 음수는 '초과 이월'을 켠 봉투만 넘김 |
| 2 | 배정할 돈(To Budget) | `createSummary`(98행): `available-funds = 수입 + from-last-month`, `from-last-month = 지난달 to-budget + 지난달 buffered`, `to-budget = available + last-month-overspent + (−배정 합계) − buffered`. `last-month-overspent`는 이월 안 한 봉투의 음수 합 | **구현** 같은 순서. 초과가 다음 달 배정할 돈에서 빠짐 |
| 3 | 봉투 사이 옮기기 | `actions.ts` `transferCategory`(700행): 보내는 봉투 배정을 줄이고 받는 봉투에 더함, 'to-budget'이면 배정할 돈으로 돌림, 메모 남김(REA: setBudget 호출 717·723행) | **구현**(메모 없음) |
| 4 | 초과 메우기 | `coverOverspending`(575행): 내주는 쪽 남은 돈 한도까지만(`Math.min`, REA: setBudget 612·619행), 배정할 돈에서도 가능 | **구현** |
| 5 | 다음 달로 미루기(hold) | `holdForNextMonth`(543행): 배정할 돈이 양수일 때만 `buffered`에 넣음 | **구현** |
| 6 | 빠른 배정 | `copyPreviousMonth`(222행), `set3MonthAvg`(280행), `setZero`(265행) 등(REA: setBudget 239·261·275·310행) | **구현**(지난달 복사·3개월 평균·비우기) |
| 7 | 예산 템플릿(목표 문법) | `goal-template.pegjs` 문법, `#template` 메모 | 보류(문법이 크고 한국어 문법 설계 필요) |
| 8 | 추적식 예산(tracking) | `tracking.ts` 다른 방식 | 보류(봉투식만) |
| 9 | 계좌·시작 잔액 | 시작 잔액은 수입 분류로 들어가 배정할 돈이 됨 | **구현** |
| 10 | 계좌 옮기기 | `transfer.ts`: 맞은편 계좌에 짝 거래, 분류 없음 | **구현**(짝 거래 함께 고치기·지우기) |
| 11 | 분할 거래 | `shared/transactions.ts` 부모·자식 거래 | 보류 |
| 12 | 규칙 조건·동작 | `condition.ts`: is·contains·oneOf·matches·gt 등 16가지, `action.ts`: set·prepend 등 | **구현**(가게 이름 같음·로 시작·포함 + 금액 범위, 분류·이름 바꾸기) |
| 13 | 규칙 순서 | `rule-utils.ts` `rankRules`(87행): pre·보통·post 단계, 단계 안에서 조건 점수(is 10, oneOf 9, isapprox 5, gt 1, contains 0, 모두 '같음'이면 ×2) 낮은 순, 같으면 id 순. 앞에서부터 적용하니 구체적인 규칙이 이김 | **구현** 같은 방식(같음 20·로 시작 5·포함 0, 금액 조건 +1) |
| 14 | 규칙 찾기 색인 | `rule-indexer.ts`: 가게 첫 글자·값으로 후보 규칙을 좁힘 | 해당 없음(규칙 수가 적어 전부 검사) |
| 15 | 분류 배우기 | `transaction-rules.ts` `updateCategoryRules`(996행)가 `getProbableCategory`(976행, REA 호출 1041행 resolved)를 부름: 같은 가게 최근 5건 중 3건 이상 같은 분류면 'payee is' 규칙을 만들거나 고침 | **구현** 같은 조건 |
| 16 | 반복 날짜 | `recurConfigToRSchedule`(201행): daily·weekly·monthly(일·요일 패턴)·yearly, interval, 끝은 횟수·날짜 | **구현**(요일 패턴 제외, 31일은 그 달 마지막 날) |
| 17 | 주말 옮기기 | `getDateWithSkippedWeekend`(340행): 주말이면 'after' 월요일, 'before' 금요일(REA 호출 `getNextDate` 307행, `getOccurrencesBetween` 493행) | **구현** |
| 18 | 반복 상태 | `getStatus`(52행): completed·paid·due·upcoming(기본 7일)·missed·scheduled | **구현**(paid 대신 넣은 회차 건너뜀) |
| 19 | 자동 넣기 | 규칙 동작 `posts_transaction`으로 날짜가 되면 거래 생성 | **구현**(앱 열 때, 회차 id로 겹침 방지) |
| 20 | 지출 보고 | `spending-spreadsheet.ts`, `custom-spreadsheet.ts`: 분류·묶음별 합, 기간 | **구현**(월별 분류·묶음, 배정 대비, 6달 흐름) |
| 21 | 고급 보고 | 순자산·현금 흐름·Sankey·Monte Carlo·달력 | 보류 |
| 22 | CSV 가져오기 | `parse-file.ts` `parseCSV`(141행): BOM으로 UTF-16 판별, 아니면 UTF-8(인코딩 직접 선택 가능), 구분자 지정, 앞뒤 줄 건너뛰기, `relax_column_count`. 열 고르기 화면은 desktop-client | **구현**(UTF-8 실패 시 EUC-KR 자동, 구분자 자동, 출금/입금 열, 양수 지출 뒤집기, 한국식 날짜) |
| 23 | 가져올 때 겹침 | 은행 거래 `imported_id`·날짜·금액 비교(`merge.ts`) | **구현**(같은 계좌·날짜·금액·가게면 건너뜀) |
| 24 | CSV 내보내기 | `export-to-csv.ts` `exportToCSV`: Account·Date·Payee·Notes·Category("묶음: 분류")·Amount, `^[=+\-@\t\r]`로 시작하는 글은 앞에 `'` | **구현** 같은 수식 막기, 엑셀용 BOM |
| 25 | 은행 연동·동기화 | GoCardless·SimpleFIN, CRDT 동기화 서버 | 보류(서버 없음) |

## 봉투 가계부 구현

- `src/budget.js`: 첫 달부터 고른 달까지 차례로 계산한다. 봉투별 `배정·쓴 돈·넘어온 돈·남은 돈`, 달 요약(수입·지난달에서·지난달 초과·배정 합계·미룬 돈·배정할 돈), 미분류 지출. 배정 바꾸기 함수는 모두 새 상태를 돌려준다.
- `src/rules.js`: 이름 정규화(NFC·공백·소문자), 점수 순서, 적용(분류가 비었을 때만), 배우기.
- `src/schedules.js`: 회차 계산, 주말 옮기기, 상태, 자동 넣기 거래 만들기(`scheduleId`+원래 날짜로 겹침 방지).
- `src/csv.js`: 바이트 해석, 따옴표 CSV 읽기, 열 추측(거래일자·적요·출금액·입금액·가맹점·이용금액 등), 날짜·금액 읽기, 겹침 검사, 내보내기.
- `src/report.js`, `src/store.js`(localStorage, 실패해도 동작), `src/main.js`(화면).
- Actual과 다른 점: 저장은 SQLite가 아니라 기기 localStorage 한 덩어리(JSON)다. 스프레드시트 셀 엔진 없이 매번 처음 달부터 다시 계산한다(수년치도 즉시). 수입 분류는 하나('수입')만 둔다.

### 검증

| 검사 | 결과 |
|---|---|
| `npm test` (node --test) | 26개 통과: 이월·초과 두 방식·옮기기·메우기 한도·미루기·복사·평균, 규칙 순서·조건·배우기, 31일·주말·횟수/날짜 끝·윤년·상태·자동 넣기 겹침, CSV 따옴표·BOM·EUC-KR·출금/입금·수식 막기, 저장 실패 |
| `npm run build` | `dist/` 생성(JS 47 KB, CSS 9 KB) |
| Playwright(Chromium headless, 390×844 터치) | 예시 데이터 → 배정 입력(`5만`) → 거래 넣기(규칙 미리보기 '외식·카페') → 6개 화면 → CSV 가져오기(3줄 중 겹침 1줄 건너뜀) → 봉투 메뉴. 화면마다 가로 넘침·44px 미만 누름·16px 미만 입력 0, 320px 폭도 0, 콘솔 오류 0 |

## 파일

- `docs/rea/manifest.json`: REA 현황판이 읽는 분석 기록(`rea-analysis/v1`).
- `docs/rea/evidence/`: REA 결과(요약·보기·추적 요약), `feature-facts.json`(파생), `selection*.json`, `rea-runs.json`(명령·초·크기·SHA-256·Evidence ID). 121 MB 전체 Evidence와 추적 원본은 넣지 않고 크기·SHA-256만 남겼다. 로컬 경로는 `$ACTUAL`·`$WORK`로 바꿨다.
- `docs/rea/scripts/`: `run-rea.sh`(전체 절차), `select.py`(묶음별 파일 고르기), `trace_inputs.py`(추적 입력), `facts.py`(사실 모으기).
