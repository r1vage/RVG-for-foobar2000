'use strict';

// Workers run from paint; do not retain callback-owned native objects across callbacks.
if (typeof VisiblePaintWork === 'undefined') {
    var VisiblePaintWork = (function () {
        function isVisible() {
            try {
                var visible = window.IsVisible;
                if (typeof visible === 'function') visible = visible.call(window);
                if (typeof visible === 'undefined' || visible === null) return true;
                return !!visible;
            } catch (e) {
                return true;
            }
        }

        function create(worker) {
            if (typeof worker !== 'function') throw new Error('VisiblePaintWork.create requires a worker function.');

            var requestedKey = '';
            var completedKey = null;
            var pending = false;
            var busy = false;

            function requestRepaintIfVisible() {
                if (!isVisible()) return;
                try { window.Repaint(); } catch (e) { }
            }

            return {
                request: function (key) {
                    key = String(key == null ? '' : key);
                    requestedKey = key;
                    pending = completedKey !== key;
                    if (pending) requestRepaintIfVisible();
                },

                runFromPaint: function () {
                    if (!isVisible() || !pending || busy) return false;

                    var key = requestedKey;
                    var succeeded = false;
                    var failure = null;
                    busy = true;
                    try {
                        worker(key);
                        succeeded = true;
                    } catch (e) {
                        failure = e;
                    } finally {
                        busy = false;
                        if (requestedKey === key) {
                            if (succeeded) completedKey = key;
                            // A failed attempt waits for an explicit request instead of repaint-looping.
                            pending = false;
                        }
                    }

                    if (failure) {
                        try { console.log('VisiblePaintWork: ' + String(failure)); } catch (e2) { }
                    }

                    if (pending) requestRepaintIfVisible();
                    return !failure;
                }
            };
        }

        return {
            isVisible: isVisible,
            create: create
        };
    })();
}
