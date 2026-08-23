window.DrawMode = 0;

// Thin top bar spanning the full width of the skin.
//
// Shared accent role: pure consumer (see shared/album_accent_protocol.js).
// Shared settings role: this panel PROVIDES its own settings into the shared
// registry (see shared/settings_protocol.js) but no longer hosts the screen
// itself - that now lives in the dedicated settings_panel.js panel. See
// shared/SETTINGS_FRAMEWORK.md.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\foobar_actions.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
// Must come after settings_protocol.js - see seekbar_widget.js's own header comment for why.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\seekbar_widget.js");
// Volume bar reuses SeekbarWidget appearance settings; keep this include after seekbar_widget.js.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\volume_bar_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
// Shared scrolling-text engine, used by the track-info marquee below.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\marquee_widget.js");

window.DefineScript("RVG Top Bar", {
    author: "RivaGe (based on a SMP/JScript sample)",
    version: "3.7.0",
    features: { drag_n_drop: false, grab_focus: false }
});

// Host constants / compatibility helpers

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var MK_SHIFT = 0x0004;
// Tooltip INITIAL delay; AUTOPOP/RESHOW keep host defaults.
var TTDT_INITIAL = 3;

var DT_LEFT = 0x00000000;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var SMOOTHING_MODE_DEFAULT = 0;
var SMOOTHING_MODE_ANTIALIAS = 4;
var TEXT_RENDERING_HINT_ANTIALIAS = 4;
var AlbumArtId = { front: 0 };
var PlaybackStopReason = { user: 0, eof: 1, starting_another: 2 };

function RGB(r, g, b) {
    return RivageUI.rgb(r, g, b);
}

function blendColours(first, second, amount) {
    return RivageUI.mix(first, second, amount);
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
}

// Skip idle seek/marquee timer work while the panel is hidden.
var SKIP_WORK_WHEN_HIDDEN = true;

var g_dpi = 100;
function _scale(value) {
    return Math.round(value * g_dpi / 100);
}

function make_font(name, size, style) {
    return RivageUI.font(name || "Segoe UI", _scale(size), style);
}

function fontAvailable(name) {
    try {
        return !!utils.CheckFont(name);
    } catch (e) {
        return false;
    }
}

function choose_font(candidates, fallback) {
    var i;
    for (i = 0; i < candidates.length; i++) {
        if (fontAvailable(candidates[i])) return candidates[i];
    }
    return fallback;
}

// Theme

var theme = {
    background: RGB(30, 30, 30), // fallback only - overwritten by refreshHostColours() below
    track: RGB(58, 58, 58),
    text: RGB(246, 246, 246),
    textTertiary: RGB(151, 151, 156),
    stroke: RGB(64, 64, 68),
    hover: RGB(255, 255, 255)
};

function refreshHostColours() {
    var resolved = RivageUI.createTheme({ mode: 'host', accent: currentAccent() });
    theme.background = resolved.background;
    theme.track = resolved.surface;
    theme.text = resolved.textPrimary;
    theme.textTertiary = resolved.textTertiary;
    theme.stroke = resolved.stroke;
    theme.hover = resolved.accentHover;
}

var iconFontName = choose_font(["Segoe Fluent Icons", "Segoe MDL2 Assets"], "Segoe MDL2 Assets");

// Persisted settings

var PROPERTY_PREFIX = "Rivage TopBar.";

function saveSetting(name, value) {
    window.SetProperty(PROPERTY_PREFIX + name, value);
}

function commitSetting(settingKey, propertyName, value) {
    saveSetting(propertyName, value);
    settings[settingKey] = value;
}

var settings = {
    enableAlbumArt: !!window.GetProperty(PROPERTY_PREFIX + "Enable album art", true),
    enableTrackInfo: !!window.GetProperty(PROPERTY_PREFIX + "Enable track info", true),
    enableSeekbar: !!window.GetProperty(PROPERTY_PREFIX + "Enable seekbar", true),
    enableVolumeBar: !!window.GetProperty(PROPERTY_PREFIX + "Enable volume bar", false),
    enableControls: !!window.GetProperty(PROPERTY_PREFIX + "Enable controls", true),
    // 0 = reclaim space of a hidden widget, 1 = leave its slot as a blank gap.
    layoutMode: clampNumber(window.GetProperty(PROPERTY_PREFIX + "Layout mode", 0), 0, 1),
    // 0 = fixed UWP blue, 1 = shared album-art accent.
    accentMode: clampNumber(window.GetProperty(PROPERTY_PREFIX + "Accent mode", 1), 0, 1),
    // Empty string (the default) means "follow Columns UI's Core:Default font" - see
    // on_font_changed() below. Any non-empty value here overrides it, if installed.
    fontOverride: String(window.GetProperty(PROPERTY_PREFIX + "Font override", "") || "").trim(),

    // Hide this when TOP BUTTONS already provides Preferences; its space is reclaimed.
    showCoreButtons: window.GetProperty(PROPERTY_PREFIX + "Show preferences button", true) !== false,


};

// Shared accent

var DEFAULT_UWP_ACCENT = 0xff0078d4;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

function currentAccent() {
    return settings.accentMode === 1 ? sharedAlbumAccent : DEFAULT_UWP_ACCENT;
}

// Top bar font picker

function describeTopbarFont() {
    if (settings.fontOverride) {
        if (fontAvailable(settings.fontOverride)) return "Custom: " + settings.fontOverride;
        return "Unavailable: " + settings.fontOverride + " (using " + (currentFontName || RivageUI.hostFontFamily()) + ")";
    }
    return "Core: Default (automatic)";
}

function chooseTopbarFont() {
    var seedName = currentFontName || settings.fontOverride || "Segoe UI";
    var current, chosen, pickedName;

    try {
        // The picker chooses only the face; bar height/DPI still owns text size.
        current = gdi.Font(seedName, Math.max(1, _scale(13)), 0);
        chosen = utils.FontPicker(current);
    } catch (e) {
        return;
    }

    // SMP returns the seed font on cancel.
    if (!chosen || chosen == current) return;

    pickedName = String(chosen.Name || "").trim();
    if (!pickedName) return;

    saveSetting("Font override", pickedName);
    settings.fontOverride = pickedName;
    on_font_changed();
}

