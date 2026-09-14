window.DrawMode = 0;


include(fb.ProfilePath + "jsplitter\\rivage\\shared\\ui_scale.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\track_context.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\visible_paint_work.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

window.DefineScript("RVG Playback Statistics", {
    author: "RivaGe",
    version: "2.13.0",
    features: { drag_n_drop: false, grab_focus: false }
});

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var PLAYBACK_STOP_STARTING_ANOTHER = 2;

var DT_LEFT = 0x00000000;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var SMOOTHING_MODE_DEFAULT = 0;
var SMOOTHING_MODE_ANTIALIAS = 4;

// Playback History consumes the rendered pixel size so both adaptive headers match.
var PLAYBACK_STATS_HEADER_STYLE_REQUEST =
    "RIVAGE.PLAYBACK_STATS_HEADER_STYLE_REQUEST.V1";
var PLAYBACK_STATS_HEADER_STYLE_UPDATE =
    "RIVAGE.PLAYBACK_STATS_HEADER_STYLE_UPDATE.V1";

function RGB(r, g, b) {
    return RivageUI.rgb(r, g, b);
}

function clampNumber(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
}

function normaliseInteger(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
}

// Keep the UWP panel's DPI + adaptive-size scaling contract.
var panelDpi = 72;

function refreshPanelDpi() {
    panelDpi = RivageScale.dpi() || 72;
}

refreshPanelDpi();

var adaptiveFontScale = 1;
var REFERENCE_WIDTH_PT = 494;
var REFERENCE_HEIGHT_PT = 82;
var MINIMUM_ADAPTIVE_SCALE = 0.72;
var MAXIMUM_ADAPTIVE_SCALE = 1.40;

function _scale(value) {
    return Math.round(Number(value) * panelDpi / 72);
}

// Position locally; only the tooltip box rendering is shared.
var tooltipPainter = RivageUI.createPainter({ scale: _scale });

function fontPx(value) {
    if (Number(value) === 0) return 0;
    return Math.max(1, Math.round(_scale(value) * adaptiveFontScale));
}

function updateAdaptiveFontScale(width, height) {
    var baseW = Math.max(1, _scale(REFERENCE_WIDTH_PT));
    var baseH = Math.max(1, _scale(REFERENCE_HEIGHT_PT));
    adaptiveFontScale = clampNumber(
        Math.min(Number(width) / baseW, Number(height) / baseH),
        MINIMUM_ADAPTIVE_SCALE,
        MAXIMUM_ADAPTIVE_SCALE
    );
}

var PROPERTY_PREFIX = "Rivage Playback Statistics.";

function saveSetting(name, value) {
    window.SetProperty(PROPERTY_PREFIX + name, value);
}

function loadCombinedCardMode() {
    var stored = Number(window.GetProperty(PROPERTY_PREFIX + "Combined card mode", -1));
    var legacy;

    if (stored === 0 || stored === 1 || stored === 2) return stored;

    // Migration from versions <= 2.2.1:
    // Standard local fields become Playcount local; enhanced dates become History.
    legacy = Number(window.GetProperty(PROPERTY_PREFIX + "Single card fields", 1));
    return legacy === 0 ? 0 : 2;
}

var settings = {
    cardLayout: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Card layout", 1), 0, 1, 1),
    showLocal: !!window.GetProperty(PROPERTY_PREFIX + "Show local statistics", true),
    showLastfm: !!window.GetProperty(PROPERTY_PREFIX + "Show Last.fm statistics", true),
    combinedCardMode: loadCombinedCardMode(),
    accentMode: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Accent mode", 1), 0, 1, 1),
    dateMode: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Date mode", 0), 0, 1, 0),
    backgroundPanel: !!window.GetProperty(
        PROPERTY_PREFIX + "Background panel",
        window.GetProperty(PROPERTY_PREFIX + "RivageUI section design", true)
    ),
    fontSize: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Font size", 9), 8, 13, 9)
};

// Playcount 2003 local rows cycle date/time, _ago and _ago2; other sources stay timestamp-based.
var localTimeMode = {
    first: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Local first played mode", 0), 0, 2, 0),
    last: normaliseInteger(window.GetProperty(PROPERTY_PREFIX + "Local last played mode", 0), 0, 2, 0)
};

function cycleLocalTimeMode(field) {
    var key = field === "first" ? "first" : "last";
    var next = (localTimeMode[key] + 1) % 3;
    saveSetting(key === "first" ? "Local first played mode" : "Local last played mode", next);
    localTimeMode[key] = next;
    invalidateStats();
    clearHoverState();
    window.Repaint(true);
}

function getDisplayedTrack() {
    return TrackContext.getHandle();
}

function combinedCardModeValue() {
    if (settings.combinedCardMode === 0) return "local";
    if (settings.combinedCardMode === 1) return "lastfm";
    return "history";
}

function combinedCardTitle() {
    if (settings.combinedCardMode === 0) return "LOCAL PLAY HISTORY";
    if (settings.combinedCardMode === 1) return "LAST.FM PLAY HISTORY";
    return "SMART PLAY HISTORY";
}

function combinedCardSourceLabel() {
    if (settings.combinedCardMode === 0) return "Local playback statistics";
    if (settings.combinedCardMode === 1) return "Last.fm scrobbles";
    return "Combined history";
}

var DEFAULT_UWP_ACCENT = 0xff0078d4;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

var theme = {
    background: RGB(24, 24, 26),
    card: RGB(35, 35, 38),
    cardHover: RGB(43, 43, 47),
    rowHover: RGB(49, 49, 53),
    text: RGB(245, 245, 245),
    muted: RGB(170, 170, 176),
    stroke: RGB(63, 63, 68)
};

function currentAccent() {
    return settings.accentMode === 1 ? sharedAlbumAccent : DEFAULT_UWP_ACCENT;
}

function refreshHostColours() {
    var resolved = RivageUI.createTheme({ mode: 'host', accent: currentAccent() });
    theme.background = resolved.background;
    theme.text = resolved.textPrimary;
    theme.muted = resolved.textMuted;
    theme.card = resolved.card;
    theme.cardHover = resolved.cardHover;
    theme.rowHover = resolved.rowHover;
    theme.stroke = resolved.stroke;
}

var fonts = {};
var hostFontName = "Segoe UI";
var lastPublishedHeaderStyleSignature = "";

function currentHeaderPixelSize() {
    return fontPx(Math.max(8, settings.fontSize - 1));
}

function publishHeaderStyle(force) {
    var payload = {
        family: hostFontName || "Segoe UI",
        pixelSize: currentHeaderPixelSize(),
        style: 1
    };
    var signature = payload.family.toLowerCase() + "|" +
        payload.pixelSize + "|" + payload.style;

    if (!force && signature === lastPublishedHeaderStyleSignature) return;

    try {
        window.NotifyOthers(PLAYBACK_STATS_HEADER_STYLE_UPDATE, payload);
        lastPublishedHeaderStyleSignature = signature;
    } catch (e) {
        if (signature === lastPublishedHeaderStyleSignature) lastPublishedHeaderStyleSignature = "";
    }
}

function rebuildFonts() {
    fonts.heading = RivageUI.font(hostFontName, fontPx(Math.max(8, settings.fontSize - 1)), 1);
    fonts.label = RivageUI.font(hostFontName, fontPx(Math.max(8, settings.fontSize - 1)), 0);
    fonts.value = RivageUI.font(hostFontName, fontPx(settings.fontSize), 1);
    fonts.empty = RivageUI.font(hostFontName, fontPx(Math.max(9, settings.fontSize)), 0);
    var consoleFont = RivageUI.consoleFontInfo();
    fonts.tooltip = RivageUI.font(consoleFont.fontFamily, consoleFont.fontSize, consoleFont.fontStyle || 0);
}

function updateFixedHeight() {
    var fixedHeight = _scale(82);
    try {
        window.MinHeight = fixedHeight;
        window.MaxHeight = fixedHeight;
    } catch (e) {
        // Some hosts ignore panel min/max constraints. The renderer remains
        // responsive if JSplitter supplies a different height.
    }
}

function on_font_changed() {
    hostFontName = RivageUI.hostFontFamily() || "Segoe UI";
    refreshPanelDpi();
    updateFixedHeight();
    layout();
    window.Repaint(true);
}

var SETTINGS_PANEL_ID = "playbackStatistics";
var SETTINGS_PANEL_LABEL = "Playback statistics";

function getMySettings() {
    return [
        {
            id: "cardLayout", label: "Card layout", type: "choice",
            value: settings.cardLayout === 1 ? "two" : "one",
            choiceValueType: "string",
            choices: [
                { value: "one", label: "One combined card" },
                { value: "two", label: "Two source cards" }
            ]
        },
        {
            id: "combinedCardMode", label: "Combined card source", type: "choice",
            value: combinedCardModeValue(),
            choiceValueType: "string",
            choices: [
                { value: "local", label: "Local playback statistics" },
                { value: "lastfm", label: "Last.fm scrobbles" },
                { value: "history", label: "Combined history" }
            ]
        },
        {
            id: "combinedCardRules", label: "Combined card rules", type: "info",
            value: "Local: local play count and dates.\n" +
                "Last.fm: Last.fm scrobbles and dates.\n" +
                "Combined: highest play count, earliest first play, and latest last play across both sources."
        },
        {
            id: "showLocal", label: "Show local card", type: "bool",
            value: settings.showLocal
        },
        {
            id: "showLastfm", label: "Show Last.fm card", type: "bool",
            value: settings.showLastfm
        },
        {
            id: "accentMode", label: "Accent colour", type: "choice",
            value: settings.accentMode === 1 ? "global" : "uwp",
            choiceValueType: "string",
            choices: [
                { value: "global", label: RivageUI.copy.labels.sharedAccent },
                { value: "uwp", label: RivageUI.copy.labels.rvgBlue }
            ]
        },
        {
            id: "dateMode", label: "Date detail", type: "choice",
            value: settings.dateMode === 1 ? "dateTime" : "date",
            choiceValueType: "string",
            choices: [
                { value: "date", label: "Date" },
                { value: "dateTime", label: "Date and time" }
            ]
        },
        {
            id: "backgroundPanel", label: "Show card background and border", type: "bool",
            value: settings.backgroundPanel
        },
        {
            id: "fontSize", label: "Text size", type: "number",
            value: settings.fontSize, min: 8, max: 13
        }
    ];
}

function applyMySetting(settingId, value) {
    var propertyName = "";
    var next;
    var needsLayout = false;
    var needsAccent = false;

    switch (settingId) {
    case "cardLayout":
        propertyName = "Card layout";
        next = value === "one" ? 0 : 1;
        needsLayout = true;
        break;
    case "combinedCardMode":
        propertyName = "Combined card mode";
        next = value === "local" ? 0 : (value === "lastfm" ? 1 : 2);
        needsLayout = true;
        break;
    case "showLocal":
        propertyName = "Show local statistics";
        next = !!value;
        needsLayout = true;
        break;
    case "showLastfm":
        propertyName = "Show Last.fm statistics";
        next = !!value;
        needsLayout = true;
        break;
    case "accentMode":
        propertyName = "Accent mode";
        next = (value === "uwp" || value === "interface") ? 0 : 1;
        needsAccent = next === 1;
        break;
    case "dateMode":
        propertyName = "Date mode";
        next = value === "dateTime" ? 1 : 0;
        break;
    case "backgroundPanel":
        propertyName = "Background panel";
        next = value === "with" || value === true;
        break;
    case "rivageSectionDesign":
        propertyName = "Background panel";
        next = !!value;
        settingId = "backgroundPanel";
        break;
    case "fontSize":
        propertyName = "Font size";
        next = normaliseInteger(value, 8, 13, settings.fontSize);
        needsLayout = true;
        break;
    default:
        return;
    }

    if (settings[settingId] === next) return;
    saveSetting(propertyName, next);
    settings[settingId] = next;

    clearHoverState();
    if (needsAccent) SharedAccentProtocol.requestAccent();
    if (needsLayout) layout();
    window.Repaint(true);
}

var statsTfo = {
    localPlayed: fb.TitleFormat("%play_count%"),
    localFirst: fb.TitleFormat("%first_played%"),
    localLast: fb.TitleFormat("%last_played%"),
    local2003Played: fb.TitleFormat("%2003_playcount%"),
    local2003First: fb.TitleFormat("%2003_first_played%"),
    local2003FirstAgo: fb.TitleFormat("%2003_first_played_ago%"),
    local2003FirstAgo2: fb.TitleFormat("%2003_first_played_ago2%"),
    local2003Last: fb.TitleFormat("%2003_last_played%"),
    local2003LastAgo: fb.TitleFormat("%2003_last_played_ago%"),
    local2003LastAgo2: fb.TitleFormat("%2003_last_played_ago2%"),
    enhancedFirst: fb.TitleFormat("%first_played_enhanced%"),
    enhancedLast: fb.TitleFormat("%last_played_enhanced%"),
    lastfmAdded: fb.TitleFormat("%lastfm_added%"),
    lastfmFirstDirect: fb.TitleFormat("%lastfm_first_played%"),
    lastfmLastDirect: fb.TitleFormat("%lastfm_last_played%"),
    lastfmPlayed: fb.TitleFormat("$if2(%lastfm_play_count%,$if2(%lastfm_playcount%,$if2(%scrobbled%,$if2(%last.fm scrobbled%,))))"),
    lastfmFirstLegacy: fb.TitleFormat("$if2(%first_scrobble%,$if2(%last.fm first scrobble%,))"),
    lastfmLastLegacy: fb.TitleFormat("$if2(%last_scrobble%,$if2(%last.fm last scrobble%,))")
};

function localPlayedValueForHandle(handle) {
    return PlaybackStatsSource.isPlaycount2003() ?
        evaluateForHandle(statsTfo.local2003Played, handle) :
        evaluateForHandle(statsTfo.localPlayed, handle);
}

function localFirstValueForHandle(handle, mode) {
    if (!PlaybackStatsSource.isPlaycount2003()) return evaluateForHandle(statsTfo.localFirst, handle);
    if (mode === 1) return evaluateForHandle(statsTfo.local2003FirstAgo, handle);
    if (mode === 2) return evaluateForHandle(statsTfo.local2003FirstAgo2, handle);
    return evaluateForHandle(statsTfo.local2003First, handle);
}

function localLastValueForHandle(handle, mode) {
    if (!PlaybackStatsSource.isPlaycount2003()) return evaluateForHandle(statsTfo.localLast, handle);
    if (mode === 1) return evaluateForHandle(statsTfo.local2003LastAgo, handle);
    if (mode === 2) return evaluateForHandle(statsTfo.local2003LastAgo2, handle);
    return evaluateForHandle(statsTfo.local2003Last, handle);
}

var statsCache = {
    valid: false,
    trackKey: "",
    local: null,
    lastfm: null,
    history: null
};

function getTrackKey(handle) {
    if (!handle) return "";
    try {
        return handle.Path + "|" + handle.SubSong;
    } catch (e) {
        return "";
    }
}

function cleanTitleFormatValue(value) {
    if (!value || value === "?") return "";
    return String(value).replace(/^\s+|\s+$/g, "");
}

function parseDateTime(value) {
    var dateMatch, timeMatch, date;
    value = cleanTitleFormatValue(value);
    if (!value.length) return { date: "-", full: "-" };

    dateMatch = value.match(/(\d{4})[-\/.](\d{2})[-\/.](\d{2})/);
    if (!dateMatch) return { date: "-", full: "-" };

    date = dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3];
    timeMatch = value.match(/(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/);
    return {
        date: date,
        full: timeMatch ? date + " " + timeMatch[1] + ":" + timeMatch[2] : date
    };
}

function evaluateForHandle(tfo, handle) {
    if (!handle) return "";
    try {
        return cleanTitleFormatValue(tfo.EvalWithMetadb(handle));
    } catch (e) {
        return "";
    }
}

// Enhanced fields can return error text; only fixed timestamps are comparable.
function validTimestamp(value) {
    var text = cleanTitleFormatValue(value);
    var match;
    var year;
    var month;
    var day;
    var hour;
    var minute;
    var second;
    var daysInMonth;

    if (!text.length || /^(?:n\/?a|invalid(?:\s+file)?\s+timestamp|invalid\s+date)$/i.test(text)) {
        return "";
    }

    match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (!match) return "";

    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6]);

    if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return "";

    daysInMonth = [
        31,
        (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31
    ];
    if (day < 1 || day > daysInMonth[month - 1]) return "";

    return match[1] + "-" + match[2] + "-" + match[3] + " " +
        match[4] + ":" + match[5] + ":" + match[6];
}

