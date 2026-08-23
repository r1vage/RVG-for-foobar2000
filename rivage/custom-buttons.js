window.DrawMode = 0;

include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\foobar_actions.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\track_context.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\miniplayer_protocol.js");

// window.DefineScript's third options member is `features`, not `options`
// (see docs/html/window.html#.DefineScript). A misnamed key is silently
// ignored, so the panel kept the host defaults instead of opting out of
// focus grabbing and drag-and-drop.
window.DefineScript(RivageUI.copy.popupTitle("Custom buttons"), {
    author: "RivaGe",
    version: "2.13.1",
    features: { drag_n_drop: false, grab_focus: false }
});

// Narrow failure reporting. Most empty catches in this file guard calls that
// are *expected* to fail - probing an optional host API, clearing an
// already-fired timer, tearing down a tooltip - and stay silent on purpose.
// This is for the few that mean something is actually broken and would
// otherwise leave no trace. Repeats are counted and re-logged only at powers of
// ten, so a failure inside a polling timer cannot flood the console.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = "[RVG Custom Buttons] " + what +
        (err === undefined || err === null ? "" : ": " + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + " (x" + seen + ")"); } catch (e) { }
}

// Property names were originally built as PREFIX + "Name" with no separator,
// producing keys like "RVG Custom ButtonsButtons JSON". The prefix now ends in
// a space; readProperty() below falls back to the old unspaced key once, so an
// existing panel keeps every saved value.
var PROPERTY_PREFIX = "RVG Custom Buttons ";
var LEGACY_PROPERTY_PREFIX = "RVG Custom Buttons";

var SETTINGS_PANEL_ID_PREFIX = "custom_buttons-";
var SETTINGS_PANEL_LABEL = "Custom buttons";

var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;
var MF_DISABLED = 0x00000002;
var MF_CHECKED = 0x00000008;

var MK_SHIFT = 0x0004;

var VK_SHIFT = 0x10;
var VK_LWIN = 0x5B;
var VK_RWIN = 0x5C;

// SettingsRegistry needs a per-panel id; sharing remains an explicit NotifyOthers policy.

var SHARE_MODE_SHARED = "shared";
var SHARE_MODE_STANDALONE = "standalone";
var SHARE_MODE_BUTTONS = "buttons";

var CUSTOM_BUTTONS_SYNC = "RIVAGE.CUSTOM_BUTTONS.SYNC.V1";
var CUSTOM_BUTTONS_REQUEST = "RIVAGE.CUSTOM_BUTTONS.REQUEST.V1";

// A JSplitter panel cannot size or hide itself: window.GetPanel()/Move()/Show()
// only work from a script that sits at the same splitter level as the target.
// So a strip that wants to be exactly as wide/tall as its buttons publishes its
// natural content size and lets the script that owns that branch reserve the
// space:
//
//   root-top       root_splitter.js  - reserves a column beside the Top bar
//   leftside-rail  settings_host.js  - reserves a full-height rail in LEFT SIDE
//   none           no host; the panel is sized by the layout as usual
//                  (bottom_bar_host.js's weighted slots need no measurement)
//
// Turning the strip off publishes a zero size, which is what makes the host
// collapse it and reclaim the space for its siblings. The slot and the on/off
// switch are per-panel placement, not appearance, so neither is ever shared
// between instances.

var LAYOUT_SLOT_NONE = "none";
var LAYOUT_SLOT_ROOT_TOP = "root-top";
var LAYOUT_SLOT_LEFT_RAIL = "leftside-rail";

var CUSTOM_BUTTONS_MEASURE = "RIVAGE.CUSTOM_BUTTONS.MEASURE.V1";
var CUSTOM_BUTTONS_MEASURE_REQUEST = "RIVAGE.CUSTOM_BUTTONS.MEASURE_REQUEST.V1";

var SETTINGS_PANEL_CAPTION = "SETTINGS";
var TOGGLE_PANEL_VISIBILITY = "RIVAGE.TOGGLE_PANEL_VISIBILITY";

function normaliseLayoutSlot(value) {
    value = String(value || "");
    if (value === LAYOUT_SLOT_ROOT_TOP || value === LAYOUT_SLOT_LEFT_RAIL) return value;
    return LAYOUT_SLOT_NONE;
}

function layoutSlotLabel(value) {
    value = normaliseLayoutSlot(value);
    if (value === LAYOUT_SLOT_ROOT_TOP) return "Top bar";
    if (value === LAYOUT_SLOT_LEFT_RAIL) return "Left button rail";
    return "No managed slot";
}

var INSTANCE_ID_PROPERTY = PROPERTY_PREFIX + "Instance id";

// Deliberately not a setting: this is the panel's identity. Resetting buttons
// or settings must never change it.
var instanceId = "";

// Set while a broadcast from a sibling is being applied, so adopting a peer's
// state never echoes back out as a fresh broadcast.
var applyingSharedState = false;

// One-shot migration from the old unspaced key to the new one.
//
// window.GetProperty only creates a missing property when a non-null default
// is supplied (see docs/html/window.html#.GetProperty), so probing for the old
// name costs nothing on a fresh panel, and window.SetProperty(name, undefined)
// removes the stale key rather than leaving a duplicate behind.
function readProperty(name, fallback) {
    var legacy;

    if (window.GetProperty(PROPERTY_PREFIX + name) === undefined) {
        legacy = window.GetProperty(LEGACY_PROPERTY_PREFIX + name);
        if (legacy !== undefined && legacy !== null) {
            window.SetProperty(PROPERTY_PREFIX + name, legacy);
            window.SetProperty(LEGACY_PROPERTY_PREFIX + name, undefined);
            return legacy;
        }
    }

    return window.GetProperty(PROPERTY_PREFIX + name, fallback);
}

function makeInstanceId() {
    var random = Math.floor(Math.random() * 0x1000000).toString(16);
    var stamp = (Date.now() % 0x1000000).toString(16);
    return ("000000" + random).slice(-6) + ("000000" + stamp).slice(-6);
}

function loadInstanceId() {
    var stored = String(window.GetProperty(INSTANCE_ID_PROPERTY, "") || "").replace(/^\s+|\s+$/g, "");
    if (!/^[0-9a-z]{8,12}$/.test(stored)) {
        stored = makeInstanceId();
        window.SetProperty(INSTANCE_ID_PROPERTY, stored);
    }
    instanceId = stored;
    return stored;
}

loadInstanceId();

function settingsPanelId() {
    return SETTINGS_PANEL_ID_PREFIX + instanceId;
}

function settingsPanelLabel() {
    var name = String(settings && settings.panelName || "").replace(/^\s+|\s+$/g, "");
    return name || SETTINGS_PANEL_LABEL;
}

function normaliseShareMode(value) {
    value = String(value || "");
    if (value === SHARE_MODE_STANDALONE || value === SHARE_MODE_BUTTONS) return value;
    return SHARE_MODE_SHARED;
}

function sharesButtons() {
    return settings.shareMode !== SHARE_MODE_STANDALONE;
}

function sharesDesign() {
    return settings.shareMode === SHARE_MODE_SHARED;
}

var ACTION_NONE = "none";
var ACTION_CONTEXT = "context";
var ACTION_MAIN = "main";
var ACTION_BUILTIN = "builtin";

var TARGET_SELECTION_OR_CURRENT = "selection_or_current";
var TARGET_SELECTION = "selection";
var TARGET_NOW_PLAYING = "now_playing";
var TARGET_FOCUSED = "focused";
var TARGET_CURRENT = "current";

var STYLE_NORMAL = "normal";
var STYLE_ACCENT = "accent";
var STYLE_OUTLINE = "outline";
var STYLE_GHOST = "ghost";
var STYLE_SWITCHER = "switcher";

var PRESENTATION_ICON = "icon";
var PRESENTATION_ICON_LABEL = "icon_label";
var PRESENTATION_LABEL = "label";

var ORIENTATION_AUTO = "auto";
var ORIENTATION_HORIZONTAL = "horizontal";
var ORIENTATION_VERTICAL = "vertical";

var ALIGN_START = "start";
var ALIGN_CENTER = "center";
var ALIGN_END = "end";

var ACCENT_DEFAULT = "default";
var ACCENT_SHARED = "shared";
var ACCENT_CUSTOM = "custom";

// Per-button accent source. PANEL follows the panel-wide Accent colour setting;
// SHARED binds a button directly to RVG's shared album accent regardless of
// that panel-wide setting; DEFAULT uses UWP blue; CUSTOM uses button.colour.
var BUTTON_ACCENT_PANEL = "panel";
var BUTTON_ACCENT_SHARED = "shared";
var BUTTON_ACCENT_DEFAULT = "default";
var BUTTON_ACCENT_CUSTOM = "custom";

var DEFAULT_ACCENT = RivageUI.DEFAULT_ACCENT;
var DEFAULT_CONTEXT_FLAGS = 8;

// Local opaque RGB helper. Do not depend on a global RGB() helper: unlike some
// RVG panels, this standalone panel may load in a JSplitter host where RGB
// has not been defined by another script/include.
function makeRgb(r, g, b) {
    return (0xFF000000 | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF));
}

// Stateful default buttons use the same visual language as RVG Top Bar.
// Stop-after-current is red; stop-after-queue is orange. Other active toggles
// use the panel/button accent selected by the user.
var STOP_AFTER_CURRENT_COLOUR = makeRgb(232, 17, 35);
var STOP_AFTER_QUEUE_COLOUR = makeRgb(255, 140, 0);

var DEFAULT_GLYPHS = Object.freeze({

    selectAll: "\uE8B3",
    pin: "\uE718",
    pinFill: "\uE841",
    lock: "\uE72E",
    unlock: "\uE785",
    brightness: "\uE706",
    statusBar: "\uE90E",
    timer: RivageUI.icons.timer || "\uE916",
    table: "\uF0E2",
    heart: RivageUI.icons.heart || "\uEB51",
    heartFill: RivageUI.icons.heartFill || "\uEB52",
    tag: RivageUI.icons.tag || "\uE8EC",
    convert: RivageUI.icons.convert || "\uE895",
    move: RivageUI.icons.move || "\uE8DE",
    albumArt: RivageUI.icons.albumArt || "\uE7AA",
    equalizer: "\uEE6F",
    folder: RivageUI.icons.folder || "\uE838",

    menu: RivageUI.icons.menu || "\uE700",
    properties: "\uE946",
    google: "G",
    console: "\uE756",
    search: "\uE721",
    plus: "\uE710",
    edit: "\uE70F",
    // "BackToWindow" - a window shrinking back down, used for the Mini
    // Player toggle.
    miniPlayer: "\uE73F",
    settings: RivageUI.icons.preferences || "\uE713",
    play: RivageUI.icons.play || "\uE768",
    stop: RivageUI.icons.stop || "\uE71A",
    previous: RivageUI.icons.previous || "\uE892",
    next: RivageUI.icons.next || "\uE893"
});

var COMMANDS = RivageCommands.COMMANDS;

// Candidate main-menu paths copied from Top Bar. A few foobar/component
// versions expose slightly different capitalisation/paths, so these built-in
// actions use the same fallback lists rather than persisting one brittle path.
var TOPBAR_MENU_COMMANDS = Object.freeze({
    selectAll: ["Edit/Select all", "Edit/Select All"],
    alwaysOnTop: ["View/Always on Top", "View/Always on top"],
    lockWindowSize: ["View/Lock Window Size", "View/Lock window size"],
    modeDark: ["View/Mode/Dark", "View/Colour mode/Dark", "View/Dark mode"],
    modeLight: ["View/Mode/Light", "View/Colour mode/Light", "View/Light mode"],
    statusBar: ["View/Show status bar", "View/Status Bar", "View/Status bar"],
    refacets: ["Library/ReFacets", "Library/Facets/ReFacets", "Library/Refresh facets"],
    search: ["Library/Search...", "View/Search...", "Edit/Search...", "File/Search..."],
    console: ["View/Console", "View/Console...", "File/Console"]
});

var BUILTIN_ACTIONS = Object.freeze([
    // RVG Top Bar utility actions. Keeping these as built-ins preserves the
    // Top Bar's fallback command lists and special toggle behaviour.
    { id: "select_all", label: "Select all" },
    { id: "toggle_always_on_top", label: "Toggle always on top" },
    { id: "toggle_lock_window_size", label: "Toggle window-size lock" },
    { id: "dark_mode", label: "Switch to dark mode" },
    { id: "light_mode", label: "Switch to light mode" },
    { id: "toggle_status_bar", label: "Show status bar" },
    { id: "toggle_stop_after_current", label: "Stop after current track" },
    { id: "toggle_stop_after_queue", label: "Stop after queue" },
    { id: "open_refacets", label: "Open ReFacets" },
    { id: "toggle_lastfm_loved", label: "Toggle Last.fm loved" },
    { id: "lastfm_tools_menu", label: "Last.fm tools menu" },

    // Menus. "Main menu" is the foobar2000 menu bar as a popup - what Top Bar's
    // hamburger button used to open. "Track context menu" is the ordinary
    // right-click menu for whatever the action targets.
    { id: "main_menu", label: "foobar2000 main menu" },
    { id: "context_menu", label: "Track context menu" },

    // Top Bar's fixed right-hand cluster, so a strip can replace it outright.
    { id: "library_search", label: "Search library" },
    { id: "toggle_settings_panel", label: "Show/hide SETTINGS panel" },
    { id: "toggle_mini_player", label: "Enter Mini Player" },

    // Opens the MusicBrainz.org release search for the target track's
    // %artist%/%title% in the default browser. The Tagging button's default
    // middle-click, but any button can pick it.
    { id: "musicbrainz_search", label: "Search MusicBrainz.org (artist + title)" },

    // General panel/playback actions.
    { id: "show_console", label: "Open console" },
    { id: "show_preferences", label: "Open preferences" },
    { id: "configure_panel", label: "Panel configuration" },
    { id: "edit_script", label: "Edit this script" },
    { id: "play_pause", label: "Play or pause" },
    { id: "stop", label: "Stop" },
    { id: "previous", label: "Previous track" },
    { id: "next", label: "Next track" },
    { id: "random", label: "Random track" },
    { id: "mute", label: "Mute or unmute" }
]);

// Generic helpers

// JSON.stringify leaves non-ASCII characters (glyphs above U+007F, mostly the
// Segoe Fluent Icons private-use-area codepoints button.glyph holds) as raw
// literal characters in its output - valid JSON, but invisible/unrenderable
// outside an icon font, and not guaranteed to survive every plain-text
// transport (a Win32 edit control, a clipboard manager, pasting into chat)
// unscathed. \uXXXX-escaping them keeps the text pure ASCII - still valid
// JSON (JSON.parse decodes \uXXXX natively, no dependency on this script's
// own decodeGlyphInput) - so it reads, copies and round-trips correctly
// anywhere. Used for both the persisted "Buttons JSON" property and the
// "Edit button data (JSON)\u2026" dialog text, so glyph data is never in
// doubt either way. See preferences-button-transfer.md in project memory for
// the investigation this came out of.
function jsonStringifyAscii(value, indent) {
    var text = JSON.stringify(value, null, indent);
    var out, i, code, hex;
    if (!text) return text;

    out = "";
    for (i = 0; i < text.length; i++) {
        code = text.charCodeAt(i);
        if (code <= 126) {
            out += text.charAt(i);
            continue;
        }
        // Escape every non-ASCII UTF-16 code unit individually (surrogate
        // pairs included) - JSON's \uXXXX escape operates at the code-unit
        // level, matching JS string internals exactly, so this is lossless.
        hex = code.toString(16);
        while (hex.length < 4) hex = "0" + hex;
        out += "\\u" + hex;
    }
    return out;
}

function clampNumber(value, minimum, maximum) {
    return RivageUI.clamp(Number(value), minimum, maximum);
}

function asInt(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? Math.round(n) : Math.round(Number(fallback) || 0);
}

