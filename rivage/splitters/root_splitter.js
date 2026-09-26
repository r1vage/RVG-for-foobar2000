'use strict';

window.DefineScript('RVG Root Splitter', {
    author: 'RivaGe',
    version: '1.10.0',
    features: { drag_n_drop: false, grab_focus: false }
});

// Native child wrappers are reacquired for every layout pass because JSplitter
// can rebuild its child collection without changing this panel's dimensions.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\divider_highlight.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\miniplayer_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\quick_switcher_protocol.js');

const TOP_HEIGHT_PROPERTY = 'RIVAGE.Layout.Root.TopBarHeight';
const TOP_BUTTONS_WIDTH_PROPERTY = 'RIVAGE.Layout.Root.TopButtonsWidth';

// Mini Player - see MINI_PLAYER_SETUP.md. This splitter owns both the panel
// tree and the main window's geometry, so it is the sole place that shrinks/
// restores the window and swaps the normal layout for the MINI PLAYER panel.
const MINI_PANEL_CAPTION = 'MINI PLAYER';
const MINI_NORMAL_RECT_PROPERTY = 'RIVAGE.MiniPlayer.NormalRect';
const MINI_RECT_PROPERTY = 'RIVAGE.MiniPlayer.Rect';
const MINI_WAS_ACTIVE_PROPERTY = 'RIVAGE.MiniPlayer.WasActive';
const MINI_PREV_ALWAYS_ON_TOP_PROPERTY = 'RIVAGE.MiniPlayer.PrevAlwaysOnTop';
const MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY = 'RIVAGE.MiniPlayer.PrevLockWindowSize';
// Separate from WasActive on purpose: that one arms a geometry restore, and arming
// it for a policy the host refuses would resize a healthy window on every load.
const MINI_POLICY_RESTORE_PENDING_PROPERTY = 'RIVAGE.MiniPlayer.PolicyRestorePending';
const MINI_LOCK_WINDOW_COMMANDS = ['View/Lock Window Size', 'View/Lock window size'];
// Long enough for the main window's own resize to finish before the policy is
// re-asserted, short enough that the user never sees the intermediate state.
const ALWAYS_ON_TOP_RETRY_DELAY = 200;
const MINI_DEFAULT_WIDTH = 340;
const MINI_DEFAULT_HEIGHT = 120;
// A rect this small is treated as unusable rather than trusted - guards a
// corrupted property and an all-zero readout during host startup alike.
const MINI_MIN_SIZE = 80;

// Quick switcher - optional TopMost child captioned QUICK SWITCHER, floated
// centred near the top while open. Absent panel = feature off, nothing else changes.
const QUICK_SWITCHER_TOP_FRACTION = 0.12;
const QUICK_SWITCHER_MARGIN = 16;
// The command lives here, not in the switcher: JSplitter does not run a hidden
// panel's script at startup, so a command registered there vanished on launch
// and foobar2000 dropped its keyboard shortcut.
const QUICK_SWITCHER_MENU_ID = 1;
let quickSwitcherOpen = false;
let quickSwitcherSize = { w: 640, h: 520 };

const DEFAULT_TOP_BAR_HEIGHT = 72;
const DIVIDER_SIZE = 6;
const MIN_TOP_BAR_HEIGHT = 20;
const MIN_BODY_HEIGHT = 200;
const MIN_TOP_BAR_WIDTH = 160;
// Keep enough of the row for Top bar even if a strip reports an excessive width.
const MAX_TOP_BUTTONS_FRACTION = 0.5;

const CUSTOM_BUTTONS_MEASURE = 'RIVAGE.CUSTOM_BUTTONS.MEASURE.V1';
const CUSTOM_BUTTONS_MEASURE_REQUEST = 'RIVAGE.CUSTOM_BUTTONS.MEASURE_REQUEST.V1';
const TOP_BUTTONS_SLOT = 'root-top';

const MEASURE_MAX_ATTEMPTS = 25;
const MEASURE_FAST_ATTEMPTS = 10;
const MEASURE_FAST_DELAY = 100;
const MEASURE_SLOW_DELAY = 500;

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_RETRY_DELAY = 30;
const RECOVERY_RETRY_DELAY = 1500;

// Persisted width breaks the hidden-child startup deadlock: a collapsed strip
// cannot publish a fresh measurement until the parent makes it visible again.
let topButtonsWidth = readSavedTopButtonsWidth();
let topButtonsPresent = false;
let measureAnswered = false;
let measureAttempts = 0;
// The first valid producer owns this managed child until it disappears/reappears.
let measureOrigin = '';
let measureTimer = null;

let preferredTopBarHeight = readSavedTopBarHeight();
let lastSavedTopBarHeight = preferredTopBarHeight;
let resizingModeEnabled = true;
let draggingDivider = false;
let backgroundColour = getBackgroundColour();
let scriptActive = true;
let miniModeActive = false;
// A Mini Player transition changes the outer rectangle and which child owns the root
// surface, so force one fresh Mica epoch once the replacement layout is committed.
let miniBackdropRefreshPending = false;
let miniPlayerSettings = MiniPlayerProtocol.defaultSettings();

let layoutPending = true;
let layoutBusy = false;
let workScheduled = false;
let workTimer = null;
let retryScheduled = false;
let retryTimer = null;
let transientRetryCount = 0;
let recoveryRetryMode = false;

