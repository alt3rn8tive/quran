var myApp = angular.module('myApp', ['ngSanitize', 'ngRoute']);

//constants
const FATHATAN = "\u064B"; // ً
const DAMMATAN = "\u064C"; // ٌ
const KASRATAN = "\u064D"; // ٍ
const FATHA = "\u064E"; // َ
const DAMMA = "\u064F"; // ُ
const KASRA = "\u0650"; // ِ
const SHADDA = "\u0651"; // ّ
const SUKUN = "\u0652"; // ْ
const ANY_SINGLE_LETTER = "ـ"; //

const quran_symbols = "۩" + "ۜ" + "ۛ" + "ۚ" + "ۙ" + "ۘ" + "ۗ" + "ۖ";
const any_word_letter = '[^\\s' + quran_symbols + ']';
const alharakat_mufradah = FATHA + DAMMA + KASRA;
const alharakat_tanween = FATHATAN + DAMMATAN + KASRATAN;
const numbers = '1234567890';
const arabic_numbers = '١٢٣٤٥٦٧٨٩٠';
const alharakat_other = SHADDA + SUKUN;
const kul_alharakat = alharakat_mufradah + alharakat_tanween + alharakat_other + 'ٰ';
const huroof = 'ابتثجحخدذرزسشصطضظعغفقكلمنهوي';
const special_huroof = 'ةى';
const ahrof_alela = 'اويى';
const ahrof_hamzah = 'اأإآؤئءٰ';
const kul_huroof = ahrof_hamzah + huroof + special_huroof;
const kul_huroof_pattern = "[ا-يآؤئإأٱءٰ]";
const huroof_wa_harakat = kul_huroof + kul_alharakat;
var regex_flags = 'gud';

try {
    new RegExp("", regex_flags);
} catch (exp) {
    regex_flags = 'gd';
}

function arabic_to_english_number(number) {
    return numbers[arabic_numbers.search(number)];
}

//add space to beginning and end of ayat text
all_ayat.map(function (item) {
    item["text"] = " " + item["text"] + " ";
});

function optionalChars(str, number) {
    if (typeof number !== 'string') {
        number = '*';
    }

    return '[' + str + ']' + number;
}

function removeHarakatOfLastHarf(text) {
    //add space to end
    //search by harakat followed by space
    text = text + ' ';
    text = text.replace(new RegExp(optionalChars(kul_alharakat, '+') + ' ', regex_flags), ' ');//  preg_filter('/'.optionalChars(kul_alharakat).' /u',' ',$text.' ');
    return text.slice(0, -1); //removes last space
}

function addAfterEachLetter(add_str, str) {
    var str_result = '';

    var chars_arr = str.split("");

    var ignored_chars = '\uE002\uE003\uE004\uE006\uE010\uE011\uE012\uE013\uE014\uE015\uE016\uE017\uE018\uE019\uE01A:<>!{}+-.(|)[]*?؟$^ ْ' + numbers + kul_alharakat;
    const ignored_chars_arr = ignored_chars.split("");
    const count_chars = chars_arr.length;
    for (var i = 0; i < count_chars; i++) {
        const current_char = chars_arr[i];
        if (!ignored_chars.includes(current_char)) {
            str_result += "(?:" + current_char + add_str + ")";
        } else {
            str_result += current_char;
        }
    }

    return str_result;
}

function getRegexPatternForString(text, config) {
    // Protect per-block boundaries from whitespace and letter expansion.
    // Expand them after the remaining search language has been translated.
    text = text.replace(/\(\?<= \)/g, '\uE002').replace(/\(\?= \)/g, '\uE003');
    // Protect numeric repetition from letter expansion and the older syntax
    // that interprets bare numbers as backreferences.
    text = text.replace(/\(\?:ـ\)(?=\{\d+(?:,\d+)?\})/g, '\uE006');
    text = text.replace(/\{\d+(?:,\d+)?\}/g, function (quantifier) {
        return quantifier.replace(/[\d,]/g, function (character) { return character === ',' ? '\uE01A' : String.fromCharCode(0xE010 + Number(character)); });
    });

    text = text.replace(/\*/g,"**");

    let optional_kul_alharakat = optionalChars(kul_alharakat);
    text = addAfterEachLetter(optional_kul_alharakat, text);

    // use ".." to match any number of words
    text = text.replace(/(^|\s)\.\.(\s|$)/g, " .(?: .)*? ");
    //text = text.replace(/\s\.\.\s/g,"(?:\\s[^"++"])*\\s");

    // Keep whole-word wildcards separate from single-letter patterns. A dagger
    // alif can be both a letter and a mark; repeating letter-with-marks groups
    // makes long, unsuccessful word-gap searches backtrack exponentially.
    text = text.replace(/\./g, "\uE000");
    text = text.replace(/\*{2,}/g, "\uE001");

    text = text.replace(/ا/g, "[ٰا]");

    // use "_" to match single letter in a word
    text = text.replace(/[ـ_]/g, "(?:" + kul_huroof_pattern + optional_kul_alharakat + ")");

    text = text.replace(/؟/g, "?");

    text = text.replace(new RegExp("[" + arabic_numbers + "]", 'g'), function (number) {
        return arabic_to_english_number(number);
    });

    text = text.replace(/(\d)/g, "\\$1");

    // set SHADDA and Harakah in the proper order
    text = text.replace(SHADDA + FATHA, FATHA + SHADDA);
    text = text.replace(SHADDA + KASRA, KASRA + SHADDA);
    text = text.replace(SHADDA + DAMMA, DAMMA + SHADDA);

    var wordMatch = config.wordMatch || (config.excludePartOfWords ? 'whole' : 'contains');
    if (wordMatch === 'whole') {
        text = " " + text.trim() + " ";
    } else if (wordMatch === 'starts') {
        text = " " + text.trimStart();
    } else if (wordMatch === 'ends') {
        text = text.trimEnd() + " ";
    }

    // Outer word boundaries are assertions, not separators to consume. In
    // particular, do not include a following pause mark in the matched word.
    text = text.replace(/^ /, '\uE002').replace(/ $/, '\uE003');

    // A single optional path avoids exponentially many identical empty
    // separator matches when a word-gap spans a long verse.
    text = text.replace(/(?!^)\s+/g, "(?: [" + quran_symbols + "])* ");

    if (config.searchFromBeginning && config.searchOnEnd) {
        text = '^ ' + text.trim() + '(?=(?: [' + quran_symbols + '])* $)';  // trims text and adds space after ^ and before $
    } else if (config.searchFromBeginning) {
        text = '^ ' + text.trimStart();  // trims starting space from text and adds space after ^
    } else if (config.searchOnEnd) {
        text = text.trimEnd() + '(?=(?: [' + quran_symbols + '])* $)';  // trims ending space from text and adds space before $
    }

    // ignore the first and the last spaces to allow matching the direct next word
    text = text.replace(/^ /, "(?<= )");
    text = text.replace(/ $/, "(?= )");

    // The same word language, with one unambiguous character class after the
    // first letter. Expand after the user-facing search syntax is translated.
    var wordPattern = kul_huroof_pattern + kul_huroof_pattern.slice(0, -1) + kul_alharakat + ']*';
    text = text.replace(/\uE000/g, '(?:' + wordPattern + ')');
    text = text.replace(/\uE001/g, '(?:' + wordPattern + ')?');
    text = text.replace(/\uE002/g, '(?<= )').replace(/\uE003/g, '(?= )');
    text = text.replace(/\uE006/g, '(?:[ا-يآؤئإأٱء]' + optional_kul_alharakat + ')');
    text = text.replace(/[\uE010-\uE01A]/g, function (character) { return character === '\uE01A' ? ',' : String(character.charCodeAt(0) - 0xE010); });

    text = text.replace(/\uE004/g, '(?: [' + quran_symbols + '])* \uE004 ');

    try {
        text = new RegExp(text, regex_flags);
    } catch (error) {
        return null;
    }

    return text;
}

