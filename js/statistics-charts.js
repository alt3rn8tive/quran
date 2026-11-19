/* D3 views use the same counted data as the tables and CSV exports. */
var QuranStatisticsCharts = {
    letterSlices: function (rows, limit) {
        var slices = rows.slice(0,limit).map(function (row) { return {key:row.letter, label:row.letter, count:row.count}; });
        var rest = rows.slice(limit);
        if (rest.length) slices.push({key:'other', label:'بقية الحروف', count:rest.reduce(function (sum,row) { return sum+row.count; },0)});
        return slices;
    },
    range: function (verses, start, end) {
        if (!verses.length) return [0,0];
        var low=verses[0].verse_id, high=verses[verses.length-1].verse_id;
        function number(value,fallback) { return Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(low,Math.min(high,Math.round(Number(value)))) : fallback; }
        var a=number(start,low), b=number(end,high);
        return [Math.min(a,b),Math.max(a,b)];
    },
    nearest: function (verses, value) {
        return verses.reduce(function (nearest,verse) { return !nearest || Math.abs(verse.verse_id-value) < Math.abs(nearest.verse_id-value) ? verse : nearest; },null);
    }
};

myApp.factory('QuranChartSurface', function ($window) {
    return function (element, scope, label, draw) {
        var host=d3.select(element[0]).classed('quran-d3-surface',true);
        var svg=host.append('svg').attr('role','group').attr('aria-label',label).attr('direction','ltr');
        var tip=host.append('div').attr('class','stats-chart-tooltip').attr('role','tooltip').style('display','none');
        function show(event,text) {
            var position=event && event.clientX !== undefined ? d3.pointer(event,element[0]) : [12,12];
            tip.text(text).style('left',Math.max(0,Math.min(element[0].clientWidth-190,position[0]))+'px').style('top',Math.max(0,position[1]+12)+'px').style('display','block');
        }
        function hide() { tip.style('display','none'); }
        function activate(selection, text, callback) {
            selection.attr('role','button').attr('tabindex',0).attr('aria-label',text)
                .on('click.chart',function (event,data) { scope.$evalAsync(function () { callback(data,event); }); })
                .on('keydown.chart',function (event,data) { if (event.key==='Enter' || event.key===' ') { event.preventDefault(); scope.$evalAsync(function () { callback(data,event); }); } })
                .on('pointerenter.chart focus.chart',function (event,data) { show(event,text(data)); })
                .on('pointerleave.chart blur.chart',hide);
        }
        var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { draw(); }) : null;
        if (observer) observer.observe(element[0]); else $window.addEventListener('resize',draw);
        scope.$on('$destroy',function () { if (observer) observer.disconnect(); else $window.removeEventListener('resize',draw); svg.selectAll('*').on('.chart',null); host.selectAll('*').remove(); });
        return {host:host, svg:svg, show:show, hide:hide, activate:activate, width:function () { return Math.max(220,element[0].clientWidth || 600); }};
    };
});

