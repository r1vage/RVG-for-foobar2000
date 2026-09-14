// Shared Seekbar widget. create() returns a per-instance drawable (geometry,
// drag state, label metrics); appearance is ONE config shared by every host.
//
// Top Bar, Controls and Mini Player all provide PANEL_ID "seekbar", so the
// settings screen's single broadcastChange() already reaches all of them:
// applySetting() (the consume() path) must never re-broadcast, or the hosts
// echo forever. Local edits go through setAndSync() instead, which sends
// exactly one update. Same rule as shared/tab_bar_style.js - long version in
// its header and in SHARED_LIBRARIES.md convention #4.


var SEEKBAR_WIDGET_VERSION = "2.7.1";
var SEEKBAR_SETTINGS_REQUEST = "RIVAGE.SEEKBAR_SETTINGS.REQUEST";
var SEEKBAR_SETTINGS_UPDATE = "RIVAGE.SEEKBAR_SETTINGS.UPDATE";

// Re-entry guard: a second include() must not swap `settings` for a fresh
// object under a host still holding the old one.
var SeekbarWidget = (function (existing) {
    if (existing && existing.version) return existing;

    // For the few empty catches that would otherwise leave no trace.
    // Repeats are re-logged only at powers of ten.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[SeekbarWidget] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    // Prefixed helpers: hosts declare their own RGB()/DT_* with different
    // shapes, so this file assumes nothing about host globals.

    var DT_LEFT = 0x00000000;
    var DT_CENTER = 0x00000001;
    var DT_RIGHT = 0x00000002;
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

    // Corrected inverse of vendor/Helpers.js's vol2pos() (typo'd there).
    // Duplicated in volume_bar_widget.js on purpose - neither depends on the other.
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
        // Caching a null would make one transient failure permanent.
        if (font) fontCache[key] = font;
        return font;
    }

    // Shared, cross-instance, cross-panel appearance settings.

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
        // Toggled live by tap-on-end-time; the schema row is just the start value.
        showRemainingTime: !!window.GetProperty(PROPERTY_PREFIX + "Show remaining time", false)
    };

    // One-shot upgrade of the old default (Segoe UI 11) to inherited
    // Core: Console. An explicit custom family/size survives it.
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

    // Resolved locally, not through RivageUI: Top Bar includes this file
    // before design_system.js, so depending on it here breaks at include-time.
    // CUI: Display > Columns UI > Colours and fonts > Fonts > Core: Console.
    // DUI: Display > Default User Interface > Fonts > Console.
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

    // Label placement. Per-instance overrides, each a value or a callback;
    // sizes unscaled, this widget applies its own DPI. Reserved boxes are the
    // same either way, so hit-testing never depends on these.
    //   labelWidth      reserved box per side                     (default 38)
    //   labelGap        space between box and track               (default 4)
    //   labelsHugTrack  false = labels back out at the panel edges (default true)
    //   fontSize        label size, keeping the resolved family   (default 0 = shared)

    function instanceOption(instance, key) {
        var value = instance ? instance[key] : null;
        if (typeof value === "function") {
            try { value = value(); } catch (e) { value = null; }
        }
        if (value === true || value === false) return value;
        value = Number(value);
        return isFinite(value) && value > 0 ? value : 0;
    }

    // Per instance, so two hosts at different sizes don't evict each other.
    function instanceFont(instance) {
        var size = Math.round(instanceOption(instance, "fontSize"));
        var family, style, cache;
        if (!size || !currentFontInfo) return currentFont;

        size = Math.max(1, scale(size));
        family = String(currentFontInfo.fontFamily || "Segoe UI");
        style = currentFontInfo.fontStyle || 0;
        if (size === Number(currentFontInfo.fontSize)) return currentFont;

        cache = instance && instance.fontCache;
        if (cache && cache.font && cache.size === size &&
            cache.family === family && cache.style === style) {
            return cache.font;
        }

        cache = { size: size, family: family, style: style, font: sbFont(family, size, style) };
        if (instance) instance.fontCache = cache;
        return cache.font || currentFont;
    }

    // Core: Console keeps its real host size even when the panel scales down,
    // so a fixed row height clips it. Pass the instance when it overrides
    // fontSize, so the row is reserved for what will actually be drawn.
    function minimumOuterHeight(instance) {
        var fontHeight = 0;
        var font = instance ? instanceFont(instance) : currentFont;
        var override = instance ? Math.round(instanceOption(instance, "fontSize")) : 0;
        var fontSize = override > 0
            ? Math.max(1, scale(override))
            : (currentFontInfo && Number(currentFontInfo.fontSize) > 0
                ? Number(currentFontInfo.fontSize)
                : scale(settings.fontSize || 11));
        try {
            fontHeight = Number(font && font.Height) || 0;
        } catch (e) {
            fontHeight = 0;
        }
        // Some hosts report Font.Height as the em size, not the line box.
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

    // LOCAL-EDIT path (see header). Applies locally and sends exactly one
    // update. Do NOT route consume() through here.
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

    // CONSUME path (see header). Applies locally, never re-broadcasts.
    function applySetting(id, value) {
        if (applyLocally(id, value)) repaintHost();
    }

    // Cross-panel settings sync: REQUEST/UPDATE handshake.

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

    // True = handled; same convention as SettingsRegistry.provide()/consume().
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

    // Geometry/drawing.

    function roundRectRadius(w, h, preferred) {
        // FillRoundRect throws if the radius exceeds half of either side, which
        // the thin early accent fill does routinely.
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

    // The track is only the middle of the outer rect; a label box is reserved
    // each side. Hit-testing must use this inner rect so a label never seeks.
    function trackRect(outer, instance) {
        var timeW = scale(instanceOption(instance, "labelWidth") || 38);
        var margin = scale(instanceOption(instance, "labelGap") || 4);
        var trackX = outer.x + timeW + margin;
        var trackW = Math.max(10, outer.w - (timeW + margin) * 2);
        return { x: trackX, y: outer.y, w: trackW, h: outer.h, timeW: timeW, margin: margin };
    }

    // Take a pre-computed trackRect so onMouseMove allocates one per event, not
    // three; the wrappers below keep the outer-only signature for cold callers.
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
            // Scale with trackH, as the "line" tick does, or a fat bar gets a
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
            // One width for both centring and draw, or the tick sits off-centre.
            var tickW = Math.max(1, scale(1.5));
            gr.FillSolidRect(cx - tickW / 2, tickY, tickW, tickH, colour);
        }
    }

    // Persistent mode and a right-drag both render off dragFraction, so this is
    // the one place either needs checking.
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
        var rect = trackRect(outer, instance);
        var trackH = Math.max(2, scale(settings.barThickness));
        var trackY = rect.y + (rect.h - trackH) / 2;
        // Read each fb.* ONCE per paint: ~8 COM reads per frame otherwise, and
        // the labels can't disagree with the fill mid-paint.
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
        // Volume mode has no elapsed/total, so the pair becomes a 0-100 scale.
        var showVolumeScale = instance.mode === "volume" || instance.rdrag;
        // Hug = align each label to the inner edge of its box. On by default.
        var hug = instanceOption(instance, "labelsHugTrack") !== false;
        var labelFont = instanceFont(instance);
        var startFlags = (hug ? DT_RIGHT : DT_LEFT) | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;
        var endFlags = (hug ? DT_LEFT : DT_CENTER) | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;

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

        if (labelFont && showVolumeScale) {
            gr.GdiDrawText("0", labelFont, settings.textColour,
                outer.x, outer.y, rect.timeW, outer.h, startFlags);
            gr.GdiDrawText("100", labelFont, settings.textColour,
                outer.x + outer.w - rect.timeW, outer.y, rect.timeW, outer.h, endFlags);
        } else if (labelFont && playing) {
            // Streams report length 0: show "Stream", never a bogus 0:00 or a
            // countdown from it.
            isStream = !(length > 0);
            totalSeconds = isStream ? 0 : length;
            elapsedSeconds = instance.drag ? (isStream ? 0 : totalSeconds * instance.dragFraction) : time;

            gr.GdiDrawText(formatSeekTime(elapsedSeconds), labelFont, settings.textColour,
                outer.x, outer.y, rect.timeW, outer.h, startFlags);

            var endText;
            if (isStream) {
                endText = "Stream";
            } else if (settings.showRemainingTime) {
                endText = "-" + formatSeekTime(Math.max(0, totalSeconds - elapsedSeconds));
            } else {
                endText = formatSeekTime(totalSeconds);
            }
            gr.GdiDrawText(endText, labelFont, settings.textColour,
                outer.x + outer.w - rect.timeW, outer.y, rect.timeW, outer.h, endFlags);
        }
    }

    function fractionFromX(outer, x, instance) {
        return fractionFromRect(trackRect(outer, instance), x);
    }

    function isOverTrack(outer, x, y, instance) {
        return isOverTrackRect(trackRect(outer, instance), outer, x, y);
    }

    function isOverEndTimeLabel(outer, x, y, instance) {
        return isOverEndTimeLabelRect(trackRect(outer, instance), outer, x, y);
    }

    // Per-instance object.

    function createInstance(options) {
        options = options || {};
        return {
            hover: false,
            // null = the shared setting; a boolean/callback overrides visibility
            // only, still sharing the mark's style and colours.
            showMidpointMark: options.showMidpointMark,

            // Label placement - see the block above; omit for the defaults.
            labelWidth: options.labelWidth,
            labelGap: options.labelGap,
            labelsHugTrack: options.labelsHugTrack,
            fontSize: options.fontSize,
            fontCache: null,

            // Persistent, flipped by middle-click: "volume" retargets left-drag
            // at fb.Volume and swaps the labels for a 0-100 scale.
            mode: "seek",

            // dragMode is snapshotted at mousedown, so a mode flip mid-drag
            // cannot retarget an in-flight drag.
            drag: false,
            dragMode: "seek",
            dragFraction: 0,

            // Independent of `mode`: a right-drag always adjusts volume.
            rdrag: false,

            draw: function (gr, outer, accentColour) {
                if (!outer || outer.w <= 0 || outer.h <= 0) return;
                draw(this, gr, outer, accentColour);
            },

            // { changed: repaint, hot: hand cursor }.
            onMouseMove: function (outer, x, y) {
                var changed = false, nextHover, rect;
                if (!outer) {
                    if (this.hover) { this.hover = false; changed = true; }
                    return { changed: changed, hot: false };
                }
                // One trackRect for all three hit-tests - hottest callback here.
                rect = trackRect(outer, this);
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

            // True = grabbed, host stops hit-testing. Volume mode applies on press.
            onMouseDown: function (outer, x, y) {
                if (!outer || !isOverTrack(outer, x, y, this)) return false;
                this.drag = true;
                this.dragMode = this.mode === "volume" ? "volume" : "seek";
                this.dragFraction = fractionFromX(outer, x, this);
                if (this.dragMode === "volume") applyVolumeFraction(this.dragFraction);
                return true;
            },

            // True = handled: a committed drag, or a tap on the end-time label.
            onMouseUp: function (outer, x, y) {
                if (this.drag) {
                    this.drag = false;
                    if (this.dragMode === "volume") {
                        applyVolumeFraction(this.dragFraction);
                    } else {
                        // A mouse-up racing an unload must not throw into the host.
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
                if (this.mode !== "volume" && outer && isOverEndTimeLabel(outer, x, y, this)) {
                    // Local edit, so this one DOES sync - see the header.
                    setAndSync("showRemainingTime", !settings.showRemainingTime);
                    return true;
                }
                return false;
            },

            // Always volume, applied live rather than on release. True = grabbed.
            onRightMouseDown: function (outer, x, y) {
                if (this.drag) return false;
                if (!outer || !isOverTrack(outer, x, y, this)) return false;
                this.rdrag = true;
                this.dragFraction = fractionFromX(outer, x, this);
                applyVolumeFraction(this.dragFraction);
                return true;
            },

            // True = a right-drag was in progress and is now committed.
            onRightMouseUp: function (outer, x, y) {
                if (!this.rdrag) return false;
                this.rdrag = false;
                if (outer) {
                    this.dragFraction = fractionFromX(outer, x, this);
                    applyVolumeFraction(this.dragFraction);
                }
                return true;
            },

            // Flips mode for good, cancelling any in-flight drag so dragMode
            // can't end up on the wrong axis. True = landed on the track.
            onMiddleClick: function (outer, x, y) {
                if (!outer || !isOverTrack(outer, x, y, this)) return false;
                this.mode = this.mode === "volume" ? "seek" : "volume";
                this.drag = false;
                this.rdrag = false;
                return true;
            },

            // What the drag will commit to ("" when idle), for a host tooltip.
            // Lives here to share formatSeekTime() and the rendered dragFraction.
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
        // Load-bearing: backs the re-entry guard at the top.
        version: SEEKBAR_WIDGET_VERSION,
        PANEL_ID: PANEL_ID,
        PANEL_LABEL: PANEL_LABEL,
        settings: settings,

        create: createInstance,

        setDpi: function (value) {
            var next = Math.max(50, Math.round(Number(value) || 100));
            if (next !== dpi) dpi = next;
            // Rebuild even at the same DPI, for on_font_changed().
            rebuildFont();
        },
        refreshFont: rebuildFont,
        resolvedFontInfo: resolvedFontInfo,
        describeFont: describeFont,
        minimumOuterHeight: minimumOuterHeight,

        getSchema: getSchema,
        // Wire THIS to SettingsRegistry.consume() - it never re-broadcasts.
        applySetting: applySetting,
        // Use this for a host's own local edit. applySetting there leaves the
        // sibling stale, and requestSync() can then undo the edit.
        setAndSync: setAndSync,
        onNotifyData: onNotifyData,
        requestSync: requestSync
    };
}(typeof SeekbarWidget !== "undefined" ? SeekbarWidget : null));
