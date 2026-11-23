/* Exploración de los intervalos reales de la jornada, incluidos los huecos. */
(() => {
  'use strict';
  const {esc,icon} = window.JUI;
  const model = window.JModel;
  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));

  function track(entries,low,high,accent,hourLabel) {
    const slots = [];
    let cursor=low;
    function add(start,end,index=-1) {
      const entry=entries[index];
      const kind=!entry ? 'gap' : entry.segment.end ? 'closed' : entry.live ? 'live' : 'unknown';
      const color=entry ? accent(entry.goal) : '#85939c';
      const range=hourLabel(start)+' – '+(!entry || entry.segment.end ? hourLabel(end) : entry.live ? 'ahora' : 'sin cierre');
      const label=(entry?.task.title || 'Sin registro')+', '+range;
      slots.push(`<button type="button" class="jt-slot jt-${kind}" data-start="${start}" data-end="${end}" data-entry="${index}" tabindex="${slots.length ? -1 : 0}" aria-label="${esc(label)}" style="--event-accent:${color};left:${100*(start-low)/(high-low)}%;width:${100*(end-start)/(high-low)}%"></button>`);
    }
    entries.forEach((entry,index)=>{
      if (entry.start>cursor) add(cursor,entry.start);
      // Hasta conocer el cierre de otro día, sólo la marca de inicio es tiempo conocido.
      const visualEnd=!entry.segment.end && !entry.live ? high : entry.end;
      add(entry.start,visualEnd,index);
      cursor=Math.max(entry.start,visualEnd);
    });
    if (cursor<high) add(cursor,high);
    return `<p class="jd-sr" id="jt-instructions">Usa las flechas para recorrer los tramos y Escape para cerrar el detalle.</p>
      <div class="jt-track" role="group" aria-label="Tramos de la línea de tiempo" aria-describedby="jt-instructions" data-low="${low}" data-high="${high}">${slots.join('')}<i class="jt-cursor" aria-hidden="true" hidden></i></div>
      <div class="jt-popup" popover="manual" hidden><div class="jt-info" id="jt-info" role="tooltip"></div>
        <div class="jt-touch-tools" hidden><button type="button" data-jt-step="-1" aria-label="Intervalo anterior">${icon('chevron-left',17)}</button><button type="button" data-jt-step="1" aria-label="Intervalo siguiente">${icon('chevron-right',17)}</button><button type="button" data-jt-close>Cerrar</button></div>
      </div>`;
  }

  function timeDetail(entry,slot,hourLabel,date) {
    const start=Number(slot.dataset.start), end=Number(slot.dataset.end);
    if (!entry || entry.segment.end) return [hourLabel(start)+' – '+hourLabel(end),model.duration(end-start)];
    const [h,m]=model.timeNow().split(':').map(Number);
    const now=h*60+m;
    if (date===model.today() && now>=entry.start) {
      return [entry.segment.start+' – ahora ('+hourLabel(now)+')',model.duration(now-entry.start)+' en curso'];
    }
    return [entry.segment.start+' · sin cierre','Duración pendiente'];
  }

  function details(entry,slot,hourLabel,date) {
    const count=entry && entry.count>1 ? 'Tramo '+entry.index+' de '+entry.count : 'Tramo de actividad';
    const title=entry?.task.title || 'Sin registro';
    const [range,duration]=timeDetail(entry,slot,hourLabel,date);
    const field=(label,value)=>value ? '<dt>'+label+'</dt><dd>'+esc(value)+'</dd>' : '';
    const fields=entry ? field('Objetivo general',entry.goal?.title)+field('Categoría',entry.task.category)+field('Estado',entry.task.status) : '';
    return `<div class="jt-tip-kicker"><span><i></i>${entry ? count : 'Intervalo sin actividad'}</span><time class="jt-point" aria-hidden="true"></time></div>
      <strong class="jt-title">${esc(title)}</strong>
      <div class="jt-timing">${icon('clock',14)} <span>${esc(range)}</span><b>${esc(duration)}</b></div>
      ${fields ? '<dl class="jt-facts">'+fields+'</dl>' : ''}
      ${entry?.task.comment?.trim() ? '<div class="jt-comment"><b>Comentario</b><p>'+esc(entry.task.comment)+'</p></div>' : ''}`;
  }

  // Globales delegados: una vista reemplazada retira también su tarjeta y sus eventos locales.
  function signal(name,event) {
    const panel=document.querySelector('.jt-popup:not([hidden])');
    if (!panel || (name==='jt-close' && event?.type==='pointerdown' &&
        (panel.contains(event.target) || panel.parentElement?.querySelector('.jt-track')?.contains(event.target)))) return;
    if (name==='jt-reposition' && panel.contains(event?.target)) return;
    panel.dispatchEvent(new Event(name));
  }
  document.addEventListener('pointerdown',event=>signal('jt-close',event),true);
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape' && document.querySelector('.jt-popup:not([hidden])')) {
      event.preventDefault();
      signal('jt-close',event);
    }
  },true);
  document.addEventListener('scroll',event=>signal('jt-reposition',event),true);
  window.addEventListener('resize',()=>signal('jt-reposition'));

  function bind(root,entries,ctx,hourLabel) {
    const bar=root.querySelector('.jt-track'), popup=root.querySelector('.jt-popup');
    const info=popup.querySelector('.jt-info'), tools=popup.querySelector('.jt-touch-tools');
    const marker=bar.querySelector('.jt-cursor'), slots=Array.from(bar.querySelectorAll('.jt-slot'));
    const low=+bar.dataset.low, high=+bar.dataset.high;
    const topLayer=typeof popup.showPopover==='function';
    let active=null,anchor=0,touchMode=false,hideTimer=0,liveTimer=0,blocked=null;
    popup.classList.toggle('jt-inline',!topLayer);

    function clear() {
      clearTimeout(hideTimer);
      clearTimeout(liveTimer);
      if (!active) return;
      active.removeAttribute('aria-describedby');
      active.classList.remove('jt-selected');
      if (topLayer && !popup.hidden) popup.hidePopover();
      popup.hidden=true;
      marker.hidden=true;
      active=null;
    }
    function position() {
      if (!active) return;
      const rect=bar.getBoundingClientRect();
      const vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
      if (rect.bottom<0 || rect.top>vh) { clear(); return; }
      const gap=4, pad=8, x=rect.left+anchor*rect.width;
      const availableBelow=vh-rect.bottom-gap-pad, availableAbove=rect.top-gap-pad;
      const room=Math.max(availableBelow,availableAbove)-(tools.hidden ? 0 : tools.offsetHeight)-3;
      popup.style.setProperty('--jt-room',Math.max(44,room)+'px');
      const card=popup.getBoundingClientRect();
      const useBelow=card.height<=availableBelow || availableBelow>=availableAbove;
      const left=clamp(x-card.width/2,pad,vw-card.width-pad);
      const top=useBelow ? rect.bottom+gap : rect.top-card.height-gap;
      const origin=topLayer ? {left:0,top:0} : root.getBoundingClientRect();
      popup.style.left=(left-origin.left)+'px';
      popup.style.top=(clamp(top,pad,vh-card.height-pad)-origin.top)+'px';
    }
    function refreshLive(slot) {
      clearTimeout(liveTimer);
      const entry=entries[+slot.dataset.entry];
      if (!entry?.live) return;
      liveTimer=setTimeout(()=>{
        if (!root.isConnected || active!==slot) return;
        const [range,duration]=timeDetail(entry,slot,hourLabel,ctx.date);
        info.querySelector('.jt-timing span').textContent=range;
        info.querySelector('.jt-timing b').textContent=duration;
        position();
        refreshLive(slot);
      },60000-Date.now()%60000);
    }
    function show(slot,ratio=null,touch=false) {
      if (!slot) return;
      clearTimeout(hideTimer);
      const start=+slot.dataset.start,end=+slot.dataset.end;
      const anchorRatio=ratio===null ? ((start+end)/2-low)/(high-low) : ratio;
      const changed=active!==slot;
      if (changed) {
        active?.classList.remove('jt-selected');
        active?.removeAttribute('aria-describedby');
        active=slot;
        info.innerHTML=details(entries[+slot.dataset.entry],slot,hourLabel,ctx.date);
        info.scrollTop=0;
        slot.classList.add('jt-selected');
        slot.setAttribute('aria-describedby','jt-info');
        popup.style.setProperty('--event-accent',slot.style.getPropertyValue('--event-accent'));
        refreshLive(slot);
      }
      touchMode=touch;
      tools.hidden=!touch;
      if(touch) {
        tools.querySelector('[data-jt-step="-1"]').setAttribute('aria-disabled',String(slot===slots[0]));
        tools.querySelector('[data-jt-step="1"]').setAttribute('aria-disabled',String(slot===slots[slots.length-1]));
      }
      anchor=clamp(anchorRatio,0,1);
      marker.style.left=(anchor*100)+'%';
      marker.hidden=false;
      const point=info.querySelector('.jt-point');
      point.textContent=ratio===null ? '' : hourLabel(clamp(Math.floor(low+anchor*(high-low)),low,high-1));
      if (popup.hidden) {
        popup.hidden=false;
        if(topLayer) popup.showPopover();
      }
      position();
    }
    function atPosition(clientX) {
      const rect=bar.getBoundingClientRect();
      const ratio=clamp((clientX-rect.left)/(rect.width||1),0,1);
      const minute=low+ratio*(high-low);
      const instant=slots.find(slot=>slot.dataset.start===slot.dataset.end && Math.abs((+slot.dataset.start-minute)*rect.width/(high-low))<=2);
      const slot=instant || slots.find(slot=>minute<+slot.dataset.end) || slots[slots.length-1];
      return {slot,ratio};
    }
    function tabStop(slot) {
      const previous=bar.querySelector('[tabindex="0"]');
      if(previous!==slot) { previous?.setAttribute('tabindex','-1'); slot.tabIndex=0; }
    }
    function delayedClear() {
      clearTimeout(hideTimer);
      hideTimer=setTimeout(clear,170);
    }
    function step(delta,touch=false) {
      const index=clamp(slots.indexOf(active)+delta,0,slots.length-1);
      const slot=slots[index];
      blocked=null;
      tabStop(slot);
      if(!touch) slot.focus({preventScroll:true});
      show(slot,null,touch);
    }
    bar.addEventListener('pointermove',event=>{
      if (event.pointerType==='touch') return;
      const {slot,ratio}=atPosition(event.clientX);
      if (blocked===slot) return;
      blocked=null;
      show(slot,ratio);
    });
    bar.addEventListener('pointerleave',()=>{
      blocked=null;
      if (!touchMode) delayedClear();
    });
    bar.addEventListener('pointerdown',()=>{ blocked=null; });
    bar.addEventListener('click',event=>{
      const slot=event.target.closest('.jt-slot');
      if (!slot) return;
      blocked=null;
      if (!event.detail) { show(slot); return; }
      const hit=atPosition(event.clientX);
      tabStop(hit.slot);
      show(hit.slot,hit.ratio,event.pointerType==='touch' || (!event.pointerType && matchMedia('(pointer: coarse)').matches));
    });
    bar.addEventListener('focusin',event=>{
      const slot=event.target.closest('.jt-slot');
      if(slot && slot!==blocked) { tabStop(slot); show(slot); }
    });
    root.addEventListener('focusout',event=>{
      if(!bar.contains(event.relatedTarget) && !popup.contains(event.relatedTarget)) clear();
    });
    bar.addEventListener('keydown',event=>{
      const index=slots.indexOf(event.target);
      if (index<0) return;
      const target={ArrowRight:index+1,ArrowLeft:index-1,Home:0,End:slots.length-1}[event.key];
      if (target===undefined) return;
      event.preventDefault();
      blocked=null;
      const slot=slots[clamp(target,0,slots.length-1)];
      tabStop(slot);
      slot.focus({preventScroll:true});
      show(slot);
    });
    popup.addEventListener('jt-close',()=>{
      const focused=popup.contains(document.activeElement), previous=active;
      blocked=active;
      clear();
      if(focused) previous?.focus({preventScroll:true});
    });
    popup.addEventListener('jt-reposition',position);
    popup.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
    popup.addEventListener('pointerleave',()=>{ if(!touchMode) delayedClear(); });
    tools.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(button?.hasAttribute('data-jt-close')) popup.dispatchEvent(new Event('jt-close'));
      else if(button?.dataset.jtStep) step(+button.dataset.jtStep,true);
    });
  }
  window.JTimeline={track,bind};
})();
