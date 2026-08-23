// MUST be the very first line. Drawing objects are bound to this mode and
// cannot be mixed with GDI-mode objects created by the same panel.
window.DrawMode = 1;

// RVG Spectrum Analyser for JSplitter/SpiderMonkey Panel.
// DrawMode 1 is required before any drawing object is created. The shared
// design-system colour/layout helpers are mode-agnostic; fonts/tooltips are
// implemented locally because their shared implementations are GDI-bound.
// Multiple instances are supported through a persisted per-panel registry id.

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\settings_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\visible_paint_work.js');

window.EraseOnRepaint = false;

window.DefineScript(RivageUI.copy.popupTitle('Spectrum'), {
    author: 'RivaGe',
    version: '1.8.0',
    features: {
        drag_n_drop: false,
        grab_focus: false
    }
});

// Narrow failure reporting. Most empty catches in this file guard drawing
// calls and host reads that are *expected* to fail (an optional host API
// being probed, a timer already cleared) and stay silent on purpose. This is
// for the few that mean something is actually broken and would otherwise
// leave no trace - several of these sites run every frame, so repeats are
// counted and re-logged only at powers of ten.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Spectrum] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

// Registry identity
// Panel properties are saved per panel instance (see the SetProperty docs), so
// everything driven by the right-click menu is already independent between two
// spectrum panels. The settings REGISTRY is not: SettingsRegistry.collect()
// does collected[panelId] = copy, and consume() matches edits on panel id
// alone. Two panels sharing one id would therefore produce a single sidebar
// entry showing whichever instance answered last, and every edit made there
// would be applied and persisted by all of them.
//
// So each instance mints a short id of its own on first run and registers as
// spectrum-<id>. The id is never shown in the sidebar, which means two panels
// can carry the same display name without colliding.

var PROPERTY_PREFIX = 'RIVAGE.SPECTRUM.';
var SETTINGS_PANEL_ID_PREFIX = 'spectrum-';
var INSTANCE_ID_PROPERTY = PROPERTY_PREFIX + 'Instance id';

// Deliberately NOT a member of DEFAULTS: this is the panel's identity, not a
// setting, and "Reset spectrum defaults" must never change it.
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
    return stored;
}

// Unique per panel instance, so two spectrum panels never overwrite each
// other's schema response no matter what the user calls them.
function settingsPanelId() {
    return SETTINGS_PANEL_ID_PREFIX + instanceId;
}

// What the settings screen shows in its sidebar.
function settingsPanelLabel() {
    var name = String(settings.panelName || '').trim();
    return name || ('Spectrum ' + instanceId);
}

// Configuration model

var DEFAULTS = {
    // Appearance
    themeMode: 'host',
    colourMode: 'default',
    customColour: RivageUI.DEFAULT_ACCENT,
    gradient: true,
    gradientDepth: 'medium',
    gradientTint: 'darken',
    gradientScale: 'element',
    showFrame: false,
    showHeader: false,
    background: 'panel',
    cornerRadius: 4,
    outerPadding: 8,

    // View
    view: 'mirror',
    spectrumOrder: 'low-left',
    barCount: 64,
    barGap: 2,
    barRounding: 'full',
    minBarSize: 2,
    edgeFade: true,
    edgeFadeAmount: 22,

    // Ghosting / trail
    trailFrames: 5,
    trailSpacing: 2,
    trailOpacity: 46,
    trailScale: 100,
    showPeaks: false,
    peakHoldMs: 700,
    peakDecay: 'medium',
    peakThickness: 2,

    // Analysis
    fftSize: 2048,
    minHz: 30,
    maxHz: 17000,
    floorDb: -78,
    ceilingDb: -12,
    tiltDb: 4.5,
    bandCurve: 'log',
    bandPick: 'max',
    spectralSmooth: 1,

    // Ballistics
    fps: 30,
    attack: 'balanced',
    release: 'balanced',
    idleFade: true,

    // Radial extras
    radialInner: 32,
    radialSpread: 340,
    radialRotate: false,

    // CD art (radial view only - drawn in the empty hole at the centre)
    showCdArt: true,
    cdSize: 92,
    cdSpin: true,
    cdSpinSpeed: 'medium',

    // Identity and interaction
    panelName: '',
    hoverTooltip: true,
    clickCyclesView: true
};

var PROPERTY_NAMES = {
    themeMode: 'Theme mode',
    colourMode: 'Colour mode',
    customColour: 'Custom colour',
    gradient: 'Gradient',
    gradientDepth: 'Gradient depth',
    gradientTint: 'Gradient direction',
    gradientScale: 'Gradient scaling',
    showFrame: 'Show card border',
    showHeader: 'Show header',
    background: 'Background fill',
    cornerRadius: 'Corner radius px',
    outerPadding: 'Outer padding px',

    view: 'View',
    spectrumOrder: 'Spectrum order',
    barCount: 'Band count',
    barGap: 'Bar gap px',
    barRounding: 'Bar rounding',
    minBarSize: 'Minimum bar size px',
    edgeFade: 'Edge fade',
    edgeFadeAmount: 'Edge fade width pct',

    trailFrames: 'Ghost trail frames',
    trailSpacing: 'Ghost trail spacing',
    trailOpacity: 'Ghost trail opacity pct',
    trailScale: 'Ghost trail scale pct',
    showPeaks: 'Show peak markers',
    peakHoldMs: 'Peak hold ms',
    peakDecay: 'Peak decay',
    peakThickness: 'Peak thickness px',

    fftSize: 'FFT size',
    minHz: 'Lowest frequency Hz',
    maxHz: 'Highest frequency Hz',
    floorDb: 'Noise floor dB',
    ceilingDb: 'Ceiling dB',
    tiltDb: 'Spectral tilt dB per octave',
    bandCurve: 'Band spacing',
    bandPick: 'Bin aggregation',
    spectralSmooth: 'Neighbour smoothing',

    fps: 'Refresh rate fps',
    attack: 'Attack',
    release: 'Release',
    idleFade: 'Fade out when idle',

    radialInner: 'Radial inner radius pct',
    radialSpread: 'Radial sweep degrees',
    radialRotate: 'Radial slow rotation',

    showCdArt: 'Show CD art',
    cdSize: 'CD art size pct',
    cdSpin: 'CD spins automatically',
    cdSpinSpeed: 'CD spin speed',

    panelName: 'Name in Settings',
    hoverTooltip: 'Show hover tooltip',
    clickCyclesView: 'Left-click cycles view'
};

// Choice tables

var THEME_CHOICES = RivageUI.copy.themeChoices({ host: 'host', dark: 'dark', light: 'light' });

var COLOUR_CHOICES = [
    { value: 'default', label: RivageUI.copy.labels.rvgBlue },
    { value: 'album', label: RivageUI.copy.labels.sharedAccent },
    { value: 'white', label: 'White' },
    { value: 'text', label: 'Theme text' },
    { value: 'custom', label: 'Custom colour' }
];

