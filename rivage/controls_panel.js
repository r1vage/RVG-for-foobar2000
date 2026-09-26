window.DrawMode = 0;

include(fb.ProfilePath + "jsplitter\\rivage\\shared\\ui_scale.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\power_mode.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\foobar_actions.js");

// JSplitter requires the drawing-mode assignment as the first executable line.
include("docs/Helpers.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\track_context.js");
// Optional seekbar below the rating stars - must come after settings_protocol.js, see
// seekbar_widget.js's own header comment for why.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\seekbar_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\volume_bar_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\marquee_widget.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\queue_peek_protocol.js");

const TEXT_FLAGS = RivageUI.textFlags;
// Unscaled slack for ink past a section's rect (seekbar thumb, button rims).
const PAINT_AREA_PAD = 12;
const FILL_MODE_WINDING = 1;
const MENU_STRING = 0x00000000;
const MENU_GRAYED = 0x00000001;
const MENU_CHECKED = 0x00000008;
const DLG_CODE_WANT_ALL_KEYS = 0x0004;
window.DlgCode = DLG_CODE_WANT_ALL_KEYS;
// GdiGraphics#SetTextRenderingHint (see docs/Flags.js's TextRenderingHint enum). GDI+ only
// applies its nice ClearType/grid-fit text rendering by default on a live screen device
// context; a Graphics object created from an off-screen bitmap (gdi.CreateImage(...).GetGraphics())
// silently falls back to TextRenderingHint.SystemDefault's bilevel/aliased mode unless told
// otherwise. The title marquee below pre-renders text onto exactly such a bitmap, which is
// why its text looked visibly "edgier" than the live-drawn (non-scrolling) title.
const TEXT_RENDERING_HINT_ANTIALIAS = 4;

// Track title/artist/album, rating, transport controls and the optional
// seek/volume bars. This panel deliberately owns NO track or file actions:
// no left-side button rail, and no action items in its own right-click menu.
// Those belong to foobar2000's context menu and to custom-buttons.js.
window.DefineScript(RivageUI.copy.popupTitle("Player"), {
    author: "RivaGe",
    version: "4.7.0",
    options: { grab_focus: false }
});

// Narrow failure reporting. Most empty catches in this file guard host calls
// that are *expected* to fail (probing an optional API, clearing a timer,
// SetCursor mid-teardown) and stay silent on purpose. This is for the few
// that mean something is actually broken and would otherwise leave no trace.
// Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = "[RVG Player] " + what +
        (err === undefined || err === null ? "" : ": " + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + " (x" + seen + ")"); } catch (e) { }
}


const COMMANDS = RivageCommands.COMMANDS;

const UI = Object.freeze({
    referenceWidth: 500,
    referenceHeight: 350,
    minimumScale: 0.7,
    maximumScale: 1.40,

    buttonRadius: 2,
    buttonIndicatorHeight: 3,
    buttonIndicatorWidthRatio: 0.34,

    contentMarginLeft: 4,
    contentMarginRight: 20,
    contentTop: 38,

    titleHeight: 40,
    artistHeight: 31,
    albumHeight: 32,
    titleArtistGap: 4,
    artistAlbumGap: 3,

    transportButton: 26,
    playButton: 38,
    stopButton: 38,
    transportGap: 8,
    controlsPaddingX: 1,
    controlsPaddingY: 4,
    controlsRadius: 3,
    controlsTopGap: 18,
    controlsYRatio: 0.62,

    // The strip above the title holds the "No ReplayGain" badge and the queue's
    // "Next" line; sharing a row, they are centred together as one group.
    nextBadgeGap: 12,
    badgeHeight: 20,
    badgeTop: 9,
    badgePaddingX: 9,
    badgeGlyphGap: 5,

    ratingHeight: 26,
    ratingGap: 10,
    ratingStarSize: 22,
    ratingStarGap: 3,

    seekbarGap: 10,
    seekbarHeight: 36,
    volumeBarGap: 4,
    volumeBarHeight: 30,

    bottomMargin: 8
});

const FONT_SIZES = Object.freeze({
    title: 26,
    next: 13,
    artist: 21,
    album: 17,
    emptyTitle: 20,
    emptySubtitle: 12,
    transportIcon: 15,
    primaryIcon: 18,
    badge: 12,
    badgeGlyph: 11,
    musicIcon: 36,
    tooltip: 12
});

// Shown when %__replaygain_track_gain% is "?" - the track carries no ReplayGain
// tags, so foobar2000 cannot level it. Replaces the unlabelled red edge stripe
// this panel drew until v4.4.0.
const REPLAYGAIN_BADGE = Object.freeze({
    text: "No ReplayGain",
    glyph: "\uE7BA",
    tooltip: "This track has no ReplayGain information, so it plays at its raw volume.\n" +
        "Right-click \u203A ReplayGain \u203A Scan per-file track gain adds them.",
    fillAlpha: 38,
    strokeAlpha: 120
});


// v3.0.0 moved this panel off the legacy "UWP Playing Info v2.2." namespace
// with no fallback read, so an existing profile starts from defaults here.
const PROPERTY_PREFIX = "RIVAGE.PLAYING_INFO.";

const SEEKBAR_WIDTH_PERCENT_MIN = 30;
const SEEKBAR_WIDTH_PERCENT_MAX = 100;
const SEEKBAR_WIDTH_PERCENT_DEFAULT = 100;

const settings = {
    // 1 = Windows blue, 2 = custom, 3 = shared album-art accent.
    accentPreset: clampNumber(window.GetProperty(PROPERTY_PREFIX + "Accent preset", 1), 0, 3),
    customAccent: Number(window.GetProperty(PROPERTY_PREFIX + "Custom accent", RivageUI.rgb(0, 120, 212))),

    controlStyle: clampNumber(window.GetProperty(PROPERTY_PREFIX + "Control style", 1), 0, 1),

    elementBorders: !!window.GetProperty(PROPERTY_PREFIX + "Element borders", false),

    showReplayGainWarning: !!window.GetProperty(PROPERTY_PREFIX + "Show ReplayGain warning", true),

    showSeekbar: !!window.GetProperty(PROPERTY_PREFIX + "Show seekbar", false),
    showVolumeBar: !!window.GetProperty(PROPERTY_PREFIX + "Show volume bar", false),

    seekbarWidthPercent: Math.round(clampNumber(
        window.GetProperty(PROPERTY_PREFIX + "Seekbar width percent", SEEKBAR_WIDTH_PERCENT_DEFAULT),
        SEEKBAR_WIDTH_PERCENT_MIN,
        SEEKBAR_WIDTH_PERCENT_MAX
    )),



    fontOverride: String(window.GetProperty(PROPERTY_PREFIX + "Font override", "") || "").trim()
};

function saveSetting(name, value) {
    window.SetProperty(PROPERTY_PREFIX + name, value);
}

function commitSetting(key, propertyName, value) {
    if (settings[key] === value) return false;
    saveSetting(propertyName, value);
    settings[key] = value;
    return true;
}

function commitTrackContextOverride(value) {
    const next = TrackContext.normaliseOverride(value);
    if (trackContextOverride === next) return false;
    window.SetProperty(PROPERTY_PREFIX + "Track context override", next);
    trackContextOverride = next;
    return true;
}

function commitCustomAccent(value) {
    const nextColour = Number(value);
    const nextPreset = 2;
    if (!Number.isFinite(nextColour)) return false;
    if (settings.customAccent === nextColour && settings.accentPreset === nextPreset) return false;

    const colourKey = PROPERTY_PREFIX + "Custom accent";
    const presetKey = PROPERTY_PREFIX + "Accent preset";
    const previousColour = window.GetProperty(colourKey, settings.customAccent);
    const previousPreset = window.GetProperty(presetKey, settings.accentPreset);
    let colourWritten = false;
    try {
        window.SetProperty(colourKey, nextColour);
        colourWritten = true;
        window.SetProperty(presetKey, nextPreset);
    } catch (e) {
        if (colourWritten) {
            try { window.SetProperty(colourKey, previousColour); } catch (rollbackError) { reportFailure("the accent colour rollback could not be saved", rollbackError); }
        }
        try { window.SetProperty(presetKey, previousPreset); } catch (rollbackError2) { reportFailure("the accent preset rollback could not be saved", rollbackError2); }
        throw e;
    }

    settings.customAccent = nextColour;
    settings.accentPreset = nextPreset;
    return true;
}

const SETTINGS_PANEL_ID = "controls";
const SETTINGS_PANEL_LABEL = "Player";

function getMySettings() {
    return [
        {
            id: "accentPreset", label: "Accent colour", type: "choice",
            value: settings.accentPreset === 0 ? "red" :
                settings.accentPreset === 2 ? "custom" :
                settings.accentPreset === 3 ? "shared" : "blue",
            choiceValueType: "string",
            section: "General",
            choices: [
                { value: "red", label: "Classic red" },
                { value: "blue", label: RivageUI.copy.labels.rvgBlue },
                { value: "custom", label: "Custom colour" },
                { value: "shared", label: RivageUI.copy.labels.sharedAccent }
            ]
        },
        {
            id: "controlStyle", label: "Icon style", type: "choice",
            value: settings.controlStyle === 1 ? "monochrome" : "fluent",
            choiceValueType: "string",
            section: "General",
            choices: [
                { value: "fluent", label: "Fluent icons" },
                { value: "monochrome", label: "Filled transport icons" }
            ]
        },
        { id: "elementBorders", label: "Show control borders", type: "bool", value: settings.elementBorders, section: "General" },
        {
            id: "showReplayGainWarning", label: "Warn when the track has no ReplayGain", type: "bool",
            value: settings.showReplayGainWarning,
            hint: "Shows a \"No ReplayGain\" badge above the title for unscanned tracks.",
            section: "General"
        },
        { id: "showSeekbar", label: "Show seekbar below ratings", type: "bool", value: settings.showSeekbar, section: "General" },
        { id: "showVolumeBar", label: "Show volume bar below ratings", type: "bool", value: settings.showVolumeBar, section: "General" },
        {
            id: "seekbarWidthPercent", label: "Seekbar and volume width (%)", type: "number",
            value: settings.seekbarWidthPercent,
            min: SEEKBAR_WIDTH_PERCENT_MIN, max: SEEKBAR_WIDTH_PERCENT_MAX, step: 5,
            section: "General"
        },
        {
            id: "trackSourceOverride", label: "Track source", type: "choice",
            value: trackContextOverride, choiceValueType: "string", choices: TrackContext.getOverrideChoices(),
            section: "General"
        },
        {
            id: "fontOverride", label: "Font family", type: "string",
            value: settings.fontOverride,
            hint: "Leave blank to use Columns UI \u203A Core: Default.",
            section: "General"
        },
        {
            id: "customAccent", label: "Custom accent colour", type: "colour",
            value: settings.customAccent,
            hidden: settings.accentPreset !== 2,
            section: "General"
        },
    ];
}

function applyMySetting(settingId, value) {
    let changed = false;
    switch (settingId) {
    case "accentPreset": {
        const next = value === "red" ? 0 : value === "custom" ? 2 : value === "shared" ? 3 : 1;
        changed = commitSetting("accentPreset", "Accent preset", next);
        if (!changed) return;
        pendingVisibleWork.requestAccent = next === 3;
        pendingVisibleWork.theme = true;
        break;
    }
    case "customAccent":
        changed = commitCustomAccent(Number(value));
        if (!changed) return;
        pendingVisibleWork.theme = true;
        break;
    case "controlStyle":
        changed = commitSetting("controlStyle", "Control style", value === "monochrome" ? 1 : 0);
        break;
    case "elementBorders":
        changed = commitSetting("elementBorders", "Element borders", !!value);
        break;
    case "showReplayGainWarning":
        changed = commitSetting("showReplayGainWarning", "Show ReplayGain warning", !!value);
        break;
    case "showSeekbar":
        changed = commitSetting("showSeekbar", "Show seekbar", !!value);
        if (changed) {
            markLayoutDirty(false);
            if (!settings.showSeekbar) stopSeekbarTickTimer();
        }
        break;
    case "showVolumeBar":
        changed = commitSetting("showVolumeBar", "Show volume bar", !!value);
        if (changed) markLayoutDirty(false);
        break;
    case "seekbarWidthPercent": {
        const next = Math.round(clampNumber(value, SEEKBAR_WIDTH_PERCENT_MIN, SEEKBAR_WIDTH_PERCENT_MAX));
        changed = commitSetting("seekbarWidthPercent", "Seekbar width percent", next);
        if (changed) markLayoutDirty(false);
        break;
    }
    case "trackSourceOverride":
        if (!commitTrackContextOverride(value)) return;
        queueTrackState(true);
        return;
    case "fontOverride":
        changed = commitSetting("fontOverride", "Font override", String(value || "").trim());
        if (changed) markLayoutDirty(false);
        break;
    default:
        return;
    }
    if (changed) requestVisibleRepaint(true);
}


