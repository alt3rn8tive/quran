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
        expect(QuranSearchLink.parameters(location.search()).s).toBe('الله*');
        expect(JSON.parse(QuranSearchLink.parameters(location.search()).qb)[1].type).toBe('letters');
        expect(JSON.parse(QuranSearchLink.parameters(location.search()).qb)[1].repetition).toBe('zeroOrMore');
    });

    it('keeps the last results and URL intact when an edited block is invalid', function () {
        scope.queryBlocks = [QuranQueryBuilder.create('text', 'الله')];
        scope.searchButtonClicked();
        root.$digest();
        var query = QuranSearchLink.parameters(location.search()).s;
        var results = scope.resultsGroup.slice();
        scope.queryBlocks[0].value = '[';
        scope.builderChanged();
        scope.searchButtonClicked();
        root.$digest();
        expect(scope.builderError).toBeTruthy();
        expect(scope.queryEdited).toBeTrue();
        expect(QuranSearchLink.parameters(location.search()).s).toBe(query);
        expect(scope.resultsGroup).toEqual(results);
    });
    it('saves independent text rules and applies them to the real Quran search', function () {
        var text = QuranQueryBuilder.create('text', 'علم');
        text.matchMode = 'whole';
        scope.queryBlocks = [text];
        scope.searchButtonClicked();
        root.$digest();
        expect(scope.filteredAyat.length).toBe(58);
        expect(JSON.parse(QuranSearchLink.parameters(location.search()).qb)[0].matchMode).toBe('whole');
    });

    it('saves symbol capture settings and returns captured words rather than the symbol', function () {
        var symbol = QuranQueryBuilder.create('symbol');
        symbol.symbol = 'ۘ';
        symbol.symbolMode = 'before';
        symbol.count = 2;
        scope.queryBlocks = [symbol];
        scope.searchButtonClicked();
        root.$digest();
        expect(scope.resultsGroup.length).toBeGreaterThan(0);
        expect(scope.resultsGroup.every(function (result) { return result.includes(' ') && !result.includes('ۘ'); })).toBeTrue();
        var stored = JSON.parse(QuranSearchLink.parameters(location.search()).qb)[0];
        expect(stored.symbol).toBe('ۘ');
        expect(stored.symbolMode).toBe('before');
        expect(stored.count).toBe(2);
    });
});

