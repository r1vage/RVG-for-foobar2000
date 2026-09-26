'use strict';

// Quick switcher: quick_switcher_panel.js (caption QUICK SWITCHER, a hidden child
// of the root splitter) owns the UI; splitters/root_splitter.js owns where it sits.
// Anyone may TOGGLE. The panel answers with SHOW {w, h} (its preferred size) or
// HIDE; the root splitter reports what it actually did with STATE.
if (typeof QuickSwitcherProtocol === 'undefined') {
    var QuickSwitcherProtocol = (function () {
        var PREFIX = 'RIVAGE.QUICK_SWITCHER.V1.';
        var TOGGLE = PREFIX + 'TOGGLE';
        var SHOW = PREFIX + 'SHOW';
        var HIDE = PREFIX + 'HIDE';
        var STATE = PREFIX + 'STATE';
        var CAPTION = 'QUICK SWITCHER';

        function send(name, payload) {
            try {
                window.NotifyOthers(name, payload);
                return true;
            } catch (e) {
                return false;
            }
        }

        function parseSize(info) {
            var w, h;
            if (!info || typeof info !== 'object') return null;
            w = Number(info.w);
            h = Number(info.h);
            if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
            return { w: Math.round(w), h: Math.round(h) };
        }

        return {
            CAPTION: CAPTION,
            TOGGLE: TOGGLE,
            SHOW: SHOW,
            HIDE: HIDE,
            STATE: STATE,
            toggle: function () { return send(TOGGLE, 0); },
            show: function (w, h) { return send(SHOW, { w: w, h: h }); },
            hide: function () { return send(HIDE, 0); },
            state: function (open) { return send(STATE, { open: !!open }); },
            parseSize: parseSize,
            parseState: function (info) { return !!(info && info.open); }
        };
    })();
}
