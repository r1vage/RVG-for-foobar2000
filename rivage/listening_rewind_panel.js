window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\listening_history_index.js');

window.EraseOnRepaint = false;

// Rewind: a period summary (top artists, albums, tracks and genres, new artists,
// plays by month, when you listen) and a listening heatmap, built from Enhanced
// Playback Statistics' per-play timestamps through shared/listening_history_index.js.
// The index is read in chunks when the panel is first shown, so a large library
// never freezes foobar2000, and afterwards only tracks whose metadata changes are
// re-read (on_metadb_changed), so it stays current without rebuilding.

window.DefineScript(RivageUI.copy.popupTitle('Rewind'), {
    author: 'RivaGe',
    version: '1.5.0',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});

var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;
var MF_SEPARATOR = 0x00000800;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;

var DAY_MS = 86400000;
var TOP_COUNT_CHOICES = [5, 10, 15, 20];

var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var WEEKDAYS_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function clamp(value, minimum, maximum) {
    value = Number(value);
    if (!isFinite(value)) value = minimum;
    return Math.max(minimum, Math.min(maximum, value));
}

function formatInteger(value) {
    return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function plural(n, one, many) {
    return formatInteger(n) + ' ' + (Math.round(n) === 1 ? one : many);
}

function percentOf(part, whole) {
    if (!whole) return '0%';
    var p = part * 100 / whole;
    return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
}

function dateFromDayNumber(n) {
    return new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
}

function formatDate(date, withWeekday) {
    var text = date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getFullYear();
    return withWeekday ? WEEKDAYS_SHORT[date.getDay()] + ' ' + text : text;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// ---------------------------------------------------------------------------
// Settings

var SETTINGS_PANEL_ID = 'rewind';
var SETTINGS_PANEL_LABEL = 'Rewind';
var PROPERTY_PREFIX = 'RVG Rewind.';

var Source = { LASTFM: 'lastfm', LOCAL: 'local' };
var View = { REWIND: 'rewind', HEATMAP: 'heatmap', ARTIST: 'artist' };
var AccentMode = { SHARED_ALBUM: 'album', GLOBAL_THEME: 'theme' };

function readSetting(name, fallback) {
    try { return window.GetProperty(PROPERTY_PREFIX + name, fallback); }
    catch (e) { return fallback; }
}

function saveSetting(name, value) {
    try { window.SetProperty(PROPERTY_PREFIX + name, value); } catch (e) { }
}

function normaliseView(value) {
    return value === View.HEATMAP || value === View.ARTIST ? value : View.REWIND;
}

function normaliseTopCount(value) {
    value = Number(value);
    return TOP_COUNT_CHOICES.indexOf(value) >= 0 ? value : 5;
}

var settings = {
    source: readSetting('Source', Source.LASTFM) === Source.LOCAL ? Source.LOCAL : Source.LASTFM,
    view: normaliseView(readSetting('View', View.REWIND)),
    trackContextOverride: TrackContext.normaliseOverride(readSetting('Track context override', TrackContext.MODE_GLOBAL)),
    period: String(readSetting('Period', 'last12')),
    weekStartsMonday: !!readSetting('Week starts on Monday', true),
    foldFeatured: !!readSetting('Fold featured artists', true),
    topCount: normaliseTopCount(readSetting('Top list size', 5)),
    compare: !!readSetting('Compare with previous period', true),
    showCovers: !!readSetting('Show covers', true),
    accentMode: readSetting('Accent mode', AccentMode.SHARED_ALBUM) === AccentMode.GLOBAL_THEME
        ? AccentMode.GLOBAL_THEME : AccentMode.SHARED_ALBUM
};

function sourceLabel(source) {
    return source === Source.LOCAL ? 'Local plays' : 'Last.fm scrobbles';
}

function getMySettings() {
    var sizes = [];
    for (var i = 0; i < TOP_COUNT_CHOICES.length; i++) {
        sizes.push({ value: TOP_COUNT_CHOICES[i], label: String(TOP_COUNT_CHOICES[i]) });
    }
    return [
        {
            id: 'source', label: 'Play history', type: 'choice', section: 'Data',
            value: settings.source, choiceValueType: 'string',
            choices: [
                { value: Source.LASTFM, label: sourceLabel(Source.LASTFM) },
                { value: Source.LOCAL, label: sourceLabel(Source.LOCAL) }
            ]
        },
        {
            id: 'trackContextOverride', label: 'Current artist follows', type: 'choice', section: 'Data',
            value: settings.trackContextOverride, choiceValueType: 'string',
            choices: TrackContext.getOverrideChoices(),
            hint: 'Which track the Current artist view takes its artist from.'
        },
        {
            id: 'foldFeatured', label: 'Count featured artists as the main artist', type: 'bool',
            section: 'Data', value: settings.foldFeatured,
            hint: '"Arkells feat. K.Flay" counts as Arkells. Titles and albums are unchanged.'
        },
        {
            id: 'sourceInfo', label: 'Data source', type: 'info', section: 'Data',
            value: 'Reads Enhanced Playback Statistics (foo_enhanced_playcount): local plays from ' +
                '%played_times_js%, Last.fm scrobbles from %lastfm_played_times_js% after its Last.fm import. ' +
                'Only tracks in the Media Library are counted.'
        },
        {
            id: 'topCount', label: 'Entries per top list', type: 'choice', section: 'Appearance',
            value: settings.topCount, choiceValueType: 'number', choices: sizes
        },
        {
            id: 'compare', label: 'Compare with the previous period', type: 'bool', section: 'Appearance',
            value: settings.compare,
            hint: 'Shows the change against the period before (the same days of it for a period still ' +
                'running) on the totals, and rank changes in the top lists.'
        },
        {
            id: 'showCovers', label: 'Show covers in the top lists', type: 'bool', section: 'Appearance',
            value: settings.showCovers,
            hint: 'Album covers, and artist pictures where foobar2000 finds one. Loaded in the background ' +
                'for the rows on screen only.'
        },
        {
            id: 'weekStartsMonday', label: 'Weeks start on', type: 'choice', section: 'Appearance',
            value: settings.weekStartsMonday ? 'monday' : 'sunday', choiceValueType: 'string',
            choices: [{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]
        },
        {
            id: 'accentMode', label: 'Accent source', type: 'choice', section: 'Appearance',
            value: settings.accentMode, choiceValueType: 'string',
            choices: [
                { value: AccentMode.SHARED_ALBUM, label: RivageUI.copy.labels.sharedAccent },
                { value: AccentMode.GLOBAL_THEME, label: RivageUI.copy.labels.rvgBlue }
            ]
        }
    ];
}

function applyMySetting(settingId, value) {
    if (settingId === 'source') {
        setSource(value);
    } else if (settingId === 'foldFeatured') {
        settings.foldFeatured = !!value;
        saveSetting('Fold featured artists', settings.foldFeatured);
        drill = null;
        refreshCurrentArtist();
        requestBuild(true);
    } else if (settingId === 'trackContextOverride') {
        settings.trackContextOverride = TrackContext.normaliseOverride(value);
        saveSetting('Track context override', settings.trackContextOverride);
        refreshCurrentArtist();
    } else if (settingId === 'weekStartsMonday') {
        settings.weekStartsMonday = value !== 'sunday';
        saveSetting('Week starts on Monday', settings.weekStartsMonday);
    } else if (settingId === 'topCount') {
        settings.topCount = normaliseTopCount(value);
        saveSetting('Top list size', settings.topCount);
        invalidateSummary();
    } else if (settingId === 'compare') {
        settings.compare = !!value;
        saveSetting('Compare with previous period', settings.compare);
        invalidateSummary();
    } else if (settingId === 'showCovers') {
        settings.showCovers = !!value;
        saveSetting('Show covers', settings.showCovers);
    } else if (settingId === 'accentMode') {
        settings.accentMode = value === AccentMode.GLOBAL_THEME ? AccentMode.GLOBAL_THEME : AccentMode.SHARED_ALBUM;
        saveSetting('Accent mode', settings.accentMode);
        if (settings.accentMode === AccentMode.SHARED_ALBUM) SharedAccentProtocol.requestAccent();
        refreshVisualResources(false);
    }
    markLayout();
}

function setSource(value) {
    var next = value === Source.LOCAL ? Source.LOCAL : Source.LASTFM;
    if (next === settings.source) return;
    settings.source = next;
    saveSetting('Source', next);
    drill = null;
    // The other source's history is a different index: drop this one at once.
    index = null;
    requestBuild(true);
    markLayout();
}

function setView(view) {
    settings.view = normaliseView(view);
    saveSetting('View', settings.view);
    scrollY = 0;
    markLayout();
}

function setPeriod(id) {
    settings.period = id;
    saveSetting('Period', id);
    scrollY = 0;
    invalidateSummary();
}

// Artist drill-down: null, or { key, label }.
var drill = null;
// The artist of the track TrackContext resolves to, for the Current artist view.
var currentArtist = null;
var currentArtistTrack = '';
var TF_ARTIST = fb.TitleFormat('[%artist%]');
var TF_TRACK_LABEL = fb.TitleFormat('[%title%]');

// The artist the content is about: a clicked one, else the current one in its view.
function focusArtist() {
    if (drill) return drill;
    return settings.view === View.ARTIST ? currentArtist : null;
}

function refreshCurrentArtist() {
    var handle = null, name = '', title = '';
    try { handle = TrackContext.getHandle(settings.trackContextOverride); } catch (e) { handle = null; }
    if (handle) {
        try { name = TF_ARTIST.EvalWithMetadb(handle); } catch (e2) { name = ''; }
        try { title = TF_TRACK_LABEL.EvalWithMetadb(handle); } catch (e3) { title = ''; }
    }
    var next = name ? RivageListeningIndex.artistKey(name, settings.foldFeatured) : null;
    currentArtistTrack = title;
    if ((next && next.key) === (currentArtist && currentArtist.key)) return;
    currentArtist = next;
    if (settings.view === View.ARTIST && !drill) {
        scrollY = 0;
        invalidateSummary();
    }
}

function openArtist(entry) {
    if (!entry) return;
    drill = { key: entry.key, label: entry.label };
    scrollY = 0;
    invalidateSummary();
}

function closeArtist() {
    if (!drill) return;
    drill = null;
    scrollY = 0;
    invalidateSummary();
}

// ---------------------------------------------------------------------------
// Data

var index = null;
var buildJob = null;
var buildState = 'idle'; // idle | building | ready | error
var buildError = '';
var buildProgress = 0;
var buildSerial = 0;
var pendingChanges = null;   // metadb changes that arrived during a build
var lastProgressPaint = 0;

var buildGate = VisiblePaintWork.create(function () {
    startBuild();
});

// Builds happen on the next visible paint, so a hidden panel never reads the library.
function requestBuild(force) {
    if (force) buildSerial++;
    buildGate.request(settings.source + '|' + settings.foldFeatured + '|' + buildSerial);
    window.Repaint();
}

function startBuild() {
    if (buildJob) { try { buildJob.cancel(); } catch (e) { } }
    buildState = 'building';
    buildError = '';
    buildProgress = 0;
    pendingChanges = null;
    var requested = { source: settings.source, foldFeatured: settings.foldFeatured };
    buildJob = RivageListeningIndex.build(requested, {
        onProgress: function (fraction) {
            buildProgress = fraction;
            var t = new Date().getTime();
            if (t - lastProgressPaint >= 150) {
                lastProgressPaint = t;
                window.Repaint();
            }
        },
        onDone: function (built) {
            buildJob = null;
            index = built;
            buildState = 'ready';
            if (pendingChanges) {
                var changes = pendingChanges;
                pendingChanges = null;
                applyChanges(changes);
            }
            invalidateSummary();
        },
        onError: function (message) {
            buildJob = null;
            buildState = 'error';
            buildError = message;
            try { console.log('[RVG Rewind] ' + message); } catch (e) { }
            markLayout();
        }
    });
}

// A new play or a retag: patch only those tracks.
function applyChanges(handleList) {
    if (!index) return;
    var result = RivageListeningIndex.update(index, handleList);
    if (result === 'ok') invalidateSummary();
    else if (result === 'rebuild') requestBuild(true);
}

// Periods. Ranges are [from, to) in local time; prev is what `compare` measures against.
function periodRange(id) {
    var now = new Date();
    var today = startOfDay(now);
    var tomorrow = addDays(today, 1).getTime();
    var from, to, label, prev = null, prevLabel = '';
    var match = /^y(\d{4})$/.exec(id);

    if (match) {
        var year = Number(match[1]);
        from = new Date(year, 0, 1).getTime();
        to = Math.min(new Date(year + 1, 0, 1).getTime(), tomorrow);
        label = String(year);
        var prevFrom = new Date(year - 1, 0, 1).getTime();
        var running = to < new Date(year + 1, 0, 1).getTime();
        prev = { from: prevFrom, to: running ? prevFrom + (to - from) : from };
        prevLabel = running ? 'same point of ' + (year - 1) : String(year - 1);
    } else if (id === 'thisMonth') {
        from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        to = tomorrow;
        label = 'This month';
        var lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        prev = { from: lastMonthStart, to: Math.min(from, lastMonthStart + (to - from)) };
        prevLabel = 'same days last month';
    } else if (id === 'lastMonth') {
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        label = 'Last month';
        prev = { from: new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime(), to: from };
        prevLabel = MONTHS_SHORT[new Date(prev.from).getMonth()];
    } else if (id === 'all') {
        var first = index && index.eventTimes.length ? index.eventTimes[0] : today.getTime();
        from = new Date(new Date(first).getFullYear(), 0, 1).getTime();
        to = tomorrow;
        label = 'All time';
    } else {
        id = 'last12';
        from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1).getTime();
        to = tomorrow;
        label = 'Last 12 months';
        prev = { from: new Date(now.getFullYear() - 2, now.getMonth(), now.getDate() + 1).getTime(), to: from };
        prevLabel = 'previous 12 months';
    }
    if (prev) prev.label = prevLabel;
    return { id: id, label: label, from: from, to: to, prev: prev,
        // A heatmap longer than ~2 years reads better as a month grid.
        months: to - from > 800 * DAY_MS };
}

// "the last 12 months", "this month", "2025"... for running text.
function periodPhrase(id) {
    var label = periodRange(id).label;
    if (id === 'last12') return 'the last 12 months';
    if (id === 'thisMonth' || id === 'lastMonth' || id === 'all') return label.toLowerCase();
    return label;
}

function periodChoices() {
    var list = [
        { id: 'last12', label: 'Last 12 months' },
        { id: 'thisMonth', label: 'This month' },
        { id: 'lastMonth', label: 'Last month' }
    ];
    var thisYear = new Date().getFullYear();
    var firstYear = thisYear;
    if (index && index.eventTimes.length) firstYear = new Date(index.eventTimes[0]).getFullYear();
    for (var y = thisYear; y >= firstYear; y--) list.push({ id: 'y' + y, label: String(y) });
    list.push({ id: 'all', label: 'All time' });
    return list;
}

var summary = null;
var prevSummary = null;
var totalSummary = null;  // whole period without the drill filter, for "share of plays"
var summaryPeriod = null;
var summaryKey = '';

function invalidateSummary() {
    summaryKey = '';
    markLayout();
}

function ensureSummary() {
    if (!index) { summary = prevSummary = totalSummary = null; return null; }
    var period = periodRange(settings.period);
    var key = [index.builtAt, index.revision, period.id, period.from, period.to, settings.topCount,
        settings.compare, focusArtist() ? focusArtist().key : ''].join('|');
    if (key !== summaryKey) {
        var options = { limit: settings.topCount, artistKey: focusArtist() ? focusArtist().key : '' };
        summary = RivageListeningIndex.summarise(index, period.from, period.to, options);
        prevSummary = settings.compare && period.prev
            ? RivageListeningIndex.summarise(index, period.prev.from, period.prev.to, options) : null;
        totalSummary = focusArtist() ? { plays: RivageListeningIndex.eventRange(index, period.from, period.to) } : null;
        summaryPeriod = period;
        summaryKey = key;
    }
    return summary;
}

function periodTotalPlays() {
    if (!totalSummary) return summary ? summary.plays : 0;
    return totalSummary.plays.end - totalSummary.plays.start;
}

// Library handles for a set of track indices; albums in disc/track order.
var TF_ALBUM_ORDER = fb.TitleFormat('%album artist%|%album%|%discnumber%|%tracknumber%');

function handlesForTracks(trackIndices, albumOrder) {
    var list = new FbMetadbHandleList();
    if (!index) return list;
    for (var i = 0; i < trackIndices.length; i++) {
        var track = index.tracks[trackIndices[i]];
        if (!track) continue;
        try { list.Add(index.handles[track.libraryIndex]); } catch (e) { }
    }
    if (albumOrder && list.Count > 1) {
        try { list.OrderByFormat(TF_ALBUM_ORDER, 1); } catch (e2) { }
    }
    return list;
}

function byPlays(tracks) {
    return tracks.slice().sort(function (a, b) { return index.tracks[b].plays - index.tracks[a].plays; });
}

function handlesForTarget(target) {
    if (!target || !index) return null;
    if (target.kind === 'range') {
        return handlesForTracks(RivageListeningIndex.tracksPlayedBetween(index, target.from, target.to,
            { artistKey: focusArtist() ? focusArtist().key : '' }), false);
    }
    if (!target.entry) return null;
    if (target.kind === 'album') return handlesForTracks(target.entry.tracks, true);
    return handlesForTracks(byPlays(target.entry.tracks), false);
}

// ---------------------------------------------------------------------------
// Covers for the top lists. Requested with GetAlbumArtAsync when a row is painted
// on screen, cropped and scaled once, and cached by album (or artist), so tracks
// of one album share a cover. Artists try the artist picture, then the front
// cover of their most-played track.

var ART_FRONT = 0;
var ART_ARTIST = 4;
var COVER_CACHE_MAX = 160;
var COVER_PENDING_MAX = 24;
var coverCache = new Map();    // cover key -> GdiBitmap | null (no art) | undefined (loading)
var coverPending = new Map();  // handle|art_id -> [{ key, round, fallback handle }]
var coverMasks = {};

function coverKeyOf(kind, entry) {
    if (!index || !entry || !entry.tracks || !entry.tracks.length) return '';
    if (kind === 'artist') return 'artist|' + entry.key;
    if (kind === 'album') return 'album|' + entry.key;
    if (kind === 'track') {
        var track = index.tracks[entry.tracks[0]];
        if (!track) return '';
        return track.albumKey ? 'album|' + track.albumKey : 'track|' + entry.tracks[0];
    }
    return '';
}

function handleKey(handle, artId) {
    try { return handle.RawPath + '|' + handle.SubSong + '|' + artId; } catch (e) { return ''; }
}

function requestCoverArt(handle, artId, key, round, fallback) {
    var rk = handleKey(handle, artId);
    if (!rk) return false;
    var want = { key: key, round: round, fallback: fallback };
    var pending = coverPending.get(rk);
    if (pending) {
        pending.push(want);
        return true;
    }
    coverPending.set(rk, [want]);
    try {
        utils.GetAlbumArtAsync(window.ID, handle, artId, false, false, false);
        return true;
    } catch (e) {
        coverPending.delete(rk);
        return false;
    }
}

function requestCover(kind, entry, key) {
    if (coverPending.size >= COVER_PENDING_MAX) return;
    var trackIndex = kind === 'artist' ? byPlays(entry.tracks)[0] : entry.tracks[0];
    var track = index.tracks[trackIndex];
    var handle = track ? index.handles[track.libraryIndex] : null;
    if (!handle) { coverCache.set(key, null); return; }
    coverCache.set(key, undefined);
    var ok = kind === 'artist'
        ? requestCoverArt(handle, ART_ARTIST, key, true, handle)
        : requestCoverArt(handle, ART_FRONT, key, false, null);
    if (!ok) coverCache.set(key, null);
}

function coverSize() {
    return scaleUi(COVER);
}

function coverMask(size, round) {
    var id = (round ? 'r' : 's') + size;
    if (coverMasks[id]) return coverMasks[id];
    var mask = null;
    try {
        mask = gdi.CreateImage(size, size);
        var g = mask.GetGraphics();
        g.FillSolidRect(0, 0, size, size, 0xffffffff);   // white cuts
        g.SetSmoothingMode(4);
        if (round) g.FillEllipse(0, 0, size - 1, size - 1, 0xff000000);
        else g.FillRoundRect(0, 0, size - 1, size - 1, scaleUi(4), scaleUi(4), 0xff000000);
        mask.ReleaseGraphics(g);
    } catch (e) {
        mask = null;
    }
    coverMasks[id] = mask;
    return mask;
}

function makeThumb(image, round) {
    var size = coverSize();
    try {
        var side = Math.min(image.Width, image.Height);
        var cropped = image.Clone(Math.floor((image.Width - side) / 2), Math.floor((image.Height - side) / 2), side, side);
        var thumb = cropped.Resize(size, size, 7);
        var mask = coverMask(size, round);
        if (mask) thumb.ApplyMask(mask);
        return thumb;
    } catch (e) {
        return null;
    }
}

function storeCover(key, thumb) {
    if (!coverCache.has(key) && coverCache.size >= COVER_CACHE_MAX) {
        coverCache.delete(coverCache.keys().next().value);
    }
    coverCache.set(key, thumb);
}

function clearCovers() {
    coverCache.clear();
    coverPending.clear();
    coverMasks = {};
}

function on_get_album_art_done(handle, artId, image) {
    var wants = coverPending.get(handleKey(handle, artId));
    if (!wants) return;
    coverPending.delete(handleKey(handle, artId));
    var thumbs = {};
    for (var i = 0; i < wants.length; i++) {
        var want = wants[i];
        // No artist picture: fall back to the front cover of the same track.
        if (!image && want.fallback && requestCoverArt(want.fallback, ART_FRONT, want.key, want.round, null)) continue;
        var shape = want.round ? 'round' : 'square';
        if (thumbs[shape] === undefined) thumbs[shape] = image ? makeThumb(image, want.round) : null;
        storeCover(want.key, thumbs[shape]);
    }
    if (window.IsVisible) window.RepaintRect(layout.viewport.x, layout.viewport.y, layout.viewport.w, layout.viewport.h);
}

// ---------------------------------------------------------------------------
// Theme, fonts and scale. Font sizes follow the Last.fm and Last.fm Charts panels:
// 13 pt body, 15 pt headings, 18 pt figures, scaled by the host font size.

var FONT_SIZE = 13;
var ww = Math.max(0, Number(window.Width) || 0);
var wh = Math.max(0, Number(window.Height) || 0);
var uiScale = 1;
var sharedAlbumAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);
var hostInfo = RivageUI.hostInfo();
var theme = RivageUI.createTheme({ host: hostInfo, accent: sharedAlbumAccent });
var painter = RivageUI.createPainter({ scale: scaleUi, theme: theme });
var fonts = {};

function scaleUi(value) {
    value = Number(value) || 0;
    if (value === 0) return 0;
    return Math.max(1, Math.round(value * uiScale));
}

function currentAccent() {
    if (settings.accentMode === AccentMode.SHARED_ALBUM) return SharedAccentProtocol.opaque(sharedAlbumAccent);
    return RivageUI.opaque(RivageUI.DEFAULT_ACCENT);
}

function accentWithAlpha(alpha) {
    return RivageUI.withAlpha(currentAccent(), alpha);
}

function rebuildFonts(clearCache) {
    if (clearCache) RivageUI.clearFontCache();
    clearCovers();
    hostInfo = RivageUI.hostInfo();
    var family = hostInfo.fontFamily || 'Segoe UI';
    var hostSize = Number(hostInfo.scaleFontSize) || 12;
    uiScale = clamp(hostSize / 12, 0.75, 1.75);
    var pt = function (points) { return Math.max(8, Math.round(points * hostSize / 12)); };
    fonts.body = RivageUI.font(family, pt(FONT_SIZE), 0);
    fonts.bodyBold = RivageUI.font(family, pt(FONT_SIZE), 1);
    fonts.title = RivageUI.font(family, pt(FONT_SIZE + 2), 1);
    fonts.headline = RivageUI.font(family, pt(FONT_SIZE + 5), 1);
    fonts.small = RivageUI.font(family, pt(FONT_SIZE - 1), 0);
    fonts.eyebrow = RivageUI.font(family, pt(FONT_SIZE - 2), 1);
    fonts.tiny = RivageUI.font(family, pt(FONT_SIZE - 2), 0);
    var consoleFont = RivageUI.consoleFontInfo();
    fonts.tooltip = RivageUI.font(consoleFont.fontFamily, Math.max(8, consoleFont.fontSize), consoleFont.fontStyle || 0);
}

function refreshVisualResources(clearFonts) {
    if (clearFonts || !fonts.body) rebuildFonts(clearFonts);
    hostInfo = RivageUI.hostInfo();
    theme = RivageUI.createTheme({ host: hostInfo, accent: currentAccent() });
    painter.setTheme(theme);
    markLayout();
}

// Heat levels 0-4: nothing, then four accent strengths.
function heatColour(level) {
    if (level <= 0) return RivageUI.mix(theme.card, theme.textPrimary, theme.dark ? 0.07 : 0.06);
    var amounts = [0, 0.28, 0.48, 0.72, 1];
    return RivageUI.mix(theme.card, currentAccent(), amounts[level]);
}

function upColour() { return theme.success !== undefined ? theme.success : currentAccent(); }
function downColour() { return theme.danger !== undefined ? theme.danger : theme.textMuted; }

// ---------------------------------------------------------------------------
// Layout. Content is laid out in content coordinates (y from 0) and scrolled
// under the fixed header. Layout runs on the next paint after markLayout(), so a
// hidden panel does no work for changes it cannot show.

var PAD = 12;
var GAP = 10;
var ROW = 30;
var COVER = 22;
var SECTION_HEADER = 36;
var RANK_W = 24;

var layout = {
    header: RivageUI.rect(0, 0, 0, 0),
    title: RivageUI.rect(0, 0, 0, 0),
    subtitle: RivageUI.rect(0, 0, 0, 0),
    chips: [],
    periodPill: RivageUI.rect(0, 0, 0, 0),
    periodText: '',
    viewport: RivageUI.rect(0, 0, 0, 0),
    contentHeight: 0,
    blocks: [],     // cards to paint: { type, rect, ... }
    hits: [],       // list rows: { kind, rect, entry, rank }
    bars: [],       // bar charts: { rect, value, colour, lines }
    heat: null      // heatmap geometry and cells
};
var layoutDirty = true;
var scrollY = 0;

function markLayout() {
    layoutDirty = true;
    window.Repaint();
}

function maxScroll() {
    return Math.max(0, layout.contentHeight - layout.viewport.h);
}

function layoutPanel() {
    layoutDirty = false;
    var pad = scaleUi(PAD);
    var gap = scaleUi(GAP);
    layout.blocks = [];
    layout.hits = [];
    layout.bars = [];
    layout.heat = null;
    if (ww <= 0 || wh <= 0 || !fonts.body) return;

    var s = buildState === 'error' ? null : ensureSummary();
    layoutHeader();

    var top = layout.header.y + layout.header.h + gap;
    layout.viewport = RivageUI.rect(pad, top, Math.max(0, ww - pad * 2), Math.max(0, wh - top - pad));
    var width = layout.viewport.w;
    var y = 0;

    var artistView = settings.view === View.ARTIST && !drill;
    var message = null;
    if (s && index.eventTimes.length && artistView) {
        if (!currentArtist) {
            message = { heading: 'No track to follow',
                detail: 'Play something, or select a track, and its artist appears here. ' +
                    'Which track it follows is set under Settings > Rewind > Current artist follows.' };
        } else if (!s.plays) {
            message = { heading: currentArtist.label + ': no plays in ' + periodPhrase(settings.period),
                detail: 'Try a longer period from the menu at the top right.' };
        }
    }
    if (!s || !index.eventTimes.length || message) {
        layout.blocks.push({ type: 'message', rect: RivageUI.rect(0, 0, width, scaleUi(130)), message: message });
        layout.contentHeight = scaleUi(130);
        scrollY = clamp(scrollY, 0, maxScroll());
        return;
    }

    y = layoutMetrics(s, width, y) + gap;
    var focus = focusArtist();
    var rhythm = { type: 'rhythm', title: focus ? 'When you listen to ' + focus.label : 'When you listen' };
    var trend = { type: 'trend', title: '' };
    if (focus) {
        y = layoutColumns([
            listCard('Top tracks', 'track', s.topTracks),
            listCard('Top albums', 'album', s.topAlbums)
        ], width, y) + gap;
        y = layoutTrend(trend, s, width, y) + gap;
        y = layoutHeatmap(s, width, y) + gap;
        y = layoutColumns([rhythm], width, y);
    } else if (settings.view === View.HEATMAP) {
        y = layoutHeatmap(s, width, y) + gap;
        y = layoutColumns([rhythm], width, y);
    } else {
        var cards = [
            listCard('Top artists', 'artist', s.topArtists),
            listCard('Top albums', 'album', s.topAlbums),
            listCard('Top tracks', 'track', s.topTracks)
        ];
        if (s.topGenres.length) cards.push(listCard('Top genres', 'genre', s.topGenres));
        // Over All time every artist is "new", so the list would repeat Top artists.
        if (summaryPeriod.id !== 'all') {
            var discovery = listCard('New artists', 'artist', s.discoveries);
            discovery.empty = 'No artist heard for the first time in this period';
            discovery.noRanks = true;
            cards.push(discovery);
            var comeback = listCard('Comebacks', 'album', comebackEntries());
            comeback.empty = 'No album back after a year or more away';
            comeback.noRanks = true;
            cards.push(comeback);
        }
        y = layoutColumns(cards, width, y) + gap;
        y = layoutTrend(trend, s, width, y) + gap;
        y = layoutColumns([rhythm], width, y);
    }
    layout.contentHeight = y;
    scrollY = clamp(scrollY, 0, maxScroll());
}

// Albums played in the period after a year or more without a play, cached with
// the summary. Rows read "Album - Artist - after 3 years".
var comebackCache = { key: null, entries: [] };

function comebackEntries() {
    if (comebackCache.key === summaryKey) return comebackCache.entries;
    var found = RivageListeningIndex.comebacks(index, summaryPeriod.from, summaryPeriod.to, { limit: settings.topCount });
    var out = [];
    for (var i = 0; i < found.length; i++) {
        var e = found[i];
        out.push({ key: e.key, label: e.label, plays: e.plays, tracks: e.tracks,
            sub: (e.sub ? e.sub + '  \u00B7  ' : '') + 'after ' + gapText(e.gapMs) });
    }
    comebackCache = { key: summaryKey, entries: out };
    return out;
}

// "14 months", "3 years".
function gapText(ms) {
    var days = ms / DAY_MS;
    if (days < 730) return Math.round(days / 30.44) + ' months';
    var years = Math.round(days / 365.25 * 10) / 10;
    return (years % 1 ? years.toFixed(1) : String(years)) + ' years';
}

function listCard(title, kind, entries) {
    return { type: 'list', title: title, kind: kind, entries: entries };
}

function layoutHeader() {
    var pad = scaleUi(PAD);
    var titleH = scaleUi(26);
    var chipH = scaleUi(28);
    var headerH = scaleUi(10) + titleH + scaleUi(8) + chipH + scaleUi(10);
    layout.header = RivageUI.rect(pad, pad, Math.max(0, ww - pad * 2), headerH);
    var innerX = layout.header.x + scaleUi(14);
    var innerW = Math.max(0, layout.header.w - scaleUi(28));
    var titleW = Math.min(innerW, Math.ceil(RivageUI.measureText('Rewind', fonts.title, true)) + scaleUi(4));
    layout.title = RivageUI.rect(innerX, layout.header.y + scaleUi(10), titleW, titleH);
    layout.subtitle = RivageUI.rect(innerX + titleW + scaleUi(10), layout.title.y,
        Math.max(0, innerW - titleW - scaleUi(10)), titleH);

    var rowY = layout.title.y + titleH + scaleUi(8);
    var x = innerX;
    var chips = drill
        ? [{ id: 'back', label: '\u2039  All artists' }]
        : [{ id: View.REWIND, label: 'Rewind' }, { id: View.HEATMAP, label: 'Heatmap' },
            { id: View.ARTIST, label: 'Current artist' }];
    layout.chips = [];
    for (var i = 0; i < chips.length; i++) {
        var w = Math.ceil(RivageUI.measureText(chips[i].label, fonts.body, true)) + scaleUi(24);
        layout.chips.push({ id: chips[i].id, label: chips[i].label, rect: RivageUI.rect(x, rowY, w, chipH) });
        x += w + scaleUi(6);
    }
    layout.periodText = periodRange(settings.period).label + '  \u25BE';
    // Exact measurement plus slack: sized to the pixel, rounding clipped it to "...".
    var periodW = Math.min(Math.max(0, innerX + innerW - x),
        Math.ceil(RivageUI.measureText(layout.periodText, fonts.body, true)) + scaleUi(34));
    layout.periodPill = RivageUI.rect(innerX + innerW - periodW, rowY, periodW, chipH);
}

// Change against the previous period, as { text, colour }, or null.
function delta(current, previous) {
    if (!prevSummary || previous === undefined || previous === null) return null;
    if (!previous) return current ? { text: 'new', colour: upColour() } : null;
    var change = (current - previous) * 100 / previous;
    if (Math.abs(change) < 0.5) return { text: '\u00B10%', colour: theme.textMuted };
    var rounded = Math.abs(change) >= 10 ? Math.round(change) : Math.round(change * 10) / 10;
    return change > 0
        ? { text: '\u25B2 ' + rounded + '%', colour: upColour() }
        : { text: '\u25BC ' + Math.abs(rounded) + '%', colour: downColour() };
}

function layoutMetrics(s, width, y) {
    var gap = scaleUi(GAP);
    var perRow = width >= scaleUi(560) ? 4 : 2;
    var tileW = Math.floor((width - gap * (perRow - 1)) / perRow);
    var tileH = scaleUi(70);
    var period = summaryPeriod;
    var spanDays = Math.max(1, Math.round((period.to - period.from) / DAY_MS));
    var streak = s.longestStreak;
    var p = prevSummary;
    var vs = p && period.prev ? 'vs ' + period.prev.label : '';
    var tiles = [
        { label: 'PLAYS', value: formatInteger(s.plays), change: delta(s.plays, p && p.plays),
            sub: vs || plural(s.distinctTracks, 'different track', 'different tracks') },
        { label: 'LISTENING TIME', value: formatInteger(s.listeningHours) + ' h',
            change: delta(s.listeningHours, p && p.listeningHours), sub: vs || 'estimated from track lengths' },
        { label: 'ACTIVE DAYS', value: formatInteger(s.activeDays), change: delta(s.activeDays, p && p.activeDays),
            sub: 'of ' + formatInteger(spanDays) }
    ];
    if (focusArtist()) {
        tiles.push({ label: 'FIRST HEARD', value: s.firstPlay && isFinite(s.firstPlay) ? formatDate(new Date(s.firstPlay), false) : '-',
            sub: percentOf(s.plays, periodTotalPlays()) + ' of all plays in this period' });
    } else {
        tiles.push({ label: 'LONGEST STREAK', value: plural(streak.days, 'day', 'days'),
            change: delta(streak.days, p && p.longestStreak.days),
            sub: streak.days ? 'ending ' + formatDate(dateFromDayNumber(streak.endDay), false) : '' });
    }
    for (var i = 0; i < tiles.length; i++) {
        var col = i % perRow;
        var row = Math.floor(i / perRow);
        layout.blocks.push({ type: 'metric', tile: tiles[i],
            rect: RivageUI.rect(col * (tileW + gap), y + row * (tileH + gap), tileW, tileH) });
    }
    return y + Math.ceil(tiles.length / perRow) * (tileH + gap) - gap;
}

function rhythmHeight() {
    return scaleUi(SECTION_HEADER + 18 + 70 + 16 + 18 + 60 + 12);
}

// Masonry: each card goes into the currently shortest column.
function layoutColumns(cards, width, y) {
    var gap = scaleUi(GAP);
    var columns = width >= scaleUi(900) ? 3 : (width >= scaleUi(560) ? 2 : 1);
    var colW = Math.floor((width - gap * (columns - 1)) / columns);
    var heights = [];
    for (var c = 0; c < columns; c++) heights.push(y);

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var shortest = 0;
        for (c = 1; c < columns; c++) if (heights[c] < heights[shortest]) shortest = c;
        var h = card.type === 'rhythm'
            ? rhythmHeight()
            : scaleUi(SECTION_HEADER) + Math.max(1, card.entries.length) * scaleUi(ROW) + scaleUi(10);
        // The rhythm card spans the full width when it is alone on its row.
        var cardW = card.type === 'rhythm' && cards.length === 1 ? width : colW;
        var rect = RivageUI.rect(shortest * (colW + gap), heights[shortest], cardW, h);
        card.rect = rect;
        layout.blocks.push(card);
        if (card.type === 'list') layoutRows(card);
        if (card.type === 'rhythm') layoutRhythm(card);
        heights[shortest] += h + gap;
    }
    var bottom = y;
    for (c = 0; c < columns; c++) bottom = Math.max(bottom, heights[c] - gap);
    return bottom;
}

