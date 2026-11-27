/* Estimación local de consultas. Solo conserva montos y metadatos de consumo. */
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
    const keyFor = user => prefix + encodeURIComponent(user) + ':';
    function record(user,id,usage,outcome = 'success') {
      if (!user || !id || !usage || usage.rounds === 0) return;
      const key = keyFor(user)+'q:'+encodeURIComponent(id);
      const previous = read(key);
      if (previous?.complete) return;
      const complete = usage.complete === true && isAmount(usage.costUsd);
      const known = complete ? usage.costUsd : Math.max(previous?.usd || 0, isAmount(usage.knownCostUsd) ? usage.knownCostUsd : 0);
      const model = typeof usage.model === 'string' ? usage.model.slice(0,120) : previous?.model || '';
      const row = {id, at:previous?.at || now(), usd:known, complete, ok:outcome === 'success', model};
      write(key,row);
    }
    function state(user) {
      if (!user) return summarize(null,[]);
      const base = keyFor(user);
      const entries = keys().filter(key => key?.startsWith(base+'q:')).map(read)
        .filter(entry => entry && typeof entry.id === 'string' && Number.isSafeInteger(entry.at) && isAmount(entry.usd));
      return summarize(read(base+'ref'),entries);
    }
    function setReference(user,usd,at = now()) {
      if (!user || !validRef({usd,at}) || at > now()) return false;
      write(keyFor(user)+'ref',{usd,at});
      return true;
    }
    return {record,state,setReference,transient:() => transient};
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {createTracker,summarize};
  if (!root?.document) return;
  const doc = root.document;
  let storage;
  try { storage = root.localStorage; } catch { /* El navegador puede limitar el almacenamiento. */ }
  const tracker = createTracker(storage);
  let owner = null, dialog = null;
  const localInput = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17a9 9 0 1 1 16 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4"/></svg>';

  function label(s) {
    if (!s.ref) return 'Saldo del chat';
    if (s.missing) return 'Revisar saldo';
    if (s.count === null) return 'Calculando…';
    return '≈ '+number(s.count)+' '+(s.count === 1 ? 'consulta' : 'consultas');
  }
  function header() {
    if (!owner) return '';
    return '<button type="button" class="jchat-budget-button" data-chat-budget-open aria-haspopup="dialog" title="Ver estimación de consultas y saldo">'+icon+
      '<span data-chat-budget-label>'+label(tracker.state(owner))+'</span></button>';
  }
  function stats(s) {
    const scope = dialog;
    if (!scope) return;
    const put = (key,value) => scope.querySelector('[data-budget-'+key+']').textContent = value;
    put('count',s.count === null ? s.ref ? s.missing ? 'Saldo por actualizar' : 'Calculando estimación' : 'Configura tu saldo' : label(s));
    put('help',!s.ref ? 'Ingresa el Credit balance que ves en OpenAI para estimar cuántas consultas puedes hacer.' :
      s.missing ? 'Hay consumo sin medir desde el último saldo. Actualiza la referencia con el monto que muestra OpenAI.' :
      s.sample < minimumSample && s.count !== 0 ? 'La estimación aparece al reunir '+minimumSample+' consultas completas del mismo modelo ('+s.sample+' de '+minimumSample+').' :
      'La cantidad puede variar según el contexto y la extensión de las respuestas.');
    put('balance',s.balance !== null ? money(s.balance) : 'Por confirmar');
    put('avg',s.average ? money(s.average,Math.min(8,Math.max(4,1-Math.floor(Math.log10(s.average))))) : 'Sin muestra');
    put('sample',s.sample ? number(s.sample)+' '+(s.sample === 1 ? 'consulta medida' : 'consultas medidas') : 'Sin consultas medidas');
    put('model',s.model || 'Por identificar');
    put('stamp',s.ref ? money(s.ref.usd)+' · '+timestamp(s.ref.at) : 'Sin registrar');
    put('location',tracker.transient() ? 'El almacenamiento está limitado. Parte del consumo se conserva solo mientras esta pestaña esté abierta.' : 'La estimación usa las consultas de esta cuenta en este navegador. Si recargas saldo o usas otros dispositivos o proyectos, actualiza la referencia.');
    const canEdit = root.JMobileEdit?.canEdit?.() !== false;
    scope.querySelector('[data-budget-edit]').hidden = !canEdit;
    scope.querySelector('[data-budget-locked]').hidden = canEdit;
    if (!canEdit) scope.querySelector('form').hidden = true;
  }
  function refresh() {
    const state = tracker.state(owner);
    doc.querySelectorAll('[data-chat-budget-label]').forEach(el => { el.textContent = label(state); });
    stats(state);
  }
  function open(trigger) {
    if (!owner || dialog?.open) return;
    const active = doc.createElement('dialog');
    active.className = 'jchat-budget-dialog';
    active.setAttribute('aria-labelledby','jchat-budget-title');
    active.innerHTML = '<header><h2 id="jchat-budget-title">Saldo del chat</h2><button type="button" class="jchat-budget-close" aria-label="Cerrar" autofocus>×</button></header>'+
      '<section class="jchat-budget-estimate"><strong data-budget-count></strong><p data-budget-help></p></section>'+
      '<dl><div><dt>Saldo estimado</dt><dd data-budget-balance></dd></div><div><dt>Costo medio por consulta</dt><dd data-budget-avg></dd></div>'+
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
      if (!tracker.setReference(owner,usd.valueAsNumber,when)) {
        at.setCustomValidity('Elige una fecha y hora válidas hasta este momento.'); at.reportValidity(); return;
      }
      closeForm(); refresh();
    };
    active.addEventListener('close',() => {
      if (dialog === active) dialog = null;
      active.remove();
      if (initialUser === owner && trigger.isConnected) trigger.focus({preventScroll:true});
    },{once:true});
    stats(tracker.state(owner));
    active.showModal();
  }
  doc.addEventListener('click',e => {
    const trigger = e.target.closest?.('[data-chat-budget-open]');
    if (trigger) open(trigger);
  });
  doc.addEventListener('workhub:editmodechange',refresh);
  root.addEventListener('storage',e => { if (owner && (!e.key || e.key.startsWith(prefix+encodeURIComponent(owner)+':'))) refresh(); });
  root.WorkStationChatBudget = Object.freeze({
    header,
    setUser(user) {
      if (owner === (user || null)) return;
      if (dialog?.open) dialog.close();
      owner = user || null;
      refresh();
    },
    record(user,id,usage,outcome) {
      tracker.record(user,id,usage,outcome);
      if (user && owner === user) refresh();
    },
    markUnknown(user,id) { this.record(user,id,{complete:false},'error'); }
  });
})(typeof window !== 'undefined' ? window : null);
