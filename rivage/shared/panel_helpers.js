'use strict';

// Text, JSON and network-diagnostics helpers for the panels that sweep a web
// service: Discography, Live shows and the MusicBrainz tagger. Plain globals, so
// the panels call them as they did when each had its own copy.

function cleanSpaces(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function plural(n, singular, pluralForm) {
    return n + ' ' + (n === 1 ? singular : (pluralForm || singular + 's'));
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function clearTimer(timerId) {
    if (timerId) window.ClearTimeout(timerId);
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeAccentMode(value) {
    const mode = String(value || '').toLowerCase();
    return mode === 'fixed' || mode === 'host' ? mode : 'shared';
}

function debugSnippet(value, maxLength) {
    const max = Math.max(40, Number(maxLength || 220));
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

function debugDateTime(value) {
    const time = Number(value || 0);
    if (!(time > 0)) return 'never';
    const d = new Date(time);
    function two(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
        ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

// The last network operation, for a panel's Diagnostics rows.
var networkDebug = { state: 'idle', kind: '', at: 0, httpStatus: 0, detail: '' };

function setNetworkDebug(state, kind, detail, httpStatus) {
    networkDebug = {
        state: String(state || 'idle'),
        kind: String(kind || ''),
        at: Date.now(),
        httpStatus: Number(httpStatus || 0),
        detail: debugSnippet(detail, 240)
    };
}

function describeLastRequest() {
    return networkDebug.state + (networkDebug.kind ? ' (' + networkDebug.kind + ')' : '') +
        '; ' + debugDateTime(networkDebug.at) +
        (networkDebug.httpStatus ? '; HTTP ' + networkDebug.httpStatus : '') +
        (networkDebug.detail ? '; ' + networkDebug.detail : '');
}
