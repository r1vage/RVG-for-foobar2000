window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\ui_scale.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\mica_backdrop.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_resolver_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\library_actions_v2.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\playback_stats_source.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\rediscover_score.js');

window.EraseOnRepaint = false;

// Rediscover: albums (or tracks) you played a lot or rated highly but have not
// heard for a long time, ranked by shared/rediscover_score.js. The library is
// read on the first visible paint and again at most every 10 minutes while
// something you play changes; a hidden panel does no work.

window.DefineScript(RivageUI.copy.popupTitle('Rediscover'), {
    author: 'RivaGe',
    version: '1.2.0',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});

var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;
var MF_SEPARATOR = 0x00000800;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var DAY_MS = 86400000;
var MIN_PLAYS_CHOICES = [3, 5, 10, 20];
var RESCAN_MIN_MS = 10 * 60 * 1000;

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function formatInteger(value) {
    return Math.round(Number(value) || 0).toLocaleString();
}

function plural(n, one, many) {
    return formatInteger(n) + ' ' + (n === 1 ? one : many);
}

// "3 weeks", "18 months", "4 years".
function agoText(days) {
    if (days < 60) return plural(Math.max(1, Math.round(days / 7)), 'week', 'weeks');
    if (days < 730) return plural(Math.round(days / 30.44), 'month', 'months');
    var years = Math.round(days / 365.25 * 10) / 10;
    return (years % 1 ? years.toFixed(1) : String(years)) + ' years';
}

function stars(rating) {
    if (!(rating > 0)) return '';
    var full = Math.round(rating);
    var out = '';
    for (var i = 0; i < 5; i++) out += i < full ? '\u2605' : '\u2606';
    return out;
}

// ---------------------------------------------------------------------------
// Settings. The scoring choices live in config/rediscover.json (shared with the
// Quick switcher command); only the accent is a panel property.

var SETTINGS_PANEL_ID = 'rediscover';
var SETTINGS_PANEL_LABEL = 'Rediscover';
var PROPERTY_PREFIX = 'RVG Rediscover.';
var AccentMode = { SHARED_ALBUM: 'album', GLOBAL_THEME: 'theme' };

var config = RivageRediscover.readConfig();
var accentMode = AccentMode.SHARED_ALBUM;
try {
    accentMode = window.GetProperty(PROPERTY_PREFIX + 'Accent mode', AccentMode.SHARED_ALBUM) === AccentMode.GLOBAL_THEME
        ? AccentMode.GLOBAL_THEME : AccentMode.SHARED_ALBUM;
} catch (e) { }

function excludedCount() {
    return Object.keys(config.excluded).length;
}

function saveConfig() {
    RivageRediscover.writeConfig(config);
}

function gapLabel(months) {
    return months >= 24 ? '2 years' : (months === 12 ? '1 year' : months + ' months');
}

function getMySettings() {
    var gaps = [], mixes = [], mins = [];
    var i;
    for (i = 0; i < RivageRediscover.GAP_CHOICES.length; i++) {
        gaps.push({ value: RivageRediscover.GAP_CHOICES[i], label: gapLabel(RivageRediscover.GAP_CHOICES[i]) });
    }
    for (i = 0; i < RivageRediscover.MIX_CHOICES.length; i++) {
        mixes.push({ value: RivageRediscover.MIX_CHOICES[i], label: RivageRediscover.MIX_CHOICES[i] + ' tracks' });
    }
    for (i = 0; i < MIN_PLAYS_CHOICES.length; i++) {
        mins.push({ value: MIN_PLAYS_CHOICES[i], label: String(MIN_PLAYS_CHOICES[i]) });
    }
    var s = config.settings;
    return [
        {
            id: 'mode', label: 'Show', type: 'choice', section: 'Choice', value: s.mode, choiceValueType: 'string',
            choices: [{ value: 'albums', label: 'Albums' }, { value: 'tracks', label: 'Tracks' }]
        },
        {
            id: 'gapMonths', label: 'Not played for at least', type: 'choice', section: 'Choice',
            value: s.gapMonths, choiceValueType: 'number', choices: gaps
        },
        {
            id: 'minPlays', label: 'Played at least (times)', type: 'choice', section: 'Choice',
            value: s.minPlays, choiceValueType: 'number', choices: mins,
            hint: 'For albums this counts the plays of all their tracks together.'
        },
        {
            id: 'ratingWeight', label: 'Favour rated and loved music', type: 'bool', section: 'Choice',
            value: s.ratingWeight,
            hint: '4 and 5 stars and loved tracks rank higher.'
        },
        {
            id: 'mixSize', label: 'Mix length', type: 'choice', section: 'Choice',
            value: s.mixSize, choiceValueType: 'number', choices: mixes
        },
        {
            id: 'sourceInfo', label: 'Data source', type: 'info', section: 'Choice',
            value: 'Plays, last played and ratings come from the Playback statistics source in Global settings. ' +
                'Hidden items: ' + excludedCount() + ' (right-click > Show hidden again).'
        },
        {
            id: 'accentMode', label: 'Accent source', type: 'choice', section: 'Appearance',
            value: accentMode, choiceValueType: 'string',
            choices: [
                { value: AccentMode.SHARED_ALBUM, label: RivageUI.copy.labels.sharedAccent },
                { value: AccentMode.GLOBAL_THEME, label: RivageUI.copy.labels.rvgBlue }
            ]
        }
    ];
}

