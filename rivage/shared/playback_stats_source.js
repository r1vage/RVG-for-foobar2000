'use strict';

// One global playback-statistics backend. tab-switcher-right.js is the sync
// authority; consumers request/adopt state, and repeated includes preserve it.
if (typeof PlaybackStatsSource === 'undefined') {
    var PlaybackStatsSource = (function () {
        var PROPERTY_PREFIX = 'Rivage Playback Stats Source.';
        var REQUEST = 'RIVAGE.PLAYBACK_STATS_SOURCE.REQUEST.V2';
        var UPDATE = 'RIVAGE.PLAYBACK_STATS_SOURCE.UPDATE.V2';
        var SOURCE_FOO_PLAYCOUNT = 'foo_playcount';
        var SOURCE_PLAYCOUNT_2003 = 'playcount2003';
        var SOURCE_ULTIMATE = 'ultimate_playcount';

        // Narrow failure reporting. The empty catches here guard broadcasts,
        // retry-timer schedules, or consumer callbacks - each a real failure
        // with no other trace. Repeats are counted and re-logged only at
        // powers of ten.
        var reportedFailures = {};
        function reportFailure(what, err) {
            var message = '[PlaybackStatsSource] ' + what +
                (err === undefined || err === null ? '' : ': ' + err);
            var seen = (reportedFailures[message] || 0) + 1;
            reportedFailures[message] = seen;
            if (seen !== 1 && seen !== 10 && seen !== 100 && seen !== 1000) return;
            try { console.log(seen === 1 ? message : message + ' (x' + seen + ')'); } catch (e) { }
        }

        function hasComponent(name) {
            try {
                return typeof utils !== 'undefined' && !!utils.CheckComponent(name, true);
            } catch (e) {
                return false;
            }
        }

        // Ultimate Playcount works like Playcount 2003 (same field names, _ago forms,
        // Rating menu and loved flag) but under the upc_ prefix instead of 2003_.
        var hasUltimate = hasComponent('foo_ultimate_playcount');
        var has2003 = hasComponent('foo_playcount_2003');

        // Titleformat fields per backend, so no panel hard-codes them.
        function prefixedFields(prefix) {
            return {
                plays: '%' + prefix + 'playcount%', first: '%' + prefix + 'first_played%',
                last: '%' + prefix + 'last_played%', added: '%' + prefix + 'added%', rating: '%' + prefix + 'rating%'
            };
        }
        var FIELDS = {};
        FIELDS[SOURCE_FOO_PLAYCOUNT] = {
            plays: '%play_count%', first: '%first_played%', last: '%last_played%',
            added: '%added%', rating: '%rating%'
        };
        FIELDS[SOURCE_PLAYCOUNT_2003] = prefixedFields('2003_');

        // Ultimate Playcount's field prefix is its own preference, which scripts can't read.
        var DEFAULT_UPC_PREFIX = 'upc_';
        function normalisePrefix(value) {
            value = String(value === undefined || value === null ? '' : value).replace(/^\s+|\s+$/g, '');
            return /^\w+$/.test(value) ? value : DEFAULT_UPC_PREFIX;
        }
        var storedPrefix = window.GetProperty(PROPERTY_PREFIX + 'Ultimate Playcount prefix', DEFAULT_UPC_PREFIX);
        var upcPrefix = normalisePrefix(storedPrefix);
        if (upcPrefix !== storedPrefix) window.SetProperty(PROPERTY_PREFIX + 'Ultimate Playcount prefix', upcPrefix);
        FIELDS[SOURCE_ULTIMATE] = prefixedFields(upcPrefix);

        function isUsableSource(value) {
            return value === SOURCE_FOO_PLAYCOUNT ||
                (value === SOURCE_PLAYCOUNT_2003 && has2003) ||
                (value === SOURCE_ULTIMATE && hasUltimate);
        }

        // First run (or a removed component): Ultimate Playcount, then Playcount 2003
        // when foo_playcount is missing, else foo_playcount.
        var defaultSource = hasUltimate ? SOURCE_ULTIMATE
            : (has2003 && !hasComponent('foo_playcount') ? SOURCE_PLAYCOUNT_2003 : SOURCE_FOO_PLAYCOUNT);

        function normaliseStoredSource(value) {
            return isUsableSource(value) ? value : defaultSource;
        }
        var storedSource = window.GetProperty(PROPERTY_PREFIX + 'Data source', defaultSource);
        var dataSource = normaliseStoredSource(storedSource);
        if (dataSource !== storedSource) {
            window.SetProperty(PROPERTY_PREFIX + 'Data source', dataSource);
        }
        var changeListeners = [];

        function notifyChangeListeners() {
            for (var i = 0; i < changeListeners.length; i++) {
                try { changeListeners[i](); } catch (e) { reportFailure('a playback-stats change listener failed', e); }
            }
        }

        function applyLocally(id, value) {
            if (id === 'statsUpcPrefix') {
                value = normalisePrefix(value);
                if (value === upcPrefix) return true;
                window.SetProperty(PROPERTY_PREFIX + 'Ultimate Playcount prefix', value);
                upcPrefix = value;
                FIELDS[SOURCE_ULTIMATE] = prefixedFields(upcPrefix);
                if (dataSource === SOURCE_ULTIMATE) notifyChangeListeners();
                return true;
            }
            if (id !== 'statsDataSource') return false;
            if (!isUsableSource(value) || value === dataSource) return true;

            window.SetProperty(PROPERTY_PREFIX + 'Data source', value);
            dataSource = value;
            notifyChangeListeners();
            return true;
        }

        function getSchemaEntries() {
            var choices = [
                { value: SOURCE_FOO_PLAYCOUNT, label: 'Playback Statistics (foo_playcount)' }
            ];
            if (hasUltimate) {
                choices.push({ value: SOURCE_ULTIMATE, label: 'Ultimate Playcount (foo_ultimate_playcount)' });
            }
            if (has2003) {
                choices.push({ value: SOURCE_PLAYCOUNT_2003, label: 'Playcount 2003 (foo_playcount_2003)' });
            }

            var entry = {
                id: 'statsDataSource',
                label: 'Playback statistics source',
                type: 'choice',
                value: dataSource,
                choiceValueType: 'string',
                choices: choices
            };
            entry.hint = hasUltimate || has2003
                ? 'Ultimate Playcount reads the %' + upcPrefix + '*% fields; Playcount 2003 reads %2003_*%.'
                : 'Install foo_ultimate_playcount or foo_playcount_2003 for more choices.';
            if (!hasUltimate) return [entry];
            return [entry, {
                id: 'statsUpcPrefix',
                label: 'Ultimate Playcount field prefix',
                type: 'string',
                value: upcPrefix,
                hint: 'Same as Preferences > Tools > Ultimate Playcount > Field prefix. Letters, digits and _ only.'
            }];
        }

        // Field prefix of the Playcount 2003-style component: the active one, or
        // the installed one while foo_playcount is selected.
        function prefix2003() {
            if (dataSource === SOURCE_ULTIMATE) return upcPrefix;
            if (dataSource === SOURCE_PLAYCOUNT_2003) return '2003_';
            return hasUltimate ? upcPrefix : '2003_';
        }

        var tf2003Cache = {};
        // Compiled %<prefix><name>%, e.g. tf2003('first_played_ago'); follows source switches.
        function tf2003(name) {
            var key = prefix2003() + name;
            return tf2003Cache[key] || (tf2003Cache[key] = fb.TitleFormat('%' + key + '%'));
        }

        function name2003() {
            return dataSource === SOURCE_ULTIMATE ? 'Ultimate Playcount' : 'Playcount 2003';
        }

        // Runs "<component>/Rating/Set Rating to N" (or ".../Rating/Clear"); false if it didn't run.
        function setRating2003(handles, value) {
            return !!fb.RunContextCommandWithMetadb(
                name2003() + '/Rating/' + (value ? 'Set Rating to ' + value : 'Clear'), handles, 8);
        }

        function isPlaycount2003() {
            return dataSource === SOURCE_PLAYCOUNT_2003 || dataSource === SOURCE_ULTIMATE;
        }

        function broadcast() {
            try { window.NotifyOthers(UPDATE, { dataSource: dataSource, upcPrefix: upcPrefix }); } catch (e) { reportFailure('the playback stats update could not be broadcast', e); }
        }

        function requestSync() {
            try { window.NotifyOthers(REQUEST, 0); } catch (e) { reportFailure('the playback stats could not be requested', e); }
        }

        // Only the Global-settings owner answers REQUEST; consumers never publish stale state.
        function onNotifyData(name, info, isAuthority) {
            if (name === REQUEST) {
                if (isAuthority) broadcast();
                return true;
            }
            if (name === UPDATE) {
                if (!isAuthority && info && typeof info === 'object') {
                    if (info.upcPrefix !== undefined) applyLocally('statsUpcPrefix', info.upcPrefix);
                    applyLocally('statsDataSource', info.dataSource);
                }
                return true;
            }
            return false;
        }

        return {
            // True for Playcount 2003 and Ultimate Playcount: same fields bar the prefix,
            // the _ago date forms, the Rating menu and a loved flag.
            isPlaycount2003: isPlaycount2003,
            // 'Ultimate Playcount' or 'Playcount 2003'.
            name2003: name2003,
            prefix2003: prefix2003,
            tf2003: tf2003,
            setRating2003: setRating2003,
            // { plays, first, last, added, rating } titleformat strings for the active
            // backend. A copy, so callers may keep it; compare it to spot a switch.
            // history: the other places a play can be recorded, for "smart" views
            // that take the highest count and the latest date (as the Playback
            // statistics panel's Smart play history does). Enhanced Playback
            // Statistics' own last-played is left out under Playcount 2003 / Ultimate Playcount.
            // lastfm: { plays, first, last } scrobble fields - Ultimate Playcount's own
            // under it, else Enhanced Playback Statistics'.
            // source changes with Ultimate Playcount's prefix too, so a prefix edit reads as a switch.
            fields: function () {
                var f = FIELDS[dataSource] || FIELDS[SOURCE_FOO_PLAYCOUNT];
                var ultimate = dataSource === SOURCE_ULTIMATE;
                var lastfm = ultimate ? {
                    plays: '%' + upcPrefix + 'lastfm_playcount%',
                    first: '%' + upcPrefix + 'lastfm_first_played%',
                    last: '%' + upcPrefix + 'lastfm_last_played%'
                } : {
                    plays: '$if2(%lastfm_play_count%,$if2(%lastfm_playcount%,$if2(%scrobbled%,%last.fm scrobbled%)))',
                    first: '%lastfm_first_played%',
                    last: '%lastfm_last_played%'
                };
                return {
                    source: ultimate ? dataSource + ':' + upcPrefix : dataSource,
                    plays: f.plays, first: f.first, last: f.last, added: f.added, rating: f.rating,
                    lastfm: lastfm,
                    history: {
                        plays: lastfm.plays,
                        last: ultimate ? lastfm.last : '$if2(%lastfm_last_played%,$if2(%last_scrobble%,%last.fm last scrobble%))',
                        enhancedLast: isPlaycount2003() ? '' : '%last_played_enhanced%'
                    }
                };
            },
            isUltimate: function () { return dataSource === SOURCE_ULTIMATE; },
            onChange: function (fn) {
                if (typeof fn === 'function') changeListeners.push(fn);
            },
            getSchemaEntries: getSchemaEntries,
            applySetting: applyLocally,
            broadcast: broadcast,
            requestSync: requestSync,
            onNotifyData: onNotifyData
        };
    })();
}