// Versioned base64url keeps browser copying and chat linkification from
// decoding Arabic, spaces or structured query JSON into the visible URL.
var QuranSearchLink = {
    compact: function (params) {
        var compact = Object.assign({}, params);
        try {
            var blocks = QuranQueryBuilder.normalise(JSON.parse(params.qb));
            if (QuranQueryBuilder.compile(blocks).query === params.s) {
                compact.qb = JSON.stringify(blocks.map(function (block) {
                    var defaults = QuranQueryBuilder.create(block.type), result = {type: block.type};
                    Object.keys(defaults).forEach(function (key) {
                        if (key !== 'type' && JSON.stringify(block[key]) !== JSON.stringify(defaults[key])) result[key] = block[key];
                    });
                    return result;
                }));
            }
        } catch (error) { /* Preserve older advanced links verbatim. */ }
        Object.keys(compact).forEach(function (key) {
            if (compact[key] === undefined || compact[key] === null || compact[key] === '') delete compact[key];
        });
        if (compact.word_match === 'contains' && !compact.exclude_part_of_words) delete compact.word_match;
        return compact;
    },
    encode: function (params) {
        params = QuranSearchLink.compact(params);
        var bytes = encodeURIComponent(JSON.stringify(params)).replace(/%([0-9A-F]{2})/g, function (_, hex) {
            return String.fromCharCode(parseInt(hex, 16));
        });
        return 'v1.' + btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    parameters: function (raw) {
        if (typeof raw.q !== 'string' || !/^v1\.[A-Za-z0-9_-]+$/.test(raw.q)) return raw;
        try {
            var bytes = atob(raw.q.slice(3).replace(/-/g, '+').replace(/_/g, '/'));
            var decoded = JSON.parse(decodeURIComponent(Array.from(bytes).map(function (byte) {
                return '%' + byte.charCodeAt(0).toString(16).padStart(2, '0');
            }).join('')));
            if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return raw;
            if (typeof decoded.qb === 'string') {
                try {
                    var blocks = JSON.parse(decoded.qb);
                    if (Array.isArray(blocks)) decoded.qb = JSON.stringify(QuranQueryBuilder.normalise(blocks));
                } catch (error) { /* Legacy builder validation handles invalid data. */ }
            }
            return Object.assign({}, decoded, Object.keys(raw).reduce(function (params, key) {
                if (key !== 'q') params[key] = raw[key];
                return params;
            }, {}));
        } catch (error) { return raw; }
    }
};

// Counts and exports always use the same filtered result groups.
var QuranResults = {
    summary: function (groups) {
        var ayat = new Set(), values = new Set(), occurrences = 0, capturedValues = 0;
        groups.forEach(function (group) {
            occurrences += group.occurrenceCount;
            capturedValues += group.matched.length;
            group.matched.forEach(function (value) { values.add(value); });
            group.ayat.forEach(function (ayah) { ayat.add(ayah.sura_id + ':' + ayah.verse_id); });
        });
        return {groups: groups.length, ayat: ayat.size, occurrences: occurrences, values: capturedValues, distinctValues: values.size};
    },
    csv: function (rows) {
        return '\uFEFF' + rows.map(function (row) {
            return row.map(function (cell) {
                var text = String(cell === null || cell === undefined ? '' : cell);
                if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
                return '"' + text.replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\r\n') + '\r\n';
    },
    frequencyRows: function (groups, suwar, base) {
        var counts = new Map();
        groups.forEach(function (group) {
            group.matched.forEach(function (value) {
                if (!counts.has(value)) counts.set(value, {count: 0, ayat: new Map()});
                var entry = counts.get(value); entry.count++;
                group.ayat.forEach(function (ayah) { entry.ayat.set(ayah.sura_id + ':' + ayah.verse_id, ayah); });
            });
        });
        return [['النص المطابق أو الملتقط', 'عدد التكرارات', 'السور المشاركة', 'مراجع الآيات المشاركة', 'روابط الآيات المشاركة']].concat(Array.from(counts).sort(function (a, b) {
            return b[1].count - a[1].count || a[0].localeCompare(b[0]);
        }).map(function (item) {
            var ayat = Array.from(item[1].ayat.values());
            var titles = new Set(ayat.map(function (ayah) { return suwar ? suwar[ayah.sura_id - 1].title : String(ayah.sura_id); }));
            return [item[0], item[1].count, Array.from(titles).join('، '), Array.from(item[1].ayat.keys()).join('، '), ayat.map(function (ayah) {
                return (base || '') + '#!/surah?id=' + ayah.sura_id + '#ayah-' + ayah.verse_id;
            }).join('\n')];
        }));
    },
    ayahRows: function (groups, suwar, base) {
        var ayat = new Map();
        groups.forEach(function (group, index) {
            group.ayat.forEach(function (ayah) {
                var key = ayah.sura_id + ':' + ayah.verse_id;
                if (!ayat.has(key)) ayat.set(key, {ayah: ayah, groups: []});
                ayat.get(key).groups.push(index + 1);
            });
        });
        return [['السورة', 'رقم السورة', 'رقم الآية', 'نص الآية', 'مجموعات المطابقة', 'الرابط']].concat(Array.from(ayat.values()).map(function (item) {
            var ayah = item.ayah;
            return [suwar[ayah.sura_id - 1].title, ayah.sura_id, ayah.verse_id, ayah.text.trim(), item.groups.join('، '), base + '#!/surah?id=' + ayah.sura_id + '#ayah-' + ayah.verse_id];
        }));
    }
};

var uniqueItems = function (data, key) {
    var result = new Set();

    for (var i = 0; i < data.length; i++) {
        const values_arr = valueShouldBeArray(data[i][key]);

        for (var j = 0; j < values_arr.length; j++) {
            const value = values_arr[j];
            result.add(value);
        }
    }

    return Array.from(result);
};

function valueShouldBeArray(variable) {
    if (Array.isArray(variable)) {
        return variable;
    } else {
        return [variable];
    }
}

var countByAttributes = function (data, attributes) {
    var countedData = [];
    for (var i = 0; i < attributes.length; i++) {
        var str = attributes[i];
        //countedData[str]=0;
        countedData[str] = [];
    }

    //var cleanArray=[];

    for (var i = 0; i < data.length; i++) {
        for (var j = 0; j < attributes.length; j++) {
            const data_attribute = attributes[j];
            var currentAttributeData = data[i][data_attribute];

            //insure it is an array:
            var currentDataArray = valueShouldBeArray(currentAttributeData);

            for (var k = 0; k < currentDataArray.length; k++) {
                const currentData = currentDataArray[k];
                if (typeof countedData[data_attribute][currentData] === 'number') {
                    countedData[data_attribute][currentData]++;
                } else {
                    countedData[data_attribute][currentData] = 1;
                }
            }

        }

        //cleanArray[data_attribute]=[];
        //var countedData2 = countedData[data_attribute];
        //for(var key in countedData2) {
        //    cleanArray[data_attribute]={'attribute_value':key,'count':countedData2[key]};
        //}
    }

    return countedData;
};

function replaceRange(string, start, end, substitute) {
    return string.substring(0, start) + substitute + string.substring(end);
}

function highlightText(input, regex, highlightOnlyGroups) {
    let startHighlightTag = "<span class='highlightedText'>";
    let endHighlightTag = "</span>";
    let startHighlightTagLength = startHighlightTag.length;
    let endHighlightTagLength = endHighlightTag.length;
    let addedStartTagsIndices = [];
    let addedEndTagsIndices = [];
    var highlightedText = input;

    function getModifiedContentsLengthBefore(start) {
        let startTagsLength = addedStartTagsIndices.filter((index) => index <= start).length * startHighlightTagLength;
        let endTagsLength = addedEndTagsIndices.filter((index) => index <= start).length * endHighlightTagLength;
        return startTagsLength + endTagsLength;
    }

    var matches = null;
    while (matches = regex.exec(input)) {
        if (matches.length === 0 || (matches[0] + "").trim() == "") {
            if (regex.lastIndex === matches.index) {
                // prevent infinite loop
                regex.lastIndex += 1;
            }
            continue;
        }

        // highlight only captured groups
        if (highlightOnlyGroups && matches.length > 1) {
            matches.shift(1);
            matches.indices.shift(1);
        }

        for (let i = 0; i < matches.length; i++) {
            let currentMatch = matches[i];
            let currentMatchIndex = matches.indices[i];
            if (!currentMatchIndex) {
                continue;
            }
            let start = currentMatchIndex[0];
            let modifiedStart = start + getModifiedContentsLengthBefore(start);
            let end = currentMatchIndex[1];
            let length = end - start;
            let modifiedEnd = modifiedStart + length;
            addedStartTagsIndices.push(start);
            addedEndTagsIndices.push(end);
            highlightedText = replaceRange(highlightedText, modifiedStart, modifiedEnd, startHighlightTag + currentMatch + endHighlightTag);
        }
    }

    return highlightedText;
}

// Render only accepted occurrences when a word-level exclusion removes some
// matches from a verse. Merge touching ranges so the markup stays balanced.
function highlightRanges(text, ranges) {
    var merged = [];
    ranges.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (range) {
        var previous = merged[merged.length - 1];
        if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
        else merged.push(range.slice());
    });
    var escape = function (value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var result = '', end = 0;
    merged.forEach(function (range) {
        result += escape(text.slice(end, range[0])) + "<span class='highlightedText'>" + escape(text.slice(range[0], range[1])) + '</span>';
        end = range[1];
    });
    return result + escape(text.slice(end));
}

function excludedBy(rules, scope, text) {
    return rules.some(function (rule) {
        if (rule.scope !== scope) return false;
        rule.pattern.lastIndex = 0;
        return rule.pattern.test(text);
    });
}

function getTrueKeys(input) {
    const trueKeys = [];

    for (const key in input) {
        if (input.hasOwnProperty(key) && input[key] === true) {
            trueKeys.push(key);
        }
    }

    return trueKeys;
}

function mapToTrueObject(keys) {
    const result = {};

    keys.forEach(key => {
        result[key] = true;
    });

    return result;
}

myApp.config(function ($routeProvider) {
    $routeProvider
        .when("/search", {
            templateUrl: "view/search.html",
            controller: "AyatSearchController"
        })
        .when("/surah", {
            templateUrl: "view/surah.html",
            controller: "SurahCtrl"
        })
        .when("/statistics", {
            templateUrl: "view/statistics.html",
            controller: "SurahStatisticsController",
            reloadOnSearch: false
        })
        .when("/search-features", {
            templateUrl: "view/search-features.html",
            controller: "SearchHelpController"
        })
        .otherwise({
            redirectTo: '/search'
        });
});

// Version templates as well as scripts, so a cached view cannot outlive its code.
myApp.config(function ($httpProvider) {
    $httpProvider.interceptors.push(function () {
        return {request: function (config) {
            if (typeof QuranRelease !== 'undefined' && /^view\/[^?]+\.html$/.test(config.url)) config.url += '?v=' + QuranRelease.current;
            return config;
        }};
    });
});
myApp.run(function ($rootScope, $window) {
    if (typeof QuranRelease === 'undefined') return;
    $rootScope.availableRelease = QuranRelease.pending;
    $rootScope.refreshApp = function () { QuranRelease.refresh($rootScope.availableRelease); };
    function checkForUpdate() {
        QuranRelease.check().then(function (build) {
            if (build && build !== QuranRelease.current) $rootScope.$evalAsync(function () { $rootScope.availableRelease = build; });
        });
    }
    $window.setInterval(checkForUpdate, 300000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkForUpdate(); });
});

myApp.directive('scrollContainer', function ($timeout) {
    return {
        restrict: 'C', // Apply this directive to elements with the class 'scroll-container'
        link: function (scope, element) {
            // Adjust these values as needed
            var threshold = 50;
            var transitionDuration = '0.3s';

            // Create a shadow element
            var shadowElement = angular.element('<div class="scroll-shadow"></div>');
            element.after(shadowElement);

            // Create a unique identifier for each container
            var containerId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

            // Create a unique hasMoreContent variable for each container
            scope['hasMoreContent' + containerId] = false;

            function checkScrollEnd() {
                var isAtBottom = element[0].scrollHeight - element[0].scrollTop - element[0].clientHeight < threshold;
                scope.$apply(function () {
                    scope['hasMoreContent' + containerId] = !isAtBottom;
                });
            }

            element.on('scroll', checkScrollEnd);

            scope.$watch('hasMoreContent' + containerId, function (newVal) {
                if (newVal) {
                    shadowElement.addClass('has-shadow');
                } else {
                    shadowElement.removeClass('has-shadow');
                }
            });

            // Add CSS transitions dynamically
            shadowElement.css('transition', 'opacity ' + transitionDuration + ' ease');

            // Watch for changes in the inner child elements
            $timeout(checkScrollEnd); // Initial check after a short delay
            scope.$watch(
                function () {
                    return element[0].innerHTML; // Watch the inner HTML content
                },
                function () {
                    // Delay the check to ensure the DOM has been updated
                    $timeout(checkScrollEnd);
                }
            );
        }
    };
});

myApp.controller('SearchHelpController', function ($scope, $http, $routeParams, $location, $anchorScroll) {

});

myApp.controller('SurahCtrl', function ($scope, $http, $routeParams, $location, $anchorScroll) {
    let harakat_regex = /[\u064B-\u065F]/g;
    $scope.all_suwar = all_suwar.map(function (surah) {
        surah.title_without_harakat = surah.title.replace(harakat_regex, "");
        return surah;
    });
    $scope.$watch('selected_surah', function (surah) {
        $scope.ayat_surah = all_ayat.filter(item => item.sura_id === surah.order);
    });
    var selected_surah_id = ($location.search()["id"] || "1") - 1;
    $scope.selected_surah = all_suwar[selected_surah_id];
    $scope.searchText = "";
    $scope.searchNumber = "";

    $scope.filterByTitle = function(surah) {
        // Check if searchText exists and surah title contains it
        if (!$scope.searchText) {
            return true
        }
        let searchPattern = getRegexPatternForString($scope.searchText, {});
        return surah.title.match(searchPattern) !== null;
    };

    $scope.filteredSuwar = all_suwar;

    $scope.$watch('searchText', function() {
        $scope.filteredSuwar = all_suwar.filter(function(surah) {
           return $scope.filterByTitle(surah);
        });
    });

    $scope.$watch('searchNumber', function() {
        $scope.filteredSuwar = all_suwar.filter(function(surah) {
            if ($scope.searchNumber.trim() == "" || isNaN($scope.searchNumber)) {
                return true;
            }
            var number = parseInt($scope.searchNumber);
            return number > 0 && surah.order == number;
        });
    });

    $scope.scrollTo = function (id) {
        $location.hash(id);
        $anchorScroll();
    };

    // scroll to Ayah
    $scope.$on('$viewContentLoaded', function () {
        setTimeout(function () {
            $location.hash($location.hash());
            $anchorScroll();
        }, 200);
    });
});

myApp.controller('AyatSearchController', function ($scope, $window, $http, $routeParams, $location, $timeout, $anchorScroll, $route, QuranLibraryStore) {
    function searchParameters() { return QuranSearchLink.parameters($location.search()); }
    function saveParameters(params) { $location.search({q: QuranSearchLink.encode(params)}); }
    function publicBaseUrl() {
        var url = new URL($location.absUrl());
        url.hash = ''; url.searchParams.delete('release');
        return url.href;
    }
    function currentSearchParameters() {
        return Object.assign({}, searchParameters(), {
            filter_results: getTrueKeys($scope.useResults).join(','),
            filter_suwar: getTrueKeys($scope.useSuwar).join(',')
        });
    }
    function download(contents, type, filename) {
        var blob = new $window.Blob([contents], {type:type});
        var url = $window.URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        $timeout(function () { $window.URL.revokeObjectURL(url); }, 1000, false);
    }
    $scope.libraryForm = {name:'', group:'عام', filter:null};
    $scope.libraryEntries = []; $scope.libraryGroups = [];
    function refreshLibrary() {
        $scope.libraryEntries = QuranLibraryStore.read();
        $scope.libraryGroups = Array.from(new Set($scope.libraryEntries.map(function (entry) { return entry.group; }))).sort(function (a,b) { return a.localeCompare(b); });
        if ($scope.libraryForm.filter && !$scope.libraryGroups.includes($scope.libraryForm.filter)) $scope.libraryForm.filter = null;
    }
    function libraryAction(action) {
        try { $scope.libraryStatus = action(); refreshLibrary(); }
        catch (error) { $scope.libraryStatus = error.message; }
    }
    libraryAction(function () { return ''; });
    $scope.libraryMatchesGroup = function (entry) { return !$scope.libraryForm.filter || entry.group === $scope.libraryForm.filter; };
    $scope.saveToLibrary = function () {
        if (!$scope.isSearchDone || $scope.queryEdited) { $scope.libraryStatus = 'نفّذ البحث أولاً لحفظ إعداداته ونتائجه الحالية.'; return; }
        libraryAction(function () {
            QuranLibraryStore.save({name:$scope.libraryForm.name, group:$scope.libraryForm.group || 'عام', q:QuranSearchLink.encode(currentSearchParameters())});
            $scope.libraryForm.filter = null;
            return 'تم حفظ البحث في هذا المتصفح.';
        });
    };
    $scope.openLibrarySearch = function (entry) {
        libraryAction(function () {
            var safe = QuranLibraryData.entry(entry);
            $location.search({q:safe.q}).hash('');
            $route.reload(); // Also restore when reopening an unchanged URL after editing its blocks.
            return 'تم فتح البحث المحفوظ.';
        });
    };
    $scope.editLibrarySearch = function (entry) {
        $scope.libraryEdit = {id:entry.id, name:entry.name, group:entry.group};
    };
    $scope.cancelLibraryEdit = function () { $scope.libraryEdit = null; };
    $scope.applyLibraryEdit = function () {
        libraryAction(function () {
            var edit = $scope.libraryEdit;
            QuranLibraryStore.edit(edit.id, edit.name, edit.group || 'عام');
            $scope.libraryEdit = null;
            return 'تم تعديل الاسم والمجموعة.';
        });
    };
    $scope.removeLibrarySearch = function (entry) {
        libraryAction(function () { $scope.removedLibrarySearch = QuranLibraryStore.remove(entry.id); return 'تم حذف البحث. يمكنك التراجع الآن.'; });
    };
    $scope.undoLibraryRemove = function () {
        libraryAction(function () { QuranLibraryStore.restore($scope.removedLibrarySearch); $scope.removedLibrarySearch = null; return 'تمت استعادة البحث.'; });
    };
    $scope.exportLibrary = function () {
        libraryAction(function () {
            download(QuranLibraryData.export(QuranLibraryStore.read()), 'application/json;charset=utf-8', 'quran-search-library.json');
            return 'تم تصدير المكتبة.';
        });
    };
    $scope.importLibraryFile = function (file) {
        if (!file || file.size > 1024 * 1024) { $scope.libraryStatus = 'اختر ملف JSON لا يتجاوز 1 ميغابايت.'; return; }
        $scope.importingLibrary = true;
        var reader = new $window.FileReader();
        reader.onload = function () { $scope.$evalAsync(function () {
            libraryAction(function () { var added = QuranLibraryStore.import(reader.result); return 'تم استيراد ' + added + ' من الأبحاث الجديدة؛ تُتجاوز النسخ المتطابقة.'; });
            $scope.importingLibrary = false;
        }); };
        reader.onerror = function () { $scope.$evalAsync(function () { $scope.libraryStatus = 'تعذرت قراءة الملف. لم تتغير المكتبة.'; $scope.importingLibrary = false; }); };
        reader.readAsText(file);
    };
    function onLibraryStorage(event) {
        if (event.key === QuranLibraryStore.key || event.key === null) $scope.$evalAsync(function () { libraryAction(function () { return 'تم تحديث المكتبة من نافذة أخرى.'; }); });
    }
    $window.addEventListener('storage', onLibraryStorage);
    $scope.$on('$destroy', function () { $window.removeEventListener('storage', onLibraryStorage); });

    var ayatByReference = new Map(all_ayat.map(function (ayah) { return [ayah.sura_id + ':' + ayah.verse_id, ayah]; }));
    $scope.contextAyah = function (group, direction) {
        var edge = direction === 'before' ? group.ayat[0] : group.ayat[group.ayat.length - 1];
        return ayatByReference.get(edge.sura_id + ':' + (edge.verse_id + (direction === 'before' ? -1 : 1)));
    };
    $scope.toggleResultContext = function (group, direction) {
        if (!$scope.contextAyah(group, direction)) return;
        var key = direction === 'before' ? 'showPrevious' : 'showNext';
        group[key] = !group[key];
    };
    allow_pagination($scope);
    //init filters
    let urlQueryParameters = searchParameters();
    if (urlQueryParameters.s && !$location.search().q) {
        saveParameters(urlQueryParameters);
        $location.replace();
    }
    let filter_results = (urlQueryParameters["filter_results"] || "");
    if (filter_results != getTrueKeys($scope.useResults).join(",")) {
        $scope.useResults = mapToTrueObject(filter_results.split(","));
    } else {
        $scope.useResults = {};
    }
    let filter_suwar = (urlQueryParameters["filter_suwar"] || "");
    if (filter_suwar != getTrueKeys($scope.useSuwar).join(",")) {
        $scope.useSuwar = mapToTrueObject(filter_suwar.split(","));
    } else {
        $scope.useSuwar = {};
    }

    $scope.suwar = all_suwar;
    $scope.searchQueryRegex = '';

    $scope.FATHA = FATHA
    $scope.DAMMA = DAMMA
    $scope.KASRA = KASRA
    $scope.SHADDA = SHADDA
    $scope.SUKUN = SUKUN
    $scope.ANY_SINGLE_LETTER = ANY_SINGLE_LETTER

    $scope.searchConfig = {
        searchFromBeginning: false,
        searchOnEnd: false,
        excludePartOfWords: false
    };

    // boolean or string, to be used in the matched strings in the sidebar
    var removeLastHarakah = searchParameters()["remove_harakah"];
    if (typeof removeLastHarakah === 'string' || removeLastHarakah instanceof String) {
        // as the browser will have the string value only in case of 'false'
        removeLastHarakah = removeLastHarakah !== 'false';
    }
    $scope.shouldRemoveLastHarakah = removeLastHarakah;

    // boolean or string, to search directly from the start of ayat
    var searchOnlyFromBeginning = searchParameters()["search_only_from_beginning"];
    if (typeof searchOnlyFromBeginning === 'string' || searchOnlyFromBeginning instanceof String) {
        // as the browser will have the string value only in case of 'false'
        searchOnlyFromBeginning = searchOnlyFromBeginning !== 'false';
    }
    $scope.searchConfig.searchFromBeginning = searchOnlyFromBeginning;

    // boolean or string, to search directly from the end of ayat
    var searchOnlyOnEnd = searchParameters()["search_only_on_end"];
    if (typeof searchOnlyOnEnd === 'string' || searchOnlyOnEnd instanceof String) {
        // as the browser will have the string value only in case of 'false'
        searchOnlyOnEnd = searchOnlyOnEnd !== 'false';
    }
    $scope.searchConfig.searchOnEnd = searchOnlyOnEnd;

    // boolean or string, to exclude searching for part of words
    var excludePartOfWords = searchParameters()["exclude_part_of_words"];
    if (typeof excludePartOfWords === 'string' || excludePartOfWords instanceof String) {
        // as the browser will have the string value only in case of 'false'
        excludePartOfWords = excludePartOfWords !== 'false';
    }
    $scope.searchConfig.excludePartOfWords = excludePartOfWords;
    var savedWordMatch = searchParameters().word_match;
    $scope.searchConfig.wordMatch = QuranQueryBuilder.wordModes.some(function (option) { return option.value === savedWordMatch; })
        ? savedWordMatch : (excludePartOfWords ? 'whole' : 'contains');

    // Number of items to load initially
    const initialLoadCount = 200;
    $scope.visibleFoundWords = [];
    $scope.showAllWords = false;
    $scope.showOnlySelectedResults = false;

    $scope.redirectTo = function (path) {
        // Use $window.location.href to redirect to the specified path
        $window.location.href = path;
    };

    // Function to load more items as the user scrolls
    $scope.loadMoreItems = function () {
        const totalVisibleItems = $scope.visibleFoundWords.length;
        const batchSize = 1000; // Number of items to load each time

        if (totalVisibleItems < $scope.resultsGroup.length) {
            const nextBatch = $scope.resultsGroup.slice(totalVisibleItems, totalVisibleItems + batchSize);
            $scope.visibleFoundWords = $scope.visibleFoundWords.concat(nextBatch);
        }
    };

    $scope.reference = {ayah: Number(urlQueryParameters.ayah) || null, surah: Number(urlQueryParameters.surah) || null};
    $scope.isCrossAyah = function () { return ($scope.queryBlocks || []).some(function (block) { return block.type === 'ayahBreak'; }); };
    $scope.queryExclusions = [];
    var matchAyat = function (newValue) {
        var rules = $scope.queryExclusions;
        var wordRules = rules.some(function (rule) { return rule.scope === 'word'; });
        // Every window has exactly the requested boundaries; ordinary word and
        // letter patterns cannot consume the private boundary marker.
        var boundaryCount = ($scope.userSearchQuery.match(/\uE004/g) || []).length;
        var candidates = all_ayat.map(function (source, index) {
            var parts = all_ayat.slice(index, index + boundaryCount + 1);
            if (parts.length !== boundaryCount + 1 || parts.some(function (part, offset) { return part.sura_id !== source.sura_id || part.verse_id !== source.verse_id + offset; })) return null;
            if ($scope.reference.ayah && source.verse_id !== Number($scope.reference.ayah)) return null;
            if ($scope.reference.surah && source.sura_id !== Number($scope.reference.surah)) return null;
            return Object.assign({}, source, {parts: parts, text: parts.map(function (part) { return part.text; }).join('\uE004')});
        }).filter(Boolean);
        return candidates.filter(function (item) {
            return item.text.match($scope.searchQueryRegex) !== null && !excludedBy(rules, 'verse', item.text);
        }).map(function (source) {
            var ayah = Object.assign({}, source);
            ayah.exact_match = [];
            ayah.matched = [];
            ayah.occurrenceCount = 0;
            var ranges = [], match;
            $scope.searchQueryRegex.lastIndex = 0;
            while ((match = $scope.searchQueryRegex.exec(ayah.text))) {
                if (!match[0].trim()) {
                    if ($scope.searchQueryRegex.lastIndex === match.index) $scope.searchQueryRegex.lastIndex++;
                    continue;
                }
                if (match.length > 1) $scope.resultsHaveCaptures = true;
                var offset = match.length > 1 ? 1 : 0;
                var found = match.slice(offset).filter(function (value, index) {
                    if (typeof value !== 'string' || !value.trim()) return false;
                    var range = match.indices[index + offset];
                    if (!range || (wordRules && excludedBy(rules, 'word', QuranQueryBuilder.wordContext(ayah.text.replace(/\uE004/g, ' '), range)))) return false;
                    ranges.push(range);
                    return true;
                });
                if (found.length) ayah.occurrenceCount++;
                if (!wordRules && found.length) ranges.push(match.indices[0]);
                found = found.map(function (value) { return value.replace(/\uE004/g, '۝'); });
                ayah.exact_match = ayah.exact_match.concat(found);
                ayah.matched = ayah.matched.concat(found.map(function (value) {
                    return $scope.shouldRemoveLastHarakah ? removeHarakatOfLastHarf(value) : value;
                }));
            }
            ayah.text_with_highlight = wordRules ? highlightRanges(ayah.text, ranges) : highlightText(ayah.text, $scope.searchQueryRegex);
            var position = 0;
            ayah.ayat = ayah.parts.map(function (part) {
                var start = position;
                position += part.text.length + 1;
                var localRanges = ranges.map(function (range) { return [Math.max(start, range[0]) - start, Math.min(position - 1, range[1]) - start]; }).filter(function (range) { return range[1] > range[0]; });
                return Object.assign({}, part, {text_with_highlight: highlightRanges(part.text, localRanges)});
            });
            return ayah;
        }).filter(function (ayah) { return ayah.matched.length > 0; });
    };

    $scope.$watch('searchQueryRegex', function (newValue) {

        $scope.query = '';
        if (newValue == "") {
            return;
        }

        $scope.resultsCrossAyah = ($scope.userSearchQuery || '').includes('\uE004');
        $scope.resultsHaveCaptures = ($scope.queryBlocks || []).some(function (block) { return ['capture', 'context'].includes(block.type) || (block.type === 'symbol' && block.symbolMode !== 'only'); });
        $scope.foundAyat = matchAyat(newValue);
        $scope.foundAyat = $scope.foundAyat.filter(function (item) {
            return item['matched'] !== null;
        });
        $scope.countedAyahAttributes = countByAttributes($scope.foundAyat, ['matched', 'sura_id']);
        $scope.sortBy = "counts";
        $scope.changeCountsAsPerFilter = false;
        $scope.isSearchDone = true;
        filterListener();
        $scope.scrollToMainContainer();

        // Utility functions
        $scope.searchRegex = function (item) {
            return item.match(new RegExp($scope.regexStrToSearch, "u"));
        };
    });

    // Watch the search results that are selected
    let filterListener = function (value) {
        var selected;

        $scope.count = function (prop, value) {
            return function (el) {
                return el[prop] == value;
            };
        };

        $scope.resultsGroup = uniqueItems($scope.foundAyat, 'matched');
        // Sort the array in ascending order
        $scope.sortResultsGroup = function () {
            if ($scope.sortBy == "letters") {
                $scope.resultsGroup = $scope.resultsGroup.sort((a, b) => a.localeCompare(b));
            } else if ($scope.sortBy == "counts") {
                $scope.resultsGroup = $scope.resultsGroup.sort(function (a, b) {
                    var firstCounts = $scope.countedAyahAttributes['matched'][a] + 0;
                    firstCounts = isNaN(firstCounts) ? 0 : firstCounts;
                    var secondCounts = $scope.countedAyahAttributes['matched'][b] + 0;
                    secondCounts = isNaN(secondCounts) ? 0 : secondCounts;
                    return secondCounts - firstCounts;
                });
            }
        };

        var uniqueAyat = new Set();
        var filterAfterResults = [];
        selected = false;
        for (var j in $scope.foundAyat) {
            var p = $scope.foundAyat[j];
            for (var i in $scope.useResults) {
                if ($scope.useResults[i]) {
                    selected = true;
                    var matches = valueShouldBeArray(p.matched);

                    for (var k = 0; k < matches.length; k++) {
                        if (i == matches[k]) {
                            uniqueAyat.add(p);
                            break;
                        }
                    }

                }
            }
        }
        filterAfterResults = Array.from(uniqueAyat);
        if (!selected) {
            filterAfterResults = $scope.foundAyat;
        }

        if (filterAfterResults.length == 0 && $scope.foundAyat.length > 0) {
            $location.search("filter_results", "");
        }

        $scope.suwarGroup = uniqueItems($scope.foundAyat, 'sura_id');
        $scope.sortSuwarGroup = function () {
            if ($scope.sortBy == "letters") {
                $scope.suwarGroup = $scope.suwarGroup.sort(function (a, b) {
                    var firstSurah = $scope.suwar[a - 1].title;
                    var secondSurah = $scope.suwar[b - 1].title;
                    return firstSurah.localeCompare(secondSurah);
                });
            } else if ($scope.sortBy == "counts") {
                $scope.suwarGroup = $scope.suwarGroup.sort(function (a, b) {
                    var firstCounts = $scope.countedAyahAttributes['sura_id'][a] + 0;
                    firstCounts = isNaN(firstCounts) ? 0 : firstCounts;
                    var secondCounts = $scope.countedAyahAttributes['sura_id'][b] + 0;
                    secondCounts = isNaN(secondCounts) ? 0 : secondCounts;
                    return secondCounts - firstCounts;
                });
            }
        };

        var filterAfterSuwar = [];
        selected = false;
        for (var j in filterAfterResults) {
            var p = filterAfterResults[j];
            for (var i in $scope.useSuwar) {
                if ($scope.useSuwar[i]) {
                    selected = true;
                    if (i == p.sura_id) {
                        filterAfterSuwar.push(p);
                        break;
                    }
                }
            }
        }

        if (!selected) {
            filterAfterSuwar = filterAfterResults;
        }

        if (filterAfterSuwar.length == 0 && $scope.foundAyat.length > 0) {
            $location.search("filter_suwar", "");
        }

        $scope.filteredAyat = filterAfterSuwar;
        $scope.resultStats = QuranResults.summary(filterAfterSuwar);
        $scope.distinctAyahCount = new Set(filterAfterSuwar.reduce(function (ids, group) { return ids.concat(group.ayat.map(function (ayah) { return ayah.sura_id + ':' + ayah.verse_id; })); }, [])).size;

        if ($scope.changeCountsAsPerFilter) {
            $scope.countedAyahAttributes = countByAttributes($scope.filteredAyat, ['matched', 'sura_id']);
        } else {
            $scope.countedAyahAttributes = countByAttributes($scope.foundAyat, ['matched', 'sura_id']);
        }

        $scope.sortResultsGroup();
        $scope.sortSuwarGroup();

        // reset pagination
        $scope.currentPage = 0;

        // now group by pages
        $scope.groupToPages();

    };

    $scope.$watch(function () {
        return {
            //foundAyat: $scope.foundAyat,
            useResults: $scope.useResults,
            useSuwar: $scope.useSuwar,
        }
    }, function () {
        filterListener();
        let resetPositions = $scope.changeCountsAsPerFilter && $scope.sortBy === "counts";
        if ($scope.visibleFoundWords.length === 0 || resetPositions) {
            if ($scope.showAllWords) {
                $scope.visibleFoundWords = $scope.resultsGroup;
            } else {
                $scope.visibleFoundWords = $scope.resultsGroup.slice(0, initialLoadCount);
            }
        }
        // First fix the bug of having the useResults updated and causing the scroll position to reset to top, then uncomment this:
        // let filterResultsKeys = getTrueKeys($scope.useResults).join(",");
        // if (searchParameters()["filter_results"] !== filterResultsKeys) {
        //     $location.search( "filter_results", filterResultsKeys);
        // }
        // let filterSuwarKeys = getTrueKeys($scope.useSuwar).join(",");
        // if (searchParameters()["filter_suwar"] !== filterSuwarKeys) {
        //     $location.search( "filter_suwar", filterSuwarKeys);
        // }
    }, true);

    $scope.$watch(function () {
        return {
            updateCounts: $scope.changeCountsAsPerFilter,
            sortBy: $scope.sortBy
        }
    }, function () {
        filterListener();
        if ($scope.showAllWords) {
            $scope.visibleFoundWords = $scope.resultsGroup;
        } else {
            $scope.visibleFoundWords = $scope.resultsGroup.slice(0, initialLoadCount);
        }
    }, true);


    $scope.$watch('filtered', function (newValue) {
        if (angular.isArray(newValue)) {
            console.log(newValue.length);
        }
    }, true);

    // Function to handle the scroll event and trigger loading more items
    function onScroll() {
        const element = angular.element(".scroll-container")[0];
        let loadingOffset = 150;
        let isFullyLoaded = $scope.visibleFoundWords.length === $scope.resultsGroup.length
        if (!isFullyLoaded && !$scope.isLoading && element.scrollTop + element.clientHeight + loadingOffset >= element.scrollHeight) {
            $scope.isLoading = true;
            $scope.$apply($scope.loadMoreItems);
            $timeout(function () {
                $scope.isLoading = false;
            }, 300);
        }
    }

    // Bind the scroll event handler to the scrollable container
    angular.element(".scroll-container").on('scroll', onScroll);

    //allow_pagination($scope);

    //just to test watcher
    var initSearchStr = '';
    var search = (searchParameters()["s"] || "");

    if (search != "") {
        initSearchStr = search;
    }

    $scope.userSearchQuery = initSearchStr;
    $scope.isSearchDone = false;
    $scope.hasInputError = false;
    $scope.scrollToMainContainer = function () {
        // set the location hash to the ID of your target element
        $location.hash('main-container');

        // call $anchorScroll()
        $anchorScroll();
    };

    var nextBlockId = 0;
    $scope.blockTypes = QuranQueryBuilder.types;
    $scope.harakahOptions = QuranQueryBuilder.marks;
    $scope.letterOptions = QuranQueryBuilder.alphabet;
    $scope.repetitionOptions = QuranQueryBuilder.repetitions;
    $scope.wordMatchOptions = QuranQueryBuilder.wordModes;
    $scope.blockPreview = QuranQueryBuilder.preview;
    $scope.textMatchOptions = QuranQueryBuilder.textModes;
    $scope.symbolOptions = QuranQueryBuilder.symbols;
    $scope.symbolInfo = QuranQueryBuilder.symbolInfo;
    $scope.listMatchOptions = QuranQueryBuilder.listModes;
    $scope.gapOptions = QuranQueryBuilder.gapModes;
    $scope.distanceDescription = QuranQueryBuilder.distanceDescription;
    $scope.newBlockType = 'text';
    $scope.builderError = '';
    $scope.queryEdited = false;

    function setExclusions(compiled) {
        $scope.queryExclusions = (compiled.exclusions || []).map(function (rule) {
            return {scope: rule.scope, pattern: getRegexPatternForString(rule.query, {wordMatch: 'contains'})};
        });
    }

    function restoreBuilder(query) {
        var blocks = null;
        var saved = searchParameters().qb;
        if (typeof saved === 'string') {
            try {
                var candidate = JSON.parse(saved);
                if (Array.isArray(candidate) && QuranQueryBuilder.compile(candidate).query === query) blocks = candidate;
            } catch (error) { /* Older links need no structured query. */ }
        }
        if (!blocks) blocks = QuranQueryBuilder.parse(query);
        $scope.savedQueryOnly = !blocks;
        $scope.queryBlocks = QuranQueryBuilder.normalise(blocks || []);
        $scope.queryBlocks.forEach(function (block) { block.id = ++nextBlockId; });
        setExclusions(QuranQueryBuilder.compile($scope.queryBlocks));
    }
    restoreBuilder(initSearchStr);

    $scope.blockHint = function (block) {
        return $scope.blockTypes.find(function (type) { return type.value === block.type; }).hint;
    };
    $scope.builderChanged = function () {
        $scope.builderError = '';
        $scope.hasInputError = false;
        $scope.queryEdited = true;
    };
    function focusBlock(id) {
        $timeout(function () {
            var element = document.getElementById('query-block-' + id);
            if (element) element.focus();
        }, 0, false);
    }
    $scope.addBlock = function (requestedType) {
        var type = requestedType || $scope.newBlockType;
        var block = QuranQueryBuilder.create(type);
        var onlyBlock = $scope.queryBlocks.length === 1 && $scope.queryBlocks[0];
        if (onlyBlock && onlyBlock.type === 'text' && type !== 'exclude' && (!onlyBlock.value.trim() || ['context', 'between', 'alternatives'].includes(type))) {
            if (type === 'context' || type === 'between') block.value = onlyBlock.value;
            if (type === 'alternatives') block.choices[0].value = onlyBlock.value;
            $scope.queryBlocks = [];
        }
        var previous = $scope.queryBlocks.filter(function (part) { return part.type !== 'exclude'; }).slice(-1)[0];
        if (block.type === 'text' && previous && previous.type === 'text') block.join = 'space';
        block.id = ++nextBlockId;
        $scope.queryBlocks.push(block);
        $scope.builderChanged();
        focusBlock(block.id);
    };
    $scope.changeBlockType = function (block) {
        var value = ['text', 'context', 'between'].includes(block.type) ? block.value : '';
        Object.assign(block, QuranQueryBuilder.create(block.type, value), {join: block.join});
        $scope.builderChanged();
    };
    $scope.addChoice = function (block) {
        if (block.choices.length < 10) block.choices.push({value: ''});
        $scope.builderChanged();
    };
    $scope.removeChoice = function (block, index) {
        var minimum = block.type === 'exclude' ? 1 : 2;
        if (block.choices.length > minimum) block.choices.splice(index, 1);
        $scope.builderChanged();
    };
    $scope.wordMatchChanged = function () {
        $scope.searchConfig.excludePartOfWords = $scope.searchConfig.wordMatch === 'whole';
        $scope.builderChanged();
    };
    $scope.textMatchHint = function (block) {
        return $scope.textMatchOptions.find(function (option) { return option.value === block.matchMode; }).hint;
    };
    $scope.wordMatchHint = function () {
        return $scope.wordMatchOptions.find(function (option) { return option.value === $scope.searchConfig.wordMatch; }).hint;
    };
    $scope.canConnect = function (index) {
        var parts = ['text', 'letter', 'letters', 'alternatives'];
        var previous = $scope.queryBlocks.slice(0, index).filter(function (part) { return part.type !== 'exclude'; }).slice(-1)[0];
        return previous && parts.includes($scope.queryBlocks[index].type) && parts.includes(previous.type)
            && !QuranQueryBuilder.separates(previous, $scope.queryBlocks[index]);
    };
    $scope.hasSpaceBefore = function (index) {
        var previous = $scope.queryBlocks.slice(0, index).filter(function (part) { return part.type !== 'exclude'; }).slice(-1)[0];
        return previous && previous.type !== 'ayahBreak' && !['exclude', 'ayahBreak'].includes($scope.queryBlocks[index].type) && !$scope.canConnect(index);
    };
    $scope.moveBlock = function (index, direction) {
        var destination = index + direction;
        if (destination < 0 || destination >= $scope.queryBlocks.length) return;
        var block = $scope.queryBlocks.splice(index, 1)[0];
        $scope.queryBlocks.splice(destination, 0, block);
        $scope.builderChanged();
        focusBlock(block.id);
    };
    $scope.removeBlock = function (index) {
        $scope.queryBlocks.splice(index, 1);
        $scope.builderChanged();
        if ($scope.queryBlocks.length) focusBlock($scope.queryBlocks[Math.min(index, $scope.queryBlocks.length - 1)].id);
        else $timeout(function () {
            var element = document.getElementById('new-block-type');
            if (element) element.focus();
        }, 0, false);
    };
    $scope.startNewQuery = function () {
        $location.search({});
    };

    function startSearchingByEnteredText(enteredSearchStr) {
        $scope.hasInputError = false;
        var regexPatternForString = getRegexPatternForString(enteredSearchStr, $scope.searchConfig);
        if (regexPatternForString) {
            $scope.searchQueryRegex = regexPatternForString; // This will trigger $watch expression to kick in
        } else {
            $scope.hasInputError = true;
        }
    }

    if (initSearchStr != "") {
        startSearchingByEnteredText(initSearchStr);
    }

    $scope.useExample = function (query) {
        $location.search({s: query});
        $scope.reference = {ayah: null, surah: null};
        restoreBuilder(query);
        $scope.userSearchQuery = query;
        $scope.builderError = '';
        $scope.queryEdited = false;
        $scope.searchConfig = {searchFromBeginning: false, searchOnEnd: false, excludePartOfWords: false, wordMatch: 'contains'};
        $scope.shouldRemoveLastHarakah = false;
        $scope.useResults = {};
        $scope.useSuwar = {};
        startSearchingByEnteredText(query);
    };

    $scope.loadPreset = function (name) {
        function part(type, value, extra) { return Object.assign(QuranQueryBuilder.create(type, value), extra || {}); }
        var presets = {
            crossAyah: [part('text', 'العالمين', {matchMode: 'whole'}), part('ayahBreak'), part('text', 'الرحمن', {matchMode: 'whole'})],
            exclusion: [part('text', 'علم'), part('exclude', '', {scope: 'word', matchMode: 'ends', choices: [{value: 'ون'}]})],
            capture: [part('context', 'ولكن', {count: 3, direction: 'after'})]
        };
        if (!presets[name]) return;
        $scope.queryBlocks = presets[name];
        $scope.queryBlocks.forEach(function (block) { block.id = ++nextBlockId; });
        $scope.savedQueryOnly = false;
        $scope.reference = {ayah: null, surah: null};
        $scope.searchConfig = {searchFromBeginning: false, searchOnEnd: false, excludePartOfWords: false, wordMatch: 'contains'};
        $scope.shouldRemoveLastHarakah = false;
        $scope.searchButtonClicked();
    };

    $scope.exportResults = function (kind) {
        var rows = kind === 'ayat' ? QuranResults.ayahRows($scope.filteredAyat, all_suwar, publicBaseUrl()) : QuranResults.frequencyRows($scope.filteredAyat, all_suwar, publicBaseUrl());
        download(QuranResults.csv(rows), 'text/csv;charset=utf-8', kind === 'ayat' ? 'quran-ayat.csv' : 'quran-frequencies.csv');
    };

    $scope.searchButtonClicked = function () {
        if ($scope.savedQueryOnly) return;
        var compiled = QuranQueryBuilder.compile($scope.queryBlocks);
        $scope.builderError = compiled.error || '';
        if (compiled.error) return;
        if ($scope.reference.ayah !== null && (!Number.isInteger($scope.reference.ayah) || $scope.reference.ayah < 1 || $scope.reference.ayah > 286)) {
            $scope.builderError = 'اختر رقم آية صحيحاً من 1 إلى 286.'; return;
        }
        $scope.userSearchQuery = compiled.query;
        setExclusions(compiled);
        // Search explicitly even when the URL has not changed (for example,
        // after editing and restoring the same blocks).
        $scope.useResults = {};
        $scope.useSuwar = {};
        startSearchingByEnteredText(compiled.query);
        $scope.queryEdited = false;
        var blocks = $scope.queryBlocks.map(function (block) {
            return {
                type: block.type, value: block.value, join: block.join, mark: block.mark, shadda: block.shadda,
                letterMode: block.letterMode, repetition: block.repetition, count: block.count,
                direction: block.direction, endValue: block.endValue, matchMode: block.matchMode, symbol: block.symbol, symbolMode: block.symbolMode,
                minCount: block.minCount, maxCount: block.maxCount, letterOptional: block.letterOptional,
                gapMode: block.gapMode, gapCount: block.gapCount, gapMin: block.gapMin, gapMax: block.gapMax, order: block.order,
                scope: block.scope, choices: ['alternatives', 'exclude'].includes(block.type) ? block.choices.map(function (choice) { return {value: choice.value}; }) : undefined
            };
        });
        saveParameters({
            ayah: $scope.reference.ayah || undefined, surah: $scope.reference.surah || undefined,
            s: compiled.query, qb: JSON.stringify(blocks),
            remove_harakah: $scope.shouldRemoveLastHarakah,
            search_only_from_beginning: $scope.searchConfig.searchFromBeginning,
            search_only_on_end: $scope.searchConfig.searchOnEnd,
            exclude_part_of_words: $scope.searchConfig.excludePartOfWords,
            word_match: $scope.searchConfig.wordMatch
        });
    };

    // Function to update the URL with the current search parameters
    $scope.updateUrl = function () {
        var currentSearchParams = searchParameters();

        currentSearchParams.filter_results = getTrueKeys($scope.useResults).join(",");
        currentSearchParams.filter_suwar = getTrueKeys($scope.useSuwar).join(",");

        saveParameters(currentSearchParams);
    };

    $scope.copySearchLink = function () {
        var params = currentSearchParameters();
        $scope.shareUrl = publicBaseUrl() + '#!/search?q=' + QuranSearchLink.encode(params);
        $scope.copyLinkStatus = '';
        function fallback() {
            var input = document.getElementById('saved-search-link');
            if (input) {
                input.focus(); input.select();
                try {
                    if (document.execCommand('copy')) { $scope.copyLinkStatus = 'تم نسخ الرابط'; return; }
                } catch (error) { /* Keep the selected URL available for manual copy. */ }
            }
            $scope.copyLinkStatus = 'حدد الرابط وانسخه لفتح البحث نفسه';
        }
        if ($window.navigator.clipboard && $window.navigator.clipboard.writeText) {
            $window.navigator.clipboard.writeText($scope.shareUrl).then(function () {
                $scope.$evalAsync(function () { $scope.copyLinkStatus = 'تم نسخ الرابط'; });
            }, function () { $timeout(fallback, 0); });
        } else $timeout(fallback, 0);
    };

    $scope.clearResultsFilter = function () {
        $scope.useResults = {};
    };

    $scope.clearSuwarFilter = function () {
        $scope.useSuwar = {};
    };

    $scope.$on("$locationChangeSuccess", handleLocationChange);

    // Handle the location changes and make sure the view is updated.
    // The search begins here even when the user clicks on the search button
    function handleLocationChange(event) {
        if ($location.path() != "/search") {
            return;
        }
        let urlQueryParameters = searchParameters();
        let search = (urlQueryParameters["s"] || "");
        if (search !== $scope.userSearchQuery) {
            startSearchingByEnteredText(search);
        }
        let filter_results = (urlQueryParameters["filter_results"] || "");
        if (filter_results !== getTrueKeys($scope.useResults).join(",")) {
            $scope.useResults = mapToTrueObject(filter_results.split(","));
        }
        let filter_suwar = (urlQueryParameters["filter_suwar"] || "");
        if (filter_suwar !== getTrueKeys($scope.useSuwar).join(",")) {
            $scope.useSuwar = mapToTrueObject(filter_suwar.split(","));
        }
    }


});

myApp.filter('groupBy',
    function () {
        return function (collection, key) {
            if (collection === null) return;
            return uniqueItems(collection, key);
        };
    });

function highlight(str, str_to_highlight) {
    return str.replace(str_to_highlight, '<b class="highlightedText">' + str_to_highlight + '</b>');
}

function surah_name(id) {
    return all_suwar[id].title;
}

function allow_pagination($scope) {

    $scope.itemsPerPage = 20;
    $scope.pagedItems = [];
    $scope.currentPage = 0;

    // calculate page in place
    $scope.groupToPages = function () {
        $scope.pagedItems = [];

        for (var i = 0; i < $scope.filteredAyat.length; i++) {
            if (i % $scope.itemsPerPage === 0) {
                $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)] = [$scope.filteredAyat[i]];
            } else {
                $scope.pagedItems[Math.floor(i / $scope.itemsPerPage)].push($scope.filteredAyat[i]);
            }
        }
    };

    $scope.range = function (start, end) {
        var ret = [];
        if (!end) {
            end = start;
            start = 0;
        }
        for (var i = start; i < end; i++) {
            ret.push(i);
        }
        return ret;
    };

    $scope.prevPage = function () {
        if ($scope.currentPage > 0) {
            $scope.currentPage--;
        }
    };

    $scope.nextPage = function () {
        if ($scope.currentPage < $scope.pagedItems.length - 1) {
            $scope.currentPage++;
        }
    };

    $scope.setPage = function () {
        $scope.currentPage = this.n;
    };

}
