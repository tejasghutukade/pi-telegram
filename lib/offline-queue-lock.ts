/**
 * Telegram offline queue file locking
 * Zones: filesystem, telegram queue
 * Serializes cross-process read-modify-write on telegram-offline-queues.json
 */

import { open, readFile, unlink } from "node:fs/promises";

import { isProcessAlive } from "./locks.ts";

const LOCK_RETRY_MS = 25;
const LOCK_MAX_ATTEMPTS = 200;

async function releaseOfflineQueueLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // ignore missing lock
  }
}

export async function acquireTelegramOfflineQueueLock(
  lockPath: string,
): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => releaseOfflineQueueLock(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const raw = await readFile(lockPath, "utf8");
        const pid = Number.parseInt(raw.trim(), 10);
        if (!Number.isFinite(pid) || !isProcessAlive(pid)) {
          await releaseOfflineQueueLock(lockPath);
          continue;
        }
      } catch {
        await releaseOfflineQueueLock(lockPath);
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  throw new Error("Timed out waiting for Telegram offline queue lock");
}

export function isTelegramOfflineQueueLockTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Timed out waiting for Telegram offline queue lock"
  );
}

export async function withTelegramOfflineQueueLock<T>(
  queuePath: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquireTelegramOfflineQueueLock(`${queuePath}.lock`);
  try {
    return await run();
  } finally {
    await release();
  }
}
