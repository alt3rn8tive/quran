/* Statistics of the bundled, numbered ayat; no synthetic text or linguistic stemming. */
var QuranSurahStats = {
    letters: function (text) { return text.normalize('NFC').match(/[\u0621-\u063A\u0641-\u064A\u0671]/gu) || []; },
    key: function (word, marks) {
        return marks === 'keep' ? word.normalize('NFC') : QuranSurahStats.letters(word).join('');
    },
    tokens: function (text) {
        var pattern = /[\u0621-\u063A\u0641-\u064A\u0671][\u0621-\u063A\u0641-\u065F\u0670\u0671]*/gu;
        var tokens = [], match;
        while ((match = pattern.exec(text))) tokens.push({text:match[0], start:match.index, end:pattern.lastIndex});
        return tokens;
    },
    calculate: function (ayat, surahId, marks) {
        var words = new Map(), letters = new Map(), totalWords = 0, totalLetters = 0;
        var verses = ayat.filter(function (ayah) { return ayah.sura_id === surahId; }).map(function (ayah) {
            var tokens = QuranSurahStats.tokens(ayah.text), count = 0;
            tokens.forEach(function (token) {
                var key = QuranSurahStats.key(token.text, marks);
                if (!words.has(key)) words.set(key, {key:key, count:0, verseIds:new Set()});
                var word = words.get(key); word.count++; word.verseIds.add(ayah.verse_id);
                QuranSurahStats.letters(token.text).forEach(function (letter) { letters.set(letter, (letters.get(letter) || 0) + 1); count++; });
            });
            totalWords += tokens.length; totalLetters += count;
            return {verse_id:ayah.verse_id, sura_id:ayah.sura_id, text:ayah.text, tokens:tokens, wordCount:tokens.length, letterCount:count};
        });
        var wordRows = Array.from(words.values()).map(function (word) { return Object.assign({}, word, {verseIds:Array.from(word.verseIds)}); });
        wordRows.sort(function (a,b) { return b.count - a.count || a.key.localeCompare(b.key); });
        var letterRows = Array.from(letters).map(function (entry) { return {letter:entry[0], count:entry[1], percentage:totalLetters ? 100 * entry[1] / totalLetters : 0}; });
        letterRows.sort(function (a,b) { return b.count - a.count || a.letter.localeCompare(b.letter); });
        var max = verses.length ? Math.max.apply(null, verses.map(function (verse) { return verse.wordCount; })) : 0;
        var min = verses.length ? Math.min.apply(null, verses.map(function (verse) { return verse.wordCount; })) : 0;
        return {verses:verses, words:wordRows, letters:letterRows, ayahCount:verses.length, totalWords:totalWords, totalLetters:totalLetters,
            distinctWords:words.size, singletons:wordRows.filter(function (word) { return word.count === 1; }).length,
            averageWords:verses.length ? totalWords / verses.length : 0, maxWords:max, minWords:min,
            longest:verses.filter(function (verse) { return verse.wordCount === max; }), shortest:verses.filter(function (verse) { return verse.wordCount === min; })};
    },
    occurrences: function (stats, word, marks) {
        return stats.verses.map(function (verse) {
            var ranges = verse.tokens.filter(function (token) { return QuranSurahStats.key(token.text, marks) === word; }).map(function (token) { return [token.start,token.end]; });
            return {verse_id:verse.verse_id, sura_id:verse.sura_id, count:ranges.length, html:highlightRanges(verse.text,ranges)};
        }).filter(function (verse) { return verse.count > 0; });
    }
};

