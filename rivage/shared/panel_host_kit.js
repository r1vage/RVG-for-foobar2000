'use strict';

// Direct-child helpers. PanelObject wrappers are callback-local because native
// collection rebuilds can invalidate them between callbacks.
var PanelHostKit = typeof PanelHostKit !== 'undefined' ? PanelHostKit : (function () {
    function trimText(value) {
        return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    // -1 means the native count could not be read; zero is a real empty layout.
    function safeGetPanelCount() {
        var count;
        try {
            count = Number(window.GetPanelCount());
        } catch (e) {
            return -1;
        }
        if (!isFinite(count) || count < 0) return -1;
        return Math.floor(count);
    }

    // null means both native caption properties were unreadable. A readable but
    // empty caption still uses the caller's deterministic fallback.
    function safePanelCaption(panel, fallback) {
        var text = '';
        var textReadable = false;
        var nameReadable = false;

        try {
            text = trimText(panel.Text);
            textReadable = true;
        } catch (e) { }

        if (!text) {
            try {
                text = trimText(panel.Name);
                nameReadable = true;
            } catch (e2) { }
        }

        if (text) return text;
        if (!textReadable && !nameReadable) return null;
        return fallback;
    }

    function visibleCaptionPart(caption) {
        var text = trimText(caption);
        var marker = text.lastIndexOf('::');
        if (marker >= 0 && marker + 2 < text.length) text = text.substring(marker + 2);
        return trimText(text.replace(/[_-]+/g, ' ')) || 'Panel';
    }

    function titleCaseWords(text) {
        return String(text).toLowerCase().replace(/(^|\s)([a-z0-9])/g, function (all, prefix, ch) {
            return prefix + ch.toUpperCase();
        });
    }

    function labelFromCaption(caption) {
        var text = visibleCaptionPart(caption);
        if (/[^\x00-\x7f]/.test(text)) return text;

        var letters = text.replace(/[^A-Za-z]+/g, '');
        if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
            text = titleCaseWords(text);
        }
        return text;
    }

    function slugKeyFromCaption(value) {
        var text = visibleCaptionPart(value).toLowerCase();
        text = text.replace(/&/g, ' and ');
        return text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function idBaseFromCaption(value) {
        return slugKeyFromCaption(value) || 'panel';
    }

    function compactKeyFromCaption(value) {
        return visibleCaptionPart(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function stableHash(value) {
        var text = String(value == null ? '' : value).toLowerCase();
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(36);
    }

    // Optional ownership preserves ids when a later child introduces a slug collision.
    function makeUniqueCaptionIds(captions, preferredIdsByCaption) {
        var groups = Object.create(null);
        var reservedOwnerById = Object.create(null);
        var assignedPrefix = Object.create(null);
        var ids = [];
        var i;
        var key;

        if (preferredIdsByCaption && typeof preferredIdsByCaption === 'object') {
            for (key in preferredIdsByCaption) {
                if (!Object.prototype.hasOwnProperty.call(preferredIdsByCaption, key)) continue;
                var preferredId = trimText(preferredIdsByCaption[key]);
                if (preferredId && !reservedOwnerById[preferredId]) {
                    reservedOwnerById[preferredId] = String(key).toLowerCase();
                }
            }
        }

        for (i = 0; i < captions.length; i++) {
            var base = idBaseFromCaption(captions[i]);
            if (!groups[base]) groups[base] = [];
            groups[base].push({
                index: i,
                key: trimText(captions[i]).toLowerCase()
            });
        }

        for (var baseId in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, baseId)) continue;
            var members = groups[baseId];
            var uniqueKeys = [];
            var keySeen = Object.create(null);

            for (i = 0; i < members.length; i++) {
                if (!keySeen[members[i].key]) {
                    keySeen[members[i].key] = true;
                    uniqueKeys.push(members[i].key);
                }
            }
            uniqueKeys.sort();

            var prefixByKey = Object.create(null);
            for (i = 0; i < uniqueKeys.length; i++) {
                key = uniqueKeys[i];
                var preferred = preferredIdsByCaption && trimText(preferredIdsByCaption[key]);
                var prefix = '';

                if (preferred && (!reservedOwnerById[preferred] || reservedOwnerById[preferred] === key) &&
                    !assignedPrefix[preferred]) {
                    prefix = preferred;
                }

                if (!prefix) {
                    prefix = baseId;
                    if ((reservedOwnerById[prefix] && reservedOwnerById[prefix] !== key) || assignedPrefix[prefix]) {
                        prefix = baseId + '__h' + stableHash(key);
                        var suffix = 2;
                        while ((reservedOwnerById[prefix] && reservedOwnerById[prefix] !== key) || assignedPrefix[prefix]) {
                            prefix = baseId + '__h' + stableHash(key) + '__k' + suffix;
                            suffix++;
                        }
                    }
                }

                assignedPrefix[prefix] = true;
                prefixByKey[key] = prefix;
            }

            var occurrenceByKey = Object.create(null);
            for (i = 0; i < members.length; i++) {
                var member = members[i];
                var occurrence = occurrenceByKey[member.key] || 0;
                occurrenceByKey[member.key] = occurrence + 1;
                ids[member.index] = prefixByKey[member.key] + (occurrence ? '__' + (occurrence + 1) : '');
            }
        }

        return ids;
    }

    function resolveStoredId(value, options, findById, emptyId) {
        var text = trimText(value);
        if (!text || text === emptyId) return text;
        if (typeof findById === 'function' && findById(text)) return text;

        var lower = text.toLowerCase();
        var slug = slugKeyFromCaption(text);
        var compact = compactKeyFromCaption(text);

        for (var i = 0; i < options.length; i++) {
            var option = options[i];
            var optionId = String(option.id || '');
            var optionCaption = String(option.caption || '');
            var optionLabel = String(option.label || '');
            var optionCompactId = compact ? compactKeyFromCaption(optionId) : '';
            var optionCompactCaption = compact ? compactKeyFromCaption(optionCaption) : '';
            var optionSlug = slug ? slugKeyFromCaption(optionCaption) : '';

            if (
                optionId.toLowerCase() === lower ||
                (slug && optionId === slug) ||
                (compact && optionCompactId && optionCompactId === compact) ||
                optionCaption.toLowerCase() === lower ||
                optionLabel.toLowerCase() === lower ||
                (slug && optionSlug && optionSlug === slug) ||
                (compact && optionCompactCaption && optionCompactCaption === compact)
            ) {
                return option.id;
            }
        }
        return '';
    }

    // expectedCaptions, when supplied, binds each wrapper to the metadata from
    // the last successful scan and detects same-count reorder/replacement races.
    function acquireSnapshot(count, expectedCaptions) {
        if (count < 0) return null;
        if (expectedCaptions && expectedCaptions.length !== count) return null;

        var panels = [];
        try {
            for (var i = 0; i < count; i++) {
                if (safeGetPanelCount() !== count) return null;
                var panel = window.GetPanelByIndex(i);
                if (!panel) return null;
                if (expectedCaptions) {
                    var caption = safePanelCaption(panel, 'Panel ' + (i + 1));
                    if (caption === null || caption !== expectedCaptions[i]) return null;
                }
                panels.push(panel);
            }
            if (safeGetPanelCount() !== count) return null;
            return panels;
        } catch (e) {
            return null;
        }
    }

    function safeMovePanel(panel, x, y, width, height) {
        if (!panel || width <= 0 || height <= 0) return false;
        try {
            if (
                Number(panel.X) !== x || Number(panel.Y) !== y ||
                Number(panel.Width) !== width || Number(panel.Height) !== height
            ) {
                panel.Move(x, y, width, height, false);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // The conditional variant avoids redundant native Show calls. Settings Host
    // intentionally uses the forced variant so a previously hidden panel is reset.
    function safeShowPanel(panel, show) {
        if (!panel) return false;
        try {
            var hidden = !!panel.Hidden;
            if (show ? hidden : !hidden) panel.Show(!!show);
            return true;
        } catch (e) {
            return false;
        }
    }

    function safeShowPanelForce(panel, show) {
        if (!panel) return false;
        try {
            panel.Show(!!show);
            return true;
        } catch (e) {
            return false;
        }
    }

    return {
        trimText: trimText,
        safeGetPanelCount: safeGetPanelCount,
        safePanelCaption: safePanelCaption,
        visibleCaptionPart: visibleCaptionPart,
        labelFromCaption: labelFromCaption,
        idBaseFromCaption: idBaseFromCaption,
        makeUniqueCaptionIds: makeUniqueCaptionIds,
        resolveStoredId: resolveStoredId,
        acquireSnapshot: acquireSnapshot,
        safeMovePanel: safeMovePanel,
        safeShowPanel: safeShowPanel,
        safeShowPanelForce: safeShowPanelForce
    };
})();
