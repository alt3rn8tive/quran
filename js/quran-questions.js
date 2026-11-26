// The catalog contains answer points and references. Only the bundled corpus supplies verse text.
var QuranQuestions = (function () {
    'use strict';

    var stopWords = new Set(
        [
            'ما ماذا هل كيف متي اين من عن علي الي في او و ثم ان كان كانت هو هي هم هن ذلك هذه هذا',
            'الذي التي الذين يقول تقول قال ذكر ذكرت يذكر تذكر ورد وردت ذكرها ايات ايه قران الكريم الله تعالي',
            'بخصوص حول اريد اعطيني اشرح تحدث حدثني لي لنا حكم عدد كم بين بعد قبل عند لم لا كل يا به بها فيه فيها',
            'وهل فان بما مما كما الا سوره قول كلام كيفيه دليل دلائل امثله مثال مع جاء جاءت نص فضلك سمحت',
            'كلمه لفظ عباره ابحث اجد توجد يوجد ترد وردت يظهر تظهر',
        ]
            .join(' ')
            .split(' '),
    );

    function digits(text) {
        return text.replace(/[٠-٩۰-۹]/g, function (character) {
            return String(
                character.charCodeAt(0) - (character <= '٩' ? 0x660 : 0x6f0),
            );
        });
    }

    function normalize(text) {
        return digits(text.normalize('NFKC'))
            .replace(
                /[\u0610-\u061a\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g,
                '',
            )
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/[^\u0621-\u063a\u0641-\u064a0-9]+/g, ' ')
            .trim();
    }

    // Light prefix normalization for retrieval. The displayed text always comes from the corpus.
    function wordKey(word) {
        if (word.length >= 5)
            word = word.replace(/^(?:وال|فال|بال|كال|لل|ال)(?=.{3})/, '');
        return word;
    }

    function keywords(text) {
        return normalize(text)
            .split(' ')
            .filter(function (word) {
                return !stopWords.has(word);
            })
            .map(wordKey)
            .filter(function (word) {
                return word.length >= 2 && !stopWords.has(word);
            });
    }

    function comparable(text) {
        return normalize(text)
            .replace(/^(?:لو سمحت |من فضلك |اريد ان اعرف )/, '')
            .replace(
                / (?:من فضلك|لو سمحت|في القران(?: الكريم)?|بحسب القران(?: الكريم)?)$/,
                '',
            );
    }

    function constraints(question) {
        return QuranQuestionForms.constraints(question, function (word) {
            return keywords(word).length > 0;
        });
    }

    function createCorpus(ayat, suwar) {
        var names = new Map();
        var verses = new Map();
        var postings = new Map();
        var forms = new Map();
        var indexedLength = 0;

        suwar.forEach(function (surah) {
            var name = normalize(surah.title);
            names.set(name, surah.order);
            names.set(name.replace(/^ال/, ''), surah.order);
        });

        ayat.forEach(function (ayah) {
            var ref = ayah.sura_id + ':' + ayah.verse_id;
            var text = ayah.text.trim();
            forms.set(ref, QuranQuestionForms.tokenize(text));
            var words = keywords(text);
            var frequencies = new Map();
            words.forEach(function (word) {
                frequencies.set(word, (frequencies.get(word) || 0) + 1);
            });
            frequencies.forEach(function (count, word) {
                if (!postings.has(word)) postings.set(word, []);
                postings
                    .get(word)
                    .push({ ref: ref, count: count, length: words.length });
            });
            indexedLength += words.length;
            verses.set(ref, {
                ref: ref,
                text: text,
                label:
                    'سورة ' +
                    suwar[ayah.sura_id - 1].title +
                    ' · الآية ' +
                    ayah.verse_id,
                href: '#!/surah?id=' + ayah.sura_id + '#ayah-' + ayah.verse_id,
            });
        });

        function reference(question) {
            var direct = digits(question)
                .trim()
                .match(
                    /^(\d{1,3})\s*[:：]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/,
                );
            var surah, start, end;
            if (direct) {
                surah = Number(direct[1]);
                start = Number(direct[2]);
                end = direct[3] ? Number(direct[3]) : start;
            } else {
                var named = normalize(question).match(
                    /^(?:(?:اقرا|اعرض|ما نص|ما هي|ماذا تقول) )?(?:الايه|ايه)(?: رقم)? (\d{1,3}) (?:من |في )(?:سوره )?(.+)$/,
                );
                if (!named || !names.has(named[2])) return null;
                surah = names.get(named[2]);
                start = end = Number(named[1]);
            }
            if (
                end < start ||
                end - start >= 20 ||
                !verses.has(surah + ':' + start) ||
                !verses.has(surah + ':' + end)
            )
                return [];
            var result = [];
            for (var n = start; n <= end; n++)
                result.push(verses.get(surah + ':' + n));
            return result;
        }

        function matchingRefs(scope) {
            if (!scope.active) return null;
            return new Set(
                Array.from(forms)
                    .filter(function (entry) {
                        return scope.matches(entry[1]);
                    })
                    .map(function (entry) {
                        return entry[0];
                    }),
            );
        }

        function findPhrase(phrase, options) {
            var requested = QuranQuestionForms.tokenize(phrase);
            var results = [];
            forms.forEach(function (words, ref) {
                var count = QuranQuestionForms.occurrences(
                    requested,
                    words,
                    options && options.loose,
                );
                if (count)
                    results.push(
                        Object.assign({ occurrences: count }, verses.get(ref)),
                    );
            });
            return results;
        }

        function search(question, matching, relaxed) {
            if (matching === undefined) {
                var scope = constraints(question);
                if (scope.invalid || scope.phrases.length > 1) return [];
                matching = matchingRefs(scope);
            }
            var terms = Array.from(new Set(keywords(question))).slice(0, 25);
            var matches = new Map();
            var averageLength = indexedLength / verses.size;
            terms.forEach(function (term) {
                var entries = postings.get(term) || [];
                if (!entries.length) return;
                var weight = Math.log(
                    1 +
                        (verses.size - entries.length + 0.5) /
                            (entries.length + 0.5),
                );
                entries.forEach(function (entry) {
                    if (matching && !matching.has(entry.ref)) return;
                    var ranking = matches.get(entry.ref) || {
                        score: 0,
                        terms: 0,
                    };
                    var lengthFactor =
                        1.2 * (0.25 + (0.75 * entry.length) / averageLength);
                    ranking.score +=
                        (weight * (entry.count * 2.2)) /
                        (entry.count + lengthFactor);
                    ranking.terms++;
                    matches.set(entry.ref, ranking);
                });
            });
            var required = relaxed
                ? 1
                : Math.max(1, Math.ceil(terms.length / 2));
            return Array.from(matches)
                .filter(function (candidate) {
                    return candidate[1].terms >= required;
                })
                .sort(function (left, right) {
                    return right[1].score - left[1].score;
                })
                .slice(0, 36)
                .map(function (candidate) {
                    return verses.get(candidate[0]);
                });
        }

        return {
            verse: function (ref) {
                return verses.get(ref);
            },
            reference: reference,
            search: search,
            matchingRefs: matchingRefs,
            findPhrase: findPhrase,
            matches: function (verse, scope) {
                return scope.matches(forms.get(verse.ref));
            },
        };
    }

    function createCatalog(data, corpus) {
        if (data.version !== 1 || !Array.isArray(data.topics))
            throw new Error('Invalid question catalog');
        var aliases = new Map();
        var ids = new Set();
        var phraseIndex = [];
        var topics = data.topics.map(function (topic) {
            if (
                !topic.id ||
                ids.has(topic.id) ||
                !topic.question ||
                !Array.isArray(topic.aliases) ||
                !Array.isArray(topic.points) ||
                !topic.points.length
            )
                throw new Error('Invalid question topic');
            ids.add(topic.id);
            var phrases = [topic.question].concat(topic.aliases);
            var entry = {
                id: topic.id,
                question: topic.question,
                filterText: normalize(phrases.join(' ')),
                phraseForms: phrases.map(QuranQuestionForms.tokenize),
                points: topic.points.map(function (point) {
                    if (
                        !point.text ||
                        !Array.isArray(point.refs) ||
                        !point.refs.length
                    )
                        throw new Error('Missing verse evidence');
                    var verses = point.refs.map(corpus.verse);
                    if (
                        verses.some(function (verse) {
                            return !verse;
                        })
                    )
                        throw new Error('Unknown verse reference');
                    return { text: point.text, verses: verses };
                }),
            };
            phrases.forEach(function (phrase) {
                var key = comparable(phrase);
                if (!key || (aliases.has(key) && aliases.get(key) !== entry))
                    throw new Error('Ambiguous question alias: ' + phrase);
                aliases.set(key, entry);
                phraseIndex.push({
                    topic: entry,
                    words: new Set(keywords(phrase)),
                });
            });
            return entry;
        });

        function supports(entry, scope) {
            if (!scope.active) return true;
            if (!scope.phrases.length && entry.phraseForms.some(scope.matches))
                return true;
            return entry.points.some(function (point) {
                return point.verses.some(function (verse) {
                    return corpus.matches(verse, scope);
                });
            });
        }

        function related(question, scope) {
            scope = scope || constraints(question);
            if (scope.invalid || scope.phrases.length > 1) return [];
            var words = Array.from(new Set(keywords(question)));
            var scores = new Map();
            phraseIndex.forEach(function (entry) {
                var shared = words.filter(function (word) {
                    return entry.words.has(word);
                }).length;
                if (!shared) return;
                var score =
                    (shared * shared) / (words.length * entry.words.size);
                if (score >= 0.16 && score > (scores.get(entry.topic) || 0))
                    scores.set(entry.topic, score);
            });
            return Array.from(scores)
                .sort(function (left, right) {
                    return right[1] - left[1];
                })
                .map(function (match) {
                    return match[0];
                })
                .filter(function (entry) {
                    return supports(entry, scope);
                })
                .slice(0, 3);
        }

        return {
            topics: topics,
            answer: function (question, scope) {
                scope = scope || constraints(question);
                var entry = aliases.get(comparable(question));
                return entry &&
                    !scope.invalid &&
                    scope.phrases.length <= 1 &&
                    supports(entry, scope)
                    ? entry
                    : null;
            },
            related: related,
        };
    }

    function mergeRanks(semantic, lexical) {
        var scores = new Map();
        [semantic, lexical].forEach(function (ranking) {
            Array.from(new Set(ranking)).forEach(function (ref, index) {
                scores.set(ref, (scores.get(ref) || 0) + 1 / (60 + index + 1));
            });
        });
        return Array.from(scores)
            .sort(function (left, right) {
                return right[1] - left[1];
            })
            .slice(0, 12)
            .map(function (entry) {
                return entry[0];
            });
    }

    return {
        normalize: normalize,
        createCorpus: createCorpus,
        createCatalog: createCatalog,
        constraints: constraints,
        mergeRanks: mergeRanks,
    };
})();

