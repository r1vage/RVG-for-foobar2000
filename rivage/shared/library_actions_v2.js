'use strict';

// Shared local-library actions appended to remote-metadata context menus.
var RivageLibraryActions = (typeof RivageLibraryActions !== 'undefined') ? RivageLibraryActions : (function () {
    var MF_STRING = 0x00000000;
    var MF_GRAYED = 0x00000001;
    var BASE = 50000;
    var CMD_PLAY = BASE + 1;
    var CMD_PLAY_NEXT = BASE + 2;
    var CMD_QUEUE = BASE + 3;
    var CMD_SHOW = BASE + 4;
    var CMD_SEARCH = BASE + 5;
    var CMD_WEB = BASE + 6;
    var PLAYLIST_BASE = BASE + 100;
    var NEW_PLAYLIST = BASE + 900;
    var ACTION_PLAYLIST = 'RVG Actions';
    var SEARCH_PLAYLIST = 'RVG Search';
    var QUEUE_RECOVERY_MARKER = '[Rivage Queue Recovery:';

    // Narrow failure reporting. Most empty catches in this file guard
    // optional-API probes and best-effort menu/selection cosmetics that are
    // expected to fail and stay silent on purpose. This is for the few that
    // mean something is actually broken and would otherwise leave no trace.
    // Repeats are counted and re-logged only at powers of ten.
    var reportedFailures = {};
    function reportFailure(what, err) {
        var message = '[RVG Library Actions] ' + what +
            (err === undefined || err === null ? '' : ': ' + err);
        var seen = (reportedFailures[message] || 0) + 1;
        reportedFailures[message] = seen;
        if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
        try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
    }

    function isQueueRecoveryPlaylistName(name) {
        name = String(name || '');
        return name.indexOf(QUEUE_RECOVERY_MARKER) >= 0 || name.indexOf('Queue Recovery') >= 0;
    }

    function trimText(value) {
        return String(value || '').replace(/^\s+|\s+$/g, '');
    }

    function menuSafeLabel(value) {
        return String(value || '').replace(/&/g, '&&');
    }

    function isWebUrl(url) {
        return /^https?:\/\/[^\s]+$/i.test(trimText(url));
    }

    function findPlaylist(name) {
        try { return plman.FindPlaylist(name); } catch (e) { return -1; }
    }

    function isAutoPlaylist(index) {
        try { return typeof plman.IsAutoPlaylist === 'function' && plman.IsAutoPlaylist(index); } catch (e) { return false; }
    }

    function lockedActions(index) {
        try {
            if (typeof plman.GetPlaylistLockedActions === 'function') {
                return plman.GetPlaylistLockedActions(index) || [];
            }
        } catch (e) { }
        return null;
    }

    function blocksAction(actions, name) {
        return !!actions && actions.indexOf(name) >= 0;
    }

    function legacyPlaylistLocked(index) {
        try { return typeof plman.IsPlaylistLocked === 'function' && plman.IsPlaylistLocked(index); } catch (e) { return false; }
    }

    function canAddToPlaylist(index) {
        if (index < 0 || isAutoPlaylist(index)) return false;
        var actions = lockedActions(index);
        if (actions) return !blocksAction(actions, 'AddItems');
        return !legacyPlaylistLocked(index);
    }

    function canReuseScratchPlaylist(index) {
        if (index < 0 || isAutoPlaylist(index)) return false;
        var actions = lockedActions(index);
        if (actions) {
            return !blocksAction(actions, 'AddItems') &&
                !blocksAction(actions, 'RemoveItems') &&
                !blocksAction(actions, 'ReplaceItems');
        }
        return !legacyPlaylistLocked(index);
    }

    function uniquePlaylistName(name) {
        var base = trimText(name) || ACTION_PLAYLIST;
        var candidate = base;
        var suffix = 2;
        while (findPlaylist(candidate) >= 0) {
            candidate = base + ' (' + suffix + ')';
            suffix++;
        }
        return candidate;
    }

    function createNewPlaylist(name) {
        var candidate = uniquePlaylistName(name);
        try {
            var index = plman.PlaylistCount;
            plman.CreatePlaylist(index, candidate);
            return index;
        } catch (e) { return -1; }
    }

    function writableScratchPlaylist(name) {
        var base = trimText(name) || ACTION_PLAYLIST;
        var index = findPlaylist(base);
        if (index >= 0 && canReuseScratchPlaylist(index)) return index;
        return createNewPlaylist(base);
    }

    function insertHandles(index, handles, clearFirst) {
        if (index < 0 || !handles || handles.Count <= 0) return -1;
        try {
            if (clearFirst) plman.ClearPlaylist(index);
            var insertionIndex = clearFirst ? 0 : plman.PlaylistItemCount(index);
            plman.InsertPlaylistItems(index, insertionIndex, handles, false);
            return insertionIndex;
        } catch (e) { return -1; }
    }

    function activatePlaylist(index, focusIndex, play) {
        if (index < 0) return false;
        try {
            plman.ActivePlaylist = index;
            if (focusIndex >= 0 && focusIndex < plman.PlaylistItemCount(index)) {
                plman.SetPlaylistFocusItem(index, focusIndex);
                if (play) plman.ExecutePlaylistDefaultAction(index, focusIndex);
            }
            return true;
        } catch (e) { return false; }
    }

    function playHandles(handles) {
        if (!handles || handles.Count <= 0) return false;
        var index = writableScratchPlaylist(ACTION_PLAYLIST);
        var insertedAt = insertHandles(index, handles, true);
        return insertedAt >= 0 && activatePlaylist(index, insertedAt, true);
    }

    function queueHandles(handles) {
        var array;
        var i;
        if (!handles || handles.Count <= 0) return false;
        try {
            array = RivageLibraryResolver.listToArray(handles);
            for (i = 0; i < array.length; i++) plman.AddItemToPlaybackQueue(array[i]);
            return array.length > 0;
        } catch (e) { return false; }
    }

    function snapshotQueue() {
        var contents = plman.GetPlaybackQueueContents() || [];
        var snapshot = [];
        var i;
        for (i = 0; i < contents.length; i++) {
            if (!contents[i] || !contents[i].Handle) continue;
            snapshot.push({
                handle: contents[i].Handle,
                playlistIndex: Number(contents[i].PlaylistIndex),
                playlistItemIndex: Number(contents[i].PlaylistItemIndex)
            });
        }
        return snapshot;
    }

    function handleQueueEntry(handle) {
        return { handle: handle, playlistIndex: -1, playlistItemIndex: -1 };
    }

    function addQueueEntry(entry, allowHandleFallback) {
        var playlistBacked = isFinite(entry.playlistIndex) && entry.playlistIndex >= 0 &&
            isFinite(entry.playlistItemIndex) && entry.playlistItemIndex >= 0;
        if (playlistBacked && typeof plman.AddPlaylistItemToPlaybackQueue === 'function') {
            try {
                plman.AddPlaylistItemToPlaybackQueue(entry.playlistIndex, entry.playlistItemIndex);
                return;
            } catch (e) {
                if (!allowHandleFallback || !entry.handle) throw e;
            }
        }
        if (!entry.handle) throw new Error('Playback queue entry has no handle');
        plman.AddItemToPlaybackQueue(entry.handle);
    }

    function writeQueue(entries, allowHandleFallback) {
        var i;
        for (i = 0; i < entries.length; i++) addQueueEntry(entries[i], allowHandleFallback);
    }

    function restoreQueue(entries) {
        var i;
        try { plman.FlushPlaybackQueue(); } catch (e) { return; }
        for (i = 0; i < entries.length; i++) {
            try { addQueueEntry(entries[i], true); } catch (e2) { reportFailure('a queued track could not be restored', e2); }
        }
    }

    function playNext(handles) {
        if (!handles || handles.Count <= 0) return false;
        var previous;
        var actionHandles;
        var replacement = [];
        var rewriteStarted = false;
        var i;
        try {
            previous = snapshotQueue();
            actionHandles = RivageLibraryResolver.listToArray(handles);
            if (!actionHandles.length) return false;
            for (i = 0; i < actionHandles.length; i++) replacement.push(handleQueueEntry(actionHandles[i]));
            for (i = 0; i < previous.length; i++) replacement.push(previous[i]);
            rewriteStarted = true;
            plman.FlushPlaybackQueue();
            writeQueue(replacement, false);
            return true;
        } catch (e) {
            if (rewriteStarted && previous) restoreQueue(previous);
            return false;
        }
    }

    function searchPlaylist(result) {
        if (!result || !result.all || result.all.Count <= 0) return false;
        var index = writableScratchPlaylist(SEARCH_PLAYLIST);
        var insertedAt = insertHandles(index, result.all, true);
        return insertedAt >= 0 && activatePlaylist(index, insertedAt, false);
    }

    function showExisting(handles) {
        var handle;
        var p, items, at;
        if (!handles || handles.Count <= 0) return false;
        var array = RivageLibraryResolver.listToArray(handles);
        handle = array.length ? array[0] : null;
        if (!handle) return false;
        try {
            for (p = 0; p < plman.PlaylistCount; p++) {
                var playlistName = '';
                try { playlistName = plman.GetPlaylistName(p); } catch (eName) { playlistName = ''; }
                if (playlistName === ACTION_PLAYLIST || playlistName === SEARCH_PLAYLIST || isQueueRecoveryPlaylistName(playlistName)) continue;
                items = plman.GetPlaylistItems(p);
                at = items ? items.Find(handle) : -1;
                if (at >= 0) {
                    plman.ActivePlaylist = p;
                    try { plman.ClearPlaylistSelection(p); } catch (e0) { }
                    try { plman.SetPlaylistSelectionSingle(p, at, true); } catch (e1) { reportFailure('the track could not be selected in the playlist', e1); }
                    plman.SetPlaylistFocusItem(p, at);
                    return true;
                }
            }
        } catch (e) { reportFailure('the track could not be located to reveal it in a playlist', e); }
        return false;
    }

    function openUrl(url) {
        url = trimText(url);
        if (!isWebUrl(url)) return false;
        try { new ActiveXObject('WScript.Shell').Run(url); return true; } catch (e) { return false; }
    }

    function descriptorLabel(descriptor) {
        if (!descriptor) return 'item';
        if (descriptor.type === 'artist') return 'artist';
        if (descriptor.type === 'album') return 'album';
        return 'track';
    }

    function append(menu, descriptor, options) {
        options = options || {};
        if (!menu || !descriptor) return null;
        var result = RivageLibraryResolver.resolve(descriptor);
        var hasLocal = result.action && result.action.Count > 0;
        var hasWeb = isWebUrl(descriptor.url);
        var playlistTargets = [];
        var p, name;
        var label = descriptorLabel(descriptor);

        if (options.separator !== false) menu.AppendMenuSeparator();
        menu.AppendMenuItem(hasLocal ? MF_STRING : MF_GRAYED, CMD_PLAY, 'Play local ' + label);
        menu.AppendMenuItem(hasLocal ? MF_STRING : MF_GRAYED, CMD_PLAY_NEXT, 'Play next');
        menu.AppendMenuItem(hasLocal ? MF_STRING : MF_GRAYED, CMD_QUEUE, 'Add to playback queue');

        if (hasLocal) {
            var playlistMenu = window.CreatePopupMenu();
            try {
                for (p = 0; p < plman.PlaylistCount && playlistTargets.length < 80; p++) {
                    if (!canAddToPlaylist(p)) continue;
                    try { name = plman.GetPlaylistName(p); } catch (e0) { name = 'Playlist ' + (p + 1); }
                    if (name === ACTION_PLAYLIST || name === SEARCH_PLAYLIST || isQueueRecoveryPlaylistName(name)) continue;
                    playlistTargets.push({ command: PLAYLIST_BASE + playlistTargets.length, index: p });
                    playlistMenu.AppendMenuItem(MF_STRING, PLAYLIST_BASE + playlistTargets.length - 1, menuSafeLabel(name));
                }
            } catch (e1) { reportFailure('the playlist submenu could not be fully built', e1); }
            if (playlistTargets.length) playlistMenu.AppendMenuSeparator();
            playlistMenu.AppendMenuItem(MF_STRING, NEW_PLAYLIST, 'New playlist\u2026');
            playlistMenu.AppendTo(menu, MF_STRING, 'Add to playlist');
        } else {
            menu.AppendMenuItem(MF_GRAYED, BASE + 7, 'Add to playlist');
        }

        menu.AppendMenuItem(hasLocal ? MF_STRING : MF_GRAYED, CMD_SHOW, 'Show in playlist');
        menu.AppendMenuItem(result.count > 0 ? MF_STRING : MF_GRAYED, CMD_SEARCH, 'Search library (' + result.count + ' match' + (result.count === 1 ? '' : 'es') + ')');
        if (hasWeb) menu.AppendMenuItem(MF_STRING, CMD_WEB, options.webLabel || 'Open on web');

        return { result: result, descriptor: descriptor, playlistTargets: playlistTargets };
    }

    function handle(state, command) {
        if (!state || !command) return false;
        var result = state.result;
        var i, target, name, index, insertedAt;
        if (command === CMD_PLAY) { playHandles(result.action); return true; }
        if (command === CMD_PLAY_NEXT) { playNext(result.action); return true; }
        if (command === CMD_QUEUE) { queueHandles(result.action); return true; }
        if (command === CMD_SHOW) {
            if (!showExisting(result.action)) searchPlaylist(result);
            return true;
        }
        if (command === CMD_SEARCH) { searchPlaylist(result); return true; }
        if (command === CMD_WEB) { openUrl(state.descriptor.url); return true; }
        if (command === NEW_PLAYLIST) {
            try {
                name = utils.InputBox(window.ID, 'Playlist name', window.Name, '', false);
            } catch (e) { name = ''; }
            name = trimText(name);
            if (name) {
                index = createNewPlaylist(name);
                insertedAt = insertHandles(index, result.action, false);
                if (insertedAt >= 0) activatePlaylist(index, insertedAt, false);
            }
            return true;
        }
        for (i = 0; i < state.playlistTargets.length; i++) {
            target = state.playlistTargets[i];
            if (command === target.command) {
                insertedAt = insertHandles(target.index, result.action, false);
                if (insertedAt >= 0) activatePlaylist(target.index, insertedAt, false);
                return true;
            }
        }
        return false;
    }

    return { append: append, handle: handle };
})();
