/* El saldo confirmado pertenece a la cuenta. El navegador reintenta cambios aún sin confirmar. */
(function (root) {
  'use strict';

  const appPath = (root?.location?.pathname || '/').replace(/index\.html$/i,'').replace(/\/$/,'');
  const prefix = 'workstation:chat-budget:1:'+encodeURIComponent(appPath)+':';
  const minimumSample = 3;
  const sampleSize = 30;
  const isAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const money = (value, digits = 2) => new Intl.NumberFormat('es-PE', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(value);
  const number = value => new Intl.NumberFormat('es-PE').format(value);
  const timestamp = value => new Intl.DateTimeFormat('es-PE', {
    dateStyle:'short', timeStyle:'short'
  }).format(value);
  const validRef = ref => !!ref && isAmount(ref.usd) && Number.isSafeInteger(ref.at) && ref.at > 0;

  function summarize(ref, entries) {
    if (!validRef(ref)) ref = null;
    const sorted = [...entries].sort((a,b) => b.at - a.at || b.id.localeCompare(a.id));
    const model = sorted.find(entry => entry.model)?.model || '';
    const sample = sorted.filter(entry => entry.ok && entry.complete && entry.model === model && entry.usd > 0).slice(0,sampleSize);
    const average = sample.length ? sample.reduce((sum,row) => sum + row.usd, 0) / sample.length : null;
    const after = ref ? sorted.filter(entry => entry.at > ref.at) : sorted;
    const spent = after.reduce((sum,row) => sum + row.usd, 0);
    const missing = after.filter(entry => !entry.complete).length;
    const balance = ref && !missing ? Math.max(0, ref.usd - spent) : null;
    let count = balance === 0 ? 0 : null;
    if (balance > 0 && sample.length >= minimumSample) {
      const ratio = balance / average;
      if (Number.isFinite(ratio)) count = Math.floor(ratio + Math.min(.000001, ratio*Number.EPSILON*4));
    }
    return {ref, model, sample:sample.length, average, spent, missing, balance, count};
  }

  function createTracker(storage, now = Date.now) {
    const fallback = new Map();
    let transient = !storage;
    function keys() {
      const result = new Set(fallback.keys());
      if (storage) try {
        for (let i = 0; i < storage.length; i++) result.add(storage.key(i));
      } catch { transient = true; }
      return [...result];
    }
    function read(key) {
      if (fallback.has(key)) return fallback.get(key);
      try { return JSON.parse(storage?.getItem(key) || 'null'); }
      catch { return null; }
    }
    function write(key,value) {
      try {
        if (!storage) throw new Error();
        storage.setItem(key,JSON.stringify(value));
        fallback.delete(key);
      } catch { transient = true; fallback.set(key,value); }
    }
    function remove(key) {
      try {
        storage?.removeItem(key);
        fallback.delete(key);
      } catch {
        transient = true;
        fallback.set(key,null);
      }
    }
    const keyFor = user => prefix + encodeURIComponent(user) + ':';
    function record(user,id,usage,outcome = 'success') {
      if (!user || typeof id !== 'string' || !id.length || id.length > 200 || !usage || usage.rounds === 0) return false;
      const key = keyFor(user)+'q:'+encodeURIComponent(id);
      const previous = read(key);
      if (previous?.complete) return false;
      const complete = usage.complete === true && isAmount(usage.costUsd);
      const known = complete ? usage.costUsd : Math.max(previous?.usd || 0, isAmount(usage.knownCostUsd) ? usage.knownCostUsd : 0);
      const model = typeof usage.model === 'string' ? usage.model.slice(0,120) : previous?.model || '';
      const row = {id, at:previous?.at || now(), usd:known, complete, ok:outcome === 'success', model};
      write(key,row);
      return true;
    }
    function localRows(user) {
      const base = keyFor(user);
      const refs = [], entries = [];
      for (const key of keys()) {
        if (!key?.startsWith(base)) continue;
        const suffix = key.slice(base.length);
        const value = read(key);
        if (suffix === 'ref' || suffix.startsWith('r:')) {
          if (validRef(value)) refs.push({key, value, changedAt:value.changedAt || value.at});
        } else if (suffix.startsWith('q:') && value && typeof value.id === 'string' &&
          value.id.length > 0 && value.id.length <= 200 && key === base+'q:'+encodeURIComponent(value.id) &&
          Number.isSafeInteger(value.at) && value.at > 0 && isAmount(value.usd) &&
          typeof value.ok === 'boolean' && typeof value.complete === 'boolean' &&
          typeof value.model === 'string' && value.model.length <= 120) entries.push(value);
      }
      refs.sort((a,b) => b.changedAt-a.changedAt || b.value.at-a.value.at || b.value.usd-a.value.usd);
      return {refs,entries};
    }
    function state(user) {
      const {refs,entries} = localRows(user);
      return summarize(refs[0]?.value || null, entries);
    }
    function setReference(user,usd,at = now()) {
      const changedAt = now();
      if (!user || !validRef({usd,at}) || at > changedAt) return false;
      // Una entrada por modificación evita que la confirmación de otra pestaña borre una edición posterior.
      const id = changedAt.toString(36)+'-'+Math.random().toString(36).slice(2);
      write(keyFor(user)+'r:'+id,{usd,at,changedAt});
      return true;
    }
    function pending(user) {
      const {refs,entries} = localRows(user);
      const latest = refs[0];
      const reference = latest && {usd:latest.value.usd,at:latest.value.at,changedAt:latest.changedAt};
      return {payload:{...(reference ? {reference} : {}),entries:entries.slice(0,100)},refs};
    }
    function acknowledge(user,batch) {
      for (const row of batch.payload.entries) {
        const key = keyFor(user)+'q:'+encodeURIComponent(row.id);
        const current = read(key);
        if (current && current.complete === row.complete && current.usd === row.usd &&
            current.at === row.at && current.model === row.model && current.ok === row.ok) remove(key);
      }
      for (const {key,value} of batch.refs) {
        const current = read(key);
        if (current && current.at === value.at && current.usd === value.usd && current.changedAt === value.changedAt) remove(key);
      }
    }
    return {record,state,setReference,pending,acknowledge,transient:() => transient};
  }

  function createAccountBudget(queue, exchange, changed) {
    let active = null;
    const initial = summarize(null,[]);
    function current() {
      return {...(active?.snapshot || initial),sync:active?.status || 'loading',problem:active?.problem,inProgress:!!active?.attempts.size};
    }
    function sync() {
      const session = active;
      if (!session) return Promise.resolve();
      if (session.flight) return session.flight;
      let confirmed = false;
      session.flight = Promise.resolve().then(async () => {
        let batch = queue.pending(session.user);
        while (active === session) {
          if (batch.payload.reference || batch.payload.entries.length) {
            session.status = 'saving';
            changed();
          }
          const snapshot = await exchange(session.user,batch.payload);
          if (session !== active) return;
          if (!snapshot || !Object.hasOwn(snapshot,'balance') || !Object.hasOwn(snapshot,'ref') || !Object.hasOwn(snapshot,'count')) {
            throw new Error('Respuesta de saldo no válida');
          }
          queue.acknowledge(session.user,batch);
          session.snapshot = snapshot;
          batch = queue.pending(session.user);
          if (!batch.payload.reference && !batch.payload.entries.length) break;
        }
        confirmed = true;
        session.status = 'ready';
        session.problem = '';
      }).catch(error => {
        session.status = 'offline';
        session.problem = error?.code === 'CONFIG' ? 'setup' : 'connection';
      }).finally(() => {
        session.flight = null;
        if (active === session) {
          changed();
          if (confirmed) {
            const {payload} = queue.pending(session.user);
            if (payload.reference || payload.entries.length) return sync();
          }
        }
      });
      return session.flight;
    }
    function setUser(user) {
      if (user && active?.user === user) return active.flight;
      active = user ? {user,status:'loading',snapshot:null,flight:null,attempts:new Set()} : null;
      changed();
      return sync();
    }
    function storeReceipt(user,id,usage,outcome) {
      if (!queue.record(user,id,usage,outcome)) return;
      if (active?.user === user) {
        active.status = 'saving';
        changed();
        return sync();
      }
    }
    function beginAttempt(user,id) {
      if (active?.user === user) active.attempts.add(id);
      return storeReceipt(user,id,{complete:false},'error');
    }
    function record(user,id,usage,outcome) {
      if (active?.user === user) active.attempts.delete(id);
      return storeReceipt(user,id,usage,outcome);
    }
    function settleUnbilled(user,id) {
      return record(user,id,{complete:true,costUsd:0},'error');
    }
    function setReference(user,usd,at) {
      if (active?.user !== user || !queue.setReference(user,usd,at)) return false;
      active.status = 'saving';
      changed();
      sync();
      return true;
    }
    return {setUser,sync,state:current,beginAttempt,record,settleUnbilled,setReference};
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {createTracker,summarize,createAccountBudget};
  if (!root?.document) return;
  const doc = root.document;
  let storage;
  try { storage = root.localStorage; } catch { /* El navegador puede limitar el almacenamiento. */ }
  const tracker = createTracker(storage);
  const account = createAccountBudget(tracker,(user,batch) => root.JStore.syncChatBudget(user,batch),refresh);
  let owner = null, dialog = null, updateTimer = null;
  const localInput = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17a9 9 0 1 1 16 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4"/></svg>';

  function label(s) {
    if (s.sync === 'loading' || s.sync === 'saving') return 'Sincronizando…';
    if (s.sync === 'offline') return 'Saldo sin sincronizar';
    if (!s.ref) return 'Saldo del chat';
    if (s.missing) return s.inProgress ? 'Consulta en curso' : 'Revisar saldo';
    if (s.count === null) return 'Calculando…';
    return number(s.count)+' '+(s.count === 1 ? 'crédito' : 'créditos');
  }
  function ringState(s) {
    if (s.sync && s.sync !== 'ready') {
      return {level:'unknown',remaining:0,description:label(s)};
    }
    if (s.balance === null || !s.ref) {
      return {level:'unknown',remaining:0,description:s.ref ? s.inProgress ? 'Calculando el consumo de tu consulta' : 'Saldo por confirmar' : 'Configurar saldo de referencia'};
    }
    // Redondea sólo el ruido de coma flotante al comparar los umbrales.
    const remaining = s.ref.usd > 0 ? Number((Math.min(1,s.balance/s.ref.usd)*100).toFixed(10)) : 0;
    const level = remaining > 50 ? 'high' : remaining >= 15 ? 'medium' : 'low';
    const percent = new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(remaining);
    return {level,remaining,description:percent+' % del saldo de referencia disponible'};
  }
  function header(surface) {
    if (!owner) return '';
    const state = account.state();
    if (surface === 'widget') {
      const ring = ringState(state);
      const name = ring.description+'. Ver saldo y créditos estimados';
      return '<button type="button" class="jchat-budget-button" data-chat-budget-open data-chat-budget-ring '+
        'data-level="'+ring.level+'" data-empty="'+(ring.remaining===0 && ring.level==='low')+'" style="--remaining:'+ring.remaining+'%" '+
        'aria-haspopup="dialog" aria-label="'+name+'" title="'+name+'"><span class="jchat-budget-ring" aria-hidden="true"></span></button>';
    }
    return '<button type="button" class="jchat-budget-button" data-chat-budget-open aria-haspopup="dialog" title="Ver créditos estimados y saldo">'+icon+
      '<span data-chat-budget-label>'+label(state)+'</span></button>';
  }
  function stats(s) {
    const scope = dialog;
    if (!scope) return;
    const put = (key,value) => scope.querySelector('[data-budget-'+key+']').textContent = value;
    put('count',s.sync !== 'ready' ? label(s) : s.count === null ? s.ref ? s.missing ? label(s) : 'Calculando estimación' : 'Configura tu saldo' : label(s));
    put('help',s.sync === 'offline' ? (s.problem === 'setup' ? 'Instala el SQL de saldo del chat en Supabase para sincronizar esta cuenta.' : 'Se volverá a consultar el saldo de tu cuenta al recuperar la conexión.') :
      s.sync === 'loading' || s.sync === 'saving' ? 'Consultando el saldo de tu cuenta…' : !s.ref ? 'Ingresa el Credit balance que ves en OpenAI para calcular tus créditos disponibles.' :
      s.inProgress && s.missing ? 'El saldo se actualizará al terminar la consulta.' :
      s.missing ? 'Hay consumo sin medir desde el último saldo. Actualiza la referencia con el monto que muestra OpenAI.' :
      s.sample < minimumSample && s.count !== 0 ? 'La estimación aparece al reunir '+minimumSample+' consultas completas del mismo modelo ('+s.sample+' de '+minimumSample+').' :
      'Un crédito equivale al costo medio de una consulta. La cantidad estimada varía con el contexto y la extensión de las respuestas.');
    put('balance',s.balance !== null ? money(s.balance) : 'Por confirmar');
    put('remaining',ringState(s).description);
    put('avg',s.average ? money(s.average,Math.min(8,Math.max(4,1-Math.floor(Math.log10(s.average))))) : 'Sin muestra');
    put('sample',s.sample ? number(s.sample)+' '+(s.sample === 1 ? 'consulta medida' : 'consultas medidas') : 'Sin consultas medidas');
    put('model',s.model || 'Por identificar');
    put('stamp',s.ref ? money(s.ref.usd)+' · '+timestamp(s.ref.at) : 'Sin registrar');
    put('location',tracker.transient() && s.sync !== 'ready' ? 'Mantén esta pestaña abierta hasta que se sincronicen los cambios pendientes.' :
      s.sync === 'offline' ? 'Las cifras disponibles corresponden a la última sincronización. Los cambios pendientes se reintentarán con tu sesión.' :
      'Este saldo se comparte entre los dispositivos donde usas esta cuenta de Work Station. Actualiza la referencia tras una recarga o si consumes créditos fuera de Work Station.');
    const canEdit = root.JMobileEdit?.canEdit?.() !== false;
    scope.querySelector('[data-budget-edit]').hidden = !canEdit;
    scope.querySelector('[data-budget-locked]').hidden = canEdit;
    if (!canEdit) scope.querySelector('form').hidden = true;
  }
  function refresh() {
    const state = account.state();
    doc.querySelectorAll('[data-chat-budget-label]').forEach(el => { el.textContent = label(state); });
    const ring = ringState(state);
    doc.querySelectorAll('[data-chat-budget-ring]').forEach(button => {
      button.dataset.level = ring.level;
      button.dataset.empty = String(ring.level === 'low' && ring.remaining === 0);
      button.style.setProperty('--remaining',ring.remaining+'%');
      button.title = ring.description+'. Ver saldo y créditos estimados';
      button.setAttribute('aria-label',button.title);
    });
    stats(state);
  }
  function open(trigger) {
    if (!owner || dialog?.open) return;
    account.sync();
    const active = doc.createElement('dialog');
    active.className = 'jchat-budget-dialog';
    active.setAttribute('aria-labelledby','jchat-budget-title');
    active.innerHTML = '<header><h2 id="jchat-budget-title">Saldo del chat</h2><button type="button" class="jchat-budget-close" aria-label="Cerrar" autofocus>×</button></header>'+
      '<section class="jchat-budget-estimate"><strong data-budget-count></strong><p data-budget-help></p></section>'+
      '<dl><div><dt>Saldo estimado</dt><dd data-budget-balance></dd></div><div><dt>Porcentaje disponible</dt><dd data-budget-remaining></dd></div><div><dt>Costo medio por consulta</dt><dd data-budget-avg></dd></div>'+
      '<div><dt>Muestra reciente</dt><dd data-budget-sample></dd></div><div><dt>Último modelo</dt><dd data-budget-model></dd></div>'+
      '<div><dt>Saldo de referencia</dt><dd data-budget-stamp></dd></div></dl><p class="jchat-budget-location" data-budget-location></p>'+
      '<div class="jchat-budget-actions"><button type="button" class="btn" data-budget-edit>Actualizar saldo</button><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">Ver Billing de OpenAI ↗</a></div>'+
      '<p class="jchat-budget-location" data-budget-locked hidden>Activa la edición del móvil para actualizar el saldo.</p>'+
      '<form hidden><label>Saldo de OpenAI en USD<input name="usd" type="number" min="0" step="any" inputmode="decimal" required></label>'+
      '<label>Fecha y hora del saldo<input name="at" type="datetime-local" required></label>'+
      '<div class="jchat-budget-actions"><button type="submit" class="btn primary">Guardar saldo</button><button type="button" class="btn ghost" data-budget-cancel>Cancelar</button></div></form>';
    doc.body.append(active);
    dialog = active;
    const form = active.querySelector('form');
    const edit = active.querySelector('[data-budget-edit]');
    const at = form.elements.at, usd = form.elements.usd;
    const initialUser = owner;
    let defaultAt = '';
    active.querySelector('.jchat-budget-close').onclick = () => active.close();
    edit.onclick = () => {
      if (root.JMobileEdit?.canEdit?.() === false) return;
      defaultAt = localInput(new Date());
      at.value = defaultAt;
      at.max = defaultAt;
      at.setCustomValidity('');
      usd.value = '';
      form.hidden = false;
      edit.setAttribute('aria-expanded','true');
      usd.focus();
    };
    const closeForm = () => { form.hidden = true; edit.setAttribute('aria-expanded','false'); edit.focus(); };
    edit.setAttribute('aria-expanded','false');
    active.querySelector('[data-budget-cancel]').onclick = closeForm;
    at.oninput = () => at.setCustomValidity('');
    form.onsubmit = event => {
      event.preventDefault();
      if (initialUser !== owner || root.JMobileEdit?.canEdit?.() === false) return;
      const when = at.value === defaultAt ? Date.now() : new Date(at.value).getTime();
      if (!account.setReference(owner,usd.valueAsNumber,when)) {
        at.setCustomValidity('Elige una fecha y hora válidas hasta este momento.'); at.reportValidity(); return;
      }
      closeForm(); refresh();
    };
    active.addEventListener('close',() => {
      if (dialog === active) dialog = null;
      active.remove();
      if (initialUser === owner && trigger.isConnected) trigger.focus({preventScroll:true});
    },{once:true});
    stats(account.state());
    active.showModal();
  }
  doc.addEventListener('click',e => {
    const trigger = e.target.closest?.('[data-chat-budget-open]');
    if (trigger) open(trigger);
    else if (e.target.closest?.('[data-chat-launcher], [data-view="chat"], [data-chat-widget-expand]')) return refreshAccount();
  });
  doc.addEventListener('workhub:editmodechange',refresh);
  function refreshAccount() {
    if (owner && doc.visibilityState !== 'hidden') return account.sync();
  }
  root.addEventListener('storage',e => {
    if (owner && (!e.key || e.key.startsWith(prefix+encodeURIComponent(owner)+':'))) return refreshAccount();
  });
  root.addEventListener('focus',refreshAccount);
  root.addEventListener('online',refreshAccount);
  doc.addEventListener('visibilitychange',refreshAccount);
  root.WorkStationChatBudget = Object.freeze({
    header,
    setUser(user) {
      if (owner === (user || null)) return;
      if (dialog?.open) dialog.close();
      owner = user || null;
      if (updateTimer !== null) root.clearInterval(updateTimer);
      updateTimer = owner && root.setInterval ? root.setInterval(refreshAccount,60000) : null;
      return account.setUser(owner);
    },
    beginAttempt:account.beginAttempt,
    settleUnbilled:account.settleUnbilled,
    record:account.record,
    sync:refreshAccount,
    markUnknown(user,id) { return this.record(user,id,{complete:false},'error'); }
  });
})(typeof window !== 'undefined' ? window : null);
