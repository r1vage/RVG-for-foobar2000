// *****************************************************************************************************************************************
// Originally coded by Br3tt aka Falstaff (JSPlaylist / SMP-Mod) - 2015
// Modified by RivaGe
// *****************************************************************************************************************************************

var g_script_version = "2.6.0";
var g_LDT = DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_END_ELLIPSIS;
var g_middle_clicked = false;
var g_middle_click_timer = false;
var g_leave = false;
var g_init_on_size = false;
var g_left_click_hold = false;
var g_selHolder = fb.AcquireUiSelectionHolder();
g_selHolder.SetPlaylistSelectionTracking();
var g_repaint = 0;
var g_seconds = 0;
var g_timer1 = false, need_repaint = false;
// full_repaint() uses a one-shot 40ms batching timer instead of an always-running poll.
// This keeps the old ~25 fps repaint ceiling during scrolling/animation but costs zero timer
// wakeups while the playlist is idle.
var SKIP_WORK_WHEN_HIDDEN = true;
var g_mouse_wheel_timer = false;
// drag'n drop from windows system
var g_dragndrop_status = false;
var g_dragndrop_x = -1;
var g_dragndrop_y = -1;
var g_dragndrop_bottom = false;
var g_dragndrop_timer = false;
var g_dragndrop_trackId = -1;
var g_dragndrop_rowId = -1;
var g_dragndrop_targetPlaylistId = -1;
var g_dragndrop_total_before = 0;
// font vars
var g_fname, g_fsize, g_fstyle;
var g_font = null;
var g_font_headers = null;
var g_font_group1 = null;
var g_font_group2 = null;
var g_font_group_footer = null;
var g_font_guifx_found = utils.CheckFont("guifx v2 transports");
var g_font_playicon, g_font_pauseicon, g_font_checkbox, g_font_queue_idx, g_font_rating, g_font_mood;
var g_font_wd1, g_font_wd2, g_font_wd3;
// jssp font system (2.5)
var g_uiFontName = "segoe ui";
var g_font_row_size = 11, g_font_ui_size = 10, g_font_header_title_size = 15;
var g_font_header_detail_size = 11, g_font_header_footer_size = 11, g_font_icon_size = 15, g_font_state_icon_size = 16;
var g_font_bold = null, g_font_small = null, g_font_ui = null, g_font_ui_bold = null;
var g_font_icon = null, g_font_icon_big = null;
// color vars
var g_color_normal_bg = 0;
var g_color_selected_bg = 0;
var g_color_normal_txt = 0;
var g_color_selected_txt = 0;
var g_color_highlight = 0;
var g_syscolor_window_bg = 0;
var g_syscolor_highlight = 0;
var g_syscolor_button_bg = 0;
var g_syscolor_button_txt = 0;
// main window vars
var g_avoid_on_playlists_changed = false;
var g_avoid_on_playlist_items_reordered = false;
var g_avoid_on_item_focus_change = false;
var g_avoid_on_playlist_items_added = false;
var g_avoid_on_playlist_items_removed = false;
var g_first_launch = true;
var g_instancetype = window.InstanceType;

var g_dpi_percent = 0;
var g_forced_percent = 0;
var g_dpi = (g_forced_percent == 0 ? g_dpi_percent : g_forced_percent);
var g_z2 = 0;
var g_z3 = 0;
var g_z4 = 0;
var g_z5 = 0;
var g_z6 = 0;
var g_z8 = 0;
var g_z10 = 0;
var g_z16 = 0;
var ww = 0, wh = 0;
var mouse_x = 0, mouse_y = 0;
var g_metadb;
var foo_playcount = utils.CheckComponent("foo_playcount", true);
// Playcount 2003 (foo_playcount_2003) - the alternative local rating/playback
// statistics backend selectable via the global "Playback statistics field
// source" setting (shared/playback_stats_source.js). See ratingCanWrite()/
// writeRatingCommand() below and their one call site in WSHplaylist.js.
var foo_playcount_2003 = utils.CheckComponent("foo_playcount_2003", true);
clipboard = {
	selection: null
};
// wallpaper infos
var wpp_img_info = {
	orient: 0,
	cut: 0,
	cut_offset: 0,
	ratio: 0,
	x: 0,
	y: 0,
	w: 0,
	h: 0
};
// WSH statistics globals
var tf_path = fb.TitleFormat("$left(%_path_raw%,4)");
var g_path, g_track_type;
var opt_stats = window.GetProperty("CUSTOM.Enable Statistics (write to file)", false);
var wsh_time_elaps;
var wsh_delay_stats;
var wsh_limit_stats;
var tf_length_seconds = fb.TitleFormat("%length_seconds_fp%");
var first_played = fb.TitleFormat("%first_played%");
var last_played = fb.TitleFormat("%last_played%");
var play_counter = fb.TitleFormat("%play_counter%");
var play_count = fb.TitleFormat("%play_count%");
cStats = {
	handle: null,
	waiting_for_writing: false
};

//=================================================// main properties / parameters
properties = {
	showDPI: window.GetProperty("SYSTEM.Show DPI", false),
	enableTouchControl: window.GetProperty("SYSTEM.Enable Touch Scrolling", false),
	collapseGroupsByDefault: window.GetProperty("SYSTEM.Collapse Groups by default", false),
	enablePlaylistFilter: window.GetProperty("SYSTEM.Enable Playlist Filter", false),
	enableCustomColors: window.GetProperty("SYSTEM.Enable Custom Colors", false),
	defaultPlaylistItemAction: window.GetProperty("SYSTEM.Default Playlist Action", "Play"), //"Add to playback queue",
	autocollapse: window.GetProperty("SYSTEM.Auto-Collapse", false),
	showgroupheaders: window.GetProperty("*GROUP: Show Group Headers", true),
	showscrollbar: window.GetProperty("CUSTOM Show Scrollbar", true),
	showwallpaper: window.GetProperty("CUSTOM Show Wallpaper", false),
	wallpaperalpha: window.GetProperty("CUSTOM Wallpaper Alpha", 192),
	wallpaperblurred: window.GetProperty("CUSTOM Wallpaper Blurred", true),
	wallpaperblurvalue: window.GetProperty("CUSTOM Wallpaper Blur value", 1.05),
	wallpapermode: window.GetProperty("CUSTOM Wallpaper Type", 0),
	wallpaperpath: window.GetProperty("CUSTOM Default Wallpaper Path", fb.ProfilePath + "jsplitter\\rivage\\vendor\\jsplaylist-mod\\images\\default.jpg"),
	oddevenrowshighlight: window.GetProperty("CUSTOM Highlight Odd/Even Rows", true),
	smoothscrolling: window.GetProperty("CUSTOM Enable Smooth Scrolling", true),
	max_columns: 24,
	max_patterns: 25,
	focus_rect_alpha: window.GetProperty("CUSTOM Focus box ALPHA", 75),
	selection_rect_alpha: window.GetProperty("CUSTOM Selection solid box ALPHA", 60),

	// --- ported from Smooth Playlist ------------------------------------------------
	// 2.1 shared album accent (this panel is a consumer)
	albumAccentEnabled: window.GetProperty("CUSTOM.Album Accent Enabled", true),
	// Global multiplier on every accent alpha, in percent. jssp's own values were tuned for
	// its flat dark UI; JSPlaylist already paints row fills and a group-header background
	// underneath, so the same numbers came out nearly invisible. 100 = jssp values.
	accentStrength: window.GetProperty("CUSTOM.Accent Strength Percent", 200),
	// Show the accent diagnostic overlay (toggle with F7)
	accentDebug: window.GetProperty("CUSTOM.Accent Debug Overlay", false),
	// "material" = Google's Material You Score algorithm, "legacy" = the old saturation heuristic
	accentAlgorithm: window.GetProperty("CUSTOM.Accent Algorithm", "material"),
	// 2.2 UWP-style accent row highlight - the most visible accent surface, so it is on
	uwpAccentHighlight: window.GetProperty("CUSTOM.UWP Accent Row Highlight", true),
	// 2.3 row density preset: "compact" | "normal" | "spacious"
	rowDensity: window.GetProperty("CUSTOM.Row Density", "normal"),
	// 2.4 gap in px between line 1 and line 2 of a two-line row
	rowLineGap: window.GetProperty("CUSTOM.Row Line Gap", 2),
	// 2.7 group header geometry
	groupHeaderPadding: window.GetProperty("CUSTOM.Group Header Padding", 8),
	groupHeaderCoverPercent: window.GetProperty("CUSTOM.Group Header Cover Percent", 100),
	groupHeaderLineGap: window.GetProperty("CUSTOM.Group Header Line Gap", 0),
	// alpha (0-255) of the hairline drawn above the group-header footer row
	groupHeaderLineAlpha: window.GetProperty("CUSTOM.Group Header Line Alpha", 140),
	// 2.10 loved column - read-only sources, love/unlove via context commands (never tag writing)
	lovedSyncLastfm: window.GetProperty("CUSTOM.Loved Sync Last.fm", true),
	// 2.11 draw the loved hearts in a fixed pink instead of following the album accent
	lovedAlwaysPink: window.GetProperty("CUSTOM.Loved Always Pink", false),
	// incremental search, jssp semantics
	directSearchEnabled: window.GetProperty("CUSTOM.Direct Search Enabled", true),

	// --- jssp look ------------------------------------------------------------------
	// 2.5 font system: one family, independent sizes per element (all DPI-scaled)
	fontName: window.GetProperty("CUSTOM.Font Name", ""),
	fontRowSize: window.GetProperty("CUSTOM.Font Row Size", 11),
	fontHeaderTitleSize: window.GetProperty("CUSTOM.Font Header Title Size", 15),
	fontHeaderDetailSize: window.GetProperty("CUSTOM.Font Header Detail Size", 11),
	fontHeaderFooterSize: window.GetProperty("CUSTOM.Font Header Footer Size", 11),
	fontUiSize: window.GetProperty("CUSTOM.Font UI Size", 10),
	fontIconSize: window.GetProperty("CUSTOM.Font Icon Size", 15),
	fontStateIconSize: window.GetProperty("CUSTOM.Font State Icon Size", 16)
};

