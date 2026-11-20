/* Análisis del tiempo y trazabilidad de objetivos. */
(() => {
  'use strict';
  const palette = ['#087F79', '#3067B6', '#8759A4', '#B16B32', '#BB5266', '#528048'];
  const neutral = '#687D89';
  const filters = { period: 'week', anchor: '', from: '', to: '', scope: 'Todos', goalId: '', grouping: 'goals' };
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
    const byCategory = new Map(model().categories.map((title, index) => [title, { title, color: palette[index] || neutral, minutes: 0, count: 0 }]));
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
      if (!byGoal.has(id)) byGoal.set(id, { id, title: g?.title || 'Sin objetivo asignado', color: g?.color || neutral, minutes: 0, count: 0, done: 0 });
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
    const controls = [['week', 'Semana'], ['month', 'Mes'], ['custom', 'Rango']];
    const periodName = `${shortDate(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} – ${shortDate(range.to, true)}`;
    return `<section class="ji-controls" aria-label="Período del análisis"><div class="ji-switch" aria-label="Escala del período">${controls.map(([id, title]) => `<button type="button" data-period="${id}" aria-pressed="${filters.period === id}">${title}</button>`).join('')}</div>
      ${filters.period === 'custom' ? `<form class="ji-custom" data-range-form><label>Desde <input type="date" name="from" required value="${esc(range.from)}"></label><label>Hasta <input type="date" name="to" required value="${esc(range.to)}"></label><button class="btn ghost" type="submit">Aplicar</button></form>` : `<div class="ji-range"><button class="icon-btn" data-step="-1" aria-label="Período anterior">${ctx.icon('chevron-left', 17)}</button><span>${ctx.icon('calendar', 16)} ${esc(periodName)}</span><button class="icon-btn" data-step="1" aria-label="Período siguiente">${ctx.icon('chevron-right', 17)}</button></div>`}</section>`;
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

  function composition(s) {
    const plannedMinutes = s.total - s.unplannedMinutes;
    const pct = s.total ? Math.round(plannedMinutes / s.total * 100) : 0;
    const rows = [[true, 'Planificado', plannedMinutes, s.planned], [false, 'Imprevisto', s.unplannedMinutes, s.unplanned]];
    return `<section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Planificado e imprevisto</h2><p>Distribución del tiempo registrado</p></div></header><div class="ji-composition"><div class="ji-total"><strong>${esc(formatTime(s.total))}</strong><small>en el período</small></div><div class="ji-split ${s.total ? '' : 'is-empty'}" aria-hidden="true"><span style="width:${pct}%"></span></div><div class="ji-breakdown">${rows.map(([planned, title, minutes, count]) => `<div><span>${mark(planned ? '#087F79' : '#B56A30')}${title}<small>${label(count, 'actividad', 'actividades')}</small></span><b>${esc(formatTime(minutes))} <small>${s.total ? Math.round(minutes / s.total * 100) + '%' : '—'}</small></b></div>`).join('')}</div></div></section>`;
  }

  function distributionTable(s, grouping, interactive) {
    const rows = grouping === 'categories' ? s.categories : s.goals;
    if (!s.tasks.length) return empty('Aún no hay actividades en este período.');
    return `<div class="ji-table-scroll"><table class="ji-table"><thead><tr><th>${grouping === 'categories' ? 'Categoría' : 'Objetivo'}</th><th>Actividades</th><th>Tiempo</th><th>Participación</th></tr></thead><tbody>${rows.map(g => `<tr><td><span class="ji-table-title">${mark(g.color)}${interactive && g.id ? `<button class="ji-textbtn" data-show-goal="${esc(g.id)}">${esc(g.title)}</button>` : esc(g.title)}</span></td><td>${g.count}</td><td><b>${esc(formatTime(g.minutes))}</b></td><td><span class="ji-share"><span class="ji-meter"><i style="width:${s.total ? 100 * g.minutes / s.total : 0}%;background:${color(g.color)}"></i></span>${s.total ? Math.round(g.minutes / s.total * 100) + '%' : '—'}</span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function achievedList(goals) {
    return goals.length ? `<ul class="ji-achieved">${goals.map(g => `<li>${mark(g.color)}<div><b>${esc(g.title)}</b><p>${esc(g.result)}</p><small>${esc(shortDate(g.achievedOn, true))}</small></div></li>`).join('')}</ul>` : empty('Aún no hay objetivos marcados como alcanzados en este período.');
  }

  function evidenceList(s, list, interactive) {
    return `<ol class="ji-evidence">${list.map(t => `<li><time datetime="${esc(t.date)}">${esc(shortDate(t.date))}</time><div>${interactive ? `<button class="ji-textbtn" data-task="${esc(t.id)}">${esc(t.title)}</button>` : `<b>${esc(t.title)}</b>`}<p>${esc(t.comment)}</p><small>${esc(s.goalsById.get(t.goalId)?.title || 'Sin objetivo asignado')}</small></div></li>`).join('')}</ol>`;
  }

  function analysisView(el, ctx) {
    const range = getRange(ctx.date);
    const s = summarize(ctx.state, range);
    const pct = s.planned ? `${Math.round(100 * s.fulfilled / s.planned)}%` : '—';
    el.innerHTML = `<div class="ji-page"><header class="ji-head"><div><h1>Análisis</h1><p>Tiempo invertido, avances y resultados por período.</p></div><div class="ji-actions"><button class="btn ghost" data-csv>${ctx.icon('download', 16)} Exportar CSV</button><button class="btn primary" data-print>${ctx.icon('printer', 16)} Informe gerencial</button></div></header>
      ${rangeControls(ctx, range)}<div class="ji-kpis">${metric('Tiempo registrado', formatTime(s.total), 'Suma de tramos cerrados', 'clock', 'teal', ctx)}${metric('Cumplimiento del plan', pct, `${s.fulfilled} de ${s.planned} planificadas cumplidas`, 'check-circle', 'blue', ctx)}${metric('Trabajo imprevisto', formatTime(s.unplannedMinutes), label(s.unplanned, 'actividad imprevista', 'actividades imprevistas'), 'layers', 'amber', ctx)}${metric('Objetivos alcanzados', String(s.achieved.length), 'Con resultado fechado en el período', 'flag', 'violet', ctx)}</div>
      <div class="ji-charts">${chart(s)}${composition(s)}</div>
      <section class="panel ji-panel" data-distribution><header class="ji-panel-head ji-distribution-head"><div><h2 data-distribution-title>Tiempo por ${filters.grouping === 'categories' ? 'categoría' : 'objetivo'}</h2><p>Participación sobre el tiempo total del período</p></div><div class="ji-switch" role="group" aria-label="Agrupar el tiempo por">${[['goals','Por objetivo'],['categories','Por categoría']].map(([id, text]) => `<button type="button" data-grouping="${id}" aria-pressed="${filters.grouping === id}" aria-controls="ji-distribution-table">${text}</button>`).join('')}</div></header><div id="ji-distribution-table">${distributionTable(s, filters.grouping, true)}</div></section>
      <div class="ji-bottom"><section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Evidencias de avance</h2><p>Comentarios registrados en las actividades</p></div></header>${s.evidence.length ? `${evidenceList(s, s.evidence.slice(0,5), true)}${s.evidence.length > 5 ? `<details class="ji-more"><summary>Ver ${label(s.evidence.length - 5, 'evidencia más', 'evidencias más')}</summary>${evidenceList(s, s.evidence.slice(5), true)}</details>` : ''}` : empty('Los comentarios de tus actividades aparecerán aquí.')}</section><section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Resultados alcanzados</h2><p>Resultados que confirmaste en tus objetivos</p></div></header>${achievedList(s.achieved)}</section></div></div>`;
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
      } else filters.anchor = model().shiftDate(range.from, 7 * step);
      ctx.render();
    }));
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
    el.querySelector('[data-print]').addEventListener('click', () => printReport(s));
    el.querySelector('[data-csv]').addEventListener('click', () => exportCSV(s));
    el.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => ctx.openTask(b.dataset.task)));
    const panel = el.querySelector('[data-distribution]');
    panel.addEventListener('click', event => {
      const toggle = event.target.closest('[data-grouping]');
      if (toggle) {
        filters.grouping = toggle.dataset.grouping;
        for (const button of panel.querySelectorAll('[data-grouping]')) button.setAttribute('aria-pressed', String(button === toggle));
        panel.querySelector('[data-distribution-title]').textContent = filters.grouping === 'categories' ? 'Tiempo por categoría' : 'Tiempo por objetivo';
        panel.querySelector('#ji-distribution-table').innerHTML = distributionTable(s, filters.grouping, true);
        return;
      }
      const goal = event.target.closest('[data-show-goal]');
      if (goal) { filters.scope = 'Todos'; filters.goalId = goal.dataset.showGoal; ctx.navigate('goals'); }
    });
  }

  // Un movimiento por tramo. Una tarea sin horas también conserva una fila.
  function csvText(s) {
    const rows = [['ID actividad', 'Fecha', 'Actividad', 'Contexto', 'Objetivo', 'Categoría', 'Prioridad', 'Origen', 'Estado', 'Se cumplió', 'Tramo', 'Inicio', 'Fin', 'Minutos cerrados', 'Conteo de actividades', 'Comentarios']];
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

  function printReport(s) {
    document.getElementById('ji-print')?.remove();
    const sheet = document.createElement('article');
    sheet.id = 'ji-print';
    sheet.innerHTML = `<header class="ji-report-head"><b>Jornada personal</b><h1>Informe de gestión</h1><p>${esc(shortDate(s.range.from, true))} al ${esc(shortDate(s.range.to, true))}</p></header><div class="ji-report-kpis"><div><small>Tiempo registrado</small><b>${esc(formatTime(s.total))}</b></div><div><small>Plan cumplido</small><b>${s.fulfilled} de ${s.planned}</b></div><div><small>Tiempo imprevisto</small><b>${esc(formatTime(s.unplannedMinutes))}</b></div><div><small>Objetivos alcanzados</small><b>${s.achieved.length}</b></div></div><h2>Inversión por objetivo</h2>${distributionTable(s, 'goals', false)}${s.tasks.length ? `<h2>Distribución por categoría</h2><dl class="ji-report-categories">${s.categories.filter(c => c.count).map(c => `<div><dt>${esc(c.title)}</dt><dd>${esc(formatTime(c.minutes))}${s.total ? ` · ${Math.round(c.minutes * 100 / s.total)}%` : ''}</dd></div>`).join('')}</dl>` : ''}<h2>Resultados alcanzados</h2>${achievedList(s.achieved)}<h2>Evidencias de avance</h2>${s.evidence.length ? evidenceList(s, s.evidence, false) : empty('Sin comentarios registrados en el período.')}<footer>El tiempo corresponde a tramos cerrados. El cumplimiento se calcula sobre las actividades planificadas. Cada resultado corresponde a un objetivo declarado alcanzado dentro del período.</footer>`;
    document.body.append(sheet);
    document.body.classList.add('ji-printing');
    window.addEventListener('afterprint', () => { sheet.remove(); document.body.classList.remove('ji-printing'); }, { once: true });
    window.print();
  }

  function goalCard(g, tasks, ctx) {
    const minutes = tasks.reduce((sum, t) => sum + model().minutes(t), 0);
    return `<button class="panel ji-goal-card" data-goal="${esc(g.id)}" style="--ji-accent:${color(g.color)}"><span class="ji-goal-cap"><i class="ji-goal-icon">${ctx.icon('target', 21)}</i><span class="ji-badge ${g.status === 'Alcanzado' ? 'is-achieved' : ''}">${esc(g.status)}</span></span><strong>${esc(g.title)}</strong>${g.description ? `<span class="ji-card-description">${esc(g.description)}</span>` : ''}<span class="ji-card-foot"><span>${ctx.icon('clock', 15)} ${esc(formatTime(minutes))}</span><span>${label(tasks.length, 'actividad', 'actividades')}</span></span></button>`;
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
    el.innerHTML = `<div class="ji-page"><button class="ji-back" data-goals-back>${ctx.icon('chevron-left', 16)} Todos los objetivos</button><header class="ji-head ji-detail-head"><div><span class="ji-goal-tag">${mark(goal.color)}Objetivo · ${esc(goal.status)}</span><h1>${esc(goal.title)}</h1>${goal.description ? `<p>${esc(goal.description)}</p>` : ''}</div><div class="ji-actions"><button class="btn ghost" data-edit-goal>${ctx.icon('pencil', 16)} Editar objetivo</button><button class="btn primary" data-create-task>${ctx.icon('plus', 16)} Actividad vinculada</button></div></header><div class="ji-kpis compact">${metric('Tiempo invertido',formatTime(minutes),'Acumulado de tramos cerrados','clock','teal',ctx)}${metric('Actividades vinculadas',String(tasks.length),label(tasks.filter(t => t.done).length,'avance cumplido','avances cumplidos'),'layers','blue',ctx)}${metric('Días con dedicación',String(days),'Fechas con tiempo registrado','calendar','violet',ctx)}</div>
    ${goal.status === 'Alcanzado' || goal.result ? `<section class="panel ji-panel ji-outcome"><div class="ji-panel-head"><div><h2>${goal.status === 'Alcanzado' ? 'Resultado alcanzado' : 'Avance del objetivo'}</h2>${goal.achievedOn ? `<p>${esc(shortDate(goal.achievedOn, true))}</p>` : ''}</div></div><p>${esc(goal.result)}</p></section>` : ''}
    <section class="panel ji-panel"><header class="ji-panel-head"><div><h2>Historial del objetivo</h2><p>Actividades y evidencias de todos los días vinculados</p></div></header>${groups.size ? `<div class="ji-history">${[...groups].map(([date, entries]) => `<section><h3>${esc(shortDate(date, true))}</h3><ul>${entries.map(t => `<li><div class="ji-history-row"><button class="ji-textbtn" data-task="${esc(t.id)}">${esc(t.title)}</button><b>${esc(formatTime(model().minutes(t)))}</b></div>${t.comment ? `<p>${esc(t.comment)}</p>` : ''}<small>${esc(t.status)} · ${t.done ? 'Avance cumplido' : 'Avance sin marcar'}</small></li>`).join('')}</ul></section>`).join('')}</div>` : empty('Vincula la primera actividad para iniciar el historial de este objetivo.')}</section></div>`;
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
    el.innerHTML = `<div class="ji-page"><header class="ji-head"><div><h1>Objetivos</h1><p>Reúne los avances diarios que contribuyen a un mismo resultado.</p></div><button class="btn primary" data-new-goal>${ctx.icon('plus', 17)} Nuevo objetivo</button></header><div class="ji-controls"><div class="ji-switch" aria-label="Estado del objetivo">${[['Todos','Todos'],['En curso','En curso'],['Alcanzado','Alcanzados']].map(([key, text]) => `<button data-scope="${key}" aria-pressed="${filters.scope === key}">${text}</button>`).join('')}</div><span class="ji-count">${label(goals.length,'objetivo','objetivos')}</span></div>${goals.length ? `<div class="ji-goals-grid">${goals.map(g => goalCard(g, byGoal.get(g.id) || [], ctx)).join('')}</div>` : `<section class="panel ji-no-goals"><i>${ctx.icon('target', 30)}</i><h2>${ctx.state.goals.length ? 'Sin objetivos en este estado' : '¿Qué resultado quieres conseguir?'}</h2><p>${ctx.state.goals.length ? 'Puedes consultar los demás estados con el filtro.' : 'Crea tu primer objetivo, por ejemplo, completar una emisión de bonos. Después podrás vincular las actividades de cada día.'}</p>${!ctx.state.goals.length ? '<button class="btn ghost" data-first-goal>Crear un objetivo</button>' : ''}</section>`}</div>`;
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
    const swatches = palette.includes(currentColor) ? palette : [...palette, currentColor];
    const toneNames = ['Verde azulado', 'Azul', 'Violeta', 'Ocre', 'Rosado', 'Verde', 'Personalizado'];
    dlg.innerHTML = `<form class="ji-form"><header><h2 id="ji-form-title">${goal ? 'Editar objetivo' : 'Nuevo objetivo'}</h2><button type="button" class="icon-btn" data-cancel aria-label="Cerrar">${ctx.icon('x',18)}</button></header><div class="ji-form-body"><label>Objetivo<input name="title" required autofocus placeholder="Ej. Emitir bonos corporativos" value="${esc(goal?.title || '')}"></label><label>Descripción <small>(opcional)</small><textarea rows="2" name="description" placeholder="¿Qué esperas conseguir?">${esc(goal?.description || '')}</textarea></label><fieldset><legend>Color del objetivo</legend><div class="ji-swatches">${swatches.map((c, i) => `<label style="--ji-color:${c}" title="${toneNames[i]}"><input name="color" type="radio" value="${c}" aria-label="${toneNames[i]}" ${c === currentColor ? 'checked' : ''}><span></span></label>`).join('')}</div></fieldset><div class="ji-form-row"><label>Estado<select name="status"><option${!isReached ? ' selected' : ''}>En curso</option><option${isReached ? ' selected' : ''}>Alcanzado</option></select></label><label data-date-wrap>Fecha del resultado<input type="date" name="date" max="${esc(model().today())}" value="${esc(goal?.achievedOn || model().today())}"></label></div><label><span data-result-label></span><textarea rows="3" name="result" placeholder="Describe el hito o entregable concreto">${esc(goal?.result || '')}</textarea></label><p class="ji-form-error" role="alert" hidden></p><div class="ji-delete-prompt" hidden><strong>¿Eliminar este objetivo?</strong><p>Las actividades conservarán sus horas y comentarios y pasarán a figurar sin objetivo asignado.</p><div><button type="button" class="btn ghost" data-keep>Conservar</button><button type="button" class="btn ji-danger" data-remove>Confirmar eliminación</button></div></div></div><footer>${goal ? `<button class="ji-delete" type="button" data-ask-remove>${ctx.icon('trash',16)} Eliminar</button>` : ''}<span></span><button class="btn ghost" type="button" data-cancel>Cancelar</button><button class="btn primary" type="submit">Guardar objetivo</button></footer></form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form'), fields = form.elements;
    const message = dlg.querySelector('.ji-form-error');
    let busy = false;
    const showError = txt => { message.textContent = txt; message.hidden = false; };
    const close = () => dlg.close();
    const updateStatus = () => {
      const reached = fields.status.value === 'Alcanzado';
      dlg.querySelector('[data-date-wrap]').hidden = !reached;
      fields.date.required = reached; fields.date.disabled = !reached; fields.result.required = reached;
      dlg.querySelector('[data-result-label]').textContent = reached ? 'Resultado alcanzado' : 'Avance del objetivo (opcional)';
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
      const reached = fields.status.value === 'Alcanzado';
      const entry = { id: goal?.id || model().id(), title: fields.title.value.trim(), description: fields.description.value.trim(), color: fields.color.value, status: fields.status.value, result: fields.result.value.trim(), achievedOn: reached ? fields.date.value : '' };
      if (!entry.title || (reached && !entry.result)) { showError(!entry.title ? 'Escribe el nombre del objetivo.' : 'Describe el resultado alcanzado.'); return; }
      setBusy(true); message.hidden = true;
      try {
        const ok = await ctx.mutate(state => {
          if (goal) {
            const existing = state.goals.find(g => g.id === goal.id);
            if (!existing) throw new Error('Este objetivo ya no existe.');
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
    render(el, ctx, view) { if (view === 'goals') goalsView(el, ctx); else analysisView(el, ctx); },
    reset() { Object.assign(filters, { period: 'week', anchor: '', from: '', to: '', scope: 'Todos', goalId: '', grouping: 'goals' }); }
  };
})();
