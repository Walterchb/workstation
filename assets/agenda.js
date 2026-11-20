/* Vista de consulta. Los cambios se realizan en la hoja de actividades. */
(() => {
  "use strict";

  const model = window.JModel;
  const {esc} = window.JUI;
  const dayStart = 8 * 60;
  const noGoalColor = "#778a9a";

  function minuteOfDay(value) {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function hourLabel(value) {
    return String(Math.floor(value / 60)).padStart(2,"0") + ":" + String(value % 60).padStart(2,"0");
  }

  function accent(goal) {
    return /^#[a-f\d]{6}$/i.test(goal?.color) ? goal.color : noGoalColor;
  }

  function plural(n,one,many) {
    return n + " " + (n === 1 ? one : many);
  }

  function stats(tasks, ctx) {
    const planned = tasks.filter(task => task.origin === "Planificada");
    const complete = planned.filter(task => task.done).length;
    const unexpected = tasks.filter(task => task.origin === "Imprevista");
    const closed = tasks.reduce((n,task) => n + task.segments.filter(segment => segment.end).length,0);
    const sumMinutes = rows => rows.reduce((n,task) => n + model.minutes(task),0);
    const cards = [
      ["time","clock","Tiempo registrado",model.duration(sumMinutes(tasks)),plural(closed,"tramo cerrado","tramos cerrados")],
      ["plan","check-circle","Cumplimiento del plan",planned.length ? Math.round(100 * complete / planned.length) + "%" : "—",complete + " de " + planned.length + (planned.length === 1 ? " planificada" : " planificadas")],
      ["pending","list","Pendientes",tasks.filter(task => task.status === "Pendiente").length,plural(tasks.length,"actividad en la jornada","actividades en la jornada")],
      ["unexpected","zap","Imprevistas",unexpected.length,model.duration(sumMinutes(unexpected)) + " de trabajo"]
    ];
    return `<section class="jd-metrics" aria-label="Indicadores del día">${cards.map(([kind,icon,label,value,detail]) =>
      `<article class="jd-metric jd-metric-${kind}"><div class="jd-metric-top"><span>${label}</span><span class="jd-metric-icon">${ctx.icon(icon,16)}</span></div><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join("")}</section>`;
  }

  function entriesFor(tasks, goals, date) {
    const now = minuteOfDay(model.timeNow());
    const today = model.today();
    const entries = [];
    for (const task of tasks) {
      const ordered = [...task.segments].sort((a,b) => a.start.localeCompare(b.start));
      const taskEntries = ordered.map((segment,index) => {
        const start = minuteOfDay(segment.start);
        const live = !segment.end && date === today && start <= now;
        const end = segment.end ? minuteOfDay(segment.end) : live ? now : start;
        return {task,goal:goals.get(task.goalId),segment,start,end,live,index:index + 1,count:ordered.length};
      });
      if (task.comment && taskEntries.length) {
        const lastLong = taskEntries.findLast(entry => entry.end - entry.start > 60);
        (lastLong || taskEntries[taskEntries.length-1]).withComment = true;
      }
      entries.push(...taskEntries);
    }
    return entries.sort((a,b) => a.start - b.start);
  }

  function entryRange(entry) {
    const end = entry.segment.end || (entry.live ? "ahora" : "sin cierre");
    return entry.segment.start + " – " + end;
  }

  function timeline(entries, ctx) {
    const low = Math.min(dayStart, ...entries.map(entry => Math.floor(entry.start / 60) * 60));
    const high = Math.max(18 * 60, ...entries.map(entry => Math.ceil(Math.max(entry.start + 1,entry.end) / 60) * 60));
    const width = high - low;
    const step = width > 15 * 60 ? 180 : 120;
    const ticks = [low];
    for (let t = low + step; t < high - step / 3; t += step) ticks.push(t);
    ticks.push(high);
    const legend = new Map();
    for (const entry of entries) legend.set(entry.task.goalId, entry.goal);
    const blocks = entries.map(entry => {
      const info = entryRange(entry) + " · " + entry.task.title;
      const left = (entry.start - low) * 100 / width;
      const span = Math.max((entry.end - entry.start) * 100 / width,0.22);
      return `<span class="jd-block${entry.segment.end ? "" : " jd-open-bar"}" style="--event-accent:${accent(entry.goal)};left:${left}%;width:${Math.min(span,100-left)}%" title="${esc(info)}"></span>`;
    }).join("");
    return `<section class="jd-timeline" aria-labelledby="jd-line-title"><div class="jd-line-heading"><h2 id="jd-line-title">${ctx.icon("clock",17)} Línea de tiempo</h2><span>Inicio de jornada <b>08:00</b></span></div>
      <div class="jd-scale" aria-hidden="true"><div class="jd-track">${blocks}</div><div class="jd-ticks">${ticks.map((t,i) =>
        `<span class="${i === 0 ? "first" : i === ticks.length-1 ? "last" : ""}" style="left:${(t-low) * 100 / width}%">${hourLabel(t)}</span>`).join("")}</div></div>
      ${legend.size ? `<div class="jd-legend">${[...legend.values()].map(goal => `<span><i style="--event-accent:${accent(goal)}"></i>${esc(goal?.title || "Sin objetivo")}</span>`).join("")}</div>` : ""}
    </section>`;
  }

  function slotHeight(minutes, isGap) {
    // El calendario asigna una hora por línea mayor y deja espacio para leer tramos breves.
    if (isGap) return Math.max(25,minutes * 1.2);
    const minimum = minutes <= 30 ? 39 : minutes <= 60 ? 58 : 78;
    return Math.max(minimum,minutes * 1.2);
  }

  function hourGuides(start, end, height) {
    if (end <= start) return "";
    let html = "";
    for (let hour = (Math.floor(start / 60) + 1) * 60; hour < end; hour += 60) {
      const y = (hour-start) / (end-start);
      if (Math.min(y,1-y) * height < 19) continue;
      html += `<div class="jd-hour-rule" aria-hidden="true" style="top:${100*y}%"><span>${hourLabel(hour)}</span></div>`;
    }
    return html;
  }

  function gap(start,end) {
    if (end <= start) return "";
    const duration = end-start;
    const height = slotHeight(duration,true);
    return `<li class="jd-gap jd-slot" style="--slot-height:${height}px" aria-label="${hourLabel(start)} a ${hourLabel(end)}, sin registro">
      <time class="jd-hour" datetime="${hourLabel(start)}">${hourLabel(start)}</time>${hourGuides(start,end,height)}
      <div class="jd-gap-space"><span>Sin registro <b>· ${esc(model.duration(duration))}</b></span></div></li>`;
  }

  function scheduledSlot(entry) {
    const {task,goal,start,end,segment,live} = entry;
    const minutes = end-start;
    const height = slotHeight(minutes,false);
    const size = minutes <= 30 ? "short" : minutes <= 60 ? "medium" : "long";
    const range = entryRange(entry);
    const status = !segment.end ? live ? "En curso" : "Sin cierre" : task.status;
    const repeat = entry.count > 1 ? "Tramo " + entry.index + " de " + entry.count : "";
    const meta = [goal?.title,repeat,task.origin === "Imprevista" ? task.origin : ""].filter(Boolean);
    const duration = segment.end || live ? model.duration(minutes) : "";
    const tooltip = [task.title,range,task.context,meta.join(" · "),status,entry.withComment ? task.comment : ""].filter(Boolean).join("\n");
    return `<li class="jd-slot jd-work-slot" style="--slot-height:${height}px;--event-accent:${accent(goal)}">
      <time class="jd-hour" datetime="${segment.start}">${segment.start}</time>${hourGuides(start,end,height)}
      <article class="jd-event jd-event-${size}${segment.end ? "" : " jd-event-open"}" title="${esc(tooltip)}">
        <div class="jd-event-head"><h3>${esc(task.title)}</h3><span class="jd-event-time">${esc(range)}${duration ? `<b> · ${esc(duration)}</b>` : ""}</span></div>
        ${task.context ? `<p class="jd-event-context">${esc(task.context)}</p>` : ""}
        <div class="jd-event-meta">${meta.map(value => `<span>${esc(value)}</span>`).join("")}<span class="jd-event-status">${esc(status)}</span></div>
        ${entry.withComment ? `<p class="${size === "long" ? "jd-event-comment" : "jd-sr"}"><strong>Avance del día</strong> ${esc(task.comment)}</p>` : ""}
      </article></li>`;
  }

  function calendar(entries) {
    if (!entries.length) {
      return '<div class="jd-calendar-empty"><span class="jd-empty-hour">08:00</span><p>Aún no hay tramos registrados.</p></div>';
    }
    const start = Math.min(dayStart,Math.floor(entries[0].start / 60) * 60);
    let cursor = start;
    const rows = [];
    for (const entry of entries) {
      if (entry.start > cursor) rows.push(gap(cursor,entry.start));
      rows.push(scheduledSlot(entry));
      cursor = Math.max(cursor,entry.end);
    }
    if (cursor < dayStart) { rows.push(gap(cursor,dayStart)); cursor = dayStart; }
    const last = entries[entries.length-1];
    const endLabel = !last.segment.end && !last.live && cursor === last.start ? "" : hourLabel(cursor);
    return `<div class="jd-calendar"><div class="jd-cal-head" aria-hidden="true"><span>Hora</span><span>Horario de la jornada</span></div>
      <ol class="jd-schedule" aria-label="Tramos por hora de inicio">${rows.join("")}</ol>
      ${endLabel ? `<div class="jd-calendar-end"><time datetime="${endLabel}">${endLabel}</time><span></span></div>` : ""}
    </div>`;
  }

  function unscheduled(tasks,goals) {
    if (!tasks.length) return "";
    return `<section class="jd-unscheduled" aria-labelledby="jd-pending-title"><div class="jd-plan-head"><h3 id="jd-pending-title">Sin horario</h3><span>${tasks.length}</span></div>
      <ol class="jd-plan-list" aria-label="Actividades sin horario en orden del plan">${tasks.map(task => {
        const goal = goals.get(task.goalId);
        const meta = [goal?.title,task.origin === "Imprevista" ? "Imprevista" : ""].filter(Boolean).join(" · ");
        return `<li class="jd-plan-row" style="--event-accent:${accent(goal)}"><div class="jd-plan-main"><h4>${esc(task.title)}</h4>
          ${task.context ? `<p>${esc(task.context)}</p>` : ""}${meta ? `<small>${esc(meta)}</small>` : ""}</div>
          <div class="jd-plan-details"><span>${esc(task.status)}</span><small>Prioridad ${esc(task.priority.toLowerCase())}</small></div></li>`;
      }).join("")}</ol></section>`;
  }

  function render(el,ctx) {
    const tasks = ctx.state.tasks.filter(task => task.date === ctx.date);
    const goals = new Map(ctx.state.goals.map(goal => [goal.id,goal]));
    const entries = entriesFor(tasks,goals,ctx.date);
    const noTime = tasks.filter(task => !task.segments.length);
    el.innerHTML = `<div class="jd-view" data-date="${esc(ctx.date)}"><h1 class="jd-sr">Mi jornada, ${esc(model.formatDate(ctx.date))}</h1>${stats(tasks,ctx)}${timeline(entries,ctx)}
      <section class="jd-activities" aria-labelledby="jd-schedule-title"><header class="jd-activities-head"><div>
        <h2 id="jd-schedule-title">Actividades del día</h2><p>${plural(tasks.length,"actividad","actividades")} · ${plural(entries.length,"tramo registrado","tramos registrados")}</p>
        </div><button type="button" class="btn primary jd-edit-day" data-edit-day>${ctx.icon("pencil",16)} Editar actividades</button></header>
        ${calendar(entries)}${unscheduled(noTime,goals)}
      </section></div>`;
    el.querySelector("[data-edit-day]").onclick = () => window.JSheet.open(ctx);
  }

  window.JAgenda = {render};
})();
