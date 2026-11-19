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
});
