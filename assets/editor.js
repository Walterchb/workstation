(() => {
  'use strict';

  let activeDialog;

  function nextWorkday(date) {
    const value = new Date(date + 'T12:00:00Z');
    do { value.setUTCDate(value.getUTCDate() + 1); }
    while (value.getUTCDay() === 0 || value.getUTCDay() === 6);
    return value.toISOString().slice(0, 10);
  }

  function open(id, defaults, ctx) {
    if (ctx.canEdit?.() === false || activeDialog?.open) return;
    const existing = id ? ctx.state.tasks.find(item => item.id === id) : null;
    if (id && !existing) {
      ctx.toast('La actividad ya no está disponible.');
      return;
    }
    const model = window.JModel;
    const {priorities, origins, statuses} = model;
    const esc = window.JUI.esc;
    const options = defaults || {};
    const {tab: initialTab, ...initialValues} = options;
    const activity = existing || model.task({date:ctx.date, ...initialValues, category:model.categoryForNewTask(ctx.state,initialValues.category)},ctx.state);
    const categoryOptions = model.categoryOptions(ctx.state,activity.category).map(item =>
      '<option value="' + esc(item.title) + '"' + (activity.category === item.title ? ' selected' : '') + '>' +
      esc(item.title + (item.archived ? ' (archivada)' : '')) + '</option>').join('');
    const initialSnapshot = JSON.stringify(activity);
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-edit-dialog','');
    dialog.className = 'je-dialog';
    dialog.setAttribute('aria-labelledby','je-heading');
    activeDialog = dialog;

    const selectOptions = (values, selected) => values.map(value =>
      '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>'
    ).join('');
    const goalOptions = ctx.state.goals.map(goal =>
      '<option value="' + esc(goal.id) + '"' + (activity.goalId === goal.id ? ' selected' : '') + '>' + esc(goal.title) + '</option>'
    ).join('');

    dialog.innerHTML = `
      <form class="je-form" novalidate>
        <header class="je-head">
          <div class="je-head-copy">
            <h2 id="je-heading">${existing ? 'Editar actividad' : 'Nueva actividad'}</h2>
            ${existing ? '<p class="je-subtitle">' + esc(activity.title) + '</p>' : ''}
          </div>
          <button type="button" class="icon-btn je-close" aria-label="Cerrar editor">${ctx.icon('x',19)}</button>
        </header>
        <div class="je-tabs" role="tablist" aria-label="Secciones de la actividad">
          <button type="button" id="je-plan-tab" data-tab="plan" role="tab" aria-controls="je-plan">Planificación</button>
          <button type="button" id="je-log-tab" data-tab="log" role="tab" aria-controls="je-log">Registro de trabajo</button>
        </div>
        <div class="je-body">
          <section id="je-plan" data-panel="plan" role="tabpanel" aria-labelledby="je-plan-tab">
            <div class="je-grid">
              <label class="je-field je-wide"><span>Tipo de fila</span><select name="kind">
                <option value="activity">Actividad</option><option value="space">Espacio sin objetivo</option></select></label>
              <label class="je-field je-wide"><span data-title-label>Actividad</span>
                <input name="title" type="text" maxlength="180" required placeholder="Ej. Revisar el reporte de posición" value="${esc(activity.title)}" autocomplete="off">
              </label>
              <label class="je-field je-wide"><span>Contexto</span>
                <textarea name="context" rows="2" maxlength="2000" placeholder="¿Qué necesitas avanzar exactamente?">${esc(activity.context)}</textarea>
              </label>
              <label class="je-field"><span>Fecha</span><input name="date" type="date" required value="${esc(activity.date)}"></label>
              <label class="je-field" data-activity-field><span>Prioridad</span><select name="priority">${selectOptions(priorities,activity.priority)}</select></label>
              <label class="je-field je-wide" data-activity-field><span>Objetivo general</span><select name="goalId"><option value="">Sin objetivo</option>${goalOptions}</select></label>
              <label class="je-field" data-activity-field><span>Categoría</span><select name="category">${categoryOptions}</select></label>
              <label class="je-field" data-activity-field><span>Origen</span><select name="origin">${selectOptions(origins,activity.origin)}</select></label>
            </div>
          </section>
          <section id="je-log" data-panel="log" role="tabpanel" aria-labelledby="je-log-tab">
            <div class="je-interval-heading"><h3>Tramos registrados</h3><span class="je-duration"></span></div>
            <div class="je-rows"></div>
            <button type="button" class="je-text-btn je-add">+ Añadir tramo</button>
            <p class="je-help">Deja la hora de fin vacía mientras el tramo siga abierto.</p>
            <div class="je-grid je-log-fields">
              <label class="je-field"><span>Estado</span><select name="status">${selectOptions(statuses,activity.status)}</select></label>
              <label class="je-check"><input name="done" type="checkbox"${activity.done ? ' checked' : ''}><span>Cumplí lo previsto</span></label>
              <label class="je-field je-wide"><span>Comentarios y evidencia</span>
                <textarea name="comment" rows="3" placeholder="Ej. Envié la consulta al área comercial y recibí su confirmación.">${esc(activity.comment)}</textarea>
              </label>
            </div>
          </section>
          <div class="je-continuation" hidden>
            <label class="je-field"><span>Continuar el</span><input type="date" name="nextDate"></label>
            <p>Se copiará la planificación a la nueva fecha. Las horas y los comentarios quedarán en la fecha original.</p>
          </div>
          <p class="je-error" role="alert" hidden></p>
        </div>
        <footer class="je-foot">
          <div class="je-foot-actions">
            ${existing ? '<button type="button" class="je-text-btn je-remove">Eliminar</button><button type="button" class="je-text-btn je-continue">Continuar otro día</button>' : ''}
          </div>
          <div class="je-save-actions">
            <button type="button" class="btn ghost je-cancel">Cancelar</button>
            <button type="submit" class="btn primary je-save">${existing ? 'Guardar cambios' : 'Crear actividad'}</button>
          </div>
        </footer>
        <div class="je-confirm" hidden>
          <p><strong>¿Eliminar este registro?</strong><br>Se eliminarán también sus tramos y comentarios.</p>
          <button type="button" class="btn ghost je-keep">Conservar</button>
          <button type="button" class="btn je-danger">Sí, eliminar</button>
        </div>
      </form>`;

    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    const fields = form.elements;
    const rows = dialog.querySelector('.je-rows');
    const body = dialog.querySelector('.je-body');
    const footer = dialog.querySelector('.je-foot');
    const error = dialog.querySelector('.je-error');
    const continuation = dialog.querySelector('.je-continuation');
    const confirm = dialog.querySelector('.je-confirm');
    const saveButton = dialog.querySelector('.je-save');
    let busy = false;
    let continuationOpen = false;

    function showKind() {
      const space = fields.kind.value === 'space';
      for (const field of dialog.querySelectorAll('[data-activity-field]')) field.hidden = space;
      dialog.querySelector('[data-title-label]').textContent = space ? 'Nombre del espacio' : 'Actividad';
      fields.title.placeholder = space ? 'Ej. Almuerzo' : 'Ej. Revisar el reporte de posición';
      dialog.querySelector('#je-heading').textContent = space ? (existing ? 'Editar espacio' : 'Nuevo espacio') :
        (existing ? 'Editar actividad' : 'Nueva actividad');
      if (!existing) saveButton.textContent = space ? 'Crear espacio' : 'Crear actividad';
    }
    fields.kind.value = activity.kind || 'activity';
    fields.kind.addEventListener('change',showKind);
    showKind();

    function selectTab(name, focusTab = false) {
      dialog.querySelectorAll('[data-tab]').forEach(button => {
        const selected = button.dataset.tab === name;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (focusTab && selected) button.focus();
      });
      dialog.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
      body.scrollTop = 0;
    }

    function readSegments() {
      return Array.from(rows.querySelectorAll('.je-row'), row => ({
        start:row.querySelector('[data-start]').value, end:row.querySelector('[data-end]').value
      }));
    }

    function updateDuration() {
      const segments = readSegments().filter(item => item.start && item.end && item.end > item.start);
      dialog.querySelector('.je-duration').textContent = 'Total · ' + model.duration(model.minutes({...activity,date:fields.date.value,segments}));
      rows.dataset.empty = String(!rows.querySelector('.je-row'));
    }

    function appendSegment(segment = {start:'',end:''}, focus = false) {
      const row = document.createElement('div');
      row.className = 'je-row';
      row.innerHTML = `
        <label class="je-field"><span>Inicio</span><input data-start type="time" step="60" required></label>
        <label class="je-field"><span>Fin</span><input data-end type="time" step="60"></label>
        <button type="button" class="icon-btn je-remove-row" aria-label="Quitar tramo">${ctx.icon('x',16)}</button>`;
      const start = row.querySelector('[data-start]');
      start.value = segment.start;
      row.querySelector('[data-end]').value = segment.end;
      row.querySelector('button').addEventListener('click', () => {
        row.remove();
        updateDuration();
        dialog.querySelector('.je-add').focus();
      });
      rows.appendChild(row);
      updateDuration();
      if (focus) start.focus();
    }

    function showError(message) {
      error.textContent = message;
      error.hidden = !message;
      if (message) error.scrollIntoView({block:'nearest'});
    }

    function readActivity() {
      return {...activity, title:fields.title.value.trim(), context:fields.context.value.trim(),
        date:fields.date.value, priority:fields.priority.value, category:fields.category.value,
        origin:fields.origin.value, kind:fields.kind.value, goalId:fields.kind.value === 'space' ? '' : fields.goalId.value, status:fields.status.value,
        done:fields.done.checked, comment:fields.comment.value.trim(), segments:readSegments()};
    }

    function validFields() {
      fields.title.setCustomValidity(fields.title.value.trim() ? '' : 'Escribe un nombre.');
      if (continuationOpen) {
        fields.nextDate.setCustomValidity(fields.nextDate.value <= fields.date.value ? 'Elige una fecha posterior a la actividad.' : '');
      } else {
        fields.nextDate.setCustomValidity('');
      }
      for (const field of Array.from(fields)) {
        if (!field.willValidate || field.validity.valid) continue;
        const panel = field.closest('[data-panel]');
        if (panel) selectTab(panel.dataset.panel);
        field.reportValidity();
        return false;
      }
      return true;
    }

    function setBusy(pending) {
      busy = pending;
      form.setAttribute('aria-busy',String(pending));
      form.inert = pending;
    }

    function ensureCurrent(state) {
      const index = state.tasks.findIndex(item => item.id === activity.id);
      if (existing && (index < 0 || JSON.stringify(state.tasks[index]) !== initialSnapshot)) {
        throw new Error('Esta actividad cambió. Cierra el editor y vuelve a abrirla para ver la última versión.');
      }
      if (!existing && index >= 0) throw new Error('Esta actividad ya está registrada.');
      return index;
    }

    async function persist(remove = false) {
      if (busy || (!remove && !validFields())) return;
      showError('');
      const updated = readActivity();
      if (!remove && updated.segments.some(segment => !segment.end)) {
        if (updated.status === 'Culminado') {
          selectTab('log');
          showError('Completa la hora de fin de todos los tramos antes de marcar la actividad como culminada.');
          return;
        }
        updated.status = 'En proceso';
        fields.status.value = updated.status;
      }
      let following;
      if (!remove && continuationOpen) {
        following = model.task({title:updated.title, context:updated.context, goalId:updated.goalId, kind:updated.kind,
          category:model.categoryForNewTask(ctx.state,updated.category), priority:updated.priority, origin:'Planificada', date:fields.nextDate.value,
          status:'Pendiente',done:false,comment:'',segments:[]});
      }
      function apply(state) {
        const index = ensureCurrent(state);
        if (remove) { state.tasks.splice(index,1); return; }
        if (index >= 0) state.tasks[index] = updated;
        else state.tasks.push(updated);
        if (following) state.tasks.push(following);
      }

      try {
        const check = { ...ctx.state, tasks: [...ctx.state.tasks] };
        apply(check);
        model.validate(check);
        setBusy(true);
        const saved = await ctx.mutate(apply);
        if (!saved) {
          confirm.hidden = true;
          footer.hidden = false;
          showError('No se guardó el cambio. Tus datos siguen en este formulario.');
          return;
        }
        dialog.close();
        const space = updated.kind === 'space';
        ctx.toast(remove ? (space ? 'Espacio eliminado.' : 'Actividad eliminada.') : following ? 'Avance guardado y continuación planificada.' :
          existing ? 'Cambios guardados.' : (space ? 'Espacio creado.' : 'Actividad creada.'));
      } catch (err) {
        showError(err.message || 'No se pudo guardar la actividad.');
      } finally {
        setBusy(false);
      }
    }

    function stopDelete() {
      confirm.hidden = true;
      footer.hidden = false;
      dialog.querySelector('.je-remove')?.focus();
    }

    dialog.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => selectTab(button.dataset.tab));
      button.addEventListener('keydown', event => {
        if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
          event.preventDefault();
          const tab = event.key === 'Home' ? 'plan' : event.key === 'End' ? 'log' : button.dataset.tab === 'plan' ? 'log' : 'plan';
          selectTab(tab,true);
        }
      });
    });
    rows.addEventListener('input',updateDuration);
    fields.date.addEventListener('change',updateDuration);
    dialog.querySelector('.je-add').addEventListener('click', () => appendSegment(undefined,true));
    dialog.querySelector('.je-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.je-cancel').addEventListener('click', () => dialog.close());
    dialog.querySelector('.je-continue')?.addEventListener('click', event => {
      continuationOpen = !continuationOpen;
      continuation.hidden = !continuationOpen;
      fields.nextDate.disabled = !continuationOpen;
      fields.nextDate.required = continuationOpen;
      if (continuationOpen) {
        const base = fields.date.value || activity.date;
        const next = nextWorkday(base);
        fields.nextDate.value = next < model.today() ? model.today() : next;
        fields.nextDate.focus();
        continuation.scrollIntoView({block:'nearest'});
      }
      event.currentTarget.textContent = continuationOpen ? 'Quitar continuación' : 'Continuar otro día';
      event.currentTarget.setAttribute('aria-expanded',String(continuationOpen));
      saveButton.textContent = continuationOpen ? 'Guardar y continuar' : 'Guardar cambios';
    });
    fields.nextDate.disabled = true;
    dialog.querySelector('.je-continue')?.setAttribute('aria-expanded','false');
    dialog.querySelector('.je-remove')?.addEventListener('click', () => {
      footer.hidden = true;
      confirm.hidden = false;
      dialog.querySelector('.je-keep').focus();
    });
    dialog.querySelector('.je-keep').addEventListener('click',stopDelete);
    dialog.querySelector('.je-danger').addEventListener('click',() => persist(true));
    form.addEventListener('submit',event => { event.preventDefault(); if (confirm.hidden) persist(); });
    dialog.addEventListener('cancel',event => {
      if (busy) event.preventDefault();
      else if (!confirm.hidden) { event.preventDefault(); stopDelete(); }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      activeDialog = null;
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
    },{once:true});
    activity.segments.forEach(segment => appendSegment(segment));
    updateDuration();
    const tab = ['plan','log'].includes(initialTab) ? initialTab : existing ? 'log' : 'plan';
    selectTab(tab);
    dialog.showModal();
    if (tab === 'plan') fields.title.focus({preventScroll:true});
    else dialog.querySelector('#je-log-tab').focus({preventScroll:true});
  }

  window.JEditor = {open};
})();
