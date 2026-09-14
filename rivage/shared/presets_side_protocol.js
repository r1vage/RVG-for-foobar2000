'use strict';

// tab-switcher-right.js owns persistence. Re-entry preserves request/set retry state.
if (typeof PresetsSideProtocol === 'undefined') {
    var PresetsSideProtocol = (function () {
        var UPDATE = 'RIVAGE.PRESETS_SIDE.UPDATE';
        var REQUEST = 'RIVAGE.PRESETS_SIDE.REQUEST';
        var SET = 'RIVAGE.PRESETS_SIDE.SET';
        var LEFT = 'left';
        var RIGHT = 'right';
        var MAX_ATTEMPTS = 25;
        var FAST_ATTEMPTS = 10;
        var FAST_DELAY = 100;
        var SLOW_DELAY = 500;

        var answered = false;
        var attempts = 0;

        // Narrow failure reporting. The empty catches here guard broadcasts,
        // retry-timer schedules, or consumer callbacks - each a real failure
        // with no other trace. Repeats are counted and re-logged only at
        // powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[PresetsSideProtocol] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }
        var pendingSet = null;
        var setAttempts = 0;
        var setGeneration = 0;

        // Anything that is not the right side reads as the left side, so a
        // missing or malformed property keeps the original layout.
        function normalise(value) {
            return String(value == null ? '' : value).toLowerCase() === RIGHT ? RIGHT : LEFT;
        }

        function notify(name, payload) {
            try {
                window.NotifyOthers(name, payload);
            } catch (e) { reportFailure('the presets-side broadcast could not be sent', e); }
        }

        function broadcast(side) {
            notify(UPDATE, normalise(side));
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
            } catch (e) { reportFailure('the presets-side retry could not be scheduled', e); }
        }

        function requestUntilAnswered() {
            answered = false;
            attempts = 0;
            request();
            scheduleRequest();
        }

        function scheduleSet(generation) {
            if (generation !== setGeneration || pendingSet === null || setAttempts >= MAX_ATTEMPTS) return;

            var delay = setAttempts < FAST_ATTEMPTS ? FAST_DELAY : SLOW_DELAY;
            setAttempts++;

            try {
                window.SetTimeout(function () {
                    if (generation !== setGeneration || pendingSet === null) return;
                    notify(SET, pendingSet);
                    scheduleSet(generation);
                }, delay);
            } catch (e) { reportFailure('the presets-side set could not be scheduled', e); }
        }

        function setUntilAnswered(side) {
            pendingSet = normalise(side);
            setAttempts = 0;
            setGeneration++;
            var generation = setGeneration;
            notify(SET, pendingSet);
            scheduleSet(generation);
        }

        function consume(name, info, callback) {
            if (name !== UPDATE) return false;
            if (typeof info !== 'string') return true;

            answered = true;
            var side = normalise(info);
            if (pendingSet !== null) {
                if (side !== pendingSet) return true;
                pendingSet = null;
                setGeneration++;
            }

            callback(side);
            return true;
        }

        function consumeSet(name, info, callback) {
            if (name !== SET) return false;
            if (typeof info !== 'string') return true;
            callback(normalise(info));
            return true;
        }

        return {
            Side: { Left: LEFT, Right: RIGHT },
            normalise: normalise,
            broadcast: broadcast,
            requestUntilAnswered: requestUntilAnswered,
            setUntilAnswered: setUntilAnswered,
            consume: consume,
            consumeSet: consumeSet,
            isRequest: function (name) {
                return name === REQUEST;
            }
        };
    }());
}
