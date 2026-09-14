window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\lastfm_credentials_protocol.js');

var SCRIPT_VERSION = '1.11.0';
window.DefineScript(RivageUI.copy.popupTitle('Last.fm charts'), { author: 'RivaGe', version: SCRIPT_VERSION, features: { drag_n_drop: false } });

var DT_LEFT = 0x00000000;
var DT_RIGHT = 0x00000002;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var MF_STRING = 0x00000000;
var MF_SEPARATOR = 0x00000800;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var MK_SHIFT = 0x0004;
var PLAYBACK_STOP_STARTING_ANOTHER = 2;

var PROP = 'lastfm_charts.';
var LASTFM_ROOT = 'https://ws.audioscrobbler.com/2.0/';
var LASTFM_USER_AGENT = 'foo_jsplitter_rvg_lastfm_charts/' + SCRIPT_VERSION;
var CACHE_DIR = fb.ProfilePath + 'jsplitter_lastfm_charts_cache\\';
var CACHE_FILE = CACHE_DIR + 'api_responses_v1.json';
var CACHE_VERSION = 1;
var CACHE_MAX_ENTRIES = 80;
var CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function trimText(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function normaliseInteger(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function formatNumber(value) {
    var n = Number(String(value == null ? '' : value).replace(/\s/g, ''));
    if (!isFinite(n) || n <= 0) return '';
    return String(Math.round(n)).replace(/(\d)(?=(\d{3})+$)/g, '$1 ');
}

function numberFromTitleFormatValue(value) {
    var text = trimText(value);
    var n;
    if (!text || text === '?') return 0;
    n = Number(text.replace(/[^0-9.\-]/g, ''));
    return isFinite(n) && n > 0 ? n : 0;
}

function abbreviateNumber(value) {
    var n = Number(String(value == null ? '' : value).replace(/\s/g, ''));
    if (!isFinite(n) || n <= 0) return '';
    if (n >= 1000000000) return (n / 1000000000).toFixed(2) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
    return formatNumber(n);
}

function arrOf(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function safeJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
}

function normalizeName(value) {
    return trimText(value).toLowerCase().replace(/\s+/g, ' ');
}

function sameArtist(a, b) {
    return normalizeName(a) === normalizeName(b);
}

function encodeUrlPart(value) {
    return encodeURIComponent(String(value || '')).replace(/%20/g, '+');
}

function artistUrl(artist) {
    return 'https://www.last.fm/music/' + encodeUrlPart(artist);
}

function trackUrl(artist, track) {
    return artistUrl(artist) + '/_/' + encodeUrlPart(track);
}

function albumUrl(artist, album) {
    return artistUrl(artist) + '/' + encodeUrlPart(album);
}

function artistFromObject(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value.name || value['#text'] || '';
}

var g_dpi = 100;
function zoom(value, percent) {
    return Math.round(value * (percent || 100) / 100);
}
function _scale(value) {
    return zoom(value, g_dpi);
}

var FONT_STYLE_BOLD = 1;
var font_name = 'Segoe UI';
var FONT_SIZE = 13;
var f_eyebrow = null;
var f_body = null;
var f_body_bold = null;
var f_title = null;
var f_headline = null;
var f_small = null;

function makeFont(points, bold) {
    return RivageUI.font(font_name, zoom(points, g_dpi), bold ? FONT_STYLE_BOLD : 0);
}

function update_fonts() {
    var host = RivageUI.hostInfo();
    var scale_size = Number(host.scaleFontSize) || 12;

    font_name = host.fontFamily || 'Segoe UI';
    g_dpi = (isFinite(scale_size) && scale_size > 0)
        ? Math.max(50, Math.round(scale_size / 12 * 100))
        : 100;

    RivageUI.clearFontCache();
    f_eyebrow = makeFont(Math.max(8, FONT_SIZE - 2), true);
    f_small = makeFont(Math.max(8, FONT_SIZE - 1), false);
    f_body = makeFont(FONT_SIZE, false);
    f_body_bold = makeFont(FONT_SIZE, true);
    f_title = makeFont(FONT_SIZE + 2, true);
    f_headline = makeFont(FONT_SIZE + 5, true);
}

function textWidth(text, font) {
    return RivageUI.measureText(String(text == null ? '' : text), font, false);
}

var AccentMode = { Default: 'default', AlbumArt: 'albumart' };
var opt_accent_mode = window.GetProperty(PROP + 'accent_mode', AccentMode.AlbumArt);
var sharedAlbumAccent = RivageUI.DEFAULT_ACCENT;
var UI_ACCENT = RivageUI.DEFAULT_ACCENT;
var ui_theme = RivageUI.createTheme({ mode: 'host', accent: UI_ACCENT });
var ui = RivageUI.createPainter({ scale: _scale, theme: ui_theme });

function currentAccent() {
    if (opt_accent_mode === AccentMode.AlbumArt) return SharedAccentProtocol.opaque(sharedAlbumAccent);
    return RivageUI.opaque(UI_ACCENT);
}

function update_colours() {
    var host = RivageUI.hostInfo();
    UI_ACCENT = host.accent;
    ui_theme = RivageUI.createTheme({
        mode: 'host',
        host: host,
        background: host.background,
        text: host.text,
        accent: currentAccent()
    });
    ui.setTheme(ui_theme);
}

function setAccentMode(mode) {
    if (mode !== AccentMode.AlbumArt) mode = AccentMode.Default;
    if (mode === opt_accent_mode) return;
    window.SetProperty(PROP + 'accent_mode', mode);
    opt_accent_mode = mode;
    if (mode === AccentMode.AlbumArt) SharedAccentProtocol.requestAccent();
    update_colours();
    window.Repaint(true);
}

var FollowMode = { OnlyStopped: 0, Always: 1 };
var ChartType = { Songs: 'songs', Albums: 'albums' };
var API_KEY = '';
var opt_username = '';
var legacy_follow = window.GetProperty(PROP + 'follow_mode', FollowMode.OnlyStopped);
var opt_track_context = TrackContext.normaliseOverride(window.GetProperty(PROP + 'track_context_override', ''));
if (window.GetProperty(PROP + 'track_context_override', '') === '') {
    opt_track_context = legacy_follow === FollowMode.Always ? TrackContext.MODE_SELECTION : TrackContext.MODE_GLOBAL;
    window.SetProperty(PROP + 'track_context_override', opt_track_context);
}
var opt_chart_type = window.GetProperty(PROP + 'chart_type', ChartType.Songs);
var opt_period = window.GetProperty(PROP + 'period', 'overall');
var opt_row_limit = normaliseInteger(window.GetProperty(PROP + 'row_limit', 10), 4, 25, 10);
var opt_user_depth = normaliseInteger(window.GetProperty(PROP + 'user_depth', 500), 100, 2000, 500);
var opt_cache_hours = normaliseInteger(window.GetProperty(PROP + 'cache_hours', 6), 1, 168, 6);
// Local lifetime play-count tags cannot represent shorter Last.fm periods.
var opt_local_overall_chart = window.GetProperty(PROP + 'local_overall_chart', true);

var PERIODS = [
    { id: '7day', label: '7 days', short: '7d' },
    { id: '1month', label: '1 month', short: '1mo' },
    { id: '3month', label: '3 months', short: '3mo' },
    { id: '6month', label: '6 months', short: '6mo' },
    { id: '12month', label: '12 months', short: '1yr' },
    { id: 'overall', label: 'All time', short: 'All' }
];

function periodLabel(id) {
    for (var i = 0; i < PERIODS.length; i++) {
        if (PERIODS[i].id === id) return PERIODS[i].label;
    }
    return 'All time';
}

function validPeriod(id) {
    for (var i = 0; i < PERIODS.length; i++) {
        if (PERIODS[i].id === id) return id;
    }
    return 'overall';
}

function validChartType(id) {
    return id === ChartType.Albums ? ChartType.Albums : ChartType.Songs;
}

opt_period = validPeriod(opt_period);
opt_chart_type = validChartType(opt_chart_type);

var cacheSaveTimer = null;

function emptyApiCacheStore() {
    return { version: CACHE_VERSION, entries: {} };
}

function pruneApiCacheStore(store) {
    var entries = store && store.entries ? store.entries : {};
    var now = Date.now();
    var ordered = [];
    var key, entry, savedAt;

    for (key in entries) {
        if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
        entry = entries[key];
        savedAt = Number(entry && entry.savedAt) || 0;
        if (!entry || !entry.data || !savedAt || now - savedAt > CACHE_MAX_AGE_MS) {
            delete entries[key];
            continue;
        }
        ordered.push({ key: key, savedAt: savedAt });
    }

    ordered.sort(function (a, b) { return a.savedAt - b.savedAt; });
    while (ordered.length > CACHE_MAX_ENTRIES) {
        delete entries[ordered.shift().key];
    }
    store.entries = entries;
    return store;
}

function loadApiCacheStore() {
    var data;
    try {
        if (!utils.IsFile(CACHE_FILE)) return emptyApiCacheStore();
        data = safeJson(utils.ReadTextFile(CACHE_FILE, 65001));
        if (!data || Number(data.version) !== CACHE_VERSION || !data.entries) return emptyApiCacheStore();
        return pruneApiCacheStore(data);
    } catch (e) {
        return emptyApiCacheStore();
    }
}

var apiCache = loadApiCacheStore();

var CACHE_SAVE_DEBOUNCE_MS = 20000;
var apiCacheDirty = false;

function saveApiCacheNow() {
    var written;
    if (cacheSaveTimer) {
        window.ClearTimeout(cacheSaveTimer);
        cacheSaveTimer = null;
    }
    if (!apiCacheDirty) return;
    try {
        utils.CreateFolder(CACHE_DIR);
        pruneApiCacheStore(apiCache);
        written = utils.WriteTextFile(CACHE_FILE, JSON.stringify(apiCache), false);
        if (written === false) throw new Error('WriteTextFile returned false');
        apiCacheDirty = false;
    } catch (e) {
        console.log('Last.fm Charts: cache write failed: ' + e);
    }
}

function scheduleApiCacheSave() {
    apiCacheDirty = true;
    // Do not re-arm: the first dirty write starts the clock so steady traffic
    // cannot postpone persistence forever.
    if (cacheSaveTimer) return;
    cacheSaveTimer = window.SetTimeout(function () {
        cacheSaveTimer = null;
        saveApiCacheNow();
    }, CACHE_SAVE_DEBOUNCE_MS);
}

function apiRequestCacheKey(method, params) {
    var keys = [];
    var parts = [String(method || '').toLowerCase()];
    var key;
    params = params || {};
    for (key in params) {
        if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
        if (params[key] === undefined || params[key] === null || params[key] === '') continue;
        keys.push(key);
    }
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
        key = keys[i];
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    }
    return parts.join('&');
}

function cachedApiData(cacheKey, allowExpired) {
    var entry = apiCache.entries[cacheKey];
    var age;
    if (!entry || !entry.data || !Number(entry.savedAt)) return null;
    age = Math.max(0, Date.now() - Number(entry.savedAt));
    if (!allowExpired && age >= opt_cache_hours * 60 * 60 * 1000) return null;
    return entry.data;
}

function storeApiData(cacheKey, data) {
    if (!cacheKey || !data) return;
    apiCache.entries[cacheKey] = { savedAt: Date.now(), data: data };
    scheduleApiCacheSave();
}

// Trims a Last.fm API response to only the fields handleLastfmJson's parsers
// below actually read - name/artist/playcount/listeners/url per item, plus
// @attr.totalPages for the paginated "my" charts. A raw response also carries
// a 4-URL image array, mbid, streamable and duration per item; on a 500-1000
// item user.getTopTracks/getTopAlbums page that's most of what got
// JSON.stringify'd and written to disk on every newly-scanned artist. Returns
// the same {toptracks:{track:[...],'@attr':...}} / {topalbums:{album:...}}
// shape the parsers expect, so nothing downstream (handleLastfmJson,
// useCachedFallback, parseGlobalTracks/Albums, pushUser*Rows,
// continueUserFetch) needs to change.
function reduceLastfmPayload(kind, json) {
    var isTracks = kind === 'globalTracks' || kind === 'myTracksPage';
    var root = json && (isTracks ? json.toptracks : json.topalbums);
    var items, reducedItems, reducedRoot, result, i, item;

    if (!root) return json;

    items = arrOf(isTracks ? root.track : root.album);
    reducedItems = [];
    for (i = 0; i < items.length; i++) {
        item = items[i] || {};
        reducedItems.push({
            name: item.name,
            listeners: item.listeners,
            playcount: item.playcount,
            url: item.url,
            artist: typeof item.artist === 'string' ? item.artist : { name: artistFromObject(item.artist) }
        });
    }

    reducedRoot = {};
    reducedRoot[isTracks ? 'track' : 'album'] = reducedItems;
    if (root['@attr']) reducedRoot['@attr'] = { totalPages: root['@attr'].totalPages };

    result = {};
    result[isTracks ? 'toptracks' : 'topalbums'] = reducedRoot;
    return result;
}

function clearApiCache() {
    apiCache = emptyApiCacheStore();
    apiCacheDirty = true;
    saveApiCacheNow();
}

var currentArtist = '';
var fetchToken = 0;
var refreshTimer = null;
var taskContexts = {};
var lastFetchKey = '';

function emptySection() {
    return { loading: false, error: '', rows: [] };
}

var sections = {
    globalTracks: emptySection(),
    globalAlbums: emptySection(),
    myTracks: emptySection(),
    myAlbums: emptySection()
};

function beginSection(key) {
    cancelPressedAction();
    sections[key] = { loading: true, error: '', rows: [] };
}

function finishSection(key, rows) {
    cancelPressedAction();
    sections[key] = { loading: false, error: '', rows: rows || [] };
    window.Repaint();
}

function failSection(key, message) {
    cancelPressedAction();
    sections[key] = { loading: false, error: message || 'Request failed', rows: [] };
    window.Repaint();
}

function resetSectionsLoading() {
    beginSection('globalTracks');
    beginSection('globalAlbums');
    beginSection('myTracks');
    beginSection('myAlbums');
}

var tf_artist = fb.TitleFormat('$if2(%artist%,%album artist%)');
var tf_title = fb.TitleFormat('%title%');
var tf_local_album = fb.TitleFormat('%album%');
var tf_local_lastfm_plays = fb.TitleFormat('$if2(%lastfm_play_count%,$if2(%lastfm_playcount%,$if2(%scrobbled%,$if2(%last.fm scrobbled%,))))');

function readHandle(handle) {
    var artist = '';
    if (!handle) return false;
    try {
        artist = trimText(tf_artist.EvalWithMetadb(handle));
    } catch (e) {
        artist = '';
    }
    if (!artist || artist === '?') return false;
    currentArtist = artist;
    return true;
}

function followSelectionNow() {
    return TrackContext.followsSelection(opt_track_context);
}

// Hidden JSplitter children remain loaded; defer network work until paint.
var pendingRefresh = false;
var pendingRefreshForce = false;

function panelIsVisible() {
    try {
        return window.IsVisible !== false;
    } catch (e) {
        return true;
    }
}

function runPendingRefresh() {
    if (!pendingRefresh) return;
    var force = pendingRefreshForce;
    pendingRefresh = false;
    pendingRefreshForce = false;
    scheduleRefresh(force);
}

function scheduleRefresh(forceNetwork) {
    if (refreshTimer) {
        window.ClearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (!panelIsVisible()) {
        pendingRefresh = true;
        if (forceNetwork) pendingRefreshForce = true;
        return;
    }
    refreshTimer = window.SetTimeout(function () {
        refreshTimer = null;
        if (!panelIsVisible()) {
            pendingRefresh = true;
            if (forceNetwork) pendingRefreshForce = true;
            return;
        }
        refreshCurrentArtist(!!forceNetwork);
    }, 250);
}

function refreshCurrentArtist(forceNetwork) {
    var handle = TrackContext.getHandle(opt_track_context);

    if (!readHandle(handle)) {
        currentArtist = '';
        lastFetchKey = '';
        taskContexts = {};
        fetchToken++;
        cancelPressedAction();
        sections.globalTracks = emptySection();
        sections.globalAlbums = emptySection();
        sections.myTracks = emptySection();
        sections.myAlbums = emptySection();
        window.Repaint();
        return;
    }

    var key = [API_KEY, opt_username, currentArtist, opt_period, opt_row_limit, opt_user_depth, opt_cache_hours, opt_local_overall_chart].join('|');
    if (!forceNetwork && key === lastFetchKey) {
        window.Repaint();
        return;
    }

    lastFetchKey = key;
    fetchChartsForCurrentArtist(!!forceNetwork);
}

function buildLastfmUrl(method, params) {
    var url = LASTFM_ROOT + '?format=json&api_key=' + encodeURIComponent(API_KEY) + '&method=' + encodeURIComponent(method);
    var key;
    for (key in params) {
        if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
        if (params[key] === undefined || params[key] === null || params[key] === '') continue;
        url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }
    url += '&_=' + Math.random();
    return url;
}

function useCachedFallback(context) {
    var cached = context && context.apiCacheKey
        ? cachedApiData(context.apiCacheKey, true)
        : null;
    if (!cached) return false;
    handleLastfmJson(context, cached);
    return true;
}

function requestLastfm(context, method, params) {
    var url, taskId, headers, cached;
    context.method = method;
    context.params = params;
    context.apiCacheKey = apiRequestCacheKey(method, params);

    if (!context.forceNetwork) {
        cached = cachedApiData(context.apiCacheKey, false);
        if (cached) {
            handleLastfmJson(context, cached);
            return;
        }
    }

    if (!API_KEY) {
        if (!useCachedFallback(context)) failSection(context.section, 'Set a Last.fm API key.');
        return;
    }

    url = buildLastfmUrl(method, params);
    headers = JSON.stringify({ 'User-Agent': LASTFM_USER_AGENT, 'Accept': 'application/json' });
    try {
        taskId = utils.HTTPRequestAsync(0, url, headers);
        taskContexts[String(taskId)] = context;
    } catch (e) {
        if (!useCachedFallback(context)) failSection(context.section, 'Could not start request.');
    }
}

function localOverallChartActive() {
    return !!opt_local_overall_chart && opt_period === 'overall';
}

function resolveLocalChartHandles() {
    var resolved;
    try {
        resolved = RivageLibraryResolver.resolve({ type: 'artist', artist: currentArtist });
    } catch (e) {
        resolved = null;
    }
    return resolved ? RivageLibraryResolver.listToArray(resolved.all) : [];
}

function buildLocalCharts(handles) {
    var i, handle, title, album, plays, trackKey, albumKey;
    var trackTotals = {};
    var albumTotals = {};
    var trackRows = [];
    var albumRows = [];
    var k, t, sum;

    handles = handles || [];

    for (i = 0; i < handles.length; i++) {
        handle = handles[i];
        plays = 0;
        try { plays = numberFromTitleFormatValue(tf_local_lastfm_plays.EvalWithMetadb(handle)); } catch (ePlays) { plays = 0; }
        if (!plays) continue;

        title = '';
        try { title = trimText(tf_title.EvalWithMetadb(handle)); } catch (eTitle) { title = ''; }
        if (!title) continue;
        trackKey = title.toLowerCase();

        // Duplicate local files commonly share one account-wide playcount.
        if (!trackTotals[trackKey] || plays > trackTotals[trackKey].count) {
            trackTotals[trackKey] = { title: title, count: plays, url: trackUrl(currentArtist, title) };
        }

        album = '';
        try { album = trimText(tf_local_album.EvalWithMetadb(handle)); } catch (eAlbum) { album = ''; }
        if (!album) continue;
        albumKey = album.toLowerCase();
        if (!albumTotals[albumKey]) albumTotals[albumKey] = { title: album, url: albumUrl(currentArtist, album), tracks: {} };
        if (!albumTotals[albumKey].tracks[trackKey] || plays > albumTotals[albumKey].tracks[trackKey]) {
            albumTotals[albumKey].tracks[trackKey] = plays;
        }
    }

    for (k in trackTotals) {
        if (Object.prototype.hasOwnProperty.call(trackTotals, k)) trackRows.push(trackTotals[k]);
    }
    for (k in albumTotals) {
        if (!Object.prototype.hasOwnProperty.call(albumTotals, k)) continue;
        sum = 0;
        for (t in albumTotals[k].tracks) {
            if (Object.prototype.hasOwnProperty.call(albumTotals[k].tracks, t)) sum += albumTotals[k].tracks[t];
        }
        albumRows.push({ title: albumTotals[k].title, count: sum, url: albumTotals[k].url });
    }

    trackRows.sort(function (a, b) { return b.count - a.count; });
    albumRows.sort(function (a, b) { return b.count - a.count; });
    trackRows = trackRows.slice(0, opt_row_limit);
    albumRows = albumRows.slice(0, opt_row_limit);
    for (i = 0; i < trackRows.length; i++) {
        trackRows[i] = { title: trackRows[i].title, count: abbreviateNumber(trackRows[i].count), url: trackRows[i].url };
    }
    for (i = 0; i < albumRows.length; i++) {
        albumRows[i] = { title: albumRows[i].title, count: abbreviateNumber(albumRows[i].count), url: albumRows[i].url };
    }
    return { tracks: trackRows, albums: albumRows };
}

function fetchChartsForCurrentArtist(forceNetwork) {
    var token;
    var pageSize = Math.min(200, opt_user_depth);
    fetchToken++;
    token = fetchToken;
    taskContexts = {};
    resetSectionsLoading();
    window.Repaint();

    if (!currentArtist) return;

    requestLastfm({
        token: token,
        section: 'globalTracks',
        kind: 'globalTracks',
        forceNetwork: forceNetwork
    }, 'artist.getTopTracks', {
        artist: currentArtist,
        autocorrect: 1,
        limit: opt_row_limit
    });

    requestLastfm({
        token: token,
        section: 'globalAlbums',
        kind: 'globalAlbums',
        forceNetwork: forceNetwork
    }, 'artist.getTopAlbums', {
        artist: currentArtist,
        autocorrect: 1,
        limit: opt_row_limit
    });

    if (localOverallChartActive()) {
        var localHandles = resolveLocalChartHandles();
        var localCharts = buildLocalCharts(localHandles);
        finishSection('myTracks', localCharts.tracks);
        finishSection('myAlbums', localCharts.albums);
        return;
    }

    if (!opt_username) {
        failSection('myTracks', 'Set a Last.fm username.');
        failSection('myAlbums', 'Set a Last.fm username.');
        return;
    }

    requestLastfm({
        token: token,
        section: 'myTracks',
        kind: 'myTracksPage',
        page: 1,
        pageSize: pageSize,
        rows: [],
        forceNetwork: forceNetwork
    }, 'user.getTopTracks', {
        user: opt_username,
        period: opt_period,
        limit: pageSize,
        page: 1
    });

    requestLastfm({
        token: token,
        section: 'myAlbums',
        kind: 'myAlbumsPage',
        page: 1,
        pageSize: pageSize,
        rows: [],
        forceNetwork: forceNetwork
    }, 'user.getTopAlbums', {
        user: opt_username,
        period: opt_period,
        limit: pageSize,
        page: 1
    });
}

function parseGlobalTracks(json) {
    var result = [];
    // Last.fm returns artist.getTopTracks by listeners; this chart is by plays.
    var items = arrOf(json && json.toptracks && json.toptracks.track).slice();
    items.sort(function (a, b) {
        return Number((b && b.playcount) || 0) - Number((a && a.playcount) || 0);
    });
    var i, item;
    for (i = 0; i < items.length && result.length < opt_row_limit; i++) {
        item = items[i] || {};
        if (!item.name) continue;
        result.push({
            title: item.name,
            listeners: abbreviateNumber(item.listeners),
            plays: abbreviateNumber(item.playcount),
            url: item.url || trackUrl(currentArtist, item.name)
        });
    }
    return result;
}

function parseGlobalAlbums(json) {
    var result = [];
    var items = arrOf(json && json.topalbums && json.topalbums.album);
    var i, item;
    for (i = 0; i < items.length && result.length < opt_row_limit; i++) {
        item = items[i] || {};
        if (!item.name) continue;
        result.push({
            title: item.name,
            listeners: abbreviateNumber(item.listeners),
            plays: abbreviateNumber(item.playcount),
            url: item.url || albumUrl(currentArtist, item.name)
        });
    }
    return result;
}

function userPageItemLimit(ctx, itemCount) {
    var scannedBefore = Math.max(0, (ctx.page - 1) * ctx.pageSize);
    var remaining = Math.max(0, opt_user_depth - scannedBefore);
    return Math.min(Math.max(0, itemCount), remaining);
}

function pushUserTrackRows(ctx, json) {
    var items = arrOf(json && json.toptracks && json.toptracks.track);
    var itemLimit = userPageItemLimit(ctx, items.length);
    var i, item, artist;
    ctx.lastPageItems = itemLimit;
    ctx.lastPageRawItems = items.length;
    for (i = 0; i < itemLimit && ctx.rows.length < opt_row_limit; i++) {
        item = items[i] || {};
        artist = artistFromObject(item.artist);
        if (!item.name || !sameArtist(artist, currentArtist)) continue;
        ctx.rows.push({
            title: item.name,
            count: abbreviateNumber(item.playcount),
            url: item.url || trackUrl(artist || currentArtist, item.name)
        });
    }
}

function pushUserAlbumRows(ctx, json) {
    var items = arrOf(json && json.topalbums && json.topalbums.album);
    var itemLimit = userPageItemLimit(ctx, items.length);
    var i, item, artist;
    ctx.lastPageItems = itemLimit;
    ctx.lastPageRawItems = items.length;
    for (i = 0; i < itemLimit && ctx.rows.length < opt_row_limit; i++) {
        item = items[i] || {};
        artist = artistFromObject(item.artist);
        if (!item.name || !sameArtist(artist, currentArtist)) continue;
        ctx.rows.push({
            title: item.name,
            count: abbreviateNumber(item.playcount),
            url: item.url || albumUrl(artist || currentArtist, item.name)
        });
    }
}

function continueUserFetch(ctx, json, method) {
    var root = ctx.kind === 'myTracksPage' ? json.toptracks : json.topalbums;
    var attr = root && root['@attr'] ? root['@attr'] : {};
    var totalPages = Number(attr.totalPages || 0);
    var scanned = Math.min((ctx.page - 1) * ctx.pageSize + Number(ctx.lastPageItems || 0), opt_user_depth);
    var more = ctx.rows.length < opt_row_limit && scanned < opt_user_depth;

    if (totalPages > 0 && ctx.page >= totalPages) more = false;
    if (Number(ctx.lastPageRawItems || 0) < ctx.pageSize) more = false;

    if (more) {
        ctx.page++;
        requestLastfm(ctx, method, {
            user: opt_username,
            period: opt_period,
            limit: ctx.pageSize,
            page: ctx.page
        });
        return;
    }

    finishSection(ctx.section, ctx.rows);
}

function handleLastfmJson(ctx, json) {
    if (!ctx || ctx.token !== fetchToken) return;
    if (!json) {
        failSection(ctx.section, 'Invalid JSON response');
        return;
    }
    if (json.error) {
        failSection(ctx.section, json.message || ('Last.fm error ' + json.error));
        return;
    }

    if (ctx.kind === 'globalTracks') {
        finishSection(ctx.section, parseGlobalTracks(json));
    } else if (ctx.kind === 'globalAlbums') {
        finishSection(ctx.section, parseGlobalAlbums(json));
    } else if (ctx.kind === 'myTracksPage') {
        pushUserTrackRows(ctx, json);
        continueUserFetch(ctx, json, 'user.getTopTracks');
    } else if (ctx.kind === 'myAlbumsPage') {
        pushUserAlbumRows(ctx, json);
        continueUserFetch(ctx, json, 'user.getTopAlbums');
    }
}

function on_http_request_done(taskId, success, responseText, status) {
    var ctx = taskContexts[String(taskId)];
    var json, message, httpStatus;
    if (!ctx) return;
    delete taskContexts[String(taskId)];

    if (ctx.token !== fetchToken) return;

    httpStatus = Number(status) || 0;
    if (!success || httpStatus < 200 || httpStatus >= 300) {
        message = httpStatus ? 'HTTP ' + httpStatus : 'Request failed';
        if (!useCachedFallback(ctx)) failSection(ctx.section, message);
        return;
    }

    json = safeJson(responseText);
    if (!json || json.error) {
        if (useCachedFallback(ctx)) return;
        if (!json) failSection(ctx.section, 'Invalid JSON response');
        else failSection(ctx.section, json.message || ('Last.fm error ' + json.error));
        return;
    }

    storeApiData(ctx.apiCacheKey, reduceLastfmPayload(ctx.kind, json));
    handleLastfmJson(ctx, json);
}

var ww = 0;
var wh = 0;
var hits = [];
var hoverId = '';
var downId = '';
var downActionKey = '';

var CHART_TYPES = [
    { id: ChartType.Songs, label: 'Tracks' },
    { id: ChartType.Albums, label: 'Albums' }
];

function hitId(kind, key, index) {
    return kind + ':' + key + ':' + index;
}

function addHit(id, kind, rect, data, meta) {
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    if (rect.y + rect.h < 0 || rect.y > wh) return;
    if (meta && !meta.url && kind === 'url') meta.url = data;
    hits.push({ id: id, kind: kind, x: rect.x, y: rect.y, w: rect.w, h: rect.h, data: data, meta: meta || null });
}

function chartRowMeta(key, row) {
    if (!row) return null;
    if (key === 'globalAlbums' || key === 'myAlbums') return { type: 'album', artist: currentArtist, album: row.title, url: row.url };
    if (key === 'globalTracks' || key === 'myTracks') return { type: 'track', artist: currentArtist, title: row.title, url: row.url };
    return null;
}

function hitAt(x, y) {
    var i, hit;
    for (i = hits.length - 1; i >= 0; i--) {
        hit = hits[i];
        if (x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h) return hit;
    }
    return null;
}

function drawText(gr, text, font, colour, x, y, w, h, flags) {
    if (!gr || !font || w <= 0 || h <= 0) return;
    gr.GdiDrawText(String(text == null ? '' : text), font, colour, x, y, w, h, flags);
}

function drawEmptyCard(gr, x, y, w, maxH, title, body) {
    var desired = _scale(122);
    var bounded = maxH > 0 ? maxH : desired;
    var h = Math.max(1, Math.min(desired, bounded));
    var inset = _scale(18);
    ui.card(gr, { x: x, y: y, w: w, h: h }, {
        accent: true,
        accentColour: currentAccent(),
        accentEdge: 'left',
        fill: ui_theme.card
    });
    drawText(gr, title, f_title, ui_theme.textPrimary, x + inset, y + _scale(17), w - inset * 2, _scale(25), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    if (h >= _scale(86)) {
        drawText(gr, body, f_body, ui_theme.textMuted, x + inset, y + _scale(50), w - inset * 2, Math.max(_scale(24), h - _scale(62)), DT_LEFT | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS);
    }
    return h;
}

function chipItemWidth(label, font, minimum) {
    return Math.max(minimum, textWidth(label, font) + _scale(24));
}

function chipGroupWidth(items, font, minimum, gap) {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
        if (i) total += gap;
        total += chipItemWidth(items[i].label, font, minimum);
    }
    return total;
}

function layoutChipGroup(items, font, minimum, x, y, maxX, chipH, gapX, gapY) {
    var layout = [];
    var cx = x;
    var cy = y;
    var width;
    for (var i = 0; i < items.length; i++) {
        width = Math.min(Math.max(_scale(24), maxX - x), chipItemWidth(items[i].label, font, minimum));
        if (cx > x && cx + width > maxX) {
            cx = x;
            cy += chipH + gapY;
        }
        layout.push({ item: items[i], x: cx, y: cy, w: width, h: chipH });
        cx += width + gapX;
    }
    return {
        items: layout,
        height: layout.length ? (cy - y) + chipH : 0,
        endX: layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w : x
    };
}

function drawChipGroup(gr, layout, selectedId, kind) {
    var accent = currentAccent();
    var i, slot, item, id, active;
    for (i = 0; i < layout.items.length; i++) {
        slot = layout.items[i];
        item = slot.item;
        id = kind + ':' + item.id;
        active = selectedId === item.id;
        ui.chip(gr, { x: slot.x, y: slot.y, w: slot.w, h: slot.h }, {
            selected: active,
            hovered: hoverId === id,
            pressed: downId === id,
            enabled: true
        }, {
            text: item.label,
            font: f_small,
            accent: accent,
            indicator: true,
            textFlags: DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS
        });
        addHit(id, kind, { x: slot.x, y: slot.y, w: slot.w, h: slot.h }, item.id);
    }
}

function drawHeader(gr, x, y, w) {
    var pad = _scale(14);
    var chipH = _scale(24);
    var gapX = _scale(6);
    var gapY = _scale(6);
    var maxX = x + w - pad;
    var controlsY = y + _scale(50);
    var typeMin = _scale(64);
    var periodMin = _scale(44);
    var typeWidth = chipGroupWidth(CHART_TYPES, f_small, typeMin, gapX);
    var periodItems = [];
    var periodWidth;
    var sameRow;
    var typeLayout;
    var periodLayout;
    var controlsBottom;
    var h;
    var title = currentArtist || 'No current artist';

    for (var i = 0; i < PERIODS.length; i++) {
        periodItems.push({ id: PERIODS[i].id, label: PERIODS[i].short });
    }
    periodWidth = chipGroupWidth(periodItems, f_small, periodMin, gapX);
    sameRow = typeWidth + _scale(18) + periodWidth <= w - pad * 2;

    if (sameRow) {
        typeLayout = layoutChipGroup(CHART_TYPES, f_small, typeMin, x + pad, controlsY, maxX, chipH, gapX, gapY);
        periodLayout = layoutChipGroup(periodItems, f_small, periodMin, typeLayout.endX + _scale(18), controlsY, maxX, chipH, gapX, gapY);
    } else {
        typeLayout = layoutChipGroup(CHART_TYPES, f_small, typeMin, x + pad, controlsY, maxX, chipH, gapX, gapY);
        periodLayout = layoutChipGroup(periodItems, f_small, periodMin, x + pad, controlsY + typeLayout.height + gapY, maxX, chipH, gapX, gapY);
    }

    controlsBottom = Math.max(
        controlsY + typeLayout.height,
        (sameRow ? controlsY : controlsY + typeLayout.height + gapY) + periodLayout.height
    );
    h = controlsBottom - y + _scale(12);

    ui.card(gr, { x: x, y: y, w: w, h: h }, {
        accent: true,
        accentColour: currentAccent(),
        accentEdge: 'left',
        fill: ui_theme.card
    });
    drawText(gr, title, f_headline, ui_theme.textPrimary, x + pad + _scale(4), y + _scale(10), w - pad * 2 - _scale(4), _scale(32), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    drawChipGroup(gr, typeLayout, opt_chart_type, 'chartType');
    drawChipGroup(gr, periodLayout, opt_period, 'period');
    return h;
}

function maxMetricWidth(rows, field, suffix, font, limit) {
    var width = 0;
    var text;
    for (var i = 0; i < limit; i++) {
        text = rows[i] && rows[i][field] ? rows[i][field] + suffix : '';
        if (text) width = Math.max(width, textWidth(text, font));
    }
    return width ? width + _scale(8) : 0;
}

function drawRows(gr, key, x, y, w, rows, kind, limit) {
    var rowH = _scale(32);
    var mainH = _scale(19);
    var subY = _scale(17);
    var rankW = _scale(28);
    var gap = _scale(8);
    var countField = kind === 'global' ? 'plays' : 'count';
    var countW = maxMetricWidth(rows, countField, '', f_body_bold, limit);
    var i, row, ry, id, hot, titleX, titleW;
    var countX, countText, metricRight, listenerText, hasListener;
    var textY, textH;

    for (i = 0; i < limit; i++) {
        row = rows[i];
        ry = y + i * rowH;
        id = hitId('row', key, i);
        hot = hoverId === id || downId === id;
        listenerText = kind === 'global' && row.listeners ? row.listeners + ' listeners' : '';
        hasListener = !!listenerText;
        countText = kind === 'global' ? (row.plays || '') : (row.count || '');

        if (hot) {
            gr.FillSolidRect(x, ry, w, rowH, SharedAccentProtocol.withAlpha(currentAccent(), downId === id ? 44 : 26));
        }

        titleX = x + rankW + gap;
        countX = x + w - countW;
        metricRight = countW ? countX - gap : x + w;
        titleW = Math.max(_scale(24), metricRight - titleX);
        textY = hasListener ? ry : ry;
        textH = hasListener ? mainH : rowH;

        drawText(gr, String(i + 1), f_small, hot ? currentAccent() : ui_theme.textMuted, x + _scale(4), textY, rankW - _scale(4), textH, DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        drawText(gr, row.title, f_body_bold, hot ? currentAccent() : ui_theme.textPrimary, titleX, textY, titleW, textH, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        if (countW) {
            drawText(gr, countText, f_body_bold, ui_theme.textPrimary, countX, textY, countW, textH, DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        }
        if (hasListener) {
            drawText(gr, listenerText, f_small, ui_theme.textMuted, titleX, ry + subY, titleW, rowH - subY, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        }

        if (row.url) addHit(id, 'url', { x: x, y: ry, w: w, h: rowH }, row.url, chartRowMeta(key, row));
    }
}

function drawLoadingRows(gr, x, y, w, limit) {
    var rowH = _scale(32);
    var wash = SharedAccentProtocol.withAlpha(currentAccent(), 20);
    for (var i = 0; i < limit; i++) {
        gr.FillSolidRect(x + _scale(6), y + i * rowH + _scale(12), Math.max(_scale(20), w - _scale(88)), _scale(7), wash);
    }
}

function drawSection(gr, key, title, kind, x, y, w, maxH) {
    var section = sections[key];
    if (maxH <= 0) return 0;
    var headerH = _scale(44);
    var rowH = _scale(32);
    var pad = _scale(10);
    var desiredRows = section.loading ? 3 : section.rows.length;
    var availableRows = Math.max(0, Math.floor((Math.max(0, maxH) - headerH - pad) / rowH));
    var rowsToDraw = Math.min(opt_row_limit, desiredRows, availableRows);
    var isMessage = !section.loading && (section.error || !section.rows.length);
    var desiredH = isMessage ? headerH + _scale(54) : headerH + Math.max(1, rowsToDraw) * rowH + pad;
    var h = Math.max(1, Math.min(desiredH, maxH));
    var contentX = x + pad + _scale(5);
    var contentW = Math.max(1, w - pad * 2 - _scale(5));
    var bodyY = y + headerH;
    var message;

    ui.card(gr, { x: x, y: y, w: w, h: h }, {
        fill: ui_theme.card,
        accent: true,
        accentColour: currentAccent(),
        accentEdge: 'left'
    });
    drawText(gr, title, f_title, ui_theme.textPrimary, contentX, y + _scale(8), contentW, _scale(25), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);

    if (section.loading) {
        drawLoadingRows(gr, contentX, bodyY, contentW, Math.max(1, rowsToDraw));
    } else if (section.error) {
        drawText(gr, section.error, f_body, ui_theme.textMuted, contentX, bodyY + _scale(4), contentW, Math.max(_scale(24), h - headerH - _scale(8)), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    } else if (!section.rows.length) {
        message = kind === 'global'
            ? 'No results for this artist.'
            : (localOverallChartActive()
                ? 'No local Last.fm play-count tags for this artist.'
                : 'No matching entries. Try a longer period or increase the search depth.');
        drawText(gr, message, f_body, ui_theme.textMuted, contentX, bodyY + _scale(4), contentW, Math.max(_scale(24), h - headerH - _scale(8)), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    } else if (rowsToDraw > 0) {
        drawRows(gr, key, contentX, bodyY, contentW, section.rows, kind, rowsToDraw);
    }
    return h;
}

function activeChartInfo() {
    var isAlbums = opt_chart_type === ChartType.Albums;
    var noun = isAlbums ? 'albums' : 'tracks';
    return {
        globalKey: isAlbums ? 'globalAlbums' : 'globalTracks',
        userKey: isAlbums ? 'myAlbums' : 'myTracks',
        globalTitle: 'Top ' + noun + ' \u00B7 All time',
        userTitle: 'My top ' + noun + ' \u00B7 ' + periodLabel(opt_period)
    };
}

function drawBody(gr, x, y, w, availableH) {
    var gap = _scale(10);
    var minColumn = _scale(280);
    var info = activeChartInfo();
    var leftW, rightW, leftH, rightH, firstMaxH, secondMaxH;

    if (!currentArtist) {
        return drawEmptyCard(gr, x, y, w, availableH, 'No current artist', 'Play or focus a track and the panel will load charts for that artist.');
    }

    if (w >= minColumn * 2 + gap) {
        leftW = Math.floor((w - gap) / 2);
        rightW = w - gap - leftW;
        leftH = drawSection(gr, info.globalKey, info.globalTitle, 'global', x, y, leftW, availableH);
        rightH = drawSection(gr, info.userKey, info.userTitle, 'user', x + leftW + gap, y, rightW, availableH);
        return Math.max(leftH, rightH);
    }

    firstMaxH = Math.max(0, Math.floor((availableH - gap) / 2));
    secondMaxH = Math.max(0, availableH - gap - firstMaxH);
    leftH = drawSection(gr, info.globalKey, info.globalTitle, 'global', x, y, w, firstMaxH);
    rightH = drawSection(gr, info.userKey, info.userTitle, 'user', x, y + leftH + gap, w, secondMaxH);
    return leftH + gap + rightH;
}

function on_paint(gr) {
    runPendingRefresh();

    var margin = _scale(10);
    var gap = _scale(10);
    var y = margin;
    var availableH;

    hits = [];
    if (!gr) return;
    RivageBackdrop.paint(gr, 0, 0, ww, wh, ui_theme.background);
    if (ww <= 0 || wh <= 0) return;

    y += drawHeader(gr, margin, y, Math.max(1, ww - margin * 2));
    y += gap;
    availableH = Math.max(0, wh - y - margin);
    drawBody(gr, margin, y, Math.max(1, ww - margin * 2), availableH);
}

function openUrl(url) {
    url = trimText(url);
    if (!/^https?:\/\//i.test(url)) return;
    try {
        new ActiveXObject('WScript.Shell').Run(url);
    } catch (e) {
        console.log('Last.fm Charts: could not open ' + url);
    }
}

function setChartType(chartType) {
    chartType = validChartType(chartType);
    if (chartType === opt_chart_type) return;
    window.SetProperty(PROP + 'chart_type', chartType);
    opt_chart_type = chartType;
    window.Repaint();
}

function setPeriod(period) {
    period = validPeriod(period);
    if (period === opt_period) return;
    window.SetProperty(PROP + 'period', period);
    opt_period = period;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function setRowLimit(value) {
    var next = normaliseInteger(value, 4, 25, opt_row_limit);
    if (next === opt_row_limit) return;
    window.SetProperty(PROP + 'row_limit', next);
    opt_row_limit = next;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function setUserDepth(value) {
    var next = normaliseInteger(value, 100, 2000, opt_user_depth);
    if (next === opt_user_depth) return;
    window.SetProperty(PROP + 'user_depth', next);
    opt_user_depth = next;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function setCacheHours(value) {
    var next = normaliseInteger(value, 1, 168, opt_cache_hours);
    if (next === opt_cache_hours) return;
    window.SetProperty(PROP + 'cache_hours', next);
    opt_cache_hours = next;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function setLocalOverallChart(value) {
    var next = !!value;
    if (next === opt_local_overall_chart) return;
    window.SetProperty(PROP + 'local_overall_chart', next);
    opt_local_overall_chart = next;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function setTrackContextOverride(value) {
    var next = TrackContext.normaliseOverride(value);
    if (next === opt_track_context) return;
    window.SetProperty(PROP + 'track_context_override', next);
    opt_track_context = next;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function hitActionKey(hit) {
    var meta;
    if (!hit) return '';
    meta = hit.meta || {};
    return [hit.id, hit.kind, String(hit.data == null ? '' : hit.data), meta.type || '', meta.artist || '', meta.title || '', meta.album || ''].join('\x1f');
}

function cancelPressedAction() {
    downId = '';
    downActionKey = '';
}

function on_mouse_move(x, y, mask) {
    var hit = hitAt(x, y);
    var id = hit ? hit.id : '';
    if (id !== hoverId) {
        hoverId = id;
        window.Repaint();
    }
    try { window.SetCursor(hit ? IDC_HAND : IDC_ARROW); } catch (e) {}
}

function on_mouse_leave() {
    if (hoverId || downId) {
        hoverId = '';
        cancelPressedAction();
        window.Repaint();
    }
    try { window.SetCursor(IDC_ARROW); } catch (e) {}
}

function on_mouse_lbtn_down(x, y, mask) {
    var hit = hitAt(x, y);
    downId = hit ? hit.id : '';
    downActionKey = hitActionKey(hit);
    if (downId) window.Repaint();
}

function on_mouse_lbtn_up(x, y, mask) {
    var hit = hitAt(x, y);
    if (hit && hit.id === downId && hitActionKey(hit) === downActionKey) {
        if (hit.kind === 'chartType') setChartType(hit.data);
        else if (hit.kind === 'period') setPeriod(hit.data);
        else if (hit.kind === 'url') openUrl(hit.data);
    }
    if (downId) {
        cancelPressedAction();
        window.Repaint();
    }
}

function on_mouse_wheel(step) {
    return false;
}

function menuFlags(enabled, checked) {
    var flags = enabled ? MF_STRING : MF_GRAYED;
    if (checked) flags |= MF_CHECKED;
    return flags;
}

function showMenu(x, y, contextHit) {
    var menu = window.CreatePopupMenu();
    var chartMenu = window.CreatePopupMenu();
    var periodMenu = window.CreatePopupMenu();
    var followMenu = window.CreatePopupMenu();
    var appearanceMenu = window.CreatePopupMenu();
    var accentMenu = window.CreatePopupMenu();
    var i, idx, key;
    var libraryState = null;

    if (contextHit && contextHit.meta) {
        libraryState = RivageLibraryActions.append(menu, contextHit.meta, { separator: false, webLabel: 'Open on Last.fm' });
        menu.AppendMenuSeparator();
    }
    menu.AppendMenuItem(MF_STRING, 1, 'Refresh charts');
    menu.AppendMenuItem(MF_SEPARATOR, 0, '');

    chartMenu.AppendMenuItem(menuFlags(true, opt_chart_type === ChartType.Songs), 10, 'Tracks');
    chartMenu.AppendMenuItem(menuFlags(true, opt_chart_type === ChartType.Albums), 11, 'Albums');
    chartMenu.AppendTo(menu, MF_STRING, 'Chart type');

    for (i = 0; i < PERIODS.length; i++) {
        periodMenu.AppendMenuItem(menuFlags(true, opt_period === PERIODS[i].id), 100 + i, PERIODS[i].label);
    }
    periodMenu.AppendTo(menu, MF_STRING, 'Chart period');

    var trackChoices = TrackContext.getOverrideChoices();
    followMenu.AppendMenuItem(menuFlags(true, opt_track_context === TrackContext.MODE_GLOBAL), 20, trackChoices[0].label);
    followMenu.AppendMenuItem(menuFlags(true, opt_track_context === TrackContext.MODE_AUTO), 21, trackChoices[1].label);
    followMenu.AppendMenuItem(menuFlags(true, opt_track_context === TrackContext.MODE_NOW_PLAYING), 22, trackChoices[2].label);
    followMenu.AppendMenuItem(menuFlags(true, opt_track_context === TrackContext.MODE_SELECTION), 23, trackChoices[3].label);
    followMenu.AppendTo(menu, MF_STRING, 'Track source');

    accentMenu.AppendMenuItem(menuFlags(true, opt_accent_mode === AccentMode.Default), 30, RivageUI.copy.labels.rvgBlue);
    accentMenu.AppendMenuItem(menuFlags(true, opt_accent_mode === AccentMode.AlbumArt), 31, RivageUI.copy.labels.sharedAccent);
    accentMenu.AppendTo(appearanceMenu, MF_STRING, 'Accent colour');
    appearanceMenu.AppendTo(menu, MF_STRING, 'Appearance');

    menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    menu.AppendMenuItem(menuFlags(true, opt_local_overall_chart), 8, 'Use local all-time play counts');
    menu.AppendMenuItem(MF_STRING, 4, 'Set artist filter search depth\u2026');
    menu.AppendMenuItem(MF_STRING, 5, 'Set rows per chart\u2026');
    menu.AppendMenuItem(MF_STRING, 6, 'Set cache duration\u2026');
    menu.AppendMenuItem(MF_STRING, 7, 'Clear cached Last.fm data');

    idx = menu.TrackPopupMenu(x, y);
    if (RivageLibraryActions.handle(libraryState, idx)) return;
    if (idx >= 100 && idx < 100 + PERIODS.length) {
        setPeriod(PERIODS[idx - 100].id);
        return;
    }

    switch (idx) {
    case 1:
        lastFetchKey = '';
        scheduleRefresh(true);
        break;
    case 4:
        key = utils.InputBox(window.ID, 'How many of your top tracks/albums should be scanned before filtering to the current artist?', window.Name, String(opt_user_depth), false);
        if (typeof key === 'string' && key.length) setUserDepth(key);
        break;
    case 5:
        key = utils.InputBox(window.ID, 'Rows per chart', window.Name, String(opt_row_limit), false);
        if (typeof key === 'string' && key.length) setRowLimit(key);
        break;
    case 6:
        key = utils.InputBox(window.ID, 'Cache duration in hours', window.Name, String(opt_cache_hours), false);
        if (typeof key === 'string' && key.length) setCacheHours(key);
        break;
    case 7:
        clearApiCache();
        lastFetchKey = '';
        scheduleRefresh(true);
        break;
    case 8:
        setLocalOverallChart(!opt_local_overall_chart);
        break;
    case 10:
        setChartType(ChartType.Songs);
        break;
    case 11:
        setChartType(ChartType.Albums);
        break;
    case 20:
    case 21:
    case 22:
    case 23:
        setTrackContextOverride(idx === 20 ? TrackContext.MODE_GLOBAL : (idx === 21 ? TrackContext.MODE_AUTO : (idx === 22 ? TrackContext.MODE_NOW_PLAYING : TrackContext.MODE_SELECTION)));
        break;
    case 30:
        setAccentMode(AccentMode.Default);
        break;
    case 31:
        setAccentMode(AccentMode.AlbumArt);
        break;
    }
}

function on_mouse_rbtn_up(x, y, mask) {
    if (mask === MK_SHIFT) return false;
    showMenu(x, y, hitAt(x, y));
    return true;
}

var SETTINGS_PANEL_ID = 'lastfm_charts';
var SETTINGS_PANEL_LABEL = 'Last.fm charts';

function getMySettings() {
    return [
        { id: 'chartType', label: 'Chart type', type: 'choice', value: opt_chart_type, choiceValueType: 'string', choices: [
            { value: ChartType.Songs, label: 'Tracks' },
            { value: ChartType.Albums, label: 'Albums' }
        ], section: 'Charts' },
        { id: 'period', label: 'Chart period', type: 'choice', value: opt_period, choiceValueType: 'string', choices: [
            { value: '7day', label: '7 days' },
            { value: '1month', label: '1 month' },
            { value: '3month', label: '3 months' },
            { value: '6month', label: '6 months' },
            { value: '12month', label: '12 months' },
            { value: 'overall', label: 'All time' }
        ], section: 'Charts' },
        { id: 'rowLimit', label: 'Rows per chart', type: 'number', value: opt_row_limit, min: 4, max: 25, step: 1, section: 'Charts' },
        { id: 'userDepth', label: 'Artist filter search depth', type: 'number', value: opt_user_depth, min: 100, max: 2000, step: 100, section: 'Charts', hint: 'How many top tracks or albums to scan before filtering to the current artist.' },
        { id: 'localOverallChart', label: 'Use local all-time play counts', type: 'bool', value: opt_local_overall_chart, section: 'Charts', hint: 'Reads the %lastfm_play_count% field for the All time period.' },
        { id: 'cacheHours', label: 'Cache duration', type: 'number', value: opt_cache_hours, min: 1, max: 168, step: 1, section: 'Cache' },
        { id: 'trackSourceOverride', label: 'Track source', type: 'choice', value: opt_track_context, choiceValueType: 'string', choices: TrackContext.getOverrideChoices(), section: 'Behaviour' }
    ];
}

function applyMySetting(settingId, value) {
    if (settingId === 'chartType') {
        setChartType(value);
        return;
    }
    if (settingId === 'period') {
        setPeriod(value);
        return;
    }
    if (settingId === 'rowLimit') {
        setRowLimit(value);
        return;
    }
    if (settingId === 'userDepth') {
        setUserDepth(value);
        return;
    }
    if (settingId === 'localOverallChart') {
        setLocalOverallChart(value);
        return;
    }
    if (settingId === 'cacheHours') {
        setCacheHours(value);
        return;
    }
    if (settingId === 'trackSourceOverride') {
        setTrackContextOverride(value);
        return;
    }
}

function apply_lastfm_credentials(creds) {
    if (creds.apiKey === API_KEY && creds.username === opt_username) return;

    API_KEY = creds.apiKey;
    opt_username = creds.username;
    lastFetchKey = '';
    scheduleRefresh(false);
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (LastfmCredentialsProtocol.consume(name, info, apply_lastfm_credentials)) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (opt_accent_mode === AccentMode.AlbumArt) {
            update_colours();
            window.Repaint();
        }
    }
}

function on_size(width, height) {
    ww = width;
    wh = height;
}

function on_colours_changed() {
    update_colours();
    SharedThemeProtocol.requestRepaint();
}

function on_font_changed() {
    update_fonts();
    update_colours();
    window.Repaint(true);
}

function on_playback_new_track(handle) {
    if (TrackContext.followsPlayback(opt_track_context)) scheduleRefresh(false);
}

function on_playback_stop(reason) {
    if (reason !== PLAYBACK_STOP_STARTING_ANOTHER) scheduleRefresh(false);
}

function on_item_focus_change(playlistIndex, from, to) {
    if (followSelectionNow()) scheduleRefresh(false);
}

function on_playlist_switch() {
    if (followSelectionNow()) scheduleRefresh(false);
}

function on_playlist_items_selection_change() {
    if (followSelectionNow()) scheduleRefresh(false);
}

function on_script_unload() {
    if (refreshTimer) {
        window.ClearTimeout(refreshTimer);
        refreshTimer = null;
    }
    fetchToken++;
    taskContexts = {};
    cancelPressedAction();
    // Cache persistence is debounced, so unload must flush any dirty store.
    saveApiCacheNow();
}

ww = window.Width;
wh = window.Height;
update_fonts();
update_colours();
SharedAccentProtocol.request();
TrackContext.onChange(function () { scheduleRefresh(false); });
TrackContext.requestSync();
scheduleRefresh(false);
LastfmCredentialsProtocol.requestUntilAnswered();
