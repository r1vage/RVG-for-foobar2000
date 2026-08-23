'use strict';

// tab-switcher-right.js owns the shared credentials; consumers receive copied strings.
// Repeated includes preserve retry state so an older timer chain cannot be orphaned.
if (typeof LastfmCredentialsProtocol === 'undefined') {
    var LastfmCredentialsProtocol = (function () {
        var UPDATE = 'RIVAGE_LASTFM_CREDENTIALS.UPDATE';
        var REQUEST = 'RIVAGE_LASTFM_CREDENTIALS.REQUEST';
        var MAX_ATTEMPTS = 25;
        var FAST_ATTEMPTS = 10;
        var FAST_DELAY = 100;
        var SLOW_DELAY = 500;

        var answered = false;
        var attempts = 0;

        // Narrow failure reporting. All three empty catches here guard a
        // broadcast, a retry-timer schedule, or a consumer callback - each one
        // a real failure with no other trace, since a silent one here means the
        // shared Last.fm credentials simply never reach a panel. Repeats are
        // counted and re-logged only at powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[LastfmCredentialsProtocol] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function copyCredentials(value) {
            var source = value || {};
            return {
                apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
                username: typeof source.username === 'string' ? source.username : ''
            };
        }

        function parseCredentials(value) {
            if (!value || typeof value !== 'object' ||
                typeof value.apiKey !== 'string' || typeof value.username !== 'string') {
                return null;
            }
            return {
                apiKey: value.apiKey,
                username: value.username
            };
        }

        function notify(name, payload) {
            try {
                window.NotifyOthers(name, payload);
            } catch (e) { reportFailure('the Last.fm credentials broadcast could not be sent', e); }
        }

        function broadcast(credentials) {
            notify(UPDATE, copyCredentials(credentials));
        }

        function request() {
            notify(REQUEST, 0);
        }

        function scheduleRequest() {
            if (answered || attempts >= MAX_ATTEMPTS) return;

            var delay = attempts < FAST_ATTEMPTS ? FAST_DELAY : SLOW_DELAY;
            attempts++;

            try {
                window.SetTimeout(function () {
                    if (answered) return;
                    request();
                    scheduleRequest();
                }, delay);
            } catch (e) { reportFailure('the Last.fm credentials retry could not be scheduled', e); }
        }

        function requestUntilAnswered() {
            answered = false;
            attempts = 0;
            request();
            scheduleRequest();
        }

        function consume(name, info, callback) {
            if (name !== UPDATE) return false;

            var credentials = parseCredentials(info);
            if (!credentials) return true;

            answered = true;
            try {
                callback(credentials);
            } catch (e) { reportFailure('the Last.fm credentials callback failed', e); }
            return true;
        }

        return {
            broadcast: broadcast,
            requestUntilAnswered: requestUntilAnswered,
            consume: consume,
            isRequest: function (name) {
                return name === REQUEST;
            }
        };
    }());
}
