'use strict';

window.DrawMode = 0;

// LEFT SIDE root: dynamic content slots plus the full-area SETTINGS overlay.
// PanelObject wrappers stay callback-local and are never retained between passes.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\panel_visibility_host.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\panel_host_kit.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\divider_highlight.js');

window.DefineScript('RVG Settings Host', {
    author: 'RivaGe',
    version: '2.6.0',
    features: { drag_n_drop: false, grab_focus: false }
});

// Narrow failure reporting. Most empty catches in this file guard host calls
// that are *expected* to fail (a repaint or timer clear mid-teardown) and
// stay silent on purpose. This is for the few that mean something is
// actually broken and would otherwise leave no trace. Repeats are counted
// and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Settings Host] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

var BACKGROUND = 0xff18181a;

function refreshThemeBackground() {
    BACKGROUND = RivageUI.createTheme({ mode: 'host' }).background;
}

var TARGET_CAPTION = 'SETTINGS';
TOGGLE_HOST_CAPTIONS = [TARGET_CAPTION];
var EMPTY_CONTENT_ID = '__empty__';

// BUTTONS RAIL is a reserved full-height child; its width is supplied by
// RIVAGE.CUSTOM_BUTTONS.MEASURE.V1 for the leftside-rail slot.
var RAIL_CAPTION = 'BUTTONS RAIL';
var RAIL_SIDE_PROPERTY = 'RIVAGE.LeftSide.RailSide';

var CUSTOM_BUTTONS_MEASURE = 'RIVAGE.CUSTOM_BUTTONS.MEASURE.V1';
var CUSTOM_BUTTONS_MEASURE_REQUEST = 'RIVAGE.CUSTOM_BUTTONS.MEASURE_REQUEST.V1';
var RAIL_SLOT = 'leftside-rail';

// The last width the rail asked for survives a restart. This host is created
// before the child that answers its request, and a collapsed rail is
// Show(false) - a hidden panel cannot publish its size, so relying only on a
// broadcast would leave a rail that was visible at shutdown hidden forever.
var RAIL_WIDTH_PROPERTY = 'RIVAGE.LeftSide.RailWidth';

var RAIL_MEASURE_MAX_ATTEMPTS = 25;
var RAIL_MEASURE_FAST_ATTEMPTS = 10;
var RAIL_MEASURE_FAST_DELAY = 100;
var RAIL_MEASURE_SLOW_DELAY = 500;

var railPanelIndex = -1;
var railWidth = Math.max(0, Math.round(Number(window.GetProperty(RAIL_WIDTH_PROPERTY, 0)) || 0));
var railMeasureAnswered = false;
var railMeasureAttempts = 0;
var railMeasureOrigin = '';
var railSide = String(window.GetProperty(RAIL_SIDE_PROPERTY, 'left')) === 'right' ? 'right' : 'left';

var TOP_CONTENT_PROPERTY = 'RIVAGE.LeftSide.TopContent';
var BOTTOM_CONTENT_PROPERTY = 'RIVAGE.LeftSide.BottomContent';
var SPLIT_RATIO_PROPERTY = 'RIVAGE.LeftSide.SplitRatio';
var CONTENT_PADDING_PROPERTY = 'RIVAGE.LeftSide.ContentHalfPadding';
var PANEL_ID_OWNERS_PROPERTY = 'RIVAGE.LeftSide.PanelIdOwners.v1';

var SETTINGS_PANEL_ID = 'leftside';
var SETTINGS_PANEL_LABEL = 'Left panel layout';

var MAX_TRANSIENT_RETRIES = 4;
var TRANSIENT_RETRY_DELAY = 30;
var RECOVERY_RETRY_DELAY = 1500;
var CHILD_WATCH_INTERVAL = 1500;

function hostIsVisible() {
    return VisiblePaintWork.isVisible();
}

function safeGetPanelCount() {
    return PanelHostKit.safeGetPanelCount();
}

function safePanelCaption(panel, fallback) {
    return PanelHostKit.safePanelCaption(panel, fallback);
}

function contentLabelFromCaption(caption) {
    return PanelHostKit.labelFromCaption(caption);
}

function contentIdBase(value) {
    return PanelHostKit.idBaseFromCaption(value);
}

var CONTENT_OPTIONS = [];
var contentOptionsById = Object.create(null);
var settingsPanelIndex = -1;
var detectedPanelCount = -1;
var detectedPanelSignature = '';
var detectedPanelFingerprint = '';
var detectedPanelCaptions = [];
var panelsInitialised = false;
var scanPending = true;
var forceScanPending = true;
var layoutPending = true;
var workScheduled = false;
var workBusy = false;
var scanBusy = false;
var retryScheduled = false;
var transientRetryCount = 0;
var recoveryRetryMode = false;
var scriptActive = true;
var workTimer = null;
var retryTimer = null;
var startupTimer = null;
var childWatchTimer = null;
var railMeasureTimer = null;
var panelWidth = Math.max(0, Number(window.Width) || 0);
var panelHeight = Math.max(0, Number(window.Height) || 0);
var targetMissingLogged = false;
var targetCaptionMismatchLogged = '';

