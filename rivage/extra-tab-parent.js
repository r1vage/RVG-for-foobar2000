'use strict';

window.DrawMode = 0; // GDI+

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\panel_host_kit.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\tab_bar_style.js');

window.DefineScript('RVG Top Tabs', {
    author: 'RivaGe',
    version: '3.1.0'
});

// Narrow failure reporting. Most empty catches in this file guard timer
// clears that are expected to fail and stay silent on purpose. This is for
// the few that mean something is actually broken and would otherwise leave
// no trace. Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Top Tabs] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// Direct children are discovered dynamically. Native PanelObject wrappers stay
// callback-local; recurring discovery/layout work remains idle while hidden.

var DT_CENTER       = 0x00000001;
var DT_VCENTER      = 0x00000004;
var DT_WORDBREAK    = 0x00000010;
var DT_SINGLELINE   = 0x00000020;
var DT_NOPREFIX     = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND  = 32649;

var PROPERTY_PREFIX       = 'RIVAGE.TOP_TABS.';
var PROPERTY_ACTIVE_KEY   = PROPERTY_PREFIX + 'Active key';
var PROPERTY_ACTIVE_INDEX = PROPERTY_PREFIX + 'Active index';

// Compatibility messages for external scripts. SELECT accepts an index, caption,
// visible label or stable duplicate-safe key.
var UWP_TOP_TABS_ACTIVE_UPDATE = 'UWP_TOP_TABS_V2.ACTIVE';
var UWP_TOP_TABS_SELECT        = 'UWP_TOP_TABS_V2.SELECT';
var UWP_TOP_TABS_QUERY         = 'UWP_TOP_TABS_V2.QUERY';

var MAX_TRANSIENT_RETRIES = 4;
var TRANSIENT_RETRY_DELAY = 25;
var RECOVERY_RETRY_DELAY = 1500;
var CHILD_WATCH_INTERVAL = 1500;

var DEFAULT_UWP_ACCENT = 0xff0078d4;

// This is the normal fit/scroll threshold, not a tab-count limit. When the
// tabs no longer fit at MIN_TAB_WIDTH, a browser-style all-tabs button is
// reserved on the right while the tab strip keeps its normal scrolling behavior.
var MIN_TAB_WIDTH = 84;
var MAX_TAB_WIDTH = 220;
var TAB_LIST_BUTTON_WIDTH = 36;

// ----- Helpers ---------------------------------------------------------------
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function RGB(red, green, blue) {
    return RivageUI.rgb(red, green, blue);
}

function opaqueColour(colour) {
    return SharedAccentProtocol.opaque(colour);
}

function blendColours(foreground, background, amount) {
    return RivageUI.mix(background, foreground, amount);
}

var dpi = (typeof window.DPI === 'number' && window.DPI > 0) ? window.DPI : 96;

function scale(value) {
    return Math.max(1, Math.round(value * dpi / 96));
}

function safeGetPanelCount() {
    return PanelHostKit.safeGetPanelCount();
}

function safePanelCaption(panel, fallback) {
    return PanelHostKit.safePanelCaption(panel, fallback);
}

function cleanCaption(caption) {
    return PanelHostKit.visibleCaptionPart(caption).toUpperCase();
}

// ----- Colours and fonts -----------------------------------------------------
var COLOUR_CONTENT        = RGB(32, 32, 32);
var COLOUR_TAB_BAR        = RGB(28, 28, 28);
var COLOUR_SEPARATOR      = RGB(51, 51, 51);
var COLOUR_TEXT_PRIMARY   = RGB(245, 245, 245);
var COLOUR_TEXT_SECONDARY = RGB(184, 184, 184);
var COLOUR_TEXT_MUTED     = RGB(126, 126, 126);
var COLOUR_MESSAGE        = RGB(174, 174, 174);

function refreshTheme() {
    var resolved = RivageUI.createTheme({ mode: 'dark', accent: sharedAlbumAccent });
    COLOUR_CONTENT = resolved.background;
    COLOUR_TAB_BAR = resolved.navigationSurface;
    COLOUR_SEPARATOR = resolved.navigationSeparator;
    COLOUR_TEXT_PRIMARY = resolved.navigationTextPrimary;
    COLOUR_TEXT_SECONDARY = resolved.navigationTextSecondary;
    COLOUR_TEXT_MUTED = resolved.navigationTextMuted;
    COLOUR_MESSAGE = resolved.textSecondary;
}

var messageFont = RivageUI.font('Segoe UI', Math.max(10, Math.round(12 * dpi / 96)), 0);

