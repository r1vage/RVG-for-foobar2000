window.DrawMode = 1; // JSplitter Direct2D renderer; must remain the first script line.

// RVG shared modules. This panel is a consumer of the shared album-art
// accent; it never decodes artwork or performs colour scoring itself.
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');

window.EraseOnRepaint = false;

window.DefineScript('RVG VU Meter', {
    author: 'Case + marc2003; adapted by RivaGe',
    version: '2.8.1',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});

// Narrow failure reporting. Most empty catches in this file guard drawing
// and host calls that are *expected* to fail (an optional DPI read, a font
// fallback chain, a timer clear) and stay silent on purpose. This is for the
// few that mean something is actually broken and would otherwise leave no
// trace. Repeats are counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG VU Meter] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// ============================================================================
// Configuration model
// ============================================================================

var PROPERTY_PREFIX = 'RIVAGE.VUMETER.';
var SETTINGS_PANEL_ID_PREFIX = 'vu_meter-';
var INSTANCE_ID_PROPERTY = PROPERTY_PREFIX + 'Instance id';
var instanceId = '';

function makeInstanceId() {
    var random = Math.floor(Math.random() * 0x100000000).toString(36);
    while (random.length < 7) random = '0' + random;
    var stamp = (Date.now() % 0x100000).toString(36);
    return (random + stamp).slice(0, 12);
}

function loadInstanceId() {
    var stored = String(window.GetProperty(INSTANCE_ID_PROPERTY, '') || '').trim();
    if (!/^[0-9a-z]{4,12}$/.test(stored)) {
        stored = makeInstanceId();
        window.SetProperty(INSTANCE_ID_PROPERTY, stored);
    }
    instanceId = stored;
}

function settingsPanelId() {
    return SETTINGS_PANEL_ID_PREFIX + instanceId;
}

function settingsPanelLabel() {
    return 'VU meter ' + instanceId;
}

var DEFAULTS = {
    themeMode: 'host',
    accentMode: 'shared',
    customAccent: RivageUI.DEFAULT_ACCENT,
    palette: 'rivage',
    customMeter: RivageUI.rgb(79, 195, 247),
    customPeak: RivageUI.rgb(255, 111, 97),

    orientation: 'auto',
    stereoLayout: 'mirrored',
    meterStyle: 'segments',
    segmentDb: 2.5,
    segmentGap: 2,

    minDb: -60,
    maxDb: 3,
    warningDb: -12,
    clipDb: -3,

    showHeader: true,
    showScale: true,
    showLabels: false,
    showValues: true,
    showGrid: true,
    showPeak: true,
    showFrame: true,
    showAccentLine: true,
    hoverTooltip: true,

    outerPadding: 10,
    channelGap: 8,
    cornerRadius: 5,
    peakThickness: 2,

    fps: 60,
    rmsWindowMs: 50,
    response: 'balanced',
    peakHoldMs: 350,
    peakDecay: 'slow'
};

var PROPERTY_NAMES = {
    themeMode: 'Theme mode',
    accentMode: 'Accent mode',
    customAccent: 'Custom accent',
    palette: 'Meter palette',
    customMeter: 'Custom meter colour',
    customPeak: 'Custom peak colour',

    orientation: 'Orientation',
    stereoLayout: 'Stereo layout',
    meterStyle: 'Meter style',
    segmentDb: 'Segment size dB',
    segmentGap: 'Segment gap px',

    minDb: 'Minimum dB',
    maxDb: 'Maximum dB',
    warningDb: 'Warning threshold dB',
    clipDb: 'Clip threshold dB',

    showHeader: 'Show header',
    showScale: 'Show dB scale',
    showLabels: 'Show channel labels',
    showValues: 'Show numeric values',
    showGrid: 'Show grid lines',
    showPeak: 'Show peak markers',
    showFrame: 'Show card border',
    showAccentLine: 'Show highlight line',
    hoverTooltip: 'Show hover tooltip',

    outerPadding: 'Outer padding px',
    channelGap: 'Channel gap px',
    cornerRadius: 'Corner radius px',
    peakThickness: 'Peak marker thickness px',

    fps: 'Refresh rate fps',
    rmsWindowMs: 'RMS window ms',
    response: 'RMS response',
    peakHoldMs: 'Peak hold ms',
    peakDecay: 'Peak decay'
};

var THEME_CHOICES = RivageUI.copy.themeChoices({ host: 'host', dark: 'dark', light: 'light' });

var ACCENT_CHOICES = RivageUI.copy.accentChoices({ shared: 'shared', rvgBlue: 'fixed', custom: 'custom' });

var PALETTE_CHOICES = [
    { value: 'rivage', label: 'Accent, amber and red zones' },
    { value: 'accent', label: 'Single accent colour' },
    { value: 'classic', label: 'Studio green, amber and red' },
    { value: 'custom', label: 'Custom meter and peak colours' }
];

var ORIENTATION_CHOICES = [
    { value: 'auto', label: 'Automatic' },
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'vertical', label: 'Vertical' }
];

var STEREO_LAYOUT_CHOICES = [
    { value: 'mirrored', label: 'Mirrored from centre' },
    { value: 'stacked', label: 'Stacked, left to right' }
];

var STYLE_CHOICES = [
    { value: 'smooth', label: 'Smooth' },
    { value: 'segments', label: 'Segments' }
];

var SEGMENT_DB_CHOICES = [
    { value: 0.625, label: '0.625 dB' },
    { value: 1.25, label: '1.25 dB' },
    { value: 2.5, label: '2.5 dB' },
    { value: 5, label: '5 dB' }
];

var SEGMENT_GAP_CHOICES = [
    { value: 0, label: '0 px' },
    { value: 1, label: '1 px' },
    { value: 2, label: '2 px' },
    { value: 3, label: '3 px' },
    { value: 4, label: '4 px' },
    { value: 6, label: '6 px' },
    { value: 8, label: '8 px' }
];

var MIN_DB_CHOICES = [
    { value: -72, label: '-72 dB' },
    { value: -60, label: '-60 dB' },
    { value: -48, label: '-48 dB' },
    { value: -36, label: '-36 dB' }
];

var MAX_DB_CHOICES = [
    { value: 0, label: '0 dB' },
    { value: 3, label: '+3 dB' },
    { value: 6, label: '+6 dB' }
];

var WARNING_DB_CHOICES = [
    { value: -18, label: '-18 dB' },
    { value: -12, label: '-12 dB' },
    { value: -9, label: '-9 dB' },
    { value: -6, label: '-6 dB' }
];

var CLIP_DB_CHOICES = [
    { value: -6, label: '-6 dB' },
    { value: -3, label: '-3 dB' },
    { value: -1, label: '-1 dB' },
    { value: 0, label: '0 dB' }
];

var FPS_CHOICES = [
    { value: 30, label: '30 fps' },
    { value: 45, label: '45 fps' },
    { value: 60, label: '60 fps' },
    { value: 90, label: '90 fps' }
];

var RMS_WINDOW_CHOICES = [
    { value: 20, label: '20 ms' },
    { value: 35, label: '35 ms' },
    { value: 50, label: '50 ms' },
    { value: 80, label: '80 ms' },
    { value: 120, label: '120 ms' }
];

var RESPONSE_CHOICES = [
    { value: 'fast', label: 'Fast' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'smooth', label: 'Smooth' }
];

var PEAK_HOLD_CHOICES = [
    { value: 0, label: 'Off' },
    { value: 200, label: '200 ms' },
    { value: 350, label: '350 ms' },
    { value: 700, label: '700 ms' },
    { value: 1200, label: '1.2 seconds' },
    { value: 2000, label: '2 seconds' }
];

var PEAK_DECAY_CHOICES = [
    { value: 'fast', label: 'Fast' },
    { value: 'medium', label: 'Medium' },
    { value: 'slow', label: 'Slow' },
    { value: 'very_slow', label: 'Very slow' }
];

var PADDING_CHOICES = [
    { value: 0, label: 'None' },
    { value: 6, label: 'Compact' },
    { value: 10, label: 'Standard' },
    { value: 16, label: 'Spacious' },
    { value: 24, label: 'Wide' }
];

var CHANNEL_GAP_CHOICES = [
    { value: 2, label: '2 px' },
    { value: 4, label: '4 px' },
    { value: 8, label: '8 px' },
    { value: 12, label: '12 px' },
    { value: 16, label: '16 px' }
];

var RADIUS_CHOICES = [
    { value: 0, label: 'Square' },
    { value: 3, label: '3 px' },
    { value: 5, label: '5 px' },
    { value: 8, label: '8 px' },
    { value: 12, label: '12 px' }
];

var PEAK_THICKNESS_CHOICES = [
    { value: 1, label: '1 px' },
    { value: 2, label: '2 px' },
    { value: 3, label: '3 px' },
    { value: 4, label: '4 px' },
    { value: 6, label: '6 px' }
];

function clampNumber(value, minimum, maximum, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = fallback;
    return Math.max(minimum, Math.min(maximum, value));
}

function choiceValue(value, choices, fallback) {
    var i;
    for (i = 0; i < choices.length; i++) {
        if (choices[i].value === value) return value;
    }
    return fallback;
}

function numberChoiceValue(value, choices, fallback) {
    value = Number(value);
    var i;
    for (i = 0; i < choices.length; i++) {
        if (Number(choices[i].value) === value) return value;
    }
    return fallback;
}

function propertyName(key) {
    return PROPERTY_PREFIX + PROPERTY_NAMES[key];
}

function readProperty(key) {
    return window.GetProperty(propertyName(key), DEFAULTS[key]);
}

function writeProperty(key, value) {
    window.SetProperty(propertyName(key), value);
}

var settings = {};
var meterDbRange = DEFAULTS.maxDb - DEFAULTS.minDb;
var meterDbInvRange = 1 / meterDbRange;

function normaliseThresholdValues(values) {
    var result = {
        minDb: Number(values.minDb),
        maxDb: Number(values.maxDb),
        warningDb: Number(values.warningDb),
        clipDb: Number(values.clipDb)
    };

    if (result.minDb >= result.maxDb) {
        result.minDb = DEFAULTS.minDb;
        result.maxDb = DEFAULTS.maxDb;
    }
    if (result.warningDb >= result.clipDb) {
        result.warningDb = Math.max(result.minDb, result.clipDb - 3);
    }
    result.warningDb = Math.max(result.minDb, Math.min(result.maxDb - 1, result.warningDb));
    result.clipDb = Math.max(result.warningDb + 1, Math.min(result.maxDb, result.clipDb));
    return result;
}

function updateMeterDbRange() {
    meterDbRange = Math.max(0.001, settings.maxDb - settings.minDb);
    meterDbInvRange = 1 / meterDbRange;
}

