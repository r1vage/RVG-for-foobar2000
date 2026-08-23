window.DrawMode = 0; // Force GDI+ before creating fonts or other drawing objects.

window.DefineScript('RVG Bottom Tabs', {
    author: 'RivaGe',
    version: '4.5.0'
});

// Narrow failure reporting. Most empty catches in this file guard timer
// clears and optional host-API probes that are *expected* to fail and stay
// silent on purpose. This is for the few that mean something is actually
// broken and would otherwise leave no trace. Repeats are counted and
// re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Bottom Tabs] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// Persistent authority for shared artwork theme/accent, global settings and `> History`.
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\material_colour.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_engine.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\resizing_mode_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\miniplayer_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\lastfm_credentials_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\tab_bar_style.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\panel_host_kit.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\playback_stats_source.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');

// Native PanelObject wrappers remain callback-local because child collection rebuilds invalidate them.

var DT_CENTER       = 0x00000001;
var DT_VCENTER      = 0x00000004;
var DT_WORDBREAK    = 0x00000010;
var DT_SINGLELINE   = 0x00000020;
var DT_NOPREFIX     = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;
var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;

var MF_STRING = 0x00000000;

var IDC_ARROW = 32512;
var IDC_HAND  = 32649;

var PROPERTY_PREFIX         = 'RIVAGE.BOTTOM_TABS.';
// Caption key survives reordering; the legacy index remains the migration fallback.
var PROPERTY_ACTIVE_TAB     = PROPERTY_PREFIX + 'Active tab';
var PROPERTY_ACTIVE_KEY     = PROPERTY_PREFIX + 'Active key';
var PROPERTY_TAB_ID_OWNERS   = PROPERTY_PREFIX + 'Caption IDs';
// Legacy boolean is read only until the newer mode property exists.
var PROPERTY_GLOBAL_ACCENT  = PROPERTY_PREFIX + 'Global accent enabled';
var PROPERTY_GLOBAL_ACCENT_MODE = PROPERTY_PREFIX + 'Global accent mode'; // 'album' | 'default' | 'custom'
var PROPERTY_GLOBAL_ACCENT_CUSTOM_COLOUR = PROPERTY_PREFIX + 'Global accent custom colour';
var PROPERTY_EXTRACTION_ALGORITHM = PROPERTY_PREFIX + 'Extraction algorithm'; // 'material' | 'legacy'
var PROPERTY_GLOBAL_THEME = PROPERTY_PREFIX + 'Global theme mode';
var PROPERTY_HISTORY_PLAYLIST_ENABLED = PROPERTY_PREFIX + 'History playlist enabled';
var PROPERTY_RESIZING_MODE = 'RIVAGE.Layout.EnableResizingMode';
var PROPERTY_MINI_LOCK_WINDOW_SIZE = 'RIVAGE.MiniPlayer.LockWindowSize';
var PROPERTY_MINI_ALWAYS_ON_TOP = 'RIVAGE.MiniPlayer.AlwaysOnTop';
var PROPERTY_MINI_RESTORE_ALWAYS_ON_TOP = 'RIVAGE.MiniPlayer.RestoreAlwaysOnTop';
var PROPERTY_MINI_RESTORE_LOCK_WINDOW_SIZE = 'RIVAGE.MiniPlayer.RestoreLockWindowSize';
var PROPERTY_MINI_SHOW_MIDPOINT = 'RIVAGE.MiniPlayer.ShowMidpointMark';
var PROPERTY_MINI_SHOW_LOVE = 'RIVAGE.MiniPlayer.ShowLoveButton';
var PROPERTY_MINI_SHOW_RATING = 'RIVAGE.MiniPlayer.ShowRating';
// Last.fm panels are read-only consumers of these shared credentials.
var PROPERTY_LASTFM_API_KEY = 'RIVAGE.LastFM.ApiKey';
var PROPERTY_LASTFM_USERNAME = 'RIVAGE.LastFM.Username';
// External compatibility messages; no in-tree consumer is required.
var UWP_TABS_ACTIVE_UPDATE = 'UWP_BOTTOM_TABS.ACTIVE';
var UWP_TABS_SELECT        = 'UWP_BOTTOM_TABS.SELECT';
var UWP_TABS_QUERY         = 'UWP_BOTTOM_TABS.QUERY';

var DEFAULT_UWP_ACCENT = 0xff0078d4;

// Compatibility accent can be album-derived, fixed UWP blue or custom; semantic cover theme stays independent.
var GlobalAccentMode = { Album: 'album', Default: 'default', Custom: 'custom' };

function normaliseGlobalAccentMode(mode) {
    if (mode === GlobalAccentMode.Default || mode === GlobalAccentMode.Custom) {
        return mode;
    }
    return GlobalAccentMode.Album;
}

// One-time migration: legacy true -> album, false -> default.
function readInitialGlobalAccentMode() {
    var stored = window.GetProperty(PROPERTY_GLOBAL_ACCENT_MODE, '');
    if (stored) {
        return normaliseGlobalAccentMode(stored);
    }
    var legacyEnabled = !!window.GetProperty(PROPERTY_GLOBAL_ACCENT, true);
    return legacyEnabled ? GlobalAccentMode.Album : GlobalAccentMode.Default;
}

// Shared '> History' playlist behavior migrated intact from Play Log 4.2.0.
// Tracks qualify only after ten seconds of confirmed continuous playback;
// seeks and large unreported position jumps do not count as listened time.
var HISTORY_PLAYLIST_NAME = '> History';
var MAX_HISTORY_PLAYLIST_ITEMS = 200;
var MINIMUM_CONFIRMED_HISTORY_PLAYBACK_SECONDS = 10;
var MAX_CONTINUOUS_HISTORY_PLAYBACK_DELTA_SECONDS = 5;
var HISTORY_STARTING_ANOTHER_TRACK = 2;

var MIN_TAB_WIDTH = 84;
var MAX_TAB_WIDTH = 220;
var MAX_TRANSIENT_RETRIES = 4;
var TRANSIENT_RETRY_DELAY = 25;
var RECOVERY_RETRY_DELAY = 1500;
var CHILD_WATCH_INTERVAL = 1500;
var MAX_PENDING_HISTORY_ITEMS = 32;

var extractionAlgorithm = String(window.GetProperty(PROPERTY_EXTRACTION_ALGORITHM, 'material'));
if (extractionAlgorithm !== 'legacy') extractionAlgorithm = 'material';
var globalThemeMode = SharedThemeProtocol.normaliseMode(window.GetProperty(PROPERTY_GLOBAL_THEME, 'existing'));

// This panel's tab bar is a dark surface (COLOUR_TAB_BAR below), so tell the engine to
// tone-correct extracted colours as if drawn on a dark background.
AlbumAccentEngine.configure({ algorithm: extractionAlgorithm, backgroundTone: 20 });
AlbumAccentEngine.FIXED_ACCENT = DEFAULT_UWP_ACCENT;

