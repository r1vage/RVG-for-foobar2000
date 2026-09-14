'use strict';

window.DrawMode = 0;

// Direct children are discovered dynamically. Native PanelObject wrappers stay
// callback-local, and recurring discovery/layout work is idle while hidden.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\bottom_bar_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\panel_host_kit.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');

window.DefineScript('RVG Bottom Bar Host', {
    author: 'RivaGe',
    version: '2.8.5',
    features: { drag_n_drop: false, grab_focus: false }
});

// Narrow failure reporting. Most empty catches in this file guard calls that
// are *expected* to fail - a repaint or cursor set on a host that is mid-
// teardown, clearing an already-fired timer - and stay silent on purpose. This
// is for the few that mean something is actually broken and would otherwise
// leave no trace. Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Bottom Bar Host] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

var SLOT_COUNT = 4;
var MAX_PRESETS = 4;
var EMPTY_SLOT_ID = '__empty__';
var MIN_SLOT_WIDTH = 5;
var DEFAULT_NEW_SLOT_WIDTH = 25;
var MAX_TRANSIENT_RETRIES = 4;
var TRANSIENT_RETRY_DELAY = 30;
var RECOVERY_RETRY_DELAY = 1500;
var CHILD_WATCH_INTERVAL = 1500;

// Slot widths are percentages of the content area, kept to two decimals so
// dragging a divider moves in single pixels instead of whole-percent jumps.
// Older layouts and presets that stored whole percentages still load as-is.
var WIDTH_EPSILON = 0.005;

// Divider geometry, matching splitters/*.js: 6 logical pixels while resizing
// mode is on, nothing at all while it is off.
var DIVIDER_SIZE = 6;
var DIVIDER_HIT_SIZE = 8;

var FRAME_STYLE_SPACING = 'spacing';
var FRAME_STYLE_CARD = 'card';
var FRAME_STYLE_WINDOW = 'window';
var FRAME_STYLE_LINE = 'line';

var PROPERTY_FRAME_STYLE = 'RIVAGE.BottomBar.FrameStyle.v1';
var PROPERTY_OUTER_PADDING = 'RIVAGE.BottomBar.OuterPadding.v1';
var PROPERTY_PANEL_GAP = 'RIVAGE.BottomBar.PanelGap.v1';
var PROPERTY_TITLE_HEIGHT = 'RIVAGE.BottomBar.TitleHeight.v1';
var PROPERTY_SHOW_WINDOW_TITLES = 'RIVAGE.BottomBar.ShowWindowTitles.v1';
var PROPERTY_CORNER_RADIUS = 'RIVAGE.BottomBar.CornerRadius.v1';
var PROPERTY_ACCENT_LINE = 'RIVAGE.BottomBar.AccentLine.v1';

var PROPERTY_LAYOUT = 'RIVAGE.BottomBar.Layout.v1';
var PROPERTY_PRESETS = 'RIVAGE.BottomBar.Presets.v1';
var PROPERTY_ACTIVE_PRESET = 'RIVAGE.BottomBar.ActivePreset.v1';
var PROPERTY_LAYOUT_DIRTY = 'RIVAGE.BottomBar.LayoutDirty.v1';
var PROPERTY_PRESET_NAME = 'RIVAGE.BottomBar.PresetNameDraft.v1';
var PROPERTY_PANEL_ID_OWNERS = 'RIVAGE.BottomBar.PanelIdOwners.v1';

var SETTINGS_PANEL_ID = 'bottom_bar_layout';
var SETTINGS_PANEL_LABEL = 'Bottom bar layout';

var LEGACY_DEFAULT_LAYOUT = {
    slots: ['visualization', 'equalizer', 'internet_radio', 'item_details'],
    widths: [25, 25, 25, 25]
};

var DEFAULT_UWP_ACCENT = 0xff0078d4;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

var COLOUR_BACKGROUND = 0xff202022; //0xff272727 for 039 039 039
var COLOUR_FRAME = 0xff202022;
var COLOUR_TITLE_BAR = 0xff1c1c1e;
var COLOUR_BORDER = 0xff3a3a3e;
var COLOUR_FRAME_RIM = 0xff3a3a3e;
var COLOUR_TITLE_TEXT = 0xffb8b8b8;
var COLOUR_SEPARATOR = 0xff333333;
var micaSurfaces = false;

// Under Panel defaults the only pixels this theme owns are the gaps and the outer
// padding, so the background has to be the one the child panels paint - 'host', as
// the splitters already resolve - or every gap reads as a dark groove between them.
// The artwork modes override the mode themselves.
function refreshTheme() {
    var resolved = RivageUI.createTheme({ mode: 'host', accent: sharedAlbumAccent });
    COLOUR_BACKGROUND = resolved.background;
    COLOUR_FRAME = resolved.card;
    COLOUR_TITLE_BAR = resolved.header;
    COLOUR_BORDER = resolved.stroke;
    COLOUR_TITLE_TEXT = resolved.textSecondary;
    // Over the blurred cover the palette stroke reads bright on a dark artwork and
    // all but vanishes on a pale one. The text colour at low alpha keeps the same
    // weight either way - the same rim the playlist's inset card uses.
    micaSurfaces = resolved.mica === true;
    COLOUR_FRAME_RIM = micaSurfaces ? RivageUI.withAlpha(resolved.textPrimary, 42) : COLOUR_BORDER;
    // Mica line reuses the tab bar's own separator, so both edges of the layout
    // are the same hairline.
    COLOUR_SEPARATOR = resolved.navigationSeparator;
}

var IDC_ARROW = 32512;
var IDC_SIZEWE = 32644;

var MK_LBUTTON = 0x0001;

var DT_LEFT = 0x00000000;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;


function clone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return null;
    }
}

function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
}

// Native child enumeration and caption-derived metadata are shared across the root hosts.
function trimText(value) {
    return PanelHostKit.trimText(value);
}

function hostIsVisible() {
    return VisiblePaintWork.isVisible();
}

function safeGetPanelCount() {
    return PanelHostKit.safeGetPanelCount();
}

function safePanelCaption(panel, fallback) {
    return PanelHostKit.safePanelCaption(panel, fallback);
}

function panelLabelFromCaption(caption) {
    return PanelHostKit.labelFromCaption(caption);
}

function panelIdBase(value) {
    return PanelHostKit.idBaseFromCaption(value);
}

function parseJsonText(raw, fallback) {
    if (!raw) return clone(fallback);
    try {
        return JSON.parse(raw);
    } catch (e) {
        return clone(fallback);
    }
}

function isArray(value) {
    return typeof Array.isArray === 'function' ? Array.isArray(value) : value instanceof Array;
}


var dpi = RivageScale.dpi() || 96;

function scale(value) {
    return Math.max(0, Math.round(Number(value) * dpi / 96));
}

function normaliseFrameStyle(value) {
    var style = String(value);
    return style === FRAME_STYLE_SPACING || style === FRAME_STYLE_CARD ||
        style === FRAME_STYLE_WINDOW || style === FRAME_STYLE_LINE
        ? style
        : FRAME_STYLE_WINDOW;
}

// Chrome-less styles: the panels get the whole slot and any frame drawing is a
// hairline outside them.
function frameStyleIsBare(style) {
    return style === FRAME_STYLE_SPACING || style === FRAME_STYLE_LINE;
}

// One device pixel on purpose, not scale(1): at 150% the scaled hairline reads
// as a bar rather than a line.
function micaLineHeight() {
    return 1;
}

var frameStyle = normaliseFrameStyle(window.GetProperty(PROPERTY_FRAME_STYLE, FRAME_STYLE_WINDOW));
var outerPaddingPt = Math.round(clamp(window.GetProperty(PROPERTY_OUTER_PADDING, 6), 0, 32));
var panelGapPt = Math.round(clamp(window.GetProperty(PROPERTY_PANEL_GAP, 8), 0, 40));
var titleHeightPt = Math.round(clamp(window.GetProperty(PROPERTY_TITLE_HEIGHT, 24), 16, 48));
var showWindowTitles = !!window.GetProperty(PROPERTY_SHOW_WINDOW_TITLES, true);
var cornerRadiusPt = Math.round(clamp(window.GetProperty(PROPERTY_CORNER_RADIUS, 4), 0, 16));
var accentLineEnabled = !!window.GetProperty(PROPERTY_ACCENT_LINE, true);
var frameRects = [];
var frameFont = null;

// tab-switcher-right.js owns resizing mode; this duplicate control uses acknowledged SETs.

var resizingModeEnabled = true;
var dividerRects = [];
var hoverDividerIndex = -1;
var activeDrag = null;

function rebuildFrameFont() {
    frameFont = RivageUI.font('Segoe UI Semibold', Math.max(9, scale(10)), 0);
}
rebuildFrameFont();


var PANEL_OPTIONS = [];
var panelOptionsById = Object.create(null);
var detectedPanelCount = -1;
var detectedPanelSignature = '';
var detectedPanelFingerprint = '';
var panelScanPending = true;
var forcePanelScanPending = true;
var layoutPending = true;
var workScheduled = false;
var workBusy = false;
var scanBusy = false;
var retryScheduled = false;
var transientRetryCount = 0;
var panelsInitialised = false;
var scriptActive = true;
var workTimer = null;
var retryTimer = null;
var startupTimer = null;
var childWatchTimer = null;
var panelWidth = Math.max(0, Number(window.Width) || 0);
var panelHeight = Math.max(0, Number(window.Height) || 0);
var panelIdOwners = loadPanelIdOwners();