var tabFont = null;

function rebuildTabFont() {
    tabFont = TabBarStyle.drawingFont();
}
rebuildTabFont();

// ----- Runtime state ---------------------------------------------------------
var tabs = [];
var detectedPanelCount = -1;
var detectedPanelFingerprint = '';
var scanBusy = false;
var layoutBusy = false;
var initialized = false;
var scriptActive = true;
var childRefreshPending = false;
var childRefreshNeeded = false;
var layoutRequestPending = false;
var layoutNeeded = false;
var transientRetryCount = 0;
var recoveryRetryMode = false;
var childRefreshTimer = null;
var layoutTimer = null;
var startupTimer = null;
var childWatchTimer = null;
var pendingActiveKey = '';

var activeIndex = parseInt(window.GetProperty(PROPERTY_ACTIVE_INDEX, 0), 10);
if (!isFinite(activeIndex) || activeIndex < 0) activeIndex = 0;
var savedActiveKey = String(window.GetProperty(PROPERTY_ACTIVE_KEY, '') || '');

var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

var panelWidth = Math.max(0, Number(window.Width) || 0);
var panelHeight = Math.max(0, Number(window.Height) || 0);
var hoveredIndex = -1;
var pressedIndex = -1;
var hoveredTabListButton = false;
var pressedTabListButton = false;
var scrollX = 0;
var lastMouseX = -1;
var lastMouseY = -1;

// ----- Child discovery -------------------------------------------------------
function findIndexByKey(key) {
    if (!key) return -1;
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].key === key) return i;
    }
    return -1;
}

function hostIsVisible() {
    return VisiblePaintWork.isVisible();
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
            panel = null;
            if (caption === null) return '';
            captions.push(caption);
        }
        if (safeGetPanelCount() !== count) return '';
        return makePanelFingerprint(captions, count);
    } catch (e) {
        return '';
    }
}

function resetRetryLane() {
    transientRetryCount = 0;
    recoveryRetryMode = false;
}

function requestChildRefresh(resetRetry) {
    if (!scriptActive) return false;
    childRefreshNeeded = true;

    if (resetRetry) {
        resetRetryLane();
        if (childRefreshTimer !== null) {
            try { window.ClearTimeout(childRefreshTimer); } catch (e) { }
            childRefreshTimer = null;
            childRefreshPending = false;
        }
    }
    return scheduleChildRefresh();
}

function scheduleChildRefresh() {
    if (!scriptActive || !childRefreshNeeded || childRefreshPending || !hostIsVisible()) return false;

    var delay = recoveryRetryMode ? RECOVERY_RETRY_DELAY : TRANSIENT_RETRY_DELAY;
    if (!recoveryRetryMode) {
        transientRetryCount++;
        if (transientRetryCount >= MAX_TRANSIENT_RETRIES) recoveryRetryMode = true;
    }

    childRefreshPending = true;
    try {
        childRefreshTimer = window.SetTimeout(function () {
            childRefreshTimer = null;
            childRefreshPending = false;
            if (!scriptActive || !hostIsVisible()) return;

            if (!scanChildPanels(true)) {
                scheduleChildRefresh();
                return;
            }

            var targetIndex = activeIndex;
            if (pendingActiveKey) {
                var pendingIndex = findIndexByKey(pendingActiveKey);
                if (pendingIndex >= 0) targetIndex = pendingIndex;
                else pendingActiveKey = '';
            }

            var result = layoutChildren(panelWidth, panelHeight, targetIndex, true, true);
            if (result.activated) commitActiveTab(targetIndex);

            if (result.complete) {
                childRefreshNeeded = false;
                layoutNeeded = false;
                resetRetryLane();
            } else {
                scheduleChildRefresh();
            }
            updateHoverFromPointer(false);
            window.Repaint();
        }, delay);
        return true;
    } catch (e) {
        childRefreshTimer = null;
        childRefreshPending = false;
        return false;
    }
}

function scheduleLayout(width, height) {
    panelWidth = Math.max(0, Math.floor(Number(width)) || 0);
    panelHeight = Math.max(0, Math.floor(Number(height)) || 0);
    layoutNeeded = true;

    if (!scriptActive || !initialized || childRefreshNeeded || layoutRequestPending || !hostIsVisible()) return false;
    layoutRequestPending = true;

    // on_size may run inside JSplitter's native child transaction.
    try {
        layoutTimer = window.SetTimeout(function () {
            layoutTimer = null;
            layoutRequestPending = false;
            if (!scriptActive || !hostIsVisible()) return;

            var result = layoutChildren(panelWidth, panelHeight, activeIndex, false, false);
            if (result.complete) layoutNeeded = false;
            else requestChildRefresh(false);
            ensureTabVisible(activeIndex);
            updateHoverFromPointer(false);
        }, 25);
        return true;
    } catch (e) {
        layoutTimer = null;
        layoutRequestPending = false;
        return false;
    }
}

