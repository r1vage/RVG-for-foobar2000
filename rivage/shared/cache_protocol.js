'use strict';

// Disk caches: the catalogue the Storage sub-tab of Global settings measures,
// and the clear request it sends to whichever panel owns each folder. The
// owner clears its in-memory copy too, otherwise its next save would rewrite
// the file; with no owner loaded, the settings panel recycles the folder itself.
if (typeof CacheProtocol === 'undefined') {
    var CacheProtocol = (function () {
        var PREFIX = 'RIVAGE.CACHE.V1.';
        var CLEAR = PREFIX + 'CLEAR';
        var CLEARED = PREFIX + 'CLEARED';

        // Keep `dir` in step with each owner's CACHE_DIR constant.
        var CACHES = [
            { id: 'discography', label: 'Discography & Calendar',
              dir: fb.ProfilePath + 'jsplitter_discography_cache\\',
              hint: 'MusicBrainz release lists per artist, and the release calendar' },
            { id: 'lastfmCharts', label: 'Last.fm charts',
              dir: fb.ProfilePath + 'jsplitter_lastfm_charts_cache\\',
              hint: 'Last.fm chart responses' },
            { id: 'liveShows', label: 'Live shows',
              dir: fb.ProfilePath + 'jsplitter_live_shows_cache\\',
              hint: 'Upcoming concerts per artist' },
            { id: 'musicbrainzTagger', label: 'MusicBrainz tagger',
              dir: fb.ProfilePath + 'jsplitter_musicbrainz_cache\\',
              hint: 'Full release lookups' }
        ];

        function send(name, payload) {
            try {
                window.NotifyOthers(name, payload);
                return true;
            } catch (e) {
                return false;
            }
        }

        function find(id) {
            for (var i = 0; i < CACHES.length; i++) {
                if (CACHES[i].id === id) return CACHES[i];
            }
            return null;
        }

        function requestClear(id, token) {
            return send(CLEAR, { id: String(id), token: Number(token) || 0 });
        }

        // Owner side: runs clearFn when the request names ownId, then acks.
        function consumeClear(name, info, ownId, clearFn) {
            if (name !== CLEAR || !info || info.id !== ownId) return false;
            try {
                clearFn();
            } finally {
                send(CLEARED, { id: ownId, token: Number(info.token) || 0 });
            }
            return true;
        }

        function parseCleared(name, info) {
            if (name !== CLEARED || !info || typeof info.id !== 'string') return null;
            return { id: info.id, token: Number(info.token) || 0 };
        }

        return {
            CACHES: CACHES,
            find: find,
            requestClear: requestClear,
            consumeClear: consumeClear,
            parseCleared: parseCleared
        };
    })();
}
