'use strict';

// Worker realm (JSplitter 4.2+): artwork decode, palette extraction and the Mica
// derivative for the theme producer. The client and its synchronous fallback live
// in tab-switcher-right.js ("Artwork worker").
//
// Request: { type: 'extract', id, handle, config: { algorithm, backgroundTone,
//            fixedAccent }, job: null | { path, blurRadius, maxEdge } }
// Reply:   { type: 'extracted', id, theme, hasArtwork, generated, error }
// Exactly one reply per request, in order; a superseded job still writes its file,
// and the client retires it on that reply.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\material_colour.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_engine.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_derivative.js');

var configuredAlgorithm = '';

function configure(config) {
    config = config || {};
    var options = { algorithm: config.algorithm };
    if (typeof config.backgroundTone === 'number' && isFinite(config.backgroundTone)) {
        options.backgroundTone = config.backgroundTone;
    }
    AlbumAccentEngine.configure(options);
    if (typeof config.fixedAccent === 'number') AlbumAccentEngine.FIXED_ACCENT = config.fixedAccent >>> 0;
    // The memo holds payloads scored by the previous algorithm.
    if (configuredAlgorithm && configuredAlgorithm !== AlbumAccentEngine.algorithm) {
        AlbumAccentEngine.clear_memo();
    }
    configuredAlgorithm = AlbumAccentEngine.algorithm;
}

function extract(request) {
    var reply = {
        type: 'extracted', id: request.id,
        theme: null, hasArtwork: false, generated: false, error: ''
    };
    var handle = request.handle || null;
    var job = request.job || null;
    var artwork = null;
    try {
        configure(request.config);
        var theme = AlbumAccentEngine.lookupTheme(AlbumAccentEngine.key_for(handle));
        if (job || !theme) artwork = AlbumAccentEngine.load_artwork(handle);
        // A null artwork makes the engine retry the load itself, as the panel path does.
        reply.theme = theme || AlbumAccentEngine.extractThemeFromImage(artwork, handle);
        reply.hasArtwork = !!artwork;
        if (job && artwork) {
            reply.generated = RivageMicaDerivative.render(artwork, job.path, job.blurRadius, job.maxEdge);
        }
    } catch (e) {
        // A failed render is an ordinary "no derivative"; only a missing theme disables the worker.
        if (reply.theme) console.log('[RVG Artwork Worker] Mica derivative failed: ' + e);
        else reply.error = String(e && e.message ? e.message : e);
    } finally {
        if (artwork && typeof artwork.Dispose === 'function') {
            try { artwork.Dispose(); } catch (e2) { }
        }
    }
    return reply;
}

onmessage = function (event) {
    var request = event && event.data;
    if (!request || request.type !== 'extract') return;
    postMessage(extract(request));
};
