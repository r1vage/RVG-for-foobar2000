window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\marquee_widget.js');

window.EraseOnRepaint = false;

window.DefineScript('RVG Playback Timeline', {
    author: 'RivaGe',
    version: '2.4.0',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});


var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var IDC_SIZEWE = 32644;

var PLAYBACK_STOP_STARTING_ANOTHER_TRACK = 2;

var ONE_SECOND = 1000;
var ONE_MINUTE = 60 * ONE_SECOND;
var ONE_HOUR = 60 * ONE_MINUTE;
var ONE_DAY = 24 * ONE_HOUR;

// Keep pill arcs comfortably inside JSplitter 4.1.13's stroked rectangle.
// This value is in RVG design units; painter.pill() applies UI scaling.
var PILL_RADIUS = 8;


function clamp(value, minimum, maximum) {
    value = Number(value);
    if (!isFinite(value)) value = minimum;
    return Math.max(minimum, Math.min(maximum, value));
}

function pad2(value) {
    value = Math.floor(Math.abs(Number(value) || 0));
    return value < 10 ? '0' + value : String(value);
}

function safeText(value) {
    return String(value == null ? '' : value);
}

function trimText(value) {
    return safeText(value).replace(/^\s+|\s+$/g, '');
}

function saveSetting(name, value) {
    window.SetProperty('RVG Playback Timeline' + name, value);
}

function formatInteger(value) {
    var text = String(Math.max(0, Math.round(Number(value) || 0)));
    return text.replace(/(\d)(?=(\d{3})+$)/g, '$1,');
}

