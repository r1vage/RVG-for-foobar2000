'use strict';

// The tabs controller is the sole producer. UPDATE carries copied JSON data;
// consumers ignore malformed/duplicate payloads and repeated includes preserve state.
var SHARED_RIVAGE_THEME_UPDATE = 'SHARED_RIVAGE_THEME.UPDATE';
var SHARED_RIVAGE_THEME_REQUEST = 'SHARED_RIVAGE_THEME.REQUEST';

if (typeof SharedThemeProtocol === 'undefined') {
    var SharedThemeProtocol = (function () {
        // Narrow failure reporting. Most empty catches in this file guard a
        // callback fallback chain or window.Repaint calls that are expected to
        // fail and stay silent on purpose. This is for the few that mean
        // something is actually broken and would otherwise leave no trace -
        // chiefly the broadcasts every panel's shared theme depends on. Repeats
        // are counted and re-logged only at powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[SharedThemeProtocol] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        var VALID_MODES = {
            existing: true,
            host: true,
            dark: true,
            light: true,
            'album-auto': true,
            'album-dark': true,
            'album-light': true
        };
        var REQUIRED_SCHEME_KEYS = [
            'background', 'primary', 'onPrimary', 'onSurface',
            'onSurfaceVariant', 'outline', 'outlineVariant'
        ];
        var current = {
            version: 1,
            mode: 'existing',
            accent: 0xff0078d4,
            source: 0xff0078d4,
            light: null,
            dark: null,
            hasArtwork: false,
            key: ''
        };
        var currentWire = JSON.stringify(current);
        var currentValid = false;
        var rivageAppliedWire = null;

        function isObject(value) {
            return !!value && typeof value === 'object' && !Array.isArray(value);
        }

        function isColour(value) {
            return typeof value === 'number' && isFinite(value) &&
                Math.floor(value) === value && value >= -2147483648 && value <= 4294967295;
        }

        function opaque(colour) {
            return ((colour & 0x00ffffff) | 0xff000000) >>> 0;
        }

        function normaliseMode(mode) {
            try { mode = String(mode || 'existing').toLowerCase(); }
            catch (e) { return 'existing'; }
            return VALID_MODES[mode] ? mode : 'existing';
        }

        function cloneJson(value) {
            try { return JSON.parse(JSON.stringify(value)); }
            catch (e) { return null; }
        }

        function copyScheme(scheme) {
            if (!isObject(scheme)) return null;

            var keys = [];
            var key;
            for (key in scheme) {
                if (Object.prototype.hasOwnProperty.call(scheme, key)) keys.push(key);
            }
            keys.sort();

            var copy = {};
            for (var i = 0; i < keys.length; i++) {
                key = keys[i];
                if (!isColour(scheme[key])) return null;
                copy[key] = opaque(scheme[key]);
            }
            for (i = 0; i < REQUIRED_SCHEME_KEYS.length; i++) {
                if (copy[REQUIRED_SCHEME_KEYS[i]] === undefined) return null;
            }
            return copy;
        }

        function copyPayload(payload) {
            var source = payload;
            try {
                if (typeof source === 'string') source = JSON.parse(source);
                else source = cloneJson(source);
                if (!isObject(source) || source.version !== 1 ||
                    typeof source.mode !== 'string' || !VALID_MODES[source.mode.toLowerCase()] ||
                    !isColour(source.accent) || !isColour(source.source) ||
                    typeof source.hasArtwork !== 'boolean' || typeof source.key !== 'string') return null;

                var light = copyScheme(source.light);
                var dark = copyScheme(source.dark);
                if (!light || !dark) return null;

                return {
                    version: 1,
                    mode: source.mode.toLowerCase(),
                    accent: opaque(source.accent),
                    source: opaque(source.source),
                    light: light,
                    dark: dark,
                    hasArtwork: source.hasArtwork,
                    key: source.key
                };
            } catch (e) {
                return null;
            }
        }

        function applyToRivage(payload, wire) {
            if (rivageAppliedWire === wire) return false;
            try {
                if (typeof RivageUI !== 'undefined' && RivageUI &&
                    typeof RivageUI.setSharedTheme === 'function') {
                    RivageUI.setSharedTheme(payload);
                    rivageAppliedWire = wire;
                    return true;
                }
            } catch (e) { reportFailure('the shared theme could not be applied to this panel', e); }
            return false;
        }

        function adopt(payload) {
            var copy = copyPayload(payload);
            if (!copy) return null;

            var wire = JSON.stringify(copy);
            var changed = !currentValid || wire !== currentWire;
            if (changed) {
                current = copy;
                currentWire = wire;
                currentValid = true;
            }
            return {
                changed: changed,
                applied: applyToRivage(current, currentWire)
            };
        }

        function refreshPanel() {
            try {
                if (typeof on_colours_changed === 'function') {
                    on_colours_changed();
                    return;
                }
            } catch (e) { }
            try { window.Repaint(true); } catch (e2) {
                try { window.Repaint(); } catch (e3) { }
            }
        }

        function notifyConsumer(callback) {
            try {
                if (typeof callback === 'function') callback(cloneJson(current));
                else refreshPanel();
            } catch (e) {
                refreshPanel();
            }
        }

        return {
            normaliseMode: normaliseMode,

            current: function () {
                return cloneJson(current);
            },

            broadcast: function (payload) {
                var result = adopt(payload);
                if (!result) return false;
                try { window.NotifyOthers(SHARED_RIVAGE_THEME_UPDATE, currentWire); } catch (e) { reportFailure('the shared theme update could not be broadcast', e); }
                return true;
            },

            request: function () {
                try { window.NotifyOthers(SHARED_RIVAGE_THEME_REQUEST, 0); } catch (e) { reportFailure('the shared theme could not be requested', e); }
            },

            consume: function (name, info, callback) {
                if (name !== SHARED_RIVAGE_THEME_UPDATE) return false;

                if (currentValid && typeof info === 'string' && info === currentWire) {
                    if (applyToRivage(current, currentWire)) notifyConsumer(callback);
                    return true;
                }

                var result = adopt(info);
                if (!result) return true;
                if (result.changed || result.applied) notifyConsumer(callback);
                return true;
            }
        };
    }());
}
