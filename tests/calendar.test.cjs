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

test('Calendario proyecta solo tramos con inicio, incluidos los abiertos, sin alterar actividades ni espacios', () => {
  const state=empty(), date='2026-11-24', goal={id:'gestion',title:'Atención',color:'#918273'};
  state.goals=[goal];
  const task={id:'a:1',date,title:'Visita',context:'Sede norte',goalId:goal.id,
    segments:[{start:'09:00',end:'10:00'},{start:'16:00',end:''}]};
  state.tasks=[task,{...task,id:'a:2',kind:'space',goalId:'',title:'Almuerzo',segments:[]},
    {...task,id:'a:3',date:'2026-11-25',segments:[]},
    {...task,id:'a:4',kind:'space',goalId:'',title:'Pausa programada',segments:[{start:'13:00',end:'14:00'}]}];
  const original=structuredClone(state);
  const project=()=>calendarModel.activityItems(state,date,date);
  const [first,open,scheduledSpace]=project();
  assert.deepEqual(project().map(e=>[e.title,e.startTime,e.endTime,e.allDay]),[
    ['Visita','09:00','10:00',false],['Visita','16:00','',false],['Pausa programada','13:00','14:00',false]]);
  assert.equal(first.description,task.context);
  assert.notEqual(first.id,open.id);
  assert.equal(first.calendarId,calendarModel.activityCalendar.id);
  assert.equal(calendarModel.eventCategory(state,first).name,goal.title);
  assert.equal(calendarModel.eventColor(state,first),goal.color);
  assert.equal(calendarModel.eventCategory(state,scheduledSpace),null);
  assert.deepEqual(calendarModel.events(state),[]);
  assert.ok(!calendarModel.calendars(state).some(c=>c.id===first.calendarId));
  assert.ok(!calendarModel.categories(state).some(c=>c.id===first.categoryId));
  assert.deepEqual(state,original);
  assert.throws(()=>calendarModel.saveEvent(state,meeting({calendarId:first.calendarId}),stamp));
  assert.throws(()=>calendarModel.saveEvent(state,meeting({id:first.id}),stamp));
  task.segments.reverse();
  assert.deepEqual(project().slice(0,2).map(e=>e.id),[open.id,first.id]);
  task.title='Llamada'; task.context='Nueva sede'; task.segments[0].end='17:15';
  goal.color='#B31459'; goal.title='Nuevo objetivo';
  assert.deepEqual([project()[0].title,project()[0].description,project()[0].endTime],['Llamada','Nueva sede','17:15']);
  assert.equal(calendarModel.eventCategory(state,project()[0]).name,goal.title);
  assert.equal(calendarModel.eventColor(state,project()[0]),goal.color);
  task.date='2026-11-23';
  assert.deepEqual(project().map(e=>e.id),[scheduledSpace.id]);
  const formerlyUnscheduled = state.tasks[1];
  formerlyUnscheduled.segments=[{start:'12:00',end:'12:45'}];
  assert.ok(project().some(e=>e.sourceTaskId===formerlyUnscheduled.id));
  formerlyUnscheduled.segments=[];
  assert.ok(!project().some(e=>e.sourceTaskId===formerlyUnscheduled.id));
  state.tasks=[];
  assert.deepEqual(project(),[]);
});

test('Mes reconoce solo el calendario guardado Workhub, también al renombrarlo. Día conserva las demás fuentes', () => {
  const state=empty(), monthly=()=>calendarModel.calendarsForView(state,'month').map(cal=>cal.id);
  assert.deepEqual(monthly(),[]);
  const custom=calendarModel.saveCalendar(state,{id:'custom',name:'Equipo',color:'#113344'});
  calendarModel.saveCalendar(state,{id:custom.id,name:'WORK   HUB'});
  assert.deepEqual(monthly(),[custom.id]);
  calendarModel.saveCalendar(state,{id:'personal',name:'Workhub'});
  assert.deepEqual(monthly(),['personal']);
  const daily=calendarModel.calendarsForView(state,'day').map(cal=>cal.id);
  assert.deepEqual(daily,['work','personal',custom.id,calendarModel.activityCalendar.id]);
  calendarModel.saveCalendar(state,{id:'personal',name:'Workhub personal'});
  assert.deepEqual(monthly(),[custom.id]);
  calendarModel.removeCalendar(state,custom.id);
  assert.deepEqual(monthly(),[]);
});

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
  assert.equal(first.split('BEGIN:VTIMEZONE').length,2);
  assert.ok(first.includes('BEGIN:VTIMEZONE\r\nTZID:America/Lima\r\n'));
  assert.ok(first.includes('TZOFFSETTO:-0500\r\n'));
  assert.ok(first.includes('DTSTART;TZID=America/Lima:20261124T184500\r\nDTEND;TZID=America/Lima:20261124T191500'));
  assert.doesNotMatch(first,/DT(?:START|END):\d{8}T\d{6}Z/);
  assert.match(first,/DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(first,/UID:meet-1@workhub.calendar/);
  assert.match(first,/DTSTAMP:20261124T123000Z/);
  assert.match(first,/SEQUENCE:1\r\n/);
  assert.equal(first.includes('Privado y distinto'),false);
  assert.equal(first.includes(work.appleToken),false);
  assert.equal(first.endsWith('END:VCALENDAR\r\n'),true);
  calendarModel.saveEvent(state,meeting({title:'Actualizada'}),'2026-11-25T12:30:00.000Z');
  const update = ics.serialize(work,state.events);
  assert.match(update,/UID:meet-1@workhub.calendar[\s\S]*?SEQUENCE:2\r\n/);
  assert.match(update,/SUMMARY:Actualizada/);
});

