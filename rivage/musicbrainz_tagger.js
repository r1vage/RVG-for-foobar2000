'use strict';

window.DrawMode = 0;

// Shared RVG services: theme/accent consumers, settings registry, Mica backdrop.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\visible_paint_work.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\mica_backdrop.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\cache_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\musicbrainz_gate.js");

const PANEL_VERSION = '1.4.0';

window.DefineScript(RivageUI.copy.popupTitle('MusicBrainz tagger'), {
    author: 'RivaGe',
    version: PANEL_VERSION
});

// Narrow failure reporting. Most empty catches in this file guard drawing
// calls and host reads that are expected to fail and stay silent on purpose.
// Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG MusicBrainz] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

const PROP = 'RVG MusicBrainz Tagger.';
const SETTINGS_PANEL_ID = 'musicbrainz_tagger';
const SETTINGS_PANEL_LABEL = 'MusicBrainz tagger';

const MB_ROOT = 'https://musicbrainz.org/ws/2';
// MusicBrainz caps anonymous clients at one request a second and rejects a
// generic User-Agent outright, so both are hard requirements, not tuning.
const MB_MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 45000;
const INC_BRIEF = 'artist-credits+labels+release-groups+media';
const INC_FULL = 'artist-credits+labels+release-groups+media+recordings';

const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_DELAY_MS = 60000;
const RETRY_JITTER_MS = 800;

const CACHE_DIR = fb.ProfilePath + 'jsplitter_musicbrainz_cache\\';
const CACHE_FILE = CACHE_DIR + 'release_lookups_v1.json';
const CACHE_VERSION = 1;
const CACHE_MAX_ENTRIES = 120;
const CACHE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const SELECTION_DEBOUNCE_MS = 180;

// Tag types that route names through foobar2000's ID3v2 frame table.
const ID3_EXTENSIONS = /\.(mp3|aac|aif|aiff|aifc|wav|dsf|dff|tta)$/i;

const MF_STRING = 0x00000000;
const MF_GRAYED = 0x00000001;
const IDC_ARROW = 32512;
const IDC_HAND = 32649;

const DT_LEFT = 0x00000000;
const DT_CENTER = 0x00000001;
const DT_RIGHT = 0x00000002;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const DT_END_ELLIPSIS = 0x00008000;

const SMOOTHING_MODE_DEFAULT = 0;
const SMOOTHING_MODE_ANTIALIAS = 4;
const DEFAULT_UWP_ACCENT = 0xff0078d4;

const MB_YES = 6;
const MB_BUTTONS_YESNO = 4;
const MB_ICON_WARNING = 48;

// Keep panel-rendered separators ASCII-only; some GDI setups misdecode the rest.
const SEPARATOR = ' | ';
const ARROW = ' -> ';

const CMD_SEARCH = 1;
const CMD_LOAD_TAG_MBID = 2;
const CMD_PASTE_MBID = 3;
const CMD_BACK = 4;
const CMD_OPEN_RELEASE = 5;
const CMD_COPY_MBID = 6;
const CMD_ALL_ON = 7;
const CMD_ALL_OFF = 8;
const CMD_RESET_FIELDS = 9;
const CMD_UNDO = 10;
const CMD_CLEAR_CACHE = 11;
const CMD_SETTINGS = 12;
const CMD_EDIT = 13;
const CMD_CUSTOM_SEARCH = 14;

// Album-scope values are identical for every track; track-scope values come from
// the paired MusicBrainz track and are skipped when the pairing is not 1:1.
// `tag` is the portable name every tag type understands; `fbTag`, where the two
// differ, is the name foobar2000's own ID3v2 table maps to the real frame.
const FIELD_DEFS = [
    { id: 'album', tag: 'ALBUM', label: 'Album', scope: 'album', def: true },
    { id: 'albumartist', tag: 'ALBUMARTIST', fbTag: 'ALBUM ARTIST', label: 'Album artist', scope: 'album', def: true },
    { id: 'albumartistsort', tag: 'ALBUMARTISTSORT', fbTag: 'ALBUMARTISTSORTORDER', label: 'Album artist sort order', scope: 'album', def: false },
    { id: 'date', tag: 'DATE', label: 'Date', scope: 'album', def: true },
    { id: 'originaldate', tag: 'ORIGINALDATE', fbTag: 'ORIGINAL RELEASE DATE', label: 'Original release date', scope: 'album', def: false },
    { id: 'totaldiscs', tag: 'TOTALDISCS', label: 'Total discs', scope: 'album', def: true },
    { id: 'label', tag: 'LABEL', fbTag: 'PUBLISHER', label: 'Label', scope: 'album', def: false },
    { id: 'catalognumber', tag: 'CATALOGNUMBER', label: 'Catalogue number', scope: 'album', def: false },
    { id: 'barcode', tag: 'BARCODE', label: 'Barcode', scope: 'album', def: false },
    { id: 'releasetype', tag: 'RELEASETYPE', label: 'Release type', scope: 'album', def: false },
    { id: 'releasestatus', tag: 'RELEASESTATUS', label: 'Release status', scope: 'album', def: false },
    { id: 'releasecountry', tag: 'RELEASECOUNTRY', label: 'Release country', scope: 'album', def: false },
    { id: 'musicbrainz_albumid', tag: 'MUSICBRAINZ_ALBUMID', label: 'MusicBrainz release ID', scope: 'album', def: true },
    { id: 'musicbrainz_releasegroupid', tag: 'MUSICBRAINZ_RELEASEGROUPID', label: 'MusicBrainz release group ID', scope: 'album', def: true },
    { id: 'musicbrainz_albumartistid', tag: 'MUSICBRAINZ_ALBUMARTISTID', label: 'MusicBrainz album artist ID', scope: 'album', def: true },

    { id: 'title', tag: 'TITLE', label: 'Title', scope: 'track', def: true },
    { id: 'artist', tag: 'ARTIST', label: 'Artist', scope: 'track', def: true },
    { id: 'artistsort', tag: 'ARTISTSORT', fbTag: 'ARTISTSORTORDER', label: 'Artist sort order', scope: 'track', def: false },
    { id: 'tracknumber', tag: 'TRACKNUMBER', label: 'Track number', scope: 'track', def: true },
    { id: 'totaltracks', tag: 'TOTALTRACKS', label: 'Total tracks', scope: 'track', def: true },
    { id: 'discnumber', tag: 'DISCNUMBER', label: 'Disc number', scope: 'track', def: true },
    { id: 'media', tag: 'MEDIA', fbTag: 'MEDIA TYPE', label: 'Media', scope: 'track', def: false },
    { id: 'musicbrainz_trackid', tag: 'MUSICBRAINZ_TRACKID', label: 'MusicBrainz recording ID', scope: 'track', def: true },
    { id: 'musicbrainz_releasetrackid', tag: 'MUSICBRAINZ_RELEASETRACKID', label: 'MusicBrainz track ID', scope: 'track', def: true },
    { id: 'musicbrainz_artistid', tag: 'MUSICBRAINZ_ARTISTID', label: 'MusicBrainz artist ID', scope: 'track', def: true }
];

let uiScale = 1;
let PAD = 14;
let HEADER_H = 88;
let SECTION_H = 28;
let RELEASE_H = 68;
let PAIR_H = 26;
let FIELD_H = 42;
let NOTE_H = 38;
let FOOTER_H = 48;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeAccentMode(value) {
    const mode = String(value || '').toLowerCase();
    return mode === 'fixed' || mode === 'host' ? mode : 'shared';
}

function normalizeTagStyle(value) {
    const style = String(value || '').toLowerCase();
    return style === 'foobar' || style === 'picard' ? style : 'auto';
}

function normalizeDateStyle(value) {
    return String(value || '').toLowerCase() === 'year' ? 'year' : 'full';
}

let contactInfo = String(window.GetProperty(PROP + 'Contact info', ''));
let searchLimit = clamp(Math.round(Number(window.GetProperty(PROP + 'Search limit', 12)) || 12), 5, 40);
let autoSearch = !!window.GetProperty(PROP + 'Auto search', false);
let searchTerms = null;
let tagStyle = normalizeTagStyle(window.GetProperty(PROP + 'Tag name style', 'auto'));
let dateStyle = normalizeDateStyle(window.GetProperty(PROP + 'Date style', 'full'));
let accentMode = normalizeAccentMode(window.GetProperty(PROP + 'Accent mode', 'shared'));

let ww = 0;
let wh = 0;
const colours = {};
let fonts = {};
let fontLayoutKey = '';
let sharedAlbumAccent = DEFAULT_UWP_ACCENT;
let hostAccent = DEFAULT_UWP_ACCENT;

// `colours` is mutated in place by updateTheme(), never reassigned, so the
// painter's reference stays live.
const painter = RivageUI.createPainter({ scale: scaleUi, theme: colours });

let view = 'releases';
let selection = null;
let candidates = [];
let chosenRelease = null;
let pairs = [];
let fields = [];

let displayRows = [];
let contentHeight = 0;
let scrollY = 0;
let hoverRow = -1;
let hoverButton = '';
let pointerX = -1;
let pointerY = -1;
let pointerInside = false;

let statusText = 'Select tracks in a playlist.';
let statusIsError = false;
let busy = false;

let generation = 0;
let scriptActive = true;
let initTimer = 0;
let selectionTimer = 0;
let initialLoadPending = true;

let requestQueue = [];
let requestContexts = new Map();
let requestTimer = 0;
let lastRequestAt = 0;
let blockedUntil = 0;
let requestWatchdog = 0;
let networkDebug = { state: 'idle', kind: '', at: 0, httpStatus: 0, detail: '' };

let cache = null;
let cacheDirty = false;

let undoState = null;
let lastWriteSummary = 'nothing written yet';

const tfSortKey = fb.TitleFormat('[%discnumber%]\u0001[%tracknumber%]');
const tfAlbum = fb.TitleFormat('%album%');
const tfAlbumArtist = fb.TitleFormat('$if2(%album artist%,%artist%)');
const tfAlbumId = fb.TitleFormat('%musicbrainz_albumid%');
const tfTitle = fb.TitleFormat('%title%');

