// Shared Seekbar widget
//
// Extracted from topbar_panel.js's original inline seekbar so any panel can render one.
// Two things live in this one file, on purpose:
//
//   1. SeekbarWidget.create(...)   - a per-instance drawable/interactive object. Each host
//      panel that wants a seekbar makes its own instance (position, drag state, DPI are all
//      per-instance - two panels can each show a seekbar at completely different places).
//   2. SeekbarWidget.settings / getSchema() / applySetting() / onNotifyData()
//      - ONE shared appearance config (font, colours, bar thickness, always-show-thumb,
//      50% mark), because the point of pulling this out of topbar_panel.js is "call it from
//      different panels" and having each host's seekbar look different by accident would
//      defeat that. See "Why settings need their own sync" below.
//
// ---------------------------------------------------------------------------------------
// Two write paths, and why applySetting() does NOT re-broadcast
// ---------------------------------------------------------------------------------------
// Same rule as shared/tab_bar_style.js - see its header for the long version. The three
// hosts (topbar_panel.js, controls_panel.js and miniplayer_panel.js) all provide PANEL_ID
// "seekbar", so ONE SettingsRegistry.broadcastChange('seekbar', ...) from the settings
// screen already reaches every host. applySetting() - the function wired to
// SettingsRegistry.consume() - must
// therefore only apply + persist + repaint locally. If it re-broadcast, host A's rebroadcast
// would reach host B, whose consume() would rebroadcast back to A, forever;
// SettingsRegistry.consume() has no origin-echo suppression to stop it.
//
// A LOCAL edit (tapping the end-time label, instance.onMouseUp) is the other path: nothing
// has told the sibling host yet, so setAndSync() applies locally AND sends ONE
// SEEKBAR_SETTINGS_UPDATE. The sibling receives that through onNotifyData(), which also only
// applies locally and never re-sends - which is what keeps this loop-free.


var SEEKBAR_WIDGET_VERSION = "2.5.0";
var SEEKBAR_SETTINGS_REQUEST = "RIVAGE.SEEKBAR_SETTINGS.REQUEST";
var SEEKBAR_SETTINGS_UPDATE = "RIVAGE.SEEKBAR_SETTINGS.UPDATE";