myApp.directive('quranWordChart', function (QuranChartSurface) {
    return {restrict:'A', scope:{rows:'<',selected:'<',onSelect:'&'}, link:function (scope,element) {
        var surface=QuranChartSurface(element,scope,'تكرار الكلمات؛ اضغط على شريط لعرض المواضع',draw);
        function draw() {
            if (!surface) return;
            var rows=scope.rows || [], width=surface.width(), top=12, step=44, height=Math.max(80,rows.length*step+48), left=36, right=Math.min(150,width*.42), inner=Math.max(60,width-left-right);
            surface.svg.attr('viewBox','0 0 '+width+' '+height); surface.hide();
            var x=d3.scaleLinear().domain([0,d3.max(rows,function (row) { return row.count; }) || 1]).nice().range([0,inner]);
            surface.svg.selectAll('.word-x-axis').data([null]).join('g').attr('class','word-x-axis').attr('transform','translate('+left+','+(height-28)+')').call(d3.axisBottom(x).ticks(Math.min(5,x.domain()[1])).tickFormat(d3.format('d')).tickSizeOuter(0));
            var groups=surface.svg.selectAll('.word-chart-row').data(rows,function (row) { return row.key; }).join(function (enter) {
                var group=enter.append('g').attr('class','word-chart-row');
                group.append('rect').attr('class','chart-hit'); group.append('rect').attr('class','word-chart-bar'); group.append('text').attr('class','word-chart-label'); group.append('text').attr('class','word-chart-count'); return group;
            }).attr('transform',function (_,index) { return 'translate(0,'+(top+index*step)+')'; }).attr('aria-pressed',function (row) { return row.key===scope.selected ? 'true':'false'; }).classed('is-selected',function (row) { return row.key===scope.selected; });
            groups.select('.chart-hit').attr('width',width).attr('height',step-2).attr('fill','transparent');
            groups.select('.word-chart-bar').attr('x',left).attr('y',10).attr('height',24).attr('rx',4).attr('width',function (row) { return x(row.count); });
            groups.select('.word-chart-label').attr('x',width-8).attr('y',27).attr('text-anchor','end').text(function (row) { return row.key; });
            groups.select('.word-chart-count').attr('x',left-8).attr('y',27).attr('text-anchor','end').text(function (row) { return row.count; });
            surface.activate(groups,function (row) { return row.key+': '+row.count+' تكراراً في '+row.verseIds.length+' آية'; },function (row) { scope.onSelect({word:row}); });
            surface.svg.selectAll('.chart-empty').data(rows.length ? [] : [null]).join('text').attr('class','chart-empty').attr('x',width/2).attr('y',30).attr('text-anchor','middle').text('لا توجد كلمات بهذه التصفية');
        }
        scope.$watchCollection('rows',draw); scope.$watch('selected',draw);
    }};
});

myApp.directive('quranLetterChart', function (QuranChartSurface) {
    return {restrict:'A',scope:{rows:'<',selected:'<',onSelect:'&'},link:function (scope,element) {
        var surface=QuranChartSurface(element,scope,'توزيع الحروف؛ اضغط على قطاع أو اسم لعرض تفاصيله',draw);
        var legend=surface.host.append('div').attr('class','stats-donut-legend');
        function draw() {
            if (!surface) return;
            var rows=QuranStatisticsCharts.letterSlices(scope.rows || [],8), total=d3.sum(rows,function (row) { return row.count; });
            var colors=d3.scaleOrdinal().domain(rows.map(function (row) { return row.key; })).range(d3.schemeTableau10);
            surface.svg.attr('viewBox','0 0 360 300'); surface.hide();
            var chart=surface.svg.selectAll('.letter-donut').data([null]).join('g').attr('class','letter-donut').attr('transform','translate(180,150)');
            var pie=d3.pie().sort(null).value(function (row) { return row.count; })(rows), arc=d3.arc().innerRadius(83).outerRadius(136).padAngle(.015);
            var slices=chart.selectAll('.letter-slice').data(pie,function (slice) { return slice.data.key; }).join('path').attr('class','letter-slice').attr('d',arc).attr('fill',function (slice) { return colors(slice.data.key); }).attr('aria-pressed',function (slice) { return slice.data.key===scope.selected ? 'true':'false'; }).classed('is-selected',function (slice) { return slice.data.key===scope.selected; });
            function label(row) { return row.label+': '+row.count+' حرفاً، '+(total ? 100*row.count/total : 0).toFixed(1)+'٪'; }
            surface.activate(slices,function (slice) { return label(slice.data); },function (slice) { scope.onSelect({letter:slice.data.key}); });
            var selected=rows.find(function (row) { return row.key===scope.selected; });
            // A letter selected from the complete grid may belong to the combined sector.
            if (!selected && scope.selected) selected=(scope.rows || []).map(function (row) { return {key:row.letter,label:row.letter,count:row.count}; }).find(function (row) { return row.key===scope.selected; });
            chart.selectAll('.donut-number').data([null]).join('text').attr('class','donut-number').attr('text-anchor','middle').attr('y',-1).text(selected ? selected.count : total);
            chart.selectAll('.donut-caption').data([null]).join('text').attr('class','donut-caption').attr('text-anchor','middle').attr('y',30).text(selected ? selected.label : 'مجموع الحروف');
            var buttons=legend.selectAll('button').data(rows,function (row) { return row.key; }).join(function (enter) { var button=enter.append('button').attr('type','button'); button.append('span').attr('class','donut-swatch').attr('aria-hidden','true'); button.append('span').attr('class','donut-label'); return button; }).attr('aria-pressed',function (row) { return row.key===scope.selected ? 'true':'false'; });
            buttons.select('.donut-swatch').style('background',function (row) { return colors(row.key); });
            buttons.select('.donut-label').text(label);
            buttons.on('click.chart',function (event,row) { scope.$evalAsync(function () { scope.onSelect({letter:row.key}); }); });
        }
        scope.$watchCollection('rows',draw); scope.$watch('selected',draw);
    }};
});

