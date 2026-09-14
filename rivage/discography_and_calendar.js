'use strict';

window.DrawMode = 0;

// Shared RVG services: album-art accent consumer + settings registry.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\track_context.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\library_resolver_v2.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\library_actions_v2.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\visible_paint_work.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

const PANEL_VERSION = '3.1.2';

window.DefineScript(RivageUI.copy.popupTitle('Discography'), {
    author: 'RivaGe',
    version: PANEL_VERSION
});

// Narrow failure reporting. Most empty catches in this file guard drawing
// calls, host reads, and best-effort legacy-property mirrors that are
// expected to fail and stay silent on purpose. This is for the few that
// mean something is actually broken and would otherwise leave no trace.
// Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Discography] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// -----------------------------------------------------------------------------
// Constants and persistent settings
// -----------------------------------------------------------------------------

const PROP = 'Discography Checker.';
const API_ROOT = 'https://musicbrainz.org/ws/2';
const SITE_ROOT = 'https://musicbrainz.org';
const CACHE_DIR = fb.ProfilePath + 'jsplitter_discography_cache\\';
// v2 stored whole raw search responses in this file; v3 stores slim rows keyed
// by artist bucket. The old path is only opened to reclaim its space.
const CALENDAR_LEGACY_CACHE_FILE = CACHE_DIR + 'upcoming_calendar.json';
const CALENDAR_CACHE_FILE = CACHE_DIR + 'upcoming_calendar_v3.json';
const CALENDAR_CACHE_VERSION = 3;

const PAGE_SIZE = 100;
const REQUEST_INTERVAL_MS = 1250;
const MAX_TRANSIENT_RETRIES = 5;
const RETRY_BASE_503_MS = 3000;
const RETRY_BASE_OTHER_MS = 2000;
const RETRY_MAX_DELAY_MS = 60000;
const RETRY_JITTER_MS = 1000;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30000;
const MAX_RELEASE_GROUPS = 1000;
// Per-bucket safety cap (10 pages). Artist-scoped queries return tens of rows;
// this only bounds a name-fallback group that matched something very common.
const MAX_CALENDAR_SEARCH_RESULTS = 1000;
// The calendar query span is anchored to the first of the current month and
// always covers the widest selectable horizon, so the cache key turns over
// monthly instead of daily and a horizon change never touches the network.
const CALENDAR_QUERY_MONTHS = 25;
// Per-bucket budget measured on the PERCENT-ENCODED query, not the raw text:
// a non-ASCII artist name costs up to 9 bytes per character once encoded, so a
// raw-character budget would produce URLs several times over the server limit.
const CALENDAR_QUERY_BUDGET_CHARS = 4000;
const CALENDAR_CACHE_WRITE_INTERVAL_MS = 8000;
const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
const MUSICBRAINZ_USER_AGENT = 'foobar2000-JSplitter-Discography/' + PANEL_VERSION + ' (https://github.com/dima-lur/jsplitter)';

const MF_STRING = 0x00000000;
const MF_GRAYED = 0x00000001;
const IDC_ARROW = 32512;
const IDC_HAND = 32649;

const DT_LEFT = 0x00000000;
const DT_CENTER = 0x00000001;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const DT_END_ELLIPSIS = 0x00008000;

const SMOOTHING_MODE_DEFAULT = 0;
const SMOOTHING_MODE_ANTIALIAS = 4;
const DEFAULT_UWP_ACCENT = 0xff0078d4;
const SETTINGS_PANEL_ID = 'discography';
const SETTINGS_PANEL_LABEL = 'Discography';


// These are recalculated from the host font and the selected density.
let uiScale = 1;
let HEADER_H = 96;
let HEADER_GAP = 8;
let SECTION_H = 34;
let ITEM_H = 68;
let RELEASE_SECTION_H = 28;
let RELEASE_ITEM_H = 28;
let PAD = 14;
let MODE_BUTTON_W = 276;
let MODE_BUTTON_H = 32;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Keep panel-rendered separators ASCII-only. Some JSplitter/GDI setups
// misdecode non-ASCII punctuation and display an extra capital A.
const TYPE_SEPARATOR = ' / ';
const SUMMARY_SEPARATOR = ' | ';

// Complete MusicBrainz release-group primary type list.
const PRIMARY_TYPE_DEFS = [
    { key: 'album', label: 'Album', value: 'Album' },
    { key: 'single', label: 'Single', value: 'Single' },
    { key: 'ep', label: 'EP', value: 'EP' },
    { key: 'broadcast', label: 'Broadcast', value: 'Broadcast' },
    { key: 'other', label: 'Other', value: 'Other' }
];

// Complete MusicBrainz release-group secondary type list. The final
// fallback keeps the panel usable if MusicBrainz adds another type later.
const SECONDARY_TYPE_DEFS = [
    { key: 'none', label: 'Standard release (no secondary type)', value: '' },
    { key: 'compilation', label: 'Compilation', value: 'Compilation' },
    { key: 'soundtrack', label: 'Soundtrack', value: 'Soundtrack' },
    { key: 'spokenword', label: 'Spoken word', value: 'Spokenword' },
    { key: 'interview', label: 'Interview', value: 'Interview' },
    { key: 'audiobook', label: 'Audiobook', value: 'Audiobook' },
    { key: 'audio_drama', label: 'Audio drama', value: 'Audio drama' },
    { key: 'live', label: 'Live', value: 'Live' },
    { key: 'remix', label: 'Remix', value: 'Remix' },
    { key: 'dj_mix', label: 'DJ mix', value: 'DJ-mix' },
    { key: 'mixtape_street', label: 'Mixtape or street release', value: 'Mixtape/Street' },
    { key: 'demo', label: 'Demo', value: 'Demo' },
    { key: 'field_recording', label: 'Field recording', value: 'Field recording' },
    { key: 'other', label: 'Other or unknown secondary type', value: '*' }
];

let releaseTypeFilters = loadReleaseTypeFilters();
const DEFAULT_CACHE_DAYS = 30;
let storedCacheDays = Number(window.GetProperty(PROP + 'Cache days', 0));
// v3 raised the default from the pre-v2 24 h migration to 30 d. Applied once so
// profiles carrying the old 1-day value pick it up; a deliberate choice above
// 1 d is left alone, and the setting stays editable either way.
if (!window.GetProperty(PROP + 'Cache days v3 default applied', false)) {
    window.SetProperty(PROP + 'Cache days v3 default applied', true);
    if (!(storedCacheDays > 1)) storedCacheDays = DEFAULT_CACHE_DAYS;
}
let cacheDays = Math.max(1, Math.min(30, storedCacheDays > 0 ? Math.round(storedCacheDays) : DEFAULT_CACHE_DAYS));
window.SetProperty(PROP + 'Cache days', cacheDays);
let calendarHorizonDays = normalizeHorizon(Number(window.GetProperty(PROP + 'Calendar horizon days', 365)) || 365);
let calendarIncludeUntaggedArtists = !!window.GetProperty(PROP + 'Calendar name fallback', true);
let viewMode = normalizeViewMode(window.GetProperty(PROP + 'View mode', 'artist'));
let accentMode = normalizeAccentMode(window.GetProperty(PROP + 'Accent mode', 'shared'));
let compactRows = !!window.GetProperty(PROP + 'Compact rows', false);
let sharedAlbumAccent = DEFAULT_UWP_ACCENT;
let hostAccent = DEFAULT_UWP_ACCENT;

let artistOverrides = parseObjectProperty(PROP + 'Artist MBID overrides');
let artistResolutions = parseObjectProperty(PROP + 'Artist MBID resolutions');

const tfArtist = fb.TitleFormat('$if3(%album artist%,%artist%,)');
const tfArtistMbid = fb.TitleFormat('$if3($meta(musicbrainz_albumartistid,0),$meta(musicbrainz_artistid,0),$meta(musicbrainz album artist id,0),$meta(musicbrainz artist id,0),)');
const tfLibraryArtist = fb.TitleFormat('$if3(%album artist%,%artist%,)');
const tfLibraryAlbum = fb.TitleFormat('$if2(%album%,)');
const tfLibraryRgid = fb.TitleFormat('$if3($meta(musicbrainz_releasegroupid,0),$meta(musicbrainz release group id,0),)');
const tfLibraryArtistMbids = fb.TitleFormat('$if3($meta_sep(musicbrainz_albumartistid,|),$meta_sep(musicbrainz_artistid,|),$meta_sep(musicbrainz album artist id,|),$meta_sep(musicbrainz artist id,|),)');

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let ww = 0;
let wh = 0;
let colours = {};
let fonts = {};

// Shared card-drawing primitive, matching the floating-card header style used
// by playback-timeline_panel.js and playback_history_panel.js. `colours` is
// mutated in place by updateTheme(), never reassigned, so this reference
// stays live without needing setTheme() on every change - it's still called
// there for consistency with the rest of the suite.
const painter = RivageUI.createPainter({ scale: scaleUi, theme: colours });
let fontLayoutKey = '';

let sourceArtist = '';
let sourceArtistKey = '';
let artistMbid = '';
let resolvedArtistName = '';
let resolvedArtistComment = '';
let rawReleaseGroups = [];
let albumItems = [];
let artistStats = { total: 0, present: 0, missing: 0, upcoming: 0 };

let calendarRawReleaseGroups = [];
let calendarItems = [];
let calendarStats = {
    total: 0,
    present: 0,
    missing: 0,
    matchedArtists: 0,
    searched: 0
};
let calendarCache = null;
let calendarBuckets = [];
let calendarCacheDirty = false;
let calendarCacheWrittenAt = 0;

let displayRows = [];
let statusText = 'Choose or play a track.';
let statusIsError = false;

let scrollY = 0;
let contentHeight = 0;
let hoverRow = -1;
let hoverModeTab = '';
let pressedModeTab = '';
let pointerX = -1;
let pointerY = -1;
let pointerInside = false;

let libraryRgids = new Set();
let libraryAlbumArtistsByTitle = new Map();
let libraryAlbumEntryCount = 0;
let libraryArtistMbids = new Set();
let libraryArtistNameKeys = new Set();
let libraryArtistNameByKey = new Map();
let libraryArtistNameByMbid = new Map();
let libraryReady = false;
let libraryIndexDebug = {
    state: 'not built', at: 0, trackCount: 0, enrichedMbids: 0, error: ''
};
let libraryTimer = 0;
let libraryTimerGeneration = 0;
let libraryRetryTimer = 0;
let libraryRetryAttempt = 0;
let libraryRetryGeneration = 0;
const MAX_LIBRARY_RETRIES = 1;
const LIBRARY_RETRY_DELAY_MS = 1500;

let generation = 0;
let activeFetch = null;
let calendarRun = null;
let requestContexts = new Map();
let requestQueue = [];
let requestTimer = 0;
let lastRequestAt = 0;
let mbBlockedUntil = 0;
let consecutiveTransientErrors = 0;
let retryAttempt = 0;
let retryAt = 0;
let lastSuccessfulRequestAt = 0;
let lastTransientStatus = 0;
let scriptActive = true;
let initTimer = 0;
let initialLoadPending = true;

// Read-only diagnostics exposed through SETTINGS > Discography > Diagnostics.
// Keep these as plain serialisable objects: the settings registry deep-copies
// schemas via JSON before the settings panel renders them.
let artistCacheDebug = {
    state: 'not checked', path: '', checkedAt: 0, savedAt: 0,
    releaseGroups: 0, error: ''
};
let calendarCacheDebug = {
    state: 'not checked', path: CALENDAR_CACHE_FILE, checkedAt: 0, savedAt: 0,
    buckets: 0, staleBuckets: 0, failedBuckets: 0, releaseGroups: 0, error: ''
};
let artistPipelineDebug = {
    raw: 0, invalid: 0, duplicate: 0, typeRejected: 0,
    displayed: 0, filtersApplied: true
};
let calendarPipelineDebug = {
    raw: 0, invalid: 0, duplicate: 0, typeRejected: 0, dateRejected: 0,
    artistRejected: 0, variousArtistsRejected: 0,
    matchedByMbid: 0, matchedByName: 0, displayed: 0
};
let lastNetworkDebug = {
    state: 'idle', kind: '', at: 0, httpStatus: 0, detail: ''
};

// -----------------------------------------------------------------------------
// General helpers
// -----------------------------------------------------------------------------

function parseObjectProperty(name) {
    const raw = String(window.GetProperty(name, '{}'));
    try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) {
        return {};
    }
}

function saveObjectProperty(name, value) {
    window.SetProperty(name, JSON.stringify(value));
}

function persistObjectEntry(name, source, key, value) {
    const next = Object.assign({}, source);
    if (value === undefined) delete next[key];
    else next[key] = value;
    saveObjectProperty(name, next);
    return next;
}

function resetArtistPipelineDebug(filtersApplied) {
    artistPipelineDebug = {
        raw: 0, invalid: 0, duplicate: 0, typeRejected: 0,
        displayed: 0, filtersApplied: filtersApplied !== false
    };
}

function resetCalendarPipelineDebug() {
    calendarPipelineDebug = {
        raw: 0, invalid: 0, duplicate: 0, typeRejected: 0, dateRejected: 0,
        artistRejected: 0, variousArtistsRejected: 0,
        matchedByMbid: 0, matchedByName: 0, displayed: 0
    };
}

function debugDateTime(value) {
    const time = Number(value || 0);
    if (!(time > 0)) return 'never';
    const d = new Date(time);
    function two(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
        ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

function debugDuration(ms) {
    const value = Math.max(0, Number(ms || 0));
    const minutes = Math.floor(value / 60000);
    if (minutes < 1) return '<1 min';
    if (minutes < 60) return minutes + ' min';
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + ' h ' + (minutes % 60) + ' min';
    const days = Math.floor(hours / 24);
    return days + ' d ' + (hours % 24) + ' h';
}

function debugSnippet(value, maxLength) {
    const max = Math.max(40, Number(maxLength || 220));
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

function setNetworkDebug(state, kind, detail, httpStatus) {
    lastNetworkDebug = {
        state: String(state || 'idle'),
        kind: String(kind || ''),
        at: Date.now(),
        httpStatus: Number(httpStatus || 0),
        detail: debugSnippet(detail, 240)
    };
}

function defaultReleaseTypeFilters() {
    const primary = {};
    const secondary = {};

    for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
        primary[PRIMARY_TYPE_DEFS[i].key] = PRIMARY_TYPE_DEFS[i].key === 'album';
    }
    primary.ep = !!window.GetProperty(PROP + 'Include EPs', false);

    for (let i = 0; i < SECONDARY_TYPE_DEFS.length; i++) {
        secondary[SECONDARY_TYPE_DEFS[i].key] = true;
    }
    secondary.compilation = !!window.GetProperty(PROP + 'Include compilations', true);

    return { primary: primary, secondary: secondary };
}

function loadReleaseTypeFilters() {
    const defaults = defaultReleaseTypeFilters();
    const saved = parseObjectProperty(PROP + 'Release type filters');
    const result = { primary: {}, secondary: {} };

    for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
        const key = PRIMARY_TYPE_DEFS[i].key;
        result.primary[key] = saved.primary && typeof saved.primary[key] === 'boolean'
            ? saved.primary[key]
            : defaults.primary[key];
    }

    for (let i = 0; i < SECONDARY_TYPE_DEFS.length; i++) {
        const key = SECONDARY_TYPE_DEFS[i].key;
        result.secondary[key] = saved.secondary && typeof saved.secondary[key] === 'boolean'
            ? saved.secondary[key]
            : defaults.secondary[key];
    }

    return result;
}

function cloneReleaseTypeFilters(filters) {
    return {
        primary: Object.assign({}, filters.primary),
        secondary: Object.assign({}, filters.secondary)
    };
}

function saveReleaseTypeFilters(filters) {
    saveObjectProperty(PROP + 'Release type filters', filters);

    // Legacy mirrors are migration aids; a failed mirror must not roll back the canonical write.
    try { window.SetProperty(PROP + 'Include EPs', !!filters.primary.ep); } catch (e) { }
    try { window.SetProperty(PROP + 'Include compilations', !!filters.secondary.compilation); } catch (e2) { }
}

function selectedPrimaryTypeValues() {
    const values = [];
    for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
        const def = PRIMARY_TYPE_DEFS[i];
        if (releaseTypeFilters.primary[def.key]) values.push(def.value);
    }
    return values;
}

function normalizeAccentMode(value) {
    const text = String(value || '').toLowerCase();
    return text === 'fixed' || text === 'host' ? text : 'shared';
}

