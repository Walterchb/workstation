/* Suscripción por calendario y exportación puntual de sus eventos. */
(() => {
  'use strict';
  const {esc, icon} = window.JUI;
  const model = window.JCalendarModel;

  function download(calendar, state) {
    const text = window.JCalendarICS.serialize(calendar, model.events(state), model.categories(state));
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

  async function checkService(base) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(base + '/status', {signal:controller.signal, credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'});
      if (res.ok && (await res.text()).trim() === 'workhub-calendar/1') return;
    } catch { /* La guía también cubre las conexiones interrumpidas. */ }
    finally { clearTimeout(timeout); }
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
      '<section class="japple-live"><h3>Suscripción</h3><div data-apple-content></div><p class="japple-status" role="status" hidden></p></section>' +
      '<section class="japple-export"><div><h3>Descargar archivo .ics</h3><p>Importa una copia de los eventos actuales.</p></div>' +
      '<button class="btn" type="button" data-apple-download>' + icon('download',16) + 'Descargar</button></section>' +
      '<footer><a href="./docs/calendario-apple.html" target="_blank" rel="noopener noreferrer">Guía de activación</a></footer>';
    dialog.querySelector('.japple-calendar').textContent = calendar.name;
    const content = dialog.querySelector('[data-apple-content]'), status = dialog.querySelector('.japple-status');
    let current = calendar, busy = false, pendingToken = '';
    function announce(text) { status.textContent = text; status.hidden = !text; }
    function draw() {
      if (!current.appleToken) {
        content.innerHTML = '<p>Activa un enlace para que Apple consulte los próximos cambios de este calendario. Quien tenga el enlace podrá ver sus eventos.</p>' +
          '<button type="button" class="btn primary" data-apple-enable>Activar suscripción</button>';
        return;
      }
      const url = feedBase() + '/' + [ctx.user.id, current.id, current.appleToken + '.ics'].map(encodeURIComponent).join('/');
      content.innerHTML = '<p>Los cambios que guardes en Work Hub aparecerán cuando Apple actualice la suscripción.</p>' +
        '<div class="japple-actions"><a class="btn primary" data-apple-subscribe rel="noreferrer" href="' + esc(url.replace(/^https:/,'webcal:')) + '">Abrir en Calendario de Apple</a>' +
        '<button class="btn" type="button" data-apple-copy>Copiar enlace</button></div>' +
        '<label class="japple-address" hidden>Enlace de suscripción<input type="text" readonly></label>' +
        '<button type="button" class="japple-revoke" data-apple-revoke>Desactivar enlace</button>';
      content.querySelector('input').value = url;
    }
    async function change(enable) {
      if (busy) return;
      let changed = false;
      busy = true; content.inert = true;
      content.setAttribute('aria-busy','true');
      try {
        if (enable) {
          announce('Comprobando el servicio…');
          await checkService(feedBase());
          if (!pendingToken) pendingToken = freshToken();
        }
        announce('Guardando…');
        let saved;
        const ok = await ctx.mutate(state => {
          const record = model.calendars(state).find(item => item.id === calendar.id);
          if (!record || record.appleToken !== current.appleToken) throw new Error('El calendario cambió. Vuelve a abrirlo.');
          saved = model.saveCalendar(state,{id:record.id,appleToken:enable ? pendingToken : null});
        });
        if (!ok) { announce('No se pudo confirmar el cambio. Vuelve a intentarlo.'); return; }
        current = saved; pendingToken = '';
        draw(); announce(enable ? 'Enlace de suscripción activo.' : 'Enlace desactivado.');
        changed = true;
      } catch (error) { announce(error.message); }
      finally {
        busy = false; content.inert = false; content.removeAttribute('aria-busy');
        if (changed) content.querySelector('a,button')?.focus();
      }
    }
    dialog.addEventListener('click',async event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.hasAttribute('data-apple-close') && !busy) dialog.close();
      if (target.hasAttribute('data-apple-download')) {
        try { download(current, ctx.state); } catch (error) { announce(error.message); }
      }
      if (target.hasAttribute('data-apple-enable')) await change(true);
      if (target.hasAttribute('data-apple-revoke')) {
        content.innerHTML = '<p>Apple dejará de recibir actualizaciones mediante este enlace. Podrás crear uno nuevo cuando quieras.</p>' +
          '<div class="japple-actions"><button type="button" class="btn" data-apple-keep>Conservar enlace</button>' +
          '<button type="button" class="btn" data-apple-confirm>Desactivar enlace</button></div>';
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
