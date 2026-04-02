---
name: fleet-inference
description: Query any model across the fleet — local (MLX, Ollama) or cloud (Cerebras, Groq, Gemini, OpenRouter). Direct connections, no queue. Use for any task that doesn't need a frontier model.
argument-hint: <prompt> | models | provider:<name> <prompt> | model:<id> <prompt>
allowed-tools: Bash, Read
---

# Fleet Inference

Direct access to every model in the fleet — local and cloud. All endpoints are OpenAI-compatible.

## Configuration

Fleet machines and cloud credentials are configurable:

- **Fleet machines:** Configure hostnames per your deployment.
- **Cloud API keys:** Store at `~/.config/fleet/keys.json` (or set `FLEET_KEYS_PATH` env var):
  ```json
  {
    "cerebras": {"api_key": "..."},
    "groq": {"api_key": "..."},
    "gemini": {"api_key": "..."},
    "openrouter": {"api_key": "..."}
  }
  ```

## Arguments

- `models` — discover all reachable models across every provider
- `<prompt>` — auto-route to the best available provider
- `provider:<name> <prompt>` — target a specific provider (mlx, ollama, cerebras, groq, gemini, openrouter)
- `model:<id> <prompt>` — target a specific model on its native endpoint

## Providers

### Local Fleet ($0, private, nothing leaves the LAN)

#### MLX (Apple Silicon — fastest local, 30-81 tok/s)

Endpoint: `http://<mlx-host>:8080/v1/chat/completions`

```bash
MLX_HOST="${MLX_HOST:-localhost}"

curl -s http://$MLX_HOST:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mlx-community/Qwen3.5-9B-MLX-4bit",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content`

**Example MLX models:**
- `mlx-community/Qwen3.5-9B-MLX-4bit` — general-purpose, reasoning (~30 tok/s)
- `mlx-community/Qwen3-8B-4bit` — good all-rounder (~32 tok/s)
- `mlx-community/Qwen2.5-Coder-7B-Instruct-4bit` — code specialist (~25 tok/s)
- `mlx-community/Phi-4-mini-instruct-4bit` — math/logic (~65 tok/s)
- `mlx-community/Llama-3.2-3B-Instruct-4bit` — fast classification (~81 tok/s)
- `mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit-mlx` — code
- `mlx-community/DeepSeek-V2-Lite-Chat-4bit-mlx` — chat

**Note:** One model at a time on constrained-memory machines. The MLX server auto-swaps — request any model and it loads. Takes ~10s to swap.

#### Ollama (any machine — 5-32 tok/s)

Endpoint: `http://<ollama-host>:11434/api/chat`

```bash
OLLAMA_HOST="${OLLAMA_HOST:-localhost}"

curl -s http://$OLLAMA_HOST:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "stream": false,
    "options": {"temperature": 0.7, "num_predict": 2048}
  }'
```

**Parse response:** `json.message.content`

**List live models:** `curl -s http://$OLLAMA_HOST:11434/api/tags | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin)['models']]"`

#### Fleet Router (auto-routes to best model)

If you have a fleet router running:

```bash
ROUTER_HOST="${ROUTER_HOST:-localhost}"

curl -s http://$ROUTER_HOST:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content` (also check `json._routing` for which model was selected and why)

---

### Cloud Providers (free tiers, data leaves the LAN)

Credentials at `~/.config/fleet/keys.json` (or `$FLEET_KEYS_PATH`).

#### Cerebras (fastest cloud — free tier)

```bash
KEYS_PATH="${FLEET_KEYS_PATH:-$HOME/.config/fleet/keys.json}"

curl -s https://api.cerebras.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(jq -r .cerebras.api_key $KEYS_PATH)" \
  -d '{
    "model": "llama-4-scout-17b-16e-instruct",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content`

**Available models:** `llama-4-scout-17b-16e-instruct`, `llama-3.3-70b`, `qwen-3-32b`
**Rate limits:** ~30 RPM free tier. Extremely fast inference.