const ACCENTS = Object.freeze({
    blue: RivageUI.DEFAULT_ACCENT,
    red: RivageUI.rgb(232, 17, 35)
});
// Shared Album Accent consumer. JSPlaylist performs the artwork decoding and
// broadcasts the colour; this panel only receives and applies it.
let sharedAlbumAccent = RivageUI.DEFAULT_ACCENT;

function requestAlbumAccent() {
    SharedAccentProtocol.requestAccent();
}

let theme = RivageUI.createTheme({ mode: "host", accent: ACCENTS.blue });
const ui = RivageUI.createPainter({ scale: px, theme: theme });

const GLYPHS = RivageUI.icons;

const tfo = Object.freeze({
    artist: fb.TitleFormat("%artist%"),
    albumArtist: fb.TitleFormat("$if2(%album artist%,%artist%)"),
    // Raw tag only (no artist fallback) - used to tell whether ALBUM ARTIST is actually
    // populated in the library, so query-building code can fall back to ARTIST instead of
    // searching for an ALBUM ARTIST value that only exists via display-time formatting.
    albumArtistRaw: fb.TitleFormat("%album artist%"),
    title: fb.TitleFormat("%title%"),
    album: fb.TitleFormat("%album%"),
    date: fb.TitleFormat("%date%"),
    genre: fb.TitleFormat("%genre%"),

    trackGain: fb.TitleFormat("%__replaygain_track_gain%"),
    ratingPlaybackStatistics: fb.TitleFormat("%rating%"),
    ratingPlaycount2003: fb.TitleFormat("%2003_rating%")
});

let trackContextOverride = TrackContext.normaliseOverride(window.GetProperty(PROPERTY_PREFIX + "Track context override", ""));
if (window.GetProperty(PROPERTY_PREFIX + "Track context override", "") === "") {
    try {
        trackContextOverride = Number(window.GetProperty("2K3.PANEL.SELECTION", 0)) === 1 ?
            TrackContext.MODE_SELECTION : TrackContext.MODE_GLOBAL;
    } catch (e) {
        trackContextOverride = TrackContext.MODE_GLOBAL;
    }
    window.SetProperty(PROPERTY_PREFIX + "Track context override", trackContextOverride);
}
let ww = 0;
let wh = 0;
let handle = null;
let handleUsesNowPlaying = false;
let currentItemKey = "";

// During a next/previous handoff, foobar2000 can briefly expose no
// now-playing handle. Retain the outgoing metadata until the incoming
// track is available so the panel does not flash its empty state.
let playbackTransitionPending = false;
let pendingPlaybackHandle = null;

const seekbarWidget = SeekbarWidget.create();

const volumeBarWidget = VolumeBarWidget.create({ matchSeekbarTrack: true });

const mouse = { x: -1, y: -1 };

const cache = {
    title: "",
    artist: "",
    albumArtist: "",
    albumArtistRaw: "",
    album: "",
    date: "",
    albumDate: "",
    genre: "",

    trackGain: "",
    rating: 0
};

// First queued item: always what plays next, whatever the playback order.
const queueNext = { text: "", count: 0 };
const NEXT_TF = fb.TitleFormat("[%artist% \u2013 ]$if2(%title%,$filename(%path%))");

function refreshQueueNext() {
    let count = 0;
    let text = "";
    try {
        const items = plman.GetPlaybackQueueContents();
        count = items.length;
        if (count) text = safeText(NEXT_TF.EvalWithMetadb(items[0].Handle));
    } catch (e) {
        reportFailure("the playback queue could not be read", e);
    }
    const presenceChanged = !!count !== !!queueNext.count;
    queueNext.count = count;
    queueNext.text = count ? "Next \u00B7 " + text + (count > 1 ? "  \u00B7  +" + (count - 1) : "") : "";
    return presenceChanged;
}

function nextLineVisible() {
    return !!(handle && queueNext.count && layout.next);
}

function replayGainWarningWanted() {
    return !!(settings.showReplayGainWarning && handle && cache.trackGain === "?");
}

// Places the Next line and the badge in the strip above the title. Nothing
// else moves, so the queue appearing or emptying never shifts the layout.
let topStripKey = "";
function arrangeTopStrip(force = false) {
    const base = layout.replayGainBadgeBase;
    const badgeShown = !!base && replayGainWarningWanted();
    const key = [queueNext.text, badgeShown, layout.mainX, layout.mainW, base ? base.rect.y : -1, fonts.next ? fonts.titlePx : 0].join("\u001f");
    if (!force && key === topStripKey) return;
    topStripKey = key;

    layout.replayGainBadge = base;
    layout.next = null;
    if (!queueNext.count || !base || !fonts.next || layout.mainW <= 0) return;

    const y = base.rect.y;
    const h = base.rect.h;
    if (!badgeShown) {
        layout.next = makeRect(layout.mainX, y, layout.mainW, h);
        layout.nextFlags = TEXT_FLAGS.centeredEllipsis;
        return;
    }

    const gap = px(UI.nextBadgeGap);
    const textW = Math.max(0, Math.min(
        Math.ceil(measureTextWidth(queueNext.text, fonts.next)) + px(2),
        layout.mainW - base.rect.w - gap
    ));
    const startX = layout.mainX + Math.round((layout.mainW - textW - gap - base.rect.w) / 2);
    const shift = startX + textW + gap - base.rect.x;
    layout.next = makeRect(startX, y, textW, h);
    layout.nextFlags = TEXT_FLAGS.leftCenteredEllipsis;
    layout.replayGainBadge = {
        rect: makeRect(base.rect.x + shift, y, base.rect.w, h),
        glyphX: base.glyphX + shift,
        glyphW: base.glyphW,
        textX: base.textX + shift,
        textW: base.textW
    };
}

const layout = {
    scale: 1,
    mainX: 0,
    mainW: 0,

    next: null,
    title: null,
    artist: null,
    album: null,
    information: null,

    controls: null,
    replayGainBadge: null,
    replayGainBadgeBase: null,
    nextFlags: 0,
    rating: null,
    ratingStarX: 0,
    ratingStarSize: 0,
    ratingStarGap: 0,
    seekbar: null,
    volumeBar: null
};

const fonts = {
    next: null,
    title: null,
    artist: null,
    album: null,
    emptyTitle: null,
    emptySubtitle: null,
    transportIcon: null,
    primaryIcon: null,
    badge: null,
    badgeGlyph: null,
    star: null,
    music: null,
    tooltip: null,
    titlePx: 0
};

let fontNames = {
    title: "Segoe UI",
    body: "Segoe UI",
    icon: "Segoe Fluent Icons"
};

//
// JSplitter can Move() a hidden child without delivering a useful on_size pass
// to that child's script. The old implementation therefore kept stale ww/wh
// values and could reopen with the layout from its previous slot. The actual
// window.Width/window.Height values are now treated as authoritative on every
// visible paint. Expensive title-format/cache/theme work is also queued while
// hidden and consumed once, immediately before that first visible paint.

const pendingVisibleWork = {
    queue: true,
    trackState: false,
    requestAccent: false,
    hostColours: false,
    theme: false,
    font: false
};

let layoutDirty = true;
let seekbarTickTimer = null;
let scriptActive = true;
let callbackGeneration = 0;
let oneShotTimers = [];

function schedulePanelTimeout(callback, delay) {
    const generation = callbackGeneration;
    let id = null;
    id = window.SetTimeout(() => {
        const at = oneShotTimers.indexOf(id);
        if (at >= 0) oneShotTimers.splice(at, 1);
        if (!scriptActive || generation !== callbackGeneration) return;
        callback();
    }, delay);
    oneShotTimers.push(id);
    return id;
}

function clearPanelTimeouts() {
    callbackGeneration += 1;
    for (const id of oneShotTimers) {
        try { window.ClearTimeout(id); } catch (e) { }
    }
    oneShotTimers = [];
}

// Button enablement is queried on every paint. Several utility buttons share
// the exact same "selected playlist item or displayed handle" condition, so
// cache that condition until an event can actually change it. This avoids five
// repeated plman.GetPlaylistSelectedItems() calls on every marquee/seekbar paint.

// IsMainMenuCommandChecked() crosses into the host. Cache the stop-after state
// between the callbacks/toggles that can change it instead of querying it on
// every animation repaint.

function hostIsVisible() {
    try {
        let visible = window.IsVisible;
        if (typeof visible === "function") visible = visible();
        if (visible === undefined || visible === null) return true;
        return !!visible;
    } catch (e) {
        // Older host builds may not expose IsVisible. Preserve legacy behaviour.
        return true;
    }
}

function requestVisibleRepaint(force = false) {
    if (!hostIsVisible()) return false;
    try {
        window.Repaint(!!force);
        return true;
    } catch (e) {
        return false;
    }
}

function markLayoutDirty(requestRepaint = true) {
    layoutDirty = true;
    if (requestRepaint) requestVisibleRepaint(true);
}

function queueTrackState(requestAccent, preferredHandle = null) {
    pendingVisibleWork.trackState = true;
    if (preferredHandle) pendingPlaybackHandle = preferredHandle;
    if (requestAccent && settings.accentPreset === 3) pendingVisibleWork.requestAccent = true;
    requestVisibleRepaint();
}

function readHostDimension(value, fallback) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    return Math.max(0, Math.floor(Number(fallback) || 0));
}

function syncLayoutToHostFromPaint(force = false) {
    const nextW = readHostDimension(window.Width, ww);
    const nextH = readHostDimension(window.Height, wh);

    if (nextW !== ww || nextH !== wh) {
        ww = nextW;
        wh = nextH;
        layoutDirty = true;
    }

    if (!force && !layoutDirty) return false;
    if (ww <= 0 || wh <= 0) return false;

    layoutDirty = false;
    layoutUi();
    return true;
}

// Returns true when anything was applied, which makes this paint a full one.
function flushVisibleWorkFromPaint() {
    if (!hostIsVisible()) return false;
    const pending = pendingVisibleWork.font || pendingVisibleWork.hostColours ||
        pendingVisibleWork.theme || pendingVisibleWork.trackState || pendingVisibleWork.queue;

    if (pendingVisibleWork.queue) {
        pendingVisibleWork.queue = false;
        if (refreshQueueNext()) layoutDirty = true;
    }

    if (pendingVisibleWork.font) {
        pendingVisibleWork.font = false;
        layoutDirty = true;
    }

    if (pendingVisibleWork.hostColours) {
        pendingVisibleWork.hostColours = false;
        refreshHostBackground();
        pendingVisibleWork.theme = true;
    }

    if (pendingVisibleWork.theme) {
        pendingVisibleWork.theme = false;
        refreshTheme();
        prepareMarquee();
    }

    const refreshTrack = pendingVisibleWork.trackState;
    const preferredTrackHandle = pendingPlaybackHandle;
    pendingVisibleWork.trackState = false;
    pendingPlaybackHandle = null;
    if (refreshTrack) syncTrackState(true, preferredTrackHandle);

    const laidOut = syncLayoutToHostFromPaint(false);
    if (refreshTrack && !laidOut) prepareMarquee();

    if (pendingVisibleWork.requestAccent) {
        pendingVisibleWork.requestAccent = false;
        requestAlbumAccent();
    }
    return pending || laidOut;
}


function clampNumber(value, minimum, maximum) {
    return RivageUI.clamp(value, minimum, maximum);
}

function currentDpi() {
    const dpi = RivageScale.dpi();
    return Number.isFinite(dpi) && dpi > 0 ? dpi : 72;
}

function hostScale(value) {
    return Math.round(Number(value) * currentDpi() / 72);
}

function px(value) {
    if (Number(value) === 0) return 0;
    return Math.max(1, Math.round(hostScale(value) * layout.scale));
}

const makeRect = RivageUI.rect;
const pointInRect = RivageUI.pointInRect;
const mixColour = RivageUI.mix;

function barInputOuter(widget, outer, x, y) {
    if (!outer) return null;
    if (widget && (widget.drag || widget.rdrag)) return outer;
    return pointInRect(x, y, outer) ? outer : null;
}

