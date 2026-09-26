'use strict';
window.DrawMode = 0;

// Quick switcher. A hidden TopMost child of the root splitter (caption QUICK
// SWITCHER, see QUICK_SWITCHER_SETUP.md): type to find an artist, album, track,
// playlist or command and act on it without leaving the keyboard.
//
// Self-contained on purpose: removing this panel from the layout removes the
// feature. JSplitter does not run a hidden panel's script until it is first
// shown, so the always-loaded root splitter owns the main-menu command and the
// toggle; this script learns it is open from STATE, or from being visible at load.
//
// JSplitter cannot move keyboard focus into a panel, so after opening from a
// shortcut the search box asks for one click; opening from a button does too.
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\miniplayer_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\quick_switcher_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\listening_history_index.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\power_mode.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\playback_stats_source.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\rediscover_score.js');

const PANEL_VERSION = '1.9.0';
window.DefineScript(RivageUI.copy.popupTitle('Quick switcher'), {
    author: 'RivaGe',
    version: PANEL_VERSION,
    features: { drag_n_drop: false, grab_focus: true }
});
window.EraseOnRepaint = false;
// Without this Windows' dialog navigation takes Tab (and can take Enter/Esc/arrows)
// and moves focus to the next control instead of delivering on_key_down.
const DLGC_WANTALLKEYS = 0x0004;
window.DlgCode = DLGC_WANTALLKEYS;

const DT_LEFT = 0x0, DT_CENTER = 0x1, DT_RIGHT = 0x2, DT_VCENTER = 0x4, DT_SINGLELINE = 0x20;
const DT_NOPREFIX = 0x800, DT_END_ELLIPSIS = 0x8000;
const TEXT = DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;
const MF_STRING = 0x0, MF_SEPARATOR = 0x800;
const VK = { back: 8, tab: 9, enter: 13, shift: 16, ctrl: 17, esc: 27, pgup: 33, pgdn: 34, end: 35, home: 36,
    left: 37, up: 38, right: 39, down: 40, del: 46, a: 65, v: 86 };
const IDC_ARROW = 32512, IDC_HAND = 32649, IDC_IBEAM = 32513;
const DEFAULT_UWP_ACCENT = 0xff0078d4;

const PROP = 'RVG.QuickSwitcher.';
const RECENT_MAX = 8;
const THUMB_CACHE_MAX = 160;
const TRACE = !!window.GetProperty(PROP + 'Trace timings', false);

// Segoe Fluent Icons / MDL2 codepoints.
const GLYPH = {
    search: '\uE721', artist: '\uE77B', album: '\uE93C', track: '\uEC4F', playlist: '\uE8FD',
    command: '\uE756', play: '\uE768', pause: '\uE769', next: '\uE893', prev: '\uE892', stop: '\uE71A',
    shuffle: '\uE8B1', queue: '\uE710', show: '\uE890', mini: '\uE73F', settings: '\uE713',
    clear: '\uE74D', console: '\uE756', find: '\uE721', chevron: '\uE76C', back: '\uE72B', timer: '\uE916'
};

const reported = {};
function reportFailure(what, err) {
    const text = '[RVG Quick switcher] ' + what + (err === undefined ? '' : ': ' + err);
    if (reported[text]) return;
    reported[text] = true;
    try { console.log(text); } catch (e) { }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------------
// Theme and metrics

let ww = 0, wh = 0;
let uiScale = 1;
let fontKey = '';
const fonts = {};
const colours = {};
let sharedAlbumAccent = DEFAULT_UWP_ACCENT;
const iconFamily = RivageUI.iconFontFamily();
let M = {};

function S(v) { return Math.max(1, Math.round(v * uiScale)); }

function updateTheme(force) {
    const host = RivageUI.hostInfo();
    const name = host && host.fontFamily ? String(host.fontFamily) : 'Segoe UI';
    const size = Math.max(9, host && Number(host.scaleFontSize) > 0 ? Number(host.scaleFontSize) : 12);
    const key = name.toLowerCase() + '|' + size;
    const resolved = RivageUI.createTheme({ mode: 'host', accent: sharedAlbumAccent || DEFAULT_UWP_ACCENT });

    colours.background = resolved.background;
    colours.card = resolved.card;
    colours.text = resolved.textPrimary;
    colours.muted = resolved.textMuted;
    colours.faint = resolved.textTertiary;
    colours.rule = resolved.separator;
    colours.accent = SharedAccentProtocol.opaque(resolved.accent);
    colours.accentSoft = RivageUI.withAlpha(colours.accent, 58);
    colours.row = RivageUI.withAlpha(resolved.textPrimary, 16);
    colours.rim = RivageUI.withAlpha(resolved.textPrimary, 36);
    colours.dark = !!resolved.dark;

    if (force || key !== fontKey) {
        fontKey = key;
        uiScale = clamp(size / 12, 0.82, 2);
        RivageUI.clearFontCache();
        fonts.query = RivageUI.font(name, Math.round(size * 1.3), 0);
        fonts.title = RivageUI.font(name, Math.round(size * 1.08), 0);
        fonts.sub = RivageUI.font(name, Math.max(8, size - 1), 0);
        fonts.section = RivageUI.font(name, Math.max(8, size - 2), 1);
        fonts.chip = RivageUI.font(name, Math.max(8, size - 1), 0);
        fonts.hint = RivageUI.font(name, Math.max(8, size - 2), 0);
        fonts.icon = RivageUI.font(iconFamily, Math.round(size * 1.15), 0);
        fonts.iconSmall = RivageUI.font(iconFamily, Math.max(8, size - 2), 0);
        M = {
            w: S(640), pad: S(16), searchH: S(52), chipsH: S(36), footH: S(32),
            rowH: S(46), sectionH: S(28), thumb: S(34), radius: S(8), gap: S(12), visibleRows: 9
        };
        thumbCache.clear();
    }
}

function preferredHeight() {
    return M.searchH + M.chipsH + M.visibleRows * M.rowH + M.sectionH * 2 + M.footH + S(8);
}

// ---------------------------------------------------------------------------
// Library index (built on first open, rebuilt on the next open after a change)

const TF_INDEX = fb.TitleFormat('[%album artist%]\u001f[%album%]\u001f[$left(%date%,4)]\u001f[%title%]\u001f[%artist%]\u001f[%length_seconds%]');
const TF_ORDER = fb.TitleFormat('%album artist%|%date%|%album%|%discnumber%|%tracknumber%|%title%');

let index = null;           // { handles, artists[], albums[], tracks[], byRaw }
let indexDirty = true;
let indexing = false;
// The index is dropped this long after closing; the next open rebuilds it.
const INDEX_KEEP_MS = 120000;
let releaseTimer = 0;

function releaseIndex() {
    releaseTimer = 0;
    if (open) return;
    index = null;
    indexDirty = true;
}

function fold(text) {
    let s = String(text || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036F]/g, ''); } catch (e) { }
    return s;
}

function rawKey(handle) {
    try { return handle.RawPath + '|' + handle.SubSong; } catch (e) { return ''; }
}

