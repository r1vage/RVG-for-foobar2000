window.DrawMode = 0;

// Compact "Mini Player" view. Normally hidden; splitters/root_splitter.js shows it
// full-size and owns the main-window resize/restore - see MINI_PLAYER_SETUP.md.
// Design 1 and Design 2 differ only in layout() and on_paint()'s text branch.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\ui_scale.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\power_mode.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\foobar_actions.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\seekbar_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\marquee_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\miniplayer_protocol.js");

window.DefineScript(RivageUI.copy.popupTitle("Mini Player"), {
    author: "RivaGe",
    version: "2.5.0",
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
// Persisted by tab-switcher-right.js; this panel is a read-only consumer.
var miniPlayerSettings = MiniPlayerProtocol.defaultSettings();

function coverLayoutSelected() {
    return miniPlayerSettings.layout === MiniPlayerProtocol.Layout.Cover;
}

// What layout() last produced. Design 2 falls back to Design 1 at sizes it
// cannot honour, so paint from this, never from the setting.
var activeLayoutIsCover = false;
function isCoverLayout() {
    return activeLayoutIsCover;
}

var g_dpi = 100;
function _scale(value) {
    return Math.round(value * g_dpi / 100);
}

function make_font(name, size, style) {
    return RivageUI.font(name || "Segoe UI", _scale(size), style);
}

// Theme - always follows the shared album-art accent.

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

// Design 2's artist line, and the size its seek strip's labels borrow.
// Unscaled - make_font() and SeekbarWidget both apply the same DPI.
var COVER_ARTIST_FONT_SIZE = 12;

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
    // Design 2 only.
    fonts.title = make_font(infoFontName, 14, 1);
    fonts.artist = make_font(infoFontName, COVER_ARTIST_FONT_SIZE, 0);
    fonts.iconSmall = make_font(iconFontName, 11, 0);
    resetMarquee();
}

function updateDpiFromHeight() {
    var h = window.Height;
    if (h <= 0) return false;

    var dpiFactor = (RivageScale.dpi() || 96) / 96;
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

// text is Design 1's combined line; title/artist are Design 2's two.
var cache = { text: "", title: "", artist: "", loved: false, rating: 0 };
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
        cache.title = "Not playing";
        cache.artist = "";
        cache.loved = false;
        cache.rating = 0;
        return;
    }

    title = evaluateWithHandle(tfo.title);
    artist = evaluateWithHandle(tfo.artist);
    cache.text = artist ? (title + "  \u2014  " + artist) : (title || "Unknown title");
    cache.title = title || "Unknown title";
    cache.artist = artist || "";
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

        // Optimistic; the title-format field stays authoritative and is re-read.
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

    // Hidden instances still get playback callbacks: remember the newest
    // request, but decode nothing until the panel is shown.
    cancelScheduledArtRefresh(true);
    // Don't flash the previous cover during the settle window. Same-key
    // stream refreshes deliberately keep the current image.
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

    // Keep the image, but not a scaled surface for a hidden panel;
    // drawArt() rebuilds it on demand.
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

// Track info marquee. Design 1 scrolls one combined line; Design 2 gives the
// title and artist one each. A marquee only allocates a bitmap when its text
// overflows, so the second one is free in the common case.

var marqueePrepared = false;

function repaintTextRect(rect) {
    if (!rect || !rect.visible || rect.w <= 0 || rect.h <= 0) return;
    window.RepaintRect(rect.x, rect.y, rect.w, rect.h);
}

function makeTextMarquee(rectName) {
    return MarqueeWidget.create({
        interval: 33,
        speed: 34,
        pause: 1400,
        gap: 40,
        isVisible: panelIsVisible,
        skipWorkWhenHidden: true,
        stopTimerWhenHidden: true,
        onTick: function () {
            repaintTextRect(layoutRects[rectName]);
        }
    });
}

// Draws into layoutRects.info in Design 1 and layoutRects.title in Design 2.
var titleMarquee = MarqueeWidget.create({
    interval: 33,
    speed: 34,
    pause: 1400,
    gap: 40,
    isVisible: panelIsVisible,
    skipWorkWhenHidden: true,
    stopTimerWhenHidden: true,
    onTick: function () {
        repaintTextRect(isCoverLayout() ? layoutRects.title : layoutRects.info);
    }
});
var artistMarquee = makeTextMarquee("artist");

function resetMarquee() {
    titleMarquee.reset();
    artistMarquee.reset();
    marqueePrepared = false;
}

function startMarqueeTimer() {
    titleMarquee.startTimer();
    if (isCoverLayout()) artistMarquee.startTimer();
}

function measureTextWidth(text, font) {
    return RivageUI.measureText(text, font, true);
}

function prepareOneMarquee(marquee, text, font, rect, colour, lineHeight) {
    if (!rect || !rect.visible || !text || !font || rect.w <= 0) {
        marquee.reset();
        return;
    }

    marquee.prepare(text, font, rect, {
        measureText: measureTextWidth,
        scale: _scale,
        textColour: colour,
        textY: function (imageHeight) {
            return Math.max(0, Math.round((imageHeight - _scale(lineHeight)) / 2));
        },
        textRenderingHint: TEXT_RENDERING_HINT_ANTIALIAS
    });
}

function prepareMarquee() {
    if (isCoverLayout()) {
        prepareOneMarquee(titleMarquee, cache.title, fonts.title, layoutRects.title, theme.text, 17);
        prepareOneMarquee(artistMarquee, cache.artist, fonts.artist, layoutRects.artist,
            theme.textTertiary, 15);
    } else {
        prepareOneMarquee(titleMarquee, cache.text, fonts.info, layoutRects.info, theme.text, 15);
        artistMarquee.reset();
    }
    marqueePrepared = true;
}

function drawTrackInfo(gr, rect) {
    if (!titleMarquee.draw(gr, rect)) {
        gr.GdiDrawText(cache.text, fonts.info, theme.text, rect.x, rect.y, rect.w, rect.h,
            DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    }
}

function drawCoverText(gr, area, pad) {
    var titleRect = layoutRects.title;
    var artistRect = layoutRects.artist;

    if (titleRect && titleRect.visible && RivageUI.areaHits(area, titleRect, pad)) {
        if (!titleMarquee.draw(gr, titleRect)) {
            gr.GdiDrawText(cache.title, fonts.title, theme.text,
                titleRect.x, titleRect.y, titleRect.w, titleRect.h,
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
        }
    }
    if (artistRect && artistRect.visible && cache.artist && RivageUI.areaHits(area, artistRect, pad)) {
        if (!artistMarquee.draw(gr, artistRect)) {
            gr.GdiDrawText(cache.artist, fonts.artist, theme.textTertiary,
                artistRect.x, artistRect.y, artistRect.w, artistRect.h,
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
        }
    }
}

// Seekbar - the shared widget Top Bar and Controls use. This panel overrides
// only 50% marker visibility and Design 2's label metrics.

var seekbar = SeekbarWidget.create({
    showMidpointMark: function () { return miniPlayerSettings.showMidpointMark; },
    // Design 2's strip runs alongside the transport, so it trades a tighter
    // label reserve (34 still holds "-12:34") for track width, and matches the
    // artist line's size. Hugging is the widget's own default.
    labelWidth: function () { return isCoverLayout() ? 34 : 0; },
    fontSize: function () { return isCoverLayout() ? COVER_ARTIST_FONT_SIZE : 0; }
});

function applySeekbarSetting(settingId, value) {
    SeekbarWidget.applySetting(settingId, value);
    layout();
}

function adoptMiniPlayerSettings(settings) {
    var next = MiniPlayerProtocol.normaliseSettings(settings, miniPlayerSettings);
    var layoutChanged = next.layout !== miniPlayerSettings.layout;
    var changed = layoutChanged ||
        next.lockWindowSize !== miniPlayerSettings.lockWindowSize ||
        next.alwaysOnTop !== miniPlayerSettings.alwaysOnTop ||
        next.showLoveButton !== miniPlayerSettings.showLoveButton ||
        next.showRating !== miniPlayerSettings.showRating ||
        next.showMidpointMark !== miniPlayerSettings.showMidpointMark;

    miniPlayerSettings = next;
    if (!changed) return;

    // Different fonts, viewports and art proportions per design.
    if (layoutChanged) {
        resetMarquee();
        clearArtRender();
    }

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
        // Which `fonts` entry draws the glyph; layout() sets it per design.
        fontKey: "icon",
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

// Segoe Fluent Icons/MDL2 "BackToWindow".
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
    var font = fonts[btn.fontKey] || fonts.icon;
    var colour;

    if (hot) {
        gr.FillRoundRect(btn.x, btn.y, btn.w, btn.h, _scale(3), _scale(3),
            blendColours(theme.background, theme.hover, btn.pressed ? 0.18 : 0.10));
    }
    if (!glyph || !font) return;

    if (!enabled) colour = blendColours(theme.background, theme.textTertiary, 0.45);
    else if (active || hot) colour = currentAccent();
    else colour = theme.textTertiary;

    gr.GdiDrawText(glyph, font, colour,
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

// One rect table, metrics and hit-testing for both designs; only the arrangement
// differs. An optional action disappears as a whole control rather than crowd the
// transport or stay partly clickable, and exit is always pinned top-right.

var layoutRects = {};
var layoutWidth = -1;
var layoutHeight = -1;
var PAD = 0, EXIT_SIZE = 0, SEEK_HEIGHT = 0, CONTROLS_HEIGHT = 0;
var BTN_SIZE = 0, BTN_GAP = 0, ROW_GAP = 0;
var ENGAGEMENT_GAP = 0, RATING_STAR_SIZE = 0, RATING_STAR_GAP = 0;
var COVER_PAD = 0, COVER_GAP = 0, COVER_BTN_SIZE = 0, COVER_BTN_GAP = 0;
var COVER_TITLE_HEIGHT = 0, COVER_ARTIST_HEIGHT = 0, COVER_LINE_GAP = 0;
var COVER_ACTION_HEIGHT = 0, COVER_HEART_SIZE = 0;
// Below this the seekbar's labels start overlapping its track.
var MIN_SEEK_WIDTH = 0;

function hiddenRect() {
    return { x: -100, y: -100, w: 0, h: 0, visible: false };
}

function clearRatingRect() {
    layoutRects.rating = {
        x: -100, y: -100, w: 0, h: 0,
        visible: false, starX: -100, starSize: 0, starGap: 0
    };
    ratingHover = 0;
    ratingPressed = 0;
}

function updateMetrics() {
    PAD = _scale(8);
    EXIT_SIZE = _scale(22);
    // Core: Console keeps its real host size, so a fixed row can clip the
    // labels. Ask the widget - passing the instance, so Design 2's smaller
    // label size is what gets reserved.
    SEEK_HEIGHT = Math.max(_scale(22), Math.ceil(SeekbarWidget.minimumOuterHeight(seekbar)));
    CONTROLS_HEIGHT = _scale(28);
    BTN_SIZE = _scale(22);
    BTN_GAP = _scale(10);
    ROW_GAP = _scale(6);
    ENGAGEMENT_GAP = _scale(5);
    RATING_STAR_SIZE = _scale(13);
    RATING_STAR_GAP = Math.max(0, _scale(1));
    MIN_SEEK_WIDTH = _scale(104);

    COVER_PAD = _scale(10);
    COVER_GAP = _scale(6);
    COVER_BTN_SIZE = _scale(18);
    COVER_BTN_GAP = _scale(4);
    COVER_TITLE_HEIGHT = _scale(20);
    COVER_ARTIST_HEIGHT = _scale(17);
    COVER_LINE_GAP = _scale(1);
    COVER_ACTION_HEIGHT = _scale(18);
    COVER_HEART_SIZE = _scale(15);
}

function layout() {
    layoutWidth = Math.max(0, window.Width);
    layoutHeight = Math.max(0, window.Height);

    // The seekbar's option callbacks read isCoverLayout() and updateMetrics()
    // reserves the row from them, so the flag must point at the design about
    // to be built. layoutCover() re-runs both if it falls back.
    activeLayoutIsCover = coverLayoutSelected();
    updateMetrics();

    if (activeLayoutIsCover) layoutCover();
    else layoutClassic();

    if (panelIsVisible()) {
        rebuildArtRender();
        prepareMarquee();
    } else {
        // Stay dormant while hidden; on_paint rebuilds both.
        clearArtRender();
        resetMarquee();
    }
}

function actionRowWidth(withLove, withRating, heartSize, ratingWidth) {
    return (withLove ? heartSize : 0) + (withRating ? ratingWidth : 0) +
        (withLove && withRating ? COVER_GAP : 0);
}

// Design 2.
function layoutCover() {
    var w = layoutWidth;
    var h = layoutHeight;
    var artSize, colX, colRight, colW, exitSize, exitX, titleRight;
    var rowHeight, rowY, seekHeight, transportSize, transportGap, transportW;
    var seekX, seekW, transportX, btnY;
    var textTop, textBottom, textRoom, lines, blockHeight, blockY;
    var titleY, artistY, actionsY, actionX, titleWidth, artistWidth;
    var heartSize, ratingStarSize, ratingGap, ratingWidth, actionsWidth;
    var showLove, showRating;

    // Bleeds to the top, left and bottom edges. Square while the panel is wide
    // enough; otherwise a centre-cropped slice rather than eating the column.
    artSize = Math.max(0, Math.min(h, Math.round(w * 0.5)));
    layoutRects.art = { x: 0, y: 0, w: artSize, h: h, visible: artSize > 0 && h > 0 };
    layoutRects.info = hiddenRect();

    colX = artSize + COVER_PAD;
    colRight = Math.max(colX, w - COVER_PAD);
    colW = Math.max(0, colRight - colX);

    exitSize = Math.min(EXIT_SIZE, colW, Math.max(0, h - COVER_GAP * 2));
    exitX = colRight - exitSize;
    layoutRects.exit = {
        x: exitX, y: COVER_GAP, w: exitSize, h: exitSize,
        visible: exitSize > 0
    };
    if (layoutRects.exit.visible) {
        exitBtn.setBounds(exitX, COVER_GAP, exitSize, exitSize);
        exitBtn.fontKey = "icon";
    } else {
        hideButton(exitBtn);
    }
    titleRight = layoutRects.exit.visible ? Math.max(colX, exitX - COVER_GAP) : colRight;

    // Transport first, the rest to the seek strip. The buttons shrink with the
    // column before the design gives up.
    seekHeight = SEEK_HEIGHT;
    transportGap = COVER_BTN_GAP;
    transportSize = Math.min(COVER_BTN_SIZE,
        Math.max(0, Math.floor((colW - transportGap * 2) / 3)));
    transportW = transportSize * 3 + transportGap * 2;
    rowHeight = Math.max(seekHeight, transportSize);
    rowY = h - COVER_GAP - rowHeight;

    if (rowY < 0 || transportSize < _scale(10)) {
        // Nothing sane fits. Re-measure first - the seek row was reserved for
        // Design 2's smaller labels.
        activeLayoutIsCover = false;
        updateMetrics();
        layoutClassic();
        return;
    }

    layoutRects.controls = {
        x: colX, y: rowY, w: colW, h: rowHeight,
        visible: true
    };

    seekX = colX + transportW + COVER_GAP;
    seekW = Math.max(0, colRight - seekX);
    if (seekW >= MIN_SEEK_WIDTH && seekHeight > 0) {
        layoutRects.seek = {
            x: seekX, y: rowY + Math.round((rowHeight - seekHeight) / 2),
            w: seekW, h: seekHeight, visible: true
        };
        transportX = colX;
    } else {
        // No seek strip here, so centre the transport in the column.
        layoutRects.seek = hiddenRect();
        transportX = colX + Math.max(0, Math.round((colW - transportW) / 2));
    }

    btnY = rowY + Math.round((rowHeight - transportSize) / 2);
    prevBtn.setBounds(transportX, btnY, transportSize, transportSize);
    playBtn.setBounds(transportX + transportSize + transportGap, btnY, transportSize, transportSize);
    nextBtn.setBounds(transportX + (transportSize + transportGap) * 2, btnY, transportSize, transportSize);
    prevBtn.fontKey = "iconSmall";
    playBtn.fontKey = "iconSmall";
    nextBtn.fontKey = "iconSmall";

    // Love and the stars share one action row under the artist. Each is still
    // dropped as a whole control, and the row only exists if at least one of
    // them does.
    showLove = !!handle && miniPlayerSettings.showLoveButton;
    showRating = !!handle && miniPlayerSettings.showRating;
    heartSize = Math.min(COVER_HEART_SIZE, COVER_ACTION_HEIGHT);
    ratingStarSize = Math.min(RATING_STAR_SIZE, COVER_ACTION_HEIGHT);
    ratingGap = RATING_STAR_GAP;
    ratingWidth = ratingStarSize * 5 + ratingGap * 4;
    if (showLove && heartSize <= 0) showLove = false;
    if (showRating && ratingStarSize <= 0) showRating = false;
    // Stars are much the wider of the two, so they go first if both won't fit.
    actionsWidth = actionRowWidth(showLove, showRating, heartSize, ratingWidth);
    if (actionsWidth > colW && showRating) {
        showRating = false;
        actionsWidth = actionRowWidth(showLove, showRating, heartSize, ratingWidth);
    }
    if (actionsWidth > colW) {
        showLove = false;
        actionsWidth = 0;
    }

    // Centred in what is left above the row, dropping a line at a time as the
    // height shrinks - a clipped line is worse than none.
    textTop = COVER_GAP;
    textBottom = Math.max(textTop, rowY - COVER_GAP);
    textRoom = textBottom - textTop;
    blockHeight = COVER_TITLE_HEIGHT + COVER_LINE_GAP + COVER_ARTIST_HEIGHT;
    lines = textRoom >= blockHeight ? 2 : 1;
    if (lines === 2 && actionsWidth > 0 &&
        textRoom >= blockHeight + COVER_LINE_GAP + COVER_ACTION_HEIGHT) {
        lines = 3;
        blockHeight += COVER_LINE_GAP + COVER_ACTION_HEIGHT;
    } else if (lines === 1) {
        blockHeight = COVER_TITLE_HEIGHT;
    }
    blockY = textTop + Math.max(0, Math.round((textRoom - blockHeight) / 2));
    titleY = blockY;
    artistY = blockY + COVER_TITLE_HEIGHT + COVER_LINE_GAP;
    actionsY = artistY + COVER_ARTIST_HEIGHT + COVER_LINE_GAP;

    titleWidth = Math.max(0, titleRight - colX);
    layoutRects.title = {
        x: colX, y: titleY, w: titleWidth, h: COVER_TITLE_HEIGHT,
        visible: titleWidth > 0 && textRoom >= COVER_TITLE_HEIGHT
    };

    artistWidth = colW;
    layoutRects.artist = {
        x: colX, y: artistY, w: artistWidth, h: COVER_ARTIST_HEIGHT,
        visible: lines >= 2 && artistWidth > 0
    };

    actionX = colX;
    if (lines === 3 && showLove) {
        loveBtn.setBounds(actionX, actionsY + Math.round((COVER_ACTION_HEIGHT - heartSize) / 2),
            heartSize, heartSize);
        loveBtn.fontKey = "iconSmall";
        actionX += heartSize + COVER_GAP;
    } else {
        hideButton(loveBtn);
    }

    if (lines === 3 && showRating) {
        layoutRects.rating = {
            x: actionX, y: actionsY, w: ratingWidth, h: COVER_ACTION_HEIGHT,
            visible: true,
            starX: actionX, starSize: ratingStarSize, starGap: ratingGap
        };
    } else {
        clearRatingRect();
    }
}

// Design 1.
function layoutClassic() {
    var w = layoutWidth;
    var h = layoutHeight;
    var contentW, seekHeight, seekGap, seekY, controlsY, controlsHeight, controlsWidth;
    var mainH, artSize, exitX, exitSize, topContentRight, topContentWidth;
    var textX, textRight, infoW, controlsOverlapExit;
    var buttonSize, buttonGap, totalBtnW, startX, btnY;
    var transportRight, loveSize, loveY, leftRoom, rightRoom;
    var ratingWidth, ratingStarSize, ratingGap, showLove, showRating;

    activeLayoutIsCover = false;
    layoutRects.title = hiddenRect();
    layoutRects.artist = hiddenRect();

    contentW = Math.max(0, w - PAD * 2);
    exitSize = Math.min(EXIT_SIZE, Math.max(0, w - PAD * 2), Math.max(0, h - PAD * 2));
    controlsHeight = Math.min(CONTROLS_HEIGHT, Math.max(0, h - PAD));
    // Omit the strip when its labels would overlap the track, or when the
    // height/DPI cannot hold both fixed rows.
    seekHeight = contentW >= MIN_SEEK_WIDTH &&
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

    // On short/high-DPI sizes the transport row can rise into the exit
    // button's band; reserve its width rather than let the two overlap.
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
        exitBtn.fontKey = "icon";
    } else {
        hideButton(exitBtn);
    }

    if (layoutRects.controls.visible) {
        prevBtn.fontKey = "icon";
        playBtn.fontKey = "icon";
        nextBtn.fontKey = "icon";
        loveBtn.fontKey = "icon";
        // Shrink gap and hit box together rather than letting Next spill out.
        // At the default size this resolves to the full metrics.
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
            clearRatingRect();
        }
    } else {
        hideButton(prevBtn);
        hideButton(playBtn);
        hideButton(nextBtn);
        hideButton(loveBtn);
        clearRatingRect();
    }
}

// Painting

// Unscaled slack for ink past a section's rect (seekbar thumb, hover fill).
var PAINT_AREA_PAD = 12;

function on_paint(gr, x, y, width, height) {
    var relaid = false, area, pad;
    // A queued repaint can arrive after Show(false); don't let it wake us.
    if (!panelIsVisible()) return;

    // A native child rebuild can deliver a paint with no on_size, so reconcile
    // geometry here as a last line of defence.
    if (layoutWidth !== window.Width || layoutHeight !== window.Height) {
        updateDpiFromHeight();
        layout();
        relaid = true;
    }
    if (!marqueePrepared) {
        prepareMarquee();
        relaid = true;
    }
    startPendingArtRefresh();
    startSeekTickTimer();
    startMarqueeTimer();

    // Marquee, seekbar and artwork updates invalidate one section; skip the others.
    area = relaid ? null : RivageUI.paintArea(x, y, width, height, layoutWidth, layoutHeight);
    pad = _scale(PAINT_AREA_PAD);
    if (area) gr.PushClip(area.x, area.y, area.w, area.h);
    try {
        paintSections(gr, area, pad);
    } finally {
        if (area) gr.PopClip();
    }
}

function paintSections(gr, area, pad) {
    var i, btn, smoothingChanged = false;
    var hits = RivageUI.areaHits;

    // Rectangular backdrop before anti-aliasing: GDI+ shape smoothing filters the
    // DrawImage destination edge into a visible seam on the left and top rows.
    RivageBackdrop.paint(gr, 0, 0, Math.max(0, window.Width), Math.max(0, window.Height), theme.background);

    if (typeof gr.SetSmoothingMode === "function") {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    if (layoutRects.art && layoutRects.art.visible && hits(area, layoutRects.art, pad)) drawArt(gr, layoutRects.art);
    if (isCoverLayout()) drawCoverText(gr, area, pad);
    else if (layoutRects.info && layoutRects.info.visible && hits(area, layoutRects.info, pad)) drawTrackInfo(gr, layoutRects.info);
    if (layoutRects.seek && layoutRects.seek.visible && hits(area, layoutRects.seek, pad)) seekbar.draw(gr, layoutRects.seek, currentAccent());
    if (hits(area, layoutRects.rating, pad)) drawRating(gr);

    for (i = 0; i < allButtons.length; i++) {
        btn = allButtons[i];
        if (btn.w > 0 && hits(area, btn, pad)) drawIconButton(gr, btn);
    }

    if (smoothingChanged) {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
        } catch (e) {
            // Ignore graphics-state restoration failures.
        }
    }
}

// Menu - deliberately small; this view exists to get out of the way.

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

    // Matches Album Art, but only when the press began on the artwork.
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
    SharedThemeProtocol.requestRepaint();
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
    window.Repaint();
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
    window.Repaint();
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
    window.Repaint();
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
    // Scrolling titles stop or resume on the next paint.
    if (RivagePowerMode.consume(name, info)) { window.Repaint(); return; }
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

    // Adopt a global playback-statistics change immediately; the UPDATE
    // handshake stays the fallback for arbitrary load order.
    if (name === SettingsRegistry.VALUE_CHANGED && info && info.panelId === "global" &&
        PlaybackStatsSource.applySetting(info.settingId, info.value)) return;
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        refreshHostColours();
        if (panelIsVisible()) prepareMarquee();
        else resetMarquee();
        window.Repaint();
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
