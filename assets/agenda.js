/* Horario diario. Las ediciones rápidas se comparten entre todos los tramos de una actividad. */
(() => {
  "use strict";

  const model = window.JModel;
  const {esc} = window.JUI;
  const dayStart = 8 * 60;
  const noGoalColor = "#778a9a";
  const spaceGroup = {title:"Espacio sin objetivo",color:"#94642C"};
  const groupFor = (task,goals) => task.kind === "space" ? spaceGroup : goals.get(task.goalId);

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
    const activities = tasks.filter(task => task.kind !== "space");
    const spaces = tasks.filter(task => task.kind === "space");
    const planned = activities.filter(task => task.origin === "Planificada");
    const complete = planned.filter(task => task.done).length;
    const unexpected = activities.filter(task => task.origin === "Imprevista");
    const closed = tasks.reduce((n,task) => n + task.segments.filter(segment => segment.end).length,0);
    const sumMinutes = rows => rows.reduce((n,task) => n + model.minutes(task),0);
    const cards = [
      ["time","clock","Tiempo registrado",model.duration(sumMinutes(tasks)),spaces.length ? model.duration(sumMinutes(spaces)) + " en espacios sin objetivo" : plural(closed,"tramo cerrado","tramos cerrados")],
      ["plan","check-circle","Cumplimiento del plan",planned.length ? Math.round(100 * complete / planned.length) + "%" : "—",complete + " de " + planned.length + (planned.length === 1 ? " planificada" : " planificadas")],
      ["pending","list","Pendientes",activities.filter(task => task.status === "Pendiente").length,plural(activities.length,"actividad en la jornada","actividades en la jornada")],
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
        return {task,goal:groupFor(task,goals),segment,start,end,live,index:index + 1,count:ordered.length};
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
    for (const entry of entries) legend.set(entry.goal, entry.goal);
    const track = window.JTimeline.track(entries,low,high,accent,hourLabel);
    return `<section class="jd-timeline" aria-labelledby="jd-line-title"><div class="jd-line-heading"><h2 id="jd-line-title">${ctx.icon("clock",17)} Línea de tiempo</h2><span>Inicio de jornada <b>08:00</b></span></div>
      <div class="jd-scale">${track}<div class="jd-ticks" aria-hidden="true">${ticks.map((t,i) =>
        `<span class="${i === 0 ? "first" : i === ticks.length-1 ? "last" : ""}" style="left:${(t-low) * 100 / width}%">${hourLabel(t)}</span>`).join("")}</div></div>
      ${legend.size ? `<div class="jd-legend">${[...legend.values()].map(goal => `<span><i style="--event-accent:${accent(goal)}"></i>${esc(goal?.title || "Sin objetivo")}</span>`).join("")}</div>` : ""}
    </section>`;
  }

  const hourScales = {detailed:38,compact:30};
  let observer = null;
  let liveScale = null;
  let density = "detailed";
  let mode = "calendar";
  const noGoalFilter = "__none__";
  const spaceFilter = "__space__";
  let statusFilter = "";
  let goalFilter = "";
  const scrollPositions = new Map();
  const headers = [
    ["comments","Comentarios"], ["start","Inicio"], ["end","Cierre"],
    ["duration","Duración"], ["status","Estado"], ["done","¿Se hizo?"]
  ];
  let current = null;
  let detail = null;
  let pending = false;

  function fieldsDisabled() {
    return pending || current?.ctx.canEdit?.() === false;
  }

  function goalValue(id) {
    return id === noGoalFilter || id === spaceFilter || id.startsWith("~") ? "~" + id : id;
  }

  function filterBar(goals,icon,open) {
    const option = (value,label,selected) =>
      `<option value="${esc(value)}"${value===selected ? " selected" : ""}>${esc(label)}</option>`;
    const statusOptions = [option("","Todos los estados",statusFilter),...model.statuses.map(status=>option(status,status,statusFilter))];
    const goalOptions = [option("","Todos los objetivos",goalFilter),option(noGoalFilter,"Actividades sin objetivo",goalFilter),option(spaceFilter,"Espacios sin objetivo",goalFilter),
      ...[...goals.values()].sort((a,b)=>a.title.localeCompare(b.title,"es")).map(g=>option(goalValue(g.id),g.title,goalFilter))];
    const active = Number(Boolean(statusFilter)) + Number(Boolean(goalFilter));
    const caption = active ? "Filtros, " + plural(active,"activo","activos") : "Filtros";
    return `<div class="jd-filter-slot">
      <button type="button" class="jd-filter-toggle" data-jd-filter-toggle aria-controls="jd-filter-panel" aria-expanded="${open}" aria-label="${caption}" title="${caption}"${active ? " data-active" : ""}>
        ${icon("filter",16)}<span>Filtros</span>${active ? `<b aria-hidden="true">${active}</b>` : ""}
      </button>
      <div class="jd-filters" id="jd-filter-panel" role="group" aria-label="Filtros de actividades">
        <label class="jd-filter-control"><span>Estado</span><select aria-label="Filtrar por estado" aria-describedby="jd-filter-count" data-jd-status-filter${statusFilter ? " data-active" : ""}>${statusOptions.join("")}</select></label>
        <label class="jd-filter-control jd-goal-filter"><span>Objetivo</span><select aria-label="Filtrar por objetivo" aria-describedby="jd-filter-count" data-jd-goal-filter${goalFilter ? " data-active" : ""}>${goalOptions.join("")}</select></label>
        ${active ? `<button type="button" class="jd-filter-clear" data-jd-clear-filters aria-label="Limpiar filtros" title="Limpiar filtros">${icon("x",14)}<span>Limpiar filtros</span></button>` : ""}
      </div></div>`;
  }

  // El panel compacto sale del flujo. Los selectores son los mismos en todos los tamaños.
  function filterFocusTarget(container) {
    const toggle = container?.querySelector("[data-jd-filter-toggle]");
    if (toggle?.offsetWidth && toggle.getAttribute("aria-expanded") !== "true") return toggle;
    return container?.querySelector("[data-jd-status-filter]");
  }
  function closeFilterPanel(restoreFocus = false) {
    const toggle = current?.el.querySelector('[data-jd-filter-toggle][aria-expanded="true"]');
    if (!toggle) return;
    toggle.setAttribute("aria-expanded","false");
    if (restoreFocus) toggle.focus({preventScroll:true});
  }
  document.addEventListener("pointerdown",event => {
    if (!event.target.closest?.(".jd-filter-slot")) closeFilterPanel();
  });

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
    const disabled = fieldsDisabled();
    const status = '<select class="jd-status-input" data-jd-field="status" ' + attrs + ' aria-label="Estado de ' + taskName + '"' + (disabled ? ' disabled' : '') + '>' +
      model.statuses.map(value => '<option value="' + esc(value) + '"' + (value === task.status ? ' selected' : '') + '>' + esc(value) + '</option>').join("") + '</select>';
    const done = `<label class="jd-done"><input type="checkbox" data-jd-field="done" ${attrs} aria-label="¿Se hizo? ${taskName}" ${task.done ? "checked" : ""} ${disabled ? "disabled" : ""}></label>`;
    return '<div class="jd-event-fields">' + headers.map(([key,label]) => {
      const content = key === "status" ? status : key === "done" ? done :
        `<span class="jd-field-value" title="${esc(values[key])}">${esc(values[key])}</span>`;
      return `<div class="jd-field jd-field-${key}"><span class="jd-field-label">${label}</span>${content}</div>`;
    }).join("") + '</div>';
  }

  function eventHead(task,entry,place) {
    const name = entry ? task.title + ", " + entryRange(entry) : task.title;
    return `<div class="jd-event-head"><button type="button" class="jd-event-title" data-jd-detail ${identity(task,entry,place)} aria-label="Ver detalle de ${esc(name)}" title="${esc(task.title)}">${task.kind === "space" ? '<span class="jd-space-label">Espacio</span>' : ""}${esc(task.title)}</button>
      ${task.context ? `<p class="jd-event-context" title="${esc(task.context)}"><span>${esc(task.context)}</span></p>` : ""}</div>`;
  }

  function lineBudget(height,content,entry) {
    const goal = !!entry.goal && entry.task.kind !== "space" && height >= content.height+22;
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
    const goal = entry.goal && entry.task.kind !== "space" ? `<div class="jd-event-goal">${ctx.icon("target",11)}<span>Objetivo · ${esc(entry.goal.title)}</span></div>` : "";
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
    const headings = view.querySelector(".jd-cal-head");
    const previousTop = keepPlace && liveScale
      ? Math.max(0,headings.getBoundingClientRect().bottom-grid.getBoundingClientRect().top)
      : 0;
    const anchor = previousTop > 0 ? liveScale.minuteAt(previousTop) : null;
    const belowGrid = previousTop > 0 ? Math.max(0,previousTop-liveScale.total) : 0;
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
    if (anchor !== null) {
      const targetTop = scale.at(anchor)+belowGrid;
      const actualTop = headings.getBoundingClientRect().bottom-grid.getBoundingClientRect().top;
      if (Math.abs(targetTop-actualTop)>1) window.scrollBy({top:targetTop-actualTop,behavior:"instant"});
    }
    liveScale = scale;
  }

  function scalePicker(icon) {
    return `<label class="jd-density jd-scale-picker" title="Escala del horario. Cada hora se ajusta al texto de sus tramos. Los minutos conservan su posición dentro de esa hora."><span class="jd-scale-label">Escala</span><span class="jd-scale-icon" aria-hidden="true">${icon("layers",16)}</span><select data-jd-scale aria-label="Escala del horario"><option value="detailed" ${density === "detailed" ? "selected" : ""}>Detallada</option><option value="compact" ${density === "compact" ? "selected" : ""}>Compacta</option></select></label>`;
  }

  function columnTitles() {
    const columns = [["hour","Hora"],["activity","Actividad"],...headers];
    return columns.map(([key,label]) => '<span data-col="' + key + '">' + label + '</span>').join("");
  }

  function activityRow(task,entry,goal) {
    const place = entry ? "list" : "plan";
    const hour = entry ? `<time datetime="${entry.segment.start}">${entry.segment.start}</time>` : "Sin horario";
    const row = entry ? `class="jd-list-row${entry.segment.end ? "" : " jd-list-open"}" data-start-minute="${entry.start}" data-end-minute="${entry.end}"` : 'class="jd-plan-row"';
    return `<li ${row} style="${paint(goal)}"><span class="jd-row-hour">${hour}</span>
      <div class="jd-row-data" data-has-comment="${!!task.comment}">${eventHead(task,entry,place)}${taskFields(task,entry,place)}</div></li>`;
  }

  function listOfEntries(entries,planRows,filtered) {
    const rows = entries.map(entry => activityRow(entry.task,entry,entry.goal)).join("") + planRows;
    return `<section class="jd-list-view" aria-label="Lista de actividades"><div class="jd-list-scroll" tabindex="0" role="region" aria-label="Actividades en orden de inicio y tareas sin horario"><div class="jd-list-canvas">
      <div class="jd-list-head" aria-hidden="true">${columnTitles()}</div>
      ${rows ? '<ol class="jd-readable-list" aria-label="Actividades del día">'+rows+'</ol>' : '<p class="jd-list-empty">' + (filtered ? "Ninguna actividad coincide con los filtros de este día." : "Aún no hay actividades para este día.") + '</p>'}
    </div></div></section>`;
  }

  function calendar(entries,planRows,ctx,filtered) {
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
        <div class="jd-cal-head" aria-hidden="true">${columnTitles()}</div>
        <div class="jd-grid" data-start-minute="${low}" data-end-minute="${high}" data-pixels-per-hour="${hourScales[density]}" data-hour-heights="${scale.heights.join(",")}" style="--grid-height:${scale.total}px;height:var(--grid-height)">${rules.join("")}
          ${entries.length ? `<ol class="jd-events" aria-label="Tramos por hora">${entries.map((entry,i)=>scheduledSlot(entry,scale,content[i],ctx)).join("")}</ol>` :
          '<p class="jd-calendar-empty">' + (filtered ? (planRows ? "Solo hay coincidencias sin horario." : "Ninguna actividad coincide con los filtros de este día.") : "Aún no hay tramos registrados.") + '</p>'}</div>
        ${planRows ? '<ol class="jd-plan-list" aria-label="Actividades sin horario en orden del plan">'+planRows+'</ol>' : ''}
      </div></div></section>`;
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
    const meta = [mode === "week" || task.date !== ctx.date ? model.formatDate(task.date,{weekday:"short",day:"numeric",month:"short"}) : "",entry ? entryRange(entry) : "Sin horario",entry?.count > 1 ? "Tramo " + entry.index + " de " + entry.count : "",task.kind === "space" ? spaceGroup.title : goal?.title,task.kind === "space" ? "" : task.origin].filter(Boolean);
    const dialog = detail.dialog;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
    const key = focused?.dataset.jdField ? {...focused.dataset,field:focused.dataset.jdField} : null;
    dialog.setAttribute("style",paint(groupFor(task,goals)));
    dialog.innerHTML = `<header class="jd-detail-heading"><h2 id="jd-detail-title">${esc(task.title)}</h2><button type="button" class="jd-detail-close icon-btn" aria-label="Cerrar detalle">${ctx.icon("x",17)}</button></header>
      <div class="jd-detail-sub">${meta.map(value=>"<span>"+esc(value)+"</span>").join(" · ")}</div>
      <p class="jd-detail-context">${esc(task.context || "Sin contexto registrado.")}</p>${taskFields(task,entry,"detail")}
      <div class="jd-detail-actions">${mode === "week" ? '<button type="button" class="btn" data-from-week>Abrir jornada</button>' : ""}
      <button type="button" class="btn" data-edit-this ${fieldsDisabled() ? "disabled" : ""}>${ctx.icon("pencil",15)} Editar ${task.kind === "space" ? "espacio" : "actividad"}</button></div>`;
    dialog.querySelector(".jd-detail-close").onclick = closeDetail;
    dialog.querySelector("[data-edit-this]").onclick = () => {
      if (fieldsDisabled()) return;
      detail.editTask = {id:task.id,date:task.date};
      closeDetail();
    };
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
      const task = detail?.editTask;
      detail = null;
      dialog.remove();
      (locate(current?.el,"[data-jd-detail],[data-week-detail]",key) || filterFocusTarget(current?.el))?.focus({preventScroll:true});
      if (task && current && !fieldsDisabled()) window.JSheet.open({...current.ctx,date:task.date},{taskId:task.id,mode:"full"});
    },{once:true});
    dialog.addEventListener("change",quickChange);
    document.body.append(dialog);
    refreshDetail();
    dialog.showModal();
    dialog.querySelector(".jd-detail-close").focus({preventScroll:true});
  }

  function gateFields() {
    const disabled = fieldsDisabled();
    for (const container of [current?.el,detail?.dialog]) {
      if (!container) continue;
      for (const field of container.querySelectorAll("[data-jd-field],[data-edit-day],[data-edit-this]")) field.disabled = disabled;
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
    if (fieldsDisabled()) { reflect(id,field,previous); return; }
    if (previous === value) return;
    pending = true;
    const key = {...input.dataset,field};
    const hadFocus = document.activeElement === input;
    gateFields();
    let saved = false;
    try {
      saved = task.date === ctx.date ? await ctx.updateTaskField(id,field,value) :
        await ctx.updateTaskFieldForDate(task.date,id,field,value);
    } catch(error) {
      ctx.toast(error.message || "No se pudo guardar el cambio.");
    } finally {
      pending = false;
      gateFields();
      if (current?.ctx.date === ctx.date) {
        reflect(id,field,saved ? value : current.ctx.state.tasks.find(row=>row.id === id)?.[field] ?? previous);
        const container = key.place === "detail" ? detail?.dialog : current.el;
        if (hadFocus && (!document.activeElement || document.activeElement === document.body || document.activeElement === input)) {
          (locate(container,"[data-jd-field]",key) || filterFocusTarget(container))?.focus({preventScroll:true});
        }
      }
    }
  }

  function pinHeadings(view,entries) {
    const panel = view.querySelector(".jd-activities");
    const toolbar = panel.querySelector(".jd-activities-head");
    const headings = panel.querySelector(".jd-cal-head,.jd-list-head,.jw-day-heads");
    const canvas = panel.querySelector(".jd-cal-canvas");
    let width = canvas?.clientWidth;
    function measure() {
      if (!view.isConnected) return;
      panel.style.setProperty("--jd-toolbar-height",toolbar.getBoundingClientRect().height+"px");
      panel.style.setProperty("--jd-column-height",headings.getBoundingClientRect().height+"px");
      if (canvas && width !== canvas.clientWidth) {
        width = canvas.clientWidth;
        updateGeometry(view,entries);
      }
    }
    measure();
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(measure);
      for (const node of [toolbar,headings,canvas]) if (node) observer.observe(node);
    }
  }

  function openDay(date,ctx=current?.ctx) {
    if (!ctx) return;
    mode = "calendar";
    ctx.setDate(date);
  }

  function render(el,ctx) {
    if (observer) { observer.disconnect(); observer=null; }
    liveScale=null;
    if (current && (current.el !== el || current.ctx.user?.id !== ctx.user?.id)) {
      statusFilter = goalFilter = "";
    }
    const previous = el.querySelector(".jd-view");
    const sameDate = previous?.dataset.date === ctx.date;
    const filtersOpen = Boolean(sameDate && previous.dataset.mode === mode &&
      current?.ctx.user?.id === ctx.user?.id && previous.querySelector('[data-jd-filter-toggle][aria-expanded="true"]'));
    const panelTop = sameDate ? previous.querySelector(".jd-activities").getBoundingClientRect().top : 0;
    if (sameDate) scrollPositions.set(previous.dataset.mode,{date:ctx.date,depth:Math.max(0,-panelTop)});
    const active = sameDate && el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset.jdField ? {...active.dataset,field:active.dataset.jdField} : null;
    const detailKey = active?.matches("[data-jd-detail],[data-week-detail]") ? {...active.dataset} : null;
    const weekDate = active?.dataset.weekDay;
    const stableFocus = [".jw-scroller",".jd-cal-scroll",".jd-list-scroll",
      "[data-jd-scale]","[data-jd-filter-toggle]","[data-jd-jump-plan]","[data-jd-status-filter]","[data-jd-goal-filter]","[data-jd-clear-filters]","[data-edit-day]:not(:disabled)"].find(selector=>active?.matches(selector));
    const week = mode === "week";
    const period = week ? window.JWeek.range(ctx.date) : {start:ctx.date,end:ctx.date};
    const periodTasks = ctx.state.tasks.filter(task=>task.date >= period.start && task.date <= period.end);
    const goals = new Map(ctx.state.goals.map(goal=>[goal.id,goal]));
    if (goalFilter && ![noGoalFilter,spaceFilter].includes(goalFilter) && !ctx.state.goals.some(g=>goalValue(g.id)===goalFilter)) goalFilter = "";
    const filtered = Boolean(statusFilter || goalFilter);
    const visibleTasks = filtered ? periodTasks.filter(task=>
      (!statusFilter || task.status===statusFilter) &&
      (!goalFilter || (task.kind === "space" ? spaceFilter : goals.has(task.goalId) ? goalValue(task.goalId) : noGoalFilter)===goalFilter)
    ) : periodTasks;
    const dayEntries = week ? [] : entriesFor(periodTasks,goals,ctx.date);
    const visibleTasksSet = filtered && !week ? new Set(visibleTasks) : null;
    const entries = visibleTasksSet ? dayEntries.filter(entry=>visibleTasksSet.has(entry.task)) : dayEntries;
    current = {el,ctx,goals};
    const unplaced = week ? [] : visibleTasks.filter(task=>!task.segments.length);
    const planRows = week ? "" : unplaced.map(task=>activityRow(task,null,groupFor(task,goals))).join("");
    const schedule = week ? '<div class="jd-week-host"></div>' : mode === "calendar" ? calendar(entries,planRows,ctx,filtered) : listOfEntries(entries,planRows,filtered);
    const last = entries[entries.length-1];
    const end = last && (last.segment.end || (last.live ? "ahora" : "sin cierre"));
    const hatchKey = mode === "calendar" && !filtered ? '<span class="jd-hatch-key" title="Sin registro"><i aria-hidden="true"></i><span class="jd-sr">Rayado: </span><span class="jd-hatch-caption">Sin registro</span></span>' : "";
    const planCount = unplaced.length + " sin horario";
    const jump = unplaced.length ? `<span aria-hidden="true"> · </span><button type="button" data-jd-jump-plan title="Ir a la primera actividad sin horario">${planCount}</button>` : "";
    const meta = entries.length ? `<p class="jd-schedule-meta">${esc(entries[0].segment.start)} – ${esc(end)}<span aria-hidden="true"> · </span>${plural(entries.length,"tramo","tramos")}${jump} ${hatchKey}</p>` :
      unplaced.length ? `<p class="jd-schedule-meta">${plural(unplaced.length,"registro sin horario","registros sin horario")}</p>` : "";
    el.innerHTML = `<div class="jd-view" data-date="${esc(ctx.date)}" data-mode="${mode}"><h1 class="jd-sr">${week ? "Agenda semanal" : "Actividades"}, ${esc(model.formatDate(ctx.date))}</h1>${week ? "" : `<div class="jd-overview">${stats(periodTasks,ctx)}${timeline(dayEntries,ctx)}</div>`}
      <section class="jd-activities" aria-labelledby="jd-schedule-title"${filtered ? " data-filtered" : ""}><header class="jd-activities-head"><div class="jd-activities-summary"><div class="jd-activities-intro">
        <h2 id="jd-schedule-title">${week ? "Agenda semanal" : "Actividades del día"}</h2>
        <span class="jd-filter-count" id="jd-filter-count" role="status">${filtered ? visibleTasks.length + " de " : ""}${plural(periodTasks.length,"registro","registros")}</span></div>
        ${week ? "" : meta}</div>
        <div class="jd-actions">
          ${mode === "calendar" ? scalePicker(ctx.icon) : ""}
          ${filterBar(goals,ctx.icon,filtersOpen)}
          ${week ? "" : `<button type="button" class="btn primary jd-edit-day" data-edit-day aria-label="Editar actividades" title="Editar actividades" ${fieldsDisabled() ? "disabled" : ""}>${ctx.icon("pencil",17)}</button>`}
        </div></header>
        ${schedule}</section></div>`;
    const view = el.querySelector(".jd-view");
    if (!week) window.JTimeline.bind(view.querySelector(".jd-timeline"),dayEntries,ctx,hourLabel);
    if (week) {
      window.JWeek.render(view.querySelector(".jd-week-host"),{
        ...ctx,visibleWeekTasks:visibleTasks,filtered,weekEntries:entriesFor,eventPaint:paint,openDay:date=>openDay(date,ctx),
        groupFor,
        weekScale:(low,high,rows,content,options) => makeScale(low,high,rows,content,{...options,compact:false}),
        openEntry:(id,ordinal,trigger)=>openDetail(trigger,{id,segment:String(ordinal ?? 1),place:trigger?.dataset.place || "week"})
      });
    } else if (mode === "calendar") {
      updateGeometry(view,entries,false);
      document.fonts?.ready?.then(() => {
        if (view.isConnected) updateGeometry(view,entries);
      });
    }
    pinHeadings(view,entries);
    const filterSlot = view.querySelector(".jd-filter-slot");
    filterSlot.addEventListener("focusout",event => {
      if (event.relatedTarget && !filterSlot.contains(event.relatedTarget)) closeFilterPanel();
    });
    filterSlot.addEventListener("keydown",event => {
      if (event.key === "Escape" && filterSlot.querySelector('[aria-expanded="true"]')) {
        event.preventDefault();
        closeFilterPanel(true);
      }
    });
    function applyFilters(focusSelector) {
      const pinned = view.querySelector(".jd-activities").getBoundingClientRect().top < 0;
      current.ctx.render();
      if (pinned) el.querySelector(".jd-activities").scrollIntoView({block:"start",behavior:"instant"});
      el.querySelector(focusSelector)?.focus({preventScroll:true});
    }
    view.addEventListener("change",event => {
      if (event.target.matches("[data-jd-status-filter]")) {
        statusFilter = event.target.value;
        applyFilters("[data-jd-status-filter]");
        return;
      }
      if (event.target.matches("[data-jd-goal-filter]")) {
        goalFilter = event.target.value;
        applyFilters("[data-jd-goal-filter]");
        return;
      }
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
      if (btn.matches("[data-jd-filter-toggle]")) {
        btn.setAttribute("aria-expanded",String(btn.getAttribute("aria-expanded") !== "true"));
        return;
      }
      if (btn.matches("[data-jd-clear-filters]")) {
        statusFilter = goalFilter = "";
        applyFilters("[data-jd-status-filter]");
        return;
      }
      if (btn.matches("[data-edit-day]")) {
        if (!fieldsDisabled()) window.JSheet.open(current.ctx);
        return;
      }
      if (btn.matches("[data-jd-detail]")) { openDetail(btn); return; }
      if (btn.matches("[data-jd-jump-plan]")) {
        const first = view.querySelector(".jd-plan-row");
        if (first) {
          first.querySelector("[data-jd-detail]").focus({preventScroll:true});
          first.scrollIntoView({block:"start",inline:"nearest"});
        }
        return;
      }
    });
    if (panelTop < 0) {
      const saved = scrollPositions.get(mode);
      const depth = saved?.date === ctx.date ? saved.depth : 0;
      const delta = view.querySelector(".jd-activities").getBoundingClientRect().top + depth;
      if (Math.abs(delta)>1) window.scrollBy({top:delta,behavior:"instant"});
    }
    if (!pending && focusKey) locate(el,"[data-jd-field]",focusKey)?.focus({preventScroll:true});
    else if (detailKey) locate(el,"[data-jd-detail],[data-week-detail]",detailKey)?.focus({preventScroll:true});
    else if (weekDate) el.querySelector('[data-week-day="'+weekDate+'"]')?.focus({preventScroll:true});
    else if (stableFocus) el.querySelector(stableFocus)?.focus({preventScroll:true});
    if (detail) refreshDetail();
  }

  function renderModes(host,ctx) {
    if (!host.querySelector(".jd-view-switch")) {
      const modes = [["calendar","Horario","clock"],["list","Lista","list"],["week","Semana","calendar-days"]];
      host.innerHTML = '<div class="jd-view-switch" role="group" aria-label="Vista de actividades">' +
        modes.map(([key,title,icon])=>`<button type="button" data-jd-mode="${key}">${ctx.icon(icon,15)}${title}</button>`).join("") + '</div>';
    }
    for (const button of host.querySelectorAll("[data-jd-mode]")) button.setAttribute("aria-pressed",String(button.dataset.jdMode===mode));
    host.onclick = event => {
      const button = event.target.closest("[data-jd-mode]");
      if (!button || button.dataset.jdMode === mode) return;
      mode = button.dataset.jdMode;
      ctx.render();
      button.focus({preventScroll:true});
    };
  }

  function openTaskDetail(id,ctx) {
    const task = ctx.state.tasks.find(row => row.id === id);
    if (!task) return;
    statusFilter = goalFilter = "";
    openDay(task.date,ctx);
    const trigger = [...current.el.querySelectorAll("[data-jd-detail]")].find(button=>button.dataset.id===id);
    if (trigger) {
      trigger.scrollIntoView({block:"center"});
      openDetail(trigger);
    }
  }

  window.JAgenda = {render,renderModes,getMode:()=>mode,openDay,openTaskDetail};
})();
