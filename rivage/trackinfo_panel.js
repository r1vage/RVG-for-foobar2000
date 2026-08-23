window.DrawMode = 0;
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\dynamic_theme_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\album_accent_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\settings_protocol.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\design_system.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\playback_stats_source.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\track_context.js");
include(fb.ProfilePath + "jsplitter\\rivage\\shared\\visible_paint_work.js");
window.EraseOnRepaint = false;

window.DefineScript(RivageUI.copy.popupTitle('Track information'), {
    author: 'RivaGe',
    version: '2.5.0',
    features: {
        drag_n_drop: false,
        grab_focus: true
    }
});

var MF_STRING = 0x00000000;
var IDC_ARROW = 32512;
var IDC_HAND = 32649;
var MK_SHIFT = 0x0004;

var DT_LEFT = 0x00000000;
var DT_CENTER = 0x00000001;
var DT_VCENTER = 0x00000004;
var DT_WORDBREAK = 0x00000010;
var DT_SINGLELINE = 0x00000020;
var DT_NOPREFIX = 0x00000800;
var DT_END_ELLIPSIS = 0x00008000;

var DWRITE_TEXT_ALIGNMENT_LEADING = 0;
var DWRITE_TEXT_ALIGNMENT_CENTER = 2;
var DWRITE_PARAGRAPH_ALIGNMENT_NEAR = 0;
var DWRITE_PARAGRAPH_ALIGNMENT_CENTER = 2;
var DWRITE_WORD_WRAPPING_WRAP = 0;
var DWRITE_WORD_WRAPPING_NO_WRAP = 1;

var FONT_STYLE_REGULAR = 0;
var FONT_STYLE_BOLD = 1;

var PlaybackStopReason = { user: 0, eof: 1, starting_another: 2 };

// Match the Last.fm panel's scaling model. JSplitter does not need a raw
// window.DPI value here: the active foobar2000 host font size is compared with
// a 12-point baseline, and the resulting percentage scales both text and layout.
var g_dpi = 100;

function _scale(value) {
    return Math.round(value * g_dpi / 100);
}

function make_font(name, size, style) {
    return RivageUI.font(name || 'Segoe UI', Math.max(1, _scale(size)), style || 0);
}

function draw_text(gr, text, font, colour, x, y, w, h, align, valign, wrapping) {
    var flags = DT_NOPREFIX;

    if (!gr || !font || text === null || typeof text == 'undefined' || w <= 0 || h <= 0) return;

    flags |= align == DWRITE_TEXT_ALIGNMENT_CENTER ? DT_CENTER : DT_LEFT;
    flags |= valign == DWRITE_PARAGRAPH_ALIGNMENT_CENTER ? DT_VCENTER : 0;

    if (wrapping == DWRITE_WORD_WRAPPING_WRAP) flags |= DT_WORDBREAK;
    else flags |= DT_SINGLELINE | DT_END_ELLIPSIS;

    gr.GdiDrawText(String(text), font, colour, x, y, w, h, flags);
}