// One-time path migration: older JSPlaylist builds stored the stock samples path
// in the panel property store, so changing only the default above would not fix
// existing panels. Preserve custom user paths; migrate only the known old default.
var legacyWallpaperPath = String(properties.wallpaperpath || "").replace(/\//g, "\\").toLowerCase();
var vendoredWallpaperPath = fb.ProfilePath + "jsplitter\\rivage\\vendor\\jsplaylist-mod\\images\\default.jpg";
if (legacyWallpaperPath.indexOf("\\foo_uie_jsplitter\\samples\\jsplaylist-mod\\images\\default.jpg") !== -1) {
	properties.wallpaperpath = vendoredWallpaperPath;
	window.SetProperty("CUSTOM Default Wallpaper Path", vendoredWallpaperPath);
};

// =================================================================== // Config persistence check
// Settings live in foobar2000's per-panel property store (window.GetProperty /
// window.SetProperty). If those are not surviving a restart, the problem is the host not
// saving the panel config, not the script writing it. This counter proves which it is:
// it increments once per panel load and is written straight back.
//
//   run 1, 2, 3, 4 ...   -> config IS being saved; a lost setting is a script bug
//   always 1             -> config is NOT being saved; nothing the script does can help
//
// Common causes of the second case: foobar2000 not shut down cleanly (killed / crashed),
// a read-only or portable profile folder, or the panel living in a layout that was never
// applied. Check the console line below right after a restart.
var g_config_generation = window.GetProperty("CUSTOM.Config Generation", 0) + 1;
window.SetProperty("CUSTOM.Config Generation", g_config_generation);
console.log("JSPlaylist: panel load #" + g_config_generation +
	(g_config_generation <= 1
		? "  <-- if this still says 1 after a restart, foobar2000 is not saving this panel's settings"
		: "  (settings are persisting normally)"));

// =================================================================== // Row density presets (2.3)
// Each preset drives the base row height AND the inner cell padding together, so rows stay
// visually balanced instead of just getting taller.
// jssp's own values. Note these are the TOTAL row height including the second line -
// jssp does not add anything on top, which is why its rows are tighter than JSPlaylist's.
var row_density_presets = {
	spacious: { label: "Spacious", rowHeight: 46, cellPadding: 9 },
	normal:   { label: "Normal",   rowHeight: 38, cellPadding: 6 },
	compact:  { label: "Compact",  rowHeight: 32, cellPadding: 5 }
};

function normalise_row_density(value) {
	value = String(value || "normal").toLowerCase();
	return row_density_presets[value] ? value : "normal";
};

function get_row_density_preset() {
	properties.rowDensity = normalise_row_density(properties.rowDensity);
	return row_density_presets[properties.rowDensity];
};

function get_row_density_label() {
	return get_row_density_preset().label;
};

// jssp fades secondary text with setAlpha(colour, N) because it draws through DirectWrite.
// JSPlaylist draws text with gr.GdiDrawText, which is plain GDI and silently discards the
// alpha byte - which is why "& 0xafffffff" had no visible effect. The equivalent here is an
// opaque colour blended toward the background by (1 - N/255).
//   jssp alpha 218 -> 0.145      jssp alpha 175 -> 0.314      jssp alpha 170 -> 0.333
function fade_text(colour, jssp_alpha) {
	return blendColors(colour, g_color_normal_bg, 1 - clamp_int(jssp_alpha, 0, 255) / 255);
};

// =================================================================== // Loved provider detection (2.10)
// Preference order for READING loved state:
//   1. foo_enhanced_playcount  -> %lfm_loved% (already local, no network hit)
//   2. foo_playcount           -> %mood% fallback
// Writing is always done through component context commands, never by writing tags.
var foo_enhanced_playcount = utils.CheckComponent("foo_enhanced_playcount", true);
var foo_lastfm_playcount_sync = utils.CheckComponent("foo_lastfm_playcount_sync", true);

var loved_tf = null;
function get_loved_tf() {
	if (foo_enhanced_playcount) {
		// foo_enhanced_playcount exposes the Last.fm loved flag locally
		return fb.TitleFormat("$if2(%lfm_loved%,0)");
	} else if (foo_lastfm_playcount_sync) {
		return fb.TitleFormat("$if2(%lastfm_loved%,$if2(%lfm_loved%,0))");
	};
	// foo_playcount only: fall back to the local mood/feedback flag
	return fb.TitleFormat("$if2(%mood%,0)");
};
loved_tf = get_loved_tf();

// Is there anything that can actually toggle loved state?
function loved_can_write() {
	return foo_lastfm_playcount_sync || foo_playcount || foo_enhanced_playcount;
};

// Is the component backing the CURRENTLY SELECTED rating source (per the
// global PlaybackStatsSource setting - see jsplitter\rivage\shared\
// playback_stats_source.js) actually installed? Mirrors loved_can_write()'s
// shape for the rating stars in WSHplaylist.js's "up" mouse handler.
function ratingCanWrite() {
	return PlaybackStatsSource.isPlaycount2003() ? foo_playcount_2003 : foo_playcount;
};

// Writes one rating value (0 = clear) to whichever local backend the global
// PlaybackStatsSource setting currently selects. Playback Statistics and
// Playcount 2003 both only expose rating writes through their own context
// menu commands (confirmed by inspection for Playcount 2003: Playcount 2003 >
// Rating > Clear / Set Rating to 1..5) - neither has a scripting API for it,
// unlike e.g. handle.SetRating() for the unrelated JSplitter/SMP database.
function writeRatingCommand(metadb, value) {
	var command = PlaybackStatsSource.isPlaycount2003()
		? (value ? "Playcount 2003/Rating/Set Rating to " + value : "Playcount 2003/Rating/Clear")
		: "Playback Statistics/Rating/" + (value == 0 ? "<not set>" : value);
	fb.RunContextCommandWithMetadb(command, metadb, 8); // Regorxxx <- Fix for hidden context menu entries ->
};

// Toggle loved for a handle. Loves/unloves locally AND on Last.fm when the sync
// component is present. No file tags are ever written.
function toggle_loved(metadb, currently_loved) {
	if (!metadb)
		return;

	var action = currently_loved ? "Unlove" : "Love";

	// Last.fm side (also updates the local %lfm_loved% cache used for reading)
	if (properties.lovedSyncLastfm && foo_lastfm_playcount_sync) {
		try {
			fb.RunContextCommandWithMetadb("Last.fm Playcount Sync/" + action, metadb, 8);
		} catch (e) {};
	};

	// Local side via foo_playcount's rating store, so the heart survives without network
	if (foo_playcount) {
		try {
			fb.RunContextCommandWithMetadb("Playback Statistics/Rating/" + (currently_loved ? "<not set>" : "5"), metadb, 8);
		} catch (e) {};
	};
};

// =================================================================== // Incremental search state (jssp semantics)
var g_incremental_search = "";
var g_incremental_search_indexes = [];
var g_incremental_search_position = -1;
var g_incremental_search_no_result = false;
var g_incremental_search_timer = false;
// lower-cased haystack, one entry per playlist item, rebuilt whenever the list is rebuilt
var g_direct_search_values = [];
var tf_direct_search = fb.TitleFormat("$lower($if2(%artist%,) | $if2(%album artist%,) | $if2(%title%,) | $if2(%album%,))");

// =================================================================== // Singleton for Images
images = {
	path: fb.ProfilePath + "jsplitter\\rivage\\vendor\\jsplaylist-mod\\images\\",
	sortdirection: null,
	glass_reflect: null,
	nocover: null,
	noartist: null,
	stream: null,
	logo: null,
	beam: null,
	loading: null,
	loading_angle: 0
};

// =================================================================== // Fonts / Dpi / Colors / Images init
function system_init() {
	get_font();
	get_colors();
};
system_init();

// =================================================================== // Titleformat field
var tf_group_key = null;
// tf fields used in incremental search feature
var tf_artist = fb.TitleFormat("$if(%length%,%artist%,'Stream')");
var tf_albumartist = fb.TitleFormat("$if(%length%,%album artist%,'Stream')");
var tf_bitrate = fb.TitleFormat("$if(%__bitrate_dynamic%,$if(%el_isplaying%,%__bitrate_dynamic%'K',$if($stricmp($left(%codec_profile%,3),'VBR'),%codec_profile%,%__bitrate%'K')),$if($stricmp($left(%codec_profile%,3),'VBR'),%codec_profile%,%__bitrate%'K'))");
var tf_bitrate_playing = fb.TitleFormat("$if(%__bitrate_dynamic%,$if(%_isplaying%,$select($add($mod(%_time_elapsed_seconds%,2),1),%__bitrate_dynamic%,%__bitrate_dynamic%),%__bitrate_dynamic%),%__bitrate%)'K'");

// =================================================================== // Singletons
cRow = { // references of row height (zoom 100%)
	default_playlist_h: window.GetProperty("SYSTEM.Playlist Row Height in Pixel", 28),
	playlist_h: 29,
	extra_line_h: 6,
	cellPadding: 5,
	playlistManager_h: 28,
	headerBar_h: 26
};

// (2.3) The density preset is the source of truth for the base row height and cell padding.
// SYSTEM.Playlist Row Height in Pixel is kept in sync so nothing else in the script breaks.
function apply_row_density_metrics() {
	var density = get_row_density_preset();
	cRow.default_playlist_h = density.rowHeight;
	cRow.cellPadding = density.cellPadding;
	// NOTE: deliberately does NOT write SYSTEM.Playlist Row Height in Pixel here.
	// This runs on every panel load, so writing would silently overwrite whatever the
	// user had set. set_row_density() syncs it when the density actually changes.
};
apply_row_density_metrics();

p = {
	wallpaperImg: null,
	topbar: null,
	headerBar: null,
	list: null,
	playlistManager: null,
	timer_onKey: false
};

cTouch = {
	down: false,
	y_start: 0,
	y_end: 0,
	down_id: 0,
	up_id: 0
};

cPlaylistManager = {
	mediaLibraryPlaylist: window.GetProperty("SYSTEM.Media Library Playlist", false),
	enableHistoricPlaylist: window.GetProperty("CUSTOM Historic Playlist enabled", false),
	width: zoom(220, g_dpi),
	rowHeight: zoom(cRow.playlistManager_h, g_dpi),
	showStatusBar: true,
	statusBarHeight: zoom(18, g_dpi),
	step: zoom(50, g_dpi),
	visible: window.GetProperty("SYSTEM.PlaylistManager.Visible", false),
	visible_on_launch: false,
	drag_move_timer: false,
	hscroll_timer: false,
	visibility_target: null,
	vscroll_timer_loop: false,
	vscroll_timer: false,
	blink_timer: false,
	blink_counter: -1,
	blink_id: null,
	blink_totaltracks: 0,
	showTotalItems: window.GetProperty("SYSTEM.PlaylistManager.ShowTotalItems", true),
	playlist_switch_pending: false,
	drag_clicked: false,
	drag_moved: false,
	drag_target_id: -1,
	drag_source_id: -1,
	drag_x: -1,
	drag_y: -1,
	drag_droped: false,
	rightClickedId: null,
	init_timer: false,
	inputbox_timer: false,
	sortPlaylists_timer: false
};

cTopBar = {
	height: zoom(54, g_dpi),
	txtHeight: zoom(19, g_dpi),
	visible: window.GetProperty("SYSTEM.TopBar.Visible", true)
};

cHeaderBar = {
	height: zoom(cRow.headerBar_h, g_dpi),
	txtHeight: zoom(12, g_dpi),
	borderWidth: Math.ceil(cRow.headerBar_h * g_dpi / 100 / 14),
	locked: window.GetProperty("SYSTEM.HeaderBar.Locked", true),
	timerAutoHide: false,
	sortRequested: false
};

cScrollBar = {
	width: (g_dpi != g_dpi_percent ? zoom(get_system_scrollbar_width(), g_dpi) : get_system_scrollbar_width()),
	buttonType: {
		cursor: 0,
		up: 1,
		down: 2
	},
	timerID: false,
	parentObjectScrolling: null,
	timerID1: false,
	timerID2: false,
	timerCounter: 0,
	timer_repaint: false,
	themed: window.GetProperty("CUSTOM.Scrollbar Themed", false)
};

cTrack = {
	height: zoom(cRow.playlist_h, g_dpi),
	parity: ((zoom(cRow.playlist_h, g_dpi) / 2) == Math.floor(zoom(cRow.playlist_h, g_dpi) / 2) ? 0 : 1)
};

cGroup = {
	show: window.GetProperty("*GROUP: Show Group Headers", true),
	default_collapsed_height: 3,
	default_expanded_height: 3,
	collapsed_height: 3,
	expanded_height: 3,
	default_count_minimum: window.GetProperty("*GROUP: Minimum number of rows in a group", 0),
	count_minimum: window.GetProperty("*GROUP: Minimum number of rows in a group", 0),
	type: 0,
	pattern_idx: window.GetProperty("SYSTEM.Groups.Pattern Index", 0)
};

cover = {
	show: true,
	column: false,
	draw_glass_reflect: window.GetProperty("CUSTOM.Cover draw reflect", false),
	keepaspectratio: window.GetProperty("CUSTOM.Cover keep ration aspect", true),
	load_timer: false,
	repaint_timer: false,
	margin: 7,
	w: 0,
	max_w: cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height,
	h: 0,
	max_h: cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height,
	previous_max_size: -1,
	resized: false
};

cList = {
	search_string: "",
	incsearch_font: gdi_font("lucida console", zoom(9, g_dpi), 0),
	incsearch_font_big: gdi_font("lucida console", zoom(20, g_dpi), 1),
	inc_search_noresult: false,
	clear_incsearch_timer: false,
	incsearch_timer: false,
	repaint_timer: false,
	scrollstep: window.GetProperty("SYSTEM.Playlist Scroll Step", 3),
	touchstep: window.GetProperty("SYSTEM.Playlist Touch Step", 2),
	scroll_timer: false,
	scroll_delta: cTrack.height,
	scroll_direction: 1,
	scroll_step: Math.floor(cTrack.height / 3),
	scroll_div: 2,
	borderWidth: Math.ceil(cRow.headerBar_h * g_dpi / 100 / 14),
	beam_timer: false,
	enableExtraLine: window.GetProperty("SYSTEM.Enable Extra Line", true)
};

// Internal drag-to-reorder is removed. The object is kept so the many existing
// references stay valid, but `enabled` is hard false and drag_in can never become true.
// External drops from Windows Explorer / other panels are unaffected.
dragndrop = {
	enabled: false,
	contigus_sel: null,
	x: 0,
	y: 0,
	drag_id: -1,
	drop_id: -1,
	timerID: false,
	drag_in: false,
	drag_out: false,
	clicked: false,
	moved: false
};

columns = {
	rating: false,
	rating_x: 0,
	rating_w: 0,
	rating_drag: false,
	mood: false,
	mood_x: 0,
	mood_w: 0,
	mood_drag: false
};

//=================================================// Row density (2.3)
// Changing density keeps the visible scroll position: we convert the current pixel
// offset into a row offset, re-derive the metrics, then convert back.
function set_row_density(value) {
	var density = normalise_row_density(value);
	if (properties.rowDensity == density)
		return;

	// p.list.offset is a ROW offset, so it survives a row-height change directly.
	// We only have to re-clamp it against the new visible-row count.
	var row_offset = (p.list ? p.list.offset : 0);

	properties.rowDensity = density;
	window.SetProperty("CUSTOM.Row Density", density);
	apply_row_density_metrics();
	// keep the legacy row-height property in step, but only on a real change
	window.SetProperty("SYSTEM.Playlist Row Height in Pixel", cRow.default_playlist_h);

	// covers are sized from the row height, so the cache has to go
	cover.resized = true;
	g_image_cache = new image_cache;

	resize_panels();

	if (p.list) {
		var maxOffset = (p.list.totalRows > p.list.totalRowVisible ? p.list.totalRows - p.list.totalRowVisible : 0);
		p.list.offset = Math.max(0, Math.min(maxOffset, Math.round(row_offset)));
		p.list.setItems(false);
		p.scrollbar && p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
	};
	full_repaint();
};

//=================================================// Incremental search (jssp semantics)
// Substring match over a precomputed lower-cased haystack, a cycling match list,
// ESC to clear, BACKSPACE to delete, F3 for next match, 1600 ms idle reset.
function rebuild_direct_search_values() {
	g_direct_search_values = [];
	if (!p.list || !p.list.handleList || !p.list.count)
		return;
	try {
		var arr = tf_direct_search.EvalWithMetadbs(p.list.handleList);
		if (arr && typeof arr.toArray == "function")
			arr = arr.toArray();
		var fin = arr.length;
		for (var i = 0; i < fin; i++) {
			g_direct_search_values.push(String(arr[i]).toLowerCase());
		};
	} catch (e) {
		g_direct_search_values = [];
	};
};

function set_incremental_search_timeout() {
	g_incremental_search_timer && window.ClearTimeout(g_incremental_search_timer);
	g_incremental_search_timer = window.SetTimeout(function () {
			g_incremental_search = "";
			g_incremental_search_indexes = [];
			g_incremental_search_position = -1;
			g_incremental_search_no_result = false;
			g_incremental_search_timer = false;
			full_repaint();
		}, 1600);
};

function rebuild_incremental_matches() {
	g_incremental_search_indexes = [];
	g_incremental_search_position = -1;
	g_incremental_search_no_result = false;
	if (!g_incremental_search.length)
		return;

	if (!g_direct_search_values.length)
		rebuild_direct_search_values();

	var needle = g_incremental_search.toLowerCase();
	var fin = g_direct_search_values.length;
	for (var i = 0; i < fin; i++) {
		if (g_direct_search_values[i].indexOf(needle) != -1)
			g_incremental_search_indexes.push(i);
	};
	g_incremental_search_no_result = !g_incremental_search_indexes.length;
};

function focus_incremental_match(next) {
	if (!g_incremental_search_indexes.length || !p.list)
		return;

	var focus = p.list.focusedTrackId;
	var selected = -1;
	var i;

	if (next && g_incremental_search_position >= 0) {
		g_incremental_search_position = (g_incremental_search_position + 1) % g_incremental_search_indexes.length;
		selected = g_incremental_search_indexes[g_incremental_search_position];
	} else {
		for (i = 0; i < g_incremental_search_indexes.length; i++) {
			if (g_incremental_search_indexes[i] > focus) {
				selected = g_incremental_search_indexes[i];
				g_incremental_search_position = i;
				break;
			};
		};
		if (selected < 0) {
			g_incremental_search_position = 0;
			selected = g_incremental_search_indexes[0];
		};
	};

	p.list.focusedTrackId = selected;
	plman.ClearPlaylistSelection(p.list.playlist);
	plman.SetPlaylistSelectionSingle(p.list.playlist, selected, true);
	plman.SetPlaylistFocusItem(p.list.playlist, selected);
	p.list.showFocusedItem();
};

function incremental_char(code) {
	if (!properties.directSearchEnabled || code <= 31)
		return false;
	if (code == 32 && !g_incremental_search.length)
		return true; // never start a search with a space
	g_incremental_search += String.fromCharCode(code);
	rebuild_incremental_matches();
	focus_incremental_match(false);
	set_incremental_search_timeout();
	full_repaint();
	return true;
};

function incremental_key(vkey) {
	if (!properties.directSearchEnabled)
		return false;
	if (vkey == VK_ESCAPE && g_incremental_search.length) {
		g_incremental_search = "";
		rebuild_incremental_matches();
		g_incremental_search_timer && window.ClearTimeout(g_incremental_search_timer);
		g_incremental_search_timer = false;
		full_repaint();
		return true;
	};
	if (vkey == VK_BACK && g_incremental_search.length) {
		g_incremental_search = g_incremental_search.substr(0, g_incremental_search.length - 1);
		rebuild_incremental_matches();
		if (g_incremental_search.length)
			focus_incremental_match(false);
		set_incremental_search_timeout();
		full_repaint();
		return true;
	};
	if (vkey == VK_F3 && g_incremental_search.length && g_incremental_search_indexes.length) {
		focus_incremental_match(true);
		set_incremental_search_timeout();
		full_repaint();
		return true;
	};
	return false;
};

function clear_incremental_search() {
	g_incremental_search = "";
	g_incremental_search_indexes = [];
	g_incremental_search_position = -1;
	g_incremental_search_no_result = false;
	g_incremental_search_timer && window.ClearTimeout(g_incremental_search_timer);
	g_incremental_search_timer = false;
};

//=================================================// Column title-format helpers
// JSPlaylist adds three pseudo-fields on top of standard title formatting. Title format
// itself knows nothing about them, so they are substituted textually before evaluation:
//   %list_index%  1-based position of the row in the playlist
//   %list_total%  number of items in the playlist
//   %isplaying%   1 when this row is the playing track, empty otherwise
function prepare_column_tf(tf, track_index, is_playing_row) {
	if (!tf)
		return "";
	// cheap bail-out: nothing to do unless a '%' is present at all
	if (tf.indexOf("%") == -1)
		return tf;
	tf = tf.replace(/%list_index%/gi, String(track_index + 1));
	tf = tf.replace(/%list_total%/gi, String(p.list ? p.list.count : 0));
	tf = tf.replace(/%isplaying%/gi, is_playing_row ? "1" : "");
	return tf;
};

//=================================================// Album accent consumer (2.2)
// JSPlaylist does not extract artwork itself - the tabs panel is the sole producer (see
// jsplitter\rivage\tab-switcher-right.js + jsplitter\rivage\shared\album_accent_engine.js).
// update_album_accent() is kept as a no-op call site so on_playback_new_track() below reads
// the same as before; the actual colour arrives via on_notify_data()'s UPDATE case.
function update_album_accent(image, metadb) {
	// Intentionally empty: extraction happens in the tabs panel only.
};

// When nothing is playing the background still follows the focused playlist item,
// exactly like jssp. Cheap: an album cache key skips repeats within the same album, and
// the wallpaper rebuild is debounced so holding an arrow key doesn't thrash it.
var g_focus_bg_key = null;
var g_focus_bg_timer = false;

function update_accent_from_focus() {
	if (fb.IsPlaying || fb.IsPaused)
		return;
	if (!p.list || !p.list.handleList || !p.list.count)
		return;
	var id = p.list.focusedTrackId;
	if (id < 0 || id >= p.list.count)
		return;
	var handle = p.list.handleList[id];
	if (!handle)
		return;

	// The accent itself is not extracted here - the tabs panel (the sole producer) follows
	// this same focus (fb.GetFocusItem(true), kept in sync because WSHplaylist.js calls
	// plman.SetPlaylistFocusItem) and broadcasts the result; this panel just receives it.

	// background follows the cursor too
	if (!properties.showwallpaper)
		return;

	// Cache key must match what the wallpaper actually shows: artist art changes per
	// artist, album art per album. Using the album key for artist art reloaded the same
	// image on every track change within an artist.
	var key = null;
	try {
		key = (properties.wallpapermode == 4)
			 ? fb.TitleFormat("$if2(%album artist%,%artist%)").EvalWithMetadb(handle)
			 : AlbumAccent.key_for(handle);
	} catch (e) {};
	if (key !== null && key === g_focus_bg_key)
		return;
	g_focus_bg_key = key;

	g_focus_bg_timer && window.ClearTimeout(g_focus_bg_timer);
	g_focus_bg_timer = window.SetTimeout(function () {
			g_focus_bg_timer = false;
			// re-read the focus in case it moved again while the timer was pending
			if (fb.IsPlaying || fb.IsPaused || !p.list || !p.list.handleList || !p.list.count)
				return;
			var fid = p.list.focusedTrackId;
			if (fid < 0 || fid >= p.list.count)
				return;
			p.wallpaperImg = setWallpaperImg(properties.wallpaperpath, p.list.handleList[fid]);
			full_repaint();
		}, 220);
};

// Colour used by the UWP highlight and the hearts. Falls back to the UI highlight
// colour when the accent feature is switched off.
// Scale a base alpha by the user's accent strength, never past opaque.
function accent_alpha(alpha) {
	// Only the subtle washes are scaled. Bars, outlines and icons are already drawn at
	// their intended strength, and multiplying them just clamps everything to 255 and
	// makes the selection outline look like a hard border.
	if (alpha >= 150)
		return clamp_int(alpha, 0, 255);
	return clamp_int(Math.round(alpha * clamp_int(properties.accentStrength, 0, 400) / 100), 0, 255);
};

function accent_colour(alpha) {
	if (!properties.albumAccentEnabled)
		return g_color_highlight & RGBA(255, 255, 255, alpha);
	return AlbumAccent.withAlpha(accent_alpha(alpha));
};

// Colour for the loved hearts. Normally the shared album accent like everything
// else, but "Always pink" pins them to a fixed pink so a loved track reads as loved
// at a glance instead of blending into whatever the current cover happens to be.
//
// The pink is used raw, NOT through accent_alpha(): that function scales the low
// alphas by properties.accentStrength, which exists so subtle accent washes track
// the accent setting. These hearts are foreground glyphs at three deliberate
// strengths (on / hover / off), so scaling them would make "off" hearts vanish at
// low accent strength.
var LOVED_PINK = RGB(255, 120, 170);

function loved_colour(alpha) {
	if (!properties.lovedAlwaysPink)
		return accent_colour(alpha);
	return LOVED_PINK & RGBA(255, 255, 255, clamp_int(alpha, 0, 255));
};

// Accent for the playlist manager. Same as accent_colour() but falls back to the
// selection background rather than the highlight colour, which reads better on a panel.
function pm_accent(alpha) {
	if (!properties.albumAccentEnabled)
		return g_color_selected_bg & RGBA(255, 255, 255, alpha);
	return AlbumAccent.withAlpha(accent_alpha(alpha));
};

//=================================================// UWP-style row highlight (2.2)
// Flat accent wash plus a leading accent bar, instead of the classic boxed selection.
// Playing rows get a stronger wash; the focused row gets a thin accent outline.
function draw_uwp_row_highlight(gr, x, y, w, h, selected, focused, playing) {
	var bar_w;

	if (playing) {
		gr.FillSolidRect(x, y, w, h, accent_colour(selected ? 70 : 45));
		bar_w = Math.max(2, zoom(4, g_dpi));
		gr.FillSolidRect(x, y, bar_w, h, accent_colour(255));
	} else if (selected) {
		gr.FillSolidRect(x, y, w, h, accent_colour(52));
		bar_w = Math.max(2, zoom(3, g_dpi));
		gr.FillSolidRect(x, y, bar_w, h, accent_colour(220));
	};

	if (focused) {
		gr.DrawRect(x + 1, y + 1, w - 3, h - 3, 1.0, accent_colour(190));
	};
};

//=================================================// Smoother scrolling in playlist
function set_scroll_delta() {
	var maxOffset = (p.list.totalRows > p.list.totalRowVisible ? p.list.totalRows - p.list.totalRowVisible : 0);
	if (p.list.offset > 0 && p.list.offset < maxOffset) {
		if (!cList.scroll_timer) {
			cList.scroll_delta = cTrack.height;
			if (!(cList.scroll_direction > 0 && p.list.offset == 0) && !(cList.scroll_direction < 0 && p.list.offset >= p.list.totalRows - p.list.totalRowVisible)) {
				cList.scroll_timer = window.SetInterval(function () {
						cList.scroll_step = Math.round(cList.scroll_delta / cList.scroll_div);
						cList.scroll_delta -= cList.scroll_step;
						if (cList.scroll_delta <= 1) {
							window.ClearTimeout(cList.scroll_timer);
							cList.scroll_timer = false;
							cList.scroll_delta = 0;
						};
						full_repaint();
					}, 30);
			};
		} else {
			cList.scroll_delta = cTrack.height;
		};
	};
};

//=================================================// Extra functions for playlist manager panel
function renamePlaylist() {
	if (!p.playlistManager.inputbox.text || p.playlistManager.inputbox.text == "" || p.playlistManager.inputboxID == -1)
		p.playlistManager.inputbox.text = p.playlistManager.playlists[p.playlistManager.inputboxID].name;
	if (p.playlistManager.inputbox.text.length > 1 || (p.playlistManager.inputbox.text.length == 1 && (p.playlistManager.inputbox.text >= "a" && p.playlistManager.inputbox.text <= "z") || (p.playlistManager.inputbox.text >= "A" && p.playlistManager.inputbox.text <= "Z") || (p.playlistManager.inputbox.text >= "0" && p.playlistManager.inputbox.text <= "9"))) {
		p.playlistManager.playlists[p.playlistManager.inputboxID].name = p.playlistManager.inputbox.text;
		plman.RenamePlaylist(p.playlistManager.playlists[p.playlistManager.inputboxID].idx, p.playlistManager.inputbox.text);
		full_repaint();
	};
	p.playlistManager.inputboxID = -1;
};

function inputboxPlaylistManager_activate() {
	window.ClearTimeout(cPlaylistManager.inputbox_timer);
	cPlaylistManager.inputbox_timer = false;
	//
	p.playlistManager.inputbox.on_focus(true);
	p.playlistManager.inputbox.edit = true;
	p.playlistManager.inputbox.Cpos = p.playlistManager.inputbox.text.length;
	p.playlistManager.inputbox.anchor = p.playlistManager.inputbox.Cpos;
	p.playlistManager.inputbox.SelBegin = p.playlistManager.inputbox.Cpos;
	p.playlistManager.inputbox.SelEnd = p.playlistManager.inputbox.Cpos;
	if (!cInputbox.timer_cursor) {
		p.playlistManager.inputbox.resetCursorTimer();
	};
	p.playlistManager.inputbox.dblclk = true;
	p.playlistManager.inputbox.SelBegin = 0;
	p.playlistManager.inputbox.SelEnd = p.playlistManager.inputbox.text.length;
	p.playlistManager.inputbox.text_selected = p.playlistManager.inputbox.text;
	p.playlistManager.inputbox.select = true;
	full_repaint();
};

function addToHistoricPlaylist(handle) {

	if (handle == null)
		return;
	try {
		var playingPlaylist = Number(plman.PlayingPlaylist);
		if (playingPlaylist >= 0 && playingPlaylist < plman.PlaylistCount && plman.GetPlaylistName(playingPlaylist) == "Historic")
			return;
	} catch (e) {};

	g_avoid_on_playlists_changed = true;
	var historicIndex = plman.FindOrCreatePlaylist("Historic", true);
	var handles = new FbMetadbHandleList(handle);
	plman.InsertPlaylistItems(historicIndex, plman.PlaylistItemCount(historicIndex), handles, false);
	g_avoid_on_playlists_changed = false;

	if (cPlaylistManager.visible)
		full_repaint();
};

function checkMediaLibrayPlaylist() {
	g_avoid_on_playlists_changed = true;
	var idx = plman.FindPlaylist("Media Library");
	if (idx == -1) {
		plman.CreateAutoPlaylist(0, "Media Library", "ALL", "%album artist% | $if(%album%,%date%,'9999') | %album% | %discnumber% | %tracknumber% | %title%", 0);
	} else if (idx > 0) {
		plman.MovePlaylist(idx, 0);
	};

	g_avoid_on_playlists_changed = false;
};

function togglePlaylistManager() {
	if (!cPlaylistManager.hscroll_timer) {
		if (cPlaylistManager.visible) {
			cPlaylistManager.hscroll_timer = window.SetInterval(function () {
					p.playlistManager.repaint();
					p.playlistManager.woffset -= cPlaylistManager.step;
					if (p.playlistManager.woffset <= 0) {
						p.playlistManager.woffset = 0;
						cPlaylistManager.hscroll_timer && window.ClearTimeout(cPlaylistManager.hscroll_timer);
						cPlaylistManager.hscroll_timer = false;
						cPlaylistManager.visible = false;
						window.SetProperty("SYSTEM.PlaylistManager.Visible", cPlaylistManager.visible);
						p.headerBar.button.update(p.headerBar.slide_open_normal, p.headerBar.slide_open_hover, p.headerBar.slide_open_down);
						full_repaint();
						applyPlaylistManagerVisibilityTarget();
					};
				}, 16);
		} else {
			p.playlistManager.refresh("", false, false);
			cPlaylistManager.hscroll_timer = window.SetInterval(function () {
					p.playlistManager.woffset += cPlaylistManager.step;
					if (p.playlistManager.woffset >= cPlaylistManager.width) {
						p.playlistManager.woffset = cPlaylistManager.width;
						cPlaylistManager.hscroll_timer && window.ClearTimeout(cPlaylistManager.hscroll_timer);
						cPlaylistManager.hscroll_timer = false;
						cPlaylistManager.visible = true;
						window.SetProperty("SYSTEM.PlaylistManager.Visible", cPlaylistManager.visible);
						p.headerBar.button.update(p.headerBar.slide_close_normal, p.headerBar.slide_close_hover, p.headerBar.slide_close_down);
						full_repaint();
						applyPlaylistManagerVisibilityTarget();
					} else {
						p.playlistManager.repaint();
					};
				}, 16);
		};
	};
};

function applyPlaylistManagerVisibilityTarget() {
	if (cPlaylistManager.hscroll_timer) return;
	var target = cPlaylistManager.visibility_target;
	cPlaylistManager.visibility_target = null;
	if (typeof target == "boolean" && target !== cPlaylistManager.visible) togglePlaylistManager();
};

function setPlaylistManagerVisible(visible) {
	cPlaylistManager.visibility_target = !!visible;
	applyPlaylistManagerVisibilityTarget();
};

function adjustMetrics(origin) {
	cTopBar.height = zoom(54, g_dpi);
	cTopBar.txtHeight = zoom(19, g_dpi);
	cHeaderBar.height = zoom(cRow.headerBar_h, g_dpi);
	cHeaderBar.txtHeight = zoom(12, g_dpi);
	cHeaderBar.borderWidth = Math.ceil(cRow.headerBar_h * g_dpi / 100 / 14);
	var fin = p.headerBar.columns.length;
	for (var i = 0; i < fin; i++) {
		p.headerBar.columns[i].minWidth = zoom(32, g_dpi);
	};
	if (p.headerBar.columns[0].percent > 0)
		cover.resized = true;
	cScrollBar.width = (g_dpi != g_dpi_percent ? Math.ceil(get_system_scrollbar_width() * g_dpi / 100) : get_system_scrollbar_width());
	cTrack.height = zoom(cRow.playlist_h, g_dpi);
	cPlaylistManager.width = zoom(220, g_dpi);
	cPlaylistManager.rowHeight = zoom(cRow.playlistManager_h, g_dpi);
	cPlaylistManager.statusBarHeight = zoom(16, g_dpi);
	cPlaylistManager.step = zoom(50, g_dpi);
	get_font();
	p.playlistManager.setButtons();
	p.playlistManager.refresh("", false, false, false);
	cList.incsearch_font = gdi_font("lucida console", zoom(9, g_dpi), 0);
	cList.incsearch_font_big = gdi_font("lucida console", zoom(20, g_dpi), 1);
	cList.borderWidth = Math.ceil(cRow.headerBar_h * g_dpi / 100 / 14);

	//
	g_z2 = zoom(2, g_dpi);
	g_z3 = zoom(3, g_dpi);
	g_z4 = zoom(4, g_dpi);
	g_z5 = zoom(5, g_dpi);
	g_z6 = zoom(6, g_dpi);
	g_z8 = zoom(8, g_dpi);
	g_z10 = zoom(10, g_dpi);
	g_z16 = zoom(16, g_dpi);
	//

	if (origin == 1) {
		// reset cover cache on zoom/resize
		cover.max_w = (cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height);
		g_image_cache = new image_cache;
	};
};

//=================================================// Images cache
function on_get_album_art_done(metadb, art_id, image, image_path) {
	var cover_metadb = null;
	var fin = p.list.items.length;
	for (var i = 0; i < fin; i++) {
		if (p.list.items[i].metadb) {
			if (cover.column) {
				cover_metadb = p.list.handleList[p.list.groups[p.list.items[i].group_index].start];
			} else {
				cover_metadb = p.list.items[i].metadb;
			};
			if (cover_metadb.Compare(metadb)) {
				p.list.items[i].cover_img = g_image_cache.getit(metadb, image);
				if (!g_mouse_wheel_timer && !cScrollBar.timerID2 && !cList.repaint_timer) {
					if (!cover.repaint_timer) {
						cover.repaint_timer = window.SetTimeout(function () {
							if (!g_mouse_wheel_timer && !cScrollBar.timerID2 && !cList.repaint_timer)
								full_repaint();
							cover.repaint_timer && window.ClearTimeout(cover.repaint_timer);
							cover.repaint_timer = false;
						}, 75);
					};
				};
				break;
			};
		};
	};
};

image_cache = function () {
	this._cachelist = {};
	this.hit = function (metadb) {
		var d = (properties.showgroupheaders ? metadb.Path : fb.TitleFormat("$replace(%path%,%filename_ext%,)").EvalWithMetadb(metadb));
		var img = this._cachelist[d];
		if (typeof img == "undefined") { // if image not in cache, we load it asynchronously
			if (!cover.load_timer) {
				cover.load_timer = window.SetTimeout(function () {
						utils.GetAlbumArtAsync(window.ID, metadb, AlbumArtId.front);
						cover.load_timer && window.ClearTimeout(cover.load_timer);
						cover.load_timer = false;
					}, (g_mouse_wheel_timer || cScrollBar.timerID2 ? 20 : 10));
			};
		};
		return img;
	};
	this.getit = function (metadb, image) {
 		var cw = cover.column ? ((p.headerBar.columns[0].w <= cover.max_w) ? cover.max_w : p.headerBar.columns[0].w) : cover.max_w;
		var ch = cw;
		var img;
		if (image) {
			if (image.Height >= image.Width) {
				var ratio = image.Width / image.Height;
				var pw = (cw + cover.margin * 2) * ratio;
				var ph = ch + cover.margin * 2;
			} else {
				var ratio = image.Height / image.Width;
				var pw = cw + cover.margin * 2;
				var ph = (ch + cover.margin * 2) * ratio;
			}
		} else {
			var pw = cw + cover.margin * 2;
			var ph = ch + cover.margin * 2;
		};
		if (metadb) {
			img = FormatCover(image, pw, ph, cover.draw_glass_reflect, false);
			if (!img) {
				img = null;
				cover.type = 0;
			} else {
				cover.type = 1;
			}
		}
		var d = (properties.showgroupheaders ? metadb.Path : fb.TitleFormat("$replace(%path%,%filename_ext%,)").EvalWithMetadb(metadb));
		this._cachelist[d] = img;
		return img;
	}
}
var g_image_cache = new image_cache;

//=================================================// Cover tools
function FormatCover(image, w, h, reflect, rawBitmap) {
	if (!image || w <= 0 || h <= 0)
		return image;
	if (reflect) {
		var new_img = image.Resize(w, h, 2);
		var gb = new_img.GetGraphics();
		if (h > w) {
			gb.DrawImage(images.glass_reflect, Math.floor((h - w) / 2) * -1 + 1, 1, h - 2, h - 2, 0, 0, images.glass_reflect.Width, images.glass_reflect.Height, 0, 150);
		} else {
			gb.DrawImage(images.glass_reflect, 1, Math.floor((w - h) / 2) * -1 + 1, w - 2, w - 2, 0, 0, images.glass_reflect.Width, images.glass_reflect.Height, 0, 150);
		};
		new_img.ReleaseGraphics(gb);
		if (rawBitmap) {
			return new_img.CreateRawBitmap();
		} else {
			return new_img;
		};
	} else {
		if (rawBitmap) {
			return image.Resize(w, h, 2).CreateRawBitmap();
		} else {
			return image.Resize(w, h, 2);
		};
	};

};

function reset_cover_timers() {
	cover.load_timer && window.ClearTimeout(cover.load_timer);
	cover.load_timer = false;
};

//=================================================// WSH Statistics update function
function update_statistics() {
	if (opt_stats && !foo_playcount && cStats.waiting_for_writing && cStats.handle) {
		var d;
		var timestamp;
		var s1,
		s2,
		s3,
		hh,
		min,
		sec;
		var new_playcounter;
		var p_count,
		p_counter;

		p_count = play_count.EvalWithMetadb(cStats.handle);
		p_counter = play_counter.EvalWithMetadb(cStats.handle);

		d = new Date();
		s1 = d.getFullYear();
		s2 = (d.getMonth() + 1);
		s3 = d.getDate();
		hh = d.getHours();
		min = d.getMinutes();
		sec = d.getSeconds();
		if (s3.length == 1)
			s3 = "0" + s3;
		timestamp = s1 + ((s2 < 10) ? "-0" : "-") + s2 + ((s3 < 10) ? "-0" : "-") + s3 + ((hh < 10) ? " 0" : " ") + hh + ((min < 10) ? ":0" : ":") + min + ((sec < 10) ? ":0" : ":") + sec;

		if (p_count >= 0 && p_counter == "?") {
			new_playcounter = Math.floor(p_count) + 1;
		} else if (p_counter == "?") {
			new_playcounter = 1;
		} else {
			new_playcounter = Math.floor(p_counter) + 1;
		};

		var firstplayed_ts = first_played.EvalWithMetadb(cStats.handle);

		var handles = new FbMetadbHandleList(cStats.handle);

		var obj = {
			"LAST_PLAYED" : timestamp,
			"PLAYCOUNTER" : new_playcounter,
			"PLAY_COUNT" : ""
		};

		if (firstplayed_ts == "?") {
			obj["FIRST_PLAYED"] = timestamp;
		}
		handles.UpdateFileInfoFromJSON(JSON.stringify(obj));
		cStats.waiting_for_writing = false;
		// report to console
		console.log("--- WSH Statistics ---");
		console.log("--- Track updated: \"" + cStats.handle.Path + "\"");
	};
};

// ================================================================================================== //

function full_repaint() {
	need_repaint = true;
	if (g_timer1)
		return;
	g_timer1 = window.SetTimeout(function () {
		g_timer1 = false;
		if (SKIP_WORK_WHEN_HIDDEN && !window.IsVisible)
			return;
		if (!need_repaint)
			return;
		need_repaint = false;
		images.loading_angle = (images.loading_angle < 360 ? images.loading_angle + 36 : 36);
		window.Repaint();
	}, 40);
};

function resize_panels() {

	// list row height. The density preset is the TOTAL row height (jssp semantics), so
	// nothing is added for the second line; single-line mode just gets a shorter row.
	if (cList.enableExtraLine) {
		cRow.playlist_h = cRow.default_playlist_h;
	} else {
		cRow.playlist_h = Math.max(18, cRow.default_playlist_h - cRow.extra_line_h);
	};
	cTrack.height = zoom(cRow.playlist_h, g_dpi);
	cTrack.parity = ((zoom(cRow.playlist_h, g_dpi) / 2) == Math.floor(zoom(cRow.playlist_h, g_dpi) / 2) ? 0 : 1);

	// topbar default height ?
	if (cTopBar.visible) {
		var topbar_h = cTopBar.height + cHeaderBar.borderWidth;
	} else {
		var topbar_h = 0;
	};

	if (cHeaderBar.locked) {
		var headerbar_h = cHeaderBar.height;
		p.headerBar.visible = true;
	} else {
		var headerbar_h = (topbar_h == 0) ? 0 : 1;
		p.headerBar.visible = false;
	};

	// playlist_manager default width/height ?
	var playlistManager_h = wh - topbar_h;
	cPlaylistManager.visible_on_launch = cPlaylistManager.visible;
	if (cPlaylistManager.visible) {
		if (g_init_on_size) {
			cPlaylistManager.visible = true;
			p.playlistManager.woffset = 0;
			/*
			if(cPlaylistManager.visible_on_launch) {
			if(!cPlaylistManager.init_timer) {
			cPlaylistManager.init_timer = window.SetTimeout(function() {
			togglePlaylistManager();
			window.ClearTimeout(cPlaylistManager.init_timer);
			cPlaylistManager.init_timer = false;
			}, 150);
			};
			};
			*/
		} else {
			cPlaylistManager.visible = false;
			p.playlistManager.woffset = cPlaylistManager.width;
		};
	};

	// list default height ?
	var list_h = wh - topbar_h - headerbar_h - (p.headerBar.visible ? cHeaderBar.borderWidth : 0);

	var content_w = ww;
	var content_h = Math.max(zoom(60, g_dpi), wh);

	// set Size of Topbar
	p.topBar.setSize(0, 0, content_w, topbar_h);

	// set Size of Header Bar
	p.headerBar && p.headerBar.setSize(0, topbar_h, content_w, cHeaderBar.height);
	p.headerBar.calculateColumns();

	// set Size of List
	list_h = Math.max(cTrack.height, content_h - topbar_h - headerbar_h - (p.headerBar.visible ? cHeaderBar.borderWidth : 0));
	p.list.setSize(0, (content_h - list_h), content_w, list_h);
	if (g_init_on_size) {
		p.list.setItems(true);
	};

	// set Size of scrollbar
	p.scrollbar.setSize(p.list.x + p.list.w - cScrollBar.width, p.list.y, cScrollBar.width, p.list.h);
	p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);

	// set Size of PlaylistManager
	p.playlistManager.setSize(content_w, p.list.y, cPlaylistManager.width, p.list.h);
	if (cPlaylistManager.visible) {
		p.playlistManager.refresh("", false, false);
	} else {
		p.playlistManager.refresh("", true, true);
	};
};

