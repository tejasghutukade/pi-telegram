# Project Backlog

_Current deterministic status: Threaded Mode implementation, native typing/activity status, regression coverage, docs/context reconciliation, typecheck, full tests, pack check, audit, Domain DAG validation, and context validation are green. This backlog intentionally tracks only open work: live-client/operator verification, evidence-gated Telegram client follow-ups, native Windows smoke, and upstream Pi API blockers._

## P0 — Telegram Native Active Status

Context: For this release, Telegram exposes agent work only through the native client activity affordance. Product language calls it `...active`; Telegram implements it with Bot API `sendChatAction(typing)`, and clients may render it as typing dots. In a concrete thread, only that thread shows active status for its own active agent; in `All`, native active status is an aggregate indicator when any thread is active. This baseline has no chat bubbles, activity verbosity setting, progress document, thinking log, or tool detail log.

Open work:

- [x] Remove the experimental activity verbosity / live-document surface from the release path.
  - Evidence: Telegram settings no longer exposes `Agent activity`, config controls no longer expose activity verbosity getters/setters, and lifecycle hooks use only native typing/activity hooks plus ordinary assistant preview/final reply delivery.
- [x] Implement native active-status-only behavior as the baseline.
  - Evidence: Telegram lifecycle uses native `sendChatAction(typing)` hooks and does not enable progress blocks or retained activity documents.
- [x] Implement Threaded Mode active-status scoping and `All` aggregation.
  - Evidence: target-scoped active status still sends `sendChatAction(typing)` with `message_thread_id` for the concrete Thread, and Threaded Mode additionally sends an aggregate chat-level typing action without `message_thread_id` through the same leader/follower-safe transport path. Concrete Thread correctness remains first; live client rendering still needs visual smoke.
- [ ] Live verify native active status in classic mode and Threaded Mode before release.
  - Expected: Telegram turns produce native `...active`/typing status during work and normal preview/final replies, with no intermediate progress/activity bubbles and no settings control for activity verbosity.

Done when: Telegram agent activity uses only native `...active`/typing status, thread-scoped active status works in classic and Threaded Mode including `All` aggregation or a documented Bot API/client limitation, and tests/docs cover the release behavior.

## P0 — Live Threaded Mode Restore And Lifecycle Smoke

Context: Threaded Mode now has a stable manual model. One visible Pi process is the bus leader; additional visible Pi processes become followers only after the operator runs `/telegram-connect` in each terminal. Telegram does not spawn hidden Pi processes. Unknown user-created threads are preserved, can reroute captured prompts to live targets, and can explicitly restore a stale leader/follower binding. Destructive thread cleanup is routed through `thread-reconciler` with proof-before-delete and leader-epoch fencing.

Recent live-smoke fixes that still need retest:

- Reload after the hard `displayName` → `threadName` rename briefly showed a regenerated terminal status name (`Coral`) while Telegram still showed the existing thread (`Cedar`). Fixed baseline: loader migrates legacy `displayName` fields to `threadName` before provisioning chooses a baked name.
- A newly registered follower created thread `Drift` but its terminal status still showed generic `telegram`. Fixed baseline: status uses the current record's `threadName` directly and no longer hides baked/custom thread names behind the old slot-prefix validator.
- Restoring/replacing from an unbound thread could still rename the Telegram tab or prompt prefix to a bare slot such as `D` when old fallback paths used `threadName ?? slot`, trusted generic labels, or let prompt labels fall back to `slot`. Fixed baseline: visible/prompt thread labels validate stored names and otherwise use baked names; restore/replace preserves valid names such as `Coral`/`Dune`.

Open verification:

- [x] Live retest reload preserves existing Telegram thread name in terminal status.
  - Evidence: after deleting `~/.pi/agent/tmp/telegram` and reloading the remaining leader, the old `Dune` thread still routed prompts and terminal status showed `Dune Leader`.
- [x] Live retest follower `/telegram-connect` mirrors fresh thread name in terminal status.
  - Evidence: after clean-state leader reload preserved `Dune`, a new follower `/telegram-connect` created `Ember`; follower status updated to the assigned thread name instead of generic `Telegram Follower`.
