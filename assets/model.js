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
      id: id(), date: today(), title: '', context: '', goalId: '',
      category: state ? defaultCategory(state) : categories[0], priority: 'Media', origin: 'Planificada', status: 'Pendiente',
      done: false, comment: '', segments: [], ...defaults
    };
  }

  function planKey(activity) {
    const normalize = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-PE');
    return JSON.stringify([normalize(activity.title), normalize(activity.context), activity.goalId]);
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
      state.tasks.push(task({date:destination, title, context, goalId, category:categoryForNewTask(state,category), priority}));
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

  function validate(state) {
    requireValue(isRecord(state) && state.version === 1 && Array.isArray(state.goals) && Array.isArray(state.tasks),
      'El formato de la agenda no es válido.');
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

  function seed() {
    const state = empty();
    const now = new Date();
    const currentDate = today(now);
    const currentTime = timeNow(now);
    const workdays = [];
    let day = currentDate;
    while (workdays.length < 8) {
      day = shiftDate(day, -1);
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6) workdays.push(day);
    }
    const [issuance, closing, review, dashboard] = [id(), id(), id(), id()];
    state.goals = [
      { id: issuance, title: 'Emisión de bonos corporativos', description: 'Preparar la documentación y completar la debida diligencia para la emisión.', color: '#137F78', status: 'En curso', result: '', achievedOn: '' },
      { id: closing, title: 'Cierre de resultados', description: 'Entregar a gerencia cifras conciliadas con las explicaciones de las variaciones.', color: '#4274C2', status: 'En curso', result: '', achievedOn: '' },
      { id: review, title: 'Revisión de calificación', description: 'Sustentar la información financiera solicitada durante la evaluación.', color: '#AE7333', status: 'En curso', result: '', achievedOn: '' },
      { id: dashboard, title: 'Tablero de tesorería', description: 'Consolidar los indicadores de resultados en una vista de consulta.', color: '#8069A8', status: 'Alcanzado', result: 'Se publicó el tablero validado y se entregó la guía de lectura a gerencia.', achievedOn: workdays[2] }
    ];

    function add(date, title, context, goalId, category, priority, origin, status, done, comment, hours) {
      let segments = hours.map(([start, end]) => ({ start, end }));
      // Permite ensayar el cronómetro en el día de apertura sin sesiones futuras del ejemplo.
      if (date === currentDate && segments.some(segment => segment.end > currentTime)) {
        segments = segments.filter(segment => segment.start < currentTime)
          .map(segment => ({ ...segment, end: segment.end > currentTime ? currentTime : segment.end }));
        status = segments.length ? 'En proceso' : 'Pendiente';
        done = false;
        comment = segments.length ? 'Se registró un primer avance para retomar la revisión.' : '';
      }
      state.tasks.push(task({ date, title, context, goalId, category, priority, origin, status, done, comment, segments }));
    }

    const control = categories[0];
    const markets = categories[1];
    const coordination = categories[2];
    const scheduled = 'Planificada';
    const done = 'Culminado';
    add(currentDate, 'Reportes de concentración y posición', 'Actualizar el reporte diario de exposición.', closing, control, 'Alta', scheduled, done, true, 'Reporte conciliado y enviado.', [['08:00','08:10']]);
    add(currentDate, 'Validar el resultado de operaciones financieras', 'Conciliar el tablero con el reporte de cambios e inversiones.', closing, control, 'Alta', scheduled, done, true, 'Se validaron las cifras del cierre.', [['08:10','08:30']]);
    add(currentDate, 'Cerrar consultas del due diligence', 'Completar la respuesta pendiente del equipo comercial.', issuance, markets, 'Alta', scheduled, done, true, 'Se incorporó la confirmación al expediente y se envió la respuesta.', [['08:30','10:30']]);
    add(currentDate, 'Revisar el alcance de auditoría', 'Precisar los entregables y revisar la primera versión del servicio.', issuance, markets, 'Media', scheduled, 'En proceso', true, 'Se remitió la versión comentada. La aprobación final sigue pendiente.', [['10:30','12:20'],['13:20','14:00']]);
    add(currentDate, 'Documentar los acuerdos de operaciones', 'Recoger las decisiones y los responsables de la reunión.', '', coordination, 'Media', 'Imprevista', done, true, 'Acta compartida con los responsables de cada acuerdo.', [['12:20','13:20']]);
    add(currentDate, 'Preparar el paquete de calificación', 'Atender el primer bloque de consultas financieras.', review, control, 'Alta', scheduled, 'En proceso', true, 'Primer paquete enviado para revisión.', [['15:15','17:15']]);
    add(currentDate, 'Actualizar el prospecto marco', 'Incorporar las cifras del último cierre.', issuance, markets, 'Media', scheduled, 'Pendiente', false, '', []);
    add(currentDate, 'Revisar el pedido de cartera', 'Contrastar los saldos con el reporte de cartera elegible.', '', control, 'Baja', 'Imprevista', 'Pendiente', false, '', []);
    add(currentDate, 'Preparar el comentario de variaciones', 'Explicar los principales movimientos de resultados.', closing, control, 'Media', scheduled, 'Pendiente', false, '', []);

    const milestones = [
      ['Consolidar respuestas del expediente', 'Cruzar las respuestas con la lista de pendientes.', issuance, markets, 'Se consolidó la matriz y se identificó una consulta abierta.'],
      ['Conciliar los rubros del cierre', 'Revisar los resultados por producto.', closing, control, 'Se documentó la conciliación del cierre.'],
      ['Entregar el tablero validado', 'Presentar los indicadores y su guía de lectura.', dashboard, control, 'Tablero publicado y guía entregada.'],
      ['Organizar los anexos de calificación', 'Ordenar la información por bloque de consultas.', review, control, 'Índice de anexos enviado para revisión.'],
      ['Validar los indicadores del tablero', 'Contrastar los indicadores contra las fuentes de cierre.', dashboard, control, 'Tres conciliaciones aprobadas.'],
      ['Circular el borrador del prospecto', 'Solicitar comentarios sobre las cifras de la emisión.', issuance, markets, 'Borrador distribuido a las áreas revisoras.'],
      ['Revisar la ficha de la emisión', 'Preparar las características para discusión.', issuance, markets, 'Ficha preparada para la reunión de revisión.'],
      ['Definir los indicadores del tablero', 'Acordar el contenido de la vista de resultados.', dashboard, control, 'Se acordaron los indicadores y su fuente de información.']
    ];
    for (let index = 0; index < workdays.length; index++) {
      const date = workdays[index];
      const [title, context, goalId, category, comment] = milestones[index];
      add(date, 'Control de posición diaria', 'Conciliar saldos y variaciones.', closing, control, 'Media', scheduled, done, true,
        'Cifras revisadas para el reporte diario.', [['08:00', index % 2 === 0 ? '08:25' : '08:40']]);
      const workBlocks = index === 0 ? [['09:00', '10:15'], ['11:10', '12:25']]
        : [['09:00', ['11:30','10:40','12:00','11:00'][index % 4]]];
      add(date, title, context, goalId, category, 'Alta', scheduled, done, true, comment, workBlocks);
      if (index % 2 === 0) {
        add(date, 'Atender consulta de cifras', 'Preparar el detalle solicitado por el equipo.', '', coordination, 'Media', 'Imprevista', done, true,
          'Se aclaró el origen de la variación.', [['15:00', '15:45']]);
      }
    }
    return state;
  }

  globalThis.JModel = {
    id, today, timeNow, shiftDate, formatDate, minutes, duration, empty, seed, task, validate, reusableActivities, reuseActivities,
    categoryList, categoryOptions, defaultCategory, categoryForNewTask, saveCategory, setCategoryArchived,
    categories: Object.freeze(categories), priorities: Object.freeze(priorities),
    origins: Object.freeze(origins), statuses: Object.freeze(statuses)
  };
})();
