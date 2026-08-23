'use strict';

// Compact playback-queue editor with a failure-safe managed recovery playlist,
// shared by every Compact Queue instance and toggleable/deletable from its
// right-click menu.

window.DrawMode = 0;

include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\design_system.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\dynamic_theme_protocol.js');
include(fb.ProfilePath + 'jsplitter\\rivage\\shared\\album_accent_protocol.js');

window.DefineScript('RVG Compact Queue', {
    author: 'RivaGe',
    version: '2.11.0',
    features: { drag_n_drop: true, grab_focus: true }
});

// Narrow failure reporting. Most empty catches in this file guard calls that
// are *expected* to fail (clearing an already-fired timer, an optional tooltip
// or drag-hint API the host may not expose) and stay silent on purpose. This
// is for the few that mean something is actually broken and would otherwise
// leave no trace. Repeats are counted and re-logged only at powers of ten, so
// a per-row failure reports itself without flooding the console.
var reportedFailures = {};
function reportFailure(what, err) {
    var message = '[RVG Compact Queue] ' + what +
        (err === undefined || err === null ? '' : ': ' + err);
    var seen = (reportedFailures[message] || 0) + 1;
    reportedFailures[message] = seen;
    if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
    try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
}

var MF_STRING = 0x00000000;
var MF_GRAYED = 0x00000001;
var MF_CHECKED = 0x00000008;
var DROPEFFECT_NONE = 0;
var DROPEFFECT_COPY = 1;

var IDC_ARROW = 32512;
var IDC_HAND = 32649;


var PROPERTY_PREFIX = 'Rivage Compact Queue.';
var PROPERTY_RECOVERY_PLAYLIST = PROPERTY_PREFIX + 'Recovery playlist name';
var DEFAULT_RECOVERY_PLAYLIST = 'Queue Recovery (automatic)';

var recoveryPlaylistName = String(window.GetProperty(
    PROPERTY_RECOVERY_PLAYLIST,
    DEFAULT_RECOVERY_PLAYLIST
) || DEFAULT_RECOVERY_PLAYLIST);

var sharedAccent = SharedAccentProtocol.opaque(RivageUI.DEFAULT_ACCENT);

// Segoe MDL2 Assets: Delete.
var CLEAR_GLYPH = String.fromCharCode(0xE74D);
var CLEAR_BUTTON_SIZE = 18;
var CLEAR_BUTTON_MIN_SIZE = 12;


var panelDpi = 72;

function refreshPanelDpi() {
    var nextDpi = 72;

    try {
        if (typeof DPI !== 'undefined' && Number(DPI) > 0) {
            nextDpi = Number(DPI);
        } else if (typeof window !== 'undefined' && Number(window.DPI) > 0) {
            nextDpi = Number(window.DPI);
        }
    } catch (e) {
        nextDpi = 72;
    }

    panelDpi = nextDpi;
}

function scale(value) {
    var numeric = Number(value);

    if (!isFinite(numeric) || numeric === 0) return 0;
    return Math.max(1, Math.round(numeric * panelDpi / 72));
}

function clampNumber(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
}

// Keep body typography aligned with Play Log while scaling for panel size and DPI.
var BODY_FONT_PT = 9;
var MINIMUM_FONT_PT = 8;
var MAXIMUM_FONT_PT = 14;
var REFERENCE_WIDTH_PT = 150;
var REFERENCE_HEIGHT_PT = 80;
var adaptiveFontScale = 1;

function updateAdaptiveFontScale(width, height) {
    var baseW = Math.max(1, scale(REFERENCE_WIDTH_PT));
    var baseH = Math.max(1, scale(REFERENCE_HEIGHT_PT));

    adaptiveFontScale = clampNumber(
        Math.min(Number(width) / baseW, Number(height) / baseH),
        MINIMUM_FONT_PT / BODY_FONT_PT,
        MAXIMUM_FONT_PT / BODY_FONT_PT
    );
}

function fontPx(value) {
    var minPx = scale(MINIMUM_FONT_PT);
    var maxPx = scale(MAXIMUM_FONT_PT);
    var requested = Math.round(scale(value) * adaptiveFontScale);

    if (Number(value) === 0) return 0;
    return Math.round(clampNumber(requested, minPx, maxPx));
}

var hostVisualInfo = null;
var hostFontName = 'Segoe UI';
var theme = RivageUI.createTheme({ accent: sharedAccent });
var painter = RivageUI.createPainter({ scale: scale, theme: theme });
var textFont = null;
var emptyFont = null;
var iconFontFamily = 'Segoe MDL2 Assets';

function currentAccent() {
    return sharedAccent;
}

function refreshTheme() {
    hostVisualInfo = RivageUI.hostInfo();
    hostFontName = hostVisualInfo.fontFamily || 'Segoe UI';
    theme = RivageUI.createTheme({
        host: hostVisualInfo,
        accent: currentAccent()
    });
    painter.setTheme(theme);
}

function rebuildFonts(clearCache) {
    if (clearCache) RivageUI.clearFontCache();

    iconFontFamily = RivageUI.iconFontFamily();
    textFont = RivageUI.font(hostFontName, fontPx(BODY_FONT_PT), 0);
    emptyFont = RivageUI.font(hostFontName, fontPx(BODY_FONT_PT), 0);
    configureNativeTooltip();
}

function getIconFont(size) {
    return RivageUI.font(
        iconFontFamily,
        Math.max(8, Math.round(size)),
        0
    );
}

function refreshVisualResources(clearFontCache) {
    refreshTheme();
    rebuildFonts(clearFontCache);
}

function on_font_changed() {
    refreshPanelDpi();
    refreshVisualResources(true);
    layout();
    refreshPointerState();
    window.Repaint(true);
}


var titleFormat = fb.TitleFormat('$if2(%artist%,Unknown artist) - $if2(%title%,$filename(%path%))');
var queueEntries = [];
var selectedIndex = -1;
var internalQueueWrite = false;
var internalRecoveryWrite = false;
var initialised = false;
var unloading = false;
var pendingExternalDrop = null;
var externalDropImportTimer = null;
var externalDropExpiryTimer = null;
var externalDropGeneration = 0;
var queueRefreshTimer = null;
var recoveryResyncTimer = null;
var startupTimer = null;

var PROPERTY_RECOVERY_ENABLED = PROPERTY_PREFIX + 'Recovery enabled';
var PROPERTY_RECOVERY_MIGRATED = PROPERTY_PREFIX + 'Recovery playlist migration complete';
var PROPERTY_RECOVERY_SYNC_PENDING = PROPERTY_PREFIX + 'Recovery sync pending';
var RECOVERY_MARKER_PREFIX = ' [Rivage Queue Recovery:';
var EXTERNAL_DROP_TIMEOUT_MS = 5000;
var RESTORE_FAILED = -1;
var RESTORE_NONE = 0;
var RESTORE_OK = 1;