var tabs = [];

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function RGB(red, green, blue) {
    return RivageUI.rgb(red, green, blue);
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

var COLOUR_CONTENT        = RGB(32, 32, 32);
var COLOUR_TAB_BAR        = RGB(28, 28, 28);
var COLOUR_SEPARATOR      = RGB(51, 51, 51);
var COLOUR_TEXT_PRIMARY   = RGB(245, 245, 245);
var COLOUR_TEXT_SECONDARY = RGB(184, 184, 184);
var COLOUR_TEXT_MUTED     = RGB(126, 126, 126);
var COLOUR_MESSAGE        = RGB(174, 174, 174);
var rootTheme = RivageUI.createTheme({ mode: 'dark', accent: DEFAULT_UWP_ACCENT });

function refreshRootTheme() {
    rootTheme = RivageUI.createTheme({ mode: 'dark', accent: sharedAlbumAccent });
    COLOUR_CONTENT = rootTheme.background;
    COLOUR_TAB_BAR = rootTheme.navigationSurface;
    COLOUR_SEPARATOR = rootTheme.navigationSeparator;
    COLOUR_TEXT_PRIMARY = rootTheme.navigationTextPrimary;
    COLOUR_TEXT_SECONDARY = rootTheme.navigationTextSecondary;
    COLOUR_TEXT_MUTED = rootTheme.navigationTextMuted;
    COLOUR_MESSAGE = rootTheme.textSecondary;
}

var messageFont = RivageUI.font('Segoe UI', Math.max(10, Math.round(12 * dpi / 96)), 0);

var tabFont = null;

function rebuildTabFont() {
    tabFont = TabBarStyle.drawingFont();
}
rebuildTabFont();

var activeIndex = parseInt(window.GetProperty(PROPERTY_ACTIVE_TAB, 0), 10);
if (!isFinite(activeIndex) || activeIndex < 0) activeIndex = 0;
var savedActiveKey = String(window.GetProperty(PROPERTY_ACTIVE_KEY, '') || '');

// Scan/layout state machine, same shape as extra-tab-parent.js's. Child
// insertion and removal are native JSplitter transactions: enumerating or
// touching PanelObjects from inside one is unsafe, so every discovery pass is
// guarded by these flags and re-tried on a short timer instead.
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
var activePersistenceDirty = false;
var scrollX = 0;

var globalAccentMode = readInitialGlobalAccentMode();
var globalAccentCustomColour = SharedAccentProtocol.opaque(
    Number(window.GetProperty(PROPERTY_GLOBAL_ACCENT_CUSTOM_COLOUR, DEFAULT_UWP_ACCENT)) || DEFAULT_UWP_ACCENT
);
var historyPlaylistEnabled = !!window.GetProperty(PROPERTY_HISTORY_PLAYLIST_ENABLED, true);
var resizingModeEnabled = ResizingModeProtocol.normalise(
    window.GetProperty(PROPERTY_RESIZING_MODE, true)
);
var miniPlayerSettings = MiniPlayerProtocol.normaliseSettings({
    lockWindowSize: window.GetProperty(PROPERTY_MINI_LOCK_WINDOW_SIZE, false),
    alwaysOnTop: window.GetProperty(PROPERTY_MINI_ALWAYS_ON_TOP, true),
    restoreAlwaysOnTop: window.GetProperty(PROPERTY_MINI_RESTORE_ALWAYS_ON_TOP, true),
    restoreLockWindowSize: window.GetProperty(PROPERTY_MINI_RESTORE_LOCK_WINDOW_SIZE, true),
    showMidpointMark: window.GetProperty(PROPERTY_MINI_SHOW_MIDPOINT, true),
    showLoveButton: window.GetProperty(PROPERTY_MINI_SHOW_LOVE, true),
    showRating: window.GetProperty(PROPERTY_MINI_SHOW_RATING, true)
});
var lastfmApiKey = String(window.GetProperty(PROPERTY_LASTFM_API_KEY, ''));
var lastfmUsername = String(window.GetProperty(PROPERTY_LASTFM_USERNAME, ''));
var persistedTabIdOwnersWire = String(window.GetProperty(PROPERTY_TAB_ID_OWNERS, '') || '');
var tabIdOwnersDirty = false;

// The most recently generated complete cover-art theme. The compatibility
// accent is retained separately for older consumers.
var fallbackThemePayload = AlbumAccentEngine.buildThemePayload([], 'fallback', false);
var lastThemePayload = fallbackThemePayload;
var publishedThemePayload = fallbackThemePayload;
var lastExtractedAccent = DEFAULT_UWP_ACCENT;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

var hoveredIndex = -1;
var pressedIndex = -1;
var lastMouseX = -1;
var lastMouseY = -1;
var panelWidth   = Math.max(0, window.Width);
var panelHeight  = Math.max(0, window.Height);
var historyPlaylistActiveTrack = null;
var historyPlaylistPending = [];
var historyPlaylistTrimPending = false;
var historyWriteBusy = false;

function tabBarHeight() {
    if (panelHeight <= 0) return 0;
    return Math.min(panelHeight, scale(TabBarStyle.settings.tabBarHeight));
}

function tabBarY() {
    return Math.max(0, panelHeight - tabBarHeight());
}

function contentHeight() {
    return Math.max(0, panelHeight - tabBarHeight());
}

function tabWidth() {
    if (!tabs.length || panelWidth <= 0) return 0;

    var equal = Math.floor(panelWidth / tabs.length);
    if (equal >= scale(MIN_TAB_WIDTH)) return Math.min(equal, scale(MAX_TAB_WIDTH));
    return scale(MIN_TAB_WIDTH);
}

function stripWidth() {
    return tabWidth() * tabs.length;
}

function maximumScrollX() {
    return Math.max(0, stripWidth() - panelWidth);
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
    else if (right > scrollX + panelWidth) scrollX = right - panelWidth;

    clampScroll();
}

function getTabRect(index) {
    var width = tabWidth();

    return {
        x: index * width - scrollX,
        y: tabBarY(),
        w: width,
        h: tabBarHeight()
    };
}

function hitTestTab(x, y) {
    var width = tabWidth();
    if (
        width <= 0 ||
        !tabs.length ||
        panelWidth <= 0 ||
        x < 0 || x >= panelWidth ||
        y < tabBarY() || y >= panelHeight
    ) {
        return -1;
    }

    var index = Math.floor((x + scrollX) / width);
    return index >= 0 && index < tabs.length ? index : -1;
}

// force=true bypasses JSplitter's "group up non-forced repaints" scheduling (see the
// window.Repaint/RepaintRect docs) - used for the accent update below, which is rare enough
// (once per track/focus change, never per-frame) that skipping the batching is free.
function repaintTabBar(force) {
    if (panelWidth > 0 && panelHeight > 0) {
        window.RepaintRect(0, tabBarY(), panelWidth, tabBarHeight(), !!force);
    }
}

function currentAccent() {
    return TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_SHARED ? sharedAlbumAccent : DEFAULT_UWP_ACCENT;
}

function accentSeedHandle() {
    try {
        if (fb.IsPlaying || fb.IsPaused) {
            var nowPlaying = fb.GetNowPlaying();
            if (nowPlaying) {
                return nowPlaying;
            }
        }

        var focused = fb.GetFocusItem(true);
        if (focused) {
            return focused;
        }
    }
    catch (error) {
        // Fall through to "nothing to seed from".
    }
    return null;
}

function extractAndBroadcastAccent(handle) {
    var seed = handle || accentSeedHandle();
    lastThemePayload = AlbumAccentEngine.extractThemeFromMetadb(seed) || fallbackThemePayload;
    lastExtractedAccent = SharedAccentProtocol.opaque(lastThemePayload.accent);
    return republishAccent();
}

// Rapid skip chains can deliver several real playback transitions within a few
// milliseconds. AlbumAccentEngine memoises repeated albums, but every distinct
// transient track can still synchronously decode artwork and then fan a theme
// update out to the whole layout. Wait briefly for playback to settle and only
// extract for the track that is still current when the timer fires.
var accentSettleTimer = null;
var ACCENT_SETTLE_DELAY = 250;

function cancelScheduledAccentRefresh() {
    if (accentSettleTimer !== null) {
        try { window.ClearTimeout(accentSettleTimer); } catch (e) { }
        accentSettleTimer = null;
    }
}

function scheduleAccentRefresh() {
    cancelScheduledAccentRefresh();
    if (!scriptActive) return;
    try {
        accentSettleTimer = window.SetTimeout(function () {
            accentSettleTimer = null;
            if (scriptActive) extractAndBroadcastAccent();
        }, ACCENT_SETTLE_DELAY);
    } catch (e) {
        accentSettleTimer = null;
        if (scriptActive) extractAndBroadcastAccent();
    }
}

function cloneThemePayload(payload) {
    try { return JSON.parse(JSON.stringify(payload || fallbackThemePayload)); }
    catch (e) { return JSON.parse(JSON.stringify(fallbackThemePayload)); }
}

function republishAccent() {
    var sourcePayload = lastThemePayload;
    var compatibilityAccent = lastExtractedAccent;

    if (globalAccentMode === GlobalAccentMode.Custom) {
        compatibilityAccent = globalAccentCustomColour;
    } else if (globalAccentMode === GlobalAccentMode.Default) {
        compatibilityAccent = DEFAULT_UWP_ACCENT;
    }

    var payload = cloneThemePayload(sourcePayload);
    payload.mode = globalThemeMode;

    if (globalThemeMode === 'host') {
        compatibilityAccent = RivageUI.hostInfo().accent;
    } else if (globalThemeMode === 'dark' || globalThemeMode === 'light') {
        compatibilityAccent = DEFAULT_UWP_ACCENT;
    } else if (globalThemeMode === 'album-auto' || globalThemeMode === 'album-dark' || globalThemeMode === 'album-light') {
        // Artwork-palette themes are coherent only when direct Shared accent
        // consumers receive the same artwork-derived accent as the palette.
        // Keep globalAccentMode untouched so returning to Panel defaults restores
        // the user's previously configured Shared accent source.
        compatibilityAccent = lastExtractedAccent;
    }

    payload.accent = SharedAccentProtocol.opaque(compatibilityAccent);

    sharedAlbumAccent = SharedAccentProtocol.opaque(payload.accent);
    publishedThemePayload = payload;
    SharedAccentProtocol.broadcast(sharedAlbumAccent);
    SharedThemeProtocol.broadcast(publishedThemePayload);
    refreshRootTheme();

    if (TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_SHARED) {
        repaintTabBar(true);
    } else {
        window.Repaint(true);
    }

    return sharedAlbumAccent;
}

function trySetProperty(name, value) {
    try {
        window.SetProperty(name, value);
        return true;
    } catch (e) {
        return false;
    }
}

function globalThemeUsesConfiguredAccent() {
    return globalThemeMode === 'existing';
}

function effectiveSharedAccentLabel() {
    if (globalThemeMode === 'host') return RivageUI.copy.labels.foobar2000Accent;
    if (globalThemeMode === 'dark' || globalThemeMode === 'light') return RivageUI.copy.labels.rvgBlue;
    if (globalThemeMode === 'album-auto' || globalThemeMode === 'album-dark' || globalThemeMode === 'album-light') {
        return RivageUI.copy.labels.artwork;
    }
    if (globalAccentMode === GlobalAccentMode.Default) return RivageUI.copy.labels.rvgBlue;
    if (globalAccentMode === GlobalAccentMode.Custom) return RivageUI.copy.labels.customColour;
    return RivageUI.copy.labels.artwork;
}

function setGlobalAccentMode(mode) {
    var next = normaliseGlobalAccentMode(mode);
    if (next === globalAccentMode) return true;
    if (!trySetProperty(PROPERTY_GLOBAL_ACCENT_MODE, next)) return false;
    globalAccentMode = next;
    republishAccent();
    return true;
}

function setGlobalAccentCustomColour(colour) {
    var nextColour = SharedAccentProtocol.opaque(colour);
    var needsMode = globalAccentMode !== GlobalAccentMode.Custom;
    if (!trySetProperty(PROPERTY_GLOBAL_ACCENT_CUSTOM_COLOUR, nextColour)) return false;
    if (needsMode && !trySetProperty(PROPERTY_GLOBAL_ACCENT_MODE, GlobalAccentMode.Custom)) return false;

    globalAccentCustomColour = nextColour;
    if (needsMode) globalAccentMode = GlobalAccentMode.Custom;
    republishAccent();
    return true;
}

function promptGlobalAccentCustomColour() {
    var picked;
    try {
        picked = utils.ColourPicker(window.ID, globalAccentCustomColour);
    } catch (e) {
        return;
    }
    if (typeof picked !== 'number') return;
    setGlobalAccentCustomColour(picked);
}

function setGlobalThemeMode(mode) {
    var next = SharedThemeProtocol.normaliseMode(mode);
    if (!trySetProperty(PROPERTY_GLOBAL_THEME, next)) return false;
    globalThemeMode = next;
    republishAccent();
    return true;
}

function setHistoryPlaylistEnabled(enabled) {
    var next = !!enabled;
    if (next === historyPlaylistEnabled) return true;
    if (!trySetProperty(PROPERTY_HISTORY_PLAYLIST_ENABLED, next)) return false;

    historyPlaylistEnabled = next;
    historyPlaylistActiveTrack = null;
    if (!next) {
        historyPlaylistPending = [];
        historyPlaylistTrimPending = false;
    } else {
        initialiseHistoryPlaylistTracking();
        flushHistoryPlaylistPending();
    }
    return true;
}

function setResizingModeEnabled(enabled) {
    var next = !!enabled;
    if (!trySetProperty(PROPERTY_RESIZING_MODE, next)) return false;
    resizingModeEnabled = next;
    ResizingModeProtocol.broadcast(resizingModeEnabled);
    return true;
}

function adoptResizingMode(enabled) {
    var next = !!enabled;
    if (next === resizingModeEnabled) return true;
    if (!trySetProperty(PROPERTY_RESIZING_MODE, next)) return false;
    resizingModeEnabled = next;
    return true;
}

function setMiniPlayerSetting(settingId, value) {
    var key = '';
    var property = '';
    var next = !!value;

    switch (settingId) {
    case 'miniPlayerLockWindowSize':
        key = 'lockWindowSize';
        property = PROPERTY_MINI_LOCK_WINDOW_SIZE;
        break;
    case 'miniPlayerAlwaysOnTop':
        key = 'alwaysOnTop';
        property = PROPERTY_MINI_ALWAYS_ON_TOP;
        break;
    case 'miniPlayerRestoreAlwaysOnTop':
        key = 'restoreAlwaysOnTop';
        property = PROPERTY_MINI_RESTORE_ALWAYS_ON_TOP;
        break;
    case 'miniPlayerRestoreLockWindowSize':
        key = 'restoreLockWindowSize';
        property = PROPERTY_MINI_RESTORE_LOCK_WINDOW_SIZE;
        break;
    case 'miniPlayerShowMidpointMark':
        key = 'showMidpointMark';
        property = PROPERTY_MINI_SHOW_MIDPOINT;
        break;
    case 'miniPlayerShowLoveButton':
        key = 'showLoveButton';
        property = PROPERTY_MINI_SHOW_LOVE;
        break;
    case 'miniPlayerShowRating':
        key = 'showRating';
        property = PROPERTY_MINI_SHOW_RATING;
        break;
    default:
        return false;
    }

    if (miniPlayerSettings[key] !== next) {
        if (!trySetProperty(property, next)) return false;
        miniPlayerSettings[key] = next;
    }
    MiniPlayerProtocol.broadcastSettings(miniPlayerSettings);
    return true;
}

function setLastfmCredentials(apiKey, username) {
    var nextApiKey = String(apiKey || '');
    var nextUsername = String(username || '');

    if (nextApiKey === lastfmApiKey && nextUsername === lastfmUsername) {
        LastfmCredentialsProtocol.broadcast({ apiKey: lastfmApiKey, username: lastfmUsername });
        return true;
    }

    if (!trySetProperty(PROPERTY_LASTFM_API_KEY, nextApiKey)) return false;
    if (!trySetProperty(PROPERTY_LASTFM_USERNAME, nextUsername)) {
        trySetProperty(PROPERTY_LASTFM_API_KEY, lastfmApiKey);
        return false;
    }

    lastfmApiKey = nextApiKey;
    lastfmUsername = nextUsername;
    LastfmCredentialsProtocol.broadcast({ apiKey: lastfmApiKey, username: lastfmUsername });
    return true;
}

function setExtractionAlgorithm(mode) {
    var next = mode === 'legacy' ? 'legacy' : 'material';
    if (!trySetProperty(PROPERTY_EXTRACTION_ALGORITHM, next)) return false;
    extractionAlgorithm = next;
    AlbumAccentEngine.configure({ algorithm: extractionAlgorithm });
    AlbumAccentEngine.clear_memo();
    extractAndBroadcastAccent();
    return true;
}

// Debounced so holding an arrow key/scrolling doesn't decode artwork on every row.
var focusFollowTimer = null;
var FOCUS_FOLLOW_DELAY = 220;

function scheduleFocusFollowAccent() {
    if (!scriptActive || fb.IsPlaying || fb.IsPaused) return;

    if (focusFollowTimer !== null) {
        try { window.ClearTimeout(focusFollowTimer); } catch (e) { }
        focusFollowTimer = null;
    }

    try {
        focusFollowTimer = window.SetTimeout(function () {
            focusFollowTimer = null;
            if (!scriptActive || fb.IsPlaying || fb.IsPaused) return;
            extractAndBroadcastAccent();
        }, FOCUS_FOLLOW_DELAY);
    } catch (e2) {
        focusFollowTimer = null;
        if (scriptActive && !fb.IsPlaying && !fb.IsPaused) extractAndBroadcastAccent();
    }
}

function setAccentMode(mode) {
    TabBarStyle.setAndSync('accentMode', mode === TabBarStyle.ACCENT_FIXED ? TabBarStyle.ACCENT_FIXED : TabBarStyle.ACCENT_SHARED);
}

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

function parseTabIdOwners(wire) {
    if (!wire) return Object.create(null);
    try {
        var parsed = JSON.parse(wire);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
        var result = Object.create(null);
        for (var key in parsed) {
            if (!Object.prototype.hasOwnProperty.call(parsed, key) || typeof parsed[key] !== 'string') continue;
            var id = String(parsed[key] || '');
            if (id) result[String(key).toLowerCase()] = id;
        }
        return result;
    } catch (e) {
        return Object.create(null);
    }
}

function serialiseTabIdOwners(owners) {
    var keys = [];
    for (var key in owners) {
        if (Object.prototype.hasOwnProperty.call(owners, key)) keys.push(key);
    }
    keys.sort();
    var ordered = {};
    for (var i = 0; i < keys.length; i++) ordered[keys[i]] = owners[keys[i]];
    return JSON.stringify(ordered);
}

var tabIdOwners = parseTabIdOwners(persistedTabIdOwnersWire);

function persistTabIdOwners() {
    var wire = serialiseTabIdOwners(tabIdOwners);
    if (!tabIdOwnersDirty && wire === persistedTabIdOwnersWire) return true;
    if (!trySetProperty(PROPERTY_TAB_ID_OWNERS, wire)) {
        tabIdOwnersDirty = true;
        return false;
    }
    persistedTabIdOwnersWire = wire;
    tabIdOwnersDirty = false;
    return true;
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

            if (!scanChildPanels()) {
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
        }, TRANSIENT_RETRY_DELAY);
        return true;
    } catch (e) {
        layoutTimer = null;
        layoutRequestPending = false;
        return false;
    }
}

