'use strict';

window.DefineScript('RVG Bottom Splitter', {
    author: 'RivaGe',
    version: '1.1.0',
    features: { drag_n_drop: false, grab_focus: false }
});

// Narrow diagnostics. The remaining empty catches in this file guard calls
// that are *expected* to fail - clearing an already-fired timer, probing an
// optional colour API - and stay silent on purpose. This is for the one case
// that means something is actually broken: neither host colour API being
// available, silently leaving the divider on a hardcoded fallback colour.
// `once` suppresses repeats for a path that can be re-entered.
var reportedDiagnostics = {};
function logDiagnostic(message, once) {
    var text = '[RVG Bottom Splitter] ' + message;
    if (once) {
        if (reportedDiagnostics[text]) return;
        reportedDiagnostics[text] = true;
    }
    try { console.log(text); } catch (e) { }
}

// Native child wrappers are reacquired for every layout pass because JSplitter
// can rebuild its child collection without changing this panel's dimensions.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\divider_highlight.js');

const PRESETS_RATIO_PROPERTY = 'RIVAGE.Layout.BottomHorizontal.PresetsRatio';
const RATIO_SCALE = 1000000;
const DEFAULT_PRESETS_RATIO = 0.30;
const DIVIDER_SIZE = 6;
const DIVIDER_HIT_SIZE = 8;
const MIN_PRESETS_WIDTH = 30;
const MIN_BOTTOM_BAR_WIDTH = 260;
const MK_LBUTTON = 0x0001;

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_RETRY_DELAY = 30;
const RECOVERY_RETRY_DELAY = 1500;

const savedPresetsState = readSavedPresetsState();
let preferredPresetsRatio = savedPresetsState.ratio;
let lastSavedRatioValue = savedPresetsState.needsWrite
    ? null
    : ratioToStoredValue(preferredPresetsRatio);
let resizingModeEnabled = true;
let draggingDivider = false;
let dividerGrabOffset = 0;
let backgroundColour = getBackgroundColour();
let scriptActive = true;

let layoutPending = true;
let layoutBusy = false;
let workScheduled = false;
let workTimer = null;
let retryScheduled = false;
let retryTimer = null;
let transientRetryCount = 0;
let recoveryRetryMode = false;

const dividerHighlight = DividerHighlight.create({
    orientation: 'vertical',
    repaint: repaintDivider
});

window.EraseOnRepaint = false;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function ratioToStoredValue(ratio) {
    return Math.round(clamp(ratio, 0, 1) * RATIO_SCALE);
}

function storedValueToRatio(value) {
    return clamp(value / RATIO_SCALE, 0, 1);
}

function readSavedPresetsState() {
    const defaultValue = ratioToStoredValue(DEFAULT_PRESETS_RATIO);
    const savedValue = window.GetProperty(PRESETS_RATIO_PROPERTY, defaultValue);
    const numericValue = Number(savedValue);

    if (!isFinite(numericValue)) {
        return { ratio: DEFAULT_PRESETS_RATIO, needsWrite: true };
    }

    // Older builds stored the ratio directly; rewrite it once in fixed-point form.
    if (numericValue >= 0 && numericValue <= 1) {
        return { ratio: clamp(numericValue, 0, 1), needsWrite: true };
    }

    return { ratio: storedValueToRatio(Math.round(numericValue)), needsWrite: false };
}

function saveLayout() {
    const storedValue = ratioToStoredValue(preferredPresetsRatio);
    if (lastSavedRatioValue !== null && storedValue === lastSavedRatioValue) {
        return true;
    }

    try {
        window.SetProperty(PRESETS_RATIO_PROPERTY, storedValue);
        lastSavedRatioValue = storedValue;
        return true;
    } catch (e) {
        return false;
    }
}

