---
name: fleet-status
description: Check the health of all machines, services, and models across the fleet.
category: identity
invocable: false
argument-hint: [machine-name | "all"]
capabilities:
  - shell
  - read-files
---

# Fleet Status

Get a real-time view of the fleet — which machines are up, what services are running, what models are loaded, and what's broken.

## Arguments

- `$ARGUMENTS` is empty or `all` — full fleet report
- `$ARGUMENTS` is a machine name (`ren1`, `ren2`, `ren3`) — report for that machine only

## Execution

### Step 1: Fleet overview from control plane

```bash
seed fleet status
```

This returns machine ID, status, connected state, architecture, memory, agent version, and last seen time for every fleet machine. This is the primary source of truth for machine health.

### Step 2: Probe network services (parallel, 3s timeout each)

These direct HTTP probes check services the control plane doesn't monitor:

```bash
# Fleet router
curl -s --connect-timeout 3 http://ren3.local:3000/health && echo "Fleet Router: UP" || echo "Fleet Router: DOWN"

# MLX server
curl -s --connect-timeout 3 http://ren3.local:8080/v1/models >/dev/null && echo "MLX Server: UP" || echo "MLX Server: DOWN"

# Ollama ren1
curl -s --connect-timeout 3 http://ren1.local:11434/api/tags >/dev/null && echo "Ollama ren1: UP" || echo "Ollama ren1: DOWN"

# Ollama ren2
curl -s --connect-timeout 3 http://ren2.local:11434/api/tags >/dev/null && echo "Ollama ren2: UP" || echo "Ollama ren2: DOWN"

# Memory agent
curl -s --connect-timeout 3 http://localhost:19888/health >/dev/null 2>&1 && echo "Memory Agent: UP" || echo "Memory Agent: DOWN"

# Nerve server
curl -s --connect-timeout 3 http://localhost:9999/health >/dev/null 2>&1 && echo "Nerve: UP" || echo "Nerve: DOWN"
```

### Step 3: Probe loaded models (parallel, 3s timeout each)

```bash
# MLX models (ren3)
curl -s --connect-timeout 3 http://ren3.local:8080/v1/models 2>/dev/null | python3 -c "import sys,json; [print(f'  MLX: {m[\"id\"]}') for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || echo "  MLX: (unreachable)"

# Ollama models (ren1)
curl -s --connect-timeout 3 http://ren1.local:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(f'  Ollama: {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null || echo "  Ollama ren1: (unreachable)"

# Ollama models (ren2)
curl -s --connect-timeout 3 http://ren2.local:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(f'  Ollama: {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null || echo "  Ollama ren2: (unreachable)"
```

### Step 4: Report

Format as a clean table:

```
Fleet Status — <timestamp>
Running on: <hostname>

<paste seed fleet status output>

Network Services:
  Fleet Router (ren3:3000):  UP/DOWN
  MLX Server (ren3:8080):    UP/DOWN
  Ollama ren1 (11434):       UP/DOWN
  Ollama ren2 (11434):       UP/DOWN
  Memory Agent (19888):      UP/DOWN
  Nerve (9999):              UP/DOWN

Models:
  MLX: <model list>
  Ollama ren1: <model list>
  Ollama ren2: <model list>
```

Flag anything unusual: disconnected machines, version mismatches between agents, services that should be running but aren't.