test('Al borrar el último evento, el calendario vacío conserva un componente de zona horaria válido', () => {
  const state = empty(), work = calendarModel.calendars(state)[0];
  const last = calendarModel.saveEvent(state,meeting(),stamp);
  calendarModel.removeEvent(state,last.id);
  const emptyCalendar = ics.serialize(work,state.events);
  calendarModel.saveEvent(state,meeting({id:'personal',calendarId:'personal'}),stamp);
  assert.equal(ics.serialize(work,state.events),emptyCalendar);
  const components = physicalLines(emptyCalendar).filter(line => /^(BEGIN|END):/.test(line));
  assert.deepEqual(components,['BEGIN:VCALENDAR','BEGIN:VTIMEZONE','BEGIN:STANDARD','END:STANDARD','END:VTIMEZONE','END:VCALENDAR']);
  assert.match(emptyCalendar,/TZID:America\/Lima\r\n/);
  const standard = emptyCalendar.split('BEGIN:STANDARD\r\n')[1].split('END:STANDARD')[0];
  assert.match(standard,/^DTSTART:\d{8}T\d{6}\r?$/m);
  assert.match(standard,/^TZOFFSETFROM:[+-]\d{4,6}\r?$/m);
  assert.match(standard,/^TZOFFSETTO:-0500\r?$/m);
});

test('Un evento de una suscripción anterior conserva su UID y publica la revisión siguiente incluso al cambiar de tipo', () => {
  const state = empty(), calendar = calendarModel.calendars(state)[0];
  const original = calendarModel.saveEvent(state,meeting(),stamp);
  original.sequence = 12;
  const exported = () => {
    const text = ics.serialize(calendar,state.events);
    return [text.match(/^UID:(.+)$/m)[1], Number(text.match(/^SEQUENCE:(\d+)$/m)[1])];
  };
  const previousUid = original.id + '@workhub.calendar';
  assert.deepEqual(exported(),[previousUid,13]);
  assert.equal(original.sequence,12);
  calendarModel.saveEvent(state,{id:original.id,allDay:true,expectedSequence:12},stamp);
  assert.deepEqual(exported(),[previousUid,14]);
  calendarModel.saveEvent(state,{id:original.id,allDay:false,startTime:'08:00',endTime:'09:00',expectedSequence:13},stamp);
  assert.deepEqual(exported(),[previousUid,15]);
  state.events[0].sequence = 2147483647;
  assert.deepEqual(exported(),[previousUid,2147483647]);
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
  assert.ok(file.includes('BEGIN:DAYLIGHT\r\n'));
  for (const event of state.events) {
    const start = event.startDate.replaceAll('-','')+'T'+event.startTime.replace(':','')+'00';
    const end = event.endDate.replaceAll('-','')+'T'+event.endTime.replace(':','')+'00';
    assert.ok(file.includes('DTSTART;TZID=America/Lima:'+start+'\r\nDTEND;TZID=America/Lima:'+end));
  }
  assert.equal(new Date(ics.limaInstant('1994-01-01','00:30')).toISOString(),'1994-01-01T05:30:00.000Z');
  assert.equal(new Date(ics.limaInstant('1994-03-31','23:10')).toISOString(),'1994-04-01T03:10:00.000Z');
  assert.equal(new Date(ics.limaInstant('1994-02-01','10:30')).toISOString(),'1994-02-01T14:30:00.000Z');
});