//=================================================// Init
function on_init() {
	plman.SetActivePlaylistContext();
	// check properties
	if (!properties.showgroupheaders) {
		cGroup.collapsed_height = 0;
		cGroup.expanded_height = 0;
	};

	p.list = new oList("p.list", plman.ActivePlaylist);
	p.topBar = new oTopBar();
	p.headerBar = new oHeaderBar();
	p.headerBar.initColumns();
	p.scrollbar = new oScrollbar(cScrollBar.themed);

	if (cPlaylistManager.mediaLibraryPlaylist)
		checkMediaLibrayPlaylist();

 	p.playlistManager = new oPlaylistManager("p.playlistManager");
	// This panel is an accent CONSUMER: the tabs panel does the extraction. Ask it for
	// whatever it already has, so a colour arrives even if that panel loaded first (it also
	// broadcasts unprompted on its own load, so this is just belt-and-braces).
	AlbumAccent.enabled = properties.albumAccentEnabled;
	if (properties.albumAccentEnabled) {
		window.SetTimeout(function () {
			SharedAccentProtocol.requestAccent();
			// with playback stopped, show the focused track's artwork straight away
			var seed = (fb.IsPlaying || fb.IsPaused) ? fb.GetNowPlaying() :
				((p.list && p.list.handleList && p.list.count > 0) ? p.list.handleList[Math.max(0, p.list.focusedTrackId)] : null);
			if (properties.showwallpaper && !fb.IsPlaying && !fb.IsPaused && seed) {
				g_focus_bg_key = null;
				p.wallpaperImg = setWallpaperImg(properties.wallpaperpath, seed);
			};
			full_repaint();
		}, 150);
	};

	// Incremental-search text is built lazily on the first actual search. Large
	// playlists therefore pay no title-format scan cost at startup.
	g_direct_search_values = [];

};
on_init();

