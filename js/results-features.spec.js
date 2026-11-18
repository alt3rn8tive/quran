describe('Compact saved links', function () {
    it('omits default block fields while preserving compilation, captures and exclusions', function () {
        var blocks = [QuranQueryBuilder.create('context', 'ولكن'), QuranQueryBuilder.create('exclude')];
        blocks[0].count = 3; blocks[1].choices = [{value: 'فرعون'}];
        var params = {s: QuranQueryBuilder.compile(blocks).query, qb: JSON.stringify(blocks), word_match: 'contains'};
        var compact = QuranSearchLink.compact(params);
        expect(compact.qb.length).toBeLessThan(params.qb.length / 3);
        expect(JSON.parse(compact.qb)[0]).toEqual({type: 'context', value: 'ولكن', count: 3});
        var restored = QuranSearchLink.parameters({q: QuranSearchLink.encode(params)});
        expect(QuranQueryBuilder.compile(JSON.parse(restored.qb))).toEqual(QuranQueryBuilder.compile(blocks));
    });
    it('restores original v1 full-state links and preserves explicit global contains overrides', function () {
        var blocks = [QuranQueryBuilder.create('text', 'الله')];
        var old = {s: 'الله', qb: JSON.stringify(blocks), word_match: 'contains', exclude_part_of_words: true};
        var q = 'v1.' + btoa(unescape(encodeURIComponent(JSON.stringify(old)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(QuranSearchLink.parameters({q:q})).toEqual(old);
        expect(QuranSearchLink.compact(old).word_match).toBe('contains');
    });
});

describe('Result statistics and CSV exports', function () {
    function ayah(id, text) { return {sura_id: 1, verse_id: id, text: text}; }
    function groups() {
        return [
            {occurrenceCount: 2, matched: ['قال', 'رب', 'قال'], ayat: [ayah(1, ' قال، "رب" '), ayah(2, ' عربي\nمشكلٌ ')]},
            {occurrenceCount: 1, matched: ['قال'], ayat: [ayah(2, ' عربي\nمشكلٌ '), ayah(3, ' الثالث ')]}
        ];
    }
    it('distinguishes occurrences, capture values, overlapping groups and distinct ayat', function () {
        expect(QuranResults.summary(groups())).toEqual({groups: 2, ayat: 3, occurrences: 3, values: 4, distinctValues: 2});
        expect(QuranResults.summary([])).toEqual({groups: 0, ayat: 0, occurrences: 0, values: 0, distinctValues: 0});
        expect(QuranResults.summary(groups().slice(1)).values).toBe(1);
    });
    it('exports each distinct filtered ayah once with references to every group', function () {
        var rows = QuranResults.ayahRows(groups(), [{title:'الفاتحة'}], 'https://example.test/quran/');
        expect(rows.length).toBe(4);
        expect(rows[2].slice(0,5)).toEqual(['الفاتحة', 1, 2, 'عربي\nمشكلٌ', '1، 2']);
        expect(rows[2][5]).toBe('https://example.test/quran/#!/surah?id=1#ayah-2');
        expect(QuranResults.ayahRows(groups().slice(1), [{title:'الفاتحة'}], '').length).toBe(3);
    });
    it('exports filtered frequencies including repeated captures', function () {
        expect(QuranResults.frequencyRows(groups()).slice(1).map(function (row) { return row.slice(0,2); })).toEqual([['قال',3],['رب',1]]);
        var references = QuranResults.frequencyRows(groups(), [{title:'الفاتحة'}], 'https://example.test/')[1];
        expect(references[2]).toBe('الفاتحة'); expect(references[3]).toBe('1:1، 1:2، 1:3');
        expect(references[4]).toContain('https://example.test/#!/surah?id=1#ayah-3');
        expect(QuranResults.frequencyRows(groups().slice(1)).slice(1).map(function (row) { return row.slice(0,2); })).toEqual([['قال',1]]);
    });
    it('quotes CSV cells, keeps Arabic and newlines, and includes the UTF-8 spreadsheet marker', function () {
        expect(QuranResults.csv([['عربي، "نص"', 'سطر\nثان'], ['=1+1', 3]])).toBe('\uFEFF"عربي، ""نص""","سطر\nثان"\r\n"\'=1+1","3"\r\n');
    });
});

describe('Ready-made search examples', function () {
    beforeEach(angular.mock.module('myApp'));
    it('loads editable examples, saves their blocks, and gives capture and cross-ayah counts', angular.mock.inject(function ($controller, $rootScope, $location, $httpBackend) {
        $location.path('/search').search({});
        var scope = $rootScope.$new(); $controller('AyatSearchController', {$scope:scope});
        $httpBackend.whenGET('view/search.html').respond('');
        scope.loadPreset('crossAyah'); $rootScope.$digest();
        expect(scope.resultsCrossAyah).toBeTrue(); expect(scope.resultStats.groups).toBeGreaterThan(0);
        expect(scope.queryBlocks[1].type).toBe('ayahBreak');
        scope.loadPreset('capture'); $rootScope.$digest();
        expect(scope.resultsHaveCaptures).toBeTrue(); expect(scope.queryBlocks[0].count).toBe(3);
        expect(scope.resultStats.ayat).toBe(102); expect(scope.resultStats.distinctValues).toBe(70);
        scope.loadPreset('exclusion'); $rootScope.$digest();
        expect(scope.queryExclusions.length).toBe(1); expect(scope.resultStats.groups).toBeGreaterThan(0);
        scope.useSuwar = {'1':true}; $rootScope.$digest();
        expect(scope.resultStats).toEqual(QuranResults.summary(scope.filteredAyat));
        scope.$destroy();
    }));
});

describe('Compact links preserve independent builder settings', function () {
    it('round trips all non-default controls without changing the compiled search', function () {
        function block(type, value, extra) { return Object.assign(QuranQueryBuilder.create(type, value), extra || {}); }
        var cases = [
            [block('letter', 'م', {letterMode:'specific', mark:'َ', shadda:true, letterOptional:true}), block('letters', '', {repetition:'range', minCount:1, maxCount:3})],
            [block('between', 'قال', {endValue:'رب', gapMode:'range', gapMin:0, gapMax:2, order:'either'})],
            [block('symbol', '', {symbol:'ۚ', symbolMode:'before', count:3})],
            [block('alternatives', '', {matchMode:'ends', choices:[{value:'علم'},{value:'قال'}]}), block('exclude','',{scope:'word',matchMode:'contains',choices:[{value:'ون'}]})],
            [block('capture', '', {count:2}), block('text','قال',{join:'space',matchMode:'whole'}), block('ayahBreak'), block('context','الله',{direction:'before',count:4})]
        ];
        cases.forEach(function (blocks) {
            var compiled = QuranQueryBuilder.compile(blocks); expect(compiled.error).toBeUndefined();
            var restored = QuranSearchLink.parameters({q:QuranSearchLink.encode({s:compiled.query,qb:JSON.stringify(blocks)})});
            expect(QuranQueryBuilder.compile(JSON.parse(restored.qb))).toEqual(compiled);
        });
    });
});
