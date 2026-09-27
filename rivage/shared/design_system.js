'use strict';

// RVG shared visual design system for foobar2000 JSplitter / JScript Panel.
//
// Lives at jsplitter\rivage\shared\design_system.js. Include it after
// `window.DrawMode = 0` and before creating panel fonts:
//   include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
//
// This module owns visual tokens/drawing primitives plus the small canonical
// user-facing copy vocabulary used by shared choice builders and native panel
// destinations. It does not register window callbacks, manage panel state, read
// properties, extract album colours, or perform actions. Each panel remains
// responsible for its own data, layout, events, settings, and repaint policy.
//
// GEOMETRY IS WHOLE-PIXEL SNAPPED. Every painter primitive (fillRoundRect,
// drawRoundRect, card, selector, pill, chip, iconButton, tooltip, tooltipBox,
// scrollbar) routes its rect through makeRect(), which Math.rounds x/y/w/h.
// Never animate geometry through these - snapping an animating axis is what
// caused the spectrum bar stutter. Draw animated shapes with raw gr.* calls.

var RVG_RELEASE = {
    name: 'RVG',
    fullName: 'RVG skin for foobar2000',
    author: 'RivaGe',
    version: '1.0.0'
};

var RivageUI = (function (existing) {
    if (existing && existing.version) {
        if (!existing.release) existing.release = RVG_RELEASE;
        return existing;
    }

    var api = {};
    var fontCache = {};
    var sharedThemePayload = null;

    function normaliseSharedThemePayload(payload) {
        var copy;
        try {
            copy = JSON.parse(JSON.stringify(payload || {}));
        } catch (e) {
            return null;
        }
        copy.mode = String(copy.mode || 'existing').toLowerCase();
        if (['existing', 'host', 'dark', 'light', 'album-auto', 'album-dark', 'album-light', 'mica'].indexOf(copy.mode) < 0) {
            copy.mode = 'existing';
        }
        return copy;
    }

    function setSharedTheme(payload) {
        sharedThemePayload = normaliseSharedThemePayload(payload);
        return sharedThemePayload;
    }

    function getSharedTheme() {
        return sharedThemePayload;
    }

    var CUI_FONT_GUIDS = {
        coreDefault: '{1ADBC094-3B35-4BAB-82D5-3BDD4A5C6AF9}',
        coreConsole: '{E9F4D060-6FEB-4626-B25D-BA090F75F7A5}'
    };

    var FONT_TYPE_CUI = { items: 0, labels: 1 };
    var FONT_TYPE_DUI = { defaults: 0, tabs: 1, console: 5 };
    var COLOUR_TYPE_CUI = { text: 0, background: 3 };
    var COLOUR_TYPE_DUI = { text: 0, background: 1, highlight: 2 };

    var SMOOTHING_MODE_DEFAULT = 0;
    var SMOOTHING_MODE_ANTIALIAS = 4;

    function clamp(value, minimum, maximum) {
        value = Number(value);
        if (!isFinite(value)) value = minimum;
        return Math.max(minimum, Math.min(maximum, value));
    }

    function rgb(red, green, blue) {
        return (
            0xff000000 |
            ((clamp(Math.round(red), 0, 255) & 0xff) << 16) |
            ((clamp(Math.round(green), 0, 255) & 0xff) << 8) |
            (clamp(Math.round(blue), 0, 255) & 0xff)
        ) >>> 0;
    }

    function rgba(red, green, blue, alpha) {
        return (
            ((clamp(Math.round(alpha), 0, 255) & 0xff) << 24) |
            ((clamp(Math.round(red), 0, 255) & 0xff) << 16) |
            ((clamp(Math.round(green), 0, 255) & 0xff) << 8) |
            (clamp(Math.round(blue), 0, 255) & 0xff)
        ) >>> 0;
    }

    function channel(colour, shift) {
        return (Number(colour) >>> shift) & 0xff;
    }

    // amount = 0 returns first; amount = 1 returns second. Preserve alpha as
    // well as RGB so semantic translucent surfaces stay translucent when a
    // painter derives hover/pressed/selected colours from them. Opaque inputs
    // still produce the exact same 0xff-alpha result as before.
    function mix(first, second, amount) {
        amount = clamp(amount, 0, 1);
        return rgba(
            channel(first, 16) + (channel(second, 16) - channel(first, 16)) * amount,
            channel(first, 8) + (channel(second, 8) - channel(first, 8)) * amount,
            channel(first, 0) + (channel(second, 0) - channel(first, 0)) * amount,
            channel(first, 24) + (channel(second, 24) - channel(first, 24)) * amount
        );
    }

    function opaque(colour) {
        return ((Number(colour) & 0x00ffffff) | 0xff000000) >>> 0;
    }

    function withAlpha(colour, alpha) {
        return ((Number(colour) & 0x00ffffff) | ((clamp(alpha, 0, 255) & 0xff) << 24)) >>> 0;
    }

    function luminance(colour) {
        return channel(colour, 16) * 0.2126 +
            channel(colour, 8) * 0.7152 +
            channel(colour, 0) * 0.0722;
    }

    // WCAG-style relative luminance and contrast helpers. The older luminance()
    // function above remains useful for broad dark/light theme classification;
    // these gamma-corrected helpers are used when foreground readability matters.
    function relativeLuminance(colour) {
        function linearise(value) {
            value = value / 255;
            return value <= 0.04045
                ? value / 12.92
                : Math.pow((value + 0.055) / 1.055, 2.4);
        }

        return linearise(channel(colour, 16)) * 0.2126 +
            linearise(channel(colour, 8)) * 0.7152 +
            linearise(channel(colour, 0)) * 0.0722;
    }

    function contrastRatio(first, second) {
        var firstLuminance = relativeLuminance(first);
        var secondLuminance = relativeLuminance(second);
        var lighter = Math.max(firstLuminance, secondLuminance);
        var darker = Math.min(firstLuminance, secondLuminance);
        return (lighter + 0.05) / (darker + 0.05);
    }

    // Prefer the light foreground while it remains comfortably readable. When
    // an album-art accent is pale, choose the dark foreground instead of altering
    // the accent itself. A 3:1 threshold is appropriate for the large play glyph.
    function contrastingForegroundForBackgrounds(backgrounds, lightForeground, darkForeground, minimumLightContrast) {
        var list = Array.isArray(backgrounds) ? backgrounds : [backgrounds];
        var light = opaque(lightForeground !== undefined ? lightForeground : rgb(255, 255, 255));
        var dark = opaque(darkForeground !== undefined ? darkForeground : rgb(28, 28, 30));
        var minimum = clamp(
            minimumLightContrast !== undefined ? minimumLightContrast : 3,
            1,
            21
        );
        var lightMinimum = 21;
        var darkMinimum = 21;
        var i;

        for (i = 0; i < list.length; i++) {
            lightMinimum = Math.min(lightMinimum, contrastRatio(list[i], light));
            darkMinimum = Math.min(darkMinimum, contrastRatio(list[i], dark));
        }

        if (lightMinimum >= minimum) return light;
        return darkMinimum >= lightMinimum ? dark : light;
    }

    // Whole-pixel snapping is deliberate and load-bearing for crisp GDI+ edges.
    // See the header: never route animating geometry through anything that
    // calls this.
    function makeRect(x, y, width, height) {
        return {
            x: Math.round(Number(x) || 0),
            y: Math.round(Number(y) || 0),
            w: Math.max(0, Math.round(Number(width) || 0)),
            h: Math.max(0, Math.round(Number(height) || 0))
        };
    }

    function pointInRect(x, y, rect) {
        return !!rect &&
            x >= rect.x && y >= rect.y &&
            x < rect.x + rect.w && y < rect.y + rect.h;
    }

    // on_paint(gr, x, y, w, h) update rect (JSplitter 4.2+). null = whole panel,
    // which is also what an older host that passes only gr gets.
    function paintArea(x, y, width, height, panelWidth, panelHeight) {
        var w = Number(width);
        var h = Number(height);
        if (!(w > 0) || !(h > 0)) return null;
        x = Number(x) || 0;
        y = Number(y) || 0;
        if (x <= 0 && y <= 0 && x + w >= panelWidth && y + h >= panelHeight) return null;
        return { x: x, y: y, w: w, h: h };
    }

    // pad covers ink a section draws past its own rect (seekbar thumb, rims).
    function areaHits(area, rect, pad) {
        if (!area) return true;
        if (!rect) return false;
        pad = pad || 0;
        return rect.x - pad < area.x + area.w && area.x < rect.x + rect.w + pad &&
            rect.y - pad < area.y + area.h && area.y < rect.y + rect.h + pad;
    }

    function defaultScale(value) {
        if (Number(value) === 0) return 0;
        return Math.max(1, Math.round(Number(value) || 0));
    }

    function safeScale(scaleFunction, value) {
        if (Number(value) === 0) return 0;
        try {
            return Math.max(1, Math.round(scaleFunction(Number(value))));
        } catch (e) {
            return defaultScale(value);
        }
    }

    function safeFont(name, size, style) {
        var family = String(name || 'Segoe UI');
        var pixelSize = Math.max(1, Math.min(300, Math.round(Number(size) || 1)));
        var fontStyle = Math.round(Number(style) || 0);
        var key = family.toLowerCase() + '|' + pixelSize + '|' + fontStyle;
        var font = null;

        if (fontCache[key]) return fontCache[key];

        try {
            if (typeof gdi !== 'undefined' && gdi && typeof gdi.Font === 'function') {
                font = gdi.Font(family, pixelSize, fontStyle);
            }
        } catch (e) {
            font = null;
        }

        if (!font && family.toLowerCase() !== 'segoe ui') {
            try {
                if (typeof gdi !== 'undefined' && gdi && typeof gdi.Font === 'function') {
                    font = gdi.Font('Segoe UI', pixelSize, fontStyle);
                }
            } catch (e2) {
                font = null;
            }
        }

        // Only cache a real font. Caching a null would make one transient
        // gdi.Font() failure permanent for that key for the whole session.
        if (font) fontCache[key] = font;
        return font;
    }

    function clearFontCache() {
        fontCache = {};
    }

    // Lazy-singleton 1x1 GDI surface: CalcTextWidth needs a live graphics
    // instance, and layout/marquee code often runs before a paint's `gr`
    // exists. Shared so panels stop rebuilding a GdiBitmap + Graphics per
    // call (a marquee timer tick made that a real per-frame allocation).
    var measureBitmap = null;
    var measureGraphics = null;

    function measureGraphicsContext() {
        if (!measureGraphics) {
            try {
                measureBitmap = gdi.CreateImage(1, 1);
                measureGraphics = measureBitmap.GetGraphics();
            } catch (e) {
                measureBitmap = null;
                measureGraphics = null;
            }
        }
        return measureGraphics;
    }

    function measureText(text, font, exact) {
        text = String(text == null ? '' : text);
        if (!text || !font) return 0;
        var gr = measureGraphicsContext();
        if (!gr) return 0;
        try {
            return exact
                ? gr.CalcTextWidth(text, font, true)
                : Math.ceil(gr.CalcTextWidth(text, font));
        } catch (e) {
            return 0;
        }
    }

    function fontExists(name) {
        try {
            return typeof utils !== 'undefined' && utils &&
                typeof utils.CheckFont === 'function' && utils.CheckFont(name);
        } catch (e) {
            return false;
        }
    }

    // Two uncached utils.CheckFont calls per invocation - call from
    // update_fonts()/on_font_changed, never from on_paint.
    function iconFontFamily() {
        if (fontExists('Segoe Fluent Icons')) return 'Segoe Fluent Icons';
        if (fontExists('Segoe MDL2 Assets')) return 'Segoe MDL2 Assets';
        return 'Segoe MDL2 Assets';
    }

    // Three to five host COM calls per invocation, uncached (this module owns
    // no callbacks, so it cannot know when to invalidate). Call from
    // update_colours()/on_colours_changed, never from on_paint.
    function hostInfo() {
        var result = {
            background: rgb(24, 24, 26),
            text: rgb(245, 245, 245),
            accent: rgb(0, 120, 212),
            fontFamily: 'Segoe UI',
            scaleFontSize: 12,
            dark: true
        };
        var scaleFont = null;
        var familyFont = null;

        try {
            if (typeof window !== 'undefined' && window && window.InstanceType === 1) {
                result.background = window.GetColourDUI(COLOUR_TYPE_DUI.background);
                result.text = window.GetColourDUI(COLOUR_TYPE_DUI.text);
                result.accent = window.GetColourDUI(COLOUR_TYPE_DUI.highlight);
                scaleFont = window.GetFontDUI(FONT_TYPE_DUI.defaults);
                familyFont = scaleFont;
            } else if (typeof window !== 'undefined' && window) {
                result.background = window.GetColourCUI(COLOUR_TYPE_CUI.background);
                result.text = window.GetColourCUI(COLOUR_TYPE_CUI.text);
                result.accent = mix(result.text, result.background, 0.35);
                scaleFont = window.GetFontCUI(FONT_TYPE_CUI.items);
                try {
                    familyFont = window.GetFontCUI(
                        FONT_TYPE_CUI.items,
                        CUI_FONT_GUIDS.coreDefault
                    );
                } catch (fontError) {
                    familyFont = null;
                }
            }
        } catch (e) {
            // Keep the stable fallback values.
        }

        if (!familyFont) familyFont = scaleFont;
        if (familyFont && familyFont.Name) result.fontFamily = String(familyFont.Name);
        if (scaleFont && Number(scaleFont.Size) > 0) result.scaleFontSize = Number(scaleFont.Size);
        result.background = opaque(result.background);
        result.text = opaque(result.text);
        result.accent = opaque(result.accent);
        result.dark = luminance(result.background) < 128;
        return result;
    }

    function hostFontFamily() {
        return hostInfo().fontFamily;
    }

    function fontInfoFromHostFont(font, fallbackFamily, fallbackSize, source) {
        var result = {
            fontFamily: String(fallbackFamily || 'Segoe UI'),
            fontSize: Math.max(1, Math.round(Number(fallbackSize) || 12)),
            fontStyle: 0,
            source: String(source || '')
        };
        try {
            if (font && font.Name) result.fontFamily = String(font.Name);
            if (font && Number(font.Size) > 0) result.fontSize = Math.max(1, Math.round(Number(font.Size)));
            if (font && isFinite(Number(font.Style))) result.fontStyle = Math.round(Number(font.Style));
        } catch (e) {
            // Keep the stable fallback descriptor.
        }
        return result;
    }

    // Exact host font clients used by RVG components that are intentionally
    // tied to a specific foobar2000 font preference rather than the generic
    // Core: Default family returned by hostInfo().
    //
    // Columns UI:
    //   commonLabelsFontInfo() -> Preferences > Display > Columns UI > Colours and fonts > Fonts > Common (labels)
    //   consoleFontInfo()      -> Preferences > Display > Columns UI > Colours and fonts > Fonts > Core: Console
    // Default UI has no "Common (labels)" bucket, so its Tabs font is the
    // closest semantic equivalent; Console maps directly to the DUI Console font.
    function specificHostFontInfo(kind) {
        var fallback = hostInfo();
        var font = null;
        var source = '';

        try {
            if (typeof window !== 'undefined' && window && window.InstanceType === 1) {
                if (kind === 'console') {
                    font = window.GetFontDUI(FONT_TYPE_DUI.console);
                    source = 'Default UI: Console';
                } else {
                    font = window.GetFontDUI(FONT_TYPE_DUI.tabs);
                    source = 'Default UI: Tabs';
                }
            } else if (typeof window !== 'undefined' && window) {
                if (kind === 'console') {
                    font = window.GetFontCUI(FONT_TYPE_CUI.items, CUI_FONT_GUIDS.coreConsole);
                    source = 'Columns UI: Core: Console';
                } else {
                    font = window.GetFontCUI(FONT_TYPE_CUI.labels);
                    source = 'Columns UI: Common (labels)';
                }
            }
        } catch (e) {
            font = null;
        }

        return fontInfoFromHostFont(
            font,
            fallback.fontFamily || 'Segoe UI',
            fallback.scaleFontSize || 12,
            source
        );
    }

    function commonLabelsFontInfo() {
        return specificHostFontInfo('labels');
    }

    function consoleFontInfo() {
        return specificHostFontInfo('console');
    }

    function createMaterialTheme(scheme, selectedMode) {
        // Every role read below without a `!== undefined` fallback must be
        // present. opaque(undefined) is opaque BLACK, not an error, so a
        // partial scheme would silently produce black-on-black text with
        // nothing to trace it back from.
        if (!scheme ||
            scheme.background === undefined ||
            scheme.primary === undefined ||
            scheme.onPrimary === undefined ||
            scheme.onSurface === undefined ||
            scheme.onSurfaceVariant === undefined ||
            scheme.outline === undefined ||
            scheme.outlineVariant === undefined) return null;

        var background = opaque(scheme.background);
        var dark = selectedMode === 'dark';
        var primary = opaque(scheme.primary);
        var onPrimary = opaque(scheme.onPrimary);
        var onSurface = opaque(scheme.onSurface);
        var onSurfaceVariant = opaque(scheme.onSurfaceVariant);
        var outline = opaque(scheme.outline);
        var outlineVariant = opaque(scheme.outlineVariant);
        var surface = opaque(scheme.surface !== undefined ? scheme.surface : background);
        var surfaceContainerLow = opaque(scheme.surfaceContainerLow !== undefined ? scheme.surfaceContainerLow : surface);
        var surfaceContainer = opaque(scheme.surfaceContainer !== undefined ? scheme.surfaceContainer : surface);
        var surfaceContainerHigh = opaque(scheme.surfaceContainerHigh !== undefined ? scheme.surfaceContainerHigh : surfaceContainer);
        var surfaceContainerHighest = opaque(scheme.surfaceContainerHighest !== undefined ? scheme.surfaceContainerHighest : surfaceContainerHigh);
        var primaryContainer = opaque(scheme.primaryContainer !== undefined ? scheme.primaryContainer : mix(background, primary, dark ? 0.26 : 0.14));
        var onPrimaryContainer = opaque(scheme.onPrimaryContainer !== undefined ? scheme.onPrimaryContainer : onSurface);
        var secondary = opaque(scheme.secondary !== undefined ? scheme.secondary : primary);
        var tertiary = opaque(scheme.tertiary !== undefined ? scheme.tertiary : secondary);
        var error = opaque(scheme.error !== undefined ? scheme.error : (dark ? rgb(255, 180, 171) : rgb(186, 26, 26)));
        var inverseSurface = opaque(scheme.inverseSurface !== undefined ? scheme.inverseSurface : (dark ? rgb(230, 225, 229) : rgb(49, 48, 51)));
        var inverseOnSurface = opaque(scheme.inverseOnSurface !== undefined ? scheme.inverseOnSurface : (dark ? rgb(49, 48, 51) : rgb(244, 239, 244)));

        var accentHover = mix(primary, rgb(255, 255, 255), dark ? 0.12 : 0.10);
        var accentPressed = mix(primary, rgb(0, 0, 0), dark ? 0.18 : 0.22);
        var textMuted = mix(background, onSurfaceVariant, dark ? 0.84 : 0.78);
        var textTertiary = mix(background, onSurfaceVariant, dark ? 0.64 : 0.60);

        var theme = {
            mode: 'album-' + selectedMode,
            dark: dark,
            dynamic: true,
            background: background,
            backgroundAlt: opaque(scheme.surfaceDim !== undefined ? scheme.surfaceDim : surfaceContainerLow),
            header: surfaceContainerLow,

            card: surfaceContainer,
            cardHover: surfaceContainerHigh,
            rowHover: surfaceContainerHighest,
            surfaceSubtle: surfaceContainerLow,
            surface: surfaceContainer,
            surfaceHover: surfaceContainerHigh,
            surfacePressed: mix(surfaceContainerHigh, primary, dark ? 0.20 : 0.14),
            surfaceSelected: primaryContainer,
            surfaceSelectedHover: mix(primaryContainer, primary, dark ? 0.14 : 0.10),

            chip: surfaceContainerLow,
            chipHover: surfaceContainerHigh,

            stroke: outlineVariant,
            strokeHot: outline,
            separator: outlineVariant,

            textPrimary: onSurface,
            textSecondary: onSurfaceVariant,
            textMuted: textMuted,
            textTertiary: textTertiary,
            textDisabled: mix(background, onSurfaceVariant, dark ? 0.42 : 0.38),

            accent: primary,
            accentHover: accentHover,
            accentPressed: accentPressed,
            accentSoft: primaryContainer,
            accentMuted: mix(onSurfaceVariant, primary, 0.56),
            onAccent: onPrimary,
            onAccentLight: rgb(255, 255, 255),
            onAccentDark: rgb(28, 28, 30),

            success: tertiary,
            danger: error,
            // Fixed red, matching the non-album theme, and NOT derived from the
            // album palette. This used to be `tertiary`, which made it identical
            // to `success` - controls_panel.js's "ReplayGain data missing" stripe
            // silently stopped reading as a warning in every album-* mode.
            warning: rgb(211, 47, 47),

            tooltipBackground: inverseSurface,
            tooltipStroke: outline,
            tooltipText: inverseOnSurface,
            tooltipShadow: withAlpha(rgb(0, 0, 0), 190),

            scrollTrack: surfaceContainerHigh,

            navigationSurface: surfaceContainer,
            navigationSeparator: outlineVariant,
            navigationTextPrimary: onSurface,
            navigationTextSecondary: onSurfaceVariant,
            navigationTextMuted: textMuted,

            // Expose Material semantic roles for panels that need a more
            // specific mapping than the legacy RVG token names.
            primary: primary,
            onPrimary: onPrimary,
            primaryContainer: primaryContainer,
            onPrimaryContainer: onPrimaryContainer,
            secondary: secondary,
            onSecondary: opaque(scheme.onSecondary !== undefined ? scheme.onSecondary : onPrimary),
            secondaryContainer: opaque(scheme.secondaryContainer !== undefined ? scheme.secondaryContainer : surfaceContainerHigh),
            onSecondaryContainer: opaque(scheme.onSecondaryContainer !== undefined ? scheme.onSecondaryContainer : onSurface),
            tertiary: tertiary,
            onTertiary: opaque(scheme.onTertiary !== undefined ? scheme.onTertiary : onPrimary),
            tertiaryContainer: opaque(scheme.tertiaryContainer !== undefined ? scheme.tertiaryContainer : surfaceContainerHigh),
            onTertiaryContainer: opaque(scheme.onTertiaryContainer !== undefined ? scheme.onTertiaryContainer : onSurface),
            error: error,
            onError: opaque(scheme.onError !== undefined ? scheme.onError : onPrimary),
            errorContainer: opaque(scheme.errorContainer !== undefined ? scheme.errorContainer : mix(background, error, dark ? 0.28 : 0.14)),
            onErrorContainer: opaque(scheme.onErrorContainer !== undefined ? scheme.onErrorContainer : onSurface),
            outline: outline,
            outlineVariant: outlineVariant,
            inverseSurface: inverseSurface,
            inverseOnSurface: inverseOnSurface
        };

        theme.successSoft = mix(theme.card, theme.success, dark ? 0.18 : 0.12);
        theme.dangerSoft = theme.errorContainer;
        return theme;
    }

    function applyMicaSurfaceTreatment(theme) {
        if (!theme) return null;

        theme.mode = 'mica';
        theme.mica = true;

        // Mica uses one canonical root-cover composition. Each RVG script window
        // samples only the root-relative source slice that belongs behind it. Keep
        // the base background opaque as a reliable no-art/discovery fallback while
        // semantic surfaces become local acrylic layers over that composition.
        theme.backgroundAlt = withAlpha(theme.backgroundAlt, 218);
        theme.header = withAlpha(theme.header, 188);
        theme.card = withAlpha(theme.card, 168);   // 66%
        theme.cardHover = withAlpha(theme.cardHover, 214);
        theme.rowHover = withAlpha(theme.rowHover, 198);
        theme.surfaceSubtle = withAlpha(theme.surfaceSubtle, 166);
        theme.surface = withAlpha(theme.surface, 184);
        theme.surfaceHover = withAlpha(theme.surfaceHover, 212);
        theme.surfacePressed = withAlpha(theme.surfacePressed, 226);
        theme.surfaceSelected = withAlpha(theme.surfaceSelected, 204);
        theme.surfaceSelectedHover = withAlpha(theme.surfaceSelectedHover, 224);
        theme.chip = withAlpha(theme.chip, 168);
        theme.chipHover = withAlpha(theme.chipHover, 208);
        theme.stroke = withAlpha(theme.stroke, 152);
        theme.strokeHot = withAlpha(theme.strokeHot, 190);
        theme.separator = withAlpha(theme.separator, 132);
        theme.accentSoft = withAlpha(theme.accentSoft, 196);
        theme.successSoft = withAlpha(theme.successSoft, 196);
        theme.dangerSoft = withAlpha(theme.dangerSoft, 196);
        theme.scrollTrack = withAlpha(theme.scrollTrack, 112);
        // Tab bars and the preset strip sit over the artwork for the full height of
        // the skin, so they read far heavier than a card does at the same alpha.
        theme.navigationSurface = withAlpha(theme.navigationSurface, 0);
        theme.navigationSeparator = withAlpha(theme.navigationSeparator, 200);

        // Keep direct Material-role consumers translucent too. Most RVG panels
        // use the aliases above, but Playlist and a few specialised painters
        // intentionally read container/outline roles directly.
        theme.primaryContainer = withAlpha(theme.primaryContainer, 204);
        theme.secondaryContainer = withAlpha(theme.secondaryContainer, 188);
        theme.tertiaryContainer = withAlpha(theme.tertiaryContainer, 188);
        theme.errorContainer = withAlpha(theme.errorContainer, 196);
        theme.outline = withAlpha(theme.outline, 190);
        theme.outlineVariant = withAlpha(theme.outlineVariant, 140);
        return theme;
    }

    function createTheme(options) {
        options = options || {};

        var host = options.host || hostInfo();
        var mode = String(options.mode || 'host').toLowerCase();
        var shared = options.ignoreSharedTheme ? null : sharedThemePayload;
        var sharedMode = shared ? String(shared.mode || 'existing').toLowerCase() : 'existing';
        var forcedAccent = null;

        if (sharedMode === 'host' || sharedMode === 'dark' || sharedMode === 'light') {
            mode = sharedMode;
            forcedAccent = sharedMode === 'host' ? host.accent : rgb(0, 120, 212);
        } else if (sharedMode === 'album-auto' || sharedMode === 'album-dark' ||
            sharedMode === 'album-light' || sharedMode === 'mica') {
            var selectedMode = sharedMode === 'album-auto' || sharedMode === 'mica'
                ? (host.dark ? 'dark' : 'light')
                : (sharedMode === 'album-dark' ? 'dark' : 'light');
            var materialTheme = createMaterialTheme(shared && shared[selectedMode], selectedMode);
            if (materialTheme) {
                return sharedMode === 'mica' ? applyMicaSurfaceTreatment(materialTheme) : materialTheme;
            }
        }
        var background = host.background;
        var hostText = host.text;
        var dark;

        if (mode === 'dark') {
            background = rgb(24, 24, 26);
            hostText = rgb(245, 245, 245);
            dark = true;
        } else if (mode === 'light') {
            background = rgb(243, 243, 243);
            hostText = rgb(28, 28, 30);
            dark = false;
        } else {
            mode = 'host';
            dark = luminance(background) < 128;
        }

        if (options.background !== undefined && options.background !== null) {
            background = opaque(options.background);
            dark = luminance(background) < 128;
        }
        if (options.text !== undefined && options.text !== null) {
            hostText = opaque(options.text);
        }

        var white = rgb(255, 255, 255);
        var black = rgb(0, 0, 0);
        var onAccentDark = rgb(28, 28, 30);
        var accent = opaque(forcedAccent !== null ? forcedAccent : (options.accent !== undefined ? options.accent : host.accent));
        var accentHover = mix(accent, white, 0.16);
        var accentPressed = mix(accent, black, 0.24);
        var onAccent = contrastingForegroundForBackgrounds(
            [accent, accentHover, accentPressed],
            white,
            onAccentDark,
            3
        );
        var textPrimary = dark ? mix(hostText, white, 0.15) : mix(hostText, black, 0.20);
        var textSecondary = mix(background, textPrimary, dark ? 0.82 : 0.76);
        var textMuted = mix(background, textPrimary, dark ? 0.62 : 0.58);
        var textTertiary = mix(background, textPrimary, dark ? 0.48 : 0.46);
        var card = mix(background, textPrimary, dark ? 0.055 : 0.045);
        var cardHover = mix(background, textPrimary, dark ? 0.09 : 0.075);
        var rowHover = mix(background, textPrimary, dark ? 0.13 : 0.11);
        var control = mix(background, textPrimary, dark ? 0.12 : 0.07);
        var stroke = mix(background, textPrimary, dark ? 0.16 : 0.15);

        var theme = {
            mode: mode,
            dark: dark,
            background: background,
            backgroundAlt: mix(background, black, dark ? 0.10 : 0.025),
            header: mix(background, textPrimary, dark ? 0.035 : 0.025),

            card: card,
            cardHover: cardHover,
            rowHover: rowHover,
            surfaceSubtle: card,
            surface: control,
            surfaceHover: mix(control, textPrimary, 0.07),
            surfacePressed: mix(control, accent, 0.25),
            surfaceSelected: mix(control, accent, 0.12),
            surfaceSelectedHover: mix(control, accent, 0.19),

            chip: mix(background, textPrimary, dark ? 0.035 : 0.028),
            chipHover: cardHover,

            stroke: stroke,
            strokeHot: mix(background, textPrimary, dark ? 0.31 : 0.23),
            separator: stroke,

            textPrimary: textPrimary,
            textSecondary: textSecondary,
            textMuted: textMuted,
            textTertiary: textTertiary,
            textDisabled: mix(background, textPrimary, dark ? 0.35 : 0.32),

            accent: accent,
            accentHover: accentHover,
            accentPressed: accentPressed,
            accentSoft: mix(background, accent, dark ? 0.20 : 0.12),
            accentMuted: mix(textMuted, accent, 0.55),
            onAccent: onAccent,
            onAccentLight: white,
            onAccentDark: onAccentDark,

            success: dark ? rgb(104, 211, 145) : rgb(28, 125, 70),
            danger: dark ? rgb(255, 128, 128) : rgb(184, 44, 52),
            warning: rgb(211, 47, 47),

            tooltipBackground: rgb(28, 28, 30),
            tooltipStroke: rgb(91, 91, 96),
            tooltipText: rgb(242, 242, 244),
            tooltipShadow: rgb(10, 10, 12),

            scrollTrack: mix(background, textPrimary, dark ? 0.08 : 0.06),

            // The navigation family intentionally retains the exact palette
            // shared by the existing root tabs, presets and switcher rows.
            navigationSurface: dark ? rgb(28, 28, 28) : mix(background, textPrimary, 0.055),
            navigationSeparator: dark ? rgb(51, 51, 51) : stroke,
            navigationTextPrimary: dark ? rgb(245, 245, 245) : textPrimary,
            navigationTextSecondary: dark ? rgb(184, 184, 184) : textSecondary,
            navigationTextMuted: dark ? rgb(126, 126, 126) : textMuted
        };

        theme.successSoft = mix(theme.card, theme.success, dark ? 0.18 : 0.12);
        theme.dangerSoft = mix(theme.card, theme.danger, dark ? 0.16 : 0.10);
        return theme;
    }

    function selectorVisual(theme, state, options) {
        state = state || {};
        options = options || {};

        var enabled = state.enabled !== false;
        var selected = !!state.selected;
        var hovered = !!state.hovered && enabled;
        var pressed = !!state.pressed && enabled;
        var base = options.base !== undefined ? options.base : theme.navigationSurface;
        var accent = opaque(options.accent !== undefined ? options.accent : theme.accent);
        var textPrimary = options.textPrimary !== undefined ? options.textPrimary : theme.navigationTextPrimary;
        var textSecondary = options.textSecondary !== undefined ? options.textSecondary : theme.navigationTextSecondary;
        var textMuted = options.textMuted !== undefined ? options.textMuted : theme.navigationTextMuted;
        var fill = base;

        if (selected) fill = mix(base, accent, 0.12);
        if (hovered) fill = selected ? mix(base, accent, 0.19) : mix(base, textPrimary, 0.07);
        if (pressed) fill = mix(base, accent, 0.25);

        return {
            fill: fill,
            text: !enabled
                ? mix(base, textMuted, 0.55)
                : (selected ? textPrimary : (hovered ? textSecondary : textMuted)),
            icon: !enabled
                ? mix(base, textMuted, 0.55)
                : (selected ? textPrimary : (hovered ? mix(accent, rgb(255, 255, 255), 0.16) : textMuted)),
            accent: accent,
            indicator: selected || !!options.indicatorActive,
            enabled: enabled,
            selected: selected,
            hovered: hovered,
            pressed: pressed
        };
    }

    function buttonVisual(theme, state, options) {
        state = state || {};
        options = options || {};

        var enabled = state.enabled !== false;
        var selected = !!state.selected;
        var hovered = !!state.hovered && enabled;
        var pressed = !!state.pressed && enabled;
        var primary = !!options.primary;
        var base = options.base !== undefined ? options.base : theme.surface;
        var accent = opaque(options.accent !== undefined ? options.accent : theme.accent);
        var fill;
        var stroke;
        var icon;
        var primaryHover = options.accentHover !== undefined
            ? opaque(options.accentHover)
            : (accent === theme.accent && theme.accentHover !== undefined
                ? theme.accentHover
                : mix(accent, rgb(255, 255, 255), 0.16));
        var primaryPressed = options.accentPressed !== undefined
            ? opaque(options.accentPressed)
            : (accent === theme.accent && theme.accentPressed !== undefined
                ? theme.accentPressed
                : mix(accent, rgb(0, 0, 0), 0.24));
        var onAccent = options.onAccent !== undefined
            ? opaque(options.onAccent)
            : contrastingForegroundForBackgrounds(
                [accent, primaryHover, primaryPressed],
                theme.onAccentLight,
                theme.onAccentDark,
                options.minimumOnAccentContrast !== undefined
                    ? options.minimumOnAccentContrast
                    : 3
            );

        if (!enabled) {
            fill = theme.surfaceSubtle;
            stroke = theme.stroke;
            icon = theme.textDisabled;
        } else if (primary) {
            fill = pressed ? primaryPressed : (hovered ? primaryHover : accent);
            stroke = fill;
            icon = onAccent;
        } else if (selected) {
            fill = pressed
                ? mix(base, accent, 0.25)
                : (hovered ? mix(base, accent, 0.19) : mix(base, accent, 0.12));
            stroke = accent;
            icon = hovered ? theme.accentHover : accent;
        } else {
            fill = pressed ? mix(base, accent, 0.25) : (hovered ? mix(base, theme.textPrimary, 0.07) : base);
            stroke = hovered ? theme.strokeHot : theme.stroke;
            icon = hovered ? theme.accentHover : theme.textSecondary;
        }

        return {
            fill: fill,
            stroke: stroke,
            icon: icon,
            enabled: enabled,
            selected: selected,
            hovered: hovered,
            pressed: pressed,
            accent: accent
        };
    }

    function createPainter(options) {
        options = options || {};

        var scaleFunction = typeof options.scale === 'function' ? options.scale : defaultScale;
        var theme = options.theme || createTheme();

        function px(value) {
            return safeScale(scaleFunction, value);
        }

        function setTheme(nextTheme) {
            theme = nextTheme || createTheme();
            return theme;
        }

        function getTheme() {
            return theme;
        }

        function withAntialias(gr, callback) {
            var changed = false;
            if (gr && typeof gr.SetSmoothingMode === 'function') {
                try {
                    gr.SetSmoothingMode(SMOOTHING_MODE_ANTIALIAS);
                    changed = true;
                } catch (e) {
                    changed = false;
                }
            }

            try {
                return callback();
            } finally {
                if (changed) {
                    try {
                        gr.SetSmoothingMode(SMOOTHING_MODE_DEFAULT);
                    } catch (e2) {
                        // Ignore graphics-state restoration failures.
                    }
                }
            }
        }

        function fillRoundRect(gr, rect, radius, colour) {
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            if (!gr || rect.w <= 0 || rect.h <= 0) return;
            radius = Math.max(0, Math.min(px(radius), rect.w / 2, rect.h / 2));
            if (typeof gr.FillRoundRect === 'function') {
                gr.FillRoundRect(rect.x, rect.y, rect.w, rect.h, radius, radius, colour);
            } else {
                gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, colour);
            }
        }

        function drawRoundRect(gr, rect, radius, lineWidth, colour) {
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            if (!gr || rect.w <= 0 || rect.h <= 0 || typeof gr.DrawRoundRect !== 'function') return;
            // Clamp against the rectangle actually drawn, not the one passed in:
            // the 1 px pen inset below means a radius of exactly rect.h / 2 asks
            // GDI+ for an arc wider than the box and throws "Arc argument has
            // invalid value" - which is what a full-capsule pill asks for.
            var strokeW = Math.max(1, rect.w - 1);
            var strokeH = Math.max(1, rect.h - 1);
            radius = Math.max(0, Math.min(px(radius), strokeW / 2, strokeH / 2));
            lineWidth = Math.max(1, Number(lineWidth) || 1);
            gr.DrawRoundRect(
                rect.x + 0.5,
                rect.y + 0.5,
                strokeW,
                strokeH,
                radius,
                radius,
                lineWidth,
                colour
            );
        }

        function card(gr, rect, cardOptions) {
            cardOptions = cardOptions || {};
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            if (rect.w <= 0 || rect.h <= 0) return rect;

            var fill = cardOptions.fill !== undefined
                ? cardOptions.fill
                : (cardOptions.hovered ? theme.cardHover : theme.card);
            var radius = cardOptions.radius !== undefined ? cardOptions.radius : api.metrics.radius.card;
            var stroke = cardOptions.stroke !== undefined ? cardOptions.stroke : theme.stroke;
            var accent = opaque(cardOptions.accentColour !== undefined ? cardOptions.accentColour : theme.accent);
            var accentEdge = String(cardOptions.accentEdge || 'left').toLowerCase();
            var accentThickness = px(cardOptions.accentThickness !== undefined
                ? cardOptions.accentThickness
                : api.metrics.accentStrip);
            var accentInset = px(cardOptions.accentInset !== undefined
                ? cardOptions.accentInset
                : api.metrics.accentInset);

            fillRoundRect(gr, rect, radius, fill);
            if (cardOptions.border !== false) {
                drawRoundRect(gr, rect, radius, 1, stroke);
            }

            if (cardOptions.accent) {
                if (accentEdge === 'top') {
                    gr.FillSolidRect(
                        rect.x + accentInset,
                        rect.y,
                        Math.max(0, rect.w - accentInset * 2),
                        Math.min(rect.h, accentThickness),
                        accent
                    );
                } else if (accentEdge === 'right') {
                    gr.FillSolidRect(
                        rect.x + Math.max(0, rect.w - accentThickness),
                        rect.y + accentInset,
                        Math.min(rect.w, accentThickness),
                        Math.max(0, rect.h - accentInset * 2),
                        accent
                    );
                } else if (accentEdge === 'bottom') {
                    gr.FillSolidRect(
                        rect.x + accentInset,
                        rect.y + Math.max(0, rect.h - accentThickness),
                        Math.max(0, rect.w - accentInset * 2),
                        Math.min(rect.h, accentThickness),
                        accent
                    );
                } else {
                    gr.FillSolidRect(
                        rect.x,
                        rect.y + accentInset,
                        Math.min(rect.w, accentThickness),
                        Math.max(0, rect.h - accentInset * 2),
                        accent
                    );
                }
            }
            return rect;
        }

        function selector(gr, rect, state, selectorOptions) {
            selectorOptions = selectorOptions || {};
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            var visual = selectorVisual(theme, state, selectorOptions);
            var base = selectorOptions.base !== undefined ? selectorOptions.base : theme.navigationSurface;
            var separator = selectorOptions.separatorColour !== undefined
                ? selectorOptions.separatorColour
                : theme.navigationSeparator;
            var edge = px(1);

            if (visual.fill !== base) {
                gr.FillSolidRect(rect.x, rect.y, rect.w, rect.h, visual.fill);
            }

            var separatorEdge = String(selectorOptions.separatorEdge || '').toLowerCase();
            if (separatorEdge === 'top') {
                gr.FillSolidRect(rect.x, rect.y, rect.w, edge, separator);
            } else if (separatorEdge === 'bottom') {
                gr.FillSolidRect(rect.x, rect.y + Math.max(0, rect.h - edge), rect.w, edge, separator);
            } else if (separatorEdge === 'left') {
                gr.FillSolidRect(rect.x, rect.y, edge, rect.h, separator);
            } else if (separatorEdge === 'right') {
                gr.FillSolidRect(rect.x + Math.max(0, rect.w - edge), rect.y, edge, rect.h, separator);
            }

            if (visual.indicator) {
                var indicatorEdge = String(selectorOptions.indicatorEdge || 'top').toLowerCase();
                var thickness = px(selectorOptions.indicatorThickness !== undefined
                    ? selectorOptions.indicatorThickness
                    : api.metrics.selectorIndicator);
                var minimum = px(selectorOptions.indicatorMin !== undefined
                    ? selectorOptions.indicatorMin
                    : api.metrics.selectorIndicatorMin);
                var maximum = px(selectorOptions.indicatorMax !== undefined
                    ? selectorOptions.indicatorMax
                    : api.metrics.selectorIndicatorMax);
                var inset = px(selectorOptions.indicatorInset !== undefined
                    ? selectorOptions.indicatorInset
                    : api.metrics.selectorIndicatorInset);
                var length;
                var indicatorX;
                var indicatorY;

                if (indicatorEdge === 'left' || indicatorEdge === 'right') {
                    length = Math.min(maximum, Math.max(minimum, rect.h - inset * 2));
                    indicatorY = rect.y + Math.floor((rect.h - length) / 2);
                    indicatorX = indicatorEdge === 'right'
                        ? rect.x + Math.max(0, rect.w - thickness)
                        : rect.x;
                    gr.FillSolidRect(indicatorX, indicatorY, Math.min(rect.w, thickness), length, visual.accent);
                } else {
                    length = Math.min(maximum, Math.max(minimum, rect.w - inset * 2));
                    indicatorX = rect.x + Math.floor((rect.w - length) / 2);
                    indicatorY = indicatorEdge === 'bottom'
                        ? rect.y + Math.max(0, rect.h - thickness)
                        : rect.y;
                    gr.FillSolidRect(indicatorX, indicatorY, length, Math.min(rect.h, thickness), visual.accent);
                }
            }

            if (selectorOptions.text !== undefined && selectorOptions.font) {
                gr.GdiDrawText(
                    String(selectorOptions.text),
                    selectorOptions.font,
                    visual.text,
                    rect.x + px(selectorOptions.textInsetX !== undefined ? selectorOptions.textInsetX : 5),
                    rect.y + px(selectorOptions.textInsetY || 0),
                    Math.max(1, rect.w - px(selectorOptions.textInsetX !== undefined ? selectorOptions.textInsetX * 2 : 10)),
                    Math.max(1, rect.h - px(selectorOptions.textInsetY ? selectorOptions.textInsetY * 2 : 0)),
                    selectorOptions.textFlags !== undefined ? selectorOptions.textFlags : api.textFlags.centeredEllipsis
                );
            }

            return visual;
        }

        function pill(gr, rect, pillOptions) {
            pillOptions = pillOptions || {};
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            if (rect.w <= 0 || rect.h <= 0) return null;

            var fill = pillOptions.fill !== undefined ? pillOptions.fill : theme.surface;
            var textColour = pillOptions.textColour !== undefined ? pillOptions.textColour : theme.textMuted;
            // Omitting `radius` means "full capsule". Asking for rect.h and
            // letting fillRoundRect/drawRoundRect clamp to min(w/2, h/2) gives
            // exactly that through the same code path as an explicit radius.
            // The previous split path drew the fill unscaled but the border
            // px()-scaled, and clamped to h/2 only - which overflows GDI+ on a
            // pill narrower than it is tall.
            var radius = pillOptions.radius !== undefined ? pillOptions.radius : rect.h;

            fillRoundRect(gr, rect, radius, fill);

            if (pillOptions.border) {
                drawRoundRect(
                    gr,
                    rect,
                    radius,
                    1,
                    pillOptions.stroke !== undefined ? pillOptions.stroke : theme.stroke
                );
            }

            if (pillOptions.text !== undefined && pillOptions.font) {
                gr.GdiDrawText(
                    String(pillOptions.text),
                    pillOptions.font,
                    textColour,
                    rect.x + px(pillOptions.textInsetX || 0),
                    rect.y,
                    Math.max(1, rect.w - px((pillOptions.textInsetX || 0) * 2)),
                    rect.h,
                    pillOptions.textFlags !== undefined ? pillOptions.textFlags : api.textFlags.centered
                );
            }

            return { fill: fill, text: textColour };
        }

        function chip(gr, rect, state, chipOptions) {
            state = state || {};
            chipOptions = chipOptions || {};
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);

            var active = !!state.selected;
            var hot = (!!state.hovered || !!state.pressed) && state.enabled !== false;
            var enabled = state.enabled !== false;
            var accent = opaque(chipOptions.accent !== undefined ? chipOptions.accent : theme.accent);
            var fill = (active || hot) ? theme.chipHover : theme.chip;
            var textColour = !enabled
                ? theme.textDisabled
                : (hot ? theme.accentHover : (active ? theme.textPrimary : theme.textMuted));
            var radius = chipOptions.radius !== undefined ? chipOptions.radius : api.metrics.radius.chip;

            fillRoundRect(gr, rect, radius, fill);
            if (!active && !hot && chipOptions.border !== false) {
                drawRoundRect(gr, rect, radius, 1, chipOptions.stroke !== undefined ? chipOptions.stroke : theme.stroke);
            }

            if (active && chipOptions.indicator !== false) {
                var indicatorInset = px(chipOptions.indicatorInset !== undefined ? chipOptions.indicatorInset : 4);
                var indicatorHeight = px(chipOptions.indicatorHeight !== undefined ? chipOptions.indicatorHeight : 2);
                gr.FillSolidRect(
                    rect.x + indicatorInset,
                    rect.y + Math.max(0, rect.h - indicatorHeight),
                    Math.max(0, rect.w - indicatorInset * 2),
                    Math.min(rect.h, indicatorHeight),
                    accent
                );
            }

            if (chipOptions.text !== undefined && chipOptions.font) {
                gr.GdiDrawText(
                    String(chipOptions.text),
                    chipOptions.font,
                    textColour,
                    rect.x + px(chipOptions.paddingX !== undefined ? chipOptions.paddingX : 9),
                    rect.y,
                    Math.max(1, rect.w - px((chipOptions.paddingX !== undefined ? chipOptions.paddingX : 9) * 2)),
                    rect.h,
                    chipOptions.textFlags !== undefined ? chipOptions.textFlags : api.textFlags.leftCentered
                );
            }

            return { fill: fill, text: textColour, accent: accent };
        }

        function iconButton(gr, rect, state, buttonOptions) {
            state = state || {};
            buttonOptions = buttonOptions || {};
            rect = makeRect(rect.x, rect.y, rect.w, rect.h);
            var visual = buttonVisual(theme, state, buttonOptions);
            var circular = !!buttonOptions.circular;
            var radius = buttonOptions.radius !== undefined ? buttonOptions.radius : api.metrics.radius.button;
            var shouldFill = buttonOptions.background !== false ||
                state.selected || state.hovered || state.pressed || buttonOptions.primary;

            return withAntialias(gr, function () {
                if (circular) {
                    gr.FillEllipse(rect.x, rect.y, rect.w, rect.h, visual.fill);
                    if (buttonOptions.border !== false && typeof gr.DrawEllipse === 'function') {
                        gr.DrawEllipse(
                            rect.x + 0.5,
                            rect.y + 0.5,
                            Math.max(1, rect.w - 1),
                            Math.max(1, rect.h - 1),
                            1,
                            visual.stroke
                        );
                    }
                } else {
                    if (shouldFill) fillRoundRect(gr, rect, radius, visual.fill);
                    if (buttonOptions.border) drawRoundRect(gr, rect, radius, 1, visual.stroke);
                }

                if (!circular && buttonOptions.indicator &&
                    (state.selected || state.pressed || buttonOptions.indicatorActive)) {
                    var indicatorW = Math.max(px(10), Math.round(rect.w * 0.34));
                    var indicatorH = Math.min(rect.h, px(3));
                    gr.FillSolidRect(
                        rect.x + Math.round((rect.w - indicatorW) / 2),
                        rect.y,
                        indicatorW,
                        indicatorH,
                        visual.accent
                    );
                }

                if (buttonOptions.glyph !== undefined && buttonOptions.font) {
                    gr.GdiDrawText(
                        String(buttonOptions.glyph),
                        buttonOptions.font,
                        visual.icon,
                        rect.x,
                        rect.y,
                        rect.w,
                        rect.h,
                        buttonOptions.textFlags !== undefined ? buttonOptions.textFlags : api.textFlags.centered
                    );
                }

                return visual;
            });
        }

        // Renders a tooltip (shadow + fill + border + text lines) at an
        // ALREADY-POSITIONED rect, so panels with their own anchor rules keep
        // their x/y/w/h math and still get the shared style. tooltip() below is
        // just one positioning algorithm layered on top of this.
        function tooltipBox(gr, rect, lines, font, tooltipOptions) {
            tooltipOptions = tooltipOptions || {};
            if (!gr || !font || !rect || rect.w <= 0 || rect.h <= 0) return null;
            lines = lines || [];

            var lineHeight = px(tooltipOptions.lineHeight !== undefined ? tooltipOptions.lineHeight : 16);
            var padX = px(tooltipOptions.paddingX !== undefined ? tooltipOptions.paddingX : 9);
            var padY = px(tooltipOptions.paddingY !== undefined ? tooltipOptions.paddingY : 6);
            var radius = tooltipOptions.radius !== undefined ? tooltipOptions.radius : api.metrics.radius.tooltip;
            var shadowOffset = tooltipOptions.shadowOffset !== undefined ? tooltipOptions.shadowOffset : 2;
            var shadowOffsetX = px(tooltipOptions.shadowOffsetX !== undefined ? tooltipOptions.shadowOffsetX : shadowOffset);
            var shadowOffsetY = px(tooltipOptions.shadowOffsetY !== undefined ? tooltipOptions.shadowOffsetY : shadowOffset);
            var i;

            rect = makeRect(rect.x, rect.y, rect.w, rect.h);

            fillRoundRect(
                gr,
                makeRect(rect.x + shadowOffsetX, rect.y + shadowOffsetY, rect.w, rect.h),
                radius,
                tooltipOptions.shadow !== undefined ? tooltipOptions.shadow : theme.tooltipShadow
            );
            fillRoundRect(
                gr,
                rect,
                radius,
                tooltipOptions.fill !== undefined ? tooltipOptions.fill : theme.tooltipBackground
            );
            drawRoundRect(
                gr,
                rect,
                radius,
                1,
                tooltipOptions.stroke !== undefined ? tooltipOptions.stroke : theme.tooltipStroke
            );

            for (i = 0; i < lines.length; i++) {
                if (padY + (i + 1) * lineHeight > rect.h) break;
                gr.GdiDrawText(
                    lines[i],
                    font,
                    tooltipOptions.textColour !== undefined ? tooltipOptions.textColour : theme.tooltipText,
                    rect.x + padX,
                    rect.y + padY + i * lineHeight,
                    Math.max(1, rect.w - padX * 2),
                    lineHeight,
                    tooltipOptions.textFlags !== undefined ? tooltipOptions.textFlags : api.textFlags.leftCenteredEllipsis
                );
            }

            return rect;
        }

        function tooltip(gr, text, font, mouseX, mouseY, panelWidth, panelHeight, tooltipOptions) {
            tooltipOptions = tooltipOptions || {};
            text = String(text || '');
            if (!text || !font || !gr || panelWidth <= 0 || panelHeight <= 0) return null;

            var lines = text.split('\n');
            var lineHeight = px(tooltipOptions.lineHeight !== undefined ? tooltipOptions.lineHeight : 16);
            var padX = px(tooltipOptions.paddingX !== undefined ? tooltipOptions.paddingX : 9);
            var padY = px(tooltipOptions.paddingY !== undefined ? tooltipOptions.paddingY : 6);
            var margin = px(tooltipOptions.margin !== undefined ? tooltipOptions.margin : 4);
            var offset = px(tooltipOptions.offset !== undefined ? tooltipOptions.offset : 12);
            var minimumWidth = px(tooltipOptions.minimumWidth !== undefined ? tooltipOptions.minimumWidth : 120);
            var maximumWidth = Math.max(px(40), panelWidth - margin * 2);
            var maxTextWidth = 0;
            var i;

            for (i = 0; i < lines.length; i++) {
                try {
                    maxTextWidth = Math.max(maxTextWidth, Math.ceil(gr.CalcTextWidth(lines[i], font)));
                } catch (e) {
                    maxTextWidth = Math.max(maxTextWidth, lines[i].length * px(7));
                }
            }

            var boxWidth = Math.min(Math.max(minimumWidth, maxTextWidth + padX * 2), maximumWidth);
            var boxHeight = Math.min(panelHeight - margin * 2, lines.length * lineHeight + padY * 2);
            var x = clamp(mouseX - boxWidth / 2, margin, panelWidth - boxWidth - margin);
            var y = mouseY + offset;
            if (y + boxHeight > panelHeight - margin) y = mouseY - offset - boxHeight;
            y = clamp(y, margin, panelHeight - boxHeight - margin);
            // Positioning is all this function owns; tooltipBox draws it. Its
            // shadowOffset default is 2, matching what this used to hardcode.
            return tooltipBox(gr, makeRect(x, y, boxWidth, boxHeight), lines, font, tooltipOptions);
        }

        function scrollbar(gr, scrollbarOptions) {
            scrollbarOptions = scrollbarOptions || {};
            var contentHeight = Math.max(0, Number(scrollbarOptions.contentHeight) || 0);
            var viewportHeight = Math.max(0, Number(scrollbarOptions.viewportHeight) || 0);
            var scroll = Math.max(0, Number(scrollbarOptions.scroll) || 0);
            if (!gr || contentHeight <= viewportHeight || viewportHeight <= 0) return null;

            var x = Math.round(Number(scrollbarOptions.x) || 0);
            var y = Math.round(Number(scrollbarOptions.y) || 0);
            var trackHeight = Math.max(1, Math.round(Number(scrollbarOptions.height) || viewportHeight));
            var trackWidth = px(scrollbarOptions.trackWidth !== undefined ? scrollbarOptions.trackWidth : 2);
            var thumbWidth = px(scrollbarOptions.thumbWidth !== undefined ? scrollbarOptions.thumbWidth : 3);
            var minimumThumb = px(scrollbarOptions.minimumThumb !== undefined ? scrollbarOptions.minimumThumb : 28);
            var thumbHeight = Math.max(minimumThumb, Math.round(trackHeight * viewportHeight / contentHeight));
            thumbHeight = Math.min(trackHeight, thumbHeight);
            var travel = Math.max(1, trackHeight - thumbHeight);
            var maximumScroll = Math.max(1, contentHeight - viewportHeight);
            var thumbY = y + Math.round(clamp(scroll / maximumScroll, 0, 1) * travel);

            gr.FillSolidRect(x, y, trackWidth, trackHeight,
                scrollbarOptions.trackColour !== undefined ? scrollbarOptions.trackColour : theme.scrollTrack);
            gr.FillSolidRect(
                x - Math.max(0, Math.floor((thumbWidth - trackWidth) / 2)),
                thumbY,
                thumbWidth,
                thumbHeight,
                scrollbarOptions.thumbColour !== undefined ? scrollbarOptions.thumbColour : theme.accent
            );

            return {
                track: makeRect(x, y, trackWidth, trackHeight),
                thumb: makeRect(
                    x - Math.max(0, Math.floor((thumbWidth - trackWidth) / 2)),
                    thumbY,
                    thumbWidth,
                    thumbHeight
                )
            };
        }

        return {
            px: px,
            setTheme: setTheme,
            getTheme: getTheme,
            withAntialias: withAntialias,
            fillRoundRect: fillRoundRect,
            drawRoundRect: drawRoundRect,
            card: card,
            selector: selector,
            pill: pill,
            chip: chip,
            iconButton: iconButton,
            tooltip: tooltip,
            tooltipBox: tooltipBox,
            scrollbar: scrollbar
        };
    }

    // ------------------------------------------------------------------ artwork
    // Shared "no cover" / "no artist image" placeholders, so a track with no
    // artwork looks identical in the playlist, the album-art panel and the top
    // bar. These are jsplaylist-mod's own images (see its main.js get_images()),
    // reused rather than duplicated. Two distinct files: nocover for
    // front/back/disc/icon art, noartist for the artist-image type - a missing
    // artist photo must not be drawn as a blank CD cover.
    //
    // The extension isn't assumed: that folder has held .png in the past and
    // .webp now. Each candidate is tried in order; the first gdi.Image() that
    // returns non-null wins.
    //
    // Lazy, and a failure is cached as a miss too - gdi.Image() hits the disk,
    // so neither an unused placeholder nor a missing one may cost a read per
    // repaint.
    var PLACEHOLDER_ART_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'bmp', 'gif'];
    var PLACEHOLDER_IMAGES_DIR = fb.ProfilePath +
        'jsplitter\\rivage\\vendor\\jsplaylist-mod\\images\\';

    function loadPlaceholder(baseName) {
        for (var i = 0; i < PLACEHOLDER_ART_EXTENSIONS.length; i++) {
            var candidateImage;
            try {
                candidateImage = gdi.Image(
                    PLACEHOLDER_IMAGES_DIR + baseName + '.' + PLACEHOLDER_ART_EXTENSIONS[i]
                ) || null;
            } catch (e) {
                candidateImage = null;
            }
            if (candidateImage) return candidateImage;
        }
        return null;
    }

    // undefined = not tried yet, null = tried and failed
    var placeholderArtImage;
    var placeholderArtistArtImage;

    function placeholderArt() {
        if (typeof placeholderArtImage === 'undefined') {
            placeholderArtImage = loadPlaceholder('nocover');
        }
        return placeholderArtImage;
    }

    function placeholderArtistArt() {
        if (typeof placeholderArtistArtImage === 'undefined') {
            placeholderArtistArtImage = loadPlaceholder('noartist');
        }
        return placeholderArtistArtImage;
    }

    // Canonical user-facing vocabulary. Keep persisted values/protocol names separate
    // from these labels so copy can evolve without breaking compatibility.
    var copyLabels = {
        sharedAccent: 'Shared accent',
        rvgBlue: 'RVG blue',
        artwork: 'Artwork',
        customColour: 'Custom colour',
        panelDefaults: 'Accent dark',
        matchFoobar2000: 'Match foobar2000',
        foobar2000Accent: 'foobar2000 accent',
        rvgDark: 'RVG dark',
        rvgLight: 'RVG light',
        artworkPaletteAutomatic: 'Artwork palette \u2014 automatic',
        artworkPaletteDark: 'Artwork palette \u2014 dark',
        artworkPaletteLight: 'Artwork palette \u2014 light',
        artworkMica: 'Artwork Mica \u2014 blurred',
        followGlobalSetting: 'Follow global setting',
        nowPlayingOtherwiseSelectedTrack: 'Now playing, otherwise selected track',
        nowPlayingOnly: 'Now playing only',
        selectedTrackOtherwiseNowPlaying: 'Selected track, otherwise now playing',
        panelConfiguration: 'Panel configuration\u2026',
        panelProperties: 'Panel properties\u2026',
        editScript: 'Edit script\u2026'
    };

    function pushCopyChoice(out, values, key, label) {
        if (!values || !Object.prototype.hasOwnProperty.call(values, key)) return;
        out.push({ value: values[key], label: label });
    }

    function themeChoices(values) {
        var out = [];
        // Artwork Mica first: it is the default look.
        pushCopyChoice(out, values, 'mica', copyLabels.artworkMica);
        pushCopyChoice(out, values, 'panelDefaults', copyLabels.panelDefaults);
        pushCopyChoice(out, values, 'host', copyLabels.matchFoobar2000);
        pushCopyChoice(out, values, 'dark', copyLabels.rvgDark);
        pushCopyChoice(out, values, 'light', copyLabels.rvgLight);
        pushCopyChoice(out, values, 'artworkAuto', copyLabels.artworkPaletteAutomatic);
        pushCopyChoice(out, values, 'artworkDark', copyLabels.artworkPaletteDark);
        pushCopyChoice(out, values, 'artworkLight', copyLabels.artworkPaletteLight);
        return out;
    }

    function accentChoices(values) {
        var out = [];
        pushCopyChoice(out, values, 'artwork', copyLabels.artwork);
        pushCopyChoice(out, values, 'shared', copyLabels.sharedAccent);
        pushCopyChoice(out, values, 'rvgBlue', copyLabels.rvgBlue);
        pushCopyChoice(out, values, 'custom', copyLabels.customColour);
        return out;
    }

    function popupTitle(feature) {
        var name = String(feature == null ? '' : feature).replace(/^\s+|\s+$/g, '');
        return name ? 'RVG \u2014 ' + name : 'RVG';
    }

    api.copy = {
        labels: copyLabels,
        themeChoices: themeChoices,
        accentChoices: accentChoices,
        popupTitle: popupTitle
    };

    api.version = '1.9.1';
    api.release = RVG_RELEASE;
    api.DEFAULT_ACCENT = rgb(0, 120, 212);
    api.placeholderArt = placeholderArt;
    api.placeholderArtistArt = placeholderArtistArt;

    api.metrics = {
        spacing: {
            tiny: 2,
            small: 4,
            compact: 5,
            medium: 8,
            large: 14
        },
        radius: {
            button: 2,
            card: 5,
            chip: 5,
            item: 7,
            emptyState: 8,
            tooltip: 5
        },
        accentStrip: 3,
        accentInset: 7,
        selectorIndicator: 3,
        selectorIndicatorMin: 12,
        selectorIndicatorMax: 30,
        selectorIndicatorInset: 8,
        pillHeight: 24,
        border: 1
    };

    // All four `left*` entries include DT_VCENTER (0x4), so `left` is an ALIAS
    // for `leftCentered` and `leftEllipsis` an alias for `leftCenteredEllipsis`
    // - four names, two values. Nothing here is top-aligned. Kept as aliases
    // because live call sites use both spellings and the rendering is correct;
    // dropping 0x4 to make the names literal would move text in
    // playback_history_panel.js, queue_manager.js and playback-timeline_panel.js.
    api.textFlags = {
        left: 0x00000000 | 0x00000004 | 0x00000020 | 0x00000800,
        leftEllipsis: 0x00000000 | 0x00000004 | 0x00000020 | 0x00000800 | 0x00008000,
        leftCentered: 0x00000000 | 0x00000004 | 0x00000020 | 0x00000800,
        leftCenteredEllipsis: 0x00000000 | 0x00000004 | 0x00000020 | 0x00000800 | 0x00008000,
        centered: 0x00000001 | 0x00000004 | 0x00000020 | 0x00000800,
        centeredEllipsis: 0x00000001 | 0x00000004 | 0x00000020 | 0x00000800 | 0x00008000,
        right: 0x00000002 | 0x00000004 | 0x00000020 | 0x00000800,
        wordBreakCentered: 0x00000001 | 0x00000004 | 0x00000010 | 0x00000800
    };

    // Canonical Segoe Fluent/MDL2 codepoints shared by RVG panels.
    api.icons = {
        menu: '\uE700',
        preferences: '\uE713',
        timer: '\uE916',
        heart: '\uEB51',
        heartFill: '\uEB52',
        tag: '\uE8EC',
        convert: '\uE895',
        move: '\uE8DE',
        albumArt: '\uE7AA',
        folder: '\uE838',
        starOutline: '\uE734',
        starFill: '\uE735',
        previous: '\uE892',
        play: '\uE768',
        pause: '\uE769',
        stop: '\uE71A',
        next: '\uE893'
    };

    api.clamp = clamp;
    api.rgb = rgb;
    api.rgba = rgba;
    api.channel = channel;
    api.mix = mix;
    api.opaque = opaque;
    api.withAlpha = withAlpha;
    api.luminance = luminance;
    api.relativeLuminance = relativeLuminance;
    api.contrastRatio = contrastRatio;
    api.contrastingForegroundForBackgrounds = contrastingForegroundForBackgrounds;
    api.rect = makeRect;
    api.pointInRect = pointInRect;
    api.paintArea = paintArea;
    api.areaHits = areaHits;
    api.font = safeFont;
    api.clearFontCache = clearFontCache;
    api.measureText = measureText;
    api.iconFontFamily = iconFontFamily;
    api.hostInfo = hostInfo;
    api.hostFontFamily = hostFontFamily;
    api.commonLabelsFontInfo = commonLabelsFontInfo;
    api.consoleFontInfo = consoleFontInfo;
    api.setSharedTheme = setSharedTheme;
    api.getSharedTheme = getSharedTheme;
    api.createTheme = createTheme;
    api.selectorVisual = selectorVisual;
    api.buttonVisual = buttonVisual;
    api.createPainter = createPainter;

    return api;
}(typeof RivageUI !== 'undefined' ? RivageUI : null));
