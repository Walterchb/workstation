'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/model.js');
require('../assets/calendar-model.js');
const ics = require('../assets/calendar-ics.js');
const calendarModel = globalThis.JCalendarModel;
const empty = globalThis.JModel.empty;
const stamp = '2026-11-24T12:30:00.000Z';
const meeting = (more = {}) => ({id:'meet-1', title:'Revisión de cierre', calendarId:'work', kind:'meeting',
  startDate:'2026-11-24',endDate:'2026-11-24',startTime:'18:45',endTime:'19:15', allDay:false, ...more});
const physicalLines = file => file.split('\r\n');
const unfolded = file => file.replace(/\r\n /g,'');

test('Una agenda anterior recibe calendarios virtuales independientes y conserva sus registros al crear o editar calendarios', () => {
  const state = empty();
  state.notes = [{id:'nota'}];
  const original = structuredClone(state);
  assert.deepEqual(calendarModel.calendars(state).map(c=>c.name), ['Trabajo','Personal']);
  assert.deepEqual(calendarModel.events(state),[]);
  calendarModel.calendars(state)[0].name = 'Cambio de una copia';
  assert.equal(calendarModel.calendars(state)[0].name, 'Trabajo');
  assert.deepEqual(state,original);
  const created = calendarModel.saveCalendar(state,{name:'Estudios',color:'#2266AA'});
  assert.equal(state.calendars.length,3);
  calendarModel.saveCalendar(state,{id:created.id,name:'Clases'});
  assert.equal(state.calendars[2].name,'Clases');
  assert.equal(state.calendars[2].color,'#2266AA');
  assert.throws(()=>calendarModel.saveCalendar(state,{name:'  CLASES ',color:'#225500'}),/nombre/);
  assert.equal(state.calendars.length,3);
  calendarModel.removeCalendar(state,created.id);
  calendarModel.removeCalendar(state,'personal');
  assert.throws(()=>calendarModel.removeCalendar(state,'work'),/al menos/);
  assert.deepEqual(state.notes,original.notes);
});

test('La suscripción se conserva al editar, se revoca de forma explícita y desaparece al eliminar su calendario', () => {
  const state = empty(), token = '5e'.repeat(32);
  calendarModel.saveCalendar(state,{id:'work',appleToken:token});
  calendarModel.saveCalendar(state,{id:'work',name:'Tesorería'});
  assert.equal(state.calendars[0].appleToken,token);
  assert.throws(()=>calendarModel.saveCalendar(state,{id:'personal',appleToken:token}),/propio enlace/);
  assert.throws(()=>calendarModel.saveCalendar(state,{id:'work',appleToken:'no válido'}),/suscripción/);
  calendarModel.saveCalendar(state,{id:'work',appleToken:null});
  assert.equal(Object.hasOwn(state.calendars[0],'appleToken'),false);
  calendarModel.saveCalendar(state,{id:'work',appleToken:token});
  calendarModel.removeCalendar(state,'work');
  assert.equal(JSON.stringify(state).includes(token),false);
});

test('Eventos y reuniones son propios de cada calendario y registran versiones estables incluso tras reintentos', () => {
  const state = empty();
  const original = calendarModel.saveEvent(state,meeting(),stamp);
  assert.equal(original.sequence,0);
  const retry = calendarModel.saveEvent(state,meeting(),'2026-11-24T14:30:00.000Z');
  assert.deepEqual(retry,original);
  assert.equal(state.events.length,1);
  assert.throws(()=>calendarModel.removeCalendar(state,'work'),/eventos/);
  const revision = calendarModel.saveEvent(state,{id:original.id,title:'Comité de cierre',calendarId:'personal',expectedSequence:0},'2026-11-25T10:00:00.000Z');
  assert.equal(revision.sequence,1);
  assert.equal(revision.updatedAt,'2026-11-25T10:00:00.000Z');
  assert.throws(()=>calendarModel.saveEvent(state,{id:original.id,title:'Edición obsoleta',expectedSequence:0}),/cambió/);
  calendarModel.removeCalendar(state,'work');
  assert.equal(calendarModel.events(state)[0].calendarId,'personal');
  calendarModel.removeEvent(state,original.id);
  assert.deepEqual(state.events,[]);
  calendarModel.validate(state);
});

