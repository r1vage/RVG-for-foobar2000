window.DrawMode = 0;

// Compact "Mini Player" view.
//
// This panel sits alongside "Top bar"/"BODY"/"TOP BUTTONS" under the root
// splitter and is normally hidden. splitters/root_splitter.js shows it full-
// size (and hides everything else) while Mini Player mode is active, and
// also owns shrinking/restoring the actual main foobar2000 window - see
// MINI_PLAYER_SETUP.md for the one-time layout step this panel needs, and
// shared/miniplayer_protocol.js for how the two sides talk to each other.
//
// This panel only draws the compact transport and asks the root splitter to
// enter/exit the mode; it holds no window-geometry logic of its own.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\foobar_actions.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\seekbar_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\marquee_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\miniplayer_protocol.js");

window.DefineScript(RivageUI.copy.popupTitle("Mini Player"), {
    author: "RivaGe",
    version: "1.2.0",
    features: { drag_n_drop: false, grab_focus: false }
});

window.EraseOnRepaint = false;

// Host constants

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;

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
var DEFAULT_UWP_ACCENT = 0xff0078d4;

function RGB(r, g, b) {
    return RivageUI.rgb(r, g, b);
}

function blendColours(first, second, amount) {
    return RivageUI.mix(first, second, amount);
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
}

function panelIsVisible() {
    try {
        var visible = window.IsVisible;
        if (typeof visible === "function") visible = visible.call(window);
        if (typeof visible === "undefined" || visible === null) return true;
        return !!visible;
    } catch (e) {
        return true;
    }
}

var scriptActive = true;
// Global settings are persisted by tab-switcher-right.js and delivered to
// this read-only consumer over shared/miniplayer_protocol.js.
var miniPlayerSettings = MiniPlayerProtocol.defaultSettings();

var g_dpi = 100;
function _scale(value) {
    return Math.round(value * g_dpi / 100);
}

function make_font(name, size, style) {
    return RivageUI.font(name || "Segoe UI", _scale(size), style);
}

// Theme - always follows the shared album-art accent; this panel is too
// small to carry its own settings screen for a fixed/shared accent choice.

var theme = {
    background: RGB(30, 30, 30), // fallback only - overwritten by refreshHostColours() below
    track: RGB(58, 58, 58),
    text: RGB(246, 246, 246),
    textTertiary: RGB(151, 151, 156),
    hover: RGB(255, 255, 255)
};

var sharedAlbumAccent = DEFAULT_UWP_ACCENT;
function currentAccent() {
    return sharedAlbumAccent;
}

function refreshHostColours() {
    var resolved = RivageUI.createTheme({ mode: "host", accent: currentAccent() });
    theme.background = resolved.background;
    theme.track = resolved.surface;
    theme.text = resolved.textPrimary;
    theme.textTertiary = resolved.textTertiary;
    theme.hover = resolved.accentHover;
}

var iconFontName = RivageUI.iconFontFamily();

// Fonts / DPI - scaled off this panel's own (small) height, not a bar height.

var fonts = {};

var REFERENCE_HEIGHT = 120;
var MIN_SIZE_SCALE = 0.6;
var MAX_SIZE_SCALE = 2.5;
var MIN_DPI_PERCENT = 50;
var MAX_DPI_PERCENT = 300;

function rebuildFontObjects() {
    var infoFontName = RivageUI.hostFontFamily() || "Segoe UI";
    RivageUI.clearFontCache();
    fonts.info = make_font(infoFontName, 12, 0);
    fonts.icon = make_font(iconFontName, 13, 0);
    fonts.rating = make_font(iconFontName, 12, 0);
    resetMarquee();
}

function updateDpiFromHeight() {
    var h = window.Height;
    if (h <= 0) return false;

    var dpiFactor = (Number(window.DPI) || 96) / 96;
    var sizeFactor = clampNumber(h / REFERENCE_HEIGHT, MIN_SIZE_SCALE, MAX_SIZE_SCALE);
    var nextDpi = clampNumber(Math.round(dpiFactor * sizeFactor * 100), MIN_DPI_PERCENT, MAX_DPI_PERCENT);

    if (nextDpi === g_dpi) return false;
    g_dpi = nextDpi;
    rebuildFontObjects();
    SeekbarWidget.setDpi(g_dpi);
    return true;
}

function on_font_changed() {
    if (!updateDpiFromHeight()) rebuildFontObjects();
    SeekbarWidget.refreshFont();
    layout();
    window.Repaint(true);
}

// Playback / track state

var handle = null;
var trackKey = "";

var tfo = {
    title: fb.TitleFormat("%title%"),
    artist: fb.TitleFormat("%artist%"),
    ratingPlaybackStatistics: fb.TitleFormat("%rating%"),
    ratingPlaycount2003: fb.TitleFormat("%2003_rating%")
};

var cache = { text: "", loved: false, rating: 0 };
var metadataRefreshTimers = Object.create(null);