function scanChildPanels() {
    if (scanBusy) return false;

    var count = safeGetPanelCount();
    if (count < 0) return false;
    scanBusy = true;

    var previousKey = tabs[activeIndex] ? tabs[activeIndex].key : savedActiveKey;
    var occurrence = Object.create(null);
    var found = [];
    var captions = [];
    var stable = true;

    try {
        for (var i = 0; i < count; i++) {
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
                    id: '',
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

        var preferredIds = Object.create(null);
        var key;
        for (key in tabIdOwners) {
            if (Object.prototype.hasOwnProperty.call(tabIdOwners, key)) preferredIds[key] = tabIdOwners[key];
        }
        for (i = 0; i < tabs.length; i++) {
            key = String(tabs[i].caption).toLowerCase();
            if (!preferredIds[key]) preferredIds[key] = tabs[i].id;
        }

        var ids = PanelHostKit.makeUniqueCaptionIds(captions, preferredIds);
        var nextOwners = Object.create(null);
        for (i = 0; i < found.length; i++) {
            found[i].id = ids[i];
            key = String(found[i].caption).toLowerCase();
            if (!nextOwners[key]) nextOwners[key] = ids[i];
        }

        tabs = found;
        detectedPanelCount = count;
        detectedPanelFingerprint = makePanelFingerprint(captions, count);
        tabIdOwners = nextOwners;
        if (serialiseTabIdOwners(tabIdOwners) !== persistedTabIdOwnersWire) tabIdOwnersDirty = true;
        persistTabIdOwners();

        var restored = findIndexByKey(previousKey);
        if (restored < 0) restored = findIndexByKey(savedActiveKey);
        if (restored < 0) restored = clamp(activeIndex, 0, Math.max(0, tabs.length - 1));
        activeIndex = restored;

        if (!tabs.length) {
            activeIndex = 0;
            savedActiveKey = '';
            pendingActiveKey = '';
        }

        persistActiveTab();
        initialized = true;
        return true;
    } finally {
        scanBusy = false;
    }
}

function persistActiveTab() {
    var key = '';
    var index = 0;
    if (tabs.length && tabs[activeIndex]) {
        key = tabs[activeIndex].key;
        index = activeIndex;
    }
    savedActiveKey = key;
    var keyStored = trySetProperty(PROPERTY_ACTIVE_KEY, key);
    var indexStored = trySetProperty(PROPERTY_ACTIVE_TAB, index);
    activePersistenceDirty = !keyStored || !indexStored;
    return !activePersistenceDirty;
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

        if (!initialized || safeGetPanelCount() !== detectedPanelCount) return layoutResult(false, false);
        if (!tabs.length) return layoutResult(true, true);
        if (targetIndex < 0 || targetIndex >= tabs.length) return layoutResult(false, false);

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

        // The committed page stays visible until the target is successfully placed and shown.
        if (!safeMovePanel(panels[targetIndex], 0, 0, childW, childH)) {
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
        window.NotifyOthers(UWP_TABS_ACTIVE_UPDATE, String(tabs[activeIndex].id));
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
    if (!scanChildPanels()) {
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
        if (activePersistenceDirty) persistActiveTab();
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
        var numericIndex = Math.floor(value);
        return numericIndex >= 0 && numericIndex < tabs.length ? numericIndex : -1;
    }
    if (typeof value !== 'string') return -1;

    var text = value.toLowerCase();
    for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        if (
            String(tab.id).toLowerCase() === text ||
            String(tab.label).toLowerCase() === text ||
            String(tab.caption).toLowerCase() === text ||
            String(tab.key).toLowerCase() === text
        ) return i;
    }
    return -1;
}

function drawNoPanelsMessage(gr) {
    if (tabs.length || !messageFont || contentHeight() <= scale(20)) return;

    var padding = scale(24);

    gr.GdiDrawText(
        'No panels found. Right-click the tab bar and choose Refresh panel list.',
        messageFont,
        COLOUR_MESSAGE,
        padding,
        0,
        Math.max(1, panelWidth - padding * 2),
        contentHeight(),
        DT_CENTER | DT_VCENTER | DT_WORDBREAK | DT_NOPREFIX
    );
}

function drawTabBar(gr) {
    var barY = tabBarY();
    var barH = tabBarHeight();
    var accent = currentAccent();

    var selectedBackground = blendColours(accent, COLOUR_TAB_BAR, 0.12);
    var hoverBackground    = blendColours(COLOUR_TEXT_PRIMARY, COLOUR_TAB_BAR, 0.07);
    var selectedHover      = blendColours(accent, COLOUR_TAB_BAR, 0.19);
    var pressedBackground  = blendColours(accent, COLOUR_TAB_BAR, 0.25);

    gr.FillSolidRect(0, barY, panelWidth, barH, COLOUR_TAB_BAR);
    gr.FillSolidRect(0, barY, panelWidth, scale(1), COLOUR_SEPARATOR);

    for (var i = 0; i < tabs.length; i++) {
        var rect = getTabRect(i);

        if (rect.x + rect.w <= 0 || rect.x >= panelWidth) continue;

        var selected = i === activeIndex;
        var hovered  = i === hoveredIndex;
        var pressed  = i === pressedIndex;
        var background = COLOUR_TAB_BAR;

        if (selected) {
            background = selectedBackground;
        }
        if (hovered) {
            background = selected ? selectedHover : hoverBackground;
        }
        if (pressed) {
            background = pressedBackground;
        }

        if (background !== COLOUR_TAB_BAR) {
            gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, background);
        }

        if (selected) {
            var indicatorW = Math.min(scale(30), Math.max(scale(12), rect.w - scale(16)));
            var indicatorX = rect.x + Math.floor((rect.w - indicatorW) / 2);
            gr.FillSolidRect(indicatorX, rect.y, indicatorW, scale(3), accent);
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
                rect.y + scale(2),
                Math.max(1, rect.w - scale(10)),
                Math.max(1, rect.h - scale(2)),
                DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX
            );
        }
    }
}