test('Los eventos admiten rangos de varios días, días completos y reuniones superpuestas', () => {
  const state = empty();
  const day = calendarModel.saveEvent(state,meeting({id:'viaje',allDay:true,startDate:'2026-12-07',endDate:'2026-12-13'}),stamp);
  assert.deepEqual([day.startTime,day.endTime],['','']);
  assert.equal(calendarModel.occursOn(day,'2026-12-13'),true);
  assert.equal(calendarModel.occursOn(day,'2026-12-14'),false);
  const overnight = calendarModel.saveEvent(state,meeting({id:'noche',endDate:'2026-11-25',endTime:'00:00'}),stamp);
  assert.equal(calendarModel.occursOn(overnight,'2026-11-24'),true);
  assert.equal(calendarModel.occursOn(overnight,'2026-11-25'),false);
  assert.doesNotThrow(()=>calendarModel.saveEvent(state,meeting(),stamp));
  const before = structuredClone(state);
  for (const invalid of [{endTime:'15:00'},{startDate:'2026-02-29'},{title:''},{startTime:'24:60'},{endDate:'2026-11-20'},{calendarId:'inexistente'}]) {
    assert.throws(()=>calendarModel.saveEvent(state,meeting({id:'invalid',...invalid}),stamp));
  }
  assert.deepEqual(before,state);
});

test('iCalendar filtra el calendario elegido, usa horas de Lima, identificadores y revisión estables, y fin exclusivo para día completo', () => {
  const state = empty();
  const work = calendarModel.saveCalendar(state,{id:'work',appleToken:'6d'.repeat(32)});
  calendarModel.saveEvent(state,meeting(),stamp);
  calendarModel.saveEvent(state,meeting({id:'febrero',allDay:true,startDate:'2028-02-28',endDate:'2028-02-29'}),stamp);
  calendarModel.saveEvent(state,meeting({id:'personal',calendarId:'personal',title:'Privado y distinto'}),stamp);
  const first = ics.serialize(work,state.events);
  assert.equal(first,ics.serialize(work,state.events));
  assert.match(first,/DTSTART:20261124T234500Z\r\nDTEND:20261125T001500Z/);
  assert.match(first,/DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(first,/UID:meet-1@workhub.calendar/);
  assert.match(first,/DTSTAMP:20261124T123000Z/);
  assert.match(first,/SEQUENCE:0\r\n/);
  assert.equal(first.includes('Privado y distinto'),false);
  assert.equal(first.includes(work.appleToken),false);
  assert.equal(first.endsWith('END:VCALENDAR\r\n'),true);
  calendarModel.saveEvent(state,meeting({title:'Actualizada'}),'2026-11-25T12:30:00.000Z');
  const update = ics.serialize(work,state.events);
  assert.match(update,/UID:meet-1@workhub.calendar[\s\S]*?SEQUENCE:1\r\n/);
  assert.match(update,/SUMMARY:Actualizada/);
});

test('El archivo escapa caracteres reservados, no permite inyectar propiedades y pliega UTF-8 completo en 75 octetos', () => {
  const state = empty();
  const description = '🌿á'.repeat(80) + '\r\nEND:VEVENT,oficina;A\\B';
  calendarModel.saveEvent(state,meeting({description}),stamp);
  const file = ics.serialize(calendarModel.calendars(state)[0],state.events);
  for (const line of physicalLines(file)) assert.ok(Buffer.byteLength(line,'utf8') <= 75);
  assert.match(unfolded(file),/\\nEND:VEVENT\\,oficina\\;A\\\\B\r\n/);
  assert.equal(physicalLines(file).filter(line=>line==='END:VEVENT').length,1);
  assert.ok(unfolded(file).includes('🌿á'.repeat(80)));
});

test('Las horas históricas conservan los cambios horarios de Lima', () => {
  const state = empty();
  for (const [index,startDate,startTime,endTime] of [[1,'1994-01-01','00:30','02:00'],[2,'1994-03-31','23:10','23:50'],[3,'1994-02-01','10:30','11:00']]) {
    calendarModel.saveEvent(state,meeting({id:'hist-'+index,startDate,endDate:startDate,startTime,endTime}),stamp);
  }
  const file = ics.serialize(calendarModel.calendars(state)[0],state.events);
  assert.match(file,/DTSTART:19940101T053000Z\r\nDTEND:19940101T060000Z/);
  assert.match(file,/DTSTART:19940401T031000Z\r\nDTEND:19940401T035000Z/);
  assert.match(file,/DTSTART:19940201T143000Z\r\nDTEND:19940201T150000Z/);
});