function scaleUi(value) {
    return Math.max(1, Math.round(Number(value || 0) * uiScale));
}

function cleanSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function plural(n, singular, pluralForm) {
    return n + ' ' + (n === 1 ? singular : (pluralForm || singular + 's'));
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function clearTimer(timerId) {
    if (timerId) window.ClearTimeout(timerId);
}

function debugSnippet(value, maxLength) {
    const max = Math.max(40, Number(maxLength || 220));
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

function debugDateTime(value) {
    const time = Number(value || 0);
    if (!(time > 0)) return 'never';
    const d = new Date(time);
    function two(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
        ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

function setNetworkDebug(state, kind, detail, httpStatus) {
    networkDebug = {
        state: String(state || 'idle'),
        kind: String(kind || ''),
        at: Date.now(),
        httpStatus: Number(httpStatus || 0),
        detail: debugSnippet(detail, 240)
    };
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function firstUuid(value) {
    const match = String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    return match ? match[0].toLowerCase() : '';
}

function userAgent() {
    const contact = cleanSpaces(contactInfo);
    return 'RVG-MusicBrainzTagger/' + PANEL_VERSION +
        ' ( ' + (contact || 'https://github.com/r1vage/rvg-for-foobar2000') + ' )';
}

function requestHeaders() {
    return JSON.stringify({
        'User-Agent': userAgent(),
        'Accept': 'application/json'
    });
}

function joinCredit(credits) {
    if (!Array.isArray(credits)) return '';
    let out = '';
    for (let i = 0; i < credits.length; i++) {
        const entry = credits[i] || {};
        const artist = entry.artist || {};
        out += String(entry.name || artist.name || '');
        out += String(entry.joinphrase || '');
    }
    return cleanSpaces(out);
}

function joinCreditSort(credits) {
    if (!Array.isArray(credits)) return '';
    let out = '';
    for (let i = 0; i < credits.length; i++) {
        const entry = credits[i] || {};
        const artist = entry.artist || {};
        out += String(artist['sort-name'] || entry.name || artist.name || '');
        out += String(entry.joinphrase || '');
    }
    return cleanSpaces(out);
}

function creditIds(credits) {
    const out = [];
    if (!Array.isArray(credits)) return out;
    for (let i = 0; i < credits.length; i++) {
        const artist = (credits[i] || {}).artist || {};
        const id = String(artist.id || '');
        if (id && out.indexOf(id) < 0) out.push(id);
    }
    return out;
}

function labelValues(release, key) {
    const info = release && Array.isArray(release['label-info']) ? release['label-info'] : [];
    const out = [];
    for (let i = 0; i < info.length; i++) {
        const entry = info[i] || {};
        const value = key === 'label'
            ? String((entry.label || {}).name || '')
            : String(entry['catalog-number'] || '');
        if (value && out.indexOf(value) < 0) out.push(value);
    }
    return out;
}

// DATE only. MusicBrainz dates are YYYY, YYYY-MM or YYYY-MM-DD, so year-only
// truncates to the leading year rather than reformatting; anything unparseable
// is left alone.
function formatReleaseDate(value) {
    const text = String(value || '').trim();
    if (dateStyle !== 'year') return text;
    const year = text.match(/^\d{4}/);
    return year ? year[0] : text;
}

function releaseTypes(release) {
    const group = (release && release['release-group']) || {};
    const out = [];
    const primary = String(group['primary-type'] || '').toLowerCase();
    if (primary) out.push(primary);
    const secondary = Array.isArray(group['secondary-types']) ? group['secondary-types'] : [];
    for (let i = 0; i < secondary.length; i++) {
        const value = String(secondary[i] || '').toLowerCase();
        if (value && out.indexOf(value) < 0) out.push(value);
    }
    return out;
}

function mediaSummary(release) {
    release = release || {};
    const media = Array.isArray(release.media) ? release.media : [];
    const formats = [];
    let tracks = 0;
    for (let i = 0; i < media.length; i++) {
        const medium = media[i] || {};
        const format = String(medium.format || '');
        if (format && formats.indexOf(format) < 0) formats.push(format);
        tracks += Number(medium['track-count'] || 0);
    }
    if (!tracks) tracks = Number(release['track-count'] || 0);
    return { formats: formats, tracks: tracks, discs: media.length || 1 };
}

function candidateFromRelease(release, score, fromTag) {
    const summary = mediaSummary(release);
    return {
        id: String(release.id || ''),
        title: cleanSpaces(release.title),
        artist: joinCredit(release['artist-credit']),
        date: String(release.date || ''),
        country: String(release.country || ''),
        status: String(release.status || ''),
        type: releaseTypes(release).join(', '),
        labels: labelValues(release, 'label').join(', '),
        catno: labelValues(release, 'catalog').join(', '),
        formats: summary.formats.join(', '),
        trackCount: summary.tracks,
        discCount: summary.discs,
        score: Number(score || 0),
        fromTag: !!fromTag
    };
}

// A brief lookup carries media without tracks, so the flattened list is empty
// until the full lookup lands.
function flattenTracks(release) {
    const out = [];
    const media = release && Array.isArray(release.media) ? release.media : [];
    for (let m = 0; m < media.length; m++) {
        const medium = media[m] || {};
        const tracks = Array.isArray(medium.tracks) ? medium.tracks : [];
        for (let t = 0; t < tracks.length; t++) {
            out.push({ medium: medium, mediumIndex: m, track: tracks[t] || {} });
        }
    }
    return out;
}

function commonValue(values) {
    const counts = new Map();
    let best = '';
    let bestCount = 0;
    for (let i = 0; i < values.length; i++) {
        const value = cleanSpaces(values[i]);
        if (!value) continue;
        const next = (counts.get(value) || 0) + 1;
        counts.set(value, next);
        if (next > bestCount) {
            best = value;
            bestCount = next;
        }
    }
    return best;
}

function readSelection() {
    let handles = null;
    try {
        handles = plman.GetPlaylistSelectedItems(plman.ActivePlaylist);
    } catch (e) {
        reportFailure('the playlist selection could not be read', e);
        return null;
    }
    if (!handles || !handles.Count) return null;

    const count = handles.Count;
    let albums = [];
    let artists = [];
    let albumIds = [];
    let sortKeys = [];
    let titles = [];
    try {
        albums = tfAlbum.EvalWithMetadbs(handles);
        artists = tfAlbumArtist.EvalWithMetadbs(handles);
        albumIds = tfAlbumId.EvalWithMetadbs(handles);
        sortKeys = tfSortKey.EvalWithMetadbs(handles);
        titles = tfTitle.EvalWithMetadbs(handles);
    } catch (e) {
        reportFailure('the selection metadata could not be evaluated', e);
        return null;
    }

    // Ordered by disc/track then path so the pairing follows the album order the
    // files already claim, not the order they happen to sit in the playlist.
    const order = [];
    for (let i = 0; i < count; i++) {
        const parts = String(sortKeys[i] || '').split('\u0001');
        let path = '';
        try { path = String(handles[i].Path || ''); } catch (e) { }
        order.push({
            srcIndex: i,
            disc: Number(parts[0]) || 0,
            track: Number(parts[1]) || 0,
            path: path,
            title: cleanSpaces(titles[i])
        });
    }
    order.sort(function (a, b) {
        if (a.disc !== b.disc) return a.disc - b.disc;
        if (a.track !== b.track) return a.track - b.track;
        if (a.path !== b.path) return a.path < b.path ? -1 : 1;
        return a.srcIndex - b.srcIndex;
    });

    const album = commonValue(albums);
    const artist = commonValue(artists);
    return {
        handles: handles,
        count: count,
        order: order,
        album: album,
        artist: artist,
        tagMbid: firstUuid(commonValue(albumIds)),
        signature: album + '\u0001' + artist + '\u0001' + count + '\u0001' + (order.length ? order[0].path : '')
    };
}

function selectionLabel() {
    if (!selection) return 'No tracks selected';
    const bits = [plural(selection.count, 'track')];
    if (selection.artist) bits.push(selection.artist);
    if (selection.album) bits.push(selection.album);
    return bits.join(SEPARATOR);
}

function refreshSelection(allowAutoSearch) {
    const next = readSelection();
    const changed = !next || !selection || next.signature !== selection.signature;
    selection = next;

    if (changed) {
        resetToReleases();
        if (!selection) {
            statusText = 'Select the tracks of one album in a playlist.';
            statusIsError = false;
        } else {
            statusText = autoSearch && allowAutoSearch !== false
                ? 'Searching MusicBrainz\u2026'
                : 'Ready. Press Search to look this album up.';
            statusIsError = false;
            if (autoSearch && allowAutoSearch !== false) startSearch();
        }
    }
    rebuildRows();
}

function enqueueRequest(context) {
    if (!scriptActive) return;
    requestQueue.push(context);
    pumpRequestQueue();
}

function isTransientHttpStatus(status) {
    return status === 0 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function transientRetryDelay(retries) {
    const exponential = RETRY_BASE_MS * Math.pow(2, Math.max(0, Number(retries || 0)));
    return Math.min(exponential, RETRY_MAX_DELAY_MS) + Math.floor(Math.random() * (RETRY_JITTER_MS + 1));
}

function pumpRequestQueue() {
    if (!scriptActive) return;
    clearTimer(requestTimer);
    requestTimer = 0;

    while (requestQueue.length && requestQueue[0].generation !== generation) requestQueue.shift();
    if (!requestQueue.length) return;
    // Strictly serial: one in-flight request keeps the one-per-second rule
    // MusicBrainz enforces authoritative for the whole panel.
    if (requestContexts.size) return;

    const now = Date.now();
    const wait = Math.max(
        Math.max(0, MB_MIN_INTERVAL_MS - (now - lastRequestAt)),
        Math.max(0, blockedUntil - now),
        MusicBrainzGate.wait(MB_MIN_INTERVAL_MS, now)
    );
    if (wait > 0) {
        requestTimer = window.SetTimeout(pumpRequestQueue, wait);
        return;
    }

    const context = requestQueue.shift();
    if (context.generation !== generation) {
        pumpRequestQueue();
        return;
    }

    try {
        const taskId = utils.HTTPRequestAsync(0, context.url, requestHeaders());
        lastRequestAt = Date.now();
        requestContexts.set(taskId, context);
        armRequestWatchdog(taskId);
        MusicBrainzGate.announce(blockedUntil);
        setNetworkDebug('requesting', context.kind, context.url, 0);
    } catch (e) {
        // Deferred, or a host that throws for every URL would recurse through
        // the whole queue on one stack.
        const detail = String(e);
        window.SetTimeout(function () { handleRequestFailure(context, 0, detail); }, 0);
    }
}

// A request the host never settles would hold the serial queue forever, so
// give up on it and treat it like a dropped connection.
function armRequestWatchdog(taskId) {
    clearTimer(requestWatchdog);
    requestWatchdog = window.SetTimeout(function () {
        requestWatchdog = 0;
        if (!scriptActive) return;
        const context = requestContexts.get(taskId);
        if (!context) return;
        requestContexts.delete(taskId);
        if (context.generation !== generation) {
            pumpRequestQueue();
            return;
        }
        handleRequestFailure(context, 0, 'No response after ' + Math.round(REQUEST_TIMEOUT_MS / 1000) + ' s');
    }, REQUEST_TIMEOUT_MS);
}

function handleRequestFailure(context, status, detail) {
    if (context.generation !== generation) return;

    if (isTransientHttpStatus(status) && Number(context.retries || 0) < MAX_TRANSIENT_RETRIES) {
        const delay = transientRetryDelay(context.retries);
        blockedUntil = Math.max(blockedUntil, Date.now() + delay);
        MusicBrainzGate.announce(blockedUntil);
        requestQueue.unshift(Object.assign({}, context, { retries: Number(context.retries || 0) + 1 }));
        setNetworkDebug('retrying', context.kind, 'Retry in ' + Math.round(delay / 1000) + ' s.', status);
        statusText = 'MusicBrainz is rate limiting or unavailable; retrying\u2026';
        statusIsError = false;
        window.Repaint();
        pumpRequestQueue();
        return;
    }

    setNetworkDebug('failed', context.kind, detail || ('HTTP ' + status), status);
    // The tagged release is a bonus candidate, so losing it must not cancel the
    // search that was queued behind it.
    if (context.kind === 'tag-release') {
        pumpRequestQueue();
        return;
    }

    busy = false;
    if (status === 403) {
        statusText = 'MusicBrainz rejected the request (HTTP 403). Add contact info in RVG Settings > MusicBrainz tagger.';
    } else if (status === 404) {
        statusText = 'That release is not on MusicBrainz (HTTP 404).';
    } else {
        statusText = 'MusicBrainz request failed: ' + debugSnippet(detail || ('HTTP ' + status), 120);
    }
    statusIsError = true;
    rebuildRows();
    pumpRequestQueue();
}

function on_http_request_done(taskId, success, responseText, status) {
    if (!scriptActive) return;
    const context = requestContexts.get(taskId);
    if (!context) return;
    requestContexts.delete(taskId);
    clearTimer(requestWatchdog);
    requestWatchdog = 0;

    if (context.generation !== generation) {
        pumpRequestQueue();
        return;
    }
    if (!success) {
        handleRequestFailure(context, Number(status || 0), responseText);
        return;
    }

    const data = safeJson(responseText);
    if (data === null) {
        handleRequestFailure(context, Number(status || 0), 'Invalid JSON response');
        return;
    }

    blockedUntil = 0;
    setNetworkDebug('completed', context.kind, 'HTTP ' + status, status);

    try {
        if (context.kind === 'search') handleSearchResponse(context, data);
        else if (context.kind === 'tag-release') handleTagReleaseResponse(context, data);
        else if (context.kind === 'release') handleReleaseResponse(context, data);
    } catch (e) {
        busy = false;
        reportFailure('a ' + context.kind + ' response could not be processed', e);
        statusText = 'The MusicBrainz response could not be read: ' + debugSnippet(e, 120);
        statusIsError = true;
        rebuildRows();
    }
    pumpRequestQueue();
}

function luceneQuote(value) {
    return String(value || '').replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSearchQuery(terms) {
    const parts = [];
    const album = luceneQuote(terms.album);
    const artist = luceneQuote(terms.artist);
    if (album) parts.push('release:"' + album + '"');
    if (artist) parts.push('artist:"' + artist + '"');
    return parts.join(' AND ');
}

function abortRequests() {
    generation++;
    requestQueue = [];
    requestContexts.clear();
    clearTimer(requestTimer);
    requestTimer = 0;
    blockedUntil = 0;
}

function resetToReleases() {
    abortRequests();
    busy = false;
    view = 'releases';
    candidates = [];
    chosenRelease = null;
    pairs = [];
    fields = [];
    scrollY = 0;
    hoverRow = -1;
}

// terms: optional { artist, album } typed by the user; defaults to the selection's tags.
function startSearch(terms) {
    if (!selection) {
        statusText = 'Select the tracks of one album in a playlist.';
        statusIsError = true;
        rebuildRows();
        return;
    }
    const custom = !!terms;
    if (!terms) terms = { artist: selection.artist, album: selection.album };
    const query = buildSearchQuery(terms);
    if (!query) {
        statusText = custom
            ? 'Enter an artist or an album to search for.'
            : 'The selected tracks have no album or artist tag to search with. Paste a MusicBrainz ID instead.';
        statusIsError = true;
        rebuildRows();
        return;
    }

    resetToReleases();
    busy = true;
    searchTerms = terms;
    statusText = 'Searching MusicBrainz\u2026';
    statusIsError = false;

    // The tagged release is looked up first so it always heads the list, rather
    // than being merged back in after the search has already been ranked.
    if (selection.tagMbid) {
        enqueueRequest({
            kind: 'tag-release',
            generation: generation,
            retries: 0,
            mbid: selection.tagMbid,
            url: MB_ROOT + '/release/' + selection.tagMbid + '?inc=' + INC_BRIEF + '&fmt=json'
        });
    }
    enqueueRequest({
        kind: 'search',
        generation: generation,
        retries: 0,
        url: MB_ROOT + '/release/?query=' + encodeURIComponent(query) +
            '&fmt=json&limit=' + searchLimit
    });
    rebuildRows();
}

function handleTagReleaseResponse(context, data) {
    if (!data || !data.id) return;
    const candidate = candidateFromRelease(data, 100, true);
    candidates = candidates.filter(function (entry) { return entry.id !== candidate.id; });
    candidates.unshift(candidate);
    rebuildRows();
}

// Local ranking by track-count distance: the server score alone happily puts a
// deluxe reissue above the plain edition that actually matches the files.
function rankCandidates() {
    const wanted = selection ? selection.count : 0;
    candidates.sort(function (a, b) {
        if (a.fromTag !== b.fromTag) return a.fromTag ? -1 : 1;
        const da = Math.abs((a.trackCount || 0) - wanted);
        const db = Math.abs((b.trackCount || 0) - wanted);
        if (da !== db) return da - db;
        return (b.score || 0) - (a.score || 0);
    });
}

function handleSearchResponse(context, data) {
    busy = false;
    if (!selection) return;
    const releases = data && Array.isArray(data.releases) ? data.releases : [];
    for (let i = 0; i < releases.length; i++) {
        const release = releases[i] || {};
        if (!release.id) continue;
        if (candidates.some(function (entry) { return entry.id === release.id; })) continue;
        candidates.push(candidateFromRelease(release, release.score, false));
    }
    rankCandidates();

    if (!candidates.length) {
        const terms = searchTerms || selection;
        statusText = 'No MusicBrainz release matched "' + (terms.album || terms.artist) + '".';
        statusIsError = false;
    } else {
        statusText = plural(candidates.length, 'candidate release') + ' for ' + plural(selection.count, 'selected track') +
            '. Click one to review the changes.';
        statusIsError = false;
    }
    rebuildRows();
}

function emptyCache() {
    return { version: CACHE_VERSION, releases: {} };
}

function loadCacheFile() {
    if (cache) return cache;
    try {
        if (utils.IsFile(CACHE_FILE)) {
            const data = safeJson(utils.ReadTextFile(CACHE_FILE, 65001));
            if (data && Number(data.version) === CACHE_VERSION && data.releases && typeof data.releases === 'object') {
                cache = data;
            }
        }
    } catch (e) {
        reportFailure('the release cache could not be read', e);
    }
    if (!cache) cache = emptyCache();
    return cache;
}

function saveCacheFile() {
    if (!cache || !cacheDirty) return;
    try {
        utils.CreateFolder(CACHE_DIR);
        utils.WriteTextFile(CACHE_FILE, JSON.stringify(cache), false);
        cacheDirty = false;
    } catch (e) {
        reportFailure('the release cache could not be written', e);
    }
}

function cachedRelease(mbid) {
    const store = loadCacheFile();
    const entry = store.releases[mbid];
    if (!entry || !entry.release) return null;
    if (Date.now() - Number(entry.savedAt || 0) > CACHE_LIFETIME_MS) return null;
    return entry.release;
}

function storeRelease(mbid, release) {
    const store = loadCacheFile();
    store.releases[mbid] = { savedAt: Date.now(), release: release };

    const keys = Object.keys(store.releases);
    if (keys.length > CACHE_MAX_ENTRIES) {
        keys.sort(function (a, b) {
            return Number(store.releases[a].savedAt || 0) - Number(store.releases[b].savedAt || 0);
        });
        for (let i = 0; i < keys.length - CACHE_MAX_ENTRIES; i++) delete store.releases[keys[i]];
    }
    cacheDirty = true;
    saveCacheFile();
}

function chooseRelease(mbid) {
    if (!selection || !isUuid(mbid)) return;

    const cached = cachedRelease(mbid);
    if (cached) {
        adoptRelease(cached);
        return;
    }

    busy = true;
    statusText = 'Loading the full track list\u2026';
    statusIsError = false;
    enqueueRequest({
        kind: 'release',
        generation: generation,
        retries: 0,
        mbid: mbid,
        url: MB_ROOT + '/release/' + mbid + '?inc=' + INC_FULL + '&fmt=json'
    });
    rebuildRows();
}

function handleReleaseResponse(context, data) {
    busy = false;
    if (!data || !data.id) {
        statusText = 'MusicBrainz returned no release for that ID.';
        statusIsError = true;
        rebuildRows();
        return;
    }
    storeRelease(String(data.id), data);
    adoptRelease(data);
}

function currentValues(info, tagName) {
    if (!info) return [];
    let idx = -1;
    try {
        idx = info.MetaFind(tagName);
    } catch (e) {
        return [];
    }
    if (idx < 0) return [];
    const out = [];
    try {
        const n = info.MetaValueCount(idx);
        for (let i = 0; i < n; i++) {
            const value = cleanSpaces(info.MetaValue(idx, i));
            if (value) out.push(value);
        }
    } catch (e) { }
    return out;
}

// foobar2000's own ID3v2 table maps ORIGINAL RELEASE DATE, ALBUM ARTIST,
// PUBLISHER, MEDIA TYPE and the *SORTORDER names to real frames; the Picard
// spellings of those go to TXXX instead, so on an ID3 file the two names sit
// side by side and only one of them is the frame foobar reads. Every other tag
// type stores whatever name it is given, where the portable spelling wins.
function usesId3Names(path) {
    return ID3_EXTENSIONS.test(String(path || ''));
}

// Whatever the file already carries always wins, so tagging never leaves the
// same value under two names; the style only decides a name never seen before.
function resolveTagName(info, def, path) {
    if (!def.fbTag) return def.tag;
    try {
        if (info) {
            if (info.MetaFind(def.tag) >= 0) return def.tag;
            if (info.MetaFind(def.fbTag) >= 0) return def.fbTag;
        }
    } catch (e) { }
    if (tagStyle === 'picard') return def.tag;
    if (tagStyle === 'foobar') return def.fbTag;
    return usesId3Names(path) ? def.fbTag : def.tag;
}

function newValuesFor(def, release, mbTrack) {
    switch (def.id) {
        case 'album': return [cleanSpaces(release.title)];
        case 'albumartist': return [joinCredit(release['artist-credit'])];
        case 'albumartistsort': return [joinCreditSort(release['artist-credit'])];
        case 'date': return [formatReleaseDate(release.date)];
        // Always full: the original release date is a fact about the recording, and
        // the year alone is already in DATE for anyone who wants it there.
        case 'originaldate': return [String((release['release-group'] || {})['first-release-date'] || '')];
        case 'totaldiscs': return [String(mediaSummary(release).discs)];
        case 'label': return labelValues(release, 'label');
        case 'catalognumber': return labelValues(release, 'catalog');
        case 'barcode': return [String(release.barcode || '')];
        case 'releasetype': return releaseTypes(release);
        case 'releasestatus': return [String(release.status || '').toLowerCase()];
        case 'releasecountry': return [String(release.country || '')];
        case 'musicbrainz_albumid': return [String(release.id || '')];
        case 'musicbrainz_releasegroupid': return [String((release['release-group'] || {}).id || '')];
        case 'musicbrainz_albumartistid': return creditIds(release['artist-credit']);
    }
    if (!mbTrack) return [];

    const track = mbTrack.track || {};
    const medium = mbTrack.medium || {};
    const recording = track.recording || {};
    const credit = Array.isArray(track['artist-credit']) && track['artist-credit'].length
        ? track['artist-credit']
        : recording['artist-credit'];

    switch (def.id) {
        case 'title': return [cleanSpaces(track.title || recording.title)];
        case 'artist': return [joinCredit(credit)];
        case 'artistsort': return [joinCreditSort(credit)];
        case 'tracknumber': return [String(track.number || track.position || '')];
        case 'totaltracks': return [String(medium['track-count'] || '')];
        case 'discnumber': return [String(medium.position || mbTrack.mediumIndex + 1)];
        case 'media': return [String(medium.format || '')];
        case 'musicbrainz_trackid': return [String(recording.id || '')];
        case 'musicbrainz_releasetrackid': return [String(track.id || '')];
        case 'musicbrainz_artistid': return creditIds(credit);
    }
    return [];
}

function sameValues(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function displayValues(values) {
    const text = values.filter(Boolean).join('; ');
    return text || '(empty)';
}

function storedFieldEnabled(def) {
    const raw = window.GetProperty(PROP + 'Field ' + def.id, def.def);
    return raw === undefined || raw === null ? def.def : !!raw;
}

function adoptRelease(release) {
    if (!selection) return;
    chosenRelease = release;
    const mbTracks = flattenTracks(release);

    pairs = [];
    const order = selection.order;
    for (let i = 0; i < order.length; i++) {
        pairs.push({
            srcIndex: order[i].srcIndex,
            path: order[i].path,
            title: order[i].title,
            mb: i < mbTracks.length ? mbTracks[i] : null
        });
    }

    // The 1:1 pairing is positional, so an unequal count means every track-scope
    // value could land on the wrong file. Those fields are withheld entirely.
    const aligned = mbTracks.length === order.length && mbTracks.length > 0;
    buildFields(release, aligned);

    view = 'review';
    scrollY = 0;
    hoverRow = -1;
    statusIsError = !aligned;
    statusText = aligned
        ? 'Tick the fields to write, then press Write tags.'
        : 'Track counts differ (' + order.length + ' selected, ' + mbTracks.length +
        ' on this release). Only album-wide fields can be written.';
    rebuildRows();
}

function buildFields(release, aligned) {
    const infos = [];
    for (let i = 0; i < pairs.length; i++) {
        let info = null;
        try { info = selection.handles[pairs[i].srcIndex].GetFileInfo(); } catch (e) { info = null; }
        infos.push(info);
    }

    fields = [];
    for (let f = 0; f < FIELD_DEFS.length; f++) {
        const def = FIELD_DEFS[f];
        const blocked = def.scope === 'track' && !aligned;
        let changed = 0;
        let empty = 0;
        let sampleFrom = '';
        let sampleTo = '';
        const perTrack = [];
        const usedNames = [];

        for (let i = 0; i < pairs.length; i++) {
            const info = infos[i];
            const tagName = resolveTagName(info, def, pairs[i].path);
            const from = currentValues(info, tagName);
            const to = newValuesFor(def, release, pairs[i].mb).filter(Boolean);
            const willChange = !blocked && to.length > 0 && !sameValues(from, to);
            if (!to.length) empty++;
            if (willChange) {
                changed++;
                if (!sampleTo) {
                    sampleFrom = displayValues(from);
                    sampleTo = displayValues(to);
                }
            }
            perTrack.push({ tagName: tagName, from: from, to: to, willChange: willChange });
            if (usedNames.indexOf(tagName) < 0) usedNames.push(tagName);
        }

        fields.push({
            def: def,
            // Only shown for the fields that have two spellings, where which one
            // gets written is the whole question.
            tagLabel: def.fbTag ? usedNames.join(' + ') : '',
            enabled: storedFieldEnabled(def),
            blocked: blocked,
            noData: empty === pairs.length,
            changed: changed,
            sampleFrom: sampleFrom,
            sampleTo: sampleTo,
            perTrack: perTrack
        });
        if (def.scope === 'album' && perTrack.length && !sampleTo) {
            // An unchanged album field still shows what it would write.
            fields[fields.length - 1].sampleTo = displayValues(perTrack[0].to);
        }
    }
}

// A setting that changes what would be written has to re-run the diff, or the
// review screen keeps offering the values from before the edit.
function rebuildReviewFields() {
    if (view !== 'review' || !chosenRelease || !selection) return;
    buildFields(chosenRelease, flattenTracks(chosenRelease).length === selection.order.length);
    rebuildRows();
}

function writableFields() {
    const out = [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.enabled && !field.blocked && field.changed > 0) out.push(field);
    }
    return out;
}

function pendingValueCount() {
    const list = writableFields();
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].changed;
    return total;
}

function pendingTrackCount() {
    const list = writableFields();
    const touched = new Set();
    for (let i = 0; i < list.length; i++) {
        for (let p = 0; p < list[i].perTrack.length; p++) {
            if (list[i].perTrack[p].willChange) touched.add(p);
        }
    }
    return touched.size;
}

function performWrite() {
    const list = writableFields();
    if (!list.length || !selection) return;

    const valueCount = pendingValueCount();
    const trackCount = pendingTrackCount();
    const message = 'Write ' + plural(valueCount, 'tag value') + ' to ' + plural(trackCount, 'file') + '?\n\n' +
        'This edits the files on disk. Undo is available from the right-click menu until this panel reloads.';
    let answer = MB_YES;
    try {
        answer = utils.MessageBox(message, 'RVG MusicBrainz tagger', MB_BUTTONS_YESNO, MB_ICON_WARNING);
    } catch (e) {
        reportFailure('the confirmation dialog could not be shown', e);
        return;
    }
    if (Number(answer) !== MB_YES) return;

    const payload = [];
    const undoPayload = [];
    for (let i = 0; i < selection.count; i++) {
        payload.push({});
        undoPayload.push({});
    }

    for (let f = 0; f < list.length; f++) {
        const field = list[f];
        for (let p = 0; p < field.perTrack.length; p++) {
            const entry = field.perTrack[p];
            if (!entry.willChange) continue;
            const srcIndex = pairs[p].srcIndex;
            payload[srcIndex][entry.tagName] = entry.to.length === 1 ? entry.to[0] : entry.to;
            // A restore of an absent tag is a blank value, which is exactly how
            // UpdateFileInfoFromJSON clears one.
            undoPayload[srcIndex][entry.tagName] = entry.from.length === 0
                ? ''
                : (entry.from.length === 1 ? entry.from[0] : entry.from);
        }
    }

    try {
        selection.handles.UpdateFileInfoFromJSON(JSON.stringify(payload));
    } catch (e) {
        reportFailure('the tags could not be written', e);
        statusText = 'Writing failed: ' + debugSnippet(e, 140);
        statusIsError = true;
        rebuildRows();
        return;
    }

    undoState = { handles: selection.handles, payload: undoPayload, at: Date.now(), values: valueCount, tracks: trackCount };
    lastWriteSummary = plural(valueCount, 'value') + ' to ' + plural(trackCount, 'file') + ' at ' + debugDateTime(undoState.at);
    statusText = 'Wrote ' + plural(valueCount, 'tag value') + ' to ' + plural(trackCount, 'file') + '.';
    statusIsError = false;
    rebuildRows();
}

function performUndo() {
    if (!undoState) return;
    let answer = MB_YES;
    try {
        answer = utils.MessageBox('Restore the tag values as they were before the last write?',
            'RVG MusicBrainz tagger', MB_BUTTONS_YESNO, MB_ICON_WARNING);
    } catch (e) {
        reportFailure('the confirmation dialog could not be shown', e);
        return;
    }
    if (Number(answer) !== MB_YES) return;

    try {
        undoState.handles.UpdateFileInfoFromJSON(JSON.stringify(undoState.payload));
        statusText = 'Restored ' + plural(undoState.values, 'tag value') + '.';
        statusIsError = false;
    } catch (e) {
        reportFailure('the previous tags could not be restored', e);
        statusText = 'Undo failed: ' + debugSnippet(e, 140);
        statusIsError = true;
    }
    undoState = null;
    lastWriteSummary = 'undone';
    rebuildRows();
}

function updateLayoutMetrics(baseSize) {
    uiScale = clamp(Number(baseSize || 12) / 12, 0.82, 1.8);
    PAD = scaleUi(14);
    HEADER_H = scaleUi(88);
    SECTION_H = scaleUi(28);
    RELEASE_H = scaleUi(68);
    PAIR_H = scaleUi(26);
    FIELD_H = scaleUi(42);
    NOTE_H = scaleUi(38);
    FOOTER_H = scaleUi(48);
}

function updateTheme(forceFonts) {
    const host = RivageUI.hostInfo();
    const name = host && host.fontFamily ? String(host.fontFamily) : 'Segoe UI';
    const size = Math.max(9, host && Number(host.scaleFontSize) > 0 ? Number(host.scaleFontSize) : 12);
    const nextKey = name.toLowerCase() + '|' + size;
    const layoutChanged = !!forceFonts || nextKey !== fontLayoutKey;

    if (layoutChanged) updateLayoutMetrics(size);

    hostAccent = SharedAccentProtocol.opaque(host && host.accent !== undefined ? host.accent : DEFAULT_UWP_ACCENT);
    const requested = SharedAccentProtocol.opaque(
        accentMode === 'fixed' ? DEFAULT_UWP_ACCENT : (accentMode === 'host' ? hostAccent : sharedAlbumAccent));
    const resolved = RivageUI.createTheme({ mode: 'host', accent: requested });

    // The painter reads the full role set, so the whole theme is copied in
    // rather than the handful of roles this panel names itself.
    for (const key in resolved) {
        if (Object.prototype.hasOwnProperty.call(resolved, key)) colours[key] = resolved[key];
    }
    colours.accent = SharedAccentProtocol.opaque(accentMode === 'shared' ? resolved.accent : requested);
    colours.text = colours.textPrimary;
    colours.muted = colours.textMuted;
    colours.rule = colours.separator;
    colours.error = colours.danger;

    if (layoutChanged) {
        fonts.normal = RivageUI.font(name, size, 0);
        fonts.bold = RivageUI.font(name, size, 1);
        fonts.small = RivageUI.font(name, Math.max(8, size - 1), 0);
        fonts.smallBold = RivageUI.font(name, Math.max(8, size - 1), 1);
        fonts.tiny = RivageUI.font(name, Math.max(8, size - 2), 0);
        fonts.title = RivageUI.font(name, Math.max(14, size + 4), 1);
        fontLayoutKey = nextKey;
        if (displayRows.length) reflowRows();
    }

    painter.setTheme(colours);
}

function footerVisible() {
    return view === 'review';
}

function viewportTop() {
    return HEADER_H;
}

function viewportHeight() {
    return Math.max(0, wh - HEADER_H - (footerVisible() ? FOOTER_H : 0));
}

function maxScroll() {
    return Math.max(0, contentHeight - viewportHeight());
}

function headerCardRect() {
    return { x: PAD, y: PAD, w: Math.max(0, ww - PAD * 2), h: Math.max(scaleUi(20), HEADER_H - PAD - scaleUi(8)) };
}

function searchButtonRect() {
    const card = headerCardRect();
    const w = scaleUi(78);
    const h = scaleUi(26);
    return { x: card.x + card.w - PAD - w, y: card.y + scaleUi(7), w: w, h: h };
}

function footerRect() {
    return { x: 0, y: Math.max(0, wh - FOOTER_H), w: ww, h: FOOTER_H };
}

function writeButtonRect() {
    const footer = footerRect();
    const w = Math.min(Math.max(scaleUi(150), Math.round(ww * 0.42)), scaleUi(260));
    const h = scaleUi(30);
    return { x: footer.x + footer.w - PAD - w, y: footer.y + Math.round((footer.h - h) / 2), w: w, h: h };
}

function backButtonRect() {
    const footer = footerRect();
    const w = scaleUi(92);
    const h = scaleUi(30);
    return { x: footer.x + PAD, y: footer.y + Math.round((footer.h - h) / 2), w: w, h: h };
}

function pointInRect(x, y, rect) {
    return !!rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function buttonAt(x, y) {
    if (pointInRect(x, y, searchButtonRect())) return 'search';
    if (footerVisible()) {
        if (pointInRect(x, y, writeButtonRect())) return 'write';
        if (pointInRect(x, y, backButtonRect())) return 'back';
    }
    return '';
}

function rebuildRows() {
    const rows = [];

    if (view === 'releases') {
        if (candidates.length) {
            rows.push({ kind: 'section', label: 'CANDIDATE RELEASES', height: SECTION_H, top: 0 });
            for (let i = 0; i < candidates.length; i++) {
                rows.push({ kind: 'release', candidate: candidates[i], height: RELEASE_H, top: 0 });
            }
        }
    } else {
        rows.push({ kind: 'section', label: 'TRACK PAIRING', height: SECTION_H, top: 0 });
        for (let i = 0; i < pairs.length; i++) {
            rows.push({ kind: 'pair', pair: pairs[i], index: i, height: PAIR_H, top: 0 });
        }

        const albumFields = [];
        const trackFields = [];
        for (let i = 0; i < fields.length; i++) {
            (fields[i].def.scope === 'album' ? albumFields : trackFields).push(fields[i]);
        }

        rows.push({ kind: 'section', label: 'ALBUM FIELDS', height: SECTION_H, top: 0 });
        for (let i = 0; i < albumFields.length; i++) {
            rows.push({ kind: 'field', field: albumFields[i], height: FIELD_H, top: 0 });
        }
        rows.push({ kind: 'section', label: 'PER-TRACK FIELDS', height: SECTION_H, top: 0 });
        if (trackFields.length && trackFields[0].blocked) {
            rows.push({
                kind: 'note',
                label: 'Withheld: the selection and the release do not have the same number of tracks.',
                height: NOTE_H, top: 0
            });
        }
        for (let i = 0; i < trackFields.length; i++) {
            rows.push({ kind: 'field', field: trackFields[i], height: FIELD_H, top: 0 });
        }
    }

    displayRows = rows;
    reflowRows();
    window.Repaint();
}

function rowHeightFor(kind) {
    if (kind === 'section') return SECTION_H;
    if (kind === 'release') return RELEASE_H;
    if (kind === 'pair') return PAIR_H;
    if (kind === 'note') return NOTE_H;
    return FIELD_H;
}

function reflowRows() {
    let top = 0;
    for (let i = 0; i < displayRows.length; i++) {
        displayRows[i].height = rowHeightFor(displayRows[i].kind);
        displayRows[i].top = top;
        top += displayRows[i].height;
    }
    contentHeight = top;
    scrollY = clamp(scrollY, 0, maxScroll());
}

function rowIndexAtLocalY(localY) {
    let low = 0;
    let high = displayRows.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const row = displayRows[mid];
        if (localY < row.top) high = mid - 1;
        else if (localY >= row.top + row.height) low = mid + 1;
        else return mid;
    }
    return -1;
}

function rowAt(x, y) {
    const top = viewportTop();
    if (x < 0 || x > ww || y < top || y > top + viewportHeight()) return -1;
    return rowIndexAtLocalY(y - top + scrollY);
}

function isClickableRow(row) {
    if (!row) return false;
    if (row.kind === 'release') return true;
    return row.kind === 'field' && !row.field.blocked && !row.field.noData;
}

function drawText(gr, text, font, colour, x, y, w, h, flags) {
    if (w <= 0 || h <= 0) return;
    gr.GdiDrawText(String(text || ''), font, colour, Math.round(x), Math.round(y), Math.round(w), Math.round(h), flags);
}

function paintButton(gr, rect, label, state) {
    const hot = state === 'hover';
    const primary = state === 'primary' || state === 'primaryHover';
    const disabled = state === 'disabled';
    const fill = disabled
        ? colours.surface
        : (primary ? (state === 'primaryHover' ? colours.accentHover : colours.accent)
            : (hot ? colours.cardHover : colours.card));
    const text = disabled ? colours.textDisabled : (primary ? colours.onAccent : colours.text);

    painter.fillRoundRect(gr, rect, 4, fill);
    if (!primary) painter.drawRoundRect(gr, rect, 4, 1, disabled ? colours.stroke : colours.strokeHot);
    drawText(gr, label, fonts.smallBold, text, rect.x, rect.y, rect.w, rect.h,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintCheckbox(gr, x, y, size, checked, enabled) {
    const rect = { x: x, y: y, w: size, h: size };
    if (!enabled) {
        painter.drawRoundRect(gr, rect, 3, 1, colours.textDisabled);
        return;
    }
    if (!checked) {
        painter.drawRoundRect(gr, rect, 3, 1, colours.strokeHot);
        return;
    }
    painter.fillRoundRect(gr, rect, 3, colours.accent);
    const thickness = Math.max(1, Math.round(size / 8));
    try {
        gr.DrawLine(x + size * 0.26, y + size * 0.52, x + size * 0.44, y + size * 0.71, thickness, colours.onAccent);
        gr.DrawLine(x + size * 0.44, y + size * 0.71, x + size * 0.76, y + size * 0.30, thickness, colours.onAccent);
    } catch (e) { }
}

function paintHeader(gr) {
    const card = headerCardRect();
    painter.card(gr, card, {
        fill: colours.card,
        border: true,
        stroke: colours.rule,
        accent: true,
        accentColour: statusIsError ? colours.error : colours.accent
    });

    const left = card.x + PAD;
    const button = searchButtonRect();
    const width = Math.max(scaleUi(20), button.x - scaleUi(10) - left);

    drawText(gr, 'MusicBrainz tagger', fonts.title, colours.accent,
        left, card.y + scaleUi(4), width, scaleUi(22),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, selectionLabel(), fonts.small, colours.muted,
        left, card.y + scaleUi(25), width, scaleUi(18),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, statusText, fonts.normal, statusIsError ? colours.error : colours.text,
        left, card.y + card.h - scaleUi(23), Math.max(scaleUi(20), card.w - PAD * 2), scaleUi(20),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    const canSearch = !!selection && !busy;
    paintButton(gr, button, busy ? 'Working' : 'Search',
        !canSearch ? 'disabled' : (hoverButton === 'search' ? 'primaryHover' : 'primary'));
}

function paintFooter(gr) {
    const footer = footerRect();
    gr.FillSolidRect(footer.x, footer.y, footer.w, footer.h, colours.header);
    gr.FillSolidRect(footer.x, footer.y, footer.w, Math.max(1, scaleUi(1)), colours.rule);

    paintButton(gr, backButtonRect(), 'Back', hoverButton === 'back' ? 'hover' : 'normal');

    const values = pendingValueCount();
    const tracks = pendingTrackCount();
    const write = writeButtonRect();
    paintButton(gr, write,
        values ? 'Write ' + values + ' values to ' + tracks + ' files' : 'Nothing to write',
        !values ? 'disabled' : (hoverButton === 'write' ? 'primaryHover' : 'primary'));

    const infoW = Math.max(0, write.x - PAD - (backButtonRect().x + backButtonRect().w + scaleUi(10)));
    drawText(gr, chosenRelease ? cleanSpaces(chosenRelease.title) : '', fonts.small, colours.muted,
        backButtonRect().x + backButtonRect().w + scaleUi(10), footer.y, infoW, footer.h,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintEmptyState(gr) {
    const cardW = Math.max(scaleUi(220), Math.min(ww - PAD * 2, scaleUi(520)));
    const cardH = scaleUi(92);
    const x = Math.round((ww - cardW) / 2);
    const y = viewportTop() + scaleUi(24);
    painter.fillRoundRect(gr, { x: x, y: y, w: cardW, h: cardH }, 8, colours.card);
    gr.FillSolidRect(x, y, scaleUi(4), cardH, statusIsError ? colours.error : colours.accent);
    drawText(gr, statusIsError ? 'ACTION NEEDED' : 'NOTHING TO SHOW', fonts.smallBold,
        statusIsError ? colours.error : colours.accent,
        x + scaleUi(18), y + scaleUi(12), cardW - scaleUi(36), scaleUi(22),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    drawText(gr, statusText, fonts.normal, colours.text,
        x + scaleUi(18), y + scaleUi(36), cardW - scaleUi(36), cardH - scaleUi(48),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintSectionRow(gr, row, y) {
    drawText(gr, row.label, fonts.smallBold, colours.accent,
        PAD, y, Math.max(scaleUi(40), ww - PAD * 2), row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintNoteRow(gr, row, y) {
    drawText(gr, row.label, fonts.small, colours.error,
        PAD + scaleUi(2), y, Math.max(scaleUi(40), ww - PAD * 2), row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function releaseMetaLine(candidate) {
    const bits = [];
    if (candidate.date) bits.push(candidate.date);
    if (candidate.country) bits.push(candidate.country);
    if (candidate.formats) bits.push(candidate.formats);
    bits.push(plural(candidate.trackCount, 'track'));
    if (candidate.discCount > 1) bits.push(plural(candidate.discCount, 'disc'));
    if (candidate.labels) bits.push(candidate.labels);
    if (candidate.catno) bits.push(candidate.catno);
    return bits.join(SEPARATOR);
}

function paintReleaseRow(gr, row, index, y) {
    const candidate = row.candidate;
    const rect = {
        x: PAD, y: y + scaleUi(4),
        w: Math.max(scaleUi(80), ww - PAD * 2 - scaleUi(3)),
        h: row.height - scaleUi(8)
    };
    const exact = selection && candidate.trackCount === selection.count;
    painter.card(gr, rect, {
        fill: index === hoverRow ? colours.cardHover : colours.card,
        border: true,
        stroke: colours.rule,
        accent: true,
        accentColour: candidate.fromTag ? colours.success : (exact ? colours.accent : colours.textTertiary)
    });

    const left = rect.x + scaleUi(14);
    const tagW = candidate.fromTag ? scaleUi(84) : (exact ? scaleUi(74) : 0);
    const width = Math.max(scaleUi(30), rect.w - scaleUi(28) - tagW);

    drawText(gr, candidate.title, fonts.bold, colours.text,
        left, rect.y + scaleUi(5), width, scaleUi(20),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    if (tagW) {
        drawText(gr, candidate.fromTag ? 'FROM TAGS' : 'EXACT COUNT', fonts.tiny,
            candidate.fromTag ? colours.success : colours.accent,
            left + width, rect.y + scaleUi(5), tagW, scaleUi(20),
            DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
    drawText(gr, candidate.artist, fonts.small, colours.textSecondary,
        left, rect.y + scaleUi(24), rect.w - scaleUi(28), scaleUi(18),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, releaseMetaLine(candidate), fonts.tiny, colours.muted,
        left, rect.y + rect.h - scaleUi(20), rect.w - scaleUi(28), scaleUi(18),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintPairRow(gr, row, y) {
    const pair = row.pair;
    const numberW = scaleUi(30);
    const half = Math.max(scaleUi(40), Math.round((ww - PAD * 2 - numberW - scaleUi(28)) / 2));
    const mbTitle = pair.mb
        ? cleanSpaces((pair.mb.track || {}).title || ((pair.mb.track || {}).recording || {}).title)
        : '(no matching track)';

    drawText(gr, String(row.index + 1), fonts.tiny, colours.textTertiary,
        PAD, y, numberW, row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    drawText(gr, pair.title || '(untitled)', fonts.small, colours.muted,
        PAD + numberW, y, half, row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, ARROW, fonts.small, colours.textTertiary,
        PAD + numberW + half, y, scaleUi(26), row.height,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    drawText(gr, mbTitle, fonts.small, pair.mb ? colours.text : colours.error,
        PAD + numberW + half + scaleUi(26), y, half, row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function fieldValueLine(field) {
    if (field.blocked) return 'withheld while the track counts differ';
    if (field.noData) return 'MusicBrainz has no value for this release';
    if (!field.changed) return 'already matches' + (field.sampleTo ? SEPARATOR + field.sampleTo : '');
    return field.sampleFrom + ARROW + field.sampleTo;
}

function paintFieldRow(gr, row, index, y) {
    const field = row.field;
    const active = !field.blocked && !field.noData;
    const box = scaleUi(15);

    if (index === hoverRow && active) {
        gr.FillSolidRect(0, y, ww, row.height, colours.rowHover);
    }
    paintCheckbox(gr, PAD, y + Math.round((row.height - box) / 2), box, field.enabled && active, active);

    const left = PAD + box + scaleUi(11);
    const countText = field.changed ? field.changed + ' of ' + pairs.length : '';
    const countW = countText ? scaleUi(70) : 0;
    const width = Math.max(scaleUi(30), ww - left - PAD - countW - scaleUi(6));

    drawText(gr, field.def.label + (field.tagLabel ? '  (' + field.tagLabel + ')' : ''), fonts.bold,
        active ? (field.changed ? colours.text : colours.textSecondary) : colours.textDisabled,
        left, y + scaleUi(4), width, scaleUi(19),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, fieldValueLine(field), fonts.small,
        field.changed && active ? colours.muted : colours.textTertiary,
        left, y + row.height - scaleUi(22), width, scaleUi(18),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    if (countText) {
        drawText(gr, countText, fonts.tiny, colours.accent,
            ww - PAD - countW, y, countW, row.height,
            DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

function on_paint(gr) {
    runInitialContentLoad();

    // Rectangular backdrop before anti-aliasing: GDI+ shape smoothing filters the
    // DrawImage destination edge into a visible seam on the left and top rows.
    RivageBackdrop.paint(gr, 0, 0, ww, wh, colours.background);

    let smoothingChanged = false;
    if (typeof gr.SetSmoothingMode === 'function') {
        try {
            gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
            smoothingChanged = true;
        } catch (e) {
            smoothingChanged = false;
        }
    }

    if (!displayRows.length) {
        paintEmptyState(gr);
    } else {
        const top = viewportTop();
        const height = viewportHeight();
        gr.PushClip(0, top, ww, height);
        try {
            const first = rowIndexAtLocalY(scrollY);
            for (let i = Math.max(0, first); i < displayRows.length; i++) {
                const row = displayRows[i];
                const y = top + row.top - scrollY;
                if (y > top + height) break;
                if (row.kind === 'section') paintSectionRow(gr, row, y);
                else if (row.kind === 'note') paintNoteRow(gr, row, y);
                else if (row.kind === 'release') paintReleaseRow(gr, row, i, y);
                else if (row.kind === 'pair') paintPairRow(gr, row, y);
                else if (row.kind === 'field') paintFieldRow(gr, row, i, y);
            }
        } finally {
            gr.PopClip();
        }
    }

    if (contentHeight > viewportHeight()) {
        painter.scrollbar(gr, {
            x: Math.max(0, ww - scaleUi(4)),
            y: viewportTop() + scaleUi(8),
            height: Math.max(1, viewportHeight() - scaleUi(16)),
            contentHeight: contentHeight,
            viewportHeight: viewportHeight(),
            scroll: scrollY
        });
    }

    paintHeader(gr);
    if (footerVisible()) paintFooter(gr);

    if (smoothingChanged) {
        try { gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT); } catch (e) { }
    }
}

function syncHoverFromPointer(repaint) {
    const button = pointerInside ? buttonAt(pointerX, pointerY) : '';
    const index = pointerInside && !button ? rowAt(pointerX, pointerY) : -1;
    const clickable = index >= 0 && isClickableRow(displayRows[index]);
    const nextRow = clickable ? index : -1;
    const changed = nextRow !== hoverRow || button !== hoverButton;

    hoverRow = nextRow;
    hoverButton = button;
    window.SetCursor(clickable || button ? IDC_HAND : IDC_ARROW);

    if (changed && repaint !== false) window.Repaint();
    return changed;
}

function on_size() {
    ww = window.Width;
    wh = window.Height;
    scrollY = clamp(scrollY, 0, maxScroll());
    syncHoverFromPointer(false);
}

function on_mouse_move(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;
    syncHoverFromPointer(true);
}

function on_mouse_leave() {
    const had = hoverRow !== -1 || hoverButton !== '';
    pointerInside = false;
    syncHoverFromPointer(false);
    if (had) window.Repaint();
}

function on_mouse_wheel(step) {
    if (!maxScroll()) return;
    scrollY = clamp(scrollY - step * FIELD_H * 2, 0, maxScroll());
    syncHoverFromPointer(false);
    window.Repaint();
}

function toggleField(field) {
    if (field.blocked || field.noData) return;
    field.enabled = !field.enabled;
    window.SetProperty(PROP + 'Field ' + field.def.id, field.enabled);
    window.Repaint();
}

function setAllFields(enabled) {
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.blocked || field.noData) continue;
        field.enabled = enabled;
        window.SetProperty(PROP + 'Field ' + field.def.id, enabled);
    }
    window.Repaint();
}

function resetFieldDefaults() {
    for (let f = 0; f < FIELD_DEFS.length; f++) {
        window.SetProperty(PROP + 'Field ' + FIELD_DEFS[f].id, FIELD_DEFS[f].def);
    }
    for (let i = 0; i < fields.length; i++) {
        fields[i].enabled = fields[i].def.def;
    }
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;

    const button = buttonAt(x, y);
    if (button === 'search') {
        if (selection && !busy) startSearch();
        return;
    }
    if (button === 'back') {
        view = 'releases';
        scrollY = 0;
        statusText = candidates.length
            ? 'Click a release to review the changes.'
            : 'Press Search to look this album up.';
        statusIsError = false;
        rebuildRows();
        return;
    }
    if (button === 'write') {
        performWrite();
        return;
    }

    const index = rowAt(x, y);
    if (index < 0) return;
    const row = displayRows[index];
    if (row.kind === 'release') chooseRelease(row.candidate.id);
    else if (row.kind === 'field') toggleField(row.field);
}

function pasteMbid() {
    let entered = '';
    try {
        entered = utils.InputBox(window.ID, 'Paste a MusicBrainz release ID or release URL:',
            'RVG MusicBrainz tagger', '', false);
    } catch (e) {
        return;
    }
    // error_on_cancel is off, so a cancelled dialog comes back as the empty
    // default and must not be reported as a bad ID.
    if (!cleanSpaces(entered)) return;

    const mbid = firstUuid(entered);
    if (!mbid || !selection) {
        statusText = mbid
            ? 'Select the tracks to tag first.'
            : 'That is not a MusicBrainz release ID.';
        statusIsError = true;
        rebuildRows();
        return;
    }
    abortRequests();
    chooseRelease(mbid);
}

const SEARCH_DIALOG_HTML = [
    '<!DOCTYPE html><html><head><meta http-equiv="x-ua-compatible" content="IE=edge">',
    '<title>Search MusicBrainz</title><style>',
    'body{font:caption;margin:14px;background:Window;color:WindowText;overflow:hidden}',
    'label{display:block;margin:0 0 4px}input{font:caption;width:100%;box-sizing:border-box;padding:4px;margin:0 0 12px;border:1px solid #7a7a7a}',
    'input:focus{outline:none;border-color:#0078d7}.row{text-align:right}',
    'button{font:caption;min-width:76px;margin-left:8px;padding:4px 10px}',
    '</style></head><body>',
    '<label for="artist">Artist</label><input id="artist" type="text">',
    '<label for="album">Album</label><input id="album" type="text">',
    '<div class="row"><button id="ok">Search</button><button id="cancel">Cancel</button></div>',
    '<script>',
    'var args=[],done=false;try{args=window.external.dialogArguments.toArray();}catch(e){}',
    'document.getElementById("artist").value=args[0]||"";document.getElementById("album").value=args[1]||"";',
    'function finish(ok){if(done)return;done=true;',
    'if(ok&&args[2])args[2](document.getElementById("artist").value,document.getElementById("album").value);',
    'window.open("","_self","");window.close();}',
    'document.getElementById("ok").onclick=function(){finish(true);};',
    'document.getElementById("cancel").onclick=function(){finish(false);};',
    'document.onkeydown=function(e){e=e||window.event;var t=e.target||e.srcElement;',
    'if(e.keyCode===13)finish(!(t&&t.id==="cancel"));else if(e.keyCode===27)finish(false);};',
    'var a=document.getElementById("album");a.focus();a.select();',
    '</script></body></html>'
].join('');

function runCustomSearch(artist, album) {
    if (!selection || busy) return;
    startSearch({ artist: cleanSpaces(artist), album: cleanSpaces(album) });
}

// Search with edited terms. The HTML dialog may call back from inside its own
// modal loop, so the search itself is deferred to a fresh turn.
function promptCustomSearch() {
    if (!selection || busy) return;
    const artist = selection.artist || '';
    const album = selection.album || '';
    try {
        utils.ShowHtmlDialog(window.ID, SEARCH_DIALOG_HTML, {
            width: 420,
            height: 210,
            data: [artist, album, function (nextArtist, nextAlbum) {
                const a = String(nextArtist || '');
                const b = String(nextAlbum || '');
                window.SetTimeout(function () { runCustomSearch(a, b); }, 0);
            }]
        });
        return;
    } catch (e) {
        reportFailure('the search dialog could not be opened, falling back to input boxes', e);
    }
    let nextArtist;
    let nextAlbum;
    try {
        nextArtist = utils.InputBox(window.ID, 'Artist:', 'RVG MusicBrainz tagger', artist, true);
        nextAlbum = utils.InputBox(window.ID, 'Album:', 'RVG MusicBrainz tagger', album, true);
    } catch (e) {
        return;
    }
    runCustomSearch(nextArtist, nextAlbum);
}

function on_mouse_rbtn_up(x, y) {
    if (buttonAt(x, y) === 'search') {
        promptCustomSearch();
        return true;
    }
    const index = rowAt(x, y);
    const row = index >= 0 ? displayRows[index] : null;
    const candidate = row && row.kind === 'release' ? row.candidate : null;
    const menu = window.CreatePopupMenu();

    menu.AppendMenuItem(selection && !busy ? MF_STRING : MF_GRAYED, CMD_SEARCH, 'Search MusicBrainz');
    menu.AppendMenuItem(selection && !busy ? MF_STRING : MF_GRAYED, CMD_CUSTOM_SEARCH, 'Search with a different artist or album\u2026');
    menu.AppendMenuItem(selection && selection.tagMbid ? MF_STRING : MF_GRAYED, CMD_LOAD_TAG_MBID, 'Use the release ID already in the tags');
    menu.AppendMenuItem(MF_STRING, CMD_PASTE_MBID, 'Paste a release ID or URL\u2026');
    if (candidate) {
        menu.AppendMenuSeparator();
        menu.AppendMenuItem(MF_STRING, CMD_OPEN_RELEASE, 'Open this release on musicbrainz.org');
        menu.AppendMenuItem(MF_STRING, CMD_COPY_MBID, 'Copy this release ID');
    }
    if (view === 'review') {
        menu.AppendMenuSeparator();
        menu.AppendMenuItem(MF_STRING, CMD_BACK, 'Back to the release list');
        menu.AppendMenuItem(MF_STRING, CMD_ALL_ON, 'Tick every writable field');
        menu.AppendMenuItem(MF_STRING, CMD_ALL_OFF, 'Untick every field');
        menu.AppendMenuItem(MF_STRING, CMD_RESET_FIELDS, 'Reset fields to defaults');
    }
    menu.AppendMenuSeparator();
    menu.AppendMenuItem(undoState ? MF_STRING : MF_GRAYED, CMD_UNDO, 'Undo the last write');
    menu.AppendMenuItem(MF_STRING, CMD_CLEAR_CACHE, 'Clear the cached releases');
    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, CMD_SETTINGS, RivageUI.copy.labels.panelConfiguration);
    menu.AppendMenuItem(MF_STRING, CMD_EDIT, RivageUI.copy.labels.editScript);

    const command = menu.TrackPopupMenu(x, y);
    if (!command) return true;

    switch (command) {
        case CMD_SEARCH:
            startSearch();
            break;
        case CMD_CUSTOM_SEARCH:
            promptCustomSearch();
            break;
        case CMD_LOAD_TAG_MBID:
            if (selection && selection.tagMbid) {
                abortRequests();
                chooseRelease(selection.tagMbid);
            }
            break;
        case CMD_PASTE_MBID:
            pasteMbid();
            break;
        case CMD_OPEN_RELEASE:
            if (candidate) utils.Run('https://musicbrainz.org/release/' + candidate.id);
            break;
        case CMD_COPY_MBID:
            if (candidate) {
                try { utils.SetClipboardText(candidate.id); } catch (e) {
                    reportFailure('the release ID could not be copied to the clipboard', e);
                }
            }
            break;
        case CMD_BACK:
            view = 'releases';
            scrollY = 0;
            rebuildRows();
            break;
        case CMD_ALL_ON:
            setAllFields(true);
            break;
        case CMD_ALL_OFF:
            setAllFields(false);
            break;
        case CMD_RESET_FIELDS:
            resetFieldDefaults();
            break;
        case CMD_UNDO:
            performUndo();
            break;
        case CMD_CLEAR_CACHE:
            clearCache();
            break;
        case CMD_SETTINGS:
            try {
                if (typeof window.ShowConfigureV2 === 'function') window.ShowConfigureV2();
                else if (typeof window.ShowConfigure === 'function') window.ShowConfigure();
            } catch (e) { reportFailure('the configuration dialog could not be opened', e); }
            break;
        case CMD_EDIT:
            try {
                if (typeof window.EditScript === 'function') window.EditScript();
            } catch (e) { reportFailure('the script editor could not be opened', e); }
            break;
    }
    return true;
}

function describeSelectionDebug() {
    if (!selection) return 'nothing selected';
    return plural(selection.count, 'track') + '; album "' + (selection.album || '-') +
        '"; artist "' + (selection.artist || '-') + '"' +
        (selection.tagMbid ? '; tagged release ' + selection.tagMbid : '; no release ID in tags');
}

function describeTagNameDebug() {
    const named = fields.filter(function (field) { return field.tagLabel; });
    if (!named.length) {
        return tagStyle + '; no release under review yet';
    }
    return tagStyle + '; ' + named.map(function (field) {
        return field.def.id + ' -> ' + field.tagLabel;
    }).join(SEPARATOR);
}

function describeNetworkDebug() {
    return networkDebug.state + (networkDebug.kind ? ' (' + networkDebug.kind + ')' : '') +
        '; ' + debugDateTime(networkDebug.at) +
        (networkDebug.httpStatus ? '; HTTP ' + networkDebug.httpStatus : '') +
        (networkDebug.detail ? '; ' + networkDebug.detail : '');
}

function describeCacheDebug() {
    const store = loadCacheFile();
    return plural(Object.keys(store.releases).length, 'cached release');
}

function getTaggerSettings() {
    return [
        {
            id: 'contactInfo', label: 'Contact info for MusicBrainz', type: 'string', value: contactInfo,
            section: 'Options',
            hint: 'An email address or profile URL. MusicBrainz asks every client to identify itself and throttles or blocks anonymous ones.'
        },
        {
            id: 'searchLimit', label: 'Candidate releases to fetch', type: 'number', value: searchLimit,
            min: 5, max: 40, step: 1, section: 'Options',
            hint: 'How many search results to rank. More results cost nothing extra: the search is a single request.'
        },
        {
            id: 'autoSearch', label: 'Search as soon as the selection changes', type: 'bool', value: autoSearch,
            section: 'Options',
            hint: 'Off by default. MusicBrainz allows one request a second, so an idle panel should not be sending them.'
        },
        {
            id: 'dateStyle', label: 'Date format', type: 'choice', value: dateStyle,
            section: 'Options', choiceValueType: 'string',
            choices: [
                { value: 'full', label: 'As MusicBrainz has it (1997-05-21)' },
                { value: 'year', label: 'Year only (1997)' }
            ],
            hint: 'Applies to Date only. Original release date is always written in full. MusicBrainz often knows only the year anyway, in which case both settings write the same thing.'
        },
        {
            id: 'tagStyle', label: 'Tag name style', type: 'choice', value: tagStyle,
            section: 'Options', choiceValueType: 'string',
            choices: [
                { value: 'auto', label: 'Match the file' },
                { value: 'picard', label: 'Picard (ORIGINALDATE)' },
                { value: 'foobar', label: 'foobar2000 (ORIGINAL RELEASE DATE)' }
            ],
            hint: 'Six fields have two spellings. A name the file already has is always reused; this only decides the ones it has never had. Match the file picks foobar2000\'s names on ID3 files (MP3 and friends), where they are the ones mapped to a real frame, and Picard\'s everywhere else.'
        },
        {
            id: 'accentMode', label: 'Accent colour', type: 'choice', value: accentMode,
            section: 'Options', choiceValueType: 'string',
            choices: [
                { value: 'shared', label: RivageUI.copy.labels.sharedAccent },
                { value: 'fixed', label: RivageUI.copy.labels.rvgBlue },
                { value: 'host', label: RivageUI.copy.labels.foobar2000Accent }
            ]
        },
        { id: 'resetFields', label: 'Reset the field selection', type: 'action', actionLabel: 'Reset', section: 'Options' },

        { id: 'debugVersion', label: 'Panel version', type: 'info', value: PANEL_VERSION, section: 'Diagnostics' },
        { id: 'debugUserAgent', label: 'User-Agent sent', type: 'info', value: userAgent(), section: 'Diagnostics' },
        { id: 'debugSelection', label: 'Current selection', type: 'info', value: describeSelectionDebug(), section: 'Diagnostics' },
        { id: 'debugTagNames', label: 'Dual-spelling tag names', type: 'info', value: describeTagNameDebug(), section: 'Diagnostics' },
        { id: 'debugStatus', label: 'Current panel status', type: 'info', value: statusText + (statusIsError ? ' [error]' : ''), section: 'Diagnostics' },
        { id: 'debugNetwork', label: 'Network', type: 'info', value: describeNetworkDebug(), section: 'Diagnostics' },
        { id: 'debugCache', label: 'Release cache', type: 'info', value: describeCacheDebug(), section: 'Diagnostics' },
        { id: 'debugLastWrite', label: 'Last write', type: 'info', value: lastWriteSummary, section: 'Diagnostics' },
        { id: 'debugCachePath', label: 'Cache location', type: 'info', value: CACHE_DIR, section: 'Diagnostics' }
    ];
}

function applyTaggerSetting(settingId, value) {
    let next;

    switch (settingId) {
        case 'contactInfo':
            next = cleanSpaces(value);
            if (next === contactInfo) return;
            window.SetProperty(PROP + 'Contact info', next);
            contactInfo = next;
            return;
        case 'searchLimit':
            next = clamp(Math.round(Number(value) || 12), 5, 40);
            if (next === searchLimit) return;
            window.SetProperty(PROP + 'Search limit', next);
            searchLimit = next;
            return;
        case 'autoSearch':
            next = !!value;
            if (next === autoSearch) return;
            window.SetProperty(PROP + 'Auto search', next);
            autoSearch = next;
            return;
        case 'tagStyle':
            next = normalizeTagStyle(value);
            if (next === tagStyle) return;
            window.SetProperty(PROP + 'Tag name style', next);
            tagStyle = next;
            rebuildReviewFields();
            return;
        case 'dateStyle':
            next = normalizeDateStyle(value);
            if (next === dateStyle) return;
            window.SetProperty(PROP + 'Date style', next);
            dateStyle = next;
            rebuildReviewFields();
            return;
        case 'accentMode':
            next = normalizeAccentMode(value);
            if (next === accentMode) return;
            window.SetProperty(PROP + 'Accent mode', next);
            accentMode = next;
            if (accentMode === 'shared') SharedAccentProtocol.requestAccent();
            updateTheme();
            window.Repaint(true);
            return;
        case 'resetFields':
            resetFieldDefaults();
            return;
    }
}

function clearCache() {
    cache = emptyCache();
    cacheDirty = true;
    saveCacheFile();
    statusText = 'Cached releases cleared.';
    statusIsError = false;
    rebuildRows();
}

function on_notify_data(name, info) {
    if (CacheProtocol.consumeClear(name, info, 'musicbrainzTagger', clearCache)) return;
    if (MusicBrainzGate.consume(name, info)) return;
    if (SharedThemeProtocol.consume(name, info, function () {
        updateTheme();
        SharedThemeProtocol.requestRepaint();
    })) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getTaggerSettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyTaggerSetting)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        const nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (accentMode === 'shared') {
            updateTheme();
            window.Repaint();
        }
    }
}

function scheduleSelectionRefresh() {
    if (!scriptActive) return;
    clearTimer(selectionTimer);
    selectionTimer = window.SetTimeout(function () {
        selectionTimer = 0;
        if (!scriptActive) return;
        refreshSelection(true);
    }, SELECTION_DEBOUNCE_MS);
}

function on_playlist_items_selection_change() {
    scheduleSelectionRefresh();
}

function on_playlist_switch() {
    scheduleSelectionRefresh();
}

function on_playlists_changed() {
    scheduleSelectionRefresh();
}

// A write of our own lands here too, which is what refreshes every field's
// "already matches" state without a second lookup.
function on_metadb_changed() {
    if (view !== 'review' || !chosenRelease || !selection) return;
    const aligned = flattenTracks(chosenRelease).length === selection.order.length;
    buildFields(chosenRelease, aligned);
    rebuildRows();
}

function on_colours_changed() {
    updateTheme();
    window.Repaint();
}

function on_font_changed() {
    RivageUI.clearFontCache();
    updateTheme(true);
    window.Repaint();
}

function runInitialContentLoad() {
    if (!initialLoadPending || !scriptActive) return;
    if (!VisiblePaintWork.isVisible()) return;
    initialLoadPending = false;
    refreshSelection(false);
}

function on_script_unload() {
    scriptActive = false;
    initialLoadPending = false;
    generation++;
    clearTimer(initTimer);
    clearTimer(selectionTimer);
    clearTimer(requestTimer);
    initTimer = 0;
    selectionTimer = 0;
    requestTimer = 0;
    requestQueue = [];
    requestContexts.clear();
    undoState = null;
    saveCacheFile();
}

updateTheme();
SharedAccentProtocol.request();
try {
    utils.CreateFolder(CACHE_DIR);
} catch (e) { reportFailure('the cache folder could not be created', e); }
loadCacheFile();

initTimer = window.SetTimeout(function () {
    initTimer = 0;
    if (!scriptActive) return;
    runInitialContentLoad();
    window.Repaint();
}, 1);
