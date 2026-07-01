/**
 * Telegram offline session queue persistence
 * Zones: telegram queue, filesystem, session routing
 * Owns durable prompt queues for Telegram turns received while another π session is active
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { withTelegramOfflineQueueLock } from "./offline-queue-lock.ts";
import type { PendingTelegramTurn } from "./queue.ts";

export interface TelegramOfflineQueueDocument {
  version: 1;
  queues: Record<string, PendingTelegramTurn[]>;
}

const OFFLINE_QUEUE_VERSION = 1;

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? resolve(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
}

export function getTelegramOfflineQueuePath(agentDir = getAgentDir()): string {
  return join(agentDir, "telegram-offline-queues.json");
}

function createEmptyOfflineQueueDocument(): TelegramOfflineQueueDocument {
  return { version: OFFLINE_QUEUE_VERSION, queues: {} };
}

export async function readTelegramOfflineQueueDocument(
  path = getTelegramOfflineQueuePath(),
): Promise<TelegramOfflineQueueDocument> {
  if (!existsSync(path)) return createEmptyOfflineQueueDocument();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as
      | TelegramOfflineQueueDocument
      | undefined;
    if (
      parsed?.version === OFFLINE_QUEUE_VERSION &&
      parsed.queues &&
      typeof parsed.queues === "object"
    ) {
      return {
        version: OFFLINE_QUEUE_VERSION,
        queues: { ...parsed.queues },
      };
    }
  } catch {
    // ignore corrupt file
  }
  return createEmptyOfflineQueueDocument();
}

export async function writeTelegramOfflineQueueDocument(
  document: TelegramOfflineQueueDocument,
  path = getTelegramOfflineQueuePath(),
): Promise<void> {
  const agentDir = resolve(path, "..");
  await mkdir(agentDir, { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(document, null, "\t")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, path);
}

export function getTelegramOfflineQueueItems(
  document: TelegramOfflineQueueDocument,
  cwd: string,
): PendingTelegramTurn[] {
  return [...(document.queues[cwd] ?? [])];
}

export function setTelegramOfflineQueueItems(
  document: TelegramOfflineQueueDocument,
  cwd: string,
  items: PendingTelegramTurn[],
): TelegramOfflineQueueDocument {
  const queues = { ...document.queues };
  if (items.length === 0) delete queues[cwd];
  else queues[cwd] = [...items];
  return { version: OFFLINE_QUEUE_VERSION, queues };
}

export function appendTelegramOfflineQueueItem(
  document: TelegramOfflineQueueDocument,
  cwd: string,
  item: PendingTelegramTurn,
): TelegramOfflineQueueDocument {
  const queues = { ...document.queues };
  queues[cwd] = [...(queues[cwd] ?? []), item];
  return { version: OFFLINE_QUEUE_VERSION, queues };
}

export function clearTelegramOfflineQueue(
  document: TelegramOfflineQueueDocument,
  cwd: string,
): TelegramOfflineQueueDocument {
  if (!document.queues[cwd]) return document;
  const queues = { ...document.queues };
  delete queues[cwd];
  return { version: OFFLINE_QUEUE_VERSION, queues };
}

export function createTelegramOfflineQueueStore(options: {
  agentDir?: string;
  path?: string;
} = {}) {
  const path =
    options.path ??
    getTelegramOfflineQueuePath(options.agentDir ?? getAgentDir());
  return {
    path,
    read: () => readTelegramOfflineQueueDocument(path),
    append: async (cwd: string, item: PendingTelegramTurn) => {
      await withTelegramOfflineQueueLock(path, async () => {
        const document = await readTelegramOfflineQueueDocument(path);
        await writeTelegramOfflineQueueDocument(
          appendTelegramOfflineQueueItem(document, cwd, item),
          path,
        );
      });
    },
    takeAll: async (cwd: string) => {
      return withTelegramOfflineQueueLock(path, async () => {
        const document = await readTelegramOfflineQueueDocument(path);
        const items = getTelegramOfflineQueueItems(document, cwd);
        if (items.length === 0) return items;
        await writeTelegramOfflineQueueDocument(
          clearTelegramOfflineQueue(document, cwd),
          path,
        );
        return items;
      });
    },
    drainForCwd: async (cwd: string) => {
      return withTelegramOfflineQueueLock(path, async () => {
        const document = await readTelegramOfflineQueueDocument(path);
        const items = getTelegramOfflineQueueItems(document, cwd);
        if (items.length === 0) return items;
        await writeTelegramOfflineQueueDocument(
          clearTelegramOfflineQueue(document, cwd),
          path,
        );
        return items;
      });
    },
    restoreForCwd: async (cwd: string, items: PendingTelegramTurn[]) => {
      if (items.length === 0) return;
      await withTelegramOfflineQueueLock(path, async () => {
        const document = await readTelegramOfflineQueueDocument(path);
        const concurrent = document.queues[cwd] ?? [];
        await writeTelegramOfflineQueueDocument(
          setTelegramOfflineQueueItems(document, cwd, [
            ...items,
            ...concurrent,
          ]),
          path,
        );
      });
    },
  };
}
