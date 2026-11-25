import test from 'node:test';
import assert from 'node:assert/strict';
import {queryWorkspace} from '../supabase/functions/workhub-chat/context.mjs';

const today='2026-11-24';
const query=(data,filters={},scope='all')=>queryWorkspace(data,filters,scope,today);
const task=(id,extra={})=>({id,title:'Revisar estado',date:today,kind:'activity',status:'En proceso',done:false,
  goalId:'g1',category:'Inventario',priority:'Alta',origin:'Planificada',segments:[],comment:'',context:'',...extra});
const event=(id,extra={})=>({id,title:'Evento de prueba',startDate:today,endDate:today,startTime:'08:00',endTime:'08:30',
  allDay:false,kind:'meeting',calendarId:'work',...extra});
const note=(id,lane,reviewDate)=>({id,title:'Nota de ejemplo',body:'',topic:'',lane,reviewDate});

test('La proyección no muta el documento y nunca devuelve perfil, tokens de Apple ni propiedades extra',()=>{
  const data={profile:{name:'secreto_nombre',photo:'secreto_foto'},goals:[{id:'g1',title:'Inventario',extra:'secreto_objetivo'}],
    tasks:[task('t1',{segments:[{start:'08:00',end:'09:00',data:'secreto_tramo'}],token:'secreto_tarea'})],
    calendars:[{id:'work',name:'Operaciones',appleToken:'secreto_feed',appleCategoryTokens:{'c:a':'secreto_suscripcion'}}],
    eventCategories:[{id:'c1',name:'Llamadas',aux:'secreto_categoria'}],
    events:[event('e1',{categoryId:'c1',feed:'secreto_evento'})],
    notes:[{...note('n1','inbox',''),key:'secreto_nota'}]};
  const original=structuredClone(data);
  const all=query(data);
  assert.equal(all.total,4);
  assert.doesNotMatch(JSON.stringify(all),/secreto/);
  assert.deepEqual(original,data);
  const ev=all.records.find(r=>r.type==='event');
  assert.equal(ev.calendar,'Operaciones');
  assert.equal(ev.category,'Llamadas');
  assert.equal(query(data,{text:'secreto'}).total,0);
  assert.equal(query(data,{type:'event'},'notes').total,0);
  assert.deepEqual(query(data,{},'tasks').records.map(r=>r.type),['task']);
});

test('Cuenta IDs únicos, suma sólo tramos cerrados y mantiene el check separado del estado',()=>{
  const data={goals:[{id:'g1',title:'Capacidad regional'}],tasks:[
    task('a',{kind:undefined,segments:[{start:'17:00',end:''},{start:'10:05',end:'10:25'},{start:'08:00',end:'09:25'}],done:true}),
    task('b',{date:'2026-11-23',goalId:'',status:'Culminado',segments:[{start:'09:00',end:'09:30'}]}),
    task('a',{done:false}),
    task('s',{kind:'space',title:'Almuerzo',goalId:'',status:'Culminado',done:true,segments:[{start:'13:00',end:'14:10'}]})
  ]};
  const {records,total,summary}=query(data);
  assert.equal(total,4);
  assert.deepEqual(summary.counts,{task:2,space:1,goal:1,note:0,event:0}); // El catálogo incluye el objetivo.
  assert.equal(summary.taskMinutes,135);
  assert.equal(summary.spaceMinutes,70);
  assert.deepEqual(summary.taskChecks,{yes:1,no:1,unrecorded:0});
  assert.deepEqual(summary.taskStatus,{'En proceso':1,'Culminado':1});
  assert.equal(summary.openSegments,1);
  assert.equal(summary.activityDays,2);
  assert.equal(summary.taskMinutesByGoal.items[0].name,'Capacidad regional');
  assert.equal(summary.taskMinutesByGoal.items[0].minutes,105);
  assert.deepEqual(records.find(r=>r.id==='a').segments.map(s=>s.start),['08:00','10:05','17:00']);
  assert.equal(query(data,{type:'task',text:'capacidad rEgIOnAL'}).total,1);
  assert.equal(query(data,{status:'abierto',type:'task'}).total,1);
  assert.equal(query(data,{status:'Culminado',type:'task'}).total,1);
});

