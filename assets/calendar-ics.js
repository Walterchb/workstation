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
    for (const event of events) {
      if (event.calendarId !== calendar.id) continue;
      const stamp = utcStamp(new Date(event.updatedAt));
      lines.push('BEGIN:VEVENT','UID:' + text(event.id) + '@workhub.calendar','DTSTAMP:' + stamp,
        'LAST-MODIFIED:' + stamp, 'SEQUENCE:' + String(Number(event.sequence)));
      if (event.allDay) lines.push(...allDayDates(event));
      else lines.push('DTSTART:' + utcStamp(new Date(limaInstant(event.startDate,event.startTime))),
        'DTEND:' + utcStamp(new Date(limaInstant(event.endDate,event.endTime))));
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