function resetTopbarFont() {
    saveSetting("Font override", "");
    settings.fontOverride = "";
    on_font_changed();
}

// Shared settings provider; settings_panel.js owns the renderer.

var SETTINGS_PANEL_ID = "topbar";
var SETTINGS_PANEL_LABEL = "Top bar";

function getMySettings() {
    return [
        { id: "enableAlbumArt", label: "Show album artwork", type: "bool", value: settings.enableAlbumArt, section: "General" },
        { id: "enableTrackInfo", label: "Show track information", type: "bool", value: settings.enableTrackInfo, section: "General" },
        { id: "enableSeekbar", label: "Show seekbar", type: "bool", value: settings.enableSeekbar, section: "General" },
        { id: "enableVolumeBar", label: "Show volume bar", type: "bool", value: settings.enableVolumeBar, section: "General" },
        { id: "enableControls", label: "Show playback controls", type: "bool", value: settings.enableControls, section: "General" },
        {
            id: "showCoreButtons", label: "Show preferences button", type: "bool",
            value: settings.showCoreButtons, section: "General"
        },
        {
            id: "layoutMode", label: "Hidden widget space", type: "choice",
            value: settings.layoutMode === 1 ? "gap" : "reclaim",
            choiceValueType: "string",
            section: "General",
            choices: [
                { value: "reclaim", label: "Reclaim space" },
                { value: "gap", label: "Keep empty space" }
            ]
        },
        {
            id: "accentMode", label: "Accent colour", type: "choice",
            value: settings.accentMode === 1 ? "shared" : "fixed",
            choiceValueType: "string",
            section: "General",
            choices: [
                { value: "fixed", label: RivageUI.copy.labels.rvgBlue },
                { value: "shared", label: RivageUI.copy.labels.sharedAccent }
            ]
        },
        {
            id: "fontStatus", label: "Top bar font", type: "info",
            section: "General", value: describeTopbarFont()
        },
        {
            id: "chooseFont", label: "Choose top bar font…", type: "action",
            value: null, actionLabel: "Choose", section: "General"
        },
        {
            id: "resetFont", label: "Use Core: Default font", type: "action",
            value: null, actionLabel: "Use", section: "General"
        },


    ];
}

function applyMySetting(settingId, value) {
    var nextValue;
    switch (settingId) {
    case "enableAlbumArt":
        nextValue = !!value;
        commitSetting("enableAlbumArt", "Enable album art", nextValue);
        if (nextValue) {
            refreshArt();
        } else {
            cancelScheduledArtRefresh(true);
            artImage = null;
            artKey = "";
            clearArtRender();
        }
        break;
    case "enableTrackInfo":
        commitSetting("enableTrackInfo", "Enable track info", !!value);
        break;
    case "showCoreButtons":
        commitSetting("showCoreButtons", "Show preferences button", !!value);
        break;
    case "enableSeekbar":
        commitSetting("enableSeekbar", "Enable seekbar", !!value);
        break;
    case "enableVolumeBar":
        commitSetting("enableVolumeBar", "Enable volume bar", !!value);
        break;
    case "enableControls":
        commitSetting("enableControls", "Enable controls", !!value);
        break;
    case "layoutMode":
        commitSetting("layoutMode", "Layout mode", value === "gap" ? 1 : 0);
        break;
    case "accentMode":
        commitSetting("accentMode", "Accent mode", value === "shared" ? 1 : 0);
        refreshHostColours();
        break;
    case "chooseFont":
        chooseTopbarFont();
        return;
    case "resetFont":
        resetTopbarFont();
        return;
    default:
        return;
    }
    layoutBar();
    window.Repaint(true);
}

// Playback / track state

var ww = 0;
var wh = 0;
var handle = null;
var trackKey = "";

var tfo = {
    title: fb.TitleFormat("%title%"),
    artist: fb.TitleFormat("%artist%")
};

var cache = { text: "" };

function getHandleKey(h) {
    if (!h) return "";
    try {
        return h.Path + "|" + h.SubSong;
    } catch (e) {
        return "";
    }
}

function refreshCache() {
    var title, artist;
    if (!handle) {
        cache.text = "Not playing";
        return;
    }
    title = fb.IsPlaying ? tfo.title.Eval() : tfo.title.EvalWithMetadb(handle);
    artist = fb.IsPlaying ? tfo.artist.Eval() : tfo.artist.EvalWithMetadb(handle);
    cache.text = artist ? (title + "  \u2014  " + artist) : title;
}

// Album art thumbnail

var artImage = null;
var artKey = "";
var artGeneration = 0;
var artSettleTimer = null;
var ART_SETTLE_DELAY = 200;
var artRenderImage = null;
var artRenderKey = "";
var artRenderW = 0;
var artRenderH = 0;

function cancelScheduledArtRefresh(invalidatePending) {
    if (artSettleTimer !== null) {
        window.ClearTimeout(artSettleTimer);
        artSettleTimer = null;
    }
    if (invalidatePending) artGeneration++;
}

function scheduleArtRefresh() {
    // Invalidate an older async lookup immediately, then postpone starting the
    // next decode until playback has survived the short foo_skip settle window.
    cancelScheduledArtRefresh(true);
    artSettleTimer = window.SetTimeout(function () {
        artSettleTimer = null;
        refreshArt(true);
    }, ART_SETTLE_DELAY);
}

function clearArtRender() {
    artRenderImage = null;
    artRenderKey = "";
    artRenderW = 0;
    artRenderH = 0;
}

function rebuildArtRender() {
    var rect = layoutRects.art;
    var w, h, scale, srcW, srcH, srcX, srcY, image = null, graphics = null, rendered = false;
    if (!artImage || !rect || rect.w <= 0 || rect.h <= 0) {
        clearArtRender();
        return;
    }

    w = Math.max(1, Math.round(rect.w));
    h = Math.max(1, Math.round(rect.h));
    if (artRenderImage && artRenderKey === artKey && artRenderW === w && artRenderH === h) return;

    scale = Math.max(w / artImage.Width, h / artImage.Height);
    srcW = w / scale;
    srcH = h / scale;
    srcX = (artImage.Width - srcW) / 2;
    srcY = (artImage.Height - srcH) / 2;

    try {
        image = gdi.CreateImage(w, h);
        if (!image) throw new Error("Could not create artwork render surface");
        graphics = image.GetGraphics();
        if (!graphics) throw new Error("Could not acquire artwork render graphics");
        graphics.DrawImage(artImage, 0, 0, w, h, srcX, srcY, srcW, srcH, 0, 255);
        rendered = true;
    } catch (e) {
        rendered = false;
    } finally {
        if (image && graphics) {
            try {
                image.ReleaseGraphics(graphics);
            } catch (releaseError) {
                rendered = false;
            }
        }
    }

    if (!rendered) {
        clearArtRender();
        return;
    }

    artRenderImage = image;
    artRenderKey = artKey;
    artRenderW = w;
    artRenderH = h;
}