function pickTimestamp(first, second, latest) {
    first = validTimestamp(first);
    second = validTimestamp(second);

    if (!first.length) return second;
    if (!second.length) return first;
    return latest ? (first > second ? first : second) : (first < second ? first : second);
}

function normalizePlayCount(value) {
    var text = cleanTitleFormatValue(value);
    if (!/^\d+$/.test(text)) return "";
    return text.replace(/^0+(?=\d)/, "");
}

function pickLargerPlayCount(first, second) {
    first = normalizePlayCount(first);
    second = normalizePlayCount(second);

    if (!first.length) return second || "-";
    if (!second.length) return first;
    if (first.length !== second.length) return first.length > second.length ? first : second;
    return first >= second ? first : second;
}

function evaluateLastfmFirstForHandle(handle) {
    var value = validTimestamp(evaluateForHandle(statsTfo.lastfmFirstDirect, handle));
    if (value.length) return value;

    value = validTimestamp(evaluateForHandle(statsTfo.lastfmAdded, handle));
    if (value.length) return value;

    return evaluateForHandle(statsTfo.lastfmFirstLegacy, handle);
}

function evaluateLastfmLastForHandle(handle) {
    var value = validTimestamp(evaluateForHandle(statsTfo.lastfmLastDirect, handle));
    if (value.length) return value;
    return evaluateForHandle(statsTfo.lastfmLastLegacy, handle);
}

