// *****************************************************************************************************************************************
// Shared Album Accent - consumer side
//
// JSPlaylist used to be the PRODUCER of the shared album accent (it decoded the playing
// track's artwork itself and broadcast the result). That extraction pipeline has moved to a
// standalone, reusable engine at jsplitter\rivage\shared\album_accent_engine.js, and the tabs
// panel (jsplitter\rivage\tab-switcher-right.js) is now the sole producer for the whole layout.
// JSPlaylist does not extract artwork itself, in any form - see the tabs panel for that.
//
// This file is what remains of the old producer: a small colour holder that receives the
// broadcast and answers the handful of places in this panel (main.js, WSHplaylist.js,
// WSHplaylistmanager.js, WSHschema.js) that want to read/tint with "the current accent".
//
// Protocol (see the canonical copy in jsplitter\rivage\shared\album_accent_protocol.js)
// --------
//   SHARED_ALBUM_ACCENT.UPDATE   (int colour)  producer (tabs panel) -> consumers (this panel)
//   SHARED_ALBUM_ACCENT.REQUEST  (0)           consumer -> producer, answered with an UPDATE
// *****************************************************************************************************************************************

var SHARED_ALBUM_ACCENT_UPDATE = "SHARED_ALBUM_ACCENT.UPDATE";
var SHARED_ALBUM_ACCENT_REQUEST = "SHARED_ALBUM_ACCENT.REQUEST";

AlbumAccent = {

	FIXED_ACCENT: RGB(0, 120, 212),

	// current colour, as received from the producer (or the fixed fallback until one arrives)
	colour: RGB(0, 120, 212),

	enabled: true,

	// ---------------------------------------------------------------- public API

	// Album-identity key, used by main.js purely to decide when the wallpaper cache can be
	// reused - unrelated to the accent colour itself, kept here only because it used to live
	// alongside the (now-removed) extraction pipeline.
	key_for: function (metadb) {
		if (!metadb)
			return null;
		try {
			return fb.TitleFormat("$if2(%album artist%,%artist%)|$if2(%album%,$directory_path(%path%))").EvalWithMetadb(metadb);
		} catch (e) {
			return null;
		};
	},

	// Called from on_notify_data() when a SHARED_ALBUM_ACCENT.UPDATE arrives.
	receive: function (colour) {
		if (typeof colour != "number")
			return this.colour;
		this.colour = colour;
		return this.colour;
	},

	// Accent with an alpha applied, for drawing.
	withAlpha: function (alpha) {
		return (this.enabled ? this.colour : g_color_highlight) & RGBA(255, 255, 255, this.clamp(Math.round(alpha), 0, 255));
	},

	clamp: function (value, minimum, maximum) {
		return Math.max(minimum, Math.min(maximum, value));
	},

	// Cleared when the user turns the feature off, so drawing falls back to the UI highlight.
	// Re-enabling asks the producer for a fresh colour rather than guessing.
	setEnabled: function (state) {
		this.enabled = !!state;
		if (this.enabled) {
			try { window.NotifyOthers(SHARED_ALBUM_ACCENT_REQUEST, 0); } catch (e) {};
		};
	}
};