function trimText(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function glyphFromCodePoint(codePoint) {
    var cp = Number(codePoint);
    if (!isFinite(cp) || cp < 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return "";
    if (cp <= 0xFFFF) return String.fromCharCode(cp);

    cp -= 0x10000;
    return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
}

function decodeGlyphInput(value) {
    var text = value == null ? "" : String(value);
    var exact;

    exact = /^\s*U\+([0-9A-Fa-f]{1,6})\s*$/i.exec(text);
    if (exact) return glyphFromCodePoint(parseInt(exact[1], 16));

    exact = /^\s*0x([0-9A-Fa-f]{1,6})\s*$/i.exec(text);
    if (exact) return glyphFromCodePoint(parseInt(exact[1], 16));

    text = text.replace(/\\u\{([0-9A-Fa-f]{1,6})\}/g, function (_, hex) {
        var decoded = glyphFromCodePoint(parseInt(hex, 16));
        return decoded || _;
    });
    text = text.replace(/\\u([0-9A-Fa-f]{4})/g, function (_, hex) {
        var decoded = glyphFromCodePoint(parseInt(hex, 16));
        return decoded || _;
    });
    text = text.replace(/\\x([0-9A-Fa-f]{2})/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return text;
}

function encodeGlyphInputSeed(value) {
    var text = value == null ? "" : String(value);
    var out = "";
    var i, code, hex;
    for (i = 0; i < text.length; i++) {
        code = text.charCodeAt(i);
        if (code >= 32 && code <= 126) {
            out += text.charAt(i);
            continue;
        }
        hex = code.toString(16).toUpperCase();
        while (hex.length < 4) hex = "0" + hex;
        out += "\\u" + hex;
    }
    return out;
}

function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
}

function normaliseMenuPath(value) {
    // Accept the visual form users naturally type after reading a native menu:
    // "Run service > Google Artist" -> "Run service/Google Artist".
    var text = trimText(value);
    text = text.replace(/\s*>\s*/g, "/");
    text = text.replace(/\/{2,}/g, "/");
    text = text.replace(/^\/+|\/+$/g, "");
    return text;
}

function makeId() {
    var random = Math.floor(Math.random() * 0x1000000).toString(16);
    var stamp = (Date.now() % 0x100000000).toString(16);
    return "btn_" + stamp + "_" + random;
}

function showPopup(message, title) {
    try {
        fb.ShowPopupMessage(String(message || ""), String(title || RivageUI.copy.popupTitle("Custom buttons")));
    } catch (e) { }
}

// InputBox is single-line; error_on_cancel=true is required so Cancel is distinguishable from accepting the seed.
function promptText(prompt, title, currentValue) {
    try {
        return utils.InputBox(
            window.ID,
            String(prompt || ""),
            String(title || RivageUI.copy.popupTitle("Custom buttons")),
            String(currentValue == null ? "" : currentValue),
            true
        );
    } catch (e) {
        return null;
    }
}

function shiftHeld() {
    try { return !!utils.IsKeyPressed(VK_SHIFT); } catch (e) { return false; }
}

function hostPropertiesComboHeld() {
    // Belt-and-braces: the host already bypasses on_mouse_rbtn_up entirely for
    // left Shift + left Windows key, but if a build ever routes the Windows-key
    // combo through the callback, returning false from it still yields to
    // JSplitter's own panel menu instead of eating the click.
    try {
        return !!utils.IsKeyPressed(VK_LWIN) || !!utils.IsKeyPressed(VK_RWIN);
    } catch (e) {
        return false;
    }
}

function safeConfigurePanel() {
    try {
        if (typeof window.ShowConfigureV2 === "function") window.ShowConfigureV2();
        else if (typeof window.ShowConfigure === "function") window.ShowConfigure();
    } catch (e) { }
}

function safeEditScript() {
    try {
        if (typeof window.EditScript === "function") window.EditScript();
        else safeConfigurePanel();
    } catch (e) { }
}

// Persistent data model

function emptyAction() {
    return { type: ACTION_NONE, command: "", builtin: "", target: TARGET_SELECTION_OR_CURRENT };
}

function contextAction(command, target) {
    return {
        type: ACTION_CONTEXT,
        command: normaliseMenuPath(command),
        builtin: "",
        target: normaliseTarget(target)
    };
}

function mainAction(command) {
    return {
        type: ACTION_MAIN,
        command: normaliseMenuPath(command),
        builtin: "",
        target: TARGET_SELECTION_OR_CURRENT
    };
}

function builtinAction(id) {
    return {
        type: ACTION_BUILTIN,
        command: "",
        builtin: String(id || ""),
        target: TARGET_SELECTION_OR_CURRENT
    };
}

function defaultButtons() {
    // Factory defaults mirror the customizable utility-button row from
    // topbar_panel.js, in the same left-to-right order. All remain ordinary
    // user-editable Custom Buttons after creation.
    return [
        {
            id: "select_all",
            name: "Select All",
            glyph: DEFAULT_GLYPHS.selectAll,
            glyphFont: "icons",
            tooltip: "Select all\nRight-click: Properties (selected files)",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("select_all"),
            middle: emptyAction(),
            right: contextAction(COMMANDS.properties, TARGET_SELECTION_OR_CURRENT)
        },
        {
            id: "always_on_top",
            name: "Always on Top",
            glyph: DEFAULT_GLYPHS.pin,
            glyphFont: "icons",
            tooltip: "Always on top",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_always_on_top"),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "lock_window_size",
            name: "Lock Window Size",
            glyph: DEFAULT_GLYPHS.lock,
            glyphFont: "icons",
            tooltip: "Lock window size",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_lock_window_size"),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "status_bar",
            name: "Status Bar",
            glyph: DEFAULT_GLYPHS.statusBar,
            glyphFont: "icons",
            tooltip: "Show/hide status bar",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_status_bar"),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "stop_after",
            name: "Stop After",
            glyph: DEFAULT_GLYPHS.timer,
            glyphFont: "icons",
            tooltip: "Stop after current track or queue",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_stop_after_current"),
            middle: emptyAction(),
            right: builtinAction("toggle_stop_after_queue")
        },
        {
            id: "refacets",
            name: "ReFacets",
            glyph: DEFAULT_GLYPHS.table,
            glyphFont: "icons",
            tooltip: "ReFacets",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("open_refacets"),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "love",
            name: "Love",
            glyph: DEFAULT_GLYPHS.heart,
            glyphFont: "icons",
            tooltip: "Love/unlove on Last.fm\nRight-click: Last.fm tools",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_lastfm_loved"),
            middle: emptyAction(),
            right: builtinAction("lastfm_tools_menu")
        },
        {
            id: "musicbrainz_tags",
            name: "MusicBrainz Tags",
            glyph: DEFAULT_GLYPHS.tag,
            glyphFont: "icons",
            tooltip: "Get tags from MusicBrainz (by artist & album)\nRight-click: by MB album ID\nMiddle-click: search MusicBrainz.org",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.musicBrainz, TARGET_SELECTION_OR_CURRENT),
            middle: builtinAction("musicbrainz_search"),
            right: contextAction(COMMANDS.musicBrainzByAlbumId, TARGET_SELECTION_OR_CURRENT)
        },
        {
            id: "convert",
            name: "Convert",
            glyph: DEFAULT_GLYPHS.convert,
            glyphFont: "icons",
            tooltip: "Convert to V0 and move to My Music\nRight-click: converter settings",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.convertToV0, TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: contextAction(COMMANDS.convertSettings, TARGET_SELECTION_OR_CURRENT)
        },
        {
            id: "move_to_music",
            name: "Move to My Music",
            glyph: DEFAULT_GLYPHS.move,
            glyphFont: "icons",
            tooltip: "Move to My Music",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.moveToMusic, TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "replaygain",
            name: "ReplayGain",
            glyph: DEFAULT_GLYPHS.equalizer,
            glyphFont: "icons",
            tooltip: "Scan ReplayGain values",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.replayGainAlbum, TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: contextAction(COMMANDS.replayGainTrack, TARGET_SELECTION_OR_CURRENT)
        },
        {
            id: "album_art",
            name: "Album artwork",
            glyph: DEFAULT_GLYPHS.albumArt,
            glyphFont: "icons",
            tooltip: "Download album artwork\nRight-click: remove embedded pictures",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.albumArtSearch, TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: contextAction(COMMANDS.removePictures, TARGET_SELECTION_OR_CURRENT)
        },
        {
            id: "folder",
            name: "Open Folder",
            glyph: DEFAULT_GLYPHS.folder,
            glyphFont: "icons",
            tooltip: "Open containing folder",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction(COMMANDS.openFolder, TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: emptyAction()
        },

        // Moved out of Top Bar's fixed right-hand cluster, which no longer has
        // them. They sit last so a strip docked to the right of Top Bar keeps
        // them roughly where they always were on screen.
        {
            id: "search",
            name: "Search",
            glyph: DEFAULT_GLYPHS.search,
            glyphFont: "icons",
            tooltip: "Search the library",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("library_search"),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "console",
            name: "Console",
            glyph: DEFAULT_GLYPHS.console,
            glyphFont: "icons",
            tooltip: "Open the foobar2000 Console",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("show_console"),
            middle: emptyAction(),
            right: emptyAction()
        },
        // Transferred from Top Bar's own permanently right-docked gear button
        // (topbar_panel.js's settingsToggleBtn) so a strip sharing the top row
        // carries this action by default too - see that panel's "Show
        // preferences button" setting, which can then be turned off there to
        // avoid showing it twice. Same dual left/right behaviour as the
        // original: left opens foobar2000 preferences, right toggles the
        // docked SETTINGS panel.
        {
            id: "preferences",
            name: "Preferences",
            glyph: DEFAULT_GLYPHS.settings,
            glyphFont: "icons",
            tooltip: "Preferences",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("show_preferences"),
            middle: emptyAction(),
            right: builtinAction("toggle_settings_panel")
        },
        {
            id: "mini_player",
            name: "Mini Player",
            glyph: DEFAULT_GLYPHS.miniPlayer,
            glyphFont: "icons",
            tooltip: "Enter Mini Player",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("toggle_mini_player"),
            middle: emptyAction(),
            right: emptyAction()
        }
    ];
}

// Exact v1.0/v1.1 sample set. If a user never edited those original four
// sample buttons, v1.2 upgrades that untouched sample layout to the new Top Bar
// defaults automatically. Any genuinely customized saved layout is preserved.
function legacySampleButtonsV1() {
    return [
        {
            id: "properties",
            name: "Properties",
            glyph: DEFAULT_GLYPHS.properties,
            glyphFont: "icons",
            tooltip: "",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction("Properties", TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "folder",
            name: "Folder",
            glyph: DEFAULT_GLYPHS.folder,
            glyphFont: "icons",
            tooltip: "Open containing folder",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction("Open containing folder", TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "google_artist",
            name: "Google Artist",
            glyph: DEFAULT_GLYPHS.google,
            glyphFont: "text",
            tooltip: "Search the current artist with Run service",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: contextAction("Run service/Google Artist", TARGET_SELECTION_OR_CURRENT),
            middle: emptyAction(),
            right: emptyAction()
        },
        {
            id: "console",
            name: "Console",
            glyph: DEFAULT_GLYPHS.console,
            glyphFont: "icons",
            tooltip: "Open foobar2000 Console",
            visible: true,
            width: 0,
            accentSource: BUTTON_ACCENT_PANEL,
            colour: null,
            left: builtinAction("show_console"),
            middle: emptyAction(),
            right: emptyAction()
        }
    ];
}

function normaliseTarget(value) {
    value = String(value || "");
    if (value === TARGET_SELECTION) return value;
    if (value === TARGET_NOW_PLAYING) return value;
    if (value === TARGET_FOCUSED) return value;
    if (value === TARGET_CURRENT) return value;
    return TARGET_SELECTION_OR_CURRENT;
}

function normaliseStyle(value) {
    value = String(value || "");
    if (value === STYLE_ACCENT || value === STYLE_OUTLINE ||
        value === STYLE_GHOST || value === STYLE_SWITCHER) return value;
    return STYLE_NORMAL;
}

// Hovered version of an arbitrary accent. Matches RivageUI.buttonVisual's own
// rule so a per-button custom colour hovers like the theme accent does.
function accentHoverColour(accent) {
    if (accent === theme.accent && theme.accentHover !== undefined) return theme.accentHover;
    return RivageUI.mix(accent, RivageUI.rgb(255, 255, 255), 0.16);
}

function normaliseButtonAccentSource(value, hasCustomColour) {
    value = String(value || "");
    if (value === BUTTON_ACCENT_SHARED || value === BUTTON_ACCENT_DEFAULT || value === BUTTON_ACCENT_CUSTOM) return value;
    if (value === BUTTON_ACCENT_PANEL) return value;

    // Backward compatibility: older saved buttons had only `colour`. A stored
    // colour meant custom; null meant follow the panel accent.
    return hasCustomColour ? BUTTON_ACCENT_CUSTOM : BUTTON_ACCENT_PANEL;
}

function normaliseAction(value) {
    var source = value && typeof value === "object" ? value : {};
    var type = String(source.type || ACTION_NONE);
    if (type !== ACTION_CONTEXT && type !== ACTION_MAIN && type !== ACTION_BUILTIN) type = ACTION_NONE;

    return {
        type: type,
        command: type === ACTION_CONTEXT || type === ACTION_MAIN ? normaliseMenuPath(source.command) : "",
        builtin: type === ACTION_BUILTIN ? trimText(source.builtin) : "",
        target: normaliseTarget(source.target)
    };
}

// Button style used to be per button. It is a panel-wide setting now (one
// strip wants one visual language), so a saved layout's most common style is
// adopted as the panel default the first time this version runs - see
// legacyButtonStyle() below - and the per-button field is then dropped.
function legacyButtonStyle() {
    var raw = readProperty("Buttons JSON", "");
    var counts = Object.create(null);
    var parsed, i, style, best = null, bestCount = 0;

    if (!raw) return null;
    try {
        parsed = JSON.parse(String(raw));
        if (!Array.isArray(parsed)) return null;
    } catch (e) {
        return null;
    }

    for (i = 0; i < parsed.length; i++) {
        style = normaliseStyle(parsed[i] && parsed[i].style);
        counts[style] = (counts[style] || 0) + 1;
        if (counts[style] > bestCount) {
            bestCount = counts[style];
            best = style;
        }
    }
    return best;
}

function normaliseButton(value, index) {
    var source = value && typeof value === "object" ? value : {};
    var colour = source.colour;
    var hasCustomColour = colour !== null && colour !== undefined && colour !== "";
    if (hasCustomColour) {
        colour = SharedAccentProtocol.opaque(Number(colour));
    } else {
        colour = null;
    }

    var accentSource = normaliseButtonAccentSource(source.accentSource, hasCustomColour);
    if (accentSource === BUTTON_ACCENT_CUSTOM && colour === null) {
        // A malformed/custom-edited config should still paint predictably.
        colour = DEFAULT_ACCENT;
    }

    return {
        id: trimText(source.id) || makeId(),
        name: trimText(source.name) || ("Button " + (index + 1)),
        glyph: decodeGlyphInput(source.glyph),
        glyphFont: source.glyphFont === "text" ? "text" : "icons",
        tooltip: source.tooltip == null ? "" : String(source.tooltip),
        visible: source.visible !== false,
        width: Math.max(0, Math.min(500, asInt(source.width, 0))),
        accentSource: accentSource,
        colour: colour,
        left: normaliseAction(source.left),
        middle: normaliseAction(source.middle),
        right: normaliseAction(source.right)
    };
}

function normaliseButtons(values) {
    var source = Array.isArray(values) ? values : [];
    var result = [];
    var ids = Object.create(null);
    var i, button, baseId, suffix;

    for (i = 0; i < source.length; i++) {
        button = normaliseButton(source[i], i);
        baseId = button.id;
        suffix = 2;
        while (ids[button.id]) {
            button.id = baseId + "_" + suffix;
            suffix++;
        }
        ids[button.id] = true;
        result.push(button);
    }
    return result;
}

function loadButtons() {
    var raw = readProperty("Buttons JSON", "");
    var parsed, normalised, legacyNormalised, defaults;
    if (!raw) return normaliseButtons(defaultButtons());
    try {
        parsed = JSON.parse(String(raw));
        if (!Array.isArray(parsed)) throw new Error("Expected an array");
        normalised = normaliseButtons(parsed);

        // Preserve user work, but transparently replace the untouched v1.0/v1.1
        // four-button sample set with the new factory set mirrored from Top Bar.
        legacyNormalised = normaliseButtons(legacySampleButtonsV1());
        if (JSON.stringify(normalised) === JSON.stringify(legacyNormalised)) {
            defaults = normaliseButtons(defaultButtons());
            window.SetProperty(PROPERTY_PREFIX + "Buttons JSON", jsonStringifyAscii(defaults));
            return defaults;
        }
        return normalised;
    } catch (e) {
        showPopup(
            "The saved custom-button configuration could not be parsed, so the default set was loaded.\n\n" +
            String(e.message || e),
            RivageUI.copy.popupTitle("Custom buttons")
        );
        return normaliseButtons(defaultButtons());
    }
}

var settings = {
    shareMode: normaliseShareMode(readProperty("Share mode", SHARE_MODE_SHARED)),
    panelName: String(readProperty("Panel name", "")),
    layoutSlot: normaliseLayoutSlot(readProperty("Layout slot", LAYOUT_SLOT_NONE)),
    stripVisible: readProperty("Strip visible", true) !== false,
    presentation: String(readProperty("Presentation", PRESENTATION_ICON_LABEL)),
    orientation: String(readProperty("Orientation", ORIENTATION_AUTO)),
    alignment: String(readProperty("Alignment", ALIGN_START)),
    buttonStyle: normaliseStyle(readProperty("Button style", legacyButtonStyle() || STYLE_NORMAL)),
    wrap: !!readProperty("Wrap", true),
    buttonHeight: asInt(readProperty("Button height", 34), 34),
    gap: asInt(readProperty("Gap", 5), 5),
    padding: asInt(readProperty("Padding", 6), 6),
    dimUnavailable: readProperty("Dim unavailable buttons", true) !== false,
    buttonBackgrounds: readProperty("Button backgrounds", true) !== false,
    buttonBorders: !!readProperty("Button borders", false),
    panelBackground: !!readProperty("Panel background", true),
    showTooltips: !!readProperty("Show tooltips", true),
    accentMode: String(readProperty("Accent mode", ACCENT_SHARED)),
    customAccent: SharedAccentProtocol.opaque(Number(readProperty("Custom accent", DEFAULT_ACCENT))),
    defaultTarget: normaliseTarget(readProperty("Default context target", TARGET_SELECTION_OR_CURRENT))
};

// Design = everything a "design settings per panel" instance keeps to itself.
// The button set and its default context target travel together as the
// panel's content, not its appearance.
var DESIGN_KEYS = Object.freeze([
    "presentation", "orientation", "alignment", "buttonStyle", "wrap",
    "buttonHeight", "gap", "padding", "dimUnavailable", "buttonBackgrounds", "buttonBorders", "panelBackground",
    "showTooltips", "accentMode", "customAccent"
]);

var DESIGN_PROPERTY_NAMES = Object.freeze({
    presentation: "Presentation",
    orientation: "Orientation",
    alignment: "Alignment",
    buttonStyle: "Button style",
    wrap: "Wrap",
    buttonHeight: "Button height",
    gap: "Gap",
    padding: "Padding",
    dimUnavailable: "Dim unavailable buttons",
    buttonBackgrounds: "Show button backgrounds",
    buttonBorders: "Show button borders",
    panelBackground: "Panel background",
    showTooltips: "Show tooltips",
    accentMode: "Accent mode",
    customAccent: "Custom accent"
});

var SETTING_PROPERTY_KEYS = Object.freeze({
    "Share mode": "shareMode",
    "Panel name": "panelName",
    "Layout slot": "layoutSlot",
    "Strip visible": "stripVisible",
    "Presentation": "presentation",
    "Orientation": "orientation",
    "Alignment": "alignment",
    "Button style": "buttonStyle",
    "Wrap": "wrap",
    "Button height": "buttonHeight",
    "Gap": "gap",
    "Padding": "padding",
    "Dim unavailable buttons": "dimUnavailable",
    "Show button backgrounds": "buttonBackgrounds",
    "Show button borders": "buttonBorders",
    "Panel background": "panelBackground",
    "Show tooltips": "showTooltips",
    "Accent mode": "accentMode",
    "Custom accent": "customAccent",
    "Default context target": "defaultTarget"
});

function copySettings(source) {
    var copy = {};
    var key;
    for (key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) copy[key] = source[key];
    }
    return copy;
}

function normaliseSettingsObject(target) {
    target.shareMode = normaliseShareMode(target.shareMode);
    target.panelName = String(target.panelName == null ? "" : target.panelName).slice(0, 48);
    target.layoutSlot = normaliseLayoutSlot(target.layoutSlot);
    target.stripVisible = target.stripVisible !== false;
    if (target.presentation !== PRESENTATION_ICON && target.presentation !== PRESENTATION_LABEL) {
        target.presentation = PRESENTATION_ICON_LABEL;
    }
    if (target.orientation !== ORIENTATION_HORIZONTAL && target.orientation !== ORIENTATION_VERTICAL) {
        target.orientation = ORIENTATION_AUTO;
    }
    if (target.alignment !== ALIGN_CENTER && target.alignment !== ALIGN_END) target.alignment = ALIGN_START;
    target.buttonStyle = normaliseStyle(target.buttonStyle);
    target.buttonBackgrounds = target.buttonBackgrounds !== false;
    target.dimUnavailable = target.dimUnavailable !== false;
    target.buttonHeight = Math.round(clampNumber(target.buttonHeight, 22, 72));
    target.gap = Math.round(clampNumber(target.gap, 0, 24));
    target.padding = Math.round(clampNumber(target.padding, 0, 30));
    if (target.accentMode !== ACCENT_DEFAULT && target.accentMode !== ACCENT_CUSTOM) target.accentMode = ACCENT_SHARED;
    target.customAccent = SharedAccentProtocol.opaque(target.customAccent);
    target.defaultTarget = normaliseTarget(target.defaultTarget);
    return target;
}

function normaliseSettings() {
    normaliseSettingsObject(settings);
}

normaliseSettings();
var buttons = loadButtons();
var committedSettings = copySettings(settings);
var committedButtons = cloneJson(buttons) || [];

function normalisedSettingValue(key, value) {
    var candidate = copySettings(settings);
    candidate[key] = value;
    normaliseSettingsObject(candidate);
    return candidate[key];
}

function persistPropertyWrites(writes) {
    var pending = [];
    var applied = [];
    var i, write, previous, j;

    for (i = 0; i < writes.length; i++) {
        write = writes[i];
        previous = window.GetProperty(write.name);
        if (previous === write.value) continue;
        pending.push({ name: write.name, value: write.value, previous: previous });
    }

    for (i = 0; i < pending.length; i++) {
        write = pending[i];
        applied.push(write);
        try {
            window.SetProperty(write.name, write.value);
        } catch (e) {
            for (j = applied.length - 1; j >= 0; j--) {
                try { window.SetProperty(applied[j].name, applied[j].previous); } catch (rollbackError) { }
            }
            throw e;
        }
    }
}

// Stateful-button status
//
// Active state is inferred from known built-in toggle actions. This keeps the
// feature zero-configuration for the Top-Bar-derived defaults while still
// allowing users to move those actions onto differently styled/custom buttons.
// Arbitrary context/main-menu commands remain stateless unless represented by
// one of these built-ins, because foobar does not expose a generic checked-state
// API for every possible component context command.

var buttonStateCache = {
    alwaysOnTop: false,
    lockWindowSize: false,
    statusBar: false,
    stopAfterCurrent: false,
    stopAfterQueue: false,
    loved: false
};
var buttonStatePollTimer = null;
var scriptActive = true;
var timeoutGeneration = 1;
var pendingTimeouts = [];

function removePendingTimeout(handle) {
    var i = pendingTimeouts.indexOf(handle);
    if (i >= 0) pendingTimeouts.splice(i, 1);
}

function schedulePanelTimeout(callback, delay) {
    var generation = timeoutGeneration;
    var handle = window.SetTimeout(function () {
        removePendingTimeout(handle);
        if (!scriptActive || generation !== timeoutGeneration) return;
        try { callback(); }
        catch (e) { reportFailure("deferred work threw", e); }
    }, delay);
    pendingTimeouts.push(handle);
    return handle;
}

function cancelPanelTimeouts() {
    var i;
    timeoutGeneration++;
    for (i = 0; i < pendingTimeouts.length; i++) {
        try { window.ClearTimeout(pendingTimeouts[i]); } catch (e) { }
    }
    pendingTimeouts = [];
}

function isStatefulBuiltinId(id) {
    return id === "toggle_always_on_top" ||
        id === "toggle_lock_window_size" ||
        id === "toggle_status_bar" ||
        id === "toggle_stop_after_current" ||
        id === "toggle_stop_after_queue" ||
        id === "toggle_lastfm_loved";
}

function buttonHasBuiltinAction(button, id) {
    if (!button) return false;
    return (button.left && button.left.type === ACTION_BUILTIN && button.left.builtin === id) ||
        (button.middle && button.middle.type === ACTION_BUILTIN && button.middle.builtin === id) ||
        (button.right && button.right.type === ACTION_BUILTIN && button.right.builtin === id);
}

function buttonHasStatefulAction(button) {
    if (!button) return false;
    return (button.left && button.left.type === ACTION_BUILTIN && isStatefulBuiltinId(button.left.builtin)) ||
        (button.middle && button.middle.type === ACTION_BUILTIN && isStatefulBuiltinId(button.middle.builtin)) ||
        (button.right && button.right.type === ACTION_BUILTIN && isStatefulBuiltinId(button.right.builtin));
}

function hasVisibleStatefulButtons() {
    var i;
    for (i = 0; i < buttons.length; i++) {
        if (buttons[i].visible && buttonHasStatefulAction(buttons[i])) return true;
    }
    return false;
}

function refreshButtonStateCache(repaintIfChanged) {
    var next = {
        alwaysOnTop: RivageCommands.isAnyMainMenuChecked(TOPBAR_MENU_COMMANDS.alwaysOnTop),
        lockWindowSize: RivageCommands.isAnyMainMenuChecked(TOPBAR_MENU_COMMANDS.lockWindowSize),
        statusBar: RivageCommands.isAnyMainMenuChecked(TOPBAR_MENU_COMMANDS.statusBar),
        stopAfterCurrent: RivageCommands.stopAfterCurrentIsChecked(),
        stopAfterQueue: RivageCommands.stopAfterQueueIsChecked(),
        loved: RivageCommands.evaluateLoved(currentContextHandle())
    };
    var changed = next.alwaysOnTop !== buttonStateCache.alwaysOnTop ||
        next.lockWindowSize !== buttonStateCache.lockWindowSize ||
        next.statusBar !== buttonStateCache.statusBar ||
        next.stopAfterCurrent !== buttonStateCache.stopAfterCurrent ||
        next.stopAfterQueue !== buttonStateCache.stopAfterQueue ||
        next.loved !== buttonStateCache.loved;

    buttonStateCache = next;
    if (changed && repaintIfChanged) window.Repaint();
    return changed;
}

function refreshButtonStateSoon() {
    refreshButtonStateCache(true);
    schedulePanelTimeout(function () { refreshButtonStateCache(true); }, 100);
    schedulePanelTimeout(function () { refreshButtonStateCache(true); }, 500);
}

function startButtonStatePolling() {
    if (buttonStatePollTimer !== null) return;
    buttonStatePollTimer = window.SetInterval(function () {
        try {
            if (!scriptActive) return;
            if (window.IsVisible === false) return;
            if (!hasVisibleStatefulButtons()) return;
            refreshButtonStateCache(true);
        } catch (e) { reportFailure("button-state polling threw", e); }
    }, 1000);
}

function buttonActiveState(button) {
    var hasCurrent = buttonHasBuiltinAction(button, "toggle_stop_after_current");
    var hasQueue = buttonHasBuiltinAction(button, "toggle_stop_after_queue");

    // A combined Stop After button reflects whichever of its configured modes
    // is globally active. A single-mode button only lights for that mode.
    if (hasCurrent || hasQueue) {
        if (hasCurrent && buttonStateCache.stopAfterCurrent) {
            return { supported: true, active: true, colour: STOP_AFTER_CURRENT_COLOUR, label: "Current track" };
        }
        if (hasQueue && buttonStateCache.stopAfterQueue) {
            return { supported: true, active: true, colour: STOP_AFTER_QUEUE_COLOUR, label: "Queue" };
        }
        return { supported: true, active: false, colour: null, label: "Off" };
    }

    if (buttonHasBuiltinAction(button, "toggle_always_on_top")) {
        return { supported: true, active: buttonStateCache.alwaysOnTop, colour: null, label: buttonStateCache.alwaysOnTop ? "On" : "Off" };
    }
    if (buttonHasBuiltinAction(button, "toggle_lock_window_size")) {
        return { supported: true, active: buttonStateCache.lockWindowSize, colour: null, label: buttonStateCache.lockWindowSize ? "Locked" : "Unlocked" };
    }
    if (buttonHasBuiltinAction(button, "toggle_status_bar")) {
        return { supported: true, active: buttonStateCache.statusBar, colour: null, label: buttonStateCache.statusBar ? "On" : "Off" };
    }
    if (buttonHasBuiltinAction(button, "toggle_lastfm_loved")) {
        return { supported: true, active: buttonStateCache.loved, colour: null, label: buttonStateCache.loved ? "Loved" : "Not loved" };
    }

    return { supported: false, active: false, colour: null, label: "" };
}

function displayGlyphForButton(button, activeState) {
    var glyph = button.glyph;
    if (!activeState || !activeState.supported) return glyph;

    // Only swap the factory icons when the user is still using those factory
    // glyphs. A user-entered text/code glyph always wins and is never replaced.
    if (button.id === "always_on_top" &&
        (glyph === DEFAULT_GLYPHS.pin || glyph === DEFAULT_GLYPHS.pinFill)) {
        return activeState.active ? DEFAULT_GLYPHS.pinFill : DEFAULT_GLYPHS.pin;
    }
    if (button.id === "lock_window_size" &&
        (glyph === DEFAULT_GLYPHS.lock || glyph === DEFAULT_GLYPHS.unlock)) {
        return activeState.active ? DEFAULT_GLYPHS.lock : DEFAULT_GLYPHS.unlock;
    }
    if (button.id === "love" &&
        (glyph === DEFAULT_GLYPHS.heart || glyph === DEFAULT_GLYPHS.heartFill)) {
        return activeState.active ? DEFAULT_GLYPHS.heartFill : DEFAULT_GLYPHS.heart;
    }
    return glyph;
}

function saveButtons() {
    var candidate = normaliseButtons(buttons);
    var encoded = jsonStringifyAscii(candidate);
    var committedEncoded = jsonStringifyAscii(committedButtons);

    if (encoded === committedEncoded) {
        buttons = candidate;
        return false;
    }

    try {
        persistPropertyWrites([{ name: PROPERTY_PREFIX + "Buttons JSON", value: encoded }]);
    } catch (e) {
        buttons = normaliseButtons(committedButtons);
        hoveredIndex = -1;
        pressedIndex = -1;
        layoutDirty = true;
        showPopup("Could not save the custom-button configuration.\n\n" + String(e.message || e));
        window.Repaint(true);
        return false;
    }

    buttons = candidate;
    committedButtons = cloneJson(candidate) || [];
    broadcastSharedState("buttons");
    broadcastMeasure(false);
    layoutDirty = true;
    window.Repaint(true);
    return true;
}

function isDesignPropertyName(name) {
    var key;
    for (key in DESIGN_PROPERTY_NAMES) {
        if (DESIGN_PROPERTY_NAMES[key] === name) return true;
    }
    return false;
}

function saveSetting(name, value) {
    var key = SETTING_PROPERTY_KEYS[name];
    if (!key) throw new Error("Unknown setting property: " + name);

    if (committedSettings[key] === value) {
        settings[key] = value;
        return false;
    }

    try {
        persistPropertyWrites([{ name: PROPERTY_PREFIX + name, value: value }]);
    } catch (e) {
        settings[key] = committedSettings[key];
        throw e;
    }

    settings[key] = value;
    committedSettings[key] = value;

    if (isDesignPropertyName(name)) {
        broadcastSharedState("design");
        broadcastMeasure(false);
    } else if (name === "Default context target") {
        broadcastSharedState("buttons");
    }
    return true;
}

// Cross-instance sharing

function collectDesignState() {
    var payload = {};
    var i, key;
    for (i = 0; i < DESIGN_KEYS.length; i++) {
        key = DESIGN_KEYS[i];
        payload[key] = settings[key];
    }
    return payload;
}

function applySharedPayload(payload) {
    var candidateSettings = copySettings(settings);
    var candidateButtons = buttons;
    var writes = [];
    var buttonsChanged = false;
    var targetChanged = false;
    var designChanged = false;
    var themeChanged = false;
    var fontsChanged = false;
    var i, key;

    if (sharesButtons() && payload.buttons !== undefined) {
        candidateButtons = normaliseButtons(payload.buttons);
        buttonsChanged = JSON.stringify(candidateButtons) !== JSON.stringify(buttons);
        if (buttonsChanged) {
            writes.push({ name: PROPERTY_PREFIX + "Buttons JSON", value: jsonStringifyAscii(candidateButtons) });
        }
        if (payload.defaultTarget !== undefined) {
            candidateSettings.defaultTarget = normaliseTarget(payload.defaultTarget);
            targetChanged = candidateSettings.defaultTarget !== settings.defaultTarget;
            if (targetChanged) {
                writes.push({ name: PROPERTY_PREFIX + "Default context target", value: candidateSettings.defaultTarget });
            }
        }
    }

    if (sharesDesign() && payload.design !== undefined) {
        for (i = 0; i < DESIGN_KEYS.length; i++) {
            key = DESIGN_KEYS[i];
            if (payload.design[key] !== undefined) candidateSettings[key] = payload.design[key];
        }
        normaliseSettingsObject(candidateSettings);
        for (i = 0; i < DESIGN_KEYS.length; i++) {
            key = DESIGN_KEYS[i];
            if (candidateSettings[key] === settings[key]) continue;
            designChanged = true;
            if (key === "accentMode" || key === "customAccent") themeChanged = true;
            if (key === "buttonHeight") fontsChanged = true;
            writes.push({ name: PROPERTY_PREFIX + DESIGN_PROPERTY_NAMES[key], value: candidateSettings[key] });
        }
    }

    if (!writes.length) return false;
    persistPropertyWrites(writes);

    if (buttonsChanged) {
        buttons = candidateButtons;
        committedButtons = cloneJson(candidateButtons) || [];
        hoveredIndex = -1;
        pressedIndex = -1;
    }
    if (targetChanged) {
        settings.defaultTarget = candidateSettings.defaultTarget;
        committedSettings.defaultTarget = candidateSettings.defaultTarget;
    }
    if (designChanged) {
        for (i = 0; i < DESIGN_KEYS.length; i++) {
            key = DESIGN_KEYS[i];
            settings[key] = candidateSettings[key];
            committedSettings[key] = candidateSettings[key];
        }
        if (themeChanged) rebuildTheme();
        if (fontsChanged) rebuildFonts();
        if (!settings.showTooltips) hideTooltip();
    }
    return buttonsChanged || targetChanged || designChanged;
}

// kind: "buttons", "design" or "all". Each part is only sent if this panel's
// share mode actually shares it.
function broadcastSharedState(kind) {
    var payload;

    if (applyingSharedState) return;
    if (kind === "buttons" && !sharesButtons()) return;
    if (kind === "design" && !sharesDesign()) return;
    if (kind === "all" && !sharesButtons() && !sharesDesign()) return;

    payload = { v: 1, origin: instanceId };
    if (kind !== "design" && sharesButtons()) {
        payload.buttons = buttons;
        payload.defaultTarget = settings.defaultTarget;
    }
    if (kind !== "buttons" && sharesDesign()) payload.design = collectDesignState();
    if (!payload.buttons && !payload.design) return;

    try {
        // Sent as JSON text: a plain object handed to NotifyOthers is only
        // valid inside the receiver's on_notify_data call, and a string
        // sidesteps that lifetime rule entirely.
        window.NotifyOthers(CUSTOM_BUTTONS_SYNC, JSON.stringify(payload));
    } catch (e) { reportFailure("shared button state could not be broadcast", e); }
}

function requestSharedState() {
    if (!sharesButtons() && !sharesDesign()) return;
    try { window.NotifyOthers(CUSTOM_BUTTONS_REQUEST, instanceId); }
    catch (e) { reportFailure("shared button state could not be requested", e); }
}

function consumeSharedState(name, info) {
    var payload = null;
    var changed = false;

    if (name === CUSTOM_BUTTONS_REQUEST) {
        // A sibling just loaded (or switched into a sharing mode) and wants
        // the current state. Answering is a normal broadcast, so every other
        // sharing panel converges on the same content too.
        if (String(info || "") !== instanceId) broadcastSharedState("all");
        return true;
    }

    if (name !== CUSTOM_BUTTONS_SYNC) return false;

    try {
        payload = JSON.parse(String(info || ""));
    } catch (e) {
        return true;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
    if (payload.v !== 1) return true;
    if (!/^[0-9a-z]{4,12}$/.test(String(payload.origin || ""))) return true;
    if (payload.origin === instanceId) return true;
    if (payload.buttons !== undefined && !Array.isArray(payload.buttons)) return true;
    if (payload.design !== undefined && (!payload.design || typeof payload.design !== "object" || Array.isArray(payload.design))) return true;
    if (payload.defaultTarget !== undefined && typeof payload.defaultTarget !== "string") return true;
    if (payload.buttons === undefined && payload.design === undefined) return true;

    applyingSharedState = true;
    try {
        changed = applySharedPayload(payload);
    } catch (e) {
        changed = false;
    }
    applyingSharedState = false;

    if (changed) {
        layoutDirty = true;
        broadcastMeasure(false);
        window.Repaint(true);
    }
    return true;
}

function setShareMode(value) {
    var next = normaliseShareMode(value);
    if (!saveSetting("Share mode", next)) return;

    // Switching into a sharing mode adopts whatever the siblings already have,
    // rather than silently pushing this panel's state over theirs.
    requestSharedState();
}

function shareModeLabel(value) {
    value = normaliseShareMode(value);
    if (value === SHARE_MODE_STANDALONE) return "This panel only";
    if (value === SHARE_MODE_BUTTONS) return "Buttons only; keep this panel\'s design";
    return "All Custom Buttons panels";
}

// Theme, fonts and geometry

var ww = 0;
var wh = 0;
var layoutDirty = true;
var initialSharedTheme = null;
try { initialSharedTheme = SharedThemeProtocol.current(); } catch (e) { initialSharedTheme = null; }
var sharedAlbumAccent = SharedAccentProtocol.opaque(
    initialSharedTheme && initialSharedTheme.accent !== undefined ? initialSharedTheme.accent : DEFAULT_ACCENT
);
var mouse = { x: -1, y: -1 };
var hoveredIndex = -1;
var pressedIndex = -1;

function adoptSharedAlbumAccent(value) {
    if (typeof value !== "number" || !isFinite(value)) return false;
    var next = SharedAccentProtocol.opaque(value);
    if (next === sharedAlbumAccent) return false;
    sharedAlbumAccent = next;
    return true;
}

var hostDpi = Math.max(0.5, Math.min(3, (Number(window.DPI) || 96) / 96));

function px(value) {
    if (Number(value) === 0) return 0;
    return Math.max(1, Math.round(Number(value) * hostDpi));
}

function currentAccent() {
    if (settings.accentMode === ACCENT_CUSTOM) return settings.customAccent;
    if (settings.accentMode === ACCENT_DEFAULT) return DEFAULT_ACCENT;
    return sharedAlbumAccent;
}

var theme = RivageUI.createTheme({ mode: "host", accent: currentAccent() });
var ui = RivageUI.createPainter({ scale: px, theme: theme });
var fonts = { body: null, icon: null, empty: null };
var fontRecoveryMeasurePending = false;

function rebuildTheme() {
    theme = RivageUI.createTheme({ mode: "host", accent: currentAccent() });
    ui.setTheme(theme);
}

function rebuildFonts() {
    var info = RivageUI.hostInfo();
    var family = info.fontFamily || "Segoe UI";
    var iconFamily = RivageUI.iconFontFamily();
    var height = Math.round(clampNumber(settings.buttonHeight, 22, 72));
    var bodySize = Math.max(9, Math.min(18, Math.round(height * 0.34)));
    var iconSize = Math.max(11, Math.min(26, Math.round(height * 0.47)));

    fonts.body = RivageUI.font(family, px(bodySize), 0);
    fonts.icon = RivageUI.font(iconFamily, px(iconSize), 0);
    fonts.empty = RivageUI.font(family, px(Math.max(10, Math.min(15, bodySize + 1))), 0);
}

function ensureFonts() {
    var missing = !fonts.body || !fonts.icon || !fonts.empty;
    if (!missing) return;
    rebuildFonts();
    if (fonts.body && fonts.icon && fonts.empty) {
        layoutDirty = true;
        fontRecoveryMeasurePending = true;
    }
}

function refreshHostMetrics() {
    hostDpi = Math.max(0.5, Math.min(3, (Number(window.DPI) || 96) / 96));
    rebuildTheme();
    rebuildFonts();
    layoutDirty = true;
}

var layoutEntries = [];

function effectiveOrientation() {
    if (settings.orientation === ORIENTATION_HORIZONTAL || settings.orientation === ORIENTATION_VERTICAL) {
        return settings.orientation;
    }
    return ww >= wh ? ORIENTATION_HORIZONTAL : ORIENTATION_VERTICAL;
}

function visibleButtonIndexes() {
    var result = [];
    var i;
    for (i = 0; i < buttons.length; i++) if (buttons[i].visible) result.push(i);
    return result;
}

function naturalButtonWidth(button) {
    var h = px(settings.buttonHeight);
    var p = settings.presentation;
    var width, labelWidth, iconSpace;

    ensureFonts();
    if (button.width > 0) return px(button.width);
    if (p === PRESENTATION_ICON) return h;

    labelWidth = Math.ceil(RivageUI.measureText(button.name, fonts.body, true));
    iconSpace = p === PRESENTATION_ICON_LABEL && button.glyph ? Math.round(h * 0.74) : 0;
    width = labelWidth + iconSpace + px(18);
    return Math.max(h, Math.min(px(240), width));
}

function alignOffset(available, used) {
    var free = Math.max(0, available - used);
    if (settings.alignment === ALIGN_CENTER) return Math.floor(free / 2);
    if (settings.alignment === ALIGN_END) return free;
    return 0;
}

function layoutHorizontal(indexes, innerX, innerY, innerW, innerH) {
    var gap = px(settings.gap);
    var rows = [];
    var current = [];
    var used = 0;
    var rowH = px(settings.buttonHeight);
    var i, index, w;

    for (i = 0; i < indexes.length; i++) {
        index = indexes[i];
        w = naturalButtonWidth(buttons[index]);
        if (settings.wrap && current.length && used + gap + w > innerW) {
            rows.push({ items: current, used: used });
            current = [];
            used = 0;
        }
        if (current.length) used += gap;
        current.push({ index: index, w: Math.min(innerW, w) });
        used += Math.min(innerW, w);
    }
    if (current.length) rows.push({ items: current, used: used });

    var totalH = rows.length ? rows.length * rowH + (rows.length - 1) * gap : 0;
    var y = innerY + alignOffset(innerH, totalH);
    var r, row, x, item;

    // In horizontal mode alignment controls the primary axis (x). Vertical
    // placement is centred when there is spare room so a one-row strip looks
    // balanced in a slightly taller host slot.
    if (rows.length === 1 && totalH < innerH) y = innerY + Math.floor((innerH - totalH) / 2);

    for (r = 0; r < rows.length; r++) {
        row = rows[r];
        x = innerX + alignOffset(innerW, row.used);
        for (i = 0; i < row.items.length; i++) {
            item = row.items[i];
            layoutEntries.push({
                buttonIndex: item.index,
                rect: RivageUI.rect(x, y, item.w, Math.min(rowH, innerH))
            });
            x += item.w + gap;
        }
        y += rowH + gap;
    }
}

function layoutVertical(indexes, innerX, innerY, innerW, innerH) {
    var gap = px(settings.gap);
    var buttonH = px(settings.buttonHeight);
    var columns = [];
    var current = [];
    var used = 0;
    var i, index, w;

    for (i = 0; i < indexes.length; i++) {
        index = indexes[i];
        w = naturalButtonWidth(buttons[index]);
        if (settings.wrap && current.length && used + gap + buttonH > innerH) {
            columns.push({ items: current, used: used });
            current = [];
            used = 0;
        }
        if (current.length) used += gap;
        current.push({ index: index, w: w });
        used += buttonH;
    }
    if (current.length) columns.push({ items: current, used: used });

    var columnWidths = [];
    var totalW = 0;
    var c, column, maxW, x, y, entry;
    for (c = 0; c < columns.length; c++) {
        maxW = 0;
        for (i = 0; i < columns[c].items.length; i++) maxW = Math.max(maxW, columns[c].items[i].w);
        maxW = Math.min(innerW, Math.max(buttonH, maxW));
        columnWidths[c] = maxW;
        totalW += maxW;
        if (c) totalW += gap;
    }

    x = innerX + alignOffset(innerW, totalW);
    for (c = 0; c < columns.length; c++) {
        column = columns[c];
        y = innerY + alignOffset(innerH, column.used);
        for (i = 0; i < column.items.length; i++) {
            entry = column.items[i];
            layoutEntries.push({
                buttonIndex: entry.index,
                rect: RivageUI.rect(x, y, columnWidths[c], Math.min(buttonH, innerH))
            });
            y += buttonH + gap;
        }
        x += columnWidths[c] + gap;
    }
}

function layoutButtons() {
    layoutEntries = [];
    layoutDirty = false;
    if (ww <= 0 || wh <= 0) return;

    var pad = px(settings.padding);
    var innerX = Math.min(pad, Math.max(0, ww - 1));
    var innerY = Math.min(pad, Math.max(0, wh - 1));
    var innerW = Math.max(1, ww - innerX - Math.min(pad, Math.max(0, ww - innerX - 1)));
    var innerH = Math.max(1, wh - innerY - Math.min(pad, Math.max(0, wh - innerY - 1)));
    var indexes = visibleButtonIndexes();

    if (!indexes.length) return;
    if (effectiveOrientation() === ORIENTATION_VERTICAL) layoutVertical(indexes, innerX, innerY, innerW, innerH);
    else layoutHorizontal(indexes, innerX, innerY, innerW, innerH);
}

function hitEntry(x, y) {
    var i;
    if (layoutDirty) layoutButtons();
    for (i = 0; i < layoutEntries.length; i++) {
        if (RivageUI.pointInRect(x, y, layoutEntries[i].rect)) return layoutEntries[i];
    }
    return null;
}

// Content measurement (published to a layout host - see "Layout slots" above)

// Natural size of the button strip laid out on a single row (horizontal) or a
// single column (vertical), in device pixels, including the panel padding.
// A host only ever consumes the axis it reserves; the other one is advisory.
function measureContent() {
    var indexes = visibleButtonIndexes();
    var padding = px(settings.padding) * 2;
    var gap = px(settings.gap);
    var buttonH = px(settings.buttonHeight);
    var vertical = effectiveOrientation() === ORIENTATION_VERTICAL;
    var total = 0;
    var widest = 0;
    var i, width;

    if (!indexes.length) return { w: 0, h: 0 };

    for (i = 0; i < indexes.length; i++) {
        width = naturalButtonWidth(buttons[indexes[i]]);
        total += width + (i ? gap : 0);
        if (width > widest) widest = width;
    }

    if (vertical) {
        return {
            w: widest + padding,
            h: indexes.length * buttonH + (indexes.length - 1) * gap + padding
        };
    }
    return { w: total + padding, h: buttonH + padding };
}

var lastPublishedMeasure = "";

function broadcastMeasure(force) {
    var size, payload, encoded;

    if (settings.layoutSlot === LAYOUT_SLOT_NONE) return;

    size = settings.stripVisible ? measureContent() : { w: 0, h: 0 };
    payload = {
        v: 1,
        slot: settings.layoutSlot,
        origin: instanceId,
        enabled: !!settings.stripVisible,
        orientation: effectiveOrientation(),
        w: Math.max(0, Math.round(size.w)),
        h: Math.max(0, Math.round(size.h))
    };
    encoded = JSON.stringify(payload);

    // The host resizes this panel in response, which fires on_size, which
    // measures again. Publishing only on an actual change keeps that from
    // becoming a feedback loop.
    if (!force && encoded === lastPublishedMeasure) return;
    lastPublishedMeasure = encoded;

    try { window.NotifyOthers(CUSTOM_BUTTONS_MEASURE, encoded); }
    catch (e) {
        // The parent splitter sizes this strip from the measurement; without it
        // the row keeps its persisted fallback width indefinitely.
        reportFailure("the strip width measurement could not be published", e);
    }
}

function consumeMeasureRequest(name, info) {
    var wanted;
    if (name !== CUSTOM_BUTTONS_MEASURE_REQUEST) return false;

    // A host that loaded (or reloaded) after this panel asks for the current
    // size. An empty slot in the request means "any".
    wanted = normaliseLayoutSlot(info === undefined || info === null ? "" : String(info));
    if (String(info || "") !== "" && wanted !== settings.layoutSlot) return true;
    broadcastMeasure(true);
    return true;
}

function setLayoutSlot(value) {
    var previous = settings.layoutSlot;
    var next = normaliseLayoutSlot(value);
    if (!saveSetting("Layout slot", next)) return;

    // Release the previous host: without a final zero it would keep reserving
    // space for a strip that no longer answers to it.
    if (previous !== LAYOUT_SLOT_NONE && previous !== settings.layoutSlot) {
        try {
            window.NotifyOthers(CUSTOM_BUTTONS_MEASURE, JSON.stringify({
                v: 1, slot: previous, origin: instanceId, enabled: false, w: 0, h: 0
            }));
        } catch (e) { reportFailure("the vacated slot could not be released", e); }
    }

    broadcastMeasure(true);
}

function setStripVisible(value) {
    if (!saveSetting("Strip visible", !!value)) return;
    broadcastMeasure(true);
}

function buttonAccent(button) {
    var source = normaliseButtonAccentSource(button && button.accentSource, button && button.colour != null);
    if (source === BUTTON_ACCENT_SHARED) return sharedAlbumAccent;
    if (source === BUTTON_ACCENT_DEFAULT) return DEFAULT_ACCENT;
    if (source === BUTTON_ACCENT_CUSTOM && button && button.colour != null) {
        return SharedAccentProtocol.opaque(button.colour);
    }
    return currentAccent();
}

// Availability is memoised only for a paint/click pass because target resolution queries the host.

var availabilityCache = null;

function beginAvailabilityPass() {
    availabilityCache = { targets: Object.create(null), playing: null, loved: null };
}

function endAvailabilityPass() {
    availabilityCache = null;
}

function hasTargetForAction(target) {
    var key, items;

    target = normaliseTarget(target);
    key = String(target);
    if (availabilityCache && availabilityCache.targets[key] !== undefined) {
        return availabilityCache.targets[key];
    }

    items = getContextTargetHandles(target);
    var result = !!(items && items.Count > 0);
    if (availabilityCache) availabilityCache.targets[key] = result;
    return result;
}

function playbackIsActive() {
    if (availabilityCache && availabilityCache.playing !== null) return availabilityCache.playing;
    var result = false;
    try { result = !!fb.IsPlaying || !!fb.IsPaused; } catch (e) { result = false; }
    if (availabilityCache) availabilityCache.playing = result;
    return result;
}

function hasLovedTarget() {
    if (availabilityCache && availabilityCache.loved !== null) return availabilityCache.loved;
    var result = false;
    try { result = !!RivageCommands.getLastfmActionHandle(currentContextHandle()); } catch (e) { result = false; }
    if (availabilityCache) availabilityCache.loved = result;
    return result;
}

// Built-ins that depend on something being there to act on. Everything not
// listed is always available (panel/window toggles, preferences, console...).
function builtinIsAvailable(id) {
    switch (id) {
    case "toggle_lastfm_loved":
        return hasLovedTarget();
    case "previous":
    case "next":
    case "stop":
        return playbackIsActive();
    case "context_menu":
        return hasTargetForAction(settings.defaultTarget);
    }
    return true;
}

function actionIsAvailable(action) {
    if (!action || typeof action !== "object") return true;
    if (action.type === ACTION_NONE) return true;
    if (action.type === ACTION_CONTEXT) return !!action.command && hasTargetForAction(action.target);
    if (action.type === ACTION_BUILTIN) return builtinIsAvailable(action.builtin);
    return true;
}

// A button follows its left-click action, which is what a plain click runs. A
// button with no left action but a bound middle/right one stays live so those
// remain reachable.
function buttonIsAvailable(button) {
    if (!button) return true;
    if (button.left && button.left.type !== ACTION_NONE) return actionIsAvailable(button.left);

    var hasAlternate = false;
    if (button.middle && button.middle.type !== ACTION_NONE) {
        hasAlternate = true;
        if (actionIsAvailable(button.middle)) return true;
    }
    if (button.right && button.right.type !== ACTION_NONE) {
        hasAlternate = true;
        if (actionIsAvailable(button.right)) return true;
    }
    return !hasAlternate;
}

function actionDependsOnTrackContext(action) {
    return !!action && (
        action.type === ACTION_CONTEXT ||
        (action.type === ACTION_BUILTIN && (action.builtin === "context_menu" || action.builtin === "toggle_lastfm_loved"))
    );
}

function hasVisibleTrackContextButtons() {
    var i, button;
    for (i = 0; i < buttons.length; i++) {
        button = buttons[i];
        if (!button.visible) continue;
        if (actionDependsOnTrackContext(button.left) || actionDependsOnTrackContext(button.middle) || actionDependsOnTrackContext(button.right)) return true;
    }
    return false;
}

function refreshForTrackContextChange() {
    var changed = false;
    if (hasVisibleStatefulButtons()) changed = refreshButtonStateCache(false);
    if (changed || (settings.dimUnavailable && hasVisibleTrackContextButtons())) window.Repaint();
}

// Availability of a single action outside a paint pass, for click guards.
function actionAvailableNow(action) {
    if (!settings.dimUnavailable) return true;
    beginAvailabilityPass();
    try {
        return actionIsAvailable(action);
    } finally {
        endAvailabilityPass();
    }
}

// Square 1 px frame, drawn as four edges rather than DrawRoundRect with a zero
// radius - the same shape controls_panel.js's rail buttons use.
function drawSquareBorder(gr, rect, colour) {
    var edge = Math.max(1, px(1));
    if (rect.w <= 0 || rect.h <= 0) return;
    gr.FillSolidRect(rect.x, rect.y, rect.w, edge, colour);
    gr.FillSolidRect(rect.x, rect.y + Math.max(0, rect.h - edge), rect.w, edge, colour);
    gr.FillSolidRect(rect.x, rect.y, edge, rect.h, colour);
    gr.FillSolidRect(rect.x + Math.max(0, rect.w - edge), rect.y, edge, rect.h, colour);
}

function drawButton(gr, entry) {
    ensureFonts();
    var button = buttons[entry.buttonIndex];
    var rect = entry.rect;
    var hovered = entry.buttonIndex === hoveredIndex;
    var pressed = entry.buttonIndex === pressedIndex;
    var style = settings.buttonStyle;
    var accent = buttonAccent(button);
    var activeState = buttonActiveState(button);
    var visualAccent = activeState.active && activeState.colour !== null ? activeState.colour : accent;
    var glyph = displayGlyphForButton(button, activeState);
    var enabled = !settings.dimUnavailable || buttonIsAvailable(button);
    var state = {
        enabled: enabled,
        hovered: hovered && enabled,
        pressed: pressed && enabled,
        selected: style === STYLE_OUTLINE || activeState.active
    };
    var options = {
        base: theme.surface,
        accent: visualAccent,
        primary: style === STYLE_ACCENT
    };
    var radius = RivageUI.metrics.radius.button;
    var interactive = (hovered || pressed) && enabled || activeState.active;
    var visual;
    var iconColour;

    if (style === STYLE_SWITCHER) {
        // The navigation-rail look of controls_panel.js's side buttons: a
        // tinted fill plus an accent indicator along one edge - down the
        // leading edge in a vertical strip, along the bottom in a row.
        //
        // RivageUI.selector() deliberately paints nothing while a button is at
        // rest (its fill equals the base it sits on), so the resting surface
        // and the frame are drawn here, honouring the panel's own Button
        // backgrounds / Button borders switches. controls_panel.js does the
        // same with its elementBackgrounds / elementBorders settings.
        if (settings.buttonBackgrounds) {
            gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, theme.navigationSurface);
        }

        visual = ui.selector(gr, rect, state, {
            base: theme.navigationSurface,
            accent: visualAccent,
            indicatorEdge: effectiveOrientation() === ORIENTATION_VERTICAL ? "left" : "bottom",
            indicatorActive: activeState.active
        });
        iconColour = activeState.active && activeState.colour !== null ? activeState.colour : visual.icon;

        if (settings.buttonBorders) drawSquareBorder(gr, rect, theme.stroke);
    } else if (style === STYLE_GHOST) {
        // Deliberately identical to topbar_panel.js's drawIconButton: a 10%
        // accent-tinted rounded fill on hover only, no border, no bottom
        // indicator, and an accent-tinted glyph when the action is active.
        // Nothing else - that flat look is the whole point of Ghost.
        var ghostTint = accentHoverColour(accent);
        if ((hovered || pressed) && enabled) {
            ui.fillRoundRect(gr, rect, px(3), RivageUI.mix(theme.background, ghostTint, pressed ? 0.16 : 0.10));
        }
        iconColour = !enabled
            ? theme.textDisabled
            : (hovered ? ghostTint : (activeState.active ? visualAccent : theme.textTertiary));

        // Ghost is borderless by definition, but an explicit Button borders
        // switch still wins over the style's own preference.
        if (settings.buttonBorders) ui.drawRoundRect(gr, rect, radius, 1, theme.stroke);
    } else {
        visual = RivageUI.buttonVisual(theme, state, options);
        iconColour = visual.icon;

        // Accent and Outline are defined by their fill/stroke, so they always
        // paint one. Normal follows the Button backgrounds switch and, with it
        // off, only shows a surface while hovered, pressed or active.
        if (settings.buttonBackgrounds || style === STYLE_ACCENT || style === STYLE_OUTLINE || interactive) {
            ui.fillRoundRect(gr, rect, radius, visual.fill);
        }
        if (settings.buttonBorders || style === STYLE_OUTLINE || activeState.active) {
            ui.drawRoundRect(gr, rect, radius, 1, visual.stroke);
        }

        // Active state stays obvious for Accent and Outline too: a compact
        // indicator along the lower edge in the active colour.
        if (activeState.active) {
            var indicatorH = Math.max(2, px(2));
            var indicatorW = Math.max(px(10), Math.round(rect.w * 0.34));
            gr.FillSolidRect(
                rect.x + Math.round((rect.w - indicatorW) / 2),
                rect.y + rect.h - indicatorH,
                indicatorW,
                indicatorH,
                visualAccent
            );
        }
    }

    var presentation = settings.presentation;
    var hasGlyph = presentation !== PRESENTATION_LABEL && !!glyph;
    var hasLabel = presentation !== PRESENTATION_ICON && !!button.name;
    var contentPad = px(9);
    var iconW = hasGlyph ? Math.min(rect.h, px(settings.buttonHeight)) : 0;
    var iconFont = button.glyphFont === "text" ? fonts.body : fonts.icon;
    var textX;

    if (hasGlyph && hasLabel) {
        gr.GdiDrawText(
            glyph,
            iconFont,
            iconColour,
            rect.x + contentPad,
            rect.y,
            Math.max(1, iconW - contentPad),
            rect.h,
            RivageUI.textFlags.centered
        );
        textX = rect.x + iconW;
        gr.GdiDrawText(
            button.name,
            fonts.body,
            iconColour,
            textX,
            rect.y,
            Math.max(1, rect.w - (textX - rect.x) - contentPad),
            rect.h,
            RivageUI.textFlags.leftCenteredEllipsis
        );
    } else if (hasGlyph) {
        gr.GdiDrawText(glyph, iconFont, iconColour, rect.x, rect.y, rect.w, rect.h, RivageUI.textFlags.centered);
    } else if (hasLabel) {
        gr.GdiDrawText(button.name, fonts.body, iconColour, rect.x + contentPad, rect.y, Math.max(1, rect.w - contentPad * 2), rect.h, RivageUI.textFlags.centeredEllipsis);
    }
}

function actionSummary(action) {
    action = normaliseAction(action);
    if (action.type === ACTION_CONTEXT) return action.command ? ("Context: " + action.command) : "Context: not configured";
    if (action.type === ACTION_MAIN) return action.command ? ("Main menu: " + action.command) : "Main menu: not configured";
    if (action.type === ACTION_BUILTIN) return "Built-in: " + builtinLabel(action.builtin);
    return "None";
}

// Button tooltips - window.Tooltip, a real Windows common-control tooltip, the
// same one topbar_panel.js uses (see samples\basic\Tooltip.js).
//
// This panel used to hand-draw its tooltip inside on_paint, which clipped it to
// the panel's own client rect. That is fatal here: a Custom Buttons strip is
// routinely a few dozen pixels tall or wide, so a multi-line tooltip listing the
// bound actions had nowhere to go. window.Tooltip is a genuine top-level OS
// popup, so it spills outside the panel and needs no positioning, clipping or
// repaint logic of our own.

var TTDT_INITIAL = 3;
var TOOLTIP_DELAY_MS = 500;
var TOOLTIP_MAX_WIDTH = 420;

var tooltipObject = null;
var tooltipReady = false;
var tooltipStatus = "not initialised yet";
var tooltipIndex = -1;
var tooltipErrorLogged = false;

function describeError(e) {
    return String((e && (e.message || e.description)) || e || "unknown error");
}

function noteTooltipFailure(message) {
    tooltipStatus = message;
    if (tooltipErrorLogged) return;
    tooltipErrorLogged = true;
    reportFailure("tooltip unavailable - " + message);
}

function applyTooltipFont() {
    // Native button tooltips follow foobar2000's Console font, exactly as
    // topbar_panel.js does. An unset font is one of the ways the popup can end
    // up invisible, so this is not purely cosmetic.
    if (!tooltipObject) return;
    try {
        var info = RivageUI.consoleFontInfo();
        tooltipObject.SetFont(info.fontFamily, info.fontSize, info.fontStyle || 0);
    } catch (e) { }
}

// Resolved lazily and re-tried on each hover rather than once at script load:
// a single failing setup call must not disable tooltips for the whole session,
// and window.Tooltip is not guaranteed to be usable at load time.
function getTooltip() {
    if (tooltipReady) return tooltipObject;

    try {
        tooltipObject = window.Tooltip;
    } catch (e) {
        noteTooltipFailure("window.Tooltip threw: " + describeError(e));
        return null;
    }
    if (!tooltipObject) {
        noteTooltipFailure("window.Tooltip returned nothing");
        return null;
    }

    tooltipStatus = "ready";

    // Each setup step is optional: losing the delay or the multi-line width is
    // far better than losing tooltips entirely.
    try {
        tooltipObject.SetDelayTime(TTDT_INITIAL, TOOLTIP_DELAY_MS);
    } catch (e) {
        tooltipStatus = "SetDelayTime failed: " + describeError(e);
    }
    try {
        // Also what makes "\n" a line separator; these tooltips are several
        // lines (name, state, and each bound click action).
        tooltipObject.SetMaxWidth(TOOLTIP_MAX_WIDTH);
    } catch (e) {
        tooltipStatus = "SetMaxWidth failed: " + describeError(e);
    }
    applyTooltipFont();

    tooltipReady = true;
    return tooltipObject;
}

// Only touches the tooltip when the target or its text actually changed - the
// docs for Activate() warn that re-activating unchanged text makes it flicker.
function showTooltipFor(index) {
    var tip, text;

    if (!settings.showTooltips || index < 0 || index >= buttons.length) {
        hideTooltip();
        return;
    }

    tip = getTooltip();
    if (!tip) return;

    text = tooltipForButton(buttons[index]);
    if (!text) {
        hideTooltip();
        return;
    }

    try {
        if (index === tooltipIndex) {
            if (tip.Text !== text) tip.Text = text;
            return;
        }
        if (tip.Text !== text) tip.Text = text;
        tip.Activate();
        tooltipIndex = index;
    } catch (e) {
        noteTooltipFailure("Activate failed: " + describeError(e));
    }
}

function hideTooltip() {
    if (!tooltipObject || tooltipIndex < 0) return;
    tooltipIndex = -1;
    try { tooltipObject.Deactivate(); } catch (e) { }
}

function tooltipStatusText() {
    if (!settings.showTooltips) return "Off";
    if (!tooltipReady) return "Not started yet (" + tooltipStatus + ")";
    return tooltipStatus === "ready" ? "Native Windows tooltip, ready" : tooltipStatus;
}

function tooltipForButton(button) {
    var lines = [];
    var activeState = buttonActiveState(button);
    if (button.tooltip) lines.push(button.tooltip);
    else lines.push(button.name);

    if (activeState.supported) lines.push("State: " + activeState.label);
    if (settings.dimUnavailable && !buttonIsAvailable(button)) {
        lines.push("Unavailable for the current selection");
    }
    if (button.left.type !== ACTION_NONE) lines.push("Left: " + actionSummary(button.left));
    if (button.middle.type !== ACTION_NONE) lines.push("Middle: " + actionSummary(button.middle));
    if (button.right.type !== ACTION_NONE) lines.push("Right: " + actionSummary(button.right));
    lines.push("Shift+right-click: edit");
    return lines.join("\n");
}

function paintEmptyState(gr) {
    ensureFonts();
    var text = "Right-click the empty panel to add or manage custom buttons";
    gr.GdiDrawText(
        text,
        fonts.empty,
        theme.textMuted,
        px(12),
        px(8),
        Math.max(1, ww - px(24)),
        Math.max(1, wh - px(16)),
        RivageUI.textFlags.wordBreakCentered
    );
}

function on_paint(gr) {
    ensureFonts();
    if (layoutDirty) layoutButtons();
    if (settings.panelBackground) gr.FillSolidRect(0, 0, ww, wh, theme.background);

    if (!layoutEntries.length) paintEmptyState(gr);
    else {
        var i;
        beginAvailabilityPass();
        try {
            for (i = 0; i < layoutEntries.length; i++) drawButton(gr, layoutEntries[i]);
        } finally {
            endAvailabilityPass();
        }
    }
    if (fontRecoveryMeasurePending) {
        fontRecoveryMeasurePending = false;
        broadcastMeasure(false);
    }
}

// Target resolution and action execution

function emptyHandleList() {
    try { return new FbMetadbHandleList(); } catch (e) { return null; }
}

function listFromHandle(handle) {
    try { return handle ? new FbMetadbHandleList(handle) : emptyHandleList(); } catch (e) { return emptyHandleList(); }
}

function focusedHandle() {
    try { return fb.GetFocusItem(true); } catch (e) {
        try { return fb.GetFocusItem(); } catch (e2) { return null; }
    }
}

function nowPlayingHandle() {
    try { return fb.GetNowPlaying(); } catch (e) { return null; }
}

function currentContextHandle() {
    try { return TrackContext.getHandle(TrackContext.MODE_GLOBAL); } catch (e) {
        return nowPlayingHandle() || focusedHandle();
    }
}

function getContextTargetHandles(target) {
    target = normaliseTarget(target);
    var selected;

    if (target === TARGET_SELECTION) return RivageCommands.getSelectedPlaylistHandles();
    if (target === TARGET_NOW_PLAYING) return listFromHandle(nowPlayingHandle());
    if (target === TARGET_FOCUSED) return listFromHandle(focusedHandle());
    if (target === TARGET_CURRENT) return listFromHandle(currentContextHandle());

    selected = RivageCommands.getSelectedPlaylistHandles();
    if (selected && selected.Count > 0) return selected;
    return listFromHandle(currentContextHandle());
}

function targetLabel(target) {
    target = normaliseTarget(target);
    if (target === TARGET_SELECTION) return "Selected playlist items";
    if (target === TARGET_NOW_PLAYING) return "Now playing";
    if (target === TARGET_FOCUSED) return "Focused item";
    if (target === TARGET_CURRENT) return "Current panel track";
    return "Selection, otherwise current track";
}

// Same query+type=release+method=indexed search MusicBrainz.org's own site
// search form uses. See discography_and_calendar.js for the same
// utils.Run(url) pattern against musicbrainz.org (that panel searches by
// artist alone; this one is artist+title for the Tagging button).
function musicBrainzSearchUrl(artist, title) {
    var query = (String(artist || "") + " " + String(title || "")).replace(/\s+/g, " ").trim();
    return "https://musicbrainz.org/search?query=" + encodeURIComponent(query) + "&type=release&method=indexed";
}

function runMusicBrainzSearch(options) {
    var items = getContextTargetHandles(TARGET_SELECTION_OR_CURRENT);
    // FbMetadbHandleList has no .Item() in this component - elements are
    // reached with a plain array accessor (docs/html/FbMetadbHandleList.html).
    var handle = items && items.Count > 0 ? items[0] : null;
    var artist = "", title = "";

    if (!handle) {
        if (!options || !options.silent) showPopup("No track is available to search MusicBrainz for.");
        return false;
    }

    try { artist = fb.TitleFormat("%artist%").EvalWithMetadb(handle); }
    catch (e) { reportFailure("%artist% could not be read for the MusicBrainz search", e); }
    try { title = fb.TitleFormat("%title%").EvalWithMetadb(handle); }
    catch (e) { reportFailure("%title% could not be read for the MusicBrainz search", e); }

    if (!trimText(artist) && !trimText(title)) {
        if (!options || !options.silent) showPopup("This track has no %artist%/%title% tags to search MusicBrainz with.");
        return false;
    }

    try {
        utils.Run(musicBrainzSearchUrl(artist, title));
        return true;
    } catch (e) {
        if (!options || !options.silent) showPopup("Could not open the MusicBrainz search page.\n\n" + String(e.message || e));
        return false;
    }
}

function runTopbarMain(candidates, label) {
    return RivageCommands.runFirstMain(candidates, label, { panelTitle: RivageUI.copy.popupTitle("Custom buttons") });
}

function showLastfmToolsMenu(x, y) {
    var menu = window.CreatePopupMenu();
    var picked, loved;
    var canCheck = hasLovedTarget();
    menu.AppendMenuItem(MF_STRING, 1, "Last.fm account and authorisation\u2026");
    menu.AppendMenuItem(MF_STRING, 2, "Import Last.fm loved tracks");
    menu.AppendMenuItem(MF_STRING, 3, "Show loved tracks");
    menu.AppendMenuItem(canCheck ? MF_STRING : (MF_GRAYED | MF_DISABLED), 4, "Refresh loved status");

    picked = menu.TrackPopupMenu(Math.max(0, asInt(x, mouse.x)), Math.max(0, asInt(y, mouse.y)));
    switch (picked) {
    case 1:
        RivageCommands.openLastfmPreferences({ panelTitle: RivageUI.copy.popupTitle("Custom buttons") });
        return true;
    case 2:
        return RivageCommands.importLastfmLovedTracks({ panelTitle: RivageUI.copy.popupTitle("Custom buttons") });
    case 3:
        return RivageCommands.showLovedTracks();
    case 4:
        if (!canCheck) return false;
        loved = RivageCommands.evaluateLoved(currentContextHandle());
        showPopup(loved ? "Current track is loved on Last.fm." : "Current track is not marked loved on Last.fm.");
        return true;
    }
    return false;
}

// The foobar2000 menu bar rebuilt as a popup: one MainMenuManager per top-level
// menu, each given its own ID range, plus the now-playing context menu below a
// separator. Ported from topbar_panel.js's hamburger button, which this
// replaces. Command IDs must not overlap between managers, hence the ranges.
function showFoobarMainMenu(x, y) {
    var base = window.CreatePopupMenu();
    var child = [];
    var manager = [];
    var contextManager = null;
    var names = ["File", "Edit", "View", "Playback", "Library", "Help"];
    var keys = ["file", "edit", "view", "playback", "library", "help"];
    var starts = [1, 201, 401, 601, 901, 1201];
    var counts = [200, 200, 200, 300, 300, 100];
    var contextStart = 1301;
    var picked, i;

    try {
        for (i = 0; i < names.length; i++) {
            child[i] = window.CreatePopupMenu();
            manager[i] = fb.CreateMainMenuManager();
            child[i].AppendTo(base, MF_STRING, names[i]);
            manager[i].Init(keys[i]);
            manager[i].BuildMenu(child[i], starts[i], counts[i]);
        }

        child[names.length] = window.CreatePopupMenu();
        base.AppendMenuSeparator();
        child[names.length].AppendTo(base, MF_STRING, "Now Playing");
        contextManager = fb.CreateContextMenuManager();
        contextManager.InitNowPlaying();
        contextManager.BuildMenu(child[names.length], contextStart);

        picked = base.TrackPopupMenu(Math.max(0, asInt(x, mouse.x)), Math.max(0, asInt(y, mouse.y)));
        if (picked < 1) return false;

        for (i = names.length - 1; i >= 0; i--) {
            if (picked >= starts[i] && picked < starts[i] + counts[i]) {
                manager[i].ExecuteByID(picked - starts[i]);
                return true;
            }
        }
        if (picked >= contextStart) {
            contextManager.ExecuteByID(picked - contextStart);
            return true;
        }
    } catch (e) {
        showPopup("Could not build the foobar2000 main menu.\n\n" + String(e.message || e));
    }
    return false;
}

function builtinLabel(id) {
    var i;
    for (i = 0; i < BUILTIN_ACTIONS.length; i++) if (BUILTIN_ACTIONS[i].id === id) return BUILTIN_ACTIONS[i].label;
    return id || "Unknown";
}

function executeBuiltin(id, options) {
    options = options || {};
    try {
        switch (id) {
        case "select_all":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.selectAll, "Select all");
        case "toggle_always_on_top":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.alwaysOnTop, "Always on top");
        case "toggle_lock_window_size":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.lockWindowSize, "Lock window size");
        case "dark_mode":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.modeDark, "Dark mode");
        case "light_mode":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.modeLight, "Light mode");
        case "toggle_status_bar":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.statusBar, "Status bar");
        case "toggle_stop_after_current":
            return RivageCommands.toggleStopAfterCurrent({ panelTitle: RivageUI.copy.popupTitle("Custom buttons"), reportMissing: true });
        case "toggle_stop_after_queue":
            return RivageCommands.toggleStopAfterQueue({ panelTitle: RivageUI.copy.popupTitle("Custom buttons"), reportMissing: true });
        case "open_refacets":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.refacets, "ReFacets");
        case "toggle_lastfm_loved":
            var lovedResult = RivageCommands.toggleLoved(currentContextHandle(), { panelTitle: RivageUI.copy.popupTitle("Custom buttons") });
            if (lovedResult.ok) {
                buttonStateCache.loved = lovedResult.loved;
                window.Repaint();
                schedulePanelTimeout(function () { refreshButtonStateCache(true); }, 500);
            }
            return lovedResult.ok;
        case "lastfm_tools_menu":
            return showLastfmToolsMenu(options.x, options.y);
        case "main_menu":
            // Popped below the button when the caller knows its rectangle, the
            // way a menu bar behaves; otherwise at the pointer.
            if (options.rect) return showFoobarMainMenu(options.rect.x, options.rect.y + options.rect.h);
            return showFoobarMainMenu(options.x, options.y);
        case "context_menu":
            if (options.rect) return browseNativeContextMenu(options.rect.x, options.rect.y + options.rect.h, settings.defaultTarget);
            return browseNativeContextMenu(asInt(options.x, mouse.x), asInt(options.y, mouse.y), settings.defaultTarget);
        case "library_search":
            return runTopbarMain(TOPBAR_MENU_COMMANDS.search, "Search");
        case "musicbrainz_search":
            return runMusicBrainzSearch(options);
        case "toggle_settings_panel":
            // Same request Top Bar's gear button makes. window.GetPanel()/Show()
            // only reach panels in the caller's own splitter branch, so the
            // actual show/hide is done by whichever script includes
            // shared/panel_visibility_host.js in the SETTINGS panel's branch.
            try {
                window.NotifyOthers(TOGGLE_PANEL_VISIBILITY, { caption: SETTINGS_PANEL_CAPTION });
                return true;
            } catch (e) {
                return false;
            }
        case "toggle_mini_player":
            // splitters/root_splitter.js is the only consumer - it owns the
            // panel tree and the main window's geometry, so there is nothing
            // to request/acknowledge here, just ask it to shrink down.
            try {
                MiniPlayerProtocol.requestEnter();
                return true;
            } catch (e) {
                return false;
            }
        case "show_console":
            if (typeof fb.ShowConsole === "function") fb.ShowConsole();
            else return runTopbarMain(TOPBAR_MENU_COMMANDS.console, "Console");
            return true;
        case "show_preferences":
            fb.ShowPreferences();
            return true;
        case "configure_panel":
            safeConfigurePanel();
            return true;
        case "edit_script":
            safeEditScript();
            return true;
        case "play_pause":
            fb.PlayOrPause();
            return true;
        case "stop":
            fb.Stop();
            return true;
        case "previous":
            fb.Prev();
            return true;
        case "next":
            fb.Next();
            return true;
        case "random":
            fb.Random();
            return true;
        case "mute":
            fb.VolumeMute();
            return true;
        }
    } catch (e) {
        showPopup("The built-in action failed.\n\n" + builtinLabel(id) + "\n\n" + String(e.message || e));
        return false;
    }
    showPopup("Unknown built-in action: " + String(id || ""));
    return false;
}

