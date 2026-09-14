'use strict';

window.DrawMode = 0;

// Four-slot BOTTOM BAR preset selector; preset management lives in SETTINGS.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\bottom_bar_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\presets_side_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

window.DefineScript('RVG Bottom Bar Presets', {
    author: 'RivaGe',
    version: '1.8.0',
    features: { drag_n_drop: false, grab_focus: false }
});

// Narrow failure reporting. This is for the one empty catch that means a
// direct user action (opening the panel properties dialog) silently did
// nothing. Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Bottom Bar Presets] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var MF_STRING = 0x00000000;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;

var BUTTON_COUNT = 4;
var INITIAL_RETRY_COUNT = 8;
var INITIAL_RETRY_DELAY = 250;
var DEFAULT_UWP_ACCENT = 0xff0078d4;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function RGB(red, green, blue) {
    return RivageUI.rgb(red, green, blue);
}

function blendColours(foreground, background, amount) {
    return RivageUI.mix(background, foreground, amount);
}

var dpi = RivageScale.dpi() || 96;
function scale(value) {
    return Math.max(1, Math.round(value * dpi / 96));
}

// The backdrop base must be the shared background, as in the tab hosts; the
// navigation surface is a layer painted over it, not the Mica fallback/tint.
var COLOUR_CONTENT = RGB(32, 32, 32);
var COLOUR_SURFACE = RGB(28, 28, 28);
var COLOUR_SEPARATOR = RGB(51, 51, 51);
var COLOUR_TEXT_PRIMARY = RGB(245, 245, 245);
var COLOUR_TEXT_SECONDARY = RGB(184, 184, 184);
var COLOUR_TEXT_MUTED = RGB(126, 126, 126);

function refreshTheme() {
    var resolved = RivageUI.createTheme({ mode: 'dark', accent: sharedAlbumAccent });
    COLOUR_CONTENT = resolved.background;
    COLOUR_SURFACE = resolved.navigationSurface;
    COLOUR_SEPARATOR = resolved.navigationSeparator;
    COLOUR_TEXT_PRIMARY = resolved.navigationTextPrimary;
    COLOUR_TEXT_SECONDARY = resolved.navigationTextSecondary;
    COLOUR_TEXT_MUTED = resolved.navigationTextMuted;
}

var PRESET_FONT_PREFIX = 'Rivage Presets.';
// Side is owned by Global settings; the local copy only keeps the selection bar
// on the correct edge until the first broadcast arrives.
var PRESETS_SIDE_PROPERTY = 'Rivage Presets.Side';
var MIRROR_INDICATOR_PROPERTY = 'Rivage Presets.Mirror selection bar';
var customButtonFontFamily = String(window.GetProperty(PRESET_FONT_PREFIX + 'Font override', '') || '').trim();
var customButtonFontSize = Math.max(1, Math.round(Number(window.GetProperty(PRESET_FONT_PREFIX + 'Font size', 11)) || 11));
var customButtonFontStyle = Math.round(Number(window.GetProperty(PRESET_FONT_PREFIX + 'Font style', 0)) || 0);
var buttonFont = null;
var presetsSide = PresetsSideProtocol.normalise(
    window.GetProperty(PRESETS_SIDE_PROPERTY, PresetsSideProtocol.Side.Left)
);
var mirrorIndicator = !!window.GetProperty(MIRROR_INDICATOR_PROPERTY, true);

function resolvedButtonFontInfo() {
    if (customButtonFontFamily) {
        var installed = true;
        try { installed = utils.CheckFont(customButtonFontFamily); } catch (e) { installed = true; }
        if (installed) {
            return {
                fontFamily: customButtonFontFamily,
                fontSize: customButtonFontSize,
                fontStyle: customButtonFontStyle,
                inherited: false
            };
        }
    }

    var inherited = RivageUI.commonLabelsFontInfo();
    inherited.inherited = true;
    return inherited;
}

function rebuildButtonFont() {
    var info = resolvedButtonFontInfo();
    buttonFont = RivageUI.font(info.fontFamily, info.fontSize, info.fontStyle || 0);
}

function describeButtonFont() {
    var info = resolvedButtonFontInfo();
    return (info.inherited ? 'Common (labels): ' : 'Custom: ') + info.fontFamily + ', ' + info.fontSize + ' px';
}

function chooseCustomButtonFont() {
    var info = resolvedButtonFontInfo();
    var current, chosen;
    try {
        current = gdi.Font(info.fontFamily, info.fontSize, info.fontStyle || 0);
        chosen = utils.FontPicker(current);
    } catch (e) {
        return;
    }
    // SMP returns the seed font when the picker is cancelled.
    if (!chosen || chosen == current) return;

    customButtonFontFamily = String(chosen.Name || info.fontFamily).trim();
    customButtonFontSize = Math.max(1, Math.round(Number(chosen.Size) || info.fontSize));
    customButtonFontStyle = Math.round(Number(chosen.Style) || 0);
    window.SetProperty(PRESET_FONT_PREFIX + 'Font override', customButtonFontFamily);
    window.SetProperty(PRESET_FONT_PREFIX + 'Font size', customButtonFontSize);
    window.SetProperty(PRESET_FONT_PREFIX + 'Font style', customButtonFontStyle);
    rebuildButtonFont();
    window.Repaint(true);
}

