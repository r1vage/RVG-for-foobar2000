window.DrawMode = 0;
// JSplitter requires the draw mode before fonts or graphics resources are created.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\track_context.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\lastfm_credentials_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');

window.DefineScript('RVG Last.fm', { author: 'RivaGe', version: '2.8.2', features: { drag_n_drop: false } });

// Narrow failure reporting. Most empty catches in this file guard host reads
// and cleanup calls that are *expected* to fail (an aborted request, a timer
// already cleared) and stay silent on purpose. This is for the few that mean
// something is actually broken and would otherwise leave no trace. Repeats
// are counted and re-logged only at powers of ten.
var reported_failures = {};
function report_failure(what, err) {
	var message = '[RVG Last.fm] ' + what + (err === undefined || err === null ? '' : ': ' + err);
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
var DT_WORDBREAK = 0x00000010;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var MF_STRING = 0x00000000;
var MF_SEPARATOR = 0x00000800;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;

var MK_SHIFT = 0x0004;

var PlaybackStopReason = { user: 0, eof: 1, starting_another: 2 };

var DWRITE_TEXT_ALIGNMENT_LEADING = 0;
var DWRITE_TEXT_ALIGNMENT_TRAILING = 1;
var DWRITE_TEXT_ALIGNMENT_CENTER = 2;
var DWRITE_PARAGRAPH_ALIGNMENT_NEAR = 0;
var DWRITE_PARAGRAPH_ALIGNMENT_FAR = 1;
var DWRITE_PARAGRAPH_ALIGNMENT_CENTER = 2;
var DWRITE_WORD_WRAPPING_WRAP = 0;

// Credentials are owned by the root Global settings producer and arrive by protocol.
var API_KEY = '';
var BASE_URL = 'https://ws.audioscrobbler.com/2.0/?format=json&api_key=';
var FollowMode = { OnlyStopped: 0, Always: 1 }; // legacy migration only
var opt_username = '';
var legacy_follow = window.GetProperty('lastfm.follow_mode', FollowMode.OnlyStopped);
var opt_track_context = TrackContext.normaliseOverride(window.GetProperty('lastfm.track_context_override', ''));
if (window.GetProperty('lastfm.track_context_override', '') === '') {
	opt_track_context = legacy_follow == FollowMode.Always ? TrackContext.MODE_SELECTION : TrackContext.MODE_GLOBAL;
	try_set_property('lastfm.track_context_override', opt_track_context);
}
var AccentMode = { Default: 'default', AlbumArt: 'albumart' };
function normalise_accent_mode(mode) {
	return mode == AccentMode.AlbumArt ? AccentMode.AlbumArt : AccentMode.Default;
}
function try_set_property(name, value) {
	try {
		window.SetProperty(name, value);
		return true;
	} catch (e) {
		return false;
	}
}
var opt_accent_mode = normalise_accent_mode(window.GetProperty('lastfm.accent_mode', AccentMode.Default));
var opt_blur_bg = !!window.GetProperty('lastfm.blur_bg', true);
var UI_ACCENT = RGB(0, 120, 212);

// SMP/JSplitter lacks a raw DPI API here; scale from the host's default font size.
var g_dpi = 100;
function zoom(value, percent) {
	return Math.round(value * (percent || 100) / 100);
}
function _scale(value) {
	return zoom(value, g_dpi);
}

function RGB(r, g, b) {
	return RivageUI.rgb(r, g, b);
}
function RGBA(r, g, b, a) {
	return RivageUI.rgba(r, g, b, a);
}
function chan(c, i) {
	return RivageUI.channel(c, i == 0 ? 16 : (i == 1 ? 8 : 0));
}
var col = {
	bg: RGB(39, 39, 39),
	surface: RGB(45, 45, 45),
	surface_hi: RGB(52, 52, 52),
	surface_hi2: RGB(42, 42, 42),
	on_surface: RGB(245, 245, 245),
	on_surface_var: RGB(170, 170, 170),
	outline: RGB(72, 72, 72),
	primary: UI_ACCENT,
	on_primary: RGB(245, 245, 245),
	primary_container: RGB(52, 52, 52),
	on_primary_container: RGB(170, 170, 170),
	chip: RGB(42, 42, 42),
	chip_outline: RGB(72, 72, 72),
	chip_hover: RGB(52, 52, 52),
	chip_hover_text: RGB(245, 245, 245),
	scroll: RGB(110, 110, 110),
	scroll_bg: RGB(30, 30, 30)
};

var ui_theme = RivageUI.createTheme({ mode: 'host', accent: UI_ACCENT });
var ui = RivageUI.createPainter({ scale: _scale, theme: ui_theme });

function sync_colours_from_theme() {
	col.bg = ui_theme.background;
	col.surface = ui_theme.card;
	col.surface_hi = ui_theme.cardHover;
	col.surface_hi2 = ui_theme.chip;
	col.on_surface = ui_theme.textPrimary;
	col.on_surface_var = ui_theme.textMuted;
	col.outline = ui_theme.stroke;
	col.primary = ui_theme.accent;
	col.on_primary = ui_theme.onAccent;
	col.primary_container = ui_theme.accentSoft;
	col.on_primary_container = ui_theme.textSecondary;
	col.chip = ui_theme.chip;
	col.chip_outline = ui_theme.stroke;
	col.chip_hover = ui_theme.chipHover;
	col.chip_hover_text = ui_theme.textPrimary;
	col.scroll = ui_theme.accent;
	col.scroll_bg = ui_theme.scrollTrack;
}

function rebuild_visual_theme(accent) {
	var host = RivageUI.hostInfo();
	ui_theme = RivageUI.createTheme({
		mode: 'host',
		host: host,
		background: host.background,
		text: host.text,
		accent: RivageUI.opaque(accent)
	});
	ui.setTheme(ui_theme);
	sync_colours_from_theme();
}

function apply_accent(accent) {
	rebuild_visual_theme(accent);
}
var shared_album_accent = UI_ACCENT;
function current_accent() {
	if (opt_accent_mode == AccentMode.AlbumArt) return shared_album_accent;
	return UI_ACCENT;
}

function request_shared_accent() {
	SharedAccentProtocol.requestAccent();
}

var font_name = 'Segoe UI';
var FONT_SIZE = 13;
var f_eyebrow = null;
var f_label = null;
var f_body = null;
var f_body_em = null;
var f_headline = null;
var f_icon = null;

function gdi_font(name, size, style) {
	return RivageUI.font(name, size, style || 0);
}
var FONT_STYLE_BOLD = 1;
function make_font(pt, weight, name) {
	var style = (typeof weight == 'number' && weight >= 600) ? FONT_STYLE_BOLD : 0;
	return gdi_font(name || font_name, zoom(pt, g_dpi), style);
}
function update_fonts() {
	var host = RivageUI.hostInfo();
	var scale_size = Number(host.scaleFontSize) || 12;

	font_name = host.fontFamily || 'Segoe UI';
	g_dpi = (isFinite(scale_size) && scale_size > 0)
		? Math.max(50, Math.round(scale_size / 12 * 100))
		: 100;

	RivageUI.clearFontCache();
	f_eyebrow = make_font(Math.max(8, FONT_SIZE - 1), 700);
	f_label = make_font(Math.max(8, FONT_SIZE - 1), 400);
	f_body = make_font(FONT_SIZE, 400);
	f_body_em = make_font(FONT_SIZE, 600);
	f_headline = make_font(FONT_SIZE + 2, 700);
	f_icon = gdi_font(RivageUI.iconFontFamily(), zoom(FONT_SIZE, g_dpi), 0);
}
function lh(f) {
	if (!f) return Math.round(FONT_SIZE * 1.45); // font can legitimately be null - see gdi_font()
	return Math.round(f.Size * 1.45);
}

function text_w(text, font) {
	if (!text || !font) return 0;
	return RivageUI.measureText(String(text), font);
}

var lm = _scale(4);
var rm = _scale(4);
var tm = _scale(4);
var gap = _scale(8);
var pad = _scale(9);
var label_col = _scale(70);
var sb_w = _scale(8);
var ww = 0, wh = 0;
var Y_OFFSET = 0;

function refresh_layout_metrics() {
	lm = _scale(4);
	rm = _scale(4);
	tm = _scale(4);
	gap = _scale(8);
	pad = _scale(9);
	label_col = _scale(70);
	sb_w = _scale(8);
}

var STATE = { NO_TRACK: 0, LOADING: 1, READY: 2, ERROR: 3, NO_USER: 4, NO_API_KEY: 5 };
var state = STATE.NO_TRACK;
var np = ['', '', '']; // artist / album / title
var username = '';
var D = null;
function blank_data() {
	return {
		user: { playcount: '0', per_day: '0', per_week: '0', per_month: '0' },
		artist: { name: '', listeners: '0', playcount: '0', userplaycount: '0', tags: [], similar: [] },
		album: { name: '', listeners: '0', playcount: '0', userplaycount: '0' },
		track: { name: '', listeners: '0', playcount: '0', userplaycount: '0', loved: false }
	};
}
D = blank_data();
var pending = 0;
var failures = 0;
var request_token = 0;
var request_serial = 0;
var active_requests = {};
var refresh_timer = null;
var refresh_generation = 0;
var script_active = true;

var PERIODS = [
	{ id: '7day', label: '7 days' },
	{ id: '1month', label: 'Month' },
	{ id: '3month', label: '3 mo' },
	{ id: '6month', label: '6 mo' },
	{ id: '12month', label: 'Year' },
	{ id: 'overall', label: 'All' }
];
var CHART_LIMIT = 20;
var RECENT_LIMIT = 20;

var list_scroll = 0;
var list_view = { x: 0, y: 0, w: 0, h: 0, content: 0 }; // in screen coords (incl Y_OFFSET)

var TABS = [
	{ id: 'charts', label: 'Top charts' },
	{ id: 'recent', label: 'Recent' },
	{ id: 'albums', label: 'Top albums' },
	{ id: 'weekly', label: 'Weekly albums' }
];
function normalise_period(value) {
	for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id == value) return value;
	return 'overall';
}
function normalise_tab(value) {
	for (var i = 0; i < TABS.length; i++) if (TABS[i].id == value) return value;
	return 'charts';
}
var chart_period = normalise_period(window.GetProperty('lastfm.chart_period', 'overall'));
var active_tab = normalise_tab(window.GetProperty('lastfm.active_tab', 'charts'));

