/**
 * Telegram multi-bot polling manager
 * Zones: telegram transport, polling runtime
 * Owns per-bot polling controller state for concurrent bot connections in one π process
 */

import type { TelegramProfileConfigStore } from "./config.ts";
import type { TelegramPollingConfig, TelegramUpdate } from "./polling.ts";
import {
  createTelegramPollingControllerRuntime,
  createTelegramPollingControllerState,
  type TelegramPollingController,
  type TelegramPollingControllerRuntimeDeps,
  type TelegramPollingControllerState,
} from "./polling.ts";
import type { TelegramBridgeApiRuntime } from "./telegram-api.ts";
import { createDefaultTelegramBridgeApiRuntime } from "./telegram-api.ts";

export interface TelegramMultiPollingManagerDeps<
  TUpdate extends TelegramUpdate,
  TContext,
> extends Omit<
  TelegramPollingControllerRuntimeDeps<TUpdate, TContext>,
  "state" | "handleUpdate"
> {
  getBotId: () => number | undefined;
  handleUpdate: (
    update: TUpdate,
    ctx: TContext,
    botId: number,
  ) => Promise<void>;
  createPollLoopDeps?: (
    botId: number,
  ) => Pick<
    TelegramPollingControllerRuntimeDeps<TUpdate, TContext>,
    "getConfig" | "persistConfig" | "getUpdates" | "deleteWebhook"
  >;
}

export interface TelegramMultiPollingManager<TContext> {
  isActive: (botId?: number) => boolean;
  getActiveBotIds: () => number[];
  start: (ctx: TContext, botId: number) => void;
  stop: (botId?: number) => Promise<void>;
  suspend: (botId?: number) => Promise<void>;
}

export interface TelegramProfilePollingRuntime<TContext> {
  isActive: () => boolean;
  start: (ctx: TContext) => void;
  stop: () => Promise<void>;
}

export interface TelegramProfilePollingRuntimeDeps<
  TUpdate extends TelegramUpdate,
  TContext,
> {
  configStore: Pick<
    TelegramProfileConfigStore,
    | "getActiveBotId"
    | "hasBotToken"
    | "getProfile"
    | "mutateProfile"
    | "persist"
    | "get"
  >;
  recordRuntimeEvent: Parameters<
    typeof createDefaultTelegramBridgeApiRuntime
  >[0]["recordRuntimeEvent"];
  handleUpdate: TelegramPollingControllerRuntimeDeps<
    TUpdate,
    TContext
  >["handleUpdate"];
  stopTypingLoop: () => unknown;
  updateStatus: TelegramPollingControllerRuntimeDeps<
    TUpdate,
    TContext
  >["updateStatus"];
  createBridgeApiRuntime?: (
    getBotToken: () => string | undefined,
  ) => Pick<TelegramBridgeApiRuntime, "deleteWebhook" | "getUpdates">;
}

function createPerBotApiRuntime(
  botId: number,
  cache: Map<number, Pick<TelegramBridgeApiRuntime, "deleteWebhook" | "getUpdates">>,
  deps: TelegramProfilePollingRuntimeDeps<TelegramUpdate, unknown>,
): Pick<TelegramBridgeApiRuntime, "deleteWebhook" | "getUpdates"> {
  const existing = cache.get(botId);
  if (existing) return existing;
  const getBotToken = () => deps.configStore.getProfile(botId)?.botToken;
  const runtime =
    deps.createBridgeApiRuntime?.(getBotToken) ??
    createDefaultTelegramBridgeApiRuntime({
      getBotToken,
      recordRuntimeEvent: deps.recordRuntimeEvent,
    });
  cache.set(botId, runtime);
  return runtime;
}

function createPerBotPollingConfig(
  botId: number,
  cache: Map<number, TelegramPollingConfig>,
  deps: TelegramProfilePollingRuntimeDeps<TelegramUpdate, unknown>,
): TelegramPollingConfig {
  if (!cache.has(botId)) {
    const profile = deps.configStore.getProfile(botId) ?? {};
    cache.set(botId, {
      botToken: profile.botToken,
      lastUpdateId: profile.lastUpdateId,
    });
  }
  return cache.get(botId)!;
}

export function createTelegramPollingActivityBridge(): {
  read: () => boolean;
  bind: (isActive: () => boolean) => void;
} {
  let reader: () => boolean = () => false;
  return {
    read: () => reader(),
    bind: (isActive) => {
      reader = isActive;
    },
  };
}

