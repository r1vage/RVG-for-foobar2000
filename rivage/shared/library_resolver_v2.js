'use strict';

// Remote metadata -> local-library resolver. Loose title/album-only fallbacks
// are search/display-only and must never enable playback actions.
var RivageLibraryResolver = (typeof RivageLibraryResolver !== 'undefined') ? RivageLibraryResolver : (function () {
    var SORT_TF = fb.TitleFormat('%album artist%|%date%|%album%|%discnumber%|%tracknumber%|%title%|%path%');

    // Narrow failure reporting. The other empty catches in this file guard
    // fast-path/optional-API probes with a working fallback below and stay
    // silent on purpose. This is for the one case with no fallback: a sort
    // that silently fails leaves the list in the wrong order with no trace.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[RivageLibraryResolver] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    function text(value) {
        return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function escapeQuery(value) {
        return text(value).replace(/"/g, '""');
    }

    function clause(field, op, value) {
        return field + ' ' + op + ' "' + escapeQuery(value) + '"';
    }

    function artistClause(artist) {
        artist = text(artist);
        if (!artist) return '';
        return '(' + clause('ARTIST', 'IS', artist) + ' OR ' + clause('ALBUM ARTIST', 'IS', artist) + ')';
    }

    function descriptorKind(descriptor) {
        var kind = text(descriptor && descriptor.type).toLowerCase();
        return kind === 'artist' || kind === 'album' ? kind : 'track';
    }

    function buildQueryPlan(descriptor) {
        descriptor = descriptor || {};
        var kind = descriptorKind(descriptor);
        var artist = text(descriptor.artist);
        var album = text(descriptor.album);
        var title = text(descriptor.title);
        var rgid = text(descriptor.releaseGroupMbid).toLowerCase();
        var artistQ = artistClause(artist);
        var strict = [];
        var loose = [];
        var albumQ;
        var titleQ;

        if (rgid) {
            strict.push('(' + clause('MUSICBRAINZ_RELEASEGROUPID', 'IS', rgid) +
                ' OR ' + clause('MUSICBRAINZ RELEASE GROUP ID', 'IS', rgid) + ')');
        }

        if (kind === 'artist') {
            if (artistQ) strict.push(artistQ);
            return { strict: strict, loose: loose };
        }

        if (kind === 'album') {
            if (album) {
                albumQ = clause('ALBUM', 'IS', album);
                if (artistQ) {
                    strict.push(artistQ + ' AND ' + albumQ);
                    loose.push(albumQ);
                } else {
                    loose.push(albumQ);
                }
            }
            return { strict: strict, loose: loose };
        }

        if (title) {
            titleQ = clause('TITLE', 'IS', title);
            if (artistQ) {
                if (album) strict.push(artistQ + ' AND ' + clause('ALBUM', 'IS', album) + ' AND ' + titleQ);
                strict.push(artistQ + ' AND ' + titleQ);
                loose.push(titleQ);
            } else {
                loose.push(titleQ);
            }
        }
        return { strict: strict, loose: loose };
    }

    // Back-compatible flat view: strict queries first, then loose fallbacks.
    function buildQueries(descriptor) {
        var plan = buildQueryPlan(descriptor);
        return plan.strict.concat(plan.loose);
    }

    function listToArray(list) {
        var handles = [];
        var converted;
        var i;
        var count;
        var handle;

        if (!list) return handles;

        try {
            if (typeof list.Convert === 'function') {
                converted = list.Convert();
                if (converted && typeof converted.length === 'number') {
                    for (i = 0; i < converted.length; i++) {
                        if (converted[i]) handles.push(converted[i]);
                    }
                    return handles;
                }
            }
        } catch (eConvert) { }

        count = Number(list.Count) || 0;
        for (i = 0; i < count; i++) {
            handle = null;
            try { handle = list[i]; } catch (eIndex) { handle = null; }
            if (!handle) {
                try {
                    if (typeof list.Item === 'function') handle = list.Item(i);
                } catch (eItem) { handle = null; }
            }
            if (handle) handles.push(handle);
        }
        return handles;
    }

    function cloneList(list) {
        if (!list) return new FbMetadbHandleList([]);
        try {
            if (typeof list.Clone === 'function') return list.Clone();
        } catch (eClone) { }
        return new FbMetadbHandleList(listToArray(list));
    }

    function sortList(list) {
        var copy = cloneList(list);
        try { copy.OrderByFormat(SORT_TF, 1); } catch (e) { reportFailure('a playlist could not be sorted', e); }
        return copy;
    }

    function firstOnly(list) {
        var handles = listToArray(list);
        return new FbMetadbHandleList(handles.length ? [handles[0]] : []);
    }

    function runQueries(library, queries) {
        var matched = null;
        var query = '';
        var i;
        for (i = 0; i < queries.length; i++) {
            try { matched = fb.GetQueryItems(library, queries[i]); } catch (e2) { matched = null; }
            if (matched && matched.Count > 0) {
                query = queries[i];
                break;
            }
            matched = null;
        }
        return { matched: matched, query: query };
    }

    function resolve(descriptor) {
        descriptor = descriptor || {};
        var kind = descriptorKind(descriptor);
        var plan = buildQueryPlan(descriptor);
        var queries = plan.strict.concat(plan.loose);
        var library = null;
        var strictRun;
        var looseRun;
        var displayMatched;
        var displayQuery;
        var actionMatched;

        try { library = fb.GetLibraryItems(); } catch (e) { library = null; }
        if (!library) library = new FbMetadbHandleList([]);

        strictRun = runQueries(library, plan.strict);
        // Loose fallbacks are intentionally never promoted into action handles.
        looseRun = strictRun.matched ? { matched: null, query: '' } : runQueries(library, plan.loose);

        if (strictRun.matched) {
            displayMatched = sortList(strictRun.matched);
            displayQuery = strictRun.query;
            actionMatched = kind === 'track' ? firstOnly(displayMatched) : cloneList(displayMatched);
        } else {
            displayMatched = looseRun.matched ? sortList(looseRun.matched) : new FbMetadbHandleList([]);
            displayQuery = looseRun.query;
            actionMatched = new FbMetadbHandleList([]);
        }

        return {
            descriptor: descriptor,
            query: displayQuery,
            queries: queries,
            all: displayMatched,
            action: actionMatched,
            count: displayMatched.Count
        };
    }

    return {
        buildQueries: buildQueries,
        buildQueryPlan: buildQueryPlan,
        resolve: resolve,
        escapeQuery: escapeQuery,
        listToArray: listToArray
    };
})();