// Every Compact Queue instance manages one shared recovery playlist: foobar's
// playback queue is a single app-wide queue, so a per-instance random id here
// only produced duplicate mirrors of the identical data (one extra, orphaned
// playlist per open instance). A fixed id makes every instance resolve to the
// same managed playlist instead.
var recoveryPlaylistId = 'shared';

var recoveryMigrationComplete = !!window.GetProperty(PROPERTY_RECOVERY_MIGRATED, false);
var recoverySyncPending = !!window.GetProperty(PROPERTY_RECOVERY_SYNC_PENDING, false);
// Gates whether a missing recovery playlist gets recreated (see
// recoveryPlaylistIndex()). Off lets a user-deleted recovery playlist stay
// deleted instead of reappearing on the next playlist-topology callback.
var recoveryEnabled = !!window.GetProperty(PROPERTY_RECOVERY_ENABLED, true);

function setRecoveryEnabled(value) {
    value = !!value;
    if (value === recoveryEnabled) return;
    recoveryEnabled = value;
    try { window.SetProperty(PROPERTY_RECOVERY_ENABLED, value); }
    catch (e) { reportFailure('the recovery-playlist setting could not be saved', e); }
}

function setRecoveryMigrationComplete(value) {
    value = !!value;
    if (value === recoveryMigrationComplete) return;
    recoveryMigrationComplete = value;
    try { window.SetProperty(PROPERTY_RECOVERY_MIGRATED, value); }
    catch (e) { reportFailure('the recovery-migration flag could not be saved', e); }
}

function setRecoverySyncPending(value) {
    value = !!value;
    if (value === recoverySyncPending) return;
    recoverySyncPending = value;
    try { window.SetProperty(PROPERTY_RECOVERY_SYNC_PENDING, value); }
    catch (e) { reportFailure('the recovery sync-pending flag could not be saved', e); }
}

function recoveryIdentityMarker() {
    return RECOVERY_MARKER_PREFIX + recoveryPlaylistId + ']';
}

function managedRecoveryPlaylistName() {
    return recoveryPlaylistName + recoveryIdentityMarker();
}

function playlistNameAt(index) {
    try { return String(plman.GetPlaylistName(index) || ''); } catch (e) { return ''; }
}

function findPlaylistByExactName(name) {
    var target = String(name || '');
    var i;
    try {
        for (i = 0; i < plman.PlaylistCount; i++) {
            if (playlistNameAt(i) === target) return i;
        }
    } catch (e) {
        // Reported because a false "not found" here can create a duplicate playlist.
        reportFailure('the playlist list could not be searched by name', e);
    }
    return -1;
}

function findOwnedRecoveryPlaylist() {
    var marker = recoveryIdentityMarker();
    var i;
    var name;
    try {
        for (i = 0; i < plman.PlaylistCount; i++) {
            name = playlistNameAt(i);
            if (name.indexOf(marker) >= 0) return i;
        }
    } catch (e) {
        reportFailure('the recovery playlist could not be located', e);
    }
    return -1;
}

function recoveryPlaylistIndex(createIfMissing) {
    var index = findOwnedRecoveryPlaylist();
    var desiredName = managedRecoveryPlaylistName();

    if (index >= 0) {
        if (playlistNameAt(index) !== desiredName) {
            try { plman.RenamePlaylist(index, desiredName); }
            catch (e) { reportFailure('the recovery playlist could not be renamed', e); }
        }
        return index;
    }
    // recoveryEnabled=false is what lets a deleted recovery playlist actually
    // stay deleted: every other caller already treats -1 as "no recovery
    // playlist available right now" without side effects.
    if (!createIfMissing || !recoveryEnabled) return -1;

    try {
        index = plman.PlaylistCount;
        plman.CreatePlaylist(index, desiredName);
        return index;
    } catch (e2) {
        return -1;
    }
}

function isOwnedRecoveryPlaylistIndex(index) {
    index = Number(index);
    return isFinite(index) && index >= 0 && index === findOwnedRecoveryPlaylist();
}

function cloneHandleList(handles) {
    var copy = [];
    var i;
    if (!handles) return new FbMetadbHandleList(copy);
    try { return new FbMetadbHandleList(handles); } catch (e) { }
    try {
        for (i = 0; i < handles.Count; i++) copy.push(handles[i]);
    } catch (e2) {
        // The direct copy above already failed, so this returns an EMPTY list -
        // silently, the queue would just look like it lost its tracks.
        reportFailure('a track list could not be copied and came back empty', e2);
    }
    return new FbMetadbHandleList(copy);
}

function getPlaylistItemsSafe(index) {
    try { return cloneHandleList(plman.GetPlaylistItems(index)); } catch (e) { return null; }
}

function sameMetadbHandle(first, second) {
    var firstPath;
    var secondPath;
    var firstSubSong;
    var secondSubSong;

    if (first === second) return true;
    if (!first || !second) return false;

    try {
        if (typeof first.Compare === 'function' && first.Compare(second)) return true;
    } catch (e) { }

    try {
        firstPath = String(first.RawPath || first.Path || '');
        secondPath = String(second.RawPath || second.Path || '');
        firstSubSong = Number(first.SubSong) || 0;
        secondSubSong = Number(second.SubSong) || 0;
    } catch (e2) {
        return false;
    }

    return firstPath.length > 0 && firstPath === secondPath && firstSubSong === secondSubSong;
}

function handleListsEqualInOrder(first, second) {
    var firstCount;
    var secondCount;
    var i;

    if (!first || !second) return false;
    try {
        firstCount = Number(first.Count);
        secondCount = Number(second.Count);
    } catch (e) {
        return false;
    }
    if (!isFinite(firstCount) || !isFinite(secondCount) || firstCount !== secondCount) return false;

    for (i = 0; i < firstCount; i++) {
        if (!sameMetadbHandle(first[i], second[i])) return false;
    }
    return true;
}