function applyMySetting(settingId, value) {
    if (settingId === 'accentMode') {
        accentMode = value === AccentMode.GLOBAL_THEME ? AccentMode.GLOBAL_THEME : AccentMode.SHARED_ALBUM;
        try { window.SetProperty(PROPERTY_PREFIX + 'Accent mode', accentMode); } catch (e) { }
        if (accentMode === AccentMode.SHARED_ALBUM) SharedAccentProtocol.requestAccent();
        refreshVisualResources(false);
        return;
    }
    var next = {};
    for (var key in config.settings) next[key] = config.settings[key];
    if (settingId === 'mode' || settingId === 'gapMonths' || settingId === 'minPlays' ||
        settingId === 'ratingWeight' || settingId === 'mixSize') {
        next[settingId] = value;
    } else {
        return;
    }
    config.settings = RivageRediscover.normaliseSettings(next);
    saveConfig();
    if (settingId === 'mode') scrollY = 0;
    rerank();
}

// ---------------------------------------------------------------------------
// Data

var data = null;
var entries = [];
var lastScanAt = 0;
var scanState = 'idle'; // idle | ready | error
var shownKeys = Object.create(null);   // rawPath|subsong of every listed track

var scanGate = VisiblePaintWork.create(function () {
    runScan();
});

function requestScan(force) {
    scanGate.request(String(force ? Date.now() : 'scan'));
    window.Repaint();
}

function runScan() {
    var force = !!data;
    data = RivageRediscover.scan(force);
    lastScanAt = Date.now();
    scanState = data ? 'ready' : 'error';
    rerank();
}

function rerank() {
    entries = data ? RivageRediscover.rank(data, { config: config }) : [];
    shownKeys = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
        for (var j = 0; j < entries[i].items.length; j++) {
            var h = data.handles[entries[i].items[j]];
            try { shownKeys[h.RawPath + '|' + h.SubSong] = true; } catch (e) { }
        }
    }
    markLayout();
}

function handlesFor(entry) {
    return RivageRediscover.handlesFor(data, entry);
}

function hide(entry) {
    if (!entry) return;
    config.excluded[entry.key] = (entry.artist ? entry.artist + ' - ' : '') + entry.title;
    saveConfig();
    rerank();
}

function playMix() {
    if (!data) return;
    var handles = RivageRediscover.mix(data, { config: config });
    if (handles.Count) RivageLibraryActions.play(handles);
}

// ---------------------------------------------------------------------------
// Theme, fonts and scale (as Rewind: 13 pt body, scaled by the host font size)

var FONT_SIZE = 13;
var ww = Math.max(0, Number(window.Width) || 0);
var wh = Math.max(0, Number(window.Height) || 0);
var uiScale = 1;
var sharedAlbumAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);
var hostInfo = RivageUI.hostInfo();
var theme = RivageUI.createTheme({ host: hostInfo, accent: sharedAlbumAccent });
var painter = RivageUI.createPainter({ scale: scaleUi, theme: theme });
var fonts = {};

function scaleUi(value) {
    value = Number(value) || 0;
    if (value === 0) return 0;
    return Math.max(1, Math.round(value * uiScale));
}