function formatDateTime(ms) {
    var d = new Date(ms);
    if (!isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function formatDateOnly(ms) {
    var d = new Date(ms);
    if (!isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatDuration(ms) {
    ms = Math.max(0, Number(ms) || 0);
    var days = ms / ONE_DAY;
    if (days >= 730) return (days / 365.2425).toFixed(days >= 3650 ? 0 : 1) + ' years';
    if (days >= 60) return (days / 30.4375).toFixed(days >= 365 ? 0 : 1) + ' months';
    if (days >= 2) return Math.round(days) + ' days';
    if (ms >= 2 * ONE_HOUR) return Math.round(ms / ONE_HOUR) + ' hours';
    if (ms >= 2 * ONE_MINUTE) return Math.round(ms / ONE_MINUTE) + ' minutes';
    return Math.round(ms / ONE_SECOND) + ' seconds';
}

function medianInPlace(numbers) {
    if (!numbers || !numbers.length) return 0;
    numbers.sort(function (a, b) { return a - b; });
    var middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function lowerBoundEvents(events, time) {
    var low = 0;
    var high = events.length;
    while (low < high) {
        var middle = (low + high) >> 1;
        if (events[middle].time < time) low = middle + 1;
        else high = middle;
    }
    return low;
}

function nearestVisibleEventIndex(events, time, first, lastExclusive) {
    var at;
    if (!events.length || first < 0 || first >= lastExclusive) return -1;

    at = lowerBoundEvents(events, time);
    if (at < first) at = first;
    if (at >= lastExclusive) return lastExclusive - 1;
    if (at === first) return at;
    return Math.abs(events[at].time - time) < Math.abs(events[at - 1].time - time)
        ? at : at - 1;
}

function safeHandleKey(handle) {
    if (!handle) return 'none';
    var path = '';
    var subsong = 0;
    try { path = safeText(handle.RawPath); } catch (e) { path = ''; }
    try { subsong = Number(handle.SubSong) || 0; } catch (e2) { subsong = 0; }
    if (!path) {
        try { path = fb.TitleFormat('$if2(%path%,%title%)').EvalWithMetadb(handle); } catch (e3) { path = 'handle'; }
    }
    return path + '#' + subsong;
}

function safeEval(tfo, handle) {
    if (!tfo || !handle) return '';
    try { return safeText(tfo.EvalWithMetadb(handle)); } catch (e) { return ''; }
}

function parseFoobarDate(value) {
    var text = trimText(value);
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(text);
    if (!match) return NaN;

    var year = Number(match[1]);
    var month = Number(match[2]) - 1;
    var day = Number(match[3]);
    var hour = Number(match[4] || 0);
    var minute = Number(match[5] || 0);
    var second = Number(match[6] || 0);
    var millisecondText = match[7] || '0';
    while (millisecondText.length < 3) millisecondText += '0';
    var millisecond = Number(millisecondText.substr(0, 3));
    var date = new Date(year, month, day, hour, minute, second, millisecond);

    // Reject rollover dates such as 2018-02-31.
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day ||
        date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
        return NaN;
    }
    return date.getTime();
}

function parsePlayedTimes(text) {
    var payload;
    var events = [];
    var i;
    var value;
    var ms;

    text = trimText(text);
    if (!text || text === 'N/A' || text === '?') return events;

    // Enhanced Playback Statistics exposes both history fields as JSON-style
    // arrays of formatted date strings. Keep one parser so Local / Last.fm
    // mode changes only the title-format field, not the timestamp semantics.
    try { payload = JSON.parse(text); } catch (e) { return events; }
    if (!(payload instanceof Array)) return events;

    for (i = 0; i < payload.length; i++) {
        value = payload[i];
        if (typeof value === 'number') ms = Number(value);
        else ms = parseFoobarDate(value);
        if (isFinite(ms) && ms > 0) events.push({ time: ms });
    }

    events.sort(function (a, b) { return a.time - b.time; });
    return events;
}


var SETTINGS_PANEL_ID = 'playback_timeline';
var SETTINGS_PANEL_LABEL = 'Playback timeline';

var HistoryMode = {
    LOCAL: 'local',
    LASTFM: 'lastfm'
};

function normaliseHistoryMode(value) {
    return value === HistoryMode.LOCAL ? HistoryMode.LOCAL : HistoryMode.LASTFM;
}

function historySourceLabel() {
    return settings.historyMode === HistoryMode.LOCAL ? 'Local listens' : 'Last.fm scrobbles';
}

function historyFieldName() {
    return settings.historyMode === HistoryMode.LOCAL ? '%played_times%' : '%lastfm_played_times%';
}

var AccentMode = {
    SHARED_ALBUM: 'album',
    GLOBAL_THEME: 'theme'
};

function normaliseAccentMode(value) {
    return value === AccentMode.GLOBAL_THEME ? AccentMode.GLOBAL_THEME : AccentMode.SHARED_ALBUM;
}

var DensityStyle = {
    AREA: 'area',
    BARS: 'bars'
};

function normaliseDensityStyle(value) {
    return String(value).toLowerCase() === DensityStyle.BARS ? DensityStyle.BARS : DensityStyle.AREA;
}

var RugStyle = {
    OFF: 'off',
    TICKS: 'ticks',
    DOTS: 'dots',
    HEAT: 'heat'
};

function normaliseRugStyle(value) {
    value = String(value == null ? '' : value).toLowerCase();
    if (value === RugStyle.OFF || value === RugStyle.TICKS ||
        value === RugStyle.DOTS || value === RugStyle.HEAT) {
        return value;
    }
    return RugStyle.TICKS;
}

// The rug was an on/off bool up to v2.3.0. The new choice property is read
// FIRST and only falls back to that bool when it has never been written -
// reading the legacy property first would resurrect a stale value every time
// the style changed, which is exactly how the middle splitter lost its custom
// sizing across restarts.
function loadRugStyle() {
    var stored = trimText(window.GetProperty('RVG Playback TimelineRug style', ''));
    if (stored) return normaliseRugStyle(stored);

    stored = window.GetProperty('RVG Playback TimelineShow event rug', true)
        ? RugStyle.TICKS
        : RugStyle.OFF;
    saveSetting('Rug style', stored);
    return stored;
}

function rugEnabled() {
    return settings.rugStyle !== RugStyle.OFF;
}

function barsMode() {
    return settings.showDensity && settings.densityStyle === DensityStyle.BARS;
}

var settings = {
    trackContextOverride: TrackContext.normaliseOverride(
        window.GetProperty('RVG Playback TimelineTrack context override', TrackContext.MODE_GLOBAL)
    ),
    historyMode: normaliseHistoryMode(window.GetProperty('RVG Playback TimelineHistory mode', HistoryMode.LASTFM)),
    accentMode: normaliseAccentMode(window.GetProperty('RVG Playback TimelineAccent mode', AccentMode.SHARED_ALBUM)),
    showDensity: !!window.GetProperty('RVG Playback TimelineShow density', true),
    densityStyle: normaliseDensityStyle(
        window.GetProperty('RVG Playback TimelineDensity style', DensityStyle.AREA)
    ),
    rugStyle: loadRugStyle(),
    showStats: !!window.GetProperty('RVG Playback TimelineShow stats', true),
    densitySmoothing: Math.round(clamp(window.GetProperty('RVG Playback TimelineDensity smoothing', 3), 0, 6))
};

function getMySettings() {
    return [
        {
            id: 'trackContextOverride', label: 'Track source', type: 'choice',
            value: settings.trackContextOverride, choiceValueType: 'string',
            choices: TrackContext.getOverrideChoices(), section: 'Data'
        },
        {
            id: 'historyMode', label: 'History source', type: 'choice',
            value: settings.historyMode, choiceValueType: 'string',
            choices: [
                { value: HistoryMode.LOCAL, label: 'Local listens' },
                { value: HistoryMode.LASTFM, label: 'Last.fm scrobbles' }
            ],
            section: 'Data'
        },
        {
            id: 'enhancedPlaybackStatsInfo', label: 'Data source', type: 'info',
            value: 'Uses Enhanced Playback Statistics (foo_enhanced_playcount).\n' +
                'Local listens read %played_times%; Last.fm scrobbles read %lastfm_played_times%.',
            section: 'Data'
        },
        {
            id: 'showDensity', label: 'Show listening density', type: 'bool',
            value: settings.showDensity, section: 'Appearance'
        },
        {
            id: 'densityStyle', label: 'Density display', type: 'choice',
            value: settings.densityStyle, choiceValueType: 'string',
            choices: [
                { value: DensityStyle.AREA, label: 'Area' },
                { value: DensityStyle.BARS, label: 'Bars' }
            ],
            section: 'Appearance'
        },
        {
            id: 'rugStyle', label: 'Listen markers', type: 'choice',
            value: settings.rugStyle, choiceValueType: 'string',
            choices: [
                { value: RugStyle.OFF, label: 'Off' },
                { value: RugStyle.TICKS, label: 'Ticks' },
                { value: RugStyle.DOTS, label: 'Dots' },
                { value: RugStyle.HEAT, label: 'Heat strip' }
            ],
            section: 'Appearance'
        },
        {
            id: 'showStats', label: 'Show summary statistics', type: 'bool',
            value: settings.showStats, section: 'Appearance'
        },
        {
            id: 'densitySmoothing', label: 'Density smoothing', type: 'number',
            value: settings.densitySmoothing, min: 0, max: 6, step: 1,
            hidden: settings.densityStyle !== DensityStyle.AREA, section: 'Appearance'
        },
        {
            id: 'accentMode', label: 'Accent source', type: 'choice',
            value: settings.accentMode, choiceValueType: 'string',
            choices: [
                { value: AccentMode.SHARED_ALBUM, label: RivageUI.copy.labels.sharedAccent },
                { value: AccentMode.GLOBAL_THEME, label: RivageUI.copy.labels.rvgBlue }
            ],
            section: 'Appearance'
        }
    ];
}

function applyMySetting(settingId, value) {
    var next;

    if (settingId === 'trackContextOverride') {
        next = TrackContext.normaliseOverride(value);
        if (next === settings.trackContextOverride) return;
        saveSetting('Track context override', next);
        settings.trackContextOverride = next;
        scheduleDataRefresh(true);
        return;
    }
    if (settingId === 'historyMode') {
        next = normaliseHistoryMode(value);
        if (next === settings.historyMode) return;
        saveSetting('History mode', next);
        settings.historyMode = next;
        scheduleDataRefresh(true);
        return;
    }
    if (settingId === 'showDensity') {
        next = !!value;
        if (next === settings.showDensity) return;
        saveSetting('Show density', next);
        settings.showDensity = next;
        rebuildPlotCache();
        window.Repaint();
        return;
    }
    if (settingId === 'densityStyle') {
        next = normaliseDensityStyle(value);
        if (next === settings.densityStyle) return;
        saveSetting('Density style', next);
        settings.densityStyle = next;
        rebuildPlotCache();
        window.Repaint();
        return;
    }
    if (settingId === 'rugStyle') {
        next = normaliseRugStyle(value);
        if (next === settings.rugStyle) return;
        saveSetting('Rug style', next);
        settings.rugStyle = next;
        rebuildPlotCache();
        window.Repaint();
        return;
    }
    if (settingId === 'showStats') {
        next = !!value;
        if (next === settings.showStats) return;
        saveSetting('Show stats', next);
        settings.showStats = next;
        layoutPanel();
        window.Repaint();
        return;
    }
    if (settingId === 'densitySmoothing') {
        next = Math.round(clamp(value, 0, 6));
        if (next === settings.densitySmoothing) return;
        saveSetting('Density smoothing', next);
        settings.densitySmoothing = next;
        rebuildPlotCache();
        window.Repaint();
        return;
    }
    if (settingId === 'accentMode') {
        next = normaliseAccentMode(value);
        if (next === settings.accentMode) return;
        saveSetting('Accent mode', next);
        settings.accentMode = next;
        if (next === AccentMode.SHARED_ALBUM) SharedAccentProtocol.requestAccent();
        refreshVisualResources(false);
        window.Repaint();
    }
}


var tfoPlayedTimes = fb.TitleFormat('%played_times%');
var tfoLastfmPlayedTimes = fb.TitleFormat('%lastfm_played_times%');
var tfoTitle = fb.TitleFormat('$if2(%title%,Unknown title)');
var tfoArtist = fb.TitleFormat('$if2(%artist%,$if2(%album artist%,Unknown artist))');

var model = {
    events: [],
    title: 'Playback timeline',
    artist: '',
    sourceLabel: 'Last.fm scrobbles',
    emptyReason: '',
    first: 0,
    last: 0,
    medianGap: 0,
    span: 0
};

var dataRequestSerial = 0;
var pendingResetView = true;
var lastBuiltHandleKey = 'none';

function buildDataRequestKey() {
    var handle = TrackContext.getHandle(settings.trackContextOverride);
    return settings.trackContextOverride + '|' + settings.historyMode + '|' + safeHandleKey(handle) + '|' + dataRequestSerial;
}

function buildModelFromCurrentContext() {
    var handle = TrackContext.getHandle(settings.trackContextOverride);
    var sourceRaw = '';
    var events = [];
    var title = '';
    var artist = '';
    var handleKey = safeHandleKey(handle);
    var sourceLabel = historySourceLabel();
    var sourceField = historyFieldName();
    var gaps = [];
    var i;

    if (handle) {
        title = safeEval(tfoTitle, handle) || 'Unknown title';
        artist = safeEval(tfoArtist, handle);
        sourceRaw = safeEval(settings.historyMode === HistoryMode.LOCAL ? tfoPlayedTimes : tfoLastfmPlayedTimes, handle);
        events = parsePlayedTimes(sourceRaw);
    }

    for (i = 1; i < events.length; i++) gaps.push(events[i].time - events[i - 1].time);

    model = {
        events: events,
        title: title || 'Playback timeline',
        artist: artist || '',
        sourceLabel: sourceLabel,
        emptyReason: '',
        first: events.length ? events[0].time : 0,
        last: events.length ? events[events.length - 1].time : 0,
        medianGap: medianInPlace(gaps),
        span: events.length > 1 ? events[events.length - 1].time - events[0].time : 0
    };

    if (!events.length) {
        if (!handle) {
            model.emptyReason = 'No track is available for the current track-source setting.';
        } else if (!sourceRaw || sourceRaw === '?' || sourceRaw === 'N/A') {
            model.emptyReason = sourceField + ' is not available for this track.';
        } else {
            model.emptyReason = 'This track has no valid ' +
                (settings.historyMode === HistoryMode.LOCAL ? 'local' : 'Last.fm') +
                ' listen timestamps.';
        }
    }

    // Hover indices belong to the previous event array.
    hoveredEventIndex = -1;

    // A track identity change always resets zoom. Same-track metadata refreshes
    // can preserve a zoomed window, but must still adopt the new full data range.
    if (pendingResetView || handleKey !== lastBuiltHandleKey) resetViewToData(true);
    else clampViewToData(true);
    pendingResetView = false;
    lastBuiltHandleKey = handleKey;

    // layoutPanel() rebuilds marquee/plot caches. The current paint already
    // renders this model, so requesting another repaint here would duplicate work.
    layoutPanel();
}

var dataGate = VisiblePaintWork.create(function () {
    // Re-query here; callback-owned foobar handles must not be retained across paints.
    buildModelFromCurrentContext();
});

function scheduleDataRefresh(resetView) {
    cancelDrag();
    if (resetView) pendingResetView = true;
    dataRequestSerial++;
    dataGate.request(buildDataRequestKey());
}


var ww = Math.max(0, Number(window.Width) || 0);
var wh = Math.max(0, Number(window.Height) || 0);
var uiScale = 1;
var sharedAlbumAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);
var hostInfo = RivageUI.hostInfo();
var theme = RivageUI.createTheme({ host: hostInfo, accent: sharedAlbumAccent });
var painter = RivageUI.createPainter({ scale: scaleUi, theme: theme });

var fonts = {
    title: null,
    subtitle: null,
    axis: null,
    small: null,
    metricLabel: null,
    metricValue: null,
    tooltip: null
};

function scaleUi(value) {
    value = Number(value) || 0;
    if (value === 0) return 0;
    return Math.max(1, Math.round(value * uiScale));
}

function currentAccent() {
    if (settings.accentMode === AccentMode.SHARED_ALBUM) {
        return SharedAccentProtocol.opaque(sharedAlbumAccent);
    }
    // The non-album RVG accent is the shared design system's canonical UWP
    // blue, matching the rest of the theme rather than the host highlight.
    return RivageUI.opaque(RivageUI.DEFAULT_ACCENT);
}

function accentWithAlpha(alpha) {
    if (settings.accentMode === AccentMode.SHARED_ALBUM) {
        return SharedAccentProtocol.withAlpha(sharedAlbumAccent, alpha);
    }
    return RivageUI.withAlpha(RivageUI.DEFAULT_ACCENT, alpha);
}

function currentAccentSoft() {
    return RivageUI.mix(theme.background, currentAccent(), theme.dark ? 0.20 : 0.12);
}

function rebuildFonts(clearCache) {
    var family;
    var base;
    var consoleFont;

    if (clearCache) RivageUI.clearFontCache();

    hostInfo = RivageUI.hostInfo();
    family = hostInfo.fontFamily || 'Segoe UI';
    base = Math.max(9, Math.round(Number(hostInfo.scaleFontSize) || 12));
    uiScale = clamp(base / 12, 0.75, 1.75);

    fonts.title = RivageUI.font(family, Math.max(10, Math.round(base * 1.18)), 1);
    fonts.subtitle = RivageUI.font(family, Math.max(9, Math.round(base * 0.92)), 0);
    fonts.axis = RivageUI.font(family, Math.max(9, Math.round(base * 0.86)), 0);
    fonts.small = RivageUI.font(family, Math.max(9, Math.round(base * 0.84)), 0);
    fonts.metricLabel = RivageUI.font(family, Math.max(9, Math.round(base * 0.82)), 1);
    fonts.metricValue = RivageUI.font(family, Math.max(10, Math.round(base * 1.00)), 1);

    consoleFont = RivageUI.consoleFontInfo();
    fonts.tooltip = RivageUI.font(
        consoleFont.fontFamily,
        Math.max(8, consoleFont.fontSize),
        consoleFont.fontStyle || 0
    );
}

function refreshVisualResources(clearFonts) {
    if (clearFonts || !fonts.title) rebuildFonts(clearFonts);
    hostInfo = RivageUI.hostInfo();
    theme = RivageUI.createTheme({
        host: hostInfo,
        accent: currentAccent()
    });
    painter.setTheme(theme);
    layoutPanel(); // already ends with prepareTitleMarquee() + rebuildPlotCache()
}


var layout = {
    padding: 0,
    header: RivageUI.rect(0, 0, 0, 0),
    title: RivageUI.rect(0, 0, 0, 0),
    subtitle: RivageUI.rect(0, 0, 0, 0),
    countPill: RivageUI.rect(0, 0, 0, 0),
    chart: RivageUI.rect(0, 0, 0, 0),
    plot: RivageUI.rect(0, 0, 0, 0),
    stats: RivageUI.rect(0, 0, 0, 0),
    densityTop: 0,
    densityBaseline: 0,
    rugBottom: 0
};

var titleMarquee = MarqueeWidget.create({
    speed: 38,
    pause: 1200,
    gap: 48,
    isVisible: VisiblePaintWork.isVisible,
    stopTimerWhenHidden: true,
    speedScale: function () { return uiScale; },
    onTick: function () {
        if (layout.subtitle.w > 0 && layout.subtitle.h > 0) {
            window.RepaintRect(layout.subtitle.x, layout.subtitle.y, layout.subtitle.w, layout.subtitle.h);
        }
    }
});

function titleText() {
    var text = model.title || 'Playback timeline';
    if (model.artist) text += '  \u2022  ' + model.artist;
    return text;
}

function prepareTitleMarquee() {
    if (!fonts.subtitle || layout.subtitle.w <= 0 || layout.subtitle.h <= 0) {
        titleMarquee.reset();
        return;
    }

    titleMarquee.prepare(titleText(), fonts.subtitle, layout.subtitle, {
        measureText: function (text, font) { return RivageUI.measureText(text, font, false); },
        scale: scaleUi,
        textColour: theme.textMuted,
        textY: function (imageHeight) {
            return Math.max(0, Math.round((imageHeight - scaleUi(17)) / 2) - scaleUi(1));
        },
        textRenderingHint: 4
    });
}

function layoutPanel() {
    var pad = scaleUi(12);
    var headerH = scaleUi(48);
    var gap = scaleUi(8);
    var statsH = settings.showStats && wh >= scaleUi(190) && ww >= scaleUi(360) ? scaleUi(58) : 0;
    var contentBottom = Math.max(pad, wh - pad);
    var chartTop = pad + headerH + gap;
    var chartBottom = contentBottom - (statsH > 0 ? statsH + gap : 0);
    var pillText = formatInteger(model.events.length) + (model.events.length === 1 ? ' listen' : ' listens');
    var pillW = Math.max(scaleUi(62), RivageUI.measureText(pillText, fonts.small, false) + scaleUi(18));
    var pillH = scaleUi(24);
    var headerInsetX = scaleUi(14);
    var titleLeft = pad + headerInsetX;
    var titleRight = Math.max(titleLeft, ww - pad - pillW - scaleUi(12));
    var plotInsetX = scaleUi(16);
    var plotInsetTop = scaleUi(16);
    var plotInsetBottom = scaleUi(34);

    layout.padding = pad;
    layout.header = RivageUI.rect(pad, pad, Math.max(0, ww - pad * 2), headerH);
    layout.countPill = RivageUI.rect(
        Math.max(pad + headerInsetX, ww - pad - pillW - scaleUi(8)),
        pad + Math.round((headerH - pillH) / 2),
        Math.min(pillW, Math.max(0, ww - pad * 2 - headerInsetX)),
        pillH
    );
    layout.title = RivageUI.rect(
        titleLeft,
        pad + scaleUi(3),
        Math.max(0, titleRight - titleLeft),
        scaleUi(24)
    );
    layout.subtitle = RivageUI.rect(
        titleLeft,
        pad + scaleUi(25),
        Math.max(0, titleRight - titleLeft),
        scaleUi(18)
    );
    layout.chart = RivageUI.rect(
        pad,
        chartTop,
        Math.max(0, ww - pad * 2),
        Math.max(0, chartBottom - chartTop)
    );
    layout.plot = RivageUI.rect(
        layout.chart.x + plotInsetX,
        layout.chart.y + plotInsetTop,
        Math.max(0, layout.chart.w - plotInsetX * 2),
        Math.max(0, layout.chart.h - plotInsetTop - plotInsetBottom)
    );
    layout.stats = statsH > 0
        ? RivageUI.rect(pad, chartBottom + gap, Math.max(0, ww - pad * 2), statsH)
        : RivageUI.rect(0, 0, 0, 0);

    layout.densityTop = layout.plot.y + Math.min(scaleUi(6), Math.max(0, layout.plot.h));
    layout.densityBaseline = layout.plot.y + Math.max(0, Math.min(
        layout.plot.h,
        Math.max(scaleUi(8), layout.plot.h - scaleUi(18))
    ));
    layout.rugBottom = layout.plot.y + layout.plot.h;

    prepareTitleMarquee();
    rebuildPlotCache();
}


var view = {
    fullStart: 0,
    fullEnd: 1,
    start: 0,
    end: 1
};

function dataPadding(span) {
    return Math.max(6 * ONE_HOUR, span * 0.025);
}

// layoutPanel() callers defer here to avoid rebuilding the same plot cache twice.
//
// The unzoomed default always reaches at least the current moment, even when
// every actual listen falls inside one day: otherwise a track with a tight
// listen span (a single play, or a one-day binge) would default to a
// day-scale view instead of the years-to-now context the axis is meant to show.
//
// The start bound is also snapped back to January 1st of the first listen's
// year. generateTicks()'s year scale walks forward from Jan 1 of the view's
// start year and skips that tick entirely if it falls before view.start -
// without this snap, a first listen on any day but Jan 1 would push the
// first-listen year's own label off the left edge of the axis.
function dataViewBounds(events) {
    var first;
    var last;
    var span;
    var padding;
    var firstYearStart;

    if (!events.length) return { start: 0, end: 1 };
    first = events[0].time;
    last = Math.max(events[events.length - 1].time, Date.now());
    span = Math.max(ONE_HOUR, last - first);
    padding = events.length === 1 ? 12 * ONE_HOUR : dataPadding(span);
    firstYearStart = new Date(new Date(first).getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
    return { start: Math.min(first - padding, firstYearStart), end: last + padding };
}

function resetViewToData(deferCacheRebuild) {
    var bounds = dataViewBounds(model.events);
    view.fullStart = bounds.start;
    view.fullEnd = bounds.end;
    view.start = bounds.start;
    view.end = bounds.end;
    if (!deferCacheRebuild) rebuildPlotCache();
}

function clampViewToData(deferCacheRebuild) {
    var wasZoomed = isZoomed();
    var currentSpan = Math.max(1, view.end - view.start);
    var bounds = dataViewBounds(model.events);
    var fullSpan;

    view.fullStart = bounds.start;
    view.fullEnd = bounds.end;
    fullSpan = Math.max(1, view.fullEnd - view.fullStart);

    if (!model.events.length || !wasZoomed || currentSpan >= fullSpan) {
        view.start = view.fullStart;
        view.end = view.fullEnd;
    } else {
        currentSpan = Math.min(fullSpan, currentSpan);
        if (view.start < view.fullStart) {
            view.start = view.fullStart;
            view.end = view.start + currentSpan;
        }
        if (view.end > view.fullEnd) {
            view.end = view.fullEnd;
            view.start = view.end - currentSpan;
        }
    }
    if (!deferCacheRebuild) rebuildPlotCache();
}

function currentZoomFactor() {
    var fullSpan = Math.max(1, view.fullEnd - view.fullStart);
    var visibleSpan = Math.max(1, view.end - view.start);
    return fullSpan / visibleSpan;
}

function isZoomed() {
    return currentZoomFactor() > 1.01;
}

function timeToX(time) {
    var span = Math.max(1, view.end - view.start);
    return layout.plot.x + (Number(time) - view.start) / span * layout.plot.w;
}

function xToTime(x) {
    var span = Math.max(1, view.end - view.start);
    if (layout.plot.w <= 0) return view.start;
    return view.start + clamp((x - layout.plot.x) / layout.plot.w, 0, 1) * span;
}

function zoomAt(x, wheelStep) {
    if (!model.events.length || layout.plot.w <= 0) return;

    var fullSpan = Math.max(1, view.fullEnd - view.fullStart);
    var oldSpan = Math.max(1, view.end - view.start);
    var factor = wheelStep > 0 ? 0.78 : 1.28;
    var minimumSpan = Math.min(fullSpan, Math.max(15 * ONE_MINUTE, fullSpan / 500));
    var newSpan = clamp(oldSpan * factor, minimumSpan, fullSpan);
    var anchor = xToTime(x);
    var ratio = (anchor - view.start) / oldSpan;
    var nextStart = anchor - newSpan * ratio;
    var nextEnd = nextStart + newSpan;

    if (newSpan >= fullSpan * 0.999) {
        view.start = view.fullStart;
        view.end = view.fullEnd;
    } else {
        if (nextStart < view.fullStart) {
            nextStart = view.fullStart;
            nextEnd = nextStart + newSpan;
        }
        if (nextEnd > view.fullEnd) {
            nextEnd = view.fullEnd;
            nextStart = nextEnd - newSpan;
        }
        view.start = nextStart;
        view.end = nextEnd;
    }

    rebuildPlotCache();
    updateHoverFromMouse(lastMouseX, lastMouseY);
    window.Repaint();
}

function panViewByPixels(deltaX, startViewStart, startViewEnd) {
    var span = Math.max(1, startViewEnd - startViewStart);
    var fullSpan = Math.max(1, view.fullEnd - view.fullStart);
    var deltaTime;
    var nextStart;
    var nextEnd;

    if (layout.plot.w <= 0 || span >= fullSpan) return;

    deltaTime = -deltaX / layout.plot.w * span;
    nextStart = startViewStart + deltaTime;
    nextEnd = startViewEnd + deltaTime;

    if (nextStart < view.fullStart) {
        nextStart = view.fullStart;
        nextEnd = nextStart + span;
    }
    if (nextEnd > view.fullEnd) {
        nextEnd = view.fullEnd;
        nextStart = nextEnd - span;
    }

    view.start = nextStart;
    view.end = nextEnd;
    rebuildPlotCache();
}


var plotCache = {
    firstVisible: 0,
    lastVisibleExclusive: 0,
    density: [],
    densityMax: 0,
    densityPoints: [],
    rugBuckets: [],
    ticks: []
};

var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tick labels cache native text measurement until the tick set is regenerated.
function pushTick(ticks, ms, label) {
    if (ms < view.start || ms > view.end) return;
    ticks.push({ time: ms, label: label, labelWidth: 0 });
}

function generateTicks() {
    var ticks = [];
    var span = Math.max(1, view.end - view.start);
    var days = span / ONE_DAY;
    var startDate = new Date(view.start);
    var d;
    var i;
    var step;
    var year;
    var month;

    if (days <= 2.5) {
        step = days <= 0.75 ? 3 : 6;
        d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
        if (d.getTime() < view.start) {
            i = Math.ceil((view.start - d.getTime()) / (step * ONE_HOUR));
            d = new Date(d.getTime() + i * step * ONE_HOUR);
        }
        for (i = 0; i < 80 && d.getTime() <= view.end; i++) {
            pushTick(ticks, d.getTime(),
                (d.getHours() === 0 ? MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + '  ' : '') +
                pad2(d.getHours()) + ':00');
            d = new Date(d.getTime() + step * ONE_HOUR);
        }
        return ticks;
    }

    if (days <= 55) {
        step = days <= 12 ? 1 : (days <= 26 ? 2 : 7);
        d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
        if (d.getTime() < view.start) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
        for (i = 0; i < 100 && d.getTime() <= view.end; i++) {
            if (i % step === 0) {
                pushTick(ticks, d.getTime(), MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate());
            }
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
        }
        return ticks;
    }

    if (days <= 900) {
        step = days <= 220 ? 1 : (days <= 480 ? 2 : 3);
        year = startDate.getFullYear();
        month = startDate.getMonth();
        d = new Date(year, month, 1, 0, 0, 0, 0);
        if (d.getTime() < view.start) d = new Date(year, month + 1, 1, 0, 0, 0, 0);
        for (i = 0; i < 80 && d.getTime() <= view.end; i++) {
            if (i % step === 0) {
                pushTick(ticks, d.getTime(),
                    MONTHS_SHORT[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : ''));
            }
            d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
        }
        return ticks;
    }

    step = days <= 2200 ? 1 : (days <= 5000 ? 2 : 5);
    year = startDate.getFullYear();
    d = new Date(year, 0, 1, 0, 0, 0, 0);
    if (d.getTime() < view.start) d = new Date(year + 1, 0, 1, 0, 0, 0, 0);
    for (i = 0; i < 100 && d.getTime() <= view.end; i++) {
        if (i % step === 0) pushTick(ticks, d.getTime(), String(d.getFullYear()));
        d = new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
    }
    return ticks;
}

// Ping-pongs between two buffers instead of allocating a fresh array per pass.
function smoothDensity(values, passes) {
    var length = values.length;
    var current = values.slice();
    var next;
    var swap;
    var i;
    var p;

    if (passes <= 0 || length === 0) return current;
    next = new Array(length);

    for (p = 0; p < passes; p++) {
        for (i = 0; i < length; i++) {
            next[i] = (
                (i > 0 ? current[i - 1] : current[i]) +
                current[i] * 2 +
                (i + 1 < length ? current[i + 1] : current[i])
            ) / 4;
        }
        swap = current;
        current = next;
        next = swap;
    }
    return current;
}

function rebuildPlotCache() {
    var events = model.events;
    var wantRug = rugEnabled();
    var bars = barsMode();
    var firstVisible;
    var lastVisible;
    var span;
    var binCount = 0;
    var raw = null;
    var density = [];
    var densityMax = 0;
    var rugMax = 0;
    var i;
    var bin;
    var x;
    var xKey;
    var rugMap = wantRug ? Object.create(null) : null;
    var rugBuckets = [];
    var bucket;

    plotCache = {
        firstVisible: 0,
        lastVisibleExclusive: 0,
        density: [],
        densityMax: 0,
        densityPoints: [],
        densityBars: [],
        rugBuckets: [],
        rugMaxCount: 0,
        ticks: generateTicks()
    };

    if (!events.length || layout.plot.w <= 0 || view.end <= view.start) return;

    firstVisible = lowerBoundEvents(events, view.start);
    lastVisible = lowerBoundEvents(events, view.end + 1);
    plotCache.firstVisible = firstVisible;
    plotCache.lastVisibleExclusive = lastVisible;
    if (!settings.showDensity && !wantRug) return;

    span = Math.max(1, view.end - view.start);
    if (settings.showDensity) {
        // Bars need a slot wide enough to read as a bar: roughly one column per
        // 7 design units, against the area curve's much finer 4-unit sampling.
        binCount = bars
            ? Math.max(8, Math.min(220, Math.floor(layout.plot.w / Math.max(3, scaleUi(7)))))
            : Math.max(32, Math.min(260, Math.floor(layout.plot.w / Math.max(2, scaleUi(4)))));
        raw = new Array(binCount);
        for (i = 0; i < binCount; i++) raw[i] = 0;
    }

    for (i = firstVisible; i < lastVisible; i++) {
        if (settings.showDensity) {
            bin = Math.floor((events[i].time - view.start) / span * binCount);
            bin = clamp(bin, 0, binCount - 1);
            raw[bin]++;
        }

        if (wantRug) {
            x = Math.round(timeToX(events[i].time));
            xKey = String(x);
            bucket = rugMap[xKey];
            if (!bucket) {
                bucket = { x: x, count: 0, firstIndex: i, lastIndex: i };
                rugMap[xKey] = bucket;
                rugBuckets.push(bucket);
            }
            bucket.count++;
            bucket.lastIndex = i;
            if (bucket.count > rugMax) rugMax = bucket.count;
        }
    }

    if (settings.showDensity) {
        // Smoothing is an area-curve shaping tool. Bars are a literal histogram:
        // blurring neighbouring columns there would report listens in months
        // that never had any.
        density = bars ? raw : smoothDensity(raw, settings.densitySmoothing);
        for (i = 0; i < density.length; i++) densityMax = Math.max(densityMax, density[i]);
        plotCache.density = density;
        plotCache.densityMax = densityMax;
        if (bars) plotCache.densityBars = buildDensityBars(density, densityMax);
        else plotCache.densityPoints = buildDensityPolygonPoints(density, densityMax);
    }
    if (wantRug) {
        plotCache.rugBuckets = rugBuckets;
        plotCache.rugMaxCount = rugMax;
    }
}


function paintHeader(gr) {
    var pillText = formatInteger(model.events.length) + (model.events.length === 1 ? ' listen' : ' listens');

    painter.card(gr, layout.header, {
        fill: theme.card,
        border: true,
        accent: true,
        accentColour: currentAccent()
    });

    gr.GdiDrawText(
        model.sourceLabel || historySourceLabel(), fonts.title, currentAccent(),
        layout.title.x, layout.title.y, layout.title.w, layout.title.h,
        RivageUI.textFlags.leftEllipsis
    );

    if (!titleMarquee.draw(gr, layout.subtitle)) {
        gr.GdiDrawText(
            titleText(), fonts.subtitle, theme.textMuted,
            layout.subtitle.x, layout.subtitle.y, layout.subtitle.w, layout.subtitle.h,
            RivageUI.textFlags.leftEllipsis
        );
    } else {
        titleMarquee.startTimer();
    }

    painter.pill(gr, layout.countPill, {
        fill: currentAccentSoft(),
        textColour: currentAccent(),
        border: true,
        stroke: accentWithAlpha(90),
        radius: PILL_RADIUS,
        text: pillText,
        font: fonts.small
    });
}

function paintEmptyState(gr) {
    painter.card(gr, layout.chart, {
        fill: theme.card,
        border: true,
        accent: true,
        accentEdge: 'top',
        accentColour: currentAccent()
    });

    if (layout.chart.w <= 0 || layout.chart.h <= 0) return;

    var heading = settings.historyMode === HistoryMode.LOCAL ?
        'No local listen timestamps' : 'No Last.fm listen timestamps';
    var reason = model.emptyReason || 'No listens are available.';
    var y = layout.chart.y + Math.max(scaleUi(18), Math.floor(layout.chart.h * 0.33));

    gr.GdiDrawText(
        heading, fonts.title, theme.textPrimary,
        layout.chart.x + scaleUi(18), y,
        Math.max(1, layout.chart.w - scaleUi(36)), scaleUi(30),
        RivageUI.textFlags.centeredEllipsis
    );
    gr.GdiDrawText(
        reason, fonts.subtitle, theme.textMuted,
        layout.chart.x + scaleUi(22), y + scaleUi(31),
        Math.max(1, layout.chart.w - scaleUi(44)), scaleUi(44),
        RivageUI.textFlags.wordBreakCentered
    );
}

function paintTicks(gr) {
    var ticks = plotCache.ticks;
    var i;
    var tick;
    var x;
    var labelW;
    var lastLabelRight = -100000;
    var gridColour = RivageUI.mix(theme.card, theme.stroke, 0.70);
    var labelY = layout.rugBottom + scaleUi(5);
    var gridH = Math.max(1, layout.rugBottom - layout.densityTop);

    for (i = 0; i < ticks.length; i++) {
        tick = ticks[i];
        x = Math.round(timeToX(tick.time));
        if (x < layout.plot.x || x > layout.plot.x + layout.plot.w) continue;

        gr.FillSolidRect(x, layout.densityTop, 1, gridH, gridColour);

        labelW = tick.labelWidth;
        if (!labelW) {
            labelW = RivageUI.measureText(tick.label, fonts.axis, false) + scaleUi(6);
            tick.labelWidth = labelW;
        }
        if (x - labelW / 2 > lastLabelRight + scaleUi(4)) {
            gr.GdiDrawText(
                tick.label, fonts.axis, theme.textMuted,
                Math.round(x - labelW / 2), labelY,
                labelW, scaleUi(18),
                RivageUI.textFlags.centeredEllipsis
            );
            lastLabelRight = x + labelW / 2;
        }
    }
}

function buildDensityPolygonPoints(values, maxValue) {
    var points = [];
    var baseline = layout.densityBaseline;
    var availableH = Math.max(scaleUi(8), baseline - layout.densityTop);
    var i;
    var x;
    var y;

    if (!values.length || maxValue <= 0 || layout.plot.w <= 0) return points;

    points.push(layout.plot.x, baseline);
    for (i = 0; i < values.length; i++) {
        x = layout.plot.x + i / Math.max(1, values.length - 1) * layout.plot.w;
        y = baseline - Math.sqrt(values[i] / maxValue) * availableH;
        points.push(x, y);
    }
    points.push(layout.plot.x + layout.plot.w, baseline);
    return points;
}

// Material 3 bar-chart geometry: equal slots across the plot width, a small
// gap between neighbours, and a cap radius of half the bar width. Empty bins
// are skipped entirely; a bin with any listens at all keeps a visible minimum
// height, so one play in a quiet stretch does not disappear into the axis.
function buildDensityBars(values, maxValue) {
    var bars = [];
    var baseline = layout.densityBaseline;
    var availableH = Math.max(scaleUi(8), baseline - layout.densityTop);
    var count = values.length;
    var minHeight = Math.max(1, scaleUi(2));
    var slot;
    var gap;
    var width;
    var height;
    var left;
    var i;

    if (!count || maxValue <= 0 || layout.plot.w <= 0) return bars;

    slot = layout.plot.w / count;
    gap = slot >= scaleUi(5) ? Math.max(1, scaleUi(2)) : (slot >= 3 ? 1 : 0);
    width = Math.max(1, Math.floor(slot - gap));

    for (i = 0; i < count; i++) {
        if (values[i] <= 0) continue;
        // Same square-root scale as the area curve, so switching styles keeps
        // the same relative shape rather than flattening the quiet years.
        height = Math.max(minHeight, Math.round(Math.sqrt(values[i] / maxValue) * availableH));
        left = Math.round(layout.plot.x + i * slot + (slot - width) / 2);
        bars.push({ x: left, w: width, y: baseline - height, h: height });
    }
    return bars;
}

// One-shot capability probe: a host that refuses FillRoundRect gets square
// corners for the rest of the session instead of a throw on every bar.
var roundRectSupported = true;

function fillRoundedRect(gr, x, y, w, h, radius, colour) {
    if (w <= 0 || h <= 0) return;
    radius = Math.max(0, Math.min(radius, w / 2, h / 2));
    if (radius >= 1 && roundRectSupported && typeof gr.FillRoundRect === 'function') {
        try {
            gr.FillRoundRect(x, y, w, h, radius, radius, colour);
            return;
        } catch (e) {
            roundRectSupported = false;
        }
    }
    gr.FillSolidRect(x, y, w, h, colour);
}

function paintDensityBars(gr) {
    var bars = plotCache.densityBars;
    var fill = accentWithAlpha(225);

    if (!bars.length) return;

    painter.withAntialias(gr, function () {
        var i;
        var bar;
        var radius;

        for (i = 0; i < bars.length; i++) {
            bar = bars[i];
            radius = Math.min(Math.floor(bar.w / 2), bar.h, scaleUi(4));
            fillRoundedRect(gr, bar.x, bar.y, bar.w, bar.h, radius, fill);
            // Square the bottom corners back off - the bar stands on the axis.
            if (radius >= 1 && bar.h > radius) {
                gr.FillSolidRect(bar.x, bar.y + radius, bar.w, bar.h - radius, fill);
            }
        }
    });
}

// Compatibility fallback for hosts that refuse DrawPolygon; skip baseline anchors.
function strokeDensitySegments(gr, points) {
    var colour = accentWithAlpha(190);
    var width = Math.max(1, scaleUi(1));
    var i;

    for (i = 2; i + 3 < points.length - 2; i += 2) {
        gr.DrawLine(points[i], points[i + 1], points[i + 2], points[i + 3], width, colour);
    }
}

function paintDensity(gr) {
    var points;
    var strokeFailed = false;

    if (!settings.showDensity) return;
    if (barsMode()) {
        paintDensityBars(gr);
        return;
    }
    if (plotCache.densityPoints.length < 6) return;

    points = plotCache.densityPoints;

    painter.withAntialias(gr, function () {
        try {
            gr.FillPolygon(accentWithAlpha(40), 0, points);
        } catch (e) {
            // FillPolygon is available in current JSplitter; the outline still
            // renders if an older host refuses the polygon call.
        }

        try {
            gr.DrawPolygon(accentWithAlpha(190), Math.max(1, scaleUi(1)), points);
        } catch (e2) {
            strokeFailed = true;
        }

        if (strokeFailed) strokeDensitySegments(gr, points);
    });
}

// Ticks: the original rug. One thin mark per listen position, taller and
// brighter where several listens land on the same pixel column.
function paintRugTicks(gr, top) {
    var buckets = plotCache.rugBuckets;
    var i;
    var bucket;
    var height;
    var alpha;
    var width;

    for (i = 0; i < buckets.length; i++) {
        bucket = buckets[i];
        height = scaleUi(5) + Math.min(5, bucket.count - 1) * scaleUi(2);
        height = Math.max(1, Math.min(layout.rugBottom, top + height) - top);
        alpha = Math.min(245, 130 + bucket.count * 28);
        width = Math.max(1, scaleUi(bucket.count >= 3 ? 2 : 1));
        gr.FillSolidRect(
            bucket.x - ((width - 1) >> 1),
            top,
            width,
            height,
            accentWithAlpha(alpha)
        );
    }
}

// Dots: airier than ticks at the same density, and the growing diameter reads
// repeat listens faster than a few extra pixels of tick height do.
function paintRugDots(gr, top) {
    var buckets = plotCache.rugBuckets;
    var band = Math.max(1, layout.rugBottom - top);
    var maxDiameter = Math.max(2, Math.min(scaleUi(7), band));
    var minDiameter = Math.max(2, Math.min(scaleUi(3), maxDiameter));
    var centreY = top + band / 2;

    painter.withAntialias(gr, function () {
        var i;
        var bucket;
        var diameter;

        for (i = 0; i < buckets.length; i++) {
            bucket = buckets[i];
            diameter = minDiameter +
                Math.min(4, bucket.count - 1) / 4 * (maxDiameter - minDiameter);
            gr.FillEllipse(
                bucket.x - diameter / 2,
                centreY - diameter / 2,
                diameter,
                diameter,
                accentWithAlpha(Math.min(245, 140 + bucket.count * 26))
            );
        }
    });
}

// Heat strip: one continuous ribbon whose brightness maps listens-per-column
// against the busiest column in view. This is the style for a heavily played
// track, where ticks and dots collapse into an unreadable solid block.
function paintRugHeat(gr, top) {
    var buckets = plotCache.rugBuckets;
    var band = Math.max(1, Math.min(scaleUi(8), layout.rugBottom - top));
    var maxCount = Math.max(1, plotCache.rugMaxCount);
    var radius = Math.min(band / 2, scaleUi(3));
    var i;
    var bucket;
    var width;

    // Track first, so the quiet stretches still read as part of one ribbon
    // instead of leaving the busy ones floating.
    painter.withAntialias(gr, function () {
        fillRoundedRect(
            gr, layout.plot.x, top, Math.max(1, layout.plot.w), band,
            radius, accentWithAlpha(26)
        );
    });

    for (i = 0; i < buckets.length; i++) {
        bucket = buckets[i];
        width = Math.max(1, scaleUi(1));
        gr.FillSolidRect(
            bucket.x - ((width - 1) >> 1),
            top,
            width,
            band,
            accentWithAlpha(Math.round(70 + Math.sqrt(bucket.count / maxCount) * 175))
        );
    }
}

function paintRug(gr) {
    var top = layout.densityBaseline + scaleUi(3);

    if (!rugEnabled() || !plotCache.rugBuckets.length) return;

    // Short panels can place the baseline below the rug band.
    if (top >= layout.rugBottom) return;

    if (settings.rugStyle === RugStyle.DOTS) paintRugDots(gr, top);
    else if (settings.rugStyle === RugStyle.HEAT) paintRugHeat(gr, top);
    else paintRugTicks(gr, top);
}

function paintChart(gr) {
    painter.card(gr, layout.chart, {
        fill: theme.card,
        border: true,
        accent: true,
        accentEdge: 'top',
        accentColour: currentAccent()
    });

    if (layout.plot.w <= 0 || layout.plot.h <= 0) return;

    paintTicks(gr);
    paintDensity(gr);

    // Cover the density polygon's closing baseline edge.
    gr.FillSolidRect(
        layout.plot.x,
        layout.densityBaseline,
        Math.max(1, layout.plot.w),
        1,
        theme.strokeHot
    );

    paintRug(gr);

    if (isZoomed()) {
        var zoomLabel = currentZoomFactor().toFixed(currentZoomFactor() >= 10 ? 0 : 1) + '\u00d7';
        var zoomW = RivageUI.measureText(zoomLabel, fonts.small, false) + scaleUi(16);
        painter.pill(gr, RivageUI.rect(
            layout.chart.x + layout.chart.w - zoomW - scaleUi(10),
            layout.chart.y + scaleUi(9),
            zoomW,
            scaleUi(21)
        ), {
            fill: theme.surface,
            textColour: theme.textSecondary,
            border: true,
            radius: PILL_RADIUS,
            text: zoomLabel,
            font: fonts.small
        });
    }

    if (hoveredEventIndex >= 0 && hoveredEventIndex < model.events.length) {
        var hoverEvent = model.events[hoveredEventIndex];
        var hx = Math.round(timeToX(hoverEvent.time));
        var markerY = layout.densityBaseline + scaleUi(3);
        gr.FillSolidRect(
            hx, layout.densityTop,
            1, Math.max(1, layout.rugBottom - layout.densityTop),
            accentWithAlpha(105)
        );
        gr.FillEllipse(
            hx - scaleUi(3), markerY - scaleUi(3), scaleUi(6), scaleUi(6),
            currentAccent()
        );
    }
}

function paintStats(gr) {
    if (layout.stats.w <= 0 || layout.stats.h <= 0 || !model.events.length) return;

    painter.card(gr, layout.stats, {
        fill: theme.surfaceSubtle,
        border: true,
        accent: false
    });

    var metrics = [
        { label: 'FIRST', value: formatDateOnly(model.first) },
        { label: 'LAST', value: formatDateOnly(model.last) },
        { label: 'SPAN', value: model.events.length > 1 ? formatDuration(model.span) : '\u2014' },
        { label: 'MEDIAN GAP', value: model.events.length > 1 ? formatDuration(model.medianGap) : '\u2014' }
    ];
    var count = metrics.length;
    var cellW = layout.stats.w / count;
    var i;
    var x;

    for (i = 0; i < count; i++) {
        x = layout.stats.x + i * cellW;
        if (i > 0) {
            gr.FillSolidRect(
                Math.round(x),
                layout.stats.y + scaleUi(10),
                1,
                Math.max(1, layout.stats.h - scaleUi(20)),
                theme.stroke
            );
        }
        gr.GdiDrawText(
            metrics[i].label, fonts.metricLabel, theme.textMuted,
            Math.round(x + scaleUi(8)), layout.stats.y + scaleUi(7),
            Math.max(1, Math.round(cellW - scaleUi(16))), scaleUi(18),
            RivageUI.textFlags.centeredEllipsis
        );
        gr.GdiDrawText(
            metrics[i].value, fonts.metricValue, theme.textPrimary,
            Math.round(x + scaleUi(8)), layout.stats.y + scaleUi(26),
            Math.max(1, Math.round(cellW - scaleUi(16))), scaleUi(23),
            RivageUI.textFlags.centeredEllipsis
        );
    }
}

function tooltipLinesForEvent(index) {
    var event = model.events[index];
    var lines = [];
    var previousGap;
    var nextGap;

    lines.push(formatDateTime(event.time));
    lines.push('Listen ' + formatInteger(index + 1) + ' of ' + formatInteger(model.events.length));

    if (index > 0) {
        previousGap = event.time - model.events[index - 1].time;
        lines.push('Since previous: ' + formatDuration(previousGap));
    }
    if (index + 1 < model.events.length) {
        nextGap = model.events[index + 1].time - event.time;
        lines.push('Until next: ' + formatDuration(nextGap));
    }
    return lines;
}

function paintHoverTooltip(gr) {
    if (hoveredEventIndex < 0 || hoveredEventIndex >= model.events.length || !fonts.tooltip) return;

    var lines = tooltipLinesForEvent(hoveredEventIndex);
    var i;
    var widest = 0;
    var lineHeight = scaleUi(17);
    var padX = scaleUi(9);
    var padY = scaleUi(6);
    var tooltipW;
    var tooltipH;
    var x;
    var y;

    for (i = 0; i < lines.length; i++) {
        widest = Math.max(widest, RivageUI.measureText(lines[i], fonts.tooltip, false));
    }

    tooltipW = Math.min(Math.max(scaleUi(150), widest + padX * 2), Math.max(0, ww - scaleUi(8)));
    tooltipH = Math.min(lines.length * lineHeight + padY * 2, Math.max(0, wh - scaleUi(8)));
    if (tooltipW <= 0 || tooltipH <= 0) return;
    x = lastMouseX + scaleUi(13);
    y = lastMouseY + scaleUi(13);

    if (x + tooltipW > ww - scaleUi(4)) x = lastMouseX - tooltipW - scaleUi(13);
    if (y + tooltipH > wh - scaleUi(4)) y = lastMouseY - tooltipH - scaleUi(13);
    x = clamp(x, scaleUi(4), Math.max(scaleUi(4), ww - tooltipW - scaleUi(4)));
    y = clamp(y, scaleUi(4), Math.max(scaleUi(4), wh - tooltipH - scaleUi(4)));

    painter.tooltipBox(
        gr,
        RivageUI.rect(x, y, tooltipW, tooltipH),
        lines,
        fonts.tooltip,
        {
            lineHeight: 17,
            paddingX: 9,
            paddingY: 6,
            stroke: accentWithAlpha(120)
        }
    );
}

function on_paint(gr) {
    // A collapsed splitter pane paints at 0x0. Nothing below this handles a
    // zero-area panel usefully, including deferred data rebuilds.
    if (ww <= 0 || wh <= 0) return;

    dataGate.runFromPaint();
    gr.FillSolidRect(0, 0, ww, wh, theme.background);
    paintHeader(gr);

    if (!model.events.length) paintEmptyState(gr);
    else {
        paintChart(gr);
        paintStats(gr);
    }

    paintHoverTooltip(gr);
}


var lastMouseX = -1;
var lastMouseY = -1;
var hoveredEventIndex = -1;
var dragging = false;
var dragStartX = 0;
var dragStartViewStart = 0;
var dragStartViewEnd = 1;

// Suppress duplicate host mouse-move repaints while keeping cursor-anchored tooltips live.
var lastHoverPaintX = -1;
var lastHoverPaintY = -1;

function cancelDrag() {
    if (!dragging) return;
    dragging = false;
    dragStartX = 0;
    dragStartViewStart = 0;
    dragStartViewEnd = 1;
    updateCursor();
}

function updateHoverFromMouse(x, y) {
    var previous = hoveredEventIndex;
    var index;
    var eventX;
    var threshold = scaleUi(10);

    hoveredEventIndex = -1;
    if (model.events.length && RivageUI.pointInRect(x, y, layout.plot)) {
        index = nearestVisibleEventIndex(
            model.events,
            xToTime(x),
            plotCache.firstVisible,
            plotCache.lastVisibleExclusive
        );
        if (index >= 0) {
            eventX = timeToX(model.events[index].time);
            if (Math.abs(eventX - x) <= threshold) hoveredEventIndex = index;
        }
    }

    if (hoveredEventIndex !== previous ||
        (hoveredEventIndex >= 0 && (x !== lastHoverPaintX || y !== lastHoverPaintY))) {
        lastHoverPaintX = x;
        lastHoverPaintY = y;
        window.Repaint();
    }
}

function updateCursor() {
    try {
        if (dragging) window.SetCursor(IDC_SIZEWE);
        else if (hoveredEventIndex >= 0) window.SetCursor(IDC_HAND);
        else window.SetCursor(IDC_ARROW);
    } catch (e) { }
}

function on_mouse_move(x, y) {
    lastMouseX = x;
    lastMouseY = y;

    if (dragging) {
        panViewByPixels(x - dragStartX, dragStartViewStart, dragStartViewEnd);
        hoveredEventIndex = -1;
        updateCursor();
        window.Repaint();
        return;
    }

    updateHoverFromMouse(x, y);
    updateCursor();
}

function on_mouse_leave() {
    lastMouseX = -1;
    lastMouseY = -1;
    hoveredEventIndex = -1;
    cancelDrag();
    updateCursor();
    window.Repaint();
}

function on_mouse_wheel(step) {
    if (!RivageUI.pointInRect(lastMouseX, lastMouseY, layout.chart)) return false;
    zoomAt(clamp(lastMouseX, layout.plot.x, layout.plot.x + layout.plot.w), step);
    return true;
}

function on_mouse_lbtn_down(x, y) {
    if (!isZoomed() || !RivageUI.pointInRect(x, y, layout.plot)) return;
    dragging = true;
    dragStartX = x;
    dragStartViewStart = view.start;
    dragStartViewEnd = view.end;
    updateCursor();
}

function on_mouse_lbtn_up(x, y) {
    if (!dragging) return;
    dragging = false;
    updateHoverFromMouse(x, y);
    updateCursor();
    window.Repaint();
}

function on_mouse_lbtn_dblclk(x, y) {
    if (!RivageUI.pointInRect(x, y, layout.chart)) return;
    resetViewToData();
    updateHoverFromMouse(x, y);
    window.Repaint();
}


function showContextMenu(x, y) {
    var menu = window.CreatePopupMenu();
    var result;

    menu.AppendMenuItem(MF_STRING, 402, 'Refresh');
    menu.AppendMenuItem(MF_STRING | (isZoomed() ? 0 : MF_GRAYED), 401, 'Reset zoom');

    result = menu.TrackPopupMenu(x, y);

    switch (result) {
    case 401:
        resetViewToData();
        window.Repaint();
        break;
    case 402:
        scheduleDataRefresh(false);
        break;
    }
}

function on_mouse_rbtn_up(x, y) {
    showContextMenu(x, y);
    return true;
}


function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        refreshVisualResources(false);
        window.Repaint();
    })) return;

    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;

    // This panel consumes TrackContext's global setting but does not provide
    // the global schema; tab-switcher-right.js remains the authority.
    if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (settings.accentMode === AccentMode.SHARED_ALBUM) {
            refreshVisualResources(false);
            window.Repaint();
        }
    }
}