function layoutRows(card) {
    var rect = card.rect;
    var ranks = prevSummary && !card.noRanks ? prevSummary.ranks[card.kind] : null;
    for (var r = 0; r < card.entries.length; r++) {
        var entry = card.entries[r];
        var change = null;
        if (ranks) {
            var before = ranks[entry.key];
            if (!before) change = { text: 'new', colour: currentAccent() };
            else if (before > r + 1) change = { text: '\u25B2' + (before - r - 1), colour: upColour() };
            else if (before < r + 1) change = { text: '\u25BC' + (r + 1 - before), colour: downColour() };
        }
        layout.hits.push({
            kind: card.kind, entry: entry, rank: r + 1, change: change,
            cover: settings.showCovers ? coverKeyOf(card.kind, entry) : '',
            max: card.entries[0].plays,
            rect: RivageUI.rect(rect.x + scaleUi(6), rect.y + scaleUi(SECTION_HEADER) + r * scaleUi(ROW),
                rect.w - scaleUi(12), scaleUi(ROW))
        });
    }
}

// Bar geometry for a chart area; each bar keeps its tooltip lines.
function layoutBars(x, y, w, h, values, labels, tips) {
    var max = 0;
    var i;
    for (i = 0; i < values.length; i++) max = Math.max(max, values[i]);
    var total = 0;
    for (i = 0; i < values.length; i++) total += values[i];
    var n = values.length;
    var slot = w / Math.max(1, n);
    var barW = Math.max(1, Math.floor(slot * 0.7));
    var labelH = scaleUi(16);
    var chartH = h - labelH;
    var out = [];
    for (i = 0; i < n; i++) {
        var bx = Math.round(x + i * slot + (slot - barW) / 2);
        var bh = max > 0 ? Math.max(values[i] > 0 ? 2 : 0, Math.round(chartH * values[i] / max)) : 0;
        var bar = {
            slot: RivageUI.rect(Math.round(x + i * slot), y, Math.max(1, Math.round(slot)), chartH),
            track: RivageUI.rect(bx, y, barW, chartH),
            fill: RivageUI.rect(bx, y + chartH - bh, barW, bh),
            top: values[i] === max && max > 0,
            label: labels[i] || '',
            labelRect: RivageUI.rect(Math.round(x + i * slot) - scaleUi(12), y + chartH, Math.round(slot) + scaleUi(24), labelH),
            lines: [tips[i], plural(values[i], 'play', 'plays') + (total ? '  \u00B7  ' + percentOf(values[i], total) : '')]
        };
        out.push(bar);
        layout.bars.push(bar);
    }
    return out;
}