function refreshArt(force) {
    var generation;
    force = !!force;

    if (!settings.enableAlbumArt) {
        clearArtRender();
        return;
    }
    if (!handle) {
        artGeneration++; // invalidate any async request still in flight
        artImage = null;
        artKey = "";
        clearArtRender();
        return;
    }
    if (!force && trackKey === artKey && artImage) return;

    artGeneration++;
    generation = artGeneration;
    artKey = trackKey;

    fetchArt(handle, generation);
}

async function fetchArt(forHandle, generation) {
    var result;
    try {
        result = await utils.GetAlbumArtAsyncV2(0, forHandle, AlbumArtId.front);
    } catch (e) {
        result = null;
    }
    if (generation !== artGeneration) return; // a newer track has since started

    // Dynamic metadata can replace art without changing the metadb key, so every
    // completed lookup invalidates the scaled cache. Missing art uses the shared placeholder.
    artImage = (result && result.image) ? result.image : RivageUI.placeholderArt();
    clearArtRender();
    rebuildArtRender();
    if (layoutRects.art) {
        window.RepaintRect(layoutRects.art.x, layoutRects.art.y, layoutRects.art.w, layoutRects.art.h, true);
    } else {
        window.Repaint(true);
    }
}

function drawArt(gr, rect) {
    gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, theme.track);
    if (!artImage) return;
    if (!artRenderImage || artRenderW !== Math.round(rect.w) || artRenderH !== Math.round(rect.h)) {
        rebuildArtRender();
    }
    if (artRenderImage) {
        gr.DrawImage(artRenderImage, rect.x, rect.y, rect.w, rect.h, 0, 0, artRenderW, artRenderH, 0, 255);
    }
}

// Track info marquee

var MARQUEE = { interval: 33, speed: 36, pause: 1400, gap: 0 };

function measureTextWidth(text, font) {
    return RivageUI.measureText(text, font, true);
}

// Keep the existing wrapper names; on_paint restarts an active marquee after
// stopTimerWhenHidden pauses its timer behind another tab.
var titleMarquee = MarqueeWidget.create({
    interval: MARQUEE.interval,
    speed: MARQUEE.speed,
    pause: MARQUEE.pause,
    gap: 48,
    isVisible: function () { return !!window.IsVisible; },
    skipWorkWhenHidden: SKIP_WORK_WHEN_HIDDEN,
    stopTimerWhenHidden: true,
    onTick: function () {
        if (layoutRects.info) {
            window.RepaintRect(layoutRects.info.x, layoutRects.info.y, layoutRects.info.w, layoutRects.info.h);
        }
    }
});

function resetMarquee() {
    titleMarquee.reset();
}

function startMarqueeTimer() {
    titleMarquee.startTimer();
}

function prepareMarquee() {
    var rect = layoutRects.info;

    if (!rect || !rect.visible || !cache.text || !fonts.info || rect.w <= 0) {
        resetMarquee();
        return;
    }

    titleMarquee.prepare(cache.text, fonts.info, rect, {
        measureText: measureTextWidth,
        scale: _scale,
        textColour: theme.text,
        textY: function (imageHeight) { return Math.max(0, Math.round((imageHeight - _scale(16)) / 2)); },
        textRenderingHint: TEXT_RENDERING_HINT_ANTIALIAS
    });
}