test('Cruza medianoche y reconoce fechas finales inclusivas sólo en eventos de día completo',()=>{
  const data={events:[
    event('noche',{startDate:'2026-11-23',endTime:'00:00',categoryId:'analisis'}),
    event('extendido',{startDate:'2026-11-22',endDate:'2026-11-25'}),
    event('dia',{startDate:'2026-11-23',allDay:true,startTime:'',endTime:'',calendarId:'personal'}),
    event('prox',{startDate:'2026-11-26',endDate:'2026-11-26',reminderMinutes:0})
  ]};
  const byDay=query(data,{type:'event',from:today,to:today});
  assert.deepEqual(byDay.records.map(r=>r.id),['extendido','dia']);
  assert.equal(query(data,{id:'noche'}).records[0].category,'Análisis');
  const personal=query(data,{text:'personal',type:'event'}).records[0];
  assert.equal(personal.calendar,'Personal');
  assert.equal(personal.reminderMinutes,null);
  assert.equal(query(data,{id:'prox'}).records[0].reminderMinutes,0);
});

test('Las fechas de revisión y logro sólo se aplican a sus registros fechados',()=>{
  const data={notes:[note('n1','resolved',today),note('n2','waiting','2026-11-23'),note('n3','inbox',''),note('n4','followup','2026-11-26')],
    goals:[{id:'g1',title:'Actualizar biblioteca',status:'En curso',achievedOn:''},
      {id:'g2',title:'Migrar archivo',status:'Alcanzado',achievedOn:today,result:'Migración revisada'}]};
  assert.equal(query(data,{type:'note'}).summary.notesDue,1);
  assert.deepEqual(query(data,{type:'note',status:'en espera'}).records.map(r=>r.id),['n2']);
  assert.deepEqual(query(data,{type:'note',status:'abierto',to:today}).records.map(r=>r.id),['n2']);
  assert.equal(query(data,{type:'note',status:'abierto'}).total,3);
  assert.deepEqual(query(data,{type:'goal',from:today,to:today}).records.map(r=>r.id),['g2']);
  assert.equal(query(data,{type:'goal',status:'En curso'}).total,1);
  assert.equal(query(null).total,0);
});

test('El paginado estable conserva los totales exactos y no pierde ni repite fuentes',()=>{
  const tasks=Array.from({length:29},(_,i)=>task('a'+String(i).padStart(2,'0'),{comment:'avance '.repeat(270),segments:[{start:'11:00',end:'11:11'}]}));
  const received=[],snapshots=[];
  let offset=0;
  do {
    const page=query({tasks},{type:'task',offset});
    snapshots.push(page.summary);
    assert.equal(page.total,29);
    assert.ok(page.records.length<=8);
    assert.ok(JSON.stringify(page.records).length<=15500);
    received.push(...page.records.map(r=>r.id));
    offset=page.nextOffset;
  } while(offset!==null);
  assert.equal(new Set(received).size,29);
  assert.deepEqual(snapshots[0].taskMinutes,29*11);
  assert.deepEqual(snapshots.at(-1),snapshots[0]);
  assert.deepEqual(query({tasks:tasks.slice().reverse()},{type:'task'}).records.map(r=>r.id),received.slice(0,8));
  assert.equal(query({tasks},{offset:100}).hasMore,false);
});