// View mode is one of 'artist' (Catch Up tab, unchanged), 'discography'
// (RELEASES tab: complete compact list grouped by type) or 'calendar'.
// The internal value 'discography' is retained for backward compatibility
// even though the visible tab label is now RELEASES.
function normalizeViewMode(value) {
    const text = String(value || '').toLowerCase();
    if (text === 'calendar' || text === 'discography') return text;
    return 'artist';
}

// True for the two view modes that track a single artist identity (Catch Up
// and RELEASES), as opposed to Calendar which tracks the whole library.
function isArtistLikeMode(mode) {
    return mode === 'artist' || mode === 'discography';
}

function scaleUi(value) {
    return Math.max(1, Math.round(Number(value || 0) * uiScale));
}

function normalizeHorizon(value) {
    if (value <= 180) return 180;
    if (value >= 730) return 730;
    return 365;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function extractUuid(value) {
    const match = String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    return match ? match[0].toLowerCase() : '';
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

function cleanSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

function normalizeAlbum(value) {
    let s = String(value || '');
    s = s.replace(/\s*[\(\[\{][^\)\]\}]*\b(?:deluxe|expanded|remaster(?:ed)?|anniversary|edition|bonus|reissue|mono|stereo|version)\b[^\)\]\}]*[\)\]\}]/gi, ' ');
    s = s.replace(/\b(?:cd|disc|disk)\s*\d+\b/gi, ' ');
    return normalizeBasic(s);
}

function artistNamesMatch(a, b) {
    const aa = normalizeArtist(a);
    const bb = normalizeArtist(b);
    if (!aa || !bb) return false;
    if (aa === bb) return true;

    const pa = ' ' + aa + ' ';
    const pb = ' ' + bb + ' ';
    return pa.indexOf(pb) !== -1 || pb.indexOf(pa) !== -1;
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
    const values = [text];
    const split = text.split(/\s*;\s*/);
    if (split.length > 1) {
        for (let i = 0; i < split.length; i++) {
            const part = cleanSpaces(split[i]);
            if (part) values.push(part);
        }
    }
    return values;
}

function compareStrings(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function blend(c1, c2, ratio) {
    return RivageUI.mix(c1, c2, ratio);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

function getSourceHandle() {
    return TrackContext.getHandle();
}

function evalWithHandle(tfo, handle) {
    if (!handle) return '';
    try {
        return cleanSpaces(tfo.EvalWithMetadb(handle));
    } catch (e) {
        return '';
    }
}

function clearTimer(timerId) {
    if (timerId) window.ClearTimeout(timerId);
}

function dateToIsoLocal(date) {
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function startOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(date, months) {
    return new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), 0, 0, 0, 0);
}

function fnv1a(text) {
    let hash = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash >>> 0;
}

function cancelNetworkWork() {
    generation++;
    requestQueue = [];
    activeFetch = null;
    calendarRun = null;
    // Whatever the run already fetched is kept; a cancel must never cost pages.
    saveCalendarCacheFile(true);
    clearTimer(requestTimer);
    requestTimer = 0;
}

// -----------------------------------------------------------------------------
// Theme and drawing setup
// -----------------------------------------------------------------------------

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
    SECTION_H = scaleUi(34);
    ITEM_H = scaleUi(compactRows ? 56 : 68);
    RELEASE_SECTION_H = scaleUi(28);
    RELEASE_ITEM_H = scaleUi(28);
    MODE_BUTTON_W = scaleUi(276);
    MODE_BUTTON_H = scaleUi(32);
}

function updateTheme(forceFonts) {
    const host = RivageUI.hostInfo();
    const name = host && host.fontFamily ? String(host.fontFamily) : 'Segoe UI';
    const size = Math.max(9, host && Number(host.scaleFontSize) > 0 ? Number(host.scaleFontSize) : 12);
    const nextFontLayoutKey = name.toLowerCase() + '|' + size + '|' + (compactRows ? 'compact' : 'normal');
    const layoutChanged = !!forceFonts || nextFontLayoutKey !== fontLayoutKey;

    if (layoutChanged) updateLayoutMetrics(size);

    hostAccent = SharedAccentProtocol.opaque(host && host.accent !== undefined ? host.accent : DEFAULT_UWP_ACCENT);
    const requested = SharedAccentProtocol.opaque(requestedAccent());
    const resolved = RivageUI.createTheme({ mode: 'host', accent: requested });
    const dark = !!resolved.dark;
    const accent = SharedAccentProtocol.opaque(accentMode === 'shared' ? resolved.accent : requested);

    colours.background = resolved.background;
    colours.card = resolved.card;
    colours.cardHover = resolved.cardHover;
    colours.text = resolved.textPrimary;
    colours.muted = resolved.textMuted;
    colours.rule = resolved.separator;
    colours.control = resolved.surface;
    colours.accent = accent;
    colours.accentSoft = blend(colours.background, accent, dark ? 0.25 : 0.15);
    colours.accentMuted = blend(colours.muted, accent, 0.55);
    colours.section = colours.background;
    colours.hover = colours.cardHover;
    colours.button = colours.control;
    colours.buttonHover = colours.accentSoft;
    colours.present = resolved.success;
    colours.presentSoft = resolved.successSoft !== undefined ? resolved.successSoft : blend(colours.card, colours.present, dark ? 0.18 : 0.12);
    colours.missing = resolved.danger;
    colours.missingSoft = resolved.dangerSoft !== undefined ? resolved.dangerSoft : blend(colours.card, colours.missing, dark ? 0.16 : 0.10);
    colours.upcoming = accent;
    colours.error = colours.missing;
    colours.scrollTrack = resolved.scrollTrack;

    if (layoutChanged) {
        fonts.normal = RivageUI.font(name, size, 0);
        fonts.bold = RivageUI.font(name, size, 1);
        fonts.small = RivageUI.font(name, Math.max(8, size - 1), 0);
        fonts.smallBold = RivageUI.font(name, Math.max(8, size - 1), 1);
        fonts.tiny = RivageUI.font(name, Math.max(8, size - 2), 0);
        fonts.title = RivageUI.font(name, Math.max(14, size + 4), 1);
        fonts.pivot = RivageUI.font(name, Math.max(9, size - 1), 1);
        fontLayoutKey = nextFontLayoutKey;
        if (displayRows.length) reflowDisplayRows();
    }

    painter.setTheme(colours);
}

function drawText(gr, text, font, colour, x, y, w, h, flags) {
    if (w <= 0 || h <= 0) return;
    gr.GdiDrawText(String(text || ''), font, colour, Math.round(x), Math.round(y), Math.round(w), Math.round(h), flags);
}

function fillRoundRect(gr, x, y, w, h, radius, colour) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    // Callers scale width, height and radius independently, so rounding can
    // leave radius * 2 larger than the box; GDI+ then rejects the arc.
    var r = Math.min(Math.round(radius), Math.floor(w / 2), Math.floor(h / 2));
    if (typeof gr.FillRoundRect === 'function' && r >= 1) {
        gr.FillRoundRect(x, y, w, h, r, r, colour);
    } else {
        gr.FillSolidRect(x, y, w, h, colour);
    }
}

function headerCardRect() {
    const h = Math.max(scaleUi(20), HEADER_H - PAD - HEADER_GAP);
    return { x: PAD, y: PAD, w: Math.max(0, ww - PAD * 2), h: h };
}

function modeButtonRect() {
    const card = headerCardRect();
    return {
        x: Math.max(card.x + PAD, card.x + card.w - PAD - MODE_BUTTON_W),
        y: card.y + Math.round((card.h - MODE_BUTTON_H) / 2),
        w: MODE_BUTTON_W,
        h: MODE_BUTTON_H
    };
}

// Left-to-right tab order: Catch Up, RELEASES, Calendar.
const MODE_TAB_ORDER = ['artist', 'discography', 'calendar'];

function modeTabRect(mode) {
    const outer = modeButtonRect();
    const index = MODE_TAB_ORDER.indexOf(mode);
    if (index < 0) return { x: outer.x, y: outer.y, w: 0, h: outer.h };

    const third = Math.floor(outer.w / MODE_TAB_ORDER.length);
    const x = outer.x + third * index;
    // Last tab absorbs any rounding remainder so the group's right edge
    // still lines up exactly with modeButtonRect()'s outer.x + outer.w.
    const w = index === MODE_TAB_ORDER.length - 1 ? (outer.x + outer.w - x) : third;
    return { x: x, y: outer.y, w: w, h: outer.h };
}

function modeAt(x, y) {
    for (let i = 0; i < MODE_TAB_ORDER.length; i++) {
        if (pointInRect(x, y, modeTabRect(MODE_TAB_ORDER[i]))) return MODE_TAB_ORDER[i];
    }
    return '';
}

function pointInRect(x, y, rect) {
    return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

// -----------------------------------------------------------------------------
// Local library indexing and ownership matching
// -----------------------------------------------------------------------------

function addLibraryArtistName(value, nameKeys, nameByKey) {
    const variants = artistNameVariants(value);
    for (let i = 0; i < variants.length; i++) {
        const display = variants[i];
        if (isGenericArtistName(display)) continue;
        const key = normalizeArtist(display);
        if (!key) continue;
        nameKeys.add(key);
        if (!nameByKey.has(key)) nameByKey.set(key, display);
    }
}

function rebuildLibraryIndex() {
    libraryReady = false;
    libraryIndexDebug = { state: 'building', at: Date.now(), trackCount: 0, enrichedMbids: 0, error: '' };
    statusText = viewMode === 'calendar'
        ? 'Indexing artists in the foobar2000 library...'
        : (sourceArtist ? 'Indexing the foobar2000 library...' : statusText);
    statusIsError = false;
    window.Repaint();

    const rgids = new Set();
    const albumArtistsByTitle = new Map();
    const albumPairs = new Set();
    const artistMbids = new Set();
    const artistNameKeys = new Set();
    const artistNameByKey = new Map();
    const artistNameByMbid = new Map();

    let count = 0;
    let enrichedMbids = 0;
    try {
        const handles = fb.GetLibraryItems();
        const artists = tfLibraryArtist.EvalWithMetadbs(handles);
        const titles = tfLibraryAlbum.EvalWithMetadbs(handles);
        const releaseGroupIds = tfLibraryRgid.EvalWithMetadbs(handles);
        const artistMbidValues = tfLibraryArtistMbids.EvalWithMetadbs(handles);
        count = handles.Count;

        for (let i = 0; i < count; i++) {
            const artistDisplay = cleanSpaces(artists[i]);
            addLibraryArtistName(artistDisplay, artistNameKeys, artistNameByKey);

            const mbids = extractUuids(artistMbidValues[i]);
            for (let m = 0; m < mbids.length; m++) {
                // Never index the special MusicBrainz Various Artists identity.
                // Otherwise a compilation in the local library can make every
                // future Various Artists release appear in the calendar.
                if (mbids[m] === VARIOUS_ARTISTS_MBID) continue;
                artistMbids.add(mbids[m]);
                if (artistDisplay && !artistNameByMbid.has(mbids[m])) {
                    artistNameByMbid.set(mbids[m], artistDisplay);
                }
            }

            const rgid = extractUuid(releaseGroupIds[i]);
            if (rgid) rgids.add(rgid);

            // Match the WebView2 index more closely: associate an album with
            // each individual semicolon-separated artist, not only the entire
            // combined album-artist string.
            const titleKey = normalizeAlbum(titles[i]);
            if (titleKey) {
                const artistParts = String(artistDisplay || '').split(/\s*;\s*/).map(cleanSpaces).filter(Boolean);
                const usefulArtists = artistParts.filter(function (name) { return !isGenericArtistName(name); });
                const ownershipArtists = usefulArtists.length ? usefulArtists : artistParts;
                for (let a = 0; a < ownershipArtists.length; a++) {
                    const artistKey = normalizeArtist(ownershipArtists[a]);
                    if (!artistKey) continue;
                    const pairKey = artistKey + '\u0001' + titleKey;
                    if (!albumPairs.has(pairKey)) {
                        albumPairs.add(pairKey);
                        let artistsForTitle = albumArtistsByTitle.get(titleKey);
                        if (!artistsForTitle) {
                            artistsForTitle = [];
                            albumArtistsByTitle.set(titleKey, artistsForTitle);
                        }
                        artistsForTitle.push(artistKey);
                    }
                }
            }
        }

        // Saved resolutions are keyed by normalized individual artist names.
        // Apply them after all names have been indexed so collaborations such
        // as "Artist A; Artist B" enrich both individual artists correctly.
        // Manual overrides intentionally win over automatic resolutions.
        const savedIdentities = Object.assign({}, artistResolutions, artistOverrides);
        const savedKeys = Object.keys(savedIdentities);
        for (let i = 0; i < savedKeys.length; i++) {
            const artistKey = savedKeys[i];
            if (!artistNameKeys.has(artistKey)) continue;
            const saved = savedIdentities[artistKey];
            const savedMbid = extractUuid(typeof saved === 'string' ? saved : saved && saved.mbid);
            if (!savedMbid || savedMbid === VARIOUS_ARTISTS_MBID) continue;
            if (!artistMbids.has(savedMbid)) enrichedMbids++;
            artistMbids.add(savedMbid);
            if (!artistNameByMbid.has(savedMbid)) {
                artistNameByMbid.set(savedMbid, artistNameByKey.get(artistKey) || artistKey);
            }
        }
    } catch (e) {
        libraryIndexDebug = {
            state: 'failed', at: Date.now(), trackCount: count, enrichedMbids: 0,
            error: debugSnippet(e, 240)
        };
        statusText = 'Library index failed: ' + (e && e.message ? e.message : String(e));
        statusIsError = true;
        console.log('Discography Checker: library indexing failed: ' + e);
        window.Repaint();
        scheduleLibraryRetry();
        return false;
    }

    clearTimer(libraryRetryTimer);
    libraryRetryTimer = 0;
    libraryRetryAttempt = 0;
    libraryRetryGeneration++;
    libraryRgids = rgids;
    libraryAlbumArtistsByTitle = albumArtistsByTitle;
    libraryAlbumEntryCount = albumPairs.size;
    libraryArtistMbids = artistMbids;
    libraryArtistNameKeys = artistNameKeys;
    libraryArtistNameByKey = artistNameByKey;
    libraryArtistNameByMbid = artistNameByMbid;
    libraryReady = true;
    libraryIndexDebug = {
        state: 'ready', at: Date.now(), trackCount: count, enrichedMbids: enrichedMbids, error: ''
    };

    if (viewMode === 'calendar') {
        calendarLibraryChanged();
    } else if (rawReleaseGroups.length) {
        renderReleaseRows();
    } else {
        window.Repaint();
    }
    return true;
}

const libraryRebuildGate = VisiblePaintWork.create(function () {
    if (!scriptActive) return;
    rebuildLibraryIndex();
    runInitialContentLoad();
});

function requestLibraryRebuild(key, resetRetry) {
    if (!scriptActive) return;
    if (resetRetry) {
        clearTimer(libraryRetryTimer);
        libraryRetryTimer = 0;
        libraryRetryAttempt = 0;
        libraryRetryGeneration++;
    }
    libraryRebuildGate.request(key);
}

function scheduleLibraryRetry() {
    if (!scriptActive || libraryRetryAttempt >= MAX_LIBRARY_RETRIES || libraryRetryTimer) return;
    const attempt = ++libraryRetryAttempt;
    const token = ++libraryRetryGeneration;
    libraryRetryTimer = window.SetTimeout(function () {
        if (!scriptActive || token !== libraryRetryGeneration || attempt !== libraryRetryAttempt) return;
        libraryRetryTimer = 0;
        requestLibraryRebuild('retry:' + attempt, false);
    }, LIBRARY_RETRY_DELAY_MS);
}

function scheduleLibraryRebuild() {
    clearTimer(libraryTimer);
    const token = ++libraryTimerGeneration;
    libraryTimer = window.SetTimeout(function () {
        if (!scriptActive || token !== libraryTimerGeneration) return;
        libraryTimer = 0;
        requestLibraryRebuild('library:' + token, true);
    }, 900);
}

function findOwnedMatch(releaseGroup, artistCandidates) {
    const rgid = extractUuid(releaseGroup.id);
    if (rgid && libraryRgids.has(rgid)) {
        return { owned: true, method: 'MusicBrainz ID' };
    }

    const titleKey = normalizeAlbum(releaseGroup.title);
    if (!titleKey) return { owned: false, method: '' };

    const candidates = Array.isArray(artistCandidates) ? artistCandidates : [];
    const localArtists = libraryAlbumArtistsByTitle.get(titleKey) || [];
    for (let i = 0; i < localArtists.length; i++) {
        for (let j = 0; j < candidates.length; j++) {
            if (artistNamesMatch(localArtists[i], candidates[j])) {
                return { owned: true, method: 'artist/title' };
            }
        }
    }

    return { owned: false, method: '' };
}

// -----------------------------------------------------------------------------
// Release dates, filtering and display rows
// -----------------------------------------------------------------------------

function dateBounds(value) {
    const text = String(value || '').trim();
    let m = text.match(/^(\d{4})$/);
    if (m) {
        const year = Number(m[1]);
        return {
            precision: 'year',
            min: new Date(year, 0, 1, 0, 0, 0, 0),
            max: new Date(year, 11, 31, 23, 59, 59, 999)
        };
    }

    m = text.match(/^(\d{4})-(\d{2})$/);
    if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]);
        if (month < 1 || month > 12) return null;
        return {
            precision: 'month',
            min: new Date(year, month - 1, 1, 0, 0, 0, 0),
            max: new Date(year, month, 0, 23, 59, 59, 999)
        };
    }

    m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        const exact = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (exact.getFullYear() !== year || exact.getMonth() !== month - 1 || exact.getDate() !== day) return null;
        return {
            precision: 'day',
            min: exact,
            max: new Date(year, month - 1, day, 23, 59, 59, 999)
        };
    }

    return null;
}

