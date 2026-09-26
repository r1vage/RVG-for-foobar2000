'use strict';

// Shared artwork-backed Mica backdrop - see README.md, "Artwork Mica - blurred".
// The bottom-tabs controller is the sole producer; every other panel paints the
// slice of the cached derivative that maps to its rectangle in the outer Root
// Splitter. Coordinate-mapped sampling, never JSplitter pseudo-transparency,
// whose native window toggles flicker.
// Registers no callbacks; include design_system.js and visible_paint_work.js first.

if (typeof RivageBackdrop === 'undefined') {
    var RivageBackdrop = (function () {
        var CACHE_DIRECTORY = fb.ProfilePath + 'jsplitter\\rivage\\cache\\mica\\';
        var DEFAULT_MAX_EDGE = 384;
        var DEFAULT_BLUR_RADIUS = 70;
        var DEFAULT_TINT_ALPHA = 158; // 62%, the Global settings default tint strength
        var CURRENT_FILE_CLEANUP_DELAY = 1500;
        var CURRENT_FILE_CLEANUP_RETRY_DELAY = 900;
        var CURRENT_FILE_CLEANUP_MAX_ATTEMPTS = 20;
        var IMAGE_HANDOFF_RETRY_DELAY = 90;
        var IMAGE_HANDOFF_RETRY_MAX_ATTEMPTS = 6;
        // HighQualityBicubic (7) manufactures a 1 px halo at DrawImage edges, which
        // becomes a seam between panel slices; Mica is blurred anyway, so the mapped
        // draw uses Bilinear (3) and restores 7 afterwards for album-art thumbnails.
        var GDI_MICA_INTERPOLATION = 3;
        var POST_MICA_INTERPOLATION = 7;

        var producerPrepared = false;
        var producerSession = String(new Date().getTime().toString(36));
        var producerSequence = 0;
        // Only the current artwork's derivative is kept. A replacement is written to a
        // fresh path so consumers never see a half-written file; the old path is
        // retired once they have had time to dispose their native image.
        var producerCurrentMemoKey = '';
        var producerCurrentDescriptor = null;
        var obsoleteProducerPaths = [];
        var producerCleanupTimer = null;

        var loadedImage = null;
        var loadedPath = '';
        var loadedDrawMode = -1;
        // Retained while a replacement opens so the panel never blanks. Native objects
        // local to this context; only their paths travel through the protocol.
        var previousImage = null;
        var previousPath = '';
        var previousDrawMode = -1;
        // Opened during PREPARE, one turn before COMMIT, so every panel has the
        // replacement ready at the commit instead of decoding in its own first paint.
        var stagedImage = null;
        var stagedPath = '';
        var stagedDrawMode = -1;
        var requestedPath = '';
        var requestedLoadKey = '';
        var loadWork = null;
        var directLoadAttemptedKey = '';
        var imageRetryTimer = null;
        var imageRetryKey = '';
        var imageRetryAttempts = 0;

        var JSPLITTER_COMPONENT = 'JSplitter';

        var FRAME_REQUEST = 'RIVAGE.MICA.FRAME.REQUEST.V1';
        var FRAME_RESPONSE = 'RIVAGE.MICA.FRAME.RESPONSE.V1';
        var FRAME_INVALIDATE = 'RIVAGE.MICA.FRAME.INVALIDATE.V1';
        var FRAME_ROOT = 'RIVAGE.MICA.FRAME.ROOT.V1';
        var FRAME_REQUEST_INTERVAL = 120;
        var FRAME_RETRY_SLOW_MS = 650;
        var FRAME_RETRY_FAST_ATTEMPTS = 8;
        var FRAME_RETRY_MAX_ATTEMPTS = 24;
        var FRAME_RETRY_IDLE_MS = 5000;
        // Diagnostics only: separates "no parent ever answered" from "answers
        // arrived and were rejected", which need completely different fixes.
        var frameResponsesSeen = 0;
        var frameRejectReason = '';
        var FRAME_PARENT_REDISCOVER_MS = 1800;
        var frameInstanceToken = 'rvg-' + new Date().getTime().toString(36) + '-' +
            Math.floor(Math.random() * 0x100000000).toString(36);
        var frameRequestSequence = 0;
        var frameRequestTimer = null;
        var frameRetryAttempts = 0;
        var lastFrameRequestAt = 0;
        var staleSince = 0;
        var seenRootToken = '';
        var seenRootGeneration = 0;
        var rootGeneration = 0;
        var ownFrame = {
            valid: false, root: false, stale: false,
            x: 0, y: 0, width: 0, height: 0,
            rootWidth: 0, rootHeight: 0,
            parentToken: '', rootToken: '', rootGeneration: 0, request: 0
        };
        var trackedChildren = Object.create(null);
        var childScanDepth = 0;
        var childScanSeen = null;

        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[RivageBackdrop] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function clamp(value, minimum, maximum) {
            value = Number(value);
            if (!isFinite(value)) value = minimum;
            return Math.max(minimum, Math.min(maximum, value));
        }

        function integer(value, minimum, maximum, fallback) {
            value = Number(value);
            if (!isFinite(value)) value = fallback;
            return Math.round(clamp(value, minimum, maximum));
        }

        function opaque(colour) {
            colour = Number(colour);
            if (!isFinite(colour)) colour = 0xff202020;
            return ((colour & 0x00ffffff) | 0xff000000) >>> 0;
        }

        function withAlpha(colour, alpha) {
            return (((integer(alpha, 0, 255, 255) & 0xff) << 24) |
                (opaque(colour) & 0x00ffffff)) >>> 0;
        }

        function multiply32(a, b) {
            if (typeof Math.imul === 'function') return Math.imul(a, b);
            var ah = (a >>> 16) & 0xffff;
            var al = a & 0xffff;
            var bh = (b >>> 16) & 0xffff;
            var bl = b & 0xffff;
            return (al * bl + (((ah * bl + al * bh) & 0xffff) << 16)) | 0;
        }

        function hashText(text) {
            var hash = 2166136261 >>> 0;
            text = String(text == null ? '' : text);
            for (var i = 0; i < text.length; i++) {
                hash ^= text.charCodeAt(i);
                hash = multiply32(hash, 16777619) >>> 0;
            }
            return ('00000000' + hash.toString(16)).slice(-8);
        }

        // A Columns UI child pulls its background through paint_background_using_parent,
        // which sees DrawImage but not FillSolidRect - so the palette modes deliver
        // their flat colour as an image too. GDI only (no gdi bitmap into D2D).
        var solidSurfaceImage = null;
        var solidSurfaceColour = 0;
        var solidSurfaceWidth = 0;
        var solidSurfaceHeight = 0;
        // Above this the bitmap is not worth the memory; the plain fill already
        // painted the area, only the CUI child loses its colour.
        var SOLID_SURFACE_MAX_PIXELS = 8388608;

        // Built at the exact destination size and blitted 1:1: stretching a tiny source
        // misbehaved here (an 8x8 bled transparent edge pixels in, a 1x1 with
        // NearestNeighbor under-covered), and at 1:1 no interpolation mode applies.
        function paintSolidSurface(gr, x, y, width, height, colour) {
            if (currentDrawMode() !== 0) return false;
            width = Math.ceil(Number(width) || 0);
            height = Math.ceil(Number(height) || 0);
            if (width <= 0 || height <= 0 || width * height > SOLID_SURFACE_MAX_PIXELS) return false;

            var graphics = null;
            try {
                if (!solidSurfaceImage || solidSurfaceColour !== colour ||
                    solidSurfaceWidth !== width || solidSurfaceHeight !== height) {
                    releaseSolidSurface();
                    var image = gdi.CreateImage(width, height);
                    if (!image) return false;
                    graphics = image.GetGraphics();
                    if (!graphics) { disposeBitmap(image); return false; }
                    graphics.FillSolidRect(0, 0, width, height, colour);
                    image.ReleaseGraphics(graphics);
                    graphics = null;
                    solidSurfaceImage = image;
                    solidSurfaceColour = colour;
                    solidSurfaceWidth = width;
                    solidSurfaceHeight = height;
                }
                gr.DrawImage(solidSurfaceImage, x, y, width, height, 0, 0, width, height, 0, 255);
                return true;
            } catch (e) {
                reportFailure('the flat artwork-palette surface could not be painted', e);
                return false;
            }
        }

        // The mapped slice is the expensive part of a Mica paint - 21-40 ms per
        // full-window splitter upscaling the blurred source in GDI+ - so it is cached
        // and blitted 1:1, and kept UNTINTED so the cache is independent of the
        // caller's semantic colour and can be rebuilt at commit time. Direct2D panels
        // cache one too, in a d2d bitmap: their upscale is cheap on the GPU, but the
        // cache is where the acrylic grain is baked, so both renderers match exactly.
        var sliceImage = null;
        var sliceKey = '';
        var sliceWidth = 0;
        var sliceHeight = 0;
        // Last rectangle a settled paint asked for, so the commit-time rebuild knows
        // what to build without waiting for a paint to tell it.
        var sliceRect = null;
        var SLICE_CACHE_MAX_PIXELS = 3145728;

        function releaseSlice() {
            disposeBitmap(sliceImage);
            sliceImage = null;
            sliceKey = '';
            sliceWidth = 0;
            sliceHeight = 0;
        }

        function sliceCacheKey(drawMode, path, frame, x, y, width, height, noiseAlpha) {
            return drawMode + '|' + path + '|' + frame.x + ',' + frame.y + '|' +
                frame.rootWidth + 'x' + frame.rootHeight + '|' +
                x + ',' + y + '|' + width + 'x' + height + '|n' + noiseAlpha;
        }

        // Acrylic grain, baked into the cached slice at 1:1 so it costs nothing per
        // paint. Never into the derivative, which is upscaled and would turn it into
        // blotches. It sits under the tint: mid-grey grain lifts whatever it lands on,
        // and drawn over the darker tinted surface it came out visibly brighter.
        var MAX_NOISE_PERCENT = 20;
        var NOISE_TILE_SIZE = 64;
        // Repeats the same 64 px pattern, so a slice rebuild needs fewer draw calls.
        var D2D_NOISE_TILE_SIZE = 256;
        // Nearest neighbour: at 1:1 it copies pixels exactly, where the default
        // bicubic mode leaves a faint edge on every tile, drawing a grid.
        var NOISE_INTERPOLATION = 5;
        // The Direct2D default, restored afterwards; the D2D panels never set their own.
        var D2D_DEFAULT_INTERPOLATION = 0;
        // The slice is tinted after it is blitted, which would dim the grain by
        // (1 - tint); it is drawn stronger to compensate, capped for very high tints.
        var MAX_NOISE_SLICE_ALPHA = 153;
        // Indexed by draw mode: a GDI bitmap cannot be drawn by Direct2D, or back.
        // A panel's draw mode is fixed by its first script line, so only one is built.
        var noiseTiles = [null, null];
        var noiseTileFailed = [false, false];

        function noisePercent(descriptor) {
            return descriptor ? integer(descriptor.noise, 0, MAX_NOISE_PERCENT, 0) : 0;
        }

        function noiseSliceAlpha(descriptor) {
            var strength = noisePercent(descriptor) / 100;
            var untinted = 1 - integer(descriptor && descriptor.tintAlpha, 0, 255, DEFAULT_TINT_ALPHA) / 255;
            if (strength <= 0 || untinted <= 0) return 0;
            return integer(255 * strength / untinted, 0, MAX_NOISE_SLICE_ALPHA, 0);
        }

        function createBitmap(drawMode, width, height) {
            if (drawMode === 1) {
                if (typeof d2d === 'undefined' || !d2d || typeof d2d.CreateImage !== 'function') {
                    throw new Error('Direct2D bitmaps are unavailable');
                }
                return d2d.CreateImage(width, height);
            }
            return gdi.CreateImage(width, height);
        }

        // Same seed in every panel and renderer, and tiles are anchored to root
        // coordinates, so the grain runs continuously across panel boundaries.
        function fillNoise(graphics) {
            var state = 0x2f6b9d31;
            var random = function () {
                // mulberry32
                state = (state + 0x6d2b79f5) | 0;
                var t = multiply32(state ^ (state >>> 15), 1 | state);
                t = (t + multiply32(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
            for (var py = 0; py < NOISE_TILE_SIZE; py++) {
                for (var px = 0; px < NOISE_TILE_SIZE; px++) {
                    // Mean of three uniforms: grey grain around mid-tone, few extremes.
                    var grey = Math.round(255 * (random() + random() + random()) / 3);
                    graphics.FillSolidRect(px, py, 1, 1,
                        (0xff000000 | (grey << 16) | (grey << 8) | grey) >>> 0);
                }
            }
        }

        // Repeats `tile` over [x, y, width, height], phased so tile origins fall on
        // multiples of its size in root coordinates.
        function tileNoise(graphics, tile, x, y, width, height, rootX, rootY, alpha) {
            var size = tile.Width;
            var startX = x - (((rootX % size) + size) % size);
            var startY = y - (((rootY % size) + size) % size);
            for (var ty = startY; ty < y + height; ty += size) {
                for (var tx = startX; tx < x + width; tx += size) {
                    graphics.DrawImage(tile, tx, ty, size, size, 0, 0, size, size, 0, alpha);
                }
            }
        }

        function ensureNoiseTile(drawMode) {
            if (noiseTiles[drawMode] || noiseTileFailed[drawMode]) return noiseTiles[drawMode];
            var base = null;
            var tile = null;
            var owner = null;
            var graphics = null;
            try {
                base = createBitmap(drawMode, NOISE_TILE_SIZE, NOISE_TILE_SIZE);
                owner = base;
                graphics = base.GetGraphics();
                fillNoise(graphics);
                base.ReleaseGraphics(graphics);
                graphics = null;

                if (drawMode === 1) {
                    tile = createBitmap(1, D2D_NOISE_TILE_SIZE, D2D_NOISE_TILE_SIZE);
                    owner = tile;
                    graphics = tile.GetGraphics();
                    if (typeof graphics.SetInterpolationMode === 'function') {
                        graphics.SetInterpolationMode(NOISE_INTERPOLATION);
                    }
                    tileNoise(graphics, base, 0, 0, D2D_NOISE_TILE_SIZE, D2D_NOISE_TILE_SIZE, 0, 0, 255);
                    tile.ReleaseGraphics(graphics);
                    graphics = null;
                    disposeBitmap(base);
                } else {
                    tile = base;
                }
                base = null;
                noiseTiles[drawMode] = tile;
            } catch (e) {
                if (owner && graphics) { try { owner.ReleaseGraphics(graphics); } catch (e2) { } }
                if (tile && tile !== base) disposeBitmap(tile);
                disposeBitmap(base);
                noiseTileFailed[drawMode] = true;
                reportFailure('the acrylic noise tile could not be generated', e);
            }
            return noiseTiles[drawMode];
        }

        function paintNoise(graphics, drawMode, x, y, width, height, rootX, rootY, alpha) {
            if (alpha <= 0) return;
            var tile = ensureNoiseTile(drawMode);
            if (!tile) return;
            var canSetInterpolation = typeof graphics.SetInterpolationMode === 'function';
            try {
                if (canSetInterpolation) graphics.SetInterpolationMode(NOISE_INTERPOLATION);
                tileNoise(graphics, tile, x, y, width, height, rootX, rootY, alpha);
            } catch (e) {
                reportFailure('the acrylic noise could not be painted', e);
            } finally {
                if (canSetInterpolation) {
                    try {
                        graphics.SetInterpolationMode(drawMode === 1
                            ? D2D_DEFAULT_INTERPOLATION : POST_MICA_INTERPOLATION);
                    } catch (e2) { }
                }
            }
        }

        function ensureSlice(image, path, frame, x, y, width, height, descriptor) {
            if (!image || !frame || !path) return null;
            var drawMode = currentDrawMode();
            width = Math.ceil(Number(width) || 0);
            height = Math.ceil(Number(height) || 0);
            if (width <= 0 || height <= 0 || width * height > SLICE_CACHE_MAX_PIXELS) return null;

            var noiseAlpha = noiseSliceAlpha(descriptor);
            var key = sliceCacheKey(drawMode, path, frame, x, y, width, height, noiseAlpha);
            if (sliceImage && sliceKey === key) return sliceImage;

            var surface = null;
            var graphics = null;
            var drawn = false;
            try {
                surface = createBitmap(drawMode, width, height);
                if (!surface) return null;
                graphics = surface.GetGraphics();
                if (!graphics) { disposeBitmap(surface); return null; }
                drawn = drawCover(graphics, image, 0, 0, width, height, {
                    canvasX: -frame.x - x,
                    canvasY: -frame.y - y,
                    canvasWidth: frame.rootWidth,
                    canvasHeight: frame.rootHeight,
                    alpha: 255
                });
                if (drawn && noiseAlpha > 0) {
                    paintNoise(graphics, drawMode, 0, 0, width, height, frame.x + x, frame.y + y, noiseAlpha);
                }
                surface.ReleaseGraphics(graphics);
                graphics = null;
            } catch (e) {
                if (surface && graphics) { try { surface.ReleaseGraphics(graphics); } catch (e2) { } }
                disposeBitmap(surface);
                reportFailure('the mapped Mica slice could not be cached', e);
                return null;
            }
            if (!drawn) { disposeBitmap(surface); return null; }

            releaseSlice();
            sliceImage = surface;
            sliceKey = key;
            sliceWidth = width;
            sliceHeight = height;
            return sliceImage;
        }

        // Rebuild inside the COMMIT turn, before any panel repaints, so every upscale
        // happens in one dispatch instead of sweeping the layout panel by panel.
        function rebuildSliceAfterCommit(descriptor) {
            if (!sliceRect || !safeOwnVisible()) return false;
            if (!descriptor || !descriptor.enabled || !descriptor.path) return false;

            var frame = frameForPaint();
            if (!frame || frame.rootWidth <= 0 || frame.rootHeight <= 0) return false;

            var drawMode = currentDrawMode();
            var image = null;
            if (stagedImage && stagedPath === descriptor.path && stagedDrawMode === drawMode) {
                image = stagedImage;
            } else if (loadedImage && loadedPath === descriptor.path && loadedDrawMode === drawMode) {
                image = loadedImage;
            }
            if (!image) return false;

            return !!ensureSlice(image, descriptor.path, frame,
                sliceRect.x, sliceRect.y, sliceRect.width, sliceRect.height, descriptor);
        }

        function releaseSolidSurface() {
            disposeBitmap(solidSurfaceImage);
            solidSurfaceImage = null;
            solidSurfaceColour = 0;
            solidSurfaceWidth = 0;
            solidSurfaceHeight = 0;
        }

        function disposeBitmap(bitmap) {
            if (!bitmap || typeof bitmap.Dispose !== 'function') return;
            try { bitmap.Dispose(); } catch (e) { }
        }

        function cloneDescriptor(descriptor) {
            if (!descriptor || typeof descriptor !== 'object') return null;
            try { return JSON.parse(JSON.stringify(descriptor)); }
            catch (e) { return null; }
        }

        function isOwnedCachePath(path) {
            path = String(path || '');
            if (!path) return false;
            var prefix = String(CACHE_DIRECTORY).toLowerCase();
            var lower = path.toLowerCase();
            if (lower.indexOf(prefix) !== 0) return false;
            var fileName = path.slice(CACHE_DIRECTORY.length);
            // Producer files live directly in cache\mica; accepting only this
            // generated basename also prevents a spoofed theme notification from
            // making consumers open arbitrary local image paths or .. traversal.
            return /^rvg_mica_current_[a-z0-9]+_[0-9a-f]{8}_[0-9]+\.jpg$/i.test(fileName);
        }

        function disabledDescriptor(key, tintAlpha) {
            return {
                version: 1,
                enabled: false,
                key: String(key == null ? '' : key),
                path: '',
                blurRadius: DEFAULT_BLUR_RADIUS,
                tintAlpha: integer(tintAlpha, 0, 255, DEFAULT_TINT_ALPHA),
                noise: 0
            };
        }

        function normaliseDescriptor(descriptor) {
            if (!descriptor || typeof descriptor !== 'object' || descriptor.version !== 1) return null;
            if (typeof descriptor.enabled !== 'boolean' || typeof descriptor.key !== 'string' ||
                typeof descriptor.path !== 'string') return null;

            var copy = {
                version: 1,
                enabled: descriptor.enabled,
                key: descriptor.key,
                path: descriptor.path,
                blurRadius: integer(descriptor.blurRadius, 2, 254, DEFAULT_BLUR_RADIUS),
                tintAlpha: integer(descriptor.tintAlpha, 0, 255, DEFAULT_TINT_ALPHA),
                noise: integer(descriptor.noise, 0, MAX_NOISE_PERCENT, 0)
            };
            if (copy.enabled && (!copy.path || !isOwnedCachePath(copy.path))) return null;
            if (!copy.enabled) copy.path = '';
            return copy;
        }

        function prepareProducerCache() {
            if (producerPrepared) return true;
            producerPrepared = true;

            try {
                // The files are runtime derivatives, never user data. A best-effort
                // cleanup keeps script reloads and blur-setting experiments bounded.
                if (typeof utils.RemovePath === 'function') utils.RemovePath(CACHE_DIRECTORY);
            } catch (e) { }

            try {
                utils.CreateFolder(CACHE_DIRECTORY);
                // A hot-reloaded producer can leave files an older consumer still holds
                // open, so the removal above legitimately fails; retire those after the
                // new descriptor has been broadcast.
                if (typeof utils.Glob === 'function') {
                    var staleFiles = utils.Glob(CACHE_DIRECTORY + '*.jpg') || [];
                    for (var i = 0; i < staleFiles.length; i++) queueProducerCleanup(staleFiles[i]);
                }
                return true;
            } catch (e2) {
                reportFailure('the Mica cache directory could not be created', e2);
                return false;
            }
        }

        function imageExists(path) {
            if (!path) return false;
            try { return !!utils.FileExists(path); }
            catch (e) { return false; }
        }

        function clearProducerCleanupTimer() {
            if (producerCleanupTimer === null) return;
            try { window.ClearTimeout(producerCleanupTimer); } catch (e) { }
            producerCleanupTimer = null;
        }

        function queueProducerCleanup(path) {
            path = String(path || '');
            if (!path) return false;
            if (producerCurrentDescriptor && path === producerCurrentDescriptor.path) return false;

            for (var i = 0; i < obsoleteProducerPaths.length; i++) {
                if (obsoleteProducerPaths[i].path === path) return true;
            }
            obsoleteProducerPaths.push({ path: path, attempts: 0 });
            scheduleProducerCleanup(CURRENT_FILE_CLEANUP_DELAY);
            return true;
        }

        function runProducerCleanup() {
            producerCleanupTimer = null;
            var keep = [];
            for (var i = 0; i < obsoleteProducerPaths.length; i++) {
                var item = obsoleteProducerPaths[i];
                if (!item || !item.path) continue;
                if (producerCurrentDescriptor && item.path === producerCurrentDescriptor.path) continue;

                try { utils.RemovePath(item.path); } catch (e) { }
                if (imageExists(item.path)) {
                    item.attempts += 1;
                    if (item.attempts < CURRENT_FILE_CLEANUP_MAX_ATTEMPTS) keep.push(item);
                    else reportFailure('an obsolete Mica current-image file could not be removed', item.path);
                }
            }
            obsoleteProducerPaths = keep;
            if (obsoleteProducerPaths.length) scheduleProducerCleanup(CURRENT_FILE_CLEANUP_RETRY_DELAY);
        }

        function scheduleProducerCleanup(delay) {
            if (producerCleanupTimer !== null || !obsoleteProducerPaths.length) return;
            try {
                producerCleanupTimer = window.SetTimeout(runProducerCleanup, Math.max(0, Number(delay) || 0));
            } catch (e) {
                producerCleanupTimer = null;
            }
        }

        function releaseProducerCache() {
            var previousPath = producerCurrentDescriptor && producerCurrentDescriptor.path;
            producerCurrentMemoKey = '';
            producerCurrentDescriptor = null;
            if (previousPath) queueProducerCleanup(previousPath);
            return true;
        }

        function disposeProducerCache() {
            clearProducerCleanupTimer();
            producerCurrentMemoKey = '';
            producerCurrentDescriptor = null;
            obsoleteProducerPaths = [];
            try { utils.RemovePath(CACHE_DIRECTORY); } catch (e) { }
            producerPrepared = false;
        }

        // Producer side is split so the render can run elsewhere (artwork Worker):
        // planDescriptor() either answers at once ({ descriptor }) or reserves a
        // fresh path ({ job }); completeDescriptor() or discardDescriptorJob() closes it.
        function planDescriptor(key, options) {
            options = options || {};
            var blurRadius = integer(options.blurRadius, 2, 254, DEFAULT_BLUR_RADIUS);
            var tintAlpha = integer(options.tintAlpha, 0, 255, DEFAULT_TINT_ALPHA);
            var maxEdge = integer(options.maxEdge, 160, 1280, DEFAULT_MAX_EDGE);
            var descriptorKey = String(key == null ? '' : key);

            if (!prepareProducerCache()) {
                return { descriptor: disabledDescriptor(descriptorKey, tintAlpha) };
            }

            var memoKey = descriptorKey + '|' + blurRadius + '|' + maxEdge;
            if (producerCurrentDescriptor && producerCurrentMemoKey === memoKey &&
                imageExists(producerCurrentDescriptor.path)) {
                producerCurrentDescriptor.tintAlpha = tintAlpha;
                return { descriptor: cloneDescriptor(producerCurrentDescriptor) };
            }

            producerSequence += 1;
            var fileName = 'rvg_mica_current_' + producerSession + '_' +
                hashText(memoKey) + '_' + producerSequence + '.jpg';
            return {
                job: {
                    key: descriptorKey,
                    memoKey: memoKey,
                    path: CACHE_DIRECTORY + fileName,
                    blurRadius: blurRadius,
                    tintAlpha: tintAlpha,
                    maxEdge: maxEdge
                }
            };
        }

        // result: { hasImage, generated }. No artwork retires the current file,
        // exactly as a disabled theme does.
        function completeDescriptor(job, result) {
            result = result || {};
            if (!result.hasImage) {
                releaseProducerCache();
                queueProducerCleanup(job.path);
                return disabledDescriptor(job.key, job.tintAlpha);
            }
            if (!result.generated) {
                queueProducerCleanup(job.path);
                return disabledDescriptor(job.key, job.tintAlpha);
            }

            var previousPath = producerCurrentDescriptor && producerCurrentDescriptor.path;
            var descriptor = {
                version: 1,
                enabled: true,
                key: job.key,
                path: job.path,
                blurRadius: job.blurRadius,
                tintAlpha: job.tintAlpha
            };
            producerCurrentMemoKey = job.memoKey;
            producerCurrentDescriptor = descriptor;
            if (previousPath && previousPath !== job.path) queueProducerCleanup(previousPath);
            return cloneDescriptor(descriptor);
        }

        // A superseded job's file may already be written; retire it like any other.
        function discardDescriptorJob(job) {
            if (job && job.path) queueProducerCleanup(job.path);
        }

        // Synchronous producer path; needs shared/mica_derivative.js.
        function buildDescriptor(image, key, options) {
            options = options || {};
            if (!image || !image.Width || !image.Height) {
                releaseProducerCache();
                return disabledDescriptor(String(key == null ? '' : key),
                    integer(options.tintAlpha, 0, 255, DEFAULT_TINT_ALPHA));
            }

            var plan = planDescriptor(key, options);
            if (plan.descriptor) return plan.descriptor;

            var generated = false;
            try {
                generated = RivageMicaDerivative.render(image, plan.job.path,
                    plan.job.blurRadius, plan.job.maxEdge);
            } catch (e) {
                reportFailure('the blurred current artwork file could not be generated', e);
            }
            return completeDescriptor(plan.job, { hasImage: true, generated: generated });
        }

        function sharedTheme() {
            var shared = null;
            try {
                if (typeof RivageUI !== 'undefined' && RivageUI &&
                    typeof RivageUI.getSharedTheme === 'function') {
                    shared = RivageUI.getSharedTheme();
                }
            } catch (e) { shared = null; }
            return shared;
        }

        function sharedMode() {
            var shared = sharedTheme();
            return shared ? String(shared.mode || '').toLowerCase() : '';
        }

        function isMicaMode() {
            return sharedMode() === 'mica';
        }

        function isArtworkPaletteMode() {
            var mode = sharedMode();
            return mode === 'album-auto' || mode === 'album-dark' || mode === 'album-light';
        }

        // Splitter/host backgrounds under pseudo-transparent native components
        // must paint the same shared surface. Mica supplies the mapped artwork;
        // artwork-palette themes supply the selected Material background colour.
        function isSharedArtworkSurfaceMode() {
            return isMicaMode() || isArtworkPaletteMode();
        }

        // setSharedTheme() replaces the payload object on every change, so its
        // identity is an exact cache key. Every panel calls this once per paint,
        // animation-rate repaints included; normalising there allocated each time.
        var descriptorMemoSource;
        var descriptorMemoValue = null;

        function sharedDescriptor() {
            var shared = sharedTheme();
            if (!shared || String(shared.mode || '').toLowerCase() !== 'mica') return null;
            if (shared.backdrop !== descriptorMemoSource) {
                descriptorMemoSource = shared.backdrop;
                descriptorMemoValue = normaliseDescriptor(shared.backdrop);
            }
            return descriptorMemoValue;
        }

        // Frame mapping: a child cannot see the root's pixels, so it asks its immediate
        // JSplitter parent for its rectangle and gets back that parent's resolved
        // absolute origin plus the root canvas size. Parent tokens are sticky, so a
        // duplicate panel name elsewhere cannot steal a panel after the first match.

        function trimLower(value) {
            return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '').toLowerCase();
        }

        function compactIdentity(value) {
            return trimLower(value)
                .replace(/\brvg\b/g, '')
                .replace(/\b(panel|splitter)\b/g, '')
                .replace(/[^a-z0-9]+/g, '');
        }

        // window.Name (the ShowConfigureV2 name) and the PanelObject.Name/.Text the
        // parent sees (component and caption) are different namespaces, so exact
        // matching fails for most panels. Relate them when one contains the other.
        function identityRelated(a, b) {
            if (!a || !b) return false;
            if (a === b) return true;
            if (a.length < 4 || b.length < 4) return false;
            return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
        }

        function requestIdentities(request) {
            return [compactIdentity(request && request.script),
                compactIdentity(request && request.name)];
        }

        function childIdentities(child) {
            return [compactIdentity(child && child.name), compactIdentity(child && child.text)];
        }

        function identityScore(request, child) {
            var wanted = requestIdentities(request);
            var have = childIdentities(child);
            var best = 0;
            for (var i = 0; i < wanted.length; i++) {
                for (var j = 0; j < have.length; j++) {
                    if (!wanted[i] || !have[j]) continue;
                    if (wanted[i] === have[j]) best = Math.max(best, 2);
                    else if (identityRelated(wanted[i], have[j])) best = Math.max(best, 1);
                }
            }
            return best;
        }

        function safeOwnName() {
            try { return String(window.Name || ''); } catch (e) { return ''; }
        }

        function safeOwnScriptName() {
            try {
                return window.ScriptInfo && window.ScriptInfo.Name
                    ? String(window.ScriptInfo.Name) : '';
            } catch (e) { return ''; }
        }

        function safeOwnSize() {
            var width = 0;
            var height = 0;
            try { width = Math.max(0, Math.round(Number(window.Width) || 0)); } catch (e) { }
            try { height = Math.max(0, Math.round(Number(window.Height) || 0)); } catch (e2) { }
            return { width: width, height: height };
        }

        function safeOwnVisible() {
            try {
                var value = window.IsVisible;
                if (typeof value === 'function') value = value.call(window);
                return value === undefined || value === null ? true : !!value;
            } catch (e) { return true; }
        }

        function frameNow() {
            try { return Date.now(); } catch (e) { return new Date().getTime(); }
        }

        function parseFrameInfo(info) {
            var value = info;
            try {
                if (typeof value === 'string') value = JSON.parse(value);
            } catch (e) { return null; }
            return value && typeof value === 'object' ? value : null;
        }

        function notifyFrame(name, payload) {
            try {
                if (!window || typeof window.NotifyOthers !== 'function') return false;
                window.NotifyOthers(name, JSON.stringify(payload));
                return true;
            } catch (e) {
                reportFailure('a Mica frame message could not be broadcast', e);
                return false;
            }
        }

        function deferFrameNotify(name, payload) {
            var run = function () { notifyFrame(name, payload); };
            try {
                if (window && typeof window.SetTimeout === 'function') {
                    window.SetTimeout(run, 0);
                    return true;
                }
            } catch (e) { }
            return run();
        }

        function repaintForFrame() {
            try { window.Repaint(); } catch (e) { }
        }

        function closeSize(a, b) {
            return Math.abs(Number(a) - Number(b)) <= 3;
        }

        function childSnapshot(panel) {
            if (!panel) return null;
            var snapshot = {
                name: '', text: '', x: 0, y: 0,
                width: 0, height: 0, hidden: false, pseudo: false
            };
            try { snapshot.name = String(panel.Name || ''); } catch (e) { }
            try { snapshot.text = String(panel.Text || ''); } catch (e2) { }
            try { snapshot.x = Math.round(Number(panel.X) || 0); } catch (e3) { }
            try { snapshot.y = Math.round(Number(panel.Y) || 0); } catch (e4) { }
            try { snapshot.width = Math.max(0, Math.round(Number(panel.Width) || 0)); } catch (e5) { }
            try { snapshot.height = Math.max(0, Math.round(Number(panel.Height) || 0)); } catch (e6) { }
            try { snapshot.hidden = !!panel.Hidden; } catch (e7) { }
            try { snapshot.pseudo = panel.SupportPseudoTransparency === true; } catch (e8) { }
            if (!snapshot.name && !snapshot.text) return null;
            snapshot.key = trimLower(snapshot.name) + '\u001f' + trimLower(snapshot.text);
            return snapshot;
        }

        function childChanged(previous, next) {
            return !previous || previous.x !== next.x || previous.y !== next.y ||
                previous.width !== next.width || previous.height !== next.height ||
                previous.hidden !== next.hidden || previous.name !== next.name ||
                previous.text !== next.text || previous.pseudo !== next.pseudo;
        }

        function ownIdentityMatches(name, text) {
            var own = trimLower(safeOwnName());
            if (own && (own === trimLower(name) || own === trimLower(text))) return true;
            return identityScore({ script: safeOwnScriptName(), name: safeOwnName() },
                { name: name, text: text }) > 0;
        }

        function invalidateChildren(target) {
            if (!ownFrame.valid || !isMicaMode()) return false;
            target = target || null;

            function notifyTarget(child) {
                return deferFrameNotify(FRAME_INVALIDATE, {
                    version: 1,
                    parentToken: frameInstanceToken,
                    targetName: String(child && child.name || ''),
                    targetText: String(child && child.text || '')
                });
            }

            if (target && (target.name || target.text)) return notifyTarget(target);

            // A parent can resolve after its children already asked, so wake each direct
            // child by identity. Never a generic invalidate: notifications are global and
            // an untargeted one would storm every Mica panel in the skin.
            var sent = false;
            for (var key in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, key)) continue;
                var child = trackedChildren[key];
                if (!child || (!child.name && !child.text)) continue;
                if (notifyTarget(child)) sent = true;
            }
            return sent;
        }

        // Hosts whose child set can change at runtime wrap a full enumeration with
        // beginChildScan/endChildScan so a removed panel stops answering frame
        // requests with the rectangle it last occupied.
        function beginChildScan() {
            childScanDepth += 1;
            if (childScanDepth === 1) childScanSeen = Object.create(null);
            return true;
        }

        function endChildScan(complete) {
            if (childScanDepth <= 0) return false;
            childScanDepth -= 1;
            if (childScanDepth > 0) return true;

            var seen = childScanSeen;
            childScanSeen = null;
            // A pass that failed part-way saw only some children; keep every snapshot.
            if (!seen || complete === false) return false;

            var dropped = false;
            for (var key in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, key)) continue;
                if (seen[key]) continue;
                delete trackedChildren[key];
                dropped = true;
            }
            // Descendants mapped through a panel that is gone must find a live parent.
            if (dropped) invalidateChildren();
            return dropped;
        }

        function captureChildPanel(panel, suppressInvalidate) {
            var next = childSnapshot(panel);
            if (!next) return false;
            if (childScanSeen) childScanSeen[next.key] = true;
            var previous = trackedChildren[next.key];
            trackedChildren[next.key] = next;
            if (!suppressInvalidate && childChanged(previous, next)) invalidateChildren(next);
            return true;
        }

        // Called by every managed splitter/host while it owns a fresh PanelObject
        // wrapper. PanelObject wrappers are callback-local, so only primitive
        // geometry is retained here; the native wrapper itself is never cached.
        function configureChildPanel(panel) {
            if (!panel) return false;
            // Geometry only. The mapped renderer deliberately never reads or writes
            // SupportPseudoTransparency, so any transparency configured by the skin
            // for unrelated reasons remains exactly as the user/layout defined it.
            return captureChildPanel(panel, true);
        }

        // Hosts call this after Move(). It updates the direct-child snapshot and
        // invalidates only that child branch if its rectangle actually changed.
        function noteChildPanel(panel) {
            return captureChildPanel(panel, false);
        }

        function childMatchesRequest(child, request) {
            if (!child || child.width <= 0 || child.height <= 0) return false;
            if (!closeSize(child.width, request.width) || !closeSize(child.height, request.height)) return false;
            if (request.visible && child.hidden) return false;

            var requestName = trimLower(request.name);
            if (requestName && (requestName === trimLower(child.name) ||
                requestName === trimLower(child.text))) return true;

            // Only ever consulted after an exact size match inside this parent.
            return identityScore(request, child) > 0;
        }

        function findRequestedChild(request) {
            var best = null;
            var bestScore = -1;
            for (var key in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, key)) continue;
                var child = trackedChildren[key];
                if (!childMatchesRequest(child, request)) continue;

                var score = identityScore(request, child) * 12;
                var requestName = trimLower(request.name);
                if (requestName && requestName === trimLower(child.name)) score += 8;
                if (requestName && requestName === trimLower(child.text)) score += 6;
                if (Number(request.width) === child.width) score += 2;
                if (Number(request.height) === child.height) score += 2;
                if (!child.hidden) score += 1;
                if (score > bestScore) {
                    best = child;
                    bestScore = score;
                }
            }
            if (best) return best;

            // An imported FCL may give a panel a window.Name unrelated to its caption, so
            // a unique size among VISIBLE direct children is the final discriminator.
            // Never for a hidden requester - a tab host keeps many same-sized hidden ones.
            if (!request.visible) return null;
            var geometryMatch = null;
            var geometryMatches = 0;
            for (var geometryKey in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, geometryKey)) continue;
                var candidate = trackedChildren[geometryKey];
                if (!candidate || candidate.hidden || candidate.width <= 0 || candidate.height <= 0) continue;
                if (!closeSize(candidate.width, request.width) || !closeSize(candidate.height, request.height)) continue;
                geometryMatch = candidate;
                geometryMatches += 1;
                if (geometryMatches > 1) return null;
            }
            return geometryMatches === 1 ? geometryMatch : null;
        }

        // Without a pseudo-transparent child a host owes nothing but the gaps its own
        // children do not cover. Hidden ones count: Show(true) does not repaint the host.
        function hasPseudoTransparentChild() {
            for (var key in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, key)) continue;
                if (trackedChildren[key] && trackedChildren[key].pseudo) return true;
            }
            return false;
        }

        // JSplitter sets SupportPseudoTransparency on every panel, so the flag alone
        // discriminates nothing. What needs a host-rendered background is a child running
        // a FOREIGN component; an RVG script child opens its paint with an opaque fill.
        function hasForeignPseudoChild() {
            for (var key in trackedChildren) {
                if (!Object.prototype.hasOwnProperty.call(trackedChildren, key)) continue;
                var child = trackedChildren[key];
                if (child && child.pseudo && child.name && child.name !== JSPLITTER_COMPONENT) return true;
            }
            return false;
        }

        function clearFrameRequestTimer() {
            if (frameRequestTimer === null) return;
            try {
                if (window && typeof window.ClearTimeout === 'function') {
                    window.ClearTimeout(frameRequestTimer);
                }
            } catch (e) { }
            frameRequestTimer = null;
        }

        function queueFrameRetry() {
            if (!isMicaMode() || ownFrame.root || !safeOwnVisible() ||
                (ownFrame.valid && !ownFrame.stale)) return false;
            if (frameRequestTimer !== null) return true;

            frameRetryAttempts += 1;
            // Past the bounded burst, keep a slow idle lane rather than giving up
            // for good: a parent can become answerable long afterwards (a sibling
            // is hidden, a layout changes) and nothing else would ever wake us.
            var delay = frameRetryAttempts <= FRAME_RETRY_FAST_ATTEMPTS
                ? FRAME_REQUEST_INTERVAL
                : (frameRetryAttempts <= FRAME_RETRY_MAX_ATTEMPTS
                    ? FRAME_RETRY_SLOW_MS
                    : FRAME_RETRY_IDLE_MS);
            try {
                if (window && typeof window.SetTimeout === 'function') {
                    frameRequestTimer = window.SetTimeout(sendFrameRequest, delay);
                    return true;
                }
            } catch (e) { }
            return false;
        }

        function sendFrameRequest() {
            frameRequestTimer = null;
            if (!isMicaMode() || ownFrame.root || !safeOwnVisible()) return false;
            var size = safeOwnSize();
            if (size.width <= 0 || size.height <= 0) return false;

            frameRequestSequence += 1;
            lastFrameRequestAt = frameNow();
            var expectedParent = ownFrame.parentToken;
            if (ownFrame.stale && staleSince && lastFrameRequestAt - staleSince > FRAME_PARENT_REDISCOVER_MS) {
                expectedParent = '';
            }
            var sent = notifyFrame(FRAME_REQUEST, {
                version: 1,
                token: frameInstanceToken,
                request: frameRequestSequence,
                expectedParent: String(expectedParent || ''),
                expectedRootToken: String(seenRootToken || ''),
                expectedRootGeneration: Math.max(0, Math.round(Number(seenRootGeneration) || 0)),
                name: safeOwnName(),
                script: safeOwnScriptName(),
                width: size.width,
                height: size.height,
                visible: safeOwnVisible()
            });

            // Discovery is hierarchical: a deep child can ask before its own splitter has
            // resolved. Retry at a bounded rate, notification-only so nothing flickers.
            queueFrameRetry();
            return sent;
        }

        function scheduleFrameRequest(force) {
            if (!isMicaMode() || ownFrame.root || !safeOwnVisible()) return false;
            var now = frameNow();
            var elapsed = now - lastFrameRequestAt;
            var delay = force ? 0 : Math.max(0, FRAME_REQUEST_INTERVAL - elapsed);

            if (force && frameRequestTimer !== null) clearFrameRequestTimer();
            if (frameRequestTimer !== null) return true;

            try {
                if (window && typeof window.SetTimeout === 'function') {
                    frameRequestTimer = window.SetTimeout(sendFrameRequest, delay);
                    return true;
                }
            } catch (e) { }
            return sendFrameRequest();
        }

        function frameStamp(frame) {
            if (!frame || !frame.valid) return '';
            return [frame.x, frame.y, frame.width, frame.height,
                frame.rootWidth, frame.rootHeight, frame.parentToken, frame.rootToken,
                frame.rootGeneration].join('|');
        }

        function updateRootFrame(width, height, forceGeneration) {
            width = Math.max(0, Math.round(Number(width) || 0));
            height = Math.max(0, Math.round(Number(height) || 0));
            if (width <= 0 || height <= 0) return false;

            var geometryChanged = !ownFrame.valid || !ownFrame.root ||
                ownFrame.width !== width || ownFrame.height !== height ||
                ownFrame.rootWidth !== width || ownFrame.rootHeight !== height;
            if (!geometryChanged && !forceGeneration) return true;

            rootGeneration += 1;
            ownFrame.valid = true;
            ownFrame.root = true;
            ownFrame.stale = false;
            ownFrame.x = 0;
            ownFrame.y = 0;
            ownFrame.width = width;
            ownFrame.height = height;
            ownFrame.rootWidth = width;
            ownFrame.rootHeight = height;
            ownFrame.parentToken = '';
            ownFrame.rootToken = frameInstanceToken;
            ownFrame.rootGeneration = rootGeneration;
            seenRootToken = frameInstanceToken;
            seenRootGeneration = rootGeneration;

            // Generation is part of the geometry contract: a Mini Player enter/exit leaves
            // zero-delay responses for the old window size in the queue, and descendants
            // reject anything older than the announced epoch rather than map to it.
            deferFrameNotify(FRAME_ROOT, {
                version: 1,
                rootToken: frameInstanceToken,
                generation: rootGeneration,
                rootWidth: width,
                rootHeight: height
            });
            invalidateChildren();
            return true;
        }

        function setRootFrame(width, height) {
            return updateRootFrame(width, height, false);
        }

        function refreshRootFrame(width, height) {
            return updateRootFrame(width, height, true);
        }

        function rejectFrame(reason) {
            frameRejectReason = reason;
            return false;
        }

        function adoptFrameResponse(info) {
            if (!info || info.version !== 1 || String(info.token || '') !== frameInstanceToken) return false;
            frameResponsesSeen += 1;
            var responseRequest = Number(info.request) || 0;
            if (responseRequest <= 0 || responseRequest > frameRequestSequence) return rejectFrame('request id out of range');
            if (ownFrame.request && responseRequest < ownFrame.request) return rejectFrame('superseded by a newer request');

            var size = safeOwnSize();
            var width = Math.max(0, Math.round(Number(info.width) || 0));
            var height = Math.max(0, Math.round(Number(info.height) || 0));
            var rootWidth = Math.max(0, Math.round(Number(info.rootWidth) || 0));
            var rootHeight = Math.max(0, Math.round(Number(info.rootHeight) || 0));
            var x = Math.round(Number(info.x) || 0);
            var y = Math.round(Number(info.y) || 0);
            var parentToken = String(info.parentToken || '');
            var rootToken = String(info.rootToken || '');
            var responseRootGeneration = Math.max(0, Math.round(Number(info.rootGeneration) || 0));
            if (!parentToken || !rootToken || responseRootGeneration <= 0 ||
                width <= 0 || height <= 0 || rootWidth <= 0 || rootHeight <= 0) return rejectFrame('incomplete payload');

            // FRAME_ROOT is global and sets the newest acceptable epoch.
            if (seenRootToken && rootToken !== seenRootToken) return rejectFrame('answer from a different root');
            if (seenRootGeneration && responseRootGeneration < seenRootGeneration) return rejectFrame('answer from an older root generation');
            if (!closeSize(width, size.width) || !closeSize(height, size.height)) {
                return rejectFrame('size mismatch: answered ' + width + 'x' + height +
                    ', we are ' + size.width + 'x' + size.height);
            }

            // Once attached, only the established immediate parent may update us.
            // If that parent disappeared, the rediscovery timeout above clears the
            // expectation in requests and the next accepted response can rebind it.
            if (ownFrame.parentToken && parentToken !== ownFrame.parentToken &&
                (!ownFrame.stale || !staleSince || frameNow() - staleSince <= FRAME_PARENT_REDISCOVER_MS)) {
                return rejectFrame('answer from a parent we are not attached to');
            }

            var before = frameStamp(ownFrame);
            ownFrame.valid = true;
            ownFrame.root = false;
            ownFrame.stale = false;
            ownFrame.x = x;
            ownFrame.y = y;
            ownFrame.width = width;
            ownFrame.height = height;
            ownFrame.rootWidth = rootWidth;
            ownFrame.rootHeight = rootHeight;
            ownFrame.parentToken = parentToken;
            ownFrame.rootToken = rootToken;
            ownFrame.rootGeneration = responseRootGeneration;
            ownFrame.request = responseRequest;
            seenRootToken = rootToken;
            seenRootGeneration = Math.max(seenRootGeneration, responseRootGeneration);
            staleSince = 0;
            frameRetryAttempts = 0;
            frameRejectReason = '';
            clearFrameRequestTimer();

            if (before !== frameStamp(ownFrame)) {
                invalidateChildren();
                repaintForFrame();
            }
            return true;
        }

        function consumeGeometry(name, rawInfo) {
            if (name !== FRAME_REQUEST && name !== FRAME_RESPONSE &&
                name !== FRAME_INVALIDATE && name !== FRAME_ROOT) return false;
            var info = parseFrameInfo(rawInfo);
            if (!info || info.version !== 1) return true;

            if (name === FRAME_REQUEST) {
                // A stale parent answering would propagate old root dimensions downward.
                if (!ownFrame.valid || ownFrame.stale) return true;
                var expectedParent = String(info.expectedParent || '');
                if (expectedParent && expectedParent !== frameInstanceToken) return true;
                var expectedRootToken = String(info.expectedRootToken || '');
                var expectedRootGeneration = Math.max(0, Math.round(Number(info.expectedRootGeneration) || 0));
                if (expectedRootToken && expectedRootToken !== ownFrame.rootToken) return true;
                if (expectedRootGeneration && expectedRootGeneration !== ownFrame.rootGeneration) return true;
                var child = findRequestedChild(info);
                if (!child) return true;

                deferFrameNotify(FRAME_RESPONSE, {
                    version: 1,
                    token: String(info.token || ''),
                    request: Number(info.request) || 0,
                    parentToken: frameInstanceToken,
                    rootToken: ownFrame.rootToken || seenRootToken || frameInstanceToken,
                    rootGeneration: Math.max(1, Math.round(Number(ownFrame.rootGeneration) || Number(seenRootGeneration) || 1)),
                    x: ownFrame.x + child.x,
                    y: ownFrame.y + child.y,
                    width: child.width,
                    height: child.height,
                    rootWidth: ownFrame.rootWidth,
                    rootHeight: ownFrame.rootHeight
                });
                return true;
            }

            if (name === FRAME_RESPONSE) {
                adoptFrameResponse(info);
                return true;
            }

            if (name === FRAME_INVALIDATE) {
                if (ownFrame.root) return true;
                var invalidateParent = String(info.parentToken || '');
                var targeted = !!(info.targetName || info.targetText);
                if (targeted && !ownIdentityMatches(info.targetName, info.targetText)) return true;

                if (ownFrame.valid) {
                    if (invalidateParent !== ownFrame.parentToken) return true;
                } else {
                    // Before first attachment the parent token is unknown, so accept only
                    // identity-targeted wakeups; the request still matches by name/size.
                    if (!targeted) return true;
                }

                if (!ownFrame.stale) staleSince = frameNow();
                ownFrame.stale = true;
                frameRetryAttempts = 0;
                scheduleFrameRequest(true);
                return true;
            }

            // Root announce: this catches outer-window resizes and root script
            // reloads even when this panel's own size did not change.
            var announcedRoot = String(info.rootToken || '');
            var announcedGeneration = Math.max(0, Math.round(Number(info.generation) || 0));
            if (!announcedRoot || announcedGeneration <= 0 || ownFrame.root) return true;

            var rootChanged = !!seenRootToken && announcedRoot !== seenRootToken;
            if (!rootChanged && seenRootToken === announcedRoot &&
                announcedGeneration <= seenRootGeneration) {
                return true;
            }
            if (rootChanged) ownFrame.parentToken = '';
            seenRootToken = announcedRoot;
            seenRootGeneration = announcedGeneration;
            if (!ownFrame.stale) staleSince = frameNow();
            ownFrame.stale = true;
            frameRetryAttempts = 0;
            // Hidden normal-layout branches stay dormant while Mini Player is on.
            // Their parent Show(true) wake-up or first paint after exit restarts
            // discovery, avoiding ten seconds of pointless hidden retry traffic.
            if (safeOwnVisible()) scheduleFrameRequest(true);
            return true;
        }

        function frameForPaint() {
            if (ownFrame.root) return ownFrame.valid ? ownFrame : null;
            var size = safeOwnSize();
            if (ownFrame.valid && seenRootToken &&
                (ownFrame.rootToken !== seenRootToken ||
                    (seenRootGeneration && ownFrame.rootGeneration < seenRootGeneration))) {
                if (!ownFrame.stale) staleSince = frameNow();
                ownFrame.stale = true;
            }
            if (ownFrame.valid && (!closeSize(size.width, ownFrame.width) || !closeSize(size.height, ownFrame.height))) {
                if (!ownFrame.stale) staleSince = frameNow();
                ownFrame.stale = true;
            }
            if (!ownFrame.valid || ownFrame.stale) scheduleFrameRequest(false);
            return ownFrame.valid ? ownFrame : null;
        }

        function currentDrawMode() {
            try { return Number(window.DrawMode) === 1 ? 1 : 0; }
            catch (e) { return 0; }
        }

        function makeLoadKey(path, drawMode) {
            return String(drawMode === 1 ? 1 : 0) + '|' + String(path || '');
        }

        function parseLoadKey(loadKey) {
            loadKey = String(loadKey || '');
            var separator = loadKey.indexOf('|');
            if (separator < 0) return { drawMode: currentDrawMode(), path: loadKey };
            return {
                drawMode: loadKey.slice(0, separator) === '1' ? 1 : 0,
                path: loadKey.slice(separator + 1)
            };
        }

        function discardLoadedImage() {
            disposeBitmap(loadedImage);
            loadedImage = null;
            loadedPath = '';
            loadedDrawMode = -1;
        }

        function discardPreviousImage() {
            disposeBitmap(previousImage);
            previousImage = null;
            previousPath = '';
            previousDrawMode = -1;
        }

        function discardStagedImage() {
            disposeBitmap(stagedImage);
            stagedImage = null;
            stagedPath = '';
            stagedDrawMode = -1;
        }

        function discardAllImages() {
            discardLoadedImage();
            discardPreviousImage();
            discardStagedImage();
            releaseSlice();
        }

        function retainLoadedAsPrevious(drawMode) {
            if (!loadedImage) return false;
            discardPreviousImage();
            if (loadedDrawMode !== drawMode) {
                discardLoadedImage();
                return false;
            }
            previousImage = loadedImage;
            previousPath = loadedPath;
            previousDrawMode = loadedDrawMode;
            loadedImage = null;
            loadedPath = '';
            loadedDrawMode = -1;
            return true;
        }

        function clearImageRetry() {
            if (imageRetryTimer !== null) {
                try { window.ClearTimeout(imageRetryTimer); } catch (e) { }
            }
            imageRetryTimer = null;
            imageRetryKey = '';
            imageRetryAttempts = 0;
        }

        function scheduleImageRetry(loadKey) {
            loadKey = String(loadKey || '');
            if (!loadKey || requestedLoadKey !== loadKey) return false;
            if (imageRetryTimer !== null && imageRetryKey === loadKey) return true;
            if (imageRetryKey !== loadKey) {
                if (imageRetryTimer !== null) {
                    try { window.ClearTimeout(imageRetryTimer); } catch (e) { }
                    imageRetryTimer = null;
                }
                imageRetryKey = loadKey;
                imageRetryAttempts = 0;
            }
            if (imageRetryAttempts >= IMAGE_HANDOFF_RETRY_MAX_ATTEMPTS) return false;

            imageRetryAttempts += 1;
            try {
                imageRetryTimer = window.SetTimeout(function () {
                    imageRetryTimer = null;
                    if (requestedLoadKey !== loadKey) return;
                    directLoadAttemptedKey = '';
                    if (loadWork) loadWork.request(loadKey);
                    else {
                        try { window.Repaint(); } catch (e2) { }
                    }
                }, IMAGE_HANDOFF_RETRY_DELAY);
                return true;
            } catch (e3) {
                imageRetryTimer = null;
                return false;
            }
        }

        // A missing file returns null without reporting; that is the normal
        // producer-handoff race and scheduleImageRetry() covers it.
        function openImage(path, drawMode) {
            if (!path || !imageExists(path)) return null;
            try {
                if (drawMode === 1) {
                    if (typeof d2d === 'undefined' || !d2d || typeof d2d.Image !== 'function') {
                        throw new Error('Direct2D image loading is unavailable');
                    }
                    return d2d.Image(path);
                }
                return gdi.Image(path);
            } catch (e) {
                reportFailure('a cached Mica image could not be loaded', e);
                return null;
            }
        }

        // Opening the replacement in the PREPARE turn spends the decode while nothing
        // repaints; without it a track change swept the layout panel by panel.
        function prefetchSharedTheme(payload) {
            var descriptor = null;
            var path = '';
            var drawMode;

            try {
                if (!payload || String(payload.mode || '').toLowerCase() !== 'mica') return false;
                descriptor = normaliseDescriptor(payload.backdrop);
            } catch (e) {
                return false;
            }
            if (!descriptor || !descriptor.enabled) return false;

            path = descriptor.path;
            if (!path) return false;
            drawMode = currentDrawMode();
            // Already current, or already staged - a repeated PREPARE for the same
            // path must not re-open anything.
            if (loadedPath === path && loadedDrawMode === drawMode) return false;
            if (stagedImage && stagedPath === path && stagedDrawMode === drawMode) return true;
            // A hidden panel cannot ripple, and pays the decode when it is shown.
            if (!safeOwnVisible()) return false;

            discardStagedImage();
            var next = openImage(path, drawMode);
            if (!next) return false;
            stagedImage = next;
            stagedPath = path;
            stagedDrawMode = drawMode;
            return true;
        }

        function loadRequestedImage(loadKey) {
            var request = parseLoadKey(loadKey);
            var path = request.path;
            var drawMode = request.drawMode;
            var next = null;

            if (!path) {
                clearImageRetry();
                discardAllImages();
                directLoadAttemptedKey = loadKey;
                return;
            }

            if (stagedImage && stagedPath === path && stagedDrawMode === drawMode) {
                next = stagedImage;
                stagedImage = null;
                stagedPath = '';
                stagedDrawMode = -1;
            } else {
                discardStagedImage();
                next = openImage(path, drawMode);
            }

            // Transactional swap: the current bitmap stays drawable until the replacement
            // opens, and paint() disposes it on the first frame that draws the new one.
            if (next) {
                if (loadedImage && (loadedPath !== path || loadedDrawMode !== drawMode)) {
                    retainLoadedAsPrevious(drawMode);
                }
                if (loadedImage && loadedPath === path && loadedDrawMode === drawMode) {
                    disposeBitmap(next);
                } else {
                    loadedImage = next;
                    loadedPath = path;
                    loadedDrawMode = drawMode;
                }
                clearImageRetry();
            } else {
                scheduleImageRetry(loadKey);
            }
            directLoadAttemptedKey = loadKey;
        }

        function ensureLoadWork() {
            if (loadWork || typeof VisiblePaintWork === 'undefined' || !VisiblePaintWork ||
                typeof VisiblePaintWork.create !== 'function') return;
            loadWork = VisiblePaintWork.create(function (loadKey) {
                loadRequestedImage(loadKey);
            });
        }

        function syncImage(path) {
            path = String(path || '');
            var drawMode = currentDrawMode();
            var loadKey = makeLoadKey(path, drawMode);
            ensureLoadWork();

            if (requestedLoadKey !== loadKey) {
                clearImageRetry();
                requestedPath = path;
                requestedLoadKey = loadKey;
                directLoadAttemptedKey = '';
                if (!path) {
                    discardAllImages();
                } else if (loadWork) {
                    loadWork.request(loadKey);
                }
            }

            if (!path) return null;

            if (loadWork) {
                loadWork.runFromPaint();
            } else if (directLoadAttemptedKey !== loadKey) {
                loadRequestedImage(loadKey);
            }

            if (loadedPath === path && loadedDrawMode === drawMode) return loadedImage;

            // Mapping is root-relative, so the previous image stays a coherent full-skin
            // fallback for the handoff frame.
            if (loadedImage && loadedDrawMode === drawMode) return loadedImage;
            if (previousImage && previousDrawMode === drawMode) return previousImage;
            return null;
        }

        function drawCover(gr, image, x, y, width, height, options) {
            if (!image || width <= 0 || height <= 0 || image.Width <= 0 || image.Height <= 0) return false;
            options = options || {};

            // canvas* paints only an exposed sub-rectangle while sampling as though the
            // image covered the whole panel - splitter dividers fill a gap this way.
            var canvasX = options.canvasX === undefined ? x : Number(options.canvasX);
            var canvasY = options.canvasY === undefined ? y : Number(options.canvasY);
            var canvasWidth = options.canvasWidth === undefined ? width : Number(options.canvasWidth);
            var canvasHeight = options.canvasHeight === undefined ? height : Number(options.canvasHeight);
            if (!isFinite(canvasX)) canvasX = x;
            if (!isFinite(canvasY)) canvasY = y;
            if (!(canvasWidth > 0)) canvasWidth = width;
            if (!(canvasHeight > 0)) canvasHeight = height;

            var sourceWidth = image.Width;
            var sourceHeight = image.Height;
            var destinationRatio = canvasWidth / canvasHeight;
            var sourceRatio = sourceWidth / sourceHeight;
            var sx = 0;
            var sy = 0;
            var sw = sourceWidth;
            var sh = sourceHeight;

            if (sourceRatio > destinationRatio) {
                sw = sourceHeight * destinationRatio;
                sx = (sourceWidth - sw) / 2;
            } else if (sourceRatio < destinationRatio) {
                sh = sourceWidth / destinationRatio;
                sy = (sourceHeight - sh) / 2;
            }

            var sourceX = sx + (x - canvasX) * sw / canvasWidth;
            var sourceY = sy + (y - canvasY) * sh / canvasHeight;
            var sourceW = width * sw / canvasWidth;
            var sourceH = height * sh / canvasHeight;
            var alpha = options.alpha === undefined ? 255 : integer(options.alpha, 0, 255, 255);
            if (alpha <= 0) return true;
            if (!(sourceW > 0) || !(sourceH > 0)) return false;

            // A panel mapped partly outside the root canvas would hand DrawImage a source
            // rectangle off the bitmap; trim both together so the visible part stays 1:1.
            var scaleX = width / sourceW;
            var scaleY = height / sourceH;
            var trim;
            if (sourceX < 0) { trim = -sourceX; sourceX = 0; sourceW -= trim; x += trim * scaleX; width -= trim * scaleX; }
            if (sourceY < 0) { trim = -sourceY; sourceY = 0; sourceH -= trim; y += trim * scaleY; height -= trim * scaleY; }
            trim = (sourceX + sourceW) - sourceWidth;
            if (trim > 0) { sourceW -= trim; width -= trim * scaleX; }
            trim = (sourceY + sourceH) - sourceHeight;
            if (trim > 0) { sourceH -= trim; height -= trim * scaleY; }
            if (!(sourceW > 0) || !(sourceH > 0) || !(width > 0) || !(height > 0)) return false;

            var canSetInterpolation = typeof gr.SetInterpolationMode === 'function';
            var edgeSafeGdi = canSetInterpolation && currentDrawMode() === 0;
            try {
                // See GDI_MICA_INTERPOLATION: Bilinear for the mapped draw, 7 restored
                // after it so later album-art thumbnails keep their quality.
                if (edgeSafeGdi) gr.SetInterpolationMode(GDI_MICA_INTERPOLATION);
                gr.DrawImage(image, x, y, width, height, sourceX, sourceY, sourceW, sourceH, 0, alpha);
                return true;
            } catch (e) {
                reportFailure('the cached Mica image could not be painted', e);
                return false;
            } finally {
                if (edgeSafeGdi) {
                    try { gr.SetInterpolationMode(POST_MICA_INTERPOLATION); } catch (e2) { }
                }
            }
        }

        function paint(gr, x, y, width, height, fallbackColour, options) {
            options = options || {};
            x = Number(x) || 0;
            y = Number(y) || 0;
            width = Math.max(0, Number(width) || 0);
            height = Math.max(0, Number(height) || 0);
            fallbackColour = opaque(fallbackColour);

            // Every panel owns an opaque fallback so native window erases can never
            // flash through, and it is the colour beneath the artwork.
            if (options.fillFallback !== false && width > 0 && height > 0) {
                gr.FillSolidRect(x, y, width, height, fallbackColour);
            }
            if (width <= 0 || height <= 0) return false;

            if (!isMicaMode()) {
                if (!ownFrame.root && ownFrame.valid && !ownFrame.stale) {
                    ownFrame.stale = true;
                    staleSince = frameNow();
                }
                // FillSolidRect above is all a normal panel needs and is cheaper.
                // Only a host with a pseudo-transparent child pays for the blit,
                // because only that child pulls its background back out of us.
                if (isArtworkPaletteMode() && hasPseudoTransparentChild()) {
                    paintSolidSurface(gr, x, y, width, height, fallbackColour);
                } else {
                    releaseSolidSurface();
                }
                releaseSlice();
                syncImage('');
                return false;
            }
            releaseSolidSurface();

            var descriptor = sharedDescriptor();
            if (!descriptor) {
                syncImage('');
                return false;
            }

            var frame = frameForPaint();
            if (!frame || frame.rootWidth <= 0 || frame.rootHeight <= 0) return false;

            // Record the rectangle every Mica paint asks for, so the commit-time
            // slice rebuild knows what to build without waiting for a paint first.
            sliceRect = { x: x, y: y, width: width, height: height };

            var mappedOptions = {};
            for (var key in options) {
                if (Object.prototype.hasOwnProperty.call(options, key)) mappedOptions[key] = options[key];
            }
            mappedOptions.canvasX = -frame.x;
            mappedOptions.canvasY = -frame.y;
            mappedOptions.canvasWidth = frame.rootWidth;
            mappedOptions.canvasHeight = frame.rootHeight;

            var drawMode = currentDrawMode();
            var painted = false;

            if (!descriptor.enabled) {
                syncImage('');
                return false;
            }

            syncImage(descriptor.path);
            if (loadedImage && loadedPath === descriptor.path && loadedDrawMode === drawMode) {
                var cached = ensureSlice(loadedImage, descriptor.path, frame, x, y, width, height, descriptor);
                if (cached) {
                    try {
                        gr.DrawImage(cached, x, y, sliceWidth, sliceHeight,
                            0, 0, sliceWidth, sliceHeight, 0, 255);
                        painted = true;
                    } catch (eSlice) {
                        reportFailure('the cached Mica slice could not be blitted', eSlice);
                        releaseSlice();
                        mappedOptions.alpha = 255;
                        painted = drawCover(gr, loadedImage, x, y, width, height, mappedOptions);
                    }
                } else {
                    mappedOptions.alpha = 255;
                    painted = drawCover(gr, loadedImage, x, y, width, height, mappedOptions);
                }
                discardPreviousImage();
            } else {
                // Replacement still opening: keep drawing the previous image (see
                // previousImage - the no-blank handoff is why it is retained).
                var retained = null;
                if (loadedImage && loadedDrawMode === drawMode) retained = loadedImage;
                else if (previousImage && previousDrawMode === drawMode) retained = previousImage;
                if (retained) {
                    mappedOptions.alpha = 255;
                    painted = drawCover(gr, retained, x, y, width, height, mappedOptions);
                }
            }

            var tintAlpha = options.tintAlpha === undefined
                ? descriptor.tintAlpha
                : integer(options.tintAlpha, 0, 255, descriptor.tintAlpha);
            if (painted && tintAlpha > 0) {
                gr.FillSolidRect(x, y, width, height, withAlpha(fallbackColour, tintAlpha));
            }
            return painted;
        }

        function isActive() {
            var descriptor = sharedDescriptor();
            return !!(descriptor && descriptor.enabled);
        }

        // A panel outlives a normal/compact layout swap, and holding its old parent
        // token through the rediscovery grace period can leave a newly visible compact
        // panel on the fallback. Drops that affinity and restarts discovery at once,
        // keeping the last frame/image so nothing flashes; epoch checks still gate it.
        function invalidateConsumerFrame(rebindParent) {
            if (ownFrame.root) return false;

            if (!ownFrame.stale || !staleSince) staleSince = frameNow();
            ownFrame.stale = true;
            releaseSlice();
            if (rebindParent) ownFrame.parentToken = '';
            frameRetryAttempts = 0;
            clearFrameRequestTimer();

            if (isMicaMode() && safeOwnVisible()) scheduleFrameRequest(true);
            return true;
        }

        function onSharedThemeChanged(payload) {
            var mica = false;
            var descriptor = null;
            var desiredPath = '';
            try {
                mica = !!payload && String(payload.mode || '').toLowerCase() === 'mica';
                if (mica) descriptor = normaliseDescriptor(payload.backdrop);
                if (descriptor && descriptor.enabled) desiredPath = descriptor.path;
            } catch (e) {
                mica = false;
                descriptor = null;
                desiredPath = '';
            }

            if (stagedImage && stagedPath !== desiredPath) discardStagedImage();

            if (!mica || !descriptor || !desiredPath) {
                discardAllImages();
            } else if (loadedPath && loadedPath !== desiredPath && !safeOwnVisible()) {
                // Hidden consumers do not need the old->new handoff and can release
                // file handles immediately; when shown they render the current
                // target directly.
                discardAllImages();
            }

            if (!mica || !descriptor || !descriptor.enabled || !safeOwnVisible()) {
                // Nothing to cache, or nothing that can flash: a hidden panel rebuilds
                // on the paint that follows it being shown rather than holding a
                // panel-sized bitmap for artwork it is not displaying.
                releaseSlice();
            } else {
                rebuildSliceAfterCommit(descriptor);
            }

            if (requestedPath !== desiredPath ||
                requestedLoadKey !== makeLoadKey(desiredPath, currentDrawMode())) {
                // Do not request an extra repaint here. SharedThemeProtocol already
                // coalesces the semantic frame; that repaint both advances the fade
                // and performs any pending transactional image load.
                clearImageRetry();
                requestedPath = '';
                requestedLoadKey = '';
                directLoadAttemptedKey = '';
            }
            return true;
        }

        function resetConsumer() {
            clearImageRetry();
            discardAllImages();
            releaseSolidSurface();
            requestedPath = '';
            requestedLoadKey = '';
            directLoadAttemptedKey = '';
            if (loadWork) loadWork.request(makeLoadKey('', currentDrawMode()));
            invalidateConsumerFrame(false);
        }

        return {
            version: '1.20.0',
            defaults: {
                maxEdge: DEFAULT_MAX_EDGE,
                blurRadius: DEFAULT_BLUR_RADIUS,
                tintAlpha: DEFAULT_TINT_ALPHA
            },
            normaliseDescriptor: normaliseDescriptor,
            cloneDescriptor: cloneDescriptor,
            disabledDescriptor: disabledDescriptor,
            buildDescriptor: buildDescriptor,
            planDescriptor: planDescriptor,
            completeDescriptor: completeDescriptor,
            discardDescriptorJob: discardDescriptorJob,
            releaseProducerCache: releaseProducerCache,
            disposeProducerCache: disposeProducerCache,
            configureChildPanel: configureChildPanel,
            noteChildPanel: noteChildPanel,
            beginChildScan: beginChildScan,
            endChildScan: endChildScan,
            hasPseudoTransparentChild: hasPseudoTransparentChild,
            hasForeignPseudoChild: hasForeignPseudoChild,
            consumeGeometry: consumeGeometry,
            setRootFrame: setRootFrame,
            refreshRootFrame: refreshRootFrame,
            getFrameSnapshot: function () {
                return {
                    valid: !!ownFrame.valid, root: !!ownFrame.root, stale: !!ownFrame.stale,
                    x: ownFrame.x, y: ownFrame.y, width: ownFrame.width, height: ownFrame.height,
                    rootWidth: ownFrame.rootWidth, rootHeight: ownFrame.rootHeight,
                    parentToken: ownFrame.parentToken, rootToken: ownFrame.rootToken,
                    rootGeneration: ownFrame.rootGeneration, seenRootGeneration: seenRootGeneration,
                    responsesSeen: frameResponsesSeen,
                    retryAttempts: frameRetryAttempts,
                    rejectReason: frameRejectReason,
                    ownName: safeOwnName(), ownScript: safeOwnScriptName()
                };
            },
            paint: paint,
            isMicaMode: isMicaMode,
            isArtworkPaletteMode: isArtworkPaletteMode,
            isSharedArtworkSurfaceMode: isSharedArtworkSurfaceMode,
            isActive: isActive,
            invalidateConsumerFrame: invalidateConsumerFrame,
            prefetchSharedTheme: prefetchSharedTheme,
            onSharedThemeChanged: onSharedThemeChanged,
            resetConsumer: resetConsumer
        };
    }());
}
