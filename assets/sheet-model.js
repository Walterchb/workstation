/* Borrador de edición por fecha. La persistencia y la revisión remota las gestiona JStore. */
(() => {
  'use strict';

  const model = globalThis.JModel;
  const fields = ['status', 'title', 'context', 'done', 'start', 'end', 'duration', 'comment'];
  const headers = [
    ['estado'], ['actividad', 'actividades'], ['contexto'], ['se hizo', 'hecho', 'cumplido', 'cumpli lo previsto'],
    ['inicio', 'hora de inicio'], ['fin', 'cierre', 'hora de fin', 'hora de cierre'],
    ['duracion', 'tiempo'], ['comentario', 'comentarios']
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const label = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[¿?]/g, '').trim().replace(/\s+/g, ' ');

  function createDraft(state, date) {
    const baseline = clone(state.tasks.filter(row => row.date === date));
    return { date, baseline, rows: clone(baseline), defaultCategory:model.defaultCategory(state) };
  }

  function newRow(draft, defaults = {}) {
    const values = clone(defaults);
    delete values.id;
    return model.task({ category:draft.defaultCategory, ...values, date: draft.date });
  }

  function insertRow(draft, index, defaults = {}) {
    const row = newRow(draft, defaults);
    const position = Number.isInteger(index) ? Math.max(0, Math.min(index, draft.rows.length)) : draft.rows.length;
    draft.rows.splice(position, 0, row);
    return row;
  }

  function moveRow(draft, id, offset) {
    const index = draft.rows.findIndex(row => row.id === id);
    const target = index + offset;
    if (index < 0 || !Number.isInteger(offset) || !offset || target < 0 || target >= draft.rows.length) return false;
    const [row] = draft.rows.splice(index, 1);
    draft.rows.splice(target, 0, row);
    return true;
  }

  function fieldError(message, rowIndex, field, segmentIndex) {
    return Object.assign(new Error(`Fila ${rowIndex + 1}. ${message}`), { rowIndex, field, segmentIndex });
  }

  function normalizeTime(value) {
    const input = String(value ?? '').trim().toLowerCase();
    if (!input) return '';
    const match = /^(\d{1,2}):(\d{2})(?::00)?(?:\s*([ap])\s*\.?\s*m\.?)?$/.exec(input);
    if (!match) throw new Error('Usa una hora como 08:05 o 3:15 p. m.');
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12))) {
      throw new Error('Revisa la hora y los minutos.');
    }
    if (match[3]) hour = hour % 12 + (match[3] === 'p' ? 12 : 0);
    return String(hour).padStart(2, '0') + ':' + match[2];
  }

  function parseTSV(text) {
    const input = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!input) return [];
    const table = [];
    let cells = [], cell = '', quoted = false, afterQuote = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char !== '"') cell += char;
        else if (input[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else if (char === '\t' || char === '\n') {
        cells.push(cell);
        cell = ''; afterQuote = false;
        if (char === '\n') { table.push(cells); cells = []; }
      } else if (afterQuote) {
        throw new Error('Revisa el texto que sigue a las comillas de una celda pegada.');
      } else if (char === '"' && cell === '') quoted = true;
      else cell += char;
    }
    if (quoted) throw new Error('Falta cerrar las comillas en una celda pegada.');
    if (!input.endsWith('\n')) { cells.push(cell); table.push(cells); }
    return table;
  }

  function headerStart(row) {
    if (row.length !== fields.length && row.length !== 2) return -1;
    const start = row.length === fields.length ? 0 : 1;
    return row.every((value, i) => headers[start + i].includes(label(value))) ? start : -1;
  }

  function setPastedValue(row, field, value, rowIndex, segmentIndex) {
    const text = String(value ?? '');
    if (field === 'duration') return;
    if (field === 'start' || field === 'end') {
      if (segmentIndex > row.segments.length) throw fieldError('El tramo seleccionado ya no existe.', rowIndex, field, segmentIndex);
      // Excel conserva varias líneas dentro de una celda entrecomillada.
      text.split(/\r\n|\r|\n/).forEach((line, offset) => {
        const index = segmentIndex + offset;
        let time;
        try { time = normalizeTime(line); }
        catch (error) { throw fieldError(error.message, rowIndex, field, index); }
        if (index === row.segments.length) row.segments.push({ start: '', end: '' });
        row.segments[index][field] = time;
      });
    } else if (field === 'done') {
      const token = label(text);
      if (['1', 'si', 'verdadero', 'true', 'x', '✓', '✔', '☑'].includes(token)) row.done = true;
      else if (['', '0', 'no', 'falso', 'false', '☐'].includes(token)) row.done = false;
      else throw fieldError('Usa Sí o No en «¿Se hizo?».', rowIndex, field);
    } else if (field === 'status') {
      const token = label(text);
      const status = {'':'Pendiente', pendiente:'Pendiente', 'en proceso':'En proceso', 'en progreso':'En proceso',
        culminado:'Culminado', culminada:'Culminado', completado:'Culminado', completada:'Culminado'};
      if (!Object.hasOwn(status, token)) throw fieldError('El estado debe ser Pendiente, En proceso o Culminado.', rowIndex, field);
      row.status = status[token];
    } else {
      row[field] = text;
    }
  }

  function paste(draft, startRow, startCol, table, segmentIndex = 0) {
    if (!Number.isInteger(startRow) || startRow < 0 || startRow > draft.rows.length ||
        !Number.isInteger(startCol) || startCol < 0 || startCol >= fields.length ||
        !Number.isInteger(segmentIndex) || segmentIndex < 0) throw new Error('Selecciona una celda válida para pegar.');
    if (!table.length) return 0;
    const header = headerStart(table[0]);
    const firstColumn = header < 0 ? startCol : header;
    const incoming = header < 0 ? table : table.slice(1);
    if (!incoming.length) return 0;
    // Trabajar sobre copias preserva todo el borrador si una de las celdas no es válida.
    const rows = draft.rows.slice();
    incoming.forEach((cells, i) => {
      const rowIndex = startRow + i;
      if (cells.length + firstColumn > fields.length) {
        throw fieldError('El bloque supera la columna Comentarios. Elige una celda más a la izquierda.', rowIndex, fields[firstColumn]);
      }
      const row = rows[rowIndex] ? clone(rows[rowIndex]) : newRow(draft);
      const segment = i === 0 && header < 0 && (startCol === 4 || startCol === 5) ? segmentIndex : 0;
      cells.forEach((value, j) => setPastedValue(row, fields[firstColumn + j], value, rowIndex, segment));
      rows[rowIndex] = row;
    });
    draft.rows = rows;
    return incoming.length;
  }

  function pasteTextColumn(draft, index, column, table) {
    if (![2,7].includes(column) || !Number.isInteger(index) || index<0 || table.some(cells => cells.length!==1)) {
      throw new Error('Selecciona una sola columna de Contexto o Comentarios.');
    }
    const rows = table.length>1 && headers[column].includes(label(table[0][0])) ? table.slice(1) : table;
    if (!rows.length) return 0;
    if (rows.some((_,i) => !draft.rows[index+i]?.title.trim())) {
      throw new Error('El bloque alcanza una fila sin actividad. Crea las actividades o copia menos filas antes de pegar.');
    }
    return paste(draft,index,column,rows);
  }

  // Ignorar el orden de las claves de objetos JSON, conservando el de sus arreglos.
  function sameJSON(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameJSON(a[key], b[key]));
  }

  function emptyNewRow(row, defaultCategory) {
    return !row.title.trim() && !row.context.trim() && !row.comment.trim() && !row.goalId && !row.done &&
      row.segments.length === 0 && row.status === 'Pendiente' && row.origin === 'Planificada' &&
      row.priority === 'Media' && row.category === defaultCategory;
  }

  function isUnused(draft, row) {
    return !draft.baseline.some(saved => saved.id === row.id) &&
      emptyNewRow({ ...row, segments:row.segments.filter(part => part.start || part.end) },draft.defaultCategory);
  }

  function readPlan(table) {
    const result = [];
    for (let i = 0; i < table.length; i++) {
      const cells = table[i];
      if (i === 0 && (headerStart(cells) === 1 || (cells.length===3 && headerStart(cells.slice(0,2))===1 && headers[7].includes(label(cells[2]))) ||
          (table.length > 1 && cells.length === 1 && headers[1].includes(label(cells[0]))))) continue;
      if (cells.slice(3).some(value => value.trim())) throw new Error('Línea ' + (i+1) + '. Copia Actividad, Contexto y, si corresponde, Comentarios.');
      const title = (cells[0] || '').trim(), context = (cells[1] || '').trim();
      const comment = cells[2] || '';
      if (!title && !context && !comment.trim()) continue;
      if (!title) throw new Error('Línea ' + (i+1) + '. Escribe la actividad que corresponde a este contexto.');
      result.push(comment ? {title,context,comment} : {title,context});
    }
    return result;
  }

  // El plan crea filas nuevas en el orden de Excel. Sólo reutiliza una fila de captura intacta.
  function insertPlan(draft, index, plan) {
    if (!plan.length) return 0;
    const position = Math.max(0,Math.min(index,draft.rows.length));
    const discardBlank = draft.rows[position] && isUnused(draft,draft.rows[position]) ? 1 : 0;
    const inserted = plan.map(values => newRow(draft,values));
    draft.rows = draft.rows.slice(0,position).concat(inserted,draft.rows.slice(position+discardBlank));
    return inserted.length;
  }

  function prepareRows(draft) {
    const existing = new Set(draft.baseline.map(row => row.id));
    return draft.rows.flatMap((source, rowIndex) => {
      const row = clone(source);
      if (row.date !== draft.date) throw fieldError('Esta actividad corresponde a otra fecha.', rowIndex, 'title');
      row.segments = row.segments.flatMap((item, segmentIndex) => {
        const segment = { ...item };
        for (const key of ['start', 'end']) {
          try { segment[key] = normalizeTime(segment[key]); }
          catch (error) { throw fieldError(error.message, rowIndex, key, segmentIndex); }
        }
        if (!segment.start && !segment.end) return [];
        if (!segment.start) throw fieldError('Indica la hora de inicio del tramo.', rowIndex, 'start', segmentIndex);
        if (segment.end && segment.end <= segment.start) {
          throw fieldError('La hora de fin debe ser posterior al inicio.', rowIndex, 'end', segmentIndex);
        }
        return [segment];
      });
      if (!existing.has(row.id) && emptyNewRow(row,draft.defaultCategory)) return [];
      if (!row.title.trim()) throw fieldError('Escribe el nombre de la actividad.', rowIndex, 'title');
      const open = row.segments.findIndex(segment => !segment.end);
      if (open >= 0) {
        if (row.status === 'Culminado') throw fieldError('Completa la hora de fin antes de marcar la actividad como culminada.', rowIndex, 'end', open);
        row.status = 'En proceso';
      }
      return [row];
    });
  }

  function applyDay(state, draft) {
    const current = state.tasks.filter(row => row.date === draft.date);
    if (!sameJSON(current, draft.baseline)) {
      throw new Error('Esta jornada cambió desde que abriste la hoja. Vuelve a abrirla para editar la versión actual.');
    }
    const replacements = prepareRows(draft);
    // Reutilizar las posiciones que ocupaba este día conserva el orden relativo de cada otra fecha.
    const tasks = [];
    let previousSlots = 0, placed = 0;
    for (const item of state.tasks) {
      if (item.date !== draft.date) { tasks.push(item); continue; }
      previousSlots++;
      if (placed < replacements.length) tasks.push(replacements[placed++]);
      if (previousSlots === current.length) {
        while (placed < replacements.length) tasks.push(replacements[placed++]);
      }
    }
    if (!current.length) for (const row of replacements) tasks.push(row);
    model.validate({ ...state, tasks });
    state.tasks = tasks;
  }

  globalThis.JSheetModel = {createDraft, newRow, insertRow, moveRow, normalizeTime, parseTSV, paste, pasteTextColumn, readPlan, insertPlan, isUnused, applyDay};
})();
