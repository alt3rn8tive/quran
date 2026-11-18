describe('Surah statistics of the bundled numbered text', function () {
    function ayah(surah,id,text) { return {sura_id:surah,verse_id:id,text:text}; }
    it('ignores pause marks, harakat, shadda and dagger alif in letter counts without splitting words', function () {
        var source=[ayah(1,1,' قَالَ قَالُ ۖ رَبِّ ۩ مَٰلِكِ '),ayah(2,1,' زيادة ')];
        var stats=QuranSurahStats.calculate(source,1,'ignore');
        expect(stats.ayahCount).toBe(1); expect(stats.totalWords).toBe(4); expect(stats.totalLetters).toBe(11);
        expect(stats.distinctWords).toBe(3); expect(stats.words[0].key).toBe('قال'); expect(stats.words[0].count).toBe(2);
        expect(stats.letters.some(function (row) { return /[ۖ۩ّٰ]/.test(row.letter); })).toBeFalse();
    });
    it('changes only word grouping when considering harakat, preserving Arabic letter forms', function () {
        var source=[ayah(1,1,' عَلِمَ عَلَمَ أَ إِ آ ا ٱ ي ى ')];
        var plain=QuranSurahStats.calculate(source,1,'ignore'), marked=QuranSurahStats.calculate(source,1,'keep');
        expect(plain.totalWords).toBe(marked.totalWords); expect(plain.totalLetters).toBe(marked.totalLetters);
        expect(marked.distinctWords).toBe(plain.distinctWords+1);
        ['أ','إ','آ','ا','ٱ','ي','ى'].forEach(function (letter) { expect(plain.letters.some(function (row) { return row.letter===letter; })).toBeTrue(); });
        expect(QuranSurahStats.key('رَبِّي','keep')).toBe(QuranSurahStats.key('رَبِّي','keep'));
    });
    it('keeps all ties for longest and shortest verses and handles an empty selection', function () {
        var stats=QuranSurahStats.calculate([ayah(1,1,' قال رب '),ayah(1,2,' قال رب '),ayah(1,3,' قال '),ayah(1,4,' رب ')],1,'ignore');
        expect(stats.longest.map(function (row) { return row.verse_id; })).toEqual([1,2]);
        expect(stats.shortest.map(function (row) { return row.verse_id; })).toEqual([3,4]); expect(stats.averageWords).toBe(1.5);
        expect(QuranSurahStats.calculate([],1,'ignore').totalWords).toBe(0);
    });
    it('counts repeated word occurrences and highlights complete tokens at their source positions', function () {
        var stats=QuranSurahStats.calculate([ayah(1,1,' علم ويعلم ۖ علم '),ayah(1,2,' علمهم ')],1,'ignore');
        var found=QuranSurahStats.occurrences(stats,'علم','ignore');
        expect(found.length).toBe(1); expect(found[0].count).toBe(2);
        expect(found[0].html).toBe(" <span class='highlightedText'>علم</span> ويعلم ۖ <span class='highlightedText'>علم</span> ");
        expect(stats.words.find(function (word) { return word.key==='علم'; }).verseIds).toEqual([1]);
    });
    it('counts Al-Fatiha from its actual stored text, including its numbered basmala exactly once', function () {
        var stats=QuranSurahStats.calculate(all_ayat,1,'ignore');
        expect(stats.ayahCount).toBe(7); expect(stats.totalWords).toBe(29); expect(stats.totalLetters).toBe(143);
        expect(stats.distinctWords).toBe(26); expect(stats.averageWords).toBe(29/7);
        expect(stats.longest[0].verse_id).toBe(7); expect(stats.shortest[0].verse_id).toBe(3);
        expect(stats.words.find(function (word) { return word.key==='بسم'; }).count).toBe(1);
        expect(QuranSurahStats.calculate(all_ayat,9,'ignore').words.some(function (word) { return word.key==='بسم'; })).toBeFalse();
    });
    it('partitions all 6236 ayat and 77797 words across the 114 surahs without mutating text', function () {
        var before=all_ayat.map(function (ayah) { return ayah.text; });
        var ayat=0,words=0,letters=0;
        for(var id=1;id<=114;id++){
            var stats=QuranSurahStats.calculate(all_ayat,id,'ignore'); ayat+=stats.ayahCount; words+=stats.totalWords; letters+=stats.totalLetters;
            expect(stats.words.reduce(function (sum,word) { return sum+word.count; },0)).toBe(stats.totalWords);
            expect(stats.letters.reduce(function (sum,row) { return sum+row.count; },0)).toBe(stats.totalLetters);
        }
        expect(ayat).toBe(6236); expect(words).toBe(77797);
        expect(letters).toBe(all_ayat.reduce(function (sum,ayah) { return sum+(ayah.text.match(/[\u0621-\u063A\u0641-\u064A\u0671]/gu)||[]).length; },0));
        expect(all_ayat.map(function (ayah) { return ayah.text; })).toEqual(before);
    });
});

