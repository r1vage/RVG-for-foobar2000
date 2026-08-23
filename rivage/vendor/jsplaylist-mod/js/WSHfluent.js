// *****************************************************************************************************************************************
// Fluent icon + font layer
// Brings jssp's visual language to JSPlaylist: Segoe Fluent Icons glyphs, a custom font
// family with independent per-element sizes, and the scale() helper jssp sizes everything with.
//
// Icon font resolution, in order:
//   1. Segoe Fluent Icons   (Windows 11)
//   2. Segoe MDL2 Assets    (Windows 10)
//   3. Wingdings / GuiFx v2 Transports   (whatever JSPlaylist used before)
//
// Every glyph is looked up through ICONS.get(name), so a missing icon font degrades to the
// old glyph set instead of drawing boxes. Nothing here assumes Windows 11.
// *****************************************************************************************************************************************

var FLUENT_FONT_NAME = "Segoe Fluent Icons";
var MDL2_FONT_NAME = "Segoe MDL2 Assets";

var g_has_fluent = utils.CheckFont(FLUENT_FONT_NAME);
var g_has_mdl2 = utils.CheckFont(MDL2_FONT_NAME);
// icon_mode: 2 = Segoe Fluent Icons, 1 = Segoe MDL2 Assets, 0 = legacy Wingdings/GuiFx
var g_icon_mode = g_has_fluent ? 2 : (g_has_mdl2 ? 1 : 0);
var g_icon_font_name = g_icon_mode == 2 ? FLUENT_FONT_NAME : (g_icon_mode == 1 ? MDL2_FONT_NAME : "wingdings 2");

// Segoe Fluent Icons / MDL2 share these code points, so one table covers both.
// Values lifted from jssp's helpers.txt so the icons match exactly.
// Code points are written explicitly rather than as literal private-use characters,
// so the file survives any encoding round-trip. Values taken from jssp's helpers.txt.
function _icon(code) {
	return String.fromCharCode(code);
};

var chars = {
	check_on:    _icon(0xE73A),
	check_off:   _icon(0xE739),
	heart_on:    _icon(0xEB52),
	heart_off:   _icon(0xEB51),
	radio_on:    _icon(0xECCB),
	radio_off:   _icon(0xECCA),
	rating_on:   _icon(0xE735),
	rating_off:  _icon(0xE734),
	list:        _icon(0xEA37),
	lock:        _icon(0xE72E),
	working:     _icon(0xE916),
	up:          _icon(0xE70E),
	down:        _icon(0xE70D),
	left:        _icon(0xE76B),
	right:       _icon(0xE76C),
	close:       _icon(0xEF2C),
	stop:        _icon(0xE71A),
	prev:        _icon(0xE892),
	play:        _icon(0xE768),
	pause:       _icon(0xE769),
	next:        _icon(0xE893),
	search:      _icon(0xE721),
	preferences: _icon(0xE713),
	menu:        _icon(0xE700),
	music:       _icon(0xEC4F),
	volume:      _icon(0xE767),
	album:       _icon(0xE93C),
	folder:      _icon(0xED25),
	page:        _icon(0xE7C3),
	filter:      _icon(0xE71C),
	add:         _icon(0xE710),
	remove:      _icon(0xE738),
	pin:         _icon(0xE718),
	queue:       _icon(0xE90B)
};

// Segoe MDL2 Assets (Windows 10) is missing a few of the newer code points.
// Map those to the closest MDL2 equivalent so Win10 still shows real icons.
var chars_mdl2_overrides = {
	close:     _icon(0xE711),
	heart_on:  _icon(0xEB52),
	heart_off: _icon(0xEB51),
	queue:     _icon(0xE90B),
	filter:    _icon(0xE71C)
};

