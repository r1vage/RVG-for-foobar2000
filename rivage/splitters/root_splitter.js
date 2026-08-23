'use strict';

window.DefineScript('RVG Root Splitter', {
    author: 'RivaGe',
    version: '1.4.0',
    features: { drag_n_drop: false, grab_focus: false }
});

// Native child wrappers are reacquired for every layout pass because JSplitter
// can rebuild its child collection without changing this panel's dimensions.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\divider_highlight.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\miniplayer_protocol.js');

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
// Deliberately separate from WasActive. WasActive arms a geometry restore, and
// arming that for a policy the host simply refuses would resize a healthy
// normal window on every script load forever. This marker only ever re-applies
// always-on-top and the size lock, so it is safe to leave armed.
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

// Narrow diagnostics. The remaining empty catches in this file guard calls that
// are *expected* to fail - clearing an already-fired timer, probing the two
// possible spellings of the Lock Window Size command - and stay silent on
// purpose. Everything that means something is actually broken comes through
// here. `once` suppresses repeats of an identical message for paths that can be
// re-entered, so a recurring failure cannot flood the console.
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
        return true;
    } catch (e) {
        return false;
    }
}

function showPanel(panel, visible) {
    if (!panel) return false;

    try {
        if (!!panel.Hidden === !!visible) panel.Show(visible);
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
        return window.GetColourCUI(3);
    } catch (e) { }

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

// The assignment alone was trusted through v1.2.0, and that is what let
// always-on-top get stuck on. A write issued while the main window is being
// resized can be swallowed, the old code reported success anyway, and the next
// enter then captured the leaked "on" as the state to restore - so the leak
// became permanent and self-reinforcing. Read back like setWindowSizeLocked
// already does for the lock command: the observed state is authoritative.
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

// The one place that puts the normal window's own policies back, shared by
// exit, startup recovery and the pending-policy pass. Each policy is honoured
// only if its "restore on exit" setting is on; when it is off, Mini Player's
// own value is deliberately left in force and nothing is marked pending.
//
// `force` skips those settings. Both startup paths pass it: they run before
// the owning panel has broadcast the real settings, and after an unclean exit
// or a swallowed write the normal window's own policies are the safe state to
// come back to regardless of preference.
//
// The pending marker is armed whenever a policy that WAS supposed to be
// restored did not verify, so a swallowed write is retried on the next script
// load instead of silently becoming the new "previous" state.
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
        if (topBarResult.panel && !showPanel(topBarResult.panel, false)) complete = false;
        if (bodyResult.panel && !showPanel(bodyResult.panel, false)) complete = false;
        if (topButtonsResult.panel && !showPanel(topButtonsResult.panel, false)) complete = false;
    }

    return complete;
}

// Asks to enter Mini Player. No-ops (with a console note) if the layout has
// no panel captioned MINI PLAYER yet - see MINI_PLAYER_SETUP.md. Without this
// guard, shrinking the window with nothing to show in its place would leave
// the user staring at a tiny, empty window with no visible way back.
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

    // Never record a "previous" state that Mini Player itself may have set.
    // If the last session's policy restore never completed - an unclean exit,
    // or a write the host swallowed mid-resize - the saved values are still
    // the real normal-window ones and must survive this enter untouched.
    // Overwriting them here is what made a leaked always-on-top permanent: the
    // leaked "on" was captured as the state to go back to, on every enter.
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
    requestDeferredLayout(true);
    if (!applyWindowRect(miniRect)) {
        miniModeActive = false;
        requestDeferredLayout(true);
        const rollbackRestored = applyWindowRect(normalRect);
        const rollbackLockRestored = setWindowSizeLocked(prevLockWindowSize);
        // A partially applied compact rectangle is still recoverable on the
        // next script load if the immediate geometry rollback also failed. A
        // policy-command failure must not trap startup in a permanent retry
        // loop on hosts that do not expose that optional main-menu command.
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
    requestDeferredLayout(true);

    const lockReleased = setWindowSizeLocked(false);
    const normalRectRestored = lockReleased && isUsableRect(normalRect) && applyWindowRect(normalRect);
    restoreNormalWindowPolicies(prevAlwaysOnTop, prevLockWindowSize, 'exit', false);
    // Keep the recovery marker only when the native geometry restore failed.
    // Always-on-top and lock are best-effort policies; leaving THIS marker armed
    // for an unavailable command would resize a healthy normal window on every
    // script load forever. A policy that did not take arms its own separate
    // marker instead - see restoreNormalWindowPolicies().
    writeProperty(MINI_WAS_ACTIVE_PROPERTY, !normalRectRestored);
    if (!normalRectRestored) {
        logDiagnostic('Mini Player: the normal window rectangle could not be restored; startup recovery remains armed.');
    }

    MiniPlayerProtocol.broadcastState(false);
}

// Recovers from an unclean exit (crash, forced close, or just "Reload all
// scripts" while Mini Player happened to be on) - without this, foobar2000
// would reopen at the last-saved (tiny) window size with no way back, since
// the control that restores it lives inside the now-hidden normal layout.
// Every script load is treated the same way: always come back up normal-
// sized, never resume Mini Player automatically.
function recoverFromUncleanMiniExit() {
    if (!readBooleanProperty(MINI_WAS_ACTIVE_PROPERTY, false)) return;

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
    // JSplitter can dispatch on_size while its native child collection is mutating.
    requestDeferredLayout(true);
}

function on_paint(gr) {
    if (layoutPending && hostIsVisible()) scheduleLayoutWork();
    // The MINI PLAYER child fully covers this panel's area while active, so
    // there is nothing behind it that needs painting.
    if (miniModeActive) return;

    const dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return;

    gr.FillSolidRect(
        0,
        getTopBarHeight(),
        Math.max(0, window.Width),
        dividerHeight,
        backgroundColour
    );

    dividerHighlight.draw(
        gr,
        0,
        getTopBarHeight(),
        Math.max(0, window.Width),
        dividerHeight
    );
}

function on_colours_changed() {
    const nextColour = getBackgroundColour();
    if (nextColour === backgroundColour) return;

    backgroundColour = nextColour;
    repaintDivider();
}

function on_notify_data(name, info) {
    if (consumeButtonsMeasure(name, info)) return;
    if (dividerHighlight.onNotifyData(name, info)) return;
    if (MiniPlayerProtocol.isEnter(name)) { enterMiniMode(); return; }
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
}

recoverFromUncleanMiniExit();
// Only does anything when a policy restore was left pending; the geometry
// recovery above already clears its own marker when it succeeds.
retryPendingPolicyRestore();
requestDeferredLayout(true);
ResizingModeProtocol.requestUntilAnswered();
MiniPlayerProtocol.requestSettings();
dividerHighlight.requestAccent();
