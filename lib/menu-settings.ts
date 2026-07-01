/**
 * Telegram settings menu UI helpers
 * Zones: telegram ui, settings controls, menu composition
 * Owns hidden settings-menu rendering, settings callbacks, and persisted toggle wiring
 */

import {
  getTelegramExtensionSettingsRows,
  type TelegramSectionRegistry,
} from "./sections.ts";
import type { TelegramTimeMode } from "./config.ts";
import type { TelegramProfileConfigStore } from "./config.ts";
import type { TelegramInlineKeyboardMarkup } from "./keyboard.ts";
import type { TelegramModelMenuState } from "./menu-model.ts";
import type { MenuModel } from "./model.ts";
import type { TelegramVoiceReplyMode } from "./voice.ts";

export type TelegramSettingsMenuReplyMarkup = TelegramInlineKeyboardMarkup;

export interface TelegramSettingsStateDeps {
  isProactivePushEnabled: () => boolean;
  getTimeInjectionMode: () => TelegramTimeMode;
  getVoiceReplyMode: () => TelegramVoiceReplyMode;
  isVoiceReplyModeConfigured: () => boolean;
}

export interface TelegramSettingsMutationDeps extends TelegramSettingsStateDeps {
  setProactivePushEnabled: (enabled: boolean) => Promise<void>;
  setVoiceReplyMode: (
    mode: TelegramVoiceReplyMode | undefined,
  ) => Promise<void>;
  setTimeInjectionMode: (mode: TelegramTimeMode) => Promise<void>;
}

export interface TelegramSettingsMenuOpenDeps<
  TModel extends MenuModel = MenuModel,
