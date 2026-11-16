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

    var ignored_chars = '\uE002\uE003:<>!{}+-.(|)[]*?؟$^ ْ' + numbers + kul_alharakat;
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

    // A single optional path avoids exponentially many identical empty
    // separator matches when a word-gap spans a long verse.
    text = text.replace(/(?!^)\s+/g, "(?: [" + quran_symbols + "])* ");

    if (config.searchFromBeginning && config.searchOnEnd) {
        text = '^ ' + text.trim() + ' $';  // trims text and adds space after ^ and before $
    } else if (config.searchFromBeginning) {
        text = '^ ' + text.trimStart();  // trims starting space from text and adds space after ^
    } else if (config.searchOnEnd) {
        text = text.trimEnd() + ' $';  // trims ending space from text and adds space before $
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

    try {
        text = new RegExp(text, regex_flags);
    } catch (error) {
        return null;
    }

    return text;
}

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
        .when("/search-features", {
            templateUrl: "view/search-features.html",
            controller: "SearchHelpController"
        })
        .otherwise({
            redirectTo: '/search'
        });
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

myApp.controller('AyatSearchController', function ($scope, $window, $http, $routeParams, $location, $timeout, $anchorScroll) {
    allow_pagination($scope);
    //init filters
    let urlQueryParameters = $location.search();
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
    var removeLastHarakah = $location.search()["remove_harakah"];
    if (typeof removeLastHarakah === 'string' || removeLastHarakah instanceof String) {
        // as the browser will have the string value only in case of 'false'
        removeLastHarakah = removeLastHarakah !== 'false';
    }
    $scope.shouldRemoveLastHarakah = removeLastHarakah;

    // boolean or string, to search directly from the start of ayat
    var searchOnlyFromBeginning = $location.search()["search_only_from_beginning"];
    if (typeof searchOnlyFromBeginning === 'string' || searchOnlyFromBeginning instanceof String) {
        // as the browser will have the string value only in case of 'false'
        searchOnlyFromBeginning = searchOnlyFromBeginning !== 'false';
    }
    $scope.searchConfig.searchFromBeginning = searchOnlyFromBeginning;

    // boolean or string, to search directly from the end of ayat
    var searchOnlyOnEnd = $location.search()["search_only_on_end"];
    if (typeof searchOnlyOnEnd === 'string' || searchOnlyOnEnd instanceof String) {
        // as the browser will have the string value only in case of 'false'
        searchOnlyOnEnd = searchOnlyOnEnd !== 'false';
    }
    $scope.searchConfig.searchOnEnd = searchOnlyOnEnd;

    // boolean or string, to exclude searching for part of words
    var excludePartOfWords = $location.search()["exclude_part_of_words"];
    if (typeof excludePartOfWords === 'string' || excludePartOfWords instanceof String) {
        // as the browser will have the string value only in case of 'false'
        excludePartOfWords = excludePartOfWords !== 'false';
    }
    $scope.searchConfig.excludePartOfWords = excludePartOfWords;
    var savedWordMatch = $location.search().word_match;
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

    var matchAyat = function (newValue) {
        var filtered_ayat = all_ayat.filter(function (item) {
            var foundStr = item["text"].match($scope.searchQueryRegex);
            return foundStr !== null;
        });

        return filtered_ayat.map(function (ayah) {

            ayah["exact_match"] = [];
            ayah["matched"] = [];
            ayah["text_with_highlight"] = ayah["text"];

            var match = null;
            while (match = $scope.searchQueryRegex.exec(ayah["text"])) {
                var foundStr = match;

                if ((foundStr + "").trim() == "") {
                    if ($scope.searchQueryRegex.lastIndex == foundStr.index) {
                        // prevent infinite loop
                        $scope.searchQueryRegex.lastIndex += 1;
                    }
                    continue;
                }

                let wholeMatchedPart = foundStr[0];
                // remove the exact match if there is a captured group or more
                if (foundStr.length > 1) {
                    foundStr.shift();
                }

                //item["text"].slice(foundStr.index,foundStr.index+foundStr[1].length)

                ayah["exact_match"] = ayah["exact_match"].concat(foundStr); //remove first matching result
                ayah["matched"] = ayah["matched"].concat(foundStr.map(function (str) {
                    if ($scope.shouldRemoveLastHarakah) {
                        return removeHarakatOfLastHarf(str);
                    } else {
                        return str;
                    }
                }));
            }

            ayah["text_with_highlight"] = highlightText(ayah["text_with_highlight"], $scope.searchQueryRegex);

            return ayah;
        });
    };

    $scope.$watch('searchQueryRegex', function (newValue) {

        $scope.query = '';
        if (newValue == "") {
            return;
        }

        $scope.foundAyat = matchAyat(newValue);
        $scope.foundAyat = $scope.foundAyat.filter(function (item) {
            return item['matched'] !== null;
        });
        $scope.countedAyahAttributes = countByAttributes($scope.foundAyat, ['matched', 'sura_id']);
        $scope.sortBy = "counts";
        $scope.changeCountsAsPerFilter = false;
        $scope.isSearchDone = true;
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
        // if ($location.search()["filter_results"] !== filterResultsKeys) {
        //     $location.search( "filter_results", filterResultsKeys);
        // }
        // let filterSuwarKeys = getTrueKeys($scope.useSuwar).join(",");
        // if ($location.search()["filter_suwar"] !== filterSuwarKeys) {
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
    var search = ($location.search()["s"] || "");

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
    $scope.newBlockType = 'text';
    $scope.builderError = '';
    $scope.queryEdited = false;

    function restoreBuilder(query) {
        var blocks = null;
        var saved = $location.search().qb;
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
        if (onlyBlock && onlyBlock.type === 'text' && (!onlyBlock.value.trim() || type === 'context' || type === 'between')) {
            if (type === 'context' || type === 'between') block.value = onlyBlock.value;
            $scope.queryBlocks = [];
        }
        var previous = $scope.queryBlocks[$scope.queryBlocks.length - 1];
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
        var parts = ['text', 'letter', 'letters'];
        return index > 0 && parts.includes($scope.queryBlocks[index].type) && parts.includes($scope.queryBlocks[index - 1].type)
            && !QuranQueryBuilder.separates($scope.queryBlocks[index - 1], $scope.queryBlocks[index]);
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

    $scope.searchButtonClicked = function () {
        if ($scope.savedQueryOnly) return;
        var compiled = QuranQueryBuilder.compile($scope.queryBlocks);
        $scope.builderError = compiled.error || '';
        if (compiled.error) return;
        $scope.userSearchQuery = compiled.query;
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
                direction: block.direction, endValue: block.endValue, matchMode: block.matchMode, symbol: block.symbol, symbolMode: block.symbolMode
            };
        });
        $location.search("s", compiled.query);
        $location.search("qb", JSON.stringify(blocks));
        $location.search("remove_harakah", $scope.shouldRemoveLastHarakah);
        $location.search("search_only_from_beginning", $scope.searchConfig.searchFromBeginning);
        $location.search("search_only_on_end", $scope.searchConfig.searchOnEnd);
        $location.search("exclude_part_of_words", $scope.searchConfig.excludePartOfWords);
        $location.search("word_match", $scope.searchConfig.wordMatch);
        $location.search("filter_results", "");
        $location.search("filter_suwar", "");
    };

    // Function to update the URL with the current search parameters
    $scope.updateUrl = function () {
        // Get the current search parameters from $location.search()
        var currentSearchParams = $location.search();

        currentSearchParams.filter_results = getTrueKeys($scope.useResults).join(",");
        currentSearchParams.filter_suwar = getTrueKeys($scope.useSuwar).join(",");

        // Set the updated search parameters using $location.search()
        $location.search(currentSearchParams);
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
        let urlQueryParameters = $location.search();
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