export function createTelegramProfilePollingRuntime<
  TUpdate extends TelegramUpdate,
  TContext,
>(
  deps: TelegramProfilePollingRuntimeDeps<TUpdate, TContext>,
): TelegramProfilePollingRuntime<TContext> {
  const perBotPollingConfigs = new Map<number, TelegramPollingConfig>();
  const perBotApiRuntimes = new Map<
    number,
    Pick<TelegramBridgeApiRuntime, "deleteWebhook" | "getUpdates">
  >();
  const sharedDeps = deps as TelegramProfilePollingRuntimeDeps<
    TelegramUpdate,
    unknown
  >;
  const manager = createTelegramMultiPollingManager<TUpdate, TContext>({
    getBotId: () => deps.configStore.getActiveBotId(),
    hasBotToken: () => deps.configStore.hasBotToken(),
    deleteWebhook: async () => undefined,
    getUpdates: async () => [],
    persistConfig: () => deps.configStore.persist(),
    getConfig: () => deps.configStore.get(),
    handleUpdate: (update, ctx, botId) => deps.handleUpdate(update, ctx),
    stopTypingLoop: deps.stopTypingLoop,
    updateStatus: deps.updateStatus,
    recordRuntimeEvent: deps.recordRuntimeEvent as NonNullable<
      TelegramMultiPollingManagerDeps<TUpdate, TContext>["recordRuntimeEvent"]
    >,
    createPollLoopDeps: (botId) => {
      const api = createPerBotApiRuntime(botId, perBotApiRuntimes, sharedDeps);
      return {
        getConfig: () =>
          createPerBotPollingConfig(botId, perBotPollingConfigs, sharedDeps),
        persistConfig: async () => {
          const pollingConfig = perBotPollingConfigs.get(botId);
          if (!pollingConfig) return;
          await deps.configStore.mutateProfile(botId, (profile) => {
            profile.lastUpdateId = pollingConfig.lastUpdateId;
          });
        },
        deleteWebhook: api.deleteWebhook,
        getUpdates: api.getUpdates as TelegramPollingControllerRuntimeDeps<
          TUpdate,
          TContext
        >["getUpdates"],
      };
    },
  });
  return {
    isActive: () => {
      const botId = deps.configStore.getActiveBotId();
      return botId !== undefined && manager.isActive(botId);
    },
    start: (ctx) => {
      const botId = deps.configStore.getActiveBotId();
      if (botId === undefined) return;
      manager.start(ctx, botId);
    },
    stop: () => manager.stop(),
  };
}

export function createTelegramMultiPollingManager<
  TUpdate extends TelegramUpdate,
  TContext,
>(
  deps: TelegramMultiPollingManagerDeps<TUpdate, TContext>,
): TelegramMultiPollingManager<TContext> {
  const controllers = new Map<number, TelegramPollingController<TContext>>();
  const states = new Map<number, TelegramPollingControllerState>();

  const getController = (botId: number): TelegramPollingController<TContext> => {
    const existing = controllers.get(botId);
    if (existing) return existing;
    const state = createTelegramPollingControllerState();
    states.set(botId, state);
    const botDeps = deps.createPollLoopDeps?.(botId);
    const controller = createTelegramPollingControllerRuntime<TUpdate, TContext>({
      ...deps,
      ...botDeps,
      state,
      handleUpdate: (update, ctx) => deps.handleUpdate(update, ctx, botId),
    });
    controllers.set(botId, controller);
    return controller;
  };

  const resolveBotId = (botId?: number): number | undefined => {
    if (botId !== undefined) return botId;
    return deps.getBotId();
  };

  return {
    isActive: (botId) => {
      const resolved = resolveBotId(botId);
      if (resolved === undefined) return false;
      return controllers.get(resolved)?.isActive() ?? false;
    },
    getActiveBotIds: () =>
      [...controllers.entries()]
        .filter(([, controller]) => controller.isActive())
        .map(([id]) => id),
    start: (ctx, botId) => {
      getController(botId).start(ctx);
    },
    stop: async (botId) => {
      const resolved = resolveBotId(botId);
      if (resolved === undefined) {
        await Promise.all([...controllers.values()].map((c) => c.stop()));
        return;
      }
      await controllers.get(resolved)?.stop();
    },
    suspend: async (botId) => {
      await (async () => {
        const resolved = resolveBotId(botId);
        if (resolved === undefined) {
          await Promise.all([...controllers.values()].map((c) => c.stop()));
          return;
        }
        await controllers.get(resolved)?.stop();
      })();
    },
  };
}