var GRADIENT_DEPTH_CHOICES = [
    { value: 'subtle', label: 'Subtle' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
    { value: 'extreme', label: 'Extreme' }
];

var GRADIENT_TINT_CHOICES = [
    { value: 'darken', label: 'Bright base, dark tips' },
    { value: 'lighten', label: 'Base colour, white tips' },
    { value: 'fade', label: 'Fade to transparent tips' },
    { value: 'invert', label: 'Dark base, bright tips' }
];

// Where the gradient's 0..1 range is measured across.
//
// 'element' is the original behaviour: every bar, ribbon column and radial
// wedge maps its OWN length onto the full ramp, so a 5px bar and a 50px bar
// both run base-to-tip and differ only in size.
//
// 'panel' pins the ramp to the plot area instead, so a short bar only ever
// shows the base end of it. That looks different - most obviously in quiet
// passages, where most bars are short - but it lets one cached brush fill
// every element, which is what makes the ribbon a single draw call instead of
// one per column.
var GRADIENT_SCALE_CHOICES = [
    { value: 'element', label: 'Within each bar' },
    { value: 'panel', label: 'Across the panel (faster)' }
];

var BACKGROUND_CHOICES = [
    { value: 'panel', label: 'Panel background' },
    { value: 'card', label: 'Card surface' },
    { value: 'alt', label: 'Darker alternate' },
    { value: 'black', label: 'Pure black' }
];

var VIEW_CHOICES = [
    { value: 'mirror', label: 'Mirrored bars' },
    { value: 'bars', label: 'Bars from bottom' },
    { value: 'area', label: 'Mirrored ribbon' },
    { value: 'radial', label: 'Radial spectrum' }
];

var SPECTRUM_ORDER_CHOICES = [
    { value: 'low-left', label: 'Low frequencies left' },
    { value: 'low-right', label: 'Low frequencies right' },
    { value: 'low-centre', label: 'Low frequencies centre' },
    { value: 'low-edges', label: 'Low frequencies at edges' }
];

var BAR_COUNT_CHOICES = [
    { value: 16, label: '16 bands' },
    { value: 24, label: '24 bands' },
    { value: 32, label: '32 bands' },
    { value: 48, label: '48 bands' },
    { value: 64, label: '64 bands' },
    { value: 96, label: '96 bands' },
    { value: 128, label: '128 bands' },
    { value: 192, label: '192 bands' }
];

var BAR_GAP_CHOICES = [
    { value: 0, label: 'None' },
    { value: 1, label: '1 px' },
    { value: 2, label: '2 px' },
    { value: 3, label: '3 px' },
    { value: 4, label: '4 px' },
    { value: 6, label: '6 px' }
];

// Two shapes only. Anything else read from a stored property (the old 'soft'
// and 'half' values) falls through choiceValue to DEFAULTS.barRounding, so
// existing configs land on 'full' rather than breaking.
var BAR_ROUNDING_CHOICES = [
    { value: 'none', label: 'Square' },
    { value: 'full', label: 'Rounded' }
];

var TRAIL_FRAME_CHOICES = [
    { value: 0, label: 'Off' },
    { value: 2, label: '2 layers' },
    { value: 3, label: '3 layers' },
    { value: 5, label: '5 layers' },
    { value: 8, label: '8 layers' },
    { value: 12, label: '12 layers' }
];

var TRAIL_SPACING_CHOICES = [
    { value: 1, label: 'Every frame' },
    { value: 2, label: 'Every 2nd frame' },
    { value: 3, label: 'Every 3rd frame' },
    { value: 5, label: 'Every 5th frame' }
];

var PEAK_HOLD_CHOICES = [
    { value: 0, label: 'Off' },
    { value: 300, label: '300 ms' },
    { value: 700, label: '700 ms' },
    { value: 1200, label: '1.2 seconds' },
    { value: 2500, label: '2.5 seconds' }
];

var PEAK_DECAY_CHOICES = [
    { value: 'fast', label: 'Fast' },
    { value: 'medium', label: 'Medium' },
    { value: 'slow', label: 'Slow' },
    { value: 'very_slow', label: 'Very slow' }
];

var FFT_SIZE_CHOICES = [
    { value: 512, label: '512 (fastest)' },
    { value: 1024, label: '1024' },
    { value: 2048, label: '2048 (balanced)' },
    { value: 4096, label: '4096 (finest)' }
];

var MIN_HZ_CHOICES = [
    { value: 20, label: '20 Hz' },
    { value: 30, label: '30 Hz' },
    { value: 45, label: '45 Hz' },
    { value: 60, label: '60 Hz' },
    { value: 90, label: '90 Hz' }
];

var MAX_HZ_CHOICES = [
    { value: 10000, label: '10 kHz' },
    { value: 14000, label: '14 kHz' },
    { value: 17000, label: '17 kHz' },
    { value: 20000, label: '20 kHz' }
];

var FLOOR_DB_CHOICES = [
    { value: -96, label: '-96 dB' },
    { value: -86, label: '-86 dB' },
    { value: -78, label: '-78 dB' },
    { value: -68, label: '-68 dB' },
    { value: -58, label: '-58 dB' }
];

var CEILING_DB_CHOICES = [
    { value: -24, label: '-24 dB' },
    { value: -18, label: '-18 dB' },
    { value: -12, label: '-12 dB' },
    { value: -6, label: '-6 dB' },
    { value: 0, label: '0 dB' }
];

var TILT_CHOICES = [
    { value: 0, label: 'Off (flat)' },
    { value: 3, label: '3 dB / octave' },
    { value: 4.5, label: '4.5 dB / octave' },
    { value: 6, label: '6 dB / octave' }
];

var BAND_CURVE_CHOICES = [
    { value: 'log', label: 'Logarithmic' },
    { value: 'mel', label: 'Mel (perceptual)' },
    { value: 'linear', label: 'Linear' }
];

var BAND_PICK_CHOICES = [
    { value: 'max', label: 'Peak bin' },
    { value: 'avg', label: 'Average' },
    { value: 'rms', label: 'RMS' }
];

var SMOOTH_CHOICES = [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Light' },
    { value: 2, label: 'Medium' },
    { value: 3, label: 'Heavy' }
];

var FPS_CHOICES = [
    { value: 20, label: '20 fps' },
    { value: 30, label: '30 fps' },
    { value: 60, label: '60 fps' }
];

var BALLISTIC_CHOICES = [
    { value: 'instant', label: 'Instant' },
    { value: 'fast', label: 'Fast' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'smooth', label: 'Smooth' },
    { value: 'glacial', label: 'Very smooth' }
];

var PADDING_CHOICES = [
    { value: 0, label: 'None' },
    { value: 4, label: 'Tight' },
    { value: 8, label: 'Standard' },
    { value: 14, label: 'Spacious' },
    { value: 22, label: 'Wide' }
];

var RADIUS_CHOICES = [
    { value: 0, label: 'Square' },
    { value: 2, label: '2 px' },
    { value: 4, label: '4 px' },
    { value: 6, label: '6 px' },
    { value: 10, label: '10 px' }
];

var CD_SIZE_CHOICES = [
    { value: 60, label: '60%' },
    { value: 75, label: '75%' },
    { value: 92, label: '92%' },
    { value: 100, label: '100%' },
    { value: 110, label: '110%' }
];

var CD_SPIN_SPEED_CHOICES = [
    { value: 'slow', label: 'Slow', deg: 0.12 },
    { value: 'medium', label: 'Medium', deg: 0.28 },
    { value: 'fast', label: 'Fast', deg: 0.55 }
];

function cdSpinDegreesPerReferenceFrame() {
    var i;
    for (i = 0; i < CD_SPIN_SPEED_CHOICES.length; i++) {
        if (CD_SPIN_SPEED_CHOICES[i].value === settings.cdSpinSpeed) return CD_SPIN_SPEED_CHOICES[i].deg;
    }
    return 0.28;
}

// Property helpers

function clampNumber(value, minimum, maximum, fallback) {
    value = Number(value);
    if (!isFinite(value)) value = Number(fallback) || minimum;
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

function loadSettings() {
    settings.themeMode = choiceValue(String(readProperty('themeMode')), THEME_CHOICES, DEFAULTS.themeMode);
    settings.colourMode = choiceValue(String(readProperty('colourMode')), COLOUR_CHOICES, DEFAULTS.colourMode);
    settings.customColour = RivageUI.opaque(Number(readProperty('customColour')) || DEFAULTS.customColour);
    settings.gradient = !!readProperty('gradient');
    settings.gradientDepth = choiceValue(String(readProperty('gradientDepth')), GRADIENT_DEPTH_CHOICES, DEFAULTS.gradientDepth);
    settings.gradientTint = choiceValue(String(readProperty('gradientTint')), GRADIENT_TINT_CHOICES, DEFAULTS.gradientTint);
    settings.gradientScale = choiceValue(String(readProperty('gradientScale')), GRADIENT_SCALE_CHOICES, DEFAULTS.gradientScale);
    settings.showFrame = !!readProperty('showFrame');
    settings.showHeader = !!readProperty('showHeader');
    settings.background = choiceValue(String(readProperty('background')), BACKGROUND_CHOICES, DEFAULTS.background);
    settings.cornerRadius = clampNumber(readProperty('cornerRadius'), 0, 24, DEFAULTS.cornerRadius);
    settings.outerPadding = clampNumber(readProperty('outerPadding'), 0, 48, DEFAULTS.outerPadding);

    settings.view = choiceValue(String(readProperty('view')), VIEW_CHOICES, DEFAULTS.view);
    settings.spectrumOrder = choiceValue(String(readProperty('spectrumOrder')), SPECTRUM_ORDER_CHOICES, DEFAULTS.spectrumOrder);
    settings.barCount = numberChoiceValue(readProperty('barCount'), BAR_COUNT_CHOICES, DEFAULTS.barCount);
    settings.barGap = clampNumber(readProperty('barGap'), 0, 12, DEFAULTS.barGap);
    settings.barRounding = choiceValue(String(readProperty('barRounding')), BAR_ROUNDING_CHOICES, DEFAULTS.barRounding);
    settings.minBarSize = clampNumber(readProperty('minBarSize'), 0, 12, DEFAULTS.minBarSize);
    settings.edgeFade = !!readProperty('edgeFade');
    settings.edgeFadeAmount = clampNumber(readProperty('edgeFadeAmount'), 0, 50, DEFAULTS.edgeFadeAmount);

    settings.trailFrames = numberChoiceValue(readProperty('trailFrames'), TRAIL_FRAME_CHOICES, DEFAULTS.trailFrames);
    settings.trailSpacing = numberChoiceValue(readProperty('trailSpacing'), TRAIL_SPACING_CHOICES, DEFAULTS.trailSpacing);
    settings.trailOpacity = clampNumber(readProperty('trailOpacity'), 5, 100, DEFAULTS.trailOpacity);
    settings.trailScale = clampNumber(readProperty('trailScale'), 40, 130, DEFAULTS.trailScale);
    settings.showPeaks = !!readProperty('showPeaks');
    settings.peakHoldMs = numberChoiceValue(readProperty('peakHoldMs'), PEAK_HOLD_CHOICES, DEFAULTS.peakHoldMs);
    settings.peakDecay = choiceValue(String(readProperty('peakDecay')), PEAK_DECAY_CHOICES, DEFAULTS.peakDecay);
    settings.peakThickness = clampNumber(readProperty('peakThickness'), 1, 6, DEFAULTS.peakThickness);

    settings.fftSize = numberChoiceValue(readProperty('fftSize'), FFT_SIZE_CHOICES, DEFAULTS.fftSize);
    settings.minHz = numberChoiceValue(readProperty('minHz'), MIN_HZ_CHOICES, DEFAULTS.minHz);
    settings.maxHz = numberChoiceValue(readProperty('maxHz'), MAX_HZ_CHOICES, DEFAULTS.maxHz);
    settings.floorDb = numberChoiceValue(readProperty('floorDb'), FLOOR_DB_CHOICES, DEFAULTS.floorDb);
    settings.ceilingDb = numberChoiceValue(readProperty('ceilingDb'), CEILING_DB_CHOICES, DEFAULTS.ceilingDb);
    settings.tiltDb = numberChoiceValue(readProperty('tiltDb'), TILT_CHOICES, DEFAULTS.tiltDb);
    settings.bandCurve = choiceValue(String(readProperty('bandCurve')), BAND_CURVE_CHOICES, DEFAULTS.bandCurve);
    settings.bandPick = choiceValue(String(readProperty('bandPick')), BAND_PICK_CHOICES, DEFAULTS.bandPick);
    settings.spectralSmooth = numberChoiceValue(readProperty('spectralSmooth'), SMOOTH_CHOICES, DEFAULTS.spectralSmooth);

    settings.fps = numberChoiceValue(readProperty('fps'), FPS_CHOICES, DEFAULTS.fps);
    settings.attack = choiceValue(String(readProperty('attack')), BALLISTIC_CHOICES, DEFAULTS.attack);
    settings.release = choiceValue(String(readProperty('release')), BALLISTIC_CHOICES, DEFAULTS.release);
    settings.idleFade = !!readProperty('idleFade');

    settings.radialInner = clampNumber(readProperty('radialInner'), 5, 80, DEFAULTS.radialInner);
    settings.radialSpread = clampNumber(readProperty('radialSpread'), 60, 360, DEFAULTS.radialSpread);
    settings.radialRotate = !!readProperty('radialRotate');

    settings.showCdArt = !!readProperty('showCdArt');
    settings.cdSize = numberChoiceValue(readProperty('cdSize'), CD_SIZE_CHOICES, DEFAULTS.cdSize);
    settings.cdSpin = !!readProperty('cdSpin');
    settings.cdSpinSpeed = choiceValue(String(readProperty('cdSpinSpeed')), CD_SPIN_SPEED_CHOICES, DEFAULTS.cdSpinSpeed);

    settings.panelName = String(readProperty('panelName') || '').slice(0, 48);
    settings.hoverTooltip = !!readProperty('hoverTooltip');
    settings.clickCyclesView = !!readProperty('clickCyclesView');

    enforceRangeOrder(false);
}

function enforceRangeOrder(persist) {
    if (settings.minHz >= settings.maxHz) {
        settings.minHz = DEFAULTS.minHz;
        settings.maxHz = DEFAULTS.maxHz;
        if (persist) {
            writeProperty('minHz', settings.minHz);
            writeProperty('maxHz', settings.maxHz);
        }
    }
    if (settings.floorDb >= settings.ceilingDb) {
        settings.floorDb = DEFAULTS.floorDb;
        settings.ceilingDb = DEFAULTS.ceilingDb;
        if (persist) {
            writeProperty('floorDb', settings.floorDb);
            writeProperty('ceilingDb', settings.ceilingDb);
        }
    }
}

function setStoredSetting(key, value) {
    if (settings[key] === value) return false;
    writeProperty(key, value);
    settings[key] = value;
    return true;
}

// Keys that describe which panel this is rather than how it looks. Resetting
// the appearance should not rename the panel out from under the settings
// screen, so these are skipped. (instanceId is not in DEFAULTS at all.)
var IDENTITY_KEYS = ['panelName'];

function resetSettings() {
    var key;
    for (key in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
            if (IDENTITY_KEYS.indexOf(key) >= 0) continue;
            writeProperty(key, DEFAULTS[key]);
        }
    }
    loadSettings();
    refreshVisualResources(false);
    rebuildAnalyser();
    applyEngineSettings(true);
    window.Repaint();
}

// Theme, scaling and fonts

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
var tooltipFont = null;

function refreshPanelDpi() {
    var nextDpi = 72;
    try {
        if (typeof DPI !== 'undefined' && Number(DPI) > 0) {
            nextDpi = Number(DPI);
        } else if (Number(window.DPI) > 0) {
            nextDpi = Number(window.DPI);
        }
    } catch (e) {
        nextDpi = 72;
    }
    panelDpi = nextDpi;
}

function scale(value) {
    value = Number(value);
    if (!isFinite(value) || value === 0) return 0;
    return Math.max(1, Math.round(value * panelDpi / 72));
}

// The accent fed to createTheme. 'album' follows the shared broadcast; every
// other mode keeps the theme accent neutral so the RVG surface colours do
// not swing about when the visualiser colour changes.
function themeAccent() {
    if (settings.colourMode === 'album') return sharedAlbumAccent;
    if (settings.colourMode === 'custom') return RivageUI.opaque(settings.customColour);
    return RivageUI.opaque(RivageUI.DEFAULT_ACCENT);
}

function refreshTheme() {
    hostVisualInfo = RivageUI.hostInfo();
    hostFontName = hostVisualInfo.fontFamily || 'Segoe UI';
    theme = RivageUI.createTheme({
        host: hostVisualInfo,
        mode: settings.themeMode,
        accent: themeAccent()
    });
    painter.setTheme(theme);
}

// Local D2D font + text helpers
// RivageUI.font() and painter.tooltip() are the only two GDI-bound things this
// panel used from the shared design system, so they are reimplemented here for
// Direct2D rather than branching a file 15 other panels depend on.
//
// The cache is not just a speed trick: the docs warn that the number of live
// D2DFont objects is hard-limited by Windows and that creation FAILS once the
// limit is hit, so fonts must never be built per paint. This mirrors
// design_system.js's own safeFont, including the Segoe UI fallback.

var d2dFontCache = {};

function d2dFont(name, size, style) {
    var family = String(name || 'Segoe UI');
    var pixelSize = Math.max(1, Math.min(300, Math.round(Number(size) || 1)));
    var fontStyle = Math.round(Number(style) || 0);
    var key = family.toLowerCase() + '|' + pixelSize + '|' + fontStyle;
    var font = null;

    if (Object.prototype.hasOwnProperty.call(d2dFontCache, key)) return d2dFontCache[key];

    try {
        font = d2d.Font(family, pixelSize, fontStyle);
    } catch (e) {
        font = null;
    }

    if (!font && family.toLowerCase() !== 'segoe ui') {
        try {
            font = d2d.Font('Segoe UI', pixelSize, fontStyle);
        } catch (e2) {
            font = null;
        }
    }

    if (font) d2dFontCache[key] = font;
    return font;
}

// D2DGraphics has no GdiDrawText. DrawText is the fast path and is safe here
// because on_paint always fills the whole panel with an opaque background
// first - the docs only warn against DrawText on a transparent surface or on a
// D2DGraphics other than the one handed to on_paint. RivageUI.textFlags are
// plain DT_* values (and already include DT_NOPREFIX), so they pass straight
// through to the `format` argument.
function drawText(gr, text, font, colour, x, y, w, h, flags) {
    if (!font || w <= 0 || h <= 0) return;
    try {
        gr.DrawText(String(text), font, colour, x, y, w, h, flags || 0);
    } catch (e) { reportFailure('text could not be drawn', e); }
}

function textWidth(gr, text, font, fallbackCharWidth) {
    try {
        return Math.ceil(gr.CalcTextWidth(String(text), font));
    } catch (e) {
        return String(text).length * (fallbackCharWidth || scale(7));
    }
}

function rebuildFonts(clearCache) {
    if (clearCache) d2dFontCache = {};
    titleFont = d2dFont(hostFontName, Math.max(9, scale(10)), 1);
    metaFont = d2dFont(hostFontName, Math.max(7, scale(7)), 0);
    var consoleFont = RivageUI.consoleFontInfo();
    tooltipFont = d2dFont(consoleFont.fontFamily, consoleFont.fontSize, consoleFont.fontStyle || 0);
}

function refreshVisualResources(clearFontCache) {
    refreshPanelDpi();
    refreshTheme();
    rebuildFonts(clearFontCache);
    // Theme and DPI both feed the baked brush colours and geometry.
    dropBrushCache();
}

// FFT
// Iterative in-place radix-2 Cooley-Tukey. Tables (bit-reversal permutation,
// twiddle factors, analysis window) are rebuilt only when the FFT size
// changes, never per frame.

function FftContext(size) {
    var i;
    var bits = 0;
    var n = size;

    while (n > 1) { n >>= 1; bits++; }

    this.size = size;
    this.bits = bits;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.mag = new Float64Array(size / 2);
    this.win = new Float64Array(size);
    this.rev = new Int32Array(size);
    this.cosTable = new Float64Array(size / 2);
    this.sinTable = new Float64Array(size / 2);

    // Hann window, plus its coherent gain so magnitudes stay comparable
    // across FFT sizes.
    var windowSum = 0;
    for (i = 0; i < size; i++) {
        this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
        windowSum += this.win[i];
    }
    this.windowGain = windowSum / size;

    for (i = 0; i < size; i++) {
        var reversed = 0;
        var value = i;
        var b;
        for (b = 0; b < bits; b++) {
            reversed = (reversed << 1) | (value & 1);
            value >>= 1;
        }
        this.rev[i] = reversed;
    }

    for (i = 0; i < size / 2; i++) {
        var angle = -2 * Math.PI * i / size;
        this.cosTable[i] = Math.cos(angle);
        this.sinTable[i] = Math.sin(angle);
    }
}

// samples: Float64Array-like of at least `size` entries (zero padded by the
// caller). Fills this.mag with linear magnitudes, bin 0 .. size/2 - 1.
FftContext.prototype.run = function (samples, sampleCount) {
    var size = this.size;
    var re = this.re;
    var im = this.im;
    var rev = this.rev;
    var win = this.win;
    var i;

    for (i = 0; i < size; i++) {
        var source = i < sampleCount ? samples[i] : 0;
        var target = rev[i];
        re[target] = source * win[i];
        im[target] = 0;
    }

    var half = 1;
    var step = size >> 1;

    while (half < size) {
        var span = half << 1;
        for (i = 0; i < size; i += span) {
            var k = 0;
            var j;
            for (j = i; j < i + half; j++) {
                var wr = this.cosTable[k];
                var wi = this.sinTable[k];
                var partner = j + half;
                var tre = re[partner] * wr - im[partner] * wi;
                var tim = re[partner] * wi + im[partner] * wr;
                re[partner] = re[j] - tre;
                im[partner] = im[j] - tim;
                re[j] += tre;
                im[j] += tim;
                k += step;
            }
        }
        half = span;
        step >>= 1;
    }

    var bins = size >> 1;
    var normal = 2 / (size * this.windowGain);
    for (i = 0; i < bins; i++) {
        var a = re[i];
        var b = im[i];
        this.mag[i] = Math.sqrt(a * a + b * b) * normal;
    }
};

// Analyser

var LOG10 = Math.LN10;
var SILENT_DB = -140;

var analyser = {
    fft: null,
    mono: null,
    sampleRate: 44100,
    bandLo: null,
    bandHi: null,
    bandGain: null,
    bandCentre: null,
    bandCount: 0,
    raw: null,          // 0..1 normalised, post-tilt, pre-ballistics
    level: null,        // displayed level after attack/release
    prevLevel: null,    // `level` as of the previous tick, for paint-time interpolation
    liveLevel: null,    // scratch: interpolated snapshot of `level` returned for layer 0
    peak: null,         // peak marker level
    peakAge: null,      // milliseconds since the peak was set
    history: [],        // ring of past `level` snapshots for the ghost trail
    historyHead: 0,
    historyLength: 0,
    active: false
};

function hzToMel(hz) {
    return 2595 * Math.log(1 + hz / 700) / LOG10;
}

function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

function bandEdgeHz(index, count) {
    var lo = settings.minHz;
    var hi = settings.maxHz;
    var t = index / count;

    if (settings.bandCurve === 'linear') {
        return lo + (hi - lo) * t;
    }
    if (settings.bandCurve === 'mel') {
        var mLo = hzToMel(lo);
        var mHi = hzToMel(hi);
        return melToHz(mLo + (mHi - mLo) * t);
    }
    return lo * Math.pow(hi / lo, t);
}

function rebuildAnalyser() {
    var count = settings.barCount;
    var size = settings.fftSize;
    var i;

    if (!analyser.fft || analyser.fft.size !== size) {
        analyser.fft = new FftContext(size);
        analyser.mono = new Float64Array(size);
    }

    analyser.bandCount = count;
    analyser.bandLo = new Int32Array(count);
    analyser.bandHi = new Int32Array(count);
    analyser.bandGain = new Float64Array(count);
    analyser.bandCentre = new Float64Array(count);
    analyser.raw = new Float64Array(count);
    analyser.level = new Float64Array(count);
    analyser.prevLevel = new Float64Array(count);
    analyser.liveLevel = new Float64Array(count);
    analyser.peak = new Float64Array(count);
    analyser.peakAge = new Float64Array(count);
    analyser.history = [];
    analyser.historyHead = 0;
    analyser.historyLength = 0;

    for (i = 0; i < count; i++) {
        analyser.bandCentre[i] = Math.sqrt(bandEdgeHz(i, count) * bandEdgeHz(i + 1, count));
    }

    rebuildBandBins();
    rebuildHistoryRing();
}

// Bin ranges depend on the stream's sample rate, so they are rebuilt whenever
// the rate changes as well as when the band layout does.
function rebuildBandBins() {
    var count = analyser.bandCount;
    var size = settings.fftSize;
    var bins = size >> 1;
    var binHz = analyser.sampleRate / size;
    var nyquist = analyser.sampleRate / 2;
    var referenceHz = 1000;
    var i;

    if (!count || !analyser.bandLo) return;

    for (i = 0; i < count; i++) {
        var loHz = bandEdgeHz(i, count);
        var hiHz = Math.min(bandEdgeHz(i + 1, count), nyquist);
        var lo = 0;
        var hi = 0;

        if (loHz < nyquist) {
            lo = Math.floor(loHz / binHz);
            hi = Math.ceil(hiHz / binHz);
            if (hi <= lo) hi = lo + 1;
            lo = Math.max(1, Math.min(bins - 1, lo));
            hi = Math.max(lo + 1, Math.min(bins, hi));
        }

        analyser.bandLo[i] = lo;
        analyser.bandHi[i] = hi;

        var centre = Math.max(1, analyser.bandCentre[i]);
        var octaves = Math.log(centre / referenceHz) / Math.LN2;
        analyser.bandGain[i] = settings.tiltDb * octaves;
    }
}

function rebuildHistoryRing() {
    var frames = settings.trailFrames;
    var spacing = settings.trailSpacing;
    var needed = frames > 0 ? frames * spacing + 1 : 0;
    var i;

    analyser.history = [];
    analyser.historyHead = 0;
    analyser.historyLength = needed;

    for (i = 0; i < needed; i++) {
        analyser.history.push(new Float64Array(analyser.bandCount));
    }
}

// The original motion tuning was authored around the old 45 fps default.
// Treat those values as reference-frame coefficients, then scale them by the
// real elapsed time. This keeps attack/release/decay speed stable at 20, 30 or
// 60 fps and prevents a late timer callback from producing a freeze/catch-up.
var MOTION_REFERENCE_FPS = 45;
var MOTION_REFERENCE_FRAME_MS = 1000 / MOTION_REFERENCE_FPS;

function elapsedFrameRatio(dtMs) {
    dtMs = Number(dtMs);
    if (!(dtMs > 0) || !isFinite(dtMs)) dtMs = frameIntervalMs();
    return Math.max(0.05, Math.min(8, dtMs / MOTION_REFERENCE_FRAME_MS));
}

function timeAdjustedCoefficient(coefficient, dtMs) {
    if (coefficient >= 1) return 1;
    if (coefficient <= 0) return 0;
    return 1 - Math.pow(1 - coefficient, elapsedFrameRatio(dtMs));
}

function ballisticCoefficient(name, rising, dtMs) {
    var coefficient;
    switch (name) {
    case 'instant': coefficient = 1; break;
    case 'fast': coefficient = rising ? 0.85 : 0.42; break;
    case 'smooth': coefficient = rising ? 0.42 : 0.12; break;
    case 'glacial': coefficient = rising ? 0.24 : 0.06; break;
    default: coefficient = rising ? 0.62 : 0.22; break;
    }
    return timeAdjustedCoefficient(coefficient, dtMs);
}

function peakDecayPerReferenceFrame() {
    switch (settings.peakDecay) {
    case 'fast': return 0.030;
    case 'slow': return 0.008;
    case 'very_slow': return 0.004;
    default: return 0.015;
    }
}

function peakDecayStep(dtMs) {
    return peakDecayPerReferenceFrame() * elapsedFrameRatio(dtMs);
}

function amplitudeToDb(value) {
    if (!(value > 0)) return SILENT_DB;
    return 20 * Math.log(value) / LOG10;
}

function normaliseDb(db) {
    var span = settings.ceilingDb - settings.floorDb;
    if (span <= 0) return 0;
    var t = (db - settings.floorDb) / span;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

// Collapses an interleaved multi-channel chunk into `analyser.mono`.
function downmixChunk(data, channels, frames, wanted) {
    var mono = analyser.mono;
    var take = Math.min(frames, wanted);
    var offset = frames > wanted ? (frames - wanted) : 0;
    var i;
    var c;

    if (channels === 1) {
        for (i = 0; i < take; i++) mono[i] = data[offset + i];
    } else if (channels === 2) {
        for (i = 0; i < take; i++) {
            var base = (offset + i) * 2;
            mono[i] = (data[base] + data[base + 1]) * 0.5;
        }
    } else {
        var inverse = 1 / channels;
        for (i = 0; i < take; i++) {
            var start = (offset + i) * channels;
            var sum = 0;
            for (c = 0; c < channels; c++) sum += data[start + c];
            mono[i] = sum * inverse;
        }
    }

    for (i = take; i < wanted; i++) mono[i] = 0;
}

function applySpectralSmoothing(values, count) {
    var passes = settings.spectralSmooth;
    var p;
    var i;
    if (passes <= 0 || count < 3) return;

    for (p = 0; p < passes; p++) {
        var previous = values[0];
        for (i = 1; i < count - 1; i++) {
            var current = values[i];
            values[i] = previous * 0.25 + current * 0.5 + values[i + 1] * 0.25;
            previous = current;
        }
    }
}

function pushHistoryFrame() {
    if (!analyser.historyLength) return;
    var slot = analyser.history[analyser.historyHead];
    var i;
    for (i = 0; i < analyser.bandCount; i++) slot[i] = analyser.level[i];
    analyser.historyHead = (analyser.historyHead + 1) % analyser.historyLength;
}

// layer 1 is the newest ghost, layer `trailFrames` the oldest.
function historyFrame(layer) {
    if (!analyser.historyLength) return null;
    var back = layer * settings.trailSpacing;
    if (back >= analyser.historyLength) return null;
    var index = analyser.historyHead - 1 - back;
    while (index < 0) index += analyser.historyLength;
    return analyser.history[index];
}

function decayToSilence(dtMs) {
    var count = analyser.bandCount;
    var release = ballisticCoefficient(settings.release, false, dtMs);
    var peakStep = peakDecayStep(dtMs);
    var moving = false;
    var i;

    for (i = 0; i < count; i++) {
        if (analyser.level[i] > 0.0015) {
            analyser.level[i] += (0 - analyser.level[i]) * release;
            moving = true;
        } else {
            analyser.level[i] = 0;
        }
        analyser.raw[i] = 0;
        if (analyser.peak[i] > 0) {
            analyser.peak[i] = Math.max(0, analyser.peak[i] - peakStep);
            moving = true;
        }
    }

    pushHistoryFrame();
    return moving;
}

function analyseFrame(dtMs) {
    // Ask for exactly the window downmixChunk() will actually use. This was
    // hardcoded to 44100: on a 48k stream it over-requested by 9%, and on a 96k
    // stream by 118%, which only makes an unsatisfiable request more likely.
    var chunkSeconds = Math.max(0.02, settings.fftSize / (analyser.sampleRate || 44100));
    var chunk;

    try {
        if (fb.PlaybackTime < chunkSeconds) return false;
        chunk = fb.GetAudioChunk(chunkSeconds);
    } catch (e) {
        return false;
    }

    if (!chunk) return false;

    var channels = Number(chunk.ChannelCount) || 0;
    var frames = Number(chunk.SampleCount) || 0;
    var data = chunk.Data;
    var rate = Number(chunk.SampleRate) || analyser.sampleRate;

    if (!data || channels < 1 || frames < 1) return false;

    if (rate !== analyser.sampleRate) {
        analyser.sampleRate = rate;
        rebuildBandBins();
    }

    var size = settings.fftSize;
    downmixChunk(data, channels, frames, size);

    analyser.fft.run(analyser.mono, size);

    var mag = analyser.fft.mag;
    var count = analyser.bandCount;
    var raw = analyser.raw;
    var i;

    for (i = 0; i < count; i++) {
        var lo = analyser.bandLo[i];
        var hi = analyser.bandHi[i];
        var value = 0;
        var bin;

        if (hi <= lo) {
            raw[i] = 0;
            continue;
        }

        if (settings.bandPick === 'avg') {
            for (bin = lo; bin < hi; bin++) value += mag[bin];
            value /= (hi - lo);
        } else if (settings.bandPick === 'rms') {
            for (bin = lo; bin < hi; bin++) value += mag[bin] * mag[bin];
            value = Math.sqrt(value / (hi - lo));
        } else {
            for (bin = lo; bin < hi; bin++) {
                if (mag[bin] > value) value = mag[bin];
            }
        }

        raw[i] = normaliseDb(amplitudeToDb(value) + analyser.bandGain[i]);
    }

    applySpectralSmoothing(raw, count);
    for (i = 0; i < count; i++) {
        if (analyser.bandHi[i] <= analyser.bandLo[i]) raw[i] = 0;
    }

    var attackK = ballisticCoefficient(settings.attack, true, dtMs);
    var releaseK = ballisticCoefficient(settings.release, false, dtMs);
    var holdMs = Math.max(0, settings.peakHoldMs);
    var peakStep = peakDecayStep(dtMs);

    for (i = 0; i < count; i++) {
        var target = raw[i];
        var current = analyser.level[i];
        analyser.level[i] = current + (target - current) * (target > current ? attackK : releaseK);

        if (settings.showPeaks) {
            if (analyser.level[i] >= analyser.peak[i]) {
                analyser.peak[i] = analyser.level[i];
                analyser.peakAge[i] = 0;
            } else {
                analyser.peakAge[i] += dtMs;
                if (analyser.peakAge[i] > holdMs) {
                    analyser.peak[i] = Math.max(analyser.level[i], analyser.peak[i] - peakStep);
                }
            }
        }
    }

    pushHistoryFrame();
    return true;
}

// Engine timer and visibility gating
// JSplitter keeps hidden child panels loaded, so the scheduler is stopped while
// the panel is hidden and restarted from on_paint - reaching on_paint is the
// reliable signal that a hidden child became visible again.

var timerId = 0;
var engineRunning = false;
// ClearTimeout cannot retract a callback the host has already queued. A stale
// generation must never clear or reschedule a newer engine run.
var engineGeneration = 0;
var nextFrameTimeMs = 0;
var lastFrameTimeMs = 0;
var playbackPaused = !!fb.IsPaused;
var suspendedForVisibility = false;
var idleFrames = 0;
var rotationPhase = 0;

function isVisible() {
    return VisiblePaintWork.isVisible();
}

function repaintIfVisible() {
    if (isVisible()) window.Repaint();
}

function frameIntervalMs() {
    // Keep the fractional interval. Rounding 30 fps to 33 ms makes it 30.303
    // fps; rounding 60 fps to 17 ms makes it 58.824 fps. Both drift against a
    // normal display refresh and periodically produce an avoidable hitch.
    return Math.max(8, 1000 / settings.fps);
}

function monotonicNowMs() {
    try {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
            return performance.now();
        }
    } catch (e) { }
    return Date.now();
}

function shouldEngineRun() {
    return isVisible() && fb.IsPlaying && !playbackPaused && !fb.IsPaused;
}

function stopTimer() {
    engineRunning = false;
    engineGeneration++;
    missedPolls = 0;
    if (timerId) {
        try { window.ClearTimeout(timerId); } catch (e) { }
        timerId = 0;
    }
    nextFrameTimeMs = 0;
    lastFrameTimeMs = 0;
}

function scheduleNextEngineTick() {
    if (!engineRunning || timerId) return;
    var generation = engineGeneration;
    var delay = Math.max(0, nextFrameTimeMs - monotonicNowMs());
    var scheduledId = 0;
    scheduledId = window.SetTimeout(function () {
        runScheduledEngineTick(generation, scheduledId);
    }, delay);
    timerId = scheduledId;
}

function runScheduledEngineTick(generation, scheduledId) {
    if (!engineRunning || generation !== engineGeneration || timerId !== scheduledId) return;
    timerId = 0;

    var interval = frameIntervalMs();
    var now = monotonicNowMs();
    var dtMs = lastFrameTimeMs > 0 ? now - lastFrameTimeMs : interval;
    lastFrameTimeMs = now;
    dtMs = Math.max(1, Math.min(250, dtMs));
    onEngineTick(dtMs);
    if (!engineRunning || generation !== engineGeneration) return;

    nextFrameTimeMs += interval;
    var afterWork = monotonicNowMs();
    if (nextFrameTimeMs <= afterWork) {
        nextFrameTimeMs += (Math.floor((afterWork - nextFrameTimeMs) / interval) + 1) * interval;
    }
    scheduleNextEngineTick();
}

// How many consecutive empty audio polls to ride out before believing the
// silence. See the comment in onEngineTick.
var MAX_HELD_POLLS = 3;
var missedPolls = 0;

function onEngineTick(dtMs) {
    var produced = false;
    var playing = fb.IsPlaying && !playbackPaused && !fb.IsPaused;

    // Snapshot before anything below mutates analyser.level, so levelsForLayer(0)
    // can interpolate between this tick's starting point and its result.
    analyser.prevLevel.set(analyser.level);

    if (playing) produced = analyseFrame(dtMs);

    var held = false;
    if (produced) {
        missedPolls = 0;
    } else if (playing && ++missedPolls <= MAX_HELD_POLLS) {
        held = true;
        pushHistoryFrame();
    } else if (!playing) {
        missedPolls = 0;
    }

    if (held) {
        idleFrames = 0;
        analyser.active = true;
    } else if (!produced) {
        if (!settings.idleFade) {
            clearLevels();
            idleFrames = 0;
            if (!playing) {
                stopTimer();
                repaintIfVisible();
                return;
            }
        } else {
            var stillMoving = decayToSilence(dtMs);
            if (playing) {
                idleFrames = 0;
            } else if (!stillMoving) {
                if (++idleFrames > 4) {
                    clearLevels();
                    stopTimer();
                    repaintIfVisible();
                    return;
                }
            } else {
                idleFrames = 0;
            }
        }
    } else {
        idleFrames = 0;
        analyser.active = true;
    }

    var motionFrames = elapsedFrameRatio(dtMs);
    if (settings.radialRotate) {
        rotationPhase = (rotationPhase + 0.12 * motionFrames) % 360;
    }
    if (settings.view === 'radial' && settings.showCdArt && settings.cdSpin) {
        cdRotationPhase = (cdRotationPhase + cdSpinDegreesPerReferenceFrame() * motionFrames) % 360;
    }

    if (isVisible()) {
        window.Repaint();
    } else {
        suspendMeterForVisibility();
    }
}

// rotationPhase/cdRotationPhase/analyser.level above are correct AS OF the last
// engine tick, but window.Repaint() only invalidates - the actual on_paint can
// land some ms after that tick (same gap documented in shared/marquee_widget.js,
// which had a confirmed stutter from exactly this). A fixed tick interval painted
// at a variable tick-to-paint latency turns into an alternating short/long dwell
// per value even though the values themselves are correct, so both rotation
// (a continuous function of time) and bar levels (levelsForLayer(0), via
// frameProgress()) extrapolate/interpolate the small remaining gap at the moment
// of the actual paint instead of reading the last-tick value directly. Ghost
// trail layers (layer > 0) are already-past discrete frames and are not
// interpolated.
function extrapolatedTickElapsedMs() {
    if (!engineRunning || !(lastFrameTimeMs > 0)) return 0;
    var extra = monotonicNowMs() - lastFrameTimeMs;
    // Clamped to one frame interval - this only ever needs to fill the tick-
    // to-paint gap. The tick loop's own dtMs clamp (runScheduledEngineTick)
    // already handles a stalled/suspended process catching back up.
    return Math.max(0, Math.min(frameIntervalMs(), extra));
}

// 0 at the start of the current tick's interval, 1 once a full interval has
// elapsed since it landed. 1 (i.e. "just show the latest tick value") whenever
// the engine isn't actively running, so a paint that happens after the engine
// has stopped (idle clear, pause, hidden) shows the true final level immediately
// rather than lagging one tick behind.
function frameProgress() {
    if (!engineRunning) return 1;
    var interval = frameIntervalMs();
    if (!(interval > 0)) return 1;
    return Math.max(0, Math.min(1, extrapolatedTickElapsedMs() / interval));
}

function liveRotationPhase() {
    if (!settings.radialRotate) return rotationPhase;
    var extra = extrapolatedTickElapsedMs();
    if (!extra) return rotationPhase;
    return (rotationPhase + 0.12 * (extra / MOTION_REFERENCE_FRAME_MS)) % 360;
}

function liveCdRotationPhase() {
    var extra = extrapolatedTickElapsedMs();
    if (!extra) return cdRotationPhase;
    return (cdRotationPhase + cdSpinDegreesPerReferenceFrame() * (extra / MOTION_REFERENCE_FRAME_MS)) % 360;
}

function startEngineIfRunnable() {
    if (!shouldEngineRun()) {
        if (!isVisible()) suspendedForVisibility = true;
        return false;
    }
    suspendedForVisibility = false;
    idleFrames = 0;
    if (!engineRunning) {
        var now = monotonicNowMs();
        var interval = frameIntervalMs();
        engineRunning = true;
        lastFrameTimeMs = now;
        nextFrameTimeMs = now + interval;
        scheduleNextEngineTick();
    }
    return true;
}

function suspendMeterForVisibility() {
    if (suspendedForVisibility) return;
    suspendedForVisibility = true;
    stopTimer();
}

function resumeMeterForVisibility() {
    if (!suspendedForVisibility || !isVisible()) return false;
    suspendedForVisibility = false;
    if (!fb.IsPlaying || playbackPaused || fb.IsPaused) return false;
    return startEngineIfRunnable();
}

function clearLevels() {
    var i;
    if (!analyser.bandCount) return;
    for (i = 0; i < analyser.bandCount; i++) {
        analyser.level[i] = 0;
        analyser.prevLevel[i] = 0;
        analyser.raw[i] = 0;
        analyser.peak[i] = 0;
        analyser.peakAge[i] = 0;
    }
    // Zero the existing rings rather than replacing them. rebuildHistoryRing()
    // owns sizing, so these are already the right length - allocating 11 to 61
    // fresh Float64Arrays here just to hold zeros made every stop, middle-click
    // and idle-clear an allocation spike for nothing. Guarded in case a ring
    // slot has not been built yet.
    for (i = 0; i < analyser.history.length; i++) {
        if (analyser.history[i] && analyser.history[i].length === analyser.bandCount) {
            analyser.history[i].fill(0);
        } else {
            analyser.history[i] = new Float64Array(analyser.bandCount);
        }
    }
    analyser.active = false;
}

function clearPeakState() {
    var i;
    for (i = 0; i < analyser.bandCount; i++) {
        analyser.peak[i] = 0;
        analyser.peakAge[i] = 0;
    }
}

function applyEngineSettings(restart) {
    if (restart) {
        stopTimer();
        startEngineIfRunnable();
    }
}

// Colour resolution

var WHITE = RivageUI.rgb(255, 255, 255);
var BLACK = RivageUI.rgb(0, 0, 0);
var gradientSupported = true;

function baseColour() {
    switch (settings.colourMode) {
    case 'album': return RivageUI.opaque(sharedAlbumAccent);
    case 'white': return WHITE;
    case 'text': return RivageUI.opaque(theme.textPrimary);
    case 'custom': return RivageUI.opaque(settings.customColour);
    default: return RivageUI.opaque(theme.accent);
    }
}

function backgroundColour() {
    switch (settings.background) {
    case 'card': return theme.card;
    case 'alt': return theme.backgroundAlt;
    case 'black': return BLACK;
    default: return theme.background;
    }
}

function gradientDepthAmount() {
    switch (settings.gradientDepth) {
    case 'subtle': return 0.28;
    case 'strong': return 0.70;
    case 'extreme': return 0.90;
    default: return 0.50;
    }
}

// Returns f(edge, alphaMultiplier) -> ARGB, where edge 0 is the bar's origin
// (base / centre line / inner radius) and edge 1 is its far tip.
function makeRamp(base) {
    var useGradient = settings.gradient && gradientSupported;
    var depth = gradientDepthAmount();
    var mode = settings.gradientTint;
    var dark = RivageUI.mix(base, BLACK, depth);
    var light = RivageUI.mix(base, WHITE, depth);

    // One ramp is built per layer and reused for every band in it; the alpha
    // multiplier is a call argument so no closure is allocated per bar.
    return function (edge, alphaMultiplier) {
        var alpha = 255 * (alphaMultiplier === undefined ? 1 : alphaMultiplier);
        if (!useGradient) return RivageUI.withAlpha(base, alpha);

        edge = edge < 0 ? 0 : (edge > 1 ? 1 : edge);
        switch (mode) {
        case 'lighten':
            return RivageUI.withAlpha(RivageUI.mix(base, light, edge), alpha);
        case 'invert':
            return RivageUI.withAlpha(RivageUI.mix(dark, base, edge), alpha);
        case 'fade':
            return RivageUI.withAlpha(base, alpha * (1 - depth * edge));
        default:
            return RivageUI.withAlpha(RivageUI.mix(base, dark, edge), alpha);
        }
    };
}

// Horizontal position fade used by the mirrored / bar / ribbon views so the
// spectrum tapers away at the panel edges instead of stopping abruptly.
function edgeFadeAt(index, count) {
    if (!settings.edgeFade || count < 4) return 1;
    var span = Math.max(1, Math.round(count * settings.edgeFadeAmount / 100));
    var distance = Math.min(index, count - 1 - index);
    if (distance >= span) return 1;
    var t = distance / span;
    // Smoothstep, floored so the outermost bands stay faintly visible.
    return 0.10 + 0.90 * (t * t * (3 - 2 * t));
}

// Direct2D brush cache
// A gradient brush bakes its colours (alpha included) at creation, so a brush
// can only be reused by bars that want the same ramp AND the same alpha. Two
// things keep that bounded:
//
//   - alpha is quantised into BRUSH_ALPHA_STEPS buckets. Only the live layer
//     uses brushes (ghosts are flat single-colour fills), so in practice the
//     only thing varying alpha is edge fade, which touches the outer bands
//     only - a handful of buckets per frame, all cache hits after the first.
//   - the cache is dropped whenever anything makeRamp closes over changes.
//
// Brushes are never created per frame in steady state, which matters: D2D
// resource creation is the expensive part, not the fill.
//
// Local copies of docs\Flags.js values, following the same convention as
// musicbrainz_panel.js and cd_spectrum_panel.js - the host does not reliably
// provide these as globals.
var BRUSH_SOLID = 0;
var BRUSH_LINEAR_GRADIENT = 1;
var BRUSH_BITMAP = 3;
var BRUSH_WRAP_CLAMP = 4;
var SMOOTHING_MODE_ANTIALIAS = 4;

var BRUSH_ALPHA_STEPS = 32;     // ~8/255 per step - below the visible threshold
var BRUSH_GRADIENT_STOPS = 17;  // stops baked per ramp; cost is one-off

// One-shot downgrade, matching the existing `gradientSupported` pattern: if
// brush creation ever fails, every view falls back to its stop-list path for
// the rest of the session instead of retrying a call known to be unavailable.
var brushSupported = true;

// Brush caches are keyed by INTEGER, not by a built-up string.
//
// These lookups run once per bar per frame - roughly 64 live bars plus ~250
// ghost bars at default settings. Building 'L|centre|32' and '90|21' style keys
// there cost ~550 short-lived strings per paint, about 18k/s at 30fps and 36k/s
// at 60, purely to index a map. Individual nursery collections are
// sub-millisecond, but they land at unpredictable moments, which is exactly
// what shows up as an occasional hitch rather than as a lower framerate. Small
// integers allocate nothing at all.
//
// Key layout: edgeId * BRUSH_KEY_STRIDE + alpha bucket, with the radial bar
// brush given its own edgeId so it cannot collide with the linear ones.
var BRUSH_KEY_STRIDE = BRUSH_ALPHA_STEPS + 1;
var EDGE_ID_CENTRE = 0;
var EDGE_ID_BOTTOM = 1;
var EDGE_ID_RADIAL = 2;

function brushKeyFor(edgeId, bucket) {
    return edgeId * BRUSH_KEY_STRIDE + bucket;
}

var brushCache = new Map();
var brushCacheSignature = '';

// Rebuilt only when rampSignature() changes; see invalidateBrushesIfStale().
var cachedRamp = null;

// Tracks where each cached brush's axis currently points, so a brush that is
// already aimed correctly is not re-transformed. Under 'panel' scaling every
// bar in a layer shares one span, which turns a per-bar SetTransform into a
// single call per layer; under 'element' scaling the span changes per bar and
// this is simply always a miss.
//
// The aim is packed into one number (top * 65536 + height) rather than a
// 'top|height' string. Both components are rounded integers and the panel is
// far smaller than 32768px, so the result is exact in a float64 and allocates
// nothing.
var brushAimState = new Map();

// Reused so aiming a brush at a bar does not allocate a Float32Array per bar
// per frame. Layout is [m11, m12, m21, m22, dx, dy].
var brushMatrix = new Float32Array([1, 0, 0, 1, 0, 0]);

// JSplitter builds a throwaway D2D brush every time a raw ARGB number is handed
// to a drawing primitive. In a view issuing hundreds of fills per frame that
// churn is not free, so solid colours are cached as brushes too. Borrowed from
// cd_spectrum_panel.js, which measured this first.
//
// Values that are already brush objects pass straight through, because
// fillRoundRectSafe and fillRect are shared by both the raw-colour and the
// gradient-brush call paths.
var D2D_SOLID_BRUSH_CACHE_LIMIT = 384;
var solidBrushCache = new Map();
var solidBrushCount = 0;

function solidBrush(colour) {
    if (typeof colour !== 'number') return colour;

    // Keyed on the raw integer. This used to do String(value) on every call -
    // and it is called once per fill, so once per ghost bar as well as per live
    // bar, making it the single largest source of per-frame garbage in the
    // paint path.
    var value = colour >>> 0;
    var cached = solidBrushCache.get(value);
    if (cached !== undefined) return cached;

    var brush = null;
    try { brush = d2d.Brush(BRUSH_SOLID, value); } catch (e) { brush = null; }
    if (!brush) return colour;

    // Ghost layers and gradients can walk through a lot of distinct ARGB
    // values; a hard cap keeps this from growing without bound.
    if (solidBrushCount >= D2D_SOLID_BRUSH_CACHE_LIMIT) {
        solidBrushCache = new Map();
        solidBrushCount = 0;
    }
    solidBrushCache.set(value, brush);
    solidBrushCount++;
    return brush;
}

function alphaBucketFor(alpha) {
    alpha = alpha < 0 ? 0 : (alpha > 1 ? 1 : alpha);
    return Math.round(alpha * BRUSH_ALPHA_STEPS);
}

function bucketAlpha(bucket) {
    return bucket / BRUSH_ALPHA_STEPS;
}

// Everything makeRamp closes over. Compared once per paint, not per bar.
function rampSignature() {
    return baseColour() + '|' + (settings.gradient ? 1 : 0) + '|' +
        (gradientSupported ? 1 : 0) + '|' +
        settings.gradientTint + '|' + settings.gradientDepth;
}

function invalidateBrushesIfStale() {
    var signature = rampSignature();
    if (signature === brushCacheSignature) return;
    brushCacheSignature = signature;
    brushCache = new Map();
    // The ramp closes over exactly what rampSignature() covers, so it only ever
    // needs rebuilding here. It used to be rebuilt in on_paint on every single
    // frame - one closure plus its captured environment per paint, for a value
    // that changes only when the accent or gradient settings do.
    cachedRamp = makeRamp(baseColour());
    // MUST be cleared alongside brushCache, not just in dropBrushCache().
    // aimBrushOnce() skips SetTransform when the recorded aim for a brushKey
    // still matches, so leaving stale aim strings behind means the next frame
    // builds a FRESH brush under the same key ('centre|32'), finds a matching
    // aim, and returns true without ever transforming it. Under
    // gradientScale:'panel' the span is the whole plot rect, so the aim never
    // changes on its own and the untransformed brush would persist until the
    // next on_size or dropBrushCache() - the gradient silently collapsing to a
    // flat fill for the rest of the session.
    brushAimState = new Map();
}

function dropBrushCache() {
    brushCache = new Map();
    brushCacheSignature = '';
    cachedRamp = null;
    brushAimState = new Map();
    cdBrushAim = '';
    // Release the flat-fill brushes too. Every key here is a raw ARGB derived
    // from the current accent, so under colourMode:'album' an entire generation
    // of them goes dead the moment the accent changes - roughly 78 per accent
    // at default settings (5 trail layers x ~15 edge-fade alphas). Without this
    // they lingered until solidBrushCount hit D2D_SOLID_BRUSH_CACHE_LIMIT and
    // the whole map was wiped at once, which both stranded ~384 live D2D
    // brushes and forced a large brush rebuild inside a single paint - a
    // periodic hitch every few tracks rather than a steady cost.
    solidBrushCache = new Map();
    solidBrushCount = 0;
}

function rampStops(edgeAt, ramp, alpha, samples) {
    var stops = [];
    var i;
    for (i = 0; i < samples; i++) {
        var t = samples === 1 ? 0 : i / (samples - 1);
        stops.push(t, ramp(edgeAt(t), alpha));
    }
    return stops;
}

// Unit linear gradient running down the y axis, (0,0) -> (0,1). Callers aim it
// at a real bar with aimBrushAtSpan() rather than baking one brush per bar.
function linearRampBrush(edgeId, edgeAt, ramp, bucket) {
    if (!brushSupported) return null;
    var key = brushKeyFor(edgeId, bucket);
    var cached = brushCache.get(key);
    if (cached !== undefined) return cached;

    var brush = null;
    try {
        brush = d2d.Brush(BRUSH_LINEAR_GRADIENT, [0, 0], [0, 1],
            rampStops(edgeAt, ramp, bucketAlpha(bucket), BRUSH_GRADIENT_STOPS),
            BRUSH_WRAP_CLAMP);
    } catch (e) {
        brushLog('Linear gradient brush unavailable: ' + e);
        brushSupported = false;
        brush = null;
    }

    brushCache.set(key, brush);
    return brush;
}

// Radial bars use a LINEAR gradient brush aligned along the bar's own axis,
// not a radial one. This is lifted from cd_spectrum_panel.js and it is the
// better idea: a radial brush's stop positions depend on the inner/outer
// ratio, which differs per bar and cannot be fixed up by a transform, so it
// only ever worked for panel-wide scaling. A linear brush laid along the bar
// and then scaled/rotated into place handles both scaling modes and, more
// importantly, lets each bar be ONE polygon.
//
// That last part is the real aliasing fix. Faking the gradient with five
// stacked wedges per bar meant four internal seams per bar, and antialiased
// polygons do not composite cleanly along a shared edge - each one blends with
// what is behind it, so the seam shows as a visible darker line. One wedge has
// no internal seams at all.
var IDENTITY_EDGE = function (t) { return t; };

function radialBarBrush(ramp, bucket) {
    if (!brushSupported) return null;
    var key = brushKeyFor(EDGE_ID_RADIAL, bucket);
    var cached = brushCache.get(key);
    if (cached !== undefined) return cached;

    var brush = null;
    try {
        brush = d2d.Brush(BRUSH_LINEAR_GRADIENT, [0, 0], [1, 0],
            rampStops(IDENTITY_EDGE, ramp, bucketAlpha(bucket), BRUSH_GRADIENT_STOPS),
            BRUSH_WRAP_CLAMP);
    } catch (e) {
        brushLog('Radial bar brush unavailable: ' + e);
        brushSupported = false;
        brush = null;
    }

    brushCache.set(key, brush);
    return brush;
}

// Maps the unit axis (0,0)->(1,0) onto a bar running outward from `inner` at
// angle `mid`. cd_spectrum_panel.js does this as ResetTransform + Scale +
// Rotate + Translate; folding it into one matrix makes it a single native
// call per bar instead of four.
function aimRadialBrush(brush, axisLength, cosMid, sinMid, centreX, centreY, inner) {
    if (!brush) return false;
    brushMatrix[0] = axisLength * cosMid;
    brushMatrix[1] = axisLength * sinMid;
    brushMatrix[2] = -sinMid;
    brushMatrix[3] = cosMid;
    brushMatrix[4] = centreX + cosMid * inner;
    brushMatrix[5] = centreY + sinMid * inner;
    try {
        brush.SetTransform(brushMatrix);
        return true;
    } catch (e) {
        brushLog('Radial brush SetTransform failed: ' + e);
        brushSupported = false;
        return false;
    }
}

// Maps the unit brush axis onto [top, top + height] in panel space. All six
// cells are written because aimRadialBrush shares this scratch matrix and
// leaves rotation terms in it.
function aimBrushAtSpan(brush, top, height) {
    if (!brush) return false;
    brushMatrix[0] = 1;
    brushMatrix[1] = 0;
    brushMatrix[2] = 0;
    brushMatrix[3] = Math.max(1, height);
    brushMatrix[4] = 0;
    brushMatrix[5] = top;
    try {
        brush.SetTransform(brushMatrix);
        return true;
    } catch (e) {
        brushLog('Brush SetTransform failed: ' + e);
        brushSupported = false;
        return false;
    }
}

function brushLog(message) {
    try { console.log('[RVG Spectrum D2D] ' + message); } catch (e) { }
}

// True when the live layer should be filled with a cached gradient brush at
// all. Ghost layers are flat by design and never take this path.
function useBrushes() {
    return settings.gradient && brushSupported;
}

// Drawing primitives

function fillRect(gr, x, y, w, h, colour) {
    if (w <= 0 || h <= 0) return;
    gr.FillSolidRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)),
        solidBrush(colour));
}

