describe('Local search library storage and portable files', function () {
    var store, storage, disk, failWrite;
    function search(name, group, value) {
        var block = QuranQueryBuilder.create('context', value || 'ولكن'); block.count = 3;
        return {name:name || 'بحث', group:group || 'عام', q:QuranSearchLink.encode({s:QuranQueryBuilder.compile([block]).query, qb:JSON.stringify([block]), ayah:2, surah:1, filter_results:'قال', filter_suwar:'1', remove_harakah:true})};
    }
    function file(entries) { return JSON.stringify({format:QuranLibraryData.format, version:1, searches:entries}); }
    beforeEach(function () {
        disk = {}; failWrite = false;
        storage = {getItem:function (key) { return disk[key] || null; }, setItem:function (key,value) { if (failWrite) throw new Error('quota'); disk[key] = value; }};
        angular.mock.module('myApp', function ($provide) { $provide.value('$window', {localStorage:storage, Blob:window.Blob}); });
    });
    beforeEach(angular.mock.inject(function (QuranLibraryStore) { store = QuranLibraryStore; }));
    it('saves Arabic names, groups, structured blocks, captures, reference and active filters', function () {
        var entries = store.save(search('ثلاث كلمات بعد ولكن', 'التدبر'));
        expect(entries.length).toBe(1); expect(store.read()[0].name).toBe('ثلاث كلمات بعد ولكن');
        var params = QuranSearchLink.parameters({q:store.read()[0].q});
        expect(params.filter_results).toBe('قال'); expect(params.filter_suwar).toBe('1'); expect(params.ayah).toBe(2); expect(params.surah).toBe(1);
        expect(JSON.parse(params.qb)[0].count).toBe(3); expect(params.remove_harakah).toBeTrue();
    });
    it('updates identical saves, renames and moves a search, and supports deletion undo', function () {
        var entry = store.save(search())[0]; store.save(search()); expect(store.read().length).toBe(1);
        store.edit(entry.id, 'اسم جديد', 'مجموعة جديدة');
        expect(store.read()[0].group).toBe('مجموعة جديدة');
        var removed = store.remove(entry.id); expect(store.read()).toEqual([]);
        store.restore(removed); store.restore(removed); expect(store.read().length).toBe(1); expect(store.read()[0].name).toBe('اسم جديد');
    });
    it('exports and imports without replacing existing searches or duplicating identical rows', function () {
        store.save(search('الأول')); var portable = QuranLibraryData.export(store.read());
        expect(JSON.parse(portable).searches[0].id).toBeUndefined();
        expect(store.import(portable)).toBe(0);
        expect(store.import(file([search('الثاني'), search('الثاني')]))).toBe(1);
        expect(store.read().length).toBe(2);
        // A newer entry from another tab must survive the next mutation.
        var other = JSON.parse(disk[store.key]); other.searches.push(Object.assign(search('من نافذة أخرى'), {id:'other-tab'})); disk[store.key]=JSON.stringify(other);
        store.save(search('الثالث')); expect(store.read().length).toBe(4);
    });
    it('validates the entire import before writing and rejects injected URLs or malformed settings', function () {
        store.save(search('محفوظ')); var before = disk[store.key];
        [file([search('جديد'), {name:'معطوب',group:'عام',q:'javascript:alert(1)'}]), '{bad', JSON.stringify({format:'other',version:1,searches:[]}),
            file([Object.assign(search(),{q:QuranSearchLink.encode({s:'قال',filter_results:true})})])].forEach(function (text) {
            expect(function () { store.import(text); }).toThrow(); expect(disk[store.key]).toBe(before);
        });
        var safe = QuranLibraryData.entry(Object.assign(search(),{q:QuranSearchLink.encode({s:'قال', destination:'https://bad.example'})}));
        expect(QuranSearchLink.parameters({q:safe.q}).destination).toBeUndefined();
    });
    it('keeps persisted data intact when storage is blocked or full', function () {
        store.save(search()); var before = disk[store.key]; failWrite = true;
        expect(function () { store.save(search('جديد')); }).toThrow(); expect(disk[store.key]).toBe(before);
        expect(function () { store.remove(store.read()[0].id); }).toThrow(); expect(disk[store.key]).toBe(before);
        disk[store.key] = '{broken'; expect(function () { store.read(); }).toThrow(); expect(disk[store.key]).toBe('{broken');
    });
    it('enforces limits on entries and imported files without partial additions', function () {
        var entries = Array.from({length:201}, function (_,i) { return search(String(i)); });
        expect(function () { store.import(file(entries)); }).toThrow(); expect(store.read()).toEqual([]);
    });
});

