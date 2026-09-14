'use strict';

window.DrawMode = 0;

// Shared RVG services: accent consumer, settings registry, local-library actions.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\library_resolver_v2.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\library_actions_v2.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\visible_paint_work.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

const PANEL_VERSION = '2.2.2';

window.DefineScript(RivageUI.copy.popupTitle('Live shows'), {
    author: 'RivaGe',
    version: PANEL_VERSION
});

// Narrow failure reporting. Most empty catches in this file guard drawing
// calls and host reads that are expected to fail and stay silent on purpose.
// Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Live Shows] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

const PROP = 'RVG Live Shows.';
const SETTINGS_PANEL_ID = 'live_shows';
const SETTINGS_PANEL_LABEL = 'Live shows';

const TICKETMASTER_ROOT = 'https://app.ticketmaster.com/discovery/v2';
const SEATGEEK_ROOT = 'https://api.seatgeek.com/2';
const USER_AGENT = 'foobar2000-JSplitter-LiveShows/' + PANEL_VERSION;

const CACHE_DIR = fb.ProfilePath + 'jsplitter_live_shows_cache\\';
const CACHE_FILE = CACHE_DIR + 'upcoming_shows_v2.json';
const CACHE_VERSION = 2;
const CACHE_WRITE_INTERVAL_MS = 8000;

// verifiesMbid is the source's ability to return a MusicBrainz ID at all, which
// gates both the strict setting and the per-row name-match tag.
const SOURCE_DEFS = {
    ticketmaster: { id: 'ticketmaster', label: 'Ticketmaster', intervalMs: 260, verifiesMbid: true },
    seatgeek: { id: 'seatgeek', label: 'SeatGeek', intervalMs: 400, verifiesMbid: false }
};
const DEFAULT_SOURCE = 'ticketmaster';

const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_DELAY_MS = 60000;
const RETRY_JITTER_MS = 1000;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000;
// An artist with nothing booked is re-checked far less often than one on tour.
const EMPTY_CACHE_MULTIPLIER = 2;
// One page only, sorted nearest-first: an artist with more than this many
// upcoming dates loses the far tail, never the shows that matter.
const TICKETMASTER_EVENT_PAGE_SIZE = 60;
const SEATGEEK_EVENT_PAGE_SIZE = 50;

const MF_STRING = 0x00000000;
const MF_GRAYED = 0x00000001;
const IDC_ARROW = 32512;
const IDC_HAND = 32649;

const DT_LEFT = 0x00000000;
const DT_RIGHT = 0x00000002;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const DT_END_ELLIPSIS = 0x00008000;

const SMOOTHING_MODE_DEFAULT = 0;
const SMOOTHING_MODE_ANTIALIAS = 4;
const DEFAULT_UWP_ACCENT = 0xff0078d4;

// Keep panel-rendered separators ASCII-only; some GDI setups misdecode the rest.
const SEPARATOR = ' | ';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_SHORT = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

const CMD_OPEN_EVENT = 1;
const CMD_OPEN_TICKETS = 2;
const CMD_COPY = 3;
const CMD_REFRESH = 10;
const CMD_REFRESH_ALL = 11;
const CMD_CLEAR_CACHE = 12;
const CMD_SETTINGS = 13;
const CMD_EDIT = 14;

let uiScale = 1;
let PAD = 14;
let HEADER_H = 76;
let HEADER_GAP = 8;
let SECTION_H = 30;
let ITEM_H = 64;

function normalizeSource(value) {
    const key = String(value || '').toLowerCase();
    return SOURCE_DEFS[key] ? key : DEFAULT_SOURCE;
}

function normalizeHorizon(value) {
    const days = Math.round(Number(value) || 0);
    if (days <= 90) return 90;
    if (days >= 730) return 730;
    if (days <= 180) return 180;
    return 365;
}

let source = normalizeSource(window.GetProperty(PROP + 'Source', DEFAULT_SOURCE));
let ticketmasterApiKey = String(window.GetProperty(PROP + 'Ticketmaster API key', ''));
let seatgeekClientId = String(window.GetProperty(PROP + 'SeatGeek client ID', ''));
let locationFilter = String(window.GetProperty(PROP + 'Location filter', ''));
let horizonDays = normalizeHorizon(window.GetProperty(PROP + 'Horizon days', 365));
let cacheDays = clamp(Math.round(Number(window.GetProperty(PROP + 'Cache days', 7)) || 7), 1, 60);
let minimumTracks = clamp(Math.round(Number(window.GetProperty(PROP + 'Minimum tracks', 3)) || 1), 1, 50);
let compactRows = !!window.GetProperty(PROP + 'Compact rows', false);
let accentMode = String(window.GetProperty(PROP + 'Accent mode', 'shared'));
let requireMbidMatch = !!window.GetProperty(PROP + 'Require MBID match', false);

function normalizeAccentMode(value) {
    const mode = String(value || '').toLowerCase();
    return mode === 'fixed' || mode === 'host' ? mode : 'shared';
}
accentMode = normalizeAccentMode(accentMode);

const tfLibraryArtist = fb.TitleFormat('$if2(%album artist%,%artist%)');
const tfLibraryArtistMbids = fb.TitleFormat('$if3($meta_sep(musicbrainz_albumartistid,|),$meta_sep(musicbrainz_artistid,|),$meta_sep(musicbrainz album artist id,|),$meta_sep(musicbrainz artist id,|),)');

let ww = 0;
let wh = 0;
let colours = {};
let fonts = {};
let fontLayoutKey = '';
let sharedAlbumAccent = DEFAULT_UWP_ACCENT;
let hostAccent = DEFAULT_UWP_ACCENT;

// `colours` is mutated in place by updateTheme(), never reassigned, so the
// painter's reference stays live.
const painter = RivageUI.createPainter({ scale: scaleUi, theme: colours });

let libraryArtists = [];
let libraryReady = false;
let libraryDebug = { state: 'not built', at: 0, trackCount: 0, artists: 0, error: '' };

let cache = null;
let cacheDirty = false;
let cacheWrittenAt = 0;
let cacheDebug = { state: 'not checked', path: CACHE_FILE, checkedAt: 0, savedAt: 0, artists: 0, shows: 0, error: '' };

let displayRows = [];
let contentHeight = 0;
let scrollY = 0;
let hoverRow = -1;
let pointerX = -1;
let pointerY = -1;
let pointerInside = false;

let stats = { shows: 0, artists: 0, filtered: 0, unverified: 0 };
// Artists this source could have confirmed by MusicBrainz ID but did not.
let nameOnlyArtists = new Set();
let statusText = 'Loading...';
let statusIsError = false;

let generation = 0;
let scriptActive = true;
let initTimer = 0;
let initialLoadPending = true;

let sweepRun = null;
let sweepForce = false;
let requestQueue = [];
let requestContexts = new Map();
let requestTimer = 0;
let lastRequestAt = 0;
let blockedUntil = 0;
let consecutiveTransientErrors = 0;
let networkDebug = { state: 'idle', kind: '', at: 0, httpStatus: 0, detail: '' };

let menuState = null;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

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