describe('Letter, word boundary and surrounding-word controls', function () {
    function part(type, value, options) {
        return Object.assign(QuranQueryBuilder.create(type, value), options || {});
    }
    function pattern(blocks, mode) {
        var result = QuranQueryBuilder.compile(blocks);
        expect(result.error).toBeUndefined();
        return getRegexPatternForString(result.query, {wordMatch: mode || 'whole'});
    }

    it('matches a selected letter and harakah rather than any letter', function () {
        var blocks = [part('letter', 'م', {letterMode: 'specific', mark: 'َ'})];
        [' مَ ', ' مِ ', ' سَ '].forEach(function (text, index) {
            expect(pattern(blocks).test(text)).toBe(index === 0);
        });
        blocks[0].mark = '';
        expect(pattern(blocks).test(' مِ ')).toBeTrue();
        expect(pattern(blocks).test(' مُ ')).toBeTrue();
    });

    it('combines shadda with a vowel for specific and unknown letters', function () {
        ['specific', 'any'].forEach(function (mode) {
            var blocks = [part('letter', 'م', {letterMode: mode, mark: 'َ', shadda: true})];
            expect(pattern(blocks).test(' مَّ ')).toBeTrue();
            expect(pattern(blocks).test(' مِّ ')).toBeFalse();
            expect(pattern(blocks).test(' مَ ')).toBeFalse();
        });
    });

    it('distinguishes exactly one, one or more, and zero or more unknown letters', function () {
        var matches = function (repetition, text) {
            return pattern([part('text', 'علم'), part('letters', '', {repetition: repetition})]).test(' ' + text + ' ');
        };
        expect(matches('one', 'علم')).toBeFalse();
        expect(matches('one', 'علمه')).toBeTrue();
        expect(matches('one', 'علمهم')).toBeFalse();
        expect(matches('oneOrMore', 'علم')).toBeFalse();
        expect(matches('oneOrMore', 'علمه')).toBeTrue();
        expect(matches('oneOrMore', 'علمهم')).toBeTrue();
        expect(matches('zeroOrMore', 'علم')).toBeTrue();
        expect(matches('zeroOrMore', 'علمهم')).toBeTrue();
    });

    it('honours each of the four word matching choices', function () {
        var samples = ['علم', 'يعلم', 'علمه', 'يعلمه'];
        var expected = {
            contains: [true, true, true, true], whole: [true, false, false, false],
            starts: [true, false, true, false], ends: [true, true, false, false]
        };
        Object.keys(expected).forEach(function (mode) {
            samples.forEach(function (word, index) {
                expect(pattern([part('text', 'علم')], mode).test(' ' + word + ' ')).toBe(expected[mode][index]);
            });
        });
    });

    it('applies word matching boundaries to the first and last words of a phrase', function () {
        var blocks = [part('text', 'قال رب')];
        expect(pattern(blocks, 'whole').test(' قال رب ')).toBeTrue();
        expect(pattern(blocks, 'whole').test(' فقال ربنا ')).toBeFalse();
        expect(pattern(blocks, 'starts').test(' قال ربنا ')).toBeTrue();
        expect(pattern(blocks, 'starts').test(' فقال رب ')).toBeFalse();
        expect(pattern(blocks, 'ends').test(' فقال رب ')).toBeTrue();
        expect(pattern(blocks, 'ends').test(' قال ربنا ')).toBeFalse();
    });

    it('captures an exact number of words before or after a known phrase', function () {
        var after = pattern([part('context', 'الله', {direction: 'after', count: 2})]);
        var before = pattern([part('context', 'الله', {direction: 'before', count: 2})]);
        expect(after.exec(' الله لَا إِلَٰهَ إِلَّا هُوَ ')[1]).toBe('لَا إِلَٰهَ');
        expect(before.exec(' قَالَ لَهُ الله ')[1]).toBe('قَالَ لَهُ');
        expect(pattern([part('context', 'الله', {direction: 'after', count: 2})]).test(' الله قال ')).toBeFalse();
    });

    it('respects the known phrase boundaries in surrounding-word searches', function () {
        var blocks = [part('context', 'الله', {direction: 'after'})];
        expect(pattern(blocks, 'contains').test(' والله عليم ')).toBeTrue();
        expect(pattern(blocks, 'whole').test(' والله عليم ')).toBeFalse();
        expect(pattern(blocks, 'whole').test(' الله عليم ')).toBeTrue();
    });

    it('requires intervening words and preserves phrase order', function () {
        var blocks = [part('between', 'قال', {endValue: 'رب'})];
        expect(pattern(blocks).test(' قال موسى رب ')).toBeTrue();
        expect(pattern(blocks).test(' قال يا موسى رب ')).toBeTrue();
        expect(pattern(blocks).test(' قال رب ')).toBeFalse();
        expect(pattern(blocks).test(' رب موسى قال ')).toBeFalse();
    });

    it('searches the full Quran for intervening words without stalling on long verses', function () {
        var source = QuranQueryBuilder.compile([part('between', 'إنما', {endValue: 'هو'})]).query;
        var matched = all_ayat.filter(function (ayah) {
            return ayah.text.match(getRegexPatternForString(source, {wordMatch: 'contains'}));
        }).map(function (ayah) { return ayah.ID; });
        expect(matched).toEqual([1141, 1996, 2446, 3330, 3652]);
    });

    it('skips pause marks when counting captured words', function () {
        var captured = pattern([part('context', 'قال', {count: 2})]).exec(' قال موسى ۖ يا رب ');
        expect(captured[1]).toBe('موسى ۖ يا');
    });

    it('rejects incomplete or invalid specific-letter and phrase controls', function () {
        var invalid = [
            part('letter', '', {letterMode: 'specific'}), part('letter', 'علم', {letterMode: 'specific'}),
            part('letters', '', {repetition: 'invalid'}), part('context', ''),
            part('context', 'الله', {direction: 'invalid'}), part('context', 'الله', {count: 21}),
            part('context', 'الله', {count: 0}), part('context', 'الله', {count: 1.5}),
            part('between', 'قال'), part('between', 'قال', {endValue: 'رب*'})
        ];
        invalid.forEach(function (block) { expect(QuranQueryBuilder.compile([block]).error).toBeTruthy(); });
    });

    it('migrates earlier optional-letter and shadda blocks without losing their meaning', function () {
        var older = [{type: 'optional'}, {type: 'letter', mark: 'ّ'}];
        var restored = QuranQueryBuilder.normalise(older);
        expect(restored[0].type).toBe('letters');
        expect(restored[0].repetition).toBe('zeroOrMore');
        expect(restored[1].mark).toBe('');
        expect(restored[1].shadda).toBeTrue();
        expect(QuranQueryBuilder.compile(restored).query).toBe(QuranQueryBuilder.compile(older).query);
    });

    it('previews the letter pattern and word controls without wildcard syntax', function () {
        expect(QuranQueryBuilder.preview(part('letter', 'م', {letterMode: 'specific', mark: 'َ'}))).toBe('مَ');
        expect(QuranQueryBuilder.preview(part('letter', '', {mark: 'ِ'}))).toContain('كسرة');
        ['letters', 'context', 'between'].forEach(function (type) {
            expect(QuranQueryBuilder.preview(part(type))).not.toMatch(/[.*_]/);
        });
    });
});