// Adopt whatever another panel already has configured this session, instead
// of sitting on this instance's own possibly-stale persisted value. No
// onChange() hook is needed: the rating stars only read this at write time
// (writeRatingCommand/ratingCanWrite in this file), and the rating/playcount
// COLUMNS stay purely title-format driven, per column configuration, same as
// before.
PlaybackStatsSource.requestSync();

//=================================================// OnSize
function on_size() {
	if (!window.Width || !window.Height)
		return;
	window.DlgCode = DLGC_WANTALLKEYS;

	if (g_instancetype == 0) { // CUI
		window.MinWidth = 360;
		window.MinHeight = 200;
	} else if (g_instancetype == 1) { // DUI
		window.MinWidth = zoom(360, g_dpi);
		window.MinHeight = zoom(200, g_dpi);
	};

	ww = window.Width;
	wh = window.Height;

	resize_panels();

	// set wallpaper
	if (fb.IsPlaying) {
		p.wallpaperImg = setWallpaperImg(properties.wallpaperpath, fb.GetNowPlaying());
	} else {
		p.wallpaperImg = null;
	};

	// Set the empty rows count in playlist setup for cover column size!
	if (p.headerBar.columns[0].percent > 0) {
		//cover.resized = true;
		cover.column = true;
		cGroup.count_minimum = Math.ceil((p.headerBar.columns[0].w) / cTrack.height);
		if (cGroup.count_minimum < cGroup.default_count_minimum)
			cGroup.count_minimum = cGroup.default_count_minimum;
	} else {
		cover.column = false;
		cGroup.count_minimum = cGroup.default_count_minimum;
	};
	cover.previous_max_size = p.headerBar.columns[0].w;

	if (!g_init_on_size) {
		properties.collapseGroupsByDefault = (p.list.groupby[cGroup.pattern_idx].collapseGroupsByDefault == 0 ? false : true);
		update_playlist(properties.collapseGroupsByDefault);
		if (cPlaylistManager.visible_on_launch) {
			if (!cPlaylistManager.init_timer) {
				cPlaylistManager.init_timer = window.SetTimeout(function () {
						togglePlaylistManager();
						window.ClearTimeout(cPlaylistManager.init_timer);
						cPlaylistManager.init_timer = false;
					}, 150);
			};
		};
		g_init_on_size = true;
	};
};

//=================================================// OnPaint
function on_paint(gr) {

	// Any actual host paint satisfies a queued full_repaint request. This avoids
	// a redundant timer-triggered paint when foobar repaints us for another reason.
	need_repaint = false;

	if (!ww)
		return true;


	// Wallpaper remains focus-driven when playback is stopped.
	if (p.wallpaperImg && properties.showwallpaper) {
		gr.GdiDrawBitmap(p.wallpaperImg, 0, p.list.y, ww, wh - p.list.y, 0, p.list.y, p.wallpaperImg.Width, p.wallpaperImg.Height - p.list.y);
		gr.FillSolidRect(0, p.list.y, ww, wh - p.list.y, g_color_normal_bg & RGBA(255, 255, 255, properties.wallpaperalpha));
	} else {
		gr.FillSolidRect(0, p.list.y, ww, wh - p.list.y, g_color_normal_bg);
	};

	// List
	if (p.list) {
		if (p.list.count > 0) {
			// calculate columns metrics before drawing row contents!
			p.headerBar.calculateColumns();

			// scrollbar
			if (properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
				p.scrollbar.visible = true;
				p.scrollbar.draw(gr);
			} else {
				p.scrollbar.visible = false;
			};

			// draw rows of the playlist
			p.list && p.list.draw(gr);

			// draw flashing beam if scroll max reached on mouse wheel! (android like effect)
			if (p.list.beam > 0) {
				var r = getRed(g_color_highlight);
				var g = getGreen(g_color_highlight);
				var b = getBlue(g_color_highlight);
				var a = Math.floor((p.list.beam_alpha <= 250 ? p.list.beam_alpha : 250) / 12);
				var beam_h = Math.floor(cTrack.height * 7 / 4);
				var alpha = (p.list.beam_alpha <= 255 ? p.list.beam_alpha : 255);
				switch (p.list.beam) {
				case 1: // top beam
					gr.DrawImage(images.beam, p.list.x, p.list.y - cHeaderBar.borderWidth * 10, p.list.w, beam_h - cHeaderBar.borderWidth, 0, 0, images.beam.Width, images.beam.Height, 180, alpha);
					break;
				case 2: // bot beam
					gr.DrawImage(images.beam, p.list.x, p.list.y + p.list.h - beam_h + cHeaderBar.borderWidth * 10, p.list.w, beam_h, 0, 0, images.beam.Width, images.beam.Height, 0, alpha);
					break;
				};
			};

		} else {

			if (plman.PlaylistCount > 0) {
				var text_top = plman.GetPlaylistName(plman.ActivePlaylist);
				var text_bot = "Empty playlist";
			} else {
				var text_top = "JSPlaylist " + g_script_version + " coded by Br3tt - 2015";
				var text_bot = "Create a playlist to start!";
			};
			// if Search Playlist, draw image "No Result"
			if (text_top.substr(0, 8) == "Search [") {
				gr.SetTextRenderingHint(3);
				var search_text = text_top.substr(8, text_top.length - 9);
				gr.DrawString("No results for \"" + search_text + "\".", gdi_font(g_fname, g_fsize + 7, 0), g_color_normal_txt & 0x40ffffff, 0, 0 - zoom(20, g_dpi), ww, wh, cc_stringformat);
				gr.DrawString(text_bot, gdi_font(g_fname, g_fsize + 2, 0), g_color_normal_txt & 0x40ffffff, 0, 0 + zoom(20, g_dpi), ww, wh, cc_stringformat);
				gr.FillSolidRect(40, Math.floor(wh / 2), ww - 80, Math.floor(zoom(1, g_dpi)), g_color_normal_txt & 0x28ffffff);
			} else {
				// if empty playlist, display text info
				gr.SetTextRenderingHint(3);
				gr.DrawString(text_top, gdi_font(g_fname, g_fsize + 7, 0), g_color_normal_txt & 0x40ffffff, 0, 0 - zoom(20, g_dpi), ww, wh, cc_stringformat);
				gr.DrawString(text_bot, gdi_font(g_fname, g_fsize + 2, 0), g_color_normal_txt & 0x40ffffff, 0, 0 + zoom(20, g_dpi), ww, wh, cc_stringformat);
				gr.FillSolidRect(40, Math.floor(wh / 2), ww - 80, Math.floor(zoom(1, g_dpi)), g_color_normal_txt & 0x28ffffff);
			};
		};
	};

	// Wallpaper remains focus-driven when playback is stopped, so this is not gated on fb.IsPlaying.
	if (cTopBar.visible || p.headerBar.visible) {
		if (p.wallpaperImg && properties.showwallpaper) {
			gr.GdiDrawBitmap(p.wallpaperImg, 0, 0, ww, p.list.y, 0, 0, p.wallpaperImg.Width, p.list.y);
			gr.FillSolidRect(0, 0, ww, p.list.y, g_color_normal_bg & RGBA(255, 255, 255, properties.wallpaperalpha));
		} else {
			gr.FillSolidRect(0, 0, ww, p.list.y, g_color_normal_bg);
		};
	};

	// TopBar
	if (cTopBar.visible) {
		p.topBar && p.topBar.draw(gr);
	}

	// HeaderBar
	if (p.headerBar.visible) {
		p.headerBar && p.headerBar.drawColumns(gr);
		if (p.headerBar.borderDragged && p.headerBar.borderDraggedId >= 0) {
			// all borders
			var fin = p.headerBar.borders.length;
			for (var b = 0; b < fin; b++) {
				var lg_x = p.headerBar.borders[b].x - 2;
				var lg_w = p.headerBar.borders[b].w;
				var segment_h = zoom(5, g_dpi);
				var gap_h = zoom(5, g_dpi);
				if (b == p.headerBar.borderDraggedId) {
					var d = ((mouse_x / zoom(10, g_dpi)) - Math.floor(mouse_x / zoom(10, g_dpi))) * zoom(10, g_dpi); // give a value between [0;9]
				} else {
					d = 5;
				};
				var ty = 0;
				for (var lg_y = p.list.y; lg_y < p.list.y + p.list.h + segment_h; lg_y += segment_h + gap_h) {
					ty = lg_y - segment_h + d;
					th = segment_h;
					if (ty < p.list.y) {
						th = th - Math.abs(p.list.y - ty);
						ty = p.list.y;
					}
					if (b == p.headerBar.borderDraggedId) {
						gr.FillSolidRect(lg_x, ty, lg_w, th, g_color_normal_txt & 0x32ffffff);
					} else {
						gr.FillSolidRect(lg_x, ty, lg_w, th, g_color_normal_txt & 0x16ffffff);
					};
				};
			};
		};
	} else {
		p.headerBar && p.headerBar.drawHiddenPanel(gr);
	};

	// PlaylistManager
	p.playlistManager && p.playlistManager.draw(gr);

	// Incremental Search Display (jssp style: floating bar at the top with an accent stripe)
	if (g_incremental_search.length > 0) {
		gr.SetSmoothingMode(2);
		var is_font = gdi_font(g_fname, g_fsize + 2, 1);
		var is_text = g_incremental_search_no_result
			 ? "No results for \"" + g_incremental_search + "\"."
			 : g_incremental_search + (g_incremental_search_indexes.length > 1
				 ? "   (" + (g_incremental_search_position + 1) + " / " + g_incremental_search_indexes.length + ")"
				 : "");
		var is_h = zoom(38, g_dpi);
		var is_pad = zoom(14, g_dpi);
		var is_stripe = zoom(4, g_dpi);
		var is_tw = 0;
		try {
			is_tw = gr.CalcTextWidth(is_text, is_font);
		} catch (e) {};
		var is_w = Math.min(p.list.w - zoom(30, g_dpi), Math.max(zoom(180, g_dpi), is_tw + is_pad * 3));
		var is_x = p.list.x + Math.round((p.list.w - is_w) / 2);
		var is_y = p.list.y + zoom(20, g_dpi);
		var is_bg = blendColors(g_color_normal_bg, g_color_normal_txt, 0.08);
		var is_accent = g_incremental_search_no_result ? RGB(210, 60, 60) : accent_colour(255);

		gr.FillSolidRect(is_x, is_y, is_w, is_h, is_bg & RGBA(255, 255, 255, 245));
		gr.FillSolidRect(is_x, is_y, is_stripe, is_h, is_accent);
		gr.DrawRect(is_x, is_y, is_w - 1, is_h - 1, 1.0, g_color_normal_txt & 0x2dffffff);
		try {
			gr.GdiDrawText(is_text, is_font,
				g_incremental_search_no_result ? RGB(255, 130, 130) : g_color_normal_txt,
				is_x + is_stripe + is_pad, is_y, is_w - is_stripe - is_pad * 2, is_h,
				DT_LEFT | DT_VCENTER | DT_CALCRECT | DT_NOPREFIX | DT_SINGLELINE | DT_END_ELLIPSIS);
		} catch (e) {};
	};


	if (properties.showDPI) {
		gr.FillSolidRect(ww - 33, 5, 30, 15, g_color_normal_bg);
		gr.GdiDrawText(g_dpi, gdi_font("segoe ui", 15, 1), RGB(75, 255, 75), 0, 2, ww - 5, wh - 5, DT_RIGHT | DT_TOP);
	};

	// Album accent diagnostic overlay (F7). Shows what colour this panel has RECEIVED from
	// the producer (the tabs panel) - JSPlaylist no longer extracts anything itself.
	if (properties.accentDebug) {
		var dbg_font = gdi_font("segoe ui", zoom(12, g_dpi), 0);
		var dbg_font_b = gdi_font("segoe ui", zoom(12, g_dpi), 1);
		var dbg_w = zoom(330, g_dpi);
		var dbg_lh = zoom(17, g_dpi);
		var dbg_rows = [
			["enabled", String(properties.albumAccentEnabled)],
			["strength", properties.accentStrength + "%"],
			["role", "consumer (producer: tabs panel)"],
			["colour", "rgb(" + getRed(AlbumAccent.colour) + ", " + getGreen(AlbumAccent.colour) + ", " + getBlue(AlbumAccent.colour) + ")" +
				(AlbumAccent.colour == AlbumAccent.FIXED_ACCENT ? "  = DEFAULT" : "")],
			["accent row highlight", String(properties.uwpAccentHighlight)]
		];
		var dbg_h = dbg_lh * (dbg_rows.length + 1) + zoom(46, g_dpi);
		var dbg_x = zoom(10, g_dpi);
		var dbg_y = p.list.y + zoom(10, g_dpi);

		gr.FillSolidRect(dbg_x, dbg_y, dbg_w, dbg_h, RGBA(0, 0, 0, 225));
		gr.DrawRect(dbg_x, dbg_y, dbg_w - 1, dbg_h - 1, 1.0, accent_colour(255));
		gr.GdiDrawText("SHARED ACCENT  (F7 to hide)", dbg_font_b, RGB(255, 255, 255), dbg_x + zoom(10, g_dpi), dbg_y + zoom(6, g_dpi), dbg_w - zoom(20, g_dpi), dbg_lh, g_LDT);

		// big raw swatch: this is the extracted colour at full opacity, no blending
		var sw = zoom(30, g_dpi);
		gr.FillSolidRect(dbg_x + dbg_w - sw - zoom(10, g_dpi), dbg_y + zoom(6, g_dpi), sw, sw, AlbumAccent.colour | 0xff000000);
		gr.DrawRect(dbg_x + dbg_w - sw - zoom(10, g_dpi), dbg_y + zoom(6, g_dpi), sw - 1, sw - 1, 1.0, RGBA(255, 255, 255, 120));

		for (var dbg_i = 0; dbg_i < dbg_rows.length; dbg_i++) {
			var dbg_ry = dbg_y + zoom(30, g_dpi) + dbg_i * dbg_lh;
			// opaque grey: GdiDrawText discards alpha, and this overlay sits on solid black
			gr.GdiDrawText(dbg_rows[dbg_i][0], dbg_font, RGB(150, 150, 150), dbg_x + zoom(10, g_dpi), dbg_ry, zoom(85, g_dpi), dbg_lh, g_LDT);
			gr.GdiDrawText(dbg_rows[dbg_i][1], dbg_font, RGB(255, 255, 255), dbg_x + zoom(100, g_dpi), dbg_ry, dbg_w - zoom(110, g_dpi), dbg_lh, g_LDT);
		};

		// alpha ramp: if the accent works, this is a visible gradient of the album colour
		var ramp_y = dbg_y + dbg_h - zoom(20, g_dpi);
		var ramp_steps = 8;
		var ramp_w = Math.floor((dbg_w - zoom(20, g_dpi)) / ramp_steps);
		for (var dbg_s = 0; dbg_s < ramp_steps; dbg_s++) {
			gr.FillSolidRect(dbg_x + zoom(10, g_dpi) + dbg_s * ramp_w, ramp_y, ramp_w - 1, zoom(12, g_dpi), accent_colour(30 + dbg_s * 32));
		};
	};
};

