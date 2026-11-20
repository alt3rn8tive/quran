/* Optional Arabic planner. Model assets load only after an explicit user action. */
myApp.factory("QuranPlannerService", function ($http, $q, $window) {
    function localURL(path) {
        var url = new URL(path, $window.document.baseURI);
        if (
            url.origin !== $window.location.origin ||
            !/^models\/[a-zA-Z0-9_./-]+$/.test(path) ||
            path.includes("..")
        )
            throw new Error("Invalid assistant asset path");
        return url.href;
    }
    return {
        describe: function () {
            var release = $window.QuranRelease
                ? $window.QuranRelease.current
                : "dev";
            return $http
                .get("models/planner.json?v=" + encodeURIComponent(release), {
                    cache: false,
                })
                .then(function (response) {
                    var info = response.data;
                    if (
                        !info ||
                        ![1, 2].includes(info.version) ||
                        !["experimental", "approved"].includes(info.channel) ||
                        !Number.isSafeInteger(info.bytes) ||
                        info.bytes < 1 ||
                        info.bytes > 80 * 1024 * 1024
                    )
                        throw new Error("Invalid assistant manifest");
                    localURL(info.model);
                    localURL(info.client);
                    return info;
                });
        },
        load: function (info, options) {
            return $q
                .when(import(localURL(info.client)))
                .then(function (runtime) {
                    return runtime.createPlanner(localURL(info.model), {
                        experimental: info.channel === "experimental",
                        signal: options.signal,
                        requestTimeout: 60000,
                        onProgress: options.onProgress,
                    });
                });
        },
    };
});