describe('Quran symbols and independent text matching', function () {
    function block(type, value, options) {
        return Object.assign(QuranQueryBuilder.create(type, value), options || {});
    }
    function regex(blocks, config) {
        var compiled = QuranQueryBuilder.compile(blocks);
        expect(compiled.error).toBeUndefined();
        return getRegexPatternForString(compiled.query, config || {wordMatch: 'contains'});
    }

    it('applies a whole-word rule to one block without constraining a preceding partial word', function () {
        var blocks = [block('text', 'رحم'), block('text', 'الله', {matchMode: 'whole'})];
        expect(regex(blocks).test(' يرحم الله ')).toBeTrue();
        expect(regex(blocks).test(' يرحم والله ')).toBeFalse();
        blocks[0].matchMode = 'whole';
        expect(regex(blocks).test(' يرحم الله ')).toBeFalse();
        expect(regex(blocks).test(' رحم الله ')).toBeTrue();
    });

    it('distinguishes per-block partial, whole, start and end matching', function () {
        var samples = ['علم', 'يعلم', 'علمه', 'يعلمه'];
        var expected = {
            contains: [true, true, true, true], whole: [true, false, false, false],
            starts: [true, false, true, false], ends: [true, true, false, false]
        };
        Object.keys(expected).forEach(function (mode) {
            samples.forEach(function (text, index) {
                expect(regex([block('text', 'علم', {matchMode: mode})]).test(' ' + text + ' ')).toBe(expected[mode][index]);
            });
        });
    });

    it('joins letter patterns to an open end of a bounded text block', function () {
        var prefix = [block('text', 'رحم', {matchMode: 'starts'}), block('letters')];
        expect(regex(prefix).test(' رحمهم ')).toBeTrue();
        expect(regex(prefix).test(' يرحمهم ')).toBeFalse();
        var suffix = [block('letter'), block('text', 'رحم', {matchMode: 'ends'})];
        expect(regex(suffix).test(' يرحم ')).toBeTrue();
        expect(regex(suffix).test(' يرحمهم ')).toBeFalse();
    });

    it('matches a complete phrase across pause marks but rejects attached outer letters', function () {
        var blocks = [block('text', 'كل نفس', {matchMode: 'phrase'})];
        expect(regex(blocks).test(' كل نفس ')).toBeTrue();
        expect(regex(blocks).test(' كل ۖ نفس ')).toBeTrue();
        expect(regex(blocks).test(' وكل نفس ')).toBeFalse();
        expect(regex(blocks).test(' كل نفسهم ')).toBeFalse();
        expect(regex(blocks).test(' كل نفس أخرى ')).toBeTrue();
    });

    it('retains legacy whole-query boundaries alongside individual matching rules', function () {
        var blocks = [block('text', 'علم', {matchMode: 'whole'})];
        expect(regex(blocks, {wordMatch: 'whole'}).test(' علم ')).toBeTrue();
        expect(regex(blocks, {searchFromBeginning: true}).test(' قال علم ')).toBeFalse();
        expect(regex(blocks, {searchOnEnd: true}).test(' علم قال ')).toBeFalse();
    });

    it('validates whole words, phrases and search-language injection', function () {
        [block('text', 'كل نفس', {matchMode: 'whole'}), block('text', 'الله', {matchMode: 'phrase'}),
            block('text', 'الله', {matchMode: 'invalid'}), block('text', '(?<= )الله')].forEach(function (part) {
            expect(QuranQueryBuilder.compile([part]).error).toBeTruthy();
        });
    });

    it('finds every supported symbol exactly as recorded in the full Quran text', function () {
        var expected = {'۩': 15, 'ۘ': 22, 'ۙ': 68, 'ۖ': 1682, 'ۗ': 603, 'ۚ': 1972, 'ۛ': 12, 'ۜ': 5};
        QuranQueryBuilder.symbols.forEach(function (symbol) {
            var pattern = regex([block('symbol', '', {symbol: symbol.value})]);
            var count = all_ayat.reduce(function (total, ayah) { return total + (ayah.text.match(pattern) || []).length; }, 0);
            expect(count).toBe(expected[symbol.value]);
        });
    });

    it('captures the requested number of words on either side of a symbol', function () {
        var text = ' قَالَ رَبِّ ۘ إِنِّي أَعْلَمُ ';
        var before = regex([block('symbol', '', {symbol: 'ۘ', symbolMode: 'before', count: 2})]);
        var after = regex([block('symbol', '', {symbol: 'ۘ', symbolMode: 'after', count: 2})]);
        expect(before.exec(text)[1]).toBe('قَالَ رَبِّ');
        expect(after.exec(text)[1]).toBe('إِنِّي أَعْلَمُ');
    });

    it('skips adjacent annotations without counting them as words', function () {
        var text = ' قال موسى ۜ ۗ هَٰذَا ';
        expect(regex([block('symbol', '', {symbol: 'ۗ', symbolMode: 'before'})]).exec(text)[1]).toBe('موسى');
        expect(regex([block('symbol', '', {symbol: 'ۜ', symbolMode: 'after'})]).exec(text)[1]).toBe('هَٰذَا');
    });

    it('does not invent following words when a symbol ends the verse', function () {
        var pattern = regex([block('symbol', '', {symbol: '۩', symbolMode: 'after'})]);
        expect(pattern.test(' وَاسْجُدْ وَاقْتَرِبْ ۩ ')).toBeFalse();
        expect(regex([block('symbol', '', {symbol: '۩', symbolMode: 'before', count: 2})]).exec(' وَاسْجُدْ وَاقْتَرِبْ ۩ ')[1]).toBe('وَاسْجُدْ وَاقْتَرِبْ');
    });

    it('combines a whole word and a symbol in one query', function () {
        var blocks = [block('text', 'رب', {matchMode: 'whole'}), block('symbol', '', {symbol: 'ۘ'})];
        expect(regex(blocks).test(' رب ۘ ')).toBeTrue();
        expect(regex(blocks).test(' ورب ۘ ')).toBeFalse();
        expect(regex(blocks).test(' رب ۙ ')).toBeFalse();
    });

    it('rejects unsupported symbols and invalid nearby-word choices', function () {
        [block('symbol', '', {symbol: '۞'}), block('symbol', '', {symbolMode: 'invalid'}),
            block('symbol', '', {symbolMode: 'before', count: 0}), block('symbol', '', {symbolMode: 'after', count: 1.5})].forEach(function (part) {
            expect(QuranQueryBuilder.compile([part]).error).toBeTruthy();
        });
    });

    it('restores simple symbol links and keeps old text blocks unbounded', function () {
        var parsed = QuranQueryBuilder.parse('۩');
        expect(parsed[0].type).toBe('symbol');
        expect(parsed[0].symbol).toBe('۩');
        var older = QuranQueryBuilder.normalise([{type: 'text', value: 'الله'}]);
        expect(older[0].matchMode).toBe('contains');
        expect(QuranQueryBuilder.compile(older).query).toBe('الله');
    });
});