function updateHoverFromPointer(repaint) {
    if (lastMouseX < 0) return false;
    var index = hitTestTab(lastMouseX, lastMouseY);
    if (index === hoveredIndex) return false;
    hoveredIndex = index;
    if (repaint) repaintTabBar();
    return true;
}

// Non-mouse repaints can restore the host cursor; reassert from the last pointer position.
function reassertCursor() {
    if (lastMouseX < 0) return;
    window.SetCursor(hitTestTab(lastMouseX, lastMouseY) >= 0 ? IDC_HAND : IDC_ARROW);
}

function on_paint(gr) {
    updateHoverFromPointer(false);
    if (childRefreshNeeded) scheduleChildRefresh();
    else if (layoutNeeded && !layoutRequestPending) scheduleLayout(panelWidth, panelHeight);
    gr.FillSolidRect(0, 0, panelWidth, panelHeight, COLOUR_CONTENT);
    drawNoPanelsMessage(gr);
    drawTabBar(gr);
    reassertCursor();
}

function on_mouse_move(x, y, mask) {
    var index = hitTestTab(x, y);

    lastMouseX = x;
    lastMouseY = y;

    if (index !== hoveredIndex) {
        hoveredIndex = index;
        repaintTabBar();
    }

    window.SetCursor(index >= 0 ? IDC_HAND : IDC_ARROW);
}