function getHandleKey(h) {
    if (!h) return "";
    try {
        return h.Path + "|" + h.SubSong;
    } catch (e) {
        return "";
    }
}

function handleListContainsTrack(handleList, key) {
    var count = 0, i, item = null;
    if (!handleList || !key) return false;
    if (getHandleKey(handleList) === key) return true;

    try { count = Number(handleList.Count) || 0; } catch (e) { count = 0; }
    for (i = 0; i < count; i++) {
        item = null;
        try { item = handleList[i]; } catch (e2) { }
        if (!item) {
            try { item = handleList.Item(i); } catch (e3) { }
        }
        if (getHandleKey(item) === key) return true;
    }
    return false;
}

function parseRating(value) {
    var parsed = parseInt(String(value || "0"), 10);
    return isFinite(parsed) ? Math.round(clampNumber(parsed, 0, 5)) : 0;
}

function evaluateWithHandle(formatter) {
    if (!formatter || !handle) return "";
    try {
        return fb.IsPlaying ? formatter.Eval() : formatter.EvalWithMetadb(handle);
    } catch (e) {
        try { return formatter.EvalWithMetadb(handle); } catch (e2) { return ""; }
    }
}

function refreshCache() {
    var title, artist, ratingFormatter;
    if (!handle) {
        cache.text = "Not playing";
        cache.loved = false;
        cache.rating = 0;
        return;
    }

    title = evaluateWithHandle(tfo.title);
    artist = evaluateWithHandle(tfo.artist);
    cache.text = artist ? (title + "  \u2014  " + artist) : (title || "Unknown title");
    cache.loved = RivageCommands.evaluateLoved(handle);
    ratingFormatter = PlaybackStatsSource.isPlaycount2003()
        ? tfo.ratingPlaycount2003 : tfo.ratingPlaybackStatistics;
    cache.rating = parseRating(evaluateWithHandle(ratingFormatter));
}

function clearMetadataRefreshTimer(kind) {
    var key = String(kind || "default");
    var timer = metadataRefreshTimers[key];
    if (timer === undefined) return;
    try { window.ClearTimeout(timer); } catch (e) { }
    delete metadataRefreshTimers[key];
}

function clearMetadataRefreshTimers() {
    var key;
    for (key in metadataRefreshTimers) {
        if (Object.prototype.hasOwnProperty.call(metadataRefreshTimers, key)) {
            clearMetadataRefreshTimer(key);
        }
    }
}

function scheduleMetadataRefresh(kind, delay, expectedTrackKey) {
    var timerKey = String(kind || "default");
    var refreshKey = expectedTrackKey === undefined ? trackKey : String(expectedTrackKey || "");
    clearMetadataRefreshTimer(timerKey);
    try {
        metadataRefreshTimers[timerKey] = window.SetTimeout(function () {
            delete metadataRefreshTimers[timerKey];
            if (!scriptActive || refreshKey !== trackKey) return;
            refreshCache();
            resetMarquee();
            layout();
            window.Repaint(true);
        }, Math.max(0, Number(delay) || 0));
    } catch (e) {
        delete metadataRefreshTimers[timerKey];
    }
}

function ratingStorageName() {
    return PlaybackStatsSource.isPlaycount2003() ? "Playcount 2003" : "Playback Statistics";
}

function setRating(value) {
    var nextValue, command, ok, target, targetKey;
    if (!handle) return;

    target = handle;
    targetKey = getHandleKey(target);
    nextValue = Math.round(clampNumber(value, 0, 5));
    try {
        if (PlaybackStatsSource.isPlaycount2003()) {
            command = nextValue
                ? "Playcount 2003/Rating/Set Rating to " + nextValue
                : "Playcount 2003/Rating/Clear";
        } else {
            command = nextValue
                ? "Playback Statistics/Rating/" + nextValue
                : "Playback Statistics/Rating/<not set>";
        }

        ok = fb.RunContextCommandWithMetadb(command, new FbMetadbHandleList(target), 8);
        if (!ok) throw new Error(ratingStorageName() + " did not expose the rating command.");

        // Optimistic feedback; the component's title-format field remains
        // authoritative and is re-read after it has had time to persist.
        if (targetKey === trackKey) {
            cache.rating = nextValue;
            window.Repaint(true);
            scheduleMetadataRefresh("rating", 120, targetKey);
        }
    } catch (e) {
        fb.ShowPopupMessage(
            "Could not set the rating using " + ratingStorageName() + ".\n\n" + (e.message || e),
            RivageUI.copy.popupTitle("Mini Player")
        );
    }
}

function toggleLoved() {
    var result, targetKey;
    if (!handle) return;

    result = RivageCommands.toggleLoved(handle, { panelTitle: RivageUI.copy.popupTitle("Mini Player") });
    if (!result.ok) return;

    targetKey = getHandleKey(result.metadb);
    if (targetKey === trackKey) {
        cache.loved = result.loved;
        window.Repaint(true);
        // Last.fm Playcount Sync updates its title-format fields asynchronously.
        scheduleMetadataRefresh("love", 500, targetKey);
    }
}