function replaceRecoveryPlaylistHandles(playlistIndex, handles) {
    var previous = getPlaylistItemsSafe(playlistIndex);
    var replacement;
    var success = false;

    if (!previous) return false;
    replacement = cloneHandleList(handles);

    // Playlist callbacks can be delivered after this function returns. Avoid
    // rewriting an already-correct mirror so a late self-callback cannot arm
    // an endless zero-delay repair/rewrite cycle on foobar's UI thread.
    if (handleListsEqualInOrder(previous, replacement)) return true;

    internalRecoveryWrite = true;
    try {
        plman.ClearPlaylist(playlistIndex);
        if (replacement.Count > 0) plman.InsertPlaylistItems(playlistIndex, 0, replacement, false);
        if (Number(plman.PlaylistItemCount(playlistIndex)) !== replacement.Count) {
            throw new Error('Recovery playlist write did not commit completely');
        }
        success = true;
    } catch (e) {
        try {
            plman.ClearPlaylist(playlistIndex);
            if (previous.Count > 0) plman.InsertPlaylistItems(playlistIndex, 0, previous, false);
        } catch (rollbackError) { }
    }
    internalRecoveryWrite = false;
    return success;
}

function migrateLegacyRecoveryPlaylist(ownedIndex) {
    var legacyIndex;
    var legacyHandles;
    var ownedHandles;

    if (recoveryMigrationComplete || ownedIndex < 0) return true;
    legacyIndex = findPlaylistByExactName(recoveryPlaylistName);
    if (legacyIndex >= 0 && legacyIndex !== ownedIndex) {
        legacyHandles = getPlaylistItemsSafe(legacyIndex);
        ownedHandles = getPlaylistItemsSafe(ownedIndex);
        if (!legacyHandles || !ownedHandles) return false;
        if (legacyHandles.Count > 0 && ownedHandles.Count === 0 &&
            !replaceRecoveryPlaylistHandles(ownedIndex, legacyHandles)) return false;
    }
    setRecoveryMigrationComplete(true);
    return true;
}

function queueText(handle) {
    var text = '';
    if (!handle) return 'Unknown artist - Unknown title';
    try { text = titleFormat.EvalWithMetadb(handle); }
    catch (e) { reportFailure('a queue row could not be formatted', e); }
    return text || 'Unknown artist - Unknown title';
}

function normalizedQueueLocation(value) {
    value = Number(value);
    return isFinite(value) && value >= 0 ? Math.floor(value) : -1;
}

function queueEntryFromPlaybackItem(item) {
    var handle = item ? item.Handle : null;
    if (!handle) return null;
    return {
        handle: handle,
        text: queueText(handle),
        playlistIndex: normalizedQueueLocation(item.PlaylistIndex),
        playlistItemIndex: normalizedQueueLocation(item.PlaylistItemIndex)
    };
}

function queueEntryFromHandle(handle) {
    if (!handle) return null;
    return {
        handle: handle,
        text: queueText(handle),
        playlistIndex: -1,
        playlistItemIndex: -1
    };
}

function readQueue() {
    var contents;
    var result = [];
    var i;
    var entry;

    try { contents = plman.GetPlaybackQueueContents() || []; } catch (e) { contents = []; }
    for (i = 0; i < contents.length; i++) {
        entry = queueEntryFromPlaybackItem(contents[i]);
        if (entry) result.push(entry);
    }
    return result;
}

function queueHandleList(entries) {
    var handles = [];
    var source = entries || queueEntries;
    var i;
    for (i = 0; i < source.length; i++) {
        if (source[i].handle) handles.push(source[i].handle);
    }
    return new FbMetadbHandleList(handles);
}

function addQueueEntry(entry, allowHandleFallback) {
    var playlistBacked = entry && entry.playlistIndex >= 0 && entry.playlistItemIndex >= 0;
    if (!entry || !entry.handle) throw new Error('Playback queue entry has no handle');
    if (playlistBacked && typeof plman.AddPlaylistItemToPlaybackQueue === 'function') {
        try {
            plman.AddPlaylistItemToPlaybackQueue(entry.playlistIndex, entry.playlistItemIndex);
            return;
        } catch (e) {
            if (!allowHandleFallback) throw e;
        }
    }
    plman.AddItemToPlaybackQueue(entry.handle);
}

function writeQueueEntries(entries, allowHandleFallback) {
    var i;
    for (i = 0; i < entries.length; i++) addQueueEntry(entries[i], allowHandleFallback);
}

function restorePlaybackQueueSnapshot(entries) {
    var success = true;
    var i;
    try { plman.FlushPlaybackQueue(); } catch (e) { return false; }
    for (i = 0; i < entries.length; i++) {
        try { addQueueEntry(entries[i], true); } catch (e2) { success = false; }
    }
    return success;
}

function replacePlaybackQueue(entries, rollbackEntries) {
    var rewriteStarted = false;
    var success = false;
    internalQueueWrite = true;
    try {
        plman.FlushPlaybackQueue();
        rewriteStarted = true;
        writeQueueEntries(entries, true);
        success = true;
    } catch (e) {
        if (rewriteStarted) restorePlaybackQueueSnapshot(rollbackEntries || []);
    }
    internalQueueWrite = false;
    return success;
}

function refreshQueue() {
    queueEntries = readQueue();
    if (selectedIndex >= queueEntries.length) selectedIndex = queueEntries.length - 1;
    if (!queueEntries.length) selectedIndex = -1;
    layoutClearButton();
    rebuildRowLayouts();
    clampScroll();
    cancelInternalDrag();
    clearPressed = false;
    refreshPointerState();
    window.Repaint(true);
}

function syncRecoveryPlaylist(entries) {
    var playlistIndex;
    var success;
    if (!initialised) return false;
    playlistIndex = recoveryPlaylistIndex(true);
    if (playlistIndex < 0) {
        setRecoverySyncPending(true);
        return false;
    }
    success = replaceRecoveryPlaylistHandles(playlistIndex, queueHandleList(entries || queueEntries));
    setRecoverySyncPending(!success);
    return success;
}

function restoreQueueFromRecovery() {
    var playlistIndex;
    var handles;
    var entries = [];
    var previous;
    var i;
    var entry;

    if (recoverySyncPending) return RESTORE_NONE;
    playlistIndex = recoveryPlaylistIndex(true);
    if (playlistIndex < 0) return RESTORE_NONE;
    handles = getPlaylistItemsSafe(playlistIndex);
    if (!handles || handles.Count <= 0) return RESTORE_NONE;

    for (i = 0; i < handles.Count; i++) {
        entry = queueEntryFromHandle(handles[i]);
        if (entry) entries.push(entry);
    }
    if (!entries.length) return RESTORE_NONE;
    previous = readQueue();
    return replacePlaybackQueue(entries, previous) ? RESTORE_OK : RESTORE_FAILED;
}

