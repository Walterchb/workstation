/* Suscripciones de Apple para un calendario completo o una de sus categorías. */
(() => {
  'use strict';
  const {esc, icon} = window.JUI;
  const model = window.JCalendarModel;
  const unassigned = {id:'', name:'Sin categoría', color:'#687F8A'};

  function download(calendar, events, categories) {
    const text = window.JCalendarICS.serialize(calendar, events, categories);
    const url = URL.createObjectURL(new Blob([text], {type:'text/calendar;charset=utf-8'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = (calendar.name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').trim() || 'Calendario') + '.ics';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function freshToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function feedBase() {
    const url = new URL(window.JORNADA_CONFIG.supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Revisa la URL de Supabase en config.js.');
    return url.origin + '/functions/v1/workhub-calendar';
  }

  async function checkService(byCategory) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(feedBase() + (byCategory ? '/category-status' : '/status'),
        {signal:controller.signal, credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'});
      const expected = byCategory ? 'workhub-calendar/categories/1' : 'workhub-calendar/1';
      if (res.ok && (await res.text()).trim() === expected) return;
    } catch { /* Conservar el calendario si el servicio no responde. */ }
    finally { clearTimeout(timeout); }
    if (byCategory) throw new Error('El servicio por categoría no está disponible. Revisa tu conexión y la actualización de Supabase en la guía.');
    throw new Error('No se pudo conectar con el servicio de suscripción. Revisa tu conexión y la guía de activación.');
  }

  function open(calendar, ctx) {
    if (document.querySelector('dialog.japple-dialog[open]')) return;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'japple-dialog';
    dialog.setAttribute('aria-labelledby','japple-title');
    dialog.innerHTML = '<header><div><span class="japple-calendar"></span><h2 id="japple-title">Calendario de Apple</h2></div>' +
      '<button class="icon-btn" type="button" data-apple-close aria-label="Cerrar">' + icon('x',18) + '</button></header>' +
      '<section class="japple-live"><h3>Suscripción</h3><div class="japple-setup"><div class="japple-modes" role="group" aria-label="Tipo de suscripción">' +
      '<button type="button" data-apple-mode="full">Calendario completo</button><button type="button" data-apple-mode="category">Por categoría</button></div>' +
      '<div class="japple-category" data-apple-category-box hidden><label>Categoría<select data-apple-category></select></label>' +
      '<button class="japple-color" type="button" data-apple-copy-color><i aria-hidden="true"></i><span data-apple-hex></span></button></div></div>' +
      '<div data-apple-content></div><p class="japple-migration" data-apple-migration hidden>Cuando veas tus categorías en Apple, puedes cancelar allí la suscripción al calendario completo para evitar duplicados.</p>' +
      '<p class="japple-status" role="status" hidden></p></section>' +
      '<section class="japple-export"><div><h3>Descargar archivo .ics</h3><p data-apple-export-note></p></div>' +
      '<button class="btn" type="button" data-apple-download>' + icon('download',16) + 'Descargar</button></section>' +
      '<footer><a href="./docs/calendario-apple.html" target="_blank" rel="noopener noreferrer">Guía de activación</a></footer>';
    const setup = dialog.querySelector('.japple-setup');
    const catBox = dialog.querySelector('[data-apple-category-box]');
    const select = dialog.querySelector('[data-apple-category]');
    const colorButton = dialog.querySelector('[data-apple-copy-color]');
    const hue = dialog.querySelector('[data-apple-hex]');
    const content = dialog.querySelector('[data-apple-content]');
    const status = dialog.querySelector('.japple-status');
    let state = ctx.state, current = calendar, busy = false;
    const categories = () => [...model.categories(state),unassigned];
    const choices = categories();
    const existing = choices.find(cat=>model.getCategoryToken(current,cat.id));
    const assigned = new Set(model.events(state).filter(event=>event.calendarId===current.id).map(event=>event.categoryId||''));
    const initial = existing || choices.find(cat=>assigned.has(cat.id)) || choices[0];
    let categoryId = initial.id;
    let byCategory = Boolean(existing && !current.appleToken);
    const pending = new Map();

    function token(record) {
      return byCategory ? model.getCategoryToken(record,categoryId) : record.appleToken;
    }

    function selectedCategory() {
      return categories().find(cat=>cat.id===categoryId);
    }

    function announce(text) { status.textContent = text; status.hidden = !text; }

    function draw() {
      const cat = selectedCategory() || unassigned;
      categoryId = cat.id;
      dialog.querySelector('.japple-calendar').textContent = current.name;
      for (const mode of setup.querySelectorAll('[data-apple-mode]'))
        mode.setAttribute('aria-pressed',String((mode.dataset.appleMode === 'category') === byCategory));
      catBox.hidden = !byCategory;
      if (byCategory) {
        select.innerHTML = categories().map(item=>'<option value="'+esc(item.id)+'"'+(item.id===categoryId?' selected':'')+'>'+esc(item.name)+'</option>').join('');
        const color=cat.color.toUpperCase();
        hue.textContent=color;
        colorButton.style.setProperty('--japple-hue',color);
        colorButton.setAttribute('aria-label','Copiar color '+color);
        colorButton.title='Copiar color '+color;
      }
      dialog.querySelector('[data-apple-export-note]').textContent=byCategory?'Copia de los eventos de «'+cat.name+'».':'Copia de los eventos del calendario.';
      dialog.querySelector('[data-apple-migration]').hidden = !byCategory || !current.appleToken;
      const key = token(current);
      const hint = byCategory ? '<p>Apple asigna un color a cada calendario. Suscríbete una vez por categoría. Si Apple elige otro tono, usa el color indicado arriba.</p>' : '';
      if (!key) {
        content.innerHTML = hint + '<p>Quien tenga el enlace podrá ver los eventos de '+(byCategory?'esta categoría en «'+esc(current.name)+'»':'este calendario')+'.</p>' +
          '<button type="button" class="btn primary" data-apple-enable>Activar suscripción</button>';
        return;
      }
      const parts=[ctx.user.id,current.id];
      if(byCategory) parts.push('categories',categoryId ? 'c-'+categoryId : 'unassigned');
      parts.push(key+'.ics');
      const url = feedBase() + '/' + parts.map(encodeURIComponent).join('/');
      content.innerHTML = (hint || '<p>Los cambios que guardes en Work Hub aparecerán cuando Apple actualice la suscripción.</p>') +
        '<div class="japple-actions"><a class="btn primary" data-apple-subscribe rel="noreferrer" href="' + esc(url.replace(/^https:/,'webcal:')) + '">Abrir en Calendario de Apple</a>' +
        '<button class="btn" type="button" data-apple-copy>Copiar enlace</button></div>' +
        '<label class="japple-address" hidden>Enlace de suscripción<input type="text" readonly></label>' +
        '<button type="button" class="japple-revoke" data-apple-revoke>Desactivar enlace</button>';
      content.querySelector('input').value = url;
    }

    async function change(enable) {
      if (busy) return;
      let changed = false;
      busy = true; content.inert = true; setup.inert = true;
      content.setAttribute('aria-busy','true');
      // null identifica el calendario completo; '' es la categoría sin asignar.
      const scope = byCategory ? categoryId : null;
      try {
        if (enable) {
          announce('Comprobando el servicio…');
          await checkService(byCategory);
          if (!pending.has(scope)) pending.set(scope,freshToken());
        }
        announce('Guardando…');
        let saved, savedState;
        const ok = await ctx.mutate(draft => {
          const record = model.calendars(draft).find(item => item.id === calendar.id);
          if (!record || token(record) !== token(current)) throw new Error('El enlace cambió. Vuelve a abrir el calendario.');
          const key = enable ? pending.get(scope) : null;
          saved = byCategory ? model.setCategoryToken(draft,current.id,categoryId,key) : model.saveCalendar(draft,{id:current.id,appleToken:key});
          savedState=draft;
        });
        if (!ok) { announce('No se pudo confirmar el cambio. Vuelve a intentarlo.'); return; }
        current = saved; state = savedState; pending.delete(scope);
        draw(); announce(enable ? 'Enlace de suscripción activo.' : 'Enlace desactivado.');
        changed = true;
      } catch (error) { announce(error.message); }
      finally {
        busy = false; content.inert = false; setup.inert = false; content.removeAttribute('aria-busy');
        if (changed) content.querySelector('a,button')?.focus();
      }
    }

    select.addEventListener('change',()=>{
      if (busy) return;
      categoryId=select.value;
      announce(''); draw();
    });
    dialog.addEventListener('click',async event => {
      const target = event.target.closest('button');
      if (!target || busy) return;
      if (target.hasAttribute('data-apple-close')) { dialog.close(); return; }
      if (target.hasAttribute('data-apple-mode')) {
        byCategory=target.dataset.appleMode==='category';
        announce(''); draw(); return;
      }
      if (target.hasAttribute('data-apple-download')) {
        try {
          const cat=selectedCategory();
          const info=byCategory ? {...current,name:current.name+' · '+cat.name,color:cat.color} : current;
          const events=byCategory ? model.events(state).filter(e=>e.calendarId===current.id && (e.categoryId||'')===categoryId) : model.events(state);
          download(info,events,model.categories(state));
        } catch (error) { announce(error.message); }
      }
      if (target.hasAttribute('data-apple-copy-color')) {
        try { await navigator.clipboard.writeText(hue.textContent); announce('Color copiado.'); }
        catch { announce('Código del color: '+hue.textContent); }
      }
      if (target.hasAttribute('data-apple-enable')) await change(true);
      if (target.hasAttribute('data-apple-revoke')) {
        content.innerHTML = '<p>Apple dejará de recibir actualizaciones mediante este enlace. Podrás crear uno nuevo cuando quieras.</p>' +
          '<div class="japple-actions"><button type="button" class="btn" data-apple-keep>Conservar enlace</button>' +
          '<button class="btn" type="button" data-apple-confirm>Desactivar enlace</button></div>';
        announce(''); content.querySelector('button').focus();
      }
      if (target.hasAttribute('data-apple-keep')) { draw(); content.querySelector('[data-apple-revoke]').focus(); }
      if (target.hasAttribute('data-apple-confirm')) await change(false);
      if (target.hasAttribute('data-apple-copy')) {
        const input = content.querySelector('input');
        try { await navigator.clipboard.writeText(input.value); announce('Enlace copiado.'); }
        catch { input.parentElement.hidden = false; input.focus(); input.select(); announce('Copia el enlace seleccionado.'); }
      }
    });
    dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close',() => {
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
      else (document.querySelector('[data-wc-apple]') || document.querySelector('#main'))?.focus({preventScroll:true});
    },{once:true});
    draw(); document.body.append(dialog); dialog.showModal();
  }

  window.JAppleCalendar = Object.freeze({open});
})();