function loadPanelIdOwners() {
    var parsed;
    var owners = Object.create(null);
    try { parsed = JSON.parse(String(window.GetProperty(PANEL_ID_OWNERS_PROPERTY, '') || '')); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return owners;

    for (var key in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        var ownerKey = PanelHostKit.trimText(key).toLowerCase();
        var id = PanelHostKit.trimText(parsed[key]);
        if (ownerKey && id && !owners[ownerKey]) owners[ownerKey] = id;
    }
    return owners;
}

function rememberPanelIdOwners(captions, ids) {
    var changed = false;
    var seen = Object.create(null);
    for (var i = 0; i < captions.length; i++) {
        var key = PanelHostKit.trimText(captions[i]).toLowerCase();
        if (!key || seen[key]) continue;
        seen[key] = true;
        if (!ids[i] || panelIdOwners[key] === ids[i]) continue;
        panelIdOwners[key] = ids[i];
        changed = true;
    }
    if (!changed) return;
    try { window.SetProperty(PANEL_ID_OWNERS_PROPERTY, JSON.stringify(panelIdOwners)); } catch (e) { reportFailure('panel-id ownership could not be saved', e); }
}

var panelIdOwners = loadPanelIdOwners();

function contentOptionById(id) {
    return contentOptionsById[String(id || '')] || null;
}

function rebuildContentOptionIndex() {
    contentOptionsById = Object.create(null);
    for (var i = 0; i < CONTENT_OPTIONS.length; i++) {
        contentOptionsById[CONTENT_OPTIONS[i].id] = CONTENT_OPTIONS[i];
    }
}

function resolveStoredContentId(value) {
    return PanelHostKit.resolveStoredId(value, CONTENT_OPTIONS, contentOptionById, EMPTY_CONTENT_ID);
}

function makePanelSignature(options, overlayIndex, count) {
    var parts = ['count=' + count, 'settings=' + overlayIndex];
    for (var i = 0; i < options.length; i++) {
        parts.push(options[i].index + '\u001f' + options[i].caption + '\u001f' + options[i].id);
    }
    return parts.join('\u001e');
}


function makePanelFingerprint(captions, count) {
    return 'count=' + count + '\u001e' + captions.join('\u001e');
}

function readCurrentPanelFingerprint() {
    var count = safeGetPanelCount();
    if (count < 0) return '';

    var captions = [];
    try {
        for (var i = 0; i < count; i++) {
            if (safeGetPanelCount() !== count) return '';
            var panel = window.GetPanelByIndex(i);
            if (!panel) return '';
            var caption = safePanelCaption(panel, 'Panel ' + (i + 1));
            if (caption === null) return '';
            captions.push(caption);
            panel = null;
        }
        if (safeGetPanelCount() !== count) return '';
        return makePanelFingerprint(captions, count);
    } catch (e) {
        return '';
    }
}

function scanChildPanels(force) {
    if (scanBusy) return false;
    scanBusy = true;

    try {
        var count = safeGetPanelCount();
        if (count < 0) {
            scanPending = true;
            forceScanPending = true;
            return false;
        }
        if (!force && panelsInitialised && count === detectedPanelCount) {
            scanPending = false;
            return true;
        }

        var found = [];
        var allCaptions = [];
        var contentCaptions = [];
        var occurrences = Object.create(null);
        var overlayIndex = -1;
        var overlayNearMiss = '';
        var railIndex = -1;
        var previousRailIndex = railPanelIndex;
        var stable = true;
        var i;

        for (i = 0; i < count; i++) {
            if (safeGetPanelCount() !== count) {
                stable = false;
                break;
            }

            var panel = null;
            try {
                panel = window.GetPanelByIndex(i);
                if (!panel) {
                    stable = false;
                    break;
                }

                var caption = safePanelCaption(panel, 'Panel ' + (i + 1));
                if (caption === null) {
                    stable = false;
                    break;
                }

                allCaptions.push(caption);
                if (caption === TARGET_CAPTION) {
                    if (overlayIndex < 0) overlayIndex = i;
                    continue;
                }
                if (caption.toLowerCase() === TARGET_CAPTION.toLowerCase()) {
                    if (!overlayNearMiss) overlayNearMiss = caption;
                    continue;
                }
                if (caption.toLowerCase() === RAIL_CAPTION.toLowerCase()) {
                    if (railIndex < 0) railIndex = i;
                    continue;
                }

                contentCaptions.push(caption);
                var baseId = contentIdBase(caption);
                var occurrence = occurrences[baseId] || 0;
                occurrences[baseId] = occurrence + 1;

                found.push({
                    index: i,
                    id: '',
                    caption: caption,
                    label: contentLabelFromCaption(caption) +
                        (occurrence ? ' (' + (occurrence + 1) + ')' : '')
                });
            } catch (e) {
                stable = false;
                break;
            } finally {
                panel = null;
            }
        }

        if (!stable || safeGetPanelCount() !== count || allCaptions.length !== count) {
            scanPending = true;
            forceScanPending = true;
            return false;
        }

        var ids = PanelHostKit.makeUniqueCaptionIds(contentCaptions, panelIdOwners);
        for (i = 0; i < found.length; i++) found[i].id = ids[i];
        rememberPanelIdOwners(contentCaptions, ids);

        var signature = makePanelSignature(found, overlayIndex, count) + '\u001erail=' + railIndex;
        var changed = !panelsInitialised || signature !== detectedPanelSignature;

        CONTENT_OPTIONS = found;
        rebuildContentOptionIndex();
        settingsPanelIndex = overlayIndex;
        railPanelIndex = railIndex;
        detectedPanelCount = count;
        detectedPanelSignature = signature;
        detectedPanelFingerprint = makePanelFingerprint(allCaptions, count);
        detectedPanelCaptions = allCaptions.slice(0);
        panelsInitialised = true;
        scanPending = false;
        forceScanPending = false;

        if (settingsPanelIndex < 0) {
            if (overlayNearMiss && targetCaptionMismatchLogged !== overlayNearMiss) {
                console.log('Settings Host: reserved child caption must be exactly "' +
                    TARGET_CAPTION + '"; found "' + overlayNearMiss + '" instead.');
                targetCaptionMismatchLogged = overlayNearMiss;
                targetMissingLogged = true;
            } else if (!overlayNearMiss && !targetMissingLogged) {
                console.log('Settings Host: could not find a direct child captioned "' +
                    TARGET_CAPTION + '".');
                targetMissingLogged = true;
            }
        } else {
            targetMissingLogged = false;
            targetCaptionMismatchLogged = '';
        }

        if (previousRailIndex !== railPanelIndex) resetRailMeasureState(railPanelIndex >= 0);

        if (changed) {
            reconcileSelections();
            layoutPending = true;
            if (!workBusy && hostIsVisible()) {
                try { window.Repaint(true); } catch (e2) { }
            }
        }

        return true;
    } finally {
        scanBusy = false;
    }
}

function observeChildCollection() {
    var count = safeGetPanelCount();
    if (!panelsInitialised || count !== detectedPanelCount) {
        scanPending = true;
        forceScanPending = true;
        layoutPending = true;
    }
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

function requestWork(forceScan, requestRepaint) {
    resetRetryLane();
    cancelRetryTimer();
    if (forceScan) {
        scanPending = true;
        forceScanPending = true;
    }
    layoutPending = true;
    scheduleVisibleWork();

    if (requestRepaint && hostIsVisible()) {
        try { window.Repaint(true); } catch (e) { }
    }
}

function scheduleTransientRetry() {
    if (!scriptActive || retryScheduled || !hostIsVisible()) return false;

    var delay = recoveryRetryMode ? RECOVERY_RETRY_DELAY : TRANSIENT_RETRY_DELAY;
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
            scheduleVisibleWork();
        }, delay);
        return true;
    } catch (e) {
        retryTimer = null;
        retryScheduled = false;
        return false;
    }
}

