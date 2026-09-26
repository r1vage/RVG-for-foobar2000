window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');

window.EraseOnRepaint = false;

// Playback progress, not track length, drives both the visual log and listening totals.
// The shared '> History' playlist remains owned by tab-switcher-right.js.
// The heading mirrors bottom-panel_playcount.js through its rendered-style broadcast.

window.DefineScript(RivageUI.copy.popupTitle('Playback history'), {
    author: 'RivaGe',
    version: '6.7.0',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});

// Configuration

// Used only to make navigation from a visual log entry precise when the
// currently active playlist happens to be the suite-wide history playlist.
// This panel never creates or writes that playlist.
var PLAYLIST_NAME = '> History';
var MAX_DISPLAY_ITEMS = 200;

// A track is logged after a minute of actual listening, or, if it is shorter
// than that, once it has been heard to the end. Seeking forward adds nothing,
// so jumping to the end of a short track does not count, and an item foo_skip
// rejects at once never gets near either threshold.
var MINIMUM_CONFIRMED_PLAYBACK_SECONDS = 60;
// on_playback_time samples once a second, so a track heard in full can still
// come up short of its exact length.
var TRACK_END_SLACK_SECONDS = 2;

// on_playback_time is documented as a one-second callback. A much larger
// positive jump is treated as an unreported seek/discontinuity rather than
// listened time. Normal seeks are reset explicitly in on_playback_seek.
var MAX_CONTINUOUS_PLAYBACK_DELTA_SECONDS = 5;

var PLAYBACK_STOP = {
    INVOKED_BY_USER: 0,
    END_OF_FILE: 1,
    STARTING_ANOTHER_TRACK: 2,
    PLAYER_SHUTDOWN: 3
};

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var SMOOTHING_MODE_DEFAULT = 0;
var SMOOTHING_MODE_ANTIALIAS = 4;

// utils.MessageBox() flag values (see docs/Flags.js) - defined narrowly here
// rather than including the whole file, matching this panel's existing
// constant style above.
var MB_BUTTONS_YESNO = 4;
var MB_ICON_WARNING = 48;
var MB_RESULT_YES = 6;

var scriptActive = true;
var initialiseTimer = 0;

var PLAYBACK_STATS_HEADER_STYLE_REQUEST =
    'RIVAGE.PLAYBACK_STATS_HEADER_STYLE_REQUEST.V1';
var PLAYBACK_STATS_HEADER_STYLE_UPDATE =
    'RIVAGE.PLAYBACK_STATS_HEADER_STYLE_UPDATE.V1';

// Persisted per-panel-instance settings

var PROPERTY_PREFIX = 'Session Log';

function saveSetting(name, value) {
    window.SetProperty(PROPERTY_PREFIX + name, value);
}

var settings = {
    compactMode: !!window.GetProperty(PROPERTY_PREFIX + 'Compact mode', false),
    backgroundPanel: !!window.GetProperty(
        PROPERTY_PREFIX + 'Background panel',
        window.GetProperty(PROPERTY_PREFIX + 'RivageUI section design', true)
    ),
    showHeader: !!window.GetProperty(PROPERTY_PREFIX + 'Show header', true),
    showAccentLine: !!window.GetProperty(PROPERTY_PREFIX + 'Show accent line', true)
};

// DPI and RVG visual resources

var panelDpi = 72;

function refreshPanelDpi() {
    panelDpi = RivageScale.dpi() || 72;
}

function scale(value) {
    var numeric = Number(value);

    if (!isFinite(numeric) || numeric === 0) return 0;
    return Math.max(1, Math.round(numeric * panelDpi / 72));
}

function clampNumber(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
}

// History rows keep their responsive 9pt reference scale, clamped to 8-12pt.
var UI_BODY_FONT_PT = 8.5;
var UI_MINIMUM_FONT_PT = 6.5;
var UI_MAXIMUM_FONT_PT = 11;
var adaptiveFontScale = 1;
var HISTORY_BODY_FONT_PT = 9;
var HISTORY_MINIMUM_FONT_PT = 8;
var HISTORY_MAXIMUM_FONT_PT = 12;
var historyFontScale = 1;
var REFERENCE_WIDTH_PT = 150;
var REFERENCE_HEIGHT_PT = 80;
var fontResourceSignature = '';

function updateAdaptiveFontScale(width, height) {
    var baseW = Math.max(1, scale(REFERENCE_WIDTH_PT));
    var baseH = Math.max(1, scale(REFERENCE_HEIGHT_PT));

    adaptiveFontScale = clampNumber(
        Math.min(Number(width) / baseW, Number(height) / baseH),
        UI_MINIMUM_FONT_PT / UI_BODY_FONT_PT,
        1
    );
}

function updateHistoryFontScale(width, height) {
    var baseW = Math.max(1, scale(REFERENCE_WIDTH_PT));
    var baseH = Math.max(1, scale(REFERENCE_HEIGHT_PT));

    historyFontScale = clampNumber(
        Math.min(Number(width) / baseW, Number(height) / baseH),
        HISTORY_MINIMUM_FONT_PT / HISTORY_BODY_FONT_PT,
        HISTORY_MAXIMUM_FONT_PT / HISTORY_BODY_FONT_PT
    );
}

function fontPx(value) {
    var minPx = scale(UI_MINIMUM_FONT_PT);
    var maxPx = scale(UI_MAXIMUM_FONT_PT);
    var requested;

    if (Number(value) === 0) return 0;
    requested = Math.round(scale(value) * adaptiveFontScale);
    return Math.round(clampNumber(requested, minPx, maxPx));
}

function historyFontPx(value) {
    var minPx = scale(HISTORY_MINIMUM_FONT_PT);
    var maxPx = scale(HISTORY_MAXIMUM_FONT_PT);
    var requested;

    if (Number(value) === 0) return 0;
    requested = Math.round(scale(value) * historyFontScale);
    return Math.round(clampNumber(requested, minPx, maxPx));
}

function makeFont(name, size, style) {
    return RivageUI.font(name || 'Segoe UI', fontPx(size), style);
}

function makeHistoryFont(name, size, style) {
    return RivageUI.font(name || 'Segoe UI', historyFontPx(size), style);
}

function makePixelFont(name, pixelSize, style) {
    return RivageUI.font(
        name || 'Segoe UI',
        Math.max(1, Math.round(Number(pixelSize) || 1)),
        style
    );
}

var syncedHeaderFontFamily = '';
var syncedHeaderPixelSize = 0;
var syncedHeaderFontStyle = 1;

var sharedAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);
var hostVisualInfo = null;
var hostFontName = 'Segoe UI';
var theme = RivageUI.createTheme({ accent: sharedAccent });
var painter = RivageUI.createPainter({ scale: scale, theme: theme });

var titleFont = null;
var historyFont = null;
var timestampFont = null;
var metricLabelFont = null;
var metricValueFont = null;
var emptyFont = null;

function currentAccent() {
    return sharedAccent;
}

function refreshTheme() {
    hostVisualInfo = RivageUI.hostInfo();
    hostFontName = hostVisualInfo.fontFamily || 'Segoe UI';

    theme = RivageUI.createTheme({
        host: hostVisualInfo,
        accent: currentAccent()
    });

    painter.setTheme(theme);
}

function currentFontResourceSignature() {
    return [
        String(hostFontName || 'Segoe UI').toLowerCase(),
        panelDpi,
        Math.round(adaptiveFontScale * 10000),
        Math.round(historyFontScale * 10000),
        String(syncedHeaderFontFamily || '').toLowerCase(),
        syncedHeaderPixelSize,
        syncedHeaderFontStyle
    ].join('|');
}

function rebuildFonts(clearCache) {
    if (clearCache) RivageUI.clearFontCache();

    titleFont = syncedHeaderPixelSize > 0
        ? makePixelFont(
            syncedHeaderFontFamily || hostFontName,
            syncedHeaderPixelSize,
            syncedHeaderFontStyle
        )
        : makeFont(hostFontName, 8, 1);
    historyFont = makeHistoryFont(hostFontName, HISTORY_BODY_FONT_PT, 0);
    timestampFont = makeHistoryFont(hostFontName, 8, 0);
    metricLabelFont = makeFont(hostFontName, 7.5, 1);
    metricValueFont = makeFont(hostFontName, 9, 1);
    emptyFont = makeFont(hostFontName, UI_BODY_FONT_PT, 0);
    fontResourceSignature = titleFont && historyFont && timestampFont &&
        metricLabelFont && metricValueFont && emptyFont
        ? currentFontResourceSignature()
        : '';
    configureNativeHistoryTooltip();
}

