#!/usr/bin/env bash
# Actual Budget(actualbudget/actual, MIT)의 예산·거래·규칙·반복·보고·CSV 코드를 REA(rea-agents 6.8.0)로 정적 분석해
# docs/rea/evidence/ 의 결과를 다시 만드는 절차. Actual 코드는 내려받아 읽기만 한다(npm install·빌드·실행 없음).
# 사용법: bash docs/rea/scripts/run-rea.sh <작업 폴더>   (Node 22, git, python3 필요. 결과 약 1.9 GB, 대부분 추적 입력)
set -euo pipefail
WORK=${1:?작업 폴더를 지정하세요}
HERE=$(cd "$(dirname "$0")" && pwd)
REA="nice -n 10 npx -y rea-agents@6.8.0"
COMMIT=660d834bafc32a1a6a552044c263a93be7ab6389   # 분석 시점 master (2026-11-26)
mkdir -p "$WORK/work"
cd "$WORK"

# 1. 필요한 폴더만 얕게 받기(sparse)
if [ ! -d actual ]; then
  git init -q actual
  git -C actual remote add origin https://github.com/actualbudget/actual.git
  git -C actual sparse-checkout set --no-cone '/LICENSE.txt' '/README.md' \
    '/packages/desktop-client/package.json' '/packages/desktop-client/tsconfig.json' \
    '/packages/desktop-client/src/components/budget/' '/packages/desktop-client/src/components/transactions/' \
    '/packages/desktop-client/src/components/rules/' '/packages/desktop-client/src/components/schedules/' \
    '/packages/desktop-client/src/components/reports/' '/packages/loot-core/package.json' \
    '/packages/loot-core/src/server/budget/' '/packages/loot-core/src/server/rules/' \
    '/packages/loot-core/src/server/transactions/' '/packages/loot-core/src/server/schedules/' '/packages/loot-core/src/shared/'
  git -C actual fetch -q --depth 1 --filter=blob:none origin "$COMMIT"
  git -C actual checkout -q FETCH_HEAD
fi
SRC="$WORK/actual"
cd "$WORK/work"

# 2. 받은 소스 전체의 모듈 관계(HistoricalSourceGraph)와 요약
$REA import-reference-source "$SRC" --format json > ref-source.json
$REA import-reference-source "$SRC" --detail summary --outline-depth 3 --format json > ref-source.summary.json

# 3. 기능 묶음 7개(84개 파일) 정적 분석(약 25초, 결과 약 120 MB)
python3 -I "$HERE/select.py" "$SRC" "$WORK/work"
NODE_OPTIONS=--max-old-space-size=6144 $REA analyze-javascript-application "$SRC" \
  --source-paths-json "$WORK/work/selection.json" --max-semantic-nodes 300000 --max-semantic-unknowns 300000 \
  --format json > app-evidence.json 2> app-stderr.log

# 4. 보기(view): 요약, 모듈 참조, 핵심 파일 12개의 분석 범위
E='{"kind":"evidence-file","path":"app-evidence.json"}'
echo "{\"source\":$E,\"view\":{\"kind\":\"summary\"}}" > view-summary.json
echo "{\"source\":$E,\"view\":{\"kind\":\"javascript\",\"collection\":\"modules\",\"projection\":\"references\",\"where\":{\"kind\":\"javascript-asset\"},\"offset\":0,\"limit\":100}}" > view-modules.json
python3 -I - <<'PY'
import json
L = "packages/loot-core/src/"; D = "packages/desktop-client/src/components/"
paths = [L + p for p in ("server/budget/envelope.ts", "server/budget/actions.ts", "server/rules/rule-utils.ts", "server/rules/rule-indexer.ts",
         "server/rules/condition.ts", "server/transactions/transaction-rules.ts", "shared/schedules.ts", "server/transactions/export/export-to-csv.ts",
         "server/transactions/import/parse-file.ts", "shared/months.ts")] + [D + "reports/spreadsheets/spending-spreadsheet.ts", D + "budget/BalanceWithCarryover.tsx"]
json.dump({"source": {"kind": "evidence-file", "path": "app-evidence.json"},
           "view": {"kind": "javascript-facts", "where": {"paths": paths}, "property_keys": ["path", "parse_status", "bytes", "analysis_status", "syntax_status", "semantic_status"],
                    "include_available_property_keys": True, "offset": 0, "limit": 64}}, open("view-facts.json", "w"))
PY
for v in summary modules facts; do
  NODE_OPTIONS=--max-old-space-size=6144 $REA inspect-analysis-view "view-$v.json" --format json > "app-$v-view.json"
done

# 5. 기능 추적(모듈 4개)과 의미 추적(함수 호출자 7개, 속성 2개)
python3 -I "$HERE/trace_inputs.py" "$WORK/work"
for n in envelope-sheet rule-ranking schedule-dates csv-export; do
  NODE_OPTIONS=--max-old-space-size=6144 $REA trace-application-feature "trace-feature-$n-input.json" --format json > "trace-feature-$n.json"
done
for n in rankrules-callers probable-category-callers skip-weekend-callers recur-config-callers cover-overspending-callers \
         transfer-category-callers set-budget-callers skipweekend-property carryover-property; do
  NODE_OPTIONS=--max-old-space-size=6144 $REA trace-javascript-semantics "trace-semantics-$n-input.json" --format json > "trace-semantics-$n.json"
done

# 6. 작은 사실 모으기(REA 결과만 읽음). 저장소에 넣을 때는 로컬 경로를 $ACTUAL 로 바꾼다.
mkdir -p out
python3 -I "$HERE/facts.py" "$WORK/work" "$WORK/work/out"