function currentAccent() {
    if (accentMode === AccentMode.SHARED_ALBUM) return SharedAccentProtocol.opaque(sharedAlbumAccent);
    return RivageUI.opaque(RivageUI.DEFAULT_ACCENT);
}

function accentWithAlpha(alpha) {
    return RivageUI.withAlpha(currentAccent(), alpha);
}

function rebuildFonts(clearCache) {
    if (clearCache) RivageUI.clearFontCache();
    clearCovers();
    hostInfo = RivageUI.hostInfo();
    var family = hostInfo.fontFamily || 'Segoe UI';
    var hostSize = Number(hostInfo.scaleFontSize) || 12;
    uiScale = clamp(hostSize / 12, 0.75, 1.75);
    var pt = function (points) { return Math.max(8, Math.round(points * hostSize / 12)); };
    fonts.body = RivageUI.font(family, pt(FONT_SIZE), 0);
    fonts.bodyBold = RivageUI.font(family, pt(FONT_SIZE), 1);
    fonts.title = RivageUI.font(family, pt(FONT_SIZE + 2), 1);
    fonts.small = RivageUI.font(family, pt(FONT_SIZE - 1), 0);
    fonts.tiny = RivageUI.font(family, pt(FONT_SIZE - 2), 0);
    var consoleFont = RivageUI.consoleFontInfo();
    fonts.tooltip = RivageUI.font(consoleFont.fontFamily, Math.max(8, consoleFont.fontSize), consoleFont.fontStyle || 0);
}

function refreshVisualResources(clearFonts) {
    if (clearFonts || !fonts.body) rebuildFonts(clearFonts);
    hostInfo = RivageUI.hostInfo();
    theme = RivageUI.createTheme({ host: hostInfo, accent: currentAccent() });
    painter.setTheme(theme);
    markLayout();
}

// ---------------------------------------------------------------------------
// Covers: loaded with GetAlbumArtAsync for rows on screen, cached by entry.

var COVER = 40;
var COVER_CACHE_MAX = 160;
var COVER_PENDING_MAX = 24;
var coverCache = new Map();    // entry key -> GdiBitmap | null | undefined (loading)
var coverPending = new Map();  // rawPath|subsong -> [entry key]
var coverMaskImage = null;

function coverSize() {
    return scaleUi(COVER);
}

function clearCovers() {
    coverCache.clear();
    coverPending.clear();
    coverMaskImage = null;
}

function handleKey(handle) {
    try { return handle.RawPath + '|' + handle.SubSong; } catch (e) { return ''; }
}

function requestCover(entry) {
    if (coverPending.size >= COVER_PENDING_MAX || !data) return;
    var handle = data.handles[entry.items[0]];
    var rk = handleKey(handle);
    if (!rk) { coverCache.set(entry.key, null); return; }
    coverCache.set(entry.key, undefined);
    var waiting = coverPending.get(rk);
    if (waiting) { waiting.push(entry.key); return; }
    coverPending.set(rk, [entry.key]);
    try {
        utils.GetAlbumArtAsync(window.ID, handle, 0, false, false, false);
    } catch (e) {
        coverPending.delete(rk);
        coverCache.set(entry.key, null);
    }
}

function makeThumb(image) {
    var size = coverSize();
    try {
        var side = Math.min(image.Width, image.Height);
        var cropped = image.Clone(Math.floor((image.Width - side) / 2), Math.floor((image.Height - side) / 2), side, side);
        var thumb = cropped.Resize(size, size, 7);
        if (!coverMaskImage || coverMaskImage.Width !== size) {
            coverMaskImage = gdi.CreateImage(size, size);
            var g = coverMaskImage.GetGraphics();
            g.FillSolidRect(0, 0, size, size, 0xffffffff);
            g.SetSmoothingMode(4);
            g.FillRoundRect(0, 0, size - 1, size - 1, scaleUi(5), scaleUi(5), 0xff000000);
            coverMaskImage.ReleaseGraphics(g);
        }
        thumb.ApplyMask(coverMaskImage);
        return thumb;
    } catch (e) {
        return null;
    }
}

function on_get_album_art_done(handle, artId, image) {
    var rk = handleKey(handle);
    var keys = coverPending.get(rk);
    if (!keys) return;
    coverPending.delete(rk);
    var thumb = image ? makeThumb(image) : null;
    for (var i = 0; i < keys.length; i++) {
        if (!coverCache.has(keys[i]) && coverCache.size >= COVER_CACHE_MAX) {
            coverCache.delete(coverCache.keys().next().value);
        }
        coverCache.set(keys[i], thumb);
    }
    if (window.IsVisible) window.RepaintRect(layout.viewport.x, layout.viewport.y, layout.viewport.w, layout.viewport.h);
}

