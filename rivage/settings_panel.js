window.DrawMode = 0;

include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\cache_protocol.js");

window.DefineScript("RVG Settings", {
    author: "RivaGe",
    version: "1.9.0",
    features: { drag_n_drop: false, grab_focus: false }
});

var MF_STRING = 0x00000000;
var MB_YESNO = 0x00000004;
var MB_ICONWARNING = 0x00000030;
var IDYES = 6;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;

var DT_LEFT = 0x00000000;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_WORDBREAK = 0x00000010;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var FontTypeCUI = { items: 0 };
var FontTypeDUI = { defaults: 0 };
var SMOOTHING_MODE_DEFAULT = 0;
var SMOOTHING_MODE_ANTIALIAS = 4;

function RGB(r, g, b) {
    return RivageUI.rgb(r, g, b);
}

function blendColours(first, second, amount) {
    return RivageUI.mix(first, second, amount);
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
}

var SKIP_WORK_WHEN_HIDDEN = true;

var g_dpi = 100;
var WRAP_MEASURE_GUARD_PT = 8;
function _scale(value) {
    return Math.round(value * g_dpi / 100);
}

function text_w(text, font) {
    return RivageUI.measureText(text, font);
}

function wrappedLineCount(text, font, maxWidth) {
    var paragraphs, p, words, i, candidate, line, count, wordWidth;
    text = String(text == null ? "" : text);
    if (!text) return 1;
    if (!font || maxWidth <= 0) return 1;

    // GdiDrawText's word-break layout can wrap a few pixels earlier than
    // CalcTextWidth predicts. Reserve a small guard band so calculated row
    // heights never lose the final wrapped line on narrow Settings panels.
    maxWidth = Math.max(_scale(24), maxWidth - _scale(WRAP_MEASURE_GUARD_PT));

    paragraphs = text.replace(/\r/g, "").split("\n");
    count = 0;
    for (p = 0; p < paragraphs.length; p++) {
        words = paragraphs[p].split(/\s+/);
        line = "";
        if (!paragraphs[p]) {
            count++;
            continue;
        }
        for (i = 0; i < words.length; i++) {
            if (!words[i]) continue;
            candidate = line ? line + " " + words[i] : words[i];
            if (line && text_w(candidate, font) > maxWidth) {
                count++;
                line = words[i];
            } else {
                line = candidate;
            }
            wordWidth = text_w(words[i], font);
            if (!line || wordWidth <= maxWidth) continue;
            // GDI can break an overlong token; approximate those extra lines.
            count += Math.max(0, Math.ceil(wordWidth / maxWidth) - 1);
        }
        if (line) count++;
    }
    return Math.max(1, count);
}

function make_font(name, size, style) {
    return RivageUI.font(name || "Segoe UI", _scale(size), style);
}

function choose_font(candidates, fallback) {
    var i;
    for (i = 0; i < candidates.length; i++) {
        try {
            if (utils.CheckFont(candidates[i])) return candidates[i];
        } catch (e) { }
    }
    return fallback;
}

// Segoe Fluent Icons / Segoe MDL2 Assets code points.
var GLYPHS = {
    close: "\uE8BB",       // ChromeClose
    refresh: "\uE72C",     // Refresh
    chevronLeft: "\uE76B", // ChevronLeft
    chevronRight: "\uE76C" // ChevronRight
};

var iconFontName = choose_font(["Segoe Fluent Icons", "Segoe MDL2 Assets"], "Segoe MDL2 Assets");

var theme = {
    background: RGB(24, 24, 26),
    sidebar: RGB(30, 30, 32),
    sidebarHover: RGB(38, 38, 41),
    row: RGB(38, 38, 40),
    rowHover: RGB(46, 46, 49),
    stroke: RGB(58, 58, 62),
    text: RGB(246, 246, 246),
    textMuted: RGB(154, 154, 160),
    textDisabled: RGB(108, 108, 112),
    control: RGB(74, 74, 78)
};

var DEFAULT_UWP_ACCENT = 0xff0078d4;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

function refreshTheme() {
    var resolved = RivageUI.createTheme({ mode: 'dark', accent: sharedAccentOrDefault() });
    theme.background = resolved.background;
    theme.sidebar = resolved.navigationSurface;
    theme.sidebarHover = resolved.cardHover;
    theme.row = resolved.card;
    theme.rowHover = resolved.rowHover;
    theme.stroke = resolved.stroke;
    theme.text = resolved.textPrimary;
    theme.textMuted = resolved.textMuted;
    theme.textDisabled = resolved.textDisabled !== undefined ? resolved.textDisabled : resolved.textMuted;
    theme.control = resolved.surface;
}

var ww = 0;
var wh = 0;
var fonts = {};
var mouse = { x: -1, y: -1 };

var panels = [];
var lastPanelsJson = "";
var activePanelId = null;
var schemaRequestGeneration = 0;
var editGeneration = 0;
var scriptActive = true;
var refreshAfterHidden = false;

var sidebarRows = [];
var contentRows = [];
var scrollOffset = 0;
var maxScroll = 0;

var sidebarScrollOffset = 0;
var sidebarMaxScroll = 0;
var sidebarViewportBottom = 0;

var subTabs = [];
var activeSubTabByPanel = Object.create(null);
var subTabHover = -1;
var subTabScrollOffset = 0;
var subTabMaxScroll = 0;
var subTabViewport = { x: 0, y: 0, w: 0, h: 0 };
var subTabScrollLeftHitbox = { x: 0, y: 0, w: 0, h: 0 };
var subTabScrollRightHitbox = { x: 0, y: 0, w: 0, h: 0 };
var subTabScrollLeftHover = false;
var subTabScrollRightHover = false;

var refreshHitbox = { x: 0, y: 0, w: 0, h: 0 };
var closeHitbox = { x: 0, y: 0, w: 0, h: 0 };
var sidebarHover = -1;
var rowHover = -1;
var refreshHover = false;
var closeHover = false;

var SIDEBAR_W_PT = 140;
var HEADER_H_PT = 44;
var SUBTAB_BAR_H_PT = 38;
var SUBTAB_PAD_X_PT = 16;
var SUBTAB_GAP_PT = 4;
var SUBTAB_SCROLL_BUTTON_W_PT = 28;
var SUBTAB_SCROLL_STEP_PT = 86;
var INFO_LABEL_H_PT = 22;
var INFO_LINE_H_PT = 18;
var INFO_PAD_Y_PT = 7;
var SETTING_LABEL_LINE_H_PT = 18;
var SETTING_HINT_LINE_H_PT = 16;
var SETTING_TEXT_PAD_Y_PT = 6;
var SETTING_HINT_GAP_PT = 2;
var ROW_H_PT = 46;
var CONTROL_W_PT = 150;
var ROW_RIGHT_PAD_PT = 18;
var ROW_LABEL_GAP_PT = 10;
var ICON_BUTTON_SIZE_PT = 30;
var ICON_BUTTON_MARGIN_PT = 9;

var SETTINGS_PANEL_CAPTION = "SETTINGS";

// Another panel can ask for a panel's section to be shown (Health on first run).
// Kept until the schemas that contain it arrive, since this script only starts
// when the Settings panel is first shown.
var OPEN_SECTION = "RIVAGE.SETTINGS.OPEN_SECTION.V1";
var OPEN_SECTION_ACK = "RIVAGE.SETTINGS.OPEN_SECTION_ACK.V1";
var pendingOpenSection = null;

function applyPendingOpenSection() {
    if (!pendingOpenSection || !findPanel(pendingOpenSection.panelId)) return false;
    activePanelId = pendingOpenSection.panelId;
    if (pendingOpenSection.section) activeSubTabByPanel[activePanelId] = pendingOpenSection.section;
    pendingOpenSection = null;
    scrollOffset = 0;
    return true;
}

