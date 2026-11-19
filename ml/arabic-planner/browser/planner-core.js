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
        outside = instruction(digit(outside));
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
            modelInput: digit(masked)
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
            return text.includes(item[0]);
        });
        if (matches.length !== 1)
            throw new Error("حدد " + label + " واحدة باسمها.");
        return matches[0][1];
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
            // Confidence cannot authorize silently dropping an explicit constraint.
            var constraints = [
                [/استبعد|استثناء|استثن|حذف الايات|حذف الكلمات/, /^exclude_/],
                [/فاصل ايه|الايه التاليه|ايتين متتاليتين/, /^cross_ayah$/],
                [
                    /(?:سوره|السوره|ايه|الايه)\s*(?:رقم\s*)?[0-9]+/,
                    /^reference$/,
                ],
                [
                    /باي ترتيب|بترتيب غير محدد|مهما كان ترتيبهما|قبل او بعد/,
                    /^between_either$/,
                ],
                [
                    /اجمع|التقاط|تكرار|الملتقطه|استخرج\s+[0-9]+\s+كلمات/,
                    /^(?:context_|capture_between$|symbol_(?:before|after)$)/,
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
                intentId === "text_contains" &&
                /تبدا|بدايه|اولها|تنتهي|نهايه|اخرها|كامله|مستقله|حرف|شده|حركه|اختياري|مجهول/.test(
                    parsed.outside,
                )
            )
                throw new Error("حدد طريقة المطابقة أو الحروف المطلوبة بدقة.");
            if (parsed.quotes.length !== intent.quotes)
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
                /قبل|تسبق/.test(parsed.outside) &&
                /بعد|تلي/.test(parsed.outside)
            )
                throw new Error("اختر قبل أو بعد في طلب واحد.");
            if (
                /^exclude_/.test(intentId) &&
                /الايات/.test(parsed.outside) &&
                /الكلمات المطابقه/.test(parsed.outside)
            )
                throw new Error("حدد استبعاد الآيات أو الكلمات المطابقة فقط.");
            var mark = intent.mark
                ? uniqueNamed(parsed.outside, marks, "حركة")
                : "";
            var symbol = intent.symbol
                ? uniqueNamed(parsed.outside, symbols, "علامة قرآنية")
                : "";
            function fill(value) {
                if (typeof value === "string" && /^\$q[0-9]$/.test(value))
                    return parsed.quotes[Number(value.slice(2))];
                if (typeof value === "string" && /^\$n[0-9]$/.test(value))
                    return parsed.numbers[Number(value.slice(2))];
                if (value === "$mark") return mark;
                if (value === "$symbol") return symbol;
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
                        /(?:ايه|الايه)\s*(?:رقم\s*)?([0-9]+)/u,
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
