/* Contexto de la pantalla desde la que se consulta el chat. */
(() => {
  'use strict';
  const names = {agenda:'Actividades', analysis:'Análisis', calendar:'Calendario', notes:'Notas', goals:'Objetivos', categories:'Categorías'};

  function read(view, date, stage, state) {
    if (!names[view] || !stage) return {};
    const result = {view:names[view]};
    const filters = [];
    const find = selector => stage.querySelector(selector);
    function addFilter(label, value) {
      if (value) filters.push((label + value).slice(0,140));
    }
    function addMode(mode) {
      if (mode) result.view += ' · ' + mode;
    }
    if (view === 'agenda') {
      const mode = window.JAgenda.getMode();
      addMode(({week:'Semana', list:'Lista', calendar:'Horario'})[mode]);
      const range = mode === 'week' ? window.JWeek.range(date) : {start:date,end:date};
      result.from = range.start;
      result.to = range.end;
      for (const [selector,label] of [['[data-jd-status-filter]','Estado: '],['[data-jd-goal-filter]','Objetivo: ']]) {
        const select = find(selector);
        if (select?.value) addFilter(label,select.selectedOptions[0]?.textContent);
      }
      const status = find('[data-jd-status-filter]')?.value;
      const goal = find('[data-jd-goal-filter]')?.value;
      result.selection = {kind:'agenda'};
      if (status) result.selection.status = status;
      if (goal === '__space__' || goal === '__none__') result.selection.taskKind = goal === '__space__' ? 'space' : 'unassigned';
      else if (goal) result.selection.goalId = goal.startsWith('~') ? goal.slice(1) : goal;
    } else if (view === 'analysis') {
      Object.assign(result, window.JInsights.chatPeriod(date));
      addMode(find('[data-period][aria-pressed="true"]')?.textContent);
    } else if (view === 'goals') {
      const objective = find('.ji-detail-head h1')?.textContent;
      const status = find('[data-scope][aria-pressed="true"]')?.dataset.scope;
      addFilter('Objetivo: ',objective);
      if (status && status !== 'Todos') addFilter('Estado: ',status);
      const goalId = objective && window.JInsights.chatGoal();
      result.selection = {kind:'goals', ...(goalId ? {goalId} : status && status !== 'Todos' ? {status} : {})};
    } else if (view === 'calendar') {
      const mode = find('[data-wc-mode][aria-pressed="true"]')?.dataset.wcMode || 'month';
      const month = mode === 'month';
      addMode(({day:'Día',week:'Semana',month:'Mes'})[mode]);
      if (mode === 'week') {
        const {start,end} = window.JCalendarWeek.range(date);
        result.from = start;
        result.to = end;
      } else if (month) {
        result.from = date.slice(0,7) + '-01';
        const lastDay = new Date(result.from + 'T12:00:00Z');
        lastDay.setUTCMonth(lastDay.getUTCMonth()+1,0);
        result.to = lastDay.toISOString().slice(0,10);
      } else {
        result.from = result.to = date;
      }
      const inputs = Array.from(stage.querySelectorAll('[data-wc-visible]'));
      const all = inputs.map(input => input.dataset.wcVisible);
      const visible = state ? window.JWorkCalendar.visibleCalendarIds(state,mode)
        : inputs.filter(input => input.checked).map(input => input.dataset.wcVisible);
      const activityId = window.JCalendarModel?.activityCalendar.id;
      const category = state && window.JWorkCalendar.selectedCategory?.(state);
      if (category) addFilter(category.kind === 'goal' ? 'Objetivo visible: ' : 'Categoría visible: ',category.name);
      const activities = category?.kind !== 'event' && !!activityId && visible.includes(activityId);
      const visibleEvents = category?.kind === 'goal' ? [] : visible.filter(id => id !== activityId);
      const hiddenEvents = all.filter(id => id !== activityId && !visibleEvents.includes(id));
      if (activities) addFilter('', 'Solo actividades y espacios con hora de inicio');
      if (activities && !visibleEvents.length) {
        result.selection = category?.kind === 'goal' ? {kind:'agenda',goalId:category.id.slice('goal:'.length)} : {kind:'agenda'};
      } else if (!activities || hiddenEvents.length) {
        result.selection = {kind:'calendar'};
        if (month || hiddenEvents.length || !visibleEvents.length) {
          const useVisible = month || visibleEvents.length <= hiddenEvents.length;
          const ids = useVisible ? visibleEvents : hiddenEvents;
          result.selection.mode = ids.length <= 120 ? (useVisible ? 'include' : 'exclude') : 'partial';
          if (result.selection.mode !== 'partial') result.selection.ids = ids;
          if (!visibleEvents.length) addFilter('', 'Ningún calendario visible');
          else {
            const subset = inputs.filter(input => ids.includes(input.dataset.wcVisible));
            const available = 8 - filters.length;
            const limit = subset.length > available ? available - 1 : available;
            for (const input of subset.slice(0,limit)) addFilter(useVisible ? 'Calendario visible: ' : 'Calendario oculto: ',input.closest('label')?.textContent.trim());
            if (subset.length > limit) filters.push('Hay ' + (subset.length-limit) + ' calendarios adicionales en la selección.');
          }
        }
      } else {
        addFilter('', 'Todos los calendarios de eventos visibles');
      }
    }
    if (filters.length) result.filters = filters;
    return result;
  }
  window.JChatView = {read};
})();