function on_mouse_leave() {
    lastMouseX = -1;
    lastMouseY = -1;

    if (hoveredIndex !== -1 || pressedIndex !== -1) {
        hoveredIndex = -1;
        pressedIndex = -1;
        repaintTabBar();
    }

    window.SetCursor(IDC_ARROW);
}

function on_mouse_lbtn_down(x, y, mask) {
    pressedIndex = hitTestTab(x, y);
    repaintTabBar();
}

function on_mouse_lbtn_up(x, y, mask) {
    var releasedIndex = hitTestTab(x, y);
    var shouldSelect = pressedIndex >= 0 && releasedIndex === pressedIndex;

    pressedIndex = -1;

    if (shouldSelect) {
        selectTab(releasedIndex);
    }
    else {
        repaintTabBar();
    }
}

function showTabBarMenu(x, y) {
    var menu = window.CreatePopupMenu();
    var tabAccentMenu = window.CreatePopupMenu();
    var sharedAccentMenu = window.CreatePopupMenu();
    var extractionMenu = window.CreatePopupMenu();

    tabAccentMenu.AppendMenuItem(MF_STRING, 1, RivageUI.copy.labels.rvgBlue);
    tabAccentMenu.AppendMenuItem(MF_STRING, 2, RivageUI.copy.labels.sharedAccent);
    tabAccentMenu.CheckMenuRadioItem(1, 2, TabBarStyle.settings.accentMode === TabBarStyle.ACCENT_FIXED ? 1 : 2);
    tabAccentMenu.AppendTo(menu, MF_STRING, 'Tab bar accent');

    if (globalThemeUsesConfiguredAccent()) {
        sharedAccentMenu.AppendMenuItem(MF_STRING, 12, RivageUI.copy.labels.artwork);
        sharedAccentMenu.AppendMenuItem(MF_STRING, 13, RivageUI.copy.labels.rvgBlue);
        sharedAccentMenu.AppendMenuItem(MF_STRING, 14, RivageUI.copy.labels.customColour + '\u2026');
        sharedAccentMenu.CheckMenuRadioItem(12, 14,
            globalAccentMode === GlobalAccentMode.Default ? 13 :
            (globalAccentMode === GlobalAccentMode.Custom ? 14 : 12)
        );
        sharedAccentMenu.AppendTo(menu, MF_STRING, 'Shared accent source');
    } else {
        menu.AppendMenuItem(MF_GRAYED, 0, 'Shared accent: ' + effectiveSharedAccentLabel());
    }

    extractionMenu.AppendMenuItem(MF_STRING, 9, 'Material palette');
    extractionMenu.AppendMenuItem(MF_STRING, 10, 'Legacy colour extractor');
    extractionMenu.CheckMenuRadioItem(9, 10, extractionAlgorithm === 'legacy' ? 10 : 9);
    extractionMenu.AppendTo(menu, MF_STRING, 'Artwork colour extraction');

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 7, 'Tab bar height... (' + TabBarStyle.settings.tabBarHeight + ' px)');
    menu.AppendMenuItem(MF_STRING, 8, 'Choose tab bar font\u2026 (' + TabBarStyle.describeFont() + ')');
    if (TabBarStyle.settings.fontFamily) {
        menu.AppendMenuItem(MF_STRING, 11, 'Use Columns UI "Common (labels)" font');
    }

    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 5, 'Refresh panel list');

    var command = menu.TrackPopupMenu(x, y);

    switch (command) {
        case 1:
            setAccentMode(TabBarStyle.ACCENT_FIXED);
            break;

        case 2:
            setAccentMode(TabBarStyle.ACCENT_SHARED);
            break;

        case 5:
            refreshChildPanels();
            break;

        case 12:
            setGlobalAccentMode(GlobalAccentMode.Album);
            break;

        case 13:
            setGlobalAccentMode(GlobalAccentMode.Default);
            break;

        case 14:
            promptGlobalAccentCustomColour();
            break;

        case 7:
            promptTabBarHeight();
            break;

        case 8:
            TabBarStyle.promptFont();
            break;

        case 9:
            setExtractionAlgorithm('material');
            break;

        case 10:
            setExtractionAlgorithm('legacy');
            break;

        case 11:
            TabBarStyle.useCommonLabelsAndSync();
            break;
    }
}

function promptTabBarHeight() {
    var input;
    try {
        input = utils.InputBox(window.ID, 'Tab bar height in pixels at 96 DPI:', RivageUI.copy.popupTitle('Tabs'), String(TabBarStyle.settings.tabBarHeight), true);
    }
    catch (error) {
        return; // dialog was cancelled
    }

    var value = clamp(parseInt(input, 10), TabBarStyle.MIN_HEIGHT, TabBarStyle.MAX_HEIGHT);
    if (isNaN(value)) {
        return;
    }

    TabBarStyle.setAndSync('tabBarHeight', value);
}