> extends TelegramSettingsStateDeps {
  getModelMenuState: () => Promise<TelegramModelMenuState<TModel>>;
  sendSettingsMenu: (
    state: TelegramModelMenuState<TModel>,
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<number | undefined>;
  storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
}

export interface TelegramSettingsMenuCallbackDeps extends TelegramSettingsMutationDeps {
  updateSettingsMessage: (
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
  sectionRegistry?: TelegramSectionRegistry;
}

export interface TelegramSettingsMenuRuntime<TContext> {
  openSettingsMenu: (
    chatId: number,
    replyToMessageId: number,
    ctx: TContext,
  ) => Promise<void>;
  handleCallbackQuery: (
    query: {
      id: string;
      data?: string;
      message?: { message_id?: number };
    },
    ctx: TContext,
  ) => Promise<boolean>;
  updateSettingsMenuMessage: (
    state: TelegramModelMenuState,
    ctx: TContext,
  ) => Promise<void>;
}

export interface TelegramSettingsMenuMessageUpdateDeps extends TelegramSettingsStateDeps {
  updateSettingsMessage: (
    text: string,
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
}

export interface TelegramSettingsMenuRuntimeDeps<
  TContext,
  TModel extends MenuModel = MenuModel,
> extends TelegramSettingsMutationDeps, Partial<TelegramBotProfileSettingsDeps> {
  getSessionCwdFromContext?: (ctx: TContext) => string | undefined;
  getModelMenuState: (
    chatId: number,
    ctx: TContext,
  ) => Promise<TelegramModelMenuState<TModel>>;
  getStoredModelMenuState: (
    messageId: number | undefined,
  ) => TelegramModelMenuState<TModel> | undefined;
  storeModelMenuState: (state: TelegramModelMenuState<TModel>) => void;
  editInteractiveMessage: (
    chatId: number,
    messageId: number,
    text: string,
    mode: "markdown" | "html" | "plain",
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<void>;
  sendInteractiveMessage: (
    chatId: number,
    text: string,
    mode: "markdown" | "html" | "plain",
    replyMarkup: TelegramSettingsMenuReplyMarkup,
  ) => Promise<number | undefined>;
  answerCallbackQuery: (
    callbackQueryId: string,
    text?: string,
  ) => Promise<void>;
}

export const SETTINGS_MENU_TITLE = "<b>⚙️ Settings:</b>";
export const PROACTIVE_PUSH_SETTINGS_TITLE = "<b>📌 Proactive push:</b>";
export const TIME_INJECTION_MODE_SETTINGS_TITLE =
  "<b>🕒 Time injection mode:</b>";
export const VOICE_REPLY_MODE_SETTINGS_TITLE = "<b>👄 Voice reply mode:</b>";
export const BOT_PROFILE_SETTINGS_TITLE = "<b>🤖 Telegram bot:</b>";

type TelegramVoiceReplyModeSetting = TelegramVoiceReplyMode | "hidden";

export interface TelegramBotProfileSettingsDeps {
  getActiveBotId: () => number | undefined;
  getActiveBotUsername: () => string | undefined;
  listProfiles: () => Array<{
    botId: number;
    botUsername?: string;
    allowedUserId?: number;
  }>;
  switchSessionProfile: (cwd: string, botId: number) => Promise<void>;
  removeProfile: (botId: number) => Promise<void>;
  getSessionCwd: () => string | undefined;
}

function getVoiceReplyModeLabel(mode: TelegramVoiceReplyModeSetting): string {
  return mode;
}

function getTelegramSettingsStateValueLabel(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function getVoiceReplyModeSetting(
  mode: TelegramVoiceReplyMode,
  configured: boolean,
): TelegramVoiceReplyModeSetting {
  return configured ? mode : "hidden";
}

export function buildTelegramSettingsMenuText(): string {
  return SETTINGS_MENU_TITLE;
}

export function buildProactivePushSettingsText(
  proactivePushEnabled: boolean,
): string {
  return [
    `${PROACTIVE_PUSH_SETTINGS_TITLE} <code>${proactivePushEnabled ? "on" : "off"}</code>`,
    "",
    "Send successful local π task results to Telegram when the bridge is connected.",
  ].join("\n");
}

export function buildVoiceReplyModeSettingsText(
  mode: TelegramVoiceReplyMode,
  configured = true,
): string {
  return [
    `${VOICE_REPLY_MODE_SETTINGS_TITLE} <code>${getVoiceReplyModeLabel(
      getVoiceReplyModeSetting(mode, configured),
    )}</code>`,
    "",
    "Controls when pi-telegram converts assistant text replies into Telegram voice messages.",
    "",
    "<code>-</code> <code>hidden</code> (default): same behavior as 'manual', but no voice policy is added to prompt context.",
    "<code>-</code> <code>manual</code>: agent decides; explicit 'telegram_voice' markup still works and reply mode is visible in prompt context.",
    "<code>-</code> <code>mirror</code>: voice input prefers a voice reply; text input gracefully follows 'manual' behavior.",
    "<code>-</code> <code>always</code>: every reply is converted to voice when delivery succeeds.",
  ].join("\n");
}

export function buildTimeInjectionModeSettingsText(
  mode: TelegramTimeMode,
): string {
  return [
    `${TIME_INJECTION_MODE_SETTINGS_TITLE} <code>${mode}</code>`,
    "",
    "Controls whether Telegram-originated prompts include a compact wall-clock [time] line.",
    "",
    "<code>-</code> <code>hidden</code> (default): no time line is added to prompt context.",
    "<code>-</code> <code>always</code>: add time to every Telegram turn.",
    "<code>-</code> <code>interval</code>: add time at most once per chat interval (default: 1 hour).",
  ].join("\n");
}

export function buildTelegramSettingsMenuReplyMarkup(
  proactivePushEnabled: boolean,
  voiceReplyMode: TelegramVoiceReplyMode,
  timeInjectionMode: TelegramTimeMode,
  sectionRegistry?: TelegramSectionRegistry,
  voiceReplyModeConfigured = true,
  botProfileLabel?: string,
): TelegramSettingsMenuReplyMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "⬆️ Main menu", callback_data: "menu:back" }],
  ];
  if (sectionRegistry) {
    const settingsRows = getTelegramExtensionSettingsRows(sectionRegistry);
    for (const row of settingsRows) {
      rows.push([{ text: row.label, callback_data: row.callback_data }]);
    }
  }
  if (botProfileLabel) {
    rows.push([
      {
        text: `🤖 Bot: ${botProfileLabel}`,
        callback_data: "settings:open:bot",
      },
    ]);
  }
  rows.push(
    [
      {
        text: `👄 Voice reply: ${getTelegramSettingsStateValueLabel(
          getVoiceReplyModeLabel(
            getVoiceReplyModeSetting(voiceReplyMode, voiceReplyModeConfigured),
          ),
        )}`,
        callback_data: "settings:open:voice-reply",
      },
    ],
    [
      {
        text: `🕒 Time injection: ${getTelegramSettingsStateValueLabel(timeInjectionMode)}`,
        callback_data: "settings:open:time-injection",
      },
    ],
    [
      {
        text: `📌 Proactive push: ${proactivePushEnabled ? "On" : "Off"}`,
        callback_data: "settings:open:proactive",
      },
    ],
  );
  return { inline_keyboard: rows };
}

export function buildBotProfileSettingsText(
  activeBotUsername: string | undefined,
  activeBotId: number | undefined,
  profiles: Array<{ botId: number; botUsername?: string }>,
): string {
  const activeLabel = activeBotUsername
    ? `@${activeBotUsername}`
    : activeBotId !== undefined
      ? `bot ${activeBotId}`
      : "not bound";
  const profileLines =
    profiles.length === 0
      ? "No saved bot profiles yet. Run /telegram-setup in π."
      : profiles
          .map((profile) => {
            const label = profile.botUsername
              ? `@${profile.botUsername}`
              : `bot ${profile.botId}`;
            const active =
              profile.botId === activeBotId ? " (this session)" : "";
            return `<code>-</code> ${label}${active}`;
          })
          .join("\n");
  return [
    `${BOT_PROFILE_SETTINGS_TITLE} <code>${activeLabel}</code>`,
    "",
    "Choose which saved bot profile this π session uses.",
    "Run /telegram-connect after switching or removing a bot.",
    "",
    profileLines,
  ].join("\n");
}

function formatBotProfileLabel(profile: {
  botId: number;
  botUsername?: string;
}): string {
  return profile.botUsername
    ? `@${profile.botUsername}`
    : `bot ${profile.botId}`;
}

export function buildBotProfileRemoveListText(
  profiles: Array<{ botId: number; botUsername?: string }>,
): string {
  const profileLines = profiles
    .map((profile) => `<code>-</code> ${formatBotProfileLabel(profile)}`)
    .join("\n");
  return [
    "<b>🗑 Remove bot profile:</b>",
    "",
    "Choose a saved bot profile to remove from telegram.json.",
    "",
    profileLines,
  ].join("\n");
}

export function buildBotProfileRemoveListReplyMarkup(
  profiles: Array<{ botId: number; botUsername?: string }>,
): TelegramSettingsMenuReplyMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "⬆️ Back", callback_data: "settings:open:bot" }],
  ];
  for (const profile of profiles) {
    rows.push([
      {
        text: `🗑 ${formatBotProfileLabel(profile)}`,
        callback_data: `settings:remove:bot:${profile.botId}`,
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export function buildBotProfileRemoveConfirmationText(botLabel: string): string {
  return `<b>Remove ${botLabel}?</b>`;
}

export function buildBotProfileRemoveConfirmationReplyMarkup(
  botId: number,
): TelegramSettingsMenuReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "🗑 Yes, remove",
          callback_data: `settings:confirm-remove:bot:${botId}`,
        },
        {
          text: "❌ No",
          callback_data: "settings:keep:bot",
        },
      ],
    ],
  };
}