myApp.controller(
    'QuranQuestionsController',
    function ($scope, $http, $window, $timeout, $location) {
        'use strict';

        var vm = this;
        var modelPath = 'models/quran-questions-e5-v1/';
        var corpus,
            catalog,
            extractive,
            worker,
            timeout,
            queryId = 0,
            destroyed = false;
        var resultPool = [],
            lexicalResults = [],
            semanticResults = null,
            candidateRefs = null;
        vm.input = '';
        vm.topics = [];
        vm.examples = [];
        vm.topicFilter = '';
        vm.results = [];
        vm.retrieval = {
            available: false,
            status: 'idle',
            progress: null,
            message: '',
        };

        function showResults(results) {
            resultPool = results;
            vm.results = results.slice(0, 6);
            vm.canShowMore = results.length > vm.results.length;
        }

        function stopWorker() {
            queryId++;
            if (timeout) $timeout.cancel(timeout);
            timeout = null;
            if (worker) worker.terminate();
            worker = null;
            vm.retrieval.progress = null;
            vm.retrieval.status = 'idle';
        }

        vm.matchesTopic = function (topic) {
            return topic.filterText.includes(
                QuranQuestions.normalize(vm.topicFilter || ''),
            );
        };

        vm.loadCatalog = function () {
            vm.ready = false;
            vm.error = '';
            $http
                .get('data/quran-questions.json', {
                    params: {
                        v:
                            typeof QuranRelease === 'undefined'
                                ? 'dev'
                                : QuranRelease.current,
                    },
                })
                .then(function (response) {
                    if (destroyed) return;
                    corpus = QuranQuestions.createCorpus(all_ayat, all_suwar);
                    catalog = QuranQuestions.createCatalog(
                        response.data,
                        corpus,
                    );
                    extractive = QuranExtractive.create(
                        all_ayat,
                        all_suwar,
                        corpus,
                        corpus.findPhrase,
                    );
                    vm.topics = catalog.topics;
                    vm.examples = vm.topics.slice(0, 4);
                    vm.ready = true;
                    readLocation();
                })
                .catch(function () {
                    if (!destroyed)
                        vm.error = 'تعذّر تحميل الأسئلة. حاول مرة أخرى.';
                });
        };

        function showQuestion(question) {
            if (
                vm.retrieval.status === 'loading' ||
                vm.retrieval.status === 'searching'
            )
                stopWorker();
            vm.retrieval.message = '';
            vm.submitted = question;
            var scope = QuranQuestions.constraints(question);
            var direct = question ? corpus.reference(question) : null;
            vm.reference = direct !== null;
            var extracted =
                !vm.reference &&
                question &&
                !scope.invalid &&
                scope.phrases.length <= 1
                    ? extractive.answer(question)
                    : null;
            vm.interpretation = [];
            vm.clarification = '';
            vm.answer = null;
            vm.candidatesOpen = false;
            vm.blockCandidates = false;
            if (scope.invalid || scope.phrases.length > 1) {
                vm.clarification =
                    'اكتب عبارة واحدة بين علامتي تنصيص متطابقتين حتى أحدد اللفظ المطلوب.';
                vm.blockCandidates = true;
            } else if (extracted && extracted.clarification) {
                vm.clarification = extracted.clarification;
                vm.blockCandidates = extracted.blockCandidates;
            } else if (!vm.reference && question) {
                vm.answer = extracted || catalog.answer(question, scope);
                if (
                    !vm.answer &&
                    /(?:^|\s)(?:في|من) سور[هة](?:\s|$)/u.test(
                        QuranQuestions.normalize(question),
                    )
                ) {
                    vm.clarification =
                        'لتقييد البحث بسورة، جرّب «أين وردت كلمة “…” في سورة …؟» أو اكتب رقم السورة والآية.';
                    vm.blockCandidates = true;
                }
            }

            var literal =
                (scope.phrases && scope.phrases[0]) ||
                (extracted && extracted.constraint);
            if (literal)
                vm.interpretation.push({
                    label: 'اللفظ المطلوب',
                    value: literal,
                });
            if (scope.evidence && scope.evidence.length)
                vm.interpretation.push({
                    label: 'الحركات المحددة',
                    value: scope.evidence.join('، '),
                });
            if (literal && /[\u064b-\u0652\u0670]/u.test(literal))
                vm.interpretation.push({
                    label: 'مطابقة الحركات',
                    value: 'الحركات المكتوبة في اللفظ',
                });
            if (extracted && extracted.scope)
                vm.interpretation.push({
                    label: 'السورة',
                    value: extracted.scope,
                });

            candidateRefs =
                !vm.blockCandidates && !vm.answer && !vm.reference
                    ? corpus.matchingRefs(scope)
                    : null;
            if (candidateRefs && !candidateRefs.size) {
                vm.clarification =
                    'لم أجد آية تطابق اللفظ والحركات التي كتبتها. راجع الحركات أو اكتب رقم السورة والآية.';
                vm.blockCandidates = true;
            }
            if (question && !vm.answer && !vm.reference && !vm.clarification)
                vm.clarification =
                    'لم أجد إجابة مباشرة لهذا السؤال. يمكنك تحديد اللفظ بين علامتي تنصيص أو قراءة الآيات المقترحة.';
            vm.relatedTopics =
                question && !vm.blockCandidates && !vm.answer && !vm.reference
                    ? catalog.related(question, scope)
                    : [];
            semanticResults = null;
            lexicalResults =
                !question || vm.answer || vm.reference || vm.blockCandidates
                    ? []
                    : corpus.search(question, candidateRefs);
            vm.canSwitchResults = false;
            vm.showingSemantic = false;
            vm.resultTitle = vm.reference
                ? 'الآيات المطلوبة'
                : 'آيات توافق كلمات السؤال';
            showResults(direct || lexicalResults);
        }

        function readLocation() {
            if (!vm.ready) return;
            var raw = $location.search().q;
            var question =
                typeof raw === 'string' && raw.length < 4096
                    ? QuranSearchLink.parameters({ q: raw }).question
                    : '';
            question =
                typeof question === 'string' && question.length <= 320
                    ? question.trim()
                    : '';
            if (question === vm.submitted) return;
            vm.input = question;
            showQuestion(question);
        }

        vm.ask = function () {
            var question = vm.input.trim();
            if (!vm.ready || !question || question.length > 320) return;
            showQuestion(question);
            $location.search({
                q: QuranSearchLink.encode({ question: question }),
            });
            $timeout(function () {
                var response =
                    $window.document.getElementById('questions-response');
                if (response && !destroyed) response.focus();
            });
        };

        vm.choose = function (topic) {
            vm.askExample(topic.question);
        };

        vm.askExample = function (question) {
            vm.input = question;
            vm.ask();
        };

        vm.more = function () {
            vm.results = resultPool.slice(0, vm.results.length + 6);
            vm.canShowMore = resultPool.length > vm.results.length;
        };

        vm.switchResults = function () {
            if (!semanticResults) return;
            vm.showingSemantic = !vm.showingSemantic;
            vm.resultTitle = vm.showingSemantic
                ? 'آيات مقترحة للقراءة'
                : 'آيات توافق كلمات السؤال';
            showResults(vm.showingSemantic ? semanticResults : lexicalResults);
        };

        vm.cancelSemantic = function () {
            stopWorker();
            vm.retrieval.message = 'توقّف البحث عن الآيات ذات الصلة.';
        };

        vm.canSearchSemantically = function () {
            return (
                vm.retrieval.available &&
                !vm.answer &&
                !vm.reference &&
                !vm.blockCandidates &&
                /[\u0621-\u063a\u0641-\u064a]/u.test(vm.submitted || '')
            );
        };

        vm.searchSemantically = function () {
            if (
                !vm.canSearchSemantically() ||
                vm.retrieval.status === 'loading' ||
                vm.retrieval.status === 'searching'
            )
                return;
            var id = ++queryId;
            vm.retrieval.message = '';
            vm.retrieval.status = worker ? 'searching' : 'loading';
            vm.retrieval.progress = null;

            function failed() {
                if (id !== queryId) return;
                stopWorker();
                vm.retrieval.message =
                    'تعذّر البحث عن الآيات ذات الصلة. يمكنك المحاولة مجددًا.';
            }

            try {
                if (!worker) {
                    var version =
                        typeof QuranRelease === 'undefined'
                            ? 'dev'
                            : QuranRelease.current;
                    worker = new $window.Worker(
                        'js/quran-retrieval-worker.mjs?v=' + version,
                        {
                            type: 'module',
                        },
                    );
                }
                worker.onerror = function () {
                    $scope.$evalAsync(failed);
                };
                worker.onmessage = function (event) {
                    var message = event.data;
                    $scope.$evalAsync(function () {
                        if (id !== queryId || message.id !== id) return;
                        if (message.progress) {
                            var progress = message.progress;
                            vm.retrieval.progress =
                                progress.total > 0
                                    ? Math.min(
                                          100,
                                          Math.round(
                                              (100 * progress.loaded) /
                                                  progress.total,
                                          ),
                                      )
                                    : null;
                            if (vm.retrieval.progress === 100)
                                vm.retrieval.status = 'searching';
                            return;
                        }
                        if (!Array.isArray(message.results)) {
                            failed();
                            return;
                        }
                        $timeout.cancel(timeout);
                        timeout = null;
                        vm.retrieval.status = 'ready';
                        vm.retrieval.progress = null;
                        var contextual = message.results
                            .map(function (match) {
                                return match.ref;
                            })
                            .filter(function (ref) {
                                return (
                                    corpus.verse(ref) &&
                                    (!candidateRefs || candidateRefs.has(ref))
                                );
                            });
                        var words = corpus
                            .search(vm.submitted, candidateRefs, true)
                            .slice(0, 12)
                            .map(function (verse) {
                                return verse.ref;
                            });
                        semanticResults = QuranQuestions.mergeRanks(
                            contextual,
                            words,
                        ).map(corpus.verse);
                        vm.canSwitchResults = true;
                        vm.showingSemantic = false;
                        vm.candidatesOpen = true;
                        vm.switchResults();
                    });
                };
                var request = { id: id, question: vm.submitted };
                if (candidateRefs)
                    request.candidateRefs = Array.from(candidateRefs);
                worker.postMessage(request);
                timeout = $timeout(failed, 120000);
            } catch (error) {
                failed();
            }
        };

        vm.loadCatalog();
        if ($window.Worker) {
            $http.get(modelPath + 'manifest.json').then(function (response) {
                var info = response.data;
                if (
                    destroyed ||
                    info.version !== 1 ||
                    info.count !== all_ayat.length ||
                    !(info.totalBytes > 0)
                )
                    return;
                vm.retrieval.available = true;
                vm.retrieval.megabytes = Math.ceil(
                    info.totalBytes / 1024 / 1024,
                );
            }, angular.noop);
        }

        $scope.$on('$routeUpdate', readLocation);
        $scope.$on('$destroy', function () {
            destroyed = true;
            stopWorker();
        });
    },
);
