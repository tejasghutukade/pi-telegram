/**
 * Regression tests for Telegram per-bot connection registry
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createTelegramBotConnectionCommandRuntime,
  createTelegramBotConnectionRegistry,
} from "../lib/bot-connections.ts";
import { getTelegramLockKey, readLocks } from "../lib/locks.ts";
import { createTelegramMultiPollingManager } from "../lib/polling-manager.ts";

function createTempLockPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-telegram-bot-connections-"));
  return { dir, path: join(dir, "locks.json") };
}

function createTestManager() {
  const events: string[] = [];
  const manager = createTelegramMultiPollingManager({
    getBotId: () => 111,
    hasBotToken: () => true,
    deleteWebhook: async () => undefined,
    getUpdates: async () => [],
    persistConfig: async () => undefined,
    getConfig: () => ({ botToken: "token" }),
    handleUpdate: async () => undefined,
    stopTypingLoop: () => undefined,
    updateStatus: () => undefined,
    createPollLoopDeps: (botId) => ({
      getConfig: () => ({ botToken: `token-${botId}` }),
      persistConfig: async () => undefined,
      deleteWebhook: async () => undefined,
      getUpdates: async (_body, signal) => {
        events.push(`start:${botId}`);
        while (!signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        events.push(`stop:${botId}`);
        return [];
      },
    }),
  });
  return { manager, events };
}

test("Bot connection registry connects and suspends only the bound bot", async () => {
  const temp = createTempLockPath();
  const bindings = new Map([
    ["/work", 111],
    ["/personal", 222],
  ]);
  const { manager, events } = createTestManager();
  try {
    const registry = createTelegramBotConnectionRegistry({
      getBotIdForCwd: (cwd) => bindings.get(cwd),
      hasBotToken: () => true,
      multiPollingManager: manager,
      updateStatus: () => undefined,
      locksPath: temp.path,
      pid: 10,
    });

    const work = await registry.connect({ cwd: "/work" });
    const personal = await registry.connect({ cwd: "/personal" });
    assert.equal(work.ok, true);
    assert.equal(personal.ok, true);
    assert.equal(registry.isPollingActive(111), true);
    assert.equal(registry.isPollingActive(222), true);

    await registry.suspendForCwd("/work");
    assert.equal(registry.isPollingActive(111), false);
    assert.equal(registry.isPollingActive(222), true);
    assert.match(events.join(","), /stop:111/);
    assert.match(events.join(","), /start:222/);
  } finally {
    await manager.stop();
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("Bot connection command runtime stops only the active session bot", async () => {
  const temp = createTempLockPath();
  const bindings = new Map([
    ["/work", 111],
    ["/personal", 222],
  ]);
  const { manager } = createTestManager();
  let activeCtx = { cwd: "/work" };
  try {
    const registry = createTelegramBotConnectionRegistry({
      getBotIdForCwd: (cwd) => bindings.get(cwd),
      hasBotToken: () => true,
      multiPollingManager: manager,
      updateStatus: () => undefined,
      locksPath: temp.path,
      pid: 10,
    });
    const commandRuntime = createTelegramBotConnectionCommandRuntime(registry, {
      get: () => activeCtx,
    });

    await registry.connect({ cwd: "/work" });
    await registry.connect({ cwd: "/personal" });
    await commandRuntime.stop();
    assert.equal(registry.isPollingActive(111), false);
    assert.equal(registry.isPollingActive(222), true);

    activeCtx = { cwd: "/personal" };
    await commandRuntime.stop();
    assert.equal(registry.isPollingActive(222), false);
  } finally {
    await manager.stop();
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("Bot connection registry suspendForBot stops polling by bot id", async () => {
  const temp = createTempLockPath();
  const { manager, events } = createTestManager();
  try {
    const registry = createTelegramBotConnectionRegistry({
      getBotIdForCwd: () => undefined,
      hasBotToken: () => true,
      multiPollingManager: manager,
      updateStatus: () => undefined,
      locksPath: temp.path,
      pid: 10,
    });
    manager.start({ cwd: "/work" }, 111);
    assert.equal(manager.isActive(111), true);
    await registry.suspendForBot(111);
    assert.equal(manager.isActive(111), false);
    assert.match(events.join(","), /stop:111/);
  } finally {
    await manager.stop();
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("Bot connection registry does not auto-start polling when autoConnect is false", async () => {
  const temp = createTempLockPath();
  const { manager, events } = createTestManager();
  try {
    const registry = createTelegramBotConnectionRegistry({
      getBotIdForCwd: () => 111,
      hasBotToken: () => true,
      shouldAutoConnectOnSessionStart: () => false,
      multiPollingManager: manager,
      updateStatus: () => undefined,
      locksPath: temp.path,
      pid: 10,
    });
    await registry.connect({ cwd: "/work" });
    await registry.suspendForCwd("/work");
    assert.equal(manager.isActive(111), false);
    const eventsBeforeResume = events.length;

    await registry.onSessionStart({}, { cwd: "/work" });
    assert.equal(manager.isActive(111), false);
    assert.equal(events.length, eventsBeforeResume);
  } finally {
    await manager.stop();
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("Bot connection registry releaseLockForBot releases owned lock", async () => {
  const temp = createTempLockPath();
  const { manager } = createTestManager();
  try {
    const registry = createTelegramBotConnectionRegistry({
      getBotIdForCwd: () => 111,
      hasBotToken: () => true,
      multiPollingManager: manager,
      updateStatus: () => undefined,
      locksPath: temp.path,
      pid: 10,
    });
    await registry.connect({ cwd: "/work" });
    assert.deepEqual(readLocks(temp.path)[getTelegramLockKey(111)], {
      pid: 10,
      cwd: "/work",
    });
    assert.equal(registry.releaseLockForBot(111), undefined);
    assert.equal(readLocks(temp.path)[getTelegramLockKey(111)], undefined);
  } finally {
    await manager.stop();
    rmSync(temp.dir, { recursive: true, force: true });
  }
});
