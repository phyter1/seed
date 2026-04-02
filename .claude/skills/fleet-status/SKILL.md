---
name: fleet-status
description: Check the health of all machines, services, and models across the Ren fleet.
argument-hint: [machine-name | "all"]
allowed-tools: Bash, Read
---

# Fleet Status

Get a real-time view of the Ren fleet — which machines are up, what services are running, what models are loaded, and what's broken.

## Arguments

- `$ARGUMENTS` is empty or `all` — full fleet report
- `$ARGUMENTS` is a machine name (`machine1`, `machine2`, `machine3`, `air`) — report for that machine only

## Execution

### Step 1: Determine which machine I'm on

```bash
hostname
```

### Step 2: Probe all machines (parallel, 3s timeout)

For each reachable machine, gather:

**Via SSH** (for machine1, machine2, machine3 — use appropriate SSH config):
```bash
# Machine health
ssh [-i ~/.ssh/ren_machine] $USER@<host>.local '
  echo "=== $(hostname) ===" &&
  echo "uptime: $(uptime)" &&
  echo "load: $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg 2>/dev/null)" &&
  echo "memory: $(vm_stat 2>/dev/null | head -5)" &&

  echo "=== SERVICES ===" &&
  launchctl list 2>/dev/null | grep -E "com\.(existential|ren-|memory-|cortex|nerve|agent-observatory|lexbox)" &&

  echo "=== MODELS ===" &&
  curl -s --connect-timeout 2 http://localhost:8080/v1/models 2>/dev/null | python3 -c "import sys,json; [print(f\"  MLX: {m[chr(105)+chr(100)]}\") for m in json.load(sys.stdin).get(chr(100)+chr(97)+chr(116)+chr(97),[])]" 2>/dev/null ||
  curl -s --connect-timeout 2 http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(f\"  Ollama: {m[chr(110)+chr(97)+chr(109)+chr(101)]}\") for m in json.load(sys.stdin).get(chr(109)+chr(111)+chr(100)+chr(101)+chr(108)+chr(115),[])]" 2>/dev/null ||
  echo "  (no model server)"
' 2>&1
```

**SSH connection rules:**
- `machine1`: `ssh -i ~/.ssh/fleet_key $USER@$MACHINE1` (or `ssh $USER@$MACHINE1` if key not found)
- `machine2`: `ssh -i ~/.ssh/fleet_key $USER@$MACHINE2` (or `ssh $USER@$MACHINE2` if key not found)
- `machine3`: `ssh $USER@$MACHINE3`
- If on the target machine already, just run locally.

### Step 3: Check network services (parallel, 3s timeout each)

```bash
# Fleet router
curl -s --connect-timeout 3 http://$MACHINE3:3000/health && echo "Fleet Router: UP" || echo "Fleet Router: DOWN"

# MLX server
curl -s --connect-timeout 3 http://$MACHINE3:8080/v1/models >/dev/null && echo "MLX Server: UP" || echo "MLX Server: DOWN"

# Ollama machine1
curl -s --connect-timeout 3 http://$MACHINE1:11434/api/tags >/dev/null && echo "Ollama machine1: UP" || echo "Ollama machine1: DOWN"

# Ollama machine2
curl -s --connect-timeout 3 http://$MACHINE2:11434/api/tags >/dev/null && echo "Ollama machine2: UP" || echo "Ollama machine2: DOWN"

# Memory agent
curl -s --connect-timeout 3 http://localhost:19888/health >/dev/null 2>&1 && echo "Memory Agent: UP" || echo "Memory Agent: DOWN"

# Nerve server
curl -s --connect-timeout 3 http://localhost:9999/health >/dev/null 2>&1 && echo "Nerve: UP" || echo "Nerve: DOWN"
```

### Step 4: Report

Format as a clean table:

```
Fleet Status — <timestamp>
Running on: <hostname>

| Machine | Status | CPU Load | Services | Models |
|---------|--------|----------|----------|--------|
| machine1    | UP     | 1.2      | 14 agents| Ollama: 9 models |
| machine2    | UP     | 0.8      | 3 agents | Ollama: 8 models |
| machine3    | UP     | 3.4      | 5 agents | MLX: 11 models |
| air     | LOCAL  | -        | -        | -      |

Network Services:
  Fleet Router (machine3:3000): DOWN
  MLX Server (machine3:8080):   UP
  Ollama machine1 (11434):      UP
  Ollama machine2 (11434):      UP
```

Flag anything unusual: high CPU, unreachable machines, services that should be running but aren't.