function optionById(id) {
    return panelOptionsById[String(id || '')] || null;
}

function rebuildOptionIndex() {
    panelOptionsById = Object.create(null);
    for (var i = 0; i < PANEL_OPTIONS.length; i++) {
        panelOptionsById[PANEL_OPTIONS[i].id] = PANEL_OPTIONS[i];
    }
}

function resolveStoredPanelId(value) {
    return PanelHostKit.resolveStoredId(value, PANEL_OPTIONS, optionById, EMPTY_SLOT_ID);
}

function makePanelSignature(options) {
    var parts = [];
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

function loadPanelIdOwners() {
    var parsed = parseJsonText(window.GetProperty(PROPERTY_PANEL_ID_OWNERS, ''), {});
    var owners = Object.create(null);
    if (!parsed || typeof parsed !== 'object' || isArray(parsed)) return owners;

    for (var key in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        var ownerKey = trimText(key).toLowerCase();
        var id = trimText(parsed[key]);
        if (ownerKey && id && !owners[ownerKey]) owners[ownerKey] = id;
    }
    return owners;
}

function rememberPanelIdOwners(captions, ids) {
    var changed = false;
    var seen = Object.create(null);
    for (var i = 0; i < captions.length; i++) {
        var key = trimText(captions[i]).toLowerCase();
        if (!key || seen[key]) continue;
        seen[key] = true;
        if (!ids[i] || panelIdOwners[key] === ids[i]) continue;
        panelIdOwners[key] = ids[i];
        changed = true;
    }
    if (!changed) return;
    try { window.SetProperty(PROPERTY_PANEL_ID_OWNERS, JSON.stringify(panelIdOwners)); }
    catch (e) { reportFailure('panel-id ownership could not be saved', e); }
}

function scanChildPanels(force) {
    if (scanBusy) return false;
    scanBusy = true;

    try {
        var count = safeGetPanelCount();
        if (count < 0) {
            panelScanPending = true;
            forcePanelScanPending = true;
            return false;
        }
        if (!force && panelsInitialised && count === detectedPanelCount) {
            panelScanPending = false;
            return true;
        }

        var found = [];
        var captions = [];
        var occurrences = Object.create(null);
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

                captions.push(caption);
                var baseId = panelIdBase(caption);
                var occurrence = occurrences[baseId] || 0;
                occurrences[baseId] = occurrence + 1;

                found.push({
                    index: i,
                    id: '',
                    caption: caption,
                    label: panelLabelFromCaption(caption) +
                        (occurrence ? ' (' + (occurrence + 1) + ')' : '')
                });
            } catch (e) {
                stable = false;
                break;
            } finally {
                panel = null;
            }
        }

        if (!stable || safeGetPanelCount() !== count || found.length !== count) {
            panelScanPending = true;
            forcePanelScanPending = true;
            return false;
        }

        var ids = PanelHostKit.makeUniqueCaptionIds(captions, panelIdOwners);
        for (i = 0; i < found.length; i++) found[i].id = ids[i];
        rememberPanelIdOwners(captions, ids);

        var signature = makePanelSignature(found);
        var changed = !panelsInitialised || signature !== detectedPanelSignature;

        PANEL_OPTIONS = found;
        rebuildOptionIndex();
        detectedPanelCount = count;
        detectedPanelSignature = signature;
        detectedPanelFingerprint = makePanelFingerprint(captions, count);
        panelsInitialised = true;
        panelScanPending = false;
        forcePanelScanPending = false;

        if (changed) {
            reconcilePanelDependentState();
            layoutPending = true;
            broadcastState();
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
        panelScanPending = true;
        forcePanelScanPending = true;
        layoutPending = true;
    }
}

function requestWork(forceScan, requestRepaint) {
    if (!scriptActive) return;
    transientRetryCount = 0;
    if (forceScan) {
        panelScanPending = true;
        forcePanelScanPending = true;
    }
    layoutPending = true;

    if (requestRepaint && hostIsVisible()) {
        try { window.Repaint(true); } catch (e) { }
    }
}

function scheduleTransientRetry() {
    if (!scriptActive || retryScheduled || !hostIsVisible()) return false;

    var recovery = transientRetryCount >= MAX_TRANSIENT_RETRIES;
    var delay = recovery ? RECOVERY_RETRY_DELAY : TRANSIENT_RETRY_DELAY;
    if (recovery) transientRetryCount = 0;
    else transientRetryCount++;

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
    if (!panelScanPending && !layoutPending) return false;

    workScheduled = true;
    try {
        workTimer = window.SetTimeout(function () {
            workTimer = null;
            workScheduled = false;
            if (!scriptActive || !hostIsVisible()) return;

            var completed = runVisibleWork();
            if (completed) {
                transientRetryCount = 0;
                try { window.Repaint(true); } catch (e) { }
            } else {
                scheduleTransientRetry();
            }
        }, 0);
        return true;
    } catch (e) {
        workTimer = null;
        workScheduled = false;
        scheduleTransientRetry();
        return false;
    }
}

function runVisibleWork() {
    if (workBusy || !hostIsVisible()) return false;
    workBusy = true;

    var complete = true;
    try {
        observeChildCollection();

        if (panelScanPending) {
            if (!scanChildPanels(!!forcePanelScanPending)) complete = false;
        }

        if (complete && layoutPending) {
            if (!applyLayoutNow()) complete = false;
        }
    } finally {
        workBusy = false;
    }

    return complete && !panelScanPending && !layoutPending;
}

function refreshMetadataForSettings(force) {
    observeChildCollection();
    if (force || panelScanPending) scanChildPanels(true);
}


