#!/usr/bin/env python3
"""
Start the MLX VLM server with a memory limit that respects other MLX processes.

Checks the ren-stt server's /health endpoint to see how much memory Parakeet
is using, then caps this process to use only what's left (minus OS headroom).

Uses mlx-vlm (not mlx-lm): mlx-vlm serves both the multimodal gemma4 models
and standard text models like Qwen3.5 from a single process, so the router
only needs to manage one MLX runtime. Thinking-mode (for Qwen3.5) is a
per-request field — mlx_vlm.server's chat completions endpoint accepts
`enable_thinking` in the request body and defaults it to False.

Usage:
  python3 src/start-mlx-server.py                    # auto-detect limit
  python3 src/start-mlx-server.py --port 8080         # custom port
  python3 src/start-mlx-server.py --stt-url http://localhost:8222
"""

import argparse
import json
import urllib.request
import mlx.core as mx


def get_stt_memory(stt_url="http://localhost:8222"):
    """Check how much memory the STT server is using."""
    try:
        data = json.loads(urllib.request.urlopen(f"{stt_url}/health", timeout=2).read())
        mem = data.get("memory_bytes", 0)
        print(f"[mlx-server] STT server using {mem / 1e9:.1f}GB")
        return mem
    except Exception:
        print("[mlx-server] STT server not reachable — no memory reservation")
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--model", default="mlx-community/Qwen3.5-9B-MLX-4bit")
    parser.add_argument("--stt-url", default="http://localhost:8222")
    parser.add_argument("--headroom-gb", type=float, default=2.0, help="GB reserved for OS")
    args = parser.parse_args()

    total = mx.device_info()["memory_size"]
    stt_mem = get_stt_memory(args.stt_url)
    headroom = int(args.headroom_gb * 1e9)
    available = total - stt_mem - headroom

    if available < 2 * 1e9:
        print(f"[mlx-server] WARNING: only {available / 1e9:.1f}GB available — models may not fit")

    old_limit = mx.set_memory_limit(int(available))
    print(f"[mlx-server] Memory: {total / 1e9:.0f}GB total, {stt_mem / 1e9:.1f}GB STT, {headroom / 1e9:.0f}GB headroom")
    print(f"[mlx-server] Limit set: {available / 1e9:.1f}GB (was {old_limit / 1e9:.0f}GB)")
    print("[mlx-server] Runtime: mlx-vlm (thinking-mode controlled per-request)")

    # Start the MLX VLM server within this memory-limited process.
    import sys
    sys.argv = [
        "mlx_vlm.server",
        "--host", args.host,
        "--port", str(args.port),
        "--model", args.model,
    ]

    from mlx_vlm.server import main as server_main
    server_main()


if __name__ == "__main__":
    main()