function dateBucket(value) {
    const bounds = dateBounds(value);
    if (!bounds) return 'unknown';

    const todayStart = startOfToday();
    const todayEnd = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate(), 23, 59, 59, 999);

    if (bounds.min > todayEnd) return 'upcoming';
    if (bounds.max < todayStart) return 'past';
    return 'current';
}

function typeLabel(rg) {
    const secondary = Array.isArray(rg['secondary-types']) ? rg['secondary-types'].filter(Boolean) : [];
    const primary = rg['primary-type'] || 'Other';
    return secondary.length ? primary + TYPE_SEPARATOR + secondary.join(TYPE_SEPARATOR) : primary;
}

function primaryTypeKey(value) {
    const text = String(value || '').toLowerCase();
    for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
        if (PRIMARY_TYPE_DEFS[i].value.toLowerCase() === text) return PRIMARY_TYPE_DEFS[i].key;
    }
    return 'other';
}

function secondaryTypeKey(value) {
    const text = String(value || '').toLowerCase();
    for (let i = 0; i < SECONDARY_TYPE_DEFS.length; i++) {
        const def = SECONDARY_TYPE_DEFS[i];
        if (def.value && def.value !== '*' && def.value.toLowerCase() === text) return def.key;
    }
    return 'other';
}

function releaseAllowed(rg) {
    const primaryKey = primaryTypeKey(rg['primary-type']);
    if (!releaseTypeFilters.primary[primaryKey]) return false;

    const secondary = Array.isArray(rg['secondary-types'])
        ? rg['secondary-types'].filter(Boolean)
        : [];

    if (!secondary.length) return !!releaseTypeFilters.secondary.none;

    for (let i = 0; i < secondary.length; i++) {
        if (!releaseTypeFilters.secondary[secondaryTypeKey(secondary[i])]) return false;
    }

    return true;
}

function resetDisplayRows(rows) {
    displayRows = rows;
    let y = 0;
    for (let i = 0; i < displayRows.length; i++) {
        displayRows[i].top = y;
        y += displayRows[i].height;
    }
    contentHeight = y;
    scrollY = clamp(scrollY, 0, maxScroll());

    // Preserve the hover under a stationary pointer after metadata refreshes,
    // library rebuilds and row reflows. Resetting it unconditionally caused
    // the focused release to flash off until the mouse moved again.
    syncHoverFromPointer(false);
}

function displayRowHeight(row) {
    if (row.kind === 'section') {
        return row.itemKind === 'release' ? RELEASE_SECTION_H : SECTION_H;
    }
    return row.kind === 'release' ? RELEASE_ITEM_H : ITEM_H;
}

function reflowDisplayRows() {
    if (!displayRows.length) return;
    for (let i = 0; i < displayRows.length; i++) {
        displayRows[i].height = displayRowHeight(displayRows[i]);
    }
    resetDisplayRows(displayRows);
}

function addSectionTo(rows, label, items, kind) {
    if (!items.length) return;
    const sectionRow = {
        kind: 'section',
        itemKind: kind,
        label: label,
        count: items.length,
        height: 0,
        top: 0
    };
    sectionRow.height = displayRowHeight(sectionRow);
    rows.push(sectionRow);

    for (let i = 0; i < items.length; i++) {
        const itemRow = { kind: kind, item: items[i], height: 0, top: 0 };
        itemRow.height = displayRowHeight(itemRow);
        rows.push(itemRow);
    }
}

// Dedupe and enrich raw release groups with ownership, date-bucket and type
// information. Catch Up applies the configured release-type filters; the
// RELEASES tab deliberately bypasses them and displays the complete list.
function buildReleaseItems(applyTypeFilters) {
    const seen = new Set();
    const items = [];
    const useTypeFilters = applyTypeFilters !== false;
    const debug = {
        raw: rawReleaseGroups.length,
        invalid: 0,
        duplicate: 0,
        typeRejected: 0,
        displayed: 0,
        filtersApplied: useTypeFilters
    };

    for (let i = 0; i < rawReleaseGroups.length; i++) {
        const rg = rawReleaseGroups[i];
        const id = extractUuid(rg && rg.id);
        if (!rg || !id) {
            debug.invalid++;
            continue;
        }
        if (seen.has(id)) {
            debug.duplicate++;
            continue;
        }
        if (useTypeFilters && !releaseAllowed(rg)) {
            debug.typeRejected++;
            continue;
        }
        seen.add(id);

        const owned = findOwnedMatch(rg, [sourceArtist, resolvedArtistName]);
        const date = String(rg['first-release-date'] || '');
        items.push({
            id: id,
            title: cleanSpaces(rg.title) || '(untitled)',
            date: date,
            bucket: dateBucket(date),
            type: typeLabel(rg),
            owned: owned.owned,
            matchMethod: owned.method,
            url: SITE_ROOT + '/release-group/' + id
        });
    }

    debug.displayed = items.length;
    artistPipelineDebug = debug;

    return items;
}

// Recompute artistStats.* from the item list used by the active artist view.
function updateArtistStatsFrom(items) {
    artistStats.total = items.length;
    artistStats.present = items.filter(function (item) { return item.owned; }).length;
    artistStats.missing = artistStats.total - artistStats.present;
    artistStats.upcoming = items.filter(function (item) { return item.bucket === 'upcoming'; }).length;
}

// Shared status-line text for both artist-identity views once release items
// have been built and stats updated.
function releaseStatusText(typeFiltersApplied) {
    if (artistStats.total) {
        return resolvedArtistName && normalizeArtist(resolvedArtistName) !== normalizeArtist(sourceArtist)
            ? 'Matched to MusicBrainz artist: ' + resolvedArtistName + (resolvedArtistComment ? ' (' + resolvedArtistComment + ')' : '')
            : (resolvedArtistComment ? resolvedArtistComment : 'MusicBrainz release groups');
    } else if (rawReleaseGroups.length) {
        return typeFiltersApplied
            ? 'No release groups match the current album-type filters.'
            : 'No usable MusicBrainz release groups were found.';
    }
    return 'No MusicBrainz release groups were found.';
}

// Dispatches to whichever release-group processor matches the current
// artist-identity view mode (Catch Up or RELEASES). Calendar mode has
// its own independent refresh path and never calls this.
function renderReleaseRows() {
    if (viewMode === 'discography') {
        processDiscographyReleaseGroups();
    } else {
        processReleaseGroups();
    }
}

function processReleaseGroups() {
    if (viewMode !== 'artist') return;

    const items = buildReleaseItems(true);

    const upcoming = items.filter(function (item) { return item.bucket === 'upcoming'; });
    const past = items.filter(function (item) { return item.bucket === 'past'; });
    const current = items.filter(function (item) { return item.bucket === 'current'; });
    const unknown = items.filter(function (item) { return item.bucket === 'unknown'; });

    upcoming.sort(function (a, b) {
        return compareStrings(a.date, b.date) || compareStrings(a.title, b.title);
    });
    past.sort(function (a, b) {
        return compareStrings(b.date, a.date) || compareStrings(a.title, b.title);
    });
    current.sort(function (a, b) {
        return compareStrings(a.date, b.date) || compareStrings(a.title, b.title);
    });
    unknown.sort(function (a, b) { return compareStrings(a.title, b.title); });

    albumItems = upcoming.concat(current, past, unknown);
    updateArtistStatsFrom(albumItems);

    const rows = [];
    addSectionTo(rows, 'Upcoming', upcoming, 'album');
    addSectionTo(rows, 'Released', past, 'album');
    addSectionTo(rows, 'Current date', current, 'album');
    addSectionTo(rows, 'Date unknown', unknown, 'album');
    resetDisplayRows(rows);

    statusText = releaseStatusText(true);
    statusIsError = false;

    window.Repaint();
}

// RELEASES view: same artist identity as Catch Up, but always uses the full
// MusicBrainz release-group set, independent of the configured type filters.
// Sections follow release-group type order; items are sorted newest-first by
// first release date and rendered as compact date/title-only rows.
function processDiscographyReleaseGroups() {
    if (viewMode !== 'discography') return;

    const items = buildReleaseItems(false);
    albumItems = items;
    updateArtistStatsFrom(items);

    const groups = new Map();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const label = item.type || 'Other';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(item);
    }

    function primaryOrderIndex(label) {
        const prefix = String(label || '').split(TYPE_SEPARATOR)[0];
        for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
            if (PRIMARY_TYPE_DEFS[i].value === prefix) return i;
        }
        return PRIMARY_TYPE_DEFS.length;
    }

    const sections = Array.from(groups.keys()).sort(function (a, b) {
        return (primaryOrderIndex(a) - primaryOrderIndex(b)) || compareStrings(a, b);
    });

    const rows = [];
    for (let i = 0; i < sections.length; i++) {
        const label = sections[i];
        const groupItems = groups.get(label);
        groupItems.sort(function (a, b) {
            return compareStrings(b.date, a.date) || compareStrings(a.title, b.title);
        });
        addSectionTo(rows, label, groupItems, 'release');
    }
    resetDisplayRows(rows);

    statusText = releaseStatusText(false);
    statusIsError = false;

    window.Repaint();
}

function artistCreditInfo(rg) {
    const credits = Array.isArray(rg && rg['artist-credit']) ? rg['artist-credit'] : [];
    const names = [];
    const ids = [];
    let phrase = '';
    let variousArtists = false;

    for (let i = 0; i < credits.length; i++) {
        const credit = credits[i] || {};
        const artist = credit.artist || {};
        const creditName = cleanSpaces(credit.name || artist.name);
        const canonicalName = cleanSpaces(artist.name);
        const id = extractUuid(artist.id);

        if (id === VARIOUS_ARTISTS_MBID || isVariousArtistsName(creditName) || isVariousArtistsName(canonicalName)) {
            variousArtists = true;
        }

        if (creditName) names.push(creditName);
        if (canonicalName && normalizeArtist(canonicalName) !== normalizeArtist(creditName)) names.push(canonicalName);
        if (id) ids.push(id);

        if (creditName) phrase += creditName;
        phrase += String(credit.joinphrase || '');
    }

    if (!phrase) phrase = cleanSpaces(rg && rg['artist-credit-phrase']);
    if (isVariousArtistsName(phrase)) variousArtists = true;
    return {
        names: names,
        ids: ids,
        phrase: phrase || '(unknown artist)',
        variousArtists: variousArtists
    };
}

function matchReleaseToLibraryArtist(rg) {
    const credit = artistCreditInfo(rg);

    // Exclude release groups credited to the MusicBrainz special-purpose
    // Various Artists identity, even if that identity exists in local tags.
    if (credit.variousArtists) {
        return { matched: false, method: '', token: '', artistMbid: '', libraryName: '', credit: credit };
    }

    for (let i = 0; i < credit.ids.length; i++) {
        const id = credit.ids[i];
        if (libraryArtistMbids.has(id)) {
            return {
                matched: true,
                method: 'artist MBID',
                token: 'id:' + id,
                artistMbid: id,
                libraryName: libraryArtistNameByMbid.get(id) || credit.phrase,
                credit: credit
            };
        }
    }

    for (let i = 0; i < credit.names.length; i++) {
        const key = normalizeArtist(credit.names[i]);
        if (key && libraryArtistNameKeys.has(key)) {
            return {
                matched: true,
                method: 'artist name',
                token: 'name:' + key,
                artistMbid: '',
                libraryName: libraryArtistNameByKey.get(key) || credit.names[i],
                credit: credit
            };
        }
    }

    return { matched: false, method: '', token: '', artistMbid: '', libraryName: '', credit: credit };
}

function calendarDateWindow() {
    const today = startOfToday();
    const end = addDays(today, calendarHorizonDays);
    return {
        today: today,
        end: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
    };
}

function calendarDateInfo(value, windowBounds) {
    const bounds = dateBounds(value);
    if (!bounds) return null;

    const dateWindow = windowBounds || calendarDateWindow();
    const today = dateWindow.today;
    if (bounds.max < today || bounds.min > dateWindow.end) return null;

    const sortTime = Math.max(bounds.min.getTime(), today.getTime());
    let sectionKey = '';
    let sectionLabel = '';

    if (bounds.precision === 'year') {
        sectionKey = 'year-' + bounds.min.getFullYear();
        sectionLabel = String(bounds.min.getFullYear()) + ' - date not confirmed';
    } else {
        sectionKey = bounds.min.getFullYear() + '-' + String(bounds.min.getMonth() + 1).padStart(2, '0');
        sectionLabel = MONTH_NAMES[bounds.min.getMonth()] + ' ' + bounds.min.getFullYear();
    }

    return {
        bounds: bounds,
        sortTime: sortTime,
        sectionKey: sectionKey,
        sectionLabel: sectionLabel,
        displayDate: String(value || '')
    };
}

function processCalendarReleaseGroups() {
    if (viewMode !== 'calendar') return;

    const seen = new Set();
    const matchedArtistTokens = new Set();
    const items = [];
    const dateWindow = calendarDateWindow();
    const debug = {
        raw: calendarRawReleaseGroups.length,
        invalid: 0,
        duplicate: 0,
        typeRejected: 0,
        dateRejected: 0,
        artistRejected: 0,
        variousArtistsRejected: 0,
        matchedByMbid: 0,
        matchedByName: 0,
        displayed: 0
    };

    for (let i = 0; i < calendarRawReleaseGroups.length; i++) {
        const rg = calendarRawReleaseGroups[i];
        const id = extractUuid(rg && rg.id);
        if (!rg || !id) {
            debug.invalid++;
            continue;
        }
        if (seen.has(id)) {
            debug.duplicate++;
            continue;
        }
        if (!releaseAllowed(rg)) {
            debug.typeRejected++;
            continue;
        }

        const date = String(rg['first-release-date'] || '');
        const dateInfo = calendarDateInfo(date, dateWindow);
        if (!dateInfo) {
            debug.dateRejected++;
            continue;
        }

        const artistMatch = matchReleaseToLibraryArtist(rg);
        if (!artistMatch.matched) {
            if (artistMatch.credit && artistMatch.credit.variousArtists) debug.variousArtistsRejected++;
            else debug.artistRejected++;
            continue;
        }

        seen.add(id);
        matchedArtistTokens.add(artistMatch.token);
        if (artistMatch.method === 'artist MBID') debug.matchedByMbid++;
        else if (artistMatch.method === 'artist name') debug.matchedByName++;

        const owned = findOwnedMatch(rg, artistMatch.credit.names.concat([artistMatch.libraryName]));
        items.push({
            id: id,
            title: cleanSpaces(rg.title) || '(untitled)',
            artist: artistMatch.credit.phrase,
            libraryArtist: artistMatch.libraryName,
            artistMbid: artistMatch.artistMbid,
            artistMatchMethod: artistMatch.method,
            date: date,
            dateInfo: dateInfo,
            type: typeLabel(rg),
            owned: owned.owned,
            matchMethod: owned.method,
            url: SITE_ROOT + '/release-group/' + id
        });
    }

    debug.displayed = items.length;
    calendarPipelineDebug = debug;

    items.sort(function (a, b) {
        return a.dateInfo.sortTime - b.dateInfo.sortTime ||
            compareStrings(a.date, b.date) ||
            compareStrings(a.artist, b.artist) ||
            compareStrings(a.title, b.title);
    });

    calendarItems = items;
    calendarStats.total = items.length;
    calendarStats.present = items.filter(function (item) { return item.owned; }).length;
    calendarStats.missing = calendarStats.total - calendarStats.present;
    calendarStats.matchedArtists = matchedArtistTokens.size;
    calendarStats.searched = calendarRawReleaseGroups.length;

    const groups = new Map();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = item.dateInfo.sectionKey;
        if (!groups.has(key)) {
            groups.set(key, {
                key: key,
                label: item.dateInfo.sectionLabel,
                sortTime: item.dateInfo.sortTime,
                items: []
            });
        }
        const group = groups.get(key);
        group.sortTime = Math.min(group.sortTime, item.dateInfo.sortTime);
        group.items.push(item);
    }

    const groupList = Array.from(groups.values());
    groupList.sort(function (a, b) {
        return a.sortTime - b.sortTime || compareStrings(a.label, b.label);
    });

    const rows = [];
    for (let i = 0; i < groupList.length; i++) {
        addSectionTo(rows, groupList[i].label, groupList[i].items, 'calendar');
    }
    resetDisplayRows(rows);

    const artistCount = libraryArtistNameKeys.size;
    const mbidCount = libraryArtistMbids.size;
    if (!libraryReady) {
        statusText = 'Indexing artists in the foobar2000 library...';
        statusIsError = false;
    } else if (!artistCount && !mbidCount) {
        statusText = 'No usable artist tags were found in the foobar2000 library.';
        statusIsError = true;
    } else if (items.length) {
        statusText = 'Matched against ' + plural(artistCount, 'library artist') +
            '; ' + plural(mbidCount, 'artist', 'artists') + ' have MusicBrainz IDs.';
        statusIsError = false;
    } else if (calendarRawReleaseGroups.length) {
        statusText = 'No upcoming MusicBrainz releases of the selected types matched your library artists.';
        statusIsError = false;
    } else {
        statusText = 'No upcoming MusicBrainz releases of the selected types were found in the selected horizon.';
        statusIsError = false;
    }

    window.Repaint();
}

