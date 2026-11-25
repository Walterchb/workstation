/* Exporta la edición abierta a partir de la composición de su propia hoja HTML. */
(() => {
  'use strict';
  const MM = 72 / 25.4, PX = 72 / 96;
  const WIDTH = 210 * MM, HEIGHT = 297 * MM, MARGIN = 14 * MM;
  const PAGE_ROOM = (HEIGHT - 2 * MARGIN) / PX;
  const assetBase = new URL('.',document.currentScript?.src || new URL('assets/report-pdf.js', document.baseURI || 'https://localhost/'));
  let fontLoading;
  async function fontsFor(doc) {
    if (!fontLoading) {
      const weights = ['regular','semibold','bold'];
      fontLoading = Promise.all([
        import(new URL('vendor/fontkit.min.js',assetBase).href),
        ...weights.map(async name => {
          const res = await fetch(new URL('fonts/manrope-report-'+name+'.ttf',assetBase).href);
          if (!res.ok) throw new Error('No se pudo cargar la tipografía del informe.');
          return new Uint8Array(await res.arrayBuffer());
        })
      ]).catch(error=>{fontLoading=undefined;throw error;});
    }
    const [, ...files] = await fontLoading;
    doc.registerFontkit(globalThis.fontkit);
    return Promise.all(files.map((bytes,i)=>doc.embedFont(bytes,{
      subset:true,customName:['Manrope-Regular','Manrope-Semibold','Manrope-Bold'][i]
    })));
  }
  function ink(value) {
    const match = /^rgba?\(([^)]+)\)/.exec(value);
    if (!match) return null;
    const [r,g,b,a=1] = match[1].split(/[\s,/]+/).map(Number);
    return a > 0 ? PDFLib.rgb(r/255,g/255,b/255) : null;
  }

  async function collect(paper,doc,fonts) {
    const origin = paper.getBoundingClientRect();
    const box = rect => ({x:rect.left-origin.left, y:rect.top-origin.top,w:rect.width,h:rect.height});
    const bounds = element => box(element.getBoundingClientRect());
    const drawings=[], lines=[], baselineCache=new Map();
    const canvas = document.createElement('canvas').getContext('2d');
    const supported = fonts.map(font=>new Set(font.getCharacterSet()));
    const range = document.createRange();
    const styleFont = style => style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
    function collectLines(node,style) {
      const content = node.data;
      if (!content.trim()) return;
      const weight = Number.parseInt(style.fontWeight,10) || 400;
      const index = weight >= 690 ? 2 : weight >= 515 ? 1 : 0;
      const font = fonts[index], px = parseFloat(style.fontSize), key=styleFont(style);
      if (!baselineCache.has(key)) {
        canvas.font=key;
        const m=canvas.measureText('Ágj');
        const a=m.fontBoundingBoxAscent ?? px*.8, d=m.fontBoundingBoxDescent ?? px*.2;
        baselineCache.set(key,(a-d)/2);
      }
      function at(offset) {
        range.setStart(node,offset);range.setEnd(node,offset+1);
        return range.getBoundingClientRect();
      }
      for(let pos=0;pos<content.length;) {
        if (content[pos]==='\n'||content[pos]==='\r') {pos++;continue;}
        const top=at(pos).top;
        let lo=pos+1, hi=content.length;
        const nextBreak=content.indexOf('\n',pos);
        if (nextBreak>=0) hi=nextBreak;
        while(lo<hi) {
          const mid=Math.floor((lo+hi)/2);
          if(at(mid).top<=top+1)lo=mid+1;else hi=mid;
        }
        const end=Math.max(lo,pos+1);
        let value=content.slice(pos,end);
        range.setStart(node,pos);range.setEnd(node,end);
        const r=box(range.getBoundingClientRect());
        pos=end;
        if (!value.trim() || !r.w || !r.h) continue;
        if (!style.whiteSpace.startsWith('pre')) value=value.trim().replace(/\s+/g,' ');
        const fallback=[...value].some(c=>!supported[index].has(c.codePointAt(0)));
        const line={kind:'text',...r,value,font,px,ink:ink(style.color),baseline:r.y+r.h/2+baselineCache.get(key),key, fallback};
        if (fallback) {
          const bitmap=document.createElement('canvas'), scale=3;
          bitmap.width=Math.ceil(r.w*scale+4);bitmap.height=Math.ceil(r.h*scale+4);
          const ctx=bitmap.getContext('2d');ctx.scale(scale,scale);ctx.font=key;ctx.fillStyle=style.color;
          ctx.fillText(value,0,line.baseline-r.y,r.w);
          line.bitmap=doc.embedPng(bitmap.toDataURL('image/png'));
        }
        drawings.push(line);lines.push(line);
      }
    }
    async function visit(el) {
      const style=getComputedStyle(el), r=bounds(el);
      if (!r.h || !r.w || style.display==='none' || style.visibility==='hidden' ||
          (style.clipPath.startsWith('inset(') && el.classList.contains('ji-comment-key'))) return;
      const bg=ink(style.backgroundColor), circle=el.classList.contains('ji-paper-avatar');
      if (bg) drawings.push({kind:circle?'circle':'fill',...r,ink:bg});
      const edges=[
        ['Top',r.x,r.y,r.x+r.w,r.y],['Bottom',r.x,r.y+r.h,r.x+r.w,r.y+r.h],
        ['Left',r.x,r.y,r.x,r.y+r.h],['Right',r.x+r.w,r.y,r.x+r.w,r.y+r.h]
      ];
      for(const [side,x1,y1,x2,y2] of edges){
        const size=parseFloat(style['border'+side+'Width']), color=ink(style['border'+side+'Color']);
        if(size&&color)drawings.push({kind:'rule',x1,y1,x2,y2,y:Math.min(y1,y2),h:Math.abs(y2-y1),size,ink:color});
      }
      if(el.tagName==='TD' && el.cellIndex===0 && el.parentElement.classList.contains('ji-repeat')){
        const after=getComputedStyle(el,'::after');
        if(after.display!=='none' && after.content!=='none'){
          const x=r.x+(parseFloat(after.left)||0), y=r.y+(parseFloat(after.top)||0);
          drawings.push({kind:'rule',x1:x,y1:y,x2:x,y2:r.y+r.h-4,y,h:r.h-4,size:1,ink:ink(after.borderLeftColor),dash:[1,2]});
        }
      }
      if(el.tagName==='IMG' && el.naturalWidth){
        const bitmap=document.createElement('canvas');bitmap.width=Math.ceil(r.w*4);bitmap.height=Math.ceil(r.h*4);
        const ctx=bitmap.getContext('2d');
        if(el.closest('.ji-paper-avatar')){ctx.beginPath();ctx.arc(bitmap.width/2,bitmap.height/2,bitmap.width/2,0,Math.PI*2);ctx.clip();}
        ctx.drawImage(el,0,0,bitmap.width,bitmap.height);
        drawings.push({kind:'image',...r,image:await doc.embedPng(bitmap.toDataURL('image/png'))});
        return;
      }
      for(const child of el.childNodes) {
        if(child.nodeType===1)await visit(child);
        else if(child.nodeType===3)collectLines(child,style);
      }
    }
    await visit(paper);
    const protectedBoxes=[];
    const protect=(from,to)=>{if(to>from)protectedBoxes.push([from,to]);};
    for(const q of ['.ji-paper-head','.ji-paper-lead','.ji-paper-metrics','.ji-paper-note','tbody tr']) {
      for(const node of paper.querySelectorAll(q)){
        const r=bounds(node);
        // Los comentarios extensos pueden comenzar en el espacio que queda en la página.
        protect(r.y,r.y+(q==='tbody tr' && r.h>PAGE_ROOM*.45 ? 55 : r.h));
      }
    }
    const tables=[];
    for(const section of paper.querySelectorAll('.ji-paper-section')){
      const head=section.querySelector('thead'), first=section.querySelector('tbody tr');
      if(!head||!first)continue;
      const h=bounds(head), row=bounds(first),end=bounds(head.closest('table'));
      protect(bounds(section).y,row.y+Math.min(row.h,55));
      tables.push({top:h.y,headEnd:h.y+h.h,end:end.y+end.h,first:row.y});
    }
    for(const op of lines){if(op.bitmap)op.image=await op.bitmap;}
    return {drawings,lines,protectedBoxes,tables,height:origin.height};
  }

  function paginate(layout) {
    const {height,protectedBoxes,lines,tables}=layout, result=[];
    for(let start=0; start<height-.01;) {
      const header=tables.find(t=>start>t.first+1 && start<t.end-1);
      const inset=header ? header.headEnd-header.top : 0;
      const cap=PAGE_ROOM-inset;
      let end=Math.min(height,start+cap);
      if(end<height){
        // Evita separar el título de la tabla y conserva juntas las filas breves.
        for(const [top,bottom] of protectedBoxes){
          if(top>start+1 && top<end && bottom>end+.5 && bottom-top<cap)end=top;
        }
        // Si un comentario ocupa más de una página, corta entre dos líneas de texto.
        let prev;
        do {
          prev=end;
          for(const line of lines){
            if(line.y>start+.5 && line.y<end-.1 && line.y+line.h>end+.25)end=line.y;
          }
        } while(end<prev-.01);
      }
      if(end<=start+.01)end=Math.min(height,start+cap);
      result.push({start,end,header});start=end;
    }
    return result;
  }

  // El navegador pinta los símbolos que faltan en Manrope. Esta fuente invisible
  // conserva sus caracteres Unicode al seleccionar, copiar o buscar ese renglón.
  function mapFallbackText(doc,lines) {
    const chars=[...new Set(lines.filter(line=>line.fallback).flatMap(line=>[...line.value]))];
    const mapped=new Map(), ctx=doc.context;
    if(!chars.length)return mapped;
    const blank=ctx.register(ctx.flateStream('1000 0 d0'));
    const hex=n=>n.toString(16).padStart(2,'0').toUpperCase();
    for(let offset=0;offset<chars.length;offset+=250){
      const group=chars.slice(offset,offset+250), names=group.map((_,i)=>'s'+i);
      const pairs=group.map((c,i)=>{
        const utf16=c.split('').map(unit=>unit.charCodeAt(0).toString(16).padStart(4,'0')).join('');
        return '<'+hex(i)+'> <'+utf16+'>';
      });
      const blocks=[];
      for(let i=0;i<pairs.length;i+=100){
        const set=pairs.slice(i,i+100);
        blocks.push(set.length+' beginbfchar',...set,'endbfchar');
      }
      const cmap=['/CIDInit /ProcSet findresource begin','12 dict begin','begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /WorkHubUnicode def','/CMapType 2 def','1 begincodespacerange','<00> <FF>',
        'endcodespacerange',...blocks,'endcmap','CMapName currentdict /CMap defineresource pop','end','end'].join('\n');
      const label='WorkHubUnicode'+offset;
      const font=ctx.register(ctx.obj({Type:'Font',Subtype:'Type3',Name:label,FontBBox:[0,-250,1000,850],
        FontMatrix:[.001,0,0,.001,0,0],CharProcs:Object.fromEntries(names.map(name=>[name,blank])),
        Encoding:{Type:'Encoding',Differences:[0,...names]},FirstChar:0,LastChar:group.length-1,
        Widths:group.map(()=>1000),Resources:{},ToUnicode:ctx.register(ctx.flateStream(cmap))}));
      group.forEach((c,i)=>mapped.set(c,{name:PDFLib.PDFName.of(label),font,hex:hex(i)}));
    }
    return mapped;
  }
  function searchableSymbols(page,op,atX,atY,map){
    const lib=PDFLib,letters=[...op.value],size=op.px*PX,step=op.w*PX/letters.length;
    let start=0;
    while(start<letters.length){
      const m=map.get(letters[start]);
      let end=start+1, encoded=m.hex;
      while(end<letters.length && map.get(letters[end]).font===m.font)encoded+=map.get(letters[end++]).hex;
      page.node.setFontDictionary(m.name,m.font);
      page.pushOperators(lib.pushGraphicsState(),lib.beginText(),lib.setFontAndSize(m.name,size),
        lib.setTextRenderingMode(3),lib.setTextMatrix(step/size,0,0,1,atX+step*start,atY),
        lib.showText(lib.PDFHexString.of(encoded)),lib.endText(),lib.popGraphicsState());
      start=end;
    }
  }

  function drawBand(page,layout,from,to,marginTop) {
    const lib=PDFLib, X=px=>MARGIN+px*PX, Y=py=>HEIGHT-MARGIN-(marginTop+py-from)*PX;
    page.pushOperators(lib.pushGraphicsState(),lib.rectangle(MARGIN-.25,Y(to)-.1,WIDTH-2*MARGIN+.5,(to-from)*PX+.2),
      lib.clip(),lib.endPath());
    for(const o of layout.drawings){
      if(o.y+o.h<from-.01 || o.y>to+.01)continue;
      if(o.kind==='text'){
        if(o.y+o.h*.5<from || o.y+o.h*.5>=to)continue;
        if(o.fallback){
          searchableSymbols(page,o,X(o.x),Y(o.baseline),layout.symbols);
          page.drawImage(o.image,{x:X(o.x),y:Y(o.y+o.h),width:o.w*PX,height:o.h*PX});
        } else {
          const size=o.px*PX;
          const w=o.font.widthOfTextAtSize(o.value,size);
          if(!w)continue;
          page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(o.w*PX/w,0,0,1,X(o.x),0));
          page.drawText(o.value,{x:0,y:Y(o.baseline),size,font:o.font,color:o.ink});
          page.pushOperators(lib.popGraphicsState());
        }
      } else if(o.kind==='fill'){
        page.drawRectangle({x:X(o.x),y:Y(o.y+o.h),width:o.w*PX,height:o.h*PX,color:o.ink});
      } else if(o.kind==='rule'){
        if(o.ink)page.drawLine({start:{x:X(o.x1),y:Y(o.y1)},end:{x:X(o.x2),y:Y(o.y2)},thickness:o.size*PX,color:o.ink,dashArray:o.dash?.map(n=>n*PX)});
      } else if(o.kind==='circle'){
        page.drawEllipse({x:X(o.x+o.w/2),y:Y(o.y+o.h/2),xScale:o.w*PX/2,yScale:o.h*PX/2,color:o.ink});
      } else if(o.kind==='image'){
        page.drawImage(o.image,{x:X(o.x),y:Y(o.y+o.h),width:o.w*PX,height:o.h*PX});
      }
    }
    page.pushOperators(lib.popGraphicsState());
  }

  async function bytes(report, source) {
    const paper=source ? source.cloneNode(true) : window.JInsights.reportPaper(report);
    const stage=document.createElement('div');
    stage.className='ji-pdf-stage';stage.setAttribute('aria-hidden','true');stage.inert=true;
    stage.append(paper);
    for(const el of paper.querySelectorAll('[id]'))el.removeAttribute('id');
    document.body.append(stage);
    try{
      const doc=await PDFLib.PDFDocument.create();
      doc.setTitle(report.title);doc.setSubject(report.periodLabel);doc.setAuthor(report.author?.name || 'Work Hub');doc.setCreator('Work Hub');
      const fonts=await fontsFor(doc);
      await document.fonts.ready;
      await Promise.all([...paper.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
      const layout=await collect(paper,doc,fonts);
      layout.symbols=mapFallbackText(doc,layout.lines);
      for(const {start,end,header} of paginate(layout)){
        const page=doc.addPage([WIDTH,HEIGHT]),inset=header?header.headEnd-header.top:0;
        if(header)drawBand(page,layout,header.top,header.headEnd,0);
        drawBand(page,layout,start,end,inset);
      }
      return await doc.save();
    }finally{stage.remove();}
  }
  async function download(report,paper) {
    const data=await bytes(report,paper);
    const url=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));
    const link=document.createElement('a');
    link.href=url;link.download=(report.filename || 'Informe_de_gestion.pdf').replace(/[\\/:*?"<>|]/g,'_');
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  globalThis.JReportPDF=Object.freeze({bytes,download});
})();
