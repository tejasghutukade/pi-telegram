/**
 * Regression tests for Telegram bot session routing
 */

import assert from "node:assert/strict";
import test from "node:test";

import { findTelegramCwdForBot } from "../lib/session-router.ts";
import { createTelegramBotSessionUpdateRouter } from "../lib/session-router.ts";

test("findTelegramCwdForBot resolves cwd from session bindings", () => {
  assert.equal(
    findTelegramCwdForBot(
      { "/work": "111", "/personal": "222" },
      222,
    ),
    "/personal",
  );
});

test("Bot session router stashes cross-session text updates offline", async () => {
  const events: string[] = [];
  const offlineItems: Array<{ cwd: string; text: string }> = [];
  const router = createTelegramBotSessionUpdateRouter({
    configStore: {
      findCwdForBot: (botId) => (botId === 111 ? "/work" : undefined),
      withBotProfile: async (_botId, run) => run(),
      get: () => ({}),
    },
    getContextCwd: () => "/personal",
    defaultHandle: async () => {
      events.push("active");
    },
    offlineQueue: {
      append: async (cwd, item) => {
        offlineItems.push({
          cwd,
          text: item.content[0]?.type === "text" ? item.content[0].text : "",
        });
      },
    },
    sendOfflineNotice: async () => {
      events.push("notice");
    },
  });
  await router(
    {
      update_id: 1,
      message: {
        message_id: 9,
        chat: { id: 42 },
        text: "ship it",
      },
    },
    { cwd: "/personal" },
    111,
  );
  assert.deepEqual(events, ["notice"]);
  assert.deepEqual(offlineItems, [
    { cwd: "/work", text: "[telegram] ship it" },
  ]);
});

test("Bot session router handles active session updates normally", async () => {
  const events: string[] = [];
  const router = createTelegramBotSessionUpdateRouter({
    configStore: {
      findCwdForBot: () => "/work",
      withBotProfile: async (_botId, run) => {
        events.push("profile");
        return run();
      },
      get: () => ({}),
    },
    getContextCwd: () => "/work",
    defaultHandle: async () => {
      events.push("active");
    },
    offlineQueue: {
      append: async () => {
        events.push("offline");
      },
    },
  });
  await router(
    {
      update_id: 2,
      message: {
        message_id: 10,
        chat: { id: 42 },
        text: "go",
      },
    },
    { cwd: "/work" },
    111,
  );
  assert.deepEqual(events, ["profile", "active"]);
});
