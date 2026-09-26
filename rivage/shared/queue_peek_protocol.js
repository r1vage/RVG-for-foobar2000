'use strict';

// Queue peek: a panel asks settings_host.js (LEFT SIDE) to cover its slot with
// the reserved QUEUE PEEK child. The host owns the state; it is never persisted.
if (typeof QueuePeekProtocol === 'undefined') {
    var QueuePeekProtocol = (function () {
        var PREFIX = 'RIVAGE.QUEUE_PEEK.V1.';
        var OPEN = PREFIX + 'OPEN';
        var CLOSE = PREFIX + 'CLOSE';

        function send(name, payload) {
            try {
                window.NotifyOthers(name, payload);
                return true;
            } catch (e) {
                return false;
            }
        }

        // The host has no handle on the sender, so the request carries what it
        // needs to find the sender's slot: its size, and its name as a tie-break.
        function open() {
            return send(OPEN, {
                w: Math.max(0, Math.round(Number(window.Width) || 0)),
                h: Math.max(0, Math.round(Number(window.Height) || 0)),
                name: String(window.Name || '')
            });
        }

        function close() {
            return send(CLOSE, 0);
        }

        function parseOpen(info) {
            var w;
            var h;
            if (!info || typeof info !== 'object') return null;
            w = Number(info.w);
            h = Number(info.h);
            if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
            return { w: Math.round(w), h: Math.round(h), name: String(info.name || '') };
        }

        return {
            OPEN: OPEN,
            CLOSE: CLOSE,
            open: open,
            close: close,
            parseOpen: parseOpen
        };
    })();
}
