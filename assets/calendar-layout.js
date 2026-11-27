/* La misma lista de filtros se despliega encima del horario en pantallas estrechas. */
(() => {
  'use strict';
  let owner, expanded = false, panelTop = 0;

  function bind(view,user) {
    if (owner !== user || view.dataset.wcView === 'month') {
      owner = user;
      expanded = false;
      panelTop = 0;
    }
    if (view.dataset.wcView === 'month') return;
    const panel = view.querySelector('.wc-right');
    panel.id = 'wc-calendar-filters';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn wc-filters-toggle';
    toggle.dataset.wcFiltersToggle = '';
    toggle.setAttribute('aria-controls',panel.id);
    toggle.innerHTML = window.JUI.icon('filter',15) + 'Filtros';
    const selected = panel.querySelector('[data-wc-category-filter]:checked');
    if (selected?.dataset.wcCategoryFilter) {
      const label = selected.closest('label');
      const name = label.querySelector('.wc-category-name').textContent;
      toggle.title = 'Filtros, categoría seleccionada: ' + name;
      toggle.setAttribute('aria-label',toggle.title);
      toggle.append(label.querySelector('.wc-category-dot').cloneNode(true));
    }
    view.querySelector('.wc-heading h1').after(toggle);

    function show(open) {
      expanded = open;
      view.toggleAttribute('data-wc-filters-open',open);
      toggle.setAttribute('aria-expanded',String(open));
      if(view.dataset.wcView==='week') window.JCalendarWeek?.fitHeader(view);
      if (open) panel.scrollTop = panelTop;
    }
    show(expanded);
    panel.addEventListener('scroll',() => { panelTop = panel.scrollTop; },{passive:true});
    toggle.addEventListener('click',() => show(!expanded));
    panel.addEventListener('keydown',event => {
      if (event.key !== 'Escape' || !expanded || !toggle.getClientRects().length) return;
      event.preventDefault();
      show(false);
      toggle.focus({preventScroll:true});
    });
  }
  window.JCalendarLayout = {bind};
})();
