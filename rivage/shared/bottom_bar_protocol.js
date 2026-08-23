'use strict';

// V2 isolates legacy selectors; management helpers report dispatch, not host acceptance.
if (typeof BottomBarProtocol === 'undefined') {
    var BottomBarProtocol = (function () {
        var PROTOCOL_VERSION = 2;
        var PREFIX = 'RIVAGE.BOTTOM_BAR.V2.';

        var REQUEST_STATE = PREFIX + 'REQUEST_STATE';
        var STATE = PREFIX + 'STATE';
        var LOAD_PRESET = PREFIX + 'LOAD_PRESET';

        // Management messages are retained for external controllers; PRESETS only loads.
        var SAVE_AS_PRESET = PREFIX + 'SAVE_AS_PRESET';
        var UPDATE_PRESET = PREFIX + 'UPDATE_PRESET';
        var RENAME_PRESET = PREFIX + 'RENAME_PRESET';
        var DELETE_PRESET = PREFIX + 'DELETE_PRESET';

        function send(name, payload) {
            try {
                window.NotifyOthers(
                    name,
                    typeof payload === 'undefined' ? 0 : payload
                );
                return true;
            } catch (e) {
                return false;
            }
        }

        // Notification payload objects cannot be retained across callbacks.
        function clone(value, fallback) {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (e) {
                return fallback;
            }
        }

        function parseState(value) {
            var copy = clone(value, null);
            var i;
            var preset;

            if (!copy || typeof copy !== 'object' || copy instanceof Array ||
                copy.version !== PROTOCOL_VERSION || !(copy.presets instanceof Array) ||
                typeof copy.activePresetId !== 'string') {
                return null;
            }

            for (i = 0; i < copy.presets.length; i++) {
                preset = copy.presets[i];
                if (!preset || typeof preset !== 'object' || preset instanceof Array ||
                    typeof preset.id !== 'string' || !preset.id ||
                    typeof preset.name !== 'string') {
                    return null;
                }
            }
            return copy;
        }

        function requiredPresetId(value) {
            if (value == null) return '';
            return String(value);
        }

        return {
            REQUEST_STATE: REQUEST_STATE,
            STATE: STATE,
            LOAD_PRESET: LOAD_PRESET,
            SAVE_AS_PRESET: SAVE_AS_PRESET,
            UPDATE_PRESET: UPDATE_PRESET,
            RENAME_PRESET: RENAME_PRESET,
            DELETE_PRESET: DELETE_PRESET,

            clone: clone,
            parseState: parseState,

            requestState: function () {
                return send(REQUEST_STATE, 0);
            },

            broadcastState: function (state) {
                var copy = parseState(state);
                return copy ? send(STATE, copy) : false;
            },

            loadPreset: function (id) {
                return send(LOAD_PRESET, {
                    id: String(id == null ? '' : id)
                });
            },

            saveAsPreset: function (name) {
                return send(SAVE_AS_PRESET, {
                    name: String(name == null ? '' : name)
                });
            },

            updatePreset: function (id) {
                var targetId = requiredPresetId(id);
                if (!targetId) return false;
                return send(UPDATE_PRESET, { id: targetId });
            },

            renamePreset: function (id, name) {
                var targetId = requiredPresetId(id);
                if (!targetId) return false;
                return send(RENAME_PRESET, {
                    id: targetId,
                    name: String(name == null ? '' : name)
                });
            },

            deletePreset: function (id) {
                var targetId = requiredPresetId(id);
                if (!targetId) return false;
                return send(DELETE_PRESET, { id: targetId });
            }
        };
    })();
}