function scanChildPanels(force) {
    if (scanBusy) return false;

    var count = safeGetPanelCount();
    if (count < 0) return false;
    if (!force && initialized && count === detectedPanelCount) return true;

    scanBusy = true;

    var previousKey = tabs[activeIndex] ? tabs[activeIndex].key : savedActiveKey;
    var occurrence = Object.create(null);
    var found = [];
    var captions = [];
    var stable = true;

    try {
        for (var i = 0; i < count; i++) {
            // PanelObject wrappers are valid only while this callback owns them.
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
                var n = occurrence[caption] || 0;
                occurrence[caption] = n + 1;

                found.push({
                    caption: caption,
                    key: caption + '\u001f' + n,
                    label: cleanCaption(caption)
                });
            } catch (e) {
                stable = false;
                break;
            } finally {
                panel = null;
            }
        }

        if (!stable || safeGetPanelCount() !== count || found.length !== count) return false;

        tabs = found;
        detectedPanelCount = count;
        detectedPanelFingerprint = makePanelFingerprint(captions, count);

        var restored = findIndexByKey(previousKey);
        if (restored < 0) restored = findIndexByKey(savedActiveKey);
        if (restored < 0) restored = clamp(activeIndex, 0, Math.max(0, tabs.length - 1));
        activeIndex = restored;

        if (!tabs.length) {
            activeIndex = 0;
            savedActiveKey = '';
            pendingActiveKey = '';
        }

        initialized = true;
        return true;
    } finally {
        scanBusy = false;
    }
}

function persistActiveTab() {
    if (!tabs.length || !tabs[activeIndex]) {
        window.SetProperty(PROPERTY_ACTIVE_KEY, '');
        window.SetProperty(PROPERTY_ACTIVE_INDEX, 0);
        return;
    }

    savedActiveKey = tabs[activeIndex].key;
    window.SetProperty(PROPERTY_ACTIVE_KEY, savedActiveKey);
    window.SetProperty(PROPERTY_ACTIVE_INDEX, activeIndex);
}

// ----- Geometry --------------------------------------------------------------
function tabBarHeight() {
    if (panelHeight <= 0) return 0;
    return Math.min(panelHeight, scale(TabBarStyle.settings.tabBarHeight));
}

function contentY() {
    return tabBarHeight();
}

function contentHeight() {
    return Math.max(0, panelHeight - tabBarHeight());
}

function tabListButtonWidth() {
    return scale(TAB_LIST_BUTTON_WIDTH);
}

// Show the browser-style all-tabs button only when the normal tab strip would
// overflow at MIN_TAB_WIDTH. Test against the full panel width before reserving
// the button so the button itself cannot create an overflow state.
function tabStripNeedsOverflowMenu() {
    if (tabs.length < 2 || panelWidth <= 0) return false;
    return Math.floor(panelWidth / tabs.length) < scale(MIN_TAB_WIDTH);
}

function tabViewportWidth() {
    return Math.max(0, panelWidth - (tabStripNeedsOverflowMenu() ? tabListButtonWidth() : 0));
}

function getTabListButtonRect() {
    var width = tabStripNeedsOverflowMenu() ? tabListButtonWidth() : 0;
    return {
        x: panelWidth - width,
        y: 0,
        w: width,
        h: tabBarHeight()
    };
}

function tabWidth() {
    var availableWidth = tabViewportWidth();
    if (!tabs.length || availableWidth <= 0) return 0;

    var equal = Math.floor(availableWidth / tabs.length);
    if (tabStripNeedsOverflowMenu()) return scale(MIN_TAB_WIDTH);
    if (equal >= scale(MIN_TAB_WIDTH)) return Math.min(equal, scale(MAX_TAB_WIDTH));
    return scale(MIN_TAB_WIDTH);
}

function stripWidth() {
    return tabWidth() * tabs.length;
}

function maximumScrollX() {
    return Math.max(0, stripWidth() - tabViewportWidth());
}

function clampScroll() {
    scrollX = clamp(Math.round(scrollX), 0, maximumScrollX());
}