export function buildBotProfileSettingsReplyMarkup(
  profiles: Array<{ botId: number; botUsername?: string }>,
  activeBotId: number | undefined,
): TelegramSettingsMenuReplyMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "⬆️ Back", callback_data: "settings:list" }],
  ];
  for (const profile of profiles) {
    const label = profile.botUsername
      ? `@${profile.botUsername}`
      : `bot ${profile.botId}`;
    rows.push([
      {
        text: `${profile.botId === activeBotId ? "🟢 " : ""}${label}`,
        callback_data: `settings:set:bot:${profile.botId}`,
      },
    ]);
  }
  if (profiles.length > 0) {
    rows.push([
      {
        text: "🗑 Remove bot",
        callback_data: "settings:open:bot-remove",
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export async function updateBotProfileSettingsMessage(
  deps: TelegramSettingsMenuCallbackDeps & TelegramBotProfileSettingsDeps,
): Promise<void> {
  const profiles = deps.listProfiles();
  await deps.updateSettingsMessage(
    buildBotProfileSettingsText(
      deps.getActiveBotUsername(),
      deps.getActiveBotId(),
      profiles,
    ),
    buildBotProfileSettingsReplyMarkup(profiles, deps.getActiveBotId()),
  );
}

function formatBotProfileSettingsLabel(
  activeBotUsername: string | undefined,
  activeBotId: number | undefined,
): string | undefined {
  if (activeBotUsername) return `@${activeBotUsername}`;
  if (activeBotId !== undefined) return `bot ${activeBotId}`;
  return undefined;
}

export async function openTelegramSettingsMenu<
  TModel extends MenuModel = MenuModel,
>(
  deps: TelegramSettingsMenuOpenDeps<TModel> &
    Partial<TelegramBotProfileSettingsDeps>,
  sectionRegistry?: TelegramSectionRegistry,
): Promise<void> {
  const state = await deps.getModelMenuState();
  const messageId = await deps.sendSettingsMenu(
    state,
    buildTelegramSettingsMenuText(),
    buildTelegramSettingsMenuReplyMarkup(
      deps.isProactivePushEnabled(),
      deps.getVoiceReplyMode(),
      deps.getTimeInjectionMode(),
      sectionRegistry,
      deps.isVoiceReplyModeConfigured(),
      formatBotProfileSettingsLabel(
        deps.getActiveBotUsername?.(),
        deps.getActiveBotId?.(),
      ),
    ),
  );
  if (messageId === undefined) return;
  state.messageId = messageId;
  state.mode = "settings";
  deps.storeModelMenuState(state);
}

export function buildProactivePushSettingsReplyMarkup(
  proactivePushEnabled: boolean,
): TelegramSettingsMenuReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "⬆️ Back", callback_data: "settings:list" }],
      [
        {
          text: proactivePushEnabled ? "🟢 On" : "⚫️ On",
          callback_data: "settings:set:proactive:on",
        },
        {
          text: proactivePushEnabled ? "⚫️ Off" : "🟡 Off",
          callback_data: "settings:set:proactive:off",
        },
      ],
    ],
  };
}

