'use strict';

// Shared tab-bar appearance for tab-switcher-right.js and extra-tab-parent.js.
// Include after settings_protocol.js and design_system.js, and after ui_scale.js.
// Host contract: read settings, use drawingFont(), register one onChange() handler,
// route SettingsRegistry + onNotifyData(), use setAndSync() for local edits, then requestSync().
// Both hosts intentionally share PANEL_ID "tabs". SettingsRegistry.consume() uses
// applySetting() without rebroadcast; local edits send one TAB_BAR_STYLE_UPDATE instead.

var TAB_BAR_STYLE_REQUEST = 'RIVAGE.TAB_BAR_STYLE.REQUEST';
var TAB_BAR_STYLE_UPDATE = 'RIVAGE.TAB_BAR_STYLE.UPDATE';

// Preserve listeners/state across repeated include paths.
var TabBarStyle = (typeof TabBarStyle !== 'undefined') ? TabBarStyle : (function () {
    var PROPERTY_PREFIX = 'Rivage Tab Bar Style.';

    // Narrow failure reporting. The empty catches here guard broadcasts,
    // retry-timer schedules, or consumer callbacks - each a real failure
    // with no other trace. Repeats are counted and re-logged only at
    // powers of ten.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[TabBarStyle] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    function tbsClamp(value, min, max) {
        var n = Number(value);
        if (!isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
    }

    function saveSetting(name, value) {
        window.SetProperty(PROPERTY_PREFIX + name, value);
    }

    var ACCENT_FIXED = 'fixed';
    var ACCENT_SHARED = 'shared';

    var MIN_HEIGHT = 24, MAX_HEIGHT = 160, DEFAULT_HEIGHT = 58;
    var MIN_FONT_SIZE = 6, MAX_FONT_SIZE = 48, DEFAULT_FONT_SIZE_PT = 10;
    // Blank inherits the host label font.
    var DEFAULT_FONT_FAMILY = '';
    var LEGACY_DEFAULT_FONT_FAMILY = 'Segoe UI Semibold';

    function defaultFontSizePx() {
        var dpi = RivageScale.dpi() || 96;
        return Math.max(MIN_FONT_SIZE, Math.round(DEFAULT_FONT_SIZE_PT * dpi / 96));
    }

    var settings = {
        accentMode: (function () {
            var v = String(window.GetProperty(PROPERTY_PREFIX + 'Accent mode', ACCENT_SHARED));
            return v === ACCENT_FIXED ? ACCENT_FIXED : ACCENT_SHARED;
        })(),
        tabBarHeight: Math.round(tbsClamp(window.GetProperty(PROPERTY_PREFIX + 'Tab bar height', DEFAULT_HEIGHT), MIN_HEIGHT, MAX_HEIGHT)),
        fontFamily: String(window.GetProperty(PROPERTY_PREFIX + 'Font family', DEFAULT_FONT_FAMILY) || '').trim(),
        fontSize: 0 // resolved just below - 0 means "no property saved yet"
    };
    var savedFontSize = Number(window.GetProperty(PROPERTY_PREFIX + 'Font size', 0));
    settings.fontSize = !isFinite(savedFontSize) || savedFontSize === 0
        ? defaultFontSizePx()
        : Math.round(tbsClamp(savedFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE));

    // One-time migration from the old default to inherited Common (labels).
    var fontSourceMigration = String(window.GetProperty(PROPERTY_PREFIX + 'Font source migration', '') || '');
    if (!fontSourceMigration) {
        if (settings.fontFamily.toLowerCase() === LEGACY_DEFAULT_FONT_FAMILY.toLowerCase() &&
            settings.fontSize === defaultFontSizePx()) {
            settings.fontFamily = '';
            saveSetting('Font family', '');
        }
        saveSetting('Font source migration', 'common-labels-v1');
    }

    function resolvedFontInfo() {
        var family = String(settings.fontFamily || '').trim();
        if (family) {
            var installed = true;
            try { installed = typeof utils === 'undefined' || !utils || typeof utils.CheckFont !== 'function' || utils.CheckFont(family); } catch (e) { installed = true; }
            if (installed) {
                return {
                    fontFamily: family,
                    fontSize: Math.max(1, Math.round(settings.fontSize)),
                    fontStyle: 0,
                    inherited: false,
                    source: 'Custom'
                };
            }
        }

        var inherited = RivageUI.commonLabelsFontInfo();
        inherited.inherited = true;
        return inherited;
    }

    function drawingFont() {
        var info = resolvedFontInfo();
        return RivageUI.font(info.fontFamily, info.fontSize, info.fontStyle || 0);
    }

    function describeFont() {
        var info = resolvedFontInfo();
        return (info.inherited ? 'Common (labels): ' : 'Custom: ') +
            info.fontFamily + ', ' + info.fontSize + ' px';
    }

    var changeListeners = [];

    function notifyChangeListeners() {
        var i;
        for (i = 0; i < changeListeners.length; i++) {
            try { changeListeners[i](); } catch (e) { reportFailure('a tab-bar-style change listener failed', e); }
        }
    }

    // Persist only when the normalized value changes; callers batch notifications/broadcasts.
    function applyLocally(id, value) {
        var next;
        switch (id) {
        case 'accentMode':
            next = value === ACCENT_FIXED ? ACCENT_FIXED : ACCENT_SHARED;
            if (settings.accentMode === next) return false;
            settings.accentMode = next;
            saveSetting('Accent mode', next);
            break;
        case 'tabBarHeight':
            next = Math.round(tbsClamp(value, MIN_HEIGHT, MAX_HEIGHT));
            if (settings.tabBarHeight === next) return false;
            settings.tabBarHeight = next;
            saveSetting('Tab bar height', next);
            break;
        case 'fontFamily':
            next = String(value || '').trim();
            if (settings.fontFamily === next) return false;
            settings.fontFamily = next;
            saveSetting('Font family', next);
            break;
        case 'fontSize':
            next = Math.round(tbsClamp(value, MIN_FONT_SIZE, MAX_FONT_SIZE));
            if (settings.fontSize === next) return false;
            settings.fontSize = next;
            saveSetting('Font size', next);
            break;
        default:
            return false;
        }
        return true;
    }

    function applySetting(id, value) {
        if (applyLocally(id, value)) notifyChangeListeners();
    }

    function setAndSync(id, value) {
        if (!applyLocally(id, value)) return;
        notifyChangeListeners();
        broadcastFullState();
    }

    // Batch the FontPicker pair into one notification/broadcast.
    function setFontAndSync(family, size) {
        var changedFamily = applyLocally('fontFamily', family);
        var changedSize = applyLocally('fontSize', size);
        if (changedFamily || changedSize) {
            notifyChangeListeners();
            broadcastFullState();
        }
    }

    function promptFont() {
        var current, chosen, info;
        try {
            info = resolvedFontInfo();
            current = gdi.Font(info.fontFamily, Math.max(1, info.fontSize), info.fontStyle || 0);
            chosen = utils.FontPicker(current, window.ID);
        } catch (e) {
            return;
        }
        if (!chosen) return;
        setFontAndSync(String(chosen.Name || info.fontFamily), Math.round(chosen.Size) || settings.fontSize);
    }

    function useCommonLabelsAndSync() {
        setAndSync('fontFamily', '');
    }

    function getSchema() {
        return [
            {
                id: 'accentMode', label: 'Tab bar accent', type: 'choice',
                value: settings.accentMode, choiceValueType: 'string',
                choices: [
                    { value: ACCENT_FIXED, label: RivageUI.copy.labels.rvgBlue },
                    { value: ACCENT_SHARED, label: RivageUI.copy.labels.sharedAccent }
                ]
            },
            {
                id: 'tabBarHeight', label: 'Tab bar height', type: 'number',
                value: settings.tabBarHeight, min: MIN_HEIGHT, max: MAX_HEIGHT, step: 1, hint: 'Pixels at 96 DPI.'
            },
            {
                id: 'tabBarFont', label: 'Tab bar font', type: 'info',
                value: describeFont()
            },
            { id: 'changeTabBarFont', label: 'Choose tab bar font\u2026', type: 'action', value: null, actionLabel: 'Choose' },
            { id: 'useCommonLabelsFont', label: 'Use Columns UI "Common (labels)" font', type: 'action', value: null, actionLabel: 'Use',
              hidden: !settings.fontFamily }
        ];
    }

    function applySettingOrAction(id, value) {
        if (id === 'changeTabBarFont') {
            promptFont();
            return;
        }
        if (id === 'useCommonLabelsFont') {
            useCommonLabelsAndSync();
            return;
        }
        applySetting(id, value);
    }

    function requestSync() {
        try { window.NotifyOthers(TAB_BAR_STYLE_REQUEST, 0); } catch (e) { reportFailure('the tab-bar style could not be requested', e); }
    }

    function broadcastFullState() {
        try {
            window.NotifyOthers(TAB_BAR_STYLE_UPDATE, {
                accentMode: settings.accentMode,
                tabBarHeight: settings.tabBarHeight,
                fontFamily: settings.fontFamily,
                fontSize: settings.fontSize
            });
        } catch (e) { reportFailure('the tab-bar style could not be broadcast', e); }
    }

    function onNotifyData(name, info) {
        var key, changed;
        if (name === TAB_BAR_STYLE_REQUEST) {
            broadcastFullState();
            return true;
        }
        if (name === TAB_BAR_STYLE_UPDATE && info && typeof info === 'object') {
            changed = false;
            for (key in info) {
                if (Object.prototype.hasOwnProperty.call(info, key)) {
                    if (applyLocally(key, info[key])) changed = true;
                }
            }
            if (changed) notifyChangeListeners();
            return true;
        }
        return false;
    }

    var PANEL_ID = 'tabs';
    var PANEL_LABEL = 'Tabs';

    return {
        PANEL_ID: PANEL_ID,
        PANEL_LABEL: PANEL_LABEL,
        settings: settings,

        ACCENT_FIXED: ACCENT_FIXED,
        ACCENT_SHARED: ACCENT_SHARED,
        MIN_HEIGHT: MIN_HEIGHT,
        MAX_HEIGHT: MAX_HEIGHT,
        MIN_FONT_SIZE: MIN_FONT_SIZE,
        MAX_FONT_SIZE: MAX_FONT_SIZE,

        onChange: function (fn) {
            if (typeof fn === 'function') changeListeners.push(fn);
        },

        setAndSync: setAndSync,
        setFontAndSync: setFontAndSync,
        promptFont: promptFont,
        useCommonLabelsAndSync: useCommonLabelsAndSync,
        resolvedFontInfo: resolvedFontInfo,
        drawingFont: drawingFont,
        describeFont: describeFont,

        getSchema: getSchema,
        applySetting: applySettingOrAction,
        onNotifyData: onNotifyData,
        requestSync: requestSync
    };
})();
