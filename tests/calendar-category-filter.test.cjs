const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Las opciones se eligen mediante el mismo evento change de los radios de la interfaz.
function calendarFixture() {
  const env = {Intl,Date,document:{querySelector:()=>null}};
  env.window = env;
  for (const name of ['model','ui','calendar-model','work-calendar']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets',name+'.js'),'utf8'),env);
  }
  const day='2028-03-01', goalDay='2028-03-02';
  const state = env.JModel.empty();
  state.calendars = [{id:'hub',name:'Workhub',color:'#234567'},{id:'private',name:'Personal',color:'#532681'}];
  state.goals=[{id:'g',title:'Finanzas',color:'#076543'}];
  state.eventCategories=[{id:'g',name:'Finanzas',color:'#654321'}];
  const base={startDate:day,endDate:day,calendarId:'hub',kind:'event',title:'Evento',allDay:false,startTime:'08:00',endTime:'09:00'};
  state.events=[{...base,id:'uno',categoryId:'g'},{...base,id:'dos',calendarId:'private',categoryId:'g'},{...base,id:'libre'}];
  const task={id:'real',title:'Actividad',goalId:'g',date:goalDay,segments:[{start:'11:00',end:'12:00'}]};
  state.tasks=[task,{...task,id:'huérfana',goalId:'ya-eliminado'}];
  const view = {querySelector:()=>null};
  const stage = {querySelector:()=>view,querySelectorAll:()=>[]};
  const cal=env.JWorkCalendar;
  const ctx={user:{id:'ana'},state,date:day,canEdit:()=>false,render:()=>cal.render(stage,ctx)};
  ctx.render();
  function choose(id) {
    view.onchange({target:{hasAttribute:attr=>attr==='data-wc-category-filter',dataset:{wcCategoryFilter:id}}});
  }
  const ids=mode=>Array.from(cal.visibleEvents(state,mode),e=>e.sourceTaskId || e.id).sort();
  return {ctx,choose,ids,cal,stage,state};
}

test('una categoría filtra eventos de distintos calendarios, mes limita Workhub y objetivo homónimo conserva su identidad',()=>{
  const {choose,ids,state,cal,stage}=calendarFixture();
  assert.equal(cal.selectedCategory(state),null);
  assert.match(stage.innerHTML,/data-wc-category-filter="" checked/);
  assert.doesNotMatch(stage.innerHTML,/data-wc-category-edit=/);
  choose('g');
  assert.deepEqual(ids('week'),['dos','uno']);
  assert.deepEqual(ids('month'),['uno']);
  choose('goal:g');
  assert.deepEqual(ids('day'),['real']);
  assert.deepEqual(ids('month'),[]);
  assert.equal(cal.selectedCategory(state).kind,'goal');
  assert.match(stage.innerHTML,/data-wc-category-filter="goal:g" checked/);
  choose('source:uncategorized');
  assert.deepEqual(ids('week'),['huérfana','libre']);
  choose('');
  assert.equal(ids('day').length,5);
});

test('el filtro sigue el ID al renombrar y se limpia tras eliminar o cambiar de usuario',()=>{
  const {choose,ids,state,cal,ctx,stage}=calendarFixture();
  ctx.canEdit=()=>true;
  choose('g');
  state.eventCategories[0].name='Otro nombre';
  ctx.render();
  assert.equal(cal.selectedCategory(state).name,'Otro nombre');
  assert.match(stage.innerHTML,/<\/label><button[^>]+data-wc-category-edit="g"/);
  state.eventCategories=[];
  ctx.render();
  assert.equal(cal.selectedCategory(state),null);
  choose('goal:g');
  ctx.user={id:'luis'};
  ctx.render();
  assert.equal(cal.selectedCategory(state),null);
  assert.equal(ids('month').length,2);
});
