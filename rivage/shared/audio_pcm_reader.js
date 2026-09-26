'use strict';

// Zero-allocation PCM reads for the audio panels (JSplitter 4.2.1+).
// read() fills one reusable Float32Array via fb.GetAudioChunkTo; the buffer is
// oversized, so consumers must loop to `samples`, never `data.length`.

var AUDIO_PCM_READER_VERSION = "1.0.0";

if (typeof AudioPcmReader === 'undefined') {
    var AudioPcmReader = (function () {
        var supported = typeof fb.GetAudioChunkTo === 'function';
        // Worst case the host can hand back: 384 kHz, 8 channels.
        var MAX_RATE = 384000;
        var MAX_CHANNELS = 8;

        function create(tag) {
            var info = { SampleCount: 0, ChannelCount: 0, SampleRate: 0, ChannelConfig: 0 };
            var buffer = new Float32Array(0);
            var result = { data: buffer, samples: 0, frames: 0, channels: 0, rate: 0, config: 0 };
            var warned = false;
            var oversized = false;

            function warn(message) {
                if (warned) return;
                warned = true;
                try { console.log('[' + tag + '] ' + message); } catch (e) { }
            }

            function ensure(seconds, rate, channels) {
                var need = Math.ceil(seconds * rate * 1.25) * channels + 64;
                if (buffer.length < need) {
                    buffer = new Float32Array(need);
                    result.data = buffer;
                }
            }

            function pull(seconds) {
                return fb.GetAudioChunkTo(buffer, seconds, 0, info);
            }

            return {
                supported: supported,

                // Returns the shared result object, or null when no chunk is available.
                read: function (seconds) {
                    if (!supported) {
                        warn('requires JSplitter 4.2.1 or newer (fb.GetAudioChunkTo missing).');
                        return null;
                    }
                    // Shrink from the ceiling once a read has reported the real format.
                    if (oversized && info.SampleRate > 0) {
                        oversized = false;
                        buffer = new Float32Array(0);
                    }
                    ensure(seconds, info.SampleRate || 48000, info.ChannelCount || 2);

                    var written;
                    try {
                        written = pull(seconds);
                    } catch (e) {
                        // Too small for an unseen format: grow to the ceiling once and retry.
                        ensure(seconds, MAX_RATE, MAX_CHANNELS);
                        try { written = pull(seconds); } catch (e2) { warn('PCM read failed: ' + e2); return null; }
                        oversized = true;
                    }

                    var channels = info.ChannelCount | 0;
                    if (!(written > 0) || channels < 1) return null;

                    result.samples = written;
                    result.channels = channels;
                    result.frames = Math.floor(written / channels);
                    result.rate = Number(info.SampleRate) || 0;
                    result.config = Number(info.ChannelConfig) || 0;
                    return result.frames > 0 ? result : null;
                }
            };
        }

        return { version: AUDIO_PCM_READER_VERSION, supported: supported, create: create };
    })();
}