// Two-decimal widths keep divider drags at pixel-level precision.
function roundWidth(value) {
    value = Number(value);
    if (!isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
}

function distributeFraction(total, weights) {
    var result = [];
    var weightSum = 0;
    var i;

    total = Math.max(0, Number(total) || 0);

    for (i = 0; i < weights.length; i++) {
        weights[i] = Math.max(0, Number(weights[i]) || 0);
        weightSum += weights[i];
    }
    if (weightSum <= 0) {
        for (i = 0; i < weights.length; i++) weights[i] = 1;
        weightSum = weights.length;
    }

    for (i = 0; i < weights.length; i++) {
        result[i] = roundWidth(total * weights[i] / weightSum);
    }

    return result;
}

// Rounding each share to two decimals can leave the total a hundredth short of
// or over 100. The remainder goes to the widest slot, where it is invisible.
function settleWidths(result, active) {
    var sum = 0;
    var widest;
    var i;

    if (!active.length) return result;

    widest = active[0];
    for (i = 0; i < active.length; i++) {
        sum = roundWidth(sum + result[active[i]]);
        if (result[active[i]] > result[widest]) widest = active[i];
    }
    if (sum !== 100) result[widest] = roundWidth(result[widest] + (100 - sum));
    return result;
}

function activeSlotIndexes(slots) {
    var indexes = [];
    var i;
    for (i = 0; i < SLOT_COUNT; i++) {
        if (String(slots && slots[i] || '') !== EMPTY_SLOT_ID) indexes.push(i);
    }
    return indexes;
}

function activeAvailableSlotIndexes(slots) {
    var indexes = [];
    for (var i = 0; i < SLOT_COUNT; i++) {
        var id = String(slots && slots[i] || '');
        if (id !== EMPTY_SLOT_ID && optionById(id)) indexes.push(i);
    }
    return indexes;
}

function activeAvailableSlotCount(slots) {
    return activeAvailableSlotIndexes(slots).length;
}

function slotsForAvailablePanels(slots) {
    var result = [];
    for (var i = 0; i < SLOT_COUNT; i++) {
        var id = String(slots && slots[i] || EMPTY_SLOT_ID);
        result[i] = id !== EMPTY_SLOT_ID && optionById(id) ? id : EMPTY_SLOT_ID;
    }
    return result;
}

function normalizeWidthsForAvailablePanels(input, slots) {
    return normalizeWidthsForSlots(input, slotsForAvailablePanels(slots));
}

function effectiveLayoutForAvailablePanels(layout) {
    var slots = slotsForAvailablePanels(layout && layout.slots);
    return {
        slots: slots,
        widths: normalizeWidthsForSlots(layout && layout.widths, slots)
    };
}

function maxWidthForActiveCount(count) {
    if (count <= 1) return 100;
    return 100 - MIN_SLOT_WIDTH * (count - 1);
}

function normalizeWidthsForSlots(input, slots) {
    var result = [0, 0, 0, 0];
    var active = activeSlotIndexes(slots);
    var values = [];
    var weights = [];
    var extras;
    var available;
    var sum = 0;
    var valid = true;
    var i;
    var index;

    if (!active.length) return result;
    if (active.length === 1) {
        result[active[0]] = 100;
        return result;
    }

    for (i = 0; i < active.length; i++) {
        index = active[i];
        values[i] = roundWidth(Number(input && input[index]));
        if (!isFinite(values[i]) || values[i] < MIN_SLOT_WIDTH) {
            valid = false;
            values[i] = MIN_SLOT_WIDTH;
        }
        sum = roundWidth(sum + values[i]);
    }

    if (valid && Math.abs(sum - 100) <= WIDTH_EPSILON) {
        for (i = 0; i < active.length; i++) result[active[i]] = values[i];
        return settleWidths(result, active);
    }

    available = 100 - MIN_SLOT_WIDTH * active.length;
    for (i = 0; i < active.length; i++) {
        weights.push(Math.max(0, values[i] - MIN_SLOT_WIDTH));
    }
    extras = distributeFraction(available, weights);
    for (i = 0; i < active.length; i++) {
        result[active[i]] = roundWidth(MIN_SLOT_WIDTH + extras[i]);
    }
    return settleWidths(result, active);
}

// Equal shares for every active slot - the "Make all panels same" action and
// the divider double-click both land here.
function equalWidthsForSlots(slots) {
    var result = [0, 0, 0, 0];
    var active = activeAvailableSlotIndexes(slots);
    var i;

    if (!active.length) return result;
    for (i = 0; i < active.length; i++) {
        result[active[i]] = roundWidth(100 / active.length);
    }
    return settleWidths(result, active);
}

function rebalanceOneWidth(index, requested) {
    var next = currentLayout.widths.slice(0);
    var active = activeAvailableSlotIndexes(currentLayout.slots);
    var activeCount = active.length;
    var maxWidth;
    var target;
    var remaining;
    var otherIndexes = [];
    var weights = [];
    var extraTotal;
    var extras;
    var i;
    var slotIndex;

    if (currentLayout.slots[index] === EMPTY_SLOT_ID) return next;
    if (activeCount <= 1) {
        for (i = 0; i < SLOT_COUNT; i++) next[i] = 0;
        next[index] = 100;
        return next;
    }

    maxWidth = maxWidthForActiveCount(activeCount);
    target = roundWidth(clamp(requested, MIN_SLOT_WIDTH, maxWidth));
    remaining = 100 - target;
    extraTotal = remaining - MIN_SLOT_WIDTH * (activeCount - 1);

    for (i = 0; i < SLOT_COUNT; i++) {
        if (currentLayout.slots[i] === EMPTY_SLOT_ID || !optionById(currentLayout.slots[i])) next[i] = 0;
    }

    for (i = 0; i < active.length; i++) {
        slotIndex = active[i];
        if (slotIndex === index) continue;
        otherIndexes.push(slotIndex);
        weights.push(Math.max(0, next[slotIndex] - MIN_SLOT_WIDTH));
    }

    extras = distributeFraction(Math.max(0, extraTotal), weights);
    next[index] = target;
    for (i = 0; i < otherIndexes.length; i++) {
        next[otherIndexes[i]] = roundWidth(MIN_SLOT_WIDTH + extras[i]);
    }
    return settleWidths(next, active);
}


var rawLayoutText = String(window.GetProperty(PROPERTY_LAYOUT, '') || '');
var layoutWasStored = !!rawLayoutText;
var currentLayout = coerceLayoutShape(rawLayoutText
    ? parseJsonText(rawLayoutText, LEGACY_DEFAULT_LAYOUT)
    : LEGACY_DEFAULT_LAYOUT);

var rawPresetsText = String(window.GetProperty(PROPERTY_PRESETS, '') || '');
var presets = loadRawPresets(rawPresetsText);
var presetsWereStored = !!rawPresetsText && presets.length > 0;
// activePresetId survives edits so update/revert keeps its target; layoutDirty
// separately records whether the current layout still matches that preset.
var activePresetId = String(window.GetProperty(PROPERTY_ACTIVE_PRESET, '') || '');
var layoutDirty = !!window.GetProperty(PROPERTY_LAYOUT_DIRTY, false);
var presetNameDraft = String(window.GetProperty(PROPERTY_PRESET_NAME, 'New preset') || 'New preset');

if (!presets.length) {
    presets.push({ id: 'default', name: 'Default', layout: clone(currentLayout) });
}
ensureActivePresetExists();

function coerceLayoutShape(value) {
    var slots = [];
    var widths = [];
    value = value || {};

    for (var i = 0; i < SLOT_COUNT; i++) {
        slots[i] = String(value.slots && typeof value.slots[i] !== 'undefined'
            ? value.slots[i]
            : EMPTY_SLOT_ID);
        widths[i] = roundWidth(Number(value.widths && value.widths[i]) || 0);
    }
    return { slots: slots, widths: widths };
}

function preferredDefaultIds() {
    var result = [];
    var used = Object.create(null);
    var i;
    var id;

    for (i = 0; i < LEGACY_DEFAULT_LAYOUT.slots.length; i++) {
        id = resolveStoredPanelId(LEGACY_DEFAULT_LAYOUT.slots[i]);
        if (id && !used[id]) {
            result.push(id);
            used[id] = true;
        }
    }
    for (i = 0; i < PANEL_OPTIONS.length; i++) {
        id = PANEL_OPTIONS[i].id;
        if (!used[id]) {
            result.push(id);
            used[id] = true;
        }
    }
    return result;
}

function defaultLayoutForCurrentPanels() {
    var candidates = preferredDefaultIds();
    var slots = [];
    var widths;
    var i;

    for (i = 0; i < SLOT_COUNT; i++) {
        slots[i] = i < candidates.length ? candidates[i] : EMPTY_SLOT_ID;
    }
    widths = normalizeWidthsForSlots(LEGACY_DEFAULT_LAYOUT.widths, slots);
    return { slots: slots, widths: widths };
}

function normalizeSlots(input, fillAvailable, preserveMissing) {
    var result = [EMPTY_SLOT_ID, EMPTY_SLOT_ID, EMPTY_SLOT_ID, EMPTY_SLOT_ID];
    var used = Object.create(null);
    var source = isArray(input) ? input : [];
    var candidates = preferredDefaultIds();
    var i;
    var rawId;
    var id;
    var j;

    for (i = 0; i < SLOT_COUNT; i++) {
        rawId = trimText(typeof source[i] === 'undefined' ? EMPTY_SLOT_ID : source[i]);
        if (!rawId || rawId === EMPTY_SLOT_ID) continue;

        id = resolveStoredPanelId(rawId);
        if (!id && preserveMissing) id = rawId;
        if (id && !used[id]) {
            result[i] = id;
            used[id] = true;
        }
    }

    if (fillAvailable) {
        for (i = 0; i < SLOT_COUNT; i++) {
            if (result[i] !== EMPTY_SLOT_ID) continue;
            for (j = 0; j < candidates.length; j++) {
                id = candidates[j];
                if (!used[id]) {
                    result[i] = id;
                    used[id] = true;
                    break;
                }
            }
        }
    }

    return result;
}

function normalizeLayout(value, fillAvailable, preserveMissing) {
    var shaped = coerceLayoutShape(value);
    var slots = normalizeSlots(shaped.slots, !!fillAvailable, !!preserveMissing);
    return {
        slots: slots,
        widths: normalizeWidthsForSlots(shaped.widths, slots)
    };
}

function loadRawPresets(raw) {
    var loaded = parseJsonText(raw, []);
    var result = [];
    var usedIds = Object.create(null);
    var i;
    var item;

    if (!isArray(loaded)) loaded = [];
    for (i = 0; i < loaded.length && result.length < MAX_PRESETS; i++) {
        item = loaded[i];
        if (!item || !item.id || !item.name || !item.layout) continue;
        if (usedIds[String(item.id)]) continue;
        usedIds[String(item.id)] = true;
        result.push({
            id: String(item.id),
            name: String(item.name),
            layout: coerceLayoutShape(item.layout)
        });
    }
    return result;
}

function saveLayout() {
    window.SetProperty(PROPERTY_LAYOUT, JSON.stringify(currentLayout));
    if (panelsInitialised || layoutWasStored || presetsWereStored) layoutWasStored = true;
}

function savePresets() {
    window.SetProperty(PROPERTY_PRESETS, JSON.stringify(presets));
    presetsWereStored = true;
}

function saveActivePreset() {
    window.SetProperty(PROPERTY_ACTIVE_PRESET, activePresetId);
    window.SetProperty(PROPERTY_LAYOUT_DIRTY, layoutDirty);
}

function savePresetNameDraft() {
    window.SetProperty(PROPERTY_PRESET_NAME, presetNameDraft);
}

function reconcilePanelDependentState() {
    var beforeLayout = currentLayout ? JSON.stringify(currentLayout) : '';
    var beforePresets = JSON.stringify(presets);
    var i;

    if (!currentLayout) currentLayout = defaultLayoutForCurrentPanels();
    else currentLayout = normalizeLayout(currentLayout, !layoutWasStored, layoutWasStored);

    if (!presets.length) {
        presets.push({
            id: 'default',
            name: 'Default',
            layout: clone(currentLayout || defaultLayoutForCurrentPanels())
        });
    } else if (!presetsWereStored && presets.length === 1 && presets[0].id === 'default') {
        presets[0].layout = clone(currentLayout || defaultLayoutForCurrentPanels());
    } else {
        for (i = 0; i < presets.length; i++) {
            presets[i].layout = normalizeLayout(presets[i].layout, false, true);
        }
    }

    if (beforeLayout !== JSON.stringify(currentLayout) || !layoutWasStored) saveLayout();
    if (beforePresets !== JSON.stringify(presets) || !presetsWereStored) savePresets();
    ensureActivePresetExists();
}

function presetIndexById(id) {
    for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) return i;
    }
    return -1;
}