export function buildTimeInjectionModeSettingsReplyMarkup(
  mode: TelegramTimeMode,
): TelegramSettingsMenuReplyMarkup {
  const modes: TelegramTimeMode[] = ["hidden", "always", "interval"];
  return {
    inline_keyboard: [
      [{ text: "⬆️ Back", callback_data: "settings:list" }],
      ...modes.map((value) => [
        {
          text: `${value === mode ? "🟢 " : ""}${value}`,
          callback_data: `settings:set:time-injection:${value}`,
        },
      ]),
    ],
  };
}

export function buildVoiceReplyModeSettingsReplyMarkup(
  mode: TelegramVoiceReplyMode,
  configured = true,
): TelegramSettingsMenuReplyMarkup {
  const activeMode = getVoiceReplyModeSetting(mode, configured);
  const modes: TelegramVoiceReplyModeSetting[] = [
    "hidden",
    "manual",
    "mirror",
    "always",
  ];
  return {
    inline_keyboard: [
      [{ text: "⬆️ Back", callback_data: "settings:list" }],
      ...modes.map((value) => [
        {
          text: `${value === activeMode ? "🟢 " : ""}${getVoiceReplyModeLabel(value)}`,
          callback_data: `settings:set:voice-reply:${value}`,
        },
      ]),
    ],
  };
}

export async function updateTelegramSettingsMenuMessage(
  deps: TelegramSettingsMenuMessageUpdateDeps &
    Partial<TelegramBotProfileSettingsDeps>,
  sectionRegistry?: TelegramSectionRegistry,
): Promise<void> {
  await deps.updateSettingsMessage(
    buildTelegramSettingsMenuText(),
    buildTelegramSettingsMenuReplyMarkup(
      deps.isProactivePushEnabled(),
      deps.getVoiceReplyMode(),
      deps.getTimeInjectionMode(),
      sectionRegistry,
      deps.isVoiceReplyModeConfigured(),
      formatBotProfileSettingsLabel(
        deps.getActiveBotUsername?.(),
        deps.getActiveBotId?.(),
      ),
    ),
  );
}