function fillGradientRect(gr, x, y, w, h, angle, stops) {
    if (w <= 0 || h <= 0) return;
    x = Math.round(x); y = Math.round(y);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));

    if (gradientSupported) {
        try {
            gr.FillGradRectV2(x, y, w, h, angle, stops);
            return;
        } catch (e) {
            // One-shot downgrade: older builds without FillGradRectV2 fall
            // back to flat fills for the rest of the session.
            gradientSupported = false;
        }
    }
    gr.FillSolidRect(x, y, w, h, stops[1]);
}

// Sub-pixel gradient fill, for the ribbon's column fallback. Same rationale as
// fillRoundRectFloat: callers snap the axis that tiles, and leave the axis that
// animates fractional.
function fillGradientRectFloat(gr, x, y, w, h, angle, stops) {
    if (!(w > 0) || !(h > 0)) return;

    if (gradientSupported) {
        try {
            gr.FillGradRectV2(x, y, w, h, angle, stops);
            return;
        } catch (e) {
            gradientSupported = false;
        }
    }
    gr.FillSolidRect(x, y, w, h, stops[1]);
}

// GDI+ rejects an arc larger than half the rectangle, and integer rounding of
// x/y/w/h can push a computed radius just over that line. Every rounded fill in
// this panel goes through here so the clamp happens after rounding, not before.
//
// STATIC GEOMETRY ONLY. Snapping to whole pixels is right for chrome that does
// not move, and wrong for anything animating - see fillRoundRectFloat below.
function fillRoundRectSafe(gr, x, y, w, h, radius, colour) {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));

    var r = Math.min(Number(radius) || 0, w / 2, h / 2);
    var fill = solidBrush(colour);
    if (!(r > 0.25)) {
        gr.FillSolidRect(x, y, w, h, fill);
        return;
    }
    gr.FillRoundRect(x, y, w, h, r, r, fill);
}

