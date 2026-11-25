/* Agenda horaria del calendario. Los botones de horas y eventos comparten el mismo eje. */
(() => {
  'use strict';

  const {esc, icon} = window.JUI;
  const model = window.JModel;
  const calendars = window.JCalendarModel;
  const dayMinutes = 1440;
  const step = 30;
  // Media hora en la escala compacta reserva un área pulsable de 24 px.
  const minCardMinutes = step;
  let lastPosition;
  let clockTimer;

  function toMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function timeText(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2,'0') + ':' + String(minutes % 60).padStart(2,'0');
  }

  function interval(event, date) {
    const start = event.startDate < date ? 0 : toMinutes(event.startTime);
    const end = event.endDate > date ? dayMinutes : toMinutes(event.endTime);
    // Reservar un área pulsable también para eventos de pocos minutos.
    const top = Math.min(start, dayMinutes - minCardMinutes);
    const bottom = Math.max(end, top + minCardMinutes);
    return {event, start, end, top, bottom};
  }

  function placeEvents(events, date) {
    const items = events.map(event => interval(event,date))
      .sort((a,b) => a.top-b.top || a.start-b.start || b.end-a.end || a.event.title.localeCompare(b.event.title,'es'));
    let groupStart = 0;
    let groupEnd = 0;
    let laneEnds = [];
    function finish(until) {
      for (let i=groupStart; i<until; i++) items[i].columns = laneEnds.length;
    }
    for (let i=0; i<items.length; i++) {
      const item = items[i];
      if (item.top >= groupEnd) {
        finish(i);
        groupStart = i;
        laneEnds = [];
      }
      const available = laneEnds.findIndex(end => end <= item.top);
      item.column = available < 0 ? laneEnds.length : available;
      laneEnds[item.column] = item.bottom;
      groupEnd = Math.max(groupEnd,item.bottom);
    }
    finish(items.length);
    return items;
  }

  function eventButton(item, date, state, byCalendar) {
    const {event} = item;
    const category = calendars.eventCategory(state,event);
    const calendar = byCalendar.get(event.calendarId);
    const classification = [category?.name,calendar?.name].filter(Boolean).join(' · ');
    const range = event.allDay ? 'Todo el día' : timeText(item.start) + ' – ' + timeText(item.end);
    const continuation = !event.allDay && event.startDate<date ? 'Viene del día anterior' : '';
    const continues = !event.allDay && event.endDate>date && !(model.shiftDate(date,1)===event.endDate && event.endTime==='00:00') ? 'Continúa al día siguiente' : '';
    const label = [event.title,range,classification,continuation,continues].filter(Boolean).join(' · ');
    const common = ' type="button" data-wd-event="'+esc(event.id)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'"';
    const color = '--wd-color:'+esc(calendars.eventColor(state,event))+';';
    if (event.allDay) return '<button'+common+' class="wd-full-event" style="'+color+'">'+esc(event.title)+'</button>';
    const duration = item.end-item.start;
    const times = '<time>'+esc(range)+'</time>';
    const title = '<strong>'+esc(event.title)+'</strong>';
    const meta = classification ? '<span class="wd-meta">'+esc(classification)+'</span>' : '';
    const details = duration>=60 && meta ? '<span class="wd-details">'+times+meta+'</span>' : times;
    const position = 'top:'+item.top/dayMinutes*100+'%;height:'+((item.bottom-item.top)/dayMinutes)*100+'%;'+
      'left:'+item.column/item.columns*100+'%;width:'+100/item.columns+'%;';
    return '<div class="wd-block" style="'+position+color+'"><button'+common+' class="wd-event'+(duration<52?' wd-compact':'')+'">'+
      title+details+'</button></div>';
  }

  function slotDefaults(date, start) {
    let end = start + 60;
    let endDate = date;
    if (end >= dayMinutes) {
      if (date === '9999-12-31') end = dayMinutes - 1;
      else { endDate = model.shiftDate(date,1); end -= dayMinutes; }
    }
    return {startDate:date, endDate, startTime:timeText(start), endTime:timeText(end), allDay:false};
  }

  function render(mount, {date,events,state,onCreate,onEdit,restoreKey}) {
    const onDate = events.filter(event => calendars.occursOn(event,date));
    const records = new Map(onDate.map(event => [event.id,event]));
    const byCalendar = new Map(calendars.calendars(state).map(cal => [cal.id,cal]));
    const allDay = onDate.filter(event => event.allDay);
    const timed = placeEvents(onDate.filter(event => !event.allDay),date);
    const peak = timed.reduce((highest,item) => Math.max(highest,item.columns),1);
    const firstMinute = timed.filter(item => item.event.startDate===date)
      .reduce((first,item) => Math.min(first,item.start),8*60);
    const selectedSlot = Math.floor(firstMinute/step)*step;
    const hourLabels = Array.from({length:24},(_,hour) => '<span>'+timeText(hour*60)+'</span>').join('');
    const buttons = Array.from({length:dayMinutes/step},(_,index) => {
      const minute = index*step, hour = timeText(minute);
      return '<button type="button" class="wd-slot" data-wd-minute="'+minute+'" tabindex="'+(minute===selectedSlot?0:-1)+
        '" aria-label="Crear evento a las '+hour+'" title="Crear evento a las '+hour+'"><span aria-hidden="true">'+icon('plus',13)+'</span></button>';
    }).join('');
    mount.classList.add('wd-day');
    mount.innerHTML='<div class="wd-all"><span class="wd-all-label">Todo el día</span><div class="wd-all-list">'+
      allDay.map(event=>eventButton({event},date,state,byCalendar)).join('')+
      '<button type="button" class="wd-add-all" data-wd-all title="Crear evento de día completo" aria-label="Crear evento de día completo">'+icon('plus',14)+'</button></div></div>'+
      '<div class="wd-scroll" role="region" aria-label="Horario del día en hora de Lima"><div class="wd-timeline" style="--wd-track-min:'+peak*68+'px">'+
      '<div class="wd-ruler" aria-hidden="true">'+hourLabels+'</div><div class="wd-track">'+buttons+
      '<div class="wd-events">'+timed.map(item=>eventButton(item,date,state,byCalendar)).join('')+'</div><div class="wd-now" hidden></div></div></div></div>';
    const scroll = mount.querySelector('.wd-scroll');
    const ruler = mount.querySelector('.wd-ruler');
    const key = String(restoreKey ?? '')+'|'+date;
    // Un guardado repinta la vista. Conservar la hora que la persona estaba consultando.
    const initialHour = ruler.firstElementChild.offsetHeight || 48;
    const position = lastPosition?.key===key ? lastPosition : {key,top:Math.max(0,firstMinute/60*initialHour-13),left:0};
    lastPosition=position;
    scroll.scrollTop=position.top;
    scroll.scrollLeft=position.left;
    scroll.onscroll=()=>{
      if(mount.isConnected && lastPosition===position){
        position.top=scroll.scrollTop;
        position.left=scroll.scrollLeft;
      }
    };
    mount.onclick=event=>{
      const control=event.target.closest('button');
      if(!control) return;
      if(control.hasAttribute('data-wd-minute')) onCreate(slotDefaults(date,Number(control.dataset.wdMinute)),control);
      else if(control.hasAttribute('data-wd-all')) onCreate({startDate:date,endDate:date,startTime:'',endTime:'',allDay:true},control);
      else if(control.hasAttribute('data-wd-event')) onEdit(records.get(control.dataset.wdEvent),control);
    };
    mount.onfocusin=event=>{
      const active=event.target.closest('[data-wd-minute]');
      if(!active) return;
      const previous=mount.querySelector('.wd-slot[tabindex="0"]');
      if(previous && previous!==active) previous.tabIndex=-1;
      active.tabIndex=0;
    };
    mount.onkeydown=event=>{
      const control=event.target.closest('[data-wd-minute]');
      if(!control) return;
      const minute=Number(control.dataset.wdMinute);
      const targets={ArrowUp:minute-step, ArrowDown:minute+step, Home:0, End:dayMinutes-step, PageUp:minute-180, PageDown:minute+180};
      if(!Object.hasOwn(targets,event.key)) return;
      event.preventDefault();
      const target=Math.min(dayMinutes-step,Math.max(0,targets[event.key]));
      const next=mount.querySelector('[data-wd-minute="'+target+'"]');
      next.focus({preventScroll:true});
      next.scrollIntoView({block:'nearest',inline:'nearest'});
    };
    clearTimeout(clockTimer);
    function updateNow() {
      const now=mount.querySelector('.wd-now');
      now.hidden=date!==model.today();
      if(now.hidden || !mount.isConnected) return;
      const time=model.timeNow();
      now.style.top=(toMinutes(time)/dayMinutes*100)+'%';
      now.setAttribute('aria-label','Hora actual '+time);
      now.dataset.time=time;
      clockTimer=setTimeout(updateNow,60000 - (Date.now()%60000));
    }
    updateNow();
  }

  window.JCalendarDay = {render};
})();