export async function updateProactivePushSettingsMessage(
  deps: TelegramSettingsMenuCallbackDeps,
): Promise<void> {
  const proactivePushEnabled = deps.isProactivePushEnabled();
  await deps.updateSettingsMessage(
    buildProactivePushSettingsText(proactivePushEnabled),
    buildProactivePushSettingsReplyMarkup(proactivePushEnabled),
  );
}

export async function updateTimeInjectionModeSettingsMessage(
  deps: TelegramSettingsMenuCallbackDeps,
): Promise<void> {
  const mode = deps.getTimeInjectionMode();
  await deps.updateSettingsMessage(
    buildTimeInjectionModeSettingsText(mode),
    buildTimeInjectionModeSettingsReplyMarkup(mode),
  );
}

export async function updateVoiceReplyModeSettingsMessage(
  deps: TelegramSettingsMenuCallbackDeps,
): Promise<void> {
  const mode = deps.getVoiceReplyMode();
  const configured = deps.isVoiceReplyModeConfigured();
  await deps.updateSettingsMessage(
    buildVoiceReplyModeSettingsText(mode, configured),
    buildVoiceReplyModeSettingsReplyMarkup(mode, configured),
  );
}

export async function handleTelegramSettingsMenuCallbackAction(
  callbackQueryId: string,
  data: string | undefined,
  deps: TelegramSettingsMenuCallbackDeps &
    Partial<TelegramBotProfileSettingsDeps>,
): Promise<boolean> {
  if (!data?.startsWith("settings:")) return false;
  if (data === "settings:list") {
    await updateTelegramSettingsMenuMessage(deps, deps.sectionRegistry);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data === "settings:open:bot" && deps.listProfiles && deps.getSessionCwd) {
    await updateBotProfileSettingsMessage(
      deps as TelegramSettingsMenuCallbackDeps & TelegramBotProfileSettingsDeps,
    );
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data === "settings:open:bot-remove" && deps.listProfiles) {
    const profiles = deps.listProfiles();
    await deps.updateSettingsMessage(
      buildBotProfileRemoveListText(profiles),
      buildBotProfileRemoveListReplyMarkup(profiles),
    );
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data.startsWith("settings:remove:bot:") && deps.listProfiles) {
    const botId = Number(data.slice("settings:remove:bot:".length));
    const profile = deps.listProfiles().find((entry) => entry.botId === botId);
    if (!Number.isInteger(botId) || botId <= 0 || !profile) {
      await deps.answerCallbackQuery(callbackQueryId, "Bot profile unavailable.");
      return true;
    }
    await deps.updateSettingsMessage(
      buildBotProfileRemoveConfirmationText(formatBotProfileLabel(profile)),
      buildBotProfileRemoveConfirmationReplyMarkup(botId),
    );
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data === "settings:keep:bot" && deps.listProfiles && deps.getSessionCwd) {
    await updateBotProfileSettingsMessage(
      deps as TelegramSettingsMenuCallbackDeps & TelegramBotProfileSettingsDeps,
    );
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data.startsWith("settings:confirm-remove:bot:") && deps.removeProfile) {
    const botId = Number(data.slice("settings:confirm-remove:bot:".length));
    if (!Number.isInteger(botId) || botId <= 0) {
      await deps.answerCallbackQuery(callbackQueryId, "Bot profile unavailable.");
      return true;
    }
    try {
      await deps.removeProfile(botId);
      if (deps.listProfiles && deps.getSessionCwd) {
        await updateBotProfileSettingsMessage(
          deps as TelegramSettingsMenuCallbackDeps & TelegramBotProfileSettingsDeps,
        );
      } else {
        await updateTelegramSettingsMenuMessage(deps, deps.sectionRegistry);
      }
      await deps.answerCallbackQuery(
        callbackQueryId,
        "Bot profile removed. Run /telegram-setup to add one again.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to remove bot profile.";
      await deps.answerCallbackQuery(callbackQueryId, message);
    }
    return true;
  }
  if (data === "settings:open:proactive") {
    await updateProactivePushSettingsMessage(deps);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data === "settings:open:voice-reply") {
    await updateVoiceReplyModeSettingsMessage(deps);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (
    data === "settings:open:time-injection" ||
    data === "settings:open:time"
  ) {
    await updateTimeInjectionModeSettingsMessage(deps);
    await deps.answerCallbackQuery(callbackQueryId);
    return true;
  }
  if (data.startsWith("settings:set:bot:") && deps.switchSessionProfile) {
    const botId = Number(data.slice("settings:set:bot:".length));
    const cwd = deps.getSessionCwd?.();
    if (!Number.isInteger(botId) || botId <= 0 || !cwd) {
      await deps.answerCallbackQuery(callbackQueryId, "Bot profile unavailable.");
      return true;
    }
    try {
      await deps.switchSessionProfile(cwd, botId);
      await updateBotProfileSettingsMessage(
        deps as TelegramSettingsMenuCallbackDeps & TelegramBotProfileSettingsDeps,
      );
      await deps.answerCallbackQuery(
        callbackQueryId,
        `Switched to bot ${botId}. Reconnect with /telegram-connect if needed.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to switch bot profile.";
      await deps.answerCallbackQuery(callbackQueryId, message);
    }
    return true;
  }
  if (data.startsWith("settings:set:voice-reply:")) {
    const mode = data.slice("settings:set:voice-reply:".length);
    if (
      mode === "hidden" ||
      mode === "manual" ||
      mode === "mirror" ||
      mode === "always"
    ) {
      await deps.setVoiceReplyMode(mode === "hidden" ? undefined : mode);
      await updateVoiceReplyModeSettingsMessage(deps);
      await deps.answerCallbackQuery(
        callbackQueryId,
        `Voice reply mode: ${mode}`,
      );
      return true;
    }
  }
  if (
    data.startsWith("settings:set:time-injection:") ||
    data.startsWith("settings:set:time:")
  ) {
    const mode = data.startsWith("settings:set:time-injection:")
      ? data.slice("settings:set:time-injection:".length)
      : data.slice("settings:set:time:".length);
    const normalizedMode = mode === "off" ? "hidden" : mode;
    if (
      normalizedMode === "hidden" ||
      normalizedMode === "always" ||
      normalizedMode === "interval"
    ) {
      await deps.setTimeInjectionMode(normalizedMode);
      await updateTimeInjectionModeSettingsMessage(deps);
      await deps.answerCallbackQuery(
        callbackQueryId,
        `Time injection: ${normalizedMode}`,
      );
      return true;
    }
  }
  if (
    data === "settings:set:proactive:on" ||
    data === "settings:set:proactive:off"
  ) {
    const enabled = data.endsWith(":on");
    await deps.setProactivePushEnabled(enabled);
    await updateProactivePushSettingsMessage(deps);
    await deps.answerCallbackQuery(
      callbackQueryId,
      `Proactive push ${enabled ? "enabled" : "disabled"}`,
    );
    return true;
  }
  await deps.answerCallbackQuery(callbackQueryId);
  return true;
}

export function createTelegramBotProfileSettingsPorts(
  store: TelegramProfileConfigStore,
): Pick<
  TelegramBotProfileSettingsDeps,
  | "getActiveBotId"
  | "getActiveBotUsername"
  | "listProfiles"
  | "switchSessionProfile"
  | "removeProfile"
> {
  return {
    getActiveBotId: store.getActiveBotId.bind(store),
    getActiveBotUsername: () => store.get().botUsername,
    listProfiles: store.listProfiles.bind(store),
    switchSessionProfile: store.switchSessionProfile.bind(store),
    removeProfile: store.removeProfile.bind(store),
  };
}

export function createTelegramSettingsMenuRuntime<
  TContext,
  TModel extends MenuModel = MenuModel,
>(
  deps: TelegramSettingsMenuRuntimeDeps<TContext, TModel>,
  sectionRegistry?: TelegramSectionRegistry,
): TelegramSettingsMenuRuntime<TContext> {
  return {
    openSettingsMenu: (chatId, _replyToMessageId, ctx) =>
      openTelegramSettingsMenu(
        {
          getModelMenuState: () => deps.getModelMenuState(chatId, ctx),
          isProactivePushEnabled: deps.isProactivePushEnabled,
          getVoiceReplyMode: deps.getVoiceReplyMode,
          isVoiceReplyModeConfigured: deps.isVoiceReplyModeConfigured,
          getTimeInjectionMode: deps.getTimeInjectionMode,
          getActiveBotId: deps.getActiveBotId,
          getActiveBotUsername: deps.getActiveBotUsername,
          sendSettingsMenu: (state, text, replyMarkup) =>
            deps.sendInteractiveMessage(
              state.chatId,
              text,
              "html",
              replyMarkup,
            ),
          storeModelMenuState: deps.storeModelMenuState,
        },
        sectionRegistry,
      ),
    updateSettingsMenuMessage: (state) =>
      updateTelegramSettingsMenuMessage(
        {
          isProactivePushEnabled: deps.isProactivePushEnabled,
          getVoiceReplyMode: deps.getVoiceReplyMode,
          isVoiceReplyModeConfigured: deps.isVoiceReplyModeConfigured,
          getTimeInjectionMode: deps.getTimeInjectionMode,
          getActiveBotId: deps.getActiveBotId,
          getActiveBotUsername: deps.getActiveBotUsername,
          updateSettingsMessage: (text, replyMarkup) =>
            deps.editInteractiveMessage(
              state.chatId,
              state.messageId,
              text,
              "html",
              replyMarkup,
            ),
        },
        sectionRegistry,
      ),
    handleCallbackQuery: async (query, ctx) => {
      if (!query.data?.startsWith("settings:")) return false;
      const sessionCwd =
        deps.getSessionCwdFromContext?.(ctx) ?? deps.getSessionCwd?.();
      const state = deps.getStoredModelMenuState(query.message?.message_id);
      if (!state) {
        const voiceMode = query.data.slice("settings:set:voice-reply:".length);
        if (
          query.data.startsWith("settings:set:voice-reply:") &&
          (voiceMode === "hidden" ||
            voiceMode === "manual" ||
            voiceMode === "mirror" ||
            voiceMode === "always")
        ) {
          await deps.setVoiceReplyMode(
            voiceMode === "hidden" ? undefined : voiceMode,
          );
          await deps.answerCallbackQuery(
            query.id,
            `Voice reply mode: ${voiceMode}`,
          );
          return true;
        }
        const hasTimeInjectionPrefix = query.data.startsWith(
          "settings:set:time-injection:",
        );
        const timeMode = hasTimeInjectionPrefix
          ? query.data.slice("settings:set:time-injection:".length)
          : query.data.slice("settings:set:time:".length);
        if (
          (hasTimeInjectionPrefix ||
            query.data.startsWith("settings:set:time:")) &&
          (timeMode === "off" ||
            timeMode === "hidden" ||
            timeMode === "always" ||
            timeMode === "interval")
        ) {
          const normalizedMode = timeMode === "off" ? "hidden" : timeMode;
          await deps.setTimeInjectionMode(normalizedMode);
          await deps.answerCallbackQuery(
            query.id,
            `Time injection: ${normalizedMode}`,
          );
          return true;
        }
        await deps.answerCallbackQuery(
          query.id,
          "Interactive message expired.",
        );
        return true;
      }
      return handleTelegramSettingsMenuCallbackAction(query.id, query.data, {
        isProactivePushEnabled: deps.isProactivePushEnabled,
        getVoiceReplyMode: deps.getVoiceReplyMode,
        isVoiceReplyModeConfigured: deps.isVoiceReplyModeConfigured,
        getTimeInjectionMode: deps.getTimeInjectionMode,
        setProactivePushEnabled: deps.setProactivePushEnabled,
        setVoiceReplyMode: deps.setVoiceReplyMode,
        setTimeInjectionMode: deps.setTimeInjectionMode,
        getActiveBotId: deps.getActiveBotId,
        getActiveBotUsername: deps.getActiveBotUsername,
        listProfiles: deps.listProfiles,
        switchSessionProfile: deps.switchSessionProfile,
        removeProfile: deps.removeProfile,
        getSessionCwd: () => sessionCwd,
        updateSettingsMessage: (text, replyMarkup) =>
          deps.editInteractiveMessage(
            state.chatId,
            state.messageId,
            text,
            "html",
            replyMarkup,
          ),
        answerCallbackQuery: deps.answerCallbackQuery,
        sectionRegistry,
      });
    },
  };
}