function ensureTabVisible(index) {
    var width = tabWidth();
    if (width <= 0 || index < 0 || index >= tabs.length) {
        scrollX = 0;
        return;
    }

    var left = index * width;
    var right = left + width;

    if (left < scrollX) scrollX = left;
    else if (right > scrollX + tabViewportWidth()) scrollX = right - tabViewportWidth();

    clampScroll();
}

function getTabRect(index) {
    var width = tabWidth();
    return {
        x: index * width - scrollX,
        y: 0,
        w: width,
        h: tabBarHeight()
    };
}

function hitTestTab(x, y) {
    var width = tabWidth();
    var viewportWidth = tabViewportWidth();
    if (
        width <= 0 ||
        !tabs.length ||
        viewportWidth <= 0 ||
        x < 0 || x >= viewportWidth ||
        y < 0 || y >= tabBarHeight()
    ) {
        return -1;
    }

    var index = Math.floor((x + scrollX) / width);
    return index >= 0 && index < tabs.length ? index : -1;
}

function hitTestTabListButton(x, y) {
    if (!tabStripNeedsOverflowMenu()) return false;
    var rect = getTabListButtonRect();
    return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function repaintTabBar(force) {
    var height = tabBarHeight();
    if (panelWidth > 0 && height > 0) {
        window.RepaintRect(0, 0, panelWidth, height, !!force);
    }
}

function acquirePanelSnapshot() {
    var count = safeGetPanelCount();
    if (count < 0 || count !== detectedPanelCount || count !== tabs.length) return null;

    var captions = [];
    for (var i = 0; i < tabs.length; i++) captions.push(tabs[i].caption);
    return PanelHostKit.acquireSnapshot(count, captions);
}

function safeConfigurePanel(panel) {
    if (!panel) return false;
    try {
        if (panel.ShowCaption !== false) panel.ShowCaption = false;
        // Locked prevents layout-editor drag/resize; runtime placement stays script-owned.
        if (panel.Locked !== true) panel.Locked = true;
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

function layoutResult(activated, complete) {
    return { activated: !!activated, complete: !!complete };
}

function layoutChildren(width, height, targetIndex, configureAll, hideOthers) {
    if (layoutBusy) return layoutResult(false, false);
    layoutBusy = true;

    var panels = null;
    try {
        panelWidth = Math.max(0, Math.floor(Number(width)) || 0);
        panelHeight = Math.max(0, Math.floor(Number(height)) || 0);

        if (!initialized || safeGetPanelCount() !== detectedPanelCount) {
            return layoutResult(false, false);
        }
        if (!tabs.length) return layoutResult(true, true);
        if (targetIndex < 0 || targetIndex >= tabs.length) return layoutResult(false, false);

        var childY = contentY();
        var childW = panelWidth;
        var childH = contentHeight();
        if (childW <= 0 || childH <= 0) return layoutResult(true, true);

        panels = acquirePanelSnapshot();
        if (!panels || !panels[targetIndex]) return layoutResult(false, false);

        var complete = true;
        var i;
        if (configureAll) {
            for (i = 0; i < panels.length; i++) {
                if (!safeConfigurePanel(panels[i])) complete = false;
            }
        } else if (!safeConfigurePanel(panels[targetIndex])) {
            complete = false;
        }

        // Never hide the committed page until the requested page is at current geometry
        // and visible; a failed activation therefore cannot blank the whole host.
        if (!safeMovePanel(panels[targetIndex], 0, childY, childW, childH)) {
            if (targetIndex !== activeIndex) safeShowPanel(panels[targetIndex], false);
            return layoutResult(false, false);
        }
        if (!safeShowPanel(panels[targetIndex], true)) return layoutResult(false, false);

        if (hideOthers) {
            for (i = 0; i < panels.length; i++) {
                if (i !== targetIndex && !safeShowPanel(panels[i], false)) complete = false;
            }
        }

        return layoutResult(true, complete);
    } finally {
        panels = null;
        layoutBusy = false;
    }
}

function broadcastActiveTab() {
    if (!tabs[activeIndex]) return;
    try {
        window.NotifyOthers(UWP_TOP_TABS_ACTIVE_UPDATE, String(tabs[activeIndex].caption));
    } catch (e) { reportFailure('the active tab could not be broadcast', e); }
}

function commitActiveTab(index) {
    if (!tabs.length) {
        activeIndex = 0;
        pendingActiveKey = '';
        persistActiveTab();
        updateHoverFromPointer(false);
        return true;
    }
    if (index < 0 || index >= tabs.length) return false;
    activeIndex = index;
    pendingActiveKey = '';
    persistActiveTab();
    ensureTabVisible(activeIndex);
    updateHoverFromPointer(false);
    broadcastActiveTab();
    return true;
}

function refreshChildPanels() {
    if (!scanChildPanels(true)) {
        requestChildRefresh(true);
        return;
    }

    var targetIndex = activeIndex;
    if (pendingActiveKey) {
        var pendingIndex = findIndexByKey(pendingActiveKey);
        if (pendingIndex >= 0) targetIndex = pendingIndex;
        else pendingActiveKey = '';
    }

    var result = layoutChildren(panelWidth, panelHeight, targetIndex, true, true);
    if (result.activated) commitActiveTab(targetIndex);
    if (result.complete) {
        childRefreshNeeded = false;
        layoutNeeded = false;
        resetRetryLane();
    } else {
        requestChildRefresh(false);
    }
    window.Repaint();
}

function selectTab(index) {
    if (typeof index !== 'number' || !isFinite(index)) return;
    index = Math.floor(index);
    if (index < 0 || index >= tabs.length) return;
    if (index === activeIndex) {
        pendingActiveKey = '';
        return;
    }

    pendingActiveKey = tabs[index].key;
    var result = layoutChildren(panelWidth, panelHeight, index, false, true);
    if (!result.activated) {
        requestChildRefresh(true);
        window.Repaint();
        return;
    }

    commitActiveTab(index);
    if (!result.complete) requestChildRefresh(false);
    window.Repaint();
}

function findTabIndex(value) {
    if (typeof value === 'number' && isFinite(value)) {
        var numeric = Math.floor(value);
        return numeric >= 0 && numeric < tabs.length ? numeric : -1;
    }
    if (typeof value !== 'string') return -1;

    var text = value.toLowerCase();
    for (var i = 0; i < tabs.length; i++) {
        if (
            String(tabs[i].caption).toLowerCase() === text ||
            String(tabs[i].label).toLowerCase() === text ||
            String(tabs[i].key).toLowerCase() === text
        ) {
            return i;
        }
    }
    return -1;
}

// ----- Accent ---------------------------------------------------------------
function currentAccent() {
    return TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_SHARED ? sharedAlbumAccent : DEFAULT_UWP_ACCENT;
}

function setAccentMode(mode) {
    TabBarStyle.setAndSync('accentMode', mode === TabBarStyle.ACCENT_FIXED ? TabBarStyle.ACCENT_FIXED : TabBarStyle.ACCENT_SHARED);

    if (TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_SHARED) {
        SharedAccentProtocol.requestAccent();
    }

    repaintTabBar(true);
}

// ----- Painting -------------------------------------------------------------
function drawNoPanelsMessage(gr) {
    if (!messageFont || tabs.length || contentHeight() <= scale(20)) return;

    var padding = scale(24);
    gr.GdiDrawText(
        'No panels found. Right-click the tab bar and choose Refresh panel list.',
        messageFont,
        COLOUR_MESSAGE,
        padding,
        contentY(),
        Math.max(1, panelWidth - padding * 2),
        contentHeight(),
        DT_CENTER | DT_VCENTER | DT_WORDBREAK | DT_NOPREFIX
    );
}

function drawTabBar(gr) {
    var barH = tabBarHeight();
    if (barH <= 0 || panelWidth <= 0) return;

    var accent = currentAccent();
    var selectedBackground = blendColours(accent, COLOUR_TAB_BAR, 0.12);
    var hoverBackground = blendColours(COLOUR_TEXT_PRIMARY, COLOUR_TAB_BAR, 0.07);
    var selectedHover = blendColours(accent, COLOUR_TAB_BAR, 0.19);
    var pressedBackground = blendColours(accent, COLOUR_TAB_BAR, 0.25);

    gr.FillSolidRect(0, 0, panelWidth, barH, COLOUR_TAB_BAR);
    gr.FillSolidRect(0, Math.max(0, barH - scale(1)), panelWidth, scale(1), COLOUR_SEPARATOR);

    var viewportWidth = tabViewportWidth();
    for (var i = 0; i < tabs.length; i++) {
        var rect = getTabRect(i);
        if (rect.x + rect.w <= 0 || rect.x >= viewportWidth) continue;

        var selected = i === activeIndex;
        var hovered = i === hoveredIndex;
        var pressed = i === pressedIndex;
        var background = COLOUR_TAB_BAR;

        if (selected) background = selectedBackground;
        if (hovered) background = selected ? selectedHover : hoverBackground;
        if (pressed) background = pressedBackground;

        if (background !== COLOUR_TAB_BAR) {
            gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, background);
        }

        // Active line at the bottom of the TOP button.
        if (selected) {
            var indicatorH = scale(3);
            var indicatorW = Math.min(scale(30), Math.max(scale(12), rect.w - scale(16)));
            var indicatorX = rect.x + Math.floor((rect.w - indicatorW) / 2);
            var indicatorY = rect.y + rect.h - indicatorH;
            gr.FillSolidRect(indicatorX, indicatorY, indicatorW, indicatorH, accent);
        }

        var text = tabs[i].label;
        var textColour = selected
            ? COLOUR_TEXT_PRIMARY
            : (hovered ? COLOUR_TEXT_SECONDARY : COLOUR_TEXT_MUTED);

        if (tabFont) {
            gr.GdiDrawText(
                text,
                tabFont,
                textColour,
                rect.x + scale(5),
                rect.y,
                Math.max(1, rect.w - scale(10)),
                Math.max(1, rect.h - scale(3)),
                DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX
            );
        }
    }

    if (tabStripNeedsOverflowMenu()) {
        var buttonRect = getTabListButtonRect();
        var buttonBackground = COLOUR_TAB_BAR;
        if (hoveredTabListButton) buttonBackground = hoverBackground;
        if (pressedTabListButton) buttonBackground = pressedBackground;

        // This button is the final opaque overlay in the tab bar. Always repaint
        // its full rectangle, even in the normal state, so a partially visible
        // tab can never bleed underneath and cover the chevron. For GDI-drawn
        // controls there is no separate z-index; paint order + an opaque final
        // pass is the top-most equivalent.
        gr.FillSolidRect(buttonRect.x, buttonRect.y, buttonRect.w, buttonRect.h, buttonBackground);

        gr.FillSolidRect(buttonRect.x, buttonRect.y, scale(1), Math.max(1, buttonRect.h - scale(1)), COLOUR_SEPARATOR);

        var chevronColour = hoveredTabListButton ? COLOUR_TEXT_SECONDARY : COLOUR_TEXT_MUTED;
        var chevronHalf = scale(4);
        var chevronRise = scale(2);
        var chevronX = buttonRect.x + Math.floor(buttonRect.w / 2);
        var chevronY = buttonRect.y + Math.floor(buttonRect.h / 2);
        var chevronStroke = scale(1);
        gr.DrawLine(chevronX - chevronHalf, chevronY - chevronRise, chevronX, chevronY + chevronRise, chevronStroke, chevronColour);
        gr.DrawLine(chevronX, chevronY + chevronRise, chevronX + chevronHalf, chevronY - chevronRise, chevronStroke, chevronColour);
    }
}

function updateHoverFromPointer(repaint) {
    if (lastMouseX < 0) return false;
    var index = hitTestTab(lastMouseX, lastMouseY);
    var overTabListButton = hitTestTabListButton(lastMouseX, lastMouseY);
    if (index === hoveredIndex && overTabListButton === hoveredTabListButton) return false;
    hoveredIndex = index;
    hoveredTabListButton = overTabListButton;
    if (repaint) repaintTabBar();
    return true;
}

// Reassert after non-mouse repaints because the host may restore its default cursor.
function reassertCursor() {
    if (lastMouseX < 0) return;
    window.SetCursor(
        hitTestTab(lastMouseX, lastMouseY) >= 0 || hitTestTabListButton(lastMouseX, lastMouseY)
            ? IDC_HAND
            : IDC_ARROW
    );
}

function on_paint(gr) {
    updateHoverFromPointer(false);
    gr.FillSolidRect(0, 0, panelWidth, panelHeight, COLOUR_CONTENT);
    drawNoPanelsMessage(gr);
    drawTabBar(gr);
    reassertCursor();
}

// ----- Mouse ----------------------------------------------------------------
function on_mouse_move(x, y, mask) {
    var index = hitTestTab(x, y);
    var overTabListButton = hitTestTabListButton(x, y);
    lastMouseX = x;
    lastMouseY = y;
    if (index !== hoveredIndex || overTabListButton !== hoveredTabListButton) {
        hoveredIndex = index;
        hoveredTabListButton = overTabListButton;
        repaintTabBar();
    }
    window.SetCursor(index >= 0 || overTabListButton ? IDC_HAND : IDC_ARROW);
}

function on_mouse_leave() {
    lastMouseX = -1;
    lastMouseY = -1;
    if (hoveredIndex !== -1 || pressedIndex !== -1 || hoveredTabListButton || pressedTabListButton) {
        hoveredIndex = -1;
        pressedIndex = -1;
        hoveredTabListButton = false;
        pressedTabListButton = false;
        repaintTabBar();
    }
    window.SetCursor(IDC_ARROW);
}

function on_mouse_lbtn_down(x, y, mask) {
    pressedTabListButton = hitTestTabListButton(x, y);
    pressedIndex = pressedTabListButton ? -1 : hitTestTab(x, y);
    repaintTabBar();
}

function on_mouse_lbtn_up(x, y, mask) {
    var releasedIndex = hitTestTab(x, y);
    var activate = pressedIndex >= 0 && releasedIndex === pressedIndex;
    var activateTabList = pressedTabListButton && hitTestTabListButton(x, y);
    pressedIndex = -1;
    pressedTabListButton = false;

    if (activateTabList) {
        repaintTabBar();
        showTabListMenu();
    } else if (activate) selectTab(releasedIndex);
    else repaintTabBar();
}

function on_mouse_wheel(step) {
    updateHoverFromPointer(false);
    if (hoveredIndex < 0 || tabs.length < 2) return;

    var direction = step > 0 ? -1 : 1;
    var next = (activeIndex + direction + tabs.length) % tabs.length;
    selectTab(next);
}

// ----- Context menu ----------------------------------------------------------
function menuSafeLabel(text) {
    return String(text || '').replace(/&/g, '&&');
}

function showTabListMenu() {
    if (!tabStripNeedsOverflowMenu() || !tabs.length) return;

    var menu = window.CreatePopupMenu();
    var firstCommand = 1000;
    var lastCommand = firstCommand + tabs.length - 1;

    for (var i = 0; i < tabs.length; i++) {
        menu.AppendMenuItem(MF_STRING, firstCommand + i, menuSafeLabel(tabs[i].label));
    }
    menu.CheckMenuRadioItem(firstCommand, lastCommand, firstCommand + activeIndex);

    var rect = getTabListButtonRect();
    var command = menu.TrackPopupMenu(rect.x, rect.y + rect.h);
    if (command >= firstCommand && command <= lastCommand) {
        selectTab(command - firstCommand);
    }
}

function promptTabBarHeight() {
    var input;
    try {
        input = utils.InputBox(
            window.ID,
            'Tab bar height in pixels at 96 DPI:',
            RivageUI.copy.popupTitle('Tabs'),
            String(TabBarStyle.settings.tabBarHeight),
            true
        );
    } catch (e) {
        return;
    }

    var value = parseInt(input, 10);
    if (!isFinite(value)) return;

    TabBarStyle.setAndSync('tabBarHeight', clamp(value, TabBarStyle.MIN_HEIGHT, TabBarStyle.MAX_HEIGHT));
}

// Settings actions that open a modal remain owned by tab-switcher-right.js;
// both hosts still consume the resulting TabBarStyle update.

function showTabBarMenu(x, y) {
    var menu = window.CreatePopupMenu();
    var tabAccentMenu = window.CreatePopupMenu();

    tabAccentMenu.AppendMenuItem(MF_STRING, 1, RivageUI.copy.labels.rvgBlue);
    tabAccentMenu.AppendMenuItem(MF_STRING, 2, RivageUI.copy.labels.sharedAccent);
    tabAccentMenu.CheckMenuRadioItem(1, 2, TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_FIXED ? 1 : 2);
    tabAccentMenu.AppendTo(menu, MF_STRING, 'Tab bar accent');

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 5, 'Tab bar height... (' + TabBarStyle.settings.tabBarHeight + ' px)');
    menu.AppendMenuItem(MF_STRING, 6, 'Choose tab bar font… (' + TabBarStyle.describeFont() + ')');
    if (TabBarStyle.settings.fontFamily) {
        menu.AppendMenuItem(MF_STRING, 8, 'Use Columns UI "Common (labels)" font');
    }

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 7, 'Refresh panel list');

    var command = menu.TrackPopupMenu(x, y);

    switch (command) {
    case 1:
        setAccentMode(TabBarStyle.ACCENT_FIXED);
        break;
    case 2:
        setAccentMode(TabBarStyle.ACCENT_SHARED);
        break;
    case 5:
        promptTabBarHeight();
        break;
    case 6:
        TabBarStyle.promptFont();
        break;
    case 7:
        refreshChildPanels();
        break;
    case 8:
        TabBarStyle.useCommonLabelsAndSync();
        break;
    }
}