test('La categoría y el color de cada evento se comparten entre calendarios y el cambio de nombre actualiza la suscripción', () => {
  const state = empty();
  const initial = calendarModel.categories(state);
  initial[0].name = 'Copia local';
  assert.equal(calendarModel.categories(state)[0].name,'Gestión');
  const first = calendarModel.saveEvent(state,meeting({categoryId:'gestion'}),stamp);
  assert.ok(state.eventCategories.some(c=>c.id === 'gestion'));
  const second = calendarModel.saveEvent(state,meeting({id:'personal',calendarId:'personal',categoryId:'gestion'}),stamp);
  assert.equal(calendarModel.eventColor(state,first),calendarModel.eventColor(state,second));
  const newStamp = '2026-11-28T21:00:00.000Z';
  calendarModel.saveCategory(state,{id:'gestion',name:'Preparación de informes',color:'#118899'},newStamp);
  assert.ok(state.events.every(event=>event.sequence===1 && event.updatedAt===newStamp));
  assert.equal(calendarModel.eventColor(state,first),'#118899');
  assert.equal(calendarModel.eventCategory(state,second).name,'Preparación de informes');
  assert.throws(()=>calendarModel.removeCategory(state,'gestion'),/eventos/);
  const before = structuredClone(state);
  assert.throws(()=>calendarModel.saveCategory(state,{name:'PREPARACIÓN DE INFORMES',color:'#112233'}),/nombre/);
  assert.throws(()=>calendarModel.saveCategory(state,{id:'gestion',color:'bad-color'}),/color/);
  assert.throws(()=>calendarModel.saveEvent(state,meeting({categoryId:'missing'})),/categoría/);
  assert.deepEqual(state,before);
  const custom = calendarModel.saveCategory(state,{name:'Categoría especial',color:'#012345'});
  calendarModel.removeCategory(state,custom.id);
  assert.equal(calendarModel.categories(state).some(category=>category.id===custom.id),false);
});

test('Los eventos nuevos tienen aviso a cinco minutos y los anteriores mantienen su configuración al editarse', () => {
  const state = empty();
  const legacy = {...meeting(),location:'',description:'',updatedAt:stamp,sequence:0};
  state.events=[legacy];
  calendarModel.validate(state);
  assert.equal(calendarModel.eventCategory(state,legacy),null);
  assert.equal(calendarModel.saveEvent(state,{id:legacy.id},stamp),legacy);
  let event = calendarModel.saveEvent(state,{id:legacy.id,title:'Otro título'},stamp);
  assert.equal(event.reminderMinutes,null);
  assert.equal(event.categoryId,'');
  event = calendarModel.saveEvent(state,meeting({id:'nuevo'}),stamp);
  assert.equal(event.reminderMinutes,5);
  for (const reminderMinutes of calendarModel.reminderOptions) {
    event = calendarModel.saveEvent(state,{id:'nuevo',reminderMinutes},stamp);
    assert.equal(event.reminderMinutes,reminderMinutes);
  }
  assert.throws(()=>calendarModel.saveEvent(state,{id:'nuevo',reminderMinutes:-1},stamp),/aviso/);
  assert.throws(()=>calendarModel.saveEvent(state,{id:'nuevo',reminderMinutes:'5'},stamp),/aviso/);
  assert.equal(calendarModel.saveEvent(state,{id:'nuevo',reminderMinutes:null},stamp).reminderMinutes,null);
});

test('Exportación iCalendar con alarma relativa, categoría escapada y alcance limitado al calendario', () => {
  const state=empty(), cal=calendarModel.calendars(state)[0];
  const category=calendarModel.saveCategory(state,{name:'Informes, FX; cobertura',color:'#112233'});
  calendarModel.saveEvent(state,meeting({categoryId:category.id}),stamp);
  calendarModel.saveEvent(state,meeting({id:'inicio',reminderMinutes:0,allDay:true}),stamp);
  calendarModel.saveEvent(state,meeting({id:'sinaviso',reminderMinutes:null}),stamp);
  const other=calendarModel.saveCategory(state,{name:'Solo privado',color:'#654321'});
  calendarModel.saveEvent(state,meeting({id:'privado',calendarId:'personal',categoryId:other.id,reminderMinutes:30}),stamp);
  const file=unfolded(ics.serialize(cal,state.events,state.eventCategories));
  assert.ok(file.includes('CATEGORIES:Informes\\, FX\\; cobertura,Reunión\r\n'));
  assert.equal(file.match(/BEGIN:VALARM/g).length,2);
  assert.ok(file.includes('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nDESCRIPTION:Revisión de cierre\r\nEND:VALARM'));
  assert.ok(file.includes('TRIGGER:PT0M\r\n'));
  assert.equal(file.includes('Solo privado'),false);
  assert.equal(file.includes('TRIGGER:-PT30M'),false);
  assert.equal(new Date(ics.limaInstant('2026-11-24','00:02') - 5*60000).toISOString(),'2026-11-24T04:57:00.000Z');
});
