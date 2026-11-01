'use strict';

// Console reporting for failures that would otherwise leave no trace. Repeats of
// one message are counted and re-logged only at powers of ten.
if (typeof RivageFailure === 'undefined') {
    var RivageFailure = {
        reporter: function (prefix) {
            var counts = {};
            return function (what, err) {
                var message = prefix + what + (err === undefined || err === null ? '' : ': ' + err);
                var seen = (counts[message] || 0) + 1;
                counts[message] = seen;
                if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
                try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
            };
        }
    };
}
