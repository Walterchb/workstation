/* Análisis del tiempo y trazabilidad de objetivos. */
(() => {
  'use strict';
  const palette = ['#087F79', '#3067B6', '#8759A4', '#B16B32', '#BB5266', '#528048'];
  const neutral = '#687D89';
  const unassignedGoal = 'Sin objetivo general asignado';
  const filters = { period: 'day', anchor: '', lastDate: '', from: '', to: '', scope: 'Todos', goalId: '', grouping: 'goals' };
  const esc = value => window.JUI.esc(String(value ?? ''));
  const model = () => window.JModel;
  const label = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;
  const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : neutral;
  const dateAt = iso => new Date(`${iso}T12:00:00Z`);
  const isoDate = date => date.toISOString().slice(0, 10);
  const shortDate = (iso, withYear = false) => dateAt(iso).toLocaleDateString('es-PE', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
  }).replace(/\./g, '');
  const formatTime = n => model().duration(n);
  const mark = value => `<span class="ji-dot" aria-hidden="true" style="--ji-color:${color(value)}"></span>`;
  const empty = message => `<p class="ji-empty">${esc(message)}</p>`;

  function rangeFor(kind, anchor) {
    if (kind === 'day') return {from:anchor,to:anchor};
    const date = dateAt(anchor);
    if (kind === 'month') {
      date.setUTCDate(1);
      const from = isoDate(date);
      date.setUTCMonth(date.getUTCMonth() + 1, 0);
      return { from, to: isoDate(date) };
    }
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const from = model().shiftDate(anchor, -mondayOffset);
    return { from, to: model().shiftDate(from, 6) };
  }

  function getRange(fallback) {
    if (filters.period === 'custom' && filters.from && filters.to) return { from: filters.from, to: filters.to };
    return rangeFor(filters.period, filters.anchor || fallback);
  }

  function summarize(state, range) {
    const inRange = date => date >= range.from && date <= range.to;
    const tasks = state.tasks.filter(t => inRange(t.date)).slice().sort((a, b) => a.date.localeCompare(b.date));
    const goalsById = new Map(state.goals.map(g => [g.id, g]));
    const achieved = state.goals.filter(g => g.status === 'Alcanzado' && inRange(g.achievedOn));
    const byGoal = new Map();
    const byCategory = new Map(model().categoryList(state).map(c => [c.title, { title:c.title, color:c.color, minutes:0, count:0 }]));
    const byDay = new Map();
    let total = 0, planned = 0, fulfilled = 0, unplanned = 0, unplannedMinutes = 0;
    for (const t of tasks) {
      const minutes = model().minutes(t);
      total += minutes;
      const category = byCategory.get(t.category);
      category.minutes += minutes;
      category.count++;
      byDay.set(t.date, (byDay.get(t.date) || 0) + minutes);
      if (t.origin === 'Planificada') {
        planned++;
        if (t.done) fulfilled++;
      } else {
        unplanned++;
        unplannedMinutes += minutes;
      }
      const id = goalsById.has(t.goalId) ? t.goalId : '';
      const g = goalsById.get(id);
      if (!byGoal.has(id)) byGoal.set(id, { id, title: g?.title || unassignedGoal, color: g?.color || neutral, minutes: 0, count: 0, done: 0 });
      const row = byGoal.get(id);
      row.minutes += minutes;
      row.count++;
      if (t.done) row.done++;
    }
    const ranked = (a, b) => b.minutes - a.minutes || b.count - a.count || a.title.localeCompare(b.title, 'es');
    const goals = [...byGoal.values()].sort(ranked);
    const categories = [...byCategory.values()].sort(ranked);
    const evidence = tasks.filter(t => t.comment.trim()).reverse();
    return { range, tasks, total, planned, fulfilled, unplanned, unplannedMinutes, achieved, goals, categories, goalsById, byDay, evidence };
  }

  function series(summary) {
    const { from, to } = summary.range;
    const days = Math.round((dateAt(to) - dateAt(from)) / 86400000) + 1;
    const span = days <= 10 ? 1 : days <= 56 ? 7 : Math.ceil(days / 7);
    const count = Math.ceil(days / span);
    const values = Array.from({ length: count }, (_, index) => {
      const start = model().shiftDate(from, index * span);
      const end = index === count - 1 ? to : model().shiftDate(start, span - 1);
      let tick;
      if (span === 1) tick = dateAt(start).toLocaleDateString('es-PE', { weekday: 'short', timeZone: 'UTC' }).replace(/\./g, '');
      else if (start.slice(0, 7) === end.slice(0, 7)) tick = `${+start.slice(8)}–${+end.slice(8)}`;
      else tick = shortDate(start);
      return { start, end, tick, minutes: 0 };
    });
    for (const [date, minutes] of summary.byDay) {
      const offset = Math.round((dateAt(date) - dateAt(from)) / 86400000);
      values[Math.floor(offset / span)].minutes += minutes;
    }
    return values;
  }

  function rangeControls(ctx, range) {
    const controls = [['day', 'Diario'], ['week', 'Semanal'], ['month', 'Mensual'], ['custom', 'Rango']];
    const periodName = `${shortDate(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} – ${shortDate(range.to, true)}`;
    return `<section class="ji-controls" aria-label="Período del análisis"><div class="ji-switch" role="group" aria-label="Escala del período">${controls.map(([id, title]) => `<button type="button" data-period="${id}" aria-pressed="${filters.period === id}">${title}</button>`).join('')}</div>
      ${filters.period === 'custom' ? `<form class="ji-custom" data-range-form><label>Desde <input type="date" name="from" min="0001-01-01" max="9999-12-31" required value="${esc(range.from)}"></label><label>Hasta <input type="date" name="to" min="0001-01-01" max="9999-12-31" required value="${esc(range.to)}"></label><button class="btn ghost" type="submit">Aplicar</button></form>` : `<div class="ji-range"><button class="icon-btn" data-step="-1" aria-label="Período anterior">${ctx.icon('chevron-left', 17)}</button>${filters.period === 'day' ? `<label class="ji-date-control">${ctx.icon('calendar',16)}<input type="date" data-analysis-date aria-label="Fecha del análisis diario" min="0001-01-01" max="9999-12-31" value="${esc(range.from)}"></label>` : `<span>${ctx.icon('calendar',16)} ${esc(periodName)}</span>`}<button class="icon-btn" data-step="1" aria-label="Período siguiente">${ctx.icon('chevron-right', 17)}</button></div>`}</section>`;
  }

  function metric(title, value, note, icon, tone, ctx) {
    return `<article class="panel ji-metric"><div class="ji-metric-label"><span>${title}</span><i class="ji-tint ${tone}">${ctx.icon(icon, 17)}</i></div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
  }

  function chart(s) {
    const points = series(s);
    const peak = Math.max(...points.map(p => p.minutes), 1);
    return `<section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Evolución del tiempo</h2><p>${points[0].start === points[0].end ? 'Tramos cerrados por día (h:mm)' : 'Tramos cerrados por intervalo (h:mm)'}</p></div></header><div class="ji-chart-scroll"><div class="ji-bars" style="--ji-cols:${points.length}">${points.map(p => {
      const description = `${shortDate(p.start)}${p.start === p.end ? '' : ` al ${shortDate(p.end)}`}, ${formatTime(p.minutes)}`;
      return `<div class="ji-col" title="${esc(description)}" aria-label="${esc(description)}"><div class="ji-bar-track"><div class="ji-bar" style="height:${Math.round(p.minutes / peak * 100)}%;${p.minutes ? '' : 'opacity:0'}"></div></div><small>${esc(p.tick)}</small><b>${p.minutes ? Math.floor(p.minutes / 60) + ':' + String(p.minutes % 60).padStart(2, '0') : '—'}</b></div>`;
    }).join('')}</div></div></section>`;
  }

  function dayChart(s) {
    const hours=Array(24).fill(0);
    const minute=hhmm=>Number(hhmm.slice(0,2))*60+Number(hhmm.slice(3,5));
    for(const task of s.tasks) for (const span of task.segments) {
      if(!span.end) continue;
      const start=minute(span.start),end=minute(span.end);
      for(let hour=Math.floor(start/60);hour<Math.ceil(end/60);hour++) {
        hours[hour]+=Math.min(end,(hour+1)*60)-Math.max(start,hour*60);
      }
    }
    const first=hours.findIndex(n=>n>0),last=hours.findLastIndex(n=>n>0);
    const bars=first<0 ? '' : hours.slice(first,last+1).map((minutes,index)=>{
      const hour=first+index,start=`${String(hour).padStart(2,'0')}:00`,end=`${String(hour+1).padStart(2,'0')}:00`;
      return `<div class="ji-col" aria-label="${start} a ${end}, ${minutes} minutos" title="${start}–${end} · ${minutes} min"><div class="ji-bar-track"><div class="ji-bar" style="height:${100*minutes/60}%"></div></div><small>${start}</small><b>${minutes} min</b></div>`;
    }).join('');
    return `<section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Tiempo por hora</h2><p>Minutos registrados dentro de cada hora de la jornada</p></div></header>${bars ? `<div class="ji-chart-scroll"><div class="ji-bars ji-hour-bars" style="--ji-cols:${last-first+1}">${bars}</div></div>` : empty('Los tramos aparecerán cuando registres una hora de cierre.')}</section>`;
  }

  function composition(s) {
    const plannedMinutes = s.total - s.unplannedMinutes;
    const pct = s.total ? Math.round(plannedMinutes / s.total * 100) : 0;
    const rows = [[true, 'Planificado', plannedMinutes, s.planned], [false, 'Imprevisto', s.unplannedMinutes, s.unplanned]];
    return `<section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Planificado e imprevisto</h2><p>Distribución del tiempo registrado</p></div></header><div class="ji-composition"><div class="ji-total"><strong>${esc(formatTime(s.total))}</strong><small>en el período</small></div><div class="ji-split ${s.total ? '' : 'is-empty'}" aria-hidden="true"><span style="width:${pct}%"></span></div><div class="ji-breakdown">${rows.map(([planned, title, minutes, count]) => `<div><span>${mark(planned ? '#087F79' : '#B56A30')}${title}<small>${label(count, 'actividad', 'actividades')}</small></span><b>${esc(formatTime(minutes))} <small>${s.total ? Math.round(minutes / s.total * 100) + '%' : '—'}</small></b></div>`).join('')}</div></div></section>`;
  }

  function distributionTable(s, grouping, interactive) {
    const rows = grouping === 'categories' ? s.categories : s.goals;
    if (!s.tasks.length) return empty('Aún no hay actividades en este período.');
    return `<div class="ji-table-scroll"><table class="ji-table"><thead><tr><th>${grouping === 'categories' ? 'Categoría' : 'Objetivo general'}</th><th>Actividades</th><th>Tiempo</th><th>Participación</th></tr></thead><tbody>${rows.map(g => `<tr><td><span class="ji-table-title">${mark(g.color)}${interactive && g.id ? `<button class="ji-textbtn" data-show-goal="${esc(g.id)}">${esc(g.title)}</button>` : esc(g.title)}</span></td><td>${g.count}</td><td><b>${esc(formatTime(g.minutes))}</b></td><td><span class="ji-share"><span class="ji-meter"><i style="width:${s.total ? 100 * g.minutes / s.total : 0}%;background:${color(g.color)}"></i></span>${s.total ? Math.round(g.minutes / s.total * 100) + '%' : '—'}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function achievedList(goals) {
    return `<ul class="ji-achieved">${goals.map(g => `<li>${mark(g.color)}<div><b>${esc(g.title)}</b><p>${esc(g.result)}</p><small>${esc(shortDate(g.achievedOn, true))}</small></div></li>`).join('')}</ul>`;
  }

  function evidenceList(s, list, interactive) {
    return `<ol class="ji-evidence">${list.map(t => `<li><time datetime="${esc(t.date)}">${esc(shortDate(t.date))}</time><div>${interactive ? `<button class="ji-textbtn" data-task="${esc(t.id)}">${esc(t.title)}</button>` : `<b>${esc(t.title)}</b>`}<p>${esc(t.comment)}</p><small>${esc(s.goalsById.get(t.goalId)?.title || unassignedGoal)}</small></div></li>`).join('')}</ol>`;
  }

  function analysisView(el, ctx) {
    if (filters.lastDate && filters.lastDate !== ctx.date) filters.anchor = ctx.date;
    filters.lastDate=ctx.date;
    const range = getRange(ctx.date);
    const s = summarize(ctx.state, range);
    const pct = s.planned ? `${Math.round(100 * s.fulfilled / s.planned)}%` : '—';
    el.innerHTML = `<div class="ji-page"><header class="ji-head"><div><h1>Análisis</h1><p>Tiempo invertido, avances y resultados por período.</p></div><div class="ji-actions"><button class="btn ghost" data-csv>${ctx.icon('download', 16)} Exportar CSV</button><button class="btn primary" data-print>${ctx.icon('file-text', 16)} Informe gerencial</button></div></header>
      ${rangeControls(ctx, range)}<div class="ji-kpis${s.achieved.length ? '' : ' compact'}">${metric('Tiempo registrado', formatTime(s.total), 'Suma de tramos cerrados', 'clock', 'teal', ctx)}${metric('Cumplimiento del plan', pct, s.planned ? `${s.fulfilled} de ${s.planned} planificadas cumplidas` : 'Sin actividades planificadas', 'check-circle', 'blue', ctx)}${metric('Trabajo imprevisto', formatTime(s.unplannedMinutes), label(s.unplanned, 'actividad imprevista', 'actividades imprevistas'), 'layers', 'amber', ctx)}${s.achieved.length ? metric('Objetivos alcanzados', String(s.achieved.length), 'Con resultado fechado en el período', 'flag', 'violet', ctx) : ''}</div>
      <div class="ji-charts">${filters.period === 'day' ? dayChart(s) : chart(s)}${composition(s)}</div>
      <section class="panel ji-panel" data-distribution><header class="ji-panel-head ji-distribution-head"><div><h2 data-distribution-title>Tiempo por ${filters.grouping === 'categories' ? 'categoría' : 'objetivo general'}</h2><p>Participación sobre el tiempo total del período</p></div><div class="ji-switch" role="group" aria-label="Agrupar el tiempo por">${[['goals','Por objetivo general'],['categories','Por categoría']].map(([id, text]) => `<button type="button" data-grouping="${id}" aria-pressed="${filters.grouping === id}" aria-controls="ji-distribution-table">${text}</button>`).join('')}</div></header><div id="ji-distribution-table">${distributionTable(s, filters.grouping, true)}</div></section>
      <div class="ji-bottom"><section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Evidencias de avance</h2><p>Comentarios registrados en las actividades</p></div></header>${s.evidence.length ? `${evidenceList(s, s.evidence.slice(0,5), true)}${s.evidence.length > 5 ? `<details class="ji-more"><summary>Ver ${label(s.evidence.length - 5, 'evidencia más', 'evidencias más')}</summary>${evidenceList(s, s.evidence.slice(5), true)}</details>` : ''}` : empty('Los comentarios de tus actividades aparecerán aquí.')}</section>${s.achieved.length ? `<section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Resultados alcanzados</h2><p>Resultados que confirmaste en tus objetivos generales</p></div></header>${achievedList(s.achieved)}</section>` : ''}</div></div>`;
    el.querySelectorAll('[data-period]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.period === 'custom' && (!filters.from || filters.period !== 'custom')) Object.assign(filters, range);
      filters.period = btn.dataset.period;
      ctx.render();
    }));
    el.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
      const step = Number(btn.dataset.step);
      if (filters.period === 'month') {
        const day = dateAt(range.from);
        day.setUTCMonth(day.getUTCMonth() + step);
        filters.anchor = isoDate(day);
      } else filters.anchor = model().shiftDate(range.from, (filters.period==='day' ? 1 : 7) * step);
      ctx.render();
    }));
    const dayInput=el.querySelector('[data-analysis-date]');
    dayInput?.addEventListener('change',()=>{
      if (!dayInput.value || !dayInput.checkValidity()) {dayInput.value=range.from;return;}
      filters.anchor=dayInput.value;ctx.render();el.querySelector('[data-analysis-date]')?.focus();
    });
    const form = el.querySelector('[data-range-form]');
    if (form) {
      form.addEventListener('input', () => form.elements.to.setCustomValidity(''));
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (form.elements.to.value < form.elements.from.value) {
          form.elements.to.setCustomValidity('El fin debe ser igual o posterior al inicio.');
          form.reportValidity();
          return;
        }
        filters.from = form.elements.from.value;
        filters.to = form.elements.to.value;
        filters.anchor = filters.from;
        ctx.render();
      });
    }
    el.querySelector('[data-print]').addEventListener('click', () => showReport(managementReport(s,filters.period),ctx));
    el.querySelector('[data-csv]').addEventListener('click', () => exportCSV(s));
    el.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => ctx.openTask(b.dataset.task)));
    const panel = el.querySelector('[data-distribution]');
    panel.addEventListener('click', event => {
      const toggle = event.target.closest('[data-grouping]');
      if (toggle) {
        filters.grouping = toggle.dataset.grouping;
        for (const button of panel.querySelectorAll('[data-grouping]')) button.setAttribute('aria-pressed', String(button === toggle));
        panel.querySelector('[data-distribution-title]').textContent = filters.grouping === 'categories' ? 'Tiempo por categoría' : 'Tiempo por objetivo general';
        panel.querySelector('#ji-distribution-table').innerHTML = distributionTable(s, filters.grouping, true);
        return;
      }
      const goal = event.target.closest('[data-show-goal]');
      if (goal) { filters.scope = 'Todos'; filters.goalId = goal.dataset.showGoal; ctx.navigate('goals'); }
    });
  }

  // Un movimiento por tramo. Una tarea sin horas también conserva una fila.
  function csvText(s) {
    const rows = [['ID actividad', 'Fecha', 'Actividad', 'Objetivo específico', 'Objetivo general', 'Categoría', 'Prioridad', 'Origen', 'Estado', 'Se cumplió', 'Tramo', 'Inicio', 'Fin', 'Minutos cerrados', 'Conteo de actividades', 'Evidencia registrada']];
    for (const t of s.tasks) {
      const pieces = t.segments.length ? t.segments : [null];
      pieces.forEach((segment, index) => rows.push([t.id, t.date, t.title, t.context, s.goalsById.get(t.goalId)?.title || '', t.category, t.priority, t.origin, t.status, t.done ? 'Sí' : 'No', segment ? index + 1 : '', segment?.start || '', segment?.end || '', segment?.end ? model().minutes({ segments: [segment] }) : 0, index ? 0 : 1, t.comment]));
    }
    function cell(value) {
      const str = String(value ?? '');
      // Algunos lectores CSV evalúan fórmulas incluso en celdas entrecomilladas.
      const safe = /^[\uff1d\uff0b\uff0d\uff20=+@\-]/.test(str.trimStart()) || /^[\t\n\r]/.test(str) ? `'${str}` : str;
      return `"${safe.replaceAll('"','""')}"`;
    }
    return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
  }

  function exportCSV(s) {
    const url = URL.createObjectURL(new Blob([csvText(s)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `Jornada_${s.range.from}_${s.range.to}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const reportTitles = { day: 'Informe diario de gestión', week: 'Informe semanal de gestión', month: 'Informe mensual de gestión', custom: 'Informe de gestión del período' };
  const periodWords = { day: 'la jornada', week: 'la semana', month: 'el mes', custom: 'el período' };
  const longDate = value => model().formatDate(value, {day:'numeric',month:'long',year:'numeric'});
  const pctTime = (minutes, sum) => sum ? `${Math.round(100 * minutes / sum)}%` : '—';

  function managementReport(s, period) {
    const daily = period === 'day';
    const dateText = daily ? longDate(s.range.from) : `${shortDate(s.range.from,true)} al ${shortDate(s.range.to,true)}`;
    const milestones = [...s.achieved].sort((a,b) => b.achievedOn.localeCompare(a.achievedOn) || a.title.localeCompare(b.title,'es'));
    const rankedGoals = s.goals.filter(g => g.id);
    const unassigned = s.goals.find(g => !g.id);
    if (unassigned) rankedGoals.push(unassigned);
    const goalName = g => g.id ? g.title : unassignedGoal;
    const leadingGoal = s.goals[0];
    const word = periodWords[period];
    const quotedTitle = title => {
      const line = title.trim().replace(/\s+/g, ' ');
      return `«${line.length <= 105 ? line : line.slice(0, 104) + '…'}»`;
    };
    let takeaway;
    if (milestones.length) {
      takeaway = milestones.length === 1
        ? `El ${shortDate(milestones[0].achievedOn)} se confirmó el resultado de ${quotedTitle(milestones[0].title)}.`
        : `Durante ${word} se confirmaron resultados en ${milestones.length} objetivos generales.`;
      if (s.tasks.length && s.total) takeaway += ` La agenda reúne ${label(s.tasks.length,'actividad','actividades')} y ${formatTime(s.total)} de trabajo registrado.`;
    } else if (s.total) {
      takeaway = leadingGoal.id
        ? `Se dedicaron ${formatTime(leadingGoal.minutes)} a ${quotedTitle(leadingGoal.title)}, el ${pctTime(leadingGoal.minutes,s.total)} del tiempo registrado durante ${word}.`
        : `Durante ${word} se registraron ${formatTime(s.total)}. Las actividades sin objetivo general asignado sumaron ${formatTime(leadingGoal.minutes)} (${pctTime(leadingGoal.minutes,s.total)}).`;
    } else if (s.tasks.length) {
      takeaway = `La agenda de ${word} reúne ${label(s.tasks.length,'actividad','actividades')}. El tiempo se contabiliza al cerrar los tramos de trabajo.`;
    } else {
      takeaway = `No hay actividades registradas durante ${word}.`;
    }

    const metrics = [
      {label:'Tiempo registrado',value:formatTime(s.total),note:label(s.tasks.length,'actividad en la agenda','actividades en la agenda')},
      {label:'Cumplimiento del plan',value:s.planned ? pctTime(s.fulfilled,s.planned) : '—',note:s.planned ? `${s.fulfilled} de ${s.planned} planificadas cumplidas` : 'Sin actividades planificadas'},
      {label:'Trabajo imprevisto',value:formatTime(s.unplannedMinutes),note:label(s.unplanned,'actividad imprevista','actividades imprevistas')}
    ];
    const withDate = (t,cells) => daily ? cells : [shortDate(t.date,true),...cells];
    const sections = [];
    const add = (title,subtitle,columns,widths,rows) => sections.push({title,subtitle,columns,widths,rows});
    if (milestones.length) {
      metrics.push({label:'Objetivos alcanzados',value:String(milestones.length),note:'Con resultado fechado en el período'});
      add('Resultados confirmados','Objetivos generales con resultado y fecha de cumplimiento registrados.',
        ['Fecha','Objetivo general','Resultado'],[.14,.31,.55],milestones.map(g => [shortDate(g.achievedOn,true),g.title,g.result]));
    }
    if (rankedGoals.length) add('Dedicación por objetivo general','Participación de cada objetivo general en el tiempo registrado.',
      ['Objetivo general','Tiempo','% del tiempo','Actividades'],[.48,.2,.17,.15], rankedGoals.map(g => [goalName(g),formatTime(g.minutes),pctTime(g.minutes,s.total),String(g.count)]));

    const priorityOrder = {Alta:0,Media:1,Baja:2};
    const open = s.tasks.filter(t => t.status !== 'Culminado').sort((a,b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.date.localeCompare(a.date));
    if (open.length) add('Prioridades de seguimiento','Hasta tres actividades abiertas, ordenadas por prioridad y fecha más reciente.',
      daily ? ['Prioridad','Actividad','Estado'] : ['Fecha','Prioridad','Actividad','Estado'],
      daily ? [.17,.6,.23] : [.14,.13,.53,.2], open.slice(0,3).map(t => withDate(t,[t.priority,t.title,t.status])));

    if (!daily && s.tasks.length) {
      const days = new Map();
      for (const t of s.tasks) {
        if (!days.has(t.date)) days.set(t.date,{time:0,planned:0,fulfilled:0,unplanned:0});
        const d = days.get(t.date), minutes = model().minutes(t);
        d.time += minutes;
        if (t.origin === 'Planificada') { d.planned++; if (t.done) d.fulfilled++; }
        else d.unplanned += minutes;
      }
      add('Balance por jornada','Fechas con actividades registradas.', ['Jornada','Tiempo','Plan cumplido','Imprevistos'],[.33,.21,.25,.21],
        [...days].map(([date,d]) => [shortDate(date,true),formatTime(d.time),d.planned ? `${d.fulfilled} de ${d.planned}` : 'Sin planificadas',formatTime(d.unplanned)]));
    }
    const usedCategories = s.categories.filter(c => c.count);
    if (usedCategories.length && (!daily || usedCategories.length > 1)) add('Dedicación por categoría','Distribución del mismo tiempo por función.',
      ['Categoría','Tiempo','% del tiempo'],[.55,.25,.2], usedCategories.map(c => [c.title,formatTime(c.minutes),pctTime(c.minutes,s.total)]));
    const byGoal = new Map(rankedGoals.map(g => [g.id,[]]));
    const recorded = value => value && value.trim() ? value : '—';
    for (const t of s.tasks) {
      const id = s.goalsById.has(t.goalId) ? t.goalId : '';
      byGoal.get(id).push(withDate(t,[recorded(t.title),recorded(t.context),recorded(t.comment)]));
    }
    for (const g of rankedGoals) {
      const rows = byGoal.get(g.id);
      sections.push({
        group:'activities', groupTitle:'Actividades por objetivo general', goalId:g.id,
        title:goalName(g), subtitle:label(rows.length,'actividad','actividades'),
        columns:daily ? ['Actividad','Objetivo específico','Evidencia registrada'] : ['Fecha','Actividad','Objetivo específico','Evidencia registrada'],
        widths:daily ? [.25,.33,.42] : [.13,.21,.30,.36],
        rows
      });
    }

    const footnote = 'El tiempo registrado suma los tramos con hora de cierre. El cumplimiento del plan cuenta las actividades planificadas marcadas en «¿Se hizo?».'
      + (s.tasks.length ? ' En el registro de actividades, una raya indica un campo sin completar.' : '');
    return {period,from:s.range.from,to:s.range.to,title:reportTitles[period],periodLabel:dateText,takeaway,metrics,sections,footnote,
      filename:`Informe_${({day:'diario',week:'semanal',month:'mensual',custom:'de_gestion'})[period]}_${s.range.from}${s.range.from===s.range.to?'':'_'+s.range.to}.pdf`};
  }

  function reportSection(section, index, sections) {
    const grouped = section.group === 'activities';
    const groupHeading = grouped && sections[index - 1]?.group !== section.group
      ? `<h3 class="ji-paper-group-title">${esc(section.groupTitle)}</h3>` : '';
    const heading = grouped ? 'h4' : 'h3';
    return `${groupHeading}<section class="ji-paper-section${grouped ? ' ji-paper-activity-group' : ''}"><${heading}>${esc(section.title)}</${heading}><p>${esc(section.subtitle)}</p>
      <div class="ji-paper-scroll"><table><colgroup>${section.widths.map(w => `<col style="width:${Math.round(w*100)}%">`).join('')}</colgroup>
      <thead><tr>${section.columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${section.rows.map(row => `<tr>${row.map((cell,i) => `<td${grouped ? ` data-label="${esc(section.columns[i])}"` : ''}>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }

  function reportHTML(report) {
    return `<article class="ji-paper"><header class="ji-paper-head"><h2 id="ji-report-title">${esc(report.title)}</h2><p>${esc(report.periodLabel)}</p></header>
      <p class="ji-paper-lead">${esc(report.takeaway)}</p>
      <dl class="ji-paper-metrics" style="--ji-metric-count:${report.metrics.length}">${report.metrics.map(m=>`<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}</dd><small>${esc(m.note)}</small></div>`).join('')}</dl>
      ${report.sections.map(reportSection).join('')}
      <footer class="ji-paper-note">${esc(report.footnote)}</footer></article>`;
  }

  function showReport(report, ctx) {
    const dialog=document.createElement('dialog');
    dialog.className='ji-report-dialog'; dialog.setAttribute('aria-labelledby','ji-report-title');
    const trigger=document.activeElement;
    dialog.innerHTML=`<div class="ji-report-tools"><span>Vista previa del informe</span><div><button type="button" class="btn ghost" data-print-paper>${ctx.icon('printer',16)} Imprimir</button><button type="button" class="btn primary" data-pdf>${ctx.icon('download',16)} Descargar PDF</button><button type="button" class="icon-btn" aria-label="Cerrar informe" data-close-report>${ctx.icon('x',18)}</button></div></div><div class="ji-report-message" role="status" hidden></div><div class="ji-paper-wrap">${reportHTML(report)}</div>`;
    document.body.append(dialog);
    const download=dialog.querySelector('[data-pdf]'),message=dialog.querySelector('.ji-report-message');
    download.addEventListener('click',async()=>{
      if(download.disabled) return;
      download.disabled=true; download.setAttribute('aria-busy','true'); message.hidden=true;
      try { await window.JReportPDF.download(report); }
      catch { message.textContent='No se pudo generar el PDF. Vuelve a intentarlo.'; message.hidden=false; }
      finally { download.disabled=false; download.removeAttribute('aria-busy'); }
    });
    dialog.querySelector('[data-print-paper]').addEventListener('click',()=>{
      document.body.classList.add('ji-printing');
      window.addEventListener('afterprint',()=>document.body.classList.remove('ji-printing'),{once:true});
      window.print();
    });
    dialog.querySelector('[data-close-report]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{document.body.classList.remove('ji-printing');dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
    dialog.showModal(); dialog.querySelector('[data-close-report]').focus();
  }

  function goalIconInk(background) {
    const linear = [1,3,5].map(start => {
      const channel = parseInt(background.slice(start,start + 2),16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance > 0.179 ? '#000000' : '#FFFFFF';
  }

  function goalCard(g, tasks, ctx) {
    const minutes = tasks.reduce((sum, t) => sum + model().minutes(t), 0);
    const accent = color(g.color);
    return `<button class="panel ji-goal-card" data-goal="${esc(g.id)}" style="--ji-accent:${accent};--ji-accent-ink:${goalIconInk(accent)}"><span class="ji-goal-cap"><i class="ji-goal-icon">${ctx.icon('target', 21)}</i><span class="ji-badge ${g.status === 'Alcanzado' ? 'is-achieved' : ''}">${esc(g.status)}</span></span><strong>${esc(g.title)}</strong>${g.description ? `<span class="ji-card-description">${esc(g.description)}</span>` : ''}<span class="ji-card-foot"><span>${ctx.icon('clock', 15)} ${esc(formatTime(minutes))}</span><span>${label(tasks.length, 'actividad', 'actividades')}</span></span></button>`;
  }

  function goalDetail(el, ctx, goal) {
    const tasks = ctx.state.tasks.filter(t => t.goalId === goal.id).slice().reverse().sort((a,b) => b.date.localeCompare(a.date));
    const minutes = tasks.reduce((sum, t) => sum + model().minutes(t), 0);
    const days = new Set(tasks.filter(t => model().minutes(t) > 0).map(t => t.date)).size;
    const groups = new Map();
    for (const t of tasks) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    el.innerHTML = `<div class="ji-page"><button class="ji-back" data-goals-back>${ctx.icon('chevron-left', 16)} Todos los objetivos generales</button><header class="ji-head ji-detail-head"><div><span class="ji-goal-tag">${mark(goal.color)}Objetivo general · ${esc(goal.status)}</span><h1>${esc(goal.title)}</h1>${goal.description ? `<p>${esc(goal.description)}</p>` : ''}</div><div class="ji-actions"><button class="btn ghost" data-edit-goal>${ctx.icon('pencil', 16)} Editar objetivo general</button><button class="btn primary" data-create-task>${ctx.icon('plus', 16)} Actividad vinculada</button></div></header><div class="ji-kpis compact">${metric('Tiempo invertido',formatTime(minutes),'Acumulado de tramos cerrados','clock','teal',ctx)}${metric('Actividades vinculadas',String(tasks.length),label(tasks.filter(t => t.done).length,'avance cumplido','avances cumplidos'),'layers','blue',ctx)}${metric('Días con dedicación',String(days),'Fechas con tiempo registrado','calendar','violet',ctx)}</div>
    ${goal.status === 'Alcanzado' || goal.result ? `<section class="panel ji-panel ji-outcome"><div class="ji-panel-head"><div><h2>${goal.status === 'Alcanzado' ? 'Resultado alcanzado' : 'Avance del objetivo general'}</h2>${goal.achievedOn ? `<p>${esc(shortDate(goal.achievedOn, true))}</p>` : ''}</div></div><p>${esc(goal.result)}</p></section>` : ''}
    <section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Historial del objetivo general</h2><p>Actividades y evidencias de todos los días vinculados</p></div></header>${groups.size ? `<div class="ji-history">${[...groups].map(([date, entries]) => `<section><h3>${esc(shortDate(date, true))}</h3><ul>${entries.map(t => `<li><div class="ji-history-row"><button class="ji-textbtn" data-task="${esc(t.id)}">${esc(t.title)}</button><b>${esc(formatTime(model().minutes(t)))}</b></div>${t.comment ? `<p>${esc(t.comment)}</p>` : ''}<small>${esc(t.status)} · ${t.done ? 'Avance cumplido' : 'Avance sin marcar'}</small></li>`).join('')}</ul></section>`).join('')}</div>` : empty('Vincula la primera actividad para iniciar el historial de este objetivo general.')}</section></div>`;
    el.querySelector('[data-goals-back]').addEventListener('click', () => { filters.goalId = ''; ctx.render(); });
    el.querySelector('[data-edit-goal]').addEventListener('click', () => goalForm(goal, ctx));
    el.querySelector('[data-create-task]').addEventListener('click', () => ctx.openTask(null, { goalId: goal.id }));
    el.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => ctx.openTask(b.dataset.task)));
  }

  function goalsView(el, ctx) {
    const selected = ctx.state.goals.find(g => g.id === filters.goalId);
    if (selected) return goalDetail(el, ctx, selected);
    filters.goalId = '';
    const goals = ctx.state.goals.filter(g => filters.scope === 'Todos' || filters.scope === g.status);
    const byGoal = new Map();
    for (const t of ctx.state.tasks) {
      if (!t.goalId) continue;
      if (!byGoal.has(t.goalId)) byGoal.set(t.goalId, []);
      byGoal.get(t.goalId).push(t);
    }
    el.innerHTML = `<div class="ji-page"><header class="ji-head"><div><h1>Objetivos generales</h1><p>Reúne los avances diarios que contribuyen a un mismo resultado.</p></div><button class="btn primary" data-new-goal>${ctx.icon('plus', 17)} Nuevo objetivo general</button></header><div class="ji-controls"><div class="ji-switch" aria-label="Estado del objetivo general">${[['Todos','Todos'],['En curso','En curso'],['Alcanzado','Alcanzados']].map(([key, text]) => `<button data-scope="${key}" aria-pressed="${filters.scope === key}">${text}</button>`).join('')}</div><span class="ji-count">${label(goals.length,'objetivo general','objetivos generales')}</span></div>${goals.length ? `<div class="ji-goals-grid">${goals.map(g => goalCard(g, byGoal.get(g.id) || [], ctx)).join('')}</div>` : `<section class="panel ji-no-goals"><i>${ctx.icon('target', 30)}</i><h2>${ctx.state.goals.length ? 'Sin objetivos generales en este estado' : '¿Qué resultado quieres conseguir?'}</h2><p>${ctx.state.goals.length ? 'Puedes consultar los demás estados con el filtro.' : 'Crea un objetivo general para reunir las actividades diarias que contribuyen a él.'}</p>${!ctx.state.goals.length ? '<button class="btn ghost" data-first-goal>Crear un objetivo general</button>' : ''}</section>`}</div>`;
    el.querySelectorAll('[data-new-goal],[data-first-goal]').forEach(b => b.addEventListener('click', () => goalForm(null, ctx)));
    el.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', () => { filters.goalId = b.dataset.goal; ctx.render(); }));
    el.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { filters.scope = b.dataset.scope; ctx.render(); }));
  }

  function goalForm(goal, ctx) {
    if (document.getElementById('ji-goal-form')) return;
    const dlg = document.createElement('dialog');
    dlg.id = 'ji-goal-form'; dlg.className = 'ji-dialog'; dlg.setAttribute('aria-labelledby', 'ji-form-title');
    const isReached = goal?.status === 'Alcanzado';
    const currentColor = color(goal?.color || palette[ctx.state.goals.length % palette.length]);
    const toneNames = ['Verde azulado', 'Azul', 'Violeta', 'Ocre', 'Rosado', 'Verde'];
    const colorControls = `<fieldset class="ji-colors"><legend>Color del objetivo general</legend>
      <div class="ji-color-row">
        <div class="ji-swatches">${palette.map((value,i) => `<button type="button" class="ji-swatch" data-swatch="${value}" style="--ji-color:${value}" aria-label="${toneNames[i]}" title="${toneNames[i]}" aria-pressed="${value.toUpperCase() === currentColor.toUpperCase()}"></button>`).join('')}</div>
        <label class="ji-color-field">Personalizar<input type="color" name="color" aria-label="Color personalizado" value="${currentColor}"></label>
        <label class="ji-color-field">Hexadecimal<input type="text" name="colorHex" aria-label="Código hexadecimal" required maxlength="7" size="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="#RRGGBB" value="${currentColor.toUpperCase()}"></label>
      </div></fieldset>`;
    dlg.innerHTML = `<form class="ji-form"><header><h2 id="ji-form-title">${goal ? 'Editar objetivo general' : 'Nuevo objetivo general'}</h2><button type="button" class="icon-btn" data-cancel aria-label="Cerrar">${ctx.icon('x',18)}</button></header><div class="ji-form-body"><label>Nombre del objetivo general<input name="title" required autofocus value="${esc(goal?.title || '')}"></label><label>Descripción <small>(opcional)</small><textarea rows="2" name="description" placeholder="¿Qué esperas conseguir?">${esc(goal?.description || '')}</textarea></label>${colorControls}<div class="ji-form-row"><label>Estado<select name="status"><option${!isReached ? ' selected' : ''}>En curso</option><option${isReached ? ' selected' : ''}>Alcanzado</option></select></label><label data-date-wrap>Fecha del resultado<input type="date" name="date" max="${esc(model().today())}" value="${esc(goal?.achievedOn || model().today())}"></label></div><label><span data-result-label></span><textarea rows="3" name="result" placeholder="Describe el hito o entregable concreto">${esc(goal?.result || '')}</textarea></label><p class="ji-form-error" role="alert" hidden></p><div class="ji-delete-prompt" hidden><strong>¿Eliminar este objetivo general?</strong><p>Las actividades conservarán sus horas y comentarios y pasarán a figurar sin objetivo general asignado.</p><div><button type="button" class="btn ghost" data-keep>Conservar</button><button type="button" class="btn ji-danger" data-remove>Confirmar eliminación</button></div></div></div><footer>${goal ? `<button class="ji-delete" type="button" data-ask-remove>${ctx.icon('trash',16)} Eliminar</button>` : ''}<span></span><button class="btn ghost" type="button" data-cancel>Cancelar</button><button class="btn primary" type="submit">Guardar objetivo general</button></footer></form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form'), fields = form.elements;
    const message = dlg.querySelector('.ji-form-error');
    let busy = false;
    const showError = txt => { message.textContent = txt; message.hidden = false; };
    const close = () => dlg.close();
    const colorInput = fields.color;
    const hexInput = fields.colorHex;
    const swatches = [...dlg.querySelectorAll('[data-swatch]')];
    const colorError = 'Escribe un código hexadecimal de seis dígitos, como #327C9B.';
    const readHex = () => {
      const typed = hexInput.value.trim().replace(/^#/, '');
      return /^[a-f0-9]{6}$/i.test(typed) ? '#' + typed.toUpperCase() : '';
    };
    function syncColor(value) {
      if (value) colorInput.value = value;
      for (const swatch of swatches) {
        swatch.setAttribute('aria-pressed', String(swatch.dataset.swatch === value));
      }
      hexInput.setCustomValidity(value ? '' : colorError);
      if (value) hexInput.removeAttribute('aria-invalid');
    }
    function chooseColor(value) {
      hexInput.value = value.toUpperCase();
      syncColor(hexInput.value);
    }
    for (const swatch of swatches) swatch.addEventListener('click', () => chooseColor(swatch.dataset.swatch));
    for (const event of ['input','change']) colorInput.addEventListener(event, () => chooseColor(colorInput.value));
    hexInput.addEventListener('input', () => syncColor(readHex()));
    hexInput.addEventListener('change', () => {
      const selected = readHex();
      if (selected) chooseColor(selected);
      else syncColor('');
    });
    hexInput.addEventListener('invalid', () => hexInput.setAttribute('aria-invalid','true'));
    const updateStatus = () => {
      const reached = fields.status.value === 'Alcanzado';
      dlg.querySelector('[data-date-wrap]').hidden = !reached;
      fields.date.required = reached; fields.date.disabled = !reached; fields.result.required = reached;
      dlg.querySelector('[data-result-label]').textContent = reached ? 'Resultado alcanzado' : 'Avance del objetivo general (opcional)';
    };
    const setBusy = locked => {
      busy = locked;
      dlg.querySelectorAll('button').forEach(b => b.disabled = locked);
      form.setAttribute('aria-busy', String(locked));
    };
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
    dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dlg.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', close));
    fields.status.addEventListener('change', updateStatus); updateStatus();
    dlg.querySelector('[data-ask-remove]')?.addEventListener('click', () => {
      dlg.querySelector('.ji-delete-prompt').hidden = false;
      dlg.querySelector('[data-keep]').focus();
    });
    dlg.querySelector('[data-keep]').addEventListener('click', () => { dlg.querySelector('.ji-delete-prompt').hidden = true; dlg.querySelector('[data-ask-remove]').focus(); });
    dlg.querySelector('[data-remove]').addEventListener('click', async () => {
      if (busy || !goal) return;
      setBusy(true);
      try {
        const ok = await ctx.mutate(state => {
          state.goals = state.goals.filter(g => g.id !== goal.id);
          for (const t of state.tasks) if (t.goalId === goal.id) t.goalId = '';
        });
        if (ok) { filters.goalId = ''; close(); ctx.render(); ctx.toast('Objetivo eliminado.'); }
        else showError('No se pudo eliminar el objetivo. Puedes volver a intentarlo.');
      } catch (e) { showError(e.message || 'No se pudo eliminar el objetivo.'); }
      finally { setBusy(false); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return;
      const selectedColor = readHex();
      if (!selectedColor) {
        syncColor('');
        hexInput.reportValidity();
        hexInput.focus();
        return;
      }
      const reached = fields.status.value === 'Alcanzado';
      const entry = { id: goal?.id || model().id(), title: fields.title.value.trim(), description: fields.description.value.trim(), color: selectedColor === goal?.color.toUpperCase() ? goal.color : selectedColor, status: fields.status.value, result: fields.result.value.trim(), achievedOn: reached ? fields.date.value : '' };
      if (!entry.title || (reached && !entry.result)) { showError(!entry.title ? 'Escribe el nombre del objetivo.' : 'Describe el resultado alcanzado.'); return; }
      setBusy(true); message.hidden = true;
      try {
        const ok = await ctx.mutate(state => {
          if (goal) {
            const existing = state.goals.find(g => g.id === goal.id);
            if (!existing) throw new Error('Este objetivo general ya no existe.');
            Object.assign(existing, entry);
          } else state.goals.push(entry);
        });
        if (ok) { filters.goalId = entry.id; filters.scope = 'Todos'; close(); ctx.render(); ctx.toast(goal ? 'Objetivo actualizado.' : 'Objetivo creado.'); }
        else showError('No se pudo guardar el objetivo. Tu edición sigue aquí.');
      } catch (e) { showError(e.message || 'No se pudo guardar el objetivo.'); }
      finally { setBusy(false); }
    });
    dlg.showModal();
  }

  window.JInsights = {
    makeReport(state, range, period) { return managementReport(summarize(state,range),period); },
    render(el, ctx, view) { if (view === 'goals') goalsView(el, ctx); else analysisView(el, ctx); },
    reset() { Object.assign(filters, { period: 'day', anchor: '', lastDate: '', from: '', to: '', scope: 'Todos', goalId: '', grouping: 'goals' }); }
  };
})();