function evaluateHistoryFirstForHandle(handle) {
    // Enhanced first/last ignores Playcount 2003 and may emit a live "now" placeholder;
    // never consult it while Playcount 2003 is the selected local source.
    var direct = PlaybackStatsSource.isPlaycount2003() ?
        "" :
        validTimestamp(evaluateForHandle(statsTfo.enhancedFirst, handle));

    // History must compare real timestamps, never the local _ago display forms.
    var local = pickTimestamp(
        localFirstValueForHandle(handle, 0),
        evaluateLastfmFirstForHandle(handle),
        false
    );

    return pickTimestamp(direct, local, false);
}

function evaluateHistoryLastForHandle(handle) {
    var direct = PlaybackStatsSource.isPlaycount2003() ?
        "" :
        validTimestamp(evaluateForHandle(statsTfo.enhancedLast, handle));

    var local = pickTimestamp(
        localLastValueForHandle(handle, 0),
        evaluateLastfmLastForHandle(handle),
        true
    );

    return pickTimestamp(direct, local, true);
}

function makeStatsFromValues(playedValue, firstValue, lastValue) {
    var first = parseDateTime(firstValue);
    var last = parseDateTime(lastValue);
    return {
        played: cleanTitleFormatValue(playedValue) || "-",
        first: first.date,
        firstFull: first.full,
        last: last.date,
        lastFull: last.full
    };
}

