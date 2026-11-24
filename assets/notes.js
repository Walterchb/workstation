/* Tablero personal. El orden de las notas dentro de cada columna se guarda en el documento de la cuenta. */
(() => {
  'use strict';
  const {esc, icon} = window.JUI;
  const model = window.JModel;
  const lanes = model.noteLanes;
  const limits = model.noteLimits;
  const gripIcon = '<svg aria-hidden="true" focusable="false" viewBox="0 0 16 20" width="16" height="20" fill="currentColor">' +
    '<circle cx="5" cy="4" r="1.6"/><circle cx="11" cy="4" r="1.6"/><circle cx="5" cy="10" r="1.6"/>' +
    '<circle cx="11" cy="10" r="1.6"/><circle cx="5" cy="16" r="1.6"/><circle cx="11" cy="16" r="1.6"/></svg>';
  const laneHints = {
    inbox:'Ideas y recordatorios nuevos',
    followup:'Asuntos que necesitas retomar',
    waiting:'Respuestas o insumos pendientes',
    resolved:'Asuntos que ya atendiste'
  };

  function requireNote(state, id) {
    const note = (state.notes || []).find(item => item.id === id);
    if (!note) throw new Error('La nota ya no está disponible.');
    return note;
  }

  function placeNote(state, id, lane, beforeId) {
    const note = requireNote(state, id);
    const others = state.notes.filter(item => item.id !== id);
    const insertAt = beforeId ? others.findIndex(item => item.id === beforeId && item.lane === lane) : -1;
    if (beforeId && insertAt < 0) throw new Error('La posición elegida cambió. Vuelve a mover la nota.');
    note.lane = lane;
    others.splice(insertAt < 0 ? others.length : insertAt, 0, note);
    state.notes = others;
  }

  function laneOptions(selected) {
    return Object.entries(lanes).map(([id, label]) =>
      '<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + label + '</option>'
    ).join('');
  }

  function focusNote(id) {
    const board = document.querySelector('.jn-view');
    if (!board) return;
    const title = Array.from(board.querySelectorAll('[data-jn-open]')).find(button => button.dataset.jnOpen === id);
    (title || board.querySelector('[data-jn-add]'))?.focus();
  }

  function createDialog(title, content, actions, ctx, returnId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'jn-dialog';
    dialog.setAttribute('aria-labelledby', 'jn-dialog-title');
    dialog.innerHTML = '<form><header><h2 id="jn-dialog-title">' + title + '</h2>' +
      '<button class="icon-btn" type="button" data-close aria-label="Cerrar">' + icon('x',18) + '</button></header>' +
      '<div class="jn-fields">' + content + '</div><footer>' + actions + '</footer></form>';
    const form = dialog.querySelector('form');
    let busy = false;
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); focusNote(returnId); }, {once:true});
    dialog.querySelectorAll('[data-close]').forEach(button => {
      button.onclick = () => { if (!busy) dialog.close(); };
    });
    async function commit(change) {
      if (busy) return;
      busy = true;
      form.inert = true;
      form.setAttribute('aria-busy','true');
      try {
        if (await ctx.mutate(change)) dialog.close();
      } finally {
        busy = false;
        form.inert = false;
        form.removeAttribute('aria-busy');
      }
    }
    document.body.append(dialog);
    dialog.showModal();
    return {dialog, form, commit};
  }

  function open(id, ctx, initialLane = 'inbox') {
    const note = id && (ctx.state.notes || []).find(item => item.id === id);
    if (id && !note) { ctx.toast('La nota ya no está disponible.'); return; }
    const noteId = id || model.id();
    const knownTopics = new Set((ctx.state.notes || []).map(item => item.topic).filter(Boolean));
    const topicOptions = [...knownTopics].sort((a,b) => a.localeCompare(b, 'es')).map(topic => '<option value="' + esc(topic) + '"></option>').join('');
    const fields = '<label>Título<input name="title" maxlength="' + limits.title + '" required autocomplete="off" placeholder="Ej. Confirmar el envío del anexo" value="' + esc(note?.title) + '"></label>' +
      '<label>Detalle<textarea name="body" rows="5" maxlength="' + limits.body + '" placeholder="Anota el contexto o lo que necesitas recordar.">' + esc(note?.body) + '</textarea></label>' +
      '<label>Tema <small>(opcional)</small><input name="topic" list="jn-topics" maxlength="' + limits.topic + '" autocomplete="off" placeholder="Ej. IFC, ROF o comité" value="' + esc(note?.topic) + '"></label><datalist id="jn-topics">' + topicOptions + '</datalist>' +
      '<div class="jn-field-row"><label>Columna<select name="lane">' + laneOptions(note?.lane || initialLane) + '</select></label>' +
      '<label>Fecha de revisión <small>(opcional)</small><input type="date" name="reviewDate" value="' + esc(note?.reviewDate) + '"></label></div>' +
      (note ? '<div class="jn-remove-prompt" hidden><p>¿Eliminar la nota «' + esc(note.title) + '»?</p>' +
        '<button class="btn" type="button" data-keep>Conservar</button> <button class="btn jn-danger" type="button" data-confirm>Eliminar nota</button></div>' : '');
    const actions = (note ? '<button class="jn-delete" type="button" data-remove>' + icon('trash',16) + 'Eliminar</button>' : '') +
      '<button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar nota</button>';
    const {dialog, form, commit} = createDialog(note ? 'Editar nota' : 'Nueva nota', fields, actions, ctx, noteId);
    form.onsubmit = event => {
      event.preventDefault();
      const title = form.elements.title;
      title.value = title.value.trim();
      if (!title.reportValidity()) return;
      const data = {title:title.value, body:form.elements.body.value.trim(), topic:form.elements.topic.value.trim(),
        lane:form.elements.lane.value, reviewDate:form.elements.reviewDate.value};
      commit(state => {
        if (note) {
          const current = requireNote(state, id);
          if (current.lane !== data.lane) placeNote(state, id, data.lane, '');
          Object.assign(current, data);
        } else {
          if (!state.notes) state.notes = [];
          state.notes.push({id:noteId, ...data});
        }
      });
    };
    if (note) {
      const prompt = dialog.querySelector('.jn-remove-prompt');
      const remove = dialog.querySelector('[data-remove]');
      const keep = dialog.querySelector('[data-keep]');
      const submit = form.querySelector('[type=submit]');
      remove.onclick = () => { prompt.hidden = false; remove.hidden = true; submit.disabled = true; keep.focus(); };
      keep.onclick = () => { prompt.hidden = true; remove.hidden = false; submit.disabled = false; remove.focus(); };
      dialog.querySelector('[data-confirm]').onclick = () => commit(state => {
        requireNote(state, id);
        state.notes = state.notes.filter(item => item.id !== id);
      });
    }
    form.elements.title.focus();
  }

  function openMove(note, ctx) {
    const fields = '<p class="jn-move-title">' + esc(note.title) + '</p><label>Columna de destino<select name="lane">' +
      laneOptions(note.lane) + '</select></label><label>Posición<select name="position"></select></label>';
    const {form, dialog, commit} = createDialog('Mover nota', fields,
      '<button class="btn" type="button" data-close>Cancelar</button><button type="submit" class="btn primary">Mover nota</button>', ctx, note.id);
    const lane = form.elements.lane, position = form.elements.position;
    const next = ctx.state.notes.filter(item => item.lane === note.lane);
    const originalNext = next[next.findIndex(item => item.id === note.id) + 1]?.id || '';
    function updatePositions() {
      const options = ctx.state.notes.filter(item => item.lane === lane.value && item.id !== note.id);
      position.innerHTML = options.map(item => '<option value="' + esc(item.id) + '">Antes de «' + esc(item.title) + '»</option>').join('') +
        '<option value="">' + (options.length ? 'Al final de la columna' : 'Primera nota') + '</option>';
      position.value = lane.value === note.lane ? originalNext : '';
    }
    lane.onchange = updatePositions;
    updatePositions();
    form.onsubmit = event => {
      event.preventDefault();
      if (lane.value === note.lane && position.value === originalNext) dialog.close();
      else commit(state => placeNote(state, note.id, lane.value, position.value));
    };
    lane.focus();
  }

  function reviewDate(note, today) {
    if (!note.reviewDate) return '';
    const formatted = model.formatDate(note.reviewDate, {day:'numeric',month:'short',year:'numeric'});
    const pending = note.lane !== 'resolved';
    const due = pending && note.reviewDate < today;
    const now = pending && note.reviewDate === today;
    const label = due ? 'Revisión pendiente · ' + formatted : now ? 'Revisar hoy' : 'Revisión · ' + formatted;
    return '<time class="jn-date' + (due ? ' overdue' : now ? ' today' : '') + '" datetime="' + esc(note.reviewDate) +
      '" title="' + esc(formatted) + '">' + icon('calendar',13) + esc(label) + '</time>';
  }

  function card(note, today) {
    const title = esc(note.title), id = esc(note.id);
    return '<li class="jn-card" draggable="true" data-jn-id="' + id + '"><div class="jn-card-head">' +
      '<h3><button type="button" data-jn-open="' + id + '" title="Editar nota">' + title + '</button></h3>' +
      '<button class="jn-grip" type="button" data-jn-move="' + id + '" aria-label="Mover ' + title + '" title="Arrastrar o elegir una posición">' + gripIcon + '</button></div>' +
      (note.body ? '<p class="jn-card-body">' + esc(note.body) + '</p>' : '') +
      (note.topic || note.reviewDate ? '<div class="jn-card-foot">' +
        (note.topic ? '<span class="jn-topic">' + icon('folder',13) + esc(note.topic) + '</span>' : '') + reviewDate(note,today) + '</div>' : '') + '</li>';
  }

  function bindMove(board, ctx) {
    let moving = null, target = null, marker = null, touch = null;
    function clearTarget() {
      if (marker) marker.classList.remove('jn-before');
      if (target) target.classList.remove('jn-target');
      marker = null; target = null;
    }
    function clearDrag() {
      clearTarget();
      moving?.classList.remove('jn-dragging'); moving = null;
    }
    function locate(element, y) {
      const lane = element?.closest('[data-jn-lane]');
      if (!lane || !board.contains(lane)) { clearTarget(); return; }
      const cards = Array.from(lane.querySelectorAll('[data-jn-id]')).filter(item => item !== moving);
      const next = cards.find(item => {
        const rect = item.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      if (lane === target && (next || null) === marker) return;
      clearTarget(); target = lane; marker = next || null;
      target.classList.add('jn-target');
      marker?.classList.add('jn-before');
    }
    async function drop() {
      const id = moving?.dataset.jnId, lane = target?.dataset.jnLane, beforeId = marker?.dataset.jnId || '';
      clearDrag();
      if (!id || !lane) return;
      const note = requireNote(ctx.state, id);
      const sameLane = ctx.state.notes.filter(item => item.lane === lane);
      const next = sameLane[sameLane.findIndex(item => item.id === id) + 1];
      if (note.lane === lane && (next?.id || '') === beforeId) return;
      if (await ctx.mutate(state => placeNote(state,id,lane,beforeId))) focusNote(id);
    }
    board.ondragstart = event => {
      if (touch) { event.preventDefault(); return; }
      const item = event.target.closest('[data-jn-id]');
      if (!item) return;
      moving = item;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.jnId);
      item.classList.add('jn-dragging');
    };
    board.ondragover = event => {
      if (!moving) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      locate(event.target, event.clientY);
    };
    board.ondragleave = event => { if (!board.contains(event.relatedTarget)) clearTarget(); };
    board.ondrop = event => {
      if (!moving) return;
      event.preventDefault(); locate(event.target, event.clientY); drop();
    };
    board.ondragend = clearDrag;
    // En pantallas táctiles el asa arrastra; el resto de la tarjeta permite desplazar la página.
    let ignoreGripClick = false;
    board.onpointerdown = event => {
      const grip = event.target.closest('[data-jn-move]');
      if (event.pointerType === 'mouse' || !event.isPrimary || !grip) return;
      touch = {id:event.pointerId, x:event.clientX, y:event.clientY, grip};
      grip.setPointerCapture(event.pointerId);
    };
    board.onpointermove = event => {
      if (!touch || touch.id !== event.pointerId) return;
      if (!moving && Math.hypot(event.clientX-touch.x,event.clientY-touch.y) < 7) return;
      moving = touch.grip.closest('[data-jn-id]');
      moving.classList.add('jn-dragging');
      if (event.clientY < 70) window.scrollBy({top:-20, behavior:'instant'});
      else if (event.clientY > window.innerHeight - 70) window.scrollBy({top:20, behavior:'instant'});
      locate(document.elementFromPoint(event.clientX,event.clientY),event.clientY);
    };
    board.onpointerup = event => {
      if (!touch || touch.id !== event.pointerId) return;
      touch = null;
      if (moving) {
        ignoreGripClick = true; setTimeout(() => { ignoreGripClick = false; }, 0);
        locate(document.elementFromPoint(event.clientX,event.clientY),event.clientY); drop();
      }
    };
    board.onpointercancel = () => { touch = null; clearDrag(); };
    board.onclick = event => {
      const grip = event.target.closest('[data-jn-move]');
      if (grip && !ignoreGripClick) openMove(requireNote(ctx.state,grip.dataset.jnMove),ctx);
    };
  }

  function render(stage, ctx) {
    const notes = ctx.state.notes || [], today = model.today();
    stage.innerHTML = '<section class="jn-view"><header class="jn-head"><div><h1>Notas</h1><p>Guarda recordatorios, consultas y respuestas pendientes.</p></div>' +
      '<button class="btn primary" type="button" data-jn-add="inbox">' + icon('plus',17) + 'Nueva nota</button></header>' +
      '<div class="jn-board" aria-label="Tablero de notas">' +
      Object.entries(lanes).map(([lane, label]) => {
        const items = notes.filter(note => note.lane === lane);
        return '<section class="jn-lane" data-jn-lane="' + lane + '" aria-labelledby="jn-lane-' + lane + '"><header class="jn-lane-head"><div>' +
          '<h2 id="jn-lane-' + lane + '"><i aria-hidden="true"></i>' + label + ' <span class="jn-count" aria-label="' + items.length + (items.length === 1 ? ' nota' : ' notas') + '">' + items.length + '</span></h2>' +
          (items.length ? '<button type="button" data-jn-add="' + lane + '" title="Agregar nota en ' + label + '" aria-label="Agregar nota en ' + label + '">' + icon('plus',16) + '</button>' : '') + '</div>' +
          '<p>' + laneHints[lane] + '</p></header><ol class="jn-stack">' + items.map(item => card(item,today)).join('') + '</ol>' +
          (!items.length ? '<button type="button" class="jn-empty" data-jn-add="' + lane + '">' + icon('plus',14) + 'Agregar nota</button>' : '') + '</section>';
      }).join('') + '</div></section>';
    const view = stage.querySelector('.jn-view');
    view.onclick = event => {
      const add = event.target.closest('[data-jn-add]');
      if (add) { open(null,ctx,add.dataset.jnAdd); return; }
      const title = event.target.closest('[data-jn-open]');
      if (title) open(title.dataset.jnOpen,ctx);
    };
    bindMove(view.querySelector('.jn-board'),ctx);
  }

  window.JNotes = {render, open, lanes};
})();
