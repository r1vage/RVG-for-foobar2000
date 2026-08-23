'use strict';

window.DefineScript('RVG Album Art', { author: 'marc2003; adapted by RivaGe', version: '1.12.0' });

// Narrow failure reporting. Most empty catches in this file guard
// best-effort tooltip text and an optional system-colour read that already
// have a graceful fallback, and stay silent on purpose. This is for the few
// that mean something is actually broken and would otherwise leave no
// trace. Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
	var message = '[RVG Album Art] ' + what +
		(err === undefined || err === null ? '' : ': ' + err);
	var seen = (reportedFailures[message] || 0) + 1;
	reportedFailures[message] = seen;
	if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
	try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');

const MENU_STRING = 0x00000000;
const MENU_GRAYED = 0x00000001;
const DLGC_WANTALLKEYS = 0x0004;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const DT_LEFT = 0x00000000;
const DT_NOPREFIX = 0x00000800;

const ASPECT_CROP = 0;
const ASPECT_CROP_TOP = 1;
const ASPECT_STRETCH = 2;
const ASPECT_CENTRE = 3;
const ART_NAMES = ['Front', 'Back', 'Disc', 'Icon', 'Artist'];
const ASPECT_NAMES = ['Crop (focus on centre)', 'Crop (focus on top)', 'Stretch', 'Centre'];

const PROP_SELECTION = '2K3.PANEL.SELECTION';
const PROP_BACKGROUND_MODE = '2K3.PANEL.COLOURS.MODE';
const PROP_CUSTOM_BACKGROUND = '2K3.PANEL.COLOURS.CUSTOM.BACKGROUND';
const PROP_ART_ASPECT = '2K3.ARTREADER.ASPECT';
const PROP_ART_ID = '2K3.ARTREADER.ID';
const PROP_ACCENT_BORDER = 'RIVAGE.ALBUMART.ACCENT_BORDER';

function clampInt(value, minimum, maximum, fallback) {
	value = Number(value);
	if (!Number.isFinite(value)) return fallback;
	value = Math.floor(value);
	return value >= minimum && value <= maximum ? value : fallback;
}

function scale(value) {
	const dpi = Number(window.DPI);
	return Math.round(Number(value) * (Number.isFinite(dpi) && dpi > 0 ? dpi : 72) / 72);
}

function isFile(path) {
	if (!path || typeof path !== 'string') return false;
	try { return !!utils.IsFile(path); } catch (e) { return false; }
}

function setProperty(name, value) {
	window.SetProperty(name, value);
	return value;
}

let selectionMode = clampInt(window.GetProperty(PROP_SELECTION, 0), 0, 1, 0);
let backgroundMode = clampInt(window.GetProperty(PROP_BACKGROUND_MODE, 0), 0, 2, 0);
let customBackground = Number(window.GetProperty(PROP_CUSTOM_BACKGROUND, RivageUI.rgb(0, 0, 0)));
if (!Number.isFinite(customBackground)) customBackground = RivageUI.rgb(0, 0, 0);
let artAspect = clampInt(window.GetProperty(PROP_ART_ASPECT, ASPECT_CROP), 0, 3, ASPECT_CROP);
let artId = clampInt(window.GetProperty(PROP_ART_ID, 0), 0, 4, 0);
let accentBorderEnabled = !!window.GetProperty(PROP_ACCENT_BORDER, false);
let metadb = null;

const albumart = {
	x: 0,
	y: 0,
	w: 0,
	h: 0,
	mx: 0,
	my: 0,
	tooltip: '',
	img: null,
	path: '',
	hover: false
};

let albumArtRequestId = 0;
let lastArtRequestKey = '';
let playbackArtSettleTimer = null;
let hiddenArtDirty = false;
let hiddenArtForceReload = false;
let unloading = false;
const PLAYBACK_ART_SETTLE_DELAY = 200;

function cancelPlaybackArtRefresh(invalidatePending) {
	if (playbackArtSettleTimer !== null) {
		window.ClearTimeout(playbackArtSettleTimer);
		playbackArtSettleTimer = null;
	}
	if (invalidatePending) ++albumArtRequestId;
}