myApp.directive('quranVerseChart', function (QuranChartSurface) {
    return {restrict:'A',scope:{verses:'<',metric:'<',start:'<',end:'<',selected:'<',onSelect:'&',onRange:'&'},link:function (scope,element) {
        var destroyed=false; scope.$on('$destroy',function () { destroyed=true; });
        var surface=QuranChartSurface(element,scope,'أطوال الآيات مع نطاق قابل للتحديد؛ استخدم السحب في الرسم السفلي أو حقول النطاق',draw);
        function draw() {
            if (!surface) return;
            var verses=scope.verses || []; if (!verses.length) return;
            var bounds=QuranStatisticsCharts.range(verses,scope.start,scope.end), data=verses.filter(function (verse) { return verse.verse_id>=bounds[0] && verse.verse_id<=bounds[1]; });
            var metric=scope.metric==='letters' ? 'letterCount':'wordCount';
            var width=surface.width(), left=45, right=18, inner=width-left-right, focusTop=25, focusHeight=210, overviewTop=300, overviewHeight=56;
            surface.svg.attr('viewBox','0 0 '+width+' 394'); surface.hide();
            function domain(a,b) { return a===b ? [a-.5,b+.5] : [a,b]; }
            var x=d3.scaleLinear().domain(domain(bounds[0],bounds[1])).range([0,inner]);
            var fullX=d3.scaleLinear().domain(domain(verses[0].verse_id,verses[verses.length-1].verse_id)).range([0,inner]);
            var y=d3.scaleLinear().domain([0,d3.max(data,function (verse) { return verse[metric]; }) || 1]).nice().range([focusHeight,0]);
            var fullY=d3.scaleLinear().domain([0,d3.max(verses,function (verse) { return verse[metric]; }) || 1]).range([overviewHeight,0]);
            var focus=surface.svg.selectAll('.verse-focus').data([null]).join('g').attr('class','verse-focus').attr('transform','translate('+left+','+focusTop+')');
            function ticks(items) { return items.filter(function (_,index) { return index===0 || index===items.length-1 || index%Math.max(1,Math.ceil(items.length/6))===0; }).map(function (verse) { return verse.verse_id; }); }
            focus.selectAll('.verse-y-axis').data([null]).join('g').attr('class','verse-y-axis').call(d3.axisLeft(y).ticks(Math.min(5,y.domain()[1])).tickSize(-inner).tickFormat(d3.format('d')));
            focus.selectAll('.verse-x-axis').data([null]).join('g').attr('class','verse-x-axis').attr('transform','translate(0,'+focusHeight+')').call(d3.axisBottom(x).tickValues(ticks(data)).tickFormat(d3.format('d')).tickSizeOuter(0));
            focus.selectAll('.verse-area').data([data]).join('path').attr('class','verse-area').attr('d',d3.area().x(function (verse) { return x(verse.verse_id); }).y0(focusHeight).y1(function (verse) { return y(verse[metric]); }));
            focus.selectAll('.verse-line').data([data]).join('path').attr('class','verse-line').attr('d',d3.line().x(function (verse) { return x(verse.verse_id); }).y(function (verse) { return y(verse[metric]); }));
            function label(verse) { return 'الآية '+verse.verse_id+': '+verse.wordCount+' كلمة، '+verse.letterCount+' حرفاً'; }
            var hit=focus.selectAll('.verse-chart-hit').data([null]).join('rect').attr('class','verse-chart-hit').attr('width',inner).attr('height',focusHeight).attr('fill','transparent');
            function nearest(event) { return QuranStatisticsCharts.nearest(data,x.invert(d3.pointer(event,focus.node())[0])); }
            hit.on('pointermove.chart',function (event) { surface.show(event,label(nearest(event))); }).on('pointerleave.chart',surface.hide).on('click.chart',function (event) { var verse=nearest(event); scope.$evalAsync(function () { scope.onSelect({verse:verse}); }); });
            var points=focus.selectAll('.verse-chart-point').data(data,function (verse) { return verse.verse_id; }).join(function (enter) { var group=enter.append('g').attr('class','verse-chart-point'); group.append('circle').attr('class','point-hit').attr('r',9).attr('fill','transparent'); group.append('circle').attr('class','point-visible'); return group; }).attr('id',function (verse) { return 'stats-bar-'+verse.verse_id; }).attr('transform',function (verse) { return 'translate('+x(verse.verse_id)+','+y(verse[metric])+')'; }).attr('aria-pressed',function (verse) { return verse.verse_id===scope.selected ? 'true':'false'; }).classed('is-selected',function (verse) { return verse.verse_id===scope.selected; });
            points.select('.point-visible').attr('r',function (verse) { return verse.verse_id===scope.selected ? 6 : data.length>70 ? 2.5 : 4; });
            surface.activate(points,label,function (verse,event) { scope.onSelect({verse:event.type==='click' && event.detail!==0 ? nearest(event):verse}); });
            points.on('pointerenter.chart pointermove.chart',function (event) { surface.show(event,label(nearest(event))); });
            surface.svg.selectAll('.focus-axis-label').data([null]).join('text').attr('class','focus-axis-label').attr('x',left).attr('y',15).text('عدد '+(scope.metric==='letters' ? 'الحروف':'الكلمات'));
            surface.svg.selectAll('.overview-caption').data([null]).join('text').attr('class','overview-caption').attr('x',width/2).attr('y',282).attr('text-anchor','middle').text('كل الآيات — اسحب لتحديد النطاق');
            var overview=surface.svg.selectAll('.verse-overview').data([null]).join('g').attr('class','verse-overview').attr('transform','translate('+left+','+overviewTop+')');
            overview.selectAll('.overview-area').data([verses]).join('path').attr('class','overview-area').attr('d',d3.area().x(function (verse) { return fullX(verse.verse_id); }).y0(overviewHeight).y1(function (verse) { return fullY(verse[metric]); }));
            overview.selectAll('.overview-axis').data([null]).join('g').attr('class','overview-axis').attr('transform','translate(0,'+overviewHeight+')').call(d3.axisBottom(fullX).tickValues(ticks(verses)).tickFormat(d3.format('d')).tickSizeOuter(0));
            var brush=d3.brushX().extent([[0,0],[inner,overviewHeight]]).touchable(true).on('end',function (event) {
                if (destroyed || !event.sourceEvent) return; // Ignore programmatic moves when the view or viewport changes.
                var range=event.selection ? QuranStatisticsCharts.range(verses,fullX.invert(event.selection[0]),fullX.invert(event.selection[1])) : [verses[0].verse_id,verses[verses.length-1].verse_id];
                scope.$evalAsync(function () { scope.onRange({start:range[0],end:range[1]}); });
            });
            var brushGroup=overview.selectAll('.verse-brush').data([null]).join('g').attr('class','verse-brush').call(brush);
            var fullRange=bounds[0]===verses[0].verse_id && bounds[1]===verses[verses.length-1].verse_id;
            brushGroup.call(brush.move,fullRange ? null : bounds[0]===bounds[1] ? [Math.max(0,fullX(bounds[0])-2),Math.min(inner,fullX(bounds[1])+2)] : [fullX(bounds[0]),fullX(bounds[1])]);
            brushGroup.selectAll('.handle').attr('width',10);
            surface.svg.selectAll('.chart-x-label').data([null]).join('text').attr('class','chart-x-label').attr('x',width/2).attr('y',390).attr('text-anchor','middle').text('رقم الآية');
        }
        scope.$watchCollection('verses',draw); scope.$watchGroup(['metric','start','end','selected'],draw);
    }};
});