function normalizeBasic(value) {
    let s = String(value || '');
    try {
        s = s.normalize('NFKD');
    } catch (e) {
        // Older engines can continue without Unicode normalization.
    }
    return s
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeArtist(value) {
    return normalizeBasic(value).replace(/^the\s+/, '');
}

function isVariousArtistsName(value) {
    const key = normalizeArtist(value);
    return key === 'various artists' || key === 'various artist' || key === 'va';
}

function isGenericArtistName(value) {
    const key = normalizeArtist(value);
    return !key || isVariousArtistsName(value) || key === 'unknown artist' || key === 'unknown';
}

function artistNameVariants(value) {
    const text = cleanSpaces(value);
    if (!text) return [];
    const parts = text.split(/\s*;\s*/);
    if (parts.length <= 1) return [text];
    const out = [];
    for (let i = 0; i < parts.length; i++) {
        const part = cleanSpaces(parts[i]);
        if (part) out.push(part);
    }
    return out.length ? out : [text];
}

function extractUuids(value) {
    const matches = String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig);
    if (!matches) return [];
    const seen = new Set();
    const result = [];
    for (let i = 0; i < matches.length; i++) {
        const id = matches[i].toLowerCase();
        if (!seen.has(id)) {
            seen.add(id);
            result.push(id);
        }
    }
    return result;
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

function pad2(value) {
    return value < 10 ? '0' + value : String(value);
}

function isoDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function todayIso() {
    return isoDate(new Date());
}

function horizonIso() {
    const now = new Date();
    return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + horizonDays));
}

function formatDayLabel(isoText) {
    const parts = String(isoText || '').split('-');
    if (parts.length < 3) return isoText || '';
    const monthIndex = clamp(Number(parts[1]) - 1, 0, 11);
    return MONTH_SHORT[monthIndex] + ' ' + String(Number(parts[2]));
}

function formatMonthLabel(isoText) {
    const parts = String(isoText || '').split('-');
    if (parts.length < 2) return isoText || '';
    const monthIndex = clamp(Number(parts[1]) - 1, 0, 11);
    return MONTH_NAMES[monthIndex] + ' ' + parts[0];
}

function weekdayLabel(isoText) {
    const parts = String(isoText || '').split('-');
    if (parts.length < 3) return '';
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return '';
    return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
}

function venueLine(show) {
    const bits = [];
    if (show.venue) bits.push(show.venue);
    const place = [show.city, show.region, show.country].filter(Boolean);
    if (place.length) bits.push(place.join(', '));
    return bits.join(SEPARATOR);
}

function currentSourceDef() {
    return SOURCE_DEFS[source] || SOURCE_DEFS[DEFAULT_SOURCE];
}

function sourceVerifiesMbid() {
    return !!currentSourceDef().verifiesMbid;
}

function sourceCredential() {
    return source === 'seatgeek' ? seatgeekClientId : ticketmasterApiKey;
}

function credentialLabel() {
    return source === 'seatgeek' ? 'SeatGeek client ID' : 'Ticketmaster API key';
}

// A semicolon starts another place; a comma narrows the one you are in. So
// "California, United States" is one place needing both, not two alternatives -
// without that, its second half matched every show in the country.
let locationPlaces = [];

function rebuildLocationTokens() {
    locationPlaces = [];
    const groups = String(locationFilter || '').split(';');
    for (let i = 0; i < groups.length; i++) {
        const parts = groups[i].split(',').map(normalizeBasic).filter(Boolean);
        if (parts.length) locationPlaces.push(parts);
    }
}
rebuildLocationTokens();

function showMatchesLocation(show) {
    if (!locationPlaces.length) return true;
    const haystack = normalizeBasic([show.city, show.region, show.country, show.place].filter(Boolean).join(' '));
    if (!haystack) return false;
    const padded = ' ' + haystack + ' ';

    for (let i = 0; i < locationPlaces.length; i++) {
        const parts = locationPlaces[i];
        let all = true;
        for (let p = 0; p < parts.length; p++) {
            if (padded.indexOf(' ' + parts[p] + ' ') < 0) {
                all = false;
                break;
            }
        }
        if (all) return true;
    }
    return false;
}

function requestedAccent() {
    if (accentMode === 'fixed') return DEFAULT_UWP_ACCENT;
    if (accentMode === 'host') return hostAccent || DEFAULT_UWP_ACCENT;
    return sharedAlbumAccent || DEFAULT_UWP_ACCENT;
}

function updateLayoutMetrics(baseSize) {
    uiScale = clamp(Number(baseSize || 12) / 12, 0.82, 1.8);
    PAD = scaleUi(14);
    HEADER_H = scaleUi(76);
    HEADER_GAP = scaleUi(8);
    SECTION_H = scaleUi(30);
    ITEM_H = scaleUi(compactRows ? 52 : 64);
}

function updateTheme(forceFonts) {
    const host = RivageUI.hostInfo();
    const name = host && host.fontFamily ? String(host.fontFamily) : 'Segoe UI';
    const size = Math.max(9, host && Number(host.scaleFontSize) > 0 ? Number(host.scaleFontSize) : 12);
    const nextKey = name.toLowerCase() + '|' + size + '|' + (compactRows ? 'compact' : 'normal');
    const layoutChanged = !!forceFonts || nextKey !== fontLayoutKey;

    if (layoutChanged) updateLayoutMetrics(size);

    hostAccent = SharedAccentProtocol.opaque(host && host.accent !== undefined ? host.accent : DEFAULT_UWP_ACCENT);
    const requested = SharedAccentProtocol.opaque(requestedAccent());
    const resolved = RivageUI.createTheme({ mode: 'host', accent: requested });
    const accent = SharedAccentProtocol.opaque(accentMode === 'shared' ? resolved.accent : requested);

    colours.background = resolved.background;
    colours.card = resolved.card;
    colours.cardHover = resolved.cardHover;
    colours.text = resolved.textPrimary;
    colours.muted = resolved.textMuted;
    colours.rule = resolved.separator;
    colours.accent = accent;
    colours.error = resolved.danger;
    colours.scrollTrack = resolved.scrollTrack;

    if (layoutChanged) {
        fonts.normal = RivageUI.font(name, size, 0);
        fonts.bold = RivageUI.font(name, size, 1);
        fonts.small = RivageUI.font(name, Math.max(8, size - 1), 0);
        fonts.smallBold = RivageUI.font(name, Math.max(8, size - 1), 1);
        fonts.tiny = RivageUI.font(name, Math.max(8, size - 2), 0);
        fonts.day = RivageUI.font(name, Math.max(12, size + 3), 1);
        fonts.title = RivageUI.font(name, Math.max(14, size + 4), 1);
        fontLayoutKey = nextKey;
        if (displayRows.length) reflowRows();
    }

    painter.setTheme(colours);
}

function drawText(gr, text, font, colour, x, y, w, h, flags) {
    if (w <= 0 || h <= 0) return;
    gr.GdiDrawText(String(text || ''), font, colour, Math.round(x), Math.round(y), Math.round(w), Math.round(h), flags);
}

function fillRoundRect(gr, x, y, w, h, radius, colour) {
    if (w <= 0 || h <= 0) return;
    if (typeof gr.FillRoundRect === 'function') {
        gr.FillRoundRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), Math.round(radius), Math.round(radius), colour);
    } else {
        gr.FillSolidRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), colour);
    }
}