function on_mouse_rbtn_up(x, y, mask) {
    if (y >= 0 && y < tabBarHeight()) {
        showTabBarMenu(x, y);
        return true;
    }
    return false;
}

// ----- Callbacks -------------------------------------------------------------
function on_colours_changed() {
    refreshTheme();
    window.Repaint(true);
}

function on_font_changed() {
    rebuildTabFont();
    window.Repaint(true);
}

function on_size(width, height) {
    scheduleLayout(width, height);
}

function applySharedTabSetting(settingId, value) {
    // Both tab hosts receive the shared "Tabs" settings broadcast. The font
    // picker is modal, so only the right-side tab controller should launch it;
    // this sibling still receives the chosen font through TabBarStyle sync.
    if (settingId === 'changeTabBarFont' || settingId === 'useCommonLabelsFont') return;
    TabBarStyle.applySetting(settingId, value);
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    SettingsRegistry.provide(name, info, TabBarStyle.PANEL_ID, TabBarStyle.PANEL_LABEL, TabBarStyle.getSchema);
    if (SettingsRegistry.consume(name, info, TabBarStyle.PANEL_ID, applySharedTabSetting)) return;
    if (TabBarStyle.onNotifyData(name, info)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = opaqueColour(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_SHARED) repaintTabBar(true);
        return;
    }

    if (name === UWP_TOP_TABS_SELECT) {
        if (typeof info !== 'string' && (typeof info !== 'number' || !isFinite(info))) return;
        var index = findTabIndex(info);
        if (index >= 0) selectTab(index);
        return;
    }

    if (name === UWP_TOP_TABS_QUERY) {
        broadcastActiveTab();
    }
}