function currentPanelAccent() {
    if (settings.accentPreset === 1) return ACCENTS.blue;
    if (settings.accentPreset === 2) return Number(settings.customAccent);
    if (settings.accentPreset === 3) return Number(sharedAlbumAccent);
    return ACCENTS.red;
}

let hostBackground = RivageUI.createTheme({ mode: "host", ignoreSharedTheme: true }).background;

function refreshHostBackground() {
    hostBackground = RivageUI.createTheme({ mode: "host", ignoreSharedTheme: true }).background;
}

function refreshTheme() {
    const sharedTheme = SharedThemeProtocol.current();
    const themeOptions = {
        mode: "host",
        accent: currentPanelAccent()
    };

    // Panel defaults should continue to use the cached host background, but an
    // explicit shared theme must own its background. Passing hostBackground for
    // RVG dark/light overrides the shared mode inside createTheme(), leaving the
    // Player stuck on the host colour (for example 39,39,39).
    if (!sharedTheme || sharedTheme.mode === "existing") {
        themeOptions.background = hostBackground;
    }

    theme = RivageUI.createTheme(themeOptions);

    theme.monoSurface = mixColour(
        theme.navigationSurface,
        theme.navigationTextPrimary,
        theme.dark ? 0.11 : 0.07
    );

    ui.setTheme(theme);
}

function resolveBodyFontName() {
    if (settings.fontOverride) {
        try {
            if (utils.CheckFont(settings.fontOverride)) return settings.fontOverride;
        } catch (e) { }
    }
    return RivageUI.hostFontFamily() || "Segoe UI";
}

function buildFonts() {
    const baseFontName = resolveBodyFontName();
    fontNames.title = baseFontName;
    fontNames.body = baseFontName;
    fontNames.icon = RivageUI.iconFontFamily();

    fonts.titlePx = px(FONT_SIZES.title);
    fonts.title = RivageUI.font(fontNames.title, fonts.titlePx, 1);
    fonts.next = RivageUI.font(fontNames.body, px(FONT_SIZES.next), 0);
    fonts.artist = RivageUI.font(fontNames.body, px(FONT_SIZES.artist), 0);
    fonts.album = RivageUI.font(fontNames.body, px(FONT_SIZES.album), 0);
    fonts.emptyTitle = RivageUI.font(fontNames.body, px(FONT_SIZES.emptyTitle), 1);
    fonts.emptySubtitle = RivageUI.font(fontNames.body, px(FONT_SIZES.emptySubtitle), 0);
    fonts.badge = RivageUI.font(fontNames.body, px(FONT_SIZES.badge), 0);
    fonts.badgeGlyph = RivageUI.font(fontNames.icon, px(FONT_SIZES.badgeGlyph), 0);
    fonts.transportIcon = RivageUI.font(fontNames.icon, px(FONT_SIZES.transportIcon), 0);
    fonts.primaryIcon = RivageUI.font(fontNames.icon, px(FONT_SIZES.primaryIcon), 0);
    fonts.star = RivageUI.font(fontNames.icon, px(UI.ratingStarSize), 0);
    fonts.music = RivageUI.font("Segoe UI Symbol", px(FONT_SIZES.musicIcon), 0);
    const consoleFont = RivageUI.consoleFontInfo();
    fonts.tooltip = RivageUI.font(consoleFont.fontFamily, consoleFont.fontSize, consoleFont.fontStyle || 0);
}

function ensureFonts() {
    const required = [
        "next", "title", "artist", "album", "emptyTitle", "emptySubtitle",
        "transportIcon", "primaryIcon", "star", "music", "tooltip"
    ];
    if (required.every(key => !!fonts[key])) return false;

    buildFonts();
    if (fonts.title) prepareMarquee();
    return required.every(key => !!fonts[key]);
}

function safeText(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    if (!text || text === "?") return fallback;
    return text;
}

function getHandleKey(metadb) {
    if (!metadb) return "";
    try {
        return String(metadb.RawPath || metadb.Path || "") + "\n" + String(metadb.SubSong || 0);
    } catch (e) {
        return "";
    }
}

function followsPlayback() {
    return TrackContext.followsPlayback(trackContextOverride);
}

function evalTf(formatter) {
    if (!handle) return "";

    try {
        if (handleUsesNowPlaying) return formatter.Eval();
    } catch (e) {
        // Fall back to evaluation against the cached handle.
    }

    try {
        return formatter.EvalWithMetadb(handle);
    } catch (e) {
        return "";
    }
}

function evalTfWithMetadb(formatter, metadb) {
    if (!formatter || !metadb) return "";
    try {
        return formatter.EvalWithMetadb(metadb);
    } catch (e) {
        return "";
    }
}

function clearCache() {
    cache.title = "";
    cache.artist = "";
    cache.albumArtist = "";
    cache.albumArtistRaw = "";
    cache.album = "";
    cache.date = "";
    cache.albumDate = "";
    cache.genre = "";

    cache.trackGain = "";
    cache.rating = 0;
}

function parseRating(value) {
    const number = Number.parseInt(String(value || "0"), 10);
    return Number.isFinite(number) ? clampNumber(number, 0, 5) : 0;
}

function refreshCache(explicitMetadb = null) {
    if (!handle) {
        clearCache();
        return;
    }

    const evaluate = explicitMetadb
        ? formatter => evalTfWithMetadb(formatter, explicitMetadb)
        : evalTf;
    cache.title = safeText(evaluate(tfo.title), "Unknown title");
    cache.artist = safeText(evaluate(tfo.artist), "Unknown artist");
    cache.albumArtist = safeText(evaluate(tfo.albumArtist), cache.artist);
    cache.albumArtistRaw = safeText(evaluate(tfo.albumArtistRaw), "");
    cache.album = safeText(evaluate(tfo.album));
    cache.date = safeText(evaluate(tfo.date));
    cache.genre = safeText(evaluate(tfo.genre));
    cache.albumDate = cache.album && cache.date
        ? cache.album + "  \u00B7  " + cache.date
        : (cache.album || cache.date || cache.genre);

    // Keep the literal question mark so the ReplayGain warning can detect it.
    cache.trackGain = String(evaluate(tfo.trackGain) || "");

    cache.rating = PlaybackStatsSource.isPlaycount2003() ?
        parseRating(evaluate(tfo.ratingPlaycount2003)) :
        parseRating(evaluate(tfo.ratingPlaybackStatistics));
}

function syncTrackState(deferMarquee = false, preferredHandle = null) {
    const playbackContext = followsPlayback();
    const resolved = preferredHandle && playbackContext
        ? { handle: preferredHandle, isNowPlaying: true }
        : TrackContext.resolve(trackContextOverride);
    let nextHandle = resolved.handle;
    let nextUsesNowPlaying = resolved.isNowPlaying;
    // The callback handle (or fb.GetNowPlaying()) can lead the ordinary resolver by one
    // callback while a playback-driven context is handing off to a new track.
    if (!nextHandle && playbackContext) {
        try {
            if (fb.IsPlaying) {
                nextHandle = fb.GetNowPlaying() || null;
                nextUsesNowPlaying = !!nextHandle;
            }
        } catch (e) { }
    }

    // Keep outgoing metadata only while an explicit playback handoff is active.
    if (!nextHandle && playbackTransitionPending && handle && playbackContext) {
        if (!deferMarquee) prepareMarquee();
        return false;
    }

    if (nextHandle && playbackContext) playbackTransitionPending = false;

    const nextKey = getHandleKey(nextHandle);
    const changed = nextKey !== currentItemKey;

    handle = nextHandle;
    handleUsesNowPlaying = !!(nextHandle && nextUsesNowPlaying);
    currentItemKey = nextKey;
    const callbackHandleIsAhead = !!(preferredHandle && playbackContext && nextHandle === preferredHandle);
    refreshCache(callbackHandleIsAhead ? nextHandle : null);
    refreshInteractiveButtons();

    if (changed) resetMarquee();
    refreshPointerState();
    if (!deferMarquee) prepareMarquee();
    return changed;
}

function getSelectedPlaylistHandles() {
    return RivageCommands.getSelectedPlaylistHandles();
}

function getCurrentHandleList() {
    return RivageCommands.getHandleList(handle);
}

function getTargetHandles() {
    return RivageCommands.getTargetHandles(handle);
}

function runContextCommandWithHandles(command, items, flags = 8) {
    return RivageCommands.runContextWithHandles(command, items, {
        flags: flags,
        panelTitle: RivageUI.copy.popupTitle("Player")
    });
}

function runMainMenuCommand(command) {
    return RivageCommands.runMain(command, { panelTitle: RivageUI.copy.popupTitle("Player") });
}

function showPanelConfiguration() {
    if (typeof window.ShowConfigureV2 === "function") {
        window.ShowConfigureV2();
    } else if (typeof window.ShowConfigure === "function") {
        window.ShowConfigure();
    }
}

function editPanelScript() {
    if (typeof window.EditScript === "function") {
        window.EditScript();
    } else {
        showPanelConfiguration();
    }
}


const MARQUEE = Object.freeze({
    interval: 33,
    speed: 41,
    pause: 1400,
    maxDelta: 100
});

// Skip marquee timer work while this panel is hidden behind another tab (it can't be
// seen anyway, so there's nothing to animate or repaint). Set to false to fully disable
// this optimization if it ever causes problems.
const SKIP_WORK_WHEN_HIDDEN = true;

const titleMarquee = MarqueeWidget.create({
    interval: MARQUEE.interval,
    speed: MARQUEE.speed,
    pause: MARQUEE.pause,
    maxDelta: MARQUEE.maxDelta,
    gap: 54,
    isVisible: hostIsVisible,
    skipWorkWhenHidden: SKIP_WORK_WHEN_HIDDEN,
    // This panel's timer fully stops (rather than just skipping its tick body)
    // while hidden; on_paint's "if (titleMarquee.isActive()) startMarqueeTimer();"
    // call is what restarts it on the first subsequent visible paint.
    stopTimerWhenHidden: true,
    speedScale: () => layout.scale,
    onTick: () => {
        if (layout.title) {
            window.RepaintRect(layout.title.x, layout.title.y, layout.title.w, layout.title.h);
        }
    }
});

function stopMarqueeTimer() {
    titleMarquee.stopTimer();
}

function resetMarquee() {
    titleMarquee.reset();
}

function startMarqueeTimer() {
    titleMarquee.startTimer();
}

function measureTextWidth(text, font) {
    return RivageUI.measureText(text, font, true);
}

const HOVER_ZONE_PADDING = 6; // logical px each side, purely forgiveness around the glyphs.

const hoverHit = {
    next: { rect: null, text: null, font: null, x: 0, y: 0, w: 0, h: 0 },
    title: { rect: null, text: null, font: null, x: 0, y: 0, w: 0, h: 0 },
    artist: { rect: null, text: null, font: null, x: 0, y: 0, w: 0, h: 0 },
    album: { rect: null, text: null, font: null, x: 0, y: 0, w: 0, h: 0 }
};

function hoverRectFor(key, text, font, row) {
    if (!row || row.w <= 0 || !font) return row;

    if (key === "title" && titleMarquee.isActive()) return row;

    const hit = hoverHit[key];
    const changed = hit.text !== text || hit.font !== font ||
        hit.x !== row.x || hit.y !== row.y || hit.w !== row.w || hit.h !== row.h;

    if (changed) {
        const textW = text ? Math.ceil(measureTextWidth(text, font)) : 0;
        const paddedW = textW > 0 ? textW + px(HOVER_ZONE_PADDING) * 2 : 0;
        const hitW = clampNumber(paddedW, 0, row.w);
        hit.rect = makeRect(row.x + Math.round((row.w - hitW) / 2), row.y, hitW, row.h);
        hit.text = text;
        hit.font = font;
        hit.x = row.x;
        hit.y = row.y;
        hit.w = row.w;
        hit.h = row.h;
    }

    return hit.rect;
}

function nextHoverRect() {
    if (!nextLineVisible()) return null;
    return hoverRectFor("next", queueNext.text, fonts.next, layout.next);
}
function titleHoverRect() {
    return hoverRectFor("title", cache.title, fonts.title, layout.title);
}
function artistHoverRect() {
    return hoverRectFor("artist", cache.artist, fonts.artist, layout.artist);
}
function albumHoverRect() {
    return hoverRectFor("album", cache.albumDate, fonts.album, layout.album);
}