describe('Surah statistics page state and exports', function () {
    var scope,root,location,controller;
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller,$rootScope,$location,$httpBackend) {
        root=$rootScope; location=$location; controller=$controller;
        location.path('/statistics').search({id:'1'}); scope=root.$new(); controller('SurahStatisticsController',{$scope:scope});
        $httpBackend.whenGET('view/statistics.html').respond('');
    }));
    afterEach(function () { scope.$destroy(); });
    it('restores the surah, harakah mode, tab and selected word from an ASCII-only saved state', function () {
        scope.viewState.id=2; scope.viewState.marks='keep'; scope.changeStatistics(); scope.switchStatsTab('words');
        scope.chooseStatsWord(scope.stats.words[0]); root.$digest();
        var state=location.search().state; expect(state).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
        var word=scope.activeWord.key, total=scope.activeWord.count;
        scope.$destroy(); scope=root.$new(); controller('SurahStatisticsController',{$scope:scope});
        expect(scope.viewState.id).toBe(2); expect(scope.viewState.marks).toBe('keep'); expect(scope.activeWord.key).toBe(word); expect(scope.activeWord.count).toBe(total);
        expect(scope.wordOccurrences.reduce(function (sum,verse) { return sum+verse.count; },0)).toBe(total);
    });
    it('shows singleton words and alphabetical sorting without changing overview totals', function () {
        var total=scope.stats.totalWords; scope.wordOptions.once=true;
        expect(scope.filteredStatsWords().every(function (word) { return word.count===1; })).toBeTrue();
        scope.wordOptions.once=false; scope.wordOptions.filter='الرح'; expect(scope.filteredStatsWords().length).toBe(2);
        scope.wordOptions.sort='alphabetical'; expect(scope.stats.totalWords).toBe(total);
    });
    it('exports matching totals, all filtered words, original ayat and precise references', function () {
        var summary=scope.statisticsCsvRows('summary'); expect(summary.find(function (row) { return row[3]==='عدد الكلمات'; })[4]).toBe(29);
        expect(scope.statisticsCsvRows('words').length).toBe(27);
        scope.wordOptions.once=true; expect(scope.statisticsCsvRows('words').length).toBe(scope.stats.singletons+1);
        var letters=scope.statisticsCsvRows('letters'); expect(letters.slice(1).reduce(function (sum,row) { return sum+row[4]; },0)).toBe(143);
        var verses=scope.statisticsCsvRows('lengths'); expect(verses.length).toBe(8); expect(verses[1][3]).toBe(1); expect(verses[1][6]).toContain('بِسْمِ'); expect(verses[1][7]).toContain('#!/surah?id=1#ayah-1');
        expect(QuranResults.csv(verses)[0]).toBe('\uFEFF');
    });
    it('restores list filters, singleton mode and sorting from a shared state', function () {
        scope.wordOptions.filter='الرح'; scope.wordOptions.once=false; scope.wordOptions.sort='alphabetical'; scope.updateStatisticsFilters(); root.$digest();
        scope.$destroy(); scope=root.$new(); controller('SurahStatisticsController',{$scope:scope});
        expect(scope.wordOptions.filter).toBe('الرح'); expect(scope.wordOptions.sort).toBe('alphabetical'); expect(scope.filteredStatsWords().length).toBe(2);
        scope.wordOptions.once=true; scope.updateStatisticsFilters(); root.$digest();
        scope.$destroy(); scope=root.$new(); controller('SurahStatisticsController',{$scope:scope}); expect(scope.wordOptions.once).toBeTrue(); expect(scope.filteredStatsWords().length).toBe(0);
    });
    it('uses valid defaults for malformed references and restores chart selection with back/forward state', function () {
        location.search({id:999,marks:'unknown',tab:'other'}); scope.$broadcast('$routeUpdate'); expect(scope.viewState.id).toBe(1); expect(scope.viewState.tab).toBe('words');
        scope.chooseStatsAyah(scope.stats.verses[6]); expect(scope.viewState.tab).toBe('lengths'); expect(scope.selectedStatsAyah.verse_id).toBe(7);
        location.search({id:108,tab:'lengths',ayah:2}); scope.$broadcast('$routeUpdate'); expect(scope.stats.ayahCount).toBe(3); expect(scope.selectedStatsAyah.verse_id).toBe(2);
    });
});
