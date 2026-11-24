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

  function utcFromLima(day, clock) {
    const local = Date.parse(day + 'T' + clock + ':00Z');
    const margin = 86400000;
    const before = offsetAt(local-margin), after = offsetAt(local+margin);
    // RFC 5545, 3.3.5: una hora repetida usa su primera ocurrencia; una hora omitida usa el desfase anterior.
    let instant = local-before;
    if (before !== after && offsetAt(instant) !== before) {
      const later = local-after;
      if (offsetAt(later) === after) instant = later;
    }
    return utcStamp(new Date(instant));
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

  function serialize(calendar, events) {
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Work Hub//Calendario//ES','CALSCALE:GREGORIAN',
      'X-WR-CALNAME:' + text(calendar.name),'X-WR-TIMEZONE:America/Lima'];
    if (/^#[0-9a-f]{6}$/i.test(calendar.color)) lines.push('X-APPLE-CALENDAR-COLOR:' + calendar.color.toUpperCase() + 'FF');
    for (const event of events) {
      if (event.calendarId !== calendar.id) continue;
      const stamp = utcStamp(new Date(event.updatedAt));
      lines.push('BEGIN:VEVENT','UID:' + text(event.id) + '@workhub.calendar','DTSTAMP:' + stamp,
        'LAST-MODIFIED:' + stamp, 'SEQUENCE:' + String(Number(event.sequence)));
      if (event.allDay) lines.push(...allDayDates(event));
      else lines.push('DTSTART:' + utcFromLima(event.startDate,event.startTime), 'DTEND:' + utcFromLima(event.endDate,event.endTime));
      lines.push('SUMMARY:' + text(event.title));
      if (event.location) lines.push('LOCATION:' + text(event.location));
      if (event.description) lines.push('DESCRIPTION:' + text(event.description));
      lines.push('CATEGORIES:' + (event.kind === 'meeting' ? 'Reunión' : 'Evento'),'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  const api = Object.freeze({serialize});
  globalThis.JCalendarICS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();


type CalendarData = {calendar: {id:string; name:string; color:string}; events: Record<string, unknown>[]};
declare global {
  var JCalendarICS: {serialize(calendar: CalendarData['calendar'], events: CalendarData['events']): string};
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

async function readFeed(owner: string, calendar: string, token: string): Promise<CalendarData|null> {
  const project = Deno.env.get('SUPABASE_URL');
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const namedKey = Object.values(keys).find((value) => typeof value === 'string' && value.startsWith('sb_publishable_'));
  const key = keys.default || namedKey || Deno.env.get('SUPABASE_ANON_KEY');
  if (!project || !key) throw new Error('Service unavailable');
  const requestHeaders: Record<string,string> = {'Content-Type':'application/json', apikey:key};
  if (!key.startsWith('sb_publishable_')) requestHeaders.Authorization = 'Bearer ' + key;
  const result = await fetch(new URL('/rest/v1/rpc/workhub_calendar_feed', project), {
    method:'POST', headers:requestHeaders,
    body:JSON.stringify({p_owner_id:owner, p_calendar_id:calendar, p_token:token}),
    signal:AbortSignal.timeout(8000)
  });
  if (!result.ok) throw new Error('Service unavailable');
  const text = await result.text();
  const data = text ? JSON.parse(text) : null;
  if (data !== null && (data?.calendar?.id !== calendar || !Array.isArray(data.events))) throw new Error('Invalid record');
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return response(204);
  if (!['GET','HEAD'].includes(req.method)) return response(405, null, {Allow:'GET, HEAD, OPTIONS'});
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  try {
    if (parts.at(-2) === 'workhub-calendar' && parts.at(-1) === 'status') {
      // Comprueba también la instalación del SQL. Este identificador no corresponde a una cuenta.
      await readFeed(emptyOwner, 'work', '0'.repeat(64));
      return response(200, req.method === 'HEAD' ? null : 'workhub-calendar/1', {'Content-Type':'text/plain; charset=utf-8'});
    }
    const [functionName, owner, id, file] = parts.slice(-4);
    const secret = secretFile.exec(file || '');
    if (functionName !== 'workhub-calendar' || !uuid.test(owner) || !pathId.test(id) || !secret) return response(404);
    const data = await readFeed(owner, id, secret[1]);
    if (!data) return response(404);
    const calendarHeaders = {'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="workhub.ics"'};
    return response(200, req.method === 'HEAD' ? null : globalThis.JCalendarICS.serialize(data.calendar, data.events), calendarHeaders);
  } catch {
    // No registrar la URL, los eventos ni el token.
    return response(503);
  }
});