// Re-entry guard + `var`, matching design_system.js's RivageUI. A second include() would
// otherwise re-run everything and swap `settings` for a fresh object under any host holding
// a reference to the old one.
var SeekbarWidget = (function (existing) {
    if (existing && existing.version) return existing;

    // Narrow failure reporting. This is for the few empty catches that mean
    // something is actually broken and would otherwise leave no trace: a
    // settings rollback failing after an already-failed write, or a
    // broadcast/apply in the cross-host settings-sync path documented above.
    // Repeats are counted and re-logged only at powers of ten.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[SeekbarWidget] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    // ------------------------------------------------------------------------------------
    // Private, self-contained helpers (namespaced/prefixed so this file makes zero
    // assumptions about what the host panel has already declared globally - see the header
    // comment on why shared/*.js files stay self-contained rather than relying on host
    // conventions that differ between panels, e.g. topbar_panel.js's own RGB()/DT_LEFT vs
    // controls_panel.js's _RGB()/TEXT_FLAGS bitmask).
    // ------------------------------------------------------------------------------------

    var DT_LEFT = 0x00000000;
    var DT_CENTER = 0x00000001;
    var DT_VCENTER = 0x00000004;
    var DT_SINGLELINE = 0x00000020;
    var DT_NOPREFIX = 0x00000800;

    function sbRGB(r, g, b) {
        return 0xff000000 | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
    }

    function sbClamp(value, min, max) {
        var n = Number(value);
        if (!isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
    }

    // Human-hearing volume curve, corrected inverse of vendor/Helpers.js's vol2pos()
    // (that helper has a long-standing variable-name typo). Deliberately duplicated
    // here rather than importing shared/volume_bar_widget.js - this file stays
    // self-contained per the header comment above, and VolumeBarWidget itself
    // duplicates rather than depends on this file for the same reason.
    function sbVolumeToFraction(volume) {
        var v = sbClamp(volume, -100, 0);
        return sbClamp((Math.pow(10, v / 50) - 0.01) / 0.99, 0, 1);
    }

    function sbFractionToVolume(fraction) {
        var p = sbClamp(fraction, 0, 1);
        return sbClamp(50 * Math.log(0.99 * p + 0.01) / Math.LN10, -100, 0);
    }

    function applyVolumeFraction(fraction) {
        var next = sbFractionToVolume(fraction);
        try {
            fb.Volume = next;
        } catch (e) {
            // Host is unloading or does not expose writable fb.Volume.
        }
        return next;
    }

    var fontCache = Object.create(null);
    function sbFont(name, pixelSize, style) {
        var family = name || "Segoe UI";
        var size = Math.max(1, Math.round(pixelSize));
        var key = family.toLowerCase() + "|" + size + "|" + (style || 0);
        var font;
        if (fontCache[key]) return fontCache[key];
        try {
            font = gdi.Font(family, size, style || 0);
        } catch (e) {
            font = null;
        }
        if (!font && family.toLowerCase() !== "segoe ui") {
            try {
                font = gdi.Font("Segoe UI", size, style || 0);
            } catch (e2) {
                font = null;
            }
        }
        // Only cache a real font - caching a null would make one transient gdi.Font()
        // failure permanent for that key for the whole session.
        if (font) fontCache[key] = font;
        return font;
    }

    // ------------------------------------------------------------------------------------
    // Shared, cross-instance, cross-panel appearance settings
    // ------------------------------------------------------------------------------------

    var PROPERTY_PREFIX = "Rivage Seekbar.";

    function saveSetting(name, value) {
        window.SetProperty(PROPERTY_PREFIX + name, value);
    }

    var MIDPOINT_STYLES = ["line", "dot", "diamond"];

    var settings = {
        fontFamily: String(window.GetProperty(PROPERTY_PREFIX + "Font family", "") || "").trim(),
        fontSize: Math.round(sbClamp(window.GetProperty(PROPERTY_PREFIX + "Font size", 11), 8, 24)),
        textColour: Number(window.GetProperty(PROPERTY_PREFIX + "Text colour", sbRGB(151, 151, 156))),
        trackColour: Number(window.GetProperty(PROPERTY_PREFIX + "Track colour", sbRGB(58, 58, 58))),
        barThickness: Math.round(sbClamp(window.GetProperty(PROPERTY_PREFIX + "Bar thickness", 4), 2, 16)),
        alwaysShowThumb: !!window.GetProperty(PROPERTY_PREFIX + "Always show thumb", false),
        showMidpointMark: !!window.GetProperty(PROPERTY_PREFIX + "Show 50% mark", true),
        midpointStyle: (function () {
            var v = String(window.GetProperty(PROPERTY_PREFIX + "50% mark style", "line"));
            return MIDPOINT_STYLES.indexOf(v) >= 0 ? v : "line";
        })(),
        // Tap-on-end-time toggles this live (see instance.onMouseUp below); the schema row
        // is just the persisted starting point for a freshly-loaded instance.
        showRemainingTime: !!window.GetProperty(PROPERTY_PREFIX + "Show remaining time", false)
    };

    // Upgrade the old first-run/default seekbar font (Segoe UI 11) to the
    // new Core: Console inherited source. Any explicit non-default custom
    // family/size survives the upgrade.
    var fontSourceMigration = String(window.GetProperty(PROPERTY_PREFIX + "Font source migration", "") || "");
    if (!fontSourceMigration) {
        if (settings.fontFamily.toLowerCase() === "segoe ui" && settings.fontSize === 11) {
            settings.fontFamily = "";
            saveSetting("Font family", "");
        }
        saveSetting("Font source migration", "core-console-v1");
    }

    var dpi = 100;
    function scale(value) {
        return Math.round(value * dpi / 100);
    }

    // Resolve the exact foobar2000 Console font client locally instead of going
    // through RivageUI. This widget is intentionally self-contained and is
    // included by Top Bar before design_system.js; depending on RivageUI here
    // makes an inherited-font seekbar fail at include-time after a reload.
    //
    // Columns UI: Preferences > Display > Columns UI > Colours and fonts >
    //             Fonts > Core: Console
    // Default UI: Preferences > Display > Default User Interface > Fonts > Console
    var SB_CUI_CORE_CONSOLE_GUID = "{E9F4D060-6FEB-4626-B25D-BA090F75F7A5}";
    var SB_FONT_TYPE_CUI_ITEMS = 0;
    var SB_FONT_TYPE_DUI_CONSOLE = 5;

    function inheritedConsoleFontInfo() {
        var info = {
            fontFamily: "Segoe UI",
            fontSize: Math.max(1, scale(11)),
            fontStyle: 0,
            inherited: true,
            source: "Core: Console"
        };
        var hostFont = null;

        try {
            if (window.InstanceType === 1) {
                hostFont = window.GetFontDUI(SB_FONT_TYPE_DUI_CONSOLE);
                info.source = "Default UI: Console";
            } else {
                hostFont = window.GetFontCUI(SB_FONT_TYPE_CUI_ITEMS, SB_CUI_CORE_CONSOLE_GUID);
                info.source = "Columns UI: Core: Console";
            }
        } catch (e) {
            hostFont = null;
        }

        try {
            if (hostFont && hostFont.Name) info.fontFamily = String(hostFont.Name);
            if (hostFont && Number(hostFont.Size) > 0) info.fontSize = Math.max(1, Math.round(Number(hostFont.Size)));
            if (hostFont && isFinite(Number(hostFont.Style))) info.fontStyle = Math.round(Number(hostFont.Style));
        } catch (e2) {
            // Keep the stable fallback descriptor above.
        }

        return info;
    }

    function resolvedFontInfo() {
        var family = String(settings.fontFamily || '').trim();
        if (family) {
            var installed = true;
            try { installed = typeof utils === 'undefined' || !utils || typeof utils.CheckFont !== 'function' || utils.CheckFont(family); } catch (e) { installed = true; }
            if (installed) {
                return {
                    fontFamily: family,
                    fontSize: Math.max(1, scale(settings.fontSize)),
                    fontStyle: 0,
                    inherited: false,
                    source: 'Custom'
                };
            }
        }

        return inheritedConsoleFontInfo();
    }

    function describeFont() {
        var family = String(settings.fontFamily || "").trim();
        if (family) return "Custom: " + family + ", " + settings.fontSize + " px";
        return "Core: Console (inherited)";
    }

    var currentFont = null;
    var currentFontInfo = null;
    function rebuildFont() {
        var info = resolvedFontInfo();
        currentFontInfo = info;
        currentFont = sbFont(info.fontFamily, info.fontSize, info.fontStyle || 0);
    }

    // Hosts with a compact, height-responsive layout need to reserve enough
    // vertical room for the inherited Core: Console font. That font intentionally
    // keeps its exact host size even when the surrounding panel scales down; a
    // fixed 22-pixel strip can therefore clip roughly half of the glyphs. Use a
    // conservative GDI line-height estimate (or the font object's real Height
    // when exposed by the host) plus breathing room for antialiasing and the
    // thumb. Ordinary hosts may keep their own larger fixed row height.
    function minimumOuterHeight() {
        var fontHeight = 0;
        var fontSize = currentFontInfo && Number(currentFontInfo.fontSize) > 0
            ? Number(currentFontInfo.fontSize)
            : scale(settings.fontSize || 11);
        try {
            fontHeight = Number(currentFont && currentFont.Height) || 0;
        } catch (e) {
            fontHeight = 0;
        }
        // Some GDI hosts expose Font.Height as the nominal em size rather than
        // the complete ascent/descent line box. Never let that smaller value
        // defeat the conservative estimate used for hosts without Height.
        fontHeight = Math.max(fontHeight, Math.ceil(fontSize * 1.6));

        var trackH = Math.max(2, scale(settings.barThickness));
        var thumbH = Math.max(trackH * 2.4, scale(10));
        return Math.max(
            scale(22),
            Math.ceil(fontHeight + Math.max(4, scale(6))),
            Math.ceil(thumbH + scale(4))
        );
    }
    rebuildFont();

    function repaintHost() {
        try {
            window.Repaint(true);
        } catch (e) {
            // Between unload and GC; nothing to repaint.
        }
    }

    function normaliseSetting(id, value) {
        switch (id) {
        case "fontFamily":
            return { id: id, property: "Font family", value: String(value || "").trim(), font: true };
        case "fontSize":
            return { id: id, property: "Font size", value: Math.round(sbClamp(value, 8, 24)), font: true };
        case "textColour":
            return { id: id, property: "Text colour", value: Number(value), font: false };
        case "trackColour":
            return { id: id, property: "Track colour", value: Number(value), font: false };
        case "barThickness":
            return { id: id, property: "Bar thickness", value: Math.round(sbClamp(value, 2, 16)), font: false };
        case "alwaysShowThumb":
            return { id: id, property: "Always show thumb", value: !!value, font: false };
        case "showMidpointMark":
            return { id: id, property: "Show 50% mark", value: !!value, font: false };
        case "midpointStyle": {
            var style = String(value);
            return { id: id, property: "50% mark style", value: MIDPOINT_STYLES.indexOf(style) >= 0 ? style : "line", font: false };
        }
        case "showRemainingTime":
            return {
                id: id,
                property: "Show remaining time",
                value: typeof value === "string" ? value === "remaining" : !!value,
                font: false
            };
        default:
            return null;
        }
    }

    function sameSettingValue(a, b) {
        return a === b || (typeof a === "number" && typeof b === "number" && isNaN(a) && isNaN(b));
    }

    function applyCandidates(candidates) {
        var changed = [], previous = [], i, candidate, key, fontChanged = false;
        for (i = 0; i < candidates.length; i++) {
            candidate = candidates[i];
            if (!candidate || sameSettingValue(settings[candidate.id], candidate.value)) continue;
            changed.push(candidate);
        }
        if (!changed.length) return false;

        try {
            for (i = 0; i < changed.length; i++) {
                candidate = changed[i];
                key = PROPERTY_PREFIX + candidate.property;
                previous.push({ key: key, value: window.GetProperty(key, settings[candidate.id]) });
                window.SetProperty(key, candidate.value);
            }
        } catch (e) {
            for (i = previous.length - 1; i >= 0; i--) {
                try { window.SetProperty(previous[i].key, previous[i].value); } catch (rollbackError) { reportFailure('a seekbar setting rollback could not be saved', rollbackError); }
            }
            throw e;
        }

        for (i = 0; i < changed.length; i++) {
            candidate = changed[i];
            settings[candidate.id] = candidate.value;
            if (candidate.font) fontChanged = true;
        }
        if (fontChanged) rebuildFont();
        return true;
    }

    function applyLocally(id, value) {
        var candidate = normaliseSetting(id, value);
        if (!candidate) return false;
        return applyCandidates([candidate]);
    }

    function applyStateLocally(info) {
        var candidates = [], key, candidate;
        for (key in info) {
            if (!Object.prototype.hasOwnProperty.call(info, key)) continue;
            candidate = normaliseSetting(key, info[key]);
            if (candidate) candidates.push(candidate);
        }
        return applyCandidates(candidates);
    }

    // LOCAL-EDIT path, used by instance.onMouseUp()'s tap-on-end-time - nothing has told
    // the sibling host yet, so this applies locally and sends exactly ONE
    // SEEKBAR_SETTINGS_UPDATE. Its receiver (onNotifyData below) applies locally and never
    // re-sends, which is what keeps it loop-free. Do NOT route consume() through here.
    function setAndSync(id, value) {
        var candidate = normaliseSetting(id, value);
        if (!candidate) return false;
        try {
            if (!applyCandidates([candidate])) return false;
        } catch (e) {
            return false;
        }
        repaintHost();
        try {
            var payload = {};
            payload[id] = settings[id];
            window.NotifyOthers(SEEKBAR_SETTINGS_UPDATE, payload);
        } catch (e2) { reportFailure('the seekbar settings update could not be broadcast', e2); }
        return true;
    }

    function getSchema() {
        return [
            { id: "fontSummary", label: "Font source", type: "info", value: describeFont() },
            { id: "fontFamily", label: "Font family", type: "string", value: settings.fontFamily,
                hint: "Leave blank to use Columns UI \u203A Core: Console." },
            { id: "fontSize", label: "Font size", type: "number", value: settings.fontSize, min: 8, max: 24, step: 1,
                hidden: !settings.fontFamily },
            { id: "textColour", label: "Time label colour", type: "colour", value: settings.textColour },
            { id: "trackColour", label: "Seekbar track colour", type: "colour", value: settings.trackColour },
            { id: "barThickness", label: "Bar thickness", type: "number", value: settings.barThickness, min: 2, max: 16, step: 1 },
            { id: "alwaysShowThumb", label: "Always show seek handle", type: "bool", value: settings.alwaysShowThumb },
            { id: "showMidpointMark", label: "Show midpoint marker", type: "bool", value: settings.showMidpointMark },
            {
                id: "midpointStyle", label: "Midpoint marker style", type: "choice",
                value: settings.midpointStyle, choiceValueType: "string",
                choices: [
                    { value: "line", label: "Line" },
                    { value: "dot", label: "Dot" },
                    { value: "diamond", label: "Diamond" }
                ],
                hidden: !settings.showMidpointMark
            },
            {
                id: "showRemainingTime", label: "End-time label", type: "choice",
                value: settings.showRemainingTime ? "remaining" : "total", choiceValueType: "string",
                hint: "Click the end-time label to switch between track length and time remaining.",
                choices: [
                    { value: "total", label: "Track length" },
                    { value: "remaining", label: "Time remaining" }
                ]
            }
        ];
    }

    // CONSUME path - wired to SettingsRegistry.consume() by every host. Applies + persists +
    // repaints locally and deliberately does NOT re-broadcast: the settings screen's single
    // broadcastChange() already reached every host providing this PANEL_ID. See the header.
    function applySetting(id, value) {
        if (applyLocally(id, value)) repaintHost();
    }

    // ------------------------------------------------------------------------------------
    // Cross-panel settings sync (REQUEST/UPDATE handshake - see header comment)
    // ------------------------------------------------------------------------------------

    function requestSync() {
        try {
            window.NotifyOthers(SEEKBAR_SETTINGS_REQUEST, 0);
        } catch (e) {
            // No other panel loaded yet; this instance's own persisted/default values stand.
        }
    }

    function broadcastFullState() {
        try {
            window.NotifyOthers(SEEKBAR_SETTINGS_UPDATE, {
                fontFamily: settings.fontFamily,
                fontSize: settings.fontSize,
                textColour: settings.textColour,
                trackColour: settings.trackColour,
                barThickness: settings.barThickness,
                alwaysShowThumb: settings.alwaysShowThumb,
                showMidpointMark: settings.showMidpointMark,
                midpointStyle: settings.midpointStyle,
                showRemainingTime: settings.showRemainingTime
            });
        } catch (e) {
            // No other panel loaded; nothing to answer.
        }
    }

    // Returns true if the message was handled (host should stop processing on_notify_data
    // further for this call), same convention as SettingsRegistry.provide()/consume().
    function onNotifyData(name, info) {
        if (name === SEEKBAR_SETTINGS_REQUEST) {
            broadcastFullState();
            return true;
        }
        if (name === SEEKBAR_SETTINGS_UPDATE && info && typeof info === "object") {
            try {
                if (applyStateLocally(info)) repaintHost();
            } catch (e) { reportFailure('the seekbar settings update could not be applied', e); }
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------------------------
    // Geometry/drawing (verbatim port of topbar_panel.js's original inline seekbar)
    // ------------------------------------------------------------------------------------

    function roundRectRadius(w, h, preferred) {
        // GDI+'s FillRoundRect throws ("Arc argument has invalid value") if the corner
        // radius exceeds half of either side - which happens routinely here, since the
        // accent fill starts out much thinner than the track's own rounded ends.
        return Math.max(0, Math.min(preferred, w / 2, h / 2));
    }

    function formatSeekTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return "0:00";
        try {
            return utils.FormatDuration(seconds);
        } catch (e) {
            return "0:00";
        }
    }

    // The track occupies only the middle of the outer rect - a fixed-width time label is
    // reserved each side (elapsed left, total/remaining right). Hit-testing must use this
    // inner rect, so clicking a time label never seeks and the end label can be hit-tested
    // separately for the tap-to-toggle.
    function trackRect(outer) {
        var timeW = scale(38);
        var margin = scale(8);
        var trackX = outer.x + timeW + margin;
        var trackW = Math.max(10, outer.w - (timeW + margin) * 2);
        return { x: trackX, y: outer.y, w: trackW, h: outer.h, timeW: timeW, margin: margin };
    }

    // Hit-tests take an already-computed trackRect so the hot caller (onMouseMove, which
    // needs all three) allocates one rect per event instead of three. The *FromX/isOver*
    // wrappers below keep the convenient outer-only signature for cold call sites.
    function fractionFromRect(rect, x) {
        return sbClamp((x - rect.x) / Math.max(1, rect.w), 0, 1);
    }

    function isOverTrackRect(rect, outer, x, y) {
        var margin = scale(6);
        return x > rect.x - margin && x < rect.x + rect.w + margin &&
            y > outer.y - margin && y < outer.y + outer.h + margin;
    }

    function isOverEndTimeLabelRect(rect, outer, x, y) {
        var labelX = outer.x + outer.w - rect.timeW;
        return x >= labelX && x < labelX + rect.timeW &&
            y >= outer.y && y < outer.y + outer.h;
    }

    function drawMidpointMark(gr, rect, trackH, trackY, colour) {
        var cx = rect.x + Math.round(rect.w * 0.5);
        var cy = trackY + trackH / 2;
        var size;
        if (settings.midpointStyle === "dot") {
            size = Math.max(3, scale(3));
            gr.FillEllipse(cx - size / 2, cy - size / 2, size, size, colour);
        } else if (settings.midpointStyle === "diamond") {
            // Scale with the bar's own thickness (trackH, driven by
            // settings.barThickness) the same way the "line" style's tick
            // height already does below - otherwise a fat bar ends up with a
            // diamond sized for a thin one.
            size = Math.max(scale(4.5), trackH * 1.15);
            if (typeof gr.FillPolygon === "function") {
                gr.FillPolygon(colour, 1, [
                    cx, cy - size,
                    cx + size, cy,
                    cx, cy + size,
                    cx - size, cy
                ]);
            } else {
                gr.FillEllipse(cx - size / 2, cy - size / 2, size, size, colour);
            }
        } else {
            var tickH = Math.max(trackH * 2.2, scale(9));
            var tickY = rect.y + (rect.h - tickH) / 2;
            // One width for both the centring and the draw - these used to be scale(1) and
            // scale(1.5), leaving the tick off-centre by half the difference at every DPI.
            var tickW = Math.max(1, scale(1.5));
            gr.FillSolidRect(cx - tickW / 2, tickY, tickW, tickH, colour);
        }
    }

    // instance.mode ("seek"/"volume") is the persistent, middle-click-toggled state.
    // instance.rdrag is a right-button drag that always targets volume regardless of
    // mode (see instance.onRightMouseDown below) - both end up rendering off the same
    // dragFraction while active, so this is the one place either needs checking.
    function fraction(instance, playing, length, time) {
        if (instance.drag || instance.rdrag) return instance.dragFraction;
        if (instance.mode === "volume") {
            try {
                return sbVolumeToFraction(Number(fb.Volume));
            } catch (e) {
                return 0;
            }
        }
        if (!playing || length <= 0) return 0;
        return sbClamp(time / length, 0, 1);
    }

    function instanceShowsMidpoint(instance) {
        var override = instance ? instance.showMidpointMark : null;
        if (typeof override === "function") {
            try { override = override(); } catch (e) { override = null; }
        }
        return typeof override === "boolean" ? override : settings.showMidpointMark;
    }

    function draw(instance, gr, outer, accentColour) {
        var rect = trackRect(outer);
        var trackH = Math.max(2, scale(settings.barThickness));
        var trackY = rect.y + (rect.h - trackH) / 2;
        // Read each fb.* property ONCE per paint. This used to take about eight separate
        // host COM reads per frame between fraction() and the label block below, four times
        // a second per host. Reading once also means the labels can't disagree with the fill
        // because playback advanced mid-paint.
        var playing = false, length = 0, time = 0;
        try {
            playing = !!fb.IsPlaying;
            if (playing) {
                length = Number(fb.PlaybackLength) || 0;
                time = Number(fb.PlaybackTime) || 0;
            }
        } catch (e) {
            playing = false;
        }
        var frac = fraction(instance, playing, length, time);
        var fillW = Math.round(rect.w * frac);
        var radius = trackH / 2;
        var thumbD = Math.max(trackH * 2.4, scale(10));
        var thumbX, elapsedSeconds, totalSeconds, isStream, fillRadius;
        // Volume mode (persistent, or a momentary right-drag while still in seek mode)
        // replaces the elapsed/total time pair with the bar's fixed 0-100 scale, since
        // there's no "elapsed"/"total" concept for a volume slider.
        var showVolumeScale = instance.mode === "volume" || instance.rdrag;

        gr.FillRoundRect(rect.x, trackY, rect.w, trackH, roundRectRadius(rect.w, trackH, radius),
            roundRectRadius(rect.w, trackH, radius), settings.trackColour);
        if (fillW > 0) {
            fillRadius = roundRectRadius(fillW, trackH, radius);
            gr.FillRoundRect(rect.x, trackY, fillW, trackH, fillRadius, fillRadius, accentColour);
        }

        if (instanceShowsMidpoint(instance)) {
            drawMidpointMark(gr, rect, trackH, trackY, accentColour);
        }

        if (settings.alwaysShowThumb || instance.hover || instance.drag || instance.rdrag) {
            thumbX = rect.x + fillW - thumbD / 2;
            gr.FillEllipse(thumbX, rect.y + (rect.h - thumbD) / 2, thumbD, thumbD, accentColour);
        }

        if (currentFont && showVolumeScale) {
            gr.GdiDrawText("0", currentFont, settings.textColour,
                outer.x, outer.y, rect.timeW, outer.h,
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
            gr.GdiDrawText("100", currentFont, settings.textColour,
                outer.x + outer.w - rect.timeW, outer.y, rect.timeW, outer.h,
                DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        } else if (currentFont && playing) {
            // Internet radio and other live streams report a length of 0 (or unknown) -
            // there is no total to count down to, so show "Stream" instead of a bogus 0:00,
            // and never subtract from it for the remaining-time mode either.
            isStream = !(length > 0);
            totalSeconds = isStream ? 0 : length;
            elapsedSeconds = instance.drag ? (isStream ? 0 : totalSeconds * instance.dragFraction) : time;

            gr.GdiDrawText(formatSeekTime(elapsedSeconds), currentFont, settings.textColour,
                outer.x, outer.y, rect.timeW, outer.h,
                DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

            var endText;
            if (isStream) {
                endText = "Stream";
            } else if (settings.showRemainingTime) {
                endText = "-" + formatSeekTime(Math.max(0, totalSeconds - elapsedSeconds));
            } else {
                endText = formatSeekTime(totalSeconds);
            }
            gr.GdiDrawText(endText, currentFont, settings.textColour,
                outer.x + outer.w - rect.timeW, outer.y, rect.timeW, outer.h,
                DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        }
    }

    function fractionFromX(outer, x) {
        return fractionFromRect(trackRect(outer), x);
    }

    function isOverTrack(outer, x, y) {
        return isOverTrackRect(trackRect(outer), outer, x, y);
    }

    function isOverEndTimeLabel(outer, x, y) {
        return isOverEndTimeLabelRect(trackRect(outer), outer, x, y);
    }

    // ------------------------------------------------------------------------------------
    // Per-instance object
    // ------------------------------------------------------------------------------------

    function createInstance(options) {
        options = options || {};
        return {
            hover: false,
            // null/undefined = use the shared Seekbar setting. A boolean or a
            // callback gives one host a local visibility override while still
            // sharing the mark style, colours and all other appearance options.
            showMidpointMark: options.showMidpointMark,

            // Persistent mode, flipped by a middle-click over the track (see
            // onMiddleClick below). "seek" is the original/default behaviour;
            // "volume" makes left-drag control fb.Volume instead of playback
            // position, and swaps the time labels for a fixed 0-100 scale.
            mode: "seek",

            // Left-button drag state. dragMode is snapshotted from `mode` at
            // mousedown time, so a mode flip mid-drag (middle-click while the
            // left button is somehow also down) can't retarget an in-flight drag.
            drag: false,
            dragMode: "seek",
            dragFraction: 0,

            // Right-button drag state - independent of `mode`/`drag`: right-click-
            // dragging the bar always adjusts volume, even while `mode` is "seek",
            // so both mechanisms from the combined-mode design work at once.
            rdrag: false,

            draw: function (gr, outer, accentColour) {
                if (!outer || outer.w <= 0 || outer.h <= 0) return;
                draw(this, gr, outer, accentColour);
            },

            // Returns { changed, hot } - "changed" means the caller should repaint,
            // "hot" means the caller should probably show a hand cursor.
            onMouseMove: function (outer, x, y) {
                var changed = false, nextHover, rect;
                if (!outer) {
                    if (this.hover) { this.hover = false; changed = true; }
                    return { changed: changed, hot: false };
                }
                // One trackRect for all three hit-tests below - this is the highest-frequency
                // callback in the file, and it used to build three per event.
                rect = trackRect(outer);
                if (this.drag) {
                    this.dragFraction = fractionFromRect(rect, x);
                    if (this.dragMode === "volume") applyVolumeFraction(this.dragFraction);
                    changed = true;
                }
                if (this.rdrag) {
                    this.dragFraction = fractionFromRect(rect, x);
                    applyVolumeFraction(this.dragFraction);
                    changed = true;
                }
                nextHover = isOverTrackRect(rect, outer, x, y);
                if (nextHover !== this.hover) { this.hover = nextHover; changed = true; }
                return {
                    changed: changed,
                    hot: this.hover || this.drag || this.rdrag ||
                        isOverEndTimeLabelRect(rect, outer, x, y)
                };
            },

            onMouseLeave: function () {
                var changed = this.hover;
                this.hover = false;
                return changed;
            },

            // Returns true if the widget grabbed the drag (host should treat the click as
            // handled and not test other hit targets). In "volume" mode this is a live
            // slider - it applies immediately on press, same as VolumeBarWidget.
            onMouseDown: function (outer, x, y) {
                if (!outer || !isOverTrack(outer, x, y)) return false;
                this.drag = true;
                this.dragMode = this.mode === "volume" ? "volume" : "seek";
                this.dragFraction = fractionFromX(outer, x);
                if (this.dragMode === "volume") applyVolumeFraction(this.dragFraction);
                return true;
            },

            // Returns true if this call handled the mouse-up (a drag release that committed
            // a seek or volume change, OR a tap on the end-time label toggling total/
            // remaining display - the latter only applies in "seek" mode).
            onMouseUp: function (outer, x, y) {
                if (this.drag) {
                    this.drag = false;
                    if (this.dragMode === "volume") {
                        applyVolumeFraction(this.dragFraction);
                    } else {
                        // Guarded like every other host call in this file - a mouse-up
                        // racing an unload must not throw into the host's button handler.
                        try {
                            if (fb.IsPlaying && fb.PlaybackLength > 0) {
                                fb.PlaybackTime = fb.PlaybackLength * this.dragFraction;
                            }
                        } catch (e) {
                            // Host is unloading; the seek is simply dropped.
                        }
                    }
                    return true;
                }
                if (this.mode !== "volume" && outer && isOverEndTimeLabel(outer, x, y)) {
                    // Local edit, so this one DOES sync to the sibling host - see the header.
                    setAndSync("showRemainingTime", !settings.showRemainingTime);
                    return true;
                }
                return false;
            },

            // Right-button drag: always targets volume, regardless of `mode`, and
            // applies live (press-to-jump, then continuous update via onMouseMove
            // above) rather than committing only on release - matching how a
            // volume slider is expected to behave. Returns true if grabbed.
            onRightMouseDown: function (outer, x, y) {
                if (this.drag) return false;
                if (!outer || !isOverTrack(outer, x, y)) return false;
                this.rdrag = true;
                this.dragFraction = fractionFromX(outer, x);
                applyVolumeFraction(this.dragFraction);
                return true;
            },

            // Returns true if this call handled the right-button release (i.e. a
            // right-drag was in progress and is now committed).
            onRightMouseUp: function (outer, x, y) {
                if (!this.rdrag) return false;
                this.rdrag = false;
                if (outer) {
                    this.dragFraction = fractionFromX(outer, x);
                    applyVolumeFraction(this.dragFraction);
                }
                return true;
            },

            // Middle-click over the track permanently flips between "seek" and
            // "volume" mode. Cancels any in-flight drag so a mode change mid-drag
            // can't leave dragMode pointing at the wrong axis. Returns true if the
            // click landed on the track (host should treat it as handled).
            onMiddleClick: function (outer, x, y) {
                if (!outer || !isOverTrack(outer, x, y)) return false;
                this.mode = this.mode === "volume" ? "seek" : "volume";
                this.drag = false;
                this.rdrag = false;
                return true;
            },

            // What the in-progress drag will commit to ("" when idle) - hosts poll
            // this from on_mouse_move for a drag tooltip ("1:23" seeking, "62%" for
            // volume). Lives here so it shares formatSeekTime() and the exact
            // dragFraction the fill and thumb render from.
            dragValueText: function () {
                if (this.drag && this.dragMode === "seek") {
                    if (!fb.IsPlaying || fb.PlaybackLength <= 0) return "";
                    return formatSeekTime(fb.PlaybackLength * sbClamp(this.dragFraction, 0, 1));
                }
                if ((this.drag && this.dragMode === "volume") || this.rdrag) {
                    return Math.round(sbClamp(this.dragFraction, 0, 1) * 100) + "%";
                }
                return "";
            }
        };
    }

    var PANEL_ID = "seekbar";
    var PANEL_LABEL = "Seekbar";

    return {
        // Backs the re-entry guard at the top, so this is load-bearing rather than a
        // constant nothing reads (which is how it silently drifted before).
        version: SEEKBAR_WIDGET_VERSION,
        PANEL_ID: PANEL_ID,
        PANEL_LABEL: PANEL_LABEL,
        settings: settings,

        create: createInstance,

        setDpi: function (value) {
            var next = Math.max(50, Math.round(Number(value) || 100));
            if (next !== dpi) dpi = next;
            // Rebuild even when DPI is unchanged so an inherited Core: Console
            // font change is picked up immediately from on_font_changed().
            rebuildFont();
        },
        refreshFont: rebuildFont,
        resolvedFontInfo: resolvedFontInfo,
        describeFont: describeFont,
        minimumOuterHeight: minimumOuterHeight,

        getSchema: getSchema,
        // Wire THIS to SettingsRegistry.consume() - it never re-broadcasts.
        applySetting: applySetting,
        // Use this for a host's own local edit (its right-click menu, a one-time property
        // migration) - it applies locally AND tells the sibling host, once. Using
        // applySetting for a local edit leaves the sibling unaware, and the startup
        // requestSync() handshake can then overwrite the edit with the sibling's stale value.
        setAndSync: setAndSync,
        onNotifyData: onNotifyData,
        requestSync: requestSync
    };
}(typeof SeekbarWidget !== "undefined" ? SeekbarWidget : null));
