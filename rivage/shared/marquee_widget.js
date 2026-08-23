'use strict';

// Shared scrolling-text engine for panel title/subtitle marquees.
// prepare() owns its cached bitmap and rebuilds it whenever a render input changes;
// startTimer() uses wall-clock position so delayed host timers do not accumulate jitter.
// Repeated include() calls must preserve the singleton and existing widget instances.

var MarqueeWidget = (typeof MarqueeWidget !== 'undefined') ? MarqueeWidget : (function () {
    var DEFAULT_TEXT_RENDERING_HINT_ANTIALIAS = 4;

    function noop() {}

    function create(options) {
        options = options || {};

        var cfg = {
            interval: options.interval > 0 ? options.interval : 33,
            speed: options.speed > 0 ? options.speed : 40,
            pause: options.pause !== undefined ? Math.max(0, Number(options.pause) || 0) : 1400,
            gap: options.gap !== undefined ? Math.max(0, Number(options.gap) || 0) : 48
        };

        var isVisible = typeof options.isVisible === 'function' ? options.isVisible : function () { return true; };
        var skipWorkWhenHidden = options.skipWorkWhenHidden !== false;
        var stopTimerWhenHidden = !!options.stopTimerWhenHidden;
        var speedScale = typeof options.speedScale === 'function' ? options.speedScale : function () { return 1; };
        var onTick = typeof options.onTick === 'function' ? options.onTick : noop;

        var state = {
            image: null,
            text: '',
            font: null,
            viewportW: 0,
            viewportH: 0,
            textWidth: 0,
            gap: 0,
            pad: 0,
            textColour: null,
            textY: 0,
            textRenderingHint: DEFAULT_TEXT_RENDERING_HINT_ANTIALIAS,
            loopW: 0,
            phase: 'pause',
            pauseUntil: 0,
            scrollStartTime: 0,
            timer: null,
            timerGeneration: 0
        };

        function stopTimer() {
            // Invalidate callbacks that ClearTimeout cannot retract after they are queued.
            state.timerGeneration += 1;
            var timer = state.timer;
            state.timer = null;
            if (timer !== null) {
                try { window.ClearTimeout(timer); } catch (e) { }
            }
        }

        function reset() {
            stopTimer();
            state.image = null;
            state.text = '';
            state.font = null;
            state.viewportW = 0;
            state.viewportH = 0;
            state.textWidth = 0;
            state.gap = 0;
            state.pad = 0;
            state.textColour = null;
            state.textY = 0;
            state.textRenderingHint = DEFAULT_TEXT_RENDERING_HINT_ANTIALIAS;
            state.loopW = 0;
            state.phase = 'pause';
            state.pauseUntil = 0;
            state.scrollStartTime = 0;
        }

        // Wall-clock positioning avoids accumulating SetTimeout / WM_PAINT scheduling jitter.
        function currentScrollOffset(now) {
            return cfg.speed * speedScale() * Math.max(0, now - state.scrollStartTime) / 1000;
        }

        function startTimer() {
            if (state.timer !== null || !state.image) return;
            if (skipWorkWhenHidden && !isVisible()) return;

            var generation = state.timerGeneration + 1;
            state.timerGeneration = generation;
            var start = Date.now();
            state.phase = 'pause';
            state.pauseUntil = start + cfg.pause;

            function schedule(delay) {
                if (generation !== state.timerGeneration) return;
                state.timer = window.SetTimeout(tick, Math.max(1, Math.floor(delay)));
            }

            function tick() {
                // A stale callback must never clear or replace a newer run's timer handle.
                if (generation !== state.timerGeneration) return;

                try {
                    state.timer = null;

                    if (skipWorkWhenHidden && !isVisible()) {
                        if (!stopTimerWhenHidden) schedule(cfg.interval);
                        return;
                    }

                    var now = Date.now();

                    if (state.phase === 'pause') {
                        if (now < state.pauseUntil) {
                            schedule(state.pauseUntil - now);
                            return;
                        }
                        state.phase = 'scroll';
                        state.scrollStartTime = now;
                        schedule(cfg.interval);
                        return;
                    }

                    if (currentScrollOffset(now) >= state.loopW) {
                        state.phase = 'pause';
                        state.pauseUntil = now + cfg.pause;
                    }

                    onTick();
                    schedule(state.phase === 'pause' ? cfg.pause : cfg.interval);
                } catch (e) {
                    if (generation === state.timerGeneration) {
                        state.timer = null;
                        state.timerGeneration += 1;
                    }
                }
            }

            schedule(cfg.pause);
        }

        // Returns true when scrolling is active for the supplied text/viewport.
        function prepare(text, font, rect, buildOptions) {
            buildOptions = buildOptions || {};
            var measureText = buildOptions.measureText;
            var scale = typeof buildOptions.scale === 'function' ? buildOptions.scale : function (v) { return v; };

            if (!rect || rect.w <= 0 || rect.h <= 0 || !text || !font || typeof measureText !== 'function') {
                reset();
                return false;
            }

            var textWidth = Math.ceil(measureText(text, font));
            if (textWidth <= rect.w) {
                reset();
                return false;
            }

            var gap = scale(cfg.gap);
            var pad = scale(4);
            var imageHeight = Math.max(1, rect.h);
            var textY = typeof buildOptions.textY === 'function' ? buildOptions.textY(imageHeight) : 0;
            var textRenderingHint = buildOptions.textRenderingHint !== undefined
                ? buildOptions.textRenderingHint
                : DEFAULT_TEXT_RENDERING_HINT_ANTIALIAS;

            var needsRebuild = !state.image || state.text !== text || state.font !== font ||
                state.viewportW !== rect.w || state.viewportH !== rect.h ||
                state.textWidth !== textWidth || state.gap !== gap || state.pad !== pad ||
                state.textColour !== buildOptions.textColour || state.textY !== textY ||
                state.textRenderingHint !== textRenderingHint;

            if (!needsRebuild) {
                startTimer();
                return true;
            }

            reset();

            var loopWidth = textWidth + gap;
            var imageWidth = Math.ceil(loopWidth * 2);
            var image = null;
            var graphics = null;
            var noWrap = typeof StringFormatFlags !== 'undefined' ? StringFormatFlags.NoWrap : 0x1000;

            try {
                image = gdi.CreateImage(imageWidth, imageHeight);
                if (!image || typeof image.GetGraphics !== 'function') return false;

                graphics = image.GetGraphics();
                if (!graphics || typeof graphics.DrawString !== 'function') return false;

                try {
                    if (typeof graphics.SetTextRenderingHint === 'function') {
                        graphics.SetTextRenderingHint(textRenderingHint);
                    }
                } catch (e) { }

                graphics.DrawString(text, font, buildOptions.textColour, 0, textY, textWidth + pad, imageHeight, noWrap);
                graphics.DrawString(text, font, buildOptions.textColour, loopWidth, textY, textWidth + pad, imageHeight, noWrap);
            } catch (e) {
                return false;
            } finally {
                if (image && graphics && typeof image.ReleaseGraphics === 'function') {
                    try { image.ReleaseGraphics(graphics); } catch (e) { }
                }
            }

            state.image = image;
            state.text = text;
            state.font = font;
            state.viewportW = rect.w;
            state.viewportH = rect.h;
            state.textWidth = textWidth;
            state.gap = gap;
            state.pad = pad;
            state.textColour = buildOptions.textColour;
            state.textY = textY;
            state.textRenderingHint = textRenderingHint;
            state.loopW = loopWidth;
            startTimer();
            return true;
        }

        function draw(gr, rect) {
            if (!state.image || !rect) return false;

            var offset = state.phase === 'scroll'
                ? Math.min(state.loopW, currentScrollOffset(Date.now()))
                : 0;

            gr.DrawImage(
                state.image,
                rect.x, rect.y, rect.w, rect.h,
                Math.floor(offset), 0, rect.w, rect.h,
                0, 255
            );
            return true;
        }

        return {
            reset: reset,
            stopTimer: stopTimer,
            startTimer: startTimer,
            prepare: prepare,
            draw: draw,
            isActive: function () { return !!state.image; }
        };
    }

    return { create: create };
})();
