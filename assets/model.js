/* Calendario y registro de trabajo. Las horas de la agenda son horas civiles de Lima. */
(() => {
  'use strict';

  const timeZone = 'America/Lima';
  const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const clock = new Intl.DateTimeFormat('es-PE', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const categories = ['Control de gestión', 'Mercado de capitales', 'Coordinación', 'Otros'];
  const categoryColors = ['#087F79', '#3067B6', '#8759A4', '#B16B32'];
  const categoryIds = ['gestion', 'mercados', 'coordinacion', 'otros'];
  const profileLimits = Object.freeze({name:80, side:256, bytes:65536});
  const noteLanes = Object.freeze({inbox:'Entrada', followup:'Por revisar', waiting:'En espera', resolved:'Resueltas'});
  const noteLimits = Object.freeze({title:160, body:5000, topic:80});
  const priorities = ['Alta', 'Media', 'Baja'];
  const origins = ['Planificada', 'Imprevista'];
  const statuses = ['Pendiente', 'En proceso', 'Culminado'];
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  function id() {
    if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function today(moment = new Date()) {
    const parts = Object.fromEntries(calendar.formatToParts(moment).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function timeNow(moment = new Date()) {
    return clock.format(moment);
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function shiftDate(value, days) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function formatDate(value, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
    return new Intl.DateTimeFormat('es-PE', { ...options, timeZone: 'UTC' })
      .format(new Date(`${value}T12:00:00Z`));
  }

  function minuteOfDay(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  function minutes(activity) {
    return activity.segments.reduce((total, { start, end }) => (
      end ? total + minuteOfDay(end) - minuteOfDay(start) : total
    ), 0);
  }

  function duration(value) {
    const total = Math.max(0, Math.floor(value));
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    if (!hours) return `${remainder} min`;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  function empty() {
    return { version: 1, goals: [], tasks: [] };
  }

  function categoryList(state) {
    if (state?.categories !== undefined) {
      requireValue(Array.isArray(state.categories), 'El catálogo de categorías no es válido.');
      return state.categories.map(category => ({ ...category }));
    }
    // Las agendas anteriores a la gestión del catálogo guardan sólo el nombre en cada actividad.
    return categories.map((title, index) => ({
      id: categoryIds[index], title, color: categoryColors[index], archived: false, isDefault: index === 0
    }));
  }

  function categoryOptions(state, current = '') {
    return categoryList(state).filter(category => !category.archived || category.title === current);
  }

  function defaultCategory(state) {
    const category = categoryList(state).find(item => item.isDefault && !item.archived);
    requireValue(category, 'Selecciona una categoría activa como predeterminada.');
    return category.title;
  }

  function categoryForNewTask(state, requested) {
    return categoryOptions(state).some(category => category.title === requested) ? requested : defaultCategory(state);
  }

  function validateCategories(list) {
    const ids = new Set(), names = new Set();
    for (const category of list) {
      validateIdentity(category, ids, 'categoría');
      requireValue(hasText(category.title), 'Escribe un nombre para la categoría.');
      const key = category.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
      requireValue(!names.has(key), 'Ya existe una categoría con ese nombre. Elige otro nombre.');
      names.add(key);
      requireValue(typeof category.color === 'string' && /^#[a-fA-F\d]{6}$/.test(category.color), 'Selecciona un color válido para la categoría.');
      requireValue(typeof category.isDefault === 'boolean' && typeof category.archived === 'boolean', 'Revisa el estado de la categoría.');
      requireValue(!(category.isDefault && category.archived), 'La categoría predeterminada debe estar activa.');
    }
    requireValue(list.filter(item => item.isDefault).length === 1, 'Elige una categoría activa como predeterminada.');
  }

  function saveCategory(state, categoryId, changes) {
    const list = categoryList(state);
    const item = categoryId ? list.find(category => category.id === categoryId) : {id:id(),archived:false,isDefault:false};
    requireValue(item, 'La categoría que intentas editar ya no está disponible.');
    const previous = item.title;
    item.title = String(changes.title ?? '').trim().replace(/\s+/g, ' ');
    item.color = changes.color;
    if (!categoryId) list.push(item);
    if (changes.isDefault && !item.archived) {
      for (const category of list) category.isDefault = category.id === item.id;
    }
    validateCategories(list);
    if (categoryId && item.title !== previous) {
      state.tasks = state.tasks.map(row => row.category === previous ? {...row, category:item.title} : row);
    }
    state.categories = list;
    return item.id;
  }

  function setCategoryArchived(state, categoryId, archive, replacementId = '', reassign = false) {
    const list = categoryList(state);
    const item = list.find(category => category.id === categoryId);
    requireValue(item, 'La categoría ya no está disponible.');
    requireValue(typeof archive === 'boolean' && archive !== item.archived, 'La categoría ya cambió de estado.');
    const replacement = list.find(category => category.id === replacementId && !category.archived && category.id !== categoryId);
    if (archive && (item.isDefault || reassign)) requireValue(replacement, 'Elige una categoría activa de destino.');
    if (archive && item.isDefault) {
      item.isDefault = false;
      replacement.isDefault = true;
    }
    item.archived = archive;
    validateCategories(list);
    if (archive && reassign) {
      state.tasks = state.tasks.map(row => row.category === item.title ? {...row, category:replacement.title} : row);
    }
    state.categories = list;
  }

  function task(defaults = {}, state) {
    return {
      id: id(), date: today(), title: '', context: '', goalId: '', kind: 'activity',
      category: state ? defaultCategory(state) : categories[0], priority: 'Media', origin: 'Planificada', status: 'Pendiente',
      done: false, comment: '', segments: [], ...defaults
    };
  }

  function planKey(activity) {
    const normalize = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
    return JSON.stringify([activity.kind || 'activity', normalize(activity.title), normalize(activity.context), activity.goalId]);
  }

  function reusableActivities(state, source, destination) {
    if (!isDate(source) || !isDate(destination) || source >= destination) return [];
    const inDestination = new Set(state.tasks.filter(row => row.date === destination).map(planKey));
    const inSource = new Set();
    return state.tasks.filter(row => row.date === source).map(activity => {
      const key = planKey(activity);
      const reason = inDestination.has(key) ? 'Ya está en esta jornada' : inSource.has(key) ? 'Repetida en el día de origen' : '';
      inSource.add(key);
      return { activity, reason };
    });
  }

  function reuseActivities(state, source, destination, selectedIds) {
    const rows = reusableActivities(state, source, destination);
    let count = 0;
    for (const {activity, reason} of rows) {
      if (reason || !selectedIds.has(activity.id)) continue;
      const {title, context, goalId, category, priority} = activity;
      state.tasks.push(task({date:destination, title, context, goalId, kind:activity.kind || 'activity',
        category:categoryForNewTask(state,category), priority}));
      count++;
    }
    return count;
  }

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function validateIdentity(record, ids, label) {
    requireValue(isRecord(record) && hasText(record.id), `Falta el identificador de ${label}.`);
    requireValue(!ids.has(record.id), `Hay un identificador duplicado de ${label}.`);
    ids.add(record.id);
  }

  function validProfilePhoto(value) {
    if (value === '') return true;
    const prefix = 'data:image/jpeg;base64,';
    const maxLength = prefix.length + Math.ceil(profileLimits.bytes / 3) * 4;
    if (typeof value !== 'string' || value.length > maxLength || !value.startsWith(prefix)) return false;
    const data = value.slice(prefix.length);
    if (data.length % 4 || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
    let bytes;
    try { bytes = atob(data); } catch { return false; }
    if (bytes.length > profileLimits.bytes || !bytes.endsWith('\xff\xd9')) return false;
    // Leer las dimensiones del cuadro JPEG y verificar que también haya datos de imagen.
    let frame = false, at = 2;
    while (at < bytes.length - 3 && bytes.charCodeAt(at) === 255) {
      while (bytes.charCodeAt(at) === 255) at++;
      const marker = bytes.charCodeAt(at++);
      const length = bytes.charCodeAt(at) * 256 + bytes.charCodeAt(at + 1);
      if (length < 2 || at + length > bytes.length - 2) return false;
      if (marker === 0xda) return frame && at + length < bytes.length - 2;
      if (marker >= 0xc0 && marker <= 0xc2) {
        if (length < 8) return false;
        const height = bytes.charCodeAt(at + 3) * 256 + bytes.charCodeAt(at + 4);
        const width = bytes.charCodeAt(at + 5) * 256 + bytes.charCodeAt(at + 6);
        if (!height || !width || Math.max(height, width) > profileLimits.side) return false;
        frame = true;
      }
      at += length;
    }
    return false;
  }

  function validateProfile(profile) {
    requireValue(isRecord(profile), 'El formato del perfil no es válido.');
    const {name = '', photo = ''} = profile;
    requireValue(typeof name === 'string' && name.length <= profileLimits.name && !/[\u0000-\u001f\u007f]/.test(name),
      'El nombre del perfil debe tener hasta ' + profileLimits.name + ' caracteres en una línea.');
    requireValue(validProfilePhoto(photo), 'La foto del perfil debe ser un JPEG reducido de hasta 256 píxeles y 64 KB.');
  }

  function saveProfile(state, expected, changes) {
    const current = state.profile || {};
    for (const key of ['name', 'photo']) {
      requireValue((current[key] ?? '') === (expected[key] ?? ''), 'El perfil cambió desde que lo abriste. Vuelve a abrirlo para ver la versión actual.');
    }
    const profile = {...current, name:changes.name.trim(), photo:changes.photo};
    validateProfile(profile);
    state.profile = profile;
  }

  function validateNotes(notes) {
    requireValue(Array.isArray(notes), 'El formato del tablero de notas no es válido.');
    const ids = new Set();
    for (const note of notes) {
      validateIdentity(note, ids, 'nota');
      requireValue(hasText(note.title) && note.title.length <= noteLimits.title,
        'Escribe un título de hasta ' + noteLimits.title + ' caracteres para la nota.');
      requireValue(typeof note.body === 'string' && note.body.length <= noteLimits.body &&
        typeof note.topic === 'string' && note.topic.length <= noteLimits.topic, 'Revisa el contenido y el tema de la nota.');
      requireValue(Object.hasOwn(noteLanes, note.lane), 'Elige una columna del tablero.');
      requireValue(note.reviewDate === '' || isDate(note.reviewDate), 'Selecciona una fecha de revisión válida.');
    }
  }

  function validate(state) {
    requireValue(isRecord(state) && state.version === 1 && Array.isArray(state.goals) && Array.isArray(state.tasks),
      'El formato de la agenda no es válido.');
    if (state.notes !== undefined) validateNotes(state.notes);
    if (state.profile !== undefined) validateProfile(state.profile);
    const catalog = categoryList(state);
    validateCategories(catalog);
    const categoryNames = new Set(catalog.map(item => item.title));
    const goalIds = new Set();
    for (const goal of state.goals) {
      validateIdentity(goal, goalIds, 'objetivo');
      requireValue(hasText(goal.title), 'Escribe el nombre del objetivo.');
      requireValue(typeof goal.description === 'string' && typeof goal.result === 'string',
        'Revisa la descripción y el resultado del objetivo.');
      requireValue(typeof goal.color === 'string' && /^#[a-fA-F\d]{6}$/.test(goal.color), 'Selecciona un color válido para el objetivo.');
      requireValue(['En curso', 'Alcanzado'].includes(goal.status), 'Selecciona el estado del objetivo.');
      if (goal.status === 'Alcanzado') {
        requireValue(hasText(goal.result), 'Describe el resultado alcanzado para registrar el logro.');
        requireValue(isDate(goal.achievedOn), 'Indica en qué fecha se alcanzó el objetivo.');
      } else {
        requireValue(goal.achievedOn === '', 'Quita la fecha de logro de los objetivos en curso.');
      }
    }

    const taskIds = new Set();
    const sessionsByDay = new Map();
    let openSession = null;
    for (const activity of state.tasks) {
      validateIdentity(activity, taskIds, 'actividad');
      requireValue(activity.kind === undefined || ['activity','space'].includes(activity.kind), 'Selecciona un tipo de fila válido.');
      requireValue(activity.kind !== 'space' || activity.goalId === '', 'Un espacio de tiempo debe quedar sin objetivo.');
      requireValue(hasText(activity.title), 'Escribe el nombre de la actividad.');
      requireValue(isDate(activity.date), 'Selecciona una fecha válida para la actividad.');
      requireValue(typeof activity.context === 'string' && typeof activity.comment === 'string',
        'Revisa el contexto y el comentario de la actividad.');
      requireValue(activity.goalId === '' || goalIds.has(activity.goalId), 'El objetivo seleccionado ya no existe.');
      requireValue(categoryNames.has(activity.category), 'Selecciona una categoría válida.');
      requireValue(priorities.includes(activity.priority), 'Selecciona una prioridad válida.');
      requireValue(origins.includes(activity.origin), 'Selecciona el origen de la actividad.');
      requireValue(statuses.includes(activity.status), 'Selecciona un estado válido para la actividad.');
      requireValue(typeof activity.done === 'boolean', 'Revisa la casilla de cumplimiento de la actividad.');
      requireValue(Array.isArray(activity.segments), 'Revisa los tramos de la actividad.');
      if (!sessionsByDay.has(activity.date)) sessionsByDay.set(activity.date, []);
      for (const segment of activity.segments) {
        requireValue(isRecord(segment) && typeof segment.start === 'string' && timePattern.test(segment.start), 'Indica una hora de inicio válida en cada tramo.');
        requireValue(typeof segment.end === 'string' && (segment.end === '' || timePattern.test(segment.end)), 'Indica una hora de fin válida.');
        if (segment.end === '') {
          requireValue(!openSession, `Ya hay un tramo abierto${openSession ? ` en «${openSession.title}» (${openSession.date})` : ''}. Ciérralo antes de abrir otro.`);
          openSession = activity;
        } else {
          requireValue(segment.end > segment.start, 'La hora de fin debe ser posterior a la de inicio en la misma fecha.');
        }
        sessionsByDay.get(activity.date).push({ title: activity.title, start: segment.start, end: segment.end || '24:00' });
      }
    }

    for (const sessions of sessionsByDay.values()) {
      sessions.sort((a, b) => a.start.localeCompare(b.start));
      for (let index = 1; index < sessions.length; index++) {
        const previous = sessions[index - 1];
        const current = sessions[index];
        requireValue(previous.end <= current.start,
          `Los tramos de «${previous.title}» y «${current.title}» se superponen. Ajusta las horas.`);
      }
    }
    return state;
  }

  globalThis.JModel = {
    id, today, timeNow, shiftDate, formatDate, minutes, duration, empty, task, validate, reusableActivities, reuseActivities,
    profileLimits, validProfilePhoto, saveProfile, noteLanes, noteLimits,
    categoryList, categoryOptions, defaultCategory, categoryForNewTask, saveCategory, setCategoryArchived,
    categories: Object.freeze(categories), priorities: Object.freeze(priorities),
    origins: Object.freeze(origins), statuses: Object.freeze(statuses)
  };
})();