const dividerHighlight = DividerHighlight.create({
    orientation: 'horizontal',
    repaint: repaintDivider
});

window.EraseOnRepaint = false;

// Narrow diagnostics. The remaining empty catches guard calls that are *expected*
// to fail - an already-fired timer, the two spellings of Lock Window Size - and stay
// silent on purpose. `once` suppresses repeats so a re-entered path cannot flood.
const reportedDiagnostics = {};
function logDiagnostic(message, once) {
    const text = '[RVG Root Splitter] ' + message;
    if (once) {
        if (reportedDiagnostics[text]) return;
        reportedDiagnostics[text] = true;
    }
    // Nothing to fall back on if console itself is unavailable.
    try { console.log(text); } catch (e) { }
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function readSavedTopBarHeight() {
    let value = Number(window.GetProperty(TOP_HEIGHT_PROPERTY, DEFAULT_TOP_BAR_HEIGHT));
    if (!isFinite(value)) value = DEFAULT_TOP_BAR_HEIGHT;
    return Math.max(0, Math.round(value));
}

function readSavedTopButtonsWidth() {
    const value = Number(window.GetProperty(TOP_BUTTONS_WIDTH_PROPERTY, 0));
    return isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function saveLayout() {
    const value = Math.max(0, Math.round(preferredTopBarHeight));
    if (value === lastSavedTopBarHeight) return true;

    try {
        window.SetProperty(TOP_HEIGHT_PROPERTY, value);
        lastSavedTopBarHeight = value;
        return true;
    } catch (e) {
        return false;
    }
}

function saveTopButtonsWidth() {
    try {
        window.SetProperty(TOP_BUTTONS_WIDTH_PROPERTY, Math.max(0, Math.round(topButtonsWidth)));
        return true;
    } catch (e) {
        return false;
    }
}

function acquirePanel(caption) {
    try {
        return { panel: window.GetPanel(caption), ok: true };
    } catch (e) {
        return { panel: null, ok: false };
    }
}

function preparePanel(panel) {
    if (!panel) return false;

    try {
        if (panel.ShowCaption !== false) panel.ShowCaption = false;
        if (panel.Locked !== true) panel.Locked = true;
        RivageBackdrop.configureChildPanel(panel);
        return true;
    } catch (e) {
        return false;
    }
}

function movePanel(panel, x, y, width, height) {
    if (!panel) return false;

    try {
        if (
            Number(panel.X) !== x || Number(panel.Y) !== y ||
            Number(panel.Width) !== width || Number(panel.Height) !== height
        ) {
            panel.Move(x, y, width, height);
        }
        RivageBackdrop.noteChildPanel(panel);
        return true;
    } catch (e) {
        return false;
    }
}

function showPanel(panel, visible) {
    if (!panel) return false;

    try {
        if (!!panel.Hidden === !!visible) panel.Show(visible);
        RivageBackdrop.noteChildPanel(panel);
        return true;
    } catch (e) {
        return false;
    }
}

function hostIsVisible() {
    try {
        let visible = window.IsVisible;
        if (typeof visible === 'function') visible = visible.call(window);
        if (typeof visible === 'undefined' || visible === null) return true;
        return !!visible;
    } catch (e) {
        return true;
    }
}

function getBackgroundColour() {
    try {
        return RivageUI.createTheme({ mode: 'host' }).background;
    } catch (e) { }

    try {
        return window.GetColourCUI(3);
    } catch (e2) { }

    try {
        return window.GetColourDUI(1);
    } catch (e) { }

    logDiagnostic('neither GetColourCUI nor GetColourDUI is available; ' +
        'the divider is using a hardcoded fallback colour.', true);
    return 0xff202124;
}

// Mini Player - window geometry + mode switching

function readJsonProperty(name) {
    let raw;
    try {
        raw = window.GetProperty(name, '');
    } catch (e) {
        return null;
    }
    if (!raw) return null;

    try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' ? value : null;
    } catch (e) {
        return null;
    }
}

function writeJsonProperty(name, value) {
    try {
        window.SetProperty(name, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

function writeProperty(name, value) {
    try {
        window.SetProperty(name, value);
        return true;
    } catch (e) {
        return false;
    }
}

function readBooleanProperty(name, fallback) {
    try {
        return !!window.GetProperty(name, !!fallback);
    } catch (e) {
        return !!fallback;
    }
}

function isWindowSizeLocked() {
    for (let i = 0; i < MINI_LOCK_WINDOW_COMMANDS.length; i++) {
        try {
            if (fb.IsMainMenuCommandChecked(MINI_LOCK_WINDOW_COMMANDS[i])) return true;
        } catch (e) { }
    }
    return false;
}

function setWindowSizeLocked(locked) {
    const desired = !!locked;
    if (isWindowSizeLocked() === desired) return true;

    for (let i = 0; i < MINI_LOCK_WINDOW_COMMANDS.length; i++) {
        try {
            fb.RunMainMenuCommand(MINI_LOCK_WINDOW_COMMANDS[i]);
        } catch (e) { }
        // Do not trust RunMainMenuCommand's return value: some builds execute
        // a toggle and still return false. The checked state is authoritative.
        if (isWindowSizeLocked() === desired) return true;
    }
    return isWindowSizeLocked() === desired;
}

function isAlwaysOnTop() {
    try {
        return !!fb.AlwaysOnTop;
    } catch (e) {
        return false;
    }
}

// Read back; the observed state is authoritative. A write issued mid-resize can be
// swallowed, and through v1.2.0 the assignment alone was trusted - the next enter
// then captured the leaked "on" as the state to restore, making the leak permanent.
function setAlwaysOnTop(enabled) {
    const desired = !!enabled;

    try {
        fb.AlwaysOnTop = desired;
    } catch (e) {
        return isAlwaysOnTop() === desired;
    }
    return isAlwaysOnTop() === desired;
}

// Second chance for a policy the host swallowed mid-resize. Deferred rather
// than looped, because the window rectangle has to settle first; a single
// retry is enough for that race and cannot spin.
function setAlwaysOnTopDeferred(enabled) {
    const desired = !!enabled;
    try {
        window.SetTimeout(function () {
            if (isAlwaysOnTop() === desired) return;
            if (setAlwaysOnTop(desired)) return;
            logDiagnostic('Mini Player: always-on-top could not be set to ' +
                desired + '; the host refused the change.');
        }, ALWAYS_ON_TOP_RETRY_DELAY);
        return true;
    } catch (e) {
        return false;
    }
}

// Applies an always-on-top target and, when the immediate write did not take,
// re-asserts it once the geometry change has settled.
function setAlwaysOnTopVerified(enabled) {
    if (setAlwaysOnTop(enabled)) return true;
    setAlwaysOnTopDeferred(enabled);
    return false;
}

function applyActiveMiniPolicies() {
    if (!miniModeActive) return true;

    // These are Mini Player policies, not inherited normal-window policies.
    // The previous values are kept only for the exit/recovery transaction.
    const topOk = setAlwaysOnTopVerified(miniPlayerSettings.alwaysOnTop);
    const lockOk = setWindowSizeLocked(miniPlayerSettings.lockWindowSize);
    return topOk && lockOk;
}

function isPolicyRestorePending() {
    return readBooleanProperty(MINI_POLICY_RESTORE_PENDING_PROPERTY, false);
}

// The one place that restores the normal window's policies, shared by exit, startup
// recovery and the pending pass. A policy is restored only if its "restore on exit"
// setting is on; `force` skips that check, and both startup paths pass it because
// the real settings have not been broadcast yet. A policy that did not verify arms
// the pending marker, so a swallowed write is retried on the next load.
function restoreNormalWindowPolicies(prevAlwaysOnTop, prevLockWindowSize, context, force) {
    const restoreTop = force || miniPlayerSettings.restoreAlwaysOnTop;
    const restoreLock = force || miniPlayerSettings.restoreLockWindowSize;
    const topRestored = restoreTop ? setAlwaysOnTopVerified(prevAlwaysOnTop) : true;
    const lockRestored = restoreLock ? setWindowSizeLocked(prevLockWindowSize) : true;
    const pending = !topRestored || !lockRestored;

    writeProperty(MINI_POLICY_RESTORE_PENDING_PROPERTY, pending);
    if (pending) {
        logDiagnostic('Mini Player: ' + context +
            ' could not restore a previous normal-window policy; it will be retried shortly ' +
            'and again on the next script load.');
    }
    return !pending;
}

// Re-applies only the policies, never the geometry. Runs at load for the case
// the geometry restore already succeeded (so WasActive is clear) but the
// always-on-top or lock write was swallowed.
function retryPendingPolicyRestore() {
    if (!isPolicyRestorePending()) return;
    restoreNormalWindowPolicies(
        readBooleanProperty(MINI_PREV_ALWAYS_ON_TOP_PROPERTY, false),
        readBooleanProperty(MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY, false),
        'startup policy retry',
        true
    );
}

function adoptMiniPlayerSettings(settings) {
    const next = MiniPlayerProtocol.normaliseSettings(settings, miniPlayerSettings);
    const policyChanged = next.lockWindowSize !== miniPlayerSettings.lockWindowSize ||
        next.alwaysOnTop !== miniPlayerSettings.alwaysOnTop;

    miniPlayerSettings = next;
    if (!policyChanged || !miniModeActive) return;

    if (!applyActiveMiniPolicies()) {
        logDiagnostic('Mini Player: an active window policy could not be applied.');
    }
}

function isUsableRect(rect) {
    return !!rect &&
        isFinite(rect.x) && isFinite(rect.y) && isFinite(rect.w) && isFinite(rect.h) &&
        rect.w >= MINI_MIN_SIZE && rect.h >= MINI_MIN_SIZE;
}

function readCurrentWindowRect() {
    return {
        x: Math.round(Number(window.FoobarWindowX) || 0),
        y: Math.round(Number(window.FoobarWindowY) || 0),
        w: Math.round(Number(window.FoobarWindowWidth) || 0),
        h: Math.round(Number(window.FoobarWindowHeight) || 0)
    };
}

function applyWindowRect(rect) {
    try {
        window.FoobarWindowWidth = rect.w;
        window.FoobarWindowHeight = rect.h;
        window.FoobarWindowX = rect.x;
        window.FoobarWindowY = rect.y;
        return true;
    } catch (e) {
        return false;
    }
}

function defaultMiniRect(normalRect) {
    const w = clamp(MINI_DEFAULT_WIDTH, MINI_MIN_SIZE, Math.max(MINI_MIN_SIZE, normalRect.w));
    const h = clamp(MINI_DEFAULT_HEIGHT, MINI_MIN_SIZE, Math.max(MINI_MIN_SIZE, normalRect.h));
    return {
        x: Math.round(normalRect.x + (normalRect.w - w) / 2),
        y: Math.round(normalRect.y + (normalRect.h - h) / 2),
        w: w,
        h: h
    };
}

function layoutQuickSwitcher(width, height) {
    const result = acquirePanel(QuickSwitcherProtocol.CAPTION);
    if (!result.ok) return false;
    const panel = result.panel;
    if (!panel) return true;
    if (!quickSwitcherOpen || miniModeActive) return showPanel(panel, false);

    const w = clamp(quickSwitcherSize.w, 1, Math.max(1, width - QUICK_SWITCHER_MARGIN * 2));
    const y = Math.round(height * QUICK_SWITCHER_TOP_FRACTION);
    const h = clamp(quickSwitcherSize.h, 1, Math.max(1, height - y - QUICK_SWITCHER_MARGIN));
    const x = Math.round((width - w) / 2);
    if (!preparePanel(panel)) return false;
    try {
        if (panel.TopMost !== true) panel.TopMost = true;
    } catch (e) {
        logDiagnostic('Quick switcher: the panel could not be raised above the layout: ' + e, true);
    }
    return movePanel(panel, x, y, w, h) && showPanel(panel, true);
}

function openQuickSwitcher(size) {
    const check = acquirePanel(QuickSwitcherProtocol.CAPTION);
    if (miniModeActive || !check.ok || !check.panel) {
        if (check.ok && !check.panel) {
            logDiagnostic('Quick switcher: no panel captioned "' + QuickSwitcherProtocol.CAPTION +
                '" in this layout - see QUICK_SWITCHER_SETUP.md.', true);
        }
        QuickSwitcherProtocol.state(false);
        return;
    }
    if (size) quickSwitcherSize = size;
    quickSwitcherOpen = true;
    requestDeferredLayout(true);
    QuickSwitcherProtocol.state(true);
}

function toggleQuickSwitcher() {
    if (quickSwitcherOpen) closeQuickSwitcher();
    else openQuickSwitcher(null);
}

function on_main_menu_dynamic(id) {
    if (id === QUICK_SWITCHER_MENU_ID) toggleQuickSwitcher();
}

function closeQuickSwitcher() {
    if (!quickSwitcherOpen) return;
    quickSwitcherOpen = false;
    requestDeferredLayout(true);
    QuickSwitcherProtocol.state(false);
}

function hideMiniPanel() {
    const miniResult = acquirePanel(MINI_PANEL_CAPTION);
    if (!miniResult.ok) return false;
    if (!miniResult.panel) return true;
    return showPanel(miniResult.panel, false);
}

function layoutMiniMode(width, height) {
    const miniResult = acquirePanel(MINI_PANEL_CAPTION);
    const topBarResult = acquirePanel('Top bar');
    const bodyResult = acquirePanel('BODY');
    const topButtonsResult = acquirePanel('TOP BUTTONS');
    let complete = miniResult.ok && topBarResult.ok && bodyResult.ok && topButtonsResult.ok;
    let miniReady = false;

    // Make the replacement panel ready before hiding the normal layout. A
    // transient native wrapper failure can then leave the ordinary UI visible
    // instead of producing a blank mini-sized window until the retry lands.
    if (!miniResult.panel) {
        complete = false;
    } else {
        miniReady = preparePanel(miniResult.panel);
        if (!miniReady) complete = false;
        if (miniReady && !movePanel(miniResult.panel, 0, 0, width, height)) {
            miniReady = false;
            complete = false;
        }
        if (miniReady && !showPanel(miniResult.panel, true)) {
            miniReady = false;
            complete = false;
        }
    }

    if (miniReady) {
        if (!layoutQuickSwitcher(width, height)) complete = false;
        if (topBarResult.panel && !showPanel(topBarResult.panel, false)) complete = false;
        if (bodyResult.panel && !showPanel(bodyResult.panel, false)) complete = false;
        if (topButtonsResult.panel && !showPanel(topButtonsResult.panel, false)) complete = false;
    }

    return complete;
}

// No-ops if the layout has no panel captioned MINI PLAYER (see MINI_PLAYER_SETUP.md);
// shrinking with nothing to show would leave a tiny empty window with no way back.
function enterMiniMode() {
    if (miniModeActive) return;

    const miniPanelCheck = acquirePanel(MINI_PANEL_CAPTION);
    if (!miniPanelCheck.ok || !miniPanelCheck.panel) {
        logDiagnostic('Mini Player: no panel captioned "' + MINI_PANEL_CAPTION +
            '" found in this layout. Add one (running miniplayer_panel.js) before using Mini Player - see MINI_PLAYER_SETUP.md.');
        return;
    }

    const normalRect = readCurrentWindowRect();
    if (!isUsableRect(normalRect)) {
        logDiagnostic('Mini Player: the current foobar2000 window rectangle is not usable; enter was cancelled.');
        return;
    }

    // Never record a "previous" state Mini Player itself may have set: after an
    // incomplete restore the saved values are still the real normal-window ones.
    const policyRestorePending = isPolicyRestorePending();
    const prevAlwaysOnTop = policyRestorePending
        ? readBooleanProperty(MINI_PREV_ALWAYS_ON_TOP_PROPERTY, false)
        : isAlwaysOnTop();
    const prevLockWindowSize = policyRestorePending
        ? readBooleanProperty(MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY, false)
        : isWindowSizeLocked();
    if (policyRestorePending) {
        logDiagnostic('Mini Player: a previous policy restore never completed; ' +
            'keeping the normal-window policies saved then rather than the current ones.');
    }

    // Persisted before anything changes, so a crash/forced-close mid-toggle
    // still has a normal rect to recover to on the next launch. Refuse to enter
    // if any load-bearing restore state cannot be written.
    const restoreStateSaved =
        writeJsonProperty(MINI_NORMAL_RECT_PROPERTY, normalRect) &&
        writeProperty(MINI_PREV_ALWAYS_ON_TOP_PROPERTY, prevAlwaysOnTop) &&
        writeProperty(MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY, prevLockWindowSize) &&
        writeProperty(MINI_WAS_ACTIVE_PROPERTY, true);
    if (!restoreStateSaved) {
        writeProperty(MINI_WAS_ACTIVE_PROPERTY, false);
        logDiagnostic('Mini Player: restore state could not be saved; enter was cancelled.');
        return;
    }

    let miniRect = readJsonProperty(MINI_RECT_PROPERTY);
    if (!isUsableRect(miniRect)) miniRect = defaultMiniRect(normalRect);

    // The main-menu lock blocks FoobarWindowWidth/Height writes. Temporarily
    // release it for the compact resize, then apply the Mini Player policy.
    if (!setWindowSizeLocked(false)) {
        writeProperty(MINI_WAS_ACTIVE_PROPERTY, false);
        logDiagnostic('Mini Player: window-size lock could not be released; enter was cancelled.');
        return;
    }

    miniModeActive = true;
    miniBackdropRefreshPending = true;
    closeQuickSwitcher();
    requestDeferredLayout(true);
    if (!applyWindowRect(miniRect)) {
        miniModeActive = false;
        miniBackdropRefreshPending = true;
        requestDeferredLayout(true);
        const rollbackRestored = applyWindowRect(normalRect);
        const rollbackLockRestored = setWindowSizeLocked(prevLockWindowSize);
        // A partial compact rectangle is recoverable on the next load, but a failed
        // policy command must not trap startup on a host lacking that menu command.
        writeProperty(MINI_WAS_ACTIVE_PROPERTY, !rollbackRestored);
        logDiagnostic('Mini Player: the compact window rectangle could not be applied; enter was rolled back.');
        if (!rollbackLockRestored) {
            logDiagnostic('Mini Player: the previous window-size lock state could not be restored after rollback.');
        }
        return;
    }
    const topApplied = setAlwaysOnTopVerified(miniPlayerSettings.alwaysOnTop);
    const lockApplied = setWindowSizeLocked(miniPlayerSettings.lockWindowSize);
    if (!topApplied || !lockApplied) {
        logDiagnostic('Mini Player: compact window policy could not be fully applied.');
    }

    MiniPlayerProtocol.broadcastState(true);
}

// Asks to exit Mini Player back to the normal layout.
function exitMiniMode() {
    if (!miniModeActive) return;

    // Captures wherever the user last dragged/resized the mini window, so it
    // reopens there next time rather than snapping back to the default spot.
    const liveMiniRect = readCurrentWindowRect();
    if (isUsableRect(liveMiniRect)) writeJsonProperty(MINI_RECT_PROPERTY, liveMiniRect);

    const normalRect = readJsonProperty(MINI_NORMAL_RECT_PROPERTY);
    const prevAlwaysOnTop = readBooleanProperty(MINI_PREV_ALWAYS_ON_TOP_PROPERTY, false);
    const prevLockWindowSize = readBooleanProperty(MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY, false);

    miniModeActive = false;
    miniBackdropRefreshPending = true;
    requestDeferredLayout(true);

    const lockReleased = setWindowSizeLocked(false);
    const normalRectRestored = lockReleased && isUsableRect(normalRect) && applyWindowRect(normalRect);
    restoreNormalWindowPolicies(prevAlwaysOnTop, prevLockWindowSize, 'exit', false);
    // Only a failed geometry restore keeps this marker; a policy that did not take
    // arms its own - see restoreNormalWindowPolicies().
    writeProperty(MINI_WAS_ACTIVE_PROPERTY, !normalRectRestored);
    if (!normalRectRestored) {
        logDiagnostic('Mini Player: the normal window rectangle could not be restored; startup recovery remains armed.');
    }

    MiniPlayerProtocol.broadcastState(false);
}

// Recovers from an unclean exit: foobar2000 would otherwise reopen at the tiny saved
// size with no way back, since the control that restores it is in the hidden layout.
// Every load comes up normal-sized; Mini Player never resumes automatically.
function recoverFromUncleanMiniExit() {
    if (!readBooleanProperty(MINI_WAS_ACTIVE_PROPERTY, false)) return;
    miniBackdropRefreshPending = true;

    const normalRect = readJsonProperty(MINI_NORMAL_RECT_PROPERTY);
    const prevAlwaysOnTop = readBooleanProperty(MINI_PREV_ALWAYS_ON_TOP_PROPERTY, false);
    const prevLockWindowSize = readBooleanProperty(MINI_PREV_LOCK_WINDOW_SIZE_PROPERTY, false);

    const lockReleased = setWindowSizeLocked(false);
    const normalRectRestored = lockReleased && isUsableRect(normalRect) && applyWindowRect(normalRect);
    restoreNormalWindowPolicies(prevAlwaysOnTop, prevLockWindowSize, 'startup recovery', true);
    writeProperty(MINI_WAS_ACTIVE_PROPERTY, !normalRectRestored);
    if (!normalRectRestored) {
        logDiagnostic('Mini Player: startup recovery could not restore the saved normal window rectangle; it will retry on the next script load.');
    }
}

function setResizingModeEnabled(enabled) {
    const nextEnabled = !!enabled;
    if (nextEnabled === resizingModeEnabled) return;

    if (!nextEnabled) {
        if (draggingDivider) {
            draggingDivider = false;
            saveLayout();
        }
        dividerHighlight.dragging(false);
        dividerHighlight.hover(false);
    }

    resizingModeEnabled = nextEnabled;
    requestDeferredLayout(true);
    repaintDivider();
}

function getDividerHeight() {
    if (!resizingModeEnabled) return 0;
    return Math.min(DIVIDER_SIZE, Math.max(0, window.Height));
}

function getAvailableHeight() {
    return Math.max(0, window.Height - getDividerHeight());
}

function getMinimumTopBarHeight() {
    return Math.min(MIN_TOP_BAR_HEIGHT, getAvailableHeight());
}

function getMaximumTopBarHeight() {
    const availableHeight = getAvailableHeight();
    const minimumHeight = getMinimumTopBarHeight();
    return Math.max(minimumHeight, availableHeight - MIN_BODY_HEIGHT);
}

function getTopBarHeight() {
    const availableHeight = getAvailableHeight();
    if (availableHeight <= 0) return 0;

    return clamp(
        preferredTopBarHeight,
        getMinimumTopBarHeight(),
        getMaximumTopBarHeight()
    );
}

function isOverDivider(y) {
    const dividerY = getTopBarHeight();
    const dividerHeight = getDividerHeight();
    return dividerHeight > 0 && y >= dividerY && y < dividerY + dividerHeight;
}

function repaintDivider() {
    const dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return;

    window.RepaintRect(
        0,
        getTopBarHeight(),
        Math.max(0, window.Width),
        dividerHeight
    );
}

function clearMeasureTimer() {
    if (measureTimer !== null) {
        try { window.ClearTimeout(measureTimer); } catch (e) { }
    }
    measureTimer = null;
}

function resetMeasureState(hasPanel) {
    clearMeasureTimer();
    measureAnswered = false;
    measureAttempts = 0;
    measureOrigin = '';
    topButtonsPresent = !!hasPanel;
}

function getTopButtonsWidth(width, hasPanel) {
    if (!hasPanel) return 0;

    return clamp(
        Math.round(topButtonsWidth),
        0,
        Math.min(
            Math.round(width * MAX_TOP_BUTTONS_FRACTION),
            Math.max(0, width - MIN_TOP_BAR_WIDTH)
        )
    );
}

function layoutPanels() {
    const width = Math.max(0, window.Width);
    const height = Math.max(0, window.Height);

    if (miniModeActive) return layoutMiniMode(width, height);

    const dividerHeight = getDividerHeight();
    const topBarHeight = getTopBarHeight();
    const bodyY = topBarHeight + dividerHeight;
    const bodyHeight = Math.max(0, height - bodyY);

    const topBarResult = acquirePanel('Top bar');
    const bodyResult = acquirePanel('BODY');
    const topButtonsResult = acquirePanel('TOP BUTTONS');
    let complete = topBarResult.ok && bodyResult.ok && topButtonsResult.ok;

    const hasTopButtons = topButtonsResult.ok
        ? !!topButtonsResult.panel
        : topButtonsPresent;
    if (topButtonsResult.ok && hasTopButtons !== topButtonsPresent) {
        resetMeasureState(hasTopButtons);
    }

    const buttonsWidth = getTopButtonsWidth(width, hasTopButtons);
    const topBarWidth = Math.max(0, width - buttonsWidth);
    let panel = topBarResult.panel;

    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, 0, topBarWidth, topBarHeight)) complete = false;
        // Mini mode hides this child with Show(false); moving it again does not
        // make it visible. Reassert visibility on every normal-layout pass so
        // both an ordinary exit and startup crash recovery restore the UI.
        if (!showPanel(panel, true)) complete = false;
        panel = null;
    }

    panel = topButtonsResult.panel;
    if (panel) {
        if (!preparePanel(panel)) complete = false;
        if (buttonsWidth > 0) {
            if (!movePanel(panel, topBarWidth, 0, buttonsWidth, topBarHeight)) complete = false;
            if (!showPanel(panel, true)) complete = false;
        } else if (!showPanel(panel, false)) {
            complete = false;
        }
        panel = null;
    }

    panel = bodyResult.panel;
    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, bodyY, width, bodyHeight)) complete = false;
        if (!showPanel(panel, true)) complete = false;
        panel = null;
    }

    // Keep the mini view covering the window until the complete normal layout
    // is ready behind it. This makes exit/recovery transactional: a transient
    // child-wrapper failure cannot expose a blank or half-restored main window.
    if (complete && !hideMiniPanel()) complete = false;
    if (!layoutQuickSwitcher(width, height)) complete = false;

    return complete;
}

