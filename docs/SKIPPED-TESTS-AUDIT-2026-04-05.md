# Skipped-Test Audit — 2026-04-05

**Scope:** `packages/fleet/control/`, `packages/memory/`, `packages/inference/router/` (the three packages gated by CI in `.github/workflows/test.yml`).

**Method:** Ripgrep across `*.test.ts` for every test-skip syntax supported by Bun / Jest / Vitest:

- `describe.skip(`, `it.skip(`, `test.skip(`
- `describe.only(`, `it.only(`, `test.only(`
- `.skipIf(` (Vitest / Bun conditional)
- `xtest(`, `xit(`, `xdescribe(` (Jest x-prefix aliases)
- `.todo(` (pending tests)
- `skip: true` object form

## Result

**Total skipped/pending tests across the three CI-covered packages: 0.**

| Package | Skip syntax found | Pending/todo | Only-focused |
|---|---|---|---|
| `packages/fleet/control` | 0 | 0 | 0 |
| `packages/memory` | 0 | 0 | 0 |
| `packages/inference/router` | 0 | 0 | 0 |

The only substring matches for `skip` / `only` in these test files are in test descriptions, assertion text, or result-object field names (e.g. `expect(data.skipped).toBe(0)`, `test("skips when fewer than 2 memories")`). No tests are currently being skipped at runtime.

A broader sweep of every `*.test.*` file across the whole repo (including the packages excluded from this audit's scope) found zero hits for any of the skip / only / skipIf / todo / x-prefix syntaxes. The codebase contains no skipped tests anywhere.

## Reconciliation with "~28 skipped tests" in prior handoffs

The orchestrator prompt and `HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md:82` describe "~28 `.skip`/`.only` directives" as silent debt. That claim does not match current code. Possibilities:

- The count was based on an earlier state that has since been cleaned up during the test-suite growth (281/0 in fleet/control, 104/0 in memory, router also passing — documented in the EPIC-010 follow-up).
- The count was inferred from a different signal (e.g. a `bun test` skipped-count printout for something other than `.skip()` calls) and doesn't reflect source-level directives.
- The count was approximate and now happens to be zero.

`git log -S".skip("` and `git log -S".only("` show no commits that ever added or removed these directives, which is consistent with the codebase having never used them.

## Bucket classification

Not applicable — no skipped tests to classify.

## Recommendations

1. **Do not file individual skipped-test issues.** There are none to file.
2. **Remove the "~28 skipped tests" line from the standing next-moves list.** It appears in `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md:82` and #5 of the recommended-next-moves list. The debt it describes does not exist in source.
3. **Add a CI guard rail.** A one-line check in `.github/workflows/test.yml` (e.g. `! grep -rnE "\.(skip|only|skipIf|todo)\(" packages/*/src/**/*.test.ts`) would turn the current zero-skip state into an invariant. Low priority, but cheap. File separately if wanted.
4. **If other packages get added to CI**, re-run this audit scoped to the new packages before gating them — this audit only covers the three currently in the matrix.
