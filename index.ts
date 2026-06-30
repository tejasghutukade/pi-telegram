/**
 * Telegram bridge extension entrypoint and orchestration layer
 * Zones: telegram, pi agent, orchestration
 * Keeps the runtime wiring in one place while delegating reusable domain logic to /lib modules
 */

import * as Bindings from "./lib/bindings.ts";
import * as CommandTemplates from "./lib/command-templates.ts";
import * as Config from "./lib/config.ts";
import * as Inbound from "./lib/inbound.ts";
import * as Lifecycle from "./lib/lifecycle.ts";
import * as Media from "./lib/media.ts";
import * as MenuQueue from "./lib/menu-queue.ts";
import * as MenuSettings from "./lib/menu-settings.ts";
import * as Menu from "./lib/menu.ts";
import * as Model from "./lib/model.ts";
import * as MultiBotRuntime from "./lib/multi-bot-runtime.ts";
import * as OfflineQueue from "./lib/offline-queue.ts";
import * as Outbound from "./lib/outbound.ts";
import * as Pi from "./lib/pi.ts";
import * as Preview from "./lib/preview.ts";
import * as PromptTemplates from "./lib/prompt-templates.ts";
import * as Queue from "./lib/queue.ts";
import * as Replies from "./lib/replies.ts";
import * as Routing from "./lib/routing.ts";
import * as Runtime from "./lib/runtime.ts";
import * as Sections from "./lib/sections.ts";
import * as Status from "./lib/status.ts";
import * as TelegramApi from "./lib/telegram-api.ts";
import * as TextGroups from "./lib/text-groups.ts";
import * as TimeInjection from "./lib/time-injection.ts";
import * as Voice from "./lib/voice.ts";

type ActivePiModel = NonNullable<Pi.ExtensionContext["model"]>;

// --- Extension Runtime ---