function cancelRetryTimer() {
    if (retryTimer !== null) {
        try { window.ClearTimeout(retryTimer); } catch (e) { }
    }
    retryTimer = null;
    retryScheduled = false;
}

function resetRetryLane() {
    transientRetryCount = 0;
    recoveryRetryMode = false;
}

function scheduleRetry() {
    if (!scriptActive || retryScheduled || !layoutPending || !hostIsVisible()) return false;

    const delay = recoveryRetryMode ? RECOVERY_RETRY_DELAY : TRANSIENT_RETRY_DELAY;
    if (!recoveryRetryMode) {
        transientRetryCount++;
        if (transientRetryCount >= MAX_TRANSIENT_RETRIES) recoveryRetryMode = true;
    }

    retryScheduled = true;
    try {
        retryTimer = window.SetTimeout(function () {
            retryTimer = null;
            retryScheduled = false;
            if (!scriptActive || !hostIsVisible()) return;
            scheduleLayoutWork();
        }, delay);
        return true;
    } catch (e) {
        retryTimer = null;
        retryScheduled = false;
        return false;
    }
}

function runPendingLayout() {
    if (layoutBusy || !layoutPending) return !layoutPending;

    layoutBusy = true;
    let complete = false;
    try {
        complete = layoutPanels();
        layoutPending = !complete;
        if (complete && miniBackdropRefreshPending) {
            // on_size can fire before the child swap settles, so this post-commit epoch
            // is separate: discovery restarts from a tree that matches what is visible.
            RivageBackdrop.refreshRootFrame(
                Math.max(0, window.Width),
                Math.max(0, window.Height)
            );
            miniBackdropRefreshPending = false;
        }
        return complete;
    } finally {
        layoutBusy = false;
    }
}