function drawTrackInfo(gr, rect) {
    if (!titleMarquee.draw(gr, rect)) {
        gr.GdiDrawText(cache.text, fonts.info, theme.text, rect.x, rect.y, rect.w, rect.h,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    }
}

// Seekbar appearance/state is shared; this panel owns only layout and accent input.

var seekbar = SeekbarWidget.create();

var volumeBar = VolumeBarWidget.create();

// One-time migration from the old panel-local midpoint setting.
(function migrateMidpointSetting() {
    var migratedKey = PROPERTY_PREFIX + "Migrated seekbar settings";
    var oldValue;
    if (window.GetProperty(migratedKey, false)) return;
    oldValue = window.GetProperty(PROPERTY_PREFIX + "Show midpoint marker", null);
    if (oldValue !== null) {
        // Local migrations sync once; applySetting() is the non-broadcast consume path.
        SeekbarWidget.setAndSync("showMidpointMark", !!oldValue);
    }
    window.SetProperty(migratedKey, true);
})();

// Playback controls

function runFirstMainMenuCommand(candidates, label) {
    return RivageCommands.runFirstMain(candidates, label, { panelTitle: "Top Bar" });
}

function openPreferences() {
    runFirstMainMenuCommand(["File/Preferences...", "File/Preferences"], "Preferences");
}

// JSplitter panel lookup is branch-local, so cross-branch visibility uses the shared host.
var SETTINGS_PANEL_CAPTION = "SETTINGS";

function toggleSettingsPanel() {
    try {
        window.NotifyOthers("RIVAGE.TOGGLE_PANEL_VISIBILITY", { caption: SETTINGS_PANEL_CAPTION });
    } catch (e) {
        // No listener loaded anywhere; nothing to do.
    }
}

function openSearch() {
    runFirstMainMenuCommand(["Library/Search...", "View/Search...", "Edit/Search...", "File/Search..."], "Search");
}

function openConsole() {
    runFirstMainMenuCommand(["View/Console", "View/Console...", "File/Console"], "Console");
}

// Buttons

// glyph/tooltip can be functions for state-dependent text such as Play/Pause.
function makeButton(options) {
    return {
        id: options.id,
        glyph: options.glyph || null,
        onClick: options.onClick || null,
        onRightClick: options.onRightClick || null,
        tooltip: options.tooltip || "",
        x: 0, y: 0, w: 0, h: 0, hover: false,
        contains: function (x, y) {
            return x >= this.x && y >= this.y && x < this.x + this.w && y < this.y + this.h;
        },
        setBounds: function (x, y, w, h) {
            this.x = Math.round(x); this.y = Math.round(y);
            this.w = Math.round(w); this.h = Math.round(h);
        }
    };
}

function playPauseGlyph() {
    return fb.IsPlaying && !fb.IsPaused ? RivageUI.icons.pause : RivageUI.icons.play;
}

var menuBtn = makeButton({ id: "menu", glyph: RivageUI.icons.menu, onClick: showMainMenu, tooltip: "Show foobar2000 menu" });
var prevBtn = makeButton({ id: "previous", glyph: RivageUI.icons.previous, onClick: function () { fb.Prev(); }, tooltip: "Previous track" });
// Match controls_panel.js: right-click Play/Pause selects a random track.
var playBtn = makeButton({
    id: "play",
    glyph: playPauseGlyph,
    onClick: function () { fb.PlayOrPause(); },
    onRightClick: function () { fb.Random(); },
    tooltip: function () {
        return (fb.IsPlaying && !fb.IsPaused ? "Pause" : "Play") + "\nRight-click: random track";
    }
});
var nextBtn = makeButton({ id: "next", glyph: RivageUI.icons.next, onClick: function () { fb.Next(); }, tooltip: "Next track" });
// Left-click opens foobar2000 preferences; right-click toggles the SETTINGS panel.
var settingsToggleBtn = makeButton({
    id: "settingsToggle", glyph: RivageUI.icons.preferences, onClick: openPreferences,
    onRightClick: function () { toggleSettingsPanel(); },
    tooltip: "Left-click: foobar2000 preferences\nRight-click: show/hide settings panel"
});
var allButtons = [menuBtn, prevBtn, playBtn, nextBtn, settingsToggleBtn];

function drawIconButton(gr, btn) {
    var colour = btn.hover ? theme.hover : theme.textTertiary;
    var glyph;
    if (btn.hover) {
        gr.FillRoundRect(btn.x, btn.y, btn.w, btn.h, _scale(3), _scale(3), blendColours(theme.background, theme.hover, 0.10));
    }
    glyph = typeof btn.glyph === "function" ? btn.glyph() : btn.glyph;
    if (glyph && fonts.icon) {
        gr.GdiDrawText(glyph, fonts.icon, btn.hover && (btn === prevBtn || btn === playBtn || btn === nextBtn) ? currentAccent() : colour,
            btn.x, btn.y, btn.w, btn.h,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

// Native tooltip popups can extend beyond this panel's client bounds.
var TOOLTIP_DELAY_MS = 500;
var g_tooltip = window.Tooltip;
g_tooltip.SetDelayTime(TTDT_INITIAL, TOOLTIP_DELAY_MS);
g_tooltip.SetMaxWidth(400);

var tooltipButton = null; // whichever button's text is currently loaded into g_tooltip, or null

function resolveTooltipText(btn) {
    if (!btn) return "";
    return typeof btn.tooltip === "function" ? (btn.tooltip() || "") : (btn.tooltip || "");
}

// Re-activating unchanged native tooltip text flickers, so preserve owner identity.
function scheduleTooltip(btn) {
    var text = resolveTooltipText(btn);

    if (!text) {
        hideTooltip();
        return;
    }

    if (btn === tooltipButton) {
        if (g_tooltip.Text !== text) g_tooltip.Text = text; // also live-updates the active popup
        return;
    }

    g_tooltip.Text = text;
    g_tooltip.Activate();
    tooltipButton = btn;
}

function hideTooltip() {
    if (!tooltipButton) return;
    tooltipButton = null;
    g_tooltip.Deactivate();
}

// Stable identity lets drag text update without re-activating the tooltip every frame.
var seekbarDragTooltip = { tooltip: function () { return seekbar.dragValueText(); } };

// Fonts

var fonts = {};

// Bar height and monitor DPI own geometry scaling; host font preferences only choose the face.
var REFERENCE_BAR_HEIGHT = 44;
var MIN_SIZE_SCALE = 0.72;
var MAX_SIZE_SCALE = 1.40;
var MIN_DPI_PERCENT = 50;
var MAX_DPI_PERCENT = 300;

var currentFontName = "Segoe UI";

function rebuildFontObjects() {
    RivageUI.clearFontCache();
    fonts.info = make_font(currentFontName, 13, 0);
    fonts.icon = make_font(iconFontName, 15, 0);
    // Native tooltips follow foobar2000's Console font, independently of top-bar text.
    try {
        var consoleFont = RivageUI.consoleFontInfo();
        g_tooltip.SetFont(consoleFont.fontFamily, consoleFont.fontSize, consoleFont.fontStyle || 0);
    } catch (e) {
        // Cosmetic only; the tooltip still works with its default font.
    }
    resetMarquee();
}

function updateDpiFromHeight() {
    var h = window.Height;
    if (h <= 0) return false;

    var dpiFactor = (Number(window.DPI) || 96) / 96;
    var sizeFactor = clampNumber(h / REFERENCE_BAR_HEIGHT, MIN_SIZE_SCALE, MAX_SIZE_SCALE);
    var nextDpi = clampNumber(Math.round(dpiFactor * sizeFactor * 100), MIN_DPI_PERCENT, MAX_DPI_PERCENT);

    if (nextDpi === g_dpi) return false;
    g_dpi = nextDpi;
    rebuildFontObjects();
    SeekbarWidget.setDpi(g_dpi);
    VolumeBarWidget.setDpi(g_dpi);
    return true;
}

function on_font_changed() {
    var next_font_name = RivageUI.hostFontFamily() || "Segoe UI";
    if (settings.fontOverride && fontAvailable(settings.fontOverride)) next_font_name = settings.fontOverride;

    currentFontName = next_font_name;
    if (!updateDpiFromHeight()) rebuildFontObjects();
    SeekbarWidget.refreshFont();
    layoutBar();
    window.Repaint(true);
}

// Layout

var layoutRects = { art: null, info: null, seek: null, volume: null, ctrls: null };

function layoutBar() {
    var pad, btnSize, gap, leadingGap, artSize, ctrlBtnSize, ctrlGap, ctrlsWidth;
    var slots, reservedFixed, flexWeightTotal, visibleCount, i, s, gapsCount, totalGapWidth;
    var leadingUsed, middleRight, middleWidth, requiredMin, dropIndex, available, curX, w, visible;
    var flexWidths, allocatedFlex, lastFlexIndex, remainingFlex;
    var coreRightWidth, rightClusterWidth, rightClusterX, coreX;

    ww = window.Width;
    wh = window.Height;
    if (ww <= 0 || wh <= 0) return;

    updateDpiFromHeight();

    pad = _scale(8);
    btnSize = Math.max(20, Math.min(wh - pad * 2, _scale(28)));
    gap = _scale(10);
    leadingGap = Math.round(gap * 1.6);

    menuBtn.setBounds(pad, (wh - btnSize) / 2, btnSize, btnSize);

    artSize = Math.max(18, wh - pad);
    ctrlBtnSize = Math.max(18, Math.min(wh - pad * 2, _scale(24)));
    ctrlGap = _scale(6);
    ctrlsWidth = ctrlBtnSize * 3 + ctrlGap * 2;

    coreRightWidth = settings.showCoreButtons ? btnSize : 0;
    rightClusterWidth = coreRightWidth;
    rightClusterX = ww - pad - rightClusterWidth;
    coreX = rightClusterX;

    if (settings.showCoreButtons) {
        settingsToggleBtn.setBounds(coreX, (wh - btnSize) / 2, btnSize, btnSize);
    } else {
        settingsToggleBtn.setBounds(-100, -100, 0, 0);
    }

    slots = [
        { key: "art", kind: "fixed", enabled: settings.enableAlbumArt, size: artSize },
        { key: "info", kind: "flex", enabled: settings.enableTrackInfo, nominal: _scale(220), weight: 1.2 },
        { key: "seek", kind: "flex", enabled: settings.enableSeekbar, nominal: _scale(240), weight: 1 },
        { key: "volume", kind: "flex", enabled: settings.enableVolumeBar, nominal: _scale(130), weight: 0.55 },
        { key: "ctrls", kind: "fixed", enabled: settings.enableControls, size: ctrlsWidth }
    ];

    leadingUsed = pad + btnSize + leadingGap;
    middleRight = settings.showCoreButtons ? rightClusterX - gap : ww - pad;
    middleWidth = Math.max(0, middleRight - leadingUsed);

    for (i = 0; i < slots.length; i++) {
        s = slots[i];
        s.active = s.enabled || settings.layoutMode === 1;
        s.minimum = s.kind === "fixed" ? s.size : (s.enabled ? 0 : s.nominal);
    }

    // At narrow widths, drop blank placeholders first, then flexible widgets, then
    // rightmost fixed widgets. No middle slot may cross the docked right boundary.
    while (true) {
        requiredMin = 0;
        visibleCount = 0;
        for (i = 0; i < slots.length; i++) {
            if (!slots[i].active) continue;
            requiredMin += slots[i].minimum;
            visibleCount++;
        }
        requiredMin += Math.max(0, visibleCount - 1) * gap;
        if (requiredMin <= middleWidth) break;

        dropIndex = -1;
        for (i = slots.length - 1; i >= 0; i--) {
            if (slots[i].active && !slots[i].enabled) { dropIndex = i; break; }
        }
        if (dropIndex < 0) {
            for (i = slots.length - 1; i >= 0; i--) {
                if (slots[i].active && slots[i].kind === "flex") { dropIndex = i; break; }
            }
        }
        if (dropIndex < 0) {
            for (i = slots.length - 1; i >= 0; i--) {
                if (slots[i].active) { dropIndex = i; break; }
            }
        }
        if (dropIndex < 0) break;
        slots[dropIndex].active = false;
    }

    reservedFixed = 0;
    flexWeightTotal = 0;
    visibleCount = 0;
    for (i = 0; i < slots.length; i++) {
        s = slots[i];
        if (!s.active) continue;
        visibleCount++;
        if (s.kind === "fixed") reservedFixed += s.size;
        else if (s.enabled) flexWeightTotal += s.weight;
        else reservedFixed += s.nominal;
    }

    gapsCount = Math.max(0, visibleCount - 1);
    totalGapWidth = gapsCount * gap;
    available = Math.max(0, middleWidth - reservedFixed - totalGapWidth);

    flexWidths = {};
    allocatedFlex = 0;
    lastFlexIndex = -1;
    for (i = 0; i < slots.length; i++) {
        s = slots[i];
        if (!s.active || s.kind !== "flex" || !s.enabled) continue;
        w = flexWeightTotal > 0 ? Math.round(available * (s.weight / flexWeightTotal)) : 0;
        flexWidths[i] = w;
        allocatedFlex += w;
        lastFlexIndex = i;
    }
    if (lastFlexIndex >= 0) {
        remainingFlex = available - allocatedFlex;
        flexWidths[lastFlexIndex] = Math.max(0, flexWidths[lastFlexIndex] + remainingFlex);
    }

    curX = leadingUsed;
    for (i = 0; i < slots.length; i++) {
        s = slots[i];
        w = 0;
        visible = false;
        if (!s.active) {
            layoutRects[s.key] = { x: curX, y: pad / 2, w: 0, h: wh - pad, visible: false };
            continue;
        }
        if (s.kind === "fixed") {
            if (s.enabled) { w = s.size; visible = true; }
            else if (settings.layoutMode === 1) { w = s.size; visible = false; }
        } else if (s.enabled) {
            w = flexWidths[i] || 0;
            visible = w > 0;
        } else if (settings.layoutMode === 1) {
            w = s.nominal;
            visible = false;
        }
        layoutRects[s.key] = { x: curX, y: pad / 2, w: w, h: wh - pad, visible: visible };
        curX += w;
        if (--visibleCount > 0) curX += gap;
    }

    if (layoutRects.ctrls.visible) {
        prevBtn.setBounds(layoutRects.ctrls.x, (wh - ctrlBtnSize) / 2, ctrlBtnSize, ctrlBtnSize);
        playBtn.setBounds(layoutRects.ctrls.x + ctrlBtnSize + ctrlGap, (wh - ctrlBtnSize) / 2, ctrlBtnSize, ctrlBtnSize);
        nextBtn.setBounds(layoutRects.ctrls.x + (ctrlBtnSize + ctrlGap) * 2, (wh - ctrlBtnSize) / 2, ctrlBtnSize, ctrlBtnSize);
    } else {
        prevBtn.setBounds(-100, -100, 0, 0);
        playBtn.setBounds(-100, -100, 0, 0);
        nextBtn.setBounds(-100, -100, 0, 0);
    }

    rebuildArtRender();
    prepareMarquee();
}

// Painting

function on_paint(gr) {
    var i, btn, smoothingChanged = false;
    startMarqueeTimer();

    // GDI+'s default smoothing leaves rounded controls visibly jagged.
    if (typeof gr.SetSmoothingMode === "function") {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    gr.FillSolidRect(0, 0, ww, wh, theme.background);

    if (layoutRects.art && layoutRects.art.visible) drawArt(gr, layoutRects.art);
    if (layoutRects.info && layoutRects.info.visible) drawTrackInfo(gr, layoutRects.info);
    if (layoutRects.seek && layoutRects.seek.visible) seekbar.draw(gr, layoutRects.seek, currentAccent());
    if (layoutRects.volume && layoutRects.volume.visible) volumeBar.draw(gr, layoutRects.volume, currentAccent());

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        if (btn.w > 0) drawIconButton(gr, btn);
    }

    if (smoothingChanged) {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
        } catch (e) {
            // Ignore graphics-state restoration failures.
        }
    }
}

// Menus

function showMainMenu() {
    var basemenu = window.CreatePopupMenu();
    var contextman = fb.CreateContextMenuManager();
    var child = [
        window.CreatePopupMenu(), window.CreatePopupMenu(), window.CreatePopupMenu(),
        window.CreatePopupMenu(), window.CreatePopupMenu(), window.CreatePopupMenu(),
        window.CreatePopupMenu()
    ];
    var manager = [
        fb.CreateMainMenuManager(), fb.CreateMainMenuManager(), fb.CreateMainMenuManager(),
        fb.CreateMainMenuManager(), fb.CreateMainMenuManager(), fb.CreateMainMenuManager()
    ];
    var ret;

    child[0].AppendTo(basemenu, MF_STRING, "File");
    child[1].AppendTo(basemenu, MF_STRING, "Edit");
    child[2].AppendTo(basemenu, MF_STRING, "View");
    child[3].AppendTo(basemenu, MF_STRING, "Playback");
    child[4].AppendTo(basemenu, MF_STRING, "Library");
    child[5].AppendTo(basemenu, MF_STRING, "Help");
    basemenu.AppendMenuSeparator();
    child[6].AppendTo(basemenu, MF_STRING, "Now Playing");

    manager[0].Init("file");
    manager[1].Init("edit");
    manager[2].Init("view");
    manager[3].Init("playback");
    manager[4].Init("library");
    manager[5].Init("help");

    manager[0].BuildMenu(child[0], 1, 200);
    manager[1].BuildMenu(child[1], 201, 200);
    manager[2].BuildMenu(child[2], 401, 200);
    manager[3].BuildMenu(child[3], 601, 300);
    manager[4].BuildMenu(child[4], 901, 300);
    manager[5].BuildMenu(child[5], 1201, 100);

    contextman.InitNowPlaying();
    contextman.BuildMenu(child[6], 1301);

    ret = basemenu.TrackPopupMenu(menuBtn.x, menuBtn.y + menuBtn.h);

    if (ret >= 1 && ret < 201) manager[0].ExecuteByID(ret - 1);
    else if (ret >= 201 && ret < 401) manager[1].ExecuteByID(ret - 201);
    else if (ret >= 401 && ret < 601) manager[2].ExecuteByID(ret - 401);
    else if (ret >= 601 && ret < 901) manager[3].ExecuteByID(ret - 601);
    else if (ret >= 901 && ret < 1201) manager[4].ExecuteByID(ret - 901);
    else if (ret >= 1201 && ret < 1301) manager[5].ExecuteByID(ret - 1201);
    else if (ret >= 1301) contextman.ExecuteByID(ret - 1301);
}

var MENU_ID = {
    toggleArt: 1, toggleInfo: 2, toggleSeek: 3, toggleControls: 4, toggleVolume: 5,
    toggleCoreButtons: 6,
    layoutReclaim: 10, layoutGap: 11,
    accentFixed: 20, accentShared: 21,
    preferences: 30, search: 31, console: 32, configure: 33
};

// Right-click-dragging the seekbar always adjusts volume (SeekbarWidget's
// combined mode - see shared/seekbar_widget.js), regardless of whether the
// bar is currently in "seek" or "volume" mode. Started here on button-down so
// on_mouse_move can update it continuously like a real slider; committed/
// released in on_mouse_rbtn_up below, which swallows the click so it doesn't
// also fall through to the panel context menu.
function on_mouse_rbtn_down(x, y, mask) {
    // Mirror on_mouse_rbtn_up's own shift-modifier passthrough below, so a
    // shift-held right-click over the seekbar doesn't start a volume drag
    // either.
    if ((mask & MK_SHIFT) !== 0) return false;
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    if (seekbar.onRightMouseDown(seekOuter, x, y)) {
        // Show the drag-value tooltip immediately on press, not only once the
        // mouse actually moves.
        scheduleTooltip(seekbarDragTooltip);
        window.Repaint();
        return true;
    }
    return false;
}

function on_mouse_rbtn_up(x, y, mask) {
    var menu, layoutMenu, accentMenu, id, i, btn;
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;

    // Release a right-drag volume adjustment before anything else - this is the
    // counterpart to on_mouse_rbtn_down above and must win over the context-menu
    // fallback below so right-clicking the seekbar never also opens the menu.
    if (seekbar.onRightMouseUp(seekOuter, x, y)) {
        // Drop the drag-value tooltip immediately rather than waiting for the
        // next mouse-move to notice dragValueText() has gone back to "".
        if (tooltipButton === seekbarDragTooltip) hideTooltip();
        window.Repaint(true);
        return true;
    }

    if ((mask & MK_SHIFT) !== 0) return false;

    hideTooltip();

    // Per-button right-click actions take precedence over the panel menu.
    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        if (btn.w > 0 && btn.contains(x, y) && typeof btn.onRightClick === "function") {
            btn.onRightClick(x, y);
            window.Repaint(true);
            return true;
        }
    }

    menu = window.CreatePopupMenu();
    layoutMenu = window.CreatePopupMenu();
    accentMenu = window.CreatePopupMenu();

    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleArt, "Show album artwork");
    menu.CheckMenuItem(MENU_ID.toggleArt, settings.enableAlbumArt);
    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleInfo, "Show track information");
    menu.CheckMenuItem(MENU_ID.toggleInfo, settings.enableTrackInfo);
    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleSeek, "Show seekbar");
    menu.CheckMenuItem(MENU_ID.toggleSeek, settings.enableSeekbar);
    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleVolume, "Show volume bar");
    menu.CheckMenuItem(MENU_ID.toggleVolume, settings.enableVolumeBar);
    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleControls, "Show playback controls");
    menu.CheckMenuItem(MENU_ID.toggleControls, settings.enableControls);
    // Kept as its own toggle rather than folded into "Show playback controls"
    // above - the preferences button is an independent, permanently right-
    // docked element (see settings.showCoreButtons's own comment), not part
    // of the prev/play/next cluster that setting controls.
    menu.AppendMenuItem(MF_STRING, MENU_ID.toggleCoreButtons, "Show preferences button");
    menu.CheckMenuItem(MENU_ID.toggleCoreButtons, settings.showCoreButtons);
    menu.AppendMenuSeparator();

    layoutMenu.AppendMenuItem(MF_STRING, MENU_ID.layoutReclaim, "Reclaim space");
    layoutMenu.AppendMenuItem(MF_STRING, MENU_ID.layoutGap, "Keep empty space");
    layoutMenu.CheckMenuRadioItem(MENU_ID.layoutReclaim, MENU_ID.layoutGap,
        settings.layoutMode === 1 ? MENU_ID.layoutGap : MENU_ID.layoutReclaim);
    layoutMenu.AppendTo(menu, MF_STRING, "Hidden widget space");

    accentMenu.AppendMenuItem(MF_STRING, MENU_ID.accentFixed, RivageUI.copy.labels.rvgBlue);
    accentMenu.AppendMenuItem(MF_STRING, MENU_ID.accentShared, RivageUI.copy.labels.sharedAccent);
    accentMenu.CheckMenuRadioItem(MENU_ID.accentFixed, MENU_ID.accentShared,
        settings.accentMode === 1 ? MENU_ID.accentShared : MENU_ID.accentFixed);
    accentMenu.AppendTo(menu, MF_STRING, "Accent colour");

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.preferences, "foobar2000 preferences…");
    menu.AppendMenuItem(MF_STRING, MENU_ID.search, "Search…");
    menu.AppendMenuItem(MF_STRING, MENU_ID.console, "Console");
    menu.AppendMenuItem(MF_STRING, MENU_ID.configure, RivageUI.copy.labels.panelConfiguration);

    id = menu.TrackPopupMenu(x, y);

    switch (id) {
    case MENU_ID.toggleArt: applyMySetting("enableAlbumArt", !settings.enableAlbumArt); break;
    case MENU_ID.toggleInfo: applyMySetting("enableTrackInfo", !settings.enableTrackInfo); break;
    case MENU_ID.toggleSeek: applyMySetting("enableSeekbar", !settings.enableSeekbar); break;
    case MENU_ID.toggleVolume: applyMySetting("enableVolumeBar", !settings.enableVolumeBar); break;
    case MENU_ID.toggleControls: applyMySetting("enableControls", !settings.enableControls); break;
    case MENU_ID.toggleCoreButtons: applyMySetting("showCoreButtons", !settings.showCoreButtons); break;
    case MENU_ID.layoutReclaim: applyMySetting("layoutMode", "reclaim"); break;
    case MENU_ID.layoutGap: applyMySetting("layoutMode", "gap"); break;
    case MENU_ID.accentFixed: applyMySetting("accentMode", "fixed"); break;
    case MENU_ID.accentShared: applyMySetting("accentMode", "shared"); break;
    case MENU_ID.preferences: openPreferences(); break;
    case MENU_ID.search: openSearch(); break;
    case MENU_ID.console: openConsole(); break;
    case MENU_ID.configure: window.ShowConfigureV2(); break;
    }

    return true;
}