function loadSettings() {
    settings.themeMode = choiceValue(String(readProperty('themeMode')), THEME_CHOICES, DEFAULTS.themeMode);
    settings.accentMode = choiceValue(String(readProperty('accentMode')), ACCENT_CHOICES, DEFAULTS.accentMode);
    settings.customAccent = RivageUI.opaque(Number(readProperty('customAccent')) || DEFAULTS.customAccent);
    settings.palette = choiceValue(String(readProperty('palette')), PALETTE_CHOICES, DEFAULTS.palette);
    settings.customMeter = RivageUI.opaque(Number(readProperty('customMeter')) || DEFAULTS.customMeter);
    settings.customPeak = RivageUI.opaque(Number(readProperty('customPeak')) || DEFAULTS.customPeak);

    settings.orientation = choiceValue(String(readProperty('orientation')), ORIENTATION_CHOICES, DEFAULTS.orientation);
    settings.stereoLayout = choiceValue(String(readProperty('stereoLayout')), STEREO_LAYOUT_CHOICES, DEFAULTS.stereoLayout);
    settings.meterStyle = choiceValue(String(readProperty('meterStyle')), STYLE_CHOICES, DEFAULTS.meterStyle);
    settings.segmentDb = numberChoiceValue(readProperty('segmentDb'), SEGMENT_DB_CHOICES, DEFAULTS.segmentDb);
    settings.segmentGap = Math.round(clampNumber(readProperty('segmentGap'), 0, 8, DEFAULTS.segmentGap));

    settings.minDb = numberChoiceValue(readProperty('minDb'), MIN_DB_CHOICES, DEFAULTS.minDb);
    settings.maxDb = numberChoiceValue(readProperty('maxDb'), MAX_DB_CHOICES, DEFAULTS.maxDb);
    settings.warningDb = numberChoiceValue(readProperty('warningDb'), WARNING_DB_CHOICES, DEFAULTS.warningDb);
    settings.clipDb = numberChoiceValue(readProperty('clipDb'), CLIP_DB_CHOICES, DEFAULTS.clipDb);

    settings.showHeader = !!readProperty('showHeader');
    settings.showScale = !!readProperty('showScale');
    settings.showLabels = !!readProperty('showLabels');
    settings.showValues = !!readProperty('showValues');
    settings.showGrid = !!readProperty('showGrid');
    settings.showPeak = !!readProperty('showPeak');
    settings.showFrame = !!readProperty('showFrame');
    settings.showAccentLine = !!readProperty('showAccentLine');
    settings.hoverTooltip = !!readProperty('hoverTooltip');

    settings.outerPadding = Math.round(clampNumber(readProperty('outerPadding'), 0, 32, DEFAULTS.outerPadding));
    settings.channelGap = Math.round(clampNumber(readProperty('channelGap'), 0, 24, DEFAULTS.channelGap));
    settings.cornerRadius = Math.round(clampNumber(readProperty('cornerRadius'), 0, 16, DEFAULTS.cornerRadius));
    settings.peakThickness = Math.round(clampNumber(readProperty('peakThickness'), 1, 8, DEFAULTS.peakThickness));

    settings.fps = numberChoiceValue(readProperty('fps'), FPS_CHOICES, DEFAULTS.fps);
    settings.rmsWindowMs = numberChoiceValue(readProperty('rmsWindowMs'), RMS_WINDOW_CHOICES, DEFAULTS.rmsWindowMs);
    settings.response = choiceValue(String(readProperty('response')), RESPONSE_CHOICES, DEFAULTS.response);
    settings.peakHoldMs = numberChoiceValue(readProperty('peakHoldMs'), PEAK_HOLD_CHOICES, DEFAULTS.peakHoldMs);
    settings.peakDecay = choiceValue(String(readProperty('peakDecay')), PEAK_DECAY_CHOICES, DEFAULTS.peakDecay);

    var thresholds = normaliseThresholdValues(settings);
    settings.minDb = thresholds.minDb;
    settings.maxDb = thresholds.maxDb;
    settings.warningDb = thresholds.warningDb;
    settings.clipDb = thresholds.clipDb;
    updateMeterDbRange();
}

function setStoredSetting(key, value) {
    if (settings[key] === value) return false;
    try {
        writeProperty(key, value);
    } catch (e) {
        return false;
    }
    settings[key] = value;
    return true;
}

function persistSettingBatch(values) {
    var changes = [];
    var key;

    for (key in values) {
        if (!Object.prototype.hasOwnProperty.call(values, key) || settings[key] === values[key]) continue;
        changes.push({ key: key, oldValue: settings[key], newValue: values[key] });
    }
    if (!changes.length) return false;

    var written = 0;
    try {
        for (; written < changes.length; written++) {
            writeProperty(changes[written].key, changes[written].newValue);
        }
    } catch (e) {
        while (written > 0) {
            written--;
            try { writeProperty(changes[written].key, changes[written].oldValue); } catch (rollbackError) { reportFailure('a setting rollback could not be saved', rollbackError); }
        }
        return null;
    }

    for (var i = 0; i < changes.length; i++) {
        settings[changes[i].key] = changes[i].newValue;
    }
    return true;
}

function setThresholdSetting(key, value) {
    var next = normaliseThresholdValues({
        minDb: key === 'minDb' ? value : settings.minDb,
        maxDb: key === 'maxDb' ? value : settings.maxDb,
        warningDb: key === 'warningDb' ? value : settings.warningDb,
        clipDb: key === 'clipDb' ? value : settings.clipDb
    });
    var result = persistSettingBatch(next);
    if (result) updateMeterDbRange();
    return result === true;
}

function resetSettings() {
    if (persistSettingBatch(DEFAULTS) === null) return;
    updateMeterDbRange();
    refreshResponseCoefficients();
    invalidateStaticCaches();
    refreshVisualResources(true);
    applyMeterEngineSettings(true);
    displayedRms = [];
    clearPeakMarkers();
    SharedAccentProtocol.request();
    window.Repaint();
}

loadInstanceId();
loadSettings();


var panelW = 0;
var panelH = 0;
var panelDpi = 72;
var hostVisualInfo = null;
var hostFontName = 'Segoe UI';
var sharedAlbumAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);
var theme = RivageUI.createTheme({ accent: sharedAlbumAccent });
var painter = RivageUI.createPainter({ scale: scale, theme: theme });

var titleFont = null;
var metaFont = null;
var valueFont = null;
var labelFont = null;
var scaleFont = null;

var d2dTitleFont = null;
var d2dMetaFont = null;
var d2dValueFont = null;
var d2dLabelFont = null;
var d2dScaleFont = null;
var d2dTooltipFont = null;
var d2dFontCache = Object.create(null);
var d2dBrushCache = Object.create(null);
var meterRenderCache = null;
var dbTicksCache = null;
var layoutDirty = true;
var layoutCacheW = -1;
var layoutCacheH = -1;
var layoutCacheCount = -1;

function clearD2DBrushCache() {
    d2dBrushCache = Object.create(null);
}

function d2dPaint(colour) {
    if (window.DrawMode !== 1 || typeof d2d === 'undefined' || typeof d2d.Brush !== 'function') {
        return colour;
    }
    if (colour && typeof colour === 'object') return colour;

    var numeric = Number(colour);
    if (!isFinite(numeric)) return colour;
    var key = numeric | 0;
    var cached = d2dBrushCache[key];
    if (cached !== undefined) return cached;

    try {
        cached = d2d.Brush(0, numeric);
        if (cached) {
            d2dBrushCache[key] = cached;
            return cached;
        }
    } catch (e) { }
    return numeric;
}

function invalidateLayout() {
    layoutDirty = true;
    channelHitRects = [];
}

function invalidateMeterRenderCache() {
    meterRenderCache = null;
}

function invalidateStaticCaches() {
    invalidateMeterRenderCache();
    dbTicksCache = null;
    invalidateLayout();
}

function refreshPanelDpi() {
    var nextDpi = 72;
    try {
        if (Number(window.DPI) > 0) nextDpi = Number(window.DPI);
    } catch (e) { }
    if (nextDpi !== panelDpi) invalidateLayout();
    panelDpi = nextDpi;
}

function scale(value) {
    value = Number(value);
    if (!isFinite(value) || value === 0) return 0;
    return Math.max(1, Math.round(value * panelDpi / 72));
}

function currentAccent() {
    if (settings.accentMode === 'custom') return RivageUI.opaque(settings.customAccent);
    if (settings.accentMode === 'fixed') return RivageUI.opaque(RivageUI.DEFAULT_ACCENT);
    return sharedAlbumAccent;
}

function refreshTheme() {
    clearD2DBrushCache();
    invalidateStaticCaches();
    hostVisualInfo = RivageUI.hostInfo();
    hostFontName = hostVisualInfo.fontFamily || 'Segoe UI';
    theme = RivageUI.createTheme({
        host: hostVisualInfo,
        mode: settings.themeMode,
        accent: currentAccent()
    });
    painter.setTheme(theme);
}

function clearD2DFontCache() {
    d2dFontCache = Object.create(null);
}

function makeD2DFontForFamily(family, sizePx, style) {
    if (window.DrawMode !== 1 || typeof d2d === 'undefined' || typeof d2d.Font !== 'function') return null;
    family = String(family || 'Segoe UI');
    style = style || 0;
    var key = family + '\u0001' + sizePx + '\u0001' + style;
    if (Object.prototype.hasOwnProperty.call(d2dFontCache, key)) return d2dFontCache[key];

    var font = null;
    try { font = d2d.Font(family, sizePx, style); } catch (e) { }
    if (!font && family.toLowerCase() !== 'segoe ui') {
        try { font = d2d.Font('Segoe UI', sizePx, style); } catch (e2) { }
    }
    if (font) d2dFontCache[key] = font;
    return font;
}

function makeD2DFont(sizePx, style) {
    return makeD2DFontForFamily(hostFontName, sizePx, style);
}

function rebuildFonts(clearCache) {
    if (clearCache) {
        RivageUI.clearFontCache();
        clearD2DFontCache();
    }

    var titleSize = Math.max(9, scale(10));
    var metaSize = Math.max(7, scale(7));
    var valueSize = Math.max(8, scale(8));
    var labelSize = Math.max(7, scale(7));
    var scaleSize = Math.max(6, scale(6));
    var consoleFont = RivageUI.consoleFontInfo();

    titleFont = RivageUI.font(hostFontName, titleSize, 1);
    metaFont = RivageUI.font(hostFontName, metaSize, 0);
    valueFont = RivageUI.font(hostFontName, valueSize, 1);
    labelFont = RivageUI.font(hostFontName, labelSize, 1);
    scaleFont = RivageUI.font(hostFontName, scaleSize, 0);

    // JSplitter binds D2D fonts to DrawMode; cache them and rebuild only for font/DPI changes.
    d2dTitleFont = makeD2DFont(titleSize, 1);
    d2dMetaFont = makeD2DFont(metaSize, 0);
    d2dValueFont = makeD2DFont(valueSize, 1);
    d2dLabelFont = makeD2DFont(labelSize, 1);
    d2dScaleFont = makeD2DFont(scaleSize, 0);
    d2dTooltipFont = makeD2DFontForFamily(consoleFont.fontFamily, consoleFont.fontSize, consoleFont.fontStyle || 0);
    invalidateLayout();
}

function refreshVisualResources(clearFontCache) {
    refreshPanelDpi();
    refreshTheme();
    rebuildFonts(clearFontCache);
}

function drawTextFast(gr, text, gdiFont, directFont, colour, x, y, w, h, flags) {
    if (!gr || w <= 0 || h <= 0) return;
    if (directFont && typeof gr.DrawText === 'function') {
        try {
            gr.DrawText(String(text), directFont, d2dPaint(colour), x, y, w, h, flags || 0);
            return;
        } catch (e) { }
    }
    if (gdiFont && typeof gr.GdiDrawText === 'function') {
        try { gr.GdiDrawText(String(text), gdiFont, colour, x, y, w, h, flags || 0); } catch (e2) { reportFailure('text could not be drawn', e2); }
    }
}

function measureTextFast(gr, text, gdiFont, directFont) {
    if (directFont && gr && typeof gr.CalcTextWidth === 'function') {
        try { return gr.CalcTextWidth(String(text), directFont, false); } catch (e) { }
    }
    return RivageUI.measureText(text, gdiFont, true);
}

