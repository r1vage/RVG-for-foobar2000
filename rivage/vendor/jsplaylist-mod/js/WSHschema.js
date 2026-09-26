// Settings mirrored into the shared SETTINGS registry by playlist_panel.js.
// Row ids are global keys and must remain unique across all sections.

function sset(prop, key, value, after) {
	properties[key] = value;
	window.SetProperty(prop, value);
	if (after)
		after();
	full_repaint();
};

function settings_schema() {

	var relayout = function () {
		resize_panels();
	};
	// Order matters. Rebuilding the group structure FIRST means resize_panels() (which
	// re-lays out the visible items) always sees a groups array that agrees with
	// totalRows. Doing it the other way round crashed setItems on a stale group id.
	var rebuild = function () {
		g_image_cache = new image_cache;
		cover.resized = true;
		update_playlist(properties.collapseGroupsByDefault);
		resize_panels();
		p.list.setItems(false);
		p.scrollbar && p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
	};
	var refont = function () {
		get_font();
		g_image_cache = new image_cache;
		cover.resized = true;
		update_playlist(properties.collapseGroupsByDefault);
		resize_panels();
		p.list.setItems(false);
		p.scrollbar && p.scrollbar.setCursor(p.list.totalRowVisible, p.list.totalRows, p.list.offset);
	};
	var recolour = function () {
		get_colors();
		p.list.setItemColors();
		p.playlistManager.setColors();
	};

	// current group-by preset, edited by the Grouping section
	var gi = function () {
		return clamp_int(cGroup.pattern_idx, 0, Math.max(0, p.list.groupby.length - 1));
	};
	var gset = function (field, value) {
		p.list.groupby[gi()][field] = value;
		p.list.saveGroupBy();
		// re-derive cGroup.* (heights, extra rows, cover flag) from the edited preset
		p.list.updateGroupByPattern(gi());
		rebuild();
	};

	// current column, edited by the Columns section
	if (typeof g_drawer_column != "number")
		g_drawer_column = 0;
	var ci = function () {
		return clamp_int(g_drawer_column, 0, Math.max(0, p.headerBar.columns.length - 1));
	};
	var col = function () {
		return p.headerBar.columns[ci()];
	};
	var cset = function (field, value) {
		col()[field] = value;
		p.headerBar.saveColumns();
		p.headerBar.calculateColumns();
		full_repaint();
	};

	return [

	{ section: "Layout", items: [
		{ id: "layout.infoPanel", type: "toggle", label: "Show information panel", get: function () { return cTopBar.visible; },
			set: function (v) { cTopBar.visible = v; window.SetProperty("SYSTEM.TopBar.Visible", v); relayout(); full_repaint(); } },
		{ id: "layout.columnHeader", type: "toggle", label: "Show column header", get: function () { return cHeaderBar.locked; },
			set: function (v) { cHeaderBar.locked = v; window.SetProperty("SYSTEM.HeaderBar.Locked", v); if (!v) p.headerBar.visible = false; relayout(); full_repaint(); } },
		{ id: "layout.playlistManager", type: "toggle", label: "Show playlist manager", get: function () { return cPlaylistManager.visible; },
			set: function (v) { setPlaylistManagerVisible(v); } },
		{ id: "layout.scrollbar", type: "toggle", label: "Show scrollbar", get: function () { return properties.showscrollbar; },
			set: function (v) { sset("CUSTOM Show Scrollbar", "showscrollbar", v, relayout); } },
		{ id: "layout.mediaLibraryPlaylist", type: "toggle", label: "Maintain Media Library playlist", get: function () { return cPlaylistManager.mediaLibraryPlaylist; },
			set: function (v) { cPlaylistManager.mediaLibraryPlaylist = v; window.SetProperty("SYSTEM.Media Library Playlist", v);
				if (v) { checkMediaLibrayPlaylist(); } else if (plman.GetPlaylistName(0) == "Media Library") { plman.RemovePlaylistSwitch(0); }; full_repaint(); } },
		{ id: "layout.historyPlaylist", type: "toggle", label: "Maintain play-history playlist", get: function () { return cPlaylistManager.enableHistoricPlaylist; },
			set: function (v) { cPlaylistManager.enableHistoricPlaylist = v; window.SetProperty("CUSTOM Historic Playlist enabled", v);
				if (v) { addToHistoricPlaylist(null); } else { var ix = plman.FindPlaylist("Historic"); if (ix > -1) plman.RemovePlaylistSwitch(ix); }; full_repaint(); } }
	]},

	{ section: "Rows", items: [
		{ id: "rows.density", type: "choice", label: "Density",
			options: function () { return [{ label: "Compact", value: "compact" }, { label: "Normal", value: "normal" }, { label: "Spacious", value: "spacious" }]; },
			get: function () { return normalise_row_density(properties.rowDensity); },
			set: function (v) { set_row_density(v); } },
		{ id: "rows.twoLine", type: "toggle", label: "Two-line rows", get: function () { return cList.enableExtraLine; },
			set: function (v) { cList.enableExtraLine = v; window.SetProperty("SYSTEM.Enable Extra Line", v); rebuild(); } },
		{ id: "rows.lineGap", type: "number", label: "Gap between lines", min: 0, max: 20, get: function () { return properties.rowLineGap; },
			set: function (v) { sset("CUSTOM.Row Line Gap", "rowLineGap", v); },
			hidden: function () { return !cList.enableExtraLine; } },
		{ id: "rows.altShading", type: "toggle", label: "Alternating row shading", get: function () { return properties.oddevenrowshighlight; },
			set: function (v) { sset("CUSTOM Highlight Odd/Even Rows", "oddevenrowshighlight", v); } },
		{ id: "rows.smoothScrolling", type: "toggle", label: "Smooth scrolling", get: function () { return properties.smoothscrolling; },
			set: function (v) { sset("CUSTOM Enable Smooth Scrolling", "smoothscrolling", v); } },
		{ id: "rows.touchScrolling", type: "toggle", label: "Touch scrolling", get: function () { return properties.enableTouchControl; },
			set: function (v) { sset("SYSTEM.Enable Touch Scrolling", "enableTouchControl", v); } },
		{ id: "rows.doubleClickAction", type: "choice", label: "Double-click action",
			options: function () { return [{ label: "Play", value: "Play" }, { label: "Enqueue", value: "Add to playback queue" }]; },
			get: function () { return properties.defaultPlaylistItemAction == "Play" ? "Play" : "Add to playback queue"; },
			set: function (v) { sset("SYSTEM.Default Playlist Action", "defaultPlaylistItemAction", v); } }
	]},

	// Accent extraction belongs to the tabs producer; this schema only controls consumption.
	{ section: "Accent", items: [
		{ id: "accent.enabled", type: "toggle", label: "Use shared accent", get: function () { return properties.albumAccentEnabled; },
			set: function (v) { properties.albumAccentEnabled = v; window.SetProperty("CUSTOM.Album Accent Enabled", v); AlbumAccent.setEnabled(v); full_repaint(); } },
		{ id: "accent.strength", type: "number", label: "Accent strength (%)", min: 0, max: 400, step: 10, get: function () { return properties.accentStrength; },
			set: function (v) { sset("CUSTOM.Accent Strength Percent", "accentStrength", v); },
			hidden: function () { return !properties.albumAccentEnabled; } },
		{ id: "accent.rowHighlight", type: "toggle", label: "Highlight selected rows with accent", get: function () { return properties.uwpAccentHighlight; },
			set: function (v) { sset("CUSTOM.UWP Accent Row Highlight", "uwpAccentHighlight", v); } },
		{ id: "accent.currentColour", type: "info", label: "Current colour", get: function () {
			return "rgb(" + getRed(AlbumAccent.colour) + "," + getGreen(AlbumAccent.colour) + "," + getBlue(AlbumAccent.colour) + ")"; } },
	]},

	{ section: "Grouping", items: [
		{ id: "grouping.showHeaders", type: "toggle", label: "Show group headers", get: function () { return properties.showgroupheaders; },
			set: function (v) {
				// Headers are hidden by giving them zero height, which is what the toolbar
				// menu has always done. Setting the flag alone left them on screen.
				properties.showgroupheaders = v;
				window.SetProperty("*GROUP: Show Group Headers", v);
				cGroup.show = v;
				if (v) {
					cGroup.collapsed_height = cGroup.default_collapsed_height;
					cGroup.expanded_height = cGroup.default_expanded_height;
				} else {
					cGroup.collapsed_height = 0;
					cGroup.expanded_height = 0;
					// auto-collapse is meaningless with no groups
					properties.autocollapse = false;
					window.SetProperty("SYSTEM.Auto-Collapse", false);
				};
				rebuild();
			} },
		{ id: "grouping.groupBy", type: "choice", label: "Group by",
			options: function () { var o = []; for (var i = 0; i < p.list.groupby.length; i++) o.push({ label: p.list.groupby[i].label, value: i }); return o; },
			get: function () { return gi(); },
			set: function (v) {
				cGroup.pattern_idx = v;
				window.SetProperty("SYSTEM.Groups.Pattern Index", v);
				p.list.updateGroupByPattern(v);
				try { plman.SortByFormatV2(plman.ActivePlaylist, p.list.groupby[v].sortOrder, 1); } catch (e) {};
				rebuild();
			},
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.expandedHeight", type: "number", label: "Expanded height (rows)", min: 0, max: 4, get: function () { return parseInt(p.list.groupby[gi()].expandedHeight, 10) || 0; },
			set: function (v) { gset("expandedHeight", String(v)); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.collapsedHeight", type: "number", label: "Collapsed height (rows)", min: 0, max: 4, get: function () { return parseInt(p.list.groupby[gi()].collapsedHeight, 10) || 0; },
			set: function (v) { gset("collapsedHeight", String(v)); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerStyle", type: "choice", label: "Header style",
			options: function () { return [{ label: "Classic", value: 0 }, { label: "Inset card", value: 1 }]; },
			get: function () { return clamp_int(properties.groupHeaderStyle, 0, 1); },
			set: function (v) { sset("CUSTOM.Group Header Style", "groupHeaderStyle", clamp_int(v, 0, 1), rebuild); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.artRadius", type: "number", label: "Artwork corner radius", min: 0, max: 16, get: function () { return clamp_int(properties.groupHeaderArtRadius, 0, 16); },
			set: function (v) { sset("CUSTOM.Group Header Art Radius", "groupHeaderArtRadius", clamp_int(v, 0, 16), rebuild); },
			hidden: function () { return !properties.showgroupheaders || clamp_int(properties.groupHeaderStyle, 0, 1) != 1; } },
		{ id: "grouping.headerAccent", type: "toggle", label: "Header uses album accent", get: function () { return !!properties.groupHeaderAccent; },
			set: function (v) { sset("CUSTOM.Group Header Accent", "groupHeaderAccent", v); },
			hidden: function () { return !properties.showgroupheaders || !properties.albumAccentEnabled; } },
		{ id: "grouping.innerPadding", type: "number", label: "Inner padding", min: 0, max: 24, get: function () { return properties.groupHeaderPadding; },
			set: function (v) { sset("CUSTOM.Group Header Padding", "groupHeaderPadding", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.coverSize", type: "number", label: "Artwork size (%)", min: 40, max: 100, step: 5, get: function () { return properties.groupHeaderCoverPercent; },
			set: function (v) { sset("CUSTOM.Group Header Cover Percent", "groupHeaderCoverPercent", v, rebuild); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.lineGap", type: "number", label: "Line gap", min: -8, max: 24, get: function () { return properties.groupHeaderLineGap; },
			set: function (v) { sset("CUSTOM.Group Header Line Gap", "groupHeaderLineGap", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.footerLineAlpha", type: "number", label: "Footer line alpha", min: 0, max: 255, step: 5, get: function () { return properties.groupHeaderLineAlpha; },
			set: function (v) { sset("CUSTOM.Group Header Line Alpha", "groupHeaderLineAlpha", v, function () { p.list.setItemColors(); }); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.coverInHeader", type: "toggle", label: "Show artwork in group header", get: function () { return p.list.groupby[gi()].showCover != "0"; },
			set: function (v) { gset("showCover", v ? "1" : "0"); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.autoCollapse", type: "toggle", label: "Auto-collapse", get: function () { return p.list.groupby[gi()].autoCollapse != "0"; },
			set: function (v) { gset("autoCollapse", v ? "1" : "0"); properties.autocollapse = v; window.SetProperty("SYSTEM.Auto-Collapse", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.collapsedByDefault", type: "toggle", label: "Collapsed by default", get: function () { return p.list.groupby[gi()].collapseGroupsByDefault == "1"; },
			set: function (v) { gset("collapseGroupsByDefault", v ? "1" : "0"); properties.collapseGroupsByDefault = v; window.SetProperty("SYSTEM.Collapse Groups by default", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.presetName", type: "text", label: "Preset name", hint: "Name of this grouping preset", get: function () { return p.list.groupby[gi()].label; },
			set: function (v) { if (v) { gset("label", v); p.list.saveGroupBy(); }; },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.playlistFilter", type: "text", label: "Playlist filter", hint: "'*' = default pattern, 'null' = none", get: function () { return p.list.groupby[gi()].playlistFilter; },
			set: function (v) { if (v) gset("playlistFilter", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.pattern", type: "text", label: "Pattern", hint: "Group by title format", get: function () { return p.list.groupby[gi()].tf; },
			set: function (v) { if (v) gset("tf", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.sortOrder", type: "text", label: "Sort order", hint: "Sort title format ('null' = none)", get: function () { return p.list.groupby[gi()].sortOrder; },
			set: function (v) { if (v) gset("sortOrder", v); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerLine1Left", type: "text", label: "Header line 1 left", hint: "Title format", get: function () { return p.list.groupby[gi()].l1; },
			set: function (v) { if (v) gset("l1", v); }, hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerLine1Right", type: "text", label: "Header line 1 right", hint: "Title format", get: function () { return p.list.groupby[gi()].r1; },
			set: function (v) { if (v) gset("r1", v); }, hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerLine2Left", type: "text", label: "Header line 2 left", hint: "Title format", get: function () { return p.list.groupby[gi()].l2; },
			set: function (v) { if (v) gset("l2", v); }, hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerLine2Right", type: "text", label: "Header line 2 right", hint: "Title format", get: function () { return p.list.groupby[gi()].r2; },
			set: function (v) { if (v) gset("r2", v); }, hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerFooterLeft", type: "text", label: "Header footer left", hint: "Title format. Extra fields: %group_tracks%, %group_duration%, %group_index%, %group_total%",
			get: function () { return p.list.groupby[gi()].l3; },
			set: function (v) { if (v) gset("l3", v); }, hidden: function () { return !properties.showgroupheaders; } },
		{ id: "grouping.headerFooterRight", type: "text", label: "Header footer right", hint: "Title format. Extra fields: %group_tracks%, %group_duration%, %group_index%, %group_total%",
			get: function () { return p.list.groupby[gi()].r3; },
			set: function (v) { if (v) gset("r3", v); }, hidden: function () { return !properties.showgroupheaders; } }
	]},

	{ section: "Columns", items: [
		{ id: "columns.editing", type: "choice", label: "Editing",
			options: function () { var o = []; for (var i = 0; i < p.headerBar.columns.length; i++) o.push({ label: p.headerBar.columns[i].label || p.headerBar.columns[i].ref, value: i }); return o; },
			get: function () { return ci(); },
			set: function (v) { g_drawer_column = v; full_repaint(); } },
		{ id: "columns.visible", type: "toggle", label: "Visible", get: function () { return col().percent != 0; },
			set: function (v) { if ((col().percent != 0) !== !!v) p.headerBar.toggleColumn(ci()); full_repaint(); } },
		{ id: "columns.alignment", type: "choice", label: "Alignment",
			options: function () { return [{ label: "Left", value: 0 }, { label: "Centre", value: 1 }, { label: "Right", value: 2 }]; },
			get: function () { return col().align == 2 ? 2 : (col().align == 1 ? 1 : 0); },
			set: function (v) { col().align = v; col().DT_align = (v == 0 ? DT_LEFT : (v == 2 ? DT_RIGHT : DT_CENTER)); p.headerBar.saveColumns(); full_repaint(); } },
		{ id: "columns.label", type: "text", label: "Label", hint: "Column header text", get: function () { return col().label; },
			set: function (v) { if (v) cset("label", v); } },
		{ id: "columns.line1Format", type: "text", label: "Line 1 format", hint: "Title format ('null' = nothing)", get: function () { return col().tf; },
			set: function (v) { if (v) cset("tf", v); } },
		{ id: "columns.line2Format", type: "text", label: "Line 2 format", hint: "Title format ('null' = nothing)", get: function () { return col().tf2; },
			set: function (v) { if (v) cset("tf2", v); } },
		{ id: "columns.sortOrder", type: "text", label: "Sort order", hint: "Title format ('null' = nothing)", get: function () { return col().sortOrder; },
			set: function (v) { if (v) cset("sortOrder", v); } }
	]},

	{ section: "Loved", items: [
		{ id: "loved.syncLastfm", type: "toggle", label: "Sync to Last.fm", get: function () { return properties.lovedSyncLastfm; },
			set: function (v) { sset("CUSTOM.Loved Sync Last.fm", "lovedSyncLastfm", v); } },
		{ id: "loved.alwaysPink", type: "toggle", label: "Always pink hearts", get: function () { return properties.lovedAlwaysPink; },
			set: function (v) { sset("CUSTOM.Loved Always Pink", "lovedAlwaysPink", v); } },
		{ id: "loved.readingFrom", type: "info", label: "Reading from", get: function () {
			return foo_enhanced_playcount ? "foo_enhanced_playcount"
				 : (foo_lastfm_playcount_sync ? "foo_lastfm_playcount_sync"
				 : (foo_playcount ? "foo_playcount" : "none installed")); } }
	]},

	{ section: "Search", items: [
		{ id: "search.typeToSearch", type: "toggle", label: "Type to search", get: function () { return properties.directSearchEnabled; },
			set: function (v) { properties.directSearchEnabled = v; window.SetProperty("CUSTOM.Direct Search Enabled", v); if (!v) clear_incremental_search(); full_repaint(); } },
		{ id: "search.clearAfter", type: "number", label: "Close after (seconds, 0 = never)", min: 0, max: 30, get: function () { return properties.searchClearSeconds; },
			set: function (v) { sset("CUSTOM.Search Clear Seconds", "searchClearSeconds", v); } },
		{ id: "search.previewRows", type: "number", label: "Preview rows (0 = hidden)", min: 0, max: 12, get: function () { return properties.searchPreviewRows; },
			set: function (v) { sset("CUSTOM.Search Preview Rows", "searchPreviewRows", v); } },
		{ id: "search.keys", type: "info", label: "Keyboard shortcuts", get: function () { return "Up/Down, F3/Shift+F3: move; Tab: field; Enter: play; Esc: back"; } }
	]},

	{ section: "Fonts", items: [
		{ id: "fonts.family", type: "text", label: "Font family", hint: "Font family (blank = foobar2000 playlist font)", get: function () { return properties.fontName || "foobar2000 default"; },
			set: function (v) {
				v = String(v || "").replace(/^\s+|\s+$/g, "");
				if (v && !utils.CheckFont(v)) { console.log("JSPlaylist: font '" + v + "' is not installed"); return; };
				properties.fontName = v; window.SetProperty("CUSTOM.Font Name", v); refont(); } },
		{ id: "fonts.trackText", type: "number", label: "Track text size", min: 7, max: 30, get: function () { return properties.fontRowSize; },
			set: function (v) { sset("CUSTOM.Font Row Size", "fontRowSize", v, refont); } },
		{ id: "fonts.headerTitle", type: "number", label: "Header title size", min: 8, max: 40, get: function () { return properties.fontHeaderTitleSize; },
			set: function (v) { sset("CUSTOM.Font Header Title Size", "fontHeaderTitleSize", v, refont); } },
		{ id: "fonts.headerDetail", type: "number", label: "Header detail size", min: 7, max: 30, get: function () { return properties.fontHeaderDetailSize; },
			set: function (v) { sset("CUSTOM.Font Header Detail Size", "fontHeaderDetailSize", v, refont); } },
		{ id: "fonts.headerFooter", type: "number", label: "Header footer size", min: 7, max: 30, get: function () { return properties.fontHeaderFooterSize; },
			set: function (v) { sset("CUSTOM.Font Header Footer Size", "fontHeaderFooterSize", v, refont); },
			hidden: function () { return !properties.showgroupheaders; } },
		{ id: "fonts.uiText", type: "number", label: "UI text size", min: 7, max: 24, get: function () { return properties.fontUiSize; },
			set: function (v) { sset("CUSTOM.Font UI Size", "fontUiSize", v, refont); } },
		{ id: "fonts.iconSize", type: "number", label: "Heart or star size", min: 8, max: 24, get: function () { return properties.fontIconSize; },
			set: function (v) { sset("CUSTOM.Font Icon Size", "fontIconSize", v, refont); } },
		{ id: "fonts.stateIconSize", type: "number", label: "Playback icon size", min: 9, max: 30, get: function () { return properties.fontStateIconSize; },
			set: function (v) { sset("CUSTOM.Font State Icon Size", "fontStateIconSize", v, refont); } },
		{ id: "fonts.iconFont", type: "info", label: "Icon font", get: function () { return ICONS.describe(); } },
		{ id: "fonts.reset", type: "action", label: "Reset fonts", actionLabel: "Reset", run: function () {
			properties.fontName = ""; properties.fontRowSize = 11; properties.fontHeaderTitleSize = 15;
			properties.fontHeaderDetailSize = 11; properties.fontHeaderFooterSize = 11;
			properties.fontUiSize = 10; properties.fontIconSize = 15; properties.fontStateIconSize = 16;
			window.SetProperty("CUSTOM.Font Name", ""); window.SetProperty("CUSTOM.Font Row Size", 11);
			window.SetProperty("CUSTOM.Font Header Title Size", 15); window.SetProperty("CUSTOM.Font Header Detail Size", 11);
			window.SetProperty("CUSTOM.Font Header Footer Size", 11);
			window.SetProperty("CUSTOM.Font UI Size", 10); window.SetProperty("CUSTOM.Font Icon Size", 15);
			window.SetProperty("CUSTOM.Font State Icon Size", 16);
			refont(); } }
	]},

	{ section: "Colours", items: [
		{ id: "colours.enabled", type: "toggle", label: "Custom colours", get: function () { return properties.enableCustomColors; },
			set: function (v) { properties.enableCustomColors = v; window.SetProperty("SYSTEM.Enable Custom Colors", v); recolour(); full_repaint(); } },
		{ id: "colours.text", type: "colour", label: "Text", get: function () { return read_playlist_colour("SYSTEM.COLOR TEXT NORMAL", g_color_normal_txt); },
			set: function (v) { window.SetProperty("SYSTEM.COLOR TEXT NORMAL", serialize_playlist_colour(v)); recolour(); },
			hidden: function () { return !properties.enableCustomColors; } },
		{ id: "colours.background", type: "colour", label: "Background", get: function () { return read_playlist_colour("SYSTEM.COLOR BACKGROUND NORMAL", g_color_normal_bg); },
			set: function (v) { window.SetProperty("SYSTEM.COLOR BACKGROUND NORMAL", serialize_playlist_colour(v)); recolour(); },
			hidden: function () { return !properties.enableCustomColors; } },
		{ id: "colours.selectedText", type: "colour", label: "Selected text", get: function () { return read_playlist_colour("SYSTEM.COLOR TEXT SELECTED", g_color_selected_txt); },
			set: function (v) { window.SetProperty("SYSTEM.COLOR TEXT SELECTED", serialize_playlist_colour(v)); recolour(); },
			hidden: function () { return !properties.enableCustomColors; } },
		{ id: "colours.selectedBackground", type: "colour", label: "Selected background", get: function () { return read_playlist_colour("SYSTEM.COLOR BACKGROUND SELECTED", g_color_selected_bg); },
			set: function (v) { window.SetProperty("SYSTEM.COLOR BACKGROUND SELECTED", serialize_playlist_colour(v)); recolour(); },
			hidden: function () { return !properties.enableCustomColors; } },
		{ id: "colours.highlight", type: "colour", label: "Highlight", get: function () { return read_playlist_colour("SYSTEM.COLOR HIGHLIGHT", g_color_highlight); },
			set: function (v) { window.SetProperty("SYSTEM.COLOR HIGHLIGHT", serialize_playlist_colour(v)); recolour(); },
			hidden: function () { return !properties.enableCustomColors; } }
	]},

	{ section: "Background", items: [
		{ id: "background.showWallpaper", type: "toggle", label: "Show wallpaper", get: function () { return properties.showwallpaper; },
			set: function (v) { properties.showwallpaper = v; window.SetProperty("CUSTOM Show Wallpaper", v);
				p.wallpaperImg = (v && fb.IsPlaying) ? setWallpaperImg(properties.wallpaperpath, fb.GetNowPlaying()) : null; full_repaint(); } },
		{ id: "background.source", type: "choice", label: "Source",
			options: function () { return [{ label: "Album artwork", value: 0 }, { label: "Artist artwork", value: 4 }, { label: "Custom image", value: -1 }]; },
			get: function () { return properties.wallpapermode == 0 ? 0 : (properties.wallpapermode == 4 ? 4 : -1); },
			set: function (v) { properties.wallpapermode = v; window.SetProperty("CUSTOM Wallpaper Type", v);
				p.wallpaperImg = fb.IsPlaying ? setWallpaperImg(properties.wallpaperpath, fb.GetNowPlaying()) : null; full_repaint(); },
			hidden: function () { return !properties.showwallpaper; } },
		{ id: "background.blur", type: "toggle", label: "Blur", get: function () { return properties.wallpaperblurred; },
			set: function (v) { properties.wallpaperblurred = v; window.SetProperty("CUSTOM Wallpaper Blurred", v);
				p.wallpaperImg = fb.IsPlaying ? setWallpaperImg(properties.wallpaperpath, fb.GetNowPlaying()) : null; full_repaint(); },
			hidden: function () { return !properties.showwallpaper; } },
		{ id: "background.dim", type: "number", label: "Dimming", min: 100, max: 250, step: 5, get: function () { return properties.wallpaperalpha; },
			set: function (v) { sset("CUSTOM Wallpaper Alpha", "wallpaperalpha", v); },
			hidden: function () { return !properties.showwallpaper; } },
		{ id: "background.customPath", type: "text", label: "Custom image path", hint: "Path, title formatting and * wildcards allowed",
			get: function () { return properties.wallpaperpath; },
			set: function (v) { if (!v) return; properties.wallpaperpath = v; window.SetProperty("CUSTOM Default Wallpaper Path", v);
				p.wallpaperImg = fb.IsPlaying ? setWallpaperImg(v, fb.GetNowPlaying()) : null; full_repaint(); },
			hidden: function () { return !properties.showwallpaper || properties.wallpapermode != -1; } }
	]},

	{ section: "Diagnostics", items: [
		{ id: "accent.diagnosticOverlay", type: "toggle", label: "Diagnostic overlay (F7)", get: function () { return properties.accentDebug; },
			set: function (v) { properties.accentDebug = v; window.SetProperty("CUSTOM.Accent Debug Overlay", v); full_repaint(); } },
		{ id: "advanced.panelLoads", type: "info", label: "Reload count", get: function () { return String(g_config_generation); } }
	]},

	{ section: "Advanced", items: [
		{ id: "advanced.writeStats", type: "toggle", label: "Write playback statistics to file tags", get: function () { return opt_stats; },
			set: function (v) { opt_stats = v; window.SetProperty("CUSTOM.Enable Statistics (write to file)", v); } },
		{ id: "advanced.panelScaling", type: "choice", label: "Panel scaling",
			options: function () { return [
				{ label: "Auto", value: 0 }, { label: "75%", value: 75 }, { label: "100%", value: 100 },
				{ label: "125%", value: 125 }, { label: "150%", value: 150 }, { label: "175%", value: 175 },
				{ label: "200%", value: 200 }, { label: "250%", value: 250 }]; },
			get: function () { return g_forced_percent; },
			set: function (v) {
				g_forced_percent = v;
				window.SetProperty("SYSTEM.dpi (0 = Default)", v);
				refont();
				adjustMetrics(1);
				resize_panels();
				full_repaint();
			} },
		{ id: "advanced.refreshCoverArt", type: "action", label: "Refresh cover art", actionLabel: "Refresh", run: function () { g_image_cache = new image_cache; full_repaint(); } },
		{ id: "advanced.reloadScript", type: "action", label: "Reload panel script", actionLabel: "Reload", run: function () { window.SetTimeout(function () { window.Reload(); }, 60); } }
	]}

	];
};