function viewportHeight() {
    return Math.max(0, wh - HEADER_H);
}

function maxScroll() {
    return Math.max(0, contentHeight - viewportHeight());
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

function cachePath(mbid) {
    return CACHE_DIR + mbid.toLowerCase() + '.json';
}

function readCache(mbid) {
    const path = cachePath(mbid);
    const debug = {
        state: 'missing', path: path, checkedAt: Date.now(), savedAt: 0,
        releaseGroups: 0, error: ''
    };
    try {
        if (!utils.IsFile(path)) {
            artistCacheDebug = debug;
            return null;
        }
        debug.state = 'invalid';
        const data = safeJson(utils.ReadTextFile(path, 65001));
        if (!data || !Array.isArray(data.releaseGroups)) {
            debug.error = 'JSON is missing a releaseGroups array.';
            artistCacheDebug = debug;
            return null;
        }
        debug.state = 'valid';
        debug.savedAt = Number(data.savedAt || 0);
        debug.releaseGroups = data.releaseGroups.length;
        artistCacheDebug = debug;
        return data;
    } catch (e) {
        debug.state = 'read error';
        debug.error = debugSnippet(e, 180);
        artistCacheDebug = debug;
        return null;
    }
}

function writeCache(mbid, releaseGroups, artistName, artistComment) {
    try {
        utils.CreateFolder(CACHE_DIR);
        const data = {
            savedAt: Date.now(),
            artistMbid: mbid,
            artistName: artistName || resolvedArtistName,
            artistComment: artistComment || resolvedArtistComment,
            releaseGroups: releaseGroups
        };
        utils.WriteTextFile(cachePath(mbid), JSON.stringify(data), false);
        artistCacheDebug = {
            state: 'valid', path: cachePath(mbid), checkedAt: Date.now(),
            savedAt: data.savedAt, releaseGroups: releaseGroups.length, error: ''
        };
    } catch (e) {
        artistCacheDebug = {
            state: 'write error', path: cachePath(mbid), checkedAt: Date.now(),
            savedAt: 0, releaseGroups: releaseGroups.length, error: debugSnippet(e, 180)
        };
        console.log('Discography Checker: cache write failed: ' + e);
    }
}

function cacheFresh(cache) {
    return cache && Number(cache.savedAt) > 0 && (Date.now() - Number(cache.savedAt)) < cacheDays * 24 * 60 * 60 * 1000;
}

// The queried span is anchored to the first of the current month and always
// covers CALENDAR_QUERY_MONTHS, so it is a stable superset of every selectable
// horizon: the cache key turns over monthly, not at every midnight, and the
// displayed window is narrowed locally by calendarDateWindow().
function calendarQuerySpan() {
    const start = startOfMonth();
    const end = addDays(addMonths(start, CALENDAR_QUERY_MONTHS), -1);
    return { start: dateToIsoLocal(start), end: dateToIsoLocal(end) };
}

function encodedLength(text) {
    try {
        return encodeURIComponent(String(text || '')).length;
    } catch (e) {
        return String(text || '').length * 3;
    }
}

// Artists are hashed into a power-of-two number of buckets rather than sliced
// from a sorted list: adding one artist then invalidates one bucket instead of
// shifting every batch boundary and expiring the entire cache.
function calendarBucketCount(totalChars) {
    const needed = Math.max(1, Math.ceil(Number(totalChars || 0) / CALENDAR_QUERY_BUDGET_CHARS));
    let count = 1;
    while (count < needed) count *= 2;
    return count;
}

function buildCalendarBuckets() {
    const buckets = [];

    const mbids = Array.from(libraryArtistMbids);
    if (mbids.length) {
        const count = calendarBucketCount(mbids.length * 55);
        const groups = new Array(count);
        for (let i = 0; i < mbids.length; i++) {
            const index = fnv1a(mbids[i]) % count;
            if (!groups[index]) groups[index] = [];
            groups[index].push(mbids[i]);
        }
        for (let i = 0; i < count; i++) {
            if (!groups[i] || !groups[i].length) continue;
            groups[i].sort();
            buckets.push({ key: 'id:' + count + ':' + i, kind: 'mbid', members: groups[i], names: [] });
        }
    }

    if (calendarIncludeUntaggedArtists) {
        // Artists already covered by an arid query, including each half of a
        // "A; B" credit, must not also get a fuzzier name query.
        const covered = new Set();
        libraryArtistNameByMbid.forEach(function (name) {
            const variants = artistNameVariants(name);
            for (let i = 0; i < variants.length; i++) {
                const key = normalizeArtist(variants[i]);
                if (key) covered.add(key);
            }
        });

        const pending = [];
        let chars = 0;
        libraryArtistNameByKey.forEach(function (display, key) {
            if (covered.has(key)) return;
            const name = cleanSpaces(display);
            // A combined "A; B" credit is indexed alongside its parts; querying
            // the joined string matches nothing on MusicBrainz.
            if (!name || name.indexOf(';') >= 0 || isGenericArtistName(name)) return;
            pending.push({ key: key, name: name });
            chars += encodedLength(name) + 27;
        });

        if (pending.length) {
            const count = calendarBucketCount(chars);
            const groups = new Array(count);
            for (let i = 0; i < pending.length; i++) {
                const index = fnv1a(pending[i].key) % count;
                if (!groups[index]) groups[index] = [];
                groups[index].push(pending[i]);
            }
            for (let i = 0; i < count; i++) {
                if (!groups[i] || !groups[i].length) continue;
                groups[i].sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
                buckets.push({
                    key: 'nm:' + count + ':' + i,
                    kind: 'name',
                    members: groups[i].map(function (entry) { return entry.key; }),
                    names: groups[i].map(function (entry) { return entry.name; })
                });
            }
        }
    }

    return buckets;
}

// No primary-type or status clause: types are filtered locally by
// releaseAllowed(), and status:official silently dropped upcoming release
// groups, which frequently have no release status set yet.
function calendarBucketQuery(bucket, span) {
    const clauses = [];
    if (bucket.kind === 'mbid') {
        for (let i = 0; i < bucket.members.length; i++) clauses.push('arid:' + bucket.members[i]);
    } else {
        for (let i = 0; i < bucket.names.length; i++) {
            clauses.push('artistname:"' + escapeLucene(bucket.names[i]) + '"');
        }
    }
    return 'firstreleasedate:[' + span.start + ' TO ' + span.end + '] AND (' + clauses.join(' OR ') + ')';
}

// Only the fields the calendar pipeline reads. Raw search rows carry releases,
// tags and scores, which made a full cache tens of megabytes to write and parse.
function slimReleaseGroup(rg) {
    const credits = Array.isArray(rg && rg['artist-credit']) ? rg['artist-credit'] : [];
    const slimCredits = [];
    for (let i = 0; i < credits.length; i++) {
        const credit = credits[i] || {};
        const artist = credit.artist || {};
        const entry = {};
        if (credit.name) entry.name = String(credit.name);
        if (credit.joinphrase) entry.joinphrase = String(credit.joinphrase);
        if (artist.id || artist.name) {
            entry.artist = {};
            if (artist.id) entry.artist.id = String(artist.id);
            if (artist.name) entry.artist.name = String(artist.name);
        }
        slimCredits.push(entry);
    }

    const slim = {
        id: String((rg && rg.id) || ''),
        title: String((rg && rg.title) || ''),
        'first-release-date': String((rg && rg['first-release-date']) || ''),
        'primary-type': String((rg && rg['primary-type']) || ''),
        'artist-credit': slimCredits
    };
    const secondary = Array.isArray(rg && rg['secondary-types']) ? rg['secondary-types'].filter(Boolean) : [];
    if (secondary.length) slim['secondary-types'] = secondary.map(String);
    if (!slimCredits.length && rg && rg['artist-credit-phrase']) {
        slim['artist-credit-phrase'] = String(rg['artist-credit-phrase']);
    }
    return slim;
}

function emptyCalendarCache() {
    return { version: CALENDAR_CACHE_VERSION, savedAt: 0, buckets: {} };
}

function loadCalendarCacheFile() {
    if (calendarCache) return calendarCache;

    let state = 'missing';
    let error = '';
    try {
        // Reclaim the v2 file's space instead of parsing it; it could hold
        // 10,000 raw rows and cost seconds on every activation.
        if (utils.IsFile(CALENDAR_LEGACY_CACHE_FILE)) {
            try { utils.WriteTextFile(CALENDAR_LEGACY_CACHE_FILE, '', false); } catch (e) { }
        }

        if (utils.IsFile(CALENDAR_CACHE_FILE)) {
            const data = safeJson(utils.ReadTextFile(CALENDAR_CACHE_FILE, 65001));
            if (data && Number(data.version) === CALENDAR_CACHE_VERSION && data.buckets && typeof data.buckets === 'object') {
                calendarCache = data;
                state = 'valid';
            } else {
                state = 'invalid';
                error = 'Unsupported or corrupt cache file; it is being rebuilt.';
            }
        }
    } catch (e) {
        state = 'read error';
        error = debugSnippet(e, 180);
        reportFailure('the calendar cache could not be read', e);
    }

    if (!calendarCache) calendarCache = emptyCalendarCache();
    refreshCalendarCacheDebug(state === 'missing' ? 'empty' : state, error);
    return calendarCache;
}

function saveCalendarCacheFile(force) {
    if (!calendarCache || !calendarCacheDirty) return;
    if (!force && Date.now() - calendarCacheWrittenAt < CALENDAR_CACHE_WRITE_INTERVAL_MS) return;

    try {
        utils.CreateFolder(CACHE_DIR);
        // Drop entries whose bucket no longer exists (the library roughly
        // doubled, so the bucket count did too) instead of growing forever.
        if (libraryReady && calendarBuckets.length) {
            const live = new Set();
            for (let i = 0; i < calendarBuckets.length; i++) live.add(calendarBuckets[i].key);
            const keys = Object.keys(calendarCache.buckets);
            for (let i = 0; i < keys.length; i++) {
                if (!live.has(keys[i])) delete calendarCache.buckets[keys[i]];
            }
        }
        calendarCache.version = CALENDAR_CACHE_VERSION;
        calendarCache.savedAt = Date.now();
        utils.WriteTextFile(CALENDAR_CACHE_FILE, JSON.stringify(calendarCache), false);
        calendarCacheDirty = false;
        calendarCacheWrittenAt = Date.now();
        refreshCalendarCacheDebug('valid', '');
    } catch (e) {
        refreshCalendarCacheDebug('write error', debugSnippet(e, 180));
        reportFailure('the calendar cache could not be written', e);
    }
}

// A bucket is only complete for the artists it was queried for, so a newly
// added artist that hashes into it makes it stale even inside its lifetime.
function calendarBucketFresh(bucket) {
    if (!calendarCache) return false;
    const entry = calendarCache.buckets[bucket.key];
    if (!entry || !Array.isArray(entry.rows) || !(Number(entry.savedAt) > 0)) return false;

    const span = calendarQuerySpan();
    if (String(entry.startDate || '') !== span.start || String(entry.endDate || '') !== span.end) return false;
    if (Date.now() - Number(entry.savedAt) >= cacheDays * 24 * 60 * 60 * 1000) return false;

    const cached = new Set(Array.isArray(entry.members) ? entry.members : []);
    for (let i = 0; i < bucket.members.length; i++) {
        if (!cached.has(bucket.members[i])) return false;
    }
    return true;
}

// Stale and previously failed buckets still contribute their last good rows, so
// the calendar never blanks out while it refreshes.
function collectCalendarRows() {
    const rows = [];
    if (calendarCache) {
        for (let i = 0; i < calendarBuckets.length; i++) {
            const entry = calendarCache.buckets[calendarBuckets[i].key];
            if (entry && Array.isArray(entry.rows)) Array.prototype.push.apply(rows, entry.rows);
        }
    }
    calendarRawReleaseGroups = rows;
}

function storeCalendarBucket(bucket, rows, errorText) {
    if (!calendarCache) return;

    if (errorText) {
        const previous = calendarCache.buckets[bucket.key];
        if (previous) previous.error = errorText;
        else {
            calendarCache.buckets[bucket.key] = {
                members: bucket.members.slice(), savedAt: 0,
                startDate: '', endDate: '', rows: [], error: errorText
            };
        }
    } else {
        const span = calendarQuerySpan();
        calendarCache.buckets[bucket.key] = {
            members: bucket.members.slice(),
            savedAt: Date.now(),
            startDate: span.start,
            endDate: span.end,
            rows: rows || [],
            error: ''
        };
    }

    calendarCacheDirty = true;
    saveCalendarCacheFile(false);
    collectCalendarRows();
    refreshCalendarCacheDebug('valid', '');
    processCalendarReleaseGroups();
}

function calendarBucketArtistCount() {
    let count = 0;
    for (let i = 0; i < calendarBuckets.length; i++) count += calendarBuckets[i].members.length;
    return count;
}

function refreshCalendarCacheDebug(state, error) {
    let rows = 0;
    let failed = 0;
    let savedAt = 0;
    const keys = calendarCache ? Object.keys(calendarCache.buckets) : [];
    for (let i = 0; i < keys.length; i++) {
        const entry = calendarCache.buckets[keys[i]];
        if (!entry) continue;
        rows += Array.isArray(entry.rows) ? entry.rows.length : 0;
        if (Number(entry.savedAt) > savedAt) savedAt = Number(entry.savedAt);
        if (entry.error) failed++;
    }

    let stale = 0;
    for (let i = 0; i < calendarBuckets.length; i++) {
        if (!calendarBucketFresh(calendarBuckets[i])) stale++;
    }

    calendarCacheDebug = {
        state: String(state || calendarCacheDebug.state),
        path: CALENDAR_CACHE_FILE,
        checkedAt: Date.now(),
        savedAt: savedAt,
        buckets: keys.length,
        staleBuckets: stale,
        failedBuckets: failed,
        releaseGroups: rows,
        error: String(error || '')
    };
}

function selectedSecondaryTypeValues() {
    const values = [];
    for (let i = 0; i < SECONDARY_TYPE_DEFS.length; i++) {
        const def = SECONDARY_TYPE_DEFS[i];
        if (releaseTypeFilters.secondary[def.key]) values.push(def.label);
    }
    return values;
}

function describeArtistCacheDebug() {
    const debug = artistCacheDebug;
    if (debug.state !== 'valid') {
        return 'State: ' + debug.state + (debug.error ? '; ' + debug.error : '') +
            (debug.checkedAt ? '; checked ' + debugDateTime(debug.checkedAt) : '');
    }

    if (!(debug.savedAt > 0)) {
        return 'State: stale/invalid timestamp; ' + plural(debug.releaseGroups, 'cached release group') + '.';
    }

    const age = Date.now() - debug.savedAt;
    const lifetime = cacheDays * 24 * 60 * 60 * 1000;
    const fresh = age < lifetime;
    return 'State: ' + (fresh ? 'fresh' : 'expired') + '; ' +
        plural(debug.releaseGroups, 'cached release group') + '; saved ' +
        debugDateTime(debug.savedAt) + ' (' + debugDuration(age) + ' ago); lifetime ' + cacheDays + ' d' +
        (fresh ? '; expires in ' + debugDuration(lifetime - age) : '; network refresh required') + '.';
}

function describeCalendarCacheDebug() {
    const debug = calendarCacheDebug;
    if (debug.state === 'not checked' || debug.state === 'read error' ||
        debug.state === 'write error' || debug.state === 'invalid') {
        return 'State: ' + debug.state + (debug.error ? '; ' + debug.error : '') +
            (debug.checkedAt ? '; checked ' + debugDateTime(debug.checkedAt) : '') + '.';
    }

    const span = calendarQuerySpan();
    const age = debug.savedAt > 0 ? Date.now() - debug.savedAt : 0;
    // A query group is one batched MusicBrainz request covering many artists,
    // so always name the artist count beside it.
    const coverage = calendarBuckets.length + ' batched query group(s) covering ' +
        plural(calendarBucketArtistCount(), 'artist');
    return 'State: ' + (debug.staleBuckets
        ? debug.staleBuckets + ' of ' + coverage + ' need a refresh'
        : (calendarBuckets.length ? 'complete: ' + coverage : 'no query groups built yet')) +
        '; ' + plural(debug.releaseGroups, 'cached row') +
        ' across ' + plural(debug.buckets, 'stored group') +
        (debug.failedBuckets ? '; ' + debug.failedBuckets + ' last failed and kept older rows' : '') +
        '; newest save ' + debugDateTime(debug.savedAt) +
        (debug.savedAt > 0 ? ' (' + debugDuration(age) + ' ago)' : '') +
        '; lifetime ' + cacheDays + ' d; cached span ' + span.start + ' to ' + span.end + '.';
}

function describeArtistPipelineDebug() {
    const debug = artistPipelineDebug;
    return debug.raw + ' raw; ' + debug.displayed + ' displayed; ' +
        debug.typeRejected + ' rejected by release-type filters; ' +
        debug.invalid + ' invalid; ' + debug.duplicate + ' duplicate; filters ' +
        (debug.filtersApplied ? 'applied (Catch Up)' : 'ignored (Releases)') + '.';
}

function describeCalendarPipelineDebug() {
    const debug = calendarPipelineDebug;
    return debug.raw + ' raw search rows; ' + debug.displayed + ' displayed; ' +
        debug.typeRejected + ' rejected by release-type filters; ' +
        debug.dateRejected + ' rejected by date/horizon; ' +
        debug.artistRejected + ' did not match a library artist; ' +
        debug.variousArtistsRejected + ' Various Artists; ' +
        debug.invalid + ' invalid; ' + debug.duplicate + ' duplicate; artist matches: ' +
        debug.matchedByMbid + ' by MBID, ' + debug.matchedByName + ' by name.';
}

function diagnoseCurrentState() {
    if (statusIsError) return 'Panel error/status: ' + statusText;

    if (viewMode === 'calendar') {
        if (!selectedPrimaryTypeValues().length) return 'No primary release types are enabled, so the calendar query cannot run.';
        if (!libraryReady) {
            if (libraryIndexDebug.state === 'failed') return 'The local library artist index failed to build: ' + (libraryIndexDebug.error || 'unknown error') + '. Rebuild the library index after fixing the underlying problem.';
            return 'The local library artist index is still being built.';
        }
        if (!libraryArtistNameKeys.size && !libraryArtistMbids.size) return 'The library index contains no usable artist names or MusicBrainz artist IDs.';
        if (calendarRun) return 'A MusicBrainz calendar refresh is in progress; each query group batches many artists into one request, and already-cached rows stay displayed while it runs.';
        if (calendarItems.length) return 'Calendar has displayable results. The pipeline row below shows any releases filtered out along the way.';

        const debug = calendarPipelineDebug;
        if (!debug.raw) {
            if (!calendarBuckets.length) return 'No query groups were built, so nothing has been requested. Check that the library index found artist MBIDs or names.';
            if (!calendarCacheDebug.staleBuckets) {
                return 'Every query group is cached and fresh, and MusicBrainz reported no upcoming releases for any of the artists in them. Use Refresh release calendar to re-query before the cache lifetime expires.';
            }
            return 'No cached rows yet for the current query groups. Calendar cache below shows how many still need a refresh; Network shows whether requests are running or failing.';
        }
        if (debug.typeRejected && debug.typeRejected + debug.invalid + debug.duplicate >= debug.raw) {
            return 'MusicBrainz returned rows, but none survive the configured primary/secondary release-type filters.';
        }
        if (debug.dateRejected && debug.typeRejected + debug.dateRejected + debug.invalid + debug.duplicate >= debug.raw) {
            return 'MusicBrainz returned rows, but none have a usable release date inside the current calendar horizon.';
        }
        if (debug.artistRejected || debug.variousArtistsRejected) {
            return 'MusicBrainz returned upcoming releases, but none matched artists in the local library after MBID/name matching (Various Artists is intentionally ignored).';
        }
        return 'No calendar rows remain after validation/filtering. See the Calendar pipeline counts below for the exact stage losses.';
    }

    if (!sourceArtist) return statusText;
    if (!artistMbid) return 'The source artist has not resolved to a usable MusicBrainz artist ID yet. ' + statusText;
    if (activeFetch) return 'A MusicBrainz discography refresh is in progress; cached rows may be displayed until it completes.';
    if (albumItems.length) return 'Artist data has displayable release groups. The pipeline row below shows any groups filtered out.';

    const debug = artistPipelineDebug;
    if (!debug.raw) {
        if (artistCacheDebug.state === 'valid' && artistCacheDebug.releaseGroups === 0 &&
            artistCacheDebug.savedAt > 0 && Date.now() - artistCacheDebug.savedAt < cacheDays * 24 * 60 * 60 * 1000) {
            return 'The artist cache contains a fresh empty MusicBrainz discography response, so the panel is intentionally not re-querying MusicBrainz yet. Force Refresh or wait for the cache lifetime to expire.';
        }
        return 'No MusicBrainz release groups are loaded for the resolved artist. Check Artist cache and Network below to distinguish a fresh cached empty response from a cache miss/expiry or request failure.';
    }
    if (debug.filtersApplied && debug.typeRejected && debug.typeRejected + debug.invalid + debug.duplicate >= debug.raw) {
        return 'MusicBrainz returned release groups, but the current Catch Up release-type filters exclude all of them. The Releases view ignores these filters.';
    }
    return 'MusicBrainz returned release groups, but none became usable display rows; inspect the Artist pipeline counts below.';
}

function describeArtistIdentityDebug() {
    if (!sourceArtist) return 'No current/focused source artist.';
    let resolution = 'unresolved';
    const override = artistOverrides[sourceArtistKey];
    const automatic = artistResolutions[sourceArtistKey];
    if (override && extractUuid(override.mbid) === artistMbid) resolution = 'manual override';
    else if (artistMbid && resolvedArtistName === sourceArtist) resolution = 'track tag or exact source identity';
    else if (automatic && extractUuid(automatic.mbid) === artistMbid) resolution = 'saved automatic MusicBrainz match';
    else if (artistMbid) resolution = 'resolved MusicBrainz identity';
    return 'Source: ' + sourceArtist + '; resolved: ' + (resolvedArtistName || '(none)') +
        (resolvedArtistComment ? ' (' + resolvedArtistComment + ')' : '') +
        '; MBID: ' + (artistMbid || '(none)') + '; resolution: ' + resolution + '.';
}

function describeCalendarScopeDebug() {
    const span = calendarQuerySpan();
    const bounds = calendarDateWindow();
    const primary = selectedPrimaryTypeValues();
    const secondary = selectedSecondaryTypeValues();
    let mbidGroups = 0;
    let nameGroups = 0;
    let mbidArtists = 0;
    let nameArtists = 0;
    for (let i = 0; i < calendarBuckets.length; i++) {
        if (calendarBuckets[i].kind === 'name') {
            nameGroups++;
            nameArtists += calendarBuckets[i].members.length;
        } else {
            mbidGroups++;
            mbidArtists += calendarBuckets[i].members.length;
        }
    }
    return 'Queried span: ' + span.start + ' to ' + span.end + ' (' + CALENDAR_QUERY_MONTHS + ' months, shared by every horizon); displayed: ' +
        dateToIsoLocal(bounds.today) + ' to ' + dateToIsoLocal(bounds.end) + ' (' + calendarHorizonDays + ' d); ' +
        plural(mbidGroups, 'batched MBID query group') + ' covering ' + plural(mbidArtists, 'artist') + '; ' +
        plural(nameGroups, 'batched name query group') + ' covering ' + plural(nameArtists, 'artist') +
        (calendarIncludeUntaggedArtists ? '' : ' (name fallback disabled)') +
        '; primary types filtered locally: ' + (primary.join(', ') || '(none)') +
        '; allowed secondary: ' + (secondary.join(', ') || '(none)') + '.';
}

function describeLibraryDebug() {
    const debug = libraryIndexDebug;
    return 'State: ' + debug.state + '; ready: ' + (libraryReady ? 'yes' : 'no') + '; ' +
        plural(debug.trackCount, 'track scanned') + '; ' +
        plural(libraryArtistNameKeys.size, 'artist name') + '; ' +
        plural(libraryArtistMbids.size, 'artist MBID') + '; ' +
        plural(libraryAlbumEntryCount, 'album title entry', 'album title entries') + '; ' +
        plural(libraryRgids.size, 'release-group MBID') +
        (debug.enrichedMbids ? '; ' + plural(debug.enrichedMbids, 'MBID added from saved resolution') : '') +
        (debug.error ? '; error: ' + debug.error : '') + '.';
}

function describeNetworkDebug() {
    const live = [];
    const now = Date.now();
    if (activeFetch) {
        live.push('discography fetch ' + activeFetch.releaseGroups.length +
            (activeFetch.total ? '/' + activeFetch.total : '') + ' rows');
    }
    if (calendarRun) {
        live.push('calendar refresh ' + (calendarRun.completed + calendarRun.failed) +
            '/' + calendarRun.pending.length + ' query groups, ' + calendarRun.rows.length + ' rows in current group');
    }
    if (requestQueue.length) live.push(requestQueue.length + ' queued request(s)');
    if (requestContexts.size) live.push(requestContexts.size + ' HTTP request(s) in flight');
    if (mbBlockedUntil > now) live.push('cooldown ' + formatRetrySeconds(mbBlockedUntil - now));
    if (retryAttempt > 0 && retryAt > now) {
        live.push('retry ' + retryAttempt + '/' + MAX_TRANSIENT_RETRIES + ' in ' + formatRetrySeconds(retryAt - now));
    }

    let text = live.length ? 'Live: ' + live.join('; ') + '. ' : 'Live: idle. ';
    text += 'Pacing: ' + REQUEST_INTERVAL_MS + ' ms; transient failures: ' + consecutiveTransientErrors +
        (lastTransientStatus ? ' (last HTTP ' + lastTransientStatus + ')' : '') +
        '; last success: ' + (lastSuccessfulRequestAt ? debugDateTime(lastSuccessfulRequestAt) : 'none') + '. ';
    if (lastNetworkDebug.at) {
        text += 'Last: ' + lastNetworkDebug.state + (lastNetworkDebug.kind ? ' (' + lastNetworkDebug.kind + ')' : '') +
            (lastNetworkDebug.httpStatus ? ', HTTP ' + lastNetworkDebug.httpStatus : '') +
            ' at ' + debugDateTime(lastNetworkDebug.at) +
            (lastNetworkDebug.detail ? '; ' + lastNetworkDebug.detail : '') + '.';
    } else {
        text += 'No network operation recorded yet.';
    }
    return text;
}

// -----------------------------------------------------------------------------
// Rate-limited MusicBrainz HTTP queue
// -----------------------------------------------------------------------------

function requestHeaders() {
    return JSON.stringify({
        'User-Agent': MUSICBRAINZ_USER_AGENT,
        'Accept': 'application/json'
    });
}

function enqueueRequest(context) {
    if (!scriptActive) return;
    requestQueue.push(context);
    pumpRequestQueue();
}

function formatRetrySeconds(ms) {
    return (Math.max(0, Number(ms || 0)) / 1000).toFixed(1) + ' s';
}

function isTransientHttpStatus(status) {
    return status === 0 || status === 429 || status === 503;
}

function transientRetryDelay(retries, status) {
    const base = status === 503 ? RETRY_BASE_503_MS : RETRY_BASE_OTHER_MS;
    const exponential = base * Math.pow(2, Math.max(0, Number(retries || 0)));
    const capped = Math.min(exponential, RETRY_MAX_DELAY_MS);
    return capped + Math.floor(Math.random() * (RETRY_JITTER_MS + 1));
}

function recordRequestSuccess() {
    lastSuccessfulRequestAt = Date.now();
    consecutiveTransientErrors = 0;
    retryAttempt = 0;
    retryAt = 0;
    lastTransientStatus = 0;
    mbBlockedUntil = 0;
}

function pumpRequestQueue() {
    if (!scriptActive) return;
    clearTimer(requestTimer);
    requestTimer = 0;

    while (requestQueue.length && requestQueue[0].generation !== generation) {
        requestQueue.shift();
    }
    if (!requestQueue.length) return;
    // Keep MusicBrainz traffic strictly serial. This avoids piling up requests
    // when a response is slow and makes the global cooldown authoritative.
    if (requestContexts.size) return;

    const now = Date.now();
    const rateWait = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestAt));
    const cooldownWait = Math.max(0, mbBlockedUntil - now);
    const wait = Math.max(rateWait, cooldownWait);
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
        handleRequestFailure(context, 0, String(e));
    }

    if (requestQueue.length) {
        const nextWait = Math.max(REQUEST_INTERVAL_MS, Math.max(0, mbBlockedUntil - Date.now()));
        requestTimer = window.SetTimeout(pumpRequestQueue, nextWait);
    }
}