// Sub-pixel variant, for geometry that MOVES every frame.
//
// This panel is Direct2D only (window.DrawMode = 1, first line of the file), so
// the premise behind fillRoundRectSafe's rounding is a GDI+ leftover: D2D fills
// take a D2D1_RECT_F and antialias fractional edges natively. Rounding an
// animating bar's y/height to whole pixels quantises its motion - a bar moving
// less than one pixel per frame gets drawn at the SAME height for several
// frames and then jumps a whole pixel to catch up. The level maths underneath
// is perfectly smooth; the rasteriser is what stutters. With 64 bars all moving
// at different sub-pixel rates a different random subset snaps each frame,
// which reads as the whole spectrum shimmering rather than as a dropped frame.
//
// The mirrored view is worse still, because top edge and height round
// independently: with centreY = 100.5 and half growing 10.2 -> 10.8, the drawn
// rect goes (y=90,h=20), (90,21), (90,21), (90,22) - the top edge freezes for
// four frames while the bottom edge moves on three of them, so the capsule
// grows visibly asymmetrically about its own centre line.
//
// This is the same bug already fixed for the radial tip caps, which moved to
// FillEllipse with float coordinates because snapped caps "visibly crawled" as
// the ring rotated (see RIVAGE_SPECTRUM.md). Axis-aligned bars are not exempt -
// they were only assumed to be, because the assumption was made about a bar
// standing still rather than a bar animating.
//
// Callers still snap x/w: the bar grid is static horizontally and crisp
// vertical edges are worth keeping. Only y/h stay fractional.
function fillRoundRectFloat(gr, x, y, w, h, radius, colour) {
    if (!(w > 0) || !(h > 0)) return;

    var r = Math.min(Number(radius) || 0, w / 2, h / 2);
    var fill = solidBrush(colour);
    if (!(r > 0.25)) {
        gr.FillSolidRect(x, y, w, h, fill);
        return;
    }
    gr.FillRoundRect(x, y, w, h, r, r, fill);
}

// Sub-pixel plain fill, for peak markers and the ribbon envelope - both track a
// continuously moving level and suffer the same quantisation as the bars.
function fillRectFloat(gr, x, y, w, h, colour) {
    if (!(w > 0) || !(h > 0)) return;
    gr.FillSolidRect(x, y, w, h, solidBrush(colour));
}

function roundedRadiusFor(shortSide) {
    // 'none' is a hard rectangle; anything else is the full capsule. Callers
    // clamp the result to half the width and half the height.
    return settings.barRounding === 'none' ? 0 : shortSide;
}

// Builds a flat [position, colour, ...] stop list by sampling `ramp` across a
// sub-span of a bar. `edgeAt` maps 0..1 along the whole bar to a ramp edge.
function stopsForSpan(fullStart, fullLength, subStart, subLength, edgeAt, ramp, samples, alpha) {
    var stops = [];
    var i;
    for (i = 0; i < samples; i++) {
        var p = samples === 1 ? 0 : i / (samples - 1);
        var position = subStart + subLength * p;
        var u = fullLength > 0 ? (position - fullStart) / fullLength : 0;
        stops.push(p, ramp(edgeAt(u), alpha));
    }
    return stops;
}

// Map a 0..1 position along a bar to a ramp edge: 0 at the bar's origin
// (base or centre line), 1 at its far tip.
var EDGE_FROM_BOTTOM = function (u) { return 1 - u; };
var EDGE_FROM_CENTRE = function (u) { return Math.abs(u * 2 - 1); };

function aimBrushOnce(brush, brushKey, top, height) {
    var aim = Math.round(top) * 65536 + Math.round(height);
    if (brushAimState.get(brushKey) === aim) return true;
    if (!aimBrushAtSpan(brush, top, height)) return false;
    brushAimState.set(brushKey, aim);
    return true;
}

// Vertical capsule. In Direct2D this is a single FillRoundRect filled with a
// cached gradient brush, which also fixes a long-standing artefact: GDI+ could
// not gradient a rounded shape, so the two caps were flat-filled with one
// sampled colour each and the gradient visibly stepped at the cap seams.
//
// `spanTop` / `spanHeight` are the span the gradient's 0..1 range maps onto -
// the bar itself under 'element' scaling, the whole plot rect under 'panel'.
// The old stop-list path is kept as the fallback for when brushes are
// unavailable, and is still what `flat` ghost layers and the no-gradient case
// use.
function drawVerticalBar(gr, x, y, w, h, edgeAt, edgeId, ramp, alpha, flat, spanTop, spanHeight) {
    // x/w snap: the bar grid is static horizontally, so whole-pixel vertical
    // edges are free crispness. y/h stay fractional - they are what animates,
    // and rounding them is what made the bars stutter. See fillRoundRectFloat.
    x = Math.round(x);
    w = Math.max(1, Math.round(w));
    if (!(h > 0)) return;

    var radius = Math.min(roundedRadiusFor(w) / 1, h / 2);
    radius = Math.max(0, Math.min(radius, w / 2));
    var useGradient = settings.gradient && gradientSupported && !flat;

    if (flat) {
        // Quantise the ghost alpha to the same 33 buckets the gradient brushes
        // use. Ghost layers are flat fills whose alpha varies continuously with
        // the edge fade, so an aggressive config (192 bands x 12 trail layers)
        // could ask solidBrush() for ~516 distinct ARGB values in ONE frame -
        // more than D2D_SOLID_BRUSH_CACHE_LIMIT, so the cache wiped and rebuilt
        // itself several times per frame. Bucketing caps it at 33 per layer.
        // One step is ~8/255 of alpha, below the visible threshold.
        fillRoundRectFloat(gr, x, y, w, h, radius, ramp(0.35, bucketAlpha(alphaBucketFor(alpha))));
        return;
    }

    if (!useGradient) {
        fillRoundRectFloat(gr, x, y, w, h, radius, ramp(0, alpha));
        return;
    }

    // Fast path: one call, correct gradient through the rounded caps.
    if (brushSupported) {
        var bucket = alphaBucketFor(alpha);
        var brushKey = brushKeyFor(edgeId, bucket);
        var brush = linearRampBrush(edgeId, edgeAt, ramp, bucket);
        // The brush aim is still quantised to whole pixels by aimBrushOnce, so
        // the cache keeps working. A smooth gradient offset by under a pixel
        // from its capsule is invisible; a capsule offset by under a pixel from
        // where it should be is exactly the stutter being fixed here.
        if (brush && aimBrushOnce(brush, brushKey,
                spanTop === undefined ? y : spanTop,
                spanHeight === undefined ? h : spanHeight)) {
            try {
                fillRoundRectFloat(gr, x, y, w, h, radius, brush);
                return;
            } catch (e) {
                brushSupported = false;
            }
        }
    }

    // Legacy stop-list fallback for builds without brush support. The caps and
    // the gradient body have to tile exactly, so this path stays snapped -
    // sub-pixel seams between three separate fills would be worse than the
    // quantisation. It does not run on a build that supports brushes.
    if (radius < 0.5 || h <= radius * 2 + 1) {
        if (radius >= 0.5) {
            // Too short to split into caps plus body: use the mid colour.
            fillRoundRectFloat(gr, x, y, w, h, radius, ramp(edgeAt(0.5), alpha));
        } else {
            fillGradientRect(gr, x, y, w, h, 90,
                stopsForSpan(y, h, y, h, edgeAt, ramp, 5, alpha));
        }
        return;
    }

    var capSize = Math.round(radius * 2);
    var bodyY = y + radius;
    var bodyH = h - radius * 2;

    fillRoundRectSafe(gr, x, y, w, capSize, radius, ramp(edgeAt(radius / h), alpha));
    fillRoundRectSafe(gr, x, y + h - capSize, w, capSize, radius, ramp(edgeAt(1 - radius / h), alpha));
    fillGradientRect(gr, x, bodyY, w, bodyH, 90,
        stopsForSpan(y, h, bodyY, bodyH, edgeAt, ramp, 5, alpha));
}