function executeAction(action, options) {
    action = normaliseAction(action);
    options = options || {};
    var ok = false;
    var items;

    if (action.type === ACTION_NONE) return false;

    if (action.type === ACTION_CONTEXT) {
        if (!action.command) {
            if (!options.silent) showPopup("This context action has no command path yet.");
            return false;
        }
        items = getContextTargetHandles(action.target);
        if (!items || !items.Count) {
            if (!options.silent) showPopup("No track is available for this context command.\n\nTarget: " + targetLabel(action.target));
            return false;
        }
        ok = RivageCommands.runContextWithHandles(action.command, items, {
            flags: DEFAULT_CONTEXT_FLAGS,
            panelTitle: RivageUI.copy.popupTitle("Custom buttons")
        });
        if (!ok && !options.silent) {
            showPopup(
                "foobar2000 did not report this context command as executed:\n\n" + action.command +
                "\n\nCheck the exact path in the native context menu. Paths use / between submenu levels, for example:\nRun service/Google Artist"
            );
        }
        return ok;
    }

    if (action.type === ACTION_MAIN) {
        if (!action.command) {
            if (!options.silent) showPopup("This main-menu action has no command path yet.");
            return false;
        }
        ok = RivageCommands.runMain(action.command, { panelTitle: RivageUI.copy.popupTitle("Custom buttons") });
        if (!ok && !options.silent) {
            showPopup("foobar2000 did not report this main-menu command as executed:\n\n" + action.command);
        }
        return ok;
    }

    if (action.type === ACTION_BUILTIN) {
        ok = executeBuiltin(action.builtin, options);
        if (isStatefulBuiltinId(action.builtin) && action.builtin !== "toggle_lastfm_loved") refreshButtonStateSoon();
        return ok;
    }
    return false;
}