- [ ] Live verify no Threaded Mode route, restore, prompt-prefix, or chooser surface exposes bare slot labels such as `A`/`D` when a baked/custom thread name is available.
  - Expected: prompts use labels such as `[telegram|thread:Dune]`; route/restore buttons, terminal status, `/telegram-status`, and persisted live diagnostics expose baked/custom thread names; invalid/generic legacy labels such as `Follower` degrade to baked names instead of slot letters.
  - Automated evidence: source regressions and the current persisted live diagnostics are clean; latest `state.json` scan exposes baked/custom names (`Birch`, `Dune`, `Ember`, `Falcon`) with `badVisibleNames: 0`. Remaining work is operator/client visual verification of Telegram and terminal surfaces.
- [ ] Live verify restore chooser ordering after reload.
  - Expected: normal route target buttons appear first; `Restore a thread…` appears last; tapping it opens the second chooser.
- [ ] Live verify leader thread restore from the second chooser.
  - Expected: the current leader rebinds to the source thread, keeps/restores thread identity, reroutes the captured prompt, and old leader cleanup goes through `thread-reconciler`.
- [x] Live verify follower thread restore from the second chooser.
  - Evidence: after closing a follower thread, reconnecting the follower, creating an unbound replacement from `All`, and choosing restore for `Grove`, the leader updated the follower binding and the captured prompt routed to the follower after the restore-forwarding fix. A regression now confirms follower restore forwards the captured prompt to the follower instead of enqueueing locally on the leader.
- [ ] Live verify follower `/resume` preserves its assigned Telegram thread.
  - Evidence: a follower registered as slot `C` created a new slot `E` after `/resume` because the manual follower profile key was tied to volatile `telegramInstanceId` instead of a stable per-process manual follower owner.
  - Fixed baseline: manual follower profile keys are now stable per process (`manual:<pid>`) while live `instanceId` still updates for routing/heartbeat; regression coverage confirms same manual profile reuses the existing thread across runtime replacement.
- [x] Live verify follower terminal `new` recovers without stale-context crashes.
  - Evidence: after follower terminal `new`, the old runtime briefly disconnected, the new extension runtime re-registered through a short process-local handoff, a fresh follower thread/slot was created, routing recovered, and the stale-context heartbeat crash was fixed with a regression that swallows stale status updates during follower heartbeat recovery.
- [ ] Live verify documented slot cursor behavior after long-lived state wraps at `Z`.
  - Evidence: `state.json` showed `bot.lastSlot: "Z"`; after `Z`, current allocation wraps to the first free slot such as `A`, which can surprise operators expecting the current visible roster to continue alphabetically.
  - Current policy: this is intentional durable compact-cursor behavior; docs now state that after `Z` a later truly new thread may become `A` again when `A` is currently free.
- [ ] Live verify close/reopen thread lifecycle.
  - Expected: known closed threads become stale; reopened known threads become active; lifecycle observation alone does not perform destructive cleanup.
- [ ] Live verify long text, voice, photo/document, media-group, and stale callback behavior from a Telegram-created unbound thread.
  - Expected: the original prompt/media batch is preserved until explicit route/restore; expired or inactive-target callbacks fail gracefully without queueing stale prompts.
- [x] Live verify clean-state Threaded Mode bootstrap after deleting `tmp/telegram` state.
  - Evidence: after stopping other followers, deleting `~/.pi/agent/tmp/telegram`, and reloading the remaining leader, the existing `Dune` thread was preserved/routed and terminal status showed `Dune Leader`; a new follower then received the next visible sequence name `Ember`, confirming `Dune` → `Ember` continuity without stale cursor drift or generic follower status.
