/* Calendarios privados del usuario. Las horas son civiles de Lima y las fechas de día completo son inclusivas. */
(() => {
  'use strict';

  const defaults = [
    {id:'work', name:'Trabajo', color:'#287B74'},
    {id:'personal', name:'Personal', color:'#8153A2'}
  ];
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
    if (calendar.appleToken !== undefined) {
      requireValue(typeof calendar.appleToken === 'string' && /^[a-f0-9]{64}$/.test(calendar.appleToken), 'El enlace de suscripción del calendario no es válido.');
    }
  }

  function checkEvent(event, calendarIds) {
    requireValue(event && typeof event.id === 'string' && idPattern.test(event.id), 'El identificador del evento no es válido.');
    requireValue(calendarIds.has(event.calendarId), 'El calendario del evento ya no existe.');
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
    if (state.calendars === undefined && state.events === undefined) return state;
    const list = calendars(state);
    requireValue(list.length > 0, 'Conserva al menos un calendario.');
    const calendarIds = new Set(), names = new Set(), tokens = new Set();
    for (const calendar of list) {
      checkCalendar(calendar);
      const name = calendar.name.trim().normalize('NFC').toLocaleLowerCase('es-PE');
      requireValue(!calendarIds.has(calendar.id) && !names.has(name), 'Ya existe un calendario con ese nombre o identificador.');
      calendarIds.add(calendar.id); names.add(name);
      if (calendar.appleToken !== undefined) {
        requireValue(!tokens.has(calendar.appleToken), 'Cada calendario requiere su propio enlace de suscripción.');
        tokens.add(calendar.appleToken);
      }
    }
    const ids = new Set();
    for (const event of events(state)) {
      checkEvent(event, calendarIds);
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

  function removeCalendar(state, id) {
    const list = calendars(state);
    requireValue(list.some(calendar => calendar.id === id), 'El calendario ya no está disponible.');
    requireValue(list.length > 1, 'Conserva al menos un calendario.');
    requireValue(!events(state).some(event => event.calendarId === id), 'Mueve o elimina los eventos antes de eliminar este calendario.');
    state.calendars = list.filter(calendar => calendar.id !== id);
  }

  function saveEvent(state, input, now = new Date().toISOString()) {
    const list = events(state);
    const id = input.id || globalThis.JModel.id();
    const previous = list.find(item => item.id === id);
    const entry = {...previous, ...input};
    const event = {id, calendarId:entry.calendarId, title:String(entry.title ?? '').trim(), kind:entry.kind ?? 'event',
      allDay:entry.allDay ?? false, startDate:entry.startDate, endDate:entry.endDate ?? entry.startDate,
      startTime:entry.allDay ? '' : entry.startTime, endTime:entry.allDay ? '' : entry.endTime,
      location:String(entry.location ?? '').trim(), description:String(entry.description ?? '').trim()};
    if (previous && Object.entries(event).every(([key,value]) => previous[key] === value)) return previous;
    requireValue(input.expectedSequence === undefined || input.expectedSequence === previous?.sequence,
      'El evento cambió desde que lo abriste. Vuelve a abrirlo para revisar los cambios.');
    event.sequence = previous ? previous.sequence + 1 : 0;
    event.updatedAt = !previous && input.updatedAt ? input.updatedAt : now;
    checkEvent(event, new Set(calendars(state).map(calendar => calendar.id)));
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

  globalThis.JCalendarModel = Object.freeze({limits, calendars, events, validate, saveCalendar, removeCalendar, saveEvent, removeEvent, occursOn});
})();