var displayedRms = [];
var playbackPaused = !!fb.IsPaused;
var suspendedForVisibility = false;
var METER_REFERENCE_FRAME_MS = 1000 / 60;
var responseAttack = 0.68;
var responseRelease = 0.17;

function refreshResponseCoefficients() {
    if (settings.response === 'fast') {
        responseAttack = 0.88;
        responseRelease = 0.30;
    } else if (settings.response === 'smooth') {
        responseAttack = 0.42;
        responseRelease = 0.09;
    } else {
        responseAttack = 0.68;
        responseRelease = 0.17;
    }
}

function peakDecayBaseMultiplier() {
    if (settings.peakDecay === 'fast') return 0.965;
    if (settings.peakDecay === 'medium') return 0.980;
    if (settings.peakDecay === 'very_slow') return 0.996;
    return 0.990;
}

function adjustedBlendCoefficient(base, elapsedMs) {
    var frames = Math.max(0, Number(elapsedMs) || 0) / METER_REFERENCE_FRAME_MS;
    return 1 - Math.pow(1 - base, frames);
}

function adjustedDecayMultiplier(base, elapsedMs) {
    var frames = Math.max(0, Number(elapsedMs) || 0) / METER_REFERENCE_FRAME_MS;
    return Math.pow(base, frames);
}

function updateDisplayedRms(elapsedMs) {
    var count = Math.max(1, Number(vuMeter.channels.count) || 1);
    displayedRms.length = count;

    for (var c = 0; c < count; c++) {
        var raw = Math.max(0, Number(vuMeter.RMS_levels[c]) || 0);
        var current = Math.max(0, Number(displayedRms[c]) || 0);
        var base = raw >= current ? responseAttack : responseRelease;
        var coefficient = adjustedBlendCoefficient(base, elapsedMs);
        var next = current + (raw - current) * coefficient;
        displayedRms[c] = next < 0.000001 ? 0 : next;
    }
}

function AudioMeter() {
    this.channels = { count: 2, config: 0 };
    this.RMS_levels = [];
    this.Peak_levels = [];
    this.peakHoldElapsed = [];
    this.timer_id = 0;
    this.timer_generation = 0;
    this.timer_interval = 1000 / DEFAULTS.fps;
    this.rms_window = DEFAULTS.rmsWindowMs / 1000;
    this.last_update_ms = 0;
    this.active = true;
}

AudioMeter.prototype.clear_graph = function () {
    var count = Math.max(1, Number(this.channels.count) || 1);
    this.RMS_levels.length = count;
    this.Peak_levels.length = count;
    this.peakHoldElapsed.length = count;
    for (var c = 0; c < count; c++) {
        this.RMS_levels[c] = 0;
        this.Peak_levels[c] = 0;
        this.peakHoldElapsed[c] = 0;
    }
};

AudioMeter.prototype.stop_timer = function () {
    this.timer_generation += 1;
    var timerId = this.timer_id;
    this.timer_id = 0;
    this.last_update_ms = 0;
    if (!timerId) return;
    try { window.ClearInterval(timerId); } catch (e) { }
};

AudioMeter.prototype.start_timer = function () {
    if (!this.active || this.timer_id || playbackPaused || !fb.IsPlaying || fb.IsPaused) return;

    var self = this;
    var generation = ++this.timer_generation;
    this.last_update_ms = Date.now();
    try {
        this.timer_id = window.SetInterval(function () {
            if (!self.active || generation !== self.timer_generation) return;
            self.update_graph(generation);
        }, Math.max(1, this.timer_interval));
    } catch (e) {
        this.timer_id = 0;
    }
};

AudioMeter.prototype.update_graph = function (generation) {
    if (!this.active || (generation !== undefined && generation !== this.timer_generation)) return;
    if (playbackPaused || !fb.IsPlaying || fb.IsPaused) return;
    if (!VisiblePaintWork.isVisible()) {
        suspendMeterForVisibility();
        return;
    }

    var now = Date.now();
    var elapsedMs = this.last_update_ms > 0 ? now - this.last_update_ms : this.timer_interval;
    this.last_update_ms = now;
    if (!isFinite(elapsedMs) || elapsedMs <= 0) elapsedMs = this.timer_interval;
    elapsedMs = Math.min(250, Math.max(1, elapsedMs));

    if (Number(fb.PlaybackTime) < this.rms_window) return;

    var chunk;
    try { chunk = fb.GetAudioChunk(this.rms_window); } catch (e) { return; }
    if (!chunk) return;

    var count = Math.max(1, Math.round(Number(chunk.ChannelCount) || 0));
    var data = chunk.Data;
    var frameLength = Math.max(0, Math.round(Number(chunk.SampleCount) || 0));
    if (!data || !data.length || frameLength <= 0) return;

    this.channels.count = count;
    this.channels.config = Number(chunk.ChannelConfig) || 0;
    this.RMS_levels.length = count;
    this.Peak_levels.length = count;
    this.peakHoldElapsed.length = count;

    for (var c = 0; c < count; c++) {
        var sum = 0;
        var peak = 0;
        for (var i = c; i < data.length; i += count) {
            var sample = Math.abs(Number(data[i]) || 0);
            if (sample > peak) peak = sample;
            sum += sample * sample;
        }

        this.RMS_levels[c] = Math.sqrt(sum / frameLength);
        var currentPeak = Math.max(0, Number(this.Peak_levels[c]) || 0);
        if (peak >= currentPeak) {
            this.Peak_levels[c] = peak;
            this.peakHoldElapsed[c] = 0;
        } else {
            var previousHold = Math.max(0, Number(this.peakHoldElapsed[c]) || 0);
            var nextHold = previousHold + elapsedMs;
            var holdMs = Math.max(0, Number(settings.peakHoldMs) || 0);
            var decayMs = Math.max(0, nextHold - holdMs) - Math.max(0, previousHold - holdMs);
            this.peakHoldElapsed[c] = nextHold;
            if (decayMs > 0) {
                this.Peak_levels[c] = currentPeak * adjustedDecayMultiplier(peakDecayBaseMultiplier(), decayMs);
            }
        }
    }

    updateDisplayedRms(elapsedMs);
    window.Repaint();
};

AudioMeter.prototype.init = function () {
    if (fb.IsPlaying && !playbackPaused && !fb.IsPaused) this.start_timer();
};

AudioMeter.prototype.playback_stop = function (reason) {
    if (reason !== 2) this.stop_timer();
    this.clear_graph();
};

AudioMeter.prototype.shutdown = function () {
    this.active = false;
    this.stop_timer();
};

var vuMeter = new AudioMeter();

function suspendMeterForVisibility() {
    // A playback callback can restart polling while the panel is hidden, so always stop here.
    suspendedForVisibility = true;
    vuMeter.stop_timer();
}

function resumeMeterIfVisible() {
    if (!suspendedForVisibility) return;
    suspendedForVisibility = false;
    if (fb.IsPlaying && !playbackPaused && !fb.IsPaused) vuMeter.start_timer();
}

function applyMeterEngineSettings(restartTimer) {
    vuMeter.timer_interval = 1000 / settings.fps;
    vuMeter.rms_window = settings.rmsWindowMs / 1000;
    if (!restartTimer) return;

    vuMeter.stop_timer();
    if (fb.IsPlaying && !playbackPaused && !fb.IsPaused) vuMeter.start_timer();
}

function clearPeakMarkers() {
    var count = Math.max(1, Number(vuMeter.channels.count) || 1);
    for (var c = 0; c < count; c++) {
        vuMeter.Peak_levels[c] = Math.max(0, Number(displayedRms[c]) || 0);
        vuMeter.peakHoldElapsed[c] = 0;
    }
    window.Repaint();
}

applyMeterEngineSettings(false);
refreshResponseCoefficients();
refreshVisualResources(true);
vuMeter.init();

// ============================================================================
// Drawing helpers
// ============================================================================

var layout = null;
var channelHitRects = [];
var hoveredChannel = -1;
var mouseX = 0;
var mouseY = 0;

var RIVAGE_AMBER = RivageUI.rgb(236, 179, 60);
var CLASSIC_GREEN = RivageUI.rgb(65, 199, 107);
var CLASSIC_AMBER = RivageUI.rgb(244, 182, 54);
var CLASSIC_RED = RivageUI.rgb(232, 74, 72);

function makeRect(x, y, w, h) {
    return RivageUI.rect(x, y, Math.max(0, w), Math.max(0, h));
}

function insetRect(rect, amountX, amountY) {
    amountX = Math.max(0, Math.round(Number(amountX) || 0));
    amountY = amountY === undefined ? amountX : Math.max(0, Math.round(Number(amountY) || 0));
    return makeRect(
        rect.x + amountX,
        rect.y + amountY,
        Math.max(0, rect.w - amountX * 2),
        Math.max(0, rect.h - amountY * 2)
    );
}

// GDI+'s rounded-rectangle methods throw when their arc arguments are zero,
// non-integer, or too large for very small rectangles. Meter lanes can become
// only one or two pixels thick in compact/multichannel layouts, so all rounded
// drawing is normalised here and falls back to square geometry when necessary.
function scaledRadius(value) {
    value = Number(value);
    if (!isFinite(value) || value <= 0) return 0;
    return Math.max(1, Math.round(scale(value)));
}

function safeRadiusForSize(width, height, preferredRadius) {
    width = Math.max(0, Math.round(Number(width) || 0));
    height = Math.max(0, Math.round(Number(height) || 0));
    if (width < 3 || height < 3) return 0;

    var maximum = Math.floor((Math.min(width, height) - 1) / 2);
    if (maximum < 1) return 0;
    return Math.max(0, Math.min(maximum, scaledRadius(preferredRadius)));
}

function fillRectSafe(gr, rect, colour) {
    rect = makeRect(rect.x, rect.y, rect.w, rect.h);
    if (!gr || rect.w <= 0 || rect.h <= 0 || typeof gr.FillSolidRect !== 'function') return;
    gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, d2dPaint(colour));
}

function fillRoundRectSafe(gr, rect, preferredRadius, colour) {
    rect = makeRect(rect.x, rect.y, rect.w, rect.h);
    if (!gr || rect.w <= 0 || rect.h <= 0) return;

    var radius = safeRadiusForSize(rect.w, rect.h, preferredRadius);
    if (radius <= 0 || typeof gr.FillRoundRect !== 'function') {
        fillRectSafe(gr, rect, colour);
        return;
    }

    try {
        gr.FillRoundRect(rect.x, rect.y, rect.w, rect.h, radius, radius, d2dPaint(colour));
    } catch (e) {
        // Some panel hosts reject otherwise legal edge-case arc geometry.
        fillRectSafe(gr, rect, colour);
    }
}

function drawSquareBorderSafe(gr, rect, lineWidth, colour) {
    rect = makeRect(rect.x, rect.y, rect.w, rect.h);
    if (!gr || rect.w <= 0 || rect.h <= 0) return;

    var thickness = Math.max(1, Math.round(Number(lineWidth) || 1));
    thickness = Math.min(thickness, rect.w, rect.h);

    fillRectSafe(gr, makeRect(rect.x, rect.y, rect.w, thickness), colour);
    if (rect.h > thickness) {
        fillRectSafe(gr, makeRect(rect.x, rect.y + rect.h - thickness, rect.w, thickness), colour);
    }

    var sideHeight = Math.max(0, rect.h - thickness * 2);
    if (sideHeight > 0) {
        fillRectSafe(gr, makeRect(rect.x, rect.y + thickness, thickness, sideHeight), colour);
        if (rect.w > thickness) {
            fillRectSafe(gr, makeRect(rect.x + rect.w - thickness, rect.y + thickness, thickness, sideHeight), colour);
        }
    }
}