// Account-list requests survive track changes; username changes invalidate this generation.
var list_cache = {};
var list_request_generation = 0;
var list_request_serial = 0;
function list_cache_key(key, user) {
	var account = String(user === undefined ? opt_username : user).replace(/^\s+|\s+$/g, '').toLowerCase();
	return account + '|' + key;
}
function reset_list_cache() {
	list_request_generation++;
	cancel_requests('list');
	list_cache = {};
}
function url_artist(a) { return 'https://www.last.fm/music/' + encodeURIComponent(a); }
function url_album(a, al) { return url_artist(a) + '/' + encodeURIComponent(al); }
function arr_of(x) { if (!x) return []; return (x instanceof Array) ? x : [x]; }

var PARSERS = {
	top_artists: function (j) {
		var out = [], a = arr_of(j.topartists && j.topartists.artist);
		for (var i = 0; i < a.length; i++)
			out.push({ name: a[i].name, sub: '', plays: num(a[i].playcount), url: a[i].url || url_artist(a[i].name) });
		return out;
	},
	top_tracks: function (j) {
		var out = [], a = arr_of(j.toptracks && j.toptracks.track);
		for (var i = 0; i < a.length; i++)
			out.push({ name: a[i].name, sub: a[i].artist ? a[i].artist.name : '', plays: num(a[i].playcount), url: a[i].url || '' });
		return out;
	},
	top_albums: function (j) {
		var out = [], a = arr_of(j.topalbums && j.topalbums.album);
		for (var i = 0; i < a.length; i++) {
			var art = a[i].artist ? a[i].artist.name : '';
			out.push({ name: a[i].name, sub: art, plays: num(a[i].playcount), url: a[i].url || (art ? url_album(art, a[i].name) : '') });
		}
		return out;
	},
	recent: function (j) {
		var out = [], a = arr_of(j.recenttracks && j.recenttracks.track);
		for (var i = 0; i < a.length; i++) {
			var t = a[i];
			var art = t.artist ? (t.artist['#text'] || t.artist.name || '') : '';
			var now = t['@attr'] && t['@attr'].nowplaying == 'true';
			var when = now ? 'playing' : short_date(t.date);
			out.push({ name: t.name, sub: art, plays: when, url: t.url || '', now: now });
		}
		return out;
	},
	weekly_albums: function (j) {
		var out = [], a = arr_of(j.weeklyalbumchart && j.weeklyalbumchart.album);
		for (var i = 0; i < a.length; i++) {
			var art = a[i].artist ? (a[i].artist['#text'] || a[i].artist.name || '') : '';
			out.push({ name: a[i].name, sub: art, plays: num(a[i].playcount), url: a[i].url || (art ? url_album(art, a[i].name) : '') });
		}
		return out;
	}
};

function fetch_list(key, method, params, parser) {
	if (!opt_username) return;
	var request_user = opt_username;
	var cache_key = list_cache_key(key, request_user);
	var cached = list_cache[cache_key];
	if (cached && (cached.loading || !cached.error)) return; // ready or in flight

	var generation = list_request_generation;
	var request_id = ++list_request_serial;
	list_cache[cache_key] = { data: null, loading: true, error: false, requestId: request_id };
	var request_params = {};
	for (var k in params) {
		if (params.hasOwnProperty(k)) request_params[k] = params[k];
	}
	request_params.user = request_user;

	api(method, request_params, null, function (j) {
		if (generation != list_request_generation || request_user != opt_username) return;
		var current = list_cache[cache_key];
		if (!current || current.requestId !== request_id) return; // a newer refresh owns this key
		if (!j || j.error) {
			list_cache[cache_key] = { data: [], loading: false, error: true };
			window.Repaint();
			return;
		}

		var rows;
		try {
			rows = parser(j);
			if (!(rows instanceof Array)) rows = [];
		} catch (e) {
			list_cache[cache_key] = { data: [], loading: false, error: true };
			window.Repaint();
			return;
		}

		list_cache[cache_key] = { data: rows, loading: false, error: false };
		window.Repaint();
	});
}
function ensure_tab_data(tab) {
	if (!opt_username) return;
	switch (tab) {
		case 'charts':
			fetch_list('top_artists@' + chart_period, 'user.gettopartists', { period: chart_period, limit: CHART_LIMIT }, PARSERS.top_artists);
			fetch_list('top_tracks@' + chart_period, 'user.gettoptracks', { period: chart_period, limit: CHART_LIMIT }, PARSERS.top_tracks);
			break;
		case 'albums':
			fetch_list('top_albums@' + chart_period, 'user.gettopalbums', { period: chart_period, limit: CHART_LIMIT }, PARSERS.top_albums);
			break;
		case 'recent':
			fetch_list('recent', 'user.getrecenttracks', { limit: RECENT_LIMIT }, PARSERS.recent);
			break;
		case 'weekly':
			fetch_list('weekly_albums', 'user.getweeklyalbumchart', { limit: CHART_LIMIT }, PARSERS.weekly_albums);
			break;
	}
}
function get_list(key) { var cached = list_cache[list_cache_key(key)]; return cached ? cached.data : null; } // null = loading/absent