// Layout and band ordering

var plotRect = { x: 0, y: 0, w: 0, h: 0 };
var headerRect = { x: 0, y: 0, w: 0, h: 0 };
var mouseX = -1;
var mouseY = -1;
var hoveredSlot = -1;

function computeLayout() {
    var pad = scale(settings.outerPadding);
    var x = pad;
    var y = pad;
    var w = Math.max(0, panelW - pad * 2);
    var h = Math.max(0, panelH - pad * 2);

    // Mutated in place rather than replaced. computeLayout() runs once per
    // paint, so three fresh object literals per frame is 5400 throwaway objects
    // a minute at 30fps for values that almost never change. Nothing retains
    // these rects across frames - every reader uses them within the same paint.
    headerRect.x = x;
    headerRect.y = y;
    headerRect.w = w;
    headerRect.h = 0;

    if (settings.showHeader && h > scale(40)) {
        var headerH = Math.max(scale(14), scale(16));
        headerRect.h = headerH;
        y += headerH + scale(4);
        h -= headerH + scale(4);
    }

    plotRect.x = x;
    plotRect.y = y;
    plotRect.w = w;
    plotRect.h = Math.max(0, h);
    return plotRect;
}

// Maps a display slot to a band index. This is what turns the analyser's
// low-to-high band array into the four supported spectrum arrangements.
function bandForSlot(slot, count) {
    switch (settings.spectrumOrder) {
    case 'low-right':
        return count - 1 - slot;
    case 'low-centre':
    case 'low-edges': {
        var centre = (count - 1) / 2;
        var minimumDistance = count % 2 === 0 ? 0.5 : 0;
        var span = Math.max(1, centre - minimumDistance);
        var distance = (Math.abs(slot - centre) - minimumDistance) / span;
        distance = Math.max(0, Math.min(1, distance));
        var band = Math.min(count - 1, Math.round(distance * (count - 1)));
        return settings.spectrumOrder === 'low-centre' ? band : count - 1 - band;
    }
    default:
        return slot;
    }
}

// Per-layer opacity for the ghost trail. Layer 1 is the newest afterimage.
function trailAlphaFor(layer) {
    var frames = settings.trailFrames;
    if (frames <= 0) return 0;
    var strength = settings.trailOpacity / 100;
    return strength * (frames - layer + 1) / (frames + 1);
}

function trailValueScale() {
    return settings.trailScale / 100;
}

function levelsForLayer(layer) {
    if (layer !== 0) return historyFrame(layer);

    var count = analyser.bandCount;
    var t = frameProgress();
    var live = analyser.liveLevel;
    var i, prev, now;

    for (i = 0; i < count; i++) {
        prev = analyser.prevLevel[i];
        now = analyser.level[i];
        live[i] = prev + (now - prev) * t;
    }
    return live;
}

// View: mirrored bars (the centre-line capsule spectrum)

function drawMirrorView(gr, r, ramp) {
    var count = analyser.bandCount;
    if (!count || r.w <= 0 || r.h <= 0) return;

    var slotW = r.w / count;
    var gap = scale(settings.barGap);
    var barW = Math.max(1, Math.floor(slotW - gap));
    var centreY = r.y + r.h / 2;
    var maxHalf = r.h / 2;
    var minHalf = Math.max(0.5, scale(settings.minBarSize) / 2);
    var panelScaled = settings.gradientScale === 'panel';
    var layer;

    for (layer = settings.trailFrames; layer >= 0; layer--) {
        var levels = levelsForLayer(layer);
        if (!levels) continue;

        var ghost = layer !== 0;
        var layerAlpha = ghost ? trailAlphaFor(layer) : 1;
        if (layerAlpha <= 0.004) continue;
        var valueScale = ghost ? trailValueScale() : 1;
        var slot;

        for (slot = 0; slot < count; slot++) {
            var band = bandForSlot(slot, count);
            var value = levels[band];
            // Ghosts skip near-silent bands entirely instead of drawing the
            // minimum-size stub the live layer uses.
            if (ghost && value < 0.012) continue;

            var half = ghost
                ? value * valueScale * maxHalf
                : Math.max(minHalf, value * maxHalf);
            if (half <= 0.5) continue;

            var alpha = layerAlpha * edgeFadeAt(slot, count);
            var x = r.x + slot * slotW + (slotW - barW) / 2;
            drawVerticalBar(gr, x, centreY - half, barW, half * 2,
                EDGE_FROM_CENTRE, EDGE_ID_CENTRE, ramp, alpha, ghost,
                panelScaled ? r.y : centreY - half,
                panelScaled ? r.h : half * 2);
        }
    }

    if (settings.showPeaks) drawMirrorPeaks(gr, r, ramp, slotW, barW, centreY, maxHalf, count);
}

function drawMirrorPeaks(gr, r, ramp, slotW, barW, centreY, maxHalf, count) {
    var thickness = scale(settings.peakThickness);
    var slot;
    for (slot = 0; slot < count; slot++) {
        var band = bandForSlot(slot, count);
        var offset = analyser.peak[band] * maxHalf;
        if (offset <= 0.5) continue;
        var colour = ramp(1, edgeFadeAt(slot, count));
        var x = Math.round(r.x + slot * slotW + (slotW - barW) / 2);
        // Float Y: the marker falls continuously under peak_fall, so snapping
        // it makes a slow decay descend in visible one-pixel lurches.
        fillRectFloat(gr, x, centreY - offset - thickness, barW, thickness, colour);
        fillRectFloat(gr, x, centreY + offset, barW, thickness, colour);
    }
}

// View: bars from bottom

function drawBarsView(gr, r, ramp) {
    var count = analyser.bandCount;
    if (!count || r.w <= 0 || r.h <= 0) return;

    var slotW = r.w / count;
    var gap = scale(settings.barGap);
    var barW = Math.max(1, Math.floor(slotW - gap));
    var baseY = r.y + r.h;
    var minH = Math.max(1, scale(settings.minBarSize));
    var panelScaled = settings.gradientScale === 'panel';
    var layer;

    for (layer = settings.trailFrames; layer >= 0; layer--) {
        var levels = levelsForLayer(layer);
        if (!levels) continue;

        var ghost = layer !== 0;
        var layerAlpha = ghost ? trailAlphaFor(layer) : 1;
        if (layerAlpha <= 0.004) continue;
        var valueScale = ghost ? trailValueScale() : 1;
        var slot;

        for (slot = 0; slot < count; slot++) {
            var band = bandForSlot(slot, count);
            var value = levels[band];
            if (ghost && value < 0.012) continue;

            var height = ghost
                ? value * valueScale * r.h
                : Math.max(minH, value * r.h);
            if (height <= 0.5) continue;

            var alpha = layerAlpha * edgeFadeAt(slot, count);
            var x = r.x + slot * slotW + (slotW - barW) / 2;
            drawVerticalBar(gr, x, baseY - height, barW, height,
                EDGE_FROM_BOTTOM, EDGE_ID_BOTTOM, ramp, alpha, ghost,
                panelScaled ? r.y : baseY - height,
                panelScaled ? r.h : height);
        }
    }

    if (settings.showPeaks) {
        var thickness = scale(settings.peakThickness);
        var s;
        for (s = 0; s < count; s++) {
            var b = bandForSlot(s, count);
            var peakY = baseY - analyser.peak[b] * r.h;
            if (peakY >= baseY - 1) continue;
            fillRectFloat(gr, Math.round(r.x + s * slotW + (slotW - barW) / 2),
                peakY - thickness, Math.max(1, Math.round(barW)), thickness,
                ramp(1, edgeFadeAt(s, count)));
        }
    }
}

// View: mirrored ribbon (smooth filled envelope)

// Cosine-interpolated band value at a fractional slot position.
function interpolatedLevel(levels, position, count) {
    if (position <= 0) return levels[bandForSlot(0, count)];
    if (position >= count - 1) return levels[bandForSlot(count - 1, count)];
    var lower = Math.floor(position);
    var t = position - lower;
    var a = levels[bandForSlot(lower, count)];
    var b = levels[bandForSlot(lower + 1, count)];
    var smooth = (1 - Math.cos(t * Math.PI)) / 2;
    return a + (b - a) * smooth;
}

var ribbonLivePointBuffer = [];
var ribbonGhostPointBuffer = [];
var ribbonEdgeFadeLeftStops = [];
var ribbonEdgeFadeRightStops = [];
var ribbonEdgeFadeAim = '';

function ribbonPolygon(levels, r, valueScale, count, steps, points) {
    // FillPolygon consumes the points synchronously. Keep separate reusable
    // buffers for ghost and live resolutions so neither has to resize on every
    // paint.
    points = points || ribbonLivePointBuffer;
    var required = (steps + 1) * 4;
    if (points.length !== required) points.length = required;

    var centreY = r.y + r.h / 2;
    var maxHalf = r.h / 2;
    var write = 0;
    var i;

    for (i = 0; i <= steps; i++) {
        var t = i / steps;
        var value = interpolatedLevel(levels, t * (count - 1), count) * valueScale;
        points[write++] = r.x + t * r.w;
        points[write++] = centreY - Math.max(0.5, value * maxHalf);
    }
    for (i = steps; i >= 0; i--) {
        var t2 = i / steps;
        var value2 = interpolatedLevel(levels, t2 * (count - 1), count) * valueScale;
        points[write++] = r.x + t2 * r.w;
        points[write++] = centreY + Math.max(0.5, value2 * maxHalf);
    }
    return points;
}

// A single-brush ribbon has one alpha for the whole shape, so the per-band
// edge fade has to come back some other way. Painting the background colour
// back over the ends with the same smoothstep profile is exactly equivalent -
// compositing the ribbon at alpha `a` over an opaque background gives the same
// pixels as drawing it opaque and then the background at `1 - a` - and it
// costs two rects instead of reintroducing per-column alpha.
function drawRibbonEdgeFade(gr, r) {
    // Without a real gradient fillGradientRect degrades to a solid fill, which
    // here would paint an opaque block over the end of the ribbon rather than
    // fading it. Better to show no fade than that.
    if (!settings.edgeFade || !gradientSupported) return;

    var spanW = Math.max(1, Math.round(r.w * settings.edgeFadeAmount / 100));
    if (spanW < 2) return;

    var background = backgroundColour();
    var samples = 9;
    var aim = String(background) + '|' + samples;
    var i;

    if (ribbonEdgeFadeAim !== aim) {
        ribbonEdgeFadeAim = aim;
        ribbonEdgeFadeLeftStops.length = samples * 2;
        ribbonEdgeFadeRightStops.length = samples * 2;
        var write = 0;

        // `cover` at distance t from the panel edge mirrors edgeFadeAt: a
        // smoothstep floored at 0.10, so the outermost bands stay faintly
        // visible instead of vanishing completely.
        for (i = 0; i < samples; i++) {
            var position = i / (samples - 1);
            var leftT = position;
            var rightT = 1 - position;
            ribbonEdgeFadeLeftStops[write] = position;
            ribbonEdgeFadeRightStops[write++] = position;
            ribbonEdgeFadeLeftStops[write] = RivageUI.withAlpha(background,
                255 * 0.90 * (1 - leftT * leftT * (3 - 2 * leftT)));
            ribbonEdgeFadeRightStops[write++] = RivageUI.withAlpha(background,
                255 * 0.90 * (1 - rightT * rightT * (3 - 2 * rightT)));
        }
    }

    fillGradientRect(gr, r.x, r.y, spanW, r.h, 0, ribbonEdgeFadeLeftStops);
    fillGradientRect(gr, r.x + r.w - spanW, r.y, spanW, r.h, 0, ribbonEdgeFadeRightStops);
}

function drawAreaView(gr, r, ramp) {
    var count = analyser.bandCount;
    if (!count || r.w <= 0 || r.h <= 0) return;

    var steps = Math.max(8, Math.min(320, Math.round(r.w / Math.max(1, scale(2)))));
    var layer;

    // Ghost layers are flat polygons - far cheaper than per-column gradients
    // and visually indistinguishable once they are this transparent.
    for (layer = settings.trailFrames; layer >= 1; layer--) {
        var levels = levelsForLayer(layer);
        if (!levels) continue;
        var layerAlpha = trailAlphaFor(layer);
        if (layerAlpha <= 0.004) continue;
        try {
            gr.FillPolygon(ramp(0.35, layerAlpha), 0,
                ribbonPolygon(levels, r, trailValueScale(), count, Math.min(steps, 96), ribbonGhostPointBuffer));
        } catch (e) { reportFailure('a ghost trail layer could not be drawn', e); }
    }

    // The whole reason 'panel' gradient scaling exists. Per-column scaling
    // makes the ribbon's colour a function of both x and y, which no single
    // brush can express, so it has to be sliced into one gradient call per
    // 2px column. Pinned to the plot rect it is one brush, one polygon, one
    // call - plus two overlay rects if edge fade is on.
    if (settings.gradientScale === 'panel' && useBrushes()) {
        var ribbonBucket = alphaBucketFor(1);
        var ribbonBrush = linearRampBrush(EDGE_ID_CENTRE, EDGE_FROM_CENTRE, ramp, ribbonBucket);
        if (ribbonBrush && aimBrushOnce(ribbonBrush, brushKeyFor(EDGE_ID_CENTRE, ribbonBucket), r.y, r.h)) {
            try {
                gr.FillPolygon(ribbonBrush, 0,
                    ribbonPolygon(analyser.level, r, 1, count, steps, ribbonLivePointBuffer));
                drawRibbonEdgeFade(gr, r);
                return;
            } catch (e) {
                brushLog('Ribbon FillPolygon with brush failed: ' + e);
                brushSupported = false;
            }
        }
    }

    var centreY = r.y + r.h / 2;
    var maxHalf = r.h / 2;
    var columnW = Math.max(1, scale(2));
    var columns = Math.max(2, Math.ceil(r.w / columnW));
    var i;

    for (i = 0; i < columns; i++) {
        var t = i / (columns - 1);
        var value = interpolatedLevel(analyser.level, t * (count - 1), count);
        var half = Math.max(0.5, value * maxHalf);
        var alpha = edgeFadeAt(Math.round(t * (count - 1)), count);
        var x = r.x + i * columnW;
        var w = Math.min(columnW, r.x + r.w - x);
        if (w <= 0) break;

        // x/w stay snapped so neighbouring columns tile exactly - antialiased
        // fills sharing a fractional edge leave a visible seam. y/h are float
        // for the same reason the bars are: the envelope moves continuously.
        var colX = Math.round(x);
        var colW = Math.max(1, Math.round(w));

        if (settings.gradient && gradientSupported) {
            fillGradientRectFloat(gr, colX, centreY - half, colW, half * 2, 90,
                stopsForSpan(centreY - half, half * 2, centreY - half, half * 2,
                    EDGE_FROM_CENTRE, ramp, 5, alpha));
        } else {
            fillRectFloat(gr, colX, centreY - half, colW, half * 2, ramp(0, alpha));
        }
    }
}

// View: radial spectrum

// Reused across bars to keep this off the allocator in a per-frame loop.
var radialWedgeBuffer = [];

function radialArcStepsFor(slotAngleDegrees) {
    return Math.max(1, Math.min(8, Math.ceil(Math.abs(slotAngleDegrees) / 6)));
}

function radialWedgePoints(centreX, centreY, a0, a1, innerR, outerR, steps) {
    var sweep = a1 - a0;
    var n = 0;
    var i, angle, cos, sin;

    for (i = 0; i <= steps; i++) {
        angle = a0 + sweep * (i / steps);
        cos = Math.cos(angle); sin = Math.sin(angle);
        radialWedgeBuffer[n++] = centreX + cos * outerR;
        radialWedgeBuffer[n++] = centreY + sin * outerR;
    }
    for (i = steps; i >= 0; i--) {
        angle = a0 + sweep * (i / steps);
        cos = Math.cos(angle); sin = Math.sin(angle);
        radialWedgeBuffer[n++] = centreX + cos * innerR;
        radialWedgeBuffer[n++] = centreY + sin * innerR;
    }

    radialWedgeBuffer.length = n;
    return radialWedgeBuffer;
}

