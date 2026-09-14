'use strict';

window.DefineScript('RVG Body Splitter', {
    author: 'RivaGe',
    version: '1.5.1',
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
    var text = '[RVG Body Splitter] ' + message;
    if (once) {
        if (reportedDiagnostics[text]) return;
        reportedDiagnostics[text] = true;
    }
    try { console.log(text); } catch (e) { }
}

// Native child wrappers are reacquired for every layout pass because JSplitter
// can rebuild its child collection without changing this panel's dimensions.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\divider_highlight.js');

const BOTTOM_HEIGHT_PROPERTY = 'Layout.Body.Bottom height';
const DEFAULT_BOTTOM_HEIGHT = 110;
const DIVIDER_SIZE = 6;
const MIN_MIDDLE_HEIGHT = 200;
const MIN_BOTTOM_HEIGHT = 60;
const MK_LBUTTON = 0x0001;

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_RETRY_DELAY = 30;
const RECOVERY_RETRY_DELAY = 1500;

let preferredBottomHeight = readSavedBottomHeight();
let lastSavedBottomHeight = preferredBottomHeight;
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
    orientation: 'horizontal',
    repaint: repaintDivider
});

window.EraseOnRepaint = false;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function readSavedBottomHeight() {
    let value = Number(window.GetProperty(BOTTOM_HEIGHT_PROPERTY, DEFAULT_BOTTOM_HEIGHT));
    if (!isFinite(value)) value = DEFAULT_BOTTOM_HEIGHT;
    return Math.max(0, Math.round(value));
}

function saveLayout() {
    const value = Math.max(0, Math.round(preferredBottomHeight));
    if (value === lastSavedBottomHeight) {
        return true;
    }

    try {
        window.SetProperty(BOTTOM_HEIGHT_PROPERTY, value);
        lastSavedBottomHeight = value;
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

function getDividerHeight() {
    if (!resizingModeEnabled) return 0;
    return Math.min(DIVIDER_SIZE, Math.max(0, window.Height));
}

function getAvailableHeight() {
    return Math.max(0, window.Height - getDividerHeight());
}

function getMinimumBottomHeight() {
    return Math.min(MIN_BOTTOM_HEIGHT, getAvailableHeight());
}

function getMaximumBottomHeight() {
    const availableHeight = getAvailableHeight();
    const minimumHeight = getMinimumBottomHeight();
    return Math.max(minimumHeight, availableHeight - MIN_MIDDLE_HEIGHT);
}

function getBottomHeight() {
    const availableHeight = getAvailableHeight();
    if (availableHeight <= 0) return 0;

    return clamp(
        preferredBottomHeight,
        getMinimumBottomHeight(),
        getMaximumBottomHeight()
    );
}

function getDividerY() {
    return Math.max(0, getAvailableHeight() - getBottomHeight());
}

function isOverDivider(y) {
    const dividerY = getDividerY();
    const dividerHeight = getDividerHeight();
    return dividerHeight > 0 && y >= dividerY && y < dividerY + dividerHeight;
}

function repaintDivider() {
    const dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return;

    window.RepaintRect(
        0,
        getDividerY(),
        Math.max(0, window.Width),
        dividerHeight
    );
}

function layoutPanels() {
    const width = Math.max(0, window.Width);
    const height = Math.max(0, window.Height);
    const dividerHeight = getDividerHeight();
    const dividerY = getDividerY();
    const bottomY = dividerY + dividerHeight;
    const bottomHeight = Math.max(0, height - bottomY);
    let complete = true;
    let panel = getPanel('MIDDLE');

    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, 0, width, dividerY)) complete = false;
        panel = null;
    }

    panel = getPanel('BOTTOM HORIZONTAL');
    if (!panel) {
        complete = false;
    } else {
        if (!preparePanel(panel)) complete = false;
        if (!movePanel(panel, 0, bottomY, width, bottomHeight)) complete = false;
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

function updatePreferredBottomHeight(dividerY) {
    const nextBottomHeight = clamp(
        Math.round(window.Height - getDividerHeight() - dividerY),
        getMinimumBottomHeight(),
        getMaximumBottomHeight()
    );

    if (nextBottomHeight === preferredBottomHeight) {
        return false;
    }

    preferredBottomHeight = nextBottomHeight;
    layoutDuringDrag();
    repaintDivider();
    return true;
}

function updateDragFromPointer(y) {
    return updatePreferredBottomHeight(y - dividerGrabOffset);
}

function finishDrag(y, updateFromPointer) {
    if (!draggingDivider) return false;

    if (updateFromPointer) {
        updateDragFromPointer(y);
    }

    draggingDivider = false;
    dividerGrabOffset = 0;
    dividerHighlight.dragging(false);
    saveLayout();
    return true;
}

function on_mouse_lbtn_down(x, y) {
    if (!isOverDivider(y)) return;

    draggingDivider = true;
    dividerGrabOffset = y - getDividerY();
    dividerHighlight.dragging(true);
}

function on_mouse_move(x, y, mask) {
    if (!draggingDivider) {
        dividerHighlight.hover(isOverDivider(y));
        return;
    }

    // JSplitter can lose the mouse-up when release occurs over a child panel.
    if (typeof mask === 'number' && !(mask & MK_LBUTTON)) {
        updateDragFromPointer(y);
        finishDrag(y, false);
        dividerHighlight.hover(isOverDivider(y));
        return;
    }

    updateDragFromPointer(y);
}

function on_mouse_lbtn_up(x, y) {
    dividerHighlight.hover(isOverDivider(y));
    finishDrag(y, true);
}

function on_mouse_leave() {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(false);
    finishDrag(0, false);
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!isOverDivider(y)) return;

    draggingDivider = false;
    dividerGrabOffset = 0;
    if (preferredBottomHeight === DEFAULT_BOTTOM_HEIGHT) return;

    preferredBottomHeight = DEFAULT_BOTTOM_HEIGHT;
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

    // Only a child running a FOREIGN component samples this host's pixels. A child
    // JSplitter panel runs an RVG script that opens its paint with an opaque
    // full-rect fill, so it can never reveal what this host drew underneath -
    // and JSplitter sets the pseudo-transparency flag on all of them regardless.
    var fullSurface = RivageBackdrop.isSharedArtworkSurfaceMode() &&
        RivageBackdrop.hasForeignPseudoChild();
    if (fullSurface) {
        RivageBackdrop.paint(
            gr, 0, 0, Math.max(0, window.Width), Math.max(0, window.Height),
            backgroundColour
        );
    }

    const dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return;

    if (!fullSurface) {
        // paint() maps the slice from this panel's own root frame; the divider
        // rectangle is all this host still owes.
        RivageBackdrop.paint(
            gr,
            0,
            getDividerY(),
            Math.max(0, window.Width),
            dividerHeight,
            backgroundColour
        );
    }

    dividerHighlight.draw(
        gr,
        0,
        getDividerY(),
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
    // SharedThemeProtocol applies the semantic state synchronously but defers
    // on_colours_changed/repaint by one turn. Do not issue an immediate backing-
    // surface paint here: that would expose a half-committed frame before the
    // compatibility accent and replacement Mica bitmap have been adopted.
    if (SharedThemeProtocol.consume(name, info)) return;
    if (dividerHighlight.onNotifyData(name, info)) return;
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
SharedThemeProtocol.request();
ResizingModeProtocol.requestUntilAnswered();
dividerHighlight.requestAccent();
