'use strict';

var SHARED_ALBUM_ACCENT_UPDATE = 'SHARED_ALBUM_ACCENT.UPDATE';
var SHARED_ALBUM_ACCENT_REQUEST = 'SHARED_ALBUM_ACCENT.REQUEST';

if (typeof SharedAccentProtocol === 'undefined') {
    var SharedAccentProtocol = (function () {
        function isColour(value) {
            return typeof value === 'number' && isFinite(value) &&
                Math.floor(value) === value && value >= -2147483648 && value <= 4294967295;
        }

        function opaque(colour) {
            return ((Number(colour) & 0x00ffffff) | 0xff000000) >>> 0;
        }

        function requestAccent() {
            try {
                window.NotifyOthers(SHARED_ALBUM_ACCENT_REQUEST, 0);
                return true;
            } catch (e) {
                return false;
            }
        }

        return {
            isColour: isColour,

            broadcast: function (colour) {
                if (!isColour(colour)) return false;
                try {
                    window.NotifyOthers(SHARED_ALBUM_ACCENT_UPDATE, opaque(colour));
                    return true;
                } catch (e) {
                    return false;
                }
            },

            requestAccent: requestAccent,

            // Startup compatibility: request the complete semantic snapshot first,
            // then the legacy accent. The producer answers with PREPARE -> accent ->
            // COMMIT, so semantic-aware consumers stage both pieces before one
            // synchronized visual commit.
            request: function () {
                SharedThemeProtocol.request();
                requestAccent();
            },

            opaque: opaque,

            withAlpha: function (colour, alpha) {
                var a = Math.max(0, Math.min(255, Math.round(Number(alpha) || 0)));
                return ((Number(colour) & 0x00ffffff) | (a << 24)) >>> 0;
            }
        };
    }());
}