function rewriteQueue(entries, newSelectedIndex) {
    var previous = readQueue();
    if (!replacePlaybackQueue(entries, previous)) {
        refreshQueue();
        return false;
    }

    setRecoverySyncPending(true);
    selectedIndex = newSelectedIndex;
    refreshQueue();
    ensureSelectedVisible();
    syncRecoveryPlaylist();
    return true;
}

function dropInsertionIndex(y) {
    var i;
    var top = 0;
    var height;

    if (!queueEntries.length) return 0;
    if (y <= 0) return Math.max(0, Math.min(queueEntries.length, scrollOffset));
    if (y >= wh) return queueEntries.length;

    for (i = scrollOffset; i < queueEntries.length && top < wh; i++) {
        height = rowHeightAt(i);
        if (y < top + height) {
            return Math.max(0, Math.min(
                queueEntries.length,
                i + ((y - top) >= height / 2 ? 1 : 0)
            ));
        }
        top += height;
    }
    return Math.max(0, Math.min(queueEntries.length, i));
}

function reorderQueueEntry(sourceIndex, insertionIndex) {
    var entries;
    var moved;
    var target = insertionIndex;
    if (sourceIndex < 0 || sourceIndex >= queueEntries.length) return false;
    entries = queueEntries.slice(0);
    moved = entries.splice(sourceIndex, 1)[0];
    if (target > sourceIndex) target--;
    target = Math.max(0, Math.min(entries.length, target));
    if (target === sourceIndex) return false;
    entries.splice(target, 0, moved);
    return rewriteQueue(entries, target);
}

function cancelExternalDropImportTimer() {
    if (externalDropImportTimer !== null) {
        try { window.ClearTimeout(externalDropImportTimer); } catch (e) { }
        externalDropImportTimer = null;
    }
}

function cancelExternalDropExpiryTimer() {
    if (externalDropExpiryTimer !== null) {
        try { window.ClearTimeout(externalDropExpiryTimer); } catch (e) { }
        externalDropExpiryTimer = null;
    }
}

function cancelPendingExternalDrop(restoreSnapshot) {
    var pending = pendingExternalDrop;
    var restored = false;
    cancelExternalDropImportTimer();
    cancelExternalDropExpiryTimer();
    pendingExternalDrop = null;
    if (restoreSnapshot && pending && pending.recoverySnapshot && pending.playlistIndex >= 0) {
        restored = replaceRecoveryPlaylistHandles(pending.playlistIndex, pending.recoverySnapshot);
        setRecoverySyncPending(!restored);
    }
}

function expireExternalDrop(generation) {
    if (!pendingExternalDrop || pendingExternalDrop.generation !== generation) return;
    cancelPendingExternalDrop(true);
    window.Repaint();
}

function finishExternalDrop(generation) {
    var pending = pendingExternalDrop;
    var staged;
    var added = [];
    var entries;
    var i;
    var entry;
    var target;
    var recoverySnapshot;

    externalDropImportTimer = null;
    if (!pending || pending.generation !== generation) return;
    try { staged = plman.GetPlaylistItems(pending.playlistIndex); } catch (e) { staged = null; }
    if (!staged || staged.Count <= pending.base) {
        cancelPendingExternalDrop(true);
        return;
    }

    for (i = pending.base; i < staged.Count; i++) {
        entry = queueEntryFromHandle(staged[i]);
        if (entry) added.push(entry);
    }
    if (!added.length) {
        cancelPendingExternalDrop(true);
        return;
    }

    recoverySnapshot = pending.recoverySnapshot;
    entries = queueEntries.slice(0);
    target = Math.max(0, Math.min(entries.length, pending.insertionIndex));
    for (i = 0; i < added.length; i++) entries.splice(target + i, 0, added[i]);
    cancelPendingExternalDrop(false);
    if (!rewriteQueue(entries, target)) {
        setRecoverySyncPending(!replaceRecoveryPlaylistHandles(pending.playlistIndex, recoverySnapshot));
    }
}

function scheduleExternalDropImport() {
    var generation;
    if (!pendingExternalDrop) return;
    generation = pendingExternalDrop.generation;
    cancelExternalDropImportTimer();
    externalDropImportTimer = window.SetTimeout(function () {
        finishExternalDrop(generation);
    }, 0);
}

function scheduleRecoveryResync() {
    if (!initialised || unloading || pendingExternalDrop || recoveryResyncTimer !== null) return;
    recoveryResyncTimer = window.SetTimeout(function () {
        var current;
        recoveryResyncTimer = null;
        if (unloading || pendingExternalDrop) return;
        current = readQueue();
        setRecoverySyncPending(true);
        syncRecoveryPlaylist(current);
    }, 0);
}

function cancelRecoveryResyncTimer() {
    if (recoveryResyncTimer !== null) {
        try { window.ClearTimeout(recoveryResyncTimer); } catch (e) { }
        recoveryResyncTimer = null;
    }
}

function flushExternalQueueChange() {
    queueRefreshTimer = null;
    if (unloading) return;
    refreshQueue();
    syncRecoveryPlaylist();
}

function scheduleExternalQueueRefresh() {
    if (queueRefreshTimer !== null || unloading) return;
    queueRefreshTimer = window.SetTimeout(flushExternalQueueChange, 0);
}

function cancelQueueRefreshTimer() {
    if (queueRefreshTimer !== null) {
        try { window.ClearTimeout(queueRefreshTimer); } catch (e) { }
        queueRefreshTimer = null;
    }
}

function moveSelected(direction) {
    var target;
    var entries;
    var temporary;
    if (selectedIndex < 0 || selectedIndex >= queueEntries.length) return;
    target = selectedIndex + direction;
    if (target < 0 || target >= queueEntries.length) return;
    entries = queueEntries.slice(0);
    temporary = entries[selectedIndex];
    entries[selectedIndex] = entries[target];
    entries[target] = temporary;
    rewriteQueue(entries, target);
}

function removeSelected() {
    if (selectedIndex < 0 || selectedIndex >= queueEntries.length) return;
    internalQueueWrite = true;
    try { plman.RemoveItemFromPlaybackQueue(selectedIndex); } catch (e) {
        internalQueueWrite = false;
        return;
    }
    internalQueueWrite = false;
    setRecoverySyncPending(true);
    refreshQueue();
    syncRecoveryPlaylist();
}

function clearQueue() {
    if (!queueEntries.length) return;
    internalQueueWrite = true;
    try { plman.FlushPlaybackQueue(); } catch (e) {
        internalQueueWrite = false;
        return;
    }
    internalQueueWrite = false;
    setRecoverySyncPending(true);
    selectedIndex = -1;
    scrollOffset = 0;
    refreshQueue();
    syncRecoveryPlaylist();
}