// Mouse handling

var lastCursorId = null;
function setPanelCursor(cursorId) {
    if (cursorId === lastCursorId) return;
    lastCursorId = cursorId;
    window.SetCursor(cursorId);
}

function on_mouse_move(x, y, mask) {
    var i, btn, changed = false, hoverNow, hoveredBtn = null;
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var volumeOuter = (layoutRects.volume && layoutRects.volume.visible) ? layoutRects.volume : null;
    var seekResult, volumeResult, dragText;

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        hoverNow = btn.w > 0 && btn.contains(x, y);
        if (hoverNow !== btn.hover) { btn.hover = hoverNow; changed = true; }
        if (btn.hover) hoveredBtn = btn;
    }

    seekResult = seekbar.onMouseMove(seekOuter, x, y);
    if (seekResult.changed) changed = true;
    volumeResult = volumeBar.onMouseMove(volumeOuter, x, y);
    if (volumeResult.changed) changed = true;

    // A seekbar drag in progress (left-drag in either mode, or a right-drag -
    // see SeekbarWidget's combined mode) always wins the tooltip over whatever
    // button happens to be under the cursor - read after onMouseMove above so
    // it reflects this move's freshly-updated drag position, not last frame's.
    dragText = seekbar.dragValueText();
    if (dragText) {
        scheduleTooltip(seekbarDragTooltip);
    } else if (hoveredBtn !== tooltipButton) {
        scheduleTooltip(hoveredBtn);
    }

    setPanelCursor((seekResult.hot || volumeResult.hot || hoveredBtn !== null) ? IDC_HAND : IDC_ARROW);
    if (changed) window.Repaint();
}

