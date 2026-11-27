import { matchesDates, planningRows } from './context.mjs';

const listTypes = ['task','space','event','note','goal'];
const laxText = value => typeof value === 'string' ? value : '';
const normalized = value => laxText(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const iso = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const earlier = (a,b) => a < b ? a : b;
function shift(day,n) {
  const stamp = new Date(day+'T12:00:00Z');
  stamp.setUTCDate(stamp.getUTCDate()+n);
  return stamp.toISOString().slice(0,10);
}
function describe(result,key,raw,limit) {
  if (typeof raw !== 'string' || !raw.trim()) return;
  const text=raw.trim();
  if (text.length<=limit) result[key]=text;
  else {
    // Conserva el comienzo del registro y el desenlace o siguiente paso al final.
    const head=Math.floor(limit*.55);
    result[key]=text.slice(0,head)+' … '+text.slice(-(limit-head));
    (result.fieldsTruncated ||= []).push(key);
  }
}

// Una entrada de agenda futura acredita programación. No comunica como hechos su comentario o check.
export function planningAppointment(row) {
  const result={type:row.type,id:row.id,date:row.date};
  describe(result,'title',row.title,200);
  if (!result.title) result.title='Sin título';
  for (const key of ['goal','category','priority','calendar','kind','startDate','endDate','startTime','endTime','reviewDate']) {
    describe(result,key,row[key],125);
  }
  if (typeof row.allDay==='boolean') result.allDay=row.allDay;
  if (Array.isArray(row.segments)) {
    result.segments=row.segments.slice(0,16).map(({start,end})=>({start,end}));
    if (row.segments.length>16 || row.totalSegments>16) (result.fieldsTruncated ||= []).push('segments');
  }
  return result;
}

function evidence(row) {
  const result=planningAppointment(row);
  for (const [key,limit] of [['status',90],['context',350],['comment',850],['notes',450],
    ['topic',130],['body',550],['result',550],['description',400]]) describe(result,key,row[key],limit);
  if (typeof row.done==='boolean') result.done=row.done;
  return result;
}
function compareTime(a,b) {
  return compare(a.date,b.date) || compare(a.segments?.[0]?.start || a.startTime || '',b.segments?.[0]?.start || b.startTime || '') ||
    compare(a.type,b.type) || compare(a.id,b.id);
}
function counts(rows) {
  const byType=Object.fromEntries(listTypes.map(key=>[key,0]));
  for (const row of rows) byType[row.type]++;
  return byType;
}
function groupKey(row) {
  // Es una llave de muestreo, nunca una afirmación de continuidad entre entregables.
  return JSON.stringify([row.type,...[row.goalId || row.goal,row.title,row.context,row.calendar,row.topic].map(normalized)]);
}
function narrative(row) {
  return [row.comment,row.notes,row.body,row.result,row.description].filter(Boolean).join(' ');
}
function weight(row) {
  const proof=narrative(row);
  const wording=normalized(proof+' '+laxText(row.context));
  const next=/\b(?:pendiente\w*|espera\w*|solicit\w*|envi\w*|recib\w*|plazo\w*|vence\w*|resolv\w*|resuelt\w*|bloque\w*|falta\w*|confirm\w*|aprob\w*|entreg\w*|remiti\w*|revisio\w*|deadline|await\w*|sent|approved)\b/.test(wording);
  return Math.min(36,Math.sqrt(proof.length)*2) + (next?7:0) + (normalized(row.priority)==='alta'?10:0) +
    (row.status==='En proceso'?4:0) + (row.type==='task'?3:0);
}

// Primero da cabida a distintas jornadas y contextos, después a hitos más específicos.
// La lista final conserva el orden de horas y mantiene como «sin horario» los registros sin tramo.
function chooseHistory(rows) {
  const groups=new Map(),dates=new Map(),unique=new Map(),weights=new Map();
  const sorted=rows.slice().sort(compareTime);
  const compareRank=(a,b)=>weights.get(b)-weights.get(a) || compareTime(b,a);
  for (const row of sorted) {
    weights.set(row,weight(row));
    const key=groupKey(row), day=dates.get(row.date);
    if (!day || compareRank(row,day)<0) dates.set(row.date,row);
    const group=groups.get(key) || {best:row,days:new Set(),latestEvidence:null,latest:row};
    if (compareRank(row,group.best)<0) group.best=row;
    group.days.add(row.date);
    group.latest=row;
    if (narrative(row)) group.latestEvidence=row;
    groups.set(key,group);
    unique.set(JSON.stringify([key,row.status,row.done,normalized(narrative(row))]),row);
  }
  const representatives=[...groups.values()].sort((a,b)=>compareRank(a.best,b.best));
  const selected=new Map();
  let size=0;
  function keep(seed) {
    const group=groups.get(groupKey(seed));
    // Un comentario largo antiguo nunca viaja solo si posteriormente hubo una respuesta breve.
    // También conserva el último registro si cambió el estado de ejecución.
    const tail=group.latestEvidence || group.latest;
    const needed=new Set([tail,group.best,seed]);
    if (group.latest.status!==tail.status || group.latest.done!==tail.done) needed.add(group.latest);
    const additions=[...needed].filter(row=>!selected.has(row)).map(row=>[row,evidence(row)]);
    const charge=additions.reduce((sum,[,value])=>sum+JSON.stringify({...value,id:undefined,_source:9999}).length+1,0);
    if (selected.size+additions.length>58 || size+charge>22500) return;
    for (const [row,value] of additions) selected.set(row,value);
    size+=charge;
  }
  for (const group of representatives.filter(g=>g.days.size>1 && g.latestEvidence).slice(0,10)) keep(group.best);
  const samples=[...dates.values()];
  // En rangos extensos conserva una muestra de jornadas del principio, el medio y el final.
  for (let i=0,n=Math.min(10,samples.length);i<n;i++) {
    keep(samples[n===1?0:Math.round(i*(samples.length-1)/(n-1))]);
  }
  for (const group of representatives) keep(group.best);
  for (const row of [...unique.values()].sort(compareRank)) keep(row);
  return [...selected.values()];
}
function fit(rows,project,maxRows,maxChars) {
  const values=[];
  let size=0;
  for (const row of rows) {
    if (values.length===maxRows) break;
    const value=project(row);
    const charge=JSON.stringify({...value,id:undefined,_source:9999}).length+1;
    if (size+charge>maxChars) continue;
    values.push(value);size+=charge;
  }
  return values;
}
function annotated(records,citeRecord) {
  return records.sort(compareTime).map(row=>citeRecord(row));
}
function recurring(rows,citeRecord) {
  const buckets=new Map();
  for (const row of rows) {
    if (!['task','space'].includes(row.type)) continue;
    const key=groupKey(row);
    if (!buckets.has(key)) buckets.set(key,new Map());
    const days=buckets.get(key), previous=days.get(row.date);
    // Una fecha con varias filas del mismo contexto cuenta como una sola observación;
    // si tiene tramos, conserva un ejemplo con hora para distinguir ejecución de arrastre.
    if (!previous || (row.segments.length && !previous.segments.length) ||
        (!!row.segments.length===!!previous.segments.length && compareTime(row,previous)<0)) days.set(row.date,row);
  }
  const repeated=[...buckets.values()].filter(days=>days.size>=2).sort((a,b)=>b.size-a.size ||
    compare([...a.keys()].sort()[0],[...b.keys()].sort()[0]) || compareTime([...a.values()][0],[...b.values()][0]));
  const patterns=[];
  for (const days of repeated.slice(0,12)) {
    const observations=[...days.values()].sort(compareTime);
    const last=observations.at(-1);
    const pattern={type:last.type,dayCount:days.size,scheduledDays:observations.filter(row=>row.segments.length).length};
    describe(pattern,'title',last.title,125);describe(pattern,'goal',last.goal,80);describe(pattern,'context',last.context,100);
    pattern.distinctDays=days.size;
    pattern.datesWithTime=observations.filter(row=>row.segments.length).length;
    pattern.examples=observations.slice(-5).map(row=>{
      const {date,_source}=citeRecord(planningAppointment(row));
      const sample={date,_source};
      if (row.segments.length) sample.slot=row.segments[0];
      return sample;
    });
    patterns.push(pattern);
  }
  return {patterns,omittedPatterns:repeated.length-patterns.length};
}

export function buildPlanningContext(document,options,citeRecord) {
  const {today,targetFrom,targetTo=targetFrom,scope='all',selection,historyFrom,historyTo}=options;
  if (![today,targetFrom,targetTo,...[historyFrom,historyTo].filter(x=>x!==undefined)].every(iso) || targetFrom>targetTo)
    throw new Error('Período de planificación inválido.');
  const cutoff=earlier(earlier(today,shift(targetFrom,-1)),historyTo || today);
  const weekStart=shift(cutoff,-6);
  const scanFrom=historyFrom || shift(cutoff,-27);
  const includeCurrent=targetFrom>=today;
  const rows=[...planningRows(document,{scope,selection,from:earlier(scanFrom,targetFrom),to:targetTo,today,includeCurrent})];
  const target=rows.filter(row=>row.type!=='goal' && matchesDates(row,targetFrom,targetTo));
  const historical=rows.filter(row=>row.type!=='note' && matchesDates(row,scanFrom,cutoff) && scanFrom<=cutoff);
  // Si sólo hubo una jornada observada, busca la anterior para disponer de contexto. Fechas
  // explícitas tienen prioridad. Las semanas sin registros no equivalen a semanas sin trabajo.
  let from=historyFrom || weekStart;
  if (!historyFrom) {
    const recentDays=new Set(historical.filter(row=>row.date>=weekStart).map(row=>row.date));
    if (recentDays.size<2) {
      const priorDays=[...new Set(historical.map(row=>row.date).filter(day=>day<weekStart))].sort().slice(-5);
      from=priorDays.length ? priorDays[0] : (recentDays.size ? weekStart : scanFrom);
      if (from<scanFrom) from=scanFrom;
    }
  }
  const history=historical.filter(row=>matchesDates(row,from,cutoff));
  const days=new Map();
  for (const row of history) {
    const day=row.date<from ? from : row.date;
    days.set(day,(days.get(day)||0)+1);
  }
  const byDate=Object.fromEntries([...days].sort(([a],[b])=>compare(a,b)).slice(-31));
  const fixed=row=>row.type==='event' || !!row.segments?.length;
  const appointments=fit(target.slice().sort((a,b)=>Number(fixed(b))-Number(fixed(a)) || compareTime(a,b)),row=>
    row.date===today && targetFrom===today && row.type==='task' ? evidence(row) : planningAppointment(row),24,6500);
  const selected=chooseHistory(history);
  const patterns=recurring(history,citeRecord);
  const result={
    scope,
    target:{from:targetFrom,to:targetTo,total:target.length,counts:counts(target),records:annotated(appointments,citeRecord),omitted:target.length-appointments.length},
    history:{from,to:cutoff,total:history.length,counts:counts(history),byDate,observedDays:days.size,omittedDates:Math.max(0,days.size-31),records:annotated(selected,citeRecord),omitted:history.length-selected.length,
      recurring:patterns.patterns,omittedPatterns:patterns.omittedPatterns}
  };
  if (includeCurrent && (scope==='all' || scope==='notes' || scope==='goals')) {
    const current=rows.filter(row=>row.type==='note' && !matchesDates(row,targetFrom,targetTo) && row.status!=='Resueltas' && (!row.date || row.date<=today) ||
      row.type==='goal' && !row.date && row.status==='En curso');
    const limited=fit(current.sort((a,b)=>Number(b.type==='note')-Number(a.type==='note') || compareTime(b,a)),
      evidence,6,2200);
    result.current={asOf:today,total:current.length,records:annotated(limited,citeRecord),omitted:current.length-limited.length};
  }
  if (selection?.kind==='calendar' && selection.mode==='partial')
    result.unavailable='La selección de calendarios supera el límite. Pide el nombre del calendario antes de concluir si hay compromisos.';
  return result;
}
