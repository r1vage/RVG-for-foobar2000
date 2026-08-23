'use strict';

// Shared metadata-source policy. Selection falls back to now playing when no
// focused handle exists; repeated includes must preserve listeners and state.
var RIVAGE_TRACK_CONTEXT_REQUEST = 'RIVAGE.TRACK_CONTEXT.REQUEST';
var RIVAGE_TRACK_CONTEXT_UPDATE = 'RIVAGE.TRACK_CONTEXT.UPDATE';

if (typeof TrackContext === 'undefined') {
    var TrackContext = (function () {
        var PROPERTY_PREFIX = 'Rivage Track Context.';
        var MODE_GLOBAL = 'global';
        var MODE_AUTO = 'automatic';
        var MODE_NOW_PLAYING = 'now_playing';
        var MODE_SELECTION = 'selection';

        // Narrow failure reporting. The empty catches here guard broadcasts,
        // retry-timer schedules, or consumer callbacks - each a real failure
        // with no other trace. Repeats are counted and re-logged only at
        // powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[TrackContext] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function isGlobalMode(value) {
            return value === MODE_AUTO || value === MODE_NOW_PLAYING || value === MODE_SELECTION;
        }

        function normaliseMode(value) {
            return isGlobalMode(value) ? value : MODE_AUTO;
        }

        function normaliseOverride(value) {
            return value === MODE_AUTO || value === MODE_NOW_PLAYING || value === MODE_SELECTION ? value : MODE_GLOBAL;
        }

        var settings = {
            mode: normaliseMode(window.GetProperty(PROPERTY_PREFIX + 'Global mode', MODE_AUTO))
        };
        var listeners = [];

        function notify() {
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i](); } catch (e) { reportFailure('a track-context change listener failed', e); }
            }
        }

        function applyLocally(id, value) {
            if (id !== 'trackContextMode') return false;
            var next = normaliseMode(value);
            if (next === settings.mode) return true;

            window.SetProperty(PROPERTY_PREFIX + 'Global mode', next);
            settings.mode = next;
            notify();
            return true;
        }

        function applySetting(id, value) {
            applyLocally(id, value);
        }

        function effectiveMode(overrideMode) {
            var override = normaliseOverride(overrideMode);
            return override === MODE_GLOBAL ? settings.mode : override;
        }

        function focusHandle() {
            var handle = null;
            try { handle = fb.GetFocusItem(true); } catch (e) {
                try { handle = fb.GetFocusItem(); } catch (e2) { handle = null; }
            }
            return handle;
        }

        function nowPlayingHandle() {
            try { return fb.IsPlaying ? fb.GetNowPlaying() : null; } catch (e) { return null; }
        }

        function result(handle, isNowPlaying) {
            return {
                handle: handle || null,
                isNowPlaying: !!(handle && isNowPlaying)
            };
        }

        function resolve(overrideMode) {
            var mode = effectiveMode(overrideMode);
            var handle;

            if (mode === MODE_NOW_PLAYING) return result(nowPlayingHandle(), true);

            if (mode === MODE_SELECTION) {
                handle = focusHandle();
                return handle ? result(handle, false) : result(nowPlayingHandle(), true);
            }

            handle = nowPlayingHandle();
            return handle ? result(handle, true) : result(focusHandle(), false);
        }

        function getHandle(overrideMode) {
            return resolve(overrideMode).handle;
        }

        // Playback events matter in selection mode only while its fallback is active.
        function followsPlayback(overrideMode) {
            var mode = effectiveMode(overrideMode);
            if (mode === MODE_NOW_PLAYING) return true;
            if (mode === MODE_SELECTION) return !focusHandle();
            try { return !!fb.IsPlaying; } catch (e) { return false; }
        }

        // Source identity, not merely playback-event eligibility.
        function usesNowPlaying(overrideMode) {
            return resolve(overrideMode).isNowPlaying;
        }

        function followsSelection(overrideMode) {
            var mode = effectiveMode(overrideMode);
            if (mode === MODE_SELECTION) return true;
            if (mode !== MODE_AUTO) return false;
            try { return !fb.IsPlaying; } catch (e) { return true; }
        }

        function copyLabel(key, fallback) {
            try {
                if (RivageUI && RivageUI.copy && RivageUI.copy.labels && RivageUI.copy.labels[key]) {
                    return RivageUI.copy.labels[key];
                }
            } catch (e) { }
            return fallback;
        }

        function modeLabel(mode) {
            mode = normaliseMode(mode);
            if (mode === MODE_NOW_PLAYING) return copyLabel('nowPlayingOnly', 'Now playing only');
            if (mode === MODE_SELECTION) return copyLabel('selectedTrackOtherwiseNowPlaying', 'Selected track, otherwise now playing');
            return copyLabel('nowPlayingOtherwiseSelectedTrack', 'Now playing, otherwise selected track');
        }

        function getSchemaEntries() {
            return [{
                id: 'trackContextMode',
                label: 'Default track source',
                type: 'choice',
                value: settings.mode,
                choiceValueType: 'string',
                choices: [
                    { value: MODE_AUTO, label: copyLabel('nowPlayingOtherwiseSelectedTrack', 'Now playing, otherwise selected track') },
                    { value: MODE_NOW_PLAYING, label: copyLabel('nowPlayingOnly', 'Now playing only') },
                    { value: MODE_SELECTION, label: copyLabel('selectedTrackOtherwiseNowPlaying', 'Selected track, otherwise now playing') }
                ]
            }];
        }

        function getOverrideChoices() {
            return [
                { value: MODE_GLOBAL, label: copyLabel('followGlobalSetting', 'Follow global setting') },
                { value: MODE_AUTO, label: copyLabel('nowPlayingOtherwiseSelectedTrack', 'Now playing, otherwise selected track') },
                { value: MODE_NOW_PLAYING, label: copyLabel('nowPlayingOnly', 'Now playing only') },
                { value: MODE_SELECTION, label: copyLabel('selectedTrackOtherwiseNowPlaying', 'Selected track, otherwise now playing') }
            ];
        }

        function broadcast() {
            try { window.NotifyOthers(RIVAGE_TRACK_CONTEXT_UPDATE, { mode: settings.mode }); } catch (e) { reportFailure('the track context could not be broadcast', e); }
        }

        function requestSync() {
            try { window.NotifyOthers(RIVAGE_TRACK_CONTEXT_REQUEST, 0); } catch (e) { reportFailure('the track context could not be requested', e); }
        }

        // Only the Global-settings owner answers REQUEST; consumers never publish stale state.
        function onNotifyData(name, info, isAuthority) {
            if (name === RIVAGE_TRACK_CONTEXT_REQUEST) {
                if (isAuthority) broadcast();
                return true;
            }
            if (name === RIVAGE_TRACK_CONTEXT_UPDATE) {
                if (info && typeof info === 'object' && isGlobalMode(info.mode)) {
                    applyLocally('trackContextMode', info.mode);
                }
                return true;
            }
            return false;
        }

        return {
            MODE_GLOBAL: MODE_GLOBAL,
            MODE_AUTO: MODE_AUTO,
            MODE_NOW_PLAYING: MODE_NOW_PLAYING,
            MODE_SELECTION: MODE_SELECTION,
            settings: settings,
            normaliseOverride: normaliseOverride,
            effectiveMode: effectiveMode,
            modeLabel: modeLabel,
            resolve: resolve,
            getHandle: getHandle,
            followsPlayback: followsPlayback,
            usesNowPlaying: usesNowPlaying,
            followsSelection: followsSelection,
            getSchemaEntries: getSchemaEntries,
            getOverrideChoices: getOverrideChoices,
            applySetting: applySetting,
            broadcast: broadcast,
            requestSync: requestSync,
            onNotifyData: onNotifyData,
            onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
        };
    })();
}
