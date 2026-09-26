// *****************************************************************************************************************************************
// Shared album-art colour and dynamic-theme extraction engine
//
// Pure colour-science + album-art decoding. No producer/consumer wiring lives here (that is
// album_accent_protocol.js, in this same folder) and no host-panel globals are assumed beyond
// the standard SMP/JSplitter API (fb, utils, gdi). This is the ONLY place the "how do we pick
// the complete semantic colour scheme from this artwork" logic exists in the whole layout,
// so the artwork is decoded once per album by the producer (currently the root tabs panel).
//
// Ported from jsplaylist-mod's WSHalbumaccent.js (itself a JScript Panel 3 -> SMP port),
// generalised so it has zero dependency on that project's globals (RGB/getRed/getGreen/getBlue,
// `properties`, g_color_normal_bg). Pairs with material_colour.js (Material You HCT/Score port,
// same folder) when that file is also included; falls back to a plain saturation/luminance
// heuristic ("legacy") otherwise, exactly like the original did.
//
// Usage from a producer panel:
//   include(fb.ProfilePath + "jsplitter\\rivage\\shared\\material_colour.js");   // optional
//   include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_engine.js");
//   include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
//   include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
//   AlbumAccentEngine.configure({ algorithm: "material", backgroundTone: 20 });
//   var payload = AlbumAccentEngine.extractThemeFromMetadb(fb.GetNowPlaying());
//   SharedThemeProtocol.broadcast(payload);
//   SharedAccentProtocol.broadcast(payload.accent); // compatibility consumers
//
// v2.0.0 removed the pre-theme single-colour API (extractFromImage/extractFromMetadb and
// their memo, plus withAlpha/reset/report). It had been fully superseded by the theme
// payload above and was unreachable from anywhere in the layout. If a panel ever needs
// just an accent again, read `.accent` off the payload rather than reviving that path.
// *****************************************************************************************************************************************

// How many palette entries to pull from the artwork. Material scores best with a rich
// palette (Android quantizes to 128); the legacy picker only ever looked at a handful.
var ALBUM_ACCENT_SCHEME_COLOURS = 64;

// Narrow failure reporting. This file has no closure of its own (it is a
// plain top-level object literal, included into whatever scope the host
// panel is building), so the reporter is wrapped in its own IIFE rather
// than named reportFailure/reportedFailures like other files - those names
// would otherwise collide with a consuming panel's own top-level reporter.
// Most empty catches here guard a colour-extraction fallback tier that is
// expected to fail (the next tier picks up); this is for the one that
// means every tier failed and playback silently falls back to a fixed
// accent colour. Repeats are counted and re-logged only at powers of ten.
var reportAlbumAccentFailure = (function () {
	var reportedFailures = {};
	return function (what, err) {
		var message = '[RVG Album Accent] ' + what +
			(err === undefined || err === null ? '' : ': ' + err);
		var seen = (reportedFailures[message] || 0) + 1;
		reportedFailures[message] = seen;
		if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
		try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
	};
})();

var ALBUM_ACCENT_ENGINE_VERSION = "2.1.0";

