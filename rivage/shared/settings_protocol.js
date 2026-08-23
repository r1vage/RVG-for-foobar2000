'use strict';

// Shared settings-registry messaging protocol. Providers answer schema requests
// with provide(), consume VALUE_CHANGED edits, and the settings host pairs
// collect() with requestSchemas(). Responses are tagged per request so overlap is safe.
// The host cannot receive its own NotifyOthers broadcast, so it must add its own
// local schema directly. collect() deep-copies callback data because host objects
// are not safe to retain after on_notify_data returns.

var SettingsRegistry = (typeof SettingsRegistry !== 'undefined') ? SettingsRegistry : (function () {
    var SCHEMA_REQUEST = 'SETTINGS_REGISTRY.SCHEMA_REQUEST';
    var SCHEMA_RESPONSE = 'SETTINGS_REGISTRY.SCHEMA_RESPONSE';
    var VALUE_CHANGED = 'SETTINGS_REGISTRY.VALUE_CHANGED';

    var pendingRequests = Object.create(null);
    var warnedSchemaConflicts = Object.create(null);
    var requestSequence = 0;

    // Narrow failure reporting. Most empty catches in this file guard host
    // reads that are expected to fail and stay silent on purpose. This is for
    // the few that mean something is actually broken and would otherwise
    // leave no trace - a broadcast that silently fails to reach the settings
    // host, or a settings edit that silently fails to reach a panel. Repeats
    // are counted and re-logged only at powers of ten.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[SettingsRegistry] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    function normalizeDelay(delayMs) {
        var delay;
        if (delayMs === undefined || delayMs === null || delayMs === '') return 200;
        delay = Number(delayMs);
        return isFinite(delay) && delay >= 0 ? delay : 200;
    }

    function nextRequestId() {
        var windowId = '';
        try { windowId = String(window.ID); } catch (e) { }
        requestSequence += 1;
        return windowId + ':' + String(new Date().getTime()) + ':' + String(requestSequence);
    }

    function sameSchema(a, b) {
        try {
            return JSON.stringify((a && a.settings) || []) === JSON.stringify((b && b.settings) || []);
        } catch (e) {
            return false;
        }
    }

    function warnSchemaConflict(panelId) {
        if (warnedSchemaConflicts[panelId]) return;
        warnedSchemaConflicts[panelId] = true;
        try {
            console.log('[SettingsRegistry] WARNING: conflicting schemas for panelId "' + panelId + '"; last response wins.');
        } catch (e) { }
    }

    return {
        SCHEMA_REQUEST: SCHEMA_REQUEST,
        SCHEMA_RESPONSE: SCHEMA_RESPONSE,
        VALUE_CHANGED: VALUE_CHANGED,

        provide: function (name, info, panelId, panelLabel, schemaFn) {
            var settings;
            var requestId;

            if (name !== SCHEMA_REQUEST) return false;

            try {
                settings = schemaFn() || [];
            } catch (e) {
                settings = [];
            }

            requestId = info && info.requestId !== undefined && info.requestId !== null
                ? String(info.requestId)
                : '';

            try {
                window.NotifyOthers(SCHEMA_RESPONSE, {
                    requestId: requestId,
                    panelId: panelId,
                    panelLabel: panelLabel,
                    settings: settings
                });
            } catch (e) { reportFailure('the settings schema response could not be broadcast', e); }

            return true;
        },

        consume: function (name, info, panelId, applyFn) {
            if (name !== VALUE_CHANGED) return false;
            if (!info || info.panelId !== panelId) return false;

            try {
                applyFn(info.settingId, info.value);
            } catch (e) { reportFailure('a settings value could not be applied', e); }

            return true;
        },

        collect: function (name, info) {
            var copy;
            var requestId;
            var request;
            var previous;

            if (name !== SCHEMA_RESPONSE) return false;
            if (!info || !info.panelId) return false;

            try {
                copy = JSON.parse(JSON.stringify(info));
            } catch (e) {
                return true;
            }

            requestId = copy.requestId !== undefined && copy.requestId !== null
                ? String(copy.requestId)
                : '';
            request = pendingRequests[requestId];
            if (!request) return true;

            delete copy.requestId;
            previous = request.panels[copy.panelId];
            if (previous && !sameSchema(previous, copy)) warnSchemaConflict(copy.panelId);
            request.panels[copy.panelId] = copy;
            return true;
        },

        requestSchemas: function (delayMs, callback) {
            var delay = normalizeDelay(delayMs);
            var requestId = nextRequestId();

            pendingRequests[requestId] = { panels: Object.create(null) };

            try {
                window.NotifyOthers(SCHEMA_REQUEST, { requestId: requestId });
            } catch (e) { reportFailure('the settings schema request could not be broadcast', e); }

            window.SetTimeout(function () {
                var request = pendingRequests[requestId];
                var panels = [];
                var key;

                if (!request) return;
                delete pendingRequests[requestId];

                for (key in request.panels) {
                    if (Object.prototype.hasOwnProperty.call(request.panels, key)) {
                        panels.push(request.panels[key]);
                    }
                }

                callback(panels);
            }, delay);
        },

        broadcastChange: function (panelId, settingId, value) {
            try {
                window.NotifyOthers(VALUE_CHANGED, {
                    panelId: panelId,
                    settingId: settingId,
                    value: value
                });
            } catch (e) { reportFailure('the settings value change could not be broadcast', e); }
        }
    };
})();
