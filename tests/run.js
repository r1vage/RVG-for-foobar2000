'use strict';
// Tests for the logic that writes tags or lyrics, or adds up listening history.
// Runs the real code from rivage/ against small fakes: node tests/run.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', 'rivage') + path.sep;
const read = (file) => fs.readFileSync(ROOT + file, 'utf8');

// Source of one top-level function, to test a panel script that cannot load outside foobar2000.
function functionSource(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert(start >= 0, 'no function ' + name);
    let depth = 0;
    for (let i = src.indexOf('{', start); ; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
}

function loadFunctions(file, names, returned, params = [], args = []) {
    const src = read(file);
    const body = names.map((name) => functionSource(src, name)).join('\n');
    return new Function(...params, body + '\nreturn ' + returned + ';')(...args);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- Lyrics ----

const parseLrc = loadFunctions('lyrics_panel.js', ['parse_karaoke_words', 'parse_lrc'], 'parse_lrc');

test('[offset:] makes lyrics earlier when positive, later when negative', () => {
    assert.strictEqual(parseLrc('[offset:500]\n[00:10.00]x')[0].t, 9500);
    assert.strictEqual(parseLrc('[offset:+500]\n[00:10.00]x')[0].t, 9500);
    assert.strictEqual(parseLrc('[offset:-500]\n[00:10.00]x')[0].t, 10500);
    assert.strictEqual(parseLrc('[00:10.00]x')[0].t, 10000);
});

const pick = loadFunctions('lyrics_panel.js', ['norm', 'pick_best_lrclib_match'], 'pick_best_lrclib_match');
const SYNCED = '[00:01.00]a';

test('a different song is never picked for lyrics', () => {
    const other = { artistName: 'Other Band', trackName: 'Other Song', syncedLyrics: SYNCED };
    assert.strictEqual(pick([other], { artist: 'My Band', title: 'My Song' }), null);
});

test('non-Latin names are compared, not treated as empty', () => {
    const right = { artistName: 'Кино', trackName: 'Группа крови', syncedLyrics: SYNCED };
    const wrong = { artistName: 'Другая', trackName: 'Чужая', syncedLyrics: SYNCED };
    assert.strictEqual(pick([wrong, right], { artist: right.artistName, title: right.trackName }), right);
});

test('case, punctuation and accents do not stop a match; synced wins', () => {
    const plain = { artistName: 'Björk!', trackName: 'Army of Me', plainLyrics: 'x' };
    const synced = { artistName: 'bjork', trackName: 'army of me', syncedLyrics: SYNCED };
    assert.strictEqual(pick([plain], { artist: 'Bjork', title: 'army  of me' }), plain);
    assert.strictEqual(pick([plain, synced], { artist: 'Bjork', title: 'Army of Me' }), synced);
});

// Runs load_lyrics_for_track with local lyrics and an online answer; returns what it did.
function lyricsLoad(local, online, force) {
    const log = [];
    const load = loadFunctions('lyrics_panel.js', ['load_lyrics_for_track'], 'load_lyrics_for_track', [
        'read_tag_lyrics', 'read_file_lyrics', 'fetch_online', 'apply_data', 'save_lyrics', 'set_state', 'STATE',
        'opt_auto_fetch', 'upgrade_attempted', 'invalidate_online_requests', 'track_fields', 'track_key', 'handle_key',
        'mark_upgrade_attempted', 'request_is_current', 'clear_current_source', 'search_overlay', 'search_links',
        'search_scroll', 'current_handle_ref', 'current_handle_key', 'current_fields', 'current_track_key', 'request_token'
    ], [
        () => local, () => null, (fields, token, cb) => cb(online), (d) => log.push('show ' + d.id),
        (handle, d) => log.push('save ' + d.id), () => log.push('state'), {}, true, {}, () => { }, () => ({}), () => 'key',
        () => 'handle', () => { }, () => true, () => { }
    ]);
    load({}, force);
    return log.join(', ');
}

test('fetched lyrics only get saved when there were none or they upgrade to synced', () => {
    const localSynced = { id: 'localSynced', synced: true, plain: 'x' };
    const localPlain = { id: 'localPlain', synced: false, plain: 'x' };
    const onlineSynced = { id: 'onlineSynced', synced: true };
    const onlinePlain = { id: 'onlinePlain', synced: false };
    assert.strictEqual(lyricsLoad(localSynced, onlinePlain, true), 'show localSynced, show onlinePlain');
    assert.strictEqual(lyricsLoad(localSynced, onlineSynced, true), 'show localSynced, show onlineSynced');
    assert.strictEqual(lyricsLoad(localSynced, onlineSynced, false), 'show localSynced');
    assert.strictEqual(lyricsLoad(localPlain, onlinePlain, false), 'show localPlain');
    assert.strictEqual(lyricsLoad(localPlain, onlineSynced, false), 'show localPlain, show onlineSynced, save onlineSynced');
    assert.strictEqual(lyricsLoad(null, onlinePlain, false), 'state, show onlinePlain, save onlinePlain');
    assert.strictEqual(lyricsLoad(localSynced, null, true), 'show localSynced');
});

// ---- Tagger ----

const sortForPairing = loadFunctions('musicbrainz_tagger.js', ['sortForPairing'], 'sortForPairing');
const selection = (rows) => rows.map((row, i) => ({ srcIndex: i, path: row[0], disc: row[1], track: row[2] }));
const pairedPaths = (rows) => { const order = selection(rows); sortForPairing(order); return order.map((o) => o.path).join(' '); };

test('a multi-disc album without disc tags stays disc by disc', () => {
    assert.strictEqual(pairedPaths([['2/02', 0, 2], ['1/01', 0, 1], ['2/01', 0, 1], ['1/02', 0, 2]]), '1/01 1/02 2/01 2/02');
});

test('tagged tracks follow their disc and track numbers, not their paths', () => {
    assert.strictEqual(pairedPaths([['b', 1, 2], ['z', 1, 1], ['a', 2, 1]]), 'z b a');
});

const tagValues = loadFunctions('musicbrainz_tagger.js', ['cleanSpaces', 'rawValues', 'currentValues'], '{ raw: rawValues, clean: currentValues }');

test('undo keeps a tag value as stored while the diff compares it tidied', () => {
    const info = { MetaFind: () => 0, MetaValueCount: () => 2, MetaValue: (idx, i) => ['A  B', ''][i] };
    assert.deepStrictEqual(tagValues.raw(info, 'TITLE'), ['A  B']);
    assert.deepStrictEqual(tagValues.clean(info, 'TITLE'), ['A B']);
});

// ---- Live shows ----

test('a failed show lookup is never treated as a fresh "no shows"', () => {
    const fresh = loadFunctions('live_shows_panel.js', ['entryFresh'], 'entryFresh', ['cacheDays', 'EMPTY_CACHE_MULTIPLIER'], [14, 2]);
    assert.strictEqual(fresh({ savedAt: Date.now(), shows: [], error: 'HTTP 429' }), false);
    assert.strictEqual(fresh({ savedAt: Date.now(), shows: [], error: '' }), true);
});

// ---- Loved rule ----

function statsSource(ultimate) {
    const fb = { TitleFormat: () => null };
    const utils = { CheckComponent: (name) => ultimate && name === 'foo_ultimate_playcount' };
    const window = { GetProperty: (name, value) => value, SetProperty: () => { }, NotifyOthers: () => { } };
    const failure = { reporter: () => () => { } };
    return new Function('fb', 'utils', 'window', 'include', 'RivageFailure', read('shared/playback_stats_source.js') + '\nreturn PlaybackStatsSource;')(fb, utils, window, () => { }, failure);
}

test('Ultimate Playcount uses its own mark and skips its saved Last.fm copy', () => {
    const fields = statsSource(true).lovedFields();
    assert(fields.includes('%upc_loved%'));
    assert(fields.includes('%lfm_love%'));
    assert(!fields.includes('%lfm_loved%'));
    assert(!fields.includes('%lastfm_loved%'));
});

test('without Ultimate Playcount the Last.fm fields count', () => {
    const fields = statsSource(false).lovedFields();
    assert(fields.includes('%lfm_loved%'));
    assert(fields.includes('%lastfm_loved%'));
    assert(!fields.includes('%upc_loved%'));
});

test('only positive marks count as loved', () => {
    const { isLovedValue } = statsSource(false);
    for (const yes of ['1', '2', 'true', 'YES', 'loved']) assert(isLovedValue(yes), yes);
    for (const no of ['', '0', '-1', '?', undefined]) assert(!isLovedValue(no), String(no));
});

// ---- Listening history ----

class HandleList extends Array {
    get Count() { return this.length; }
    Clone() { return HandleList.from(this); }
    Sort() { this.sort((a, b) => a.id - b.id); }
    RemoveRange(from, n) { this.splice(from, n); }
    MakeIntersection(other) {
        const keep = this.filter((h) => other.includes(h));
        this.length = 0;
        keep.forEach((h) => this.push(h));
    }
    BSearch(h) { return this.indexOf(h); }
}

function historyHarness(tracks) {
    const timers = [];
    const library = HandleList.from(tracks);
    const fb = {
        GetLibraryItems: () => library.Clone(),
        TitleFormat: (spec) => ({
            EvalWithMetadbs: (list) => Array.from(list, (h) => (spec.includes('played_times')
                ? JSON.stringify(h.plays)
                : [h.artist, '', h.album, h.title, 180, ''].join('\u001f')))
        })
    };
    const window = { SetTimeout: (fn) => timers.push(fn), ClearTimeout: () => { } };
    const api = new Function('fb', 'window', read('shared/listening_history_index.js') + '\nreturn RivageListeningIndex;')(fb, window);
    let index = null;
    api.build({}, { onDone: (built) => { index = built; } });
    while (timers.length) timers.shift()();
    return { api, index };
}

const JAN = (day) => new Date(2026, 0, day, 12).getTime();

test('a new play is merged in time order and counted once', () => {
    const a = { id: 1, artist: 'A', album: 'X', title: 'One', plays: [JAN(1), JAN(5)] };
    const b = { id: 2, artist: 'B', album: 'Y', title: 'Two', plays: [JAN(3)] };
    const { api, index } = historyHarness([a, b]);
    assert.strictEqual(index.eventTimes.length, 3);

    b.plays = [JAN(3), JAN(4)];
    assert.strictEqual(api.update(index, HandleList.from([b])), 'ok');
    assert.deepStrictEqual(Array.from(index.eventTimes), [JAN(1), JAN(3), JAN(4), JAN(5)]);
    assert.deepStrictEqual(Array.from(index.eventTracks), [0, 1, 1, 0]);
    assert.strictEqual(api.summarise(index, JAN(1), JAN(31)).plays, 4);
});

test('the same song in two files counts as one, and a period is [from, to)', () => {
    const a = { id: 1, artist: 'A', album: 'X', title: 'One', plays: [JAN(1)] };
    const b = { id: 2, artist: 'a', album: 'Y', title: 'ONE', plays: [JAN(2), JAN(10)] };
    const { api, index } = historyHarness([a, b]);
    const summary = api.summarise(index, JAN(1), JAN(10));
    assert.strictEqual(summary.plays, 2);
    assert.strictEqual(summary.distinctTracks, 1);
    assert.strictEqual(summary.topTracks[0].plays, 2);
});

// ---- Request queue ----

function queueHarness(overrides) {
    let clock = 1000;
    let nextId = 1;
    const timers = new Map();
    const sent = [];
    const failures = [];
    const state = { generation: 1 };
    const window = {
        SetTimeout: (fn, delay) => { timers.set(nextId, { fn, at: clock + (delay || 0) }); return nextId++; },
        ClearTimeout: (id) => timers.delete(id)
    };
    const utils = { HTTPRequestAsync: (type, url) => { if (url === 'throw') throw new Error('bad'); sent.push(url); return 100 + sent.length; } };
    const FakeDate = { now: () => clock };
    const { create } = new Function('window', 'utils', 'Date', read('shared/serial_request_queue.js') + '\nreturn SerialRequestQueue;')(window, utils, FakeDate);
    const queue = create(Object.assign({
        intervalMs: 1000, timeoutMs: 45000, headers: () => '{}', isActive: () => true,
        generation: () => state.generation,
        onFailure: (context, status, detail) => failures.push(context.url + ':' + status + ':' + detail)
    }, overrides));
    function advance(ms) {
        clock += ms;
        for (; ;) {
            const due = [...timers].find(([, t]) => t.at <= clock);
            if (!due) return;
            timers.delete(due[0]);
            due[1].fn();
        }
    }
    return { queue, sent, failures, state, advance };
}

test('requests go one at a time and at least the interval apart', () => {
    const { queue, sent, advance } = queueHarness();
    queue.enqueue({ url: 'a', generation: 1 });
    queue.enqueue({ url: 'b', generation: 1 });
    assert.deepStrictEqual(sent, ['a']);
    advance(5000);
    assert.deepStrictEqual(sent, ['a'], 'waits for the answer');
    assert.strictEqual(queue.take(101).url, 'a');
    advance(0);
    assert.deepStrictEqual(sent, ['a', 'b'], 'next one goes without the panel asking');
    assert.strictEqual(queue.take(102).url, 'b');
    queue.enqueue({ url: 'c', generation: 1 });
    assert.deepStrictEqual(sent, ['a', 'b'], 'too soon after b');
    advance(1000);
    assert.deepStrictEqual(sent, ['a', 'b', 'c']);
});

test('stale requests are dropped and do not block the queue', () => {
    const { queue, sent, state, advance } = queueHarness();
    queue.enqueue({ url: 'old', generation: 1 });
    queue.enqueue({ url: 'gone', generation: 1 });
    state.generation = 2;
    queue.enqueue({ url: 'new', generation: 2 });
    assert.strictEqual(queue.take(101), null);
    advance(1000);
    assert.deepStrictEqual(sent, ['old', 'new']);
});

test('a request with no answer fails after the timeout and frees the queue', () => {
    const { queue, sent, failures, advance } = queueHarness();
    queue.enqueue({ url: 'a', generation: 1 });
    queue.enqueue({ url: 'b', generation: 1 });
    advance(45000);
    assert.deepStrictEqual(failures, ['a:0:No response after 45 s']);
    queue.pump();
    assert.deepStrictEqual(sent, ['a', 'b']);
});

test('a retry goes first, counts up and waits out the cooldown', () => {
    const { queue, sent, advance } = queueHarness();
    queue.enqueue({ url: 'a', generation: 1 });
    queue.enqueue({ url: 'b', generation: 1 });
    const context = queue.take(101);
    queue.block(5000);
    queue.retry(context);
    advance(4000);
    assert.deepStrictEqual(sent, ['a']);
    advance(1000);
    assert.deepStrictEqual(sent, ['a', 'a']);
    assert.strictEqual(queue.take(102).retries, 1);
});

test('a host that throws reports a failure later, not on the same stack', () => {
    const { queue, failures, advance } = queueHarness();
    queue.enqueue({ url: 'throw', generation: 1 });
    assert.deepStrictEqual(failures, []);
    advance(0);
    assert.deepStrictEqual(failures, ['throw:0:Error: bad']);
});

// ---- Runner ----

let failed = 0;
for (const [name, fn] of tests) {
    try {
        fn();
        console.log('ok    ' + name);
    } catch (e) {
        failed++;
        console.log('FAIL  ' + name + '\n' + e.stack);
    }
}
console.log((tests.length - failed) + ' of ' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