test('Busca en el contenido completo y deja visible la coincidencia y cualquier recorte',()=>{
  const body='Información anterior. '.repeat(120)+'Se recibió la confirmación de Hacienda ayer. '+ 'Otro detalle. '.repeat(20);
  const data={notes:[{...note('n1','inbox',''),body}]};
  const row=query(data,{text:'hacienda confirmacion'}).records[0];
  assert.match(row.body,/confirmación de Hacienda/);
  assert.ok(row.excerptFields.includes('body'));
  assert.equal(query(data,{id:'n1'}).records[0].body,body);
  assert.equal(query(data,{text:'totalmente ausente'}).total,0);
  assert.throws(()=>query(data,{from:'2026-02-30'}),/intervalo/);
  assert.throws(()=>query(data,{from:today,to:'2020-01-01'}),/intervalo/);
  assert.throws(()=>query(data,{},'datos'),/ámbito/);
  assert.throws(()=>query(data,{type:'profile'}),/tipo/);
  assert.throws(()=>query(data,{offset:-1}),/página/);
});

test('Una consulta de catálogos puede ver calendarios vacíos y etiquetas sin cargar registros ni enlaces',()=>{
  const data={calendars:[{id:'empty',name:'Estudios',color:'#123456',appleToken:'TOKEN_PRIVADO'}],
    eventCategories:[{id:'unusada',name:'Guardia',color:'#115588',extra:'DATO_PRIVADO'}],
    categories:[{id:'old',title:'Categoría archivada',color:'#111111',archived:true,isDefault:false},
      {id:'new',title:'Categoría nueva',color:'#222222',archived:false,isDefault:true}],
    tasks:[task('t',{title:'ACTIVIDAD_PRIVADA'})],notes:[note('n','inbox','')],
    events:[event('e',{title:'EVENTO_PRIVADO'})]};
  assert.deepEqual(query(data,{type:'calendars'},'calendar'),{total:1,summary:{catalog:'calendars',entries:[{name:'Estudios',color:'#123456'}]},records:[],hasMore:false,nextOffset:null});
  const category=query(data,{type:'eventCategories',text:'guardia'});
  assert.deepEqual(category.summary.entries,[{name:'Guardia',color:'#115588'}]);
  assert.deepEqual(category.records,[]);
  assert.doesNotMatch(JSON.stringify(category),/PRIVAD/);
  assert.deepEqual(query(data,{type:'taskCategories',status:'archivadas'},'tasks').summary.entries,
    [{name:'Categoría archivada',color:'#111111',archived:true,isDefault:false}]);
  assert.equal(query(data,{type:'taskCategories'},'calendar').scopeRestricted,true);
  assert.equal(query(data,{type:'calendars'},'notes').scopeRestricted,true);
  assert.deepEqual(query({},{type:'calendars'}).summary.entries.map(x=>x.name),['Personal','Trabajo']);
  assert.equal(query({},{type:'taskCategories'}).summary.entries.find(x=>x.name==='Control de gestión').isDefault,true);
});

test('Las distribuciones del calendario se calculan sobre todo el período y no solo la primera página',()=>{
  const events=Array.from({length:20},(_,i)=>event('m'+i,{categoryId:i%2?'analisis':'gestion',calendarId:i%4?'work':'personal'}));
  const page=query({events},{type:'event',from:today,to:today});
  assert.equal(page.total,20);
  assert.equal(page.hasMore,true);
  assert.deepEqual(page.summary.eventsByCategory.items,[{name:'Análisis',count:10},{name:'Gestión',count:10}]);
  assert.deepEqual(page.summary.eventsByCalendar.items,[{name:'Trabajo',count:15},{name:'Personal',count:5}]);
});

test('Las notas de actividad de versiones anteriores se buscan sólo como texto en su ámbito',()=>{
  const doc={tasks:[task('a',{note:'Reunir anexos con la secretaría.',notes:'Reunir anexos con la secretaría.'}),task('b',{note:{private:'secreto'},notes:['excluir']})]};
  const result=query(doc,{text:'secretaria'},'tasks');
  assert.equal(result.total,1);
  assert.equal(result.records[0].notes,'Reunir anexos con la secretaría.');
  assert.equal(query(doc,{text:'secretaria'},'notes').total,0);
  assert.equal(query(doc,{text:'excluir'}).total,0);
});
