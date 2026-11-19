describe('Interactive chart data', function () {
    it('combines the remaining letters exactly once and preserves the full total', function () {
        var letters=QuranSurahStats.calculate(all_ayat,1,'ignore').letters;
        var slices=QuranStatisticsCharts.letterSlices(letters,8);
        expect(slices.length).toBe(9); expect(slices[8].key).toBe('other');
        expect(slices.reduce(function (sum,row) { return sum+row.count; },0)).toBe(143);
        expect(QuranStatisticsCharts.letterSlices(letters.slice(0,3),8).length).toBe(3);
    });
    it('normalizes reversed, missing, single-ayah and out-of-range selections', function () {
        var verses=[{verse_id:1},{verse_id:2},{verse_id:3},{verse_id:4}];
        expect(QuranStatisticsCharts.range(verses,4,2)).toEqual([2,4]);
        expect(QuranStatisticsCharts.range(verses,-3,90)).toEqual([1,4]);
        expect(QuranStatisticsCharts.range(verses,null,undefined)).toEqual([1,4]);
        expect(QuranStatisticsCharts.range(verses,3,3)).toEqual([3,3]);
        expect(QuranStatisticsCharts.nearest(verses,2.2).verse_id).toBe(2);
    });
});

describe('D3 chart interactions', function () {
    var scope,root,compile,element;
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($rootScope,$compile,$httpBackend) {
        root=$rootScope; compile=$compile; scope=root.$new();
        $httpBackend.whenGET('view/search.html').respond('');
    }));
    afterEach(function () { scope.$destroy(); if(element) element.remove(); });
    function mount(html) { element=angular.element(html); element.css('width','600px'); document.body.appendChild(element[0]); compile(element)(scope); root.$digest(); }
    it('renders proportional word bars and supports keyboard selection with precise counts', function () {
        scope.rows=[{key:'قال',count:4,verseIds:[1,2]},{key:'رب',count:2,verseIds:[2]}];
        scope.choose=function (word) { scope.selected=word.key; };
        mount('<div quran-word-chart rows="rows" selected="selected" on-select="choose(word)"></div>');
        var bars=element[0].querySelectorAll('.word-chart-bar'); expect(bars.length).toBe(2);
        expect(Number(bars[0].getAttribute('width'))).toBe(2*Number(bars[1].getAttribute('width')));
        var row=element[0].querySelector('.word-chart-row'); row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); root.$digest();
        expect(scope.selected).toBe('قال'); expect(row.getAttribute('aria-pressed')).toBe('true');
        row.dispatchEvent(new FocusEvent('focus')); expect(element[0].querySelector('[role=tooltip]').textContent).toContain('4 تكراراً في 2 آية');
    });
    it('renders letter sectors with a usable legend and selected-letter details', function () {
        scope.rows=QuranSurahStats.calculate(all_ayat,1,'ignore').letters;
        scope.choose=function (letter) { scope.selected=letter; };
        mount('<div quran-letter-chart rows="rows" selected="selected" on-select="choose(letter)"></div>');
        expect(element[0].querySelectorAll('.letter-slice').length).toBe(9);
        var buttons=element[0].querySelectorAll('.stats-donut-legend button'); buttons[8].click(); root.$digest();
        expect(scope.selected).toBe('other'); expect(element[0].querySelector('.donut-caption').textContent).toBe('بقية الحروف');
        expect(buttons[8].getAttribute('aria-pressed')).toBe('true');
    });
    it('updates the focus range and metric, and does not treat resize/programmatic brushing as user selection', function () {
        scope.verses=QuranSurahStats.calculate(all_ayat,1,'ignore').verses;
        scope.metric='words'; scope.start=1; scope.end=7; scope.selected=1;
        scope.range=jasmine.createSpy('range'); scope.choose=function (verse) { scope.selected=verse.verse_id; };
        mount('<div quran-verse-chart verses="verses" metric="metric" start="start" end="end" selected="selected" on-select="choose(verse)" on-range="range(start,end)"></div>');
        expect(element[0].querySelectorAll('.verse-chart-point').length).toBe(7); expect(scope.range).not.toHaveBeenCalled();
        scope.start=2; scope.end=3; scope.metric='letters'; root.$digest();
        expect(element[0].querySelectorAll('.verse-chart-point').length).toBe(2); expect(element[0].querySelector('.focus-axis-label').textContent).toBe('عدد الحروف');
        element[0].querySelector('#stats-bar-3').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})); root.$digest();
        expect(scope.selected).toBe(3); expect(scope.range).not.toHaveBeenCalled();
    });
    it('disconnects resize observers when a tab or page is destroyed', function () {
        var disconnected=false;
        spyOn(window,'ResizeObserver').and.callFake(function () { return {observe:function () {},disconnect:function () { disconnected=true; }}; });
        scope.rows=[]; mount('<div quran-word-chart rows="rows"></div>'); scope.$destroy();
        expect(disconnected).toBeTrue();
    });
});

describe('Statistics diagram state and range exports', function () {
    var scope,root,location,controller;
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller,$rootScope,$location,$httpBackend) {
        root=$rootScope; location=$location; controller=$controller; location.path('/statistics').search({id:1});
        scope=root.$new(); controller('SurahStatisticsController',{$scope:scope}); $httpBackend.whenGET('view/statistics.html').respond('');
    }));
    afterEach(function () { scope.$destroy(); });
    it('saves metric, selected letter, ayah and range without changing full-surah counts', function () {
        var words=scope.stats.totalWords,letters=scope.stats.totalLetters;
        scope.diagramOptions.wordLimit=20; scope.changeWordDiagramLimit(); scope.switchStatsTab('lengths'); scope.setDiagramRange(2,3); scope.viewState.metric='letters'; scope.changeDiagramMetric(); scope.chooseStatsLetter('ا'); root.$digest();
        expect(scope.rangeSummary.ayat).toBe(2); expect(scope.rangeSummary.words).toBe(6);
        expect(scope.statisticsCsvRows('range').length).toBe(3); expect(scope.statisticsCsvRows('lengths').length).toBe(8);
        expect(scope.stats.totalWords).toBe(words); expect(scope.stats.totalLetters).toBe(letters);
        scope.$destroy(); scope=root.$new(); controller('SurahStatisticsController',{$scope:scope});
        expect(scope.viewState.metric).toBe('letters'); expect(scope.viewState.start).toBe(2); expect(scope.viewState.end).toBe(3); expect(scope.viewState.letter).toBe('ا'); expect(scope.viewState.ayah).toBe(2); expect(scope.diagramOptions.wordLimit).toBe(20);
    });
    it('resets the range for another surah and reveals an ayah selected outside a narrow range', function () {
        scope.setDiagramRange(2,2); scope.chooseStatsAyah(scope.stats.verses[6]);
        expect(scope.viewState.start).toBe(1); expect(scope.viewState.end).toBe(7); expect(scope.viewState.ayah).toBe(7);
        scope.viewState.id=108; scope.changeStatistics(); expect(scope.viewState.start).toBe(1); expect(scope.viewState.end).toBe(3);
    });
});
