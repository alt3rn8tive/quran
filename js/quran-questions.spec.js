describe('Questions from the Quran', function () {
    var corpus;

    beforeAll(function () {
        corpus = QuranQuestions.createCorpus(all_ayat, all_suwar);
    });

    it('reads a reference or bounded same-surah range directly from the corpus', function () {
        expect(corpus.reference('ما نص الآية ٢٥٥ من سورة البقرة؟')[0]).toEqual(
            corpus.verse('2:255'),
        );
        expect(
            corpus.reference('۱۱۲:۱–۴').map(function (verse) {
                return verse.ref;
            }),
        ).toEqual(['112:1', '112:2', '112:3', '112:4']);
        expect(corpus.reference('2:999')).toEqual([]);
        expect(corpus.reference('1:7-8')).toEqual([]);
    });

    it('ignores question scaffolding when finding literal occurrences', function () {
        var verses = corpus.search('أين ذكرت البعوضة؟');
        expect(
            verses.map(function (verse) {
                return verse.ref;
            }),
        ).toEqual(['2:26']);
        expect(verses[0].href).toBe('#!/surah?id=2#ayah-26');
        expect(corpus.search('ما سعر الدولار اليوم؟')).toEqual([]);
    });

    it('does not apply a prepared answer to a materially changed question', function () {
        var catalog = QuranQuestions.createCatalog(
            {
                version: 1,
                topics: [
                    {
                        id: 'paradise',
                        question: 'كيف أدخل الجنة؟',
                        aliases: ['ما أسباب دخول الجنة؟'],
                        points: [
                            { text: 'الإيمان وعمل الصالحات', refs: ['4:124'] },
                        ],
                    },
                ],
            },
            corpus,
        );
        var answer = catalog.answer('من فضلك كَيْفَ أدخل الجَنَّة في القرآن؟');
        expect(answer.id).toBe('paradise');
        expect(answer.points[0].verses[0].text).toBe(
            corpus.verse('4:124').text,
        );
        expect(catalog.answer('هل أدخل الجنة دون إيمان؟')).toBeNull();
    });

    it('distinguishes complete words with the same letters and different vowels', function () {
        var ruler = corpus.findPhrase('مَلِك').map(function (verse) {
            return verse.ref;
        });
        var angel = corpus.findPhrase('مَلَك').map(function (verse) {
            return verse.ref;
        });
        expect(ruler).toContain('18:79');
        expect(angel).toContain('12:31');
        expect(
            ruler.filter(function (ref) {
                return angel.includes(ref);
            }),
        ).toEqual([]);
        expect(
            corpus.findPhrase('دَيْنٍ').map(function (verse) {
                return verse.ref;
            }),
        ).toEqual(['4:11', '4:12']);
        expect(corpus.findPhrase('دِينٍ')).toEqual([]);
        expect(corpus.findPhrase('الملِك').length).toBeGreaterThan(0);
        expect(corpus.findPhrase('الملَك')).toEqual([]);
    });

    it('applies a marked term to the lexical results and to the semantic candidate set', function () {
        var question = 'ما الآيات المتعلقة بمَلِك؟';
        var refs = corpus.matchingRefs(QuranQuestions.constraints(question));
        expect(refs.has('12:31')).toBe(false);
        expect(refs.has('18:79')).toBe(true);
        var matching = corpus.matchingRefs(
            QuranQuestions.constraints('ما الآيات المتعلقة بـ «مَلِك»؟'),
        );
        expect(Array.from(matching)).toEqual(['18:79', '114:2']);
        expect(
            corpus
                .search('أين وردت «مَلِك»؟')
                .map(function (verse) {
                    return verse.ref;
                })
                .sort(),
        ).toEqual(['114:2', '18:79']);
    });

    it('does not reuse a topic when its wording changes to a different vocalization', function () {
        var catalog = QuranQuestions.createCatalog(
            {
                version: 1,
                topics: [
                    {
                        id: 'debt',
                        question: 'كيف أوثق الدَّيْن؟',
                        aliases: [],
                        points: [{ text: 'كتابة الدين', refs: ['2:282'] }],
                    },
                ],
            },
            corpus,
        );
        expect(catalog.answer('كيف أوثق الدَّيْن؟').id).toBe('debt');
        expect(catalog.answer('كيف أوثق الدِّين؟')).toBeNull();
        expect(catalog.related('كيف أوثق الدِّين؟')).toEqual([]);
    });

    it('rejects missing evidence before rendering a prepared answer', function () {
        expect(function () {
            QuranQuestions.createCatalog(
                {
                    version: 1,
                    topics: [
                        {
                            id: 'invalid',
                            question: 'سؤال',
                            aliases: [],
                            points: [{ text: 'جواب', refs: ['4:999'] }],
                        },
                    ],
                },
                corpus,
            );
        }).toThrowError('Unknown verse reference');
    });
});
