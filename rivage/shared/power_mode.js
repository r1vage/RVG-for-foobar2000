'use strict';

// Low-power mode: one skin-wide switch that trades visual extras for less CPU/GPU
// work without touching any individual setting, so switching it off restores
// everything exactly. While it is on:
//   - Artwork Mica paints as the plain artwork palette (tab-switcher-right.js),
//   - Spectrum, VU meter and Lyrics animation run at no more than 20 fps,
//   - scrolling (marquee) titles stay still.
//
// A config file, like ui_scale.js, so every panel knows the state at include
// time without a NotifyOthers round trip; live changes arrive as UPDATE.
// tab-switcher-right.js is the only writer: others ask it with SET.
if (typeof RivagePowerMode === 'undefined') {
    var RivagePowerMode = (function () {
        var CONFIG_DIRECTORY = fb.ProfilePath + 'jsplitter\\rivage\\config\\';
        var CONFIG_FILE = CONFIG_DIRECTORY + 'power_mode.json';
        var UPDATE = 'RIVAGE.POWER_MODE.UPDATE.V1';
        var SET = 'RIVAGE.POWER_MODE.SET.V1';
        var LOW_POWER_MAX_FPS = 20;

        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[RivagePowerMode] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function readConfig() {
            var text;
            try {
                if (!utils.IsFile(CONFIG_FILE)) return false;
                text = utils.ReadTextFile(CONFIG_FILE, 65001);
            } catch (e) {
                reportFailure('the power mode config could not be read', e);
                return false;
            }
            try {
                var parsed = JSON.parse(text || '{}');
                return !!(parsed && parsed.low === true);
            } catch (e2) {
                reportFailure('the power mode config is not valid JSON', e2);
                return false;
            }
        }

        var low = readConfig();
        var listeners = [];

        function notifyListeners() {
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i](low); } catch (e) { reportFailure('a power mode listener failed', e); }
            }
        }

        function send(name, value) {
            try { window.NotifyOthers(name, !!value); }
            catch (e) { reportFailure('the power mode message could not be sent', e); }
        }

        function write() {
            try {
                utils.CreateFolder(CONFIG_DIRECTORY);
                if (utils.WriteTextFile(CONFIG_FILE, JSON.stringify({ low: low }), false) === false) {
                    throw new Error('WriteTextFile returned false');
                }
                return true;
            } catch (e) {
                reportFailure('the power mode config could not be written', e);
                return false;
            }
        }

        // Authority only (tab-switcher-right.js): persist, broadcast, apply locally.
        function setLocal(next) {
            next = !!next;
            if (next === low) return false;
            low = next;
            write();
            send(UPDATE, low);
            notifyListeners();
            return true;
        }

        function getSchemaEntries() {
            return [{
                id: 'lowPowerMode', label: 'Low-power mode', type: 'bool', value: low,
                hint: 'Artwork Mica paints as the plain artwork palette, Spectrum, VU meter and ' +
                    'Lyrics animation are capped at ' + LOW_POWER_MAX_FPS + ' fps, and scrolling titles ' +
                    'stay still. Your own settings are kept and come back when this is switched off.'
            }];
        }

        function applySetting(id, value) {
            if (id !== 'lowPowerMode') return false;
            setLocal(value);
            return true;
        }

        // Consumers: adopt an UPDATE. true when the message was ours.
        function consume(name, info) {
            if (name !== UPDATE) return false;
            var next = !!info;
            if (next !== low) {
                low = next;
                notifyListeners();
            }
            return true;
        }

        // Authority: a SET from anyone else. true when the message was ours.
        function consumeSet(name, info) {
            if (name !== SET) return false;
            setLocal(!!info);
            return true;
        }

        return {
            LOW_POWER_MAX_FPS: LOW_POWER_MAX_FPS,
            isLow: function () { return low; },
            // Caps a frame rate while low-power mode is on.
            fps: function (requested) {
                requested = Number(requested) || LOW_POWER_MAX_FPS;
                return low ? Math.min(requested, LOW_POWER_MAX_FPS) : requested;
            },
            // Settings hint for a frame-rate row: '' unless the cap is lowering it.
            capNote: function (requested) {
                return low && Number(requested) > LOW_POWER_MAX_FPS
                    ? 'Runs at ' + LOW_POWER_MAX_FPS + ' fps while low-power mode is on; ' +
                        requested + ' fps returns when it is switched off.'
                    : '';
            },
            // Suffix for a frame-rate menu title: '' unless the cap is lowering it.
            capMenuSuffix: function (requested) {
                return low && Number(requested) > LOW_POWER_MAX_FPS
                    ? ' (capped at ' + LOW_POWER_MAX_FPS + ' by low-power mode)' : '';
            },
            onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
            consume: consume,
            consumeSet: consumeSet,
            // Any panel: ask the authority to switch.
            request: function (next) { send(SET, next); },
            setLocal: setLocal,
            getSchemaEntries: getSchemaEntries,
            applySetting: applySetting
        };
    }());
}
