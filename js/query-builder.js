/* Translate readable query blocks to the existing search language. */
var QuranQueryBuilder = (function () {
    var types = [
        {value: 'text', label: 'نص محدد', hint: 'اكتب حرفاً أو كلمة أو عبارة، مع الحركات التي تريد مطابقتها.'},
        {value: 'letter', label: 'حرف واحد غير محدد', hint: 'يطابق حرفاً واحداً. يمكنك تحديد حركته أو تركها غير محددة.'},
        {value: 'letters', label: 'حرف واحد أو أكثر', hint: 'يطابق حروفاً متتابعة داخل الكلمة نفسها.'},
        {value: 'optional', label: 'حروف اختيارية', hint: 'قد لا توجد حروف، أو يوجد حرف واحد أو أكثر داخل الكلمة.'},
        {value: 'word', label: 'كلمة غير محددة', hint: 'يطابق كلمة كاملة واحدة، مهما كانت حروفها.'},
        {value: 'words', label: 'كلمة أو أكثر', hint: 'يطابق كلمات متتابعة، مثلاً بين عبارتين.'},
        {value: 'capture', label: 'كلمات لجمعها وعدّها', hint: 'يجمع الكلمات في هذا الموضع ويعرض عدد تكرار كل نتيجة.'}
    ];
    var marks = [
        {value: '', label: 'أي حركة'}, {value: 'َ', label: 'فتحة'},
        {value: 'ِ', label: 'كسرة'}, {value: 'ُ', label: 'ضمة'},
        {value: 'ْ', label: 'سكون'}, {value: 'ّ', label: 'شدة'},
        {value: 'ً', label: 'تنوين فتح'}, {value: 'ٍ', label: 'تنوين كسر'},
        {value: 'ٌ', label: 'تنوين ضم'}
    ];
    var textPattern = /^[\u0621-\u063A\u0641-\u065F\u0670\u0671\u06D6-\u06ED\s]+$/;
    var markPattern = /^[\u064B-\u0652\u0670]*$/;

    function create(type, value) {
        return {type: type, value: value || '', join: 'attached', mark: '', count: 1};
    }

    function compile(blocks) {
        if (!Array.isArray(blocks) || !blocks.length) {
            return {error: 'أضف جزءاً واحداً على الأقل لبناء البحث.'};
        }
        var query = '';
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            if (!block || !types.some(function (type) { return type.value === block.type; })) {
                return {error: 'اختر نوع الجزء من القائمة.'};
            }
            var token;
            if (block.type === 'text') {
                if (typeof block.value !== 'string' || !block.value.trim()) {
                    return {error: 'أدخل النص في الجزء ' + (i + 1) + '، أو احذف هذا الجزء.'};
                }
                if (!textPattern.test(block.value)) {
                    return {error: 'اكتب حروفاً عربية وحركات فقط في الجزء ' + (i + 1) + '. أضف الحروف والكلمات غير المحددة من قائمة الأجزاء.'};
                }
                token = block.value;
            } else if (block.type === 'letter') {
                if (!markPattern.test(block.mark || '')) return {error: 'اختر حركة صحيحة للحرف.'};
                token = 'ـ' + (block.mark || '');
            } else if (block.type === 'letters') {
                token = '.';
            } else if (block.type === 'optional') {
                token = '*';
            } else if (block.type === 'word') {
                token = ' . ';
            } else if (block.type === 'words') {
                token = ' .. ';
            } else {
                if (!Number.isInteger(Number(block.count)) || block.count < 1 || block.count > 20) {
                    return {error: 'اختر عدداً صحيحاً من كلمة واحدة إلى عشرين كلمة.'};
                }
                token = ' (' + Array(Number(block.count)).fill('.').join(' ') + ') ';
            }
            query += (i && block.join === 'space' ? ' ' : '') + token;
        }
        return {query: query.replace(/\s+/g, ' ')};
    }

    // Restore common older links without exposing their special syntax in the UI.
    // Unrecognised expressions stay intact and run through the existing engine.
    function parse(query) {
        if (!query) return [create('text')];
        var blocks = [], position = 0, join = 'attached';
        while (position < query.length) {
            var remaining = query.slice(position);
            var spaces = remaining.match(/^\s+/);
            if (spaces) {
                if (!blocks.length) {
                    // Leading/trailing spaces are meaningful word boundaries.
                    blocks.push(create('text', spaces[0]));
                } else if (position + spaces[0].length === query.length) {
                    if (blocks[blocks.length - 1].type === 'text') blocks[blocks.length - 1].value += spaces[0];
                    else return null;
                }
                join = 'space';
                position += spaces[0].length;
                continue;
            }
            var block, match;
            if ((match = remaining.match(/^\((\.(?:\s+\.)*)\)/))) {
                block = create('capture');
                block.count = match[1].split(/\s+/).length;
            } else if ((match = remaining.match(/^[ـ_]([\u064B-\u0652\u0670]*)/))) {
                block = create('letter');
                block.mark = match[1];
            } else if ((match = remaining.match(/^\*+/))) {
                block = create('optional');
            } else if ((match = remaining.match(/^\.\.(?=\s|$)/)) && (position === 0 || /\s/.test(query[position - 1]))) {
                block = create('words');
            } else if (remaining[0] === '.') {
                match = ['.'];
                var standalone = (position === 0 || /\s/.test(query[position - 1])) && (remaining.length === 1 || /\s/.test(remaining[1]));
                block = create(standalone ? 'word' : 'letters');
            } else if ((match = remaining.match(/^[\u0621-\u063A\u0641-\u065F\u0670\u0671\u06D6-\u06ED]+/))) {
                block = create('text', match[0]);
            } else {
                return null;
            }
            block.join = join;
            // Fold adjacent literal words into one editable phrase.
            var previous = blocks[blocks.length - 1];
            if (block.type === 'text' && previous && previous.type === 'text') {
                previous.value += (join === 'space' ? ' ' : '') + block.value;
            } else {
                blocks.push(block);
            }
            position += match[0].length;
            join = 'attached';
        }
        // Do not reinterpret ambiguous links or silently change their results.
        var compiled = compile(blocks);
        if (compiled.error) return null;
        var normalise = function (value) { return value.replace(/\s+/g, ' ').replace(/_/g, 'ـ').trim(); };
        if (normalise(compiled.query) !== normalise(query)) return null;
        return blocks;
    }

    return {types: types, marks: marks, create: create, compile: compile, parse: parse};
}());