function layoutRhythm(card) {
    var r = card.rect;
    var x = r.x + scaleUi(14);
    var w = r.w - scaleUi(28);
    var y = r.y + scaleUi(SECTION_HEADER);
    var weekStart = settings.weekStartsMonday ? 1 : 0;
    var values = [], labels = [], tips = [];
    for (var i = 0; i < 7; i++) {
        var d = (weekStart + i) % 7;
        values.push(summary.weekdays[d]);
        labels.push(WEEKDAYS_SHORT[d]);
        tips.push(WEEKDAYS_LONG[d]);
    }
    var busiestWeekday = 0;
    for (i = 1; i < 7; i++) if (summary.weekdays[i] > summary.weekdays[busiestWeekday]) busiestWeekday = i;
    card.weekdayCaption = { text: 'By weekday \u00B7 most on ' + WEEKDAYS_LONG[busiestWeekday],
        rect: RivageUI.rect(x, y, w, scaleUi(16)) };
    card.weekdayBars = layoutBars(x, y + scaleUi(18), w, scaleUi(70), values, labels, tips);

    y += scaleUi(18 + 70 + 16);
    var busiestHour = 0;
    for (i = 1; i < 24; i++) if (summary.hours[i] > summary.hours[busiestHour]) busiestHour = i;
    var hourLabels = [], hourTips = [];
    for (i = 0; i < 24; i++) {
        hourLabels.push(i % 6 === 0 ? String(i) : '');
        hourTips.push(i + ':00 \u2013 ' + (i + 1) + ':00');
    }
    card.hourCaption = { text: 'By hour \u00B7 busiest ' + busiestHour + ':00\u2013' + (busiestHour + 1) + ':00',
        rect: RivageUI.rect(x, y, w, scaleUi(16)) };
    card.hourBars = layoutBars(x, y + scaleUi(18), w, scaleUi(60), summary.hours, hourLabels, hourTips);
}