describe('Library and inline ayah context controller', function () {
    var scope, root, location, controller, original, data, originalStorage;
    beforeEach(angular.mock.module('myApp'));
    beforeEach(angular.mock.inject(function ($controller, $rootScope, $location, $httpBackend) {
        controller = $controller; root = $rootScope; location = $location;
        data = {};
        spyOn(window.localStorage, 'getItem').and.callFake(function (key) { return data[key] || null; });
        spyOn(window.localStorage, 'setItem').and.callFake(function (key,value) { data[key]=value; });
        original = all_ayat;
        all_ayat = [
            {sura_id:1,verse_id:1,text:' الحمد لله '}, {sura_id:1,verse_id:2,text:' رب العالمين '},
            {sura_id:1,verse_id:3,text:' الرحمن الرحيم '}, {sura_id:1,verse_id:4,text:' مالك يوم الدين '},
            {sura_id:2,verse_id:1,text:' رب العالمين '}
        ];
        location.path('/search').search({}); scope=root.$new(); controller('AyatSearchController',{$scope:scope});
        $httpBackend.whenGET('view/search.html').respond('');
    }));
    afterEach(function () { scope.$destroy(); all_ayat=original; });
    it('saves and restores a cross-ayah search with current filters after a controller reload', function () {
        scope.loadPreset('crossAyah'); root.$digest(); scope.useSuwar={'1':true}; root.$digest();
        scope.libraryForm.name='عبر آيتين'; scope.libraryForm.group='السياق'; scope.saveToLibrary();
        expect(scope.libraryEntries.length).toBe(1);
        var saved = scope.libraryEntries[0];
        scope.$destroy(); scope=root.$new(); controller('AyatSearchController',{$scope:scope}); root.$digest();
        expect(scope.libraryEntries[0].name).toBe('عبر آيتين');
        scope.openLibrarySearch(saved); root.$digest();
        scope.$destroy(); scope=root.$new(); controller('AyatSearchController',{$scope:scope}); root.$digest();
        expect(scope.queryBlocks[1].type).toBe('ayahBreak'); expect(scope.useSuwar['1']).toBeTrue(); expect(scope.filteredAyat.length).toBe(1);
    });
    it('does not save stale search settings when blocks have been edited', function () {
        scope.loadPreset('crossAyah'); root.$digest(); scope.builderChanged(); scope.libraryForm.name='غير منفذ'; scope.saveToLibrary();
        expect(scope.libraryEntries.length).toBe(0); expect(scope.libraryStatus).toContain('نفّذ البحث');
    });
    it('shows context outside the full matched group and keeps matching data and CSV unchanged', function () {
        scope.loadPreset('crossAyah'); root.$digest(); var group=scope.foundAyat[0];
        var stats=angular.copy(scope.resultStats), csv=QuranResults.csv(QuranResults.ayahRows(scope.filteredAyat, all_suwar, ''));
        expect(scope.contextAyah(group,'before').verse_id).toBe(1); expect(scope.contextAyah(group,'after').verse_id).toBe(4);
        scope.toggleResultContext(group,'before'); scope.toggleResultContext(group,'after'); root.$digest();
        expect(group.showPrevious).toBeTrue(); expect(group.showNext).toBeTrue(); expect(group.ayat.length).toBe(2);
        expect(scope.resultStats).toEqual(stats); expect(QuranResults.csv(QuranResults.ayahRows(scope.filteredAyat,all_suwar,''))).toBe(csv);
        scope.toggleResultContext(group,'before'); expect(group.showPrevious).toBeFalse();
    });
    it('never wraps context to a different surah at either edge', function () {
        var first={ayat:[all_ayat[0]]}, last={ayat:[all_ayat[3]]}, nextSurah={ayat:[all_ayat[4]]};
        expect(scope.contextAyah(first,'before')).toBeUndefined(); expect(scope.contextAyah(last,'after')).toBeUndefined(); expect(scope.contextAyah(nextSurah,'before')).toBeUndefined();
        scope.toggleResultContext(last,'after'); expect(last.showNext).toBeUndefined();
    });
    it('lets users rename, regroup, cancel edits, filter groups and undo removal', function () {
        scope.loadPreset('crossAyah'); root.$digest(); scope.libraryForm.name='أول'; scope.saveToLibrary();
        scope.editLibrarySearch(scope.libraryEntries[0]); scope.libraryEdit.name='ثان'; scope.libraryEdit.group='تدبر'; scope.applyLibraryEdit();
        expect(scope.libraryEntries[0].name).toBe('ثان'); scope.libraryForm.filter='تدبر'; expect(scope.libraryMatchesGroup(scope.libraryEntries[0])).toBeTrue();
        scope.editLibrarySearch(scope.libraryEntries[0]); scope.cancelLibraryEdit(); expect(scope.libraryEdit).toBeNull();
        scope.removeLibrarySearch(scope.libraryEntries[0]); expect(scope.libraryEntries.length).toBe(0); scope.undoLibraryRemove(); expect(scope.libraryEntries[0].group).toBe('تدبر');
    });
});