function on_mouse_leave() {
    var i, changed = false;
    for (i = 0; i < allButtons.length; i++) {
        if (allButtons[i].hover) { allButtons[i].hover = false; changed = true; }
    }
    if (seekbar.onMouseLeave()) changed = true;
    if (volumeBar.onMouseLeave()) changed = true;
    hideTooltip();
    setPanelCursor(IDC_ARROW);
    if (changed) window.Repaint();
}

function on_mouse_lbtn_down(x, y) {
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var volumeOuter = (layoutRects.volume && layoutRects.volume.visible) ? layoutRects.volume : null;
    if (volumeBar.onMouseDown(volumeOuter, x, y)) {
        window.Repaint();
        return true;
    }
    if (seekbar.onMouseDown(seekOuter, x, y)) {
        // Show the drag-value tooltip immediately on press, not only once the
        // mouse actually moves.
        scheduleTooltip(seekbarDragTooltip);
        window.Repaint();
        return true;
    }
    return false;
}

function on_mouse_lbtn_up(x, y) {
    var i, btn;
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var volumeOuter = (layoutRects.volume && layoutRects.volume.visible) ? layoutRects.volume : null;

    // Release the volume drag first. This prevents a volume drag ending over the seekbar's
    // end-time label from also toggling total/remaining time on the same mouse-up.
    if (volumeBar.onMouseUp(volumeOuter, x, y)) {
        window.Repaint(true);
        return true;
    }

    // Handles both a drag release that commits a seek, and a tap on the end-time label
    // toggling total/remaining display - either way this counts as "handled" and nothing
    // else on the bar should also react to the same click.
    if (seekbar.onMouseUp(seekOuter, x, y)) {
        // Drop the drag-value tooltip immediately rather than waiting for the
        // next mouse-move to notice dragValueText() has gone back to "".
        if (tooltipButton === seekbarDragTooltip) hideTooltip();
        window.Repaint(true);
        return true;
    }

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        if (btn.w > 0 && btn.contains(x, y)) {
            hideTooltip();
            if (typeof btn.onClick === "function") btn.onClick();
            window.Repaint(true);
            return true;
        }
    }
    return false;
}

