import { getContext } from "../context";
import { log } from "../logger";
import { processJobsOnce } from "../services/jobs";

/**
 * BACKGROUND WORKER
 *
 * Every few seconds, while the app is running, this:
 *   - submits queued jobs to the provider,
 *   - checks on jobs that are running,
 *   - saves finished outputs.
 *
 * It starts automatically the first time any API route is used. If you close
 * the app while a job is running, the job is picked up again on the next start
 * (the provider's request ID is saved in the database).
 *
 * Later, this can be replaced by a dedicated queue (e.g. BullMQ, or provider
 * webhooks) without changing the job service.
 */

const INTERVAL_MS = 4000;

type WorkerState = { timer?: ReturnType<typeof setInterval>; running: boolean };
const state: WorkerState = ((globalThis as Record<string, unknown>).__fashionWorker ??= { running: false }) as WorkerState;

export async function workerTick() {
  if (state.running) return; // previous tick still busy
  state.running = true;
  try {
    const ctx = await getContext();
    await processJobsOnce(ctx);
  } catch (err) {
    log.error("Background worker tick failed", err);
  } finally {
    state.running = false;
  }
}

export function ensureWorkerStarted() {
  if (process.env.VITEST || state.timer) return;
  state.timer = setInterval(() => void workerTick(), INTERVAL_MS);
  state.timer.unref?.();
  log.info("Background job worker started.");
}