function drawRoundRectSafe(gr, rect, preferredRadius, lineWidth, colour) {
    rect = makeRect(rect.x, rect.y, rect.w, rect.h);
    if (!gr || rect.w <= 0 || rect.h <= 0) return;

    var drawWidth = Math.max(0, rect.w - 1);
    var drawHeight = Math.max(0, rect.h - 1);
    var radius = safeRadiusForSize(drawWidth, drawHeight, preferredRadius);
    var thickness = Math.max(1, Math.round(Number(lineWidth) || 1));

    if (radius <= 0 || typeof gr.DrawRoundRect !== 'function') {
        drawSquareBorderSafe(gr, rect, thickness, colour);
        return;
    }

    try {
        gr.DrawRoundRect(
            rect.x + 0.5,
            rect.y + 0.5,
            drawWidth,
            drawHeight,
            radius,
            radius,
            thickness,
            d2dPaint(colour)
        );
    } catch (e) {
        drawSquareBorderSafe(gr, rect, thickness, colour);
    }
}

function drawMeterCard(gr, rect, orientation) {
    rect = makeRect(rect.x, rect.y, rect.w, rect.h);
    if (rect.w <= 0 || rect.h <= 0) return;

    fillRoundRectSafe(gr, rect, settings.cornerRadius, getMeterRenderCache().cardPaint);
    if (settings.showFrame) {
        drawRoundRectSafe(gr, rect, settings.cornerRadius, 1, getMeterRenderCache().strokePaint);
    }

    // Orientation-dependent card highlight: top in vertical mode and left
    // in horizontal mode. It can be disabled independently of the card border.
    if (settings.showAccentLine) {
        var inset = Math.max(0, scale(7));
        var thickness = Math.max(1, scale(3));
        var accent = getMeterRenderCache().accentPaint;
        var accentRect;

        if (orientation === 'vertical') {
            accentRect = makeRect(
                rect.x + inset,
                rect.y,
                Math.max(0, rect.w - inset * 2),
                Math.min(rect.h, thickness)
            );
        } else {
            accentRect = makeRect(
                rect.x,
                rect.y + inset,
                Math.min(rect.w, thickness),
                Math.max(0, rect.h - inset * 2)
            );
        }
        fillRectSafe(gr, accentRect, accent);
    }
}

function meterChannelCount() {
    return Math.max(1, Math.min(32, Math.round(Number(vuMeter.channels.count) || 2)));
}

function resolveOrientation() {
    if (settings.orientation === 'horizontal' || settings.orientation === 'vertical') {
        return settings.orientation;
    }
    return panelW >= panelH * 1.15 ? 'horizontal' : 'vertical';
}

function amplitudeToDb(value) {
    value = Number(value);
    if (!(value > 0)) return settings.minDb;
    return Math.max(settings.minDb, Math.min(settings.maxDb, 20 * Math.log(value) / Math.LN10));
}

function dbToNormal(db) {
    return Math.max(0, Math.min(1, (Number(db) - settings.minDb) * meterDbInvRange));
}

function formatDb(value, decimals) {
    value = Number(value);
    if (!isFinite(value) || value <= settings.minDb + 0.001) return '-inf';
    var text = value.toFixed(decimals === undefined ? 1 : decimals);
    return value > 0 ? '+' + text : text;
}

var CHANNEL_NAMES = ['L', 'R', 'C', 'LFE', 'SL', 'SR', 'BL', 'BR'];

function channelName(index, count) {
    if (count === 1) return 'M';
    return CHANNEL_NAMES[index] || String(index + 1);
}

function buildMeterRenderCache() {
    var accent = currentAccent();
    var customMeter = RivageUI.opaque(settings.customMeter);
    var customPeak = RivageUI.opaque(settings.customPeak);
    var black = RivageUI.rgb(0, 0, 0);
    var darkGreen = theme.dark ? CLASSIC_GREEN : RivageUI.mix(CLASSIC_GREEN, black, 0.18);
    var amber = theme.dynamic && theme.tertiary !== undefined
        ? theme.tertiary
        : (theme.dark ? RIVAGE_AMBER : RivageUI.mix(RIVAGE_AMBER, black, 0.18));
    var red = theme.dark ? theme.danger : RivageUI.mix(theme.danger, black, 0.10);
    var colours;

    if (settings.palette === 'accent') {
        colours = { low: accent, warning: accent, danger: accent, peak: theme.textPrimary };
    } else if (settings.palette === 'classic') {
        colours = { low: darkGreen, warning: CLASSIC_AMBER, danger: CLASSIC_RED, peak: CLASSIC_RED };
    } else if (settings.palette === 'custom') {
        colours = {
            low: customMeter,
            warning: RivageUI.mix(customMeter, amber, 0.58),
            danger: customPeak,
            peak: customPeak
        };
    } else {
        colours = { low: accent, warning: amber, danger: red, peak: red };
    }

    var unlitNormal = RivageUI.mix(theme.card, theme.textPrimary, theme.dark ? 0.10 : 0.07);
    var unlitHover = RivageUI.mix(theme.surfaceHover, accent, 0.08);
    var gridNormal = RivageUI.mix(theme.background, theme.textPrimary, theme.dark ? 0.17 : 0.13);
    var gridZero = RivageUI.mix(theme.background, theme.textPrimary, 0.34);
    var gridWarning = RivageUI.mix(theme.background, colours.warning, 0.48);
    var gridClip = RivageUI.mix(theme.background, colours.danger, 0.58);
    var hoverStroke = RivageUI.mix(theme.strokeHot, accent, 0.30);

    meterRenderCache = {
        accent: accent,
        colours: colours,
        breaks: [settings.minDb, settings.warningDb, settings.clipDb, settings.maxDb],
        peakThicknessPx: Math.max(1, scale(settings.peakThickness)),
        backgroundPaint: d2dPaint(theme.background),
        cardPaint: d2dPaint(theme.card),
        strokePaint: d2dPaint(theme.stroke),
        accentPaint: d2dPaint(accent),
        lowPaint: d2dPaint(colours.low),
        warningPaint: d2dPaint(colours.warning),
        dangerPaint: d2dPaint(colours.danger),
        peakPaint: d2dPaint(colours.peak),
        unlitNormalPaint: d2dPaint(unlitNormal),
        unlitHoverPaint: d2dPaint(unlitHover),
        gridNormalPaint: d2dPaint(gridNormal),
        gridZeroPaint: d2dPaint(gridZero),
        gridWarningPaint: d2dPaint(gridWarning),
        gridClipPaint: d2dPaint(gridClip),
        hoverStrokePaint: d2dPaint(hoverStroke)
    };
    return meterRenderCache;
}

function getMeterRenderCache() {
    return meterRenderCache || buildMeterRenderCache();
}

function meterColours() {
    return getMeterRenderCache().colours;
}

function paintForDb(db) {
    var cache = getMeterRenderCache();
    if (db >= settings.clipDb) return cache.dangerPaint;
    if (db >= settings.warningDb) return cache.warningPaint;
    return cache.lowPaint;
}

function peakPaintForDb(db) {
    var cache = getMeterRenderCache();
    if (settings.palette === 'accent' && db < settings.clipDb) return cache.peakPaint;
    if (db >= settings.clipDb) return cache.dangerPaint;
    if (db >= settings.warningDb) return cache.warningPaint;
    return cache.peakPaint;
}

function unlitPaint(hovered) {
    var cache = getMeterRenderCache();
    return hovered ? cache.unlitHoverPaint : cache.unlitNormalPaint;
}

function gridPaintKind(db) {
    if (db === settings.clipDb) return 3;
    if (db === settings.warningDb) return 2;
    if (db === 0) return 1;
    return 0;
}

function gridPaintByKind(kind) {
    var cache = getMeterRenderCache();
    if (kind === 3) return cache.gridClipPaint;
    if (kind === 2) return cache.gridWarningPaint;
    if (kind === 1) return cache.gridZeroPaint;
    return cache.gridNormalPaint;
}

function zoneForDb(db) {
    if (db >= settings.clipDb) return 2;
    if (db >= settings.warningDb) return 1;
    return 0;
}

function zonePaint(zone) {
    var cache = getMeterRenderCache();
    if (zone === 2) return cache.dangerPaint;
    if (zone === 1) return cache.warningPaint;
    return cache.lowPaint;
}

function dbTicks() {
    if (dbTicksCache) return dbTicksCache;

    var candidates = [
        settings.minDb, -60, -48, -36, -24, -18, settings.warningDb,
        -12, -9, -6, settings.clipDb, -3, -1, 0, settings.maxDb
    ];
    var ticks = [];
    var seen = Object.create(null);
    var i;

    for (i = 0; i < candidates.length; i++) {
        var value = Number(candidates[i]);
        if (value < settings.minDb || value > settings.maxDb) continue;
        if (seen[value]) continue;
        seen[value] = true;
        ticks.push(value);
    }
    ticks.sort(function (a, b) { return a - b; });
    dbTicksCache = ticks;
    return dbTicksCache;
}

function drawSmoothHorizontal(gr, rect, levelDb, reverse) {
    var level = Math.max(settings.minDb, Math.min(settings.maxDb, levelDb));
    var breaks = getMeterRenderCache().breaks;
    var i;

    for (i = 0; i < breaks.length - 1; i++) {
        var startDb = breaks[i];
        var endDb = Math.min(level, breaks[i + 1]);
        if (endDb <= startDb) continue;

        var startNormal = dbToNormal(startDb);
        var endNormal = dbToNormal(endDb);
        var startPx = Math.round(rect.w * startNormal);
        var endPx = Math.round(rect.w * endNormal);
        var width = Math.max(1, endPx - startPx);
        var x = reverse ? rect.x + rect.w - endPx : rect.x + startPx;
        gr.FillSolidRect(x, rect.y, width, rect.h, paintForDb((startDb + endDb) / 2));
    }
}

function drawSmoothVertical(gr, rect, levelDb) {
    var level = Math.max(settings.minDb, Math.min(settings.maxDb, levelDb));
    var breaks = getMeterRenderCache().breaks;
    var i;

    for (i = 0; i < breaks.length - 1; i++) {
        var startDb = breaks[i];
        var endDb = Math.min(level, breaks[i + 1]);
        if (endDb <= startDb) continue;

        var startNormal = dbToNormal(startDb);
        var endNormal = dbToNormal(endDb);
        var startPx = Math.round(rect.h * startNormal);
        var endPx = Math.round(rect.h * endNormal);
        var height = Math.max(1, endPx - startPx);
        var y = rect.y + rect.h - endPx;
        gr.FillSolidRect(rect.x, y, rect.w, height, paintForDb((startDb + endDb) / 2));
    }
}

function segmentCountForLength(length) {
    var desired = Math.max(1, Math.ceil(meterDbRange / settings.segmentDb));
    var minimumSegment = Math.max(2, scale(2));
    var gap = Math.max(0, scale(settings.segmentGap));
    var fitting = Math.max(1, Math.floor((length + gap) / Math.max(1, minimumSegment + gap)));
    return Math.max(1, Math.min(80, desired, fitting));
}

function drawSegmentedHorizontal(gr, lane, levelDb, hovered) {
    var rect = lane.meter;
    var count = lane.segmentCount || 0;
    if (count <= 0) return;

    var logicalLevel = dbToNormal(levelDb);
    var litCount = Math.max(0, Math.min(count, Math.ceil(logicalLevel * count)));
    var unlit = unlitPaint(hovered);
    var starts = lane.segmentStarts;
    var sizes = lane.segmentSizes;
    var paints = lane.segmentPaints;
    var i;

    for (i = 0; i < count; i++) {
        gr.FillSolidRect(starts[i], rect.y, sizes[i], rect.h,
            i < litCount ? paints[i] : unlit);
    }
}