function on_mouse_rbtn_up(x, y, mask) {
    if (x >= 0 && x < panelWidth && y >= tabBarY() && y < tabBarY() + tabBarHeight()) {
        showTabBarMenu(x, y);
        return true;
    }
    return false;
}

function on_mouse_wheel(step) {
    updateHoverFromPointer(false);
    if (hoveredIndex < 0 || tabs.length < 2) {
        return;
    }

    var direction = step > 0 ? -1 : 1;
    var next = (activeIndex + direction + tabs.length) % tabs.length;
    selectTab(next);
}


// This controller is persistent for the whole foobar2000 session and exists
// once in the supplied layout, so it is the one clear source of truth for
// writes to the shared playlist. The qualification, stop/transition handling,
// insertion order and selection-preserving trim logic below are migrated from
// playback_history_panel.js 4.2.0 without track-identity deduplication.
function historyCurrentPlaybackPosition() {
    var position = 0;

    try {
        position = Number(fb.PlaybackTime);
    } catch (e) {
        position = 0;
    }

    return isFinite(position) && position >= 0 ? position : 0;
}

function historySamePlaybackItem(first, second) {
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

function beginHistoryPlaylistTrack(handle) {
    if (!handle) {
        historyPlaylistActiveTrack = null;
        return;
    }

    historyPlaylistActiveTrack = {
        handle: handle,
        playedSeconds: 0,
        lastPosition: historyCurrentPlaybackPosition()
    };
}

function observeHistoryPlaylistPosition(time) {
    var position;
    var delta;

    if (!historyPlaylistActiveTrack) return;

    position = Number(time);
    if (!isFinite(position) || position < 0) return;

    delta = position - historyPlaylistActiveTrack.lastPosition;
    historyPlaylistActiveTrack.lastPosition = position;

    if (delta > 0 && delta <= MAX_CONTINUOUS_HISTORY_PLAYBACK_DELTA_SECONDS) {
        historyPlaylistActiveTrack.playedSeconds += delta;
    }
}

function captureFinalHistoryPlaylistProgress(requireCurrentHandle) {
    var nowPlaying = null;

    if (!historyPlaylistActiveTrack) return;

    try {
        nowPlaying = fb.GetNowPlaying();
    } catch (e) {
        nowPlaying = null;
    }

    // During a normal track transition, only sample fb.PlaybackTime while the
    // host still reports the item being finalised. This prevents time from the
    // incoming item being assigned to a track that foo_skip just rejected.
    if (requireCurrentHandle &&
            !historySamePlaybackItem(nowPlaying, historyPlaylistActiveTrack.handle)) {
        return;
    }

    if (nowPlaying &&
            !historySamePlaybackItem(nowPlaying, historyPlaylistActiveTrack.handle)) return;
    observeHistoryPlaylistPosition(historyCurrentPlaybackPosition());
}

function findOrCreateHistoryPlaylist() {
    var playlistIndex = -1;

    try {
        if (typeof plman.FindOrCreatePlaylist === 'function') {
            return Number(plman.FindOrCreatePlaylist(HISTORY_PLAYLIST_NAME, false));
        }

        playlistIndex = Number(plman.FindPlaylist(HISTORY_PLAYLIST_NAME));
        if (playlistIndex < 0) {
            playlistIndex = Number(
                plman.CreatePlaylist(plman.PlaylistCount, HISTORY_PLAYLIST_NAME)
            );
        }
    } catch (e) {
        playlistIndex = -1;
    }

    return playlistIndex;
}

function makeHistorySingleHandleList(handle) {
    var list;

    try {
        return new FbMetadbHandleList([handle]);
    } catch (e) {
        list = fb.CreateHandleList();
        list.Add(handle);
        return list;
    }
}

function captureHistoryPlaylistSelection(playlistIndex, itemCount) {
    var selectedIndexes = [];
    var i;

    try {
        for (i = 0; i < itemCount; i++) {
            if (plman.IsPlaylistItemSelected(playlistIndex, i)) {
                selectedIndexes.push(i);
            }
        }
    } catch (e) {
        selectedIndexes = [];
    }

    return selectedIndexes;
}

function restoreHistoryPlaylistSelection(playlistIndex, selectedIndexes, itemCount) {
    var validIndexes = [];
    var i;

    for (i = 0; i < selectedIndexes.length; i++) {
        if (selectedIndexes[i] >= 0 && selectedIndexes[i] < itemCount) {
            validIndexes.push(selectedIndexes[i]);
        }
    }

    try {
        plman.ClearPlaylistSelection(playlistIndex);
        if (validIndexes.length) {
            plman.SetPlaylistSelection(playlistIndex, validIndexes, true);
        }
    } catch (e) {
        // Selection restoration is best-effort only.
    }
}

function historyPlaylistLockedActions(playlistIndex) {
    try {
        if (typeof plman.GetPlaylistLockedActions === 'function') {
            return plman.GetPlaylistLockedActions(playlistIndex) || [];
        }
    } catch (e) { }
    return null;
}

function historyPlaylistBlocksAction(playlistIndex, action) {
    var actions = historyPlaylistLockedActions(playlistIndex);
    if (actions) return actions.indexOf(action) >= 0;
    try {
        return typeof plman.IsPlaylistLocked === 'function' && plman.IsPlaylistLocked(playlistIndex);
    } catch (e) {
        return true;
    }
}

function trimHistoryPlaylist(playlistIndex) {
    var count;
    try {
        count = Number(plman.PlaylistItemCount(playlistIndex));
    } catch (e) {
        return false;
    }
    if (count <= MAX_HISTORY_PLAYLIST_ITEMS) return true;
    if (historyPlaylistBlocksAction(playlistIndex, 'RemoveItems')) return false;

    var originalSelection = captureHistoryPlaylistSelection(playlistIndex, count);
    var itemsToRemove = [];
    for (var i = MAX_HISTORY_PLAYLIST_ITEMS; i < count; i++) itemsToRemove.push(i);

    var removalSucceeded = false;
    try {
        plman.ClearPlaylistSelection(playlistIndex);
        plman.SetPlaylistSelection(playlistIndex, itemsToRemove, true);
        plman.RemovePlaylistSelection(playlistIndex, false);
        removalSucceeded = Number(plman.PlaylistItemCount(playlistIndex)) <= MAX_HISTORY_PLAYLIST_ITEMS;
    } catch (e2) {
        removalSucceeded = false;
    }

    var currentCount = count;
    try { currentCount = Number(plman.PlaylistItemCount(playlistIndex)); } catch (e3) { }
    var restoredSelection = [];
    if (removalSucceeded) {
        for (i = 0; i < originalSelection.length; i++) {
            if (originalSelection[i] < MAX_HISTORY_PLAYLIST_ITEMS) restoredSelection.push(originalSelection[i]);
        }
    } else {
        restoredSelection = originalSelection;
    }
    restoreHistoryPlaylistSelection(playlistIndex, restoredSelection, currentCount);
    return removalSucceeded;
}

function enqueueHistoryPlaylistHandle(handle) {
    if (!handle) return;
    if (historyPlaylistPending.length >= MAX_PENDING_HISTORY_ITEMS) historyPlaylistPending.shift();
    historyPlaylistPending.push(handle);
}

function tryInsertHistoryPlaylistHandle(handle) {
    var playlistIndex = findOrCreateHistoryPlaylist();
    if (playlistIndex < 0 || historyPlaylistBlocksAction(playlistIndex, 'AddItems')) return false;

    try {
        plman.InsertPlaylistItems(playlistIndex, 0, makeHistorySingleHandleList(handle), false);
    } catch (e) {
        return false;
    }

    if (!trimHistoryPlaylist(playlistIndex)) historyPlaylistTrimPending = true;
    else historyPlaylistTrimPending = false;
    return true;
}

function flushHistoryPlaylistPending() {
    if (!historyPlaylistEnabled || historyWriteBusy) return false;
    historyWriteBusy = true;
    try {
        while (historyPlaylistPending.length) {
            if (!tryInsertHistoryPlaylistHandle(historyPlaylistPending[0])) return false;
            historyPlaylistPending.shift();
        }

        if (historyPlaylistTrimPending) {
            var playlistIndex = findOrCreateHistoryPlaylist();
            if (playlistIndex < 0 || !trimHistoryPlaylist(playlistIndex)) return false;
            historyPlaylistTrimPending = false;
        }
        return true;
    } finally {
        historyWriteBusy = false;
    }
}

function addToHistoryPlaylist(handle) {
    if (!historyPlaylistEnabled || !handle) return;
    enqueueHistoryPlaylistHandle(handle);
    flushHistoryPlaylistPending();
}

function finaliseHistoryPlaylistTrack() {
    var completedTrack = historyPlaylistActiveTrack;
    historyPlaylistActiveTrack = null;
    if (!completedTrack || completedTrack.playedSeconds < MINIMUM_CONFIRMED_HISTORY_PLAYBACK_SECONDS) return;
    addToHistoryPlaylist(completedTrack.handle);
}

function handleHistoryPlaylistStop(reason) {
    reason = Number(reason);

    captureFinalHistoryPlaylistProgress(
        reason === HISTORY_STARTING_ANOTHER_TRACK
    );

    // A following on_playback_new_track callback owns transition finalisation.
    if (reason === HISTORY_STARTING_ANOTHER_TRACK) return;

    finaliseHistoryPlaylistTrack();
}

function initialiseHistoryPlaylistTracking() {
    var nowPlaying = null;

    if (!historyPlaylistEnabled || historyPlaylistActiveTrack) return;

    try {
        nowPlaying = fb.GetNowPlaying();
    } catch (e) {
        nowPlaying = null;
    }

    if (nowPlaying) beginHistoryPlaylistTrack(nowPlaying);
}

function on_size(width, height) {
    scheduleLayout(width, height);
}

function on_playlists_changed() {
    flushHistoryPlaylistPending();
}

function on_playback_new_track(handle) {
    if (historyPlaylistEnabled) {
        finaliseHistoryPlaylistTrack();
        beginHistoryPlaylistTrack(handle);
    } else {
        historyPlaylistActiveTrack = null;
    }

    scheduleAccentRefresh();
}

function on_playback_time(time) {
    if (historyPlaylistEnabled) observeHistoryPlaylistPosition(time);
}

function on_playback_seek(time) {
    if (!historyPlaylistEnabled || !historyPlaylistActiveTrack) return;

    time = Number(time);
    if (isFinite(time) && time >= 0) historyPlaylistActiveTrack.lastPosition = time;
}

function on_playback_stop(reason) {
    if (historyPlaylistEnabled) handleHistoryPlaylistStop(reason);
    else historyPlaylistActiveTrack = null;

    // Track-to-track transitions (including foo_skip chains) are followed by
    // on_playback_new_track(). Do not rebuild the theme for an intermediate
    // focused item, and cancel a pending extraction for the outgoing track.
    if (reason === HISTORY_STARTING_ANOTHER_TRACK) {
        cancelScheduledAccentRefresh();
        return;
    }

    cancelScheduledAccentRefresh();
    extractAndBroadcastAccent();
}

function on_item_focus_change(playlistIndex, from, to) {
    scheduleFocusFollowAccent();
}

// Both tab hosts intentionally provide the same shared `tabs` schema; only this host provides `global` and `miniplayer`.
var GLOBAL_SETTINGS_PANEL_ID = 'global';
var GLOBAL_SETTINGS_PANEL_LABEL = 'Global settings';

// Mini Player gets its own top-level RVG Settings sidebar entry rather than
// living as a subtab under Global settings, so it is reachable without
// wading through unrelated global options.
var MINI_PLAYER_SETTINGS_PANEL_ID = 'miniplayer';
var MINI_PLAYER_SETTINGS_PANEL_LABEL = 'Mini Player';

function settingsWithSection(entries, section) {
    var result = [];
    var i, source, copy, key;
    for (i = 0; i < entries.length; i++) {
        source = entries[i] || {};
        copy = {};
        for (key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) copy[key] = source[key];
        }
        copy.section = section;
        result.push(copy);
    }
    return result;
}