// First year from `firstYear` on that has any plays, so long periods skip the
// empty years before the first listen. Gaps after it are kept.
function firstPlayedYear(s, firstYear, lastYear) {
    for (var year = firstYear; year < lastYear; year++) {
        for (var m = 1; m <= 12; m++) if (s.months[year * 100 + m]) return year;
    }
    return lastYear;
}

// Plays per month for the period, or per year for long periods: { byYear, values, labels, tips }.
function trendSeries(s) {
    var period = summaryPeriod;
    var start = new Date(period.from);
    var end = new Date(period.to - 1);
    var out = { byYear: period.months, values: [], labels: [], tips: [] };
    if (out.byYear) {
        for (var year = firstPlayedYear(s, start.getFullYear(), end.getFullYear()); year <= end.getFullYear(); year++) {
            var sum = 0;
            for (var m = 1; m <= 12; m++) sum += s.months[year * 100 + m] || 0;
            out.values.push(sum);
            out.labels.push("'" + String(year).slice(-2));
            out.tips.push(String(year));
        }
    } else {
        var cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cursor <= end) {
            out.values.push(s.months[cursor.getFullYear() * 100 + cursor.getMonth() + 1] || 0);
            out.labels.push(MONTHS_SHORT[cursor.getMonth()]);
            out.tips.push(MONTHS_SHORT[cursor.getMonth()] + ' ' + cursor.getFullYear());
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }
    }
    return out;
}

function layoutTrend(card, s, width, y) {
    var series = trendSeries(s);
    var byYear = series.byYear;
    var values = series.values, labels = series.labels, tips = series.tips;
    var i;
    // A single month has nothing to show over time.
    if (values.length < 2) return y - scaleUi(GAP);
    // Thin the labels so the widest one still fits with a little air around it.
    var labelW = 0;
    for (i = 0; i < labels.length; i++) labelW = Math.max(labelW, RivageUI.measureText(labels[i], fonts.tiny, true));
    var perLabel = Math.max(scaleUi(20), Math.ceil(labelW) + scaleUi(8));
    var every = Math.ceil(values.length / Math.max(1, Math.floor((width - scaleUi(28)) / perLabel)));
    for (i = 0; i < labels.length; i++) if (i % every !== 0) labels[i] = '';

    card.title = byYear ? 'Plays per year' : 'Plays per month';
    var h = scaleUi(SECTION_HEADER + 90 + 12);
    card.rect = RivageUI.rect(0, y, width, h);
    layout.blocks.push(card);
    card.bars = layoutBars(scaleUi(14), y + scaleUi(SECTION_HEADER), width - scaleUi(28), scaleUi(90), values, labels, tips);
    return y + h;
}

