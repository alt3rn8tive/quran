describe('Direct answers from the Quran corpus', function () {
    var corpus, engine;

    beforeAll(function () {
        corpus = QuranQuestions.createCorpus(all_ayat, all_suwar);
        engine = QuranExtractive.create(
            all_ayat,
            all_suwar,
            corpus,
            corpus.findPhrase,
        );
    });

    function refs(answer) {
        return answer.points[0].verses.map(function (verse) {
            return verse.ref;
        });
    }

    it('locates an exact quoted phrase and a word given in a common attached form', function () {
        var phrase = engine.answer('أين وردت عبارة «إن مع العسر يسرا»؟');
        expect(phrase.kind).toBe('extractive');
        expect(phrase.constraint).toBe('إن مع العسر يسرا');
        expect(refs(phrase)).toEqual(['94:6']);
        expect(phrase.points[0].verses[0].text).toBe(corpus.verse('94:6').text);
        expect(refs(engine.answer('أين ذكرت البعوضة؟'))).toEqual(['2:26']);
        expect(
            refs(engine.answer('ما مواضع عبارة ‹إن مع العسر يسرا›؟')),
        ).toEqual(['94:6']);
        expect(engine.answer('ما معنى كلمة ‹البعوضة›؟')).toBeNull();
    });

    it('retains explicit vowels in both quoted and bare lookups', function () {
        var unmatched = engine.answer('أين وردت كلمة «العَلَم»؟');
        expect(unmatched.constraint).toBe('العَلَم');
        expect(unmatched.blockCandidates).toBe(true);
        var matched = engine.answer('في أي سورة وردت كلمة العِلْم؟');
        expect(matched.constraint).toBe('العِلْم');
        expect(refs(matched)).toContain('2:120');
    });

    it('preserves the requested surah and clarifies an invalid or incompatible scope', function () {
        var scoped = engine.answer('أين ذكرت «رب العالمين» في سورة رقم ١؟');
        expect(refs(scoped)).toEqual(['1:2']);
        expect(scoped.scope).toBe(all_suwar[0].title);
        var mismatch = engine.answer(
            'أين وردت البعوضة فِي سُورَةِ النِّسَاءِ؟',
        );
        expect(mismatch.clarification).toContain(all_suwar[3].title);
        expect(mismatch.scope).toBe(all_suwar[3].title);
        expect(mismatch.blockCandidates).toBe(true);
        expect(
            engine.answer('أين وردت «رب العالمين» في سورة غير موجودة؟')
                .blockCandidates,
        ).toBe(true);
    });

    it('distinguishes the count of occurrences from the count of matching ayat', function () {
        var occurrences = engine.answer(
            'كم مرة وردت كلمة «الله» في سورة النساء؟',
        );
        expect(occurrences.points[0].text).toContain('هو 183');
        expect(occurrences.points[0].text).toContain('الآيات المطابقة هو 122');
        expect(occurrences.points[0].verses.length).toBe(12);
        var ayat = engine.answer('في كم آية وردت كلمة «الله» في سورة النساء؟');
        expect(ayat.points[0].text).toContain('هو 122');
        expect(ayat.points[0].text).not.toContain('183');
    });

    it('cites the named speaker and stops when the words require contextual attribution', function () {
        var attributed = engine.answer('من قال «رب أرني كيف تحيي الموتى»؟');
        expect(attributed.points[0].text).toContain('إبراهيم');
        expect(refs(attributed)).toEqual(['2:260']);
        var pronoun = engine.answer('من قال «أنا ربكم الأعلى»؟');
        expect(pronoun.clarification).toContain('مسمّى صراحة');
        expect(pronoun.blockCandidates).toBe(true);
        var acrossSpeakers = engine.answer(
            'من قال «رب أرني كيف تحيي الموتى قال أولم تؤمن»؟',
        );
        expect(acrossSpeakers.blockCandidates).toBe(true);
    });

    it('uses the bundled surah verse count and leaves unsupported question forms to the caller', function () {
        var count = engine.answer('كم عدد آيات سورة الكهف؟');
        expect(count.points[0].text).toContain('110');
        expect(refs(count)).toEqual(['18:110']);
        expect(engine.answer('كم عدد آيات سورة ٩٩٩؟').blockCandidates).toBe(
            true,
        );
        expect(engine.answer('كم مرة نصلي كل يوم؟')).toBeNull();
        expect(engine.answer('كيف أدخل الجنة؟')).toBeNull();
    });
});