//=================================================// Mouse Callbacks
function on_mouse_lbtn_down(x, y) {

	if (properties.enableTouchControl) {
		cTouch.up_id = -1;

		if (p.list.isHoverObject(x, y) && !p.scrollbar.isHoverObject(x, y)) {
			cTouch.down = true;
			cTouch.y_start = y;
		};
	};

	g_left_click_hold = true;



	cover.previous_max_size = p.headerBar.columns[0].w;

	// check list
	p.list.check("down", x, y);

	// check scrollbar
	if (!cPlaylistManager.visible) {
		if (p.playlistManager.woffset == 0 && properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
			p.scrollbar.check("down", x, y);
		};

		// check scrollbar scroll on click above or below the cursor
		if (p.scrollbar.hover && !p.scrollbar.cursorDrag) {
			var scrollstep = p.list.totalRowVisible;
			if (y < p.scrollbar.cursorPos) {
				if (!p.list.buttonclicked && !cScrollBar.timerID1) {
					p.list.buttonclicked = true;
					p.list.scrollItems(1, scrollstep);
					cScrollBar.timerID1 = window.SetTimeout(function () {
							p.list.scrollItems(1, scrollstep);
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
									if (p.scrollbar.hover) {
										if (mouse_x > p.scrollbar.x && p.scrollbar.cursorPos > mouse_y) {
											p.list.scrollItems(1, scrollstep);
										};
									};
								}, 60);
						}, 400);
				};
			} else {
				if (!p.list.buttonclicked && !cScrollBar.timerID1) {
					p.list.buttonclicked = true;
					p.list.scrollItems(-1, scrollstep);
					cScrollBar.timerID1 = window.SetTimeout(function () {
							p.list.scrollItems(-1, scrollstep);
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
									if (p.scrollbar.hover) {
										if (mouse_x > p.scrollbar.x && p.scrollbar.cursorPos + p.scrollbar.cursorHeight < mouse_y) {
											p.list.scrollItems(-1, scrollstep);
										};
									};
								}, 60);
						}, 400)
				};
			};
		};
	} else {
		p.playlistManager.check("down", x, y);
	};

	// check topbar
	if (cTopBar.visible)
		p.topBar.check("down", x, y);
	// check headerbar
	if (p.headerBar.visible)
		p.headerBar.on_mouse("down", x, y);
};

function on_mouse_lbtn_dblclk(x, y, mask) {

	g_left_click_hold = true;


	// check list
	p.list.check("dblclk", x, y);
	// check headerbar
	if (p.headerBar.visible)
		p.headerBar.on_mouse("dblclk", x, y);

	// check scrollbar
	if (!cPlaylistManager.visible) {
		if (properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
			p.scrollbar.check("dblclk", x, y);
			if (p.scrollbar.hover) {
				on_mouse_lbtn_down(x, y); // ...to have a scroll response on double clicking scrollbar area above or below the cursor!
			};
		};
	} else {
		p.playlistManager.check("dblclk", x, y);
	};
};

function on_mouse_lbtn_up(x, y) {



	// scrollbar scrolls up and down RESET
	p.list.buttonclicked = false;
	cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
	cScrollBar.timerID1 = false;
	cScrollBar.timerID2 && window.ClearTimeout(cScrollBar.timerID2);
	cScrollBar.timerID2 = false;

	// after a cover column resize, update cover image cache
	if (cover.resized == true) {
		cover.resized = false;
		// reset cache
		if (!g_first_launch) {
			cover.max_w = (cGroup.default_collapsed_height > cGroup.default_expanded_height ? cGroup.default_collapsed_height * cTrack.height : cGroup.default_expanded_height * cTrack.height);
			g_image_cache = new image_cache;
		} else {
			g_first_launch = false;
		};
		update_playlist(properties.collapseGroupsByDefault);
	};

	// check list
	p.list.check("up", x, y);

	// playlist manager (if visible)
	if (p.playlistManager.woffset > 0 || cPlaylistManager.visible) {
		p.playlistManager.check("up", x, y);
	};

	// check scrollbar
	if (properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
		p.scrollbar.check("up", x, y);
	};

	// Drop items after a drag'n drop INSIDE the playlist
	if (!properties.enableTouchControl) {
		if (p.list.ishover && dragndrop.drag_in) {
			if (dragndrop.drag_id >= 0 && dragndrop.drop_id >= 0) {
				var save_focus_handle = fb.GetFocusItem();
				var drop_handle = p.list.handleList[dragndrop.drop_id];
				var nb_selected_items = p.list.metadblist_selection.Count;

				if (dragndrop.contigus_sel && nb_selected_items > 0) {
					if (dragndrop.drop_id > dragndrop.drag_id) {
						// on pointe sur le dernier item de la selection si on move vers le bas
						var new_drag_pos = p.list.handleList.Find(p.list.metadblist_selection[nb_selected_items - 1]);
						var move_delta = dragndrop.drop_id - new_drag_pos;
					} else {
						// on pointe sur le 1er item de la selection si on move vers le haut
						var new_drag_pos = p.list.handleList.Find(p.list.metadblist_selection[0]);
						var move_delta = dragndrop.drop_id - new_drag_pos;
					};

					plman.UndoBackup(p.list.playlist);
					plman.MovePlaylistSelection(p.list.playlist, move_delta);

				} else {

					// 1st: move selected item at the full end of the playlist to make then contigus
					g_avoid_on_item_focus_change = true;
					g_avoid_on_playlist_items_reordered = true;
					plman.UndoBackup(p.list.playlist);
					plman.MovePlaylistSelection(p.list.playlist, plman.PlaylistItemCount(p.list.playlist));
					// 2nd: move bottom selection to new drop_id place (to redefine first...)
					plman.SetPlaylistFocusItemByHandle(p.list.playlist, drop_handle);
					var drop_id_new = plman.GetPlaylistFocusItemIndex(p.list.playlist);
					plman.SetPlaylistFocusItemByHandle(p.list.playlist, save_focus_handle);
					if (dragndrop.drag_id > drop_id_new) {
						var mdelta = p.list.count - nb_selected_items - drop_id_new;
					} else {
						var mdelta = p.list.count - nb_selected_items - drop_id_new - 1;
					};
					plman.MovePlaylistSelection(p.list.playlist, mdelta * -1);
					g_avoid_on_playlist_items_reordered = false;
					g_avoid_on_item_focus_change = false;
				};
			};
		};
	};

	dragndrop.drag_id = -1;
	dragndrop.drop_id = -1;
	dragndrop.drag_in = false;
	dragndrop.moved = false;
	dragndrop.clicked = false;
	dragndrop.moved = false;
	dragndrop.x = 0;
	dragndrop.y = 0;
	dragndrop.timerID && window.ClearTimeout(dragndrop.timerID);
	dragndrop.timerID = false;
	//window.SetCursor(IDC_ARROW);

	// check topbar
	if (cTopBar.visible)
		p.topBar.check("up", x, y);

	// check headerbar
	if (p.headerBar.visible)
		p.headerBar.on_mouse("up", x, y);

	// repaint on mouse up to refresh covers just loaded
	full_repaint();

	if (cTouch.down) {
		cTouch.down = false;
		cTouch.y_start = y;
		cTouch.down_id = cTouch.up_id;
	};

	g_left_click_hold = false;
};

function on_mouse_rbtn_up(x, y) {

	// check list
	p.list.check("right", x, y);
	// check topBar
	if (cTopBar.visible)
		p.topBar.check("right", x, y);
	// check headerbar
	if (p.headerBar.visible)
		p.headerBar.on_mouse("right", x, y);
	// playlist manager
	if (p.playlistManager.ishoverItem || p.playlistManager.ishoverHeader) {
		p.playlistManager.check("right", x, y);
	};
	return true;
};

function on_mouse_move(x, y) {

	if (x == mouse_x && y == mouse_y)
		return true;

	if (x >= 0 && x < ww && y >= 0 && y < wh)
		g_leave = false;



	if (cTouch.down) {

		if (p.headerBar.columnDragged < 1 && !p.headerBar.borderDragged) {
			cTouch.y_end = y;
			var y_delta = (cTouch.y_end - cTouch.y_start);
			if (x < p.list.w) {
				if (y_delta > p.list.h / cTrack.height) {
					on_mouse_wheel(1); // scroll up
					cTouch.y_start = cTouch.y_end;
				};
				if (y_delta < -p.list.h / cTrack.height) {
					on_mouse_wheel(-1); // scroll down
					cTouch.y_start = cTouch.y_end;
				};
			};
		};

	} else {

		// playlist manager (if visible)
		if (p.playlistManager.woffset > 0) {
			if (!cPlaylistManager.blink_timer) {
				p.playlistManager.check("move", x, y);
			};
		};

		// check list
		p.list.check("move", x, y);

		// check scrollbar
		if (!cPlaylistManager.visible) {
			if (properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
				p.scrollbar.check("move", x, y);
			};
		};

		// check topbar
		if (cTopBar.visible)
			p.topBar.check("move", x, y);

		// check headerbar
		if (p.headerBar.visible)
			p.headerBar.on_mouse("move", x, y);

		// if cover column resized (or init), refresh column cover, minimum count, ... and playlist
		if (cover.previous_max_size != p.headerBar.columns[0].w) {
			cover.resized = true;
			if (p.headerBar.columns[0].w > 0) {
				cover.column = true;
				cGroup.count_minimum = Math.ceil((p.headerBar.columns[0].w) / cTrack.height);
				if (cGroup.count_minimum < cGroup.default_count_minimum)
					cGroup.count_minimum = cGroup.default_count_minimum;
			} else {
				cover.column = false;
				cGroup.count_minimum = cGroup.default_count_minimum;
			};
			cover.previous_max_size = p.headerBar.columns[0].w;
		};

		// check toolbar for mouse icon dragging mode ***
		if (p.list.mclicked && !p.headerBar.borderDragged && !p.headerBar.columnDragged) {
			if (p.list.ishover || p.playlistManager.ishover || p.playlistManager.ishoverHeader) {
				if (dragndrop.enabled && (dragndrop.drag_in || dragndrop.moved)) {
					if ((p.playlistManager.ishover && p.playlistManager.hoverId == -1) || p.playlistManager.scrollbar.isHoverScrollbar) {
						if (!p.playlistManager.ishoverHeader) {
							window.SetCursor(IDC_NO);
						} else {
							window.SetCursor(IDC_HELP);
						};
					} else {
						if (p.playlistManager.ishover && (p.playlistManager.playlists[p.playlistManager.hoverId].isAutoPlaylist || p.playlistManager.playlists[p.playlistManager.hoverId].isReservedPlaylist || p.playlistManager.playlists[p.playlistManager.hoverId].idx == plman.ActivePlaylist)) {
							window.SetCursor(IDC_NO);
						} else {
							window.SetCursor(IDC_HELP);
						};
					};
				} else {
					window.SetCursor(IDC_ARROW);
				};
			} else {
				if (dragndrop.enabled && (dragndrop.drag_in || dragndrop.moved)) {
					window.SetCursor(IDC_NO);
				} else {
					window.SetCursor(IDC_ARROW);
				};
			};
		};
		if (cPlaylistManager.drag_moved) {
			if (p.playlistManager.ishoverItem) {
				window.SetCursor(IDC_HELP);
			} else {
				window.SetCursor(IDC_NO);
			};
		};

		// if Dragging Track on playlist, scroll playlist if required
	if (dragndrop.drag_in) {
		// Dragn Drop
		if (p.playlistManager.woffset == 0 || (cPlaylistManager.visible && x < p.playlistManager.x - p.playlistManager.woffset)) {
			if (y < p.list.y) {
				if (!p.list.buttonclicked) {
					p.list.buttonclicked = true;
					//
					var scroll_speed_ms = 5;
					//
					if (!cScrollBar.timerID1) {
						cScrollBar.timerID1 = window.SetInterval(function () {
								on_mouse_wheel(1);
							}, scroll_speed_ms);
					};
				} else {
					full_repaint();
				};
			} else if (y > p.list.y + p.list.h) {
				if (!p.list.buttonclicked) {
					p.list.buttonclicked = true;
					//
					var scroll_speed_ms = 5;
					//
					if (!cScrollBar.timerID1) {
						cScrollBar.timerID1 = window.SetInterval(function () {
								on_mouse_wheel(-1);
							}, scroll_speed_ms);
					};
				} else {
					full_repaint();
				};
			} else {
				cScrollBar.timerID1 && window.ClearInterval(cScrollBar.timerID1);
				cScrollBar.timerID1 = false;
				p.list.buttonclicked = false;
				if (!dragndrop.timerID) {
					dragndrop.timerID = window.SetTimeout(function () {
							full_repaint();
							dragndrop.timerID && window.ClearTimeout(dragndrop.timerID);
							dragndrop.timerID = false;
						}, 75);
				};
			};
		} else {
			cScrollBar.timerID1 && window.ClearInterval(cScrollBar.timerID1);
			cScrollBar.timerID1 = false;
		};
	};
};

// save coords
mouse_x = x;
mouse_y = y;
};

function on_mouse_wheel(delta) {

if (g_middle_clicked)
	return;

if (utils.IsKeyPressed(VK_CONTROL)) {
	var zoomStep = 15;
	if (delta > 0) {
		g_forced_percent = (g_forced_percent < g_dpi_percent ? g_dpi_percent + zoomStep : g_forced_percent + zoomStep);
		if (g_forced_percent > 250)
			g_forced_percent = 250;
	} else {
		g_forced_percent -= zoomStep;
		if (g_forced_percent <= g_dpi_percent)
			g_forced_percent = 0;
	};
	window.SetProperty("SYSTEM.dpi (0 = Default)", g_forced_percent);
	g_dpi = (g_forced_percent == 0 ? g_dpi_percent : g_forced_percent);
	adjustMetrics(1);
	resize_panels();
	full_repaint();
} else {


	// handle p.list Beam
	var limit_reached = false;
	var maxOffset = (p.list.totalRows > p.list.totalRowVisible ? p.list.totalRows - p.list.totalRowVisible : 0);
	if (maxOffset > 0) {
		if (delta > 0) { // scroll up requested
			if (p.list.offset == 0) {
				// top beam to draw
				p.list.beam = 1;
				cList.beam_sens = 1;
				limit_reached = true;
			};
		} else { // scroll down requested
			if (p.list.offset >= maxOffset) {
				// bottom beam to draw
				p.list.beam = 2;
				cList.beam_sens = 1;
				limit_reached = true;
			};
		};
		if (limit_reached) {
			if (!cList.beam_timer) {
				p.list.beam_alpha = 0;
				cList.beam_timer = window.SetInterval(function () {
						if (cList.beam_sens == 1) {
							p.list.beam_alpha = (p.list.beam_alpha <= 275 ? p.list.beam_alpha + 25 : 300);
							if (p.list.beam_alpha >= 300) {
								cList.beam_sens = 2;
							};
						} else {
							p.list.beam_alpha = (p.list.beam_alpha >= 25 ? p.list.beam_alpha - 25 : 0);
							if (p.list.beam_alpha <= 0) {
								p.list.beam = 0;
								window.ClearInterval(cList.beam_timer);
								cList.beam_timer = false;
							};
						};
						full_repaint();
					}, 32);
			};
		};
	};

	reset_cover_timers();

	if (p.list.ishover || cScrollBar.timerID1 || cList.repaint_timer) {
		// timer to tell to other functions (on cover load asynch done, ...) that a repaint is already running
		if (!g_mouse_wheel_timer) {
			// set scroll speed / mouse y offset from panel limits
			if (g_dragndrop_status) {
				if (g_dragndrop_y < p.list.y + cTrack.height) {
					var s = Math.abs(g_dragndrop_y - (p.list.y + cTrack.height));
					var h = Math.ceil(cTrack.height / 2);
					if (s > h)
						s = h;
					var t = h - s + 1;
					var r = Math.round(500 / h);
					var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
				} else if (g_dragndrop_y > p.list.y + p.list.h - cTrack.height) {
					var s = Math.abs(g_dragndrop_y - (p.list.y + p.list.h - cTrack.height));
					var h = Math.ceil(cTrack.height / 2);
					if (s > h)
						s = h;
					var t = h - s + 1;
					var r = Math.round(500 / h);
					var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
				} else {
					scroll_speed_ms = 20;
				};
			} else {
				if (mouse_y < p.list.y) {
					var s = Math.abs(mouse_y - p.list.y);
					var h = Math.ceil(cTrack.height / 2);
					if (s > h)
						s = h;
					var t = h - s + 1;
					var r = Math.round(500 / h);
					var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
				} else if (mouse_y > p.list.y + p.list.h) {
					var s = Math.abs(mouse_y - (p.list.y + p.list.h));
					var h = Math.ceil(cTrack.height / 2);
					if (s > h)
						s = h;
					var t = h - s + 1;
					var r = Math.round(500 / h);
					var scroll_speed_ms = ((t * r) < 10 ? 10 : (t * r));
				} else {
					scroll_speed_ms = 20;
				};
			};
			//
			g_mouse_wheel_timer = window.SetTimeout(function () {
					var cw = cover.column ? ((p.headerBar.columns[0].w <= cover.max_w) ? cover.max_w : p.headerBar.columns[0].w) : cover.max_w;
					var ch = cw;
					p.list.scrollItems(delta, properties.enableTouchControl ? cList.touchstep : cList.scrollstep);
					g_mouse_wheel_timer && window.ClearTimeout(g_mouse_wheel_timer);
					g_mouse_wheel_timer = false;
				}, scroll_speed_ms);
		};
	} else {
		if (!dragndrop.moved) {
			p.playlistManager.check("wheel", mouse_x, mouse_y, delta);
		};
	};
};
};

// Returns the track item currently under the mouse, or null.
function get_hovered_track() {
if (!p.list || !p.list.items)
	return null;
var fin = p.list.items.length;
for (var i = 0; i < fin; i++) {
	var it = p.list.items[i];
	if (it && it.ishover && it.type == 0 && it.empty_row_index == 0 && it.metadb)
		return it;
};
return null;
};

// Middle click toggles the clicked track in the playback queue: queued -> removed,
// not queued -> appended. (The playlist manager is on TAB and CTRL+M.)
function toggle_queue_hovered_track() {
var it = get_hovered_track();
if (!it)
	return false;

var qidx = plman.FindPlaybackQueueItemIndex(it.metadb, it.playlist, it.track_index);
if (qidx >= 0) {
	plman.RemoveItemFromPlaybackQueue(qidx);
} else {
	plman.AddPlaylistItemToPlaybackQueue(it.playlist, it.track_index);
};
full_repaint();
return true;
};

