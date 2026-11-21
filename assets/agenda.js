/* Horario diario. Las ediciones rápidas se comparten entre todos los tramos de una actividad. */
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
      const span = (entry.end - entry.start) * 100 / width;
      return `<span class="jd-block${entry.segment.end ? "" : " jd-open-bar"}" style="--event-accent:${accent(entry.goal)};left:${left}%;width:${Math.min(span,100-left)}%" title="${esc(info)}"></span>`;
    }).join("");
    return `<section class="jd-timeline" aria-labelledby="jd-line-title"><div class="jd-line-heading"><h2 id="jd-line-title">${ctx.icon("clock",17)} Línea de tiempo</h2><span>Inicio de jornada <b>08:00</b></span></div>
      <div class="jd-scale" aria-hidden="true"><div class="jd-track">${blocks}</div><div class="jd-ticks">${ticks.map((t,i) =>
        `<span class="${i === 0 ? "first" : i === ticks.length-1 ? "last" : ""}" style="left:${(t-low) * 100 / width}%">${hourLabel(t)}</span>`).join("")}</div></div>
      ${legend.size ? `<div class="jd-legend">${[...legend.values()].map(goal => `<span><i style="--event-accent:${accent(goal)}"></i>${esc(goal?.title || "Sin objetivo")}</span>`).join("")}</div>` : ""}
    </section>`;
  }

  const hourScales = {detailed:38,compact:30};
  let observer = null;
  let liveScale = null;
  let density = "detailed";
  let mode = "calendar";
  const scrollPositions = new Map();
  const headers = [
    ["comments","Comentarios"], ["start","Inicio"], ["end","Cierre"],
    ["duration","Duración"], ["status","Estado"], ["done","¿Se hizo?"]
  ];
  let current = null;
  let detail = null;
  let pending = false;

  function paint(goal) {
    const color = accent(goal);
    const channels = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16));
    const mix = (tint,base) => "#" + channels.map((channel,i) =>
      Math.round(tint*channel + (1-tint)*base[i]).toString(16).padStart(2,"0")
    ).join("");
    const ribbon = mix(.24,[255,255,255]);
    const ink = mix(.22,[16,35,49]);
    return `--event-accent:${color};--ribbon-color:${ribbon};--ribbon-ink:${ink};--heading-ink:${ink}`;
  }

  function identity(task,entry,place) {
    return `data-id="${esc(task.id)}" data-segment="${entry?.index || 0}" data-place="${place}"`;
  }

  function durationLabel(minutes) {
    return Math.floor(minutes/60) + ":" + String(minutes%60).padStart(2,"0");
  }

  function taskFields(task,entry,place) {
    const attrs = identity(task,entry,place);
    const taskName = esc(task.title) + (entry ? ", tramo " + entry.index : "");
    const values = {
      comments:task.comment || "—",
      start:entry?.segment.start || "—",
      end:entry ? entry.segment.end || (entry.live ? "En curso" : "Sin cierre") : "—",
      duration:entry && (entry.segment.end || entry.live) ? durationLabel(entry.end-entry.start) : "—"
    };
    const status = '<select class="jd-status-input" data-jd-field="status" ' + attrs + ' aria-label="Estado de ' + taskName + '"' + (pending ? ' disabled' : '') + '>' +
      model.statuses.map(value => '<option value="' + esc(value) + '"' + (value === task.status ? ' selected' : '') + '>' + esc(value) + '</option>').join("") + '</select>';
    const done = `<label class="jd-done"><input type="checkbox" data-jd-field="done" ${attrs} aria-label="¿Se hizo? ${taskName}" ${task.done ? "checked" : ""} ${pending ? "disabled" : ""}></label>`;
    return '<div class="jd-event-fields">' + headers.map(([key,label]) => {
      const content = key === "status" ? status : key === "done" ? done :
        `<span class="jd-field-value" title="${esc(values[key])}">${esc(values[key])}</span>`;
      return `<div class="jd-field jd-field-${key}"><span class="jd-field-label">${label}</span>${content}</div>`;
    }).join("") + '</div>';
  }

  function eventHead(task,entry,place) {
    const name = entry ? task.title + ", " + entryRange(entry) : task.title;
    return `<div class="jd-event-head"><button type="button" class="jd-event-title" data-jd-detail ${identity(task,entry,place)} aria-label="Ver detalle de ${esc(name)}" title="${esc(task.title)}">${esc(task.title)}</button>
      ${task.context ? `<p class="jd-event-context" title="${esc(task.context)}"><span>${esc(task.context)}</span></p>` : ""}</div>`;
  }

  function lineBudget(height,content,entry) {
    const goal = !!entry.goal && height >= content.height+22;
    const budget = Math.max(0,height-content.band-(goal ? 19 : 0)-2);
    const lines = Math.max(0,Math.floor((budget-4+.01)/content.line));
    let context = Math.min(lines,content.contextLines);
    let comment = Math.min(lines,content.commentLines);
    if (content.stacked && context && comment) {
      // Dos párrafos en móvil comparten la altura del cuerpo.
      const both = Math.max(0,Math.floor((budget-8+.01)/content.line));
      if (both < 2) comment = 0;
      else {
        context = Math.min(context,both-1);
        comment = Math.min(comment,both-context);
      }
    }
    const title = Math.max(1,Math.floor((height-4+.01)/content.line));
    return {context,comment,title,goal};
  }

  function scheduledSlot(entry,scale,content,ctx) {
    const from = scale.at(entry.start), height = scale.at(entry.end)-from;
    const fit = lineBudget(height,content,entry);
    const goal = entry.goal ? `<div class="jd-event-goal">${ctx.icon("target",11)}<span>Objetivo · ${esc(entry.goal.title)}</span></div>` : "";
    return `<li class="jd-slot-track${height === 0 ? " jd-instant" : ""}" data-start-minute="${entry.start}" data-end-minute="${entry.end}" data-room-for-goal="${fit.goal}" data-context-lines="${fit.context}" data-comment-lines="${fit.comment}" style="top:${from}px;height:${height}px;--jd-measured-band:${content.band}px;--jd-title-lines:${fit.title};--jd-context-lines:${fit.context};--jd-comment-lines:${fit.comment};${paint(entry.goal)}">
      <article data-has-comment="${!!entry.task.comment}" class="jd-event${entry.segment.end ? "" : " jd-event-open"}" aria-label="${esc(entry.task.title)}, ${esc(entryRange(entry))}">
        ${eventHead(entry.task,entry,"grid")}${taskFields(entry.task,entry,"grid")}${goal}</article></li>`;
  }

  function estimatedContent(entry) {
    const lines = (text,columns) => text ? String(text).split(/\r?\n/).reduce((n,line) => n+Math.max(1,Math.ceil(line.length/columns)),0) : 0;
    const band = Math.max(18,lines(entry.task.title,72)*14+3);
    const line = 13.75, contextLines = lines(entry.task.context,43), commentLines = lines(entry.task.comment,32);
    return {band,line,contextLines,commentLines,stacked:false,height:band+line*Math.max(contextLines,commentLines)+6};
  }

  // Cada hora mantiene una escala lineal propia. Se distribuye el espacio faltante
  // sólo en las horas del tramo, dando mayor peso a su fracción de solapamiento.
  function makeScale(low,high,entries,content,options={}) {
    const base = options.baseHeight ?? hourScales[density];
    const limit = options.maxHourHeight ?? Infinity;
    const compact = options.compact ?? density === "compact";
    const heights = Array((high-low)/60).fill(base);
    const byLength = entries.map((entry,index) => ({entry,need:content[index].height})).sort((a,b) =>
      (a.entry.end-a.entry.start)-(b.entry.end-b.entry.start));
    for (const {entry,need} of byLength) {
      const duration = entry.end-entry.start;
      if (duration < 5) continue;
      const parts = [];
      let room = 0, weights = 0;
      for (let i = Math.floor((entry.start-low)/60); i < Math.ceil((entry.end-low)/60); i++) {
        const start = low+i*60;
        const fraction = (Math.min(start+60,entry.end)-Math.max(start,entry.start))/60;
        parts.push({i,fraction});
        room += heights[i]*fraction;
        weights += fraction*fraction;
      }
      // Un tramo breve tiene acceso completo desde Lista y desde su título.
      const maxRate = duration < 10 ? 1.35 : duration < 20 ? 1.8 : duration < 60 ? 2.6 : Infinity;
      const target = Math.min(need, duration*maxRate)*(compact ? hourScales.compact/hourScales.detailed : 1);
      if (target <= room) continue;
      for (const {i,fraction} of parts) heights[i] = Math.min(limit,heights[i]+(target-room)*fraction/weights);
    }
    const offsets = [0];
    heights.forEach((height,i) => {
      heights[i] = Math.ceil(height);
      offsets.push(offsets[i]+heights[i]);
    });
    const total = offsets[offsets.length-1];
    function at(minute) {
      if (minute >= high) return total;
      const i = Math.max(0,Math.floor((minute-low)/60));
      return offsets[i]+(minute-low-i*60)*heights[i]/60;
    }
    function minuteAt(y) {
      const i = heights.findIndex((_,i) => y < offsets[i+1]);
      return i < 0 ? high : low+i*60+Math.max(0,y-offsets[i])*60/heights[i];
    }
    return {low,high,heights,total,at,minuteAt};
  }

  function measureContent(grid,entries) {
    const fallback = entries.map(estimatedContent);
    if (!entries.length || !grid.clientWidth) return fallback;
    const probe = document.createElement("div");
    probe.className = "jd-measure";
    probe.setAttribute("aria-hidden","true");
    probe.innerHTML = entries.map(({task}) => `<div class="jd-probe-card"><div class="jd-probe-title">${esc(task.title)}</div><i class="jd-probe-control"></i>
      ${task.context ? `<div class="jd-probe-context">${esc(task.context)}</div>` : ""}
      ${task.comment ? `<div class="jd-probe-comment">${esc(task.comment)}</div>` : ""}</div>`).join("");
    grid.append(probe);
    try {
      return [...probe.children].map((card,i) => {
        const height = card.getBoundingClientRect().height;
        const band = Math.max(card.firstElementChild.getBoundingClientRect().height,card.children[1].getBoundingClientRect().height);
        if (!height) return fallback[i];
        const line = parseFloat(getComputedStyle(card.firstElementChild).lineHeight) || 13.75;
        const count = selector => {
          const child = card.querySelector(selector);
          return child ? Math.max(1,Math.round((child.getBoundingClientRect().height-4)/line)) : 0;
        };
        return {band:Math.ceil(band),height:Math.ceil(height)+2,line,
          contextLines:count(".jd-probe-context"),commentLines:count(".jd-probe-comment"),
          stacked:getComputedStyle(card.children[1]).gridColumnStart === "2"};
      });
    } finally { probe.remove(); }
  }

  function updateGeometry(view,entries,keepPlace=true) {
    const grid = view.querySelector(".jd-grid");
    if (!grid) return;
    const wrap = view.querySelector(".jd-cal-scroll");
    const anchor = keepPlace && liveScale ? liveScale.minuteAt(wrap.scrollTop || 0) : null;
    const content = measureContent(grid,entries);
    const scale = makeScale(Number(grid.dataset.startMinute),Number(grid.dataset.endMinute),entries,content);
    grid.dataset.hourHeights = scale.heights.join(",");
    grid.dataset.pixelsPerHour = hourScales[density];
    grid.style.setProperty("--grid-height",scale.total+"px");
    for (const line of grid.querySelectorAll("[data-minute]")) line.style.top = scale.at(Number(line.dataset.minute))+"px";
    const tracks = [...grid.querySelectorAll(".jd-slot-track")];
    entries.forEach((entry,i) => {
      const y = scale.at(entry.start);
      const height = scale.at(entry.end)-y;
      tracks[i].style.top = y+"px";
      tracks[i].style.height = height+"px";
      tracks[i].style.setProperty("--jd-measured-band",content[i].band+"px");
      const fit = lineBudget(height,content[i],entry);
      tracks[i].dataset.roomForGoal = String(fit.goal);
      tracks[i].dataset.contextLines = String(fit.context);
      tracks[i].dataset.commentLines = String(fit.comment);
      tracks[i].style.setProperty("--jd-title-lines",fit.title);
      tracks[i].style.setProperty("--jd-context-lines",fit.context);
      tracks[i].style.setProperty("--jd-comment-lines",fit.comment);
    });
    if (anchor !== null) wrap.scrollTop = scale.at(anchor);
    liveScale = scale;
  }

  function scalePicker() {
    return `<label class="jd-density jd-scale-picker" title="Cada hora se ajusta al texto de sus tramos. Los minutos conservan su posición dentro de esa hora.">Escala <select data-jd-scale aria-label="Escala del horario"><option value="detailed" ${density === "detailed" ? "selected" : ""}>Detallada</option><option value="compact" ${density === "compact" ? "selected" : ""}>Compacta</option></select></label>`;
  }

  function columnTitles(withHour) {
    const columns = [["activity","Actividad"],["comments","Comentarios"],["start","Inicio"],
      ["end","Cierre"],["duration","Duración"],["status","Estado"],["done","¿Se hizo?"]];
    if (withHour) columns.unshift(["hour","Hora"]);
    return columns.map(([key,label]) => '<span data-col="' + key + '">' + label + '</span>').join("");
  }

  function listOfEntries(entries) {
    if (!entries.length) return '<section class="jd-list-view" aria-label="Lista de tramos"><p class="jd-list-empty">Aún no hay tramos registrados.</p></section>';
    const rows = entries.map(entry => `<li class="jd-list-row${entry.segment.end ? "" : " jd-list-open"}" data-start-minute="${entry.start}" data-end-minute="${entry.end}" style="${paint(entry.goal)}">
      ${eventHead(entry.task,entry,"list")}${taskFields(entry.task,entry,"list")}</li>`);
    return `<section class="jd-list-view" aria-label="Lista de tramos"><div class="jd-list-scroll"><div class="jd-list-canvas">
      <div class="jd-list-head" aria-hidden="true">${columnTitles(false)}</div>
      <ol class="jd-readable-list" aria-label="Todos los tramos en orden cronológico">${rows.join("")}</ol>
    </div></div></section>`;
  }

  function calendar(entries,ctx) {
    const low = Math.min(dayStart,...entries.map(entry => Math.floor(entry.start/60)*60));
    const high = Math.max(dayStart + 60,...entries.map(entry => Math.ceil(Math.max(entry.start+1,entry.end)/60)*60));
    const content = entries.map(estimatedContent);
    const scale = makeScale(low,high,entries,content);
    const rules = [];
    for (let hour=low; hour<=high; hour+=60) {
      rules.push(`<div class="jd-grid-rule${hour === low ? " jd-grid-first" : hour === high ? " jd-grid-last" : ""}" data-minute="${hour}" style="top:${scale.at(hour)}px"><time${hour < 1440 ? ' datetime="' + hourLabel(hour) + '"' : ''}>${hourLabel(hour)}</time></div>`);
    }
    return `<section class="jd-calendar" data-density="${density}" aria-label="Horario de la jornada">
      <div class="jd-cal-scroll" tabindex="0" role="region" aria-label="Horario por hora, actividad y registro"><div class="jd-cal-canvas">
        <div class="jd-cal-head" aria-hidden="true">${columnTitles(true)}</div>
        <div class="jd-grid" data-start-minute="${low}" data-end-minute="${high}" data-pixels-per-hour="${hourScales[density]}" data-hour-heights="${scale.heights.join(",")}" style="--grid-height:${scale.total}px;height:var(--grid-height)">${rules.join("")}
          ${entries.length ? `<ol class="jd-events" aria-label="Tramos por hora">${entries.map((entry,i)=>scheduledSlot(entry,scale,content[i],ctx)).join("")}</ol>` :
          '<p class="jd-calendar-empty">Aún no hay tramos registrados.</p>'}</div>
      </div></div></section>`;
  }

  function unscheduled(tasks,goals) {
    if (!tasks.length) return "";
    return `<section class="jd-unscheduled" aria-labelledby="jd-pending-title"><div class="jd-plan-head"><h3 id="jd-pending-title">Sin horario</h3><span>${tasks.length}</span></div>
      <ol class="jd-plan-list" aria-label="Actividades sin horario en orden del plan">${tasks.map(task =>
        `<li class="jd-plan-row" style="${paint(goals.get(task.goalId))}">${eventHead(task,null,"plan")}${taskFields(task,null,"plan")}</li>`).join("")}</ol></section>`;
  }

  function locate(container,selector,key) {
    if (!container || !key) return null;
    return [...container.querySelectorAll(selector)].find(node =>
      node.dataset.id === key.id && node.dataset.segment === key.segment && node.dataset.place === key.place &&
      (!key.field || node.dataset.jdField === key.field)
    );
  }

  function closeDetail() {
    if (detail) detail.dialog.close();
  }

  function refreshDetail() {
    if (!detail || !current) return;
    const {ctx,goals} = current;
    const task = ctx.state.tasks.find(row => row.id === detail.key.id);
    const entries = task ? entriesFor([task],goals,task.date) : [];
    const index = Number(detail.key.segment);
    const entry = index ? entries.find(item => item.task.id === detail.key.id && item.index === index) : null;
    if (ctx.date !== detail.anchorDate || !task || (index && !entry)) { closeDetail(); return; }
    const goal = goals.get(task.goalId);
    const meta = [mode === "week" || task.date !== ctx.date ? model.formatDate(task.date,{weekday:"short",day:"numeric",month:"short"}) : "",entry ? entryRange(entry) : "Sin horario",entry?.count > 1 ? "Tramo " + entry.index + " de " + entry.count : "",goal?.title,task.origin].filter(Boolean);
    const dialog = detail.dialog;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
    const key = focused?.dataset.jdField ? {...focused.dataset,field:focused.dataset.jdField} : null;
    dialog.setAttribute("style",paint(goal));
    dialog.innerHTML = `<header class="jd-detail-heading"><h2 id="jd-detail-title">${esc(task.title)}</h2><button type="button" class="jd-detail-close icon-btn" aria-label="Cerrar detalle">${ctx.icon("x",17)}</button></header>
      <div class="jd-detail-sub">${meta.map(value=>"<span>"+esc(value)+"</span>").join(" · ")}</div>
      <p class="jd-detail-context">${esc(task.context || "Sin contexto registrado.")}</p>${taskFields(task,entry,"detail")}
      ${mode === "week" ? '<div class="jd-detail-actions"><button type="button" class="btn" data-from-week>Abrir jornada</button></div>' : ""}`;
    dialog.querySelector(".jd-detail-close").onclick = closeDetail;
    const go = dialog.querySelector("[data-from-week]");
    if (go) go.onclick = () => { closeDetail(); openDay(task.date,ctx); };
    if (key && !pending) locate(dialog,"[data-jd-field]",key)?.focus({preventScroll:true});
    else if (focused?.classList?.contains("jd-detail-close")) dialog.querySelector(".jd-detail-close").focus({preventScroll:true});
  }

  function openDetail(trigger,explicitKey) {
    if (detail) return;
    const dialog = document.createElement("dialog");
    dialog.className = "jd-detail";
    dialog.setAttribute("aria-labelledby","jd-detail-title");
    const key = explicitKey || {...trigger.dataset};
    detail = {dialog,key,anchorDate:current.ctx.date};
    dialog.addEventListener("close",() => {
      detail = null;
      dialog.remove();
      locate(current?.el,"[data-jd-detail],[data-week-detail]",key)?.focus({preventScroll:true});
    },{once:true});
    dialog.addEventListener("change",quickChange);
    document.body.append(dialog);
    refreshDetail();
    dialog.showModal();
    dialog.querySelector(".jd-detail-close").focus({preventScroll:true});
  }

  function gateFields(disabled) {
    for (const container of [current?.el,detail?.dialog]) {
      if (!container) continue;
      for (const field of container.querySelectorAll("[data-jd-field],[data-edit-day]")) field.disabled = disabled;
    }
  }

  function reflect(taskId,field,value) {
    for (const container of [current?.el,detail?.dialog]) {
      if (!container) continue;
      for (const control of container.querySelectorAll("[data-jd-field]")) {
        if (control.dataset.id !== taskId || control.dataset.jdField !== field) continue;
        if (field === "done") control.checked = value;
        else control.value = value;
      }
    }
  }

  async function quickChange(event) {
    const input = event.target.closest("[data-jd-field]");
    if (!input || !current) return;
    const {id,jdField:field} = input.dataset;
    const ctx = current.ctx;
    const task = ctx.state.tasks.find(row=>row.id === id);
    if (!task || !["done","status"].includes(field)) return;
    const previous = task[field];
    const value = field === "done" ? input.checked : input.value;
    if (pending) { reflect(id,field,previous); return; }
    if (previous === value) return;
    pending = true;
    const key = {...input.dataset,field};
    const hadFocus = document.activeElement === input;
    gateFields(true);
    let saved = false;
    try {
      saved = task.date === ctx.date ? await ctx.updateTaskField(id,field,value) :
        await ctx.updateTaskFieldForDate(task.date,id,field,value);
    } catch(error) {
      ctx.toast(error.message || "No se pudo guardar el cambio.");
    } finally {
      pending = false;
      gateFields(false);
      if (current?.ctx.date === ctx.date) {
        reflect(id,field,saved ? value : current.ctx.state.tasks.find(row=>row.id === id)?.[field] ?? previous);
        const container = key.place === "detail" ? detail?.dialog : current.el;
        if (hadFocus && (!document.activeElement || document.activeElement === document.body || document.activeElement === input)) {
          locate(container,"[data-jd-field]",key)?.focus({preventScroll:true});
        }
      }
    }
  }

  function readScroll(el,date) {
    const previous = el.querySelector(".jd-view");
    if (!previous || previous.dataset.date !== date) return;
    const scroller = previous.querySelector(".jd-cal-scroll,.jd-list-scroll");
    if (scroller) scrollPositions.set(previous.dataset.mode,{date,left:scroller.scrollLeft || 0,top:scroller.scrollTop || 0});
  }

  function openDay(date,ctx=current?.ctx) {
    if (!ctx) return;
    mode = "calendar";
    ctx.setDate(date);
  }

  function render(el,ctx) {
    if (observer) { observer.disconnect(); observer=null; }
    liveScale=null;
    const sameDate = el.querySelector(".jd-view")?.dataset.date === ctx.date;
    readScroll(el,ctx.date);
    const active = sameDate && el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.jdField ? {...active.dataset,field:active.dataset.jdField} : null;
    const detailKey = active?.matches("[data-jd-detail]") ? {...active.dataset} : null;
    const tasks = ctx.state.tasks.filter(task=>task.date === ctx.date);
    const goals = new Map(ctx.state.goals.map(goal=>[goal.id,goal]));
    const entries = entriesFor(tasks,goals,ctx.date);
    current = {el,ctx,tasks,goals,entries};
    const plan = unscheduled(tasks.filter(task=>!task.segments.length),goals);
    const week = mode === "week";
    const schedule = week ? '<div class="jd-week-host"></div>' : mode === "calendar" ? calendar(entries,ctx) : listOfEntries(entries);
    const last = entries[entries.length-1];
    const end = last && (last.segment.end || (last.live ? "ahora" : "sin cierre"));
    const hatchKey = mode === "calendar" ? '<span class="jd-hatch-key"><i aria-hidden="true"></i><span class="jd-sr">Rayado: </span>Sin registro</span>' : "";
    const meta = entries.length ? `<p class="jd-schedule-meta">${esc(entries[0].segment.start)} – ${esc(end)}<span aria-hidden="true"> · </span>${plural(entries.length,"tramo","tramos")} ${hatchKey}</p>` : "";
    const modeButtons = [["calendar","Horario","calendar-days"],["list","Lista","list"],["week","Semana","calendar-days"]].map(([key,title,icon]) =>
      `<button type="button" data-jd-mode="${key}" aria-pressed="${mode===key}">${ctx.icon(icon,15)} ${title}</button>`).join("");
    el.innerHTML = `<div class="jd-view" data-date="${esc(ctx.date)}" data-mode="${mode}"><h1 class="jd-sr">${week ? "Agenda semanal" : "Mi jornada"}, ${esc(model.formatDate(ctx.date))}</h1>${week ? "" : `<div class="jd-overview">${stats(tasks,ctx)}${timeline(entries,ctx)}</div>`}
      <section class="jd-activities" aria-labelledby="jd-schedule-title"><header class="jd-activities-head${week ? " jd-week-heading" : ""}"><div class="jd-activities-intro">
        <h2 id="jd-schedule-title">${week ? "Agenda semanal" : "Actividades del día"}</h2>${week ? "" : meta}</div>${mode === "calendar" ? scalePicker() : ""}
        <div class="jd-view-switch" role="group" aria-label="Vista de actividades">${modeButtons}</div>
        ${week ? "" : `<button type="button" class="btn primary jd-edit-day" data-edit-day ${pending ? "disabled" : ""}>${ctx.icon("pencil",16)} Editar actividades</button>`}</header>
        ${week ? schedule : entries.length ? schedule + plan : plan + schedule}</section></div>`;
    const view = el.querySelector(".jd-view");
    if (week) {
      window.JWeek.render(view.querySelector(".jd-week-host"),{
        ...ctx,weekEntries:entriesFor,eventPaint:paint,openDay:date=>openDay(date,ctx),
        weekScale:(low,high,rows,content,options={}) => makeScale(low,high,rows,content,{baseHeight:42,maxHourHeight:96,...options,compact:false}),
        openEntry:(id,ordinal,trigger)=>openDetail(trigger,{id,segment:String(ordinal ?? 1),place:trigger?.dataset.place || "week"})
      });
    } else if (mode === "calendar") {
      updateGeometry(view,entries,false);
      const canvas = view.querySelector(".jd-cal-canvas");
      let lastWidth = canvas.clientWidth;
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(() => {
          if (!view.isConnected || canvas.clientWidth === lastWidth) return;
          lastWidth = canvas.clientWidth;
          updateGeometry(view,entries);
        });
        observer.observe(canvas);
      }
      document.fonts?.ready?.then(() => {
        if (view.isConnected) updateGeometry(view,entries);
      });
    }
    view.addEventListener("change",event => {
      if (!event.target.matches("[data-jd-scale]")) { quickChange(event); return; }
      const next = event.target.value;
      if (!Object.hasOwn(hourScales,next)) return;
      density = next;
      view.querySelector(".jd-calendar").dataset.density = next;
      updateGeometry(view,entries);
    });
    view.addEventListener("click",event => {
      const btn = event.target.closest("button");
      if (!btn) return;
      if (btn.matches("[data-edit-day]")) { window.JSheet.open(current.ctx); return; }
      if (btn.matches("[data-jd-detail]")) { openDetail(btn); return; }
      if (btn.matches("[data-jd-mode]") && btn.dataset.jdMode !== mode) {
        mode = btn.dataset.jdMode;
        current.ctx.render();
        el.querySelector('[data-jd-mode="' + mode + '"]')?.focus({preventScroll:true});
      }
    });
    const scroller = view.querySelector(".jd-cal-scroll,.jd-list-scroll");
    const savedScroll = scrollPositions.get(mode);
    if (scroller && savedScroll?.date === ctx.date) {
      scroller.scrollLeft = savedScroll.left;
      scroller.scrollTop = savedScroll.top;
    }
    if (!pending && focusKey) locate(el,"[data-jd-field]",focusKey)?.focus({preventScroll:true});
    else if (detailKey) locate(el,"[data-jd-detail]",detailKey)?.focus({preventScroll:true});
    else if (active?.matches("[data-jd-mode]")) el.querySelector('[data-jd-mode="' + active.dataset.jdMode + '"]')?.focus({preventScroll:true});
    else if (active?.matches("[data-jd-scale]")) el.querySelector("[data-jd-scale]")?.focus({preventScroll:true});
    else if (active?.matches("[data-edit-day]") && !pending) el.querySelector("[data-edit-day]")?.focus({preventScroll:true});
    if (detail) refreshDetail();
  }

  window.JAgenda = {render,getMode:()=>mode,openDay};
})();