- [x] Live verify compact leader lock and derived bus endpoint after reload/follower connect.
  - Evidence: after leader reload, `~/.pi/agent/locks.json` kept the leader lock without `busSocketPath`; a newly started Pi process ran `/telegram-connect` and registered as a follower through the derived bus endpoint. Because the old unattached-but-open `E` thread was still considered occupied, the new follower received `F/Falcon`; the old `E` thread title was corrected from legacy `Elara` to plain `Ember`, preserving slot/name alignment without assigning that thread to a live follower.
  - Follow-up fix: follower target provisioning no longer blocks registration readiness on connected-announcement delivery or replaced-thread reconciliation cleanup; those non-critical steps now run in the background after the live binding is persisted, with slow critical/background phases recorded as runtime events. Live smoke suggested follower thread usability is materially faster, though Telegram client/server convergence may still add visible variance.
- [x] Deterministic validation after compact lock and baked-name palette polish.
  - Evidence: `npm run validate` passed with 984 tests total, 983 passing, 1 Windows-only skip; `npm audit` reported 0 vulnerabilities; `npm pack --dry-run` succeeded; ABCd context validation passed with 0 warnings and 0 errors.

Done when: live restore/reroute/lifecycle behavior matches deterministic regressions without prompt loss, duplicate live tabs for one instance, hidden process launch, or stale-target deletion surprises.

## P0 — Threaded Mode Delivery Parity Live Matrix

Context: Deterministic coverage already propagates `{ chatId, threadId?}` through prompts, replies, previews, typing/progress, voice, attachments, menus, sections, buttons, reactions, command/control replies, and follower-routed Bot API calls. Mobile Telegram has live-verified correct private-thread reply headers for `sendMessage` + top-level `message_thread_id` + same-chat `reply_parameters.message_id`; Telegram Desktop may omit the visual header despite correct payload.

Open verification:

- [x] Live verify explicit `<!-- telegram_voice: ... -->` in a leader thread.
  - Evidence: explicit hidden `telegram_voice` comment produced the expected voice attachment in the leader/Dune thread.
- [x] Live verify `telegram_button` callbacks in a follower thread.
  - Evidence: after callback routing fell back from message ownership to thread target ownership, follower-authored buttons were live-confirmed to queue prompts in the follower's assigned thread instead of answering `Button action expired`.
- [x] Live verify `telegram_attach` / queued attachment uploads in a follower thread.
  - Evidence: follower attached a text file from its Telegram-originated thread; delivery stayed in the same follower thread through leader transport and did not leak to `All`.
- [x] Live verify proactive local-result push in leader and follower threads.
  - Evidence: true follower proactive push works by default with `telegram.json` `proactivePush: true`, without explicit Telegram tool calls; local/TUI prompt results are delivered to the current instance's assigned thread target rather than `All`, and registered follower instances route the proactive result through the leader transport to their assigned thread.
- [ ] Live verify smart reply threading in leader and follower threads with multi-chunk answers.
  - Expected: first block anchors to the prompt; later blocks stay sequential without stacked reply headers.
- [ ] Live verify photos/documents/media groups, previews/drafts, chat actions, reactions, menus, `/stop`, `/compact`, `/status`, `/model`, and direct local delivery defaults in thread mode.
  - Expected: no leakage to `All`; target-scoped behavior matches classic DM semantics unless explicitly documented.
- [ ] Live verify companion extensions in Threaded Mode.
  - Scope: companion sections, extension commands, update/inbound/outbound handlers, voice transcription/synthesis providers, and command-template-backed providers.
  - Expected: companion replies, callbacks, generated buttons, handler outputs, and artifact uploads preserve the invoking leader/follower thread target and route through the leader transport when invoked from a follower.
Done when: each classic Telegram feature is either live-confirmed in Threaded Mode or recorded as a documented client/transport exception with minimized evidence.

## P0 — Native Windows Threaded Mode Support

Context: Threaded Mode currently uses a local bus socket path under the agent temp directory for leader/follower communication. This must be verified and adapted for native Windows environments without requiring WSL. Windows support is required for the extension's cross-platform story.

Open work:

- [x] Audit every filesystem, path, lock, temp-file, process, and local-bus assumption on native Windows.
  - Baseline: `docs/multi-instance-bus.md` records the current portability audit: bus endpoints are adapted to named pipes, POSIX socket chmod/unlink is skipped for pipes, lock/config/temp paths remain under the agent dir, process liveness uses Node's Windows-supported `process.kill(pid, 0)`, and provider shell commands remain operator/platform-dependent.
