/**
 * Regression tests for Telegram multi-bot polling manager
 * Covers per-bot polling controller isolation in one π process
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramMultiPollingManager } from "../lib/polling-manager.ts";

test("Multi polling manager tracks active loops per bot id", async () => {
  const events: string[] = [];
  const manager = createTelegramMultiPollingManager({
    getBotId: () => 111,
    hasBotToken: () => true,
    deleteWebhook: async () => undefined,
    getUpdates: async () => [],
    persistConfig: async () => undefined,
    getConfig: () => ({ botToken: "token-a", lastUpdateId: 1 }),
    handleUpdate: async () => undefined,
    stopTypingLoop: () => undefined,
    updateStatus: () => undefined,
    createPollLoopDeps: (botId) => ({
      getConfig: () => ({ botToken: `token-${botId}`, lastUpdateId: 1 }),
      persistConfig: async () => undefined,
      deleteWebhook: async () => {
        events.push(`delete:${botId}`);
      },
      getUpdates: async (_body, signal) => {
        events.push(`poll:${botId}`);
        while (!signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return [];
      },
    }),
  });

  manager.start({ cwd: "/work" }, 111);
  assert.equal(manager.isActive(111), true);
  manager.start({ cwd: "/personal" }, 222);
  assert.equal(manager.isActive(222), true);
  assert.deepEqual(manager.getActiveBotIds().sort(), [111, 222]);

  await manager.stop(111);
  assert.equal(manager.isActive(111), false);
  assert.equal(manager.isActive(222), true);
  await manager.stop(222);
  assert.deepEqual(manager.getActiveBotIds(), []);
});
