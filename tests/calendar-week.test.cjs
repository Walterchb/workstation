const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const browser = vm.createContext({Intl, Date});
browser.window=browser;
for (const script of ['ui','model','calendar-model','calendar-day','calendar-week']) {
  const file=path.join(__dirname,'../assets',script+'.js');
  vm.runInContext(fs.readFileSync(file,'utf8'),browser,{filename:file});
}
const {JCalendarWeek:week,JCalendarDay:day,JCalendarModel:calendar}=browser;
test('la semana contiene todos los días de lunes a domingo, incluso si cruza de año o febrero bisiesto',()=>{
  assert.deepEqual(Array.from(week.days('2027-01-03')),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.deepEqual({...week.range('2024-02-29')},{start:'2024-02-26',end:'2024-03-03'});
  assert.equal(week.shift('2027-01-03',1),'2027-01-10');
  assert.equal(week.shift('2027-01-04',-1),'2026-12-28');
});
test('la primera y última semana respetan las fechas permitidas por el editor',()=>{
  assert.equal(week.range('0001-01-01').start,'0001-01-01');
  assert.equal(week.shift('0001-01-01',-1),'');
  assert.equal(week.range('9999-12-31').end,'9999-12-31');
  assert.equal(week.shift('9999-12-26',1),'9999-12-31');
  assert.equal(week.shift('9999-12-31',1),'');
  assert.equal(week.days('9999-12-31').filter(Boolean).length,5);
});
test('Semana y Día comparten la distribución de tramos, los cruces de medianoche y la hora de creación',()=>{
  const dayKey='2027-01-03';
  const overnight={title:'Reunión',startDate:'2027-01-02',endDate:dayKey,startTime:'23:00',endTime:'00:30'};
  const next={title:'Seguimiento',startDate:dayKey,endDate:dayKey,startTime:'00:15',endTime:''};
  const entries=day.placeEvents([overnight,next].filter(e=>calendar.occursOn(e,dayKey)),dayKey);
  assert.deepEqual(Array.from(entries,i=>[i.start,i.end,i.column,i.columns]),[[0,30,0,2],[15,15,1,2]]);
  assert.equal(calendar.occursOn({...overnight,endTime:'00:00'},dayKey),false);
  assert.deepEqual({...day.slotDefaults(dayKey,1410)},{startDate:dayKey,endDate:'2027-01-04',startTime:'23:30',endTime:'00:30',allDay:false});
});