// Native browsing is test-only because SMP does not expose a stable textual path for the picked item.
function browseNativeContextMenu(x, y, target) {
    var items = getContextTargetHandles(target || settings.defaultTarget);
    if (!items || !items.Count) {
        showPopup("No track is available for the native context menu.\n\nTarget: " + targetLabel(target || settings.defaultTarget));
        return false;
    }

    var manager = null;
    var menu = null;
    var picked = 0;
    try {
        manager = fb.CreateContextMenuManager();
        manager.InitContext(items);
        menu = window.CreatePopupMenu();
        manager.BuildMenu(menu, 1, 10000);
        picked = menu.TrackPopupMenu(Math.max(0, x), Math.max(0, y));
        if (picked >= 1) {
            manager.ExecuteByID(picked - 1);
            return true;
        }
    } catch (e) {
        showPopup("Could not build the native context menu.\n\n" + String(e.message || e));
    }
    return false;
}

// Menu router

function MenuRouter(startId) {
    this.nextId = startId || 1;
    this.handlers = Object.create(null);
}

MenuRouter.prototype.item = function (menu, label, handler, flags) {
    var id = this.nextId++;
    menu.AppendMenuItem(flags === undefined ? MF_STRING : flags, id, String(label));
    if (typeof handler === "function") this.handlers[id] = handler;
    return id;
};