function buildIndex() {
    const t0 = Date.now();
    const handles = fb.GetLibraryItems();
    const t1 = Date.now();
    const rows = TF_INDEX.EvalWithMetadbs(handles);
    const t2 = Date.now();
    const count = handles.Count;
    const artistMap = new Map();
    const albumMap = new Map();
    const tracks = new Array(count);
    const byRaw = new Map();

    for (let i = 0; i < count; i++) {
        const f = String(rows[i]).split('\u001f');
        const albumArtist = f[0] || f[4] || '';
        const album = f[1];
        const title = f[3] || '';
        const trackArtist = f[4] || albumArtist;
        const seconds = Number(f[5]) || 0;

        tracks[i] = { kind: 'track', i: i, title: title, fold: fold(title), artist: trackArtist,
            album: album, seconds: seconds, albumKey: '' };

        if (albumArtist) {
            const ak = fold(albumArtist);
            let a = artistMap.get(ak);
            if (!a) {
                a = { kind: 'artist', key: ak, title: albumArtist, fold: ak, items: [], albums: 0 };
                artistMap.set(ak, a);
            }
            a.items.push(i);
        }
        if (album) {
            const bk = fold(albumArtist) + '\u0001' + fold(album);
            let b = albumMap.get(bk);
            if (!b) {
                b = { kind: 'album', key: bk, title: album, fold: fold(album), artist: albumArtist,
                    year: f[2] || '', items: [], seconds: 0 };
                albumMap.set(bk, b);
                const owner = artistMap.get(fold(albumArtist));
                if (owner) owner.albums++;
            }
            b.items.push(i);
            b.seconds += seconds;
            tracks[i].albumKey = bk;
        }
    }
    const t3 = Date.now();
    // byRaw (path -> track) is filled lazily by trackIndexByRaw(), only once a
    // recent track or the now-playing badge actually needs it.
    const artists = Array.from(artistMap.values());
    const albums = Array.from(albumMap.values());

    index = { handles: handles, artists: artists, albums: albums, tracks: tracks, byRaw: byRaw,
        artistMap: artistMap, albumMap: albumMap };
    indexDirty = false;
    console.log('[RVG Quick switcher] indexed ' + count + ' tracks, ' + artists.length + ' artists, ' +
        albums.length + ' albums in ' + (Date.now() - t0) + ' ms (library ' + (t1 - t0) +
        ' ms, tags ' + (t2 - t1) + ' ms, grouping ' + (t3 - t2) + ' ms)');
}

function trackIndexByRaw(key) {
    if (!index) return -1;
    if (!index.byRaw.size) {
        for (let i = 0; i < index.tracks.length; i++) index.byRaw.set(rawKey(index.handles[i]), i);
    }
    const i = index.byRaw.get(key);
    return i === undefined ? -1 : i;
}

function handlesFor(entry, ordered) {
    const list = new FbMetadbHandleList();
    const items = entry.kind === 'track' ? [entry.i] : entry.items;
    for (let i = 0; i < items.length; i++) list.Add(index.handles[items[i]]);
    if (ordered !== false && list.Count > 1) {
        try { list.OrderByFormat(TF_ORDER, 1); } catch (e) { reportFailure('sorting failed', e); }
    }
    return list;
}

// ---------------------------------------------------------------------------
// Commands

function nowPlayingLocation() {
    try {
        const loc = plman.GetPlayingItemLocation();
        return loc && loc.IsValid ? loc : null;
    } catch (e) { return null; }
}

const COMMANDS = [
    { id: 'play_pause', title: 'Play or pause', sub: 'Playback', glyph: GLYPH.play, run: function () { fb.PlayOrPause(); } },
    { id: 'next', title: 'Next track', sub: 'Playback', glyph: GLYPH.next, run: function () { fb.Next(); } },
    { id: 'previous', title: 'Previous track', sub: 'Playback', glyph: GLYPH.prev, run: function () { fb.Prev(); } },
    { id: 'stop', title: 'Stop', sub: 'Playback', glyph: GLYPH.stop, run: function () { fb.Stop(); } },
    { id: 'random', title: 'Play a random track', sub: 'Playback', glyph: GLYPH.shuffle, run: function () { fb.Random(); } },
    { id: 'stop_after', title: 'Stop after current track', sub: 'Playback', glyph: GLYPH.timer,
        state: function () { return fb.StopAfterCurrent ? 'on' : ''; },
        run: function () { fb.StopAfterCurrent = !fb.StopAfterCurrent; } },
    { id: 'show_playing', title: 'Show now playing in playlist', sub: 'Playlist', glyph: GLYPH.show, run: function () {
        const loc = nowPlayingLocation();
        if (!loc) return;
        plman.ActivePlaylist = loc.PlaylistIndex;
        plman.ClearPlaylistSelection(loc.PlaylistIndex);
        plman.SetPlaylistSelectionSingle(loc.PlaylistIndex, loc.PlaylistItemIndex, true);
        plman.SetPlaylistFocusItem(loc.PlaylistIndex, loc.PlaylistItemIndex);
    } },
    { id: 'clear_queue', title: 'Clear playback queue', sub: 'Queue', glyph: GLYPH.clear,
        state: function () {
            let n = 0;
            try { n = plman.GetPlaybackQueueHandles().Count; } catch (e) { n = 0; }
            return n ? n + ' queued' : '';
        },
        run: function () { plman.FlushPlaybackQueue(); } },
    { id: 'health', title: 'Run health check', sub: 'RVG', glyph: GLYPH.settings,
        run: function () { window.NotifyOthers('RIVAGE.HEALTH.OPEN.V1', 0); } },
    { id: 'low_power', title: 'Toggle low-power mode', sub: 'RVG', glyph: GLYPH.settings,
        state: function () { return RivagePowerMode.isLow() ? 'on' : ''; },
        run: function () { RivagePowerMode.request(!RivagePowerMode.isLow()); } },
    { id: 'mini', title: 'Enter Mini Player', sub: 'Window', glyph: GLYPH.mini, run: function () { MiniPlayerProtocol.requestEnter(); } },
    { id: 'settings', title: 'Show or hide RVG Settings', sub: 'RVG', glyph: GLYPH.settings,
        run: function () { window.NotifyOthers('RIVAGE.TOGGLE_PANEL_VISIBILITY', { caption: 'SETTINGS' }); } },
    { id: 'library_search', title: 'Search library (foobar2000)', sub: 'Library', glyph: GLYPH.find,
        run: function () { fb.RunMainMenuCommand('Library/Search'); } },
    { id: 'preferences', title: 'Open preferences', sub: 'foobar2000', glyph: GLYPH.settings, run: function () { fb.ShowPreferences(); } },
    { id: 'console', title: 'Open console', sub: 'foobar2000', glyph: GLYPH.console, run: function () { fb.ShowConsole(); } },
    { id: 'rediscover_mix', title: 'Rediscover: play forgotten favourites', sub: 'Library', glyph: GLYPH.shuffle,
        run: function () { RivageRediscover.playMix(); } },
    { id: 'rewind_measure', title: 'Rewind: measure listening history', sub: 'Diagnostics', glyph: GLYPH.timer,
        state: function () { return rewindMeasureJob ? 'running' : ''; },
        run: function () { measureListeningHistory(); } }
];
for (let i = 0; i < COMMANDS.length; i++) {
    COMMANDS[i].kind = 'command';
    COMMANDS[i].key = COMMANDS[i].id;
    COMMANDS[i].fold = fold(COMMANDS[i].title);
}
const SUGGESTED = ['mini', 'show_playing', 'random'];

// Diagnostics for Rewind: how long reading every track's play history takes, for
// local plays and Last.fm scrobbles, plus a sample summary to check the numbers
// against. Results go to the console.
let rewindMeasureJob = null;

