'use strict';

// Health check: which components, fonts and settings RVG relies on are present,
// what each one is used for, and where to get what is missing. Shown as the
// Health sub-tab of Global settings (tab-switcher-right.js), which also opens it
// once on the first start of a version where something is missing.
//
// run() is cheap but not free (a few CheckComponent/CheckFont calls), so the
// caller caches its result and re-runs it only on request.
if (typeof RivageHealth === 'undefined') {
    var RivageHealth = (function () {
        var ACTION_PREFIX = 'health.';
        var RECHECK_ID = ACTION_PREFIX + 'recheck';
        var MIN_JSPLITTER = [4, 2, 1];

        // level: required - parts of RVG fail without it; recommended - a feature or a
        // panel of the shipped layout needs it; optional - nice to have.
        var COMPONENTS = [
            { id: 'columns', dll: ['foo_ui_columns'], label: 'Columns UI', level: 'required',
              uses: 'RVG is a Columns UI layout.',
              url: 'https://www.foobar2000.org/components/view/foo_ui_columns' },
            { id: 'enhanced', dll: ['foo_enhanced_playcount'], label: 'Enhanced Playback Statistics', level: 'recommended',
              uses: 'Rewind, Playback timeline, and first/last-played dates.',
              url: 'https://www.foobar2000.org/components/view/foo_enhanced_playcount' },
            { id: 'playcount', dll: ['foo_playcount', 'foo_playcount_2003'], label: 'Playback statistics (foo_playcount or Playcount 2003)',
              level: 'recommended', uses: 'Play counts and dates in Playback statistics and Track information.',
              url: 'https://www.foobar2000.org/components/view/foo_playcount' },
            { id: 'lastfmsync', dll: ['foo_lastfm_playcount_sync'], label: 'Last.fm Playcount Sync', level: 'recommended',
              uses: 'The Last.fm love button and Last.fm play counts.',
              url: 'https://marc2k3.github.io/component/lastfm-playcount-sync/' },
            { id: 'stopqueue', dll: ['foo_stop_after_queue'], label: 'Stop After Queue', level: 'recommended',
              uses: 'The Stop after queue button and action.',
              url: 'https://www.foobar2000.org/components/view/foo_stop_after_queue' },
            { id: 'stoptrack', dll: ['foo_stop_after_track'], label: 'Stop After Track', level: 'recommended',
              uses: 'The Stop after track buttons and actions.',
              url: 'https://www.foobar2000.org/components/view/foo_stop_after_track' },
            { id: 'milk2', dll: ['foo_vis_milk2'], label: 'MilkDrop 2', level: 'recommended',
              uses: 'The MilkDrop visualisation panel in the shipped layout.',
              url: 'https://www.foobar2000.org/components/view/foo_vis_milk2' },
            { id: 'spectrumanalyzer', dll: ['foo_vis_spectrum_analyzer'], label: 'Spectrum Analyzer', level: 'recommended',
              uses: 'The Spectrum Analyzer panel in the shipped layout (RVG Spectrum works without it).',
              url: 'https://www.foobar2000.org/components/view/foo_vis_spectrum_analyzer' },
            { id: 'eslyric', dll: ['foo_uie_eslyric'], label: 'ESLyric', level: 'recommended',
              uses: 'The ESLyric panel in the shipped layout (RVG Lyrics works without it).',
              url: 'https://github.com/ESLyric' },
            { id: 'musicbrainz', dll: ['foo_musicbrainz', 'foo_musicbrainz64'], label: 'MusicBrainz Tagger', level: 'optional',
              uses: 'MusicBrainz tagging commands (the RVG MusicBrainz tagger panel works without it).',
              url: 'https://www.foobar2000.org/components/view/foo_musicbrainz' }
        ];

        var FONTS = [
            { id: 'kumbh', name: 'Kumbh Sans', url: 'https://fonts.google.com/specimen/Kumbh+Sans' },
            { id: 'reddit', name: 'Reddit Sans', url: 'https://fonts.google.com/specimen/Reddit+Sans' }
        ];

        function hasComponent(names) {
            for (var i = 0; i < names.length; i++) {
                try { if (utils.CheckComponent(names[i], true)) return names[i]; } catch (e) { }
            }
            return '';
        }

        function hasFont(name) {
            try { return !!utils.CheckFont(name); } catch (e) { return false; }
        }

        function parseVersion(text) {
            var match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
            return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
        }

        function atLeast(version, minimum) {
            for (var i = 0; i < 3; i++) {
                if (version[i] !== minimum[i]) return version[i] > minimum[i];
            }
            return true;
        }

        // context: { lastfmApiKey, lastfmUsername, statsSourceIs2003 }
        // Returns { items: [...], failing: { required, recommended, optional } }.
        // Each item: { id, label, ok, level, detail, url, problem } - problem words a failure
        // ('missing' when absent).
        function run(context) {
            context = context || {};
            var items = [];
            var i;

            var jsVersionText = '';
            try { jsVersionText = String(utils.Version || ''); } catch (e) { jsVersionText = ''; }
            var jsVersion = parseVersion(jsVersionText);
            if (!jsVersion || !atLeast(jsVersion, MIN_JSPLITTER)) {
                items.push({ id: 'jsplitter', label: 'JSplitter ' + (jsVersionText || '(version unknown)'), ok: false,
                    problem: 'update needed',
                    level: 'required',
                    detail: 'RVG needs JSplitter 4.2.1 or newer; older builds throw script errors.',
                    url: 'https://github.com/dima-lur/jsplitter' });
            } else {
                items.push({ id: 'jsplitter', label: 'JSplitter', ok: true, level: 'required',
                    detail: 'Version ' + jsVersionText });
            }

            for (i = 0; i < COMPONENTS.length; i++) {
                var c = COMPONENTS[i];
                var found = hasComponent(c.dll);
                items.push({ id: c.id, label: c.label, ok: !!found, level: c.level,
                    detail: (found ? 'Installed (' + found + '). ' : 'Not installed. Used by: ') + c.uses,
                    url: found ? '' : c.url });
            }

            // The statistics source setting must point at a component that exists.
            var has2003 = !!hasComponent(['foo_playcount_2003']);
            var hasPlaycount = !!hasComponent(['foo_playcount']);
            if (context.statsSourceIs2003 !== undefined && (has2003 || hasPlaycount)) {
                var mismatch = context.statsSourceIs2003 ? !has2003 : !hasPlaycount;
                items.push({ id: 'statssource', label: 'Playback statistics source', ok: !mismatch, level: 'recommended',
                    problem: 'wrong component',
                    detail: mismatch
                        ? 'Set to ' + (context.statsSourceIs2003 ? 'Playcount 2003' : 'foo_playcount') +
                          ', which is not installed. Switch it under General.'
                        : 'Reads ' + (context.statsSourceIs2003 ? 'Playcount 2003' : 'foo_playcount') + ' fields.' });
            }

            var fluent = hasFont('Segoe Fluent Icons');
            var mdl2 = !fluent && hasFont('Segoe MDL2 Assets');
            items.push({ id: 'iconfont', label: 'Icon font', ok: fluent || mdl2, level: 'required',
                detail: fluent ? 'Segoe Fluent Icons.'
                    : (mdl2 ? 'Segoe MDL2 Assets (the Windows 10 fallback).'
                        : 'Neither Segoe Fluent Icons nor Segoe MDL2 Assets is installed; buttons will show boxes.'),
                url: fluent || mdl2 ? '' : 'https://learn.microsoft.com/windows/apps/design/style/segoe-fluent-icons-font' });

            for (i = 0; i < FONTS.length; i++) {
                var f = FONTS[i];
                var present = hasFont(f.name);
                items.push({ id: 'font.' + f.id, label: f.name + ' font', ok: present, level: 'optional',
                    detail: present ? 'Installed.' : 'Not installed. RVG was designed with it; any font works.',
                    url: present ? '' : f.url });
            }

            var lastfmSet = !!(String(context.lastfmApiKey || '').trim() && String(context.lastfmUsername || '').trim());
            items.push({ id: 'lastfm', label: 'Last.fm account', ok: lastfmSet, level: 'optional', problem: 'not set',
                detail: lastfmSet ? 'API key and username entered.'
                    : 'Enter an API key and username under General to use the Last.fm and Last.fm Charts panels.' });

            var failing = { required: 0, recommended: 0, optional: 0 };
            for (i = 0; i < items.length; i++) if (!items[i].ok) failing[items[i].level]++;
            return { items: items, failing: failing, checkedAt: new Date().getTime() };
        }

        function summaryText(result) {
            var f = result.failing;
            if (!f.required && !f.recommended && !f.optional) return 'Everything RVG uses is installed and set up.';
            var parts = [];
            parts.push(f.required ? f.required + ' required item' + (f.required === 1 ? ' is' : 's are') + ' missing.'
                : 'Everything required is installed.');
            if (f.recommended) parts.push(f.recommended + ' recommended item' + (f.recommended === 1 ? '' : 's') + ' missing.');
            if (f.optional) parts.push(f.optional + ' optional item' + (f.optional === 1 ? '' : 's') + ' missing.');
            return parts.join(' ');
        }

        var LEVEL_ORDER = ['required', 'recommended', 'optional'];
        var LEVEL_TITLE = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };

        // Settings rows for one section: summary, Check again, then missing items
        // (with a Get button where there is a download) before present ones.
        function schemaRows(result, section) {
            var rows = [
                { id: ACTION_PREFIX + 'summary', label: 'Health check', type: 'info', section: section,
                  value: summaryText(result) },
                { id: RECHECK_ID, label: 'Check again', type: 'action', actionLabel: 'Check', section: section,
                  hint: 'Run the checks again after installing a component or font.' }
            ];
            for (var pass = 0; pass < 2; pass++) {
                for (var l = 0; l < LEVEL_ORDER.length; l++) {
                    for (var i = 0; i < result.items.length; i++) {
                        var item = result.items[i];
                        if (item.level !== LEVEL_ORDER[l] || item.ok !== (pass === 1)) continue;
                        var title = item.label + (item.ok ? '' : '  \u2014  ' + (item.problem || 'missing') +
                            ' (' + LEVEL_TITLE[item.level].toLowerCase() + ')');
                        if (!item.ok && item.url) {
                            rows.push({ id: ACTION_PREFIX + 'get.' + item.id, label: title, type: 'action',
                                actionLabel: 'Get', section: section, hint: item.detail });
                        } else {
                            rows.push({ id: ACTION_PREFIX + 'item.' + item.id, label: title, type: 'info',
                                section: section, value: item.detail });
                        }
                    }
                }
            }
            return rows;
        }

        function urlFor(result, actionId) {
            var id = actionId.substring((ACTION_PREFIX + 'get.').length);
            for (var i = 0; i < result.items.length; i++) if (result.items[i].id === id) return result.items[i].url;
            return '';
        }

        function openUrl(url) {
            if (!/^https:\/\//i.test(String(url || ''))) return false;
            try { new ActiveXObject('WScript.Shell').Run(url); return true; } catch (e) { return false; }
        }

        // Handles a Health action row. Returns 'recheck', 'opened' or '' (not ours).
        function handleAction(result, settingId) {
            settingId = String(settingId || '');
            if (settingId === RECHECK_ID) return 'recheck';
            if (settingId.indexOf(ACTION_PREFIX + 'get.') === 0 && result) {
                openUrl(urlFor(result, settingId));
                return 'opened';
            }
            return settingId.indexOf(ACTION_PREFIX) === 0 ? 'ignored' : '';
        }

        return {
            run: run,
            schemaRows: schemaRows,
            summaryText: summaryText,
            handleAction: handleAction,
            parseVersion: parseVersion,
            atLeast: atLeast
        };
    }());
}