function makeLastfmStats(handle) {
    return makeStatsFromValues(
        evaluateForHandle(statsTfo.lastfmPlayed, handle),
        evaluateLastfmFirstForHandle(handle),
        evaluateLastfmLastForHandle(handle)
    );
}

function makeHistoryStats(handle) {
    return makeStatsFromValues(
        pickLargerPlayCount(
            localPlayedValueForHandle(handle),
            evaluateForHandle(statsTfo.lastfmPlayed, handle)
        ),
        evaluateHistoryFirstForHandle(handle),
        evaluateHistoryLastForHandle(handle)
    );
}

// _ago values bypass timestamp parsing and are shown verbatim.
function makeLocalStats(handle) {
    var playedValue = localPlayedValueForHandle(handle);
    var firstMode = PlaybackStatsSource.isPlaycount2003() ? localTimeMode.first : 0;
    var lastMode = PlaybackStatsSource.isPlaycount2003() ? localTimeMode.last : 0;
    var firstRaw = localFirstValueForHandle(handle, firstMode);
    var lastRaw = localLastValueForHandle(handle, lastMode);
    var first = firstMode === 0 ?
        parseDateTime(firstRaw) :
        { date: cleanTitleFormatValue(firstRaw) || "-", full: cleanTitleFormatValue(firstRaw) || "-" };
    var last = lastMode === 0 ?
        parseDateTime(lastRaw) :
        { date: cleanTitleFormatValue(lastRaw) || "-", full: cleanTitleFormatValue(lastRaw) || "-" };

    return {
        played: cleanTitleFormatValue(playedValue) || "-",
        first: first.date,
        firstFull: first.full,
        last: last.date,
        lastFull: last.full
    };
}

