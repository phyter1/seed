---
name: fleet-dns
description: Manage DNS records via Cloudflare API. Add, update, list, or remove DNS records.
category: identity
invocable: false
argument-hint: list | add <name> <type> <content> | remove <name> | check <subdomain>
capabilities:
  - shell
  - read-files
---

# Fleet DNS

Manage DNS records using the Cloudflare API.

## Setup

Requires `~/.config/cloudflare/credentials.json`:
```json
{"api_token": "...", "zone_name": "example.com"}
```

## Arguments

- `list` — show all DNS records
- `add <name> <type> <content> [--proxied]` — add a record (e.g., `add app CNAME cname.vercel-dns.com`)
- `remove <name>` — remove a record by name
- `check <subdomain>` — verify a subdomain resolves correctly

## Execution

### Common Variables

```bash
CF_TOKEN=$(jq -r .api_token ~/.config/cloudflare/credentials.json)
ZONE_NAME=$(jq -r .zone_name ~/.config/cloudflare/credentials.json)

# Get zone ID
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")
```

### list

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=100" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "
import sys,json
records = json.load(sys.stdin)['result']
for r in sorted(records, key=lambda x: x['name']):
    proxy = 'proxied' if r['proxied'] else 'DNS only'
    print(f\"{r['type']:6} {r['name']:35} -> {r['content']:45} ({proxy})\")"
```

### add

```bash
PROXIED="false"  # set to "true" if --proxied flag is present
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"$TYPE\",\"name\":\"$NAME\",\"content\":\"$CONTENT\",\"proxied\":$PROXIED,\"ttl\":1}"
```

### remove

First find the record ID by name, then delete:
```bash
RECORD_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$NAME.$ZONE_NAME" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")

curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $CF_TOKEN"
```

**Always confirm with the user before deleting a DNS record.**

### check

```bash
dig $SUBDOMAIN.$ZONE_NAME +short
curl -s -o /dev/null -w "HTTP %{http_code}" https://$SUBDOMAIN.$ZONE_NAME
```
