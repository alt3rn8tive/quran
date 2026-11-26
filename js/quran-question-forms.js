// Match the written Quran text on complete Arabic words, preserving supplied vowel marks.
var QuranQuestionForms = (function () {
    'use strict';

    var vowels = /[\u064B-\u0652\u0670]/u;
    var wordPattern =
        /(?:[\u0621-\u063A\u0641-\u064A\u0671][\u064B-\u0652\u0670]*)+/gu;
    var letterPattern =
        /([\u0621-\u063A\u0641-\u064A\u0671])([\u064B-\u0652\u0670]*)/gu;

    function tokenize(text) {
        return (
            text.normalize('NFKC').replace(/ـ/gu, '').match(wordPattern) || []
        ).map(function (raw) {
            var letters = Array.from(
                raw.matchAll(letterPattern),
                function (match) {
                    return {
                        letter: match[1] === 'ٱ' ? 'ا' : match[1],
                        marks: match[2],
                    };
                },
            );
            return { raw: raw, letters: letters, marked: vowels.test(raw) };
        });
    }

    function sameLetters(requested, source, offset) {
        if (source.length - offset !== requested.length) return false;
        return requested.every(function (letter, index) {
            var actual = source[index + offset];
            return (
                letter.letter === actual.letter &&
                Array.from(letter.marks).every(function (mark) {
                    return actual.marks.includes(mark);
                })
            );
        });
    }

    function matchWord(request, source, loose) {
        var expected = request.letters;
        var actual = source.letters;
        if (sameLetters(expected, actual, 0)) return true;
        if (!loose || expected.length < 3) return false;

        // Only natural-language lookup ignores a written article or attached particle.
        // Explicitly marked letters on the requested word are never ignored.
        var offset = actual.length - expected.length;
        if (offset > 0 && offset <= 4) {
            var prefix = actual
                .slice(0, offset)
                .map(function (letter) {
                    return letter.letter;
                })
                .join('');
            if (
                /^(?:[وف][بكل]?|[بكل]|[وف]?[بك]?ال|[وف]?لل)$/u.test(prefix) &&
                sameLetters(expected, actual, offset)
            )
                return true;
        }
        if (
            expected.length >= 4 &&
            !expected[0].marks &&
            /^[وفبكل]$/u.test(expected[0].letter) &&
            sameLetters(expected.slice(1), actual, 0)
        )
            return true;
        if (
            !request.marked &&
            expected.length > 4 &&
            expected[0].letter === 'ا' &&
            expected[1].letter === 'ل'
        )
            return sameLetters(expected.slice(2), actual, 0);
        return false;
    }

    function occurrences(requested, words, loose) {
        if (!requested.length) return 0;
        var count = 0;
        for (var start = 0; start <= words.length - requested.length; start++) {
            if (
                requested.every(function (word, index) {
                    return matchWord(
                        word,
                        words[start + index],
                        loose && index === 0,
                    );
                })
            )
                count++;
        }
        return count;
    }

    function quoted(text) {
        var pairs = { '«': '»', '‹': '›', '“': '”', '"': '"' };
        var delimiters = /[«»‹›“”"]/u;
        var phrases = [];
        var outside = '';
        for (var i = 0; i < text.length; i++) {
            var char = text[i];
            if (!delimiters.test(char)) {
                outside += char;
                continue;
            }
            var end = pairs[char];
            var close = end ? text.indexOf(end, i + 1) : -1;
            if (close < 0) return { invalid: true };
            var phrase = text.slice(i + 1, close).trim();
            if (!phrase || delimiters.test(phrase) || !tokenize(phrase).length)
                return { invalid: true };
            phrases.push(phrase);
            outside += ' ';
            i = close;
        }
        return { phrases: phrases, outside: outside };
    }

    function constraints(question, meaningful) {
        var parsed = quoted(question);
        if (parsed.invalid) return parsed;
        var terms = tokenize(parsed.outside).filter(function (word) {
            return word.marked && meaningful(word.raw);
        });
        var literal = parsed.phrases.map(tokenize);
        return {
            active: terms.length > 0 || literal.length > 0,
            terms: terms,
            phrases: parsed.phrases,
            evidence: terms.map(function (word) {
                return word.raw;
            }),
            matches: function (words) {
                return (
                    terms.every(function (term) {
                        return words.some(function (word) {
                            return matchWord(term, word, true);
                        });
                    }) &&
                    literal.every(function (phrase) {
                        return occurrences(phrase, words, false) > 0;
                    })
                );
            },
        };
    }

    return {
        tokenize: tokenize,
        occurrences: occurrences,
        quoted: quoted,
        constraints: constraints,
    };
})();