function measureListeningHistory() {
    if (rewindMeasureJob) return;
    const sources = [RivageListeningIndex.SOURCE_LOCAL, RivageListeningIndex.SOURCE_LASTFM];
    const say = function (text) { try { console.log('[RVG Rewind] ' + text); } catch (e) { } };
    const ms = function (value) { return Math.round(value).toLocaleString() + ' ms'; };
    const day = function (time) {
        const d = new Date(time);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    };
    const dayFromNumber = function (n) {
        return Math.floor(n / 10000) + '-' + ('0' + (Math.floor(n / 100) % 100)).slice(-2) + '-' + ('0' + (n % 100)).slice(-2);
    };
    const list = function (entries) {
        return entries.length ? entries.map(function (e) { return e.label + ' (' + e.plays + ')'; }).join(', ') : '-';
    };

    fb.ShowConsole();
    say('measuring - foobar2000 may pause while the library is read');

    const next = function (i) {
        if (i >= sources.length) { rewindMeasureJob = null; say('done'); return; }
        const source = sources[i];
        rewindMeasureJob = RivageListeningIndex.build({ source: source }, {
            onError: function (message) { say(source + ': ' + message); next(i + 1); },
            onDone: function (index) {
                const t = index.timings;
                const n = index.eventTimes.length;
                say(source + ': ' + index.libraryCount.toLocaleString() + ' library tracks, ' +
                    index.tracks.length.toLocaleString() + ' with plays, ' + n.toLocaleString() + ' plays' +
                    (n ? ' (' + day(index.eventTimes[0]) + ' to ' + day(index.eventTimes[n - 1]) + ')' : ''));
                say(source + ' timings: library ' + ms(t.read) + ', play times read ' + ms(t.evalTimes) +
                    ', tags read ' + ms(t.evalMeta) + ' (both blocking); parse ' + ms(t.parse) +
                    ' (in slices), sort ' + ms(t.sort) + '; total ' + ms(t.total));
                if (!n) {
                    say(source + ': no plays found. Local plays need Enhanced Playback Statistics; ' +
                        'Last.fm scrobbles need its Last.fm import.');
                    next(i + 1);
                    return;
                }
                const to = Date.now();
                const started = Date.now();
                const year = RivageListeningIndex.summarise(index, to - 365 * 86400000, to, 5);
                const summaryMs = Date.now() - started;
                say(source + ', last 365 days (summarised in ' + ms(summaryMs) + '): ' + year.plays.toLocaleString() +
                    ' plays, ~' + Math.round(year.listeningHours).toLocaleString() + ' h, ' +
                    year.activeDays + ' active days, longest streak ' + year.longestStreak.days + ' days' +
                    (year.busiestDay ? ', busiest day ' + dayFromNumber(year.busiestDay.day) + ' (' + year.busiestDay.plays + ' plays)' : ''));
                say('  top artists: ' + list(year.topArtists));
                say('  top albums: ' + list(year.topAlbums));
                say('  top tracks: ' + list(year.topTracks));
                say('  new artists this year: ' + list(year.discoveries));
                next(i + 1);
            }
        });
    };
    next(0);
}

