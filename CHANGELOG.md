# Changelog

All notable changes to RVG (skin for foobar2000) are documented here.

## [Unreleased]

### Added

- **Rewind** — your year in music, any time you want it. Top artists, albums, tracks and genres for the last 12 months, any month, any year or all time, with ▲▼ changes against the period before, listening time, streaks, a plays-per-month trend and when you listen by weekday and hour. Switch to a **Heatmap** of every day you listened, or to **Current artist** for your history with whoever is playing. **Comebacks** lists the albums you returned to after a year or more away. Covers and artist pictures sit beside every entry, and long periods start at your first listen instead of rows of empty years. Click an artist to dig in; click anything else to select it in your playlist; right-click to play. **Save as image** (right-click) makes a 1080×1350 PNG card of the period to share. Works from your Last.fm scrobbles or local plays, keeps itself up to date as you listen, and stays smooth even on huge libraries. (`listening_rewind_panel.js` v1.4.0, `shared/listening_history_index.js` v0.5.0)
- **Rediscover** — the albums (or tracks) you loved and then forgot: played a lot or rated highly, but not for months. Covers, play counts and how long it has been, with a "why this?" tooltip. **Play a mix** shuffles 25 of them into a playlist, also from the Quick switcher (*Rediscover: play forgotten favourites*). Right-click anything you don't want suggested again. (`rediscover_panel.js` v1.0.3, `shared/rediscover_score.js`, `shared/playback_stats_source.js`, `bottom-panel_playcount.js` v2.13.1, `quick_switcher_panel.js` v1.8.0)
- **Quick switcher** — press a shortcut and start typing: artists, albums, tracks, playlists and commands appear as you type, ignoring case and accents. Play, queue, play next or add to a playlist without reaching for the mouse. Bind a shortcut as the README describes. (`quick_switcher_panel.js` v1.7.0, `shared/quick_switcher_protocol.js`, `splitters/root_splitter.js` v1.10.0, `custom-buttons.js` v2.16.0)
- **Artwork Mica** — the current cover, softly blurred, behind the entire skin, with translucent panels layered over it. The whole layout recolours in one smooth step on every track change. Optional **Acrylic noise** adds the fine grain of Windows acrylic. (`shared/mica_backdrop.js` v1.20.0, `shared/mica_derivative.js`, `tab-switcher-right.js` v6.6.0)
- **Live shows** — upcoming concerts for every artist in your library, grouped by month and filtered to where you live, with each artist confirmed by MusicBrainz ID so a same-named band never sneaks in. Powered by Ticketmaster. (`live_shows_panel.js` v2.4.0)
- **MusicBrainz tagger** — tag the selected tracks from a MusicBrainz release with a full preview: every field's current and new value side by side, you pick what gets written, and one click undoes it. Never clears a tag or writes blind. (`musicbrainz_tagger.js` v1.4.0)
- **Health check** — Global settings › Health shows every component, font and setting RVG uses, what each one is for, and a **Get** button for anything missing. Opens by itself on first start if something is. (`shared/health_checks.js`, `tab-switcher-right.js` v6.8.0, `settings_panel.js` v1.9.0)
- **Low-power mode** — one switch for laptops and older PCs: Mica becomes a plain artwork palette, visualisers and lyrics animation cap at 20 fps, and titles stop scrolling. Switch it off and everything is back as it was. (`shared/power_mode.js`, `shared/marquee_widget.js`, `tab-switcher-right.js` v6.7.0)
- **Discography**: the Calendar now shows the last three months of releases alongside upcoming ones in a single timeline, and can include artists without MusicBrainz IDs. (`discography_and_calendar.js` v3.3.0)
- **Playlist**: drag to reorder is back and instant; new **Inset card** group headers with rounded cover art; middle-click a group header to queue the whole album. (`vendor/jsplaylist-mod` v2.12.0–v2.14.0)
- **Player**: a **Next** line shows what is queued — click it to peek at and edit the queue. The No ReplayGain warning can be switched off. (`controls_panel.js` v4.7.0, `queue_manager.js` v2.15.0, `shared/queue_peek_protocol.js`)
- **Mini Player Design 2** — full-height cover art with title, artist, love button and rating beside it. (`miniplayer_panel.js`)
- **UI scale** — follow Windows DPI, ignore it, or pick any scale from 50 to 300%. (`shared/ui_scale.js`)
- **Storage** — see how much disk each panel's cache uses and clear it; **Memory use** reports what every panel holds. (`settings_panel.js` v1.8.0, `shared/cache_protocol.js`)
- **Bottom bar** gains a minimal **Mica line** style; the **preset buttons** can sit on either side. (`bottom_bar_host.js`, `shared/presets_side_protocol.js`)
- **Playback timeline** can start at the date a track was added, not just its first listen. (`playback-timeline_panel.js` v2.5.1)
- **VU meter** can be renamed in Settings, like Spectrum. (`vu_meter_panel.js` v3.1.0)

