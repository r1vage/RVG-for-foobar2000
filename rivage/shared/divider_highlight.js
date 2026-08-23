'use strict';

// Shared divider highlight. Accent state is shared by all instances in one
// panel context, and repeated includes must preserve that singleton state.
if (typeof SharedAccentProtocol === 'undefined' ||
    typeof SHARED_ALBUM_ACCENT_UPDATE === 'undefined' ||
    typeof SHARED_ALBUM_ACCENT_REQUEST === 'undefined') {
    include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
}

if (typeof DividerHighlight === 'undefined') {
    var DividerHighlight = (function () {
        var DEFAULT_ACCENT = 0xff0078d4;
        var LINE_THICKNESS = 2;

        var IDC_ARROW = 32512;
        var IDC_SIZEWE = 32644;
        var IDC_SIZENS = 32645;

        var accent = DEFAULT_ACCENT;
        var entries = [];

        // Match the DPI-scaled divider weight used by bottom_bar_host.js.
        function scaled(value) {
            var dpi = 96;
            try {
                if (typeof window.DPI === 'number' && window.DPI > 0) dpi = window.DPI;
            } catch (e) { }
            return Math.max(1, Math.round(value * dpi / 96));
        }

        function setCursor(id) {
            try { window.SetCursor(id); } catch (e) { }
        }

        function isHot(entry) {
            return entry.hovering || entry.dragging;
        }

        function repaintEntry(entry) {
            try { entry.repaint(); } catch (e) { }
        }

        function repaintAll() {
            for (var i = 0; i < entries.length; i++) {
                if (isHot(entries[i])) repaintEntry(entries[i]);
            }
        }

        return {
            create: function (options) {
                options = options || {};

                var horizontal = String(options.orientation || 'vertical') === 'horizontal';
                var entry = {
                    hovering: false,
                    dragging: false,
                    repaint: typeof options.repaint === 'function' ? options.repaint : function () { }
                };

                var instance = {
                    hover: function (isOver) {
                        var next = !!isOver;

                        // Keep this before the equality check: consumers call hover()
                        // after drag end to restore the cursor even if hover state is unchanged.
                        if (!entry.dragging) {
                            setCursor(next ? (horizontal ? IDC_SIZENS : IDC_SIZEWE) : IDC_ARROW);
                        }
                        if (next === entry.hovering) return false;

                        var wasHot = isHot(entry);
                        entry.hovering = next;
                        if (wasHot !== isHot(entry)) repaintEntry(entry);
                        return true;
                    },

                    // Dragging keeps the line visible when the pointer leaves the divider.
                    dragging: function (isDragging) {
                        var next = !!isDragging;
                        if (next === entry.dragging) return false;

                        var wasHot = isHot(entry);
                        entry.dragging = next;
                        if (next) setCursor(horizontal ? IDC_SIZENS : IDC_SIZEWE);
                        if (wasHot !== isHot(entry)) repaintEntry(entry);
                        return true;
                    },

                    draw: function (gr, x, y, w, h) {
                        var thickness;

                        if (!isHot(entry) || !gr) return false;

                        w = Math.max(0, Number(w) || 0);
                        h = Math.max(0, Number(h) || 0);
                        if (w <= 0 || h <= 0) return false;

                        if (horizontal) {
                            thickness = Math.max(1, Math.min(scaled(LINE_THICKNESS), h));
                            gr.FillSolidRect(
                                x,
                                y + Math.floor((h - thickness) / 2),
                                w,
                                thickness,
                                accent
                            );
                        } else {
                            thickness = Math.max(1, Math.min(scaled(LINE_THICKNESS), w));
                            gr.FillSolidRect(
                                x + Math.floor((w - thickness) / 2),
                                y,
                                thickness,
                                h,
                                accent
                            );
                        }

                        return true;
                    },

                    onNotifyData: function (name, info) {
                        if (name !== SHARED_ALBUM_ACCENT_UPDATE) return false;
                        if (!SharedAccentProtocol.isColour(info)) return true;

                        var next = SharedAccentProtocol.opaque(info);
                        if (next === accent) return true;

                        accent = next;
                        repaintAll();
                        return true;
                    },

                    requestAccent: function () {
                        SharedAccentProtocol.requestAccent();
                    }
                };

                entries.push(entry);
                return instance;
            }
        };
    }());
}
