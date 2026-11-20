"""Build the version-2 closed recipe catalog from reviewed-in-code Arabic patterns.
Patterns are synthetic drafts; no human annotation is claimed.
"""

import copy, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Two new semantic clause families per held-out cohort. They are never training templates.
HELD = {
    "text_contains": [
        ["دلني على النص {q0} أينما وقع", "أبحث عن ورود {q0} ضمن الكلمات"],
        ["أوجد كل موضع يحتوي النص {q0}", "أرني مواضع وجود {q0} ولو داخل كلمة"],
        ["اعثر على النص الحرفي {q0} في أي موضع", "هات الآيات المتضمنة للنص {q0}"],
    ],
    "text_whole": [
        ["حدد ظهور {q0} وحدها كلمة كاملة", "أطلب الكلمة الكاملة {q0} دون حروف متصلة"],
        ["أوجد {q0} ككلمة كاملة منفصلة", "أرني الكلمة المستقلة {q0} كاملة"],
        [
            "هات مواضع الكلمة الكاملة {q0} وحدها",
            "اعثر على {q0} كلمة مستقلة لا جزءاً منها",
        ],
    ],
    "text_starts": [
        ["هات كلمات بدايتها {q0}", "دلني على الكلمات المبتدئة بالنص {q0}"],
        ["أوجد لفظاً يبدأ بـ {q0}", "أرني الكلمات التي تبدأ بالنص {q0}"],
        ["ابحث لي عن أول الكلمة {q0}", "اعثر على كلمات أولها النص {q0}"],
    ],
    "text_ends": [
        ["هات كلمات نهايتها {q0}", "دلني على الكلمات المنتهية بالنص {q0}"],
        ["أوجد لفظاً ينتهي بـ {q0}", "أرني الكلمات التي تنتهي بالنص {q0}"],
        ["ابحث لي عن آخر الكلمة {q0}", "اعثر على كلمات آخرها النص {q0}"],
    ],
    "text_phrase": [
        ["أبحث عن عبارة كاملة نصها {q0}", "أريد تطابق العبارة {q0} كاملة"],
        ["أوجد العبارة المستقلة {q0} بكامل كلماتها", "أرني عبارة {q0} كاملة متتابعة"],
        [
            "هات العبارة الكاملة المطابقة لـ {q0}",
            "اعثر على كامل عبارة {q0} دون تغيير ترتيبها",
        ],
    ],
    "context_before": [
        [
            "التقط {n0} من الكلمات الواقعة قبل {q0}",
            "الكلمات السابقة للنص {q0} اجمع منها {n0}",
        ],
        ["أخرج {n0} كلمات تسبق النص {q0}", "قبل {q0} أريد التقاط عدد {n0} من الكلمات"],
        [
            "هات {n0} كلمات تأتي قبل {q0} واجمع تكرارها",
            "أريد الكلمات السابقة لعبارة {q0} بعدد {n0}",
        ],
    ],
    "context_after": [
        [
            "التقط {n0} من الكلمات الواقعة بعد {q0}",
            "الكلمات التالية للنص {q0} اجمع منها {n0}",
        ],
        ["أخرج {n0} كلمات تلي النص {q0}", "بعد {q0} أريد التقاط عدد {n0} من الكلمات"],
        [
            "هات {n0} كلمات تأتي بعد {q0} واجمع تكرارها",
            "أريد الكلمات التالية لعبارة {q0} بعدد {n0}",
        ],
    ],
    "between_adjacent": [
        [
            "أريد {q0} متبوعة مباشرة بـ {q1} دون كلمات فاصلة",
            "هات نصين متجاورين {q0} ثم {q1}",
        ],
        [
            "أوجد {q0} ثم مباشرة {q1} دون كلمات فاصلة",
            "أرني {q0} و {q1} متجاورتين بالترتيب",
        ],
        ["هات تطابق {q0} تليها مباشرة {q1}", "أبحث عن {q0} ثم {q1} دون كلمات بينهما"],
    ],
    "between_exact": [
        [
            "الفاصل بين {q0} ثم {q1} عدد ثابت هو {n0} كلمات",
            "هات {q0} ثم {n0} كلمات فاصلة ثم {q1}",
        ],
        [
            "أوجد {q0} ثم {q1} مع مسافة {n0} كلمات بالضبط",
            "أرني عبارتين {q0} و {q1} يفصل بينهما {n0} كلمات",
        ],
        [
            "أريد عدداً دقيقاً {n0} من الكلمات بين {q0} ثم {q1}",
            "هات {q0} ووراءها {q1} بعد {n0} كلمات فاصلة",
        ],
    ],
    "between_range": [
        [
            "الفاصل بين {q0} ثم {q1} من {n0} حتى {n1} كلمات",
            "هات {q0} وبعدها {q1} بعدد كلمات بين {n0} و {n1}",
        ],
        [
            "أوجد {q0} ثم {q1} بأقل مسافة {n0} وأكبر مسافة {n1} كلمات",
            "أرني {q0} تليها {q1} وبينهما {n0} إلى {n1} كلمات",
        ],
        [
            "أريد فاصل كلمات لا يقل عن {n0} ولا يزيد عن {n1} بين {q0} ثم {q1}",
            "هات {q0} ثم {q1} بفجوة من {n0} حتى {n1} كلمات",
        ],
    ],
    "between_either": [
        [
            "هات {q0} و {q1} بأي ترتيب بفاصل {n0} كلمات",
            "أبحث عن {q0} و {q1} مهما كان ترتيبهما وبينهما {n0} كلمات",
        ],
        [
            "أوجد عبارتين {q0} و {q1} بفاصل {n0} كلمات وبأي ترتيب",
            "أرني {q0} و {q1} بترتيب غير محدد وبينهما {n0} كلمات",
        ],
        [
            "أريد {q0} و {q1} بفاصل دقيق {n0} كلمات مهما كان ترتيبهما",
            "هات العبارتين {q0} و {q1} بأي ترتيب مع {n0} كلمات بينهما",
        ],
    ],
    "cross_ayah": [
        [
            "هات {q0} ثم فاصل آية ثم النص {q1}",
            "أريد نهاية آية فيها {q0} والآية التالية تبدأ بـ {q1}",
        ],
        [
            "أوجد {q0} ثم تابع في الآية التالية بالنص {q1}",
            "أرني {q0} ثم فاصل آية وبعده {q1}",
        ],
        [
            "أبحث عبر آيتين متتاليتين عن نهاية {q0} وبداية {q1}",
            "هات جزأين {q0} ثم فاصل آية ثم {q1} متتابعتين",
        ],
    ],
    "alternatives": [
        ["أريد أحد هذه الخيارات: {choices}", "هات واحداً من البدائل التالية: {choices}"],
        ["أوجد أي خيار من هذه القائمة: {choices}", "أرني أحد البدائل {choices}"],
        [
            "يكفيني العثور على أحد هذه الخيارات {choices}",
            "اختر للمطابقة واحداً من {choices}",
        ],
    ],
    "exclude_verse": [
        [
            "هات {q0} مع شرط استبعاد الآيات التي تضم {choices}",
            "أريد {q0} لكن احذف الآيات إذا احتوت {choices}",
        ],
        [
            "أوجد {q0} مع استثناء الآيات ذات {choices}",
            "أرني {q0} واستبعد الآيات التي تشمل {choices}",
        ],
        [
            "هات {q0} وأضف شرط استبعاد الآيات المحتوية على {choices}",
            "أبحث عن {q0} مع حذف الآيات التي فيها {choices}",
        ],
    ],
    "exclude_word": [
        [
            "هات {q0} مع شرط استبعاد الكلمات المطابقة التي تضم {choices}",
            "أريد {q0} لكن احذف الكلمات المطابقة المحتوية على {choices}",
        ],
        [
            "أوجد {q0} مع استثناء الكلمات المطابقة ذات {choices}",
            "أرني {q0} واستبعد الكلمات المطابقة التي تشمل {choices}",
        ],
        [
            "هات {q0} وأضف شرط استبعاد الكلمات المطابقة المحتوية على {choices}",
            "أبحث عن {q0} مع حذف الكلمات المطابقة التي فيها {choices}",
        ],
    ],
    "letters_exact": [
        [
            "أريد كلمة أولها {q0} وآخرها {q1} وبينهما {n0} حروف مجهولة",
            "هات كلمة تبدأ بالنص {q0} وتنتهي بالنص {q1} وفاصلها {n0} حروف",
        ],
        [
            "أوجد كلمة من {q0} ثم {n0} حروف غير محددة ثم {q1}",
            "أرني {q0} مع {n0} حروف في الوسط ثم {q1} ككلمة كاملة",
        ],
        [
            "هات بداية {q0} ونهاية {q1} وبينهما بالضبط {n0} حروف",
            "أريد {q0} و {q1} في طرفي كلمة وعدد حروف الوسط {n0}",
        ],
    ],
    "letters_range": [
        [
            "أريد كلمة أولها {q0} وآخرها {q1} وبينهما {n0} إلى {n1} حروف",
            "هات كلمة تبدأ بـ {q0} وتنتهي بـ {q1} وفاصل حروفها من {n0} إلى {n1}",
        ],
        [
            "أوجد كلمة من {q0} وحروف غير محددة عددها {n0} إلى {n1} ثم {q1}",
            "أرني أول {q0} وآخر {q1} وفي الوسط بين {n0} و {n1} حروف",
        ],
        [
            "هات كلمة حدها الأول {q0} والأخير {q1} وعدد الحروف بين {n0} و {n1}",
            "أريد {q0} ثم حروفاً لا تقل عن {n0} ولا تزيد عن {n1} ثم {q1} في الكلمة",
        ],
    ],
    "letter_optional": [
        [
            "هات {q0} ثم الحرف الاختياري {q1} ثم {q2} دون مسافات",
            "أريد في كلمة {q0} وبعده {q1} يمكن حذفه ثم {q2}",
        ],
        [
            "أوجد أجزاء كلمة {q0} وحرف اختياري {q1} ثم {q2}",
            "أرني {q0} مع أو بدون الحرف {q1} ثم {q2} متصلة",
        ],
        [
            "هات {q0} ثم {q1} اختيارياً ثم {q2} في الكلمة",
            "أريد أجزاء متصلة {q0} ثم الحرف {q1} يمكن حذفه ثم {q2}",
        ],
    ],
    "symbol_only": [
        [
            "دلني على علامة {symbol} في النص القرآني",
            "هات مواضع العلامة القرآنية {symbol}",
        ],
        ["أوجد علامة {symbol} أينما وردت", "أرني الآيات التي ترد فيها {symbol}"],
        ["هات كل ظهور للعلامة {symbol}", "أبحث عن العلامة القرآنية المسماة {symbol}"],
    ],
    "symbol_before": [
        [
            "التقط {n0} كلمات تسبق {symbol}",
            "أريد {n0} من الكلمات قبل العلامة القرآنية {symbol}",
        ],
        [
            "هات {n0} كلمات قبل {symbol} وعد تكرارها",
            "قبل {symbol} أريد التقاط {n0} كلمات",
        ],
        [
            "استخرج قبل {symbol} عدداً قدره {n0} من الكلمات",
            "اجمع الكلمات السابقة لـ {symbol} بعدد {n0}",
        ],
    ],
    "symbol_after": [
        [
            "التقط {n0} كلمات تلي {symbol}",
            "أريد {n0} من الكلمات بعد العلامة القرآنية {symbol}",
        ],
        [
            "هات {n0} كلمات بعد {symbol} وعد تكرارها",
            "بعد {symbol} أريد التقاط {n0} كلمات",
        ],
        [
            "استخرج بعد {symbol} عدداً قدره {n0} من الكلمات",
            "اجمع الكلمات التالية لـ {symbol} بعدد {n0}",
        ],
    ],
    "capture_between": [
        [
            "هات {q0} ثم جمع {n0} كلمات في هذا الموضع ثم {q1}",
            "التقط الكلمات الواقعة بين {q0} ثم {q1} وعددها {n0}",
        ],
        [
            "أوجد {q0} ثم جزء جمع كلمات عدده {n0} ثم {q1}",
            "اجمع {n0} من الكلمات المحصورة بين {q0} و {q1} بالترتيب",
        ],
        [
            "أريد بين {q0} ثم {q1} جمع كلمات في هذا الموضع بعدد {n0}",
            "هات {q0} والكلمات الملتقطة بعدها وعددها {n0} ثم {q1}",
        ],
    ],
    "unknown_word": [
        [
            "هات {q0} ثم كلمة مجهولة واحدة ثم {q1}",
            "أريد كلمة غير محددة واحدة محصورة بين {q0} و {q1}",
        ],
        [
            "أوجد {q0} وبعدها كلمة واحدة ثم {q1}",
            "أرني {q0} ثم كلمة غير معروفة واحدة ثم {q1}",
        ],
        [
            "أريد {q0} ثم كلمة واحدة بأي حروف ثم {q1}",
            "هات كلمتين معلومتين {q0} و {q1} تتوسطهما كلمة واحدة",
        ],
    ],
    "unknown_words": [
        [
            "هات {q0} ثم كلمة مجهولة أو أكثر ثم {q1}",
            "أريد كلمة أو أكثر غير محددة بين {q0} و {q1}",
        ],
        [
            "أوجد {q0} ثم كلمة أو أكثر ثم {q1}",
            "أرني {q0} ثم كلمة غير معروفة أو أكثر ثم {q1}",
        ],
        [
            "أريد {q0} ثم كلمات مجهولة كلمة أو أكثر ثم {q1}",
            "هات {q0} و {q1} تتوسطهما كلمة مجهولة أو أكثر",
        ],
    ],
    "reference": [
        [
            "هات {q0} في سورة {surah} ورقم الآية {ayah}",
            "ابحث ضمن الآية {ayah} بالسورة {surah} عن {q0}",
        ],
        [
            "أوجد {q0} في السورة {surah} والآية {ayah}",
            "أرني النص {q0} عند الآية رقم {ayah} في سورة رقم {surah}",
        ],
        [
            "أريد {q0} محصوراً في سورة رقم {surah} آية رقم {ayah}",
            "هات الآية {ayah} من السورة {surah} التي تضم {q0}",
        ],
    ],
}