// Middle-click flips the shared combined seekbar between seek and volume mode.
function on_mouse_mbtn_up(x, y) {
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    if (seekbar.onMiddleClick(seekOuter, x, y)) {
        window.Repaint(true);
        return true;
    }
    return false;
}

// Host callbacks

function on_size(width, height) {
    layoutBar();
}

function on_colours_changed() {
    refreshHostColours();
    prepareMarquee();
    window.Repaint(true);
}

function on_playback_new_track(metadb) {
    handle = metadb;
    trackKey = getHandleKey(handle);
    refreshCache();
    // Keep text/layout immediate, but avoid decoding artwork for transient
    // foo_skip candidates. The previous cover remains visible while settling.
    scheduleArtRefresh();
    resetMarquee();
    layoutBar();
    window.Repaint();
}

function on_playback_dynamic_info_track() {
    // Radio/stream metadata can advance to a new song without changing the
    // underlying metadb path, so treat it as an artwork change as well.
    handle = fb.GetNowPlaying();
    trackKey = getHandleKey(handle);
    refreshCache();
    scheduleArtRefresh();
    resetMarquee();
    layoutBar();
    window.Repaint();
}

function on_playback_stop(reason) {
    cancelScheduledArtRefresh(true);
    if (reason === PlaybackStopReason.starting_another) return;

    handle = null;
    trackKey = "";
    refreshCache();
    artImage = null;
    artKey = "";
    clearArtRender();
    resetMarquee();
    layoutBar();
    window.Repaint();
}

