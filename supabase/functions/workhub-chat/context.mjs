import { viewPredicate } from './view-filter.mjs';

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
export function matchesDates(row,from,to) {
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
// Las equivalencias recuperan menciones. El estado vigente se contrasta después con cada fuente.
const vocabulary = [
  ['informe','informes','reporte','reportes'],
  ['reunion','reuniones','meeting','meetings'],
  ['correo','correos','email','emails'],
  ['archivo adjunto','archivos adjuntos','adjunto','adjuntos','anexo','anexos'],
  ['estados financieros','eeff','ee ff'],
  ['representante de los obligacionistas','representante de obligacionistas','ro'],
  ['tipo de cambio','tc'],
  ['en espera','sin respuesta','a la espera','esperando respuesta','pendiente de respuesta','pendientes de respuesta','aun no responden'],
  ['pendiente','pendientes','por hacer','falta completar','falta confirmar','por confirmar','queda por'],
  ['avance','avances','progreso','progresos'],
  ['bloqueo','bloqueos','bloqueado','bloqueada','impedimento','impedimentos'],
  ['solicitado','solicitada','se solicito','solicite','se pidio','se requirio'],
  ['entregado','entregada','se entrego','se remitio','se envio'],
  ['resuelto','resuelta','resueltos','resueltas','se resolvio','subsanado','subsanada','se subsano'],
  ['seguimiento','dar seguimiento','hacer seguimiento','follow up','followup']
];
const equivalents = new Map(vocabulary.flatMap(group=>group.map(term=>[term,group])));
// Señales para consultas amplias. Buscar «solicitado» no implica encontrar «resuelto» ni inferir un desenlace.
const signals = new Map([
  ['seguimiento', ['en espera','sin respuesta','a la espera','se solicito','se pidio','por confirmar','se recibio','se resolvio']],
  ['avance', ['se preparo','se reviso','se actualizo','se completo','se entrego','se remitio','se envio']],
  ['pendiente', ['en espera','sin respuesta','a la espera','por atender','falta revisar','pendiente de respuesta']]
]);
// El propósito debe acompañar un envío o una solicitud en la misma oración.
// Una mención identifica una fuente candidata, sin establecer si sigue esperando respuesta.
const sentForReview=/\b(?:se (?:remitio|envio|derivo|compartio|presento)|remiti|envie|derive|comparti|enviado|enviada|remitido|remitida)\b(?: [\p{L}\p{N}]+){0,20}? (para (?:su |la |una )?(?:validacion|revision|aprobacion|conformidad|visto bueno)|para (?:que (?:la |lo |se )?)?(?:revise|revisen|valide|validen|apruebe|aprueben))\b/u;
const requestedReply=/\b((?:se (?:solicito|pidio|requirio)|solicite|pedi) (?:una |la |su )?(?:respuesta|confirmacion|validacion|aprobacion|revision|conformidad|visto bueno))\b/u;
function reviewSignal(value) {
  for (const clause of value.split(/[.!?;\n]+/)) {
    const text=words(clause);
    const hit=sentForReview.exec(text) || requestedReply.exec(text);
    if (hit) return hit[1];
  }
  return '';
}
const phraseLengths = [...new Set([...equivalents.keys()].map(term=>term.split(' ').length))].sort((a,b)=>b-a);
const insignificant = new Set('a al de del el la las los un una unos unas en para por con y o que cual cuales'.split(' '));
const searchFields = {
  title:6, goal:5, context:5, comment:5, body:5, notes:5, topic:4, result:4, description:4,
  category:3, calendar:3, status:2, priority:2, origin:2, kind:2, location:2, id:1
};

function searchGroups(tokens) {
  const groups = new Map();
  for (let i=0;i<tokens.length;) {
    let term=tokens[i],length=1;
    for (const size of phraseLengths) {
      if (size===1 || i+size>tokens.length) continue;
      const phrase=tokens.slice(i,i+size).join(' ');
      if (equivalents.has(phrase)) {term=phrase;length=size;break;}
    }
    i+=length;
    if (insignificant.has(term)) continue;
    const variants=equivalents.get(term)||[term];
    const reviewCandidates=['en espera','seguimiento','pendiente'].includes(variants[0]);
    groups.set(term,{term,reviewCandidates,alternatives:[...new Set([...variants,...(signals.get(variants[0])||[])])]});
  }
  // Una búsqueda compuesta sólo por artículos no debe devolver todo el documento.
  return groups.size ? [...groups.values()] : [...new Set(tokens)].map(term=>({term,alternatives:[term]}));
}

function searchVariants(terms,alternatives) {
  if (!terms.length) return [];
  const primary=terms.join(' '), seen=new Set([primary]);
  const variants=[{text:primary,terms,groups:searchGroups(terms)}];
  for (const value of array(alternatives)) {
    const text=words(str(value).slice(0,300));
    const tokens=text.split(' ');
    if (!text || seen.has(text) || tokens.every(term=>insignificant.has(term))) continue;
    seen.add(text);
    variants.push({text,terms:tokens,groups:searchGroups(tokens)});
    if (variants.length===4) break;
  }
  return variants;
}
function searchableFields(row,lookForReview) {
  return Object.keys(searchFields).filter(key=>typeof row[key]==='string' && row[key])
    .map(key=>({key,text:' '+words(row[key])+' ',review:lookForReview ? reviewSignal(row[key]) : ''}));
}
function matchTerms(fields,groups) {
  let score=0;
  const matchedFields=new Set(),matchedEquivalents=new Set(),matchedSignals=new Set(),matchedTerms=[];
  for (const group of groups) {
    let best=0,exact=false;
    const via=new Set();
    for (const {key,text,review} of fields) {
      if (group.reviewCandidates && review) {
        best=Math.max(best,searchFields[key]+2);
        matchedFields.add(key);
        matchedSignals.add(review);
      }
      for (const alias of group.alternatives) {
        const literal=alias===group.term;
        const whole=text.includes(' '+alias+' ');
        // Los acrónimos y las equivalencias deben ser palabras completas, p. ej. RO no encuentra «proceso».
        if (!whole && !(literal && alias.length>=4 && !alias.includes(' ') && text.includes(alias))) continue;
        best=Math.max(best,searchFields[key]+(literal && whole ? 12 : whole ? 5 : 1));
        matchedFields.add(key);
        if (literal) exact=true; else via.add(alias);
      }
    }
    if (best) {
      matchedTerms.push(group.term);score+=best;
      if (!exact) for (const alias of via) matchedEquivalents.add(alias);
    }
  }
  return {score,matchedTerms,matchedFields:[...matchedFields],matchedEquivalents:[...matchedEquivalents],matchedSignals:[...matchedSignals]};
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
  // Buscar palabras completas también en el extracto evita centrar «RO» en «proceso».
  let whole=Infinity,fragment=Infinity;
  for (const term of terms) {
    // Los términos se normalizan con words(), por lo que sólo contienen letras, números y espacios.
    const phrase=term.split(' ').join('[^\\p{L}\\p{N}]+');
    const hit=new RegExp('(?:^|[^\\p{L}\\p{N}])('+phrase+')(?=$|[^\\p{L}\\p{N}])','u').exec(folded);
    if (hit) whole=Math.min(whole,hit.index+hit[0].length-hit[1].length);
    else if (term.length>=4) {
      const pos=folded.indexOf(term);
      if (pos>=0) fragment=Math.min(fragment,pos);
    }
  }
  const anchor=Number.isFinite(whole) ? whole : Number.isFinite(fragment) ? fragment : 0;
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
function readCatalog(doc,type,variants,status,scope,offset) {
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
    const variant=variants.find(candidate=>candidate.terms.every(term=>normalized.includes(term)));
    if (!name || (variants.length && !variant)) continue;
    const color=/^#[\da-f]{6}$/i.test(str(item.color)) ? item.color : '';
    const entry={name:name.slice(0,220),color};
    if (variant && variant!==variants[0]) entry.matchedQuery=variant.text;
    if (isTask) {
      entry.archived=item.archived===true;
      entry.isDefault=item.isDefault===true;
      if (status && !(entry.archived ? ['archivado','archivada','archivadas'] : ['activo','activa','activas']).includes(status)) continue;
    }
    entries.push(entry);
  }
  entries.sort((a,b)=>Number(!!a.matchedQuery)-Number(!!b.matchedQuery) || orderByText(a.name,b.name));
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
  const variants=searchVariants(terms,query.alternatives), matches=new Map(), partialTerms=new Map();
  const lookForReview=variants.some(variant=>variant.groups.some(group=>group.reviewCandidates));
  const wants = kind => allowed.includes(kind) && (type==='all' || kind===type);
  const doc=document || {}, rows=[], seen=new Map();
  if (catalogScopes.has(type)) return readCatalog(doc,type,variants,status,scope,offset);
  if (query.selection?.kind==='calendar' && query.selection.mode==='partial') {
    return {error:'La selección de calendarios es demasiado extensa. Pide el nombre del calendario antes de calcular totales.',records:[]};
  }
  const visible = viewPredicate(query.selection,doc);
  if (type!=='all' && !allowed.includes(type)) {
    return {total:0,summary:summarize([]),records:[],hasMore:false,nextOffset:null,scopeRestricted:true};
  }
  function collect(list,kindFor,toRecord) {
    for (const item of array(list)) {
      if (!item || !str(item.id).trim() || (query.id && query.id!==item.id)) continue;
      const kind=kindFor(item);
      if (!wants(kind) || !visible(item,kind)) continue;
      if (!seen.has(kind)) seen.set(kind,new Set());
      const ids=seen.get(kind);
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      const original=toRecord(item);
      if (!matchesDates(original,from,to)) continue;
      const row=query.projectRecord ? query.projectRecord(original) : original;
      if (!row || !matchesStatus(row,status)) continue;
      if (variants.length) {
        const fields=searchableFields(row,lookForReview);
        let best=null;
        for (const variant of variants) {
          const match=matchTerms(fields,variant.groups);
          const primary=variant===variants[0];
          if (match.matchedTerms.length!==variant.groups.length) {
            if (primary && match.matchedTerms.length) addCount(partialTerms,match.matchedTerms.join(' '));
            continue;
          }
          // Compara la calidad por concepto, sin favorecer una reformulación sólo porque sea más larga.
          match.score/=variant.groups.length;
          if (!best || match.score>best.score) {
            if (!primary) match.matchedQuery=variant.text;
            best=match;
          }
          if (primary) break;
        }
        if (!best) continue;
        matches.set(row,best);
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
  const byRelevance=variants.length && (!query.order || query.order==='relevance');
  rows.sort((a,b)=>{
    if (byRelevance) {
      const left=matches.get(a),right=matches.get(b);
      const direct=Number(!!left.matchedQuery)-Number(!!right.matchedQuery);
      if (direct || left.score!==right.score) return direct || right.score-left.score;
    }
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    return direction*(orderByText(a.date,b.date) || orderByText(a.startTime || a.segments?.[0]?.start || '',b.startTime || b.segments?.[0]?.start || ''))
      || orderByText(a.type,b.type) || orderByText(a.title,b.title) || orderByText(a.id,b.id);
  });
  const records=[];
  let chars=0;
  for (const row of rows.slice(offset,offset+pageSize)) {
    const match=matches.get(row);
    const preview=present(row,match ? [...match.matchedTerms,...match.matchedEquivalents,...match.matchedSignals] : terms,!!query.id && query.detail!==false);
    if (match) {
      preview.matchedFields=match.matchedFields;
      if (match.matchedEquivalents.length) preview.matchedEquivalents=match.matchedEquivalents;
      if (match.matchedSignals.length) preview.matchedSignals=match.matchedSignals;
      if (match.matchedQuery) preview.matchedQuery=match.matchedQuery;
    }
    const length=JSON.stringify(preview).length;
    if (records.length && chars+length>pageCharacters) break;
    records.push(preview);
    chars+=length;
  }
  const hasMore=offset+records.length<rows.length;
  const result={total:rows.length,summary:summarize(rows),records,hasMore,nextOffset:hasMore ? offset+records.length : null};
  if (!rows.length && variants.length && !query.id) {
    const alternatives=[...partialTerms].sort((a,b)=>b[1]-a[1] || orderByText(a[0],b[0])).slice(0,3);
    result.suggestions=alternatives.length ? alternatives.map(([text])=>({text,reason:'partial_terms'}))
      : [{text:'',reason:'review_scope_dates_or_search_without_terms'}];
  }
  return result;
}

// Reutiliza las proyecciones y el ámbito de consultar para la lectura transversal de planificación.
export function* planningRows(document, {scope='all',selection,from,to,today,includeCurrent=false}) {
  const allowed=scopeTypes.get(scope);
  if (!allowed) throw new Error('El ámbito de consulta no es válido.');
  if (selection?.kind==='calendar' && selection.mode==='partial') return;
  const doc=document || {}, visible=viewPredicate(selection,doc);
  const goals=labelMap(doc.goals,'title');
  const calendars=labelMap(doc.calendars ?? defaultCalendars,'name');
  const categories=labelMap(doc.eventCategories ?? defaultEventCategories,'name');
  const seen=new Set();
  function* collect(items,kindFor,project) {
    for (const item of array(items)) {
      if (!item || !str(item.id).trim()) continue;
      const kind=kindFor(item);
      if (!allowed.includes(kind) || !visible(item,kind)) continue;
      const identity=kind+'\0'+item.id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const row=project(item);
      const current=includeCurrent && ((kind==='note' && item.lane!=='resolved' && (!row.date || row.date<=today)) ||
        (kind==='goal' && !row.date && row.status==='En curso'));
      if (current || matchesDates(row,from,to)) yield row;
    }
  }
  if (allowed.includes('task') || allowed.includes('space')) {
    yield* collect(doc.tasks,item=>item.kind==='space'?'space':'task',item=>({...taskRecord(item,goals),goalId:str(item.goalId)}));
  }
  if (allowed.includes('event')) yield* collect(doc.events,()=>'event',item=>eventRecord(item,calendars,categories));
  if (allowed.includes('goal')) yield* collect(doc.goals,()=>'goal',goalRecord);
  if (allowed.includes('note')) yield* collect(doc.notes,()=>'note',item=>noteRecord(item,today));
}