#### Groq (fast cloud — free tier)

```bash
KEYS_PATH="${FLEET_KEYS_PATH:-$HOME/.config/fleet/keys.json}"

curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(jq -r .groq.api_key $KEYS_PATH)" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content`

**Available models:** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `gemma2-9b-it`, `mixtral-8x7b-32768`, `qwen-qwq-32b`
**Rate limits:** 30 RPM, 6000 RPD free tier.

#### Gemini (free tier — 250 req/day)

```bash
KEYS_PATH="${FLEET_KEYS_PATH:-$HOME/.config/fleet/keys.json}"

curl -s "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(jq -r .gemini.api_key $KEYS_PATH)" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content`

**Available models:** `gemini-2.5-flash`, `gemini-2.5-pro` (lower rate limit)
**Rate limits:** 250 requests/day free tier. Best free-tier quality.

#### OpenRouter (cheap, many models)

```bash
KEYS_PATH="${FLEET_KEYS_PATH:-$HOME/.config/fleet/keys.json}"

curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(jq -r .openrouter.api_key $KEYS_PATH)" \
  -d '{
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "messages": [{"role": "user", "content": "YOUR_PROMPT"}],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

**Parse response:** `json.choices[0].message.content`

**Available free models:** `meta-llama/llama-3.3-70b-instruct:free`, `google/gemma-2-9b-it:free`, `qwen/qwen-2.5-72b-instruct:free`
**Rate limits:** Varies by model. Check headers.

---

## Routing Priority

When auto-routing (no specific provider requested):

1. **Code tasks** — Ollama code-specialist model (local, best code model)
2. **Fast classification/extraction** — MLX fast models (81/65 tok/s)
3. **General reasoning** — MLX general model (best general, 30 tok/s)
4. **Deep reasoning** — Ollama reasoning model (30B, slow but thorough)
5. **If local fleet unreachable** — Cerebras (fastest cloud), then Groq, then Gemini
6. **If everything fails** — report what's down

Probe endpoints with 3s timeout before routing. Prefer local ($0, private) over cloud.

## Listing Models

For `models` argument, probe all endpoints in parallel:

```bash
MLX_HOST="${MLX_HOST:-localhost}"
OLLAMA_HOSTS="${OLLAMA_HOSTS:-localhost}"
KEYS_PATH="${FLEET_KEYS_PATH:-$HOME/.config/fleet/keys.json}"

echo "=== MLX ===" && curl -s --connect-timeout 3 http://$MLX_HOST:8080/v1/models 2>/dev/null | python3 -c "import sys,json; [print(f'  {m[\"id\"]}') for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || echo "  (unreachable)"

for host in $OLLAMA_HOSTS; do
  echo "=== Ollama ($host) ===" && curl -s --connect-timeout 3 http://$host:11434/api/tags 2>/dev/null | python3 -c "import sys,json; [print(f'  {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null || echo "  (unreachable)"
done

echo "=== Cerebras ===" && curl -s --connect-timeout 3 https://api.cerebras.ai/v1/models -H "Authorization: Bearer $(jq -r .cerebras.api_key $KEYS_PATH)" 2>/dev/null | python3 -c "import sys,json; [print(f'  {m[\"id\"]}') for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || echo "  (unreachable)"

echo "=== Groq ===" && curl -s --connect-timeout 3 https://api.groq.com/openai/v1/models -H "Authorization: Bearer $(jq -r .groq.api_key $KEYS_PATH)" 2>/dev/null | python3 -c "import sys,json; [print(f'  {m[\"id\"]}') for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || echo "  (unreachable)"
```

## Error Handling

- Unreachable endpoint — silently fall through to next provider
- All providers down — report which are down and suggest fixes
- Rate limited — report the limit and try next provider
- Credentials missing — report which key is missing from the keys file