function reveal_in_explorer(path) {
    var result;

    if (!path) return;

    try {
        result = utils.Run('explorer.exe', '/select,"' + String(path).replace(/"/g, '') + '"');
        if (result && result.OK === false) {
            fb.ShowPopupMessage('Could not open File Explorer.\n\nTechnical details: Win32 error ' + result.Win32Error, RivageUI.copy.popupTitle('Track information'));
        }
    } catch (e) {
        fb.ShowPopupMessage('Could not open File Explorer.\n\nTechnical details: ' + e.message, RivageUI.copy.popupTitle('Track information'));
    }
}

function VisibilityGate(order) {
    this.order = order.slice(0);
    this.pending = Object.create(null);
    this.flushing = false;

    this.prime = function (keys) {
        for (var i = 0; i < keys.length; i++) this.pending[keys[i]] = true;
    };

    this.is_visible = function () {
        return VisiblePaintWork.isVisible();
    };

    this.repaint = function () {
        if (this.is_visible()) window.Repaint();
    };

    this.request = function (key, should_repaint) {
        this.pending[key] = true;
        if (!this.flushing && should_repaint !== false) this.repaint();
    };

    this.flush = function (apply) {
        var progressed;
        var i;
        var key;
        var failure = null;

        if (!this.is_visible()) return false;

        this.flushing = true;
        try {
            do {
                progressed = false;
                for (i = 0; i < this.order.length; i++) {
                    key = this.order[i];
                    if (!this.pending[key]) continue;
                    delete this.pending[key];
                    try {
                        apply(key);
                    } catch (e) {
                        this.pending[key] = true;
                        failure = e;
                        break;
                    }
                    progressed = true;
                }
            } while (progressed && !failure);
        } finally {
            this.flushing = false;
        }

        if (failure) {
            try { console.log('Track information deferred update failed: ' + String(failure)); } catch (e2) { }
        }
        return !failure;
    };
}

var ACCENT_FIXED = 0;
var ACCENT_SHARED = 1;
var DEFAULT_UWP_ACCENT = 0xff0078d4;
var sharedAlbumAccent = DEFAULT_UWP_ACCENT;

// Metadata callbacks from playback-statistics and Last.fm components can arrive
// in bursts. Background refreshes are throttled to this user-selectable rate;
// explicit track/focus changes and manual refreshes remain immediate.
var DATA_REFRESH_INTERVALS = [0, 5000, 15000, 30000, 60000];
var DEFAULT_DATA_REFRESH_MS = 15000;

var ENHANCED_LASTFM_HIDDEN = 0;
var ENHANCED_LASTFM_COLLAPSED = 1;
var ENHANCED_LASTFM_EXPANDED = 2;

var VISIBILITY_ORDER = ['init', 'colours', 'accent', 'font', 'size', 'focus', 'data'];
var visibility = new VisibilityGate(VISIBILITY_ORDER);
var panel = null;
var song_info = null;

visibility.prime(VISIBILITY_ORDER);

function clean_text(value) {
    var text;

    if (value === null || typeof value == 'undefined') return '';

    text = String(value)
        .replace(/\r?\n/g, '  \u00B7  ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return text == '?' ? '' : text;
}

function normalise_key(value) {
    return clean_text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function same_metadb(first, second) {
    var first_path;
    var second_path;
    var first_subsong;
    var second_subsong;

    if (!first && !second) return true;
    if (!first || !second) return false;

    try {
        if (typeof first.Compare == 'function' && first.Compare(second)) return true;
    } catch (e) { }

    try {
        first_path = String(first.RawPath || first.Path || '');
        second_path = String(second.RawPath || second.Path || '');
        first_subsong = Number(first.SubSong) || 0;
        second_subsong = Number(second.SubSong) || 0;
    } catch (e2) {
        return false;
    }

    return first_path.length > 0 && first_path == second_path && first_subsong == second_subsong;
}

function changed_handles_include_metadb(handles, metadb) {
    var count;
    var i;

    if (!handles || !metadb) return true;

    try {
        count = Number(handles.Count);
    } catch (e) {
        return true;
    }

    // Empty/unknown lists are treated as global changes. Otherwise ignore
    // updates to unrelated library items so they cannot disturb this panel.
    if (!isFinite(count) || count <= 0) return true;

    for (i = 0; i < count; i++) {
        try {
            if (same_metadb(handles[i], metadb)) return true;
        } catch (e2) {
            return true;
        }
    }

    return false;
}

function get_section(object, wanted_name) {
    var key;
    var wanted = normalise_key(wanted_name);

    if (!object) return {};

    for (key in object) {
        if (object.hasOwnProperty(key) && normalise_key(key) == wanted) {
            return object[key] || {};
        }
    }

    return {};
}

function object_has_keys(object) {
    var key;

    if (!object) return false;

    for (key in object) {
        if (object.hasOwnProperty(key)) return true;
    }

    return false;
}

function same_display_value(first, second) {
    return normalise_key(first) == normalise_key(second);
}

function get_value(object, aliases) {
    var key;
    var i;
    var normalised = {};

    if (!object) return '';

    for (key in object) {
        if (object.hasOwnProperty(key)) {
            normalised[normalise_key(key)] = object[key];
        }
    }

    for (i = 0; i < aliases.length; i++) {
        key = normalise_key(aliases[i]);
        if (normalised.hasOwnProperty(key)) {
            return clean_text(normalised[key]);
        }
    }

    return '';
}

function join_unique(values, separator) {
    var output = [];
    var seen = {};
    var i;
    var value;
    var key;

    for (i = 0; i < values.length; i++) {
        value = clean_text(values[i]);
        key = value.toLowerCase();

        if (value.length && !seen[key]) {
            seen[key] = true;
            output.push(value);
        }
    }

    return output.join(separator || ' \u00B7 ');
}

function ensure_suffix(value, suffix) {
    value = clean_text(value);
    if (!value.length) return '';
    if (value.toLowerCase().indexOf(suffix.toLowerCase()) > -1) return value;
    return value + ' ' + suffix;
}

function pair_value(first, second) {
    first = clean_text(first);
    second = clean_text(second);

    if (first.length && second.length) return first + ' / ' + second;
    return first || second;
}

function extract_year(value) {
    var match = clean_text(value).match(/(?:^|\D)(\d{4})(?:\D|$)/);
    return match ? match[1] : clean_text(value);
}

function extract_years(values) {
    var years = [];
    var seen = {};
    var i;
    var year;

    for (i = 0; i < values.length; i++) {
        year = extract_year(values[i]);
        if (year.length && !seen[year]) {
            seen[year] = true;
            years.push(year);
        }
    }

    return years;
}

function normalise_rating(value) {
    var text = clean_text(value).replace(',', '.');
    var match;
    var rating;

    if (!text.length) return null;

    // The supported playback-statistics sources normally return a numeric
    // value from 0 to 5. Also accept strings such as "4 / 5".
    match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;

    rating = Number(match[0]);
    if (!isFinite(rating)) return null;

    return Math.max(0, Math.min(5, Math.round(rating)));
}

function normalise_time_mode(value) {
    value = Number(value);
    return value == 1 || value == 2 ? value : 0;
}

function format_query_value(value) {
    value = clean_text(value);

    if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
    return '"' + value.replace(/"/g, '""') + '"';
}

function CompactPanel() {
    var legacy_selection;

    this.w = 0;
    this.h = 0;
    this.metadb = null;
    this.metadb_uses_now_playing = false;
    this.tfo = Object.create(null);
    legacy_selection = Number(window.GetProperty('COMPACT.SONG.INFO.SELECTION', 0));
    this.track_context_override = TrackContext.normaliseOverride(window.GetProperty('COMPACT.SONG.INFO.TRACK.CONTEXT.OVERRIDE', ''));
    if (window.GetProperty('COMPACT.SONG.INFO.TRACK.CONTEXT.OVERRIDE', '') === '') {
        this.track_context_override = legacy_selection == 1 ? TrackContext.MODE_SELECTION : TrackContext.MODE_GLOBAL;
        window.SetProperty('COMPACT.SONG.INFO.TRACK.CONTEXT.OVERRIDE', this.track_context_override);
    }
    this.font_size = Number(window.GetProperty('COMPACT.SONG.INFO.FONT.SIZE', 13));
    this.accent_mode = Number(window.GetProperty('COMPACT.SONG.INFO.ACCENT.MODE', ACCENT_SHARED));
    this.data_refresh_interval = Number(window.GetProperty('COMPACT.SONG.INFO.DATA.REFRESH.MS', DEFAULT_DATA_REFRESH_MS));
    this.enhanced_lastfm_mode = Number(window.GetProperty('COMPACT.SONG.INFO.ENHANCED.LASTFM.MODE', ENHANCED_LASTFM_EXPANDED));
    this.font_size = [9, 10, 11, 12, 13].indexOf(this.font_size) >= 0 ? this.font_size : 13;
    this.accent_mode = this.accent_mode == ACCENT_FIXED ? ACCENT_FIXED : ACCENT_SHARED;
    this.data_refresh_interval = DATA_REFRESH_INTERVALS.indexOf(this.data_refresh_interval) >= 0 ?
        this.data_refresh_interval : DEFAULT_DATA_REFRESH_MS;
    this.enhanced_lastfm_mode = [
        ENHANCED_LASTFM_HIDDEN,
        ENHANCED_LASTFM_COLLAPSED,
        ENHANCED_LASTFM_EXPANDED
    ].indexOf(this.enhanced_lastfm_mode) >= 0 ? this.enhanced_lastfm_mode : ENHANCED_LASTFM_EXPANDED;
    this.font_name = 'Segoe UI';
    this.fonts = {};
    this.colours = {};
    this.theme = RivageUI.createTheme({
        mode: 'host',
        accent: this.accent_mode == ACCENT_SHARED ? sharedAlbumAccent : DEFAULT_UWP_ACCENT
    });
    this.ui = RivageUI.createPainter({ scale: _scale, theme: this.theme });

    this.size = function (width, height) {
        this.w = typeof width == 'number' ? width : window.Width;
        this.h = typeof height == 'number' ? height : window.Height;
        if (song_info) song_info.clamp_scroll();
    };

    this.rebuild_theme = function () {
        var host = RivageUI.hostInfo();
        var accent = this.accent_mode == ACCENT_SHARED ?
            sharedAlbumAccent :
            DEFAULT_UWP_ACCENT;

        this.theme = RivageUI.createTheme({
            mode: 'host',
            host: host,
            background: host.background,
            text: host.text,
            accent: accent
        });
        this.ui.setTheme(this.theme);

        this.colours.background = this.theme.background;
        this.colours.text = this.theme.textPrimary;
        this.colours.muted = this.theme.textMuted;
        this.colours.card = this.theme.card;
        this.colours.card_alt = this.theme.chip;
        this.colours.card_hover = this.theme.cardHover;
        this.colours.border = this.theme.stroke;
        this.colours.accent = this.theme.accent;
        this.colours.scroll_track = this.theme.scrollTrack;
    };

    this.colours_changed = function () {
        this.rebuild_theme();
    };

    this.refresh_accent = function () {
        this.rebuild_theme();
    };

    this.font_changed = function () {
        var host = RivageUI.hostInfo();
        var scale_size = Number(host.scaleFontSize) || 12;

        this.font_name = host.fontFamily || 'Segoe UI';
        g_dpi = isFinite(scale_size) && scale_size > 0 ?
            Math.max(50, Math.round(scale_size / 12 * 100)) :
            100;

        RivageUI.clearFontCache();
        this.fonts.normal = make_font(this.font_name, this.font_size, FONT_STYLE_REGULAR);
        this.fonts.value = make_font(this.font_name, this.font_size, FONT_STYLE_BOLD);
        this.fonts.small = make_font(this.font_name, Math.max(8, this.font_size - 1), FONT_STYLE_REGULAR);
        this.fonts.section = make_font(this.font_name, Math.max(8, this.font_size - 1), FONT_STYLE_BOLD);
        this.fonts.rating = make_font(RivageUI.iconFontFamily(), 15, FONT_STYLE_REGULAR);
    };

    this.update_metadb = function () {
        var resolved = TrackContext.resolve(this.track_context_override);
        var next_metadb = resolved.handle;
        var changed = !same_metadb(this.metadb, next_metadb);

        this.metadb = next_metadb;
        this.metadb_uses_now_playing = resolved.isNowPlaying;
        return changed;
    };

    this.get_tfo = function (format) {
        if (!this.tfo[format]) this.tfo[format] = fb.TitleFormat(format);
        return this.tfo[format];
    };

    this.tf = function (format) {
        var tfo;

        if (!this.metadb) return '';
        tfo = this.get_tfo(format);

        if (this.metadb_uses_now_playing) return clean_text(tfo.Eval());
        return clean_text(tfo.EvalWithMetadb(this.metadb));
    };

    this.paint = function (gr) {
        gr.FillSolidRect(0, 0, this.w, this.h, this.colours.background);
    };

    this.rbtn_up = function (x, y) {
        var menu = window.CreatePopupMenu();
        var font_menu = window.CreatePopupMenu();
        var refresh_menu = window.CreatePopupMenu();
        var enhanced_lastfm_menu = window.CreatePopupMenu();
        var sizes = [9, 10, 11, 12, 13];
        var refresh_labels = ['Immediate', 'Every 5 seconds', 'Every 15 seconds', 'Every 30 seconds', 'Every 60 seconds'];
        var selected_size = sizes.indexOf(this.font_size);
        var selected_refresh = DATA_REFRESH_INTERVALS.indexOf(this.data_refresh_interval);
        var selected_lastfm = this.enhanced_lastfm_mode == ENHANCED_LASTFM_EXPANDED ? 220 :
            (this.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED ? 221 : 222);
        var i;
        var id;

        var trackChoices = TrackContext.getOverrideChoices();
        menu.AppendMenuItem(MF_STRING, 1, trackChoices[0].label);
        menu.AppendMenuItem(MF_STRING, 2, trackChoices[1].label);
        menu.AppendMenuItem(MF_STRING, 3, trackChoices[2].label);
        menu.AppendMenuItem(MF_STRING, 4, trackChoices[3].label);
        var trackMenuId = this.track_context_override == TrackContext.MODE_AUTO ? 2 :
            (this.track_context_override == TrackContext.MODE_NOW_PLAYING ? 3 :
            (this.track_context_override == TrackContext.MODE_SELECTION ? 4 : 1));
        menu.CheckMenuRadioItem(1, 4, trackMenuId);
        menu.AppendMenuSeparator();

        for (i = 0; i < sizes.length; i++) {
            font_menu.AppendMenuItem(MF_STRING, 100 + i, sizes[i] + ' pt');
        }

        if (selected_size < 0) selected_size = sizes.length - 1;
        font_menu.CheckMenuRadioItem(100, 100 + sizes.length - 1, 100 + selected_size);
        font_menu.AppendTo(menu, MF_STRING, 'Font size');

        for (i = 0; i < DATA_REFRESH_INTERVALS.length; i++) {
            refresh_menu.AppendMenuItem(MF_STRING, 200 + i, refresh_labels[i]);
        }

        if (selected_refresh < 0) selected_refresh = DATA_REFRESH_INTERVALS.indexOf(DEFAULT_DATA_REFRESH_MS);
        refresh_menu.CheckMenuRadioItem(200, 200 + DATA_REFRESH_INTERVALS.length - 1, 200 + selected_refresh);
        refresh_menu.AppendTo(menu, MF_STRING, 'Refresh interval');
        menu.AppendMenuItem(MF_STRING, 21, 'Refresh now');

        enhanced_lastfm_menu.AppendMenuItem(MF_STRING, 220, 'Expanded');
        enhanced_lastfm_menu.AppendMenuItem(MF_STRING, 221, 'Collapsed');
        enhanced_lastfm_menu.AppendMenuItem(MF_STRING, 222, 'Hidden');
        enhanced_lastfm_menu.CheckMenuRadioItem(220, 222, selected_lastfm);
        enhanced_lastfm_menu.AppendTo(menu, MF_STRING, 'Last.fm details');

        menu.AppendMenuSeparator();
        menu.AppendMenuItem(MF_STRING, 30, 'Accent: ' + RivageUI.copy.labels.rvgBlue);
        menu.AppendMenuItem(MF_STRING, 31, 'Accent: ' + RivageUI.copy.labels.sharedAccent);
        menu.CheckMenuRadioItem(30, 31, this.accent_mode == ACCENT_FIXED ? 30 : 31);

        menu.AppendMenuSeparator();
        menu.AppendMenuItem(MF_STRING, 20, RivageUI.copy.labels.panelConfiguration);

        id = menu.TrackPopupMenu(x, y);

        if (id >= 1 && id <= 4) {
            set_track_context_override(id == 1 ? TrackContext.MODE_GLOBAL :
                (id == 2 ? TrackContext.MODE_AUTO :
                    (id == 3 ? TrackContext.MODE_NOW_PLAYING : TrackContext.MODE_SELECTION)));
        } else if (id >= 100 && id < 100 + sizes.length) {
            set_font_size(sizes[id - 100]);
        } else if (id >= 200 && id < 200 + DATA_REFRESH_INTERVALS.length) {
            set_data_refresh_interval(DATA_REFRESH_INTERVALS[id - 200]);
        } else if (id == 21) {
            request_data_update(true);
        } else if (id >= 220 && id <= 222) {
            set_enhanced_lastfm_mode(id == 220 ? ENHANCED_LASTFM_EXPANDED :
                (id == 221 ? ENHANCED_LASTFM_COLLAPSED : ENHANCED_LASTFM_HIDDEN));
        } else if (id == 30 || id == 31) {
            set_accent_mode(id == 30 ? ACCENT_FIXED : ACCENT_SHARED);
        } else if (id == 20) {
            window.ShowConfigureV2();
        }

        return true;
    };
}

function CompactSongInfo(owner) {
    this.owner = owner;
    this.cards = [];
    this.hit_rows = [];
    this.hover_hit = null;
    this.scroll_offset = 0;
    this.content_height = 0;
    this.max_scroll = 0;
    this.reset_scroll_on_build = true;

    // Per-field display mode for Playcount 2003's time-related fields, cycled
    // by clicking the row: 0 = date/time, 1 = "_ago", 2 = "_ago2". Only ever
    // read/written while PlaybackStatsSource.isPlaycount2003() is true - see
    // add_time_row/time_field_value below. Persisted per field so the chosen
    // display survives track changes and panel reloads.
    this.time_mode = {
        added: normalise_time_mode(window.GetProperty('COMPACT.SONG.INFO.2003.ADDED.MODE', 0)),
        first_played: normalise_time_mode(window.GetProperty('COMPACT.SONG.INFO.2003.FIRST.PLAYED.MODE', 0)),
        last_played: normalise_time_mode(window.GetProperty('COMPACT.SONG.INFO.2003.LAST.PLAYED.MODE', 0))
    };

    this.get_time_mode = function (field) {
        return this.time_mode[field] || 0;
    };

    this.cycle_time_mode = function (field) {
        var next = (this.get_time_mode(field) + 1) % 3;
        window.SetProperty(
            field === 'added' ? 'COMPACT.SONG.INFO.2003.ADDED.MODE' :
                (field === 'first_played' ? 'COMPACT.SONG.INFO.2003.FIRST.PLAYED.MODE' :
                    'COMPACT.SONG.INFO.2003.LAST.PLAYED.MODE'),
            next
        );
        this.time_mode[field] = next;
        return next;
    };

    this.invalidate_interactions = function () {
        this.hit_rows = [];
        this.hover_hit = null;
        try { window.SetCursor(IDC_ARROW); } catch (e) { }
    };

    this.request_scroll_reset = function () {
        this.reset_scroll_on_build = true;
    };

    this.read_other_info = function () {
        var handles;
        var raw = '';

        if (!this.owner.metadb) return {};

        try {
            handles = new FbMetadbHandleList(this.owner.metadb);
            raw = handles.GetOtherInfo();
            return raw.length ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    };

    this.read_metadata = function () {
        var output = {};
        var info = null;
        var i;
        var j;
        var name;
        var key;
        var values;
        var count;

        if (!this.owner.metadb) return output;

        try {
            // true requests full metadata, including configured large fields.
            info = this.owner.metadb.GetFileInfo(true);
            if (!info) return output;

            for (i = 0; i < info.MetaCount; i++) {
                name = clean_text(info.MetaName(i));
                key = normalise_key(name);
                values = [];
                count = info.MetaValueCount(i);

                for (j = 0; j < count; j++) {
                    values.push(clean_text(info.MetaValue(i, j)));
                }

                output[key] = {
                    name: name,
                    values: values
                };
            }
        } catch (e) {
            return output;
        }

        return output;
    };

    this.meta_entry = function (metadata, aliases) {
        var i;
        var key;

        for (i = 0; i < aliases.length; i++) {
            key = normalise_key(aliases[i]);
            if (metadata.hasOwnProperty(key)) return metadata[key];
        }

        return null;
    };

    this.meta_values = function (metadata, aliases) {
        var entry = this.meta_entry(metadata, aliases);
        return entry ? entry.values : [];
    };

    this.meta_text = function (metadata, aliases, separator) {
        return join_unique(this.meta_values(metadata, aliases), separator || ', ');
    };

    this.make_query_action = function (field, values, label) {
        var cleaned = [];
        var seen = {};
        var i;
        var value;
        var key;

        for (i = 0; i < values.length; i++) {
            value = clean_text(values[i]);
            key = value.toLowerCase();
            if (value.length && !seen[key]) {
                seen[key] = true;
                cleaned.push(value);
            }
        }

        if (!cleaned.length) return null;

        return {
            type: 'autoplaylist',
            field: field,
            values: cleaned,
            label: label
        };
    };

    this.add_row = function (rows, name, value, action) {
        value = clean_text(value);

        if (value.length) {
            rows.push({
                name: name,
                value: value,
                action: action || null
            });
        }
    };

    this.add_rating_row = function (rows, name, value) {
        var rating = normalise_rating(value);

        if (rating === null) return;

        rows.push({
            name: name,
            value: rating + ' / 5',
            rating: rating,
            action: null
        });
    };

    // Enhanced Playback Statistics can return the literal text
    // "Invalid timestamp" for the three *_enhanced date fields when its own
    // play arrays are empty and the corresponding foo_playcount field also
    // evaluates to an empty string. Validate date output here and reconstruct
    // the documented fallback from the component's source fields when needed.
    this.valid_timestamp = function (value) {
        var text = clean_text(value);
        var match;
        var year;
        var month;
        var day;
        var hour;
        var minute;
        var second;
        var days_in_month;

        if (!text.length || /^(?:n\/?a|invalid(?:\s+file)?\s+timestamp|invalid\s+date)$/i.test(text)) {
            return '';
        }

        match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
        if (!match) return '';

        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
        hour = Number(match[4]);
        minute = Number(match[5]);
        second = Number(match[6]);

        if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return '';

        days_in_month = [31, (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) ? 29 : 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day < 1 || day > days_in_month[month - 1]) return '';

        // Return a stable fixed-width value. Lexicographic comparison now has
        // the same ordering as chronological comparison for these timestamps.
        return match[1] + '-' + match[2] + '-' + match[3] + ' ' +
            match[4] + ':' + match[5] + ':' + match[6];
    };

    this.pick_timestamp = function (first, second, latest) {
        first = this.valid_timestamp(first);
        second = this.valid_timestamp(second);

        if (!first.length) return second;
        if (!second.length) return first;
        return latest ? (first > second ? first : second) : (first < second ? first : second);
    };

    this.enhanced_titleformat_value = function (field) {
        var direct = this.owner.tf('[' + field + ']');
        var local;
        var lastfm;
        var resolved;
        var is_date_field = field == '%lastfm_added%' ||
            field == '%lastfm_first_played%' ||
            field == '%lastfm_last_played%' ||
            field == '%added_enhanced%' ||
            field == '%first_played_enhanced%' ||
            field == '%last_played_enhanced%';

        if (!is_date_field) return direct || 'N/A';

        resolved = this.valid_timestamp(direct);
        if (resolved.length) return resolved;

        if (field == '%added_enhanced%') {
            local = this.owner.tf('[%added%]');
            lastfm = this.owner.tf('[%lastfm_added%]');
            resolved = this.pick_timestamp(local, lastfm, false);
        } else if (field == '%first_played_enhanced%') {
            local = this.owner.tf('[%first_played%]');
            lastfm = this.owner.tf('[%lastfm_first_played%]') ||
                this.owner.tf('[%lastfm_added%]');
            resolved = this.pick_timestamp(local, lastfm, false);
        } else if (field == '%last_played_enhanced%') {
            local = this.owner.tf('[%last_played%]');
            lastfm = this.owner.tf('[%lastfm_last_played%]');
            resolved = this.pick_timestamp(local, lastfm, true);
        }

        return resolved || 'N/A';
    };

    this.add_titleformat_row = function (rows, field) {
        this.add_row(rows, field, this.enhanced_titleformat_value(field));
    };

    this.time_field_value = function (field) {
        var mode = this.get_time_mode(field);
        var suffix = mode === 1 ? '_ago' : (mode === 2 ? '_ago2' : '');
        return this.owner.tf('[%2003_' + field + suffix + '%]') || 'N/A';
    };

    this.add_time_row = function (rows, label, field) {
        this.add_row(rows, label, this.time_field_value(field), { type: 'toggle_2003_time', field: field });
    };

    this.add_card = function (title, rows, layout) {
        if (rows.length) {
            this.cards.push({
                title: title,
                rows: rows,
                layout: layout || 'full'
            });
        }
    };

    this.detect_lyrics = function (metadata) {
        var synced = false;
        var unsynced = false;
        var explicit_synced = this.meta_values(metadata, [
            'SYNCED LYRICS',
            'SYNCEDLYRICS',
            'LYRICS SYNCED',
            'LYRICS_SYNCED'
        ]);
        var explicit_unsynced = this.meta_values(metadata, [
            'UNSYNCED LYRICS',
            'UNSYNCEDLYRICS',
            'LYRICS UNSYNCED',
            'LYRICS_UNSYNCED'
        ]);
        var generic = this.meta_values(metadata, ['LYRICS']);
        var i;
        var value;

        synced = explicit_synced.length > 0;
        unsynced = explicit_unsynced.length > 0;

        for (i = 0; i < generic.length; i++) {
            value = generic[i];
            if (/\[(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(value)) {
                synced = true;
            } else if (clean_text(value).length) {
                unsynced = true;
            }
        }

        if (synced && unsynced) return 'Synced \u2713   Unsynced \u2713';
        if (synced) return 'Synced \u2713';
        if (unsynced) return 'Unsynced \u2713';
        return '';
    };

    this.build = function () {
        var other;
        var location;
        var general;
        var enhanced_stats;
        var playback_stats;
        var metadata;
        var rows;
        var entry;
        var original_entry;
        var values;
        var original_values;
        var artist;
        var artist_display;
        var album_artist;
        var album;
        var title;
        var composer;
        var performer;
        var comment;
        var date;
        var date_display;
        var original_date;
        var genre;
        var track_number;
        var total_tracks;
        var disc_number;
        var total_discs;
        var duration;
        var codec;
        var profile;
        var bitrate;
        var codec_bitrate;
        var sample_rate;
        var track_gain;
        var track_peak;
        var album_gain;
        var path;
        var encoding;
        var tool;
        var lyrics;
        var rating;
        var first_value;
        var last_value;
        var reset_scroll = this.reset_scroll_on_build;

        this.reset_scroll_on_build = false;
        this.cards = [];
        this.invalidate_interactions();

        if (reset_scroll) this.scroll_offset = 0;
        if (!this.owner.metadb) {
            this.scroll_offset = 0;
            return;
        }

        other = this.read_other_info();
        location = get_section(other, 'Location');
        general = get_section(other, 'General');
        enhanced_stats = get_section(other, 'Enhanced Playback Statistics (Last.fm scrobble data)');
        playback_stats = get_section(other, 'Playback Statistics');
        metadata = this.read_metadata();

        rows = [];

        entry = this.meta_entry(metadata, ['ARTIST']);
        values = entry ? entry.values : [];
        artist = values.length ? join_unique(values, ', ') : this.owner.tf('[%artist%]');

        album_artist = this.meta_text(metadata, [
            'ALBUM ARTIST',
            'ALBUMARTIST',
            'BAND'
        ], ', ') || this.owner.tf('[%album artist%]');

        artist_display = artist;
        if (album_artist.length && !same_display_value(album_artist, artist)) {
            artist_display = pair_value(artist, album_artist);
        }

        this.add_row(
            rows,
            'Artist',
            artist_display,
            this.make_query_action(entry ? entry.name : 'ARTIST', values.length ? values : [artist], 'Artist')
        );

        entry = this.meta_entry(metadata, ['ALBUM']);
        values = entry ? entry.values : [];
        album = values.length ? join_unique(values, ', ') : this.owner.tf('[%album%]');
        this.add_row(
            rows,
            'Album',
            album,
            this.make_query_action(entry ? entry.name : 'ALBUM', values.length ? values : [album], 'Album')
        );

        title = this.meta_text(metadata, ['TITLE'], ', ') || this.owner.tf('[%title%]');
        this.add_row(rows, 'Title', title);

        composer = this.meta_text(metadata, ['COMPOSER'], ', ') || this.owner.tf("[$meta_sep(composer,', ')]");
        this.add_row(rows, 'Composer', composer);

        performer = this.meta_text(metadata, ['PERFORMER'], ', ') || this.owner.tf("[$meta_sep(performer,', ')]");
        this.add_row(rows, 'Performer', performer);

        entry = this.meta_entry(metadata, ['DATE', 'YEAR']);
        values = entry ? entry.values : [];
        date = values.length ? join_unique(values, ', ') : this.owner.tf('[%date%]');

        original_entry = this.meta_entry(metadata, [
            'ORIGINAL RELEASE DATE',
            'ORIGINAL DATE',
            'ORIGINALDATE',
            'RELEASE DATE'
        ]);
        original_values = original_entry ? original_entry.values : [];
        original_date = original_values.length ?
            join_unique(original_values, ', ') :
            this.owner.tf('[$if2($meta(original release date),$if2($meta(original date),$meta(originaldate)))]');

        date_display = date;
        if (original_date.length && !same_display_value(original_date, date)) {
            date_display = pair_value(date, original_date);
        }

        this.add_row(
            rows,
            'Date',
            date_display,
            this.make_query_action(
                date.length ? (entry ? entry.name : 'DATE') : (original_entry ? original_entry.name : 'ORIGINAL RELEASE DATE'),
                extract_years(
                    date.length ?
                        (values.length ? values : [date]) :
                        (original_values.length ? original_values : (original_date.length ? [original_date] : []))
                ),
                'Date'
            )
        );

        entry = this.meta_entry(metadata, ['GENRE']);
        values = entry ? entry.values : [];
        genre = values.length ? join_unique(values, ', ') : this.owner.tf("[$meta_sep(genre,', ')]");
        this.add_row(
            rows,
            'Genre',
            genre,
            this.make_query_action(entry ? entry.name : 'GENRE', values.length ? values : [genre], 'Genre')
        );

        track_number = this.meta_text(metadata, ['TRACKNUMBER', 'TRACK NUMBER'], ', ') || this.owner.tf('[%tracknumber%]');
        total_tracks = this.meta_text(metadata, ['TOTALTRACKS', 'TOTAL TRACKS', 'TRACKTOTAL'], ', ') || this.owner.tf('[%totaltracks%]');
        this.add_row(rows, 'Tracks / total', pair_value(track_number, total_tracks));

        disc_number = this.meta_text(metadata, ['DISCNUMBER', 'DISC NUMBER'], ', ') || this.owner.tf('[%discnumber%]');
        total_discs = this.meta_text(metadata, ['TOTALDISCS', 'TOTAL DISCS', 'DISCTOTAL'], ', ') || this.owner.tf('[%totaldiscs%]');
        this.add_row(rows, 'Disc / total discs', pair_value(disc_number, total_discs));

        comment = this.meta_text(metadata, [
            'COMMENT',
            'DESCRIPTION'
        ], ' \u00B7 ') || this.owner.tf('[%comment%]');
        this.add_row(rows, 'Comment', comment);

        lyrics = this.detect_lyrics(metadata);
        this.add_row(rows, 'Lyrics', lyrics);

        this.add_card('TRACK', rows);

        rows = [];

        duration = this.owner.metadb.Length > 0 ? utils.FormatDuration(this.owner.metadb.Length) : '';
        this.add_row(rows, 'Duration', duration);

        codec = get_value(general, ['Codec']) || this.owner.tf('[%codec%]');
        profile = get_value(general, ['Codec profile', 'Profile']) || this.owner.tf('[%codec_profile%]');
        bitrate = get_value(general, ['Average bitrate', 'Bitrate']);
        if (!bitrate.length) bitrate = ensure_suffix(this.owner.tf('[%bitrate%]'), 'kbps');
        codec_bitrate = join_unique([join_unique([codec, profile], ' '), bitrate], ' \u00B7 ');
        this.add_row(rows, 'Codec profile / avg. bitrate', codec_bitrate);

        sample_rate = get_value(general, ['Sample rate', 'Samplerate']);
        if (!sample_rate.length) sample_rate = ensure_suffix(this.owner.tf('[%samplerate%]'), 'Hz');
        this.add_row(rows, 'Sample rate', sample_rate);

        track_gain = get_value(general, [
            'ReplayGain track gain',
            'Track gain',
            'RG track gain'
        ]) || this.owner.tf('[%replaygain_track_gain%]');
        this.add_row(rows, 'Track gain', track_gain);

        track_peak = get_value(general, [
            'ReplayGain track peak',
            'Track peak',
            'RG track peak'
        ]) || this.owner.tf('[%replaygain_track_peak%]');
        this.add_row(rows, 'Track peak', track_peak);

        album_gain = get_value(general, [
            'ReplayGain album gain',
            'Album gain',
            'RG album gain'
        ]) || this.owner.tf('[%replaygain_album_gain%]');
        this.add_row(rows, 'Album gain', album_gain);

        this.add_card('AUDIO', rows);

        rows = [];

        path = get_value(location, ['File path']) || clean_text(this.owner.metadb.Path) || this.owner.tf('[%path%]');
        this.add_row(rows, 'Full file path', path, path.length ? {type: 'open_path', path: path} : null);

        this.add_row(
            rows,
            'File size',
            get_value(location, ['File size']) || this.owner.tf('[%filesize_natural%]')
        );

        this.add_row(
            rows,
            'File created',
            get_value(location, ['Created', 'File created']) || this.owner.tf('[%file_created%]')
        );

        this.add_row(
            rows,
            'File modified',
            get_value(location, ['Last modified', 'Modified', 'File modified']) || this.owner.tf('[%last_modified%]')
        );

        encoding = get_value(general, ['Encoding']) || this.meta_text(metadata, ['ENCODING'], ', ');
        tool = get_value(general, [
            'Tool',
            'Encoder',
            'Encoded by',
            'Encoding tool'
        ]) || this.meta_text(metadata, [
            'ENCODED BY',
            'ENCODER',
            'ENCODING TOOL',
            'TOOL'
        ], ', ');
        this.add_row(rows, 'Encoding / tool', join_unique([encoding, tool], ' \u00B7 '));

        this.add_card('FILE', rows);

        // Statistics: Playback Statistics is always the left card and
        // Enhanced Playback Statistics is always the right card. Each card
        // reads only its own GetOtherInfo section; values are never borrowed.

        if (PlaybackStatsSource.isPlaycount2003()) {
            rows = [];
            this.add_rating_row(rows, 'Rating', this.owner.tf('[%2003_rating%]'));
            this.add_row(rows, 'Loved', this.owner.tf('[%2003_loved%]'));
            this.add_time_row(rows, 'Added', 'added');
            this.add_row(rows, 'Play count', this.owner.tf('[%2003_playcount%]'));
            this.add_time_row(rows, 'First played', 'first_played');
            this.add_time_row(rows, 'Last played', 'last_played');
            this.add_card('PLAYBACK STATISTICS', rows, 'stats_left');
        } else if (object_has_keys(playback_stats)) {
            rows = [];
            rating = get_value(playback_stats, ['Rating']);
            this.add_rating_row(rows, 'Rating', rating);
            this.add_row(rows, 'Added', get_value(playback_stats, ['Added']));
            this.add_row(rows, 'Play count', get_value(playback_stats, ['Played', 'Play count', 'Playcount']));
            this.add_row(rows, 'First played', get_value(playback_stats, ['First played', 'First Played']) || 'N/A');
            this.add_row(rows, 'Last played', get_value(playback_stats, ['Last played', 'Last Played']) || 'N/A');
            this.add_card('PLAYBACK STATISTICS', rows, 'stats_left');
        } else {
            rows = [];
            rating = this.owner.tf('[%rating%]');
            first_value = this.owner.tf('[%first_played%]');
            last_value = this.owner.tf('[%last_played%]');
            this.add_rating_row(rows, 'Rating', rating);
            this.add_row(rows, 'Added', this.owner.tf('[%added%]'));
            this.add_row(rows, 'Play count', this.owner.tf('[%play_count%]'));
            if (rows.length || first_value.length || last_value.length) {
                this.add_row(rows, 'First played', first_value || 'N/A');
                this.add_row(rows, 'Last played', last_value || 'N/A');
            }
            this.add_card('PLAYBACK STATISTICS', rows, 'stats_left');
        }

        if (object_has_keys(enhanced_stats)) {
            rows = [];
            this.add_row(rows, 'Scrobbled', get_value(enhanced_stats, ['Scrobbled']));
            this.add_row(rows, 'First scrobble', get_value(enhanced_stats, ['First scrobble']) || 'N/A');
            this.add_row(rows, 'Last scrobble', get_value(enhanced_stats, ['Last scrobble']) || 'N/A');
            this.add_card('ENHANCED PLAYBACK STATISTICS', rows, 'stats_right');
        }

        if (this.owner.enhanced_lastfm_mode != ENHANCED_LASTFM_HIDDEN) {
            rows = [];
            this.add_titleformat_row(rows, '%played_times%');
            this.add_titleformat_row(rows, '%played_times_js%');
            this.add_titleformat_row(rows, '%played_times_raw%');
            this.add_titleformat_row(rows, '%lastfm_played_times%');
            this.add_titleformat_row(rows, '%lastfm_played_times_js%');
            this.add_titleformat_row(rows, '%lastfm_play_count%');
            this.add_titleformat_row(rows, '%lastfm_added%');
            this.add_titleformat_row(rows, '%lastfm_first_played%');
            this.add_titleformat_row(rows, '%lastfm_last_played%');
            this.add_titleformat_row(rows, '%added_enhanced%');
            this.add_titleformat_row(rows, '%first_played_enhanced%');
            this.add_titleformat_row(rows, '%last_played_enhanced%');
            this.add_card('ENHANCED LAST.FM', rows, 'enhanced_lastfm');
        }

        this.clamp_scroll();
    };

    this.card_height = function (card) {
        var compact = card.layout == 'stats_left' || card.layout == 'stats_right';
        var enhanced_lastfm = card.layout == 'enhanced_lastfm';
        var header_h = _scale(this.owner.font_size + (compact ? 8 : 10));
        var row_h = enhanced_lastfm ?
            _scale(this.owner.font_size * 3 + 12) :
            _scale(this.owner.font_size + (compact ? 5 : 7));

        if (enhanced_lastfm && this.owner.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED) {
            return header_h + _scale(7);
        }

        return header_h + card.rows.length * row_h + _scale(compact ? 6 : 7);
    };

    this.draw_box = function (gr, x, y, w, h, alternate, hovered) {
        if (w <= 0 || h <= 0) return;

        this.owner.ui.card(gr, RivageUI.rect(x, y, w, h), {
            fill: hovered ? this.owner.theme.cardHover :
                (alternate ? this.owner.theme.chip : this.owner.theme.card),
            stroke: this.owner.theme.stroke,
            border: true,
            accent: true,
            accentColour: this.owner.theme.accent
        });
    };

    this.draw_rating = function (gr, rating, x, y, w, h, hovered) {
        var count = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        var cell_w = Math.max(_scale(14), Math.min(_scale(20), Math.floor(w / 5)));
        var total_w = Math.min(w, cell_w * 5);
        var i;
        var glyph;
        var colour;

        for (i = 0; i < 5; i++) {
            glyph = i < count ? RivageUI.icons.starFill : RivageUI.icons.starOutline;
            colour = i < count ? this.owner.colours.accent :
                (hovered ? this.owner.colours.accent : this.owner.colours.muted);

            draw_text(gr,
                glyph,
                this.owner.fonts.rating,
                colour,
                x + i * cell_w,
                y,
                Math.min(cell_w, Math.max(0, total_w - i * cell_w)),
                h,
                DWRITE_TEXT_ALIGNMENT_CENTER,
                DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
                DWRITE_WORD_WRAPPING_NO_WRAP
            );
        }
    };

    this.draw_card = function (gr, card, x, y, w, h, alternate, card_index) {
        var compact = card.layout == 'stats_left' || card.layout == 'stats_right';
        var enhanced_lastfm = card.layout == 'enhanced_lastfm';
        var padding = _scale(compact ? 8 : 10);
        var header_h = _scale(this.owner.font_size + (compact ? 8 : 10));
        var row_h = enhanced_lastfm ?
            _scale(this.owner.font_size * 3 + 12) :
            _scale(this.owner.font_size + (compact ? 5 : 7));
        var label_h = enhanced_lastfm ? _scale(this.owner.font_size + 5) : row_h;
        var label_w = compact ?
            Math.max(_scale(72), Math.min(Math.floor(w * 0.48), _scale(122))) :
            Math.max(_scale(88), Math.min(Math.floor(w * 0.45), _scale(150)));
        var value_x = x + padding + label_w;
        var value_w = Math.max(0, w - padding * 2 - label_w);
        var i;
        var row_y;
        var row;
        var hovered;
        var hovered_card = this.hover_hit && this.hover_hit.card_index == card_index;
        var label_colour;
        var value_colour;
        var title = enhanced_lastfm ?
            (this.owner.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED ? '\u25B8 ' : '\u25BE ') + card.title :
            card.title;

        this.draw_box(gr, x, y, w, h, alternate, hovered_card);

        draw_text(gr, 
            title,
            this.owner.fonts.section,
            this.owner.colours.accent,
            x + padding,
            y + _scale(4),
            w - padding * 2,
            header_h - _scale(4),
            DWRITE_TEXT_ALIGNMENT_LEADING,
            DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
            DWRITE_WORD_WRAPPING_NO_WRAP
        );

        if (enhanced_lastfm) {
            this.hit_rows.push({
                x: x,
                y: y,
                w: Math.max(0, w),
                h: header_h,
                text: this.owner.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED ?
                    'Expand Enhanced Last.fm' : 'Collapse Enhanced Last.fm',
                action: {type: 'toggle_enhanced_lastfm'},
                card_index: card_index,
                row_index: -1
            });

            if (this.owner.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED) return;
        }

        for (i = 0; i < card.rows.length; i++) {
            row = card.rows[i];
            row_y = y + header_h + i * row_h;

            if (row_y + row_h < 0 || row_y > this.owner.h) continue;

            hovered = this.hover_hit &&
                this.hover_hit.card_index == card_index &&
                this.hover_hit.row_index == i;

            label_colour = hovered ? this.owner.colours.accent : this.owner.colours.muted;
            value_colour = hovered ? this.owner.colours.accent : this.owner.colours.text;

            if (enhanced_lastfm) {
                // The exact title-format token gets its own line, leaving the
                // full card width available for long timestamp arrays below.
                draw_text(gr,
                    row.name,
                    this.owner.fonts.small,
                    label_colour,
                    x + padding,
                    row_y,
                    Math.max(0, w - padding * 2),
                    label_h,
                    DWRITE_TEXT_ALIGNMENT_LEADING,
                    DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
                    DWRITE_WORD_WRAPPING_NO_WRAP
                );

                draw_text(gr,
                    row.value,
                    this.owner.fonts.value,
                    value_colour,
                    x + padding,
                    row_y + label_h,
                    Math.max(0, w - padding * 2),
                    Math.max(0, row_h - label_h - _scale(2)),
                    DWRITE_TEXT_ALIGNMENT_LEADING,
                    DWRITE_PARAGRAPH_ALIGNMENT_NEAR,
                    DWRITE_WORD_WRAPPING_WRAP
                );
            } else {
                draw_text(gr, 
                    row.name,
                    this.owner.fonts.small,
                    label_colour,
                    x + padding,
                    row_y,
                    label_w - _scale(6),
                    row_h,
                    DWRITE_TEXT_ALIGNMENT_LEADING,
                    DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
                    DWRITE_WORD_WRAPPING_NO_WRAP
                );

                if (typeof row.rating == 'number') {
                    this.draw_rating(gr, row.rating, value_x, row_y, value_w, row_h, hovered);
                } else {
                    draw_text(gr, 
                        row.value,
                        this.owner.fonts.value,
                        value_colour,
                        value_x,
                        row_y,
                        value_w,
                        row_h,
                        DWRITE_TEXT_ALIGNMENT_LEADING,
                        DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
                        DWRITE_WORD_WRAPPING_NO_WRAP
                    );
                }
            }

            this.hit_rows.push({
                // Use the full card width so edge padding does not repeatedly
                // switch the row between hovered and non-hovered states.
                x: x,
                y: row_y,
                w: Math.max(0, w),
                h: row_h,
                text: row.name + ': ' + row.value,
                action: row.action,
                card_index: card_index,
                row_index: i
            });
        }
    };

    this.layout = function (content_w, margin, gap) {
        var positions = [];
        var full_cards = [];
        var trailing_cards = [];
        var left_stats = -1;
        var right_stats = -1;
        var current_y = margin;
        var card_w;
        var left_h;
        var right_h;
        var row_h;
        var i;
        var card_index;
        var h;

        for (i = 0; i < this.cards.length; i++) {
            if (this.cards[i].layout == 'stats_left') {
                left_stats = i;
            } else if (this.cards[i].layout == 'stats_right') {
                right_stats = i;
            } else if (this.cards[i].layout == 'enhanced_lastfm') {
                trailing_cards.push(i);
            } else {
                full_cards.push(i);
            }
        }

        for (i = 0; i < full_cards.length; i++) {
            card_index = full_cards[i];
            h = this.card_height(this.cards[card_index]);
            positions.push({
                card_index: card_index,
                x: margin,
                y: current_y,
                w: content_w,
                h: h,
                alternate: card_index % 2 == 1
            });
            current_y += h + gap;
        }

        if (left_stats >= 0 || right_stats >= 0) {
            card_w = Math.floor((content_w - gap) / 2);
            left_h = left_stats >= 0 ? this.card_height(this.cards[left_stats]) : 0;
            right_h = right_stats >= 0 ? this.card_height(this.cards[right_stats]) : 0;
            row_h = Math.max(left_h, right_h);

            if (left_stats >= 0) {
                positions.push({
                    card_index: left_stats,
                    x: margin,
                    y: current_y,
                    w: card_w,
                    h: row_h,
                    alternate: left_stats % 2 == 1
                });
            }

            if (right_stats >= 0) {
                positions.push({
                    card_index: right_stats,
                    x: margin + card_w + gap,
                    y: current_y,
                    w: content_w - card_w - gap,
                    h: row_h,
                    alternate: right_stats % 2 == 1
                });
            }

            current_y += row_h + gap;
        }

        for (i = 0; i < trailing_cards.length; i++) {
            card_index = trailing_cards[i];
            h = this.card_height(this.cards[card_index]);
            positions.push({
                card_index: card_index,
                x: margin,
                y: current_y,
                w: content_w,
                h: h,
                alternate: card_index % 2 == 1
            });
            current_y += h + gap;
        }

        this.content_height = (full_cards.length || trailing_cards.length || left_stats >= 0 || right_stats >= 0) ? current_y - gap + margin : 0;
        this.max_scroll = Math.max(0, this.content_height - this.owner.h);
        this.clamp_scroll();

        return positions;
    };

    this.clamp_scroll = function () {
        if (this.scroll_offset < 0) this.scroll_offset = 0;
        if (this.scroll_offset > this.max_scroll) this.scroll_offset = this.max_scroll;
    };

    this.paint_empty = function (gr) {
        var margin = _scale(8);
        var h = _scale(64);
        var y = Math.max(margin, Math.floor((this.owner.h - h) / 2));

        this.draw_box(gr, margin, y, Math.max(0, this.owner.w - margin * 2), h, false, false);
        draw_text(gr, 
            'No track selected',
            this.owner.fonts.value,
            this.owner.colours.muted,
            margin + _scale(12),
            y,
            Math.max(0, this.owner.w - margin * 2 - _scale(24)),
            h,
            DWRITE_TEXT_ALIGNMENT_CENTER,
            DWRITE_PARAGRAPH_ALIGNMENT_CENTER,
            DWRITE_WORD_WRAPPING_NO_WRAP
        );
    };

    this.paint = function (gr) {
        var margin = _scale(8);
        var gap = _scale(8);
        var content_w = Math.max(0, this.owner.w - margin * 2);
        var positions;
        var i;
        var position;
        var draw_y;

        this.hit_rows = [];

        if (!this.owner.metadb) {
            this.content_height = 0;
            this.max_scroll = 0;
            this.scroll_offset = 0;
            this.paint_empty(gr);
            return;
        }

        if (!this.cards.length) {
            this.paint_empty(gr);
            return;
        }

        positions = this.layout(content_w, margin, gap);

        for (i = 0; i < positions.length; i++) {
            position = positions[i];
            draw_y = position.y - this.scroll_offset;

            if (draw_y + position.h < 0 || draw_y > this.owner.h) continue;

            this.draw_card(
                gr,
                this.cards[position.card_index],
                position.x,
                draw_y,
                position.w,
                position.h,
                position.alternate,
                position.card_index
            );
        }

        this.owner.ui.scrollbar(gr, {
            x: this.owner.w - _scale(5),
            y: margin,
            height: Math.max(1, this.owner.h - margin * 2),
            contentHeight: this.content_height,
            viewportHeight: this.owner.h,
            scroll: this.scroll_offset
        });
    };

    this.find_hit = function (x, y) {
        var i;
        var hit;

        for (i = 0; i < this.hit_rows.length; i++) {
            hit = this.hit_rows[i];
            if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
                return hit;
            }
        }

        return null;
    };

    this.move = function (x, y) {
        var hit = this.find_hit(x, y);
        var old_card = this.hover_hit ? this.hover_hit.card_index : -1;
        var old_row = this.hover_hit ? this.hover_hit.row_index : -1;
        var new_card = hit ? hit.card_index : -1;
        var new_row = hit ? hit.row_index : -1;
        var changed = old_card != new_card || old_row != new_row;

        this.hover_hit = hit;
        window.SetCursor(hit && hit.action ? IDC_HAND : IDC_ARROW);

        if (changed) {
            visibility.repaint();
        }
    };

    this.leave = function () {
        if (!this.hover_hit) return;

        this.hover_hit = null;
        window.SetCursor(IDC_ARROW);
        visibility.repaint();
    };

    this.create_autoplaylist = function (action) {
        var terms = [];
        var i;
        var query;
        var name;
        var index;

        if (!action || !action.values || !action.values.length) return;

        for (i = 0; i < action.values.length; i++) {
            terms.push(action.field + ' IS ' + format_query_value(action.values[i]));
        }

        query = terms.length > 1 ? '(' + terms.join(' OR ') + ')' : terms[0];
        name = action.label + ': ' + action.values.join(', ');

        try {
            index = plman.CreateAutoPlaylist(plman.PlaylistCount, name, query);
            if (typeof index == 'number' && index >= 0) plman.ActivePlaylist = index;
        } catch (e) {
            fb.ShowPopupMessage('Could not create the autoplaylist.\n\nTechnical details:\nQuery: ' + query + '\n' + e.message, RivageUI.copy.popupTitle('Track information'));
        }
    };

    this.lbtn_up = function (x, y) {
        var hit = this.find_hit(x, y);
        var action;

        if (!hit || !hit.action) return false;

        action = hit.action;

        if (action.type == 'toggle_enhanced_lastfm') {
            set_enhanced_lastfm_mode(this.owner.enhanced_lastfm_mode == ENHANCED_LASTFM_COLLAPSED ?
                ENHANCED_LASTFM_EXPANDED : ENHANCED_LASTFM_COLLAPSED);
        } else if (action.type == 'toggle_2003_time') {
            this.cycle_time_mode(action.field);
            request_data_update(true);
        } else if (action.type == 'autoplaylist') {
            this.create_autoplaylist(action);
        } else if (action.type == 'open_path') {
            if (utils.IsFile(action.path)) {
                reveal_in_explorer(action.path);
            } else if (/^[a-z]+:\/\//i.test(action.path)) {
                utils.Run(action.path);
            }
        }

        return true;
    };

    this.wheel = function (step) {
        var previous;

        if (this.max_scroll <= 0) return false;

        previous = this.scroll_offset;
        this.scroll_offset -= step * _scale(54);
        this.clamp_scroll();

        if (this.scroll_offset != previous) {
            this.invalidate_interactions();
            visibility.repaint();
            return true;
        }

        return false;
    };
}

function initialise_panel() {
    if (!panel) panel = new CompactPanel();
    if (!song_info) song_info = new CompactSongInfo(panel);
}

var pending_width = window.Width;
var pending_height = window.Height;
var data_refresh_timer = 0;
var data_refresh_generation = 0;
var last_data_build_time = 0;
var script_active = true;

function current_time_ms() {
    return Date.now ? Date.now() : new Date().getTime();
}

function clear_data_refresh_timer() {
    var timer = data_refresh_timer;

    data_refresh_timer = 0;
    data_refresh_generation++;
    if (!timer) return;

    try {
        window.ClearTimeout(timer);
    } catch (e) {
        // Timer may already have fired.
    }
}

function invalidate_song_info_interactions() {
    if (song_info) song_info.invalidate_interactions();
}

function queue_data_build() {
    invalidate_song_info_interactions();
    visibility.request('data');
}

function queue_focus_update() {
    invalidate_song_info_interactions();
    visibility.request('focus');
}

function request_data_update(immediate) {
    var elapsed;
    var generation;
    var wait;

    if (immediate || !panel || panel.data_refresh_interval <= 0 || !last_data_build_time) {
        clear_data_refresh_timer();
        queue_data_build();
        return;
    }

    elapsed = current_time_ms() - last_data_build_time;
    if (elapsed >= panel.data_refresh_interval) {
        clear_data_refresh_timer();
        queue_data_build();
        return;
    }

    if (data_refresh_timer) return;

    wait = Math.max(1, panel.data_refresh_interval - elapsed);
    generation = ++data_refresh_generation;
    data_refresh_timer = window.SetTimeout(function () {
        if (!script_active || generation != data_refresh_generation) return;
        data_refresh_timer = 0;
        data_refresh_generation++;
        queue_data_build();
    }, wait);
}

function set_track_context_override(value) {
    var next = TrackContext.normaliseOverride(value);

    if (!panel || panel.track_context_override == next) return;
    window.SetProperty('COMPACT.SONG.INFO.TRACK.CONTEXT.OVERRIDE', next);
    panel.track_context_override = next;
    queue_focus_update();
}

function set_font_size(value) {
    var sizes = [9, 10, 11, 12, 13];
    var size = Number(value);

    if (sizes.indexOf(size) < 0) size = 13;
    if (!panel || panel.font_size == size) return;
    window.SetProperty('COMPACT.SONG.INFO.FONT.SIZE', size);
    panel.font_size = size;
    visibility.request('font', false);
    visibility.request('size');
}

function set_accent_mode(value) {
    var mode = Number(value) == ACCENT_SHARED ? ACCENT_SHARED : ACCENT_FIXED;

    if (!panel || panel.accent_mode == mode) return;
    window.SetProperty('COMPACT.SONG.INFO.ACCENT.MODE', mode);
    panel.accent_mode = mode;
    visibility.request('accent');
    if (mode == ACCENT_SHARED) SharedAccentProtocol.requestAccent();
}

function set_data_refresh_interval(value) {
    value = Number(value);
    if (DATA_REFRESH_INTERVALS.indexOf(value) < 0) value = DEFAULT_DATA_REFRESH_MS;
    if (!panel || panel.data_refresh_interval == value) return;

    window.SetProperty('COMPACT.SONG.INFO.DATA.REFRESH.MS', value);
    panel.data_refresh_interval = value;
    clear_data_refresh_timer();
    request_data_update(true);
}

function set_enhanced_lastfm_mode(mode) {
    var previous;

    mode = Number(mode);
    if ([ENHANCED_LASTFM_HIDDEN, ENHANCED_LASTFM_COLLAPSED, ENHANCED_LASTFM_EXPANDED].indexOf(mode) < 0) {
        mode = ENHANCED_LASTFM_EXPANDED;
    }
    if (!panel || panel.enhanced_lastfm_mode == mode) return;

    previous = panel.enhanced_lastfm_mode;
    window.SetProperty('COMPACT.SONG.INFO.ENHANCED.LASTFM.MODE', mode);
    panel.enhanced_lastfm_mode = mode;
    invalidate_song_info_interactions();

    // Entering or leaving hidden mode changes which fields are built. Pure
    // collapse/expand changes only layout and therefore needs just a repaint.
    if (previous == ENHANCED_LASTFM_HIDDEN || mode == ENHANCED_LASTFM_HIDDEN) {
        request_data_update(true);
    } else {
        visibility.repaint();
    }
}

function apply_pending_update(key) {
    if (key == 'init') {
        initialise_panel();
        return;
    }

    if (!panel) return;

    switch (key) {
    case 'colours':
        panel.colours_changed();
        break;
    case 'accent':
        panel.refresh_accent();
        break;
    case 'font':
        panel.font_changed();
        break;
    case 'size':
        panel.size(pending_width, pending_height);
        break;
    case 'focus':
        if (panel.update_metadb() && song_info) song_info.request_scroll_reset();
        request_data_update(true);
        break;
    case 'data':
        clear_data_refresh_timer();
        song_info.build();
        last_data_build_time = current_time_ms();
        break;
    }
}

function request_focus_update() {
    if (panel && !TrackContext.followsSelection(panel.track_context_override)) return;
    queue_focus_update();
}

function on_colours_changed() {
    visibility.request('colours');
}

function on_font_changed() {
    visibility.request('font', false);
    visibility.request('size');
}

function on_item_focus_change(playlistIndex, from, to) {
    request_focus_update();
}

function on_selection_changed() {
    request_focus_update();
}

function on_playlist_items_selection_change() {
    request_focus_update();
}

function on_metadb_changed(handles, fromhook) {
    if (panel && !changed_handles_include_metadb(handles, panel.metadb)) return;
    request_data_update(false);
}

function on_mouse_lbtn_up(x, y, mask) {
    if (song_info && visibility.is_visible()) return song_info.lbtn_up(x, y);
    return false;
}

function on_mouse_leave() {
    if (song_info) song_info.leave();
}

function on_mouse_move(x, y, mask) {
    if (song_info && visibility.is_visible()) song_info.move(x, y);
}

function on_mouse_rbtn_up(x, y, mask) {
    // Shift+right-click leaves JSplitter's own context menu available.
    if ((mask & MK_SHIFT) != 0) return false;
    if (!panel || !visibility.is_visible()) return false;
    return panel.rbtn_up(x, y);
}

function on_mouse_wheel(step) {
    if (song_info && visibility.is_visible()) return song_info.wheel(step);
    return false;
}

var SETTINGS_PANEL_ID = 'trackinfo';
var SETTINGS_PANEL_LABEL = 'Track information';

function getMySettings() {
    initialise_panel();
    return [
        { id: 'trackSourceOverride', label: 'Track source', type: 'choice',
          value: panel.track_context_override, choiceValueType: 'string', choices: TrackContext.getOverrideChoices()
        },
        { id: 'fontSize', label: 'Font size', type: 'choice',
          value: panel.font_size,
          choiceValueType: 'number',
          choices: [
              { value: 9, label: '9 pt' },
              { value: 10, label: '10 pt' },
              { value: 11, label: '11 pt' },
              { value: 12, label: '12 pt' },
              { value: 13, label: '13 pt' }
          ]
        },
        { id: 'refreshInterval', label: 'Refresh interval', type: 'choice',
          value: panel.data_refresh_interval,
          choiceValueType: 'number',
          choices: [
              { value: 0, label: 'Immediate' },
              { value: 5000, label: 'Every 5 seconds' },
              { value: 15000, label: 'Every 15 seconds' },
              { value: 30000, label: 'Every 30 seconds' },
              { value: 60000, label: 'Every 60 seconds' }
          ]
        },
        { id: 'enhancedLastfm', label: 'Last.fm details', type: 'choice',
          value: panel.enhanced_lastfm_mode === ENHANCED_LASTFM_HIDDEN ? 'hidden' :
              (panel.enhanced_lastfm_mode === ENHANCED_LASTFM_COLLAPSED ? 'collapsed' : 'expanded'),
          choiceValueType: 'string',
          choices: [
              { value: 'expanded', label: 'Expanded' },
              { value: 'collapsed', label: 'Collapsed' },
              { value: 'hidden', label: 'Hidden' }
          ]
        },
        { id: 'accentMode', label: 'Accent colour', type: 'choice',
          value: panel.accent_mode === ACCENT_FIXED ? 'fixed' : 'shared',
          choiceValueType: 'string',
          choices: [
              { value: 'fixed', label: RivageUI.copy.labels.rvgBlue },
              { value: 'shared', label: RivageUI.copy.labels.sharedAccent }
          ]
        }
    ];
}

function applyMySetting(settingId, value) {
    initialise_panel();

    if (settingId === 'trackSourceOverride') {
        set_track_context_override(value);
        return;
    }
    if (settingId === 'fontSize') {
        set_font_size(value);
        return;
    }
    if (settingId === 'refreshInterval') {
        set_data_refresh_interval(value);
        return;
    }
    if (settingId === 'enhancedLastfm') {
        set_enhanced_lastfm_mode(value === 'hidden' ? ENHANCED_LASTFM_HIDDEN :
            (value === 'collapsed' ? ENHANCED_LASTFM_COLLAPSED : ENHANCED_LASTFM_EXPANDED));
        return;
    }
    if (settingId === 'accentMode') {
        set_accent_mode(value === 'shared' ? ACCENT_SHARED : ACCENT_FIXED);
        return;
    }
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (SettingsRegistry.provide(name, info, SETTINGS_PANEL_ID, SETTINGS_PANEL_LABEL, getMySettings)) return;
    if (SettingsRegistry.consume(name, info, SETTINGS_PANEL_ID, applyMySetting)) return;
    // The Global-settings owner broadcasts both shared source policies.
    if (name === SettingsRegistry.VALUE_CHANGED && info && info.panelId === 'global') {
        PlaybackStatsSource.applySetting(info.settingId, info.value);
        TrackContext.applySetting(info.settingId, info.value);
        return;
    }
    if (PlaybackStatsSource.onNotifyData(name, info, false)) return;
    if (TrackContext.onNotifyData(name, info, false)) return;

    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAlbumAccent) return;
        sharedAlbumAccent = nextAccent;

        if (!panel || panel.accent_mode == ACCENT_SHARED) visibility.request('accent');
    }
}

function on_paint(gr) {
    if (!visibility.flush(apply_pending_update)) return;

    panel.paint(gr);
    song_info.paint(gr);
}

function on_playback_dynamic_info() {
    if (panel && !panel.metadb_uses_now_playing) return;
    request_data_update(false);
}

function on_playback_dynamic_info_track() {
    if (panel && !panel.metadb_uses_now_playing) return;
    request_data_update(false);
}

function on_playback_edited(metadb) {
    if (panel && metadb && panel.metadb && !same_metadb(metadb, panel.metadb)) return;
    request_data_update(false);
}

function on_playback_new_track(metadb) {
    if (panel && !TrackContext.followsPlayback(panel.track_context_override)) return;
    queue_focus_update();
}

function on_playback_stop(reason) {
    var mode;

    if (reason == PlaybackStopReason.starting_another) return;
    if (panel) {
        mode = TrackContext.effectiveMode(panel.track_context_override);
        if (mode == TrackContext.MODE_SELECTION && !TrackContext.followsPlayback(panel.track_context_override)) return;
    }
    queue_focus_update();
}

function on_playlist_switch() {
    request_focus_update();
}

function on_size(width, height) {
    pending_width = width;
    pending_height = height;

    // JSplitter repaints after resizing. Do not call Repaint from on_size.
    if (panel) panel.size(width, height);
    else visibility.request('size', false);
}

function on_script_unload() {
    script_active = false;
    clear_data_refresh_timer();
}

// Obtain the current producer colour immediately, including when this panel
// was loaded after the producer's most recent broadcast.
SharedAccentProtocol.request();

PlaybackStatsSource.onChange(function () {
    request_data_update(true);
});
// Adopt whatever another panel already has configured this session, instead
// of sitting on this instance's own possibly-stale persisted value.
PlaybackStatsSource.requestSync();
TrackContext.onChange(queue_focus_update);
TrackContext.requestSync();