MenuRouter.prototype.run = function (id) {
    if (this.handlers[id]) {
        this.handlers[id]();
        return true;
    }
    return false;
};

function appendRadioChoice(router, menu, current, value, label, callback) {
    router.item(menu, label, function () { callback(value); }, MF_STRING | (current === value ? MF_CHECKED : 0));
}

// Button editing

function makeNewButton(name) {
    return normaliseButton({
        id: makeId(),
        name: trimText(name) || "New Button",
        glyph: DEFAULT_GLYPHS.plus,
        glyphFont: "icons",
        tooltip: "",
        visible: true,
        width: 0,
        accentSource: BUTTON_ACCENT_PANEL,
        colour: null,
        left: emptyAction(),
        middle: emptyAction(),
        right: emptyAction()
    }, buttons.length);
}

function addButtonFlow() {
    var name = promptText("Button name:", "Add custom button", "New Button");
    if (name === null) return;
    var button = makeNewButton(name);
    buttons.push(button);
    if (!saveButtons()) return;
    showButtonEditor(buttons.length - 1, Math.max(0, mouse.x), Math.max(0, mouse.y));
}

function addContextButtonFlow() {
    var name = promptText("Button name:", "Add foobar2000 command button", "Google Artist");
    if (name === null) return;
    var command = promptText(
        "Context-menu command path. Use / between submenu levels.\n\nExample: Run service/Google Artist\nYou may also type: Run service > Google Artist",
        "Context command",
        "Run service/Google Artist"
    );
    if (command === null) return;

    var button = makeNewButton(name);
    button.glyph = trimText(name).charAt(0).toUpperCase() || DEFAULT_GLYPHS.plus;
    button.glyphFont = "text";
    button.left = contextAction(command, settings.defaultTarget);
    buttons.push(button);
    saveButtons();
}

