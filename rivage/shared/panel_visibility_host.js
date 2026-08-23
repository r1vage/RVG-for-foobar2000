'use strict';

// NotifyOthers crosses splitter branches; GetPanel must run from a host in the target's branch.
if (typeof TOGGLE_HOST_CAPTIONS === 'undefined') {
    var TOGGLE_HOST_CAPTIONS = ["SETTINGS"];
}

if (typeof togglePanelVisibilityHost === 'undefined') {
    var togglePanelVisibilityHost = function (name, info) {
        var panel;

        if (name !== "RIVAGE.TOGGLE_PANEL_VISIBILITY") return false;
        if (!info || !info.caption) return false;
        if (TOGGLE_HOST_CAPTIONS.indexOf(info.caption) === -1) return false;

        try {
            panel = window.GetPanel(info.caption);
            if (!panel) return true;
            panel.Show(!!panel.Hidden);
        } catch (e) {
            try {
                console.log('[PanelVisibilityHost] GetPanel/Show failed for "' +
                    info.caption + '": ' + String(e));
            } catch (ignored) {}
        }

        return true;
    };
}