def entry(id, recipes, quotes=0, numbers=0, **extra):
    row = dict(
        id=id,
        recipes=recipes,
        quotes=quotes,
        numbers=numbers,
        mark=False,
        symbol=False,
        reference=False,
        evidence=[],
    )
    row.update(extra)
    return row


def text(value, mode="contains"):
    return dict(type="text", value=value, matchMode=mode)


def bank(train, held):
    return dict(train=train, validation=held[0], calibration=held[1], test=held[2])


def build():
    legacy = json.loads((ROOT / "fixtures/catalog-v1.json").read_text())
    items = []
    for old in legacy["intents"]:
        if old["id"] in ["letter_mark", "any_letter_mark", "letter_shadda", "clarify"]:
            continue
        row = copy.deepcopy(old)
        row["templates"] = bank(
            [v for k, v in old["templates"].items()], HELD[row["id"]]
        )
        if row["id"] in ["alternatives", "exclude_verse", "exclude_word"]:
            row.update(
                choices=True,
                choiceOffset=0 if row["id"] == "alternatives" else 1,
                quotes=(
                    {"min": 2, "max": 10}
                    if row["id"] == "alternatives"
                    else {"min": 2, "max": 11}
                ),
            )
            for recipe in row["recipes"]:
                if recipe["type"] in ["alternatives", "exclude"]:
                    recipe.update(choices="$choices", matchMode="$listMode")
            # List length and mode are grounded parameters rather than separate labels.
            row["templates"]["train"] = [
                (
                    s.replace("{q0} أو {q1}", "{choices}")
                    .replace("{q0} و {q1}", "{choices}")
                    .replace("{q0} أو بدلا منها {q1}", "{choices}")
                    if row["id"] == "alternatives"
                    else s.replace("{q1}", "{choices}")
                )
                for s in row["templates"]["train"]
            ]
        items.append(row)

    def add(row, train, held):
        row["templates"] = bank(train, held)
        items.append(row)

    for id, mode in [("letter_specific", "specific"), ("letter_any", "any")]:
        q = "{q0}" if mode == "specific" else "أي حرف"
        features = "{features}"
        recipes = [
            dict(
                type="letter",
                value="$q0" if mode == "specific" else "",
                letterMode=mode,
                mark="$letterMark",
                shadda="$shadda",
                letterOptional="$letterOptional" if mode == "specific" else False,
            )
        ]
        add(
            entry(
                id,
                recipes,
                int(mode == "specific"),
                letter=True,
                evidence=["حرف|الحروف"],
            ),
            [
                f"ابحث عن الحرف {q} {features}",
                f"أريد مطابقة {q} من الحروف {features}",
                f"اختر حرفاً هو {q} {features}",
                f"طابق حرفاً {q} {features}",
            ],
            [
                [f"هات الحرف {q} {features}", f"دلني على حرف {q} {features}"],
                [f"أوجد الحرف {q} {features}", f"أرني {q} من الحروف {features}"],
                [f"أبحث عن حرف {q} {features}", f"اعثر على الحرف {q} {features}"],
            ],
        )
    for name, repeat, description in [
        ("one", "one", "حرف واحد مجهول بالضبط"),
        ("many", "oneOrMore", "حرف مجهول واحد أو أكثر"),
        ("zero", "zeroOrMore", "حروف مجهولة اختيارية قد لا تظهر"),
    ]:
        for standalone in [False, True]:
            id = "letters_" + name + ("_only" if standalone else "")
            recipe = dict(type="letters", repetition=repeat)
            recipes = (
                [recipe]
                if standalone
                else [text("$q0", "starts"), recipe, text("$q1", "ends")]
            )
            forms = (
                [description]
                if standalone
                else [f"كلمة تبدأ بـ {{q0}} ثم {description} وتنتهي بـ {{q1}}"]
            )
            stem = forms[0]
            add(
                entry(id, recipes, 0 if standalone else 2, evidence=["حرف|حروف"]),
                [
                    f"ابحث عن {stem}",
                    f"أريد مطابقة {stem}",
                    f"أنشئ بحثاً عن {stem}",
                    f"طابق {stem}",
                ],
                [
                    [f"هات {stem}", f"دلني على {stem}"],
                    [f"أوجد {stem}", f"أرني {stem}"],
                    [f"اعثر على {stem}", f"أبحث عن {stem} في النص"],
                ],
            )
    for name, repeat, description, number in [
        ("exact", "exact", "عدد محدد من الحروف المجهولة هو {n0}", 1),
        ("range", "range", "حروف غير محددة عددها من {n0} إلى {n1}", 2),
    ]:
        recipe = dict(
            type="letters",
            repetition=repeat,
            **(
                {"count": "$n0"}
                if repeat == "exact"
                else {"minCount": "$n0", "maxCount": "$n1"}
            ),
        )
        add(
            entry(
                "letters_" + name + "_only",
                [recipe],
                numbers=number,
                evidence=["حرف|حروف"],
            ),
            [
                f"ابحث عن {description}",
                f"أريد مطابقة {description}",
                f"طابق {description} في الكلمة",
                f"أنشئ جزءاً يمثل {description}",
            ],
            [
                [f"هات {description}", f"دلني على {description}"],
                [f"أوجد {description}", f"أرني {description}"],
                [f"اعثر على {description}", f"أبحث عن {description} داخل الكلمات"],
            ],
        )
    for id, type_, phrase in [
        ("word_only", "word", "كلمة غير محددة واحدة"),
        ("words_only", "words", "كلمة مجهولة أو أكثر"),
    ]:
        add(
            entry(id, [dict(type=type_)], evidence=["كلمه"]),
            [
                f"ابحث عن {phrase}",
                f"أريد مطابقة {phrase}",
                f"طابق {phrase}",
                f"أنشئ جزءاً يطابق {phrase}",
            ],
            [
                [f"هات {phrase}", f"دلني على {phrase}"],
                [f"أوجد {phrase}", f"أرني {phrase}"],
                [f"اعثر على {phrase}", f"أبحث عن {phrase} في النص"],
            ],
        )
    for id, recipes, q, stem in [
        (
            "capture_only",
            [dict(type="capture", count="$n0")],
            0,
            "جمع كلمات في هذا الموضع بعدد {n0}",
        ),
        (
            "capture_after_text",
            [text("$q0"), dict(type="capture", count="$n0")],
            1,
            "النص {q0} ثم جزء جمع كلمات في هذا الموضع بعدد {n0}",
        ),
        (
            "capture_before_text",
            [dict(type="capture", count="$n0"), text("$q0")],
            1,
            "جزء جمع كلمات في هذا الموضع بعدد {n0} ثم النص {q0}",
        ),
    ]:
        add(
            entry(id, recipes, q, 1, evidence=["جمع كلمات|التقاط"]),
            [f"أريد {stem}", f"ابحث باستخدام {stem}", f"أنشئ {stem}", f"طابق {stem}"],
            [
                [f"هات {stem}", f"استخدم {stem}"],
                [f"أوجد {stem}", f"أرني {stem}"],
                [f"اعثر على {stem}", f"نفذ بحثاً فيه {stem}"],
            ],
        )
    for base in ["between_adjacent", "between_range"]:
        original = next(x for x in items if x["id"] == base)
        row = copy.deepcopy(original)
        row["id"] = base + "_either"
        row["recipes"][0]["order"] = "either"
        row["templates"] = {
            split: [s + "، بأي ترتيب" for s in patterns]
            for split, patterns in row["templates"].items()
        }
        items.append(row)
    for either in [False, True]:
        tail = "، بأي ترتيب" if either else ""
        stem = "المسافة بين عبارتين {q0} ثم {q1} كلمة أو أكثر" + tail
        add(
            entry(
                "between_any" + ("_either" if either else ""),
                [
                    dict(
                        type="between",
                        value="$q0",
                        endValue="$q1",
                        gapMode="atLeastOne",
                        order="either" if either else "ordered",
                    )
                ],
                2,
                evidence=["المسافه|الفاصل"],
            ),
            [
                f"أريد {stem}",
                f"ابحث باستخدام {stem}",
                f"طابق {stem}",
                f"أنشئ بحثاً فيه {stem}",
            ],
            [
                [f"هات {stem}", f"حدد {stem}"],
                [f"أوجد {stem}", f"أرني {stem}"],
                [f"اعثر على {stem}", f"نفذ بحثاً يعتمد {stem}"],
            ],
        )
    add(
        entry(
            "cross_ayah_three",
            [
                text("$q0"),
                dict(type="ayahBreak"),
                text("$q1"),
                dict(type="ayahBreak"),
                text("$q2"),
            ],
            3,
            evidence=["فاصل ايه|ايات متتاليه"],
        ),
        [
            "ابحث عن {q0} ثم فاصل آية ثم {q1} ثم فاصل آية ثم {q2}",
            "طابق ثلاث آيات متتالية فيها {q0} ثم {q1} ثم {q2}",
            "أريد {q0} وبعد فاصل آية {q1} وبعد فاصل آية {q2}",
            "أنشئ بحثاً عبر ثلاث آيات متتالية بالنصوص {q0} ثم {q1} ثم {q2}",
        ],
        [
            [
                "هات {q0} ثم فاصل آية ثم {q1} ثم فاصل آية ثم {q2}",
                "دلني على ثلاث آيات متتالية فيها {q0} ثم {q1} ثم {q2}",
            ],
            [
                "أوجد {q0} ثم فاصل آية ثم {q1} ثم فاصل آية ثم {q2}",
                "أرني ثلاث آيات متتالية تتضمن {q0} ثم {q1} ثم {q2}",
            ],
            [
                "اعثر على {q0} ثم فاصل آية ثم {q1} ثم فاصل آية ثم {q2}",
                "أبحث عبر ثلاث آيات متتالية عن {q0} ثم {q1} ثم {q2}",
            ],
        ],
    )
    row = copy.deepcopy(next(x for x in items if x["id"] == "cross_ayah"))
    row.update(id="cross_ayah_reference", reference=True, numbers=2)
    row["templates"] = {
        split: [s + "، في سورة {surah} آية البداية {ayah}" for s in templates]
        for split, templates in row["templates"].items()
    }
    items.append(row)
    add(
        entry(
            "mixed_text",
            [text("$q0", "contains"), dict(**text("$q1", "whole"), join="space")],
            2,
            evidence=["جزء(?:ا)? من كلمه", "كامله"],
        ),
        [
            "ابحث عن {q0} كجزء من كلمة ثم {q1} كلمة كاملة",
            "طابق جزء من كلمة {q0} تتبعه كلمة كاملة {q1}",
            "أريد {q0} جزءاً من كلمة ثم الكلمة الكاملة {q1}",
            "أنشئ جزء من كلمة {q0} ثم {q1} كلمة كاملة",
        ],
        [
            [
                "هات جزء من كلمة {q0} وبعده كلمة كاملة {q1}",
                "أبحث عن {q0} كجزء من كلمة تليه كلمة كاملة {q1}",
            ],
            [
                "أوجد {q0} جزء من كلمة ثم كلمة كاملة {q1}",
                "أرني جزء من كلمة {q0} مع الكلمة الكاملة {q1} بعدها",
            ],
            [
                "اعثر على جزء من كلمة {q0} ثم الكلمة الكاملة {q1}",
                "أريد تطابق جزء من كلمة {q0} تتلوه كلمة كاملة {q1}",
            ],
        ],
    )
    # Reference labels explicitly support starting ayah wording for grouped searches.
    for item in items:
        if item["id"] == "text_whole":
            item["evidence"] = ["كامله|مستقله|دون حروف"]
        if item["id"] == "text_starts":
            item["evidence"] = ["تبدا|يبدا|بداي|اول|مبتدئ"]
        if item["id"] == "text_ends":
            item["evidence"] = ["تنتهي|ينتهي|نهاي|اخر|منتهي"]
        if item["id"] == "cross_ayah":
            item["evidence"] = ["فاصل ايه|الايه التاليه|ايتين متتاليتين"]
        if item["id"] == "symbol_before":
            item["evidence"] = ["قبل|تسبق|السابقه"]
        if item["id"] == "symbol_after":
            item["evidence"] = ["بعد|تلي|التاليه"]
    items.append(
        dict(
            id="clarify",
            recipes=[],
            quotes=0,
            numbers=0,
            mark=False,
            symbol=False,
            reference=False,
            evidence=[],
            templates={"train": []},
        )
    )
    (ROOT / "catalog.json").write_text(
        json.dumps({"version": 2, "intents": items}, ensure_ascii=False, indent=2)
        + "\n"
    )
    print(json.dumps({"intents": len(items), "positive_recipes": len(items) - 1}))


if __name__ == "__main__":
    build()
