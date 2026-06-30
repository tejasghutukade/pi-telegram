/**
 * Telegram multi-bot bridge runtime composition
 * Zones: telegram transport, locks, polling, session routing
 * Wires per-bot polling, connection registry, and bot-scoped update routing for same-process multi-bot
 */

import type * as BotConnections from "./bot-connections.ts";
import * as BotConnectionsModule from "./bot-connections.ts";
import type { TelegramProfileConfigStore } from "./config.ts";
import type { TelegramMultiPollingManager } from "./polling-manager.ts";
import * as PollingManager from "./polling-manager.ts";
import * as SessionRouter from "./session-router.ts";
import * as TelegramApi from "./telegram-api.ts";
import * as Updates from "./updates.ts";
import type { createTelegramOfflineQueueStore } from "./offline-queue.ts";

export interface TelegramMultiBotBridgeRuntimeDeps<
  TContext extends { cwd: string },
> {
  configStore: TelegramProfileConfigStore;
  getBotIdForCwd: (cwd: string) => number | undefined;
  offlineQueue: ReturnType<typeof createTelegramOfflineQueueStore>;
  inboundHandleUpdate: (
    update: unknown,
    ctx: TContext,
  ) => Promise<void>;
  getContextCwd: (ctx: TContext) => string;
  canStartPolling: (ctx: TContext) => boolean;
  formatStartBlockedMessage: (ctx: TContext) => string;
  contextStore: { get: () => TContext | undefined };
  stopTypingLoop: () => unknown;
  updateStatus: (ctx: TContext, error?: string) => void;
  recordRuntimeEvent: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
  statusBridges: {
    pollingActivity: ReturnType<
      typeof PollingManager.createTelegramPollingActivityBridge
    >;
    lockStatusBridge: { read: () => string };
  };
}

export interface TelegramMultiBotBridgeRuntime<
  TContext extends { cwd: string },
> {
  multiPollingManager: TelegramMultiPollingManager<TContext>;
  botConnectionRegistry: BotConnections.TelegramBotConnectionRuntime<TContext>;
  botConnectionRuntime: BotConnections.TelegramBotConnectionRuntime<TContext>;
  botRoutedUpdateHandle: (
    update: unknown,
    ctx: TContext,
    botId: number,
  ) => Promise<void>;
  pollingActivity: ReturnType<
    typeof PollingManager.createTelegramPollingActivityBridge
  >;
  lockStatusBridge: { read: () => string };
  ownsTelegramDirectDelivery: () => boolean;
  lockOwnershipGuard: { ownsContext: (ctx: TContext) => boolean };
}

export function createTelegramMultiBotStatusBridges(): {
  pollingActivity: ReturnType<
    typeof PollingManager.createTelegramPollingActivityBridge
  >;
  lockStatusBridge: { read: () => string };
} {
  return {
    pollingActivity: PollingManager.createTelegramPollingActivityBridge(),
    lockStatusBridge: { read: () => "inactive" },
  };
}

export function createTelegramBotIdForCwdResolver(
  configStore: Pick<TelegramProfileConfigStore, "getDocument">,
): (cwd: string) => number | undefined {
  return function resolveTelegramBotIdForCwd(cwd: string) {
    const document = configStore.getDocument();
    return getTelegramBotIdForBoundCwd(
      document.sessionBindings,
      document.profiles,
      cwd,
    );
  };
}

export function createTelegramMultiBotBridgeRuntime<
  TContext extends { cwd: string },
