/* Catálogo personal de categorías. Las tareas históricas conservan su clasificación al archivar. */
(() => {
  'use strict';
  const M = window.JModel;
  const esc = window.JUI.esc;
  const swatches = [['#087F79','Verde petróleo'],['#3067B6','Azul'],['#8759A4','Violeta'],['#B16B32','Ámbar'],['#A34E68','Frambuesa'],['#52794A','Verde oliva']];
  let showArchived = false;

  function usageFor(state) {
    const result = new Map();
    for (const task of state.tasks) {
      if (task.kind === 'space') continue;
      const total = result.get(task.category) || {count:0,minutes:0};
      total.count++;
      total.minutes += M.minutes(task);
      result.set(task.category, total);
    }
    return result;
  }

  function openDialog(el, ctx, item, action) {
    if (ctx.canEdit?.() === false) return;
    const editing = action === 'edit';
    const archive = action === 'archive';
    const list = M.categoryList(ctx.state);
    const alternatives = list.filter(category => !category.archived && category.id !== item?.id);
    const count = ctx.state.tasks.filter(row => row.kind !== 'space' && row.category === item?.title).length;
    const assigned = count === 1 ? '1 actividad asociada' : count + ' actividades asociadas';
    const title = editing ? (item ? 'Editar categoría' : 'Nueva categoría') : archive ? 'Archivar categoría' : 'Reactivar categoría';
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-edit-dialog','');
    dialog.className = 'jcat-dialog';
    dialog.setAttribute('aria-labelledby','jcat-dialog-title');
    const initialColor = item?.color || swatches[list.length % swatches.length][0];
    const color = /^#[a-f\d]{6}$/i.test(initialColor) ? initialColor : '#087F79';
    const controls = editing ? `
      <label class="jcat-field">Nombre<input name="title" required maxlength="100" autocomplete="off" placeholder="Ej. Financiamiento" value="${esc(item?.title || '')}"></label>
      <fieldset class="jcat-colors"><legend>Color</legend><div>${swatches.map(([value,name])=>`<button type="button" class="jcat-swatch" data-swatch="${value}" style="--swatch:${value}" aria-pressed="${color.toLowerCase() === value.toLowerCase()}" aria-label="${name}" title="${name}"></button>`).join('')}<label class="jcat-custom">Personalizar<input name="color" type="color" value="${color}" aria-label="Color personalizado"></label></div></fieldset>
      ${item?.archived ? '' : `<label class="jcat-choice"><input type="checkbox" name="preferred" ${item?.isDefault ? 'checked disabled' : ''}><span>Usar como predeterminada<small>Las actividades nuevas empezarán con esta categoría.</small></span></label>`}
      ${item && count ? `<p class="jcat-note">Al cambiar el nombre se actualizarán ${count === 1 ? 'la actividad asociada y sus informes' : 'las ' + count + ' actividades asociadas y sus informes'}.</p>` : ''}` :
      `<p class="jcat-explain"><b>${esc(item.title)}</b> · ${assigned}.</p>
      <p class="jcat-note" data-archive-note>${archive ? 'Las actividades ya registradas conservarán su categoría. Podrás reactivarla cuando la necesites.' : 'La categoría volverá a estar disponible al crear y editar actividades.'}</p>
      ${archive && count ? '<label class="jcat-choice"><input type="checkbox" name="reassign"><span>Reasignar las actividades existentes</span></label>' : ''}
      ${archive ? `<label class="jcat-field" data-destination ${item.isDefault ? '' : 'hidden'}><span>${item.isDefault ? 'Nueva categoría predeterminada' : 'Categoría de destino'}</span><select name="destination"><option value="">Selecciona una categoría</option>${alternatives.map(category=>`<option value="${esc(category.id)}">${esc(category.title)}</option>`).join('')}</select></label>` : ''}`;
    dialog.innerHTML = `<form novalidate><header><h2 id="jcat-dialog-title">${title}</h2><button class="icon-btn" type="button" data-close aria-label="Cerrar">${ctx.icon('x',18)}</button></header><div class="jcat-body">${controls}<p class="jcat-error" role="alert" hidden></p></div><footer><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary">${editing ? 'Guardar categoría' : archive ? 'Archivar' : 'Reactivar'}</button></footer></form>`;
    const form = dialog.querySelector('form');
    const err = dialog.querySelector('.jcat-error');
    let busy = false;
    const dismiss = () => { if (!busy) dialog.close(); };
    dialog.querySelectorAll('[data-close]').forEach(node => node.onclick = dismiss);
    dialog.oncancel = event => { if (busy) event.preventDefault(); };
    dialog.addEventListener('close', () => {
      dialog.remove();
      const back = Array.from(el.querySelectorAll('[data-cat-item]')).find(button => button.dataset.catItem === item?.id);
      (back || el.querySelector('[data-cat-new]'))?.focus({preventScroll:true});
    }, {once:true});
    function colorSelection() {
      for (const button of dialog.querySelectorAll('[data-swatch]')) {
        button.setAttribute('aria-pressed', String(button.dataset.swatch.toLowerCase() === form.elements.color.value.toLowerCase()));
      }
    }
    if (editing) {
      for (const button of dialog.querySelectorAll('[data-swatch]')) {
        button.onclick = () => { form.elements.color.value = button.dataset.swatch; colorSelection(); };
      }
      form.elements.color.oninput = colorSelection;
    }
    if (form.elements.reassign) {
      const updateReassignment = () => {
        const move = form.elements.reassign.checked;
        dialog.querySelector('[data-destination]').hidden = !item.isDefault && !move;
        const target = alternatives.find(category => category.id === form.elements.destination.value);
        const object = count === 1 ? 'La actividad asociada se moverá' : 'Las ' + count + ' actividades asociadas se moverán';
        dialog.querySelector('[data-archive-note]').textContent = move
          ? object + (target ? ' a «' + target.title + '».' : ' a la categoría que elijas.') + ' Se conservarán sus horas y comentarios.'
          : 'Las actividades ya registradas conservarán su categoría. Podrás reactivarla cuando la necesites.';
        form.querySelector('[type=submit]').textContent = move ? 'Archivar y reasignar' : 'Archivar';
      };
      form.elements.reassign.onchange = form.elements.destination.onchange = updateReassignment;
    }
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      err.hidden = true;
      if (editing && !form.elements.title.value.trim()) {
        err.textContent = 'Escribe el nombre de la categoría.'; err.hidden = false; form.elements.title.focus(); return;
      }
      const values = editing ? { title:form.elements.title.value, color:form.elements.color.value,
        isDefault:form.elements.preferred?.checked || false } : null;
      const destination = form.elements.destination?.value || '';
      const reassign = !!form.elements.reassign?.checked;
      if (archive && (item.isDefault || reassign) && !destination) {
        err.textContent = 'Selecciona una categoría activa de destino.'; err.hidden = false; form.elements.destination.focus(); return;
      }
      const apply = state => {
        if (item) {
          const current = M.categoryList(state).find(category => category.id === item.id);
          if (!current || ['title','color','archived','isDefault'].some(key => current[key] !== item[key])) {
            throw new Error('Esta categoría cambió. Vuelve a abrirla para revisar sus datos.');
          }
        }
        if (editing) M.saveCategory(state,item?.id,values);
        else M.setCategoryArchived(state,item.id,archive,destination,reassign);
      };
      try {
        apply({...ctx.state});
        busy = true; form.inert = true; form.setAttribute('aria-busy','true');
        if (await ctx.mutate(apply)) {
          if (editing && !item && showArchived) { showArchived = false; ctx.render(); }
          dialog.close(); ctx.toast(editing ? 'Categoría guardada.' : archive ? 'Categoría archivada.' : 'Categoría reactivada.');
        } else {
          err.textContent = 'Tus cambios siguen en el formulario. Comprueba el aviso de guardado.'; err.hidden = false;
        }
      } catch (error) {
        err.textContent = error.message || 'No se pudo guardar la categoría.'; err.hidden = false;
      } finally { busy = false; form.inert = false; form.removeAttribute('aria-busy'); }
    };
    document.body.append(dialog); dialog.showModal();
    (editing ? form.elements.title : dialog.querySelector('[data-close]'))?.focus();
  }

  function render(el, ctx) {
    const list = M.categoryList(ctx.state);
    const usage = usageFor(ctx.state);
    const actionVisibility = ctx.canEdit?.() === false ? ' hidden' : '';
    const active = list.filter(c => !c.archived);
    const archived = list.filter(c => c.archived);
    const rows = showArchived ? archived : active;
    const buttons = rows.map(category => {
      const {count,minutes} = usage.get(category.title) || {count:0,minutes:0};
      const color = /^#[a-f\d]{6}$/i.test(category.color) ? category.color : '#526A76';
      const sole = !category.archived && active.length === 1;
      return `<tr><th scope="row"><span class="jcat-name"><i style="--swatch:${color}"></i><span>${esc(category.title)}${category.isDefault ? '<small>Predeterminada</small>' : ''}</span></span></th><td data-label="Actividades">${count}</td><td data-label="Tiempo acumulado">${esc(M.duration(minutes))}</td><td${actionVisibility}><div class="jcat-actions"><button type="button" class="jcat-edit" data-cat-item="${esc(category.id)}" data-action="edit" aria-label="Editar ${esc(category.title)}">${ctx.icon('pencil',14)}Editar</button><button type="button" class="jcat-text" aria-label="${category.archived ? 'Reactivar' : 'Archivar'} ${esc(category.title)}" data-cat-item="${esc(category.id)}" data-action="${category.archived ? 'restore' : 'archive'}" ${sole ? 'disabled title="Añade otra categoría activa antes de archivar la última."' : ''}>${category.archived ? 'Reactivar' : 'Archivar'}</button></div></td></tr>`;
    }).join('');
    el.innerHTML = `<section class="jcat-view"><header class="jcat-head"><div><h1>Categorías</h1><p>Clasifica tus actividades por tipo de trabajo para comparar el tiempo que dedicas a cada uno.</p></div><button class="btn primary" type="button" data-cat-new${actionVisibility}>${ctx.icon('plus',17)} Nueva categoría</button></header><section class="jcat-panel panel"><div class="jcat-tools"><div class="jcat-tabs" role="group" aria-label="Estado de las categorías"><button type="button" data-cat-filter="active" aria-pressed="${!showArchived}">Activas <span>${active.length}</span></button><button type="button" data-cat-filter="archived" aria-pressed="${showArchived}">Archivadas <span>${archived.length}</span></button></div></div>${rows.length ? `<div class="jcat-scroll"><table><thead><tr><th>Categoría</th><th>Actividades</th><th>Tiempo acumulado</th><th${actionVisibility}><span class="jcat-sr">Acciones</span></th></tr></thead><tbody>${buttons}</tbody></table></div>` : '<p class="jcat-empty">Todavía no tienes categorías archivadas.</p>'}</section></section>`;
    el.onclick = event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.hasAttribute('data-cat-new')) openDialog(el,ctx,null,'edit');
      else if (button.dataset.catFilter) {
        showArchived = button.dataset.catFilter === 'archived';
        ctx.render(); el.querySelector('[data-cat-filter][aria-pressed=true]')?.focus({preventScroll:true});
      } else if (button.dataset.catItem) {
        const item = list.find(category => category.id === button.dataset.catItem);
        if (item) openDialog(el,ctx,item,button.dataset.action);
      }
    };
  }

  window.JCategories = {render};
})();