describe('Precise counts, distances and alternative choices', function () {
    function part(type, value, options) { return Object.assign(QuranQueryBuilder.create(type, value), options || {}); }
    function regex(blocks, mode) {
        var compiled = QuranQueryBuilder.compile(blocks);
        expect(compiled.error).toBeUndefined();
        return getRegexPatternForString(compiled.query, {wordMatch: mode || 'whole'});
    }
    it('counts letters rather than harakat, shadda or dagger alif', function () {
        var exact = [part('letters', '', {repetition: 'exact', count: 3})];
        expect(regex(exact).test(' عِلْم ')).toBeTrue();
        expect(regex(exact).test(' هَٰذَا ')).toBeTrue();
        expect(regex(exact).test(' عِلْمه ')).toBeFalse();
        expect(regex([part('letters', '', {repetition: 'exact', count: 4})]).test(' هَٰذَا ')).toBeFalse();
        expect(regex([part('letters', '', {repetition: 'exact', count: 2})]).test(' ضُرّ ')).toBeTrue();
    });
    it('keeps following pause annotations out of whole-word letter-count results', function () {
        var blocks = [part('letters', '', {repetition: 'exact', count: 3})];
        expect(regex(blocks).exec(' عِلْم ۖ ')[0]).toBe('عِلْم');
    });

    it('matches both bounds of a letter range and rejects lengths outside it', function () {
        var blocks = [part('letters', '', {repetition: 'range', minCount: 2, maxCount: 4})];
        ['من', 'علم', 'كتاب'].forEach(function (value) { expect(regex(blocks).test(' ' + value + ' ')).toBeTrue(); });
        ['ا', 'مكتبة'].forEach(function (value) { expect(regex(blocks).test(' ' + value + ' ')).toBeFalse(); });
    });
    it('preserves multi-digit counts instead of interpreting them as backreferences', function () {
        var blocks = [part('letters', '', {repetition: 'exact', count: 12})];
        expect(regex(blocks).test(' ' + 'ا'.repeat(12) + ' ')).toBeTrue();
        expect(regex(blocks).test(' ' + 'ا'.repeat(11) + ' ')).toBeFalse();
    });
    it('makes a selected letter and its harakah optional as a unit', function () {
        var blocks = [part('letter', 'و', {letterMode: 'specific', mark: 'َ', letterOptional: true}), part('text', 'الله')];
        expect(regex(blocks).test(' الله ')).toBeTrue();
        expect(regex(blocks).test(' وَالله ')).toBeTrue();
        expect(regex(blocks).test(' وِالله ')).toBeFalse();
        expect(regex(blocks).test(' وَوَالله ')).toBeFalse();
    });
    it('distinguishes adjacency, exact distances and inclusive word-distance ranges', function () {
        function search(options, text) { return regex([part('between', 'قال', Object.assign({endValue: 'رب'}, options))]).test(' ' + text + ' '); }
        expect(search({gapMode: 'adjacent'}, 'قال رب')).toBeTrue();
        expect(search({gapMode: 'adjacent'}, 'قال موسى رب')).toBeFalse();
        expect(search({gapMode: 'exact', gapCount: 0}, 'قال رب')).toBeTrue();
        expect(search({gapMode: 'exact', gapCount: 2}, 'قال موسى يا رب')).toBeTrue();
        expect(search({gapMode: 'exact', gapCount: 2}, 'قال موسى رب')).toBeFalse();
        expect(search({gapMode: 'range', gapMin: 1, gapMax: 2}, 'قال موسى رب')).toBeTrue();
        expect(search({gapMode: 'range', gapMin: 1, gapMax: 2}, 'قال موسى يا رب')).toBeTrue();
        expect(search({gapMode: 'range', gapMin: 1, gapMax: 2}, 'قال رب')).toBeFalse();
        expect(search({gapMode: 'range', gapMin: 1, gapMax: 2}, 'قال موسى يا أيها رب')).toBeFalse();
    });
    it('supports either phrase order without adding captured groups', function () {
        var blocks = [part('between', 'قال', {endValue: 'رب', gapMode: 'exact', gapCount: 1, order: 'either'})];
        expect(regex(blocks).test(' قال موسى رب ')).toBeTrue();
        expect(regex(blocks).test(' رب موسى قال ')).toBeTrue();
        expect(regex(blocks).exec(' رب موسى قال ').length).toBe(1);
        blocks[0].order = 'ordered';
        expect(regex(blocks).test(' رب موسى قال ')).toBeFalse();
    });
    it('does not count pause marks as intervening words', function () {
        expect(regex([part('between', 'قال', {endValue: 'رب', gapMode: 'adjacent'})]).test(' قال ۖ رب ')).toBeTrue();
        expect(regex([part('between', 'قال', {endValue: 'رب', gapMode: 'exact', gapCount: 2})]).test(' قال موسى ۖ يا رب ')).toBeTrue();
    });
    it('matches a full-Quran exact distance equivalently to explicit unknown-word blocks', function () {
        var generated = regex([part('between', 'إنما', {endValue: 'هو', gapMode: 'exact', gapCount: 2})], 'contains');
        var explicit = getRegexPatternForString('إنما . . هو', {wordMatch: 'contains'});
        var ids = function (pattern) { return all_ayat.filter(function (ayah) { return ayah.text.match(pattern); }).map(function (ayah) { return ayah.ID; }); };
        expect(ids(generated)).toEqual(ids(explicit));
    });
    it('matches whole alternative words and phrases without capturing groups', function () {
        var blocks = [part('alternatives', '', {choices: [{value: 'موسى'}, {value: 'يا رب'}]})];
        expect(regex(blocks).test(' مُوسَىٰ ')).toBeTrue();
        expect(regex(blocks).test(' يا رب ')).toBeTrue();
        expect(regex(blocks).test(' وموسى ')).toBeFalse();
        expect(regex(blocks).exec(' يا رب ').length).toBe(1);
    });
    it('can attach literal alternatives to the remaining letter pattern', function () {
        var blocks = [part('alternatives', '', {matchMode: 'contains', choices: [{value: 'م'}, {value: 'س'}]}), part('text', 'اء')];
        expect(regex(blocks).test(' ماء ')).toBeTrue();
        expect(regex(blocks).test(' ساء ')).toBeTrue();
        expect(regex(blocks).test(' لاء ')).toBeFalse();
    });
    it('keeps exclusion clauses out of the positive pattern and word spacing', function () {
        var filter = part('exclude', '', {choices: [{value: 'فرعون'}]});
        var clauses = [part('text', 'م'), filter, part('text', 'اء')];
        var compiled = QuranQueryBuilder.compile(clauses);
        expect(compiled.query).toBe('ماء');
        expect(compiled.exclusions[0].scope).toBe('verse');
        expect(QuranQueryBuilder.compile([filter]).error).toBeTruthy();
    });
    it('does not include neighbouring words when a match contains outer spaces', function () {
        var text = ' يعلمون علم يعلمون ';
        var start = text.indexOf(' علم ');
        expect(QuranQueryBuilder.wordContext(text, [start, start + ' علم '.length])).toBe(' علم ');
    });

    it('validates numbers, ranges, list entries and exclusion scope', function () {
        var invalid = [part('letters', '', {repetition: 'exact', count: null}), part('letters', '', {repetition: 'exact', count: 1.5}),
            part('letters', '', {repetition: 'exact', count: 51}), part('letters', '', {repetition: 'range', minCount: 4, maxCount: 2}),
            part('between', 'قال', {endValue: 'رب', gapMode: 'range', gapMin: 3, gapMax: 1}),
            part('between', 'قال', {endValue: 'رب', gapMode: 'exact', gapCount: null}),
            part('between', 'قال', {endValue: 'رب', gapMode: 'exact', gapCount: -1}),
            part('between', 'قال', {endValue: 'رب', order: 'invalid'}),
            part('alternatives', '', {choices: [{value: 'موسى'}]}), part('alternatives', '', {choices: [{value: 'موسى'}, {value: '.*'}]}),
            part('exclude', '', {scope: 'invalid', choices: [{value: 'فرعون'}]})];
        invalid.forEach(function (block) { expect(QuranQueryBuilder.compile([part('word'), block]).error).toBeTruthy(); });
    });
});

