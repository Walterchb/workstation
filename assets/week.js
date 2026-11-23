/* Semana laboral personal. Un único eje horario para todos los días visibles. */
(() => {
  'use strict';
  const model = window.JModel;
  const {esc} = window.JUI;
  const dayStart = 8 * 60;
  const baseHour = 42;
  const maxHour = 96;
  const viewPositions = new Map();
  const shortIndexes = new Map();
  const expandedPlans = new Set();

  function range(date) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const start = model.shiftDate(date,-((weekday+6)%7));
    return {start,end:model.shiftDate(start,6)};
  }

  function days(state,date) {
    const {start} = range(date);
    const occupied = new Set(state.tasks.map(task=>task.date));
    return Array.from({length:7},(_,i)=>model.shiftDate(start,i)).filter((day,i)=>i<5 || occupied.has(day));
  }

  function hour(value) {
    return String(Math.floor(value/60)).padStart(2,'0') + ':' + String(value%60).padStart(2,'0');
  }

  function totalTime(minutes) {
    return Math.floor(minutes/60) + ':' + String(minutes%60).padStart(2,'0');
  }

  function civilLabel(date) {
    return model.formatDate(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  }

  function segmentTime(entry) {
    const range = entry.segment.start + ' – ' + (entry.segment.end || (entry.live ? 'ahora' : 'sin cierre'));
    if (!entry.segment.end && !entry.live) return {range,duration:'',description:range};
    const minutes = entry.end - entry.start;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const parts = [];
    if (hours) parts.push(hours + 'h');
    if (remainder || !hours) parts.push(remainder + 'm');
    const description = range + (entry.live ? ', tiempo transcurrido ' : ', duración ') + model.duration(minutes);
    return {range,duration:parts.join(' '),description};
  }

  function timeMarkup(time) {
    return esc(time.range) + (time.duration ? '<span class="jw-time-separator"> | </span><strong>' + time.duration + '</strong>' : '');
  }

  function entryName(entry,day,time) {
    const pieces = [entry.task.title, civilLabel(day), time.description];
    if (entry.count>1) pieces.push('tramo ' + entry.index + ' de ' + entry.count);
    if (entry.goal) pieces.push(entry.goal.title);
    return pieces.join(' · ');
  }

  function identity(id,seg,place) {
    return 'data-week-detail data-id="' + esc(id) + '" data-segment="' + seg + '" data-place="' + place + '"';
  }

  function gather(ctx) {
    const week = range(ctx.date);
    const visible = days(ctx.state,ctx.date);
    const goals = new Map(ctx.state.goals.map(g=>[g.id,g]));
    const grouped = new Map(visible.map(day=>[day,[]]));
    for (const task of ctx.visibleWeekTasks || ctx.state.tasks) grouped.get(task.date)?.push(task);
    const columns = visible.map(date=>{
      const tasks = grouped.get(date);
      return {
        date,tasks,
        entries:ctx.weekEntries(tasks,goals,date),
        unplaced:tasks.filter(t=>!t.segments.length),
        minutes:tasks.reduce((sum,t)=>sum+model.minutes(t),0)
      };
    });
    const entries = columns.flatMap(day=>day.entries);
    const low = entries.reduce((n,e)=>Math.min(n,Math.floor(e.start/60)*60),dayStart);
    const high = entries.reduce((n,e)=>Math.max(n,Math.ceil(Math.max(e.start+1,e.end)/60)*60),dayStart+60);
    return {week,columns,goals,low,high};
  }

  function totals(columns) {
    const tasks = columns.flatMap(d=>d.tasks);
    const minutes = columns.reduce((acc,d)=>acc+d.minutes,0);
    const planned = tasks.filter(t=>t.origin==='Planificada');
    const completed = planned.filter(t=>t.done).length;
    const planText = planned.length ? Math.round(completed*100/planned.length) + '%' : '—';
    return '<dl class="jw-totals">' +
      '<div><dt>Tiempo registrado</dt><dd>' + esc(model.duration(minutes)) + '</dd></div>' +
      '<div><dt>Actividades</dt><dd>' + tasks.length + '</dd></div>' +
      '<div><dt>Cumplimiento del plan</dt><dd title="' + completed + ' de ' + planned.length + ' planificadas">' +
      planText + '</dd></div></dl>';
  }

  function dayHead(day,ctx) {
    const now = day.date===model.today();
    const full = civilLabel(day.date);
    const meta = totalTime(day.minutes) + ' h · ' + day.tasks.length + (day.tasks.length===1 ? ' actividad' : ' actividades');
    return '<button class="jw-day-head" type="button" data-week-day="' + day.date + '" ' +
      'aria-label="Abrir jornada del ' + esc(full) + '" title="' + esc(full + ' · ' + meta) + '"' +
      (now ? ' aria-current="date"' : '') + (day.date===ctx.date ? ' data-selected' : '') + '>' +
      '<span>' + esc(model.formatDate(day.date,{weekday:'long'})) + ' <time datetime="' + day.date + '">' +
      esc(model.formatDate(day.date,{day:'2-digit',month:'2-digit'})) + '</time></span><small>' + esc(meta) + '</small></button>';
  }

  function planRows(columns,goals,ctx,weekStart) {
    const count = Math.max(...columns.map(day=>day.unplaced.length));
    const visible = 4;
    const rows = Array.from({length:count},(_,i)=>{
      const cells = columns.map(day=>{
        const task = day.unplaced[i];
        const button = task ? '<button type="button" class="jw-plan-task" ' + identity(task.id,0,'week') +
          ' style="' + ctx.eventPaint(goals.get(task.goalId)) + '" aria-label="' +
          esc(task.title + ' · Sin horario · ' + civilLabel(day.date)) + '" title="' + esc(task.title) + '">' +
          '<span>' + esc(task.title) + '</span></button>' : '';
        return '<div class="jw-plan-cell" data-date="' + day.date + '">' + button + '</div>';
      }).join('');
      return '<div class="jw-plan-strip"><span class="jw-corner jw-plan-caption">Sin horario</span>' + cells + '</div>';
    });
    if (rows.length<=visible) return rows.join('');
    const remaining = columns.reduce((n,day)=>n+Math.max(day.unplaced.length-visible,0),0);
    const show = 'Mostrar ' + remaining + (remaining===1 ? ' actividad más' : ' actividades más');
    return rows.slice(0,visible).join('') + '<details class="jw-plan-more"' +
      (expandedPlans.has(weekStart) ? ' open' : '') + '><summary><span class="jw-more-closed">' +
      show + '</span><span class="jw-more-open">Mostrar menos</span></summary>' + rows.slice(visible).join('') + '</details>';
  }

  function slot(entry,day,scale,ctx) {
    const length = entry.end - entry.start;
    const open = !entry.segment.end;
    const time = segmentTime(entry);
    const label = entryName(entry,day,time);
    const y = scale.at(entry.start);
    const position = 'top:' + y + 'px;height:' + (scale.at(entry.end)-y) + 'px;';
    return '<li class="jw-slot' + (length===0 ? ' jw-point' : '') + (open ? ' jw-open' : '') + '" data-id="' +
      esc(entry.task.id) + '" data-start-minute="' + entry.start + '" data-end-minute="' + entry.end + '" style="' +
      position + ctx.eventPaint(entry.goal) + '">' +
      '<button class="jw-event" type="button" ' + identity(entry.task.id,entry.index,'week') + ' title="' +
      esc(label) + '" aria-label="' + esc(label) + '"' + (length===0 ? ' tabindex="-1" aria-hidden="true"' : '') + '>' +
      '<span class="jw-slot-heading"><span class="jw-name">' + esc(entry.task.title) + '</span>' +
      (entry.count>1 ? '<small class="jw-part">' + entry.index + '/' + entry.count + '</small>' : '') +
      (time.duration ? '<small class="jw-short-duration">' + time.duration + '</small>' : '') + '</span>' +
      '<span class="jw-range">' + timeMarkup(time) + '</span>' +
      (entry.task.context ? '<span class="jw-context">' + esc(entry.task.context) + '</span>' : '') +
      '</button></li>';
  }

  function briefIndex(columns,start,scale) {
    const items = columns.flatMap(day=>day.entries.filter(e=>e.end-e.start<15 || scale.at(e.end)-scale.at(e.start)<31).map(e=>[e,day.date]));
    if (!items.length) return '';
    return '<details class="jw-short-index"' + (shortIndexes.get(start) ? ' open' : '') +
      '><summary>Tramos breves (' + items.length + ')</summary><ul>' +
      items.map(([entry,date])=>{
        const time = segmentTime(entry);
        return '<li><button type="button" ' + identity(entry.task.id,entry.index,'week-index') +
          ' aria-label="' + esc(entryName(entry,date,time)) + '"><time datetime="' + date + '">' +
          esc(model.formatDate(date,{day:'2-digit',month:'2-digit'})) + '</time> · ' + timeMarkup(time) +
          ' · ' + esc(entry.task.title) + '</button></li>';
      }).join('') + '</ul></details>';
  }

  function legend(columns,goals,ctx) {
    const seen = new Set(columns.flatMap(day=>day.tasks.map(t=>t.goalId)));
    if (!seen.size) return '';
    return '<div class="jw-legend" aria-label="Objetivos de la semana">' +
      [...seen].map(id=>'<span><i aria-hidden="true" style="' + ctx.eventPaint(goals.get(id)) + '"></i>' +
        esc(goals.get(id)?.title || 'Sin objetivo') + '</span>').join('') + '</div>';
  }

  function render(mount,ctx) {
    const {week,columns,goals,low,high} = gather(ctx);
    const entries = columns.flatMap(day=>day.entries);
    const content = entries.map(({task})=>{
      const lines = Math.min(2,Math.max(1,Math.ceil(task.title.length/19)));
      const contextLines = Math.min(2,Math.ceil(task.context.length/23));
      return {height:lines*14 + 18 + contextLines*15};
    });
    const scale = ctx.weekScale(low,high,entries,content,{baseHeight:baseHour,maxHourHeight:maxHour});
    const ticks = [];
    const lines = [];
    for (let minute=low;minute<=high;minute+=60) {
      const y = scale.at(minute);
      ticks.push('<span class="jw-tick' + (minute===high ? ' jw-last' : '') + '" data-minute="' + minute +
        '" style="top:' + y + 'px">' + hour(minute) + '</span>');
      if (minute<high) lines.push('<i style="top:' + y + 'px"></i>');
    }
    const noItems = !columns.some(day=>day.tasks.length);
    mount.innerHTML = '<section class="jw-week" aria-label="Calendario laboral semanal" data-week-start="' + week.start +
      '" data-week-end="' + week.end + '" style="--jw-days:' + columns.length + ';--jw-height:' + scale.total + 'px">' +
      '<div class="jw-overview">' + totals(columns) + briefIndex(columns,week.start,scale) + '</div>' +
      (noItems ? '<p class="jw-empty">' + (ctx.filtered ? 'Ninguna actividad coincide con los filtros de esta semana.' : 'Esta semana aún no tiene actividades.') + '</p>' : '') +
      '<div class="jw-frame"><div class="jw-head-scroll"><div class="jw-day-heads"><span class="jw-corner">Hora</span>' +
        columns.map(day=>dayHead(day,ctx)).join('') + '</div></div>' +
      '<div class="jw-scroller" tabindex="0" role="region" aria-label="Calendario de lunes a ' +
      esc(model.formatDate(columns.at(-1).date,{weekday:'long'})) + ', con desplazamiento horizontal"><div class="jw-sheet">' +
        '<div class="jw-board" data-start-minute="' + low + '" data-end-minute="' + high +
        '" data-hour-heights="' + scale.heights.join(',') + '" data-pixels-per-hour="' + baseHour +
        '"><div class="jw-rules" aria-hidden="true">' + lines.join('') + '</div><div class="jw-ruler" aria-hidden="true">' + ticks.join('') + '</div>' +
        columns.map(day=>'<div class="jw-lane" data-date="' + day.date + '"><ol aria-label="Tramos, ' + esc(civilLabel(day.date)) + '">' +
          day.entries.map(entry=>slot(entry,day.date,scale,ctx)).join('') + '</ol></div>').join('') +
      '</div>' + planRows(columns,goals,ctx,week.start) + '</div></div></div>' + legend(columns,goals,ctx) + '</section>';

    const scroller = mount.querySelector('.jw-scroller');
    const headings = mount.querySelector('.jw-head-scroll');
    const left = viewPositions.get(week.start) || 0;
    headings.scrollLeft = scroller.scrollLeft = left;
    function align(source,destination) {
      const offset = source.scrollLeft;
      if (destination.scrollLeft !== offset) destination.scrollLeft = offset;
      viewPositions.set(week.start,offset);
    }
    scroller.onscroll = () => align(scroller,headings);
    headings.onscroll = () => align(headings,scroller);
    const shortIndex = mount.querySelector('.jw-short-index');
    if (shortIndex) shortIndex.ontoggle = () => shortIndexes.set(week.start,shortIndex.open);
    const more = mount.querySelector('.jw-plan-more');
    if (more) more.ontoggle = () => more.open ? expandedPlans.add(week.start) : expandedPlans.delete(week.start);
    mount.onclick = event=>{
      const button = event.target.closest('button');
      if (!button || !mount.contains(button)) return;
      if (button.hasAttribute('data-week-day')) {
        event.stopPropagation(); ctx.openDay(button.dataset.weekDay);
      } else if (button.hasAttribute('data-week-detail')) {
        event.stopPropagation(); ctx.openEntry(button.dataset.id,Number(button.dataset.segment),button);
      }
    };
  }

  window.JWeek = {range,days,render};
})();
