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
  let showComments = false;
  let filter = "Todas";
  let order = "plan";
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
        <button type="button" class="btn primary jd-add" data-jd-act="add">${icon("plus", 17)} Actividad</button>
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

  function tableRow(task, ctx, goal) {
    const isActive = !!openSegment(task);
    const isToday = ctx.date === M().today();
    const taskId = esc(task.id);
    const title = esc(task.title);
    const statusIndex = statuses.indexOf(task.status);
    const timerAction = isToday && (isActive || task.status !== "Culminado");
    const timerLabel = isActive ? "Pausar" : task.segments.length ? "Reanudar" : "Iniciar";
    const detail = task.segments.length === 1 ? task.segments[0].start + " – " + (task.segments[0].end || "En curso") :
      isActive ? "Desde " + openSegment(task).start : task.segments.length + " bloques";
    return `<tr class="${isActive ? "jd-active-row" : ""}">
      <td class="jd-check-cell"><label class="jd-check"><input type="checkbox" data-jd-done data-id="${taskId}" aria-label="Avance cumplido de ${title}" ${task.done ? "checked" : ""}><span>${ctx.icon("check", 13)}</span></label></td>
      <td class="jd-task-cell"><button class="jd-title" type="button" data-jd-act="edit" data-id="${taskId}">${title}</button>
        ${task.context ? `<div class="jd-context">${esc(task.context)}</div>` : ""}
        ${showComments && task.comment ? `<div class="jd-comment"><strong>Comentario</strong> ${esc(task.comment)}</div>` : ""}
        ${task.priority === "Alta" ? '<small class="jd-priority">Prioridad alta</small>' : ""}
        ${task.origin === "Imprevista" ? '<small class="jd-unplanned">Imprevista</small>' : ""}
      </td>
      <td class="jd-goal-cell"><span class="jd-goal" title="${esc(goal?.title || "Sin objetivo")}"><i style="--goal-color:${safeColor(goal?.color)}"></i>${esc(goal?.title || "Sin objetivo")}</span></td>
      <td class="jd-status-cell"><label class="jd-status jd-status-${statusClasses[statusIndex] || "pending"}"><i></i><span aria-hidden="true">${esc(task.status)}</span><select aria-label="Estado de ${title}" data-jd-status data-id="${taskId}">${statuses.map(status => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}</select></label></td>
      <td class="jd-duration-cell"><b>${task.segments.length ? esc(M().duration(M().minutes(task))) : "—"}</b>
        ${task.segments.length ? `<small>${esc(detail)}</small>` : ""}</td>
      <td class="jd-actions-cell"><div>
        ${timerAction ? `<button class="jd-row-act ${isActive ? "jd-pause" : "jd-start"}" type="button" title="${timerLabel}" aria-label="${timerLabel} ${title}" data-jd-act="${isActive ? "pause" : "start"}" data-id="${taskId}">${ctx.icon(isActive ? "pause" : "play", 15)}</button>` : ""}
        <button type="button" class="jd-row-act jd-edit" title="Editar actividad y horas" aria-label="Editar ${title}" data-jd-act="edit" data-id="${taskId}">${ctx.icon("pencil", 15)}</button>
      </div></td>
    </tr>`;
  }

  function activitySection(tasks, ctx) {
    const draft = quickDrafts.get(ctx.date) || {};
    const paste = bulkDrafts.get(ctx.date) || {};
    const visible = tasks.filter(matchFilter);
    if (order === "priority") {
      const rank = {Alta: 0, Media: 1, Baja: 2};
      visible.sort((a, b) => rank[a.priority] - rank[b.priority]);
    }
    const goals = new Map(ctx.state.goals.map(goal => [goal.id, goal]));
    const options = ["Todas", ...statuses, "Imprevistas", "Sin cumplir"];
    const head = `<div class="jd-section-heading"><div class="jd-table-title"><h2>Actividades del día</h2><span>${tasks.length}</span></div>
      <div class="jd-table-tools"><button class="jd-comments-toggle" type="button" data-jd-act="comments" aria-pressed="${showComments}" title="Mostrar u ocultar los comentarios de las actividades">${ctx.icon("eye", 14)} Comentarios</button><label class="jd-filter"><select aria-label="Ordenar actividades" data-jd-order><option value="plan">Orden del plan</option><option value="priority" ${order === "priority" ? "selected" : ""}>Prioridad</option></select></label>
      <label class="jd-filter">${ctx.icon("filter", 14)}<select aria-label="Filtrar actividades" data-jd-filter>${options.map(option => `<option ${option === filter ? "selected" : ""}>${option}</option>`).join("")}</select></label></div></div>`;
    const capture = `<form class="jd-quick" data-jd-form>
      <span class="jd-quick-plus" aria-hidden="true">${ctx.icon("plus", 17)}</span>
      <input name="title" maxlength="180" required aria-label="Nombre de actividad rápida" placeholder="Nueva actividad…" value="${esc(draft.title)}" autocomplete="off">
      <input name="context" maxlength="2000" aria-label="Contexto de actividad rápida" placeholder="Contexto (opcional)" value="${esc(draft.context)}" autocomplete="off">
      <select name="origin" aria-label="Origen de actividad rápida"><option>Planificada</option><option ${draft.origin === "Imprevista" ? "selected" : ""}>Imprevista</option></select>
      <button type="submit" title="Agregar actividad" aria-label="Agregar actividad rápida">${ctx.icon("corner-down-left", 15)}</button>
    </form>`;
    const bulk = `<details class="jd-import" data-jd-import ${paste.open ? "open" : ""}><summary>Pegar desde Excel</summary>
      <form data-jd-bulk><label for="jd-paste">Copia las columnas Actividad y Contexto. Cada fila será una actividad.</label>
      <textarea id="jd-paste" name="rows" placeholder="Pega las filas aquí" aria-label="Actividades y contextos de Excel">${esc(paste.raw)}</textarea>
      <div><span data-jd-count role="status">Se usará el origen elegido arriba.</span><button type="submit" disabled>Agregar filas</button></div></form></details>`;
    const reuse = `<details class="jd-import jd-reuse" data-jd-reuse ${reuseDrafts.get(ctx.date)?.open ? "open" : ""}><summary>Reutilizar actividades</summary><div data-jd-reuse-content></div></details>`;
    let table;
    if (visible.length) {
      table = `<div class="jd-table-scroll"><table class="jd-table">
        <thead><tr><th class="jd-check-cell"><span title="Avance cumplido" aria-label="Avance cumplido">${ctx.icon("check", 14)}</span></th>
        <th>Actividad / contexto</th><th class="jd-goal-cell">Objetivo</th><th>Estado</th><th>Tiempo</th><th class="jd-actions-cell"><span class="jd-sr">Acciones</span></th></tr></thead>
        <tbody>${visible.map(task => tableRow(task, ctx, goals.get(task.goalId))).join("")}</tbody></table></div>`;
    } else {
      table = `<div class="jd-empty">${ctx.icon(tasks.length ? "filter" : "list", 25)}<strong>${tasks.length ? "Ninguna actividad coincide con el filtro" : "Tu jornada está lista para planificar"}</strong>
        ${tasks.length ? '<button type="button" data-jd-act="clear">Ver todas las actividades</button>' : "<span>Escribe tu primera actividad y pulsa Enter.</span>"}</div>`;
    }
    return `<section class="jd-activities panel" aria-label="Actividades del día">${head}${capture}<div class="jd-shortcuts">${bulk}${reuse}</div>${table}</section>`;
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
    const details = el.querySelector("[data-jd-reuse]");
    const body = details.querySelector("[data-jd-reuse-content]");
    const draft = reuseDrafts.get(ctx.date) || {open:false, source:"", ids:new Set()};
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
          draft.open = false;
          filter = "Todas";
          ctx.render();
          el.querySelector("[data-jd-reuse] summary")?.focus();
          ctx.toast(count === 1 ? "Actividad copiada al plan." : count + " actividades copiadas al plan.");
        }
      };
    }
    details.ontoggle = () => {
      if (!details.isConnected) return;
      draft.open = details.open;
      if (details.open && !body.childElementCount) draw();
    };
    if (details.open) draw();
  }

  function installEvents(el, ctx) {
    el.onclick = async event => {
      const button = event.target.closest("[data-jd-act]");
      if (!button) return;
      const id = button.dataset.id;
      switch (button.dataset.jdAct) {
        case "add": ctx.openTask(null, {date:ctx.date}); break;
        case "edit": ctx.openTask(id); break;
        case "previous": ctx.setDate(M().shiftDate(ctx.date, -1)); break;
        case "next": ctx.setDate(M().shiftDate(ctx.date, 1)); break;
        case "today": ctx.setDate(M().today()); break;
        case "comments": showComments = !showComments; ctx.render(); break;
        case "clear": filter = "Todas"; ctx.render(); break;
        case "pause": await toggleTimer(ctx, id, true); break;
        case "start": await toggleTimer(ctx, id, false); break;
      }
    };
    el.onchange = async event => {
      const control = event.target;
      if (control.matches("[data-jd-date]")) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(control.value)) ctx.setDate(control.value);
      } else if (control.matches("[data-jd-order]")) {
        order = control.value;
        ctx.render();
      } else if (control.matches("[data-jd-filter]")) {
        filter = control.value;
        ctx.render();
      } else if (control.matches("[data-jd-done],[data-jd-status]")) {
        const saved = await ctx.mutate(state => {
          const task = state.tasks.find(item => item.id === control.dataset.id);
          if (!task) throw new Error("La actividad ya no existe.");
          if (control.matches("[data-jd-done]")) task.done = control.checked;
          else {
            if (openSegment(task) && control.value !== "En proceso") throw new Error("Pausa el bloque antes de cambiar el estado.");
            task.status = control.value;
          }
        });
        if (!saved) ctx.render();
      }
    };
    const form = el.querySelector("[data-jd-form]");
    const saveDraft = () => quickDrafts.set(ctx.date, Object.fromEntries(new FormData(form)));
    const bulk = el.querySelector("[data-jd-bulk]");
    const details = el.querySelector("[data-jd-import]");
    function previewBulk() {
      const output = bulk.querySelector("[data-jd-count]");
      const button = bulk.querySelector("button");
      try {
        const rows = rowsFromClipboard(bulk.elements.rows.value);
        output.textContent = rows.length ? rows.length + (rows.length === 1 ? " actividad" : " actividades") + " · " + form.elements.origin.value : "Se usará el origen elegido arriba.";
        button.disabled = !rows.length;
      } catch (error) {
        output.textContent = error.message;
        button.disabled = true;
      }
    }
    const storeBulk = () => bulkDrafts.set(ctx.date, {raw:bulk.elements.rows.value, open:details.open});
    details.ontoggle = () => { if (details.isConnected) storeBulk(); };
    bulk.elements.rows.oninput = () => { storeBulk(); previewBulk(); };
    previewBulk();
    bulk.onsubmit = async event => {
      event.preventDefault();
      const rows = rowsFromClipboard(bulk.elements.rows.value);
      if (!rows.length) return;
      const origin = form.elements.origin.value;
      const saved = await ctx.mutate(state => {
        for (const row of rows) state.tasks.push(M().task({date:ctx.date, title:row[0], context:row[1] || "", origin}));
      });
      if (saved) { bulkDrafts.delete(ctx.date); filter = "Todas"; ctx.render(); ctx.toast(rows.length + (rows.length === 1 ? " actividad agregada." : " actividades agregadas.")); }
    };
    form.elements.title.onpaste = event => {
      const content = event.clipboardData?.getData("text/plain") || "";
      if (!/[\t\n]/.test(content.trimEnd())) return;
      event.preventDefault();
      details.open = true;
      bulk.elements.rows.value = content;
      storeBulk();
      previewBulk();
      bulk.elements.rows.focus();
    };
    form.oninput = saveDraft;
    form.onchange = () => { saveDraft(); previewBulk(); };
    form.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const title = String(data.title).trim();
      if (!title) { form.elements.title.focus(); return; }
      const saved = await ctx.mutate(state => {
        state.tasks.push(M().task({date:ctx.date, title, context:String(data.context).trim(), origin:data.origin}));
      });
      if (saved) {
        quickDrafts.delete(ctx.date);
        filter = "Todas";
        ctx.render();
        el.querySelector("[data-jd-form] input[name=title]")?.focus();
        ctx.toast("Actividad agregada.");
      }
    };
  }

  function render(el, ctx) {
    if (ctx.date !== lastDate) { lastDate = ctx.date; filter = "Todas"; }
    const tasks = ctx.state.tasks.filter(task => task.date === ctx.date);
    el.innerHTML = `<div class="jd-view">${topSection(ctx)}${metrics(tasks, ctx)}${timeline(tasks, ctx)}${activitySection(tasks, ctx)}</div>`;
    installEvents(el, ctx);
    installReuse(el, ctx);
  }

  window.JAgenda = {render};
})();
