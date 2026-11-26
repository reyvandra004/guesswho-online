#!/usr/bin/env python3
# Ekstrak dataset dari guess-who-kdrama-v7.html -> data/dataset.json
import json, ast, re

SRC = '/home/hatch/workspace/game-guesswho-kdrama/guess-who-kdrama-v7.html'
s = open(SRC, encoding='utf-8').read()

def extract(name):
    i = s.index('const ' + name + '=')
    j = i + len('const ' + name + '=')
    start = j; depth = 0; instr = False; esc = False; k = j
    open_c = s[j]; close_c = ']' if open_c == '[' else '}'
    while k < len(s):
        c = s[k]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == open_c: depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0: return json.loads(s[start:k+1])
        k += 1
    raise ValueError(name)

def fix_none(v):
    return None if v in ('None', '', None) else v

drama = extract('DATA')
groups = extract('KPGROUPS')
idols = extract('KPIDOLS')
songs = extract('SONGS')

for g in groups:
    if isinstance(g['songs'], str):
        g['songs'] = ast.literal_eval(g['songs'])
    g['photo'] = fix_none(g['photo'])
    g['gen'] = int(g['gen']); g['year'] = int(g['year'])
for d in idols:
    d['fact'] = fix_none(d.get('fact')); d['role'] = fix_none(d.get('role'))
for sg in songs:
    sg['year'] = int(sg['year'])

out = {'drama': drama, 'kpgroups': groups, 'kpidols': idols, 'songs': songs}
with open('/home/hatch/workspace/game-guesswho-online/data/dataset.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)

dramas = sorted(set(e['drama'] for e in drama))
print('drama entries:', len(drama), '| distinct dramas:', len(dramas))
print('kpop groups:', len(groups), '| with photo:', sum(1 for g in groups if g['photo']))
print('kpop idols:', len(idols))
print('songs:', len(songs), '| distinct artists(akey):', len(set(x['akey'] for x in songs)))
print('sample group:', {k: (str(v)[:40]) for k, v in groups[1].items()})