function scheduleVisibleWork() {
    if (!scriptActive || workScheduled || workBusy || !hostIsVisible()) return false;
    if (!scanPending && !layoutPending) return false;

    workScheduled = true;
    try {
        workTimer = window.SetTimeout(function () {
            workTimer = null;
            workScheduled = false;
            if (!scriptActive || !hostIsVisible()) return;

            var completed = runVisibleWork();
            if (completed) {
                resetRetryLane();
                cancelRetryTimer();
                try { window.Repaint(true); } catch (e) { }
            } else {
                scheduleTransientRetry();
            }
        }, 0);
        return true;
    } catch (e) {
        workTimer = null;
        workScheduled = false;
        return false;
    }
}

function runVisibleWork() {
    if (workBusy || !hostIsVisible()) return false;
    workBusy = true;

    var complete = true;
    try {
        observeChildCollection();
        if (scanPending && !scanChildPanels(!!forceScanPending)) complete = false;
        if (complete && layoutPending && !applyLayoutNow()) complete = false;
    } finally {
        workBusy = false;
    }

    return complete && !scanPending && !layoutPending;
}

function refreshMetadataForSettings() {
    observeChildCollection();
    if (scanPending) scanChildPanels(true);
}

var PROPERTY_NOT_SET = '\u001fRIVAGE.NOT_SET\u001f';
var rawTopSelection = window.GetProperty(TOP_CONTENT_PROPERTY, PROPERTY_NOT_SET);
var rawBottomSelection = window.GetProperty(BOTTOM_CONTENT_PROPERTY, PROPERTY_NOT_SET);
var topSelectionWasStored = String(rawTopSelection) !== PROPERTY_NOT_SET && String(rawTopSelection) !== '';
var bottomSelectionWasStored = String(rawBottomSelection) !== PROPERTY_NOT_SET && String(rawBottomSelection) !== '';
var topSelection = topSelectionWasStored ? String(rawTopSelection) : 'albumart';
var bottomSelection = bottomSelectionWasStored ? String(rawBottomSelection) : 'controls';
var selectionsInitialised = false;

var splitRatio = Number(window.GetProperty(SPLIT_RATIO_PROPERTY, 0.5));
if (!(splitRatio > 0) || !(splitRatio < 1)) splitRatio = 0.5;