function headerCardRect() {
    const h = Math.max(scaleUi(20), HEADER_H - PAD - HEADER_GAP);
    return { x: PAD, y: PAD, w: Math.max(0, ww - PAD * 2), h: h };
}

function viewportHeight() {
    return Math.max(0, wh - HEADER_H);
}

function maxScroll() {
    return Math.max(0, contentHeight - viewportHeight());
}

function rebuildLibraryIndex() {
    libraryReady = false;
    libraryDebug = { state: 'building', at: Date.now(), trackCount: 0, artists: 0, error: '' };

    const byKey = new Map();
    let count = 0;

    try {
        const handles = fb.GetLibraryItems();
        const names = tfLibraryArtist.EvalWithMetadbs(handles);
        const mbidValues = tfLibraryArtistMbids.EvalWithMetadbs(handles);
        count = handles.Count;

        for (let i = 0; i < count; i++) {
            const mbids = extractUuids(mbidValues[i]);
            const variants = artistNameVariants(names[i]);
            for (let v = 0; v < variants.length; v++) {
                const display = variants[v];
                if (isGenericArtistName(display)) continue;
                const key = normalizeArtist(display);
                if (!key) continue;
                let entry = byKey.get(key);
                if (!entry) {
                    entry = { key: key, name: display, mbids: [], tracks: 0 };
                    byKey.set(key, entry);
                }
                entry.tracks++;
                // A split credit spreads every MBID on the track across each of
                // its names; verification only ever rejects on a positive
                // mismatch, so an over-broad set stays safe.
                for (let m = 0; m < mbids.length; m++) {
                    if (entry.mbids.indexOf(mbids[m]) < 0) entry.mbids.push(mbids[m]);
                }
            }
        }
    } catch (e) {
        libraryDebug = { state: 'failed', at: Date.now(), trackCount: count, artists: 0, error: debugSnippet(e, 240) };
        statusText = 'Library index failed: ' + (e && e.message ? e.message : String(e));
        statusIsError = true;
        reportFailure('the library artist index could not be built', e);
        window.Repaint();
        return false;
    }

    const artists = [];
    byKey.forEach(function (entry) { artists.push(entry); });
    artists.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });

    libraryArtists = artists;
    libraryReady = true;
    libraryDebug = { state: 'ready', at: Date.now(), trackCount: count, artists: artists.length, error: '' };
    return true;
}

function eligibleArtists() {
    const out = [];
    for (let i = 0; i < libraryArtists.length; i++) {
        if (libraryArtists[i].tracks >= minimumTracks) out.push(libraryArtists[i]);
    }
    return out;
}

const libraryRebuildGate = VisiblePaintWork.create(function () {
    if (!scriptActive) return;
    if (!rebuildLibraryIndex()) return;
    startSweep(false);
});

function requestLibraryRebuild(reason) {
    libraryRebuildGate.request(reason + ':' + Date.now());
}

function emptyCache() {
    return { version: CACHE_VERSION, savedAt: 0, artists: {} };
}

function cacheKey(artistKey) {
    return source + '|' + artistKey;
}

function loadCacheFile() {
    if (cache) return cache;

    let state = 'missing';
    let error = '';
    try {
        if (utils.IsFile(CACHE_FILE)) {
            const data = safeJson(utils.ReadTextFile(CACHE_FILE, 65001));
            if (data && Number(data.version) === CACHE_VERSION && data.artists && typeof data.artists === 'object') {
                cache = data;
                state = 'valid';
            } else {
                state = 'invalid';
                error = 'Unsupported or corrupt cache file; it is being rebuilt.';
            }
        }
    } catch (e) {
        state = 'read error';
        error = debugSnippet(e, 180);
        reportFailure('the show cache could not be read', e);
    }

    if (!cache) cache = emptyCache();
    refreshCacheDebug(state === 'missing' ? 'empty' : state, error);
    return cache;
}

function saveCacheFile(force) {
    if (!cache || !cacheDirty) return;
    if (!force && Date.now() - cacheWrittenAt < CACHE_WRITE_INTERVAL_MS) return;

    try {
        utils.CreateFolder(CACHE_DIR);
        cache.version = CACHE_VERSION;
        cache.savedAt = Date.now();
        utils.WriteTextFile(CACHE_FILE, JSON.stringify(cache), false);
        cacheDirty = false;
        cacheWrittenAt = Date.now();
        refreshCacheDebug('valid', '');
    } catch (e) {
        refreshCacheDebug('write error', debugSnippet(e, 180));
        reportFailure('the show cache could not be written', e);
    }
}

function refreshCacheDebug(state, error) {
    let artists = 0;
    let shows = 0;
    try {
        const keys = cache ? Object.keys(cache.artists) : [];
        artists = keys.length;
        for (let i = 0; i < keys.length; i++) {
            const entry = cache.artists[keys[i]];
            if (entry && Array.isArray(entry.shows)) shows += entry.shows.length;
        }
    } catch (e) { }
    cacheDebug = {
        state: String(state || 'unknown'), path: CACHE_FILE, checkedAt: Date.now(),
        savedAt: cache ? Number(cache.savedAt || 0) : 0,
        artists: artists, shows: shows, error: String(error || '')
    };
}

function cacheEntry(artistKey) {
    const store = loadCacheFile();
    return store.artists[cacheKey(artistKey)] || null;
}

function storeCacheEntry(artist, shows, matchedMbid, verified, error, note) {
    const store = loadCacheFile();
    store.artists[cacheKey(artist.key)] = {
        savedAt: Date.now(),
        name: artist.name,
        mbid: matchedMbid || '',
        verified: !!verified,
        error: String(error || ''),
        note: String(note || ''),
        shows: Array.isArray(shows) ? shows : []
    };
    cacheDirty = true;
    saveCacheFile(false);
}

function entryFresh(entry) {
    if (!entry || !(Number(entry.savedAt) > 0)) return false;
    const lifetime = cacheDays * 24 * 60 * 60 * 1000 *
        (Array.isArray(entry.shows) && entry.shows.length ? 1 : EMPTY_CACHE_MULTIPLIER);
    return Date.now() - Number(entry.savedAt) < lifetime;
}

function pruneCacheToLibrary() {
    const store = loadCacheFile();
    if (!libraryReady) return;
    const live = new Set();
    for (let i = 0; i < libraryArtists.length; i++) live.add(cacheKey(libraryArtists[i].key));
    const keys = Object.keys(store.artists);
    let removed = 0;
    for (let i = 0; i < keys.length; i++) {
        // Only this source's keys are pruned; the other source keeps its cache.
        if (keys[i].indexOf(source + '|') !== 0) continue;
        if (!live.has(keys[i])) {
            delete store.artists[keys[i]];
            removed++;
        }
    }
    if (removed) cacheDirty = true;
}

function requestHeaders() {
    return JSON.stringify({
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
    });
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
    // Strictly serial: one in-flight request keeps the global cooldown authoritative.
    if (requestContexts.size) return;

    const now = Date.now();
    const wait = Math.max(
        Math.max(0, currentSourceDef().intervalMs - (now - lastRequestAt)),
        Math.max(0, blockedUntil - now)
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
    } catch (e) {
        // Deferred, or a host that throws for every URL would recurse through
        // the whole sweep on one stack.
        const detail = String(e);
        window.SetTimeout(function () { handleRequestFailure(context, 0, detail); }, 0);
    }
}

