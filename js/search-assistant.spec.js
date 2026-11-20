describe("Assistant registry protocol", function () {
    beforeEach(angular.mock.module("myApp"));
    it(
        "accepts both legacy and settings-aware registry versions",
        angular.mock.inject(function (QuranPlannerService, $httpBackend) {
            $httpBackend.whenGET("view/search.html").respond(200, "");
            for (var version of [1, 2]) {
                var result = null,
                    info = {
                        version: version,
                        channel: "experimental",
                        model: "models/test/",
                        client: "models/runtime/test/client.js",
                        bytes: 1024,
                    };
                $httpBackend
                    .expectGET(/^models\/planner.json\?v=/)
                    .respond(200, info);
                QuranPlannerService.describe().then(function (value) {
                    result = value;
                });
                $httpBackend.flush();
                expect(result.version).toBe(version);
            }
        }),
    );
    it(
        "rejects an unknown registry before downloading a model",
        angular.mock.inject(function (QuranPlannerService, $httpBackend) {
            $httpBackend.whenGET("view/search.html").respond(200, "");
            var rejected = false;
            $httpBackend
                .expectGET(/^models\/planner.json\?v=/)
                .respond(200, {
                    version: 99,
                    channel: "experimental",
                    model: "models/test/",
                    client: "models/runtime/test/client.js",
                    bytes: 1024,
                });
            QuranPlannerService.describe().catch(function () {
                rejected = true;
            });
            $httpBackend.flush();
            expect(rejected).toBe(true);
        }),
    );
});
describe("Arabic assistant panel", function () {
    var root,
        compile,
        q,
        scope,
        panel,
        describeResult,
        loadResult,
        proposalResult,
        instance,
        service,
        apply;
    beforeEach(
        angular.mock.module("myApp", function ($provide) {
            service = {
                describe: jasmine.createSpy(),
                load: jasmine.createSpy(),
            };
            $provide.value("QuranPlannerService", service);
        }),
    );
    beforeEach(
        angular.mock.inject(
            function ($rootScope, $compile, $q, $templateCache, $httpBackend) {
                root = $rootScope;
                compile = $compile;
                q = $q;
                $httpBackend.whenGET("view/search.html").respond(200, "");
                $templateCache.put(
                    "view/search-assistant.html",
                    "<section></section>",
                );
                describeResult = q.defer();
                loadResult = q.defer();
                proposalResult = q.defer();
                service.describe.and.returnValue(describeResult.promise);
                service.load.and.returnValue(loadResult.promise);
                instance = {
                    propose: jasmine
                        .createSpy()
                        .and.returnValue(proposalResult.promise),
                    dispose: jasmine.createSpy(),
                };
                scope = root.$new();
                scope.apply = apply = jasmine.createSpy().and.returnValue(true);
                panel = compile(
                    '<quran-search-assistant on-apply="apply(proposal)"></quran-search-assistant>',
                )(scope);
                scope.$digest();
                panel = panel.isolateScope();
            },
        ),
    );
    function info() {
        panel.openAssistant();
        describeResult.resolve({
            channel: "experimental",
            bytes: 1024,
            runtime_bytes: 1024,
        });
        root.$digest();
    }
    function ready() {
        info();
        panel.assistant.consent = true;
        panel.enableAssistant();
        loadResult.resolve(instance);
        root.$digest();
    }
    function suggestion() {
        return {
            status: "suggestion",
            intent: "context_after",
            blocks: [
                Object.assign(QuranQueryBuilder.create("context", "ولكن"), {
                    direction: "after",
                    count: 3,
                }),
            ],
            reference: { ayah: null, surah: null },
        };
    }
    it("does not fetch model metadata or load a model until requested", function () {
        expect(service.describe).not.toHaveBeenCalled();
        expect(service.load).not.toHaveBeenCalled();
    });
    it("requires experimental consent before downloading", function () {
        info();
        panel.enableAssistant();
        expect(service.load).not.toHaveBeenCalled();
        panel.assistant.consent = true;
        panel.enableAssistant();
        expect(service.load).toHaveBeenCalled();
    });
    it("previews proposals without applying or searching automatically", function () {
        ready();
        panel.assistant.text = "اجمع ٣ كلمات بعد «ولكن»";
        panel.askAssistant();
        proposalResult.resolve(suggestion());
        root.$digest();
        expect(panel.assistant.status).toBe("suggestion");
        expect(apply).not.toHaveBeenCalled();
        panel.applyAssistant();
        expect(apply).toHaveBeenCalled();
        expect(panel.assistant.proposal).toBeNull();
    });
    it("discards proposals when the request changes during inference", function () {
        ready();
        panel.assistant.text = "ابحث عن «نور»";
        panel.askAssistant();
        panel.assistant.text = "ابحث عن «هدى»";
        panel.assistantTextChanged();
        proposalResult.resolve(suggestion());
        root.$digest();
        expect(panel.assistant.proposal).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });
    it("shows clarification instead of proposing invalid blocks", function () {
        ready();
        panel.assistant.text = "ابحث";
        panel.askAssistant();
        proposalResult.resolve({
            status: "suggestion",
            blocks: [{ type: "text", value: ".*" }],
        });
        root.$digest();
        expect(panel.assistant.status).toBe("clarify");
        expect(panel.assistant.proposal).toBeNull();
    });
    it("preserves clarification supplied by the grounded planner", function () {
        ready();
        panel.assistant.text = "اشرح";
        panel.askAssistant();
        proposalResult.resolve({
            status: "clarify",
            reason: "ضع النص بين علامتي تنصيص.",
        });
        root.$digest();
        expect(panel.assistant.message).toBe("ضع النص بين علامتي تنصيص.");
    });
    it("cancels a download and disposes a late successful load", function () {
        info();
        panel.assistant.consent = true;
        panel.enableAssistant();
        var signal = service.load.calls.mostRecent().args[1].signal;
        panel.cancelAssistant();
        expect(signal.aborted).toBe(true);
        loadResult.resolve(instance);
        root.$digest();
        expect(instance.dispose).toHaveBeenCalled();
        expect(panel.assistant.status).toBe("idle");
    });
    it("releases the worker when leaving the search page", function () {
        ready();
        scope.$destroy();
        expect(instance.dispose).toHaveBeenCalled();
    });
    it("allows retry after loading fails", function () {
        info();
        panel.assistant.consent = true;
        panel.enableAssistant();
        loadResult.reject(new Error("offline"));
        root.$digest();
        expect(panel.assistant.status).toBe("error");
        panel.enableAssistant();
        expect(service.load.calls.count()).toBe(2);
    });
    it("stops a failed inference worker and keeps manual search available", function () {
        ready();
        panel.assistant.text = "ابحث عن «الله»";
        panel.askAssistant();
        proposalResult.reject(new Error("failed"));
        root.$digest();
        expect(panel.assistant.status).toBe("error");
        expect(instance.dispose).toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
    });
});