function ensureFontsCurrent() {
    if (fontResourceSignature !== currentFontResourceSignature()) rebuildFonts(false);
}

// Panel-local setting application

function applyPanelSetting(settingId, value) {
    var propertyName;
    var nextValue = !!value;
    var needsLayout = false;

    switch (settingId) {
    case 'compactMode':
        propertyName = 'Compact mode';
        needsLayout = true;
        break;
    case 'backgroundPanel':
        propertyName = 'Background panel';
        break;
    case 'showHeader':
        propertyName = 'Show header';
        needsLayout = true;
        break;
    case 'showAccentLine':
        propertyName = 'Show accent line';
        break;
    default:
        return false;
    }

    if (settings[settingId] === nextValue) return true;
    try {
        saveSetting(propertyName, nextValue);
    } catch (e) {
        return false;
    }

    settings[settingId] = nextValue;
    if (needsLayout) {
        hoveredHistoryIndex = -1;
        pressedHistoryIndex = -1;
        setHistoryTooltip('');
        layout();
    }
    requestRepaint(true);
    return true;
}

// Playback history state

var titleFormat = fb.TitleFormat(
    '$if2(%artist%,Unknown artist) - $if2(%title%,$filename(%path%))'
);

// Title-first ordering for the compact-mode row tooltip ("[time] TITLE -
// ARTIST"), as opposed to titleFormat above which is artist-first for the
// row text itself.
var tooltipTitleArtistFormat = fb.TitleFormat(
    '$if2(%title%,$filename(%path%)) - $if2(%artist%,Unknown artist)'
);

var historyEntries = [];
var activeTrack = null;
var historyScrollRows = 0;

var LISTENING_STATS_PREFIX = 'Play Log Listening.';
var LISTENING_LEDGER_PROPERTY = LISTENING_STATS_PREFIX + 'Daily ledger';
var LISTENING_ALL_TIME_PROPERTY = LISTENING_STATS_PREFIX + 'All time seconds';
// Track boundaries and unload force a save; the periodic checkpoint limits crash loss.
var LISTENING_PERSIST_INTERVAL_MS = 60000;
var LISTENING_LEDGER_RETENTION_DAYS = 400;

var listeningLedger = Object.create(null);
var listeningAllTimeSeconds = 0;
var listeningStatsDirty = false;
var listeningStatsLoaded = false;
var lastListeningStatsAttempt = 0;

function localDateKey(date) {
    date = date || new Date();
    return String(date.getFullYear()) + '-' +
        padTwoDigits(date.getMonth() + 1) + '-' +
        padTwoDigits(date.getDate());
}