function initialise() {
    var ownedIndex;
    var restoreStatus = RESTORE_NONE;
    startupTimer = null;
    if (unloading) return;

    queueEntries = readQueue();
    ownedIndex = recoveryPlaylistIndex(true);
    if (ownedIndex >= 0) migrateLegacyRecoveryPlaylist(ownedIndex);
    if (!queueEntries.length) restoreStatus = restoreQueueFromRecovery();

    queueEntries = readQueue();
    initialised = true;
    if (restoreStatus !== RESTORE_FAILED) syncRecoveryPlaylist();
    layout();
    refreshPointerState();
    window.Repaint(true);
    SharedAccentProtocol.request();
}


var ww = 0;
var wh = 0;
var rowHeight = 22;
var rowLineHeight = 16;
var rowVerticalPadding = 6;
var rowLayouts = [];
var scrollOffset = 0;
var hoveredRow = -1;
var clearHovered = false;
var clearPressed = false;
var clearRect = null;
var dragCandidateIndex = -1;
var dragSourceIndex = -1;
var dragTargetIndex = -1;
var dragStartX = 0;
var dragStartY = 0;
var internalDragActive = false;
var externalDragActive = false;
var mouseInside = false;
var mouseX = 0;
var mouseY = 0;
var DRAG_THRESHOLD = 4;
var MAX_ROW_TEXT_LINES = 2;

function queueTextWidth() {
    var leftPad = scale(6);
    var rightPad = scale(5);
    var textRight = ww - rightPad;

    // Keep the clear button out of the text column for every row. The reserve
    // is tiny, and doing it globally keeps wrapping stable while scrolling.
    if (clearRect && ww >= scale(80)) textRight = Math.min(textRight, clearRect.x - scale(3));
    return Math.max(1, textRight - leftPad);
}

