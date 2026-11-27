/* La opción de consultar la vista actual usa los mismos identificadores de la interfaz. */
const validName = value => typeof value === 'string' && !!value.trim() && value.length <= 200 &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function parseViewSelection(raw) {
  if (raw === undefined) return undefined;
  const check = condition => { if (!condition) throw new Error('Filtro de vista inválido.'); };
  check(raw && typeof raw === 'object' && !Array.isArray(raw));
  const keys = {agenda:['status','goalId','taskKind'],goals:['status','goalId'],calendar:['mode','ids']};
  check(typeof raw.kind === 'string' && Object.hasOwn(keys,raw.kind));
  const allowed = ['kind',...keys[raw.kind]];
  check(Object.keys(raw).every(key => allowed.includes(key)));
  for (const key of ['status','goalId']) if (raw[key] !== undefined) check(validName(raw[key]));
  if (raw.taskKind !== undefined) check(['space','unassigned'].includes(raw.taskKind) && !raw.goalId);
  if (raw.kind === 'calendar' && (raw.mode !== undefined || raw.ids !== undefined)) {
    if (raw.mode === 'partial') check(raw.ids === undefined);
    else check(['include','exclude'].includes(raw.mode) && Array.isArray(raw.ids) && raw.ids.length <= 120 && raw.ids.every(validName));
  }
  return raw;
}

export function viewPredicate(selection, document) {
  if (!selection) return () => true;
  if (selection.kind === 'calendar') {
    const ids = new Set(selection.ids);
    return (item,kind) => kind === 'event' && (!selection.mode ||
      (selection.mode === 'include' && ids.has(item.calendarId)) ||
      (selection.mode === 'exclude' && !ids.has(item.calendarId)));
  }
  if (selection.kind === 'goals') {
    return (item,kind) => {
      if (kind === 'task') return !!selection.goalId && item.goalId === selection.goalId;
      return kind === 'goal' && (!selection.goalId || item.id === selection.goalId) && (!selection.status || item.status === selection.status);
    };
  }
  const knownGoals = selection.taskKind === 'unassigned' ? new Set((document.goals || []).map(goal => goal.id)) : null;
  return (item,kind) => {
    if (kind !== 'task' && kind !== 'space' || selection.status && item.status !== selection.status) return false;
    if (selection.taskKind === 'space') return kind === 'space';
    if (selection.taskKind === 'unassigned') return kind === 'task' && !knownGoals.has(item.goalId);
    return !selection.goalId || (kind === 'task' && item.goalId === selection.goalId);
  };
}