function getGlobalSettings() {
    // design_system.js's RVG_RELEASE is the single source of truth for the
    // skin name/author/version. Never re-state those values here.
    var release = RivageUI.release;
    var general = [
        { id: 'rvgRelease', label: release.fullName, type: 'info', section: 'General',
          value: 'Version: ' + release.version + '\nAuthor: ' + release.author },
        { id: 'globalThemeMode', label: 'Global theme', type: 'choice', section: 'General',
          value: globalThemeMode,
          choiceValueType: 'string',
          choices: RivageUI.copy.themeChoices({
              panelDefaults: 'existing',
              host: 'host',
              dark: 'dark',
              light: 'light',
              artworkAuto: 'album-auto',
              artworkDark: 'album-dark',
              artworkLight: 'album-light'
          })
        },
        { id: 'globalAccentMode', label: 'Shared accent source', type: 'choice', section: 'General',
          value: globalAccentMode,
          hidden: !globalThemeUsesConfiguredAccent(),
          hint: 'Used by panels set to Shared accent. Some global themes override this source.',
          choiceValueType: 'string',
          choices: RivageUI.copy.accentChoices({
              artwork: GlobalAccentMode.Album,
              rvgBlue: GlobalAccentMode.Default,
              custom: GlobalAccentMode.Custom
          })
        },
        { id: 'globalAccentEffective', label: 'Shared accent', type: 'info', section: 'General',
          value: effectiveSharedAccentLabel(),
          hidden: globalThemeUsesConfiguredAccent(),
          hint: 'The selected global theme overrides Shared accent source.' },
        { id: 'globalAccentCustomColour', label: 'Custom shared accent', type: 'colour',
          value: globalAccentCustomColour, section: 'General',
          hidden: !globalThemeUsesConfiguredAccent() || globalAccentMode !== GlobalAccentMode.Custom },
        { id: 'historyPlaylistEnabled', label: 'Maintain "> History" playlist', type: 'bool',
          value: historyPlaylistEnabled, section: 'General',
          hint: 'Adds a track after at least 10 seconds of confirmed playback and keeps the newest 200 entries.' },
        { id: 'enableResizingMode', label: 'Allow panel resizing', type: 'bool',
          value: resizingModeEnabled, section: 'General' },
        { id: 'extractionAlgorithm', label: 'Artwork colour extraction', type: 'choice',
          value: extractionAlgorithm, section: 'General',
          choiceValueType: 'string',
          choices: [
              { value: 'material', label: 'Material palette (recommended)' },
              { value: 'legacy', label: 'Legacy colour extractor' }
          ]
        }
    ];

    var lastfm = [
        { id: 'lastfmApiKey', label: 'Last.fm API key', type: 'string', value: lastfmApiKey,
          section: 'General', hint: 'Shared by the Last.fm panel and Last.fm charts panel' },
        { id: 'lastfmUsername', label: 'Last.fm username', type: 'string', value: lastfmUsername,
          section: 'General', hint: 'Shared by the Last.fm panel and Last.fm charts panel' }
    ];

    return general
        .concat(settingsWithSection(PlaybackStatsSource.getSchemaEntries(), 'General'))
        .concat(settingsWithSection(TrackContext.getSchemaEntries(), 'General'))
        .concat(lastfm);
}