// Album art thumbnail - same fetch/scale-to-cover approach as topbar_panel.js.

var artImage = null;
var artKey = "";
var artGeneration = 0;
var artSettleTimer = null;
var artRefreshPending = false;
var ART_SETTLE_DELAY = 200;
var artRenderImage = null;
var artRenderKey = "";
var artRenderW = 0;
var artRenderH = 0;

function cancelScheduledArtRefresh(invalidatePending) {
    if (artSettleTimer !== null) {
        try { window.ClearTimeout(artSettleTimer); } catch (e) { }
        artSettleTimer = null;
    }
    if (invalidatePending) artGeneration++;
}

function startPendingArtRefresh() {
    if (!scriptActive || !artRefreshPending || artSettleTimer !== null || !panelIsVisible()) return;

    try {
        artSettleTimer = window.SetTimeout(function () {
            artSettleTimer = null;
            if (!scriptActive || !artRefreshPending || !panelIsVisible()) return;
            artRefreshPending = false;
            refreshArt(true);
        }, ART_SETTLE_DELAY);
    } catch (e) {
        artSettleTimer = null;
    }
}

function scheduleArtRefresh() {
    var changedTrack = !!handle && trackKey !== artKey;

    // Hidden Mini Player instances receive playback callbacks too. Remember the
    // newest request, but do not decode/scale artwork until the panel is shown.
    cancelScheduledArtRefresh(true);
    // Do not flash the previous track's decoded cover on the first visible
    // paint while the new lookup is still inside its short settle window.
    // Same-key stream metadata refreshes deliberately retain the current image
    // until its replacement arrives.
    if (changedTrack) {
        artImage = null;
        artKey = "";
        clearArtRender();
    }
    artRefreshPending = !!handle;
    if (!handle) {
        refreshArt(true);
        return;
    }
    startPendingArtRefresh();
}

function clearArtRender() {
    artRenderImage = null;
    artRenderKey = "";
    artRenderW = 0;
    artRenderH = 0;
}