function playlistEntries() {
    const out = [];
    const active = plman.ActivePlaylist;
    for (let p = 0; p < plman.PlaylistCount; p++) {
        let name;
        try { name = plman.GetPlaylistName(p); } catch (e) { continue; }
        if (RivageLibraryActions.isInternalPlaylistName(name)) continue;
        out.push({ kind: 'playlist', key: name, index: p, title: name, fold: fold(name),
            count: plman.PlaylistItemCount(p), active: p === active });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Search

const SCOPES = [
    { id: 'all', label: 'All' }, { id: 'artist', label: 'Artists' }, { id: 'album', label: 'Albums' },
    { id: 'track', label: 'Tracks' }, { id: 'playlist', label: 'Playlists' }, { id: 'command', label: 'Commands' }
];
const PREFIX = { '>': 'command', '@': 'artist', '#': 'album', '/': 'playlist' };
const SECTION = { artist: 'Artists', album: 'Albums', track: 'Tracks', playlist: 'Playlists', command: 'Commands' };
const GROUP_LIMIT = { artist: 4, album: 4, track: 5, playlist: 3, command: 3 };
const SCOPED_LIMIT = 40;

// Word-start / substring scoring on one folded field; 0 = no match.
function scoreText(foldText, q, words) {
    if (!q) return 0;
    const at = foldText.indexOf(q);
    if (at === 0) return 1000 - Math.min(200, foldText.length);
    if (at > 0) {
        const wordStart = /[\s\-_.,:;/&()+'"]/.test(foldText[at - 1]);
        return (wordStart ? 700 : 400) - Math.min(200, at);
    }
    if (words.length < 2) return 0;
    for (let i = 0; i < words.length; i++) if (foldText.indexOf(words[i]) < 0) return 0;
    return 300;
}

function markRanges(title, q, words) {
    const f = fold(title);
    if (f.length !== title.length || !q) return [];
    const ranges = [];
    const parts = f.indexOf(q) >= 0 ? [q] : words;
    for (let i = 0; i < parts.length; i++) {
        const at = f.indexOf(parts[i]);
        if (at >= 0 && parts[i]) ranges.push([at, at + parts[i].length]);
    }
    return ranges;
}

function TopK(limit) {
    this.limit = limit;
    this.items = [];
}
TopK.prototype.add = function (entry, score) {
    const items = this.items;
    if (items.length >= this.limit && score <= items[items.length - 1].score) return;
    let i = items.length;
    while (i > 0 && items[i - 1].score < score) i--;
    items.splice(i, 0, { entry: entry, score: score });
    if (items.length > this.limit) items.pop();
};

function search(rawQuery, scope) {
    const t0 = Date.now();
    let text = rawQuery;
    let eff = scope;
    if (text && PREFIX[text[0]]) {
        eff = PREFIX[text[0]];
        text = text.slice(1);
    }
    const q = fold(text).replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
    const words = q ? q.split(' ') : [];
    const groups = { artist: [], album: [], track: [], playlist: [], command: [] };
    const scoped = eff !== 'all';
    const want = function (kind) { return !scoped || eff === kind; };
    const limit = function (kind) { return scoped ? SCOPED_LIMIT : GROUP_LIMIT[kind] + 1; };

    if (!q) return { effective: eff, empty: true, groups: groups, q: q, words: words };

    if (index && want('artist')) {
        const top = new TopK(limit('artist'));
        for (let i = 0; i < index.artists.length; i++) {
            const a = index.artists[i];
            const s = scoreText(a.fold, q, words);
            if (s) top.add(a, s + Math.min(60, a.items.length / 4));
        }
        groups.artist = top.items;
    }
    if (index && want('album')) {
        const top = new TopK(limit('album'));
        for (let i = 0; i < index.albums.length; i++) {
            const b = index.albums[i];
            let s = scoreText(b.fold, q, words);
            // "radiohead kid" - artist words plus album words
            if (!s && words.length > 1) {
                const both = fold(b.artist) + ' ' + b.fold;
                s = scoreText(both, q, words) ? 250 : 0;
            }
            if (s) top.add(b, s);
        }
        groups.album = top.items;
    }
    if (index && want('track')) {
        const top = new TopK(limit('track'));
        const tracks = index.tracks;
        const first = words[0];
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            if (t.fold.indexOf(first) < 0) {
                // "archangel burial": allow artist words after the title words
                if (words.length < 2) continue;
            }
            let s = scoreText(t.fold, q, words);
            if (!s && words.length > 1) {
                const both = t.fold + ' ' + fold(t.artist);
                s = scoreText(both, q, words) ? 220 : 0;
            }
            if (s) top.add(t, s);
        }
        groups.track = top.items;
    }
    if (want('playlist')) {
        const top = new TopK(limit('playlist'));
        const lists = playlistEntries();
        for (let i = 0; i < lists.length; i++) {
            const s = scoreText(lists[i].fold, q, words);
            if (s) top.add(lists[i], s + 20);
        }
        groups.playlist = top.items;
    }
    if (want('command')) {
        const top = new TopK(limit('command'));
        for (let i = 0; i < COMMANDS.length; i++) {
            const s = scoreText(COMMANDS[i].fold, q, words);
            if (s) top.add(COMMANDS[i], s);
        }
        groups.command = top.items;
    }
    if (TRACE) console.log('[RVG Quick switcher] search "' + rawQuery + '": ' + (Date.now() - t0) + ' ms');
    return { effective: eff, empty: false, groups: groups, q: q, words: words };
}

// ---------------------------------------------------------------------------
// Recents

function loadRecent() {
    try {
        const v = JSON.parse(String(window.GetProperty(PROP + 'Recent', '[]')));
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}

function recentRef(entry) {
    if (entry.kind === 'track') return { k: 'track', key: rawKey(index.handles[entry.i]) };
    return { k: entry.kind, key: entry.key };
}

function remember(entry) {
    const ref = recentRef(entry);
    let list = loadRecent().filter(function (r) { return !(r.k === ref.k && r.key === ref.key); });
    list.unshift(ref);
    if (list.length > RECENT_MAX) list = list.slice(0, RECENT_MAX);
    window.SetProperty(PROP + 'Recent', JSON.stringify(list));
}

function resolveRecent() {
    const out = [];
    const refs = loadRecent();
    let lists = null;
    for (let i = 0; i < refs.length; i++) {
        const r = refs[i];
        let e = null;
        if (r.k === 'artist' && index) e = index.artistMap.get(r.key) || null;
        else if (r.k === 'album' && index) e = index.albumMap.get(r.key) || null;
        else if (r.k === 'track' && index) {
            const t = trackIndexByRaw(r.key);
            e = t >= 0 ? index.tracks[t] : null;
        } else if (r.k === 'playlist') {
            lists = lists || playlistEntries();
            for (let j = 0; j < lists.length; j++) if (lists[j].key === r.key) { e = lists[j]; break; }
        } else if (r.k === 'command') {
            for (let j = 0; j < COMMANDS.length; j++) if (COMMANDS[j].id === r.key) { e = COMMANDS[j]; break; }
        }
        if (e) out.push(e);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Actions

const ACTIONS = {
    artist: [['play', 'Play all'], ['next', 'Play next'], ['queue', 'Add to playback queue'], ['add', 'Add to playlist\u2026'], ['show', 'Show in playlist']],
    album: [['play', 'Play album'], ['next', 'Play next'], ['queue', 'Add to playback queue'], ['add', 'Add to playlist\u2026'], ['show', 'Show in playlist']],
    track: [['play', 'Play (with its album)'], ['play_only', 'Play this track only'], ['next', 'Play next'], ['queue', 'Add to playback queue'], ['add', 'Add to playlist\u2026'], ['show', 'Show in playlist']],
    playlist: [['switch', 'Switch to playlist'], ['play', 'Play playlist'], ['queue', 'Add all to playback queue']],
    command: [['run', 'Run']]
};
const DEFAULT_ACTION = { artist: 'play', album: 'play', track: 'play', playlist: 'switch', command: 'run' };
const ENTER_LABEL = { artist: 'Play all', album: 'Play', track: 'Play', playlist: 'Switch to', command: 'Run' };

function runAction(entry, action) {
    if (!entry) return false;
    const A = RivageLibraryActions;
    try {
        if (entry.kind === 'command') {
            entry.run();
        } else if (entry.kind === 'playlist') {
            if (action === 'switch') plman.ActivePlaylist = entry.index;
            else if (action === 'play') {
                plman.ActivePlaylist = entry.index;
                if (plman.PlaylistItemCount(entry.index) > 0) plman.ExecutePlaylistDefaultAction(entry.index, 0);
            } else if (action === 'queue') A.queue(plman.GetPlaylistItems(entry.index));
            else return false;
        } else {
            if (action === 'add') return pickPlaylistAndAdd(entry);
            if (entry.kind === 'track' && action === 'play' && entry.albumKey) {
                // A track plays in its album's context so playback continues naturally.
                const album = index.albumMap.get(entry.albumKey);
                const list = handlesFor(album);
                const at = list.Find(index.handles[entry.i]);
                A.playAt(list, at >= 0 ? at : 0);
            } else {
                const list = handlesFor(entry);
                if (action === 'play' || action === 'play_only') A.play(list);
                else if (action === 'next') A.playNext(list);
                else if (action === 'queue') A.queue(list);
                else if (action === 'show') A.reveal(list);
                else return false;
            }
        }
    } catch (e) {
        reportFailure('"' + action + '" failed for ' + entry.kind + ' "' + entry.title + '"', e);
        return false;
    }
    remember(entry);
    return true;
}

let menuOpen = false;
function pickPlaylistAndAdd(entry) {
    const targets = RivageLibraryActions.playlistTargets();
    const menu = window.CreatePopupMenu();
    for (let i = 0; i < targets.length && i < 60; i++) {
        menu.AppendMenuItem(MF_STRING, 10 + i, targets[i].name.replace(/&/g, '&&'));
    }
    if (targets.length) menu.AppendMenuSeparator();
    menu.AppendMenuItem(MF_STRING, 1, 'New playlist\u2026');
    const r = selectedRowRect();
    menuOpen = true;
    let id = 0;
    try { id = menu.TrackPopupMenu(r ? r.x + S(40) : S(40), r ? r.y + r.h : S(80)); } finally { menuOpen = false; }
    const list = handlesFor(entry);
    if (id === 1) {
        let name = '';
        menuOpen = true;
        try { name = utils.InputBox(window.ID, 'Playlist name', 'Quick switcher', entry.title, false); } catch (e) { name = ''; }
        finally { menuOpen = false; }
        if (!name) return false;
        RivageLibraryActions.addToNewPlaylist(list, name);
    } else if (id >= 10) {
        RivageLibraryActions.addToPlaylist(list, targets[id - 10].index);
    } else {
        return false;
    }
    remember(entry);
    return true;
}

// ---------------------------------------------------------------------------
// State

let open = false;
let focused = false;
let wasFocusedWhileOpen = false;
let query = '';
let caret = 0;
let selectAllPending = false;
let scope = 'all';
let result = null;
let rows = [];          // { type: 'section', label } | { type: 'item', entry, marks, top }
let selected = -1;      // index into rows (items only)
let scrollY = 0;
let actionsFor = null;  // entry whose action list is open
let actionSel = 0;
let caretOn = true;
let caretTimer = 0;
let hoverChip = -1;
let lastMouse = { x: -1, y: -1 };

function setOpen(next) {
    if (next === open) return;
    open = next;
    if (releaseTimer) { window.ClearTimeout(releaseTimer); releaseTimer = 0; }
    if (open) {
        query = '';
        caret = 0;
        scope = 'all';
        actionsFor = null;
        scrollY = 0;
        wasFocusedWhileOpen = false;
        if (!index || indexDirty) {
            indexing = true;
            // Paint the "indexing" frame first, then build.
            window.SetTimeout(function () {
                try { buildIndex(); } catch (e) { reportFailure('the library index could not be built', e); }
                indexing = false;
                refresh();
            }, 0);
        }
        refresh();
        startCaret();
    } else {
        stopCaret();
        actionsFor = null;
        rows = [];
        result = null;
        releaseTimer = window.SetTimeout(releaseIndex, INDEX_KEEP_MS);
    }
    // type_only: plain typing never fires a foobar2000 shortcut while the box has
    // focus, but chords like the Ctrl+K bound to our own command still get through,
    // so the same shortcut closes the switcher.
    try { window.SetShortcutFilter(open, true, false); } catch (e) { }
}

function requestClose() {
    QuickSwitcherProtocol.hide();
}


function startCaret() {
    stopCaret();
    caretOn = true;
    caretTimer = window.SetInterval(function () {
        if (!open || !focused) return;
        caretOn = !caretOn;
        window.RepaintRect(0, 0, ww, M.searchH);
    }, 530);
}
function stopCaret() {
    if (caretTimer) window.ClearInterval(caretTimer);
    caretTimer = 0;
}

function refresh() {
    if (!open) return;
    result = search(query, scope);
    rows = [];
    const addItems = function (label, list) {
        if (!list.length) return;
        rows.push({ type: 'section', label: label });
        for (let i = 0; i < list.length; i++) rows.push({ type: 'item', entry: list[i].entry || list[i], marks: null });
    };
    if (result.empty) {
        const eff = result.effective;
        if (eff === 'all') {
            addItems('Recent', resolveRecent());
            addItems('Suggested commands', COMMANDS.filter(function (c) { return SUGGESTED.indexOf(c.id) >= 0; }));
        } else if (eff === 'playlist') addItems('Playlists', playlistEntries());
        else if (eff === 'command') addItems('Commands', COMMANDS);
        else if (index) {
            const pool = eff === 'artist' ? index.artists : eff === 'album' ? index.albums : [];
            addItems(SECTION[eff], pool.slice().sort(function (a, b) { return b.items.length - a.items.length; }).slice(0, SCOPED_LIMIT));
        }
    } else {
        const g = result.groups;
        const order = ['artist', 'album', 'track', 'playlist', 'command'];
        let best = null;
        if (result.effective === 'all') {
            for (let k = 0; k < order.length; k++) {
                const top = g[order[k]][0];
                if (top && (!best || top.score > best.score)) best = top;
            }
            if (best) addItems('Top result', [best]);
        }
        for (let k = 0; k < order.length; k++) {
            const kind = order[k];
            const list = g[kind].filter(function (x) { return x !== best; })
                .slice(0, result.effective === 'all' ? GROUP_LIMIT[kind] : SCOPED_LIMIT);
            addItems(SECTION[kind], list);
        }
    }
    selected = firstItemRow(0, 1);
    scrollY = 0;
    window.Repaint();
}

function firstItemRow(from, dir) {
    for (let i = from; i >= 0 && i < rows.length; i += dir) if (rows[i].type === 'item') return i;
    return -1;
}

// ---------------------------------------------------------------------------
// Geometry

function listTop() { return M.searchH + M.chipsH; }
function listHeight() { return Math.max(0, wh - listTop() - M.footH); }
function rowHeight(r) { return r.type === 'section' ? M.sectionH : M.rowH; }
function rowTop(i) {
    let y = S(4);
    for (let k = 0; k < i; k++) y += rowHeight(rows[k]);
    return y;
}
function contentHeight() { return rowTop(rows.length) + S(4); }
function selectedRowRect() {
    if (selected < 0) return null;
    return { x: 0, y: listTop() + rowTop(selected) - scrollY, w: ww, h: M.rowH };
}
function ensureVisible(i) {
    const top = rowTop(i);
    const h = rowHeight(rows[i]);
    // keep the section header above the first item of a group in view
    const lead = i > 0 && rows[i - 1].type === 'section' ? M.sectionH : 0;
    if (top - lead < scrollY) scrollY = Math.max(0, top - lead - S(4));
    else if (top + h > scrollY + listHeight()) scrollY = top + h - listHeight() + S(4);
}
function rowAt(y) {
    const ly = y - listTop() + scrollY;
    let top = S(4);
    for (let i = 0; i < rows.length; i++) {
        const h = rowHeight(rows[i]);
        if (ly >= top && ly < top + h) return i;
        top += h;
    }
    return -1;
}
function chipRects(gr) {
    const out = [];
    let x = M.pad - S(4);
    const y = M.searchH + S(4);
    const h = M.chipsH - S(10);
    for (let i = 0; i < SCOPES.length; i++) {
        const w = Math.ceil(gr ? gr.CalcTextWidth(SCOPES[i].label, fonts.chip) : SCOPES[i].label.length * S(7)) + S(20);
        out.push({ x: x, y: y, w: w, h: h });
        x += w + S(4);
    }
    return out;
}
let lastChipRects = [];

// ---------------------------------------------------------------------------
// Painting

function fillRound(gr, x, y, w, h, r, c) {
    if (w <= 0 || h <= 0) return;
    r = Math.min(r, w / 2, h / 2);
    if (r >= 1) gr.FillRoundRect(x, y, w, h, r, r, c);
    else gr.FillSolidRect(x, y, w, h, c);
}

function drawRuns(gr, text, font, colour, markColour, ranges, x, y, w, h) {
    if (!ranges || !ranges.length) {
        gr.GdiDrawText(text, font, colour, x, y, w, h, TEXT | DT_END_ELLIPSIS);
        return;
    }
    ranges = ranges.slice().sort(function (a, b) { return a[0] - b[0]; });
    const runs = [];
    let at = 0;
    for (let i = 0; i < ranges.length; i++) {
        const s = Math.max(at, ranges[i][0]);
        const e = Math.max(s, ranges[i][1]);
        if (s > at) runs.push([text.slice(at, s), false]);
        if (e > s) runs.push([text.slice(s, e), true]);
        at = e;
    }
    if (at < text.length) runs.push([text.slice(at), false]);
    let cx = x;
    const right = x + w;
    for (let i = 0; i < runs.length; i++) {
        const piece = runs[i][0];
        const pw = gr.CalcTextWidth(piece, font);
        const c = runs[i][1] ? markColour : colour;
        if (cx + pw > right) {
            gr.GdiDrawText(runs.slice(i).map(function (r) { return r[0]; }).join(''), font, c, cx, y, right - cx, h, TEXT | DT_END_ELLIPSIS);
            return;
        }
        gr.GdiDrawText(piece, font, c, cx, y, pw + 2, h, TEXT);
        cx += pw;
    }
}

function formatDuration(seconds) {
    seconds = Math.round(seconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const mm = h ? (m < 10 ? '0' : '') + m : String(m);
    return (h ? h + ':' : '') + mm + ':' + (s < 10 ? '0' : '') + s;
}

function subtitle(e) {
    switch (e.kind) {
        case 'artist': return e.albums + (e.albums === 1 ? ' album' : ' albums') + ' \u00B7 ' + e.items.length + (e.items.length === 1 ? ' track' : ' tracks');
        case 'album': return [e.artist, e.year, e.items.length + (e.items.length === 1 ? ' track' : ' tracks')].filter(Boolean).join(' \u00B7 ');
        case 'track': return [e.artist, e.album].filter(Boolean).join(' \u00B7 ');
        case 'playlist': return e.count + (e.count === 1 ? ' track' : ' tracks') + (e.active ? ' \u00B7 active' : '');
        default: return e.sub || '';
    }
}

function metaText(e) {
    switch (e.kind) {
        case 'album': return formatDuration(e.seconds);
        case 'track': return formatDuration(e.seconds);
        case 'command': return e.state ? e.state() : '';
        default: return '';
    }
}

let nowPlayingRaw = '';
function isPlaying(e) {
    if (!nowPlayingRaw || !index) return false;
    if (e.kind === 'track') return rawKey(index.handles[e.i]) === nowPlayingRaw;
    if (e.kind === 'album') {
        const t = trackIndexByRaw(nowPlayingRaw);
        return t >= 0 && index.tracks[t].albumKey === e.key;
    }
    return false;
}

function on_paint(gr) {
    RivageBackdrop.paint(gr, 0, 0, ww, wh, colours.background);
    gr.FillSolidRect(0, 0, ww, wh, colours.card);
    gr.DrawRect(0, 0, ww - 1, wh - 1, 1, colours.rim);
    if (!open) return;

    gr.SetSmoothingMode(4);
    paintSearch(gr);
    paintChips(gr);
    gr.FillSolidRect(0, listTop() - 1, ww, 1, colours.rule);
    if (actionsFor) paintActions(gr);
    else paintList(gr);
    paintFooter(gr);
    gr.SetSmoothingMode(0);
}

function paintSearch(gr) {
    const h = M.searchH;
    gr.GdiDrawText(GLYPH.search, fonts.icon, colours.muted, M.pad, 0, S(24), h, TEXT);
    const x = M.pad + S(32);
    const w = ww - x - M.pad - S(90);
    let placeholder = '';
    if (!focused) placeholder = 'Click here, then type to search';
    else if (!query) placeholder = 'Artists, albums, tracks, playlists \u2014 or > for commands';
    if (!query) {
        gr.GdiDrawText(placeholder, fonts.query, focused ? colours.faint : colours.accent, x, 0, w, h, TEXT | DT_END_ELLIPSIS);
    } else {
        if (selectAllPending) {
            const tw = gr.CalcTextWidth(query, fonts.query);
            fillRound(gr, x - S(2), S(12), Math.min(w, tw + S(4)), h - S(24), S(3), colours.accentSoft);
        }
        gr.GdiDrawText(query, fonts.query, colours.text, x, 0, w, h, TEXT | DT_END_ELLIPSIS);
    }
    if (focused && caretOn && !selectAllPending) {
        const cx = x + (caret ? gr.CalcTextWidth(query.slice(0, caret), fonts.query) : 0);
        if (cx < x + w) gr.FillSolidRect(cx, S(15), Math.max(1, S(1)), h - S(30), colours.text);
    }
    // effective scope from a prefix
    if (result && result.effective !== scope) {
        const label = SECTION[result.effective];
        const lw = gr.CalcTextWidth(label, fonts.chip) + S(16);
        const lx = ww - M.pad - lw;
        fillRound(gr, lx, S(14), lw, h - S(28), (h - S(28)) / 2, colours.accentSoft);
        gr.GdiDrawText(label, fonts.chip, colours.accent, lx, S(14), lw, h - S(28), DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    } else if (indexing) {
        gr.GdiDrawText('Indexing\u2026', fonts.hint, colours.faint, ww - M.pad - S(90), 0, S(90), h, DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
    }
}

function paintChips(gr) {
    lastChipRects = chipRects(gr);
    for (let i = 0; i < SCOPES.length; i++) {
        const r = lastChipRects[i];
        const on = SCOPES[i].id === scope;
        if (on || i === hoverChip) fillRound(gr, r.x, r.y, r.w, r.h, r.h / 2, colours.row);
        if (on) gr.DrawRoundRect(r.x, r.y, r.w - 1, r.h - 1, (r.h - 1) / 2, (r.h - 1) / 2, 1, colours.rim);
        gr.GdiDrawText(SCOPES[i].label, fonts.chip, on || i === hoverChip ? colours.text : colours.muted,
            r.x, r.y, r.w, r.h, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

function paintList(gr) {
    const top = listTop();
    const h = listHeight();
    gr.PushClip(0, top, ww, h);
    try {
        if (indexing && !rows.length) {
            gr.GdiDrawText('Indexing your library\u2026', fonts.title, colours.muted, 0, top, ww, S(80), DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            return;
        }
        if (!rows.length) {
            const msg = query ? 'Nothing matches \u201C' + query + '\u201D' : 'Nothing here yet \u2014 start typing';
            gr.GdiDrawText(msg, fonts.title, colours.muted, M.pad, top, ww - M.pad * 2, S(80), DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
            return;
        }
        let y = top + S(4) - scrollY;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rh = rowHeight(r);
            if (y + rh >= top && y <= top + h) {
                if (r.type === 'section') {
                    gr.GdiDrawText(r.label.toUpperCase(), fonts.section, colours.faint, M.pad + S(2), y + S(6), ww - M.pad * 2, rh - S(6), TEXT);
                } else {
                    paintItem(gr, r, y, i === selected);
                }
            }
            y += rh;
        }
        const ch = contentHeight();
        if (ch > h) {
            const th = Math.max(S(24), h * h / ch);
            const ty = top + (h - th) * (scrollY / (ch - h));
            fillRound(gr, ww - S(6), ty + S(2), S(3), th - S(4), S(2), colours.rim);
        }
    } finally {
        gr.PopClip();
    }
}

function paintItem(gr, r, y, isSel) {
    const e = r.entry;
    const x0 = S(8), w0 = ww - S(16), h = M.rowH;
    if (isSel) {
        fillRound(gr, x0, y + S(1), w0, h - S(2), M.radius, colours.accentSoft);
        const barH = Math.max(S(6), h - S(2) - M.radius * 2);
        fillRound(gr, x0 + S(3), y + (h - barH) / 2, S(3), barH, S(2), colours.accent);
    }
    const tx = x0 + S(10);
    const ty = y + (h - M.thumb) / 2;
    paintThumb(gr, e, tx, ty, M.thumb);
    // The cover is a play button on hover.
    if (r === hoverCover) {
        fillRound(gr, tx, ty, M.thumb, M.thumb, S(6), 0x78000000);
        gr.GdiDrawText(GLYPH.play, fonts.icon, 0xffffffff, tx, ty, M.thumb, M.thumb, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }

    const textX = tx + M.thumb + M.gap;
    const hint = isSel ? ENTER_LABEL[e.kind] + '  \u21B5' : '';
    const meta = metaText(e);
    const metaW = meta ? gr.CalcTextWidth(meta, fonts.sub) + S(6) : 0;
    const hintW = hint ? gr.CalcTextWidth(hint, fonts.hint) + S(10) : 0;
    const right = x0 + w0 - S(10);
    const textW = Math.max(S(40), right - metaW - hintW - textX);

    if (r.marks === null) r.marks = result && !result.empty ? markRanges(e.title, result.q, result.words) : [];
    const lineH = Math.round(h * 0.42);
    let titleW = textW;
    const playing = isPlaying(e);
    const badge = playing ? 'playing' : '';
    const badgeW = badge ? gr.CalcTextWidth(badge, fonts.hint) + S(12) : 0;
    if (badge) titleW = Math.max(S(20), textW - badgeW - S(6));
    drawRuns(gr, e.title || '(untitled)', fonts.title, colours.text, colours.accent, r.marks, textX, y + S(4), titleW, lineH);
    if (badge) {
        const bw = Math.min(titleW, gr.CalcTextWidth(e.title, fonts.title));
        const bx = textX + bw + S(6);
        fillRound(gr, bx, y + S(4) + (lineH - S(16)) / 2, badgeW, S(16), S(4), colours.accentSoft);
        gr.GdiDrawText(badge, fonts.hint, colours.accent, bx, y + S(4) + (lineH - S(16)) / 2, badgeW, S(16), DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }
    gr.GdiDrawText(subtitle(e), fonts.sub, colours.muted, textX, y + S(4) + lineH, textW, h - lineH - S(10), TEXT | DT_END_ELLIPSIS);

    if (hint) gr.GdiDrawText(hint, fonts.hint, colours.muted, right - metaW - hintW, y, hintW, h, DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
    if (meta) gr.GdiDrawText(meta, fonts.sub, colours.faint, right - metaW, y, metaW, h, DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
}

// Thumbnails: album art for artists/albums/tracks, glyph tiles for the rest.
const thumbCache = new Map();   // albumKey -> GdiBitmap | null (no art)
const thumbPending = new Map(); // rawKey -> albumKey

function albumKeyOf(e) {
    if (e.kind === 'album') return e.key;
    if (e.kind === 'track') return e.albumKey || ('t:' + e.i);
    if (e.kind === 'artist') return index && index.tracks[e.items[0]] ? (index.tracks[e.items[0]].albumKey || ('t:' + e.items[0])) : '';
    return '';
}

function firstHandleOf(e) {
    const i = e.kind === 'track' ? e.i : e.items[0];
    return index.handles[i];
}

function paintThumb(gr, e, x, y, size) {
    const glyph = e.kind === 'command' ? (e.glyph || GLYPH.command) : e.kind === 'playlist' ? GLYPH.playlist : null;
    if (!glyph) {
        const key = albumKeyOf(e);
        const img = thumbCache.get(key);
        if (img) {
            gr.DrawImage(img, x, y, size, size, 0, 0, img.Width, img.Height);
            return;
        }
        if (key && !thumbCache.has(key) && thumbPending.size < 40) requestThumb(e, key);
    }
    fillRound(gr, x, y, size, size, S(6), colours.row);
    const g = glyph || (e.kind === 'artist' ? GLYPH.artist : e.kind === 'album' ? GLYPH.album : GLYPH.track);
    gr.GdiDrawText(g, fonts.icon, colours.muted, x, y, size, size, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}

function requestThumb(e, key) {
    const handle = firstHandleOf(e);
    const rk = rawKey(handle);
    if (!rk || thumbPending.has(rk)) return;
    thumbPending.set(rk, key);
    thumbCache.set(key, undefined);
    try {
        utils.GetAlbumArtAsync(window.ID, handle, 0, false, false, false);
    } catch (err) {
        thumbPending.delete(rk);
        thumbCache.set(key, null);
    }
}

function on_get_album_art_done(handle, art_id, image) {
    const rk = rawKey(handle);
    const key = thumbPending.get(rk);
    if (key === undefined) return;
    thumbPending.delete(rk);
    let thumb = null;
    if (image) {
        try {
            // square centre crop, then one high-quality downscale; rounded by a mask
            const side = Math.min(image.Width, image.Height);
            const cropped = image.Clone(Math.floor((image.Width - side) / 2), Math.floor((image.Height - side) / 2), side, side);
            thumb = cropped.Resize(M.thumb, M.thumb, 7);
            roundCorners(thumb, S(6));
        } catch (e) {
            thumb = null;
        }
    }
    if (thumbCache.size >= THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(key, thumb);
    if (open) window.RepaintRect(0, listTop(), ww, listHeight());
}

let cornerMask = null;
function roundCorners(img, radius) {
    try {
        if (!cornerMask || cornerMask.Width !== img.Width) {
            cornerMask = gdi.CreateImage(img.Width, img.Height);
            const g = cornerMask.GetGraphics();
            g.FillSolidRect(0, 0, img.Width, img.Height, 0xffffffff);   // white cuts
            g.SetSmoothingMode(4);
            g.FillRoundRect(0, 0, img.Width - 1, img.Height - 1, radius, radius, 0xff000000); // black keeps
            cornerMask.ReleaseGraphics(g);
        }
        img.ApplyMask(cornerMask);
    } catch (e) {
        reportFailure('thumbnail corners could not be rounded', e);
    }
}

function paintActions(gr) {
    const top = listTop();
    const e = actionsFor;
    const headH = M.rowH + S(8);
    gr.GdiDrawText(GLYPH.back, fonts.iconSmall, colours.muted, M.pad, top, S(20), headH, TEXT);
    paintThumb(gr, e, M.pad + S(26), top + (headH - M.thumb) / 2, M.thumb);
    const tx = M.pad + S(26) + M.thumb + M.gap;
    gr.GdiDrawText(e.title, fonts.title, colours.text, tx, top + S(6), ww - tx - M.pad, headH / 2 - S(2), TEXT | DT_END_ELLIPSIS);
    gr.GdiDrawText(subtitle(e), fonts.sub, colours.muted, tx, top + headH / 2, ww - tx - M.pad, headH / 2 - S(6), TEXT | DT_END_ELLIPSIS);
    gr.FillSolidRect(M.pad, top + headH, ww - M.pad * 2, 1, colours.rule);
    const list = ACTIONS[e.kind];
    const rh = S(36);
    for (let i = 0; i < list.length; i++) {
        const y = top + headH + S(6) + i * rh;
        if (i === actionSel) {
            fillRound(gr, S(8), y, ww - S(16), rh - S(2), M.radius, colours.accentSoft);
            fillRound(gr, S(11), y + M.radius, S(3), rh - S(2) - M.radius * 2, S(2), colours.accent);
        }
        gr.GdiDrawText(list[i][1], fonts.title, colours.text, M.pad + S(12), y, ww - M.pad * 2, rh - S(2), TEXT | DT_END_ELLIPSIS);
    }
}

function paintFooter(gr) {
    const y = wh - M.footH;
    gr.FillSolidRect(0, y, ww, 1, colours.rule);
    if (flash) {
        gr.GdiDrawText(flash, fonts.hint, colours.accent, M.pad, y, ww - M.pad * 2, M.footH, TEXT | DT_END_ELLIPSIS);
        return;
    }
    const hints = actionsFor
        ? [['\u2191\u2193', 'move'], ['Enter', 'run'], ['\u2190 / Esc', 'back']]
        : [['\u2191\u2193', 'move'], ['Enter', 'play'], ['Shift+Enter', 'queue'], ['Ctrl+Enter', 'play next'], ['\u2192', 'more'], ['Tab', 'filter'], ['Esc', 'close']];
    let x = M.pad;
    for (let i = 0; i < hints.length; i++) {
        const kw = gr.CalcTextWidth(hints[i][0], fonts.hint) + S(10);
        const lw = gr.CalcTextWidth(hints[i][1], fonts.hint) + S(4);
        if (x + kw + lw > ww - M.pad) break;
        fillRound(gr, x, y + (M.footH - S(18)) / 2, kw, S(18), S(4), colours.row);
        gr.GdiDrawText(hints[i][0], fonts.hint, colours.muted, x, y, kw, M.footH, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        gr.GdiDrawText(hints[i][1], fonts.hint, colours.faint, x + kw + S(4), y, lw, M.footH, TEXT);
        x += kw + lw + S(14);
    }
}

// ---------------------------------------------------------------------------
// Input

function execute(mode) {
    if (actionsFor) {
        const a = ACTIONS[actionsFor.kind][actionSel];
        const entry = actionsFor;
        if (a && runAction(entry, a[0])) requestClose();
        return;
    }
    if (selected < 0) return;
    const e = rows[selected].entry;
    let action = DEFAULT_ACTION[e.kind];
    if (mode === 'queue' && e.kind !== 'command') action = 'queue';
    if (mode === 'next' && e.kind !== 'command' && e.kind !== 'playlist') action = 'next';
    // A plain click on music selects it in the playlist; the cover and Enter play.
    if (mode === 'click' && action === 'play') action = 'show';
    if (runAction(e, action)) requestClose();
}

function moveSelection(dir, page) {
    if (actionsFor) {
        const n = ACTIONS[actionsFor.kind].length;
        actionSel = (actionSel + dir + n) % n;
        window.Repaint();
        return;
    }
    if (selected < 0) return;
    let steps = page ? Math.max(1, M.visibleRows - 1) : 1;
    let i = selected;
    while (steps-- > 0) {
        const next = firstItemRow(i + dir, dir);
        if (next < 0) break;
        i = next;
    }
    selected = i;
    ensureVisible(selected);
    window.Repaint();
}

function editQuery(next, nextCaret) {
    selectAllPending = false;
    query = next;
    caret = clamp(nextCaret, 0, query.length);
    caretOn = true;
    refresh();
}

function cycleScope(dir) {
    let i = 0;
    for (let k = 0; k < SCOPES.length; k++) if (SCOPES[k].id === scope) i = k;
    scope = SCOPES[(i + dir + SCOPES.length) % SCOPES.length].id;
    refresh();
}

function openActions() {
    if (selected < 0) return;
    actionsFor = rows[selected].entry;
    actionSel = 0;
    window.Repaint();
}

function on_key_down(vk) {
    if (!open) return;
    const ctrl = utils.IsKeyPressed(VK.ctrl);
    const shift = utils.IsKeyPressed(VK.shift);
    switch (vk) {
        case VK.esc:
            if (actionsFor) { actionsFor = null; window.Repaint(); }
            else if (query) editQuery('', 0);
            else requestClose();
            return;
        case VK.up: moveSelection(-1, false); return;
        case VK.down: moveSelection(1, false); return;
        case VK.pgup: moveSelection(-1, true); return;
        case VK.pgdn: moveSelection(1, true); return;
        case VK.enter: execute(shift ? 'queue' : ctrl ? 'next' : ''); return;
        case VK.tab: if (!actionsFor) cycleScope(shift ? -1 : 1); return;
        case VK.left:
            if (actionsFor) { actionsFor = null; window.Repaint(); return; }
            selectAllPending = false;
            caret = Math.max(0, caret - 1); caretOn = true; window.RepaintRect(0, 0, ww, M.searchH);
            return;
        case VK.right:
            if (actionsFor) return;
            if (caret >= query.length) { openActions(); return; }
            selectAllPending = false;
            caret++; caretOn = true; window.RepaintRect(0, 0, ww, M.searchH);
            return;
        case VK.home: caret = 0; window.RepaintRect(0, 0, ww, M.searchH); return;
        case VK.end: caret = query.length; window.RepaintRect(0, 0, ww, M.searchH); return;
        case VK.back:
            if (selectAllPending) { editQuery('', 0); return; }
            if (!caret) return;
            if (ctrl) {
                const before = query.slice(0, caret).replace(/\s*\S+\s*$/, '');
                editQuery(before + query.slice(caret), before.length);
            } else {
                editQuery(query.slice(0, caret - 1) + query.slice(caret), caret - 1);
            }
            return;
        case VK.del:
            if (selectAllPending) { editQuery('', 0); return; }
            if (caret < query.length) editQuery(query.slice(0, caret) + query.slice(caret + 1), caret);
            return;
        case VK.a:
            if (ctrl && query) { selectAllPending = true; window.RepaintRect(0, 0, ww, M.searchH); }
            return;
        case VK.v:
            if (ctrl) {
                let clip = '';
                try { clip = String(utils.GetClipboardText() || '').replace(/[\r\n\t]+/g, ' '); } catch (e) { clip = ''; }
                if (clip) insertText(clip);
            }
            return;
    }
}

function insertText(text) {
    if (actionsFor) { actionsFor = null; }
    if (selectAllPending) editQuery(text, text.length);
    else editQuery(query.slice(0, caret) + text + query.slice(caret), caret + text.length);
}

function on_char(code) {
    if (!open || code < 32 || code === 127) return;
    if (utils.IsKeyPressed(VK.ctrl) && !utils.IsKeyPressed(0x12)) return; // Ctrl chords, but allow AltGr
    insertText(String.fromCharCode(code));
}

function on_focus(isFocused) {
    focused = !!isFocused;
    if (focused) {
        wasFocusedWhileOpen = open;
        caretOn = true;
    } else if (open && wasFocusedWhileOpen && !menuOpen) {
        // Clicking anywhere else in the layout closes it, like a popup.
        window.SetTimeout(function () { if (open && !focused && !menuOpen) requestClose(); }, 0);
    }
    window.RepaintRect(0, 0, ww, M.searchH);
}

function on_mouse_move(x, y) {
    if (!open || (x === lastMouse.x && y === lastMouse.y)) return;
    lastMouse = { x: x, y: y };
    let chip = -1;
    for (let i = 0; i < lastChipRects.length; i++) {
        const r = lastChipRects[i];
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) chip = i;
    }
    if (chip !== hoverChip) { hoverChip = chip; window.RepaintRect(0, M.searchH, ww, M.chipsH); }
    if (y < M.searchH) { window.SetCursor(IDC_IBEAM); return; }
    if (actionsFor) {
        const i = actionIndexAt(y);
        if (i >= 0 && i !== actionSel) { actionSel = i; window.Repaint(); }
        window.SetCursor(i >= 0 ? IDC_HAND : IDC_ARROW);
        return;
    }
    const i = y >= listTop() && y < wh - M.footH ? rowAt(y) : -1;
    const cover = coverRowAt(x, i);
    if (cover !== hoverCover) { hoverCover = cover; window.RepaintRect(0, listTop(), ww, listHeight()); }
    if (i >= 0 && rows[i].type === 'item') {
        window.SetCursor(IDC_HAND);
        if (i !== selected) { selected = i; window.RepaintRect(0, listTop(), ww, listHeight()); }
    } else {
        window.SetCursor(chip >= 0 ? IDC_HAND : IDC_ARROW);
    }
}

// Music rows whose cover is under the pointer (the cover plays them).
let hoverCover = null;
function coverRowAt(x, i) {
    if (i < 0 || rows[i].type !== 'item') return null;
    const kind = rows[i].entry.kind;
    if (kind !== 'artist' && kind !== 'album' && kind !== 'track') return null;
    const tx = S(8) + S(10); // as paintItem
    return x >= tx && x < tx + M.thumb ? rows[i] : null;
}

// Plays from the active playlist when it holds the tracks, else as Enter would.
function playFromCover(e) {
    if (RivageLibraryActions.playFromActivePlaylist(handlesFor(e))) {
        remember(e);
        return true;
    }
    return runAction(e, 'play');
}

function actionIndexAt(y) {
    const base = listTop() + M.rowH + S(8) + S(6);
    const i = Math.floor((y - base) / S(36));
    return y >= base && actionsFor && i < ACTIONS[actionsFor.kind].length ? i : -1;
}

function on_mouse_lbtn_up(x, y) {
    if (!open) return;
    for (let i = 0; i < lastChipRects.length; i++) {
        const r = lastChipRects[i];
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
            scope = SCOPES[i].id;
            refresh();
            return;
        }
    }
    if (actionsFor) {
        if (y >= listTop() && y < listTop() + M.rowH + S(8) && x < M.pad + S(24)) { actionsFor = null; window.Repaint(); return; }
        const i = actionIndexAt(y);
        if (i >= 0) { actionSel = i; execute(''); }
        return;
    }
    if (y >= listTop() && y < wh - M.footH) {
        const i = rowAt(y);
        if (i >= 0 && rows[i].type === 'item') {
            selected = i;
            if (coverRowAt(x, i)) { if (playFromCover(rows[i].entry)) requestClose(); return; }
            execute(utils.IsKeyPressed(VK.shift) ? 'queue' : utils.IsKeyPressed(VK.ctrl) ? 'next' : 'click');
        }
    }
}

// Middle-click queues the row under the pointer and keeps the switcher open,
// so several things can be queued in a row. Commands have nothing to queue.
let flash = '';
let flashTimer = 0;
function showFlash(text) {
    flash = text;
    if (flashTimer) window.ClearTimeout(flashTimer);
    flashTimer = window.SetTimeout(function () {
        flashTimer = 0;
        flash = '';
        if (open) window.RepaintRect(0, wh - M.footH, ww, M.footH);
    }, 1800);
    window.RepaintRect(0, wh - M.footH, ww, M.footH);
}

function on_mouse_mbtn_up(x, y) {
    if (!open || actionsFor || y < listTop() || y >= wh - M.footH) return;
    const i = rowAt(y);
    if (i < 0 || rows[i].type !== 'item') return;
    const e = rows[i].entry;
    if (e.kind === 'command') return;
    selected = i;
    if (runAction(e, 'queue')) showFlash('Queued \u00b7 ' + e.title);
    window.RepaintRect(0, listTop(), ww, listHeight());
}

function on_mouse_rbtn_up(x, y) {
    if (!open || actionsFor) return true;
    const i = y >= listTop() ? rowAt(y) : -1;
    if (i >= 0 && rows[i].type === 'item') { selected = i; openActions(); }
    return true; // no default panel menu
}

function on_mouse_wheel(step) {
    if (!open || actionsFor) return;
    const max = Math.max(0, contentHeight() - listHeight());
    scrollY = clamp(scrollY - step * M.rowH * 2, 0, max);
    hoverCover = null;
    lastMouse = { x: -1, y: -1 };
    window.RepaintRect(0, listTop(), ww, listHeight());
}

function on_mouse_leave() {
    if (!hoverCover) return;
    hoverCover = null;
    window.RepaintRect(0, listTop(), ww, listHeight());
}

// ---------------------------------------------------------------------------
// Host callbacks

function on_size() {
    ww = window.Width;
    wh = window.Height;
}

function on_playback_new_track(handle) {
    nowPlayingRaw = rawKey(handle);
}
function on_playback_stop(reason) {
    if (reason !== 2) nowPlayingRaw = '';
}

function markIndexDirty() {
    indexDirty = true;
}
function on_library_items_added() { markIndexDirty(); }
function on_library_items_removed() { markIndexDirty(); }
function on_library_items_changed() { markIndexDirty(); }

function on_notify_data(name, info) {
    if (RivagePowerMode.consume(name, info)) return;
    // The stats backend Rediscover reads: adopt the Global-settings choice.
    if (name === 'SETTINGS_REGISTRY.VALUE_CHANGED' && info && info.panelId === 'global') {
        PlaybackStatsSource.applySetting(info.settingId, info.value);
        return;
    }
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;
    if (SharedThemeProtocol.consume(name, info, function () {
        updateTheme();
        SharedThemeProtocol.requestRepaint();
    })) return;
    if (name === QuickSwitcherProtocol.STATE) {
        const next = QuickSwitcherProtocol.parseState(info);
        if (next && !open) QuickSwitcherProtocol.show(M.w, preferredHeight()); // our real size
        setOpen(next);
        return;
    }
    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        const next = SharedAccentProtocol.opaque(info);
        if (next === sharedAlbumAccent) return;
        sharedAlbumAccent = next;
        if (SharedThemeProtocol.isAccentCommitted(next)) return;
        updateTheme();
        if (open) window.Repaint();
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

function on_script_unload() {
    stopCaret();
}

updateTheme(true);
on_size();
SharedAccentProtocol.request();
PlaybackStatsSource.requestSync();
try {
    const np = fb.GetNowPlaying();
    if (np) nowPlayingRaw = rawKey(np);
} catch (e) { }

// First load usually happens because the root splitter just showed this panel:
// that STATE message went out before this script existed, so pick it up here.
function panelVisible() {
    try {
        let v = window.IsVisible;
        if (typeof v === 'function') v = v.call(window);
        return v === undefined || v === null ? false : !!v;
    } catch (e) { return false; }
}
if (panelVisible()) {
    QuickSwitcherProtocol.show(M.w, preferredHeight());
    setOpen(true);
}