function initialiseTopTabs() {
    if (!scriptActive) return;
    panelWidth = Math.max(0, Math.floor(Number(window.Width)) || 0);
    panelHeight = Math.max(0, Math.floor(Number(window.Height)) || 0);

    if (!scanChildPanels(true)) {
        requestChildRefresh(true);
        window.Repaint();
        return;
    }

    var result = layoutChildren(panelWidth, panelHeight, activeIndex, true, true);
    if (result.activated) commitActiveTab(activeIndex);
    if (result.complete) {
        childRefreshNeeded = false;
        layoutNeeded = false;
        resetRetryLane();
    } else {
        requestChildRefresh(true);
    }
    window.Repaint();
}

TabBarStyle.onChange(function () {
    rebuildTabFont();
    var result = layoutChildren(panelWidth, panelHeight, activeIndex, false, false);
    if (!result.complete) requestChildRefresh(false);
    ensureTabVisible(activeIndex);
    updateHoverFromPointer(false);
    window.Repaint();
});
TabBarStyle.requestSync();

function on_script_unload() {
    scriptActive = false;
    var timers = [childRefreshTimer, layoutTimer, startupTimer];
    for (var i = 0; i < timers.length; i++) {
        if (timers[i] !== null) {
            try { window.ClearTimeout(timers[i]); } catch (e) { }
        }
    }
    if (childWatchTimer !== null) {
        try { window.ClearInterval(childWatchTimer); } catch (e2) { }
    }
    childRefreshTimer = null;
    layoutTimer = null;
    startupTimer = null;
    childWatchTimer = null;
    childRefreshPending = false;
    layoutRequestPending = false;
}

refreshTheme();
try { SharedAccentProtocol.request(); } catch (e) { reportFailure('the Shared accent could not be requested', e); }

try {
    startupTimer = window.SetTimeout(function () {
        startupTimer = null;
        initialiseTopTabs();
    }, 0);
} catch (e) {
    startupTimer = null;
    requestChildRefresh(true);
}

// Metadata-only watcher detects same-count child changes and re-arms failed timers.
try {
    childWatchTimer = window.SetInterval(function () {
        if (!scriptActive || !hostIsVisible() || scanBusy || layoutBusy) return;

        var fingerprint = readCurrentPanelFingerprint();
        if (!initialized) {
            requestChildRefresh(!childRefreshNeeded);
            return;
        }
        if (!fingerprint) {
            requestChildRefresh(false);
            return;
        }
        if (fingerprint !== detectedPanelFingerprint) {
            requestChildRefresh(true);
            return;
        }
        if (childRefreshNeeded) {
            scheduleChildRefresh();
            return;
        }
        if (layoutNeeded && !layoutRequestPending) scheduleLayout(panelWidth, panelHeight);
    }, CHILD_WATCH_INTERVAL);
} catch (e) {
    childWatchTimer = null;
}
