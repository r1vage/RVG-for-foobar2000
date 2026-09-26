'use strict';

// Rediscover: music you played a lot or rated highly but have not played for a
// long time. One pass over the Media Library with the active statistics
// backend's fields (PlaybackStatsSource.fields()), then scored in memory:
//
//   affinity  = log2(1 + plays) + rating boost (4 stars +1, 5 stars +2, loved +1.5)
//   staleness = clamp((days since last play - gap) / 365, 0, 3)
//   score     = affinity x staleness
//
// Albums sum their tracks' plays and take the median days-since-last-play for
// staleness; an album with any track played inside the gap is left out.
//
// Settings and the "not interested" list live in config/rediscover.json so the
// Quick switcher command uses the same choices as the panel. rediscover_panel.js
// is the only writer.
//
// Needs shared/playback_stats_source.js included first.
if (typeof RivageRediscover === 'undefined') {
    var RivageRediscover = (function () {
        var SEP = '\u001f';
        var DAY_MS = 86400000;
        var SCAN_MAX_AGE_MS = 24 * 3600 * 1000;
        var CONFIG_DIRECTORY = fb.ProfilePath + 'jsplitter\\rivage\\config\\';
        var CONFIG_FILE = CONFIG_DIRECTORY + 'rediscover.json';
        var LOVED = '$if2(%lfm_loved%,$if2(%smp_loved%,%lastfm_loved%))';
        var META = '[%album artist%]' + SEP + '[%album%]' + SEP + '[%artist%]' + SEP + '[%title%]' + SEP + '[%date%]';

        var GAP_CHOICES = [3, 6, 12, 24];
        var MIX_CHOICES = [15, 25, 50];
        var DEFAULTS = { mode: 'albums', minPlays: 5, gapMonths: 12, ratingWeight: true, mixSize: 25 };
        var RANK_LIMIT = 100;

        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[RVG Rediscover] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function fold(value) {
            var s = String(value || '').toLowerCase();
            try { s = s.normalize('NFD').replace(/[\u0300-\u036F]/g, ''); } catch (e) { }
            return s.replace(/\s+/g, ' ').trim();
        }

        function clamp(value, minimum, maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        // ---------------------------------------------------------------
        // Settings and exclusions (config file)

        function normaliseSettings(raw) {
            raw = raw || {};
            var out = {
                mode: raw.mode === 'tracks' ? 'tracks' : 'albums',
                minPlays: clamp(Math.round(Number(raw.minPlays) || DEFAULTS.minPlays), 1, 100),
                gapMonths: GAP_CHOICES.indexOf(Number(raw.gapMonths)) >= 0 ? Number(raw.gapMonths) : DEFAULTS.gapMonths,
                ratingWeight: raw.ratingWeight === undefined ? DEFAULTS.ratingWeight : !!raw.ratingWeight,
                mixSize: MIX_CHOICES.indexOf(Number(raw.mixSize)) >= 0 ? Number(raw.mixSize) : DEFAULTS.mixSize
            };
            return out;
        }

        function readConfig() {
            var parsed = null;
            try {
                if (utils.IsFile(CONFIG_FILE)) parsed = JSON.parse(utils.ReadTextFile(CONFIG_FILE, 65001) || '{}');
            } catch (e) {
                reportFailure('config/rediscover.json could not be read', e);
            }
            parsed = parsed || {};
            var excluded = {};
            if (parsed.excluded && typeof parsed.excluded === 'object') {
                for (var key in parsed.excluded) {
                    if (Object.prototype.hasOwnProperty.call(parsed.excluded, key)) excluded[key] = String(parsed.excluded[key] || key);
                }
            }
            return { settings: normaliseSettings(parsed.settings), excluded: excluded };
        }

        // Panel only.
        function writeConfig(config) {
            try {
                utils.CreateFolder(CONFIG_DIRECTORY);
                var text = JSON.stringify({ settings: normaliseSettings(config.settings), excluded: config.excluded || {} }, null, 1);
                if (utils.WriteTextFile(CONFIG_FILE, text, false) === false) throw new Error('WriteTextFile returned false');
                return true;
            } catch (e) {
                reportFailure('config/rediscover.json could not be written', e);
                return false;
            }
        }

        // ---------------------------------------------------------------
        // Library scan

        var scanCache = null;

        // "2026-09-25 22:47:00" (or just the date) as local time; null when absent.
        function parseStamp(text) {
            var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text || ''));
            if (!m) return null;
            var t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
            return isFinite(t) ? t : null;
        }

        // The latest real timestamp of several; future values (a "now" placeholder
        // for the playing track) are ignored.
        function latestStamp(values, now) {
            var best = null;
            for (var i = 0; i < values.length; i++) {
                var t = parseStamp(values[i]);
                if (t !== null && t <= now + 60000 && (best === null || t > best)) best = t;
            }
            return best;
        }

        // One row per library track that has been played at least once.
        function scan(force) {
            var fields = PlaybackStatsSource.fields();
            var now = Date.now();
            var handles;
            try { handles = fb.GetLibraryItems(); } catch (e) { reportFailure('the library could not be read', e); return null; }
            var signature = fields.source + '|' + handles.Count;
            if (!force && scanCache && scanCache.signature === signature && now - scanCache.at < SCAN_MAX_AGE_MS) {
                return scanCache;
            }
            var t0 = Date.now();
            var stats, meta;
            try {
                // Every place a play can be recorded, so plays from other devices
                // (scrobbles) count: highest play count, latest last-played.
                var h = fields.history;
                stats = fb.TitleFormat('[' + fields.plays + ']' + SEP + '[' + fields.last + ']' + SEP +
                    '[' + fields.rating + ']' + SEP + '[' + LOVED + ']' + SEP +
                    '[' + h.plays + ']' + SEP + '[' + h.last + ']' + SEP + (h.enhancedLast ? '[' + h.enhancedLast + ']' : '')
                ).EvalWithMetadbs(handles);
            } catch (e2) {
                reportFailure('play statistics could not be read', e2);
                return null;
            }
            var t1 = Date.now();
            var rows = [];
            var wanted = [];
            for (var i = 0; i < handles.Count; i++) {
                var f = String(stats[i]).split(SEP);
                var plays = Math.max(parseInt(f[0], 10) || 0, parseInt(f[4], 10) || 0);
                if (plays <= 0) continue;
                var last = latestStamp([f[1], f[5], f[6]], now);
                if (last === null) continue;
                var rating = parseFloat(f[2]);
                rows.push({ i: i, plays: plays, last: last, rating: isFinite(rating) ? rating : 0, loved: f[3] === '1' });
                wanted.push(i);
            }
            // Tags only for tracks that have plays: usually a fraction of the library.
            var subset = new FbMetadbHandleList();
            for (i = 0; i < wanted.length; i++) subset.Add(handles[wanted[i]]);
            try {
                meta = fb.TitleFormat(META).EvalWithMetadbs(subset);
            } catch (e3) {
                reportFailure('tags could not be read', e3);
                return null;
            }
            for (i = 0; i < rows.length; i++) {
                var m = String(meta[i]).split(SEP);
                var albumArtist = m[0] || m[2] || '';
                rows[i].album = m[1] || '';
                rows[i].albumArtist = albumArtist;
                rows[i].artist = m[2] || albumArtist;
                rows[i].title = m[3] || '';
                rows[i].year = (m[4] || '').slice(0, 4);
                rows[i].albumKey = rows[i].album ? 'album:' + fold(albumArtist) + SEP + fold(rows[i].album) : '';
                rows[i].trackKey = 'track:' + fold(rows[i].artist) + SEP + fold(rows[i].title) + SEP + fold(rows[i].album);
            }
            var t2 = Date.now();
            scanCache = { signature: signature, at: now, handles: handles, rows: rows, source: fields.source };
            try {
                console.log('[RVG Rediscover] read ' + handles.Count + ' tracks (' + rows.length + ' played) in ' +
                    (t2 - t0) + ' ms (statistics ' + (t1 - t0) + ' ms, tags ' + (t2 - t1) + ' ms)');
            } catch (e4) { }
            return scanCache;
        }

        function invalidate() {
            scanCache = null;
        }

        // ---------------------------------------------------------------
        // Scoring

        function ratingBoost(rating, loved, settings) {
            if (!settings.ratingWeight) return 0;
            var boost = rating >= 4.5 ? 2 : (rating >= 3.5 ? 1 : 0);
            return boost + (loved ? 1.5 : 0);
        }

        function median(values) {
            var sorted = values.slice().sort(function (a, b) { return a - b; });
            var mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        // Ranked entries, best first: { kind, key, title, artist, year, plays, last,
        // days, rating, loved, affinity, staleness, score, items: [library index] }.
        function rank(data, options) {
            options = options || {};
            var config = options.config || readConfig();
            var settings = normaliseSettings(options.settings || config.settings);
            var excluded = config.excluded || {};
            var mode = options.mode || settings.mode;
            var limit = options.limit || RANK_LIMIT;
            if (!data) return [];
            var now = Date.now();
            var gapDays = settings.gapMonths * 30.44;
            var out = [];
            var r, row, days;

            function push(entry) {
                entry.staleness = clamp((entry.days - gapDays) / 365, 0, 3);
                entry.affinity = Math.log(1 + entry.plays) / Math.LN2 + ratingBoost(entry.rating, entry.loved, settings);
                entry.score = entry.affinity * entry.staleness;
                if (entry.score > 0) out.push(entry);
            }

            if (mode === 'tracks') {
                for (r = 0; r < data.rows.length; r++) {
                    row = data.rows[r];
                    if (row.plays < settings.minPlays || excluded[row.trackKey]) continue;
                    if (row.albumKey && excluded[row.albumKey]) continue;
                    days = (now - row.last) / DAY_MS;
                    if (days < gapDays) continue;
                    push({ kind: 'track', key: row.trackKey, title: row.title || '(untitled)', artist: row.artist,
                        album: row.album, year: row.year, plays: row.plays, last: row.last, days: days,
                        rating: row.rating, loved: row.loved, items: [row.i] });
                }
            } else {
                var groups = Object.create(null);
                for (r = 0; r < data.rows.length; r++) {
                    row = data.rows[r];
                    if (!row.albumKey) continue;
                    var g = groups[row.albumKey];
                    if (!g) {
                        g = groups[row.albumKey] = { key: row.albumKey, title: row.album, artist: row.albumArtist,
                            year: row.year, plays: 0, lasts: [], newest: 0, rated: [], loved: false, items: [] };
                    }
                    g.plays += row.plays;
                    g.lasts.push(row.last);
                    g.newest = Math.max(g.newest, row.last);
                    if (row.rating > 0) g.rated.push(row.rating);
                    if (row.loved) g.loved = true;
                    g.items.push(row.i);
                }
                for (var key in groups) {
                    var group = groups[key];
                    if (group.plays < settings.minPlays || excluded[key]) continue;
                    if ((now - group.newest) / DAY_MS < gapDays) continue;
                    var rating = 0;
                    for (var k = 0; k < group.rated.length; k++) rating += group.rated[k];
                    rating = group.rated.length ? rating / group.rated.length : 0;
                    var lastMedian = median(group.lasts);
                    push({ kind: 'album', key: key, title: group.title, artist: group.artist, year: group.year,
                        plays: group.plays, last: group.newest, days: (now - lastMedian) / DAY_MS,
                        rating: rating, loved: group.loved, items: group.items, tracks: group.items.length });
                }
            }
            out.sort(function (a, b) { return b.score - a.score || b.plays - a.plays; });
            return out.length > limit ? out.slice(0, limit) : out;
        }

        // ---------------------------------------------------------------
        // Handles and the mix

        var TF_ALBUM_ORDER = '%album artist%|%album%|%discnumber%|%tracknumber%';

        function handlesFor(data, entry) {
            var list = new FbMetadbHandleList();
            if (!data || !entry) return list;
            for (var i = 0; i < entry.items.length; i++) {
                try { list.Add(data.handles[entry.items[i]]); } catch (e) { }
            }
            if (entry.kind === 'album' && list.Count > 1) {
                try { list.OrderByFormat(fb.TitleFormat(TF_ALBUM_ORDER), 1); } catch (e2) { }
            }
            return list;
        }

        // About mixSize tracks drawn from the top 100 tracks, weighted by score, at
        // most two per album, in random order.
        function mix(data, options) {
            options = options || {};
            var config = options.config || readConfig();
            var settings = normaliseSettings(options.settings || config.settings);
            var pool = rank(data, { config: config, settings: settings, mode: 'tracks', limit: RANK_LIMIT });
            var picked = [];
            var perAlbum = Object.create(null);
            var byTrack = Object.create(null);
            var rowsByIndex = Object.create(null);
            var i;
            for (i = 0; i < data.rows.length; i++) rowsByIndex[data.rows[i].i] = data.rows[i];
            while (picked.length < settings.mixSize && pool.length) {
                var total = 0;
                for (i = 0; i < pool.length; i++) total += pool[i].score;
                var target = Math.random() * total;
                var at = 0;
                for (i = 0; i < pool.length - 1; i++) {
                    target -= pool[i].score;
                    if (target <= 0) break;
                }
                at = i;
                var entry = pool.splice(at, 1)[0];
                var row = rowsByIndex[entry.items[0]];
                var albumKey = row && row.albumKey ? row.albumKey : entry.key;
                if ((perAlbum[albumKey] || 0) >= 2 || byTrack[entry.key]) continue;
                perAlbum[albumKey] = (perAlbum[albumKey] || 0) + 1;
                byTrack[entry.key] = true;
                picked.push(entry);
            }
            for (i = picked.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var swap = picked[i]; picked[i] = picked[j]; picked[j] = swap;
            }
            var list = new FbMetadbHandleList();
            for (i = 0; i < picked.length; i++) {
                try { list.Add(data.handles[picked[i].items[0]]); } catch (e) { }
            }
            return list;
        }

        // For the Quick switcher: scan (cached), build a mix and play it.
        function playMix() {
            var data = scan(false);
            var handles = mix(data);
            if (!handles.Count) {
                try {
                    fb.ShowPopupMessage('Nothing to rediscover yet: no track or album with enough plays that you ' +
                        'have not heard for a while. Try a shorter "not played for" in Settings > Rediscover.', 'Rediscover');
                } catch (e) { }
                return false;
            }
            return RivageLibraryActions.play(handles);
        }

        return {
            GAP_CHOICES: GAP_CHOICES,
            MIX_CHOICES: MIX_CHOICES,
            DEFAULTS: DEFAULTS,
            normaliseSettings: normaliseSettings,
            readConfig: readConfig,
            writeConfig: writeConfig,
            scan: scan,
            invalidate: invalidate,
            rank: rank,
            handlesFor: handlesFor,
            mix: mix,
            playMix: playMix
        };
    })();
}