function on_size(width, height) {
    ww = Math.max(0, Number(width) || 0);
    wh = Math.max(0, Number(height) || 0);
    layoutPanel();
}

function on_colours_changed() {
    refreshVisualResources(false);
    window.Repaint();
}

function on_font_changed() {
    refreshVisualResources(true);
    window.Repaint();
}

function on_playback_new_track() {
    if (TrackContext.followsPlayback(settings.trackContextOverride)) {
        scheduleDataRefresh(true);
    }
}

function on_playback_stop(reason) {
    if (reason === PLAYBACK_STOP_STARTING_ANOTHER_TRACK) return;

    scheduleDataRefresh(
        TrackContext.effectiveMode(settings.trackContextOverride) !== TrackContext.MODE_SELECTION
    );
}

function on_item_focus_change() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) {
        scheduleDataRefresh(true);
    }
}

function on_playlist_switch() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) {
        scheduleDataRefresh(true);
    }
}

function on_playlist_items_selection_change() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) {
        scheduleDataRefresh(true);
    }
}

function on_metadb_changed(handle_list, fromhook) {
    // Enhanced Playback Statistics can update history without changing tracks.
    // Filter mass metadata callbacks natively before queuing a JSON reparse.
    var handle;

    try {
        handle = TrackContext.getHandle(settings.trackContextOverride);
        if (handle && handle_list && typeof handle_list.Find === 'function') {
            if (handle_list.Find(handle) < 0) return;
        }
    } catch (e) {
        // Unknown list shape - fall through and refresh, as before.
    }

    scheduleDataRefresh(false);
}

function on_script_unload() {
    titleMarquee.stopTimer();
}


refreshVisualResources(true);
SharedAccentProtocol.request();
TrackContext.onChange(function () {
    scheduleDataRefresh(true);
});
TrackContext.requestSync();
scheduleDataRefresh(true);
