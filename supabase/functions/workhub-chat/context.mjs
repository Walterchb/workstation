// Proyección de solo lectura del documento obtenido con la sesión del usuario.
// Ninguna colección ni objeto del documento se serializa directamente para el modelo.
const scopeTypes = new Map([
  ['all', ['task', 'space', 'goal', 'note', 'event']], ['tasks', ['task', 'space']],
  ['goals', ['goal']], ['notes', ['note']], ['calendar', ['event']]
]);
const lanes = new Map([['inbox', 'Entrada'], ['followup', 'Por revisar'], ['waiting', 'En espera'], ['resolved', 'Resueltas']]);
const defaultCalendars = [{id:'work',name:'Trabajo',color:'#287B74'}, {id:'personal',name:'Personal',color:'#8153A2'}];
const defaultEventCategories = [
  {id:'gestion',name:'Gestión',color:'#2D7974'}, {id:'analisis',name:'Análisis',color:'#4876AC'},
  {id:'coordinacion',name:'Coordinación',color:'#8566A7'}, {id:'tramites',name:'Trámites',color:'#B16F3C'}
];
const defaultTaskCategories = [
  {title:'Control de gestión',color:'#087F79',isDefault:true}, {title:'Mercado de capitales',color:'#3067B6'},
  {title:'Coordinación',color:'#8759A4'}, {title:'Otros',color:'#B16B32'}
];
const catalogScopes=new Map([['calendars','calendar'],['eventCategories','calendar'],['taskCategories','tasks']]);
const pageSize = 8, pageCharacters = 15000;
const str = value => typeof value === 'string' ? value : '';
const array = value => Array.isArray(value) ? value : [];
const words = value => str(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const orderByText = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const labelMap = (items, key) => new Map(array(items).filter(item => item && typeof item.id === 'string')
  .map(item => [item.id,str(item[key])]));
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(value))) return '';
  const stamp = new Date(value+'T12:00:00Z');
  return Number.isFinite(stamp.valueOf()) && stamp.toISOString().slice(0,10) === value ? value : '';
}
const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str(value));
const minute = time => Number(time.slice(0,2))*60 + Number(time.slice(3));
function base(item,type,day) {
  return {type,id:item.id,title:str(item.title),date:date(day)};
}
function taskRecord(item,goals) {
  const space = item.kind === 'space';
  const record = base(item,space ? 'space' : 'task',item.date);
  const segments = [];
  let closedMinutes = 0;
  for (const seg of array(item.segments)) {
    if (!seg || !validTime(seg.start)) continue;
    if (seg.end !== '' && (!validTime(seg.end) || seg.end <= seg.start)) continue;
    segments.push({start:seg.start,end:seg.end});
    if (seg.end) closedMinutes += minute(seg.end) - minute(seg.start);
  }
  segments.sort((a,b)=>orderByText(a.start,b.start));
  Object.assign(record,{context:str(item.context),comment:str(item.comment),status:str(item.status),segments,closedMinutes});
  const legacyNotes=[...new Set([str(item.note),str(item.notes)].filter(value=>value && value!==record.comment))];
  if (legacyNotes.length) record.notes=legacyNotes.join('\n');
  if (!space) Object.assign(record,{goal:goals.get(item.goalId) || '',category:str(item.category),
    priority:str(item.priority),origin:str(item.origin),done:typeof item.done === 'boolean' ? item.done : null});
  return record;
}
function noteRecord(item,today) {
  const record = base(item,'note',item.reviewDate);
  return Object.assign(record,{body:str(item.body),topic:str(item.topic),status:lanes.get(item.lane) || '',
    reviewDate:record.date,reviewDue:!!record.date && !!today && record.date <= today && item.lane !== 'resolved'});
}
function goalRecord(item) {
  const record = base(item,'goal',item.achievedOn);
  return Object.assign(record,{description:str(item.description),result:str(item.result),status:str(item.status),achievedOn:record.date});
}
function eventRecord(item,calendars,categories) {
  const record = base(item,'event',item.startDate);
  return Object.assign(record,{startDate:record.date,endDate:date(item.endDate) || record.date,
    allDay:item.allDay === true,startTime:validTime(item.startTime) ? item.startTime : '',
    endTime:validTime(item.endTime) ? item.endTime : '',kind:item.kind === 'meeting' ? 'Reunión' : 'Evento',
    calendar:calendars.get(item.calendarId) || '',category:categories.get(item.categoryId) || '',
    location:str(item.location),description:str(item.description),
    reminderMinutes:Number.isSafeInteger(item.reminderMinutes) && item.reminderMinutes >= 0 ? item.reminderMinutes : null});
}
function matchesDates(row,from,to) {
  if (!from && !to) return true;
  if (!row.date || (to && row.date > to)) return false;
  if (!from) return true;
  if (row.type !== 'event') return row.date >= from;
  // El día final de un evento a medianoche solo está incluido si el evento es de día completo.
  return row.endDate > from || (row.endDate === from && (row.allDay || row.endTime !== '00:00'));
}
function matchesStatus(row,status) {
  if (!status) return true;
  const actual=words(row.status);
  if (['abierto','abierta','abiertos','abiertas','open'].includes(status)) {
    if (row.type === 'note') return !!actual && actual !== 'resueltas';
    if (row.type === 'goal') return actual === 'en curso';
    return actual === 'pendiente' || actual === 'en proceso';
  }
  return actual === status;
}
function searchText(row) {
  // Ni identificadores externos ni metadatos ajenos al registro participan en la búsqueda.
  return words([row.id,row.title,row.context,row.comment,row.notes,row.goal,row.body,row.topic,row.status,row.description,
    row.result,row.category,row.priority,row.origin,row.calendar,row.kind,row.location].filter(Boolean).join(' '));
}
function addCount(map,key,amount=1) { map.set(key,(map.get(key) || 0)+amount); }
function grouped(values,unit) {
  const ranked=[...values].sort((a,b)=>b[1]-a[1] || orderByText(a[0],b[0]));
  return {items:ranked.slice(0,10).map(([name,total])=>({name:name.slice(0,220),[unit]:total})),otherGroups:Math.max(0,ranked.length-10)};
}
function summarize(rows) {
  const types={task:0,space:0,goal:0,note:0,event:0}, checks={yes:0,no:0,unrecorded:0};
  const statuses=new Map(), lanes=new Map(), goals=new Map(), categories=new Map();
  const eventCategories=new Map(),calendars=new Map();
  let taskMinutes=0,spaceMinutes=0,firstDate='',lastDate='',openSegments=0,notesDue=0;
  const activityDates=new Set();
  for (const row of rows) {
    types[row.type]++;
    if (row.date && (!firstDate || row.date < firstDate)) firstDate=row.date;
    if (row.date > lastDate) lastDate=row.date;
    if (row.type==='task' || row.type==='space') {
      if (row.date) activityDates.add(row.date);
      openSegments+=row.segments.filter(s=>!s.end).length;
    }
    if (row.type==='task') {
      taskMinutes+=row.closedMinutes;
      addCount(statuses,row.status || 'Sin estado');
      checks[row.done===null ? 'unrecorded' : row.done ? 'yes' : 'no']++;
      addCount(goals,row.goal || 'Sin objetivo general',row.closedMinutes);
      addCount(categories,row.category || 'Sin categoría',row.closedMinutes);
    } else if (row.type==='space') spaceMinutes+=row.closedMinutes;
    else if (row.type==='event') {
      addCount(eventCategories,row.category || 'Sin categoría');
      addCount(calendars,row.calendar || 'Sin calendario');
    }
    else if (row.type==='note') {
      addCount(lanes,row.status || 'Sin columna');
      if (row.reviewDue) notesDue++;
    }
  }
  return {counts:types,taskMinutes,spaceMinutes,taskStatus:Object.fromEntries(statuses),taskChecks:checks,openSegments,
    noteLanes:Object.fromEntries(lanes),notesDue,activityDays:activityDates.size,firstDate,lastDate,
    taskMinutesByGoal:grouped(goals,'minutes'),taskMinutesByCategory:grouped(categories,'minutes'),
    eventsByCategory:grouped(eventCategories,'count'),eventsByCalendar:grouped(calendars,'count')};
}
function excerpt(value,limit,terms) {
  if (value.length <= limit) return value;
  const folded = value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const anchor=terms.map(term=>folded.indexOf(term)).filter(pos=>pos>=0).sort((a,b)=>a-b)[0] ?? 0;
  const start=Math.max(0,Math.min(value.length-limit,anchor-Math.floor(limit/4)));
  return (start ? '…' : '') + value.slice(start,start+limit) + (start+limit<value.length ? '…' : '');
}
function present(row,terms,detail) {
  const result={}, excerptFields=[];
  for (const [key,value] of Object.entries(row)) {
    if (key==='segments') {
      result.segments=value.slice(0,24);
      if (value.length>24) { result.totalSegments=value.length; excerptFields.push(key); }
    } else if (typeof value==='string' && key!=='id') {
      const isLong=['body','description','result','context','comment','notes'].includes(key);
      const detailLimit=row.type==='task' || row.type==='space' ? 4500 : 6000;
      const limit=isLong ? (detail ? detailLimit : 800) : 240;
      result[key]=excerpt(value,limit,terms);
      if (value.length>limit) excerptFields.push(key);
    } else result[key]=value;
  }
  if (excerptFields.length) result.excerptFields=excerptFields;
  return result;
}
function readCatalog(doc,type,terms,status,scope,offset) {
  const restricted=scope!=='all' && scope!==catalogScopes.get(type);
  const summary={catalog:type,entries:[]};
  if (restricted) return {total:0,summary,records:[],hasMore:false,nextOffset:null,scopeRestricted:true};
  const isTask=type==='taskCategories';
  const source=isTask ? doc.categories ?? defaultTaskCategories : type==='calendars' ?
    doc.calendars ?? defaultCalendars : doc.eventCategories ?? defaultEventCategories;
  const entries=[];
  for (const item of array(source)) {
    if (!item) continue;
    const name=str(isTask ? item.title : item.name), normalized=words(name);
    if (!name || !terms.every(term=>normalized.includes(term))) continue;
    const color=/^#[\da-f]{6}$/i.test(str(item.color)) ? item.color : '';
    const entry={name:name.slice(0,220),color};
    if (isTask) {
      entry.archived=item.archived===true;
      entry.isDefault=item.isDefault===true;
      if (status && !(entry.archived ? ['archivado','archivada','archivadas'] : ['activo','activa','activas']).includes(status)) continue;
    }
    entries.push(entry);
  }
  entries.sort((a,b)=>orderByText(a.name,b.name));
  summary.entries=entries.slice(offset,offset+20);
  const next=offset+summary.entries.length;
  return {total:entries.length,summary,records:[],hasMore:next<entries.length,nextOffset:next<entries.length ? next : null};
}
export function queryWorkspace(document,query={},scope='all',today='') {
  const allowed=scopeTypes.get(scope);
  if (!allowed) throw new Error('El ámbito de consulta no es válido.');
  const type=query.type || 'all';
  if (type !== 'all' && !scopeTypes.get('all').includes(type) && !catalogScopes.has(type)) throw new Error('El tipo de consulta no es válido.');
  const from=date(query.from),to=date(query.to);
  if ((query.from && !from) || (query.to && !to) || (from && to && from>to)) throw new Error('Revisa el intervalo de consulta.');
  const offset=query.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset<0) throw new Error('La página de consulta no es válida.');
  const status=words(query.status),terms=words(query.text).split(' ').filter(Boolean),day=date(today);
  const wants = kind => allowed.includes(kind) && (type==='all' || kind===type);
  const doc=document || {}, rows=[], seen=new Map();
  if (catalogScopes.has(type)) return readCatalog(doc,type,terms,status,scope,offset);
  if (type!=='all' && !allowed.includes(type)) {
    return {total:0,summary:summarize([]),records:[],hasMore:false,nextOffset:null,scopeRestricted:true};
  }
  function collect(list,kindFor,toRecord) {
    for (const item of array(list)) {
      if (!item || !str(item.id).trim() || (query.id && query.id!==item.id)) continue;
      const kind=kindFor(item);
      if (!wants(kind)) continue;
      if (!seen.has(kind)) seen.set(kind,new Set());
      const ids=seen.get(kind);
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      const row=toRecord(item);
      if (!matchesDates(row,from,to) || !matchesStatus(row,status)) continue;
      if (terms.length) {
        const text=searchText(row);
        if (!terms.every(term=>text.includes(term))) continue;
      }
      rows.push(row);
    }
  }
  if (wants('task') || wants('space')) {
    const goals=labelMap(doc.goals,'title');
    collect(doc.tasks,item=>item.kind==='space'?'space':'task',item=>taskRecord(item,goals));
  }
  if (wants('goal')) collect(doc.goals,()=>'goal',goalRecord);
  if (wants('note')) collect(doc.notes,()=>'note',item=>noteRecord(item,day));
  if (wants('event')) {
    const calendars=labelMap(doc.calendars ?? defaultCalendars,'name');
    const categories=labelMap(doc.eventCategories ?? defaultEventCategories,'name');
    collect(doc.events,()=>'event',item=>eventRecord(item,calendars,categories));
  }
  const ascending=query.order==='asc' || (!query.order && from && day && from>=day);
  const direction=ascending ? 1 : -1;
  rows.sort((a,b)=>{
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    return direction*(orderByText(a.date,b.date) || orderByText(a.startTime || a.segments?.[0]?.start || '',b.startTime || b.segments?.[0]?.start || ''))
      || orderByText(a.type,b.type) || orderByText(a.title,b.title) || orderByText(a.id,b.id);
  });
  const records=[];
  let chars=0;
  for (const row of rows.slice(offset,offset+pageSize)) {
    const preview=present(row,terms,!!query.id);
    const length=JSON.stringify(preview).length;
    if (records.length && chars+length>pageCharacters) break;
    records.push(preview);
    chars+=length;
  }
  const hasMore=offset+records.length<rows.length;
  return {total:rows.length,summary:summarize(rows),records,hasMore,nextOffset:hasMore ? offset+records.length : null};
}
