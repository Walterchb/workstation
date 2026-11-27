/* Calendarios privados del usuario. Las horas son civiles de Lima y las fechas de día completo son inclusivas. */
(() => {
  'use strict';

  const defaults = [
    {id:'work', name:'Trabajo', color:'#287B74'},
    {id:'personal', name:'Personal', color:'#8153A2'}
  ];
  const initialCategories = [
    {id:'gestion',name:'Gestión',color:'#2D7974'},
    {id:'analisis',name:'Análisis',color:'#4876AC'},
    {id:'coordinacion',name:'Coordinación',color:'#8566A7'},
    {id:'tramites',name:'Trámites',color:'#B16F3C'}
  ];
  // El separador ":" no se admite en los identificadores de calendarios y eventos guardados.
  const activityCalendar = Object.freeze({id:'source:activities', name:'Actividades', color:'#405D72'});
  const reminderOptions = Object.freeze([0,5,10,15,30,60,1440]);
  const limits = Object.freeze({name:80, title:180, location:240, description:6000});
  const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const plainText = value => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

  function requireValue(ok, message) {
    if (!ok) throw new Error(message);
  }

  function calendars(state) {
    if (state.calendars === undefined) return defaults.map(calendar => ({...calendar}));
    requireValue(Array.isArray(state.calendars), 'La lista de calendarios no es válida.');
    return state.calendars;
  }

  function events(state) {
    if (state.events === undefined) return [];
    requireValue(Array.isArray(state.events), 'La lista de eventos no es válida.');
    return state.events;
  }

  function categories(state) {
    if (state.eventCategories === undefined) return initialCategories.map(category => ({...category}));
    requireValue(Array.isArray(state.eventCategories), 'La lista de categorías de eventos no es válida.');
    return state.eventCategories;
  }

  function objectiveCategory(goal) {
    return {id:'goal:'+goal.id, name:goal.title, color:goal.color};
  }

  function calendarsForView(state, view) {
    const list = calendars(state);
    if (view !== 'month') return [...list, activityCalendar];
    const workhub = list.find(cal => cal.name.trim().toLowerCase() === 'workhub') ||
      list.find(cal => cal.name.replace(/\s+/g,'').toLowerCase() === 'workhub');
    return workhub ? [workhub] : [];
  }

  function activityItems(state, first, last) {
    const items = [];
    for (const task of state.tasks || []) {
      if ((first && task.date < first) || (last && task.date > last)) continue;
      const entry = {calendarId:activityCalendar.id, kind:task.kind === 'space' ? 'space' : 'activity',
        sourceTaskId:task.id, title:task.title, description:task.context, categoryId:task.goalId ? 'goal:'+task.goalId : '',
        startDate:task.date, endDate:task.date, allDay:false};
      for (const {start, end} of task.segments || []) {
        if (!start) continue;
        items.push({...entry, id:'task:'+task.id+':'+start, startTime:start, endTime:end || ''});
      }
    }
    return items;
  }

  function eventCategory(state, event) {
    if (event.calendarId === activityCalendar.id) {
      if (!event.categoryId) return null;
      const goal = (state.goals || []).find(item => 'goal:'+item.id === event.categoryId);
      return goal ? objectiveCategory(goal) : null;
    }
    return event.categoryId ? categories(state).find(category => category.id === event.categoryId) || null : null;
  }

  function eventColor(state, event) {
    if (event.calendarId === activityCalendar.id) {
      return eventCategory(state,event)?.color || (event.kind === 'space' ? '#94642C' : '#778A9A');
    }
    return eventCategory(state,event)?.color || '#687F8A';
  }

  function dateValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const day = new Date(value + 'T12:00:00Z');
    return Number.isFinite(day.valueOf()) && day.toISOString().slice(0,10) === value;
  }

  function stampValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const stamp = new Date(value);
    return Number.isFinite(stamp.valueOf()) && stamp.toISOString() === value;
  }

  function checkText(value, field, limit, required = false) {
    requireValue(plainText(value) && value.length <= limit && (!required || value.trim()),
      'Revisa «' + field + '». Admite hasta ' + limit + ' caracteres.');
  }

  function checkCalendar(calendar) {
    requireValue(calendar && typeof calendar.id === 'string' && idPattern.test(calendar.id), 'El identificador del calendario no es válido.');
    checkText(calendar.name, 'Nombre del calendario', limits.name, true);
    requireValue(typeof calendar.color === 'string' && /^#[\da-f]{6}$/i.test(calendar.color), 'Elige un color válido para el calendario.');
  }

  function checkFeedToken(token, used) {
    requireValue(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'El enlace de suscripción no es válido.');
    requireValue(!used.has(token), 'Cada suscripción requiere su propio enlace.');
    used.add(token);
  }

  function checkSubscriptions(calendar, categoryIds, used) {
    if (calendar.appleToken !== undefined) checkFeedToken(calendar.appleToken, used);
    const entries = calendar.appleCategoryTokens;
    if (entries === undefined) return;
    requireValue(entries && typeof entries === 'object' && !Array.isArray(entries),
      'Los enlaces de suscripción por categoría no son válidos.');
    for (const [key,token] of Object.entries(entries)) {
      requireValue(key.startsWith('c:') && (key === 'c:' || categoryIds.has(key.slice(2))),
        'La categoría del enlace de suscripción ya no existe.');
      checkFeedToken(token, used);
    }
  }

  function checkCategories(list) {
    const ids = new Set(), names = new Set();
    for (const category of list) {
      requireValue(category && typeof category.id === 'string' && idPattern.test(category.id), 'El identificador de la categoría no es válido.');
      checkText(category.name,'Nombre de la categoría',limits.name,true);
      requireValue(typeof category.color === 'string' && /^#[\da-f]{6}$/i.test(category.color), 'Elige un color válido para la categoría.');
      const name = category.name.trim().normalize('NFC').toLocaleLowerCase('es-PE');
      requireValue(!ids.has(category.id) && !names.has(name), 'Ya existe una categoría con ese nombre o identificador.');
      ids.add(category.id);
      names.add(name);
    }
    return ids;
  }

  function checkEvent(event, calendarIds, categoryIds) {
    requireValue(event && typeof event.id === 'string' && idPattern.test(event.id), 'El identificador del evento no es válido.');
    requireValue(calendarIds.has(event.calendarId), 'El calendario del evento ya no existe.');
    requireValue(event.categoryId === undefined || event.categoryId === '' || categoryIds.has(event.categoryId), 'La categoría del evento ya no existe.');
    requireValue(event.reminderMinutes == null || reminderOptions.includes(event.reminderMinutes), 'Elige un aviso válido para el evento.');
    checkText(event.title, 'Título', limits.title, true);
    checkText(event.location, 'Lugar', limits.location);
    checkText(event.description, 'Descripción', limits.description);
    requireValue(['event','meeting'].includes(event.kind), 'Elige un tipo válido de evento.');
    requireValue(typeof event.allDay === 'boolean', 'Revisa la opción de día completo.');
    requireValue(dateValid(event.startDate) && dateValid(event.endDate), 'Selecciona fechas válidas para el evento.');
    requireValue(event.startDate <= event.endDate, 'La fecha de fin debe ser igual o posterior a la inicial.');
    if (event.allDay) {
      requireValue(event.startTime === '' && event.endTime === '', 'Un evento de día completo se registra solo con fechas.');
    } else {
      requireValue(typeof event.startTime === 'string' && typeof event.endTime === 'string' &&
        clockPattern.test(event.startTime) && clockPattern.test(event.endTime), 'Selecciona horas válidas de inicio y fin.');
      requireValue(event.startDate !== event.endDate || event.startTime < event.endTime, 'El fin del evento debe ser posterior al inicio.');
    }
    requireValue(stampValid(event.updatedAt), 'La fecha de actualización del evento no es válida.');
    requireValue(Number.isInteger(event.sequence) && event.sequence >= 0 && event.sequence <= 2147483647, 'La versión del evento no es válida.');
  }

  function validate(state) {
    if (state.calendars === undefined && state.events === undefined && state.eventCategories === undefined) return state;
    const list = calendars(state);
    requireValue(list.length > 0, 'Conserva al menos un calendario.');
    const categoryIds = checkCategories(categories(state));
    const calendarIds = new Set(), names = new Set(), tokens = new Set();
    for (const calendar of list) {
      checkCalendar(calendar);
      checkSubscriptions(calendar,categoryIds,tokens);
      const name = calendar.name.trim().normalize('NFC').toLocaleLowerCase('es-PE');
      requireValue(!calendarIds.has(calendar.id) && !names.has(name), 'Ya existe un calendario con ese nombre o identificador.');
      calendarIds.add(calendar.id); names.add(name);
    }
    const ids = new Set();
    for (const event of events(state)) {
      checkEvent(event, calendarIds, categoryIds);
      requireValue(!ids.has(event.id), 'Hay un evento duplicado.');
      ids.add(event.id);
    }
    return state;
  }

  function saveCalendar(state, input) {
    const list = calendars(state);
    const id = input.id || globalThis.JModel.id();
    const previous = list.find(item => item.id === id);
    const calendar = {...previous, id, name:String(input.name ?? previous?.name ?? '').trim(), color:input.color ?? previous?.color};
    if (input.appleToken === null) delete calendar.appleToken;
    else if (input.appleToken !== undefined) calendar.appleToken = input.appleToken;
    const next = previous ? list.map(item => item.id === id ? calendar : item) : [...list, calendar];
    validate({...state, calendars:next});
    state.calendars = next;
    return calendar;
  }

  function getCategoryToken(calendar, categoryId) {
    const entries = calendar?.appleCategoryTokens;
    const key = 'c:' + categoryId;
    return entries && Object.hasOwn(entries,key) ? entries[key] : undefined;
  }

  function withCategoryToken(calendar, categoryId, token) {
    const entries = {...calendar.appleCategoryTokens};
    const key = 'c:' + categoryId;
    if (token === null) delete entries[key];
    else entries[key] = token;
    const updated = {...calendar};
    if (Object.keys(entries).length) updated.appleCategoryTokens = entries;
    else delete updated.appleCategoryTokens;
    return updated;
  }

  function setCategoryToken(state, calendarId, categoryId, token) {
    const list = calendars(state);
    const previous = list.find(calendar => calendar.id === calendarId);
    requireValue(previous, 'El calendario ya no está disponible.');
    const catalog = categories(state);
    requireValue(categoryId === '' || catalog.some(category => category.id === categoryId), 'La categoría ya no está disponible.');
    requireValue(token === null || typeof token === 'string', 'El enlace de suscripción no es válido.');
    const current = getCategoryToken(previous,categoryId);
    if (current === token || (token === null && current === undefined)) return previous;
    const updated = withCategoryToken(previous,categoryId,token);
    const changes = {calendars:list.map(calendar => calendar.id === calendarId ? updated : calendar)};
    // El servicio puede publicar una categoría aunque todavía no tenga eventos.
    if (state.eventCategories === undefined && token !== null) changes.eventCategories = catalog;
    validate({...state,...changes});
    Object.assign(state,changes);
    return updated;
  }

  function removeCalendar(state, id) {
    const list = calendars(state);
    requireValue(list.some(calendar => calendar.id === id), 'El calendario ya no está disponible.');
    requireValue(list.length > 1, 'Conserva al menos un calendario.');
    requireValue(!events(state).some(event => event.calendarId === id), 'Mueve o elimina los eventos antes de eliminar este calendario.');
    state.calendars = list.filter(calendar => calendar.id !== id);
  }

  function saveCategory(state, input, now = new Date().toISOString()) {
    const list = categories(state);
    const id = input.id || globalThis.JModel.id();
    const previous = list.find(item => item.id === id);
    const category = {id, name:String(input.name ?? previous?.name ?? '').trim(), color:input.color ?? previous?.color};
    const unchanged = previous && previous.name === category.name && previous.color === category.color;
    if (unchanged) return previous;
    const next = previous ? list.map(item => item.id === id ? category : item) : [...list,category];
    // Un renombre también cambia lo publicado bajo CATEGORIES en el archivo iCalendar.
    const linkedEvents = previous && previous.name !== category.name && events(state).some(event => event.categoryId === id);
    const updates = {eventCategories:next};
    if (linkedEvents) updates.events = events(state).map(event => event.categoryId === id ?
      {...event, updatedAt:now, sequence:event.sequence+1} : event);
    validate({...state,...updates});
    Object.assign(state,updates);
    return category;
  }

  function removeCategory(state, id) {
    const list = categories(state);
    requireValue(list.some(category => category.id === id), 'La categoría ya no está disponible.');
    requireValue(!events(state).some(event => event.categoryId === id), 'Cambia la categoría de sus eventos antes de eliminarla.');
    const changes = {eventCategories:list.filter(category => category.id !== id)};
    if (state.calendars?.some(calendar => getCategoryToken(calendar,id))) {
      changes.calendars = state.calendars.map(calendar => getCategoryToken(calendar,id) ? withCategoryToken(calendar,id,null) : calendar);
    }
    validate({...state,...changes});
    Object.assign(state,changes);
  }

  function saveEvent(state, input, now = new Date().toISOString()) {
    const list = events(state);
    const id = input.id || globalThis.JModel.id();
    const previous = list.find(item => item.id === id);
    const entry = {...previous, ...input};
    const event = {id, calendarId:entry.calendarId, title:String(entry.title ?? '').trim(), kind:entry.kind ?? 'event',
      allDay:entry.allDay ?? false, startDate:entry.startDate, endDate:entry.endDate ?? entry.startDate,
      startTime:entry.allDay ? '' : entry.startTime, endTime:entry.allDay ? '' : entry.endTime,
      location:String(entry.location ?? '').trim(), description:String(entry.description ?? '').trim(),
      categoryId:entry.categoryId ?? '', reminderMinutes:entry.reminderMinutes === undefined ? (previous ? null : 5) : entry.reminderMinutes};
    // Una fila antigua sin estos campos conserva la ausencia de categoría y de aviso.
    const prior = previous && {categoryId:'',reminderMinutes:null,...previous};
    if (prior && Object.entries(event).every(([key,value]) => prior[key] === value)) return previous;
    requireValue(input.expectedSequence === undefined || input.expectedSequence === previous?.sequence,
      'El evento cambió desde que lo abriste. Vuelve a abrirlo para revisar los cambios.');
    event.sequence = previous ? previous.sequence + 1 : 0;
    event.updatedAt = !previous && input.updatedAt ? input.updatedAt : now;
    const catalog = categories(state);
    checkEvent(event, new Set(calendars(state).map(calendar => calendar.id)), new Set(catalog.map(category => category.id)));
    if (event.categoryId && state.eventCategories === undefined) state.eventCategories = catalog;
    state.events = previous ? list.map(item => item.id === id ? event : item) : [...list,event];
    return event;
  }

  function removeEvent(state, id) {
    const list = events(state);
    requireValue(list.some(event => event.id === id), 'El evento ya no está disponible.');
    state.events = list.filter(event => event.id !== id);
  }

  function occursOn(event, day) {
    // Un evento que termina a medianoche ocupa el día anterior hasta su fin.
    if (day < event.startDate || day > event.endDate) return false;
    return event.allDay || day !== event.endDate || event.endTime !== '00:00';
  }

  globalThis.JCalendarModel = Object.freeze({limits, calendars, categories, events, eventCategory, eventColor, reminderOptions,
    activityCalendar, activityItems, objectiveCategory, calendarsForView,
    validate, saveCalendar, removeCalendar, getCategoryToken, setCategoryToken, saveCategory, removeCategory, saveEvent, removeEvent, occursOn});
})();