var CONTENT_PADDING_CHOICES = [0, 4, 8, 12];
var contentHalfPadding = Math.round(Number(window.GetProperty(CONTENT_PADDING_PROPERTY, 0)) || 0);
if (CONTENT_PADDING_CHOICES.indexOf(contentHalfPadding) < 0) contentHalfPadding = 0;

// The split remains ratio-based so either content type can occupy either half.
// The content column never gives up more than this width to the rail.
var MIN_CONTENT_WIDTH = 120;

var MIN_SPLIT_RATIO = 0.10;
var MAX_SPLIT_RATIO = 0.90;
var DEFAULT_SPLIT_RATIO = 0.5;
var DIVIDER_SIZE = 6;

var resizingModeEnabled = true;
var draggingDivider = false;

var dividerHighlight = DividerHighlight.create({
    orientation: 'horizontal',
    repaint: repaintDivider
});

// Rail width actually usable right now: the published content width, capped so
// the two content halves always keep a workable column of their own.
function getRailWidth() {
    if (railPanelIndex < 0) return 0;
    return Math.max(0, Math.min(Math.round(railWidth), Math.max(0, panelWidth - MIN_CONTENT_WIDTH)));
}

function clearRailMeasureTimer() {
    if (railMeasureTimer !== null) {
        try { window.ClearTimeout(railMeasureTimer); } catch (e) { }
    }
    railMeasureTimer = null;
}

function resetRailMeasureState(hasRail) {
    clearRailMeasureTimer();
    railMeasureAnswered = false;
    railMeasureAttempts = 0;
    railMeasureOrigin = '';
    if (hasRail && scriptActive) requestRailMeasureUntilAnswered();
}

function consumeRailMeasure(name, info) {
    if (name !== CUSTOM_BUTTONS_MEASURE) return false;

    var payload;
    try { payload = JSON.parse(String(info || '')); } catch (e) { return true; }
    if (!payload || payload.v !== 1 || payload.slot !== RAIL_SLOT || railPanelIndex < 0) return true;

    var origin = PanelHostKit.trimText(payload.origin);
    if (!origin || typeof payload.enabled !== 'boolean' || typeof payload.w !== 'number' ||
        !isFinite(payload.w) || payload.w < 0) return true;
    if (railMeasureOrigin && railMeasureOrigin !== origin) return true;

    railMeasureOrigin = origin;
    railMeasureAnswered = true;
    clearRailMeasureTimer();

    var next = payload.enabled ? Math.max(0, Math.round(payload.w)) : 0;
    if (next === railWidth) return true;

    railWidth = next;
    try { window.SetProperty(RAIL_WIDTH_PROPERTY, railWidth); } catch (e2) { reportFailure('the rail width could not be saved', e2); }
    requestWork(false, true);
    return true;
}