myApp.directive(
    "quranSearchAssistant",
    function (QuranPlannerService, $q, $window) {
        return {
            restrict: "E",
            scope: { onApply: "&" },
            templateUrl: "view/search-assistant.html",
            link: function (scope) {
                var planner,
                    abort,
                    generation = 0,
                    destroyed = false;
                scope.assistant = {
                    text: "",
                    status: "idle",
                    message: "",
                    proposal: null,
                    consent: false,
                    info: null,
                    percent: null,
                };
                var state = scope.assistant;
                scope.assistantPreview = QuranQueryBuilder.preview;
                scope.examples = [
                    "اجمع ٣ كلمات بعد «ولكن»",
                    "ابحث عن كلمة «رحمة» كاملة",
                    "ابحث عن نص «الله»",
                ];
                function update(fn) {
                    if (!destroyed) scope.$evalAsync(fn);
                }
                scope.openAssistant = function () {
                    if (state.info || state.status === "checking") return;
                    state.status = "checking";
                    state.message = "جار التحقق من توفر المساعد…";
                    QuranPlannerService.describe()
                        .then(function (info) {
                            if (destroyed) return;
                            state.info = info;
                            if (
                                Array.isArray(info.examples) &&
                                info.examples.length
                            )
                                scope.examples = info.examples
                                    .filter(function (text) {
                                        return (
                                            typeof text === "string" &&
                                            text.length <= 640
                                        );
                                    })
                                    .slice(0, 14);
                            state.status = "idle";
                            state.message = "";
                            state.megabytes = Math.ceil(
                                (info.bytes + (info.runtime_bytes || 0)) /
                                    1024 /
                                    1024,
                            );
                        })
                        .catch(function () {
                            if (destroyed) return;
                            state.status = "unavailable";
                            state.message =
                                "تعذر الوصول إلى المساعد. يمكنك إعادة المحاولة أو استخدام الأجزاء اليدوية.";
                        });
                };
                scope.enableAssistant = function () {
                    if (
                        !state.info ||
                        state.status === "loading" ||
                        (state.info.channel === "experimental" &&
                            !state.consent)
                    )
                        return;
                    if (
                        !$window.Worker ||
                        !$window.AbortController ||
                        !$window.WebAssembly
                    ) {
                        state.status = "error";
                        state.message =
                            "هذا المتصفح لا يدعم تشغيل المساعد. استخدم الأجزاء اليدوية أو متصفحاً أحدث.";
                        return;
                    }
                    abort = new $window.AbortController();
                    state.status = "loading";
                    state.percent = null;
                    state.message = "جار تحميل المساعد إلى جهازك…";
                    var current = ++generation;
                    QuranPlannerService.load(state.info, {
                        signal: abort.signal,
                        onProgress: function (event) {
                            update(function () {
                                if (current !== generation) return;
                                state.percent = event.percent;
                                state.message =
                                    event.stage === "verify"
                                        ? "جار تحميل ملفات النموذج والتحقق منها…"
                                        : "جار تجهيز المساعد…";
                            });
                        },
                    })
                        .then(function (instance) {
                            if (destroyed || current !== generation) {
                                instance.dispose();
                                return;
                            }
                            planner = instance;
                            state.status = "ready";
                            state.percent = null;
                            state.message = "المساعد جاهز على جهازك.";
                        })
                        .catch(function () {
                            if (destroyed || current !== generation) return;
                            state.status = "error";
                            state.percent = null;
                            state.message =
                                "تعذر تشغيل المساعد على هذا الجهاز. أعد المحاولة أو استخدم الأجزاء اليدوية.";
                        });
                };
                scope.cancelAssistant = function () {
                    ++generation;
                    if (abort) abort.abort();
                    if (planner) planner.dispose();
                    planner = null;
                    state.status = "idle";
                    state.percent = null;
                    state.proposal = null;
                    state.message =
                        "أُوقف المساعد. يمكنك متابعة البحث يدوياً أو تشغيله مجدداً.";
                };
                scope.assistantTextChanged = function () {
                    ++generation;
                    state.proposal = null;
                    if (planner) state.status = "ready";
                    state.message = "";
                };
                scope.useAssistantExample = function (text) {
                    state.text = text;
                    scope.assistantTextChanged();
                };
                scope.askAssistant = function () {
                    if (
                        !planner ||
                        typeof state.text !== "string" ||
                        !state.text.trim() ||
                        state.text.length > 640 ||
                        state.status === "thinking"
                    )
                        return;
                    var text = state.text,
                        current = ++generation;
                    state.status = "thinking";
                    state.proposal = null;
                    state.message = "جار فهم الطلب…";
                    $q.when(planner.propose(text))
                        .then(function (proposal) {
                            if (destroyed || current !== generation) return;
                            if (
                                proposal.status !== "suggestion" ||
                                !Array.isArray(proposal.blocks) ||
                                QuranQueryBuilder.compile(proposal.blocks).error
                            ) {
                                state.status = "clarify";
                                state.message =
                                    proposal.reason ||
                                    "لم يتضح الطلب. جرّب صياغة أبسط وضع النص بين «علامتي تنصيص».";
                                return;
                            }
                            state.status = "suggestion";
                            state.proposal = angular.copy(proposal);
                            state.message =
                                "راجع الأجزاء المقترحة ثم أضفها إلى محرر البحث.";
                        })
                        .catch(function () {
                            if (destroyed || current !== generation) return;
                            if (planner) planner.dispose();
                            planner = null;
                            state.status = "error";
                            state.message =
                                "تعذر إكمال الطلب. أعد تشغيل المساعد أو أكمل بالأجزاء اليدوية.";
                        });
                };
                scope.applyAssistant = function () {
                    if (!state.proposal) return;
                    var result = scope.onApply({
                        proposal: angular.copy(state.proposal),
                    });
                    if (result === false) {
                        state.message =
                            "تعذر تطبيق الاقتراح. يمكنك تعديل الأجزاء يدوياً.";
                        return;
                    }
                    state.proposal = null;
                    state.status = "ready";
                    state.message =
                        "أُضيفت الأجزاء إلى المحرر. عدّلها إن أردت ثم اضغط «بحث».";
                };
                scope.$on("$destroy", function () {
                    destroyed = true;
                    ++generation;
                    if (abort) abort.abort();
                    if (planner) planner.dispose();
                });
            },
        };
    },
);
