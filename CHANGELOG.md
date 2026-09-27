# Changelog

All notable changes to RVG (skin for foobar2000) are documented here.

## [1.0.0] - 2026-09-27

### Added

- **Rewind** — your year in music, whenever you want it. See your top artists, albums, tracks and genres for the last 12 months, any month, any year or all time, with ▲▼ showing what moved up or down since the period before. You also get listening time, streaks, plays per month, and which days and hours you listen most. Switch to a **Heatmap** of every day you listened, or to **Current artist** to see your history with whoever is playing. **Comebacks** lists albums you went back to after a year or more. Every entry has its cover or artist picture, and long periods start from your first listen instead of showing years of nothing. Click an artist to see more about them, click anything else to select it in your playlist, or right-click to play it. **Save as image** (right-click) saves a 1080×1350 picture of the period that you can share. It works from your Last.fm scrobbles or your local play counts, updates as you listen, and stays fast even with a very large library.
- **Rediscover** — albums (or tracks) you loved and then stopped playing: ones you played a lot or rated highly, but haven't heard in months. It shows covers, play counts and how long it's been, and hovering explains why something was picked. **Play a mix** puts 25 of them in a playlist and shuffles it; you can also do this from the Quick switcher (*Rediscover: play forgotten favourites*). Right-click anything you don't want suggested again.
- **Quick switcher** — press a shortcut and start typing. Artists, albums, tracks, playlists and commands show up as you type, and it doesn't care about capital letters or accents. Play, queue, play next or add to a playlist without touching the mouse. The README explains how to set up the shortcut.
- **Artwork Mica** — a blurred copy of the current cover sits behind the whole skin, with see-through panels on top. The entire layout changes colour at once when the track changes. Turn on **Acrylic noise** for the fine grain Windows uses on its own acrylic surfaces.
- **Live shows** — upcoming concerts for every artist in your library, grouped by month and filtered to where you live. Artists are matched by their MusicBrainz ID, so a different band with the same name won't show up. Concert data comes from Ticketmaster.
- **MusicBrainz tagger** — tag the selected tracks from a MusicBrainz release. Before anything is written you see each field's current and new value side by side, you choose which ones to write, and one click undoes it. It never empties a tag, and never writes without showing you first.
- **Health check** — Global settings › Health lists every component, font and setting RVG uses, what each one is for, and a **Get** button for anything missing. If something is missing on first start, it opens by itself.
- **Low-power mode** — one switch for laptops and older PCs. Mica becomes a plain artwork-coloured background, the visualisers and lyrics animation run at 20 fps at most, and titles stop scrolling. Switch it off and everything goes back to how it was.
- **Discography**: the Calendar now shows releases from the last three months together with upcoming ones in one timeline, and can include artists without MusicBrainz IDs.
- **Playlist**: drag-to-reorder is back, and it's instant. New **Inset card** group headers with rounded cover art. Middle-click a group header to queue the whole album.
- **Player**: a **Next** line shows what's in the queue; click it to see and edit the queue. The No ReplayGain warning can now be turned off.
- **Mini Player Design 2** — full-height cover art, with the title, artist, love button and rating next to it.
- **UI scale** — follow Windows' scaling, ignore it, or pick any size from 50 to 300%.
- **Storage** — see how much disk space each panel's cache takes up, and clear it. **Memory use** shows how much memory each panel is using.
- **Bottom bar** has a new, minimal **Mica line** style, and the **preset buttons** can go on either side.
- **Playback timeline** can start from the date a track was added, instead of only from its first listen.
- **VU meter** can be renamed in Settings, like Spectrum.

### Changed