function refreshArt(force) {
    var generation;
    force = !!force;
    artRefreshPending = false;

    if (!handle) {
        artGeneration++;
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

    artImage = (result && result.image) ? result.image : RivageUI.placeholderArt();
    if (!artImage || Number(artImage.Width) <= 0 || Number(artImage.Height) <= 0) {
        artImage = null;
    }
    clearArtRender();

    // The image result is useful to keep, but building a scaled GDI surface for
    // a panel hidden 99% of the time is not. drawArt() rebuilds it on demand.
    if (!panelIsVisible()) return;

    rebuildArtRender();
    if (layoutRects.art) {
        window.RepaintRect(layoutRects.art.x, layoutRects.art.y, layoutRects.art.w, layoutRects.art.h, true);
    } else {
        window.Repaint(true);
    }
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

// Track info marquee - single "Title  \u2014  Artist" line, same as Top Bar.

var marqueePrepared = false;
var titleMarquee = MarqueeWidget.create({
    interval: 33,
    speed: 34,
    pause: 1400,
    gap: 40,
    isVisible: panelIsVisible,
    skipWorkWhenHidden: true,
    stopTimerWhenHidden: true,
    onTick: function () {
        if (layoutRects.info) {
            window.RepaintRect(layoutRects.info.x, layoutRects.info.y, layoutRects.info.w, layoutRects.info.h);
        }
    }
});

function resetMarquee() {
    titleMarquee.reset();
    marqueePrepared = false;
}

function startMarqueeTimer() {
    titleMarquee.startTimer();
}

function measureTextWidth(text, font) {
    return RivageUI.measureText(text, font, true);
}

function prepareMarquee() {
    var rect = layoutRects.info;

    if (!rect || !rect.visible || !cache.text || !fonts.info || rect.w <= 0) {
        titleMarquee.reset();
        marqueePrepared = true;
        return;
    }

    titleMarquee.prepare(cache.text, fonts.info, rect, {
        measureText: measureTextWidth,
        scale: _scale,
        textColour: theme.text,
        textY: function (imageHeight) { return Math.max(0, Math.round((imageHeight - _scale(15)) / 2)); },
        textRenderingHint: TEXT_RENDERING_HINT_ANTIALIAS
    });
    marqueePrepared = true;
}

function drawTrackInfo(gr, rect) {
    if (!titleMarquee.draw(gr, rect)) {
        gr.GdiDrawText(cache.text, fonts.info, theme.text, rect.x, rect.y, rect.w, rect.h,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    }
}

// Seekbar - shared appearance/state, same widget Top Bar and Controls use.
// Mini Player owns only whether its 50% marker is visible; marker style,
// colours, font, timing mode and thickness still follow shared Seekbar settings.

var seekbar = SeekbarWidget.create({
    showMidpointMark: function () { return miniPlayerSettings.showMidpointMark; }
});

function applySeekbarSetting(settingId, value) {
    SeekbarWidget.applySetting(settingId, value);
    layout();
}

function adoptMiniPlayerSettings(settings) {
    var next = MiniPlayerProtocol.normaliseSettings(settings, miniPlayerSettings);
    var changed = next.lockWindowSize !== miniPlayerSettings.lockWindowSize ||
        next.alwaysOnTop !== miniPlayerSettings.alwaysOnTop ||
        next.showLoveButton !== miniPlayerSettings.showLoveButton ||
        next.showRating !== miniPlayerSettings.showRating ||
        next.showMidpointMark !== miniPlayerSettings.showMidpointMark;

    miniPlayerSettings = next;
    if (!changed) return;

    if (!miniPlayerSettings.showRating) {
        ratingHover = 0;
        ratingPressed = 0;
    }
    if (!miniPlayerSettings.showLoveButton && pressedButton === loveBtn) {
        pressedButton = null;
        loveBtn.pressed = false;
        loveBtn.hover = false;
    }
    layout();
    window.Repaint(true);
}

// Buttons / rating stars

function isPointInRect(rect, x, y) {
    return !!rect && rect.visible &&
        x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function makeButton(options) {
    return {
        id: options.id,
        glyph: options.glyph || null,
        onClick: options.onClick || null,
        enabled: options.enabled,
        active: options.active,
        x: 0, y: 0, w: 0, h: 0, hover: false, pressed: false,
        contains: function (x, y) {
            return x >= this.x && y >= this.y && x < this.x + this.w && y < this.y + this.h;
        },
        isEnabled: function () {
            if (typeof this.enabled === "function") {
                try { return !!this.enabled(); } catch (e) { return false; }
            }
            return this.enabled !== false;
        },
        isActive: function () {
            if (typeof this.active === "function") {
                try { return !!this.active(); } catch (e) { return false; }
            }
            return !!this.active;
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

// Segoe Fluent Icons/MDL2 "BackToWindow" - reads as a window shrinking back
// down, which is exactly what this control does.
var EXIT_GLYPH = "\uE73F";

var prevBtn = makeButton({ id: "previous", glyph: RivageUI.icons.previous, onClick: function () { fb.Prev(); } });
var playBtn = makeButton({ id: "play", glyph: playPauseGlyph, onClick: function () { fb.PlayOrPause(); } });
var nextBtn = makeButton({ id: "next", glyph: RivageUI.icons.next, onClick: function () { fb.Next(); } });
var loveBtn = makeButton({
    id: "love",
    glyph: function () { return cache.loved ? RivageUI.icons.heartFill : RivageUI.icons.heart; },
    enabled: function () { return !!handle; },
    active: function () { return cache.loved; },
    onClick: toggleLoved
});
var exitBtn = makeButton({ id: "exit", glyph: EXIT_GLYPH, onClick: function () { MiniPlayerProtocol.requestExit(); } });
var allButtons = [prevBtn, playBtn, nextBtn, loveBtn, exitBtn];
var pressedButton = null;
var artPressed = false;
var ratingHover = 0;
var ratingPressed = 0;

function hideButton(button) {
    button.setBounds(-100, -100, 0, 0);
    button.hover = false;
    button.pressed = false;
}

function buttonAt(x, y) {
    var i, btn;
    for (i = allButtons.length - 1; i >= 0; i--) {
        btn = allButtons[i];
        if (btn.w > 0 && btn.h > 0 && btn.isEnabled() && btn.contains(x, y)) return btn;
    }
    return null;
}

function ratingStarAt(x, y) {
    var rect = layoutRects.rating;
    var i, starX;
    if (!handle || !rect || !rect.visible || !isPointInRect(rect, x, y)) return 0;

    for (i = 0; i < 5; i++) {
        starX = rect.starX + i * (rect.starSize + rect.starGap);
        if (x >= starX && x < starX + rect.starSize) return i + 1;
    }
    return 0;
}

function clearPressState() {
    var changed = artPressed || ratingPressed > 0;
    var i;
    artPressed = false;
    ratingPressed = 0;
    pressedButton = null;
    for (i = 0; i < allButtons.length; i++) {
        if (allButtons[i].pressed) {
            allButtons[i].pressed = false;
            changed = true;
        }
    }
    return changed;
}

function drawIconButton(gr, btn) {
    var glyph = typeof btn.glyph === "function" ? btn.glyph() : btn.glyph;
    var enabled = btn.isEnabled();
    var active = btn.isActive();
    var hot = enabled && (btn.hover || btn.pressed);
    var colour;

    if (hot) {
        gr.FillRoundRect(btn.x, btn.y, btn.w, btn.h, _scale(3), _scale(3),
            blendColours(theme.background, theme.hover, btn.pressed ? 0.18 : 0.10));
    }
    if (!glyph || !fonts.icon) return;

    if (!enabled) colour = blendColours(theme.background, theme.textTertiary, 0.45);
    else if (active || hot) colour = currentAccent();
    else colour = theme.textTertiary;

    gr.GdiDrawText(glyph, fonts.icon, colour,
        btn.x, btn.y, btn.w, btn.h,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function drawRating(gr) {
    var rect = layoutRects.rating;
    var preview, i, glyph, colour, starX;
    if (!rect || !rect.visible || !fonts.rating) return;

    preview = ratingHover > 0 ? ratingHover : cache.rating;
    for (i = 1; i <= 5; i++) {
        glyph = i <= preview ? RivageUI.icons.starFill : RivageUI.icons.starOutline;
        colour = i <= preview ? currentAccent() : theme.textTertiary;
        if (ratingPressed === i) colour = blendColours(theme.background, colour, 0.76);
        starX = rect.starX + (i - 1) * (rect.starSize + rect.starGap);
        gr.GdiDrawText(glyph, fonts.rating, colour,
            starX, rect.y, rect.starSize, rect.h,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

// Layout - a fixed vertical stack (art+text row, transport/actions row,
// seek strip). Love sits to the left of the centred transport group and the
// five rating stars sit to its right. Optional actions disappear as whole
// controls before they can crowd transport or become partly clickable.
// The exit control is pinned to the top-right corner and stays available at
// any size - it is the direct way back to the normal view.

var layoutRects = {};
var layoutWidth = -1;
var layoutHeight = -1;
var PAD = 0, EXIT_SIZE = 0, SEEK_HEIGHT = 0, CONTROLS_HEIGHT = 0;
var BTN_SIZE = 0, BTN_GAP = 0, ROW_GAP = 0;
var ENGAGEMENT_GAP = 0, RATING_STAR_SIZE = 0, RATING_STAR_GAP = 0;

function updateMetrics() {
    PAD = _scale(8);
    EXIT_SIZE = _scale(22);
    // Core: Console is inherited at its real host size, so a fixed 22-pixel
    // row can clip the lower half of the elapsed/end labels. Ask the shared
    // widget for the current font/thumb-aware minimum instead.
    SEEK_HEIGHT = Math.max(_scale(22), Math.ceil(SeekbarWidget.minimumOuterHeight()));
    CONTROLS_HEIGHT = _scale(28);
    BTN_SIZE = _scale(22);
    BTN_GAP = _scale(10);
    ROW_GAP = _scale(6);
    ENGAGEMENT_GAP = _scale(5);
    RATING_STAR_SIZE = _scale(13);
    RATING_STAR_GAP = Math.max(0, _scale(1));
}

function layout() {
    var w = Math.max(0, window.Width);
    var h = Math.max(0, window.Height);
    var contentW, seekHeight, seekGap, seekY, controlsY, controlsHeight, controlsWidth;
    var mainH, artSize, exitX, exitSize, topContentRight, topContentWidth;
    var textX, textRight, infoW, controlsOverlapExit;
    var buttonSize, buttonGap, totalBtnW, startX, btnY;
    var transportRight, loveSize, loveY, leftRoom, rightRoom;
    var ratingWidth, ratingStarSize, ratingGap, showLove, showRating;

    layoutWidth = w;
    layoutHeight = h;
    updateMetrics();

    contentW = Math.max(0, w - PAD * 2);
    exitSize = Math.min(EXIT_SIZE, Math.max(0, w - PAD * 2), Math.max(0, h - PAD * 2));
    controlsHeight = Math.min(CONTROLS_HEIGHT, Math.max(0, h - PAD));
    // The shared seekbar reserves elapsed/end labels on both sides. Below this
    // width those labels overlap the track. Also omit it when the current
    // height/DPI cannot hold both fixed rows without overlap.
    seekHeight = contentW >= _scale(104) &&
        h >= PAD + controlsHeight + ROW_GAP + SEEK_HEIGHT ? SEEK_HEIGHT : 0;
    seekGap = seekHeight > 0 ? ROW_GAP : 0;
    seekY = Math.max(0, h - PAD - seekHeight);
    controlsY = Math.max(0, seekY - seekGap - controlsHeight);
    mainH = Math.max(0, controlsY - ROW_GAP - PAD);

    exitX = Math.max(PAD, w - PAD - exitSize);
    topContentRight = exitSize > 0 ? Math.max(PAD, exitX - ROW_GAP) : Math.max(PAD, w - PAD);
    topContentWidth = Math.max(0, topContentRight - PAD);
    artSize = Math.max(0, Math.min(mainH, Math.round(contentW * 0.45), topContentWidth));
    textX = PAD + artSize + (artSize > 0 ? ROW_GAP : 0);
    textRight = Math.max(textX, topContentRight);
    infoW = Math.max(0, textRight - textX);

    // On very short/high-DPI custom sizes the transport row can rise into the
    // exit button's vertical band. Reserve the exit button's horizontal band
    // instead of allowing Next and Restore to overlap.
    controlsWidth = contentW;
    controlsOverlapExit = exitSize > 0 && controlsHeight > 0 &&
        controlsY < PAD + exitSize && controlsY + controlsHeight > PAD;
    if (controlsOverlapExit) controlsWidth = Math.max(0, exitX - ROW_GAP - PAD);

    layoutRects.art = { x: PAD, y: PAD, w: artSize, h: artSize, visible: artSize > 0 };
    layoutRects.exit = { x: exitX, y: PAD, w: exitSize, h: exitSize, visible: exitSize > 0 };
    layoutRects.info = {
        x: textX, y: PAD, w: infoW, h: artSize,
        visible: artSize > 0 && infoW > 0
    };
    layoutRects.controls = {
        x: PAD, y: controlsY, w: controlsWidth, h: controlsHeight,
        visible: controlsHeight > 0 && controlsWidth > 0 && controlsY >= 0
    };
    layoutRects.seek = {
        x: PAD, y: seekY, w: contentW, h: seekHeight,
        visible: contentW > 0 && seekHeight > 0 && seekY >= 0
    };

    if (layoutRects.exit.visible) {
        exitBtn.setBounds(layoutRects.exit.x, layoutRects.exit.y, layoutRects.exit.w, layoutRects.exit.h);
    } else {
        hideButton(exitBtn);
    }

    if (layoutRects.controls.visible) {
        // Preserve all three controls in narrow/tall custom mini-window sizes by
        // reducing their gap and hit box together rather than letting Next spill
        // outside the panel. At the default size this resolves to the full metrics.
        buttonGap = Math.min(BTN_GAP, Math.max(0, Math.floor(layoutRects.controls.w * 0.08)));
        buttonSize = Math.min(BTN_SIZE, layoutRects.controls.h,
            Math.max(0, Math.floor((layoutRects.controls.w - buttonGap * 2) / 3)));
        totalBtnW = buttonSize * 3 + buttonGap * 2;
        startX = layoutRects.controls.x + Math.max(0, Math.round((layoutRects.controls.w - totalBtnW) / 2));
        btnY = layoutRects.controls.y + Math.max(0, Math.round((layoutRects.controls.h - buttonSize) / 2));
        prevBtn.setBounds(startX, btnY, buttonSize, buttonSize);
        playBtn.setBounds(startX + buttonSize + buttonGap, btnY, buttonSize, buttonSize);
        nextBtn.setBounds(startX + (buttonSize + buttonGap) * 2, btnY, buttonSize, buttonSize);

        transportRight = startX + totalBtnW;
        leftRoom = Math.max(0, startX - ENGAGEMENT_GAP - layoutRects.controls.x);
        rightRoom = Math.max(0,
            layoutRects.controls.x + layoutRects.controls.w - transportRight - ENGAGEMENT_GAP);

        showLove = !!handle && miniPlayerSettings.showLoveButton;
        showRating = !!handle && miniPlayerSettings.showRating;
        loveSize = Math.min(BTN_SIZE, layoutRects.controls.h);
        loveY = layoutRects.controls.y + Math.max(0, Math.round((layoutRects.controls.h - loveSize) / 2));
        ratingStarSize = Math.min(RATING_STAR_SIZE, layoutRects.controls.h);
        ratingGap = RATING_STAR_GAP;
        ratingWidth = ratingStarSize * 5 + ratingGap * 4;

        if (showLove && loveSize > 0 && leftRoom >= loveSize) {
            loveBtn.setBounds(startX - ENGAGEMENT_GAP - loveSize, loveY, loveSize, loveSize);
        } else {
            showLove = false;
            hideButton(loveBtn);
        }

        if (showRating && ratingStarSize > 0 && rightRoom >= ratingWidth) {
            layoutRects.rating = {
                x: transportRight + ENGAGEMENT_GAP,
                y: layoutRects.controls.y,
                w: ratingWidth,
                h: layoutRects.controls.h,
                visible: true,
                starX: transportRight + ENGAGEMENT_GAP,
                starSize: ratingStarSize,
                starGap: ratingGap
            };
        } else {
            showRating = false;
            layoutRects.rating = {
                x: -100, y: -100, w: 0, h: 0,
                visible: false, starX: -100, starSize: 0, starGap: 0
            };
            ratingHover = 0;
            ratingPressed = 0;
        }
    } else {
        hideButton(prevBtn);
        hideButton(playBtn);
        hideButton(nextBtn);
        hideButton(loveBtn);
        layoutRects.rating = {
            x: -100, y: -100, w: 0, h: 0,
            visible: false, starX: -100, starSize: 0, starGap: 0
        };
        ratingHover = 0;
        ratingPressed = 0;
    }

    if (panelIsVisible()) {
        rebuildArtRender();
        prepareMarquee();
    } else {
        // Keep the normally hidden panel dormant; both resources are rebuilt
        // lazily when JSplitter shows us and on_paint runs again.
        clearArtRender();
        resetMarquee();
    }
}

// Painting

function on_paint(gr) {
    var i, btn, smoothingChanged = false;
    // Some host builds can deliver a queued repaint after Show(false). Do not
    // let that stale paint wake the normally dormant compact panel back up.
    if (!panelIsVisible()) return;

    // JSplitter normally sends on_size before the first paint after Show(true),
    // but a native child rebuild can deliver only the paint. Reconcile geometry
    // here as a last line of defence, then lazily rebuild the hidden marquee.
    if (layoutWidth !== window.Width || layoutHeight !== window.Height) {
        updateDpiFromHeight();
        layout();
    }
    if (!marqueePrepared) prepareMarquee();
    startPendingArtRefresh();
    startSeekTickTimer();
    startMarqueeTimer();

    if (typeof gr.SetSmoothingMode === "function") {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    gr.FillSolidRect(0, 0, Math.max(0, window.Width), Math.max(0, window.Height), theme.background);

    if (layoutRects.art && layoutRects.art.visible) drawArt(gr, layoutRects.art);
    if (layoutRects.info && layoutRects.info.visible) drawTrackInfo(gr, layoutRects.info);
    if (layoutRects.seek && layoutRects.seek.visible) seekbar.draw(gr, layoutRects.seek, currentAccent());
    drawRating(gr);

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

// Menu - deliberately small: this view exists to get out of the way, not to
// carry its own settings screen.

function on_mouse_rbtn_up(x, y) {
    var menu = window.CreatePopupMenu();
    var MENU_ID = { restore: 1, preferences: 2, configure: 3 };
    var id;

    menu.AppendMenuItem(MF_STRING, MENU_ID.restore, "Restore normal view");
    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.preferences, "foobar2000 preferences\u2026");
    menu.AppendMenuItem(MF_STRING, MENU_ID.configure, RivageUI.copy.labels.panelConfiguration);

    id = menu.TrackPopupMenu(x, y);
    switch (id) {
    case MENU_ID.restore:
        MiniPlayerProtocol.requestExit();
        break;
    case MENU_ID.preferences:
        fb.ShowPreferences();
        break;
    case MENU_ID.configure:
        window.ShowConfigureV2();
        break;
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
    var i, btn, changed = false, hoverNow, buttonHot = false;
    var artHot = isPointInRect(layoutRects.art, x, y);
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var seekResult;
    var nextRatingHover = ratingStarAt(x, y);

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        hoverNow = btn.w > 0 && btn.h > 0 && btn.isEnabled() && btn.contains(x, y);
        if (hoverNow) buttonHot = true;
        if (hoverNow !== btn.hover) { btn.hover = hoverNow; changed = true; }
    }

    if (nextRatingHover !== ratingHover) {
        ratingHover = nextRatingHover;
        changed = true;
    }

    seekResult = seekbar.onMouseMove(seekOuter, x, y);
    if (seekResult.changed) changed = true;
    setPanelCursor(buttonHot || nextRatingHover > 0 || artHot || seekResult.hot ? IDC_HAND : IDC_ARROW);

    if (changed) window.Repaint(true);
}

function on_mouse_leave() {
    var i, btn, changed = false;

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        if (btn.hover) { btn.hover = false; changed = true; }
    }
    if (ratingHover) { ratingHover = 0; changed = true; }
    if (clearPressState()) changed = true;
    if (seekbar.onMouseLeave()) changed = true;
    setPanelCursor(IDC_ARROW);

    if (changed) window.Repaint(true);
}

function on_mouse_lbtn_down(x, y) {
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var btn, star;

    clearPressState();
    if (seekbar.onMouseDown(seekOuter, x, y)) {
        window.Repaint(true);
        return;
    }

    btn = buttonAt(x, y);
    if (btn) {
        pressedButton = btn;
        btn.pressed = true;
        window.Repaint(true);
        return;
    }

    star = ratingStarAt(x, y);
    if (star > 0) {
        ratingPressed = star;
        ratingHover = star;
        window.Repaint(true);
        return;
    }

    artPressed = isPointInRect(layoutRects.art, x, y);
}

function on_mouse_lbtn_up(x, y) {
    var seekOuter = (layoutRects.seek && layoutRects.seek.visible) ? layoutRects.seek : null;
    var btn = pressedButton;
    var pressedStar = ratingPressed;
    var releasedStar = ratingStarAt(x, y);
    var activateButton = !!btn && btn.isEnabled() && btn.contains(x, y) && typeof btn.onClick === "function";
    var activateRating = pressedStar > 0 && pressedStar === releasedStar;
    var activateArt = artPressed && isPointInRect(layoutRects.art, x, y);
    var hadPress = clearPressState();

    if (seekbar.onMouseUp(seekOuter, x, y)) {
        window.Repaint(true);
        return;
    }

    if (hadPress) window.Repaint(true);
    if (activateButton) {
        btn.onClick();
        return;
    }
    if (activateRating) {
        setRating(pressedStar === cache.rating ? 0 : pressedStar);
        return;
    }

    // Matches Album Art's own click-to-play/pause placeholder behaviour, but
    // only when the press also began on the artwork.
    if (activateArt) fb.PlayOrPause();
}

function on_size(width, height) {
    updateDpiFromHeight();
    layout();
}

function on_colours_changed() {
    refreshHostColours();
    if (panelIsVisible()) prepareMarquee();
    else resetMarquee();
    window.Repaint(true);
}

function on_playback_new_track(metadb) {
    clearMetadataRefreshTimers();
    handle = metadb;
    trackKey = getHandleKey(handle);
    ratingHover = 0;
    ratingPressed = 0;
    refreshCache();
    scheduleArtRefresh();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_playback_dynamic_info_track() {
    clearMetadataRefreshTimers();
    handle = fb.GetNowPlaying();
    trackKey = getHandleKey(handle);
    ratingHover = 0;
    ratingPressed = 0;
    refreshCache();
    scheduleArtRefresh();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_playback_dynamic_info() {
    refreshCache();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_metadb_changed(handles) {
    if (!handle || !handleListContainsTrack(handles, trackKey)) return;
    refreshCache();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_playback_edited() {
    if (!handle) return;
    refreshCache();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_playback_stop(reason) {
    clearMetadataRefreshTimers();
    cancelScheduledArtRefresh(true);
    artRefreshPending = false;
    if (reason === PlaybackStopReason.starting_another) return;

    handle = null;
    trackKey = "";
    ratingHover = 0;
    ratingPressed = 0;
    refreshCache();
    artImage = null;
    artKey = "";
    clearArtRender();
    resetMarquee();
    layout();
    window.Repaint(true);
}

function on_playback_pause(state) {
    window.Repaint(true);
}

function on_playback_seek(time) {
    window.Repaint(true);
}

var seekTickTimer = null;

function seekTickNeeded() {
    try {
        return !!(layoutRects.seek && layoutRects.seek.visible &&
            fb.IsPlaying && !fb.IsPaused && !seekbar.drag);
    } catch (e) {
        return false;
    }
}

function startSeekTickTimer() {
    if (!scriptActive || seekTickTimer !== null || !panelIsVisible() || !seekTickNeeded()) return;

    try {
        seekTickTimer = window.SetTimeout(function () {
            seekTickTimer = null;
            if (!scriptActive || !panelIsVisible() || !seekTickNeeded()) return;

            try {
                window.RepaintRect(layoutRects.seek.x, layoutRects.seek.y, layoutRects.seek.w, layoutRects.seek.h);
            } catch (e) {
                return; // Panel is unloading; do not schedule another tick.
            }
            startSeekTickTimer();
        }, 250);
    } catch (e) {
        seekTickTimer = null;
    }
}

function on_script_unload() {
    scriptActive = false;
    if (seekTickTimer !== null) {
        try { window.ClearTimeout(seekTickTimer); } catch (e) { }
        seekTickTimer = null;
    }
    clearMetadataRefreshTimers();
    cancelScheduledArtRefresh(true);
    artRefreshPending = false;
    clearPressState();
    resetMarquee();
    clearArtRender();
}

function on_notify_data(name, info) {
    var provided = false;
    if (SharedThemeProtocol.consume(name, info)) return;

    if (SettingsRegistry.provide(name, info,
        SeekbarWidget.PANEL_ID, SeekbarWidget.PANEL_LABEL, SeekbarWidget.getSchema)) provided = true;
    if (provided) return;

    if (SettingsRegistry.consume(name, info, SeekbarWidget.PANEL_ID, applySeekbarSetting)) return;
    if (MiniPlayerProtocol.consumeSettings(name, info, adoptMiniPlayerSettings)) return;
    if (SeekbarWidget.onNotifyData(name, info)) {
        layout();
        return;
    }

    // Global edits are broadcast directly to every panel. Adopt a playback-
    // statistics source change immediately; the authority's UPDATE handshake
    // remains the fallback for arbitrary panel load order.
    if (name === SettingsRegistry.VALUE_CHANGED && info && info.panelId === "global" &&
        PlaybackStatsSource.applySetting(info.settingId, info.value)) return;
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        refreshHostColours();
        if (panelIsVisible()) prepareMarquee();
        else resetMarquee();
        window.Repaint(true);
    }
}

// Initial state

refreshHostColours();
handle = fb.IsPlaying ? fb.GetNowPlaying() : null;
trackKey = getHandleKey(handle);
refreshCache();
on_font_changed();
scheduleArtRefresh();
SharedAccentProtocol.request();
SeekbarWidget.requestSync();
PlaybackStatsSource.onChange(function () {
    if (!scriptActive) return;
    refreshCache();
    layout();
    window.Repaint(true);
});
PlaybackStatsSource.requestSync();
MiniPlayerProtocol.requestSettings();