myApp.controller('SurahStatisticsController', function ($scope, $location, $window, $timeout) {
    $scope.suwar = all_suwar;
    $scope.viewState = {id:1, marks:'ignore', tab:'words', word:null, ayah:null, metric:'words', start:1, end:null, letter:null};
    $scope.diagramOptions = {wordLimit:10, start:1, end:1};
    $scope.wordOptions = {filter:'', once:false, sort:'frequency', limit:20, occurrenceLimit:10};
    function baseUrl() { var url = new URL($location.absUrl()); url.hash=''; url.searchParams.delete('release'); return url.href; }
    function pageState() {
        return Object.assign({}, $scope.viewState, {bars:Number($scope.diagramOptions.wordLimit)===20 ? 20:undefined, filter:$scope.wordOptions.filter || undefined, once:$scope.wordOptions.once ? true : undefined, sort:$scope.wordOptions.sort === 'alphabetical' ? 'alphabetical' : undefined});
    }
    function saveState() {
        $location.search({state:QuranSearchLink.encode(pageState())});
        $scope.statisticsLink = ''; $scope.copyStatisticsStatus = '';
    }
    function selectWord() {
        if (!$scope.activeWord || $scope.activeWord.key !== $scope.viewState.word) $scope.wordOptions.occurrenceLimit=10;
        $scope.activeWord = $scope.stats.words.find(function (word) { return word.key === $scope.viewState.word; }) || null;
        $scope.wordOccurrences = $scope.activeWord ? QuranSurahStats.occurrences($scope.stats, $scope.activeWord.key, $scope.viewState.marks) : [];
        if (!$scope.activeWord) $scope.viewState.word = null;
    }
    function applyState(state) {
        var id = Number(state.id);
        if (!Number.isInteger(id) || id < 1 || id > 114) id = 1;
        var marks = state.marks === 'keep' ? 'keep' : 'ignore';
        if (!$scope.stats || $scope.viewState.id !== id || $scope.viewState.marks !== marks) {
            $scope.stats = QuranSurahStats.calculate(all_ayat, id, marks);
            $scope.wordOptions.filter=''; $scope.wordOptions.once=false; $scope.wordOptions.limit=20;
        }
        $scope.viewState = {id:id, marks:marks, tab:['words','letters','lengths'].includes(state.tab) ? state.tab : 'words', word:typeof state.word === 'string' ? state.word : null, ayah:Number(state.ayah) || null, metric:state.metric === 'letters' ? 'letters':'words', start:state.start, end:state.end, letter:typeof state.letter === 'string' ? state.letter:null};
        $scope.wordOptions.filter=typeof state.filter === 'string' ? state.filter.slice(0,100) : '';
        $scope.wordOptions.once=state.once === true;
        $scope.wordOptions.sort=state.sort === 'alphabetical' ? 'alphabetical' : 'frequency';
        $scope.selectedSurah = all_suwar[id-1];
        $scope.selectedStatsAyah = $scope.stats.verses.find(function (verse) { return verse.verse_id === $scope.viewState.ayah; }) || $scope.stats.verses[0];
        var range=QuranStatisticsCharts.range($scope.stats.verses,state.start,state.end);
        $scope.viewState.start=range[0]; $scope.viewState.end=range[1];
        if ($scope.selectedStatsAyah.verse_id<range[0] || $scope.selectedStatsAyah.verse_id>range[1]) $scope.selectedStatsAyah=$scope.stats.verses.find(function (verse) { return verse.verse_id===range[0]; });
        $scope.viewState.ayah = $scope.selectedStatsAyah.verse_id;
        $scope.diagramOptions.wordLimit=state.bars===20 ? 20:10;
        updateRangeSummary(); updateLetterSelection();
        selectWord();
    }
    function scrollSelectedVerse() {
        if ($scope.viewState.tab !== 'lengths') return;
        $timeout(function () {
            var bar=document.getElementById('stats-bar-'+$scope.viewState.ayah);
            if (bar) bar.scrollIntoView({block:'nearest',inline:'center'});
        },0,false);
    }
    function readLocation() {
        var raw = $location.search();
        var state = typeof raw.state === 'string' ? QuranSearchLink.parameters({q:raw.state}) : raw;
        var previous=Object.assign({},$scope.viewState);
        applyState(state);
        $scope.statisticsLink=''; $scope.copyStatisticsStatus='';
        if (previous.tab !== $scope.viewState.tab || (previous.ayah !== $scope.viewState.ayah && previous.start === $scope.viewState.start && previous.end === $scope.viewState.end)) scrollSelectedVerse();
    }
    readLocation();
    $scope.$on('$routeUpdate', function () { readLocation(); });
    $scope.changeStatistics = function () {
        // Changing the selector updates viewState before this handler runs.
        $scope.stats = null;
        applyState(Object.assign({}, $scope.viewState, {word:null,ayah:null,start:null,end:null,letter:null})); saveState();
    };
    $scope.updateStatisticsFilters = function () { saveState(); $location.replace(); };
    $scope.switchStatsTab = function (tab) { $scope.viewState.tab=tab; saveState(); };
    $scope.chooseStatsWord = function (word) { $scope.viewState.word=word ? word.key : null; selectWord(); saveState(); };
    $scope.chooseStatsAyah = function (verse) {
        $scope.selectedStatsAyah=verse; $scope.viewState.ayah=verse.verse_id; $scope.viewState.tab='lengths';
        if (verse.verse_id<$scope.viewState.start || verse.verse_id>$scope.viewState.end) {
            $scope.viewState.start=$scope.stats.verses[0].verse_id; $scope.viewState.end=$scope.stats.verses[$scope.stats.verses.length-1].verse_id; updateRangeSummary();
        }
        saveState(); scrollSelectedVerse();
    };
    function updateRangeSummary() {
        $scope.diagramOptions.start=$scope.viewState.start; $scope.diagramOptions.end=$scope.viewState.end;
        $scope.rangeVerses=$scope.stats.verses.filter(function (verse) { return verse.verse_id>=$scope.viewState.start && verse.verse_id<=$scope.viewState.end; });
        $scope.rangeSummary={ayat:$scope.rangeVerses.length, words:$scope.rangeVerses.reduce(function (sum,verse) { return sum+verse.wordCount; },0), letters:$scope.rangeVerses.reduce(function (sum,verse) { return sum+verse.letterCount; },0)};
    }
    $scope.setDiagramRange = function (start,end) {
        var range=QuranStatisticsCharts.range($scope.stats.verses,start,end);
        $scope.viewState.start=range[0]; $scope.viewState.end=range[1];
        if ($scope.selectedStatsAyah.verse_id<range[0] || $scope.selectedStatsAyah.verse_id>range[1]) { $scope.selectedStatsAyah=$scope.stats.verses.find(function (verse) { return verse.verse_id===range[0]; }); $scope.viewState.ayah=range[0]; }
        updateRangeSummary(); saveState();
    };
    $scope.applyDiagramRange = function () { $scope.setDiagramRange($scope.diagramOptions.start,$scope.diagramOptions.end); };
    $scope.resetDiagramRange = function () { $scope.setDiagramRange(null,null); };
    $scope.changeWordDiagramLimit = function () { saveState(); $location.replace(); };
    $scope.changeDiagramMetric = function () { saveState(); };
    function updateLetterSelection() {
        var key=$scope.viewState.letter;
        $scope.selectedLetterRows=key==='other' ? $scope.stats.letters.slice(8) : $scope.stats.letters.filter(function (row) { return row.letter===key; });
        if (!$scope.selectedLetterRows.length) $scope.viewState.letter=null;
        var count=$scope.selectedLetterRows.reduce(function (sum,row) { return sum+row.count; },0);
        $scope.selectedLetterSummary={label:key==='other' ? 'بقية الحروف':key, count:count, percentage:$scope.stats.totalLetters ? 100*count/$scope.stats.totalLetters : 0};
    }
    $scope.chooseStatsLetter = function (letter) { $scope.viewState.letter=letter; updateLetterSelection(); saveState(); };
    $scope.filteredStatsWords = function () {
        var needle = QuranSurahStats.key($scope.wordOptions.filter.trim(), $scope.viewState.marks);
        var words = $scope.stats.words.filter(function (word) { return (!$scope.wordOptions.once || word.count === 1) && (!needle || word.key.includes(needle)); });
        return $scope.wordOptions.sort === 'alphabetical' ? words.slice().sort(function (a,b) { return a.key.localeCompare(b.key); }) : words;
    };
    $scope.$watchGroup(['stats','wordOptions.filter','wordOptions.once','wordOptions.sort','diagramOptions.wordLimit'], function () { $scope.wordDiagramRows=$scope.filteredStatsWords().slice(0,Number($scope.diagramOptions.wordLimit)); });
    $scope.$watchGroup(['wordOptions.filter','wordOptions.once','wordOptions.sort'], function () { $scope.wordOptions.limit=20; });
    $scope.copyStatisticsLink = function () {
        $scope.statisticsLink = baseUrl() + '#!/statistics?state=' + QuranSearchLink.encode(pageState());
        function fallback() {
            var field=document.getElementById('statistics-share-link');
            if (field) { field.focus(); field.select(); try { if (document.execCommand('copy')) { $scope.copyStatisticsStatus='تم نسخ الرابط'; return; } } catch (error) {} }
            $scope.copyStatisticsStatus='حدد الرابط وانسخه لمشاركة هذه الإحصاءات.';
        }
        if ($window.navigator.clipboard && $window.navigator.clipboard.writeText) {
            $window.navigator.clipboard.writeText($scope.statisticsLink).then(function () { $scope.$evalAsync(function () { $scope.copyStatisticsStatus='تم نسخ الرابط'; }); }, function () { $timeout(fallback,0); });
        } else $timeout(fallback,0);
    };
    $scope.statisticsCsvRows = function (kind) {
        var prefix = [$scope.selectedSurah.title,$scope.viewState.id,$scope.viewState.marks === 'keep' ? 'مع اعتبار التشكيل' : 'دون اعتبار التشكيل'];
        var header = ['السورة','رقم السورة','تجميع الكلمات'];
        if (kind === 'words') return [header.concat(['الكلمة','عدد التكرارات','أرقام الآيات'])].concat($scope.filteredStatsWords().map(function (word) { return prefix.concat([word.key,word.count,word.verseIds.join('، ')]); }));
        if (kind === 'letters') return [header.concat(['الحرف','عدد التكرارات','النسبة المئوية'])].concat($scope.stats.letters.map(function (letter) { return prefix.concat([letter.letter,letter.count,letter.percentage.toFixed(2)]); }));
        if (kind === 'lengths' || kind === 'range') return [header.concat(['رقم الآية','عدد الكلمات','عدد الحروف','نص الآية','الرابط'])].concat((kind === 'range' ? $scope.rangeVerses : $scope.stats.verses).map(function (verse) { return prefix.concat([verse.verse_id,verse.wordCount,verse.letterCount,verse.text.trim(),baseUrl()+'#!/surah?id='+verse.sura_id+'#ayah-'+verse.verse_id]); }));
        return [header.concat(['الإحصاء','القيمة'])].concat([
            ['عدد الآيات',$scope.stats.ayahCount],['عدد الكلمات',$scope.stats.totalWords],['عدد الحروف',$scope.stats.totalLetters],
            ['الكلمات المختلفة',$scope.stats.distinctWords],['الكلمات الواردة مرة واحدة',$scope.stats.singletons],['متوسط كلمات الآية',$scope.stats.averageWords.toFixed(2)],
            ['أطول آية بالكلمات',$scope.stats.maxWords],['آيات بطول أقصى',$scope.stats.longest.map(function (verse) { return verse.verse_id; }).join('، ')],
            ['أقصر آية بالكلمات',$scope.stats.minWords],['آيات بطول أدنى',$scope.stats.shortest.map(function (verse) { return verse.verse_id; }).join('، ')]
        ].map(function (row) { return prefix.concat(row); }));
    };
    $scope.exportStatistics = function (kind) {
        var blob=new $window.Blob([QuranResults.csv($scope.statisticsCsvRows(kind))],{type:'text/csv;charset=utf-8'});
        var url=$window.URL.createObjectURL(blob), link=document.createElement('a');
        link.href=url; link.download='quran-surah-'+$scope.viewState.id+'-'+kind+'.csv'; document.body.appendChild(link); link.click(); link.remove();
        $timeout(function () { $window.URL.revokeObjectURL(url); },1000,false);
    };
});