// The producer can load after its parent, so startup requests use a bounded retry.
function requestMeasureUntilAnswered() {
    if (!scriptActive || !topButtonsPresent || measureAnswered ||
        measureAttempts >= MEASURE_MAX_ATTEMPTS || measureTimer !== null) return false;

    measureAttempts++;
    try { window.NotifyOthers(CUSTOM_BUTTONS_MEASURE_REQUEST, TOP_BUTTONS_SLOT); }
    catch (e) {
        // Without this request the top-buttons strip never reports its width and
        // the row keeps its persisted fallback size indefinitely.
        logDiagnostic('the Custom Buttons measure request could not be sent: ' + e, true);
    }
    if (measureAnswered || !scriptActive || !topButtonsPresent) return true;

    const delay = measureAttempts < MEASURE_FAST_ATTEMPTS
        ? MEASURE_FAST_DELAY : MEASURE_SLOW_DELAY;
    try {
        measureTimer = window.SetTimeout(function () {
            measureTimer = null;
            requestMeasureUntilAnswered();
        }, delay);
        return true;
    } catch (e) {
        measureTimer = null;
        measureAttempts--;
        return false;
    }
}

function scheduleLayoutWork() {
    if (!scriptActive || workScheduled || layoutBusy || !layoutPending || !hostIsVisible()) {
        return false;
    }

    workScheduled = true;
    try {
        workTimer = window.SetTimeout(function () {
            workTimer = null;
            workScheduled = false;
            if (!scriptActive || !hostIsVisible()) return;

            if (runPendingLayout()) {
                resetRetryLane();
                cancelRetryTimer();
            } else {
                scheduleRetry();
            }
            requestMeasureUntilAnswered();
        }, 0);
        return true;
    } catch (e) {
        workTimer = null;
        workScheduled = false;
        return false;
    }
}