function drawSegmentedVertical(gr, lane, levelDb, hovered) {
    var rect = lane.meter;
    var count = lane.segmentCount || 0;
    if (count <= 0) return;

    var logicalLevel = dbToNormal(levelDb);
    var litCount = Math.max(0, Math.min(count, Math.ceil(logicalLevel * count)));
    var unlit = unlitPaint(hovered);
    var starts = lane.segmentStarts;
    var sizes = lane.segmentSizes;
    var paints = lane.segmentPaints;
    var i;

    for (i = 0; i < count; i++) {
        gr.FillSolidRect(rect.x, starts[i], rect.w, sizes[i],
            i < litCount ? paints[i] : unlit);
    }
}

function drawLaneGrid(gr, lane) {
    if (!settings.showGrid || !lane.gridPositions) return;
    var rect = lane.meter;
    var positions = lane.gridPositions;
    var paints = lane.gridPaints;
    var i;

    if (layout.orientation === 'horizontal') {
        for (i = 0; i < positions.length; i++) {
            gr.FillSolidRect(positions[i], rect.y, 1, rect.h, paints[i]);
        }
    } else {
        for (i = 0; i < positions.length; i++) {
            gr.FillSolidRect(rect.x, positions[i], rect.w, 1, paints[i]);
        }
    }
}

function drawHorizontalPeak(gr, rect, peakDb, reverse) {
    if (!settings.showPeak || peakDb <= settings.minDb) return;
    var thickness = getMeterRenderCache().peakThicknessPx;
    var offset = Math.round(rect.w * dbToNormal(peakDb));
    var x = reverse ? rect.x + rect.w - offset : rect.x + offset;
    x = Math.max(rect.x, Math.min(rect.x + rect.w - thickness, x - Math.floor(thickness / 2)));
    gr.FillSolidRect(x, rect.y, thickness, rect.h, peakPaintForDb(peakDb));
}

function drawVerticalPeak(gr, rect, peakDb) {
    if (!settings.showPeak || peakDb <= settings.minDb) return;
    var thickness = getMeterRenderCache().peakThicknessPx;
    var y = rect.y + rect.h - Math.round(rect.h * dbToNormal(peakDb));
    y = Math.max(rect.y, Math.min(rect.y + rect.h - thickness, y - Math.floor(thickness / 2)));
    gr.FillSolidRect(rect.x, y, rect.w, thickness, peakPaintForDb(peakDb));
}

function drawHorizontalMeter(gr, lane, levelDb, peakDb, hovered) {
    var rect = lane.meter;
    if (rect.w <= 0 || rect.h <= 0) return;
    fillRoundRectSafe(gr, rect, settings.cornerRadius, unlitPaint(hovered));

    if (settings.meterStyle === 'segments') {
        drawSegmentedHorizontal(gr, lane, levelDb, hovered);
    } else {
        drawSmoothHorizontal(gr, rect, levelDb, !!lane.reverse);
    }
    drawLaneGrid(gr, lane);
    drawHorizontalPeak(gr, rect, peakDb, !!lane.reverse);

    if (hovered) {
        drawRoundRectSafe(gr, rect, settings.cornerRadius, 1, getMeterRenderCache().hoverStrokePaint);
    }
}

function drawVerticalMeter(gr, lane, levelDb, peakDb, hovered) {
    var rect = lane.meter;
    if (rect.w <= 0 || rect.h <= 0) return;
    fillRoundRectSafe(gr, rect, settings.cornerRadius, unlitPaint(hovered));

    if (settings.meterStyle === 'segments') {
        drawSegmentedVertical(gr, lane, levelDb, hovered);
    } else {
        drawSmoothVertical(gr, rect, levelDb);
    }
    drawLaneGrid(gr, lane);
    drawVerticalPeak(gr, rect, peakDb);

    if (hovered) {
        drawRoundRectSafe(gr, rect, settings.cornerRadius, 1, getMeterRenderCache().hoverStrokePaint);
    }
}

function makeScaleLabel(db) {
    if (db === 0) return '0';
    return db > 0 ? '+' + String(db) : String(db);
}

function prepareHorizontalScaleLabels(gr, entry) {
    if (entry.labels) return entry.labels;
    var rect = entry.rect;
    var ticks = dbTicks();
    var labels = [];
    var i;

    for (i = 0; i < ticks.length; i++) {
        var x = entry.reverse
            ? rect.x + rect.w - Math.round(rect.w * dbToNormal(ticks[i]))
            : rect.x + Math.round(rect.w * dbToNormal(ticks[i]));
        labels.push({ x: x, text: makeScaleLabel(ticks[i]) });
    }
    labels.sort(function (a, b) { return a.x - b.x; });

    var accepted = [];
    var lastRight = -100000;
    var gap = scale(3);
    for (i = 0; i < labels.length; i++) {
        var width = Math.max(scale(12), measureTextFast(gr, labels[i].text, scaleFont, d2dScaleFont) + scale(4));
        var left = Math.max(rect.x, Math.min(rect.x + rect.w - width, labels[i].x - width / 2));
        if (left < lastRight + gap) continue;
        accepted.push({ left: left, width: width, text: labels[i].text });
        lastRight = left + width;
    }
    entry.labels = accepted;
    return accepted;
}

function drawHorizontalScale(gr, entry) {
    var rect = entry && entry.rect;
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    var labels = prepareHorizontalScaleLabels(gr, entry);
    var i;
    for (i = 0; i < labels.length; i++) {
        drawTextFast(gr, labels[i].text, scaleFont, d2dScaleFont, theme.textTertiary,
            labels[i].left, rect.y, labels[i].width, rect.h, RivageUI.textFlags.centered);
    }
}

function prepareVerticalScaleLabels(entry) {
    if (entry.labels) return entry.labels;
    var rect = entry.rect;
    var ticks = dbTicks();
    var labels = [];
    var i;
    var lineH = Math.max(scale(10), scale(11));

    for (i = 0; i < ticks.length; i++) {
        labels.push({
            y: rect.y + rect.h - Math.round(rect.h * dbToNormal(ticks[i])),
            text: makeScaleLabel(ticks[i])
        });
    }
    labels.sort(function (a, b) { return a.y - b.y; });

    var accepted = [];
    var lastBottom = -100000;
    var gap = scale(2);
    for (i = 0; i < labels.length; i++) {
        var top = Math.max(rect.y, Math.min(rect.y + rect.h - lineH, labels[i].y - lineH / 2));
        if (top < lastBottom + gap) continue;
        accepted.push({ top: top, text: labels[i].text });
        lastBottom = top + lineH;
    }
    entry.labels = accepted;
    entry.lineH = lineH;
    return accepted;
}

function drawVerticalScale(gr, entry) {
    var rect = entry && entry.rect;
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    var labels = prepareVerticalScaleLabels(entry);
    var lineH = entry.lineH;
    var i;
    for (i = 0; i < labels.length; i++) {
        drawTextFast(gr, labels[i].text, scaleFont, d2dScaleFont, theme.textTertiary,
            rect.x, labels[i].top, rect.w - scale(3), lineH, RivageUI.textFlags.right);
    }
}

function getCachedLayout() {
    var count = meterChannelCount();
    if (!layoutDirty && layout && layoutCacheW === panelW && layoutCacheH === panelH && layoutCacheCount === count) {
        return layout;
    }

    layout = calculateLayout(count);
    layoutCacheW = panelW;
    layoutCacheH = panelH;
    layoutCacheCount = count;
    layoutDirty = false;
    prepareLayoutStaticGeometry(layout);
    return layout;
}

function calculateLayout(forcedCount) {

    var orientation = resolveOrientation();
    var count = Math.max(1, Number(forcedCount) || meterChannelCount());
    var outer = Math.max(0, scale(settings.outerPadding));
    var availableW = Math.max(0, panelW - outer * 2);
    var availableH = Math.max(0, panelH - outer * 2);
    var headerVisible = settings.showHeader &&
        availableH >= scale(64) && availableW >= scale(110);
    var headerH = headerVisible ? scale(32) : 0;
    var headerGap = headerVisible ? scale(6) : 0;
    var card = makeRect(
        outer,
        outer + headerH + headerGap,
        availableW,
        Math.max(0, availableH - headerH - headerGap)
    );
    var header = headerVisible
        ? makeRect(outer, outer, availableW, headerH)
        : null;
    // Corner radius is purely visual. It must not consume layout space or make
    // compact panels disappear when the value is increased.
    var preferredInnerInset = Math.max(0, scale(8));
    var maximumInnerInset = Math.max(0, Math.floor((Math.min(card.w, card.h) - 1) / 2));
    var innerInset = Math.min(preferredInnerInset, maximumInnerInset);
    var inner = insetRect(card, innerInset, innerInset);

    layout = {
        orientation: orientation,
        count: count,
        header: header,
        card: card,
        inner: inner,
        mode: 'normal',
        lanes: [],
        scaleRects: []
    };
    if (inner.w <= 0 || inner.h <= 0) return layout;

    if (orientation === 'horizontal' && settings.stereoLayout === 'mirrored' && count === 2) {
        calculateMirroredHorizontalLayout(layout);
    } else if (orientation === 'horizontal') {
        calculateStackedHorizontalLayout(layout);
    } else {
        calculateVerticalLayout(layout);
    }

    return layout;
}

function calculateMirroredHorizontalLayout(target) {
    var inner = target.inner;
    var scaleH = settings.showScale && inner.h >= scale(52) ? scale(16) : 0;
    var metaH = (settings.showLabels || settings.showValues) && inner.h >= scale(58) ? scale(18) : 0;
    var requestedCenterGap = Math.max(scale(2), scale(settings.channelGap));
    var centerGap = Math.min(requestedCenterGap, Math.max(0, inner.w - 2));
    var meterTop = inner.y + metaH;
    var meterH = Math.max(1, inner.h - metaH - scaleH);
    var halfW = Math.max(1, Math.floor((inner.w - centerGap) / 2));
    var leftMeter = makeRect(inner.x, meterTop, halfW, meterH);
    var rightMeter = makeRect(inner.x + inner.w - halfW, meterTop, halfW, meterH);

    target.mode = 'mirrored';
    target.lanes = [
        {
            channel: 0,
            meter: leftMeter,
            hit: makeRect(leftMeter.x, inner.y, leftMeter.w, inner.h),
            reverse: true,
            label: makeRect(leftMeter.x, inner.y, scale(24), metaH),
            value: makeRect(leftMeter.x + scale(24), inner.y, Math.max(0, leftMeter.w - scale(24)), metaH)
        },
        {
            channel: 1,
            meter: rightMeter,
            hit: makeRect(rightMeter.x, inner.y, rightMeter.w, inner.h),
            reverse: false,
            label: makeRect(rightMeter.x + Math.max(0, rightMeter.w - scale(24)), inner.y, scale(24), metaH),
            value: makeRect(rightMeter.x, inner.y, Math.max(0, rightMeter.w - scale(24)), metaH)
        }
    ];

    if (scaleH > 0) {
        target.scaleRects = [
            { rect: makeRect(leftMeter.x, leftMeter.y + leftMeter.h, leftMeter.w, scaleH), reverse: true },
            { rect: makeRect(rightMeter.x, rightMeter.y + rightMeter.h, rightMeter.w, scaleH), reverse: false }
        ];
    }
}

