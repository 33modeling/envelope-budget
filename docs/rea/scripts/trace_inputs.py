"""Write REA trace inputs from the saved Actual Budget application Evidence (reads REA JSON only)."""
import json, sys, os
W = sys.argv[1]
os.chdir(W)
ev = json.load(open('app-evidence.json'))
sg = ev['normalized_result']['semantic_graph']
LC = 'packages/loot-core/src/'

def fp(name, suffix):
    node = next(n for n in sg['nodes'] if n['kind'] == 'function' and (n.get('properties') or {}).get('name') == name
                and n['identity']['module_path'].endswith(suffix))
    return next(f['fingerprint_sha256'] for f in sg['fingerprints'] if f['function_node_id'] == node['node_id'])

app = {'kind': 'evidence-file', 'path': 'app-evidence.json'}
feature = {
    'envelope-sheet': LC + 'server/budget/envelope.ts',
    'rule-ranking': LC + 'server/rules/rule-utils.ts',
    'schedule-dates': LC + 'shared/schedules.ts',
    'csv-export': LC + 'server/transactions/export/export-to-csv.ts',
}
for name, module in feature.items():
    json.dump({'application': ev, 'seed': {'kind': 'module', 'value': module, 'match': 'exact'}, 'direction': 'both'},
              open(f'trace-feature-{name}-input.json', 'w'))
semantic = {
    'rankrules-callers': {'kind': 'function', 'fingerprint_sha256': fp('rankRules', 'rules/rule-utils.ts')},
    'probable-category-callers': {'kind': 'function', 'fingerprint_sha256': fp('getProbableCategory', 'transactions/transaction-rules.ts')},
    'skip-weekend-callers': {'kind': 'function', 'fingerprint_sha256': fp('getDateWithSkippedWeekend', 'shared/schedules.ts')},
    'recur-config-callers': {'kind': 'function', 'fingerprint_sha256': fp('recurConfigToRSchedule', 'shared/schedules.ts')},
    'cover-overspending-callers': {'kind': 'function', 'fingerprint_sha256': fp('coverOverspending', 'budget/actions.ts')},
    'transfer-category-callers': {'kind': 'function', 'fingerprint_sha256': fp('transferCategory', 'budget/actions.ts')},
    'set-budget-callers': {'kind': 'function', 'fingerprint_sha256': fp('setBudget', 'budget/actions.ts')},
}
for name, seed in semantic.items():
    json.dump({'application': ev, 'query': {'seed': seed, 'direction': 'callers', 'include_ambiguous_dynamic_edges': True}},
              open(f'trace-semantics-{name}-input.json', 'w'))
for name, seed in {'skipweekend-property': {'kind': 'property', 'name': 'skipWeekend'},
                   'carryover-property': {'kind': 'property', 'name': 'carryover'}}.items():
    json.dump({'application': ev, 'query': {'seed': seed, 'direction': 'forward-influence', 'include_ambiguous_dynamic_edges': True}},
              open(f'trace-semantics-{name}-input.json', 'w'))
print('ok', list(feature), list(semantic))