function requestDeferredLayout(resetRetries) {
    layoutPending = true;
    if (resetRetries) {
        resetRetryLane();
        cancelRetryTimer();
    }
    scheduleLayoutWork();
}

// Dragging stays synchronous for pointer responsiveness; native failures fall
// back into the same deferred recovery lane as ordinary resize work.
function layoutDuringDrag() {
    layoutPending = true;
    if (runPendingLayout()) {
        resetRetryLane();
        cancelRetryTimer();
        requestMeasureUntilAnswered();
        return true;
    }

    scheduleRetry();
    requestMeasureUntilAnswered();
    return false;
}

function consumeButtonsMeasure(name, info) {
    if (name !== CUSTOM_BUTTONS_MEASURE) return false;

    let payload;
    try { payload = JSON.parse(String(info || '')); } catch (e) { return true; }
    if (!payload || payload.v !== 1 || payload.slot !== TOP_BUTTONS_SLOT || !topButtonsPresent) {
        return true;
    }

    const origin = typeof payload.origin === 'string' ? payload.origin.trim() : '';
    if (!origin || typeof payload.enabled !== 'boolean' || typeof payload.w !== 'number' ||
        !isFinite(payload.w) || payload.w < 0) return true;
    if (measureOrigin && measureOrigin !== origin) return true;

    measureOrigin = origin;
    measureAnswered = true;
    clearMeasureTimer();

    const next = payload.enabled ? Math.max(0, Math.round(payload.w)) : 0;
    if (next === topButtonsWidth) return true;

    topButtonsWidth = next;
    saveTopButtonsWidth();
    requestDeferredLayout(true);
    return true;
}