// Builds the rounded outer end into the polygon itself, so the radial bar is
// filled as one shape instead of a wedge with a separate ellipse on its tip.
function radialRoundedWedgePoints(centreX, centreY, a0, a1, innerR, outerR, innerSteps, capSteps) {
    var mid = (a0 + a1) / 2;
    var halfAngle = Math.abs(a1 - a0) / 2;
    var length = outerR - innerR;

    if (halfAngle <= 0.00001 || length <= 0.5) {
        return radialWedgePoints(centreX, centreY, a0, a1, innerR, outerR, innerSteps);
    }

    var sinHalf = Math.sin(halfAngle);
    var cosHalf = Math.cos(halfAngle);
    if (sinHalf <= 0.00001 || cosHalf <= 0.00001) {
        return radialWedgePoints(centreX, centreY, a0, a1, innerR, outerR, innerSteps);
    }

    var capCentreR = outerR / (1 + sinHalf);
    var capRadius = capCentreR * sinHalf;
    var tangentR = capCentreR * cosHalf;
    var ux = Math.cos(mid);
    var uy = Math.sin(mid);
    var vx = -uy;
    var vy = ux;
    var n = 0;
    var i;

    capSteps = Math.max(6, Math.min(18, Math.round(capSteps || 12)));
    innerSteps = Math.max(1, Math.round(innerSteps || 1));

    if (tangentR > innerR + 0.25) {
        var capStart = -Math.PI / 2 - halfAngle;
        var capSweep = Math.PI + halfAngle * 2;

        for (i = 0; i <= capSteps; i++) {
            var phi = capStart + capSweep * (i / capSteps);
            var localX = capCentreR + capRadius * Math.cos(phi);
            var localY = capRadius * Math.sin(phi);
            radialWedgeBuffer[n++] = centreX + ux * localX + vx * localY;
            radialWedgeBuffer[n++] = centreY + uy * localX + vy * localY;
        }
    } else {
        var joinX = innerR * cosHalf;
        var halfWidth = innerR * sinHalf;
        var capDepth = Math.max(0.5, outerR - joinX);

        for (i = 0; i <= capSteps; i++) {
            var shortPhi = -Math.PI / 2 + Math.PI * (i / capSteps);
            var shortX = joinX + capDepth * Math.cos(shortPhi);
            var shortY = halfWidth * Math.sin(shortPhi);
            radialWedgeBuffer[n++] = centreX + ux * shortX + vx * shortY;
            radialWedgeBuffer[n++] = centreY + uy * shortX + vy * shortY;
        }
    }

    for (i = innerSteps; i >= 0; i--) {
        var angle = a0 + (a1 - a0) * (i / innerSteps);
        radialWedgeBuffer[n++] = centreX + Math.cos(angle) * innerR;
        radialWedgeBuffer[n++] = centreY + Math.sin(angle) * innerR;
    }

    radialWedgeBuffer.length = n;
    return radialWedgeBuffer;
}

function radialBarPoints(centreX, centreY, a0, a1, innerR, outerR, arcSteps) {
    if (settings.barRounding === 'none') {
        return radialWedgePoints(centreX, centreY, a0, a1, innerR, outerR, arcSteps);
    }
    return radialRoundedWedgePoints(centreX, centreY, a0, a1, innerR, outerR, arcSteps, 12);
}

function drawRadialView(gr, r, ramp) {
    var count = analyser.bandCount;
    if (!count || r.w <= 0 || r.h <= 0) return;

    var centreX = r.x + r.w / 2;
    var centreY = r.y + r.h / 2;
    var outerLimit = Math.min(r.w, r.h) / 2;
    var inner = outerLimit * (settings.radialInner / 100);
    var span = Math.max(2, outerLimit - inner);
    var sweep = settings.radialSpread;
    // At a full circle the first and last bands are neighbours, so the edge
    // taper would cut a dark wedge through the seam rather than fade an end.
    var closedRing = sweep >= 359;
    var startAngle = -90 - sweep / 2 + (settings.radialRotate ? liveRotationPhase() : 0);
    var slotAngle = sweep / count;
    var gapAngle = Math.min(slotAngle * 0.45, slotAngle * (scale(settings.barGap) / 12));
    var segments = (settings.gradient && gradientSupported) ? 5 : 1;
    var radians = Math.PI / 180;
    var maxGhosts = Math.min(settings.trailFrames, 3);
    var panelScaled = settings.gradientScale === 'panel';
    var arcSteps = radialArcStepsFor(slotAngle);
    var layer;

    for (layer = maxGhosts; layer >= 0; layer--) {
        var levels = levelsForLayer(layer);
        if (!levels) continue;
        var layerAlpha = layer === 0 ? 1 : trailAlphaFor(layer);
        if (layerAlpha <= 0.004) continue;
        var valueScale = layer === 0 ? 1 : trailValueScale();
        var layerSegments = layer === 0 ? segments : 1;
        var slot;

        for (slot = 0; slot < count; slot++) {
            var band = bandForSlot(slot, count);
            if (layer !== 0 && levels[band] < 0.012) continue;
            var value = levels[band] * valueScale;
            var length = layer === 0
                ? Math.max(scale(settings.minBarSize), value * span)
                : value * span;
            if (length <= 0.5) continue;

            var a0 = (startAngle + slot * slotAngle + gapAngle / 2) * radians;
            var a1 = (startAngle + (slot + 1) * slotAngle - gapAngle / 2) * radians;
            var alpha = layerAlpha * (closedRing ? 1 : edgeFadeAt(slot, count));
            var tipRadius = inner + length;
            var seg;

            // One polygon, gradient supplied by a brush laid along the bar.
            var wedgeBrush = (layer === 0 && useBrushes())
                ? radialBarBrush(ramp, alphaBucketFor(alpha))
                : null;

            if (wedgeBrush) {
                var midAngle = (a0 + a1) / 2;
                if (aimRadialBrush(wedgeBrush, panelScaled ? span : length,
                        Math.cos(midAngle), Math.sin(midAngle), centreX, centreY, inner)) {
                    try {
                        gr.FillPolygon(wedgeBrush, 0,
                            radialBarPoints(centreX, centreY, a0, a1, inner, tipRadius, arcSteps));
                    } catch (e) {
                        brushSupported = false;
                        wedgeBrush = null;
                    }
                } else {
                    wedgeBrush = null;
                }
            }

            if (!wedgeBrush) {
                // Fallback only: stacked wedges fake the gradient if brushes
                // are unavailable. The final segment owns the rounded tip.
                for (seg = 0; seg < layerSegments; seg++) {
                    var t0 = seg / layerSegments;
                    var t1 = (seg + 1) / layerSegments;
                    var rA = inner + length * t0;
                    var rB = inner + length * t1 + (seg < layerSegments - 1 ? 0.5 : 0);
                    var colour = ramp((t0 + t1) / 2, alpha);
                    var finalSegment = seg === layerSegments - 1;
                    var points = settings.barRounding !== 'none' && finalSegment
                        ? radialRoundedWedgePoints(centreX, centreY, a0, a1, rA, tipRadius, arcSteps, 12)
                        : radialWedgePoints(centreX, centreY, a0, a1, rA, rB, arcSteps);
                    try {
                        gr.FillPolygon(solidBrush(colour), 0, points);
                    } catch (e) { reportFailure('a radial bar segment could not be drawn', e); }
                }
            }
        }
    }
}

// CD art is loaded lazily from radial paints. Bitmap brushes provide the
// circular fast path; DrawImage remains the same-frame fallback when a brush
// fails. Request generations discard stale async completions, while transient
// lookup failures retry after a short backoff instead of becoming permanent.

var CD_WORKING_SIZE = 480;
var CD_RIM_ALPHA = 130;
var CD_HOLE_RATIO = 0.10;
var HIGH_QUALITY_INTERPOLATION = 2;

var cdImage = null;
var cdBrush = null;
var cdBrushAim = '';
var cdArtRequestId = 0;
var cdArtPendingKey = null;
var cdArtSettledKey = null;
var cdArtFailedKey = null;
var cdArtRetryAfter = 0;
var cdRotationPhase = 0;
var scriptUnloaded = false;
var CD_ART_RETRY_DELAY_MS = 2000;

function processLoadedArt(rawImage) {
    try {
        return rawImage.Resize(CD_WORKING_SIZE, CD_WORKING_SIZE, HIGH_QUALITY_INTERPOLATION);
    } catch (e) {
        return rawImage;
    }
}

function rebuildCdBrush() {
    cdBrush = null;
    cdBrushAim = '';
    if (!cdImage) return;
    try {
        cdBrush = d2d.Brush(BRUSH_BITMAP, cdImage, BRUSH_WRAP_CLAMP);
    } catch (e) {
        cdBrush = null;
    }
}

function aimCdBrush(x, y, diameter) {
    if (!cdBrush || !cdImage) return false;
    var aim = Math.round(x) + '|' + Math.round(y) + '|' + Math.round(diameter);
    if (cdBrushAim === aim) return true;

    var sx = diameter / Math.max(1, cdImage.Width);
    var sy = diameter / Math.max(1, cdImage.Height);
    try {
        cdBrush.SetTransform(new Float32Array([sx, 0, 0, sy, x, y]));
        cdBrushAim = aim;
        return true;
    } catch (e) {
        cdBrush = null;
        return false;
    }
}

function safeGetNowPlaying() {
    try { return fb.GetNowPlaying(); } catch (e) { return null; }
}

function trackKeyFor(metadb) {
    if (!metadb) return null;
    try { return metadb.RawPath + '|' + metadb.SubSong; } catch (e) { return null; }
}

var ALBUM_ART_ID = { front: 0, back: 1, disc: 2, icon: 3, artist: 4 };

async function fetchAlbumArtImage(metadb, artId) {
    try {
        var result = await utils.GetAlbumArtAsyncV2(window.ID, metadb, artId, false, false);
        return { image: result && result.image ? result.image : null, failed: false };
    } catch (e) {
        return { image: null, failed: true };
    }
}

function cdArtRequestIsCurrent(requestId) {
    return !scriptUnloaded && requestId === cdArtRequestId;
}

function loadCdArtFor(metadb, key) {
    var requestId = ++cdArtRequestId;
    cdArtPendingKey = key;

    if (!metadb) {
        cdArtPendingKey = null;
        cdArtSettledKey = null;
        cdArtFailedKey = null;
        cdImage = null;
        rebuildCdBrush();
        repaintIfVisible();
        return;
    }

    (async function () {
        var lookup = await fetchAlbumArtImage(metadb, ALBUM_ART_ID.disc);
        if (!cdArtRequestIsCurrent(requestId)) return;

        var image = lookup.image;
        var lookupFailed = lookup.failed;
        if (!image) {
            lookup = await fetchAlbumArtImage(metadb, ALBUM_ART_ID.front);
            if (!cdArtRequestIsCurrent(requestId)) return;
            image = lookup.image;
            lookupFailed = lookupFailed || lookup.failed;
        }

        cdArtPendingKey = null;
        if (image) {
            cdImage = processLoadedArt(image);
            rebuildCdBrush();
            cdArtSettledKey = key;
            cdArtFailedKey = null;
            cdArtRetryAfter = 0;
        } else if (lookupFailed) {
            cdArtFailedKey = key;
            cdArtRetryAfter = Date.now() + CD_ART_RETRY_DELAY_MS;
        } else {
            cdImage = null;
            rebuildCdBrush();
            cdArtSettledKey = key;
            cdArtFailedKey = null;
            cdArtRetryAfter = 0;
        }
        repaintIfVisible();
    })();
}

function invalidateCdArt(handleList) {
    var metadb = safeGetNowPlaying();
    if (!metadb) return;
    if (handleList && typeof handleList.Find === 'function') {
        try {
            if (handleList.Find(metadb) < 0) return;
        } catch (e) { }
    }
    cdArtRequestId++;
    cdArtPendingKey = null;
    cdArtSettledKey = null;
    cdArtFailedKey = null;
    cdArtRetryAfter = 0;
    if (settings.view === 'radial' && settings.showCdArt) repaintIfVisible();
}

function ensureCdArtCurrent() {
    var metadb = safeGetNowPlaying();
    var key = trackKeyFor(metadb);
    if (key === cdArtSettledKey || key === cdArtPendingKey) return;
    if (key === cdArtFailedKey && Date.now() < cdArtRetryAfter) return;
    loadCdArtFor(metadb, key);
}

function drawCdArt(gr, centreX, centreY, inner) {
    if (!settings.showCdArt || inner <= 1) return;

    var diameter = Math.max(2, inner * 2 * (settings.cdSize / 100));
    var radius = diameter / 2;
    var x = centreX - radius;
    var y = centreY - radius;
    var artDrawn = false;
    var pushed = false;

    if (cdImage && cdBrush && aimCdBrush(x, y, diameter)) {
        try {
            if (settings.cdSpin) {
                gr.PushTransform();
                pushed = true;
                gr.Rotate(liveCdRotationPhase(), centreX, centreY);
            }
            gr.FillEllipse(x, y, diameter, diameter, cdBrush);
            artDrawn = true;
        } catch (e) {
            cdBrush = null;
        } finally {
            if (pushed) {
                try { gr.PopTransform(); } catch (e2) { }
                pushed = false;
            }
        }
    }

    if (cdImage && !artDrawn) {
        try {
            if (settings.cdSpin) {
                gr.PushTransform();
                pushed = true;
                gr.Rotate(liveCdRotationPhase(), centreX, centreY);
            }
            gr.DrawImage(cdImage, x, y, diameter, diameter, 0, 0, cdImage.Width, cdImage.Height);
            artDrawn = true;
        } catch (e3) {
            reportFailure('the CD art image could not be drawn', e3);
        } finally {
            if (pushed) {
                try { gr.PopTransform(); } catch (e4) { }
                pushed = false;
            }
        }
    }

    if (!artDrawn) {
        try {
            gr.FillEllipse(x, y, diameter, diameter, solidBrush(theme.card));
        } catch (e5) { reportFailure('the CD art placeholder disc could not be drawn', e5); }
    }

    try {
        gr.DrawEllipse(x, y, diameter, diameter, Math.max(1, scale(1)), RivageUI.withAlpha(theme.textPrimary, CD_RIM_ALPHA));
    } catch (e6) { reportFailure('the CD art rim could not be drawn', e6); }

    var holeD = Math.max(2, diameter * CD_HOLE_RATIO);
    try {
        gr.FillEllipse(centreX - holeD / 2, centreY - holeD / 2, holeD, holeD,
            solidBrush(backgroundColour()));
    } catch (e7) { reportFailure('the CD art centre hole could not be drawn', e7); }
    try {
        gr.DrawEllipse(centreX - holeD / 2, centreY - holeD / 2, holeD, holeD,
            Math.max(1, scale(1)), RivageUI.withAlpha(theme.textPrimary, CD_RIM_ALPHA));
    } catch (e8) { reportFailure('the CD art centre-hole rim could not be drawn', e8); }
}

// Header, frame and hover tooltip

function currentViewLabel() {
    var i;
    for (i = 0; i < VIEW_CHOICES.length; i++) {
        if (VIEW_CHOICES[i].value === settings.view) return VIEW_CHOICES[i].label;
    }
    return 'Spectrum';
}

function drawHeader(gr, r) {
    if (!settings.showHeader || r.h <= 0) return;

    var accent = baseColour();
    var label = 'SPECTRUM';
    var width = textWidth(gr, label, titleFont);

    drawText(gr, label, titleFont, theme.textPrimary, r.x, r.y, Math.max(1, r.w), r.h,
        RivageUI.textFlags.leftCenteredEllipsis);

    var lineX = r.x + width + scale(8);
    var lineW = Math.max(0, r.w - width - scale(8) - scale(70));
    if (lineW > scale(8)) {
        fillRect(gr, lineX, r.y + r.h / 2, lineW, Math.max(1, scale(1)),
            RivageUI.withAlpha(accent, 90));
    }

    drawText(gr, currentViewLabel(), metaFont, theme.textMuted, r.x, r.y, Math.max(1, r.w), r.h,
        RivageUI.textFlags.right);
}

function drawFrame(gr, r) {
    if (!settings.showFrame || r.w <= 0 || r.h <= 0) return;
    painter.drawRoundRect(gr, RivageUI.rect(r.x, r.y, r.w, r.h),
        settings.cornerRadius, 1, theme.stroke);
}

function formatHz(hz) {
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
    return Math.round(hz) + ' Hz';
}

function slotAtPoint(x, y) {
    if (!analyser.bandCount) return -1;
    if (x < plotRect.x || x > plotRect.x + plotRect.w) return -1;
    if (y < plotRect.y || y > plotRect.y + plotRect.h) return -1;
    if (settings.view === 'radial') return -1;

    var slot = Math.floor((x - plotRect.x) / plotRect.w * analyser.bandCount);
    return Math.max(0, Math.min(analyser.bandCount - 1, slot));
}

function refreshHoverFromPointer() {
    var next = mouseX >= 0 && mouseY >= 0 ? slotAtPoint(mouseX, mouseY) : -1;
    var changed = next !== hoveredSlot;
    hoveredSlot = next;
    return changed;
}

function drawHoverTooltip(gr) {
    if (!settings.hoverTooltip || hoveredSlot < 0) return;
    if (!analyser.bandCount || mouseX < 0) return;

    var band = bandForSlot(hoveredSlot, analyser.bandCount);
    var loHz = bandEdgeHz(band, analyser.bandCount);
    var hiHz = bandEdgeHz(band + 1, analyser.bandCount);
    var normalised = analyser.level[band];
    var db = settings.floorDb + normalised * (settings.ceilingDb - settings.floorDb);
    var lines = [
        formatHz(loHz) + ' - ' + formatHz(hiHz),
        (normalised > 0.001 ? db.toFixed(1) : String(settings.floorDb)) + ' dB',
        'Band ' + (band + 1) + ' of ' + analyser.bandCount
    ];

    drawTooltip(gr, lines, tooltipFont, mouseX, mouseY);
}

// Local copy of painter.tooltip. The shared one is identical except that it
// draws its text with GdiDrawText, which D2DGraphics does not have; the box
// itself still goes through painter.fillRoundRect / drawRoundRect, which work
// unchanged in both modes. Geometry and defaults are kept in step with
// design_system.js so the tooltip looks the same as every other panel's.
function drawTooltip(gr, lines, font, pointerX, pointerY) {
    if (!lines || !lines.length || !font || panelW <= 0 || panelH <= 0) return;

    var lineHeight = Math.max(12, scale(13));
    var padX = scale(9);
    var padY = scale(6);
    var margin = scale(4);
    var offset = scale(12);
    var minimumWidth = scale(120);
    var maximumWidth = Math.max(scale(40), panelW - margin * 2);
    var maxTextWidth = 0;
    var i;

    for (i = 0; i < lines.length; i++) {
        maxTextWidth = Math.max(maxTextWidth, textWidth(gr, lines[i], font));
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
        drawText(gr, lines[i], font, theme.tooltipText,
            x + padX, y + padY + i * lineHeight,
            Math.max(1, boxWidth - padX * 2), lineHeight,
            RivageUI.textFlags.leftCenteredEllipsis);
    }
}