function indicatorX(rect) {
    if (!mirrorIndicator || presetsSide !== PresetsSideProtocol.Side.Right) return rect.x;
    return rect.x + Math.max(0, rect.w - scale(3));
}

function adoptPresetsSide(side) {
    var next = PresetsSideProtocol.normalise(side);
    if (next === presetsSide) return;

    presetsSide = next;
    try { window.SetProperty(PRESETS_SIDE_PROPERTY, presetsSide); } catch (e) { }
    if (mirrorIndicator) window.Repaint();
}

function setMirrorIndicator(enabled) {
    mirrorIndicator = !!enabled;
    window.SetProperty(MIRROR_INDICATOR_PROPERTY, mirrorIndicator);
    if (presetsSide === PresetsSideProtocol.Side.Right) window.Repaint();
}

function useCommonLabelsFont() {
    customButtonFontFamily = '';
    window.SetProperty(PRESET_FONT_PREFIX + 'Font override', '');
    rebuildButtonFont();
    window.Repaint(true);
}

rebuildButtonFont();

var ww = Math.max(0, window.Width);
var wh = Math.max(0, window.Height);
var presets = [];
var activePresetId = '';
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;
var hoveredIndex = -1;
var pressedIndex = -1;
var pressedPresetId = '';
var stateReceived = false;
var requestAttempts = 0;

function getButtonRect(index) {
    var top = Math.floor(index * wh / BUTTON_COUNT);
    var bottom = Math.floor((index + 1) * wh / BUTTON_COUNT);

    return {
        x: 0,
        y: top,
        w: Math.max(0, ww),
        h: Math.max(0, bottom - top)
    };
}

function hitTestButton(x, y) {
    if (ww <= 0 || wh <= 0 || x < 0 || x >= ww || y < 0 || y >= wh) return -1;
    return Math.min(BUTTON_COUNT - 1, Math.floor(y * BUTTON_COUNT / wh));
}

function presetAt(index) {
    return index >= 0 && index < presets.length ? presets[index] : null;
}

function compactPresetLabel(name) {
    var text = String(name == null ? '' : name).replace(/[^A-Za-z0-9]/g, '');
    if (!text) return '---';
    return text.substr(0, 3).toUpperCase();
}

function repaintButton(index, force) {
    var rect;
    if (index < 0 || index >= BUTTON_COUNT || ww <= 0 || wh <= 0) return;
    rect = getButtonRect(index);
    window.RepaintRect(rect.x, rect.y, rect.w, rect.h, !!force);
}

function requestStateWithRetry() {
    if (stateReceived) return;
    BottomBarProtocol.requestState();

    if (requestAttempts < INITIAL_RETRY_COUNT) {
        requestAttempts++;
        window.SetTimeout(requestStateWithRetry, INITIAL_RETRY_DELAY);
    }
}

function on_size(width, height) {
    ww = Math.max(0, typeof width === 'number' ? width : window.Width);
    wh = Math.max(0, typeof height === 'number' ? height : window.Height);
}

function on_paint(gr) {
    var accent = sharedAlbumAccent || DEFAULT_UWP_ACCENT;
    var selectedBackground = blendColours(accent, COLOUR_SURFACE, 0.12);
    var hoverBackground = blendColours(COLOUR_TEXT_PRIMARY, COLOUR_SURFACE, 0.07);
    var selectedHover = blendColours(accent, COLOUR_SURFACE, 0.19);
    var pressedBackground = blendColours(accent, COLOUR_SURFACE, 0.25);
    var i;
    var rect;
    var preset;
    var selected;
    var hovered;
    var pressed;
    var background;
    var textColour;
    var indicatorH;
    var indicatorY;

    RivageBackdrop.paint(gr, 0, 0, ww, wh, COLOUR_CONTENT);
    gr.FillSolidRect(0, 0, ww, wh, COLOUR_SURFACE);

    for (i = 0; i < BUTTON_COUNT; i++) {
        rect = getButtonRect(i);
        preset = presetAt(i);
        selected = !!preset && preset.id === activePresetId;
        hovered = i === hoveredIndex && !!preset;
        pressed = i === pressedIndex && !!preset;
        background = COLOUR_SURFACE;

        if (selected) background = selectedBackground;
        if (hovered) background = selected ? selectedHover : hoverBackground;
        if (pressed) background = pressedBackground;

        if (background !== COLOUR_SURFACE) {
            gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, background);
        }

        if (i > 0) {
            gr.FillSolidRect(rect.x, rect.y, rect.w, scale(1), COLOUR_SEPARATOR);
        }

        if (selected) {
            indicatorH = Math.min(scale(30), Math.max(scale(12), rect.h - scale(16)));
            indicatorY = rect.y + Math.floor((rect.h - indicatorH) / 2);
            gr.FillSolidRect(indicatorX(rect), indicatorY, scale(3), indicatorH, accent);
        }

        textColour = preset
            ? (selected ? COLOUR_TEXT_PRIMARY : (hovered ? COLOUR_TEXT_SECONDARY : COLOUR_TEXT_MUTED))
            : blendColours(COLOUR_TEXT_MUTED, COLOUR_SURFACE, 0.55);

        gr.GdiDrawText(
            preset ? compactPresetLabel(preset.name) : '---',
            buttonFont,
            textColour,
            rect.x + scale(5),
            rect.y,
            Math.max(1, rect.w - scale(10)),
            Math.max(1, rect.h),
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX
        );
    }
}