function prepareMarquee() {
    if (!handle || !cache.title || !layout.title || !fonts.title || layout.title.w <= 0) {
        resetMarquee();
        return;
    }

    // Without SetTextRenderingHint, GDI+ renders text onto a fresh off-screen
    // bitmap with aliased/bilevel hinting instead of antialiasing - see
    // TEXT_RENDERING_HINT_ANTIALIAS's comment above.
    titleMarquee.prepare(cache.title, fonts.title, layout.title, {
        measureText: measureTextWidth,
        scale: px,
        textColour: theme.textPrimary,
        textY: (imageHeight) => Math.max(0, Math.round((imageHeight - fonts.titlePx * 1.30) / 2)),
        textRenderingHint: TEXT_RENDERING_HINT_ANTIALIAS
    });
}


function fillSolidTriangle(gr, direction, cx, cy, width, height, colour) {
    if (typeof gr.FillPolygon !== "function") return false;

    const halfW = width / 2;
    const halfH = height / 2;
    // JSplitter/SMP expects a flat x/y coordinate array. Sub-pixel values
    // are retained so GDI+ can antialias the sloped edges cleanly.
    const points = direction < 0
        ? [
            cx + halfW, cy - halfH,
            cx + halfW, cy + halfH,
            cx - halfW, cy
        ]
        : [
            cx - halfW, cy - halfH,
            cx - halfW, cy + halfH,
            cx + halfW, cy
        ];

    gr.FillPolygon(colour, FILL_MODE_WINDING, points);
    return true;
}

function fillRoundedBar(gr, x, y, w, h, colour) {
    const radius = Math.max(1, Math.min(w, h) * 0.34);
    gr.FillRoundRect(x, y, w, h, radius, radius, colour);
}

function drawSolidTransportIcon(gr, id, x, y, w, h, colour) {
    if (typeof gr.FillPolygon !== "function") return false;

    const cx = x + w / 2;
    const cy = y + h / 2;
    const iconH = Math.max(8, h * 0.40);
    const triangleW = Math.max(6, h * 0.27);
    const barW = Math.max(2, h * 0.075);
    const gap = Math.max(1.5, h * 0.055);

    try {
        if (id === "play") {
            if (fb.IsPlaying && !fb.IsPaused) {
                const pauseH = Math.max(8, h * 0.40);
                const pauseW = Math.max(2.5, h * 0.085);
                const pauseGap = Math.max(3, h * 0.10);
                fillRoundedBar(gr, cx - pauseGap / 2 - pauseW, cy - pauseH / 2, pauseW, pauseH, colour);
                fillRoundedBar(gr, cx + pauseGap / 2, cy - pauseH / 2, pauseW, pauseH, colour);
            } else {
                fillSolidTriangle(gr, 1, cx + h * 0.025, cy, triangleW, iconH, colour);
            }
            return true;
        }

        if (id === "stop") {
            const side = Math.max(7, h * 0.33);
            const radius = Math.max(0.5, side * 0.06);
            gr.FillRoundRect(cx - side / 2, cy - side / 2, side, side, radius, radius, colour);
            return true;
        }

        const totalW = barW + gap + triangleW;
        const left = cx - totalW / 2;

        if (id === "previous") {
            fillRoundedBar(gr, left, cy - iconH / 2, barW, iconH, colour);
            fillSolidTriangle(gr, -1, left + barW + gap + triangleW / 2, cy, triangleW, iconH, colour);
            return true;
        }

        if (id === "next") {
            fillSolidTriangle(gr, 1, left + triangleW / 2, cy, triangleW, iconH, colour);
            fillRoundedBar(gr, left + triangleW + gap, cy - iconH / 2, barW, iconH, colour);
            return true;
        }
    } catch (e) {
        return false;
    }

    return false;
}

class SquareButton {
    constructor(options) {
        this.id = options.id;
        this.glyph = options.glyph;
        this.tooltip = options.tooltip;
        this.onClick = options.onClick || null;
        this.onRightClick = options.onRightClick || null;
        this.enabled = options.enabled || (() => true);
        this.rightEnabled = options.rightEnabled || null;
        this.checked = options.checked || (() => false);
        this.font = options.font || (() => fonts.transportIcon);

        this.x = 0;
        this.y = 0;
        this.w = 0;
        this.h = 0;
        this.hover = false;
        this.down = false;
    }

    setBounds(x, y, width, height) {
        this.x = Math.round(x);
        this.y = Math.round(y);
        this.w = Math.max(1, Math.round(width));
        this.h = Math.max(1, Math.round(height === undefined ? width : height));
    }

    contains(x, y) {
        return x >= this.x && y >= this.y && x < this.x + this.w && y < this.y + this.h;
    }

    isEnabled() {
        try {
            return !!this.enabled();
        } catch (e) {
            return false;
        }
    }

    isRightEnabled() {
        if (!this.onRightClick) return false;
        if (!this.rightEnabled) return this.isEnabled();
        try {
            return !!this.rightEnabled();
        } catch (e) {
            return false;
        }
    }

    isInteractive() {
        return this.isEnabled() || this.isRightEnabled();
    }

    getGlyph() {
        try {
            return typeof this.glyph === "function" ? this.glyph() : String(this.glyph || "");
        } catch (e) {
            return "";
        }
    }

    getTooltip() {
        try {
            return typeof this.tooltip === "function" ? this.tooltip() : String(this.tooltip || "");
        } catch (e) {
            return "";
        }
    }

    move(x, y) {
        // Hit-test first: most mouse moves are not over this button, so avoid
        // calling host-backed enabled() predicates unless the rectangle matches.
        const next = this.contains(x, y) && this.isInteractive();
        const changed = next !== this.hover;
        this.hover = next;
        if (!next) this.down = false;
        return changed;
    }

    leave() {
        const changed = this.hover || this.down;
        this.hover = false;
        this.down = false;
        return changed;
    }

    lbtnDown(x, y) {
        if (this.contains(x, y) && this.isEnabled()) {
            this.down = true;
            return true;
        }
        return false;
    }

    lbtnUp(x, y) {
        const invoke = this.down && this.contains(x, y) && this.isEnabled();
        this.down = false;
        if (invoke && this.onClick) this.onClick(x, y);
        return invoke;
    }

    rbtnUp(x, y) {
        if (!this.contains(x, y) || !this.isRightEnabled()) return false;
        this.onRightClick(x, y);
        return true;
    }

    paint(gr) {
        const enabled = this.isInteractive();
        const selected = enabled && !!this.checked();
        const isPlay = this.id === "play";
        const monochrome = settings.controlStyle === 1;
        const rect = makeRect(this.x, this.y, this.w, this.h);
        const visual = ui.iconButton(
            gr,
            rect,
            {
                selected: selected,
                hovered: this.hover,
                pressed: this.down,
                enabled: enabled
            },
            {
                circular: true,
                // Primary foreground contrast is selected by RivageUI. Bright
                // album accents receive a dark glyph; darker accents retain white.
                primary: isPlay,
                base: monochrome ? theme.monoSurface : theme.surface,
                accent: theme.accent,
                radius: UI.buttonRadius,
                indicator: false,
                indicatorActive: false,
                border: !!settings.elementBorders,
                background: true
            }
        );

        let iconColour = visual.icon;
        if (enabled && !isPlay) {
            // Secondary transport actions keep neutral circular fills and use
            // the shared accent for their glyphs in every icon style.
            iconColour = theme.accentHover;
        }

        if (monochrome) {
            ui.withAntialias(gr, () => {
                const drawn = drawSolidTransportIcon(
                    gr,
                    this.id,
                    this.x,
                    this.y,
                    this.w,
                    this.h,
                    iconColour
                );
                if (!drawn) {
                    gr.GdiDrawText(
                        this.getGlyph(),
                        this.font(),
                        iconColour,
                        this.x,
                        this.y,
                        this.w,
                        this.h,
                        TEXT_FLAGS.centered
                    );
                }
            });
        } else {
            gr.GdiDrawText(
                this.getGlyph(),
                this.font(),
                iconColour,
                this.x,
                this.y,
                this.w,
                this.h,
                TEXT_FLAGS.centered
            );
        }
    }
}

// Transport controls only. The left-side utility rail (options, stop-after,
// love, tag, convert, move, album art, folder) is no longer part of this panel;
// those actions live in foobar2000's own context menu and in the dedicated
// buttons rail panel (custom-buttons.js).
let transportButtons = [];
let allButtons = [];
let interactiveButtons = [];
let buttonMap = {};

function refreshInteractiveButtons() {
    const next = [];
    if (handle && layout.controls) {
        for (const button of transportButtons) next.push(button);
    }

    for (const button of allButtons) {
        if (next.indexOf(button) < 0) button.leave();
    }
    interactiveButtons = next;
}

function createButtons() {
    transportButtons = [
        new SquareButton({
            id: "previous",
            glyph: GLYPHS.previous,
            tooltip: "Previous",
            font: () => fonts.transportIcon,
            onClick: () => fb.Prev()
        }),
        new SquareButton({
            id: "play",
            glyph: () => fb.IsPlaying && !fb.IsPaused ? GLYPHS.pause : GLYPHS.play,
            tooltip: () => fb.IsPlaying && !fb.IsPaused
                ? "Pause\nRight-click: random track"
                : "Play\nRight-click: random track",
            font: () => fonts.primaryIcon,
            onClick: () => fb.PlayOrPause(),
            onRightClick: () => fb.Random()
        }),
        new SquareButton({
            id: "stop",
            glyph: GLYPHS.stop,
            tooltip: "Stop",
            font: () => fonts.transportIcon,
            enabled: () => fb.IsPlaying || fb.IsPaused,
            onClick: () => fb.Stop()
        }),
        new SquareButton({
            id: "next",
            glyph: GLYPHS.next,
            tooltip: "Next",
            font: () => fonts.transportIcon,
            onClick: () => fb.Next()
        })
    ];

    allButtons = transportButtons.slice();
    buttonMap = {};
    for (const button of allButtons) buttonMap[button.id] = button;
}

// RATING

let ratingHover = 0;
let visualHoverKey = "";

function ratingStorageName() {
    return PlaybackStatsSource.isPlaycount2003() ? "Playcount 2003" : "Playback Statistics";
}

function ratingStarAt(x, y) {
    if (!handle || !layout.rating || !pointInRect(x, y, layout.rating)) return 0;

    for (let i = 0; i < 5; ++i) {
        const starX = layout.ratingStarX + i * (layout.ratingStarSize + layout.ratingStarGap);
        if (x >= starX && x < starX + layout.ratingStarSize) return i + 1;
    }
    return 0;
}

function setRating(value) {
    if (!handle) return;
    const nextValue = clampNumber(value, 0, 5);

    try {
        if (PlaybackStatsSource.isPlaycount2003()) {
            // Playcount 2003's own context menu, confirmed by inspection:
            // Playcount 2003 > Rating > Clear / Set Rating to 1..5. Unlike
            // Playback Statistics there is no "<not set>" wording - clearing
            // is its own separate "Clear" item.
            const command = nextValue
                ? "Playcount 2003/Rating/Set Rating to " + nextValue
                : "Playcount 2003/Rating/Clear";
            const ok = fb.RunContextCommandWithMetadb(command, new FbMetadbHandleList(handle), 8);
            if (!ok) {
                throw new Error("Playcount 2003 did not expose the rating command.");
            }
        } else {
            const command = nextValue
                ? "Playback Statistics/Rating/" + nextValue
                : "Playback Statistics/Rating/<not set>";
            const ok = fb.RunContextCommandWithMetadb(command, new FbMetadbHandleList(handle), 8);
            if (!ok) {
                throw new Error("Playback Statistics did not expose the rating command.");
            }
        }

        cache.rating = nextValue;
        window.Repaint();
        schedulePanelTimeout(() => {
            refreshCache();
            requestVisibleRepaint();
        }, 80);
    } catch (e) {
        fb.ShowPopupMessage(
            "Could not set the rating using " + ratingStorageName() + ".\n\n" + (e.message || e),
            RivageUI.copy.popupTitle("Player")
        );
    }
}

// PLAYLIST / INFORMATION ACTIONS