function ensureActivePresetExists() {
    if (activePresetId && presetIndexById(activePresetId) === -1) {
        activePresetId = '';
        layoutDirty = false;
        saveActivePreset();
    }
}

function uniquePresetName(requested, ignoredId) {
    var base = trimText(requested) || 'Preset';
    var candidate = base;
    var suffix = 2;
    var i;
    var used;

    while (true) {
        used = false;
        for (i = 0; i < presets.length; i++) {
            if (presets[i].id === ignoredId) continue;
            if (String(presets[i].name).toLowerCase() === candidate.toLowerCase()) {
                used = true;
                break;
            }
        }
        if (!used) return candidate;
        candidate = base + ' ' + suffix;
        suffix++;
    }
}

function makePresetId() {
    var base = 'preset_' + new Date().getTime();
    var id = base;
    var n = 2;
    while (presetIndexById(id) !== -1) {
        id = base + '_' + n;
        n++;
    }
    return id;
}

function markLayoutDirty() {
    setLayoutDirty(true);
    saveLayout();
}

function setLayoutDirty(dirty) {
    dirty = !!dirty;
    if (layoutDirty === dirty) return;
    layoutDirty = dirty;
    window.SetProperty(PROPERTY_LAYOUT_DIRTY, layoutDirty);
}


function acquirePanelSnapshot() {
    var count = safeGetPanelCount();
    if (!panelsInitialised || count < 0 || count !== detectedPanelCount || count !== PANEL_OPTIONS.length) return null;

    var captions = [];
    for (var i = 0; i < PANEL_OPTIONS.length; i++) captions.push(PANEL_OPTIONS[i].caption);
    return PanelHostKit.acquireSnapshot(count, captions);
}

