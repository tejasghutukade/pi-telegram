/**
 * Telegram per-bot connection registry
 * Zones: telegram transport, locks, polling runtime
 * Owns per-bot lock acquisition, polling lifecycle, and session-scoped connect/disconnect in one π process
 */

import {
  createTelegramLockRuntime,
  formatLock,
  getTelegramLockKey,
  snapshotLockContext,
  type TelegramLockContext,
  type TelegramLockRuntime,
  type TelegramLockedPollingStartOptions,
  type TelegramLockedPollingStartResult,
} from "./locks.ts";
import type { TelegramMultiPollingManager } from "./polling-manager.ts";

export interface TelegramBotConnectionRegistryDeps<
  TContext extends TelegramLockContext,
> {
  getBotIdForCwd: (cwd: string) => number | undefined;
  hasBotToken: (botId: number) => boolean;
  canStartPolling?: (ctx: TContext) => boolean;
  formatStartBlockedMessage?: (ctx: TContext) => string;
  multiPollingManager: TelegramMultiPollingManager<TContext>;
  updateStatus: (ctx: TContext) => void;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
  locksPath?: string;
  pid?: number;
  ownershipCheckMs?: number;
}

export interface TelegramBotConnectionRuntime<
  TContext extends TelegramLockContext,
> {
  connect: (
    ctx: TContext,
    options?: TelegramLockedPollingStartOptions,
  ) => Promise<TelegramLockedPollingStartResult>;
  start: (
    ctx: TContext,
    options?: TelegramLockedPollingStartOptions,
  ) => Promise<TelegramLockedPollingStartResult>;
  stop: () => Promise<string>;
  suspend: () => Promise<void>;
  suspendForCwd: (cwd: string) => Promise<void>;
  suspendForBot: (botId: number) => Promise<void>;
  releaseLockForCwd: (cwd: string) => string | undefined;
  releaseLockForBot: (botId: number) => string | undefined;
  onSessionStart: (_event: unknown, ctx: TContext) => Promise<void>;
  ownsSessionBot: (ctx: TContext) => boolean;
  isPollingActive: (botId?: number) => boolean;
  getSessionLockStatusLabel: (ctx: TContext) => string;
}

export function createTelegramBotConnectionRegistry<
  TContext extends TelegramLockContext,