function editButtonName(index) {
    var button = buttons[index];
    var value = promptText("Button name:", "Edit button", button.name);
    if (value === null) return;
    value = trimText(value);
    if (!value) return;
    button.name = value;
    saveButtons();
}

function editButtonGlyph(index) {
    var button = buttons[index];
    var value = promptText(
        "Button glyph/text. Enter a literal character/text OR a Unicode code.\n\n" +
        "Examples:\n" +
        "  \u2605\n" +
        "  G\n" +
        "  \\uE726\n" +
        "  U+E726\n" +
        "  0xE726\n\n" +
        "\\uXXXX / U+XXXX / 0xXXXX are converted to the actual glyph. " +
        "Use the 'Glyph font' menu to switch between Fluent and MDL2 icons and Core: Default text.",
        "Edit button glyph",
        encodeGlyphInputSeed(button.glyph)
    );
    if (value === null) return;
    button.glyph = decodeGlyphInput(value);
    saveButtons();
}

function editButtonTooltip(index) {
    var button = buttons[index];
    var value = promptText(
        "Custom tooltip. Leave empty to use the button name plus its configured click actions.",
        "Edit button tooltip",
        button.tooltip
    );
    if (value === null) return;
    button.tooltip = String(value);
    saveButtons();
}

function editButtonWidth(index) {
    var button = buttons[index];
    var value = promptText(
        "Button width at 96 DPI. Enter 0 for automatic width.\nRange: 0-500.",
        "Button width",
        String(button.width)
    );
    if (value === null) return;
    value = Number(value);
    if (!isFinite(value)) return;
    button.width = Math.max(0, Math.min(500, Math.round(value)));
    saveButtons();
}

function editButtonColour(index) {
    var button = buttons[index];
    var seed = buttonAccent(button);
    try {
        var picked = utils.ColourPicker(window.ID, seed);
        if (typeof picked !== "number") return;
        button.colour = SharedAccentProtocol.opaque(picked);
        button.accentSource = BUTTON_ACCENT_CUSTOM;
        saveButtons();
    } catch (e) { reportFailure("the chosen button colour could not be applied", e); }
}

function setActionNone(index, clickName) {
    buttons[index][clickName] = emptyAction();
    saveButtons();
}

function setContextActionFlow(index, clickName) {
    var current = normaliseAction(buttons[index][clickName]);
    var seed = current.type === ACTION_CONTEXT && current.command ? current.command : "Run service/Google Artist";
    var value = promptText(
        "Context-menu command path. Use / between submenu levels.\n\nExample: Run service/Google Artist\nYou may also type: Run service > Google Artist",
        "Context command",
        seed
    );
    if (value === null) return;
    value = normaliseMenuPath(value);
    if (!value) return;
    buttons[index][clickName] = contextAction(value, current.type === ACTION_CONTEXT ? current.target : settings.defaultTarget);
    saveButtons();
}

function setMainActionFlow(index, clickName) {
    var current = normaliseAction(buttons[index][clickName]);
    var seed = current.type === ACTION_MAIN ? current.command : "";
    var value = promptText(
        "foobar2000 main-menu command path. Use / between menu levels.\n\nExample: View/Console",
        "Main-menu command",
        seed
    );
    if (value === null) return;
    value = normaliseMenuPath(value);
    if (!value) return;
    buttons[index][clickName] = mainAction(value);
    saveButtons();
}

function setBuiltinAction(index, clickName, builtinId) {
    buttons[index][clickName] = builtinAction(builtinId);
    saveButtons();
}

function setActionTarget(index, clickName, target) {
    var action = normaliseAction(buttons[index][clickName]);
    if (action.type !== ACTION_CONTEXT) return;
    action.target = normaliseTarget(target);
    buttons[index][clickName] = action;
    saveButtons();
}

function moveButton(index, delta) {
    var next = index + delta;
    if (next < 0 || next >= buttons.length) return;
    var temp = buttons[index];
    buttons[index] = buttons[next];
    buttons[next] = temp;
    saveButtons();
}

function duplicateButton(index) {
    var copy = cloneJson(buttons[index]);
    if (!copy) return;
    copy.id = makeId();
    copy.name = copy.name + " copy";
    buttons.splice(index + 1, 0, normaliseButton(copy, index + 1));
    saveButtons();
}

function deleteButton(index) {
    if (index < 0 || index >= buttons.length) return;
    buttons.splice(index, 1);
    hoveredIndex = -1;
    pressedIndex = -1;
    saveButtons();
}

function confirmDeleteButton(index, x, y) {
    var button = buttons[index];
    var menu = window.CreatePopupMenu();
    menu.AppendMenuItem(MF_STRING, 1, "Delete '" + button.name + "'");
    menu.AppendMenuItem(MF_STRING, 2, "Cancel");
    if (menu.TrackPopupMenu(x, y) === 1) deleteButton(index);
}

