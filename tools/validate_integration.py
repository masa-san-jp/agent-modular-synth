#!/usr/bin/env python3
"""Migration integrity only, not a source-truth or license audit."""
import pathlib,json,hashlib,re
R=pathlib.Path(__file__).resolve().parents[1]
def load(p):return json.loads((R/p).read_text())
def digest(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
manifest=load('data/reference/integration-preservation.json')
for c in manifest['pr4_files']:
 d=load(c['path'])
 for key,n in c['lengths'].items():d[key]=d[key][:n]
 for e in d.get('entities',[]):
  e.pop('legacy_ids',None); e.pop('imported_context',None)
  e['features']=e['features'][:c['feature_lengths'][e['id']]]
 for e in d.get('sources',[]):e.pop('imported_observations',None)
 assert digest(d)==c['sha256'],c['path']
for c in manifest['main_json']:
 assert hashlib.sha256((R/c['path']).read_bytes()).hexdigest()==c['sha256'],c
m=load('data/reference/legacy-map.json')
seen=set()
for a in m['records']:
 assert a['legacy_id'] not in seen
 seen.add(a['legacy_id'])
 old=load(a['legacy_path']);d=load(a['canonical_path'])
 assert a['entity_id'] in {e['id'] for e in d['entities']}
 facts={f['id']:f for f in d['facts']}
 assert len(a['fact_ids'])==len(old['facts'])
 for idx,(fid,orig) in enumerate(zip(a['fact_ids'],old['facts'])):
  f=facts[fid];assert f['statement']==orig['value'] and f['locator']==orig['evidence']['section']
  assert f['provenance']['legacy_fact_index']==idx and f['provenance']['legacy_record']==old['id']
  assert f['provenance']['certainty']==orig['certainty']
  assert any(s['legacy_id']==orig['evidence']['source_id'] and s['source_id']==f['source_id'] for s in m['sources'])
 for u in old['unknowns']:
  assert any(x['item']==u and x['entity_id']==a['entity_id'] for x in d['unconfirmed'])
alias={x['legacy_id']:x['entity_id'] for x in m['records']}
for a in m['records']:
 old=load(a['legacy_path'])
 if old['parent_id']:
  assert alias[old['parent_id']] != a['entity_id'], 'Parent/child wrongly merged: '+old['id']
# Firmware announcement/manual edition is not confirmed hardware revision.
for oid in ['I002','I005','I006','M006','M007']:
 a=next(x for x in m['records'] if x['legacy_id']==oid)
 e=next(x for x in load(a['canonical_path'])['entities'] if x['id']==a['entity_id'])
 assert e['version_status']=='unconfirmed',oid
assert len(seen)==13 and len(m['sources'])==18
# Confirm each source's complete old metadata survives and maps into the target.
oldsrc={s['id']:s for s in load('references/sources/catalog.json')}
for s in m['sources']:
 d=load('data/reference/sources/'+s['target_id']+'.json')
 entry=next(x for x in d['sources'] if x['id']==s['source_id'])
 assert any(x['metadata']==oldsrc[s['legacy_id']] for x in entry['imported_observations'])
for p in R.rglob('*.md'):
 for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',p.read_text()):
  if re.match(r'[a-z]+:|#',target):continue
  path=target.split('#')[0]
  if path:assert (p.parent/path).exists(),(p,target)
print('PASS: PR #4 original fields, 13 legacy records / 28 facts / 18 sources, old JSON bytes, relative Markdown paths')
