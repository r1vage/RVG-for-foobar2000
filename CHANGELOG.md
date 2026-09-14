# Changelog

All notable changes to RVG (skin for foobar2000) are documented here.

## [Unreleased]

### Added

- Global theme: **Artwork Mica — blurred** — one blurred, cover-cropped derivative of the current artwork sits behind the entire skin, with the artwork-derived Material palette layered over it as translucent cards, rows, tab bars and separators. **Mica blur radius** and **Mica tint strength** are in Global settings; with no artwork it falls back to the opaque artwork palette. Each panel caches its own mapped slice of the artwork and prepares the replacement during the theme transaction, so the whole layout changes colour together on a track change rather than sweeping through it panel by panel. The README's new *Where the artwork colours come from* section explains which cover-derived colour each part of the interface uses.
- **Live shows** — new panel listing upcoming concerts for every artist in the library, grouped by month, with a place filter, a per-artist disk cache and a minimum-tracks control to bound the request count. Two selectable free sources: **Ticketmaster Discovery** (5000 calls a day, publishes MusicBrainz IDs so an artist match can be confirmed) and **SeatGeek** (name matching only, heavily US-weighted). (`live_shows_panel.js`)
- **MusicBrainz tagger** — new panel that tags the tracks you have selected in a playlist from a MusicBrainz release. It searches by the album and artist already on the files, editable in a popup by right-clicking Search (or loads the release ID straight from `MUSICBRAINZ_ALBUMID`, or one you paste), ranks the candidates by how close their track count is to the selection, and then shows the pairing file-by-file next to a field list where every row says what would change and on how many tracks. Nothing is written until you tick fields and confirm: an empty MusicBrainz value never clears an existing tag, per-track fields are withheld entirely when the track counts differ, and the previous values are kept in memory so the whole write can be undone from the right-click menu. Six fields have two spellings in the wild - album artist, the two sort-order fields, original release date, label and media - and foobar2000's own ID3v2 table maps its names (`ORIGINAL RELEASE DATE`, `ALBUM ARTIST`, `PUBLISHER`, `MEDIA TYPE`, `ALBUMARTISTSORTORDER`, `ARTISTSORTORDER`) to real frames while Picard's spellings of the same fields go to `TXXX`. A name the file already carries is always reused, so a file never ends up holding the same value twice; for a name it has never had, **Tag name style** decides - *Match the file* (default) picks foobar2000's names on ID3 files and Picard's everywhere else, or you can force either. The review screen prints the name each of those six fields will actually be written under. **Date format** writes Date either as MusicBrainz has it or as the year alone; Original release date is always written in full. Requests are strictly serial at one a second with an identifying User-Agent, as MusicBrainz requires, and full release lookups are cached on disk for 30 days. (`musicbrainz_tagger.js`)
- Discography: **Calendar: also query artists without MusicBrainz IDs** — name-based upcoming-release query for library artists whose tags have no MusicBrainz artist ID.
- Playlist: **Group header style** — Classic (the existing look) or **Inset card** (now the default): a rounded glass pane stepped in from the row edge, with a bright top-edge highlight, a 1 px rim and an accent-coloured rule above the footer line. Its own corner radius is derived from how far the cover art sits inside the card, so no artwork-size or inner-padding setting can clip a corner, and the cover art gets matching rounded corners at a radius you set (**Artwork corner radius**, 0–16). A **Header uses album accent** switch makes the header colour-neutral — glassier still — without changing the accent anywhere else in the panel. Picking Inset card also rounds the track rows to match — selection, now-playing and alternating-row washes pull in to the card’s inset and gain the same corner treatment, and the leading accent bar becomes a capsule inside them. All of it lives in RVG Settings → Playlist → Grouping; fields, header height, group heights and row alignment are identical in both styles. (`vendor/jsplaylist-mod` v2.12.0)
- Global settings: **UI scale** — follow the Windows DPI setting (unchanged default), ignore it so every panel lays out at 100%, or force a custom 50-300% scale. The choice is stored in `rivage\\config\\ui_scale.json` and read by every panel at startup, so it applies after foobar2000 is restarted. (`shared/ui_scale.js`, and every script that scaled from `window.DPI`)
- Global settings: **Preset buttons side** — the four preset buttons can sit at the right end of the bottom bar instead of the left, keeping exactly the width they already have. The same choice is on the preset buttons' own right-click menu, next to **Mirror selection bar when on the right**, which moves the selected preset's accent bar to the edge facing the bottom bar. (`shared/presets_side_protocol.js`, `tab-switcher-right.js`, `splitters/bottom_horizontal_splitter.js`, `presets_panel.js`)
- Bottom bar: new **Mica line** panel style — instead of a box per panel, one hairline runs the whole width of the bar's top edge, the way the tab bar draws its own, with a matching divider dropped down each gap between panels. It is a single device pixel rather than a DPI-scaled one, drawn on the aliased path (antialiasing spreads a 1 px hairline over two half-strength rows, which is why the tab bar's own separator looks crisper than a smoothed one), and it fades out over the last ~14% at each end, while the gap dividers taper over ~45% at each end so they read as a soft edge rather than a tick, using the same nine-stop smoothstep the spectrum ribbon's edge fade uses — one gradient call per end, rebuilt only when the colour changes. It takes the tab bar's `navigationSeparator` colour, so both edges of the layout read as one system, and the panels themselves keep the bare backdrop. Corner radius is hidden for it, as it is for **No frame**. (`bottom_bar_host.js`)
- Playback timeline: **Range starts at** — First listen (unchanged default) or **Date added**, so the axis opens at the moment the track entered the library and the gap before the first listen is visible instead of cropped. The added date is taken from the first field that actually holds one: the global playback statistics source's field first (`%2003_added%` under Playcount 2003, otherwise `%added%`), then the other local field, then Enhanced Playback Statistics' `%lastfm_added%`, then the first listen. The stats-source setting only decides *precedence* — a library running just one of the two components leaves the other's field as `?`, and that must not decide the answer. `%lastfm_added%` is deliberately last: Enhanced Playback Statistics reports the first scrobble there, so it lands on or after the first listen and would make the mode a no-op. Wide panels gain an **ADDED** cell in the summary card; an added date later than the first listen (imported scrobbles predating the local stamp) is clamped so no listen falls outside the range. (`playback-timeline_panel.js` v2.5.1)
- Playlist: middle-clicking a group header queues the whole group, or removes it from the queue when every track is already queued. (`vendor/jsplaylist-mod` v2.13.0)
- Mini Player: **Design** choice — Design 1 (the existing stack) or Design 2 (full-height cover art beside stacked title, artist and love+stars lines, with the transport inline with a short seekbar).
- Player: **Warn when the track has no ReplayGain** — on by default, switches the missing-ReplayGain warning off for anyone who does not scan their library. (`controls_panel.js` v4.4.0)