// A hidden rail cannot answer from its own geometry, so the persisted width is
// kept only as a startup fallback until the discovered producer replies.
function requestRailMeasureUntilAnswered() {
    if (!scriptActive || railPanelIndex < 0 || railMeasureAnswered ||
        railMeasureAttempts >= RAIL_MEASURE_MAX_ATTEMPTS || railMeasureTimer !== null) return false;

    railMeasureAttempts++;
    try { window.NotifyOthers(CUSTOM_BUTTONS_MEASURE_REQUEST, RAIL_SLOT); } catch (e) { reportFailure('the Custom Buttons measure request could not be sent', e); }
    if (railMeasureAnswered || !scriptActive) return true;

    var delay = railMeasureAttempts < RAIL_MEASURE_FAST_ATTEMPTS
        ? RAIL_MEASURE_FAST_DELAY : RAIL_MEASURE_SLOW_DELAY;
    try {
        railMeasureTimer = window.SetTimeout(function () {
            railMeasureTimer = null;
            requestRailMeasureUntilAnswered();
        }, delay);
        return true;
    } catch (e2) {
        railMeasureTimer = null;
        return false;
    }
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

// Only a real divider when both slots are actually populated - a single full-
// area panel (one slot empty/disabled) has nothing to drag between.
function currentSplitOptions() {
    ensureModelReady();
    return {
        top: topSelection === EMPTY_CONTENT_ID ? null : contentOptionById(topSelection),
        bottom: bottomSelection === EMPTY_CONTENT_ID ? null : contentOptionById(bottomSelection)
    };
}

function hasSplitDivider() {
    if (!resizingModeEnabled || !panelsInitialised) return false;
    var options = currentSplitOptions();
    return !!(options.top && options.bottom);
}

function getDividerHeight() {
    if (!hasSplitDivider()) return 0;
    return Math.min(DIVIDER_SIZE, Math.max(0, panelHeight));
}

function getDividerY() {
    var dividerHeight = getDividerHeight();
    var availableHeight = Math.max(0, panelHeight - dividerHeight);
    return Math.round(availableHeight * splitRatio);
}

function contentColumnRect() {
    var railW = getRailWidth();
    return {
        x: railSide === 'left' ? railW : 0,
        w: Math.max(0, panelWidth - railW)
    };
}

function isOverContentColumn(x) {
    var rect = contentColumnRect();
    return x >= rect.x && x < rect.x + rect.w;
}

function isOverDivider(y) {
    var dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return false;
    var dividerY = getDividerY();
    return y >= dividerY && y < dividerY + dividerHeight;
}

function repaintDivider() {
    var dividerHeight = getDividerHeight();
    if (dividerHeight <= 0) return;

    try {
        var rect = contentColumnRect();
        window.RepaintRect(rect.x, getDividerY(), rect.w, dividerHeight);
    } catch (e) {
        try { window.Repaint(true); } catch (e2) { }
    }
}

function saveSplitRatio() {
    window.SetProperty(SPLIT_RATIO_PROPERTY, splitRatio);
}

// Divider dragging is synchronous for pointer tracking; failures fall back to
// the normal deferred/recovery path.
function applyLayoutDuringDrag() {
    if (workBusy) return;
    layoutPending = true;
    if (!applyLayoutNow()) requestWork(true, false);
}

function setResizingModeEnabled(enabled) {
    var nextEnabled = !!enabled;
    if (nextEnabled === resizingModeEnabled) return;

    resizingModeEnabled = nextEnabled;

    if (!resizingModeEnabled) {
        if (draggingDivider) saveSplitRatio();
        draggingDivider = false;
        dividerHighlight.dragging(false);
        dividerHighlight.hover(false);
    }

    requestWork(true, true);
}

function insetPanelRect(x, y, width, height) {
    var pad = Math.max(0, Math.round(contentHalfPadding));
    pad = Math.min(pad, Math.max(0, Math.floor((width - 1) / 2)), Math.max(0, Math.floor((height - 1) / 2)));
    return {
        x: x + pad,
        y: y + pad,
        w: Math.max(1, width - pad * 2),
        h: Math.max(1, height - pad * 2)
    };
}

function firstUnusedContentId(usedId) {
    for (var i = 0; i < CONTENT_OPTIONS.length; i++) {
        if (CONTENT_OPTIONS[i].id !== usedId) return CONTENT_OPTIONS[i].id;
    }
    return EMPTY_CONTENT_ID;
}

function preferredContentId(preferred, usedId) {
    var resolved = resolveStoredContentId(preferred);
    if (resolved && resolved !== usedId) return resolved;
    return firstUnusedContentId(usedId);
}

function saveSelections() {
    window.SetProperty(TOP_CONTENT_PROPERTY, topSelection);
    window.SetProperty(BOTTOM_CONTENT_PROPERTY, bottomSelection);
    if (panelsInitialised || topSelectionWasStored) topSelectionWasStored = true;
    if (panelsInitialised || bottomSelectionWasStored) bottomSelectionWasStored = true;
}

function reconcileSelections() {
    var oldTop = topSelection;
    var oldBottom = bottomSelection;
    var resolvedTop = resolveStoredContentId(topSelection);
    var resolvedBottom = resolveStoredContentId(bottomSelection);
    var nextTop;
    var nextBottom;

    if (!selectionsInitialised) {
        nextTop = resolvedTop;
        nextBottom = resolvedBottom;

        if (!nextTop) {
            nextTop = topSelectionWasStored && topSelection
                ? topSelection
                : preferredContentId('albumart', '');
        }
        if (!nextBottom || nextBottom === nextTop) {
            nextBottom = bottomSelectionWasStored && bottomSelection && bottomSelection !== nextTop
                ? bottomSelection
                : preferredContentId('controls', nextTop);
        }
    } else {
        nextTop = resolvedTop || (topSelection && topSelection !== EMPTY_CONTENT_ID
            ? topSelection
            : EMPTY_CONTENT_ID);
        nextBottom = resolvedBottom || (bottomSelection && bottomSelection !== EMPTY_CONTENT_ID
            ? bottomSelection
            : EMPTY_CONTENT_ID);

        if (resolvedTop && resolvedBottom && resolvedTop === resolvedBottom) {
            nextBottom = EMPTY_CONTENT_ID;
        }
    }

    if (nextTop === EMPTY_CONTENT_ID && nextBottom === EMPTY_CONTENT_ID && CONTENT_OPTIONS.length) {
        nextTop = CONTENT_OPTIONS[0].id;
    }

    topSelection = nextTop || EMPTY_CONTENT_ID;
    bottomSelection = nextBottom || EMPTY_CONTENT_ID;
    selectionsInitialised = true;

    if (oldTop !== topSelection || oldBottom !== bottomSelection) saveSelections();
}

function ensureModelReady() {
    if (panelsInitialised && !selectionsInitialised) reconcileSelections();
}

function setContentSelection(which, requested) {
    ensureModelReady();
    if (!panelsInitialised) {
        requestWork(true, true);
        return false;
    }

    var id = String(requested || '');
    id = id === EMPTY_CONTENT_ID ? EMPTY_CONTENT_ID : resolveStoredContentId(id);
    if (id !== EMPTY_CONTENT_ID && !contentOptionById(id)) return false;

    if (which === 'top') {
        if (id !== EMPTY_CONTENT_ID && id === bottomSelection) {
            bottomSelection = topSelection;
        }
        topSelection = id;
    } else if (which === 'bottom') {
        if (id !== EMPTY_CONTENT_ID && id === topSelection) {
            topSelection = bottomSelection;
        }
        bottomSelection = id;
    } else {
        return false;
    }

    if (topSelection === EMPTY_CONTENT_ID && bottomSelection === EMPTY_CONTENT_ID && CONTENT_OPTIONS.length) {
        if (which === 'top') topSelection = CONTENT_OPTIONS[0].id;
        else bottomSelection = CONTENT_OPTIONS[0].id;
    }

    saveSelections();
    requestWork(true, true);
    return true;
}

function acquirePanelSnapshot() {
    var count = safeGetPanelCount();
    if (!panelsInitialised || count < 0 || count !== detectedPanelCount) return null;
    return PanelHostKit.acquireSnapshot(count, detectedPanelCaptions);
}

function safeConfigureContentPanel(panel) {
    if (!panel) return false;
    try {
        if (panel.ShowCaption !== false) panel.ShowCaption = false;
        if (panel.Locked !== true) panel.Locked = true;
        return true;
    } catch (e) {
        return false;
    }
}

function safeConfigureSettingsPanel(panel) {
    if (!panel) return false;
    try {
        if (panel.ShowCaption !== false) panel.ShowCaption = false;
        if (panel.Locked !== true) panel.Locked = true;
        if (panel.TopMost !== true) panel.TopMost = true;
        return true;
    } catch (e) {
        return false;
    }
}

function safeMovePanel(panel, x, y, width, height) {
    return PanelHostKit.safeMovePanel(panel, x, y, width, height);
}

function safeShowPanel(panel, show) {
    return PanelHostKit.safeShowPanelForce(panel, show);
}

function layoutTargetImmediate() {
    if (!hostIsVisible()) return false;

    var panel = null;
    try {
        panel = window.GetPanel(TARGET_CAPTION);
        if (!panel) return false;
        if (!safeConfigureSettingsPanel(panel)) return false;
        var fullWidth = Math.max(1, Number(window.Width) || panelWidth || 1);
        var fullHeight = Math.max(1, Number(window.Height) || panelHeight || 1);
        return safeMovePanel(panel, 0, 0, fullWidth, fullHeight);
    } catch (e) {
        return false;
    } finally {
        panel = null;
    }
}

function snapshotContentPanels(panels) {
    var states = [];
    try {
        for (var i = 0; i < CONTENT_OPTIONS.length; i++) {
            var option = CONTENT_OPTIONS[i];
            var panel = panels[option.index];
            if (!panel) return null;
            states.push({
                index: option.index,
                hidden: !!panel.Hidden,
                x: Number(panel.X), y: Number(panel.Y),
                w: Number(panel.Width), h: Number(panel.Height)
            });
        }
    } catch (e) {
        return null;
    }
    return states;
}

function restoreContentPanels(panels, states) {
    var ok = true;
    for (var i = 0; i < states.length; i++) {
        var state = states[i];
        var panel = panels[state.index];
        if (!panel) { ok = false; continue; }
        if (isFinite(state.x) && isFinite(state.y) && isFinite(state.w) && isFinite(state.h) &&
            state.w > 0 && state.h > 0 &&
            !safeMovePanel(panel, state.x, state.y, state.w, state.h)) ok = false;
        if (!safeShowPanel(panel, !state.hidden)) ok = false;
    }
    return ok;
}

function applyContentLayoutTransaction(panels, topOption, bottomOption, contentX, contentW, h) {
    var states = snapshotContentPanels(panels);
    if (!states) return false;

    var selectedIndexes = Object.create(null);
    if (topOption) selectedIndexes[topOption.index] = true;
    if (bottomOption) selectedIndexes[bottomOption.index] = true;

    var i;
    for (i = 0; i < CONTENT_OPTIONS.length; i++) {
        if (!safeConfigureContentPanel(panels[CONTENT_OPTIONS[i].index])) return false;
    }

    var bothPopulated = !!(topOption && bottomOption);
    var dividerGap = bothPopulated ? getDividerHeight() : 0;
    var availableSplitHeight = Math.max(0, h - dividerGap);
    var splitY = Math.round(availableSplitHeight * splitRatio);
    var topH = bothPopulated ? Math.max(1, splitY) : h;
    var bottomY = bothPopulated ? splitY + dividerGap : 0;
    var bottomH = bothPopulated ? Math.max(1, availableSplitHeight - splitY) : h;

    function stage(option, y, height) {
        if (!option) return true;
        var panel = panels[option.index];
        var rect = insetPanelRect(contentX, y, contentW, height);
        return safeMovePanel(panel, rect.x, rect.y, rect.w, rect.h) && safeShowPanel(panel, true);
    }

    if (!stage(topOption, 0, topH) || !stage(bottomOption, bottomY, bottomH)) {
        restoreContentPanels(panels, states);
        return false;
    }

    for (i = 0; i < CONTENT_OPTIONS.length; i++) {
        var option = CONTENT_OPTIONS[i];
        if (!selectedIndexes[option.index] && !safeShowPanel(panels[option.index], false)) {
            restoreContentPanels(panels, states);
            return false;
        }
    }
    return true;
}

function applyLayoutNow() {
    if (!hostIsVisible()) return false;
    if (!panelsInitialised || safeGetPanelCount() !== detectedPanelCount) {
        scanPending = true;
        forceScanPending = true;
        return false;
    }

    panelWidth = Math.max(0, Math.floor(Number(window.Width) || panelWidth || 0));
    panelHeight = Math.max(0, Math.floor(Number(window.Height) || panelHeight || 0));
    ensureModelReady();

    var w = panelWidth;
    var h = panelHeight;
    if (w <= 0 || h <= 0) {
        layoutPending = false;
        return true;
    }

    var railW = getRailWidth();
    var contentX = railSide === 'left' ? railW : 0;
    var contentW = Math.max(1, w - railW);
    var panels = acquirePanelSnapshot();
    if (!panels) {
        scanPending = true;
        forceScanPending = true;
        return false;
    }

    var operationFailed = false;
    try {
        var topOption = topSelection === EMPTY_CONTENT_ID ? null : contentOptionById(topSelection);
        var bottomOption = bottomSelection === EMPTY_CONTENT_ID ? null : contentOptionById(bottomSelection);

        if (!applyContentLayoutTransaction(panels, topOption, bottomOption, contentX, contentW, h)) {
            operationFailed = true;
        }

        if (railPanelIndex >= 0 && railPanelIndex < panels.length) {
            var railPanel = panels[railPanelIndex];
            if (!safeConfigureContentPanel(railPanel)) operationFailed = true;
            if (railW > 0) {
                if (!safeMovePanel(railPanel, railSide === 'left' ? 0 : w - railW, 0, railW, h)) operationFailed = true;
                if (!safeShowPanel(railPanel, true)) operationFailed = true;
            } else if (!safeShowPanel(railPanel, false)) {
                operationFailed = true;
            }
        }

        if (settingsPanelIndex >= 0 && settingsPanelIndex < panels.length) {
            var settingsPanel = panels[settingsPanelIndex];
            if (!safeConfigureSettingsPanel(settingsPanel)) operationFailed = true;
            if (!safeMovePanel(settingsPanel, 0, 0, w, h)) operationFailed = true;
        }
    } finally {
        panels = null;
    }

    if (operationFailed) {
        scanPending = true;
        forceScanPending = true;
        return false;
    }

    layoutPending = false;
    return true;
}

function choicesExcluding(excludeId, selectedId) {
    var out = [{ value: EMPTY_CONTENT_ID, label: 'Disabled' }];

    if (selectedId && selectedId !== EMPTY_CONTENT_ID && !contentOptionById(selectedId)) {
        out.push({ value: selectedId, label: 'Unavailable panel: ' + selectedId });
    }

    for (var i = 0; i < CONTENT_OPTIONS.length; i++) {
        var option = CONTENT_OPTIONS[i];
        if (option.id === excludeId) continue;
        out.push({ value: option.id, label: option.label });
    }
    return out;
}

function getMySettings() {
    refreshMetadataForSettings();
    ensureModelReady();
    return [
        {
            id: 'topContent', label: 'Top pane', type: 'choice',
            value: topSelection, choiceValueType: 'string',
            choices: choicesExcluding(bottomSelection, topSelection)
        },
        {
            id: 'bottomContent', label: 'Bottom pane', type: 'choice',
            value: bottomSelection, choiceValueType: 'string',
            choices: choicesExcluding(topSelection, bottomSelection)
        },
        {
            id: 'railSide', label: 'Button rail side', type: 'choice',
            value: railSide, choiceValueType: 'string',
            choices: [
                { value: 'left', label: 'Left edge' },
                { value: 'right', label: 'Right edge' }
            ]
        },
        {
            id: 'railStatus', label: 'Button rail status', type: 'info',
            value: railPanelIndex < 0
                ? 'Custom Buttons rail not found'
                : (getRailWidth() > 0
                    ? 'Visible, ' + getRailWidth() + ' px wide'
                    : 'Hidden or empty')
        },
        {
            id: 'contentHalfPadding', label: 'Pane padding', type: 'choice',
            value: contentHalfPadding, choiceValueType: 'number',
            choices: [
                { value: 0, label: 'None' },
                { value: 4, label: 'Compact (4 px)' },
                { value: 8, label: 'Standard (8 px)' },
                { value: 12, label: 'Spacious (12 px)' }
            ]
        }
    ];
}

function applyMySetting(settingId, value) {
    switch (settingId) {
    case 'topContent':
        setContentSelection('top', String(value));
        break;
    case 'bottomContent':
        setContentSelection('bottom', String(value));
        break;
    case 'railSide':
        railSide = String(value) === 'right' ? 'right' : 'left';
        window.SetProperty(RAIL_SIDE_PROPERTY, railSide);
        requestWork(false, true);
        break;
    case 'railStatus':
        break;
    case 'contentHalfPadding':
        contentHalfPadding = Math.round(Number(value) || 0);
        if (CONTENT_PADDING_CHOICES.indexOf(contentHalfPadding) < 0) contentHalfPadding = 0;
        window.SetProperty(CONTENT_PADDING_PROPERTY, contentHalfPadding);
        requestWork(false, true);
        break;
    }
}

function on_size(width, height) {
    panelWidth = Math.max(0, Math.floor(Number(width)) || 0);
    panelHeight = Math.max(0, Math.floor(Number(height)) || 0);

    // on_size can run inside JSplitter's native child transaction.
    requestWork(true, false);
}

function on_colours_changed() {
    refreshThemeBackground();
    window.Repaint(true);
}

function on_paint(gr) {
    observeChildCollection();
    scheduleVisibleWork();
    gr.FillSolidRect(0, 0,
        Math.max(0, Number(window.Width) || panelWidth || 0),
        Math.max(0, Number(window.Height) || panelHeight || 0),
        BACKGROUND);

    var dividerHeight = getDividerHeight();
    if (dividerHeight > 0) {
        var rect = contentColumnRect();
        dividerHighlight.draw(gr, rect.x, getDividerY(), rect.w, dividerHeight);
    }
}

function on_mouse_lbtn_down(x, y) {
    if (isOverDivider(y) && isOverContentColumn(x)) {
        draggingDivider = true;
        dividerHighlight.dragging(true);
    }
}

function on_mouse_move(x, y) {
    if (!draggingDivider) {
        dividerHighlight.hover(isOverDivider(y) && isOverContentColumn(x));
        return;
    }

    var dividerHeight = getDividerHeight();
    var availableHeight = Math.max(1, panelHeight - dividerHeight);
    var nextRatio = clamp(y / availableHeight, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO);

    if (nextRatio === splitRatio) return;

    splitRatio = nextRatio;
    applyLayoutDuringDrag();
    repaintDivider();
}

function on_mouse_lbtn_up(x, y) {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(isOverDivider(y) && isOverContentColumn(x));

    if (!draggingDivider) return;

    draggingDivider = false;
    saveSplitRatio();
}

function on_mouse_leave() {
    dividerHighlight.dragging(false);
    dividerHighlight.hover(false);

    if (!draggingDivider) return;

    draggingDivider = false;
    saveSplitRatio();
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!isOverDivider(y) || !isOverContentColumn(x)) return;
    if (splitRatio === DEFAULT_SPLIT_RATIO) return;

    splitRatio = DEFAULT_SPLIT_RATIO;
    saveSplitRatio();
    applyLayoutDuringDrag();
    repaintDivider();
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) {
        refreshThemeBackground();
        window.Repaint(true);
        return;
    }
    if (consumeRailMeasure(name, info)) return;
    if (dividerHighlight.onNotifyData(name, info)) return;
    if (ResizingModeProtocol.consume(name, info, setResizingModeEnabled)) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;

    if (togglePanelVisibilityHost(name, info)) {
        // This explicit user action may size the overlay immediately; all
        // recurring discovery/content work remains deferred and visibility-gated.
        layoutTargetImmediate();
        requestWork(true, true);
    }
}

