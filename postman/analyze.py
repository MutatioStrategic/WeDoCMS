import json

d = json.load(open('veld-archive-route-sweep.postman_collection.json', encoding='utf-8'))

def iter_items(items):
    for item in items:
        if 'request' in item:
            yield item
        yield from iter_items(item.get('item', []))

# Get all unique body payloads for POST/PUT/PATCH requests
for item in iter_items(d.get('item', [])):
    req = item.get('request', {})
    method = req.get('method', '')
    if method in ('POST', 'PUT', 'PATCH'):
        body = req.get('body', {})
        if body and body.get('mode') == 'raw':
            raw = body.get('raw', '')
            if raw.strip():
                url = req.get('url', {})
                raw_url = url.get('raw') if isinstance(url, dict) else url
                print(method, raw_url)
                print('  ', raw[:200])
                print()
