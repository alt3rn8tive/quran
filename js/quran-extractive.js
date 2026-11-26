// Answers whose claims can be derived from the bundled text and its numbering.
var QuranExtractive = (function () {
    'use strict';

    var commands = [
        [
            'locations',
            /^(?:(?:اين|في اي (?:سوره|ايه|موضع)) (?:وردت?|ذكرت?|جاءت?|توجد)(?: (?:كلمه|عباره|لفظ|اسم))?|ما مواضع (?:كلمه|عباره|لفظ|اسم))$/,
        ],
        [
            'verse-count',
            /^(?:في كم ايه (?:وردت?|ذكرت?|جاءت?)|(?:ما|كم) عدد الايات التي (?:وردت?|ذكرت?|جاءت?) فيها)(?: (?:كلمه|عباره|لفظ|اسم))?$/,
        ],
        [
            'occurrence-count',
            /^(?:كم مره (?:وردت?|ذكرت?|جاءت?|تكررت?)|كم تكررت?|(?:ما|كم) عدد مرات (?:ورود|ذكر|تكرار))(?: (?:كلمه|عباره|لفظ|اسم))?$/,
        ],
        ['speaker', /^من (?:القائل|قال|قالت)(?: (?:هذه العباره|هذا القول))?$/],
    ];
    var quotation = /«([^«»]+)»|‹([^‹›]+)›|“([^“”]+)”|"([^"]+)"/gu;
    var hasQuotationMark = /[«»‹›“”"]/u;
    var arabicWord = /[\u0621-\u063a\u0640-\u065f\u0670\u0671\u06d6-\u06ed]+/gu;
    var vocalized = /[\u064b-\u065f\u0670]/u;
    var speakers = [
        'الله',
        'إبراهيم',
        'موسى',
        'يوسف',
        'يعقوب',
        'إسحاق',
        'إسماعيل',
        'نوح',
        'هود',
        'صالح',
        'لوط',
        'شعيب',
        'أيوب',
        'يونس',
        'زكريا',
        'يحيى',
        'عيسى ابن مريم',
        'عيسى',
        'مريم',
        'فرعون',
        'هامان',
        'قارون',
        'إبليس',
        'امرأة فرعون',
        'امرأة العزيز',
        'الأعراب',
        'الملائكة',
    ];
    var speechVerb = /^(?:[وف])?قال(?:ت)?$/;
    var evidenceLimit = 12;

    function digits(text) {
        return text.replace(/[٠-٩۰-۹]/gu, function (digit) {
            return String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0));
        });
    }

    function fold(text) {
        return digits(text.normalize('NFKC'))
            .replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
            .replace(/[أإآٱ]/gu, 'ا')
            .replace(/ى/gu, 'ي')
            .replace(/ة/gu, 'ه')
            .replace(/[^\u0621-\u063a\u0641-\u064a0-9]+/gu, ' ')
            .trim();
    }

    var speakerNames = speakers.map(function (name) {
        return { name: name, words: fold(name).split(' ') };
    });

    function marker(text) {
        var key = fold(text);
        var rule = commands.find(function (command) {
            return command[1].test(key);
        });
        return rule && rule[0];
    }

    function splitScope(target) {
        // Quoted text is never interpreted as a scope. For bare text, use the
        // first explicit corpus/surah qualifier and retain it for validation.
        var words = Array.from(target.matchAll(arabicWord));
        for (var i = 0; i < words.length - 1; i++) {
            if (!/^(?:في|من)$/u.test(fold(words[i][0]))) continue;
            if (!/^(?:سوره|القران)$/u.test(fold(words[i + 1][0]))) continue;
            var offset = words[i].index;
            return {
                literal: target.slice(0, offset),
                scope: target.slice(offset),
            };
        }
        return { literal: target, scope: '' };
    }

    function parse(question) {
        var text = question
            .trim()
            .replace(/[؟?!.]+$/u, '')
            .trim();
        var quoted = Array.from(text.matchAll(quotation));
        if (quoted.length) {
            var match = quoted[0];
            var prefix = text.slice(0, match.index);
            var kind = marker(prefix);
            if (kind)
                return {
                    kind: kind,
                    literal: (
                        match[1] ||
                        match[2] ||
                        match[3] ||
                        match[4]
                    ).trim(),
                    quoted: true,
                    scope: text.slice(match.index + match[0].length).trim(),
                    malformed:
                        quoted.length !== 1 ||
                        hasQuotationMark.test(prefix) ||
                        hasQuotationMark.test(
                            text.slice(match.index + match[0].length),
                        ),
                };
        }

        // Prefix matching uses normalized words while the original slice,
        // including each explicitly typed vowel mark, goes to the matcher.
        var words = Array.from(text.matchAll(arabicWord));
        for (var end = Math.min(words.length, 9); end > 0; end--) {
            var offset = words[end - 1].index + words[end - 1][0].length;
            var mode = marker(text.slice(0, offset));
            if (!mode) continue;
            var tail = text
                .slice(offset)
                .replace(/^\s*[:：]\s*/u, '')
                .trim();
            var split = splitScope(tail);
            return {
                kind: mode,
                literal: split.literal.trim(),
                quoted: false,
                scope: split.scope,
                malformed: hasQuotationMark.test(tail) || /[؟?!؛;]/u.test(tail),
            };
        }
        return null;
    }

    function attribution(verses, literal) {
        var phrase = fold(literal).split(' ');
        if (
            phrase.length < 2 ||
            phrase.some(function (word) {
                return /^(?:[وف])?(?:قال(?:ت|وا)?|قيل|قل|يقول(?:ون)?)$/u.test(
                    word,
                );
            })
        )
            return null;
        var attributed = new Set();
        for (var verse of verses) {
            var words = fold(verse.text).split(' ');
            var found = 0;
            for (
                var index = 0;
                index <= words.length - phrase.length;
                index++
            ) {
                if (
                    !phrase.every(function (word, position) {
                        return words[index + position] === word;
                    })
                )
                    continue;
                found++;
                var speaker = speakerNames.find(function (entry) {
                    var start = index - entry.words.length;
                    return (
                        start > 0 &&
                        speechVerb.test(words[start - 1]) &&
                        entry.words.every(function (word, position) {
                            return words[start + position] === word;
                        })
                    );
                });
                if (!speaker) return null;
                attributed.add(speaker.name);
            }
            if (
                !found ||
                (Number.isInteger(verse.occurrences) &&
                    found !== verse.occurrences)
            )
                return null;
        }
        return attributed.size === 1 ? attributed.values().next().value : null;
    }

    function answer(question, text, verses, constraint, scope) {
        return {
            kind: 'extractive',
            question: question,
            constraint: constraint,
            scope: scope,
            points: [{ text: text, verses: verses.slice(0, evidenceLimit) }],
        };
    }

    function clarify(message, constraint, scope) {
        return {
            clarification: message,
            constraint: constraint,
            scope: scope,
            blockCandidates: true,
        };
    }

    function create(ayat, suwar, corpus, findPhrase) {
        var byNumber = new Map();
        var byName = new Map();
        var refsBySurah = new Map();
        suwar.forEach(function (surah) {
            byNumber.set(surah.order, surah);
            var name = fold(surah.title);
            byName.set(name, surah);
            var withoutArticle = name.replace(/^ال(?=\S)/u, '');
            if (!byName.has(withoutArticle)) byName.set(withoutArticle, surah);
        });
        ayat.forEach(function (ayah) {
            if (!refsBySurah.has(ayah.sura_id))
                refsBySurah.set(ayah.sura_id, []);
            refsBySurah.get(ayah.sura_id).push(ayah.verse_id);
        });
        refsBySurah.forEach(function (refs) {
            refs.sort(function (a, b) {
                return a - b;
            });
        });

        function identifySurah(segment) {
            var name = segment.replace(/^(?:رقم )/u, '');
            return /^\d{1,3}$/.test(name)
                ? byNumber.get(Number(name))
                : byName.get(name);
        }

        function scopeName(segment) {
            var normalized = fold(segment);
            if (
                !normalized ||
                /^(?:في|من) القران(?: الكريم)?$/u.test(normalized)
            )
                return null;
            var scoped = normalized.match(/^(?:في|من) سوره (.+)$/u);
            return (scoped && identifySurah(scoped[1])) || false;
        }

        function surahAnswer(question) {
            var normalized = fold(question).replace(
                / في القران(?: الكريم)?$/u,
                '',
            );
            var match = normalized.match(
                /^(?:كم (?:عدد )?(?:ايات|ايه)(?: في)?|ما عدد ايات) سوره(?: (.+))?$/u,
            );
            if (!match) return null;
            var surah = match[1] && identifySurah(match[1]);
            if (!surah)
                return clarify(
                    'اكتب اسم السورة أو رقمها لحساب آياتها المرقمة.',
                );
            var refs = refsBySurah.get(surah.order);
            if (!refs || !refs.length) return null;
            var last = corpus.verse(surah.order + ':' + refs[refs.length - 1]);
            return answer(
                question,
                'عدد الآيات المرقمة في سورة ' +
                    surah.title +
                    ' في المصحف المعروض هو ' +
                    refs.length +
                    '.',
                last ? [last] : [],
                undefined,
                surah.title,
            );
        }

        function phraseAnswer(question, parsed) {
            var literal = parsed.literal;
            var words = literal.match(arabicWord) || [];
            if (
                parsed.malformed ||
                !words.length ||
                words.length > (parsed.quoted ? 30 : 9) ||
                /[^\u0621-\u063a\u0640-\u065f\u0670\u0671\u06d6-\u06ed\s،]/u.test(
                    literal,
                )
            ) {
                return clarify(
                    'اكتب الكلمة أو العبارة المطلوبة بين علامتي تنصيص، مثل «إن مع العسر يسرًا».',
                );
            }
            var surah = scopeName(parsed.scope);
            if (surah === false)
                return clarify(
                    'حدّد نطاق السؤال باسم السورة أو رقمها بعد العبارة، أو ابحث في القرآن كله.',
                    literal,
                );

            var verses = findPhrase(literal, {
                loose:
                    parsed.kind === 'locations' &&
                    !parsed.quoted &&
                    !vocalized.test(literal),
            });
            if (surah)
                verses = verses.filter(function (verse) {
                    return verse.ref.startsWith(surah.order + ':');
                });
            var selectedSurah = surah && surah.title;
            if (!verses.length)
                return clarify(
                    'لم أجد النص المطلوب' +
                        (surah ? ' في سورة ' + surah.title : '') +
                        '. تحقّق من صياغته أو من الحركات التي حدّدتها.',
                    literal,
                    selectedSurah,
                );

            var scope = surah
                ? ' في سورة ' + surah.title
                : ' في المصحف المعروض';
            var more =
                verses.length > evidenceLimit
                    ? ' تظهر أول ' + evidenceLimit + ' آية مطابقة أدناه.'
                    : '';
            if (parsed.kind === 'speaker') {
                var speaker = attribution(verses, literal);
                if (!speaker)
                    return clarify(
                        'وجدت النص، لكن لا أستطيع تحديد قائل واحد مسمّى صراحة قبل العبارة في كل موضع مطابق.',
                        literal,
                        selectedSurah,
                    );
                return answer(
                    question,
                    'القائل المذكور صراحةً قبل العبارة هو ' +
                        speaker +
                        '.' +
                        more,
                    verses,
                    literal,
                    selectedSurah,
                );
            }
            if (parsed.kind === 'occurrence-count') {
                if (
                    !verses.every(function (verse) {
                        return (
                            Number.isSafeInteger(verse.occurrences) &&
                            verse.occurrences > 0
                        );
                    })
                )
                    return clarify(
                        'تعذّر حساب عدد مرات ورود هذه العبارة.',
                        literal,
                        selectedSurah,
                    );
                var count = verses.reduce(function (sum, verse) {
                    return sum + verse.occurrences;
                }, 0);
                return answer(
                    question,
                    'عدد مرات ورود النص المطابق' +
                        scope +
                        ' هو ' +
                        count +
                        '، وعدد الآيات المطابقة هو ' +
                        verses.length +
                        '.' +
                        more,
                    verses,
                    literal,
                    selectedSurah,
                );
            }
            if (parsed.kind === 'locations' && verses.length === 1) {
                var ref = verses[0].ref.split(':');
                var title = byNumber.get(Number(ref[0])).title;
                return answer(
                    question,
                    'وردت المطابقة في سورة ' +
                        title +
                        '، الآية ' +
                        ref[1] +
                        '.',
                    verses,
                    literal,
                    selectedSurah,
                );
            }
            return answer(
                question,
                'عدد الآيات المطابقة' +
                    scope +
                    ' هو ' +
                    verses.length +
                    '.' +
                    more,
                verses,
                literal,
                selectedSurah,
            );
        }

        return {
            answer: function (question) {
                if (typeof question !== 'string' || question.length > 320)
                    return null;
                var metadata = surahAnswer(question);
                if (metadata) return metadata;
                var parsed = parse(question);
                return parsed ? phraseAnswer(question, parsed) : null;
            },
        };
    }

    return { create: create };
})();