function retryRequest(context, status) {
    if (!isTransientHttpStatus(status)) return null;

    const retries = Number(context.retries || 0);
    consecutiveTransientErrors++;
    lastTransientStatus = status;

    let delay = transientRetryDelay(retries, status);
    if (status === 503 && consecutiveTransientErrors >= CIRCUIT_BREAKER_FAILURES) {
        delay = Math.max(delay, CIRCUIT_BREAKER_COOLDOWN_MS);
    }

    const now = Date.now();
    mbBlockedUntil = Math.max(mbBlockedUntil, now + delay);

    if (retries >= MAX_TRANSIENT_RETRIES) {
        retryAttempt = 0;
        retryAt = 0;
        return { scheduled: false, delay: delay, attempt: retries, max: MAX_TRANSIENT_RETRIES };
    }

    const attempt = retries + 1;
    const retry = Object.assign({}, context, { retries: attempt });
    requestQueue.unshift(retry);
    retryAttempt = attempt;
    retryAt = mbBlockedUntil;
    pumpRequestQueue();
    return { scheduled: true, delay: Math.max(0, mbBlockedUntil - now), attempt: attempt, max: MAX_TRANSIENT_RETRIES };
}

function handleRequestFailure(context, status, detail) {
    if (context.generation !== generation) return;

    const retry = retryRequest(context, status);
    const hasFallback = viewMode === 'calendar' ? calendarRawReleaseGroups.length : rawReleaseGroups.length;
    const suffix = status ? ' (HTTP ' + status + ')' : '';

    if (retry && retry.scheduled) {
        const fallbackText = hasFallback ? '; cached data remains displayed' : '';
        const retryText = 'Retry ' + retry.attempt + '/' + retry.max + ' in ' + formatRetrySeconds(retry.delay);
        setNetworkDebug('retrying', context.kind, retryText + fallbackText + '.', status);
        statusText = 'MusicBrainz temporarily unavailable' + suffix + '. ' + retryText + fallbackText + '.';
        statusIsError = false;
        window.Repaint();
        return;
    }

    // One failing query group must not end the whole calendar refresh.
    const failedBucket = context.kind === 'calendar-bucket' && calendarRun &&
        calendarRun.generation === generation &&
        calendarRun.pending[calendarRun.index] &&
        calendarRun.pending[calendarRun.index].key === context.bucketKey
        ? calendarRun.pending[calendarRun.index]
        : null;

    if (!failedBucket) {
        activeFetch = null;
        calendarRun = null;
    }

    if (retry && !retry.scheduled) {
        const cooldown = Math.max(0, mbBlockedUntil - Date.now());
        const fallbackText = hasFallback ? '; cached data remains displayed' : '';
        const cooldownText = cooldown > 0 ? '; cooldown ' + formatRetrySeconds(cooldown) : '';
        setNetworkDebug('failed', context.kind, 'Transient failure limit reached after ' + MAX_TRANSIENT_RETRIES + ' retries' + cooldownText + '.', status);
        statusText = 'MusicBrainz temporarily unavailable' + suffix + ' after ' + MAX_TRANSIENT_RETRIES + ' retries' + fallbackText + cooldownText + '.';
    } else {
        setNetworkDebug('failed', context.kind, detail || 'Request failed without a response body.', status);
        statusText = 'MusicBrainz request failed' + suffix + (hasFallback ? '; cached data remains displayed.' : '.');
    }
    statusIsError = true;
    if (detail) console.log('Discography Checker request failure: ' + detail);
    window.Repaint();

    if (failedBucket) {
        storeCalendarBucket(failedBucket, null, debugSnippet(detail || ('HTTP ' + status), 120));
        advanceCalendarRun(false);
        return;
    }

    if (requestQueue.length) pumpRequestQueue();
}

