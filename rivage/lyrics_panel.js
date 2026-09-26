window.DrawMode = 1;
try { window.EraseOnRepaint = false; } catch (e) {}

// LRCLIB is the primary source. Musixmatch is an optional unofficial fallback
// and must remain explicitly opt-in because its anonymous-token API may change.
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\power_mode.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

window.DefineScript(RivageUI.copy.popupTitle('Lyrics'), { author: 'RivaGe', version: '2.9.1', features: { drag_n_drop: false } });

// Narrow failure reporting. Most empty catches in this file guard host reads
// that are *expected* to fail (an aborted request has no .status, a handle may
// not expose .SubSong) and stay silent on purpose. This is for the few that
// mean something is actually broken and would otherwise leave no trace.
// Repeats are counted and re-logged only at powers of ten, so a failure that
// recurs on every request reports itself without flooding the console.
var reported_failures = {};
function report_failure(what, err) {
	var message = '[RVG Lyrics] ' + what + (err === undefined || err === null ? '' : ': ' + err);
	var seen = (reported_failures[message] || 0) + 1;
	reported_failures[message] = seen;
	if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
	try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

var DT_LEFT = 0x00000000;
var DT_RIGHT = 0x00000002;
var DT_TOP = 0x00000000;
var DT_BOTTOM = 0x00000008;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var MF_STRING = 0x00000000;
var MF_SEPARATOR = 0x00000800;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;

// Raw Win32 flags used by the opt-in warning and host panel-properties gesture.
var MB_YESNO = 0x00000004;
var MB_ICONWARNING = 0x00000030;
var IDYES = 6;

var VK_LWIN = 0x5B;
var VK_RWIN = 0x5C;

var PLAYBACK_STOP_STARTING_ANOTHER = 2;

var DWRITE_TEXT_ALIGNMENT_LEADING = 0;
var DWRITE_TEXT_ALIGNMENT_TRAILING = 1;
var DWRITE_TEXT_ALIGNMENT_CENTER = 2;
var DWRITE_PARAGRAPH_ALIGNMENT_NEAR = 0;
var DWRITE_PARAGRAPH_ALIGNMENT_FAR = 1;
var DWRITE_PARAGRAPH_ALIGNMENT_CENTER = 2;
var DWRITE_WORD_WRAPPING_WRAP = 0;

var SaveMode = { Off: 'off', File: 'file', Tag: 'tag', Both: 'both' };
var Align = { Left: 'left', Center: 'center' };

var opt_musixmatch_enabled = window.GetProperty('lyrics.musixmatch_enabled', false);
var opt_musixmatch_warned = window.GetProperty('lyrics.musixmatch_warned', false);
var opt_save_mode = window.GetProperty('lyrics.save_mode', SaveMode.File);
var opt_tag_field_plain = window.GetProperty('lyrics.tag_field_plain', 'UNSYNCEDLYRICS');
var opt_tag_field_synced = window.GetProperty('lyrics.tag_field_synced', 'SYNCEDLYRICS');
var opt_auto_fetch = window.GetProperty('lyrics.auto_fetch', true);
var opt_click_to_seek = window.GetProperty('lyrics.click_to_seek', true);
var opt_align = window.GetProperty('lyrics.align', Align.Center);
var opt_active_size = window.GetProperty('lyrics.active_size', 18);
var opt_inactive_size = window.GetProperty('lyrics.inactive_size', 14);
var opt_line_font_name = window.GetProperty('lyrics.font_name', '');   // '' = follow host UI font
var opt_colour_inactive = window.GetProperty('lyrics.colour_inactive', 0);  // 0 = follow theme muted text
var AccentMode = { Default: 'default', Custom: 'custom', AlbumArt: 'albumart' };
var opt_accent_mode = window.GetProperty('lyrics.accent_mode', AccentMode.Default);
var opt_accent_custom = window.GetProperty('lyrics.accent_custom', 0);
var opt_show_title = window.GetProperty('lyrics.show_title', true);
var opt_show_source_badge = window.GetProperty('lyrics.show_source_badge', true);
var opt_show_search_button = window.GetProperty('lyrics.show_search_button', true);
var opt_smooth_scroll = window.GetProperty('lyrics.smooth_scroll', true);
var opt_continuous_scroll = window.GetProperty('lyrics.continuous_scroll', false);
var opt_line_gap = window.GetProperty('lyrics.line_gap', 6);
// Only vetted frame rates are accepted; stale property values fall back to 30 fps.
var opt_anim_fps = window.GetProperty('lyrics.anim_fps', 30);
if (opt_anim_fps != 20 && opt_anim_fps != 30 && opt_anim_fps != 60) opt_anim_fps = 30;

var g_dpi = 100;
function zoom(value, percent) { return Math.round(value * (percent || 100) / 100); }
function _scale(value) { return zoom(value, g_dpi); }

function RGB(r, g, b) { return RivageUI.rgb(r, g, b); }
function RGBA(r, g, b, a) { return RivageUI.rgba(r, g, b, a); }
function chan(c, i) { return RivageUI.channel(c, i == 0 ? 16 : (i == 1 ? 8 : 0)); }

var UI_ACCENT = RGB(0, 120, 212);
var shared_album_accent = UI_ACCENT;
var ui_theme = RivageUI.createTheme({ mode: 'host', accent: UI_ACCENT });
var ui = RivageUI.createPainter({ scale: _scale, theme: ui_theme });

var col = {
	bg: RGB(30, 30, 30),
	on_surface: RGB(245, 245, 245),
	on_surface_var: RGB(160, 160, 160),
	outline: RGB(64, 64, 64),
	accent: UI_ACCENT
};
function sync_colours_from_theme() {
	col.bg = ui_theme.background;
	col.on_surface = ui_theme.textPrimary;
	col.on_surface_var = ui_theme.textMuted;
	col.outline = ui_theme.stroke;
	col.accent = ui_theme.accent;
}
function current_accent(baseTheme) {
	if (opt_accent_mode == AccentMode.Custom) return opt_accent_custom || (baseTheme ? baseTheme.accent : UI_ACCENT);
	if (opt_accent_mode == AccentMode.AlbumArt) return shared_album_accent;
	return baseTheme ? baseTheme.accent : UI_ACCENT;
}

// Preserve shared Material surface roles; panel-local accent modes replace accent roles only.
function theme_with_accent(baseTheme, requestedAccent) {
	var themed = {};
	var key;
	for (key in baseTheme) {
		if (baseTheme.hasOwnProperty(key)) themed[key] = baseTheme[key];
	}

	var accent = RivageUI.opaque(requestedAccent);
	var white = RGB(255, 255, 255);
	var darkText = RGB(28, 28, 30);
	themed.accent = accent;
	themed.accentHover = RivageUI.mix(accent, white, 0.16);
	themed.accentPressed = RivageUI.mix(accent, RGB(0, 0, 0), 0.24);
	themed.accentSoft = RivageUI.mix(themed.background, accent, themed.dark ? 0.20 : 0.12);
	themed.accentMuted = RivageUI.mix(themed.textMuted, accent, 0.55);
	themed.onAccent = RivageUI.contrastingForegroundForBackgrounds(
		[accent, themed.accentHover, themed.accentPressed], white, darkText, 3
	);
	if (themed.surface !== undefined) {
		themed.surfacePressed = RivageUI.mix(themed.surface, accent, 0.25);
		themed.surfaceSelected = RivageUI.mix(themed.surface, accent, 0.12);
		themed.surfaceSelectedHover = RivageUI.mix(themed.surface, accent, 0.19);
	}
	return themed;
}
function rebuild_visual_theme() {
	var host = RivageUI.hostInfo();

	var baseTheme = RivageUI.createTheme({ mode: 'host', host: host });
	UI_ACCENT = RivageUI.opaque(baseTheme.accent !== undefined ? baseTheme.accent : host.accent);

	if (opt_accent_mode == AccentMode.Default) {
		ui_theme = baseTheme;
	} else {
		ui_theme = theme_with_accent(baseTheme, current_accent(baseTheme));
	}

	ui.setTheme(ui_theme);
	sync_colours_from_theme();
}
function active_line_colour() { return col.accent; }
function inactive_line_colour() { return opt_colour_inactive || col.on_surface_var; }

// Shared album accent (protocol-compatible consumer only - see
// shared/album_accent_protocol.js and NEW_PANEL_PROMPT.md)
function request_shared_accent() { SharedAccentProtocol.requestAccent(); }

var font_name = 'Segoe UI';
var f_active = null;
var f_inactive = null;
var f_header = null;
var f_body = null;
var f_small = null;
var icon_font_family = 'Segoe MDL2 Assets'; // overwritten by RivageUI.iconFontFamily() in update_fonts()

function gdi_font(name, size, style) { return RivageUI.font(name, size, style || 0); }
function getIconFont(size) { return RivageUI.font(icon_font_family, Math.max(8, Math.round(size))); }
var FONT_STYLE_BOLD = 1;
function update_fonts() {
	var host = RivageUI.hostInfo();
	var scale_size = Number(host.scaleFontSize) || 12;
	font_name = opt_line_font_name || host.fontFamily || 'Segoe UI';
	g_dpi = (isFinite(scale_size) && scale_size > 0) ? Math.max(50, Math.round(scale_size / 12 * 100)) : 100;
	icon_font_family = RivageUI.iconFontFamily();

	RivageUI.clearFontCache();
	wrap_cache = {}; wrap_cache_count = 0;
	text_height_cache = {}; text_height_cache_count = 0;
	f_active = gdi_font(font_name, zoom(opt_active_size, g_dpi), FONT_STYLE_BOLD);
	f_inactive = gdi_font(font_name, zoom(opt_inactive_size, g_dpi), 0);
	f_header = gdi_font(host.fontFamily || 'Segoe UI', zoom(11, g_dpi), 0);
	f_body = gdi_font(host.fontFamily || 'Segoe UI', zoom(13, g_dpi), 0);
	f_small = gdi_font(host.fontFamily || 'Segoe UI', zoom(11, g_dpi), 0);
}
function lh(f, fallbackPt) {
	if (!f) return Math.round((fallbackPt || 14) * 1.4);
	return Math.round(f.Size * 1.4);
}

function text_w(text, font) {
	return (!text || !font) ? 0 : RivageUI.measureText(String(text), font);
}
var wrap_cache = {};
var wrap_cache_count = 0;
function hard_wrap_text(text, font, w) {
	if (!text || !font || w <= 0) return String(text || '');
	var raw = String(text).replace(/\r/g, '');
	var fontName = '', fontSize = 0, fontStyle = 0;
	try { fontName = font.Name || ''; fontSize = font.Size || 0; fontStyle = font.Style || 0; } catch (e) {}
	var key = Math.round(w) + '\u241F' + fontName + '\u241F' + fontSize + '\u241F' + fontStyle + '\u241F' + raw;
	if (wrap_cache.hasOwnProperty(key)) return wrap_cache[key];

	var paragraphs = raw.split('\n');
	var out = [];
	for (var p = 0; p < paragraphs.length; p++) {
		var rest = paragraphs[p];
		if (!rest.length) { out.push(''); continue; }
		while (rest.length) {
			if (text_w(rest, font) <= w) { out.push(rest); break; }

			// Find the largest prefix that actually fits. Prefer a word boundary,
			// but fall back to a character boundary for long tokens/CJK text.
			var lo = 1, hi = rest.length, best = 1;
			while (lo <= hi) {
				var mid = (lo + hi) >> 1;
				if (text_w(rest.substring(0, mid), font) <= w) { best = mid; lo = mid + 1; }
				else hi = mid - 1;
			}
			var probe = rest.substring(0, best);
			var cut = Math.max(probe.lastIndexOf(' '), probe.lastIndexOf('\t'));
			if (cut <= 0) cut = best;
			var line = rest.substring(0, cut).replace(/\s+$/, '');
			if (!line.length) { line = rest.substring(0, best); cut = best; }
			out.push(line);
			rest = rest.substring(cut).replace(/^\s+/, '');
		}
	}
	var wrapped = out.join('\n');
	if (wrap_cache_count > 700) { wrap_cache = {}; wrap_cache_count = 0; }
	wrap_cache[key] = wrapped;
	wrap_cache_count++;
	return wrapped;
}
var text_height_cache = {};
var text_height_cache_count = 0;

function drop_wrap_caches() {
	wrap_cache = {};
	wrap_cache_count = 0;
	text_height_cache = {};
	text_height_cache_count = 0;
}

function wrapped_line_height(font) {
	// Keep measurement and paint on the same line box; narrow GDI multiline layout is inconsistent.
	return Math.max(1, lh(font));
}
function text_h_wrapped(text, font, w) {
	if (!text || !font || w <= 0) return wrapped_line_height(font);
	var wrapped = hard_wrap_text(text, font, Math.max(1, Math.floor(w)));
	var fontName = '', fontSize = 0, fontStyle = 0;
	try { fontName = font.Name || ''; fontSize = font.Size || 0; fontStyle = font.Style || 0; } catch (e) {}
	var key = Math.round(w) + '\u241F' + fontName + '\u241F' + fontSize + '\u241F' + fontStyle + '\u241F' + wrapped;
	if (text_height_cache.hasOwnProperty(key)) return text_height_cache[key];
	var lineCount = wrapped.split('\n').length;
	var h = Math.max(1, lineCount) * wrapped_line_height(font);
	if (text_height_cache_count > 1400) { text_height_cache = {}; text_height_cache_count = 0; }
	text_height_cache[key] = h;
	text_height_cache_count++;
	return h;
}

function write(gr, text, font, colour, x, y, w, h, align, valign, wrap) {
	if (!text || !font || w <= 0 || h <= 0) return;
	align = typeof align == 'number' ? align : DWRITE_TEXT_ALIGNMENT_LEADING;
	valign = typeof valign == 'number' ? valign : DWRITE_PARAGRAPH_ALIGNMENT_NEAR;
	var alignFlag = (align == DWRITE_TEXT_ALIGNMENT_CENTER) ? DT_CENTER :
		(align == DWRITE_TEXT_ALIGNMENT_TRAILING) ? DT_RIGHT : DT_LEFT;

	if (wrap === DWRITE_WORD_WRAPPING_WRAP) {
		// Hard-wrap first because narrow GDI multiline layout is unreliable in this host.
		var wrapped = hard_wrap_text(text, font, Math.max(1, Math.floor(w)));
		var rows = wrapped.split('\n');
		var rowH = wrapped_line_height(font);
		var contentH = rows.length * rowH;
		var startY = y;
		if (valign == DWRITE_PARAGRAPH_ALIGNMENT_CENTER) startY = y + (h - contentH) / 2;
		else if (valign == DWRITE_PARAGRAPH_ALIGNMENT_FAR) startY = y + h - contentH;
		var rowFlags = DT_NOPREFIX | alignFlag | DT_SINGLELINE | DT_VCENTER;
		for (var ri = 0; ri < rows.length; ri++) {
			if (rows[ri].length) gr.GdiDrawText(rows[ri], font, colour, x, startY + ri * rowH, w, rowH, rowFlags);
		}
		return;
	}

	var flags = DT_NOPREFIX | alignFlag | DT_SINGLELINE | DT_END_ELLIPSIS;
	flags |= (valign == DWRITE_PARAGRAPH_ALIGNMENT_CENTER) ? DT_VCENTER :
		(valign == DWRITE_PARAGRAPH_ALIGNMENT_FAR) ? DT_BOTTOM : DT_TOP;
	gr.GdiDrawText(text, font, colour, x, y, w, h, flags);
}
function centre_msg(gr, text, font, colour) {
	write(gr, text, font, colour, lm, 0, ww - lm - rm, wh,
		DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_WORD_WRAPPING_WRAP);
}

var lm = _scale(10), rm = _scale(10), tm = _scale(6);
var ww = 0, wh = 0;

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ms_to_lrc_tag(ms) {
	var totalCs = Math.max(0, Math.round((Number(ms) || 0) / 10));
	var m = Math.floor(totalCs / 6000);
	var rem = totalCs - m * 6000;
	var s = Math.floor(rem / 100);
	var cs = rem - s * 100;
	return '[' + pad2(m) + ':' + pad2(s) + '.' + pad2(cs) + ']';
}
function parse_lrc(text) {
	var lines = [];
	var raw = (text || '').split(/\r?\n/);
	var tagRe = /\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g;
	var offset = 0;
	var offsetMatch = (text || '').match(/\[offset:\s*(-?\d+)\]/i);
	if (offsetMatch) offset = parseInt(offsetMatch[1], 10) || 0;

	for (var i = 0; i < raw.length; i++) {
		var line = raw[i];
		if (!line) continue;
		tagRe.lastIndex = 0;
		var m, times = [], lastIndex = 0;
		while ((m = tagRe.exec(line))) {
			var min = parseInt(m[1], 10);
			var sec = parseFloat(m[2].replace(':', '.'));
			times.push(Math.round((min * 60 + sec) * 1000) + offset);
			lastIndex = tagRe.lastIndex;
		}
		if (!times.length) continue; // non-timed line (metadata tag or plain text) - ignored for synced view
		var txt = line.slice(lastIndex).replace(/^\s+/, '');
		for (var k = 0; k < times.length; k++) lines.push({ t: Math.max(0, times[k]), text: txt });
	}
	lines.sort(function (a, b) { return a.t - b.t; });
	return lines;
}
function lrc_to_plain(lines) {
	var out = [];
	for (var i = 0; i < lines.length; i++) out.push(lines[i].text);
	return out.join('\n');
}
function generate_lrc(lines, meta) {
	var out = [];
	if (meta) {
		if (meta.ar) out.push('[ar:' + meta.ar + ']');
		if (meta.ti) out.push('[ti:' + meta.ti + ']');
		if (meta.al) out.push('[al:' + meta.al + ']');
	}
	var sorted = (lines || []).slice().sort(function (a, b) { return a.t - b.t; });
	for (var i = 0; i < sorted.length; i++) out.push(ms_to_lrc_tag(sorted[i].t) + sorted[i].text);
	return out.join('\n');
}

var tf_artist = fb.TitleFormat('%artist%');
var tf_title = fb.TitleFormat('%title%');
var tf_album = fb.TitleFormat('%album%');

function get_active_handle() {
	return TrackContext.getHandle();
}
function track_fields(handle) {
	return {
		artist: tf_artist.EvalWithMetadb(handle),
		title: tf_title.EvalWithMetadb(handle),
		album: tf_album.EvalWithMetadb(handle),
		duration: Math.round(handle.Length || 0)
	};
}
function track_key(f) { return (f.artist || '') + '\u241F' + (f.title || '') + '\u241F' + (f.album || '') + '\u241F' + f.duration; }
function handle_key(handle) {
	if (!handle) return '';
	var path = '';
	try { path = String(handle.RawPath || handle.Path || ''); } catch (e) {}
	var subsong = 0;
	try { subsong = Number(handle.SubSong) || 0; } catch (e2) {}
	return path + '\u241F' + subsong;
}
function is_local_path(path) {
	if (!path) return false;
	return !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

function find_meta(info, name) {
	if (!info || !name) return '';
	var idx = info.MetaFind(name);
	if (idx < 0) return '';

	// Vorbis-style lyric tags may store one metadata value per line.
	var count = 1;
	var values = [];
	try { count = Math.max(1, Number(info.MetaValueCount(idx)) || 1); } catch (e) { count = 1; }
	for (var i = 0; i < count; i++) {
		try {
			var value = info.MetaValue(idx, i);
			if (value !== undefined && value !== null && String(value).length) values.push(String(value));
		} catch (e2) { }
	}
	return values.join('\n');
}
function read_tag_lyrics(handle) {
	var info = null;
	try { info = handle.GetFileInfo(); } catch (e) { info = null; }
	if (!info) return null;
	var syncedText = find_meta(info, opt_tag_field_synced);
	var plainText = find_meta(info, opt_tag_field_plain);
	if (!syncedText && !plainText) return null;
	var lines = syncedText ? parse_lrc(syncedText) : [];
	return { synced: !!lines.length, lines: lines, plain: plainText || (lines.length ? lrc_to_plain(lines) : ''), source: 'tag' };
}
function tag_fields_conflict(syncedName, plainName) {
	var a = String(syncedName || '').trim().toLowerCase();
	var b = String(plainName || '').trim().toLowerCase();
	return !!a && a == b;
}
function write_tag_lyrics(handle, data) {
	if (!handle || !data || data.instrumental) return false;
	var obj = {};
	var syncedText = data.synced ? generate_lrc(data.lines, data.meta) : '';
	var plainText = data.plain || (data.lines && data.lines.length ? lrc_to_plain(data.lines) : '');
	if (tag_fields_conflict(opt_tag_field_synced, opt_tag_field_plain)) {
		if (opt_tag_field_synced) obj[opt_tag_field_synced] = data.synced ? syncedText : plainText;
	} else {
		if (opt_tag_field_synced) obj[opt_tag_field_synced] = syncedText;
		if (opt_tag_field_plain) obj[opt_tag_field_plain] = plainText;
	}
	try {
		var list = new FbMetadbHandleList(handle);
		list.UpdateFileInfoFromJSON(JSON.stringify(obj));
		return true;
	} catch (e) { report_failure('lyrics tag write failed', e); return false; }
}

function lrc_path_for(handle) {
	if (!handle) return '';
	try { if ((Number(handle.SubSong) || 0) > 0) return ''; } catch (e) {}
	var p = handle.Path;
	if (!p || !is_local_path(p)) return '';
	var dot = p.lastIndexOf('.');
	var slash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
	var base = (dot > slash) ? p.substring(0, dot) : p;
	return base + '.lrc';
}
function read_file_lyrics(handle) {
	var path = lrc_path_for(handle);
	if (!path) return null;
	try {
		if (!utils.FileExists(path)) return null;
		var text = utils.ReadTextFile(path);
		if (!text) return null;
		var lines = parse_lrc(text);
		return { synced: !!lines.length, lines: lines, plain: lines.length ? lrc_to_plain(lines) : text, source: 'file' };
	} catch (e) { return null; }
}
function write_file_lyrics(handle, data) {
	var path = lrc_path_for(handle);
	if (!path) return false;
	try {
		var content = data.synced ? generate_lrc(data.lines, data.meta) : (data.plain || '');
		utils.WriteTextFile(path, content);
		return true;
	} catch (e) { report_failure('.lrc file write failed', e); return false; }
}
function save_lyrics(handle, data) {
	if (!handle || !data || data.instrumental) return;
	if (opt_save_mode == SaveMode.File || opt_save_mode == SaveMode.Both) write_file_lyrics(handle, data);
	if (opt_save_mode == SaveMode.Tag || opt_save_mode == SaveMode.Both) {
		if (write_tag_lyrics(handle, data)) data.saved_to_tag = true;
	}
}

var HTTP_TIMEOUT_MS = 15000;
var request_token = 0;
var search_request_token = 0;
var script_active = true;
var active_http_cancels = [];
var http_retry_timers = [];

function request_is_current(token) {
	if (!script_active) return false;
	if (token && typeof token == 'object' && token.kind == 'search') return token.id == search_request_token;
	return token == null || token == request_token;
}
function remove_array_value(list, value) {
	for (var i = list.length - 1; i >= 0; i--) if (list[i] === value) list.splice(i, 1);
}
function cancel_all_http() {
	var pending = active_http_cancels.slice();
	active_http_cancels = [];
	for (var i = 0; i < pending.length; i++) { try { pending[i](); } catch (e) {} }
	for (i = 0; i < http_retry_timers.length; i++) { try { window.ClearTimeout(http_retry_timers[i]); } catch (e2) {} }
	http_retry_timers = [];
}
function build_query(params) {
	var parts = [];
	for (var k in params) {
		if (params[k] === undefined || params[k] === null || params[k] === '') continue;
		parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
	}
	return parts.join('&');
}
function merge_obj(a, b) {
	var o = {}, k;
	for (k in a) o[k] = a[k];
	for (k in b) o[k] = b[k];
	return o;
}
function http_get(url, headers, token, done) {
	var http = null, watchdog = null, finished = false;

	// XMLHTTP holds the JS ready-state handler through COM while the closure holds
	// XMLHTTP. Break that cycle on every settle/cancel path or long sessions leak.
	function release_http() {
		if (!http) return;
		var dead = http;
		http = null;
		try { dead.onreadystatechange = null; } catch (e) {}
	}
	function cancel() {
		if (finished) return;
		finished = true;
		if (watchdog) { try { window.ClearTimeout(watchdog); } catch (e) {} watchdog = null; }
		if (http) { try { http.abort(); } catch (e2) {} }
		release_http();
		remove_array_value(active_http_cancels, cancel);
	}
	function finish(status, body, retryAfter) {
		if (finished) return;
		finished = true;
		if (watchdog) { window.ClearTimeout(watchdog); watchdog = null; }
		release_http();
		remove_array_value(active_http_cancels, cancel);
		if (!request_is_current(token)) return;
		done(status, body, retryAfter);
	}
	active_http_cancels.push(cancel);
	try { http = new ActiveXObject('Microsoft.XMLHTTP'); } catch (e) { finish(0, null, ''); return; }
	try {
		http.open('GET', url, true);
		for (var k in headers) { try { http.setRequestHeader(k, headers[k]); } catch (e2) {} }
		http.onreadystatechange = function () {
			if (!http || http.readyState != 4) return;
			var status = 0, body = null, retryAfter = '';
			try { status = http.status; } catch (e3) {}
			try { body = http.responseText; } catch (e4) {}
			try { retryAfter = http.getResponseHeader('Retry-After') || ''; } catch (e5) {}
			finish(status, body, retryAfter);
		};
		watchdog = window.SetTimeout(function () {
			watchdog = null;
			if (http) { try { http.abort(); } catch (e6) {} }
			finish(0, null, '');
		}, HTTP_TIMEOUT_MS);
		http.send();
	} catch (e7) { finish(0, null, ''); }
}

var LRCLIB_BASE = 'https://lrclib.net/api';
var LRCLIB_UA = 'RVGLyricsPanel/2.7.0 (https://github.com/dima-lur/jsplitter)';
var LRCLIB_MAX_RETRY_MS = 300000;

function lrclib_duration(value) {
	value = Math.round(Number(value) || 0);
	return value >= 1 && value <= 3600 ? value : null;
}
function lrclib_retry_delay(retryAfter) {
	var seconds = Number(retryAfter);
	var delay = isFinite(seconds) && seconds >= 0 ? seconds * 1000 : NaN;
	if (!isFinite(delay) && retryAfter) {
		var when = Date.parse(String(retryAfter));
		if (isFinite(when)) delay = when - new Date().getTime();
	}
	if (!isFinite(delay)) return 0;
	delay = Math.max(1000, Math.ceil(delay));
	return delay <= LRCLIB_MAX_RETRY_MS ? delay : 0;
}
function schedule_lrclib_retry(token, retryAfter, retryFn, failFn) {
	var delay = lrclib_retry_delay(retryAfter);
	if (!delay) { failFn(); return; }
	var id = window.SetTimeout(function () {
		remove_array_value(http_retry_timers, id);
		if (request_is_current(token)) retryFn();
	}, delay);
	http_retry_timers.push(id);
}
function lrclib_get(fields, token, cb, attempt) {
	attempt = attempt || 0;
	var url = LRCLIB_BASE + '/get?' + build_query({
		artist_name: fields.artist, track_name: fields.title,
		album_name: fields.album, duration: lrclib_duration(fields.duration)
	});
	http_get(url, { 'User-Agent': LRCLIB_UA }, token, function (status, body, retryAfter) {
		if (status == 429 && attempt < 1) {
			schedule_lrclib_retry(token, retryAfter, function () { lrclib_get(fields, token, cb, attempt + 1); }, function () { cb(null); });
			return;
		}
		if (status != 200) { cb(null); return; }
		var json = null;
		// Without this, a provider returning malformed JSON is indistinguishable
		// from the provider simply having no lyrics for the track.
		try { json = JSON.parse(body); }
		catch (e) { report_failure('LRCLIB get returned malformed JSON', e); }
		cb(json && json.id ? json : null);
	});
}
function lrclib_search(fields, token, cb, attempt) {
	attempt = attempt || 0;
	var url = LRCLIB_BASE + '/search?' + build_query({ artist_name: fields.artist, track_name: fields.title });
	http_get(url, { 'User-Agent': LRCLIB_UA }, token, function (status, body, retryAfter) {
		if (status == 429 && attempt < 1) {
			schedule_lrclib_retry(token, retryAfter, function () { lrclib_search(fields, token, cb, attempt + 1); }, function () { cb([]); });
			return;
		}
		if (status != 200) { cb([]); return; }
		var json = null;
		try { json = JSON.parse(body); }
		catch (e) { report_failure('LRCLIB search returned malformed JSON', e); }
		cb(json instanceof Array ? json : []);
	});
}
function lrclib_item_to_data(item) {
	var lines = item.syncedLyrics ? parse_lrc(item.syncedLyrics) : [];
	return {
		synced: !!lines.length, lines: lines,
		plain: item.plainLyrics || (lines.length ? lrc_to_plain(lines) : ''),
		instrumental: !!item.instrumental,
		source: 'lrclib', meta: { ar: item.artistName, ti: item.trackName, al: item.albumName }
	};
}
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function pick_best_lrclib_match(list, fields) {
	if (!list || !list.length) return null;
	var wantArtist = norm(fields.artist), wantTitle = norm(fields.title);
	var exactSynced = null, exactAny = null, anySynced = null, anyAny = null;
	for (var i = 0; i < list.length; i++) {
		var it = list[i];
		var isExact = norm(it.artistName) == wantArtist && norm(it.trackName) == wantTitle;
		var isSynced = !!it.syncedLyrics;
		var hasLyrics = !!(it.syncedLyrics || it.plainLyrics || it.instrumental);
		if (isExact && isSynced && !exactSynced) exactSynced = it;
		if (isExact && hasLyrics && !exactAny) exactAny = it;
		if (isSynced && !anySynced) anySynced = it;
		if (hasLyrics && !anyAny) anyAny = it;
	}
	return exactSynced || exactAny || anySynced || anyAny;
}

var MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';
var MXM_APP_ID = 'web-desktop-app-v1.0';
var MXM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function mxm_get_token(token, cb) {
	var cached = window.GetProperty('lyrics.mxm_token', '');
	if (cached) { cb(cached); return; }
	var url = MXM_BASE + '/token.get?' + build_query({ app_id: MXM_APP_ID, format: 'json' });
	http_get(url, { 'User-Agent': MXM_UA }, token, function (status, text) {
		var t = null;
		if (status == 200) {
			try {
				var json = JSON.parse(text);
				var body = json && json.message && json.message.body;
				if (body && body.user_token) t = body.user_token;
			} catch (e) { report_failure('Musixmatch token response was malformed', e); }
		}
		// Losing the cache is not fatal, but it means a fresh token fetch per request.
		if (t) {
			try { window.SetProperty('lyrics.mxm_token', t); }
			catch (e2) { report_failure('Musixmatch token could not be cached', e2); }
		}
		cb(t);
	});
}
function mxm_call(method, params, token, cb) {
	mxm_get_token(token, function (userToken) {
		if (!userToken) { cb(null); return; }
		var p = merge_obj(params, { usertoken: userToken, app_id: MXM_APP_ID, format: 'json' });
		var url = MXM_BASE + '/' + method + '?' + build_query(p);
		http_get(url, { 'User-Agent': MXM_UA }, token, function (status, text) {
			if (status != 200) { cb(null); return; }
			var json = null;
			try { json = JSON.parse(text); }
			catch (e) { report_failure('Musixmatch ' + method + ' returned malformed JSON', e); }
			var hdr = json && json.message && json.message.header;
			if (!hdr || hdr.status_code != 200) {
				// A rejected cached token must not poison future requests.
				if (hdr && (hdr.status_code == 401 || hdr.status_code == 400)) {
					try { window.SetProperty('lyrics.mxm_token', ''); }
					catch (e2) { report_failure('rejected Musixmatch token could not be cleared', e2); }
				}
				cb(null);
				return;
			}
			cb(json.message.body);
		});
	});
}
function mxm_search(fields, token, cb) {
	mxm_call('track.search', { q_track: fields.title, q_artist: fields.artist, page_size: 10, s_track_rating: 'desc' }, token, function (body) {
		var list = body && body.track_list;
		if (!list || !list.length) { cb([]); return; }
		var out = [];
		for (var i = 0; i < list.length; i++) if (list[i] && list[i].track) out.push(list[i].track);
		cb(out);
	});
}
// Do not persist Musixmatch's appended footer/id lines into user files or tags.
function strip_mxm_watermark(text) {
	if (!text) return '';
	var raw = String(text).split(/\r?\n/);
	var out = [];
	for (var i = 0; i < raw.length; i++) {
		var line = raw[i];
		if (/^\s*\*{3,}.*\*{3,}\s*$/.test(line)) continue;   // *** ... NOT for Commercial use ... ***
		if (/^\s*\(\d{6,}\)\s*$/.test(line)) continue;        // (1409622382653)
		out.push(line);
	}
	while (out.length && !/\S/.test(out[out.length - 1])) out.pop();
	return out.join('\n');
}

function mxm_lyrics_for_track(trackObj, token, cb) {
	var meta = { ar: trackObj.artist_name, ti: trackObj.track_name, al: trackObj.album_name };

	function fetch_plain() {
		if (!trackObj.has_lyrics) { cb(null); return; }
		mxm_call('track.lyrics.get', { track_id: trackObj.track_id }, token, function (body) {
			var ly = strip_mxm_watermark(body && body.lyrics && body.lyrics.lyrics_body);
			cb(ly ? { synced: false, lines: [], plain: ly, source: 'musixmatch', meta: meta } : null);
		});
	}

	if (trackObj.has_subtitles) {
		mxm_call('track.subtitle.get', { track_id: trackObj.track_id, subtitle_format: 'lrc' }, token, function (body) {
			var lrcText = body && body.subtitle && body.subtitle.subtitle_body;
			var lines = lrcText ? parse_lrc(lrcText) : [];
			// Anonymous tokens can report subtitles but return an empty body; fall back to plain lyrics.
			if (!lines.length) { fetch_plain(); return; }
			cb({ synced: true, lines: lines, plain: lrc_to_plain(lines), source: 'musixmatch', meta: meta });
		});
	} else fetch_plain();
}
function musixmatch_fetch(fields, token, cb) {
	mxm_search(fields, token, function (list) {
		if (!list.length) { cb(null); return; }
		var wantArtist = norm(fields.artist), wantTitle = norm(fields.title);
		var i, best = null;
		for (i = 0; i < list.length; i++) {
			if (norm(list[i].artist_name) == wantArtist && norm(list[i].track_name) == wantTitle) { best = list[i]; break; }
		}
		if (!best) best = list[0];
		mxm_lyrics_for_track(best, token, cb);
	});
}

var STATE = { NO_TRACK: 0, LOADING: 1, READY: 2, NOT_FOUND: 3 };
var state = STATE.NO_TRACK;
var current_handle_ref = null;
var current_fields = null;
var current_track_key = '';
var current_handle_key = '';
var current_data = null;
var refresh_timer = null;
var refresh_generation = 0;
var refresh_force = false;

// -2 = "nothing painted yet" (distinct from -1 = "before the first line").
var last_painted_idx = -2;
// Centres stay continuous when active/inactive font heights differ.
var last_line_centres = {}; // line index -> actual painted centre-y (px)
// One self-scheduling timer owns all lyric visual animation.
var anim_loop_running = false;
var anim_timer_id = 0;
var anim_next_frame_ms = 0;
var scroll_anim_from_centres = {};
var scroll_anim_to_centres = {};
var scroll_anim_start = 0;
var scroll_anim_running = false;
var active_fade_idx = -1;
var active_fade_start = 0;
var active_fade_running = false;
// Freeze fade endpoints so asynchronous theme notifications cannot bend an in-flight colour transition.
var active_fade_from_colour = 0;
var active_fade_to_colour = 0;
var SCROLL_ANIM_MS = 460;
var ACTIVE_FADE_MS = 500;
// Interpolate between coarse host PlaybackTime callbacks with a monotonic wall clock.
var visual_clock_ms = 0;
var visual_clock_wall = 0;
var visual_clock_valid = false;
var visual_clock_last_returned_ms = 0;

function anim_now() {
	try {
		if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
	} catch (e) { }
	return (Date.now ? Date.now() : new Date().getTime());
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
function displayed_source_uses_playback() {
	if (!current_handle_ref) return false;
	var nowPlaying = null;
	try { nowPlaying = fb.IsPlaying ? fb.GetNowPlaying() : null; } catch (e) {}
	return !!nowPlaying && handle_key(nowPlaying) == current_handle_key;
}
function playback_is_advancing() {
	if (!displayed_source_uses_playback()) return false;
	var paused = false;
	try { paused = !!fb.IsPaused; } catch (e) {}
	return !!fb.IsPlaying && !paused;
}
function sync_visual_clock(seconds, force) {
	var hostMs = Math.max(0, Number(seconds) * 1000 || 0);
	var now = anim_now();
	if (!visual_clock_valid || force) {
		visual_clock_ms = hostMs;
		visual_clock_wall = now;
		visual_clock_valid = true;
		visual_clock_last_returned_ms = hostMs;
		return;
	}

	var estimate = visual_clock_ms + (playback_is_advancing() ? now - visual_clock_wall : 0);
	var error = hostMs - estimate;
	if (Math.abs(error) > 500) {
		estimate = hostMs;
	} else if (error > 0) {
		// Never apply small backward corrections; they are visible as lyric bobble.
		estimate += Math.min(12, error * 0.10);
	}
	if (playback_is_advancing() && estimate < visual_clock_last_returned_ms) estimate = visual_clock_last_returned_ms;
	visual_clock_ms = estimate;
	visual_clock_wall = now;
}
function visual_playback_ms() {
	if (!displayed_source_uses_playback()) return 0;
	if (!visual_clock_valid) {
		var initial = 0;
		try { initial = Number(fb.PlaybackTime) || 0; } catch (e) {}
		sync_visual_clock(initial, true);
	}
	var value = visual_clock_ms + (playback_is_advancing() ? anim_now() - visual_clock_wall : 0);
	if (playback_is_advancing()) {
		if (value < visual_clock_last_returned_ms) value = visual_clock_last_returned_ms;
		else visual_clock_last_returned_ms = value;
	}
	return value;
}
function continuous_scroll_should_tick() {
	return opt_continuous_scroll && state == STATE.READY && current_data && current_data.synced &&
		current_data.lines && current_data.lines.length && playback_is_advancing();
}
// Continuous mode caches stable max-height slots so active-font changes never reflow neighbours.
var stable_layout_cache = { lines: null, w: -1, gap: -1, fontKey: '', centres: null, heights: null };
function build_stable_line_centres(lines, avail_w, gap) {
	var fontKey = '';
	try {
		fontKey = f_inactive.Name + ':' + f_inactive.Size + ':' + f_inactive.Style + '|' +
			f_active.Name + ':' + f_active.Size + ':' + f_active.Style;
	} catch (e) {}
	if (stable_layout_cache.lines === lines && stable_layout_cache.w == avail_w &&
		stable_layout_cache.gap == gap && stable_layout_cache.fontKey == fontKey && stable_layout_cache.centres) {
		return stable_layout_cache.centres;
	}
	var centres = {};
	var heights = {};
	if (!lines || !lines.length) return centres;
	var prevH = Math.max(
		text_h_wrapped(lines[0].text, f_inactive, avail_w),
		text_h_wrapped(lines[0].text, f_active, avail_w)
	);
	heights[0] = prevH;
	centres[0] = prevH / 2;
	for (var i = 1; i < lines.length; i++) {
		var h = Math.max(
			text_h_wrapped(lines[i].text, f_inactive, avail_w),
			text_h_wrapped(lines[i].text, f_active, avail_w)
		);
		heights[i] = h;
		centres[i] = centres[i - 1] + prevH / 2 + gap + h / 2;
		prevH = h;
	}
	stable_layout_cache.lines = lines;
	stable_layout_cache.w = avail_w;
	stable_layout_cache.gap = gap;
	stable_layout_cache.fontKey = fontKey;
	stable_layout_cache.centres = centres;
	stable_layout_cache.heights = heights;
	return centres;
}
function line_anchor_offset(baseCentres, idx, centreY) {
	return centreY - baseCentres[idx];
}
function safe_segment_slope(y0, y1, t0, t1) {
	var dt = t1 - t0;
	return dt > 0 ? (y1 - y0) / dt : 0;
}
// Monotone PCHIP tangents prevent scroll overshoot/reversal.
function monotone_tangent(d0, d1, h0, h1) {
	if (!isFinite(d0) || !isFinite(d1) || d0 == 0 || d1 == 0 || d0 * d1 <= 0) return 0;
	var w1 = 2 * h1 + h0;
	var w2 = h1 + 2 * h0;
	return (w1 + w2) / (w1 / d0 + w2 / d1);
}
function continuous_scroll_offset(lines, baseCentres, idx, centreY, ms) {
	if (idx < 0 || !lines.length) return 0;
	if (idx >= lines.length - 1) return line_anchor_offset(baseCentres, idx, centreY);

	var t0 = Number(lines[idx].t) || 0;
	var t1 = Number(lines[idx + 1].t) || t0;
	if (t1 <= t0) return line_anchor_offset(baseCentres, idx + 1, centreY);
	var h = t1 - t0;
	var p = clamp01((ms - t0) / h);
	var y0 = line_anchor_offset(baseCentres, idx, centreY);
	var y1 = line_anchor_offset(baseCentres, idx + 1, centreY);
	var d = safe_segment_slope(y0, y1, t0, t1);

	var m0 = d, m1 = d;
	if (idx > 0) {
		var tp = Number(lines[idx - 1].t) || t0;
		var yp = line_anchor_offset(baseCentres, idx - 1, centreY);
		var hp = Math.max(1, t0 - tp);
		var dp = safe_segment_slope(yp, y0, tp, t0);
		m0 = monotone_tangent(dp, d, hp, h);
	}
	if (idx + 2 < lines.length) {
		var tn = Number(lines[idx + 2].t) || t1;
		var yn = line_anchor_offset(baseCentres, idx + 2, centreY);
		var hn = Math.max(1, tn - t1);
		var dn = safe_segment_slope(y1, yn, t1, tn);
		m1 = monotone_tangent(d, dn, h, hn);
	}

	var p2 = p * p, p3 = p2 * p;
	var h00 = 2 * p3 - 3 * p2 + 1;
	var h10 = p3 - 2 * p2 + p;
	var h01 = -2 * p3 + 3 * p2;
	var h11 = p3 - p2;
	return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}
function blend_colour(a, b, t) {
	t = clamp01(t);
	return RGB(
		Math.round(chan(a, 0) + (chan(b, 0) - chan(a, 0)) * t),
		Math.round(chan(a, 1) + (chan(b, 1) - chan(a, 1)) * t),
		Math.round(chan(a, 2) + (chan(b, 2) - chan(a, 2)) * t)
	);
}
function clone_number_map(src) {
	var out = {};
	for (var k in src) if (src.hasOwnProperty(k)) out[k] = src[k];
	return out;
}
function anim_frame_interval_ms() {
	return Math.max(8, 1000 / Math.max(1, RivagePowerMode.fps(opt_anim_fps)));
}
// Visibility is part of timer liveness so hidden panels do not keep re-arming animation ticks.
function anim_timer_should_run() {
	return VisiblePaintWork.isVisible() && (scroll_anim_running || active_fade_running || continuous_scroll_should_tick());
}
function stop_visual_anim_timer() {
	anim_loop_running = false;
	if (anim_timer_id) { try { window.ClearTimeout(anim_timer_id); } catch (e) { } anim_timer_id = 0; }
	anim_next_frame_ms = 0;
}
function schedule_visual_anim_tick() {
	if (!anim_loop_running || anim_timer_id) return;
	var delay = Math.max(0, anim_next_frame_ms - anim_now());
	anim_timer_id = window.SetTimeout(run_visual_anim_tick, delay);
}
function run_visual_anim_tick() {
	anim_timer_id = 0;
	if (!anim_loop_running) return;

	var now = anim_now();
	if (scroll_anim_running && now - scroll_anim_start >= SCROLL_ANIM_MS) scroll_anim_running = false;
	if (active_fade_running && now - active_fade_start >= ACTIVE_FADE_MS) active_fade_running = false;

	if (!anim_timer_should_run()) { stop_visual_anim_timer(); return; }

	window.Repaint();

	// Advance from the ideal phase and skip missed slots instead of burst-catching up.
	var interval = anim_frame_interval_ms();
	anim_next_frame_ms += interval;
	var after = anim_now();
	if (anim_next_frame_ms <= after) {
		anim_next_frame_ms += (Math.floor((after - anim_next_frame_ms) / interval) + 1) * interval;
	}
	schedule_visual_anim_tick();
}
function ensure_visual_anim_timer() {
	if (anim_loop_running) return;
	if (!anim_timer_should_run()) return;
	anim_loop_running = true;
	anim_next_frame_ms = anim_now() + anim_frame_interval_ms();
	schedule_visual_anim_tick();
}
function begin_scroll_animation(fromCentres, toCentres) {
	scroll_anim_from_centres = clone_number_map(fromCentres);
	scroll_anim_to_centres = clone_number_map(toCentres);
	scroll_anim_start = anim_now();
	scroll_anim_running = true;
	ensure_visual_anim_timer();
}
function scroll_anim_progress() {
	if (!scroll_anim_running) return 1;
	return smoothstep((anim_now() - scroll_anim_start) / SCROLL_ANIM_MS);
}
function begin_active_fade(idx) {
	active_fade_idx = idx;
	active_fade_start = anim_now();
	active_fade_running = idx >= 0;
	if (active_fade_running) {
		active_fade_from_colour = RivageUI.opaque(inactive_line_colour());
		active_fade_to_colour = RivageUI.opaque(active_line_colour());
		ensure_visual_anim_timer();
	}
}
function active_line_paint_colour(idx) {
	if (idx < 0 || idx != active_fade_idx || !active_fade_running) return active_line_colour();
	var p = smoothstep((anim_now() - active_fade_start) / ACTIVE_FADE_MS);
	return blend_colour(active_fade_from_colour, active_fade_to_colour, p);
}
function reset_visual_animation() {
	stop_visual_anim_timer();
	scroll_anim_running = false;
	active_fade_running = false;
	active_fade_idx = -1;
	active_fade_from_colour = 0;
	active_fade_to_colour = 0;
	last_line_centres = {};
	scroll_anim_from_centres = {};
	scroll_anim_to_centres = {};
	visual_clock_valid = false;
	visual_clock_last_returned_ms = 0;
}

function set_state(s) { state = s; window.Repaint(); }

function apply_data(data) {
	drop_wrap_caches();

	current_data = data;
	static_scroll = 0;
	last_painted_idx = -2;
	reset_visual_animation();
	state = STATE.READY;
	window.Repaint(true);
}

// Preserve LRCLIB plain text as fallback while allowing the opt-in source to upgrade it to synced lyrics.
function fetch_online(fields, token, cb) {
	lrclib_get(fields, token, function (item) {
		if (!request_is_current(token)) return;
		var exact = item ? lrclib_item_to_data(item) : null;
		if (exact && (exact.synced || exact.instrumental)) { cb(exact); return; }

		lrclib_search(fields, token, function (list) {
			if (!request_is_current(token)) return;
			var best = pick_best_lrclib_match(list, fields);
			var searched = best ? lrclib_item_to_data(best) : null;
			if (searched && (searched.synced || searched.instrumental)) { cb(searched); return; }

			var lrclib_fallback = exact || searched;
			if (!opt_musixmatch_enabled) { cb(lrclib_fallback); return; }

			musixmatch_fetch(fields, token, function (mxm_data) {
				if (!request_is_current(token)) return;
				if (mxm_data && mxm_data.synced) { cb(mxm_data); return; }
				cb(lrclib_fallback || mxm_data);
			});
		});
	});
}

var UPGRADE_ATTEMPTED_LIMIT = 400;
var upgrade_attempted = {};
var upgrade_attempted_count = 0;

function mark_upgrade_attempted(key) {
	if (upgrade_attempted[key]) return;
	if (upgrade_attempted_count >= UPGRADE_ATTEMPTED_LIMIT) {
		upgrade_attempted = {};
		upgrade_attempted_count = 0;
	}
	upgrade_attempted[key] = true;
	upgrade_attempted_count++;
}

function invalidate_online_requests() {
	request_token++;
	search_request_token++;
	search_overlay = null;
	search_links = [];
	search_scroll = 0;
	cancel_all_http();
}
function clear_current_source() {
	invalidate_online_requests();
	search_overlay = null;
	search_links = [];
	search_scroll = 0;
	current_handle_ref = null;
	current_handle_key = '';
	current_fields = null;
	current_track_key = '';
	current_data = null;
	static_scroll = 0;
	drop_wrap_caches();
	last_painted_idx = -2;
	reset_visual_animation();
	set_state(STATE.NO_TRACK);
}
function load_lyrics_for_track(handle, forceOnline) {
	if (!handle) { clear_current_source(); return; }
	invalidate_online_requests();
	search_overlay = null;
	search_links = [];
	search_scroll = 0;
	var fields = track_fields(handle);
	var key = track_key(fields);
	current_handle_ref = handle;
	current_handle_key = handle_key(handle);
	current_fields = fields;
	current_track_key = key;
	var token = request_token;

	var localData = null;
	if (!forceOnline) {
		var tagData = read_tag_lyrics(handle);
		if (tagData && (tagData.synced || tagData.plain)) localData = tagData;
		if (!localData || !localData.synced) {
			var fileData = read_file_lyrics(handle);
			if (fileData && (fileData.synced || fileData.plain) && (!localData || (fileData.synced && !localData.synced))) localData = fileData;
		}
	}
	if (localData && localData.synced) { apply_data(localData); return; }
	if (localData) apply_data(localData);
	if (localData && !forceOnline && upgrade_attempted[key]) return;

	if (!opt_auto_fetch && !forceOnline) {
		if (!localData) set_state(STATE.NOT_FOUND);
		return;
	}
	if (!localData) set_state(STATE.LOADING);
	mark_upgrade_attempted(key);
	fetch_online(fields, token, function (data) {
		if (!request_is_current(token)) return;
		if (data) { apply_data(data); save_lyrics(handle, data); }
		else if (!localData) set_state(STATE.NOT_FOUND);
	});
}
function refresh_active_source(force) {
	if (!script_active) return;
	var handle = get_active_handle();
	if (!handle) { clear_current_source(); return; }
	if (!force && current_handle_ref && handle_key(handle) == current_handle_key && current_data) return;
	load_lyrics_for_track(handle, false);
}
var source_work_generation = 0;
var source_refresh_work = VisiblePaintWork.create(function () {
	var force = refresh_force;
	refresh_force = false;
	refresh_active_source(force);
});
function request_visible_source_refresh(force) {
	if (force) refresh_force = true;
	source_refresh_work.request(String(++source_work_generation));
}
function schedule_refresh(force) {
	if (!get_active_handle()) {
		refresh_generation++;
		if (refresh_timer) { window.ClearTimeout(refresh_timer); refresh_timer = null; }
		refresh_force = false;
		clear_current_source();
		return;
	}
	invalidate_online_requests();
	if (force) refresh_force = true;
	var generation = ++refresh_generation;
	if (refresh_timer) { window.ClearTimeout(refresh_timer); refresh_timer = null; }
	refresh_timer = window.SetTimeout(function () {
		if (generation != refresh_generation || !script_active) return;
		refresh_timer = null;
		request_visible_source_refresh(false);
	}, 250);
}

var search_overlay = null;
var search_links = [];
var search_scroll = 0;

function cancel_manual_search(repaint) {
	search_request_token++;
	search_overlay = null;
	search_links = [];
	search_scroll = 0;
	if (repaint) window.Repaint();
}
function clamp_search_scroll() {
	if (!search_overlay || search_overlay.loading) { search_scroll = 0; return; }
	var top = tm + lh(f_small) + _scale(6);
	var rowH = lh(f_body) + lh(f_small) + _scale(8);
	var contentH = search_overlay.results.length * rowH;
	var viewportH = Math.max(0, wh - top);
	var minScroll = Math.min(0, viewportH - contentH);
	if (search_scroll > 0) search_scroll = 0;
	if (search_scroll < minScroll) search_scroll = minScroll;
}
function run_manual_search(query) {
	var parts = query.split(' - ');
	var fields = parts.length >= 2
		? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), album: '', duration: 0 }
		: { artist: '', title: query.trim(), album: '', duration: 0 };

	search_scroll = 0;
	search_overlay = { query: query, loading: true, results: [] };
	window.Repaint();
	var token = { kind: 'search', id: ++search_request_token };

	lrclib_search(fields, token, function (list) {
		if (!request_is_current(token)) return;
		var results = [];
		for (var i = 0; i < list.length; i++) {
			var it = list[i];
			results.push({
				source: 'lrclib', artist: it.artistName, title: it.trackName, album: it.albumName,
				synced: !!it.syncedLyrics, instrumental: !!it.instrumental, data: lrclib_item_to_data(it)
			});
		}
		function finish_search() {
			if (!request_is_current(token)) return;
			search_overlay = { query: query, loading: false, results: results };
			clamp_search_scroll();
			window.Repaint();
		}
		if (opt_musixmatch_enabled) {
			mxm_search(fields, token, function (mxList) {
				if (!request_is_current(token)) return;
				for (var j = 0; j < mxList.length; j++) {
					var t = mxList[j];
					results.push({
						source: 'musixmatch', artist: t.artist_name, title: t.track_name, album: t.album_name,
						synced: !!t.has_subtitles, track: t
					});
				}
				finish_search();
			});
		} else finish_search();
	});
}
function pick_search_result(r) {
	if (!current_handle_ref) return;
	var handle = current_handle_ref;
	invalidate_online_requests();
	if (r.data) {
		apply_data(r.data);
		save_lyrics(handle, r.data);
		return;
	}
	if (r.track) {
		var token = request_token;
		set_state(STATE.LOADING);
		mxm_lyrics_for_track(r.track, token, function (data) {
			if (!request_is_current(token)) return;
			if (data) { apply_data(data); save_lyrics(handle, data); }
			else set_state(STATE.NOT_FOUND);
		});
	}
}
function open_manual_search() {
	var seed = current_fields ? (current_fields.artist + ' - ' + current_fields.title) : '';
	var q = utils.InputBox(window.ID, 'Search for lyrics by artist and title, or enter a title:', window.Name, seed, false);
	if (typeof q == 'string' && q.length) run_manual_search(q);
}

function line_index_at(ms) {
	var lines = current_data && current_data.lines;
	if (!lines || !lines.length) return -1;
	var lo = 0, hi = lines.length - 1, ans = -1;
	while (lo <= hi) {
		var mid = (lo + hi) >> 1;
		if (lines[mid].t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
	}
	return ans;
}

var links = [];
var hover_id = '';
var down_id = '';
function add_link(id, x, y, w, h) { links.push({ id: id, x: x, y: y, w: w, h: h }); }
function link_at(x, y) {
	if (RivageUI.pointInRect(x, y, searchRect)) return null; // icon button owns that corner
	for (var i = 0; i < links.length; i++) {
		var l = links[i];
		if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l;
	}
	return null;
}

var SEARCH_GLYPH = String.fromCharCode(0xE721); // "Zoom" / search glyph, Segoe MDL2 Assets
var SOURCE_WEB_GLYPH = String.fromCharCode(0xE909); // "World"
var SOURCE_LOCAL_GLYPH = String.fromCharCode(0xE8EC); // "Tag"
var SOURCE_SAVED_GLYPH = String.fromCharCode(0xE74E); // "Save" (floppy disk), Segoe MDL2 Assets
var SEARCH_BUTTON_SIZE = 22;
var SEARCH_BUTTON_MIN_SIZE = 14;
var searchRect = null;
var searchHovered = false;
var searchPressed = false;

function layout_search_button() {
	var margin, side;
	searchRect = null;
	if (!opt_show_search_button || ww <= 0 || wh <= 0) return;
	margin = _scale(RivageUI.metrics.spacing.tiny);
	side = Math.min(_scale(SEARCH_BUTTON_SIZE), Math.max(0, wh - margin * 2));
	side = Math.min(side, Math.max(0, ww - margin * 2));
	if (side < _scale(SEARCH_BUTTON_MIN_SIZE)) return;
	searchRect = RivageUI.rect(ww - margin - side, wh - margin - side, side, side);
}
function paint_search_button(gr) {
	if (!searchRect) return;
	var font = getIconFont(Math.max(8, searchRect.h - _scale(5)));
	ui.iconButton(gr, searchRect, {
		enabled: true,
		hovered: searchHovered,
		pressed: searchPressed
	}, {
		glyph: SEARCH_GLYPH,
		font: font,
		accent: active_line_colour(),
		base: ui_theme.card,
		background: false,
		border: false,
		radius: RivageUI.metrics.radius.button
	});
}

function paint_source_icon(gr) {
	if (!opt_show_source_badge || !current_data) return;
	var web = current_data.source == 'lrclib' || current_data.source == 'musixmatch';
	var glyph = (web && current_data.saved_to_tag) ? SOURCE_SAVED_GLYPH : (web ? SOURCE_WEB_GLYPH : SOURCE_LOCAL_GLYPH);
	var side = _scale(18);
	var font = getIconFont(_scale(12));
	write(gr, glyph, font, col.on_surface_var, Math.max(0, ww - side), 0, side, side,
		DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
}

function draw_header(gr) {
	if (!opt_show_title) return 0;
	var y = tm;
	var label = current_fields ? (current_fields.artist + ' \u2014 ' + current_fields.title) : 'No track';
	write(gr, label, f_header, col.on_surface_var, lm, y, ww - lm - rm, lh(f_header),
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
	return lh(f_header) + _scale(4);
}

function build_synced_target_centres(lines, idx, centreY, avail_w, gap) {
	var centres = {};
	if (idx < 0 || !lines.length) return centres;

	var activeH = text_h_wrapped(lines[idx].text, f_active, avail_w);
	centres[idx] = centreY;

	var edge = centreY + activeH / 2 + gap;
	for (var i = idx + 1; i < lines.length; i++) {
		var h = text_h_wrapped(lines[i].text, f_inactive, avail_w);
		centres[i] = edge + h / 2;
		edge += h + gap;
	}

	edge = centreY - activeH / 2 - gap;
	for (i = idx - 1; i >= 0; i--) {
		var hu = text_h_wrapped(lines[i].text, f_inactive, avail_w);
		centres[i] = edge - hu / 2;
		edge -= hu + gap;
	}
	return centres;
}

function draw_synced(gr, top) {
	var lines = current_data.lines;
	var usesPlayback = displayed_source_uses_playback();
	var playbackMs = usesPlayback ? visual_playback_ms() : 0;
	var idx = usesPlayback ? line_index_at(playbackMs) : -1;
	var centreY = top + (wh - top) / 2;
	var avail_w = ww - lm - rm;
	var gap = _scale(opt_line_gap);
	var align = opt_align == Align.Center ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_LEADING;
	var continuous = opt_continuous_scroll && playback_is_advancing();

	if (continuous) ensure_visual_anim_timer();

	if (idx < 0) {
		if (idx != last_painted_idx) {
			scroll_anim_running = false;
			active_fade_idx = -1;
			active_fade_running = false;
			last_painted_idx = idx;
		}

		if (lines.length) {
			if (continuous) {
				var pre_stable_centres = build_stable_line_centres(lines, avail_w, gap);
				var pre_heights = stable_layout_cache.heights || {};
				var pre_offset = centreY - pre_stable_centres[0];
				for (var pi = 0; pi < lines.length; pi++) {
					if (!pre_stable_centres.hasOwnProperty(pi) || !pre_heights.hasOwnProperty(pi)) continue;
					var pdrawH = pre_heights[pi];
					var py = pre_stable_centres[pi] + pre_offset - pdrawH / 2;
					if (py + pdrawH < top || py > wh) continue;
					write(gr, lines[pi].text, f_inactive, inactive_line_colour(),
						lm, py, avail_w, pdrawH, align, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_WORD_WRAPPING_WRAP);
					if (opt_click_to_seek) add_link('line_' + pi, lm, py, avail_w, pdrawH);
				}
			} else {
				var pre_centres = build_synced_target_centres(lines, 0, centreY, avail_w, gap);
				for (var pdi = 0; pdi < lines.length; pdi++) {
					if (!pre_centres.hasOwnProperty(pdi)) continue;
					var pcy = pre_centres[pdi];
					var ph = text_h_wrapped(lines[pdi].text, f_inactive, avail_w);
					var pdy = pcy - ph / 2;
					if (pdy + ph < top || pdy > wh) continue;
					write(gr, lines[pdi].text, f_inactive, inactive_line_colour(),
						lm, pdy, avail_w, ph, align, DWRITE_PARAGRAPH_ALIGNMENT_NEAR, DWRITE_WORD_WRAPPING_WRAP);
					if (opt_click_to_seek) add_link('line_' + pdi, lm, pdy, avail_w, ph);
				}
				last_line_centres = pre_centres;
			}
		}
		return;
	}

	var target_centres = continuous ? null : build_synced_target_centres(lines, idx, centreY, avail_w, gap);
	if (idx != last_painted_idx) {
		begin_active_fade(idx);
		if (!continuous && opt_smooth_scroll && last_painted_idx >= 0 && last_line_centres.hasOwnProperty(idx)) {
			begin_scroll_animation(last_line_centres, target_centres);
		} else {
			scroll_anim_running = false;
			scroll_anim_from_centres = {};
			scroll_anim_to_centres = {};
		}
		last_painted_idx = idx;
	}

	if (continuous) {
		var stable_centres = build_stable_line_centres(lines, avail_w, gap);
		var stable_heights = stable_layout_cache.heights || {};
		var scrollOffset = continuous_scroll_offset(lines, stable_centres, idx, centreY, playbackMs);

		for (var i = 0; i < lines.length; i++) {
			if (!stable_centres.hasOwnProperty(i) || !stable_heights.hasOwnProperty(i)) continue;
			var drawH = stable_heights[i];
			var cy = stable_centres[i] + scrollOffset;
			var y = cy - drawH / 2;
			if (y + drawH < top || y > wh) continue;

			var active = i == idx;
			var font = active ? f_active : f_inactive;
			write(gr, lines[i].text, font, active ? active_line_paint_colour(i) : inactive_line_colour(),
				lm, y, avail_w, drawH, align, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_WORD_WRAPPING_WRAP);
			if (opt_click_to_seek) add_link('line_' + i, lm, y, avail_w, drawH);
		}
		return;
	}

	var p = opt_smooth_scroll ? scroll_anim_progress() : 1;
	var actual_centres = {};
	for (var ci in target_centres) {
		if (!target_centres.hasOwnProperty(ci)) continue;
		var targetCentre = target_centres[ci];
		var cy0 = targetCentre;
		if (p < 1 && scroll_anim_from_centres.hasOwnProperty(ci)) {
			var fromCentre = scroll_anim_from_centres[ci];
			var toCentre = scroll_anim_to_centres.hasOwnProperty(ci) ? scroll_anim_to_centres[ci] : targetCentre;
			cy0 = fromCentre + (toCentre - fromCentre) * p;
		}
		actual_centres[ci] = cy0;
	}

	for (var di = 0; di < lines.length; di++) {
		if (!actual_centres.hasOwnProperty(di)) continue;
		var dcy = actual_centres[di];
		var dactive = di == idx;
		var dfont = dactive ? f_active : f_inactive;
		var dh = text_h_wrapped(lines[di].text, dfont, avail_w);
		var dy = dcy - dh / 2;
		if (dy + dh < top || dy > wh) continue;

		write(gr, lines[di].text, dfont, dactive ? active_line_paint_colour(di) : inactive_line_colour(),
			lm, dy, avail_w, dh, align, DWRITE_PARAGRAPH_ALIGNMENT_NEAR, DWRITE_WORD_WRAPPING_WRAP);
		if (opt_click_to_seek) add_link('line_' + di, lm, dy, avail_w, dh);
	}

	last_line_centres = actual_centres;
}
var static_scroll = 0;
function draw_static(gr, top) {
	var text = current_data.plain || (current_data.lines.length ? lrc_to_plain(current_data.lines) : '');
	var avail_w = ww - lm - rm;
	var h = text_h_wrapped(text, f_body, avail_w);
	var max_scroll = Math.max(0, h - (wh - top));
	if (static_scroll > 0) static_scroll = 0;
	if (-static_scroll > max_scroll) static_scroll = -max_scroll;
	var align = opt_align == Align.Center ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_LEADING;
	write(gr, text, f_body, col.on_surface, lm, top + static_scroll, avail_w, h + _scale(20),
		align, DWRITE_PARAGRAPH_ALIGNMENT_NEAR, DWRITE_WORD_WRAPPING_WRAP);
}

function draw_search_overlay(gr) {
	clamp_search_scroll();
	gr.FillSolidRect(0, 0, ww, wh, RGBA(chan(col.bg, 0), chan(col.bg, 1), chan(col.bg, 2), 235));
	var y = tm;
	write(gr, 'Results for "' + search_overlay.query + '" (click to apply, right-click to cancel)', f_small, col.on_surface_var,
		lm, y, ww - lm - rm, lh(f_small), DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
	y += lh(f_small) + _scale(6);
	search_links = [];
	if (search_overlay.loading) {
		write(gr, 'Searching\u2026', f_body, col.on_surface_var, lm, y, ww - lm - rm, lh(f_body));
		return;
	}
	if (!search_overlay.results.length) {
		write(gr, 'No matching lyrics.', f_body, col.on_surface_var, lm, y, ww - lm - rm, lh(f_body));
		return;
	}
	var row_h = lh(f_body) + lh(f_small) + _scale(8);
	var cy = y + search_scroll;
	for (var i = 0; i < search_overlay.results.length; i++) {
		var r = search_overlay.results[i];
		var rowTop = cy;
		if (rowTop + row_h >= y && rowTop <= wh) {
			var id = 'sr_' + i;
			var hot = (hover_id == id);
			if (hot) gr.FillSolidRect(lm - _scale(4), rowTop, ww - lm - rm + _scale(8), row_h - _scale(2), RGBA(chan(col.accent, 0), chan(col.accent, 1), chan(col.accent, 2), 40));
			write(gr, r.artist + ' \u2014 ' + r.title, f_body, hot ? active_line_colour() : col.on_surface, lm, rowTop, ww - lm - rm, lh(f_body),
				DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
			var tag = (r.source == 'musixmatch' ? 'Musixmatch' : 'LRCLIB') + (r.instrumental ? ' \u00B7 instrumental' : (r.synced ? ' \u00B7 synced' : ' \u00B7 plain')) + (r.album ? ' \u00B7 ' + r.album : '');
			write(gr, tag, f_small, col.on_surface_var, lm, rowTop + lh(f_body), ww - lm - rm, lh(f_small),
				DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
			search_links.push({ id: id, x: lm, y: rowTop, w: ww - lm - rm, h: row_h, index: i });
		}
		cy += row_h;
	}
}

function on_paint(gr) {
	source_refresh_work.runFromPaint();
	RivageBackdrop.paint(gr, 0, 0, ww, wh, col.bg);
	if (ww < _scale(24) || wh < _scale(24)) return;
	links = [];

	if (search_overlay) {
		draw_header(gr);
		draw_search_overlay(gr);
		paint_source_icon(gr);
		return;
	}

	var headerH = draw_header(gr);
	var top = headerH + tm;

	switch (state) {
		case STATE.NO_TRACK:
			centre_msg(gr, 'Nothing is playing or selected.', f_body, col.on_surface_var);
			break;
		case STATE.LOADING:
			centre_msg(gr, 'Looking up lyrics\u2026', f_body, col.on_surface_var);
			break;
		case STATE.NOT_FOUND:
			centre_msg(gr, 'No lyrics found. Search manually to try another result.', f_body, col.on_surface_var);
			break;
		case STATE.READY:
			if (!current_data) break;
			if (current_data.instrumental) {
				centre_msg(gr, 'Instrumental track.', f_body, col.on_surface_var);
			} else if (current_data.synced && current_data.lines.length) {
				draw_synced(gr, top);
			} else {
				draw_static(gr, top);
			}
			break;
	}
	paint_source_icon(gr);
	paint_search_button(gr);
}

function on_size(width, height) {
	ww = width; wh = height;
	var normalMargin = _scale(10);
	var narrowMargin = Math.max(_scale(2), Math.floor(Math.max(0, width) * 0.06));
	lm = rm = Math.min(normalMargin, narrowMargin);
	tm = _scale(6);
	layout_search_button();
}
function on_mouse_move(x, y, mask) {
	var id;
	var overSearch = RivageUI.pointInRect(x, y, searchRect);
	if (search_overlay) {
		var l = null;
		for (var i = 0; i < search_links.length; i++) { var s = search_links[i]; if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) { l = s; break; } }
		id = l ? l.id : '';
	} else if (!overSearch) {
		var lk = link_at(x, y);
		id = lk ? lk.id : '';
	} else {
		id = '';
	}
	if (id != hover_id) {
		hover_id = id;
		window.SetCursor(id ? IDC_HAND : IDC_ARROW);
		window.Repaint();
	}
	if (overSearch != searchHovered) {
		searchHovered = overSearch;
		window.SetCursor(overSearch ? IDC_HAND : IDC_ARROW);
		window.Repaint();
	}
}
function on_mouse_leave() {
	if (hover_id || down_id || searchHovered || searchPressed) {
		hover_id = ''; down_id = ''; searchHovered = false; searchPressed = false;
		window.SetCursor(IDC_ARROW); window.Repaint();
	}
}
function on_mouse_lbtn_down(x, y, mask) {
	if (RivageUI.pointInRect(x, y, searchRect)) { searchPressed = true; window.Repaint(); return; }
	down_id = hover_id; if (down_id) window.Repaint();
}
function on_mouse_lbtn_up(x, y, mask) {
	var wasSearchPressed = searchPressed;
	searchPressed = false;
	if (wasSearchPressed && RivageUI.pointInRect(x, y, searchRect)) {
		window.Repaint();
		open_manual_search();
		return;
	}
	if (search_overlay) {
		for (var i = 0; i < search_links.length; i++) {
			var s = search_links[i];
			if (s.id == down_id && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
				var r = search_overlay.results[s.index];
				cancel_manual_search(false);
				pick_search_result(r);
				return;
			}
		}
		return;
	}
	var l = link_at(x, y);
	if (!l || l.id != down_id) return;
	if (l.id.indexOf('line_') == 0 && opt_click_to_seek) {
		var idx = parseInt(l.id.substring(5), 10);
		if (current_data && current_data.lines[idx] && displayed_source_uses_playback()) {
			// A click-to-seek that does nothing is a user action with no feedback at all.
			try { fb.PlaybackTime = current_data.lines[idx].t / 1000; }
			catch (e) { report_failure('click-to-seek was refused by the host', e); }
		}
	}
}
// JSplitter reserves Win+right-click variants for panel properties; yield whenever Win is held.
function properties_combo_held() {
	try {
		return utils.IsKeyPressed(VK_LWIN) || utils.IsKeyPressed(VK_RWIN);
	} catch (e) { return false; }
}
function on_mouse_rbtn_down(x, y, mask) {
	if (properties_combo_held()) return;
	if (search_overlay) { cancel_manual_search(true); return; }
	show_menu(x, y);
}
function on_mouse_mbtn_up(x, y, mask) {
	load_lyrics_for_track(get_active_handle(), false);
}
function on_mouse_wheel(step) {
	if (search_overlay) {
		search_scroll += step * _scale(50);
		clamp_search_scroll();
		window.Repaint();
		return;
	}
	if (current_data && !current_data.synced) {
		static_scroll += step * _scale(50);
		window.Repaint();
	}
}
function on_key_down(vkey) {
	if (search_overlay && vkey == 0x1B /* VK_ESCAPE */) cancel_manual_search(true);
}

function GetMenuFlags(enabled, checked) {
	var flags = enabled ? MF_STRING : MF_GRAYED;
	if (checked) flags |= MF_CHECKED;
	return flags;
}
// Keep configuration in the shared Settings panel; this menu owns track actions and view toggles only.
function show_menu(x, y) {
	var menu = window.CreatePopupMenu();

	menu.AppendMenuItem(MF_STRING, 1, 'Refresh local lyrics');
	menu.AppendMenuItem(MF_STRING, 2, 'Fetch again from online sources');
	menu.AppendMenuItem(MF_STRING, 3, 'Search for lyrics…');
	menu.AppendMenuItem(MF_SEPARATOR, 0, '');
	menu.AppendMenuItem(GetMenuFlags(!!current_data, false), 4, 'Save lyrics now');
	menu.AppendMenuItem(MF_SEPARATOR, 0, '');
	menu.AppendMenuItem(GetMenuFlags(true, opt_show_title), 18, 'Show track title');
	menu.AppendMenuItem(GetMenuFlags(true, opt_show_source_badge), 23, 'Show lyric source icon');
	menu.AppendMenuItem(GetMenuFlags(true, opt_show_search_button), 19, 'Show search button');

	var idx = menu.TrackPopupMenu(x, y);
	switch (idx) {
		case 1: load_lyrics_for_track(get_active_handle(), false); break;
		case 2: load_lyrics_for_track(get_active_handle(), true); break;
		case 3: open_manual_search(); break;
		case 4: if (current_data && current_handle_ref) save_lyrics(current_handle_ref, current_data); break;
		case 18: applyMySetting('showTitle', !opt_show_title); break;
		case 23: applyMySetting('showSourceBadge', !opt_show_source_badge); break;
		case 19: applyMySetting('showSearchButton', !opt_show_search_button); break;
	}
}
function persist_properties(changes) {
	var written = [];
	try {
		for (var i = 0; i < changes.length; i++) {
			window.SetProperty(changes[i].name, changes[i].next);
			written.push(changes[i]);
		}
	} catch (e) {
		for (var j = written.length - 1; j >= 0; j--) {
			try { window.SetProperty(written[j].name, written[j].previous); } catch (rollbackError) {}
		}
		throw e;
	}
}
function set_save_mode(mode) {
	var next = (mode == SaveMode.Off || mode == SaveMode.File || mode == SaveMode.Tag || mode == SaveMode.Both) ? mode : SaveMode.Off;
	persist_properties([{ name: 'lyrics.save_mode', next: next, previous: opt_save_mode }]);
	opt_save_mode = next;
}
function apply_accent_mode(mode, customColour) {
	var nextMode = (mode == AccentMode.Custom || mode == AccentMode.AlbumArt) ? mode : AccentMode.Default;
	var changes = [];
	var nextCustom = opt_accent_custom;
	if (nextMode == AccentMode.Custom && customColour !== undefined) {
		nextCustom = RivageUI.opaque(Number(customColour));
		changes.push({ name: 'lyrics.accent_custom', next: nextCustom, previous: opt_accent_custom });
	}
	changes.push({ name: 'lyrics.accent_mode', next: nextMode, previous: opt_accent_mode });
	persist_properties(changes);
	opt_accent_custom = nextCustom;
	opt_accent_mode = nextMode;
	rebuild_visual_theme();
	if (nextMode == AccentMode.AlbumArt) request_shared_accent();
	window.Repaint();
}
function set_accent_mode(mode) { apply_accent_mode(mode); }
function try_toggle_musixmatch() {
	if (opt_musixmatch_enabled) {
		persist_properties([{ name: 'lyrics.musixmatch_enabled', next: false, previous: true }]);
		opt_musixmatch_enabled = false;
		return;
	}
	var warnNow = !opt_musixmatch_warned;
	if (warnNow) {
		var msg = 'Musixmatch support uses an UNOFFICIAL method (the same free ' +
			'anonymous token flow their own apps use, not a paid/official API). ' +
			'It can stop working at any time if Musixmatch changes their internal ' +
			'endpoints, and it sits outside their published terms of service.\n\n' +
			'Enable it anyway?';
		var result = 0;
		try { result = utils.MessageBox(window.ID, msg, window.Name, MB_YESNO | MB_ICONWARNING); } catch (e) { return; }
		if (result != IDYES) return;
	}
	var changes = [];
	if (warnNow) changes.push({ name: 'lyrics.musixmatch_warned', next: true, previous: opt_musixmatch_warned });
	changes.push({ name: 'lyrics.musixmatch_enabled', next: true, previous: opt_musixmatch_enabled });
	persist_properties(changes);
	if (warnNow) opt_musixmatch_warned = true;
	opt_musixmatch_enabled = true;
}

var SETTINGS_PANEL_ID = 'lyrics';
var SETTINGS_PANEL_LABEL = 'Lyrics';

function getMySettings() {
	return [
		{ id: 'saveMode', label: 'Save lyrics', type: 'choice', value: opt_save_mode, choiceValueType: 'string',
			choices: [
				{ value: SaveMode.Off, label: "Don't save" },
				{ value: SaveMode.File, label: 'LRC file beside the track' },
				{ value: SaveMode.Tag, label: 'Track tags' },
				{ value: SaveMode.Both, label: 'File and tags' }
			] },
		{ id: 'tagFieldSynced', label: 'Synced lyrics tag', type: 'string', value: opt_tag_field_synced },
		{ id: 'tagFieldPlain', label: 'Plain lyrics tag', type: 'string', value: opt_tag_field_plain },
		{ id: 'autoFetch', label: 'Fetch lyrics automatically', type: 'bool', value: opt_auto_fetch },
		{ id: 'clickToSeek', label: 'Seek when a lyric line is clicked', type: 'bool', value: opt_click_to_seek },
		{ id: 'centreAlign', label: 'Centre text', type: 'bool', value: opt_align == Align.Center },
		{ id: 'smoothScroll', label: 'Smooth line transitions', type: 'bool', value: opt_smooth_scroll },
		{ id: 'continuousScroll', label: 'Scroll continuously during playback', type: 'bool', value: opt_continuous_scroll },
		{ id: 'animFps', label: 'Animation frame rate', type: 'choice', value: opt_anim_fps, choiceValueType: 'number',
			hint: RivagePowerMode.capNote(opt_anim_fps),
			choices: [
				{ value: 20, label: '20 fps' },
				{ value: 30, label: '30 fps' },
				{ value: 60, label: '60 fps' }
			] },
		{ id: 'lineGap', label: 'Line spacing', type: 'number', value: opt_line_gap, min: 0, max: 40, step: 1 },
		{ id: 'activeSize', label: 'Active line font size', type: 'number', value: opt_active_size, min: 8, max: 48, step: 1 },
		{ id: 'inactiveSize', label: 'Inactive line font size', type: 'number', value: opt_inactive_size, min: 8, max: 40, step: 1 },
		{ id: 'activeColour', label: 'Active line colour', type: 'choice', value: opt_accent_mode, choiceValueType: 'string',
			choices: [
				{ value: AccentMode.Default, label: RivageUI.copy.labels.rvgBlue },
				{ value: AccentMode.AlbumArt, label: RivageUI.copy.labels.sharedAccent },
				{ value: AccentMode.Custom, label: 'Custom colour…' }
			] },
		{ id: 'inactiveColour', label: 'Inactive line colour', type: 'colour', value: inactive_line_colour() },
		{ id: 'musixmatch', label: 'Enable Musixmatch (unofficial)', type: 'bool', value: opt_musixmatch_enabled, hint: 'Uses an unofficial method and may stop working without notice.' },
		{ id: 'showTitle', label: 'Show track title', type: 'bool', value: opt_show_title },
		{ id: 'showSourceBadge', label: 'Show lyric source icon', type: 'bool', value: opt_show_source_badge },
		{ id: 'showSearchButton', label: 'Show search button', type: 'bool', value: opt_show_search_button },
		{ id: 'changeFont', label: 'Choose lyrics font…', type: 'action', value: null, actionLabel: 'Choose' }
	];
}
function applyMySetting(settingId, value) {
	var next, changes;
	switch (settingId) {
		case 'saveMode': set_save_mode(value); return;
		case 'tagFieldSynced':
			next = String(value || '');
			if (tag_fields_conflict(next, opt_tag_field_plain)) throw new Error('Synced and plain lyric tag fields must be different.');
			persist_properties([{ name: 'lyrics.tag_field_synced', next: next, previous: opt_tag_field_synced }]);
			opt_tag_field_synced = next;
			return;
		case 'tagFieldPlain':
			next = String(value || '');
			if (tag_fields_conflict(opt_tag_field_synced, next)) throw new Error('Synced and plain lyric tag fields must be different.');
			persist_properties([{ name: 'lyrics.tag_field_plain', next: next, previous: opt_tag_field_plain }]);
			opt_tag_field_plain = next;
			return;
		case 'autoFetch':
			next = !!value;
			persist_properties([{ name: 'lyrics.auto_fetch', next: next, previous: opt_auto_fetch }]);
			opt_auto_fetch = next;
			return;
		case 'clickToSeek':
			next = !!value;
			persist_properties([{ name: 'lyrics.click_to_seek', next: next, previous: opt_click_to_seek }]);
			opt_click_to_seek = next;
			return;
		case 'centreAlign':
			next = value ? Align.Center : Align.Left;
			persist_properties([{ name: 'lyrics.align', next: next, previous: opt_align }]);
			opt_align = next;
			window.Repaint();
			return;
		case 'smoothScroll':
			next = !!value;
			persist_properties([{ name: 'lyrics.smooth_scroll', next: next, previous: opt_smooth_scroll }]);
			opt_smooth_scroll = next;
			if (!next) { scroll_anim_running = false; scroll_anim_from_centres = {}; scroll_anim_to_centres = {}; }
			window.Repaint(true);
			return;
		case 'continuousScroll':
			next = !!value;
			persist_properties([{ name: 'lyrics.continuous_scroll', next: next, previous: opt_continuous_scroll }]);
			opt_continuous_scroll = next;
			scroll_anim_running = false;
			scroll_anim_from_centres = {};
			scroll_anim_to_centres = {};
			last_painted_idx = -2;
			last_line_centres = {};
			if (next && playback_is_advancing()) ensure_visual_anim_timer();
			window.Repaint(true);
			return;
		case 'animFps':
			next = Number(value) || 30;
			next = (next == 20 || next == 30 || next == 60) ? next : 30;
			persist_properties([{ name: 'lyrics.anim_fps', next: next, previous: opt_anim_fps }]);
			opt_anim_fps = next;
			return;
		case 'lineGap':
			next = Math.max(0, Math.min(40, Number(value) || 0));
			persist_properties([{ name: 'lyrics.line_gap', next: next, previous: opt_line_gap }]);
			opt_line_gap = next;
			window.Repaint();
			return;
		case 'activeSize':
			next = Math.max(8, Math.min(48, Number(value) || opt_active_size));
			persist_properties([{ name: 'lyrics.active_size', next: next, previous: opt_active_size }]);
			opt_active_size = next;
			update_fonts(); window.Repaint();
			return;
		case 'inactiveSize':
			next = Math.max(8, Math.min(40, Number(value) || opt_inactive_size));
			persist_properties([{ name: 'lyrics.inactive_size', next: next, previous: opt_inactive_size }]);
			opt_inactive_size = next;
			update_fonts(); window.Repaint();
			return;
		case 'activeColour':
			if (value == AccentMode.Custom) {
				var pickedActive = utils.ColourPicker(window.ID, opt_accent_custom || UI_ACCENT);
				apply_accent_mode(AccentMode.Custom, pickedActive);
			} else set_accent_mode(value == AccentMode.AlbumArt ? AccentMode.AlbumArt : AccentMode.Default);
			return;
		case 'inactiveColour':
			next = Number(value) || 0;
			persist_properties([{ name: 'lyrics.colour_inactive', next: next, previous: opt_colour_inactive }]);
			opt_colour_inactive = next;
			window.Repaint();
			return;
		case 'musixmatch':
			if (!!value != opt_musixmatch_enabled) try_toggle_musixmatch();
			return;
		case 'showTitle':
			next = !!value;
			persist_properties([{ name: 'lyrics.show_title', next: next, previous: opt_show_title }]);
			opt_show_title = next;
			window.Repaint();
			return;
		case 'showSourceBadge':
			next = !!value;
			persist_properties([{ name: 'lyrics.show_source_badge', next: next, previous: opt_show_source_badge }]);
			opt_show_source_badge = next;
			window.Repaint();
			return;
		case 'showSearchButton':
			next = !!value;
			persist_properties([{ name: 'lyrics.show_search_button', next: next, previous: opt_show_search_button }]);
			opt_show_search_button = next;
			layout_search_button();
			window.Repaint();
			return;
		case 'changeFont':
			var chosen = utils.FontPicker(f_active, window.ID);
			if (!chosen || chosen == f_active) return;
			var nextName = String(chosen.Name || opt_line_font_name);
			var nextSize = Number(chosen.Size) || opt_active_size;
			changes = [
				{ name: 'lyrics.font_name', next: nextName, previous: opt_line_font_name },
				{ name: 'lyrics.active_size', next: nextSize, previous: opt_active_size }
			];
			persist_properties(changes);
			opt_line_font_name = nextName;
			opt_active_size = nextSize;
			update_fonts(); window.Repaint();
			return;
	}
}

function on_notify_data(name, info) {
	if (RivagePowerMode.consume(name, info)) return;
	if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
	if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
	if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
	if (TrackContext.onNotifyData(name, info, false)) return;

	if (SharedThemeProtocol.consume(name, info, function () {
		rebuild_visual_theme();
		SharedThemeProtocol.requestRepaint();
	})) return;

	if (name != SHARED_ALBUM_ACCENT_UPDATE || !SharedAccentProtocol.isColour(info)) return;
	var colour = SharedAccentProtocol.opaque(info);
	if (colour === shared_album_accent) return;
	shared_album_accent = colour;
	if (SharedThemeProtocol.isAccentCommitted(colour)) return;
	if (opt_accent_mode == AccentMode.AlbumArt) { rebuild_visual_theme(); window.Repaint(); }
}
function on_playback_new_track(handle) {
	var t = 0;
	try { t = Number(fb.PlaybackTime) || 0; } catch (e) {}
	sync_visual_clock(t, true);
	if (TrackContext.followsPlayback()) schedule_refresh(false);
}
function on_playback_stop(reason) {
	visual_clock_valid = false;
	if (reason == PLAYBACK_STOP_STARTING_ANOTHER) {
		if (TrackContext.followsPlayback()) {
			invalidate_online_requests();
			refresh_generation++;
			if (refresh_timer) { window.ClearTimeout(refresh_timer); refresh_timer = null; }
		}
		return;
	}
	if (TrackContext.effectiveMode() == TrackContext.MODE_SELECTION && get_active_handle()) return;
	schedule_refresh(false);
}
function on_item_focus_change() { if (TrackContext.followsSelection()) schedule_refresh(false); }
function on_playlist_switch() { on_item_focus_change(); }
function on_playlist_items_selection_change() { on_item_focus_change(); }
function on_playback_dynamic_info_track() { if (TrackContext.followsPlayback()) schedule_refresh(true); }
function handle_list_contains_key(handleList, key) {
	if (!handleList || !key) return false;
	if (handle_key(handleList) == key) return true;
	var count = 0;
	try { count = Number(handleList.Count) || 0; } catch (e) {}
	for (var i = 0; i < count; i++) {
		var handle = null;
		try { handle = handleList[i]; } catch (e2) {}
		if (!handle) { try { handle = handleList.Item(i); } catch (e3) {} }
		if (handle && handle_key(handle) == key) return true;
	}
	return false;
}
function on_metadb_changed(handleList) {
	if (handle_list_contains_key(handleList, current_handle_key)) schedule_refresh(true);
}
function on_playback_time(time) {
	if (!displayed_source_uses_playback()) return;
	sync_visual_clock(time, false);
	if (current_data && current_data.synced) window.Repaint();
}
function on_playback_seek(time) {
	if (!displayed_source_uses_playback()) return;
	sync_visual_clock(time, true);
	if (current_data && current_data.synced) window.Repaint(true);
}
function on_playback_pause(state) {
	if (!displayed_source_uses_playback()) return;
	var t = 0;
	try { t = Number(fb.PlaybackTime) || 0; } catch (e) {}
	sync_visual_clock(t, true);
	if (!current_data || !current_data.synced) return;
	if (!state && opt_continuous_scroll) ensure_visual_anim_timer();
	window.Repaint(true);
}
function on_colours_changed() { rebuild_visual_theme(); window.Repaint(); }
function on_font_changed() { update_fonts(); on_size(ww, wh); window.Repaint(); }
function on_script_unload() {
	script_active = false;
	request_token++;
	search_request_token++;
	refresh_generation++;
	if (refresh_timer) { window.ClearTimeout(refresh_timer); refresh_timer = null; }
	cancel_all_http();
	reset_visual_animation();
}

ww = window.Width;
wh = window.Height;
rebuild_visual_theme();
update_fonts();
on_size(window.Width, window.Height);
SharedAccentProtocol.request();
TrackContext.onChange(function () { schedule_refresh(false); });
TrackContext.requestSync();
request_visible_source_refresh(false);