function appendTargetSubmenu(router, parentMenu, index, clickName) {
    var action = normaliseAction(buttons[index][clickName]);
    var submenu = window.CreatePopupMenu();
    var current = action.target;
    appendRadioChoice(router, submenu, current, TARGET_SELECTION_OR_CURRENT, "Selection, otherwise current track", function (value) { setActionTarget(index, clickName, value); });
    appendRadioChoice(router, submenu, current, TARGET_SELECTION, "Selected playlist items", function (value) { setActionTarget(index, clickName, value); });
    appendRadioChoice(router, submenu, current, TARGET_NOW_PLAYING, "Now playing", function (value) { setActionTarget(index, clickName, value); });
    appendRadioChoice(router, submenu, current, TARGET_FOCUSED, "Focused item", function (value) { setActionTarget(index, clickName, value); });
    appendRadioChoice(router, submenu, current, TARGET_CURRENT, "Current panel track", function (value) { setActionTarget(index, clickName, value); });
    submenu.AppendTo(parentMenu, MF_STRING, "Context target: " + targetLabel(current));
}

function appendBuiltinSubmenu(router, parentMenu, index, clickName, current) {
    var submenu = window.CreatePopupMenu();
    var i, item;
    for (i = 0; i < BUILTIN_ACTIONS.length; i++) {
        item = BUILTIN_ACTIONS[i];
        (function (builtinId, label) {
            router.item(submenu, label, function () { setBuiltinAction(index, clickName, builtinId); }, MF_STRING | (current.type === ACTION_BUILTIN && current.builtin === builtinId ? MF_CHECKED : 0));
        }(item.id, item.label));
    }
    submenu.AppendTo(parentMenu, MF_STRING, "Built-in action");
}

function appendActionEditor(router, parentMenu, index, clickName, label, x, y) {
    var submenu = window.CreatePopupMenu();
    var action = normaliseAction(buttons[index][clickName]);

    router.item(submenu, "Current: " + actionSummary(action), null, MF_GRAYED | MF_DISABLED);
    submenu.AppendMenuSeparator();
    router.item(submenu, "No action", function () { setActionNone(index, clickName); }, MF_STRING | (action.type === ACTION_NONE ? MF_CHECKED : 0));
    router.item(submenu, "Context-menu command\u2026", function () { setContextActionFlow(index, clickName); }, MF_STRING | (action.type === ACTION_CONTEXT ? MF_CHECKED : 0));
    router.item(submenu, "Main-menu command\u2026", function () { setMainActionFlow(index, clickName); }, MF_STRING | (action.type === ACTION_MAIN ? MF_CHECKED : 0));
    appendBuiltinSubmenu(router, submenu, index, clickName, action);

    if (action.type === ACTION_CONTEXT) {
        submenu.AppendMenuSeparator();
        appendTargetSubmenu(router, submenu, index, clickName);
        router.item(submenu, "Choose from track context menu\u2026", function () { browseNativeContextMenu(x, y, action.target); });
    }

    if (action.type !== ACTION_NONE) {
        submenu.AppendMenuSeparator();
        router.item(submenu, "Test this action", function () { executeAction(buttons[index][clickName], { x: x, y: y }); });
    }

    submenu.AppendTo(parentMenu, MF_STRING, label + ": " + actionSummary(action));
}

function showButtonEditor(index, x, y) {
    if (index < 0 || index >= buttons.length) return;
    hideTooltip();
    var button = buttons[index];
    var root = window.CreatePopupMenu();
    var router = new MenuRouter(1);

    router.item(root, "Edit button: " + button.name, null, MF_GRAYED | MF_DISABLED);
    root.AppendMenuSeparator();

    router.item(root, "Show button", function () {
        button.visible = !button.visible;
        saveButtons();
    }, MF_STRING | (button.visible ? MF_CHECKED : 0));
    router.item(root, "Button name\u2026", function () { editButtonName(index); });
    router.item(root, "Icon or glyph\u2026", function () { editButtonGlyph(index); });

    var glyphFontMenu = window.CreatePopupMenu();
    appendRadioChoice(router, glyphFontMenu, button.glyphFont, "icons", "Fluent and MDL2 icons", function (value) { button.glyphFont = value; saveButtons(); });
    appendRadioChoice(router, glyphFontMenu, button.glyphFont, "text", "Core: Default text font", function (value) { button.glyphFont = value; saveButtons(); });
    glyphFontMenu.AppendTo(root, MF_STRING, "Glyph font");

    router.item(root, "Tooltip\u2026", function () { editButtonTooltip(index); });
    router.item(root, "Width\u2026 (" + (button.width ? button.width + " px" : "automatic") + ")", function () { editButtonWidth(index); });

    var colourMenu = window.CreatePopupMenu();
    var buttonAccentSource = normaliseButtonAccentSource(button.accentSource, button.colour != null);
    router.item(colourMenu, "Use panel accent", function () {
        button.accentSource = BUTTON_ACCENT_PANEL;
        saveButtons();
    }, MF_STRING | (buttonAccentSource === BUTTON_ACCENT_PANEL ? MF_CHECKED : 0));
    router.item(colourMenu, "Use shared accent", function () {
        button.accentSource = BUTTON_ACCENT_SHARED;
        saveButtons();
        SharedAccentProtocol.requestAccent();
    }, MF_STRING | (buttonAccentSource === BUTTON_ACCENT_SHARED ? MF_CHECKED : 0));
    router.item(colourMenu, RivageUI.copy.labels.rvgBlue, function () {
        button.accentSource = BUTTON_ACCENT_DEFAULT;
        saveButtons();
    }, MF_STRING | (buttonAccentSource === BUTTON_ACCENT_DEFAULT ? MF_CHECKED : 0));
    colourMenu.AppendMenuSeparator();
    router.item(colourMenu, "Custom colour\u2026", function () { editButtonColour(index); }, MF_STRING | (buttonAccentSource === BUTTON_ACCENT_CUSTOM ? MF_CHECKED : 0));
    colourMenu.AppendTo(root, MF_STRING, "Accent colour");

    root.AppendMenuSeparator();
    appendActionEditor(router, root, index, "left", "Left-click action", x, y);
    appendActionEditor(router, root, index, "middle", "Middle-click action", x, y);
    appendActionEditor(router, root, index, "right", "Right-click action", x, y);

    root.AppendMenuSeparator();
    router.item(root, "Move earlier", function () { moveButton(index, -1); }, index > 0 ? MF_STRING : MF_GRAYED | MF_DISABLED);
    router.item(root, "Move later", function () { moveButton(index, 1); }, index < buttons.length - 1 ? MF_STRING : MF_GRAYED | MF_DISABLED);
    router.item(root, "Duplicate button", function () { duplicateButton(index); });
    router.item(root, "Delete button\u2026", function () { confirmDeleteButton(index, x, y); });

    var picked = root.TrackPopupMenu(x, y);
    router.run(picked);
}

// Raw JSON editor / recovery

function editRawButtonsJson() {
    var value = promptText(
        "Advanced button configuration. Edit the JSON array carefully.\n\nFields include name, glyph, glyphFont, tooltip, visible, width, accentSource, colour and left/middle/right action objects.\n\nGlyphs show as \\uXXXX escapes here (not the literal icon character) so they display and copy reliably through this text box - JSON.parse accepts that notation natively, so pasting it back unmodified round-trips correctly. To set a glyph by hand, typing \\uXXXX / U+XXXX / 0xXXXX also works in each button's own \"Edit glyph...\" field.",
        "Custom buttons JSON",
        jsonStringifyAscii(buttons, 2)
    );
    if (value === null) return;
    try {
        var parsed = JSON.parse(String(value));
        if (!Array.isArray(parsed)) throw new Error("The root value must be a JSON array.");
        buttons = normaliseButtons(parsed);
        saveButtons();
    } catch (e) {
        showPopup("The JSON was not saved because it is invalid.\n\n" + String(e.message || e));
    }
}

function resetButtonsToDefaults(x, y) {
    var menu = window.CreatePopupMenu();
    menu.AppendMenuItem(MF_STRING, 1, "Reset all buttons to defaults");
    menu.AppendMenuItem(MF_STRING, 2, "Cancel");
    if (menu.TrackPopupMenu(x, y) !== 1) return;
    buttons = normaliseButtons(defaultButtons());
    saveButtons();
}

function resetButtonsFromSettings() {
    var value = promptText(
        "Type RESET to replace every configured button with the default set.",
        "Reset custom buttons",
        ""
    );
    if (value === null || trimText(value).toUpperCase() !== "RESET") return;
    buttons = normaliseButtons(defaultButtons());
    saveButtons();
}

// Panel menu and layout settings

function setPresentation(value) {
    var next = normalisedSettingValue("presentation", value);
    if (!saveSetting("Presentation", next)) return;
    layoutDirty = true;
    window.Repaint(true);
}

function setOrientation(value) {
    var next = normalisedSettingValue("orientation", value);
    if (!saveSetting("Orientation", next)) return;
    layoutDirty = true;
    window.Repaint(true);
}

function setAlignment(value) {
    var next = normalisedSettingValue("alignment", value);
    if (!saveSetting("Alignment", next)) return;
    layoutDirty = true;
    window.Repaint(true);
}

function setButtonStyle(value) {
    var next = normaliseStyle(value);
    if (!saveSetting("Button style", next)) return;
    window.Repaint(true);
}

function styleLabel(value) {
    value = normaliseStyle(value);
    if (value === STYLE_ACCENT) return "Accent fill";
    if (value === STYLE_OUTLINE) return "Accent outline";
    if (value === STYLE_GHOST) return "Ghost / flat";
    if (value === STYLE_SWITCHER) return "Tab style";
    return "Normal";
}

function setDefaultTarget(value) {
    var next = normaliseTarget(value);
    if (!saveSetting("Default context target", next)) return;
    refreshForTrackContextChange();
}

function showPanelMenu(x, y) {
    hideTooltip();
    var root = window.CreatePopupMenu();
    var router = new MenuRouter(1);

    router.item(root, "Add button\u2026", addButtonFlow);
    router.item(root, "Add foobar2000 command button\u2026", addContextButtonFlow);

    if (buttons.length) {
        var manage = window.CreatePopupMenu();
        var i;
        for (i = 0; i < buttons.length; i++) {
            (function (index) {
                router.item(manage, (buttons[index].visible ? "" : "[hidden] ") + buttons[index].name, function () { showButtonEditor(index, x, y); });
            }(i));
        }
        manage.AppendTo(root, MF_STRING, "Manage buttons");
    }

    root.AppendMenuSeparator();
    router.item(root, "Choose from track context menu\u2026", function () { browseNativeContextMenu(x, y, settings.defaultTarget); });

    var layoutMenu = window.CreatePopupMenu();
    var presentationMenu = window.CreatePopupMenu();
    appendRadioChoice(router, presentationMenu, settings.presentation, PRESENTATION_ICON, "Icons only", setPresentation);
    appendRadioChoice(router, presentationMenu, settings.presentation, PRESENTATION_ICON_LABEL, "Icons and labels", setPresentation);
    appendRadioChoice(router, presentationMenu, settings.presentation, PRESENTATION_LABEL, "Labels only", setPresentation);
    presentationMenu.AppendTo(layoutMenu, MF_STRING, "Presentation");

    var orientationMenu = window.CreatePopupMenu();
    appendRadioChoice(router, orientationMenu, settings.orientation, ORIENTATION_AUTO, "Automatic", setOrientation);
    appendRadioChoice(router, orientationMenu, settings.orientation, ORIENTATION_HORIZONTAL, "Horizontal", setOrientation);
    appendRadioChoice(router, orientationMenu, settings.orientation, ORIENTATION_VERTICAL, "Vertical", setOrientation);
    orientationMenu.AppendTo(layoutMenu, MF_STRING, "Orientation");

    var alignmentMenu = window.CreatePopupMenu();
    appendRadioChoice(router, alignmentMenu, settings.alignment, ALIGN_START, "Start", setAlignment);
    appendRadioChoice(router, alignmentMenu, settings.alignment, ALIGN_CENTER, "Centre", setAlignment);
    appendRadioChoice(router, alignmentMenu, settings.alignment, ALIGN_END, "End", setAlignment);
    alignmentMenu.AppendTo(layoutMenu, MF_STRING, "Alignment");

    var styleMenu = window.CreatePopupMenu();
    appendRadioChoice(router, styleMenu, settings.buttonStyle, STYLE_NORMAL, styleLabel(STYLE_NORMAL), setButtonStyle);
    appendRadioChoice(router, styleMenu, settings.buttonStyle, STYLE_ACCENT, styleLabel(STYLE_ACCENT), setButtonStyle);
    appendRadioChoice(router, styleMenu, settings.buttonStyle, STYLE_OUTLINE, styleLabel(STYLE_OUTLINE), setButtonStyle);
    appendRadioChoice(router, styleMenu, settings.buttonStyle, STYLE_GHOST, styleLabel(STYLE_GHOST), setButtonStyle);
    appendRadioChoice(router, styleMenu, settings.buttonStyle, STYLE_SWITCHER, styleLabel(STYLE_SWITCHER), setButtonStyle);
    styleMenu.AppendTo(layoutMenu, MF_STRING, "Button style");

    router.item(layoutMenu, "Show button backgrounds", function () {
        applyMySetting("buttonBackgrounds", !settings.buttonBackgrounds);
    }, MF_STRING | (settings.buttonBackgrounds ? MF_CHECKED : 0));
    router.item(layoutMenu, "Show button borders", function () {
        applyMySetting("buttonBorders", !settings.buttonBorders);
    }, MF_STRING | (settings.buttonBorders ? MF_CHECKED : 0));

    router.item(layoutMenu, "Wrap buttons", function () {
        applyMySetting("wrap", !settings.wrap);
    }, MF_STRING | (settings.wrap ? MF_CHECKED : 0));
    layoutMenu.AppendTo(root, MF_STRING, "Layout");

    var targetMenu = window.CreatePopupMenu();
    appendRadioChoice(router, targetMenu, settings.defaultTarget, TARGET_SELECTION_OR_CURRENT, "Selection, otherwise current track", setDefaultTarget);
    appendRadioChoice(router, targetMenu, settings.defaultTarget, TARGET_SELECTION, "Selected playlist items", setDefaultTarget);
    appendRadioChoice(router, targetMenu, settings.defaultTarget, TARGET_NOW_PLAYING, "Now playing", setDefaultTarget);
    appendRadioChoice(router, targetMenu, settings.defaultTarget, TARGET_FOCUSED, "Focused item", setDefaultTarget);
    appendRadioChoice(router, targetMenu, settings.defaultTarget, TARGET_CURRENT, "Current panel track", setDefaultTarget);
    targetMenu.AppendTo(root, MF_STRING, "Default context target");

    var slotMenu = window.CreatePopupMenu();
    appendRadioChoice(router, slotMenu, settings.layoutSlot, LAYOUT_SLOT_NONE, layoutSlotLabel(LAYOUT_SLOT_NONE), setLayoutSlot);
    appendRadioChoice(router, slotMenu, settings.layoutSlot, LAYOUT_SLOT_ROOT_TOP, layoutSlotLabel(LAYOUT_SLOT_ROOT_TOP), setLayoutSlot);
    appendRadioChoice(router, slotMenu, settings.layoutSlot, LAYOUT_SLOT_LEFT_RAIL, layoutSlotLabel(LAYOUT_SLOT_LEFT_RAIL), setLayoutSlot);
    slotMenu.AppendMenuSeparator();
    // Hiding the strip hides this panel, so the only way back is the Settings
    // screen. The menu item stays for symmetry but says so.
    router.item(slotMenu, "Show button strip (turn back on from Settings)", function () {
        setStripVisible(!settings.stripVisible);
    }, MF_STRING | (settings.stripVisible ? MF_CHECKED : 0) |
        (settings.layoutSlot === LAYOUT_SLOT_NONE ? MF_GRAYED | MF_DISABLED : 0));
    slotMenu.AppendTo(root, MF_STRING, "Layout slot: " + layoutSlotLabel(settings.layoutSlot));

    var shareMenu = window.CreatePopupMenu();
    appendRadioChoice(router, shareMenu, settings.shareMode, SHARE_MODE_SHARED, shareModeLabel(SHARE_MODE_SHARED), setShareMode);
    appendRadioChoice(router, shareMenu, settings.shareMode, SHARE_MODE_STANDALONE, shareModeLabel(SHARE_MODE_STANDALONE), setShareMode);
    appendRadioChoice(router, shareMenu, settings.shareMode, SHARE_MODE_BUTTONS, shareModeLabel(SHARE_MODE_BUTTONS), setShareMode);
    shareMenu.AppendMenuSeparator();
    router.item(shareMenu, "Pull current state from the other panels", requestSharedState,
        MF_STRING | (settings.shareMode === SHARE_MODE_STANDALONE ? MF_GRAYED | MF_DISABLED : 0));
    shareMenu.AppendTo(root, MF_STRING, "Share settings with");

    root.AppendMenuSeparator();
    router.item(root, "Edit button data (JSON)\u2026", editRawButtonsJson);
    router.item(root, "Reset buttons to defaults\u2026", function () { resetButtonsToDefaults(x, y); });

    root.AppendMenuSeparator();
    router.item(root, RivageUI.copy.labels.panelConfiguration, safeConfigurePanel);
    router.item(root, RivageUI.copy.labels.editScript, safeEditScript);

    router.run(root.TrackPopupMenu(x, y));
}

