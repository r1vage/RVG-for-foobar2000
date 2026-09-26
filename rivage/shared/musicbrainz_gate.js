'use strict';

// MusicBrainz enforces its one-request-a-second limit per IP, not per panel.
// Discography and the tagger each pace themselves, so running both at once
// would double the rate and earn 503s. Each panel announces a request (and any
// backoff it was told to observe) and folds the others' announcements into its
// own wait, so together they stay under the limit.
if (typeof MusicBrainzGate === 'undefined') {
    var MusicBrainzGate = (function () {
        var NAME = 'RIVAGE.MUSICBRAINZ.V1.REQUEST';
        var othersLastRequestAt = 0;
        var othersBlockedUntil = 0;

        function announce(blockedUntil) {
            try {
                window.NotifyOthers(NAME, { at: Date.now(), blockedUntil: Number(blockedUntil) || 0 });
            } catch (e) { }
        }

        function consume(name, info) {
            if (name !== NAME) return false;
            if (info) {
                othersLastRequestAt = Math.max(othersLastRequestAt, Number(info.at) || 0);
                othersBlockedUntil = Math.max(othersBlockedUntil, Number(info.blockedUntil) || 0);
            }
            return true;
        }

        // Milliseconds this panel must still wait because of other panels.
        function wait(intervalMs, now) {
            return Math.max(0, intervalMs - (now - othersLastRequestAt), othersBlockedUntil - now);
        }

        return { announce: announce, consume: consume, wait: wait };
    })();
}