// Weeks as columns and weekdays as rows, or, for long periods, years as rows and
// months as columns. Cells are precomputed here so painting is a single loop.
function layoutHeatmap(s, width, y) {
    var period = summaryPeriod;
    var inner = scaleUi(14);
    var labelH = scaleUi(16);
    var legendH = scaleUi(20);
    var cells = [];
    var labels = [];
    var gridX, gridY, cell, gap, rows, cols, gridH, i, r, m;
    var cardTop = y;
    var contentTop = y + scaleUi(SECTION_HEADER);
    var today = startOfDay(new Date());

    if (period.months) {
        var lastYear = new Date(period.to - 1).getFullYear();
        var firstYear = firstPlayedYear(s, new Date(period.from).getFullYear(), lastYear);
        rows = lastYear - firstYear + 1;
        cols = 12;
        var yearLabelW = Math.ceil(RivageUI.measureText('0000', fonts.tiny, true)) + scaleUi(8);
        cell = Math.floor(Math.min(scaleUi(34), (width - inner * 2 - yearLabelW) / cols));
        gap = Math.max(1, Math.round(cell * 0.14));
        cell = Math.max(scaleUi(6), cell - gap);
        gridX = inner + yearLabelW;
        gridY = contentTop + labelH;
        for (m = 0; m < 12; m++) {
            labels.push({ text: MONTHS_SHORT[m], x: gridX + m * (cell + gap), y: contentTop, w: cell + gap, center: true });
        }
        for (r = 0; r < rows; r++) {
            var year = lastYear - r;
            labels.push({ text: String(year), x: inner, y: gridY + r * (cell + gap), w: yearLabelW - scaleUi(6), h: cell, right: true });
            for (m = 0; m < 12; m++) {
                var monthStart = new Date(year, m, 1);
                if (monthStart > today) continue;
                cells.push({
                    x: gridX + m * (cell + gap), y: gridY + r * (cell + gap), w: cell, h: cell,
                    value: s.months[year * 100 + m + 1] || 0,
                    from: monthStart.getTime(), to: new Date(year, m + 1, 1).getTime(),
                    label: MONTHS_SHORT[m] + ' ' + year
                });
            }
        }
        gridH = rows * (cell + gap) - gap;
    } else {
        var from = startOfDay(new Date(period.from));
        var lastDay = addDays(startOfDay(new Date(period.to)), -1);
        var weekStart = settings.weekStartsMonday ? 1 : 0;
        var colStart = addDays(from, -((from.getDay() - weekStart + 7) % 7));
        cols = Math.max(1, Math.ceil((Math.round((lastDay - colStart) / DAY_MS) + 1) / 7));
        var dayLabelW = Math.ceil(RivageUI.measureText('Wed', fonts.tiny, true)) + scaleUi(8);
        cell = Math.floor(Math.min(scaleUi(30), (width - inner * 2 - dayLabelW) / cols));
        gap = Math.max(1, Math.round(cell * 0.18));
        cell = Math.max(scaleUi(3), cell - gap);
        gridX = inner + dayLabelW;
        gridY = contentTop + labelH;
        for (r = 0; r < 7; r += 2) {
            labels.push({ text: WEEKDAYS_SHORT[(weekStart + r) % 7], x: inner, y: gridY + r * (cell + gap),
                w: dayLabelW - scaleUi(6), h: cell, right: true });
        }
        var lastLabelX = -1e9;
        for (var c = 0; c < cols; c++) {
            var columnFirst = addDays(colStart, c * 7);
            var cx = gridX + c * (cell + gap);
            // Label a column when the month changes within it, if there is room.
            for (var d = 0; d < 7; d++) {
                var dayInCol = addDays(columnFirst, d);
                if (dayInCol.getDate() === 1 && dayInCol >= from && dayInCol <= lastDay &&
                    cx - lastLabelX >= scaleUi(30)) {
                    labels.push({ text: MONTHS_SHORT[dayInCol.getMonth()], x: cx, y: contentTop, w: scaleUi(40) });
                    lastLabelX = cx;
                    break;
                }
            }
            for (d = 0; d < 7; d++) {
                var day = addDays(columnFirst, d);
                if (day < from || day > lastDay) continue;
                cells.push({
                    x: cx, y: gridY + d * (cell + gap), w: cell, h: cell,
                    value: s.days[RivageListeningIndex.dayNumber(day.getTime())] || 0,
                    from: day.getTime(), to: addDays(day, 1).getTime(),
                    label: formatDate(day, true)
                });
            }
        }
        gridH = 7 * (cell + gap) - gap;
    }

    // Quartiles of the non-empty cells decide the four accent levels.
    var values = [];
    for (i = 0; i < cells.length; i++) if (cells[i].value > 0) values.push(cells[i].value);
    values.sort(function (a, b) { return a - b; });
    var q = function (f) { return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * f))] : 0; };
    var q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    for (i = 0; i < cells.length; i++) {
        var v = cells[i].value;
        cells[i].level = v <= 0 ? 0 : (v <= q1 ? 1 : (v <= q2 ? 2 : (v <= q3 ? 3 : 4)));
    }

    var cardH = scaleUi(SECTION_HEADER) + labelH + gridH + scaleUi(12) + legendH + inner;
    var cardRect = RivageUI.rect(0, cardTop, width, cardH);
    layout.heat = {
        rect: cardRect, cells: cells, labels: labels, cell: cell,
        legendY: gridY + gridH + scaleUi(12), legendH: legendH, inner: inner,
        busiest: s.busiestDay
    };
    layout.blocks.push({ type: 'heatmap', rect: cardRect, title: period.months ? 'Plays per month' : 'Plays per day' });
    return cardTop + cardH;
}

// ---------------------------------------------------------------------------
// Painting

var hover = { row: null, cell: null, bar: null, chip: null };
var mouseX = -1;
var mouseY = -1;

function statusText() {
    if (buildState === 'building') {
        return (index ? 'updating\u2026 ' : 'reading\u2026 ') + Math.round(buildProgress * 100) + '%';
    }
    if (!summary) return '';
    return formatInteger(summary.plays) + ' plays';
}

function paintHeader(gr) {
    painter.card(gr, layout.header, { fill: theme.card, border: true, accent: true, accentColour: currentAccent() });
    gr.GdiDrawText('Rewind', fonts.title, currentAccent(), layout.title.x, layout.title.y,
        layout.title.w, layout.title.h, RivageUI.textFlags.leftEllipsis);

    var parts = [];
    if (focusArtist()) parts.push(focusArtist().label);
    parts.push(sourceLabel(settings.source));
    var status = statusText();
    if (status) parts.push(status);
    gr.GdiDrawText(parts.join('  \u00B7  '), fonts.body, theme.textMuted, layout.subtitle.x, layout.subtitle.y,
        layout.subtitle.w, layout.subtitle.h, RivageUI.textFlags.leftEllipsis);

    for (var i = 0; i < layout.chips.length; i++) {
        var chip = layout.chips[i];
        painter.chip(gr, chip.rect, { selected: chip.id === settings.view && !drill, hovered: hover.chip === chip.id },
            { accent: currentAccent(), text: chip.label, font: fonts.body, paddingX: 12,
                textFlags: RivageUI.textFlags.centered });
    }
    if (layout.periodPill.w > scaleUi(30)) {
        painter.chip(gr, layout.periodPill, { hovered: hover.chip === 'period' },
            { accent: currentAccent(), text: layout.periodText, font: fonts.body, paddingX: 12,
                textFlags: RivageUI.textFlags.centered, indicator: false });
    }
}

function paintMessage(gr, rect, message) {
    painter.card(gr, rect, { fill: theme.card, border: true });
    var heading, detail;
    if (message) {
        heading = message.heading;
        detail = message.detail;
    } else if (buildState === 'building' || buildState === 'idle') {
        heading = 'Reading your listening history\u2026 ' + Math.round(buildProgress * 100) + '%';
        detail = 'foobar2000 stays usable while this runs; it happens once, then only changed tracks are re-read.';
    } else if (buildState === 'error') {
        heading = 'Listening history could not be read';
        detail = buildError;
    } else {
        heading = 'No ' + sourceLabel(settings.source).toLowerCase() + ' found';
        detail = settings.source === Source.LOCAL
            ? 'Local plays need Enhanced Playback Statistics (foo_enhanced_playcount).'
            : 'Scrobbles appear after Enhanced Playback Statistics imports your Last.fm history. ' +
              'Switch to Local plays from the right-click menu.';
    }
    gr.GdiDrawText(heading, fonts.bodyBold, theme.textPrimary, rect.x + scaleUi(16), rect.y + scaleUi(28),
        rect.w - scaleUi(32), scaleUi(24), RivageUI.textFlags.centeredEllipsis);
    gr.GdiDrawText(detail, fonts.body, theme.textMuted, rect.x + scaleUi(16), rect.y + scaleUi(58),
        rect.w - scaleUi(32), scaleUi(50), RivageUI.textFlags.wordBreakCentered);
}

function paintMetric(gr, block) {
    var r = block.rect;
    var tile = block.tile;
    painter.card(gr, r, { fill: theme.card, border: true });
    var x = r.x + scaleUi(12);
    var w = r.w - scaleUi(24);
    gr.GdiDrawText(tile.label, fonts.eyebrow, theme.textMuted, x, r.y + scaleUi(9), w, scaleUi(16),
        RivageUI.textFlags.leftEllipsis);
    if (tile.change) {
        gr.GdiDrawText(tile.change.text, fonts.eyebrow, tile.change.colour, x, r.y + scaleUi(9), w, scaleUi(16),
            RivageUI.textFlags.right);
    }
    gr.GdiDrawText(tile.value, fonts.headline, theme.textPrimary, x, r.y + scaleUi(25), w, scaleUi(26),
        RivageUI.textFlags.leftEllipsis);
    if (tile.sub) {
        gr.GdiDrawText(tile.sub, fonts.tiny, theme.textMuted, x, r.y + scaleUi(50), w, scaleUi(15),
            RivageUI.textFlags.leftEllipsis);
    }
}

function paintSectionTitle(gr, rect, title, right) {
    var x = rect.x + scaleUi(12);
    var w = rect.w - scaleUi(24);
    gr.GdiDrawText(title, fonts.bodyBold, theme.textPrimary, x, rect.y + scaleUi(8), w, scaleUi(22),
        RivageUI.textFlags.leftEllipsis);
    if (right) {
        gr.GdiDrawText(right, fonts.small, theme.textMuted, x, rect.y + scaleUi(8), w, scaleUi(22),
            RivageUI.textFlags.right);
    }
}

function paintList(gr, block) {
    var r = block.rect;
    painter.card(gr, r, { fill: theme.card, border: true });
    paintSectionTitle(gr, r, block.title, '');
    if (!block.entries.length) {
        gr.GdiDrawText(block.empty || 'Nothing in this period', fonts.body, theme.textMuted,
            r.x + scaleUi(12), r.y + scaleUi(SECTION_HEADER), r.w - scaleUi(24), scaleUi(ROW),
            RivageUI.textFlags.leftEllipsis);
        return;
    }
    for (var i = 0; i < layout.hits.length; i++) {
        var hit = layout.hits[i];
        if (block.entries.indexOf(hit.entry) >= 0) paintRow(gr, hit);
    }
}

