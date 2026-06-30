/**
 * Telegram bot-scoped session routing
 * Zones: telegram inbound, session routing, offline queue
 * Routes inbound updates to the active π session or durable offline queues for other bound sessions
 */

import * as Media from "./media.ts";
import type { TelegramProfileConfigStore } from "./config.ts";
import { botIdToProfileKey } from "./config.ts";
import type { createTelegramOfflineQueueStore } from "./offline-queue.ts";
import {
  appendTelegramOfflineQueueItem,
  readTelegramOfflineQueueDocument,
  writeTelegramOfflineQueueDocument,
} from "./offline-queue.ts";
import type { PendingTelegramTurn } from "./queue.ts";
import * as Turns from "./turns.ts";
import type { TelegramUpdate } from "./polling.ts";

export interface TelegramBotSessionRouterDeps<TUpdate, TContext> {
  configStore: Pick<
    TelegramProfileConfigStore,
    "findCwdForBot" | "withBotProfile" | "get"
  >;
  getContextCwd: (ctx: TContext) => string;
  defaultHandle: (update: TUpdate, ctx: TContext) => Promise<void>;
  offlineQueue: Pick<ReturnType<typeof createTelegramOfflineQueueStore>, "append">;
  sendOfflineNotice?: (
    botId: number,
    chatId: number,
    replyToMessageId: number,
    cwd: string,
  ) => Promise<void>;
  allocateOfflineQueueOrder?: () => number;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

function extractOfflinePromptTurn(
  update: TelegramUpdate & {
    message?: Media.TelegramMediaMessage & {
      chat: { id: number };
      message_id: number;
    };
    edited_message?: Media.TelegramMediaMessage & {
      chat: { id: number };
      message_id: number;
    };
  },
  queueOrder: number,
): PendingTelegramTurn | undefined {
  const message = update.message ?? update.edited_message;
  if (!message) return undefined;
  const text = Media.extractTelegramMessageText(message);
  if (!text) return undefined;
  const promptText = `[telegram] ${text}`;
  return {
    kind: "prompt",
    chatId: message.chat.id,
    replyToMessageId: message.message_id,
    sourceMessageIds: [message.message_id],
    queueOrder,
    queueLane: "default",
    laneOrder: queueOrder,
    queuedAttachments: [],
    content: [{ type: "text", text: promptText }],
    historyText: Turns.truncateTelegramQueueSummary(text),
    statusSummary: Turns.truncateTelegramQueueSummary(text),
  };
}

export function createTelegramBotSessionUpdateRouter<TUpdate, TContext>(
  deps: TelegramBotSessionRouterDeps<TUpdate, TContext>,
): (update: TUpdate, ctx: TContext, botId: number) => Promise<void> {
  let offlineQueueOrder = 0;
  const allocateOrder = () =>
    deps.allocateOfflineQueueOrder?.() ?? offlineQueueOrder++;
  return async (update, ctx, botId) => {
    const targetCwd = deps.configStore.findCwdForBot(botId);
    const currentCwd = deps.getContextCwd(ctx);
    if (targetCwd && targetCwd !== currentCwd) {
      const turn = extractOfflinePromptTurn(
        update as Parameters<typeof extractOfflinePromptTurn>[0],
        allocateOrder(),
      );
      if (turn) {
        try {
          await deps.offlineQueue.append(targetCwd, turn);
          const chatId = turn.chatId;
          const replyToMessageId = turn.replyToMessageId;
          if (deps.sendOfflineNotice) {
            await deps.sendOfflineNotice(
              botId,
              chatId,
              replyToMessageId,
              targetCwd,
            );
          }
        } catch (error) {
          deps.recordRuntimeEvent?.("offline-queue", error, {
            botId,
            targetCwd,
          });
        }
      }
      return;
    }
    await deps.configStore.withBotProfile(botId, () =>
      deps.defaultHandle(update, ctx),
    );
  };
}

export function findTelegramCwdForBot(
  bindings: Record<string, string>,
  botId: number,
): string | undefined {
  const key = botIdToProfileKey(botId);
  for (const [cwd, boundKey] of Object.entries(bindings)) {
    if (boundKey === key) return cwd;
  }
  return undefined;
}

export async function mergeTelegramOfflineQueueIntoSession<TContext>(
  cwd: string,
  deps: {
    offlineQueue: Pick<
      ReturnType<typeof createTelegramOfflineQueueStore>,
      "takeAll"
    >;
    getQueuedItems: () => PendingTelegramTurn[];
    setQueuedItems: (items: PendingTelegramTurn[]) => void;
    dispatchNextQueuedTelegramTurn: (ctx: TContext) => void;
    ctx: TContext;
    recordRuntimeEvent?: (
      category: string,
      error: unknown,
      details?: Record<string, unknown>,
    ) => void;
  },
): Promise<void> {
  try {
    const offlineItems = await deps.offlineQueue.takeAll(cwd);
    if (offlineItems.length === 0) return;
    deps.setQueuedItems([...deps.getQueuedItems(), ...offlineItems]);
    deps.dispatchNextQueuedTelegramTurn(deps.ctx);
  } catch (error) {
    deps.recordRuntimeEvent?.("offline-queue", error, { phase: "merge", cwd });
  }
}