# @seed/fleet-router

Rule-based fleet router backed by mlx-vlm, with crash-recovery supervision and jury aggregation.

## MLX runtime

The router spawns MLX via `mlx_vlm.server` (not `mlx_lm.server`). mlx-vlm serves
both the multimodal gemma4 models and standard text models like Qwen3.5 from
a single process, so ren3 runs exactly one MLX runtime. Thinking-mode for
Qwen3.5 is a per-request field — the router sends `enable_thinking` in each
request body instead of restarting the MLX server to toggle modes.

**Python deps on the host:** mlx-vlm requires `torch` and `torchvision` for
Qwen3.5's processor class. Install with:

```
pip3.11 install mlx mlx-vlm torch torchvision huggingface_hub
```

## Artifact builds

The router is deployed as a tarball workload. The tarball is **not committed** — `dist/` is gitignored, so the artifact is absent from fresh clones. Rebuild from source before a fresh install:

```
bash packages/inference/router/scripts/build-artifact.sh
```

This writes `dist/artifacts/fleet-router-<version>-<target>.tar.gz`, which is what `seed fleet workload install fleet-router` expects to stage.