// Re-entry guard, matching design_system.js and seekbar_widget.js: a second include()
// would otherwise reset every memo and force a full re-decode of the current album.
var AlbumAccentEngine = (typeof AlbumAccentEngine !== "undefined" && AlbumAccentEngine &&
	AlbumAccentEngine.version) ? AlbumAccentEngine : {

	version: ALBUM_ACCENT_ENGINE_VERSION,

	FIXED_ACCENT: 0xff0078d4, // Windows/UWP blue - used whenever nothing better can be extracted

	// 'material' (default, needs material_colour.js) or 'legacy' (saturation x luminance pick,
	// no extra dependency). Silently behaves as 'legacy' if MaterialColour isn't included.
	algorithm: "material",

	// Tone (CIELAB L*) of the surface the accent will be drawn on, 0-100 (dark UI ~= 20-35).
	// Only used to decide whether normalise() nudges the extracted colour towards white/black
	// for readability. Call configure({ backgroundTone: ... }) once at panel start-up.
	backgroundTone: 28,

	// key -> full theme payload memo, so revisiting an album never re-decodes the artwork.
	// Object.create(null) so an album whose key collides with an Object.prototype member
	// can't return a function instead of undefined.
	theme_memo: Object.create(null),
	theme_memo_keys: [],
	memo_limit: 64,
	theme: null,

	configure: function (options) {
		options = options || {};
		if (options.algorithm === "legacy" || options.algorithm === "material")
			this.algorithm = options.algorithm;
		if (typeof options.backgroundTone === "number")
			this.backgroundTone = options.backgroundTone;
	},

	// ---------------------------------------------------------------- local colour helpers
	// (deliberately self-contained - no dependency on a host "common helpers" file)

	RGB: function (r, g, b) {
		return (0xff000000 | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
	},

	channel: function (colour, index) {
		if (index === 0) return (colour >>> 16) & 0xff;
		if (index === 1) return (colour >>> 8) & 0xff;
		return colour & 0xff;
	},

	clamp: function (value, minimum, maximum) {
		return Math.max(minimum, Math.min(maximum, value));
	},

	luma: function (colour) {
		return 0.2126 * this.channel(colour, 0) + 0.7152 * this.channel(colour, 1) + 0.0722 * this.channel(colour, 2);
	},

	mix: function (a, b, amount) {
		var r = this.channel(a, 0) + (this.channel(b, 0) - this.channel(a, 0)) * amount;
		var g = this.channel(a, 1) + (this.channel(b, 1) - this.channel(a, 1)) * amount;
		var bl = this.channel(a, 2) + (this.channel(b, 2) - this.channel(a, 2)) * amount;
		return this.RGB(this.clamp(Math.round(r), 0, 255), this.clamp(Math.round(g), 0, 255), this.clamp(Math.round(bl), 0, 255));
	},

	sanitise: function (colour) {
		return this.RGB(this.channel(colour, 0), this.channel(colour, 1), this.channel(colour, 2));
	},

	// ---------------------------------------------------------------- picking

	// Pick the most "usable" colour out of a scheme: prefer saturated, mid-luminance colours.
	pick_from_scheme: function (scheme) {
		var best = null;
		var best_score = -1;
		var i, colour, r, g, b, maximum, minimum, saturation, luminance, score;

		if (!scheme || !scheme.length)
			return null;

		for (i = 0; i < scheme.length; i++) {
			colour = scheme[i];
			r = this.channel(colour, 0);
			g = this.channel(colour, 1);
			b = this.channel(colour, 2);
			maximum = Math.max(r, g, b);
			minimum = Math.min(r, g, b);
			saturation = (maximum === 0 ? 0 : (maximum - minimum) / maximum);
			luminance = this.luma(colour);

			// discard near-black and near-white entries
			if (luminance < 30 || luminance > 225)
				continue;

			score = saturation * 1.5 + (1 - Math.abs(luminance - 140) / 140);
			if (score > best_score) {
				best_score = score;
				best = colour;
			};
		};

		return best || scheme[0];
	},

	// Nudge the accent's TONE (CIELAB L*, what Material calls tone) until it reads clearly
	// against `backgroundTone`. Tone is perceptually uniform, so the same threshold behaves
	// consistently across hues. A short binary search on a white/black mix avoids needing
	// Material's HCT solver.
	normalise: function (colour) {
		if (typeof MaterialColour === "undefined")
			return this.luma(colour) < 90 ? this.mix(colour, this.RGB(255, 255, 255), 0.45) : colour;

		var bg_tone = this.backgroundTone;
		var tone = MaterialColour.toneFromArgb(colour | 0xff000000);
		var dark_ui = bg_tone < 50;
		// Material puts the primary near tone 80 on dark surfaces and near 40 on light ones.
		// Only correct when the accent is clearly on the wrong side, so vivid mid-tones are
		// left exactly as extracted.
		var target = dark_ui ? 55 : 50;
		if (dark_ui ? tone >= 35 : tone <= 75)
			return colour;

		var towards = (tone < target) ? this.RGB(255, 255, 255) : this.RGB(0, 0, 0);
		var lo = 0.0, hi = 1.0, mid, out = colour;
		for (var step = 0; step < 10; step++) {
			mid = (lo + hi) / 2;
			out = this.mix(colour, towards, mid);
			var t = MaterialColour.toneFromArgb(out | 0xff000000);
			if ((tone < target) ? (t < target) : (t > target)) {
				lo = mid;
			} else {
				hi = mid;
			};
		};
		return out;
	},

	// ---------------------------------------------------------------- extraction

	// SMP exposes GetColourSchemeJSON (colour + frequency) and, on some builds,
	// GetColourScheme (plain array). Try every shape, because a silent failure here just
	// leaves everything at FIXED_ACCENT.
	scheme_from_image: function (image) {
		var scheme = [];
		var raw, i;

		if (!image)
			return scheme;

		// 1. GetColourSchemeJSON -> [{col: int, freq: float}, ...]
		//    Frequencies are kept on scheme.weights because Material's Score is
		//    population-weighted; the legacy picker ignores them.
		try {
			raw = JSON.parse(image.GetColourSchemeJSON(ALBUM_ACCENT_SCHEME_COLOURS));
			if (raw && raw.length) {
				scheme.weights = [];
				for (i = 0; i < raw.length; i++) {
					if (raw[i] && raw[i].col !== undefined) {
						scheme.push(raw[i].col);
						scheme.weights.push(raw[i].freq !== undefined ? raw[i].freq : 1);
					};
				};
			};
			if (scheme.length) {
				scheme.path = "GetColourSchemeJSON";
				return scheme;
			};
		} catch (e) {};

		// 2. GetColourScheme -> Array (SMP) or VBArray (JSP3)
		try {
			raw = image.GetColourScheme(ALBUM_ACCENT_SCHEME_COLOURS);
			if (raw) {
				if (typeof raw.toArray === "function")
					raw = raw.toArray();
				if (raw.length) {
					for (i = 0; i < raw.length; i++)
						scheme.push(raw[i]);
				};
			};
			if (scheme.length) {
				scheme.path = "GetColourScheme";
				return scheme;
			};
		} catch (e) {};

		// 3. Last resort: shrink the art to a tiny strip and read it back as a scheme.
		//    try/finally, not a trailing Dispose(): GetColourSchemeJSON and JSON.parse can
		//    both throw, and this path runs precisely when the image is already misbehaving.
		//    A plain Dispose() after the loop was skipped on a throw, leaking the bitmap.
		var small = null;
		try {
			small = image.Resize(8, 8, 2);
			if (small) {
				raw = JSON.parse(small.GetColourSchemeJSON(6));
				for (i = 0; i < raw.length; i++) {
					if (raw[i] && raw[i].col !== undefined)
						scheme.push(raw[i].col);
				}
			}
			if (scheme.length)
				scheme.path = "Resize+GetColourSchemeJSON";
		} catch (e) {
			reportAlbumAccentFailure('no album-art colour scheme could be extracted (falling back to the fixed accent)', e);
		} finally {
			if (small && typeof small.Dispose === "function") {
				try { small.Dispose(); } catch (e2) { }
			}
		}

		return scheme;
	},

	// ---------------------------------------------------------------- complete Material-style dynamic scheme

	entries_from_scheme: function (scheme) {
		var entries = [];
		if (!scheme) return entries;
		for (var i = 0; i < scheme.length; i++) {
			entries.push({
				argb: this.sanitise(scheme[i]),
				population: (scheme.weights && scheme.weights[i] > 0)
					? scheme.weights[i] * 10000
					: (scheme.length - i)
			});
		}
		return entries;
	},

	material_sources: function (scheme) {
		var ranked = [];
		var primary = this.FIXED_ACCENT;
		var secondary = null;
		var tertiary = null;

		if (this.algorithm !== "legacy" && typeof MaterialColour !== "undefined") {
			try { ranked = MaterialColour.score(this.entries_from_scheme(scheme), 4, true) || []; } catch (e) { ranked = []; }
		}
		if (ranked.length && !(ranked.length === 1 && ranked[0] === MaterialColour.FALLBACK)) {
			primary = this.sanitise(ranked[0]);
			if (ranked.length > 1) secondary = this.sanitise(ranked[1]);
			if (ranked.length > 2) tertiary = this.sanitise(ranked[2]);
		} else {
			primary = this.sanitise(this.pick_from_scheme(scheme) || this.FIXED_ACCENT);
			if (scheme && scheme.length > 1) secondary = this.sanitise(scheme[1]);
			if (scheme && scheme.length > 2) tertiary = this.sanitise(scheme[2]);
		}

		// When the art does not contain enough well-separated colours, derive
		// companion hues from the primary seed. They remain perceptually tied to
		// the cover while avoiding a monochrome interface.
		if (!secondary) {
			secondary = typeof MaterialColour !== "undefined"
				? MaterialColour.toneFromSource(primary, 50, 0.55, 34, 24)
				: this.mix(primary, this.RGB(150, 150, 150), 0.42);
		}
		if (!tertiary) {
			tertiary = typeof MaterialColour !== "undefined"
				? MaterialColour.toneFromSource(primary, 50, 0.78, 46, 68)
				: this.mix(primary, this.RGB(210, 120, 90), 0.44);
		}

		return { primary: primary, secondary: secondary, tertiary: tertiary };
	},

	make_dynamic_scheme: function (sources, dark) {
		var self = this;
		var errorSource = this.RGB(186, 26, 26);
		function tone(source, value, scale, maxChroma, shift) {
			if (typeof MaterialColour !== "undefined" && typeof MaterialColour.toneFromSource === "function")
				return MaterialColour.toneFromSource(source, value, scale, maxChroma, shift || 0);
			var target = value >= 50 ? self.RGB(255, 255, 255) : self.RGB(0, 0, 0);
			return self.mix(source, target, Math.abs(value - 50) / 52);
		}

		var p = sources.primary;
		var s = sources.secondary;
		var t = sources.tertiary;
		var neutral = p;
		var neutralVariant = s;

		if (dark) {
			return {
				background: tone(neutral, 6, 0.10, 7),
				onBackground: tone(neutral, 90, 0.10, 7),
				surface: tone(neutral, 6, 0.10, 7),
				surfaceDim: tone(neutral, 6, 0.10, 7),
				surfaceBright: tone(neutral, 24, 0.10, 7),
				surfaceContainerLowest: tone(neutral, 4, 0.10, 7),
				surfaceContainerLow: tone(neutral, 10, 0.10, 7),
				surfaceContainer: tone(neutral, 12, 0.10, 7),
				surfaceContainerHigh: tone(neutral, 17, 0.10, 7),
				surfaceContainerHighest: tone(neutral, 22, 0.10, 7),
				onSurface: tone(neutral, 90, 0.10, 7),
				onSurfaceVariant: tone(neutralVariant, 80, 0.24, 18),

				primary: tone(p, 80, 1.0, 64),
				onPrimary: tone(p, 20, 0.88, 54),
				primaryContainer: tone(p, 30, 0.92, 58),
				onPrimaryContainer: tone(p, 90, 0.82, 50),
				secondary: tone(s, 80, 0.70, 42),
				onSecondary: tone(s, 20, 0.62, 36),
				secondaryContainer: tone(s, 30, 0.66, 38),
				onSecondaryContainer: tone(s, 90, 0.52, 32),
				tertiary: tone(t, 80, 0.82, 50),
				onTertiary: tone(t, 20, 0.72, 44),
				tertiaryContainer: tone(t, 30, 0.76, 46),
				onTertiaryContainer: tone(t, 90, 0.62, 38),

				error: tone(errorSource, 80, 1.0, 70),
				onError: tone(errorSource, 20, 0.90, 62),
				errorContainer: tone(errorSource, 30, 0.94, 66),
				onErrorContainer: tone(errorSource, 90, 0.72, 48),
				outline: tone(neutralVariant, 60, 0.24, 18),
				outlineVariant: tone(neutralVariant, 30, 0.24, 18),
				inverseSurface: tone(neutral, 90, 0.10, 7),
				inverseOnSurface: tone(neutral, 20, 0.10, 7),
				inversePrimary: tone(p, 40, 1.0, 64)
			};
		}

		return {
			background: tone(neutral, 98, 0.10, 7),
			onBackground: tone(neutral, 10, 0.10, 7),
			surface: tone(neutral, 98, 0.10, 7),
			surfaceDim: tone(neutral, 87, 0.10, 7),
			surfaceBright: tone(neutral, 98, 0.10, 7),
			surfaceContainerLowest: tone(neutral, 100, 0.10, 7),
			surfaceContainerLow: tone(neutral, 96, 0.10, 7),
			surfaceContainer: tone(neutral, 94, 0.10, 7),
			surfaceContainerHigh: tone(neutral, 92, 0.10, 7),
			surfaceContainerHighest: tone(neutral, 90, 0.10, 7),
			onSurface: tone(neutral, 10, 0.10, 7),
			onSurfaceVariant: tone(neutralVariant, 30, 0.24, 18),

			primary: tone(p, 40, 1.0, 64),
			onPrimary: tone(p, 100, 0, 0),
			primaryContainer: tone(p, 90, 0.82, 50),
			onPrimaryContainer: tone(p, 10, 0.92, 58),
			secondary: tone(s, 40, 0.70, 42),
			onSecondary: tone(s, 100, 0, 0),
			secondaryContainer: tone(s, 90, 0.52, 32),
			onSecondaryContainer: tone(s, 10, 0.66, 38),
			tertiary: tone(t, 40, 0.82, 50),
			onTertiary: tone(t, 100, 0, 0),
			tertiaryContainer: tone(t, 90, 0.62, 38),
			onTertiaryContainer: tone(t, 10, 0.76, 46),

			error: tone(errorSource, 40, 1.0, 70),
			onError: tone(errorSource, 100, 0, 0),
			errorContainer: tone(errorSource, 90, 0.72, 48),
			onErrorContainer: tone(errorSource, 10, 0.94, 66),
			outline: tone(neutralVariant, 50, 0.24, 18),
			outlineVariant: tone(neutralVariant, 80, 0.24, 18),
			inverseSurface: tone(neutral, 20, 0.10, 7),
			inverseOnSurface: tone(neutral, 95, 0.10, 7),
			inversePrimary: tone(p, 80, 1.0, 64)
		};
	},

	buildThemePayload: function (scheme, key, hasArtwork) {
		var sources = this.material_sources(scheme || []);
		var payload = {
			version: 1,
			// "existing" means "consumers, change nothing" - this engine has no opinion on
			// the global theme mode. The PRODUCER overwrites it (tab-switcher-right.js:500);
			// a producer that forgot would broadcast a silently inert theme.
			mode: "existing",
			key: String(key || ""),
			hasArtwork: !!hasArtwork,
			source: this.sanitise(sources.primary),
			accent: this.normalise(this.sanitise(sources.primary)),
			light: this.make_dynamic_scheme(sources, false),
			dark: this.make_dynamic_scheme(sources, true)
		};
		this.theme = payload;
		return payload;
	},

	load_artwork: function (metadb) {
		if (!metadb) return null;
		var image = null;
		try { image = utils.GetAlbumArtV2(metadb, 0); } catch (e) { image = null; }
		if (!image) {
			var ids = [1, 2, 3, 4];
			for (var i = 0; i < ids.length && !image; i++) {
				try { image = utils.GetAlbumArtV2(metadb, ids[i]); } catch (e2) { image = null; }
			}
		}
		return image;
	},

	// Preferred entry point. `image` lets a caller that has ALREADY decoded the artwork
	// (a wallpaper, a header cover) hand it over so it is only decoded once; pass null to
	// let the engine load and dispose its own copy.
	extractThemeFromImage: function (image, metadb) {
		var key = this.key_for(metadb);
		var memoised = this.lookupTheme(key);
		if (memoised) return memoised;

		var ownedImage = null;
		var art = image;
		if (!art) {
			ownedImage = this.load_artwork(metadb);
			art = ownedImage;
		}
		var scheme = art ? this.scheme_from_image(art) : [];
		var hasArtwork = !!art && !!scheme.length;
		var payload = this.buildThemePayload(scheme, key, hasArtwork);
		if (ownedImage && typeof ownedImage.Dispose === "function") {
			try { ownedImage.Dispose(); } catch (e3) { }
		}

		if (key !== null) this.rememberTheme(key, payload);
		return payload;
	},

	// Memo access for a producer whose extraction ran elsewhere (the artwork Worker).
	lookupTheme: function (key) {
		if (key === null || key === undefined || this.theme_memo[key] === undefined) return null;
		this.theme = this.theme_memo[key];
		return this.theme;
	},

	// Only a payload built from real artwork is kept: an artless one would pin the album
	// to the fallback theme for the session, so briefly unreadable art could never recover.
	rememberTheme: function (key, payload) {
		if (key === null || key === undefined || !payload || !payload.hasArtwork) return;
		if (this.theme_memo[key] === undefined) {
			this.theme_memo_keys.push(key);
			if (this.theme_memo_keys.length > this.memo_limit)
				delete this.theme_memo[this.theme_memo_keys.shift()];
		}
		this.theme_memo[key] = payload;
		this.theme = payload;
	},

	extractThemeFromMetadb: function (metadb) {
		return this.extractThemeFromImage(null, metadb);
	},

	clear_memo: function () {
		this.theme_memo = Object.create(null);
		this.theme_memo_keys = [];
		this.theme = null;
	},

	// Key identifying the artwork, so the engine never recomputes for the same album.
	// The pattern is constant, so the FbTitleFormat is compiled once and reused - building
	// one per call is the classic SMP cost, and this runs on every track change.
	KEY_TITLEFORMAT: null,

	key_for: function (metadb) {
		if (!metadb)
			return null;
		try {
			if (!this.KEY_TITLEFORMAT) {
				this.KEY_TITLEFORMAT = fb.TitleFormat(
					"$if2(%album artist%,%artist%)|$if2(%album%,$directory_path(%path%))");
			}
			return this.KEY_TITLEFORMAT.EvalWithMetadb(metadb);
		} catch (e) {
			return null;
		}
	}
};
