// *****************************************************************************************************************************************
// Playlist Manager object by Br3tt aka Falstaff (c)2015
// Modified by RivaGe
// *****************************************************************************************************************************************

// ----------------------------------------------------------------------------
// Flyout styling
// ----------------------------------------------------------------------------
// The playlist manager takes its colours from the shared RVG theme
// (RivageUI.createTheme), like every other panel: light and dark themes,
// artwork palettes, and under Artwork Mica a translucent card over this
// panel's own slice of the backdrop. With the shared theme off it follows
// this panel's configurable colours instead (g_color_normal_bg/txt).
//
// Rows use the same rounded accent wash and capsule bar as Inset card
// playlist rows. A playlist's name is always drawn in the primary text
// colour: "active" is carried by the wash, bar and bold weight, "playing" by
// the speaker icon. Tinting the name itself (the old behaviour) put an
// accent-coloured name on an accent wash, which was unreadable on the
// active + playing row.
var PM_FALLBACK_SURFACE = RGB(28, 28, 28);
var PM_FALLBACK_TEXT = RGB(245, 245, 245);

function pm_with_alpha(colour, alpha) {
	return (colour & 0x00ffffff) | (clamp_int(alpha, 0, 255) << 24);
};

function pm_opaque(colour) {
	return colour | 0xff000000;
};

function pm_pick(value, fallback) {
	return (typeof value == "number" && isFinite(value)) ? value : fallback;
};

// Palette derived from one background and one text colour, for when the
// shared theme is off or unavailable.
function pm_palette_from(bg, txt) {
	bg = pm_opaque(bg);
	txt = pm_opaque(txt);
	var dark = (getRed(bg) * 0.299 + getGreen(bg) * 0.587 + getBlue(bg) * 0.114) < 128;
	return {
		mica: false,
		dark: dark,
		background: bg,
		surface: blendColors(bg, txt, dark ? 0.055 : 0.045),
		input: blendColors(bg, txt, 0.10),
		separator: blendColors(bg, txt, 0.16),
		text: txt,
		textSecondary: blendColors(bg, txt, 0.78),
		textMuted: blendColors(bg, txt, 0.60),
		textDisabled: blendColors(bg, txt, 0.35),
		hover: pm_with_alpha(txt, dark ? 24 : 20),
		danger: dark ? RGB(255, 99, 99) : RGB(196, 43, 28)
	};
};

function pm_palette() {
	var shared = null;
	try { shared = RivageUI.getSharedTheme ? RivageUI.getSharedTheme() : null; } catch (e) { shared = null; }
	if (!shared || shared.mode === "existing") {
		return (typeof g_color_normal_bg == "number" && typeof g_color_normal_txt == "number" && (g_color_normal_bg || g_color_normal_txt))
			? pm_palette_from(g_color_normal_bg, g_color_normal_txt)
			: pm_palette_from(PM_FALLBACK_SURFACE, PM_FALLBACK_TEXT);
	};
	var t = null;
	try { t = RivageUI.createTheme({ mode: "host" }); } catch (e) { t = null; }
	if (!t) return pm_palette_from(PM_FALLBACK_SURFACE, PM_FALLBACK_TEXT);
	var base = pm_palette_from(t.background, t.textPrimary);
	return {
		mica: !!t.mica,
		dark: t.dark !== false,
		background: pm_opaque(t.background),
		// Under Mica the flyout floats over the playlist, so it takes a much
		// denser card than the 66% panels use: the artwork only tints it.
		surface: t.mica ? pm_with_alpha(pm_pick(t.card, base.surface), 232) : pm_pick(t.card, base.surface),
		input: pm_opaque(pm_pick(t.surfaceHover, base.input)),
		separator: pm_pick(t.separator, base.separator),
		text: pm_opaque(t.textPrimary),
		textSecondary: pm_pick(t.textSecondary, base.textSecondary),
		textMuted: pm_pick(t.textMuted, base.textMuted),
		textDisabled: pm_pick(t.textDisabled, base.textDisabled),
		hover: base.hover,
		danger: pm_opaque(pm_pick(t.danger, base.danger))
	};
};

// Rounded fill / outline with the radius clamped to the rectangle, so a
// short row or narrow panel can never produce an invalid arc.
function pm_round_fill(gr, x, y, w, h, r, colour) {
	if (w <= 0 || h <= 0) return;
	r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
	if (r < 1) {
		gr.FillSolidRect(x, y, w, h, colour);
		return;
	};
	gr.SetSmoothingMode(2);
	gr.FillRoundRect(x, y, w, h, r, r, colour);
	gr.SetSmoothingMode(0);
};

function pm_round_stroke(gr, x, y, w, h, r, colour, line_width) {
	var lw = line_width || 1;
	var sw = w - lw, shh = h - lw;
	if (sw <= 0 || shh <= 0) return;
	r = Math.min(r, Math.floor(sw / 2), Math.floor(shh / 2));
	gr.SetSmoothingMode(2);
	if (r < 1) {
		gr.DrawRect(x + lw / 2, y + lw / 2, sw, shh, lw, colour);
	} else {
		gr.DrawRoundRect(x + lw / 2, y + lw / 2, sw, shh, r, r, lw, colour);
	};
	gr.SetSmoothingMode(0);
};

oPlaylist = function (idx, rowId, isAutoPl, parent, filter_type, filter_idx) {
	this.idx = idx;
	this.rowId = rowId;
	this.filter_type = filter_type;
	this.filter_idx = filter_idx;
	this.name = plman.GetPlaylistName(idx);
	this.isAutoPlaylist = isAutoPl;
	this.isReservedPlaylist = false;
	this.bt_remove = new button(parent.bt_remove_normal, parent.bt_remove_hover, parent.bt_remove_down);
	// set a forced "autoplaylist" status to the playlist if it's a special/reserved playlist for the panel
	if (!isAutoPl) {
		if (this.name == "Historic") {
			this.isReservedPlaylist = true;
		};
	};
	this.y = -1;
};