function escapeQueryValue(value) {
    return String(value || "").replace(/"/g, '""');
}

function createUniquePlaylist(name) {
    let candidate = name;
    let suffix = 2;
    while (plman.FindPlaylist(candidate) >= 0) {
        candidate = name + " (" + suffix + ")";
        ++suffix;
    }
    const index = plman.PlaylistCount;
    plman.CreatePlaylist(index, candidate);
    return index;
}

function createPlaylistFromQuery(name, queryOrQueries) {
    const queries = Array.isArray(queryOrQueries) ? queryOrQueries : [queryOrQueries];
    let createdIndex = -1;

    try {
        const library = fb.GetLibraryItems();
        let matched = null;
        for (const query of queries) {
            matched = fb.GetQueryItems(library, query);
            if (matched && matched.Count > 0) break;
        }

        if (!matched || matched.Count === 0) {
            fb.ShowPopupMessage(
                "No Media Library items matched:\n\n" + queries[queries.length - 1],
                RivageUI.copy.popupTitle("Player")
            );
            return;
        }

        createdIndex = createUniquePlaylist(name);
        plman.InsertPlaylistItems(createdIndex, 0, matched, false);
        plman.ActivePlaylist = createdIndex;
        plman.SetPlaylistFocusItem(createdIndex, 0);
    } catch (e) {
        if (createdIndex >= 0 && typeof plman.RemovePlaylist === "function") {
            try { plman.RemovePlaylist(createdIndex); } catch (removeError) { reportFailure("the failed playlist could not be removed", removeError); }
        }
        fb.ShowPopupMessage(
            "Could not create the playlist.\n\n" + queries[0] + "\n\n" + (e.message || e),
            RivageUI.copy.popupTitle("Player")
        );
    }
}

function openArtistPlaylist() {
    if (!cache.artist) return;
    createPlaylistFromQuery(
        cache.artist,
        'ARTIST IS "' + escapeQueryValue(cache.artist) + '"'
    );
}

function openAlbumPlaylist() {
    if (!cache.album) return;

    const albumClause = 'ALBUM IS "' + escapeQueryValue(cache.album) + '"';
    let name = cache.album;

    // cache.albumArtist already falls back to the artist name for display, but that
    // fallback only happens in title-formatting - the ALBUM ARTIST tag itself may still be
    // blank in the library, in which case querying ALBUM ARTIST IS "<artist>" matches nothing.
    // cache.albumArtistRaw holds just the tag (empty if untagged) so that case is detected
    // and skipped straight to ARTIST below.
    //
    // Even when ALBUM ARTIST IS genuinely tagged, an exact IS match can still legitimately
    // come up empty - multi-value ALBUM ARTIST tags (several performers on one field),
    // stray whitespace, or a value that only matches case-sensitively at the byte level can
    // all make a literal "field IS this exact string" fail. So every candidate below is
    // tried in order, broadest last, and only ONE has to actually match:
    //   1. ALBUM ARTIST IS <raw tag>                         (most specific)
    //   2. ALBUM ARTIST HAS <raw tag>                        (per-value/substring match)
    //   3. ARTIST IS <artist>                                (only when ALBUM ARTIST is blank)
    //   4. ALBUM IS <album> alone                            (last resort - never refuse to
    //                                                          open a playlist for an album
    //                                                          that's plainly in the library)
    const queries = [];
    if (cache.albumArtistRaw) {
        const rawArtist = escapeQueryValue(cache.albumArtistRaw);
        queries.push(albumClause + ' AND ALBUM ARTIST IS "' + rawArtist + '"');
        queries.push(albumClause + ' AND ALBUM ARTIST HAS "' + rawArtist + '"');
    } else if (cache.artist) {
        queries.push(albumClause + ' AND ARTIST IS "' + escapeQueryValue(cache.artist) + '"');
    }
    queries.push(albumClause);

    if (cache.albumArtist) {
        name += " \u2014 " + cache.albumArtist;
    }

    createPlaylistFromQuery(name, queries);
}

function validPlaylistIndex(index) {
    const value = Number(index);
    return Number.isFinite(value) && value >= 0 && value < plman.PlaylistCount
        ? Math.floor(value)
        : -1;
}

function playlistIsQueueRecovery(index) {
    if (validPlaylistIndex(index) < 0) return false;
    try {
        const name = String(plman.GetPlaylistName(index) || "");
        return name.indexOf("[Rivage Queue Recovery:") >= 0 || name.indexOf("Queue Recovery") >= 0;
    } catch (e) {
        return false;
    }
}

function findHandleInPlaylist(index, metadb) {
    index = validPlaylistIndex(index);
    if (index < 0 || !metadb) return -1;

    try {
        const items = plman.GetPlaylistItems(index);
        return items ? Number(items.Find(metadb)) : -1;
    } catch (e) {
        return -1;
    }
}

// A queue entry added with AddItemToPlaybackQueue(handle) has no playlist
// provenance. While it is playing, PlayingPlaylist/GetPlayingItemLocation can
// therefore be invalid even though fb.GetNowPlaying() is perfectly valid.
// Resolve that handle back to a real playlist before trying to focus it.
function resolveNowPlayingPlaylistLocation(metadb) {
    let location = null;

    try {
        location = plman.GetPlayingItemLocation();
        if (location && location.IsValid) {
            const playlist = validPlaylistIndex(location.PlaylistIndex);
            const item = Number(location.PlaylistItemIndex);
            if (playlist >= 0 && Number.isFinite(item) && item >= 0 && item < plman.PlaylistItemCount(playlist)) {
                return { playlist: playlist, item: Math.floor(item) };
            }
        }
    } catch (e) { }

    if (!metadb) return null;

    const tried = {};
    const candidates = [];
    try { candidates.push(plman.ActivePlaylist); } catch (e) { }
    try { candidates.push(plman.PlayingPlaylist); } catch (e) { }

    for (const candidate of candidates) {
        const playlist = validPlaylistIndex(candidate);
        if (playlist < 0 || tried[playlist] || playlistIsQueueRecovery(playlist)) continue;
        tried[playlist] = true;
        const item = findHandleInPlaylist(playlist, metadb);
        if (item >= 0) return { playlist: playlist, item: item };
    }

    for (let playlist = 0; playlist < plman.PlaylistCount; ++playlist) {
        if (tried[playlist] || playlistIsQueueRecovery(playlist)) continue;
        const item = findHandleInPlaylist(playlist, metadb);
        if (item >= 0) return { playlist: playlist, item: item };
    }

    return null;
}

function activateNowPlaying() {
    if (!fb.IsPlaying) return false;

    let nowPlaying = null;
    try { nowPlaying = fb.GetNowPlaying(); } catch (e) { }
    if (!nowPlaying) nowPlaying = handle;

    const target = resolveNowPlayingPlaylistLocation(nowPlaying);
    if (target) {
        try {
            plman.ActivePlaylist = target.playlist;
            plman.SetPlaylistFocusItem(target.playlist, target.item);
            plman.EnsurePlaylistItemVisible(target.playlist, target.item);
            plman.SetActivePlaylistContext();
            return true;
        } catch (e) {
            // Fall through to the native command when the playlist changed mid-click.
        }
    }

    return runMainMenuCommand(COMMANDS.showNowPlaying);
}

function openSelectedProperties() {
    const selected = getSelectedPlaylistHandles();
    if (selected && selected.Count > 0) {
        return runContextCommandWithHandles(COMMANDS.properties, selected);
    }
    return runContextCommandWithHandles(COMMANDS.properties, getCurrentHandleList());
}



const MENU_ID = Object.freeze({
    nowPlaying: 3,

    accentCustom: 202,
    cursorFollow: 229,

    panelConfig: 230,
    editScript: 231,

    contextBase: 1000,
    contextCount: 5000
});

function appendAppearanceMenus(root) {
    const appearance = window.CreatePopupMenu();

    appearance.AppendMenuItem(MENU_STRING, MENU_ID.accentCustom, "Choose custom accent\u2026");

    appearance.AppendMenuSeparator();
    appearance.AppendMenuItem(MENU_STRING, MENU_ID.cursorFollow, "Track source\u2026");
    appearance.AppendMenuItem(MENU_STRING, MENU_ID.panelConfig, RivageUI.copy.labels.panelConfiguration);
    appearance.AppendMenuItem(MENU_STRING, MENU_ID.editScript, RivageUI.copy.labels.editScript);
    appearance.AppendTo(root, MENU_STRING, "Appearance and panel tools");
}

function showTrackSourceMenu(x, y) {
    const menu = window.CreatePopupMenu();
    const ids = [7001, 7002, 7003, 7004];
    const choices = TrackContext.getOverrideChoices();
    const values = [TrackContext.MODE_GLOBAL, TrackContext.MODE_AUTO, TrackContext.MODE_NOW_PLAYING, TrackContext.MODE_SELECTION];
    for (let i = 0; i < ids.length; i++) {
        menu.AppendMenuItem(MENU_STRING | (trackContextOverride === values[i] ? MENU_CHECKED : 0), ids[i], choices[i].label);
    }
    const picked = menu.TrackPopupMenu(x, y);
    const at = ids.indexOf(picked);
    if (at >= 0) {
        try {
            if (commitTrackContextOverride(values[at])) queueTrackState(true);
        } catch (e) {
            fb.ShowPopupMessage("Could not save the track-source setting.\n\n" + (e.message || e), RivageUI.copy.popupTitle("Player"));
        }
    }
}

function processAppearanceMenu(idx, x, y) {
    switch (idx) {
    case MENU_ID.accentCustom: {
        const picked = Number(utils.ColourPicker(window.ID, settings.customAccent));
        if (Number.isFinite(picked)) {
            try {
                if (commitCustomAccent(picked)) {
                    refreshTheme();
                    prepareMarquee();
                    requestVisibleRepaint();
                }
            } catch (e) {
                fb.ShowPopupMessage("Could not save the custom accent.\n\n" + (e.message || e), RivageUI.copy.popupTitle("Player"));
            }
        }
        return true;
    }

    case MENU_ID.cursorFollow:
        showTrackSourceMenu(x, y);
        return true;

    case MENU_ID.panelConfig:
        showPanelConfiguration();
        return true;

    case MENU_ID.editScript:
        editPanelScript();
        return true;
    }

    return false;
}

// Track and file actions deliberately do NOT live here. Everything this panel
// used to duplicate (properties, folder, art, tagging, file ops, Last.fm,
// ReplayGain) is reachable from foobar2000's own context menu, appended below,
// and from the buttons rail panel (custom-buttons.js).
function showActionMenu(x, y) {
    const items = getTargetHandles();

    const root = window.CreatePopupMenu();

    root.AppendMenuItem(fb.IsPlaying ? MENU_STRING : MENU_GRAYED, MENU_ID.nowPlaying, "Show now playing in playlist");
    root.AppendMenuSeparator();
    appendAppearanceMenus(root);

    let context = null;
    if (items && items.Count) {
        try {
            context = fb.CreateContextMenuManager();
            context.InitContext(items);
            root.AppendMenuSeparator();
            context.BuildMenu(root, MENU_ID.contextBase, MENU_ID.contextCount);
        } catch (e) {
            context = null;
        }
    }

    const idx = root.TrackPopupMenu(x, y);
    if (!idx) return;
    if (processAppearanceMenu(idx, x, y)) return;

    switch (idx) {
    case MENU_ID.nowPlaying:
        activateNowPlaying();
        break;

    default:
        if (context && idx >= MENU_ID.contextBase) {
            context.ExecuteByID(idx - MENU_ID.contextBase);
        }
        break;
    }
}

// LAYOUT

function positionTransportButtons() {
    const previous = buttonMap.previous;
    const play = buttonMap.play;
    const stop = buttonMap.stop;
    const next = buttonMap.next;
    if (!previous || !play || !stop || !next || !layout.controls) return;

    let small = px(UI.transportButton);
    let primary = px(UI.playButton);
    let stopSize = px(UI.stopButton);
    let gap = px(UI.transportGap);
    let total = small + gap + primary + gap + stopSize + gap + small;
    const maximum = Math.max(1, layout.mainW - px(UI.controlsPaddingX) * 2);

    if (total > maximum) {
        const factor = maximum / total;
        small = Math.max(1, Math.floor(small * factor));
        primary = Math.max(1, Math.floor(primary * factor));
        stopSize = Math.max(1, Math.floor(stopSize * factor));
        gap = Math.max(0, Math.floor(gap * factor));
        total = small + gap + primary + gap + stopSize + gap + small;

        // Integer rounding can leave the row a few pixels too wide.
        while (total > maximum && gap > 0) {
            gap--;
            total = small + gap + primary + gap + stopSize + gap + small;
        }
        while (total > maximum && (primary > 1 || stopSize > 1 || small > 1)) {
            if (primary > 1) primary--;
            if (total > maximum && stopSize > 1) stopSize--;
            if (total > maximum && small > 1) small--;
            total = small + gap + primary + gap + stopSize + gap + small;
        }
    }

    let x = Math.round(layout.mainX + (layout.mainW - total) / 2);
    const centreY = layout.controls.y + Math.round(layout.controls.h / 2);

    previous.setBounds(x, centreY - Math.round(small / 2), small);
    x += small + gap;
    play.setBounds(x, centreY - Math.round(primary / 2), primary);
    x += primary + gap;
    stop.setBounds(x, centreY - Math.round(stopSize / 2), stopSize);
    x += stopSize + gap;
    next.setBounds(x, centreY - Math.round(small / 2), small);

    layout.controls.x = Math.round(previous.x - px(UI.controlsPaddingX));
    layout.controls.w = Math.round(next.x + next.w - previous.x + px(UI.controlsPaddingX) * 2);
}

// Glyph and label are measured once per layout pass: the badge text is constant,
// so nothing here may cost a measureText() per paint.
function calculateReplayGainBadge() {
    if (!fonts.badge || !fonts.badgeGlyph || layout.mainW <= 0) return null;

    const glyphW = Math.ceil(measureTextWidth(REPLAYGAIN_BADGE.glyph, fonts.badgeGlyph));
    const gap = px(UI.badgeGlyphGap);
    const padding = px(UI.badgePaddingX);
    const width = Math.min(
        layout.mainW,
        Math.ceil(measureTextWidth(REPLAYGAIN_BADGE.text, fonts.badge)) + glyphW + gap + padding * 2
    );
    // Too narrow for the whole label: the label gives up what is left, and its
    // ellipsis flag does the rest. The glyph always survives.
    const textW = Math.max(0, width - padding * 2 - glyphW - gap);
    const contentW = glyphW + gap + textW;
    const height = Math.min(Math.max(1, wh), px(UI.badgeHeight));
    const x = layout.mainX + Math.round((layout.mainW - width) / 2);
    const contentX = x + Math.round((width - contentW) / 2);

    return {
        rect: makeRect(x, Math.min(px(UI.badgeTop), Math.max(0, wh - height)), width, height),
        glyphX: contentX,
        glyphW: glyphW,
        textX: contentX + glyphW + gap,
        textW: textW
    };
}

function calculateVerticalLayout() {
    layout.title = makeRect(layout.mainX, px(UI.contentTop), layout.mainW, px(UI.titleHeight));
    layout.artist = makeRect(
        layout.mainX,
        layout.title.y + layout.title.h + px(UI.titleArtistGap),
        layout.mainW,
        px(UI.artistHeight)
    );
    layout.album = makeRect(
        layout.mainX,
        layout.artist.y + layout.artist.h + px(UI.artistAlbumGap),
        layout.mainW,
        px(UI.albumHeight)
    );
    layout.information = makeRect(
        layout.mainX,
        layout.title.y,
        layout.mainW,
        layout.album.y + layout.album.h - layout.title.y
    );

    layout.replayGainBadgeBase = calculateReplayGainBadge();
    arrangeTopStrip(true);

    const playSize = px(UI.playButton);
    const controlsH = playSize + px(UI.controlsPaddingY) * 2;
    const ratingH = px(UI.ratingHeight);

    const seekbarH = settings.showSeekbar ? px(UI.seekbarHeight) : 0;
    const volumeBarH = settings.showVolumeBar ? px(UI.volumeBarHeight) : 0;
    const seekbarReserve = settings.showSeekbar ? px(UI.seekbarGap) + seekbarH : 0;
    const volumeBarReserve = settings.showVolumeBar ? px(UI.volumeBarGap) + volumeBarH : 0;

    const minimumControlsY = layout.album.y + layout.album.h + px(UI.controlsTopGap);
    const desiredControlsY = Math.round(wh * UI.controlsYRatio);
    const requiredAfterControls = controlsH +
        px(UI.ratingGap) + ratingH +
        seekbarReserve +
        volumeBarReserve +
        px(UI.bottomMargin);
    const maximumControlsY = wh - requiredAfterControls;

    const controlsY = clampNumber(
        Math.max(minimumControlsY, desiredControlsY),
        minimumControlsY,
        Math.max(minimumControlsY, maximumControlsY)
    );

    layout.controls = makeRect(0, controlsY, 0, controlsH);
    layout.rating = makeRect(
        layout.mainX,
        layout.controls.y + layout.controls.h + px(UI.ratingGap),
        layout.mainW,
        ratingH
    );

    let afterRatingY = layout.rating.y + layout.rating.h;
    const sharedBarW = Math.max(1, Math.round(layout.mainW * settings.seekbarWidthPercent / 100));
    const sharedBarX = layout.mainX + Math.round((layout.mainW - sharedBarW) / 2);
    if (settings.showSeekbar) {
        layout.seekbar = makeRect(
            sharedBarX,
            afterRatingY + px(UI.seekbarGap),
            sharedBarW,
            seekbarH
        );
        afterRatingY = layout.seekbar.y + layout.seekbar.h;
    } else {
        layout.seekbar = null;
    }

    if (settings.showVolumeBar) {
        layout.volumeBar = makeRect(
            sharedBarX,
            afterRatingY + px(UI.volumeBarGap),
            sharedBarW,
            volumeBarH
        );
        afterRatingY = layout.volumeBar.y + layout.volumeBar.h;
    } else {
        layout.volumeBar = null;
    }

    const starSize = px(UI.ratingStarSize);
    const starGap = px(UI.ratingStarGap);
    const starsWidth = starSize * 5 + starGap * 4;
    layout.ratingStarSize = starSize;
    layout.ratingStarGap = starGap;
    layout.ratingStarX = Math.round(layout.mainX + (layout.mainW - starsWidth) / 2);

    return true;
}

function layoutUi() {
    if (ww <= 0 || wh <= 0) return;

    const baseW = Math.max(1, hostScale(UI.referenceWidth));
    const extraReferenceHeight =
        (settings.showSeekbar ? UI.seekbarGap + UI.seekbarHeight : 0) +
        (settings.showVolumeBar ? UI.volumeBarGap + UI.volumeBarHeight : 0);
    const baseH = Math.max(1, hostScale(UI.referenceHeight + extraReferenceHeight));
    layout.scale = clampNumber(
        Math.min(ww / baseW, wh / baseH),
        UI.minimumScale,
        UI.maximumScale
    );
    // Match the bars to this panel's live host DPI and adaptive layout scale.
    const barDpi = Math.max(10, Math.round((currentDpi() / 72) * layout.scale * 100));
    SeekbarWidget.setDpi(barDpi);
    VolumeBarWidget.setDpi(barDpi);

    const leftMargin = px(UI.contentMarginLeft);
    const requestedRightMargin = px(UI.contentMarginRight);

    layout.mainX = Math.min(Math.max(0, ww - 1), leftMargin);
    const availableAfterMainX = Math.max(1, ww - layout.mainX);
    const rightMargin = Math.min(requestedRightMargin, Math.max(0, availableAfterMainX - 1));
    layout.mainW = Math.max(1, availableAfterMainX - rightMargin);

    buildFonts();
    calculateVerticalLayout();
    positionTransportButtons();
    refreshInteractiveButtons();
    prepareMarquee();
    refreshPointerState();
}


const TOOLTIP_DELAY = 600;

const tooltipState = {
    text: "",
    x: -1,
    y: -1,
    pendingText: "",
    pendingX: -1,
    pendingY: -1,
    timer: null,
    generation: 0,
    // True only for the seekbar drag-value tooltip (set by setTooltipImmediate
    // below) - drawTooltip() uses this to size the box to the text and centre
    // it instead of the normal fixed-minimum-width/left-aligned box, which
    // looks fine for longer descriptive text but leaves a short "0:36"/"62%"
    // stranded at the left edge of a much wider box.
    compact: false
};

function cancelTooltipTimer() {
    tooltipState.generation += 1;

    if (tooltipState.timer !== null) {
        try {
            if (typeof window.ClearTimeout === "function") {
                window.ClearTimeout(tooltipState.timer);
            }
        } catch (e) {
            // The generation check also invalidates an uncleared timer.
        }
        tooltipState.timer = null;
    }
}

function setTooltip(text, x, y) {
    const next = String(text || "");
    const nextX = Number.isFinite(x) ? x : -1;
    const nextY = Number.isFinite(y) ? y : -1;

    tooltipState.compact = false;

    if (!next) {
        const changed = !!tooltipState.text;
        cancelTooltipTimer();
        tooltipState.text = "";
        tooltipState.x = -1;
        tooltipState.y = -1;
        tooltipState.pendingText = "";
        tooltipState.pendingX = -1;
        tooltipState.pendingY = -1;
        return changed;
    }

    if (next === tooltipState.text) {
        const changed = nextX !== tooltipState.x || nextY !== tooltipState.y;
        tooltipState.x = nextX;
        tooltipState.y = nextY;
        return changed;
    }

    if (next === tooltipState.pendingText) {
        tooltipState.pendingX = nextX;
        tooltipState.pendingY = nextY;
        return false;
    }

    const changed = !!tooltipState.text;
    cancelTooltipTimer();

    tooltipState.text = "";
    tooltipState.x = -1;
    tooltipState.y = -1;
    tooltipState.pendingText = next;
    tooltipState.pendingX = nextX;
    tooltipState.pendingY = nextY;

    const generation = tooltipState.generation;
    tooltipState.timer = window.SetTimeout(() => {
        if (generation !== tooltipState.generation || tooltipState.pendingText !== next) return;

        tooltipState.timer = null;
        if (!hostIsVisible()) {
            tooltipState.pendingText = "";
            tooltipState.pendingX = -1;
            tooltipState.pendingY = -1;
            return;
        }
        tooltipState.text = tooltipState.pendingText;
        tooltipState.x = tooltipState.pendingX;
        tooltipState.y = tooltipState.pendingY;
        tooltipState.pendingText = "";
        tooltipState.pendingX = -1;
        tooltipState.pendingY = -1;
        window.Repaint();
    }, TOOLTIP_DELAY);

    return changed;
}

function setTooltipImmediate(text, x, y) {
    const next = String(text || "");
    const nextX = Number.isFinite(x) ? x : -1;
    const nextY = Number.isFinite(y) ? y : -1;

    if (!next) return setTooltip("", x, y);

    const changed = next !== tooltipState.text || nextX !== tooltipState.x || nextY !== tooltipState.y;
    cancelTooltipTimer();
    tooltipState.text = next;
    tooltipState.x = nextX;
    tooltipState.y = nextY;
    tooltipState.pendingText = "";
    tooltipState.pendingX = -1;
    tooltipState.pendingY = -1;
    tooltipState.compact = true;
    return changed;
}

function drawTooltip(gr) {
    if (!tooltipState.text || !fonts.tooltip || ww <= 0 || wh <= 0) return;

    // The seekbar drag-value tooltip (short, single-line - "0:36", "62%") gets
    // its own styling: no fixed minimum width (ui.tooltip() sizes the box to
    // the measured text instead), and centred rather than left-aligned, since
    // a fixed-width left-aligned box built for longer descriptive tooltips
    // otherwise strands the short text at the box's left edge.
    if (tooltipState.compact) {
        ui.tooltip(
            gr,
            tooltipState.text,
            fonts.tooltip,
            tooltipState.x,
            tooltipState.y,
            ww,
            wh,
            {
                minimumWidth: 1,
                lineHeight: 18,
                textFlags: TEXT_FLAGS.centered
            }
        );
        return;
    }

    ui.tooltip(
        gr,
        tooltipState.text,
        fonts.tooltip,
        tooltipState.x,
        tooltipState.y,
        ww,
        wh,
        {
            minimumWidth: 70,
            lineHeight: 18,
            textFlags: TEXT_FLAGS.left
        }
    );
}

function visualHoverRegionAt(x, y) {
    if (!handle) return "";
    if (pointInRect(x, y, nextHoverRect())) return "next";
    if (pointInRect(x, y, titleHoverRect())) return "title";
    if (pointInRect(x, y, artistHoverRect())) return "artist";
    if (pointInRect(x, y, albumHoverRect())) return "album";

    return "";
}

function tooltipAt(x, y) {
    for (const button of interactiveButtons) {
        if (button.contains(x, y)) {
            const text = button.getTooltip();
            if (button.isEnabled()) return text;
            if (button.isRightEnabled()) return text + "\nLeft-click unavailable; right-click remains available";
            return text + "\nUnavailable for the current track or selection";
        }
    }

    const star = ratingStarAt(x, y);
    if (star) {
        return "Set rating to " + star + " / 5\nCurrent storage: " + ratingStorageName() +
            "\nChange in RVG Settings \u203a Global settings";
    }

    if (replayGainWarningVisible() && pointInRect(x, y, layout.replayGainBadge.rect)) {
        return REPLAYGAIN_BADGE.tooltip;
    }

    if (pointInRect(x, y, nextHoverRect())) {
        return queueNext.count === 1 ? "Show the queued track" : "Show all " + queueNext.count + " queued tracks";
    }

    if (handle && pointInRect(x, y, titleHoverRect())) {
        return fb.IsPlaying || playbackTransitionPending
            ? "Focus the now-playing cursor in its playlist"
            : "Nothing is currently playing";
    }
    if (handle && pointInRect(x, y, artistHoverRect())) return "Create a Media Library playlist for this artist";
    if (handle && pointInRect(x, y, albumHoverRect())) return "Create a Media Library playlist for this album";

    return "";
}

function pointIsClickable(x, y) {
    for (const button of interactiveButtons) {
        if (button.contains(x, y) && button.isInteractive()) return true;
    }
    return !!ratingStarAt(x, y) || pointInRect(x, y, nextHoverRect()) ||
        (handle && (pointInRect(x, y, titleHoverRect()) || pointInRect(x, y, artistHoverRect()) || pointInRect(x, y, albumHoverRect())));
}

function refreshPointerState() {
    if (mouse.x < 0 || mouse.y < 0) return;

    let changed = false;
    for (const button of allButtons) {
        if (interactiveButtons.indexOf(button) >= 0) changed = button.move(mouse.x, mouse.y) || changed;
        else changed = button.leave() || changed;
    }

    const nextRatingHover = ratingStarAt(mouse.x, mouse.y);
    if (nextRatingHover !== ratingHover) {
        ratingHover = nextRatingHover;
        changed = true;
    }
    const nextVisualHoverKey = visualHoverRegionAt(mouse.x, mouse.y);
    if (nextVisualHoverKey !== visualHoverKey) {
        visualHoverKey = nextVisualHoverKey;
        changed = true;
    }
    changed = setTooltip(tooltipAt(mouse.x, mouse.y), mouse.x, mouse.y) || changed;

    try {
        const handCursor = typeof IDC_HAND !== "undefined" ? IDC_HAND : 32649;
        const arrowCursor = typeof IDC_ARROW !== "undefined" ? IDC_ARROW : 32512;
        const widgetHot = seekbarWidget.hover || seekbarWidget.drag || seekbarWidget.rdrag || volumeBarWidget.hover || volumeBarWidget.drag;
        window.SetCursor((widgetHot || pointIsClickable(mouse.x, mouse.y)) ? handCursor : arrowCursor);
    } catch (e) { }

    return changed;
}


function drawBackground(gr) {
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);
}