function getPanel(caption) {
    try {
        return window.GetPanel(caption);
    } catch (e) {
        return null;
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

function hostIsVisible() {
    try {
        return window.IsVisible !== false;
    } catch (e) {
        return true;
    }
}

function setResizingModeEnabled(enabled) {
    const nextEnabled = !!enabled;
    if (nextEnabled === resizingModeEnabled) {
        return;
    }

    if (!nextEnabled) {
        if (draggingDivider) {
            draggingDivider = false;
            dividerGrabOffset = 0;
            saveLayout();
        }
        dividerHighlight.dragging(false);
        dividerHighlight.hover(false);
    }

    resizingModeEnabled = nextEnabled;
    requestDeferredLayout(true);
    repaintDivider();
}

function getDividerWidth() {
    if (!resizingModeEnabled) {
        return 0;
    }

    return Math.min(DIVIDER_SIZE, Math.max(0, window.Width));
}

function getAvailableWidth() {
    return Math.max(0, window.Width - getDividerWidth());
}

function getMinimumPresetsWidth() {
    return Math.min(MIN_PRESETS_WIDTH, getAvailableWidth());
}

function getMaximumPresetsWidth() {
    const availableWidth = getAvailableWidth();
    const minimumWidth = getMinimumPresetsWidth();
    return Math.max(minimumWidth, availableWidth - MIN_BOTTOM_BAR_WIDTH);
}

function getPresetsWidth() {
    const availableWidth = getAvailableWidth();
    if (availableWidth <= 0) {
        return 0;
    }

    return clamp(
        Math.round(availableWidth * preferredPresetsRatio),
        getMinimumPresetsWidth(),
        getMaximumPresetsWidth()
    );
}

function getDividerX() {
    return getPresetsWidth();
}

function isOverDivider(x) {
    const dividerX = getDividerX();
    const dividerWidth = getDividerWidth();
    if (dividerWidth <= 0) {
        return false;
    }

    const extraHitWidth = Math.max(0, DIVIDER_HIT_SIZE - dividerWidth);
    const leftPadding = Math.floor(extraHitWidth / 2);
    const rightPadding = extraHitWidth - leftPadding;

    return x >= dividerX - leftPadding &&
        x < dividerX + dividerWidth + rightPadding;
}

function repaintDivider() {
    const dividerWidth = getDividerWidth();
    if (dividerWidth <= 0) {
        return;
    }

    window.RepaintRect(
        getDividerX(),
        0,
        dividerWidth,
        Math.max(0, window.Height)
    );
}

function layoutPanels() {
    const width = Math.max(0, window.Width);
    const height = Math.max(0, window.Height);
    const dividerWidth = getDividerWidth();
    const presetsWidth = getPresetsWidth();
    const bottomBarX = presetsWidth + dividerWidth;
    const bottomBarWidth = Math.max(0, width - bottomBarX);
    let complete = true;
    let panel = getPanel('PRESETS');

    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, 0, presetsWidth, height)) complete = false;
        panel = null;
    }

    panel = getPanel('BOTTOM BAR');
    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, bottomBarX, 0, bottomBarWidth, height)) complete = false;
        panel = null;
    }

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
    if (!scriptActive || retryScheduled || !layoutPending || !hostIsVisible()) {
        return false;
    }

    const delay = recoveryRetryMode ? RECOVERY_RETRY_DELAY : TRANSIENT_RETRY_DELAY;
    if (!recoveryRetryMode) {
        transientRetryCount++;
        if (transientRetryCount >= MAX_TRANSIENT_RETRIES) {
            recoveryRetryMode = true;
        }
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
    if (layoutBusy || !layoutPending) {
        return !layoutPending;
    }

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

// Dragging remains synchronous; failed native work joins the deferred recovery lane.
function layoutDuringDrag() {
    layoutPending = true;
    if (runPendingLayout()) {
        resetRetryLane();
        cancelRetryTimer();
        return true;
    }

    scheduleRetry();
    return false;
}

function updatePreferredRatio(dividerX) {
    const availableWidth = getAvailableWidth();
    if (availableWidth <= 0) {
        return false;
    }

    const presetsWidth = clamp(
        Math.round(dividerX),
        getMinimumPresetsWidth(),
        getMaximumPresetsWidth()
    );

    if (presetsWidth === getPresetsWidth()) {
        return false;
    }

    preferredPresetsRatio = clamp(presetsWidth / availableWidth, 0, 1);
    layoutDuringDrag();
    repaintDivider();
    return true;
}

function updateDragFromPointer(x) {
    return updatePreferredRatio(x - dividerGrabOffset);
}

function finishDrag(x, updateFromPointer) {
    if (!draggingDivider) {
        return false;
    }

    if (updateFromPointer) {
        updateDragFromPointer(x);
    }

    draggingDivider = false;
    dividerGrabOffset = 0;
    dividerHighlight.dragging(false);
    saveLayout();
    return true;
}

function on_mouse_lbtn_down(x, y) {
    if (!isOverDivider(x)) {
        return;
    }

    draggingDivider = true;
    dividerGrabOffset = x - getDividerX();
    dividerHighlight.dragging(true);
}

function on_mouse_move(x, y, mask) {
    if (!draggingDivider) {
        dividerHighlight.hover(isOverDivider(x));
        return;
    }

    // JSplitter can lose the mouse-up when release occurs over a child panel.
    if (typeof mask === 'number' && !(mask & MK_LBUTTON)) {
        updateDragFromPointer(x);
        finishDrag(x, false);
        dividerHighlight.hover(isOverDivider(x));
        return;
    }

    updateDragFromPointer(x);
}

function on_mouse_lbtn_up(x, y) {
    dividerHighlight.hover(isOverDivider(x));
    finishDrag(x, true);
}

function on_mouse_leave() {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(false);
    finishDrag(0, false);
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!isOverDivider(x)) {
        return;
    }

    draggingDivider = false;
    dividerGrabOffset = 0;

    if (
        ratioToStoredValue(preferredPresetsRatio) ===
        ratioToStoredValue(DEFAULT_PRESETS_RATIO)
    ) {
        return;
    }

    preferredPresetsRatio = DEFAULT_PRESETS_RATIO;
    saveLayout();
    layoutDuringDrag();
    repaintDivider();
}

function on_size() {
    // JSplitter can dispatch on_size while its native child collection is mutating.
    requestDeferredLayout(true);
}

function on_paint(gr) {
    if (layoutPending && hostIsVisible()) {
        scheduleLayoutWork();
    }

    const dividerWidth = getDividerWidth();
    if (dividerWidth <= 0) {
        return;
    }

    gr.FillSolidRect(
        getDividerX(),
        0,
        dividerWidth,
        Math.max(0, window.Height),
        backgroundColour
    );

    dividerHighlight.draw(
        gr,
        getDividerX(),
        0,
        dividerWidth,
        Math.max(0, window.Height)
    );
}

function on_colours_changed() {
    const nextColour = getBackgroundColour();
    if (nextColour === backgroundColour) {
        return;
    }

    backgroundColour = nextColour;
    repaintDivider();
}

function on_notify_data(name, info) {
    if (dividerHighlight.onNotifyData(name, info)) {
        return;
    }

    ResizingModeProtocol.consume(name, info, setResizingModeEnabled);
}

function on_script_unload() {
    if (!scriptActive) return;

    saveLayout();
    scriptActive = false;
    draggingDivider = false;
    dividerGrabOffset = 0;

    if (workTimer !== null) {
        try { window.ClearTimeout(workTimer); } catch (e) { }
    }
    workTimer = null;
    workScheduled = false;
    cancelRetryTimer();
}

requestDeferredLayout(true);
ResizingModeProtocol.requestUntilAnswered();
dividerHighlight.requestAccent();
