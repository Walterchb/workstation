/* Coincidencias de títulos en el historial de actividades de la cuenta abierta. */
(() => {
  'use strict';
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim().replace(/\s+/g,' ');
  let nextListId = 0;

  function history(state) {
    const model = globalThis.JModel;
    const goals = new Map(state.goals.map(goal => [goal.id,goal.title]));
    const categories = new Set(model.categoryOptions(state).map(item => item.title));
    const fallback = model.defaultCategory(state);
    const unique = new Map();
    for (const task of state.tasks) {
      const title = (task.title || '').trim();
      if (!title || task.kind === 'space') continue;
      const search = normalize(title);
      const goalId = goals.has(task.goalId) ? task.goalId : '';
      const category = categories.has(task.category) ? task.category : fallback;
      const priority = model.priorities.includes(task.priority) ? task.priority : 'Media';
      const origin = model.origins.includes(task.origin) ? task.origin : 'Planificada';
      const key = JSON.stringify([search,goalId,category,priority,origin]);
      if (unique.has(key) && unique.get(key).date > task.date) continue;
      unique.set(key,{search,date:task.date,goal:goals.get(goalId) || 'Sin objetivo',
        details:{title,goalId,category,priority,origin}});
    }
    return Array.from(unique.values()).sort((a,b) => b.date.localeCompare(a.date));
  }

  function matches(items, value) {
    const query = normalize(value);
    if (!query) return [];
    const words = query.split(' ');
    const prefix = [], other = [];
    for (const item of items) {
      if (item.search.startsWith(query)) {
        prefix.push(item);
        if (prefix.length === 8) break;
      } else if (other.length < 8 && words.every(word => item.search.includes(word))) other.push(item);
    }
    return prefix.concat(other).slice(0,8);
  }

  function bind(dialog, state, eligible, apply) {
    let items, input = null, found = [], active = -1;
    const list = document.createElement('div');
    list.id = 'activity-suggestions-' + (++nextListId);
    list.className = 'activity-suggestions';
    list.setAttribute('role','listbox');
    list.setAttribute('aria-label','Actividades registradas');
    list.hidden = true;
    dialog.appendChild(list);

    function close() {
      if (input) {
        input.setAttribute('aria-expanded','false');
        input.removeAttribute('aria-activedescendant');
      }
      input = null;
      active = -1;
      list.hidden = true;
    }

    function position() {
      if (!input || list.hidden) return;
      if (!input.isConnected) { close(); return; }
      const rect = input.getBoundingClientRect(), box = dialog.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = Math.max(box.top,viewport?.offsetTop || 0) + 5;
      const bottom = Math.min(box.bottom,viewport ? viewport.height + viewport.offsetTop : window.innerHeight) - 5;
      if (rect.bottom <= top || rect.top >= bottom) { close(); return; }
      const below = bottom - rect.bottom - 4;
      const above = rect.top - top - 4;
      const upwards = below < Math.min(list.scrollHeight,190) && above > below;
      const width = Math.min(Math.max(rect.width,310),box.width - 12);
      list.style.width = width + 'px';
      list.style.left = Math.min(Math.max(rect.left,box.left + 6),box.right - width - 6) + 'px';
      list.style.maxHeight = Math.max(0,Math.min(275,upwards ? above : below)) + 'px';
      list.style.top = (upwards ? rect.top - 4 - list.offsetHeight : rect.bottom + 4) + 'px';
    }

    function prepare(field) {
      field.setAttribute('role','combobox');
      field.setAttribute('aria-autocomplete','list');
      field.setAttribute('aria-controls',list.id);
      field.setAttribute('aria-expanded','false');
    }

    function update(field) {
      close();
      if (!eligible(field) || !field.value.trim()) return;
      items ??= history(state);
      found = matches(items,field.value);
      if (!found.length) return;
      input = field;
      prepare(field);
      list.replaceChildren(...found.map((item,index) => {
        const option = document.createElement('div');
        option.id = list.id + '-' + index;
        option.dataset.indexOption = String(index);
        option.setAttribute('role','option');
        option.setAttribute('aria-selected','false');
        const name = document.createElement('strong'), details = document.createElement('small');
        name.textContent = item.details.title;
        details.textContent = [item.goal,item.details.category,'Prioridad ' + item.details.priority.toLocaleLowerCase('es'),item.details.origin].join(' · ');
        option.append(name,details);
        return option;
      }));
      list.scrollTop = 0;
      list.hidden = false;
      input.setAttribute('aria-expanded','true');
      position();
    }

    function choose(index) {
      const field = input, item = found[index];
      close();
      if (field && item && eligible(field)) apply(field,item.details);
    }

    dialog.addEventListener('focusin', event => { if (eligible(event.target)) prepare(event.target); });
    dialog.addEventListener('focusout', event => { if (input === event.target) close(); });
    dialog.addEventListener('input', event => { if (!event.isComposing) update(event.target); });
    dialog.addEventListener('compositionend', event => update(event.target));
    dialog.addEventListener('pointerdown', event => {
      if (input && event.target !== input && !list.contains(event.target)) close();
    });
    // Conservar el foco del campo hasta el clic, también al tocar una opción en el móvil.
    list.addEventListener('mousedown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) choose(Number(option.dataset.indexOption));
    });
    dialog.addEventListener('keydown', event => {
      if (event.target !== input || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'Escape') close();
      else if (event.key === 'Enter' && active >= 0) choose(active);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const previous = list.children[active];
        if (previous) previous.setAttribute('aria-selected','false');
        active = event.key === 'ArrowDown' ? Math.min(active+1,found.length-1) : (active < 0 ? found.length-1 : Math.max(0,active-1));
        const option = list.children[active];
        option.setAttribute('aria-selected','true');
        input.setAttribute('aria-activedescendant',option.id);
        option.scrollIntoView({block:'nearest'});
      } else { if (event.key === 'Tab' || event.key === 'Enter') close(); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
    },true);
    dialog.addEventListener('scroll',event => { if (event.target !== list) position(); },true);
    window.addEventListener('resize',position);
    window.visualViewport?.addEventListener('resize',position);
    window.visualViewport?.addEventListener('scroll',position);
    dialog.addEventListener('close',() => {
      window.removeEventListener('resize',position);
      window.visualViewport?.removeEventListener('resize',position);
      window.visualViewport?.removeEventListener('scroll',position);
    },{once:true});
    return {close};
  }

  globalThis.JActivitySuggest = {history,matches,bind};
})();