function calculateStackedHorizontalLayout(target) {
    var inner = target.inner;
    var count = target.count;
    var scaleH = settings.showScale && inner.h >= scale(58) ? scale(16) : 0;
    var labelW = settings.showLabels && inner.w >= scale(130) ? scale(30) : 0;
    var valueW = settings.showValues && inner.w >= scale(165) ? scale(48) : 0;
    var requestedGap = Math.max(0, scale(settings.channelGap));
    var laneAreaH = Math.max(1, inner.h - scaleH);
    var maximumGap = count > 1
        ? Math.floor(Math.max(0, laneAreaH - count) / (count - 1))
        : 0;
    var gap = Math.min(requestedGap, maximumGap);
    var usableH = Math.max(1, laneAreaH - gap * (count - 1));
    var meterX = inner.x + labelW;
    var meterW = Math.max(1, inner.w - labelW - valueW);
    var i;

    target.mode = 'stacked';
    for (i = 0; i < count; i++) {
        var start = Math.floor(i * usableH / count);
        var end = Math.floor((i + 1) * usableH / count);
        var laneH = Math.max(1, end - start);
        var y = inner.y + start + i * gap;
        laneH = Math.min(laneH, Math.max(0, inner.y + laneAreaH - y));
        var meter = makeRect(meterX, y, meterW, laneH);
        target.lanes.push({
            channel: i,
            meter: meter,
            hit: makeRect(inner.x, y, inner.w, laneH),
            reverse: false,
            label: makeRect(inner.x, y, labelW, laneH),
            value: makeRect(meter.x + meter.w, y, valueW, laneH)
        });
    }

    if (scaleH > 0) {
        target.scaleRects = [{
            rect: makeRect(meterX, inner.y + laneAreaH, meterW, scaleH),
            reverse: false
        }];
    }
}

function calculateVerticalLayout(target) {
    var inner = target.inner;
    var count = target.count;
    var scaleW = settings.showScale && inner.w >= scale(76) ? scale(30) : 0;
    var labelH = settings.showLabels && inner.h >= scale(90) ? scale(16) : 0;
    var valueH = settings.showValues && inner.h >= scale(105) ? scale(18) : 0;
    var requestedGap = Math.max(0, scale(settings.channelGap));
    var meterX = inner.x + scaleW;
    var meterY = inner.y + valueH;
    var meterAreaW = Math.max(1, inner.w - scaleW);
    var maximumGap = count > 1
        ? Math.floor(Math.max(0, meterAreaW - count) / (count - 1))
        : 0;
    var gap = Math.min(requestedGap, maximumGap);
    var usableW = Math.max(1, meterAreaW - gap * (count - 1));
    var meterH = Math.max(1, inner.h - valueH - labelH);
    var i;

    target.mode = 'vertical';
    for (i = 0; i < count; i++) {
        var start = Math.floor(i * usableW / count);
        var end = Math.floor((i + 1) * usableW / count);
        var laneW = Math.max(1, end - start);
        var x = meterX + start + i * gap;
        laneW = Math.min(laneW, Math.max(0, meterX + meterAreaW - x));
        var meter = makeRect(x, meterY, laneW, meterH);
        target.lanes.push({
            channel: i,
            meter: meter,
            hit: makeRect(x, inner.y, laneW, inner.h),
            reverse: false,
            label: makeRect(x, meter.y + meter.h, laneW, labelH),
            value: makeRect(x, inner.y, laneW, valueH)
        });
    }

    if (scaleW > 0) {
        target.scaleRects = [{ rect: makeRect(inner.x, meterY, scaleW, meterH), reverse: false }];
    }
}

function prepareLayoutStaticGeometry(target) {
    channelHitRects = [];
    var ticks = dbTicks();
    var i;

    for (i = 0; i < target.lanes.length; i++) {
        var lane = target.lanes[i];
        var rect = lane.meter;
        channelHitRects[lane.channel] = lane.hit;

        lane.segmentCount = 0;
        lane.segmentStarts = [];
        lane.segmentSizes = [];
        lane.segmentPaints = [];
        lane.gridPositions = [];
        lane.gridPaints = [];

        if (settings.meterStyle === 'segments') {
            var length = target.orientation === 'horizontal' ? rect.w : rect.h;
            var count = segmentCountForLength(length);
            var unit = length / count;
            var gap = Math.min(Math.max(0, scale(settings.segmentGap)), Math.max(0, Math.floor(unit) - 1));
            var halfGap = Math.floor(gap / 2);
            var j;

            lane.segmentCount = count;
            for (j = 0; j < count; j++) {
                var rawStart = Math.round(j * unit);
                var rawEnd = Math.round((j + 1) * unit);
                var size = Math.max(1, rawEnd - rawStart - gap);
                var segmentDb = settings.minDb + (j + 0.5) * meterDbRange / count;
                var start;

                if (target.orientation === 'horizontal') {
                    start = lane.reverse
                        ? rect.x + rect.w - rawEnd + halfGap
                        : rect.x + rawStart + halfGap;
                } else {
                    start = rect.y + rect.h - rawEnd + halfGap;
                }
                lane.segmentStarts.push(start);
                lane.segmentSizes.push(size);
                lane.segmentPaints.push(zonePaint(zoneForDb(segmentDb)));
            }
        }

        if (settings.showGrid) {
            var k;
            for (k = 0; k < ticks.length; k++) {
                var db = ticks[k];
                if (db === settings.minDb || db === settings.maxDb) continue;
                var position;
                if (target.orientation === 'horizontal') {
                    var offset = Math.round(rect.w * dbToNormal(db));
                    position = lane.reverse ? rect.x + rect.w - offset : rect.x + offset;
                } else {
                    position = rect.y + rect.h - Math.round(rect.h * dbToNormal(db));
                }
                lane.gridPositions.push(position);
                lane.gridPaints.push(gridPaintByKind(gridPaintKind(db)));
            }
        }
    }
}

function drawHeader(gr, header, orientation, count) {
    if (!header) return;
    var cache = getMeterRenderCache();
    var titleW = Math.max(1, header.w - scale(12));
    var titleH = Math.max(scale(15), Math.floor(header.h * 0.58));
    var meta = orientation.toUpperCase() + '  /  ' + count + (count === 1 ? ' CHANNEL' : ' CHANNELS') + '  /  ' + settings.fps + ' FPS';

    gr.FillSolidRect(header.x, header.y + scale(5), scale(3), Math.max(1, header.h - scale(10)), cache.accentPaint);
    drawTextFast(gr, 'VU METER', titleFont, d2dTitleFont, theme.textPrimary,
        header.x + scale(10), header.y, titleW - scale(10), titleH, RivageUI.textFlags.leftCenteredEllipsis);
    drawTextFast(gr, meta, metaFont, d2dMetaFont, theme.textMuted,
        header.x + scale(10), header.y + titleH - scale(1), titleW - scale(10), header.h - titleH + scale(1),
        RivageUI.textFlags.leftCenteredEllipsis);
}

function channelLevelDb(channel) {
    return amplitudeToDb(displayedRms[channel]);
}

function channelPeakDb(channel) {
    return amplitudeToDb(vuMeter.Peak_levels[channel]);
}

function drawChannelMetadata(gr, lane, count, levelDb, peakDb) {
    var name = channelName(lane.channel, count);
    var valueText = formatDb(levelDb, 1);

    if (settings.showLabels && lane.label && lane.label.w > 0 && lane.label.h > 0) {
        drawTextFast(gr, name, labelFont, d2dLabelFont,
            lane.channel === hoveredChannel ? getMeterRenderCache().accent : theme.textSecondary,
            lane.label.x, lane.label.y, lane.label.w, lane.label.h,
            RivageUI.textFlags.centeredEllipsis);
    }

    if (settings.showValues && lane.value && lane.value.w > 0 && lane.value.h > 0) {
        var flags = layout.mode === 'stacked'
            ? RivageUI.textFlags.right
            : RivageUI.textFlags.centeredEllipsis;
        drawTextFast(gr, valueText, valueFont, d2dValueFont,
            peakDb >= settings.clipDb ? meterColours().danger : theme.textSecondary,
            lane.value.x, lane.value.y, lane.value.w, lane.value.h, flags);
    }
}

var frameLevelDb = [];
var framePeakDb = [];

function drawMeters(gr, currentLayout) {
    var count = currentLayout.count;
    var i;
    frameLevelDb.length = count;
    framePeakDb.length = count;

    for (i = 0; i < currentLayout.lanes.length; i++) {
        var lane = currentLayout.lanes[i];
        var levelDb = channelLevelDb(lane.channel);
        var peakDb = channelPeakDb(lane.channel);
        var hovered = lane.channel === hoveredChannel;

        frameLevelDb[lane.channel] = levelDb;
        framePeakDb[lane.channel] = peakDb;

        if (currentLayout.orientation === 'horizontal') {
            drawHorizontalMeter(gr, lane, levelDb, peakDb, hovered);
        } else {
            drawVerticalMeter(gr, lane, levelDb, peakDb, hovered);
        }
        drawChannelMetadata(gr, lane, count, levelDb, peakDb);
    }

    if (settings.showScale) {
        for (i = 0; i < currentLayout.scaleRects.length; i++) {
            if (currentLayout.orientation === 'horizontal') {
                drawHorizontalScale(gr, currentLayout.scaleRects[i]);
            } else {
                drawVerticalScale(gr, currentLayout.scaleRects[i]);
            }
        }
    }
}

function drawTooltipD2D(gr, lines, pointerX, pointerY) {
    if (!gr || !lines || !lines.length || !d2dTooltipFont || panelW <= 0 || panelH <= 0) return;

    var lineHeight = Math.max(12, scale(15));
    var padX = scale(9);
    var padY = scale(6);
    var margin = scale(4);
    var offset = scale(12);
    var minimumWidth = scale(118);
    var maximumWidth = Math.max(scale(40), panelW - margin * 2);
    var maxTextWidth = 0;

    for (var i = 0; i < lines.length; i++) {
        var width;
        try { width = Math.ceil(gr.CalcTextWidth(String(lines[i]), d2dTooltipFont, false)); }
        catch (e) { width = String(lines[i]).length * scale(7); }
        maxTextWidth = Math.max(maxTextWidth, width);
    }

    var boxWidth = Math.min(Math.max(minimumWidth, maxTextWidth + padX * 2), maximumWidth);
    var boxHeight = Math.min(panelH - margin * 2, lines.length * lineHeight + padY * 2);
    var x = RivageUI.clamp(pointerX - boxWidth / 2, margin, panelW - boxWidth - margin);
    var y = pointerY + offset;
    if (y + boxHeight > panelH - margin) y = pointerY - offset - boxHeight;
    y = RivageUI.clamp(y, margin, panelH - boxHeight - margin);

    var radius = RivageUI.metrics.radius.tooltip;
    painter.fillRoundRect(gr, RivageUI.rect(x + scale(2), y + scale(2), boxWidth, boxHeight),
        radius, theme.tooltipShadow);
    painter.fillRoundRect(gr, RivageUI.rect(x, y, boxWidth, boxHeight),
        radius, theme.tooltipBackground);
    painter.drawRoundRect(gr, RivageUI.rect(x, y, boxWidth, boxHeight),
        radius, 1, theme.tooltipStroke);

    for (i = 0; i < lines.length; i++) {
        if (padY + (i + 1) * lineHeight > boxHeight) break;
        drawTextFast(gr, lines[i], null, d2dTooltipFont, theme.tooltipText,
            x + padX, y + padY + i * lineHeight,
            Math.max(1, boxWidth - padX * 2), lineHeight,
            RivageUI.textFlags.leftCenteredEllipsis);
    }
}

