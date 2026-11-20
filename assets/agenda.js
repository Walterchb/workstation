/* Agenda diaria de Jornada. */
(() => {
  "use strict";

  const M = () => window.JModel;
  const esc = value => window.JUI.esc(String(value ?? ""));
  const statuses = ["Pendiente", "En proceso", "Culminado"];
  const statusClasses = ["pending", "progress", "complete"];
  const quickDrafts = new Map();
  const bulkDrafts = new Map();
  const reuseDrafts = new Map();
  const dayViews = new Map();
  const rank = {Alta:0, Media:1, Baja:2};
  const groups = [
    {status:"En proceso", label:"En proceso", key:"progress"},
    {status:"Pendiente", label:"Pendientes", key:"pending"},
    {status:"Culminado", label:"Culminadas", key:"complete"}
  ];
  const modes = [["quick","Entrada rápida"],["excel","Pegar desde Excel"],["reuse","Reutilizar"]];
  function dayView(date, tasks = []) {
    if (!dayViews.has(date)) {
      const folded = new Set(tasks.some(task => task.status !== "Culminado") ? ["Culminado"] : []);
      dayViews.set(date, {open:!tasks.length, mode:"quick", folded});
    }
    return dayViews.get(date);
  }
  let showComments = false;
  let filter = "Todas";
  let order = "group";
  let lastDate = "";

  function timestampMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function hourLabel(value) {
    return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  }

  function dateLabel(date, options) {
    const formatted = M().formatDate(date, options);
    return formatted.slice(0, 1).toUpperCase() + formatted.slice(1);
  }

  function safeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#788da1";
  }

  function openSegment(task) {
    return task.segments.find(segment => !segment.end);
  }

  function topSection(ctx) {
    const {date, icon} = ctx;
    const isToday = date === M().today();
    const dateDisplay = isToday ? "Hoy" : dateLabel(date, {day: "numeric", month: "short"}).replace(".", "");
    return `<div class="jd-heading">
      <div class="jd-heading-text">
        <p class="jd-dateline">${esc(dateLabel(date, {weekday: "long", day: "numeric", month: "long", year: "numeric"}))}</p>
        <h1>Mi jornada</h1>
      </div>
      <div class="jd-heading-tools">
        ${isToday ? "" : '<button class="jd-today" type="button" data-jd-act="today">Ir a hoy</button>'}
        <div class="jd-date-nav">
          <button type="button" data-jd-act="previous" title="Día anterior" aria-label="Día anterior">${icon("chevron-left", 16)}</button>
          <label class="jd-picker">${icon("calendar", 15)}<span>${esc(dateDisplay)}</span>
            <input type="date" value="${esc(date)}" aria-label="Elegir fecha de la jornada" data-jd-date>
          </label>
          <button type="button" data-jd-act="next" title="Día siguiente" aria-label="Día siguiente">${icon("chevron-right", 16)}</button>
        </div>
      </div>
    </div>`;
  }

  function metrics(tasks, ctx) {
    const planned = tasks.filter(task => task.origin === "Planificada");
    const fulfilled = planned.filter(task => task.done);
    const pending = tasks.filter(task => task.status === "Pendiente").length;
    const unforeseen = tasks.filter(task => task.origin === "Imprevista");
    const closed = tasks.reduce((sum, task) => sum + task.segments.filter(segment => segment.end).length, 0);
    const minutes = tasks.reduce((sum, task) => sum + M().minutes(task), 0);
    const percentage = planned.length ? Math.round(100 * fulfilled.length / planned.length) : null;
    const data = [
      ["clock", "Tiempo registrado", M().duration(minutes), `${closed} bloque${closed === 1 ? "" : "s"} cerrado${closed === 1 ? "" : "s"}`, "time"],
      ["check-circle", "Cumplimiento del plan", percentage === null ? "—" : percentage + "%", `${fulfilled.length} de ${planned.length} planificada${planned.length === 1 ? "" : "s"}`, "plan"],
      ["list", "Pendientes", String(pending), `${tasks.length} actividad${tasks.length === 1 ? "" : "es"} en la jornada`, "pending"],
      ["zap", "Imprevistas", String(unforeseen.length), "Tiempo · " + M().duration(unforeseen.reduce((sum, task) => sum + M().minutes(task), 0)), "unexpected"]
    ];
    return `<section class="jd-metrics" aria-label="Indicadores del día">${data.map(([iconName, label, value, detail, type]) =>
      `<article class="jd-metric jd-metric-${type}"><div class="jd-metric-top"><span>${label}</span><span class="jd-metric-icon">${ctx.icon(iconName, 16)}</span></div>
        <strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join("")}</section>`;
  }

  function timeline(tasks, ctx) {
    const goals = new Map(ctx.state.goals.map(goal => [goal.id, goal]));
    const now = timestampMinutes(M().timeNow());
    const entries = tasks.flatMap(task => task.segments.map(segment => {
      const start = timestampMinutes(segment.start);
      const end = segment.end ? timestampMinutes(segment.end) :
        ctx.date === M().today() ? Math.max(start, now) : start;
      const goal = goals.get(task.goalId);
      return {task, start, end, segment, name: goal?.title || "Sin objetivo", color: safeColor(goal?.color)};
    })).sort((a, b) => a.start - b.start);

    const low = Math.min(480, ...entries.map(entry => Math.floor(entry.start / 60) * 60));
    const high = Math.max(1080, ...entries.map(entry => Math.ceil(Math.max(entry.start + 1, entry.end) / 60) * 60));
    const width = high - low;
    const step = width > 900 ? 180 : 120;
    const ticks = [low];
    for (let value = low + step; value < high - step / 3; value += step) ticks.push(value);
    ticks.push(high);
    const blocks = entries.map(entry => {
      const left = (entry.start - low) * 100 / width;
      const span = Math.max((entry.end - entry.start) * 100 / width, 0.32);
      const label = entry.segment.start + " – " + (entry.segment.end || "En curso") + " · " + entry.task.title + " · " + entry.name;
      return `<button type="button" class="jd-block${entry.segment.end ? "" : " jd-block-active"}" style="--block-color:${entry.color};left:${left}%;width:${Math.min(span, 100 - left)}%" data-jd-act="edit" data-id="${esc(entry.task.id)}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
    }).join("");
    const labels = new Map(entries.map(entry => [entry.task.goalId || "", entry]));
    const live = entries.find(entry => !entry.segment.end);
    return `<section class="jd-timeline" aria-label="Línea de tiempo de la jornada">
      <div class="jd-timeline-heading"><h2>${ctx.icon("clock", 17)} Línea de tiempo</h2><span>Inicio de jornada <b>08:00</b></span></div>
      <div class="jd-scale">
        <div class="jd-track">${blocks}</div>
        <div class="jd-ticks">${ticks.map((tick, i) => `<span class="${i === 0 ? "first" : i === ticks.length - 1 ? "last" : ""}" style="left:${(tick - low) * 100 / width}%">${hourLabel(tick)}</span>`).join("")}</div>
      </div>
      <div class="jd-legend">${entries.length ? [...labels.values()].map(entry =>
        `<span><i style="--block-color:${entry.color}"></i>${esc(entry.name)}</span>`).join("") : "<span>Los bloques aparecerán al registrar horas.</span>"}${live ? `<span class="jd-live-note">Bloque abierto desde las ${esc(live.segment.start)}</span>` : ""}</div>
    </section>`;
  }

  function matchFilter(task) {
    return filter === "Todas" || task.status === filter || (filter === "Imprevistas" && task.origin === "Imprevista") || (filter === "Sin cumplir" && !task.done);
  }

  function tableRow(task, ctx, goal, nextId) {
    const active = openSegment(task);
    const isToday = ctx.date === M().today();
    const taskId = esc(task.id);
    const title = esc(task.title);
    const isNext = task.id === nextId && !active;
    const timerAction = isToday && (active || task.status !== "Culminado");
    const timerLabel = active ? "Pausar" : task.segments.length ? "Reanudar" : "Iniciar";
    const priorityClass = ["high","medium","low"][rank[task.priority]];
    const elapsed = active && isToday ? Math.max(0, timestampMinutes(M().timeNow()) - timestampMinutes(active.start)) : 0;
    const total = M().minutes(task) + elapsed;
    const segment = task.segments[0];
    const detail = active ? "Desde las " + active.start : task.segments.length > 1 ? task.segments.length + " tramos" :
      segment ? segment.start + " – " + segment.end : "";
    const meta = [
      goal ? `<span class="jd-goal" title="${esc(goal.title)}"><i style="--goal-color:${safeColor(goal.color)}"></i>${esc(goal.title)}</span>` : "",
      task.origin === "Imprevista" ? '<small class="jd-unplanned">Imprevista</small>' : "",
      active ? '<small class="jd-live-tag">En ejecución</small>' : isNext ? '<small class="jd-next-tag">Siguiente del plan</small>' : ""
    ].filter(Boolean).join("");
    return `<tr class="jd-activity-row${active ? " jd-active-row" : isNext ? " jd-next-row" : ""}">
      <td class="jd-check-cell"><label class="jd-check"><input type="checkbox" data-jd-done data-id="${taskId}" aria-label="Avance cumplido de ${title}" ${task.done ? "checked" : ""}><span>${ctx.icon("check", 13)}</span></label></td>
      <td class="jd-task-cell"><button class="jd-title" type="button" data-jd-act="edit" data-id="${taskId}">${title}</button>
        ${task.context ? `<div class="jd-context">${esc(task.context)}</div>` : ""}
        ${meta ? `<div class="jd-row-meta">${meta}</div>` : ""}
        ${showComments && task.comment ? `<div class="jd-comment"><strong>Comentario</strong> ${esc(task.comment)}</div>` : ""}
      </td>
      <td class="jd-priority-cell"><span class="jd-priority jd-priority-${priorityClass}">${esc(task.priority)}</span></td>
      <td class="jd-status-cell"><label class="jd-status jd-status-${statusClasses[statuses.indexOf(task.status)]}"><i></i><span aria-hidden="true">${esc(task.status)}</span><select aria-label="Estado de ${title}" data-jd-status data-id="${taskId}">${statuses.map(status => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}</select></label></td>
      <td class="jd-duration-cell"><b${active ? ' title="Incluye el tramo abierto"' : ""}>${task.segments.length ? esc(M().duration(total)) : "—"}</b>
        ${detail ? `<small>${esc(detail)}</small>` : ""}</td>
      <td class="jd-actions-cell"><div>
        ${timerAction ? `<button class="jd-row-act ${active ? "jd-pause" : "jd-start"}" type="button" title="${timerLabel}" aria-label="${timerLabel} ${title}" data-jd-act="${active ? "pause" : "start"}" data-id="${taskId}">${ctx.icon(active ? "pause" : "play", 14)}<span>${timerLabel}</span></button>` : ""}
        <button type="button" class="jd-row-act jd-edit" title="Editar actividad y horas" aria-label="Editar ${title}" data-jd-act="edit" data-id="${taskId}">${ctx.icon("pencil", 15)}</button>
      </div></td></tr>`;
  }

  function captureArea(ctx, view) {
    if (!view.open) return '<div id="jd-capture" hidden></div>';
    const draft = quickDrafts.get(ctx.date) || {};
    const paste = bulkDrafts.get(ctx.date) || {};
    const originOptions = value => '<option>Planificada</option><option' + (value === "Imprevista" ? " selected" : "") + '>Imprevista</option>';
    let body;
    if (view.mode === "quick") {
      body = `<form class="jd-quick" data-jd-form>
        <span class="jd-quick-plus" aria-hidden="true">${ctx.icon("plus", 17)}</span>
        <input name="title" maxlength="180" required aria-label="Nombre de actividad rápida" placeholder="Nombre de la actividad" value="${esc(draft.title)}" autocomplete="off">
        <input name="context" maxlength="2000" aria-label="Contexto de actividad rápida" placeholder="Contexto (opcional)" value="${esc(draft.context)}" autocomplete="off">
        <select name="origin" aria-label="Origen de actividad rápida">${originOptions(draft.origin)}</select>
        <button type="submit" title="Agregar y continuar (Enter)" aria-label="Agregar actividad rápida">${ctx.icon("corner-down-left", 15)}</button></form>`;
    } else if (view.mode === "excel") {
      body = `<div class="jd-import"><form data-jd-bulk><label for="jd-paste">Pega las columnas Actividad y Contexto, una fila por actividad.</label>
        <textarea id="jd-paste" name="rows" placeholder="Pega las filas aquí" aria-label="Actividades y contextos de Excel">${esc(paste.raw)}</textarea>
        <div><select name="origin" aria-label="Origen de las actividades pegadas">${originOptions(paste.origin || draft.origin)}</select><span data-jd-count role="status"></span><button type="submit" disabled>Agregar filas</button></div></form></div>`;
    } else body = '<div class="jd-import jd-reuse" data-jd-reuse-content></div>';
    return `<section class="jd-capture" id="jd-capture" aria-label="Agregar actividades"><div class="jd-capture-head"><div class="jd-capture-tabs" role="group" aria-label="Método de ingreso">${modes.map(([key,label]) =>
      `<button type="button" data-jd-act="mode" data-mode="${key}" aria-pressed="${view.mode === key}">${label}</button>`).join("")}</div>
      <button class="jd-full-form" type="button" data-jd-act="add">${ctx.icon("file-text",15)} Ficha completa</button></div>
      <div class="jd-capture-body">${body}</div></section>`;
  }

  function workTable(tasks, ctx, view) {
    const visible = tasks.filter(matchFilter);
    if (order === "priority") visible.sort((a,b) => rank[a.priority] - rank[b.priority]);
    if (!visible.length) {
      return `<div class="jd-empty">${ctx.icon(tasks.length ? "filter" : "list", 24)}
        <strong>${tasks.length ? "Ninguna actividad coincide con el filtro" : "Tu jornada está lista para planificar"}</strong>
        ${tasks.length ? '<button type="button" data-jd-act="clear">Ver todas las actividades</button>' : "<span>Agrega la primera actividad de este día.</span>"}</div>`;
    }
    const goals = new Map(ctx.state.goals.map(goal => [goal.id, goal]));
    const nextId = ctx.date >= M().today() ? tasks.find(task => task.origin === "Planificada" && task.status === "Pendiente" && !task.done)?.id : "";
    const rowsHtml = rows => rows.map(task => tableRow(task, ctx, goals.get(task.goalId), nextId)).join("");
    const colKeys = ["check", "task", "priority", "status", "time", "actions"];
    let body;
    if (order !== "group") body = `<tbody>${rowsHtml(visible)}</tbody>`;
    else {
      body = groups.map(({status, label, key}) => {
        const rows = visible.filter(task => task.status === status);
        if (!rows.length) return "";
        rows.sort((a,b) => Number(!!openSegment(b)) - Number(!!openSegment(a)));
        const folded = view.folded.has(status);
        return `<tbody class="jd-group-header"><tr class="jd-group-row jd-group-${key}"><th colspan="6">
          <button type="button" class="jd-group-toggle" id="jd-button-${key}" data-jd-act="group" data-status="${status}" aria-expanded="${!folded}" aria-controls="jd-content-${key}">
          ${ctx.icon(folded ? "chevron-right" : "chevron-down",15)}<span class="jd-group-label">${label}</span><span class="jd-group-count">${rows.length}</span></button>
          </th></tr></tbody><tbody id="jd-content-${key}" aria-labelledby="jd-button-${key}" ${folded ? "hidden" : ""}>${rowsHtml(rows)}</tbody>`;
      }).join("");
    }
    return `<div class="jd-table-scroll"><table class="jd-table jd-work-table" aria-label="Registro de actividades"><colgroup>${colKeys.map(key => `<col class="jd-col-${key}">`).join("")}</colgroup>
      <thead><tr><th scope="col" class="jd-check-cell"><span title="Avance cumplido">${ctx.icon("check",14)}<span class="jd-sr">Avance cumplido</span></span></th><th scope="col">Actividad</th><th scope="col">Prioridad</th><th scope="col">Estado</th><th scope="col">Tiempo real</th><th scope="col" class="jd-actions-cell">Acciones</th></tr></thead>${body}</table></div>`;
  }

  function activitySection(tasks, ctx) {
    const view = dayView(ctx.date, tasks);
    const filters = [["Todas","Todas"],["Pendiente","Pendientes"],["En proceso","En proceso"],["Culminado","Culminadas"],["Imprevistas","Imprevistas"],["Sin cumplir","Sin cumplir"]];
    const countLabel = filter === "Todas" ? String(tasks.length) : tasks.filter(matchFilter).length + " de " + tasks.length;
    const orders = [["group","Por estado"],["plan","Orden del plan"],["priority","Por prioridad"]];
    const options = (pairs, selected) => pairs.map(([value,label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
    return `<section class="jd-activities panel" aria-labelledby="jd-title"><div class="jd-section-heading"><div class="jd-table-title"><h2 id="jd-title">Actividades del día</h2><span>${countLabel}</span></div>
      <button type="button" class="btn primary jd-add" data-jd-act="capture" aria-label="${view.open ? "Cerrar captura" : "Agregar actividad"}" aria-expanded="${view.open}" aria-controls="jd-capture">${ctx.icon(view.open ? "x" : "plus",16)} <span>${view.open ? "Cerrar" : "Agregar"}<span class="jd-wide-text">${view.open ? " captura" : " actividad"}</span></span></button></div>
      ${captureArea(ctx, view)}<div class="jd-controls"><div class="jd-table-tools">
        <label class="jd-filter">${ctx.icon("layers",14)}<select aria-label="Ordenar actividades" data-jd-order>${options(orders, order)}</select></label>
        <label class="jd-filter">${ctx.icon("filter",14)}<select aria-label="Filtrar actividades" data-jd-filter>${options(filters, filter)}</select></label>
        <button class="jd-comments-toggle" type="button" data-jd-act="comments" aria-label="Comentarios" aria-pressed="${showComments}" title="Mostrar u ocultar los comentarios">${ctx.icon("eye",14)}<span class="jd-wide-text">Comentarios</span></button>
      </div></div>${workTable(tasks, ctx, view)}</section>`;
  }

  async function toggleTimer(ctx, id, pause) {
    let message = "";
    const saved = await ctx.mutate(state => {
      const task = state.tasks.find(item => item.id === id);
      if (!task) throw new Error("La actividad ya no existe.");
      if (task.date !== M().today()) throw new Error("Registra las horas de ese día desde el editor.");
      const time = M().timeNow();
      const active = openSegment(task);
      if (pause) {
        if (!active) throw new Error("La actividad ya está pausada.");
        if (active.start > time) throw new Error("La hora de inicio es posterior a la hora actual. Corrígela en el editor.");
        if (active.start === time) {
          task.segments.splice(task.segments.indexOf(active), 1);
          message = "Pausada. El bloque duró menos de un minuto.";
        } else {
          active.end = time;
          message = "Bloque cerrado a las " + time + ".";
        }
        return;
      }
      const running = state.tasks.find(item => openSegment(item));
      if (running) throw new Error("Primero cierra el bloque abierto de «" + running.title + "» del " + dateLabel(running.date, {day:"numeric", month:"short"}) + ".");
      if (state.tasks.some(item => item.date === task.date && item.segments.some(segment => segment.end > time))) {
        throw new Error("Ya hay horas registradas después de las " + time + ". Revisa la línea de tiempo o ingresa el intervalo en el editor.");
      }
      task.segments.push({start:time, end:""});
      task.status = "En proceso";
      message = "Bloque iniciado a las " + time + ".";
    });
    if (saved) ctx.toast(message);
    return saved;
  }

  function rowsFromClipboard(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    const finalize = () => {
      row.push(cell.trim());
      if (row.some(Boolean)) {
        if (row.length > 2) throw new Error("Copia sólo las columnas Actividad y Contexto.");
        if (!row[0]) throw new Error("Hay una fila con contexto que necesita un nombre de actividad.");
        rows.push(row);
      }
      cell = ""; row = [];
    };
    const input = text.replace(/\r\n?/g, "\n");
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted && char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"' && (quoted || !cell.length)) quoted = !quoted;
      else if (!quoted && char === "\t") { row.push(cell.trim()); cell = ""; }
      else if (!quoted && char === "\n") finalize();
      else cell += char;
    }
    if (quoted) throw new Error("Revisa las comillas de la celda que estás pegando.");
    finalize();
    if (rows.length && /^actividad(es)?$/i.test(rows[0][0]) && /^contexto$/i.test(rows[0][1] || "")) rows.shift();
    return rows;
  }

  function installReuse(el, ctx) {
    const body = el.querySelector("[data-jd-reuse-content]");
    if (!body) return;
    const draft = reuseDrafts.get(ctx.date) || {source:"", ids:new Set()};
    reuseDrafts.set(ctx.date, draft);

    function draw() {
      const dates = [...new Set(ctx.state.tasks.map(activity => activity.date).filter(date => date < ctx.date))].sort().reverse();
      if (!dates.length) {
        body.innerHTML = '<p class="jd-reuse-empty">Cuando tengas actividades de fechas anteriores, podrás elegir cuáles repetir en esta jornada.</p>';
        return;
      }
      if (!dates.includes(draft.source)) { draft.source = dates[0]; draft.ids.clear(); }
      const options = dates.map(date => `<option value="${date}" ${date === draft.source ? "selected" : ""}>${esc(dateLabel(date, {weekday:"short",day:"numeric",month:"short",year:"numeric"}))}</option>`);
      const rows = M().reusableActivities(ctx.state, draft.source, ctx.date);
      const available = rows.filter(row => !row.reason);
      const goals = new Map(ctx.state.goals.map(goal => [goal.id, goal.title]));
      const availableIds = new Set(available.map(row => row.activity.id));
      draft.ids = new Set([...draft.ids].filter(id => availableIds.has(id)));
      body.innerHTML = `<form class="jd-reuse-form"><label class="jd-reuse-source">Jornada de origen
        <select name="source">${options.join("")}</select></label>
        <label class="jd-reuse-all"><input type="checkbox" name="all" ${available.length ? "" : "disabled"}>Seleccionar disponibles (${available.length})</label>
        <div class="jd-reuse-options">${rows.map(({activity,reason}) => {
          const goal = goals.get(activity.goalId) || "";
          return `<label class="jd-reuse-option ${reason ? "jd-included" : ""}"><input type="checkbox" name="chosen" value="${esc(activity.id)}" ${reason ? "disabled" : ""} ${draft.ids.has(activity.id) ? "checked" : ""}>
            <span><strong>${esc(activity.title)}</strong>${activity.context ? `<small>${esc(activity.context)}</small>` : ""}
            ${goal ? `<small>Objetivo · ${esc(goal)}</small>` : ""}${reason ? `<em>${reason}</em>` : ""}</span></label>`;
        }).join("")}</div>
        <div class="jd-reuse-actions"><span>Se copiarán al plan sin horas ni avances registrados.</span><button type="submit">Copiar al plan</button></div></form>`;
      const form = body.querySelector("form");
      const master = form.elements.all;
      const button = form.querySelector("button");
      function updateSelection() {
        const count = draft.ids.size;
        master.checked = count > 0 && count === available.length;
        master.indeterminate = count > 0 && count < available.length;
        button.disabled = !count;
        button.textContent = count ? "Copiar " + count + (count === 1 ? " actividad" : " actividades") : "Copiar al plan";
      }
      updateSelection();
      form.onchange = event => {
        const input = event.target;
        if (input.name === "source") {
          draft.source = input.value;
          draft.ids.clear();
          draw();
          body.querySelector("select").focus();
          return;
        }
        if (input === master) {
          draft.ids = master.checked ? new Set(availableIds) : new Set();
          for (const choice of form.querySelectorAll("input[name=chosen]:enabled")) choice.checked = master.checked;
        } else if (input.name === "chosen") {
          if (input.checked) draft.ids.add(input.value);
          else draft.ids.delete(input.value);
        }
        updateSelection();
      };
      form.onsubmit = async event => {
        event.preventDefault();
        if (!draft.ids.size) return;
        let count = 0;
        const selected = new Set(draft.ids);
        const saved = await ctx.mutate(state => {
          count = M().reuseActivities(state, draft.source, ctx.date, selected);
          if (!count) throw new Error("Las actividades seleccionadas ya están en esta jornada.");
        });
        if (saved) {
          draft.ids.clear();
          dayView(ctx.date).open = false;
          dayView(ctx.date).folded.delete("Pendiente");
          filter = "Todas";
          ctx.render();
          focusControl(el, ctx, '[data-jd-act="capture"]');
          ctx.toast(count === 1 ? "Actividad copiada al plan." : count + " actividades copiadas al plan.");
        }
      };
    }
    draw();
  }

  function focusControl(el, ctx, selector) {
    if (el.querySelector(".jd-view")?.dataset.date !== ctx.date) return;
    (el.querySelector(selector) || el.querySelector("[data-jd-filter]"))?.focus({preventScroll:true});
  }

  function refreshFocus(el, ctx, selector) {
    ctx.render();
    focusControl(el, ctx, selector);
  }

  function installEvents(el, ctx) {
    const view = dayView(ctx.date);
    const captureButton = '[data-jd-act="capture"]';
    const modeInput = () => ({quick:"[data-jd-form] input[name=title]", excel:"#jd-paste", reuse:'[data-mode="reuse"]'})[view.mode];
    el.onclick = async event => {
      const button = event.target.closest("[data-jd-act]");
      if (!button) return;
      const {id, jdAct} = button.dataset;
      switch (jdAct) {
        case "capture":
          view.open = !view.open;
          refreshFocus(el, ctx, view.open ? modeInput() : captureButton);
          break;
        case "mode":
          view.mode = button.dataset.mode;
          refreshFocus(el, ctx, '[data-mode="' + view.mode + '"]');
          break;
        case "group": {
          const status = button.dataset.status;
          if (view.folded.has(status)) view.folded.delete(status);
          else view.folded.add(status);
          refreshFocus(el, ctx, "#" + button.id);
          break;
        }
        case "add": ctx.openTask(null, {date:ctx.date}); break;
        case "edit": ctx.openTask(id); break;
        case "previous": ctx.setDate(M().shiftDate(ctx.date, -1)); el.querySelector('[data-jd-act="previous"]')?.focus({preventScroll:true}); break;
        case "next": ctx.setDate(M().shiftDate(ctx.date, 1)); el.querySelector('[data-jd-act="next"]')?.focus({preventScroll:true}); break;
        case "today": ctx.setDate(M().today()); el.querySelector("[data-jd-date]")?.focus({preventScroll:true}); break;
        case "comments": showComments = !showComments; refreshFocus(el,ctx,'[data-jd-act="comments"]'); break;
        case "clear": filter = "Todas"; refreshFocus(el,ctx,"[data-jd-filter]"); break;
        case "pause":
        case "start": {
          if (jdAct === "start") view.folded.delete("En proceso");
          const saved = await toggleTimer(ctx, id, jdAct === "pause");
          if (saved && jdAct === "start" && (filter === "Pendiente" || filter === "Culminado")) {
            filter = "En proceso";
            ctx.render();
          }
          focusControl(el,ctx,'.jd-row-act:not(.jd-edit)[data-id="' + CSS.escape(id) + '"]');
          break;
        }
      }
    };
    el.onchange = async event => {
      const control = event.target;
      if (control.matches("[data-jd-date]")) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(control.value)) {
          ctx.setDate(control.value);
          el.querySelector("[data-jd-date]")?.focus({preventScroll:true});
        }
      } else if (control.matches("[data-jd-order]")) {
        order = control.value;
        refreshFocus(el,ctx,"[data-jd-order]");
      } else if (control.matches("[data-jd-filter]")) {
        filter = control.value;
        if (statuses.includes(filter)) view.folded.delete(filter);
        refreshFocus(el,ctx,"[data-jd-filter]");
      } else if (control.matches("[data-jd-done],[data-jd-status]")) {
        const isCheck = control.matches("[data-jd-done]");
        if (!isCheck) view.folded.delete(control.value);
        const saved = await ctx.mutate(state => {
          const task = state.tasks.find(item => item.id === control.dataset.id);
          if (!task) throw new Error("La actividad ya no existe.");
          if (isCheck) task.done = control.checked;
          else {
            if (openSegment(task) && control.value !== "En proceso") throw new Error("Pausa el bloque antes de cambiar el estado.");
            task.status = control.value;
          }
        });
        if (!saved) ctx.render();
        focusControl(el,ctx,(isCheck ? "[data-jd-done]" : "[data-jd-status]") + '[data-id="' + CSS.escape(control.dataset.id) + '"]');
      }
    };

    const form = el.querySelector("[data-jd-form]");
    if (form) {
      const saveDraft = () => quickDrafts.set(ctx.date, Object.fromEntries(new FormData(form)));
      form.oninput = form.onchange = saveDraft;
      form.elements.title.onpaste = event => {
        const content = event.clipboardData?.getData("text/plain") || "";
        if (!/[\t\n]/.test(content.trimEnd())) return;
        event.preventDefault();
        saveDraft();
        bulkDrafts.set(ctx.date, {raw:content, origin:form.elements.origin.value});
        view.mode = "excel";
        refreshFocus(el,ctx,"#jd-paste");
      };
      form.onsubmit = async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const title = String(data.title).trim();
        if (!title) { form.elements.title.focus(); return; }
        const saved = await ctx.mutate(state => {
          state.tasks.push(M().task({date:ctx.date, title, context:String(data.context).trim(), origin:data.origin}));
        });
        if (saved) {
          quickDrafts.set(ctx.date,{origin:data.origin});
          filter = "Todas";
          view.folded.delete("Pendiente");
          refreshFocus(el,ctx,"[data-jd-form] input[name=title]");
          ctx.toast("Actividad agregada.");
        }
      };
    }
    const bulk = el.querySelector("[data-jd-bulk]");
    if (!bulk) return;
    function previewBulk() {
      const output = bulk.querySelector("[data-jd-count]");
      const button = bulk.querySelector("button");
      try {
        const rows = rowsFromClipboard(bulk.elements.rows.value);
        output.textContent = rows.length ? rows.length + (rows.length === 1 ? " actividad" : " actividades") : "";
        button.disabled = !rows.length;
      } catch (error) {
        output.textContent = error.message;
        button.disabled = true;
      }
    }
    bulk.oninput = bulk.onchange = () => {
      bulkDrafts.set(ctx.date,{raw:bulk.elements.rows.value,origin:bulk.elements.origin.value});
      previewBulk();
    };
    previewBulk();
    bulk.onsubmit = async event => {
      event.preventDefault();
      const rows = rowsFromClipboard(bulk.elements.rows.value);
      if (!rows.length) return;
      const origin = bulk.elements.origin.value;
      const saved = await ctx.mutate(state => {
        for (const row of rows) state.tasks.push(M().task({date:ctx.date, title:row[0], context:row[1] || "", origin}));
      });
      if (saved) {
        bulkDrafts.set(ctx.date, {raw:"", origin});
        filter = "Todas";
        view.folded.delete("Pendiente");
        view.open = false;
        refreshFocus(el,ctx,captureButton);
        ctx.toast(rows.length + (rows.length === 1 ? " actividad agregada." : " actividades agregadas."));
      }
    };
  }

  function render(el, ctx) {
    if (ctx.date !== lastDate) { lastDate = ctx.date; filter = "Todas"; }
    const tasks = ctx.state.tasks.filter(task => task.date === ctx.date);
    const view = dayView(ctx.date, tasks);
    if (view.statusById) {
      for (const task of tasks) {
        if (!view.statusById.has(task.id)) filter = "Todas";
        if (view.statusById.get(task.id) !== task.status) view.folded.delete(task.status);
      }
    }
    view.statusById = new Map(tasks.map(task => [task.id,task.status]));
    el.innerHTML = `<div class="jd-view" data-date="${esc(ctx.date)}">${topSection(ctx)}${metrics(tasks, ctx)}${activitySection(tasks, ctx)}${timeline(tasks, ctx)}</div>`;
    installEvents(el, ctx);
    installReuse(el, ctx);
  }

  window.JAgenda = {render};
})();
