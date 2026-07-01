/**
 * Telegram bridge config and pairing helpers
 * Zones: telegram config, pairing, filesystem
 * Owns persisted bot/session pairing state, local config storage, live config controls, authorization policy, and first-user pairing side effects
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { TelegramInboundHandlerConfig } from "./inbound.ts";
import type { CommandTemplateObjectConfig } from "./command-templates.ts";

const CONFIG_RUNTIME_KEY = "__piTelegramConfigRuntime__";

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? resolve(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
}

function getConfigPath(): string {
  return join(getAgentDir(), "telegram.json");
}

export type TelegramOutboundCommandTemplateConfig =
  | string
  | CommandTemplateObjectConfig;
export interface TelegramOutboundHandlerConfig extends CommandTemplateObjectConfig {
  type?: string;
  match?: string | string[];
  output?: string;
  timeout?: number | string;
}

export type TelegramTimeMode = "hidden" | "always" | "interval";

export interface TelegramTimeConfig {
  injectionMode?: TelegramTimeMode;
  interval?: number;
}

export interface ResolvedTelegramTimeConfig {
  injectionMode: TelegramTimeMode;
  interval: number;
  timezone: string;
}

export interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  botId?: number;
  allowedUserId?: number;
  lastUpdateId?: number;
  inboundHandlers?: TelegramInboundHandlerConfig[];
  attachmentHandlers?: TelegramInboundHandlerConfig[];
  outboundHandlers?: TelegramOutboundHandlerConfig[];
  proactivePush?: boolean;
  autoConnect?: boolean;
  voice?: {
    replyMode?: "manual" | "mirror" | "always";
    sendTranscript?: boolean;
  };
  time?: TelegramTimeConfig;
}

export type TelegramBotProfile = TelegramConfig;

export interface TelegramConfigDefaults {
  inboundHandlers?: TelegramInboundHandlerConfig[];
  attachmentHandlers?: TelegramInboundHandlerConfig[];
  outboundHandlers?: TelegramOutboundHandlerConfig[];
  proactivePush?: boolean;
  autoConnect?: boolean;
  voice?: TelegramConfig["voice"];
  time?: TelegramTimeConfig;
}

export function isTelegramAutoConnectEnabled(
  config: Pick<TelegramConfig, "autoConnect">,
): boolean {
  return config.autoConnect !== false;
}

export const TELEGRAM_CONFIG_VERSION = 2;

export interface TelegramConfigDocument {
  version: typeof TELEGRAM_CONFIG_VERSION;
  defaults?: TelegramConfigDefaults;
  profiles: Record<string, TelegramBotProfile>;
  sessionBindings: Record<string, string>;
}

export interface TelegramBotProfileSummary {
  botId: number;
  botUsername?: string;
  allowedUserId?: number;
}

export interface TelegramProfileConfigStore extends TelegramConfigStore {
  setSessionCwd: (cwd: string) => void;
  getSessionCwd: () => string | undefined;
  getActiveBotId: () => number | undefined;
  getDocument: () => TelegramConfigDocument;
  bindSession: (cwd: string, botId: number) => Promise<void>;
  upsertProfile: (profile: TelegramBotProfile) => Promise<void>;
  switchSessionProfile: (cwd: string, botId: number) => Promise<void>;
  removeProfile: (botId: number) => Promise<void>;
  mutateProfile: (
    botId: number,
    mutate: (profile: TelegramBotProfile) => void,
  ) => Promise<void>;
  getProfile: (botId: number) => TelegramBotProfile | undefined;
  listProfiles: () => TelegramBotProfileSummary[];
  findCwdForBot: (botId: number) => string | undefined;
  withBotProfile: <T>(botId: number, run: () => T | Promise<T>) => Promise<T>;
  hasBotTokenForBot: (botId: number) => boolean;
}

export interface TelegramConfigStore {
  get: () => TelegramConfig;
  set: (config: TelegramConfig) => void;
  update: (mutate: (config: TelegramConfig) => void) => void;
  getBotToken: () => string | undefined;
  hasBotToken: () => boolean;
  getAllowedUserId: () => number | undefined;
  getInboundHandlers: () => TelegramInboundHandlerConfig[] | undefined;
  getAttachmentHandlers: () => TelegramInboundHandlerConfig[] | undefined;
  getOutboundHandlers: () => TelegramOutboundHandlerConfig[] | undefined;
  setAllowedUserId: (userId: number) => void;
  load: () => Promise<void>;
  persist: (config?: TelegramConfig) => Promise<void>;
}

export interface TelegramConfigStoreOptions {
  initialConfig?: TelegramConfig;
  agentDir?: string;
  configPath?: string;
  recordRuntimeEvent?: (
    category: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) => void;
}

export interface TelegramInvalidConfigRecovery {
  configPath: string;
  recoveryPath: string;
  error: unknown;
}

export interface TelegramConfigRuntime {
  updateVoiceConfig: (voice: NonNullable<TelegramConfig["voice"]>) => void;
}

export function setGlobalTelegramConfigRuntime(
  runtime: TelegramConfigRuntime | undefined,
): void {
  const globals = globalThis as Record<string, unknown>;
  if (runtime) globals[CONFIG_RUNTIME_KEY] = runtime;
  else delete globals[CONFIG_RUNTIME_KEY];
}

export function updateTelegramVoiceConfig(
  voice: NonNullable<TelegramConfig["voice"]>,
): boolean {
  const runtime = (globalThis as Record<string, unknown>)[
    CONFIG_RUNTIME_KEY
  ] as TelegramConfigRuntime | undefined;
  if (!runtime || typeof runtime.updateVoiceConfig !== "function") return false;
  runtime.updateVoiceConfig(voice);
  return true;
}

export function bindGlobalTelegramConfigRuntime(
  configStore: Pick<TelegramConfigStore, "get" | "set" | "persist">,
): void {
  setGlobalTelegramConfigRuntime({
    updateVoiceConfig(voice) {
      const current = configStore.get();
      const next = {
        ...current,
        voice: { ...(current.voice ?? {}), ...voice },
      };
      configStore.set(next);
      void configStore.persist(next);
    },
  });
}

function createEmptyTelegramConfigDocument(): TelegramConfigDocument {
  return {
    version: TELEGRAM_CONFIG_VERSION,
    profiles: {},
    sessionBindings: {},
  };
}

function mergeProfileWithDefaults(
  defaults: TelegramConfigDefaults | undefined,
  profile: TelegramBotProfile,
): TelegramBotProfile {
  if (!defaults) return { ...profile };
  return {
    ...defaults,
    ...profile,
    inboundHandlers: profile.inboundHandlers ?? defaults.inboundHandlers,
    attachmentHandlers:
      profile.attachmentHandlers ?? defaults.attachmentHandlers,
    outboundHandlers: profile.outboundHandlers ?? defaults.outboundHandlers,
    proactivePush: profile.proactivePush ?? defaults.proactivePush,
    autoConnect: profile.autoConnect ?? defaults.autoConnect,
    voice:
      defaults.voice || profile.voice
        ? { ...defaults.voice, ...profile.voice }
        : undefined,
    time:
      defaults.time || profile.time
        ? { ...defaults.time, ...profile.time }
        : undefined,
  };
}

function cloneTelegramConfigDocument(
  document: TelegramConfigDocument,
): TelegramConfigDocument {
  return JSON.parse(JSON.stringify(document)) as TelegramConfigDocument;
}

export function mergeTelegramConfigDocumentsOnPersist(
  disk: TelegramConfigDocument,
  current: TelegramConfigDocument,
  baseline: TelegramConfigDocument | undefined,
): TelegramConfigDocument {
  const merged = cloneTelegramConfigDocument(disk);
  if (!baseline) {
    merged.defaults = current.defaults ? { ...current.defaults } : disk.defaults;
    merged.profiles = { ...disk.profiles, ...current.profiles };
    merged.sessionBindings = {
      ...disk.sessionBindings,
      ...current.sessionBindings,
    };
    return merged;
  }
  if (
    JSON.stringify(current.defaults ?? {}) !==
    JSON.stringify(baseline.defaults ?? {})
  ) {
    merged.defaults = { ...disk.defaults, ...current.defaults };
  }
  for (const [key, profile] of Object.entries(current.profiles)) {
    if (
      JSON.stringify(baseline.profiles[key]) !== JSON.stringify(profile)
    ) {
      merged.profiles[key] = { ...profile };
    }
  }
  for (const key of Object.keys(baseline.profiles)) {
    if (!(key in current.profiles)) delete merged.profiles[key];
  }
  for (const [cwd, boundKey] of Object.entries(current.sessionBindings)) {
    if (baseline.sessionBindings[cwd] !== boundKey) {
      merged.sessionBindings[cwd] = boundKey;
    }
  }
  for (const cwd of Object.keys(baseline.sessionBindings)) {
    if (!(cwd in current.sessionBindings)) delete merged.sessionBindings[cwd];
  }
  return merged;
}

export function botIdToProfileKey(botId: number): string {
  return String(botId);
}

export const LEGACY_TELEGRAM_PROFILE_KEY = "__legacy__";

export const LEGACY_TELEGRAM_BOT_ID = 0;

function isLegacyTelegramProfileKey(key: string): boolean {
  return key === LEGACY_TELEGRAM_PROFILE_KEY;
}

function resolveTelegramProfileKeyForBotId(
  document: Pick<TelegramConfigDocument, "profiles">,
  botId: number,
): string | undefined {
  const key = botIdToProfileKey(botId);
  if (document.profiles[key]) return key;
  if (
    botId === LEGACY_TELEGRAM_BOT_ID &&
    document.profiles[LEGACY_TELEGRAM_PROFILE_KEY]
  ) {
    return LEGACY_TELEGRAM_PROFILE_KEY;
  }
  return undefined;
}

function resolveTelegramBotIdFromProfileKey(
  document: Pick<TelegramConfigDocument, "profiles">,
  key: string,
): number | undefined {
  const profile = document.profiles[key];
  if (profile?.botId !== undefined) return profile.botId;
  if (isLegacyTelegramProfileKey(key) && profile?.botToken) {
    return LEGACY_TELEGRAM_BOT_ID;
  }
  const numeric = Number.parseInt(key, 10);
  if (Number.isFinite(numeric) && document.profiles[key]) return numeric;
  return undefined;
}

export function getBoundBotIdForCwd(
  document: Pick<TelegramConfigDocument, "profiles" | "sessionBindings">,
  cwd: string,
): number | undefined {
  const key = document.sessionBindings[cwd];
  if (!key) return undefined;
  return resolveTelegramBotIdFromProfileKey(document, key);
}

function isTelegramConfigDocumentV2(
  value: unknown,
): value is TelegramConfigDocument {
  return (
    !!value &&
    typeof value === "object" &&
    (value as TelegramConfigDocument).version === TELEGRAM_CONFIG_VERSION &&
    typeof (value as TelegramConfigDocument).profiles === "object" &&
    (value as TelegramConfigDocument).profiles !== null &&
    !Array.isArray((value as TelegramConfigDocument).profiles)
  );
}

function extractTelegramBotProfile(config: TelegramConfig): TelegramBotProfile {
  return { ...config };
}

export function migrateTelegramConfigToDocument(
  raw: TelegramConfig | TelegramConfigDocument,
  cwd?: string,
): TelegramConfigDocument {
  if (isTelegramConfigDocumentV2(raw)) {
    return {
      version: TELEGRAM_CONFIG_VERSION,
      defaults: raw.defaults ? { ...raw.defaults } : undefined,
      profiles: { ...raw.profiles },
      sessionBindings: { ...raw.sessionBindings },
    };
  }
  const flat = raw as TelegramConfig;
  const document = createEmptyTelegramConfigDocument();
  if (!flat.botToken && flat.botId === undefined) return document;
  const botId = flat.botId;
  if (botId === undefined) {
    document.profiles.__legacy__ = extractTelegramBotProfile(flat);
    if (cwd) document.sessionBindings[cwd] = "__legacy__";
    return document;
  }
  const key = botIdToProfileKey(botId);
  document.profiles[key] = extractTelegramBotProfile(flat);
  if (cwd) document.sessionBindings[cwd] = key;
  return document;
}

function resolveActiveProfileKey(
  document: TelegramConfigDocument,
  sessionCwd?: string,
): string | undefined {
  if (sessionCwd) return document.sessionBindings[sessionCwd];
  const profileKeys = Object.keys(document.profiles);
  if (profileKeys.length === 1) return profileKeys[0];
  return undefined;
}

function resolveActiveProfile(
  document: TelegramConfigDocument,
  sessionCwd?: string,
): TelegramBotProfile {
  const key = resolveActiveProfileKey(document, sessionCwd);
  if (!key) return mergeProfileWithDefaults(document.defaults, {});
  return mergeProfileWithDefaults(
    document.defaults,
    document.profiles[key] ?? {},
  );
}

function stripSharedDefaultsFromProfile(
  resolved: TelegramBotProfile,
  defaults: TelegramConfigDefaults | undefined,
): TelegramBotProfile {
  const baseline = mergeProfileWithDefaults(defaults, {});
  const stored: TelegramBotProfile = {};
  const identityKeys = [
    "botToken",
    "botUsername",
    "botId",
    "allowedUserId",
    "lastUpdateId",
  ] as const;
  for (const key of identityKeys) {
    if (resolved[key] !== undefined) {
      (stored as Record<string, unknown>)[key] = resolved[key];
    }
  }
  const sharedKeys = [
    "inboundHandlers",
    "attachmentHandlers",
    "outboundHandlers",
    "proactivePush",
    "autoConnect",
    "voice",
    "time",
  ] as const;
  for (const key of sharedKeys) {
    if (resolved[key] === undefined) continue;
    if (JSON.stringify(resolved[key]) !== JSON.stringify(baseline[key])) {
      (stored as Record<string, unknown>)[key] = resolved[key];
    }
  }
  return stored;
}

function writeActiveProfileToDocument(
  document: TelegramConfigDocument,
  sessionCwd: string | undefined,
  profile: TelegramBotProfile,
): TelegramConfigDocument {
  let key = resolveActiveProfileKey(document, sessionCwd);
  if (!key) {
    if (profile.botId !== undefined) key = botIdToProfileKey(profile.botId);
    else if (profile.botToken) key = "__legacy__";
    else return document;
    if (sessionCwd) document.sessionBindings[sessionCwd] = key;
  }
  document.profiles[key] = stripSharedDefaultsFromProfile(
    profile,
    document.defaults,
  );
  return document;
}

export async function readTelegramConfigDocument(
  configPath: string,
  options: {
    onInvalidConfig?: (recovery: TelegramInvalidConfigRecovery) => void;
    sessionCwd?: string;
  } = {},
): Promise<TelegramConfigDocument> {
  if (!existsSync(configPath)) return createEmptyTelegramConfigDocument();
  const content = await readFile(configPath, "utf8");
  try {
    const parsed = JSON.parse(content) as TelegramConfig | TelegramConfigDocument;
    return migrateTelegramConfigToDocument(parsed, options.sessionCwd);
  } catch (error) {
    const recoveryPath = getInvalidTelegramConfigRecoveryPath(configPath);
    await rename(configPath, recoveryPath);
    options.onInvalidConfig?.({ configPath, recoveryPath, error });
    return createEmptyTelegramConfigDocument();
  }
}

function getInvalidTelegramConfigRecoveryPath(configPath: string): string {
  return `${configPath}.invalid-${process.pid}-${Date.now()}`;
}

export async function readTelegramConfig(
  configPath: string,
  options: {
    onInvalidConfig?: (recovery: TelegramInvalidConfigRecovery) => void;
    sessionCwd?: string;
  } = {},
): Promise<TelegramConfig> {
  const document = await readTelegramConfigDocument(configPath, options);
  return resolveActiveProfile(document, options.sessionCwd);
}

export async function writeTelegramConfigDocument(
  agentDir: string,
  configPath: string,
  document: TelegramConfigDocument,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const tempConfigPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  const payload: TelegramConfigDocument = {
    version: TELEGRAM_CONFIG_VERSION,
    ...(document.defaults ? { defaults: document.defaults } : {}),
    profiles: document.profiles,
    sessionBindings: document.sessionBindings,
  };
  await writeFile(tempConfigPath, JSON.stringify(payload, null, "\t") + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(tempConfigPath, 0o600);
  await rename(tempConfigPath, configPath);
  await chmod(configPath, 0o600);
}

export async function writeTelegramConfig(
  agentDir: string,
  configPath: string,
  config: TelegramConfig,
): Promise<void> {
  const document = migrateTelegramConfigToDocument(config);
  if (config.botId !== undefined) {
    document.profiles[botIdToProfileKey(config.botId)] =
      extractTelegramBotProfile(config);
  } else if (Object.keys(config).length > 0) {
    document.profiles.__legacy__ = extractTelegramBotProfile(config);
  }
  await writeTelegramConfigDocument(agentDir, configPath, document);
}

export function createTelegramConfigStore(
  options: TelegramConfigStoreOptions = {},
): TelegramProfileConfigStore {
  let document = createEmptyTelegramConfigDocument();
  let loadedDocument: TelegramConfigDocument | undefined;
  let config: TelegramConfig = options.initialConfig ?? {};
  let sessionCwd: string | undefined;
  const agentDir = options.agentDir ?? getAgentDir();
  const configPath = options.configPath ?? join(agentDir, "telegram.json");

  const syncConfigFromDocument = () => {
    config = resolveActiveProfile(document, sessionCwd);
  };

  const persistDocument = async () => {
    writeActiveProfileToDocument(document, sessionCwd, config);
    let toWrite = document;
    if (existsSync(configPath)) {
      const disk = await readTelegramConfigDocument(configPath, { sessionCwd });
      toWrite = mergeTelegramConfigDocumentsOnPersist(
        disk,
        document,
        loadedDocument,
      );
    }
    await writeTelegramConfigDocument(agentDir, configPath, toWrite);
    document = toWrite;
    loadedDocument = cloneTelegramConfigDocument(toWrite);
    syncConfigFromDocument();
  };

  return {
    get: () => config,
    set: (nextConfig) => {
      config = nextConfig;
      writeActiveProfileToDocument(document, sessionCwd, config);
    },
    update: (mutate) => {
      mutate(config);
      writeActiveProfileToDocument(document, sessionCwd, config);
    },
    getBotToken: () => config.botToken,
    hasBotToken: () => !!config.botToken,
    getAllowedUserId: () => config.allowedUserId,
    getInboundHandlers: () => [
      ...(config.inboundHandlers ?? []),
      ...(config.attachmentHandlers ?? []),
    ],
    getAttachmentHandlers: () => config.attachmentHandlers,
    getOutboundHandlers: () => config.outboundHandlers,
    setAllowedUserId: (userId) => {
      config.allowedUserId = userId;
      writeActiveProfileToDocument(document, sessionCwd, config);
    },
    load: async () => {
      let shouldPersistMigration = false;
      if (existsSync(configPath)) {
        try {
          const parsed = JSON.parse(await readFile(configPath, "utf8")) as
            | TelegramConfig
            | TelegramConfigDocument;
          shouldPersistMigration =
            !isTelegramConfigDocumentV2(parsed) && !!sessionCwd;
        } catch {
          shouldPersistMigration = false;
        }
      }
      document = await readTelegramConfigDocument(configPath, {
        sessionCwd,
        onInvalidConfig: (recovery) => {
          options.recordRuntimeEvent?.("config", recovery.error, {
            phase: "load",
            configPath: recovery.configPath,
            recoveryPath: recovery.recoveryPath,
          });
        },
      });
      if (
        sessionCwd &&
        document.profiles[LEGACY_TELEGRAM_PROFILE_KEY] &&
        !document.sessionBindings[sessionCwd]
      ) {
        document.sessionBindings[sessionCwd] = LEGACY_TELEGRAM_PROFILE_KEY;
      }
      syncConfigFromDocument();
      loadedDocument = cloneTelegramConfigDocument(document);
      if (shouldPersistMigration) await persistDocument();
    },
    persist: async (nextConfig = config) => {
      config = nextConfig;
      await persistDocument();
    },
    setSessionCwd: (cwd) => {
      sessionCwd = cwd;
      syncConfigFromDocument();
    },
    getSessionCwd: () => sessionCwd,
    getActiveBotId: () => {
      if (sessionCwd) {
        const bound = getBoundBotIdForCwd(document, sessionCwd);
        if (bound !== undefined) return bound;
      }
      return config.botId;
    },
    getDocument: () => ({
      version: TELEGRAM_CONFIG_VERSION,
      defaults: document.defaults ? { ...document.defaults } : undefined,
      profiles: { ...document.profiles },
      sessionBindings: { ...document.sessionBindings },
    }),
    bindSession: async (cwd, botId) => {
      sessionCwd = cwd;
      document.sessionBindings[cwd] = botIdToProfileKey(botId);
      syncConfigFromDocument();
      await persistDocument();
    },
    upsertProfile: async (profile) => {
      if (profile.botId === undefined) return;
      const key = botIdToProfileKey(profile.botId);
      document.profiles[key] = { ...profile };
      if (resolveActiveProfileKey(document, sessionCwd) === key) {
        config = { ...profile };
      }
      await persistDocument();
    },
    switchSessionProfile: async (cwd, botId) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      if (!key) {
        throw new Error(`Telegram bot profile ${botId} is not configured.`);
      }
      sessionCwd = cwd;
      document.sessionBindings[cwd] = key;
      syncConfigFromDocument();
      await persistDocument();
    },
    removeProfile: async (botId) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      if (!key) return;
      delete document.profiles[key];
      for (const [cwd, boundKey] of Object.entries(document.sessionBindings)) {
        if (boundKey === key) delete document.sessionBindings[cwd];
      }
      syncConfigFromDocument();
      await persistDocument();
    },
    mutateProfile: async (botId, mutate) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      if (!key) return;
      const profile = { ...(document.profiles[key] ?? {}) };
      mutate(profile);
      document.profiles[key] = profile;
      if (getBoundBotIdForCwd(document, sessionCwd ?? "") === botId) {
        config = { ...profile };
      }
      await persistDocument();
    },
    getProfile: (botId) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      const profile = key ? document.profiles[key] : undefined;
      return profile ? { ...profile } : undefined;
    },
    listProfiles: () => {
      const summaries: TelegramBotProfileSummary[] = [];
      for (const [key, profile] of Object.entries(document.profiles)) {
        const botId = resolveTelegramBotIdFromProfileKey(document, key);
        if (botId === undefined) continue;
        summaries.push({
          botId,
          botUsername: profile.botUsername,
          allowedUserId: profile.allowedUserId,
        });
      }
      return summaries;
    },
    findCwdForBot: (botId) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      if (!key) return undefined;
      for (const [cwd, boundKey] of Object.entries(document.sessionBindings)) {
        if (boundKey === key) return cwd;
      }
      return undefined;
    },
    withBotProfile: async (botId, run) => {
      const prevCwd = sessionCwd;
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      const boundCwd = key
        ? Object.entries(document.sessionBindings).find(
            ([, boundKey]) => boundKey === key,
          )?.[0]
        : undefined;
      if (boundCwd) sessionCwd = boundCwd;
      const profile = key ? document.profiles[key] : undefined;
      if (profile) {
        config = mergeProfileWithDefaults(document.defaults, profile);
      }
      try {
        return await run();
      } finally {
        sessionCwd = prevCwd;
        syncConfigFromDocument();
      }
    },
    hasBotTokenForBot: (botId) => {
      const key = resolveTelegramProfileKeyForBotId(document, botId);
      return key ? !!document.profiles[key]?.botToken : false;
    },
  };
}

export function createTelegramSessionConfigLoader(
  store: Pick<TelegramProfileConfigStore, "setSessionCwd" | "load">,
): (ctx: { cwd: string }) => Promise<void> {
  return async function loadTelegramSessionConfig(ctx) {
    store.setSessionCwd(ctx.cwd);
    await store.load();
  };
}

export function createTelegramProactivePushChecker(
  configStore: Pick<TelegramConfigStore, "get">,
): () => boolean {
  return () => configStore.get().proactivePush ?? false;
}

export function createTelegramProactivePushSetter(
  configStore: Pick<TelegramConfigStore, "get" | "set" | "persist">,
): (enabled: boolean) => Promise<void> {
  return async (enabled) => {
    const config = { ...configStore.get(), proactivePush: enabled };
    configStore.set(config);
    await configStore.persist(config);
  };
}

export function createTelegramVoiceReplyModeGetter(
  configStore: Pick<TelegramConfigStore, "get">,
): () => "manual" | "mirror" | "always" {
  return () => {
    const mode = configStore.get().voice?.replyMode;
    return mode === "mirror" || mode === "always" || mode === "manual"
      ? mode
      : "manual";
  };
}

export function createTelegramVoiceReplyModeConfiguredChecker(
  configStore: Pick<TelegramConfigStore, "get">,
): () => boolean {
  return () => {
    const mode = configStore.get().voice?.replyMode;
    return mode === "mirror" || mode === "always" || mode === "manual";
  };
}

export function createTelegramVoiceReplyModeSetter(
  configStore: Pick<TelegramConfigStore, "get" | "set" | "persist">,
): (replyMode: "manual" | "mirror" | "always" | undefined) => Promise<void> {
  return async (replyMode) => {
    const current = configStore.get();
    if (replyMode === undefined) {
      const { replyMode: _replyMode, ...remainingVoice } = current.voice ?? {};
      const next = { ...current };
      if (Object.keys(remainingVoice).length > 0) next.voice = remainingVoice;
      else delete next.voice;
      configStore.set(next);
      await configStore.persist(next);
      return;
    }
    const next = { ...current, voice: { ...(current.voice ?? {}), replyMode } };
    configStore.set(next);
    await configStore.persist(next);
  };
}

function getSystemTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

export function resolveTelegramTimeConfig(
  raw: TelegramTimeConfig | undefined,
): ResolvedTelegramTimeConfig {
  const injectionMode: TelegramTimeMode =
    raw?.injectionMode === "always" || raw?.injectionMode === "interval"
      ? raw.injectionMode
      : "hidden";
  const interval =
    typeof raw?.interval === "number" && raw.interval > 0
      ? raw.interval
      : 60 * 60 * 1000;
  const timezone = getSystemTimezone();
  return { injectionMode, interval, timezone };
}

export function createTelegramTimeConfigGetter(
  configStore: Pick<TelegramConfigStore, "get">,
): () => ResolvedTelegramTimeConfig {
  return () => resolveTelegramTimeConfig(configStore.get().time);
}

export function createTelegramTimeInjectionModeGetter(
  configStore: Pick<TelegramConfigStore, "get">,
): () => TelegramTimeMode {
  return () => resolveTelegramTimeConfig(configStore.get().time).injectionMode;
}

export function createTelegramTimeInjectionModeSetter(
  configStore: Pick<TelegramConfigStore, "get" | "set" | "persist">,
): (injectionMode: TelegramTimeMode) => Promise<void> {
  return async (injectionMode) => {
    const current = configStore.get();
    if (injectionMode === "hidden") {
      const { injectionMode: _injectionMode, ...remainingTime } =
        current.time ?? {};
      const next = { ...current };
      if (Object.keys(remainingTime).length > 0) next.time = remainingTime;
      else delete next.time;
      configStore.set(next);
      await configStore.persist(next);
      return;
    }
    const next = {
      ...current,
      time: { ...(current.time ?? {}), injectionMode },
    };
    configStore.set(next);
    await configStore.persist(next);
  };
}

export function createTelegramProactivePushChatIdGetter(deps: {
  getActiveTurnChatId: () => number | undefined;
  getAllowedUserId: () => number | undefined;
}): () => number | undefined {
  return () => deps.getActiveTurnChatId() ?? deps.getAllowedUserId();
}

export function createTelegramConfigControls(
  configStore: Pick<TelegramConfigStore, "get" | "set" | "persist">,
) {
  return {
    isProactivePushEnabled: createTelegramProactivePushChecker(configStore),
    setProactivePushEnabled: createTelegramProactivePushSetter(configStore),
    getVoiceReplyMode: createTelegramVoiceReplyModeGetter(configStore),
    isVoiceReplyModeConfigured:
      createTelegramVoiceReplyModeConfiguredChecker(configStore),
    setVoiceReplyMode: createTelegramVoiceReplyModeSetter(configStore),
    getTimeInjectionMode: createTelegramTimeInjectionModeGetter(configStore),
    setTimeInjectionMode: createTelegramTimeInjectionModeSetter(configStore),
  };
}

export type TelegramAuthorizationState =
  | { kind: "pair"; userId: number }
  | { kind: "allow" }
  | { kind: "deny" };

export interface TelegramUserPairingDeps<TContext> {
  allowedUserId?: number;
  ctx: TContext;
  setAllowedUserId: (userId: number) => void;
  persistConfig: () => Promise<void>;
  updateStatus: (ctx: TContext) => void;
}

export interface TelegramUserPairingRuntimeDeps<TContext> {
  getAllowedUserId: () => number | undefined;
  setAllowedUserId: (userId: number) => void;
  persistConfig: () => Promise<void>;
  updateStatus: (ctx: TContext) => void;
}

export interface TelegramUserPairingRuntime<TContext> {
  pairIfNeeded: (userId: number, ctx: TContext) => Promise<boolean>;
}

export function getTelegramAuthorizationState(
  userId: number,
  allowedUserId?: number,
): TelegramAuthorizationState {
  if (allowedUserId === undefined) {
    return { kind: "pair", userId };
  }
  if (userId === allowedUserId) {
    return { kind: "allow" };
  }
  return { kind: "deny" };
}

function isTelegramStaleContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("stale after session") ||
      error.message.includes("stale ctx"))
  );
}

export async function pairTelegramUserIfNeeded<TContext>(
  userId: number,
  deps: TelegramUserPairingDeps<TContext>,
): Promise<boolean> {
  const authorization = getTelegramAuthorizationState(
    userId,
    deps.allowedUserId,
  );
  if (authorization.kind !== "pair") return false;
  deps.setAllowedUserId(authorization.userId);
  await deps.persistConfig();
  try {
    deps.updateStatus(deps.ctx);
  } catch (error) {
    if (!isTelegramStaleContextError(error)) throw error;
  }
  return true;
}

export function createTelegramUserPairingRuntime<TContext>(
  deps: TelegramUserPairingRuntimeDeps<TContext>,
): TelegramUserPairingRuntime<TContext> {
  return {
    pairIfNeeded: (userId, ctx) =>
      pairTelegramUserIfNeeded(userId, {
        allowedUserId: deps.getAllowedUserId(),
        ctx,
        setAllowedUserId: deps.setAllowedUserId,
        persistConfig: deps.persistConfig,
        updateStatus: deps.updateStatus,
      }),
  };
}