function paintRow(gr, hit) {
    var r = hit.rect;
    var hovered = hover.row === hit;
    // Share bar behind the row, relative to the list's first entry.
    var share = hit.max > 0 ? hit.entry.plays / hit.max : 0;
    gr.FillSolidRect(r.x, r.y + scaleUi(3), Math.max(1, Math.round(r.w * share)), r.h - scaleUi(6),
        accentWithAlpha(hovered ? 70 : 38));
    if (hovered) gr.FillSolidRect(r.x, r.y + scaleUi(3), r.w, r.h - scaleUi(6), RivageUI.withAlpha(theme.textPrimary, 14));

    var rankW = scaleUi(RANK_W);
    var countText = formatInteger(hit.entry.plays);
    var countW = Math.ceil(RivageUI.measureText(countText, fonts.small, true)) + scaleUi(8);
    var changeW = 0;
    if (hit.change) changeW = Math.ceil(RivageUI.measureText(hit.change.text, fonts.tiny, true)) + scaleUi(10);

    gr.GdiDrawText(String(hit.rank), fonts.small, hovered ? theme.textSecondary : theme.textMuted,
        r.x + scaleUi(4), r.y, rankW, r.h, RivageUI.textFlags.leftCentered);
    var textX = r.x + scaleUi(4) + rankW;
    if (hit.cover) {
        paintCover(gr, hit, textX, r.y + Math.round((r.h - coverSize()) / 2));
        textX += coverSize() + scaleUi(8);
    }
    var textW = Math.max(0, r.x + r.w - textX - countW - changeW - scaleUi(4));
    var fullLabel = hit.entry.sub ? hit.entry.label + ' - ' + hit.entry.sub : hit.entry.label;
    // Measured once per layout; a clipped label gets the full text as a tooltip.
    if (hit.labelW === undefined) hit.labelW = RivageUI.measureText(fullLabel, fonts.body, true) + scaleUi(8);
    hit.truncated = hit.labelW > textW;
    var label = hit.entry.label;
    if (hit.entry.sub) label += '  \u00B7  ' + hit.entry.sub;
    gr.GdiDrawText(label, fonts.body, hovered ? theme.textPrimary : theme.textSecondary, textX, r.y, textW, r.h,
        RivageUI.textFlags.leftEllipsis);
    if (hit.change) {
        gr.GdiDrawText(hit.change.text, fonts.tiny, hit.change.colour, r.x, r.y, r.w - countW - scaleUi(4), r.h,
            RivageUI.textFlags.right);
    }
    gr.GdiDrawText(countText, fonts.small, theme.textMuted, r.x, r.y, r.w - scaleUi(4), r.h,
        RivageUI.textFlags.right);
}

function paintCover(gr, hit, x, y) {
    var size = coverSize();
    var img = coverCache.get(hit.cover);
    if (img) {
        gr.DrawImage(img, x, y, size, size, 0, 0, img.Width, img.Height);
        return;
    }
    var round = hit.kind === 'artist';
    var fill = heatColour(0);
    gr.SetSmoothingMode(4);
    if (round) gr.FillEllipse(x, y, size - 1, size - 1, fill);
    else gr.FillRoundRect(x, y, size - 1, size - 1, scaleUi(4), scaleUi(4), fill);
    gr.SetSmoothingMode(0);
    // Only rows actually on screen ask for their cover.
    var v = layout.viewport;
    if (!coverCache.has(hit.cover) && y + size > v.y && y < v.y + v.h) requestCover(hit.kind, hit.entry, hit.cover);
}

function paintBars(gr, bars) {
    for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        var hovered = hover.bar === bar;
        gr.FillSolidRect(bar.track.x, bar.track.y, bar.track.w, bar.track.h, heatColour(0));
        if (bar.fill.h > 0) {
            gr.FillSolidRect(bar.fill.x, bar.fill.y, bar.fill.w, bar.fill.h,
                hovered || bar.top ? currentAccent() : accentWithAlpha(150));
        }
        if (hovered) gr.DrawRect(bar.track.x, bar.track.y, bar.track.w - 1, bar.track.h - 1, 1, theme.textPrimary);
        if (bar.label) {
            gr.GdiDrawText(bar.label, fonts.tiny, theme.textMuted, bar.labelRect.x, bar.labelRect.y,
                bar.labelRect.w, bar.labelRect.h, RivageUI.textFlags.centered);
        }
    }
}

function paintRhythm(gr, block) {
    painter.card(gr, block.rect, { fill: theme.card, border: true });
    paintSectionTitle(gr, block.rect, block.title, '');
    var captions = [block.weekdayCaption, block.hourCaption];
    for (var i = 0; i < captions.length; i++) {
        var c = captions[i];
        gr.GdiDrawText(c.text, fonts.small, theme.textMuted, c.rect.x, c.rect.y, c.rect.w, c.rect.h,
            RivageUI.textFlags.leftEllipsis);
    }
    paintBars(gr, block.weekdayBars);
    paintBars(gr, block.hourBars);
}

function paintTrend(gr, block) {
    painter.card(gr, block.rect, { fill: theme.card, border: true });
    paintSectionTitle(gr, block.rect, block.title, '');
    paintBars(gr, block.bars);
}

function paintHeatmap(gr, block) {
    var heat = layout.heat;
    if (!heat) return;
    var r = block.rect;
    painter.card(gr, r, { fill: theme.card, border: true });
    var busiest = heat.busiest
        ? 'Busiest day: ' + formatDate(dateFromDayNumber(heat.busiest.day), true) + ' \u00B7 ' +
            plural(heat.busiest.plays, 'play', 'plays')
        : '';
    paintSectionTitle(gr, r, block.title, busiest);

    var i;
    for (i = 0; i < heat.labels.length; i++) {
        var label = heat.labels[i];
        gr.GdiDrawText(label.text, fonts.tiny, theme.textMuted, label.x, label.y, label.w, label.h || scaleUi(16),
            label.right ? RivageUI.textFlags.right : (label.center ? RivageUI.textFlags.centered : RivageUI.textFlags.left));
    }
    var colours = [heatColour(0), heatColour(1), heatColour(2), heatColour(3), heatColour(4)];
    for (i = 0; i < heat.cells.length; i++) {
        var c = heat.cells[i];
        gr.FillSolidRect(c.x, c.y, c.w, c.h, colours[c.level]);
        if (hover.cell === c) gr.DrawRect(c.x, c.y, c.w - 1, c.h - 1, 1, theme.textPrimary);
    }

    // Legend, right-aligned: Less [0][1][2][3][4] More
    var sw = Math.min(scaleUi(12), Math.max(scaleUi(8), heat.cell));
    var lg = scaleUi(3);
    var moreW = Math.ceil(RivageUI.measureText('More', fonts.tiny, true));
    var lessW = Math.ceil(RivageUI.measureText('Less', fonts.tiny, true));
    var right = r.x + r.w - heat.inner;
    var ly = heat.legendY + Math.round((heat.legendH - sw) / 2);
    var x = right - moreW;
    gr.GdiDrawText('More', fonts.tiny, theme.textMuted, x, heat.legendY, moreW, heat.legendH, RivageUI.textFlags.left);
    x -= scaleUi(6);
    for (i = 4; i >= 0; i--) {
        x -= sw;
        gr.FillSolidRect(x, ly, sw, sw, colours[i]);
        x -= lg;
    }
    x -= scaleUi(3) + lessW;
    gr.GdiDrawText('Less', fonts.tiny, theme.textMuted, x, heat.legendY, lessW, heat.legendH, RivageUI.textFlags.left);
}

// Blocks are laid out in content coordinates. This moves every rect into panel
// coordinates for the duration of a paint or hit test, then back.
function withShiftedLayout(fn) {
    var dx = layout.viewport.x;
    var dy = layout.viewport.y - scrollY;
    translateLayout(dx, dy);
    try { return fn(); } finally { translateLayout(-dx, -dy); }
}

function translateRect(rect, dx, dy) {
    rect.x += dx;
    rect.y += dy;
}

function translateLayout(dx, dy) {
    var i, j, block;
    function move(rect) {
        if (rect) translateRect(rect, dx, dy);
    }
    for (i = 0; i < layout.blocks.length; i++) {
        block = layout.blocks[i];
        move(block.rect);
        if (block.weekdayCaption) move(block.weekdayCaption.rect);
        if (block.hourCaption) move(block.hourCaption.rect);
    }
    for (i = 0; i < layout.hits.length; i++) move(layout.hits[i].rect);
    for (i = 0; i < layout.bars.length; i++) {
        var bar = layout.bars[i];
        move(bar.slot); move(bar.track); move(bar.fill); move(bar.labelRect);
    }
    if (layout.heat) {
        var heat = layout.heat;
        heat.legendY += dy;
        for (j = 0; j < heat.cells.length; j++) move(heat.cells[j]);
        for (j = 0; j < heat.labels.length; j++) move(heat.labels[j]);
    }
}

function paintContent(gr) {
    var v = layout.viewport;
    if (v.w <= 0 || v.h <= 0) return;
    var clipped = typeof gr.PushClip === 'function';
    if (clipped) gr.PushClip(v.x, v.y, v.w, v.h);
    try {
        withShiftedLayout(function () {
            for (var i = 0; i < layout.blocks.length; i++) {
                var block = layout.blocks[i];
                if (block.rect.y > v.y + v.h || block.rect.y + block.rect.h < v.y) continue;
                if (block.type === 'message') paintMessage(gr, block.rect, block.message);
                else if (block.type === 'metric') paintMetric(gr, block);
                else if (block.type === 'list') paintList(gr, block);
                else if (block.type === 'rhythm') paintRhythm(gr, block);
                else if (block.type === 'trend') paintTrend(gr, block);
                else if (block.type === 'heatmap') paintHeatmap(gr, block);
            }
        });
    } finally {
        if (clipped) gr.PopClip();
    }
    painter.scrollbar(gr, {
        x: v.x + v.w + scaleUi(4), y: v.y, height: v.h,
        contentHeight: layout.contentHeight, viewportHeight: v.h, scroll: scrollY
    });
}

function tooltipLines() {
    if (hover.bar) return hover.bar.lines;
    if (hover.row && hover.row.truncated) {
        var entry = hover.row.entry;
        var rowLines = [entry.label];
        if (entry.sub) rowLines.push(entry.sub);
        rowLines.push(plural(entry.plays, 'play', 'plays'));
        return rowLines;
    }
    var cell = hover.cell;
    if (cell && index) {
        var lines = [cell.label, cell.value ? plural(cell.value, 'play', 'plays') : 'No plays'];
        if (cell.value) {
            if (!cell.top) {
                var s = RivageListeningIndex.summarise(index, cell.from, cell.to,
                    { limit: 3, artistKey: focusArtist() ? focusArtist().key : '' });
                cell.top = focusArtist() ? s.topTracks : s.topArtists;
            }
            for (var i = 0; i < cell.top.length; i++) {
                lines.push(cell.top[i].label + ' (' + formatInteger(cell.top[i].plays) + ')');
            }
            lines.push('Click to select, right-click to play');
        }
        return lines;
    }
    return null;
}

