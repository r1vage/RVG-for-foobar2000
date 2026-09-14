'use strict';

var UI_SCALE_VERSION = '1.0.1';

// Skin-wide UI scale: follow the host DPI, ignore it, or force a percentage.
// Include BEFORE the other shared modules and before any font is built.
// A config file, not a property: every context must resolve its scale at include
// time, before any NotifyOthers round trip could answer. tab-switcher-right.js is
// the only writer, and a change takes effect on the next start.
if (typeof RivageScale === 'undefined') {
    var RivageScale = (function () {
        var CONFIG_DIRECTORY = fb.ProfilePath + 'jsplitter\\rivage\\config\\';
        var CONFIG_FILE = CONFIG_DIRECTORY + 'ui_scale.json';
        var BASE_DPI = 96;
        var MODE_AUTO = 'auto';
        var MODE_IGNORE = 'ignore';
        var MODE_CUSTOM = 'custom';
        var MIN_PERCENT = 50;
        var MAX_PERCENT = 300;
        var PERCENT_STEP = 5;
        var DEFAULT_CUSTOM_PERCENT = 100;

        // Narrow failure reporting. The catches here guard config file I/O,
        // which has no other trace. Repeats are counted and re-logged only at
        // powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[RivageScale] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function normaliseMode(value) {
            var text = String(value === undefined || value === null ? MODE_AUTO : value).toLowerCase();
            return text === MODE_IGNORE || text === MODE_CUSTOM ? text : MODE_AUTO;
        }

        function clampPercent(value) {
            var number = Math.round(Number(value));
            if (!isFinite(number)) return DEFAULT_CUSTOM_PERCENT;
            return Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, number));
        }

        function readConfig() {
            var text, parsed;

            try {
                if (!utils.IsFile(CONFIG_FILE)) return null;
                text = utils.ReadTextFile(CONFIG_FILE, 65001);
            } catch (e) {
                reportFailure('the UI scale config could not be read', e);
                return null;
            }
            if (!text) return null;

            try {
                parsed = JSON.parse(text);
            } catch (e) {
                reportFailure('the UI scale config is not valid JSON', e);
                return null;
            }
            return parsed && typeof parsed === 'object' ? parsed : null;
        }

        var config = readConfig() || {};
        var mode = normaliseMode(config.mode);
        var customPercent = clampPercent(
            config.customPercent === undefined ? DEFAULT_CUSTOM_PERCENT : config.customPercent);

        // 0 means "no override in force".
        function overridePercent() {
            if (mode === MODE_IGNORE) return 100;
            if (mode === MODE_CUSTOM) return customPercent;
            return 0;
        }

        // Bare DPI first: some host variants expose it without window.
        function hostDpi() {
            try {
                if (typeof DPI !== 'undefined' && Number(DPI) > 0) return Number(DPI);
            } catch (e) { }
            try {
                if (typeof window !== 'undefined' && Number(window.DPI) > 0) return Number(window.DPI);
            } catch (e) { }
            return 0;
        }

        // Drop-in for Number(window.DPI): 0 still means "unreadable", so every
        // call site keeps its own fallback.
        function dpi() {
            var percent = overridePercent();
            return percent > 0 ? Math.round(BASE_DPI * percent / 100) : hostDpi();
        }

        function effectivePercent() {
            var percent = overridePercent();
            var host;

            if (percent > 0) return percent;
            host = hostDpi();
            return host > 0 ? Math.round(host * 100 / BASE_DPI) : 100;
        }

        function write() {
            var payload = JSON.stringify({ mode: mode, customPercent: customPercent });

            try {
                utils.CreateFolder(CONFIG_DIRECTORY);
                if (utils.WriteTextFile(CONFIG_FILE, payload, false) === false) {
                    throw new Error('WriteTextFile returned false');
                }
            } catch (e) {
                reportFailure('the UI scale config could not be written', e);
                return false;
            }
            return true;
        }

        function getSchemaEntries() {
            return [
                { id: 'uiScaleMode', label: 'UI scale', type: 'choice', value: mode,
                  choiceValueType: 'string',
                  choices: [
                      { value: MODE_AUTO, label: 'Follow Windows DPI' },
                      { value: MODE_IGNORE, label: 'Ignore Windows DPI (100%)' },
                      { value: MODE_CUSTOM, label: 'Custom scale' }
                  ],
                  hint: 'RVG panels are laid out at ' + effectivePercent() +
                      '% right now. A change applies after foobar2000 is restarted.' },
                { id: 'uiScaleCustom', label: 'Custom UI scale (%)', type: 'number',
                  value: customPercent, min: MIN_PERCENT, max: MAX_PERCENT, step: PERCENT_STEP,
                  hidden: mode !== MODE_CUSTOM }
            ];
        }

        // Global settings is the sole writer; true means the id was handled.
        function applySetting(id, value) {
            var next;

            if (id === 'uiScaleMode') {
                next = normaliseMode(value);
                if (next !== mode) {
                    mode = next;
                    write();
                }
                return true;
            }
            if (id === 'uiScaleCustom') {
                next = clampPercent(value);
                if (next !== customPercent) {
                    customPercent = next;
                    write();
                }
                return true;
            }
            return false;
        }

        return {
            version: UI_SCALE_VERSION,
            dpi: dpi,
            hostDpi: hostDpi,
            percent: effectivePercent,
            isOverridden: function () { return overridePercent() > 0; },
            mode: function () { return mode; },
            getSchemaEntries: getSchemaEntries,
            applySetting: applySetting
        };
    }());
}