oPlaylistManager = function (obj_name) {
	this.objectName = obj_name;
	this.h = p.list.h;
	this.woffset = 0;
	this.border = 2.0;
	this.playlists = [];
	this.offset = 0;
	this.totalRows = Math.floor(this.area_h / cPlaylistManager.rowHeight);
	this.scrollbar = new oScrollBar(0, this.objectName + ".scrollbar", 0, 0, cScrollBar.width, 0, 0, cPlaylistManager.rowHeight, this.offset, this.objectName, true, 3, false);
	this.scrollbarWidth = 0;
	this.inputbox = null;
	this.inputboxID = -1;

	this.setButtons = function () {
		var pal = this.palette || pm_palette();

		// Text uses the playlist row font (g_font / g_font_small), so rows
		// and the footer grow with it instead of clipping larger sizes.
		cPlaylistManager.rowHeight = Math.max(zoom(cRow.playlistManager_h, g_dpi), g_font.Height + zoom(12, g_dpi));
		cPlaylistManager.statusBarHeight = Math.max(zoom(16, g_dpi), g_font_small.Height + zoom(8, g_dpi));
		var rowH = cPlaylistManager.rowHeight;

		// remove button: a close glyph, with a red rounded wash on hover. Only
		// the hovered row shows it (see draw()).
		var s = Math.max(g_z16, Math.min(rowH - zoom(6, g_dpi), zoom(22, g_dpi)));
		var r = Math.max(2, Math.floor(s / 4));
		var use_icons = ICONS.available();
		var glyph = use_icons ? chars.close : String.fromCharCode(209);
		var glyph_font = use_icons
			? gdi_font(ICONS.fontName, Math.max(8, Math.round(g_font_icon.Size * 0.72)), 0)
			: gdi_font(g_font_wd2.Name, g_font_wd2.Size - g_z8, 0);
		var make_remove = function (bg, fg) {
			var img = gdi.CreateImage(s, s);
			var gb = img.GetGraphics();
			if (bg) pm_round_fill(gb, 0, 0, s, s, r, bg);
			gb.SetTextRenderingHint(4);
			gb.DrawString(glyph, glyph_font, fg, 0, 0, s, s, cc_stringformat);
			img.ReleaseGraphics(gb);
			return img;
		};
		this.bt_remove_normal = make_remove(0, pal.textMuted);
		this.bt_remove_hover = make_remove(pm_with_alpha(pal.danger, 46), pal.danger);
		this.bt_remove_down = make_remove(pm_with_alpha(pal.danger, 84), pal.danger);
		for (var i = 0; i < this.playlists.length; i++) {
			this.playlists[i].bt_remove.update(this.bt_remove_normal, this.bt_remove_hover, this.bt_remove_down);
		};

		// sort buttons in the footer: plain text labels, rounded wash on hover
		var fh = cPlaylistManager.statusBarHeight;
		var sfont = g_font_small;
		var probe = gdi.CreateImage(1, 1);
		var pg = probe.GetGraphics();
		var make_sort = function (label, hot) {
			var w = Math.ceil(pg.CalcTextWidth(label, sfont)) + zoom(14, g_dpi);
			var img = gdi.CreateImage(w, fh);
			var gb = img.GetGraphics();
			var vpad = Math.max(1, zoom(3, g_dpi));
			if (hot) pm_round_fill(gb, 0, vpad, w, fh - vpad * 2, zoom(4, g_dpi), pal.hover);
			gb.SetTextRenderingHint(4);
			gb.DrawString(label, sfont, hot ? pal.text : pal.textMuted, 0, 0, w, fh, cc_stringformat);
			img.ReleaseGraphics(gb);
			return img;
		};
		this.bt_sortAz_normal = make_sort("A-Z", false);
		this.bt_sortAz_hover = make_sort("A-Z", true);
		this.bt_sortZa_normal = make_sort("Z-A", false);
		this.bt_sortZa_hover = make_sort("Z-A", true);
		probe.ReleaseGraphics(pg);
		this.sortAz_button = new button(this.bt_sortAz_normal, this.bt_sortAz_hover, this.bt_sortAz_hover);
		this.sortZa_button = new button(this.bt_sortZa_normal, this.bt_sortZa_hover, this.bt_sortZa_hover);
	};

	this.setColors = function () {
		this.palette = pm_palette();
		this.color_txt = this.palette.text;
		this.color_bg = pm_opaque(this.palette.surface);
		// color_sel/color_high stay on this panel's configurable colours for
		// any code outside draw() that still reads them.
		this.color_sel = g_color_selected_bg;
		this.color_high = g_color_highlight;
		this.scrollbar.setDefaultColors();
		this.setButtons();
	};
	this.setColors();

	this.repaint = function () {
		window.RepaintRect(this.x - this.woffset, this.y, this.w, this.h);
	};

	this.setSize = function (x, y, w, h) {
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;

		if (cPlaylistManager.visible) {
			this.woffset = this.w;
		} else {
			this.woffset = 0;
		};

		this.totalRows = Math.floor((h - cPlaylistManager.rowHeight - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0)) / cPlaylistManager.rowHeight);
		this.offset = 0;

		// scrollbar resize
		this.scrollbar.reSize(this.x - this.woffset + this.w - cScrollBar.width, this.y + cPlaylistManager.rowHeight, cScrollBar.width, this.h - cPlaylistManager.rowHeight - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0), 0, cPlaylistManager.rowHeight, this.offset);
		if (this.scrollbar.visible) {
			this.scrollbarWidth = this.scrollbar.w;
		} else {
			this.scrollbarWidth = 0;
		};
	};

	this.refresh = function (filter, exclude_autoplaylists, exclude_active, reset_offset) {
		this.playlists.splice(0, this.playlists.length);
		this.total = plman.PlaylistCount;
		var rowId = 0;
		var isAutoPl = false;
		var isReserved = false;
		var plname = null;
		for (var idx = 0; idx < this.total; idx++) {
			plname = plman.GetPlaylistName(idx);
			isAutoPl = plman.IsAutoPlaylist(idx);
			isReserved = plname == "Historic";

			// is playlist Filtered for groupBy Patterns
			var found = false;
			var default_pattern_index = -1;
			var playlist_pattern_index = -1;
			if (properties.showgroupheaders && properties.enablePlaylistFilter) {
				// get Filtered groupBy pattern
				for (var m = 0; m < p.list.groupby.length; m++) {
					if (default_pattern_index > -1 && found) {
						break;
					} else if (p.list.groupby[m].playlistFilter.length > 0) {
						var arr_pl = p.list.groupby[m].playlistFilter.split(";");
						for (var n = 0; n < arr_pl.length; n++) {
							if (default_pattern_index < 0 && arr_pl[n] == "*") {
								default_pattern_index = m;
								playlist_pattern_index = (playlist_pattern_index < 0 ? m : playlist_pattern_index);
							};
							if (arr_pl[n] == plname) {
								found = true;
								playlist_pattern_index = m;
							};
						};
					};
				};
			};
			if (found) {
				var filter_type = 1;
			} else if (default_pattern_index > -1) {
				var filter_type = 2;
			} else {
				var filter_type = 0;
			};

			if (!exclude_autoplaylists || (!isAutoPl && !isReserved)) {
				if (idx == plman.ActivePlaylist) {
					if (!exclude_active) {
						this.playlists.push(new oPlaylist(idx, rowId, isAutoPl, this, filter_type, playlist_pattern_index));
						rowId++;
					};
				} else {
					this.playlists.push(new oPlaylist(idx, rowId, isAutoPl, this, filter_type, playlist_pattern_index));
					rowId++;
				};
			};
		};
		this.rowTotal = rowId;
		// scrollbar settings
		this.max = (this.rowTotal > this.totalRows ? this.totalRows : this.rowTotal);
		// scrollbar reset
		if (reset_offset)
			this.offset = 0;

		this.scrollbar.reSet(this.rowTotal, cPlaylistManager.rowHeight, this.offset);
		if (this.scrollbar.visible) {
			this.scrollbarWidth = this.scrollbar.w;
		} else {
			this.scrollbarWidth = 0;
		};
	};

	this.draw = function (gr) {

		if (cPlaylistManager.playlist_switch_pending) {
			window.SetCursor(IDC_ARROW);
			cPlaylistManager.playlist_switch_pending = false;
		};

		if (this.woffset <= 0) return;

		var pal = this.palette || (this.palette = pm_palette());
		var px = this.x - this.woffset + this.border;
		var pw = this.w - this.border;
		var ch = cPlaylistManager.rowHeight;
		var fh = cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0;
		var hair = Math.max(1, zoom(1, g_dpi));
		var pad = zoom(10, g_dpi);
		var inset = zoom(6, g_dpi);
		var radius = Math.max(1, Math.min(zoom(6, g_dpi), Math.floor((ch - 2) / 2)));
		var drop_mode = g_dragndrop_hover_playlistManager;
		var blink_on = cPlaylistManager.blink_counter > -1 && cPlaylistManager.blink_counter <= 5 &&
			cPlaylistManager.blink_counter % 2 == 0;
		var use_icons = ICONS.available();
		var i;

		// ---------------------------------------------------------------- surface
		// This panel's slice of the Mica backdrop under a translucent card, or
		// the opaque card on every other theme.
		if (pal.mica && typeof RivageBackdrop != "undefined" && RivageBackdrop.isMicaMode()) {
			RivageBackdrop.paint(gr, px, this.y, pw, this.h, pal.background);
		} else {
			gr.FillSolidRect(px, this.y, pw, this.h, pal.background);
		};
		gr.FillSolidRect(px, this.y, pw, this.h, pal.surface);
		gr.FillSolidRect(px, this.y, hair, this.h, pal.separator);

		// ---------------------------------------------------------------- header
		var cy = this.y;
		var hdr_x = px + inset;
		var hdr_w = pw - inset * 2;
		if (drop_mode) {
			var hot = this.ishoverHeader;
			if (hot) {
				pm_round_fill(gr, hdr_x, cy + 1, hdr_w, ch - 2, radius, pm_accent(40));
				pm_round_stroke(gr, hdr_x, cy + 1, hdr_w, ch - 2, radius, pm_accent(200));
			};
			var hdr_col = hot ? accent_colour(255) : pal.textSecondary;
			var add_w = 0;
			if (use_icons) {
				add_w = gr.CalcTextWidth(chars.add, g_font_icon) + zoom(6, g_dpi);
				gr.GdiDrawText(chars.add, g_font_icon, hdr_col, px + pad, cy, add_w, ch, DT_LEFT | DT_VCENTER | DT_NOPREFIX);
			};
			gr.GdiDrawText("Drop to create a new playlist", g_font_bold, hdr_col, px + pad + add_w, cy, pw - pad * 2 - add_w, ch, DT_LEFT | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
		} else {
			gr.GdiDrawText("Playlists", g_font_bold, pal.textSecondary, px + pad, cy, pw - pad * 2, ch, DT_LEFT | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
		};
		gr.FillSolidRect(px + pad, cy + ch - hair, pw - pad * 2, hair, pal.separator);

		// flash the header after tracks were dropped on it
		if (blink_on && cPlaylistManager.blink_id == -1) {
			pm_round_stroke(gr, hdr_x, cy + 1, hdr_w, ch - 2, radius, accent_colour(255), 2);
		};

		// ---------------------------------------------------------------- rows
		// Remove buttons are hit-tested from where they were last drawn. Park
		// them all off-panel first, so only the button actually on screen (the
		// hovered row's) can ever be clicked - a row scrolled away or no longer
		// hovered must not keep a live button at its old position.
		for (i = 0; i < this.playlists.length; i++) {
			this.playlists[i].bt_remove.x = -10000;
			this.playlists[i].bt_remove.y = -10000;
		};

		var list_bottom = this.y + this.h - fh;
		var rx = px + inset;
		var rw = pw - this.scrollbarWidth - inset * 2;
		var bar_w = Math.max(2, zoom(3, g_dpi));
		var icon_w = use_icons ? gr.CalcTextWidth(chars.list, g_font_icon) : gr.CalcTextWidth(String.fromCharCode(46), g_font_wd2);
		var icon_x = rx + bar_w + zoom(7, g_dpi);
		var text_x = icon_x + icon_w + zoom(8, g_dpi);
		var right = rx + rw - zoom(8, g_dpi);
		var playing_idx = (fb.IsPlaying || fb.IsPaused) ? plman.PlayingPlaylist : -1;
		this.text_x_offset = text_x - px;

		var row_idx = 0;
		for (i = this.offset; i < this.playlists.length; i++) {
			cy = this.y + ch + row_idx * ch;
			if (cy + ch > list_bottom) break;
			var pl = this.playlists[i];
			pl.y = cy;

			var is_active = pl.idx == plman.ActivePlaylist;
			var is_playing = pl.idx == playing_idx;
			var is_hover = i == this.hoverId;
			var locked = pl.isAutoPlaylist || pl.isReservedPlaylist;
			var is_medialib = cPlaylistManager.mediaLibraryPlaylist && i == 0;
			var can_drop = drop_mode && is_hover && !locked;
			// while dragging tracks, playlists that can't take them are dimmed
			var unavailable = dragndrop.moved && (locked || (is_active && cPlaylistManager.visible));
			var wy = cy + 1;
			var wh = ch - 2;

			// row wash - same family as Inset card playlist rows
			if (is_active) {
				pm_round_fill(gr, rx, wy, rw, wh, radius, pm_accent(55));
				var bar_h = Math.max(2, wh - radius * 2);
				pm_round_fill(gr, rx, wy + Math.floor((wh - bar_h) / 2), bar_w, bar_h, Math.floor(bar_w / 2), pm_accent(255));
			} else if (is_hover && !drop_mode) {
				pm_round_fill(gr, rx, wy, rw, wh, radius, pm_accent(30));
			};
			if (can_drop) {
				pm_round_fill(gr, rx, wy, rw, wh, radius, pm_accent(40));
				pm_round_stroke(gr, rx, wy, rw, wh, radius, pm_accent(200));
			};
			if (cPlaylistManager.rightClickedId == i) {
				pm_round_stroke(gr, rx, wy, rw, wh, radius, pm_accent(200));
			};
			if (blink_on && i == cPlaylistManager.blink_id) {
				pm_round_stroke(gr, rx, wy, rw, wh, radius, accent_colour(255), 2);
			};

			// icon - the speaker marks the playing playlist
			var icon_col = unavailable ? pal.textDisabled
				 : (is_playing ? accent_colour(255) : (is_active ? pal.text : pal.textSecondary));
			if (use_icons) {
				var glyph = is_playing ? chars.volume
					 : (is_medialib && cPlaylistManager.visible ? chars.music
					 : (pl.isReservedPlaylist ? chars.lock
					 : (pl.isAutoPlaylist ? chars.filter : chars.list)));
				gr.SetTextRenderingHint(4);
				gr.DrawString(glyph, g_font_icon, icon_col, icon_x, cy, icon_w, ch, cc_stringformat);
			} else {
				var icon_char = (is_medialib && cPlaylistManager.visible) ? String.fromCharCode(46)
					 : (pl.isReservedPlaylist ? String.fromCharCode(45)
					 : (pl.isAutoPlaylist ? String.fromCharCode(44) : String.fromCharCode(41)));
				gr.SetTextRenderingHint(5);
				gr.DrawString(icon_char, g_font_wd2, icon_col, icon_x, cy - 1, icon_w, ch, lc_stringformat);
			};

			if (this.inputboxID == i) {
				// rename in progress
				this.inputbox.draw(gr, text_x, cy + 5);
			} else {
				// right side: the item count, or the remove button on the hovered row
				var tail = right;
				if (is_hover && !is_medialib && !dragndrop.moved && this.inputboxID < 0) {
					var bt = pl.bt_remove;
					bt.draw(gr, right - bt.w + zoom(4, g_dpi), cy + Math.floor((ch - bt.h) / 2), 255);
					tail = right - bt.w;
				} else if (cPlaylistManager.showTotalItems) {
					var count = String(plman.PlaylistItemCount(pl.idx));
					var count_w = gr.CalcTextWidth(count, g_font_small);
					gr.GdiDrawText(count, g_font_small, unavailable ? pal.textDisabled : pal.textMuted, right - count_w, cy, count_w, ch, DT_RIGHT | DT_VCENTER | DT_NOPREFIX);
					tail = right - count_w - zoom(8, g_dpi);
				};

				// a Playlist Filter group pattern applies: small dot, filled when
				// the playlist is named in the filter, hollow for the "*" default
				if (pl.filter_type > 0) {
					var d = Math.max(4, zoom(5, g_dpi));
					var dx = tail - d;
					var dy = cy + Math.floor((ch - d) / 2);
					gr.SetSmoothingMode(2);
					if (pl.filter_type == 1) {
						gr.FillEllipse(dx, dy, d, d, pal.textMuted);
					} else {
						gr.DrawEllipse(dx, dy, d - 1, d - 1, 1.0, pal.textMuted);
					};
					gr.SetSmoothingMode(0);
					tail = dx - zoom(6, g_dpi);
				};

				gr.GdiDrawText(pl.name, is_active ? g_font_bold : g_font, unavailable ? pal.textDisabled : pal.text,
					text_x, cy, Math.max(0, tail - text_x), ch, DT_LEFT | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
			};

			// drop position while dragging a playlist to reorder
			if (this.ishoverItem && !cPlaylistManager.vscroll_timer) {
				if (cPlaylistManager.drag_target_id == i && cPlaylistManager.drag_target_id != this.rowTotal &&
					cPlaylistManager.drag_target_id != cPlaylistManager.drag_source_id) {
					var line_h = Math.max(2, zoom(2, g_dpi));
					var line_y = cPlaylistManager.drag_target_id > cPlaylistManager.drag_source_id ? cy + ch - line_h : cy;
					pm_round_fill(gr, rx, line_y, rw, line_h, Math.floor(line_h / 2), accent_colour(255));
				};
			} else {
				cPlaylistManager.drag_target_id = -1;
			};

			row_idx++;
		};

		// ---------------------------------------------------------------- footer
		if (cPlaylistManager.showStatusBar) {
			var fy = this.y + this.h - fh;
			gr.FillSolidRect(px + pad, fy, pw - pad * 2, hair, pal.separator);
			var n = this.playlists.length;
			gr.GdiDrawText(n + (n == 1 ? " playlist" : " playlists"), g_font_small, pal.textMuted, px + pad, fy, pw - pad * 2, fh, DT_RIGHT | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
			this.sortAz_button.draw(gr, px + inset, fy, 255);
			this.sortZa_button.draw(gr, px + inset + this.sortAz_button.w, fy, 255);
		};

		// ---------------------------------------------------------------- scrollbar
		if (this.scrollbarWidth > 0) {
			this.scrollbar.drawXY(gr, this.x - this.woffset + this.w - this.scrollbarWidth, this.y + ch);
		};
	};

	this.isHoverObject = function (x, y) {
		return (x > this.x - this.woffset && x < this.x - this.woffset + this.w - this.scrollbarWidth && y > this.y && y < this.y + this.h);
	};

	this.check = function (event, x, y, delta) {
		this.ishover = this.isHoverObject(x, y);
		this.ishoverHeader = (x > this.x - this.woffset && x < this.x - this.woffset + this.w + this.scrollbarWidth && y > this.y && y <= this.y + cPlaylistManager.rowHeight); //this.ishover && !this.ishoverItem;

		this.ishoverItem = (x > this.x - this.woffset && x < this.x - this.woffset + this.w - this.scrollbarWidth && y > this.y + cPlaylistManager.rowHeight && y < this.y + this.h);
		if (this.ishoverItem) {
			this.hoverId = Math.floor((y - ((this.y + cPlaylistManager.rowHeight) - this.offset * cPlaylistManager.rowHeight)) / cPlaylistManager.rowHeight); // hoverId = row Id in the list
			if (this.hoverId >= this.playlists.length)
				this.hoverId = -1;
		} else {
			this.hoverId = -1;
		};

		if (this.hoverId > -1) {
			if (this.hoverId == this.inputboxID) {
				this.inputbox_ishover = (x > this.inputbox.x - 3 && x < this.inputbox.x + this.inputbox.w + 6 && y > this.inputbox.y && y < this.inputbox.y + this.inputbox.h);
				this.ishover = this.ishover ? (this.inputbox_ishover ? false : true) : false;
			} else {
				this.inputbox_ishover = false;
			};
		};

		switch (event) {
		case "down":
			if (!dragndrop.moved) {

				this.sortAz_button.checkstate(event, x, y);
				this.sortZa_button.checkstate(event, x, y);

				if (this.inputboxID >= 0) {
					this.inputbox.check("down", x, y);
				};
				if (this.hoverId > -1 && this.inputboxID == -1) {

					// check remove button
					if (!(cPlaylistManager.mediaLibraryPlaylist && this.hoverId == 0) && this.playlists[this.hoverId].bt_remove.checkstate(event, x, y) == ButtonStates.down) {
						//
					} else {
						if (plman.ActivePlaylist != this.hoverId) {
							plman.ActivePlaylist = this.hoverId;
							cPlaylistManager.playlist_switch_pending = true;
							window.SetCursor(IDC_WAIT);
						};
						if (cPlaylistManager.visible) {
							// prepare drag item to reorder list
							cPlaylistManager.drag_clicked = true;
							cPlaylistManager.drag_x = x;
							cPlaylistManager.drag_y = y;
							cPlaylistManager.drag_source_id = this.hoverId;
						};
					};

				} else if (this.scrollbar.visible) {
					this.scrollbar.check(event, x, y, delta);
				};
			};
			break;
		case "dblclk":
			this.check("down", x, y);
			break;
		case "right":
			if (this.inputboxID >= 0) {
				this.inputbox.check("right", x, y);
			} else {
				if (this.hoverId > -1 && this.inputboxID == -1) {
					cPlaylistManager.rightClickedId = this.hoverId;
					full_repaint();
					if (!utils.IsKeyPressed(VK_SHIFT)) {
						this.contextMenu(x, y, this.playlists[this.hoverId].idx);
					};
				} else if (this.ishover && this.inputboxID == -1) {
					if (!utils.IsKeyPressed(VK_SHIFT)) {
						this.contextMenu(x, y, null);
					};
				};
			};
			break;
		case "up":
			if (this.inputboxID >= 0) {
				this.inputbox.check("up", x, y);
			} else {
				if (this.scrollbar.visible && !dragndrop.moved)
					this.scrollbar.check(event, x, y, delta);
				if (dragndrop.moved) {
					var drop_done = false;
					// drop possible only if not an autoplaylist and not the active playlist as target
					if (this.hoverId > -1 && this.hoverId < this.playlists.length && !this.playlists[this.hoverId].isAutoPlaylist && !this.playlists[this.hoverId].isReservedPlaylist && this.playlists[this.hoverId].idx != plman.ActivePlaylist) {
						drop_done = true;
						plman.UndoBackup(this.playlists[this.hoverId].idx);
						plman.InsertPlaylistItems(this.playlists[this.hoverId].idx, plman.PlaylistItemCount(this.playlists[this.hoverId].idx), p.list.metadblist_selection, false);
					} else if (this.ishoverHeader) {
						drop_done = true;
						var new_playlist_idx = plman.PlaylistCount;
						plman.CreatePlaylist(new_playlist_idx, "");
						plman.InsertPlaylistItems(new_playlist_idx, 0, p.list.metadblist_selection, false);
					};
					if (drop_done) {
						if (!cPlaylistManager.blink_timer) { // create a timer to blink the playlist item where tracks have been droped!
							cPlaylistManager.blink_x = x;
							cPlaylistManager.blink_y = y;
							cPlaylistManager.blink_totaltracks = p.list.metadblist_selection.Count;
							cPlaylistManager.blink_id = this.hoverId;
							cPlaylistManager.blink_counter = 0;
							cPlaylistManager.blink_timer = window.SetInterval(function () {
									cPlaylistManager.blink_counter++;
									if (cPlaylistManager.blink_counter > (cPlaylistManager.visible ? 5 : 10)) {
										window.ClearInterval(cPlaylistManager.blink_timer);
										cPlaylistManager.blink_timer = false;
										cPlaylistManager.blink_counter = -1;
										cPlaylistManager.blink_id = null;
									};
									full_repaint();
								}, 125);
						};
					};
				} else {
					if (this.sortAz_button.checkstate(event, x, y) == ButtonStates.hover) {
						plman.SortPlaylistsByName(1);
						this.refresh("", false, false, false);
						full_repaint();
					};
					if (this.sortZa_button.checkstate(event, x, y) == ButtonStates.hover) {
						plman.SortPlaylistsByName(-1);
						this.refresh("", false, false, false);
						full_repaint();
					} else {
						// check remove button
						var deb = (cPlaylistManager.mediaLibraryPlaylist ? 1 : 0);
						for (var pl = deb; pl < this.playlists.length; pl++) {
							if (this.playlists[pl].bt_remove.checkstate(event, x, y) == ButtonStates.hover) {
								plman.RemovePlaylistSwitch(pl);
								if (this.offset > 0 && this.offset >= this.playlists.length - Math.floor((this.h - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0)) / cPlaylistManager.rowHeight)) {
									this.offset--;
									this.refresh("", false, false, false);
								};
							};
						};
					};
				};

				// hide playlist manager panel if not visible by default
				if (!cPlaylistManager.visible) {
					if (cPlaylistManager.hscroll_timer) {
						window.ClearTimeout(cPlaylistManager.hscroll_timer);
						cPlaylistManager.hscroll_timer = false;
					};
					if (p.playlistManager.woffset > 0) { // if panel opened
						cPlaylistManager.hscroll_timer = window.SetInterval(function () {
								full_repaint();
								if (!cPlaylistManager.blink_timer) { // we wait the end of the blink timer before colapsing to the right the playlist manager panel
									p.playlistManager.woffset -= cPlaylistManager.step;
								};
								if (p.playlistManager.woffset <= 0) {
									p.playlistManager.woffset = 0;
									cPlaylistManager.hscroll_timer && window.ClearTimeout(cPlaylistManager.hscroll_timer);
									cPlaylistManager.hscroll_timer = false;
									full_repaint();
								};
							}, 16);
					};
				};

				// drop item playlist
				if (cPlaylistManager.drag_target_id > -1) {
					if (cPlaylistManager.drag_target_id == this.rowTotal) {
						plman.MovePlaylist(this.playlists[cPlaylistManager.drag_source_id].idx, this.playlists[this.rowTotal - 1].idx);
					} else {
						cPlaylistManager.drag_droped = (cPlaylistManager.drag_source_id != cPlaylistManager.drag_target_id);
						if (cPlaylistManager.drag_target_id < cPlaylistManager.drag_source_id) {
							plman.MovePlaylist(this.playlists[cPlaylistManager.drag_source_id].idx, this.playlists[cPlaylistManager.drag_target_id].idx);
						} else if (cPlaylistManager.drag_target_id > cPlaylistManager.drag_source_id) {
							plman.MovePlaylist(this.playlists[cPlaylistManager.drag_source_id].idx, this.playlists[cPlaylistManager.drag_target_id].idx);
						};
					};
				};

			};

			if (cPlaylistManager.drag_moved)
				window.SetCursor(IDC_ARROW);

			cPlaylistManager.drag_clicked = false;
			cPlaylistManager.drag_moved = false;
			cPlaylistManager.drag_source_id = -1;
			cPlaylistManager.drag_target_id = -1;
			cPlaylistManager.drag_x = -1;
			cPlaylistManager.drag_y = -1;
			break;
		case "drag_over":
			g_dragndrop_targetPlaylistId = this.hoverId;
			break;
		case "move":
			if (!dragndrop.moved && !cPlaylistManager.drag_clicked) {
				this.sortAz_button.checkstate(event, x, y);
				this.sortZa_button.checkstate(event, x, y);
			};

			if (this.inputboxID >= 0) {
				this.inputbox.check("move", x, y);
			} else {
				if (this.scrollbar.visible && !dragndrop.moved)
					this.scrollbar.check(event, x, y, delta);
				if (cPlaylistManager.drag_moved) {
					if (!this.ishoverHeader) {
						if (this.hoverId > -1 && this.hoverId != cPlaylistManager.drag_source_id) {
							cPlaylistManager.drag_target_id = this.hoverId;
						} else if (y > this.playlists[this.rowTotal - 1].y + cPlaylistManager.rowHeight && y < this.playlists[this.rowTotal - 1].y + cPlaylistManager.rowHeight * 2) {
							cPlaylistManager.drag_target_id = this.rowTotal;
						} else {
							cPlaylistManager.drag_target_id = -1;
						};
					};
				} else {

					// check remove button
					if (!dragndrop.moved) {
						var deb = (cPlaylistManager.mediaLibraryPlaylist ? 1 : 0);
						for (var pl = deb; pl < this.playlists.length; pl++) {
							this.playlists[pl].bt_remove.checkstate(event, x, y);
						};
					};

					if (cPlaylistManager.drag_clicked) {
						cPlaylistManager.drag_moved = true;
					} else {
						if (dragndrop.moved) {
							if (!cPlaylistManager.drag_move_timer) {
								full_repaint();
								cPlaylistManager.drag_move_timer = window.SetTimeout(function () {
										full_repaint();
										window.ClearInterval(cPlaylistManager.drag_move_timer);
										cPlaylistManager.drag_move_timer = false;
									}, 50);
							};
						} else {
							if (cPlaylistManager.drag_move_timer) {
								window.ClearInterval(cPlaylistManager.drag_move_timer);
								cPlaylistManager.drag_move_timer = false;
							};
						};
					};
				};
			};
			break;
		case "wheel":
			if (this.scrollbar.visible && !dragndrop.moved)
				this.scrollbar.check(event, x, y, delta);
			break;
		case "leave":
			var fin = this.playlists.length;
			for (var i = 0; i < fin; i++) {
				this.playlists[i].bt_remove.checkstate(event, 0, 0);
			};
			this.sortAz_button.checkstate(event, 0, 0);
			this.sortZa_button.checkstate(event, 0, 0);
			full_repaint();
			break;
		};
	};

	this.contextMenu = function (x, y, id) {
		var MF_SEPARATOR = 0x00000800;
		var MF_STRING = 0x00000000;
		var _menu = window.CreatePopupMenu();
		var _newplaylist = window.CreatePopupMenu();
		var _autoplaylist = window.CreatePopupMenu();
		var _filters = window.CreatePopupMenu();
		var idx;
		var total_area,
		visible_area;
		var bout,
		z;
		var add_mode = (id == null);

		if (!add_mode) {
			_newplaylist.AppendTo(_menu, MF_STRING, "Insert\u2026");
		} else {
			id = plman.PlaylistCount;
			_newplaylist.AppendTo(_menu, MF_STRING, "Add\u2026");
		};
		_newplaylist.AppendMenuItem(MF_STRING, 100, "New playlist\u2026");
		_newplaylist.AppendMenuItem(MF_STRING, 101, "New autoplaylist\u2026");
		_autoplaylist.AppendTo(_newplaylist, MF_STRING, "Preset autoplaylists");
		_autoplaylist.AppendMenuItem(MF_STRING, 200, "Tracks never played");
		_autoplaylist.AppendMenuItem(MF_STRING, 201, "Tracks played in the last 5 days");
		_autoplaylist.AppendMenuItem(MF_SEPARATOR, 0, "");
		_autoplaylist.AppendMenuItem(MF_STRING, 210, "Tracks unrated");
		_autoplaylist.AppendMenuItem(MF_STRING, 211, "Tracks rated 3 to 5");
		_autoplaylist.AppendMenuItem(MF_STRING, 212, "Tracks rated 4");
		_autoplaylist.AppendMenuItem(MF_STRING, 213, "Tracks rated 5");
		_autoplaylist.AppendMenuItem(MF_STRING, 214, "Loved tracks");
		_menu.AppendMenuItem(MF_SEPARATOR, 0, "");
		_menu.AppendMenuItem(MF_STRING, 2, "Load playlist\u2026");
		if (!add_mode) {
			_menu.AppendMenuItem(MF_STRING, 5, "Duplicate playlist");
			if (id > 0 || !cPlaylistManager.mediaLibraryPlaylist) {
				_menu.AppendMenuItem(MF_STRING, 3, "Rename playlist\u2026");
				_menu.AppendMenuItem(MF_STRING, 8, "Remove playlist");
			};
			if (id > 0 || !cPlaylistManager.mediaLibraryPlaylist) {
				if (plman.IsAutoPlaylist(id)) {
					_menu.AppendMenuItem(MF_SEPARATOR, 0, "");
					_menu.AppendMenuItem(MF_STRING, 6, "Autoplaylist properties\u2026");
					_menu.AppendMenuItem(MF_STRING, 7, "Convert to regular playlist");
				};
			};
		};
		if (!add_mode) {
			if (properties.enablePlaylistFilter) {
				_menu.AppendMenuItem(MF_SEPARATOR, 0, "");
				if (this.playlists[id].filter_type == 1) {
					_filters.AppendTo(_menu, MF_STRING, "Change group playlist filter");
					_filters.AppendMenuItem(MF_STRING, 799, "Remove playlist filter");
					_filters.AppendMenuItem(MF_SEPARATOR, 0, "");
				} else {
					_filters.AppendTo(_menu, MF_STRING, "Set group playlist filter");
				};
				var groupByMenuIdx = 800;
				var totalGroupBy = p.list.groupby.length;
				for (var i = 0; i < totalGroupBy; i++) {
					_filters.AppendMenuItem(MF_STRING, groupByMenuIdx + i, p.list.groupby[i].label);
				};
				if (this.playlists[id].filter_type == 1) {
					_filters.CheckMenuRadioItem(groupByMenuIdx, groupByMenuIdx + totalGroupBy - 1, this.playlists[id].filter_idx + groupByMenuIdx);
				};
			};
		};

		idx = _menu.TrackPopupMenu(x, y);

		switch (true) {
		case (idx == 100):
			var total = plman.PlaylistCount;
			plman.CreatePlaylist(total, "");
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
				id++;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			// set rename it
			this.inputbox = new oInputbox(this.w - this.border - this.scrollbarWidth - (this.text_x_offset || 40) - zoom(12, g_dpi), cPlaylistManager.rowHeight - 10, plman.GetPlaylistName(id), "", this.palette.text, this.palette.input, this.palette.separator, pm_accent(120), "renamePlaylist()", "p.playlistManager", 0, g_font_row_size, 225);
			this.inputboxID = id;
			// activate box content + selection activated
			if (cPlaylistManager.inputbox_timer) {
				window.ClearTimeout(cPlaylistManager.inputbox_timer);
				cPlaylistManager.inputbox_timer = false;
			};
			cPlaylistManager.inputbox_timer = window.SetTimeout(inputboxPlaylistManager_activate, 20);
			break;
		case (idx == 101):
			var total = plman.PlaylistCount;
			plman.CreateAutoPlaylist(total, "", "", "", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
				plman.ShowAutoPlaylistUI(id + 1);
				id++;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
				plman.ShowAutoPlaylistUI(id);
			};
			// set rename it
			this.inputbox = new oInputbox(this.w - this.border - this.scrollbarWidth - (this.text_x_offset || 40) - zoom(12, g_dpi), cPlaylistManager.rowHeight - 10, plman.GetPlaylistName(id), "", this.palette.text, this.palette.input, this.palette.separator, pm_accent(120), "renamePlaylist()", "p.playlistManager", 0, g_font_row_size, 225);
			this.inputboxID = id;
			// activate box content + selection activated
			if (cPlaylistManager.inputbox_timer) {
				window.ClearTimeout(cPlaylistManager.inputbox_timer);
				cPlaylistManager.inputbox_timer = false;
			};
			cPlaylistManager.inputbox_timer = window.SetTimeout(inputboxPlaylistManager_activate, 20);
			break;
		case (idx == 2):
			fb.LoadPlaylist();
			break;
		case (idx == 3):
			// set rename it
			this.inputbox = new oInputbox(this.w - this.border - this.scrollbarWidth - (this.text_x_offset || 40) - zoom(12, g_dpi), cPlaylistManager.rowHeight - 10, plman.GetPlaylistName(id), "", this.palette.text, this.palette.input, this.palette.separator, pm_accent(120), "renamePlaylist()", "p.playlistManager", 0, g_font_row_size, 225);
			this.inputboxID = id;
			// activate box content + selection activated
			if (cPlaylistManager.inputbox_timer) {
				window.ClearTimeout(cPlaylistManager.inputbox_timer);
				cPlaylistManager.inputbox_timer = false;
			};
			cPlaylistManager.inputbox_timer = window.SetTimeout(inputboxPlaylistManager_activate, 20);
			break;
		case (idx == 5):
			plman.DuplicatePlaylist(id, "Copy of " + plman.GetPlaylistName(id));
			plman.ActivePlaylist = id + 1;
			break;
		case (idx == 6):
			plman.ShowAutoPlaylistUI(id);
			break;
		case (idx == 7):
			plman.DuplicatePlaylist(id, plman.GetPlaylistName(id));
			plman.RemovePlaylist(id);
			plman.ActivePlaylist = id;
			break;
		case (idx == 8):
			plman.RemovePlaylistSwitch(id);
			if (this.offset > 0 && this.offset >= this.playlists.length - Math.floor((this.h - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0)) / cPlaylistManager.rowHeight)) {
				this.offset--;
				this.refresh("", false, false, false);
			};
			break;
		case (idx == 200):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks never played", "%play_counter% MISSING", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 201):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks played in the last 5 days", "%last_played% DURING LAST 5 DAYS", "%last_played%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 210):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks unrated", "%rating% MISSING", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 211):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks rated 3 to 5", "%rating% GREATER 2", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 212):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks rated 4", "%rating% IS 4", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 213):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Tracks rated 5", "%rating% IS 5", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 214):
			var total = plman.PlaylistCount;
			p.playlistManager.inputboxID = -1;
			plman.CreateAutoPlaylist(total, "Loved Tracks", "%mood% GREATER 0", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
			if (id == 0 && cPlaylistManager.mediaLibraryPlaylist) {
				plman.MovePlaylist(total, id + 1);
				plman.ActivePlaylist = id + 1;
			} else {
				plman.MovePlaylist(total, id);
				plman.ActivePlaylist = id;
			};
			break;
		case (idx == 799):
			var pl_name = plman.GetPlaylistName(id);

			// Changing the affected pattern
			var old_pl_filter = p.list.groupby[this.playlists[id].filter_idx].playlistFilter;
			var arr = old_pl_filter.split(";");
			if (arr.length == 1) {
				var new_pl_filter = "null";
			} else {
				var new_pl_filter = "";
				// remove the playlist from its actual Playlist Filter
				for (var f = 0; f < arr.length; f++) {
					if (arr[f] != pl_name) {
						// not the playlsit to remove from the Playlist Filter, we keep it
						if (new_pl_filter.length == 0) {
							new_pl_filter = arr[f];
						} else {
							new_pl_filter = new_pl_filter + ";" + arr[f];
						};
					};
				};
			};
			p.list.groupby[this.playlists[id].filter_idx].playlistFilter = new_pl_filter;

			p.list.saveGroupBy();

			// refresh playlist
			p.list.updateHandleList(plman.ActivePlaylist, false);
			p.list.setItems(true);
			p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
			p.playlistManager.refresh("", false, false, false);
			break;
		case (idx >= 800 && idx < 830):
			var pl_name = plman.GetPlaylistName(id);
			var pl_filter = p.list.groupby[idx - groupByMenuIdx].playlistFilter;

			if (this.playlists[id].filter_idx != idx - groupByMenuIdx) {
				if (this.playlists[id].filter_type == 1) {
					// Changing the affected pattern
					var old_pl_filter = p.list.groupby[this.playlists[id].filter_idx].playlistFilter;
					var arr = old_pl_filter.split(";");
					if (arr.length == 1) {
						var new_pl_filter = "null";
					} else {
						var new_pl_filter = "";
						// remove the playlist from its actual Playlist Filter
						for (var f = 0; f < arr.length; f++) {
							if (arr[f] != pl_name) {
								// not the playlsit to remove from the Playlist Filter, we keep it
								if (new_pl_filter.length == 0) {
									new_pl_filter = arr[f];
								} else {
									new_pl_filter = new_pl_filter + ";" + arr[f];
								};
							};
						};
					};
					p.list.groupby[this.playlists[id].filter_idx].playlistFilter = new_pl_filter;
				};

				// setting a pattern
				if (pl_filter.toLowerCase() == "null") {
					p.list.groupby[idx - groupByMenuIdx].playlistFilter = pl_name;
				} else {
					p.list.groupby[idx - groupByMenuIdx].playlistFilter = pl_filter + ";" + pl_name;
				};
			};

			p.list.saveGroupBy();

			// refresh playlist
			p.list.updateHandleList(plman.ActivePlaylist, false);
			p.list.setItems(true);
			p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
			p.playlistManager.refresh("", false, false, false);
			break;
		};
		cPlaylistManager.rightClickedId = null;
		full_repaint();
		return true;
	};
};
