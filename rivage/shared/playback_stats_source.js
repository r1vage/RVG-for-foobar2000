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

        function detectPlaycount2003() {
            try {
                return typeof utils !== 'undefined' && !!utils.CheckComponent('foo_playcount_2003', true);
            } catch (e) {
                return false;
            }
        }

        var playcount2003Available = detectPlaycount2003();

        function isUsableSource(value) {
            return value === SOURCE_FOO_PLAYCOUNT ||
                (value === SOURCE_PLAYCOUNT_2003 && playcount2003Available);
        }

        function normaliseStoredSource(value) {
            return isUsableSource(value) ? value : SOURCE_FOO_PLAYCOUNT;
        }

        var storedSource = window.GetProperty(PROPERTY_PREFIX + 'Data source', SOURCE_FOO_PLAYCOUNT);
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
            if (playcount2003Available) {
                choices.push({
                    value: SOURCE_PLAYCOUNT_2003,
                    label: 'Playcount 2003 (foo_playcount_2003)'
                });
            }

            var entry = {
                id: 'statsDataSource',
                label: 'Playback statistics source',
                type: 'choice',
                value: dataSource,
                choiceValueType: 'string',
                choices: choices
            };
            entry.hint = playcount2003Available
                ? 'Playcount 2003 reads the %2003_*% fields.'
                : 'Install foo_playcount_2003 to enable Playcount 2003.';
            return [entry];
        }

        function broadcast() {
            try { window.NotifyOthers(UPDATE, { dataSource: dataSource }); } catch (e) { reportFailure('the playback stats update could not be broadcast', e); }
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
                    applyLocally('statsDataSource', info.dataSource);
                }
                return true;
            }
            return false;
        }

        return {
            isPlaycount2003: function () {
                return dataSource === SOURCE_PLAYCOUNT_2003;
            },
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
