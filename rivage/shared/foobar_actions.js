// Shared foobar2000 commands/actions for controls, topbar, Mini Player, and custom buttons.
// Context actions prefer playlist selection; Last.fm actions prefer now playing.
var RivageCommands = typeof RivageCommands !== "undefined" ? RivageCommands : (function () {
    var DEFAULT_FLAGS = 8;

    // Narrow failure reporting. Most empty catches in this file guard
    // multi-candidate probing (trying several foobar2000 command/formatter
    // spellings until one works) that is expected to fail and stay silent on
    // purpose. This is for the few that mean a direct user action silently
    // did nothing. Repeats are counted and re-logged only at powers of ten.
    include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\report_failure.js');
    var reportFailure = RivageFailure.reporter('[RivageCommands] ');
    var DEFAULT_TITLE = "RVG";

    var COMMANDS = Object.freeze({
        properties: "Properties",
        openFolder: "Open containing folder",
        showNowPlaying: "View/Show now playing in playlist",

        stopAfterCurrent: "Playback/Stop After Current",
        stopAfterQueue: "Playback/Stop After queue",

        albumArtSearch: "Run service/album art search",
        removePictures: "Remove all pictures",
        musicBrainz: "Tagging/Get tags from MusicBrainz (by artist & album)",
        musicBrainzByAlbumId: "Tagging/Get tags from MusicBrainz (by MB album ID)",

        lastfmLove: Object.freeze([
            "Last.fm Playcount Sync/Love",
            "Last.fm Playcount Sync/Love track",
            "Last.fm Playcount Sync/Love tracks",
            "Last.fm/Last.fm Love Track",
            "Last.fm/Love" // foo_scrobble, with its "Enable Love and Unlove" option on
        ]),
        lastfmUnlove: Object.freeze([
            "Last.fm Playcount Sync/Unlove",
            "Last.fm Playcount Sync/Unlove track",
            "Last.fm Playcount Sync/Unlove tracks",
            "Last.fm/Last.fm Unlove Track",
            "Last.fm/Unlove"
        ]),
        lastfmImportLoved: "Library/Last.fm Playcount Sync/Import Last.fm loved tracks",

        replayGainTrack: "ReplayGain/Scan per-file track gain",
        replayGainAlbum: "ReplayGain/Scan as albums (by tags)",

        moveToMusic: "File operations/Move to/Move folder to my music",
        convertToV0: "Convert/v0 mp3 to my music",
        convertSettings: "Convert/..."
    });

    // Compiled per field name: which fields count follows the stats source.
    var lovedFormatters = {};

    // The loved functions below need PlaybackStatsSource, which every panel using them loads.
    function ultimateLoveCommand(love) {
        return PlaybackStatsSource.isUltimate() ? PlaybackStatsSource.name2003() + "/" + (love ? "Love" : "Unlove") : "";
    }

    function optionTitle(options) {
        return options && options.panelTitle ? String(options.panelTitle) : DEFAULT_TITLE;
    }

    function showPopup(message, options) {
        fb.ShowPopupMessage(String(message || ""), optionTitle(options));
    }

    function emptyHandleList() {
        return new FbMetadbHandleList();
    }

    function getSelectedPlaylistHandles() {
        try {
            var playlist = plman.ActivePlaylist;
            if (playlist < 0) return emptyHandleList();
            return plman.GetPlaylistSelectedItems(playlist) || emptyHandleList();
        } catch (e) {
            return emptyHandleList();
        }
    }

    function getHandleList(handle) {
        return handle ? new FbMetadbHandleList(handle) : emptyHandleList();
    }

    function getTargetHandles(currentHandle) {
        var selected = getSelectedPlaylistHandles();
        if (selected && selected.Count > 0) return selected;
        return getHandleList(currentHandle);
    }

    function runContextWithHandles(command, items, options) {
        var flags = options && options.flags !== undefined ? options.flags : DEFAULT_FLAGS;
        if (!items || !items.Count) return false;

        try {
            return !!fb.RunContextCommandWithMetadb(command, items, flags);
        } catch (e) {
            showPopup(
                "The command could not be executed.\n\n" + command + "\n\n" + (e.message || e),
                options
            );
            return false;
        }
    }

    function runContext(command, currentHandle, options) {
        return runContextWithHandles(command, getTargetHandles(currentHandle), options);
    }

    function runMain(command, options) {
        try {
            return !!fb.RunMainMenuCommand(command);
        } catch (e) {
            showPopup(
                "The main-menu command could not be executed.\n\n" + command + "\n\n" + (e.message || e),
                options
            );
            return false;
        }
    }

    function runFirstMain(candidates, label, options) {
        var list = Array.isArray(candidates) ? candidates : [candidates];
        var i;
        for (i = 0; i < list.length; i++) {
            try {
                if (fb.RunMainMenuCommand(list[i])) return true;
            } catch (e) {}
        }

        showPopup(
            "Could not find the " + label + " command in the main menu. Tried:\n\n" + list.join("\n"),
            options
        );
        return false;
    }

    function isMainMenuChecked(command) {
        try {
            return !!fb.IsMainMenuCommandChecked(command);
        } catch (e) {
            return false;
        }
    }

    function isAnyMainMenuChecked(candidates) {
        var i;
        for (i = 0; i < candidates.length; i++) {
            if (isMainMenuChecked(candidates[i])) return true;
        }
        return false;
    }

    function stopAfterCurrentIsChecked() {
        try {
            return !!fb.StopAfterCurrent;
        } catch (e) {
            return false;
        }
    }

    function stopAfterQueueIsChecked() {
        return isMainMenuChecked(COMMANDS.stopAfterQueue);
    }

    function getStopAfterState() {
        if (stopAfterCurrentIsChecked()) return "current";
        if (stopAfterQueueIsChecked()) return "queue";
        return "";
    }

    function runStopAfterCommand(command, label, options) {
        if (options && options.reportMissing) {
            return runFirstMain([command], label, options);
        }
        return runMain(command, options);
    }

    function toggleStopAfterCurrent(options) {
        var enabling = !stopAfterCurrentIsChecked();

        // Do not enable one stop-after mode unless the conflicting mode was disabled.
        if (enabling && stopAfterQueueIsChecked() &&
            !runStopAfterCommand(COMMANDS.stopAfterQueue, "Stop after queue", options)) return false;
        return runStopAfterCommand(COMMANDS.stopAfterCurrent, "Stop after current track", options);
    }

    function toggleStopAfterQueue(options) {
        var enabling = !stopAfterQueueIsChecked();

        if (enabling && stopAfterCurrentIsChecked() &&
            !runStopAfterCommand(COMMANDS.stopAfterCurrent, "Stop after current track", options)) return false;
        return runStopAfterCommand(COMMANDS.stopAfterQueue, "Stop after queue", options);
    }

    function getLastfmActionHandle(fallbackHandle) {
        try {
            return fb.GetNowPlaying() || fallbackHandle || null;
        } catch (e) {
            return fallbackHandle || null;
        }
    }

    function evaluateLovedHandle(metadb) {
        var fields, i;
        if (!metadb) return false;

        fields = PlaybackStatsSource.lovedFields();
        for (i = 0; i < fields.length; i++) {
            try {
                var tf = lovedFormatters[fields[i]] || (lovedFormatters[fields[i]] = fb.TitleFormat(fields[i]));
                if (PlaybackStatsSource.isLovedValue(tf.EvalWithMetadb(metadb))) return true;
            } catch (e) {}
        }
        return false;
    }

    function evaluateLoved(fallbackHandle) {
        return evaluateLovedHandle(getLastfmActionHandle(fallbackHandle));
    }

    function tryContextCommands(commands, metadb, options) {
        var items, i;
        var flags = options && options.flags !== undefined ? options.flags : DEFAULT_FLAGS;
        if (!metadb) return false;

        items = new FbMetadbHandleList(metadb);
        for (i = 0; i < commands.length; i++) {
            try {
                if (fb.RunContextCommandWithMetadb(commands[i], items, flags)) return true;
            } catch (e) {}
        }
        return false;
    }

    function toggleLoved(fallbackHandle, options) {
        var metadb = getLastfmActionHandle(fallbackHandle);
        var wasLoved, commands, ok;
        if (!metadb) return { ok: false, loved: false, metadb: null, noTarget: true };

        // Evaluate and act on the same snapshot so a track change cannot flip the command.
        wasLoved = evaluateLovedHandle(metadb);
        commands = wasLoved ? COMMANDS.lastfmUnlove : COMMANDS.lastfmLove;
        ok = tryContextCommands(commands, metadb, options);
        // Keep Ultimate Playcount's own mark in step, so the Playlist hearts agree.
        if (ultimateLoveCommand(!wasLoved) && tryContextCommands([ultimateLoveCommand(!wasLoved)], metadb, options)) ok = true;

        if (!ok) {
            showPopup(
                "Could not find the Last.fm love/unlove context command.\n\n" +
                "Install and authorise Last.fm Playcount Sync, then check the shared command labels in shared\\foobar_actions.js.\n\n" +
                "Preferences path:\nFile > Preferences > Tools > Last.fm Playcount Sync",
                options
            );
            return { ok: false, loved: wasLoved, metadb: metadb, noTarget: false };
        }

        // Optimistic only; title-format fields remain authoritative.
        return { ok: true, loved: !wasLoved, metadb: metadb, noTarget: false };
    }

    function openLastfmPreferences(options) {
        showPopup(
            "Authorise Last.fm in:\n\nFile > Preferences > Tools > Last.fm Playcount Sync\n\n" +
            "Enter your username, click Authorise, grant access in the browser, then confirm the foobar2000 dialog.",
            options
        );

        try {
            fb.ShowPreferences();
        } catch (e) { reportFailure('Preferences could not be opened', e); }
    }

    function importLastfmLovedTracks(options) {
        var ok = runMain(COMMANDS.lastfmImportLoved, options);
        if (!ok) {
            showPopup(
                "Run this command manually:\n\nLibrary > Last.fm Playcount Sync > Import Last.fm loved tracks",
                options
            );
        }
        return ok;
    }

    function showLovedTracks() {
        try {
            fb.ShowLibrarySearchUI(PlaybackStatsSource.lovedFields().map(function (field) { return field + " GREATER 0"; }).join(" OR "));
            return true;
        } catch (e) {
            return false;
        }
    }

    return Object.freeze({
        COMMANDS: COMMANDS,
        getSelectedPlaylistHandles: getSelectedPlaylistHandles,
        getHandleList: getHandleList,
        getTargetHandles: getTargetHandles,
        runContextWithHandles: runContextWithHandles,
        runContext: runContext,
        runMain: runMain,
        runFirstMain: runFirstMain,
        isMainMenuChecked: isMainMenuChecked,
        isAnyMainMenuChecked: isAnyMainMenuChecked,
        stopAfterCurrentIsChecked: stopAfterCurrentIsChecked,
        stopAfterQueueIsChecked: stopAfterQueueIsChecked,
        getStopAfterState: getStopAfterState,
        toggleStopAfterCurrent: toggleStopAfterCurrent,
        toggleStopAfterQueue: toggleStopAfterQueue,
        getLastfmActionHandle: getLastfmActionHandle,
        evaluateLoved: evaluateLoved,
        evaluateLovedHandle: evaluateLovedHandle,
        tryContextCommands: tryContextCommands,
        toggleLoved: toggleLoved,
        openLastfmPreferences: openLastfmPreferences,
        importLastfmLovedTracks: importLastfmLovedTracks,
        showLovedTracks: showLovedTracks
    });
})();