function invalidateStats() {
    statsCache.valid = false;
}

function ensureStats() {
    var handle = getDisplayedTrack();
    var key;

    key = getTrackKey(handle);
    if (statsCache.valid && statsCache.trackKey === key) return handle;
    // A tab-switched-away or collapsed instance still receives every playback/
    // metadb callback in JSplitter (there is no visibility-change callback), and
    // those callbacks only invalidate this cache - the actual TitleFormat work
    // below runs from on_paint. Skip it while hidden; statsCache stays invalid
    // so the next visible paint recomputes normally.
    if (!VisiblePaintWork.isVisible()) return handle;

    statsCache.trackKey = key;
    statsCache.valid = true;
    if (!handle) {
        statsCache.local = null;
        statsCache.lastfm = null;
        statsCache.history = null;
        return null;
    }

    statsCache.local = makeLocalStats(handle);
    statsCache.lastfm = makeLastfmStats(handle);
    statsCache.history = makeHistoryStats(handle);
    return handle;
}

function combinedCardStats() {
    if (settings.combinedCardMode === 0) return statsCache.local;
    if (settings.combinedCardMode === 1) return statsCache.lastfm;
    return statsCache.history;
}

function displayedDate(shortValue, fullValue) {
    return settings.dateMode === 1 ? fullValue : shortValue;
}

var ww = 0;
var wh = 0;
var mouse = { x: -1, y: -1 };
var cards = [];
var regions = [];
var hoveredRegion = null;

var OUTER_PAD_PT = 4;
var GAP_PT = 8;
var CARD_PAD_PT = 8;
var CORNER_RADIUS_PT = 5;
var ACCENT_WIDTH_PT = 3;

function layout() {
    var outerPad, gap, availableW, visibleCount, cardW, x;

    ww = window.Width;
    wh = window.Height;
    cards = [];
    regions = [];

    if (ww <= 0 || wh <= 0) return;

    refreshPanelDpi();
    updateAdaptiveFontScale(ww, wh);
    rebuildFonts();
    publishHeaderStyle(false);

    outerPad = _scale(OUTER_PAD_PT);
    gap = _scale(GAP_PT);
    availableW = Math.max(0, ww - outerPad * 2);
    if (settings.cardLayout === 0) {
        cards.push({
            id: "single", label: combinedCardTitle(), x: outerPad, y: outerPad,
            w: availableW, h: Math.max(0, wh - outerPad * 2)
        });
        return;
    }

    visibleCount = (settings.showLocal ? 1 : 0) + (settings.showLastfm ? 1 : 0);
    if (!visibleCount) return;

    cardW = visibleCount === 1 ? availableW : Math.max(0, Math.floor((availableW - gap) / 2));
    x = outerPad;

    if (settings.showLocal) {
        cards.push({
            id: "local", label: "PLAYCOUNT", x: x, y: outerPad,
            w: cardW, h: Math.max(0, wh - outerPad * 2)
        });
        x += cardW + gap;
    }

    if (settings.showLastfm) {
        cards.push({
            id: "lastfm", label: "LAST.FM", x: x, y: outerPad,
            w: visibleCount === 1 ? availableW : Math.max(0, ww - outerPad - x),
            h: Math.max(0, wh - outerPad * 2)
        });
    }
}

