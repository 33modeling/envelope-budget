"""Pick the Actual Budget source files REA analyses, grouped by feature (reads file names only).

Usage: python3 -I select.py <actual checkout> <out dir>
Writes selection.json (path list) and selection-groups.json (group -> paths, path -> group).
"""
import json, os, sys

ROOT, OUT = sys.argv[1], sys.argv[2]
DC = 'packages/desktop-client/src/components/'
LC = 'packages/loot-core/src/'
GROUPS = {
    'envelope-budget': [LC + 'server/budget/' + f for f in ('envelope.ts', 'actions.ts', 'base.ts', 'util.ts', 'app.ts', 'statements.ts')]
        + [DC + 'budget/envelope/' + f for f in ('EnvelopeBudgetComponents.tsx', 'EnvelopeBudgetContext.tsx', 'BudgetMenu.tsx', 'BalanceMenu.tsx',
                                                 'BalanceMovementMenu.tsx', 'CoverMenu.tsx', 'TransferMenu.tsx', 'HoldMenu.tsx', 'IncomeMenu.tsx')]
        + [DC + 'budget/envelope/budgetsummary/' + f for f in ('BudgetSummary.tsx', 'ToBudget.tsx', 'ToBudgetAmount.tsx', 'ToBudgetMenu.tsx',
                                                               'TotalsList.tsx', 'BudgetMonthMenu.tsx')]
        + [DC + 'budget/' + f for f in ('BalanceWithCarryover.tsx', 'BudgetTable.tsx', 'BudgetCategories.tsx', 'ExpenseCategory.tsx',
                                        'MonthPicker.tsx', 'util.ts', 'index.tsx')],
    'months': [LC + 'shared/months.ts', LC + 'shared/util.ts', LC + 'shared/arithmetic.ts', LC + 'shared/currencies.ts'],
    'transactions': [LC + 'server/transactions/' + f for f in ('index.ts', 'app.ts', 'transfer.ts', 'merge.ts')]
        + [LC + 'shared/' + f for f in ('transactions.ts', 'transfer.ts')]
        + [DC + 'transactions/' + f for f in ('TransactionsTable.tsx', 'TransactionList.tsx', 'SimpleTransactionsTable.tsx', 'table/utils.ts',
                                              'table/columns.ts', 'applyRulesToTransaction.ts')],
    'rules': [LC + 'server/rules/' + f for f in ('rule.ts', 'condition.ts', 'action.ts', 'index.ts', 'rule-indexer.ts', 'rule-utils.ts', 'app.ts')]
        + [LC + 'server/transactions/transaction-rules.ts', LC + 'shared/rules.ts', LC + 'shared/normalisation.ts']
        + [DC + 'rules/' + f for f in ('RuleEditor.tsx', 'RulesList.tsx', 'RuleRow.tsx', 'ConditionExpression.tsx', 'ActionExpression.tsx', 'Value.tsx')],
    'schedules': [LC + 'server/schedules/' + f for f in ('app.ts', 'find-schedules.ts', 'occurrences.ts')] + [LC + 'shared/schedules.ts']
        + [DC + 'schedules/' + f for f in ('ScheduleEditForm.tsx', 'SchedulesTable.tsx', 'StatusBadge.tsx', 'schedule-edit-utils.ts', 'index.tsx')],
    'reports': [DC + 'reports/spreadsheets/' + f for f in ('spending-spreadsheet.ts', 'custom-spreadsheet.ts', 'cash-flow-spreadsheet.tsx',
                                                            'grouped-spreadsheet.ts', 'makeQuery.ts', 'filterEmptyRows.ts', 'sortData.ts', 'recalculate.ts')]
        + [DC + 'reports/' + f for f in ('ReportSummary.tsx', 'reportRanges.ts', 'monthRange.ts', 'util.ts')] + [DC + 'reports/graphs/DonutGraph.tsx'],
    'csv-import-export': [LC + 'server/transactions/export/export-to-csv.ts', LC + 'server/transactions/import/parse-file.ts'],
}
paths, membership = [], {}
for g, ps in GROUPS.items():
    for p in ps:
        if not os.path.isfile(os.path.join(ROOT, p)):
            sys.exit(f'missing {p}')
        if p not in membership:
            membership[p] = g
            paths.append(p)
os.makedirs(OUT, exist_ok=True)
json.dump(paths, open(os.path.join(OUT, 'selection.json'), 'w'), indent=1)
json.dump({'groups': GROUPS, 'membership': membership}, open(os.path.join(OUT, 'selection-groups.json'), 'w'), indent=1, ensure_ascii=False)
print(len(paths), 'files in', len(GROUPS), 'groups')