describe('Exclusion scopes, counts and highlights', function () {
    var original, root, scope, location, controller;
    function part(type, value, options) { return Object.assign(QuranQueryBuilder.create(type, value), options || {}); }
    function run(blocks) { scope.queryBlocks = blocks; scope.searchButtonClicked(); root.$digest(); }
    function ids() { return scope.foundAyat.map(function (ayah) { return ayah.ID; }); }
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller, $rootScope, $httpBackend, $location) {
        original = all_ayat;
        all_ayat = [
            ' قَالَ مُوسَىٰ وَقَالَ فِرْعَوْنُ ', ' قَالَ مُوسَىٰ ', ' قَالَ عِيسَىٰ ',
            ' هُمْ يَعْلَمُونَ وَاللهُ يَعْلَمُ ', ' اللَّهُ لَا يَعْلَمُونَ وَاللَّهُ لَا يَعْلَمُ ',
            ' قَالَ فِرْعَوْنُ مُوسَىٰ ', ' هُمْ يَعْلَمُونَ '
        ].map(function (text, i) { return {ID: i + 1, sura_id: 1, verse_id: i + 1, text: text}; });
        root = $rootScope; location = $location; controller = $controller;
        location.path('/search').search({});
        scope = root.$new(); controller('AyatSearchController', {$scope: scope});
        $httpBackend.whenGET('view/search.html').respond('');
    }));
    afterEach(function () { all_ayat = original; });

    it('excludes whole verses even when the forbidden word precedes the positive match', function () {
        var choices = part('alternatives', '', {choices: [{value: 'موسى'}, {value: 'عيسى'}]});
        run([choices]); expect(ids()).toEqual([1, 2, 3, 6]);
        run([choices, part('exclude', '', {choices: [{value: 'فرعون'}]})]);
        expect(ids()).toEqual([2, 3]);
        expect(scope.resultsGroup.length).toBe(2);
    });
    it('checks the full enclosing word when the positive match is only a substring', function () {
        run([part('text', 'علم'), part('exclude', '', {scope: 'word', matchMode: 'ends', choices: [{value: 'ون'}]})]);
        expect(ids()).toEqual([4, 5]);
        var verse = scope.foundAyat[0];
        expect(verse.matched.length).toBe(1);
        expect((verse.text_with_highlight.match(/class='highlightedText'/g) || []).length).toBe(1);
        expect(verse.text_with_highlight).toContain('يَعْلَمُونَ');
        expect(scope.foundAyat.some(function (ayah) { return ayah.ID === 7; })).toBeFalse();
    });
    it('filters captured results individually while keeping allowed results in the same verse', function () {
        run([part('context', 'الله', {count: 2}), part('exclude', '', {scope: 'word', matchMode: 'ends', choices: [{value: 'ون'}]})]);
        expect(ids()).toEqual([5]);
        expect(scope.resultsGroup).toEqual(['لَا يَعْلَمُ']);
        expect((scope.foundAyat[0].text_with_highlight.match(/class='highlightedText'/g) || []).length).toBe(1);
    });
    it('refreshes visible result groups when only an exclusion changes', function () {
        var positive = part('alternatives', '', {choices: [{value: 'موسى'}, {value: 'عيسى'}]});
        run([positive]); expect(scope.resultsGroup.length).toBe(2);
        run([positive, part('exclude', '', {choices: [{value: 'عيسى'}]})]);
        expect(scope.resultsGroup).toEqual(['مُوسَىٰ']);
        expect(scope.filteredAyat.length).toBe(3);
    });

    it('restores exclusion rules from saved query blocks and clears them when removed', function () {
        var positive = part('alternatives', '', {choices: [{value: 'موسى'}, {value: 'عيسى'}]});
        run([positive, part('exclude', '', {choices: [{value: 'فرعون'}]})]);
        scope.$destroy(); scope = root.$new(); controller('AyatSearchController', {$scope: scope}); root.$digest();
        expect(ids()).toEqual([2, 3]);
        expect(scope.queryExclusions.length).toBe(1);
        expect(JSON.parse(QuranSearchLink.parameters(location.search()).qb)[1].choices[0].value).toBe('فرعون');
        run([positive]); expect(ids()).toEqual([1, 2, 3, 6]);
        expect(scope.queryExclusions).toEqual([]);
    });
});

