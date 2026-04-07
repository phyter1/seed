/**
 * Machine queue dispatch — serialized inference per machine.
 *
 * Pure queue/concurrency utilities extracted from router.ts. The ensureQueue
 * function is injected as a parameter for testability (dependency injection
 * instead of module-level import).
 */

import type { MachineQueue } from "./state";

export type EnsureQueueFn = (machine: string) => MachineQueue;

/**
 * Run `fn` within the per-machine queue, serializing concurrent calls to the
 * same machine. Increments depth on entry, decrements on exit.
 */
export function withMachineQueue<T>(machine: string, fn: () => Promise<T>, ensureQueue: EnsureQueueFn): Promise<T> {
  const q = ensureQueue(machine);
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const previous = q.promise;
  q.promise = next;
  q.depth++;
  return previous.then(fn).finally(() => { q.depth--; release(); });
}

/**
 * Pick the machine with the lowest queue depth from the candidates, then
 * pre-increment its depth so subsequent callers see the updated load.
 */
export function pickIdlestMachine(candidates: string[], ensureQueue: EnsureQueueFn): string {
  let best = candidates[0];
  let bestDepth = ensureQueue(best).depth;
  for (const m of candidates) {
    const depth = ensureQueue(m).depth;
    if (depth < bestDepth) {
      best = m;
      bestDepth = depth;
    }
  }
  ensureQueue(best).depth++;
  return best;
}

/**
 * Run `fn` within the per-machine queue for a machine whose depth was already
 * incremented by `pickIdlestMachine`. Decrements depth on exit.
 */
export function withPrePickedQueue<T>(machine: string, fn: () => Promise<T>, ensureQueue: EnsureQueueFn): Promise<T> {
  const q = ensureQueue(machine);
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const previous = q.promise;
  q.promise = next;
  return previous.then(fn).finally(() => { q.depth--; release(); });
}