function drawHoverTooltip(gr) {
    if (!settings.hoverTooltip || hoveredChannel < 0 || !d2dTooltipFont) return;
    if (!channelHitRects[hoveredChannel]) return;

    var count = meterChannelCount();
    var name = channelName(hoveredChannel, count);
    var levelDb = frameLevelDb[hoveredChannel];
    var peakDb = framePeakDb[hoveredChannel];
    if (!isFinite(levelDb)) levelDb = channelLevelDb(hoveredChannel);
    if (!isFinite(peakDb)) peakDb = channelPeakDb(hoveredChannel);
    drawTooltipD2D(gr, [
        name,
        'RMS  ' + formatDb(levelDb, 1) + ' dB',
        'Peak  ' + formatDb(peakDb, 1) + ' dB'
    ], mouseX, mouseY);
}

function channelAt(x, y) {
    var i;
    for (i = 0; i < channelHitRects.length; i++) {
        if (RivageUI.pointInRect(x, y, channelHitRects[i])) return i;
    }
    return -1;
}

// ============================================================================
// Shared SETTINGS panel schema
// ============================================================================

function getMySettings() {
    var rows = [
        { id: 'instanceId', label: 'Panel instance', type: 'info', value: instanceId },

        { id: 'themeMode', label: 'Theme', type: 'choice', value: settings.themeMode,
          choiceValueType: 'string', choices: THEME_CHOICES },
        { id: 'accentMode', label: 'Accent source', type: 'choice', value: settings.accentMode,
          choiceValueType: 'string', choices: ACCENT_CHOICES },
        { id: 'customAccent', label: 'Custom accent colour', type: 'colour', value: settings.customAccent },
        { id: 'palette', label: 'Meter palette', type: 'choice', value: settings.palette,
          choiceValueType: 'string', choices: PALETTE_CHOICES },
        { id: 'customMeter', label: 'Custom meter colour', type: 'colour', value: settings.customMeter },
        { id: 'customPeak', label: 'Custom peak colour', type: 'colour', value: settings.customPeak },

        { id: 'orientation', label: 'Orientation', type: 'choice', value: settings.orientation,
          choiceValueType: 'string', choices: ORIENTATION_CHOICES },
        { id: 'stereoLayout', label: 'Horizontal stereo layout', type: 'choice', value: settings.stereoLayout,
          choiceValueType: 'string', choices: STEREO_LAYOUT_CHOICES },
        { id: 'meterStyle', label: 'Meter style', type: 'choice', value: settings.meterStyle,
          choiceValueType: 'string', choices: STYLE_CHOICES },
        { id: 'segmentDb', label: 'dB per segment', type: 'choice', value: settings.segmentDb,
          choiceValueType: 'number', choices: SEGMENT_DB_CHOICES },
        { id: 'segmentGap', label: 'Segment gap (px)', type: 'number', value: settings.segmentGap,
          min: 0, max: 8, step: 1 },

        { id: 'minDb', label: 'Meter floor', type: 'choice', value: settings.minDb,
          choiceValueType: 'number', choices: MIN_DB_CHOICES },
        { id: 'maxDb', label: 'Meter ceiling', type: 'choice', value: settings.maxDb,
          choiceValueType: 'number', choices: MAX_DB_CHOICES },
        { id: 'warningDb', label: 'Warning threshold', type: 'choice', value: settings.warningDb,
          choiceValueType: 'number', choices: WARNING_DB_CHOICES },
        { id: 'clipDb', label: 'Clip threshold', type: 'choice', value: settings.clipDb,
          choiceValueType: 'number', choices: CLIP_DB_CHOICES },

        { id: 'showHeader', label: 'Show header', type: 'bool', value: settings.showHeader },
        { id: 'showScale', label: 'Show dB scale', type: 'bool', value: settings.showScale },
        { id: 'showLabels', label: 'Show channel labels', type: 'bool', value: settings.showLabels },
        { id: 'showValues', label: 'Show RMS values', type: 'bool', value: settings.showValues },
        { id: 'showGrid', label: 'Show dB grid lines', type: 'bool', value: settings.showGrid },
        { id: 'showPeak', label: 'Show peak markers', type: 'bool', value: settings.showPeak },
        { id: 'showFrame', label: 'Show card border', type: 'bool', value: settings.showFrame },
        { id: 'showAccentLine', label: 'Show accent underline', type: 'bool', value: settings.showAccentLine },
        { id: 'hoverTooltip', label: 'Show channel hover tooltip', type: 'bool', value: settings.hoverTooltip },

        { id: 'outerPadding', label: 'Outer padding (px)', type: 'number', value: settings.outerPadding,
          min: 0, max: 32, step: 1 },
        { id: 'channelGap', label: 'Channel gap (px)', type: 'number', value: settings.channelGap,
          min: 0, max: 24, step: 1 },
        { id: 'cornerRadius', label: 'Corner radius (px)', type: 'number', value: settings.cornerRadius,
          min: 0, max: 16, step: 1 },
        { id: 'peakThickness', label: 'Peak marker thickness (px)', type: 'number', value: settings.peakThickness,
          min: 1, max: 8, step: 1 },

        { id: 'fps', label: 'Frame rate', type: 'choice', value: settings.fps,
          choiceValueType: 'number', choices: FPS_CHOICES },
        { id: 'rmsWindowMs', label: 'RMS averaging window', type: 'choice', value: settings.rmsWindowMs,
          choiceValueType: 'number', choices: RMS_WINDOW_CHOICES },
        { id: 'response', label: 'Meter response', type: 'choice', value: settings.response,
          choiceValueType: 'string', choices: RESPONSE_CHOICES },
        { id: 'peakHoldMs', label: 'Peak hold time', type: 'choice', value: settings.peakHoldMs,
          choiceValueType: 'number', choices: PEAK_HOLD_CHOICES },
        { id: 'peakDecay', label: 'Peak decay speed', type: 'choice', value: settings.peakDecay,
          choiceValueType: 'string', choices: PEAK_DECAY_CHOICES },

        { id: 'resetDefaults', label: 'Reset VU meter settings', type: 'action', value: false, actionLabel: 'Reset' }
    ];
    for (var i = 0; i < rows.length; i++) {
        rows[i].section = rows[i].id === 'instanceId' ? 'Diagnostics' : 'Options';
    }
    return rows;
}

function applyMySetting(settingId, value) {
    var changed = false;
    var refreshThemeNeeded = false;
    var restartEngine = false;
    var refreshEngineSettings = false;

    switch (settingId) {
    case 'themeMode':
        changed = setStoredSetting('themeMode', choiceValue(String(value), THEME_CHOICES, DEFAULTS.themeMode));
        refreshThemeNeeded = changed;
        break;
    case 'accentMode':
        changed = setStoredSetting('accentMode', choiceValue(String(value), ACCENT_CHOICES, DEFAULTS.accentMode));
        refreshThemeNeeded = changed;
        if (changed && settings.accentMode === 'shared') SharedAccentProtocol.requestAccent();
        break;
    case 'customAccent':
        changed = setStoredSetting('customAccent', RivageUI.opaque(Number(value) || DEFAULTS.customAccent));
        refreshThemeNeeded = changed && settings.accentMode === 'custom';
        break;
    case 'palette':
        changed = setStoredSetting('palette', choiceValue(String(value), PALETTE_CHOICES, DEFAULTS.palette));
        break;
    case 'customMeter':
        changed = setStoredSetting('customMeter', RivageUI.opaque(Number(value) || DEFAULTS.customMeter));
        break;
    case 'customPeak':
        changed = setStoredSetting('customPeak', RivageUI.opaque(Number(value) || DEFAULTS.customPeak));
        break;

    case 'orientation':
        changed = setStoredSetting('orientation', choiceValue(String(value), ORIENTATION_CHOICES, DEFAULTS.orientation));
        if (changed) hoveredChannel = -1;
        break;
    case 'stereoLayout':
        changed = setStoredSetting('stereoLayout', choiceValue(String(value), STEREO_LAYOUT_CHOICES, DEFAULTS.stereoLayout));
        if (changed) hoveredChannel = -1;
        break;
    case 'meterStyle':
        changed = setStoredSetting('meterStyle', choiceValue(String(value), STYLE_CHOICES, DEFAULTS.meterStyle));
        break;
    case 'segmentDb':
        changed = setStoredSetting('segmentDb', numberChoiceValue(value, SEGMENT_DB_CHOICES, DEFAULTS.segmentDb));
        break;
    case 'segmentGap':
        changed = setStoredSetting('segmentGap', Math.round(clampNumber(value, 0, 8, DEFAULTS.segmentGap)));
        break;

    case 'minDb':
        changed = setThresholdSetting('minDb', numberChoiceValue(value, MIN_DB_CHOICES, DEFAULTS.minDb));
        break;
    case 'maxDb':
        changed = setThresholdSetting('maxDb', numberChoiceValue(value, MAX_DB_CHOICES, DEFAULTS.maxDb));
        break;
    case 'warningDb':
        changed = setThresholdSetting('warningDb', numberChoiceValue(value, WARNING_DB_CHOICES, DEFAULTS.warningDb));
        break;
    case 'clipDb':
        changed = setThresholdSetting('clipDb', numberChoiceValue(value, CLIP_DB_CHOICES, DEFAULTS.clipDb));
        break;

    case 'showHeader': changed = setStoredSetting('showHeader', !!value); break;
    case 'showScale': changed = setStoredSetting('showScale', !!value); break;
    case 'showLabels': changed = setStoredSetting('showLabels', !!value); break;
    case 'showValues': changed = setStoredSetting('showValues', !!value); break;
    case 'showGrid': changed = setStoredSetting('showGrid', !!value); break;
    case 'showPeak': changed = setStoredSetting('showPeak', !!value); break;
    case 'showFrame': changed = setStoredSetting('showFrame', !!value); break;
    case 'showAccentLine': changed = setStoredSetting('showAccentLine', !!value); break;
    case 'hoverTooltip': changed = setStoredSetting('hoverTooltip', !!value); break;

    case 'outerPadding':
        changed = setStoredSetting('outerPadding', Math.round(clampNumber(value, 0, 32, DEFAULTS.outerPadding)));
        break;
    case 'channelGap':
        changed = setStoredSetting('channelGap', Math.round(clampNumber(value, 0, 24, DEFAULTS.channelGap)));
        break;
    case 'cornerRadius':
        changed = setStoredSetting('cornerRadius', Math.round(clampNumber(value, 0, 16, DEFAULTS.cornerRadius)));
        break;
    case 'peakThickness':
        changed = setStoredSetting('peakThickness', Math.round(clampNumber(value, 1, 8, DEFAULTS.peakThickness)));
        break;

    case 'fps':
        changed = setStoredSetting('fps', numberChoiceValue(value, FPS_CHOICES, DEFAULTS.fps));
        restartEngine = changed;
        break;
    case 'rmsWindowMs':
        changed = setStoredSetting('rmsWindowMs', numberChoiceValue(value, RMS_WINDOW_CHOICES, DEFAULTS.rmsWindowMs));
        refreshEngineSettings = changed;
        break;
    case 'response':
        changed = setStoredSetting('response', choiceValue(String(value), RESPONSE_CHOICES, DEFAULTS.response));
        if (changed) refreshResponseCoefficients();
        break;
    case 'peakHoldMs':
        changed = setStoredSetting('peakHoldMs', numberChoiceValue(value, PEAK_HOLD_CHOICES, DEFAULTS.peakHoldMs));
        break;
    case 'peakDecay':
        changed = setStoredSetting('peakDecay', choiceValue(String(value), PEAK_DECAY_CHOICES, DEFAULTS.peakDecay));
        break;

    case 'resetDefaults':
        resetSettings();
        return;
    default:
        return;
    }

    if (!changed) return;
    invalidateStaticCaches();
    if (refreshThemeNeeded) refreshTheme();
    if (refreshEngineSettings) applyMeterEngineSettings(false);
    if (restartEngine) applyMeterEngineSettings(true);
    window.Repaint();
}