function handleRequestFailure(context, status, detail) {
    if (context.generation !== generation) return;

    if (isTransientHttpStatus(status) && Number(context.retries || 0) < MAX_TRANSIENT_RETRIES) {
        consecutiveTransientErrors++;
        let delay = transientRetryDelay(context.retries);
        if (consecutiveTransientErrors >= CIRCUIT_BREAKER_FAILURES) delay = Math.max(delay, CIRCUIT_BREAKER_COOLDOWN_MS);
        blockedUntil = Math.max(blockedUntil, Date.now() + delay);
        requestQueue.unshift(Object.assign({}, context, { retries: Number(context.retries || 0) + 1 }));
        setNetworkDebug('retrying', context.kind, 'Retry in ' + Math.round(delay / 1000) + ' s.', status);
        statusText = currentSourceDef().label + ' temporarily unavailable; retrying...';
        statusIsError = false;
        window.Repaint();
        pumpRequestQueue();
        return;
    }

    // An artist that cannot be fetched is cached as a failure so one bad name
    // never stalls the sweep, and is retried on the next refresh.
    setNetworkDebug('failed', context.kind, detail || ('HTTP ' + status), status);
    if (status === 401 || status === 403) {
        statusText = 'Rejected by ' + currentSourceDef().label + ' (HTTP ' + status + '). Check your ' + credentialLabel() + '.';
        statusIsError = true;
        abortSweep();
        window.Repaint();
        return;
    }
    finishArtist(context, [], '', false, debugSnippet(detail || ('HTTP ' + status), 160));
}

function on_http_request_done(taskId, success, responseText, status) {
    if (!scriptActive) return;
    const context = requestContexts.get(taskId);
    if (!context) return;
    requestContexts.delete(taskId);

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

    consecutiveTransientErrors = 0;
    blockedUntil = 0;
    setNetworkDebug('completed', context.kind, 'HTTP ' + status, status);

    try {
        if (context.kind === 'tm-attraction') handleTicketmasterAttraction(context, data);
        else if (context.kind === 'tm-events') handleTicketmasterEvents(context, data);
        else if (context.kind === 'sg-performer') handleSeatgeekPerformer(context, data);
        else if (context.kind === 'sg-events') handleSeatgeekEvents(context, data);
    } catch (e) {
        reportFailure('a ' + context.kind + ' response could not be processed', e);
        finishArtist(context, [], '', false, debugSnippet(e, 160));
    }
}

function requestTicketmasterAttraction(artist, index) {
    enqueueRequest({
        kind: 'tm-attraction',
        generation: generation,
        artist: artist,
        index: index,
        retries: 0,
        url: TICKETMASTER_ROOT + '/attractions.json?apikey=' + encodeURIComponent(ticketmasterApiKey) +
            '&classificationName=music&size=10&keyword=' + encodeURIComponent(artist.name)
    });
}

function attractionMbids(attraction) {
    const links = attraction && attraction.externalLinks;
    const entries = links && Array.isArray(links.musicbrainz) ? links.musicbrainz : [];
    const out = [];
    for (let i = 0; i < entries.length; i++) {
        const id = String((entries[i] && entries[i].id) || '').toLowerCase();
        if (id) out.push(id);
    }
    return out;
}

function handleTicketmasterAttraction(context, data) {
    const artist = context.artist;
    const embedded = data && data._embedded;
    const list = embedded && Array.isArray(embedded.attractions) ? embedded.attractions : [];

    let chosen = null;
    let chosenMbid = '';
    let confirmed = false;
    let nameMatch = null;
    for (let i = 0; i < list.length; i++) {
        const attraction = list[i];
        if (normalizeArtist(attraction && attraction.name) !== artist.key) continue;
        if (!nameMatch) nameMatch = attraction;
        const ids = attractionMbids(attraction);
        for (let m = 0; m < ids.length; m++) {
            if (artist.mbids.indexOf(ids[m]) >= 0) {
                chosen = attraction;
                chosenMbid = ids[m];
                confirmed = true;
                break;
            }
        }
        if (chosen) break;
    }

    // Keyword search is fuzzy, so an exact-name hit is the weakest acceptable
    // match and only stands when MBID verification is not demanded.
    if (!chosen && nameMatch) {
        const ids = attractionMbids(nameMatch);
        if (!artistIdentityAccepted(artist, ids.length ? ids[0] : '')) {
            finishArtist(context, [], ids.length ? ids[0] : '', false, '', identityRejection(ids.length ? ids[0] : ''));
            return;
        }
        chosen = nameMatch;
        chosenMbid = ids.length ? ids[0] : '';
        confirmed = artistIdentityConfirmed(artist, chosenMbid);
    }

    if (!chosen || !chosen.id) {
        finishArtist(context, [], '', false, '');
        return;
    }

    enqueueRequest({
        kind: 'tm-events',
        generation: generation,
        artist: artist,
        index: context.index,
        mbid: chosenMbid,
        confirmed: confirmed,
        retries: 0,
        url: TICKETMASTER_ROOT + '/events.json?apikey=' + encodeURIComponent(ticketmasterApiKey) +
            '&attractionId=' + encodeURIComponent(String(chosen.id)) +
            '&size=' + TICKETMASTER_EVENT_PAGE_SIZE + '&sort=date,asc' +
            '&startDateTime=' + todayIso() + 'T00:00:00Z'
    });
}

function handleTicketmasterEvents(context, data) {
    const embedded = data && data._embedded;
    const events = embedded && Array.isArray(embedded.events) ? embedded.events : [];
    const shows = [];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) continue;
        const start = (event.dates && event.dates.start) || {};
        const date = String(start.localDate || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const venues = event._embedded && Array.isArray(event._embedded.venues) ? event._embedded.venues : [];
        const venue = venues.length ? venues[0] : {};
        shows.push({
            date: date,
            time: String(start.localTime || '').substring(0, 5),
            artist: context.artist.name,
            artistKey: context.artist.key,
            title: cleanSpaces(event.name),
            venue: cleanSpaces(venue.name),
            city: cleanSpaces(venue.city && venue.city.name),
            region: cleanSpaces(venue.state && (venue.state.stateCode || venue.state.name)),
            country: cleanSpaces(venue.country && venue.country.name),
            // region shows the short code, so the spelled-out state and the
            // country code are kept here for the place filter to match on.
            place: cleanSpaces([
                venue.state && venue.state.name,
                venue.state && venue.state.stateCode,
                venue.country && venue.country.countryCode
            ].filter(Boolean).join(' ')),
            url: String(event.url || ''),
            tickets: String(event.url || '')
        });
    }
    finishArtist(context, shows, context.mbid || '', !!context.confirmed, '');
}

function requestSeatgeekPerformer(artist, index) {
    enqueueRequest({
        kind: 'sg-performer',
        generation: generation,
        artist: artist,
        index: index,
        retries: 0,
        url: SEATGEEK_ROOT + '/performers?client_id=' + encodeURIComponent(seatgeekClientId) +
            '&per_page=10&q=' + encodeURIComponent(artist.name)
    });
}

