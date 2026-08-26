# RVG skin for foobar2000

![RVG for foobar2000](https://i.ibb.co/Xf2XD21K/splash.webp)

**Version 0.9.5** · **Author: RivaGe**

RVG is a UWP inspired, panel-based foobar2000 skin built for JSPlitter. It is a very distant descendant of Br3tt's [Curacao](https://www.deviantart.com/br3tt/art/Curacao-v1-0a-Released-104322264) skin I've been using since 2008. The point of it is to be extremely adaptive and customizable - you can add basically any panels and they will be picked up by the skin's panel management engine. Although I've tried to optimize it, this is not a friendly skin for weak computers.


![RVG animation](https://i.ibb.co/chYVTvfD/animation.webp)
[click for a longer gif](https://i.ibb.co/chYVTvfD/animation.webp)

## Requirements

- **foobar2000 x64** (x32 may work, I haven't tested it).
- **JSplitter 4+** ([foo_uie_jsplitter](https://github.com/dima-lur/jsplitter), 3.x versions won't work for some panels).

- **Required and recommended\* components:**

  - [foo_ui_columns](https://www.foobar2000.org/components/view/foo_ui_columns)
  - [foo_lastfm_playcount_sync*](https://marc2k3.github.io/component/lastfm-playcount-sync/)
  - [foo_enhanced_playcount*](https://www.foobar2000.org/components/view/foo_enhanced_playcount) 
  - either [foo_playcount*](https://www.foobar2000.org/components/view/foo_playcount) or [2003_playcount*](https://marc2k3.github.io/component/playcount-2003/) for playback statistics. 
  - [foo_vis_milk2*](https://www.foobar2000.org/components/view/foo_vis_milk2)
  - [foo_stop_after_queue*](https://www.foobar2000.org/components/view/foo_stop_after_queue)
  - [foo_stop_after_track*](https://www.foobar2000.org/components/view/foo_stop_after_track)
  - [foo_musicbrainz*](https://www.foobar2000.org/components/view/foo_musicbrainz)
  - [Biography by Wil-B mod by regorxxx*](https://hydrogenaudio.org/index.php/topic,112914.msg1084983.html#msg1084983) - put the package into Biography panel
  - [Library-Tree-SMP by regorxxx*](https://github.com/regorxxx/Library-Tree-SMP) - put the package into Albums and Library panels respectively
  - [ESLyric](https://github.com/ESLyric)
  - [Open Lyrics](https://www.foobar2000.org/components/view/foo_openlyrics)
  - [Spectrum Analyzer](https://www.foobar2000.org/components/view/foo_vis_spectrum_analyzer)

    \*some features or buttons won't work without recommended plugins or throw errors until installed or removed from the layout.
- **Icons:** Segoe Fluent Icons on Windows 11, with Segoe MDL2 Assets as the Windows 10 fallback
- **For Last.fm integrations:** your Last.fm API key and username, entered in RVG Settings.
- **Fonts**: You can use any, but it's built with [Kumbh Sans](https://fonts.google.com/specimen/Kumbh+Sans?preview.script=Latn) and [Reddit Sans](https://fonts.google.com/specimen/Reddit+Sans?preview.script=Latn) in mind.

## Installation

1. Close foobar2000. I recommend getting a portable test foobar2000 instance.
2. Extract the package so this folder exists: `<foobar2000 profile>\jsplitter\rivage\`.
3. Keep the folder names as they are; script includes depend on it.
4. Import Columns UI .fcl file.
5. Start foobar2000 and **right** click on the top right settings icon to open **RVG Settings**. The release row should show **RVG skin for foobar2000, Version 0.9.5, Author: RivaGe**.
6. Disable toolbars for a better look.
7. Add Last.fm credentials only if you use the Last.fm-backed panels or features.
8. You can freely copy, move, add and rename panels in Preferences > Columns UI > Layout.


## Where to configure things

Most configuration lives in the central **RVG Settings** panel. Panel right-click menus are mainly for quick actions, refresh commands, and a few panel-specific shortcuts.

### Global settings

Open **RVG Settings › Global settings** for the settings that affect several panels:

- **Global theme:** Panel defaults, Match foobar2000, RVG dark, RVG light, or one of the artwork-palette modes.
- **Shared accent:** when Global theme is **Panel defaults**, choose Artwork, RVG blue, or a custom colour.
- **Last.fm API key and username:** shared by the Last.fm and Last.fm Charts panels.
- **Playback statistics source:** `foo_playcount` fields or `Playcount 2003` fields.
- **Default track source:** choose whether panels follow Now Playing, the selected track, or a fallback between them.
- **Allow panel resizing:** enables the draggable layout dividers. Enable, resize, disable to save the positions.
- **Maintain `> History` playlist:** controls RVG's automatic play-history playlist.
- **Artwork colour extraction:** Material You palette or the legacy extractor.
- **Backup & Restore:** export/import RVG settings as JSON.

### Theme and accent switching

The **Shared accent** is the colour most panels can follow. With **Panel defaults**, you choose Artwork, RVG blue, or Custom colour yourself. Other global themes choose the effective accent automatically: **Match foobar2000** uses the host accent from Columns UI settings, **RVG dark/light** use UWP blue, and **Artwork palette** themes use artwork-derived colour.

Individual panels usually expose a simple **Accent colour/source** choice under their own RVG Settings page, commonly **Shared accent** or **RVG blue**. Some panels also offer a custom colour or the foobar2000 accent.

### APIs and online services

- **Last.fm:** enter the shared API key and username in **RVG Settings › Global settings**. The Last.fm and Last.fm Charts panels use the same credentials.
- **Lyrics:** LRCLIB is the primary online source and needs no API key. The unofficial Musixmatch source is optional and can break if its upstream behaviour changes.
- **Discography:** MusicBrainz is queried directly with caching/throttling; there is no RVG API-key field to configure.

## Panels at a glance

### Playback and navigation

- **Album artwork** — Displays front/back/disc/icon/artist artwork. Switch art type from the context menu or arrow keys; middle-click jumps between Front and Artist. Click on the art to play or pause the playback. Optional setting: optional Shared-accent border.
- **Player** — Large now-playing card with metadata, playback controls, rating, optional seekbar/volume, and utility actions. Main settings: accent, track source, icon style, seekbar/volume visibility, and font-family override.
- **Top bar** — Compact full-width header with artwork, metadata, seekbar/volume, transport, and utility controls. Main settings: which sections are visible and Shared accent vs RVG blue.
- **Playlist** — JSPlaylist-mod-based track list with grouping, columns, search, loved state, artwork backgrounds, and row-density controls. Main settings are grouped under Layout, Rows, Accent, Grouping, Columns, Fonts, Colours, and Background. 
- **Mini Player** — Shrinks the real foobar2000 window into a compact now-playing view with art, playback controls, seekbar, optional Last.fm love button and rating. Remembers position and size. Main setting: **Design** — Design 1 (small cover, one title line, centred transport, full-width seekbar) or Design 2 (full-height cover art beside stacked title, artist and love+stars lines, transport inline with a short seekbar).

  ![Mini Player](https://i.ibb.co/nqhYpb0h/miniplayer.jpg)
- **Compact Queue** — Small playback-queue editor with drag reorder, file drops, remove/clear actions, and recovery through a managed playlist.

### Listening history and metadata

- **Playback statistics** — Shows local plays, Last.fm scrobbles, first/last played, and combined history. Main settings: one/two-card layout, source, date detail, accent, and text size.
- **Playback history** — Keeps a compact visual list of recent qualified plays plus listening totals by periods. Clicking on tracks in the log jumps to the song in the playlist.
- **Playback timeline** — Plots listens for the current track over time with zoom/pan, density, markers, and summary stats. Main settings: Local vs Last.fm history, marker/density style, track source, and accent.
- **Track information** — Compact metadata/statistics info panel with toggleable blocks.

### Last.fm, lyrics, and discovery

- **Last.fm** — Statistics, tags, listeners, similar artists, charts, recent scrobbles, and album browsing. Configure credentials globally; panel settings control track source, visible sections, background artwork, and accent. Right clicking on tracks, artists or similar artists allows you to play or queue them, if they are available in your library.
- **Last.fm Charts** — Side-by-side global and personal artist charts for tracks or albums. Configure credentials globally; panel settings control chart type, period, row count, cache duration, track source, and accent. Right clicking on tracks allows you to play or queue them, if they are available in your library.
- **Lyrics** — A minimal lyrics panel with lrclib as main source. Main purpose - have a lyrics panel which will have a customizeable background color for different skin's color themes (accent, dark, light). Reads synced/plain lyrics from tags or sidecar `.lrc`, fetches missing lyrics, highlights synced lines, and can save results back. Main settings: save destination, auto-fetch, click-to-seek, lyric font/sizes, active-line accent, and optional Musixmatch source.
- **Discography + Calendar** — Uses MusicBrainz to show which releases are missing from your library (with configurable filters) and show upcoming releases for your whole library (WIP). Main settings: view mode, accent, compact rows, calendar range, release types, and cache duration. Right clicking on releases allows you to play or queue them, if they are available in your library.

### Visualisers

- **Spectrum** — Direct2D FFT visualiser with bars, ribbon, and radial views. Main settings: view, band layout, colour/accent, gradient, FFT range/response, trails, peaks, and radial/CD-art options.
- **VU meter** — RMS/peak metering in horizontal or vertical layouts. Main settings: theme/accent, orientation, meter style, scale thresholds, labels/grid/peaks, and response timing. 

### Layout and controls

- **Settings** — Central browser where RVG panels register their settings. Global settings tab also contains Backup & Restore.
- **Custom buttons** — Build strips/rails of foobar2000 or RVG actions. Main settings: buttons, layout slot, orientation/alignment, style, accent mode, and target behaviour. There are 3 built-in panels (you can delete or add even more), which can be configured to be completely independent, clone each other, or be the same in functionality but have different designs.
- **Bottom bar layout** — Hosts up to four panels, lets you drag their widths, change frame style, and save up to four layouts as presets.
- **Presets** — Four quick buttons that load the saved Bottom bar layouts.
- **Tabs** — Top and bottom tab hosts discover their child panels automatically. Shared settings control tab height, accent, and optional custom tab font.
- **Left panel layout** — Chooses the top and bottom content panes and their padding; drag the divider to change the split.

## Shared controls

### Seekbar

The shared Seekbar is used by the Player, Top bar, and Mini Player. Configure it under **RVG Settings › Seekbar**. The useful controls are track colour, thickness, handle visibility, 50% marker, end-time display, and optional font override. 50% marker is for 2003_playcount configurable playback time to consider track played (last.fm also scrobbles at 50%). Middle mouse click on the seekbar to make it act as a volume slider. Also right click on the seekbar to make it a volume bar until you release the right mouse button.

### Custom button placement

A `custom-buttons.js` instance can be used in three common places:

- **Top row:** caption it `TOP BUTTONS` and set **Layout slot = Top bar row**.
- **Left rail:** caption it `BUTTONS RAIL` and set **Layout slot = Left button rail**.
- **Bottom bar:** leave **Layout slot = No managed slot** and assign it as a Bottom bar child.

### Resizing

Enable **RVG Settings › Global settings › Allow panel resizing** to use the layout dividers. The splitters handle Top bar height, left/right width, bottom area height, and the Presets/Bottom bar split.

## Font wiring

1. **Most RVG text panels** use the foobar2000 Columns UI/Core: Default family as their host font reference.
2. **Playlist** follows the foobar2000 playlist/Common (list items) font when its custom Family field is blank.
3. **Settings** also follows Common (list items) under Columns UI.
4. **Top and bottom Tabs** use Common (labels) by default; their shared font can be overridden in RVG Settings › Tabs.
5. **Presets** use Common (labels) by default and have an optional custom button font.
6. **Shared Seekbar** uses Core: Console by default; leave its Font family blank to keep inheritance.
7. **Player and Top bar** use the host family for main text and can override that family independently; their tooltip/seekbar path still uses Core: Console.
8. **Lyrics** uses the host family unless a dedicated lyric font is selected; active/inactive lyric sizes remain panel settings.
9. **Playback statistics and Track information** use the host family with their own text-size controls; Spectrum/VU use the host family for normal labels.
10. **Playback history and Compact Queue** use native row tooltips matching their row font; a few layout-only labels still use hard-coded Segoe UI/Segoe UI Semibold.

## Optional components and first-run behaviour

- Last.fm panels show a setup/empty state until credentials are entered.
- Missing optional components only disable the features that depend on them; the rest of the layout can still run.
- Playback timeline requires **Enhanced Playback Statistics** (`foo_enhanced_playcount`) for `%played_times%` / `%lastfm_played_times%` history fields.
- Windows 10 may use Segoe MDL2 Assets instead of Segoe Fluent Icons.

## Credits

RVG builds on the work of several other authors and projects:

- **JSPlaylist** by **Br3tt (Falstaff)** — the Playlist panel and parts of the album accent engine adapt JSPlaylist / JSPlaylist Mod.
- **Google Material Color Utilities** (© Google LLC, Apache License 2.0) — adapted for artwork colour extraction in `material_colour.js`.
- **marc2003** — the Album artwork panel and part of the VU meter panel adapt marc2003's Spider Monkey Panel samples.
- **Case** — additional VU meter panel adaptation.
- **Spider Monkey Panel / JScript Panel samples** — the Top bar panel is based on a Spider Monkey Panel/JScript sample.
