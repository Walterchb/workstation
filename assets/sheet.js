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

  function cellText(row,col,segment=null) {
    if (col===3) return row.done ? 'Sí' : 'No';
    if (col===6) return hourCount(durationValue(row.segments));
    if (col===4 || col===5) {
      const key=fields[col];
      return segment===null ? row.segments.map(part=>part[key]).join('\n') : row.segments[segment]?.[key] || '';
    }
    return row[fields[col]] || '';
  }

  function exportValue(row,col,segment=null) {
    const text=cellText(row,col,segment);
    // Excel debe importar el texto escrito por el usuario como texto literal.
    if ([1,2,7].includes(col) && (/^[＝＋－＠=+@-]/.test(text.trimStart()) || /^[\t\n\r]/.test(text))) return "'"+text;
    return text;
  }

  function asTSV(lines) {
    return lines.map(row=>row.map(s=>/["\n\r\t]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s).join('\t')).join('\r\n');
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
    if (col === 6) return '<output data-duration tabindex="-1" ' + attrs + '>' + hourCount(durationValue(row.segments)) + '</output>';
    const hint = col === 1 ? 'Escribe una actividad' : col === 2 ? 'Añade contexto' : '';
    return '<textarea rows="2" spellcheck="true" ' + attrs + (hint ? ' placeholder="' + hint + '"' : '') + '></textarea>';
  }

  function rowMarkup(row, index, selected) {
    const segCount = Math.max(1,row.segments.length);
    const cells = columns.map((label,col) => {
      const markup = (col === 4 || col === 5) ?
        Array.from({length:segCount},(_,seg) => cellControl(row,index,col,seg)).join('') : cellControl(row,index,col);
      return '<td class="jsheet-c-' + fields[col] + '">' + markup + '</td>';
    }).join('');
    return '<tr data-index="' + index + '"' + (index === selected ? ' class="jsheet-current"' : '') +
      '><th scope="row"><button type="button" data-act="row" tabindex="-1" title="Seleccionar fila ' +
      (index + 1) + '" aria-pressed="false" aria-label="Seleccionar fila ' + (index+1) + '">' + (index + 1) + '</button>' +
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
    let lastColumn=1;
    let editing = null;
    let selection = null;
    let keepingSelection = false;
    let removal = null;
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
        <div class="jsheet-guide"><p class="jsheet-tip" id="jsheet-tip" aria-live="polite"></p>
          <div class="jsheet-cell-tools"><button type="button" data-act="edit-cell" title="Editar contenido de la celda seleccionada (F2)">Editar celda</button><details class="jsheet-keys"><summary>Atajos de teclado</summary><dl>
            <div><dt>← ↑ ↓ →</dt><dd>Recorrer celdas</dd></div>
            <div><dt>${commandKey} + flecha</dt><dd>Ir al borde de los datos</dd></div>
            <div><dt>Mayús + flecha</dt><dd>Extender la selección una celda</dd></div>
            <div><dt>${commandKey} + Mayús + flecha</dt><dd>Extender hasta el borde de los datos</dd></div>
            <div><dt>${commandKey} + C</dt><dd>Copiar las celdas seleccionadas</dd></div>
            <div><dt>F2 / doble clic</dt><dd>Editar dentro de la celda</dd></div>
            <div><dt>${commandKey} + V en selección</dt><dd>Pegar por filas y columnas</dd></div>
            <div><dt>${commandKey} + V al editar texto</dt><dd>Pegar párrafos en una celda</dd></div>
            <div><dt>Esc al editar</dt><dd>Recuperar su contenido anterior</dd></div>
            <div><dt>Mayús + Espacio</dt><dd>Seleccionar la fila</dd></div>
            <div><dt>${commandKey} + Espacio</dt><dd>Seleccionar la columna</dd></div>
            <div><dt>${commandKey} + signo más</dt><dd>Insertar una fila encima</dd></div>
            <div><dt>${commandKey} + signo menos</dt><dd>Eliminar las filas seleccionadas</dd></div>
            <div><dt>Tab / Mayús + Tab</dt><dd>Siguiente celda / anterior</dd></div>
            <div><dt>Enter / Mayús + Enter</dt><dd>Bajar / subir una fila</dd></div>
            <div><dt>${commandKey} + Enter</dt><dd>Insertar actividad debajo</dd></div>
            <div><dt>${commandKey} + Mayús + Enter</dt><dd>Insertar actividad encima</dd></div>
            <div><dt>Alt + Enter</dt><dd>Salto de línea en el texto</dd></div>
            <div><dt>${commandKey} + S</dt><dd>Guardar jornada</dd></div></dl></details></div></div>
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
        <div class="jsheet-confirm" hidden role="alertdialog" aria-labelledby="jsheet-warning" aria-describedby="jsheet-warning-description"><section><h3 id="jsheet-warning"></h3><p id="jsheet-warning-description"></p></section><div>${action('keep','Seguir editando')}${action('discard','Descartar cambios')}</div></div>
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

    function finishEdit(cancel=false) {
      if (!editing) return;
      const {cell,original,segments} = editing;
      editing=null; dialog.dataset.cellMode='navigate';
      cell.classList.remove('jsheet-editing');
      if (cancel && cell.isConnected) {
        if (cell.type==='checkbox') cell.checked=original;
        else cell.value=original;
        if (segments) {
          const index=Number(cell.closest('[data-index]').dataset.index);
          draft.rows[index].segments=segments;
          cell.closest('tr').querySelector('[data-duration]').textContent=hourCount(durationValue(segments));
          refreshControls(); refreshSummary(); feedback();
        } else readCell(cell);
      }
      updateTip();
    }

    const firstColumn=()=>mode==='plan' ? 1 : 0;
    const finalColumn=()=>mode==='plan' ? 2 : columns.length-1;

    function selectedBounds() {
      const anchor=selection?.anchor || {row:selected,col:lastColumn};
      const end=selection?.end || anchor;
      const wholeRow=selection?.kind==='row', wholeColumn=selection?.kind==='column';
      return {
        top:wholeColumn ? 0 : Math.min(anchor.row,end.row),
        bottom:wholeColumn ? selection.lastRow : Math.max(anchor.row,end.row),
        left:wholeRow ? firstColumn() : Math.min(anchor.col,end.col),
        right:wholeRow ? finalColumn() : Math.max(anchor.col,end.col)
      };
    }

    function clearSelection() {
      if (!selection) return;
      for (const td of tbody.querySelectorAll('.jsheet-in-range')) td.classList.remove('jsheet-in-range');
      for (const tr of tbody.querySelectorAll('.jsheet-row-selected')) {
        tr.classList.remove('jsheet-row-selected');
        tr.querySelector('[data-act=row]').setAttribute('aria-pressed','false');
      }
      selection=null;
      dialog.dataset.cellMode=editing ? 'edit' : 'navigate';
      updateTip();
    }

    function setSelection(anchor,end,kind='range') {
      clearSelection();
      selection={anchor,end,kind};
      if (kind==='column') {
        let last=draft.rows.length-1;
        while (last>Math.max(anchor.row,end.row) && sheet.isUnused(draft,draft.rows[last])) last--;
        selection.lastRow=last;
      }
      const {top,bottom,left,right}=selectedBounds();
      for (let r=top;r<=bottom;r++) {
        const tr=tbody.children[r];
        if (kind==='row') {
          tr.classList.add('jsheet-row-selected');
          tr.querySelector('[data-act=row]').setAttribute('aria-pressed','true');
        } else {
          for (let c=left;c<=right;c++) tr.children[c+1].classList.add('jsheet-in-range');
        }
      }
      dialog.dataset.cellMode=kind;
      updateTip();
    }

    function selectBand(kind) {
      const here={row:selected,col:lastColumn};
      setSelection(selection?.anchor || here,selection?.end || here,kind);
    }

    function startEdit(cell,caret='keep') {
      if (cell.matches('output') || editing?.cell===cell) return;
      finishEdit(); clearSelection();
      const row=draft.rows[Number(cell.closest('[data-index]').dataset.index)];
      editing={cell,original:cell.type==='checkbox' ? cell.checked : cell.value,
        segments:cell.type==='time' ? row.segments.map(part=>({...part})) : null};
      cell.classList.add('jsheet-editing'); dialog.dataset.cellMode='edit';
      if (cell.tagName==='TEXTAREA' && caret!=='keep') {
        cell.setSelectionRange(caret==='replace' ? 0 : cell.value.length,cell.value.length);
      }
      updateTip();
    }

    function updateTip() {
      const tip=$('.jsheet-tip');
      const column=document.activeElement?.dataset?.col;
      const {top,bottom,left,right}=selectedBounds();
      const rows=bottom-top+1, cols=right-left+1;
      const text=selection ? ((selection.kind==='row' && rows===1 ? 'Fila '+(top+1)+' seleccionada' :
        rows+' '+(rows===1?'fila':'filas')+' × '+cols+' '+(cols===1?'columna':'columnas'))+'. '+commandKey+' + C para copiar.') :
        editing ? (editing.cell.tagName==='TEXTAREA' ? 'Editando texto. Pega párrafos en esta celda. Enter confirma y Esc recupera el valor anterior.' : 'Editando la celda. Enter confirma y Esc recupera el valor anterior.') :
        (column==='2' || column==='7') ? 'Pega una columna de Excel para repartirla entre actividades. F2 permite pegar párrafos en esta celda.' :
        'Usa las flechas para moverte. Escribe para reemplazar o pulsa F2 para editar el texto.';
      if (tip.textContent!==text) tip.textContent=text;
    }

    function feedback(text='',error=false) {
      for (const node of [errorBox,noticeBox]) { node.hidden = true; node.textContent = ''; }
      if (text) {
        const node = error ? errorBox : noticeBox;
        node.textContent = text;
        node.hidden = false;
      }
    }

    function focusCell(index,col=1,seg=0,keepSelection=false) {
      const row = tbody.children[index];
      const selector = '[data-col="' + col + '"]';
      const field = row?.querySelector(selector + '[data-seg="' + seg + '"]') || row?.querySelector(selector);
      if (field) {
        keepingSelection=keepSelection;
        try { field.focus({preventScroll:true}); } finally { keepingSelection=false; }
        // Sólo se mueve el área de la hoja. La cabecera y los números de fila son fijos.
        const box=scroll.getBoundingClientRect(), corner=$('thead th').getBoundingClientRect();
        const top=Math.max(box.top+scroll.clientTop,corner.bottom), left=Math.max(box.left+scroll.clientLeft,corner.right);
        const bottom=box.top+scroll.clientTop+scroll.clientHeight, right=box.left+scroll.clientLeft+scroll.clientWidth;
        if (bottom>top && right>left) {
          const fieldBox=field.getBoundingClientRect(), rowBox=row.getBoundingClientRect(), td=field.closest('td').getBoundingClientRect();
          const target=rowBox.height<=bottom-top ? rowBox : fieldBox;
          if (target.top<top || target.height>bottom-top) scroll.scrollTop+=target.top-top;
          else if (target.bottom>bottom) scroll.scrollTop+=target.bottom-bottom;
          if (td.left<left || td.width>right-left) scroll.scrollLeft+=td.left-left;
          else if (td.right>right) scroll.scrollLeft+=td.right-right;
        }
      }
      return field;
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
      updateTip();
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
      finishEdit(); clearSelection(); dialog.dataset.cellMode='navigate';
      const left = scroll.scrollLeft, top = scroll.scrollTop;
      tbody.innerHTML = draft.rows.map((row,i)=>rowMarkup(row,i,selected)).join('');
      for (const cell of tbody.querySelectorAll('textarea[data-col]')) {
        const row=draft.rows[Number(cell.closest('tr').dataset.index)];
        cell.value=row[fields[Number(cell.dataset.col)]];
      }
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
        const comments=planRows.some(row=>row.comment);
        const preview = planRows.slice(0,3).map((row,i)=>'<li><span>'+ (index+i+1) + '</span><strong>' +
          esc(row.title) + '</strong><span>' + esc(row.context) + '</span>'+(comments?'<span>'+esc(row.comment||'')+'</span>':'')+'</li>').join('');
        holder.innerHTML = '<p>' + count + ' desde la fila ' + (index+1) + '</p><ol'+(comments?' class="jsheet-plan-comments"':'')+'>' + preview + '</ol>' +
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
          '</div><label class="jsheet-import-label" for="jsheet-plan">Pega una actividad por fila. Puedes incluir Contexto y Comentarios como segunda y tercera columnas, con o sin encabezado.</label>' +
          '<textarea id="jsheet-plan" data-plan-input rows="3" spellcheck="false"></textarea>' +
          '<div class="jsheet-import-actions"><label>Ubicación <select data-plan-position>' + option('here',planPosition,'Fila seleccionada') +
          option('end',planPosition,'Al final de la jornada') + '</select></label>' + action('insert-plan','Insertar actividades','plus') +
          '</div><div data-plan-preview aria-live="polite"></div>';
        extra.querySelector('[data-plan-input]').value=planText;
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
      removal=remove ? selectedBounds() : null;
      const several=remove && removal.bottom>removal.top;
      confirm.dataset.kind=kind;
      const actionName=remove ? several ? 'Eliminar '+(removal.bottom-removal.top+1)+' filas' : 'Eliminar actividad' : segment ? 'Quitar tramo' : 'Descartar cambios';
      confirm.querySelector('h3').textContent = kind==='discard' ? 'Descartar la edición' : actionName;
      const title=selectedRow()?.title.trim() || 'Actividad sin nombre';
      confirm.querySelector('p').textContent = several ? '¿Quitar todas las filas de la '+(removal.top+1)+' a la '+(removal.bottom+1)+', incluidos sus tramos? El cambio se aplicará al guardar la jornada.' :
        remove ? '¿Quitar «'+title+'» (fila ' + (selected+1) + ') y sus tramos? El cambio se aplicará al guardar la jornada.' :
        segment ? '¿Quitar el tramo ' + (selectedSegment+1) + ' de la fila ' + (selected+1) + '?' : 'Tienes cambios sin guardar. ¿Descartar la edición de esta jornada?';
      btn('discard').textContent = actionName;
      btn('keep').textContent = several ? 'Conservar filas' : remove ? 'Conservar actividad' : 'Seguir editando';
      for (const node of [$('.jsheet-head'),$('.jsheet-command'),$('.jsheet-tools'),$('.jsheet-guide'),extra,scroll]) node.inert = true;
      btn('keep').focus();
    }

    function hideConfirm() {
      pending = ''; removal=null;
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
      const lines = [columns];
      for (const row of draft.rows) {
        if (!row.title && !row.context && !row.comment && !row.segments.some(s=>s.start || s.end)) continue;
        lines.push(columns.map((_,col)=>exportValue(row,col)));
      }
      return asTSV(lines);
    }

    function copySelection(event) {
      if (pending || busy || editing || !event.clipboardData) return;
      // Al copiar desde una casilla o un resultado, algunos navegadores envían copy al documento.
      const origin=event.target===document.body || event.target===document ? document.activeElement : event.target;
      const cell=origin?.closest?.('[data-col]');
      if (!cell || !tbody.contains(cell)) return;
      const {top,bottom,left,right}=selectedBounds();
      const lines=[];
      for (let r=top;r<=bottom;r++) {
        const line=[];
        for (let c=left;c<=right;c++) line.push(exportValue(draft.rows[r],c,selection ? null : selectedSegment));
        lines.push(line);
      }
      event.clipboardData.setData('text/plain',asTSV(lines));
      const cells=lines.map(row=>'<tr>'+row.map(s=>'<td style="border:1px solid #c8d4d8;padding:3px 6px;vertical-align:top">'+
        esc(s).replace(/\r\n?|\n/g,'<br style="mso-data-placement:same-cell">')+'</td>').join('')+'</tr>').join('');
      event.clipboardData.setData('text/html','<table style="border-collapse:collapse"><tbody>'+cells+'</tbody></table>');
      event.preventDefault();
    }

    function paste(event) {
      const cell=event.target.closest('[data-col]');
      if (!cell || pending || busy || editing?.cell===cell) return;
      const data=event.clipboardData;
      if (!data) return;
      const col=Number(cell.dataset.col), index=Number(cell.closest('[data-index]').dataset.index);
      const seg=Number(cell.dataset.seg || 0);
      try {
        const raw=data.getData('text/plain');
        let matrix;
        if (raw) {
          try { matrix=sheet.parseTSV(raw); }
          catch (error) { if (/[\t\r\n]/.test(raw)) throw error; matrix=[[raw]]; }
        } else {
          const html=data.getData('text/html');
          if (!html) return;
          const fragment=document.createElement('template');
          fragment.innerHTML=html;
          const table=fragment.content.querySelector('table');
          if (!table) return;
          for (const lineBreak of table.querySelectorAll('br')) lineBreak.replaceWith(document.createTextNode('\n'));
          matrix=[...table.querySelectorAll('tr')].filter(tr=>tr.closest('table')===table).map(tr=>
            [...tr.children].filter(node=>node.matches('td,th')).map(node=>node.textContent));
        }
        if (!matrix.length) return;
        event.preventDefault();
        if (col===6) { feedback('La duración se calcula con las horas de los tramos.'); return; }
        const first=matrix[0];
        const planHeader=/^actividad(?:es)?$/i.test(first[0].trim());
        const hasPlanHeader=planHeader && /^contexto$/i.test(first[1]?.trim()||'');
        const fullHeader=first.length===8 && /^estado$/i.test(first[0].trim());
        const isPlan=hasPlanHeader || (col===1 && (matrix.length>1 || first.length>1) &&
          matrix.every(line=>line.length<=(mode==='plan'?3:2)));
        if (isPlan) {
          const rows=sheet.readPlan(matrix);
          if (!rows.length) { feedback('El bloque pegado no contiene actividades.'); return; }
          select(index,seg); insertPlan(rows,importAt()); return;
        }
        if (fullHeader && mode==='plan') { mode='full'; refreshControls(); }
        if (mode==='plan' && col===2 && matrix.some(line=>line.length>1)) {
          throw new Error('Selecciona Actividad para insertar un plan o Registro completo para pegar más columnas.');
        }
        const vertical=[2,7].includes(col) && matrix.length>1 && matrix.every(line=>line.length===1);
        const count=vertical ? sheet.pasteTextColumn(draft,index,col,matrix) : sheet.paste(draft,index,col,matrix,seg);
        selected=index; selectedSegment=seg; drawTable({col,seg});
        feedback(count===1?'Una fila pegada en la hoja.':count+' filas pegadas en la hoja.');
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
      if (key === 'edit-cell') {
        const cell=focusCell(selected,lastColumn,selectedSegment);
        if (cell) startEdit(cell,'end');
        return;
      }
      if (key === 'mode-plan' || key === 'mode-full') {
        clearSelection();
        mode=key==='mode-full' ? 'full' : 'plan';
        try { localStorage.setItem('workhub:sheet-mode',mode); } catch { /* Mantener el modo en esta hoja. */ }
        refreshControls(); focusCell(selected); return;
      }
      if (key === 'keep') { hideConfirm(); focusCell(selected,lastColumn,selectedSegment,true); return; }
      if (key === 'discard') {
        const operation = pending, rows=removal; hideConfirm();
        if (operation === 'discard') { dialog.close(); return; }
        if (operation === 'remove-segment') {
          selectedRow().segments.splice(selectedSegment,1); selectedSegment = 0;
        } else {
          draft.rows.splice(rows.top,rows.bottom-rows.top+1);
          if (!draft.rows.length) draft.rows.push(sheet.newRow(draft));
          selected = Math.min(rows.top,draft.rows.length-1); selectedSegment = 0;
        }
        drawTable({col:lastColumn}); feedback(); return;
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
        const rowIndex=Number(button.closest('[data-index]').dataset.index);
        clearSelection(); focusCell(rowIndex); selectBand('row'); return;
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

    function tabOrder(index) {
      if (mode==='plan') return [[1,0],[2,0]];
      const sequence=[[0,0],[1,0],[2,0],[3,0]];
      const count=Math.max(1,draft.rows[index].segments.length);
      for (let i=0;i<count;i++) sequence.push([4,i],[5,i]);
      sequence.push([7,0]);
      return sequence;
    }

    function moveTab(event,row,col,seg) {
      const order=tabOrder(row), direction=event.shiftKey?-1:1;
      const position=col===6 ? order.length-1 : order.findIndex(([c,i])=>c===col && i===seg);
      const relative=col===6 && direction>0 ? order.length-1 : position+direction;
      if (relative<0 && row===0) return;
      event.preventDefault();
      if (relative>=0 && relative<order.length) { focusCell(row,...order[relative]); return; }
      const next=row+direction;
      if (next===draft.rows.length) {
        if (sheet.isUnused(draft,draft.rows[row])) { btn('append-bottom').focus(); return; }
        newAt(next);
      }
      const nextOrder=tabOrder(next);
      focusCell(next,...(direction>0?nextOrder[0]:nextOrder.at(-1)));
    }

    function moveVertical(row,col,seg,step,extend) {
      const timed=col===4 || col===5;
      const count=Math.max(1,draft.rows[row].segments.length);
      if (timed && seg+step>=0 && seg+step<count) { focusCell(row,col,seg+step); return; }
      const next=row+step;
      if (next<0) return;
      if (next>=draft.rows.length) {
        if (extend) { sheet.insertRow(draft,next); selected=next; selectedSegment=0; drawTable({col}); }
        return;
      }
      const last=timed && step<0 ? Math.max(0,draft.rows[next].segments.length-1) : 0;
      focusCell(next,col,last);
    }

    function moveAcrossData(key,row,col,seg,jump,extend) {
      const vertical=key==='ArrowDown' || key==='ArrowUp';
      const step=key==='ArrowDown' || key==='ArrowRight' ? 1 : -1;
      if (!jump && !extend && vertical) {
        clearSelection(); moveVertical(row,col,seg,step,false); return;
      }
      const start=vertical ? row : col;
      const limit=vertical ? (step>0 ? draft.rows.length-1 : 0) : (step>0 ? finalColumn() : firstColumn());
      const filled=pos=>{
        const r=vertical ? pos : row, c=vertical ? col : pos;
        const item=draft.rows[r];
        // La fila de captura vacía tiene valores predeterminados que no forman parte de los datos.
        if ([0,3,6].includes(c) && !item.title && sheet.isUnused(draft,item)) return false;
        return Boolean(cellText(item,c).trim());
      };
      let pos=start;
      if (pos!==limit) {
        pos+=step;
        if (jump) {
          if (filled(start) && filled(pos)) {
            while (pos!==limit && filled(pos+step)) pos+=step;
          } else {
            while (pos!==limit && !filled(pos)) pos+=step;
          }
        }
      }
      const end={row:vertical ? pos : row,col:vertical ? col : pos};
      if (extend) {
        const kind=(vertical && selection?.kind==='row') || (!vertical && selection?.kind==='column') ? selection.kind : 'range';
        setSelection(selection?.anchor || {row,col},end,kind);
      } else clearSelection();
      focusCell(end.row,end.col,seg,extend);
    }

    function keyboard(event) {
      const key=event.key, command=event.ctrlKey || event.metaKey;
      const removeShortcut=command && !event.altKey && (key==='-' || key==='Subtract' || event.code==='NumpadSubtract');
      if (pending && removeShortcut) { event.preventDefault(); return; }
      if (event.isComposing || event.keyCode===229 || event.target.closest('.jsheet-extra,.jsheet-menu,.jsheet-keys,.jsheet-confirm')) return;
      if (command && key.toLowerCase()==='s' && !event.altKey) { event.preventDefault(); finishEdit(); save(); return; }
      const cell=event.target.closest('[data-col]');
      if (!cell || pending || busy) return;
      const row=Number(cell.closest('[data-index]').dataset.index);
      const col=Number(cell.dataset.col), seg=Number(cell.dataset.seg || 0);
      if (key==='F2') {
        event.preventDefault(); startEdit(cell,'end');
        if (cell.matches('output')) feedback('La duración se calcula con las horas de los tramos.');
        return;
      }
      if (key==='Escape' && (editing || selection)) {
        event.preventDefault(); event.stopPropagation(); finishEdit(true); clearSelection(); return;
      }
      if (event.altKey && key==='Enter' && !command && cell.tagName==='TEXTAREA') {
        event.preventDefault(); startEdit(cell,'end');
        cell.setRangeText('\n',cell.selectionStart,cell.selectionEnd,'end'); readCell(cell); return;
      }
      if (key==='Enter' && command && !event.altKey) {
        event.preventDefault(); finishEdit(); newAt(row+(event.shiftKey?0:1)); return;
      }
      if (!editing && !event.altKey && command && (key==='+' || event.code==='NumpadAdd' || (event.shiftKey && (key==='=' || event.code==='Equal')))) {
        event.preventDefault(); newAt(row); return;
      }
      if (!editing && removeShortcut) { event.preventDefault(); showConfirm('remove'); return; }
      if (!editing && event.shiftKey && !command && !event.altKey && (key===' ' || event.code==='Space')) {
        event.preventDefault(); selectBand('row'); return;
      }
      if (!editing && command && !event.shiftKey && !event.altKey && (key===' ' || event.code==='Space')) {
        event.preventDefault(); selectBand('column'); return;
      }
      if (key==='Tab' && !command && !event.altKey) { finishEdit(); clearSelection(); moveTab(event,row,col,seg); return; }
      if (key==='Enter' && !command && !event.altKey) {
        event.preventDefault(); finishEdit(); clearSelection(); moveVertical(row,col,seg,event.shiftKey?-1:1,true); return;
      }
      if (editing || event.altKey) return;
      if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(key)) {
        event.preventDefault(); moveAcrossData(key,row,col,seg,command,event.shiftKey); return;
      }
      if (command) return;
      if (Array.from(key).length===1 || key==='Dead') {
        if (cell.tagName==='TEXTAREA') startEdit(cell,'replace');
        else if (cell.type==='time' || cell.tagName==='SELECT') startEdit(cell);
        else if (cell.type==='checkbox' && key===' ') clearSelection();
      }
    }

    dialog.addEventListener('focusin',event=>{
      const cell=event.target.closest('[data-col]');
      if (editing && editing.cell!==cell) finishEdit();
      if (cell) {
        lastColumn=Number(cell.dataset.col);
        btn('edit-cell').disabled=lastColumn===6;
        if (!keepingSelection) clearSelection();
        select(Number(cell.closest('[data-index]').dataset.index),Number(cell.dataset.seg || 0));
        updateTip();
      }
    });
    dialog.addEventListener('dblclick',event=>{
      const cell=event.target.closest('[data-col]');
      if (cell && !pending && !busy) startEdit(cell);
    });
    dialog.addEventListener('pointerdown',event=>{
      const cell=event.target.closest('[data-col]');
      if (!cell || pending || busy) return;
      clearSelection();
      if (cell.tagName==='SELECT' || cell.type==='time') {
        startEdit(cell);
      }
    });
    dialog.addEventListener('beforeinput',event=>{
      const cell=event.target.closest('textarea[data-col]');
      if (!cell || editing || pending || busy || event.isComposing) return;
      if (event.inputType==='insertText' || event.inputType==='insertReplacementText') startEdit(cell,'replace');
    });
    dialog.addEventListener('compositionstart',event=>{
      const cell=event.target.closest('textarea[data-col]');
      if (cell && !editing && !pending && !busy) startEdit(cell);
    });
    dialog.addEventListener('click',activate);
    dialog.addEventListener('input',event=>{
      if (event.target.matches('textarea[data-col],input[type=time][data-col]')) readCell(event.target);
      if (event.target.matches('[data-plan-input]')) { planText=event.target.value; updatePlanPreview(); feedback(); }
    });
    dialog.addEventListener('change',updateField);
    dialog.addEventListener('paste',paste);
    document.addEventListener('copy',copySelection);
    dialog.addEventListener('keydown',keyboard);
    dialog.addEventListener('cancel',event=>{
      event.preventDefault();
      if (busy) return;
      if (pending) { hideConfirm(); focusCell(selected,lastColumn,selectedSegment,true); }
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
      document.removeEventListener('copy',copySelection);
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