function localDateFromKey(key) {
    var parts = String(key || '').split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Retention only changes at local midnight, so pruning once per date is sufficient.
var lastLedgerPruneDayKey = '';

function pruneListeningLedgerIfDue() {
    var todayKey = localDateKey(new Date());
    if (todayKey === lastLedgerPruneDayKey) return;
    lastLedgerPruneDayKey = todayKey;
    pruneListeningLedger();
}

function pruneListeningLedger() {
    var today = new Date();
    var cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var todayKey = localDateKey(today);
    var cutoffKey;
    var key;
    var date;

    cutoff.setDate(cutoff.getDate() - (LISTENING_LEDGER_RETENTION_DAYS - 1));
    cutoffKey = localDateKey(cutoff);

    for (key in listeningLedger) {
        if (!Object.prototype.hasOwnProperty.call(listeningLedger, key)) continue;
        date = localDateFromKey(key);
        if (
            !date ||
            localDateKey(date) !== key ||
            key < cutoffKey ||
            key > todayKey ||
            !(Number(listeningLedger[key]) >= 0)
        ) {
            delete listeningLedger[key];
        }
    }
}

function loadListeningStats() {
    var raw = '';
    var parsed = null;

    try { raw = String(window.GetProperty(LISTENING_LEDGER_PROPERTY, '') || ''); } catch (e) { raw = ''; }
    if (raw) {
        try { parsed = JSON.parse(raw); } catch (e2) { parsed = null; }
    }
    if (parsed && typeof parsed === 'object') listeningLedger = parsed;
    else listeningLedger = Object.create(null);

    try { listeningAllTimeSeconds = Math.max(0, Number(window.GetProperty(LISTENING_ALL_TIME_PROPERTY, 0)) || 0); } catch (e3) { listeningAllTimeSeconds = 0; }

    pruneListeningLedger();
    lastLedgerPruneDayKey = localDateKey(new Date());
    listeningStatsLoaded = true;
    persistListeningStats(true);

}

function persistListeningStats(force) {
    var now;
    var serialized;
    var saved = true;

    if (!listeningStatsLoaded) return false;
    if (!force && !listeningStatsDirty) return true;

    now = Date.now();
    lastListeningStatsAttempt = now;
    try {
        serialized = JSON.stringify(listeningLedger);
        window.SetProperty(LISTENING_LEDGER_PROPERTY, serialized);
    } catch (e) {
        saved = false;
    }
    try {
        window.SetProperty(LISTENING_ALL_TIME_PROPERTY, listeningAllTimeSeconds);
    } catch (e2) {
        saved = false;
    }

    if (saved) {
        listeningStatsDirty = false;
    } else {
        listeningStatsDirty = true;
    }
    return saved;
}

// Clearing "Play Log Listening.*" via the panel's generic Properties dialog
// does not stick on its own: this panel keeps the ledger and all-time total
// in memory (listeningLedger / listeningAllTimeSeconds) and writes them back
// out on every track boundary, the 60s checkpoint, and unload - so a value
// deleted externally reappears within moments. This is the only reset path
// that actually clears the in-memory state, not just the stored property.
function resetListeningStats() {
    listeningLedger = Object.create(null);
    listeningAllTimeSeconds = 0;
    lastLedgerPruneDayKey = localDateKey(new Date());
    listeningStatsDirty = true;
    persistListeningStats(true);
    repaintListeningCards(false);
}

function confirmResetListeningStats() {
    var result;
    try {
        result = utils.MessageBox(
            'This clears the daily listening ledger and the all-time listened total for this panel. This cannot be undone.',
            'Reset listening stats',
            MB_BUTTONS_YESNO,
            MB_ICON_WARNING
        );
    } catch (e) {
        return;
    }
    if (result === MB_RESULT_YES) resetListeningStats();
}

function recordListeningDelta(delta) {
    var seconds = Number(delta);
    var today;

    if (!listeningStatsLoaded || !isFinite(seconds) || seconds <= 0) return;

    today = localDateKey(new Date());
    listeningLedger[today] = Math.max(0, Number(listeningLedger[today]) || 0) + seconds;
    listeningAllTimeSeconds += seconds;
    listeningStatsDirty = true;

    if (Date.now() - lastListeningStatsAttempt >= LISTENING_PERSIST_INTERVAL_MS) {
        pruneListeningLedgerIfDue();
        persistListeningStats(false);
    }

    // on_playback_time is approximately once per second. Only the visible
    // timer-card area needs refreshing; Compact mode hides it entirely.
    repaintListeningCards(false);
}

function listeningPeriodTotals() {
    var now = new Date();
    var todayKey = localDateKey(now);
    var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var weekStartKey;
    var monthStartKey;
    var key;
    var value;
    var totals = {
        day: Math.max(0, Number(listeningLedger[todayKey]) || 0),
        week: 0,
        month: 0,
        all: listeningAllTimeSeconds
    };

    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStartKey = localDateKey(weekStart);
    monthStartKey = localDateKey(monthStart);

    for (key in listeningLedger) {
        if (!Object.prototype.hasOwnProperty.call(listeningLedger, key) || key > todayKey) continue;
        value = Number(listeningLedger[key]) || 0;
        if (value <= 0) continue;
        if (key >= weekStartKey) totals.week += value;
        if (key >= monthStartKey) totals.month += value;
    }

    return totals;
}

function formatListeningTime(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    if (minutes > 0) return minutes + 'm ' + secs + 's';
    return secs + 's';
}

function padTwoDigits(value) {
    value = Math.max(0, Math.floor(Number(value) || 0));
    return value < 10 ? '0' + value : String(value);
}

function makeTimestamp(date) {
    return '[' + padTwoDigits(date.getHours()) + ':' +
        padTwoDigits(date.getMinutes()) + ']';
}

function fallbackTrackText(handle) {
    var rawPath;
    var normalisedPath;
    var separatorIndex;

    try {
        rawPath = String(handle && handle.RawPath ? handle.RawPath : '');
    } catch (e) {
        rawPath = '';
    }

    if (!rawPath) return 'Unknown track';

    normalisedPath = rawPath.replace(/\//g, '\\');
    separatorIndex = normalisedPath.lastIndexOf('\\');

    return separatorIndex >= 0
        ? normalisedPath.substring(separatorIndex + 1)
        : normalisedPath;
}

function evaluateTrackText(handle) {
    var text = '';

    if (!handle) return 'Unknown track';

    try {
        text = titleFormat.EvalWithMetadb(handle);
    } catch (e) {
        text = '';
    }

    return text || fallbackTrackText(handle);
}

function currentPlaybackPosition() {
    var position = 0;

    try {
        position = Number(fb.PlaybackTime);
    } catch (e) {
        position = 0;
    }

    return isFinite(position) && position >= 0 ? position : 0;
}

function samePlaybackItem(first, second) {
    var firstPath;
    var secondPath;
    var firstSubSong;
    var secondSubSong;

    if (!first || !second) return false;

    try {
        if (typeof first.Compare === 'function' && first.Compare(second)) {
            return true;
        }
    } catch (e) {
        // Fall back to path and subsong comparison.
    }

    try {
        firstPath = String(first.RawPath || '');
        secondPath = String(second.RawPath || '');
        firstSubSong = Number(first.SubSong) || 0;
        secondSubSong = Number(second.SubSong) || 0;
    } catch (e2) {
        return false;
    }

    return firstPath === secondPath && firstSubSong === secondSubSong;
}

function playlistGuidAt(playlistIndex) {
    if (!isFinite(playlistIndex) || playlistIndex < 0) return '';

    try {
        return String(plman.GetGUID(playlistIndex) || '');
    } catch (e) {
        return '';
    }
}

function currentPlayingPlaylistLocation() {
    var location;
    var playlistIndex;
    var playlistItemIndex;

    try {
        location = plman.GetPlayingItemLocation();
        if (!location || !location.IsValid) throw new Error('Invalid location');

        playlistIndex = Number(location.PlaylistIndex);
        playlistItemIndex = Number(location.PlaylistItemIndex);

        if (!isFinite(playlistIndex) || !isFinite(playlistItemIndex) ||
                playlistIndex < 0 || playlistItemIndex < 0) {
            throw new Error('Invalid playlist indexes');
        }

        playlistIndex = Math.floor(playlistIndex);
        playlistItemIndex = Math.floor(playlistItemIndex);

        return {
            playlistIndex: playlistIndex,
            playlistItemIndex: playlistItemIndex,
            playlistGuid: playlistGuidAt(playlistIndex)
        };
    } catch (e) {
        return {
            playlistIndex: -1,
            playlistItemIndex: -1,
            playlistGuid: ''
        };
    }
}

function requestRepaint(force) {
    if (!scriptActive) return;
    try {
        window.Repaint(!!force);
    } catch (e) { }
}

function panelIsVisible() {
    try {
        var visible = window.IsVisible;
        if (typeof visible === 'function') visible = visible.call(window);
        if (typeof visible === 'undefined' || visible === null) return true;
        return !!visible;
    } catch (e) {
        return true;
    }
}

function repaintListeningCards(force) {
    if (
        !scriptActive ||
        settings.compactMode ||
        statsRect.w <= 0 ||
        statsRect.h <= 0 ||
        !panelIsVisible()
    ) return;

    try {
        window.RepaintRect(
            statsRect.x,
            statsRect.y,
            statsRect.w,
            statsRect.h,
            !!force
        );
    } catch (e) {
        requestRepaint(force);
    }
}

// Unknown lengths (streams, some formats report 0) need the full minute.
function requiredPlaybackSeconds(handle) {
    var length = 0;
    try { length = Number(handle.Length); } catch (e) { length = 0; }
    if (!isFinite(length) || length <= 0) return MINIMUM_CONFIRMED_PLAYBACK_SECONDS;
    return Math.min(MINIMUM_CONFIRMED_PLAYBACK_SECONDS,
        Math.max(1, length - TRACK_END_SLACK_SECONDS));
}

function beginActiveTrack(handle) {
    var location;

    if (!handle) {
        activeTrack = null;
        return;
    }

    location = currentPlayingPlaylistLocation();

    activeTrack = {
        handle: handle,
        timestamp: makeTimestamp(new Date()),
        text: evaluateTrackText(handle),
        playedSeconds: 0,
        requiredSeconds: requiredPlaybackSeconds(handle),
        lastPosition: currentPlaybackPosition(),
        sourcePlaylistIndex: location.playlistIndex,
        sourcePlaylistItemIndex: location.playlistItemIndex,
        sourcePlaylistGuid: location.playlistGuid
    };
}

function observePlaybackPosition(time) {
    var position;
    var delta;

    if (!activeTrack) return;

    position = Number(time);
    if (!isFinite(position) || position < 0) return;

    delta = position - activeTrack.lastPosition;
    activeTrack.lastPosition = position;

    // Seeks are handled separately, so a positive delta here represents
    // playback progress rather than time jumped over by the user or foo_skip.
    if (delta > 0 && delta <= MAX_CONTINUOUS_PLAYBACK_DELTA_SECONDS) {
        activeTrack.playedSeconds += delta;
        recordListeningDelta(delta);
    }
}

function captureFinalPlaybackProgress(requireCurrentHandle) {
    var nowPlaying = null;

    if (!activeTrack) return;

    try {
        nowPlaying = fb.GetNowPlaying();
    } catch (e) {
        nowPlaying = null;
    }

    // During a normal track transition, only sample fb.PlaybackTime while the
    // host still reports the item being finalised. This prevents time from the
    // incoming item being assigned to a track that foo_skip just rejected.
    if (requireCurrentHandle && !samePlaybackItem(nowPlaying, activeTrack.handle)) {
        return;
    }

    if (nowPlaying && !samePlaybackItem(nowPlaying, activeTrack.handle)) return;
    observePlaybackPosition(currentPlaybackPosition());
}

function addCommittedEntry(track) {
    var priorEntryCount = historyEntries.length;

    historyEntries.unshift({
        timestamp: track.timestamp,
        text: track.text,
        handle: track.handle,
        sourcePlaylistIndex: track.sourcePlaylistIndex,
        sourcePlaylistItemIndex: track.sourcePlaylistItemIndex,
        sourcePlaylistGuid: track.sourcePlaylistGuid || ''
    });

    if (historyEntries.length > MAX_DISPLAY_ITEMS) {
        historyEntries.length = MAX_DISPLAY_ITEMS;
    }

    // A newly inserted row changes every existing row index. Cancel an
    // in-progress click so it cannot activate a different history entry.
    pressedHistoryIndex = -1;
    hoveredHistoryIndex = -1;
    historyScrollRows = 0;
    setHistoryTooltip('');
    prependHistoryRowLayout(priorEntryCount);
}

function finaliseActiveTrack(shouldRepaint) {
    var completedTrack = activeTrack;

    activeTrack = null;

    if (!completedTrack) return false;
    if (completedTrack.playedSeconds < completedTrack.requiredSeconds) {
        return false;
    }

    addCommittedEntry(completedTrack);

    if (shouldRepaint !== false) requestRepaint(false);
    return true;
}

// Navigation to the active playlist

function playlistItemAt(items, itemIndex) {
    var count;
    var handle;

    if (!items) return null;

    itemIndex = Number(itemIndex);
    if (!isFinite(itemIndex) || itemIndex < 0) return null;
    itemIndex = Math.floor(itemIndex);

    try {
        count = Number(items.Count);
        if (!isFinite(count) || itemIndex >= count) return null;

        // Current JSplitter exposes handle-list elements through the standard
        // array accessor. Item() remains a compatibility fallback only.
        handle = items[itemIndex];
        if (handle) return handle;
        if (typeof items.Item === 'function') return items.Item(itemIndex);
    } catch (e) {
        return null;
    }

    return null;
}

function activePlaylistIndex() {
    var playlistIndex;
    var playlistCount;

    try {
        playlistIndex = Number(plman.ActivePlaylist);
        playlistCount = Number(plman.PlaylistCount);
    } catch (e) {
        return -1;
    }

    if (!isFinite(playlistIndex) || playlistIndex < 0) return -1;
    if (!isFinite(playlistCount) || playlistIndex >= playlistCount) return -1;
    return playlistIndex;
}

function playlistNameAt(playlistIndex) {
    try {
        return String(plman.GetPlaylistName(playlistIndex));
    } catch (e) {
        return '';
    }
}

function preferredDuplicateReferenceIndex(playlistIndex) {
    var focusIndex = -1;
    var playingLocation;

    try {
        focusIndex = Number(plman.GetPlaylistFocusItemIndex(playlistIndex));
    } catch (e) {
        focusIndex = -1;
    }

    if (isFinite(focusIndex) && focusIndex >= 0) return focusIndex;

    playingLocation = currentPlayingPlaylistLocation();
    if (playingLocation.playlistIndex === playlistIndex) {
        return playingLocation.playlistItemIndex;
    }

    return -1;
}

function findEntryInPlaylist(entry, historyIndex, playlistIndex, items) {
    var count;
    var exactIndex;
    var referenceIndex;
    var bestIndex = -1;
    var bestDistance = Number.POSITIVE_INFINITY;
    var distance;
    var i;

    if (!entry || !entry.handle || !items) return -1;

    try {
        count = Number(items.Count);
    } catch (e) {
        count = 0;
    }

    if (!isFinite(count) || count <= 0) return -1;

    // The history playlist mirrors the panel order, so its row index is the
    // most precise duplicate match while the playlist remains unmodified.
    if (playlistNameAt(playlistIndex) === PLAYLIST_NAME) {
        exactIndex = Number(historyIndex);
        if (
            exactIndex >= 0 &&
            exactIndex < count &&
            samePlaybackItem(playlistItemAt(items, exactIndex), entry.handle)
        ) {
            return exactIndex;
        }
    }

    // Prefer the exact source position captured when the track started. A
    // playlist GUID keeps this valid if playlists are reordered; the handle is
    // checked again because items inside that playlist may also have moved.
    if (
        entry.sourcePlaylistGuid
            ? playlistGuidAt(playlistIndex) === entry.sourcePlaylistGuid
            : Number(entry.sourcePlaylistIndex) === playlistIndex
    ) {
        exactIndex = Number(entry.sourcePlaylistItemIndex);
        if (
            exactIndex >= 0 &&
            exactIndex < count &&
            samePlaybackItem(playlistItemAt(items, exactIndex), entry.handle)
        ) {
            return exactIndex;
        }
    }

    // When duplicates exist and the original position is unavailable, choose
    // the occurrence nearest to the current playlist focus or playing item.
    referenceIndex = preferredDuplicateReferenceIndex(playlistIndex);

    for (i = 0; i < count; i++) {
        if (!samePlaybackItem(playlistItemAt(items, i), entry.handle)) continue;

        if (referenceIndex < 0) return i;

        distance = Math.abs(i - referenceIndex);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
            if (distance === 0) break;
        }
    }

    return bestIndex;
}

function jumpToHistoryEntry(historyIndex) {
    var entry;
    var playlistIndex;
    var items;
    var itemIndex;

    if (historyIndex < 0 || historyIndex >= historyEntries.length) return false;

    entry = historyEntries[historyIndex];
    playlistIndex = activePlaylistIndex();
    if (playlistIndex < 0) return false;

    try {
        items = plman.GetPlaylistItems(playlistIndex);
    } catch (e) {
        items = null;
    }

    itemIndex = findEntryInPlaylist(
        entry,
        historyIndex,
        playlistIndex,
        items
    );

    if (itemIndex < 0) return false;

    try {
        plman.ClearPlaylistSelection(playlistIndex);

        if (typeof plman.SetPlaylistSelectionSingle === 'function') {
            plman.SetPlaylistSelectionSingle(playlistIndex, itemIndex, true);
        } else {
            plman.SetPlaylistSelection(playlistIndex, [itemIndex], true);
        }
    } catch (e2) {
        // Selection is optional; focusing and revealing the item still works.
    }

    try {
        plman.SetPlaylistFocusItem(playlistIndex, itemIndex);
        plman.EnsurePlaylistItemVisible(playlistIndex, itemIndex);
        return true;
    } catch (e3) {
        return false;
    }
}

// Layout

var ww = 0;
var wh = 0;
var rowHeight = 22;
var rowLineHeight = 16;
var rowVerticalPadding = 6;
var historyRowLayouts = [];
var historyRowLayoutSignature = '';
var MAX_HISTORY_TEXT_LINES = 2;
var timestampColumnWidth = 48;
var sectionRect = RivageUI.rect(0, 0, 0, 0);
var headerRect = RivageUI.rect(0, 0, 0, 0);
var statsRect = RivageUI.rect(0, 0, 0, 0);
var statCardRects = [];
var historyRect = RivageUI.rect(0, 0, 0, 0);
var hoveredHistoryIndex = -1;
var pressedHistoryIndex = -1;

var OUTER_PAD_PT = 4;
var CARD_PAD_PT = 8;
var CORNER_RADIUS_PT = 5;
var ACCENT_WIDTH_PT = 3;

function historyTextWidth() {
    var leftPadding = scale(7);
    var rightPadding = scale(9);
    var textX = settings.compactMode
        ? historyRect.x + leftPadding
        : historyRect.x + timestampColumnWidth;
    var textRight = historyRect.x + historyRect.w - rightPadding;
    return Math.max(1, textRight - textX);
}

function splitLongHistoryToken(token, maxWidth) {
    var pieces = [];
    var remaining = String(token || '');
    var lo;
    var hi;
    var mid;
    var best;

    while (remaining) {
        if (RivageUI.measureText(remaining, historyFont) <= maxWidth) {
            pieces.push(remaining);
            break;
        }

        lo = 1;
        hi = remaining.length;
        best = 1;
        while (lo <= hi) {
            mid = Math.floor((lo + hi) / 2);
            if (RivageUI.measureText(remaining.slice(0, mid), historyFont) <= maxWidth) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        pieces.push(remaining.slice(0, best));
        remaining = remaining.slice(best);
    }

    return pieces;
}

function wrapHistoryTextLines(text, maxWidth) {
    var source = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var words;
    var lines = [];
    var line = '';
    var i;
    var candidate;
    var parts;
    var p;

    if (!source) return [''];
    maxWidth = Math.max(1, Number(maxWidth) || 1);
    if (RivageUI.measureText(source, historyFont) <= maxWidth) return [source];

    words = source.split(' ');
    for (i = 0; i < words.length; i++) {
        candidate = line ? line + ' ' + words[i] : words[i];
        if (RivageUI.measureText(candidate, historyFont) <= maxWidth) {
            line = candidate;
            continue;
        }

        if (line) {
            lines.push(line);
            line = '';
        }

        if (RivageUI.measureText(words[i], historyFont) <= maxWidth) {
            line = words[i];
            continue;
        }

        parts = splitLongHistoryToken(words[i], maxWidth);
        for (p = 0; p < parts.length; p++) {
            if (p === parts.length - 1) line = parts[p];
            else lines.push(parts[p]);
        }
    }

    if (line) lines.push(line);
    return lines.length ? lines : [source];
}

function ellipsizeHistoryWrappedLine(text, maxWidth) {
    var source = String(text || '').replace(/\s+$/g, '');
    var marker = '...';
    var lo;
    var hi;
    var mid;
    var best = '';
    var candidate;

    maxWidth = Math.max(1, Number(maxWidth) || 1);

    while (marker && RivageUI.measureText(marker, historyFont) > maxWidth) {
        marker = marker.slice(0, -1);
    }
    if (!marker) return '';

    if (RivageUI.measureText(source + marker, historyFont) <= maxWidth) {
        return source + marker;
    }

    lo = 0;
    hi = source.length;
    while (lo <= hi) {
        mid = Math.floor((lo + hi) / 2);
        candidate = source.slice(0, mid).replace(/\s+$/g, '') + marker;
        if (RivageUI.measureText(candidate, historyFont) <= maxWidth) {
            best = candidate;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return best || marker;
}

function refreshHistoryRowMetrics() {
    rowLineHeight = Math.max(scale(12), historyFontPx(HISTORY_BODY_FONT_PT) + scale(3));
    rowVerticalPadding = Math.max(scale(4), scale(6));
    rowHeight = Math.max(scale(18), rowLineHeight + rowVerticalPadding);
}

function buildHistoryRowLayout(text, width) {
    var wrappedLines = wrapHistoryTextLines(text, width);
    var truncated = wrappedLines.length > MAX_HISTORY_TEXT_LINES;
    var lines = truncated ? wrappedLines.slice(0, MAX_HISTORY_TEXT_LINES) : wrappedLines;

    if (truncated && lines.length) {
        lines[lines.length - 1] = ellipsizeHistoryWrappedLine(lines[lines.length - 1], width);
    }

    return {
        lines: lines,
        truncated: truncated,
        height: Math.max(rowHeight, lines.length * rowLineHeight + rowVerticalPadding)
    };
}

// Existing row layouts remain valid until text width or font geometry changes.
function currentHistoryRowLayoutSignature() {
    var width;

    if (historyRect.w <= 0) return '';
    width = historyTextWidth();
    if (width <= 1) return '';
    return [
        width,
        rowLineHeight,
        rowVerticalPadding,
        String(hostFontName || 'Segoe UI').toLowerCase(),
        historyFontPx(HISTORY_BODY_FONT_PT)
    ].join('|');
}

function rebuildHistoryRowLayouts() {
    var width;
    var i;

    refreshHistoryRowMetrics();
    historyRowLayoutSignature = currentHistoryRowLayoutSignature();
    if (!historyRowLayoutSignature) {
        historyRowLayouts = [];
        return;
    }

    width = historyTextWidth();
    historyRowLayouts = [];
    for (i = 0; i < historyEntries.length; i++) {
        historyRowLayouts.push(buildHistoryRowLayout(historyEntries[i].text, width));
    }
}

function ensureHistoryRowLayoutsCurrent() {
    var nextSignature;

    refreshHistoryRowMetrics();
    nextSignature = currentHistoryRowLayoutSignature();
    if (
        nextSignature !== historyRowLayoutSignature ||
        historyRowLayouts.length !== historyEntries.length
    ) rebuildHistoryRowLayouts();
}

function prependHistoryRowLayout(priorEntryCount) {
    var nextSignature;

    if (!historyEntries.length) return;
    refreshHistoryRowMetrics();
    nextSignature = currentHistoryRowLayoutSignature();
    if (!nextSignature) {
        historyRowLayouts = [];
        historyRowLayoutSignature = '';
        return;
    }

    if (
        nextSignature !== historyRowLayoutSignature ||
        historyRowLayouts.length !== priorEntryCount
    ) {
        rebuildHistoryRowLayouts();
        return;
    }

    historyRowLayouts.unshift(buildHistoryRowLayout(historyEntries[0].text, historyTextWidth()));
    if (historyRowLayouts.length > MAX_DISPLAY_ITEMS) {
        historyRowLayouts.length = MAX_DISPLAY_ITEMS;
    }
}

function historyRowHeightAt(index) {
    if (index >= 0 && index < historyRowLayouts.length && historyRowLayouts[index]) {
        return Math.max(1, Number(historyRowLayouts[index].height) || rowHeight);
    }
    return Math.max(1, rowHeight);
}

function historyRowTopAt(index) {
    var y = 0;
    var i;

    for (i = historyScrollRows; i < index && i < historyEntries.length; i++) {
        y += historyRowHeightAt(i);
    }
    return y;
}

function layout() {
    var outerPad;
    var cardPad;
    var headingHeight;
    var contentBottom;
    var contentTop;
    var contentWidth;
    var cardGap;
    var items;
    var minimumWidths;
    var minimumTotal;
    var textInset;
    var columns;
    var rows;
    var desiredCellHeight;
    var cellHeight;
    var blockHeight;
    var availableHeight;
    var minHistoryHeight;
    var minFallbackWidth;
    var rowStart;
    var rowCount;
    var rowAvailable;
    var rowCellWidth;
    var historyTop;
    var i;
    var column;
    var row;
    var cellWidth;
    var valueFont;
    var x;
    var y;

    ww = Math.max(0, Number(window.Width) || 0);
    wh = Math.max(0, Number(window.Height) || 0);

    refreshPanelDpi();
    updateAdaptiveFontScale(ww, wh);
    updateHistoryFontScale(ww, wh);
    ensureFontsCurrent();

    outerPad = scale(OUTER_PAD_PT);
    cardPad = scale(CARD_PAD_PT);
    cardGap = scale(4);

    sectionRect = RivageUI.rect(
        outerPad,
        outerPad,
        Math.max(0, ww - outerPad * 2),
        Math.max(0, wh - outerPad * 2)
    );

    // Keep heading geometry aligned with bottom-panel_playcount.js.
    headingHeight = settings.showHeader
        ? Math.min(sectionRect.h, Math.max(scale(24), fontPx(10) + scale(10)))
        : scale(3);

    headerRect = settings.showHeader
        ? RivageUI.rect(
            sectionRect.x + cardPad,
            sectionRect.y + scale(2),
            Math.max(0, sectionRect.w - cardPad * 2),
            Math.max(0, headingHeight - scale(2))
        )
        : RivageUI.rect(0, 0, 0, 0);

    contentTop = sectionRect.y + headingHeight;
    contentBottom = Math.max(contentTop, sectionRect.y + sectionRect.h - scale(4));
    contentWidth = Math.max(0, sectionRect.w - cardPad * 2);

    statsRect = RivageUI.rect(0, 0, 0, 0);
    statCardRects = [];
    historyTop = contentTop;

    items = headerInfoItems();
    if (!settings.compactMode && items.length && contentWidth > 0 && contentBottom > contentTop) {
        minimumWidths = [];
        minimumTotal = 0;
        textInset = scale(8);
        minFallbackWidth = scale(82);

        for (i = 0; i < items.length; i++) {
            valueFont = metricValueFont;
            cellWidth = Math.max(
                scale(68),
                Math.ceil(RivageUI.measureText(items[i].label, metricLabelFont)) + textInset * 2,
                Math.ceil(RivageUI.measureText(items[i].value, valueFont)) + textInset * 2
            );
            minimumWidths.push(cellWidth);
            minimumTotal += cellWidth;
        }

        // Keep one bordered stats block; wrap cells only when width requires it.
        if (minimumTotal <= contentWidth) {
            columns = items.length;
        } else {
            columns = Math.max(1, Math.min(
                items.length,
                Math.floor(contentWidth / Math.max(1, minFallbackWidth))
            ));
        }
        rows = Math.max(1, Math.ceil(items.length / columns));

        desiredCellHeight = scale(52);
        cellHeight = desiredCellHeight;
        availableHeight = Math.max(0, contentBottom - contentTop);
        minHistoryHeight = scale(24);

        if (rows * cellHeight + cardGap + minHistoryHeight > availableHeight) {
            cellHeight = Math.max(
                scale(26),
                Math.floor((Math.max(0, availableHeight - cardGap - minHistoryHeight)) / rows)
            );
        }

        blockHeight = Math.max(0, Math.min(rows * cellHeight, availableHeight));
        statsRect = RivageUI.rect(
            sectionRect.x + cardPad,
            contentTop,
            contentWidth,
            blockHeight
        );

        for (row = 0; row < rows; row++) {
            rowStart = row * columns;
            rowCount = Math.min(columns, items.length - rowStart);
            if (rowCount <= 0) break;

            rowAvailable = statsRect.w;
            rowCellWidth = Math.floor(rowAvailable / rowCount);
            x = statsRect.x;
            y = statsRect.y + row * cellHeight;

            for (column = 0; column < rowCount; column++) {
                i = rowStart + column;
                cellWidth = column === rowCount - 1
                    ? Math.max(0, statsRect.x + statsRect.w - x)
                    : Math.max(0, rowCellWidth);

                statCardRects.push(RivageUI.rect(
                    x,
                    y,
                    cellWidth,
                    Math.max(0, Math.min(cellHeight, statsRect.y + statsRect.h - y))
                ));
                x += cellWidth;
            }
        }

        historyTop = statsRect.y + statsRect.h + cardGap;
    }

    historyRect = RivageUI.rect(
        sectionRect.x + cardPad,
        historyTop,
        contentWidth,
        Math.max(0, contentBottom - historyTop)
    );

    timestampColumnWidth = Math.max(
        scale(44),
        RivageUI.measureText('[00:00]', timestampFont) + scale(10)
    );

    ensureHistoryRowLayoutsCurrent();
    historyScrollRows = Math.max(0, Math.min(maxHistoryScrollRows(), historyScrollRows));
    if (hoveredHistoryIndex < historyScrollRows || hoveredHistoryIndex >= historyScrollRows + visibleHistoryCount()) hoveredHistoryIndex = -1;
    if (pressedHistoryIndex < historyScrollRows || pressedHistoryIndex >= historyScrollRows + visibleHistoryCount()) pressedHistoryIndex = -1;
}

function maxHistoryScrollRows() {
    var used = 0;
    var i;
    var height;

    if (!historyEntries.length || historyRect.h <= 0) return 0;

    for (i = historyEntries.length - 1; i >= 0; i--) {
        height = historyRowHeightAt(i);
        if (used > 0 && used + height > historyRect.h) {
            return Math.min(historyEntries.length - 1, i + 1);
        }
        used += height;
        if (used >= historyRect.h) return i;
    }

    return 0;
}

function visibleHistoryCount() {
    var used = 0;
    var count = 0;
    var i;

    if (!historyEntries.length || historyRect.h <= 0) return 0;

    for (i = historyScrollRows; i < historyEntries.length && used < historyRect.h; i++) {
        used += historyRowHeightAt(i);
        count++;
    }

    return count;
}

function historyIndexAt(x, y) {
    var i;
    var top = historyRect.y;
    var height;

    if (!RivageUI.pointInRect(x, y, historyRect)) return -1;

    for (i = historyScrollRows; i < historyEntries.length && top < historyRect.y + historyRect.h; i++) {
        height = historyRowHeightAt(i);
        if (y >= top && y < top + height) return i;
        top += height;
    }

    return -1;
}

function repaintHistoryRow(index, force) {
    var y;
    var height;
    var visibleHeight;

    if (index < historyScrollRows || index >= historyScrollRows + visibleHistoryCount()) return;

    y = historyRect.y + historyRowTopAt(index);
    height = historyRowHeightAt(index);
    visibleHeight = Math.max(0, Math.min(height, historyRect.y + historyRect.h - y));
    if (visibleHeight <= 0) return;

    try {
        window.RepaintRect(
            historyRect.x,
            y,
            historyRect.w,
            visibleHeight,
            !!force
        );
    } catch (e) {
        requestRepaint(force);
    }
}

function repaintHoveredRow(index, force) {
    repaintHistoryRow(index, force);
}

// Painting

function paintPanelBackground(gr) {
    var radius;
    var accentY;
    var accentHeight;

    if (sectionRect.w <= 0 || sectionRect.h <= 0) return;

    radius = Math.max(
        0,
        Math.min(
            scale(CORNER_RADIUS_PT),
            sectionRect.w / 2,
            sectionRect.h / 2
        )
    );

    if (settings.backgroundPanel) {
        gr.FillRoundRect(
            sectionRect.x,
            sectionRect.y,
            sectionRect.w,
            sectionRect.h,
            radius,
            radius,
            theme.card
        );
        gr.DrawRoundRect(
            sectionRect.x,
            sectionRect.y,
            Math.max(1, sectionRect.w - 1),
            Math.max(1, sectionRect.h - 1),
            radius,
            radius,
            1,
            theme.stroke
        );
    }

    accentY = sectionRect.y + scale(7);
    accentHeight = Math.max(0, sectionRect.h - scale(14));
    if (settings.showAccentLine && accentHeight > 0) {
        gr.FillSolidRect(
            sectionRect.x,
            accentY,
            scale(ACCENT_WIDTH_PT),
            accentHeight,
            currentAccent()
        );
    }
}

function paintHeader(gr) {
    var items = headerInfoItems();
    var dividerInset;
    var i;
    var rect;
    var labelY;
    var labelH;
    var valueY;
    var valueH;

    // The title mirrors bottom-panel_playcount.js's standalone accent heading.
    if (settings.showHeader && headerRect.w > 0 && headerRect.h > 0) {
        gr.GdiDrawText(
            'PLAYBACK LOG',
            titleFont,
            currentAccent(),
            headerRect.x,
            headerRect.y,
            headerRect.w,
            headerRect.h,
            RivageUI.textFlags.leftCenteredEllipsis
        );
    }

    if (settings.compactMode || !items.length || statsRect.w <= 0 || statsRect.h <= 0 || !statCardRects.length) return;

    // Listening totals share one bordered surface with internal dividers.
    painter.card(gr, statsRect, {
        fill: theme.surfaceSubtle,
        border: true,
        accent: false
    });

    for (i = 0; i < items.length && i < statCardRects.length; i++) {
        rect = statCardRects[i];
        if (!rect || rect.w <= 0 || rect.h <= 0) continue;

        dividerInset = Math.min(scale(10), Math.max(0, Math.floor(rect.h / 3)));

        if (rect.y > statsRect.y && rect.x === statsRect.x) {
            gr.FillSolidRect(
                statsRect.x + scale(10),
                rect.y,
                Math.max(1, statsRect.w - scale(20)),
                1,
                theme.stroke
            );
        }

        if (rect.x > statsRect.x) {
            gr.FillSolidRect(
                rect.x,
                rect.y + dividerInset,
                1,
                Math.max(1, rect.h - dividerInset * 2),
                theme.stroke
            );
        }

        labelY = rect.y + scale(5);
        labelH = Math.max(0, Math.min(scale(17), rect.h - scale(18)));
        valueY = rect.y + Math.min(scale(23), Math.max(scale(13), Math.floor(rect.h * 0.44)));
        valueH = Math.max(0, rect.y + rect.h - valueY - scale(3));

        gr.GdiDrawText(
            items[i].label,
            metricLabelFont,
            theme.textMuted,
            rect.x + scale(7),
            labelY,
            Math.max(0, rect.w - scale(14)),
            labelH,
            RivageUI.textFlags.centeredEllipsis
        );

        gr.GdiDrawText(
            items[i].value,
            metricValueFont,
            theme.textPrimary,
            rect.x + scale(7),
            valueY,
            Math.max(0, rect.w - scale(14)),
            valueH,
            RivageUI.textFlags.centeredEllipsis
        );
    }
}

function paintHistoryRows(gr) {
    var count = visibleHistoryCount();
    var accent = currentAccent();
    var leftPadding = scale(7);
    var rightPadding = scale(9);
    var indicatorWidth = scale(2);
    var compact = settings.compactMode;
    var historyBottom = historyRect.y + historyRect.h;
    var i;
    var entryIndex;
    var entry;
    var y = historyRect.y;
    var height;
    var visibleHeight;
    var baseBackground;
    var background;
    var rowVisual;
    var rowTextX;
    var rowTextWidth;
    var timestampColour;
    var textColour;
    var layoutInfo;
    var lines;
    var textY;
    var lineY;
    var lineHeight;
    var lineIndex;

    for (i = 0; i < count && y < historyBottom; i++) {
        entryIndex = historyScrollRows + i;
        entry = historyEntries[entryIndex];
        height = historyRowHeightAt(entryIndex);
        visibleHeight = Math.max(0, Math.min(height, historyBottom - y));
        if (visibleHeight <= 0) break;

        baseBackground = settings.backgroundPanel ? theme.card : theme.background;
        rowVisual = RivageUI.selectorVisual(
            theme,
            {
                selected: entryIndex === 0,
                hovered: entryIndex === hoveredHistoryIndex,
                pressed: entryIndex === pressedHistoryIndex
            },
            {
                base: baseBackground,
                accent: accent,
                textPrimary: theme.textPrimary,
                textSecondary: theme.textSecondary,
                textMuted: theme.textSecondary
            }
        );
        background = rowVisual.fill;

        if (background !== theme.background) {
            gr.FillSolidRect(historyRect.x, y, historyRect.w, visibleHeight, background);
        }

        if (!compact && entryIndex === 0) {
            gr.FillSolidRect(historyRect.x, y, indicatorWidth, visibleHeight, accent);
        }

        textColour = entryIndex === 0 ||
            entryIndex === hoveredHistoryIndex ||
            entryIndex === pressedHistoryIndex
            ? theme.textPrimary
            : theme.textSecondary;

        if (compact) {
            rowTextX = historyRect.x + leftPadding;
        } else {
            timestampColour = entryIndex === 0
                ? theme.accentMuted
                : (entryIndex === hoveredHistoryIndex || entryIndex === pressedHistoryIndex
                    ? theme.textSecondary
                    : theme.textTertiary);

            gr.GdiDrawText(
                entry.timestamp,
                timestampFont,
                timestampColour,
                historyRect.x + leftPadding + (entryIndex === 0 ? indicatorWidth : 0),
                y,
                Math.max(0, timestampColumnWidth - leftPadding),
                visibleHeight,
                RivageUI.textFlags.leftCenteredEllipsis
            );

            rowTextX = historyRect.x + timestampColumnWidth;
        }

        rowTextWidth = Math.max(0, historyRect.x + historyRect.w - rightPadding - rowTextX);
        layoutInfo = historyRowLayouts[entryIndex] || { lines: [entry.text] };
        lines = layoutInfo.lines || [entry.text];
        textY = y + Math.floor(rowVerticalPadding / 2);

        for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            lineY = textY + lineIndex * rowLineHeight;
            if (lineY >= historyBottom) break;
            lineHeight = Math.max(0, Math.min(rowLineHeight, historyBottom - lineY));
            if (lineHeight <= 0) break;

            gr.GdiDrawText(
                lines[lineIndex],
                historyFont,
                textColour,
                rowTextX,
                lineY,
                rowTextWidth,
                lineHeight,
                RivageUI.textFlags.left
            );
        }

        if (y + height < historyBottom) {
            gr.FillSolidRect(historyRect.x, y + height - 1, historyRect.w, 1, theme.stroke);
        }

        y += height;
    }

    paintHistoryScrollbar(gr);
}

function historyPixelOffsetForIndex(index) {
    var total = 0;
    var i;

    index = Math.max(0, Math.min(historyEntries.length, Number(index) || 0));
    for (i = 0; i < index; i++) total += historyRowHeightAt(i);
    return total;
}

function historyTotalPixelHeight() {
    return historyPixelOffsetForIndex(historyEntries.length);
}

function paintHistoryScrollbar(gr) {
    var maxScroll = maxHistoryScrollRows();
    var totalHeight = historyTotalPixelHeight();
    var currentOffset;
    var maxOffset;
    var trackWidth;
    var trackX;
    var thumbHeight;
    var thumbY;

    if (maxScroll <= 0 || totalHeight <= historyRect.h || historyRect.h <= 0) return;

    currentOffset = historyPixelOffsetForIndex(historyScrollRows);
    maxOffset = Math.max(1, historyPixelOffsetForIndex(maxScroll));
    trackWidth = Math.max(1, scale(2));
    trackX = historyRect.x + historyRect.w - trackWidth;
    thumbHeight = Math.max(scale(12), Math.floor(historyRect.h * historyRect.h / totalHeight));
    thumbHeight = Math.min(historyRect.h, thumbHeight);
    thumbY = historyRect.y + Math.round(
        (historyRect.h - thumbHeight) * currentOffset / maxOffset
    );

    gr.FillSolidRect(trackX, historyRect.y, trackWidth, historyRect.h, theme.scrollTrack);
    gr.FillSolidRect(trackX, thumbY, trackWidth, thumbHeight, theme.accentMuted);
}

// Native tooltip can extend outside the panel and reveal text hidden by truncation.
var TOOLTIP_DELAY_MS = 500;
var TOOLTIP_MAX_WIDTH_PT = 640;
var tooltipTimer = null;
var tooltipText = '';
var tooltipPendingText = '';
var nativeHistoryTooltip = null;

function configureNativeHistoryTooltip() {
    try {
        nativeHistoryTooltip = window.Tooltip;
    } catch (e) {
        nativeHistoryTooltip = null;
    }

    if (!nativeHistoryTooltip) return;
    try { nativeHistoryTooltip.SetFont(hostFontName, historyFontPx(HISTORY_BODY_FONT_PT), 0); } catch (e2) { }
    try { nativeHistoryTooltip.SetMaxWidth(scale(TOOLTIP_MAX_WIDTH_PT)); } catch (e3) { }
}

function cancelHistoryTooltipTimer() {
    if (tooltipTimer !== null) {
        try { window.ClearTimeout(tooltipTimer); } catch (e) { }
        tooltipTimer = null;
    }
    tooltipPendingText = '';
}

function deactivateNativeHistoryTooltip() {
    if (!nativeHistoryTooltip) return;
    try { nativeHistoryTooltip.Deactivate(); } catch (e) { }
    try { nativeHistoryTooltip.Text = ''; } catch (e2) { }
}

function historyTooltipDisplayText(text) {
    return wrapHistoryTextLines(text, scale(TOOLTIP_MAX_WIDTH_PT)).join('\n');
}

function setHistoryTooltip(text) {
    text = String(text || '');

    if (!text) {
        cancelHistoryTooltipTimer();
        if (tooltipText) deactivateNativeHistoryTooltip();
        tooltipText = '';
        return;
    }

    if (text === tooltipText || text === tooltipPendingText) return;

    cancelHistoryTooltipTimer();
    if (tooltipText) deactivateNativeHistoryTooltip();
    tooltipText = '';
    tooltipPendingText = text;

    tooltipTimer = window.SetTimeout(function () {
        var displayText;
        tooltipTimer = null;
        if (tooltipPendingText !== text) return;
        tooltipPendingText = '';
        configureNativeHistoryTooltip();
        if (!nativeHistoryTooltip) return;

        displayText = historyTooltipDisplayText(text);
        try {
            nativeHistoryTooltip.Text = displayText;
            nativeHistoryTooltip.Activate();
            tooltipText = text;
        } catch (e) {
            tooltipText = '';
        }
    }, TOOLTIP_DELAY_MS);
}

// "[time] TITLE - ARTIST" for the native row tooltip. Falls back to the
// artist-first row text if the handle can no longer be evaluated.
function historyTooltipText(entry) {
    var titleArtist = '';

    try {
        if (entry.handle) titleArtist = tooltipTitleArtistFormat.EvalWithMetadb(entry.handle);
    } catch (e) {
        titleArtist = '';
    }
    if (!titleArtist) titleArtist = entry.text || '';

    return entry.timestamp + ' ' + titleArtist;
}

function historyRowTooltipText(index) {
    var entry;
    var layoutInfo;
    var top;

    if (index < 0 || index >= historyEntries.length) return '';
    entry = historyEntries[index];
    layoutInfo = historyRowLayouts[index];
    if (!entry || !layoutInfo) return '';

    // Compact rows deliberately hide the timestamp, so keep the existing
    // hover affordance while moving it to the native Windows tooltip.
    if (settings.compactMode) return historyTooltipText(entry);

    top = historyRowTopAt(index);
    if (
        layoutInfo.truncated ||
        layoutInfo.lines.length > 1 ||
        top + layoutInfo.height > historyRect.h
    ) {
        return historyTooltipText(entry);
    }

    return '';
}

function paintEmptyState(gr) {
    if (historyRect.w <= 0 || historyRect.h <= 0) return;

    gr.GdiDrawText(
        'No completed tracks in this session',
        emptyFont,
        theme.textMuted,
        historyRect.x + scale(8),
        historyRect.y,
        Math.max(0, historyRect.w - scale(16)),
        historyRect.h,
        RivageUI.textFlags.centeredEllipsis
    );
}

function listeningCards() {
    var totals = listeningPeriodTotals();
    return [
        { label: 'TODAY', value: formatListeningTime(totals.day) },
        { label: 'THIS WEEK', value: formatListeningTime(totals.week) },
        { label: 'THIS MONTH', value: formatListeningTime(totals.month) },
        { label: 'ALL TIME', value: formatListeningTime(totals.all) }
    ];
}

function headerInfoItems() {
    return settings.compactMode ? [] : listeningCards();
}

function on_paint(gr) {
    var smoothingChanged = false;

    // Rectangular backdrop before anti-aliasing: GDI+ shape smoothing filters the
    // DrawImage destination edge into a visible seam on the left and top rows.
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);

    if (typeof gr.SetSmoothingMode === 'function') {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    paintPanelBackground(gr);
    paintHeader(gr);

    if (historyEntries.length) paintHistoryRows(gr);
    else paintEmptyState(gr);

    if (smoothingChanged) {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
        } catch (e2) {
            // Ignore graphics-state restoration failures.
        }
    }
}

// Mouse interaction


var MENU_ID = {
    compactMode: 1,
    backgroundWith: 2,
    configure: 4,
    showHeader: 5,
    showAccentLine: 6,
    resetStats: 7
};

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

function historyEntryHandles(historyIndex) {
    var entry = historyIndex >= 0 ? historyEntries[historyIndex] : null;
    return entry && entry.handle ? new FbMetadbHandleList([entry.handle]) : null;
}

function on_mouse_mbtn_up(x, y) {
    var handles = historyEntryHandles(historyIndexAt(x, y));
    if (handles) RivageLibraryActions.queue(handles);
}

function on_mouse_rbtn_up(x, y) {
    var menu = window.CreatePopupMenu();
    var handles = historyEntryHandles(historyIndexAt(x, y));
    var libraryState = null;
    var id;

    if (handles) {
        libraryState = RivageLibraryActions.appendHandles(menu, handles, { separator: false, label: 'track' });
        menu.AppendMenuSeparator();
    }
    menu.AppendMenuItem(MF_STRING, MENU_ID.compactMode, 'Use compact layout');
    menu.CheckMenuItem(MENU_ID.compactMode, settings.compactMode);

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.showHeader, 'Show header');
    menu.CheckMenuItem(MENU_ID.showHeader, settings.showHeader);
    menu.AppendMenuItem(MF_STRING, MENU_ID.showAccentLine, 'Show accent underline');
    menu.CheckMenuItem(MENU_ID.showAccentLine, settings.showAccentLine);

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.backgroundWith, 'Show card background and border');
    menu.CheckMenuItem(MENU_ID.backgroundWith, settings.backgroundPanel);

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.resetStats, 'Reset listening stats...');

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, MENU_ID.configure, RivageUI.copy.labels.panelConfiguration);

    id = menu.TrackPopupMenu(x, y);
    if (RivageLibraryActions.handle(libraryState, id)) return true;

    switch (id) {
    case MENU_ID.compactMode:
        applyPanelSetting('compactMode', !settings.compactMode);
        break;
    case MENU_ID.backgroundWith:
        applyPanelSetting('backgroundPanel', !settings.backgroundPanel);
        break;
    case MENU_ID.showHeader:
        applyPanelSetting('showHeader', !settings.showHeader);
        break;
    case MENU_ID.showAccentLine:
        applyPanelSetting('showAccentLine', !settings.showAccentLine);
        break;
    case MENU_ID.resetStats:
        confirmResetListeningStats();
        break;
    case MENU_ID.configure:
        showConfigure();
        break;
    }

    return true;
}

