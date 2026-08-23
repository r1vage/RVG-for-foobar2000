'use strict';

window.DefineScript('RVG Middle Splitter', {
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
    var text = '[RVG Middle Splitter] ' + message;
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

const LEGACY_LEFT_WIDTH_PROPERTY = 'RIVAGE.Layout.Middle.LeftSideWidth';
const LEFT_FRACTION_PROPERTY = 'RIVAGE.Layout.Middle.LeftSideFraction.v2';

const DEFAULT_LEFT_WIDTH = 400;
const DEFAULT_LEFT_FRACTION = 0.3333;
const DIVIDER_SIZE = 6;
const DIVIDER_HIT_SIZE = 8;
const MIN_LEFT_WIDTH = 200;
const MIN_RIGHT_WIDTH = 200;

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_RETRY_DELAY = 30;
const RECOVERY_RETRY_DELAY = 1500;

let resizingModeEnabled = true;
let draggingDivider = false;
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

function fractionToPercent(fraction) {
    return Math.round(clamp(fraction, 0, 1) * 10000) / 100;
}

function percentToFraction(percent) {
    return clamp(percent / 100, 0, 1);
}

function hostIsVisible() {
    try {
        return window.IsVisible !== false;
    } catch (e) {
        return true;
    }
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

// A migrated pixel width is reproduced exactly on the first layout. The
// derived fraction becomes authoritative only after the available width changes.
function readInitialState() {
    const availableWidth = getAvailableWidth();
    const savedPercent = Number(window.GetProperty(LEFT_FRACTION_PROPERTY, NaN));

    if (isFinite(savedPercent) && savedPercent > 0) {
        const fraction = percentToFraction(savedPercent);
        return {
            pixels: availableWidth > 0 ? Math.round(availableWidth * fraction) : DEFAULT_LEFT_WIDTH,
            fraction: fraction,
            fractionPersisted: true
        };
    }

    const legacyPixels = Number(window.GetProperty(LEGACY_LEFT_WIDTH_PROPERTY, NaN));
    if (isFinite(legacyPixels) && legacyPixels > 0) {
        const pixels = Math.max(0, Math.round(legacyPixels));
        return {
            pixels: pixels,
            fraction: availableWidth > 0
                ? clamp(pixels / availableWidth, 0.01, 0.99)
                : DEFAULT_LEFT_FRACTION,
            fractionPersisted: false
        };
    }

    return {
        pixels: DEFAULT_LEFT_WIDTH,
        fraction: availableWidth > 0
            ? clamp(DEFAULT_LEFT_WIDTH / availableWidth, 0.01, 0.99)
            : DEFAULT_LEFT_FRACTION,
        fractionPersisted: false
    };
}

const initialState = readInitialState();
let leftFraction = initialState.fraction;
let preferredLeftWidth = initialState.pixels;
let lastSavedFractionPercent = initialState.fractionPersisted
    ? fractionToPercent(leftFraction)
    : null;

// Seeding this to today's width preserves the exact migrated pixel width until
// a real resize or resizing-mode change occurs.
let lastAvailableWidth = getAvailableWidth();

function saveLayout() {
    const percent = fractionToPercent(leftFraction);
    if (lastSavedFractionPercent !== null && percent === lastSavedFractionPercent) {
        return true;
    }

    try {
        window.SetProperty(LEFT_FRACTION_PROPERTY, percent);
        lastSavedFractionPercent = percent;
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

function setResizingModeEnabled(enabled) {
    const nextEnabled = !!enabled;
    if (nextEnabled === resizingModeEnabled) {
        return;
    }

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

function getMinimumLeftWidth() {
    return Math.min(MIN_LEFT_WIDTH, getAvailableWidth());
}

function getMaximumLeftWidth() {
    const availableWidth = getAvailableWidth();
    const minimumWidth = getMinimumLeftWidth();
    return Math.max(minimumWidth, availableWidth - MIN_RIGHT_WIDTH);
}

function getLeftWidth() {
    const availableWidth = getAvailableWidth();
    if (availableWidth <= 0) {
        return 0;
    }

    return clamp(preferredLeftWidth, getMinimumLeftWidth(), getMaximumLeftWidth());
}

function getDividerX() {
    return getLeftWidth();
}

function isOverDivider(x) {
    const dividerX = getDividerX();
    const dividerWidth = getDividerWidth();
    if (dividerWidth <= 0) return false;

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

    window.RepaintRect(getDividerX(), 0, dividerWidth, Math.max(0, window.Height));
}

function layoutPanels() {
    const width = Math.max(0, window.Width);
    const height = Math.max(0, window.Height);
    const dividerWidth = getDividerWidth();
    const availableWidth = Math.max(0, width - dividerWidth);

    if (!draggingDivider && availableWidth !== lastAvailableWidth) {
        preferredLeftWidth = Math.round(availableWidth * leftFraction);
    }
    lastAvailableWidth = availableWidth;

    const leftWidth = getLeftWidth();
    const rightX = leftWidth + dividerWidth;
    const rightWidth = Math.max(0, width - rightX);
    let complete = true;
    let panel = getPanel('LEFT SIDE');

    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, 0, leftWidth, height)) complete = false;
        panel = null;
    }

    panel = getPanel('RIGHT SIDE - TABS');
    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, rightX, 0, rightWidth, height)) complete = false;
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

// Dragging remains synchronous for pointer responsiveness; a failed native move
// falls back into the same deferred recovery lane as ordinary resize work.
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

function on_mouse_lbtn_down(x, y) {
    if (isOverDivider(x)) {
        draggingDivider = true;
        dividerHighlight.dragging(true);
    }
}

function on_mouse_move(x, y) {
    if (!draggingDivider) {
        dividerHighlight.hover(isOverDivider(x));
        return;
    }

    const nextLeftWidth = clamp(
        Math.round(x),
        getMinimumLeftWidth(),
        getMaximumLeftWidth()
    );

    if (nextLeftWidth === preferredLeftWidth) {
        return;
    }

    preferredLeftWidth = nextLeftWidth;
    const availableWidth = getAvailableWidth();
    if (availableWidth > 0) {
        leftFraction = clamp(nextLeftWidth / availableWidth, 0, 1);
    }

    layoutDuringDrag();
    repaintDivider();
}

function on_mouse_lbtn_up(x, y) {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(isOverDivider(x));

    if (!draggingDivider) {
        return;
    }

    draggingDivider = false;
    saveLayout();
}

function on_mouse_leave() {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(false);

    if (!draggingDivider) {
        return;
    }

    draggingDivider = false;
    saveLayout();
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!isOverDivider(x) || preferredLeftWidth === DEFAULT_LEFT_WIDTH) {
        return;
    }

    preferredLeftWidth = DEFAULT_LEFT_WIDTH;
    const availableWidth = getAvailableWidth();
    leftFraction = availableWidth > 0
        ? clamp(DEFAULT_LEFT_WIDTH / availableWidth, 0, 1)
        : DEFAULT_LEFT_FRACTION;

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