// SeatGeek indexes sports teams and shows alongside bands under one performer
// namespace, so a name match alone could hand back a basketball team.
function seatgeekPerformerIsMusic(performer) {
    const type = String((performer && performer.type) || '').toLowerCase();
    if (type === 'band' || type === 'musician') return true;
    return !!(performer && Array.isArray(performer.genres) && performer.genres.length);
}

function handleSeatgeekPerformer(context, data) {
    const artist = context.artist;
    const performers = data && Array.isArray(data.performers) ? data.performers : [];

    let chosen = null;
    for (let i = 0; i < performers.length; i++) {
        const performer = performers[i];
        if (normalizeArtist(performer && performer.name) !== artist.key) continue;
        if (!seatgeekPerformerIsMusic(performer)) continue;
        chosen = performer;
        break;
    }

    if (!chosen || !chosen.id) {
        finishArtist(context, [], '', false, '', performers.length ? 'no music performer of that name' : '');
        return;
    }

    // Same saving as an artist-info call elsewhere: a performer with nothing
    // booked costs one request instead of two.
    if (chosen.num_upcoming_events !== undefined && !(Number(chosen.num_upcoming_events) > 0)) {
        finishArtist(context, [], '', false, '', '');
        return;
    }

    enqueueRequest({
        kind: 'sg-events',
        generation: generation,
        artist: artist,
        index: context.index,
        retries: 0,
        url: SEATGEEK_ROOT + '/events?client_id=' + encodeURIComponent(seatgeekClientId) +
            '&performers.id=' + encodeURIComponent(String(chosen.id)) +
            '&per_page=' + SEATGEEK_EVENT_PAGE_SIZE + '&sort=datetime_local.asc' +
            '&datetime_utc.gte=' + todayIso()
    });
}

function handleSeatgeekEvents(context, data) {
    const events = data && Array.isArray(data.events) ? data.events : [];
    const shows = [];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) continue;
        const local = String(event.datetime_local || '');
        const date = local.substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const venue = event.venue || {};
        shows.push({
            date: date,
            // SeatGeek marks an unknown start time as 03:00, its own sentinel.
            time: local.substring(11, 16) === '03:00' ? '' : local.substring(11, 16),
            artist: context.artist.name,
            artistKey: context.artist.key,
            title: cleanSpaces(event.title),
            venue: cleanSpaces(venue.name),
            city: cleanSpaces(venue.city),
            region: cleanSpaces(venue.state),
            country: cleanSpaces(venue.country),
            // venue.country is an ISO2 code, so the spelled-out location is kept
            // for the place filter to match on without being displayed.
            place: cleanSpaces(venue.display_location),
            url: String(event.url || ''),
            tickets: String(event.url || '')
        });
    }
    finishArtist(context, shows, '', false, '', '');
}

function identityRejection(remoteMbid) {
    return remoteMbid ? 'MusicBrainz ID mismatch' : 'no MusicBrainz ID to verify against';
}

function artistIdentityConfirmed(artist, remoteMbid) {
    return !!remoteMbid && artist.mbids.indexOf(remoteMbid) >= 0;
}

// Strict mode demands confirmation on both sides; otherwise only a positive
// mismatch rejects, since that means a different artist of the same name.
function artistIdentityAccepted(artist, remoteMbid) {
    if (requireMbidMatch && sourceVerifiesMbid()) return artistIdentityConfirmed(artist, remoteMbid);
    if (!remoteMbid || !artist.mbids.length) return true;
    return artistIdentityConfirmed(artist, remoteMbid);
}

function startSweep(force) {
    if (!scriptActive) return;
    // A settings edit can land before the first index build; queue one rather
    // than leaving the panel showing whatever it happened to have.
    if (!libraryReady) {
        requestLibraryRebuild('sweep');
        return;
    }

    generation++;
    requestQueue = [];
    requestContexts.clear();
    clearTimer(requestTimer);
    requestTimer = 0;
    blockedUntil = 0;
    consecutiveTransientErrors = 0;
    sweepForce = !!force;

    loadCacheFile();
    pruneCacheToLibrary();

    if (!sourceCredential()) {
        sweepRun = null;
        statusText = 'Enter your ' + credentialLabel() + ' in RVG Settings > Live shows.';
        statusIsError = true;
        rebuildRows();
        return;
    }

    const artists = eligibleArtists();
    if (!artists.length) {
        sweepRun = null;
        statusText = libraryArtists.length
            ? 'No library artist has at least ' + plural(minimumTracks, 'track') + '.'
            : 'No artists found in the foobar2000 library.';
        statusIsError = false;
        rebuildRows();
        return;
    }

    sweepRun = { generation: generation, artists: artists, index: -1, fetched: 0, reused: 0, failed: 0 };
    rebuildRows();
    advanceSweep();
}

function abortSweep() {
    generation++;
    sweepRun = null;
    requestQueue = [];
    requestContexts.clear();
    clearTimer(requestTimer);
    requestTimer = 0;
    saveCacheFile(true);
}

function advanceSweep() {
    if (!sweepRun || sweepRun.generation !== generation) return;

    while (true) {
        sweepRun.index++;
        if (sweepRun.index >= sweepRun.artists.length) {
            finishSweep();
            return;
        }
        const artist = sweepRun.artists[sweepRun.index];
        if (!sweepForce && entryFresh(cacheEntry(artist.key))) {
            sweepRun.reused++;
            continue;
        }
        requestArtist(artist, sweepRun.index);
        updateSweepStatus();
        window.Repaint();
        return;
    }
}

function requestArtist(artist, index) {
    if (source === 'seatgeek') requestSeatgeekPerformer(artist, index);
    else requestTicketmasterAttraction(artist, index);
}

// Every source path funnels here, so the cache write and the sweep step happen
// exactly once per artist whatever the outcome.
function finishArtist(context, shows, matchedMbid, verified, error, note) {
    if (context.generation !== generation) return;
    storeCacheEntry(context.artist, shows, matchedMbid, verified, error, note);
    if (sweepRun && sweepRun.generation === generation) {
        if (error) sweepRun.failed++;
        else sweepRun.fetched++;
    }
    // A library-wide sweep runs thousands of times, so the full row rebuild is
    // spent only on the artists that actually brought something new to show.
    if (Array.isArray(shows) && shows.length) rebuildRows();
    advanceSweep();
}

function updateSweepStatus() {
    if (!sweepRun) return;
    statusText = 'Checking ' + currentSourceDef().label + '... ' +
        (sweepRun.index + 1) + ' / ' + sweepRun.artists.length + ' artists';
    statusIsError = false;
}

function finishSweep() {
    const run = sweepRun;
    sweepRun = null;
    sweepForce = false;
    saveCacheFile(true);
    if (run && run.failed) {
        setNetworkDebug('completed', 'sweep', run.failed + ' artist(s) could not be read.', 0);
    }
    rebuildRows();
}

