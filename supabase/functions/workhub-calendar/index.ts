// @ts-nocheck — Archivo de despliegue autocontenido; el serializador incluido también se ejecuta como JavaScript en el navegador.
// La misma implementación de iCalendar se utiliza en la descarga estática de la app.
export {};

/* Serializador iCalendar compartido por la descarga y la suscripción de Work Hub. */
(() => {
  'use strict';

  const localClock = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima', calendar:'iso8601', numberingSystem:'latn',
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});

  function text(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  }

  // RFC 5545 limita cada línea física a 75 octetos, incluido el espacio de continuación.
  function foldLine(value) {
    let result = '', bytes = 0;
    for (const character of value) {
      const code = character.codePointAt(0);
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
      result += character;
      bytes += size;
    }
    return result;
  }

  function utcStamp(date) {
    const stamp = date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    if (!/^\d{8}T\d{6}Z$/.test(stamp)) throw new Error('Fecha fuera del intervalo admitido por iCalendar.');
    return stamp;
  }

  function offsetAt(instant) {
    const parts = Object.fromEntries(localClock.formatToParts(instant).map(part => [part.type,part.value]));
    const day = parts.year.padStart(4,'0') + '-' + parts.month + '-' + parts.day;
    return Date.parse(day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + 'Z') - instant;
  }

  function limaInstant(day, clock) {
    const local = Date.parse(day + 'T' + clock + ':00Z');
    const margin = 86400000;
    const before = offsetAt(local-margin), after = offsetAt(local+margin);
    // RFC 5545, 3.3.5: una hora repetida usa su primera ocurrencia; una hora omitida usa el desfase anterior.
    let instant = local-before;
    if (before !== after && offsetAt(instant) !== before) {
      const later = local-after;
      if (offsetAt(later) === after) instant = later;
    }
    return instant;
  }

  // IANA tzdb, southamerica (America/Lima). Los inicios de observancia se expresan
  // en la hora local anterior al cambio, como requiere RFC 5545 §§3.6.5 y 3.8.5.2.
  function limaZone(historical) {
    const lines = ['BEGIN:VTIMEZONE','TZID:America/Lima'];
    if (historical) {
      lines.push(
        'BEGIN:STANDARD','DTSTART:18000101T000000','TZOFFSETFROM:-050812','TZOFFSETTO:-050812','END:STANDARD',
        'BEGIN:STANDARD','DTSTART:18900101T000000','TZOFFSETFROM:-050812','TZOFFSETTO:-050836','END:STANDARD',
        'BEGIN:STANDARD','DTSTART:19080728T000000','TZOFFSETFROM:-050836','TZOFFSETTO:-0500','END:STANDARD',
        'BEGIN:DAYLIGHT','DTSTART:19380101T000000','TZOFFSETFROM:-0500','TZOFFSETTO:-0400',
        'RDATE:19380925T000000,19390924T000000,19860101T000000,19870101T000000,19900101T000000,19940101T000000','END:DAYLIGHT',
        'BEGIN:STANDARD','DTSTART:19380401T000000','TZOFFSETFROM:-0400','TZOFFSETTO:-0500',
        'RDATE:19390326T000000,19400324T000000,19860401T000000,19870401T000000,19900401T000000,19940401T000000','END:STANDARD'
      );
    } else {
      lines.push('BEGIN:STANDARD','DTSTART:19940401T000000','TZOFFSETFROM:-0400','TZOFFSETTO:-0500','END:STANDARD');
    }
    lines.push('END:VTIMEZONE');
    return lines;
  }

  function wallTime(day, clock) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
      throw new Error('Fecha u hora local inválida.');
    }
    return day.replaceAll('-','') + 'T' + clock.replace(':','') + '00';
  }

  function allDayDates(event) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(event.startDate) || !day.test(event.endDate)) throw new Error('Fecha de día completo inválida.');
    const first = new Date(event.startDate + 'T00:00:00Z');
    const end = new Date(event.endDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const startLine = 'DTSTART;VALUE=DATE:' + event.startDate.replaceAll('-','');
    // La fecha de fin de un VEVENT es exclusiva. Una duración también expresa el último día del año 9999.
    if (end.getUTCFullYear() > 9999) return [startLine, 'DURATION:P' + Math.round((end - first) / 86400000) + 'D'];
    return [startLine, 'DTEND;VALUE=DATE:' + end.toISOString().slice(0,10).replaceAll('-','')];
  }

  function serialize(calendar, events, categories = []) {
    const categoryNames = new Map(categories.map(category => [category.id,category.name]));
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Work Hub//Calendario//ES','CALSCALE:GREGORIAN',
      'X-WR-CALNAME:' + text(calendar.name),'X-WR-TIMEZONE:America/Lima'];
    if (/^#[0-9a-f]{6}$/i.test(calendar.color)) lines.push('X-APPLE-CALENDAR-COLOR:' + calendar.color.toUpperCase() + 'FF');
    const selected = events.filter(event => event.calendarId === calendar.id);
    // Un calendario vacío conserva la zona como único componente iCalendar (RFC 5545 §3.4).
    if (selected.length === 0 || selected.some(event => !event.allDay)) {
      lines.push(...limaZone(selected.some(event => !event.allDay && event.startDate < '1994-04-01')));
    }
    for (const event of selected) {
      const stamp = utcStamp(new Date(event.updatedAt));
      // La publicación anterior usaba la secuencia almacenada y fechas UTC. El incremento
      // anuncia el cambio de formato a los suscriptores sin editar el evento ni su UID.
      const publishedSequence = Math.min(2147483647, Number(event.sequence) + 1);
      lines.push('BEGIN:VEVENT','UID:' + text(event.id) + '@workhub.calendar','DTSTAMP:' + stamp,
        'LAST-MODIFIED:' + stamp, 'SEQUENCE:' + publishedSequence);
      if (event.allDay) lines.push(...allDayDates(event));
      else lines.push('DTSTART;TZID=America/Lima:' + wallTime(event.startDate,event.startTime),
        'DTEND;TZID=America/Lima:' + wallTime(event.endDate,event.endTime));
      lines.push('SUMMARY:' + text(event.title));
      if (event.location) lines.push('LOCATION:' + text(event.location));
      if (event.description) lines.push('DESCRIPTION:' + text(event.description));
      const kind = event.kind === 'meeting' ? 'Reunión' : 'Evento';
      const category = categoryNames.get(event.categoryId);
      lines.push('CATEGORIES:' + (category && category !== kind ? text(category) + ',' + kind : kind));
      const minutes = event.reminderMinutes;
      if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440) {
        const trigger = minutes ? '-PT' + minutes + 'M' : 'PT0M';
        lines.push('BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:' + trigger,'DESCRIPTION:' + text(event.title),'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  const api = Object.freeze({serialize,limaInstant});
  globalThis.JCalendarICS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

type CalendarData = {calendar: {id:string; name:string; color:string}; events: Record<string, unknown>[]; categories?: {id:string; name:string; color?:string}[]};
declare global {
  var JCalendarICS: {serialize(calendar: CalendarData['calendar'], events: CalendarData['events'], categories?: CalendarData['categories']): string};
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const pathId = /^[a-zA-Z0-9_-]{1,128}$/;
const secretFile = /^([a-f0-9]{64})\.ics$/;
const emptyOwner = '00000000-0000-0000-0000-000000000000';
const headers = {
  'Cache-Control':'private, no-store, max-age=0',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow'
};

function response(status: number, body: string|null = null, extra: Record<string,string> = {}) {
  return new Response(body, {status, headers:{...headers, ...extra}});
}

async function readFeed(owner: string, calendar: string, token: string, category: string|null = null): Promise<CalendarData|null> {
  const project = Deno.env.get('SUPABASE_URL');
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const namedKey = Object.values(keys).find((value) => typeof value === 'string' && value.startsWith('sb_publishable_'));
  const key = keys.default || namedKey || Deno.env.get('SUPABASE_ANON_KEY');
  if (!project || !key) throw new Error('Service unavailable');
  const requestHeaders: Record<string,string> = {'Content-Type':'application/json', apikey:key};
  if (!key.startsWith('sb_publishable_')) requestHeaders.Authorization = 'Bearer ' + key;
  const rpc = category === null ? 'workhub_calendar_feed' : 'workhub_calendar_category_feed';
  const params: Record<string,string> = {p_owner_id:owner, p_calendar_id:calendar, p_token:token};
  if (category !== null) params.p_category_id = category;
  const result = await fetch(new URL('/rest/v1/rpc/' + rpc, project), {
    method:'POST', headers:requestHeaders,
    body:JSON.stringify(params),
    signal:AbortSignal.timeout(8000)
  });
  if (!result.ok) throw new Error('Service unavailable');
  const text = await result.text();
  const data = text ? JSON.parse(text) : null;
  if (data !== null && (data?.calendar?.id !== calendar || !Array.isArray(data.events) ||
      data.events.some(event => event.calendarId !== calendar || (category !== null && (event.categoryId ?? '') !== category)))) {
    throw new Error('Invalid record');
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return response(204);
  if (!['GET','HEAD'].includes(req.method)) return response(405, null, {Allow:'GET, HEAD, OPTIONS'});
  const path = new URL(req.url).pathname.replace(/^\/functions\/v1(?=\/)/, '').split('/');
  if (path[1] !== 'workhub-calendar') return response(404);
  const parts = path.slice(2);
  try {
    if (parts.length === 1 && (parts[0] === 'status' || parts[0] === 'category-status')) {
      // Comprueba también la instalación del SQL. Este identificador no corresponde a una cuenta.
      const scoped = parts[0] === 'category-status';
      await readFeed(emptyOwner, 'work', '0'.repeat(64), scoped ? '' : null);
      const version = scoped ? 'workhub-calendar/categories/1' : 'workhub-calendar/1';
      return response(200, req.method === 'HEAD' ? null : version, {'Content-Type':'text/plain; charset=utf-8'});
    }
    const [owner, id] = parts;
    let category: string|null = null;
    if (parts.length === 5 && parts[2] === 'categories') {
      const scope = parts[3];
      if (scope === 'unassigned') category = '';
      else if (scope.startsWith('c-') && pathId.test(scope.slice(2))) category = scope.slice(2);
      else return response(404);
    } else if (parts.length !== 3) return response(404);
    const secret = secretFile.exec(parts.at(-1) || '');
    if (!uuid.test(owner) || !pathId.test(id) || !secret) return response(404);
    const data = await readFeed(owner, id, secret[1], category);
    if (!data) return response(404);
    const calendarHeaders = {'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="workhub.ics"'};
    return response(200, req.method === 'HEAD' ? null : globalThis.JCalendarICS.serialize(data.calendar, data.events, data.categories), calendarHeaders);
  } catch {
    // No registrar la URL, los eventos ni el token.
    return response(503);
  }
});