// ---------------------------------------------------------------------------
// Layout: a fixed header card over a scrolling list.

var PAD = 12;
var ROW = 54;

var layout = {
    header: RivageUI.rect(0, 0, 0, 0),
    title: RivageUI.rect(0, 0, 0, 0),
    subtitle: RivageUI.rect(0, 0, 0, 0),
    chips: [],
    mixPill: RivageUI.rect(0, 0, 0, 0),
    viewport: RivageUI.rect(0, 0, 0, 0),
    rows: []
};
var layoutDirty = true;
var scrollY = 0;
var hover = { row: null, chip: null, playZone: false };
var mouseX = -1;
var mouseY = -1;

function markLayout() {
    layoutDirty = true;
    window.Repaint();
}

function contentHeight() {
    return entries.length * scaleUi(ROW);
}

function maxScroll() {
    return Math.max(0, contentHeight() - layout.viewport.h);
}

function layoutPanel() {
    layoutDirty = false;
    if (ww <= 0 || wh <= 0 || !fonts.body) return;
    var pad = scaleUi(PAD);
    var titleH = scaleUi(26);
    var chipH = scaleUi(28);
    var headerH = scaleUi(10) + titleH + scaleUi(8) + chipH + scaleUi(10);
    layout.header = RivageUI.rect(pad, pad, Math.max(0, ww - pad * 2), headerH);
    var innerX = layout.header.x + scaleUi(14);
    var innerW = Math.max(0, layout.header.w - scaleUi(28));
    var titleW = Math.min(innerW, Math.ceil(RivageUI.measureText('Rediscover', fonts.title, true)) + scaleUi(4));
    layout.title = RivageUI.rect(innerX, layout.header.y + scaleUi(10), titleW, titleH);
    layout.subtitle = RivageUI.rect(innerX + titleW + scaleUi(10), layout.title.y, Math.max(0, innerW - titleW - scaleUi(10)), titleH);

    var rowY = layout.title.y + titleH + scaleUi(8);
    var x = innerX;
    var chips = [{ id: 'albums', label: 'Albums' }, { id: 'tracks', label: 'Tracks' }];
    layout.chips = [];
    for (var i = 0; i < chips.length; i++) {
        var w = Math.ceil(RivageUI.measureText(chips[i].label, fonts.body, true)) + scaleUi(24);
        layout.chips.push({ id: chips[i].id, label: chips[i].label, rect: RivageUI.rect(x, rowY, w, chipH) });
        x += w + scaleUi(6);
    }
    var mixText = '\u25B6  Play a mix';
    var mixW = Math.min(Math.max(0, innerX + innerW - x), Math.ceil(RivageUI.measureText(mixText, fonts.body, true)) + scaleUi(30));
    layout.mixPill = RivageUI.rect(innerX + innerW - mixW, rowY, mixW, chipH);
    layout.mixText = mixText;

    var top = layout.header.y + layout.header.h + scaleUi(10);
    layout.viewport = RivageUI.rect(pad, top, Math.max(0, ww - pad * 2), Math.max(0, wh - top - pad));
    scrollY = clamp(scrollY, 0, maxScroll());
}

