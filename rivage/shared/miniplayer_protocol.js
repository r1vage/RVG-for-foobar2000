'use strict';

// Mini Player protocol v2.1.0.
//
// tab-switcher-right.js owns persistence for the shared Mini Player settings.
// The root splitter and compact panel are read-only consumers. Settings use a
// request/update handshake so panel load order does not matter.
//
// The enter/exit messages remain fire-and-forget because root_splitter.js is
// the sole owner of the layout swap and main-window geometry.

var MINI_PLAYER_ENTER = 'RIVAGE.MINI_PLAYER.ENTER';
var MINI_PLAYER_EXIT = 'RIVAGE.MINI_PLAYER.EXIT';
var MINI_PLAYER_STATE = 'RIVAGE.MINI_PLAYER.STATE';

if (typeof MiniPlayerProtocol === 'undefined') {
    var MiniPlayerProtocol = (function () {
        var SETTINGS_UPDATE = 'RIVAGE.MINI_PLAYER.SETTINGS.UPDATE';
        var SETTINGS_REQUEST = 'RIVAGE.MINI_PLAYER.SETTINGS.REQUEST';

        var MAX_ATTEMPTS = 25;
        var FAST_ATTEMPTS = 10;
        var FAST_DELAY = 100;
        var SLOW_DELAY = 500;

        var settingsAnswered = false;
        var settingsAttempts = 0;
        var settingsGeneration = 0;

        // Narrow failure reporting. The empty catches here guard broadcasts,
        // retry-timer schedules, or consumer callbacks - each a real failure
        // with no other trace. Repeats are counted and re-logged only at
        // powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[MiniPlayerProtocol] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function asBoolean(value, fallback) {
            if (value === true || value === 1 || value === '1' || value === 'true') return true;
            if (value === false || value === 0 || value === '0' || value === 'false') return false;
            return !!fallback;
        }

        function defaultSettings() {
            return {
                lockWindowSize: false,
                alwaysOnTop: true,
                restoreAlwaysOnTop: true,
                restoreLockWindowSize: true,
                showMidpointMark: true,
                showLoveButton: true,
                showRating: true
            };
        }

        function normaliseSettings(value, fallback) {
            var base = fallback && typeof fallback === 'object'
                ? normaliseSettings(fallback)
                : defaultSettings();
            var source = value && typeof value === 'object' ? value : {};

            return {
                lockWindowSize: asBoolean(source.lockWindowSize, base.lockWindowSize),
                alwaysOnTop: asBoolean(source.alwaysOnTop, base.alwaysOnTop),
                restoreAlwaysOnTop: asBoolean(source.restoreAlwaysOnTop, base.restoreAlwaysOnTop),
                restoreLockWindowSize: asBoolean(source.restoreLockWindowSize, base.restoreLockWindowSize),
                showMidpointMark: asBoolean(source.showMidpointMark, base.showMidpointMark),
                showLoveButton: asBoolean(source.showLoveButton, base.showLoveButton),
                showRating: asBoolean(source.showRating, base.showRating)
            };
        }

        function notify(name, payload) {
            try {
                window.NotifyOthers(name, payload);
                return true;
            } catch (e) {
                return false;
            }
        }

        function sendSettingsRequest(generation) {
            if (settingsAnswered || generation !== settingsGeneration) return;
            notify(SETTINGS_REQUEST, 0);
        }

        function scheduleSettingsRequest(generation) {
            if (settingsAnswered || generation !== settingsGeneration ||
                settingsAttempts >= MAX_ATTEMPTS) return;

            var delay = settingsAttempts < FAST_ATTEMPTS ? FAST_DELAY : SLOW_DELAY;
            settingsAttempts++;

            try {
                window.SetTimeout(function () {
                    if (settingsAnswered || generation !== settingsGeneration) return;
                    sendSettingsRequest(generation);
                    scheduleSettingsRequest(generation);
                }, delay);
            } catch (e) { reportFailure('the Mini Player settings retry could not be scheduled', e); }
        }

        function requestSettings() {
            settingsAnswered = false;
            settingsAttempts = 0;
            settingsGeneration++;

            var generation = settingsGeneration;
            sendSettingsRequest(generation);
            scheduleSettingsRequest(generation);
            return true;
        }

        function broadcastSettings(settings) {
            return notify(SETTINGS_UPDATE, normaliseSettings(settings));
        }

        function consumeSettings(name, info, callback) {
            if (name !== SETTINGS_UPDATE) return false;

            if (!info || typeof info !== 'object') return true;

            settingsAnswered = true;
            settingsGeneration++;

            var settings = normaliseSettings(info);
            try {
                if (typeof callback === 'function') callback(settings);
            } catch (e) { reportFailure('the Mini Player settings callback failed', e); }
            return true;
        }

        return {
            defaultSettings: defaultSettings,
            normaliseSettings: normaliseSettings,

            requestEnter: function () {
                return notify(MINI_PLAYER_ENTER, 0);
            },

            requestExit: function () {
                return notify(MINI_PLAYER_EXIT, 0);
            },

            broadcastState: function (active) {
                return notify(MINI_PLAYER_STATE, !!active);
            },

            isEnter: function (name) {
                return name === MINI_PLAYER_ENTER;
            },

            isExit: function (name) {
                return name === MINI_PLAYER_EXIT;
            },

            consumeState: function (name, info, callback) {
                if (name !== MINI_PLAYER_STATE) return false;
                try {
                    if (typeof callback === 'function') callback(!!info);
                } catch (e) { reportFailure('the Mini Player state callback failed', e); }
                return true;
            },

            requestSettings: requestSettings,
            broadcastSettings: broadcastSettings,
            consumeSettings: consumeSettings,

            isSettingsRequest: function (name) {
                return name === SETTINGS_REQUEST;
            }
        };
    }());
}
