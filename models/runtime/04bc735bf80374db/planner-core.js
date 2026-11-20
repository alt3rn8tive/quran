/* Shared by the browser and evaluation scripts. Never generates regex or Quran text. */
(function (root, factory) {
    if (typeof module === "object" && module.exports)
        module.exports = factory();
    else root.QuranArabicPlannerCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    function clarify(reason) {
        return { status: "clarify", reason: reason };
    }
    function instruction(text) {
        return text
            .normalize("NFKC")
            .replace(/[\u064B-\u065F\u0670ـ]/g, "")
            .replace(/[أإآٱ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ة/g, "ه");
    }
    function digit(text) {
        return text.replace(/[٠-٩۰-۹]/g, function (c) {
            return String(c.charCodeAt(0) - (c <= "٩" ? 0x660 : 0x6f0));
        });
    }
    function options(text) {
        const settings = {
            searchFromBeginning: false,
            searchOnEnd: false,
            removeLastHarakah: false,
        };
        const patterns = {
            searchFromBeginning:
                /(?:في (?:بدايه|اول) الايه فقط|فقط في بدايه الايه|من بدايه الايه فقط|مع شرط بدايه الايه|اشترط بدايه الايه)/gu,
            searchOnEnd:
                /(?:في (?:نهايه|اخر) الايه فقط|فقط في نهايه الايه|عند نهايه الايه فقط|مع شرط نهايه الايه|اشترط نهايه الايه)/gu,
            removeLastHarakah:
                /(?:(?:اجمع|جمع|تجميع) النتائج دون (?:الحركه الاخيره|اخر حركه)|احذف الحركه الاخيره من النتائج|مع تجاهل الحركه الاخيره عند جمع النتائج|ادمج النتائج بغض النظر عن اخر حركه)/gu,
        };
        if (
            /(?:لا|بدون|دون|الغ) (?:شرط|قيد|تقييد) (?:بدايه|نهايه) الايه|لا (?:تجمع|تحذف) (?:النتائج دون|الحركه الاخيره)/u.test(
                text,
            )
        )
            throw new Error(
                "وضّح شروط موضع الآية وتجميع النتائج؛ لا يمكن إسقاط شرط منفي.",
            );
        for (const [key, pattern] of Object.entries(patterns))
            text = text.replace(pattern, () => {
                settings[key] = true;
                return " ";
            });
        return {
            settings,
            text: text
                .replace(/[،؛,:.!؟?]/g, " ")
                .replace(/(?:^|\s)و(?=\s|$)/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
        };
    }
    function extract(request) {
        if (
            typeof request !== "string" ||
            !request.trim() ||
            request.length > 640
        )
            throw new Error("اكتب طلباً قصيراً لا يتجاوز 640 محرفاً.");
        var quotes = [],
            masked = "",
            outside = "",
            pairs = { "«": "»", '"': '"', "“": "”" };
        for (var i = 0; i < request.length; ) {
            var end = pairs[request[i]];
            if (end) {
                var close = request.indexOf(end, i + 1);
                if (close < 0)
                    throw new Error("أغلق علامات تنصيص النص المطلوب.");
                var value = request.slice(i + 1, close);
                if (!value.trim() || /[«»“”"]/.test(value))
                    throw new Error(
                        "استخدم علامات تنصيص غير متداخلة حول النص.",
                    );
                quotes.push(value);
                masked += " «عبارة» ";
                outside += " ";
                i = close + 1;
            } else {
                if (/[»”]/.test(request[i]))
                    throw new Error("علامات التنصيص غير متوازنة.");
                masked += request[i];
                outside += request[i];
                i++;
            }
        }
        var selected = options(instruction(digit(outside)));
        outside = selected.text;
        outside = outside.replace(
            /كلمات قبل عباره او بعدها/g,
            "الكلمات المحيطه بالعباره",
        );
        if (
            /(?:تجاهل التعليمات|اكتب كود|javascript|<script|بالانجليزيه|غير النص القراني)/i.test(
                outside,
            )
        )
            throw new Error("هذا الطلب خارج نطاق بناء البحث.");
        if (
            /(?:تفسير|اعراب|مرادفات|مشتقات|جذر|بالمعني|بالمعنى|سورتين مختلفتين|تجاهل ترتيب|لا اريد|لا تبحث|لا تطابق)/u.test(
                outside,
            )
        )
            throw new Error(
                "هذا الطلب يحتاج توضيحاً؛ البحث الحالي يعتمد على النص وحروفه.",
            );
        if (/[0-9][.,٫][0-9]|(?:^|\s)[+\-−]\s*[0-9]/.test(outside))
            throw new Error("اكتب أعداداً صحيحة غير سالبة.");
        var numbers = (outside.match(/[0-9]+/g) || []).map(Number);
        if (
            numbers.some(function (n) {
                return !Number.isSafeInteger(n);
            })
        )
            throw new Error("العدد خارج المجال المدعوم.");
        return {
            quotes: quotes,
            numbers: numbers,
            outside: outside,
            settings: selected.settings,
            modelInput: options(instruction(digit(masked)))
                .text.replace(/«عباره»/g, "«عبارة»")
                .replace(/[0-9]+/g, "رقم")
                .replace(/\s+/g, " ")
                .trim(),
        };
    }
    var marks = [
        ["فتحه", "َ"],
        ["كسره", "ِ"],
        ["ضمه", "ُ"],
        ["سكون", "ْ"],
        ["تنوين فتح", "ً"],
        ["تنوين كسر", "ٍ"],
        ["تنوين ضم", "ٌ"],
    ];
    var symbols = [
        ["علامه السجده", "۩"],
        ["الوقف اللازم", "ۘ"],
        ["الوقف الممنوع", "ۙ"],
        ["الوصل اولي", "ۖ"],
        ["الوقف اولي", "ۗ"],
        ["الوقف الجائز", "ۚ"],
        ["تعانق الوقف", "ۛ"],
        ["السكته", "ۜ"],
    ];
    function uniqueNamed(text, choices, label) {
        var matches = choices.filter(function (item) {
            return (
                text.includes(item[0]) ||
                (label === "علامة قرآنية" && text.includes(item[1]))
            );
        });
        var values = Array.from(new Set(matches.map((item) => item[1])));
        if (values.length !== 1)
            throw new Error("حدد " + label + " واحدة باسمها.");
        return values[0];
    }
    function assemble(request, intentId, catalog, references, builder) {
        try {
            var parsed = extract(request),
                intent = catalog.intents.find(function (row) {
                    return row.id === intentId;
                });
            if (!intent || intentId === "clarify")
                return clarify(
                    "يرجى توضيح المطلوب أو استخدام الأجزاء اليدوية.",
                );
            if (
                (!/^cross_ayah/.test(intentId) &&
                    /(?:بدايه|ابتداء|اول|نهايه|ختام|اخر) الايه/.test(
                        parsed.outside,
                    )) ||
                /الحركه الاخيره|اخر حركه/.test(parsed.outside)
            )
                throw new Error(
                    "استخدم خيار بداية الآية أو نهايتها فقط، أو جمع النتائج دون الحركة الأخيرة، بصياغة واضحة.",
                );
            // Confidence cannot authorize silently dropping an explicit constraint.
            var constraints = [
                [/استبعد|استثناء|استثن|حذف الايات|حذف الكلمات/, /^exclude_/],
                [
                    /فاصل ايه|الايه التاليه|ايتين متتاليتين|ايات متتاليه/,
                    /^cross_ayah/,
                ],
                [
                    /(?:سوره|السوره|ايه|الايه)\s*(?:رقم\s*)?[0-9]+/,
                    /^(?:reference|cross_ayah_reference)$/,
                ],
                [
                    /باي ترتيب|بترتيب غير محدد|مهما كان ترتيبهما|قبل او بعد/,
                    /^between_.*either$|^between_either$/,
                ],
                [
                    /اجمع|جمع كلمات|التقاط|تكرار|الملتقطه|استخرج\s+[0-9]+\s+كلمات/,
                    /^(?:context_|capture_|symbol_(?:before|after)$)/,
                ],
                [
                    /فتحه|كسره|ضمه|سكون|تنوين/,
                    /^(?:letter_specific|letter_any|letter_mark|any_letter_mark)$/,
                ],
                [/شده|مشدد/, /^(?:letter_shadda|letter_specific|letter_any)$/],
                [
                    /اختياري|يمكن حذفه|مع او بدون/,
                    /^(?:letter_optional|letter_specific|letters_zero.*)$/,
                ],
                [
                    /احدي الكلمتين|احد الخيارين|اي كلمه من|او بدلا منها/,
                    /^alternatives$/,
                ],
                [
                    /متجاورتين|تليها مباشره|دون كلمات فاصله|متلاصقتين/,
                    /^between_adjacent(?:_either)?$/,
                ],
                [
                    /كلمه واحده|كلمه مجهوله واحده|كلمه غير معروفه واحده|كلمه غير محدده واحده/,
                    /^(?:unknown_word|word_only)$/,
                ],
                [
                    /كلمه او اكثر|كلمه مجهوله او اكثر|كلمه غير معروفه او اكثر/,
                    /^(?:unknown_words|words_only|between_any(?:_either)?)$/,
                ],
            ];
            constraints.forEach(function (constraint) {
                if (
                    constraint[0].test(parsed.outside) &&
                    !constraint[1].test(intentId)
                )
                    throw new Error(
                        "توجد شروط لا يحققها الاقتراح؛ يرجى توضيح الطلب.",
                    );
            });
            if (
                /جمع كلمات في هذا الموضع|جزء جمع كلمات/.test(parsed.outside) &&
                !/^capture_/.test(intentId)
            )
                throw new Error(
                    "طلبت جزء جمع كلمات في هذا الموضع؛ الاقتراح يغيّر نوعه.",
                );
            if (
                /^capture_/.test(intentId) &&
                !/اجمع|جمع|التقط|التقاط|تكرار|الملتقطه|استخرج/.test(
                    parsed.outside,
                )
            )
                throw new Error(
                    "لم تطلب جمع الكلمات؛ وضّح إن كنت تريد التقاطها أو تحديد المسافة فقط.",
                );
            if (
                /حروف/.test(parsed.outside) &&
                !/دون حروف/.test(parsed.outside) &&
                !/^(?:letters?_|any_letter_mark$|unknown_word)/.test(intentId)
            )
                throw new Error(
                    "حدد إن كنت تريد حروفاً أو كلمات؛ الاقتراح لا يحقق الشرط.",
                );
            if (
                intentId === "text_contains" &&
                (/تبدا|بدايه|اولها|تنتهي|نهايه|اخرها|كامله|مستقله|اختياري|مجهول/.test(
                    parsed.outside,
                ) ||
                    /(?:^|\s)(?:الحرف|حرفا?|الحروف|حروف|شده|الشده|حركه|الحركه)(?=\s|$)/.test(
                        parsed.outside,
                    ))
            )
                throw new Error("حدد طريقة المطابقة أو الحروف المطلوبة بدقة.");
            if (
                typeof intent.quotes === "number"
                    ? parsed.quotes.length !== intent.quotes
                    : parsed.quotes.length < intent.quotes.min ||
                      parsed.quotes.length > intent.quotes.max
            )
                throw new Error(
                    "ضع كل نص مطلوب بين «علامتي تنصيص»، وحدد طلباً واحداً مدعوماً.",
                );
            if (parsed.numbers.length !== intent.numbers)
                throw new Error(
                    "اكتب العدد المطلوب بالأرقام، دون أعداد أو شروط إضافية.",
                );
            (intent.evidence || []).forEach(function (pattern) {
                if (!new RegExp(pattern, "u").test(parsed.outside))
                    throw new Error("لم تتضح علاقة الأجزاء؛ يرجى توضيحها.");
            });
            if (
                /^(context|symbol)_(before|after)$/.test(intentId) &&
                /(?:^|\s)و?(?:قبل|تسبق)(?:ها|ه)?(?=\s|$)/.test(
                    parsed.outside,
                ) &&
                /(?:^|\s)و?(?:بعد|تلي)(?:ها|ه)?(?=\s|$)/.test(parsed.outside)
            )
                throw new Error("اختر قبل أو بعد في طلب واحد.");
            if (/^(context|symbol)_(before|after)$/.test(intentId)) {
                const before =
                    /(?:^|\s)و?(?:قبل|تسبق)(?:ها|ه)?(?=\s|$)|السابقه/.test(
                        parsed.outside,
                    );
                const after =
                    /(?:^|\s)و?(?:بعد|تلي|تتبع)(?:ها|ه)?(?=\s|$)|التاليه/.test(
                        parsed.outside,
                    );
                if (
                    (before && after) ||
                    (intentId.endsWith("_before") ? !before : !after)
                )
                    throw new Error(
                        "حدد اتجاه الكلمات بوضوح؛ العدد لا يحدد قبل أو بعد.",
                    );
            }
            if (
                /^exclude_/.test(intentId) &&
                /الايات/.test(parsed.outside) &&
                /الكلمات المطابقه/.test(parsed.outside)
            )
                throw new Error("حدد استبعاد الآيات أو الكلمات المطابقة فقط.");
            var mark = intent.mark
                ? uniqueNamed(parsed.outside, marks, "حركة")
                : "";
            var letterMark = "";
            if (intent.letter) {
                const named = marks.filter((item) =>
                    parsed.outside.includes(item[0]),
                );
                if (named.length > 1) throw new Error("حدد حركة واحدة للحرف.");
                letterMark = named.length ? named[0][1] : "";
                if (
                    /بدون شده|دون شده|غير مشدد|دون حركه|بلا حركه/.test(
                        parsed.outside,
                    )
                )
                    throw new Error(
                        "حدّد الحركة المطلوبة أو اختر أي حركة؛ النفي الصريح غير مدعوم.",
                    );
            }
            var listMode = "whole";
            const modeHints = [
                ["contains", "خيارات كاجزاء"],
                ["starts", "خيارات كبدايات"],
                ["ends", "خيارات كنهايات"],
                ["whole", "خيارات ككلمات"],
            ];
            const chosenModes = modeHints.filter((item) =>
                parsed.outside.includes(item[1]),
            );
            if (chosenModes.length > 1)
                throw new Error("حدد طريقة مطابقة واحدة للخيارات.");
            if (chosenModes.length) listMode = chosenModes[0][0];
            if (
                intent.choices &&
                !chosenModes.length &&
                /(?:جزء|اجزاء|بدايه|بدايات|نهايه|نهايات).*?(?:كلمه|كلمات|عباره|عبارات)/.test(
                    parsed.outside,
                )
            )
                throw new Error(
                    "وضح مطابقة الخيارات ككلمات كاملة أو كأجزاء أو كبدايات أو كنهايات كلمات.",
                );
            if (chosenModes.length && !intent.choices)
                throw new Error(
                    "طريقة مطابقة الخيارات لا تنطبق على هذا الجزء.",
                );
            var symbol = intent.symbol
                ? uniqueNamed(parsed.outside, symbols, "علامة قرآنية")
                : "";
            if (
                !intent.symbol &&
                symbols.some(
                    (item) =>
                        parsed.outside.includes(item[0]) ||
                        parsed.outside.includes(item[1]),
                )
            )
                throw new Error("يوجد شرط علامة قرآنية لا يحققه الاقتراح.");
            function fill(value) {
                if (typeof value === "string" && /^\$q[0-9]$/.test(value))
                    return parsed.quotes[Number(value.slice(2))];
                if (typeof value === "string" && /^\$n[0-9]$/.test(value))
                    return parsed.numbers[Number(value.slice(2))];
                if (value === "$mark") return mark;
                if (value === "$symbol") return symbol;
                if (value === "$letterMark") return letterMark;
                if (value === "$shadda") return /شده|مشدد/.test(parsed.outside);
                if (value === "$letterOptional")
                    return /اختياري|يمكن حذفه|مع او بدون/.test(parsed.outside);
                if (value === "$choices")
                    return parsed.quotes
                        .slice(intent.choiceOffset || 0)
                        .map((value) => ({ value }));
                if (value === "$listMode") return listMode;
                if (Array.isArray(value)) return value.map(fill);
                if (value && typeof value === "object")
                    return Object.fromEntries(
                        Object.entries(value).map(function (entry) {
                            return [entry[0], fill(entry[1])];
                        }),
                    );
                return value;
            }
            var blocks = intent.recipes.map(function (recipe) {
                var resolved = fill(recipe);
                return Object.assign(builder.create(resolved.type), resolved);
            });
            var compiled = builder.compile(blocks);
            if (compiled.error) throw new Error(compiled.error);
            var reference = { ayah: null, surah: null };
            if (intent.reference) {
                var surah = parsed.outside.match(
                        /(?:سوره|السوره)\s*(?:رقم\s*)?([0-9]+)/u,
                    ),
                    ayah = parsed.outside.match(
                        /(?:ايه|الايه)\s*(?:البدايه\s*)?(?:رقم\s*)?([0-9]+)/u,
                    );
                if (!surah || !ayah)
                    throw new Error("حدد رقم السورة ورقم الآية بوضوح.");
                reference = { surah: Number(surah[1]), ayah: Number(ayah[1]) };
                if (
                    !references ||
                    !references[reference.surah] ||
                    reference.ayah < 1 ||
                    reference.ayah > references[reference.surah]
                )
                    throw new Error("مرجع السورة والآية غير صالح.");
            }
            return {
                status: "suggestion",
                intent: intentId,
                blocks: blocks,
                reference: reference,
                settings: parsed.settings,
            };
        } catch (error) {
            return clarify(error.message);
        }
    }
    function calibrated(scores, temperature) {
        if (
            !Array.isArray(scores) ||
            !scores.length ||
            !Number.isFinite(temperature) ||
            temperature <= 0
        )
            throw new Error("Invalid model scores or temperature.");
        if (
            scores.some(function (row) {
                return (
                    !row ||
                    typeof row.label !== "string" ||
                    !Number.isFinite(row.score) ||
                    row.score < 0 ||
                    row.score > 1
                );
            })
        )
            throw new Error("Invalid classifier probabilities.");
        var sum = scores.reduce(function (s, row) {
            return s + row.score;
        }, 0);
        if (Math.abs(sum - 1) > 0.001)
            throw new Error("All class probabilities are required.");
        var logits = scores.map(function (row) {
                return Math.log(Math.max(row.score, 1e-30)) / temperature;
            }),
            max = Math.max.apply(null, logits);
        var total = logits.reduce(function (s, value) {
            return s + Math.exp(value - max);
        }, 0);
        return scores
            .map(function (row, index) {
                return {
                    label: row.label,
                    score: Math.exp(logits[index] - max) / total,
                };
            })
            .sort(function (a, b) {
                return b.score - a.score;
            });
    }
    function decide(request, scores, policy, catalog, references, builder) {
        try {
            var labels = catalog.intents.map(function (row) {
                return row.id;
            });
            if (
                !scores ||
                scores.length !== labels.length ||
                new Set(
                    scores.map(function (row) {
                        return row.label;
                    }),
                ).size !== labels.length ||
                scores.some(function (row) {
                    return !labels.includes(row.label);
                })
            )
                return clarify("إصدار النموذج لا يطابق تعريف الأجزاء.");
            var ranked = calibrated(scores, policy.temperature),
                top = ranked[0],
                threshold = policy.thresholds[top.label];
            if (
                top.label === "clarify" ||
                !threshold ||
                !Number.isFinite(threshold.probability) ||
                !Number.isFinite(threshold.margin) ||
                threshold.probability < 0 ||
                threshold.probability > 1.1 ||
                threshold.margin < 0 ||
                threshold.margin > 1 ||
                top.score < threshold.probability ||
                top.score - ranked[1].score < threshold.margin
            )
                return clarify(
                    "المطلوب غير واضح بما يكفي؛ يرجى توضيحه أو استخدام الأجزاء اليدوية.",
                );
            return assemble(request, top.label, catalog, references, builder);
        } catch (error) {
            return clarify("تعذر تفسير هذا الطلب بثقة.");
        }
    }
    return {
        extract: extract,
        assemble: assemble,
        calibrated: calibrated,
        decide: decide,
    };
});