// "?" is what %__replaygain_track_gain% yields for an unscanned track; see
// refreshCache(), which keeps that literal for exactly this test.
function replayGainWarningVisible() {
    return !!(replayGainWarningWanted() && layout.replayGainBadge);
}

function drawReplayGainWarning(gr) {
    if (!replayGainWarningVisible()) return;

    const badge = layout.replayGainBadge;
    ui.withAntialias(gr, () => {
        ui.pill(gr, badge.rect, {
            fill: RivageUI.withAlpha(theme.warning, REPLAYGAIN_BADGE.fillAlpha),
            border: true,
            stroke: RivageUI.withAlpha(theme.warning, REPLAYGAIN_BADGE.strokeAlpha)
        });
    });

    // Two draws, not one string: the label is body text and the glyph only
    // exists in the icon font.
    gr.GdiDrawText(
        REPLAYGAIN_BADGE.glyph,
        fonts.badgeGlyph,
        theme.warning,
        badge.glyphX,
        badge.rect.y,
        badge.glyphW + px(2),
        badge.rect.h,
        TEXT_FLAGS.leftCentered
    );
    gr.GdiDrawText(
        REPLAYGAIN_BADGE.text,
        fonts.badge,
        theme.warning,
        badge.textX,
        badge.rect.y,
        badge.textW + px(2),
        badge.rect.h,
        TEXT_FLAGS.leftCenteredEllipsis
    );
}