function setHistoryCursor(historyIndex) {
    try {
        window.SetCursor(historyIndex >= 0 ? IDC_HAND : IDC_ARROW);
    } catch (e) {
        // Cursor changes are cosmetic only.
    }
}

function on_mouse_move(x, y) {
    var nextIndex = historyIndexAt(x, y);
    var previousIndex = hoveredHistoryIndex;

    setHistoryCursor(nextIndex);
    setHistoryTooltip(historyRowTooltipText(nextIndex));

    if (nextIndex === previousIndex) return;
    hoveredHistoryIndex = nextIndex;
    repaintHoveredRow(previousIndex, false);
    repaintHoveredRow(nextIndex, false);
}

function on_mouse_leave() {
    var previousHover = hoveredHistoryIndex;
    var previousPressed = pressedHistoryIndex;

    hoveredHistoryIndex = -1;
    pressedHistoryIndex = -1;
    setHistoryCursor(-1);
    setHistoryTooltip('');

    repaintHoveredRow(previousHover, false);
    if (previousPressed !== previousHover) {
        repaintHoveredRow(previousPressed, false);
    }
}

function on_mouse_lbtn_down(x, y) {
    var nextIndex = historyIndexAt(x, y);
    var previousPressed = pressedHistoryIndex;
    var previousHover = hoveredHistoryIndex;

    pressedHistoryIndex = nextIndex;
    hoveredHistoryIndex = nextIndex;
    setHistoryCursor(nextIndex);
    setHistoryTooltip(historyRowTooltipText(nextIndex));

    repaintHoveredRow(previousPressed, false);
    if (previousHover !== previousPressed) {
        repaintHoveredRow(previousHover, false);
    }
    repaintHoveredRow(nextIndex, false);

    return nextIndex >= 0;
}