function drawIdleMessage(gr, r) {
    if (fb.IsPlaying) return;
    drawText(gr, 'No playback', metaFont, theme.textTertiary,
        r.x, r.y, Math.max(1, r.w), Math.max(1, r.h), RivageUI.textFlags.centered);
}

// Callbacks

function on_paint(gr) {
    // A hidden JSplitter child receives no paints, so reaching on_paint is the
    // reliable signal that a suspended panel became visible again.
    resumeMeterForVisibility();

    panelW = window.Width;
    panelH = window.Height;
    if (panelW <= 0 || panelH <= 0) return;

    // THE aliasing fix. This panel was the only RVG panel that never set a
    // smoothing mode, so it inherited the default - which is aliased - and
    // every diagonal edge rendered with hard stair-steps. It is worst in the
    // radial view, where essentially every edge is diagonal. cd_spectrum_panel.js,
    // topbar_panel.js, settings_panel.js and the rest all do this already.
    if (typeof gr.SetSmoothingMode === 'function') {
        try { gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS); } catch (e) { }
    }

    // One string compare per paint, not per bar: drops every baked brush if
    // the accent, gradient style or depth changed since the last frame.
    invalidateBrushesIfStale();

    var background = backgroundColour();
    if (settings.cornerRadius > 0 && settings.background !== 'panel') {
        gr.FillSolidRect(0, 0, panelW, panelH, theme.background);
        painter.fillRoundRect(gr, RivageUI.rect(0, 0, panelW, panelH),
            settings.cornerRadius, background);
    } else {
        gr.FillSolidRect(0, 0, panelW, panelH, background);
    }

    var r = computeLayout();
    refreshHoverFromPointer();
    drawHeader(gr, headerRect);

    if (r.w <= 0 || r.h <= 0) return;

    var ramp = cachedRamp || (cachedRamp = makeRamp(baseColour()));
    switch (settings.view) {
    case 'bars': drawBarsView(gr, r, ramp); break;
    case 'area': drawAreaView(gr, r, ramp); break;
    case 'radial':
        drawRadialView(gr, r, ramp);
        if (settings.showCdArt) {
            ensureCdArtCurrent();
            var radialOuterLimit = Math.min(r.w, r.h) / 2;
            drawCdArt(gr, r.x + r.w / 2, r.y + r.h / 2, radialOuterLimit * (settings.radialInner / 100));
        }
        break;
    default: drawMirrorView(gr, r, ramp); break;
    }

    drawFrame(gr, r);
    if (!analyser.active && !fb.IsPlaying) drawIdleMessage(gr, r);
    drawHoverTooltip(gr);
}

function on_size() {
    panelW = window.Width;
    panelH = window.Height;
    computeLayout();
    refreshHoverFromPointer();
    // Radial brushes are baked in panel coordinates and every aim key is a
    // panel-space span, so both go stale the moment the panel is resized.
    dropBrushCache();
}

function on_mouse_move(x, y) {
    var prevX = mouseX;
    var prevY = mouseY;
    mouseX = x;
    mouseY = y;

    if (refreshHoverFromPointer()) {
        repaintIfVisible();
        return;
    }

    if (!settings.hoverTooltip || hoveredSlot < 0) return;
    if (Math.abs(x - prevX) < 1 && Math.abs(y - prevY) < 1) return;
    repaintIfVisible();
}

function on_mouse_leave() {
    mouseX = -1;
    mouseY = -1;
    if (hoveredSlot !== -1) {
        hoveredSlot = -1;
        repaintIfVisible();
    }
}

function on_mouse_lbtn_up(x, y) {
    if (!settings.clickCyclesView) return false;
    cycleView(1);
    return true;
}

function on_mouse_wheel(delta) {
    // Wheel over the panel steps the band count, which is the setting people
    // reach for most while a track is playing.
    var index = 0;
    var i;
    for (i = 0; i < BAR_COUNT_CHOICES.length; i++) {
        if (BAR_COUNT_CHOICES[i].value === settings.barCount) index = i;
    }
    index = Math.max(0, Math.min(BAR_COUNT_CHOICES.length - 1, index + (delta > 0 ? 1 : -1)));
    applyMySetting('barCount', BAR_COUNT_CHOICES[index].value);
    return true;
}

function on_mouse_mbtn_up() {
    clearLevels();
    repaintIfVisible();
    return true;
}

function on_mouse_rbtn_up(x, y) {
    return showContextMenu(x, y);
}

function cycleView(step) {
    var index = 0;
    var i;
    for (i = 0; i < VIEW_CHOICES.length; i++) {
        if (VIEW_CHOICES[i].value === settings.view) index = i;
    }
    index = (index + step + VIEW_CHOICES.length) % VIEW_CHOICES.length;
    applyMySetting('view', VIEW_CHOICES[index].value);
}

function on_playback_new_track() {
    playbackPaused = !!fb.IsPaused;
    invalidateCdArt(null);
    stopTimer();
    startEngineIfRunnable();
}

function on_playback_pause(state) {
    playbackPaused = !!state;
    if (!playbackPaused) {
        startEngineIfRunnable();
    } else if (!isVisible() || suspendedForVisibility || !engineRunning) {
        stopTimer();
        clearLevels();
    } else if (!settings.idleFade) {
        stopTimer();
    }
    repaintIfVisible();
}

function on_playback_stop(reason) {
    playbackPaused = false;
    if (reason === 2) {
        idleFrames = 0;
        return;
    }

    var hidden = !isVisible();
    suspendedForVisibility = hidden;
    idleFrames = 0;
    if (!settings.idleFade || hidden || !engineRunning) {
        stopTimer();
        clearLevels();
    }
    repaintIfVisible();
}

function on_metadb_changed(handleList) {
    invalidateCdArt(handleList);
}

function on_playback_dynamic_info_track() {
    invalidateCdArt(null);
}

function on_colours_changed() {
    refreshVisualResources(false);
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
        if (settings.colourMode === 'album') {
            refreshVisualResources(false);
            window.Repaint();
        }
    }
}

function on_script_unload() {
    scriptUnloaded = true;
    cdArtRequestId++;
    cdArtPendingKey = null;
    cdArtSettledKey = null;
    cdArtFailedKey = null;
    cdImage = null;
    cdBrush = null;
    cdBrushAim = '';
    stopTimer();
}

// Shared SETTINGS panel schema

// Every entry in the settings sidebar comes from a script that answered the
// schema broadcast a moment ago - the registry clears its collected map before
// each request, so nothing there is cached. An entry for a panel that looks
// gone therefore means a live window still owns this script. This row says
// which window that is, so a stray instance can be told apart from the ones
// actually on screen: a leftover in a hidden branch reports "hidden", and a
// copy held open by a layout preview reports a window id that no visible panel
// has.
function describePanelWindow() {
    var parts = [];
    var name;

    try {
        name = String(window.Name || '').trim();
        if (name) parts.push('"' + name + '"');
    } catch (e) {
        // Panel name is unavailable in this host.
    }

    try {
        if (isFinite(Number(window.ID))) parts.push('#' + window.ID);
    } catch (e2) {
        // Window handle is unavailable.
    }

    try {
        if (isFinite(Number(window.Width)) && isFinite(Number(window.Height))) {
            parts.push(Math.round(window.Width) + ' x ' + Math.round(window.Height));
        }
    } catch (e3) {
        // Size is unavailable.
    }

    parts.push(isVisible() ? 'visible' : 'hidden');

    return parts.join('  -  ');
}

function getMySettings() {
    var rows = [
        { id: 'panelName', label: 'Name in Settings', type: 'string', value: settings.panelName,
          hint: 'how this panel is listed here; blank uses an automatic name' },
        { id: 'instanceId', label: 'Panel instance', type: 'info', value: instanceId },
        { id: 'panelWindow', label: 'Panel window', type: 'info', value: describePanelWindow() },

        { id: 'view', label: 'View', type: 'choice', value: settings.view,
          choiceValueType: 'string', choices: VIEW_CHOICES },
        { id: 'spectrumOrder', label: 'Spectrum arrangement', type: 'choice', value: settings.spectrumOrder,
          choiceValueType: 'string', choices: SPECTRUM_ORDER_CHOICES },

        { id: 'themeMode', label: 'Theme', type: 'choice', value: settings.themeMode,
          choiceValueType: 'string', choices: THEME_CHOICES },
        { id: 'colourMode', label: 'Visualiser colour', type: 'choice', value: settings.colourMode,
          choiceValueType: 'string', choices: COLOUR_CHOICES },
        { id: 'customColour', label: 'Custom colour', type: 'colour', value: settings.customColour },
        { id: 'gradient', label: 'Use gradient', type: 'bool', value: settings.gradient },
        { id: 'gradientDepth', label: 'Gradient depth', type: 'choice', value: settings.gradientDepth,
          choiceValueType: 'string', choices: GRADIENT_DEPTH_CHOICES },
        { id: 'gradientTint', label: 'Gradient style', type: 'choice', value: settings.gradientTint,
          choiceValueType: 'string', choices: GRADIENT_TINT_CHOICES },
        { id: 'gradientScale', label: 'Gradient scaling', type: 'choice', value: settings.gradientScale,
          choiceValueType: 'string', choices: GRADIENT_SCALE_CHOICES },
        { id: 'background', label: 'Background fill', type: 'choice', value: settings.background,
          choiceValueType: 'string', choices: BACKGROUND_CHOICES },
        { id: 'showHeader', label: 'Show header', type: 'bool', value: settings.showHeader },
        { id: 'showFrame', label: 'Show border', type: 'bool', value: settings.showFrame },
        { id: 'cornerRadius', label: 'Corner radius', type: 'choice', value: settings.cornerRadius,
          choiceValueType: 'number', choices: RADIUS_CHOICES },
        { id: 'outerPadding', label: 'Outer padding (px)', type: 'choice', value: settings.outerPadding,
          choiceValueType: 'number', choices: PADDING_CHOICES },

        { id: 'barCount', label: 'Band count', type: 'choice', value: settings.barCount,
          choiceValueType: 'number', choices: BAR_COUNT_CHOICES },
        { id: 'barGap', label: 'Bar gap', type: 'choice', value: settings.barGap,
          choiceValueType: 'number', choices: BAR_GAP_CHOICES },
        { id: 'barRounding', label: 'Bar rounding', type: 'choice', value: settings.barRounding,
          choiceValueType: 'string', choices: BAR_ROUNDING_CHOICES },
        { id: 'minBarSize', label: 'Minimum bar size (px)', type: 'number', value: settings.minBarSize,
          min: 0, max: 12, step: 1 },
        { id: 'edgeFade', label: 'Fade near panel edges', type: 'bool', value: settings.edgeFade },
        { id: 'edgeFadeAmount', label: 'Edge fade width (%)', type: 'number', value: settings.edgeFadeAmount,
          min: 0, max: 50, step: 1 },

        { id: 'trailFrames', label: 'Trail length', type: 'choice', value: settings.trailFrames,
          choiceValueType: 'number', choices: TRAIL_FRAME_CHOICES },
        { id: 'trailSpacing', label: 'Trail spacing', type: 'choice', value: settings.trailSpacing,
          choiceValueType: 'number', choices: TRAIL_SPACING_CHOICES },
        { id: 'trailOpacity', label: 'Trail opacity (%)', type: 'number', value: settings.trailOpacity,
          min: 5, max: 100, step: 1 },
        { id: 'trailScale', label: 'Trail size (%)', type: 'number', value: settings.trailScale,
          min: 40, max: 130, step: 1 },

        { id: 'showPeaks', label: 'Show peak markers', type: 'bool', value: settings.showPeaks },
        { id: 'peakHoldMs', label: 'Peak hold', type: 'choice', value: settings.peakHoldMs,
          choiceValueType: 'number', choices: PEAK_HOLD_CHOICES },
        { id: 'peakDecay', label: 'Peak decay', type: 'choice', value: settings.peakDecay,
          choiceValueType: 'string', choices: PEAK_DECAY_CHOICES },
        { id: 'peakThickness', label: 'Peak thickness (px)', type: 'number', value: settings.peakThickness,
          min: 1, max: 6, step: 1 },

        { id: 'fftSize', label: 'FFT size', type: 'choice', value: settings.fftSize,
          choiceValueType: 'number', choices: FFT_SIZE_CHOICES },
        { id: 'minHz', label: 'Lowest frequency', type: 'choice', value: settings.minHz,
          choiceValueType: 'number', choices: MIN_HZ_CHOICES },
        { id: 'maxHz', label: 'Highest frequency', type: 'choice', value: settings.maxHz,
          choiceValueType: 'number', choices: MAX_HZ_CHOICES },
        { id: 'floorDb', label: 'Noise floor', type: 'choice', value: settings.floorDb,
          choiceValueType: 'number', choices: FLOOR_DB_CHOICES },
        { id: 'ceilingDb', label: 'Ceiling', type: 'choice', value: settings.ceilingDb,
          choiceValueType: 'number', choices: CEILING_DB_CHOICES },
        { id: 'tiltDb', label: 'Spectral tilt', type: 'choice', value: settings.tiltDb,
          choiceValueType: 'number', choices: TILT_CHOICES },
        { id: 'bandCurve', label: 'Band spacing', type: 'choice', value: settings.bandCurve,
          choiceValueType: 'string', choices: BAND_CURVE_CHOICES },
        { id: 'bandPick', label: 'Bin aggregation', type: 'choice', value: settings.bandPick,
          choiceValueType: 'string', choices: BAND_PICK_CHOICES },
        { id: 'spectralSmooth', label: 'Neighbour smoothing', type: 'choice', value: settings.spectralSmooth,
          choiceValueType: 'number', choices: SMOOTH_CHOICES },

        { id: 'fps', label: 'Frame rate', type: 'choice', value: settings.fps,
          choiceValueType: 'number', choices: FPS_CHOICES },
        { id: 'attack', label: 'Attack', type: 'choice', value: settings.attack,
          choiceValueType: 'string', choices: BALLISTIC_CHOICES },
        { id: 'release', label: 'Release', type: 'choice', value: settings.release,
          choiceValueType: 'string', choices: BALLISTIC_CHOICES },
        { id: 'idleFade', label: 'Fade out when playback stops', type: 'bool', value: settings.idleFade },

        { id: 'radialInner', label: 'Radial inner radius (%)', type: 'number', value: settings.radialInner,
          min: 5, max: 80, step: 1 },
        { id: 'radialSpread', label: 'Radial sweep (degrees)', type: 'number', value: settings.radialSpread,
          min: 60, max: 360, step: 10 },
        { id: 'radialRotate', label: 'Radial slow rotation', type: 'bool', value: settings.radialRotate },

        { id: 'showCdArt', label: 'Show CD art (radial view)', type: 'bool', value: settings.showCdArt },
        { id: 'cdSize', label: 'CD art size (%)', type: 'choice', value: settings.cdSize,
          choiceValueType: 'number', choices: CD_SIZE_CHOICES },
        { id: 'cdSpin', label: 'CD spins automatically', type: 'bool', value: settings.cdSpin },
        { id: 'cdSpinSpeed', label: 'CD spin speed', type: 'choice', value: settings.cdSpinSpeed,
          choiceValueType: 'string', choices: CD_SPIN_SPEED_CHOICES },

        { id: 'hoverTooltip', label: 'Show hover tooltip', type: 'bool', value: settings.hoverTooltip },
        { id: 'clickCyclesView', label: 'Left-click cycles view', type: 'bool', value: settings.clickCyclesView },

        { id: 'resetDefaults', label: 'Reset spectrum settings', type: 'action', value: false, actionLabel: 'Reset' }
    ];
    var analysisIds = { fftSize: 1, minHz: 1, maxHz: 1, floorDb: 1, ceilingDb: 1, tiltDb: 1, bandCurve: 1, bandPick: 1, spectralSmooth: 1, attack: 1, release: 1 };
    for (var i = 0; i < rows.length; i++) {
        rows[i].section = (rows[i].id === 'instanceId' || rows[i].id === 'panelWindow')
            ? 'Diagnostics'
            : (analysisIds[rows[i].id] ? 'Advanced audio analysis' : 'Options');
    }
    return rows;
}