function on_mouse_mbtn_down(x, y, mask) {
g_middle_clicked = true;
// enqueue / dequeue the clicked song; fall back to nothing when the click missed a row
toggle_queue_hovered_track();
};

function on_mouse_mbtn_dblclk(x, y, mask) {
// a double middle click would otherwise queue and immediately unqueue
g_middle_clicked = true;
};

function on_mouse_mbtn_up(x, y, mask) {
if (g_middle_click_timer) {
	window.ClearTimeout(g_middle_click_timer);
	g_middle_click_timer = false;
};
g_middle_click_timer = window.SetTimeout(function () {
		g_middle_clicked = false;
		window.ClearTimeout(g_middle_click_timer);
		g_middle_click_timer = false;
	}, 250);
};

function on_mouse_leave() {
g_leave = true;

p.list.check("leave", 0, 0);

if (properties.showscrollbar && p.scrollbar && p.list.totalRows > 0 && (p.list.totalRows > p.list.totalRowVisible)) {
	p.scrollbar.check("leave", 0, 0);
};

p.topBar.check("leave", 0, 0);

p.headerBar.on_mouse("leave", 0, 0);

p.playlistManager.check("leave", 0, 0);
};

//=================================================// Callbacks

function update_playlist(iscollapsed) {
g_group_id_focused = 0;
p.list.updateHandleList(plman.ActivePlaylist, iscollapsed);

p.list.setItems(false);
p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
// if sort by header click was requested, reset mouse cursor to default
if (cHeaderBar.sortRequested) {
	window.SetCursor(IDC_ARROW);
	cHeaderBar.sortRequested = false;
};
};

function on_playlist_switch() {
// a pending search no longer refers to this list
clear_incremental_search();
update_playlist(properties.collapseGroupsByDefault);
p.topBar.setDatas();
p.headerBar.resetSortIndicators();
full_repaint();
};

function on_playlists_changed() {

if (!g_avoid_on_playlists_changed) {

	if (cPlaylistManager.mediaLibraryPlaylist)
		checkMediaLibrayPlaylist();

	// close timers if dragging tracks is running
	if (dragndrop.drag_in || dragndrop.moved) {
		if (dragndrop.timerID) {
			window.ClearTimeout(dragndrop.timerID);
			dragndrop.timerID = false;
		};
		dragndrop.drag_in = false;
		dragndrop.moved = false;
		dragndrop.x = 0;
		dragndrop.y = 0;
		if (!cPlaylistManager.visible) {
			if (cPlaylistManager.hscroll_timer) {
				window.ClearTimeout(cPlaylistManager.hscroll_timer);
				cPlaylistManager.hscroll_timer = false;
			};
			p.playlistManager.woffset = 0;
			if (cPlaylistManager.vscroll_timer) {
				window.ClearTimeout(cPlaylistManager.vscroll_timer);
				cPlaylistManager.vscroll_timer = false;
			};
			p.playlistManager.woffset = 0;
			on_mouse_move(mouse_x + 1, mouse_y); // to reset window cursor style to a simple arrow
		};
	};

	p.list.playlist = plman.ActivePlaylist;
	p.topBar.setDatas();
	if (cPlaylistManager.visible) {
		if (cPlaylistManager.drag_droped) { // no reset of the scroll offset if playlist item moved by dragging
			window.SetCursor(IDC_ARROW);
			p.playlistManager.refresh("", false, false, false);
		} else {
			p.playlistManager.refresh("", false, false);
		};
	} else {
		p.playlistManager.refresh("", true, true);
	};
	full_repaint();
};
};

function on_playlist_items_added(playlist_idx) {
if (!g_avoid_on_playlist_items_added) {
	if (playlist_idx == p.list.playlist) {
		update_playlist(properties.collapseGroupsByDefault);
		p.topBar.setDatas();
		p.headerBar.resetSortIndicators();
		full_repaint();
	};
};
};

function on_playlist_items_removed(playlist_idx, new_count) {
if (!g_avoid_on_playlist_items_removed) {
	if (playlist_idx == p.list.playlist) {
		update_playlist(properties.collapseGroupsByDefault);
		p.topBar.setDatas();
		p.headerBar.resetSortIndicators();
		full_repaint();
	};
};
};

function on_playlist_items_reordered(playlist_idx) {
if (!g_avoid_on_playlist_items_reordered) {
	if (playlist_idx == p.list.playlist && p.headerBar.columnDragged == 0) {
		update_playlist(properties.collapseGroupsByDefault);
		p.headerBar.resetSortIndicators();
		full_repaint();
	} else {
		p.headerBar.columnDragged = 0;
	};
};
};

function on_playlist_items_selection_change() {
full_repaint();
};

function on_selection_changed(metadb) {};

function on_item_focus_change(playlist, from, to) {
if (!g_avoid_on_item_focus_change) {
	g_metadb = (fb.IsPlaying || fb.IsPaused) ? fb.GetNowPlaying() : plman.PlaylistItemCount(plman.ActivePlaylist) > 0 ? fb.GetFocusItem() : false;
	if (g_metadb) {
		on_metadb_changed();
	} else {
		g_path = "";
		g_track_type = "";
	};
	if (playlist == p.list.playlist) {
		p.list.focusedTrackId = to;
		// with playback stopped, the accent AND the background follow the focused track
		update_accent_from_focus();
		var center_focus_item = p.list.isFocusedItemVisible();

		if (properties.autocollapse) { // && !center_focus_item
			var grpId = p.list.getGroupIdfromTrackId(to);
			if (grpId >= 0) {
				if (p.list.groups[grpId].collapsed) {
					p.list.updateGroupStatus(grpId);
					p.list.setItems(true);
					center_focus_item = p.list.isFocusedItemVisible();
				} else {
					if ((!center_focus_item && !p.list.drawRectSel) || (center_focus_item && to == 0)) {
						p.list.setItems(true);
					};
				};
			};
		} else {
			if ((!center_focus_item && !p.list.drawRectSel) || (center_focus_item && to == 0)) {
				p.list.setItems(true);
			};
		};
		p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
	};
};
};

function on_metadb_changed() {
if (g_metadb) {
	g_path = tf_path.EvalWithMetadb(g_metadb);
	g_track_type = TrackType(g_path);
};
// rebuild list to draw
p.list.setItems(false);
full_repaint();
};

//=================================================// Keyboard Callbacks
function on_key_up(vkey) {


// after a cover column resize, update cover image and empty rows to show the whole cover if low tracks count in group
if (cover.resized == true) {
	cover.resized = false;
	update_playlist(properties.collapseGroupsByDefault);
};

// scroll keys up and down RESET (step and timers)
p.list.keypressed = false;
cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
cScrollBar.timerID1 = false;
cScrollBar.timerID2 && window.ClearTimeout(cScrollBar.timerID2);
cScrollBar.timerID2 = false;
if (vkey == VK_SHIFT) {
	p.list.SHIFT_start_id = null;
	p.list.SHIFT_count = 0;
};
};

function on_key_down(vkey) {
var mask = GetKeyboardMask();
var act_pls = plman.ActivePlaylist;


	if (dragndrop.drag_in)
		return true;

	if (p.playlistManager.inputboxID >= 0) {
		if (mask == KMask.none) {
			switch (vkey) {
			case VK_ESCAPE:
			case 222:
				p.playlistManager.inputboxID = -1;
				full_repaint();
				break;
			default:
				p.playlistManager.inputbox.on_key_down(vkey);
			};
		} else {
			p.playlistManager.inputbox.on_key_down(vkey);
		};
	} else {
		// Incremental search keys (ESC clear / BACKSPACE delete / F3 next match)
		// are handled before anything else, exactly like jssp.
		if (mask == KMask.none && incremental_key(vkey))
			return true;

		if (mask == KMask.none) {
			switch (vkey) {
			case VK_F2:
				// rename playlist (playlist manager panel visible)
				if (cPlaylistManager.visible) {
					p.playlistManager.inputbox = new oInputbox(p.playlistManager.w - p.playlistManager.border - p.playlistManager.scrollbarWidth - 40, cPlaylistManager.rowHeight - 10, plman.GetPlaylistName(act_pls), "", g_color_normal_txt, g_color_normal_bg, RGB(0, 0, 0), g_color_selected_bg & 0xccffffff, "renamePlaylist()", "p.playlistManager", 0, g_fsize, 225);
					p.playlistManager.inputboxID = act_pls;
					// activate box content + selection activated
					if (cPlaylistManager.inputbox_timer) {
						window.ClearTimeout(cPlaylistManager.inputbox_timer);
						cPlaylistManager.inputbox_timer = false;
					};
					cPlaylistManager.inputbox_timer = window.SetTimeout(inputboxPlaylistManager_activate, 20);
				}
				break;
			case VK_F4:
				// reapply the sort tied to the active group pattern (same effect as
				// Groups > Apply Group Sorting - see oHeaderBar.reapplyActiveGroupSort
				// in WSHheaderbar.js)
				p.headerBar.reapplyActiveGroupSort();
				break;
			case VK_F5:
				// refresh covers
				g_image_cache = new image_cache;
				full_repaint();
				break;
			case VK_F6:
				properties.showDPI = !properties.showDPI;
				window.SetProperty("SYSTEM.Show DPI", properties.showDPI);
				full_repaint();
				break;
			case VK_F7:
				// album accent diagnostic overlay
				properties.accentDebug = !properties.accentDebug;
				window.SetProperty("CUSTOM.Accent Debug Overlay", properties.accentDebug);
				if (properties.accentDebug)
					SharedAccentProtocol.requestAccent();
				full_repaint();
				break;
			case VK_TAB:
				togglePlaylistManager();
				break;
			case VK_BACK:
				// handled by incremental_key() above when a search is active
				break;
			case VK_ESCAPE:
			case 222:
				p.playlistManager.inputboxID = -1;
				clear_incremental_search();
				full_repaint();
				break;
			case VK_UP:
				var scrollstep = 1;
				var new_focus_id = 0;
				if (p.list.count > 0 && !p.list.keypressed && !cScrollBar.timerID1) {
					p.list.keypressed = true;
					reset_cover_timers();

					if (p.list.focusedTrackId < 0) {
						var old_grpId = 0;
					} else {
						var old_grpId = p.list.getGroupIdfromTrackId(p.list.focusedTrackId);
					};
					new_focus_id = (p.list.focusedTrackId > 0) ? p.list.focusedTrackId - scrollstep : 0;
					var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
					if (!properties.autocollapse) {
						if (p.list.groups[old_grpId].collapsed) {
							if (old_grpId > 0 && old_grpId == grpId) {
								new_focus_id = (p.list.groups[grpId].start > 0) ? p.list.groups[grpId].start - scrollstep : 0;
								var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
							};
						};
					};

					//new_focus_id = (p.list.focusedTrackId > 0) ? p.list.focusedTrackId - scrollstep : 0;
					// if new track focused id is in a collapsed group, set the 1st track of the group as the focused track (= group focused)
					//var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
					if (p.list.groups[grpId].collapsed) {
						if (properties.autocollapse) {
							new_focus_id = p.list.groups[grpId].start + p.list.groups[grpId].count - 1;
						} else {
							new_focus_id = p.list.groups[grpId].start;
						};
					};
					if (p.list.focusedTrackId == 0 && p.list.offset > 0) {
						p.list.scrollItems(1, scrollstep);
						cScrollBar.timerID1 = window.SetTimeout(function () {
							p.list.scrollItems(1, scrollstep);
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
								p.list.scrollItems(1, scrollstep);
							}, 50);
						}, 400);
					} else {
						plman.SetPlaylistFocusItem(act_pls, new_focus_id);
						plman.ClearPlaylistSelection(act_pls);
						plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
						cScrollBar.timerID1 = window.SetTimeout(function () {
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
								new_focus_id = (p.list.focusedTrackId > 0) ? p.list.focusedTrackId - scrollstep : 0;
								// if new track focused id is in a collapsed group, set the 1st track of the group as the focused track (= group focused)
								var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
								if (p.list.groups[grpId].collapsed) {
									if (properties.autocollapse) {
										new_focus_id = p.list.groups[grpId].start + p.list.groups[grpId].count - 1;
									} else {
										new_focus_id = p.list.groups[grpId].start;
									};
								};
								plman.SetPlaylistFocusItem(act_pls, new_focus_id);
								plman.ClearPlaylistSelection(act_pls);
								plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
							}, 50);
						}, 400);
					};
				};
				break;
			case VK_DOWN:
				var new_focus_id = 0;
				if (p.list.count > 0 && !p.list.keypressed && !cScrollBar.timerID1) {
					p.list.keypressed = true;
					reset_cover_timers();

					if (p.list.focusedTrackId < 0) {
						var old_grpId = 0;
					} else {
						var old_grpId = p.list.getGroupIdfromTrackId(p.list.focusedTrackId);
					};
					new_focus_id = (p.list.focusedTrackId < p.list.count - 1) ? p.list.focusedTrackId + 1 : p.list.count - 1;
					var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
					if (!properties.autocollapse) {
						if (p.list.groups[old_grpId].collapsed) {
							if (old_grpId < (p.list.groups.length - 1) && old_grpId == grpId) {
								new_focus_id = ((p.list.groups[grpId].start + p.list.groups[grpId].count - 1) < (p.list.count - 1)) ? (p.list.groups[grpId].start + p.list.groups[grpId].count - 1) + 1 : p.list.count - 1;
								var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
							};
						};
					};

					//new_focus_id = (p.list.focusedTrackId < p.list.count - 1) ? p.list.focusedTrackId + 1 : p.list.count - 1;
					// if new track focused id is in a collapsed group, set the last track of the group as the focused track (= group focused)
					//var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
					if (p.list.groups[grpId].collapsed) {
						if (properties.autocollapse) {
							new_focus_id = p.list.groups[grpId].start;
						} else {
							new_focus_id = p.list.groups[grpId].start + p.list.groups[grpId].count - 1;
						};
					};
					plman.SetPlaylistFocusItem(act_pls, new_focus_id);
					plman.ClearPlaylistSelection(act_pls);
					plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
					cScrollBar.timerID1 = window.SetTimeout(function () {
						cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
						cScrollBar.timerID1 = false;
						cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
						cScrollBar.timerID2 = window.SetInterval(function () {
							new_focus_id = (p.list.focusedTrackId < p.list.count - 1) ? p.list.focusedTrackId + 1 : p.list.count - 1;
							// if new track focused id is in a collapsed group, set the last track of the group as the focused track (= group focused)
							var grpId = p.list.getGroupIdfromTrackId(new_focus_id);
							if (p.list.groups[grpId].collapsed) {
								if (properties.autocollapse) {
									new_focus_id = p.list.groups[grpId].start;
								} else {
									new_focus_id = p.list.groups[grpId].start + p.list.groups[grpId].count - 1;
								};
							};
							plman.SetPlaylistFocusItem(act_pls, new_focus_id);
							plman.ClearPlaylistSelection(act_pls);
							plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
						}, 50);
					}, 400);
				};
				break;
			case VK_PGUP:
				var scrollstep = p.list.totalRowVisible;
				var new_focus_id = 0;
				if (p.list.count > 0 && !p.list.keypressed && !cScrollBar.timerID1) {
					p.list.keypressed = true;
					reset_cover_timers();
					new_focus_id = (p.list.focusedTrackId > scrollstep) ? p.list.focusedTrackId - scrollstep : 0;
					if (p.list.focusedTrackId == 0 && p.list.offset > 0) {
						p.list.scrollItems(1, scrollstep);
						cScrollBar.timerID1 = window.SetTimeout(function () {
							p.list.scrollItems(1, scrollstep);
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
								p.list.scrollItems(1, scrollstep);
							}, 60);
						}, 400);
					} else {
						plman.SetPlaylistFocusItem(act_pls, new_focus_id);
						plman.ClearPlaylistSelection(act_pls);
						plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
						cScrollBar.timerID1 = window.SetTimeout(function () {
							cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
							cScrollBar.timerID1 = false;
							cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
							cScrollBar.timerID2 = window.SetInterval(function () {
								new_focus_id = (p.list.focusedTrackId > scrollstep) ? p.list.focusedTrackId - scrollstep : 0;
								plman.SetPlaylistFocusItem(act_pls, new_focus_id);
								plman.ClearPlaylistSelection(act_pls);
								plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
							}, 60);
						}, 400);
					};
				};
				break;
			case VK_PGDN:
				var scrollstep = p.list.totalRowVisible;
				var new_focus_id = 0;
				if (p.list.count > 0 && !p.list.keypressed && !cScrollBar.timerID1) {
					p.list.keypressed = true;
					reset_cover_timers();
					new_focus_id = (p.list.focusedTrackId < p.list.count - scrollstep) ? p.list.focusedTrackId + scrollstep : p.list.count - 1;
					plman.SetPlaylistFocusItem(act_pls, new_focus_id);
					plman.ClearPlaylistSelection(act_pls);
					plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
					cScrollBar.timerID1 = window.SetTimeout(function () {
						cScrollBar.timerID1 && window.ClearTimeout(cScrollBar.timerID1);
						cScrollBar.timerID1 = false;
						cScrollBar.timerID2 && window.ClearInterval(cScrollBar.timerID2);
						cScrollBar.timerID2 = window.SetInterval(function () {
							new_focus_id = (p.list.focusedTrackId < p.list.count - scrollstep) ? p.list.focusedTrackId + scrollstep : p.list.count - 1;
							plman.SetPlaylistFocusItem(act_pls, new_focus_id);
							plman.ClearPlaylistSelection(act_pls);
							plman.SetPlaylistSelectionSingle(act_pls, new_focus_id, true);
						}, 60);
					}, 400);
				};
				break;
			case VK_RETURN:
				var cmd = properties.defaultPlaylistItemAction;
				if (cmd == "Play") {
					plman.ExecutePlaylistDefaultAction(act_pls, p.list.focusedTrackId);
				} else {
					fb.RunContextCommandWithMetadb(cmd, p.list.handleList[p.list.focusedTrackId], 0);
				};
				break;
			case VK_END:
				if (p.list.count > 0) {
					plman.SetPlaylistFocusItem(act_pls, p.list.count - 1);
					plman.ClearPlaylistSelection(act_pls);
					plman.SetPlaylistSelectionSingle(act_pls, p.list.count - 1, true);
				};
				break;
			case VK_HOME:
				if (p.list.count > 0) {
					plman.SetPlaylistFocusItem(act_pls, 0);
					plman.ClearPlaylistSelection(act_pls);
					plman.SetPlaylistSelectionSingle(act_pls, 0, true);
				};
				break;
			case VK_DELETE:
				if (!plman.IsAutoPlaylist(act_pls)) {
					plman.UndoBackup(act_pls);
					plman.RemovePlaylistSelection(act_pls, false);
					plman.SetPlaylistSelectionSingle(act_pls, plman.GetPlaylistFocusItemIndex(act_pls), true);
				};
				break;
			};
		} else {
			switch (mask) {
			case KMask.shift:
				switch (vkey) {
				case VK_SHIFT: // SHIFT key alone
					p.list.SHIFT_count = 0;
					break;
				case VK_UP: // SHIFT + KEY UP
					if (p.list.SHIFT_count == 0) {
						if (p.list.SHIFT_start_id == null) {
							p.list.SHIFT_start_id = p.list.focusedTrackId;
						};
						plman.ClearPlaylistSelection(act_pls);
						plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
						if (p.list.focusedTrackId > 0) {
							p.list.SHIFT_count--;
							p.list.focusedTrackId--;
							plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
							plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
						};
					} else if (p.list.SHIFT_count < 0) {
						if (p.list.focusedTrackId > 0) {
							p.list.SHIFT_count--;
							p.list.focusedTrackId--;
							plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
							plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
						};
					} else {
						plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, false);
						p.list.SHIFT_count--;
						p.list.focusedTrackId--;
						plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
					};
					break;
				case VK_DOWN: // SHIFT + KEY DOWN
					if (p.list.SHIFT_count == 0) {
						if (p.list.SHIFT_start_id == null) {
							p.list.SHIFT_start_id = p.list.focusedTrackId;
						};
						plman.ClearPlaylistSelection(act_pls);
						plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
						if (p.list.focusedTrackId < p.list.count - 1) {
							p.list.SHIFT_count++;
							p.list.focusedTrackId++;
							plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
							plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
						};
					} else if (p.list.SHIFT_count > 0) {
						if (p.list.focusedTrackId < p.list.count - 1) {
							p.list.SHIFT_count++;
							p.list.focusedTrackId++;
							plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, true);
							plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
						};
					} else {
						plman.SetPlaylistSelectionSingle(act_pls, p.list.focusedTrackId, false);
						p.list.SHIFT_count++;
						p.list.focusedTrackId++;
						plman.SetPlaylistFocusItem(act_pls, p.list.focusedTrackId);
					};
					break;
				};
				break;
			case KMask.ctrl:
				if (vkey == 65) { // CTRL+A
					fb.RunMainMenuCommand("Edit/Select all");
					p.list.metadblist_selection = plman.GetPlaylistSelectedItems(p.list.playlist);
					full_repaint();
				};
				if (vkey == 88) { // CTRL+X
					if (!plman.IsPlaylistLocked(act_pls)) {
						var items = plman.GetPlaylistSelectedItems(act_pls);
						if (fb.CopyHandleListToClipboard(items)) {
							plman.UndoBackup(act_pls);
							plman.RemovePlaylistSelection(act_pls);
						}
					};
				};
				if (vkey == 67) { // CTRL+C
					var items = plman.GetPlaylistSelectedItems(act_pls);
					fb.CopyHandleListToClipboard(items);
				};
				if (vkey == 86) { // CTRL+V
					if (!plman.IsPlaylistLocked(act_pls) && fb.CheckClipboardContents(window.ID)) {
						var items = fb.GetClipboardContents(window.ID);
						plman.UndoBackup(act_pls);
						plman.InsertPlaylistItems(act_pls, p.list.focusedTrackId + 1, items, false);
					}
				};
				if (vkey == 73) { // CTRL+I
					cTopBar.visible = !cTopBar.visible;
					window.SetProperty("SYSTEM.TopBar.Visible", cTopBar.visible);
					resize_panels();
					full_repaint();
				};
				if (vkey == 84) { // CTRL+T
					// Toggle Toolbar
					if (!p.timer_onKey) {
						cHeaderBar.locked = !cHeaderBar.locked;
						window.SetProperty("SYSTEM.HeaderBar.Locked", cHeaderBar.locked);
						if (!cHeaderBar.locked) {
							p.headerBar.visible = false;
						};
						resize_panels();
						full_repaint();
						p.timer_onKey = window.SetTimeout(function () {
								p.timer_onKey && window.ClearTimeout(p.timer_onKey);
								p.timer_onKey = false;
							}, 300);
					};
				};
				if (vkey == 48) { // CTRL + 0
					g_forced_percent = 0;
					window.SetProperty("SYSTEM.dpi (0 = Default)", g_forced_percent);
					g_dpi = (g_forced_percent == 0 ? g_dpi_percent : g_forced_percent);
					//
					adjustMetrics(0);
					//
					resize_panels();
					full_repaint();
				};
				if (vkey == 89) { // CTRL + Y
					fb.RunMainMenuCommand("Edit/Redo");
				};
				if (vkey == 90) { // CTRL + Z
					fb.RunMainMenuCommand("Edit/Undo");
				};
				break;
			};
		};
	};
};

