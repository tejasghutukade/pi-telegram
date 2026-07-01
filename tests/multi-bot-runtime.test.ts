/**
 * Regression tests for Telegram multi-bot runtime helpers
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramBotProfileManagePorts } from "../lib/multi-bot-runtime.ts";

function createMockRegistry(deps: {
  stopped?: number[];
  released?: number[];
}) {
  return {
    suspendForBot: async (botId: number) => {
      deps.stopped?.push(botId);
    },
    releaseLockForBot: (botId: number) => {
      deps.released?.push(botId);
      return undefined;
    },
  };
}

test("switchSessionProfile stops polling and releases lock for previous bot", async () => {
  const stopped: number[] = [];
  const released: number[] = [];
  let activeBotId = 111;
  const bindings: Record<string, string> = { "/work": "111" };
  const ports = createTelegramBotProfileManagePorts({
    getActiveBotId: () => activeBotId,
    switchSessionProfile: async (_cwd, botId) => {
      activeBotId = botId;
      bindings["/work"] = String(botId);
    },
    removeProfile: async () => {},
    getDocument: () => ({
      version: 2,
      profiles: {},
      sessionBindings: { ...bindings },
    }),
  });
  ports.registry = createMockRegistry({ stopped, released });
  await ports.switchSessionProfile("/work", 222);
  assert.deepEqual(stopped, [111]);
  assert.deepEqual(released, [111]);
});

test("switchSessionProfile keeps polling when another session still binds the bot", async () => {
  const stopped: number[] = [];
  const released: number[] = [];
  let activeBotId = 111;
  const ports = createTelegramBotProfileManagePorts({
    getActiveBotId: () => activeBotId,
    switchSessionProfile: async (_cwd, botId) => {
      activeBotId = botId;
    },
    removeProfile: async () => {},
    getDocument: () => ({
      version: 2,
      profiles: {},
      sessionBindings: {
        "/work": "222",
        "/personal": "111",
      },
    }),
  });
  ports.registry = createMockRegistry({ stopped, released });
  await ports.switchSessionProfile("/work", 222);
  assert.deepEqual(stopped, []);
  assert.deepEqual(released, []);
});

test("removeProfile stops polling and releases lock before deleting profile", async () => {
  const stopped: number[] = [];
  const released: number[] = [];
  const removed: number[] = [];
  const ports = createTelegramBotProfileManagePorts({
    getActiveBotId: () => 111,
    switchSessionProfile: async () => {},
    removeProfile: async (botId) => {
      removed.push(botId);
    },
  });
  ports.registry = createMockRegistry({ stopped, released });
  await ports.removeProfile(222);
  assert.deepEqual(stopped, [222]);
  assert.deepEqual(released, [222]);
  assert.deepEqual(removed, [222]);
});
