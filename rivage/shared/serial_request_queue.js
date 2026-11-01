'use strict';

// One HTTP request at a time, paced, with a cooldown and a watchdog, for the panels
// that sweep a rate-limited service. Each request context carries the panel's
// `generation`; anything from an older generation is dropped. What to do about a
// failure (retry, give up, what to tell the user) stays with the panel.
if (typeof SerialRequestQueue === 'undefined') {
    var SerialRequestQueue = (function () {
        function isTransient(status) {
            return status === 0 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        }

        function retryDelay(retries, baseMs, maxMs, jitterMs) {
            var exponential = baseMs * Math.pow(2, Math.max(0, Number(retries || 0)));
            return Math.min(exponential, maxMs) + Math.floor(Math.random() * (jitterMs + 1));
        }

        // options: intervalMs, timeoutMs, headers(), isActive(), generation(),
        // onFailure(context, status, detail); optional extraWait(now), onSent(context).
        function create(options) {
            var queue = [];
            var inFlight = new Map();
            var timer = 0;
            var watchdog = 0;
            var lastRequestAt = 0;
            var blocked = 0;

            function clear(id) {
                if (id) { try { window.ClearTimeout(id); } catch (e) { } }
            }

            function stopTimer() {
                clear(timer);
                timer = 0;
            }

            function stopWatchdog() {
                clear(watchdog);
                watchdog = 0;
            }

            // A request the host never settles would hold the queue forever, so give
            // up on it and treat it like a dropped connection.
            function armWatchdog(taskId) {
                stopWatchdog();
                watchdog = window.SetTimeout(function () {
                    watchdog = 0;
                    if (!options.isActive()) return;
                    var context = inFlight.get(taskId);
                    if (!context) return;
                    inFlight.delete(taskId);
                    if (context.generation !== options.generation()) {
                        pump();
                        return;
                    }
                    options.onFailure(context, 0, 'No response after ' + Math.round(options.timeoutMs / 1000) + ' s');
                }, options.timeoutMs);
            }

            function pump() {
                if (!options.isActive()) return;
                stopTimer();

                var current = options.generation();
                while (queue.length && queue[0].generation !== current) queue.shift();
                if (!queue.length) return;
                // Strictly serial: a slow response cannot pile requests up, and the
                // cooldown stays authoritative.
                if (inFlight.size) return;

                var now = Date.now();
                var wait = Math.max(
                    options.intervalMs - (now - lastRequestAt),
                    blocked - now,
                    options.extraWait ? options.extraWait(now) : 0
                );
                if (wait > 0) {
                    timer = window.SetTimeout(pump, wait);
                    return;
                }

                var context = queue.shift();
                try {
                    var taskId = utils.HTTPRequestAsync(0, context.url, options.headers());
                    lastRequestAt = Date.now();
                    inFlight.set(taskId, context);
                    armWatchdog(taskId);
                    if (options.onSent) options.onSent(context);
                } catch (e) {
                    // Deferred, or a host that throws for every URL would recurse
                    // through the whole queue on one stack.
                    var detail = String(e);
                    window.SetTimeout(function () { options.onFailure(context, 0, detail); }, 0);
                }
            }

            return {
                enqueue: function (context) {
                    if (!options.isActive()) return;
                    queue.push(context);
                    pump();
                },
                pump: pump,
                // The context of a finished request, or null when it is unknown or stale.
                take: function (taskId) {
                    var context = inFlight.get(taskId);
                    if (!context) return null;
                    inFlight.delete(taskId);
                    stopWatchdog();
                    if (context.generation !== options.generation()) {
                        pump();
                        return null;
                    }
                    // Whatever queued up behind it may go once the caller has handled this one.
                    if (queue.length) {
                        stopTimer();
                        timer = window.SetTimeout(pump, 0);
                    }
                    return context;
                },
                // Puts a failed request back at the front, one retry further on.
                retry: function (context) {
                    queue.unshift(Object.assign({}, context, { retries: Number(context.retries || 0) + 1 }));
                    pump();
                },
                clear: function () {
                    queue = [];
                    inFlight.clear();
                    stopTimer();
                    stopWatchdog();
                },
                block: function (delayMs) {
                    blocked = Math.max(blocked, Date.now() + delayMs);
                    return blocked;
                },
                unblock: function () { blocked = 0; },
                blockedUntil: function () { return blocked; },
                queuedCount: function () { return queue.length; },
                inFlightCount: function () { return inFlight.size; }
            };
        }

        return { create: create, isTransient: isTransient, retryDelay: retryDelay };
    })();
}
