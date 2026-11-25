/* Chat de consulta. El hilo y el borrador viven en la memoria de la pestaña. */
(() => {
  'use strict';
  const scopes = new Map([
    ['all', 'Todo Work Station'], ['tasks', 'Actividades y espacios'], ['notes', 'Notas'],
    ['calendar', 'Calendario'], ['goals', 'Objetivos']
  ]);
  const examples = {
    all: [
      ['clipboard', '¿Qué quedó pendiente esta semana?'],
      ['timer', '¿Cuánto tiempo dediqué a cada objetivo este mes?'],
      ['calendar', '¿Qué reuniones y revisiones de notas tengo mañana?']
    ],
    tasks: [
      ['clipboard', '¿Qué actividades dejé pendientes esta semana?'],
      ['timer', '¿Cuántas horas registré en actividades y en espacios este mes?'],
      ['file-text', '¿Qué avances anoté en mis comentarios esta semana?']
    ],
    notes: [
      ['clock', '¿Qué notas debo revisar esta semana?'],
      ['notes-board', '¿Qué notas están en espera?'],
      ['list', '¿Qué temas se repiten en mis notas?']
    ],
    calendar: [
      ['calendar', '¿Qué reuniones tengo mañana?'],
      ['calendar-days', '¿Qué eventos tengo esta semana?'],
      ['layers', '¿Cómo se distribuyen mis eventos de este mes por categoría?']
    ],
    goals: [
      ['target', '¿Qué objetivos siguen en curso?'],
      ['check-circle', '¿Qué objetivos alcancé este mes?'],
      ['file-text', '¿Qué resultados registré en mis objetivos?']
    ]
  };
  const sourceTypes = new Map([
    ['task','Actividad'], ['space','Espacio'], ['note','Nota'], ['goal','Objetivo'], ['event','Evento']
  ]);
  const esc = value => window.JUI.esc(value);
  const maxQuestion = 3000;
  const threads = new Map();
  let owner, scope = 'all', view;

  function thread() {
    if (!threads.has(scope)) threads.set(scope, {turns:[], draft:'', pending:null, error:null});
    return threads.get(scope);
  }

  function cancel(t) {
    if (!t.pending) return;
    const request = t.pending;
    t.pending = null;
    t.draft = request.question;
    request.controller.abort();
  }

  function reset() {
    for (const t of threads.values()) cancel(t);
    threads.clear();
    scope = 'all';
    owner = undefined;
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

  function formatAnswer(text, sources, turnIndex) {
    // Las referencias se resuelven contra los registros que devolvió la función autenticada.
    // Las etiquetas, URL y atributos que escriba el modelo quedan como texto.
    const parts = String(text).split(/(\[\d+\]|\*\*|__)/g);
    let html = '', emphasis = '';
    for (let i = 0; i < parts.length; i++) {
      const item = parts[i];
      if (item === '**' || item === '__') {
        if (emphasis === item) { html += '</strong>'; emphasis = ''; continue; }
        if (!emphasis && parts.indexOf(item, i + 1) !== -1) {
          html += '<strong>'; emphasis = item; continue;
        }
      }
      const number = /^\[(\d+)\]$/.exec(item);
      const source = number && sources.get(Number(number[1]));
      html += source ? sourceButton(source, turnIndex, esc(item), 'jchat-ref') : esc(item);
    }
    return html;
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

  function row(speaker, content) {
    const element = document.createElement('article');
    element.className = 'jchat-turn '+(speaker === 'Tú' ? 'jchat-user' : 'jchat-assistant');
    element.innerHTML = '<p class="jchat-speaker">'+speaker+'</p>'+content;
    return element;
  }

  function answerRow(turn, index, icon) {
    const chips = [...turn.sources.values()].map(source => {
      const label = '<b>'+source.number+'</b><span>'+esc(source.title)+'</span>'+icon('arrow-up-right',12);
      return sourceButton(source, index, label, 'jchat-source');
    }).join('');
    const sources = chips ? '<div class="jchat-sources" aria-label="Registros citados">'+chips+'</div>' : '';
    return row('Asistente', '<div class="jchat-text">'+formatAnswer(turn.answer,turn.sources,index)+'</div>'+sources);
  }

  function examplesHTML(icon) {
    return '<div class="jchat-welcome"><span class="jchat-mark" aria-hidden="true">'+icon('sparkles',24)+'</span>'+
      '<h2>¿Qué quieres consultar?</h2><div class="jchat-examples">'+examples[scope].map(([glyph,question],i)=>
        '<button type="button" data-chat-example="'+i+'">'+icon(glyph,17)+'<span>'+esc(question)+'</span>'+
        icon('arrow-up-right',13)+'</button>').join('')+'</div></div>';
  }

  function paint() {
    if (!view?.page.isConnected) return;
    const t = thread(), v = view, icon = v.ctx.icon;
    const fresh = v.thread !== t;
    const atEnd = v.scroll.scrollHeight - v.scroll.clientHeight - v.scroll.scrollTop < 60;
    if (fresh) {
      v.thread = t;
      v.seen = 0; v.interim = null;
      v.log.replaceChildren();
      v.empty.innerHTML = examplesHTML(icon);
      v.scroll.scrollTop = 0;
    }
    const added = v.seen < t.turns.length || !!t.pending && v.interim !== t.pending;
    if (v.interim !== t.pending && v.interim) {
      for (const node of v.log.querySelectorAll('[data-chat-interim]')) node.remove();
      v.interim = null;
    }
    while (v.seen < t.turns.length) {
      const turn = t.turns[v.seen];
      v.log.append(row('Tú','<div class="jchat-text">'+esc(turn.question)+'</div>'),answerRow(turn,v.seen,icon));
      v.seen++;
    }
    if (t.pending && !v.interim) {
      const question = row('Tú','<div class="jchat-text">'+esc(t.pending.question)+'</div>');
      const waiting = row('Asistente','<div class="jchat-wait"><i aria-hidden="true"></i>Consultando tus registros…</div>');
      question.setAttribute('data-chat-interim',''); waiting.setAttribute('data-chat-interim','');
      v.log.append(question,waiting);
      v.interim = t.pending;
    }
    v.empty.hidden = !!(t.turns.length || t.pending);
    v.log.hidden = !v.empty.hidden;
    v.select.value = scope;
    if (v.input.value !== t.draft) v.input.value = t.draft;
    v.input.readOnly = !!t.pending;
    v.send.hidden = !!t.pending;
    v.send.disabled = !t.draft.trim() || !!t.pending;
    v.stop.hidden = !t.pending;
    v.clear.hidden = !(t.turns.length || t.pending || t.draft || t.error);
    v.error.hidden = !t.error;
    if (t.error) {
      v.error.querySelector('[data-chat-error-text]').textContent = t.error.message;
      const setup = t.error.code === 'CHAT_NOT_CONFIGURED';
      v.error.querySelector('[data-chat-setup]').hidden = !setup;
      v.error.querySelector('[data-chat-retry]').hidden = setup || !t.draft.trim();
    }
    if ((fresh || (added && atEnd)) && !v.log.hidden) v.scroll.scrollTop = v.scroll.scrollHeight;
  }

  async function submit() {
    const t = thread(), question = t.draft.trim();
    if (t.pending || !question || question.length > maxQuestion) return;
    const payload = {scope, message:question, history:contextHistory(t)};
    const request = {question, controller:new AbortController()};
    t.pending = request;
    t.draft = ''; t.error = null;
    paint();
    try {
      const result = await view.ctx.askChat(payload, request.controller.signal);
      if (t.pending !== request) return;
      if (typeof result?.answer !== 'string' || !result.answer.trim())
        throw new Error('La consulta no devolvió una respuesta. Puedes volver a enviarla.');
      t.turns.push({question, answer:result.answer, sources:verifiedSources(result.sources)});
    } catch (err) {
      if (t.pending !== request) return;
      t.draft = question;
      if (!request.controller.signal.aborted)
        t.error = {code:err?.code, message:err?.message || 'No se pudo completar la consulta.'};
    } finally {
      if (t.pending === request) {
        t.pending = null;
        const restoreFocus = view?.page.isConnected && view.thread === t && document.activeElement === view.stop;
        paint();
        if (restoreFocus) view.input.focus({preventScroll:true});
      }
    }
  }

  function render(el, ctx) {
    const userId = ctx.user?.id;
    if (owner !== undefined && owner !== userId) reset();
    owner = userId;
    if (view?.page.parentNode === el) { view.ctx = ctx; paint(); return; }
    const icon = ctx.icon;
    el.innerHTML = '<section class="jchat" aria-labelledby="jchat-title">'+
      '<header class="jchat-head"><div><h1 id="jchat-title">Chat</h1>'+
      '<p>Consulta tus registros de Work Station con ChatGPT.</p></div>'+
      '<label class="jchat-scope"><span>Consultar en</span><select data-chat-scope>'+
      [...scopes].map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></label></header>'+
      '<div class="panel jchat-panel"><div class="jchat-tools"><button type="button" class="btn ghost" data-chat-new hidden>'+
      icon('plus',15)+'Nueva conversación</button></div>'+
      '<div class="jchat-scroll" data-chat-scroll><div data-chat-empty></div>'+
      '<div class="jchat-log" role="log" aria-label="Mensajes de la conversación" aria-live="polite" aria-relevant="additions" data-chat-log></div></div>'+
      '<div class="jchat-footer"><div class="jchat-error" data-chat-error role="alert" hidden>'+
      '<span data-chat-error-text></span><a href="./docs/chat.html" target="_blank" rel="noopener" data-chat-setup hidden>Ver pasos de configuración</a>'+
      '<button type="button" data-chat-retry hidden>Reintentar</button></div>'+
      '<form class="jchat-compose" data-chat-form><label class="jchat-sr" for="jchat-question">Tu pregunta</label>'+
      '<textarea id="jchat-question" name="message" rows="2" maxlength="'+maxQuestion+'" placeholder="Escribe tu pregunta…" required></textarea>'+
      '<div class="jchat-actions"><span class="jchat-keyhint">Enter para enviar · Mayús + Enter para otra línea</span>'+
      '<button type="submit" class="btn primary" data-chat-send disabled>Enviar '+icon('arrow-right',16)+'</button>'+
      '<button class="btn" type="button" data-chat-stop hidden>'+icon('x',15)+' Detener</button></div></form>'+
      '<p class="jchat-disclosure">'+icon('info',14)+'<span>Al enviar, OpenAI recibe tu pregunta, los mensajes recientes de este ámbito y los datos necesarios para responder. El hilo se borra al recargar o cerrar sesión.</span></p></div></div></section>';
    const page = el.querySelector('.jchat');
    const get = selector => page.querySelector(selector);
    const v = {page,ctx,log:get('[data-chat-log]'),scroll:get('[data-chat-scroll]'),empty:get('[data-chat-empty]'),
      error:get('[data-chat-error]'),input:get('textarea'),select:get('[data-chat-scope]'),clear:get('[data-chat-new]'),
      send:get('[data-chat-send]'),stop:get('[data-chat-stop]'),thread:null,seen:0,interim:null};
    view = v;
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
      v.clear.hidden = !(t.turns.length || t.pending || t.draft);
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
        const item = examples[scope][Number(button.dataset.chatExample)];
        if (item && !thread().pending) { thread().draft = item[1]; submit(); v.input.focus({preventScroll:true}); }
      } else if (button.hasAttribute('data-chat-source')) {
        const source = thread().turns[Number(button.dataset.turn)]?.sources.get(Number(button.dataset.number));
        if (source) v.ctx.openChatSource(source);
      }
    });
    paint();
  }
  window.JChat = Object.freeze({render,reset});
})();
