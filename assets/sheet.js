/* Edición de una jornada completa en una sola transacción. */
(() => {
  'use strict';

  const columns = ['Estado', 'Actividades', 'Contexto', '¿Se hizo?', 'Hora de inicio', 'Hora de cierre', 'Duración', 'Comentarios'];
  const fields = ['status', 'title', 'context', 'done', 'start', 'end', 'duration', 'comment'];
  const esc = value => window.JUI.esc(value);
  let currentDialog = null;

  function option(value, selected, label = value) {
    return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function durationValue(segments) {
    let minutes = 0;
    for (const part of segments) {
      if (!part.start || !part.end || part.end <= part.start) continue;
      minutes += window.JModel.minutes({segments:[part]});
    }
    return minutes;
  }

  function hourCount(value) {
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2,'0');
  }

  function cellControl(row, index, col, seg = 0) {
    const field = fields[col];
    const attrs = 'data-col="' + col + '" aria-label="' + columns[col] + ', fila ' + (index + 1) +
      ((col === 4 || col === 5) ? ', tramo ' + (seg + 1) : '') + '"';
    if (col === 0) {
      return '<select ' + attrs + ' data-status="' + esc(row.status) + '">' +
        window.JModel.statuses.map(v => option(v,row.status)).join('') + '</select>';
    }
    if (col === 3) return '<input type="checkbox" ' + attrs + (row.done ? ' checked' : '') + '>';
    if (col === 4 || col === 5) {
      const value = row.segments[seg]?.[field] || '';
      return '<input type="time" step="60" data-seg="' + seg + '" ' + attrs + ' value="' + esc(value) + '">';
    }
    if (col === 6) return '<output data-duration aria-label="Duración calculada">' + hourCount(durationValue(row.segments)) + '</output>';
    const hint = col === 1 ? 'Escribe una actividad' : col === 2 ? 'Añade contexto' : '';
    return '<textarea rows="2" spellcheck="true" ' + attrs + (hint ? ' placeholder="' + hint + '"' : '') + '>' + esc(row[field]) + '</textarea>';
  }

  function rowMarkup(row, index, selected) {
    const segCount = Math.max(1,row.segments.length);
    const cells = columns.map((label,col) => {
      const markup = (col === 4 || col === 5) ?
        Array.from({length:segCount},(_,seg) => cellControl(row,index,col,seg)).join('') : cellControl(row,index,col);
      return '<td class="jsheet-c-' + fields[col] + '">' + markup + '</td>';
    }).join('');
    return '<tr data-index="' + index + '"' + (index === selected ? ' class="jsheet-current"' : '') +
      '><th scope="row"><button type="button" data-act="row" tabindex="-1" title="Detalle de la fila ' +
      (index + 1) + '" aria-label="Detalle de la fila ' + (index+1) + '">' + (index + 1) + '</button>' +
      '<button class="jsheet-between" type="button" data-act="between" tabindex="-1" title="Insertar debajo" aria-label="Insertar actividad debajo de la fila ' +
      (index+1) + '">+</button></th>' + cells + '</tr>';
  }

  function open(ctx, options={}) {
    if (currentDialog?.open) return;
    const model = window.JModel;
    const sheet = window.JSheetModel;
    const draft = sheet.createDraft(ctx.state,ctx.date);
    const baseline = JSON.stringify(draft.baseline);
    const savedIds = new Set(draft.baseline.map(row=>row.id));
    const requested = options.taskId ? draft.rows.findIndex(row=>row.id===options.taskId) : -1;
    if (requested < 0) draft.rows.push(sheet.newRow(draft));
    let mode = requested < 0 ? 'plan' : 'full';
    try { if (requested < 0 && localStorage.getItem('workhub:sheet-mode') === 'full') mode = 'full'; } catch { /* El modo también funciona sin almacenamiento. */ }
    if (['plan','full'].includes(options.mode)) mode = options.mode;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'jsheet';
    dialog.setAttribute('aria-labelledby','jsheet-title');
    currentDialog = dialog;
    let selected = requested < 0 ? draft.rows.length-1 : requested;
    let selectedSegment = 0;
    let panel = '';
    let pending = '';
    let busy = false;
    let sourceDate = '';
    let reuseIds = new Set();
    let planText = '', planPosition = 'here', planRows = [];
    const commandKey = /Mac|iPhone|iPad/i.test(navigator.platform || '') ? '⌘' : 'Ctrl';

    const icon = (name,size=16) => ctx.icon(name,size);
    const action = (key,text,name='') => '<button type="button" data-act="' + key + '">' + (name ? icon(name) : '') + text + '</button>';
    const dateLabel = model.formatDate(ctx.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    dialog.innerHTML = `
      <div class="jsheet-layout">
        <header class="jsheet-head"><div><h2 id="jsheet-title">Editar actividades</h2><p>${esc(dateLabel)}</p></div>
          <button class="icon-btn" type="button" data-act="cancel" aria-label="Cerrar edición">${icon('x',19)}</button></header>
        <div class="jsheet-command"><div class="jsheet-modes" role="group" aria-label="Vista de la hoja">
          <button type="button" data-act="mode-plan">Planificar</button><button type="button" data-act="mode-full">Registro completo</button></div>
          <button class="jsheet-paste-plan" type="button" data-act="import">${icon('list',15)}Pegar plan</button></div>
        <div class="jsheet-tools" role="group" aria-label="Herramientas de la hoja">
          <div class="jsheet-tool-group"><button class="jsheet-add" type="button" data-act="append">${icon('plus')}Añadir fila</button>
            <details class="jsheet-menu"><summary>Opciones de fila ${icon('chevron-down',13)}</summary>
              <div>${action('insert-before','Insertar encima')}${action('insert-after','Insertar debajo')}${action('up','Mover arriba')}${action('down','Mover abajo')}${action('remove','Eliminar fila')}${action('copy-sheet','Copiar hoja')}</div>
            </details></div>
          <div class="jsheet-tool-group jsheet-clock-tools">${action('add-segment','Añadir tramo','plus')}<button type="button" data-act="timer"></button></div>
          <div class="jsheet-tool-group">${action('details','Detalle de fila','layers')}${action('reuse','Reutilizar','list')}</div>
        </div>
        <div class="jsheet-extra" hidden></div>
        <div class="jsheet-guide"><p class="jsheet-tip" id="jsheet-tip"></p>
          <details class="jsheet-keys"><summary>Atajos de teclado</summary><dl>
            <div><dt>Tab / Mayús + Tab</dt><dd>Siguiente celda / anterior</dd></div>
            <div><dt>Enter / Mayús + Enter</dt><dd>Bajar / subir una fila</dd></div>
            <div><dt>${commandKey} + Enter</dt><dd>Insertar actividad debajo</dd></div>
            <div><dt>${commandKey} + Mayús + Enter</dt><dd>Insertar actividad encima</dd></div>
            <div><dt>Alt + Enter</dt><dd>Salto de línea en el texto</dd></div>
            <div><dt>${commandKey} + S</dt><dd>Guardar jornada</dd></div></dl></details></div>
        <div class="jsheet-scroll" tabindex="0" role="region" aria-label="Hoja de horario desplazable" aria-describedby="jsheet-tip">
          <table class="jsheet-table" aria-label="Horario editable"><colgroup><col class="jsheet-col-row">${fields.map(v=>'<col class="jsheet-col-'+v+'">').join('')}</colgroup>
            <thead><tr><th scope="col" aria-label="Fila">N°</th>${columns.map(name=>'<th scope="col">'+name+'</th>').join('')}</tr></thead><tbody></tbody></table>
          <button class="jsheet-bottom-add" data-act="append-bottom" type="button">${icon('plus',14)}Añadir actividad al final</button>
        </div>
        <div class="jsheet-notice" role="status" aria-live="polite" hidden></div>
        <div class="jsheet-alert" role="alert" hidden></div>
        <footer class="jsheet-foot"><div class="jsheet-summary"></div><div class="jsheet-foot-actions">
          <button class="btn ghost" type="button" data-act="cancel">Cancelar</button>
          <button class="btn primary" type="button" data-act="save">${icon('check')}Guardar jornada</button>
        </div></footer>
        <div class="jsheet-confirm" hidden><p></p><div>${action('keep','Seguir editando')}${action('discard','Descartar cambios')}</div></div>
      </div>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    const tbody = $('tbody');
    const scroll = $('.jsheet-scroll');
    const extra = $('.jsheet-extra');
    const errorBox = $('.jsheet-alert');
    const noticeBox = $('.jsheet-notice');
    const footer = $('.jsheet-foot');
    const confirm = $('.jsheet-confirm');
    const menu = $('.jsheet-menu');
    const btn = name => $('[data-act="' + name + '"]');
    const dirty = () => JSON.stringify(draft.rows.filter(row=>savedIds.has(row.id) || !sheet.isUnused(draft,row))) !== baseline;
    const selectedRow = () => draft.rows[selected];

    function feedback(text='',error=false) {
      for (const node of [errorBox,noticeBox]) { node.hidden = true; node.textContent = ''; }
      if (text) {
        const node = error ? errorBox : noticeBox;
        node.textContent = text;
        node.hidden = false;
      }
    }

    function focusCell(index,col=1,seg=0) {
      const row = tbody.querySelector('tr[data-index="' + index + '"]');
      const selector = '[data-col="' + col + '"]';
      const field = row?.querySelector(selector + '[data-seg="' + seg + '"]') || row?.querySelector(selector);
      if (field) {
        field.focus({preventScroll:true});
        field.scrollIntoView({block:'nearest',inline:'nearest'});
      }
    }

    function refreshSummary() {
      const count = draft.rows.filter(row=>row.title.trim()).length;
      const total = draft.rows.reduce((sum,row)=>sum+durationValue(row.segments),0);
      const text = count + (count === 1 ? ' actividad' : ' actividades') + ' · ' + model.duration(total);
      $('.jsheet-summary').innerHTML = '<b>' + esc(text) + '</b><span>' + (dirty() ? 'Cambios sin guardar' : 'Sin cambios') + '</span>';
    }

    function refreshControls() {
      const row = selectedRow();
      dialog.dataset.mode = mode;
      btn('mode-plan').setAttribute('aria-pressed',String(mode==='plan'));
      btn('mode-full').setAttribute('aria-pressed',String(mode==='full'));
      btn('import').setAttribute('aria-expanded',String(panel==='import'));
      $('.jsheet-tip').textContent = mode==='plan' ?
        'Tab pasa de Actividad a Contexto. Al terminar el contexto, Tab lleva a la siguiente actividad.' :
        'Registra las horas, el estado y los comentarios de cada actividad.';
      const active = row?.segments.some(part => part.start && !part.end);
      const timer = btn('timer');
      timer.hidden = draft.date !== model.today();
      timer.disabled = !row;
      timer.innerHTML = icon(active ? 'pause' : 'play') + (active ? 'Marcar cierre' : 'Marcar inicio');
      timer.title = 'Anota la hora actual de Lima en la fila seleccionada.';
      btn('up').disabled = selected < 1;
      btn('down').disabled = !row || selected >= draft.rows.length - 1;
      for (const key of ['remove','add-segment','details','insert-before','insert-after']) btn(key).disabled = !row;
      btn('reuse').setAttribute('aria-expanded',String(panel === 'reuse'));
      btn('details').setAttribute('aria-expanded',String(panel === 'details'));
      $('.jsheet-menu summary').title = row ? 'Acciones para la fila ' + (selected + 1) : 'Opciones de fila';
    }

    function drawTable(focus = null) {
      const left = scroll.scrollLeft, top = scroll.scrollTop;
      tbody.innerHTML = draft.rows.map((row,i)=>rowMarkup(row,i,selected)).join('');
      scroll.scrollLeft = left; scroll.scrollTop = top;
      refreshControls(); refreshSummary();
      if (panel) drawPanel();
      if (focus) focusCell(selected,focus.col,focus.seg);
    }

    function select(index,seg=0) {
      if (!draft.rows[index]) return;
      const old = selected;
      selected = index;
      selectedSegment = Math.min(Math.max(0,seg),Math.max(0,selectedRow().segments.length-1));
      if (index !== old) {
        tbody.querySelector('.jsheet-current')?.classList.remove('jsheet-current');
        tbody.querySelector('[data-index="' + index + '"]')?.classList.add('jsheet-current');
        refreshControls();
        if (panel === 'details') drawPanel();
        if (panel === 'import') updatePlanPreview();
      } else if (panel === 'details' && extra.querySelector('[data-segment-pick]')) {
        extra.querySelector('[data-segment-pick]').value = String(selectedSegment);
      }
    }

    function detailSelect(name,label,items) {
      const row = selectedRow();
      return '<label>' + label + '<select data-detail="' + name + '">' + items.map(entry=>
        Array.isArray(entry) ? option(entry[0],row[name],entry[1]) : option(entry,row[name])
      ).join('') + '</select></label>';
    }

    function workingState() {
      return {...ctx.state,tasks:[...ctx.state.tasks.filter(item=>item.date!==draft.date),...draft.rows]};
    }

    function importAt(atEnd=false) {
      const anchor = atEnd ? draft.rows.length-1 : selected;
      return sheet.isUnused(draft,draft.rows[anchor]) ? anchor : anchor+1;
    }

    function updatePlanPreview() {
      const holder = extra.querySelector('[data-plan-preview]');
      if (!holder) return;
      const submit = btn('insert-plan');
      const index = importAt(planPosition==='end');
      const here = extra.querySelector('[data-plan-position] option[value="here"]');
      here.textContent = (sheet.isUnused(draft,selectedRow()) ? 'En la fila vacía ' : 'Debajo de la fila ') + (selected+1);
      try {
        planRows = sheet.readPlan(sheet.parseTSV(planText));
        submit.disabled = !planRows.length;
        if (!planRows.length) {
          holder.textContent = planText.trim() ? 'No hay actividades para insertar.' : '';
          return;
        }
        const count = planRows.length===1 ? '1 actividad' : planRows.length+' actividades';
        const preview = planRows.slice(0,3).map((row,i)=>'<li><span>'+ (index+i+1) + '</span><strong>' +
          esc(row.title) + '</strong><span>' + esc(row.context) + '</span></li>').join('');
        holder.innerHTML = '<p>' + count + ' desde la fila ' + (index+1) + '</p><ol>' + preview + '</ol>' +
          (planRows.length>3 ? '<small>+' + (planRows.length-3) + ' más</small>' : '');
      } catch (err) {
        planRows=[]; submit.disabled=true; holder.textContent=err.message;
      }
    }

    function drawPanel() {
      extra.hidden = !panel;
      if (!panel) { extra.replaceChildren(); return; }
      if (panel === 'import') {
        extra.innerHTML = '<div class="jsheet-extra-head"><strong>Pegar plan desde Excel</strong>' + action('hide-extra','Cerrar') +
          '</div><label class="jsheet-import-label" for="jsheet-plan">Pega Actividad y Contexto, una actividad por fila. El encabezado es opcional.</label>' +
          '<textarea id="jsheet-plan" data-plan-input rows="3" spellcheck="false">' + esc(planText) + '</textarea>' +
          '<div class="jsheet-import-actions"><label>Ubicación <select data-plan-position>' + option('here',planPosition,'Fila seleccionada') +
          option('end',planPosition,'Al final de la jornada') + '</select></label>' + action('insert-plan','Insertar actividades','plus') +
          '</div><div data-plan-preview aria-live="polite"></div>';
        updatePlanPreview(); return;
      }
      if (panel === 'details') {
        const row = selectedRow();
        if (!row) { panel = ''; drawPanel(); return; }
        const goals = [['','Sin objetivo'],...ctx.state.goals.map(g=>[g.id,g.title])];
        const title = row.title.trim() || 'Nueva actividad';
        const segmentOptions = Array.from({length:Math.max(1,row.segments.length)},(_,i)=>option(String(i),String(selectedSegment),'Tramo ' + (i+1)));
        extra.innerHTML = '<div class="jsheet-extra-head"><strong>Fila ' + (selected+1) + ' · ' + esc(title) +
          '</strong>' + action('hide-extra','Cerrar') + '</div><div class="jsheet-details">' +
          detailSelect('goalId','Objetivo general',goals) + detailSelect('priority','Prioridad',model.priorities) +
          detailSelect('origin','Origen',model.origins) + detailSelect('category','Categoría',model.categoryOptions(ctx.state,row.category).map(category => [category.title, category.title + (category.archived ? ' (archivada)' : '')])) +
          '</div><div class="jsheet-segments"><label>Tramo seleccionado <select data-segment-pick>' + segmentOptions +
          '</select></label>' + action('remove-segment','Quitar tramo') + '</div>';
        extra.querySelector('[data-act="remove-segment"]').disabled = !row.segments.length;
        return;
      }
      const dates = [...new Set(ctx.state.tasks.filter(item=>item.date<draft.date).map(item=>item.date))].sort().reverse();
      if (!dates.includes(sourceDate)) sourceDate = dates[0] || '';
      if (!sourceDate) {
        extra.innerHTML = '<div class="jsheet-extra-head"><strong>Reutilizar actividades</strong>' + action('hide-extra','Cerrar') +
          '</div><p>Las actividades de jornadas anteriores aparecerán aquí.</p>';
        return;
      }
      const candidates = model.reusableActivities(workingState(),sourceDate,draft.date);
      const available = new Set(candidates.filter(x=>!x.reason).map(x=>x.activity.id));
      reuseIds = new Set([...reuseIds].filter(id=>available.has(id)));
      extra.innerHTML = '<div class="jsheet-extra-head"><label>Jornada de origen <select data-source>' +
        dates.map(day=>option(day,sourceDate,model.formatDate(day,{day:'numeric',month:'short',year:'numeric'}))).join('') +
        '</select></label>' + action('hide-extra','Cerrar') + '</div><div class="jsheet-reuse-rows">' +
        candidates.map(({activity,reason})=>'<label><input type="checkbox" data-reuse-id="' + esc(activity.id) + '"' +
          (reason ? ' disabled' : '') + (reuseIds.has(activity.id) ? ' checked' : '') + '><span>' + esc(activity.title) +
          (reason ? '<small>' + esc(reason) + '</small>' : '') + '</span></label>').join('') +
        '</div><div class="jsheet-reuse-foot">' + action('copy-rows','Añadir seleccionadas') + '</div>';
      btn('copy-rows').disabled = !reuseIds.size;
    }

    function readCell(control) {
      const tr = control.closest('tr[data-index]');
      if (!tr || !control.hasAttribute('data-col')) return;
      const index = Number(tr.dataset.index), col = Number(control.dataset.col);
      const row = draft.rows[index];
      if (col === 4 || col === 5) {
        const seg = Number(control.dataset.seg);
        while (row.segments.length <= seg) row.segments.push({start:'',end:''});
        row.segments[seg][fields[col]] = control.value;
        tr.querySelector('[data-duration]').textContent = hourCount(durationValue(row.segments));
      } else row[fields[col]] = col === 3 ? control.checked : control.value;
      if (col === 0) control.dataset.status = control.value;
      if (col === 1 && panel === 'details') {
        const head = extra.querySelector('.jsheet-extra-head strong');
        if (head) head.textContent = 'Fila ' + (index+1) + ' · ' + (row.title.trim() || 'Nueva actividad');
      }
      refreshControls(); refreshSummary(); feedback();
    }

    function updateField(event) {
      const el = event.target;
      if (el.matches('[data-col]')) readCell(el);
      if (el.matches('[data-detail]')) {
        selectedRow()[el.dataset.detail] = el.value;
        refreshSummary(); feedback();
      } else if (el.matches('[data-segment-pick]')) selectedSegment = Number(el.value);
      else if (el.matches('[data-plan-position]')) { planPosition=el.value; updatePlanPreview(); }
      else if (el.matches('[data-source]')) { sourceDate = el.value; reuseIds.clear(); drawPanel(); }
      else if (el.matches('[data-reuse-id]')) {
        if (el.checked) reuseIds.add(el.dataset.reuseId); else reuseIds.delete(el.dataset.reuseId);
        btn('copy-rows').disabled = !reuseIds.size;
      }
    }

    function newAt(index) {
      sheet.insertRow(draft,index);
      selected = index; selectedSegment = 0;
      drawTable({col:1}); feedback();
    }

    function appendActivity() {
      const last = draft.rows.length-1;
      if (sheet.isUnused(draft,draft.rows[last])) { focusCell(last,1); return; }
      newAt(draft.rows.length);
    }

    function insertPlan(rows,position,fromPreview=false) {
      const count = sheet.insertPlan(draft,position,rows);
      if (!count) return;
      selected=position; selectedSegment=0;
      if (fromPreview) { planText=''; planRows=[]; panel=''; }
      drawPanel(); drawTable({col:1});
      feedback(count===1 ? 'Una actividad insertada.' : count+' actividades insertadas en el orden de Excel.');
    }

    function showConfirm(kind) {
      pending = kind;
      confirm.hidden = false; footer.hidden = true;
      const remove = kind === 'remove', segment = kind === 'remove-segment';
      confirm.querySelector('p').textContent = remove ? '¿Quitar la fila ' + (selected+1) + ' y sus tramos de esta jornada?' :
        segment ? '¿Quitar el tramo ' + (selectedSegment+1) + ' de la fila ' + (selected+1) + '?' : 'Tienes cambios sin guardar. ¿Descartar la edición de esta jornada?';
      btn('discard').textContent = remove ? 'Quitar fila' : segment ? 'Quitar tramo' : 'Descartar cambios';
      for (const node of [$('.jsheet-head'),$('.jsheet-command'),$('.jsheet-tools'),$('.jsheet-guide'),extra,scroll]) node.inert = true;
      btn('keep').focus();
    }

    function hideConfirm() {
      pending = '';
      confirm.hidden = true; footer.hidden = false;
      for (const node of [$('.jsheet-head'),$('.jsheet-command'),$('.jsheet-tools'),$('.jsheet-guide'),extra,scroll]) node.inert = false;
    }

    function requestClose() {
      if (busy || pending) return;
      if (dirty() || planText.trim()) showConfirm('discard');
      else dialog.close();
    }

    function timerAction() {
      if (draft.date !== model.today()) return;
      const row = selectedRow();
      if (!row.title.trim()) { feedback('Escribe el nombre de la actividad antes de registrar el inicio.',true); focusCell(selected,1); return; }
      const now = model.timeNow();
      const current = row.segments.find(part=>part.start && !part.end);
      if (current) {
        if (current.start > now) { feedback('La hora de inicio es posterior a la hora actual.',true); return; }
        if (current.start === now) row.segments.splice(row.segments.indexOf(current),1);
        else current.end = now;
      } else {
        const working = workingState();
        const openTask = working.tasks.find(t=>t.segments.some(part=>part.start && !part.end));
        if (openTask) { feedback('Primero cierra el tramo abierto de «' + openTask.title + '» del ' + openTask.date + '.',true); return; }
        if (working.tasks.some(t=>t.date===draft.date && t.segments.some(part=>part.end>now))) {
          feedback('Hay tramos registrados después de la hora actual. Revisa las horas de la jornada.',true); return;
        }
        const last = row.segments.at(-1);
        if (last && !last.start && !last.end) last.start = now;
        else row.segments.push({start:now,end:''});
        row.status = 'En proceso';
      }
      drawTable();
      feedback(current ? 'Cierre marcado en la hoja.' : 'Inicio marcado a las ' + now + '.');
    }

    async function save() {
      if (busy || pending) return;
      if (planText.trim()) {
        panel='import'; drawPanel(); refreshControls();
        feedback('El plan pegado está en la vista previa. Insértalo en la hoja o borra el texto antes de guardar.',true);
        (planRows.length ? btn('insert-plan') : extra.querySelector('[data-plan-input]')).focus(); return;
      }
      if (!dirty()) { dialog.close(); return; }
      feedback();
      try {
        sheet.applyDay({...ctx.state,tasks:[...ctx.state.tasks]},draft);
      } catch (err) {
        if (Number.isInteger(err.rowIndex) && draft.rows[err.rowIndex]) {
          select(err.rowIndex,err.segmentIndex || 0);
          const col = fields.indexOf(err.field);
          if (mode==='plan' && col>=0 && ![1,2].includes(col)) { mode='full'; refreshControls(); }
          focusCell(selected, col < 0 ? 1 : col,selectedSegment);
        }
        feedback(err.message || 'Revisa los datos de la jornada.',true);
        return;
      }
      busy = true;
      const layout = $('.jsheet-layout');
      layout.inert = true;
      dialog.setAttribute('aria-busy','true');
      btn('save').textContent='Guardando…';
      try {
        if (!await ctx.mutate(state=>sheet.applyDay(state,draft))) {
          feedback('No se pudo confirmar el guardado. Tus cambios siguen en la hoja. Recargar la página descartará este borrador. Puedes usar «Opciones de fila → Copiar hoja» para conservar las ocho columnas en Excel.',true);
          return;
        }
        dialog.close();
        ctx.toast('Jornada guardada.');
      } catch (err) {
        feedback(err.message || 'No se guardó la jornada. Tus cambios siguen en la hoja.',true);
      } finally {
        busy = false; layout.inert = false; dialog.removeAttribute('aria-busy');
        if (dialog.open) { btn('save').innerHTML=icon('check')+'Guardar jornada'; btn('save').focus({preventScroll:true}); }
      }
    }

    function sheetTSV() {
      const encode = val => {
        const s = String(val ?? '');
        return /["\n\r\t]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s;
      };
      const plainText = value => {
        const text = String(value ?? '');
        return /^[＝＋－＠=+@-]/.test(text.trimStart()) || /^[\t\n\r]/.test(text) ? "'" + text : text;
      };
      const lines = [columns];
      for (const row of draft.rows) {
        if (!row.title && !row.context && !row.comment && !row.segments.some(s=>s.start || s.end)) continue;
        const segments = row.segments.length ? row.segments : [{start:'',end:''}];
        lines.push([row.status,plainText(row.title),plainText(row.context),row.done?'Sí':'No',segments.map(s=>s.start).join('\n'),
          segments.map(s=>s.end).join('\n'),hourCount(durationValue(segments)),plainText(row.comment)]);
      }
      return lines.map(row=>row.map(encode).join('\t')).join('\r\n');
    }

    function paste(event) {
      const control = event.target.closest('[data-col]');
      if (!control) return;
      const raw = event.clipboardData?.getData('text/plain');
      if (!raw) return;
      const col = Number(control.dataset.col);
      // Contexto y Comentarios admiten párrafos. Sólo los tabuladores identifican
      // un bloque de Excel que deba distribuirse en celdas desde esas columnas.
      if ((col===2 || col===7) && !raw.includes('\t')) return;
      if ([1,2,7].includes(col) && !/[\r\n\t]/.test(raw)) return;
      const index = Number(control.closest('[data-index]').dataset.index);
      const seg = Number(control.dataset.seg || 0);
      try {
        const matrix = sheet.parseTSV(raw);
        const planHeader = /^(actividad|actividades)$/i.test(matrix[0]?.[0]?.trim()||'') && /^contexto$/i.test(matrix[0]?.[1]?.trim()||'');
        const fullHeader = matrix[0]?.length===8 && /^estado$/i.test(matrix[0][0].trim());
        if (fullHeader && mode==='plan') { mode='full'; refreshControls(); }
        if (planHeader || (col===1 && matrix.every(line=>line.length<=2)) || (mode==='plan' && matrix.some(line=>line.length>1))) {
          event.preventDefault();
          const rows=sheet.readPlan(matrix);
          if (!rows.length) { feedback('El bloque pegado no contiene actividades.'); return; }
          select(index,seg); insertPlan(rows,importAt()); return;
        }
        if (mode==='plan' && col===2) return;
        event.preventDefault();
        const count = sheet.paste(draft,index,col,matrix,seg);
        selected = index; selectedSegment = seg;
        drawTable({col,seg});
        feedback(count === 1 ? 'Una fila pegada en la hoja.' : count + ' filas pegadas en la hoja.');
      } catch (err) { event.preventDefault(); feedback(err.message || 'No se pudo pegar el contenido.',true); }
    }

    function activate(event) {
      const button = event.target.closest('[data-act]');
      if (!button || busy) return;
      const key = button.dataset.act;
      if (pending && key !== 'keep' && key !== 'discard') return;
      if (menu.open) menu.open = false;
      if (key === 'save') { save(); return; }
      if (key === 'cancel') { requestClose(); return; }
      if (key === 'mode-plan' || key === 'mode-full') {
        mode=key==='mode-full' ? 'full' : 'plan';
        try { localStorage.setItem('workhub:sheet-mode',mode); } catch { /* Mantener el modo en esta hoja. */ }
        refreshControls(); focusCell(selected); return;
      }
      if (key === 'keep') { hideConfirm(); focusCell(selected); return; }
      if (key === 'discard') {
        const operation = pending; hideConfirm();
        if (operation === 'discard') { dialog.close(); return; }
        if (operation === 'remove-segment') {
          selectedRow().segments.splice(selectedSegment,1); selectedSegment = 0;
        } else {
          draft.rows.splice(selected,1);
          if (!draft.rows.length) draft.rows.push(sheet.newRow(draft));
          selected = Math.min(selected,draft.rows.length-1); selectedSegment = 0;
        }
        drawTable({col:1}); feedback(); return;
      }
      if (key === 'append' || key === 'append-bottom') { appendActivity(); return; }
      if (key === 'between') { newAt(Number(button.closest('[data-index]').dataset.index)+1); return; }
      if (key === 'insert-before' || key === 'insert-after') { newAt(selected+(key==='insert-after'?1:0)); return; }
      if (key === 'remove' || key === 'remove-segment') { showConfirm(key); return; }
      if (key === 'up' || key === 'down') {
        const to = selected+(key==='up'?-1:1);
        if (to<0 || to>=draft.rows.length) return;
        if (!sheet.moveRow(draft,selectedRow().id,to-selected)) return;
        selected=to;
        drawTable({col:1}); feedback(); return;
      }
      if (key === 'row') {
        select(Number(button.closest('[data-index]').dataset.index));
        panel = 'details'; drawPanel(); refreshControls(); return;
      }
      if (key === 'insert-plan') {
        if (planRows.length) insertPlan(planRows,importAt(planPosition==='end'),true);
        return;
      }
      if (key === 'details' || key === 'reuse' || key === 'import' || key === 'hide-extra') {
        panel = key === 'hide-extra' || panel === key ? '' : key;
        drawPanel(); refreshControls();
        if (panel==='import') extra.querySelector('[data-plan-input]').focus();
        if (key==='hide-extra') focusCell(selected);
        return;
      }
      if (key === 'add-segment') {
        const row = selectedRow();
        if (!row.segments.length) row.segments.push({start:'',end:''});
        else if (row.segments.at(-1).start || row.segments.at(-1).end) row.segments.push({start:'',end:''});
        selectedSegment = row.segments.length-1;
        drawTable({col:4,seg:selectedSegment}); feedback(); return;
      }
      if (key === 'timer') { timerAction(); return; }
      if (key === 'copy-sheet') {
        const text = sheetTSV();
        const copy = async () => {
          if (window.navigator.clipboard?.writeText) {
            try { await window.navigator.clipboard.writeText(text); feedback('Hoja copiada para Excel.'); return; }
            catch { /* Copia por selección al abrir archivos locales. */ }
          }
          const area = document.createElement('textarea');
          area.value = text; area.className = 'jsheet-copy'; dialog.appendChild(area); area.select();
          let success = false;
          try { success = document.execCommand('copy'); } catch { success = false; }
          area.remove();
          feedback(success ? 'Hoja copiada para Excel.' : 'El navegador no permitió copiar la hoja.',!success);
        };
        copy(); return;
      }
      if (key === 'copy-rows') {
        const working = workingState(), before = working.tasks.length;
        model.reuseActivities(working,sourceDate,draft.date,reuseIds);
        const copies = working.tasks.slice(before);
        if (copies.length) {
          if (sheet.isUnused(draft,draft.rows.at(-1))) draft.rows.pop();
          selected = draft.rows.length;
          draft.rows.push(...copies); selectedSegment=0;
        }
        reuseIds.clear(); panel=''; drawPanel(); drawTable({col:1});
        feedback(copies.length + (copies.length===1?' actividad añadida.':' actividades añadidas.'));
      }
    }

    function keyboard(event) {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s') {
        event.preventDefault(); save(); return;
      }
      if (pending || busy) return;
      const cell = event.target.closest('[data-col]');
      if (!cell) return;
      const currentRow = Number(cell.closest('[data-index]').dataset.index);
      const col = Number(cell.dataset.col);
      if (event.key==='Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault(); newAt(currentRow+(event.shiftKey?0:1)); return;
      }
      if (event.key==='Enter' && event.altKey && cell.tagName==='TEXTAREA') {
        event.preventDefault(); cell.setRangeText('\n',cell.selectionStart,cell.selectionEnd,'end'); readCell(cell); return;
      }
      if (mode==='plan' && event.key==='Tab' && [1,2].includes(col)) {
        if (event.shiftKey && currentRow===0 && col===1) return;
        event.preventDefault();
        if (event.shiftKey) focusCell(col===2 ? currentRow : currentRow-1,col===2 ? 1 : 2);
        else if (col===1) focusCell(currentRow,2);
        else if (currentRow+1<draft.rows.length) focusCell(currentRow+1,1);
        else if (!sheet.isUnused(draft,draft.rows[currentRow])) newAt(draft.rows.length);
        else btn('append-bottom').focus();
        return;
      }
      if (event.key==='Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && cell.tagName !== 'SELECT') {
        event.preventDefault();
        const destination = event.shiftKey ? Math.max(0,currentRow-1) : currentRow+1;
        if (destination === draft.rows.length) {
          draft.rows.push(sheet.newRow(draft)); selected=destination; selectedSegment=0;
          drawTable({col:Number(cell.dataset.col)});
        } else focusCell(destination,Number(cell.dataset.col));
      }
    }

    dialog.addEventListener('focusin',event=>{
      const cell = event.target.closest('[data-col]');
      if (cell) select(Number(cell.closest('[data-index]').dataset.index),Number(cell.dataset.seg || 0));
    });
    dialog.addEventListener('click',activate);
    dialog.addEventListener('input',event=>{
      if (event.target.matches('textarea[data-col],input[type=time][data-col]')) readCell(event.target);
      if (event.target.matches('[data-plan-input]')) { planText=event.target.value; updatePlanPreview(); feedback(); }
    });
    dialog.addEventListener('change',updateField);
    dialog.addEventListener('paste',paste);
    dialog.addEventListener('keydown',keyboard);
    dialog.addEventListener('cancel',event=>{
      event.preventDefault();
      if (busy) return;
      if (pending) { hideConfirm(); focusCell(selected); }
      else if (menu.open) menu.open=false;
      else if ($('.jsheet-keys').open) $('.jsheet-keys').open=false;
      else requestClose();
    });
    const warnBeforeReload = event => {
      if (!dialog.open || (!dirty() && !planText.trim())) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload',warnBeforeReload);
    dialog.addEventListener('close',()=>{
      window.removeEventListener('beforeunload',warnBeforeReload);
      currentDialog=null; dialog.remove();
      const returnTo = trigger?.isConnected ? trigger : document.querySelector('.jd-view [data-edit-day]');
      returnTo?.focus({preventScroll:true});
    },{once:true});
    drawTable();
    dialog.showModal();
    focusCell(selected,1);
  }

  window.JSheet = {open};
})();