try {
    startupTimer = window.SetTimeout(function () {
        startupTimer = null;
        requestWork(true, hostIsVisible());
    }, 0);
} catch (e) {
    startupTimer = null;
    requestWork(true, hostIsVisible());
}

// Metadata-only watcher detects same-count child changes and re-arms lost work.
try {
    childWatchTimer = window.SetInterval(function () {
        if (!scriptActive || !hostIsVisible() || workBusy || scanBusy) return;

        var fingerprint = readCurrentPanelFingerprint();
        if (!panelsInitialised || (fingerprint && fingerprint !== detectedPanelFingerprint)) {
            requestWork(true, false);
            return;
        }
        if (railPanelIndex >= 0 && !railMeasureAnswered && railMeasureTimer === null) {
            requestRailMeasureUntilAnswered();
        }
        if ((scanPending || layoutPending) && !workScheduled && !retryScheduled) scheduleVisibleWork();
    }, CHILD_WATCH_INTERVAL);
} catch (e2) {
    childWatchTimer = null;
}

function on_script_unload() {
    if (!scriptActive) return;
    if (draggingDivider) saveSplitRatio();
    scriptActive = false;
    draggingDivider = false;

    var timers = [workTimer, retryTimer, startupTimer, railMeasureTimer];
    for (var i = 0; i < timers.length; i++) {
        if (timers[i] !== null) {
            try { window.ClearTimeout(timers[i]); } catch (e) { }
        }
    }
    if (childWatchTimer !== null) {
        try { window.ClearInterval(childWatchTimer); } catch (e3) { }
    }

    workTimer = null;
    retryTimer = null;
    startupTimer = null;
    railMeasureTimer = null;
    childWatchTimer = null;
    workScheduled = false;
    retryScheduled = false;
}

refreshThemeBackground();
try { SharedAccentProtocol.request(); } catch (e) { reportFailure('the Shared accent could not be requested', e); }
try { ResizingModeProtocol.requestUntilAnswered(); } catch (e2) { reportFailure('the resizing mode could not be requested', e2); }

