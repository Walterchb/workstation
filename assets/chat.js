/* Chat de consulta. El hilo y el borrador viven en la memoria de la pestaña. */
(() => {
  'use strict';
  const scopes = new Map([
    ['all', 'Todo Work Station'], ['tasks', 'Actividades y espacios'], ['notes', 'Notas'],
    ['calendar', 'Calendario'], ['goals', 'Objetivos']
  ]);
  const examples = {
    all: [
      ['file-text', 'Avances de la semana', '¿Qué avances documenté esta semana en mis comentarios?'],
      ['clipboard', 'Pendientes', '¿Qué quedó pendiente esta semana?'],
      ['calendar', 'Próxima jornada', '¿Qué reuniones y revisiones de notas tengo mañana?']
    ],
    tasks: [
      ['activity', 'Avances registrados', '¿Qué avances anoté en mis comentarios esta semana?'],
      ['timer', 'Tiempo registrado', '¿Cuántas horas registré en actividades y en espacios este mes?'],
      ['clipboard', 'Actividades pendientes', '¿Qué actividades dejé pendientes esta semana?']
    ],
    notes: [
      ['clock', 'Próximas revisiones', '¿Qué notas debo revisar esta semana?'],
      ['notes-board', 'Notas en espera', '¿Qué notas siguen en espera y desde cuándo?'],
      ['list', 'Temas frecuentes', '¿Qué temas se repiten en mis notas?']
    ],
    calendar: [
      ['calendar', 'Reuniones de mañana', '¿A qué hora tengo reuniones mañana?'],
      ['calendar-days', 'Agenda semanal', '¿Qué eventos tengo programados esta semana?'],
      ['layers', 'Categorías', '¿Cómo se distribuyen los eventos del mes por categoría?']
    ],
    goals: [
      ['target', 'Objetivos en curso', '¿Qué objetivos siguen en curso?'],
      ['check-circle', 'Objetivos alcanzados', '¿Qué objetivos marqué como alcanzados este mes?'],
      ['timer', 'Tiempo por objetivo', '¿Cuánto tiempo registré en cada objetivo este mes?']
    ]
  };
  const sourceTypes = new Map([
    ['task','Actividad'], ['space','Espacio'], ['note','Nota'], ['goal','Objetivo'], ['event','Evento']
  ]);
  const followups = [
    ['Revisar pendientes','De estos asuntos, ¿qué me queda por hacer y qué está pendiente de respuesta?'],
    ['Ver evolución','¿Cómo evolucionaron estos asuntos entre el primer y el último registro del período?'],
    ['Preparar un correo','Con los avances documentados que acabamos de revisar, redacta un correo breve para mi gerencia.']
  ];
  const esc = value => window.JUI.esc(value);
  const maxQuestion = 3000;
  const progressText = {
    sending:'Enviando tu consulta…', searching:'Consultando tus registros…', writing:'Redactando la respuesta…',
    stopped:'Respuesta parcial · Detenida', interrupted:'Respuesta parcial · Se interrumpió la consulta'
  };
  const threads = new Map();
  let owner, scope = 'all', view;

  function thread() {
    if (!threads.has(scope)) threads.set(scope, {turns:[], draft:'', pending:null, incomplete:null, error:null});
    return threads.get(scope);
  }

  function cancel(t) {
    if (!t.pending) return;
    const request = t.pending;
    t.pending = null;
    request.stage = 'stopped';
    t.incomplete = request.text ? request : null;
    t.draft = request.question;
    request.controller.abort();
  }

  function reset() {
    for (const t of threads.values()) cancel(t);
    threads.clear();
    scope = 'all';
    owner = undefined;
    window.WorkStationChatBudget?.setUser(null);
    if (view) view.page.remove();
    view = null;
  }

  function readableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value+'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-PE', {
      day:'numeric', month:'short', year:'numeric', timeZone:'UTC'
    });
  }

  function verifiedSources(list) {
    const found = new Map();
    for (const source of Array.isArray(list) ? list : []) {
      if (!source || !sourceTypes.has(source.type) || typeof source.id !== 'string' ||
          !source.id || typeof source.title !== 'string' ||
          !Number.isSafeInteger(source.number) || source.number < 1 || found.has(source.number)) continue;
      found.set(source.number, source);
    }
    return found;
  }

  function sourceLabel(source) {
    return [sourceTypes.get(source.type), source.title, readableDate(source.date)].filter(Boolean).join(' · ');
  }

  function sourceButton(source, turnIndex, label, cls) {
    return '<button type="button" class="'+cls+'" data-chat-source data-turn="'+turnIndex+
      '" data-number="'+source.number+'" aria-label="Abrir registro '+source.number+' · '+esc(sourceLabel(source))+
      '" title="'+esc(sourceLabel(source))+'">'+label+'</button>';
  }

  function contextHistory(t) {
    let budget = 18000;
    const history = [];
    for (const turn of t.turns.slice(-4).reverse()) {
      const names = [...turn.sources].map(([number,source])=>
        '['+number+'] '+sourceLabel(source).slice(0,180)).join('\n').slice(0,1500);
      const notes = names ? '\nRegistros citados\n'+names : '';
      const content = turn.answer.slice(0,6000-notes.length)+notes;
      const pairSize = turn.question.length + content.length;
      if (pairSize > budget) break;
      history.unshift({role:'user', content:turn.question}, {role:'assistant', content});
      budget -= pairSize;
    }
    return history;
  }

  function referenceCaption(context) {
    const first = readableDate(context.from), last = readableDate(context.to);
    const period = first && last && first !== last ? first+' – '+last : first || last;
    return [context.view,period,...(context.filters || [])].filter(Boolean).join(' · ');
  }

  // Los IDs apuntan al registro original aunque haya cambiado su texto. El servidor
  // vuelve a comprobar el acceso y consulta el contenido vigente cuando corresponde.
  function conversationMemory(t, history) {
    const topics = [], sources = [], seen = new Set();
    const compacted = t.turns.slice(0,t.turns.length - history.length / 2).slice(-4);
    const recent = t.turns.slice(compacted.length ? -2 : -6);
    for (const turn of new Set([...compacted,...recent])) {
      const context = turn.viewContext || {};
      const reference = [context.view,context.from,context.to !== context.from ? context.to : ''].filter(Boolean).join(' · ');
      topics.push(((reference ? '('+reference+') ' : '')+turn.question).slice(0,240));
    }
    for (let index = t.turns.length - 1; index >= 0 && sources.length < 12; index--) {
      const turn = t.turns[index];
      for (const match of turn.answer.matchAll(/\[(\d+)\]/g)) {
        const source = turn.sources.get(Number(match[1]));
        if (!source || source.id.length > 160) continue;
        const key = source.type+'/'+source.id;
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push({type:source.type,id:source.id,title:source.title.slice(0,240)});
        if (sources.length === 12) break;
      }
    }
    return {topics,sources};
  }

  function exampleItems(context) {
    if (!context.from && !context.to) return examples[scope];
    const periodItems = {
      all:[
        ['file-text','Qué cambió','¿Qué avances y decisiones documenté en el período visible?'],
        ['clipboard','Por atender','De los asuntos del período visible, ¿qué me quedó por hacer y qué esperaba de otras personas?'],
        examples.all[2]
      ],
      tasks:[
        ['activity','Evolución','¿Qué cambió según los comentarios de las actividades del período visible?'],
        ['timer','Tiempo registrado','¿Cuántas horas registré en actividades y en espacios en el período visible?'],
        ['clipboard','Por atender','¿Qué actividades quedaron pendientes al cierre del período visible?']
      ],
      calendar:[
        ['calendar','Reuniones','¿Qué reuniones tengo en el período visible?'],
        ['calendar-days','Agenda del período','¿Cómo se organiza mi agenda en el período visible?'],
        ['layers','Categorías','¿Cómo se distribuyen los eventos del período visible por categoría?']
      ]
    };
    return periodItems[scope] || examples[scope];
  }

  function refreshContext(v) {
    const context = window.WorkStationChatContext?.get() || {};
    const caption = referenceCaption(context);
    v.context.hidden = !caption;
    v.context.textContent = caption ? 'Vista de referencia · '+caption : '';
    v.viewContext = context;
    v.examples = exampleItems(context);
    if (v.thread && !v.thread.turns.length) v.empty.innerHTML = examplesHTML(v.ctx.icon,v.examples);
  }

  function row(speaker, content, icon) {
    const assistant = speaker === 'Asistente';
    const element = document.createElement('article');
    element.className = 'jchat-turn '+(assistant ? 'jchat-assistant' : 'jchat-user');
    const mark = assistant ? '<span class="jchat-speaker-mark">'+icon('sparkles',13)+'</span>' : '';
    element.innerHTML = '<p class="jchat-speaker">'+mark+speaker+'</p>'+content;
    return element;
  }

  function answerRow(turn, index, icon) {
    const chips = [...turn.sources.values()].map(source => {
      const details = [sourceTypes.get(source.type),readableDate(source.date)].filter(Boolean).join(' · ');
      const label = '<b>'+source.number+'</b><span class="jchat-source-copy"><strong>'+esc(source.title)+
        '</strong><small class="jchat-source-detail">'+esc(details)+'</small></span>'+icon('arrow-up-right',13);
      return sourceButton(source, index, label, 'jchat-source');
    }).join('');
    const sources = chips ? '<div class="jchat-sources" role="group" aria-label="Registros citados">'+
      '<p class="jchat-source-title">Registros citados</p><div class="jchat-source-list">'+chips+'</div></div>' : '';
    const answer = window.JChatFormat.render(turn.answer, {citation(number) {
      const source = turn.sources.get(number);
      return source ? sourceButton(source,index,String(number),'jchat-ref') : '';
    }});
    return row('Asistente', '<div class="jchat-answer">'+answer+'</div>'+sources+
      '<div class="jchat-answer-actions"><button type="button" class="jchat-copy" data-chat-copy data-turn="'+index+
      '">'+icon('clipboard',13)+'<span>Copiar respuesta</span></button>'+
      '<span class="jchat-sr" role="status" data-chat-copy-status></span></div>', icon);
  }

  async function copyAnswer(button, turn, icon) {
    const actions = button.parentNode;
    const status = actions.querySelector('[data-chat-copy-status]');
    const references = [...turn.sources.values()].map(source=>'['+source.number+'] '+sourceLabel(source));
    const text = turn.answer+(references.length ? '\n\nRegistros citados\n'+references.join('\n') : '');
    try {
      const clipboard = navigator.clipboard;
      let copied = false;
      if (clipboard?.write && typeof ClipboardItem === 'function') {
        const rich = button.closest('.jchat-turn').querySelector('.jchat-answer').cloneNode(true);
        for (const ref of rich.querySelectorAll('[data-chat-source]')) {
          const number = Number(ref.dataset.number);
          ref.replaceWith(document.createTextNode(turn.sources.has(number) ? '['+number+']' : ''));
        }
        for (const wrap of rich.querySelectorAll('.jchat-table-wrap')) wrap.replaceWith(wrap.querySelector('table'));
        if (references.length) {
          const heading = document.createElement('h3');
          heading.textContent = 'Registros citados';
          rich.append(heading);
          for (const label of references) {
            const line = document.createElement('p');
            line.textContent = label;
            rich.append(line);
          }
        }
        // Algunos navegadores aceptan texto simple aunque bloqueen el formato HTML.
        try {
          await clipboard.write([new ClipboardItem({
            'text/plain':new Blob([text],{type:'text/plain'}),
            'text/html':new Blob([rich.innerHTML],{type:'text/html'})
          })]);
          copied = true;
        } catch { /* Usar la misma respuesta en texto simple. */ }
      }
      if (!copied) await clipboard.writeText(text);
      if (!button.isConnected) return;
      actions.querySelector('.jchat-copy-manual')?.remove();
      status.classList.add('jchat-sr');
      button.innerHTML = icon('check-circle',13)+'<span>Copiada</span>';
      status.textContent = 'Respuesta copiada al portapapeles.';
      setTimeout(()=>{
        if (!button.isConnected) return;
        button.innerHTML = icon('clipboard',13)+'<span>Copiar respuesta</span>';
        status.textContent = '';
      },2200);
    } catch {
      if (!button.isConnected) return;
      let field = actions.querySelector('.jchat-copy-manual');
      if (!field) {
        field = document.createElement('textarea');
        field.className = 'jchat-copy-manual';
        field.readOnly = true;
        field.rows = 2;
        field.setAttribute('aria-label','Respuesta y referencias para copiar');
        actions.append(field);
      }
      field.value = text;
      field.focus({preventScroll:true});
      field.select();
      status.classList.remove('jchat-sr');
      status.textContent = 'Usa la opción Copiar sobre el texto seleccionado.';
    }
  }

  function examplesHTML(icon,items) {
    return '<div class="jchat-welcome"><span class="jchat-mark" aria-hidden="true">'+icon('sparkles',25)+'</span>'+
      '<div class="jchat-welcome-copy"><h2>¿Qué quieres revisar?</h2>'+
      '<p>Puedes abrir los registros citados en cada respuesta.</p></div>'+
      '<div class="jchat-examples">'+items.map(([glyph,title,question],i)=>
        '<button type="button" data-chat-example="'+i+'"><span class="jchat-example-icon">'+icon(glyph,18)+
        '</span><span class="jchat-example-copy"><strong>'+esc(title)+'</strong><span>'+esc(question)+'</span></span>'+
        '<span class="jchat-example-arrow">'+icon('arrow-up-right',15)+'</span></button>').join('')+'</div></div>';
  }

  // Conserva los párrafos, la selección y el desplazamiento mientras crece el Markdown.
  function syncAnswerChildren(target, source) {
    const incoming = [...source.childNodes];
    for (const [index, fresh] of incoming.entries()) {
      const current = target.childNodes[index];
      if (!current) { target.append(fresh); continue; }
      if (current.isEqualNode(fresh)) continue;
      if (current.nodeType === 3 && fresh.nodeType === 3) {
        if (fresh.data.startsWith(current.data) && typeof current.appendData === 'function') {
          current.appendData(fresh.data.slice(current.data.length));
        } else {
          current.nodeValue = fresh.data;
        }
      } else if (current.nodeType === 1 && fresh.nodeType === 1 && current.cloneNode(false).isEqualNode(fresh.cloneNode(false))) {
        syncAnswerChildren(current,fresh);
      } else {
        current.replaceWith(fresh);
      }
    }
    while (target.childNodes.length > incoming.length) target.lastChild.remove();
  }

  // El matiz solo afecta a caracteres que el navegador ya ha mostrado.
  function softenAppend(container, offset) {
    const registry = window.CSS?.highlights;
    if (!registry || typeof Highlight !== 'function' || typeof StaticRange !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const walker = document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
    let start, end;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!start && offset < node.length) start = {node,offset};
      if (!start) offset -= node.length;
      end = node;
    }
    if (!start || !end) return;
    // Un fragmento posterior puede ampliar el mismo nodo sin modificar este intervalo.
    const frozen = new StaticRange({startContainer:start.node,startOffset:start.offset,
      endContainer:end,endOffset:end.length});
    function layer(key) {
      if (!registry.has(key)) registry.set(key,new Highlight());
      return registry.get(key);
    }
    const fresh = layer('jchat-fresh'), settling = layer('jchat-settling');
    fresh.add(frozen);
    setTimeout(()=>{
      fresh.delete(frozen); settling.add(frozen);
      setTimeout(()=>settling.delete(frozen),55);
    },55);
  }

  function renderPartial(container, text, soften) {
    const markup = window.JChatFormat.render(text.replace(/\[\d*$/,''), {citation:()=> ' '});
    const template = document.createElement('template');
    template.innerHTML = markup;
    const before = container.textContent;
    syncAnswerChildren(container,template.content);
    if (soften && container.textContent.startsWith(before)) softenAppend(container,before.length);
  }

  function paint() {
    if (!view?.page.isConnected) return;
    const t = thread(), v = view, icon = v.ctx.icon;
    const fresh = v.thread !== t;
    const previousTop = v.scroll.scrollTop;
    const atEnd = v.scroll.scrollHeight - v.scroll.clientHeight - previousTop < 60;
    let latestAnswer;
    const reply = t.pending || t.incomplete;
    const hadLiveText = !!v.shownText && !fresh;
    if (fresh) {
      v.thread = t;
      v.seen = 0; v.interim = null; v.shownText = '';
      v.log.replaceChildren();
      v.examples = exampleItems(v.viewContext);
      v.empty.innerHTML = examplesHTML(icon,v.examples);
      v.scroll.scrollTop = 0;
    }
    const added = v.seen < t.turns.length || !!reply && (v.interim !== reply || v.shownText !== reply.text);
    if (v.interim !== reply && v.interim) {
      const completed = !reply && t.turns[v.seen];
      if (completed && completed.question === v.interim.question) {
        // Finalizar sobre los nodos que ya se están leyendo también conserva la selección.
        const finished = answerRow(completed,v.seen,icon);
        const content = finished.querySelector('.jchat-answer');
        syncAnswerChildren(v.partial,content);
        const existing = v.partial.parentNode;
        v.partial.classList.remove('jchat-partial');
        v.partial.removeAttribute('data-chat-partial');
        v.progress.remove();
        while (content.nextSibling) existing.append(content.nextSibling);
        existing.removeAttribute('aria-live');
        for (const node of v.log.querySelectorAll('[data-chat-interim]')) node.removeAttribute('data-chat-interim');
        latestAnswer = existing;
        v.seen++;
      } else {
        for (const node of v.log.querySelectorAll('[data-chat-interim]')) node.remove();
      }
      v.interim = null; v.shownText = '';
    }
    while (v.seen < t.turns.length) {
      const turn = t.turns[v.seen];
      latestAnswer = answerRow(turn,v.seen,icon);
      v.log.append(row('Tú','<div class="jchat-text">'+esc(turn.question)+'</div>'),latestAnswer);
      v.seen++;
    }
    if (reply && !v.interim) {
      const question = row('Tú','<div class="jchat-text">'+esc(reply.question)+'</div>');
      const waiting = row('Asistente','<div class="jchat-wait" data-chat-progress><i aria-hidden="true"></i>'+
        '<span></span></div><div class="jchat-answer jchat-partial" data-chat-partial></div>',icon);
      waiting.setAttribute('aria-live','off');
      question.setAttribute('data-chat-interim',''); waiting.setAttribute('data-chat-interim','');
      v.log.append(question,waiting);
      v.interim = reply;
      v.partial = waiting.querySelector('[data-chat-partial]');
      v.progress = waiting.querySelector('[data-chat-progress]');
    }
    const status = reply ? progressText[reply.stage] : latestAnswer && !fresh ? 'Respuesta completa.' : '';
    if (v.activity.textContent !== status) v.activity.textContent = status;
    if (reply) {
      if (v.progress.lastElementChild.textContent !== status) v.progress.lastElementChild.textContent = status;
      v.progress.firstElementChild.hidden = !t.pending;
      if (v.shownText !== reply.text) {
        renderPartial(v.partial,reply.text,!fresh && !!t.pending);
        v.shownText = reply.text;
      }
    }
    v.empty.hidden = !!(t.turns.length || reply);
    v.log.hidden = !v.empty.hidden;
    v.select.value = scope;
    if (v.input.value !== t.draft) v.input.value = t.draft;
    v.input.readOnly = !!t.pending;
    v.send.hidden = !!t.pending;
    v.send.disabled = !t.draft.trim() || !!t.pending;
    v.stop.hidden = !t.pending;
    v.followups.hidden = !!reply || !!t.error || !!t.draft || !t.turns.at(-1)?.sources.size;
    v.clear.disabled = !(t.turns.length || reply || t.draft || t.error);
    v.error.hidden = !t.error;
    if (t.error) {
      v.error.querySelector('[data-chat-error-text]').textContent = t.error.message;
      const setup = ['CHAT_NOT_CONFIGURED','CHAT_SUPABASE_CONFIG','CHAT_KEY_MISSING','CHAT_KEY_INVALID',
        'CHAT_KEY_PERMISSION','CHAT_MODEL','CHAT_QUOTA'].includes(t.error.code);
      v.error.querySelector('[data-chat-setup]').hidden = !setup;
      v.error.querySelector('[data-chat-retry]').hidden = !t.draft.trim();
    }
    if (v.log.hidden || (!fresh && !added)) return;
    if (!fresh && !atEnd) {
      v.scroll.scrollTop = previousTop;
    } else if (latestAnswer && hadLiveText) {
      v.scroll.scrollTop = previousTop;
    } else if (latestAnswer && !reply) {
      const top = latestAnswer.getBoundingClientRect().top - v.scroll.getBoundingClientRect().top;
      // El navegador limita el desplazamiento al final si la respuesta entera cabe.
      v.scroll.scrollTop = Math.max(0, v.scroll.scrollTop + top - 10);
    } else {
      v.scroll.scrollTop = v.scroll.scrollHeight;
    }
  }

  async function submit() {
    const t = thread(), question = t.draft.trim();
    if (t.pending || !question || question.length > maxQuestion) return;
    const viewContext = window.WorkStationChatContext?.get() || {};
    const history = contextHistory(t);
    const payload = {scope,message:question,history,viewContext,memory:conversationMemory(t,history)};
    const request = {question, controller:new AbortController(), text:'', stage:'sending'};
    t.pending = request;
    t.incomplete = null; t.draft = ''; t.error = null;
    paint();
    let scheduled = false;
    function update(event) {
      if (t.pending !== request) return;
      if (event.type === 'status') request.stage = event.stage;
      else if (event.type === 'reset') { request.text = ''; request.stage = 'searching'; }
      else if (event.type === 'delta') { request.text += event.text; request.stage = 'writing'; }
      else return;
      if (!scheduled && view?.thread === t && view.page.isConnected) {
        scheduled = true;
        requestAnimationFrame(()=>{
          scheduled = false;
          if (t.pending === request && view?.thread === t) paint();
        });
      }
    }
    try {
      const result = await view.ctx.askChat(payload, request.controller.signal, update);
      if (t.pending !== request) return;
      if (typeof result?.answer !== 'string' || !result.answer.trim())
        throw new Error('La consulta no devolvió una respuesta. Puedes volver a enviarla.');
      t.turns.push({question,viewContext,answer:result.answer,sources:verifiedSources(result.sources)});
    } catch (err) {
      if (t.pending !== request) return;
      t.draft = question;
      if (!request.controller.signal.aborted) {
        request.stage = 'interrupted';
        t.incomplete = request.text ? request : null;
        t.error = {code:err?.code, message:err?.message || 'No se pudo completar la consulta.'};
      }
    } finally {
      if (t.pending === request) {
        t.pending = null;
        const restoreFocus = view?.page.isConnected && view.thread === t && document.activeElement === view.stop;
        paint();
        if (restoreFocus) view.input.focus({preventScroll:true});
      }
    }
  }

  function render(el, ctx, {compact = false} = {}) {
    const userId = ctx.user?.id;
    if (owner !== undefined && owner !== userId) reset();
    owner = userId;
    window.WorkStationChatBudget?.setUser(owner);
    if (view?.page.parentNode === el && view.compact === compact) {
      view.ctx = ctx; refreshContext(view); paint(); return;
    }
    if (view) view.page.remove();
    const icon = ctx.icon, id = compact ? 'jchat-quick' : 'jchat';
    const header = compact ? '' : '<header class="jchat-head"><div class="jchat-heading">'+
      '<span class="jchat-brand-icon">'+icon('sparkles',20)+'</span><div><h1 id="'+id+'-title">Chat de Work Station</h1>'+
      '<p>Consulta tus actividades, notas, objetivos y calendario con ChatGPT.</p></div></div>'+
      (window.WorkStationChatBudget?.header() || '')+'</header>';
    el.innerHTML = '<section class="jchat'+(compact ? ' jchat-compact' : '')+'" '+
      (compact ? 'aria-label="Conversación"' : 'aria-labelledby="'+id+'-title"')+'>'+header+
      '<div class="panel jchat-panel"><div class="jchat-tools jchat-toolbar">'+
      '<label class="jchat-scope"><span>Consultar en</span><select data-chat-scope>'+
      [...scopes].map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label>'+
      '<button type="button" class="btn ghost" data-chat-new title="Empezar de nuevo en el ámbito seleccionado" disabled>'+
      icon('plus',15)+'<span>Nueva conversación</span></button></div>'+
      '<p class="jchat-view-context" data-chat-context hidden></p>'+
      '<div class="jchat-scroll" data-chat-scroll><div data-chat-empty></div>'+
      '<div class="jchat-log" role="log" aria-label="Mensajes de la conversación" aria-live="polite" aria-relevant="additions" data-chat-log></div></div>'+
      '<div class="jchat-footer"><span class="jchat-sr" role="status" data-chat-activity></span>'+
      '<div class="jchat-error" data-chat-error role="alert" hidden>'+
      '<span data-chat-error-text></span><a href="./docs/chat.html" target="_blank" rel="noopener" data-chat-setup hidden>Ver configuración</a>'+
      '<button type="button" data-chat-retry hidden>Reintentar</button></div>'+
      '<div class="jchat-followups" data-chat-followups role="group" aria-label="Continuar la conversación" hidden>'+
      followups.map(([label],i)=>'<button type="button" data-chat-followup="'+i+'">'+esc(label)+'</button>').join('')+'</div>'+
      '<form class="jchat-compose" data-chat-form><label class="jchat-sr" for="'+id+'-question">Tu consulta</label>'+
      '<textarea id="'+id+'-question" name="message" rows="2" maxlength="'+maxQuestion+
      '" placeholder="Pregunta sobre tus registros…" enterkeyhint="send" required></textarea>'+
      '<div class="jchat-actions"><span class="jchat-keyhint">Enter para enviar · Mayús + Enter para otra línea</span>'+
      '<button type="submit" class="btn primary" data-chat-send aria-label="Enviar consulta" disabled><span>Enviar</span> '+icon('arrow-right',16)+'</button>'+
      '<button class="btn" type="button" data-chat-stop hidden>'+icon('x',15)+' Detener</button></div></form>'+
      '</div></div></section>';
    const page = el.querySelector('.jchat');
    const get = selector => page.querySelector(selector);
    const v = {page,ctx,compact,log:get('[data-chat-log]'),scroll:get('[data-chat-scroll]'),empty:get('[data-chat-empty]'),
      error:get('[data-chat-error]'),activity:get('[data-chat-activity]'),input:get('textarea'),select:get('[data-chat-scope]'),clear:get('[data-chat-new]'),
      send:get('[data-chat-send]'),stop:get('[data-chat-stop]'),context:get('[data-chat-context]'),
      followups:get('[data-chat-followups]'),thread:null,seen:0,interim:null};
    view = v;
    refreshContext(v);
    v.select.addEventListener('change',()=>{
      if (!scopes.has(v.select.value) || scope === v.select.value) return;
      cancel(thread());
      scope = v.select.value;
      paint();
    });
    v.input.addEventListener('input',()=>{
      const t = thread(); t.draft = v.input.value;
      if (t.error) { t.error = null; v.error.hidden = true; }
      v.send.disabled = !t.draft.trim() || !!t.pending;
      v.clear.disabled = !(t.turns.length || t.pending || t.incomplete || t.draft);
      v.followups.hidden = !!t.pending || !!t.incomplete || !!t.draft || !t.turns.at(-1)?.sources.size;
    });
    v.input.addEventListener('keydown',event=>{
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!event.repeat) submit();
      }
    });
    get('[data-chat-form]').addEventListener('submit',event=>{event.preventDefault(); submit();});
    v.clear.addEventListener('click',()=>{
      cancel(thread());
      threads.delete(scope);
      paint();
      v.input.focus({preventScroll:true});
    });
    v.stop.addEventListener('click',()=>{
      cancel(thread()); paint();
      v.input.focus({preventScroll:true});
    });
    get('[data-chat-retry]').addEventListener('click',submit);
    page.addEventListener('click',event=>{
      const button = event.target.closest?.('button');
      if (!button) return;
      if (button.hasAttribute('data-chat-example')) {
        const item = v.examples[Number(button.dataset.chatExample)];
        if (item && !thread().pending) { thread().draft = item[2]; submit(); v.input.focus({preventScroll:true}); }
      } else if (button.hasAttribute('data-chat-followup')) {
        const item = followups[Number(button.dataset.chatFollowup)];
        if (item && !thread().pending) {
          thread().draft = item[1];
          paint();
          v.input.focus({preventScroll:true});
        }
      } else if (button.hasAttribute('data-chat-copy')) {
        const turn = thread().turns[Number(button.dataset.turn)];
        if (turn) copyAnswer(button,turn,icon);
      } else if (button.hasAttribute('data-chat-source')) {
        const source = thread().turns[Number(button.dataset.turn)]?.sources.get(Number(button.dataset.number));
        if (source) v.ctx.openChatSource(source);
      }
    });
    paint();
  }
  window.JChat = Object.freeze({render,reset});
})();
