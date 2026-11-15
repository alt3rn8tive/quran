/* Translate readable query blocks to the existing search language. */
var QuranQueryBuilder = (function () {
    var types = [
        {value: 'text', label: 'نص محدد', hint: 'اكتب حرفاً أو كلمة أو عبارة، مع الحركات التي تريد مطابقتها.'},
        {value: 'letter', label: 'حرف وحركته', hint: 'اختر حرفاً محدداً أو أي حرف، ثم اختر حركته.'},
        {value: 'letters', label: 'حروف غير محددة', hint: 'اختر عدد الحروف المجهولة داخل الكلمة نفسها.'},
        {value: 'word', label: 'كلمة غير محددة', hint: 'يطابق كلمة كاملة واحدة، مهما كانت حروفها.'},
        {value: 'words', label: 'كلمة أو أكثر', hint: 'يطابق كلمات متتابعة، مثلاً بين عبارتين.'},
        {value: 'capture', label: 'جمع كلمات في هذا الموضع', hint: 'يجمع الكلمات في هذا الموضع ويعرض عدد تكرار كل نتيجة.'},
        {value: 'context', label: 'كلمات قبل عبارة أو بعدها', hint: 'اكتب العبارة، ثم اختر الكلمات السابقة أو التالية لجمعها وعدّ تكرارها.'},
        {value: 'between', label: 'عبارتان بينهما كلمات', hint: 'يبحث عن عبارتين بالترتيب نفسه، تفصل بينهما كلمة واحدة أو أكثر داخل الآية.'}
    ];
    var marks = [
        {value: '', label: 'أي حركة'}, {value: 'َ', label: 'فتحة'},
        {value: 'ِ', label: 'كسرة'}, {value: 'ُ', label: 'ضمة'},
        {value: 'ْ', label: 'سكون'},
        {value: 'ً', label: 'تنوين فتح'}, {value: 'ٍ', label: 'تنوين كسر'},
        {value: 'ٌ', label: 'تنوين ضم'}
    ];
    var repetitions = [
        {value: 'one', label: 'حرف واحد بالضبط'},
        {value: 'oneOrMore', label: 'حرف واحد أو أكثر'},
        {value: 'zeroOrMore', label: 'لا حرف أو حرف واحد أو أكثر'}
    ];
    var wordModes = [
        {value: 'contains', label: 'يحتوي على', hint: 'يطابق النص في أي موضع داخل الكلمة أو العبارة.'},
        {value: 'whole', label: 'كلمة كاملة', hint: 'تبدأ المطابقة وتنتهي عند حدود الكلمات، دون اتصال بحروف أخرى.'},
        {value: 'starts', label: 'يبدأ بـ', hint: 'تبدأ المطابقة في بداية الكلمة؛ يمكن أن تتبعها حروف أخرى.'},
        {value: 'ends', label: 'ينتهي بـ', hint: 'تنتهي المطابقة في نهاية الكلمة؛ يمكن أن تسبقها حروف أخرى.'}
    ];
    var alphabet = Array.from('ءآأؤإئابتثجحخدذرزسشصضطظعغفقكلمنهويىةٱ');
    var singleLetterPattern = /^[\u0621-\u063A\u0641-\u064A\u0671]$/;
    var textPattern = /^[\u0621-\u063A\u0641-\u065F\u0670\u0671\u06D6-\u06ED\s]+$/;
    var markPattern = /^[\u064B-\u0652\u0670]*$/;

    function create(type, value) {
        return {
            type: type, value: value || '', join: 'attached', mark: '', shadda: false,
            letterMode: 'any', repetition: type === 'optional' ? 'zeroOrMore' : 'oneOrMore',
            count: 1, direction: 'after', endValue: ''
        };
    }

    function normalise(blocks) {
        return blocks.map(function (block) {
            var result = Object.assign(create(block.type), block);
            if (result.type === 'optional') result.type = 'letters';
            if (result.type === 'letter' && typeof result.mark === 'string') {
                result.shadda = result.shadda || result.mark.includes('ّ');
                result.mark = result.mark.replace(/ّ/g, '');
            }
            return result;
        });
    }

    function validText(value) {
        return typeof value === 'string' && value.trim() && textPattern.test(value);
    }

    function captureWords(count) {
        return '(' + Array(Number(count)).fill('.').join(' ') + ')';
    }

    function compile(blocks) {
        if (!Array.isArray(blocks) || !blocks.length) {
            return {error: 'أضف جزءاً واحداً على الأقل لبناء البحث.'};
        }
        var query = '';
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            // The optional type is retained for older shared links.
            if (!block || (block.type !== 'optional' && !types.some(function (type) { return type.value === block.type; }))) {
                return {error: 'اختر نوع الجزء من القائمة.'};
            }
            var token;
            if (['text', 'context', 'between'].includes(block.type) && !validText(block.value)) {
                return {error: 'أدخل نصاً عربياً في الجزء ' + (i + 1) + '، دون رموز البحث، أو احذف هذا الجزء.'};
            }
            if (block.type === 'text') {
                token = block.value;
            } else if (block.type === 'letter') {
                if (!markPattern.test(block.mark || '')) return {error: 'اختر حركة صحيحة للحرف.'};
                var specific = block.letterMode === 'specific';
                if (specific && !singleLetterPattern.test(block.value)) return {error: 'اختر حرفاً واحداً في الجزء ' + (i + 1) + '.'};
                var vowel = (block.mark || '').replace(/ّ/g, '');
                var shadda = block.shadda || (block.mark || '').includes('ّ');
                token = (specific ? block.value : 'ـ') + vowel + (shadda ? 'ّ' : '');
            } else if (block.type === 'letters' || block.type === 'optional') {
                var repetition = block.repetition || (block.type === 'optional' ? 'zeroOrMore' : 'oneOrMore');
                if (!repetitions.some(function (option) { return option.value === repetition; })) return {error: 'اختر عدد الحروف غير المحددة.'};
                token = {one: 'ـ', oneOrMore: '.', zeroOrMore: '*'}[repetition];
            } else if (block.type === 'word') {
                token = ' . ';
            } else if (block.type === 'words') {
                token = ' .. ';
            } else if (block.type === 'between') {
                if (!validText(block.endValue)) return {error: 'أدخل العبارة الثانية في الجزء ' + (i + 1) + '.'};
                token = block.value.trim() + ' .. ' + block.endValue.trim();
            } else {
                if (!Number.isInteger(Number(block.count)) || block.count < 1 || block.count > 20) {
                    return {error: 'اختر عدداً صحيحاً من كلمة واحدة إلى عشرين كلمة.'};
                }
                var captured = captureWords(block.count);
                if (block.type === 'context') {
                    if (!['before', 'after'].includes(block.direction)) return {error: 'اختر قبل العبارة أو بعدها.'};
                    token = block.direction === 'before'
                        ? ' ' + captured + ' ' + block.value.trim() : block.value.trim() + ' ' + captured + ' ';
                } else token = ' ' + captured + ' ';
            }
            var phrasePart = ['context', 'between'];
            var separate = i && (block.join === 'space' || phrasePart.includes(block.type) || phrasePart.includes(blocks[i - 1].type));
            query += (separate ? ' ' : '') + token;
        }
        return {query: query.replace(/\s+/g, ' ')};
    }

    function preview(block) {
        if (block.type === 'text') return block.value || 'نص لم يُكتب بعد';
        if (block.type === 'letter') {
            var vowel = (block.mark || '').replace(/ّ/g, '');
            var shadda = block.shadda || (block.mark || '').includes('ّ');
            if (block.letterMode === 'specific') return (block.value || 'حرف لم يُحدد بعد') + vowel + (shadda ? 'ّ' : '');
            var mark = marks.find(function (option) { return option.value === vowel; });
            return 'أي حرف، ' + (mark ? mark.label : 'بالحركات المحفوظة') + (shadda ? '، مع شدة' : '');
        }
        if (block.type === 'letters' || block.type === 'optional') {
            var repetition = block.repetition || (block.type === 'optional' ? 'zeroOrMore' : 'oneOrMore');
            var option = repetitions.find(function (item) { return item.value === repetition; });
            return option ? option.label : 'حروف غير محددة';
        }
        if (block.type === 'context') return 'جمع ' + (block.count || '…') + ' من الكلمات ' + (block.direction === 'before' ? 'قبل' : 'بعد') + ' «' + (block.value || 'العبارة') + '»';
        if (block.type === 'between') return '«' + (block.value || 'العبارة الأولى') + '» ثم كلمة أو أكثر ثم «' + (block.endValue || 'العبارة الثانية') + '»';
        if (block.type === 'capture') return 'جمع ' + (block.count || '…') + ' من الكلمات';
        return block.type === 'word' ? 'كلمة غير محددة' : 'كلمة أو أكثر';
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

    return {types: types, marks: marks, repetitions: repetitions, wordModes: wordModes, alphabet: alphabet,
        create: create, normalise: normalise, compile: compile, parse: parse, preview: preview};
}());