function collectShows() {
    const store = loadCacheFile();
    const from = todayIso();
    const to = horizonIso();
    const seen = new Set();
    const shows = [];
    const artistKeys = new Set();
    let filtered = 0;
    let unverified = 0;
    nameOnlyArtists = new Set();

    const artists = eligibleArtists();
    for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];
        const entry = store.artists[cacheKey(artist.key)];
        if (!entry || !Array.isArray(entry.shows) || !entry.shows.length) continue;
        if (!entry.verified) {
            unverified++;
            nameOnlyArtists.add(artist.key);
        }

        for (let s = 0; s < entry.shows.length; s++) {
            const show = entry.shows[s];
            if (!show || !show.date) continue;
            if (show.date < from || show.date > to) continue;
            if (!showMatchesLocation(show)) {
                filtered++;
                continue;
            }
            const dedupe = show.artistKey + '\u0001' + show.date + '\u0001' + normalizeBasic(show.venue);
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            shows.push(show);
            artistKeys.add(show.artistKey);
        }
    }

    shows.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        const timeA = a.time || '';
        const timeB = b.time || '';
        if (timeA !== timeB) return timeA < timeB ? -1 : 1;
        return String(a.artist).localeCompare(String(b.artist), undefined, { sensitivity: 'base' });
    });

    stats = { shows: shows.length, artists: artistKeys.size, filtered: filtered, unverified: unverified };
    return shows;
}

function rebuildRows() {
    const shows = collectShows();
    const rows = [];
    let month = '';

    for (let i = 0; i < shows.length; i++) {
        const show = shows[i];
        const showMonth = String(show.date).substring(0, 7);
        if (showMonth !== month) {
            month = showMonth;
            rows.push({ kind: 'section', label: formatMonthLabel(show.date), count: 0, height: SECTION_H, top: 0 });
        }
        rows.push({ kind: 'show', show: show, height: ITEM_H, top: 0 });
    }

    // Section counts are only known once the month's rows have all been added.
    let sectionIndex = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].kind === 'section') sectionIndex = i;
        else if (sectionIndex >= 0) rows[sectionIndex].count++;
    }

    displayRows = rows;
    reflowRows();

    if (!sweepRun) {
        if (!sourceCredential()) {
            statusText = 'Enter your ' + credentialLabel() + ' in RVG Settings > Live shows.';
            statusIsError = true;
        } else if (!shows.length) {
            statusText = libraryReady
                ? 'No upcoming shows found for your library artists' + (locationPlaces.length ? ' in ' + locationFilter + '.' : '.')
                : 'Indexing the foobar2000 library...';
            statusIsError = false;
        } else {
            statusText = summaryLine();
            statusIsError = false;
        }
    }

    window.Repaint();
}

function reflowRows() {
    let top = 0;
    for (let i = 0; i < displayRows.length; i++) {
        const row = displayRows[i];
        row.height = row.kind === 'section' ? SECTION_H : ITEM_H;
        row.top = top;
        top += row.height;
    }
    contentHeight = top;
    scrollY = clamp(scrollY, 0, maxScroll());
}

function summaryLine() {
    if (sweepRun) return statusText;
    if (!stats.shows) return statusText;
    let text = plural(stats.shows, 'show') + SEPARATOR + plural(stats.artists, 'artist');
    if (stats.filtered) text += SEPARATOR + stats.filtered + ' outside ' + (locationFilter || 'the filter');
    return text;
}

function on_size() {
    ww = window.Width;
    wh = window.Height;
    scrollY = clamp(scrollY, 0, maxScroll());
    syncHoverFromPointer(false);
}