function on_mouse_move(x, y, mask) {
    var index = hitTestButton(x, y);
    var nextHover = presetAt(index) ? index : -1;
    var oldHover = hoveredIndex;

    hoveredIndex = nextHover;
    window.SetCursor(nextHover >= 0 ? IDC_HAND : IDC_ARROW);

    if (oldHover !== hoveredIndex) {
        repaintButton(oldHover, false);
        repaintButton(hoveredIndex, false);
    }
}

function on_mouse_leave() {
    var oldHover = hoveredIndex;
    var oldPressed = pressedIndex;

    hoveredIndex = -1;
    pressedIndex = -1;
    pressedPresetId = '';
    window.SetCursor(IDC_ARROW);
    repaintButton(oldHover, false);
    repaintButton(oldPressed, false);
}

function on_mouse_lbtn_down(x, y, mask) {
    var index = hitTestButton(x, y);
    var preset = presetAt(index);

    pressedIndex = preset ? index : -1;
    pressedPresetId = preset ? preset.id : '';
    repaintButton(pressedIndex, false);
}

function on_mouse_lbtn_up(x, y, mask) {
    var releasedIndex = hitTestButton(x, y);
    var releasedPreset = presetAt(releasedIndex);
    var shouldLoad = pressedIndex >= 0 && releasedIndex === pressedIndex &&
        !!releasedPreset && releasedPreset.id === pressedPresetId;
    var presetId = shouldLoad ? pressedPresetId : '';
    var oldPressed = pressedIndex;

    pressedIndex = -1;
    pressedPresetId = '';
    repaintButton(oldPressed, false);

    if (presetId) {
        BottomBarProtocol.loadPreset(presetId);
        return true;
    }
    return false;
}

function on_mouse_rbtn_up(x, y, mask) {
    var menu = window.CreatePopupMenu();
    var sideMenu = window.CreatePopupMenu();

    sideMenu.AppendMenuItem(MF_STRING, 4, 'Left of the bottom bar');
    sideMenu.AppendMenuItem(MF_STRING, 5, 'Right of the bottom bar');
    sideMenu.CheckMenuRadioItem(4, 5, presetsSide === PresetsSideProtocol.Side.Right ? 5 : 4);
    sideMenu.AppendTo(menu, MF_STRING, 'Preset buttons side');
    menu.AppendMenuItem(MF_STRING, 6, 'Mirror selection bar when on the right');
    menu.CheckMenuItem(6, mirrorIndicator);
    menu.AppendMenuSeparator();

    menu.AppendMenuItem(MF_STRING, 1, 'Choose preset-button font… (' + describeButtonFont() + ')');
    if (customButtonFontFamily) {
        menu.AppendMenuItem(MF_STRING, 2, 'Use Columns UI "Common (labels)" font');
    }
    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 3, RivageUI.copy.labels.panelProperties);

    var command = menu.TrackPopupMenu(x, y);
    if (command === 1) chooseCustomButtonFont();
    else if (command === 2) useCommonLabelsFont();
    else if (command === 3) { try { window.ShowProperties(); } catch (e) { reportFailure('panel properties could not be opened', e); } }
    else if (command === 4) PresetsSideProtocol.setUntilAnswered(PresetsSideProtocol.Side.Left);
    else if (command === 5) PresetsSideProtocol.setUntilAnswered(PresetsSideProtocol.Side.Right);
    else if (command === 6) setMirrorIndicator(!mirrorIndicator);
    return true;
}

function on_colours_changed() {
    refreshTheme();
    SharedThemeProtocol.requestRepaint();
}

function on_font_changed() {
    dpi = RivageScale.dpi() || 96;
    rebuildButtonFont();
    window.Repaint(true);
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (PresetsSideProtocol.consume(name, info, adoptPresetsSide)) return;
    var copy;

    if (name === BottomBarProtocol.STATE) {
        copy = BottomBarProtocol.parseState(info);
        if (!copy) return;

        presets = copy.presets.slice(0, BUTTON_COUNT);
        activePresetId = String(copy.activePresetId || '');
        stateReceived = true;

        if (pressedIndex >= 0 && (!presetAt(pressedIndex) || presetAt(pressedIndex).id !== pressedPresetId)) {
            pressedIndex = -1;
            pressedPresetId = '';
        }
        if (hoveredIndex >= 0 && !presetAt(hoveredIndex)) {
            hoveredIndex = -1;
            window.SetCursor(IDC_ARROW);
        }
        window.Repaint(true);
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
SharedAccentProtocol.request();
PresetsSideProtocol.requestUntilAnswered();
window.SetTimeout(requestStateWithRetry, 0);