function on_char(code) {

	if (p.playlistManager.inputboxID >= 0) {
		p.playlistManager.inputbox.on_char(code);
	} else {
		// Incremental search, jssp semantics: substring match, live as you type.
		if (p.list.count > 0) {
			incremental_char(code);
		};
	};
};

//=================================================// Playback Callbacks

function on_playback_starting(cmd, is_paused) {
	// called only on user action (cmd)
};

// Host callback (docs\Callbacks.js) this panel never implemented before. jssp.js (JScript
// Panel 3 reference) relies on it exclusively for "scroll the now-playing/located track into
// view" - its own on_playback_new_track never touches focus or scroll at all (see
// on_playlist_item_ensure_visible -> on_item_focus_change in jssp.js). We still also drive
// the scroll manually from on_playback_new_track below (belt and suspenders - unlike jssp we
// don't yet know for certain this JSplitter branch fires this callback on every track change,
// only that it exists), but wiring it up means the host's own native "locate"/"show now
// playing" commands - and anything else that calls this - work here too, not just our own
// header-bar menu entry.
//
// Turns out the host fires this for ANY item that needs to be visible, not just playback -
// plain row clicks trigger it too (via the focus change the click causes). scrollToTrack()
// always centres, so wiring it up unconditionally made every click snap the view to the
// clicked row - not wanted. isTrackVisible() gate below makes this a real "ensure visible":
// no-op when the item is already on screen, exactly like the term implies, only actually
// scrolling (and only then centring) when it's genuinely off-screen.
function on_playlist_item_ensure_visible(playlistIndex, playlistItemIndex) {
	if (playlistIndex != p.list.playlist)
		return;
	if (p.list.isTrackVisible(playlistItemIndex))
		return;
	p.list.scrollToTrack(playlistItemIndex);
	p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
	full_repaint();
};

function on_playback_new_track(metadb) {
	// update historic playlist
	if (cPlaylistManager.enableHistoricPlaylist) {
		addToHistoricPlaylist(metadb);
	};

	// update statistics (if changing track without stop action <=> continous play)
	update_statistics();

	// update g_metadb and g_track_type because of on_playback_time uses
	//on_item_focus_change();
	g_metadb = metadb;
	if (g_metadb) {
		g_path = tf_path.EvalWithMetadb(g_metadb);
		g_track_type = TrackType(g_path);
	};

	if (properties.showwallpaper) {
		p.wallpaperImg = setWallpaperImg(properties.wallpaperpath, metadb);
	};

	// playback takes the background back over from the focus cursor
	g_focus_bg_key = null;
	g_focus_bg_timer && window.ClearTimeout(g_focus_bg_timer);
	g_focus_bg_timer = false;

	// Accent is produced by the tabs panel only; update_album_accent() is a no-op call site
	// kept so this reads the same as the pre-refactor flow.
	update_album_accent(null, metadb);

	// Follow playback, but only within the playlist already on screen: scrolls the new track
	// into view (no keyboard-cursor steal) when it's playing from the playlist the user is
	// currently looking at, and is a no-op when it's playing from a different playlist - so
	// working in another playlist here never gets interrupted just because playback moved on
	// somewhere else. p.list.showNowPlaying(explicit) only switches the panel's displayed
	// playlist for a real "take me there" action (explicit === true); called with no argument
	// here it stays put. See its header comment in WSHplaylist.js and WSHheaderbar.js's
	// "Show Now Playing Track" menu entry, which passes explicit=true to force the jump.
	p.list.showNowPlaying();
	p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);

	full_repaint();
};

//=================================================// Inter-panel messaging (2.2)
// This panel is now an accent CONSUMER. The tabs panel is the producer; it answers
// SHARED_ALBUM_ACCENT.REQUEST, and every UPDATE it broadcasts is simply adopted here.
function on_notify_data(name, info) {
	// Shared SETTINGS panel registry (see playlist_panel.js, immediately after
	// its include() block, for SETTINGS_PANEL_ID/LABEL and the getPlaylistSettings/
	// applyPlaylistSetting adapters this wires to). Checked first, same as every
	// other rivage panel that provides settings.
	if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getPlaylistSettings)) return;
	if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyPlaylistSetting)) return;
	// The playlist consumes the Global playback-statistics source but never provides it.
	if (SettingsRegistry.consume(name, info, "global", PlaybackStatsSource.applySetting)) return;
	if (PlaybackStatsSource.onNotifyData(name, info, false)) return;

	switch (name) {
	case SHARED_ALBUM_ACCENT_UPDATE:
		if (SharedAccentProtocol.isColour(info) && properties.albumAccentEnabled) {
			AlbumAccent.receive(info);
			// Forced, not full_repaint(): full_repaint() uses a queued 40ms batching
			// timer before issuing a non-forced window.Repaint().
			// This event is rare (once per track/focus change), so paying for an immediate,
			// forced repaint here removes that extra latency entirely.
			window.Repaint(true);
		};
		break;
	};
};

function on_playback_stop(reason) { // reason: (integer, begin with 0): user, eof, starting_another
	switch (reason) {
	case 0: // user stop
	case 1: // eof (e.g. end of playlist)
		// playback stopped: accent + background follow the focused item
		// (the wallpaper is intentionally NOT cleared here - update_accent_from_focus
		// replaces it with the focused track's artwork)
		update_accent_from_focus();
		// update statistics
		update_statistics();
		full_repaint();
		break;
	case 2: // starting_another (only called on user action, i.e. click on next button)
		break;
	};

};

function on_playback_pause(state) {
	if (p.list.nowplaying_y + cTrack.height > p.list.y && p.list.nowplaying_y < p.list.y + p.list.h) {
		window.RepaintRect(p.list.x, p.list.nowplaying_y, p.list.w, cTrack.height);
	};
};

function on_playback_seek(time) {};

function on_playback_time(time) {

	g_seconds = time;

	// -------------------------------------------------------------------------------/
	// WSH Statistics TAGs Engine (v0.6 by Br3tt)
	// Update file after 50% time played with TAG update on track's ending:
	// <FIRST_PLAYED>, <LAST_PLAYED>, <PLAY_COUNTER> (<PLAY_COUNT> replaced if found)
	// -------------------------------------------------------------------------------/
	var bool;
	var played_seconds = time;
	if (played_seconds <= 1)
		var total_seconds = tf_length_seconds.Eval();

	if (g_track_type < 2 && fb.IsMetadbInMediaLibrary(g_metadb)) {
		if (played_seconds <= 1) {
			wsh_time_elaps = Math.floor(played_seconds);
			if (total_seconds >= 10) {
				wsh_limit_stats = total_seconds - 5;
				wsh_delay_stats = Math.floor(total_seconds / 2);
			} else {
				wsh_limit_stats = total_seconds - 1;
				wsh_delay_stats = 2;
			};
			if (wsh_delay_stats < 0)
				wsh_delay_stats = 0;

		} else if (wsh_time_elaps > 0) {
			wsh_time_elaps++;
		};

		if (opt_stats && wsh_time_elaps >= wsh_delay_stats && played_seconds <= wsh_limit_stats) {
			wsh_time_elaps = 0;
			cStats.waiting_for_writing = true;
			cStats.handle = g_metadb;
			// report to console
			console.log("--- WSH Statistics ---");
			console.log("--- Queued for track: \"" + cStats.handle.Path + "\"");
		};
	};


	if (p.list.nowplaying_y + cTrack.height > p.list.y && p.list.nowplaying_y < p.list.y + p.list.h) {
		// Only the playing row contains per-second dynamic state (play glyph,
		// remaining time/dynamic bitrate). Repainting the whole playlist here was
		// the largest steady-state paint cost while music was playing.
		window.RepaintRect(p.list.x, p.list.nowplaying_y, p.list.w, cTrack.height);
	};
};

function on_playback_order_changed(new_order_index) {};

function on_focus(is_focused) {
	if (p.playlistManager.inputboxID >= 0) {
		p.playlistManager.inputbox.on_focus(is_focused);
	};
	if (is_focused) {
		plman.SetActivePlaylistContext();
		g_selHolder.SetPlaylistSelectionTracking();
	} else {
		p.playlistManager.inputboxID = -1;
		full_repaint();
	}
};

//=================================================// Colour + Font + Images Callbacks
function on_font_changed() {
	get_font();
	full_repaint();
};

function on_colours_changed() {
	get_colors();
	p.topBar.setButtons();
	p.headerBar.setButtons();
	if (p.list) {
		if (p.list.totalRows > p.list.totalRowVisible) {
			p.scrollbar.setButtons();
			p.scrollbar.setCursorButton();
		};
		p.list.setItemColors();
	};
	p.playlistManager.setColors();
	p.playlistManager.setButtons();
	p.playlistManager.refresh("", false, false, false);
	full_repaint();
};

function get_font() {
	var font_error = false;

	if (g_instancetype == 0) {
		g_font = window.GetFontCUI(FontTypeCUI.items);
		g_font_headers = window.GetFontCUI(FontTypeCUI.labels);
	} else if (g_instancetype == 1) {
		g_font = window.GetFontDUI(FontTypeDUI.playlists);
		g_font_headers = window.GetFontDUI(FontTypeDUI.tabs);
	};

	// tweak to fix a problem with WSH Panel Mod 1.5.6 and lower version on Font object Name property
	try {
		g_fname = g_font.Name;
		g_fsize = g_font.Size;
		g_fstyle = g_font.Style;
	} catch (e) {
		console.log("WSH report: Unable to use your default font. Using Segoe UI instead.");
		g_fname = "segoe ui";
		g_fsize = 12;
		g_fstyle = 0;
		font_error = true;
	};

	g_dpi_percent = Math.floor(g_fsize / 12 * 100);
	g_forced_percent = window.GetProperty("SYSTEM.dpi (0 = Default)", 0);
	g_dpi = (g_forced_percent == 0 ? g_dpi_percent : g_forced_percent);

	g_z2 = zoom(2, g_dpi);
	g_z3 = zoom(3, g_dpi);
	g_z4 = zoom(4, g_dpi);
	g_z5 = zoom(5, g_dpi);
	g_z6 = zoom(6, g_dpi);
	g_z8 = zoom(8, g_dpi);
	g_z10 = zoom(10, g_dpi);
	g_z16 = zoom(16, g_dpi);

	if (g_forced_percent) {
		g_fsize = Math.ceil(zoom(g_fsize, g_forced_percent));
		g_font = gdi_font(g_fname, g_fsize, g_fstyle);
	} else if (font_error) {
		g_font = gdi_font(g_fname, g_fsize, g_fstyle);
	};

	g_font_playicon = gdi_font("wingdings 3", Math.floor(zoom(17, g_dpi)), 0);
	g_font_pauseicon = gdi_font("wingdings", Math.floor(zoom(17, g_dpi)), 0);
	g_font_checkbox = gdi_font("wingdings 2", Math.floor(zoom(18, g_dpi)), 0);
	g_font_queue_idx = gdi_font("tahoma", Math.floor(zoom(11, g_dpi)), 1);

	if (g_font_guifx_found) {
		g_font_rating = gdi_font("guifx v2 transports", Math.floor(zoom(17, g_dpi)), 0);
		g_font_mood = gdi_font("guifx v2 transports", Math.floor(zoom(16, g_dpi)), 0);
	} else {
		g_font_rating = gdi_font("wingdings 2", Math.floor(zoom(19, g_dpi)), 0);
		g_font_mood = gdi_font("wingdings 2", Math.floor(zoom(24, g_dpi)), 1);
	};
	g_font_wd1 = gdi_font("wingdings", Math.floor(zoom(19, g_dpi)), 0);
	g_font_wd2 = gdi_font("wingdings 2", Math.floor(zoom(19, g_dpi)), 0);
	g_font_wd3 = gdi_font("wingdings 3", Math.floor(zoom(19, g_dpi)), 0);
	g_font_wd3_headerBar = gdi_font("wingdings 3", Math.floor(zoom(12, g_dpi)), 0);
	g_font_wd3_scrollBar = gdi_font("wingdings 3", Math.floor(zoom(10, g_dpi)), 0);

	// ----------------------------------------------------------------- jssp font system (2.5)
	// One family for everything, with independent per-element sizes, all DPI-scaled.
	// g_fsize is left alone because g_dpi_percent is derived from it.
	var ui_name = g_fname;
	if (properties.fontName && utils.CheckFont(properties.fontName))
		ui_name = properties.fontName;
	g_uiFontName = ui_name;

	g_font_row_size = Math.max(7, Math.floor(zoom(clamp_int(properties.fontRowSize, 7, 30), g_dpi)));
	g_font_ui_size = Math.max(7, Math.floor(zoom(clamp_int(properties.fontUiSize, 7, 24), g_dpi)));
	g_font_header_title_size = Math.max(8, Math.floor(zoom(clamp_int(properties.fontHeaderTitleSize, 8, 40), g_dpi)));
	g_font_header_detail_size = Math.max(7, Math.floor(zoom(clamp_int(properties.fontHeaderDetailSize, 7, 30), g_dpi)));
	g_font_header_footer_size = Math.max(7, Math.floor(zoom(clamp_int(properties.fontHeaderFooterSize, 7, 30), g_dpi)));
	g_font_icon_size = Math.max(8, Math.floor(zoom(clamp_int(properties.fontIconSize, 8, 24), g_dpi)));
	g_font_state_icon_size = Math.max(9, Math.floor(zoom(clamp_int(properties.fontStateIconSize, 9, 30), g_dpi)));

	// row text
	g_font = gdi_font(ui_name, g_font_row_size, 0);
	g_font_bold = gdi_font(ui_name, g_font_row_size, 1);
	g_font_small = gdi_font(ui_name, Math.max(7, g_font_row_size - 1), 0);
	// ui chrome (top bar, column header, playlist manager, status)
	g_font_ui = gdi_font(ui_name, g_font_ui_size, 0);
	g_font_ui_bold = gdi_font(ui_name, g_font_ui_size, 1);
	// group headers
	g_font_group1 = gdi_font(ui_name, g_font_header_title_size, 1);
	g_font_group1_bold = gdi_font(ui_name, g_font_header_title_size, 1);
	g_font_group2 = gdi_font(ui_name, g_font_header_detail_size, 0);
	g_font_group_footer = gdi_font(ui_name, g_font_header_footer_size, 0);
	// icons
	g_font_icon = gdi_font(ICONS.fontName, g_font_icon_size, 0);
	g_font_icon_big = gdi_font(ICONS.fontName, g_font_state_icon_size, 0);

	// When a real icon font is present, the rating/loved/state glyphs come from it.
	if (ICONS.available()) {
		g_font_rating = g_font_icon;
		g_font_mood = g_font_icon;
	};
};