function splitLongToken(token, maxWidth) {
    var pieces = [];
    var remaining = String(token || '');
    var lo;
    var hi;
    var mid;
    var best;

    while (remaining) {
        if (RivageUI.measureText(remaining, textFont) <= maxWidth) {
            pieces.push(remaining);
            break;
        }

        lo = 1;
        hi = remaining.length;
        best = 1;
        while (lo <= hi) {
            mid = Math.floor((lo + hi) / 2);
            if (RivageUI.measureText(remaining.slice(0, mid), textFont) <= maxWidth) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        pieces.push(remaining.slice(0, best));
        remaining = remaining.slice(best);
    }

    return pieces;
}

function wrapTextLines(text, maxWidth) {
    var source = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var words;
    var lines = [];
    var line = '';
    var i;
    var candidate;
    var parts;
    var p;

    if (!source) return [''];
    maxWidth = Math.max(1, Number(maxWidth) || 1);
    if (RivageUI.measureText(source, textFont) <= maxWidth) return [source];

    words = source.split(' ');
    for (i = 0; i < words.length; i++) {
        candidate = line ? line + ' ' + words[i] : words[i];
        if (RivageUI.measureText(candidate, textFont) <= maxWidth) {
            line = candidate;
            continue;
        }

        if (line) {
            lines.push(line);
            line = '';
        }

        if (RivageUI.measureText(words[i], textFont) <= maxWidth) {
            line = words[i];
            continue;
        }

        parts = splitLongToken(words[i], maxWidth);
        for (p = 0; p < parts.length; p++) {
            if (p === parts.length - 1) line = parts[p];
            else lines.push(parts[p]);
        }
    }

    if (line) lines.push(line);
    return lines.length ? lines : [source];
}

function ellipsizeWrappedLine(text, maxWidth) {
    var source = String(text || '').replace(/\s+$/g, '');
    var marker = '...';
    var lo;
    var hi;
    var mid;
    var best = '';
    var candidate;

    maxWidth = Math.max(1, Number(maxWidth) || 1);

    // On extremely narrow panels, shorten the marker itself until it fits.
    while (marker && RivageUI.measureText(marker, textFont) > maxWidth) {
        marker = marker.slice(0, -1);
    }
    if (!marker) return '';

    if (RivageUI.measureText(source + marker, textFont) <= maxWidth) {
        return source + marker;
    }

    lo = 0;
    hi = source.length;
    while (lo <= hi) {
        mid = Math.floor((lo + hi) / 2);
        candidate = source.slice(0, mid).replace(/\s+$/g, '') + marker;
        if (RivageUI.measureText(candidate, textFont) <= maxWidth) {
            best = candidate;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return best || marker;
}

function rebuildRowLayouts() {
    var width = queueTextWidth();
    var i;
    var wrappedLines;
    var lines;
    var truncated;

    rowLayouts = [];
    rowLineHeight = Math.max(scale(12), fontPx(BODY_FONT_PT) + scale(3));
    rowVerticalPadding = Math.max(scale(4), scale(6));
    rowHeight = Math.max(scale(18), rowLineHeight + rowVerticalPadding);

    for (i = 0; i < queueEntries.length; i++) {
        wrappedLines = wrapTextLines(queueEntries[i].text, width);
        truncated = wrappedLines.length > MAX_ROW_TEXT_LINES;
        lines = truncated ? wrappedLines.slice(0, MAX_ROW_TEXT_LINES) : wrappedLines;

        // Keep queue rows compact: the second line is the hard visual limit.
        // The native tooltip still exposes the complete title on hover.
        if (truncated && lines.length) {
            lines[lines.length - 1] = ellipsizeWrappedLine(lines[lines.length - 1], width);
        }

        rowLayouts.push({
            lines: lines,
            truncated: truncated,
            height: Math.max(rowHeight, lines.length * rowLineHeight + rowVerticalPadding)
        });
    }
}

function rowHeightAt(index) {
    if (index >= 0 && index < rowLayouts.length && rowLayouts[index]) {
        return Math.max(1, Number(rowLayouts[index].height) || rowHeight);
    }
    return Math.max(1, rowHeight);
}

function rowTopAt(index) {
    var y = 0;
    var i;
    for (i = scrollOffset; i < index && i < queueEntries.length; i++) y += rowHeightAt(i);
    return y;
}

function insertionY(index) {
    if (index <= scrollOffset) return 0;
    return rowTopAt(Math.min(index, queueEntries.length));
}

function maxScrollOffset() {
    var used = 0;
    var i;
    var height;

    if (!queueEntries.length) return 0;
    for (i = queueEntries.length - 1; i >= 0; i--) {
        height = rowHeightAt(i);
        if (used > 0 && used + height > wh) return Math.min(queueEntries.length - 1, i + 1);
        used += height;
        if (used >= wh) return i;
    }
    return 0;
}

function clampScroll() {
    scrollOffset = Math.max(0, Math.min(maxScrollOffset(), scrollOffset));
}

function ensureSelectedVisible() {
    var top;
    var bottom;
    var used;
    var start;

    if (selectedIndex < 0 || selectedIndex >= queueEntries.length || wh <= 0) return;
    if (selectedIndex < scrollOffset) {
        scrollOffset = selectedIndex;
        clampScroll();
        return;
    }

    top = rowTopAt(selectedIndex);
    bottom = top + rowHeightAt(selectedIndex);
    if (bottom <= wh) return;

    start = selectedIndex;
    used = rowHeightAt(selectedIndex);
    while (start > 0 && used + rowHeightAt(start - 1) <= wh) {
        start--;
        used += rowHeightAt(start);
    }
    scrollOffset = start;
    clampScroll();
}

function layoutClearButton() {
    var margin = scale(RivageUI.metrics.spacing.tiny);
    var side;

    clearRect = null;
    if (!queueEntries.length || ww <= 0 || wh <= 0) return;

    side = Math.min(scale(CLEAR_BUTTON_SIZE), Math.max(0, wh - margin * 2));
    side = Math.min(side, Math.max(0, ww - margin * 2));
    if (side < scale(CLEAR_BUTTON_MIN_SIZE)) return;

    clearRect = RivageUI.rect(
        ww - margin - side,
        wh - margin - side,
        side,
        side
    );
}

function layout() {
    ww = Math.max(0, window.Width);
    wh = Math.max(0, window.Height);

    refreshPanelDpi();
    updateAdaptiveFontScale(ww, wh);
    rebuildFonts(false);
    layoutClearButton();
    rebuildRowLayouts();
    clampScroll();
}

function rowAt(x, y) {
    var i;
    var top = 0;
    var height;

    if (x < 0 || y < 0 || x >= ww || y >= wh || rowHeight <= 0) return -1;
    if (RivageUI.pointInRect(x, y, clearRect)) return -1;

    for (i = scrollOffset; i < queueEntries.length && top < wh; i++) {
        height = rowHeightAt(i);
        if (y >= top && y < top + height) return i;
        top += height;
    }
    return -1;
}

function cancelInternalDrag() {
    dragCandidateIndex = -1;
    dragSourceIndex = -1;
    if (!externalDragActive) dragTargetIndex = -1;
    internalDragActive = false;
}

function refreshPointerState() {
    var nextClear = false;
    var nextRow = -1;
    var changed;

    if (mouseInside && !internalDragActive && !externalDragActive) {
        nextClear = RivageUI.pointInRect(mouseX, mouseY, clearRect);
        nextRow = nextClear ? -1 : rowAt(mouseX, mouseY);
    }
    changed = nextClear !== clearHovered || nextRow !== hoveredRow;
    clearHovered = nextClear;
    hoveredRow = nextRow;
    try { window.SetCursor(nextClear ? IDC_HAND : IDC_ARROW); } catch (e) { }
    setTooltip(nextClear ? '' : queueRowTooltipText(nextRow));
    return changed;
}


var TOOLTIP_DELAY_MS = 500;
var TOOLTIP_MAX_WIDTH_PT = 640;
var tooltipTimer = null;
var tooltipText = '';
var tooltipPendingText = '';
var nativeTooltip = null;

function configureNativeTooltip() {
    try {
        nativeTooltip = window.Tooltip;
    } catch (e) {
        nativeTooltip = null;
    }

    if (!nativeTooltip) return;
    try { nativeTooltip.SetFont(hostFontName, fontPx(BODY_FONT_PT), 0); } catch (e2) { }
    try { nativeTooltip.SetMaxWidth(scale(TOOLTIP_MAX_WIDTH_PT)); } catch (e3) { }
}

function cancelTooltipTimer() {
    if (tooltipTimer !== null) {
        try { window.ClearTimeout(tooltipTimer); } catch (e) { }
        tooltipTimer = null;
    }
    tooltipPendingText = '';
}

function deactivateNativeTooltip() {
    if (!nativeTooltip) return;
    try { nativeTooltip.Deactivate(); } catch (e) { }
    try { nativeTooltip.Text = ''; } catch (e2) { }
}

function tooltipDisplayText(text) {
    // Insert explicit line breaks at a screen-friendly width. FbTooltip accepts
    // multi-line text and, unlike an in-panel painter, Windows can place the
    // resulting tooltip outside this panel's client rectangle.
    return wrapTextLines(text, scale(TOOLTIP_MAX_WIDTH_PT)).join('\n');
}

function setTooltip(text) {
    text = String(text || '');

    if (!text) {
        cancelTooltipTimer();
        if (tooltipText) deactivateNativeTooltip();
        tooltipText = '';
        return;
    }

    if (text === tooltipText || text === tooltipPendingText) return;

    cancelTooltipTimer();
    if (tooltipText) deactivateNativeTooltip();
    tooltipText = '';
    tooltipPendingText = text;

    tooltipTimer = window.SetTimeout(function () {
        var displayText;
        tooltipTimer = null;
        if (tooltipPendingText !== text) return;
        tooltipPendingText = '';
        configureNativeTooltip();
        if (!nativeTooltip) return;

        displayText = tooltipDisplayText(text);
        try {
            nativeTooltip.Text = displayText;
            nativeTooltip.Activate();
            tooltipText = text;
        } catch (e) {
            tooltipText = '';
        }
    }, TOOLTIP_DELAY_MS);
}

function queueRowTooltipText(index) {
    var layoutInfo;
    var top;

    if (index < 0 || index >= queueEntries.length) return '';
    layoutInfo = rowLayouts[index];
    if (!layoutInfo) return '';

    top = rowTopAt(index);
    // Wrapped or two-line-truncated rows benefit from a full-title hover view,
    // and a row taller than the remaining viewport also needs the tooltip.
    if (layoutInfo.truncated || layoutInfo.lines.length > 1 || top + layoutInfo.height > wh) {
        return queueEntries[index].text || '';
    }
    return '';
}


function paintRows(gr) {
    var accent = currentAccent();
    var i;
    var y = 0;
    var height;
    var selected;
    var hovered;
    var background;
    var leftPad = scale(6);
    var textWidth = queueTextWidth();
    var layoutInfo;
    var lines;
    var textY;
    var lineIndex;
    var textColour;

    for (i = scrollOffset; i < queueEntries.length && y < wh; i++) {
        height = rowHeightAt(i);
        selected = i === selectedIndex;
        hovered = i === hoveredRow;
        background = theme.background;

        if (selected) background = RivageUI.mix(theme.background, accent, 0.16);
        else if (hovered) background = theme.rowHover;
        else if ((i & 1) === 1) background = theme.card;

        if (background !== theme.background) {
            gr.FillSolidRect(0, y, ww, height, background);
        }

        if (selected) {
            gr.FillSolidRect(0, y, scale(2), height, accent);
        }

        layoutInfo = rowLayouts[i] || { lines: [queueEntries[i].text] };
        lines = layoutInfo.lines || [queueEntries[i].text];
        textY = y + Math.floor(rowVerticalPadding / 2);
        textColour = selected || hovered ? theme.textPrimary : theme.textMuted;

        for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            gr.GdiDrawText(
                lines[lineIndex],
                textFont,
                textColour,
                leftPad,
                textY + lineIndex * rowLineHeight,
                textWidth,
                rowLineHeight,
                RivageUI.textFlags.left
            );
        }

        if (y + height < wh) {
            gr.FillSolidRect(0, y + height - 1, ww, 1, theme.stroke);
        }
        y += height;
    }
}

function paintClearButton(gr) {
    var font;

    if (!clearRect) return;

    font = getIconFont(Math.max(8, clearRect.h - scale(5)));
    painter.iconButton(
        gr,
        clearRect,
        {
            enabled: true,
            hovered: clearHovered,
            pressed: clearPressed
        },
        {
            glyph: CLEAR_GLYPH,
            font: font,
            accent: currentAccent(),
            base: theme.card,
            background: false,
            border: false,
            radius: RivageUI.metrics.radius.button
        }
    );
}

function paintDropIndicator(gr) {
    var target = internalDragActive ? dragTargetIndex : (externalDragActive ? dragTargetIndex : -1);
    var y;
    if (target < 0 || ww <= 0 || wh <= 0) return;
    y = insertionY(target);
    y = Math.max(0, Math.min(wh - scale(2), y));
    gr.FillSolidRect(0, y, ww, Math.max(1, scale(2)), currentAccent());
}

function on_paint(gr) {
    gr.FillSolidRect(0, 0, ww, wh, theme.background);

    if (!queueEntries.length) {
        gr.GdiDrawText(
            'Playback queue is empty',
            emptyFont,
            theme.textMuted,
            scale(4),
            0,
            Math.max(0, ww - scale(8)),
            wh,
            RivageUI.textFlags.centeredEllipsis
        );
    } else {
        paintRows(gr);
        paintClearButton(gr);
    }

    paintDropIndicator(gr);
}


function on_mouse_move(x, y) {
    var changed;
    mouseInside = true;
    mouseX = x;
    mouseY = y;

    if (dragCandidateIndex >= 0 && !clearPressed) {
        if (!internalDragActive && (Math.abs(x - dragStartX) >= scale(DRAG_THRESHOLD) || Math.abs(y - dragStartY) >= scale(DRAG_THRESHOLD))) {
            internalDragActive = true;
            dragSourceIndex = dragCandidateIndex;
            setTooltip('');
        }
        if (internalDragActive) {
            dragTargetIndex = dropInsertionIndex(y);
            hoveredRow = -1;
            clearHovered = false;
            window.SetCursor(IDC_HAND);
            window.Repaint();
            return;
        }
    }

    changed = refreshPointerState();
    if (changed) window.Repaint();
}

function on_mouse_leave() {
    mouseInside = false;
    hoveredRow = -1;
    clearHovered = false;
    clearPressed = false;
    if (!internalDragActive) dragCandidateIndex = -1;
    window.SetCursor(IDC_ARROW);
    setTooltip('');
    window.Repaint();
}

function on_mouse_lbtn_down(x, y) {
    mouseInside = true;
    mouseX = x;
    mouseY = y;
    if (RivageUI.pointInRect(x, y, clearRect)) {
        clearPressed = true;
        window.Repaint();
        return;
    }

    selectedIndex = rowAt(x, y);
    dragCandidateIndex = selectedIndex;
    dragSourceIndex = -1;
    dragTargetIndex = -1;
    internalDragActive = false;
    dragStartX = x;
    dragStartY = y;
    window.Repaint();
}

function on_mouse_lbtn_up(x, y) {
    var activateClear = clearPressed && RivageUI.pointInRect(x, y, clearRect);
    var source = dragSourceIndex;
    var target = dragTargetIndex;
    var wasDragging = internalDragActive;

    mouseInside = true;
    mouseX = x;
    mouseY = y;
    clearPressed = false;
    cancelInternalDrag();

    if (activateClear) clearQueue();
    else if (wasDragging && source >= 0 && target >= 0) {
        if (!reorderQueueEntry(source, target)) {
            refreshPointerState();
            window.Repaint();
        }
    } else {
        refreshPointerState();
        window.Repaint();
    }
}

function on_mouse_wheel(step) {
    if (!queueEntries.length || maxScrollOffset() <= 0) return;
    scrollOffset += step > 0 ? -1 : 1;
    clampScroll();
    refreshPointerState();
    window.Repaint();
}

// Deletes the shared recovery playlist right now. While recoveryEnabled stays
// on, the very next playlist-topology callback recreates it (by design, the
// same as deleting it from the host's own playlist manager); turn recovery
// off first for the deletion to stick.
function deleteOwnedRecoveryPlaylistNow() {
    var index = findOwnedRecoveryPlaylist();
    if (index < 0) return;
    try { plman.RemovePlaylistSwitch(index); }
    catch (e) { reportFailure('the recovery playlist could not be deleted', e); }
}

function on_mouse_rbtn_up(x, y) {
    var index = rowAt(x, y);
    var menu;
    var command;
    var ownedRecoveryIndex;

    if (index >= 0) {
        selectedIndex = index;
        window.Repaint();
    }

    menu = window.CreatePopupMenu();
    if (index >= 0) {
        menu.AppendMenuItem(MF_STRING | (index <= 0 ? MF_GRAYED : 0), 1, 'Move up');
        menu.AppendMenuItem(MF_STRING | (index >= queueEntries.length - 1 ? MF_GRAYED : 0), 2, 'Move down');
        menu.AppendMenuSeparator();
        menu.AppendMenuItem(MF_STRING, 3, 'Remove');
        menu.AppendMenuSeparator();
    }
    ownedRecoveryIndex = findOwnedRecoveryPlaylist();
    menu.AppendMenuItem(MF_STRING | (recoveryEnabled ? MF_CHECKED : 0), 4, 'Maintain queue recovery playlist');
    menu.AppendMenuItem(MF_STRING | (ownedRecoveryIndex < 0 ? MF_GRAYED : 0), 5, 'Delete recovery playlist');

    command = menu.TrackPopupMenu(x, y);
    if (command === 1) moveSelected(-1);
    else if (command === 2) moveSelected(1);
    else if (command === 3) removeSelected();
    else if (command === 4) setRecoveryEnabled(!recoveryEnabled);
    else if (command === 5) deleteOwnedRecoveryPlaylistNow();

    return true;
}


function acceptExternalDrop(action, y) {
    if (!action) return;
    dragTargetIndex = dropInsertionIndex(y);
    externalDragActive = true;
    action.Effect = DROPEFFECT_COPY;
    try { action.Text = 'Add to playback queue'; } catch (e) { }
    window.Repaint();
}

function on_drag_enter(action, x, y, mask) {
    acceptExternalDrop(action, y);
}

function on_drag_over(action, x, y, mask) {
    acceptExternalDrop(action, y);
}

function on_drag_leave() {
    externalDragActive = false;
    if (!internalDragActive) dragTargetIndex = -1;
    window.Repaint();
}

function on_drag_drop(action, x, y, mask) {
    var playlistIndex;
    var base;
    var insertion;
    var snapshot;
    var generation;

    externalDragActive = false;
    dragTargetIndex = -1;
    if (!action) return;

    // The managed recovery playlist doubles as the host drop target. Establish
    // an exact queue snapshot first so a failed/abandoned drop can be rolled back.
    cancelPendingExternalDrop(true);
    cancelQueueRefreshTimer();
    refreshQueue();
    insertion = dropInsertionIndex(y);
    if (!syncRecoveryPlaylist()) {
        action.Effect = DROPEFFECT_NONE;
        return;
    }
    playlistIndex = recoveryPlaylistIndex(false);
    snapshot = queueHandleList(queueEntries);
    if (playlistIndex < 0) {
        action.Effect = DROPEFFECT_NONE;
        return;
    }

    try { base = plman.PlaylistItemCount(playlistIndex); } catch (e) { base = -1; }
    if (base < 0 || base !== snapshot.Count) {
        action.Effect = DROPEFFECT_NONE;
        return;
    }

    generation = ++externalDropGeneration;
    pendingExternalDrop = {
        generation: generation,
        playlistIndex: playlistIndex,
        base: base,
        insertionIndex: insertion,
        recoverySnapshot: cloneHandleList(snapshot)
    };
    setRecoverySyncPending(true);
    externalDropExpiryTimer = window.SetTimeout(function () {
        expireExternalDrop(generation);
    }, EXTERNAL_DROP_TIMEOUT_MS);
    action.Playlist = playlistIndex;
    action.Base = base;
    action.ToSelect = false;
    action.Effect = DROPEFFECT_COPY;
    try { action.Text = 'Add to playback queue'; } catch (e2) { }
    window.Repaint();
}

function on_playlist_items_added(playlistIndex) {
    if (internalRecoveryWrite) return;
    if (pendingExternalDrop && Number(playlistIndex) === Number(pendingExternalDrop.playlistIndex)) {
        scheduleExternalDropImport();
        return;
    }
    if (isOwnedRecoveryPlaylistIndex(playlistIndex)) {
        setRecoverySyncPending(true);
        scheduleRecoveryResync();
    }
}

function on_playlist_items_removed(playlistIndex, newCount) {
    if (internalRecoveryWrite) return;
    if (isOwnedRecoveryPlaylistIndex(playlistIndex)) {
        if (pendingExternalDrop) cancelPendingExternalDrop(false);
        setRecoverySyncPending(true);
        scheduleRecoveryResync();
    }
}

function on_playlist_items_reordered(playlistIndex) {
    if (internalRecoveryWrite) return;
    if (isOwnedRecoveryPlaylistIndex(playlistIndex)) {
        if (pendingExternalDrop) cancelPendingExternalDrop(false);
        setRecoverySyncPending(true);
        scheduleRecoveryResync();
    }
}

function on_playlists_changed() {
    if (!initialised || unloading) return;
    if (pendingExternalDrop) cancelPendingExternalDrop(false);
    setRecoverySyncPending(true);
    scheduleRecoveryResync();
}

function on_size(width, height) {
    layout();
    refreshPointerState();
}

function on_colours_changed() {
    refreshVisualResources(false);
    window.Repaint(true);
}

function on_playback_queue_changed(origin) {
    if (internalQueueWrite || unloading) return;
    cancelInternalDrag();
    if (pendingExternalDrop) cancelPendingExternalDrop(false);
    clearPressed = false;
    hoveredRow = -1;
    clearHovered = false;
    setTooltip('');
    window.SetCursor(IDC_ARROW);
    setRecoverySyncPending(true);
    scheduleExternalQueueRefresh();
}

function on_metadb_changed(handleList, fromHook) {
    var changed = false;
    var i;
    if (!handleList || !queueEntries.length) return;
    for (i = 0; i < queueEntries.length; i++) {
        try {
            if (typeof handleList.Find === 'function' && handleList.Find(queueEntries[i].handle) < 0) continue;
        } catch (e) { }
        queueEntries[i].text = queueText(queueEntries[i].handle);
        changed = true;
    }
    if (!changed) return;
    rebuildRowLayouts();
    clampScroll();
    refreshPointerState();
    window.Repaint(true);
}

function on_notify_data(name, info) {
    if (SharedThemeProtocol.consume(name, info)) return;
    if (name === SHARED_ALBUM_ACCENT_UPDATE && SharedAccentProtocol.isColour(info)) {
        var nextAccent = SharedAccentProtocol.opaque(info);
        if (nextAccent === sharedAccent) return;
        sharedAccent = nextAccent;
        refreshTheme();
        window.Repaint(true);
    }
}

function on_script_unload() {
    unloading = true;
    if (startupTimer !== null) {
        try { window.ClearTimeout(startupTimer); } catch (e) { }
        startupTimer = null;
    }
    cancelTooltipTimer();
    deactivateNativeTooltip();
    cancelExternalDropImportTimer();
    cancelExternalDropExpiryTimer();
    cancelQueueRefreshTimer();
    cancelRecoveryResyncTimer();
    cancelPendingExternalDrop(false);
    if (!initialised) return;
    queueEntries = readQueue();
    setRecoverySyncPending(true);
    syncRecoveryPlaylist(queueEntries);
}

refreshPanelDpi();
refreshVisualResources(true);
layout();
startupTimer = window.SetTimeout(initialise, 0);