function escapeLucene(text) {
    return String(text || '').replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

function requestArtistSearch(artist, requestGeneration) {
    setNetworkDebug('fetching', 'artist search', 'Resolving "' + artist + '" to a MusicBrainz artist ID.', 0);
    statusText = 'Finding the MusicBrainz artist...';
    statusIsError = false;
    window.Repaint();

    const query = 'artist:"' + escapeLucene(artist) + '"';
    enqueueRequest({
        kind: 'artist-search',
        generation: requestGeneration,
        queryArtist: artist,
        url: API_ROOT + '/artist?fmt=json&limit=10&query=' + encodeURIComponent(query),
        retries: 0
    });
}

function beginReleaseFetch(mbid, requestGeneration) {
    activeFetch = {
        generation: requestGeneration,
        mbid: mbid,
        offset: 0,
        total: 0,
        releaseGroups: []
    };

    setNetworkDebug('fetching', 'discography', 'Loading release groups for artist MBID ' + mbid + '.', 0);
    statusText = rawReleaseGroups.length ? 'Updating the MusicBrainz discography...' : 'Loading the MusicBrainz discography...';
    statusIsError = false;
    window.Repaint();
    requestReleasePage(0, requestGeneration);
}

function requestReleasePage(offset, requestGeneration) {
    enqueueRequest({
        kind: 'release-groups',
        generation: requestGeneration,
        mbid: artistMbid,
        offset: offset,
        url: API_ROOT + '/release-group?fmt=json&limit=' + PAGE_SIZE + '&offset=' + offset + '&artist=' + encodeURIComponent(artistMbid),
        retries: 0
    });
}

function calendarRunProgressText() {
    if (!calendarRun) return statusText;
    const done = calendarRun.completed + calendarRun.failed;
    return (calendarRawReleaseGroups.length ? 'Updating' : 'Building') +
        ' the release calendar... ' + done + ' / ' + calendarRun.pending.length + ' query groups (' +
        plural(calendarBucketArtistCount(), 'artist') + ' total)';
}

// Only the buckets that are actually stale are queued; a normal day therefore
// issues no requests at all.
function startCalendarRun(forceNetwork) {
    if (viewMode !== 'calendar' || !libraryReady) return;

    const pending = [];
    for (let i = 0; i < calendarBuckets.length; i++) {
        if (forceNetwork || !calendarBucketFresh(calendarBuckets[i])) pending.push(calendarBuckets[i]);
    }

    if (!pending.length) {
        calendarRun = null;
        setNetworkDebug('skipped', 'calendar',
            'All ' + calendarBuckets.length + ' query group(s), covering ' + plural(calendarBucketArtistCount(), 'artist') +
            ', are cached and within the ' + cacheDays + ' d lifetime.', 0);
        processCalendarReleaseGroups();
        return;
    }

    calendarRun = {
        generation: generation,
        span: calendarQuerySpan(),
        pending: pending,
        index: 0,
        completed: 0,
        failed: 0,
        rows: []
    };
    setNetworkDebug('fetching', 'calendar',
        'Refreshing ' + pending.length + ' of ' + calendarBuckets.length + ' query group(s), covering ' +
        plural(calendarBucketArtistCount(), 'artist') + ', for ' +
        calendarRun.span.start + ' to ' + calendarRun.span.end + '.', 0);
    requestCalendarBucketPage(0);
}

function requestCalendarBucketPage(offset) {
    if (!calendarRun) return;
    const bucket = calendarRun.pending[calendarRun.index];
    if (!bucket) {
        finishCalendarRun();
        return;
    }

    statusText = calendarRunProgressText();
    statusIsError = false;
    window.Repaint();

    enqueueRequest({
        kind: 'calendar-bucket',
        generation: calendarRun.generation,
        bucketKey: bucket.key,
        offset: offset,
        url: API_ROOT + '/release-group?fmt=json&limit=' + PAGE_SIZE + '&offset=' + offset +
            '&query=' + encodeURIComponent(calendarBucketQuery(bucket, calendarRun.span)),
        retries: 0
    });
}

function advanceCalendarRun(succeeded) {
    if (!calendarRun) return;
    if (succeeded) calendarRun.completed++;
    else calendarRun.failed++;
    calendarRun.index++;
    calendarRun.rows = [];
    if (calendarRun.index >= calendarRun.pending.length) {
        finishCalendarRun();
        return;
    }
    requestCalendarBucketPage(0);
}

function finishCalendarRun() {
    if (!calendarRun) return;
    const total = calendarRun.pending.length;
    const failed = calendarRun.failed;
    calendarRun = null;

    saveCalendarCacheFile(true);
    collectCalendarRows();
    refreshCalendarCacheDebug('valid', '');
    setNetworkDebug(failed ? 'completed with errors' : 'completed', 'calendar',
        (total - failed) + ' of ' + total + ' query group(s) refreshed' +
        (failed ? '; ' + failed + ' failed and kept their previous rows' : '') + '.', 0);
    processCalendarReleaseGroups();

    // A skipped group is not a panel error, but it must not vanish silently.
    if (failed) {
        statusText += ' ' + failed + ' of ' + total + ' query groups could not be refreshed.';
        window.Repaint();
    }
}

function chooseArtistCandidate(queryArtist, artists) {
    const queryKey = normalizeArtist(queryArtist);
    let best = null;

    for (let i = 0; i < artists.length; i++) {
        const candidate = artists[i];
        const names = [candidate.name, candidate['sort-name']];
        if (Array.isArray(candidate.aliases)) {
            for (let j = 0; j < candidate.aliases.length; j++) names.push(candidate.aliases[j].name);
        }

        const exact = names.some(function (name) { return normalizeArtist(name) === queryKey; });
        const score = Number(candidate.score || 0);
        const rank = (exact ? 1000 : 0) + score;
        if (!best || rank > best.rank) best = { candidate: candidate, rank: rank, exact: exact, score: score };
    }

    if (!best || (!best.exact && best.score < 65)) return null;
    return best.candidate;
}

function on_http_request_done(taskId, success, responseText, status) {
    if (!scriptActive) return;
    const context = requestContexts.get(taskId);
    if (!context) return;
    requestContexts.delete(taskId);

    if (context.generation !== generation) {
        // The stale request was the serial queue's active request. Once it is
        // removed from requestContexts, immediately let the current generation
        // proceed instead of leaving its queued work stranded.
        pumpRequestQueue();
        return;
    }
    if (!success) {
        handleRequestFailure(context, Number(status || 0), responseText);
        return;
    }

    const data = safeJson(responseText);
    if (!data) {
        handleRequestFailure(context, Number(status || 0), 'Invalid JSON response');
        return;
    }

    recordRequestSuccess();
    // If an independent request was queued while this one was in flight, it
    // may now proceed. Pagination requests are enqueued below after processing.
    pumpRequestQueue();

    if (context.kind === 'artist-search') {
        const candidate = chooseArtistCandidate(context.queryArtist, Array.isArray(data.artists) ? data.artists : []);
        if (!candidate || !isUuid(candidate.id)) {
            activeFetch = null;
            setNetworkDebug('completed', 'artist search', 'Request succeeded, but no sufficiently reliable artist match was found.', status);
            statusText = 'No reliable MusicBrainz artist match. Right-click and set the artist ID manually.';
            statusIsError = true;
            window.Repaint();
            return;
        }

        const nextArtistMbid = String(candidate.id).toLowerCase();
        const nextResolvedArtistName = cleanSpaces(candidate.name) || sourceArtist;
        const nextResolvedArtistComment = cleanSpaces(candidate.disambiguation);
        const nextResolution = {
            mbid: nextArtistMbid,
            name: nextResolvedArtistName,
            comment: nextResolvedArtistComment
        };
        try {
            artistResolutions = persistObjectEntry(
                PROP + 'Artist MBID resolutions', artistResolutions, sourceArtistKey, nextResolution
            );
        } catch (e) {
            activeFetch = null;
            statusText = 'Could not save the MusicBrainz artist match.';
            statusIsError = true;
            console.log('Discography Checker: artist match persistence failed: ' + e);
            window.Repaint();
            return;
        }
        artistMbid = nextArtistMbid;
        resolvedArtistName = nextResolvedArtistName;
        resolvedArtistComment = nextResolvedArtistComment;
        loadDiscography(false);
        return;
    }

    if (context.kind === 'release-groups') {
        if (!activeFetch || activeFetch.generation !== generation) return;

        const groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
        activeFetch.total = Math.min(MAX_RELEASE_GROUPS, Number(data['release-group-count'] || 0));
        Array.prototype.push.apply(activeFetch.releaseGroups, groups);

        const loaded = activeFetch.releaseGroups.length;
        const nextOffset = context.offset + groups.length;
        if (nextOffset < activeFetch.total && groups.length) {
            statusText = 'Loading MusicBrainz discography... ' + loaded + ' / ' + activeFetch.total;
            statusIsError = false;
            window.Repaint();
            requestReleasePage(nextOffset, generation);
            return;
        }

        rawReleaseGroups = activeFetch.releaseGroups;
        setNetworkDebug('completed', 'discography', 'Loaded ' + rawReleaseGroups.length + ' release group(s) from MusicBrainz.', status);
        activeFetch = null;
        writeCache(artistMbid, rawReleaseGroups, resolvedArtistName, resolvedArtistComment);
        renderReleaseRows();
        return;
    }

    if (context.kind === 'calendar-bucket') {
        if (!calendarRun || calendarRun.generation !== generation) return;
        const bucket = calendarRun.pending[calendarRun.index];
        if (!bucket || bucket.key !== context.bucketKey) return;

        const groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
        for (let i = 0; i < groups.length; i++) calendarRun.rows.push(slimReleaseGroup(groups[i]));

        const reported = Number(data.count || data['release-group-count'] || 0);
        const total = Math.min(MAX_CALENDAR_SEARCH_RESULTS, reported);
        const nextOffset = context.offset + groups.length;
        if (nextOffset < total && groups.length) {
            requestCalendarBucketPage(nextOffset);
            return;
        }

        // storeCalendarBucket() persists before the next group starts, so an
        // interrupted run never loses the groups it already fetched.
        storeCalendarBucket(bucket, calendarRun.rows, '');
        advanceCalendarRun(true);
    }
}

// -----------------------------------------------------------------------------
// Artist/source resolution
// -----------------------------------------------------------------------------

function setResolvedArtist(value) {
    resolvedArtistName = cleanSpaces(value && value.name) || sourceArtist;
    resolvedArtistComment = cleanSpaces(value && value.comment);
}

function loadDiscography(forceNetwork) {
    if (!isArtistLikeMode(viewMode)) return;
    if (!isUuid(artistMbid)) {
        statusText = 'No valid MusicBrainz artist ID.';
        statusIsError = true;
        window.Repaint();
        return;
    }

    const cached = readCache(artistMbid);
    if (cached) {
        rawReleaseGroups = cached.releaseGroups;
        if (!resolvedArtistName) resolvedArtistName = cleanSpaces(cached.artistName) || sourceArtist;
        if (!resolvedArtistComment) resolvedArtistComment = cleanSpaces(cached.artistComment);
        renderReleaseRows();
    } else {
        rawReleaseGroups = [];
        albumItems = [];
        resetArtistPipelineDebug(viewMode !== 'discography');
        resetDisplayRows([]);
        window.Repaint();
    }

    if (!forceNetwork && cacheFresh(cached)) return;
    beginReleaseFetch(artistMbid, generation);
}

function refreshSource(forceNetwork) {
    if (!isArtistLikeMode(viewMode)) return;

    const handle = getSourceHandle();
    if (!handle) {
        cancelNetworkWork();
        sourceArtist = '';
        sourceArtistKey = '';
        artistMbid = '';
        resolvedArtistName = '';
        resolvedArtistComment = '';
        rawReleaseGroups = [];
        albumItems = [];
        resetArtistPipelineDebug(viewMode !== 'discography');
        artistCacheDebug = { state: 'not checked', path: '', checkedAt: 0, savedAt: 0, releaseGroups: 0, error: '' };
        artistStats = { total: 0, present: 0, missing: 0, upcoming: 0 };
        resetDisplayRows([]);
        statusText = 'Choose or play a track.';
        statusIsError = false;
        scrollY = 0;
        window.Repaint();
        return;
    }

    const artist = evalWithHandle(tfArtist, handle);
    if (!artist) {
        cancelNetworkWork();
        sourceArtist = '';
        sourceArtistKey = '';
        artistMbid = '';
        resolvedArtistName = '';
        resolvedArtistComment = '';
        rawReleaseGroups = [];
        albumItems = [];
        resetArtistPipelineDebug(viewMode !== 'discography');
        artistCacheDebug = { state: 'not checked', path: '', checkedAt: 0, savedAt: 0, releaseGroups: 0, error: '' };
        artistStats = { total: 0, present: 0, missing: 0, upcoming: 0 };
        resetDisplayRows([]);
        statusText = 'The source track has no album-artist or artist tag.';
        statusIsError = true;
        window.Repaint();
        return;
    }

    const artistKey = normalizeArtist(artist);
    const taggedMbid = extractUuid(evalWithHandle(tfArtistMbid, handle));

    if (isVariousArtistsName(artist) || taggedMbid === VARIOUS_ARTISTS_MBID) {
        cancelNetworkWork();
        sourceArtist = artist;
        sourceArtistKey = artistKey;
        artistMbid = '';
        resolvedArtistName = '';
        resolvedArtistComment = '';
        rawReleaseGroups = [];
        albumItems = [];
        resetArtistPipelineDebug(viewMode !== 'discography');
        artistCacheDebug = { state: 'not checked', path: '', checkedAt: 0, savedAt: 0, releaseGroups: 0, error: '' };
        artistStats = { total: 0, present: 0, missing: 0, upcoming: 0 };
        resetDisplayRows([]);
        statusText = 'Various Artists releases are ignored.';
        statusIsError = false;
        scrollY = 0;
        window.Repaint();
        return;
    }

    const override = artistOverrides[artistKey];
    const automatic = artistResolutions[artistKey];
    const selectedMbid = extractUuid(override && override.mbid) || taggedMbid || extractUuid(automatic && automatic.mbid);
    const identity = artistKey + '|' + selectedMbid;
    const oldIdentity = sourceArtistKey + '|' + artistMbid;

    if (!forceNetwork && identity === oldIdentity && rawReleaseGroups.length) {
        renderReleaseRows();
        return;
    }

    cancelNetworkWork();

    sourceArtist = artist;
    sourceArtistKey = artistKey;
    artistMbid = selectedMbid;
    resolvedArtistName = '';
    resolvedArtistComment = '';
    resetArtistPipelineDebug(viewMode !== 'discography');
    artistCacheDebug = {
        state: 'not checked', path: selectedMbid ? cachePath(selectedMbid) : '', checkedAt: 0,
        savedAt: 0, releaseGroups: 0, error: ''
    };
    scrollY = 0;
    hoverRow = -1;

    if (override && extractUuid(override.mbid)) {
        setResolvedArtist(override);
    } else if (taggedMbid) {
        resolvedArtistName = sourceArtist;
    } else if (automatic && extractUuid(automatic.mbid)) {
        setResolvedArtist(automatic);
    }

    if (artistMbid) loadDiscography(!!forceNetwork);
    else requestArtistSearch(sourceArtist, generation);
}

function forceRefreshArtist() {
    refreshSource(true);
}

// -----------------------------------------------------------------------------
// Calendar loading, view switching and export
// -----------------------------------------------------------------------------

function loadCalendar(forceNetwork) {
    if (viewMode !== 'calendar') return;

    loadCalendarCacheFile();
    calendarBuckets = libraryReady ? buildCalendarBuckets() : [];
    collectCalendarRows();
    refreshCalendarCacheDebug(calendarCacheDebug.state, calendarCacheDebug.error);
    processCalendarReleaseGroups();

    if (!libraryReady) return;
    if (!calendarBuckets.length) {
        setNetworkDebug('skipped', 'calendar', 'The library index produced no artists to query.', 0);
        return;
    }
    startCalendarRun(!!forceNetwork);
}

// A library change can add an artist to an existing bucket, which makes that
// bucket incomplete rather than merely old; re-derive and top up the stale ones.
function calendarLibraryChanged() {
    if (viewMode !== 'calendar' || initialLoadPending || !libraryReady) return;
    loadCalendarCacheFile();
    calendarBuckets = buildCalendarBuckets();
    collectCalendarRows();
    refreshCalendarCacheDebug('valid', '');
    processCalendarReleaseGroups();
    if (!calendarRun) startCalendarRun(false);
}

function activateArtistMode() {
    if (viewMode === 'artist') return;
    window.SetProperty(PROP + 'View mode', 'artist');
    cancelNetworkWork();
    viewMode = 'artist';
    scrollY = 0;
    resetDisplayRows([]);
    // refreshSource() itself detects an unchanged artist identity with
    // already-loaded release groups and re-renders via renderReleaseRows()
    // instead of re-fetching, so switching from RELEASES back to Catch
    // Up for the same artist does not re-hit the network.
    refreshSource(false);
}

function activateDiscographyMode() {
    if (viewMode === 'discography') return;
    window.SetProperty(PROP + 'View mode', 'discography');
    cancelNetworkWork();
    viewMode = 'discography';
    scrollY = 0;
    resetDisplayRows([]);
    refreshSource(false);
}

function activateCalendarMode(forceNetwork) {
    if (viewMode !== 'calendar') {
        window.SetProperty(PROP + 'View mode', 'calendar');
        cancelNetworkWork();
        viewMode = 'calendar';
        scrollY = 0;
        resetDisplayRows([]);
    } else if (forceNetwork) {
        cancelNetworkWork();
    }
    loadCalendar(!!forceNetwork);
}

function activateMode(mode) {
    if (mode === 'artist') activateArtistMode();
    else if (mode === 'discography') activateDiscographyMode();
    else activateCalendarMode(false);
}

function setCalendarHorizon(days) {
    const next = normalizeHorizon(days);
    if (next === calendarHorizonDays) return;
    window.SetProperty(PROP + 'Calendar horizon days', next);
    calendarHorizonDays = next;
    // The cached span already covers every horizon, so this is a local re-filter.
    if (viewMode === 'calendar') processCalendarReleaseGroups();
}

// -----------------------------------------------------------------------------
// Painting and hit testing
// -----------------------------------------------------------------------------

function summaryLine() {
    if (viewMode === 'calendar') {
        if (!calendarStats.total) return statusText;
        return plural(calendarStats.total, 'upcoming release') +
            SUMMARY_SEPARATOR + plural(calendarStats.matchedArtists, 'artist');
    }

    if (!artistStats.total) return statusText;
    let text = plural(artistStats.total, 'release') +
        SUMMARY_SEPARATOR + artistStats.present + ' in library' +
        SUMMARY_SEPARATOR + artistStats.missing + ' missing';
    if (artistStats.upcoming) text += SUMMARY_SEPARATOR + artistStats.upcoming + ' upcoming';
    return text;
}

function on_size() {
    ww = window.Width;
    wh = window.Height;
    scrollY = clamp(scrollY, 0, maxScroll());
    syncHoverFromPointer(false);
}

function paintModeButton(gr) {
    const outer = modeButtonRect();
    const modes = MODE_TAB_ORDER.map(function (id) {
        return {
            id: id,
            label: id === 'artist' ? 'CATCH UP' : (id === 'discography' ? 'RELEASES' : 'CALENDAR'),
            rect: modeTabRect(id)
        };
    });

    const base = colours.button;
    const selectorOptions = {
        base: base,
        accent: colours.accent,
        textPrimary: colours.text,
        textSecondary: blend(colours.text, colours.background, 0.25),
        textMuted: colours.muted
    };

    gr.FillSolidRect(outer.x, outer.y, outer.w, outer.h, base);
    gr.FillSolidRect(outer.x, outer.y, outer.w, scaleUi(1), colours.rule);
    gr.FillSolidRect(outer.x, outer.y + outer.h - scaleUi(1), outer.w, scaleUi(1), colours.rule);

    for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const selected = viewMode === mode.id;
        const hovered = hoverModeTab === mode.id;
        const pressed = pressedModeTab === mode.id;
        const visual = RivageUI.selectorVisual({}, {
            selected: selected,
            hovered: hovered,
            pressed: pressed
        }, selectorOptions);

        if (visual.fill !== base) {
            gr.FillSolidRect(mode.rect.x, mode.rect.y, mode.rect.w, mode.rect.h, visual.fill);
        }

        if (selected) {
            const indicatorW = Math.min(scaleUi(30), Math.max(scaleUi(12), mode.rect.w - scaleUi(16)));
            const indicatorX = mode.rect.x + Math.floor((mode.rect.w - indicatorW) / 2);
            gr.FillSolidRect(indicatorX, mode.rect.y, indicatorW, scaleUi(3), colours.accent);
        }

        drawText(
            gr,
            mode.label,
            fonts.pivot,
            visual.text,
            mode.rect.x + scaleUi(5),
            mode.rect.y + scaleUi(2),
            Math.max(scaleUi(1), mode.rect.w - scaleUi(10)),
            Math.max(scaleUi(1), mode.rect.h - scaleUi(2)),
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX
        );
    }

    // Divider lines between each adjacent pair of tabs.
    for (let i = 1; i < modes.length; i++) {
        const dividerX = modes[i].rect.x;
        gr.FillSolidRect(dividerX, outer.y + scaleUi(5), scaleUi(1), Math.max(scaleUi(1), outer.h - scaleUi(10)), colours.rule);
    }
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
    const countText = String(row.count);
    const countW = scaleUi(40);
    drawText(gr, row.label.toUpperCase(), fonts.smallBold, colours.accent,
        PAD, y, Math.max(scaleUi(40), ww - PAD * 2 - countW), row.height,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    fillRoundRect(gr, ww - PAD - countW, y + Math.round((row.height - scaleUi(22)) / 2), countW, scaleUi(22), scaleUi(11), colours.control);
    drawText(gr, countText, fonts.tiny, colours.muted,
        ww - PAD - countW, y + Math.round((row.height - scaleUi(22)) / 2), countW, scaleUi(22),
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function paintReleaseItemRow(gr, row, index, y) {
    const item = row.item;
    const rowX = PAD;
    const rowY = y + scaleUi(1);
    const rowW = Math.max(scaleUi(80), ww - PAD * 2 - scaleUi(3));
    const rowH = Math.max(scaleUi(1), row.height - scaleUi(2));
    const dateW = ww < scaleUi(430) ? scaleUi(78) : scaleUi(96);

    if (index === hoverRow) {
        fillRoundRect(gr, rowX, rowY, rowW, rowH, scaleUi(3), colours.cardHover);
    }

    drawText(gr, item.date || '-', fonts.smallBold, colours.muted,
        rowX + scaleUi(8), rowY, dateW, rowH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    const titleX = rowX + scaleUi(12) + dateW;
    drawText(gr, item.title, fonts.normal, colours.text,
        titleX, rowY, Math.max(scaleUi(20), rowW - dateW - scaleUi(20)), rowH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    gr.DrawLine(rowX, y + row.height - scaleUi(1), rowX + rowW,
        y + row.height - scaleUi(1), scaleUi(1), colours.rule);
}

function paintItemRow(gr, row, index, y) {
    const item = row.item;
    const cardX = PAD;
    const cardY = y + scaleUi(4);
    const cardW = Math.max(scaleUi(80), ww - PAD * 2 - scaleUi(3));
    const cardH = row.height - scaleUi(8);
    const dateW = ww < scaleUi(430) ? scaleUi(72) : scaleUi(92);
    const badgeW = ww < scaleUi(480) ? scaleUi(82) : scaleUi(104);
    const titleX = cardX + scaleUi(16) + dateW;
    const titleW = Math.max(scaleUi(30), cardW - dateW - badgeW - scaleUi(48));
    const ownedColour = item.owned ? colours.present : colours.missing;
    const ownedSoft = item.owned ? colours.presentSoft : colours.missingSoft;
    const markerColour = row.kind === 'calendar' || item.bucket === 'upcoming' ? colours.upcoming : ownedColour;

    fillRoundRect(gr, cardX, cardY, cardW, cardH, scaleUi(7), index === hoverRow ? colours.cardHover : colours.card);
    fillRoundRect(gr, cardX, cardY, scaleUi(4), cardH, scaleUi(2), markerColour);

    drawText(gr, item.date || '-', fonts.smallBold,
        row.kind === 'calendar' || item.bucket === 'upcoming' ? colours.upcoming : colours.muted,
        cardX + scaleUi(14), cardY, dateW - scaleUi(10), cardH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    const titleY = compactRows ? cardY + scaleUi(4) : cardY + scaleUi(7);
    const titleH = compactRows ? scaleUi(22) : scaleUi(25);
    drawText(gr, item.title, fonts.bold, colours.text,
        titleX, titleY, titleW, titleH,
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    const secondLine = row.kind === 'calendar' ? item.artist + TYPE_SEPARATOR + item.type : item.type;
    drawText(gr, secondLine, fonts.small, colours.muted,
        titleX, cardY + cardH - scaleUi(25), titleW, scaleUi(20),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);

    const pillH = scaleUi(24);
    const pillX = cardX + cardW - badgeW - scaleUi(12);
    const pillY = cardY + Math.round((cardH - pillH) / 2);
    fillRoundRect(gr, pillX, pillY, badgeW, pillH, scaleUi(12), ownedSoft);
    drawText(gr, item.owned ? 'IN LIBRARY' : 'MISSING', fonts.tiny, ownedColour,
        pillX, pillY, badgeW, pillH,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
}

function paintHeader(gr) {
    // Floating bordered card with a left accent strip - the same header
    // style as playback-timeline_panel.js and playback_history_panel.js.
    const card = headerCardRect();
    painter.card(gr, card, {
        fill: colours.card,
        border: true,
        stroke: colours.rule,
        accent: true,
        accentColour: colours.accent
    });

    const insetX = PAD;
    const button = modeButtonRect();
    const title = viewMode === 'calendar' ? 'Upcoming releases' : (sourceArtist || 'Discography');
    const titleLeft = card.x + insetX;
    const titleRight = Math.max(titleLeft, button.x - scaleUi(12));
    drawText(gr, title, fonts.title, colours.accent, titleLeft, card.y + scaleUi(6),
        Math.max(scaleUi(20), titleRight - titleLeft), scaleUi(24),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
    paintModeButton(gr);

    const missing = viewMode === 'calendar' ? calendarStats.missing : artistStats.missing;
    drawText(gr, summaryLine(), fonts.normal, missing ? colours.missing : colours.muted,
        titleLeft, card.y + card.h - scaleUi(28), Math.max(scaleUi(20), card.x + card.w - insetX - titleLeft), scaleUi(22),
        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
}

function on_paint(gr) {
    libraryRebuildGate.runFromPaint();
    runPendingSourceRefresh();

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
            const firstVisible = rowIndexAtLocalY(scrollY);
            for (let i = Math.max(0, firstVisible); i < displayRows.length; i++) {
                const row = displayRows[i];
                const y = HEADER_H + row.top - scrollY;
                if (y > wh) break;
                if (row.kind === 'section') paintSectionRow(gr, row, y);
                else if (row.kind === 'release') paintReleaseItemRow(gr, row, i, y);
                else paintItemRow(gr, row, i, y);
            }
        } finally {
            gr.PopClip();
        }
    }

    if (contentHeight > viewportHeight()) {
        const trackY = HEADER_H + scaleUi(8);
        const trackH = Math.max(1, viewportHeight() - scaleUi(16));
        const thumbH = Math.max(scaleUi(28), Math.round(trackH * trackH / contentHeight));
        const travel = Math.max(1, trackH - thumbH);
        const thumbY = trackY + Math.round((scrollY / Math.max(1, maxScroll())) * travel);
        gr.FillSolidRect(Math.max(0, ww - scaleUi(4)), trackY, scaleUi(2), trackH, colours.scrollTrack);
        gr.FillSolidRect(Math.max(0, ww - scaleUi(5)), thumbY, scaleUi(3), thumbH, colours.accent);
    }

    paintHeader(gr);

    if (smoothingChanged) {
        try { gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT); } catch (e) {}
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

function isClickableItemRow(row) {
    return !!row && (row.kind === 'album' || row.kind === 'release' || row.kind === 'calendar');
}

function syncHoverFromPointer(repaint) {
    const nextModeTab = pointerInside ? modeAt(pointerX, pointerY) : '';
    const index = pointerInside && !nextModeTab ? rowAt(pointerX, pointerY) : -1;
    const clickable = index >= 0 && isClickableItemRow(displayRows[index]);
    const nextHover = clickable ? index : -1;
    const changed = nextModeTab !== hoverModeTab || nextHover !== hoverRow;

    hoverModeTab = nextModeTab;
    hoverRow = nextHover;
    window.SetCursor(nextModeTab || clickable ? IDC_HAND : IDC_ARROW);

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
    const hadState = hoverRow !== -1 || hoverModeTab || pressedModeTab;
    pointerInside = false;
    pressedModeTab = '';
    syncHoverFromPointer(false);
    if (hadState) window.Repaint();
}

function on_mouse_wheel(step) {
    if (!maxScroll()) return;
    const wheelDistance = viewMode === 'discography' ? RELEASE_ITEM_H * 4 : ITEM_H * 2;
    scrollY = clamp(scrollY - step * wheelDistance, 0, maxScroll());
    syncHoverFromPointer(false);
    window.Repaint();
}

function on_mouse_lbtn_down(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;
    const nextPressed = modeAt(x, y);
    if (nextPressed !== pressedModeTab) {
        pressedModeTab = nextPressed;
        if (pressedModeTab) window.Repaint();
    }
}

function on_mouse_lbtn_up(x, y) {
    pointerX = x;
    pointerY = y;
    pointerInside = true;

    const mode = modeAt(x, y);
    const pressed = pressedModeTab;
    pressedModeTab = '';

    if (pressed) {
        if (mode === pressed) activateMode(mode);
        syncHoverFromPointer(false);
        window.Repaint();
        return;
    }

    // Preserve the old release-on-mouse-up behavior for hosts that do not
    // deliver a matching button-down callback to this child panel.
    if (mode) {
        activateMode(mode);
        syncHoverFromPointer(false);
        window.Repaint();
        return;
    }

    const index = rowAt(x, y);
    if (index >= 0 && isClickableItemRow(displayRows[index])) {
        utils.Run(displayRows[index].item.url);
    }
}

// -----------------------------------------------------------------------------
// Shared settings registry
// -----------------------------------------------------------------------------


function primaryTypeSettingLabel(key) {
    var labels = { album: 'Include albums', single: 'Include singles', ep: 'Include EPs', broadcast: 'Include broadcasts', other: 'Include other primary types' };
    return labels[key] || 'Include release type';
}

function secondaryTypeSettingLabel(key) {
    var labels = {
        none: 'Include standard releases', compilation: 'Include compilations', soundtrack: 'Include soundtracks',
        spokenword: 'Include spoken word', interview: 'Include interviews', audiobook: 'Include audiobooks',
        audio_drama: 'Include audio dramas', live: 'Include live releases', remix: 'Include remixes',
        dj_mix: 'Include DJ mixes', mixtape_street: 'Include mixtape or street releases', demo: 'Include demos',
        field_recording: 'Include field recordings', other: 'Include other or unknown secondary types'
    };
    return labels[key] || 'Include secondary type';
}

function getDiscographySettings() {
    const settings = [
        {
            id: 'viewMode', label: 'View', type: 'choice', value: viewMode,
            section: 'Options',
            choiceValueType: 'string',
            choices: [
                { value: 'artist', label: 'Catch up' },
                { value: 'discography', label: 'All releases' },
                { value: 'calendar', label: 'Upcoming releases' }
            ]
        },
        {
            id: 'accentMode', label: 'Accent colour', type: 'choice', value: accentMode,
            section: 'Options',
            choiceValueType: 'string',
            choices: [
                { value: 'shared', label: RivageUI.copy.labels.sharedAccent },
                { value: 'fixed', label: RivageUI.copy.labels.rvgBlue },
                { value: 'host', label: 'foobar2000 accent' }
            ]
        },
        { id: 'compactRows', label: 'Use compact release rows', type: 'bool', value: compactRows, section: 'Options' },
        {
            id: 'calendarHorizon', label: 'Calendar range', type: 'choice', value: calendarHorizonDays,
            section: 'Options',
            choiceValueType: 'number',
            choices: [
                { value: 180, label: 'Next 6 months' },
                { value: 365, label: 'Next year' },
                { value: 730, label: 'Next 2 years' }
            ]
        },
        { id: 'cacheDays', label: 'MusicBrainz cache duration (days)', type: 'number', value: cacheDays, min: 1, max: 30, step: 1, hint: 'How long MusicBrainz responses are kept before they are refreshed. Default 30 days.', section: 'Options' },
        {
            id: 'calendarNameFallback', label: 'Calendar: also query artists without MusicBrainz IDs',
            type: 'bool', value: calendarIncludeUntaggedArtists, section: 'Options',
            hint: 'Adds a name-based query for library artists whose tags carry no MusicBrainz artist ID. More complete, but more requests the first time.'
        }
    ];

    for (let i = 0; i < PRIMARY_TYPE_DEFS.length; i++) {
        const def = PRIMARY_TYPE_DEFS[i];
        settings.push({
            id: 'primary_' + def.key,
            label: primaryTypeSettingLabel(def.key),
            type: 'bool',
            value: !!releaseTypeFilters.primary[def.key],
            section: 'Primary release types'
        });
    }

    for (let i = 0; i < SECONDARY_TYPE_DEFS.length; i++) {
        const def = SECONDARY_TYPE_DEFS[i];
        settings.push({
            id: 'secondary_' + def.key,
            label: secondaryTypeSettingLabel(def.key),
            type: 'bool',
            value: !!releaseTypeFilters.secondary[def.key],
            section: 'Secondary release types'
        });
    }

    settings.push(
        { id: 'debugVersion', label: 'Panel version', type: 'info', value: PANEL_VERSION, section: 'Diagnostics' },
        {
            id: 'debugStatus', label: 'Current panel status', type: 'info',
            value: statusText + (statusIsError ? ' [error]' : ''), section: 'Diagnostics'
        },
        {
            id: 'debugDiagnosis', label: 'Why this result?', type: 'info',
            value: diagnoseCurrentState(), section: 'Diagnostics'
        },
        {
            id: 'debugArtistIdentity', label: 'Artist identity', type: 'info',
            value: describeArtistIdentityDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugArtistCache', label: 'Artist cache', type: 'info',
            value: describeArtistCacheDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugArtistPipeline', label: 'Artist release pipeline', type: 'info',
            value: describeArtistPipelineDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugCalendarScope', label: 'Calendar query scope', type: 'info',
            value: describeCalendarScopeDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugCalendarCache', label: 'Calendar cache', type: 'info',
            value: describeCalendarCacheDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugCalendarPipeline', label: 'Calendar release pipeline', type: 'info',
            value: describeCalendarPipelineDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugLibrary', label: 'Library index', type: 'info',
            value: describeLibraryDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugNetwork', label: 'MusicBrainz network', type: 'info',
            value: describeNetworkDebug(), section: 'Diagnostics'
        },
        {
            id: 'debugCachePath', label: 'Cache location', type: 'info',
            value: CACHE_DIR, section: 'Diagnostics'
        }
    );

    return settings;
}

function findTypeDefBySettingId(prefix, settingId, defs) {
    if (settingId.indexOf(prefix) !== 0) return null;
    const key = settingId.substring(prefix.length);
    for (let i = 0; i < defs.length; i++) {
        if (defs[i].key === key) return defs[i];
    }
    return null;
}

function applyDiscographySetting(settingId, value) {
    let def;
    let next;

    switch (settingId) {
        case 'viewMode':
            activateMode(normalizeViewMode(value));
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
        case 'compactRows':
            next = !!value;
            if (next === compactRows) return;
            window.SetProperty(PROP + 'Compact rows', next);
            compactRows = next;
            updateTheme();
            window.Repaint(true);
            return;
        case 'calendarHorizon':
            setCalendarHorizon(Number(value));
            return;
        case 'cacheDays':
            next = clamp(Math.round(Number(value) || 1), 1, 30);
            if (next === cacheDays) return;
            window.SetProperty(PROP + 'Cache days', next);
            cacheDays = next;
            return;
        case 'calendarNameFallback':
            next = !!value;
            if (next === calendarIncludeUntaggedArtists) return;
            window.SetProperty(PROP + 'Calendar name fallback', next);
            calendarIncludeUntaggedArtists = next;
            calendarLibraryChanged();
            return;
    }

    def = findTypeDefBySettingId('primary_', settingId, PRIMARY_TYPE_DEFS);
    if (def) {
        next = !!value;
        if (next === releaseTypeFilters.primary[def.key]) return;
        const nextFilters = cloneReleaseTypeFilters(releaseTypeFilters);
        nextFilters.primary[def.key] = next;
        saveReleaseTypeFilters(nextFilters);
        releaseTypeFilters = nextFilters;
        refreshAfterReleaseTypeChange();
        return;
    }

    def = findTypeDefBySettingId('secondary_', settingId, SECONDARY_TYPE_DEFS);
    if (def) {
        next = !!value;
        if (next === releaseTypeFilters.secondary[def.key]) return;
        const nextFilters = cloneReleaseTypeFilters(releaseTypeFilters);
        nextFilters.secondary[def.key] = next;
        saveReleaseTypeFilters(nextFilters);
        releaseTypeFilters = nextFilters;
        refreshAfterReleaseTypeChange();
    }
}

// -----------------------------------------------------------------------------
// Context menu
// -----------------------------------------------------------------------------

function promptArtistOverride() {
    if (!sourceArtistKey) return;
    const current = extractUuid(artistOverrides[sourceArtistKey] && artistOverrides[sourceArtistKey].mbid) || artistMbid;
    let entered;
    try {
        entered = utils.InputBox(
            window.ID,
            'Enter a MusicBrainz artist ID or artist URL for:\n\n' + sourceArtist,
            RivageUI.copy.popupTitle('Discography'),
            current,
            true,
            'https://musicbrainz.org/search?query=' + encodeURIComponent(sourceArtist) + '&type=artist&method=indexed'
        );
    } catch (e) {
        return;
    }

    const mbid = extractUuid(entered);
    if (!mbid) {
        statusText = 'The entered value does not contain a valid MusicBrainz artist ID.';
        statusIsError = true;
        window.Repaint();
        return;
    }

    try {
        artistOverrides = persistObjectEntry(PROP + 'Artist MBID overrides', artistOverrides, sourceArtistKey, {
            mbid: mbid,
            name: sourceArtist,
            comment: 'manual artist override'
        });
    } catch (e2) {
        reportCallbackError('artist override save', e2);
        return;
    }
    rebuildLibraryIndex();
    refreshSource(true);
}

function callbackErrorText(error) {
    if (!error) return 'Unknown error';
    if (error.stack) return String(error.stack);
    if (error.message) return String(error.message);
    return String(error);
}

function reportCallbackError(where, error) {
    const text = 'Discography ' + where + ' error:\n\n' + callbackErrorText(error);
    try {
        console.log(text);
    } catch (e) {
        // Logging is optional.
    }
    try {
        fb.ShowPopupMessage(text, RivageUI.copy.popupTitle('Discography'));
    } catch (e) {
        // Do not allow error reporting to trigger another panel exception.
    }
}

function refreshAfterReleaseTypeChange() {
    if (viewMode === 'calendar') {
        // Calendar queries no longer carry a type clause, so type filters are a
        // local re-filter and never a query-scope change.
        processCalendarReleaseGroups();
    } else if (viewMode === 'artist') {
        // RELEASES intentionally ignores these filters, so changing them
        // while that tab is active does not rebuild or alter its rows.
        processReleaseGroups();
    }
}

function handleMainMenuCommand(id, clickedItem) {
    switch (id) {
        case 1:
            forceRefreshArtist();
            break;
        case 2:
            rebuildLibraryIndex();
            break;
        case 3:
            utils.Run(SITE_ROOT + '/artist/' + artistMbid);
            break;
        case 4:
            if (clickedItem) utils.Run(clickedItem.url);
            break;
        case 7:
            if (clickedItem) {
                utils.Run('https://redacted.sh/torrents.php?action=advanced&groupname=' + encodeURIComponent(releaseSearchQuery(clickedItem)));
            }
            break;
        case 8:
            if (clickedItem) {
                utils.Run('https://orpheus.network/torrents.php?searchstr=' + encodeURIComponent(releaseSearchQuery(clickedItem)));
            }
            break;
        case 5:
            activateCalendarMode(true);
            break;
        case 6:
            if (calendarRun) {
                cancelNetworkWork();
                collectCalendarRows();
                processCalendarReleaseGroups();
                statusText = 'Calendar refresh stopped; the groups already fetched are kept and displayed.';
                statusIsError = false;
                window.Repaint();
            }
            break;
        case 20:
            promptArtistOverride();
            break;
        case 21:
            artistOverrides = persistObjectEntry(
                PROP + 'Artist MBID overrides', artistOverrides, sourceArtistKey, undefined
            );
            rebuildLibraryIndex();
            refreshSource(true);
            break;
        case 22:
            artistResolutions = persistObjectEntry(
                PROP + 'Artist MBID resolutions', artistResolutions, sourceArtistKey, undefined
            );
            artistMbid = '';
            rebuildLibraryIndex();
            refreshSource(true);
            break;
    }
}

// Shared by the Redacted/Orpheus context-menu searches: reuses
// libraryDescriptorForReleaseItem()'s artist resolution, joined with the
// release title so the query is "artist album", not just the album title alone.
function releaseSearchQuery(item) {
    const descriptor = libraryDescriptorForReleaseItem(item);
    if (!descriptor) return '';
    return (descriptor.artist + ' ' + descriptor.album).replace(/\s+/g, ' ').trim();
}

function libraryDescriptorForReleaseItem(item) {
    if (!item) return null;
    const artist = viewMode === 'calendar'
        ? (item.libraryArtist || item.artist || '')
        : (resolvedArtistName || sourceArtist || '');
    return {
        type: 'album',
        artist: artist,
        album: item.title || '',
        releaseGroupMbid: item.id || '',
        url: item.url || ''
    };
}

function on_mouse_rbtn_up(x, y) {
    try {
        const rowIndex = rowAt(x, y);
        const clickedItem = rowIndex >= 0 && isClickableItemRow(displayRows[rowIndex])
            ? displayRows[rowIndex].item
            : null;

        // Settings registered in the shared SETTINGS panel are deliberately not
        // duplicated here. This menu contains operational and contextual commands only.
        const menu = window.CreatePopupMenu();
        const libraryState = clickedItem
            ? RivageLibraryActions.append(menu, libraryDescriptorForReleaseItem(clickedItem), { separator: false, webLabel: 'Open on MusicBrainz' })
            : null;
        if (libraryState) menu.AppendMenuSeparator();

        menu.AppendMenuItem(isArtistLikeMode(viewMode) && sourceArtist ? MF_STRING : MF_GRAYED, 1, 'Refresh artist discography');
        menu.AppendMenuItem(viewMode === 'calendar' ? MF_STRING : MF_GRAYED, 5, 'Refresh release calendar');
        menu.AppendMenuItem(calendarRun ? MF_STRING : MF_GRAYED, 6, 'Cancel calendar refresh');
        menu.AppendMenuItem(MF_STRING, 2, 'Rebuild library index');
        menu.AppendMenuSeparator();

        menu.AppendMenuItem(isArtistLikeMode(viewMode) && artistMbid ? MF_STRING : MF_GRAYED, 3, 'Open artist on MusicBrainz');
        menu.AppendMenuItem(clickedItem ? MF_STRING : MF_GRAYED, 4, 'Open this release group');
        if (clickedItem) {
            menu.AppendMenuItem(MF_STRING, 7, 'Search on Redacted');
            menu.AppendMenuItem(MF_STRING, 8, 'Search on Orpheus');
        }
        menu.AppendMenuSeparator();

        menu.AppendMenuItem(isArtistLikeMode(viewMode) && sourceArtist ? MF_STRING : MF_GRAYED, 20, 'Set MusicBrainz artist ID…');
        menu.AppendMenuItem(isArtistLikeMode(viewMode) && sourceArtistKey && artistOverrides[sourceArtistKey] ? MF_STRING : MF_GRAYED, 21, 'Clear artist ID override');
        menu.AppendMenuItem(isArtistLikeMode(viewMode) && sourceArtistKey && artistResolutions[sourceArtistKey] ? MF_STRING : MF_GRAYED, 22, 'Forget matched MusicBrainz artist');

        const id = menu.TrackPopupMenu(x, y);
        if (!RivageLibraryActions.handle(libraryState, id)) handleMainMenuCommand(id, clickedItem);
    } catch (e) {
        reportCallbackError('context menu', e);
    }

    return true;
}

// -----------------------------------------------------------------------------
// JSplitter / foobar2000 callbacks
// -----------------------------------------------------------------------------

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        updateTheme();
        SharedThemeProtocol.requestRepaint();
    })) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getDiscographySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyDiscographySetting)) return;
    if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

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

function on_item_focus_change() {
    if (TrackContext.followsSelection()) requestSourceRefresh();
}

function on_playlist_switch() {
    if (TrackContext.followsSelection()) requestSourceRefresh();
}

// JSplitter has no visibility-change callback; heavy hidden work is resumed from paint.
let pendingSourceRefresh = false;

function requestSourceRefresh() {
    if (!isArtistLikeMode(viewMode)) return;

    if (!VisiblePaintWork.isVisible()) {
        pendingSourceRefresh = true;
        return;
    }

    pendingSourceRefresh = false;
    refreshSource(false);
}

function runPendingSourceRefresh() {
    if (!pendingSourceRefresh) return;
    pendingSourceRefresh = false;
    if (isArtistLikeMode(viewMode)) refreshSource(false);
}

function on_playback_new_track() {
    if (TrackContext.followsPlayback()) requestSourceRefresh();
}

function on_playback_dynamic_info_track() {
    if (TrackContext.followsPlayback()) requestSourceRefresh();
}

function on_playback_stop(reason) {
    if (reason === 2) return;
    if (TrackContext.effectiveMode() === TrackContext.MODE_SELECTION && !TrackContext.followsPlayback()) return;
    requestSourceRefresh();
}

function on_metadb_changed(handle_list) {
    try {
        const handle = TrackContext.getHandle();
        if (handle && handle_list && typeof handle_list.Find === 'function' && handle_list.Find(handle) < 0) return;
    } catch (e) { }
    requestSourceRefresh();
}

function on_library_items_added() {
    scheduleLibraryRebuild();
}

function on_library_items_changed() {
    scheduleLibraryRebuild();
}

function on_library_items_removed() {
    scheduleLibraryRebuild();
}

// -----------------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------------

function runInitialContentLoad() {
    if (!initialLoadPending || !scriptActive) return;
    initialLoadPending = false;
    if (viewMode === 'calendar') loadCalendar(false);
    else {
        pendingSourceRefresh = false;
        refreshSource(false);
    }
}

function on_script_unload() {
    scriptActive = false;
    initialLoadPending = false;
    pendingSourceRefresh = false;
    libraryTimerGeneration++;
    libraryRetryGeneration++;
    generation++;
    clearTimer(initTimer);
    clearTimer(libraryTimer);
    clearTimer(libraryRetryTimer);
    clearTimer(requestTimer);
    initTimer = 0;
    libraryTimer = 0;
    libraryRetryTimer = 0;
    requestTimer = 0;
    requestQueue = [];
    requestContexts.clear();
    activeFetch = null;
    calendarRun = null;
    saveCalendarCacheFile(true);
}

updateTheme();
SharedAccentProtocol.request();
TrackContext.onChange(function () { requestSourceRefresh(); });
TrackContext.requestSync();
try {
    utils.CreateFolder(CACHE_DIR);
} catch (e) { reportFailure('the cache folder could not be created', e); }

initTimer = window.SetTimeout(function () {
    initTimer = 0;
    if (!scriptActive) return;
    requestLibraryRebuild('initial', true);
}, 1);