// Visible rows in panel coordinates, built per paint (the list can be long).
function visibleRows() {
    var out = [];
    var v = layout.viewport;
    var rowH = scaleUi(ROW);
    var first = Math.max(0, Math.floor(scrollY / rowH));
    for (var i = first; i < entries.length; i++) {
        var y = v.y + i * rowH - scrollY;
        if (y >= v.y + v.h) break;
        out.push({ index: i, entry: entries[i], rect: RivageUI.rect(v.x, y, v.w - scaleUi(8), rowH) });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Painting

function subtitleText() {
    var parts = [];
    if (scanState === 'ready') {
        parts.push(plural(entries.length, config.settings.mode === 'tracks' ? 'track' : 'album',
            config.settings.mode === 'tracks' ? 'tracks' : 'albums'));
    }
    parts.push('not played for ' + gapLabel(config.settings.gapMonths) + '+');
    return parts.join('  \u00B7  ');
}

function paintHeader(gr) {
    painter.card(gr, layout.header, { fill: theme.card, border: true, accent: true, accentColour: currentAccent() });
    gr.GdiDrawText('Rediscover', fonts.title, currentAccent(), layout.title.x, layout.title.y,
        layout.title.w, layout.title.h, RivageUI.textFlags.leftEllipsis);
    gr.GdiDrawText(subtitleText(), fonts.body, theme.textMuted, layout.subtitle.x, layout.subtitle.y,
        layout.subtitle.w, layout.subtitle.h, RivageUI.textFlags.leftEllipsis);
    for (var i = 0; i < layout.chips.length; i++) {
        var chip = layout.chips[i];
        painter.chip(gr, chip.rect, { selected: chip.id === config.settings.mode, hovered: hover.chip === chip.id },
            { accent: currentAccent(), text: chip.label, font: fonts.body, paddingX: 12, textFlags: RivageUI.textFlags.centered });
    }
    if (layout.mixPill.w > scaleUi(40)) {
        painter.chip(gr, layout.mixPill, { hovered: hover.chip === 'mix', enabled: entries.length > 0 },
            { accent: currentAccent(), text: layout.mixText, font: fonts.body, paddingX: 12,
                textFlags: RivageUI.textFlags.centered, indicator: false });
    }
}

function paintMessage(gr) {
    var v = layout.viewport;
    var rect = RivageUI.rect(v.x, v.y, v.w, Math.min(v.h, scaleUi(130)));
    painter.card(gr, rect, { fill: theme.card, border: true });
    var heading, detail;
    if (scanState === 'error') {
        heading = 'Play statistics could not be read';
        detail = 'See the foobar2000 console for details.';
    } else if (scanState !== 'ready') {
        heading = 'Reading your library\u2026';
        detail = '';
    } else {
        heading = 'Nothing forgotten yet';
        detail = 'No ' + (config.settings.mode === 'tracks' ? 'track' : 'album') + ' with ' + config.settings.minPlays +
            '+ plays has gone ' + gapLabel(config.settings.gapMonths) + ' without a play. ' +
            'Try a shorter gap or fewer plays from the right-click menu.';
    }
    gr.GdiDrawText(heading, fonts.bodyBold, theme.textPrimary, rect.x + scaleUi(16), rect.y + scaleUi(28),
        rect.w - scaleUi(32), scaleUi(24), RivageUI.textFlags.centeredEllipsis);
    if (detail) {
        gr.GdiDrawText(detail, fonts.body, theme.textMuted, rect.x + scaleUi(16), rect.y + scaleUi(58),
            rect.w - scaleUi(32), scaleUi(50), RivageUI.textFlags.wordBreakCentered);
    }
}

function paintRow(gr, row) {
    var r = row.rect;
    var e = row.entry;
    var hovered = hover.row && hover.row.index === row.index;
    painter.card(gr, RivageUI.rect(r.x, r.y + scaleUi(2), r.w, r.h - scaleUi(4)),
        { fill: hovered ? theme.cardHover : theme.card, border: true });

    var x = r.x + scaleUi(10);
    var size = coverSize();
    var cy = r.y + Math.round((r.h - size) / 2);
    var img = coverCache.get(e.key);
    if (img) {
        gr.DrawImage(img, x, cy, size, size, 0, 0, img.Width, img.Height);
    } else {
        gr.SetSmoothingMode(4);
        gr.FillRoundRect(x, cy, size - 1, size - 1, scaleUi(5), scaleUi(5), RivageUI.mix(theme.card, theme.textPrimary, 0.07));
        gr.SetSmoothingMode(0);
        if (!coverCache.has(e.key)) requestCover(e);
    }
    // The cover is a play button on hover.
    if (hovered) {
        gr.FillSolidRect(x, cy, size, size, RivageUI.withAlpha(0xff000000, hover.playZone ? 120 : 70));
        gr.GdiDrawText('\u25B6', fonts.title, hover.playZone ? currentAccent() : 0xffffffff, x, cy, size, size,
            RivageUI.textFlags.centered);
    }

    var textX = x + size + scaleUi(12);
    var right = r.x + r.w - scaleUi(12);
    // Rating in one colour, always in the same five-star column at the right; a
    // loved track gets an accent heart just before that column.
    var starText = stars(e.rating);
    var starsW = Math.ceil(RivageUI.measureText(stars(5), fonts.small, true));
    var heartW = Math.ceil(RivageUI.measureText('\u2665', fonts.small, true)) + scaleUi(6);
    var reserved = (starText ? starsW : 0) + (e.loved ? heartW : 0);
    var textW = Math.max(0, right - textX - (reserved ? reserved + scaleUi(8) : 0));
    var titleText = e.title + (e.kind === 'album' && e.year ? '  (' + e.year + ')' : '');
    var lineH = scaleUi(20);
    var top = r.y + Math.round((r.h - lineH * 2) / 2);
    gr.GdiDrawText(titleText, fonts.bodyBold, hovered ? theme.textPrimary : theme.textSecondary, textX, top, textW, lineH,
        RivageUI.textFlags.leftEllipsis);
    var sub = (e.artist ? e.artist + '  \u00B7  ' : '') + 'played ' + formatInteger(e.plays) + '\u00D7  \u00B7  last ' +
        agoText((Date.now() - e.last) / DAY_MS) + ' ago';
    gr.GdiDrawText(sub, fonts.small, theme.textMuted, textX, top + lineH, Math.max(0, right - textX), lineH,
        RivageUI.textFlags.leftEllipsis);
    if (starText) {
        gr.GdiDrawText(starText, fonts.small, theme.textMuted, right - starsW, top, starsW, lineH, RivageUI.textFlags.left);
    }
    if (e.loved) {
        gr.GdiDrawText('\u2665', fonts.small, currentAccent(), textX, top,
            right - textX - (starText ? starsW : 0) - scaleUi(6), lineH, RivageUI.textFlags.right);
    }
}

function paintList(gr) {
    var v = layout.viewport;
    if (v.w <= 0 || v.h <= 0) return;
    if (!entries.length) { paintMessage(gr); return; }
    var clipped = typeof gr.PushClip === 'function';
    if (clipped) gr.PushClip(v.x, v.y, v.w, v.h);
    try {
        var rows = visibleRows();
        for (var i = 0; i < rows.length; i++) paintRow(gr, rows[i]);
    } finally {
        if (clipped) gr.PopClip();
    }
    painter.scrollbar(gr, {
        x: v.x + v.w - scaleUi(4), y: v.y, height: v.h,
        contentHeight: contentHeight(), viewportHeight: v.h, scroll: scrollY
    });
}

// "Why this?": the numbers behind the rank.
function tooltipLines() {
    if (!hover.row || hover.playZone) return null;
    var e = hover.row.entry;
    var lines = [(e.artist ? e.artist + ' - ' : '') + e.title];
    lines.push(plural(e.plays, 'play', 'plays') + (e.kind === 'album' ? ' across ' + plural(e.tracks, 'track', 'tracks') : '') +
        ', last ' + agoText((Date.now() - e.last) / DAY_MS) + ' ago');
    var extras = [];
    if (e.rating > 0) extras.push((Math.round(e.rating * 10) / 10) + ' stars' + (e.kind === 'album' ? ' on average' : ''));
    if (e.loved) extras.push('loved');
    if (extras.length) lines.push(extras.join(', '));
    lines.push('Why: fondness ' + e.affinity.toFixed(1) + ' \u00D7 forgotten ' + e.staleness.toFixed(1) +
        ' = ' + e.score.toFixed(1));
    return lines;
}

function paintTooltip(gr) {
    var lines = tooltipLines();
    if (!lines || !fonts.tooltip) return;
    var widest = 0;
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, RivageUI.measureText(lines[i], fonts.tooltip, false));
    var w = Math.min(Math.ceil(widest) + scaleUi(20), Math.max(0, ww - scaleUi(8)));
    var h = Math.min(lines.length * scaleUi(17) + scaleUi(12), Math.max(0, wh - scaleUi(8)));
    var x = mouseX + scaleUi(14);
    var y = mouseY + scaleUi(14);
    if (x + w > ww - scaleUi(4)) x = mouseX - w - scaleUi(10);
    if (y + h > wh - scaleUi(4)) y = mouseY - h - scaleUi(10);
    x = clamp(x, scaleUi(4), Math.max(scaleUi(4), ww - w - scaleUi(4)));
    y = clamp(y, scaleUi(4), Math.max(scaleUi(4), wh - h - scaleUi(4)));
    painter.tooltipBox(gr, RivageUI.rect(x, y, w, h), lines, fonts.tooltip,
        { lineHeight: 17, paddingX: 9, paddingY: 6, stroke: accentWithAlpha(120) });
}

function on_paint(gr) {
    if (ww <= 0 || wh <= 0) return;
    scanGate.runFromPaint();
    if (layoutDirty) layoutPanel();
    RivageBackdrop.paint(gr, 0, 0, ww, wh, theme.background);
    paintList(gr);
    paintHeader(gr);
    paintTooltip(gr);
}

// ---------------------------------------------------------------------------
// Input

function inRect(rect, x, y) {
    return rect && x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function rowAt(x, y) {
    if (!inRect(layout.viewport, x, y)) return null;
    var rows = visibleRows();
    for (var i = 0; i < rows.length; i++) if (inRect(rows[i].rect, x, y)) return rows[i];
    return null;
}

function chipAt(x, y) {
    for (var i = 0; i < layout.chips.length; i++) if (inRect(layout.chips[i].rect, x, y)) return layout.chips[i].id;
    if (layout.mixPill.w > scaleUi(40) && inRect(layout.mixPill, x, y)) return 'mix';
    return null;
}

function inPlayZone(row, x) {
    return !!row && x < row.rect.x + scaleUi(10) + coverSize();
}

function on_mouse_move(x, y) {
    var moved = x !== mouseX || y !== mouseY;
    mouseX = x;
    mouseY = y;
    var row = rowAt(x, y);
    var chip = chipAt(x, y);
    var playZone = inPlayZone(row, x);
    var changed = (row ? row.index : -1) !== (hover.row ? hover.row.index : -1) || chip !== hover.chip || playZone !== hover.playZone;
    hover = { row: row, chip: chip, playZone: playZone };
    window.SetCursor(row || chip ? IDC_HAND : IDC_ARROW);
    if (changed || (moved && row)) window.Repaint();
}

function on_mouse_leave() {
    hover = { row: null, chip: null, playZone: false };
    window.Repaint();
}

function on_mouse_wheel(step) {
    var next = clamp(scrollY - step * scaleUi(ROW) * 2, 0, maxScroll());
    if (next === scrollY) return;
    scrollY = next;
    hover = { row: null, chip: null, playZone: false };
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    var chip = chipAt(x, y);
    if (chip === 'mix') { playMix(); return; }
    if (chip) { applyMySetting('mode', chip); return; }
    // The cover plays, from the active playlist when it holds the tracks. The rest
    // of the row selects them (in the playlist that has them, else in RVG Search),
    // so selection-following panels show them.
    var row = rowAt(x, y);
    if (!row) return;
    if (inPlayZone(row, x)) RivageLibraryActions.playInActivePlaylist(handlesFor(row.entry));
    else RivageLibraryActions.reveal(handlesFor(row.entry));
}

function on_mouse_mbtn_up(x, y) {
    var row = rowAt(x, y);
    if (row) RivageLibraryActions.queue(handlesFor(row.entry));
}

function on_mouse_rbtn_up(x, y) {
    var row = rowAt(x, y);
    var s = config.settings;
    var menu = window.CreatePopupMenu();
    var gapMenu = window.CreatePopupMenu();
    var minMenu = window.CreatePopupMenu();
    var mixMenu = window.CreatePopupMenu();
    var libraryState = null;
    var i;
    if (row) {
        var e = row.entry;
        libraryState = RivageLibraryActions.appendHandles(menu, handlesFor(e), {
            separator: false, label: e.kind === 'album' ? 'album' : 'track',
            descriptor: e.kind === 'album' ? { type: 'album', artist: e.artist, album: e.title }
                : { type: 'track', artist: e.artist, title: e.title }
        });
        menu.AppendMenuItem(MF_STRING, 5, 'Not interested');
        menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    }
    menu.AppendMenuItem(entries.length ? MF_STRING : MF_GRAYED, 6, 'Play a mix');
    menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    menu.AppendMenuItem(MF_STRING | (s.mode === 'albums' ? MF_CHECKED : 0), 10, 'Albums');
    menu.AppendMenuItem(MF_STRING | (s.mode === 'tracks' ? MF_CHECKED : 0), 11, 'Tracks');
    for (i = 0; i < RivageRediscover.GAP_CHOICES.length; i++) {
        gapMenu.AppendMenuItem(MF_STRING | (RivageRediscover.GAP_CHOICES[i] === s.gapMonths ? MF_CHECKED : 0), 100 + i,
            gapLabel(RivageRediscover.GAP_CHOICES[i]));
    }
    gapMenu.AppendTo(menu, MF_STRING, 'Not played for');
    for (i = 0; i < MIN_PLAYS_CHOICES.length; i++) {
        minMenu.AppendMenuItem(MF_STRING | (MIN_PLAYS_CHOICES[i] === s.minPlays ? MF_CHECKED : 0), 200 + i,
            MIN_PLAYS_CHOICES[i] + '+ plays');
    }
    minMenu.AppendTo(menu, MF_STRING, 'Played at least');
    for (i = 0; i < RivageRediscover.MIX_CHOICES.length; i++) {
        mixMenu.AppendMenuItem(MF_STRING | (RivageRediscover.MIX_CHOICES[i] === s.mixSize ? MF_CHECKED : 0), 300 + i,
            RivageRediscover.MIX_CHOICES[i] + ' tracks');
    }
    mixMenu.AppendTo(menu, MF_STRING, 'Mix length');
    menu.AppendMenuItem(MF_STRING | (s.ratingWeight ? MF_CHECKED : 0), 12, 'Favour rated and loved music');
    menu.AppendMenuItem(MF_SEPARATOR, 0, '');
    var hidden = excludedCount();
    menu.AppendMenuItem(hidden ? MF_STRING : MF_GRAYED, 13, hidden ? 'Show hidden again (' + hidden + ')' : 'Show hidden again');
    menu.AppendMenuItem(MF_STRING, 14, 'Refresh');

    var id = menu.TrackPopupMenu(x, y);
    if (RivageLibraryActions.handle(libraryState, id)) return true;
    if (id === 5) {
        hide(row.entry);
    } else if (id === 6) {
        playMix();
    } else if (id === 10 || id === 11) {
        applyMySetting('mode', id === 11 ? 'tracks' : 'albums');
    } else if (id === 12) {
        applyMySetting('ratingWeight', !s.ratingWeight);
    } else if (id === 13) {
        config.excluded = {};
        saveConfig();
        rerank();
    } else if (id === 14) {
        clearCovers();
        RivageRediscover.invalidate();
        requestScan(true);
    } else if (id >= 100 && id < 100 + RivageRediscover.GAP_CHOICES.length) {
        applyMySetting('gapMonths', RivageRediscover.GAP_CHOICES[id - 100]);
    } else if (id >= 200 && id < 200 + MIN_PLAYS_CHOICES.length) {
        applyMySetting('minPlays', MIN_PLAYS_CHOICES[id - 200]);
    } else if (id >= 300 && id < 300 + RivageRediscover.MIX_CHOICES.length) {
        applyMySetting('mixSize', RivageRediscover.MIX_CHOICES[id - 300]);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Host callbacks

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function () {
        refreshVisualResources(false);
    })) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    if (SettingsRegistry.consume(name, info, 'global', PlaybackStatsSource.applySetting)) return;
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (SharedThemeProtocol.isAccentCommitted(nextAccent)) return;
        if (accentMode === AccentMode.SHARED_ALBUM) refreshVisualResources(false);
    }
}

// A listed track was played (or retagged): read the library again, at most
// every 10 minutes, and only once the panel is visible.
function on_metadb_changed(handleList) {
    if (!data) return;
    var hit = false;
    try {
        var count = handleList.Count;
        for (var i = 0; i < count && !hit; i++) hit = !!shownKeys[handleKey(handleList[i])];
    } catch (e) { hit = false; }
    if (hit && Date.now() - lastScanAt >= RESCAN_MIN_MS) requestScan(true);
}

function on_library_items_added() {
    if (data) requestScan(true);
}

function on_library_items_removed() {
    if (data) requestScan(true);
}

function on_size(width, height) {
    ww = Math.max(0, Number(width) || 0);
    wh = Math.max(0, Number(height) || 0);
    layoutDirty = true;
}

function on_colours_changed() {
    refreshVisualResources(false);
}

function on_font_changed() {
    refreshVisualResources(true);
}

PlaybackStatsSource.onChange(function () {
    if (data) requestScan(true);
});

refreshVisualResources(true);
SharedAccentProtocol.request();
PlaybackStatsSource.requestSync();
requestScan(false);