function paintHeader(gr) {
    const card = headerCardRect();
    painter.card(gr, card, {
        fill: colours.card,
        border: true,
        stroke: colours.rule,
        accent: true,
        accentColour: colours.accent
    });

    const left = card.x + PAD;
    const width = Math.max(scaleUi(20), card.x + card.w - PAD - left);
    // Visible source credit: SeatGeek's terms require attribution wherever its
    // data is shown, and it doubles as the "which source is live" indicator.
    const creditText = 'Data by ' + currentSourceDef().label;
    let creditW = 0;
    try { creditW = Math.ceil(gr.CalcTextWidth(creditText, fonts.small)) + scaleUi(4); } catch (e) { creditW = scaleUi(110); }
    creditW = Math.min(creditW, Math.max(0, width - scaleUi(80)));
    if (creditW > 0) {
        drawText(gr, creditText, fonts.small, colours.muted,
            left + width - creditW, card.y + scaleUi(6), creditW, scaleUi(24),
            DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    }
    drawText(gr, 'Upcoming live shows', fonts.title, colours.accent,
        left, card.y + scaleUi(6), Math.max(scaleUi(20), width - creditW - scaleUi(10)), scaleUi(24),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, summaryLine(), fonts.normal, statusIsError ? colours.error : colours.muted,
        left, card.y + card.h - scaleUi(28), width, scaleUi(22),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function paintEmptyState(gr) {
    const cardW = Math.max(scaleUi(220), Math.min(ww - PAD * 2, scaleUi(520)));
    const cardH = scaleUi(92);
    const x = Math.round((ww - cardW) / 2);
    const y = HEADER_H + scaleUi(24);
    fillRoundRect(gr, x, y, cardW, cardH, scaleUi(8), colours.card);
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
    const countW = scaleUi(40);
    drawText(gr, row.label.toUpperCase(), fonts.smallBold, colours.accent,
        PAD, y, Math.max(scaleUi(40), ww - PAD * 2 - countW), row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, String(row.count), fonts.tiny, colours.muted,
        ww - PAD - countW, y, countW, row.height,
        DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function paintShowRow(gr, row, index, y) {
    const show = row.show;
    const cardX = PAD;
    const cardY = y + scaleUi(4);
    const cardW = Math.max(scaleUi(80), ww - PAD * 2 - scaleUi(3));
    const cardH = row.height - scaleUi(8);
    const dateW = ww < scaleUi(430) ? scaleUi(62) : scaleUi(74);
    const textX = cardX + scaleUi(14) + dateW;
    const timeW = show.time ? scaleUi(46) : 0;
    const textW = Math.max(scaleUi(30), cardW - dateW - timeW - scaleUi(38));
    // Both lines are derived from the card height so compact rows keep the
    // second line clear of the first instead of overlapping it.
    const inset = scaleUi(compactRows ? 3 : 6);
    const lineH = scaleUi(compactRows ? 18 : 22);
    const topY = cardY + inset;
    const bottomY = cardY + cardH - lineH - inset;

    fillRoundRect(gr, cardX, cardY, cardW, cardH, scaleUi(7), index === hoverRow ? colours.cardHover : colours.card);
    fillRoundRect(gr, cardX, cardY, scaleUi(4), cardH, scaleUi(2), colours.accent);

    drawText(gr, formatDayLabel(show.date), fonts.day, colours.accent,
        cardX + scaleUi(12), topY, dateW, lineH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    drawText(gr, weekdayLabel(show.date), fonts.tiny, colours.muted,
        cardX + scaleUi(12), bottomY, dateW, lineH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

    const nameOnly = sourceVerifiesMbid() && nameOnlyArtists.has(show.artistKey);
    const tagW = nameOnly ? scaleUi(74) : 0;
    drawText(gr, show.artist, fonts.bold, colours.text,
        textX, topY, Math.max(scaleUi(20), textW - tagW), lineH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    if (nameOnly) {
        drawText(gr, 'NAME MATCH', fonts.tiny, colours.muted,
            textX + textW - tagW, topY, tagW, lineH,
            DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
    drawText(gr, venueLine(show), fonts.small, colours.muted,
        textX, bottomY, textW, lineH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    if (show.time) {
        drawText(gr, show.time, fonts.smallBold, colours.muted,
            cardX + cardW - timeW - scaleUi(12), cardY, timeW, cardH,
            DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

function on_paint(gr) {
    libraryRebuildGate.runFromPaint();
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
        // Clipped below the header, so a partially scrolled row cannot reach it.
        gr.PushClip(0, HEADER_H, ww, Math.max(0, wh - HEADER_H));
        try {
            const first = rowIndexAtLocalY(scrollY);
            for (let i = Math.max(0, first); i < displayRows.length; i++) {
                const row = displayRows[i];
                const y = HEADER_H + row.top - scrollY;
                if (y > wh) break;
                if (row.kind === 'section') paintSectionRow(gr, row, y);
                else paintShowRow(gr, row, i, y);
            }
        } finally {
            gr.PopClip();
        }
    }

    if (contentHeight > viewportHeight()) {
        painter.scrollbar(gr, {
            x: Math.max(0, ww - scaleUi(4)),
            y: HEADER_H + scaleUi(8),
            height: Math.max(1, viewportHeight() - scaleUi(16)),
            contentHeight: contentHeight,
            viewportHeight: viewportHeight(),
            scroll: scrollY
        });
    }

    paintHeader(gr);

    if (smoothingChanged) {
        try { gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT); } catch (e) { }
    }
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
    if (x < 0 || x > ww || y < HEADER_H || y > wh) return -1;
    return rowIndexAtLocalY(y - HEADER_H + scrollY);
}

function isShowRow(row) {
    return !!row && row.kind === 'show';
}

function syncHoverFromPointer(repaint) {
    const index = pointerInside ? rowAt(pointerX, pointerY) : -1;
    const clickable = index >= 0 && isShowRow(displayRows[index]) && !!displayRows[index].show.url;
    const next = clickable ? index : -1;
    const changed = next !== hoverRow;

    hoverRow = next;
    window.SetCursor(clickable ? IDC_HAND : IDC_ARROW);

    if (changed && repaint !== false) window.Repaint();
    return changed;
}

function on_mouse_move(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;
    syncHoverFromPointer(true);
}

function on_mouse_leave() {
    const had = hoverRow !== -1;
    pointerInside = false;
    syncHoverFromPointer(false);
    if (had) window.Repaint();
}

function on_mouse_wheel(step) {
    if (!maxScroll()) return;
    scrollY = clamp(scrollY - step * ITEM_H * 2, 0, maxScroll());
    syncHoverFromPointer(false);
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;
    const index = rowAt(x, y);
    if (index < 0 || !isShowRow(displayRows[index])) return;
    const url = displayRows[index].show.url;
    if (url) utils.Run(url);
}

function on_mouse_rbtn_up(x, y) {
    const index = rowAt(x, y);
    const show = index >= 0 && isShowRow(displayRows[index]) ? displayRows[index].show : null;
    const menu = window.CreatePopupMenu();

    if (show) {
        menu.AppendMenuItem(show.url ? MF_STRING : MF_GRAYED, CMD_OPEN_EVENT, 'Open event page');
        menu.AppendMenuItem(show.tickets ? MF_STRING : MF_GRAYED, CMD_OPEN_TICKETS, 'Open tickets');
        menu.AppendMenuItem(MF_STRING, CMD_COPY, 'Copy show details');
        // No url in the descriptor: the event page already has its own item.
        menuState = RivageLibraryActions.append(menu, { type: 'artist', artist: show.artist });
        menu.AppendMenuSeparator();
    } else {
        menuState = null;
    }

    menu.AppendMenuItem(sweepRun ? MF_GRAYED : MF_STRING, CMD_REFRESH, 'Refresh stale artists');
    menu.AppendMenuItem(sweepRun ? MF_GRAYED : MF_STRING, CMD_REFRESH_ALL, 'Refresh everything');
    menu.AppendMenuItem(MF_STRING, CMD_CLEAR_CACHE, 'Clear all cached shows');
    menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, CMD_SETTINGS, RivageUI.copy.labels.panelConfiguration);
    menu.AppendMenuItem(MF_STRING, CMD_EDIT, RivageUI.copy.labels.editScript);

    const command = menu.TrackPopupMenu(x, y);
    if (!command) {
        menuState = null;
        return true;
    }

    if (menuState && RivageLibraryActions.handle(menuState, command)) {
        menuState = null;
        return true;
    }
    menuState = null;

    switch (command) {
        case CMD_OPEN_EVENT:
            if (show && show.url) utils.Run(show.url);
            break;
        case CMD_OPEN_TICKETS:
            if (show && show.tickets) utils.Run(show.tickets);
            break;
        case CMD_COPY:
            if (show) copyShow(show);
            break;
        case CMD_REFRESH:
            startSweep(false);
            break;
        case CMD_REFRESH_ALL:
            startSweep(true);
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

function copyShow(show) {
    const lines = [
        show.artist,
        show.date + (show.time ? ' ' + show.time : ''),
        venueLine(show)
    ];
    if (show.url) lines.push(show.url);
    try {
        utils.SetClipboardText(lines.join('\r\n'));
    } catch (e) {
        reportFailure('the show details could not be copied to the clipboard', e);
    }
}

function clearCache() {
    cache = emptyCache();
    cacheDirty = true;
    saveCacheFile(true);
    rebuildRows();
}

function describeLibraryDebug() {
    return libraryDebug.state + '; ' + plural(libraryDebug.trackCount, 'track') + '; ' +
        plural(libraryDebug.artists, 'artist') + '; ' +
        plural(eligibleArtists().length, 'artist') + ' above the track minimum' +
        (libraryDebug.error ? '; ' + libraryDebug.error : '');
}

function describeCacheDebug() {
    return cacheDebug.state + '; ' + plural(cacheDebug.artists, 'artist entry', 'artist entries') + '; ' +
        plural(cacheDebug.shows, 'show') +
        (sourceVerifiesMbid() ? '; ' + stats.unverified + ' matched by name only' : '; name matching only on this source') +
        '; saved ' + debugDateTime(cacheDebug.savedAt) +
        (cacheDebug.error ? '; ' + cacheDebug.error : '');
}

function describeSweepDebug() {
    if (!sweepRun) return 'idle';
    return 'artist ' + (sweepRun.index + 1) + ' / ' + sweepRun.artists.length +
        '; ' + sweepRun.fetched + ' fetched; ' + sweepRun.reused + ' from cache; ' + sweepRun.failed + ' failed';
}

function describeNetworkDebug() {
    return networkDebug.state + (networkDebug.kind ? ' (' + networkDebug.kind + ')' : '') +
        '; ' + debugDateTime(networkDebug.at) +
        (networkDebug.httpStatus ? '; HTTP ' + networkDebug.httpStatus : '') +
        (networkDebug.detail ? '; ' + networkDebug.detail : '');
}

function getLiveShowsSettings() {
    return [
        {
            id: 'source', label: 'Show source', type: 'choice', value: source,
            section: 'Options', choiceValueType: 'string',
            choices: [
                { value: 'ticketmaster', label: 'Ticketmaster' },
                { value: 'seatgeek', label: 'SeatGeek' }
            ],
            hint: 'Each source keeps its own cache, so switching back is free. Only Ticketmaster can confirm an artist by MusicBrainz ID.'
        },
        {
            id: 'ticketmasterApiKey', label: 'Ticketmaster API key', type: 'string', value: ticketmasterApiKey,
            section: 'Options',
            hint: 'The consumer key from a Ticketmaster developer app. 5000 calls a day.'
        },
        {
            id: 'seatgeekClientId', label: 'SeatGeek client ID', type: 'string', value: seatgeekClientId,
            section: 'Options',
            hint: 'The client ID from a SeatGeek developer app. Their terms ask that the SeatGeek credit stay visible.'
        },
        {
            id: 'locationFilter', label: 'Only these places', type: 'string', value: locationFilter,
            section: 'Options',
            hint: 'A comma narrows a place, a semicolon starts another: "California, United States; Paris". Empty shows everywhere.'
        },
        {
            id: 'horizonDays', label: 'How far ahead', type: 'choice', value: horizonDays,
            section: 'Options', choiceValueType: 'number',
            choices: [
                { value: 90, label: 'Next 3 months' },
                { value: 180, label: 'Next 6 months' },
                { value: 365, label: 'Next year' },
                { value: 730, label: 'Next 2 years' }
            ]
        },
        {
            id: 'minimumTracks', label: 'Minimum tracks per artist', type: 'number', value: minimumTracks,
            min: 1, max: 50, step: 1, section: 'Options',
            hint: 'Skips artists you own only a stray track by. One request per artist, so this is the main cost control.'
        },
        {
            id: 'requireMbidMatch', label: 'Only artists verified by MusicBrainz ID', type: 'bool', value: requireMbidMatch,
            section: 'Options', disabled: !sourceVerifiesMbid(),
            hint: sourceVerifiesMbid()
                ? 'Stricter: drops any artist Ticketmaster cannot confirm against your tagged MusicBrainz IDs.'
                : 'Not available on SeatGeek, which publishes no MusicBrainz IDs; its matches are by name alone.'
        },
        {
            id: 'cacheDays', label: 'Cache duration (days)', type: 'number', value: cacheDays,
            min: 1, max: 60, step: 1, section: 'Options',
            hint: 'Artists with nothing booked are re-checked half as often. Default 7 days.'
        },
        { id: 'compactRows', label: 'Use compact rows', type: 'bool', value: compactRows, section: 'Options' },
        {
            id: 'accentMode', label: 'Accent colour', type: 'choice', value: accentMode,
            section: 'Options', choiceValueType: 'string',
            choices: [
                { value: 'shared', label: RivageUI.copy.labels.sharedAccent },
                { value: 'fixed', label: RivageUI.copy.labels.rvgBlue },
                { value: 'host', label: RivageUI.copy.labels.foobar2000Accent }
            ]
        },
        { id: 'refreshNow', label: 'Refresh everything now', type: 'action', actionLabel: 'Refresh', section: 'Options' },

        { id: 'debugVersion', label: 'Panel version', type: 'info', value: PANEL_VERSION, section: 'Diagnostics' },
        { id: 'debugStatus', label: 'Current panel status', type: 'info', value: statusText + (statusIsError ? ' [error]' : ''), section: 'Diagnostics' },
        { id: 'debugLibrary', label: 'Library index', type: 'info', value: describeLibraryDebug(), section: 'Diagnostics' },
        { id: 'debugSweep', label: 'Refresh progress', type: 'info', value: describeSweepDebug(), section: 'Diagnostics' },
        { id: 'debugCache', label: 'Show cache', type: 'info', value: describeCacheDebug(), section: 'Diagnostics' },
        { id: 'debugNetwork', label: 'Network', type: 'info', value: describeNetworkDebug(), section: 'Diagnostics' },
        { id: 'debugCachePath', label: 'Cache location', type: 'info', value: CACHE_DIR, section: 'Diagnostics' }
    ];
}

function applyLiveShowsSetting(settingId, value) {
    let next;

    switch (settingId) {
        case 'source':
            next = normalizeSource(value);
            if (next === source) return;
            window.SetProperty(PROP + 'Source', next);
            source = next;
            startSweep(false);
            return;
        case 'ticketmasterApiKey':
            next = cleanSpaces(value);
            if (next === ticketmasterApiKey) return;
            window.SetProperty(PROP + 'Ticketmaster API key', next);
            ticketmasterApiKey = next;
            if (source === 'ticketmaster') startSweep(false);
            return;
        case 'seatgeekClientId':
            next = cleanSpaces(value);
            if (next === seatgeekClientId) return;
            window.SetProperty(PROP + 'SeatGeek client ID', next);
            seatgeekClientId = next;
            if (source === 'seatgeek') startSweep(false);
            return;
        case 'locationFilter':
            next = cleanSpaces(value);
            if (next === locationFilter) return;
            window.SetProperty(PROP + 'Location filter', next);
            locationFilter = next;
            rebuildLocationTokens();
            rebuildRows();
            return;
        case 'horizonDays':
            next = normalizeHorizon(value);
            if (next === horizonDays) return;
            window.SetProperty(PROP + 'Horizon days', next);
            horizonDays = next;
            rebuildRows();
            return;
        case 'minimumTracks':
            next = clamp(Math.round(Number(value) || 1), 1, 50);
            if (next === minimumTracks) return;
            window.SetProperty(PROP + 'Minimum tracks', next);
            minimumTracks = next;
            startSweep(false);
            return;
        case 'requireMbidMatch':
            next = !!value;
            if (next === requireMbidMatch) return;
            window.SetProperty(PROP + 'Require MBID match', next);
            requireMbidMatch = next;
            startSweep(true);
            return;
        case 'cacheDays':
            next = clamp(Math.round(Number(value) || 1), 1, 60);
            if (next === cacheDays) return;
            window.SetProperty(PROP + 'Cache days', next);
            cacheDays = next;
            return;
        case 'compactRows':
            next = !!value;
            if (next === compactRows) return;
            window.SetProperty(PROP + 'Compact rows', next);
            compactRows = next;
            updateTheme(true);
            window.Repaint(true);
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
        case 'refreshNow':
            startSweep(true);
            return;
    }
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        updateTheme();
        SharedThemeProtocol.requestRepaint();
    })) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getLiveShowsSettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyLiveShowsSetting)) return;

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

function on_colours_changed() {
    updateTheme();
    window.Repaint();
}

function on_font_changed() {
    RivageUI.clearFontCache();
    updateTheme(true);
    window.Repaint();
}

function on_library_items_added() {
    requestLibraryRebuild('added');
}

function on_library_items_changed() {
    requestLibraryRebuild('changed');
}

function on_library_items_removed() {
    requestLibraryRebuild('removed');
}

function runInitialContentLoad() {
    if (!initialLoadPending || !scriptActive) return;
    if (!VisiblePaintWork.isVisible()) return;
    initialLoadPending = false;
    requestLibraryRebuild('initial');
}

function on_script_unload() {
    scriptActive = false;
    initialLoadPending = false;
    generation++;
    clearTimer(initTimer);
    clearTimer(requestTimer);
    initTimer = 0;
    requestTimer = 0;
    requestQueue = [];
    requestContexts.clear();
    sweepRun = null;
    saveCacheFile(true);
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