>(
  deps: TelegramMultiBotBridgeRuntimeDeps<TContext>,
): TelegramMultiBotBridgeRuntime<TContext> {
  const pollingActivity = deps.statusBridges.pollingActivity;
  const lockStatusBridge = deps.statusBridges.lockStatusBridge;
  const registryWrappedUpdateHandle = Updates.createTelegramUpdateHandle({
    defaultHandle: deps.inboundHandleUpdate,
  });
  const botRoutedUpdateHandle = SessionRouter.createTelegramBotSessionUpdateRouter(
    {
      configStore: deps.configStore,
      getContextCwd: deps.getContextCwd,
      defaultHandle: registryWrappedUpdateHandle,
      offlineQueue: deps.offlineQueue,
      sendOfflineNotice: createTelegramOfflineQueueNoticeSender({
        getProfile: deps.configStore.getProfile.bind(deps.configStore),
        recordRuntimeEvent: deps.recordRuntimeEvent,
      }),
      recordRuntimeEvent: deps.recordRuntimeEvent,
    },
  );
  const perBotPollingConfigs = new Map<
    number,
    { botToken?: string; lastUpdateId?: number }
  >();
  const multiPollingManager = PollingManager.createTelegramMultiPollingManager({
    getBotId: deps.configStore.getActiveBotId.bind(deps.configStore),
    hasBotToken: deps.configStore.hasBotToken.bind(deps.configStore),
    deleteWebhook: async () => undefined,
    getUpdates: async () => [],
    persistConfig: deps.configStore.persist.bind(deps.configStore),
    getConfig: deps.configStore.get.bind(deps.configStore),
    handleUpdate: botRoutedUpdateHandle,
    stopTypingLoop: deps.stopTypingLoop,
    updateStatus: deps.updateStatus,
    recordRuntimeEvent: deps.recordRuntimeEvent,
    createPollLoopDeps: (botId) =>
      createPerBotPollLoopDeps(
        botId,
        perBotPollingConfigs,
        deps.configStore,
        deps.recordRuntimeEvent,
      ),
  });
  const botConnectionRegistry =
    BotConnectionsModule.createTelegramBotConnectionRegistry({
      getBotIdForCwd: deps.getBotIdForCwd,
      hasBotToken: deps.configStore.hasBotTokenForBot.bind(deps.configStore),
      canStartPolling: deps.canStartPolling,
      formatStartBlockedMessage: deps.formatStartBlockedMessage,
      multiPollingManager,
      updateStatus: deps.updateStatus,
      recordRuntimeEvent: deps.recordRuntimeEvent,
    });
  const botConnectionRuntime =
    BotConnectionsModule.createTelegramBotConnectionCommandRuntime(
      botConnectionRegistry,
      deps.contextStore,
    );
  lockStatusBridge.read = createTelegramSessionLockStatusReader(
    deps.contextStore,
    botConnectionRegistry,
  );
  pollingActivity.bind(
    createTelegramSessionPollingActivityReader(
      deps.configStore,
      botConnectionRegistry,
    ),
  );
  return {
    multiPollingManager,
    botConnectionRegistry,
    botConnectionRuntime,
    botRoutedUpdateHandle,
    pollingActivity,
    lockStatusBridge,
    ownsTelegramDirectDelivery: createTelegramDirectDeliveryOwnershipChecker(
      deps.contextStore,
      botConnectionRegistry,
    ),
    lockOwnershipGuard: {
      ownsContext: botConnectionRegistry.ownsSessionBot.bind(
        botConnectionRegistry,
      ),
    },
  };
}

function createPerBotPollLoopDeps(
  botId: number,
  perBotPollingConfigs: Map<
    number,
    { botToken?: string; lastUpdateId?: number }
  >,
  configStore: Pick<
    TelegramProfileConfigStore,
    "getProfile" | "mutateProfile"
  >,
  recordRuntimeEvent: TelegramMultiBotBridgeRuntimeDeps<{ cwd: string }>["recordRuntimeEvent"],
) {
  const api = TelegramApi.createDefaultTelegramBridgeApiRuntime({
    getBotToken: () => configStore.getProfile(botId)?.botToken,
    recordRuntimeEvent,
  });
  if (!perBotPollingConfigs.has(botId)) {
    const profile = configStore.getProfile(botId) ?? {};
    perBotPollingConfigs.set(botId, {
      botToken: profile.botToken,
      lastUpdateId: profile.lastUpdateId,
    });
  }
  const pollingConfig = perBotPollingConfigs.get(botId)!;
  return {
    getConfig: () => pollingConfig,
    persistConfig: async () => {
      await configStore.mutateProfile(botId, (profile) => {
        profile.lastUpdateId = pollingConfig.lastUpdateId;
      });
    },
    deleteWebhook: api.deleteWebhook,
    getUpdates: api.getUpdates,
  };
}