function pointInRect(x, y, rect) {
    return !!rect && x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function regionAt(x, y) {
    var i;
    for (i = regions.length - 1; i >= 0; i--) {
        if (pointInRect(x, y, regions[i])) return regions[i];
    }
    return null;
}

function sameRegion(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.source === b.source && a.field === b.field;
}

var TOOLTIP_DELAY_MS = 350;
var tooltipTimer = null;
var tooltipText = "";
var tooltipPendingText = "";

function clearTooltipTimer() {
    if (tooltipTimer !== null) {
        window.ClearTimeout(tooltipTimer);
        tooltipTimer = null;
    }
    tooltipPendingText = "";
}

function scheduleTooltip(text) {
    if (!text) {
        hideTooltip();
        return;
    }
    if (tooltipText === text || (tooltipTimer !== null && tooltipPendingText === text)) return;

    clearTooltipTimer();
    tooltipText = "";
    tooltipPendingText = text;
    tooltipTimer = window.SetTimeout(function () {
        tooltipTimer = null;
        if (tooltipPendingText === text) {
            tooltipPendingText = "";
            tooltipText = text;
            window.Repaint();
        }
    }, TOOLTIP_DELAY_MS);
}

function hideTooltip() {
    var changed = tooltipText.length > 0 || tooltipTimer !== null;
    clearTooltipTimer();
    tooltipText = "";
    if (changed) window.Repaint();
}

function drawTooltip(gr) {
    var lines, lineH, padX, padY, maxTextW, i, boxW, boxH, x, y;

    if (!tooltipText || !fonts.tooltip || ww <= 0 || wh <= 0) return;

    lines = tooltipText.split("\n");
    lineH = _scale(14);
    padX = _scale(9);
    padY = _scale(6);
    maxTextW = 0;

    for (i = 0; i < lines.length; i++) {
        maxTextW = Math.max(maxTextW, Math.ceil(gr.CalcTextWidth(lines[i], fonts.tooltip)));
    }

    var margin = _scale(4);
    var availableW = Math.max(0, ww - margin * 2);
    var availableH = Math.max(0, wh - margin * 2);
    if (availableW <= 0 || availableH <= 0) return;

    boxW = Math.min(Math.max(_scale(120), maxTextW + padX * 2), availableW);
    boxH = Math.min(lines.length * lineH + padY * 2, availableH);
    x = Math.min(Math.max(margin, mouse.x - boxW / 2), ww - boxW - margin);
    y = margin;

    tooltipPainter.tooltipBox(gr, { x: x, y: y, w: boxW, h: boxH }, lines, fonts.tooltip, {
        lineHeight: 14,
        paddingX: 9,
        paddingY: 6,
        radius: 5,
        shadowOffset: 2,
        fill: RGB(28, 28, 31),
        stroke: RGB(90, 90, 96),
        textColour: RGB(244, 244, 246),
        shadow: RGB(10, 10, 12),
        textFlags: DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX
    });
}

function addRegion(x, y, w, h, source, field, tooltip) {
    if (w <= 0 || h <= 0) return;
    regions.push({
        x: x, y: y, w: w, h: h,
        source: source, field: field, tooltip: tooltip
    });
}

function makeTooltip(sourceLabel, values, clickHint) {
    var tooltip = sourceLabel + " playback statistics" +
        "\nPlayed: " + values.played +
        "\nFirst: " + values.firstFull +
        "\nLast: " + values.lastFull;
    if (clickHint) tooltip += "\nClick First / Last to toggle date, \"ago\", \"ago2\"";
    return tooltip;
}

function cardSourceLabel(card) {
    if (card.id === "local") return "Playcount";
    if (card.id === "lastfm") return "Last.fm";
    return combinedCardSourceLabel();
}

function isLocalTimeToggleSource(sourceId) {
    if (!PlaybackStatsSource.isPlaycount2003()) return false;
    if (sourceId === "local") return true;
    return sourceId === "single" && settings.combinedCardMode === 0;
}

function paintMetric(gr, card, sourceId, field, label, value, x, y, w, h, tooltip) {
    var labelW;
    var isHovered = hoveredRegion && hoveredRegion.source === sourceId && hoveredRegion.field === field;

    if (h <= 0 || w <= 0) return;
    if (isHovered) gr.FillSolidRect(x - _scale(2), y, w + _scale(4), h, theme.rowHover);

    labelW = Math.max(_scale(42), Math.min(Math.floor(w * 0.36), _scale(72)));
    gr.GdiDrawText(label, fonts.label, theme.muted,
        x, y, Math.max(0, labelW - _scale(6)), h,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    gr.GdiDrawText(value, fonts.value, theme.text,
        x + labelW, y, Math.max(0, w - labelW), h,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    addRegion(x, y, w, h, sourceId, field, tooltip);
}

function paintCard(gr, card, values) {
    var cardHovered, tooltip, cardPad, headingH, rowsTop, rowH, innerX, innerW;
    var accentY, accentH, radius, accentWidth;

    if (!values || card.w <= 0 || card.h <= 0) return;

    cardHovered = hoveredRegion && hoveredRegion.source === card.id;
    tooltip = makeTooltip(cardSourceLabel(card), values, isLocalTimeToggleSource(card.id));
    cardPad = _scale(CARD_PAD_PT);
    radius = Math.max(0, Math.min(_scale(CORNER_RADIUS_PT), card.w / 2, card.h / 2));
    accentWidth = _scale(ACCENT_WIDTH_PT);

    if (settings.backgroundPanel) {
        gr.FillRoundRect(card.x, card.y, card.w, card.h, radius, radius,
            cardHovered ? theme.cardHover : theme.card);
        gr.DrawRoundRect(card.x, card.y, Math.max(1, card.w - 1), Math.max(1, card.h - 1),
            radius, radius, 1, theme.stroke);
    }

    accentY = card.y + _scale(7);
    accentH = Math.max(0, card.h - _scale(14));
    if (accentH > 0) gr.FillSolidRect(card.x, accentY, accentWidth, accentH, currentAccent());

    innerX = card.x + cardPad;
    innerW = Math.max(0, card.w - cardPad * 2);
    headingH = Math.min(card.h, Math.max(_scale(17), Math.round(card.h * 0.27)));
    rowsTop = card.y + headingH;
    rowH = Math.max(1, Math.floor((card.h - headingH - _scale(2)) / 3));

    gr.GdiDrawText(card.label, fonts.heading, currentAccent(),
        innerX, card.y + _scale(2), innerW, Math.max(1, headingH - _scale(2)),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    addRegion(card.x, card.y, card.w, headingH, card.id, "heading", tooltip);

    paintMetric(gr, card, card.id, "played", "Played", values.played,
        innerX, rowsTop, innerW, rowH, tooltip);
    paintMetric(gr, card, card.id, "first", "First",
        displayedDate(values.first, values.firstFull),
        innerX, rowsTop + rowH, innerW, rowH, tooltip);
    paintMetric(gr, card, card.id, "last", "Last",
        displayedDate(values.last, values.lastFull),
        innerX, rowsTop + rowH * 2, innerW, rowH, tooltip);
}

function on_paint(gr) {
    var handle, i, card, values, smoothingChanged = false;

    // Rectangular backdrop before anti-aliasing: GDI+ shape smoothing filters the
    // DrawImage destination edge into a visible seam on the left and top rows.
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);

    if (typeof gr.SetSmoothingMode === "function") {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    regions = [];
    handle = ensureStats();

    if (settings.cardLayout === 1 && !settings.showLocal && !settings.showLastfm) {
        gr.GdiDrawText("Enable a statistics source in Settings.", fonts.empty, theme.muted,
            _scale(12), 0, Math.max(0, ww - _scale(24)), wh,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    } else if (!handle) {
        gr.GdiDrawText("No track selected", fonts.empty, theme.muted,
            _scale(12), 0, Math.max(0, ww - _scale(24)), wh,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    } else {
        for (i = 0; i < cards.length; i++) {
            card = cards[i];
            if (card.id === "local") values = statsCache.local;
            else if (card.id === "lastfm") values = statsCache.lastfm;
            else values = combinedCardStats();
            paintCard(gr, card, values);
        }
    }

    drawTooltip(gr);

    if (smoothingChanged) {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
        } catch (e2) {
            // Ignore graphics-state restoration failures.
        }
    }
}

var MENU_ID = {
    layoutOne: 40,
    layoutTwo: 41,
    combinedLocal: 42,
    combinedLastfm: 43,
    combinedHistory: 44,
    showLocal: 1,
    showLastfm: 2,
    accentGlobal: 10,
    accentUwp: 11,
    dateOnly: 20,
    dateTime: 21,
    refresh: 30,
    configure: 31,
    backgroundWith: 32,
    backgroundWithout: 33
};

function regionIsTimeToggle(region) {
    return !!region && (region.field === "first" || region.field === "last") &&
        isLocalTimeToggleSource(region.source);
}

function on_mouse_move(x, y) {
    var nextRegion;
    mouse.x = x;
    mouse.y = y;
    nextRegion = regionAt(x, y);

    if (!sameRegion(nextRegion, hoveredRegion)) {
        hoveredRegion = nextRegion;
        if (hoveredRegion) scheduleTooltip(hoveredRegion.tooltip);
        else hideTooltip();
        window.Repaint();
    }

    window.SetCursor(regionIsTimeToggle(hoveredRegion) ? IDC_HAND : IDC_ARROW);
}

function on_mouse_leave() {
    hoveredRegion = null;
    hideTooltip();
    window.SetCursor(IDC_ARROW);
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    var region = regionAt(x, y);

    if (!regionIsTimeToggle(region)) return false;

    cycleLocalTimeMode(region.field);
    return true;
}

function showConfigure() {
    try {
        window.ShowConfigureV2();
    } catch (e) {
        try {
            window.ShowConfigure();
        } catch (e2) {
            // No configuration entry point exposed by this host.
        }
    }
}

function on_mouse_rbtn_up(x, y) {
    var menu = window.CreatePopupMenu();
    var layoutMenu = window.CreatePopupMenu();
    var combinedModeMenu = window.CreatePopupMenu();
    var accentMenu = window.CreatePopupMenu();
    var dateMenu = window.CreatePopupMenu();
    var id;

    hideTooltip();

    layoutMenu.AppendMenuItem(MF_STRING, MENU_ID.layoutOne, "One combined card");
    layoutMenu.AppendMenuItem(MF_STRING, MENU_ID.layoutTwo, "Two source cards");
    layoutMenu.CheckMenuRadioItem(MENU_ID.layoutOne, MENU_ID.layoutTwo,
        settings.cardLayout === 0 ? MENU_ID.layoutOne : MENU_ID.layoutTwo);
    layoutMenu.AppendTo(menu, MF_STRING, "Card layout");

    combinedModeMenu.AppendMenuItem(MF_STRING, MENU_ID.combinedLocal,
        "Local playback statistics");
    combinedModeMenu.AppendMenuItem(MF_STRING, MENU_ID.combinedLastfm,
        "Last.fm scrobbles");
    combinedModeMenu.AppendMenuItem(MF_STRING, MENU_ID.combinedHistory,
        "Combined history");
    combinedModeMenu.CheckMenuRadioItem(MENU_ID.combinedLocal, MENU_ID.combinedHistory,
        settings.combinedCardMode === 0 ? MENU_ID.combinedLocal :
            (settings.combinedCardMode === 1 ? MENU_ID.combinedLastfm : MENU_ID.combinedHistory));
    combinedModeMenu.AppendTo(menu, MF_STRING, "Combined card source");

    menu.AppendMenuSeparator();

    menu.AppendMenuItem(MF_STRING, MENU_ID.showLocal, "Show local card");
    menu.CheckMenuItem(MENU_ID.showLocal, settings.showLocal);
    menu.AppendMenuItem(MF_STRING, MENU_ID.showLastfm, "Show Last.fm card");
    menu.CheckMenuItem(MENU_ID.showLastfm, settings.showLastfm);
    menu.AppendMenuSeparator();

    accentMenu.AppendMenuItem(MF_STRING, MENU_ID.accentGlobal, RivageUI.copy.labels.sharedAccent);
    accentMenu.AppendMenuItem(MF_STRING, MENU_ID.accentUwp, RivageUI.copy.labels.rvgBlue);
    accentMenu.CheckMenuRadioItem(MENU_ID.accentGlobal, MENU_ID.accentUwp,
        settings.accentMode === 1 ? MENU_ID.accentGlobal : MENU_ID.accentUwp);
    accentMenu.AppendTo(menu, MF_STRING, "Accent colour");

    dateMenu.AppendMenuItem(MF_STRING, MENU_ID.dateOnly, "Date");
    dateMenu.AppendMenuItem(MF_STRING, MENU_ID.dateTime, "Date and time");
    dateMenu.CheckMenuRadioItem(MENU_ID.dateOnly, MENU_ID.dateTime,
        settings.dateMode === 1 ? MENU_ID.dateTime : MENU_ID.dateOnly);
    dateMenu.AppendTo(menu, MF_STRING, "Date detail");

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.backgroundWith, "Show card background and border");
    menu.CheckMenuItem(MENU_ID.backgroundWith, settings.backgroundPanel);

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.refresh, "Refresh playback statistics");
    menu.AppendMenuItem(MF_STRING, MENU_ID.configure, RivageUI.copy.labels.panelConfiguration);

    id = menu.TrackPopupMenu(x, y);

    switch (id) {
    case MENU_ID.layoutOne:
        applyMySetting("cardLayout", "one");
        break;
    case MENU_ID.layoutTwo:
        applyMySetting("cardLayout", "two");
        break;
    case MENU_ID.combinedLocal:
        applyMySetting("combinedCardMode", "local");
        break;
    case MENU_ID.combinedLastfm:
        applyMySetting("combinedCardMode", "lastfm");
        break;
    case MENU_ID.combinedHistory:
        applyMySetting("combinedCardMode", "history");
        break;
    case MENU_ID.showLocal:
        applyMySetting("showLocal", !settings.showLocal);
        break;
    case MENU_ID.showLastfm:
        applyMySetting("showLastfm", !settings.showLastfm);
        break;
    case MENU_ID.accentGlobal:
        applyMySetting("accentMode", "global");
        break;
    case MENU_ID.accentUwp:
        applyMySetting("accentMode", "uwp");
        break;
    case MENU_ID.dateOnly:
        applyMySetting("dateMode", "date");
        break;
    case MENU_ID.dateTime:
        applyMySetting("dateMode", "dateTime");
        break;
    case MENU_ID.backgroundWith:
        applyMySetting("backgroundPanel", !settings.backgroundPanel);
        break;
    case MENU_ID.refresh:
        invalidateStats();
        SharedAccentProtocol.requestAccent();
        window.Repaint(true);
        break;
    case MENU_ID.configure:
        showConfigure();
        break;
    }

    return true;
}

function clearHoverState() {
    hoveredRegion = null;
    hideTooltip();
    window.SetCursor(IDC_ARROW);
}

function on_size(width, height) {
    clearHoverState();
    layout();
}

function on_colours_changed() {
    refreshHostColours();
    SharedThemeProtocol.requestRepaint();
}

function refreshForTrackSelectionChange() {
    invalidateStats();
    clearHoverState();
    window.Repaint(true);
}

function on_item_focus_change(playlistIndex, from, to) {
    if (TrackContext.followsSelection()) refreshForTrackSelectionChange();
}

function on_selection_changed() {
    if (TrackContext.followsSelection()) refreshForTrackSelectionChange();
}

function on_playlist_items_selection_change() {
    if (TrackContext.followsSelection()) refreshForTrackSelectionChange();
}

function on_playlist_switch() {
    if (TrackContext.followsSelection()) refreshForTrackSelectionChange();
}

function on_metadb_changed() {
    invalidateStats();
    clearHoverState();
    window.Repaint(true);
}

function on_playback_dynamic_info_track(type) {
    if (type === 0 && TrackContext.followsPlayback()) refreshForTrackSelectionChange();
}

function on_playback_new_track(metadb) {
    if (TrackContext.followsPlayback()) refreshForTrackSelectionChange();
}

function on_playback_stop(reason) {
    if (reason === PLAYBACK_STOP_STARTING_ANOTHER) return;
    if (TrackContext.effectiveMode() === TrackContext.MODE_SELECTION && !TrackContext.followsPlayback()) return;
    refreshForTrackSelectionChange();
}

function on_script_unload() {
    clearTooltipTimer();
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (name === PLAYBACK_STATS_HEADER_STYLE_REQUEST) {
        publishHeaderStyle(true);
        return;
    }

    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (name === SettingsRegistry.VALUE_CHANGED && info && info.panelId === 'global') {
        PlaybackStatsSource.applySetting(info.settingId, info.value);
        TrackContext.applySetting(info.settingId, info.value);
        return;
    }
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (settings.accentMode === 1) window.Repaint();
    }
}

refreshHostColours();
on_font_changed();

SharedAccentProtocol.request();
publishHeaderStyle(true);

PlaybackStatsSource.onChange(function () {
    invalidateStats();
    clearHoverState();
    window.Repaint(true);
});
PlaybackStatsSource.requestSync();
TrackContext.onChange(refreshForTrackSelectionChange);
TrackContext.requestSync();