- [x] Replace the local-bus Unix-domain socket path with a Windows-compatible named-pipe address when `process.platform === "win32"`.
  - Baseline: bus and follower receiver addresses now use deterministic `\\.\pipe\pi-telegram-...` names derived from the agent directory and endpoint scope.
- [x] Add deterministic tests for Windows path/transport selection and IPC address construction.
- [ ] Ensure leader/follower `/telegram-connect`, follower heartbeat, forwarded Bot API calls, restore flows, lifecycle announcements, and shutdown cleanup work on Windows.
  - Partial baseline: the existing local IPC client/server uses Node `net` with either Unix sockets or Windows named-pipe paths; deterministic path tests run everywhere, and a Windows-only named-pipe roundtrip regression runs when the suite executes on `win32`. Live Windows smoke remains unavailable in this environment.
- [x] Add manual smoke instructions for native Windows terminals, explicitly not relying on WSL.
  - Baseline: `docs/multi-instance-bus.md` now includes a native Windows smoke plan covering leader/follower connect, callback routing, voice/attachment transport, follower pruning, and diagnostics capture.

Done when: Threaded Mode leader/follower operation works on native Windows with the same safety guarantees as Unix-like systems, and unsupported transport assumptions are covered by tests/docs.

## P1 — Evidence-Backed Rich Markdown Normalization

Context: Native Rich Markdown is the default assistant delivery path. Existing regressions cover known parser/client edges such as space-after-marker blockquotes, dollar-prefixed ticker atoms, list indentation, code fences, links, display math normalization, and long-message splitting. Further rewrites should be evidence-driven, not speculative.

Open work:

- [ ] Capture any new Telegram parser-breaking sequence from live/client evidence or a minimized fixture.
- [ ] Add a conservative normalization or safe-degradation rule only for confirmed sequences.
- [ ] Keep unconfirmed speculative rewrites out of the delivery path.

Done when: newly observed Rich Markdown failures have minimized fixtures and targeted regressions, while stable rendering behavior remains unchanged for unsupported guesses.

## P1 — Rich Draft `<tg-thinking>` Visual Smoke

Blocked: requires operator visual confirmation in Telegram clients.

Context: `<tg-thinking>` / `RichBlockThinking` is draft-only and not part of persisted final messages. It may be useful as a pre-token placeholder, but only if Telegram clients render and clear it cleanly.

Open verification:

- [ ] Confirm the placeholder keeps the draft visibly alive during the initial unsafe streaming window.
- [ ] Confirm the draft replaces cleanly when safe content arrives.
- [ ] Confirm abort clears the placeholder without leaving stale draft UI.

Done when: the feature is either promoted behind an explicit UX decision with live evidence or left unused as a documented draft-only primitive.

## Blocked — Same-Thread Telegram `/new`

Blocked: upstream Pi core API. Issue: https://github.com/earendil-works/pi/issues/5952

Context: Threaded Mode manual followers are separate visible Pi processes. Same-thread `/new` is a different feature: replacing the current Pi session inside the same Telegram thread. Extension-only hacks are rejected because they would desynchronize Pi lifecycle/TUI semantics.

Required upstream shape:

- `pi.newSession(...)` or `pi.requestSessionReplacement(...)` callable from trusted extension runtime code.
- Must use the same session-replacement path as the terminal command, including normal `session_shutdown` / `session_start` lifecycle.

Constraints:

- Do not store stale `ExtensionCommandContext`.
- Do not inject TUI input.
- Do not spawn a shadow `pi` subprocess.
- Do not mutate session files directly.
- Do not route through `pi.exec`; it is shell execution, not a Pi slash-command dispatcher.

Done when: `/new` in the current Telegram thread performs an official same-instance session replacement, preserves the thread binding, rebinds after lifecycle restart, reports success/cancellation in the same thread, and has regressions for active turns, pending Pi messages, queue state, preview cleanup, cancellation, failure, and success.