function drawEmptyState(gr) {
    const iconH = px(52);
    const iconY = Math.round(wh * 0.28);
    gr.GdiDrawText(
        "\u266B",
        fonts.music,
        theme.textTertiary,
        layout.mainX,
        iconY,
        layout.mainW,
        iconH,
        TEXT_FLAGS.centered
    );
    gr.GdiDrawText(
        "Nothing to display",
        fonts.emptyTitle,
        theme.textPrimary,
        layout.mainX,
        iconY + iconH + px(8),
        layout.mainW,
        px(32),
        TEXT_FLAGS.centeredEllipsis
    );
    gr.GdiDrawText(
        "Start playback or select a library track.",
        fonts.emptySubtitle,
        theme.textTertiary,
        layout.mainX,
        iconY + iconH + px(40),
        layout.mainW,
        px(28),
        TEXT_FLAGS.centeredEllipsis
    );
}

function drawNextLine(gr) {
    const hovered = pointInRect(mouse.x, mouse.y, nextHoverRect());
    gr.GdiDrawText(
        queueNext.text,
        fonts.next,
        hovered ? theme.textPrimary : theme.textTertiary,
        layout.next.x,
        layout.next.y,
        layout.next.w,
        layout.next.h,
        layout.nextFlags
    );
    if (hovered) {
        const rect = nextHoverRect();
        const underlineW = Math.round(rect.w * 0.5);
        gr.FillSolidRect(rect.x + Math.round((rect.w - underlineW) / 2), layout.next.y + layout.next.h - px(2),
            underlineW, px(1), theme.accentHover);
    }
}

function drawTitle(gr) {
    const hovered = pointInRect(mouse.x, mouse.y, titleHoverRect());

    if (!titleMarquee.draw(gr, layout.title)) {
        gr.GdiDrawText(
            cache.title,
            fonts.title,
            theme.textPrimary,
            layout.title.x,
            layout.title.y,
            layout.title.w,
            layout.title.h,
            TEXT_FLAGS.centeredEllipsis
        );
    }

    if (hovered) {
        const underlineW = Math.round(layout.title.w * 0.42);
        gr.FillSolidRect(
            layout.title.x + Math.round((layout.title.w - underlineW) / 2),
            layout.title.y + layout.title.h - px(2),
            underlineW,
            px(2),
            theme.accentHover
        );
    }
}

function drawTrackInformation(gr, area, pad) {
    if (!handle) {
        // A fresh playback start has no outgoing metadata to retain. Keep
        // the content area clean until on_playback_new_track supplies it.
        if (!playbackTransitionPending) drawEmptyState(gr);
        return;
    }

    if (nextLineVisible() && RivageUI.areaHits(area, layout.next, pad)) drawNextLine(gr);
    if (RivageUI.areaHits(area, layout.title, pad)) drawTitle(gr);
    if (!RivageUI.areaHits(area, layout.artist, pad) && !RivageUI.areaHits(area, layout.album, pad)) return;

    const artistHover = pointInRect(mouse.x, mouse.y, artistHoverRect());
    const albumHover = pointInRect(mouse.x, mouse.y, albumHoverRect());

    gr.GdiDrawText(
        cache.artist,
        fonts.artist,
        artistHover ? theme.textPrimary : theme.textSecondary,
        layout.artist.x,
        layout.artist.y,
        layout.artist.w,
        layout.artist.h,
        TEXT_FLAGS.centeredEllipsis
    );

    gr.GdiDrawText(
        cache.albumDate,
        fonts.album,
        albumHover ? theme.textPrimary : theme.textSecondary,
        layout.album.x,
        layout.album.y,
        layout.album.w,
        layout.album.h,
        TEXT_FLAGS.centeredEllipsis
    );

    if (artistHover) {
        const width = Math.round(layout.artist.w * 0.36);
        gr.FillSolidRect(
            layout.artist.x + Math.round((layout.artist.w - width) / 2),
            layout.artist.y + layout.artist.h - px(2),
            width,
            px(2),
            theme.accentHover
        );
    }

    if (albumHover) {
        const width = Math.round(layout.album.w * 0.30);
        gr.FillSolidRect(
            layout.album.x + Math.round((layout.album.w - width) / 2),
            layout.album.y + layout.album.h - px(2),
            width,
            px(2),
            theme.accentHover
        );
    }
}

function drawButtons(gr, area, pad) {
    if (!handle || !layout.controls) return;
    for (const button of transportButtons) {
        if (RivageUI.areaHits(area, button, pad)) button.paint(gr);
    }
}

function drawRating(gr) {
    if (!handle || !layout.rating) return;

    const displayed = ratingHover || cache.rating;
    for (let i = 0; i < 5; ++i) {
        const x = layout.ratingStarX + i * (layout.ratingStarSize + layout.ratingStarGap);
        const active = i < displayed;

        gr.GdiDrawText(
            active ? GLYPHS.starFill : GLYPHS.starOutline,
            fonts.star,
            theme.accentHover,
            x,
            layout.rating.y,
            layout.ratingStarSize,
            layout.rating.h,
            TEXT_FLAGS.centered
        );
    }
}


function on_size(width, height) {
    // Cache the callback values, but do not trust this as the only resize path:
    // hidden JSplitter children may be Move()d without a usable on_size callback.
    ww = readHostDimension(width, window.Width);
    wh = readHostDimension(height, window.Height);
    layoutDirty = true;
    // JSplitter repaints after a visible size event. A hidden panel will perform
    // this one layout pass when its first paint arrives after Show(true).
}

function on_paint(gr, x, y, width, height) {
    const flushed = flushVisibleWorkFromPaint();
    const fontsBuilt = ensureFonts();
    arrangeTopStrip();

    // Marquee and seekbar ticks invalidate one section; skip the others.
    const area = flushed || fontsBuilt ? null : RivageUI.paintArea(x, y, width, height, ww, wh);
    const pad = px(PAINT_AREA_PAD);
    if (area) gr.PushClip(area.x, area.y, area.w, area.h);
    try {
        drawBackground(gr);
        if (replayGainWarningVisible() && RivageUI.areaHits(area, layout.replayGainBadge.rect, pad)) {
            drawReplayGainWarning(gr);
        }
        drawTrackInformation(gr, area, pad);
        drawButtons(gr, area, pad);

        if (handle && RivageUI.areaHits(area, layout.rating, pad)) {
            drawRating(gr);
        }

        if (settings.showSeekbar && layout.seekbar && RivageUI.areaHits(area, layout.seekbar, pad)) {
            ui.withAntialias(gr, () => {
                seekbarWidget.draw(gr, layout.seekbar, theme.accent);
            });
        }

        if (settings.showVolumeBar && layout.volumeBar && RivageUI.areaHits(area, layout.volumeBar, pad)) {
            ui.withAntialias(gr, () => {
                volumeBarWidget.draw(gr, layout.volumeBar, theme.accent);
            });
        }

        drawTooltip(gr);
    } finally {
        if (area) gr.PopClip();
    }

    // These timers self-stop as soon as the panel becomes hidden and are
    // restarted by the first subsequent visible paint.
    if (titleMarquee.isActive()) startMarqueeTimer();
    startSeekbarTickTimer();
}

function on_focus(isFocused) {
    if (isFocused) plman.SetActivePlaylistContext();
}

function on_mouse_move(x, y) {
    mouse.x = x;
    mouse.y = y;

    let changed = false;
    for (const button of interactiveButtons) changed = button.move(x, y) || changed;

    const nextRatingHover = ratingStarAt(x, y);
    if (nextRatingHover !== ratingHover) {
        ratingHover = nextRatingHover;
        changed = true;
    }

    const nextVisualHoverKey = visualHoverRegionAt(x, y);
    if (nextVisualHoverKey !== visualHoverKey) {
        visualHoverKey = nextVisualHoverKey;
        changed = true;
    }

    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    const volumeOuter = (settings.showVolumeBar && layout.volumeBar) ? layout.volumeBar : null;
    const seekResult = seekbarWidget.onMouseMove(barInputOuter(seekbarWidget, seekOuter, x, y), x, y);
    const volumeResult = volumeBarWidget.onMouseMove(barInputOuter(volumeBarWidget, volumeOuter, x, y), x, y);
    if (seekResult.changed || volumeResult.changed) changed = true;

    // A seekbar drag in progress (left-drag in either mode, or a right-drag -
    // see SeekbarWidget's combined mode) always wins the tooltip over the
    // normal hover-based one below, and shows immediately rather than through
    // setTooltip()'s usual delay, since the value changes on almost every move.
    const dragText = seekbarWidget.dragValueText();
    changed = (dragText ? setTooltipImmediate(dragText, x, y) : setTooltip(tooltipAt(x, y), x, y)) || changed;

    const handCursor = typeof IDC_HAND !== "undefined" ? IDC_HAND : 32649;
    const arrowCursor = typeof IDC_ARROW !== "undefined" ? IDC_ARROW : 32512;
    window.SetCursor((seekResult.hot || volumeResult.hot || pointIsClickable(x, y)) ? handCursor : arrowCursor);

    if (changed) window.Repaint();
}

