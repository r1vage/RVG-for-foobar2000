'use strict';

// Renders the blurred Mica derivative JPEG from decoded artwork. GDI+ and utils
// only, so the producer (tab-switcher-right.js, via RivageBackdrop.buildDescriptor)
// and the artwork Worker (artwork_worker.js) run the same code.

var RivageMicaDerivative = (typeof RivageMicaDerivative !== 'undefined' && RivageMicaDerivative &&
    RivageMicaDerivative.version) ? RivageMicaDerivative : (function () {
    // Radius values are authored against this edge and rescaled to the derivative
    // actually produced, so a smaller one blurs, encodes and writes for less.
    var BLUR_REFERENCE_EDGE = 640;

    function integer(value, minimum, maximum, fallback) {
        value = Number(value);
        if (!isFinite(value)) value = fallback;
        return Math.round(Math.max(minimum, Math.min(maximum, value)));
    }

    function disposeBitmap(bitmap) {
        if (!bitmap || typeof bitmap.Dispose !== 'function') return;
        try { bitmap.Dispose(); } catch (e) { }
    }

    // Throws on failure; true only once the file is on disk.
    function render(image, path, blurRadius, maxEdge) {
        var working = null;
        try {
            working = image.Clone(0, 0, image.Width, image.Height);
            if (!working) throw new Error('album-art clone failed');

            var longest = Math.max(working.Width, working.Height);
            if (longest > maxEdge) {
                var ratio = maxEdge / longest;
                var resized = working.Resize(
                    Math.max(1, Math.round(working.Width * ratio)),
                    Math.max(1, Math.round(working.Height * ratio)),
                    7
                );
                if (resized && resized !== working) {
                    var previous = working;
                    working = resized;
                    disposeBitmap(previous);
                }
            }

            var appliedEdge = Math.max(working.Width, working.Height);
            working.StackBlur(integer(blurRadius * appliedEdge / BLUR_REFERENCE_EDGE, 2, 254, blurRadius));
            if (!working.SaveAs(path, 'image/jpeg') || !utils.FileExists(path)) {
                throw new Error('current-image derivative could not be written');
            }
            return true;
        } finally {
            disposeBitmap(working);
        }
    }

    return {
        version: '1.0.0',
        render: render
    };
}());
