/* Contexto de la pantalla desde la que se consulta el chat. */
(() => {
  'use strict';
  const names = {agenda:'Actividades', analysis:'Análisis', calendar:'Calendario', notes:'Notas', goals:'Objetivos', categories:'Categorías'};

  function read(view, date, stage) {
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
      const day = find('[data-wc-mode][aria-pressed="true"]')?.dataset.wcMode === 'day';
      addMode(day ? 'Día' : 'Mes');
      result.from = day ? date : date.slice(0,7) + '-01';
      const lastDay = new Date(result.from + 'T12:00:00Z');
      lastDay.setUTCMonth(lastDay.getUTCMonth()+1,0);
      result.to = day ? date : lastDay.toISOString().slice(0,10);
      const calendars = Array.from(stage.querySelectorAll('[data-wc-visible]'));
      const hidden = calendars.filter(input => !input.checked);
      result.selection = {kind:'calendar'};
      if (hidden.length) {
        const visible = calendars.filter(input => input.checked);
        const useVisible = visible.length <= hidden.length;
        const subset = useVisible ? visible : hidden;
        if (subset.length <= 120) {
          result.selection.mode = useVisible ? 'include' : 'exclude';
          result.selection.ids = subset.map(input => input.dataset.wcVisible);
        } else {
          // El servidor debe pedir un filtro más breve antes de presentar totales.
          result.selection.mode = 'partial';
        }
        if (!visible.length) addFilter('', 'Ningún calendario visible');
        else {
          const label = useVisible ? 'Calendario visible: ' : 'Calendario oculto: ';
          const limit = subset.length > 8 ? 7 : 8;
          for (const input of subset.slice(0,limit)) addFilter(label,input.closest('label')?.textContent.trim());
          if (subset.length > limit) filters.push('Hay ' + (subset.length-limit) + ' calendarios adicionales en la selección.');
        }
      }
    }
    if (filters.length) result.filters = filters;
    return result;
  }
  window.JChatView = {read};
})();
