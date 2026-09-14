// *****************************************************************************************************************************************
// Playlist object by Br3tt aka Falstaff (c)2015
// Modified by RivaGe
// *****************************************************************************************************************************************

oGroup = function (index, start, count, total_time_length, focusedTrackId, iscollapsed) {
	this.index = index;
	this.start = start;
	this.count = count;
	this.total_time_length = total_time_length;
	this.total_group_duration_txt = utils.FormatDuration(total_time_length);

	if (count < cGroup.count_minimum) {
		this.rowsToAdd = cGroup.count_minimum - count;
	} else {
		this.rowsToAdd = 0;
	};
	// Add extra rows to the total rows of the group

	if (properties.autocollapse) {
		if (focusedTrackId >= this.start && focusedTrackId < this.start + this.count) { // focused track is in this group!
			this.collapsed = false;
			// save in globals the current group id of the focused track (used for autocollapse option)
			g_group_id_focused = this.index;
		} else {
			this.collapsed = true;
		};
	} else if (iscollapsed) {
		this.collapsed = true;
	} else {
		this.collapsed = false;
	};

	this.totalPreviousRows = 0;

	this.collapse = function () {
		this.collapse = true;
	};

	this.expand = function () {
		this.collapse = false;
	};
};

oItem = function (playlist, row_index, type, handle, track_index, group_index, track_index_in_group, heightInRow, groupRowDelta, obj, empty_row_index) {
	// type 1 = group
	// type 0 = track
	this.type = type;
	this.playlist = playlist;
	this.row_index = row_index;
	this.metadb = handle;
	this.track_index = track_index;
	this.track_index_in_group = track_index_in_group;
	this.group_index = group_index;
	this.heightInRow = heightInRow;
	this.groupRowDelta = groupRowDelta;
	this.obj = obj;
	this.empty_row_index = empty_row_index;
	this.tracktype = TrackType(this.metadb.RawPath.substring(0, 4));
	this.l_rating = 0;
	this.l_mood = 0;
	this.queue_idx = undefined;
	// Cache prepared title-format evaluators and their evaluated text per loaded row/column.
	// Non-playing rows are stable, so their final strings are evaluated once and reused for
	// the lifetime of this oItem. The playing row deliberately bypasses the value cache so
	// dynamic fields (remaining time, bitrate, playback-time expressions, etc.) stay live.
	// oItem objects are rebuilt on scrolling/list refreshes, so this cache is RAM-only and
	// naturally discarded when the visible row set changes.
	this.tf_compile_cache = {};

	this.setGroupMeta = function () {
		if (this.type == 1) {
			if (this.metadb) {
				this.l1 = fb.TitleFormat(p.list.groupby[cGroup.pattern_idx].l1).EvalWithMetadb(this.metadb);
				this.r1 = fb.TitleFormat(p.list.groupby[cGroup.pattern_idx].r1).EvalWithMetadb(this.metadb);
				this.l2 = fb.TitleFormat(p.list.groupby[cGroup.pattern_idx].l2).EvalWithMetadb(this.metadb);
				this.r2 = fb.TitleFormat(p.list.groupby[cGroup.pattern_idx].r2).EvalWithMetadb(this.metadb);
				// (2.6) footer line - title-format, plus %group_tracks% / %group_duration% /
				// %group_index% / %group_total%, resolved against this group (this.obj) and
				// its position (this.group_index), not just the metadb.
				this.l3 = group_template_value(p.list.groupby[cGroup.pattern_idx].l3, this.obj, this.group_index, this.metadb);
				this.r3 = group_template_value(p.list.groupby[cGroup.pattern_idx].r3, this.obj, this.group_index, this.metadb);
			};
		};
	};
	this.setGroupMeta();

	this.evalPreparedColumnTF = function (cacheKey, source, isPlaying) {
		var cached = this.tf_compile_cache[cacheKey];
		if (!cached || cached.source != source) {
			cached = {
				source: source,
				evaluator: fb.TitleFormat(source),
				value: "",
				value_valid: false
			};
			this.tf_compile_cache[cacheKey] = cached;
		};

		// Never cache the playing row's evaluated value: Eval(true) may contain fields
		// that change every playback tick. Its compiled evaluator is still reused.
		if (isPlaying) {
			// Force one fresh non-playing evaluation when this row stops being the
			// playing row. This prevents reusing a value captured before playback.
			cached.value_valid = false;
			return cached.evaluator.Eval(true);
		};

		// For every other visible row, title-format output is stable until this oItem is
		// rebuilt (playlist/metadata/scroll refresh) or the prepared source itself changes.
		if (!cached.value_valid) {
			cached.value = cached.evaluator.EvalWithMetadb(this.metadb);
			cached.value_valid = true;
		};
		return cached.value;
	};

	this.parseTF = function (tf, default_color) {
		var result = Array(tf, default_color);
		var txt = "",
		i = 1,
		tmp = "";
		var pos = tf.indexOf(String.fromCharCode(3));
		if (pos > -1) {
			var tab = tf.split(String.fromCharCode(3));
			var fin = tab.length;
			// if first part is text (not a color)
			if (pos > 0)
				txt = tab[0];
			// get color and other text part
			tmp = tab[1];
			result[1] = eval("0xFF" + tmp.substr(4, 2) + tmp.substr(2, 2) + tmp.substr(0, 2));
			while (i < fin) {
				txt = txt + tab[i + 1];
				i += 2;
			};
			result[0] = txt;
		};
		return result;
	};

	this.drawRowContents = function (gr) {
		// Draw columns content
		var cx,
		cw,
		tf1,
		tf2;
		var is_playing_row = !!this.is_playing_row;
		if (cList.enableExtraLine) {
			// (2.4) configurable gap between the two lines of a row: line 1 moves up by
			// half the gap, line 2 moves down by half, keeping the pair vertically centred.
			var line_gap = zoom(properties.rowLineGap, g_dpi);
			var line_gap_half = Math.round(line_gap / 2);
			var tf1_y = this.y - g_z2 - line_gap_half;
			var tf1_h = Math.floor(this.h / 4 * 3) + cTrack.parity;
			var tf2_y = this.y + Math.ceil(this.h / 2) + cTrack.parity - g_z2 + (line_gap - line_gap_half);
			var tf2_h = Math.ceil(this.h / 2) + cTrack.parity;
		} else {
			var tf1_y = this.y;
			var tf1_h = this.h + cTrack.parity;
			var tf2_y = 0;
			var tf2_h = 0;
		}

		// The card style pulls the row wash in on the right, so a right-aligned last column
		// would otherwise sit on or past the rounded edge. Clamp every column's box to the
		// wash's edge less g_z5; in practice only the last column is ever wide enough to hit it.
		var col_inset = row_highlight_inset();
		var col_right = this.x + this.w - col_inset - g_z5;

		var fin = p.headerBar.columns.length;
		for (var j = 0; j < fin; j++) {
			tf1 = tf2 = null;
			if (p.headerBar.columns[j].w > 0) {
				cx = p.headerBar.columns[j].x + g_z5;
				cw = (Math.abs(p.headerBar.w * p.headerBar.columns[j].percent / 100000)) - g_z10;
				if (col_inset > 0 && cx + cw > col_right) cw = Math.max(0, col_right - cx);
				switch (p.headerBar.columns[j].ref) {
				case "State":
					if (p.headerBar.columns[j].tf == "null") {
						var columnColor = this.text_colour;
					} else {
						if (typeof(this.state_color) == "undefined") {
							this.state_tf = fb.TitleFormat(p.headerBar.columns[j].tf).EvalWithMetadb(this.metadb);
							var stateArray = this.parseTF(this.state_tf, this.text_colour);
							this.state_tf = stateArray[0];
							this.state_color = stateArray[1];
						};
						var columnColor = this.state_color;
					};
					var queue_w = p.list.state_queue_w;
					var icon_w = p.list.state_icon_w;
					switch (p.headerBar.columns[j].align) {
					case 1:
						var icon_x = cx + Math.round((cw / 2) - (queue_w / 2)) - g_z5;
						break;
					case 2:
						var icon_x = Math.floor(cx + cw - queue_w - g_z10);
						break;
					default:
						var icon_x = cx + g_z2;
					};

					// jssp draws the state cell only when there is something to say: the playback
					// glyph on the playing row, or a queue badge when the track is queued.
					// Empty rows stay empty - no "queue slot" placeholder box.
					var state_is_playing = is_playing_row;

					if (state_is_playing) {
						gr.SetTextRenderingHint(4);
						if (ICONS.available()) {
							gr.DrawString(fb.IsPaused ? chars.pause : chars.play, g_font_icon_big, columnColor, icon_x, this.y, icon_w, cTrack.height + cTrack.parity, cc_stringformat);
						} else if (fb.IsPaused) {
							gr.DrawString(String.fromCharCode(127).repeat(2), g_font_pauseicon, columnColor, icon_x, this.y, icon_w, cTrack.height + cTrack.parity, cc_stringformat);
						} else {
							gr.DrawString(String.fromCharCode(g_seconds / 2 == Math.floor(g_seconds / 2) ? 117 : 119), g_font_playicon, columnColor, icon_x, this.y, icon_w, cTrack.height + cTrack.parity, cc_stringformat);
						};
					} else if (this.queue_idx > 0) {
						// queue badge: accent wash + accent outline + the position number
						var badge_x = icon_x - 1;
						var badge_y = this.y + g_z8 - 1;
						var badge_w = queue_w + g_z6 + 2;
						var badge_h = cTrack.height - g_z16 + 2;
						gr.FillSolidRect(badge_x, badge_y, badge_w, badge_h, properties.albumAccentEnabled ? accent_colour(45) : g_color_normal_txt & 0x10ffffff);
						gr.DrawRect(badge_x, badge_y, badge_w - 1, badge_h - 1, 1.0, properties.albumAccentEnabled ? accent_colour(150) : columnColor & 0x77ffffff);
						gr.SetTextRenderingHint(4);
						gr.DrawString(String(this.queue_idx), g_font_queue_idx, columnColor, badge_x, badge_y, badge_w, badge_h, cc_stringformat);
					};
					break;
				case "Loved":
					// (2.10) Loved state is READ from foo_enhanced_playcount (%lfm_loved%) when
					// present, otherwise from the Last.fm sync component, otherwise from
					// foo_playcount's local flag. Nothing is ever written to file tags.
					if (typeof(this.mood) == "undefined") {
						this.mood = parseInt(loved_tf.EvalWithMetadb(this.metadb), 10) || 0;
					};
					columns.mood = true;
					var loved_on = (this.mood != 0);
					var heart_glyph = ICONS.available() ? (loved_on ? chars.heart_on : chars.heart_off) : (g_font_guifx_found ? "v" : String.fromCharCode(60));
					columns.mood_w = gr.CalcTextWidth(heart_glyph, g_font_mood) + zoom(3, g_dpi);
					p.headerBar.columns[j].minWidth = columns.mood_w + zoom(12, g_dpi);
					switch (p.headerBar.columns[j].align) {
					case 1:
						columns.mood_x = cx + Math.floor((cw - columns.mood_w) / 2);
						break;
					case 2:
						columns.mood_x = cx + cw - columns.mood_w;
						break;
					default:
						columns.mood_x = cx;
					};
					// loved hearts use the shared album accent, unloved a low-alpha version of it
					// - unless "Always pink" is on, in which case loved_colour() pins all three
					// strengths to the fixed pink instead. See loved_colour() in main.js.
					if (this.tracktype < 2) {
						if (loved_on) {
							var m_color = loved_colour(255);
						} else if (this.mood_hover) {
							var m_color = loved_colour(120);
						} else {
							var m_color = loved_colour(55);
						};
					} else {
						var m_color = this.text_colour_default & 0x16ffffff;
					};
					gr.SetTextRenderingHint(4);
					gr.DrawString(heart_glyph, g_font_mood, m_color, columns.mood_x, this.y, columns.mood_w, cTrack.height + cTrack.parity, cc_stringformat);
					break;
				case "Rating":
					cw = p.headerBar.columns[j].w - g_z6;
					if (typeof(this.rating) == "undefined") {
						this.rating = fb.TitleFormat(p.headerBar.columns[j].tf).EvalWithMetadb(this.metadb);
						var ratingArray = this.parseTF(this.rating, this.text_colour);
						this.rating = ratingArray[0];
						this.rating_color = ratingArray[1];
					};
					// filled stars take the shared album accent, empty stars a faint version of it
					var star_on_color = this.rating_color;
					var star_off_color = this.text_colour_default & 0x20ffffff;
					if (properties.albumAccentEnabled) {
						star_on_color = accent_colour(255);
						star_off_color = accent_colour(70);
					};
					columns.rating = true;
					var rating_value = Math.round(this.rating) || 0;

					if (ICONS.available()) {
						// ---- jssp rating: five separate Fluent glyphs with a fixed gap ----
						var star_gap = Math.max(1, zoom(2, g_dpi));
						var star_w = gr.CalcTextWidth(chars.rating_off, g_font_rating);
						p.headerBar.columns[j].minWidth = star_w * 5 + star_gap * 4 + zoom(8, g_dpi);
						var star_slot = star_w + star_gap;
						var stars_fit = Math.max(1, Math.min(5, Math.floor((cw - 2 + star_gap) / star_slot)));
						var stars_block = star_slot * stars_fit - star_gap;
						switch (p.headerBar.columns[j].align) {
						case 1:
							columns.rating_x = cx + Math.round((cw - stars_block) / 2);
							break;
						case 2:
							columns.rating_x = cx + cw - stars_block;
							break;
						default:
							columns.rating_x = cx;
						};
						columns.rating_w = stars_block;
						gr.SetTextRenderingHint(4);
						for (var st = 0; st < stars_fit; st++) {
							var filled = st < rating_value;
							gr.DrawString(filled ? chars.rating_on : chars.rating_off, g_font_rating,
								filled ? star_on_color : star_off_color,
								columns.rating_x + st * star_slot, this.y, star_w, cTrack.height + cTrack.parity, cc_stringformat);
						};
					} else {
						// ---- legacy Wingdings / GuiFx path ----
						if (g_font_guifx_found) {
							columns.rating_w = gr.CalcTextWidth("bbbbb", g_font_rating);
						} else {
							columns.rating_w = gr.CalcTextWidth(String.fromCharCode(234).repeat(5), g_font_rating);
						};
						p.headerBar.columns[j].minWidth = columns.rating_w + zoom(7.5, g_dpi);
						var one_star_w = Math.round(columns.rating_w / 5);
						var total_stars_drawable = Math.floor((cw - 2) / one_star_w);
						if (total_stars_drawable > 5)
							total_stars_drawable = 5;
						switch (p.headerBar.columns[j].align) {
						case 1:
							columns.rating_x = cx + 3 + Math.round((cw - 6 - one_star_w * total_stars_drawable) / 2) - 1;
							break;
						case 2:
							columns.rating_x = cx + 3 + cw - 6 - one_star_w * total_stars_drawable;
							break;
						default:
							columns.rating_x = cx - 2 + 3;
						};
						var legacy_star = g_font_guifx_found ? "b" : String.fromCharCode(234);
						var legacy_dy = g_font_guifx_found ? 0 : 3;
						gr.SetTextRenderingHint(3);
						gr.DrawString(legacy_star.repeat(total_stars_drawable), g_font_rating, star_off_color, columns.rating_x - 2, this.y + legacy_dy, cw + 1, cTrack.height + cTrack.parity, lc_stringformat);
						gr.DrawString(legacy_star.repeat(Math.min(rating_value, total_stars_drawable)), g_font_rating, star_on_color, columns.rating_x - 2, this.y + legacy_dy, cw + 1, cTrack.height + cTrack.parity, lc_stringformat);
					};
					break;
				default:
					// ---- text columns ----------------------------------------------------------
					// JSPlaylist supports these special fields on top of standard title formatting:
					// %list_index%, %list_total%, %isplaying%. They are substituted before eval.
					var tf_prep = p.headerBar.columns[j].tf;
					if (tf_prep && tf_prep != "null") {
						tf_prep = prepare_column_tf(tf_prep, this.track_index, is_playing_row);
						try {
							// Eval(true) on the playing row so dynamic fields (bitrate, remaining time)
							// keep updating; EvalWithMetadb everywhere else.
							tf1 = this.evalPreparedColumnTF("1:" + j, tf_prep, is_playing_row);
						} catch (e) {
							tf1 = "";
						};
					} else {
						tf1 = "";
					};
					if (tf1) {
						DrawColoredText(gr, tf1, g_font, this.text_colour, cx, tf1_y, cw, tf1_h,
							p.headerBar.columns[j].DT_align, !this.normalTextColor);
					};

					// second line
					if (cList.enableExtraLine) {
						var tf_prep2 = p.headerBar.columns[j].tf2;
						if (tf_prep2 && tf_prep2 != "null") {
							tf_prep2 = prepare_column_tf(tf_prep2, this.track_index, is_playing_row);
							try {
								tf2 = this.evalPreparedColumnTF("2:" + j, tf_prep2, is_playing_row);
							} catch (e) {
								tf2 = "";
							};
						} else {
							tf2 = "";
						};
						if (tf2) {
							DrawColoredText(gr, tf2, g_font_small, fade_text(this.text_colour, 175), cx, tf2_y, cw, tf2_h,
								p.headerBar.columns[j].DT_align, !this.normalTextColor);
						};
					};
				};
			} else {
				switch (p.headerBar.columns[j].ref) {
				case "Loved":
					columns.mood = false;
					break;
				case "Rating":
					columns.rating = false;
					break;
				};
			};
		};
	};

	this.draw = function (gr, x, y, w, h) {
		this.x = x + 1;
		this.y = y;
		this.w = w - 2;
		this.h = h;
		switch (this.type) {
		case 0:
			// ===============
			// draw track item
			// ===============
			// This state used to be re-queried in several column/row branches.
			this.is_playing_row = !!(fb.IsPlaying && p.list.nowplaying &&
				p.list.nowplaying.PlaylistIndex == this.playlist &&
				this.track_index == p.list.nowplaying.PlaylistItemIndex);
			if (cover.column) {
				cover.w = p.headerBar.columns[0].w;
				cover.h = cover.w;
			} else {
				cover.w = 0;
				cover.h = 0;
			};
			if (this.empty_row_index == 0) {
				if (typeof this.queue_idx == "undefined")
					this.queue_idx = plman.FindPlaybackQueueItemIndex(this.metadb, this.playlist, this.track_index) + 1;
				this.normalTextColor = false;

				// (2.2) UWP-style accent highlight replaces the classic selection boxes.
				if (properties.uwpAccentHighlight) {
					var uwp_playing = this.is_playing_row;
					var uwp_selected = plman.IsPlaylistItemSelected(p.list.playlist, this.track_index);
					var uwp_focused = (p.list.focusedTrackId == this.track_index);
					var uwp_x = this.x + cover.w;
					var uwp_w = this.w - cover.w;

					// odd/even stripes still apply to plain rows
					if (!uwp_selected && !uwp_playing && properties.oddevenrowshighlight) {
						if (properties.showgroupheaders) {
							var uwp_parity = ((this.track_index_in_group / 2) == Math.floor(this.track_index_in_group / 2) ? 1 : 0);
						} else {
							var uwp_parity = ((this.track_index / 2) == Math.floor(this.track_index / 2) ? 1 : 0);
						};
						if (uwp_parity == 0) {
							fill_row_highlight(gr, uwp_x, this.y, uwp_w, this.h, g_color_normal_txt & 0x05ffffff);
						};
					};

					draw_uwp_row_highlight(gr, uwp_x, this.y, uwp_w, this.h, uwp_selected, uwp_focused, uwp_playing);

					// jssp keeps ONE text colour for every row. Selection and playback are
					// communicated by the accent wash and the leading bar, never by recolouring
					// the text, so rows stay legible and $rgb() codes keep working everywhere.
					this.normalTextColor = true;
					this.text_colour = g_color_normal_txt;
				} else
				if (this.is_playing_row) {
					// playing track bg
					if (plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
						if (p.list.focusedTrackId == this.track_index) {
							//**
							gr.FillSolidRect(this.x + cover.w + 2, this.y + 3, this.w - cover.w - 4, this.h - 6, g_color_selected_bg & RGBA(255, 255, 255, properties.selection_rect_alpha));
							// frame on focused item
							gr.DrawRect(this.x + cover.w + 1, this.y + 2, this.w - cover.w - 2, this.h - 4, 2.0, g_color_selected_bg & RGBA(255, 255, 255, properties.focus_rect_alpha));
						} else {
							//**
							gr.FillSolidRect(this.x + cover.w, this.y + 1, this.w - cover.w, this.h - 2, g_color_selected_bg & RGBA(255, 255, 255, properties.selection_rect_alpha));
						};
					} else {
						// if row is focused, draw focused colors & style ELSE draw with normal colors
						if (p.list.focusedTrackId == this.track_index) {
							this.text_colour = blendColors(g_color_highlight, g_color_normal_bg, 0.1);
							// frame on focused item
							gr.DrawRect(this.x + cover.w + 1, this.y + 2, this.w - cover.w - 2, this.h - 4, 2.0, g_color_normal_txt & RGBA(255, 255, 255, properties.focus_rect_alpha));
						} else {
							// draw stripes of the normal row background
							if (properties.oddevenrowshighlight) {
								if (properties.showgroupheaders) {
									var parity = ((this.track_index_in_group / 2) == Math.floor(this.track_index_in_group / 2) ? 1 : 0);
								} else {
									var parity = ((this.track_index / 2) == Math.floor(this.track_index / 2) ? 1 : 0);
								};
								if (parity == 0) {
									fill_row_highlight(gr, this.x + cover.w, this.y, this.w - cover.w, this.h, g_color_normal_txt & 0x05ffffff);
								};
							};
						};
					};
					this.text_colour = p.list.text_colour_playing;
				} else {
					// no playing track bg
					if (plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
						if (p.list.focusedTrackId == this.track_index) {
							//**
							gr.FillSolidRect(this.x + cover.w + 2, this.y + 3, this.w - cover.w - 4, this.h - 6, g_color_selected_bg & RGBA(255, 255, 255, properties.selection_rect_alpha));
							// frame on focused item
							gr.DrawRect(this.x + cover.w + 1, this.y + 2, this.w - cover.w - 2, this.h - 4, 2.0, g_color_selected_bg & RGBA(255, 255, 255, properties.focus_rect_alpha));
						} else {
							//**
							gr.FillSolidRect(this.x + cover.w, this.y + 1, this.w - cover.w, this.h - 2, g_color_selected_bg & RGBA(255, 255, 255, properties.selection_rect_alpha));
						};
						this.text_colour = p.list.text_colour_selected;
					} else {
						// if row is focused, draw focused colors & style ELSE draw with normal colors
						if (p.list.focusedTrackId == this.track_index) {
							// frame on focused item
							gr.DrawRect(this.x + cover.w + 1, this.y + 2, this.w - cover.w - 2, this.h - 4, 2.0, g_color_normal_txt & RGBA(255, 255, 255, properties.focus_rect_alpha));
						} else {
							// draw stripes of the normal row background
							if (properties.oddevenrowshighlight) {
								if (properties.showgroupheaders) {
									var parity = ((this.track_index_in_group / 2) == Math.floor(this.track_index_in_group / 2) ? 1 : 0);
								} else {
									var parity = ((this.track_index / 2) == Math.floor(this.track_index / 2) ? 1 : 0);
								};
								if (parity == 0) {
									fill_row_highlight(gr, this.x + cover.w, this.y, this.w - cover.w, this.h, g_color_normal_txt & 0x05ffffff);
								};
							};
						};
						this.normalTextColor = true;
						this.text_colour = g_color_normal_txt;
					};
				};
			} else {
				/*
				// draw stripes for the empty rows
				var parity = ((this.track_index_in_group / 2) == Math.floor(this.track_index_in_group / 2)? 1 : 0);
				if(parity == 0) {
				gr.FillSolidRect(this.x + cover.w, this.y, this.w - cover.w, this.h, RGBA(000,000,000,5));
				} else {
				gr.FillSolidRect(this.x + cover.w, this.y, this.w - cover.w, this.h, RGBA(255,255,255,5));
				};
				*/
			};

			// now playing track
			if (this.empty_row_index == 0 && this.is_playing_row) {
				p.list.nowplaying_y = this.y;
			};

			// if no group header draw a thin line on the top of the 1st track of the group
			if (cover.column && !properties.showgroupheaders && this.track_index_in_group == 0) {
				gr.FillSolidRect(this.x, this.y, this.w, 1, g_color_normal_txt & 0x18ffffff);
			};

			// Draw Track content
			// ==================
			if (this.empty_row_index == 0) {
				this.text_colour_default = this.text_colour;
				this.drawRowContents(gr);
			};

			// Draw cover art
			// ==============
			if (cover.column) {
				if (this.row_index == 0 && this.track_index_in_group > 0 && this.track_index_in_group <= Math.ceil(cover.h / cTrack.height)) {
					var cover_draw_delta = this.track_index_in_group * cTrack.height;
				} else {
					var cover_draw_delta = 0;
				};
				if ((this.track_index_in_group == 0 || (this.row_index == 0 && cover_draw_delta > 0))) {
					// cover bg
					if (properties.showgroupsheader) {
						var cMargin = Math.max(1, zoom(clamp_int(properties.groupHeaderPadding, 0, 24), g_dpi));
					} else {
						var cMargin = 4;
					};
					var cv_x = Math.floor(this.x + cMargin);
					var cv_y = Math.floor((this.y - cover_draw_delta) + cMargin);
					var cv_w = Math.floor(cover.w - cMargin * 2);
					var cv_h = Math.floor(cover.h - cMargin * 2);

					var groupmetadb = p.list.handleList[p.list.groups[this.group_index].start];
					this.cover_img = g_image_cache.hit(groupmetadb);
					//
					if (typeof this.cover_img != "undefined") {
						if (this.cover_img == null) {
							this.cover_img = g_image_cache.placeholder();
						};
						if (this.cover_img) {
							if (cover.keepaspectratio) {
								// *** check aspect ratio *** //
								if (this.cover_img.Height >= this.cover_img.Width) {
									var ratio = this.cover_img.Width / this.cover_img.Height;
									var pw = cv_w * ratio;
									var ph = cv_h;
									this.left = Math.floor((ph - pw) / 2);
									this.top = 0;
									cv_x += this.left;
									cv_y += this.top;
									cv_w = cv_w - this.left * 2 - 1;
									cv_h = cv_h - this.top * 2 - 1;
								} else {
									var ratio = this.cover_img.Height / this.cover_img.Width;
									var pw = cv_w;
									var ph = cv_h * ratio;
									this.top = Math.floor((pw - ph) / 2);
									this.left = 0;
									cv_x += this.left;
									cv_y += this.top;
									cv_w = cv_w - this.left * 2 - 1;
									cv_h = cv_h - this.top * 2 - 1;
								};
								// *** check aspect ratio *** //
							};

							var cv_r = cover_corner_radius_drawn(this.cover_img, cv_w);
							gr.SetSmoothingMode(2);
							if (cv_r > 0) {
								gr.DrawRoundRect(cv_x + 1, cv_y + 1, cv_w - 2.0, cv_h - 2.0, cv_r, cv_r, 6.0, RGBA(0, 0, 10, 60));
							} else {
								gr.DrawRect(cv_x + 1, cv_y + 1, cv_w - 2.0, cv_h - 2.0, 6.0, RGBA(0, 0, 10, 60));
							};
							gr.SetSmoothingMode(0);
							if (p.headerBar.columns[0].w < cover.max_w) {
								gr.DrawImage(this.cover_img.Resize(cv_w, cv_h, 2), cv_x, cv_y, cv_w, cv_h, 0, 0, cv_w, cv_h);
							} else {
								gr.DrawImage(this.cover_img, cv_x, cv_y, cv_w, cv_h, 0, 0, this.cover_img.Width, this.cover_img.Height);
							};
							if (clamp_int(properties.groupHeaderStyle, 0, 1) == 0) {
								gr.DrawRect(cv_x, cv_y, cv_w, cv_h, 2.0, RGB(255, 255, 255));
							} else if (cv_r > 0) {
								gr.SetSmoothingMode(2);
								gr.DrawRoundRect(cv_x, cv_y, cv_w - 1, cv_h - 1, cv_r, cv_r, 1.0, g_color_normal_txt & 0x30ffffff);
								gr.SetSmoothingMode(0);
							} else {
								gr.DrawRect(cv_x, cv_y, cv_w - 1, cv_h - 1, 1.0, g_color_normal_txt & 0x30ffffff);
							};
						};
					} else {
						gr.DrawImage(images.loading, cv_x - 2, cv_y - 2, cv_w, cv_h, 0, 0, images.loading.Width, images.loading.Height, images.loading_angle, 225);
					};
				};
			};

			// if dragging items, draw line at top of the hover items to show where dragged items will be inserted on mouse button up
			if (!properties.enableTouchControl) {
				if (!cPlaylistManager.hscroll_timer && mouse_x < (p.playlistManager.x - p.playlistManager.woffset) - 30) {
					if (this.empty_row_index == 0) {
						if (dragndrop.drag_in && this.ishover && p.list.ishover) {
							if (p.playlistManager.woffset == 0 || cPlaylistManager.visible) {
								if (!plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
									if (this.track_index > dragndrop.drag_id) {
										gr.FillSolidRect(this.x + cover.w, this.y + this.h - Math.floor(cList.borderWidth / 2), this.w - cover.w, cList.borderWidth, g_color_selected_bg);
										gr.FillSolidRect(this.x + cover.w, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
										gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
										dragndrop.drop_id = this.track_index;
									} else if (this.track_index < dragndrop.drag_id) {
										gr.FillSolidRect(this.x + cover.w, this.y - Math.floor(cList.borderWidth / 2), this.w - cover.w, cList.borderWidth, g_color_selected_bg);
										gr.FillSolidRect(this.x + cover.w, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
										gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
										dragndrop.drop_id = this.track_index;
									};
								} else {
									dragndrop.drop_id = -1;
								};
							};
						};
					};
				};
			};

			if (this.ishover && g_dragndrop_status && g_dragndrop_rowId > -1) {
				if (this.row_index == g_dragndrop_rowId) {
					gr.FillSolidRect(this.x + cover.w, this.y - Math.floor(cList.borderWidth / 2), this.w - cover.w, cList.borderWidth, g_color_selected_bg);
					gr.FillSolidRect(this.x + cover.w, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
					gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
				};
			};

			break;
		case 1:
			// ===============
			// draw group item
			// ===============
			if (this.obj) {
				if (!cover.column || (cover.column && this.obj.collapsed)) {
					if (this.heightInRow > 1 && cover.show) {
						// jssp geometry: the art is inset by the header padding on every side,
						// then scaled by the cover percentage. cover.w is the space it reserves,
						// which is the art plus a padding on each side.
						var gh_pad = Math.max(1, zoom(clamp_int(properties.groupHeaderPadding, 0, 24), g_dpi));
						var gh_h = this.heightInRow * cTrack.height;
						var gh_art = Math.max(1, Math.round(Math.max(1, gh_h - gh_pad * 2) * clamp_int(properties.groupHeaderCoverPercent, 40, 100) / 100));
						cover.h = gh_art + gh_pad * 2;
						cover.w = cover.h;
					} else {
						cover.h = g_z5;
						cover.w = cover.h;
					};
				} else {
					cover.h = g_z4;
					cover.w = cover.h;
				};
			} else {
				cover.h = g_z4;
				cover.w = cover.h;
			};
			var groupDelta = this.groupRowDelta * cTrack.height;

			// ---- GROUP HEADER STYLE (styles 0/1) -------------------------------
			// 0 Classic (default, unchanged), 1 Inset card. Everything the two styles need
			// is resolved once per header here; the paint sites below only read it.
			// gh_accent gates the HEADER's own accent use alone - it never touches
			// properties.albumAccentEnabled or any accent elsewhere in the panel.
			var gh_style = clamp_int(properties.groupHeaderStyle, 0, 1);
			var gh_accent = properties.albumAccentEnabled && properties.groupHeaderAccent;
			var gh_top = this.y - groupDelta;
			var gh_inset_x = (gh_style == 1) ? zoom(8, g_dpi) : 0;
			var gh_inset_y = (gh_style == 1) ? 2 : 0;
			var gh_card_x = this.x + gh_inset_x;
			var gh_card_y = gh_top + gh_inset_y;
			var gh_card_w = Math.max(1, this.w - gh_inset_x * 2);
			var gh_card_h = Math.max(1, this.h - gh_inset_y * 2);
			var gh_bar_w = Math.max(2, zoom(3, g_dpi));
			var gh_bar_colour = gh_accent ? accent_colour(230) : (g_color_normal_txt & 0x78ffffff);
			var gh_tint_factor = Math.min(1.5, clamp_int(properties.accentStrength, 0, 400) / 100);
			// The corner radius is capped by how far the cover art sits inside the card: a
			// square inset d from both edges of a radius-r corner stays clear only while
			// r <= 3.41 * d, and at 100% artwork size with small padding d shrinks to
			// nothing. Deriving it here means no artwork size or padding can clip a corner;
			// at the extreme the card just goes square instead.
			var gh_art_pad = Math.max(1, zoom(clamp_int(properties.groupHeaderPadding, 0, 24), g_dpi));
			var gh_art_gap = Math.min(gh_art_pad, Math.floor((this.h - Math.max(0, cover.w - gh_art_pad * 2)) / 2) - gh_inset_y);
			var gh_radius = (gh_style == 1)
				? Math.max(1, Math.min(zoom(10, g_dpi), Math.floor(gh_art_gap * 3.41), Math.floor(gh_card_w / 2), Math.floor(gh_card_h / 2)))
				: 0;

			// group header bg
			// Subtly tinted with the shared album accent, like jssp: the background is blended
			// 12% towards the accent, with a faint accent hairline around the block.
			if (gh_style == 0) {
				if (gh_accent) {
					var gh_tint = blendColors(g_color_normal_bg, AlbumAccent.colour, 0.12 * gh_tint_factor);
					gr.FillSolidRect(this.x, gh_top, this.w, 1, accent_colour(160));
					gr.FillSolidRect(this.x, gh_top + 1, this.w, this.h - 2, gh_tint & 0xdaffffff);   // alpha 218, matches jssp
					gr.DrawRect(this.x, gh_top, this.w - 1, this.h - 1, 1.0, accent_colour(90));
					// collapsed groups get the same leading accent bar the rows use
					if (this.obj && this.obj.collapsed) {
						gr.FillSolidRect(this.x, gh_top + 1, gh_bar_w, this.h - 2, accent_colour(230));
					};
				} else {
					gr.FillSolidRect(this.x, gh_top, this.w, 1, g_color_normal_txt & 0x10ffffff);
					gr.FillSolidRect(this.x, gh_top + 1, this.w, this.h - 2, g_color_normal_txt & 0x04ffffff);
				};
			} else {
				// Inset card: a glass pane stepped in from the row edge. Neutral it is mostly
				// rim over a barely-there fill; with the accent on, the tint is pushed hard
				// enough to actually read as a colour, and the rim takes it too.
				var gh_fill = gh_accent
					? (blendColors(g_color_normal_bg, AlbumAccent.colour, 0.32 * gh_tint_factor) & 0x72ffffff)
					: (g_color_normal_txt & 0x2cffffff);
				var gh_rim = gh_accent ? accent_colour(120) : (g_color_normal_txt & 0x2affffff);
				gr.SetSmoothingMode(2);
				gr.FillRoundRect(gh_card_x, gh_card_y, gh_card_w, gh_card_h, gh_radius, gh_radius, gh_fill);
				gr.DrawRoundRect(gh_card_x, gh_card_y, gh_card_w - 1, gh_card_h - 1, gh_radius, gh_radius, 1.0, gh_rim);
				gr.SetSmoothingMode(0);
				// No separate top-edge highlight: the antialiased rim already lights that row,
				// and a second line one pixel away just reads as a doubled border.
				if (this.obj && this.obj.collapsed) {
					gr.FillSolidRect(gh_card_x, gh_card_y + gh_radius, gh_bar_w, Math.max(1, gh_card_h - gh_radius * 2), gh_bar_colour);
				};
			};

			// draw group text infos
			// (2.7) configurable inner padding and line gap
			var text_left_padding = gh_art_pad;
			var header_line_gap = zoom(clamp_int(properties.groupHeaderLineGap, -8, 24), g_dpi);
			// Reserve the scrollbar's width when it is actually on screen. This was inverted,
			// which is why the right-hand header fields were clipped by the scrollbar.
			var scrollbar_gape = (p.scrollbar.visible && (p.list.totalRows > p.list.totalRowVisible)) ? cScrollBar.width : 0;

			// jssp: title at full strength, detail at alpha 218, footer at alpha 170.
			// The now-playing group is not recoloured - the accent tint already marks it.
			this.l1_color = g_color_normal_txt;
			this.l2_color = fade_text(g_color_normal_txt, 218);
			var gh_footer_colour = fade_text(this.l1_color, 170);
			// the rule above the footer line is accent-coloured in the card style; with the
			// header accent off it falls back to the configurable Footer line alpha
			var line_color = (gh_style == 1 && gh_accent) ? accent_colour(170) : p.list.line_color;

			// Draw Header content
			// ===================
			switch (this.heightInRow) {
			case 1:
				var lg1_right_field_w = gr.CalcTextWidth(this.r1, g_font_group1) + cList.borderWidth * 2;
				var gh1_text_x = this.x + gh_inset_x + cover.w + text_left_padding;
				var gh1_avail_w = this.w - gh_inset_x * 2 - cover.w - scrollbar_gape;
				gr.GdiDrawText(this.l1 + " / " + this.l2, g_font_group1, this.l1_color, gh1_text_x, gh_top - 1, gh1_avail_w - text_left_padding * 4 - lg1_right_field_w, this.h, DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
				gr.GdiDrawText(this.r1, g_font_group1, this.l1_color, gh1_text_x, gh_top - 1, gh1_avail_w - text_left_padding * 5 + 2, this.h, DT_RIGHT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
				gr.FillSolidRect(gh1_text_x, Math.round(gh_top + cTrack.height - 5), gh1_avail_w - text_left_padding * 5 + 2, 1.0, line_color);
				break;
				default:
					// ---- jssp 3-line header ----------------------------------------------------
					// The three lines are packed into equal thirds of the content box (header height
					// minus padding) and the block is centred vertically, instead of giving each line
					// a whole track row. That is what makes jssp headers compact.
					var gh_text_x = this.x + gh_inset_x + cover.w + text_left_padding;
					var gh_text_w = Math.max(0, this.w - gh_inset_x * 2 - cover.w - text_left_padding * 2 - scrollbar_gape);
					var gh_content_h = Math.max(3, this.h - text_left_padding * 2);
					var gh_line_h = Math.max(zoom(10, g_dpi), Math.floor((gh_content_h - header_line_gap * 2) / 3));
					var gh_block_h = gh_line_h * 3 + header_line_gap * 2;
					var gh_line_y = gh_top + Math.floor((this.h - gh_block_h) / 2);

					// line 1 - title
					var gh_r1_w = gr.CalcTextWidth(this.r1, g_font_group1) + cList.borderWidth * 2;
					gr.GdiDrawText(this.l1, g_font_group1, this.l1_color, gh_text_x, gh_line_y, Math.max(0, gh_text_w - gh_r1_w - zoom(8, g_dpi)), gh_line_h, DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
					gr.GdiDrawText(this.r1, g_font_group1, this.l1_color, gh_text_x, gh_line_y, gh_text_w, gh_line_h, DT_RIGHT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);

					// line 2 - detail
					gh_line_y += gh_line_h + header_line_gap;
					var gh_r2_w = gr.CalcTextWidth(this.r2, g_font_group2) + cList.borderWidth * 2;
					gr.GdiDrawText(this.l2, g_font_group2, this.l2_color, gh_text_x, gh_line_y, Math.max(0, gh_text_w - gh_r2_w - zoom(8, g_dpi)), gh_line_h, DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
					gr.GdiDrawText(this.r2, g_font_group2, this.l2_color, gh_text_x, gh_line_y, gh_text_w, gh_line_h, DT_RIGHT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);

					// line 3 - footer, with a hairline above it
					// (2.6) title-format, evaluated once per group in setGroupMeta() -> this.l3/this.r3
					gh_line_y += gh_line_h + header_line_gap;
					gr.FillSolidRect(gh_text_x, gh_line_y, gh_text_w, 1.0, line_color);
					var lg3_left_field = this.l3 || "";
					var lg3_right_field = this.r3 || "";
					var lg3_right_field_w = gr.CalcTextWidth(lg3_right_field, g_font_group_footer) + cList.borderWidth * 2;
					gr.GdiDrawText(lg3_left_field, g_font_group_footer, gh_footer_colour, gh_text_x, gh_line_y, Math.max(0, gh_text_w - lg3_right_field_w - zoom(8, g_dpi)), gh_line_h, DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
					gr.GdiDrawText(lg3_right_field, g_font_group_footer, gh_footer_colour, gh_text_x, gh_line_y, gh_text_w, gh_line_h, DT_RIGHT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
			};

			// highlight group that contains a selected track
			var now_playing_found = false;
			if (this.obj) {
				for (var k = 0; k < this.obj.count; k++) {
					if (plman.IsPlaylistItemSelected(p.list.playlist, this.obj.start + k) && this.obj.collapsed) {
						if (gh_style == 1) {
							gr.SetSmoothingMode(2);
							gr.FillRoundRect(gh_card_x, gh_card_y, gh_card_w, gh_card_h, gh_radius, gh_radius,
								gh_accent ? accent_colour(55) : g_color_selected_bg & 0x20ffffff);
							gr.SetSmoothingMode(0);
						} else {
							gr.FillSolidRect(this.x, gh_top + 1, this.w, this.h - 2,
								gh_accent ? accent_colour(55) : g_color_selected_bg & 0x20ffffff);
						};
						break;
					} else {
						// highlight the now playing group header
						if (fb.IsPlaying) {
							if (p.list.nowplaying && p.list.nowplaying.PlaylistIndex == this.playlist) {
								if (!now_playing_found && p.list.nowplaying.PlaylistItemIndex >= this.obj.start && p.list.nowplaying.PlaylistItemIndex < this.obj.start + this.obj.count && this.obj.collapsed) {
									if (gh_style == 1) {
										gr.SetSmoothingMode(2);
										gr.FillRoundRect(gh_card_x, gh_card_y, gh_card_w, gh_card_h, gh_radius, gh_radius,
											gh_accent ? accent_colour(45) : g_color_highlight & 0x16ffffff);
										gr.SetSmoothingMode(0);
									} else {
										gr.FillSolidRect(this.x, gh_top + 1, this.w, this.h - 2,
											gh_accent ? accent_colour(45) : g_color_highlight & 0x16ffffff);
									};
									now_playing_found = true;
								};
							};
						};
					};
				};
			};

			// Draw cover art
			// ==============
			if (this.obj) {
				if (!cover.column || (cover.column && this.obj.collapsed)) {
					if (this.heightInRow > 1 && cover.show) {
						// cover bg
						// inset by the header padding on every side, vertically centred in the
						// header - jssp's art_x / art_y / art_size
						var gh_pad2 = gh_art_pad;
						var cv_w = Math.floor(cover.w - gh_pad2 * 2);
						var cv_h = cv_w;
						var cv_x = Math.floor(this.x + gh_inset_x + gh_pad2);
						var cv_y = Math.floor(gh_top + (this.h - cv_h) / 2);
						//
						this.cover_img = g_image_cache.hit(this.metadb);
						//
						if (typeof this.cover_img != "undefined") {
							if (this.cover_img == null) {
								this.cover_img = g_image_cache.placeholder();
							};
							if (this.cover_img) {
								if (cover.keepaspectratio) {
									// *** check aspect ratio *** //
									if (this.cover_img.Height >= this.cover_img.Width) {
										var ratio = this.cover_img.Width / this.cover_img.Height;
										var pw = cv_w * ratio;
										var ph = cv_h;
										this.left = Math.floor((ph - pw) / 2);
										this.top = 0;
										cv_x += this.left;
										cv_y += this.top;
										cv_w = cv_w - this.left * 2 - 1;
										cv_h = cv_h - this.top * 2 - 1;
									} else {
										var ratio = this.cover_img.Height / this.cover_img.Width;
										var pw = cv_w;
										var ph = cv_h * ratio;
										this.top = Math.floor((pw - ph) / 2);
										this.left = 0;
										cv_x += this.left;
										cv_y += this.top;
										cv_w = cv_w - this.left * 2 - 1;
										cv_h = cv_h - this.top * 2 - 1;
									};
									// *** check aspect ratio *** //
								};

								var cv_r = cover_corner_radius_drawn(this.cover_img, cv_w);
								gr.SetSmoothingMode(2);
								if (cv_r > 0) {
									gr.DrawRoundRect(cv_x + 1, cv_y + 1, cv_w - 2.0, cv_h - 2.0, cv_r, cv_r, 6.0, RGBA(0, 0, 10, 60));
								} else {
									gr.DrawRect(cv_x + 1, cv_y + 1, cv_w - 2.0, cv_h - 2.0, 6.0, RGBA(0, 0, 10, 60));
								};
								gr.SetSmoothingMode(0);
								if (this.obj.collapsed) {
									gr.DrawImage(this.cover_img.Resize(cv_w, cv_h, 2), cv_x, cv_y, cv_w, cv_h, 0, 0, cv_w, cv_h);
								} else {
									gr.DrawImage(this.cover_img, cv_x, cv_y, cv_w, cv_h, 0, 0, this.cover_img.Width, this.cover_img.Height);
								};
								if (gh_style == 0) {
									gr.DrawRect(cv_x, cv_y, cv_w, cv_h, 2.0, RGB(255, 255, 255));
								} else if (cv_r > 0) {
									gr.SetSmoothingMode(2);
									gr.DrawRoundRect(cv_x, cv_y, cv_w - 1, cv_h - 1, cv_r, cv_r, 1.0, g_color_normal_txt & 0x30ffffff);
									gr.SetSmoothingMode(0);
								} else {
									gr.DrawRect(cv_x, cv_y, cv_w - 1, cv_h - 1, 1.0, g_color_normal_txt & 0x30ffffff);
								};
							};
						} else {
							gr.DrawImage(images.loading, cv_x - 2, cv_y - 2, cv_w, cv_h, 0, 0, images.loading.Width, images.loading.Height, images.loading_angle, 225);
						};
					};
				};
			};

			// if dragging items, draw line at top of the hover items to show where dragged items will be inserted on mouse button up
			if (this.obj) {
				if (!properties.enableTouchControl) {
					if (!cPlaylistManager.hscroll_timer && mouse_x < (p.playlistManager.x - p.playlistManager.woffset) - 30) {
						if (dragndrop.drag_in && this.ishover && p.list.ishover) {
							if (p.playlistManager.woffset == 0 || cPlaylistManager.visible) {
								if (!plman.IsPlaylistItemSelected(plman.ActivePlaylist, this.track_index)) {
									var cover_w = (p.headerBar.columns[0].percent > 0 ? p.headerBar.columns[0].w : 0);
									if (this.track_index <= dragndrop.drag_id) {
										if (this.groupRowDelta == 0) {
											gr.FillSolidRect(this.x + cover_w, this.y - Math.floor(cList.borderWidth / 2), this.w - cover_w, cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + cover_w, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
										}
										if (this.obj.collapsed) {
											dragndrop.drop_id = this.track_index;
										} else {
											dragndrop.drop_id = this.track_index;
										};
									} else {
										if (this.obj.collapsed) {
											gr.FillSolidRect(this.x + cover_w, this.y + this.h - Math.floor(cList.borderWidth / 2), this.w - cover_w, cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + cover_w, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
											dragndrop.drop_id = this.track_index + this.obj.count - 1;
										} else {
											gr.FillSolidRect(this.x + cover_w, this.y + this.h - Math.floor(cList.borderWidth / 2), this.w - cover_w, cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + cover_w, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
											gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y + this.h - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
											dragndrop.drop_id = this.track_index - 1;
										};
									};
								} else {
									dragndrop.drop_id = -1;
								};
							};
						};
					};
				};
			};

			if (this.ishover && g_dragndrop_status && g_dragndrop_rowId > -1) {
				if (this.row_index == g_dragndrop_rowId) {
					gr.FillSolidRect(this.x + cover.w * 0, this.y - Math.floor(cList.borderWidth / 2), this.w - cover.w * 0, cList.borderWidth, g_color_selected_bg);
					gr.FillSolidRect(this.x + cover.w * 0, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
					gr.FillSolidRect(this.x + this.w - cList.borderWidth, this.y - Math.floor(cList.borderWidth / 2) - 3 * cList.borderWidth, cList.borderWidth, 7 * cList.borderWidth, g_color_selected_bg);
				};
			};
			break;
		};
	};

	this.dragndrop_check = function (x, y, id) {
		var groupDelta = this.groupRowDelta * cTrack.height;
		var col_cover_w = (p.headerBar.columns[0].percent > 0 ? p.headerBar.columns[0].w : 0);
		this.ishover = (x >= this.x + col_cover_w && x < this.x + this.w && y >= this.y && y < this.y + this.h - groupDelta);
		if (this.ishover) { // p.list.count is mandatory > 0 (if not with couldn't be in Item section)
			var trackId = p.list.getTrackId(this.row_index);
			g_dragndrop_trackId = this.track_index;
			g_dragndrop_rowId = this.row_index;
		};
	};

	this.check = function (event, x, y) {
		var groupDelta = this.groupRowDelta * cTrack.height;
		var col_cover_w = (p.headerBar.columns[0].percent > 0 ? p.headerBar.columns[0].w : 0);
		this.ishover = (x >= this.x + col_cover_w && x < this.x + this.w && y >= this.y && y < this.y + this.h - groupDelta);

		var prev_rating_hover = this.rating_hover;
		var prev_l_rating = this.l_rating;
		var prev_mood_hover = this.mood_hover;
		var prev_l_mood = this.l_mood;
		this.rating_hover = (this.type == 0 && this.empty_row_index == 0 && x >= columns.rating_x && x <= columns.rating_x + columns.rating_w && y > this.y + 2 && y < this.y + this.h - 2);
		this.mood_hover = (this.type == 0 && this.empty_row_index == 0 && x >= columns.mood_x && x <= columns.mood_x + columns.mood_w - 3 && y > this.y + 2 && y < this.y + this.h - 2);

		switch (event) {
		case "down":
			if (this.ishover) {
				if (cTouch.down) {
					cTouch.down_id = this.track_index;
				};
				if (!cTouch.down || (cTouch.down && cTouch.down_id == cTouch.up_id)) {
					p.list.item_clicked = true;
					if (this.type == 1) { // group header
						if (utils.IsKeyPressed(VK_SHIFT)) {
							if (this.obj && p.list.focusedTrackId != this.track_index) {
								if (p.list.SHIFT_start_id != null) {
									p.list.selectAtoB(p.list.SHIFT_start_id, this.track_index + this.obj.count - 1);
								} else {
									p.list.selectAtoB(p.list.focusedTrackId, this.track_index + this.obj.count - 1);
								};
							};
						} else if (utils.IsKeyPressed(VK_CONTROL)) {
							plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
							p.list.selectGroupTracks(this.group_index, true);
							p.list.SHIFT_start_id = null;
						} else {
							plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
							plman.ClearPlaylistSelection(p.list.playlist);
							if (this.obj) {
								if ((properties.autocollapse && !this.obj.collapsed) || !properties.autocollapse) {
									p.list.selectGroupTracks(this.group_index, true);
								};
							};
							p.list.SHIFT_start_id = null;
							if (p.list.metadblist_selection.Count >= 1) {
								dragndrop.clicked = true;
								dragndrop.moved = false;
								dragndrop.x = x;
								dragndrop.y = y;
								dragndrop.drag_id = this.track_index;
								dragndrop.timerID = window.SetTimeout(function () {
									dragndrop.drag_in = dragndrop.enabled; // internal reorder removed
									dragndrop.timerID && window.ClearTimeout(dragndrop.timerID);
									dragndrop.timerID = false;
								}, 250);
							};
						};
						if (this.obj && properties.autocollapse) {
							if (this.obj.collapsed) {
								p.list.updateGroupStatus(this.group_index);
								//**
								//p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
								full_repaint();
							};
						};
						p.list.metadblist_selection = plman.GetPlaylistSelectedItems(p.list.playlist);
					} else { // track
						if (this.rating_hover) {
							columns.rating_drag = true;
						} else if (this.mood_hover) {
							columns.mood_drag = true;
						} else {
							if (plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
								if (p.list.metadblist_selection.Count >= 1) {
									dragndrop.clicked = true;
									dragndrop.moved = false;
									dragndrop.x = x;
									dragndrop.y = y;
									if (p.list.metadblist_selection.Count > 1) {
										// test if selection is contigus, if not, drag'n drop disable
										var first_item_selected_id = p.list.handleList.Find(p.list.metadblist_selection[0]);
										var last_item_selected_id = p.list.handleList.Find(p.list.metadblist_selection[p.list.metadblist_selection.Count - 1]);
										var contigus_count = (last_item_selected_id - first_item_selected_id) + 1;
									} else {
										var contigus_count = 0;
									};
									if (p.list.metadblist_selection.Count == 1 || (p.list.metadblist_selection.Count > 1 && p.list.metadblist_selection.Count == contigus_count)) {
										dragndrop.contigus_sel = true;
										dragndrop.drag_id = this.track_index;
										dragndrop.timerID = window.SetTimeout(function () {
											dragndrop.drag_in = dragndrop.enabled; // internal reorder removed
											dragndrop.timerID && window.ClearTimeout(dragndrop.timerID);
											dragndrop.timerID = false;
										}, 250);
									} else if (p.list.metadblist_selection.Count > 1) {
										dragndrop.contigus_sel = false;
										dragndrop.drag_id = this.track_index;
										dragndrop.timerID = window.SetTimeout(function () {
											dragndrop.drag_in = dragndrop.enabled; // internal reorder removed
											dragndrop.timerID && window.ClearTimeout(dragndrop.timerID);
											dragndrop.timerID = false;
										}, 250);
									};
								};
								if (utils.IsKeyPressed(VK_SHIFT)) {
									if (p.list.focusedTrackId != this.track_index) {
										if (p.list.SHIFT_start_id != null) {
											p.list.selectAtoB(p.list.SHIFT_start_id, this.track_index);
										} else {
											p.list.selectAtoB(p.list.focusedTrackId, this.track_index);
										};
									};
								} else if (utils.IsKeyPressed(VK_CONTROL)) {
									plman.SetPlaylistSelectionSingle(p.list.playlist, this.track_index, false);
									//};
								} else if (p.list.metadblist_selection.Count == 1) {
									plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
									plman.ClearPlaylistSelection(p.list.playlist);
									plman.SetPlaylistSelectionSingle(p.list.playlist, this.track_index, true);
								};
							} else { // click on a not selected track
								if (utils.IsKeyPressed(VK_SHIFT)) {
									if (p.list.focusedTrackId != this.track_index) {
										if (p.list.SHIFT_start_id != null) {
											p.list.selectAtoB(p.list.SHIFT_start_id, this.track_index);
										} else {
											p.list.selectAtoB(p.list.focusedTrackId, this.track_index);
										};
									};
								} else {
									if (!properties.enableTouchControl) {
										p.list.selX = x;
										p.list.selY = y;
										p.list.drawRectSel_click = true;
										p.list.selStartId = this.track_index;
										p.list.selStartOffset = p.list.offset;
										p.list.selEndOffset = p.list.offset;
										p.list.selDeltaRows = 0;
										p.list.selAffected.splice(0, p.list.selAffected.length);
									};
									plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
									if (!utils.IsKeyPressed(VK_CONTROL)) {
										plman.ClearPlaylistSelection(p.list.playlist);
									};
									plman.SetPlaylistSelectionSingle(p.list.playlist, this.track_index, true);
									p.list.SHIFT_start_id = null;
								};
							};
							p.list.metadblist_selection = plman.GetPlaylistSelectedItems(p.list.playlist);
						};
					};
				};
			};
			break;
		case "dblclk":
			if (this.ishover) {
				if (this.type == 1) { // group header
					if (properties.autocollapse) {
						/*
						if(this.obj) {
						if(this.obj.collapsed) {
						p.list.updateGroupStatus(this.group_index);
						} else {
						p.list.updateGroupsOnCollapse(this.group_index);
						};
						};
						*/
					} else {
						if (this.obj) {
							if (this.obj.collapsed) {
								p.list.updateGroupsOnExpand(this.group_index);
							} else {
								p.list.updateGroupsOnCollapse(this.group_index);
							};
						};
					};
					p.list.setItems(false);
					//**p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
					full_repaint();
				} else { // track
					var cmd = properties.defaultPlaylistItemAction;
					if (cmd == "Play") {
						plman.ExecutePlaylistDefaultAction(p.list.playlist, this.track_index);
					} else {
						fb.RunContextCommandWithMetadb(cmd, this.metadb, 0);
					};
				};
			};
			break;
		case "up":
			if (this.ishover) {
				if (cTouch.down) {
					cTouch.up_id = this.track_index;
					if (cTouch.down_id == cTouch.up_id) {
						this.check("down", x, y);
					};
				};
				if (!cTouch.down || (cTouch.down && cTouch.down_id == cTouch.up_id)) {
					if (this.rating_hover) {
						// Rating
						// Written to whichever local backend the global "Playback
						// statistics field source" setting currently selects -
						// foo_playcount's Playback Statistics, or the separate
						// Playcount 2003 component. See ratingCanWrite()/
						// writeRatingCommand() in main.js. The old tag-writing
						// fallback has been removed.
						if (this.tracktype < 2 && ratingCanWrite()) {
							if (this.l_rating != this.rating) {
								if (this.metadb) {
									writeRatingCommand(this.metadb, this.l_rating);
									this.rating = this.l_rating;
								};
							} else {
								writeRatingCommand(this.metadb, 0);
								this.rating = 0;
							};
						};
					} else if (this.mood_hover) {
						// (2.10) Loved toggle. Loves/unloves locally AND on Last.fm via the
						// components' own context commands. No tag writing, ever.
						if (this.tracktype < 2 && loved_can_write()) {
							var was_loved = (this.mood != 0);
							toggle_loved(this.metadb, was_loved);
							// optimistic repaint; the real value is re-read on the next metadb change
							this.mood = was_loved ? 0 : 1;
							full_repaint();
						};
					} else if (!cTouch.down) {
						if (!p.list.drawRectSel && plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
							if (!utils.IsKeyPressed(VK_SHIFT) && !utils.IsKeyPressed(VK_CONTROL)) {
								if (!dragndrop.drag_in) {
									if (this.type == 0) { // track
										plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
										plman.ClearPlaylistSelection(p.list.playlist);
										plman.SetPlaylistSelectionSingle(p.list.playlist, this.track_index, true);
									};
								};
							};
						};
					};
				};
			};
			this.drawRectSel_click = false;
			this.drawRectSel = false;
			dragndrop.clicked = false;
			dragndrop.moved = false;
			columns.rating_drag = false;
			columns.mood_drag = false;
			break;
		case "right":
			if (this.ishover) {
				if (this.type == 1) { // group header
					if (!plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {
						plman.ClearPlaylistSelection(p.list.playlist);
						plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
						p.list.selectGroupTracks(this.group_index, true);
						p.list.SHIFT_start_id = null;
					};
					p.list.contextMenu(x, y, this.track_index, this.row_index);
				} else { // track
					if (this.rating_hover) {}
					else if (this.mood_hover) {}
					else {
						if (plman.IsPlaylistItemSelected(p.list.playlist, this.track_index)) {}
						else {
							plman.SetPlaylistFocusItem(p.list.playlist, this.track_index);
							plman.ClearPlaylistSelection(p.list.playlist);
							plman.SetPlaylistSelectionSingle(p.list.playlist, this.track_index, true);
						};
						p.list.contextMenu(x, y, this.track_index, this.row_index);
					};
				};
			};
			break;
		case "move":
			if (columns.rating && !columns.rating_drag) {
				if (this.rating_hover) {
					var one_star_w = Math.round(columns.rating_w / 5);
					this.l_rating = Math.floor((x - columns.rating_x) / one_star_w) + 1;
					if (this.l_rating > 5)
						this.l_rating = 5;
				} else {
					this.l_rating = 0;
				};
			};
			if (columns.mood && !columns.mood_drag) {
				if (this.mood_hover) {
					this.l_mood = 1;
				} else {
					this.l_mood = 0;
				};
			};
			// update tooltip text
			if (this.tooltip && this.ishover) {
				g_tooltip_txt = this.title;
			};

			// update on mouse move to draw rect selection zone
			if (!this.drawRectSel) {
				this.drawRectSel = this.drawRectSel_click;
			};
			if (p.list.drawRectSel) {
				if (this.ishover) {
					if (this.type == 0) { // track
						p.list.selEndId = this.track_index;
					} else { // group header
						if (this.track_index > 0) {
							if (y > p.list.selY) {
								if (p.list.selStartId <= p.list.selEndId) {
									if (this.track_index == this.track_index + 1) {
										p.list.selEndId = this.track_index - 0;
									} else {
										p.list.selEndId = this.track_index - 1;
									};
								} else {
									if (this.track_index == this.track_index + 1) {
										p.list.selEndId = this.track_index - 1;
									} else {
										p.list.selEndId = this.track_index - 0;
									};
								};
							} else {
								if (p.list.selStartId < p.list.selEndId) {
									if (this.track_index == this.track_index + 1) {
										p.list.selEndId = this.track_index - 0;
									} else {
										p.list.selEndId = this.track_index - 1;
									};
								} else {
									if (this.track_index == this.track_index + 1) {
										p.list.selEndId = this.track_index - 1;
									} else {
										p.list.selEndId = this.track_index - 0;
									};
								};
							};
						};
					};

					if (!cList.repaint_timer) {
						window.SetCursor(IDC_HAND);
						cList.repaint_timer = window.SetInterval(function () {
								if (mouse_y < p.list.y + cTrack.height * 0) {
									p.list.selEndId = p.list.selEndId > 0 ? p.list.items[0].track_index : 0;
									if (p.scrollbar.visible)
										on_mouse_wheel(1);
								} else if (mouse_y > p.list.y + p.list.h - cTrack.height * 0) {
									p.list.selEndId = p.list.selEndId < p.list.count - 1 ? p.list.items[p.list.items.length - 1].track_index : p.list.count - 1;
									if (p.scrollbar.visible)
										on_mouse_wheel(-1);
								};
								// set selection on items in the rect area drawn
								plman.SetPlaylistSelection(p.list.playlist, p.list.selAffected, false);
								p.list.selAffected.splice(0, p.list.selAffected.length);
								var deb = p.list.selStartId <= p.list.selEndId ? p.list.selStartId : p.list.selEndId;
								var fin = p.list.selStartId <= p.list.selEndId ? p.list.selEndId : p.list.selStartId;
								for (var i = deb; i <= fin; i++) {
									p.list.selAffected.push(i);
								};
								plman.SetPlaylistSelection(p.list.playlist, p.list.selAffected, true);
								p.list.metadblist_selection = plman.GetPlaylistSelectedItems(p.list.playlist);
								plman.SetPlaylistFocusItem(p.list.playlist, p.list.selEndId);
								//
								p.list.selEndOffset = p.list.offset;
							}, 100);
					} else {
						window.SetCursor(IDC_ARROW);
					};
				};
			};
			if (dragndrop.clicked) {
				dragndrop.moved = true;
			};
			break;
		};
	};
};

// (2.6) l3/r3 were appended at the end on purpose - every existing positional field
// (0-13) keeps its slot, so old SYSTEM.GroupBy.* properties still line up unchanged.
oGroupBy = function (label, tf, sortOrder, ref, playlistFilter, collapsedHeight, expandedHeight, showCover, autoCollapse, l1, r1, l2, r2, collapseGroupsByDefault, l3, r3) {
	this.label = label;
	this.tf = tf;
	this.sortOrder = sortOrder;
	this.ref = ref;
	this.l1 = l1;
	this.r1 = r1;
	this.l2 = l2;
	this.r2 = r2;
	this.l3 = l3;
	this.r3 = r3;
	this.playlistFilter = playlistFilter;
	this.collapsedHeight = collapsedHeight;
	this.expandedHeight = expandedHeight;
	this.showCover = showCover;
	this.autoCollapse = autoCollapse;
	this.collapseGroupsByDefault = collapseGroupsByDefault;
};

// jssp-style defaults for the footer line. %group_tracks%, %group_duration%, %group_index%
// and %group_total% are per-group aggregates resolved here (they are not real metadb
// fields); anything else left in the string is resolved by fb.TitleFormat against the
// group's metadb, same as l1/r1/l2/r2.
var DEFAULT_GROUP_FOOTER_L3 = "$ifgreater(%group_tracks%,1,%group_tracks% tracks,%group_tracks% track), %group_duration%";
var DEFAULT_GROUP_FOOTER_R3 = "%group_index% / %group_total%";

function group_template_value(template, group_obj, group_index, metadb) {
	var value = String(template || "");
	value = value.replace(/%group_tracks%/gi, group_obj ? String(group_obj.count) : "0");
	value = value.replace(/%group_duration%/gi, group_obj ? group_obj.total_group_duration_txt : "0:00");
	value = value.replace(/%group_index%/gi, String((group_index || 0) + 1));
	value = value.replace(/%group_total%/gi, String(p.list ? p.list.groups.length : 0));
	// Always evaluate through TitleFormat when a metadb is available, same as l1/r1/l2/r2 -
	// not just when a %field% remains. The default text uses $ifgreater(), and a $-function
	// with no % left still needs TitleFormat to run it; skipping that step left it as
	// literal, un-evaluated "$ifgreater(...)" text instead of "N tracks"/"N track".
	if (metadb) {
		return fb.TitleFormat(value).EvalWithMetadb(metadb);
	};
	return value;
};

oList = function (object_name, playlist) {
	this.objectName = object_name;
	this.playlist = playlist;
	this.focusedTrackId = plman.GetPlaylistFocusItemIndex(this.playlist);
	this.handleList = plman.GetPlaylistItems(this.playlist);
	this.count = this.handleList.Count;
	this.groups = [];
	this.items = [];
	this.groupby = [];
	this.totalGroupBy = window.GetProperty("SYSTEM.Groups.TotalGroupBy", 0);
	this.metadblist_selection = plman.GetPlaylistSelectedItems(this.playlist);
	this.SHIFT_start_id = null;
	this.SHIFT_count = 0;
	this.ishover = false;
	this.buttonclicked = false;
	this.selAffected = [];
	this.drawRectSel_click = false;
	this.drawRectSel = false;
	this.beam = 0;
	this.item_clicked = false;

	// items variables used in Item object (optimization)
	this.setItemColors = function () {
		this.text_colour_playing = blendColors(g_color_highlight, g_color_normal_bg, 0.1);
		this.text_colour_selected = blendColors(g_color_selected_txt, g_color_normal_bg, 0.1);
		// (2.6) alpha is user-configurable; base colour stays full-strength text colour and
		// FillSolidRect honours the alpha byte here (unlike gr.GdiDrawText, see main.js fade_text).
		this.line_color = g_color_normal_txt & RGBA(255, 255, 255, clamp_int(properties.groupHeaderLineAlpha, 0, 255));
	};
	this.setItemColors();

	this.saveGroupBy = function () {
		var tmp;
		var fin = this.groupby.length;
		for (var j = 0; j < 16; j++) {
			tmp = "";
			for (var i = 0; i < fin; i++) {
				switch (j) {
				case 0:
					tmp = tmp + this.groupby[i].label;
					break;
				case 1:
					tmp = tmp + this.groupby[i].tf;
					break;
				case 2:
					tmp = tmp + this.groupby[i].sortOrder;
					break;
				case 3:
					tmp = tmp + this.groupby[i].ref;
					break;
				case 4:
					tmp = tmp + this.groupby[i].playlistFilter;
					break;
				case 5:
					tmp = tmp + this.groupby[i].collapsedHeight;
					break;
				case 6:
					tmp = tmp + this.groupby[i].expandedHeight;
					break;
				case 7:
					tmp = tmp + this.groupby[i].showCover;
					break;
				case 8:
					tmp = tmp + this.groupby[i].autoCollapse;
					break;
				case 9:
					tmp = tmp + this.groupby[i].l1;
					break;
				case 10:
					tmp = tmp + this.groupby[i].r1;
					break;
				case 11:
					tmp = tmp + this.groupby[i].l2;
					break;
				case 12:
					tmp = tmp + this.groupby[i].r2;
					break;
				case 13:
					tmp = tmp + this.groupby[i].collapseGroupsByDefault;
					break;
				case 14:
					tmp = tmp + this.groupby[i].l3;
					break;
				case 15:
					tmp = tmp + this.groupby[i].r3;
					break;
				};
				// add separator
				if (i < this.groupby.length - 1) {
					tmp = tmp + "^^";
				};
			};
			switch (j) {
			case 0:
				window.SetProperty("SYSTEM.GroupBy.label", tmp);
				break;
			case 1:
				window.SetProperty("SYSTEM.GroupBy.tf", tmp);
				break;
			case 2:
				window.SetProperty("SYSTEM.GroupBy.sortOrder", tmp);
				break;
			case 3:
				window.SetProperty("SYSTEM.GroupBy.ref", tmp);
				break;
			case 4:
				window.SetProperty("SYSTEM.GroupBy.playlistFilter", tmp);
				break;
			case 5:
				window.SetProperty("SYSTEM.GroupBy.collapsedHeight", tmp);
				break;
			case 6:
				window.SetProperty("SYSTEM.GroupBy.expandedHeight", tmp);
				break;
			case 7:
				window.SetProperty("SYSTEM.GroupBy.showCover", tmp);
				break;
			case 8:
				window.SetProperty("SYSTEM.GroupBy.autoCollapse", tmp);
				break;
			case 9:
				window.SetProperty("SYSTEM.GroupBy.l1", tmp);
				break;
			case 10:
				window.SetProperty("SYSTEM.GroupBy.r1", tmp);
				break;
			case 11:
				window.SetProperty("SYSTEM.GroupBy.l2", tmp);
				break;
			case 12:
				window.SetProperty("SYSTEM.GroupBy.r2", tmp);
				break;
			case 13:
				window.SetProperty("SYSTEM.GroupBy.collapseGroupsByDefault", tmp);
				break;
			case 14:
				window.SetProperty("SYSTEM.GroupBy.l3", tmp);
				break;
			case 15:
				window.SetProperty("SYSTEM.GroupBy.r3", tmp);
				break;
			};
		};
		this.initGroupBy();
	};

	this.initGroupBy = function () {
		this.groupby.splice(0, this.groupby.length);
		if (this.totalGroupBy == 0) {
			// INITIALIZE GroupBy patterns
			var fields = [],
			tmp,
			fin;

			for (var i = 0; i < 16; i++) {
				switch (i) {
				case 0:
					fields.push(new Array("Album Artist | Album | Disc", "Folder Structure"));
					break;
				case 1:
					fields.push(new Array("%album artist%%album%%discnumber%", "$replace(%path%,%filename_ext%,)"));
					break;
				case 2:
					fields.push(new Array("%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", "%path%"));
					break;
				case 3:
					fields.push(new Array("Album", "Custom"));
					break;
				case 4: // playlist filter
					fields.push(new Array("null", "null"));
					break;
				case 5: // extra rows
					fields.push(new Array("0", "0"));
					break;
				case 6: // collapsed height
					fields.push(new Array("2", "2"));
					break;
				case 7: // expanded height
					fields.push(new Array("3", "3"));
					break;
				case 8: // show cover
					fields.push(new Array("1", "1"));
					break;
				case 9: // auto collapse
					fields.push(new Array("0", "0"));
					break;
				case 10: // l1
					fields.push(new Array("$if(%album%,%album% ['('Disc %discnumber%[ of %totaldiscs%]')'],$if(%length%,'Single(s)','Streams'))", "$directory(%path%,1)"));
					break;
				case 11: // r1
					fields.push(new Array("$if(%date%,$year($replace(%date%,/,-,.,-)),'-')", "$if(%date%,$year($replace(%date%,/,-,.,-)),'-')"));
					break;
				case 12: // l2
					fields.push(new Array("$if(%length%,%album artist%)", "$directory(%path%,2)"));
					break;
				case 13: // r2
					fields.push(new Array("$if2(%genre%,'Other')", "$if2(%genre%,'Other')"));
					break;
				case 14: // l3 (2.6, footer left)
					fields.push(new Array(DEFAULT_GROUP_FOOTER_L3, DEFAULT_GROUP_FOOTER_L3));
					break;
				case 15: // r3 (2.6, footer right)
					fields.push(new Array(DEFAULT_GROUP_FOOTER_R3, DEFAULT_GROUP_FOOTER_R3));
					break;
				};
				// convert array to csv string
				tmp = "";
				fin = fields[i].length;
				for (var j = 0; j < fin; j++) {
					tmp = tmp + fields[i][j];
					if (j < fields[i].length - 1) {
						tmp = tmp + "^^";
					};
				};
				// save CSV string into window Properties
				switch (i) {
				case 0:
					window.SetProperty("SYSTEM.GroupBy.label", tmp);
					break;
				case 1:
					window.SetProperty("SYSTEM.GroupBy.tf", tmp);
					break;
				case 2:
					window.SetProperty("SYSTEM.GroupBy.sortOrder", tmp);
					break;
				case 3:
					window.SetProperty("SYSTEM.GroupBy.ref", tmp);
					break;
				case 4:
					window.SetProperty("SYSTEM.GroupBy.playlistFilter", tmp);
					break;
				case 5:
					window.SetProperty("SYSTEM.GroupBy.collapsedHeight", tmp);
					break;
				case 6:
					window.SetProperty("SYSTEM.GroupBy.expandedHeight", tmp);
					break;
				case 7:
					window.SetProperty("SYSTEM.GroupBy.showCover", tmp);
					break;
				case 8:
					window.SetProperty("SYSTEM.GroupBy.autoCollapse", tmp);
					break;
				case 9:
					window.SetProperty("SYSTEM.GroupBy.l1", tmp);
					break;
				case 10:
					window.SetProperty("SYSTEM.GroupBy.r1", tmp);
					break;
				case 11:
					window.SetProperty("SYSTEM.GroupBy.l2", tmp);
					break;
				case 12:
					window.SetProperty("SYSTEM.GroupBy.r2", tmp);
					break;
				case 13:
					window.SetProperty("SYSTEM.GroupBy.collapseGroupsByDefault", tmp);
					break;
				case 14:
					window.SetProperty("SYSTEM.GroupBy.l3", tmp);
					break;
				case 15:
					window.SetProperty("SYSTEM.GroupBy.r3", tmp);
					break;
				};
			};
			// create GroupBy Objects
			this.totalGroupBy = fields[0].length;
			window.SetProperty("SYSTEM.Groups.TotalGroupBy", this.totalGroupBy);
			for (var k = 0; k < this.totalGroupBy; k++) {
				this.groupby.push(new oGroupBy(fields[0][k], fields[1][k], fields[2][k], fields[3][k], fields[4][k], fields[5][k], fields[6][k], fields[7][k], fields[8][k], fields[9][k], fields[10][k], fields[11][k], fields[12][k], fields[13][k], fields[14][k], fields[15][k]));
			};

		} else {
			var fields = [];
			var tmp;
			// LOAD GroupBy patterns from Properties
			for (var i = 0; i < 16; i++) {
				switch (i) {
				case 0:
					tmp = window.GetProperty("SYSTEM.GroupBy.label", "?;?");
					break;
				case 1:
					tmp = window.GetProperty("SYSTEM.GroupBy.tf", "?;?");
					break;
				case 2:
					tmp = window.GetProperty("SYSTEM.GroupBy.sortOrder", "?;?");
					break;
				case 3:
					tmp = window.GetProperty("SYSTEM.GroupBy.ref", "?;?");
					break;
				case 4:
					tmp = window.GetProperty("SYSTEM.GroupBy.playlistFilter", "?;?");
					break;
				case 5:
					tmp = window.GetProperty("SYSTEM.GroupBy.collapsedHeight", "?;?");
					break;
				case 6:
					tmp = window.GetProperty("SYSTEM.GroupBy.expandedHeight", "?;?");
					break;
				case 7:
					tmp = window.GetProperty("SYSTEM.GroupBy.showCover", "?;?");
					break;
				case 8:
					tmp = window.GetProperty("SYSTEM.GroupBy.autoCollapse", "?;?");
					break;
				case 9:
					tmp = window.GetProperty("SYSTEM.GroupBy.l1", "?;?");
					break;
				case 10:
					tmp = window.GetProperty("SYSTEM.GroupBy.r1", "?;?");
					break;
				case 11:
					tmp = window.GetProperty("SYSTEM.GroupBy.l2", "?;?");
					break;
				case 12:
					tmp = window.GetProperty("SYSTEM.GroupBy.r2", "?;?");
					break;
				case 13:
					tmp = window.GetProperty("SYSTEM.GroupBy.collapseGroupsByDefault", "?;?");
					break;
				case 14:
					tmp = window.GetProperty("SYSTEM.GroupBy.l3", "?;?");
					break;
				case 15:
					tmp = window.GetProperty("SYSTEM.GroupBy.r3", "?;?");
					break;
				};
				fields.push(tmp.split("^^"));
			};
			// (2.6) migration: presets saved before the footer line existed have no l3/r3 -
			// GetProperty falls back to the "?;?" placeholder above, which doesn't split into
			// one entry per preset. Backfill the jssp default for every preset that's missing
			// one, then persist once so this only ever runs a single time per install.
			var needs_footer_migration = false;
			for (var k = 0; k < this.totalGroupBy; k++) {
				if (!fields[14][k] || fields[14][k] == "?;?") {
					fields[14][k] = DEFAULT_GROUP_FOOTER_L3;
					needs_footer_migration = true;
				};
				if (!fields[15][k] || fields[15][k] == "?;?") {
					fields[15][k] = DEFAULT_GROUP_FOOTER_R3;
					needs_footer_migration = true;
				};
			};
			for (var k = 0; k < this.totalGroupBy; k++) {
				this.groupby.push(new oGroupBy(fields[0][k], fields[1][k], fields[2][k], fields[3][k], fields[4][k], fields[5][k], fields[6][k], fields[7][k], fields[8][k], fields[9][k], fields[10][k], fields[11][k], fields[12][k], fields[13][k], fields[14][k], fields[15][k]));
			};
			if (needs_footer_migration) {
				this.saveGroupBy();
			};
		};
	};
	this.initGroupBy();

	this.getTotalRows = function () {
		var ct = 0;
		var cv = 0;
		var fin = this.groups.length;
		for (var i = 0; i < fin; i++) {
			this.groups[i].totalPreviousRows += ct;
			this.groups[i].totalPreviousTracks += cv;
			if (this.groups[i].collapsed) {
				ct += cGroup.collapsed_height;
			} else {
				ct += this.groups[i].count + cGroup.expanded_height;
				ct += this.groups[i].rowsToAdd;
			};
			cv += this.groups[i].count;
			cv += this.groups[i].rowsToAdd;
		};
		return ct;
	};

	this.updateGroupsOnCollapse = function (group_id) {
		if (!this.groups[group_id].collapsed) {
			var delta = (this.groups[group_id].count + this.groups[group_id].rowsToAdd) + (cGroup.expanded_height - cGroup.collapsed_height);
			var fin = this.groups.length;
			for (var i = group_id + 1; i < fin; i++) {
				this.groups[i].totalPreviousRows -= delta;
			};
			this.totalRows -= delta;
			if (this.totalRows <= this.totalRowVisible) {
				this.offset = 0;
			} else {
				if (this.totalRows - this.offset < this.totalRowVisible) {
					this.offset = this.totalRows - this.totalRowVisible;
					if (this.offset < 0)
						this.offset = 0;
				};
			};
			this.groups[group_id].collapsed = true;
		};
	};

	this.updateGroupsOnExpand = function (group_id) {
		if (this.groups[group_id].collapsed) {
			var delta = (this.groups[group_id].count + this.groups[group_id].rowsToAdd) + (cGroup.expanded_height - cGroup.collapsed_height);
			var fin = this.groups.length;
			for (var i = group_id + 1; i < fin; i++) {
				this.groups[i].totalPreviousRows += delta;
			};
			this.totalRows += delta;
			if (this.totalRows <= this.totalRowVisible) {
				this.offset = 0;
			} else {
				if (this.totalRows - this.offset < this.totalRowVisible) {
					this.offset = this.totalRows - this.totalRowVisible;
					if (this.offset < 0)
						this.offset = 0;
				};
			};
			this.groups[group_id].collapsed = false;
		};
	};

	this.updateGroupStatus = function (group_id) {
		// collapse previous group of focused track
		if (properties.autocollapse) {
			this.updateGroupsOnCollapse(g_group_id_focused);
		};
		// expand new group of the current focused track (new one)
		this.updateGroupsOnExpand(group_id);
		// update current group id of focused track
		g_group_id_focused = group_id;
	};

	this.updateGroupByPattern = function (pattern_idx) {
		var m = pattern_idx;
		tf_group_key = fb.TitleFormat(this.groupby[m].tf);
		cover.show = (this.groupby[m].showCover == "1" ? true : false);
		properties.autocollapse = (this.groupby[m].autoCollapse == "1" ? true : false);
		cGroup.default_collapsed_height = Math.floor(this.groupby[m].collapsedHeight);
		cGroup.collapsed_height = cGroup.default_collapsed_height;
		cGroup.default_expanded_height = Math.floor(this.groupby[m].expandedHeight);
		cGroup.expanded_height = cGroup.default_expanded_height;
		// A header height of zero is what actually hides the headers. Re-deriving the
		// heights from the preset used to bring them straight back whenever any group
		// setting was edited, so the "Show group headers" toggle looked like it did nothing.
		if (!properties.showgroupheaders) {
			cGroup.collapsed_height = 0;
			cGroup.expanded_height = 0;
			properties.autocollapse = false;
		};
		properties.collapseGroupsByDefault = (this.groupby[m].collapseGroupsByDefault == "1" ? true : false);
		// update max_w et max_h for cover loading and repaint in cache image handle functions
		cover.max_w = cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height;
		cover.max_h = cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height;
		// refresh playlist
		g_image_cache = new image_cache;
	};

	this.init_groups = function (iscollapsed) {
		var handle;
		var length;
		var current;
		var previous;
		var count = 0;
		var start = 0;
		var total_time_length = 0;
		var global_time = 0;
		var arr_pl,
		fin,
		fin2;

		// update group key TF pattern
		if (properties.showgroupheaders) {
			if (properties.enablePlaylistFilter) {
				var pl_name = plman.GetPlaylistName(this.playlist);
				var found = false;
				var default_pattern_index = -1;
				fin = this.groupby.length;
				for (var m = 0; m < fin; m++) {
					if (default_pattern_index > -1 && found) {
						break;
					} else if (this.groupby[m].playlistFilter.length > 0) {
						arr_pl = this.groupby[m].playlistFilter.split(";");
						fin2 = arr_pl.length;
						for (var n = 0; n < fin2; n++) {
							if (default_pattern_index < 0 && arr_pl[n] == "*") {
								default_pattern_index = m;
							};
							if (arr_pl[n] == pl_name) {
								found = true;
								this.updateGroupByPattern(m);
							};
						};
					};
				};
				if (default_pattern_index < 0) {
					// if no default pattern set ('*' in the playlist filter field of a group by pattern), we use the current pattern
					default_pattern_index = cGroup.pattern_idx;
				};
				if (!found) {
					// apply default pattern if playlist not found in patterns playlist-filter
					m = default_pattern_index;
					this.updateGroupByPattern(m);
				};
			} else {
				this.updateGroupByPattern(cGroup.pattern_idx);
			};
		} else {
			tf_group_key = fb.TitleFormat("%path%");
		};
		// if status just updated in settings, iscollapsed parameter to force
		//iscollapsed = properties.collapseGroupsByDefault;

		this.groups.splice(0, this.groups.length);
		for (var i = 0; i < this.count; i++) {
			handle = this.handleList[i];
			length = fb2k_length(handle);
 			current = properties.showgroupheaders ? tf_group_key.EvalWithMetadb(handle) : handle.Path;
			
			if (previous != current) {
				if (i > 0) {
					this.groups.push(new oGroup(this.groups.length, start, count, total_time_length, this.focusedTrackId, iscollapsed))
				}
				previous = current;
				start = i;
				count = 1;
				total_time_length = length;
			} else {
				count++;
				total_time_length += length;
			}
			
			if (i == this.count - 1) {
				this.groups.push(new oGroup(this.groups.length, start, count, total_time_length, this.focusedTrackId, iscollapsed));
			}
			
			global_time += length;
		};
		// calc total rows for this total handles + groups
		this.totalRows = this.getTotalRows();

		// total seconds playlist for playlist header panel
		g_total_duration_text = utils.FormatDuration(global_time);
	};

	this.updateHandleList = function (playlist, iscollapsed) {
		this.playlist = playlist;
		if (plman.PlaylistItemCount(this.playlist) > 0) {
			this.focusedTrackId = plman.GetPlaylistFocusItemIndex(this.playlist);
		} else {
			this.focusedTrackId = -1;
		};
		this.handleList = plman.GetPlaylistItems(this.playlist);
		this.count = this.handleList.Count;
		// Invalidate the incremental-search haystack. It will be rebuilt lazily on
		// the next typed search instead of scanning the whole playlist here.
		g_direct_search_values = [];
		clear_incremental_search();
		this.init_groups(iscollapsed);
		this.getStartOffsetFromFocusId();
	};

	this.setSize = function (x, y, w, h) {
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		this.totalRowVisible = Math.floor(this.h / cTrack.height);
		this.totalRowToLoad = this.totalRowVisible + 1;
	};

	this.selectAtoB = function (start_id, end_id) {

		var affectedItems = Array();

		if (this.SHIFT_start_id == null) {
			this.SHIFT_start_id = start_id;
		};

		plman.ClearPlaylistSelection(this.playlist);

		var previous_focus_id = this.focusedTrackId;

		if (start_id < end_id) {
			var deb = start_id;
			var fin = end_id;
		} else {
			var deb = end_id;
			var fin = start_id;
		};

		for (var i = deb; i <= fin; i++) {
			affectedItems.push(i);
		};
		plman.SetPlaylistSelection(this.playlist, affectedItems, true);

		plman.SetPlaylistFocusItem(this.playlist, end_id);

		if (affectedItems.length > 1) {
			if (end_id > previous_focus_id) {
				var delta = end_id - previous_focus_id;
				this.SHIFT_count += delta;
			} else {
				var delta = previous_focus_id - end_id;
				this.SHIFT_count -= delta;
			};
		};
	};

	this.selectGroupTracks = function (gp_id, state) {
		var affectedItems = Array();
		var first_trk = this.groups[gp_id].start;
		var total_trks = this.groups[gp_id].count;
		for (var i = first_trk; i < first_trk + total_trks; i++) {
			affectedItems.push(i);
		};
		plman.SetPlaylistSelection(this.playlist, affectedItems, state);
	};

	this.validPlaylistIndex = function (index) {
		var value = Number(index);
		if (!isFinite(value) || value < 0 || value >= plman.PlaylistCount)
			return -1;
		return Math.floor(value);
	};

	this.isQueueRecoveryPlaylist = function (playlistIndex) {
		if (this.validPlaylistIndex(playlistIndex) < 0)
			return false;
		try {
			var name = String(plman.GetPlaylistName(playlistIndex) || "");
			return name.indexOf("[Rivage Queue Recovery:") >= 0 || name.indexOf("Queue Recovery") >= 0;
		} catch (e) {
			return false;
		};
	};

	this.findHandleInPlaylist = function (playlistIndex, metadb) {
		playlistIndex = this.validPlaylistIndex(playlistIndex);
		if (playlistIndex < 0 || !metadb)
			return -1;
		try {
			var items = plman.GetPlaylistItems(playlistIndex);
			return items ? Number(items.Find(metadb)) : -1;
		} catch (e) {
			return -1;
		};
	};

	// Playback-queue entries added as bare handles do not retain playlist provenance.
	// In that case PlayingPlaylist and GetPlayingItemLocation() can both be invalid.
	// Resolve the now-playing handle back to an ordinary playlist instead of ever
	// assigning an invalid PlayingPlaylist to ActivePlaylist.
	this.resolveNowPlayingLocation = function () {
		var location = null;
		var playlistIndex = -1;
		var playlistItemIndex = -1;
		var metadb = null;
		var candidates = [];
		var tried = {};
		var i;

		try {
			location = plman.GetPlayingItemLocation();
			if (location && location.IsValid) {
				playlistIndex = this.validPlaylistIndex(location.PlaylistIndex);
				playlistItemIndex = Number(location.PlaylistItemIndex);
				if (playlistIndex >= 0 && isFinite(playlistItemIndex) && playlistItemIndex >= 0 && playlistItemIndex < plman.PlaylistItemCount(playlistIndex)) {
					return {
						PlaylistIndex: playlistIndex,
						PlaylistItemIndex: Math.floor(playlistItemIndex),
						IsValid: true
					};
				};
			};
		} catch (e) {};

		try { metadb = fb.GetNowPlaying(); } catch (e2) { metadb = null; };
		if (!metadb)
			return null;

		// Preserve the user's current playlist whenever the queued handle exists there.
		candidates.push(this.playlist);
		try { candidates.push(plman.ActivePlaylist); } catch (e3) {};
		try { candidates.push(plman.PlayingPlaylist); } catch (e4) {};

		for (i = 0; i < candidates.length; i++) {
			playlistIndex = this.validPlaylistIndex(candidates[i]);
			if (playlistIndex < 0 || tried[playlistIndex] || this.isQueueRecoveryPlaylist(playlistIndex))
				continue;
			tried[playlistIndex] = true;
			playlistItemIndex = this.findHandleInPlaylist(playlistIndex, metadb);
			if (playlistItemIndex >= 0) {
				return { PlaylistIndex: playlistIndex, PlaylistItemIndex: playlistItemIndex, IsValid: true };
			};
		};

		for (playlistIndex = 0; playlistIndex < plman.PlaylistCount; playlistIndex++) {
			if (tried[playlistIndex] || this.isQueueRecoveryPlaylist(playlistIndex))
				continue;
			playlistItemIndex = this.findHandleInPlaylist(playlistIndex, metadb);
			if (playlistItemIndex >= 0) {
				return { PlaylistIndex: playlistIndex, PlaylistItemIndex: playlistItemIndex, IsValid: true };
			};
		};

		return null;
	};

	// explicit: true only for a real user "take me there" action (currently just the header
	// bar's "Show Now Playing Track" menu entry - see WSHheaderbar.js). Defaults to falsy so
	// automatic callers (on_playback_new_track in main.js, which fires on every track change,
	// not just user-driven ones) never yank the panel away from whatever playlist the user is
	// currently looking at just because playback moved on somewhere else - see the
	// switchingPlaylist guard right below. this.nowplaying is updated either way, so the
	// playing-row highlight (draw() further down, the playlist manager row) stays correct for
	// the playlist that's actually playing even while it isn't the one on screen.
	this.showNowPlaying = function (explicit) {
		if (!fb.IsPlaying)
			return false;

		var target = this.resolveNowPlayingLocation();
		if (!target)
			return false;

		var targetPlaylist = target.PlaylistIndex;
		var targetItem = target.PlaylistItemIndex;
		var switchingPlaylist = targetPlaylist != this.playlist;
		this.nowplaying = target;

		// Not an explicit user action, and the playing track lives in a different playlist
		// than the one currently on screen: leave the view alone. The user may be working in
		// that other playlist and doesn't want it swapped out from under them just because
		// playback moved on - see on_playback_new_track() in main.js, the only automatic caller.
		if (switchingPlaylist && !explicit)
			return false;

		if (switchingPlaylist) {
			// Only switch after a real playlist has been resolved. Bare queue handles can
			// report PlayingPlaylist == -1; assigning that value was the focus-loss bug.
			plman.ActivePlaylist = targetPlaylist;
			this.playlist = targetPlaylist;
			plman.SetPlaylistFocusItem(this.playlist, targetItem);
			this.setItems(true);
		} else {
			// Same-playlist playback follows the row visually without stealing the user's
			// keyboard cursor. Explicit "Show/Focus now playing" actions can still move it.
			this.scrollToTrack(targetItem);
		};

		p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
		full_repaint();
		return true;
	};

	// True if trackId's row currently falls within the visible viewport at the current
	// offset. Self-contained - recomputed straight from getRowId()/this.offset, unlike the
	// older isFocusedItemVisible() which scanned the cached this.items array against
	// this.focusedTrackId (see the staleness/race notes on showNowPlaying() above).
	this.isTrackVisible = function (trackId) {
		var rowId = this.getRowId(trackId);
		if (rowId < 0)
			return false;
		return rowId >= this.offset && rowId < this.offset + this.totalRowVisible;
	};

	// Centre the view on trackId's row without touching plman's focus/keyboard-cursor - the
	// "just scroll this into view" primitive jssp.js gets for free from the host's
	// on_playlist_item_ensure_visible callback (see main.js - this codebase never implemented
	// that callback before). Shared by showNowPlaying() and on_playlist_item_ensure_visible().
	// Unconditional by design - callers that only want to scroll when actually off-screen
	// (on_playlist_item_ensure_visible) should check isTrackVisible() first; showNowPlaying()
	// deliberately always centres since it's an explicit "take me there" user action.
	this.scrollToTrack = function (trackId) {
		if (trackId < 0 || trackId >= this.count)
			return;
		var mid = Math.floor(this.totalRowToLoad / 2) - 1;
		var rowId = this.getRowId(trackId);
		if (rowId < 0)
			return;
		if (this.totalRows > this.totalRowVisible) {
			if (rowId <= mid) {
				this.offset = 0;
			} else {
				var d = this.totalRows - (rowId + 1);
				if (d >= Math.floor(this.totalRowToLoad / 2)) {
					this.offset = rowId - mid;
				} else {
					this.offset = this.totalRows - this.totalRowVisible;
				};
			};
			if (this.offset < 0)
				this.offset = 0;
		} else {
			this.offset = 0;
		};
		this.setItems(false);
	};

	this.showFocusedItem = function () {
		this.setItems(true);
		full_repaint();
	};

	this.getStartOffsetFromFocusId = function () {
		var mid = Math.floor(this.totalRowToLoad / 2) - 1;
		if (plman.PlaylistItemCount(this.playlist) > 0) {
			this.focusedTrackId = plman.GetPlaylistFocusItemIndex(this.playlist);
		} else {
			this.focusedTrackId = -1;
		};
		if (this.focusedTrackId < 0) {
			this.offset = 0;
			return this.offset;
		};

		if (this.focusedTrackId < 0 || this.focusedTrackId > this.count)
			this.focusedTrackId = 0;
		this.focusedRowId = this.getRowId(this.focusedTrackId);

		if (this.totalRows > this.totalRowVisible) {
			if (this.focusedRowId <= mid) {
				this.offset = 0;
			} else {
				var d = this.totalRows - (this.focusedRowId + 1);
				if (d >= Math.floor(this.totalRowToLoad / 2)) {
					this.offset = this.focusedRowId - mid;
				} else {
					this.offset = this.totalRows - this.totalRowVisible;
				};
			};
			if (this.offset < 0)
				this.offset = 0;
		} else {
			this.offset = 0;
		};
		return this.offset;
	};

	this.getGroupIdfromTrackId = function (valeur) {
		var mediane = 0;
		var deb = 0;
		var fin = this.groups.length - 1;
		while (deb <= fin) {
			mediane = Math.floor((fin + deb) / 2);
			if (valeur >= this.groups[mediane].start && valeur < this.groups[mediane].start + this.groups[mediane].count) {
				return mediane;
			} else if (valeur < this.groups[mediane].start) {
				fin = mediane - 1;
			} else {
				deb = mediane + 1;
			};
		};
		return -1;
	};

	this.getGroupIdFromRowId = function (valeur) {
		var mediane = 0;
		var deb = 0;
		var fin = this.groups.length - 1;
		while (deb <= fin) {
			mediane = Math.floor((fin + deb) / 2);
			grp_height = this.groups[mediane].collapsed ? cGroup.collapsed_height : cGroup.expanded_height;
			grp_size = this.groups[mediane].collapsed ? grp_height : grp_height + this.groups[mediane].count + this.groups[mediane].rowsToAdd;
			if (valeur >= this.groups[mediane].totalPreviousRows && valeur < this.groups[mediane].totalPreviousRows + grp_size) {
				return mediane;
			} else if (valeur < this.groups[mediane].totalPreviousRows) {
				fin = mediane - 1;
			} else {
				deb = mediane + 1;
			};
		};
		return -1;
	};

	this.getRowId = function (trackId) {
		var grp_id = this.getGroupIdfromTrackId(trackId);
		if (grp_id == -1)
			return -1;
		if (this.groups[grp_id].collapsed) { // track hidden in the collapsed group so return = -1 or we return the row id of the group it belongs to ?
			//var row_index = -1;
			var row_index = this.groups[grp_id].totalPreviousRows + 1;
		} else { // group expanded so we can return a valid row_id for the track searched
			var row_index = this.groups[grp_id].totalPreviousRows + cGroup.expanded_height + (trackId - this.groups[grp_id].start);
		};
		return row_index;
	};

	this.getTrackId = function (rowId) {
		this.s_group_id = this.getGroupIdFromRowId(rowId);
		// The group array can briefly disagree with totalRows while a setting is being
		// applied (group heights change before the groups are rebuilt). Treat an
		// out-of-range id as "no group" so callers bail out instead of crashing.
		if (this.s_group_id >= this.groups.length)
			this.s_group_id = -1;
		if (this.s_group_id >= 0) {
			this.s_group_height = this.groups[this.s_group_id].collapsed ? cGroup.collapsed_height : cGroup.expanded_height;
			if (this.groups[this.s_group_id].collapsed) {
				var a = rowId - this.groups[this.s_group_id].totalPreviousRows;
				this.s_groupheader_line_id = a;
				this.s_track_id = this.groups[this.s_group_id].start;
			} else {
				var a = rowId - this.groups[this.s_group_id].totalPreviousRows;
				if (a < this.s_group_height) { // row is in the group header
					this.s_groupheader_line_id = a;
					this.s_track_id = this.groups[this.s_group_id].start;
				} else { // row is a track
					this.s_groupheader_line_id = -1;
					this.s_track_id = (a - this.s_group_height) + this.groups[this.s_group_id].start;
					var track_index_in_group = this.s_track_id - this.groups[this.s_group_id].start;
					if (track_index_in_group >= this.groups[this.s_group_id].count) { // track is a copy of the last track of the group to fill the group with minimum track count in group feature!
						this.s_delta = (track_index_in_group - this.groups[this.s_group_id].count) + 1;
						this.s_track_id -= this.s_delta;
					} else {
						this.s_delta = 0;
					};
				};
			};
			return this.s_track_id;
		} else {
			return 0;
		};
	};

	this.scrollItems = function (delta, scrollstep) {
		cList.scroll_direction = (delta < 0 ? -1 : 1);
		if (delta > 0) { // scroll up
			this.offset -= scrollstep;
			if (this.offset < 0)
				this.offset = 0;
		} else { // scroll down
			this.offset += scrollstep;
			if (this.offset > this.totalRows - this.totalRowVisible) {
				this.offset = this.totalRows - this.totalRowVisible;
			};
			if (this.offset < 0)
				this.offset = 0;
		};
		this.setItems(false);
		p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);

		if (properties.smoothscrolling)
			set_scroll_delta();

		if (!p.list.drawRectSel)
			full_repaint();
	};

	this.setItems = function (forceFocus) {
		var track_index_in_group = 0;
		var row_index = 0;
		var m,
		n;
		if (forceFocus) { // from focus item centered in panel
			if (this.totalRows > this.totalRowVisible) {
				var i = this.getStartOffsetFromFocusId();
				if (this.totalRows - this.offset <= this.totalRowVisible) {
					var total_rows_to_draw = this.totalRows < this.totalRowVisible ? this.totalRows : this.totalRowVisible;
				} else {
					var total_rows_to_draw = this.totalRows < this.totalRowToLoad ? this.totalRows : this.totalRowToLoad;
				};

				this.items.splice(0, this.items.length);
				while (i < this.offset + total_rows_to_draw) {
					this.getTrackId(i);
					if (this.s_group_id < 0)
						break;
					if (this.s_groupheader_line_id >= 0) { // group header
						this.items.push(new oItem(this.playlist, row_index, 1, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, 0, this.s_group_height, this.s_groupheader_line_id, this.groups[this.s_group_id], 0));
						i += this.s_group_height - this.s_groupheader_line_id;
						row_index += this.s_group_height - this.s_groupheader_line_id;
					} else { // track row
						track_index_in_group = this.s_track_id - this.groups[this.s_group_id].start + this.s_delta;
						this.items.push(new oItem(this.playlist, row_index, 0, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, track_index_in_group, 1, 0, null, this.s_delta));
						i++;
						row_index++;
					};
				};
			} else {
				this.offset = 0;
				var i = 0; // offset = 0

				this.items.splice(0, this.items.length);
				while (i < this.totalRows) {
					this.getTrackId(i);
					if (this.s_group_id < 0)
						break;
					if (this.s_groupheader_line_id >= 0) { // group header
						this.items.push(new oItem(this.playlist, row_index, 1, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, 0, this.s_group_height, this.s_groupheader_line_id, this.groups[this.s_group_id], 0));
						i += this.s_group_height - this.s_groupheader_line_id;
						row_index += this.s_group_height - this.s_groupheader_line_id;
					} else { // track row
						track_index_in_group = this.s_track_id - this.groups[this.s_group_id].start + this.s_delta;
						this.items.push(new oItem(this.playlist, row_index, 0, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, track_index_in_group, 1, 0, null, this.s_delta));
						i++;
						row_index++;
					};
				};
			};
		} else { // fill items from current offset
			if (this.totalRows > this.totalRowVisible) {
				if (typeof(this.offset) == "undefined") {
					this.getStartOffsetFromFocusId();
					console.log("... undefined");
				};

				var i = this.offset;
				if (this.totalRows - this.offset <= this.totalRowVisible) {
					var total_rows_to_draw = this.totalRows < this.totalRowVisible ? this.totalRows : this.totalRowVisible;
				} else {
					var total_rows_to_draw = this.totalRows < this.totalRowToLoad ? this.totalRows : this.totalRowToLoad;
				};

				this.items.splice(0, this.items.length);
				while (i < this.offset + total_rows_to_draw) {
					this.getTrackId(i);
					if (this.s_group_id < 0)
						break;
					if (this.s_groupheader_line_id >= 0) { // group header
						this.items.push(new oItem(this.playlist, row_index, 1, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, 0, this.s_group_height, this.s_groupheader_line_id, this.groups[this.s_group_id], 0));
						i += this.s_group_height - this.s_groupheader_line_id;
						row_index += this.s_group_height - this.s_groupheader_line_id;
					} else { // track row
						track_index_in_group = this.s_track_id - this.groups[this.s_group_id].start + this.s_delta;
						this.items.push(new oItem(this.playlist, row_index, 0, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, track_index_in_group, 1, 0, null, this.s_delta));
						i++;
						row_index++;
					};
				};
			} else {
				var i = 0; // offset = 0
				this.items.splice(0, this.items.length);
				while (i < this.totalRows) {
					this.getTrackId(i);
					if (this.s_group_id < 0)
						break;
					if (this.s_groupheader_line_id >= 0) { // group header
						this.items.push(new oItem(this.playlist, row_index, 1, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, 0, this.s_group_height, this.s_groupheader_line_id, this.groups[this.s_group_id], 0));
						i += this.s_group_height - this.s_groupheader_line_id;
						row_index += this.s_group_height - this.s_groupheader_line_id;
					} else { // track row
						track_index_in_group = this.s_track_id - this.groups[this.s_group_id].start + this.s_delta;
						this.items.push(new oItem(this.playlist, row_index, 0, this.handleList[this.s_track_id], this.s_track_id, this.s_group_id, track_index_in_group, 1, 0, null, this.s_delta));
						i++;
						row_index++;
					};
				};
			};
		};
	};

	this.getOffsetFromCursorPos = function () {
		var r = (this.cursorPos / this.h);
		this.offset = Math.round(r * this.totalRows);
		if (this.offset < 0)
			this.offset = 0;
	};

	this.isFocusedItemVisible = function () {
		if (this.totalRows <= this.totalRowVisible) {
			return true;
		} else {
			var fin = this.items.length;
			for (var i = 0; i < fin; i++) {
				if (this.items[i].group_index >= 0) {
					if ((this.items[i].type == 0 && this.items[i].empty_row_index == 0) || this.groups[this.items[i].group_index].collapsed) {
						if (this.groups[this.items[i].group_index].collapsed) {
							if (this.focusedTrackId >= this.groups[this.items[i].group_index].start && this.focusedTrackId < this.groups[this.items[i].group_index].start + this.groups[this.items[i].group_index].count) {
								return true;
							};
						} else if (this.focusedTrackId == this.items[i].track_index && this.items[i].row_index < this.totalRowVisible) {
							return true;
						};
					};
				};
			};
		};
		return false;
	};

	this.draw = function (gr) {
		var item_h = 0;

		if (cList.scroll_timer) {
			var row_top_y = this.y - (cList.scroll_delta * cList.scroll_direction);
		} else {
			var row_top_y = this.y;
		};
		var width = 0;

		if (fb.IsPlaying) {
			// A bare playback-queue entry can report the current/playing playlist while
			// GetPlayingItemLocation() itself is invalid. showNowPlaying() may already
			// have resolved that handle back to a real playlist row; never overwrite
			// that good fallback with an invalid host location during paint.
			var liveLocation = null;
			try { liveLocation = plman.GetPlayingItemLocation(); } catch (e) { liveLocation = null; };
			if (liveLocation && liveLocation.IsValid) {
				var livePlaylist = this.validPlaylistIndex(liveLocation.PlaylistIndex);
				var liveItem = Number(liveLocation.PlaylistItemIndex);
				if (livePlaylist >= 0 && isFinite(liveItem) && liveItem >= 0 && liveItem < plman.PlaylistItemCount(livePlaylist)) {
					this.nowplaying = {
						PlaylistIndex: livePlaylist,
						PlaylistItemIndex: Math.floor(liveItem),
						IsValid: true
					};
				};
			};
		};

		// set variables used in Items object (optimization)
		this.state_queue_w = Math.round(gr.CalcTextWidth("00", g_font_queue_idx) + 1);
		this.state_icon_w = this.state_queue_w + g_z6;

		// Draw items (tracks and group headers). The drawable width is identical for
		// every visible item, so compute it once per paint instead of once per row.
		width = (this.totalRows <= this.totalRowVisible || !properties.showscrollbar)
			? this.w
			: this.w - cScrollBar.width;
		var fin = this.items.length;
		for (var i = 0; i < fin; i++) {
			item_h = this.items[i].heightInRow * cTrack.height;
			this.items[i].draw(gr, this.x, row_top_y, width, item_h);
			row_top_y += item_h - (this.items[i].groupRowDelta * cTrack.height);
		};

		if (g_dragndrop_status && g_dragndrop_bottom) {
			var rowId = fin - 1;
			var item_height_row = (this.items[rowId].type == 0 ? 1 : this.items[rowId].heightInRow);
			var item_height = item_height_row * cTrack.height;
			var limit = this.items[rowId].y + item_height;
			var rx = this.items[rowId].x;
			var ry = this.items[rowId].y;
			var rw = this.items[rowId].w;

			gr.FillSolidRect(rx + cover.w * 0, ry + item_height - Math.floor(cList.borderWidth / 2), rw - cover.w, cList.borderWidth, g_color_selected_bg);
			gr.FillSolidRect(rx + cover.w * 0, ry + item_height - Math.floor(cList.borderWidth / 2) - 4 * cList.borderWidth, cList.borderWidth, 9 * cList.borderWidth, g_color_selected_bg);
			gr.FillSolidRect(rx + rw - cList.borderWidth, ry + item_height - Math.floor(cList.borderWidth / 2) - 4 * cList.borderWidth, cList.borderWidth, 9 * cList.borderWidth, g_color_selected_bg);
		};

		// Draw rect selection
		if (this.drawRectSel) {
			var rectSelColor = g_color_selected_bg;
			this.selDeltaRows = this.selEndOffset - this.selStartOffset;
			if (this.selX <= mouse_x) {
				if (this.selY - this.selDeltaRows * cTrack.height <= mouse_y) {
					gr.FillSolidRect(this.selX, (this.selY - this.selDeltaRows * cTrack.height), mouse_x - this.selX, mouse_y - (this.selY - this.selDeltaRows * cTrack.height), rectSelColor & 0x33ffffff);
					gr.DrawRect(this.selX, (this.selY - this.selDeltaRows * cTrack.height), mouse_x - this.selX - 1, mouse_y - (this.selY - this.selDeltaRows * cTrack.height) - 1, 1.0, rectSelColor & 0x66ffffff);
				} else {
					gr.FillSolidRect(this.selX, mouse_y, mouse_x - this.selX, this.selY - mouse_y - this.selDeltaRows * cTrack.height, rectSelColor & 0x33ffffff);
					gr.DrawRect(this.selX, mouse_y, mouse_x - this.selX - 1, this.selY - mouse_y - this.selDeltaRows * cTrack.height - 1, 1.0, rectSelColor & 0x66ffffff);
				};
			} else {
				if (this.selY - this.selDeltaRows * cTrack.height <= mouse_y) {
					gr.FillSolidRect(mouse_x, (this.selY - this.selDeltaRows * cTrack.height), this.selX - mouse_x, mouse_y - (this.selY - this.selDeltaRows * cTrack.height), rectSelColor & 0x33ffffff);
					gr.DrawRect(mouse_x, (this.selY - this.selDeltaRows * cTrack.height), this.selX - mouse_x - 1, mouse_y - (this.selY - this.selDeltaRows * cTrack.height) - 1, 1.0, rectSelColor & 0x66ffffff);
				} else {
					gr.FillSolidRect(mouse_x, mouse_y, this.selX - mouse_x, this.selY - mouse_y - this.selDeltaRows * cTrack.height, rectSelColor & 0x33ffffff);
					gr.DrawRect(mouse_x, mouse_y, this.selX - mouse_x - 1, this.selY - mouse_y - this.selDeltaRows * cTrack.height - 1, 1.0, rectSelColor & 0x66ffffff);
				};
			};
		};
	};

	this.repaint = function () {
		window.RepaintRect(this.x, this.y, this.w, this.h);
	};

	this.isHoverObject = function (x, y) {
		return (x > this.x && x < this.x + this.w - p.playlistManager.woffset && y > this.y && y < this.y + this.h);
	};

	this.check = function (event, x, y, delta) {
		this.ishover = this.isHoverObject(x, y);
		switch (event) {
		case "down":
			this.mclicked = this.ishover;
			if (this.ishover) {
				this.item_clicked = false;
				var fin = this.items.length;
				for (var i = 0; i < fin; i++) {
					this.items[i].check(event, x, y);
				};
				if (!cTouch.down) {
					if (!p.scrollbar.isHoverObject(x, y) && x < p.scrollbar.x) { // if not hover the scrollbar
						if (this.items.length > 0 && !this.item_clicked) { // and if click on an empty area of the playlist (after the last item)
							if (!properties.enableTouchControl) {
								this.selX = x;
								this.selY = y;
								this.drawRectSel_click = true;
								this.selStartId = this.items[this.items.length - 1].track_index;
								this.selStartOffset = p.list.offset;
								this.selEndOffset = p.list.offset;
								this.selDeltaRows = 0;
								this.selAffected.splice(0, this.selAffected.length);
							};
							if (!utils.IsKeyPressed(VK_CONTROL)) {
								plman.ClearPlaylistSelection(this.playlist);
							};
							this.SHIFT_start_id = null;
							full_repaint();
						};
					};
				};
			};
			break;
		case "up":
			if (this.ishover) {
				var fin = this.items.length;
				for (var i = 0; i < fin; i++) {
					this.items[i].check(event, x, y);
				};
			};
			p.list.drawRectSel_click = false;
			p.list.drawRectSel = false;
			// kill timer on rect area refresh for "drawRectSel"
			cList.repaint_timer && window.ClearInterval(cList.repaint_timer);
			cList.repaint_timer = false;
			// kill drag move playlist item timers (vscroll)
			cPlaylistManager.vscroll_timer_loop && window.ClearTimeout(cPlaylistManager.vscroll_timer_loop);
			cPlaylistManager.vscroll_timer_loop = false;
			cPlaylistManager.vscroll_timer && window.ClearTimeout(cPlaylistManager.vscroll_timer);
			cPlaylistManager.vscroll_timer = false;
			if (this.mclicked)
				window.SetCursor(IDC_ARROW);
			this.mclicked = false;
			break;
		case "drag_over":
			g_dragndrop_bottom = false;
			if (this.count > 0) {
				var fin = this.items.length;
				for (var i = 0; i < fin; i++) {
					this.items[i].dragndrop_check(x, y, i);
				};
				if (p.playlistManager.woffset == 0 || (cPlaylistManager.visible && x < p.playlistManager.x - p.playlistManager.woffset)) {
					var rowId = fin - 1;
					var item_height_row = (this.items[rowId].type == 0 ? 1 : this.items[rowId].heightInRow);
					var limit = this.items[rowId].y + item_height_row * cTrack.height;
					if (y > limit) {
						g_dragndrop_bottom = true;
						var trackId = p.list.getTrackId(rowId);
						g_dragndrop_trackId = this.items[rowId].track_index;
						g_dragndrop_rowId = trackId;
					};
				};
			} else {
				g_dragndrop_bottom = true;
				g_dragndrop_trackId = 0;
				g_dragndrop_rowId = 0;
			};
			break;
		case "move":
			var fin = this.items.length;
			for (var i = 0; i < fin; i++) {
				this.items[i].check(event, x, y);
			};
			if (!this.drawRectSel) {
				this.drawRectSel = this.drawRectSel_click;
			};
			if (!this.drawRectSel) {
				// hscroll playlist manager panel when dragging tracks if not visible by default
				if (dragndrop.moved || cPlaylistManager.drag_moved) {
					if (!cPlaylistManager.hscroll_timer) {
						if (!cPlaylistManager.visible) {
							if ((p.playlistManager.woffset == 0 && mouse_x > p.list.w / 1.5) || (p.playlistManager.woffset >= cPlaylistManager.width && (mouse_x <= p.list.w / 1.5))) {
								p.playlistManager.refresh("", true, true, false);
								cPlaylistManager.hscroll_timer = window.SetInterval(function () {
										if (mouse_x > p.list.w / 1.5) {
											p.playlistManager.woffset += cPlaylistManager.step;
											if (p.playlistManager.woffset >= cPlaylistManager.width) {
												p.playlistManager.woffset = cPlaylistManager.width;
												cPlaylistManager.hscroll_timer && window.ClearTimeout(cPlaylistManager.hscroll_timer);
												cPlaylistManager.hscroll_timer = false;
											};
											full_repaint();
										} else {
											full_repaint();
											p.playlistManager.woffset -= cPlaylistManager.step;
											if (p.playlistManager.woffset <= 0) {
												p.playlistManager.woffset = 0;
												cPlaylistManager.hscroll_timer && window.ClearTimeout(cPlaylistManager.hscroll_timer);
												cPlaylistManager.hscroll_timer = false;
												full_repaint();
											};
										};
									}, 16);
							};
						};
						if (p.playlistManager.woffset >= cPlaylistManager.width) { // if playlist manager panel opened
							// vscroll playlist manager on dragging
							// ************************************
							var inner_padding = 0;
							//var area_h = Math.floor((p.playlistManager.h - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight*0 : 0) ) / cPlaylistManager.rowHeight) * cPlaylistManager.rowHeight;
							var area_h = p.playlistManager.h - (cPlaylistManager.showStatusBar ? cPlaylistManager.statusBarHeight : 0);
							if (x > p.playlistManager.x - p.playlistManager.woffset && x < p.playlistManager.x - p.playlistManager.woffset + p.playlistManager.w) {
								if (p.playlistManager.offset > 0 && y < p.playlistManager.y + cPlaylistManager.rowHeight + inner_padding) {
									if (p.playlistManager.scrollbarWidth > 0 && !cPlaylistManager.vscroll_timer_loop) {
										cPlaylistManager.vscroll_timer_loop = window.SetInterval(function () {
												//
												var s = Math.abs(mouse_y - (p.playlistManager.y + cPlaylistManager.rowHeight));
												var h = Math.ceil(cPlaylistManager.rowHeight / 2);
												if (s > h)
													s = h;
												var t = h - s + 1;
												var r = Math.round(500 / h);
												var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
												//
												if (!cPlaylistManager.vscroll_timer) {
													cPlaylistManager.vscroll_timer = window.SetTimeout(function () {
															p.playlistManager.offset = p.playlistManager.offset > 0 ? p.playlistManager.offset - 1 : 0;
															p.playlistManager.scrollbar.reSet(p.playlistManager.rowTotal, cPlaylistManager.rowHeight, p.playlistManager.offset);
															full_repaint();
															if (p.playlistManager.offset == 0 || p.playlistManager.woffset < cPlaylistManager.width) { // kill interval timer!
																window.ClearTimeout(cPlaylistManager.vscroll_timer_loop);
																cPlaylistManager.vscroll_timer_loop = false;
															};
															window.ClearTimeout(cPlaylistManager.vscroll_timer);
															cPlaylistManager.vscroll_timer = false;
														}, scroll_speed_ms);
												};
											}, 5);
									};
								} else if (p.playlistManager.offset < p.playlistManager.rowTotal - p.playlistManager.totalRows && y > p.playlistManager.y + area_h - inner_padding) {
									if (p.playlistManager.scrollbarWidth > 0 && !cPlaylistManager.vscroll_timer_loop) {
										cPlaylistManager.vscroll_timer_loop = window.SetInterval(function () {
												//
												var s = Math.abs(mouse_y - (p.playlistManager.y + area_h));
												var h = Math.ceil(cPlaylistManager.rowHeight / 2);
												if (s > h)
													s = h;
												var t = h - s + 1;
												var r = Math.round(500 / h);
												var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
												//
												if (!cPlaylistManager.vscroll_timer) {
													cPlaylistManager.vscroll_timer = window.SetTimeout(function () {
															p.playlistManager.offset = p.playlistManager.offset < p.playlistManager.rowTotal - p.playlistManager.totalRows ? p.playlistManager.offset + 1 : p.playlistManager.rowTotal - p.playlistManager.totalRows;
															p.playlistManager.scrollbar.reSet(p.playlistManager.rowTotal, cPlaylistManager.rowHeight, p.playlistManager.offset);
															on_mouse_move(mouse_x + 1, mouse_y); // call mouse_move to set mouse cursor to right image (IDC_NO if not on a playlist item)
															full_repaint();
															if (p.playlistManager.offset == p.playlistManager.rowTotal - p.playlistManager.totalRows || p.playlistManager.woffset < cPlaylistManager.width) { // kill interval timer!
																window.ClearTimeout(cPlaylistManager.vscroll_timer_loop);
																cPlaylistManager.vscroll_timer_loop = false;
															};
															window.ClearTimeout(cPlaylistManager.vscroll_timer);
															cPlaylistManager.vscroll_timer = false;
														}, scroll_speed_ms);
												};
											}, 5);
									};
								} else {
									if (cPlaylistManager.vscroll_timer) {
										window.ClearInterval(cPlaylistManager.vscroll_timer_loop);
										cPlaylistManager.vscroll_timer_loop = false;
									};
									if (!cPlaylistManager.drag_move_timer) {
										cPlaylistManager.drag_move_timer = window.SetTimeout(function () {
												if (p.playlistManager.hoverId != p.playlistManager.hoverId_previous) {
													full_repaint();
													p.playlistManager.hoverId_previous = p.playlistManager.hoverId;
												};
												window.ClearInterval(cPlaylistManager.drag_move_timer);
												cPlaylistManager.drag_move_timer = false;
											}, 50);
									};
								};
							} else {
								if (cPlaylistManager.vscroll_timer_loop) {
									window.ClearInterval(cPlaylistManager.vscroll_timer_loop);
									cPlaylistManager.vscroll_timer_loop = false;
								};
							};
						};
					};
				} else {
					// kill timers
					if (cPlaylistManager.vscroll_timer_loop) {
						window.ClearInterval(cPlaylistManager.vscroll_timer_loop);
						cPlaylistManager.vscroll_timer_loop = false;
					};
				};
			} else if (!this.item_clicked) {
				// if draw Selection Rect from an empty area, repaint on mouse move to show the rect
				full_repaint();
			};
			break;
		default:
			if (this.ishover) {
				for (var i = 0; i < this.items.length; i++) {
					this.items[i].check(event, x, y);
				};
			};
		};
	};

	// Incremental search is now handled centrally in main.js with jssp semantics
	// (substring match over a precomputed haystack, cycling match list, F3 for next).
	// This shim keeps the old call site name working.
	this.incrementalSearch = function () {
		rebuild_incremental_matches();
		focus_incremental_match(false);
		return true;
	};

	this.contextMenu = function (x, y, id, row_id) {
		var items = plman.GetPlaylistSelectedItems(this.playlist);
		var flag = plman.IsPlaylistLocked(this.playlist) ? MF_GRAYED : MF_STRING;
		
		var _menu = window.CreatePopupMenu();
		var _context = fb.CreateContextMenuManager();
		
		_context.InitContextPlaylist();
		// "Panel Settings..." (idx 1000) used to live here, opening the F2 drawer (now
		// retired - see WSHdrawer.js's header comment). It was already unreachable dead
		// code below (case 0 breaks before the drawer-toggle line ever runs) - removed
		// along with that dead branch rather than left behind.
		_menu.AppendMenuItem(flag, 1001, "Crop");
		_menu.AppendMenuItem(flag, 1002, "Remove");
		_menu.AppendMenuSeparator();
		_menu.AppendMenuItem(flag, 1003, "Cut");
		_menu.AppendMenuItem(MF_STRING, 1004, "Copy");
		_menu.AppendMenuItem(!plman.IsPlaylistLocked(this.playlist) && fb.CheckClipboardContents(window.ID) ? MF_STRING : MF_GRAYED, 1005, "Paste");
		_menu.AppendMenuSeparator();
		_context.BuildMenu(_menu, 1);
		var idx = _menu.TrackPopupMenu(x, y);
		switch (idx) {
		case 0:
			break;
		case 1001:
			plman.UndoBackup(this.playlist);
			plman.RemovePlaylistSelection(this.playlist, true);
			break;
		case 1002:
			plman.UndoBackup(this.playlist);
			plman.RemovePlaylistSelection(this.playlist);
			break;
		case 1003:
			fb.CopyHandleListToClipboard(items);
			plman.UndoBackup(this.playlist);
			plman.RemovePlaylistSelection(this.playlist);
			break;
		case 1004:
			fb.CopyHandleListToClipboard(items);
			break;
		case 1005:
			var base = plman.GetPlaylistFocusItemIndex(this.playlist);
			if (base == -1) {
				base = plman.PlaylistItemCount(this.playlist);
			} else {
				base++;
			}
			plman.UndoBackup(this.playlist);
			plman.InsertPlaylistItems(this.playlist, base, fb.GetClipboardContents(window.ID));
			break;
		default:
			_context.ExecuteByID(idx - 1);
			break;
		}
		return true;
	};
};