- **Faster track changes**: working out the artwork colours and the Mica blur now happens in the background, and the Player, Top bar and Mini Player only redraw what actually changed.
- **Playlist**: much smoother scrolling. Quick search finds words in any order, ignores accents, and lets you step through the matches with highlights and a preview. Cover art uses less memory.
- **Playlist flyout** redesigned: it now follows your theme (light, dark, artwork colours and Mica), its rows are rounded like Inset card rows, and it's half as wide as the playlist. The current playlist is always easy to read, even when it's also the one playing, which now has a speaker icon. The remove button only appears when you hover a playlist, and the bottom bar has A–Z / Z–A sorting.
- **Global settings**: theme, accent, Mica and UI scale are now on their own **Appearance** tab.
- **Defaults**: new installs start with Artwork Mica (blur 70, tint 62, light noise) and Inset card group headers. Artwork Mica is now first in the Global theme list, and **Panel defaults** is now called **Accent dark**.
- **Playback history** adds a track after you've listened for a minute (or when a shorter track ends), instead of after 10 seconds.
- **Discography**: the Calendar now looks up each artist separately, so albums no longer go missing when there are too many results. A refresh that gets interrupted picks up where it left off, and results are kept for 30 days. Your own search links replace the built-in trackers.
- **Player**: a **No ReplayGain** label replaces the red stripe nobody could make sense of, and the text has a little more space.
- **Artwork Mica**: cards in every panel are a bit more see-through (66% instead of 72%), so more of the artwork shows through.
- **Seekbar**: the time labels now line up with the ends of the bar.
- **RVG now needs JSplitter 4.2.1** or newer. Older versions are missing drawing features several panels use, and show script errors. The Health check flags anything older.
- **Lyrics** now keeps its Musixmatch token in a cache file instead of in the panel's settings, so it no longer ends up in exported layouts. An existing token is moved over the first time you start foobar2000.
- Smaller changes: Compact Queue shading and font size; double-click the left-side divider to reset it; smoother Last.fm lists; the MusicBrainz button searches artist and album; font dialogs open on the right panel; scrolling titles use half the memory.
- **Clicks work the same everywhere** in Rewind, Rediscover, Playback history and the Last.fm panels. Left-click opens an artist or selects the item in your playlist (Last.fm rows still open on Last.fm), middle-click adds it to the queue, and right-click opens the same menu everywhere: Play, Play next, Add to playback queue, Add to playlist, Show in playlist and Search library. In Rediscover and the Quick switcher, clicking a cover plays it. When the music is already in your current playlist, playback starts there, so that playlist keeps going afterwards; the menu's Play does the same. Clicking a row in the Quick switcher now selects it instead of playing it.
- **OpenLyrics** is no longer needed: the layout that comes with RVG uses ESLyric instead, and the Health check no longer asks for it.

### Fixed

- **Playback history**: clicking a track that isn't in the current playlist now selects it where it is (or in RVG Search), instead of doing nothing.
- **Live shows** only opens event and ticket links that are proper web addresses.
- Discography, Live shows and MusicBrainz tagger: if a request never got a reply, the panel could stop working until you restarted foobar2000.
- Using Discography and MusicBrainz tagger at the same time could send MusicBrainz too many requests, which it rejected (503 errors).
- On a track change, colours changed one panel at a time instead of all at once, and the Playlist changed last.
- Artwork colour themes didn't apply to third-party Columns UI panels under **Extra**.
- Bottom bar: dark lines between panels under Accent dark, blurry frame edges, and rounded corners that got cut off.
- "Arc argument has invalid value" errors from rounded borders, and from Discography with large fonts.
- Settings: the sub-tab scroll arrows had solid boxes behind them under Mica.
- Custom Buttons: right-clicking the MusicBrainz button and choosing "by album ID" did nothing.
- The "…" in the Spectrum and Extra menus showed up as broken characters.

## [0.9.5] - 2026-08-23

### Added

- RVG Settings: **Backup & Restore** — save the settings of every open panel to a JSON file, and load them back later.
- Mini Player: a new compact view that shrinks the foobar2000 window itself (album art, playback buttons, seekbar, Last.fm love, rating stars). Options put always-on-top and the window-size lock back the way they were when you leave it.
- Playback Timeline: **Density style** (Area / Bars), and a choice of how listens are marked along the bottom (Off / Ticks / Dots / Heat strip).
- Custom Buttons: the MusicBrainz Tags button now does something on right- and middle-click, and right-clicking Select All opens Properties.
- Playback History: right-click › "Reset listening stats..." clears the daily and all-time listening totals in one go, after asking you first.

### Changed

- Discography: the header now looks like the ones in Playback timeline and Playback history.
- Clearer, more consistent wording across all panels — accents, themes, track sources, panel names, empty screens and prompts. Some settings were reorganised, and the README was updated to match.

### Fixed

- Discography: Redacted/Orpheus searches now include the artist, not just the album title.
- Last.fm Charts: the cache file is smaller, because it only keeps what the panel actually uses.
- Playback Statistics no longer keeps recalculating while it's hidden behind another tab.

## [0.9.0] - 2026-08-20

The first release with a version number.

### Added

- New Custom Buttons and Playback Timeline panels.
- Seekbar: a mode that handles both seeking and volume (Top bar and Controls).
- Global accent: choose album art, the default colour, or your own.
- Last.fm Charts: a local "All time" view, based on your own play counts.
- Custom Buttons: Preferences and ReplayGain buttons out of the box.
- Queue Manager: one shared recovery playlist, which you can delete or switch off.
- Album Art: a placeholder picture when there's no artist image, and clicking the placeholder plays or pauses.

### Changed

- Your Last.fm API key and username are now set once in Global settings and used by both Last.fm panels.
- Playlist: `F2` renames the current playlist (it used to be `F4`), and `F4` now always re-sorts by the current grouping.
- Lyrics panel now draws with Direct2D, and can fall back to Musixmatch.

### Fixed

- Spectrum: the bars stuttered.
- Middle splitter: resizing keeps proportions again, some spacing that had broken is fixed, and custom sizes are remembered.
- Album accent colours: behind-the-scenes clean-up.
- Seekbar: its settings could keep updating each other in a loop.
- Top bar: a problem with the album art cache.