### Changed

- **Snappier track changes**: artwork colours and the Mica blur are worked out in the background (JSplitter 4.2+), and the Player, Top bar and Mini Player repaint only what changed. (`tab-switcher-right.js` v6.5.0, `shared/artwork_worker.js`, `controls_panel.js` v4.5.0, `topbar_panel.js` v3.9.0, `miniplayer_panel.js` v2.5.0)
- **Playlist**: much smoother scrolling; quick search matches words in any order, ignores accents, steps through matches with highlights and a preview; lighter cover cache. (`vendor/jsplaylist-mod` v2.16.0–v2.18.0)
- **Global settings**: theme, accent, Mica and UI scale moved to a new **Appearance** tab. (`tab-switcher-right.js` v6.9.0)
- **Defaults**: fresh installs start on Artwork Mica (blur 70, tint 62, subtle noise) and Inset card group headers. (`tab-switcher-right.js`, `vendor/jsplaylist-mod` v2.12.0)
- **Playback history** logs a track after a minute of listening (or when a shorter track finishes), not after 10 seconds. (`playback_history_panel.js` v6.6.0)
- **Discography**: the Calendar queries per artist — no more albums lost to the global result cap, interrupted refreshes resume, and the cache lasts 30 days. Your own search links replace the built-in trackers. (`discography_and_calendar.js` v3.4.0)
- **Player**: a labelled **No ReplayGain** badge replaces the unexplained red stripe; slightly roomier text. (`controls_panel.js` v4.7.0)
- **Artwork Mica**: cards in every panel are a little more see-through (66% instead of 72%), so the artwork shows behind them. (`shared/design_system.js` v1.9.1)
- **Seekbar** time labels sit against the ends of the track. (`shared/seekbar_widget.js`)
- **Spectrum** and **VU meter** now need JSplitter 4.2.1. (`shared/audio_pcm_reader.js`, `spectrum_panel.js` v2.0.0, `vu_meter_panel.js` v3.0.0)
- Smaller touches: Compact Queue shading and font size, left-side split resets on double-click, smoother Last.fm lists, MusicBrainz button searches artist + album, font dialogs stay with their panel, scrolling titles use half the memory. (`queue_manager.js` v2.15.1, `settings_host.js` v2.8.1, `lastfm_panel.js`, `custom-buttons.js`, `shared/tab_bar_style.js`, `shared/marquee_widget.js`)
- **One way to click** in Rewind, Rediscover, Playback history and the Last.fm panels: left-click opens an artist or selects the item in your playlist (Last.fm rows still open on Last.fm), middle-click queues, and right-click has the same Play / Play next / Add to playback queue / Add to playlist / Show in playlist / Search library menu everywhere. Covers in Rediscover and the Quick switcher are play buttons, and they, like the menu's Play, start in your current playlist when it has the music, so that playlist carries on; a plain click on a Quick switcher row now selects instead of playing. (`shared/library_actions_v2.js`, `listening_rewind_panel.js` v1.5.0, `rediscover_panel.js` v1.2.0, `playback_history_panel.js` v6.7.0, `lastfm_charts_panel.js` v1.13.0, `lastfm_panel.js` v2.9.0, `quick_switcher_panel.js` v1.9.0)
- **OpenLyrics** is no longer a dependency: the shipped layout uses ESLyric instead, and the Health check no longer asks for it. (`shared/health_checks.js`)
- Repo: `.gitignore` for runtime caches and `.gitattributes` that keeps each file's line endings and BOM intact.

### Fixed

- Discography, Live shows and MusicBrainz tagger: a request that never got an answer could stall the panel until restart. (`discography_and_calendar.js`, `live_shows_panel.js`, `musicbrainz_tagger.js`)
- Discography and MusicBrainz tagger together could exceed MusicBrainz's rate limit (503 errors). (`shared/musicbrainz_gate.js`)
- New colours rippled through the layout panel by panel on track change, with the Playlist lagging behind. (`shared/dynamic_theme_protocol.js`, `playlist_panel.js`)
- Artwork palette themes did not reach third-party Columns UI panels under **Extra**. (`shared/mica_backdrop.js`, `extra-tab-parent.js`, `splitters/*.js`)
- Bottom bar: dark grooves between panels under Panel defaults; blurry frame edges and clipped rounded corners. (`bottom_bar_host.js` v2.8.5)
- "Arc argument has invalid value" errors from pill borders and from Discography at large font sizes. (`shared/design_system.js` v1.8.2, `discography_and_calendar.js` v3.1.2)
- Settings: sub-tab scroll arrows drawn on solid boxes under Mica. (`settings_panel.js`)
- Custom Buttons: the MusicBrainz button's "by album ID" right-click did nothing. (`custom-buttons.js`)
- Garbled "…" in the Spectrum and Extra menus. (`spectrum_panel.js`, `extra-tab-parent.js`)

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