describe('Cross-ayah searches', function () {
    var original, root, scope, location, controller;
    function part(type, value, extra) { return Object.assign(QuranQueryBuilder.create(type, value), extra || {}); }
    function query() { return [part('text', 'العالمين', {matchMode: 'whole'}), part('ayahBreak'), part('text', 'الرحمن', {matchMode: 'whole'})]; }
    function run(blocks) { scope.queryBlocks = blocks; scope.searchButtonClicked(); root.$digest(); }
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller, $rootScope, $httpBackend, $location) {
        original = all_ayat;
        all_ayat = [
            {ID: 1, sura_id: 1, verse_id: 1, text: ' رب العالمين ۚ '},
            {ID: 2, sura_id: 1, verse_id: 2, text: ' الرحمن الرحيم '},
            {ID: 3, sura_id: 1, verse_id: 3, text: ' العالمين '},
            {ID: 4, sura_id: 2, verse_id: 1, text: ' الرحمن '},
            {ID: 5, sura_id: 2, verse_id: 2, text: ' العالمين '},
            {ID: 6, sura_id: 2, verse_id: 3, text: ' الرحمن الرحيم '}
        ];
        root = $rootScope; location = $location; controller = $controller;
        location.path('/search').search({});
        scope = root.$new(); controller('AyatSearchController', {$scope: scope});
        $httpBackend.whenGET('view/search.html').respond('');
    }));
    afterEach(function () { all_ayat = original; scope.$destroy(); });
    it('requires searchable parts on both sides of each separator', function () {
        [[part('ayahBreak')], [part('ayahBreak'), part('text', 'رب')], [part('text', 'رب'), part('ayahBreak')], [part('text', 'رب'), part('ayahBreak'), part('ayahBreak'), part('text', 'رب')]].forEach(function (blocks) {
            expect(QuranQueryBuilder.compile(blocks).error).toBeTruthy();
        });
    });
    it('matches consecutive ayat with pause marks but never crosses a surah', function () {
        run(query());
        expect(scope.foundAyat.map(function (item) { return item.ID; })).toEqual([1, 5]);
        expect(scope.foundAyat[0].ayat.length).toBe(2);
        expect(scope.distinctAyahCount).toBe(4);
        expect(scope.resultsGroup.join('')).not.toContain('\uE004');
        scope.foundAyat[0].ayat.forEach(function (ayah) {
            expect(ayah.text_with_highlight).toContain("class='highlightedText'");
            expect(ayah.text_with_highlight.replace(/<[^>]*>/g, '')).toBe(ayah.text);
        });
    });
    it('keeps ordinary phrases and word wildcards inside a single ayah', function () {
        run([part('text', 'العالمين الرحمن')]); expect(scope.foundAyat.length).toBe(0);
        run([part('text', 'العالمين'), part('words'), part('text', 'الرحيم')]); expect(scope.foundAyat.length).toBe(0);
    });
    it('uses the reference number as the starting ayah and restores saved blocks and filters', function () {
        scope.reference = {ayah: 2, surah: 2}; run(query());
        expect(scope.foundAyat.map(function (item) { return item.ID; })).toEqual([5]);
        scope.$destroy(); scope = root.$new(); controller('AyatSearchController', {$scope: scope}); root.$digest();
        expect(scope.queryBlocks[1].type).toBe('ayahBreak');
        expect(scope.reference).toEqual({ayah: 2, surah: 2});
        expect(scope.foundAyat[0].ID).toBe(5);
        run([part('text', 'الرحمن')]); expect(scope.foundAyat.length).toBe(0);
    });
    it('counts overlapping groups as groups and distinct ayat separately', function () {
        all_ayat = [1, 2, 3].map(function (id) { return {ID: id, sura_id: 1, verse_id: id, text: ' رب '}; });
        run([part('text', 'رب'), part('ayahBreak'), part('text', 'رب')]);
        expect(scope.filteredAyat.length).toBe(2); expect(scope.distinctAyahCount).toBe(3);
        run([part('text', 'رب'), part('ayahBreak'), part('text', 'رب'), part('ayahBreak'), part('text', 'رب')]);
        expect(scope.filteredAyat.length).toBe(1); expect(scope.distinctAyahCount).toBe(3);
    });
    it('preserves capture frequency, highlight offsets and result filtering', function () {
        run([part('text', 'العالمين'), part('ayahBreak'), part('capture')]);
        expect(scope.countedAyahAttributes.matched['الرحمن']).toBe(2);
        expect(scope.foundAyat[0].ayat[1].text_with_highlight).toContain('الرحمن</span>');
        scope.useResults = {'الرحمن': true}; root.$digest(); expect(scope.filteredAyat.length).toBe(2);
        scope.useSuwar = {'2': true}; root.$digest(); expect(scope.filteredAyat.length).toBe(1); expect(scope.distinctAyahCount).toBe(2);
    });
    it('excludes groups if any involved ayah contains a verse exclusion', function () {
        run(query().concat([part('exclude', '', {choices: [{value: 'رب'}]})]));
        expect(scope.foundAyat.map(function (item) { return item.ID; })).toEqual([5]);
        run(query().concat([part('exclude', '', {choices: [{value: 'الرحيم'}]})])); expect(scope.foundAyat.length).toBe(0);
    });
    it('applies full enclosing word exclusions to captured substrings after the boundary', function () {
        run([part('text', 'العالمين'), part('ayahBreak'), part('capture'), part('exclude', '', {scope: 'word', choices: [{value: 'الرحمن'}]})]);
        expect(scope.foundAyat.length).toBe(0);
    });
    it('copies a fully escaped URL that restores cross-ayah settings and active filters', function () {
        scope.reference = {ayah: 1, surah: 1}; run(query());
        scope.useResults = {}; scope.useResults[scope.resultsGroup[0]] = true;
        scope.useSuwar = {'1': true}; root.$digest();
        scope.copySearchLink();
        var copied = scope.shareUrl;
        expect(copied).toMatch(/#!\/search\?q=v1\.[A-Za-z0-9_-]+$/);
        expect(copied).not.toMatch(/[\u0600-\u06ff\uE004\s<>"{}]/);
        var params = {};
        copied.split('?')[1].split('&').forEach(function (pair) {
            var parts = pair.split('='); params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
        });
        params = QuranSearchLink.parameters(params);
        expect(JSON.parse(params.qb)[1].type).toBe('ayahBreak');
        expect(params.filter_results).toBe(scope.resultsGroup[0]);
        scope.$destroy(); location.search(params); scope = root.$new();
        controller('AyatSearchController', {$scope: scope}); root.$digest();
        expect(scope.filteredAyat.length).toBe(1);
        expect(scope.foundAyat[0].ayat.map(function (ayah) { return ayah.ID; })).toEqual([1, 2]);
        expect(scope.reference).toEqual({ayah: 1, surah: 1});
    });

});


describe('URL-safe saved-search format', function () {
    it('round trips Unicode, punctuation and all saved settings without raw URL syntax', function () {
        var params = {s: 'ولكن (. . .) ', qb: JSON.stringify([QuranQueryBuilder.create('context', 'ولكن')]), filter_results: 'قال & رب#=?%+ ۝', ayah: 2, surah: 1, remove_harakah: false};
        var encoded = QuranSearchLink.encode(params);
        expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
        expect(QuranSearchLink.parameters({q: encoded})).toEqual(params);
        expect(QuranSearchLink.parameters({q: 'v1.invalid'})).toEqual({q: 'v1.invalid'});
    });
    it('loads the reported old ولكن URL and restores the same results from its new URL', angular.mock.inject(function ($controller, $rootScope, $location, $httpBackend) {
        var block = QuranQueryBuilder.create('context', 'ولكن'); block.count = 3;
        $location.path('/search').search({s: 'ولكن (. . .) ', qb: JSON.stringify([block]), word_match: 'contains', filter_results: '', filter_suwar: ''}).hash('main-container');
        var scope = $rootScope.$new();
        $controller('AyatSearchController', {$scope: scope});
        $httpBackend.whenGET('view/search.html').respond('');
        $rootScope.$digest();
        expect($location.search().q).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
        expect($location.search().qb).toBeUndefined();
        expect(scope.queryBlocks[0].type).toBe('context'); expect(scope.queryBlocks[0].count).toBe(3);
        expect(scope.savedQueryOnly).toBeFalse();
        var counts = Object.assign({}, scope.countedAyahAttributes.matched);
        expect(scope.filteredAyat.length).toBeGreaterThan(0);
        scope.$destroy(); scope = $rootScope.$new();
        $controller('AyatSearchController', {$scope: scope}); $rootScope.$digest();
        expect(Object.assign({}, scope.countedAyahAttributes.matched)).toEqual(counts);
        expect(scope.queryBlocks[0].value).toBe('ولكن'); scope.$destroy();
    }));
    beforeEach(angular.mock.module('myApp'));
});
