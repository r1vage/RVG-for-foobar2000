'use strict';

// Compact volume slider that shares SeekbarWidget's live appearance settings.
// Consumers must load settings_protocol.js and seekbar_widget.js first.
// Repeated include() calls preserve the singleton and existing widget instances.

var VolumeBarWidget = (typeof VolumeBarWidget !== 'undefined') ? VolumeBarWidget : (function () {
    var dpi = 100;

    function vbClamp(value, min, max) {
        var n = Number(value);
        if (!isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
    }

    function scale(value) {
        return Math.round(value * dpi / 100);
    }

    function seekbarSettings() {
        try {
            return (typeof SeekbarWidget !== 'undefined' && SeekbarWidget && SeekbarWidget.settings)
                ? SeekbarWidget.settings : null;
        } catch (e) {
            return null;
        }
    }

    // vendor/Helpers.js's unused vol2pos() has a variable-name typo, so keep the
    // corrected perceptual foobar volume curve local rather than depending on it.
    function volumeToFraction(volume) {
        var v = vbClamp(volume, -100, 0);
        return vbClamp((Math.pow(10, v / 50) - 0.01) / 0.99, 0, 1);
    }

    function fractionToVolume(fraction) {
        var p = vbClamp(fraction, 0, 1);
        return vbClamp(50 * Math.log(0.99 * p + 0.01) / Math.LN10, -100, 0);
    }

    function roundRectRadius(w, h, preferred) {
        return Math.max(0, Math.min(preferred, w / 2, h / 2));
    }

    function trackRect(instance, outer) {
        // Playing Info matches SeekbarWidget's 38 px time labels + 8 px margins.
        var matchSeekbar = instance && instance.matchSeekbarTrack;
        var inset = matchSeekbar
            ? Math.max(0, scale(38) + scale(8))
            : Math.max(0, scale(2));
        return {
            x: outer.x + inset,
            y: outer.y,
            w: Math.max(matchSeekbar ? 10 : 1, outer.w - inset * 2),
            h: outer.h
        };
    }

    function fractionFromRect(rect, x) {
        return vbClamp((x - rect.x) / Math.max(1, rect.w), 0, 1);
    }

    function isOverTrackRect(rect, outer, x, y) {
        var margin = Math.max(4, scale(6));
        return x >= rect.x - margin && x <= rect.x + rect.w + margin &&
            y >= outer.y - margin && y <= outer.y + outer.h + margin;
    }

    function currentFraction(instance) {
        if (instance.drag) return instance.dragFraction;
        try {
            return volumeToFraction(fb.Volume);
        } catch (e) {
            return 0;
        }
    }

    function setVolumeFromFraction(fraction) {
        try {
            fb.Volume = fractionToVolume(fraction);
        } catch (e) {
            // Host is unloading or does not expose writable fb.Volume.
        }
    }

    function draw(instance, gr, outer, accentColour) {
        var rect = trackRect(instance, outer);
        var shared = seekbarSettings();
        var trackColour = shared ? Number(shared.trackColour) : 0xff3a3a3a;
        var barThickness = shared ? Math.max(2, Number(shared.barThickness) || 4) : 4;
        var alwaysShowThumb = shared ? !!shared.alwaysShowThumb : false;
        var trackH = Math.max(2, scale(barThickness));
        var trackY = rect.y + (rect.h - trackH) / 2;
        var frac = currentFraction(instance);
        var fillW = Math.round(rect.w * frac);
        var radius = trackH / 2;
        var thumbD = Math.max(trackH * 2.4, scale(10));
        var fillRadius;

        gr.FillRoundRect(
            rect.x, trackY, rect.w, trackH,
            roundRectRadius(rect.w, trackH, radius),
            roundRectRadius(rect.w, trackH, radius),
            trackColour
        );

        if (fillW > 0) {
            fillRadius = roundRectRadius(fillW, trackH, radius);
            gr.FillRoundRect(rect.x, trackY, fillW, trackH, fillRadius, fillRadius, accentColour);
        }

        if (alwaysShowThumb || instance.hover || instance.drag) {
            var thumbX = rect.x + fillW - thumbD / 2;
            gr.FillEllipse(thumbX, rect.y + (rect.h - thumbD) / 2, thumbD, thumbD, accentColour);
        }
    }

    function createInstance(options) {
        options = options || {};
        return {
            matchSeekbarTrack: !!options.matchSeekbarTrack,
            hover: false,
            drag: false,
            dragFraction: 0,

            draw: function (gr, outer, accentColour) {
                if (!outer || outer.w <= 0 || outer.h <= 0) return;
                draw(this, gr, outer, accentColour);
            },

            // Returns { changed, hot }, matching SeekbarWidget's host contract.
            onMouseMove: function (outer, x, y) {
                var changed = false;
                var nextHover;
                var nextFraction;
                var rect;

                if (!outer) {
                    if (this.hover) {
                        this.hover = false;
                        changed = true;
                    }
                    return { changed: changed, hot: false };
                }

                rect = trackRect(this, outer);
                if (this.drag) {
                    nextFraction = fractionFromRect(rect, x);
                    if (nextFraction !== this.dragFraction) {
                        this.dragFraction = nextFraction;
                        setVolumeFromFraction(nextFraction);
                        changed = true;
                    }
                }

                nextHover = isOverTrackRect(rect, outer, x, y);
                if (nextHover !== this.hover) {
                    this.hover = nextHover;
                    changed = true;
                }

                return { changed: changed, hot: this.hover || this.drag };
            },

            onMouseLeave: function () {
                var changed = this.hover;
                this.hover = false;
                return changed;
            },

            onMouseDown: function (outer, x, y) {
                var rect;
                if (!outer) return false;
                rect = trackRect(this, outer);
                if (!isOverTrackRect(rect, outer, x, y)) return false;
                this.drag = true;
                this.dragFraction = fractionFromRect(rect, x);
                setVolumeFromFraction(this.dragFraction);
                return true;
            },

            onMouseUp: function (outer, x, y) {
                var nextFraction;
                if (!this.drag) return false;
                if (outer) {
                    nextFraction = fractionFromRect(trackRect(this, outer), x);
                    if (nextFraction !== this.dragFraction) {
                        this.dragFraction = nextFraction;
                        setVolumeFromFraction(nextFraction);
                    }
                }
                this.drag = false;
                return true;
            }
        };
    }

    return {
        create: createInstance,
        setDpi: function (value) {
            dpi = Math.max(50, Math.round(Number(value) || 100));
        },
        volumeToFraction: volumeToFraction,
        fractionToVolume: fractionToVolume
    };
})();
