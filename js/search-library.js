/* Local, portable saved searches. Files contain search state, never navigation URLs. */
var QuranLibraryData = {
    format: 'quran-search-library',
    limit: 200,
    entry: function (entry) {
        if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 120
            || typeof entry.group !== 'string' || !entry.group.trim() || entry.group.length > 80
            || typeof entry.q !== 'string' || entry.q.length > 200000 || !/^v1\.[A-Za-z0-9_-]+$/.test(entry.q)) {
            throw new Error('بيانات أحد الأبحاث غير صالحة. لم تتغير المكتبة.');
        }
        var params = QuranSearchLink.parameters({q: entry.q});
        if (typeof params.s !== 'string' || !params.s.trim() || params.s.length > 10000 || !getRegexPatternForString(params.s, {})) {
            throw new Error('أحد الأبحاث لا يحتوي على بحث صالح. لم تتغير المكتبة.');
        }
        if (params.qb !== undefined) {
            try {
                var blocks = QuranQueryBuilder.normalise(JSON.parse(params.qb));
                var compiled = QuranQueryBuilder.compile(blocks);
                if (compiled.error || compiled.query !== params.s) throw new Error();
            } catch (error) { throw new Error('إعدادات أحد الأبحاث غير صالحة. لم تتغير المكتبة.'); }
        }
        // Permit only app search settings; imports cannot inject a destination URL.
        var safe = {};
        ['s','qb','word_match','ayah','surah','remove_harakah','search_only_from_beginning','search_only_on_end','exclude_part_of_words','filter_results','filter_suwar'].forEach(function (key) {
            var value = params[key];
            if (value !== undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) safe[key] = value;
            else if (value !== undefined) throw new Error('إعدادات أحد الأبحاث غير صالحة. لم تتغير المكتبة.');
        });
        ['filter_results','filter_suwar','word_match'].forEach(function (key) {
            if (safe[key] !== undefined && typeof safe[key] !== 'string') throw new Error('إعدادات التصفية غير صالحة. لم تتغير المكتبة.');
        });
        ['ayah','surah'].forEach(function (key) {
            if (safe[key] !== undefined && (!Number.isInteger(Number(safe[key])) || Number(safe[key]) < 1 || Number(safe[key]) > (key === 'ayah' ? 286 : 114))) throw new Error('مرجع الآية أو السورة غير صالح.');
        });
        ['remove_harakah','search_only_from_beginning','search_only_on_end','exclude_part_of_words'].forEach(function (key) {
            if (safe[key] !== undefined && ![true,false,'true','false'].includes(safe[key])) throw new Error('خيارات البحث غير صالحة.');
        });
        function timestamp(value) { return typeof value === 'string' && !isNaN(Date.parse(value)) ? value : new Date().toISOString(); }
        return {name: entry.name.trim(), group: entry.group.trim(), q: QuranSearchLink.encode(safe), createdAt: timestamp(entry.createdAt), updatedAt: timestamp(entry.updatedAt)};
    },
    parse: function (text) {
        var data;
        try { data = JSON.parse(text); } catch (error) { throw new Error('تعذرت قراءة ملف JSON. لم تتغير المكتبة.'); }
        if (!data || data.format !== QuranLibraryData.format || data.version !== 1 || !Array.isArray(data.searches) || data.searches.length > QuranLibraryData.limit) {
            throw new Error('اختر ملف مكتبة أبحاث صالحاً من التطبيق، بحد أقصى 200 بحث.');
        }
        // Validate the whole file before any write, so a bad row cannot cause a partial import.
        return data.searches.map(QuranLibraryData.entry);
    },
    export: function (entries) {
        return JSON.stringify({format: QuranLibraryData.format, version: 1, searches: entries.map(QuranLibraryData.entry)}, null, 2);
    }
};

myApp.factory('QuranLibraryStore', function ($window) {
    var key = 'quran.search-library.v1';
    function read() {
        try {
            var value = $window.localStorage.getItem(key);
            if (!value) return [];
            var data = JSON.parse(value), entries = QuranLibraryData.parse(value);
            return entries.map(function (entry, index) {
                var id = data.searches[index].id;
                if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(id) || data.searches.some(function (other, otherIndex) { return otherIndex < index && other.id === id; })) throw new Error();
                return Object.assign(entry, {id: id});
            });
        } catch (error) { throw new Error('تعذر قراءة المكتبة من هذا المتصفح. لم تُحذف البيانات الموجودة.'); }
    }
    function write(entries) {
        if (entries.length > QuranLibraryData.limit) throw new Error('وصلت المكتبة إلى الحد الأقصى: 200 بحث.');
        if (new $window.Blob([QuranLibraryData.export(entries)]).size > 1024 * 1024) throw new Error('حجم المكتبة يتجاوز 1 ميغابايت. صدّرها ثم احذف بعض الأبحاث.');
        try { $window.localStorage.setItem(key, JSON.stringify({format: QuranLibraryData.format, version: 1, searches: entries})); }
        catch (error) { throw new Error('تعذر حفظ المكتبة. تحقق من السماح بالتخزين ومساحته في هذا المتصفح.'); }
        return entries;
    }
    function id() { return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
    function same(a, b) { return a.name === b.name && a.group === b.group && a.q === b.q; }
    return {
        key: key, read: read,
        save: function (entry) {
            entry = QuranLibraryData.entry(entry);
            var entries = read(), existing = entries.find(function (item) { return same(item, entry); });
            if (existing) existing.updatedAt = new Date().toISOString();
            else entries.unshift(Object.assign(entry, {id: id()}));
            return write(entries);
        },
        edit: function (entryId, name, group) {
            var entries = read(), index = entries.findIndex(function (entry) { return entry.id === entryId; });
            if (index < 0) throw new Error('لم يعد هذا البحث موجوداً في المكتبة.');
            entries[index] = Object.assign(QuranLibraryData.entry(Object.assign({}, entries[index], {name:name, group:group, updatedAt:new Date().toISOString()})), {id:entryId});
            return write(entries);
        },
        remove: function (entryId) {
            var entries = read(), index = entries.findIndex(function (entry) { return entry.id === entryId; });
            if (index < 0) throw new Error('لم يعد هذا البحث موجوداً في المكتبة.');
            var removed = entries.splice(index, 1)[0]; write(entries);
            return {entry:removed, index:index};
        },
        restore: function (removed) {
            var entries = read();
            if (!entries.some(function (entry) { return entry.id === removed.entry.id; })) entries.splice(Math.min(removed.index, entries.length), 0, removed.entry);
            return write(entries);
        },
        import: function (text) {
            var imported = QuranLibraryData.parse(text), entries = read(), added = 0;
            imported.forEach(function (entry) {
                if (!entries.some(function (existing) { return same(existing, entry); })) { entries.push(Object.assign(entry, {id:id()})); added++; }
            });
            write(entries);
            return added;
        }
    };
});

myApp.directive('libraryImport', function () {
    return {restrict:'A', link:function (scope, element) {
        function changed(event) {
            var file = event.target.files[0];
            if (file) scope.$apply(function () { scope.importLibraryFile(file); });
            element.val('');
        }
        element.on('change', changed);
        scope.$on('$destroy', function () { element.off('change', changed); });
    }};
});