// Shared settings registry

function getMySettings() {
    return [
        {
            id: "shareMode",
            label: "Share settings with",
            type: "choice",
            value: settings.shareMode,
            choiceValueType: "string",
            choices: [
                { value: SHARE_MODE_SHARED, label: shareModeLabel(SHARE_MODE_SHARED) },
                { value: SHARE_MODE_STANDALONE, label: shareModeLabel(SHARE_MODE_STANDALONE) },
                { value: SHARE_MODE_BUTTONS, label: shareModeLabel(SHARE_MODE_BUTTONS) }
            ],
            section: "Panel"
        },
        {
            id: "shareInfo",
            label: "How sharing works",
            type: "info",
            value: "Shared modes copy edits to other Custom Buttons panels. Switching to This panel only keeps the current settings and stops future syncing.",
            section: "Panel"
        },
        {
            id: "panelName",
            label: "Name in Settings",
            type: "string",
            value: settings.panelName,
            hint: "How this panel appears in Settings. Leave blank to use \"Custom buttons\".",
            section: "Panel"
        },
        {
            id: "layoutSlot",
            label: "Layout slot",
            type: "choice",
            value: settings.layoutSlot,
            choiceValueType: "string",
            choices: [
                { value: LAYOUT_SLOT_NONE, label: layoutSlotLabel(LAYOUT_SLOT_NONE) },
                { value: LAYOUT_SLOT_ROOT_TOP, label: layoutSlotLabel(LAYOUT_SLOT_ROOT_TOP) },
                { value: LAYOUT_SLOT_LEFT_RAIL, label: layoutSlotLabel(LAYOUT_SLOT_LEFT_RAIL) }
            ],
            section: "Panel"
        },
        {
            id: "stripVisible",
            label: "Show button strip",
            type: "bool",
            value: settings.stripVisible,
            section: "Panel"
        },
        {
            id: "slotInfo",
            label: "Managed layout slot",
            type: "info",
            value: "A managed slot reserves space for this strip. When the strip is hidden, the layout reclaims that space.",
            section: "Panel"
        },
        {
            id: "editingInfo",
            label: "Editing buttons",
            type: "info",
            value: "Shift-right-click a button to edit it. Shift-right-click empty space to open the panel menu.",
            section: "Buttons"
        },
        { id: "addButton", label: "Add button\u2026", type: "action", value: null, actionLabel: "Add", section: "Buttons" },
        { id: "addContextButton", label: "Add foobar2000 command button\u2026", type: "action", value: null, actionLabel: "Add", section: "Buttons" },
        { id: "editRawButtons", label: "Edit button data (JSON)\u2026", type: "action", value: null, actionLabel: "Edit", section: "Advanced" },
        { id: "resetButtons", label: "Reset buttons to defaults\u2026", type: "action", value: null, actionLabel: "Reset", section: "Buttons" },
        {
            id: "buttonCount",
            label: "Configured buttons",
            type: "info",
            value: String(buttons.length),
            section: "Buttons"
        },
        {
            id: "presentation",
            label: "Button presentation",
            type: "choice",
            value: settings.presentation,
            choiceValueType: "string",
            choices: [
                { value: PRESENTATION_ICON, label: "Icons only" },
                { value: PRESENTATION_ICON_LABEL, label: "Icons and labels" },
                { value: PRESENTATION_LABEL, label: "Labels only" }
            ],
            section: "Layout"
        },
        {
            id: "orientation",
            label: "Orientation",
            type: "choice",
            value: settings.orientation,
            choiceValueType: "string",
            choices: [
                { value: ORIENTATION_AUTO, label: "Automatic" },
                { value: ORIENTATION_HORIZONTAL, label: "Horizontal" },
                { value: ORIENTATION_VERTICAL, label: "Vertical" }
            ],
            section: "Layout"
        },
        {
            id: "alignment",
            label: "Alignment",
            type: "choice",
            value: settings.alignment,
            choiceValueType: "string",
            choices: [
                { value: ALIGN_START, label: "Start" },
                { value: ALIGN_CENTER, label: "Centre" },
                { value: ALIGN_END, label: "End" }
            ],
            section: "Layout"
        },
        {
            id: "buttonStyle",
            label: "Button style",
            type: "choice",
            value: settings.buttonStyle,
            choiceValueType: "string",
            choices: [
                { value: STYLE_NORMAL, label: styleLabel(STYLE_NORMAL) },
                { value: STYLE_ACCENT, label: styleLabel(STYLE_ACCENT) },
                { value: STYLE_OUTLINE, label: styleLabel(STYLE_OUTLINE) },
                { value: STYLE_GHOST, label: styleLabel(STYLE_GHOST) },
                { value: STYLE_SWITCHER, label: styleLabel(STYLE_SWITCHER) }
            ],
            section: "Appearance"
        },
        { id: "wrap", label: "Wrap buttons", type: "bool", value: settings.wrap, section: "Layout" },
        { id: "buttonHeight", label: "Button height", type: "number", value: settings.buttonHeight, min: 22, max: 72, step: 1, section: "Layout" },
        { id: "gap", label: "Button gap", type: "number", value: settings.gap, min: 0, max: 24, step: 1, section: "Layout" },
        { id: "padding", label: "Panel padding", type: "number", value: settings.padding, min: 0, max: 30, step: 1, section: "Layout" },
        { id: "dimUnavailable", label: "Dim unavailable buttons", type: "bool", value: settings.dimUnavailable, section: "Appearance" },
        { id: "buttonBackgrounds", label: "Show button backgrounds", type: "bool", value: settings.buttonBackgrounds, section: "Appearance" },
        { id: "buttonBorders", label: "Show button borders", type: "bool", value: settings.buttonBorders, section: "Appearance" },
        { id: "panelBackground", label: "Show panel background", type: "bool", value: settings.panelBackground, section: "Appearance" },
        { id: "showTooltips", label: "Show button tooltips", type: "bool", value: settings.showTooltips, section: "Appearance" },
        { id: "tooltipStatus", label: "Tooltip status", type: "info", value: tooltipStatusText(), section: "Appearance" },
        {
            id: "accentMode",
            label: "Accent colour",
            type: "choice",
            value: settings.accentMode,
            choiceValueType: "string",
            choices: [
                { value: ACCENT_SHARED, label: RivageUI.copy.labels.sharedAccent },
                { value: ACCENT_DEFAULT, label: RivageUI.copy.labels.rvgBlue },
                { value: ACCENT_CUSTOM, label: "Custom colour" }
            ],
            section: "Appearance"
        },
        { id: "customAccent", label: "Custom accent colour", type: "colour", value: settings.customAccent, hidden: settings.accentMode !== ACCENT_CUSTOM, section: "Appearance" },
        {
            id: "buttonAccentInfo",
            label: "Per-button accent",
            type: "info",
            value: "Shift-right-click a button \u203A Accent colour \u203A Use shared accent to bind that button directly to the shared accent, even when the panel uses another accent mode.",
            section: "Appearance"
        },
        {
            id: "defaultTarget",
            label: "Default context target",
            type: "choice",
            value: settings.defaultTarget,
            choiceValueType: "string",
            choices: [
                { value: TARGET_SELECTION_OR_CURRENT, label: "Selection, otherwise current track" },
                { value: TARGET_SELECTION, label: "Selected playlist items" },
                { value: TARGET_NOW_PLAYING, label: "Now playing" },
                { value: TARGET_FOCUSED, label: "Focused item" },
                { value: TARGET_CURRENT, label: "Current panel track" }
            ],
            section: "Actions"
        },
        {
            id: "contextPathInfo",
            label: "Context command paths",
            type: "info",
            value: "Use / between submenu levels. Example: Run service/Google Artist. The editor also accepts Run service > Google Artist and normalises it automatically.",
            section: "Actions"
        }
    ];
}

function applyMySetting(id, value) {
    var next;
    var changed = false;

    switch (id) {
    case "shareMode": setShareMode(value); return;
    case "panelName":
        next = String(value == null ? "" : value).slice(0, 48);
        saveSetting("Panel name", next);
        return;
    case "layoutSlot": setLayoutSlot(value); return;
    case "stripVisible": setStripVisible(value); return;
    case "shareInfo":
    case "slotInfo":
    case "tooltipStatus":
    case "editingInfo":
    case "buttonCount":
    case "buttonAccentInfo":
    case "contextPathInfo":
        return;
    case "addButton": addButtonFlow(); return;
    case "addContextButton": addContextButtonFlow(); return;
    case "editRawButtons": editRawButtonsJson(); return;
    case "resetButtons": resetButtonsFromSettings(); return;
    case "presentation": setPresentation(String(value)); return;
    case "orientation": setOrientation(String(value)); return;
    case "alignment": setAlignment(String(value)); return;
    case "buttonStyle": setButtonStyle(String(value)); return;
    case "wrap":
        changed = saveSetting("Wrap", !!value);
        break;
    case "buttonHeight":
        next = normalisedSettingValue("buttonHeight", value);
        changed = saveSetting("Button height", next);
        if (changed) rebuildFonts();
        break;
    case "gap":
        next = normalisedSettingValue("gap", value);
        changed = saveSetting("Gap", next);
        break;
    case "padding":
        next = normalisedSettingValue("padding", value);
        changed = saveSetting("Padding", next);
        break;
    case "dimUnavailable":
        changed = saveSetting("Dim unavailable buttons", !!value);
        break;
    case "buttonBackgrounds":
        changed = saveSetting("Button backgrounds", !!value);
        break;
    case "buttonBorders":
        changed = saveSetting("Button borders", !!value);
        break;
    case "panelBackground":
        changed = saveSetting("Panel background", !!value);
        break;
    case "showTooltips":
        changed = saveSetting("Show tooltips", !!value);
        if (changed && !settings.showTooltips) hideTooltip();
        break;
    case "accentMode":
        next = normalisedSettingValue("accentMode", value);
        changed = saveSetting("Accent mode", next);
        if (changed) {
            if (settings.accentMode === ACCENT_SHARED) SharedAccentProtocol.requestAccent();
            rebuildTheme();
        }
        break;
    case "customAccent":
        next = SharedAccentProtocol.opaque(Number(value));
        changed = saveSetting("Custom accent", next);
        if (changed) rebuildTheme();
        break;
    case "defaultTarget": setDefaultTarget(value); return;
    default: return;
    }

    if (!changed) return;
    layoutDirty = id === "wrap" || id === "buttonHeight" || id === "gap" || id === "padding" ? true : layoutDirty;
    window.Repaint(true);
}

// Mouse callbacks

function on_mouse_move(x, y) {
    mouse.x = x;
    mouse.y = y;
    var entry = hitEntry(x, y);
    var next = entry ? entry.buttonIndex : -1;

    // The OS owns tooltip placement now, so a move inside the same button is
    // no longer a reason to repaint - only a change of hovered button is.
    showTooltipFor(next);

    if (next !== hoveredIndex) {
        hoveredIndex = next;
        window.Repaint();
    }
}

function on_mouse_leave() {
    mouse.x = -1;
    mouse.y = -1;
    hideTooltip();
    if (hoveredIndex !== -1 || pressedIndex !== -1) {
        hoveredIndex = -1;
        pressedIndex = -1;
        window.Repaint();
    }
}

function on_mouse_lbtn_down(x, y) {
    var entry = hitEntry(x, y);
    pressedIndex = entry ? entry.buttonIndex : -1;
    if (pressedIndex >= 0) window.Repaint();
}

// The second click of a double-click arrives as lbtn_dblclk instead of a
// second down/up pair. Without this, a fast double-click on a button silently
// executes only once and reads as a dropped click.
function on_mouse_lbtn_dblclk(x, y) {
    on_mouse_lbtn_down(x, y);
}

function on_mouse_lbtn_up(x, y) {
    hideTooltip();
    var entry = hitEntry(x, y);
    var releaseIndex = entry ? entry.buttonIndex : -1;
    var activate = pressedIndex >= 0 && pressedIndex === releaseIndex;
    var index = pressedIndex;
    pressedIndex = -1;
    window.Repaint();
    if (!activate) return;
    if (!actionAvailableNow(buttons[index].left)) return;
    executeAction(buttons[index].left, { x: x, y: y, rect: entry ? entry.rect : null });
}

function on_mouse_mbtn_up(x, y) {
    hideTooltip();
    var entry = hitEntry(x, y);
    if (!entry) return;
    if (!actionAvailableNow(buttons[entry.buttonIndex].middle)) return;
    executeAction(buttons[entry.buttonIndex].middle, { x: x, y: y, rect: entry.rect });
}

// Right-click policy
// A plain right-click on a BUTTON is reserved for that button's own bound
// action and never opens a menu of any kind - not the editor, and not
// JSplitter's own panel menu. Suppressing the latter is what the `return true`
// is for: on_mouse_rbtn_up must return true or the host shows its context menu
// on top of whatever the panel just did (see docs/Callbacks.js).
//
// Shift+right-click is the configuration gesture: the button editor over a
// button, the panel menu over empty space.
//
// The host's own escape hatch is unaffected - left Shift + left Windows key
// bypasses this callback entirely and always opens JSplitter's menu.
function on_mouse_rbtn_up(x, y, mask) {
    var shift = mask === undefined ? shiftHeld() : ((mask & MK_SHIFT) !== 0);
    var entry;

    if (hostPropertiesComboHeld()) return false;

    hideTooltip();
    entry = hitEntry(x, y);

    if (shift) {
        if (entry) showButtonEditor(entry.buttonIndex, x, y);
        else showPanelMenu(x, y);
        return true;
    }

    if (entry) {
        if (actionAvailableNow(buttons[entry.buttonIndex].right)) {
            executeAction(buttons[entry.buttonIndex].right, { x: x, y: y, rect: entry.rect });
        }
        return true;
    }

    showPanelMenu(x, y);
    return true;
}

// Host callbacks

function on_size(width, height) {
    ww = Math.max(0, asInt(width, window.Width));
    wh = Math.max(0, asInt(height, window.Height));
    layoutDirty = true;

    // Automatic orientation is derived from the panel's aspect ratio, so the
    // natural size can change purely because the host resized us.
    broadcastMeasure(false);
    window.Repaint();
}

function on_colours_changed() {
    rebuildTheme();
    window.Repaint(true);
}

function on_font_changed() {
    refreshHostMetrics();
    applyTooltipFont();
    broadcastMeasure(false);
    window.Repaint(true);
}

function on_playback_new_track(metadb) {
    refreshButtonStateCache(false);
    window.Repaint();
}

function on_playback_stop(reason) {
    refreshButtonStateCache(false);
    window.Repaint();
}

// Selection/focus can change both stateful indicators and target-based availability.
function on_item_focus_change(playlist, from, to) {
    refreshForTrackContextChange();
}

function on_playlist_items_selection_change() {
    refreshForTrackContextChange();
}

function anyButtonUsesSharedAlbumAccent() {
    var i;
    for (i = 0; i < buttons.length; i++) {
        if (normaliseButtonAccentSource(buttons[i].accentSource, buttons[i].colour != null) === BUTTON_ACCENT_SHARED) return true;
    }
    return false;
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info, function (payload) {
        // The producer publishes the compatibility/shared accent in the full
        // theme payload too. Adopting it here makes startup/reload robust even
        // if the legacy accent UPDATE happened before this panel registered.
        if (payload) adoptSharedAlbumAccent(Number(payload.accent));
        rebuildTheme();
        window.Repaint(true);
    })) return;

    if (SettingsRegistry.provide(name, info, settingsPanelId(), settingsPanelLabel(), getMySettings)) return;
    if (SettingsRegistry.consume(name, info, settingsPanelId(), applyMySetting)) return;
    if (consumeSharedState(name, info)) return;
    if (consumeMeasureRequest(name, info)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var changed = adoptSharedAlbumAccent(info);
        if (changed && settings.accentMode === ACCENT_SHARED) rebuildTheme();
        if (changed && (settings.accentMode === ACCENT_SHARED || anyButtonUsesSharedAlbumAccent())) window.Repaint(true);
    }
}

function on_script_unload() {
    scriptActive = false;
    cancelPanelTimeouts();
    hideTooltip();
    if (buttonStatePollTimer !== null) {
        window.ClearInterval(buttonStatePollTimer);
        buttonStatePollTimer = null;
    }
}

// Startup

refreshHostMetrics();
ww = Math.max(0, asInt(window.Width, 0));
wh = Math.max(0, asInt(window.Height, 0));
layoutDirty = true;
refreshButtonStateCache(false);
startButtonStatePolling();
SharedAccentProtocol.request();
TrackContext.onChange(refreshForTrackContextChange);
TrackContext.requestSync();

// Adopt whatever the siblings already have, so a panel loaded (or reloaded)
// mid-session joins the shared state instead of sitting on its own stale copy.
requestSharedState();

// Publish the initial content size for whichever host owns this slot, then
// again a few times: a host script may not have finished loading (and so may
// not be listening) when this panel starts. Hosts also retry their own request
// until answered, so the order the scripts start in is irrelevant.
broadcastMeasure(true);
if (settings.layoutSlot !== LAYOUT_SLOT_NONE) {
    schedulePanelTimeout(function () { broadcastMeasure(true); }, 150);
    schedulePanelTimeout(function () { broadcastMeasure(true); }, 700);
    schedulePanelTimeout(function () { broadcastMeasure(true); }, 2000);
}

window.Repaint(true);
