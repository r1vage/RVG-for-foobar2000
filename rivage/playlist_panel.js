window.DefineScript('RVG Playlist', {author: 'Br3tt; adapted by RivaGe', version: '1.3.0', features: {drag_n_drop: true}});

// Narrow failure reporting. This is for the two empty catches that mean
// something is actually broken and would otherwise leave no trace: a
// right-click SETTINGS menu action silently doing nothing, or a shared
// theme update silently failing to repaint the playlist. Repeats are
// counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
	var message = '[RVG Playlist] ' + what +
		(err === undefined || err === null ? '' : ': ' + err);
	var seen = (reportedFailures[message] || 0) + 1;
	reportedFailures[message] = seen;
	if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
	try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// WSHplaylistmanager.js reads RivageUI at include time, so the design system must load first.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
// main.js can synchronously receive playback-statistics state while it is being included.
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");

var SETTINGS_PANEL_ID = "playlist";
var SETTINGS_PANEL_LABEL = "Playlist";

['WSHcommon.js',
'WSHfluent.js',
'WSHalbumaccent.js',
'WSHinputbox.js',
'WSHtopbar.js',
'WSHscrollbar.js',
'WSHheaderbar.js',
'WSHplaylist.js',
'WSHplaylistmanager.js',
'WSHschema.js',
'main.js'].forEach(function (item) {
	include(fb.ProfilePath + 'jsplitter\\rivage\\vendor\\jsplaylist-mod\\js\\' + item);
});

// Mirror WSHschema.js into the shared SETTINGS registry. The schema is rebuilt
// for each request because several rows depend on the currently edited group/column.
function getPlaylistSettings() {
	var sections = settings_schema();
	var out = [];
	var i, j, section, item, entry, choices, k;

	for (i = 0; i < sections.length; i++) {
		section = sections[i];
		for (j = 0; j < section.items.length; j++) {
			item = section.items[j];
			try {
				if (item.hidden && item.hidden()) continue;
			} catch (eHidden) { continue; }

			entry = { id: item.id, label: item.label, section: section.section };

			try {
				switch (item.type) {
				case "toggle":
					entry.type = "bool";
					entry.value = !!item.get();
					break;
				case "choice":
					choices = item.options() || [];
					entry.type = "choice";
					entry.choices = [];
					for (k = 0; k < choices.length; k++) {
						entry.choices.push({ value: choices[k].value, label: choices[k].label });
					}
					entry.choiceValueType = choices.length && typeof choices[0].value === "number" ? "number" : "string";
					entry.value = item.get();

					break;
				case "number":
					entry.type = "number";
					entry.value = Number(item.get());
					if (typeof item.min === "number") entry.min = item.min;
					if (typeof item.max === "number") entry.max = item.max;
					if (typeof item.step === "number") entry.step = item.step;
					break;
				case "text":
					entry.type = "string";
					entry.value = String(item.get());
					if (item.hint) entry.hint = item.hint;
					break;
				case "colour":
					entry.type = "colour";
					entry.value = item.get();
					break;
				case "action":
					entry.type = "action";
					entry.value = null;
					if (item.actionLabel) entry.actionLabel = String(item.actionLabel);
					if (typeof item.disabled === "function") entry.disabled = !!item.disabled();
					else if (item.disabled !== undefined) entry.disabled = !!item.disabled;
					break;
				case "info":
					entry.type = "info";
					entry.value = item.get();
					break;
				default:
					continue;
				}
			} catch (eRow) {
				continue;
			}

			out.push(entry);
		}
	}
	return out;
}

// Apply one SETTINGS edit to the matching schema row.
function applyPlaylistSetting(settingId, value) {
	var sections = settings_schema();
	var i, j, item;

	for (i = 0; i < sections.length; i++) {
		for (j = 0; j < sections[i].items.length; j++) {
			item = sections[i].items[j];
			if (item.id !== settingId) continue;
			try {
				if (item.type === "action") {
					item.run();
				} else {
					item.set(value);
				}
			} catch (e) { reportFailure('the menu action could not be run', e); }
			return;
		}
	}
}

// Map the active semantic theme onto the five legacy colours the playlist actually uses.
// main.js calls this inside get_colors(), before colour-dependent caches are rebuilt.
function applyRivagePlaylistTheme() {
	var shared = RivageUI.getSharedTheme ? RivageUI.getSharedTheme() : null;
	if (!shared || shared.mode === 'existing') return;
	var t = RivageUI.createTheme({ mode: 'host' });
	var selectedBackground = t.primaryContainer !== undefined ? t.primaryContainer : t.surfaceSelected;
	var selectedText = t.onPrimaryContainer !== undefined ? t.onPrimaryContainer : t.textPrimary;

	if (typeof g_color_normal_bg !== 'undefined') g_color_normal_bg = t.background;
	if (typeof g_color_normal_txt !== 'undefined') g_color_normal_txt = t.textPrimary;
	if (typeof g_color_selected_bg !== 'undefined') g_color_selected_bg = selectedBackground;
	if (typeof g_color_selected_txt !== 'undefined') g_color_selected_txt = selectedText;
	if (typeof g_color_highlight !== 'undefined') g_color_highlight = t.accent;
}

if (typeof on_notify_data === 'function') {
	var rivage_playlist_on_notify_data = on_notify_data;
	on_notify_data = function (name, info) {
		if (SharedThemeProtocol.consume(name, info, function () {
			try { if (typeof on_colours_changed === 'function') on_colours_changed(); } catch (e) { reportFailure('colours could not be refreshed after a shared theme update', e); }
			// The bundled on_colours_changed ends in full_repaint(), which defers by a
			// 40 ms timer. Invalidate from the commit edge instead so the playlist
			// changes colour with the rest of the layout, not a frame behind it.
			SharedThemeProtocol.requestRepaint();
		})) return;
		return rivage_playlist_on_notify_data(name, info);
	};
}
SharedThemeProtocol.request();

// Cover the bundled script's stray 1 px top-edge separator after its paint pass.
if (typeof on_paint === 'function') {
	var rivage_playlist_on_paint = on_paint;
	on_paint = function (gr) {
		rivage_playlist_on_paint(gr);

		var width = (typeof ww !== 'undefined') ? ww : window.Width;
		var topColour = (typeof g_color_normal_bg !== 'undefined') ? g_color_normal_bg : RGB(0, 0, 0);
		// Repaints that row of the mapped slice in Mica; a plain fill outside it.
		RivageBackdrop.paint(gr, 0, 0, width, 1, topColour);
	};
}