function on_mouse_lbtn_down(x, y) {
    if (isOverDivider(y)) {
        draggingDivider = true;
        dividerHighlight.dragging(true);
    }
}

function on_mouse_move(x, y) {
    if (!draggingDivider) {
        dividerHighlight.hover(isOverDivider(y));
        return;
    }

    const nextTopBarHeight = clamp(
        Math.round(y),
        getMinimumTopBarHeight(),
        getMaximumTopBarHeight()
    );
    if (nextTopBarHeight === preferredTopBarHeight) return;

    preferredTopBarHeight = nextTopBarHeight;
    layoutDuringDrag();
    repaintDivider();
}

function on_mouse_lbtn_up(x, y) {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(isOverDivider(y));
    if (!draggingDivider) return;

    draggingDivider = false;
    saveLayout();
}

function on_mouse_leave() {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(false);
    if (!draggingDivider) return;

    draggingDivider = false;
    saveLayout();
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!isOverDivider(y) || preferredTopBarHeight === DEFAULT_TOP_BAR_HEIGHT) return;

    preferredTopBarHeight = DEFAULT_TOP_BAR_HEIGHT;
    saveLayout();
    layoutDuringDrag();
    repaintDivider();
}

function on_size() {
    // Publish the canonical root canvas before descendants ask for fresh frames.
    RivageBackdrop.setRootFrame(Math.max(0, window.Width), Math.max(0, window.Height));
    // JSplitter can dispatch on_size while its native child collection is mutating.
    requestDeferredLayout(true);
}

