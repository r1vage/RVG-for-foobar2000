'use strict';

// One GET through ActiveX XMLHTTP, for panels that need to cancel a request or read
// its headers. done(status, body, retryAfter) runs exactly once unless the request
// is cancelled first; status 0 means it failed or timed out. Returns cancel().
if (typeof XmlHttpGet === 'undefined') {
    var XmlHttpGet = (function () {
        include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\report_failure.js');
        var reportFailure = RivageFailure.reporter('[XmlHttpGet] ');

        function noop() { }

        function get(url, headers, timeoutMs, done) {
            var http = null, watchdog = null, finished = false;

            // XMLHTTP holds the JS ready-state handler through COM while the closure holds
            // XMLHTTP. Break that cycle on every settle/cancel path or long sessions leak.
            function release() {
                if (!http) return null;
                var dead = http;
                http = null;
                // The COM property rejects null (type mismatch); an empty top-level function holds no request state.
                try { dead.onreadystatechange = noop; } catch (e) { reportFailure('the XMLHTTP callback could not be released', e); }
                return dead;
            }
            function settle() {
                if (finished) return null;
                finished = true;
                if (watchdog !== null) { try { window.ClearTimeout(watchdog); } catch (e) { } watchdog = null; }
                return release();
            }
            function cancel() {
                var dead = settle();
                if (dead) { try { dead.abort(); } catch (e) { } }
            }
            function finish(status, body, retryAfter) {
                if (finished) return;
                settle();
                done(status, body, retryAfter);
            }

            try {
                http = new ActiveXObject('Microsoft.XMLHTTP');
                http.open('GET', url, true);
                for (var k in headers) { try { http.setRequestHeader(k, headers[k]); } catch (e) { } }
                http.onreadystatechange = function () {
                    if (!http || http.readyState != 4) return;
                    var status = 0, body = null, retryAfter = '';
                    try { status = http.status; } catch (e) { }
                    try { body = http.responseText; } catch (e) { }
                    try { retryAfter = http.getResponseHeader('Retry-After') || ''; } catch (e) { }
                    finish(status, body, retryAfter);
                };
                watchdog = window.SetTimeout(function () {
                    watchdog = null;
                    if (http) { try { http.abort(); } catch (e) { } }
                    finish(0, null, '');
                }, timeoutMs);
                http.send();
            } catch (e) {
                finish(0, null, '');
            }
            return cancel;
        }

        return { get: get };
    })();
}