function paintTooltip(gr) {
    var lines = tooltipLines();
    if (!lines || !fonts.tooltip) return;
    var widest = 0;
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, RivageUI.measureText(lines[i], fonts.tooltip, false));
    var w = Math.min(Math.ceil(widest) + scaleUi(20), Math.max(0, ww - scaleUi(8)));
    var h = Math.min(lines.length * scaleUi(17) + scaleUi(12), Math.max(0, wh - scaleUi(8)));
    var x = mouseX + scaleUi(14);
    var y = mouseY + scaleUi(14);
    if (x + w > ww - scaleUi(4)) x = mouseX - w - scaleUi(10);
    if (y + h > wh - scaleUi(4)) y = mouseY - h - scaleUi(10);
    x = clamp(x, scaleUi(4), Math.max(scaleUi(4), ww - w - scaleUi(4)));
    y = clamp(y, scaleUi(4), Math.max(scaleUi(4), wh - h - scaleUi(4)));
    painter.tooltipBox(gr, RivageUI.rect(x, y, w, h), lines, fonts.tooltip,
        { lineHeight: 17, paddingX: 9, paddingY: 6, stroke: accentWithAlpha(120) });
}

function on_paint(gr) {
    if (ww <= 0 || wh <= 0) return;
    buildGate.runFromPaint();
    if (layoutDirty) layoutPanel();
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);
    paintContent(gr);
    paintHeader(gr);
    paintTooltip(gr);
}

// ---------------------------------------------------------------------------
// Export: the current period as a 1080 x 1350 PNG card (portrait, the size
// social apps show uncropped), saved under the profile folder. Nothing is
// uploaded. Drawn in 540 x 675 design units at 2x; text goes through GDI+
// DrawString because GDI text leaves the alpha channel of a bitmap empty.

var EXPORT_W = 1080;
var EXPORT_H = 1350;
var EXPORT_K = 2;
var EXPORT_DIR = fb.ProfilePath + 'rvg-exports\\';

// StringFormat: alignment << 28 | line alignment << 24 | trimming << 20 | flags.
function exportTextFlags(align) {
    return ((align || 0) << 28) | (1 << 24) | (3 << 20) | 0x1000;
}

function exportCover(kind, entry, size) {
    if (!index || !entry || !entry.tracks || !entry.tracks.length) return null;
    var trackIndex = kind === 'artist' ? byPlays(entry.tracks)[0] : entry.tracks[0];
    var track = index.tracks[trackIndex];
    var handle = track ? index.handles[track.libraryIndex] : null;
    if (!handle) return null;
    var image = null;
    try {
        if (kind === 'artist') image = utils.GetAlbumArtV2(handle, ART_ARTIST, false);
        if (!image) image = utils.GetAlbumArtV2(handle, ART_FRONT, false);
    } catch (e) {
        image = null;
    }
    if (!image) return null;
    try {
        var side = Math.min(image.Width, image.Height);
        var cropped = image.Clone(Math.floor((image.Width - side) / 2), Math.floor((image.Height - side) / 2), side, side);
        var thumb = cropped.Resize(size, size, 7);
        var mask = coverMask(size, kind === 'artist');
        if (mask) thumb.ApplyMask(mask);
        return thumb;
    } catch (e2) {
        return null;
    }
}

function exportFileName() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var subject = (focusArtist() ? focusArtist().label + ' ' : '') + summaryPeriod.label;
    subject = subject.replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return 'Rewind - ' + subject + ' - ' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
        pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png';
}