function on_paint(gr) {
    if (layoutPending && hostIsVisible()) scheduleLayoutWork();

    const width = Math.max(0, window.Width);
    const height = Math.max(0, window.Height);
    // Publishing the canonical root canvas is what every descendant maps against;
    // it is independent of how much of that canvas this panel itself has to paint.
    RivageBackdrop.setRootFrame(width, height);

    // The MINI PLAYER child fully covers this panel's area.
    if (miniModeActive) return;

    const dividerHeight = getDividerHeight();
    // Every direct child here is an RVG script that opens its paint with an opaque
    // fill, so a full backing surface is pixels nothing sees - ~40 ms per artwork
    // change. Only a foreign component would need one.
    if (RivageBackdrop.hasForeignPseudoChild()) {
        RivageBackdrop.paint(gr, 0, 0, width, height, backgroundColour);
    } else if (dividerHeight > 0) {
        RivageBackdrop.paint(gr, 0, getTopBarHeight(), width, dividerHeight, backgroundColour);
    }

    if (dividerHeight <= 0) return;

    // The Mica tint is already in the pixels above; painting it again would stack.
    dividerHighlight.draw(
        gr,
        0,
        getTopBarHeight(),
        Math.max(0, window.Width),
        dividerHeight
    );
}

function on_colours_changed() {
    backgroundColour = getBackgroundColour();
    if (RivageBackdrop.isSharedArtworkSurfaceMode()) SharedThemeProtocol.requestRepaint();
    else repaintDivider();
}

