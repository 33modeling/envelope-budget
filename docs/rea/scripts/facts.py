"""Combine REA outputs for Actual Budget (HistoricalSourceGraph + application Evidence + traces) into small facts.

Reads REA JSON only; Actual code is never executed. Paths are relative to the Actual checkout root.
Usage: python3 -I facts.py <work dir> <evidence out dir>
Writes feature-facts.json, trace-feature-*.summary.json, trace-semantics-*.json (compact).
"""
import collections, glob, json, os, sys

W, OUT = sys.argv[1], sys.argv[2]
J = lambda name: json.load(open(os.path.join(W, name)))
os.makedirs(OUT, exist_ok=True)
ref = J('ref-source.json')
ev = J('app-evidence.json')
sel = J('selection-groups.json')
membership = sel['membership']
nr = ev['normalized_result']; g = nr['graph']; sg = nr['semantic_graph']
gnodes = {n['node_id']: n for n in g['nodes']}

def path_of(node):
    key = (node.get('identity') or {}).get('key') or ''
    if key.startswith('['):
        return json.loads(key)[1]
    return key.split(':', 1)[1] if ':' in key else key

def loc(o):
    v = ((o.get('evidence') or {}).get('location') or {}).get('value') or {}
    return v.get('source') or v.get('path'), (v.get('start') or {}).get('line')

# 1. 묶음별 사실
groups = collections.defaultdict(lambda: {'files': 0, 'functions': [], 'exports': [], 'imports_internal': 0, 'imports_external': collections.Counter(),
                                          'storage': [], 'unknowns': 0})
for p, grp in membership.items():
    groups[grp]['files'] += 1
fn_by_id = {}
for n in sg['nodes']:
    if n['kind'] == 'function':
        p = n['identity']['module_path']; name = (n.get('properties') or {}).get('name')
        fn_by_id[n['node_id']] = (p, name, ((n['identity'].get('source_range') or {}).get('start') or {}).get('line'))
        if p in membership and name:
            groups[membership[p]]['functions'].append(f"{p.split('/')[-1]}:{name}")
for u in sg['unknowns']:
    p, _ = loc(u)
    if p in membership:
        groups[membership[p]]['unknowns'] += 1
for e in g['edges']:
    s = gnodes.get(e['source_node_id']); p = path_of(s) if s else None
    if p not in membership:
        continue
    G = groups[membership[p]]; pr = e.get('properties') or {}
    if e['relation'] == 'exposes' and pr.get('exported_name'):
        G['exports'].append(f"{p.split('/')[-1]}:{pr['exported_name']}")
    elif e['relation'] == 'persists_to':
        G['storage'].append(f"{p.split('/')[-1]}:{loc(e)[1]} {pr.get('mechanism')}")
for r in ref['relationships']:
    if r['kind'] == 'imports' and r['from_path'] in membership:
        G = groups[membership[r['from_path']]]
        if r['resolution'] == 'internal':
            G['imports_internal'] += 1
        else:
            spec = r['to']
            if spec.startswith('#'):
                spec = spec.split('/')[0] + '/…'
            elif not spec.startswith('.'):
                spec = '/'.join(spec.split('/')[:2]) if spec.startswith('@') else spec.split('/')[0]
            G['imports_external'][spec] += 1
facts = {}
for k, G in groups.items():
    facts[k] = {'files': G['files'], 'named_functions': len(G['functions']), 'exports': len(G['exports']),
                'imports_internal_relative': G['imports_internal'], 'imports_other': dict(G['imports_external'].most_common(8)),
                'storage': G['storage'], 'semantic_unknowns': G['unknowns'], 'functions_sample': sorted(G['functions'])[:40],
                'exports_sample': sorted(G['exports'])[:40]}
stats = nr['statistics']
json.dump({'source': 'app-evidence.json ' + ev['evidence_id'], 'statistics': stats,
           'graph': {'nodes': len(g['nodes']), 'edges': len(g['edges']), 'edge_kinds': dict(collections.Counter(e['relation'] for e in g['edges']))},
           'import_resolution': dict(collections.Counter(str((e.get('properties') or {}).get('resolution_status')) for e in g['edges'] if e['relation'] == 'imports')),
           'semantic_graph': {'nodes': len(sg['nodes']), 'relations': len(sg['relations']), 'fingerprints': len(sg['fingerprints']), 'unknowns': len(sg['unknowns']),
                              'unknown_reasons': dict(collections.Counter(u.get('reason') for u in sg['unknowns']).most_common(10))},
           'route_inventory': {'routes': len(nr['route_inventory']['routes']), 'occurrences': len(nr['route_inventory']['occurrences']),
                               'unknowns': len(nr['route_inventory']['unknowns'])},
           'groups': facts}, open(os.path.join(OUT, 'feature-facts.json'), 'w'), ensure_ascii=False, indent=1)

# 2. 기능 추적 요약: 시드에 바로 붙은 간선만
for f in sorted(glob.glob(os.path.join(W, 'trace-feature-*.json'))):
    if f.endswith('-input.json'):
        continue
    t = json.load(open(f))['normalized_result']
    seeds = {s['node_id'] for s in t['seed_matches']}
    tn = {n['node_id']: n for n in t['graph']['nodes']}
    near = collections.Counter(); names = []
    for e in t['graph']['edges']:
        if e['source_node_id'] in seeds or e['target_node_id'] in seeds:
            pr = e.get('properties') or {}
            near[(e['relation'], pr.get('resolution_status'))] += 1
            if e['relation'] == 'exposes' and pr.get('exported_name'):
                names.append(pr['exported_name'])
            elif e['relation'] == 'imports':
                names.append('import ' + str(pr.get('specifier')))
    name = os.path.basename(f)[:-5]
    json.dump({'trace': name, 'seed': t['seed'], 'direction': t['direction'], 'summary': t['summary'], 'coverage': t['coverage'],
               'seed_adjacent_edges': {f'{a}/{b}': c for (a, b), c in near.items()}, 'seed_adjacent_names': sorted(set(names)),
               'limitations': t['limitations']}, open(os.path.join(OUT, name + '.summary.json'), 'w'), ensure_ascii=False, indent=1)

# 3. 의미 추적: 위치·관계·unknown 사유만
for f in sorted(glob.glob(os.path.join(W, 'trace-semantics-*.json'))):
    if f.endswith('-input.json'):
        continue
    t = json.load(open(f)); r = t['normalized_result']
    nodes = []
    for n in r['nodes']:
        p = n['identity']['module_path']; line = ((n['identity'].get('source_range') or {}).get('start') or {}).get('line')
        inside = fn_by_id.get(n.get('function_node_id'))
        nodes.append({'kind': n['kind'], 'at': f'{p}:{line}', 'inside_function': inside[1] if inside else None,
                      'name': (n.get('properties') or {}).get('name')})
    json.dump({'evidence_id': t['evidence_id'], 'query': t['parameters']['query'], 'status': r['status'], 'seeds': len(r['seed_node_ids']),
               'nodes': nodes, 'relations': [{'relation': x['relation'], 'resolution': x['resolution'], 'at': '%s:%s' % loc(x)} for x in r['relations']],
               'unknowns': [{'reason': u['reason'], 'detail': u.get('detail'), 'at': '%s:%s' % loc(u)} for u in r['unknowns']]},
              open(os.path.join(OUT, os.path.basename(f)), 'w'), ensure_ascii=False, indent=1)
print('facts ok')