describe("Applying an assistant proposal to the existing builder", function () {
    var scope, root, location, controller, http;
    beforeEach(angular.mock.module("myApp"));
    beforeEach(
        angular.mock.inject(
            function ($controller, $rootScope, $location, $httpBackend) {
                root = $rootScope;
                location = $location;
                http = $httpBackend;
                http.whenGET("view/search.html").respond(200, "");
                scope = root.$new();
                controller = $controller("AyatSearchController", {
                    $scope: scope,
                });
                root.$digest();
            },
        ),
    );
    function plan(blocks, reference) {
        return {
            status: "suggestion",
            blocks: blocks,
            reference: reference || { ayah: null, surah: null },
        };
    }
    it("does not execute a search or change the saved link until the user searches", function () {
        var before = angular.copy(location.search());
        spyOn(scope, "searchButtonClicked").and.callThrough();
        expect(
            scope.applyAssistantProposal(
                plan([QuranQueryBuilder.create("context", "ولكن")]),
            ),
        ).toBe(true);
        expect(scope.searchButtonClicked).not.toHaveBeenCalled();
        expect(location.search()).toEqual(before);
        expect(scope.queryEdited).toBe(true);
    });
    it("preserves exact quoted text and independent matching settings", function () {
        var block = QuranQueryBuilder.create("text", "عَلِمَ");
        block.matchMode = "whole";
        scope.applyAssistantProposal(plan([block]));
        expect(scope.queryBlocks[0].value).toBe("عَلِمَ");
        expect(scope.queryBlocks[0].matchMode).toBe("whole");
        expect(scope.searchConfig.wordMatch).toBe("contains");
    });
    it("restores previous blocks, reference and configuration with undo", function () {
        scope.queryBlocks = [QuranQueryBuilder.create("text", "الله")];
        scope.reference = { surah: 2, ayah: 255 };
        scope.searchConfig.wordMatch = "whole";
        var before = angular.copy(scope.queryBlocks);
        scope.applyAssistantProposal(
            plan([QuranQueryBuilder.create("text", "نور")]),
        );
        scope.undoAssistantProposal();
        expect(scope.queryBlocks).toEqual(before);
        expect(scope.reference).toEqual({ surah: 2, ayah: 255 });
        expect(scope.searchConfig.wordMatch).toBe("whole");
    });
    it("cannot undo over later manual changes", function () {
        scope.applyAssistantProposal(
            plan([QuranQueryBuilder.create("text", "نور")]),
        );
        scope.queryBlocks[0].value = "هدى";
        scope.builderChanged();
        scope.undoAssistantProposal();
        expect(scope.queryBlocks[0].value).toBe("هدى");
    });
    it("rejects impossible references and malformed proposals without changing the builder", function () {
        var before = angular.copy(scope.queryBlocks);
        expect(
            scope.applyAssistantProposal(
                plan([QuranQueryBuilder.create("text", "نور")], {
                    surah: 114,
                    ayah: 7,
                }),
            ),
        ).toBe(false);
        expect(
            scope.applyAssistantProposal(plan([{ type: "text", value: ".*" }])),
        ).toBe(false);
        expect(scope.queryBlocks).toEqual(before);
    });
    it("uses the existing saved-link serializer for applied reference and cross-ayah queries", function () {
        var blocks = [
            QuranQueryBuilder.create("text", "العالمين"),
            QuranQueryBuilder.create("ayahBreak"),
            QuranQueryBuilder.create("text", "الرحمن"),
        ];
        scope.applyAssistantProposal(plan(blocks, { surah: 1, ayah: 2 }));
        scope.searchButtonClicked();
        var saved = QuranSearchLink.parameters(location.search());
        expect(saved.surah).toBe(1);
        expect(saved.ayah).toBe(2);
        expect(JSON.parse(saved.qb)[1].type).toBe("ayahBreak");
        expect(location.search().q).toMatch(/^v1\./);
    });
    it("keeps all three global options through apply, save and undo", function () {
        scope.searchConfig.searchFromBeginning = true;
        scope.searchConfig.searchOnEnd = true;
        scope.shouldRemoveLastHarakah = true;
        for (var bits = 0; bits < 8; bits++) {
            var candidate = plan([QuranQueryBuilder.create("text", "الحمد")]);
            candidate.settings = {
                searchFromBeginning: !!(bits & 1),
                searchOnEnd: !!(bits & 2),
                removeLastHarakah: !!(bits & 4),
            };
            expect(scope.applyAssistantProposal(candidate)).toBe(true);
            expect(scope.searchConfig.searchFromBeginning).toBe(
                candidate.settings.searchFromBeginning,
            );
            expect(scope.searchConfig.searchOnEnd).toBe(
                candidate.settings.searchOnEnd,
            );
            expect(scope.shouldRemoveLastHarakah).toBe(
                candidate.settings.removeLastHarakah,
            );
            scope.searchButtonClicked();
            var saved = QuranSearchLink.parameters(location.search());
            expect(saved.search_only_from_beginning).toBe(
                candidate.settings.searchFromBeginning,
            );
            expect(saved.search_only_on_end).toBe(
                candidate.settings.searchOnEnd,
            );
            expect(saved.remove_harakah).toBe(
                candidate.settings.removeLastHarakah,
            );
        }
        var clear = plan([QuranQueryBuilder.create("text", "نور")]);
        clear.settings = {
            searchFromBeginning: false,
            searchOnEnd: false,
            removeLastHarakah: false,
        };
        scope.applyAssistantProposal(clear);
        scope.undoAssistantProposal();
        expect(scope.searchConfig.searchFromBeginning).toBe(true);
        expect(scope.searchConfig.searchOnEnd).toBe(true);
        expect(scope.shouldRemoveLastHarakah).toBe(true);
    });
    it("rejects malformed global settings without replacing the draft", function () {
        var before = angular.copy(scope.queryBlocks),
            candidate = plan([QuranQueryBuilder.create("text", "نور")]);
        candidate.settings = {
            searchFromBeginning: "true",
            searchOnEnd: false,
            removeLastHarakah: false,
        };
        expect(scope.applyAssistantProposal(candidate)).toBe(false);
        expect(scope.queryBlocks).toEqual(before);
    });
    it("matches the selected beginning and ending of a real ayah", function () {
        for (var end of [false, true]) {
            var candidate = plan(
                [QuranQueryBuilder.create("text", end ? "العالمين" : "الحمد")],
                { surah: 1, ayah: 2 },
            );
            candidate.settings = {
                searchFromBeginning: !end,
                searchOnEnd: end,
                removeLastHarakah: false,
            };
            scope.applyAssistantProposal(candidate);
            scope.searchButtonClicked();
            root.$digest();
            expect(scope.foundAyat.length).toBe(1);
            expect(scope.foundAyat[0].verse_id).toBe(2);
        }
    });
    it("groups without the last harakah while preserving occurrence counts", function () {
        function run(remove) {
            var candidate = plan([QuranQueryBuilder.create("text", "علم")]);
            candidate.settings = {
                searchFromBeginning: false,
                searchOnEnd: false,
                removeLastHarakah: remove,
            };
            scope.applyAssistantProposal(candidate);
            scope.searchButtonClicked();
            root.$digest();
            return {
                groups: Object.keys(scope.countedAyahAttributes.matched).length,
                total: Object.values(
                    scope.countedAyahAttributes.matched,
                ).reduce(function (a, b) {
                    return a + b;
                }, 0),
            };
        }
        var original = run(false),
            merged = run(true);
        expect(merged.groups).toBeLessThan(original.groups);
        expect(merged.total).toBe(original.total);
    });
});