### Changed

- Global settings: a fresh install now starts on **Artwork Mica — blurred** with a blur radius of 60 and a tint strength of 68, instead of **Panel defaults** with 48/72. (`tab-switcher-right.js`)
- Playlist: the group-header defaults now match the shipped look — **Inset card** style (was Classic), **Header uses album accent** off (was on) and a footer line alpha of 120 (was 140). (`vendor/jsplaylist-mod` v2.12.0)
- Discography: the Calendar now queries MusicBrainz per library artist instead of downloading every upcoming release worldwide — no 10,000-row relevance cap and no `status:official` clause hiding unreleased albums. Results are cached per artist group and month-anchored, so an interrupted run is no longer discarded and the panel no longer re-fetches for ~2 minutes on every activation. The MusicBrainz cache duration also now defaults to 30 days (was 1). (`discography_and_calendar.js`)
- Last.fm: the Explorer lists (Charts, Albums, Recent, Weekly) now scroll freely instead of jumping a whole row at a time. (`lastfm_panel.js`)
- Discography and RVG Settings: scrolled content is clipped to its own viewport instead of being hidden by opaque strips repainted over the header, sub-tab bar and sidebar footer every frame.
- Player: the missing-ReplayGain warning is now a labelled **No ReplayGain** badge centred above the track title — a warning glyph and text in a capsule tinted with the warning colour — instead of the unlabelled red stripe down the panel's left edge, which said nothing about what it meant. Hovering it explains that the track plays at its raw volume and where to scan it. (`controls_panel.js` v4.4.0)
- Seekbar: elapsed/total labels now tuck against the ends of the track instead of sitting out at the strip's edges — Top bar, Player, and both Mini Player designs.
- Custom Buttons: the built-in "Search MusicBrainz.org" action (the Tagging button's default middle-click) now searches by artist + album instead of artist + title.
- Marquee: half the memory per scrolling label, with pixel-identical output (Top bar, Player, Mini Player, Playback Timeline).
- Repo: the nine files added or heavily extended since the 2026-08-25 audit queue closed (Artwork Mica, Live shows, UI scale, the Mica-line bottom bar, Mini Player Design 2 and the pseudo-transparency chain) were brought in line with `SCRIPT_AUDIT_PLAN.md` §3: 827 → 602 standalone comment lines, 29 decorative section banners removed, five invariants that had each been written out three or four times reduced to one statement plus pointers, and the long architecture headers replaced by pointers to README. Comments only — every file's non-comment diff is identical apart from its version string. Recorded in `SCRIPT_AUDIT_PLAN.md` §7.
- Repo: added a `.gitignore` for the runtime cache and a `.gitattributes` that disables git's end-of-line normalisation, since this tree deliberately mixes CRLF and BOMs per file and normalising either turns menu labels into mojibake.

### Fixed

- Shared painter: a bordered full-capsule pill threw `DrawRoundRect failed: Arc argument has invalid value` and left the panel unpainted. The border is drawn 1 px inside the rectangle it is given, but its corner radius was still clamped against the full rectangle, so a capsule (radius = half the height) asked GDI+ for an arc wider than the box it had to fit. The radius is now clamped against the inset rectangle actually drawn. (`shared/design_system.js` v1.8.2)
- Bottom bar: under **Panel defaults** the bar painted its gaps and outer padding from the RVG dark palette while the panels sitting in them follow foobar2000's own colours, so every gap read as a dark groove - doubling each separator in the **Mica line** style, where the hairline is meant to be the only thing between two panels. The host now resolves its background from the foobar2000 colours in that mode, as the splitters already do, so the gaps disappear into the panels and only the hairline separates them; the artwork palette and Mica modes are unchanged, since they already override the mode. (`bottom_bar_host.js` v2.8.5)
- Bottom bar: the panel frames were drawn with a 1 px pen centred on the frame edge, so the hairline smeared across two pixels at half strength and half of it bled into the gap between panels, and the rounded corners were cut square by the child panel's window sitting 1 px inside the frame. The rim is now pixel-snapped and each child is inset far enough to clear the corner arc, so the corners actually read as corners. In **Artwork Mica** the rim is the palette text colour at low alpha — the same rim the playlist's inset card uses — so it holds its weight over a dark cover instead of glowing on one and disappearing on a pale one. (`bottom_bar_host.js`)
- Playlist: it repainted up to 40 ms after every other panel whenever the artwork palette changed, because the bundled repaint helper defers behind a timer; it now invalidates from the same commit edge as the rest of the layout, so the whole skin changes colour in one step. (`playlist_panel.js`)
- Artwork palette themes + third-party Columns UI panels (ESLyric, ReFacets and the like) under **Extra**: they stayed on the Columns UI background colour instead of the artwork-derived one. Such a panel does not read its parent's pixels — it asks the parent chain to render a background into its own device context, and that path picks up an image but not a solid fill. The palette modes now deliver their colour as a bitmap, exactly as Mica delivers artwork, and every link of the pseudo-transparent chain is refreshed on a palette change rather than only the last one. A host also paints its full backing surface only when a child actually running a foreign component can sample it - JSplitter sets the pseudo-transparency flag on every panel, so the old test was true everywhere and had the four splitters each painting a full-window surface their own children completely cover. (`shared/mica_backdrop.js`, `tab-switcher-right.js`, `extra-tab-parent.js`, `splitters/*.js`)
- Track-change flicker in the artwork-derived themes: the palette now changes in one synchronized commit across every panel, replacing the independent per-panel timers that made the new colours visibly ripple through the layout.
- Custom Buttons: the MusicBrainz Tags button's default right-click ("by MB album ID") referenced a command that was never defined, so it silently did nothing; button configurations already saved with the empty command are repaired on load. (`custom-buttons.js`)
- Menu text encoding: the ellipsis in "Custom colour...", "Rename panel..." and "Choose tab bar font..." rendered as mojibake in the Spectrum and Extra tabs right-click menus.
- Discography: playing a track could throw `FillRoundRect failed: Arc argument has invalid value` and leave the Releases list unpainted. The panel's own rounded-rectangle helper scaled the box and its corner radius separately, and the panel's scale factor comes from the host font size, so at 16-18 pt rounding left the radius wider than half the box and GDI+ rejected the arc. The radius is now clamped to the box, as the shared painter already does. (`discography_and_calendar.js` v3.1.2)

## [0.9.5] - 2026-08-23

### Added

- RVG Settings: **Backup & Restore** — Export/Import every loaded panel's settings to/from a JSON file. (`settings_panel.js`)
- Mini Player: new compact view that shrinks the actual foobar2000 window (album art, transport, seekbar, Last.fm love, rating stars); restore-on-exit switches for always-on-top and window-size lock. (`miniplayer_panel.js`, `shared/miniplayer_protocol.js`, `splitters/root_splitter.js`, `tab-switcher-right.js`, `custom-buttons.js`)
- Playback Timeline: **Density style** (Area / Bars) and listen-rug style (Off / Ticks / Dots / Heat strip). (`playback-timeline_panel.js` v2.4.0)
- Custom Buttons: MusicBrainz Tags button gained right/middle-click actions; Select All button gained a right-click Properties action. (`custom-buttons.js`)
- Playback History: right-click "Reset listening stats..." clears the daily ledger and all-time total in one step, with confirmation. (`playback_history_panel.js` v6.4.0)

### Changed


- Discography header restyled to match the floating-card look used by Playback timeline / Playback history. (`discography_and_calendar.js` v2.12.0)
- Tone-of-voice audit : unified copy for accents, themes, track sources, panel names, empty states and prompts across the suite; several settings restructured; README updated to match.

### Fixed

- Discography: Redacted/Orpheus search now includes the artist, not just the album title. (`discography_and_calendar.js` v2.12.1)
- Last.fm Charts: on-disk cache now stores only the fields actually used, cutting file size. (v1.11.0)
- Playback Statistics: stopped re-evaluating stats while hidden behind an inactive tab. (v2.12.0)

## [0.9.0] - 2026-08-20

First version-tracked build (`RVG_RELEASE` in `shared/design_system.js`).

### Added

- Custom Buttons and Playback Timeline panels (new).
- Seekbar combined seek/volume mode (Top Bar, Controls).
- Global accent mode: 3-way choice (album art / default / custom).
- Last.fm Charts local "All time" mode, built from the local play-count tag.
- Custom Buttons: default Preferences and ReplayGain buttons.
- Queue Manager: single shared, deletable recovery playlist with an on/off toggle.
- Album Art: `noartist.webp` placeholder; placeholder art is click-to-play/pause.

### Changed

- Last.fm credentials centralized in Global settings, shared by both Last.fm panels.
- jsplaylist-mod: `F2` renames the active playlist (moved off `F4`); `F4` always reapplies the active group sort.
- Lyrics panel converted to Direct2D rendering; gained a Musixmatch fallback.

### Fixed

- Spectrum bar animation stutter.
- Middle splitter: proportional resize, a padding regression, and custom sizing not persisting.
- Album accent engine: refactoring.
- Seekbar: fixed a settings-consumer feedback loop.
- Top bar album art cache fix.
