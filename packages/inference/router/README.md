# @seed/fleet-router

Rule-based fleet router with MLX lifecycle supervision and jury aggregation.

## Artifact builds

The router is deployed as a tarball workload. The tarball is **not committed** — `dist/` is gitignored, so the artifact is absent from fresh clones. Rebuild from source before a fresh install:

```
bash packages/inference/router/scripts/build-artifact.sh
```

This writes `dist/artifacts/fleet-router-<version>-<target>.tar.gz`, which is what `seed fleet workload install fleet-router` expects to stage.