function on_mouse_lbtn_up(x, y) {
    var releasedIndex = historyIndexAt(x, y);
    var clickedIndex = pressedHistoryIndex;
    var previousHover = hoveredHistoryIndex;
    var activate = clickedIndex >= 0 && releasedIndex === clickedIndex;
    var jumped = false;

    pressedHistoryIndex = -1;
    hoveredHistoryIndex = releasedIndex;
    setHistoryCursor(releasedIndex);
    setHistoryTooltip(historyRowTooltipText(releasedIndex));

    repaintHoveredRow(clickedIndex, false);
    if (previousHover !== clickedIndex && previousHover !== releasedIndex) {
        repaintHoveredRow(previousHover, false);
    }
    repaintHoveredRow(releasedIndex, false);

    if (activate) jumped = jumpToHistoryEntry(clickedIndex);
    return jumped;
}

function on_mouse_wheel(step) {
    var previous = historyScrollRows;
    var delta = Math.round(Number(step) || 0);

    if (!delta || maxHistoryScrollRows() <= 0) return false;

    historyScrollRows = Math.max(
        0,
        Math.min(maxHistoryScrollRows(), historyScrollRows - delta * 3)
    );

    if (historyScrollRows === previous) return false;

    hoveredHistoryIndex = -1;
    pressedHistoryIndex = -1;
    setHistoryCursor(-1);
    setHistoryTooltip('');
    requestRepaint(false);
    return true;
}