function safeConfigurePanel(panel) {
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

function safeMovePanel(panel, x, y, width, height) {
    return PanelHostKit.safeMovePanel(panel, x, y, width, height);
}

function safeShowPanel(panel, show) {
    return PanelHostKit.safeShowPanel(panel, show);
}


function getDividerWidth() {
    return resizingModeEnabled ? scale(DIVIDER_SIZE) : 0;
}

// The Global settings provider owns persistence for resizing mode.
function adoptResizingMode(enabled) {
    var next = !!enabled;
    if (next === resizingModeEnabled) return;

    resizingModeEnabled = next;
    if (!resizingModeEnabled) endDrag();
    hoverDividerIndex = -1;
    requestWork(false, true);
}

function setResizingModeEnabled(enabled) {
    var next = !!enabled;
    if (next === resizingModeEnabled) return;

    resizingModeEnabled = next;
    if (!resizingModeEnabled) endDrag();
    hoverDividerIndex = -1;
    ResizingModeProtocol.setUntilAnswered(resizingModeEnabled);
    requestWork(false, true);
}


function applyLayoutNow() {
    if (!hostIsVisible()) return false;
    if (!panelsInitialised || safeGetPanelCount() !== detectedPanelCount) {
        panelScanPending = true;
        forcePanelScanPending = true;
        return false;
    }

    panelWidth = Math.max(0, Math.floor(Number(window.Width) || panelWidth || 0));
    panelHeight = Math.max(0, Math.floor(Number(window.Height) || panelHeight || 0));

    if (!currentLayout) reconcilePanelDependentState();
    currentLayout = normalizeLayout(currentLayout, false, true);
    var effectiveLayout = effectiveLayoutForAvailablePanels(currentLayout);

    var w = panelWidth;
    var h = panelHeight;
    var panels = null;
    var operationFailed = false;
    var selectedByPanelIndex = Object.create(null);
    var selectedSlots = [];
    var active = activeSlotIndexes(effectiveLayout.slots);
    var padding = scale(outerPaddingPt);
    var gap = scale(panelGapPt);
    var usableX;
    var usableY;
    var usableW;
    var usableH;
    var dividerW = getDividerWidth();
    var contentW;
    var cursor;
    var i;

    frameRects = [];
    dividerRects = [];
    if (w <= 0 || h <= 0) {
        layoutPending = false;
        return true;
    }

    panels = acquirePanelSnapshot();
    if (!panels) {
        panelScanPending = true;
        forcePanelScanPending = true;
        return false;
    }

    try {
        for (i = 0; i < panels.length; i++) {
            if (!safeConfigurePanel(panels[i])) operationFailed = true;
        }

        for (i = 0; i < SLOT_COUNT; i++) {
            if (effectiveLayout.slots[i] === EMPTY_SLOT_ID) continue;
            var option = optionById(effectiveLayout.slots[i]);
            if (!option || option.index < 0 || option.index >= panels.length) continue;
            selectedByPanelIndex[option.index] = true;
        }

        for (i = 0; i < panels.length; i++) {
            if (!selectedByPanelIndex[i] && !safeShowPanel(panels[i], false)) operationFailed = true;
        }

        usableX = Math.min(padding, Math.floor(w / 2));
        usableY = Math.min(padding, Math.floor(h / 2));
        usableW = Math.max(1, w - usableX * 2);
        usableH = Math.max(1, h - usableY * 2);

        // The Mica line owns the top pixel row; child windows paint over anything
        // they cover, so with no outer padding they would hide it.
        if (frameStyle === FRAME_STYLE_LINE) {
            var topReserve = Math.min(micaLineHeight(), Math.floor(h / 2));
            if (usableY < topReserve) {
                usableH = Math.max(1, usableH - (topReserve - usableY));
                usableY = topReserve;
            }
        }

        // Dividers are carved out of the usable width first, so the stored
        // percentages always describe the panel area alone. With resizing mode
        // off dividerW is 0 and the geometry is exactly what it used to be.
        contentW = Math.max(1, usableW - dividerW * Math.max(0, active.length - 1));
        cursor = usableX;

        for (i = 0; i < SLOT_COUNT; i++) {
            if (effectiveLayout.slots[i] === EMPTY_SLOT_ID) continue;

            var activePosition = active.indexOf(i);
            var isLastActive = activePosition === active.length - 1;
            var rawX1 = cursor;
            var rawX2 = isLastActive
                ? usableX + usableW
                : rawX1 + Math.round(contentW * effectiveLayout.widths[i] / 100);

            if (rawX2 > usableX + usableW) rawX2 = usableX + usableW;
            if (rawX2 < rawX1 + 1) rawX2 = rawX1 + 1;
            cursor = rawX2 + dividerW;

            if (!isLastActive && dividerW > 0) {
                dividerRects.push({
                    x: rawX2,
                    y: usableY,
                    w: dividerW,
                    h: usableH,
                    leftSlot: i,
                    rightSlot: active[activePosition + 1],
                    leftEdge: rawX1,
                    contentW: contentW
                });
            }

            var leftGap = activePosition > 0 ? Math.floor(gap / 2) : 0;
            var rightGap = activePosition >= 0 && activePosition < active.length - 1
                ? Math.ceil(gap / 2)
                : 0;

            var frameX = rawX1 + leftGap;
            var frameY = usableY;
            var frameW = Math.max(1, rawX2 - rawX1 - leftGap - rightGap);
            var frameH = usableH;
            var slotOption = optionById(effectiveLayout.slots[i]);
            if (!slotOption) continue;

            var border = frameStyleIsBare(frameStyle) ? 0 : scale(1);
            var titleH = frameStyle === FRAME_STYLE_WINDOW && showWindowTitles
                ? Math.min(Math.max(0, frameH - border * 2), scale(titleHeightPt))
                : 0;
            titleH = Math.max(0, titleH);

            var frameRadius = frameStyleIsBare(frameStyle)
                ? 0
                : Math.min(scale(cornerRadiusPt), Math.floor(Math.min(frameW, frameH) / 2));
            var inset = border + cornerClearance(frameRadius);

            var childX = frameX + inset;
            var childY = frameY + inset + titleH;
            var childW = Math.max(1, frameW - inset * 2);
            var childH = Math.max(1, frameH - inset * 2 - titleH);

            if (frameStyle !== FRAME_STYLE_SPACING) {
                frameRects.push({
                    x: frameX,
                    y: frameY,
                    w: frameW,
                    h: frameH,
                    titleH: titleH,
                    showTitle: showWindowTitles,
                    label: slotOption.label,
                    style: frameStyle
                });
            }

            var childPanel = panels[slotOption.index];
            if (!childPanel) {
                operationFailed = true;
                continue;
            }
            if (!safeMovePanel(childPanel, childX, childY, childW, childH)) {
                safeShowPanel(childPanel, false);
                operationFailed = true;
                continue;
            }
            selectedSlots.push(slotOption.index);
        }

        for (i = 0; i < selectedSlots.length; i++) {
            if (!safeShowPanel(panels[selectedSlots[i]], true)) operationFailed = true;
            if (!safeConfigurePanel(panels[selectedSlots[i]])) operationFailed = true;
        }
    } finally {
        panels = null;
    }

    if (operationFailed) {
        panelScanPending = true;
        forcePanelScanPending = true;
        return false;
    }

    layoutPending = false;
    return true;
}


function ensureModelReady() {
    if (!currentLayout) currentLayout = coerceLayoutShape(LEGACY_DEFAULT_LAYOUT);
    return !!currentLayout;
}

function setSlotPanel(index, panelId) {
    var otherIndex;
    var previous;
    var targetWasEmpty;
    var otherWidth;

    if (!ensureModelReady()) return false;
    panelId = String(panelId || '');
    panelId = panelId === EMPTY_SLOT_ID ? EMPTY_SLOT_ID : resolveStoredPanelId(panelId);

    if (index < 0 || index >= SLOT_COUNT) return false;
    if (panelId !== EMPTY_SLOT_ID && !optionById(panelId)) return false;
    if (currentLayout.slots[index] === panelId) return true;

    if (panelId === EMPTY_SLOT_ID) {
        if (optionById(currentLayout.slots[index]) && activeAvailableSlotCount(currentLayout.slots) <= 1) {
            return false;
        }
        currentLayout.slots[index] = EMPTY_SLOT_ID;
        currentLayout.widths[index] = 0;
        currentLayout.widths = normalizeWidthsForAvailablePanels(currentLayout.widths, currentLayout.slots);
    } else {
        targetWasEmpty = currentLayout.slots[index] === EMPTY_SLOT_ID;
        otherIndex = currentLayout.slots.indexOf(panelId);

        if (otherIndex !== -1 && otherIndex !== index) {
            previous = currentLayout.slots[index];
            currentLayout.slots[index] = panelId;
            currentLayout.slots[otherIndex] = previous;

            if (previous === EMPTY_SLOT_ID) {
                otherWidth = currentLayout.widths[otherIndex];
                currentLayout.widths[otherIndex] = 0;
                currentLayout.widths[index] = otherWidth;
            }
            currentLayout.widths = normalizeWidthsForAvailablePanels(currentLayout.widths, currentLayout.slots);
        } else {
            currentLayout.slots[index] = panelId;
            if (targetWasEmpty) {
                currentLayout.widths[index] = 0;
                currentLayout.widths = rebalanceOneWidth(index, DEFAULT_NEW_SLOT_WIDTH);
            } else {
                currentLayout.widths = normalizeWidthsForAvailablePanels(currentLayout.widths, currentLayout.slots);
            }
        }
    }

    markLayoutDirty();
    requestWork(false, true);
    broadcastState();
    return true;
}

function setSlotWidth(index, value) {
    if (!ensureModelReady()) return false;
    if (index < 0 || index >= SLOT_COUNT) return false;
    if (currentLayout.slots[index] === EMPTY_SLOT_ID || !optionById(currentLayout.slots[index])) return false;

    var next = rebalanceOneWidth(index, value);
    if (JSON.stringify(next) === JSON.stringify(currentLayout.widths)) return false;

    currentLayout.widths = next;
    markLayoutDirty();
    requestWork(false, true);
    broadcastState();
    return true;
}

function equalizeSlotWidths() {
    if (!ensureModelReady()) return false;
    if (!activeAvailableSlotCount(currentLayout.slots)) return false;

    var next = equalWidthsForSlots(currentLayout.slots);
    if (JSON.stringify(next) === JSON.stringify(currentLayout.widths)) return false;

    currentLayout.widths = next;
    markLayoutDirty();
    requestWork(false, true);
    broadcastState();
    return true;
}

// Dragging transfers width only between adjacent slots; persistence happens at gesture end.

function dividerHitPadding(divider) {
    var gap = scale(panelGapPt);
    var minimumPadding = Math.max(0, scale(DIVIDER_HIT_SIZE) - divider.w) / 2;
    return Math.max(minimumPadding, Math.floor(gap / 2));
}

function dividerIndexAt(x, y) {
    var padding;
    var i;

    if (!resizingModeEnabled) return -1;

    for (i = 0; i < dividerRects.length; i++) {
        padding = dividerHitPadding(dividerRects[i]);
        if (x >= dividerRects[i].x - padding &&
            x < dividerRects[i].x + dividerRects[i].w + padding &&
            y >= dividerRects[i].y &&
            y < dividerRects[i].y + dividerRects[i].h) {
            return i;
        }
    }
    return -1;
}

function beginDrag(index, x) {
    var divider = dividerRects[index];

    if (!divider || !ensureModelReady()) return false;
    if (currentLayout.slots[divider.leftSlot] === EMPTY_SLOT_ID) return false;
    if (currentLayout.slots[divider.rightSlot] === EMPTY_SLOT_ID) return false;

    activeDrag = {
        leftSlot: divider.leftSlot,
        rightSlot: divider.rightSlot,
        leftEdge: divider.leftEdge,
        contentW: Math.max(1, divider.contentW),
        totalWidth: roundWidth(
            currentLayout.widths[divider.leftSlot] +
            currentLayout.widths[divider.rightSlot]
        ),
        grabOffset: x - divider.x,
        changed: false
    };

    hoverDividerIndex = index;
    return true;
}

function updateDrag(x) {
    var drag = activeDrag;
    var leftWidth;

    if (!drag) return false;

    leftWidth = roundWidth(clamp(
        (x - drag.grabOffset - drag.leftEdge) * 100 / drag.contentW,
        MIN_SLOT_WIDTH,
        drag.totalWidth - MIN_SLOT_WIDTH
    ));

    if (leftWidth === currentLayout.widths[drag.leftSlot]) return false;

    currentLayout.widths[drag.leftSlot] = leftWidth;
    currentLayout.widths[drag.rightSlot] = roundWidth(drag.totalWidth - leftWidth);
    drag.changed = true;
    requestWork(false, true);
    return true;
}

function endDrag(scheduleWork) {
    var changed;

    if (!activeDrag) return false;

    changed = activeDrag.changed;
    activeDrag = null;

    if (changed) {
        markLayoutDirty();
        if (scriptActive) broadcastState();
    }

    if (scheduleWork !== false && scriptActive) requestWork(false, true);
    return changed;
}


function loadPreset(id) {
    ensureModelReady();
    var index = presetIndexById(String(id || ''));
    if (index === -1) return false;

    currentLayout = panelsInitialised
        ? normalizeLayout(presets[index].layout, false, true)
        : coerceLayoutShape(presets[index].layout);
    activePresetId = presets[index].id;
    presetNameDraft = presets[index].name;
    setLayoutDirty(false);
    saveLayout();
    saveActivePreset();
    savePresetNameDraft();
    requestWork(false, true);
    broadcastState();
    return true;
}

// Throws away edits made since the preset was loaded. Needed as an explicit
// action because re-picking the already-selected entry in the "Load preset"
// dropdown fires no change event, so there would otherwise be no way back.
function revertToActivePreset() {
    if (!activePresetId || presetIndexById(activePresetId) === -1) return false;
    return loadPreset(activePresetId);
}

function saveAsPreset(name) {
    ensureModelReady();
    if (presets.length >= MAX_PRESETS) {
        // Capacity failure is user-triggered, so surface it instead of silently refusing.
        try {
            fb.ShowPopupMessage(
                'All ' + MAX_PRESETS + ' preset slots are in use.\n\n' +
                'Delete a preset in RVG Settings \u203a Bottom bar layout \u203a Presets before saving another, or use ' +
                '"Update current preset" to overwrite the one you have loaded.',
                window.Name);
        } catch (e) { /* Popup unavailable; the capacity hint still covers it. */ }
        broadcastState();
        return false;
    }

    var item = {
        id: makePresetId(),
        name: uniquePresetName(name || presetNameDraft, ''),
        layout: panelsInitialised ? normalizeLayout(currentLayout, false, true) : coerceLayoutShape(currentLayout)
    };

    presets.push(item);
    activePresetId = item.id;
    presetNameDraft = item.name;
    setLayoutDirty(false);
    savePresets();
    saveActivePreset();
    savePresetNameDraft();
    broadcastState();
    return true;
}

function updatePreset(id) {
    ensureModelReady();
    var targetId = String(id == null ? '' : id);
    var index = presetIndexById(targetId);
    if (index === -1) return false;

    presets[index].layout = panelsInitialised
        ? normalizeLayout(currentLayout, false, true)
        : coerceLayoutShape(currentLayout);
    activePresetId = presets[index].id;
    presetNameDraft = presets[index].name;
    setLayoutDirty(false);
    savePresets();
    saveActivePreset();
    savePresetNameDraft();
    broadcastState();
    return true;
}

function renamePreset(id, name) {
    var targetId = String(id == null ? '' : id);
    var index = presetIndexById(targetId);
    if (index === -1) return false;

    var nextName = uniquePresetName(name || presetNameDraft, presets[index].id);
    presets[index].name = nextName;
    if (activePresetId === presets[index].id) presetNameDraft = nextName;
    savePresets();
    savePresetNameDraft();
    broadcastState();
    return true;
}

function deletePreset(id) {
    ensureModelReady();
    var targetId = String(id == null ? '' : id);
    var index = presetIndexById(targetId);
    if (index === -1) return false;

    presets.splice(index, 1);
    if (activePresetId === targetId) {
        // Deleting the active preset leaves the current layout unsaved.
        activePresetId = '';
        setLayoutDirty(false);
    }

    if (!presets.length) {
        presets.push({
            id: 'default',
            name: 'Default',
            layout: panelsInitialised
                ? normalizeLayout(currentLayout || defaultLayoutForCurrentPanels(), false, true)
                : coerceLayoutShape(currentLayout || LEGACY_DEFAULT_LAYOUT)
        });
    }

    savePresets();
    saveActivePreset();
    broadcastState();
    return true;
}


function stateForBroadcast() {
    var list = [];
    var panels = [];
    var i;

    for (i = 0; i < presets.length && i < MAX_PRESETS; i++) {
        list.push({ id: presets[i].id, name: presets[i].name });
    }
    for (i = 0; i < PANEL_OPTIONS.length; i++) {
        panels.push({ id: PANEL_OPTIONS[i].id, label: PANEL_OPTIONS[i].label });
    }

    return {
        version: 2,
        maxPresets: MAX_PRESETS,
        presets: list,
        activePresetId: activePresetId,
        layoutDirty: layoutDirty,
        presetNameDraft: presetNameDraft,
        layout: clone(currentLayout),
        panels: panels
    };
}

function broadcastState() {
    // Every child slot reads its configuration from this broadcast.
    try { BottomBarProtocol.broadcastState(stateForBroadcast()); }
    catch (e) { reportFailure('the bottom-bar state could not be broadcast', e); }
}


function choicesForSlot(index) {
    var choices = [{ value: EMPTY_SLOT_ID, label: 'Disabled' }];
    var selected = currentLayout && currentLayout.slots ? String(currentLayout.slots[index] || '') : '';

    if (selected && selected !== EMPTY_SLOT_ID && !optionById(selected)) {
        choices.push({ value: selected, label: 'Unavailable panel: ' + selected });
    }
    for (var i = 0; i < PANEL_OPTIONS.length; i++) {
        choices.push({ value: PANEL_OPTIONS[i].id, label: PANEL_OPTIONS[i].label });
    }
    return choices;
}

function presetChoices() {
    // Keep the active preset selected while dirty so update/revert retains a target.
    var choices = [{ value: '', label: 'Current layout (not saved)' }];
    for (var i = 0; i < presets.length; i++) {
        choices.push({
            value: presets[i].id,
            label: presets[i].id === activePresetId && layoutDirty
                ? presets[i].name + '  (modified)'
                : presets[i].name
        });
    }
    return choices;
}

function activePresetStatus() {
    var index = presetIndexById(activePresetId);
    if (index === -1) return 'Current layout is not based on a saved preset';
    if (layoutDirty) {
        return 'Loaded: ' + presets[index].name + ' - modified and not saved.';
    }
    return 'Loaded: ' + presets[index].name;
}

function presetCapacityStatus() {
    if (presets.length >= MAX_PRESETS) {
        return presets.length + ' of ' + MAX_PRESETS + ' saved; delete one before saving another';
    }
    return presets.length + ' of ' + MAX_PRESETS + ' saved';
}

function formatWidthPercent(value) {
    var rounded = Math.round(Number(value) * 10) / 10;
    if (!isFinite(rounded)) rounded = 0;
    return (rounded === Math.round(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1)) + ' %';
}

function describeCurrentSplit(layout) {
    var active = activeAvailableSlotIndexes(layout.slots);
    var parts = [];
    var i;

    if (!active.length) return 'No panels assigned';
    for (i = 0; i < active.length; i++) {
        parts.push(formatWidthPercent(layout.widths[active[i]]));
    }
    return parts.join('  /  ');
}

function getMySettings() {
    refreshMetadataForSettings(false);
    ensureModelReady();
    var rows = [];
    var settingsLayout = effectiveLayoutForAvailablePanels(currentLayout);
    var i;

    for (i = 0; i < SLOT_COUNT; i++) {
        rows.push({
            id: 'slot' + (i + 1) + 'Content',
            label: 'Slot ' + (i + 1) + ' content',
            type: 'choice',
            value: currentLayout.slots[i],
            choiceValueType: 'string',
            choices: choicesForSlot(i),
            section: 'Slots'
        });
    }

    rows.push({
        id: 'swapRule',
        label: 'Panel swapping',
        type: 'info',
        value: 'Choosing a panel already used in another slot swaps the two.',
        section: 'Slots'
    });
    rows.push({
        id: 'widthRule',
        label: 'Panel widths',
        type: 'info',
        value: 'Active slots share 100% of the width. Disabled slots use none.',
        section: 'Sizing'
    });

    rows.push({
        id: 'enableResizingMode',
        label: 'Allow drag-to-resize',
        type: 'bool',
        value: resizingModeEnabled,
        section: 'Sizing'
    });
    rows.push({
        id: 'resizingHelp',
        label: 'How to resize',
        type: 'info',
        value: resizingModeEnabled
            ? 'Drag dividers to resize. Double-click a divider to split the adjacent panels evenly.'
            : 'Turn on drag-to-resize to adjust panel widths.',
        section: 'Sizing'
    });
    rows.push({
        id: 'equalizeWidths',
        label: 'Make all panels equal width',
        type: 'action',
        value: null,
        actionLabel: 'Apply',
        section: 'Sizing'
    });
    rows.push({
        id: 'currentSplit',
        label: 'Current split',
        type: 'info',
        value: describeCurrentSplit(settingsLayout),
        section: 'Sizing'
    });
    rows.push({
        id: 'frameStyle',
        label: 'Panel style',
        type: 'choice',
        value: frameStyle,
        choiceValueType: 'string',
        choices: [
            { value: FRAME_STYLE_SPACING, label: 'No frame' },
            { value: FRAME_STYLE_LINE, label: 'Mica line' },
            { value: FRAME_STYLE_CARD, label: 'Card frame' },
            { value: FRAME_STYLE_WINDOW, label: 'Window frame with title bar' }
        ],
        hint: 'Mica line drops the panel boxes for one hairline along the top of the bar, matching the tab bar, with a divider in each gap.',
        section: 'Appearance'
    });
    rows.push({
        id: 'showWindowTitles',
        label: 'Show panel titles',
        type: 'bool',
        value: showWindowTitles,
        hidden: frameStyle !== FRAME_STYLE_WINDOW,
        section: 'Appearance'
    });
    rows.push({
        id: 'outerPadding',
        label: 'Outer padding',
        type: 'choice',
        value: outerPaddingPt,
        choiceValueType: 'number',
        choices: [
            { value: 0, label: 'None' },
            { value: 2, label: '2 px' },
            { value: 4, label: '4 px' },
            { value: 6, label: '6 px' },
            { value: 8, label: '8 px' },
            { value: 12, label: '12 px' },
            { value: 16, label: '16 px' },
            { value: 24, label: '24 px' },
            { value: 32, label: '32 px' }
        ],
        section: 'Appearance'
    });
    rows.push({
        id: 'panelGap',
        label: 'Gap between panels',
        type: 'choice',
        value: panelGapPt,
        choiceValueType: 'number',
        choices: [
            { value: 0, label: 'None' },
            { value: 2, label: '2 px' },
            { value: 4, label: '4 px' },
            { value: 6, label: '6 px' },
            { value: 8, label: '8 px' },
            { value: 12, label: '12 px' },
            { value: 16, label: '16 px' },
            { value: 24, label: '24 px' },
            { value: 32, label: '32 px' },
            { value: 40, label: '40 px' }
        ],
        section: 'Appearance'
    });
    rows.push({
        id: 'titleHeight',
        label: 'Title bar height',
        type: 'choice',
        value: titleHeightPt,
        choiceValueType: 'number',
        hidden: frameStyle !== FRAME_STYLE_WINDOW,
        choices: [
            { value: 16, label: '16 px' },
            { value: 20, label: '20 px' },
            { value: 24, label: '24 px' },
            { value: 28, label: '28 px' },
            { value: 32, label: '32 px' },
            { value: 36, label: '36 px' },
            { value: 40, label: '40 px' },
            { value: 48, label: '48 px' }
        ],
        section: 'Appearance'
    });
    rows.push({
        id: 'cornerRadius',
        label: 'Corner radius',
        type: 'choice',
        value: cornerRadiusPt,
        choiceValueType: 'number',
        hidden: frameStyleIsBare(frameStyle),
        choices: [
            { value: 0, label: 'Square' },
            { value: 2, label: '2 px' },
            { value: 4, label: '4 px' },
            { value: 6, label: '6 px' },
            { value: 8, label: '8 px' },
            { value: 12, label: '12 px' },
            { value: 16, label: '16 px' }
        ],
        section: 'Appearance'
    });
    rows.push({
        id: 'accentLine',
        label: 'Show accent underline',
        type: 'bool',
        value: accentLineEnabled,
        section: 'Appearance'
    });
    rows.push({
        id: 'activePreset',
        label: 'Load preset',
        type: 'choice',
        value: activePresetId,
        choiceValueType: 'string',
        choices: presetChoices(),
        section: 'Presets'
    });
    rows.push({
        id: 'presetStatus',
        label: 'Preset status',
        type: 'info',
        value: activePresetStatus(),
        section: 'Presets'
    });
    rows.push({
        id: 'presetCapacity',
        label: 'Preset buttons',
        type: 'info',
        value: presetCapacityStatus(),
        hint: 'Preset buttons use the first three letters of the name.',
        section: 'Presets'
    });
    rows.push({
        id: 'presetName',
        label: 'Preset name',
        type: 'string',
        value: presetNameDraft,
        hint: 'Preset buttons use the first three letters of the name.',
        section: 'Presets'
    });
    rows.push({
        id: 'saveAsPreset',
        label: 'Save as new preset',
        type: 'action',
        value: null,
        actionLabel: 'Save',
        section: 'Presets'
    });
    rows.push({
        id: 'updateActivePreset',
        label: 'Update current preset',
        type: 'action',
        value: null,
        actionLabel: 'Update',
        disabled: !(activePresetId && presetIndexById(activePresetId) !== -1),
        section: 'Presets'
    });
    rows.push({
        id: 'revertActivePreset',
        label: 'Revert current preset',
        type: 'action',
        value: null,
        actionLabel: 'Revert',
        disabled: !(layoutDirty && activePresetId && presetIndexById(activePresetId) !== -1),
        section: 'Presets'
    });
    rows.push({
        id: 'renameActivePreset',
        label: 'Rename current preset',
        type: 'action',
        value: null,
        actionLabel: 'Rename',
        disabled: !(activePresetId && presetIndexById(activePresetId) !== -1),
        section: 'Presets'
    });
    rows.push({
        id: 'deleteActivePreset',
        label: 'Delete current preset',
        type: 'action',
        value: null,
        actionLabel: 'Delete',
        disabled: !(activePresetId && presetIndexById(activePresetId) !== -1),
        section: 'Presets'
    });

    return rows;
}

function applyMySetting(settingId, value) {
    var match = /^slot([1-4])Content$/.exec(settingId);
    if (match) {
        setSlotPanel(Number(match[1]) - 1, String(value));
        return;
    }

    // Retain the old width-setting IDs for programmatic compatibility.
    match = /^slot([1-4])Width$/.exec(settingId);
    if (match) {
        setSlotWidth(Number(match[1]) - 1, Number(value));
        return;
    }

    switch (settingId) {
    case 'enableResizingMode':
        setResizingModeEnabled(!!value);
        return;
    case 'equalizeWidths':
        equalizeSlotWidths();
        return;
    case 'frameStyle':
        frameStyle = normaliseFrameStyle(value);
        window.SetProperty(PROPERTY_FRAME_STYLE, frameStyle);
        requestWork(false, true);
        break;
    case 'showWindowTitles':
        showWindowTitles = !!value;
        window.SetProperty(PROPERTY_SHOW_WINDOW_TITLES, showWindowTitles);
        requestWork(false, true);
        break;
    case 'outerPadding':
        outerPaddingPt = Math.round(clamp(value, 0, 32));
        window.SetProperty(PROPERTY_OUTER_PADDING, outerPaddingPt);
        requestWork(false, true);
        break;
    case 'panelGap':
        panelGapPt = Math.round(clamp(value, 0, 40));
        window.SetProperty(PROPERTY_PANEL_GAP, panelGapPt);
        requestWork(false, true);
        break;
    case 'titleHeight':
        titleHeightPt = Math.round(clamp(value, 16, 48));
        window.SetProperty(PROPERTY_TITLE_HEIGHT, titleHeightPt);
        requestWork(false, true);
        break;
    case 'cornerRadius':
        cornerRadiusPt = Math.round(clamp(value, 0, 16));
        window.SetProperty(PROPERTY_CORNER_RADIUS, cornerRadiusPt);
        requestWork(false, true);
        break;
    case 'accentLine':
        accentLineEnabled = !!value;
        window.SetProperty(PROPERTY_ACCENT_LINE, accentLineEnabled);
        if (hostIsVisible()) window.Repaint(true);
        break;
    case 'activePreset':
        if (String(value || '')) {
            loadPreset(String(value));
        } else {
            activePresetId = '';
            setLayoutDirty(false);
            saveActivePreset();
            broadcastState();
        }
        break;
    case 'presetName':
        presetNameDraft = trimText(value) || 'Preset';
        savePresetNameDraft();
        broadcastState();
        break;
    case 'saveAsPreset':
        saveAsPreset(presetNameDraft);
        break;
    case 'updateActivePreset':
        updatePreset(activePresetId);
        break;
    case 'revertActivePreset':
        revertToActivePreset();
        break;
    case 'renameActivePreset':
        renamePreset(activePresetId, presetNameDraft);
        break;
    case 'deleteActivePreset':
        deletePreset(activePresetId);
        break;
    }
}


// A child panel is a real window with square corners, so it is inset far enough
// that the frame's corner arc is never overpainted. r * (1 - 1/sqrt2) is how deep
// the arc cuts at 45 degrees.
function cornerClearance(radius) {
    return radius > 0 ? Math.ceil(radius * 0.3) : 0;
}

// Edge fade for the Mica line. Same shape as the spectrum ribbon's edge fade:
// a smoothstep over nine cached stops, rebuilt only when the colour changes.
var MICA_FADE_SAMPLES = 9;
// Fraction of the run that fades at each end. The gap dividers are short, so the
// share that reads as a soft edge across the bar leaves them ticks; 0.5 has no core.
var MICA_FADE_RATIO = 0.14;
var MICA_FADE_RATIO_VERTICAL = 0.45;
var micaFadeInStops = [];
var micaFadeOutStops = [];
var micaFadeAim = '';
var gradientSupported = true;

function ensureMicaFadeStops(colour) {
    var aim = String(colour);
    var alpha = (Number(colour) >>> 24) & 0xff;
    var write = 0;
    var i;
    var position;
    var smooth;

    if (micaFadeAim === aim) return;
    micaFadeAim = aim;
    micaFadeInStops.length = MICA_FADE_SAMPLES * 2;
    micaFadeOutStops.length = MICA_FADE_SAMPLES * 2;

    for (i = 0; i < MICA_FADE_SAMPLES; i++) {
        position = i / (MICA_FADE_SAMPLES - 1);
        smooth = position * position * (3 - 2 * position);
        micaFadeInStops[write] = position;
        micaFadeOutStops[write++] = position;
        micaFadeInStops[write] = RivageUI.withAlpha(colour, alpha * smooth);
        micaFadeOutStops[write++] = RivageUI.withAlpha(colour, alpha * (1 - smooth));
    }
}

// Position 0 is the left edge at angle 0 and the top edge at angle 90.
function fadedLine(gr, x, y, w, h, vertical, colour) {
    var run = vertical ? h : w;
    var span;

    if (w <= 0 || h <= 0) return;

    span = Math.min(
        Math.round(run * (vertical ? MICA_FADE_RATIO_VERTICAL : MICA_FADE_RATIO)),
        Math.floor(run / 2) - 1,
        scale(180)
    );

    if (!gradientSupported || span < 2) {
        gr.FillSolidRect(x, y, w, h, colour);
        return;
    }

    ensureMicaFadeStops(colour);

    try {
        if (vertical) {
            gr.FillGradRectV2(x, y, w, span, 90, micaFadeInStops);
            gr.FillGradRectV2(x, y + h - span, w, span, 90, micaFadeOutStops);
            gr.FillSolidRect(x, y + span, w, h - span * 2, colour);
        } else {
            gr.FillGradRectV2(x, y, span, h, 0, micaFadeInStops);
            gr.FillGradRectV2(x + w - span, y, span, h, 0, micaFadeOutStops);
            gr.FillSolidRect(x + span, y, w - span * 2, h, colour);
        }
    } catch (e) {
        // One-shot downgrade, as spectrum_panel does: builds without
        // FillGradRectV2 keep the flat hairline for the rest of the session.
        gradientSupported = false;
        gr.FillSolidRect(x, y, w, h, colour);
    }
}

// One hairline along the whole bar, as the tab bar draws it, plus a divider
// dropped down each gap. No box, no fill: the panels keep the bare backdrop.
function drawMicaLine(gr, width) {
    var lineH = micaLineHeight();
    var previous = null;
    var frame;
    var gapLeft;
    var gapRight;
    var i;

    fadedLine(gr, 0, 0, Math.max(0, width), lineH, false, COLOUR_SEPARATOR);

    for (i = 0; i < frameRects.length; i++) {
        frame = frameRects[i];
        if (previous) {
            gapLeft = previous.x + previous.w;
            gapRight = frame.x;
            if (gapRight - gapLeft >= lineH) {
                fadedLine(
                    gr,
                    gapLeft + Math.floor((gapRight - gapLeft - lineH) / 2),
                    frame.y, lineH, frame.h, true, COLOUR_SEPARATOR
                );
            }
        }
        previous = frame;
    }
}

function drawFrame(gr, frame) {
    var radius = Math.min(scale(cornerRadiusPt), Math.floor(Math.min(frame.w, frame.h) / 2));
    var accent = sharedAlbumAccent || DEFAULT_UWP_ACCENT;
    var fill = frame.style === FRAME_STYLE_WINDOW ? COLOUR_TITLE_BAR : COLOUR_FRAME;
    // Half-pixel offset on a 1 px pen: the rim lands on one pixel instead of
    // straddling two at half strength and bleeding into the panel gap.
    var rimX = frame.x + 0.5;
    var rimY = frame.y + 0.5;
    var rimW = Math.max(1, frame.w - 1);
    var rimH = Math.max(1, frame.h - 1);

    if (radius > 0) {
        gr.FillRoundRect(frame.x, frame.y, frame.w, frame.h, radius, radius, fill);
        gr.DrawRoundRect(rimX, rimY, rimW, rimH, radius, radius, 1, COLOUR_FRAME_RIM);
    } else {
        gr.FillSolidRect(frame.x, frame.y, frame.w, frame.h, fill);
        gr.DrawRect(rimX, rimY, rimW, rimH, 1, COLOUR_FRAME_RIM);
    }

    if (frame.style !== FRAME_STYLE_WINDOW || !frame.showTitle || frame.titleH <= 0) return;

    if (accentLineEnabled) {
        gr.FillSolidRect(frame.x + scale(1), frame.y + frame.titleH - scale(2),
            Math.max(1, frame.w - scale(2)), scale(2), accent);
    } else {
        gr.FillSolidRect(frame.x + scale(1), frame.y + frame.titleH - scale(1),
            Math.max(1, frame.w - scale(2)), scale(1), COLOUR_BORDER);
    }

    if (!frameFont) return;

    var textX = frame.x + scale(10);
    var textW = Math.max(1, frame.w - scale(20));
    gr.GdiDrawText(frame.label, frameFont, COLOUR_TITLE_TEXT,
        textX, frame.y, textW, frame.titleH - scale(1),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function on_size(width, height) {
    panelWidth = Math.max(0, Math.floor(Number(width)) || 0);
    panelHeight = Math.max(0, Math.floor(Number(height)) || 0);
    layoutPending = true;
}

function on_paint(gr) {
    observeChildCollection();
    scheduleVisibleWork();

    var w = Math.max(0, Number(window.Width) || panelWidth || 0);
    var h = Math.max(0, Number(window.Height) || panelHeight || 0);
    var i;
    var smoothingChanged = false;

    RivageBackdrop.paint(gr, 0, 0, w, h, COLOUR_BACKGROUND);

    // Antialiasing is only for the box styles' corner arcs: it spreads a 1 px
    // axis-aligned hairline over two half-strength rows, so the Mica line is drawn
    // aliased like the tab bar's separator.
    if (frameStyle === FRAME_STYLE_LINE) {
        drawMicaLine(gr, w);
    } else {
        if (typeof gr.SetSmoothingMode === 'function') {
            try {
                gr.SetSmoothingMode(4);
                smoothingChanged = true;
            } catch (e) {
                smoothingChanged = false;
            }
        }

        for (i = 0; i < frameRects.length; i++) drawFrame(gr, frameRects[i]);

        if (smoothingChanged) {
            try { gr.SetSmoothingMode(0); } catch (e2) { }
        }
    }

    for (i = 0; i < dividerRects.length; i++) drawDivider(gr, dividerRects[i], i);
}

// The in-gap divider is invisible at rest; hover/drag alone paints the affordance.
function drawDivider(gr, divider, index) {
    var isDragging = !!activeDrag &&
        activeDrag.leftSlot === divider.leftSlot &&
        activeDrag.rightSlot === divider.rightSlot;
    var lineW;

    if (!isDragging && (activeDrag || hoverDividerIndex !== index)) return;

    lineW = Math.max(1, scale(2));
    gr.FillSolidRect(
        divider.x + Math.floor((divider.w - lineW) / 2),
        divider.y,
        lineW,
        Math.max(1, divider.h),
        accentLineEnabled ? sharedAlbumAccent : COLOUR_TITLE_TEXT
    );
}


function setHoverDivider(index) {
    if (index === hoverDividerIndex) return false;
    hoverDividerIndex = index;
    if (hostIsVisible()) {
        try { window.Repaint(true); } catch (e) { }
    }
    return true;
}

function on_mouse_lbtn_down(x, y) {
    var index = dividerIndexAt(x, y);
    if (index === -1) return;

    beginDrag(index, x);
}

function on_mouse_move(x, y, mask) {
    if (activeDrag) {
        // A button release that happened over a child panel never reaches this
        // host, so a move without the left button held ends the drag instead.
        if (typeof mask === 'number' && !(mask & MK_LBUTTON)) {
            updateDrag(x);
            endDrag();
            return;
        }

        try { window.SetCursor(IDC_SIZEWE); } catch (e) { }
        updateDrag(x);
        return;
    }

    var index = dividerIndexAt(x, y);
    setHoverDivider(index);

    try { window.SetCursor(index === -1 ? IDC_ARROW : IDC_SIZEWE); } catch (e2) { }
}

function on_mouse_lbtn_up(x, y) {
    if (!activeDrag) return;

    updateDrag(x);
    endDrag();
}

function on_mouse_leave() {
    endDrag();
    setHoverDivider(-1);
}

function on_mouse_lbtn_dblclk(x, y) {
    var index = dividerIndexAt(x, y);
    var divider;
    var total;
    var half;

    if (index === -1 || !ensureModelReady()) return;

    endDrag();
    divider = dividerRects[index];
    total = roundWidth(
        currentLayout.widths[divider.leftSlot] +
        currentLayout.widths[divider.rightSlot]
    );
    half = roundWidth(total / 2);

    if (half === currentLayout.widths[divider.leftSlot]) return;

    currentLayout.widths[divider.leftSlot] = half;
    currentLayout.widths[divider.rightSlot] = roundWidth(total - half);
    markLayoutDirty();
    requestWork(false, true);
    broadcastState();
}

function on_colours_changed() {
    refreshTheme();
    SharedThemeProtocol.requestRepaint();
}

function on_font_changed() {
    dpi = RivageScale.dpi() || 96;
    rebuildFrameFont();
    requestWork(false, true);
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) {
        // Theme repaint is handled by SharedThemeProtocol. Mica frame mapping is
        // independent of native child-window transparency, so this stays paint-only.
        return;
    }
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (ResizingModeProtocol.consume(name, info, adoptResizingMode)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (hostIsVisible()) window.Repaint();
        return;
    }

    if (name === BottomBarProtocol.REQUEST_STATE) {
        broadcastState();
        return;
    }
    if (name === BottomBarProtocol.LOAD_PRESET) {
        if (info && typeof info.id === 'string' && info.id) loadPreset(info.id);
        return;
    }
    if (name === BottomBarProtocol.SAVE_AS_PRESET) {
        if (info && typeof info.name === 'string') saveAsPreset(info.name);
        return;
    }
    if (name === BottomBarProtocol.UPDATE_PRESET) {
        if (info && typeof info.id === 'string' && info.id) updatePreset(info.id);
        return;
    }
    if (name === BottomBarProtocol.RENAME_PRESET) {
        if (info && typeof info.id === 'string' && info.id && typeof info.name === 'string') {
            renamePreset(info.id, info.name);
        }
        return;
    }
    if (name === BottomBarProtocol.DELETE_PRESET) {
        if (info && typeof info.id === 'string' && info.id) deletePreset(info.id);
    }
}

function on_script_unload() {
    scriptActive = false;
    endDrag(false);

    if (workTimer !== null) {
        try { window.ClearTimeout(workTimer); } catch (e) { }
        workTimer = null;
    }
    if (retryTimer !== null) {
        try { window.ClearTimeout(retryTimer); } catch (e2) { }
        retryTimer = null;
    }
    if (startupTimer !== null) {
        try { window.ClearTimeout(startupTimer); } catch (e3) { }
        startupTimer = null;
    }
    if (childWatchTimer !== null) {
        try { window.ClearInterval(childWatchTimer); } catch (e4) { }
        childWatchTimer = null;
    }
    workScheduled = false;
    retryScheduled = false;
}

refreshTheme();
try { SharedAccentProtocol.request(); }
catch (e) { reportFailure('the Shared accent could not be requested', e); }
try { ResizingModeProtocol.requestUntilAnswered(); }
catch (e) { reportFailure('the resizing mode could not be requested', e); }

try {
    startupTimer = window.SetTimeout(function () {
        startupTimer = null;
        if (!scriptActive) return;
        broadcastState();
        requestWork(true, hostIsVisible());
    }, 0);
} catch (e) {
    startupTimer = null;
}

// Metadata-only watcher: no native wrappers survive the callback, and hidden
// branches remain idle. It also re-arms pending work after a transient timer failure.
try {
    childWatchTimer = window.SetInterval(function () {
        if (!scriptActive || !hostIsVisible() || workBusy || scanBusy) return;

        var fingerprint = readCurrentPanelFingerprint();
        if (!fingerprint) return;
        if (!panelsInitialised || fingerprint !== detectedPanelFingerprint) {
            requestWork(true, false);
        }
        if (panelScanPending || layoutPending) scheduleVisibleWork();
    }, CHILD_WATCH_INTERVAL);
} catch (e) {
    childWatchTimer = null;
}