// Legacy fallback: the Wingdings / GuiFx glyphs JSPlaylist shipped with.
// { glyph, font } - font is resolved lazily because the gdi fonts are built later.
var chars_legacy = {
	check_on:    { c: String.fromCharCode(254), f: "wd2" },
	check_off:   { c: String.fromCharCode(168), f: "wd2" },
	heart_on:    { c: String.fromCharCode(60),  f: "mood" },
	heart_off:   { c: String.fromCharCode(60),  f: "mood" },
	radio_on:    { c: String.fromCharCode(155), f: "wd2" },
	radio_off:   { c: String.fromCharCode(152), f: "wd2" },
	rating_on:   { c: String.fromCharCode(234), f: "rating" },
	rating_off:  { c: String.fromCharCode(234), f: "rating" },
	list:        { c: String.fromCharCode(46),  f: "wd2" },
	lock:        { c: String.fromCharCode(45),  f: "wd2" },
	up:          { c: String.fromCharCode(112), f: "wd3" },
	down:        { c: String.fromCharCode(113), f: "wd3" },
	left:        { c: String.fromCharCode(51),  f: "wd3" },
	right:       { c: String.fromCharCode(52),  f: "wd3" },
	close:       { c: String.fromCharCode(238), f: "wd2" },
	stop:        { c: String.fromCharCode(60),  f: "wd3" },
	prev:        { c: String.fromCharCode(57),  f: "wd3" },
	play:        { c: String.fromCharCode(52),  f: "wd3" },
	pause:       { c: String.fromCharCode(59),  f: "wd3" },
	next:        { c: String.fromCharCode(56),  f: "wd3" },
	preferences: { c: String.fromCharCode(64),  f: "wd2" },
	menu:        { c: String.fromCharCode(58),  f: "wd3" },
	music:       { c: String.fromCharCode(41),  f: "wd2" },
	album:       { c: String.fromCharCode(41),  f: "wd2" },
	folder:      { c: String.fromCharCode(44),  f: "wd2" },
	queue:       { c: String.fromCharCode(80),  f: "checkbox" },
	add:         { c: String.fromCharCode(201), f: "wd2" },
	remove:      { c: String.fromCharCode(238), f: "wd2" }
};

ICONS = {

	mode: g_icon_mode,
	fontName: g_icon_font_name,

	available: function () {
		return g_icon_mode > 0;
	},

	// Glyph for a logical icon name, honouring the current icon mode.
	get: function (name) {
		if (g_icon_mode == 2)
			return chars[name] || "";
		if (g_icon_mode == 1)
			return chars_mdl2_overrides[name] || chars[name] || "";
		var legacy = chars_legacy[name];
		return legacy ? legacy.c : "";
	},

	// The gdi font a glyph must be drawn with. On Fluent/MDL2 every glyph shares one
	// font; on the legacy path each glyph has its own Wingdings variant.
	font: function (name, size) {
		if (g_icon_mode > 0)
			return gdi_font(g_icon_font_name, size || g_font_icon_size, 0);

		var legacy = chars_legacy[name];
		switch (legacy ? legacy.f : "wd2") {
		case "wd3":
			return gdi_font("wingdings 3", size || g_font_icon_size, 0);
		case "rating":
			return g_font_rating;
		case "mood":
			return g_font_mood;
		case "checkbox":
			return g_font_checkbox;
		default:
			return gdi_font("wingdings 2", size || g_font_icon_size, 0);
		};
	},

	// Convenience: draw a centred glyph in a box.
	draw: function (gr, name, colour, x, y, w, h, size) {
		var glyph = this.get(name);
		if (!glyph)
			return;
		gr.SetTextRenderingHint(4);
		gr.DrawString(glyph, this.font(name, size), colour, x, y, w, h, cc_stringformat);
	},

	describe: function () {
		return g_icon_mode == 2 ? "Segoe Fluent Icons"
			 : (g_icon_mode == 1 ? "Segoe MDL2 Assets (Windows 10 fallback)"
			 : "Wingdings / GuiFx (no icon font found)");
	}
};
