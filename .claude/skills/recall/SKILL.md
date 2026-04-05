---
name: recall
description: Query @seed/memory to retrieve top-k relevant memories for prompt injection. Returns scored chunks (no LLM synthesis). Use when you need historical context about past decisions, incidents, or patterns before acting.
argument-hint: <search query> [--k <n>] [--project <name>] [--no-project]
allowed-tools: Bash(curl *), Bash(jq *)
---

# Recall

Pull top-k memories from `@seed/memory` at `http://ren1.local:19888/search`.

Unlike `/query` (which does LLM synthesis), `/search` returns raw scored
chunks. Format them yourself and fold them into your working context.

## Arguments

Parse from `$ARGUMENTS`:

- **Query** — all non-flag tokens joined with spaces (required).
- `--k <n>` — number of results to return. Default: `5`. Max: `50`.
- `--project <name>` — scope to a specific project. If omitted, auto-detect
  from the basename of `$CLAUDE_PROJECT_DIR` (if set) or `$(pwd)`.
- `--no-project` — skip project scoping entirely (search all memories).

Example:
- `/recall fleet router deploy` → k=5, project=seed (auto-detected)
- `/recall vec0 PK disagreement --k 10` → k=10, project=seed
- `/recall agent reliability --no-project --k 8` → k=8, no project filter

## Execution

```bash
# 1. Parse args from "$ARGUMENTS". Query = everything except --flag pairs.
# 2. Resolve project:
#    - If --no-project: project=""
#    - Else if --project X: project="X"
#    - Else: project=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")
# 3. URL-encode query. Build URL.
# 4. curl it.

Q_ENCODED=$(jq -rn --arg q "$QUERY" '$q|@uri')
URL="http://ren1.local:19888/search?q=${Q_ENCODED}&k=${K}"
if [ -n "$PROJECT" ]; then
  URL="${URL}&project=${PROJECT}"
fi
curl -s -m 15 "$URL"
```

## Response shape

```json
{
  "query": "fleet router deploy",
  "k": 5,
  "count": 3,
  "results": [
    {
      "memory_id": 1234,
      "score": 0.73,
      "distance": 0.41,
      "similarity": 0.59,
      "summary": "…",
      "source": "journal",
      "project": "seed",
      "importance": 0.7,
      "entities": ["fleet-router", "ren3"],
      "topics": ["deployment", "workloads"],
      "created_at": "2026-04-04T14:32:00.000Z",
      "source_url": null,
      "origin": "internal"
    }
  ]
}
```

`score` is the blended relevance score (importance × access × distance ×
age). Results are sorted by `score` descending, not pure similarity.

## Presenting results

Format each result as a compact card. Lead with similarity %, follow with
summary, then meta (source, project, date, top entities). Skip empty fields.

```
### Memory #1234  ·  sim 59%  ·  score 0.73
Fleet router deployed to ren3 on 2026-04-04, config_version v2→v3…
source: journal  ·  project: seed  ·  entities: fleet-router, ren3
```

If `count == 0`, say so plainly — don't pad with filler.

## Failure modes

- **Connection refused / timeout:** `@seed/memory` on ren1 is down. Check
  `ssh ryanlowe@ren1.local 'launchctl list | grep seed.memory'`. If empty,
  `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.seed.memory.plist`.
- **400 error:** `k` out of range (must be 1–50), or missing `q`.
- **Empty results on a specific project but populated globally:** the
  project filter may be too narrow — retry with `--no-project`.

## Companion endpoints (not invoked by this skill)

- `GET /query?q=&project=&deep=` — synthesized answer (LLM call, slower)
- `GET /memories?project=` — list all stored memories
- `GET /entities?project=&type=` — list knowledge graph entities
- `GET /graph?entity=&project=` — graph neighborhood for an entity
- `POST /ingest` — write a new memory