export default function (pi: Pi.ExtensionAPI) {
  const piRuntime = Pi.createExtensionApiRuntimePorts(pi);
  const {
    getCommands,
    getThinkingLevel,
    sendUserMessage,
    setModel,
    setThinkingLevel,
  } = piRuntime;
  const bridgeRuntime = Runtime.createTelegramBridgeRuntime();
  const { abort, lifecycle, queue, setup, typing } = bridgeRuntime;
  let configStoreForRedaction: Config.TelegramConfigStore | undefined;
  const runtimeEvents = Status.createTelegramRuntimeEventRecorder({
    getBotToken() {
      return configStoreForRedaction?.getBotToken();
    },
  });
  const recordRuntimeEvent = runtimeEvents.record;
  const configStore = Config.createTelegramConfigStore({ recordRuntimeEvent });
  configStoreForRedaction = configStore;
  Config.bindGlobalTelegramConfigRuntime(configStore);
  const configControls = Config.createTelegramConfigControls(configStore);
  const telegramSessionContextStore =
    Lifecycle.createTelegramSessionContextStore<Pi.ExtensionContext>();
  const getBotIdForCwd =
    MultiBotRuntime.createTelegramBotIdForCwdResolver(configStore);
  const offlineQueueStore = OfflineQueue.createTelegramOfflineQueueStore();
  const activeTurnRuntime = Queue.createTelegramActiveTurnStore();
  const proactivePushChatIdGetter =
    Config.createTelegramProactivePushChatIdGetter({
      getActiveTurnChatId: activeTurnRuntime.getChatId,
      getAllowedUserId: configStore.getAllowedUserId,
    });
  const buttonActionStore = Outbound.createTelegramButtonActionStore();
  const pendingModelSwitchStore =
    Model.createPendingModelSwitchStore<
      Model.ScopedTelegramModel<ActivePiModel>
    >();
  const modelMenuRuntime = Menu.createTelegramModelMenuRuntime<ActivePiModel>();
  const sectionRegistry = Sections.createAndBindTelegramSectionRegistry();

  const timeInjectionRuntime = TimeInjection.createTimeInjectionRuntime({
    getConfig: Config.createTelegramTimeConfigGetter(configStore),
    recordRuntimeEvent,
  });
  Outbound.bindTelegramRuntimeEventRecorder(recordRuntimeEvent);
  const getContextModel = Pi.getExtensionContextModel;
  const isIdle = Pi.isExtensionContextIdle;
  const hasPendingMessages = Pi.hasExtensionContextPendingMessages;
  const compact = Pi.compactExtensionContext;
  const mediaGroupRuntime = Media.createTelegramMediaGroupController<
    TelegramApi.TelegramMessage,
    Pi.ExtensionContext
  >();
  const textGroupRuntime = TextGroups.createTelegramTextGroupController<
    TelegramApi.TelegramMessage,
    Pi.ExtensionContext
  >();
  const telegramQueueStore =
    Queue.createTelegramQueueStore<Pi.ExtensionContext>();
  const deferredQueueDispatchRuntime =
    Queue.createTelegramDeferredQueueDispatchRuntime<Pi.ExtensionContext>({
      delayMs: 50,
      recordRuntimeEvent,
    });
  const multiBotStatusBridges =
    MultiBotRuntime.createTelegramMultiBotStatusBridges();
  const pollingActivity = multiBotStatusBridges.pollingActivity;
  const lockStatusBridge = multiBotStatusBridges.lockStatusBridge;
  const statusRuntime = Status.createTelegramBridgeStatusRuntime<
    Pi.ExtensionContext,
    Queue.TelegramQueueItem<Pi.ExtensionContext>
  >({
      getConfig: configStore.get,
      isPollingActive: pollingActivity.read,
      getActiveSourceMessageIds: activeTurnRuntime.getSourceMessageIds,
      hasActiveTurn: activeTurnRuntime.has,
      hasDispatchPending: lifecycle.hasDispatchPending,
      isCompactionInProgress: lifecycle.isCompactionInProgress,
      getActiveToolExecutions: lifecycle.getActiveToolExecutions,
      hasPendingModelSwitch: pendingModelSwitchStore.has,
      getQueuedItems: telegramQueueStore.getQueuedItems,
      formatQueuedStatus: Queue.formatQueuedTelegramItemsStatus,
      getRecentRuntimeEvents: runtimeEvents.getEvents,
      getRuntimeLockState: lockStatusBridge.read,
    });
  const { getStatusLines, updateStatus } = statusRuntime;
  const inboundHandlerRuntime = Inbound.createTelegramInboundHandlerRuntime({
    getHandlers: configStore.getInboundHandlers,
    execCommand: CommandTemplates.execCommandTemplate,
    getCwd: Pi.getExtensionContextCwd,
    recordRuntimeEvent,
  });

  // --- Telegram API ---

  const {
    callMultipart,
    deleteWebhook,
    getUpdates,
    setMyCommands,
    sendTypingAction,
    sendChatAction,
    sendRecordVoiceAction,
    sendMessageDraft,
    sendMessage,
    sendRichMessage,
    sendRichMessageDraft,
    downloadFile: downloadTelegramBridgeFile,
    editMessageText: editTelegramMessageText,
    answerCallbackQuery,
    answerGuestQuery,
    deleteMessage: deleteTelegramMessage,
    prepareTempDir,
  } = TelegramApi.createDefaultTelegramBridgeApiRuntime({
    getBotToken: configStore.getBotToken,
    recordRuntimeEvent,
  });

  // --- Message Delivery ---

  const sendGuestReply = Replies.createGuestMarkdownReplySender({
    answerGuestQuery,
  });

  const promptDispatchRuntime = Runtime.createTelegramPromptDispatchRuntime({
    lifecycle,
    typing,
    getDefaultChatId: proactivePushChatIdGetter,
    sendTypingAction,
    updateStatus,
    recordRuntimeEvent,
  });
  const currentModelRuntime = Model.createCurrentModelRuntime({
    getContextModel,
    updateStatus,
  });
  const queueMutationRuntime = Queue.createTelegramQueueMutationController({
    ...telegramQueueStore,
    getNextPriorityReactionOrder: queue.getNextPriorityReactionOrder,
    incrementNextPriorityReactionOrder:
      queue.incrementNextPriorityReactionOrder,
    updateStatus,
  });

  // --- Reply Runtime & Preview ---

  const replyRuntime = Replies.createTelegramRenderedMessageDeliveryRuntime({
    sendMessage,
    sendRichMessage,
    editMessage: editTelegramMessageText,
  });
  const { replyTransport, editInteractiveMessage, sendInteractiveMessage } =
    replyRuntime;
  const { sendTextReply, sendMarkdownReply } =
    Outbound.createTelegramOutboundTextReplyRuntime({
      sendTextReply: replyRuntime.sendTextReply,
      sendMarkdownReply: replyRuntime.sendMarkdownReply,
      execCommand: CommandTemplates.execCommandTemplate,
      getHandlers: configStore.getOutboundHandlers,
      recordRuntimeEvent,
    });
  const dispatchNextQueuedTelegramTurn =
    Queue.createTelegramQueueDispatchRuntime({
      ...telegramQueueStore,
      isCompactionInProgress: lifecycle.isCompactionInProgress,
      hasActiveTurn: activeTurnRuntime.has,
      hasDispatchPending: lifecycle.hasDispatchPending,
      isIdle,
      hasPendingMessages,
      hasDispatchContext: deferredQueueDispatchRuntime.isBound,
      updateStatus,
      sendTextReply,
      recordRuntimeEvent,
      ...promptDispatchRuntime,
      sendUserMessage,
    }).dispatchNext;
  const previewRuntime = Preview.createTelegramAssistantPreviewRuntime({
    getActiveTurn: activeTurnRuntime.get,
    isAssistantMessage: Replies.isAssistantAgentMessage,
    getMessageText: Replies.getAgentMessageText,
    getDefaultReplyToMessageId: activeTurnRuntime.getReplyToMessageId,
    sendDraft: TelegramApi.createTelegramNativeMarkdownDraftSender({
      sendMessageDraft,
      sendRichMessageDraft,
    }),
    sendMarkdownReply,
    recordRuntimeEvent,
    ...replyTransport,
  });
  const { finalizeMarkdownPreview } =
    Outbound.createTelegramOutboundTextPreviewRuntime({
      finalizeMarkdownPreview: previewRuntime.finalizeMarkdown,
      execCommand: CommandTemplates.execCommandTemplate,
      getHandlers: configStore.getOutboundHandlers,
      recordRuntimeEvent,
    });

  // --- Model And Menu Setup ---

  const modelSwitchController =
    Model.createTelegramModelSwitchControllerRuntime({
      isIdle,
      getPendingModelSwitch: pendingModelSwitchStore.get,
      setPendingModelSwitch: pendingModelSwitchStore.set,
      getActiveTurn: activeTurnRuntime.get,
      getAbortHandler: abort.getHandler,
      hasAbortHandler: abort.hasHandler,
      getActiveToolExecutions: lifecycle.getActiveToolExecutions,
      allocateItemOrder: queue.allocateItemOrder,
      allocateControlOrder: queue.allocateControlOrder,
      appendQueuedItem: queueMutationRuntime.append,
      updateStatus,
    });
  const getQueueItemCount =
    Queue.createTelegramQueueItemCountGetter(telegramQueueStore);
  const getPromptTemplateCommands =
    PromptTemplates.createTelegramPromptTemplateCommandGetter({
      getCommands,
      getReservedCommandNames: Commands.getTelegramReservedCommandNames,
    });
  const menuActions = Menu.createTelegramMenuActionRuntimeWithStateBuilder({
    runtime: modelMenuRuntime,
    createSettingsManager: Pi.createSettingsManager,
    getActiveModel: currentModelRuntime.get,
    getThinkingLevel,
    getQueueItemCount,
    buildStatusHtml: Commands.createTelegramAppMenuHtmlBuilder({
      buildStatusHtml: Status.createTelegramStatusHtmlBuilder({
        getActiveModel: currentModelRuntime.get,
        isCompactionInProgress: lifecycle.isCompactionInProgress,
      }),
      getPromptTemplateCommands,
    }),
    storeModelMenuState: modelMenuRuntime.storeState,
    isIdle,
    canOfferInFlightModelSwitch: modelSwitchController.canOfferInFlightSwitch,
    sendTextReply,
    editInteractiveMessage,
    sendInteractiveMessage,
    sectionRegistry,

    // Menu/status UI uses this to reflect whether the active Telegram turn expects voice delivery.
    isVoiceReplyActive: function () {
      const turn = activeTurnRuntime.get();
      return Voice.isVoiceTurn(turn);
    },
  });

  // --- Queue And Settings Menus ---

  const getQueueMenuState = Menu.createTelegramModelMenuStateBuilder({
    runtime: modelMenuRuntime,
    createSettingsManager: Pi.createSettingsManager,
    getActiveModel: currentModelRuntime.get,
  });
  const queueMenuRuntime = MenuQueue.createTelegramQueueMenuRuntime({
    telegramQueueStore,
    queueMutationRuntime,
    sendInteractiveMessage,
    editInteractiveMessage,
    answerCallbackQuery,
    getModelMenuState: getQueueMenuState,
    getStoredModelMenuState: modelMenuRuntime.getState,
    storeModelMenuState: modelMenuRuntime.storeState,
    updateStatusMessage: menuActions.updateStatusMessage,
    updateStatus,
  });
  const botProfileSettingsPorts =
    MenuSettings.createTelegramBotProfileSettingsPorts(configStore);
  const settingsMenuRuntime = MenuSettings.createTelegramSettingsMenuRuntime(
    {
      getModelMenuState: getQueueMenuState,
      getStoredModelMenuState: modelMenuRuntime.getState,
      storeModelMenuState: modelMenuRuntime.storeState,
      editInteractiveMessage,
      sendInteractiveMessage,
      answerCallbackQuery,
      ...botProfileSettingsPorts,
      getSessionCwdFromContext: Pi.getExtensionContextCwd,
      getSessionCwd: configStore.getSessionCwd.bind(configStore),
      ...configControls,
    },
    sectionRegistry,
  );

  // --- Polling ---

  const inboundRouteRuntime = Routing.createTelegramInboundRouteRuntime({
    configStore,
    bridgeRuntime,
    activeTurnRuntime,
    mediaGroupRuntime,
    textGroupRuntime,
    telegramQueueStore,
    queueMutationRuntime,
    modelMenuRuntime,
    currentModelRuntime,
    modelSwitchController,
    menuActions,
    updateSettingsMenuMessage: settingsMenuRuntime.updateSettingsMenuMessage,
    openQueueMenu: queueMenuRuntime.openQueueMenu,
    queueMenuCallbackHandler: queueMenuRuntime.handleCallbackQuery,
    openSettingsMenu: settingsMenuRuntime.openSettingsMenu,
    settingsMenuCallbackHandler: settingsMenuRuntime.handleCallbackQuery,
    sectionRegistry,
    buttonActionStore,
    inboundHandlerRuntime,
    updateStatus,
    dispatchNextQueuedTelegramTurn,
    requestDeferredDispatchNextQueuedTelegramTurn:
      deferredQueueDispatchRuntime.request,
    startTypingLoop: promptDispatchRuntime.startTypingLoop,
    stopTypingLoop: typing.stop,
    answerCallbackQuery,
    editInteractiveMessage,
    sendInteractiveMessage,
    deleteMessage: deleteTelegramMessage,
    answerGuestQuery,
    sendTextReply,
    setMyCommands,
    getCommands,
    downloadFile: downloadTelegramBridgeFile,
    resolveTimeLine: timeInjectionRuntime.resolveLine,
    getThinkingLevel,
    setThinkingLevel,
    persistScopedModelPatterns: Pi.createScopedModelPatternPersister({
      createSettingsManager: Pi.createSettingsManager,
      clearCachedModelMenuInputs: modelMenuRuntime.clearCachedInputs,
    }),
    setModel,
    sendUserMessage,
    isIdle,
    hasPendingMessages,
    compact,
    recordRuntimeEvent,
  });
  const multiBotRuntime = MultiBotRuntime.createTelegramMultiBotBridgeRuntime({
    configStore,
    getBotIdForCwd,
    offlineQueue: offlineQueueStore,
    inboundHandleUpdate: inboundRouteRuntime.handleUpdate,
    getContextCwd: Pi.getExtensionContextCwd,
    canStartPolling: Pi.canStartPollingInExtensionContext,
    formatStartBlockedMessage: Pi.formatPollingStartBlockedByRunMode,
    contextStore: telegramSessionContextStore,
    stopTypingLoop: typing.stop,
    updateStatus,
    recordRuntimeEvent,
    statusBridges: multiBotStatusBridges,
  });
  const botConnectionRegistry = multiBotRuntime.botConnectionRegistry;
  const botConnectionRuntime = multiBotRuntime.botConnectionRuntime;
  const lockOwnershipGuard = multiBotRuntime.lockOwnershipGuard;
  const ownsTelegramDirectDelivery =
    multiBotRuntime.ownsTelegramDirectDelivery;
  const queueSessionLifecycle = Queue.createTelegramSessionLifecycleRuntime({
    getCurrentModel: getContextModel,
    loadConfig: Config.createTelegramSessionConfigLoader(configStore),
    setQueuedItems: telegramQueueStore.setQueuedItems,
    setCurrentModel: currentModelRuntime.set,
    setPendingModelSwitch: pendingModelSwitchStore.set,
    syncCounters: queue.syncCounters,
    syncFlags: lifecycle.syncFlags,
    bindDeferredDispatchContext: deferredQueueDispatchRuntime.bind,
    prepareTempDir,
    updateStatus,
    unbindDeferredDispatchContext: deferredQueueDispatchRuntime.unbind,
    clearPendingMediaGroups: TextGroups.createTelegramGroupedInputClearer({
      clearMediaGroups: mediaGroupRuntime.clear,
      clearTextGroups: textGroupRuntime.clear,
    }),
    clearModelMenuState: modelMenuRuntime.clear,
    getActiveTurnChatId: activeTurnRuntime.getChatId,
    clearPreview: previewRuntime.clear,
    clearActiveTurn: activeTurnRuntime.clear,
    clearAbort: abort.clearHandler,
    stopPolling: MultiBotRuntime.createTelegramSessionStopPollingForCwd(
      configStore,
      botConnectionRegistry,
    ),
    recordRuntimeEvent,
  });
  const contextTracker = Lifecycle.createTelegramSessionContextTracker(
    telegramSessionContextStore,
  );
  const sessionLifecycleWithContext = Lifecycle.appendTelegramLifecycleHooks(
    contextTracker,
    queueSessionLifecycle,
  );
  const mergeOfflineQueueForSession =
    MultiBotRuntime.createTelegramOfflineQueueSessionMerger(
      offlineQueueStore,
      telegramQueueStore,
      dispatchNextQueuedTelegramTurn,
      recordRuntimeEvent,
    );
  const baseSessionLifecycleRuntime = Lifecycle.appendTelegramLifecycleHooks(
    sessionLifecycleWithContext,
    {
      onSessionStart: MultiBotRuntime.createTelegramMultiBotSessionStartHook(
        botConnectionRegistry,
        mergeOfflineQueueForSession,
      ),
    },
  );
  const sessionLifecycleRuntime = baseSessionLifecycleRuntime;

  // --- Extension API Bindings ---

  Bindings.registerTelegramCommandsAndTools({
    pi,
    configStore,
    setup,
    activeTurnRuntime,
    lockedPollingRuntime: botConnectionRuntime,
    getStatusLines,
    buttonActionStore,
    sendMarkdownReply,
    callMultipart,
    getDefaultChatId: proactivePushChatIdGetter,
    canSendDirect: ownsTelegramDirectDelivery,
    updateStatus,
    recordRuntimeEvent,
  });

  // --- Lifecycle Hooks ---

  Bindings.registerTelegramLifecycleRuntimeHooks({
    pi,
    sessionLifecycleRuntime: {
      ...sessionLifecycleRuntime,
      onModelSelect: currentModelRuntime.onModelSelect,
    },
    configStore,
    abort,
    typing,
    lifecycle,
    activeTurnRuntime,
    telegramQueueStore,
    modelSwitchController,
    previewRuntime,
    promptDispatchRuntime,
    deferredQueueDispatchRuntime,
    lockOwnershipGuard,
    buttonActionStore,
    callMultipart,
    sendChatAction,
    sendRecordVoiceAction,
    sendMarkdownReply,
    sendTextReply,
    dispatchNextQueuedTelegramTurn,
    answerGuestQuery,
    sendGuestReply,
    finalizeMarkdownPreview,
    proactivePushChatIdGetter,
    isProactivePushEnabled: configControls.isProactivePushEnabled,
    updateStatus,
    recordRuntimeEvent,
  });
}