function applyMySetting(settingId, value) {
    var needTheme = false;
    var needAnalyser = false;
    var needBins = false;
    var needHistory = false;
    var needTimer = false;
    var changed = false;

    switch (settingId) {
    case 'panelName':
        changed = setStoredSetting('panelName', String(value == null ? '' : value).slice(0, 48));
        break;
    case 'instanceId':
    case 'panelWindow':
        return; // read-only

    case 'view':
        changed = setStoredSetting('view', choiceValue(String(value), VIEW_CHOICES, DEFAULTS.view));
        needTimer = true;
        break;
    case 'spectrumOrder':
        changed = setStoredSetting('spectrumOrder', choiceValue(String(value), SPECTRUM_ORDER_CHOICES, DEFAULTS.spectrumOrder));
        break;

    case 'themeMode':
        changed = setStoredSetting('themeMode', choiceValue(String(value), THEME_CHOICES, DEFAULTS.themeMode));
        needTheme = true;
        break;
    case 'colourMode':
        changed = setStoredSetting('colourMode', choiceValue(String(value), COLOUR_CHOICES, DEFAULTS.colourMode));
        needTheme = true;
        if (changed && settings.colourMode === 'album') SharedAccentProtocol.requestAccent();
        break;
    case 'customColour':
        changed = setStoredSetting('customColour', RivageUI.opaque(Number(value) || DEFAULTS.customColour));
        needTheme = settings.colourMode === 'custom';
        break;
    case 'gradient':
        changed = setStoredSetting('gradient', !!value);
        break;
    case 'gradientDepth':
        changed = setStoredSetting('gradientDepth', choiceValue(String(value), GRADIENT_DEPTH_CHOICES, DEFAULTS.gradientDepth));
        break;
    case 'gradientScale':
        changed = setStoredSetting('gradientScale', choiceValue(String(value), GRADIENT_SCALE_CHOICES, DEFAULTS.gradientScale));
        break;
    case 'gradientTint':
        changed = setStoredSetting('gradientTint', choiceValue(String(value), GRADIENT_TINT_CHOICES, DEFAULTS.gradientTint));
        break;
    case 'background':
        changed = setStoredSetting('background', choiceValue(String(value), BACKGROUND_CHOICES, DEFAULTS.background));
        break;
    case 'showHeader':
        changed = setStoredSetting('showHeader', !!value);
        break;
    case 'showFrame':
        changed = setStoredSetting('showFrame', !!value);
        break;
    case 'cornerRadius':
        changed = setStoredSetting('cornerRadius', numberChoiceValue(value, RADIUS_CHOICES, DEFAULTS.cornerRadius));
        break;
    case 'outerPadding':
        changed = setStoredSetting('outerPadding', numberChoiceValue(value, PADDING_CHOICES, DEFAULTS.outerPadding));
        break;

    case 'barCount':
        changed = setStoredSetting('barCount', numberChoiceValue(value, BAR_COUNT_CHOICES, DEFAULTS.barCount));
        needAnalyser = true;
        break;
    case 'barGap':
        changed = setStoredSetting('barGap', numberChoiceValue(value, BAR_GAP_CHOICES, DEFAULTS.barGap));
        break;
    case 'barRounding':
        changed = setStoredSetting('barRounding', choiceValue(String(value), BAR_ROUNDING_CHOICES, DEFAULTS.barRounding));
        break;
    case 'minBarSize':
        changed = setStoredSetting('minBarSize', clampNumber(value, 0, 12, DEFAULTS.minBarSize));
        break;
    case 'edgeFade':
        changed = setStoredSetting('edgeFade', !!value);
        break;
    case 'edgeFadeAmount':
        changed = setStoredSetting('edgeFadeAmount', clampNumber(value, 0, 50, DEFAULTS.edgeFadeAmount));
        break;

    case 'trailFrames':
        changed = setStoredSetting('trailFrames', numberChoiceValue(value, TRAIL_FRAME_CHOICES, DEFAULTS.trailFrames));
        needHistory = true;
        break;
    case 'trailSpacing':
        changed = setStoredSetting('trailSpacing', numberChoiceValue(value, TRAIL_SPACING_CHOICES, DEFAULTS.trailSpacing));
        needHistory = true;
        break;
    case 'trailOpacity':
        changed = setStoredSetting('trailOpacity', clampNumber(value, 5, 100, DEFAULTS.trailOpacity));
        break;
    case 'trailScale':
        changed = setStoredSetting('trailScale', clampNumber(value, 40, 130, DEFAULTS.trailScale));
        break;

    case 'showPeaks':
        changed = setStoredSetting('showPeaks', !!value);
        break;
    case 'peakHoldMs':
        changed = setStoredSetting('peakHoldMs', numberChoiceValue(value, PEAK_HOLD_CHOICES, DEFAULTS.peakHoldMs));
        break;
    case 'peakDecay':
        changed = setStoredSetting('peakDecay', choiceValue(String(value), PEAK_DECAY_CHOICES, DEFAULTS.peakDecay));
        break;
    case 'peakThickness':
        changed = setStoredSetting('peakThickness', clampNumber(value, 1, 6, DEFAULTS.peakThickness));
        break;

    case 'fftSize':
        changed = setStoredSetting('fftSize', numberChoiceValue(value, FFT_SIZE_CHOICES, DEFAULTS.fftSize));
        needAnalyser = true;
        break;
    case 'minHz':
        changed = setStoredSetting('minHz', numberChoiceValue(value, MIN_HZ_CHOICES, DEFAULTS.minHz));
        if (changed) enforceRangeOrder(true);
        needAnalyser = true;
        break;
    case 'maxHz':
        changed = setStoredSetting('maxHz', numberChoiceValue(value, MAX_HZ_CHOICES, DEFAULTS.maxHz));
        if (changed) enforceRangeOrder(true);
        needAnalyser = true;
        break;
    case 'floorDb':
        changed = setStoredSetting('floorDb', numberChoiceValue(value, FLOOR_DB_CHOICES, DEFAULTS.floorDb));
        if (changed) enforceRangeOrder(true);
        break;
    case 'ceilingDb':
        changed = setStoredSetting('ceilingDb', numberChoiceValue(value, CEILING_DB_CHOICES, DEFAULTS.ceilingDb));
        if (changed) enforceRangeOrder(true);
        break;
    case 'tiltDb':
        changed = setStoredSetting('tiltDb', numberChoiceValue(value, TILT_CHOICES, DEFAULTS.tiltDb));
        needBins = true;
        break;
    case 'bandCurve':
        changed = setStoredSetting('bandCurve', choiceValue(String(value), BAND_CURVE_CHOICES, DEFAULTS.bandCurve));
        needAnalyser = true;
        break;
    case 'bandPick':
        changed = setStoredSetting('bandPick', choiceValue(String(value), BAND_PICK_CHOICES, DEFAULTS.bandPick));
        break;
    case 'spectralSmooth':
        changed = setStoredSetting('spectralSmooth', numberChoiceValue(value, SMOOTH_CHOICES, DEFAULTS.spectralSmooth));
        break;

    case 'fps':
        changed = setStoredSetting('fps', numberChoiceValue(value, FPS_CHOICES, DEFAULTS.fps));
        needTimer = true;
        break;
    case 'attack':
        changed = setStoredSetting('attack', choiceValue(String(value), BALLISTIC_CHOICES, DEFAULTS.attack));
        break;
    case 'release':
        changed = setStoredSetting('release', choiceValue(String(value), BALLISTIC_CHOICES, DEFAULTS.release));
        break;
    case 'idleFade':
        changed = setStoredSetting('idleFade', !!value);
        break;

    case 'radialInner':
        changed = setStoredSetting('radialInner', clampNumber(value, 5, 80, DEFAULTS.radialInner));
        break;
    case 'radialSpread':
        changed = setStoredSetting('radialSpread', clampNumber(value, 60, 360, DEFAULTS.radialSpread));
        break;
    case 'radialRotate':
        changed = setStoredSetting('radialRotate', !!value);
        break;

    case 'showCdArt':
        changed = setStoredSetting('showCdArt', !!value);
        break;
    case 'cdSize':
        changed = setStoredSetting('cdSize', numberChoiceValue(value, CD_SIZE_CHOICES, DEFAULTS.cdSize));
        break;
    case 'cdSpin':
        changed = setStoredSetting('cdSpin', !!value);
        break;
    case 'cdSpinSpeed':
        changed = setStoredSetting('cdSpinSpeed', choiceValue(String(value), CD_SPIN_SPEED_CHOICES, DEFAULTS.cdSpinSpeed));
        break;

    case 'hoverTooltip':
        changed = setStoredSetting('hoverTooltip', !!value);
        break;
    case 'clickCyclesView':
        changed = setStoredSetting('clickCyclesView', !!value);
        break;

    case 'resetDefaults':
        resetSettings();
        return;
    }

    if (!changed) return;
    if (settingId === 'showPeaks' && !settings.showPeaks) clearPeakState();

    if (needAnalyser) {
        rebuildAnalyser();
    } else {
        if (needBins) rebuildBandBins();
        if (needHistory) rebuildHistoryRing();
    }
    if (needTheme) refreshVisualResources(false);
    if (needTimer) applyEngineSettings(true);

    if (panelW > 0 && panelH > 0) {
        computeLayout();
        refreshHoverFromPointer();
    }
    window.Repaint();
}

// Context menu

// Win32 menu flags. These are NOT provided by the host as globals - the
// familiar MF_STRING / MF_GRAYED names are `const` declarations inside
// samples\complete\js\helpers.js, which this panel does not include.
// Referencing them here would throw a ReferenceError the moment the menu is
// built. Panel-local names also avoid a redeclaration conflict if helpers.js
// is ever added to this panel's includes.
var MENU_STRING = 0x00000000;
var MENU_GRAYED = 0x00000001;

function MenuBuilder() {
    this.nextId = 1;
    this.actions = {};
    // Hold every popup menu created for this invocation. AppendTo does not
    // keep a reference the collector can see, so a submenu built early can be
    // collected before TrackPopupMenu walks it.
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

MenuBuilder.prototype.addNumberSubmenu = function (parent, title, values, suffix, current, settingId) {
    var choices = [];
    var i;
    for (i = 0; i < values.length; i++) {
        choices.push({ value: values[i], label: values[i] + (suffix || '') });
    }
    this.addChoiceSubmenu(parent, title, choices, current, settingId);
};

// Only affects how this panel is listed in the shared settings screen. Each
// panel keeps its own settings either way.
function renameThisPanel() {
    var entered;
    try {
        entered = utils.InputBox(
            window.ID,
            'Name shown in RVG Settings.\n' +
                'Leave blank to use the automatic name.',
            RivageUI.copy.popupTitle('Spectrum'),
            String(settings.panelName || ''),
            true
        );
    } catch (e) {
        return; // cancelled
    }
    applyMySetting('panelName', entered);
}

function pickSettingColour(settingId) {
    var picked;
    try {
        picked = utils.ColourPicker(window.ID, settings[settingId]);
    } catch (e) {
        return;
    }
    if (typeof picked === 'number') applyMySetting(settingId, picked);
}

function showContextMenu(x, y) {
    var builder = new MenuBuilder();
    var menu = builder.createMenu();
    var colourMenu = builder.createMenu();
    var barsMenu = builder.createMenu();
    var ghostMenu = builder.createMenu();
    var analysisMenu = builder.createMenu();
    var ballisticsMenu = builder.createMenu();
    var viewExtras = builder.createMenu();
    var frameMenu = builder.createMenu();

    builder.addChoiceSubmenu(menu, 'View', VIEW_CHOICES, settings.view, 'view');
    builder.addChoiceSubmenu(menu, 'Spectrum arrangement', SPECTRUM_ORDER_CHOICES, settings.spectrumOrder, 'spectrumOrder');
    menu.AppendMenuSeparator();

    builder.addChoiceSubmenu(colourMenu, 'Visualiser colour', COLOUR_CHOICES, settings.colourMode, 'colourMode');
    builder.addAction(colourMenu, 'Custom colour…', function () { pickSettingColour('customColour'); });
    colourMenu.AppendMenuSeparator();
    builder.addToggle(colourMenu, 'Gradient', 'gradient');
    builder.addChoiceSubmenu(colourMenu, 'Gradient depth', GRADIENT_DEPTH_CHOICES, settings.gradientDepth, 'gradientDepth');
    builder.addChoiceSubmenu(colourMenu, 'Gradient style', GRADIENT_TINT_CHOICES, settings.gradientTint, 'gradientTint');
    builder.addChoiceSubmenu(colourMenu, 'Gradient scaling', GRADIENT_SCALE_CHOICES, settings.gradientScale, 'gradientScale');
    colourMenu.AppendMenuSeparator();
    builder.addChoiceSubmenu(colourMenu, 'Theme', THEME_CHOICES, settings.themeMode, 'themeMode');
    builder.addChoiceSubmenu(colourMenu, 'Background', BACKGROUND_CHOICES, settings.background, 'background');
    colourMenu.AppendTo(menu, MENU_STRING, 'Colour and gradient');

    builder.addChoiceSubmenu(barsMenu, 'Band count', BAR_COUNT_CHOICES, settings.barCount, 'barCount');
    builder.addChoiceSubmenu(barsMenu, 'Bar gap', BAR_GAP_CHOICES, settings.barGap, 'barGap');
    builder.addChoiceSubmenu(barsMenu, 'Bar rounding', BAR_ROUNDING_CHOICES, settings.barRounding, 'barRounding');
    builder.addNumberSubmenu(barsMenu, 'Minimum bar size', [0, 1, 2, 3, 4, 6], ' px', settings.minBarSize, 'minBarSize');
    barsMenu.AppendMenuSeparator();
    builder.addToggle(barsMenu, 'Fade near panel edges', 'edgeFade');
    builder.addNumberSubmenu(barsMenu, 'Edge fade width', [8, 15, 22, 30, 40], '%', settings.edgeFadeAmount, 'edgeFadeAmount');
    barsMenu.AppendTo(menu, MENU_STRING, 'Bars');

    builder.addChoiceSubmenu(ghostMenu, 'Trail length', TRAIL_FRAME_CHOICES, settings.trailFrames, 'trailFrames');
    builder.addChoiceSubmenu(ghostMenu, 'Trail spacing', TRAIL_SPACING_CHOICES, settings.trailSpacing, 'trailSpacing');
    builder.addNumberSubmenu(ghostMenu, 'Trail opacity', [20, 35, 46, 60, 80], '%', settings.trailOpacity, 'trailOpacity');
    builder.addNumberSubmenu(ghostMenu, 'Trail size', [70, 85, 100, 110, 120], '%', settings.trailScale, 'trailScale');
    ghostMenu.AppendMenuSeparator();
    builder.addToggle(ghostMenu, 'Peak markers', 'showPeaks');
    builder.addChoiceSubmenu(ghostMenu, 'Peak hold', PEAK_HOLD_CHOICES, settings.peakHoldMs, 'peakHoldMs');
    builder.addChoiceSubmenu(ghostMenu, 'Peak decay', PEAK_DECAY_CHOICES, settings.peakDecay, 'peakDecay');
    builder.addNumberSubmenu(ghostMenu, 'Peak thickness', [1, 2, 3, 4], ' px', settings.peakThickness, 'peakThickness');
    ghostMenu.AppendTo(menu, MENU_STRING, 'Ghosting and peaks');

    builder.addChoiceSubmenu(analysisMenu, 'FFT size', FFT_SIZE_CHOICES, settings.fftSize, 'fftSize');
    builder.addChoiceSubmenu(analysisMenu, 'Lowest frequency', MIN_HZ_CHOICES, settings.minHz, 'minHz');
    builder.addChoiceSubmenu(analysisMenu, 'Highest frequency', MAX_HZ_CHOICES, settings.maxHz, 'maxHz');
    builder.addChoiceSubmenu(analysisMenu, 'Noise floor', FLOOR_DB_CHOICES, settings.floorDb, 'floorDb');
    builder.addChoiceSubmenu(analysisMenu, 'Ceiling', CEILING_DB_CHOICES, settings.ceilingDb, 'ceilingDb');
    builder.addChoiceSubmenu(analysisMenu, 'Spectral tilt', TILT_CHOICES, settings.tiltDb, 'tiltDb');
    builder.addChoiceSubmenu(analysisMenu, 'Band spacing', BAND_CURVE_CHOICES, settings.bandCurve, 'bandCurve');
    builder.addChoiceSubmenu(analysisMenu, 'Bin aggregation', BAND_PICK_CHOICES, settings.bandPick, 'bandPick');
    builder.addChoiceSubmenu(analysisMenu, 'Neighbour smoothing', SMOOTH_CHOICES, settings.spectralSmooth, 'spectralSmooth');
    analysisMenu.AppendTo(menu, MENU_STRING, 'Analysis');

    builder.addChoiceSubmenu(ballisticsMenu, 'Frame rate', FPS_CHOICES, settings.fps, 'fps');
    builder.addChoiceSubmenu(ballisticsMenu, 'Attack', BALLISTIC_CHOICES, settings.attack, 'attack');
    builder.addChoiceSubmenu(ballisticsMenu, 'Release', BALLISTIC_CHOICES, settings.release, 'release');
    builder.addToggle(ballisticsMenu, 'Fade out when playback stops', 'idleFade');
    ballisticsMenu.AppendTo(menu, MENU_STRING, 'Ballistics');

    builder.addNumberSubmenu(viewExtras, 'Radial inner radius', [15, 25, 32, 45, 60], '%', settings.radialInner, 'radialInner');
    builder.addNumberSubmenu(viewExtras, 'Radial sweep', [180, 240, 300, 340, 360], ' deg', settings.radialSpread, 'radialSpread');
    builder.addToggle(viewExtras, 'Radial slow rotation', 'radialRotate');
    viewExtras.AppendMenuSeparator();
    builder.addToggle(viewExtras, 'Show CD art', 'showCdArt');
    builder.addNumberSubmenu(viewExtras, 'CD art size', [60, 75, 92, 100, 110], '%', settings.cdSize, 'cdSize');
    builder.addToggle(viewExtras, 'CD spins automatically', 'cdSpin');
    builder.addChoiceSubmenu(viewExtras, 'CD spin speed', CD_SPIN_SPEED_CHOICES, settings.cdSpinSpeed, 'cdSpinSpeed');
    viewExtras.AppendTo(menu, MENU_STRING, 'View options');

    builder.addToggle(frameMenu, 'Show header', 'showHeader');
    builder.addToggle(frameMenu, 'Show border', 'showFrame');
    builder.addChoiceSubmenu(frameMenu, 'Corner radius', RADIUS_CHOICES, settings.cornerRadius, 'cornerRadius');
    builder.addChoiceSubmenu(frameMenu, 'Outer padding', PADDING_CHOICES, settings.outerPadding, 'outerPadding');
    frameMenu.AppendMenuSeparator();
    builder.addToggle(frameMenu, 'Hover tooltip', 'hoverTooltip');
    builder.addToggle(frameMenu, 'Left-click cycles view', 'clickCyclesView');
    frameMenu.AppendTo(menu, MENU_STRING, 'Frame and interaction');

    menu.AppendMenuSeparator();
    builder.addAction(menu, 'Rename panel… (' + settingsPanelLabel() + ')', renameThisPanel);
    builder.addAction(menu, 'Open / close RVG settings', function () {
        window.NotifyOthers('RIVAGE.TOGGLE_PANEL_VISIBILITY', { caption: 'SETTINGS' });
    });
    builder.addAction(menu, 'Reset spectrum settings', resetSettings);
    builder.addAction(menu, RivageUI.copy.labels.panelConfiguration, function () { window.ShowConfigureV2(); });

    var selected = menu.TrackPopupMenu(x, y);
    if (selected && builder.actions[selected]) builder.actions[selected]();
    return true;
}

// Startup

loadInstanceId();
loadSettings();
refreshVisualResources(false);
rebuildAnalyser();
clearLevels();

// Ask the tabs panel for the current album accent and shared theme in case
// this panel loaded after the producer's initial broadcast.
SharedAccentProtocol.request();

startEngineIfRunnable();