function schedulePlaybackArtRefresh(forceReload) {
	// Skip chains can emit several source callbacks; decode only after they settle.
	cancelPlaybackArtRefresh(true);
	playbackArtSettleTimer = window.SetTimeout(() => {
		playbackArtSettleTimer = null;
		if (unloading || selectionMode !== 0) return;
		refreshSource(forceReload);
	}, PLAYBACK_ART_SETTLE_DELAY);
}

function repaintAlbumArtArea() {
	if (unloading || !VisiblePaintWork.isVisible()) return;
	if (albumart.w > 0 && albumart.h > 0) window.RepaintRect(albumart.x, albumart.y, albumart.w, albumart.h);
	else window.Repaint();
}

function artRequestKeyFor(handle, requestedArtId) {
	if (!handle) return '';
	try { return handle.RawPath + '|' + handle.SubSong + '|' + requestedArtId; }
	catch (e) { return ''; }
}

function artworkTooltipFor(image, path, handle) {
	let text = 'Original dimensions: ' + image.Width + 'x' + image.Height + 'px';
	try {
		if (!isFile(path)) return text;
		text += '\nPath: ' + path;
		if (handle.Path !== path) text += '\nSize: ' + utils.FormatFileSize(utils.FileTest(path, 's'));
	} catch (e) { }
	return text;
}

function resolveMetadb() {
	try {
		if (selectionMode === 0 && fb.IsPlaying) return fb.GetNowPlaying() || null;
		return fb.GetFocusItem() || null;
	} catch (e) {
		return null;
	}
}

function refreshSource(forceReload) {
	if (unloading) return;
	metadb = resolveMetadb();
	refreshArtwork(forceReload);
}

function refreshArtwork(forceReload) {
	if (unloading) return;

	const requestedMetadb = metadb;
	const requestedArtId = artId;
	const requestKey = artRequestKeyFor(requestedMetadb, requestedArtId);
	if (!forceReload && requestKey && requestKey === lastArtRequestKey) return;

	if (!VisiblePaintWork.isVisible()) {
		++albumArtRequestId;
		hiddenArtDirty = true;
		hiddenArtForceReload = hiddenArtForceReload || !!forceReload;
		return;
	}

	hiddenArtDirty = false;
	hiddenArtForceReload = false;
	lastArtRequestKey = requestKey;
	const requestId = ++albumArtRequestId;

	albumart.path = '';
	albumart.tooltip = '';

	if (!requestedMetadb) {
		albumart.img = null;
		artRect = null;
		repaintAlbumArtArea();
		return;
	}

	(async () => {
		let result = null;
		try {
			// RVG owns the no-cover/no-artist placeholders, so stock stubs stay disabled.
			result = await utils.GetAlbumArtAsyncV2(window.ID, requestedMetadb, requestedArtId, false);
		} catch (e) { reportFailure('album art could not be loaded', e); }

		if (unloading || requestId !== albumArtRequestId) return;

		if (result && result.image) {
			albumart.img = result.image;
			albumart.path = result.path || '';
			albumart.tooltip = artworkTooltipFor(albumart.img, albumart.path, requestedMetadb);
		} else {
			albumart.img = null;
			albumart.path = '';
			albumart.tooltip = '';
			artRect = null;
		}

		repaintAlbumArtArea();
	})();
}

function runDeferredVisibleArtRefresh() {
	if (!hiddenArtDirty || unloading || !VisiblePaintWork.isVisible()) return;
	const forceReload = hiddenArtForceReload;
	hiddenArtDirty = false;
	hiddenArtForceReload = false;
	refreshArtwork(forceReload);
}

let sharedAlbumAccent = 0xff0078d4;
let theme = RivageUI.createTheme({ mode: 'host', accent: sharedAlbumAccent });

function refreshTheme() {
	theme = RivageUI.createTheme({ mode: 'host', accent: sharedAlbumAccent });
}

function drawBackground(gr) {
	if (window.IsTransparent) return;
	let colour = theme.background;
	if (backgroundMode === 1) {
		try { colour = utils.GetSysColour(15); } catch (e) { }
	} else if (backgroundMode === 2) {
		colour = customBackground;
	}
	gr.FillSolidRect(0, 0, albumart.w, albumart.h, colour);
}