function on_playback_pause(state) {
    window.Repaint(true);
}

function on_playback_seek(time) {
    window.Repaint();
}

function on_volume_change(value) {
    if (settings.enableVolumeBar && layoutRects.volume && layoutRects.volume.visible) {
        try {
            window.RepaintRect(layoutRects.volume.x, layoutRects.volume.y, layoutRects.volume.w, layoutRects.volume.h);
        } catch (e) {
            window.Repaint();
        }
    }
    // The seekbar can also be showing volume right now (SeekbarWidget's combined
    // mode, or an in-progress right-drag) - keep it live for changes that don't
    // originate from dragging it directly (system volume keys, another panel's
    // volume control, etc).
    if (settings.enableSeekbar && layoutRects.seek && layoutRects.seek.visible &&
        (seekbar.mode === "volume" || seekbar.rdrag)) {
        try {
            window.RepaintRect(layoutRects.seek.x, layoutRects.seek.y, layoutRects.seek.w, layoutRects.seek.h);
        } catch (e) {
            window.Repaint();
        }
    }
}

var seekTickTimer = window.SetInterval(function () {
    // Defensive: if this panel is reloading/unloading, a tick that was
    // already queued can still fire once against the old, now-dead window
    // object ("can't access dead object"). on_script_unload below clears the
    // timer on a clean unload; this guards the narrow gap where one last
    // tick slips through anyway.
    try {
        if (SKIP_WORK_WHEN_HIDDEN && !window.IsVisible) return;
        if (layoutRects.seek && layoutRects.seek.visible && fb.IsPlaying && !fb.IsPaused && !seekbar.drag && !seekbar.rdrag) {
            window.RepaintRect(layoutRects.seek.x, layoutRects.seek.y, layoutRects.seek.w, layoutRects.seek.h);
        }
    } catch (e) {
        // Panel is gone; nothing to repaint.
    }
}, 250);

function on_script_unload() {
    if (seekTickTimer) { window.ClearInterval(seekTickTimer); seekTickTimer = null; }
    cancelScheduledArtRefresh(true);
    hideTooltip();
    resetMarquee();
    clearArtRender();
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    // Schema requests are broadcasts, so both provider calls must run before returning.
    var provided = false;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) provided = true;
    if (SettingsRegistry.provide(name, info, SeekbarWidget.PANEL_ID, SeekbarWidget.PANEL_LABEL, SeekbarWidget.getSchema)) provided = true;
    if (provided) return;

    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (SettingsRegistry.consume(name, info, SeekbarWidget.PANEL_ID, SeekbarWidget.applySetting)) return;
    if (SeekbarWidget.onNotifyData(name, info)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (settings.accentMode === 1) {
            refreshHostColours();
            window.Repaint(true);
        }
    }
}

// Initial state

refreshHostColours();
on_font_changed();
handle = fb.IsPlaying ? fb.GetNowPlaying() : null;
trackKey = getHandleKey(handle);
refreshCache();
on_size(window.Width, window.Height);
refreshArt();
SharedAccentProtocol.request();
SeekbarWidget.requestSync();
