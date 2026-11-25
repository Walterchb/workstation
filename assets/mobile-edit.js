/* Permiso de edición local a la pestaña. El escritorio conserva la edición habitual. */
(() => {
  'use strict';
  const screen = window.matchMedia('(max-width:860px), (pointer:coarse) and (hover:none)');
  let enabled = false, confirmation = null, previousPermission;
  const canEdit = () => !screen.matches || enabled;
  const frozen = new Map();

  function thaw(dialog) {
    const draft = frozen.get(dialog);
    if (!draft) return;
    draft.guard.remove();
    dialog.removeAttribute('data-draft-frozen');
    for (const child of draft.children) child.inert = false;
    if (draft.label) dialog.setAttribute('aria-labelledby',draft.label);
    else dialog.removeAttribute('aria-labelledby');
    frozen.delete(dialog);
  }

  function freeze(dialog,refresh) {
    if (frozen.has(dialog)) return;
    const focus = dialog.contains(document.activeElement) ? document.activeElement : null;
    const children = [...dialog.children].filter(child=>!child.inert);
    for (const child of children) child.inert = true;
    const guard = document.createElement('section');
    guard.className = 'mobile-draft-guard';
    guard.innerHTML = '<h2 id="mobile-draft-title">Tu borrador está en pausa</h2>'+
      '<p>Activa la edición para continuar donde te quedaste o descarta los cambios de este formulario.</p>'+
      '<div><button type="button" class="btn ghost" data-drop-draft>Descartar borrador</button>'+
      '<button type="button" class="btn primary" data-resume-draft>Activar edición</button></div>';
    frozen.set(dialog,{guard,children,focus,label:dialog.getAttribute('aria-labelledby')});
    dialog.setAttribute('data-draft-frozen','');
    dialog.setAttribute('aria-labelledby','mobile-draft-title');
    dialog.append(guard);
    const resume = guard.querySelector('[data-resume-draft]');
    resume.onclick = () => requestEdit(refresh);
    guard.querySelector('[data-drop-draft]').onclick = () => dialog.close();
    dialog.addEventListener('close',()=>thaw(dialog),{once:true});
    resume.focus({preventScroll:true});
  }

  function sync(refresh) {
    const allowed = canEdit();
    const locked = !allowed;
    if (previousPermission !== allowed) {
      previousPermission = allowed;
      document.dispatchEvent(new Event('workhub:editmodechange'));
    }
    document.body.toggleAttribute('data-mobile-readonly',locked);
    const trigger = document.querySelector('[data-mobile-edit-toggle]');
    if (trigger) {
      trigger.hidden = !screen.matches;
      trigger.setAttribute('aria-pressed',String(enabled));
      const action = enabled ? 'Volver a modo lectura' : 'Activar edición';
      trigger.setAttribute('aria-label',action);
      trigger.title = action;
      const label = enabled ? 'Editando' : 'Lectura';
      if (trigger.lastElementChild?.textContent !== label) {
        trigger.innerHTML = window.JUI.icon(enabled?'pencil':'lock',15)+'<span>'+label+'</span>';
      }
    }
    if (locked) {
      for (const dialog of document.querySelectorAll('dialog[data-edit-dialog][open]')) freeze(dialog,refresh);
    } else {
      for (const dialog of frozen.keys()) {
        const focus = frozen.get(dialog).focus;
        thaw(dialog);
        if (focus?.isConnected && dialog.open) focus.focus({preventScroll:true});
      }
    }
  }

  function requestEdit(refresh) {
    if (!screen.matches || enabled || confirmation?.open) return;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'mobile-edit-dialog';
    dialog.setAttribute('aria-labelledby','mobile-edit-title');
    dialog.setAttribute('aria-describedby','mobile-edit-help');
    dialog.innerHTML = '<h2 id="mobile-edit-title">¿Activar la edición?</h2>'+
      '<p id="mobile-edit-help">Podrás modificar tus registros desde esta pestaña. Cuando termines, toca «Editando» para volver a lectura.</p>'+
      '<div><button class="btn ghost" type="button" data-cancel-edit>Seguir en lectura</button>'+
      '<button class="btn primary" type="button" data-confirm-edit>Activar edición</button></div>';
    confirmation = dialog;
    document.body.append(dialog);
    dialog.querySelector('[data-cancel-edit]').onclick = () => dialog.close();
    dialog.querySelector('[data-confirm-edit]').onclick = () => {
      if (confirmation !== dialog || !dialog.open || !screen.matches) return;
      enabled = true;
      dialog.close();
      refresh();
    };
    dialog.addEventListener('close',()=>{
      if (confirmation === dialog) confirmation = null;
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
    },{once:true});
    dialog.showModal();
    dialog.querySelector('[data-cancel-edit]').focus({preventScroll:true});
  }

  function reset() {
    enabled = false;
    if (confirmation?.open) confirmation.close();
    confirmation = null;
  }
  function connect(refresh) {
    const changed = () => {reset();refresh();};
    if (screen.addEventListener) screen.addEventListener('change',changed);
    else screen.addListener?.(changed);
    // El editor abierto se conserva al reducir el ancho, incluso si recibe Escape.
    document.addEventListener('keydown',event=>{
      if (event.key === 'Escape' && event.target.closest?.('[data-draft-frozen]')) {
        event.preventDefault();event.stopImmediatePropagation();
      }
    },true);
    document.addEventListener('cancel',event=>{
      if(event.target.hasAttribute?.('data-draft-frozen')) event.preventDefault();
    },true);
  }
  function toggle(refresh) {
    if (!screen.matches) return;
    if (!enabled) {requestEdit(refresh);return;}
    enabled = false;
    refresh();
  }
  window.JMobileEdit = Object.freeze({canEdit,connect,reset,sync,toggle});
})();