function drawAlbumImage(gr, img, x, y, w, h, aspect, border) {
	if (!img || w <= 0 || h <= 0) return null;
	gr.SetInterpolationMode(7);
	let dstX;
	let dstY;
	let dstW;
	let dstH;

	if (aspect === ASPECT_CROP || aspect === ASPECT_CROP_TOP) {
		if (img.Width / img.Height < w / h) {
			dstW = img.Width;
			dstH = Math.round(h * img.Width / w);
			dstX = 0;
			dstY = Math.round((img.Height - dstH) / (aspect === ASPECT_CROP_TOP ? 4 : 2));
		} else {
			dstW = Math.round(w * img.Height / h);
			dstH = img.Height;
			dstX = Math.round((img.Width - dstW) / 2);
			dstY = 0;
		}
		gr.DrawImage(img, x, y, w, h, dstX + 3, dstY + 3, Math.max(1, dstW - 6), Math.max(1, dstH - 6), 0, 255);
	} else if (aspect === ASPECT_STRETCH) {
		gr.DrawImage(img, x, y, w, h, 0, 0, img.Width, img.Height, 0, 255);
	} else {
		const ratio = Math.min(w / img.Width, h / img.Height);
		const drawW = Math.floor(img.Width * ratio);
		const drawH = Math.floor(img.Height * ratio);
		x += Math.round((w - drawW) / 2);
		y += Math.round((h - drawH) / 2);
		w = drawW;
		h = drawH;
		gr.DrawImage(img, x, y, w, h, 0, 0, img.Width, img.Height, 0, 255);
	}

	if (border) gr.DrawRect(x, y, w - 1, h - 1, 1, border);
	return { x: x, y: y, w: w, h: h };
}

let artRect = null;

function paintAlbumArt(gr) {
	const border = accentBorderEnabled ? sharedAlbumAccent : 0;
	const placeholder = artId === 4 ? RivageUI.placeholderArtistArt() : RivageUI.placeholderArt();
	const img = albumart.img || placeholder;
	artRect = img ? drawAlbumImage(gr, img, albumart.x, albumart.y, albumart.w, albumart.h, artAspect, border) : null;
}

// Hit-test the displayed bitmap, not letterbox padding around it.
function onArt(x, y) {
	return !!artRect && x >= artRect.x && x < artRect.x + artRect.w && y >= artRect.y && y < artRect.y + artRect.h;
}

function tracePanel(x, y) {
	return x > albumart.x && x < albumart.x + albumart.w && y > albumart.y && y < albumart.y + albumart.h;
}

function setAccentBorder(value) {
	value = !!value;
	if (value === accentBorderEnabled) return false;
	setProperty(PROP_ACCENT_BORDER, value);
	accentBorderEnabled = value;
	repaintAlbumArtArea();
	return true;
}

function setArtId(value) {
	value = clampInt(value, 0, 4, artId);
	if (value === artId) return false;
	setProperty(PROP_ART_ID, value);
	artId = value;
	hideTooltip();
	refreshSource(false);
	return true;
}

function setArtAspect(value) {
	value = clampInt(value, 0, 3, artAspect);
	if (value === artAspect) return false;
	setProperty(PROP_ART_ASPECT, value);
	artAspect = value;
	hideTooltip();
	repaintAlbumArtArea();
	return true;
}

function setSelectionMode(value) {
	value = clampInt(value, 0, 1, selectionMode);
	if (value === selectionMode) return false;
	setProperty(PROP_SELECTION, value);
	selectionMode = value;
	hideTooltip();
	refreshSource(false);
	return true;
}

function setBackgroundMode(value) {
	value = clampInt(value, 0, 2, backgroundMode);
	if (value === backgroundMode) return false;
	setProperty(PROP_BACKGROUND_MODE, value);
	backgroundMode = value;
	window.Repaint();
	return true;
}

function setCustomBackground(value) {
	value = Number(value);
	if (!Number.isFinite(value) || value === customBackground) return false;
	setProperty(PROP_CUSTOM_BACKGROUND, value);
	customBackground = value;
	window.Repaint();
	return true;
}

