/**
 * Regression tests for Telegram offline session queues
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendTelegramOfflineQueueItem,
  createTelegramOfflineQueueStore,
} from "../lib/offline-queue.ts";

test("Offline queue store persists prompt turns per session cwd", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-telegram-offline-"));
  const path = join(agentDir, "telegram-offline-queues.json");
  const store = createTelegramOfflineQueueStore({ agentDir, path });
  const turn = {
    kind: "prompt" as const,
    chatId: 1,
    replyToMessageId: 2,
    sourceMessageIds: [2],
    queueOrder: 0,
    queueLane: "default" as const,
    laneOrder: 0,
    queuedAttachments: [],
    content: [{ type: "text" as const, text: "[telegram] hello" }],
    historyText: "hello",
    statusSummary: "hello",
  };
  await store.append("/work", turn);
  const items = await store.takeAll("/work");
  assert.deepEqual(items, [turn]);
  const document = JSON.parse(await readFile(path, "utf8")) as {
    queues: Record<string, unknown[]>;
  };
  assert.equal(document.queues["/work"], undefined);
});

test("appendTelegramOfflineQueueItem keeps unrelated session queues", () => {
  const document = appendTelegramOfflineQueueItem(
    { version: 1, queues: {} },
    "/work",
    {
      kind: "prompt",
      chatId: 1,
      replyToMessageId: 2,
      sourceMessageIds: [2],
      queueOrder: 0,
      queueLane: "default",
      laneOrder: 0,
      queuedAttachments: [],
      content: [{ type: "text", text: "a" }],
      historyText: "a",
      statusSummary: "a",
    },
  );
  const next = appendTelegramOfflineQueueItem(document, "/personal", {
    kind: "prompt",
    chatId: 1,
    replyToMessageId: 3,
    sourceMessageIds: [3],
    queueOrder: 1,
    queueLane: "default",
    laneOrder: 1,
    queuedAttachments: [],
    content: [{ type: "text", text: "b" }],
    historyText: "b",
    statusSummary: "b",
  });
  assert.equal(next.queues["/work"]?.length, 1);
  assert.equal(next.queues["/personal"]?.length, 1);
});
