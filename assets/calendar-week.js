/* Calendario semanal. Un solo eje de horas para los siete días civiles de Lima. */
(() => {
  'use strict';
  const {esc} = window.JUI;
  const calendar = window.JCalendarModel;
  const {placeEvents,eventButton,slotDefaults,timeText} = window.JCalendarDay;
  const weekdays = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const fullDate = new Intl.DateTimeFormat('es-PE',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const minDate = '0001-01-01', maxDate = '9999-12-31';
  let lastPosition;
  let sizeObserver;
  function disconnect() {
    sizeObserver?.disconnect();
    sizeObserver=undefined;
  }

  function offset(date,amount) {
    const value=new Date(date+'T12:00:00Z');
    value.setUTCDate(value.getUTCDate()+amount);
    return value.getUTCFullYear()>=1 && value.getUTCFullYear()<=9999 ? value.toISOString().slice(0,10) : '';
  }

  function days(date) {
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    const monday=-((weekday+6)%7);
    return weekdays.map((_,index)=>offset(date,monday+index));
  }

  function range(date) {
    const week=days(date).filter(Boolean);
    return {start:week[0],end:week.at(-1)};
  }

  function shift(date,amount) {
    const result=offset(date,amount*7);
    if(result) return result;
    const week=range(date);
    if(amount<0 && week.start>minDate) return minDate;
    if(amount>0 && week.end<maxDate) return maxDate;
    return '';
  }

  function fitHeader(mount) {
    const scroll=mount.querySelector('.ww-scroll');
    if(!scroll) return;
    const head=scroll.querySelector('.ww-head'), full=scroll.querySelector('.ww-fulls');
    // Las citas largas siguen siendo accesibles con el mismo desplazamiento.
    const pin=full.offsetHeight+head.offsetHeight<=scroll.clientHeight*.45;
    full.classList.toggle('ww-pinned',pin);
    full.style.top=head.offsetHeight+'px';
  }

  function render(mount,{date,events,state,onEdit,onCreate,onDay,restoreKey}) {
    const dates=days(date), today=window.JModel.today();
    const byCalendar=new Map([...calendar.calendars(state),calendar.activityCalendar].map(cal=>[cal.id,cal]));
    const byId=new Map(events.map(event=>[event.id,event]));
    const columns=dates.map(day=>{
      const entries=day ? events.filter(event=>calendar.occursOn(event,day)) : [];
      const timed=placeEvents(entries.filter(event=>!event.allDay && event.startTime),day);
      const width=timed.reduce((max,item)=>Math.max(max,item.columns),1)*40;
      return {day,timed,width,all:entries.filter(event=>event.allDay)};
    });
    const firstMinute=columns.reduce((minute,col)=>col.timed.reduce((m,item)=>
      item.event.startDate===col.day ? Math.min(m,item.start) : m,minute),8*60);
    const keyboardSlot=Math.floor(firstMinute/30)*30;
    const sizes=columns.map(col=>'minmax(max(var(--ww-column),'+col.width+'px),1fr)').join(' ');
    const dayLabel=day=>fullDate.format(new Date(day+'T12:00:00Z'));
    const headers=dates.map((day,i)=>day?
      '<button type="button" class="ww-day-head" data-ww-day="'+day+'"'+(day===today?' aria-current="date"':'')+
        (day===date?' data-selected':'')+' aria-label="Abrir '+esc(dayLabel(day))+' en vista Día">'+
        '<span>'+weekdays[i]+'</span><strong>'+Number(day.slice(-2))+'</strong></button>':'<span></span>').join('');
    const allDay=columns.map(({day,all})=>'<div class="ww-full-cell" data-ww-date="'+day+'">'+
      all.map(event=>eventButton({event},day,state,byCalendar)).join('')+
      (day && onCreate?'<button type="button" class="ww-add-all" data-ww-all="'+day+'" aria-label="Crear evento de día completo, '+esc(dayLabel(day))+'">+</button>':'')+'</div>').join('');
    const labels=Array.from({length:24},(_,hour)=>'<span>'+timeText(hour*60)+'</span>').join('');
    const tracks=columns.map(({day,timed})=>{
      if(!day) return '<div aria-hidden="true"></div>';
      const slots=Array.from({length:48},(_,i)=>{
        const minute=i*30;
        if(!onCreate) return '<span class="wd-slot" aria-hidden="true"></span>';
        return '<button class="wd-slot" type="button" data-wd-minute="'+minute+'" tabindex="'+(day===date && minute===keyboardSlot?0:-1)+
          '" aria-label="Crear evento el '+esc(dayLabel(day))+' a las '+timeText(minute)+'"></button>';
      }).join('');
      return '<div class="wd-track ww-track" data-ww-date="'+day+'">'+slots+'<div class="wd-events">'+
        timed.map(item=>eventButton(item,day,state,byCalendar)).join('')+'</div></div>';
    }).join('');
    mount.classList.add('ww-week');
    mount.innerHTML='<div class="ww-scroll wd-scroll" role="region" aria-label="Horario semanal de lunes a domingo en hora de Lima">'+
      '<div class="ww-grid" style="--ww-tracks:var(--wd-axis) '+sizes+'">'+
      '<div class="ww-head"><span class="ww-corner">Hora</span>'+headers+'</div>'+
      '<div class="ww-fulls"><span class="ww-corner">Todo el día</span>'+allDay+'</div>'+
      '<div class="ww-hours"><div class="wd-ruler" aria-hidden="true">'+labels+'</div>'+tracks+'</div></div></div>';
    const scroll=mount.querySelector('.ww-scroll'), head=mount.querySelector('.ww-head'), full=mount.querySelector('.ww-fulls');
    const hourHeight=mount.querySelector('.wd-ruler span').offsetHeight || 48;
    const key=String(restoreKey ?? '')+'|'+(dates[0] || minDate);
    disconnect();
    fitHeader(mount);
    if(window.ResizeObserver) {
      sizeObserver=new window.ResizeObserver((entries,observer)=>{
        if(observer!==sizeObserver) return;
        if(mount.isConnected) fitHeader(mount);
        else disconnect();
      });
      for(const element of [scroll,head,full]) sizeObserver.observe(element);
    }
    const position=lastPosition?.key===key ? lastPosition : {key,
      top:Math.max(0,firstMinute/60*hourHeight-12),left:0,date};
    if(position.date!==date || position!==lastPosition) {
      const active=mount.querySelector('[data-ww-day="'+date+'"]');
      const x=active.offsetLeft, width=active.offsetWidth, axis=mount.querySelector('.ww-corner').offsetWidth;
      if(x+width>position.left+scroll.clientWidth || x<position.left+axis)
        position.left=Math.max(0,x-(scroll.clientWidth-width+axis)/2);
      position.date=date;
    }
    lastPosition=position;
    scroll.scrollLeft=position.left;
    scroll.scrollTop=position.top;
    scroll.onscroll=()=>{
      if(mount.isConnected && lastPosition===position) {
        position.left=scroll.scrollLeft;
        position.top=scroll.scrollTop;
      }
    };
    mount.onclick=event=>{
      const button=event.target.closest('button');
      if(!button) return;
      if(button.hasAttribute('data-ww-day')) onDay(button.dataset.wwDay);
      else if(button.hasAttribute('data-wd-event')) onEdit(byId.get(button.dataset.wdEvent),button);
      else if(button.hasAttribute('data-wd-minute')) onCreate(slotDefaults(button.closest('[data-ww-date]').dataset.wwDate,Number(button.dataset.wdMinute)),button);
      else if(button.hasAttribute('data-ww-all')) {
        const day=button.dataset.wwAll;
        onCreate({startDate:day,endDate:day,startTime:'',endTime:'',allDay:true},button);
      }
    };
    mount.onfocusin=event=>{
      const slot=event.target.closest('[data-wd-minute]');
      if(!slot) return;
      const previous=mount.querySelector('.wd-slot[tabindex="0"]');
      if(previous && previous!==slot) previous.tabIndex=-1;
      slot.tabIndex=0;
    };
    mount.onkeydown=event=>{
      const slot=event.target.closest('[data-wd-minute]');
      if(!slot) return;
      let day=slot.closest('[data-ww-date]').dataset.wwDate, minute=Number(slot.dataset.wdMinute);
      const moves={ArrowUp:-30,ArrowDown:30,PageUp:-180,PageDown:180};
      if(Object.hasOwn(moves,event.key)) minute=Math.max(0,Math.min(1410,minute+moves[event.key]));
      else if(event.key==='Home') minute=0;
      else if(event.key==='End') minute=1410;
      else if(event.key==='ArrowLeft' || event.key==='ArrowRight') day=dates[dates.indexOf(day)+(event.key==='ArrowLeft'?-1:1)] || day;
      else return;
      event.preventDefault();
      const target=mount.querySelector('.ww-track[data-ww-date="'+day+'"] [data-wd-minute="'+minute+'"]');
      target.focus({preventScroll:true});
      target.scrollIntoView({block:'nearest',inline:'nearest'});
    };
  }
  window.JCalendarWeek={render,days,range,shift,disconnect,fitHeader};
})();