// Local-only Backup & Restore rows: not sourced from SettingsRegistry. They
// are always merged into whichever panel identifies as Global settings, as
// its own sub-tab, so Export/Import are available even before any provider
// has answered. If no panel currently identifies as Global settings, a
// minimal fallback shell panel is injected so Backup & Restore stays reachable.
var GLOBAL_SETTINGS_FALLBACK_PANEL_ID = "global";
var GLOBAL_SETTINGS_FALLBACK_PANEL_LABEL = "Global settings";
var BACKUP_PANEL_LABEL = "Backup & Restore";
var BACKUP_EXPORT_SETTING_ID = "rvgBackupExport";
var BACKUP_IMPORT_SETTING_ID = "rvgBackupImport";

// Local-only Storage rows, merged next to Backup & Restore. Sizes come from
// utils.GetFolderSizeAsync (JSplitter 4.2+) and are re-measured at most every
// STORAGE_MEASURE_MS while the screen is refreshing; clears go through CacheProtocol.
var STORAGE_PANEL_LABEL = "Storage";
var STORAGE_CLEAR_PREFIX = "rvgCacheClear.";
var STORAGE_MEASURE_MS = 15000;
var STORAGE_OWNER_WAIT_MS = 1500;
var cacheSizes = {};
var cacheSizeTasks = {};
var cacheSizeTasksPending = 0;
var cacheMeasuredAt = 0;
var cacheClearPending = {};
var cacheClearToken = 0;

function rowGeometry() {
    var controlW = _scale(CONTROL_W_PT);
    var controlX = ww - _scale(ROW_RIGHT_PAD_PT) - controlW;
    var padX = _scale(SIDEBAR_W_PT) + _scale(18);
    return {
        padX: padX,
        controlW: controlW,
        controlX: controlX,
        labelW: Math.max(_scale(40), controlX - padX - _scale(ROW_LABEL_GAP_PT))
    };
}

function settingTextWidth(setting, geom) {
    if (setting && setting.type === "bool") {
        // Boolean controls only occupy the 44px switch at the far right. Let
        // their labels and hints use the otherwise-empty part of the standard
        // 150px control column, which avoids excessive wrapping at narrow widths.
        return Math.max(
            _scale(40),
            geom.controlX + geom.controlW - _scale(44) - geom.padX - _scale(ROW_LABEL_GAP_PT)
        );
    }
    return geom.labelW;
}

function sectionNamesOf(panel) {
    var names = [], seen = Object.create(null), i, s, name;
    if (!panel || !panel.settings) return names;
    for (i = 0; i < panel.settings.length; i++) {
        s = panel.settings[i];
        if (s.hidden) continue;
        name = s.section;
        if (!name) continue;
        if (seen[name]) continue;
        seen[name] = true;
        names.push(name);
    }
    return names;
}

function subTabBarH() {
    return subTabs.length > 1 ? _scale(SUBTAB_BAR_H_PT) : 0;
}

function contentTop() {
    return _scale(HEADER_H_PT) + subTabBarH();
}

function findPanel(panelId) {
    var i;
    for (i = 0; i < panels.length; i++) {
        if (panels[i].panelId === panelId) return panels[i];
    }
    return null;
}

