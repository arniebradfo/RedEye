"""Convert a legacy RedEye .redeye SQLite campaign into the demo's seed JSON format.

usage: python3 tools/fixture-to-seed.py <db.redeye> <seed-id> <out.json> <image-dir>
"""
import json, os, re, sqlite3, sys
from datetime import datetime, timezone

db, seed_id, out_path, image_dir = sys.argv[1:5]
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row


def rows(sql):
    return [dict(r) for r in c.execute(sql)]


def iso(v):
    if v is None or v == '':
        return None
    return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def cols(table):
    return {r[1] for r in c.execute(f'pragma table_info({table})')}


def relpath(p):
    if not p:
        return p
    m = re.search(r'/campaign/[^/]+/(.*)$', p)
    return m.group(1) if m else os.path.basename(p)


servers = []
for s in rows('select * from server'):
    meta = rows(f"select * from server_meta where server_id = '{s['id']}'")
    m = meta[0] if meta else {'id': s['id'] + '-meta', 'type': 'http'}
    servers.append({
        'id': s['id'], 'name': s['name'], 'displayName': s['display_name'] or None, 'hidden': bool(s['hidden']),
        'meta': {'id': m['id'], 'type': m.get('type') or 'http', 'shape': m.get('shape') or 'hexagonUp', 'color': m.get('color')},
    })

hosts = []
for h in rows('select * from host'):
    metas = rows(f"select * from host_meta where host_id = '{h['id']}'")
    hosts.append({
        'id': h['id'], 'hostName': h['host_name'], 'displayName': h['display_name'] or None,
        'hidden': bool(h['hidden']), 'cobaltStrikeServer': bool(h['cobalt_strike_server']),
        'meta': [{'id': m['id'], 'os': m['os'], 'osVersion': m.get('os_version'), 'ip': m['ip'], 'type': m['type'],
                  'shape': m.get('shape') or 'circle', 'color': m.get('color')} for m in metas],
    })

beacon_ops = {}
for r in rows('select * from beacon_operators'):
    beacon_ops.setdefault(r['beacon_id'], []).append(r['operator_id'])

beacons = []
for b in rows('select * from beacon'):
    metas = rows(f"select * from beacon_meta where beacon_id = '{b['id']}'")
    beacons.append({
        'id': b['id'], 'beaconName': b['beacon_name'], 'displayName': b['display_name'] or None,
        'hidden': bool(b['hidden']), 'hostId': b['host_id'], 'serverId': b['server_id'],
        'operatorIds': beacon_ops.get(b['id'], []),
        'meta': [{'id': m['id'], 'pid': m['pid'], 'process': m.get('process'), 'username': m['username'],
                  'startTime': iso(m['start_time']), 'endTime': iso(m['end_time']), 'ip': m['ip'],
                  'port': m.get('port'), 'type': m['type'], 'shape': m.get('shape') or 'circle',
                  'color': m.get('color'), 'sourceId': m['source_id']} for m in metas],
    })

logs = [{
    'id': l['id'], 'blob': l['blob'], 'filepath': relpath(l['filepath']), 'lineNumber': l['line_number'],
    'lineType': l['line_type'], 'logType': l['log_type'], 'dateTime': iso(l['date_time']),
    'beaconId': l['beacon_id'], 'commandId': l['command_id'],
} for l in rows('select * from log_entry')]

commands = [{
    'id': x['id'], 'commandFailed': bool(x['command_failed']),
    'attackIds': [a for a in (x['attack_ids'] or '').split(',') if a],
    'inputId': x['input_id'], 'inputText': x['input_text'], 'beaconId': x['beacon_id'], 'operatorId': x['operator_id'],
} for x in rows('select * from command')]

group_cmds = {}
for r in rows('select * from command_group_commands'):
    group_cmds.setdefault(r['command_group_id'], []).append(r['command_id'])
command_groups = [{'id': g['id'], 'generation': g['generation'], 'commandIds': group_cmds.get(g['id'], [])}
                  for g in rows('select * from command_group')]

ann_tags = {}
for r in rows('select * from annotation_tags'):
    ann_tags.setdefault(r['annotation_id'], []).append(r['tag_id'])
annotations = [{
    'id': a['id'], 'text': a['text'] or '', 'generation': a['generation'], 'date': iso(a['date']),
    'user': a['user'] or '', 'favorite': bool(a['favorite']), 'commandGroupId': a['command_group_id'],
    'tagIds': ann_tags.get(a['id'], []),
} for a in rows('select * from annotation')]

tags = [{'id': t['id'], 'text': t['text']} for t in rows('select * from tag')]

links = [{
    'id': l['id'], 'name': l['name'], 'startTime': iso(l['start_time']), 'endTime': iso(l['end_time']),
    'manual': bool(l['manual']), 'originId': l['origin_id'], 'destinationId': l['destination_id'], 'commandId': l['command_id'],
} for l in rows('select * from link')]

operators = [{'id': o['id'], 'startTime': iso(o['start_time']), 'endTime': iso(o['end_time'])} for o in rows('select * from operator')]

images = []
for i in rows('select * from image'):
    fname = f"{seed_id}-{i['id']}.{i['file_type']}"
    with open(os.path.join(image_dir, fname), 'wb') as f:
        f.write(i['blob'])
    images.append({'id': i['id'], 'fileType': i['file_type'], 'beaconId': i['beacon_id'], 'url': f'demo-images/{fname}'})

files = [{
    'id': f['id'], 'fileName': f['file_name'], 'location': f['location'], 'dateTime': iso(f['date_time']),
    'md5': f['md5'], 'fileFlag': f['file_flag'], 'beaconId': f['beacon_id'],
} for f in rows('select * from file')]

seed = dict(servers=servers, hosts=hosts, beacons=beacons, logs=logs, commands=commands, commandGroups=command_groups,
            annotations=annotations, tags=tags, links=links, operators=operators, images=images, files=files)
with open(out_path, 'w') as f:
    json.dump(seed, f, separators=(',', ':'))
print(out_path, {k: len(v) for k, v in seed.items()})