// Playback callbacks

function on_playback_new_track(handle) {
    // The previous entry is committed here after its playback item has ended.
    // An immediate foo_skip transition has too little observed progress and is
    // discarded by finaliseActiveTrack().
    finaliseActiveTrack(true);
    // STARTING_ANOTHER_TRACK skips the stop checkpoint, so save at this boundary.
    persistListeningStats(false);
    beginActiveTrack(handle);
}

function on_playback_time(time) {
    // No repaint and no playlist write occur here.
    observePlaybackPosition(time);
}

function on_playback_seek(time) {
    if (!activeTrack) return;

    time = Number(time);
    if (isFinite(time) && time >= 0) activeTrack.lastPosition = time;
}

function on_playback_stop(reason) {
    reason = Number(reason);

    // Capture the fraction since the last one-second callback when the host
    // still identifies the item being finalised.
    captureFinalPlaybackProgress(
        reason === PLAYBACK_STOP.STARTING_ANOTHER_TRACK
    );

    // A following on_playback_new_track callback owns transition finalisation.
    if (reason === PLAYBACK_STOP.STARTING_ANOTHER_TRACK) return;

    // Preserve the existing finalisation path during application shutdown,
    // but avoid requesting a repaint while the panel is going away.
    finaliseActiveTrack(reason !== PLAYBACK_STOP.PLAYER_SHUTDOWN);
    persistListeningStats(true);
}