function read_playlist_colour(prop, fallback) {
	var value = window.GetProperty(prop, fallback);
	if (typeof value == "number" && isFinite(value) && Math.floor(value) === value) return value;
	var parts = String(value).split("-");
	if (parts.length != 3) return fallback;
	var r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
	if (!isFinite(r) || !isFinite(g) || !isFinite(b) ||
		r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return fallback;
	return RGB(Math.round(r), Math.round(g), Math.round(b));
};

function serialize_playlist_colour(value) {
	value = Number(value);
	if (!isFinite(value) || Math.floor(value) !== value) throw new Error("Invalid playlist colour");
	return getRed(value) + "-" + getGreen(value) + "-" + getBlue(value);
};

function get_colors() {
	// get some system colors
	g_syscolor_window_bg = utils.GetSysColour(COLOR_WINDOW);
	g_syscolor_highlight = utils.GetSysColour(COLOR_HIGHLIGHT);
	g_syscolor_button_bg = utils.GetSysColour(COLOR_BTNFACE);
	g_syscolor_button_txt = utils.GetSysColour(COLOR_BTNTEXT);

	g_color_normal_txt = read_playlist_colour("SYSTEM.COLOR TEXT NORMAL", RGB(180, 180, 180));
	g_color_selected_txt = read_playlist_colour("SYSTEM.COLOR TEXT SELECTED", RGB(200, 210, 255));
	g_color_normal_bg = read_playlist_colour("SYSTEM.COLOR BACKGROUND NORMAL", RGB(25, 25, 35));
	g_color_selected_bg = read_playlist_colour("SYSTEM.COLOR BACKGROUND SELECTED", RGB(130, 150, 255));
	g_color_highlight = read_playlist_colour("SYSTEM.COLOR HIGHLIGHT", RGB(255, 175, 50));

	if (!properties.enableCustomColors) {
		if (g_instancetype == 0) {
			g_color_normal_txt = window.GetColourCUI(ColorTypeCUI.text);
			g_color_selected_txt = window.GetColourCUI(ColorTypeCUI.selection_text);
			g_color_normal_bg = window.GetColourCUI(ColorTypeCUI.background);
			g_color_selected_bg = window.GetColourCUI(ColorTypeCUI.selection_background);
			g_color_highlight = window.GetColourCUI(ColorTypeCUI.active_item_frame);
		} else if (g_instancetype == 1) {
			g_color_normal_txt = window.GetColourDUI(ColorTypeDUI.text);
			g_color_selected_txt = window.GetColourDUI(ColorTypeDUI.selection);
			g_color_normal_bg = window.GetColourDUI(ColorTypeDUI.background);
			g_color_selected_bg = g_color_selected_txt;
			g_color_highlight = window.GetColourDUI(ColorTypeDUI.highlight);
		};
	};

	if (typeof applyRivagePlaylistTheme == "function") applyRivagePlaylistTheme();
	get_images();

	if (!g_first_launch && p.playlistManager) p.playlistManager.setColors();
};

// Placeholder art (nocover/noartist) is looked up by base name only - the
// images folder has held these as .png in the past and .webp currently, and
// may hold some other format later. Every likely extension is tried in turn
// and the first one that actually loads (gdi.Image() returns non-null) wins,
// so swapping the file's format never requires a code change.
//
// The candidate list is declared INSIDE the function, not as a module-level
// var above it - system_init() runs synchronously near the top of this file
// (see line ~350) and calls straight down into get_images() before the
// interpreter's normal top-to-bottom pass would ever reach a module-level
// "var IMAGE_EXT_CANDIDATES = [...]" placed here. A module-level var's
// declaration is hoisted but its assignment isn't, so that version was still
// undefined the first time this function ran. A local const has no such
// ordering dependency.
function load_image_any_format(base_path_no_ext) {
	var extensions = ["webp", "png", "jpg", "jpeg", "bmp", "gif"];
	for (var i = 0; i < extensions.length; i++) {
		var img = gdi.Image(base_path_no_ext + "." + extensions[i]);
		if (img) return img;
	}
	return null;
};

function get_images() {
	var gb;
	var gui_font = gdi_font("guifx v2 transports", 15, 0);

	images.glass_reflect = draw_glass_reflect(400, 400);

	images.sortdirection = gdi.CreateImage(7, 5);
	gb = images.sortdirection.GetGraphics();
	gb.FillSolidRect(1, 1, 5, 1, g_color_normal_txt);
	gb.FillSolidRect(2, 2, 3, 1, g_color_normal_txt);
	gb.FillSolidRect(3, 3, 1, 1, g_color_normal_txt);
	images.sortdirection.ReleaseGraphics(gb);

	images.nocover = load_image_any_format(images.path + "nocover");
	images.noartist = load_image_any_format(images.path + "noartist");
	images.stream = gdi.Image(images.path + "stream.png");
	images.loading = gdi.Image(images.path + "load.png");
	images.logo = gdi.Image(images.path + "logo.png");
	images.beam = draw_beam_image();
};

// ===================================================== // Wallpaper

function setWallpaperImg(path, metadb) {

	var fmt_path = fb.TitleFormat(path).Eval(true);
	var fmt_path_arr = utils.Glob(fmt_path);
	if (fmt_path_arr.length > 0) {
		var final_path = fmt_path_arr[0];
	} else {
		var final_path = null;
	};

	if (metadb && properties.wallpapermode > -1) {
		var tmp_img = utils.GetAlbumArtV2(metadb, properties.wallpapermode);
	} else {
		if (final_path) {
			tmp_img = gdi.Image(final_path);
		} else {
			tmp_img = null;
		};
	};
	if (!tmp_img) {
		if (final_path) {
			tmp_img = gdi.Image(final_path);
		} else {
			tmp_img = null;
		};
	};

	// No accent derivation here - the tabs panel extracts independently and broadcasts the
	// result. This wallpaper bitmap is used for display only.

	p.wallpaperImg = null;
	var img = FormatWallpaper(tmp_img, ww, wh, 2, 0, 0, "", true);
	return img;
};

function draw_beam_image() {
	var sbeam = gdi.CreateImage(500, 128);
	// Get graphics interface like "gr" in on_paint
	var gb = sbeam.GetGraphics();
	gb.FillEllipse(-250, 50, 1000, 640, g_color_highlight & 0x60ffffff);
	sbeam.ReleaseGraphics(gb);

	var beamA = sbeam.Resize(500 / 50, 128 / 50, 2);
	var beamB = beamA.Resize(500, 128, 2);
	return beamB;
};

function draw_blurred_image(image, ix, iy, iw, ih, bx, by, bw, bh, blur_value, overlay_color) {
	var blurValue = blur_value;
	var imgA = image.Resize(iw * blurValue / 100, ih * blurValue / 100, 2);
	var imgB = imgA.Resize(iw, ih, 2);

	var bbox = gdi.CreateImage(bw, bh);
	// Get graphics interface like "gr" in on_paint
	var gb = bbox.GetGraphics();
	var offset = 90 - blurValue;
	gb.DrawImage(imgB, 0 - offset, 0 - (ih - bh) - offset, iw + offset * 2, ih + offset * 2, 0, 0, imgB.Width, imgB.Height, 0, 255);
	bbox.ReleaseGraphics(gb);

	var newImg = gdi.CreateImage(iw, ih);
	var gb = newImg.GetGraphics();

	if (ix != bx || iy != by || iw != bw || ih != bh) {
		gb.DrawImage(image, ix, iy, iw, ih, 0, 0, image.Width, image.Height, 0, 255);
		gb.FillSolidRect(bx, by, bw, bh, 0xffffffff);
	};
	gb.DrawImage(bbox, bx, by, bw, bh, 0, 0, bbox.Width, bbox.Height, 0, 255);

	// overlay
	if (overlay_color != null) {
		gb.FillSolidRect(bx, by, bw, bh, overlay_color);
	};

	// top border of blur area
	if (ix != bx || iy != by || iw != bw || ih != bh) {
		gb.FillSolidRect(bx, by, bw, 1, 0x22ffffff);
		gb.FillSolidRect(bx, by - 1, bw, 1, 0x22000000);
	};
	newImg.ReleaseGraphics(gb);

	return newImg;
};

function FormatWallpaper(image, iw, ih, interpolation_mode, display_mode, angle, txt, rawBitmap) {
	if (!image || !iw || !ih)
		return image;
	var i,
	j;

	var panel_ratio = iw / ih;
	wpp_img_info.ratio = image.Width / image.Height;
	wpp_img_info.orient = 0;

	if (wpp_img_info.ratio > panel_ratio) {
		wpp_img_info.orient = 1;
		// 1/3 : default image is in landscape mode
		switch (display_mode) {
		case 0: // Filling
			//wpp_img_info.w = iw * wpp_img_info.ratio / panel_ratio;
			wpp_img_info.w = ih * wpp_img_info.ratio;
			wpp_img_info.h = ih;
			wpp_img_info.cut = wpp_img_info.w - iw;
			wpp_img_info.x = 0 - (wpp_img_info.cut / 2);
			wpp_img_info.y = 0;
			break;
		case 1: // Adjust
			wpp_img_info.w = iw;
			wpp_img_info.h = ih / wpp_img_info.ratio * panel_ratio;
			wpp_img_info.cut = ih - wpp_img_info.h;
			wpp_img_info.x = 0;
			wpp_img_info.y = wpp_img_info.cut / 2;
			break;
		case 2: // Stretch
			wpp_img_info.w = iw;
			wpp_img_info.h = ih;
			wpp_img_info.cut = 0;
			wpp_img_info.x = 0;
			wpp_img_info.y = 0;
			break;
		};
	} else if (wpp_img_info.ratio < panel_ratio) {
		wpp_img_info.orient = 2;
		// 2/3 : default image is in portrait mode
		switch (display_mode) {
		case 0: // Filling
			wpp_img_info.w = iw;
			//wpp_img_info.h = ih / wpp_img_info.ratio * panel_ratio;
			wpp_img_info.h = iw / wpp_img_info.ratio;
			wpp_img_info.cut = wpp_img_info.h - ih;
			wpp_img_info.x = 0;
			wpp_img_info.y = 0 - (wpp_img_info.cut / 4);
			break;
		case 1: // Adjust
			wpp_img_info.h = ih;
			wpp_img_info.w = iw * wpp_img_info.ratio / panel_ratio;
			wpp_img_info.cut = iw - wpp_img_info.w;
			wpp_img_info.y = 0;
			wpp_img_info.x = wpp_img_info.cut / 2;
			break;
		case 2: // Stretch
			wpp_img_info.w = iw;
			wpp_img_info.h = ih;
			wpp_img_info.cut = 0;
			wpp_img_info.x = 0;
			wpp_img_info.y = 0;
			break;
		};
	} else {
		// 3/3 : default image is a square picture, ratio = 1
		wpp_img_info.w = iw;
		wpp_img_info.h = ih;
		wpp_img_info.cut = 0;
		wpp_img_info.x = 0;
		wpp_img_info.y = 0;
	};

	var tmp_img = gdi.CreateImage(iw, ih);
	var gp = tmp_img.GetGraphics();
	gp.SetInterpolationMode(interpolation_mode);
	gp.DrawImage(image, wpp_img_info.x, wpp_img_info.y, wpp_img_info.w, wpp_img_info.h, 0, 0, image.Width, image.Height, angle, 255);
	tmp_img.ReleaseGraphics(gp);

	// blur it!
	if (properties.wallpaperblurred) {
		var blur_factor = properties.wallpaperblurvalue; // [1-90]
		tmp_img = draw_blurred_image(tmp_img, 0, 0, tmp_img.Width, tmp_img.Height, 0, 0, tmp_img.Width, tmp_img.Height, blur_factor, 0x00ffffff);
	};

	if (rawBitmap) {
		return tmp_img.CreateRawBitmap();
	} else {
		return tmp_img;
	};
};

//=================================================// Queue Playlist features
function on_playback_queue_changed(origin) {
	// Visible rows cache FindPlaybackQueueItemIndex(), which is otherwise a host
	// query on every row on every paint. Invalidate only when the queue changes.
	if (p.list && p.list.items) {
		for (var i = 0; i < p.list.items.length; i++)
			p.list.items[i].queue_idx = undefined;
	};
	full_repaint();
};

//=================================================// Drag'n'Drop Callbacks
var g_dragndrop_hover_playlistManager = false;

function on_drag_enter() {
	g_dragndrop_status = true;
};

function on_drag_leave() {
	g_dragndrop_status = false;
	g_dragndrop_hover_playlistManager = false;
	g_dragndrop_trackId = -1;
	g_dragndrop_rowId = -1;
	g_dragndrop_targetPlaylistId = -1;
	p.list.buttonclicked = false;
	cScrollBar.timerID1 && window.ClearInterval(cScrollBar.timerID1);
	cScrollBar.timerID1 = false;
};

function on_drag_over(action, x, y, mask) {
	g_dragndrop_hover_playlistManager = false;
	if (y < p.list.y) {
		action.Effect = 0;
	} else if (cPlaylistManager.visible && p.playlistManager.isHoverObject(x, y)) {
		g_dragndrop_hover_playlistManager = true;
		p.playlistManager.check("drag_over", x, y);
		if (g_dragndrop_targetPlaylistId == -1) {
			action.Effect = p.playlistManager.ishoverHeader ? 1 : 0;
		} else if (plman.IsPlaylistLocked(g_dragndrop_targetPlaylistId)) {
			action.Effect = 0;
		} else {
			action.Effect = 1;
		}
	} else {
		g_dragndrop_trackId = -1;
		g_dragndrop_rowId = -1;
		g_dragndrop_bottom = false;
		p.list.check("drag_over", x, y);
		action.Effect = plman.ActivePlaylist > -1 && plman.IsPlaylistLocked(plman.ActivePlaylist) ? 0 : 1;
	}
	full_repaint();
};

function on_drag_drop(action, x, y, mask) {
	if (y < p.list.y) {
		action.Effect = 0;
	} else if (cPlaylistManager.visible && p.playlistManager.isHoverObject(x, y)) {
		if (g_dragndrop_targetPlaylistId == -1) {
			if (p.playlistManager.ishoverHeader) {
				var count = plman.PlaylistCount;
				plman.CreatePlaylist(count, "Dropped Items");
				action.Playlist = count;
				action.Base = 0;
				action.ToSelect = true;
				action.Effect = 1;
			} else {
				action.Effect = 0;
			}
		} else if (plman.IsPlaylistLocked(g_dragndrop_targetPlaylistId)) {
			action.Effect = 0;
		} else {
			plman.ClearPlaylistSelection(g_dragndrop_targetPlaylistId);
			plman.UndoBackup(g_dragndrop_targetPlaylistId);
			action.Playlist = g_dragndrop_targetPlaylistId;
			action.Base = plman.PlaylistItemCount(g_dragndrop_targetPlaylistId);
			action.ToSelect = false;
			action.Effect = 1;
		}
	} else {
		if (plman.ActivePlaylist > -1 && plman.IsPlaylistLocked(plman.ActivePlaylist)) {
			action.Effect = 0;
		} else if (plman.PlaylistCount == 0 || plman.ActivePlaylist == -1) {
			var count = plman.PlaylistCount;
			plman.CreatePlaylist(count, "Dropped Items");
			action.Playlist = count;
			action.Base = 0;
			action.ToSelect = true;
			action.Effect = 1;
		} else {
			plman.ClearPlaylistSelection(plman.ActivePlaylist);
			plman.UndoBackup(plman.ActivePlaylist);
			action.Playlist = plman.ActivePlaylist;
			action.Base = g_dragndrop_bottom ? plman.PlaylistItemCount(plman.ActivePlaylist) : g_dragndrop_trackId;
			action.ToSelect = true;
			action.Effect = 1;
		}

	}
	g_dragndrop_hover_playlistManager = false;
	g_dragndrop_targetPlaylistId = -1;
	g_dragndrop_trackId = -1;
	g_dragndrop_rowId = -1;
	g_dragndrop_bottom = false;
	full_repaint();
};

function on_script_unload() {
	// Everything here is wrapped: an exception thrown while foobar2000 is shutting down
	// can abort the host's own teardown, which is one way panel settings fail to save.
	try {
		g_timer1 && window.ClearTimeout(g_timer1);
		g_timer1 = false;
	} catch (e) {};
	try {
		g_focus_bg_timer && window.ClearTimeout(g_focus_bg_timer);
		g_focus_bg_timer = false;
	} catch (e) {};
	try {
		g_incremental_search_timer && window.ClearTimeout(g_incremental_search_timer);
		g_incremental_search_timer = false;
	} catch (e) {};
	try {
		update_statistics();
	} catch (e) {
		console.log("JSPlaylist: update_statistics failed on unload -> " + e);
	};
};