function exportImage() {
    var s = index ? ensureSummary() : null;
    if (!s || !s.plays) return;
    var k = EXPORT_K;
    var u = function (v) { return Math.round(v * k); };
    var family = hostInfo.fontFamily || 'Segoe UI';
    var f = {
        eyebrow: RivageUI.font(family, u(11), 1),
        title: RivageUI.font(family, u(30), 1),
        sub: RivageUI.font(family, u(13), 0),
        figure: RivageUI.font(family, u(22), 1),
        label: RivageUI.font(family, u(10), 1),
        rowTitle: RivageUI.font(family, u(13), 1),
        rowSub: RivageUI.font(family, u(11), 0),
        small: RivageUI.font(family, u(11), 0),
        section: RivageUI.font(family, u(14), 1)
    };
    var accent = currentAccent();
    var bg = RivageUI.opaque(theme.background);
    var card = RivageUI.opaque(theme.card);
    var text = RivageUI.opaque(theme.textPrimary);
    var muted = RivageUI.opaque(theme.textMuted);
    var empty = RivageUI.mix(card, text, theme.dark ? 0.07 : 0.06);
    var exportPainter = RivageUI.createPainter({ scale: u, theme: theme });
    var coverPx = u(28);
    var focus = focusArtist();

    var img = gdi.CreateImage(EXPORT_W, EXPORT_H);
    var gr = img.GetGraphics();
    try {
        gr.SetTextRenderingHint(4);
        var draw = function (str, font, colour, x, y, w, h, align) {
            gr.DrawString(String(str), font, colour, u(x), u(y), u(w), u(h), exportTextFlags(align));
        };
        var box = function (x, y, w, h) {
            exportPainter.card(gr, RivageUI.rect(u(x), u(y), u(w), u(h)), { fill: card, border: true });
        };

        gr.FillSolidRect(0, 0, EXPORT_W, EXPORT_H, bg);
        gr.FillGradRect(0, 0, EXPORT_W, u(200), 90, RivageUI.mix(bg, accent, 0.28), bg);

        // Header
        draw('REWIND', f.eyebrow, accent, 24, 26, 492, 16, 0);
        draw(focus ? focus.label : summaryPeriod.label, f.title, text, 24, 42, 492, 40, 0);
        draw((focus ? summaryPeriod.label + '  \u00B7  ' : '') + sourceLabel(settings.source), f.sub, muted, 24, 82, 492, 20, 0);

        // Figures
        var tiles = [
            ['PLAYS', formatInteger(s.plays)],
            ['LISTENING TIME', formatInteger(s.listeningHours) + ' h'],
            ['ACTIVE DAYS', formatInteger(s.activeDays)],
            focus
                ? ['SHARE OF PLAYS', percentOf(s.plays, periodTotalPlays())]
                : ['LONGEST STREAK', plural(s.longestStreak.days, 'day', 'days')]
        ];
        var tileW = (492 - 3 * 8) / 4;
        for (var t = 0; t < tiles.length; t++) {
            var tx = 24 + t * (tileW + 8);
            box(tx, 114, tileW, 62);
            draw(tiles[t][0], f.label, muted, tx + 10, 122, tileW - 20, 14, 0);
            draw(tiles[t][1], f.figure, text, tx + 10, 138, tileW - 20, 30, 0);
        }

        var list = function (title, kind, entries, x, y, w, rows) {
            var rowH = 34;
            box(x, y, w, 34 + rows * rowH + 6);
            draw(title, f.section, text, x + 12, y + 8, w - 24, 20, 0);
            var n = Math.min(rows, entries.length);
            for (var r = 0; r < n; r++) {
                var e = entries[r];
                var ry = y + 34 + r * rowH;
                draw(String(r + 1), f.small, muted, x + 8, ry, 18, rowH, 1);
                var cx = x + 30;
                var cover = exportCover(kind, e, coverPx);
                if (cover) {
                    gr.DrawImage(cover, u(cx), u(ry + 3), coverPx, coverPx, 0, 0, cover.Width, cover.Height);
                } else if (kind === 'artist') {
                    gr.SetSmoothingMode(4);
                    gr.FillEllipse(u(cx), u(ry + 3), coverPx - 1, coverPx - 1, empty);
                    gr.SetSmoothingMode(0);
                } else {
                    gr.FillSolidRect(u(cx), u(ry + 3), coverPx, coverPx, empty);
                }
                var lx = cx + 36;
                var countW = 44;
                var lw = x + w - 10 - countW - lx;
                if (e.sub) {
                    draw(e.label, f.rowTitle, text, lx, ry + 2, lw, 17, 0);
                    draw(e.sub, f.rowSub, muted, lx, ry + 17, lw, 15, 0);
                } else {
                    draw(e.label, f.rowTitle, text, lx, ry, lw, rowH, 0);
                }
                draw(formatInteger(e.plays), f.small, muted, x + w - 10 - countW, ry, countW, rowH, 2);
            }
            if (!n) draw('Nothing in this period', f.rowSub, muted, x + 12, y + 34, w - 24, rowH, 0);
        };

        var colW = (492 - 8) / 2;
        if (focus) {
            list('Top tracks', 'track', s.topTracks, 24, 188, colW, 5);
            list('Top albums', 'album', s.topAlbums, 24 + colW + 8, 188, colW, 5);
            var series = trendSeries(s);
            if (series.values.length >= 2) {
                var ty = 408;
                box(24, ty, 492, 196);
                draw(series.byYear ? 'Plays per year' : 'Plays per month', f.section, text, 36, ty + 8, 468, 20, 0);
                var max = 0;
                var i;
                for (i = 0; i < series.values.length; i++) max = Math.max(max, series.values[i]);
                var slot = 468 / series.values.length;
                var every = Math.ceil(series.values.length / 14);
                var bw = Math.max(0.5, slot * 0.7);
                for (i = 0; i < series.values.length; i++) {
                    var bx = 36 + i * slot + (slot - bw) / 2;
                    var bh = max ? 130 * series.values[i] / max : 0;
                    gr.FillSolidRect(u(bx), u(ty + 38), Math.max(1, u(bw)), u(130), empty);
                    if (bh > 0) {
                        gr.FillSolidRect(u(bx), u(ty + 38 + 130 - bh), Math.max(1, u(bw)), Math.max(2, u(bh)),
                            series.values[i] === max ? accent : RivageUI.withAlpha(accent, 150));
                    }
                    if (i % every === 0) draw(series.labels[i], f.rowSub, muted, bx - 12, ty + 170, bw + 24, 18, 1);
                }
            }
        } else {
            list('Top artists', 'artist', s.topArtists, 24, 188, colW, 5);
            list('Top albums', 'album', s.topAlbums, 24 + colW + 8, 188, colW, 5);
            list('Top tracks', 'track', s.topTracks, 24, 408, 492, 5);
        }

        draw('foobar2000  \u00B7  RVG', f.small, muted, 24, 640, 240, 18, 0);
        draw(formatDate(new Date(summaryPeriod.from), false) + ' \u2013 ' + formatDate(new Date(summaryPeriod.to - 1), false),
            f.small, muted, 276, 640, 240, 18, 2);
    } finally {
        img.ReleaseGraphics(gr);
    }

    var path = EXPORT_DIR + exportFileName();
    try {
        if (!utils.IsDirectory(EXPORT_DIR)) utils.CreateFolder(EXPORT_DIR);
        if (img.SaveAs(path, 'image/png') === false) throw new Error('SaveAs failed');
    } catch (e) {
        try { console.log('[RVG Rewind] Could not save ' + path + ': ' + (e && e.message ? e.message : e)); } catch (e2) { }
        return;
    }
    try { utils.Run('explorer.exe', '/select,"' + path.replace(/"/g, '') + '"'); } catch (e3) { }
}

// ---------------------------------------------------------------------------
// Input

function inRect(rect, x, y) {
    return rect && x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function inViewport(x, y) {
    return inRect(layout.viewport, x, y);
}

// What is under the pointer, in content: { row, cell, bar }.
function contentAt(x, y) {
    var found = { row: null, cell: null, bar: null };
    if (!inViewport(x, y)) return found;
    withShiftedLayout(function () {
        var i;
        for (i = 0; i < layout.hits.length; i++) {
            var rect = layout.hits[i].rect;
            if (inRect(rect, x, y)) { found.row = layout.hits[i]; return; }
        }
        for (i = 0; i < layout.bars.length; i++) {
            if (inRect(layout.bars[i].slot, x, y)) { found.bar = layout.bars[i]; return; }
        }
        if (layout.heat) {
            var cells = layout.heat.cells;
            for (i = 0; i < cells.length; i++) {
                if (inRect(cells[i], x, y)) { found.cell = cells[i]; return; }
            }
        }
    });
    return found;
}

function chipAt(x, y) {
    for (var i = 0; i < layout.chips.length; i++) {
        if (inRect(layout.chips[i].rect, x, y)) return layout.chips[i].id;
    }
    if (layout.periodPill.w > scaleUi(30) && inRect(layout.periodPill, x, y)) return 'period';
    return null;
}

function on_mouse_move(x, y) {
    var moved = x !== mouseX || y !== mouseY;
    mouseX = x;
    mouseY = y;
    var found = contentAt(x, y);
    var chip = chipAt(x, y);
    var changed = found.row !== hover.row || found.cell !== hover.cell ||
        found.bar !== hover.bar || chip !== hover.chip;
    if (found.cell !== hover.cell && found.cell) found.cell.top = null;
    hover = { row: found.row, cell: found.cell, bar: found.bar, chip: chip };
    var clickable = chip || found.row || (found.cell && found.cell.value);
    window.SetCursor(clickable ? IDC_HAND : IDC_ARROW);
    // A tooltip follows the pointer, so it needs a repaint on every move.
    if (changed || (moved && (hover.cell || hover.bar || (hover.row && hover.row.truncated)))) window.Repaint();
}

function on_mouse_leave() {
    hover = { row: null, cell: null, bar: null, chip: null };
    window.Repaint();
}

function on_mouse_wheel(step) {
    var next = clamp(scrollY - step * scaleUi(ROW) * 3, 0, maxScroll());
    if (next === scrollY) return;
    scrollY = next;
    hover = { row: null, cell: null, bar: null, chip: null };
    window.Repaint();
}

function rowTarget(row) {
    return row ? { kind: row.kind, entry: row.entry } : null;
}

function targetAt(found) {
    if (found.row) return rowTarget(found.row);
    return found.cell && found.cell.value ? { kind: 'range', from: found.cell.from, to: found.cell.to } : null;
}

// What the library menu searches for; ranges and genres just search their own tracks.
function targetDescriptor(target) {
    if (!target || !target.entry) return null;
    var e = target.entry;
    if (target.kind === 'artist') return { type: 'artist', artist: e.label };
    if (target.kind === 'album') return { type: 'album', artist: e.sub, album: e.label };
    if (target.kind === 'track') return { type: 'track', artist: e.sub, title: e.label };
    return null;
}

function targetLabel(target) {
    return target && (target.kind === 'artist' || target.kind === 'album' || target.kind === 'track') ? target.kind : 'tracks';
}

// Left click drills into an artist, or selects everything else in the playlist.
// Playing is the right-click menu's job; middle click queues.
function on_mouse_lbtn_up(x, y) {
    var chip = chipAt(x, y);
    if (chip === 'period') { showPeriodMenu(layout.periodPill.x, layout.periodPill.y + layout.periodPill.h); return; }
    if (chip === 'back') { closeArtist(); return; }
    if (chip) { setView(chip); return; }
    var found = contentAt(x, y);
    if (found.row && found.row.kind === 'artist') { openArtist(found.row.entry); return; }
    var handles = handlesForTarget(targetAt(found));
    if (handles && handles.Count) RivageLibraryActions.reveal(handles);
}

function on_mouse_mbtn_up(x, y) {
    var handles = handlesForTarget(targetAt(contentAt(x, y)));
    if (handles && handles.Count) RivageLibraryActions.queue(handles);
}

function showPeriodMenu(x, y) {
    var menu = window.CreatePopupMenu();
    var choices = periodChoices();
    for (var i = 0; i < choices.length; i++) {
        menu.AppendMenuItem(MF_STRING | (choices[i].id === settings.period ? MF_CHECKED : 0), 100 + i, choices[i].label);
    }
    var id = menu.TrackPopupMenu(x, y);
    if (id >= 100 && id < 100 + choices.length) setPeriod(choices[id - 100].id);
}

function on_mouse_rbtn_up(x, y) {
    var found = contentAt(x, y);
    var target = targetAt(found);
    var menu = window.CreatePopupMenu();
    var viewMenu = window.CreatePopupMenu();
    var periodMenu = window.CreatePopupMenu();
    var sourceMenu = window.CreatePopupMenu();
    var sizeMenu = window.CreatePopupMenu();
    var choices = periodChoices();
    var libraryState = null;
    var i;

    if (target) {
        libraryState = RivageLibraryActions.appendHandles(menu, handlesForTarget(target),
            { separator: false, label: targetLabel(target), descriptor: targetDescriptor(target) });
        if (found.row && found.row.kind === 'artist') menu.AppendMenuItem(MF_STRING, 5, 'Open ' + found.row.entry.label.replace(/&/g, '&&'));
        menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    }
    if (drill) {
        menu.AppendMenuItem(MF_STRING, 6, 'Back to all artists');
        menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    }
    viewMenu.AppendMenuItem(MF_STRING | (settings.view === View.REWIND ? MF_CHECKED : 0), 10, 'Rewind');
    viewMenu.AppendMenuItem(MF_STRING | (settings.view === View.HEATMAP ? MF_CHECKED : 0), 11, 'Heatmap');
    viewMenu.AppendMenuItem(MF_STRING | (settings.view === View.ARTIST ? MF_CHECKED : 0), 12, 'Current artist');
    viewMenu.AppendTo(menu, drill ? MF_GRAYED : MF_STRING, 'View');
    for (i = 0; i < choices.length; i++) {
        periodMenu.AppendMenuItem(MF_STRING | (choices[i].id === settings.period ? MF_CHECKED : 0), 100 + i, choices[i].label);
    }
    periodMenu.AppendTo(menu, MF_STRING, 'Period');
    sourceMenu.AppendMenuItem(MF_STRING | (settings.source === Source.LASTFM ? MF_CHECKED : 0), 20, sourceLabel(Source.LASTFM));
    sourceMenu.AppendMenuItem(MF_STRING | (settings.source === Source.LOCAL ? MF_CHECKED : 0), 21, sourceLabel(Source.LOCAL));
    sourceMenu.AppendTo(menu, MF_STRING, 'Play history');
    for (i = 0; i < TOP_COUNT_CHOICES.length; i++) {
        sizeMenu.AppendMenuItem(MF_STRING | (TOP_COUNT_CHOICES[i] === settings.topCount ? MF_CHECKED : 0), 200 + i,
            String(TOP_COUNT_CHOICES[i]));
    }
    sizeMenu.AppendTo(menu, MF_STRING, 'Entries per list');
    menu.AppendMenuItem(MF_STRING | (settings.compare ? MF_CHECKED : 0), 31, 'Compare with the previous period');
    menu.AppendMenuItem(MF_STRING | (settings.showCovers ? MF_CHECKED : 0), 32, 'Show covers');
    menu.AppendMenuItem(MF_STRING | (settings.foldFeatured ? MF_CHECKED : 0), 30, 'Count featured artists as the main artist');
    menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    menu.AppendMenuItem(summary && summary.plays ? MF_STRING : MF_GRAYED, 41, 'Save as image\u2026');
    menu.AppendMenuItem(buildState === 'building' ? MF_GRAYED : MF_STRING, 40, 'Refresh');

    var id = menu.TrackPopupMenu(x, y);
    if (RivageLibraryActions.handle(libraryState, id)) return true;
    if (id === 5) {
        openArtist(found.row.entry);
    } else if (id === 6) {
        closeArtist();
    } else if (id >= 10 && id <= 12) {
        setView(id === 11 ? View.HEATMAP : (id === 12 ? View.ARTIST : View.REWIND));
    } else if (id >= 100 && id < 100 + choices.length) {
        setPeriod(choices[id - 100].id);
    } else if (id >= 200 && id < 200 + TOP_COUNT_CHOICES.length) {
        applyMySetting('topCount', TOP_COUNT_CHOICES[id - 200]);
    } else if (id === 20 || id === 21) {
        setSource(id === 21 ? Source.LOCAL : Source.LASTFM);
    } else if (id === 30) {
        applyMySetting('foldFeatured', !settings.foldFeatured);
    } else if (id === 31) {
        applyMySetting('compare', !settings.compare);
    } else if (id === 32) {
        applyMySetting('showCovers', !settings.showCovers);
    } else if (id === 40) {
        clearCovers();
        requestBuild(true);
    } else if (id === 41) {
        exportImage();
    }
    return true;
}

// ---------------------------------------------------------------------------
// Host callbacks

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        refreshVisualResources(false);
    })) return;

    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    // tab-switcher-right.js owns the global track source; this panel only adopts it.
    if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (settings.accentMode === AccentMode.SHARED_ALBUM) refreshVisualResources(false);
    }
}

// Enhanced Playback Statistics records a play (or a retag lands): re-read just those tracks.
function on_metadb_changed(handleList) {
    if (buildState === 'building') {
        try {
            if (!pendingChanges) pendingChanges = new FbMetadbHandleList();
            pendingChanges.AddRange(handleList);
        } catch (e) { }
        return;
    }
    if (index) applyChanges(handleList);
}

// Tracks added to or removed from the library shift every position: rebuild.
function on_library_items_added() {
    if (index) requestBuild(true);
}

function on_library_items_removed() {
    if (index) requestBuild(true);
}

// The Current artist view follows the track TrackContext resolves to.
function on_playback_new_track() {
    if (TrackContext.followsPlayback(settings.trackContextOverride)) refreshCurrentArtist();
}

function on_playback_stop(reason) {
    // 2 = starting another track: on_playback_new_track follows.
    if (Number(reason) !== 2) refreshCurrentArtist();
}

function on_item_focus_change() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) refreshCurrentArtist();
}

function on_playlist_switch() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) refreshCurrentArtist();
}

function on_playlist_items_selection_change() {
    if (TrackContext.followsSelection(settings.trackContextOverride)) refreshCurrentArtist();
}

function on_size(width, height) {
    ww = Math.max(0, Number(width) || 0);
    wh = Math.max(0, Number(height) || 0);
    layoutDirty = true;
}

function on_colours_changed() {
    refreshVisualResources(false);
}

function on_font_changed() {
    refreshVisualResources(true);
}

function on_script_unload() {
    if (buildJob) { try { buildJob.cancel(); } catch (e) { } }
}

refreshVisualResources(true);
SharedAccentProtocol.request();
TrackContext.onChange(refreshCurrentArtist);
TrackContext.requestSync();
refreshCurrentArtist();
requestBuild(true);