// Host and shared-accent callbacks

function on_size(width, height) {
    // JSplitter repaints after a resize; do not request another repaint here.
    layout();
    setHistoryTooltip('');
}

function on_font_changed() {
    refreshPanelDpi();
    refreshTheme();
    RivageUI.clearFontCache();
    fontResourceSignature = '';
    layout();
    setHistoryTooltip('');
    requestPlaybackStatisticsHeaderStyle();
    requestRepaint(true);
}

function on_colours_changed() {
    refreshTheme();
    SharedThemeProtocol.requestRepaint();
}

function requestPlaybackStatisticsHeaderStyle() {
    try {
        window.NotifyOthers(PLAYBACK_STATS_HEADER_STYLE_REQUEST, 0);
    } catch (e) {
        // Playback Statistics may not be loaded; the fallback remains valid.
    }
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        on_colours_changed();
    })) return;

    var nextAccent;
    var nextFamily;
    var nextPixelSize;
    var nextStyle;

    if (name === PLAYBACK_STATS_HEADER_STYLE_UPDATE && info) {
        nextFamily = String(info.family || hostFontName || 'Segoe UI');
        nextPixelSize = Math.max(1, Math.round(Number(info.pixelSize) || 0));
        nextStyle = Number(info.style) === 0 ? 0 : 1;

        // Match bottom-panel_playcount.js's heading exactly; only the heading
        // consumes the external pixel size. The rest of Play Log keeps its
        // normalized local typography.
        if (nextPixelSize > 0 && (
            nextFamily !== syncedHeaderFontFamily ||
            nextPixelSize !== syncedHeaderPixelSize ||
            nextStyle !== syncedHeaderFontStyle
        )) {
            syncedHeaderFontFamily = nextFamily;
            syncedHeaderPixelSize = nextPixelSize;
            syncedHeaderFontStyle = nextStyle;
            layout();
            setHistoryTooltip('');
            requestRepaint(true);
        }
        return;
    }

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAccent) return;

        sharedAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        refreshTheme();
        requestRepaint(false);
    }
}

function on_script_unload() {
    scriptActive = false;
    if (initialiseTimer) {
        try { window.ClearTimeout(initialiseTimer); } catch (e) { }
        initialiseTimer = 0;
    }
    cancelHistoryTooltipTimer();
    deactivateNativeHistoryTooltip();
    captureFinalPlaybackProgress(true);
    persistListeningStats(true);
    activeTrack = null;
}

function initialise() {
    var nowPlaying = null;

    initialiseTimer = 0;
    if (!scriptActive) return;
    if (!listeningStatsLoaded) loadListeningStats();

    try {
        nowPlaying = fb.GetNowPlaying();
    } catch (e) {
        nowPlaying = null;
    }

    if (!activeTrack && nowPlaying) beginActiveTrack(nowPlaying);

    SharedAccentProtocol.request();
    requestPlaybackStatisticsHeaderStyle();
    layout();
    requestRepaint(true);
}

loadListeningStats();
refreshPanelDpi();
refreshTheme();
RivageUI.clearFontCache();
fontResourceSignature = '';
layout();
initialiseTimer = window.SetTimeout(initialise, 0);