function createTelegramOfflineQueueNoticeSender(deps: {
  getProfile: (botId: number) => { botToken?: string } | undefined;
  recordRuntimeEvent: TelegramMultiBotBridgeRuntimeDeps<{ cwd: string }>["recordRuntimeEvent"];
}) {
  return async function sendTelegramOfflineQueueNotice(
    botId: number,
    chatId: number,
    replyToMessageId: number,
    cwd: string,
  ): Promise<void> {
    const profile = deps.getProfile(botId);
    if (!profile?.botToken) return;
    const api = TelegramApi.createDefaultTelegramBridgeApiRuntime({
      getBotToken: () => profile.botToken,
      recordRuntimeEvent: deps.recordRuntimeEvent,
    });
    await api.sendMessage({
      chat_id: chatId,
      text: `Queued for π session ${cwd}. Open that project and run /telegram-connect to process.`,
      reply_to_message_id: replyToMessageId,
    });
  };
}

function createTelegramSessionLockStatusReader<TContext extends { cwd: string }>(
  contextStore: { get: () => TContext | undefined },
  registry: BotConnections.TelegramBotConnectionRuntime<TContext>,
): () => string {
  return function readTelegramSessionLockStatus() {
    const ctx = contextStore.get();
    if (!ctx) return "inactive";
    return registry.getSessionLockStatusLabel(ctx);
  };
}

function createTelegramSessionPollingActivityReader(
  configStore: Pick<TelegramProfileConfigStore, "getActiveBotId">,
  registry: BotConnections.TelegramBotConnectionRuntime<{ cwd: string }>,
): () => boolean {
  return function readTelegramSessionPollingActivity() {
    const botId = configStore.getActiveBotId();
    return botId !== undefined && registry.isPollingActive(botId);
  };
}

function createTelegramDirectDeliveryOwnershipChecker<
  TContext extends { cwd: string },
>(
  contextStore: { get: () => TContext | undefined },
  registry: BotConnections.TelegramBotConnectionRuntime<TContext>,
): () => boolean {
  return function ownsTelegramDirectDelivery() {
    const ctx = contextStore.get();
    if (!ctx) return false;
    return registry.ownsSessionBot(ctx);
  };
}

export function createTelegramSessionStopPollingForCwd(
  configStore: Pick<TelegramProfileConfigStore, "getSessionCwd">,
  registry: Pick<BotConnections.TelegramBotConnectionRuntime<{ cwd: string }>, "suspendForCwd">,
): () => Promise<void> {
  return async function stopTelegramSessionPolling() {
    const cwd = configStore.getSessionCwd();
    if (cwd) await registry.suspendForCwd(cwd);
  };
}

export function createTelegramOfflineQueueSessionMerger<TContext>(
  offlineQueue: ReturnType<typeof createTelegramOfflineQueueStore>,
  telegramQueueStore: {
    getQueuedItems: () => unknown[];
    setQueuedItems: (items: unknown[]) => void;
  },
  dispatchNextQueuedTelegramTurn: (ctx: TContext) => void,
  recordRuntimeEvent: TelegramMultiBotBridgeRuntimeDeps<{ cwd: string }>["recordRuntimeEvent"],
): (ctx: TContext) => Promise<void> {
  return async function mergeTelegramOfflineQueueForSession(ctx: TContext) {
    await SessionRouter.mergeTelegramOfflineQueueIntoSession(
      (ctx as { cwd: string }).cwd,
      {
        offlineQueue,
        getQueuedItems: () =>
          telegramQueueStore.getQueuedItems() as import("./queue.ts").PendingTelegramTurn[],
        setQueuedItems: (items) =>
          telegramQueueStore.setQueuedItems([
            ...telegramQueueStore.getQueuedItems(),
            ...items,
          ]),
        dispatchNextQueuedTelegramTurn,
        ctx,
        recordRuntimeEvent,
      },
    );
  };
}

export function createTelegramMultiBotSessionStartHook<TContext>(
  botConnectionRegistry: Pick<
    BotConnections.TelegramBotConnectionRuntime<TContext>,
    "onSessionStart"
  >,
  mergeOfflineQueue: (ctx: TContext) => Promise<void>,
): (_event: unknown, ctx: TContext) => Promise<void> {
  return async function onTelegramMultiBotSessionStart(event, ctx) {
    await botConnectionRegistry.onSessionStart(event, ctx);
    await mergeOfflineQueue(ctx);
  };
}

export function getTelegramBotIdForBoundCwd(
  bindings: Record<string, string>,
  profiles: Record<string, { botId?: number }>,
  cwd: string,
): number | undefined {
  const key = bindings[cwd];
  if (!key) return undefined;
  return profiles[key]?.botId;
}