// ============================================================================
// Context menu
// ============================================================================

// Win32 menu flags are not provided by JSplitter as globals. Keep panel-local
// names so the context menu works without depending on a helper include and so
// a future helpers.js include cannot redeclare the familiar MF_* constants.
var MENU_STRING = 0x00000000;
var MENU_GRAYED = 0x00000001;

function MenuBuilder() {
    this.nextId = 1;
    this.actions = {};
    // Keep popup-menu objects alive until TrackPopupMenu completes. Nested
    // menus created inside addChoiceSubmenu otherwise have no live JS reference.
    this.menus = [];
}

MenuBuilder.prototype.createMenu = function () {
    var menu = window.CreatePopupMenu();
    this.menus.push(menu);
    return menu;
};

MenuBuilder.prototype.addAction = function (menu, label, action, checked, enabled) {
    var id = this.nextId++;
    menu.AppendMenuItem(enabled === false ? MENU_GRAYED : MENU_STRING, id, label);
    if (checked) menu.CheckMenuItem(id, true);
    if (enabled !== false) this.actions[id] = action;
    return id;
};

MenuBuilder.prototype.addToggle = function (menu, label, key) {
    var self = this;
    this.addAction(menu, label, function () {
        applyMySetting(key, !settings[key]);
    }, !!settings[key], true);
};

MenuBuilder.prototype.addChoiceSubmenu = function (parent, title, choices, current, settingId) {
    var submenu = this.createMenu();
    var first = this.nextId;
    var checkedId = first;
    var self = this;
    var i;

    for (i = 0; i < choices.length; i++) {
        (function (choice) {
            var id = self.nextId++;
            submenu.AppendMenuItem(MENU_STRING, id, choice.label);
            self.actions[id] = function () { applyMySetting(settingId, choice.value); };
            if (choice.value === current) checkedId = id;
        })(choices[i]);
    }
    if (choices.length) submenu.CheckMenuRadioItem(first, this.nextId - 1, checkedId);
    submenu.AppendTo(parent, MENU_STRING, title);
};

function pickSettingColour(settingId) {
    var current = settings[settingId];
    var picked;
    try {
        picked = utils.ColourPicker(window.ID, current);
    } catch (e) {
        return;
    }
    if (typeof picked === 'number') applyMySetting(settingId, picked);
}

function showContextMenu(x, y) {
    var builder = new MenuBuilder();
    var menu = builder.createMenu();
    var appearance = builder.createMenu();
    var layoutMenu = builder.createMenu();
    var overlays = builder.createMenu();
    var rangeMenu = builder.createMenu();
    var ballistics = builder.createMenu();

    builder.addChoiceSubmenu(appearance, 'Theme', THEME_CHOICES, settings.themeMode, 'themeMode');
    builder.addChoiceSubmenu(appearance, 'Accent source', ACCENT_CHOICES, settings.accentMode, 'accentMode');
    builder.addChoiceSubmenu(appearance, 'Meter palette', PALETTE_CHOICES, settings.palette, 'palette');
    appearance.AppendMenuSeparator();
    builder.addAction(appearance, 'Choose custom accent…', function () { pickSettingColour('customAccent'); });
    builder.addAction(appearance, 'Custom meter colour…', function () { pickSettingColour('customMeter'); });
    builder.addAction(appearance, 'Custom peak colour…', function () { pickSettingColour('customPeak'); });
    appearance.AppendMenuSeparator();
    builder.addToggle(appearance, 'Show card border', 'showFrame');
    builder.addToggle(appearance, 'Show accent underline', 'showAccentLine');
    appearance.AppendTo(menu, MENU_STRING, 'Appearance');

    builder.addChoiceSubmenu(layoutMenu, 'Orientation', ORIENTATION_CHOICES, settings.orientation, 'orientation');
    builder.addChoiceSubmenu(layoutMenu, 'Horizontal stereo layout', STEREO_LAYOUT_CHOICES, settings.stereoLayout, 'stereoLayout');
    builder.addChoiceSubmenu(layoutMenu, 'Outer padding', PADDING_CHOICES, settings.outerPadding, 'outerPadding');
    builder.addChoiceSubmenu(layoutMenu, 'Channel gap', CHANNEL_GAP_CHOICES, settings.channelGap, 'channelGap');
    builder.addChoiceSubmenu(layoutMenu, 'Corner radius', RADIUS_CHOICES, settings.cornerRadius, 'cornerRadius');
    layoutMenu.AppendTo(menu, MENU_STRING, 'Layout');

    builder.addChoiceSubmenu(rangeMenu, 'Meter style', STYLE_CHOICES, settings.meterStyle, 'meterStyle');
    builder.addChoiceSubmenu(rangeMenu, 'dB per segment', SEGMENT_DB_CHOICES, settings.segmentDb, 'segmentDb');
    builder.addChoiceSubmenu(rangeMenu, 'Segment gap', SEGMENT_GAP_CHOICES, settings.segmentGap, 'segmentGap');
    builder.addChoiceSubmenu(rangeMenu, 'Meter floor', MIN_DB_CHOICES, settings.minDb, 'minDb');
    builder.addChoiceSubmenu(rangeMenu, 'Meter ceiling', MAX_DB_CHOICES, settings.maxDb, 'maxDb');
    builder.addChoiceSubmenu(rangeMenu, 'Warning threshold', WARNING_DB_CHOICES, settings.warningDb, 'warningDb');
    builder.addChoiceSubmenu(rangeMenu, 'Clip threshold', CLIP_DB_CHOICES, settings.clipDb, 'clipDb');
    builder.addChoiceSubmenu(rangeMenu, 'Peak marker thickness', PEAK_THICKNESS_CHOICES, settings.peakThickness, 'peakThickness');
    rangeMenu.AppendTo(menu, MENU_STRING, 'Meter and range');

    builder.addToggle(overlays, 'Header', 'showHeader');
    builder.addToggle(overlays, 'dB scale', 'showScale');
    builder.addToggle(overlays, 'Channel labels', 'showLabels');
    builder.addToggle(overlays, 'Show RMS values', 'showValues');
    builder.addToggle(overlays, 'dB grid lines', 'showGrid');
    builder.addToggle(overlays, 'Peak markers', 'showPeak');
    builder.addToggle(overlays, 'Hover tooltip', 'hoverTooltip');
    overlays.AppendTo(menu, MENU_STRING, 'Overlays');

    builder.addChoiceSubmenu(ballistics, 'Frame rate', FPS_CHOICES, settings.fps, 'fps');
    builder.addChoiceSubmenu(ballistics, 'RMS window', RMS_WINDOW_CHOICES, settings.rmsWindowMs, 'rmsWindowMs');
    builder.addChoiceSubmenu(ballistics, 'Meter response', RESPONSE_CHOICES, settings.response, 'response');
    builder.addChoiceSubmenu(ballistics, 'Peak hold', PEAK_HOLD_CHOICES, settings.peakHoldMs, 'peakHoldMs');
    builder.addChoiceSubmenu(ballistics, 'Peak decay', PEAK_DECAY_CHOICES, settings.peakDecay, 'peakDecay');
    ballistics.AppendTo(menu, MENU_STRING, 'Ballistics');

    menu.AppendMenuSeparator();
    builder.addAction(menu, 'Clear peak markers', clearPeakMarkers);
    builder.addAction(menu, 'Open or close settings', function () {
        window.NotifyOthers('RIVAGE.TOGGLE_PANEL_VISIBILITY', { caption: 'SETTINGS' });
    });
    menu.AppendMenuSeparator();
    builder.addAction(menu, 'Reset VU meter settings', resetSettings);
    builder.addAction(menu, RivageUI.copy.labels.panelConfiguration, function () { window.ShowConfigureV2(); });

    var selected = menu.TrackPopupMenu(x, y);
    if (selected && builder.actions[selected]) builder.actions[selected]();
    return true;
}

// ============================================================================
// Callbacks
// ============================================================================

function on_paint(gr) {
    // Reaching on_paint means the splitter is showing this panel again; restart
    // the meter timer if it was stopped purely because we were hidden.
    resumeMeterIfVisible();

    var nextW = window.Width;
    var nextH = window.Height;
    if (nextW !== panelW || nextH !== panelH) {
        panelW = nextW;
        panelH = nextH;
        invalidateLayout();
    }
    gr.FillSolidRect(0, 0, panelW, panelH, getMeterRenderCache().backgroundPaint);
    if (panelW <= 0 || panelH <= 0) return;

    var currentLayout = getCachedLayout();
    drawHeader(gr, currentLayout.header, currentLayout.orientation, currentLayout.count);

    if (currentLayout.card.w > 0 && currentLayout.card.h > 0) {
        drawMeterCard(gr, currentLayout.card, currentLayout.orientation);
        drawMeters(gr, currentLayout);
    }

    drawHoverTooltip(gr);
}

function on_size() {
    panelW = window.Width;
    panelH = window.Height;
    hoveredChannel = -1;
    invalidateLayout();
}

function on_mouse_move(x, y) {
    mouseX = x;
    mouseY = y;
    var next = channelAt(x, y);
    if (next !== hoveredChannel) {
        hoveredChannel = next;
        window.Repaint();
    } else if (settings.hoverTooltip && hoveredChannel >= 0) {
        window.Repaint();
    }
}

function on_mouse_leave() {
    if (hoveredChannel !== -1) {
        hoveredChannel = -1;
        window.Repaint();
    }
}

function on_mouse_mbtn_up() {
    clearPeakMarkers();
    return true;
}

function on_mouse_rbtn_up(x, y) {
    return showContextMenu(x, y);
}

function on_playback_new_track() {
    playbackPaused = !!fb.IsPaused;
    vuMeter.stop_timer();
    if (!playbackPaused && fb.IsPlaying) {
        vuMeter.start_timer();
    }
}

function on_playback_pause(state) {
    // Set the guard before stopping the timer so an already queued interval
    // cannot call fb.GetAudioChunk during the pause transition.
    playbackPaused = !!state;
    if (playbackPaused) {
        vuMeter.stop_timer();
    } else if (fb.IsPlaying) {
        vuMeter.start_timer();
    }
    window.Repaint();
}

function on_playback_stop(reason) {
    playbackPaused = false;
    vuMeter.playback_stop(reason);
    displayedRms = [];
    window.Repaint();
}

function on_colours_changed() {
    refreshTheme();
    window.Repaint();
}

function on_font_changed() {
    refreshVisualResources(true);
    window.Repaint();
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (SettingsRegistry.provide(name, info, settingsPanelId(), settingsPanelLabel(), getMySettings)) return;
    if (SettingsRegistry.consume(name, info, settingsPanelId(), applyMySetting)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;
        if (settings.accentMode === 'shared') {
            refreshTheme();
            window.Repaint();
        }
    }
}

function on_script_unload() {
    vuMeter.shutdown();
    meterRenderCache = null;
    dbTicksCache = null;
    layout = null;
    clearD2DFontCache();
    clearD2DBrushCache();
}

// Ask the tabs panel for the current album accent in case this panel loaded
// after the producer's initial broadcast.
SharedAccentProtocol.request();
