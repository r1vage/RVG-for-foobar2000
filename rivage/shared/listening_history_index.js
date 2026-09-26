'use strict';

// Listening history index for Rewind and the listening heatmap. Reads every
// library track's play timestamps from Enhanced Playback Statistics
// (%played_times_js% or %lastfm_played_times_js%) and keeps them as two parallel
// typed arrays - play time and track number - sorted by time, so any period can be
// summarised by scanning one range instead of re-reading tags.
//
// build() reads the library in chunks sized to ~30 ms of work each, between timer
// turns, so even a very large library never freezes foobar2000; update() then
// re-reads only the tracks whose metadata changed (a new play, a retag), so the
// index stays current without rebuilding.
//
// Main-thread only (fb, window timers). Include nothing else first.

if (typeof RivageListeningIndex === 'undefined') {
    var RivageListeningIndex = (function () {
        var SOURCE_LOCAL = 'local';
        var SOURCE_LASTFM = 'lastfm';
        var SEP = '\u001f';
        var DAY_MS = 86400000;
        // Work per timer turn while building; the chunk size adapts to hit it.
        var CHUNK_TARGET_MS = 30;
        var CHUNK_MIN = 500;
        var CHUNK_MAX = 50000;
        var CHUNK_START = 4000;
        // A bigger change (a rescan, a mass retag) is cheaper to rebuild.
        var UPDATE_MAX_TRACKS = 500;

        var TF_META = '[%artist%]' + SEP + '[%album artist%]' + SEP + '[%album%]' + SEP +
            '[%title%]' + SEP + '[%length_seconds%]' + SEP + '[%genre%]';

        function now() {
            try {
                if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
                    return performance.now();
                }
            } catch (e) { }
            return new Date().getTime();
        }

        function fold(text) {
            text = String(text || '').trim().toLowerCase();
            try { text = text.normalize('NFD').replace(/[\u0300-\u036F]/g, ''); } catch (e) { }
            return text;
        }

        function parseFoobarDate(value) {
            var text = String(value == null ? '' : value).trim();
            var match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(text);
            if (!match) return NaN;
            var ms = match[7] || '0';
            while (ms.length < 3) ms += '0';
            var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
                Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0), Number(ms.substr(0, 3)));
            var time = date.getTime();
            return isFinite(time) ? time : NaN;
        }

        // Accepts the JSON arrays Enhanced Playback Statistics produces: numbers
        // (the *_js fields, milliseconds) or formatted date strings. Unsorted.
        function parsePlayedTimes(text) {
            var out = [];
            text = String(text == null ? '' : text).trim();
            if (!text || text === '[]' || text === '?' || text === 'N/A' || text.charAt(0) !== '[') return out;
            var payload;
            try { payload = JSON.parse(text); } catch (e) { return out; }
            if (!(payload instanceof Array)) return out;
            for (var i = 0; i < payload.length; i++) {
                var value = payload[i];
                var ms = typeof value === 'number' ? value : parseFoobarDate(value);
                if (isFinite(ms) && ms > 0) out.push(ms);
            }
            return out;
        }

        // "Arkells feat. K.Flay" -> "Arkells". Only explicit featuring markers: an
        // "&" or "and" is often part of a band's own name.
        var FEATURING = /\s*[\(\[]?\s*\b(?:feat\.?|ft\.|featuring)\s.*$/i;
        function mainArtist(artist) {
            var main = String(artist || '').replace(FEATURING, '').trim();
            return main || String(artist || '');
        }

        // Multi-value genres arrive joined with ", "; many single tags use ";" or "/".
        function splitGenres(text) {
            var out = [];
            var seen = Object.create(null);
            var parts = String(text || '').split(/\s*[;,\/]\s*/);
            for (var i = 0; i < parts.length; i++) {
                var label = parts[i].trim();
                var key = fold(label);
                if (!key || seen[key]) continue;
                seen[key] = true;
                out.push({ key: key, label: label });
            }
            return out;
        }

        // The key and label the index gives an artist tag, so a panel can find the
        // playing track's artist in it (featured artists folded the same way).
        function artistKey(artist, foldFeatured) {
            var label = String(artist || '') || 'Unknown artist';
            if (foldFeatured) label = mainArtist(label);
            return { key: fold(label), label: label };
        }

        function playedTimesField(source) {
            return source === SOURCE_LASTFM ? '%lastfm_played_times_js%' : '%played_times_js%';
        }

        // Local calendar day, as a sortable number (20260925), so the heatmap and
        // streaks follow the listener's midnight rather than UTC.
        function dayNumber(ms) {
            var d = new Date(ms);
            return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        }

        function minOf(values) {
            var first = Infinity;
            for (var i = 0; i < values.length; i++) if (values[i] < first) first = values[i];
            return first;
        }

        // One track record from its meta line and parsed play times.
        function makeTrack(libraryIndex, metaLine, played, foldFeatured) {
            var meta = String(metaLine || '').split(SEP);
            var artist = meta[0] || 'Unknown artist';
            var albumArtist = meta[1] || artist;
            if (foldFeatured) {
                artist = mainArtist(artist);
                albumArtist = mainArtist(albumArtist);
            }
            return {
                libraryIndex: libraryIndex,
                artist: artist,
                artistKey: fold(artist),
                album: meta[2] || '',
                albumKey: meta[2] ? fold(albumArtist) + SEP + fold(meta[2]) : '',
                albumArtist: albumArtist,
                title: meta[3] || '',
                length: Number(meta[4]) || 0,
                genres: splitGenres(meta[5]),
                plays: played.length,
                first: minOf(played)
            };
        }

        // options: { source: 'local' | 'lastfm', foldFeatured: bool }
        // callbacks: { onDone(index), onError(message), onProgress(fraction) }
        // Returns { cancel() }. Every outcome is reported on a timer turn, after
        // build() has returned.
        function build(options, callbacks) {
            options = options || {};
            callbacks = callbacks || {};
            var source = options.source === SOURCE_LASTFM ? SOURCE_LASTFM : SOURCE_LOCAL;
            var foldFeatured = !!options.foldFeatured;
            var cancelled = false;
            var timer = null;
            var timings = { read: 0, evalTimes: 0, evalMeta: 0, parse: 0, sort: 0, total: 0, chunks: 0 };
            var started = now();
            var tfTimes = fb.TitleFormat(playedTimesField(source));
            var tfMeta = fb.TitleFormat(TF_META);

            function fail(message) {
                if (cancelled) return;
                cancelled = true;
                if (typeof callbacks.onError === 'function') callbacks.onError(message);
            }

            var job = {
                cancel: function () {
                    cancelled = true;
                    if (timer !== null) { try { window.ClearTimeout(timer); } catch (e) { } timer = null; }
                }
            };

            var handles, remaining, count;
            try {
                var t = now();
                handles = fb.GetLibraryItems();
                // Sorted, so update() can find a changed track with BSearch().
                handles.Sort();
                count = handles.Count;
                remaining = handles.Clone();
                timings.read = now() - t;
            } catch (e) {
                var readError = 'reading the library failed: ' + e;
                timer = window.SetTimeout(function () { timer = null; fail(readError); }, 0);
                return job;
            }

            var tracks = [];
            var trackOfLibrary = new Int32Array(count);
            for (var fill = 0; fill < count; fill++) trackOfLibrary[fill] = -1;
            var times = [];
            var trackOf = [];
            var cursor = 0;
            var chunkSize = CHUNK_START;

            function step() {
                timer = null;
                if (cancelled) return;
                var stepStart = now();
                try {
                    var chunk = remaining.Clone();
                    if (chunk.Count > chunkSize) chunk.RemoveRange(chunkSize, chunk.Count - chunkSize);
                    var n = chunk.Count;

                    var t = now();
                    var timesText = tfTimes.EvalWithMetadbs(chunk);
                    timings.evalTimes += now() - t;
                    t = now();
                    var metaText = tfMeta.EvalWithMetadbs(chunk);
                    timings.evalMeta += now() - t;

                    t = now();
                    for (var j = 0; j < n; j++) {
                        var played = parsePlayedTimes(timesText[j]);
                        if (!played.length) continue;
                        var trackIndex = tracks.length;
                        tracks.push(makeTrack(cursor + j, metaText[j], played, foldFeatured));
                        trackOfLibrary[cursor + j] = trackIndex;
                        for (var p = 0; p < played.length; p++) {
                            times.push(played[p]);
                            trackOf.push(trackIndex);
                        }
                    }
                    timings.parse += now() - t;

                    remaining.RemoveRange(0, n);
                    cursor += n;
                    timings.chunks++;
                } catch (e) {
                    fail('reading play history failed near library item ' + cursor + ': ' + e);
                    return;
                }

                // Aim the next chunk at the target time per turn.
                var took = Math.max(1, now() - stepStart);
                chunkSize = Math.round(Math.max(CHUNK_MIN, Math.min(CHUNK_MAX, chunkSize * CHUNK_TARGET_MS / took)));

                if (typeof callbacks.onProgress === 'function') {
                    try { callbacks.onProgress(count ? cursor / count : 1); } catch (e2) { }
                }
                if (cursor < count) {
                    timer = window.SetTimeout(step, 0);
                    return;
                }
                finish();
            }

            function finish() {
                var t = now();
                var sorted = sortEvents(times, trackOf);
                timings.sort = now() - t;
                timings.total = now() - started;
                times = trackOf = remaining = null;

                var index = {
                    source: source,
                    foldFeatured: foldFeatured,
                    builtAt: new Date().getTime(),
                    revision: 1,
                    libraryCount: count,
                    handles: handles,
                    tracks: tracks,
                    trackOfLibrary: trackOfLibrary,
                    eventTimes: sorted.times,
                    eventTracks: sorted.tracks,
                    timings: timings
                };
                cancelled = true;
                if (typeof callbacks.onDone === 'function') callbacks.onDone(index);
            }

            timer = window.SetTimeout(step, 0);
            return job;
        }

        function sortEvents(times, trackOf) {
            var n = times.length;
            var order = new Array(n);
            for (var i = 0; i < n; i++) order[i] = i;
            order.sort(function (a, b) { return times[a] - times[b]; });
            var eventTimes = new Float64Array(n);
            var eventTracks = new Int32Array(n);
            for (i = 0; i < n; i++) {
                eventTimes[i] = times[order[i]];
                eventTracks[i] = trackOf[order[i]];
            }
            return { times: eventTimes, tracks: eventTracks };
        }

        // Re-reads the given changed handles and patches the index in place.
        // Returns 'none' (nothing of ours changed), 'ok' (patched; index.revision
        // bumped) or 'rebuild' (too big a change, or the library itself changed).
        function update(index, changed) {
            if (!index || !changed) return 'none';
            var count = 0;
            try { count = changed.Count; } catch (e) { return 'none'; }
            if (!count) return 'none';
            if (count > UPDATE_MAX_TRACKS) return 'rebuild';

            var mine;
            try {
                // Only library tracks matter; the rest of the list is ignored.
                mine = changed.Clone();
                mine.Sort();
                mine.MakeIntersection(index.handles);
            } catch (e2) { return 'rebuild'; }
            if (!mine.Count) return 'none';

            var timesText, metaText;
            try {
                timesText = fb.TitleFormat(playedTimesField(index.source)).EvalWithMetadbs(mine);
                metaText = fb.TitleFormat(TF_META).EvalWithMetadbs(mine);
            } catch (e3) { return 'rebuild'; }

            var touched = Object.create(null);
            var addTimes = [];
            var addTracks = [];
            for (var i = 0; i < mine.Count; i++) {
                var position = index.handles.BSearch(mine[i]);
                if (position < 0) return 'rebuild';
                var played = parsePlayedTimes(timesText[i]);
                var trackIndex = index.trackOfLibrary[position];
                if (trackIndex < 0 && !played.length) continue;
                var record = makeTrack(position, metaText[i], played, index.foldFeatured);
                if (trackIndex < 0) {
                    trackIndex = index.tracks.length;
                    index.tracks.push(record);
                    index.trackOfLibrary[position] = trackIndex;
                } else {
                    index.tracks[trackIndex] = record;
                }
                touched[trackIndex] = true;
                for (var p = 0; p < played.length; p++) {
                    addTimes.push(played[p]);
                    addTracks.push(trackIndex);
                }
            }

            // Keep every event of untouched tracks (already in order), then merge in
            // the touched tracks' fresh events.
            var oldTimes = index.eventTimes;
            var oldTracks = index.eventTracks;
            var keptTimes = [];
            var keptTracks = [];
            for (i = 0; i < oldTimes.length; i++) {
                if (touched[oldTracks[i]]) continue;
                keptTimes.push(oldTimes[i]);
                keptTracks.push(oldTracks[i]);
            }
            var added = sortEvents(addTimes, addTracks);
            var total = keptTimes.length + added.times.length;
            var mergedTimes = new Float64Array(total);
            var mergedTracks = new Int32Array(total);
            var a = 0, b = 0, k = 0;
            while (a < keptTimes.length || b < added.times.length) {
                if (b >= added.times.length || (a < keptTimes.length && keptTimes[a] <= added.times[b])) {
                    mergedTimes[k] = keptTimes[a];
                    mergedTracks[k++] = keptTracks[a++];
                } else {
                    mergedTimes[k] = added.times[b];
                    mergedTracks[k++] = added.tracks[b++];
                }
            }
            index.eventTimes = mergedTimes;
            index.eventTracks = mergedTracks;
            index.revision++;
            firstPlayCache = null;
            return 'ok';
        }

        // First event at or after `time` (binary search over the sorted times).
        function lowerBound(times, time) {
            var lo = 0, hi = times.length;
            while (lo < hi) {
                var mid = (lo + hi) >>> 1;
                if (times[mid] < time) lo = mid + 1; else hi = mid;
            }
            return lo;
        }

        function sortedEntries(map) {
            var list = [];
            for (var key in map) {
                if (Object.prototype.hasOwnProperty.call(map, key)) list.push(map[key]);
            }
            list.sort(function (a, b) { return b.plays - a.plays || (a.label < b.label ? -1 : 1); });
            return list;
        }

        function rankMap(list) {
            var ranks = Object.create(null);
            for (var i = 0; i < list.length; i++) ranks[list[i].key] = i + 1;
            return ranks;
        }

        function bump(map, key, label, sub, trackIndex) {
            var entry = map[key];
            if (!entry) entry = map[key] = { key: key, label: label, sub: sub, plays: 0, tracks: [], seen: Object.create(null) };
            entry.plays++;
            if (!entry.seen[trackIndex]) {
                entry.seen[trackIndex] = true;
                entry.tracks.push(trackIndex);
            }
        }

        // Positions [start, end) of the plays inside [fromMs, toMs), for walking
        // index.eventTimes / index.eventTracks directly.
        function eventRange(index, fromMs, toMs) {
            return { start: lowerBound(index.eventTimes, fromMs), end: lowerBound(index.eventTimes, toMs) };
        }

        // Tracks played inside [fromMs, toMs), each once, in the order first played.
        // options.artistKey limits them to one artist.
        function tracksPlayedBetween(index, fromMs, toMs, options) {
            var artistKey = options && options.artistKey;
            var range = eventRange(index, fromMs, toMs);
            var seen = Object.create(null);
            var out = [];
            for (var i = range.start; i < range.end; i++) {
                var trackIndex = index.eventTracks[i];
                if (seen[trackIndex]) continue;
                if (artistKey && index.tracks[trackIndex].artistKey !== artistKey) continue;
                seen[trackIndex] = true;
                out.push(trackIndex);
            }
            return out;
        }

        // Everything Rewind shows for [fromMs, toMs).
        // options: a number (list limit) or { limit, artistKey } - artistKey keeps only
        // that artist's plays, for the artist drill-down.
        function summarise(index, fromMs, toMs, options) {
            if (typeof options === 'number') options = { limit: options };
            options = options || {};
            var limit = options.limit || 5;
            var artistKey = options.artistKey || '';
            var times = index.eventTimes;
            var owners = index.eventTracks;
            var tracks = index.tracks;
            var start = lowerBound(times, fromMs);
            var end = lowerBound(times, toMs);

            var artists = Object.create(null);
            var albums = Object.create(null);
            var songs = Object.create(null);
            var genres = Object.create(null);
            var days = Object.create(null);
            var months = Object.create(null);
            var weekdays = [0, 0, 0, 0, 0, 0, 0];
            var hours = new Array(24);
            for (var h = 0; h < 24; h++) hours[h] = 0;
            var seconds = 0;
            var plays = 0;
            var artistFirst = firstPlayByArtist(index);

            for (var i = start; i < end; i++) {
                var trackIndex = owners[i];
                var track = tracks[trackIndex];
                if (artistKey && track.artistKey !== artistKey) continue;
                plays++;
                var d = new Date(times[i]);
                var month = d.getFullYear() * 100 + d.getMonth() + 1;
                var day = month * 100 + d.getDate();
                days[day] = (days[day] || 0) + 1;
                months[month] = (months[month] || 0) + 1;
                weekdays[d.getDay()]++;
                hours[d.getHours()]++;
                seconds += track.length;
                bump(artists, track.artistKey, track.artist, '', trackIndex);
                if (track.albumKey) bump(albums, track.albumKey, track.album, track.albumArtist, trackIndex);
                bump(songs, String(trackIndex), track.title || '(untitled)', track.artist, trackIndex);
                for (var g = 0; g < track.genres.length; g++) {
                    bump(genres, track.genres[g].key, track.genres[g].label, '', trackIndex);
                }
            }

            var artistList = sortedEntries(artists);
            var albumList = sortedEntries(albums);
            var songList = sortedEntries(songs);
            var genreList = sortedEntries(genres);

            // Artists heard for the first time ever inside the period.
            var discoveries = [];
            for (i = 0; i < artistList.length; i++) {
                var firstPlay = artistFirst[artistList[i].key];
                if (firstPlay >= fromMs && firstPlay < toMs) discoveries.push(artistList[i]);
            }

            var dayKeys = Object.keys(days).map(Number).sort(function (x, y) { return x - y; });
            var busiestDay = null;
            for (i = 0; i < dayKeys.length; i++) {
                if (!busiestDay || days[dayKeys[i]] > busiestDay.plays) {
                    busiestDay = { day: dayKeys[i], plays: days[dayKeys[i]] };
                }
            }

            return {
                from: fromMs,
                to: toMs,
                artistKey: artistKey,
                plays: plays,
                distinctArtists: artistList.length,
                distinctAlbums: albumList.length,
                distinctTracks: songList.length,
                topArtists: artistList.slice(0, limit),
                topAlbums: albumList.slice(0, limit),
                topTracks: songList.slice(0, limit),
                topGenres: genreList.slice(0, limit),
                discoveries: discoveries.slice(0, limit),
                // Rank of every entry, for comparing with another period.
                ranks: {
                    artist: rankMap(artistList),
                    album: rankMap(albumList),
                    track: rankMap(songList),
                    genre: rankMap(genreList)
                },
                firstPlay: artistKey ? artistFirst[artistKey] : undefined,
                days: days,
                months: months,
                activeDays: dayKeys.length,
                longestStreak: longestStreak(dayKeys),
                busiestDay: busiestDay,
                weekdays: weekdays,
                hours: hours,
                listeningHours: seconds / 3600
            };
        }

        // Albums (or artists, options.kind = 'artist') played inside [fromMs, toMs)
        // after at least options.gapMs (default a year) without a play, most played
        // first. Each entry is a summarise() entry plus { firstInPeriod, lastBefore,
        // gapMs }. Never-heard-before music is a discovery, not a comeback.
        function comebacks(index, fromMs, toMs, options) {
            options = options || {};
            var limit = options.limit || 5;
            var gapMs = options.gapMs || 365 * DAY_MS;
            var byArtist = options.kind === 'artist';
            var artistKey = options.artistKey || '';
            var times = index.eventTimes;
            var owners = index.eventTracks;
            var tracks = index.tracks;
            var start = lowerBound(times, fromMs);
            var end = lowerBound(times, toMs);
            var map = Object.create(null);
            var i, track, key;

            function keyOf(t) {
                if (artistKey && t.artistKey !== artistKey) return '';
                return byArtist ? t.artistKey : t.albumKey;
            }

            for (i = start; i < end; i++) {
                track = tracks[owners[i]];
                key = keyOf(track);
                if (!key) continue;
                if (!map[key]) {
                    bump(map, key, byArtist ? track.artist : track.album, byArtist ? '' : track.albumArtist, owners[i]);
                    map[key].firstInPeriod = times[i];
                } else {
                    bump(map, key, '', '', owners[i]);
                }
            }
            // Latest play before the period, walking back until every key is answered.
            var open = Object.keys(map).length;
            for (i = start - 1; i >= 0 && open > 0; i--) {
                key = keyOf(tracks[owners[i]]);
                if (key && map[key] && map[key].lastBefore === undefined) {
                    map[key].lastBefore = times[i];
                    open--;
                }
            }
            var out = [];
            var list = sortedEntries(map);
            for (i = 0; i < list.length && out.length < limit; i++) {
                var entry = list[i];
                if (entry.lastBefore === undefined) continue;
                entry.gapMs = entry.firstInPeriod - entry.lastBefore;
                if (entry.gapMs >= gapMs) out.push(entry);
            }
            return out;
        }

        var firstPlayCache = null;
        function firstPlayByArtist(index) {
            if (firstPlayCache && firstPlayCache.index === index && firstPlayCache.revision === index.revision) {
                return firstPlayCache.map;
            }
            var map = Object.create(null);
            for (var i = 0; i < index.tracks.length; i++) {
                var track = index.tracks[i];
                if (!track.plays) continue;
                var known = map[track.artistKey];
                if (known === undefined || track.first < known) map[track.artistKey] = track.first;
            }
            firstPlayCache = { index: index, revision: index.revision, map: map };
            return map;
        }

        // dayKeys: sorted yyyymmdd numbers. Counts calendar-consecutive days.
        function longestStreak(dayKeys) {
            var best = 0, run = 0, bestEnd = 0, previous = null;
            for (var i = 0; i < dayKeys.length; i++) {
                var date = new Date(Math.floor(dayKeys[i] / 10000), Math.floor(dayKeys[i] / 100) % 100 - 1, dayKeys[i] % 100);
                if (previous && Math.round((date.getTime() - previous.getTime()) / DAY_MS) === 1) run++;
                else run = 1;
                if (run > best) { best = run; bestEnd = dayKeys[i]; }
                previous = date;
            }
            return { days: best, endDay: bestEnd };
        }

        return {
            version: '0.5.0',
            SOURCE_LOCAL: SOURCE_LOCAL,
            SOURCE_LASTFM: SOURCE_LASTFM,
            parsePlayedTimes: parsePlayedTimes,
            dayNumber: dayNumber,
            mainArtist: mainArtist,
            artistKey: artistKey,
            splitGenres: splitGenres,
            build: build,
            update: update,
            summarise: summarise,
            comebacks: comebacks,
            eventRange: eventRange,
            tracksPlayedBetween: tracksPlayedBetween
        };
    }());
}
