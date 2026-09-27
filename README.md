# RVG skin for foobar2000

![RVG for foobar2000](https://i.ibb.co/V0LXzcSz/rvg-for-foobar2000.webp)

**Version 1.0.0** · **Author: RivaGe**

RVG is a UWP inspired, panel-based foobar2000 skin built for JSPlitter. It is a very distant descendant of Br3tt's [Curacao](https://www.deviantart.com/br3tt/art/Curacao-v1-0a-Released-104322264) skin I've been using since 2008. The point of it is to be extremely adaptive and customizable - you can add basically any panels and they will be picked up by the skin's panel management engine. Although I've tried to optimize it, this is not a friendly skin for weak computers.


![RVG animation](https://i.ibb.co/chYVTvfD/animation.webp)
[click for a longer gif](https://i.ibb.co/chYVTvfD/animation.webp)

## Requirements

- **foobar2000 x64** (x32 may work, I haven't tested it).
- **JSplitter 4.2.1 or newer** ([foo_uie_jsplitter](https://github.com/dima-lur/jsplitter)). Older builds are missing drawing functions RVG relies on, and panels will throw script errors.

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
5. Start foobar2000 and **right** click on the top right settings icon to open **RVG Settings**. The release row should show **RVG skin for foobar2000, Version 1.0.0, Author: RivaGe**.
6. Disable toolbars for a better look.
7. Add Last.fm credentials only if you use the Last.fm-backed panels or features.
8. You can freely copy, move, add and rename panels in Preferences > Columns UI > Layout.


## Where to configure things

Most configuration lives in the central **RVG Settings** panel. Panel right-click menus are mainly for quick actions, refresh commands, and a few panel-specific shortcuts.

### Global settings

Open **RVG Settings › Global settings** for the settings that affect several panels. The look of the skin — Global theme and its Mica controls, Shared accent, Artwork colour extraction and UI scale — is on the **Appearance** tab; everything else is on **General**, apart from Health, Backup & Restore and Storage:

- **Global theme:** **Artwork Mica — blurred** (the default), Accent dark, Match foobar2000, RVG dark, RVG light, or the artwork-palette modes. When Mica is selected, blur-radius, tint-strength and acrylic-noise controls appear directly below it.
- **Shared accent:** when Global theme is **Accent dark**, choose Artwork, RVG blue, or a custom colour.
- **Last.fm API key and username:** shared by the Last.fm and Last.fm Charts panels.
- **Playback statistics source:** `foo_playcount` fields or `Playcount 2003` fields.
- **Default track source:** choose whether panels follow Now Playing, the selected track, or a fallback between them.
- **Allow panel resizing:** enables the draggable layout dividers. Enable, resize, disable to save the positions.
- **Maintain `> History` playlist:** controls RVG's automatic play-history playlist.
- **Artwork colour extraction:** Material You palette or the legacy extractor.
- **UI scale:** Follow Windows DPI (default), **Ignore Windows DPI (100%)**, or a custom percentage between 50 and 300 applied to every RVG panel. Windows reports its DPI to foobar2000 only at startup, so a change here takes effect after foobar2000 is restarted. It scales panel layout and the sizes RVG derives itself; text that follows a foobar2000 host font still follows that font.
- **Health:** what RVG needs and whether it is installed — components, JSplitter version, fonts and the Last.fm account — each with what uses it and a **Get** button for anything missing. Opens by itself on the first start if something is missing; also on the Quick switcher as **Run health check**.
- **Low-power mode:** for slower machines. Artwork Mica paints as the plain artwork palette, Spectrum, VU meter and Lyrics animation are capped at 20 fps, and scrolling titles stay still. Your own settings are untouched and return when it is switched off. Also on the Quick switcher as **Toggle low-power mode**.
- **Backup & Restore:** export/import RVG settings as JSON.
- **Storage:** size of each panel's disk cache, with a Clear button per cache.

### Theme and accent switching

The **Shared accent** is the colour most panels can follow. With **Accent dark**, you choose Artwork, RVG blue, or Custom colour yourself. Other global themes choose the effective accent automatically: **Match foobar2000** uses the host accent from Columns UI settings, **RVG dark/light** use UWP blue, and the artwork-derived themes use the current cover palette.

**Artwork Mica — blurred** keeps that artwork-derived palette but also places one blurred, cover-cropped derivative of the current artwork behind the entire RVG skin, with semi-transparent cards and navigation surfaces layered over it. **Mica blur radius** controls how soft the artwork becomes; **Mica tint strength** controls how much of the semantic background colour is mixed over the blur for readability. **Acrylic noise** (Off / Subtle / Medium / Strong) adds a fine grain over the blur, as Windows acrylic does, which hides the colour banding dark covers can show. If no artwork is available, RVG falls back to the same opaque artwork-palette background instead of leaving a transparent or broken surface. The mapped backdrop is re-anchored after Mini Player enter/exit, so returning to the full layout should restore the same continuous root composition rather than keeping coordinates from the compact window.

For the three **Artwork palette** global themes, splitter/tab hosts paint the same artwork-derived semantic background across their complete backing surface. Third-party components that you have already configured for JSplitter pseudo-transparency can therefore reveal the Artwork palette just as they do under Mica. The nested **Extra** tab host needs one additional bridge because it is itself a JSplitter child: Bottom Tabs enables pseudo-transparency on the Extra host wrapper once during normal host setup, while `extra-tab-parent.js` paints the complete backing surface for its own children. After an Artwork Palette commit, Extra also issues one **same-geometry refresh** to the currently visible direct child if that child is already pseudo-transparent, but only after the new Extra root background has been painted. This refresh does not resize/hide the child or change its pseudo-transparency setting.

The blurred derivative is generated once by the persistent Bottom Tabs controller. The outer **RVG Root Splitter** establishes the canonical cover crop, and each RVG script window discovers its absolute rectangle through a lightweight parent/child geometry protocol and draws only the corresponding source slice of that same runtime JPEG. Discovery is hierarchical and startup-order safe: if a deep panel asks before its immediate splitter has resolved, it retries at a bounded rate and the parent sends an identity-targeted wakeup as soon as its own root frame becomes valid. That makes the artwork line up across splitter and tab boundaries without depending on JSplitter pseudo-transparency or re-cover-cropping the image independently in every panel. GDI and Direct2D panels still load their own drawing object from the shared file because native bitmap objects cannot be passed through `NotifyOthers`; the expensive decode/resize/blur work remains producer-only, and on JSplitter 4.2 or newer the producer runs it, together with the palette extraction, on a background Worker (`shared/artwork_worker.js`) so a track change never stalls the interface; the first extraction at startup, and every extraction on older JSplitter builds or after a Worker failure, stays on the panel thread. Only the **current playing/focused artwork derivative** is retained at steady state. A replacement is written to a fresh handoff path; visible consumers keep drawing the previous native image until the replacement opens successfully, while hidden consumers release the old handle immediately. Every mapped panel swaps to the new image on the same commit, and the outgoing bitmap is disposed and its runtime file retired at that point. A failed/late open is retried briefly without exposing the opaque fallback. Leaving Mica retires the current derivative too. Track/artwork/tint changes are repaint-only and do not trigger child Move/Show calls or transparency toggles. While a panel is waiting for its root-relative frame, or if no artwork is available, it paints the stable opaque semantic fallback instead of guessing a local crop. The temporary handoff file lives under `jsplitter\rivage\cache\mica\` and never modifies the source artwork. Artwork-derived theme changes use a synchronized two-phase transaction: every panel first receives a state-only semantic **PREPARE**, then the compatibility album accent, then one **COMMIT** that promotes the staged palette and queues normal repaints from the same notification turn. This avoids independent per-panel zero-delay timers and prevents the colour change from visibly rippling through the layout.

Individual panels usually expose a simple **Accent colour/source** choice under their own RVG Settings page, commonly **Shared accent** or **RVG blue**. Some panels also offer a custom colour or the foobar2000 accent.

### Where the artwork colours come from

Artwork Mica and the three Artwork palette themes do not pick one accent from the cover - they build a full Material-style palette from it, which is why the interface reads as three distinct colour groups rather than one. Whether the palette is built dark or light follows foobar2000's own colours, exactly as **Artwork auto** does.

RVG first scores the cover's colours and takes up to **three well-separated hues**: a *primary*, a *secondary* and a *tertiary* seed. If the art is too monochrome to yield three, the missing ones are derived from the primary by shifting its hue, so the companions stay tied to the cover instead of falling back to grey. Every colour below is then that seed re-rendered at a fixed lightness (tone) with its chroma scaled down and capped - a low cap means "almost neutral, faintly tinted", a high cap means "keep the cover's saturation".

| What you see | Token | Built from | Chroma |
| --- | --- | --- | --- |
| Backgrounds, cards, tab bars, row hovers | `background`, `card`, `navigationSurface`, `rowHover` | **primary** seed, tones 6-22 (dark) / 90-98 (light) | x0.10, capped 7 - near-neutral |
| Titles, playlist rows, panel body text, most button labels and glyphs | `textPrimary` (`onSurface`) | **primary** seed, tone 90 / 10 | x0.10, capped 7 - near-white with a faint cover tint |
| Artist and album in the Player, subtitles, secondary captions | `textSecondary` (`onSurfaceVariant`) | **secondary** seed, tone 80 / 30 | x0.24, capped 18 |
| Transport button glyphs, rating stars, seekbar and volume fill, selection highlight, active tab indicator | `accent` / `accentHover` (`primary`) | **primary** seed, tone 80 / 40 | x1.0, capped 64 - the vivid one |
| Separators, outlines, card strokes | `separator`, `stroke`, `strokeHot` | **secondary** seed, low tones | x0.24, capped 18 |
| Success / info highlights | `success` (`tertiary`) | **tertiary** seed, tone 80 / 40 | x0.82, capped 50 |

So the three colours you can pick out by eye are, in order: the **near-neutral text colour** (primary seed, chroma almost removed), the **artist/album colour** (a *different* hue, the secondary seed, at roughly triple that chroma), and the **accent** (the primary seed again, this time at full chroma). The red used for warnings - the ReplayGain notice, for example - is a fixed `211, 47, 47` and is deliberately never derived from the cover, so a red-toned album cannot make a warning look like a normal label.

Mica then paints those semantic surfaces at partial opacity over the blurred cover instead of filling them solid: cards ~72%, headers ~74%, chips ~66%, tab bars and the Presets strip ~50%, separators ~43%. The blurred cover underneath is mixed with the opaque `background` colour at whatever **Mica tint strength** is set to, which is the single control for how dark the whole composition reads.

### APIs and online services

- **Last.fm:** enter the shared API key and username in **RVG Settings › Global settings**. The Last.fm and Last.fm Charts panels use the same credentials.
- **Lyrics:** LRCLIB is the primary online source and needs no API key. The unofficial Musixmatch source is optional and can break if its upstream behaviour changes.
- **Discography:** MusicBrainz is queried directly with caching/throttling; there is no RVG API-key field to configure.
- **Live shows:** enter a free **Ticketmaster Discovery** API key (the consumer key from their developer portal, 5000 calls a day) in **RVG Settings › Live shows**. Ticketmaster publishes MusicBrainz IDs, so an artist can be confirmed rather than guessed.

## Panels at a glance

### Playback and navigation

- **Album artwork** — Displays front/back/disc/icon/artist artwork. Switch art type from the context menu or arrow keys; middle-click jumps between Front and Artist. Click on the art to play or pause the playback. Optional setting: optional Shared-accent border.
- **Player** — Large now-playing card with metadata, playback controls, rating, optional seekbar/volume, and utility actions. A track with no ReplayGain tags is flagged by a small **No ReplayGain** badge above the title (hover it for how to scan), which can be switched off. While the playback queue has items, a **Next** line above the title shows the first one; click it to swap the Player for the queue (see *Queue peek* below). Main settings: accent, track source, icon style, seekbar/volume visibility, the missing-ReplayGain warning, and font-family override.
- **Top bar** — Compact full-width header with artwork, metadata, seekbar/volume, transport, and utility controls. Main settings: which sections are visible and Shared accent vs RVG blue.
- **Playlist** — JSPlaylist-mod-based track list with grouping, columns, search, loved state, artwork backgrounds, and row-density controls. Main settings are grouped under Layout, Rows, Accent, Grouping, Columns, Fonts, Colours, and Background. Middle-click a track to queue or unqueue it, or a group header to do the same for the whole group. Drag a selection onto another row to move it there (Esc cancels). Type to jump to a match (words in any order, accents ignored): Up/Down or F3/Shift+F3 step through matches, Tab narrows the search to artist, album, title, year or genre, Enter plays and Esc returns to where you were. A preview under the search bar lists the matches, albums first when their header matches, and a ring counts down to when the bar closes (both adjustable under Search).
- **Mini Player** — Shrinks the real foobar2000 window into a compact now-playing view with art, playback controls, seekbar, optional Last.fm love button and rating. Remembers position and size. Main setting: **Design** — Design 1 (small cover, one title line, centred transport, full-width seekbar) or Design 2 (full-height cover art beside stacked title, artist and love+stars lines, transport inline with a short seekbar).

  ![Mini Player](https://i.ibb.co/nqhYpb0h/miniplayer.jpg)
- **Quick switcher** — A search box that floats over the layout: type part of an artist, album, track, playlist or command and play, queue or open it from the keyboard. Open it with a keyboard shortcut or the **Open quick switcher** Custom Buttons action. Needs a keyboard shortcut; see [Quick switcher](#quick-switcher).
- **Compact Queue** — Small playback-queue editor with drag reorder, file drops, remove/clear actions, and recovery through a managed playlist.

### Listening history and metadata

- **Playback statistics** — Shows local plays, Last.fm scrobbles, first/last played, and combined history. Main settings: one/two-card layout, source, date detail, accent, and text size.
- **Playback history** — Keeps a compact visual list of recent qualified plays plus listening totals by periods. Clicking on tracks in the log jumps to the song in the playlist.
- **Playback timeline** — Plots listens for the current track over time with zoom/pan, density, markers, and summary stats. Main settings: Local vs Last.fm history, whether the range starts at the first listen or the date added, marker/density style, track source, and accent.
- **Rewind** — Your listening over a period (last 12 months, a month, a year or all time): plays, listening time, streaks and their change from the period before, top artists, albums, tracks and genres with rank changes, new artists, plays per month and when you listen, plus a calendar heatmap and a **Current artist** view that follows the playing (or selected) track. Click an artist to see just that artist; click anything else to select it in your playlist. Right-click to play, queue or add to a playlist; middle-click queues. Reads Enhanced Playback Statistics' play timestamps (Last.fm scrobbles by default, or local plays) and keeps up with new plays by itself. Main settings: play history source, list size (5-20), comparison, featured-artist folding, week start, accent.
- **Track information** — Compact metadata/statistics info panel with toggleable blocks.

### Last.fm, lyrics, and discovery

- **Last.fm** — Statistics, tags, listeners, similar artists, charts, recent scrobbles, and album browsing. Configure credentials globally; panel settings control track source, visible sections, background artwork, and accent. Right clicking on tracks, artists or similar artists allows you to play or queue them, if they are available in your library.
- **Last.fm Charts** — Side-by-side global and personal artist charts for tracks or albums. Configure credentials globally; panel settings control chart type, period, row count, cache duration, track source, and accent. Right clicking on tracks allows you to play or queue them, if they are available in your library.
- **Lyrics** — A minimal lyrics panel with lrclib as main source. Main purpose - have a lyrics panel which will have a customizeable background color for different skin's color themes (accent, dark, light). Reads synced/plain lyrics from tags or sidecar `.lrc`, fetches missing lyrics, highlights synced lines, and can save results back. Main settings: save destination, auto-fetch, click-to-seek, lyric font/sizes, active-line accent, and optional Musixmatch source.
- **Discography + Calendar** — Uses MusicBrainz to show which releases are missing from your library (with configurable filters) and show upcoming releases for your whole library - plus, by default, everything those artists released in the last three months, in one date-ordered list with an in-library/missing badge on each (**Calendar look-back**, Off or Last 3 months). The calendar queries MusicBrainz per library artist and caches each artist group separately, so after the first build it normally runs without any network requests. Main settings: view mode, accent, compact rows, calendar range and look-back, release types, cache duration, and whether artists without MusicBrainz IDs are queried by name. Right clicking on releases allows you to play or queue them, if they are available in your library, and **Search links** adds up to three searches of your own there (any site that takes the artist/album in its URL, e.g. Discogs).
- **Live shows** — Upcoming concerts for every artist in your library, grouped by month. Reuses the same MusicBrainz artist IDs the Discography panel reads from your tags, then asks Ticketmaster one artist at a time and verifies the answer against yours by MusicBrainz ID so a same-named band is not mistaken for yours; rows matched by name alone are tagged. Results are cached per artist on disk, so after the first sweep it normally runs without any network requests. Main settings: API key, place filter (a comma narrows a place, a semicolon starts another - `California, United States; Paris`), how far ahead, minimum tracks per artist, MusicBrainz-only matching, cache duration, compact rows, and accent. Clicking a show opens its event page; right clicking also lets you play or queue the artist from your library.
- **MusicBrainz tagger** — Tags the tracks you have selected in a playlist from a MusicBrainz release, without leaving foobar2000, and without the rough edges of the official MusicBrainz components (which kept erroring outright on this x64 setup) or of tagging by hand in Picard: a search that comes back empty or wrong is one right-click away from another try, every change is shown before it is written, and you choose exactly which fields go in rather than accepting an all-or-nothing tag dump. Searches by the album and artist already on the files — right-click **Search** to correct them and search again, any time — or loads the release ID from your `MUSICBRAINZ_ALBUMID` tag or one you paste, and ranks candidates by how closely their track count matches the selection. Picking a release opens a review screen: first the pairing, file by file, against the release's track list, then every field it could write with the current value, the new value and how many tracks would change — a full preview of the write before it happens. Tick the fields you want and confirm. It never clears a tag with an empty MusicBrainz value, withholds all per-track fields when the two track counts differ, and remembers the previous values so the whole write can be undone from the right-click menu until the panel reloads. Six fields have two spellings in circulation — album artist, artist and album-artist sort order, original release date, label and media. foobar2000's ID3v2 table maps its own names (`ORIGINAL RELEASE DATE`, `ALBUM ARTIST`, `PUBLISHER`, `MEDIA TYPE`, `ALBUMARTISTSORTORDER`, `ARTISTSORTORDER`) onto real frames, while Picard's spellings of those land in `TXXX`; other tag types just store whatever name they are given. Whichever name a file already has is reused, so nothing ends up stored twice under two names, and **Tag name style** decides the rest: *Match the file* (default) uses foobar2000's names on MP3 and the other ID3 formats and Picard's elsewhere, or you can force either. The review screen shows, per field, the name it will be written under. **Date format** chooses between the date exactly as MusicBrainz has it (`1997-05-21`) and the year on its own (`1997`); it applies to Date, while Original release date is always written in full. Main settings: contact info for the MusicBrainz User-Agent (they throttle anonymous clients), how many candidates to fetch, whether to search automatically when the selection changes, and accent.

### Visualisers

- **Spectrum** — Direct2D FFT visualiser with bars, ribbon, and radial views. With several on screen, give each a **Name in Settings** (or right-click › Rename panel) to tell them apart. Main settings: view, band layout, colour/accent, gradient, FFT range/response, trails, peaks, and radial/CD-art options.
- **VU meter** — RMS/peak metering in horizontal or vertical layouts. Can be named like the Spectrum. Main settings: theme/accent, orientation, meter style, scale thresholds, labels/grid/peaks, and response timing. 

### Layout and controls

- **Settings** — Central browser where RVG panels register their settings. Global settings tab also contains Backup & Restore and Storage.
- **Custom buttons** — Build strips/rails of foobar2000 or RVG actions. Main settings: buttons, layout slot, orientation/alignment, style, accent mode, and target behaviour. There are 3 built-in panels (you can delete or add even more), which can be configured to be completely independent, clone each other, or be the same in functionality but have different designs.
- **Bottom bar layout** — Hosts up to four panels, lets you drag their widths, change frame style, and save up to four layouts as presets.
- **Presets** — Four quick buttons that load the saved Bottom bar layouts. **RVG Settings › Global settings › Preset buttons side** (also on the panel's right-click menu) puts the strip at either end of the bottom bar without changing its width; the selected preset's accent bar can mirror to the inner edge when the strip sits on the right.
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

### Queue peek

Add a Compact Queue (`queue_manager.js`) as a direct child of the left side and caption it `QUEUE PEEK`. It stays hidden until the Player's **Next** line is clicked, then takes the Player's place under a back strip; click the strip or press Esc in the queue to return. It is never saved, so a restart always opens on the Player. Without that child the **Next** line still shows, and clicking it does nothing.

### Quick switcher

It is already in the layout; it just needs a keyboard shortcut:

1. Start foobar2000 with the RVG layout loaded once, so the skin can register its **Quick switcher** command.
2. Open **Preferences › Keyboard Shortcuts**, click **Add new**, type `quick` in the filter and pick **Quick switcher**.
3. Press the key you want (Ctrl+K works well) in the key box, then **Apply**. The same shortcut closes it again.

If **Quick switcher** isn't in the list, look in the console for `Quick switcher: the main-menu command could not be registered`. A Custom Buttons button with the **Open quick switcher** action opens it too.

Click the search box once to start typing — JSplitter can't move keyboard focus into a panel by itself. Clicking anywhere else closes it.

| Input | Does |
| --- | --- |
| Up / Down, Page Up / Page Down | Move the selection |
| Enter | Play the artist or album, play a track inside its album, switch to a playlist, run a command |
| Shift+Enter / Ctrl+Enter | Add to the playback queue / play next |
| Click a cover | Play it from the current playlist when it's there, else as Enter would |
| Click a row | Select the artist, album or track in your playlist; switch to a playlist; run a command |
| Middle-click a row | Queue it and keep the switcher open |
| Right-click, or Right at the end of the text | More actions: play next, queue, add to playlist, show in playlist |
| Tab / Shift+Tab | Filter: All, Artists, Albums, Tracks, Playlists, Commands |
| `>` `@` `#` `/` first | Search only Commands, Artists, Albums or Playlists |
| Esc | Back out of actions, then clear the text, then close |

Matching ignores case and accents; an empty box shows the last eight things you opened. The library is indexed on first open and again after it changes, never in the background.

### Resizing

Enable **RVG Settings › Global settings › Allow panel resizing** to use the layout dividers. The splitters handle Top bar height, left/right width, bottom area height, and the Presets/Bottom bar split. Dragging that last divider sets the Presets width whichever end the strip is docked at.

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
  Its **Date added** range mode takes the first field that holds a real date: `%added%` / `%2003_added%` (whichever the Global settings stats source prefers), then the other of the two, then `%lastfm_added%`.
- Windows 10 may use Segoe MDL2 Assets instead of Segoe Fluent Icons.

## Credits

RVG builds on the work of several other authors and projects:

- **JSPlaylist** by **Br3tt (Falstaff)** — the Playlist panel and parts of the album accent engine adapt JSPlaylist / JSPlaylist Mod.
- **Google Material Color Utilities** (© Google LLC, Apache License 2.0) — adapted for artwork colour extraction in `material_colour.js`.
- **marc2003** — the Album artwork panel and part of the VU meter panel adapt marc2003's Spider Monkey Panel samples.
- **Case** — additional VU meter panel adaptation.
- **Spider Monkey Panel / JScript Panel samples** — the Top bar panel is based on a Spider Monkey Panel/JScript sample.
