# Changelog

All notable changes to RVG (skin for foobar2000) are documented here.

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