function on_mouse_leave() {
    mouse.x = -1;
    mouse.y = -1;
    ratingHover = 0;
    visualHoverKey = "";

    for (const button of allButtons) button.leave();
    seekbarWidget.onMouseLeave();
    volumeBarWidget.onMouseLeave();
    setTooltip("", -1, -1);
    window.Repaint();
}

function on_mouse_lbtn_down(x, y) {
    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    const volumeOuter = (settings.showVolumeBar && layout.volumeBar) ? layout.volumeBar : null;
    if (volumeBarWidget.onMouseDown(barInputOuter(volumeBarWidget, volumeOuter, x, y), x, y)) {
        window.Repaint();
        return;
    }
    if (seekbarWidget.onMouseDown(barInputOuter(seekbarWidget, seekOuter, x, y), x, y)) {
        setTooltipImmediate(seekbarWidget.dragValueText(), x, y);
        window.Repaint();
        return;
    }

    for (const button of interactiveButtons) {
        if (button.lbtnDown(x, y)) {
            window.Repaint();
            return;
        }
    }
}

function on_mouse_lbtn_up(x, y) {
    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    const volumeOuter = (settings.showVolumeBar && layout.volumeBar) ? layout.volumeBar : null;

    if (volumeBarWidget.onMouseUp(barInputOuter(volumeBarWidget, volumeOuter, x, y), x, y)) {
        window.Repaint(true);
        return;
    }

    // Handles both a drag release that commits a seek, and a tap on the end-time label
    // toggling total/remaining display - either way this counts as "handled" and nothing
    // else below should also react to the same click.
    if (seekbarWidget.onMouseUp(barInputOuter(seekbarWidget, seekOuter, x, y), x, y)) {
        setTooltip("", x, y);
        window.Repaint(true);
        return;
    }

    for (const button of interactiveButtons) {
        if (button.lbtnUp(x, y)) {
            window.Repaint();
            return;
        }
    }

    for (const button of allButtons) button.down = false;

    const star = ratingStarAt(x, y);
    if (star) {
        setRating(star === cache.rating ? 0 : star);
        return;
    }

    if (pointInRect(x, y, nextHoverRect())) {
        setTooltip("", x, y);
        QueuePeekProtocol.open();
        return;
    }
    if (handle && pointInRect(x, y, artistHoverRect())) {
        openArtistPlaylist();
        return;
    }
    if (handle && pointInRect(x, y, albumHoverRect())) {
        openAlbumPlaylist();
        return;
    }
    if (handle && pointInRect(x, y, titleHoverRect())) {
        activateNowPlaying();
        return;
    }

    window.Repaint();
}

function on_mouse_mbtn_up(x, y) {
    // Middle-click over the seekbar permanently flips it between "seek" and
    // "volume" mode (SeekbarWidget's combined mode). Checked first since the
    // seekbar and the menu button never overlap, but this keeps the precedence
    // explicit either way.
    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    if (seekbarWidget.onMiddleClick(barInputOuter(seekbarWidget, seekOuter, x, y), x, y)) {
        if (seekbarWidget.mode === "volume") stopSeekbarTickTimer();
        else startSeekbarTickTimer();
        window.Repaint(true);
        return true;
    }
    if (buttonMap.menu && buttonMap.menu.contains(x, y)) {
        openSelectedProperties();
        return true;
    }
    return false;
}

// Right-click-dragging the seekbar always adjusts volume (SeekbarWidget's
// combined mode), regardless of whether the bar is currently in "seek" or
// "volume" mode. Started here on button-down so on_mouse_move can update it
// continuously like a real slider; committed/released in on_mouse_rbtn_up
// below, which swallows the click so it doesn't also fall through to the
// panel's own right-click handling (button rbtnUp / Properties / action menu).
function on_mouse_rbtn_down(x, y) {
    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    if (seekbarWidget.onRightMouseDown(barInputOuter(seekbarWidget, seekOuter, x, y), x, y)) {
        setTooltipImmediate(seekbarWidget.dragValueText(), x, y);
        window.Repaint();
        return true;
    }
    return false;
}

function on_mouse_rbtn_up(x, y) {
    // Release a right-drag volume adjustment before anything else - this is the
    // counterpart to on_mouse_rbtn_down above and must win over the rest of this
    // function so right-clicking the seekbar never also triggers Properties/the
    // action menu.
    const seekOuter = (settings.showSeekbar && layout.seekbar) ? layout.seekbar : null;
    if (seekbarWidget.onRightMouseUp(barInputOuter(seekbarWidget, seekOuter, x, y), x, y)) {
        setTooltip("", x, y);
        window.Repaint(true);
        return true;
    }

    for (const button of interactiveButtons) {
        if (button.contains(x, y)) {
            if (button.rbtnUp(x, y)) {
                window.Repaint();
                return true;
            }
            return true;
        }
    }

    if (handle && pointInRect(x, y, titleHoverRect())) {
        openSelectedProperties();
        return true;
    }

    showActionMenu(x, y);
    return true;
}

function on_metadb_changed() {
    pendingVisibleWork.queue = true;
    queueTrackState(true);
}

function on_playback_queue_changed() {
    pendingVisibleWork.queue = true;
    requestVisibleRepaint(true);
}

function on_item_focus_change() {
    queueTrackState(true);
}

function on_selection_changed() {
    queueTrackState(true);
}

function on_playlist_switch() {
    queueTrackState(true);
}

function on_playback_new_track(metadb) {
    // Keep the guard set until syncTrackState() has actually adopted the new
    // handle. Clearing it here was too early on hosts that expose a transient null.
    playbackTransitionPending = followsPlayback();
    queueTrackState(true, metadb || null);
}

function on_playback_dynamic_info() {
    queueTrackState(true);
}

function on_playback_dynamic_info_track() {
    queueTrackState(true);
}

function on_playback_edited() {
    queueTrackState(true);
}

function on_playback_pause() {
    // The seekbar is static while paused; stop its 250ms wake-up timer. A repaint
    // on resume restarts it through on_paint().
    try {
        if (!fb.IsPlaying || fb.IsPaused) stopSeekbarTickTimer();
    } catch (e) { }
    requestVisibleRepaint();
}

function on_playback_starting() {
    // The host can expose a transient null between outgoing and incoming tracks.
    // Keep the current display intact until the new-track callback resolves it.
    playbackTransitionPending = true;
    requestVisibleRepaint();
}

function on_playback_stop(reason) {
    if (reason !== 2) {
        playbackTransitionPending = false;
        pendingPlaybackHandle = null;
        stopSeekbarTickTimer();
        queueTrackState(false);
    } else {
        playbackTransitionPending = true;
        requestVisibleRepaint();
    }

    // Do not leave a 33ms animation timer alive behind another layout panel.
    if (!hostIsVisible()) stopMarqueeTimer();
}

function on_volume_change(value) {
    if (!hostIsVisible()) return;
    if (settings.showVolumeBar && layout.volumeBar) {
        try {
            window.RepaintRect(layout.volumeBar.x, layout.volumeBar.y, layout.volumeBar.w, layout.volumeBar.h);
        } catch (e) {
            requestVisibleRepaint();
        }
    }
    // The seekbar can also be showing volume right now (SeekbarWidget's combined
    // mode, or an in-progress right-drag) - keep it live for changes that don't
    // originate from dragging it directly (system volume keys, another panel's
    // volume control, etc).
    if (settings.showSeekbar && layout.seekbar && (seekbarWidget.mode === "volume" || seekbarWidget.rdrag)) {
        try {
            window.RepaintRect(layout.seekbar.x, layout.seekbar.y, layout.seekbar.w, layout.seekbar.h);
        } catch (e) {
            requestVisibleRepaint();
        }
    }
}

function on_colours_changed() {
    pendingVisibleWork.hostColours = true;
    requestVisibleRepaint();
}

function on_font_changed() {
    pendingVisibleWork.font = true;
    markLayoutDirty();
}

function on_notify_data(name, data) {
    // Scrolling titles stop or resume on the next paint.
    if (RivagePowerMode.consume(name, data)) { window.Repaint(); return; }
    if (SharedThemeProtocol.consume(name, data)) return;
    // NOTE: SettingsRegistry.provide() returns true for ANY schema request,
    // regardless of which panelId it was called with (a request is a broadcast,
    // not addressed to one provider) - so when a single host answers on behalf
    // of more than one panel id (this panel's own settings AND SeekbarWidget's),
    // every provide() call must run before this function returns, or the later
    // ones never get a chance to answer.
    var provided = false;
    if (SettingsRegistry.provide(name, data, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) provided = true;
    if (SettingsRegistry.provide(name, data, SeekbarWidget.PANEL_ID, SeekbarWidget.PANEL_LABEL, SeekbarWidget.getSchema)) provided = true;
    if (provided) return;

    if (SettingsRegistry.consume(name, data, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (SettingsRegistry.consume(name, data, SeekbarWidget.PANEL_ID, SeekbarWidget.applySetting)) return;
    if (SeekbarWidget.onNotifyData(name, data)) return;
    // The Global-settings owner broadcasts both shared source policies.
    if (name === SettingsRegistry.VALUE_CHANGED && data && data.panelId === "global") {
        PlaybackStatsSource.applySetting(data.settingId, data.value);
        TrackContext.applySetting(data.settingId, data.value);
        return;
    }
    if (PlaybackStatsSource.onNotifyData(name, data, false)) return;
    if (TrackContext.onNotifyData(name, data, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(data)) {
        const nextAccent = SharedAccentProtocol.opaque(data);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (settings.accentPreset === 3) {
            pendingVisibleWork.theme = true;
            requestVisibleRepaint();
        }
    }

}

function stopSeekbarTickTimer() {
    if (seekbarTickTimer !== null) {
        try { window.ClearInterval(seekbarTickTimer); } catch (e) { }
        seekbarTickTimer = null;
    }
}

function startSeekbarTickTimer() {
    if (!scriptActive || seekbarTickTimer !== null || !settings.showSeekbar || !layout.seekbar) return;
    if (seekbarWidget.mode === "volume") return;
    if (SKIP_WORK_WHEN_HIDDEN && !hostIsVisible()) return;

    try {
        if (!fb.IsPlaying || fb.IsPaused) return;
    } catch (e) {
        return;
    }

    seekbarTickTimer = window.SetInterval(function () {
        try {
            if (!scriptActive || seekbarWidget.mode === "volume" ||
                (SKIP_WORK_WHEN_HIDDEN && !hostIsVisible()) ||
                !settings.showSeekbar || !layout.seekbar || !fb.IsPlaying || fb.IsPaused) {
                stopSeekbarTickTimer();
                return;
            }
            if (!seekbarWidget.drag && !seekbarWidget.rdrag) {
                window.RepaintRect(layout.seekbar.x, layout.seekbar.y, layout.seekbar.w, layout.seekbar.h);
            }
        } catch (e) {
            stopSeekbarTickTimer();
        }
    }, 250);
}

function on_script_unload() {
    scriptActive = false;
    clearPanelTimeouts();
    stopSeekbarTickTimer();
    resetMarquee();
    setTooltip("", -1, -1);
}


refreshTheme();
createButtons();
SharedThemeProtocol.request();

// Resolve the current item and build geometry only when this child is actually
// painted. This is the visibility-safe equivalent of doing all startup work in
// playback/size callbacks while the panel may still be hidden in another slot.
pendingVisibleWork.trackState = true;
pendingVisibleWork.requestAccent = settings.accentPreset === 3;
on_size(window.Width, window.Height);
requestVisibleRepaint();
SeekbarWidget.requestSync();

PlaybackStatsSource.onChange(function () {
    if (!scriptActive) return;
    refreshCache();
    requestVisibleRepaint();
});
PlaybackStatsSource.requestSync();
TrackContext.onChange(function () { if (scriptActive) queueTrackState(true); });
TrackContext.requestSync();