>(
  deps: TelegramBotConnectionRegistryDeps<TContext>,
): TelegramBotConnectionRuntime<TContext> {
  const lockRuntimes = new Map<number, TelegramLockRuntime<TContext>>();
  const ownershipIntervals = new Map<number, ReturnType<typeof setInterval>>();
  const ownershipStops = new Map<number, Promise<void>>();
  const ownershipCheckMs = deps.ownershipCheckMs ?? 1000;

  const getLock = (botId: number): TelegramLockRuntime<TContext> => {
    const existing = lockRuntimes.get(botId);
    if (existing) return existing;
    const lock = createTelegramLockRuntime<TContext>({
      locksPath: deps.locksPath,
      pid: deps.pid,
      key: getTelegramLockKey(botId),
      getLegacyMigrationBotId: () => botId,
    });
    lockRuntimes.set(botId, lock);
    return lock;
  };

  const stopOwnershipWatcher = (botId: number): void => {
    const interval = ownershipIntervals.get(botId);
    if (!interval) return;
    clearInterval(interval);
    ownershipIntervals.delete(botId);
  };

  const stopPollingForBot = async (botId: number): Promise<void> => {
    stopOwnershipWatcher(botId);
    const pending = ownershipStops.get(botId);
    if (pending) {
      await pending;
      return;
    }
    await deps.multiPollingManager.stop(botId);
  };

  const releaseLockForCwd = (cwd: string): string | undefined => {
    const botId = deps.getBotIdForCwd(cwd);
    if (botId === undefined) return undefined;
    const lock = getLock(botId);
    const state = lock.release();
    if (state.kind === "active-elsewhere") {
      return `Telegram bridge is active in another π instance (${formatLock(state.lock)}).`;
    }
    if (state.kind === "stale") {
      return `Removed stale Telegram bridge lock (${formatLock(state.lock)}).`;
    }
    return undefined;
  };

  const startOwnershipWatcher = (
    botId: number,
    ctx: TContext,
    lock: TelegramLockRuntime<TContext>,
  ): void => {
    const owner = snapshotLockContext(ctx);
    stopOwnershipWatcher(botId);
    const interval = setInterval(() => {
      if (lock.owns(owner)) return;
      if (ownershipStops.has(botId)) return;
      stopOwnershipWatcher(botId);
      ownershipStops.set(
        botId,
        deps.multiPollingManager
          .stop(botId)
          .catch((error) =>
            deps.recordRuntimeEvent?.("lock", error, {
              phase: "ownership-loss",
              botId,
            }),
          )
          .finally(() => {
            ownershipStops.delete(botId);
          }),
      );
    }, ownershipCheckMs);
    interval.unref?.();
    ownershipIntervals.set(botId, interval);
  };

  const canStartPolling = (ctx: TContext): boolean =>
    deps.canStartPolling?.(ctx) ?? true;

  const formatStartBlockedMessage = (ctx: TContext): string =>
    deps.formatStartBlockedMessage?.(ctx) ??
    "Telegram polling is unavailable in this π run mode.";

  const connect = async (
    ctx: TContext,
    options: TelegramLockedPollingStartOptions = {},
  ): Promise<TelegramLockedPollingStartResult> => {
    const botId = deps.getBotIdForCwd(ctx.cwd);
    if (botId === undefined) {
      return {
        ok: false,
        message: "No Telegram bot profile is bound to this π session.",
      };
    }
    if (!deps.hasBotToken(botId)) {
      return { ok: false, message: "Telegram bot is not configured." };
    }
    if (!canStartPolling(ctx)) {
      return { ok: false, message: formatStartBlockedMessage(ctx) };
    }
    const lock = getLock(botId);
    const acquired = lock.acquire(ctx, options);
    if (!acquired.ok) {
      return {
        ok: false,
        canTakeover: true,
        owner: formatLock(acquired.lock),
        message: `Telegram bridge is active in another π instance (${formatLock(acquired.lock)}).`,
      };
    }
    deps.multiPollingManager.start(ctx, botId);
    startOwnershipWatcher(botId, ctx, lock);
    deps.updateStatus(ctx);
    const staleSuffix = acquired.replacedStale ? " Replaced stale lock." : "";
    return { ok: true, message: `Telegram bridge connected.${staleSuffix}` };
  };

  const suspendForCwd = async (cwd: string): Promise<void> => {
    const botId = deps.getBotIdForCwd(cwd);
    if (botId === undefined) return;
    await stopPollingForBot(botId);
  };

  const releaseLockForBot = (botId: number): string | undefined => {
    const lock = getLock(botId);
    const state = lock.release();
    if (state.kind === "active-elsewhere") {
      return `Telegram bridge is active in another π instance (${formatLock(state.lock)}).`;
    }
    if (state.kind === "stale") {
      return `Removed stale Telegram bridge lock (${formatLock(state.lock)}).`;
    }
    return undefined;
  };

  return {
    connect,
    start: connect,
    stop: async () => "Telegram bridge disconnected.",
    suspend: async () => undefined,
    suspendForCwd,
    suspendForBot: stopPollingForBot,
    onSessionStart: async (_event, ctx) => {
      const botId = deps.getBotIdForCwd(ctx.cwd);
      if (botId === undefined || !deps.hasBotToken(botId)) return;
      if (!canStartPolling(ctx)) return;
      const lock = getLock(botId);
      const ownsCurrentLock = lock.owns(ctx);
      const state = ownsCurrentLock ? undefined : lock.getState();
      const canResumeStaleSameCwd =
        state?.kind === "stale" && state.lock.cwd === ctx.cwd;
      if (!ownsCurrentLock && !canResumeStaleSameCwd) return;
      try {
        if (canResumeStaleSameCwd) {
          const acquired = lock.acquire(ctx);
          if (!acquired.ok) return;
        }
        deps.multiPollingManager.start(ctx, botId);
        startOwnershipWatcher(botId, ctx, lock);
        deps.updateStatus(ctx);
      } catch (error) {
        deps.recordRuntimeEvent?.("lock", error, { phase: "auto-start", botId });
      }
    },
    ownsSessionBot: (ctx) => {
      const botId = deps.getBotIdForCwd(ctx.cwd);
      if (botId === undefined) return false;
      return getLock(botId).owns(ctx);
    },
    isPollingActive: (botId) => deps.multiPollingManager.isActive(botId),
    getSessionLockStatusLabel: (ctx) => {
      const botId = deps.getBotIdForCwd(ctx.cwd);
      if (botId === undefined) return "inactive";
      return getLock(botId).getStatusLabel();
    },
    releaseLockForCwd,
    releaseLockForBot,
  };
}

export function createTelegramBotConnectionCommandRuntime<
  TContext extends TelegramLockContext,
>(
  registry: TelegramBotConnectionRuntime<TContext>,
  contextStore: { get: () => TContext | undefined },
): TelegramBotConnectionRuntime<TContext> {
  return {
    ...registry,
    stop: async () => {
      const ctx = contextStore.get();
      if (!ctx) return "No active π session.";
      await registry.suspendForCwd(ctx.cwd);
      return registry.releaseLockForCwd(ctx.cwd) ?? "Telegram bridge disconnected.";
    },
    suspend: async () => {
      const ctx = contextStore.get();
      if (!ctx) return;
      await registry.suspendForCwd(ctx.cwd);
    },
  };
}
