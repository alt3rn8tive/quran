describe('Readable query blocks', function () {
    function block(type, value, extra) {
        return Object.assign(QuranQueryBuilder.create(type, value), extra || {});
    }
    function regex(blocks, options) {
        var compiled = QuranQueryBuilder.compile(blocks);
        expect(compiled.error).toBeUndefined();
        return getRegexPatternForString(compiled.query, options || {excludePartOfWords: true});
    }

    it('matches literal Arabic text with unspecified and specified harakat', function () {
        var unvowelled = regex([block('text', 'جن')]);
        expect(' جِنٌّ '.match(unvowelled)).not.toBeNull();
        expect(' جَنَّ '.match(unvowelled)).not.toBeNull();
        var vowelled = regex([block('text', 'جِن')]);
        expect(' جِنٌّ '.match(vowelled)).not.toBeNull();
        expect(' جَنَّ '.match(vowelled)).toBeNull();
    });

    it('joins an unknown letter with a specified harakah to literal text', function () {
        var pattern = regex([block('letter', '', {mark: 'َ'}), block('text', 'اء')]);
        expect(' مَاء '.match(pattern)).not.toBeNull();
        expect(' جَاء '.match(pattern)).not.toBeNull();
        expect(' مِاء '.match(pattern)).toBeNull();
    });

    it('distinguishes optional letters from one or more letters', function () {
        var optional = regex([block('text', 'علم'), block('optional')]);
        var required = regex([block('text', 'علم'), block('letters')]);
        expect(' علم '.match(optional)).not.toBeNull();
        expect(' علم '.match(required)).toBeNull();
        [' علمه ', ' علمهم '].forEach(function (text) {
            expect(text.match(optional)).not.toBeNull();
            expect(text.match(required)).not.toBeNull();
        });
    });

    it('separates adjacent literal blocks only when a space is selected', function () {
        var attached = regex([block('text', 'إن'), block('text', 'ما')]);
        var separated = regex([block('text', 'إن'), block('text', 'ما', {join: 'space'})]);
        expect(' إنما '.match(attached)).not.toBeNull();
        expect(' إن ما '.match(attached)).toBeNull();
        expect(' إن ما '.match(separated)).not.toBeNull();
        expect(' إنما '.match(separated)).toBeNull();
    });

    it('matches whole unknown words and intervening words', function () {
        var one = regex([block('text', 'قال'), block('word'), block('text', 'رب')]);
        var many = regex([block('text', 'قال'), block('words'), block('text', 'رب')]);
        expect(' قال موسى رب '.match(one)).not.toBeNull();
        expect(' قال يا موسى رب '.match(one)).toBeNull();
        expect(' قال يا موسى رب '.match(many)).not.toBeNull();
    });

    it('captures the selected words rather than the known phrase', function () {
        var following = regex([block('text', 'الله'), block('capture', '', {count: 2})]);
        var previous = regex([block('capture'), block('text', 'الله')]);
        expect(following.exec(' الله لَا إِلَٰهَ إِلَّا هُوَ ')[1]).toBe('لَا إِلَٰهَ');
        expect(previous.exec(' قَالَ الله ')[1]).toBe('قَالَ');
    });

    it('rejects empty blocks and raw search syntax without executing it', function () {
        expect(QuranQueryBuilder.compile([]).error).toBeTruthy();
        expect(QuranQueryBuilder.compile([block('text', ' ')]).error).toBeTruthy();
        ['الله*', '.', '[', '(آدم|عيسى)', '١'].forEach(function (value) {
            expect(QuranQueryBuilder.compile([block('text', value)]).error).toBeTruthy();
        });
        expect(QuranQueryBuilder.compile([block('capture', '', {count: 0})]).error).toBeTruthy();
        expect(QuranQueryBuilder.compile([block('capture', '', {count: 1.5})]).error).toBeTruthy();
    });

    it('restores older text, wildcard, word and capture links as readable blocks', function () {
        ['الله*', 'ـَاء', 'إنما .. هو', 'الله (.)', '(. .) كانوا يعملون', ' الح.', 'الله '].forEach(function (query) {
            var blocks = QuranQueryBuilder.parse(query);
            expect(blocks).not.toBeNull();
            expect(QuranQueryBuilder.compile(blocks).query.trim()).toBe(query.trim());
        });
    });

    it('preserves unsupported advanced links instead of changing their meaning', function () {
        expect(QuranQueryBuilder.parse('(آدم|عيسى)')).toBeNull();
        expect(QuranQueryBuilder.parse('الله?')).toBeNull();
    });
});

describe('Query builder search integration', function () {
    var scope, root, httpBackend, location;
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller, $rootScope, $httpBackend, $location) {
        root = $rootScope;
        scope = root.$new();
        httpBackend = $httpBackend;
        location = $location;
        location.path('/search').search({});
        $controller('AyatSearchController', {$scope: scope});
        httpBackend.whenGET('view/search.html').respond('');
    }));

    it('searches the Quran from blocks and saves their structure in the URL', function () {
        scope.queryBlocks = [QuranQueryBuilder.create('text', 'الله'), QuranQueryBuilder.create('optional')];
        scope.searchButtonClicked();
        root.$digest();
        expect(scope.resultsGroup.length).toBe(6);
        expect(scope.countedAyahAttributes.matched['اللَّهِ']).toBe(978);
        expect(location.search().s).toBe('الله*');
        expect(JSON.parse(location.search().qb)[1].type).toBe('optional');
    });

    it('keeps the last results and URL intact when an edited block is invalid', function () {
        scope.queryBlocks = [QuranQueryBuilder.create('text', 'الله')];
        scope.searchButtonClicked();
        root.$digest();
        var query = location.search().s;
        var results = scope.resultsGroup.slice();
        scope.queryBlocks[0].value = '[';
        scope.builderChanged();
        scope.searchButtonClicked();
        root.$digest();
        expect(scope.builderError).toBeTruthy();
        expect(scope.queryEdited).toBeTrue();
        expect(location.search().s).toBe(query);
        expect(scope.resultsGroup).toEqual(results);
    });
});