function on_notify_data(name, info) {
    // SharedThemeProtocol defers on_colours_changed by one turn, so an immediate paint
    // here would expose a half-committed frame.
    if (SharedThemeProtocol.consume(name, info)) return;
    if (consumeButtonsMeasure(name, info)) return;
    if (dividerHighlight.onNotifyData(name, info)) return;
    if (MiniPlayerProtocol.isEnter(name)) { enterMiniMode(); return; }
    if (name === QuickSwitcherProtocol.TOGGLE) { toggleQuickSwitcher(); return; }
    if (name === QuickSwitcherProtocol.SHOW) { openQuickSwitcher(QuickSwitcherProtocol.parseSize(info)); return; }
    if (name === QuickSwitcherProtocol.HIDE) { closeQuickSwitcher(); return; }
    if (MiniPlayerProtocol.isExit(name)) { exitMiniMode(); return; }
    if (MiniPlayerProtocol.consumeSettings(name, info, adoptMiniPlayerSettings)) return;
    ResizingModeProtocol.consume(name, info, setResizingModeEnabled);
}

function on_script_unload() {
    if (!scriptActive) return;

    saveLayout();
    scriptActive = false;
    draggingDivider = false;

    if (workTimer !== null) {
        try { window.ClearTimeout(workTimer); } catch (e) { }
    }
    workTimer = null;
    workScheduled = false;
    cancelRetryTimer();
    clearMeasureTimer();
    try { fb.UnregisterMainMenuCommand(QUICK_SWITCHER_MENU_ID); } catch (e) { }
}

try {
    fb.RegisterMainMenuCommand(QUICK_SWITCHER_MENU_ID, 'Quick switcher', 'Open or close the RVG quick switcher');
} catch (e) {
    logDiagnostic('Quick switcher: the main-menu command could not be registered: ' + e, true);
}

recoverFromUncleanMiniExit();
// Only does anything when a policy restore was left pending; the geometry
// recovery above already clears its own marker when it succeeds.
retryPendingPolicyRestore();
requestDeferredLayout(true);
SharedThemeProtocol.request();
ResizingModeProtocol.requestUntilAnswered();
MiniPlayerProtocol.requestSettings();
dividerHighlight.requestAccent();
