/* Búsqueda en la agenda completa y el tablero de notas de la cuenta abierta. */
(() => {
  'use strict';
  const {icon, esc} = window.JUI;
  const dates = new Intl.DateTimeFormat('es-PE', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-PE');
  let activeDialog;

  function field(label, value) {
    const text = typeof value === 'string' ? value.trim().replace(/\s+/g,' ').normalize('NFC') : '';
    return {label, text, key:fold(text)};
  }

  function records(state) {
    const tasks = state.tasks.map(task => ({
      id:task.id, group:'agenda', type:task.kind === 'space' ? 'Espacio' : 'Actividad',
      date:task.date, meta:'', title:field('Título', task.title),
      fields:[field('Contexto', task.context), field('Comentario', task.comment),
        field('Nota', task.note), field('Notas', task.notes)].filter(f => f.text)
    }));
    const notes = (state.notes || []).map(note => ({
      id:note.id, group:'notes', type:'Nota', date:note.reviewDate || '',
      meta:window.JNotes?.lanes[note.lane] || '', title:field('Título',note.title),
      fields:[field('Tema',note.topic), field('Nota',note.body)].filter(f => f.text)
    }));
    return tasks.concat(notes);
  }

  function matches(index, scope, query, words) {
    if (!words.length) return [];
    const result = [];
    for (const row of index) {
      if (scope !== 'all' && scope !== row.group) continue;
      const title = row.title.key;
      if (!words.every(word => title.includes(word) || row.fields.some(f => f.key.includes(word)))) continue;
      const score = (title === query ? 100 : title.startsWith(query) ? 60 : title.includes(query) ? 40 : 0)
        + words.filter(word => title.includes(word)).length;
      result.push({row, score});
    }
    return result.sort((a,b) => b.score - a.score || b.row.date.localeCompare(a.row.date)
      || a.row.title.text.localeCompare(b.row.title.text,'es-PE'));
  }

  // La consulta se compara sin tildes. Estas posiciones conservan los caracteres originales al resaltarla.
  function highlighted(f, words, excerpt) {
    const firstHits = words.map(word => ({word, at:f.key.indexOf(word)})).filter(hit => hit.at >= 0);
    if (!firstHits.length) return esc(f.text);
    firstHits.sort((a,b) => a.at - b.at || b.word.length - a.word.length);
    const first = firstHits[0];
    const start = excerpt ? Math.max(0,first.at - 40) : 0;
    const end = excerpt ? Math.min(f.key.length, Math.max(start + 165,first.at + first.word.length + 20)) : f.key.length;
    // En el caso habitual (incluidas las tildes del español) las posiciones ya coinciden.
    let positions;
    if (f.key.length !== f.text.length) {
      positions = [];
      let offset = 0;
      for (const char of f.text) {
        for (let i = 0, len = fold(char).length; i < len; i++) positions.push(offset);
        offset += char.length;
      }
      positions.push(offset);
    }
    const sourceAt = keyIndex => positions ? positions[keyIndex] : keyIndex;
    const ranges = [];
    for (const {word} of firstHits) {
      let at = f.key.indexOf(word,start);
      while (at >= 0 && at < end) {
        ranges.push([at,Math.min(end,at + word.length)]);
        at = f.key.indexOf(word,at + word.length);
      }
    }
    ranges.sort((a,b) => a[0] - b[0]);
    let cursor = start;
    let html = start > 0 ? '…' : '';
    for (const [left,right] of ranges) {
      const from = Math.max(cursor,left);
      if (from >= right) continue;
      html += esc(f.text.slice(sourceAt(cursor),sourceAt(from)))
        + '<mark>' + esc(f.text.slice(sourceAt(from),sourceAt(right))) + '</mark>';
      cursor = right;
    }
    return html + esc(f.text.slice(sourceAt(cursor),sourceAt(end))) + (end < f.key.length ? '…' : '');
  }

  function resultHtml(row, index, words, dateLabels) {
    if (row.date && !dateLabels.has(row.date)) {
      dateLabels.set(row.date, dates.format(new Date(row.date+'T12:00:00Z')).replace(/\./g,''));
    }
    const date = dateLabels.get(row.date);
    const meta = [row.type,row.meta,date && (row.group === 'notes' ? 'Revisar el ' + date : date)].filter(Boolean).join(' · ');
    const snippets = row.fields.filter(f => words.some(word => f.key.includes(word)))
      .map(f => '<span class="jsearch-excerpt"><b>'+esc(f.label)+'</b> '+highlighted(f,words,true)+'</span>').join('');
    const symbol = row.group === 'notes' ? 'file-text' : row.type === 'Espacio' ? 'clock' : 'calendar-days';
    return '<li><button type="button" class="jsearch-result" data-result="'+index+'">'
      +'<span class="jsearch-kind '+row.group+'">'+icon(symbol,17)+'</span><span class="jsearch-copy">'
      +'<small>'+esc(meta)+'</small><strong>'+highlighted(row.title,words,false)+'</strong>'+snippets+'</span>'
      +'<span class="jsearch-arrow">'+icon('arrow-right',16)+'</span></button></li>';
  }

  function open(ctx) {
    if (activeDialog?.open) { activeDialog.querySelector('input').focus(); return; }
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    activeDialog = dialog;
    dialog.className = 'jsearch-dialog';
    dialog.setAttribute('aria-labelledby','jsearch-title');
    dialog.innerHTML = '<header><h2 id="jsearch-title">Buscar en Work Hub</h2>'
      +'<button type="button" class="icon-btn" data-search-close aria-label="Cerrar buscador">'+icon('x',17)+'</button></header>'
      +'<div class="jsearch-tools"><label class="jsearch-input">'+icon('search',19)
      +'<input autofocus type="search" aria-label="Buscar actividades, contexto, comentarios o notas" placeholder="Actividad, contexto, comentario o nota…" autocomplete="off"></label>'
      +'<div class="jsearch-scope" role="group" aria-label="Buscar en">'
      +[['all','Todo'],['agenda','Agenda'],['notes','Notas']].map(([key,label]) =>
        '<button type="button" data-scope="'+key+'" aria-pressed="'+(key==='all')+'">'+label+'</button>').join('')+'</div></div>'
      +'<div class="jsearch-list"><p class="jsearch-status" role="status" aria-live="polite"></p>'
      +'<ul aria-label="Resultados de búsqueda"></ul></div>'
      +'<footer aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Recorrer</span><span><kbd>Enter</kbd> Abrir</span><span><kbd>Esc</kbd> Cerrar</span></footer>';
    const input = dialog.querySelector('input');
    const list = dialog.querySelector('ul');
    const status = dialog.querySelector('[role=status]');
    const index = records(ctx.state), dateLabels = new Map();
    let scope = 'all', results = [], selected;

    function draw() {
      const query = fold(input.value.trim().normalize('NFC')).replace(/\s+/g,' ');
      const words = [...new Set(query.split(' ').filter(Boolean))];
      results = matches(index,scope,query,words);
      let message;
      if (!index.some(row => scope === 'all' || row.group === scope)) {
        message = {all:'Aún no tienes actividades ni notas.',agenda:'Tu agenda está vacía.',notes:'Tu tablero de notas está vacío.'}[scope];
      } else if (!query) {
        message = 'Escribe una palabra para buscar en todas las fechas.';
      } else if (!results.length) {
        message = 'Sin coincidencias. Prueba con otra palabra.';
      } else {
        message = results.length === 1 ? '1 resultado' : results.length+' resultados';
      }
      status.textContent = message;
      list.innerHTML = results.map(({row},i) => resultHtml(row,i,words,dateLabels)).join('');
      list.parentElement.scrollTop = 0;
    }

    function choose(index) {
      selected = results[index]?.row;
      if (selected) dialog.close();
    }

    dialog.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button?.matches('[data-search-close]')) dialog.close();
      if (button?.hasAttribute('data-result')) choose(Number(button.dataset.result));
      if (button?.hasAttribute('data-scope')) {
        scope = button.dataset.scope;
        for (const option of dialog.querySelectorAll('[data-scope]')) option.setAttribute('aria-pressed',String(option===button));
        draw();
      }
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
      }
    });
    input.addEventListener('input',draw);
    dialog.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {event.preventDefault(); dialog.close(); return;}
      if (!results.length || (event.target !== input && !event.target.hasAttribute('data-result'))) return;
      if (event.target === input && event.key === 'Enter') {event.preventDefault(); choose(0); return;}
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const current = event.target === input ? -1 : Number(event.target.dataset.result);
      const next = event.key === 'ArrowDown' ? Math.min(current+1,results.length-1) : current-1;
      if (next < 0) input.focus();
      else list.children[next].firstElementChild.focus();
    });
    dialog.addEventListener('close',() => {
      activeDialog = null;
      dialog.remove();
      if (selected?.group === 'notes') ctx.openSearchNote(selected.id);
      else if (selected) ctx.openSearchTask(selected.id,selected.date);
      else if (trigger?.isConnected) trigger.focus({preventScroll:true});
    },{once:true});
    draw();
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  }

  window.JSearch = {open};
})();
