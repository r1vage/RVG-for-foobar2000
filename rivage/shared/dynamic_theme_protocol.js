'use strict';

// The tabs controller is the sole producer. Normal artwork-derived changes use
// PREPARE -> compatibility accent -> COMMIT so all consumers swap semantic state
// from one shared notification edge. UPDATE remains the legacy/recovery path.
// All wire messages carry copied JSON data; malformed/duplicate payloads are ignored
// and repeated includes preserve state.
var SHARED_RIVAGE_THEME_UPDATE = 'SHARED_RIVAGE_THEME.UPDATE';
var SHARED_RIVAGE_THEME_PREPARE = 'SHARED_RIVAGE_THEME.PREPARE';
var SHARED_RIVAGE_THEME_COMMIT = 'SHARED_RIVAGE_THEME.COMMIT';
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
            'album-light': true,
            mica: true
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
            key: '',
            backdrop: null
        };
        var currentWire = JSON.stringify(current);
        var currentValid = false;
        var pending = null;
        var pendingWire = '';
        var pendingValid = false;
        var rivageAppliedWire = null;
        // Legacy UPDATE messages still use the old deferred lane for compatibility.
        // Normal artwork/theme changes use PREPARE -> accent -> COMMIT and never
        // depend on per-panel zero-delay timers.
        var consumerRefreshTimer = null;
        var pendingConsumerCallback = null;
        var repaintTimer = null;
        var commitDispatchDepth = 0;

        function multiply32(a, b) {
            if (typeof Math.imul === 'function') return Math.imul(a, b);
            var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
            var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
            return (al * bl + (((ah * bl + al * bh) & 0xffff) << 16)) | 0;
        }

        // COMMIT identifies the staged payload by digest instead of repeating it:
        // PREPARE already carried the wire, so re-sending both Material schemes
        // would double the traffic and the JSON.parse cost in every script context.
        function wireDigest(wire) {
            wire = String(wire == null ? '' : wire);
            var hash = 2166136261 >>> 0;
            for (var i = 0; i < wire.length; i++) {
                hash ^= wire.charCodeAt(i);
                hash = multiply32(hash, 16777619) >>> 0;
            }
            return ('00000000' + hash.toString(16)).slice(-8) + '-' + wire.length;
        }

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

        function copyBackdrop(backdrop) {
            if (backdrop === undefined || backdrop === null) return null;
            if (!isObject(backdrop) || backdrop.version !== 1 ||
                typeof backdrop.enabled !== 'boolean' || typeof backdrop.key !== 'string' ||
                typeof backdrop.path !== 'string' || !isFinite(Number(backdrop.blurRadius)) ||
                !isFinite(Number(backdrop.tintAlpha))) return false;

            var blurRadius = Math.round(Number(backdrop.blurRadius));
            var tintAlpha = Math.round(Number(backdrop.tintAlpha));
            if (blurRadius < 2 || blurRadius > 254 || tintAlpha < 0 || tintAlpha > 255) return false;
            if (backdrop.enabled && !backdrop.path) return false;

            return {
                version: 1,
                enabled: backdrop.enabled,
                key: backdrop.key,
                path: backdrop.enabled ? backdrop.path : '',
                blurRadius: blurRadius,
                tintAlpha: tintAlpha
            };
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
                var backdrop = copyBackdrop(source.backdrop);
                if (!light || !dark || backdrop === false) return null;

                return {
                    version: 1,
                    mode: source.mode.toLowerCase(),
                    accent: opaque(source.accent),
                    source: opaque(source.source),
                    light: light,
                    dark: dark,
                    hasArtwork: source.hasArtwork,
                    key: source.key,
                    backdrop: backdrop
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
                    // Tell the backdrop layer about the desired descriptor immediately,
                    // but let visible consumers retain their current native bitmap until
                    // the replacement has loaded successfully. This makes artwork changes
                    // transactional instead of exposing a solid fallback frame between
                    // two valid Mica images. Hidden consumers may release old file handles
                    // immediately because they cannot flash on screen.
                    try {
                        if (typeof RivageBackdrop !== 'undefined' && RivageBackdrop &&
                            typeof RivageBackdrop.onSharedThemeChanged === 'function') {
                            RivageBackdrop.onSharedThemeChanged(payload);
                        }
                    } catch (e2) { reportFailure('the shared backdrop change could not be applied', e2); }
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

        // Stage a semantic snapshot without exposing it to RivageUI yet. This is the
        // first half of the synchronized artwork-theme transaction: every consumer
        // receives PREPARE, then the compatibility accent, and only COMMIT makes the
        // new palette visible.
        function stage(payload) {
            var copy = copyPayload(payload);
            if (!copy) return null;
            pending = copy;
            pendingWire = JSON.stringify(copy);
            pendingValid = true;

            // Open the staged Mica image now. PREPARE reaches every script context in
            // one synchronous dispatch, so all panels decode here and the following
            // COMMIT swaps them together instead of each one decoding in its own paint.
            try {
                if (typeof RivageBackdrop !== 'undefined' && RivageBackdrop &&
                    typeof RivageBackdrop.prefetchSharedTheme === 'function') {
                    RivageBackdrop.prefetchSharedTheme(pending);
                }
            } catch (e) { reportFailure('the staged backdrop image could not be preloaded', e); }

            return { payload: pending, wire: pendingWire };
        }

        function clearPending() {
            pending = null;
            pendingWire = '';
            pendingValid = false;
        }

        function promotePending(info) {
            var staged = null;
            var wire = '';

            if (pendingValid && (info === undefined || info === null ||
                (typeof info === 'string' &&
                    (info === pendingWire || info === wireDigest(pendingWire))))) {
                staged = pending;
                wire = pendingWire;
            } else {
                // No matching stage: a context that missed this PREPARE keeps its
                // current palette rather than half-applying. The next PREPARE/COMMIT
                // pair re-syncs it, and startup request() covers one that never staged.
                var copy = copyPayload(info);
                if (!copy) return null;
                staged = copy;
                wire = JSON.stringify(copy);
            }

            var changed = !currentValid || wire !== currentWire;
            if (changed) {
                current = staged;
                currentWire = wire;
                currentValid = true;
            }

            if (pendingValid && pendingWire === wire) clearPending();
            return {
                changed: changed,
                applied: applyToRivage(current, currentWire),
                wire: currentWire
            };
        }

        function cancelQueuedRepaint() {
            if (repaintTimer === null) return;
            try {
                if (window && typeof window.ClearTimeout === 'function') window.ClearTimeout(repaintTimer);
            } catch (e) { }
            repaintTimer = null;
        }

        function requestRepaint() {
            // During COMMIT all script contexts are executing the same NotifyOthers
            // transaction. Invalidate immediately in that event turn instead of
            // starting an independent 0 ms timer in every panel. Windows may service
            // the resulting WM_PAINT messages independently, but every panel swaps
            // semantic state and queues its paint from one common commit edge.
            if (commitDispatchDepth > 0) {
                cancelQueuedRepaint();
                try { window.Repaint(); } catch (e) { }
                return true;
            }

            if (repaintTimer !== null) return true;

            var run = function () {
                repaintTimer = null;
                try { window.Repaint(); } catch (e) { }
            };

            try {
                if (window && typeof window.SetTimeout === 'function') {
                    repaintTimer = window.SetTimeout(run, 0);
                    return true;
                }
            } catch (e2) { repaintTimer = null; }

            run();
            return true;
        }

        function refreshPanel() {
            try {
                if (typeof on_colours_changed === 'function') {
                    on_colours_changed();
                    return;
                }
            } catch (e) { }
            requestRepaint();
        }

        function notifyConsumerNow(callback) {
            try {
                if (typeof callback === 'function') callback(cloneJson(current));
                else refreshPanel();
            } catch (e) {
                refreshPanel();
            }
        }

        // NotifyOthers delivery is synchronous enough that the compatibility accent
        // UPDATE can arrive in the same event turn as the semantic theme UPDATE.
        // Defer visual callbacks by one zero-delay turn so panels can adopt both
        // pieces of state first, then rebuild/repaint once from a coherent snapshot.
        function notifyConsumer(callback) {
            pendingConsumerCallback = typeof callback === 'function' ? callback : null;
            if (consumerRefreshTimer !== null) return;

            var run = function () {
                var pending = pendingConsumerCallback;
                pendingConsumerCallback = null;
                consumerRefreshTimer = null;
                notifyConsumerNow(pending);
            };

            try {
                if (window && typeof window.SetTimeout === 'function') {
                    consumerRefreshTimer = window.SetTimeout(run, 0);
                    return;
                }
            } catch (e) { consumerRefreshTimer = null; }

            run();
        }

        function isArtworkCommitMode(mode) {
            mode = normaliseMode(mode);
            // `existing` can still use the artwork-derived Shared accent. The
            // producer always publishes the semantic snapshot before the matching
            // compatibility accent, so consumers may suppress that second repaint
            // there too. Host/dark/light remain excluded because external accent
            // broadcasts are not necessarily part of their fixed-theme commit.
            return mode === 'existing' || mode === 'album-auto' || mode === 'album-dark' ||
                mode === 'album-light' || mode === 'mica';
        }

        // After the producer broadcasts the semantic theme first, compatibility
        // accent listeners can update their local accent variable but skip a second
        // visual refresh when that exact colour is already part of the pending
        // artwork-theme commit.
        function isAccentCommitted(colour) {
            if (!isColour(colour)) return false;

            // PREPARE arrives before the compatibility accent. Check the staged
            // snapshot first so legacy accent listeners can update their variable
            // without starting a separate visual wave before COMMIT.
            if (pendingValid && isArtworkCommitMode(pending.mode) &&
                opaque(colour) === opaque(pending.accent)) return true;

            if (!currentValid || !isArtworkCommitMode(current.mode)) return false;
            return opaque(colour) === opaque(current.accent);
        }

        function beginCommitDispatch() {
            commitDispatchDepth += 1;
        }

        function endCommitDispatch() {
            commitDispatchDepth = Math.max(0, commitDispatchDepth - 1);
        }

        return {
            normaliseMode: normaliseMode,
            isAccentCommitted: isAccentCommitted,
            requestRepaint: requestRepaint,

            current: function () {
                return cloneJson(current);
            },

            // Legacy one-message update retained for compatibility/recovery. Normal
            // producer updates should use prepare() + commitPrepared().
            broadcast: function (payload) {
                var result = adopt(payload);
                if (!result) return false;
                try { window.NotifyOthers(SHARED_RIVAGE_THEME_UPDATE, currentWire); } catch (e) { reportFailure('the shared theme update could not be broadcast', e); }
                return true;
            },

            prepare: function (payload) {
                var staged = stage(payload);
                if (!staged) return false;
                try {
                    window.NotifyOthers(SHARED_RIVAGE_THEME_PREPARE, staged.wire);
                    return true;
                } catch (e) {
                    clearPending();
                    reportFailure('the shared theme prepare could not be broadcast', e);
                    return false;
                }
            },

            commitPrepared: function (callback) {
                if (!pendingValid) return false;
                var result = promotePending(pendingWire);
                if (!result) return false;

                // Apply locally first, then synchronously let every consumer promote
                // the already-staged snapshot. Repaint requests made inside COMMIT
                // invalidate directly in this same event turn; the producer callback
                // runs before we leave the same dispatch edge.
                beginCommitDispatch();
                try {
                    try { window.NotifyOthers(SHARED_RIVAGE_THEME_COMMIT, wireDigest(result.wire)); }
                    catch (e) { reportFailure('the shared theme commit could not be broadcast', e); }
                    if (result.changed || result.applied) notifyConsumerNow(callback);
                } finally {
                    endCommitDispatch();
                }
                return true;
            },

            request: function () {
                try { window.NotifyOthers(SHARED_RIVAGE_THEME_REQUEST, 0); } catch (e) { reportFailure('the shared theme could not be requested', e); }
            },

            consume: function (name, info, callback) {
                // Mica frame discovery deliberately piggybacks on the shared
                // notification path so every normal RVG consumer can answer its
                // direct children without registering another callback wrapper.
                // Geometry notifications are *not* semantic-theme updates, so
                // delegate them and continue to return false below.
                try {
                    if (typeof RivageBackdrop !== 'undefined' && RivageBackdrop &&
                        typeof RivageBackdrop.consumeGeometry === 'function') {
                        RivageBackdrop.consumeGeometry(name, info);
                    }
                } catch (e) { reportFailure('a Mica frame notification could not be consumed', e); }

                if (name === SHARED_RIVAGE_THEME_PREPARE) {
                    stage(info);
                    return true;
                }

                if (name === SHARED_RIVAGE_THEME_COMMIT) {
                    var committed = promotePending(info);
                    if (!committed) return true;
                    if (committed.changed || committed.applied) {
                        beginCommitDispatch();
                        try { notifyConsumerNow(callback); }
                        finally { endCommitDispatch(); }
                    }
                    return true;
                }

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