var links = [];
var hover_id = '';
var down_id = '';
var measuring = false;
function add_link(id, x, y, w, h, url, meta) {
	if (measuring) return; // silent measurement pass - real pass re-adds these
	if (meta && !meta.url) meta.url = url;
	links.push({ id: id, x: x, y: y, w: w, h: h, url: url, meta: meta || null });
}
function link_at(x, y) {
	for (var i = 0; i < links.length; i++) {
		var l = links[i];
		if (x >= l.x && x < l.x + l.w && y >= l.y + Y_OFFSET && y < l.y + l.h + Y_OFFSET) return l;
	}
	return null;
}
function open_url(url) {
	url = String(url || '');
	if (!/^https?:\/\//i.test(url)) return false;
	try {
		new ActiveXObject('WScript.Shell').Run(url);
		return true;
	} catch (e) {
		console.log('Last.fm panel: could not open ' + url);
		return false;
	}
}

// ActiveX XMLHTTP can otherwise remain pending indefinitely on a bad connection.
var API_TIMEOUT_MS = 15000;
function cancel_requests(scope) {
	var ids = [];
	for (var id in active_requests) {
		if (active_requests.hasOwnProperty(id) && (scope == 'all' || active_requests[id].scope == scope)) ids.push(id);
	}
	for (var i = 0; i < ids.length; i++) {
		var request = active_requests[ids[i]];
		if (request) request.cancel();
	}
}
function invalidate_track_requests() {
	request_token++;
	cancel_requests('track');
}
function api(method, params, token, done) {
	var url = BASE_URL + API_KEY + '&method=' + method;
	for (var k in params) {
		if (params[k] === undefined || params[k] === null) continue;
		url += '&' + k + '=' + encodeURIComponent(params[k]);
	}
	url += '&_=' + Math.random();

	var request_id = ++request_serial;
	var scope = token === null || token === undefined ? 'list' : 'track';
	var http = null;
	var watchdog = null;
	var finished = false;

	function clear_watchdog() {
		var id = watchdog;
		watchdog = null;
		if (id === null) return;
		try { window.ClearTimeout(id); } catch (e) { }
	}
	// Clear the COM callback before releasing/aborting to break the XMLHTTP <-> JS cycle.
	function release_http() {
		if (!http) return null;
		var dead = http;
		http = null;
		try { dead.onreadystatechange = null; } catch (e) { report_failure('the XMLHTTP callback could not be released', e); }
		return dead;
	}
	function unregister() {
		delete active_requests[request_id];
	}
	function cancel() {
		if (finished) return;
		finished = true;
		clear_watchdog();
		unregister();
		var dead = release_http();
		if (dead) { try { dead.abort(); } catch (e) { } }
	}
	function finish(json) {
		if (finished) return;
		finished = true;
		clear_watchdog();
		unregister();
		release_http();
		if (!script_active) return;
		if (scope == 'track' && token != request_token) return;
		done(json);
	}

	active_requests[request_id] = { scope: scope, cancel: cancel };
	try {
		http = new ActiveXObject('Microsoft.XMLHTTP');
		http.open('GET', url, true);
		try { http.setRequestHeader('User-Agent', 'foo_jsplitter_lastfm_panel'); } catch (e) { }
		http.onreadystatechange = function () {
			if (!http || http.readyState != 4) return;
			var json = null;
			if (http.status == 200) {
				try { json = JSON.parse(http.responseText); } catch (e) { report_failure('the Last.fm response was malformed', e); }
			}
			finish(json);
		};
		watchdog = window.SetTimeout(function () {
			watchdog = null;
			if (finished) return;
			if (http) { try { http.abort(); } catch (e) { } }
			finish(null);
		}, API_TIMEOUT_MS);
		http.send();
	} catch (e) {
		finish(null);
	}
	return request_id;
}
function num(v) {
	if (v === undefined || v === null || v === '') return '0';
	return group('' + v);
}
function group(s) {
	var parts = ('' + s).split('.');
	parts[0] = parts[0].replace(/(\d)(?=(\d{3})+$)/g, '$1 ');
	return parts.join('.');
}
function abbr(v) {
	var n = Number(('' + v).replace(/\s/g, ''));
	if (!isFinite(n)) return '' + v;
	if (n >= 1e9) return (Math.round(n / 1e8) / 10) + 'B';
	if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
	if (n >= 1e4) return (Math.round(n / 1e2) / 10).toFixed(1) + 'K'; // >=10k -> K
	if (n >= 1e3) return group('' + n);
	return group('' + n);
}
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function short_date(d) {
	if (!d) return '';
	var uts = d.uts ? Number(d.uts) : 0;
	if (uts > 0) {
		var dt = new Date(uts * 1000);
		var hh = ('0' + dt.getHours()).slice(-2);
		var mm = ('0' + dt.getMinutes()).slice(-2);
		return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + hh + ':' + mm;
	}
	var s = d['#text'] || '';
	return s.replace(/,?\s*\d{4}/, '');
}
function fetch_all() {
	if (!API_KEY) { state = STATE.NO_API_KEY; window.Repaint(); return; }
	if (!opt_username) { state = STATE.NO_USER; window.Repaint(); return; }
	if (!np[0]) { state = STATE.NO_TRACK; window.Repaint(); return; }
	invalidate_track_requests();
	var token = request_token;
	D = blank_data();
	pending = 4;
	failures = 0;
	state = STATE.LOADING;
	Y_OFFSET = 0;
	window.Repaint();
	delete list_cache[list_cache_key('recent')];
	ensure_tab_data(active_tab);
	api('user.getinfo', { user: opt_username }, token, function (j) {
		if (token != request_token) return;
		try {
			var u = j.user;
			username = u.name || opt_username;
			var pc = Number(u.playcount) || 0;
			D.user.playcount = num(u.playcount);
			var unix = u.registered && (u.registered.unixtime || u.registered['#text']);
			var days = 0;
			if (unix) days = (new Date().getTime() / 1000 - Number(unix)) / 86400;
			if (days > 0) {
				D.user.per_day = group((Math.round((pc / days) * 100) / 100).toString());
				D.user.per_week = group((Math.round((pc / (days / 7)) * 10) / 10).toString());
				D.user.per_month = num(Math.round(pc / (days / 30.44)));
			}
		} catch (e) { failures++; }
		settle(token);
	});
	api('artist.getinfo', { artist: np[0], username: opt_username, autocorrect: 1 }, token, function (j) {
		if (token != request_token) return;
		try {
			var a = j.artist;
			D.artist.name = a.name || np[0];
			if (a.stats) {
				D.artist.listeners = num(a.stats.listeners);
				D.artist.playcount = num(a.stats.playcount);
				D.artist.userplaycount = num(a.stats.userplaycount);
			}
			var tags = a.tags && a.tags.tag;
			if (tags) {
				if (!(tags instanceof Array)) tags = [tags];
				for (var i = 0; i < Math.min(5, tags.length); i++) {
					if (tags[i] && tags[i].name) D.artist.tags.push(tags[i].name);
				}
			}
			var sim = a.similar && a.similar.artist;
			if (sim) {
				if (!(sim instanceof Array)) sim = [sim];
				for (var k = 0; k < Math.min(5, sim.length); k++) {
					if (sim[k] && sim[k].name) D.artist.similar.push(sim[k].name);
				}
			}
		} catch (e) { failures++; }
		settle(token);
	});
	api('album.getinfo', { artist: np[0], album: np[1], username: opt_username, autocorrect: 1 }, token, function (j) {
		if (token != request_token) return;
		try {
			var al = j.album;
			D.album.name = al.name || np[1];
			D.album.listeners = num(al.listeners);
			D.album.playcount = num(al.playcount);
			D.album.userplaycount = num(al.userplaycount);
		} catch (e) { failures++; }
		settle(token);
	});
	api('track.getinfo', { artist: np[0], track: np[2], username: opt_username, autocorrect: 1 }, token, function (j) {
		if (token != request_token) return;
		try {
			var t = j.track;
			D.track.name = t.name || np[2];
			D.track.listeners = num(t.listeners);
			D.track.playcount = num(t.playcount);
			D.track.userplaycount = num(t.userplaycount);
			D.track.loved = (t.userloved == '1' || t.userloved === 1);
		} catch (e) { failures++; }
		settle(token);
	});
}
function settle(token) {
	if (token != request_token) return;
	pending--;
	if (pending > 0) return;
	state = (failures >= 4) ? STATE.ERROR : STATE.READY;
	window.Repaint();
}

function read_handle(handle) {
	if (!handle) return false;
	np = [
		fb.TitleFormat('%artist%').EvalWithMetadb(handle),
		fb.TitleFormat('%album%').EvalWithMetadb(handle),
		fb.TitleFormat('%title%').EvalWithMetadb(handle)
	];
	return !!np[0] && np[0] != '?';
}
var art_img = null;
var art_path = '';
var BLUR_RADIUS = 32; // StackBlur's valid range is 2-254; well inside it.
var ART_MAX_SIZE = 1024;
var front_path_tfo = fb.TitleFormat('$directory_path(%path%)\\front.jpg');
function dispose_art() {
	art_img = null;
}
function current_front_path() {
	var handle = fb.GetNowPlaying();
	var path = '';
	if (!handle) return '';
	try {
		path = front_path_tfo.EvalWithMetadb(handle);
	} catch (e) {
		path = '';
	}
	if (!path || path == '?') return '';
	// Do not treat stream/virtual URLs as local front.jpg paths.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return '';
	return path;
}
function refresh_local_front_art(force) {
	var path;
	var image = null;
	if (!opt_blur_bg) {
		dispose_art();
		art_path = '';
		return;
	}
	path = current_front_path();
	if (!path) {
		dispose_art();
		art_path = '';
		return;
	}
	if (!force && art_img && path == art_path) return;
	dispose_art();
	art_path = path;
	try {
		image = gdi.Image(path);
		if (image) {
			if (image.Width > ART_MAX_SIZE || image.Height > ART_MAX_SIZE) {
				var s = ART_MAX_SIZE / Math.max(image.Width, image.Height);
				image = image.Resize(Math.max(1, Math.round(image.Width * s)), Math.max(1, Math.round(image.Height * s)));
			}
			image.StackBlur(BLUR_RADIUS);
			art_img = image;
		}
	} catch (e) {
		dispose_art();
	}
}
// Hidden JSplitter children stay loaded but do not paint; coalesce work until first visible paint.
var pending_refresh = false;
var pending_art_refresh = false;
var pending_art_force = false;

function panel_is_visible() {
	return VisiblePaintWork.isVisible();
}

function request_local_front_art(force) {
	if (!panel_is_visible()) {
		pending_art_refresh = true;
		if (force) pending_art_force = true;
		return;
	}
	refresh_local_front_art(force);
}

function run_pending_refresh() {
	if (pending_art_refresh) {
		var force = pending_art_force;
		pending_art_refresh = false;
		pending_art_force = false;
		refresh_local_front_art(force);
	}
	if (pending_refresh) {
		pending_refresh = false;
		schedule_refresh();
	}
}

function clear_refresh_timer() {
	var id = refresh_timer;
	refresh_timer = null;
	if (id === null) return;
	try { window.ClearTimeout(id); } catch (e) { }
}
function invalidate_interaction() {
	var had_pointer = !!(hover_id || down_id);
	links = [];
	hover_id = '';
	down_id = '';
	if (had_pointer) {
		try { window.SetCursor(IDC_ARROW); } catch (e) { }
	}
}
function schedule_refresh() {
	if (!script_active) return;
	invalidate_track_requests();
	invalidate_interaction();
	refresh_generation++;
	clear_refresh_timer();
	if (!API_KEY) { pending_refresh = false; state = STATE.NO_API_KEY; return; }
	if (!opt_username) { pending_refresh = false; state = STATE.NO_USER; return; }
	if (!panel_is_visible()) { pending_refresh = true; return; }
	pending_refresh = false;
	var generation = refresh_generation;
	var timer_id = window.SetTimeout(function () {
		if (!script_active || generation != refresh_generation || refresh_timer != timer_id) return;
		refresh_timer = null;
		var handle = TrackContext.getHandle(opt_track_context);
		if (!read_handle(handle)) {
			state = STATE.NO_TRACK;
			window.Repaint();
			return;
		}
		fetch_all();
	}, 300);
	refresh_timer = timer_id;
}
function follow_selection_now() {
	return TrackContext.followsSelection(opt_track_context);
}

function write(gr, text, font, colour, x, y, w, h, align, valign, wrap) {
	if (!text || !font) return; // font can legitimately be null - see gdi_font()
	align = typeof align == 'number' ? align : DWRITE_TEXT_ALIGNMENT_LEADING;
	valign = typeof valign == 'number' ? valign : DWRITE_PARAGRAPH_ALIGNMENT_NEAR;
	var flags = DT_NOPREFIX;
	flags |= (align == DWRITE_TEXT_ALIGNMENT_CENTER) ? DT_CENTER : (align == DWRITE_TEXT_ALIGNMENT_TRAILING) ? DT_RIGHT : DT_LEFT;
	flags |= (valign == DWRITE_PARAGRAPH_ALIGNMENT_CENTER) ? DT_VCENTER : (valign == DWRITE_PARAGRAPH_ALIGNMENT_FAR) ? DT_BOTTOM : DT_TOP;
	if (wrap === DWRITE_WORD_WRAPPING_WRAP) {
		flags |= DT_WORDBREAK;
	} else {
		flags |= DT_SINGLELINE | DT_END_ELLIPSIS;
	}
	gr.GdiDrawText(text, font, colour, x, y, w, h, flags);
}
function centre(gr, text, font, colour) {
	write(gr, text, font, colour, lm, 0, ww - lm - rm, wh,
		DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_WORD_WRAPPING_WRAP);
}
function content_w() {
	return ww - lm - rm;
}
// Cards dry-run their content once for height, then render after the background is known.
var NOOP_GR = {
	FillSolidRect: function () {},
	DrawRect: function () {},
	FillRoundRect: function () {},
	DrawRoundRect: function () {},
	DrawImage: function () {},
	FillEllipse: function () {},
	GdiDrawText: function () {},
	PushClip: function () {},
	PopClip: function () {}
};
function draw_card(real_gr, y, content_fn, tone) {
	var x0 = lm, x1 = lm + content_w();
	measuring = true;
	var measured_bottom = content_fn(NOOP_GR, y + pad);
	measuring = false;
	var h = (measured_bottom - y) + pad;

	ui.card(real_gr, RivageUI.rect(x0, y + Y_OFFSET, x1 - x0, h), {
		fill: tone || ui_theme.card,
		stroke: ui_theme.stroke,
		border: true,
		accent: true,
		accentColour: ui_theme.accent
	});

	content_fn(real_gr, y + pad);
	return y + h + gap;
}
function eyebrow(gr, text, x, y, w) {
	write(gr, text.toUpperCase(), f_eyebrow, col.primary, x, y + Y_OFFSET, w, lh(f_eyebrow),
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	return lh(f_eyebrow) + _scale(4);
}
function draw_chips(gr, items, id_prefix, url_fn, x0, y, max_x, meta_fn) {
	if (!items || !items.length) {
		write(gr, 'No Last.fm data available', f_body, col.on_surface_var, x0, y + Y_OFFSET, max_x - x0, lh(f_body));
		return lh(f_body);
	}
	var chip_h = lh(f_body) + zoom(4, g_dpi);
	var cpad = zoom(9, g_dpi);
	var x = x0;
	var row_y = y;
	for (var n = 0; n < items.length; n++) {
		var t = items[n];
		var w = text_w(t, f_body) + cpad * 2;
		if (w > max_x - x0) w = max_x - x0;
		if (x > x0 && x + w > max_x) {
			x = x0;
			row_y += chip_h + zoom(6, g_dpi);
		}
		var id = id_prefix + n;
		ui.chip(gr, RivageUI.rect(x, row_y + Y_OFFSET, w, chip_h), {
			selected: false,
			hovered: hover_id == id,
			pressed: down_id == id,
			enabled: true
		}, {
			text: t,
			font: f_body,
			paddingX: 9,
			textFlags: RivageUI.textFlags.leftCentered
		});
		var chip_url = url_fn(t);
		add_link(id, x, row_y, w, chip_h, chip_url, meta_fn ? meta_fn(t, chip_url) : null);
		x += w + zoom(6, g_dpi);
	}
	return (row_y - y) + chip_h;
}
function draw_link_row(gr, label, text, id, url, x0, y, max_x, meta) {
	var row_h = lh(f_body_em);
	write(gr, label, f_label, col.on_surface_var, x0, y + Y_OFFSET, label_col - 6, row_h,
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	var vx = x0 + label_col;
	var avail = max_x - vx;
	if (!text) {
		write(gr, '\u2014', f_body, col.on_surface_var, vx, y + Y_OFFSET, avail, row_h,
			DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
		return row_h;
	}
	var hot = (hover_id == id || down_id == id);
	var w = Math.min(text_w(text, f_body_em) + 2, avail);
	write(gr, text, f_body_em, hot ? col.primary : col.on_surface, vx, y + Y_OFFSET, avail, row_h,
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	add_link(id, vx, y, w, row_h, url, meta);
	return row_h;
}
function draw_period_toggle(gr, x0, y, max_x) {
	var chip_h = lh(f_label) + zoom(5, g_dpi);
	var cpad = zoom(8, g_dpi);
	var x = x0;
	var row_y = y;
	for (var i = 0; i < PERIODS.length; i++) {
		var period = PERIODS[i];
		var w = text_w(period.label, f_label) + cpad * 2;
		if (x > x0 && x + w > max_x) { x = x0; row_y += chip_h + zoom(5, g_dpi); }
		var id = 'period_' + period.id;
		var active = (chart_period == period.id);
		ui.chip(gr, RivageUI.rect(x, row_y + Y_OFFSET, w, chip_h), {
			selected: active,
			hovered: hover_id == id,
			pressed: down_id == id,
			enabled: true
		}, {
			text: period.label,
			font: f_label,
			paddingX: 8,
			indicatorInset: 4,
			indicatorHeight: 2,
			textFlags: RivageUI.textFlags.leftCentered
		});
		add_link(id, x, row_y, w, chip_h, '@period:' + period.id); // sentinel URL handled in click
		x += w + zoom(5, g_dpi);
	}
	return (row_y - y) + chip_h;
}
function list_item_meta(it, id_prefix) {
	if (!it) return null;
	if (id_prefix == 'ta') return { type: 'artist', artist: it.name, url: it.url };
	if (id_prefix == 'tt' || id_prefix == 'rec') return { type: 'track', artist: it.sub, title: it.name, url: it.url };
	if (id_prefix == 'tal' || id_prefix == 'wk') return { type: 'album', artist: it.sub, album: it.name, url: it.url };
	return null;
}
function draw_list_column(gr, items, id_prefix, x0, y, w, two_line, scroll_off, clip_top, clip_bot) {
	scroll_off = scroll_off || 0;
	var has_clip = (typeof clip_top == 'number');
	if (items === null) {
		write(gr, 'Loading...', f_body, col.on_surface_var, x0, y + Y_OFFSET, w, lh(f_body));
		return lh(f_body);
	}
	if (!items.length) {
		write(gr, 'No Last.fm data available', f_body, col.on_surface_var, x0, y + Y_OFFSET, w, lh(f_body));
		return lh(f_body);
	}
	var rank_w = zoom(22, g_dpi);
	var is_dates = (id_prefix == 'rec');
	var plays_w = is_dates ? zoom(92, g_dpi) : zoom(44, g_dpi);
	var name_x = x0 + rank_w;
	var name_w = w - rank_w - plays_w - zoom(6, g_dpi);
	if (name_w < zoom(40, g_dpi)) name_w = zoom(40, g_dpi);
	var row_h = two_line ? (lh(f_body_em) + lh(f_label)) : (lh(f_body_em) + zoom(4, g_dpi));
	var step = row_h + zoom(3, g_dpi);
	// The clip band bounds partial rows, so scrolling is free-running; link rects are
	// clamped to it or a half-row would stay clickable where it is drawn over the header.
	var cy = y + scroll_off;
	if (has_clip) gr.PushClip(x0, clip_top, w, clip_bot - clip_top);
	try {
		for (var i = 0; i < items.length; i++) {
			var row_top = cy + Y_OFFSET;
			var row_bot = row_top + row_h;
			if (has_clip && (row_bot <= clip_top || row_top >= clip_bot)) { cy += step; continue; }
			var it = items[i];
			var id = id_prefix + i;
			var hot = (hover_id == id || down_id == id);
			if (it.now) {
				gr.FillSolidRect(x0 + _scale(3), cy + _scale(3) + Y_OFFSET, _scale(2), Math.max(_scale(6), row_h - _scale(6)), col.primary);
			} else {
				write(gr, (i + 1) + '', f_label, col.on_surface_var, x0, cy + Y_OFFSET, rank_w, lh(f_body_em),
					DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
			}
			write(gr, it.name, f_body_em, (hot || it.now) ? col.primary : col.on_surface, name_x, cy + Y_OFFSET, name_w, lh(f_body_em),
				DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
			if (it.plays) {
				write(gr, it.plays, f_label, col.on_surface_var, x0 + w - plays_w, cy + Y_OFFSET, plays_w, lh(f_body_em),
					DWRITE_TEXT_ALIGNMENT_TRAILING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
			}
			if (two_line && it.sub) {
				write(gr, it.sub, f_label, col.on_surface_var, name_x, cy + lh(f_body_em) - zoom(2, g_dpi) + Y_OFFSET, name_w, lh(f_label),
					DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
			}
			if (it.url) {
				var vis_top = has_clip ? Math.max(row_top, clip_top) : row_top;
				var vis_bot = has_clip ? Math.min(row_bot, clip_bot) : row_bot;
				if (vis_bot > vis_top) add_link(id, x0, vis_top - Y_OFFSET, w, vis_bot - vis_top, it.url, list_item_meta(it, id_prefix));
			}
			cy += step;
		}
	} finally {
		if (has_clip) gr.PopClip();
	}
	return (cy - scroll_off) - y; // unscrolled content height
}
function draw_tab_bar(gr, x0, y, max_x) {
	var tab_h = lh(f_label) + zoom(8, g_dpi);
	var cpad = zoom(10, g_dpi);
	var x = x0, row_y = y;
	for (var i = 0; i < TABS.length; i++) {
		var t = TABS[i];
		var tw = text_w(t.label, f_label) + cpad * 2;
		if (x > x0 && x + tw > max_x) { x = x0; row_y += tab_h + zoom(5, g_dpi); }
		var id = 'tab_' + t.id;
		var active = (active_tab == t.id);
		ui.chip(gr, RivageUI.rect(x, row_y + Y_OFFSET, tw, tab_h), {
			selected: active,
			hovered: hover_id == id,
			pressed: down_id == id,
			enabled: true
		}, {
			text: t.label,
			font: f_label,
			paddingX: 10,
			indicatorInset: 4,
			indicatorHeight: 2,
			textFlags: RivageUI.textFlags.leftCentered
		});
		add_link(id, x, row_y, tw, tab_h, '@tab:' + t.id);
		x += tw + zoom(5, g_dpi);
	}
	return (row_y - y) + tab_h;
}

var SECTION_DEFS = [
	{ id: 'track', label: 'Current track + Stats' },
	{ id: 'tags', label: 'Artist tags' },
	{ id: 'similar', label: 'Similar artists' },
	{ id: 'explorer', label: 'Charts / Recent / Albums' }
];
function default_order() {
	var o = [];
	for (var i = 0; i < SECTION_DEFS.length; i++) o.push(SECTION_DEFS[i].id);
	return o;
}
function load_order() {
	var saved = window.GetProperty('lastfm.section_order', '');
	var order = saved ? saved.split(',') : default_order();
	var valid = {};
	for (var i = 0; i < SECTION_DEFS.length; i++) valid[SECTION_DEFS[i].id] = true;
	var out = [];
	for (var k = 0; k < order.length; k++) if (valid[order[k]] && out.indexOf(order[k]) < 0) out.push(order[k]);
	for (var m = 0; m < SECTION_DEFS.length; m++) if (out.indexOf(SECTION_DEFS[m].id) < 0) out.push(SECTION_DEFS[m].id);
	return out;
}
function load_hidden() {
	var saved = window.GetProperty('lastfm.section_hidden', '');
	var h = {};
	if (saved) { var a = saved.split(','); for (var i = 0; i < a.length; i++) if (a[i]) h[a[i]] = true; }
	return h;
}
var section_order = load_order();
var section_hidden = load_hidden();
function hidden_wire(hidden) {
	var a = [];
	for (var k in hidden) if (hidden.hasOwnProperty(k) && hidden[k]) a.push(k);
	return a.join(',');
}
function move_section(id, dir) {
	var i = section_order.indexOf(id);
	if (i < 0) return false;
	var j = i + dir;
	if (j < 0 || j >= section_order.length) return false;
	var next = section_order.slice(0);
	var t = next[i]; next[i] = next[j]; next[j] = t;
	if (!try_set_property('lastfm.section_order', next.join(','))) return false;
	section_order = next;
	window.Repaint();
	return true;
}
function set_section_hidden(id, hidden) {
	if (!!section_hidden[id] == !!hidden) return true;
	var next = {};
	for (var k in section_hidden) if (section_hidden.hasOwnProperty(k) && section_hidden[k]) next[k] = true;
	if (hidden) next[id] = true;
	else delete next[id];
	if (!try_set_property('lastfm.section_hidden', hidden_wire(next))) return false;
	section_hidden = next;
	window.Repaint();
	return true;
}
function toggle_section(id) {
	return set_section_hidden(id, !section_hidden[id]);
}
function stat_text(value) {
	if (value === undefined || value === null || value === '') return '0';
	return '' + value;
}
function stat_group_width(parts) {
	var width = 0;
	for (var i = 0; i < parts.length; i++) {
		width += text_w(parts[i][0], parts[i][1]) + 2;
	}
	return width;
}
function draw_stat_group(g, parts, x, y, row_h) {
	for (var i = 0; i < parts.length; i++) {
		var text = '' + parts[i][0];
		var font = parts[i][1];
		var width = text_w(text, font) + 2;
		write(g, text, font, parts[i][2], x, y + Y_OFFSET, width, row_h,
			DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
		x += width;
	}
	return x;
}
function draw_stat_row(g, label, obj, x0, y, max_x) {
	var row_h = lh(f_body_em);
	write(g, label, f_label, col.on_surface_var, x0, y + Y_OFFSET, label_col - 6, row_h,
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	var x = x0 + label_col;
	var sep = '  \u00B7  ';
	var user_count = stat_text(obj && obj.userplaycount);
	var total_plays = abbr(stat_text(obj && obj.playcount));
	var listeners = abbr(stat_text(obj && obj.listeners));
	var groups = [
		[
			['You ', f_label, col.on_surface_var],
			[user_count, f_body_em, col.on_surface]
		],
		[
			[sep, f_label, col.on_surface_var],
			[total_plays, f_body_em, col.on_surface],
			[' plays', f_label, col.on_surface_var]
		],
		[
			[sep, f_label, col.on_surface_var],
			[listeners, f_body_em, col.on_surface],
			[' listeners', f_label, col.on_surface_var]
		]
	];
	for (var i = 0; i < groups.length; i++) {
		var group_width = stat_group_width(groups[i]);
		if (x + group_width > max_x) break;
		x = draw_stat_group(g, groups[i], x, y, row_h);
	}
	return row_h;
}
var SECTIONS = {
	track: function (gr, y, ctx) {
		return draw_card(gr, y, function (g, cy) {
			var inner_l = lm + pad;
			var inner_r = lm + content_w() - pad;
			var full_w = inner_r - inner_l;
			var two_col = full_w > zoom(360, g_dpi);
			var col_gap = zoom(18, g_dpi);
			var left_w = two_col ? Math.round(full_w * 0.5) : full_w;
			var right_x = inner_l + left_w + col_gap;
			var right_w = inner_r - right_x;
			var eb_h = eyebrow(g, 'Current track', inner_l, cy, left_w);
			if (D.track.loved) {
				var title_w = text_w('CURRENT TRACK', f_eyebrow);
				var hx = inner_l + zoom(8, g_dpi) + title_w + zoom(8, g_dpi);
				write(g, RivageUI.icons.heartFill, f_icon, col.primary, hx, cy + Y_OFFSET, lh(f_icon) + 4, lh(f_eyebrow),
					DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
			}
			if (two_col) eyebrow(g, 'Stats', right_x, cy, right_w);
			var top = cy + eb_h;
			var ly = top;
			ly += draw_link_row(g, 'Artist', ctx.a_name, 'l_artist',
				'https://www.last.fm/music/' + encodeURIComponent(ctx.a_name), inner_l, ly, inner_l + left_w,
				{ type: 'artist', artist: ctx.a_name });
			ly += draw_link_row(g, 'Album', ctx.al_name, 'l_album',
				'https://www.last.fm/music/' + encodeURIComponent(ctx.a_name) + '/' + encodeURIComponent(ctx.al_name), inner_l, ly, inner_l + left_w,
				{ type: 'album', artist: ctx.a_name, album: ctx.al_name });
			ly += draw_link_row(g, 'Track', ctx.t_name, 'l_track',
				'https://www.last.fm/music/' + encodeURIComponent(ctx.a_name) + '/_/' + encodeURIComponent(ctx.t_name), inner_l, ly, inner_l + left_w,
				{ type: 'track', artist: ctx.a_name, album: ctx.al_name, title: ctx.t_name });
			var ry = top;
			if (!two_col) {
				ry = ly + zoom(6, g_dpi);
				ry += eyebrow(g, 'Stats', inner_l, ry, full_w);
				right_x = inner_l; right_w = full_w;
			}
			ry += draw_stat_row(g, 'Artist', D.artist, right_x, ry, right_x + right_w);
			ry += draw_stat_row(g, 'Album', D.album, right_x, ry, right_x + right_w);
			ry += draw_stat_row(g, 'Track', D.track, right_x, ry, right_x + right_w);
			return Math.max(ly, ry);
		});
	},
	tags: function (gr, y, ctx) {
		return draw_card(gr, y, function (g, cy) {
			cy += eyebrow(g, 'Artist tags', lm + pad, cy, content_w() - pad * 2);
			cy += draw_chips(g, D.artist.tags, 'tag',
				function (t) { return 'https://www.last.fm/tag/' + encodeURIComponent(t); },
				lm + pad, cy, lm + content_w() - pad);
			return cy;
		});
	},
	similar: function (gr, y, ctx) {
		return draw_card(gr, y, function (g, cy) {
			cy += eyebrow(g, 'Similar artists', lm + pad, cy, content_w() - pad * 2);
			cy += draw_chips(g, D.artist.similar, 'sim',
				function (a) { return 'https://www.last.fm/music/' + encodeURIComponent(a); },
				lm + pad, cy, lm + content_w() - pad,
				function (a) { return { type: 'artist', artist: a }; });
			return cy;
		});
	},
	explorer: function (gr, y, ctx) {
		return draw_card(gr, y, function (g, cy) {
			cy += draw_tab_bar(g, lm + pad, cy, lm + content_w() - pad);
			cy += zoom(8, g_dpi);
			var inner_l = lm + pad;
			var inner_r = lm + content_w() - pad;
			var list_id_prefix = null, single_items = null;
			var is_charts = false;
			if (active_tab == 'charts') {
				cy += draw_period_toggle(g, inner_l, cy, inner_r);
				cy += zoom(8, g_dpi);
				is_charts = true;
			} else if (active_tab == 'albums') {
				cy += draw_period_toggle(g, inner_l, cy, inner_r);
				cy += zoom(8, g_dpi);
				single_items = get_list('top_albums@' + chart_period); list_id_prefix = 'tal';
			} else if (active_tab == 'recent') {
				single_items = get_list('recent'); list_id_prefix = 'rec';
			} else if (active_tab == 'weekly') {
				single_items = get_list('weekly_albums'); list_id_prefix = 'wk';
			}
			var available_list_w = Math.max(1, inner_r - inner_l);
			var scrollbar_gutter = Math.min(sb_w, Math.max(_scale(4), Math.floor(available_list_w * 0.12)));
			scrollbar_gutter = Math.min(scrollbar_gutter, Math.max(0, available_list_w - 1));
			var list_r = inner_r - scrollbar_gutter;
			var scrollbar_track_w = _scale(2);
			var scrollbar_x = list_r + Math.max(0, Math.floor((inner_r - list_r - scrollbar_track_w) / 2));
			var list_w = Math.max(1, list_r - inner_l);
			var col_gap = Math.min(zoom(14, g_dpi), Math.max(0, list_w - _scale(2)));
			var half = Math.max(_scale(1), Math.floor((list_w - col_gap) / 2));
			var header_h = 0;
			if (is_charts) {
				write(g, 'Artists', f_label, col.on_surface_var, inner_l, cy + Y_OFFSET, half, lh(f_label));
				write(g, 'Tracks', f_label, col.on_surface_var, inner_l + half + col_gap, cy + Y_OFFSET, half, lh(f_label));
				header_h = lh(f_label) + zoom(5, g_dpi);
			} else if (active_tab == 'weekly') {
				write(g, 'Last completed week', f_label, col.on_surface_var, inner_l, cy + Y_OFFSET, list_r - inner_l, lh(f_label));
				header_h = lh(f_label) + zoom(3, g_dpi);
			}
			var list_top = cy + header_h;
			var min_h = zoom(90, g_dpi);
			var view_h = Math.max(wh - list_top - pad - tm, min_h);
			var clip_top = list_top;
			var clip_bot = list_top + view_h;
			var content_px;
			if (is_charts) {
				var hA = draw_list_column(g, get_list('top_artists@' + chart_period), 'ta', inner_l, list_top, half, false, list_scroll, clip_top, clip_bot);
				var hT = draw_list_column(g, get_list('top_tracks@' + chart_period), 'tt', inner_l + half + col_gap, list_top, half, true, list_scroll, clip_top, clip_bot);
				content_px = Math.max(hA, hT);
			} else {
				content_px = draw_list_column(g, single_items, list_id_prefix, inner_l, list_top, list_r - inner_l, true, list_scroll, clip_top, clip_bot);
			}
			list_view = { x: inner_l, y: list_top, w: inner_r - inner_l, h: view_h, content: content_px };
			var max_ls = Math.max(0, content_px - view_h);
			if (-list_scroll > max_ls) list_scroll = -max_ls;
			if (list_scroll > 0) list_scroll = 0;

			ui.scrollbar(g, {
				x: scrollbar_x,
				y: list_top + Y_OFFSET,
				height: view_h,
				contentHeight: content_px,
				viewportHeight: view_h,
				scroll: -list_scroll
			});
			return clip_bot;
		});
	}
};

function on_colours_changed() {
	update_colours();
	window.Repaint();
}
function on_font_changed() {
	update_fonts();
	refresh_layout_metrics();
	window.Repaint();
}
// The host repaints after on_size; repainting here causes redundant resize work.
function on_size(width, height) {
	ww = width;
	wh = height;
	clamp_scroll();
}
function on_paint(gr) {
	run_pending_refresh();
	links = [];
	var sharedMicaMode = RivageBackdrop.isMicaMode();
	RivageBackdrop.paint(gr, 0, 0, ww, wh, col.bg);
	if (!sharedMicaMode && opt_blur_bg && art_img) {
		var iw = art_img.Width, ih = art_img.Height;
		var scale = Math.max(ww / iw, wh / ih); // cover
		var dw = iw * scale, dh = ih * scale;
		var dx = (ww - dw) / 2, dy = (wh - dh) / 2;
		gr.DrawImage(art_img, dx, dy, dw, dh, 0, 0, iw, ih);
		gr.FillSolidRect(0, 0, ww, wh, RGBA(chan(col.bg, 0), chan(col.bg, 1), chan(col.bg, 2), 205)); // scrim
	}
	if (ww < 120 || wh < 60) { invalidate_interaction(); return; }
	if (state == STATE.NO_API_KEY) {
		centre(gr, 'Set your Last.fm API key in Global settings.', f_body, col.on_surface_var);
		return;
	}
	if (state == STATE.NO_USER) {
		centre(gr, 'Set your Last.fm username in Global settings.', f_body, col.on_surface_var);
		return;
	}
	if (state == STATE.NO_TRACK) {
		centre(gr, 'No track selected.', f_body, col.on_surface_var);
		return;
	}
	if (state == STATE.LOADING) {
		centre(gr, 'Loading Last.fm data...', f_body, col.on_surface_var);
		return;
	}
	if (state == STATE.ERROR) {
		centre(gr, np[0] + '\n' + np[2] + '\n\nCouldn\u2019t reach Last.fm - check your connection or API key.', f_body, col.on_surface_var);
		return;
	}
	var y = tm;
	var uname = username || opt_username;
	var brand = 'LAST.FM';
	var hero_h = lh(f_headline) + lh(f_label) + _scale(14);
	var hx0 = lm, hx1 = lm + content_w();
	ui.card(gr, RivageUI.rect(hx0, y + Y_OFFSET, hx1 - hx0, hero_h), {
		fill: ui_theme.card,
		stroke: ui_theme.stroke,
		border: true,
		accent: true,
		accentColour: ui_theme.accent
	});
	var hx = hx0 + pad;
	var hy = y + _scale(5) + Y_OFFSET;
	var brand_w = text_w(brand, f_eyebrow);
	var sep = '  \u00B7  ';
	var sep_w = text_w(sep, f_body);
	write(gr, brand, f_eyebrow, col.primary, hx, hy, brand_w + 2, lh(f_headline),
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	write(gr, sep, f_body, col.on_surface_var, hx + brand_w, hy, sep_w + 2, lh(f_headline),
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	var ux = hx + brand_w + sep_w;
	var user_hot = (hover_id == 'user' || down_id == 'user');
	write(gr, uname, f_headline, user_hot ? col.primary : col.on_surface, ux, hy, hx1 - pad - ux, lh(f_headline),
		DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
	add_link('user', ux, hy - Y_OFFSET, Math.min(text_w(uname, f_headline), hx1 - pad - ux), lh(f_headline),
		'https://www.last.fm/user/' + encodeURIComponent(uname));
	hy += lh(f_headline);
write(
    gr,
    D.user.playcount + ' scrobbles \u00B7 ' +
    D.user.per_day + '/day \u00B7 ' +
    D.user.per_week + '/wk \u00B7 ' +
    D.user.per_month + '/mo',
    f_label,
    col.on_surface_var,
    hx,
    hy,
    hx1 - pad - hx,
    lh(f_label)
);
	y += hero_h + gap;
	var a_name = D.artist.name || np[0];
	var al_name = D.album.name || np[1];
	var t_name = D.track.name || np[2];
	var ctx = { a_name: a_name, al_name: al_name, t_name: t_name };
	for (var si = 0; si < section_order.length; si++) {
		var sid = section_order[si];
		if (section_hidden[sid]) continue;
		var fn = SECTIONS[sid];
		if (fn) y = fn(gr, y, ctx);
	}
}
function clamp_scroll() {
	Y_OFFSET = 0;
}
var last_mx = 0, last_my = 0;
function on_mouse_wheel(step) {
	var over_list = list_view.content > list_view.h &&
		last_mx >= list_view.x && last_mx <= list_view.x + list_view.w &&
		last_my >= list_view.y && last_my <= list_view.y + list_view.h;
	if (!over_list) return;
	var max_ls = Math.max(0, list_view.content - list_view.h);
	list_scroll += step * zoom(40, g_dpi);
	if (list_scroll > 0) list_scroll = 0;
	if (-list_scroll > max_ls) list_scroll = -max_ls;
	window.Repaint();
}
function on_mouse_move(x, y, mask) {
	last_mx = x; last_my = y;
	var l = link_at(x, y);
	var id = l ? l.id : '';
	if (id != hover_id) {
		hover_id = id;
		window.SetCursor(id ? IDC_HAND : IDC_ARROW);
		window.Repaint();
	}
}
function on_mouse_leave() {
	if (hover_id || down_id) {
		hover_id = '';
		down_id = '';
		window.SetCursor(IDC_ARROW);
		window.Repaint();
	}
}
function on_mouse_lbtn_down(x, y, mask) {
	var l = link_at(x, y);
	down_id = l ? l.id : '';
	if (down_id) window.Repaint();
}
function on_mouse_lbtn_up(x, y, mask) {
	var l = link_at(x, y);
	if (l && l.id == down_id && l.url) {
		if (l.url.indexOf('@tab:') == 0) {
			set_active_tab(l.url.substring(5));
		} else if (l.url.indexOf('@period:') == 0) {
			set_chart_period(l.url.substring(8));
		} else {
			open_url(l.url);
		}
	}
	if (down_id) { down_id = ''; window.Repaint(); }
}
function on_mouse_rbtn_up(x, y, mask) {
	if ((mask & MK_SHIFT) !== 0) return false;
	show_menu(x, y, link_at(x, y));
	return true;
}
function show_menu(x, y, context_link) {
	var menu = window.CreatePopupMenu();
	var follow = window.CreatePopupMenu();
	var sections = window.CreatePopupMenu();
	var appearance = window.CreatePopupMenu();
	var accent = window.CreatePopupMenu();
	var library_state = null;
	if (context_link && context_link.meta) {
		library_state = RivageLibraryActions.append(menu, context_link.meta, { separator: false, webLabel: 'Open on Last.fm' });
		menu.AppendMenuSeparator();
	}
	var SEC_BASE = 1000, SEC_STRIDE = 10;
	if (API_KEY && opt_username) {
		menu.AppendMenuItem(MF_STRING, 1, 'Refresh Last.fm data');
		menu.AppendMenuItem(MF_SEPARATOR, 0, '');
		var trackChoices = TrackContext.getOverrideChoices();
		follow.AppendMenuItem(GetMenuFlags(true, opt_track_context == TrackContext.MODE_GLOBAL), 2, trackChoices[0].label);
		follow.AppendMenuItem(GetMenuFlags(true, opt_track_context == TrackContext.MODE_AUTO), 3, trackChoices[1].label);
		follow.AppendMenuItem(GetMenuFlags(true, opt_track_context == TrackContext.MODE_NOW_PLAYING), 10, trackChoices[2].label);
		follow.AppendMenuItem(GetMenuFlags(true, opt_track_context == TrackContext.MODE_SELECTION), 11, trackChoices[3].label);
		follow.AppendTo(menu, MF_STRING, 'Track source');
		for (var s = 0; s < section_order.length; s++) {
			var sid = section_order[s];
			var def = null;
			for (var d = 0; d < SECTION_DEFS.length; d++) if (SECTION_DEFS[d].id == sid) def = SECTION_DEFS[d];
			if (!def) continue;
			var sub = window.CreatePopupMenu();
			var base = SEC_BASE + s * SEC_STRIDE;
			sub.AppendMenuItem(s == 0 ? MF_GRAYED : MF_STRING, base + 0, 'Move up');
			sub.AppendMenuItem(s == section_order.length - 1 ? MF_GRAYED : MF_STRING, base + 1, 'Move down');
			sub.AppendMenuItem(MF_SEPARATOR, 0, '');
			sub.AppendMenuItem(GetMenuFlags(true, !section_hidden[sid]), base + 2, 'Show section');
			sub.AppendTo(sections, MF_STRING, def.label);
		}
		sections.AppendTo(menu, MF_STRING, 'Sections');
		accent.AppendMenuItem(GetMenuFlags(true, opt_accent_mode == AccentMode.Default), 6, RivageUI.copy.labels.rvgBlue);
		accent.AppendMenuItem(GetMenuFlags(true, opt_accent_mode == AccentMode.AlbumArt), 8, RivageUI.copy.labels.sharedAccent);
		accent.AppendTo(appearance, MF_STRING, 'Accent colour');
		appearance.AppendMenuItem(MF_SEPARATOR, 0, '');
		appearance.AppendMenuItem(GetMenuFlags(true, opt_blur_bg), 9, 'Use blurred local artwork as background');
		appearance.AppendTo(menu, MF_STRING, 'Appearance');
	} else {
		menu.AppendMenuItem(MF_GRAYED, 0, 'Add Last.fm credentials in Global settings');
	}
	var idx = menu.TrackPopupMenu(x, y);
	if (RivageLibraryActions.handle(library_state, idx)) return;
	if (idx >= SEC_BASE) {
		var rel = idx - SEC_BASE;
		var s_idx = Math.floor(rel / SEC_STRIDE);
		var action = rel % SEC_STRIDE;
		var sid2 = section_order[s_idx];
		if (sid2) {
			if (action == 0) move_section(sid2, -1);
			else if (action == 1) move_section(sid2, 1);
			else if (action == 2) toggle_section(sid2);
		}
	} else {
		switch (idx) {
			case 1:
				refresh_local_front_art(true);
				schedule_refresh();
				break;
			case 2:
			case 3:
			case 10:
			case 11:
				set_track_context(idx == 2 ? TrackContext.MODE_GLOBAL : (idx == 3 ? TrackContext.MODE_AUTO : (idx == 10 ? TrackContext.MODE_NOW_PLAYING : TrackContext.MODE_SELECTION)));
				break;
			case 6:
				set_accent_mode(AccentMode.Default);
				break;
			case 8:
				set_accent_mode(AccentMode.AlbumArt);
				break;
			case 9:
				set_blur_background(!opt_blur_bg);
				break;
		}
	}
}
function GetMenuFlags(enabled, checked) {
	var flags = enabled ? MF_STRING : MF_GRAYED;
	if (checked) flags |= MF_CHECKED;
	return flags;
}
function set_track_context(mode) {
	var next = TrackContext.normaliseOverride(mode);
	if (next == opt_track_context) return true;
	if (!try_set_property('lastfm.track_context_override', next)) return false;
	opt_track_context = next;
	schedule_refresh();
	return true;
}
function set_accent_mode(mode) {
	var next = normalise_accent_mode(mode);
	if (next == opt_accent_mode) return true;
	if (!try_set_property('lastfm.accent_mode', next)) return false;
	opt_accent_mode = next;
	apply_accent(current_accent());
	if (next == AccentMode.AlbumArt) request_shared_accent();
	window.Repaint();
	return true;
}
function set_blur_background(value) {
	var next = !!value;
	if (next == opt_blur_bg) return true;
	if (!try_set_property('lastfm.blur_bg', next)) return false;
	opt_blur_bg = next;
	refresh_local_front_art(true);
	window.Repaint();
	return true;
}
function set_active_tab(value) {
	var next = normalise_tab(value);
	if (next == active_tab) return true;
	if (!try_set_property('lastfm.active_tab', next)) return false;
	active_tab = next;
	ensure_tab_data(next);
	list_scroll = 0;
	window.Repaint();
	return true;
}
function set_chart_period(value) {
	var next = normalise_period(value);
	if (next == chart_period) return true;
	if (!try_set_property('lastfm.chart_period', next)) return false;
	chart_period = next;
	ensure_tab_data(active_tab);
	list_scroll = 0;
	window.Repaint();
	return true;
}

var SETTINGS_PANEL_ID = 'lastfm';
var SETTINGS_PANEL_LABEL = 'Last.fm';

function getMySettings() {
	var settings = [
		{ id: 'trackSourceOverride', label: 'Track source', type: 'choice',
		  value: opt_track_context, choiceValueType: 'string', choices: TrackContext.getOverrideChoices()
		},
		{ id: 'accentMode', label: 'Accent source', type: 'choice',
		  value: opt_accent_mode,
		  choiceValueType: 'string',
		  choices: [
			  { value: AccentMode.Default, label: RivageUI.copy.labels.rvgBlue },
			  { value: AccentMode.AlbumArt, label: RivageUI.copy.labels.sharedAccent }
		  ]
		},
		{ id: 'blurBackground', label: 'Use blurred local artwork as background', type: 'bool', value: opt_blur_bg, hint: 'Looks for front.jpg beside the track.' }
	];
	var i;
	for (i = 0; i < SECTION_DEFS.length; i++) {
		settings.push({ id: 'section_' + SECTION_DEFS[i].id, label: 'Show ' + SECTION_DEFS[i].label, type: 'bool', value: !section_hidden[SECTION_DEFS[i].id] });
	}
	return settings;
}

function applyMySetting(settingId, value) {
	var sectionId;

	if (settingId === 'trackSourceOverride') {
		set_track_context(value);
		return;
	}
	if (settingId === 'accentMode') {
		set_accent_mode(value);
		return;
	}
	if (settingId === 'blurBackground') {
		set_blur_background(value);
		return;
	}
	if (settingId.indexOf('section_') === 0) {
		sectionId = settingId.slice('section_'.length);
		set_section_hidden(sectionId, !value);
		return;
	}
}

function apply_lastfm_credentials(creds) {
	if (creds.apiKey === API_KEY && creds.username === opt_username) return;
	invalidate_track_requests();
	reset_list_cache();
	API_KEY = creds.apiKey;
	opt_username = creds.username;
	username = '';
	state = !API_KEY ? STATE.NO_API_KEY : (!opt_username ? STATE.NO_USER : STATE.LOADING);
	invalidate_interaction();
	window.Repaint();
	schedule_refresh();
}

function on_notify_data(name, info) {
	var colour;
	if (SharedThemeProtocol.consume(name, info)) return;
	if (LastfmCredentialsProtocol.consume(name, info, apply_lastfm_credentials)) return;

	if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
	if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
	if (SettingsRegistry.consume(name, info, 'global', TrackContext.applySetting)) return;
	if (TrackContext.onNotifyData(name, info, false)) return;

	if (name != SHARED_ALBUM_ACCENT_UPDATE || !SharedAccentProtocol.isColour(info)) return;
	colour = SharedAccentProtocol.opaque(info);
	if (colour === shared_album_accent) return;
	shared_album_accent = colour;
	if (SharedThemeProtocol.isAccentCommitted(colour)) return;
	if (opt_accent_mode == AccentMode.AlbumArt) {
		apply_accent(shared_album_accent);
		// Let JSplitter batch track-driven accent updates with the semantic theme.
		window.Repaint();
	}
}
function on_playback_new_track(handle) {
	request_local_front_art(false);
	if (TrackContext.followsPlayback(opt_track_context)) schedule_refresh();
}
function on_playback_dynamic_info_track() {
	if (TrackContext.followsPlayback(opt_track_context)) schedule_refresh();
}
function on_playback_stop(reason) {
	if (reason != PlaybackStopReason.starting_another) {
		request_local_front_art(true);
		schedule_refresh();
	}
}
function on_item_focus_change(playlistIndex, from, to) {
	if (follow_selection_now()) schedule_refresh();
}
function on_playlist_switch() {
	on_item_focus_change();
}
function on_playlist_items_selection_change() {
	on_item_focus_change();
}
function on_script_unload() {
	script_active = false;
	refresh_generation++;
	request_token++;
	list_request_generation++;
	clear_refresh_timer();
	cancel_requests('all');
	dispose_art();
}
function update_colours() {
	var host = RivageUI.hostInfo();
	UI_ACCENT = host.accent;
	ui_theme = RivageUI.createTheme({
		mode: 'host',
		host: host,
		background: host.background,
		text: host.text,
		accent: current_accent()
	});
	ui.setTheme(ui_theme);
	sync_colours_from_theme();
}

ww = window.Width;
wh = window.Height;
update_colours();
update_fonts();
refresh_layout_metrics();
refresh_local_front_art(true);
SharedAccentProtocol.request();
TrackContext.onChange(schedule_refresh);
TrackContext.requestSync();
state = STATE.NO_API_KEY;
LastfmCredentialsProtocol.requestUntilAnswered();