function normalizedPanelId(panel) {
    return String(panel && panel.panelId || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function isGlobalSettingsPanel(panel) {
    var id = normalizedPanelId(panel);
    return id === "global" || id === "globalsettings";
}

function isBottomBarLayoutPanel(panel) {
    return normalizedPanelId(panel) === "bottombarlayout";
}

function isLeftBarLayoutPanel(panel) {
    var id = normalizedPanelId(panel);
    return id === "leftside" || id === "leftbarlayout" || id === "leftpanellayout";
}

function comparePanels(a, b) {
    var la = String(a && a.panelLabel || "").toLowerCase();
    var lb = String(b && b.panelLabel || "").toLowerCase();
    var ia, ib;
    if (la < lb) return -1;
    if (la > lb) return 1;
    ia = String(a && a.panelId || "").toLowerCase();
    ib = String(b && b.panelId || "").toLowerCase();
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
}

// Provider response order is nondeterministic; canonical order is also the cache key.
function orderPanels(list) {
    var global = [], bottomBar = [], leftBar = [], rest = [], i, p;
    list = list || [];
    for (i = 0; i < list.length; i++) {
        p = list[i];
        if (isGlobalSettingsPanel(p)) global.push(p);
        else if (isBottomBarLayoutPanel(p)) bottomBar.push(p);
        else if (isLeftBarLayoutPanel(p)) leftBar.push(p);
        else rest.push(p);
    }
    global.sort(comparePanels);
    bottomBar.sort(comparePanels);
    leftBar.sort(comparePanels);
    rest.sort(comparePanels);
    return global.concat(bottomBar, leftBar, rest);
}

function indexOfChoice(s) {
    var i;
    for (i = 0; i < s.choices.length; i++) {
        if (s.choices[i].value === s.value) return i;
    }
    return 0;
}

function hostIsVisible() {
    try {
        var visible = window.IsVisible;
        if (typeof visible === "function") visible = visible();
        if (visible === undefined || visible === null) return true;
        return !!visible;
    } catch (e) {
        // Older hosts may not expose IsVisible.
        return true;
    }
}

function pruneSubTabState() {
    var live = Object.create(null), i, key;
    for (i = 0; i < panels.length; i++) live[String(panels[i].panelId)] = true;
    for (key in activeSubTabByPanel) {
        if (Object.prototype.hasOwnProperty.call(activeSubTabByPanel, key) && !live[key]) {
            delete activeSubTabByPanel[key];
        }
    }
}

function installPanels(nextPanels) {
    var previousActive = activePanelId;
    panels = nextPanels;
    pruneSubTabState();
    applyPendingOpenSection();

    if (!activePanelId || !findPanel(activePanelId)) {
        activePanelId = panels.length ? panels[0].panelId : null;
    }
    if (activePanelId !== previousActive) {
        scrollOffset = 0;
        subTabScrollOffset = 0;
        sidebarScrollOffset = 0;
    }

    layout();
    window.Repaint(true);
}

function refreshSchemas(force) {
    var requestGeneration, requestEditGeneration;
    if (!scriptActive) return;
    requestGeneration = ++schemaRequestGeneration;
    requestEditGeneration = editGeneration;
    measureCacheSizes(false);

    SettingsRegistry.requestSchemas(300, function (list) {
        var ordered, json, globalPanel, i;
        // Only the newest request from the current edit generation may install state.
        if (!scriptActive || requestGeneration !== schemaRequestGeneration || requestEditGeneration !== editGeneration) return;

        list = list || [];
        globalPanel = null;
        for (i = 0; i < list.length; i++) {
            if (isGlobalSettingsPanel(list[i])) { globalPanel = list[i]; break; }
        }
        if (globalPanel) {
            globalPanel.settings = (globalPanel.settings || []).concat(backupPanelSettings(), storagePanelSettings());
        } else {
            list = list.concat([{
                panelId: GLOBAL_SETTINGS_FALLBACK_PANEL_ID,
                panelLabel: GLOBAL_SETTINGS_FALLBACK_PANEL_LABEL,
                settings: backupPanelSettings().concat(storagePanelSettings())
            }]);
        }
        ordered = orderPanels(list);
        json = JSON.stringify(ordered);
        if (!force && json === lastPanelsJson) return;

        lastPanelsJson = json;
        installPanels(ordered);
    });
}

function refreshIfVisibleAfterHidden() {
    if (!refreshAfterHidden || !hostIsVisible()) return;
    refreshAfterHidden = false;
    refreshSchemas(true);
}

var refreshTimer = window.SetInterval(function () {
    if (!scriptActive) return;
    if (SKIP_WORK_WHEN_HIDDEN && !hostIsVisible()) {
        refreshAfterHidden = true;
        return;
    }
    refreshSchemas(refreshAfterHidden);
    refreshAfterHidden = false;
}, 2000);

function on_script_unload() {
    scriptActive = false;
    schemaRequestGeneration++;
    if (refreshTimer) { window.ClearInterval(refreshTimer); refreshTimer = null; }
    for (var id in cacheClearPending) {
        if (cacheClearPending[id].timer) window.ClearTimeout(cacheClearPending[id].timer);
    }
    cacheClearPending = {};
}

function layout() {
    var sidebarW, headerH, rowH, iconButtonSize, iconButtonMargin;
    var y, i, panel, contentBottomLimit, contentHeight, geom, s, tall, h;
    var names, activeSection, tx, tabH, tabY, tabW;
    var tabWidths, totalTabsW, gapW, scrollButtonW, stripPad;
    var infoW, infoLines, infoLabelH, infoLineH, infoPadY;
    var hintText, hintLines, labelLines, labelLineH, hintLineH, textPadY, hintGap, textW;

    ww = window.Width;
    wh = window.Height;
    if (ww <= 0 || wh <= 0) return;

    sidebarW = _scale(SIDEBAR_W_PT);
    headerH = _scale(HEADER_H_PT);
    rowH = _scale(ROW_H_PT);
    iconButtonSize = _scale(ICON_BUTTON_SIZE_PT);
    iconButtonMargin = _scale(ICON_BUTTON_MARGIN_PT);
    geom = rowGeometry();

    refreshHitbox = {
        x: sidebarW - iconButtonMargin - iconButtonSize,
        y: wh - iconButtonMargin - iconButtonSize,
        w: iconButtonSize,
        h: iconButtonSize
    };

    closeHitbox = {
        x: ww - iconButtonMargin - iconButtonSize,
        y: Math.round((headerH - iconButtonSize) / 2),
        w: iconButtonSize,
        h: iconButtonSize
    };

    sidebarRows = [];
    y = _scale(8);
    for (i = 0; i < panels.length; i++) {
        sidebarRows.push({ panel: panels[i], y: y, h: _scale(38) });
        y += _scale(38);
    }

    sidebarViewportBottom = Math.max(_scale(8), refreshHitbox.y - _scale(8));
    sidebarMaxScroll = Math.max(0, y - sidebarViewportBottom);
    sidebarScrollOffset = clampNumber(sidebarScrollOffset, 0, sidebarMaxScroll);

    panel = findPanel(activePanelId);

    names = sectionNamesOf(panel);
    subTabs = [];
    subTabMaxScroll = 0;
    subTabViewport = { x: sidebarW, y: headerH, w: Math.max(0, ww - sidebarW), h: 0 };
    subTabScrollLeftHitbox = { x: 0, y: 0, w: 0, h: 0 };
    subTabScrollRightHitbox = { x: 0, y: 0, w: 0, h: 0 };

    if (names.length > 1) {
        activeSection = panel ? activeSubTabByPanel[panel.panelId] : null;
        if (!activeSection || names.indexOf(activeSection) === -1) activeSection = names[0];
        if (panel) activeSubTabByPanel[panel.panelId] = activeSection;

        tabH = _scale(SUBTAB_BAR_H_PT);
        tabY = headerH;
        gapW = _scale(SUBTAB_GAP_PT);
        stripPad = _scale(10);
        tabWidths = [];
        totalTabsW = 0;
        for (i = 0; i < names.length; i++) {
            tabW = text_w(names[i], fonts.sidebar || fonts.label) + _scale(SUBTAB_PAD_X_PT) * 2;
            tabWidths.push(tabW);
            totalTabsW += tabW;
            if (i > 0) totalTabsW += gapW;
        }

        subTabViewport = {
            x: sidebarW + stripPad,
            y: tabY,
            w: Math.max(1, ww - sidebarW - stripPad * 2),
            h: tabH
        };

        if (totalTabsW > subTabViewport.w) {
            scrollButtonW = _scale(SUBTAB_SCROLL_BUTTON_W_PT);
            subTabScrollLeftHitbox = { x: sidebarW, y: tabY, w: scrollButtonW, h: tabH };
            subTabScrollRightHitbox = { x: Math.max(sidebarW, ww - scrollButtonW), y: tabY, w: scrollButtonW, h: tabH };
            subTabViewport.x = sidebarW + scrollButtonW;
            subTabViewport.w = Math.max(1, ww - sidebarW - scrollButtonW * 2);
            subTabMaxScroll = Math.max(0, totalTabsW - subTabViewport.w);
        }

        subTabScrollOffset = clampNumber(subTabScrollOffset, 0, subTabMaxScroll);
        tx = subTabViewport.x - subTabScrollOffset;
        for (i = 0; i < names.length; i++) {
            subTabs.push({
                name: names[i],
                x: tx,
                y: tabY,
                w: tabWidths[i],
                h: tabH,
                active: names[i] === activeSection
            });
            tx += tabWidths[i] + gapW;
        }
    } else {
        subTabScrollOffset = 0;
    }

    contentRows = [];
    y = contentTop();
    if (panel && panel.settings) {
        activeSection = names.length > 1 ? activeSubTabByPanel[panel.panelId] : null;
        for (i = 0; i < panel.settings.length; i++) {
            s = panel.settings[i];
            if (s.hidden) continue;
            if (activeSection && s.section && s.section !== activeSection) continue;

            hintText = s.hint ? String(s.hint) : "";
            if (s.type === "info") {
                infoW = Math.max(_scale(80), ww - geom.padX - _scale(18));
                infoLines = wrappedLineCount(String(s.value), fonts.small || fonts.value, infoW);
                infoLabelH = _scale(INFO_LABEL_H_PT);
                infoLineH = _scale(INFO_LINE_H_PT);
                infoPadY = _scale(INFO_PAD_Y_PT);
                hintLineH = _scale(SETTING_HINT_LINE_H_PT);
                hintGap = _scale(SETTING_HINT_GAP_PT);
                hintLines = hintText ? wrappedLineCount(hintText, fonts.small || fonts.value, infoW) : 0;
                h = infoPadY * 2 + infoLabelH + infoLines * infoLineH;
                if (hintLines) h += hintGap + hintLines * hintLineH;
                h = Math.max(rowH, h);
                contentRows.push({
                    setting: s, panelId: panel.panelId, y: y, h: h, tall: false,
                    infoLines: infoLines, hintLines: hintLines
                });
                y += h;
                continue;
            }

            textW = settingTextWidth(s, geom);
            labelLines = wrappedLineCount(s.label, fonts.label, textW);
            tall = labelLines > 1;
            hintLines = hintText ? wrappedLineCount(hintText, fonts.small || fonts.value, textW) : 0;
            labelLineH = _scale(SETTING_LABEL_LINE_H_PT);
            hintLineH = _scale(SETTING_HINT_LINE_H_PT);
            textPadY = _scale(SETTING_TEXT_PAD_Y_PT);
            hintGap = _scale(SETTING_HINT_GAP_PT);
            h = tall ? rowH * 2 : rowH;
            h = Math.max(
                h,
                textPadY * 2 + labelLines * labelLineH +
                    (hintLines ? hintGap + hintLines * hintLineH : 0)
            );
            contentRows.push({
                setting: s, panelId: panel.panelId, y: y, h: h, tall: tall,
                labelLines: labelLines, hintLines: hintLines, textW: textW
            });
            y += h;
        }
    }
    contentHeight = y;
    contentBottomLimit = wh - _scale(8);
    maxScroll = Math.max(0, contentHeight - contentBottomLimit);
    scrollOffset = clampNumber(scrollOffset, 0, maxScroll);
    updateHoverState(mouse.x, mouse.y, false);
}

function on_font_changed() {
    var host_font = null, next_font_name = "Segoe UI", host_font_size = 12;
    try {
        host_font = window.InstanceType === 1 ? window.GetFontDUI(FontTypeDUI.defaults) : window.GetFontCUI(FontTypeCUI.items);
        if (host_font) {
            if (host_font.Name) next_font_name = host_font.Name;
            if (Number(host_font.Size) > 0) host_font_size = Number(host_font.Size);
        }
    } catch (e) {
        next_font_name = "Segoe UI";
        host_font_size = 12;
    }
    g_dpi = Math.max(50, Math.round(host_font_size / 12 * 100));
    RivageUI.clearFontCache();

    fonts.header = make_font(next_font_name, 15, 1);
    fonts.sidebar = make_font(next_font_name, 12, 0);
    fonts.label = make_font(next_font_name, 12, 0);
    fonts.value = make_font(next_font_name, 12, 0);
    fonts.small = make_font(next_font_name, 11, 0);
    fonts.icon = make_font(iconFontName, 13, 0);

    layout();
    window.Repaint(true);
}

function on_size(width, height) {
    layout();
}

function on_colours_changed() {
    refreshTheme();
    SharedThemeProtocol.requestRepaint();
}

function drawSwitch(gr, x, y, w, h, on) {
    var trackH = Math.max(_scale(16), h * 0.42);
    var trackY = y + (h - trackH) / 2;
    var radius = trackH / 2;
    var knobD = trackH - _scale(4);
    var knobX = on ? x + w - knobD - _scale(2) : x + _scale(2);

    gr.FillRoundRect(x, trackY, w, trackH, radius, radius, on ? sharedAccentOrDefault() : theme.control);
    gr.FillEllipse(knobX, trackY + (trackH - knobD) / 2, knobD, knobD, RGB(255, 255, 255));
}

function sharedAccentOrDefault() {
    return sharedAlbumAccent || DEFAULT_UWP_ACCENT;
}

function drawIconButton(gr, hitbox, glyph, hovered, idleColour) {
    if (hovered) {
        gr.FillRoundRect(hitbox.x, hitbox.y, hitbox.w, hitbox.h,
            _scale(4), _scale(4), blendColours(theme.background, theme.text, 0.10));
    }
    gr.GdiDrawText(glyph, fonts.icon, hovered ? theme.text : idleColour,
        hitbox.x, hitbox.y, hitbox.w, hitbox.h,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function drawSubTab(gr, tab, hovered) {
    var left = Math.max(tab.x, subTabViewport.x);
    var right = Math.min(tab.x + tab.w, subTabViewport.x + subTabViewport.w);
    var visibleW = Math.max(0, right - left);
    var textColour = tab.active ? theme.text : theme.textMuted;

    if (visibleW <= 0) return;
    if (hovered && !tab.active) {
        gr.FillSolidRect(left, tab.y, visibleW, tab.h, theme.rowHover);
    }
    gr.GdiDrawText(tab.name, fonts.sidebar, textColour,
        left, tab.y, visibleW, tab.h,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    if (tab.active) {
        gr.FillSolidRect(left, tab.y + tab.h - _scale(3), visibleW, _scale(3), sharedAccentOrDefault());
    }
}

function drawSubTabScrollButton(gr, hitbox, glyph, hovered, enabled) {
    var colour = enabled ? (hovered ? sharedAccentOrDefault() : theme.textMuted) : theme.stroke;
    // No background fill: the tabs are clipped to subTabViewport, which stops
    // short of these buttons, and an opaque fill would cover the Mica backdrop.
    if (hovered && enabled) {
        gr.FillSolidRect(hitbox.x, hitbox.y, hitbox.w, hitbox.h, theme.rowHover);
    }
    gr.GdiDrawText(glyph, fonts.icon, colour,
        hitbox.x, hitbox.y, hitbox.w, hitbox.h,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function scrollSubTabs(delta) {
    var previous = subTabScrollOffset;
    subTabScrollOffset = clampNumber(subTabScrollOffset + delta, 0, subTabMaxScroll);
    if (subTabScrollOffset === previous) return false;
    layout();
    window.Repaint();
    return true;
}

function closeSettingsPanel() {
    try {
        window.NotifyOthers("RIVAGE.TOGGLE_PANEL_VISIBILITY", { caption: SETTINGS_PANEL_CAPTION });
    } catch (e) {
        // No visibility host is loaded; leave the panel open.
    }
}

function sidebarScrollThumb() {
    var trackH = sidebarViewportBottom;
    var listH = trackH + sidebarMaxScroll;
    var h = Math.max(_scale(24), trackH * trackH / Math.max(1, listH));
    var y = sidebarMaxScroll > 0 ? (sidebarScrollOffset / sidebarMaxScroll) * (trackH - h) : 0;
    return { y: y, h: h };
}

function contentScrollThumb() {
    var trackTop = contentTop();
    var trackH = Math.max(0, (wh - _scale(8)) - trackTop);
    var listH = trackH + maxScroll;
    var h = Math.max(_scale(24), trackH * trackH / Math.max(1, listH));
    var y = trackTop + (maxScroll > 0 ? (scrollOffset / maxScroll) * (trackH - h) : 0);
    return { x: ww - _scale(3), y: y, h: h, trackTop: trackTop, trackH: trackH };
}

function on_paint(gr) {
    var sidebarW, headerH, panel, titleText, titleX, titleW, thumb;
    var i, row, sy, smoothingChanged = false;

    refreshIfVisibleAfterHidden();
    sidebarW = _scale(SIDEBAR_W_PT);
    headerH = _scale(HEADER_H_PT);
    panel = findPanel(activePanelId);

    // Rectangular backdrop before anti-aliasing: GDI+ shape smoothing filters the
    // DrawImage destination edge into a visible seam on the left and top rows.
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);

    // Without this, the toggle-switch knobs (FillEllipse) render visibly
    // jagged under GDI+'s default smoothing mode.
    if (typeof gr.SetSmoothingMode === "function") {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    gr.FillSolidRect(0, 0, sidebarW, wh, theme.sidebar);
    gr.PushClip(0, 0, sidebarW, sidebarViewportBottom);
    try {
        for (i = 0; i < sidebarRows.length; i++) {
            row = sidebarRows[i];
            sy = row.y - sidebarScrollOffset;
            if (sy + row.h <= 0 || sy >= sidebarViewportBottom) continue; // scrolled out of view
            if (i === sidebarHover) {
                gr.FillSolidRect(0, sy, sidebarW, row.h, theme.sidebarHover);
            }
            if (row.panel.panelId === activePanelId) {
                gr.FillSolidRect(0, sy, _scale(3), row.h, sharedAccentOrDefault());
            }
            gr.GdiDrawText(row.panel.panelLabel, fonts.sidebar,
                row.panel.panelId === activePanelId ? theme.text : theme.textMuted,
                _scale(14), sy, sidebarW - _scale(24), row.h,
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
        }
    } finally {
        gr.PopClip();
    }
    if (sidebarMaxScroll > 0) {
        thumb = sidebarScrollThumb();
        gr.FillSolidRect(sidebarW - _scale(3), 0, _scale(3), sidebarViewportBottom,
            blendColours(theme.sidebar, theme.text, 0.06));
        gr.FillSolidRect(sidebarW - _scale(3), thumb.y, _scale(3), thumb.h, sharedAccentOrDefault());
    }
    if (!sidebarRows.length) {
        gr.GdiDrawText(
            "No settings are available. Make sure the other panels are loaded, then choose Refresh.",
            fonts.small, theme.textMuted,
            _scale(14), _scale(14), sidebarW - _scale(24), _scale(220),
            DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
    }

    if (!panel) {
        gr.GdiDrawText("Select a panel on the left.", fonts.label, theme.textMuted,
            sidebarW + _scale(18), headerH + _scale(10), ww - sidebarW - _scale(36), _scale(30),
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    } else {
        if (!contentRows.length) {
            gr.GdiDrawText("No settings are available for this panel.", fonts.small, theme.textMuted,
                sidebarW + _scale(18), contentTop() + _scale(10), ww - sidebarW - _scale(36), _scale(30),
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        }
        // Clipped below the header and sub-tab bar, so a scrolled row cannot reach them.
        gr.PushClip(sidebarW, contentTop(), Math.max(0, ww - sidebarW), Math.max(0, wh - contentTop()));
        try {
            for (i = 0; i < contentRows.length; i++) {
                drawRowInContentArea(gr, contentRows[i], i === rowHover, sidebarW);
            }
        } finally {
            gr.PopClip();
        }
        if (maxScroll > 0) {
            thumb = contentScrollThumb();
            gr.FillSolidRect(thumb.x, thumb.trackTop, _scale(3), thumb.trackH,
                blendColours(theme.background, theme.text, 0.06));
            gr.FillSolidRect(thumb.x, thumb.y, _scale(3), thumb.h, sharedAccentOrDefault());
        }
    }

    gr.DrawLine(sidebarW, headerH - 1, ww, headerH - 1, 1, theme.stroke);

    titleText = panel ? panel.panelLabel : "Settings";
    titleX = sidebarW + _scale(18);
    titleW = Math.max(_scale(20), closeHitbox.x - _scale(10) - titleX);
    gr.GdiDrawText(titleText, fonts.header, theme.text,
        titleX, 0, titleW, headerH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    drawIconButton(gr, closeHitbox, GLYPHS.close, closeHover, theme.textMuted);
    drawIconButton(gr, refreshHitbox, GLYPHS.refresh, refreshHover, sharedAccentOrDefault());

    if (subTabs.length > 1) {
        for (i = 0; i < subTabs.length; i++) {
            drawSubTab(gr, subTabs[i], i === subTabHover);
        }
        if (subTabMaxScroll > 0) {
            drawSubTabScrollButton(gr, subTabScrollLeftHitbox, GLYPHS.chevronLeft,
                subTabScrollLeftHover, subTabScrollOffset > 0);
            drawSubTabScrollButton(gr, subTabScrollRightHitbox, GLYPHS.chevronRight,
                subTabScrollRightHover, subTabScrollOffset < subTabMaxScroll);
        }
        gr.DrawLine(sidebarW, headerH + subTabBarH() - 1, ww, headerH + subTabBarH() - 1, 1, theme.stroke);
    }

    if (smoothingChanged) {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
        } catch (e) { }
    }
}

function actionButtonLabel(setting) {
    var explicit = String(setting && setting.actionLabel || '').replace(/^\s+|\s+$/g, '');
    var label, match, verb;
    if (explicit) return explicit;

    label = String(setting && setting.label || '').replace(/^\s+|\s+$/g, '');
    match = /^([A-Za-z]+)/.exec(label);
    verb = match ? match[1] : '';
    if (/^(Choose|Open|Add|Save|Update|Reset|Rename|Delete|Revert)$/i.test(verb)) {
        return verb.charAt(0).toUpperCase() + verb.substring(1).toLowerCase();
    }
    return 'Open';
}

function drawRowInContentArea(gr, row, hovered, sidebarW) {
    var s = row.setting;
    var drawY = row.y - scrollOffset;
    var geom = rowGeometry();
    var padX = geom.padX;
    var controlW = geom.controlW;
    var controlX = geom.controlX;
    var textW = row.textW || geom.labelW;
    var labelFlags = row.tall
        ? (DT_LEFT | DT_VCENTER | DT_WORDBREAK | DT_NOPREFIX)
        : (DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    var chipH, chipY, choice, valueText, i;
    var infoPadY, infoLabelH, infoHintY, infoValueY, infoValueH, infoW;
    var labelY, labelH, hintY, hintH, hintGap, rowTextColour, rowMutedColour;

    if (drawY + row.h < 0 || drawY > wh) return;

    rowTextColour = s.disabled ? theme.textDisabled : theme.text;
    rowMutedColour = s.disabled ? theme.textDisabled : theme.textMuted;

    if (hovered && !s.disabled) {
        gr.FillSolidRect(sidebarW, drawY, ww - sidebarW, row.h, theme.rowHover);
    }

    if (s.type === "info") {
        infoPadY = _scale(INFO_PAD_Y_PT);
        infoLabelH = _scale(INFO_LABEL_H_PT);
        infoHintY = drawY + infoPadY + infoLabelH;
        hintGap = row.hintLines ? _scale(SETTING_HINT_GAP_PT) : 0;
        infoValueY = infoHintY + (row.hintLines || 0) * _scale(SETTING_HINT_LINE_H_PT) + hintGap;
        infoValueH = Math.max(_scale(INFO_LINE_H_PT), row.h - (infoValueY - drawY) - infoPadY);
        infoW = Math.max(_scale(40), ww - padX - _scale(18));

        gr.GdiDrawText(s.label, fonts.label, rowTextColour,
            padX, drawY + infoPadY, infoW, infoLabelH,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
        if (row.hintLines) {
            gr.GdiDrawText(String(s.hint), fonts.small || fonts.value, rowMutedColour,
                padX, infoHintY, infoW, row.hintLines * _scale(SETTING_HINT_LINE_H_PT),
                DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
        }
        gr.GdiDrawText(String(s.value), fonts.small || fonts.value, rowMutedColour,
            padX, infoValueY, infoW, infoValueH,
            DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
        gr.DrawLine(padX, drawY + row.h, ww - _scale(18), drawY + row.h, 1, theme.stroke);
        return;
    }

    if (row.hintLines) {
        labelY = drawY + _scale(SETTING_TEXT_PAD_Y_PT);
        labelH = row.labelLines * _scale(SETTING_LABEL_LINE_H_PT);
        hintY = labelY + labelH + _scale(SETTING_HINT_GAP_PT);
        hintH = row.hintLines * _scale(SETTING_HINT_LINE_H_PT);
        gr.GdiDrawText(s.label, fonts.label, rowTextColour, padX, labelY, textW, labelH,
            row.labelLines > 1 ? (DT_LEFT | DT_WORDBREAK | DT_NOPREFIX) : (DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX));
        gr.GdiDrawText(String(s.hint), fonts.small || fonts.value, rowMutedColour, padX, hintY, textW, hintH,
            DT_LEFT | DT_WORDBREAK | DT_NOPREFIX);
    } else {
        gr.GdiDrawText(s.label, fonts.label, rowTextColour, padX, drawY, textW, row.h, labelFlags);
    }

    if (s.type === "bool") {
        drawSwitch(gr, controlX + controlW - _scale(44), drawY + (row.h - _scale(22)) / 2, _scale(44), _scale(22), !!s.value);
    } else if (s.type === "choice") {
        choice = null;
        for (i = 0; i < s.choices.length; i++) {
            if (s.choices[i].value === s.value) { choice = s.choices[i]; break; }
        }
        valueText = choice ? choice.label : String(s.value);
        chipH = _scale(28);
        chipY = drawY + (row.h - chipH) / 2;
        gr.FillRoundRect(controlX, chipY, controlW, chipH, _scale(6), _scale(6), theme.control);
        gr.GdiDrawText(valueText, fonts.value, theme.text, controlX + _scale(10), chipY, controlW - _scale(20), chipH,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    } else if (s.type === "colour") {
        chipH = _scale(28);
        chipY = drawY + (row.h - chipH) / 2;
        gr.FillRoundRect(controlX, chipY, controlW, chipH, _scale(6), _scale(6), Number(s.value) || 0);
        gr.DrawRoundRect(controlX, chipY, controlW, chipH, _scale(6), _scale(6), 1, theme.stroke);
    } else if (s.type === "action") {
        chipH = _scale(28);
        chipY = drawY + (row.h - chipH) / 2;
        gr.FillRoundRect(controlX, chipY, controlW, chipH, _scale(6), _scale(6), theme.control);
        gr.GdiDrawText(actionButtonLabel(s), fonts.value, s.disabled ? theme.textDisabled : sharedAccentOrDefault(), controlX, chipY, controlW, chipH,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    } else {
        // Unknown types remain text-editable for forward compatibility.
        chipH = _scale(28);
        chipY = drawY + (row.h - chipH) / 2;
        gr.FillRoundRect(controlX, chipY, controlW, chipH, _scale(6), _scale(6), theme.control);
        gr.GdiDrawText(String(s.value), fonts.value, theme.text, controlX + _scale(10), chipY, controlW - _scale(20), chipH,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    }

    gr.DrawLine(padX, drawY + row.h, ww - _scale(18), drawY + row.h, 1, theme.stroke);
}

function applyLocalValue(row, value) {
    row.setting.value = value;
    editGeneration++;
    // Force an authoritative post-edit snapshot so rejected/normalized writes roll back.
    lastPanelsJson = "";
    SettingsRegistry.broadcastChange(row.panelId, row.setting.id, value);
    window.Repaint(true);
    refreshSchemas(true);
}

function activateRow(row) {
    var s = row.setting;

    if (s.disabled) return;

    if (s.id === BACKUP_EXPORT_SETTING_ID) { doExportSettings(); return; }
    if (s.id === BACKUP_IMPORT_SETTING_ID) { doImportSettings(); return; }
    if (s.id === "rvgMemoryReport") { logMemoryReport(); return; }
    if (s.id.indexOf(STORAGE_CLEAR_PREFIX) === 0) { confirmClearCache(s.id.substring(STORAGE_CLEAR_PREFIX.length)); return; }

    if (s.type === "bool") {
        applyLocalValue(row, !s.value);
    } else if (s.type === "choice") {
        showChoiceMenu(row);
    } else if (s.type === "number") {
        promptNumber(row);
    } else if (s.type === "colour") {
        promptColour(row);
    } else if (s.type === "action") {
        // Action providers key off settingId; the transmitted value is intentionally irrelevant.
        applyLocalValue(row, true);
    } else if (s.type !== "info") {
        promptString(row);
    }
}

function showChoiceMenu(row) {
    var s = row.setting;
    var menu = window.CreatePopupMenu();
    var i, idx, chosen, value;

    for (i = 0; i < s.choices.length; i++) {
        menu.AppendMenuItem(MF_STRING, i + 1, s.choices[i].label);
    }
    if (s.choices.length) {
        menu.CheckMenuRadioItem(1, s.choices.length, indexOfChoice(s) + 1);
    }
    idx = menu.TrackPopupMenu(mouse.x, mouse.y);
    if (idx >= 1 && idx <= s.choices.length) {
        chosen = s.choices[idx - 1];
        value = s.choiceValueType === "number" ? Number(chosen.value) : chosen.value;
        applyLocalValue(row, value);
    }
}

function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
}

function parseStrictNumber(input) {
    var text = String(input == null ? "" : input).replace(/^\s+|\s+$/g, "");
    var value;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    value = Number(text);
    return isFinite(value) ? value : null;
}

function decimalPlaces(value) {
    var parts = String(value).toLowerCase().split("e");
    var fraction = (parts[0].split(".")[1] || "").length;
    var exponent = parts.length > 1 ? Number(parts[1]) : 0;
    return Math.max(0, fraction - exponent);
}

function quantizeNumber(num, s) {
    var hasMin = isFiniteNumber(s.min);
    var hasMax = isFiniteNumber(s.max);
    var step = isFiniteNumber(s.step) && s.step > 0 ? s.step : null;
    var base, index, minIndex, maxIndex, precision;

    if (hasMin) num = Math.max(s.min, num);
    if (hasMax) num = Math.min(s.max, num);
    if (!step) return num;

    base = hasMin ? s.min : 0;
    index = Math.round((num - base) / step);
    if (hasMin) {
        minIndex = Math.ceil((s.min - base) / step - 1e-9);
        index = Math.max(minIndex, index);
    }
    if (hasMax) {
        maxIndex = Math.floor((s.max - base) / step + 1e-9);
        index = Math.min(maxIndex, index);
    }
    num = base + index * step;
    precision = Math.min(12, Math.max(decimalPlaces(step), decimalPlaces(base)));
    return precision ? Number(num.toFixed(precision)) : Math.round(num);
}

function numericPromptText(s) {
    var details = [];
    if (s.hint) details.push(String(s.hint));
    if (isFiniteNumber(s.min) && isFiniteNumber(s.max)) details.push("Range: " + s.min + "-" + s.max + ".");
    else if (isFiniteNumber(s.min)) details.push("Minimum: " + s.min + ".");
    else if (isFiniteNumber(s.max)) details.push("Maximum: " + s.max + ".");
    if (isFiniteNumber(s.step) && s.step > 0) details.push("Step: " + s.step + ".");
    return details.length ? s.label + "\n\n" + details.join(" ") : s.label;
}

function settingsPromptTitle(row) {
    var panel = findPanel(row && row.panelId);
    return panel ? "Settings \u2014 " + panel.panelLabel : "Settings";
}

function promptNumber(row) {
    var s = row.setting;
    var input, num;
    try {
        input = utils.InputBox(window.ID, numericPromptText(s), settingsPromptTitle(row), String(s.value), true);
    } catch (e) {
        return;
    }
    num = parseStrictNumber(input);
    if (num === null) return;
    applyLocalValue(row, quantizeNumber(num, s));
}

function promptString(row) {
    var s = row.setting;
    var input;
    var prompt = s.hint ? (s.label + "  (" + s.hint + ")") : s.label;
    try {
        input = utils.InputBox(window.ID, prompt, settingsPromptTitle(row), String(s.value), true);
    } catch (e) {
        return;
    }
    applyLocalValue(row, input);
}

function promptColour(row) {
    var s = row.setting;
    var picked;
    try {
        picked = utils.ColourPicker(window.ID, Number(s.value) || 0);
    } catch (e) {
        return;
    }
    if (typeof picked !== "number") return;
    applyLocalValue(row, picked);
}

function backupPanelSettings() {
    return [
        {
            id: "rvgBackupExportInfo", type: "info", label: "Export settings", section: BACKUP_PANEL_LABEL,
            value: "Save every currently loaded panel's live settings to a JSON file. " +
                "Use it as a backup, or to copy your setup to another foobar2000 install."
        },
        { id: BACKUP_EXPORT_SETTING_ID, type: "action", label: "Export settings\u2026", actionLabel: "Export", section: BACKUP_PANEL_LABEL },
        {
            id: "rvgBackupImportInfo", type: "info", label: "Import settings", section: BACKUP_PANEL_LABEL,
            value: "Load a previously exported JSON file and apply it. This overwrites the " +
                "current value of every setting the file contains, for every panel that is " +
                "currently loaded. Panels that are not loaded are skipped."
        },
        { id: BACKUP_IMPORT_SETTING_ID, type: "action", label: "Import settings\u2026", actionLabel: "Import", section: BACKUP_PANEL_LABEL }
    ];
}

function formatBytes(bytes) {
    if (!(bytes > 0)) return "Empty";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function cacheSizeText(id) {
    var entry = cacheSizes[id];
    if (cacheClearPending[id]) return "Clearing\u2026";
    if (typeof utils.GetFolderSizeAsync !== "function") return "Size needs JSplitter 4.2 or newer";
    if (!entry) return "Measuring\u2026";
    if (entry.bytes === null) return "Size unavailable";
    return formatBytes(entry.bytes);
}

function storagePanelSettings() {
    var rows = [{
        id: "rvgStorageInfo", type: "info", label: "Disk caches", section: STORAGE_PANEL_LABEL,
        value: "Web responses the panels keep on disk so they open instantly and stay within each " +
            "service's rate limits. Clearing one is safe: the panel downloads what it needs again the " +
            "next time it is used. A panel that is not loaded has its folder moved to the Recycle Bin."
    }];
    rows.push({
        id: "rvgMemoryReport", type: "action", label: "Memory use", actionLabel: "Log to console",
        hint: "Shared script heap, then each loaded panel's images and other native memory",
        section: STORAGE_PANEL_LABEL, disabled: !window.JsMemoryStats
    });
    var i, c, entry;
    for (i = 0; i < CacheProtocol.CACHES.length; i++) {
        c = CacheProtocol.CACHES[i];
        entry = cacheSizes[c.id];
        rows.push({
            id: STORAGE_CLEAR_PREFIX + c.id, type: "action", label: c.label, actionLabel: "Clear",
            hint: cacheSizeText(c.id) + " \u00b7 " + c.hint, section: STORAGE_PANEL_LABEL,
            disabled: !!cacheClearPending[c.id] || !!(entry && entry.bytes === 0)
        });
    }
    return rows;
}

function logMemoryReport() {
    var m = window.JsMemoryStats;
    if (!m) return;
    console.log("[RVG memory] shared script heap (all panels): " + (m.MainThreadHeapUsage / 1048576).toFixed(1) +
        " MB of " + (m.MainThreadHeapLimit / 1048576).toFixed(0) + " MB");
    rivageLogPanelMemory();
    try { window.NotifyOthers(RIVAGE_MEMORY_REPORT, 0); } catch (e) { console.log("[RVG memory] broadcast failed: " + e); }
    fb.ShowConsole();
}

function measureCacheSizes(force) {
    var i, c, task;
    if (typeof utils.GetFolderSizeAsync !== "function") return;
    if (cacheSizeTasksPending > 0) return;
    if (!force && Date.now() - cacheMeasuredAt < STORAGE_MEASURE_MS) return;
    cacheMeasuredAt = Date.now();
    for (i = 0; i < CacheProtocol.CACHES.length; i++) {
        c = CacheProtocol.CACHES[i];
        try {
            if (!utils.IsDirectory(c.dir)) { cacheSizes[c.id] = { bytes: 0 }; continue; }
            task = utils.GetFolderSizeAsync(c.dir);
            cacheSizeTasks[task] = c.id;
            cacheSizeTasksPending++;
        } catch (e) {
            cacheSizes[c.id] = { bytes: null };
        }
    }
    if (!cacheSizeTasksPending) refreshSchemas(true);
}

function on_get_folder_size_done(task_id, success, size) {
    var id = cacheSizeTasks[task_id];
    if (id === undefined) return;
    delete cacheSizeTasks[task_id];
    cacheSizeTasksPending = Math.max(0, cacheSizeTasksPending - 1);
    cacheSizes[id] = { bytes: success ? Math.max(0, Number(size) || 0) : null };
    if (!cacheSizeTasksPending && scriptActive) refreshSchemas(true);
}

function confirmClearCache(id) {
    var c = CacheProtocol.find(id);
    var result, token;
    if (!c || cacheClearPending[id]) return;
    try {
        result = utils.MessageBox(window.ID,
            "Clear the " + c.label + " cache (" + cacheSizeText(id) + ")?\n\n" +
            "Nothing in your library is touched. The panel downloads what it needs again the next time it is used.",
            "RVG Settings", MB_YESNO | MB_ICONWARNING);
    } catch (e) {
        return;
    }
    if (result !== IDYES) return;

    token = ++cacheClearToken;
    cacheClearPending[id] = {
        token: token,
        // No owner answered: nothing holds the cache in memory, so recycling the folder is safe.
        timer: window.SetTimeout(function () {
            if (!cacheClearPending[id] || cacheClearPending[id].token !== token) return;
            cacheClearPending[id].timer = null;
            try {
                if (utils.IsDirectory(c.dir)) utils.RecyclePath(c.dir);
            } catch (e) {
                console.log("RVG Settings: could not recycle " + c.dir + ": " + e);
            }
            finishClearCache(id);
        }, STORAGE_OWNER_WAIT_MS)
    };
    CacheProtocol.requestClear(id, token);
    refreshSchemas(true);
}

function finishClearCache(id) {
    var pending = cacheClearPending[id];
    if (pending && pending.timer) window.ClearTimeout(pending.timer);
    delete cacheClearPending[id];
    delete cacheSizes[id];
    cacheMeasuredAt = 0;  // if a measurement is still in flight, the next refresh tick re-measures
    measureCacheSizes(true);
    refreshSchemas(true);
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function timestampForFilename(d) {
    return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
        "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

// A focused, one-off schema fetch for Export - deliberately independent of
// the polling/edit-generation bookkeeping `refreshSchemas` owns, so it can't
// race with it or disturb `panels`/`lastPanelsJson`.
function collectLiveSettingsPanels(callback) {
    SettingsRegistry.requestSchemas(300, function (list) {
        callback(list || []);
    });
}

function buildExportPayload(panelsList) {
    var out = { app: RVG_RELEASE.name, version: RVG_RELEASE.version, exportedAt: new Date().toISOString(), panels: [] };
    var i, j, panel, s, values, count;

    for (i = 0; i < panelsList.length; i++) {
        panel = panelsList[i];
        values = {};
        count = 0;
        for (j = 0; j < (panel.settings || []).length; j++) {
            s = panel.settings[j];
            if (!s || s.type === "info" || s.type === "action") continue;
            values[s.id] = s.value;
            count++;
        }
        if (!count) continue;
        out.panels.push({ panelId: panel.panelId, panelLabel: panel.panelLabel, settings: values });
    }
    return out;
}

function countExportedSettings(payload) {
    var total = 0, i;
    for (i = 0; i < payload.panels.length; i++) total += Object.keys(payload.panels[i].settings).length;
    return total;
}

function showInfoDialog(message, title, detail) {
    try {
        utils.InputBox(window.ID, message, title, detail || "", false);
    } catch (e) { }
}

function doExportSettings() {
    collectLiveSettingsPanels(function (panelsList) {
        var payload = buildExportPayload(panelsList);
        var defaultPath = fb.ProfilePath + "RVG-settings-" + timestampForFilename(new Date()) + ".json";
        var path, json, totalSettings;

        if (!payload.panels.length) {
            showInfoDialog(
                "No panel settings are currently available to export. Make sure the other RVG panels are loaded, then try again.",
                "RVG Settings \u2014 Export");
            return;
        }

        try {
            path = utils.FilePicker("Export RVG settings", defaultPath, "JSON files (*.json)|*.json|All files (*.*)|*.*", "1");
        } catch (e) {
            return;
        }
        if (!path) return;

        json = JSON.stringify(payload, null, 2);
        totalSettings = countExportedSettings(payload);

        try {
            utils.WriteTextFile(path, json, false);
        } catch (e) {
            showInfoDialog("Could not write the export file:\n" + e, "RVG Settings \u2014 Export", path);
            return;
        }

        showInfoDialog(
            "Exported " + totalSettings + " setting" + (totalSettings === 1 ? "" : "s") +
                " across " + payload.panels.length + " panel" + (payload.panels.length === 1 ? "" : "s") + ".",
            "RVG Settings \u2014 Export complete", path);
    });
}

function parseImportPayload(text) {
    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        return null;
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.panels)) return null;
    return data;
}

function applyImportedSettings(payload) {
    var applied = 0, i, j, panel, settingIds, id;

    for (i = 0; i < payload.panels.length; i++) {
        panel = payload.panels[i];
        if (!panel || !panel.panelId || !panel.settings || typeof panel.settings !== "object") continue;
        settingIds = Object.keys(panel.settings);
        for (j = 0; j < settingIds.length; j++) {
            id = settingIds[j];
            SettingsRegistry.broadcastChange(panel.panelId, id, panel.settings[id]);
            applied++;
        }
    }

    // Same post-edit bookkeeping applyLocalValue() uses: force an
    // authoritative re-fetch so the on-screen values reflect what every
    // provider actually accepted, not what we asked for.
    editGeneration++;
    lastPanelsJson = "";
    window.Repaint(true);
    refreshSchemas(true);
    return applied;
}

function doImportSettings() {
    var path, text, payload, applied;

    try {
        utils.InputBox(window.ID,
            "This will overwrite the current value of every setting found in the chosen file, " +
                "for every panel it lists. This cannot be undone.\n\n" +
                "Click OK to choose a file, or Cancel to abort.",
            "RVG Settings \u2014 Import", "", true);
    } catch (e) {
        return; // Cancelled.
    }

    try {
        path = utils.FilePicker("Import RVG settings", fb.ProfilePath, "JSON files (*.json)|*.json|All files (*.*)|*.*", "0");
    } catch (e) {
        return;
    }
    if (!path) return;

    try {
        text = utils.ReadTextFile(path);
    } catch (e) {
        text = "";
    }

    payload = text ? parseImportPayload(text) : null;
    if (!payload) {
        showInfoDialog("This file is not a valid RVG settings export.", "RVG Settings \u2014 Import", path);
        return;
    }
    if (!payload.panels.length) {
        showInfoDialog("This file does not contain any settings.", "RVG Settings \u2014 Import", path);
        return;
    }

    applied = applyImportedSettings(payload);
    showInfoDialog(
        "Imported " + applied + " setting" + (applied === 1 ? "" : "s") +
            " across " + payload.panels.length + " panel" + (payload.panels.length === 1 ? "" : "s") +
            ".\n\nPanels that are not currently loaded were skipped.",
        "RVG Settings \u2014 Import complete", path);
}

function contentRowAt(x, y) {
    var sidebarW = _scale(SIDEBAR_W_PT);
    var i, row, drawY;
    if (x < sidebarW || y < contentTop()) return -1;
    for (i = 0; i < contentRows.length; i++) {
        row = contentRows[i];
        drawY = row.y - scrollOffset;
        if (y >= drawY && y < drawY + row.h) return i;
    }
    return -1;
}

function subTabAt(x, y) {
    var i, tab;
    if (!pointInRect(x, y, subTabViewport)) return -1;
    for (i = 0; i < subTabs.length; i++) {
        tab = subTabs[i];
        if (x >= tab.x && x < tab.x + tab.w && y >= tab.y && y < tab.y + tab.h) return i;
    }
    return -1;
}

function sidebarRowAt(x, y) {
    var sidebarW = _scale(SIDEBAR_W_PT);
    var i, row, sy;
    if (x >= sidebarW || y >= sidebarViewportBottom) return -1;
    for (i = 0; i < sidebarRows.length; i++) {
        row = sidebarRows[i];
        sy = row.y - sidebarScrollOffset;
        if (y >= sy && y < sy + row.h) return i;
    }
    return -1;
}

function pointInRect(x, y, r) {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function isInteractiveRow(row) {
    return !!(row && row.setting && row.setting.type !== "info" && !row.setting.disabled);
}

function updateHoverState(x, y, requestRepaint) {
    var nextSidebarHover, nextRowHover, nextRefreshHover, nextCloseHover, nextSubTabHover;
    var nextSubTabScrollLeftHover, nextSubTabScrollRightHover, changed, hand;

    if (x < 0 || y < 0) return false;
    nextSidebarHover = sidebarRowAt(x, y);
    nextRowHover = contentRowAt(x, y);
    if (nextRowHover >= 0 && !isInteractiveRow(contentRows[nextRowHover])) nextRowHover = -1;
    nextSubTabHover = subTabAt(x, y);
    nextRefreshHover = pointInRect(x, y, refreshHitbox);
    nextCloseHover = pointInRect(x, y, closeHitbox);
    nextSubTabScrollLeftHover = subTabMaxScroll > 0 && pointInRect(x, y, subTabScrollLeftHitbox);
    nextSubTabScrollRightHover = subTabMaxScroll > 0 && pointInRect(x, y, subTabScrollRightHitbox);

    if (nextRefreshHover) nextSidebarHover = -1;
    if (nextCloseHover) nextRowHover = -1;
    if (nextSubTabScrollLeftHover || nextSubTabScrollRightHover) nextSubTabHover = -1;

    changed = nextSidebarHover !== sidebarHover || nextRowHover !== rowHover ||
        nextSubTabHover !== subTabHover ||
        nextSubTabScrollLeftHover !== subTabScrollLeftHover ||
        nextSubTabScrollRightHover !== subTabScrollRightHover ||
        nextRefreshHover !== refreshHover || nextCloseHover !== closeHover;

    sidebarHover = nextSidebarHover;
    rowHover = nextRowHover;
    subTabHover = nextSubTabHover;
    subTabScrollLeftHover = nextSubTabScrollLeftHover;
    subTabScrollRightHover = nextSubTabScrollRightHover;
    refreshHover = nextRefreshHover;
    closeHover = nextCloseHover;

    hand = nextSidebarHover >= 0 || nextRowHover >= 0 || nextSubTabHover >= 0 ||
        nextSubTabScrollLeftHover || nextSubTabScrollRightHover || nextRefreshHover || nextCloseHover;
    window.SetCursor(hand ? IDC_HAND : IDC_ARROW);
    if (changed && requestRepaint) window.Repaint();
    return changed;
}

function on_mouse_move(x, y, mask) {
    mouse.x = x;
    mouse.y = y;
    updateHoverState(x, y, true);
}

function on_mouse_leave() {
    var changed;
    changed = sidebarHover >= 0 || rowHover >= 0 || subTabHover >= 0 ||
        subTabScrollLeftHover || subTabScrollRightHover || refreshHover || closeHover;
    sidebarHover = -1;
    rowHover = -1;
    subTabHover = -1;
    subTabScrollLeftHover = false;
    subTabScrollRightHover = false;
    refreshHover = false;
    closeHover = false;
    mouse.x = -1;
    mouse.y = -1;
    window.SetCursor(IDC_ARROW);
    if (changed) window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    var idx, panel;

    if (pointInRect(x, y, closeHitbox)) {
        closeSettingsPanel();
        return true;
    }

    if (pointInRect(x, y, refreshHitbox)) {
        refreshSchemas(true);
        return true;
    }

    if (subTabMaxScroll > 0 && pointInRect(x, y, subTabScrollLeftHitbox)) {
        scrollSubTabs(-_scale(SUBTAB_SCROLL_STEP_PT));
        return true;
    }

    if (subTabMaxScroll > 0 && pointInRect(x, y, subTabScrollRightHitbox)) {
        scrollSubTabs(_scale(SUBTAB_SCROLL_STEP_PT));
        return true;
    }

    idx = sidebarRowAt(x, y);
    if (idx >= 0) {
        activePanelId = sidebarRows[idx].panel.panelId;
        scrollOffset = 0;
        subTabScrollOffset = 0;
        layout();
        window.Repaint(true);
        return true;
    }

    idx = subTabAt(x, y);
    if (idx >= 0) {
        panel = findPanel(activePanelId);
        if (panel) activeSubTabByPanel[panel.panelId] = subTabs[idx].name;
        scrollOffset = 0;
        layout();
        window.Repaint(true);
        return true;
    }

    idx = contentRowAt(x, y);
    if (idx >= 0 && isInteractiveRow(contentRows[idx])) {
        activateRow(contentRows[idx]);
        return true;
    }

    return false;
}

function on_mouse_wheel(step) {
    var previous, sidebarW;

    if (subTabMaxScroll > 0 && mouse.y >= subTabViewport.y && mouse.y < subTabViewport.y + subTabViewport.h) {
        previous = subTabScrollOffset;
        subTabScrollOffset = clampNumber(
            subTabScrollOffset - step * _scale(SUBTAB_SCROLL_STEP_PT),
            0,
            subTabMaxScroll
        );
        if (subTabScrollOffset !== previous) {
            layout();
            window.Repaint();
            return true;
        }
    }

    sidebarW = _scale(SIDEBAR_W_PT);
    if (sidebarMaxScroll > 0 && mouse.x < sidebarW) {
        previous = sidebarScrollOffset;
        sidebarScrollOffset = clampNumber(sidebarScrollOffset - step * _scale(54), 0, sidebarMaxScroll);
        if (sidebarScrollOffset !== previous) {
            updateHoverState(mouse.x, mouse.y, false);
            window.Repaint();
            return true;
        }
        return false;
    }

    previous = scrollOffset;
    scrollOffset = clampNumber(scrollOffset - step * _scale(54), 0, maxScroll);
    if (scrollOffset !== previous) {
        updateHoverState(mouse.x, mouse.y, false);
        window.Repaint();
        return true;
    }
    return false;
}

function on_notify_data(name, info) {
    if (name === "RIVAGE.TOGGLE_PANEL_VISIBILITY" && info && info.caption === SETTINGS_PANEL_CAPTION) {
        refreshAfterHidden = true;
    }
    if (SharedThemeProtocol.consume(name, info)) return;
    if (SettingsRegistry.collect(name, info)) return;

    if (name === OPEN_SECTION && info && typeof info.panelId === "string") {
        pendingOpenSection = { panelId: info.panelId, section: typeof info.section === "string" ? info.section : "" };
        try { window.NotifyOthers(OPEN_SECTION_ACK, 0); } catch (eAck) { }
        if (applyPendingOpenSection()) {
            layout();
            window.Repaint(true);
        }
        refreshSchemas(true);
        return;
    }

    var cleared = CacheProtocol.parseCleared(name, info);
    if (cleared) {
        if (cacheClearPending[cleared.id] && cacheClearPending[cleared.id].token === cleared.token) {
            finishClearCache(cleared.id);
        }
        return;
    }

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        window.Repaint();
    }
}

refreshTheme();
on_font_changed();
on_size(window.Width, window.Height);
SharedAccentProtocol.request();
refreshSchemas(true);