function openContainingFolder(path) {
	if (!isFile(path)) return false;
	try {
		utils.Run('explorer.exe', '/select,"' + String(path).replace(/"/g, '') + '"');
		return true;
	} catch (e) {
		return false;
	}
}

function openPath(path) {
	if (!isFile(path)) return false;
	try { utils.Run(path); return true; } catch (e) { return false; }
}

const googleSearchTf = fb.TitleFormat('%album artist%[ %album%]');
const pathTf = fb.TitleFormat('$if2(%__@%,%path%)');

function googleSearchText() {
	if (!metadb) return '';
	try {
		const path = pathTf.EvalWithMetadb(metadb);
		if (fb.IsPlaying && (path.startsWith('http') || path.startsWith('mms'))) return googleSearchTf.Eval();
		return googleSearchTf.EvalWithMetadb(metadb);
	} catch (e) {
		return '';
	}
}

function openGoogleImageSearch() {
	const query = googleSearchText();
	if (!query) return false;
	try { utils.Run('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query)); return true; }
	catch (e) { return false; }
}

function appendAlbumArtMenu(menu) {
	menu.AppendMenuItem(MENU_STRING, 1000, 'Refresh artwork');
	menu.AppendMenuSeparator();
	for (let i = 0; i < ART_NAMES.length; i++) menu.AppendMenuItem(MENU_STRING, i + 1010, ART_NAMES[i]);
	menu.CheckMenuRadioItem(1010, 1014, artId + 1010);
	menu.AppendMenuSeparator();
	for (let i = 0; i < ASPECT_NAMES.length; i++) menu.AppendMenuItem(MENU_STRING, i + 1020, ASPECT_NAMES[i]);
	menu.CheckMenuRadioItem(1020, 1023, artAspect + 1020);
	menu.AppendMenuSeparator();
	menu.AppendMenuItem(isFile(albumart.path) ? MENU_STRING : MENU_GRAYED, 1030, 'Open containing folder');
	menu.AppendMenuSeparator();
	menu.AppendMenuItem(metadb ? MENU_STRING : MENU_GRAYED, 1040, 'Search Google Images');
	menu.AppendMenuSeparator();
	menu.AppendMenuItem(MENU_STRING, 1050, 'Show accent border');
	menu.CheckMenuItem(1050, accentBorderEnabled);
}

function showContextMenu(x, y) {
	const menu = window.CreatePopupMenu();
	appendAlbumArtMenu(menu);

	const background = window.CreatePopupMenu();
	background.AppendMenuItem(MENU_STRING, 100, window.InstanceType ? 'Match Default UI background' : 'Match Columns UI background');
	background.AppendMenuItem(MENU_STRING, 101, 'Match parent background');
	background.AppendMenuItem(MENU_STRING, 102, 'Custom colour');
	background.CheckMenuRadioItem(100, 102, backgroundMode + 100);
	background.AppendMenuSeparator();
	background.AppendMenuItem(backgroundMode === 2 ? MENU_STRING : MENU_GRAYED, 103, 'Choose custom colour\u2026');
	background.AppendTo(menu, window.IsTransparent ? MENU_GRAYED : MENU_STRING, 'Background');
	menu.AppendMenuSeparator();

	const selection = window.CreatePopupMenu();
	selection.AppendMenuItem(MENU_STRING, 110, 'Now playing, otherwise selected track');
	selection.AppendMenuItem(MENU_STRING, 111, 'Selected playlist track');
	selection.CheckMenuRadioItem(110, 111, selectionMode + 110);
	selection.AppendTo(menu, MENU_STRING, 'Track source');
	menu.AppendMenuSeparator();
	menu.AppendMenuItem(MENU_STRING, 120, RivageUI.copy.labels.panelConfiguration);

	const idx = menu.TrackPopupMenu(x, y);
	if (idx === 0) return true;
	if (idx === 1000) {
		hideTooltip();
		refreshSource(true);
	} else if (idx >= 1010 && idx <= 1014) {
		setArtId(idx - 1010);
	} else if (idx >= 1020 && idx <= 1023) {
		setArtAspect(idx - 1020);
	} else if (idx === 1030) {
		openContainingFolder(albumart.path);
	} else if (idx === 1040) {
		openGoogleImageSearch();
	} else if (idx === 1050) {
		setAccentBorder(!accentBorderEnabled);
	} else if (idx >= 100 && idx <= 102) {
		setBackgroundMode(idx - 100);
	} else if (idx === 103) {
		try { setCustomBackground(utils.ColourPicker(window.ID, customBackground)); } catch (e) { reportFailure('the background colour picker could not be opened', e); }
	} else if (idx === 110 || idx === 111) {
		setSelectionMode(idx - 110);
	} else if (idx === 120) {
		window.ShowConfigure();
	}
	return true;
}

const SETTINGS_PANEL_ID = 'albumart';
const SETTINGS_PANEL_LABEL = 'Album artwork';

function getMySettings() {
	return [{ id: 'accentBorder', label: 'Show accent border', type: 'bool', value: accentBorderEnabled }];
}

function applyMySetting(settingId, value) {
	if (settingId === 'accentBorder') setAccentBorder(value);
}

function on_notify_data(name, info) {
	if (SharedThemeProtocol.consume(name, info)) return;
	if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
	if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;

	if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
		const nextAccent = SharedAccentProtocol.opaque(info);
		if (nextAccent === sharedAlbumAccent) return;
		sharedAlbumAccent = nextAccent;
		refreshTheme();
		if (accentBorderEnabled) repaintAlbumArtArea();
	}
}

const TOOLTIP_DELAY_MS = 3000;
const TOOLTIP_BG = RivageUI.rgb(28, 28, 30);
const TOOLTIP_STROKE = RivageUI.rgb(91, 91, 96);
const TOOLTIP_TEXT_COLOUR = RivageUI.rgb(242, 242, 244);
const TOOLTIP_SHADOW = RivageUI.rgb(15, 15, 16);
const tooltipPainter = RivageUI.createPainter({ scale: scale });
let tooltipFont = null;
let tooltipText = '';
let tooltipVisible = false;
let tooltipTimer = null;
let tooltipX = 0;
let tooltipY = 0;
let mouseKnown = false;

function rebuildTooltipFont() {
	const info = RivageUI.consoleFontInfo();
	tooltipFont = RivageUI.font(info.fontFamily, info.fontSize, info.fontStyle || 0);
}

function clearTooltipTimer() {
	if (tooltipTimer === null) return;
	window.ClearTimeout(tooltipTimer);
	tooltipTimer = null;
}

function hideTooltip() {
	clearTooltipTimer();
	const wasVisible = tooltipVisible;
	tooltipVisible = false;
	tooltipText = '';
	if (wasVisible && !unloading && VisiblePaintWork.isVisible()) window.Repaint();
}

function updateTooltipHover(x, y) {
	const overArt = onArt(x, y);
	if (!overArt) {
		if (albumart.hover || tooltipVisible || tooltipTimer !== null) hideTooltip();
		albumart.hover = false;
		return false;
	}

	const nextText = albumart.img ? albumart.tooltip : '';
	const changed = nextText !== tooltipText || !albumart.hover;
	const anchorChanged = x !== tooltipX || y !== tooltipY;
	if (changed) {
		clearTooltipTimer();
		if (tooltipVisible) {
			tooltipVisible = false;
			if (!unloading) window.Repaint();
		}
		tooltipText = nextText;
		tooltipX = x;
		tooltipY = y;
		if (tooltipText && !unloading) {
			tooltipTimer = window.SetTimeout(() => {
				tooltipTimer = null;
				if (unloading || !mouseKnown || !onArt(albumart.mx, albumart.my)) return;
				tooltipVisible = true;
				window.Repaint();
			}, TOOLTIP_DELAY_MS);
		}
	} else if (anchorChanged) {
		tooltipX = x;
		tooltipY = y;
		if (tooltipVisible && !unloading) window.Repaint();
	}

	albumart.hover = true;
	return true;
}

function drawTooltip(gr) {
	if (!tooltipVisible || !tooltipText || !tooltipFont) return;

	const lines = tooltipText.split('\n');
	const lineH = scale(18);
	const padX = scale(10);
	const padY = scale(7);
	let maxWidth = 0;
	for (const line of lines) maxWidth = Math.max(maxWidth, Math.ceil(RivageUI.measureText(line, tooltipFont)));

	const ww = window.Width;
	const wh = window.Height;
	const boxW = Math.min(Math.max(scale(70), maxWidth + padX * 2), Math.max(scale(70), ww - scale(8)));
	const boxH = lines.length * lineH + padY * 2;
	let x = tooltipX + scale(14);
	let y = tooltipY + scale(18);
	x = Math.min(Math.max(x, scale(4)), Math.max(scale(4), ww - boxW - scale(4)));
	y = Math.min(Math.max(y, scale(4)), Math.max(scale(4), wh - boxH - scale(4)));

	tooltipPainter.tooltipBox(gr, { x: x, y: y, w: boxW, h: boxH }, lines, tooltipFont, {
		lineHeight: 18,
		paddingX: 10,
		paddingY: 7,
		radius: 4,
		shadowOffsetX: 2,
		shadowOffsetY: 3,
		fill: TOOLTIP_BG,
		stroke: TOOLTIP_STROKE,
		textColour: TOOLTIP_TEXT_COLOUR,
		shadow: TOOLTIP_SHADOW,
		textFlags: DT_LEFT | DT_NOPREFIX
	});
}

function currentMetadbWasChanged(handleList) {
	if (!metadb || !handleList || typeof handleList.Find !== 'function') return true;
	try { return handleList.Find(metadb) >= 0; } catch (e) { return true; }
}

function cycleArt(step) {
	let next = artId - step;
	if (next < 0) next = 4;
	if (next > 4) next = 0;
	return setArtId(next);
}

window.DlgCode = DLGC_WANTALLKEYS;
rebuildTooltipFont();
refreshSource(false);
SharedAccentProtocol.request();

function on_size() {
	albumart.w = window.Width;
	albumart.h = window.Height;
}

function on_paint(gr) {
	runDeferredVisibleArtRefresh();
	drawBackground(gr);
	paintAlbumArt(gr);
	if (mouseKnown) updateTooltipHover(albumart.mx, albumart.my);
	drawTooltip(gr);
}

function on_metadb_changed(handleList) {
	if (!currentMetadbWasChanged(handleList)) return;
	hideTooltip();
	refreshArtwork(true);
}

function on_mouse_move(x, y) {
	albumart.mx = x;
	albumart.my = y;
	mouseKnown = true;
	updateTooltipHover(x, y);
}

function on_mouse_leave() {
	mouseKnown = false;
	albumart.hover = false;
	hideTooltip();
}

function on_mouse_mbtn_up(x, y) {
	if (!tracePanel(x, y)) return false;
	setArtId(artId === 4 ? 0 : 4);
	return true;
}

function on_mouse_lbtn_up(x, y) {
	if (!onArt(x, y)) return false;
	fb.PlayOrPause();
	return true;
}

function on_mouse_lbtn_dblclk(x, y) {
	if (!tracePanel(x, y)) return false;
	if (metadb && metadb.Path === albumart.path) openContainingFolder(albumart.path);
	else openPath(albumart.path);
	return true;
}

function on_mouse_rbtn_up(x, y) {
	return showContextMenu(x, y);
}

function on_key_down(k) {
	if (k === VK_LEFT || k === VK_UP) return cycleArt(1);
	if (k === VK_RIGHT || k === VK_DOWN) return cycleArt(-1);
	return false;
}

function on_colours_changed() {
	refreshTheme();
	window.Repaint();
}

function on_font_changed() {
	RivageUI.clearFontCache();
	rebuildTooltipFont();
	window.Repaint();
}

function on_item_focus_change() {
	if (selectionMode === 0 && (fb.IsPlaying || fb.IsPaused)) return;
	refreshSource(false);
}

function on_playback_dynamic_info_track() {
	if (selectionMode === 0) schedulePlaybackArtRefresh(true);
}

function on_playback_new_track() {
	if (selectionMode === 0) schedulePlaybackArtRefresh(false);
}

function on_playback_stop(reason) {
	cancelPlaybackArtRefresh(true);
	if (selectionMode === 0 && reason !== 2) refreshSource(false);
}

function on_playlist_switch() {
	if (selectionMode !== 0 || (!fb.IsPlaying && !fb.IsPaused)) refreshSource(false);
}

function on_script_unload() {
	unloading = true;
	cancelPlaybackArtRefresh(true);
	clearTooltipTimer();
	hiddenArtDirty = false;
	hiddenArtForceReload = false;
}