function getMiniPlayerPanelSettings() {
    return [
        { id: 'miniPlayerInfo', label: 'Mini Player', type: 'info',
          value: 'Compact-window behaviour and controls. The window size and position are always restored when Mini Player closes; the two policy switches below decide whether always-on-top and the size lock go back too.' },
        { id: 'miniPlayerLockWindowSize', label: 'Lock Mini Player window size', type: 'bool',
          value: miniPlayerSettings.lockWindowSize,
          hint: 'Prevents mouse resizing while compact' },
        { id: 'miniPlayerAlwaysOnTop', label: 'Keep Mini Player always on top', type: 'bool',
          value: miniPlayerSettings.alwaysOnTop,
          hint: 'Applied while compact only' },
        { id: 'miniPlayerRestoreAlwaysOnTop', label: 'Restore previous always-on-top setting', type: 'bool',
          value: miniPlayerSettings.restoreAlwaysOnTop,
          hint: 'On: the normal window goes back to the always-on-top state it had before Mini Player opened. Off: it keeps whatever Mini Player left it in' },
        { id: 'miniPlayerRestoreLockWindowSize', label: 'Restore previous window-size lock', type: 'bool',
          value: miniPlayerSettings.restoreLockWindowSize,
          hint: 'The same choice for View \u203a Lock window size' },
        { id: 'miniPlayerShowMidpointMark', label: 'Show midpoint marker', type: 'bool',
          value: miniPlayerSettings.showMidpointMark,
          hint: 'Mini Player only; the marker style still follows RVG Settings \u203a Seekbar' },
        { id: 'miniPlayerShowLoveButton', label: 'Show Last.fm love button', type: 'bool',
          value: miniPlayerSettings.showLoveButton,
          hint: 'Requires an authorised Last.fm love/unlove context command' },
        { id: 'miniPlayerShowRating', label: 'Show rating stars', type: 'bool',
          value: miniPlayerSettings.showRating,
          hint: 'Uses the playback statistics source selected in RVG Settings \u203a Global settings' }
    ];
}

function applyMiniPlayerSetting(settingId, value) {
    setMiniPlayerSetting(settingId, value);
}

function applyGlobalSetting(settingId, value) {
    if (settingId === 'globalThemeMode') {
        setGlobalThemeMode(value);
        return;
    }
    if (settingId === 'globalAccentMode') {
        setGlobalAccentMode(value);
        return;
    }
    if (settingId === 'globalAccentCustomColour') {
        setGlobalAccentCustomColour(Number(value) || 0);
        return;
    }
    if (settingId === 'historyPlaylistEnabled') {
        setHistoryPlaylistEnabled(!!value);
        return;
    }
    if (settingId === 'enableResizingMode') {
        setResizingModeEnabled(!!value);
        return;
    }
    if (settingId === 'lastfmApiKey') {
        setLastfmCredentials(value, lastfmUsername);
        return;
    }
    if (settingId === 'lastfmUsername') {
        setLastfmCredentials(lastfmApiKey, value);
        return;
    }
    if (settingId === 'extractionAlgorithm') {
        setExtractionAlgorithm(value);
        return;
    }
    if (settingId === 'trackContextMode') {
        TrackContext.applySetting(settingId, value);
        TrackContext.broadcast();
        return;
    }
    PlaybackStatsSource.applySetting(settingId, value);
}

function on_notify_data(name, info) {
    SettingsRegistry.provide(name, info, TabBarStyle.PANEL_ID, TabBarStyle.PANEL_LABEL, TabBarStyle.getSchema);
    SettingsRegistry.provide(name, info, GLOBAL_SETTINGS_PANEL_ID, GLOBAL_SETTINGS_PANEL_LABEL, getGlobalSettings);
    SettingsRegistry.provide(name, info, MINI_PLAYER_SETTINGS_PANEL_ID, MINI_PLAYER_SETTINGS_PANEL_LABEL, getMiniPlayerPanelSettings);
    if (SettingsRegistry.consume(name, info, TabBarStyle.PANEL_ID, TabBarStyle.applySetting)) return;
    if (SettingsRegistry.consume(name, info, GLOBAL_SETTINGS_PANEL_ID, applyGlobalSetting)) return;
    if (SettingsRegistry.consume(name, info, MINI_PLAYER_SETTINGS_PANEL_ID, applyMiniPlayerSetting)) return;
    if (TabBarStyle.onNotifyData(name, info)) return;
    if (PlaybackStatsSource.onNotifyData(name, info, true)) return;
    if (TrackContext.onNotifyData(name, info, true)) return;

    if (ResizingModeProtocol.consumeSet(name, info, setResizingModeEnabled)) return;
    if (ResizingModeProtocol.isRequest(name)) {
        ResizingModeProtocol.broadcast(resizingModeEnabled);
        return;
    }
    if (ResizingModeProtocol.consume(name, info, adoptResizingMode)) return;

    if (MiniPlayerProtocol.isSettingsRequest(name)) {
        MiniPlayerProtocol.broadcastSettings(miniPlayerSettings);
        return;
    }

    if (LastfmCredentialsProtocol.isRequest(name)) {
        LastfmCredentialsProtocol.broadcast({ apiKey: lastfmApiKey, username: lastfmUsername });
        return;
    }

    if (name === SHARED_ALBUM_ACCENT_REQUEST) {
        SharedAccentProtocol.broadcast(sharedAlbumAccent);
        return;
    }
    if (name === SHARED_RIVAGE_THEME_REQUEST) {
        SharedThemeProtocol.broadcast(publishedThemePayload);
        return;
    }
    if (name === UWP_TABS_SELECT) {
        if (typeof info !== 'string' && (typeof info !== 'number' || !isFinite(info))) return;
        var requestedIndex = findTabIndex(info);
        if (requestedIndex >= 0) selectTab(requestedIndex);
        return;
    }

    if (name === UWP_TABS_QUERY) {
        broadcastActiveTab();
    }
}

function on_colours_changed() {
    if (globalThemeMode === 'host') {
        republishAccent();
        return;
    }
    refreshRootTheme();
    window.Repaint(true);
}

function on_font_changed() {
    rebuildTabFont();
    window.Repaint(true);
}

function initialiseTabs() {
    if (!scriptActive) return;
    panelWidth = Math.max(0, Math.floor(Number(window.Width)) || 0);
    panelHeight = Math.max(0, Math.floor(Number(window.Height)) || 0);
    extractAndBroadcastAccent();

    if (!scanChildPanels()) {
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
PlaybackStatsSource.broadcast();
TrackContext.broadcast();
ResizingModeProtocol.broadcast(resizingModeEnabled);
MiniPlayerProtocol.broadcastSettings(miniPlayerSettings);
LastfmCredentialsProtocol.broadcast({ apiKey: lastfmApiKey, username: lastfmUsername });
initialiseHistoryPlaylistTracking();

function on_script_unload() {
    scriptActive = false;
    var timers = [childRefreshTimer, layoutTimer, startupTimer, accentSettleTimer, focusFollowTimer];
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
    accentSettleTimer = null;
    focusFollowTimer = null;
    childWatchTimer = null;
    childRefreshPending = false;
    layoutRequestPending = false;
    if (activePersistenceDirty) persistActiveTab();
    if (tabIdOwnersDirty) persistTabIdOwners();
}

try {
    startupTimer = window.SetTimeout(function () {
        startupTimer = null;
        initialiseTabs();
    }, 0);
} catch (e) {
    startupTimer = null;
    requestChildRefresh(true);
}

// Same-count caption/order changes do not emit a JS callback. Poll only metadata while visible.
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
        if (childRefreshNeeded) scheduleChildRefresh();
        else if (layoutNeeded && !layoutRequestPending) scheduleLayout(panelWidth, panelHeight);
        if (activePersistenceDirty) persistActiveTab();
        if (tabIdOwnersDirty) persistTabIdOwners();
    }, CHILD_WATCH_INTERVAL);
} catch (e) {
    childWatchTimer = null;
}
