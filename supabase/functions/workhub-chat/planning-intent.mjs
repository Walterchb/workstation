// Atajo para peticiones de planificación inequívocas. El modelo puede pedir el mismo
// contexto mediante la herramienta cuando la fecha o la formulación necesitan interpretación.
const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const iso = day => day.toISOString().slice(0,10);
function addDays(day,n) {
  const d=new Date(day+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return iso(d);
}
function weekStart(day) {
  return addDays(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7));
}
function validDay(day) {
  if (typeof day!=='string' || !/^\d{4}-\d\d-\d\d$/.test(day)) return false;
  const value=new Date(day+'T12:00:00Z');
  return Number.isFinite(value.valueOf()) && iso(value)===day;
}
const weekdays=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
const workplan=/\b(?:arma\w*|prepara\w*|organiza\w*|hazme|haz|dame|propon\w*|traza|planear|planea\w*|planifica\w*|disena\w*)\b.{0,33}\b(?:mi (?:jornada|dia|semana|agenda)|(?:un |el )?plan (?:de (?:mi |trabajo|accion)|para|del (?:dia|lunes|martes|miercoles|jueves|viernes)))\b/;
const openAdvice=/\b(?:que (?:(?:deberia(?:mos)?|debo|podria(?:mos)?|conviene|recomiendas|me (?:recomiendas|aconsejas|sugieres|conviene))(?: (?:hacer|priorizar|avanzar|retomar|atender|trabajar))?|hara?s?|hago|trabajo|priorizo)|(?:por |con )(?:donde|que) (?:empezar|empiezo|comienzo|arranco)|en que (?:me (?:centro|enfoco)|enfocarme|avanzo|trabajo)|a que (?:le doy prioridad|me dedico))\b/;
const editorial=/^(?:(?:por favor|ayudame a)[, ]+)?(?:reformula\w*|redacta\w*|traduce\w*|corrige\w*|reescribe\w*|mejora la redaccion)\b/;
const suppliedDraft=/[:«“"]/;
const evidenceClause=/\b(?:en funcion de|teniendo en cuenta|tomando en cuenta|tomando como (?:base|referencia)|segun (?:lo|mis|los|mi)|considerando|viendo (?:lo|los|esta|la|mi)|con (?:base en|lo que)|basandote en|a partir de (?:lo|mis|los)|dado que)\b/;
// Una orientación sobre una jornada sí requiere el historial. Conservar preguntas
// sobre un objeto concreto para que el modelo determine si precisa datos propios.
function asksForPlan(text) {
  if(workplan.test(text)) return true;
  const match=openAdvice.exec(text);
  if(!match) return false;
  const tail=text.slice(match.index+match[0].length).split(evidenceClause)[0];
  const rest=tail.replace(/\b(?:pasado manana|hoy y manana|manana|hoy|mi jornada|mi dia|mi semana|esta semana|la proxima semana|la semana que viene|lunes|martes|miercoles|jueves|viernes|sabado|domingo|proximo|proxima|para|este|esta|ese|el|la|por favor|primero|en el trabajo|de trabajo|aqui|ahora|por la tarde|por la manana|de mi lista|de mis pendientes)\b/g,' ').replace(/\b\d{4}-\d\d-\d\d\b/g,'').replace(/[\s.,;:¿?¡!]/g,'');
  return !rest;
}
const literal=/\b(?:solo|unicamente|solamente)\b.{0,42}\b(?:agenda|tengo|calendar\w*|programad\w*|agendad\w*|planificad\w*)\b|\b(?:que (?:tengo|hay|esta|quedo|tendre)|cuales son (?:mis|los)|muestrame|lista(?:me)?)\b.{0,23}\b(?:reuniones|eventos|agendad\w*|programad\w*|planificad\w*|en (?:mi|la) agenda)\b/;
const referenceSelection=/\b(?:esta vista|estos filtros|(?:el |este )?(?:objetivo|calendario) seleccionado|(?:seleccion|lista) (?:visible|actual)|los (?:registros|objetivos) (?:visibles|seleccionados))\b/;
function inferDate(text,today,view) {
  const date=text.match(/\b\d{4}-\d\d-\d\d\b/g);
  if (date?.length) {
    if (date.length>2 || !date.every(validDay)) return;
    return {from:date[0],to:date.at(-1)};
  }
  if (/\b(?:\d{1,2}\s*(?:\/|de\s+[a-z]))\b/.test(text)) return;
  if (/\b(?:semana (?:seleccionada|visible)|periodo (?:visible|seleccionado)|esta vista)\b/.test(text) &&
      view?.from && view?.to && !/\b(?:manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(text))
    return {from:view.from,to:view.to};
  const mentionedWeekdays=text.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g) || [];
  if (mentionedWeekdays.length>1) return;
  const dayWindow=text.match(/\bhoy y ma[nñ]ana\b/);
  if (dayWindow) return {from:today,to:addDays(today,1)};
  if (/\b(?:la )?(?:proxima|siguiente) semana\b|\bsemana (?:proxima|siguiente|que viene)\b/.test(text)) {
    const from=addDays(weekStart(today),7);
    if (mentionedWeekdays.length) {
      const day=addDays(from,(weekdays.indexOf(mentionedWeekdays[0])+6)%7);
      return {from:day,to:day};
    }
    return {from,to:addDays(from,6)};
  }
  let day;
  if (/\bpasado manana\b/.test(text)) day=addDays(today,2);
  else if (/\bmanana\b/.test(text.replace(/\b(?:(?:por|en|de) la|esta) manana\b/g,''))) day=addDays(today,1);
  else if (/\bhoy\b|\besta manana\b/.test(text)) day=today;
  else {
    const weekday=text.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g);
    if (weekday?.length===1 && !/\b(?:pasad[oa]|anterior)\b/.test(text)) {
      const offset=(weekdays.indexOf(weekday[0])-new Date(today+'T12:00:00Z').getUTCDay()+7)%7;
      day=addDays(today,offset || (/\b(?:proximo|siguiente|que viene)\b/.test(text)?7:0));
    } else if (weekday?.length) return;
    else if (/\b(?:esta semana|mi semana)\b/.test(text)) return {from:today,to:addDays(weekStart(today),6)};
    else if (/\b(?:mi (?:jornada|dia)|resto del dia)\b/.test(text)) day=today;
  }
  if (day) return {from:day,to:day};
}
function recentEvidence(text,today) {
  const start=weekStart(today);
  const clause=text.split(evidenceClause).slice(1).join(' ');
  const dates=clause.match(/\b\d{4}-\d\d-\d\d\b/g) || [];
  if (dates.length>=1 && dates.length<=2 && dates.every(validDay) && dates.at(-1)>=dates[0])
    return {historyFrom:dates[0],historyTo:dates.at(-1)};
  if (/\b(?:la ultima semana|(?:los )?ultimos (?:siete|7) dias)\b/.test(clause))
    return {historyFrom:addDays(today,-6),historyTo:today};
  if (/\b(?:lo que|avances?|trabaj\w*|h[eai]|semana)\b.{0,90}\besta semana\b/.test(text)) return {historyFrom:start,historyTo:today};
  if (/\b(?:semana pasada|semana anterior)\b/.test(text)) return {historyFrom:addDays(start,-7),historyTo:addDays(start,-1)};
  return {};
}
export function resolvePlanningIntent(message,{today,view,history=[]},requested) {
  const text=fold(message);
  const explicit=asksForPlan(text);
  if ((!explicit || /\b(?:solo|unicamente|solamente)\b/.test(text)) && literal.test(text)) return;
  const previous=history.filter(entry=>entry.role==='user').at(-1);
  const followup=previous && asksForPlan(fold(previous.content)) &&
    /^(?:[¿¡]?y (?:si |para |el |la |hoy|manana)|(?:[¿¡]?(?:y )?ahora[, ]+)?(?:arma|haz|ajusta|acorta|resume|reordena|redacta|prioriza|cambia|simplifica|detalla|dame|explica)(?:lo|la|me)?\b|[¿¡]?por (?:que|donde))/.test(text);
  if (editorial.test(text) && (!followup || suppliedDraft.test(text) || !/\b(?:ese plan|el plan|la propuesta|es[oa] (?:para|en)|redactalo|reformulalo|resumelo)\b/.test(text))) return;
  if (!requested && !explicit && !followup) return;
  const targetText=text.split(evidenceClause)[0];
  const range=(requested?.from ? {from:requested.from,to:requested.to||requested.from}:undefined) || inferDate(targetText,today,view)
    || (followup ? inferDate(fold(previous.content),today,view):undefined);
  if (!range || !validDay(range.from) || !validDay(range.to) || range.from>range.to || range.to>addDays(range.from,30)) return;
  return {targetFrom:range.from,targetTo:range.to,today,...recentEvidence(text,today),
    useViewFilters:referenceSelection.test(text) || !!requested?.useViewFilters};
}
