/* Informe A4 generado en el navegador. El contenido se dibuja como texto seleccionable.
   pdf-lib y sus avisos de licencia se distribuyen en assets/vendor/. */
(() => {
  'use strict';

  const PAGE = { width: 595.276, height: 841.89, margin: 38, bottom: 783 };
  const COLORS = {
    ink: '#191D24', text: '#2A3037', muted: '#545D67', accent: '#343A42',
    line: '#CFD3D8', guide: '#8D979F', tint: '#F5F6F7', head: '#E9EBED', brand: '#101317',
    chevronTop: '#F7F8FA', chevronMiddle: '#DEE2E6', chevronBase: '#ADB5BE'
  };
  const mainWidth = PAGE.width - 2 * PAGE.margin;

  function clean(value) {
    return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  // Acepta pesos relativos o porcentajes. La anchura mínima permite envolver palabras.
  function columnWidths(section) {
    const n = section.columns.length;
    const weights = section.widths;
    if (!Array.isArray(weights) || weights.length !== n ||
        weights.some(w => !Number.isFinite(w) || w <= 0)) return Array(n).fill(mainWidth / n);
    const total = weights.reduce((sum, w) => sum + w, 0);
    const min = Math.min(45, mainWidth / (n * 2));
    const widths = weights.map(w => Math.max(min, mainWidth * w / total));
    const sum = widths.reduce((a, b) => a + b, 0);
    return widths.map(w => mainWidth * w / sum);
  }

  async function bytes(report) {
    const lib = globalThis.PDFLib;
    if (!lib) throw new Error('Falta el generador de PDF. Revisa que se haya publicado la carpeta assets/vendor.');
    if (!report || !Array.isArray(report.metrics) || !Array.isArray(report.sections)) {
      throw new Error('Faltan los datos del informe.');
    }
    const doc = await lib.PDFDocument.create();
    doc.setTitle(clean(report.title)); doc.setAuthor('Work Hub');
    doc.setSubject(clean(report.periodLabel)); doc.setCreator('Work Hub');
    doc.setProducer('Work Hub · pdf-lib');
    const palette = Object.fromEntries(Object.entries(COLORS).map(([key, hex]) =>
      [key, lib.rgb(...[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255))]));
    const fonts = await Promise.all([lib.StandardFonts.Helvetica, lib.StandardFonts.HelveticaBold,
      lib.StandardFonts.Symbol, lib.StandardFonts.ZapfDingbats].map(name => doc.embedFont(name)));
    const charsets = fonts.map(f => new Set(f.getCharacterSet()));
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const measureCtx = canvas?.getContext('2d');
    const deferredGlyphs = [];
    const segmenter = typeof Intl.Segmenter === 'function' ?
      new Intl.Segmenter('es', {granularity: 'grapheme'}) : null;
    const measureCache = new Map();
    const glyphAdvance = fonts.map(() => new Map());

    function graphemes(text) {
      if (/^[\x20-\x7E\xA0-\xFF]*$/.test(text) || !segmenter) return Array.from(text);
      return Array.from(segmenter.segment(text), item => item.segment);
    }
    function browserFont(bold) {
      return (bold ? 'bold ' : '') + '64px "Segoe UI", Arial, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    }
    function codeNotation(character) {
      return Array.from(character, c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ');
    }

    // Se conservan las tildes con Helvetica y los signos con Symbol o ZapfDingbats.
    // Para otros alfabetos se usa la tipografía del dispositivo, sin peticiones externas.
    function chunks(value, bold) {
      const text = clean(value);
      const normal = bold ? 1 : 0;
      if (/^[\x20-\x7E\xA0-\xFF]*$/.test(text) && !text.includes('\u00ad')) return [{font:normal, text}];
      const runs = [];
      for (let part of graphemes(text)) {
        let font = -1;
        const cp = part.codePointAt(0);
        if (Array.from(part).length === 1) {
          font = charsets[normal].has(cp) ? normal : charsets[2].has(cp) ? 2 : charsets[3].has(cp) ? 3 : -1;
        }
        if (font < 0 && !measureCtx) { part = '[' + codeNotation(part) + ']'; font = normal; }
        const last = runs.at(-1);
        if (last?.font === font) last.text += part;
        else runs.push({font, text:part});
      }
      return runs;
    }
    function runWidth(run, size, bold) {
      if (run.font >= 0) {
        // Los segmentos PDF se imprimen con los avances de cada glifo, sin pares de kerning.
        const advance = glyphAdvance[run.font];
        let total = 0;
        for (const glyph of run.text) {
          if (!advance.has(glyph)) advance.set(glyph, fonts[run.font].widthOfTextAtSize(glyph, 1));
          total += advance.get(glyph);
        }
        return total * size;
      }
      measureCtx.font = browserFont(bold);
      return measureCtx.measureText(run.text).width * size / 64;
    }
    function width(value, size, bold = false) {
      const key = (bold?'b':'r') + size + '#' + value;
      if (measureCache.has(key)) return measureCache.get(key);
      const result = chunks(value,bold).reduce((sum,run) => sum + runWidth(run,size,bold),0);
      if (measureCache.size < 18000) measureCache.set(key,result);
      return result;
    }
    function wrap(value, maxWidth, size, bold = false) {
      const result = [];
      const space = width(' ',size,bold);
      for (const paragraph of clean(value).split('\n')) {
        let line = '', used = 0;
        for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
          const needed = width(word,size,bold);
          if (line && used + space + needed <= maxWidth) {
            line += ' ' + word; used += space + needed; continue;
          }
          if (line) result.push(line);
          line = ''; used = 0;
          if (needed <= maxWidth) { line = word; used = needed; continue; }
          // Los identificadores o direcciones extensas también se parten dentro de la celda.
          for (const character of graphemes(word)) {
            const w = width(character,size,bold);
            if (line && used + w > maxWidth) { result.push(line); line = ''; used = 0; }
            line += character; used += w;
          }
        }
        result.push(line);
      }
      return result;
    }

    const footerLines = report.footnote ? wrap(report.footnote,mainWidth,8.5) : [];
    const noteInFooter = footerLines.length > 0 && footerLines.length <= 4;
    const bodyEnd = noteInFooter ? Math.min(PAGE.bottom, 798 - footerLines.length*11 - 11) : PAGE.bottom;
    let page, y;
    function rect(x, top, w, h, fill) {
      page.drawRectangle({x, y:PAGE.height-top-h, width:w, height:h, color:palette[fill]});
    }
    function rule(x, top, endX, color='line', thickness=0.65) {
      page.drawLine({start:{x,y:PAGE.height-top},end:{x:endX,y:PAGE.height-top},thickness,color:palette[color]});
    }
    function write(text, x, top, size=10, bold=false, ink='text', align='left') {
      let left = align==='right' ? x-width(text,size,bold) : x;
      const baseline = PAGE.height-top-size*0.84;
      for (const run of chunks(text,bold)) {
        if (run.font >= 0) page.drawText(run.text,{x:left,y:baseline,font:fonts[run.font],size,color:palette[ink]});
        else deferredGlyphs.push({page,run,left,baseline,size,bold,ink});
        left += runWidth(run,size,bold);
      }
    }
    function writeLines(lines,x,top,size,leading,bold=false,ink='text',align='left') {
      lines.forEach((line,i) => write(line,x,top+i*leading,size,bold,ink,align));
    }
    function brand(top) {
      const x=PAGE.margin, scale=23/48;
      page.drawSvgPath('M5 0H43Q48 0 48 5V43Q48 48 43 48H5Q0 48 0 43V5Q0 0 5 0Z',
        {x,y:PAGE.height-top,scale,color:palette.brand});
      const polygons = [
        [[12,13.5],[14,11.5],[30.5,11.5],[30.5,17],[18,17],[18,33.5],[12,33.5]],
        [[20.5,20.5],[36.1,20.5],[36.1,25.9],[26,25.9],[26,36.5],[20.5,36.5]],
        [[29.3,29.3],[36,29.3],[36,36.1],[29.3,36.1]]
      ];
      for (const [i, points] of polygons.entries()) {
        const path = points.map(([px,py],j) => {
          const dx=px-24,dy=py-24;
          return (j?'L':'M') + (24+(dx-dy)*Math.SQRT1_2)+' '+(24+(dx+dy)*Math.SQRT1_2);
        }).join(' ') + ' Z';
        page.drawSvgPath(path,{x,y:PAGE.height-top,scale,color:palette[['chevronTop','chevronMiddle','chevronBase'][i]]});
      }
      write('Work Hub', x+31,top+4,16,true,'ink');
    }
    function nextPage() {
      page=doc.addPage([PAGE.width,PAGE.height]);
      brand(31);
      write(clean(report.periodLabel),PAGE.width-PAGE.margin,38,9,false,'muted','right');
      rule(PAGE.margin,65,PAGE.width-PAGE.margin);
      y=83;
    }
    function room(height) { if (y+height > bodyEnd) nextPage(); }
    function flowing(value, size, leading, bold=false, ink='text', inset=0, stripe=false) {
      const lines=wrap(value,mainWidth-inset-6,size,bold);
      let offset=0;
      while (offset<lines.length) {
        room(leading+2);
        const available=Math.max(1,Math.floor((bodyEnd-y)/leading));
        const part=lines.slice(offset,offset+available);
        if (stripe) rect(PAGE.margin,y,2,part.length*leading,'accent');
        writeLines(part,PAGE.margin+inset,y,size,leading,bold,ink);
        y+=part.length*leading; offset+=part.length;
      }
    }

    function metrics(items) {
      const cols=Math.min(items.length,4);
      if (!cols) return;
      const gap=8, box=(mainWidth-(cols-1)*gap)/cols;
      for (let start=0;start<items.length;start+=cols) {
        const group=items.slice(start,start+cols).map(metric => ({
          label:wrap(metric.label,box-16,9.2,true),
          value:wrap(metric.value,box-16,16.5,true),
          note:wrap(metric.note,box-16,8.5)
        }));
        const labelHeight=Math.max(...group.map(m=>m.label.length))*11.5;
        const valueHeight=Math.max(...group.map(m=>m.value.length))*18;
        const noteHeight=Math.max(...group.map(m=>m.note.length))*10.7;
        const h=labelHeight+valueHeight+noteHeight+25;
        room(h);
        group.forEach((metric,i) => {
          const x=PAGE.margin+i*(box+gap);
          rect(x,y,box,h,'tint'); rule(x,y,x+box,'line',0.9);
          writeLines(metric.label,x+8,y+9,9.2,11.5,true,'muted');
          writeLines(metric.value,x+8,y+labelHeight+13,16.5,18,true,'ink');
          writeLines(metric.note,x+8,y+labelHeight+valueHeight+17,8.5,10.7,false,'muted');
        });
        y+=h+12;
      }
    }

    let activitiesStarted = false;
    function table(section) {
      const columns=section.columns || [];
      const rows=section.rows || [];
      if (!columns.length) return;
      const activityGroup = section.group === 'activities';
      const firstGroup = activityGroup && !activitiesStarted;
      const headingSize = activityGroup ? 12.3 : 14;
      const headingLead = activityGroup ? 15.5 : 17;
      const inset = activityGroup ? 8 : 0;
      const widths=columnWidths(section);
      const xs=[];
      widths.reduce((x,w)=>{ xs.push(x); return x+w; },PAGE.margin);
      const padding=7, textSize=9.4, leading=12.2, rowPad=8;
      const boldColumn = activityGroup ? columns.indexOf('Actividad') : 0;
      const numeric=columns.map(c=>/^(tiempo|%|actividades$|plan cumplido|imprevistos|duración|minutos)/i.test(c));
      const headerLines=columns.map((c,i)=>wrap(c,widths[i]-padding*2,8.8,true));
      const headerH=Math.max(...headerLines.map(h=>h.length))*11.1+9;
      const rowLines=row=>columns.map((c,i)=>wrap(row[i],widths[i]-padding*2,textSize,i===boldColumn));
      const rowHeight=lines=>Math.max(...lines.map(cell=>cell.length))*leading+rowPad;
      const first=rows.length?rowLines(rows[0]):null;
      const subtitleText=clean(section.subtitle);
      const countWidth=width(subtitleText,9.1);
      const inlineCount=activityGroup && subtitleText && countWidth<mainWidth/3;
      const headingWidth=mainWidth-inset-6-(inlineCount?countWidth+16:0);
      const fullHeading=wrap(section.title,headingWidth,headingSize,true);
      const groupName=clean(section.groupTitle) || 'Actividades por objetivo general';
      const groupH=firstGroup?wrap(groupName,mainWidth-6,15.5,true).length*19+5:0;
      const subLines=rows.length && subtitleText && !inlineCount ? wrap(subtitleText,mainWidth-inset-6,9.1) : [];
      const subH=subLines.length?subLines.length*12+4:0;
      // Un nombre excepcionalmente largo se publica completo al abrir su sección.
      // En la cabecera de continuidad queda una referencia breve al mismo objetivo.
      const continuedTitle=fullHeading.length>2 ? fullHeading[0]+'…' : clean(section.title);
      const repeatLines=wrap(continuedTitle+' · continuación',headingWidth,headingSize,true);
      const repeatH=repeatLines.length*headingLead+3+(activityGroup?subH:0)+headerH;

      function drawColumns() {
        rect(PAGE.margin,y,mainWidth,headerH,'head');
        columns.forEach((name,i)=>{
          const right=numeric[i] && i>0;
          writeLines(headerLines[i],xs[i]+(right?widths[i]-padding:padding),y+4.8,
            8.8,11.1,true,'accent',right?'right':'left');
        });
        y+=headerH;
      }
      function drawCount() {
        if (inlineCount) write(subtitleText,PAGE.width-PAGE.margin,y+1.2,9.1,false,'muted','right');
      }
      function drawSubtitle() {
        if (!subLines.length) return;
        writeLines(subLines,PAGE.margin+inset,y,9.1,12,false,'muted');
        y+=subH;
      }
      function continueTable(insideRow=false) {
        nextPage();
        drawCount();
        if (inset) rect(PAGE.margin,y,2,repeatLines.length*headingLead,'accent');
        writeLines(repeatLines,PAGE.margin+inset,y,headingSize,headingLead,true,'ink');
        y+=repeatLines.length*headingLead+3;
        if (activityGroup) drawSubtitle();
        drawColumns();
        if (insideRow) {
          write('Continúa la fila de la página anterior',PAGE.margin+padding,y+3,8.1,false,'muted');
          y+=15;
        }
      }

      let bodyNeed=rows.length?headerH+Math.min(rowHeight(first),155):24;
      if (rows.length>1 && rows.length<=5) {
        const allRows=rows.reduce((h,row,i)=>h+rowHeight(i===0?first:rowLines(row)),0);
        if (allRows+headerH<=210) bodyNeed=headerH+allRows;
      }
      const headHeight=fullHeading.length*headingLead+3;
      const sectionStartHeight=groupH+headHeight+subH+bodyNeed;
      // Si todo el encabezado es mayor que una página, comienza aquí y continúa por líneas.
      room(sectionStartHeight <= bodyEnd-83 ? sectionStartHeight : groupH+2*headingLead);
      if (firstGroup) {
        flowing(groupName,15.5,19,true,'ink'); y+=5; activitiesStarted=true;
      }
      drawCount();
      let headingOffset=0;
      while (headingOffset<fullHeading.length) {
        room(headingLead+2);
        const lines=fullHeading.slice(headingOffset,headingOffset+Math.max(1,Math.floor((bodyEnd-y)/headingLead)));
        if (activityGroup) rect(PAGE.margin,y,2,lines.length*headingLead,'accent');
        writeLines(lines,PAGE.margin+inset,y,headingSize,headingLead,true,'ink');
        y+=lines.length*headingLead; headingOffset+=lines.length;
      }
      y+=3;
      if (!rows.length) { flowing(section.empty || 'Sin registros en este período.',9.6,13,false,'muted'); y+=15; return; }
      if (y+subH+headerH+leading+rowPad>bodyEnd) continueTable();
      else { drawSubtitle(); drawColumns(); }
      // El encabezado de un grupo pertenece a la página física en que se imprime.
      // Dibujar la guía al terminar evita que el sombreado de otra fila la tape.
      const joins = activityGroup && section.joins;
      let guide = null;
      function finishGuide() {
        if (guide && guide.to > guide.from) {
          const x = xs[0]+padding+3;
          guide.page.drawLine({start:{x,y:PAGE.height-guide.from},end:{x,y:PAGE.height-guide.to},
            color:palette.guide,thickness:1,lineCap:lib.LineCapStyle.Round,dashArray:[0.1,3]});
        }
        guide = null;
      }
      for (const [i,row] of rows.entries()) {
        const cells=i===0?first:rowLines(row);
        const label=cells[0];
        const details=Math.max(1,...cells.slice(1).map(c=>c.length));
        // La fila que cabe en una página nueva se conserva completa. Las más largas
        // continúan línea por línea, con objetivo general y columnas en cada página.
        const fresh=bodyEnd-83-repeatH;
        const linked=joins?.[i] && guide?.page===page;
        const heightHere=Math.max(linked?0:label.length,details)*leading+rowPad;
        if (i>0 && heightHere>bodyEnd-y && rowHeight(cells)<=fresh) continueTable();
        let detailOffset=0, labelOffset=0, firstPiece=true;
        do {
          if (bodyEnd-y<leading+rowPad) continueTable(!firstPiece);
          const samePageGroup = firstPiece && joins?.[i] && guide?.page===page;
          if (samePageGroup) labelOffset=label.length;
          let shownLabel=samePageGroup ? [] : label.slice(labelOffset);
          // Una fila que cruza la página vuelve a identificar su fecha o actividad.
          // Un título que ocupa más de una página se escribe completo, por partes.
          if (joins && !firstPiece && !shownLabel.length) {
            shownLabel=label.length*leading+rowPad<=fresh-15 ? label : [label[0]+'…'];
          }
          const available=Math.floor((bodyEnd-y-rowPad)/leading);
          const n=Math.min(Math.max(shownLabel.length,details-detailOffset),available);
          const h=n*leading+rowPad;
          if (i%2===1) rect(PAGE.margin,y,mainWidth,h,'tint');
          if (joins) {
            if (samePageGroup) guide.to=y+h-4;
            else {
              finishGuide();
              guide={page,from:y+rowPad/2+Math.min(n,shownLabel.length)*leading+1,to:0};
            }
          }
          cells.forEach((cell,j)=>{
            const right=numeric[j] && j>0;
            const lines=j===0 ? shownLabel.slice(0,n) : cell.slice(detailOffset,detailOffset+n);
            writeLines(lines,xs[j]+(right?widths[j]-padding:padding),y+rowPad/2,
              textSize,leading,j===boldColumn,j===boldColumn?'ink':'text',right?'right':'left');
          });
          labelOffset=Math.min(label.length,labelOffset+n);
          detailOffset+=n;
          const more=labelOffset<label.length || detailOffset<details;
          y+=h; rule(!more && joins?.[i+1] ? xs[1] : PAGE.margin,y,PAGE.width-PAGE.margin);
          if (!more) break;
          continueTable(true);
          firstPiece=false;
        } while (true);
      }
      finishGuide();
      y+=activityGroup?11:15;
    }

    nextPage();
    flowing(report.title || 'Informe de gestión',26,31,true,'ink');
    y+=10;
    if (report.takeaway) { flowing(report.takeaway,11.6,16.2,false,'text',11,true); y+=16; }
    metrics(report.metrics);
    y+=3;
    for (const section of report.sections) table(section);
    if (report.footnote && !noteInFooter) {
      const lineCount=wrap(report.footnote,mainWidth-6,8.8).length;
      room(Math.min(5,lineCount)*12+12);
      rule(PAGE.margin,y,PAGE.width-PAGE.margin); y+=8;
      flowing(report.footnote,8.8,12,false,'muted');
    }

    // Los glifos que no tienen los tipos estándar se renderizan en el propio dispositivo.
    // ActualText registra el texto original en PDF para lectores que interpretan contenido marcado.
    const glyphCache=new Map();
    for (const part of deferredGlyphs) {
      const key=part.run.text+'|'+part.bold+'|'+part.ink;
      let graphic=glyphCache.get(key);
      if (!graphic) {
        measureCtx.font=browserFont(part.bold);
        const m=measureCtx.measureText(part.run.text);
        const left=Math.max(0,m.actualBoundingBoxLeft || 0), ascent=Math.max(52,m.actualBoundingBoxAscent || 0);
        const right=Math.max(m.width,m.actualBoundingBoxRight || 0), descent=Math.max(14,m.actualBoundingBoxDescent || 0);
        const bitmap=document.createElement('canvas');
        bitmap.width=Math.max(1,Math.ceil(left+right)+4); bitmap.height=Math.ceil(ascent+descent)+4;
        const ctx=bitmap.getContext('2d');
        ctx.font=browserFont(part.bold);ctx.fillStyle=COLORS[part.ink];
        ctx.fillText(part.run.text,left+2,ascent+2);
        graphic={image:await doc.embedPng(bitmap.toDataURL('image/png')),
          dx:left+2,dy:bitmap.height-ascent-2,w:bitmap.width,h:bitmap.height};
        glyphCache.set(key,graphic);
      }
      const factor=part.size/64;
      part.page.pushOperators(lib.PDFOperator.of('BDC',[lib.PDFName.of('Span'),
        doc.context.obj({ActualText:lib.PDFHexString.fromText(part.run.text)})]));
      // Un ancla de texto invisible permite copiar el contenido marcado en lectores de PDF.
      part.page.drawText(' ',{x:part.left,y:part.baseline,size:part.size,font:fonts[0],opacity:0});
      part.page.drawImage(graphic.image,{x:part.left-graphic.dx*factor,y:part.baseline-graphic.dy*factor,
        width:graphic.w*factor,height:graphic.h*factor});
      part.page.pushOperators(lib.PDFOperator.of('EMC'));
    }
    const pages=doc.getPages();
    for (const [i,item] of pages.entries()) {
      page=item;
      if (noteInFooter && i === pages.length-1) {
        const top = 798-footerLines.length*11;
        rule(PAGE.margin,top-6,PAGE.width-PAGE.margin);
        writeLines(footerLines,PAGE.margin,top,8.5,11,false,'muted');
      } else {
        rule(PAGE.margin,808,PAGE.width-PAGE.margin);
      }
      write(report.title || 'Informe de gestión',PAGE.margin,817,8.6,true,'muted');
      write((i+1)+' de '+pages.length,PAGE.width-PAGE.margin,817,8.6,false,'muted','right');
    }
    return doc.save();
  }

  async function download(report) {
    const content=await bytes(report);
    const filename=clean(report.filename || 'Work_Hub_Informe.pdf').replace(/[\\/:*?"<>|]/g,'_');
    const url=URL.createObjectURL(new Blob([content],{type:'application/pdf'}));
    const link=document.createElement('a');
    link.href=url; link.download=/\.pdf$/i.test(filename)?filename:filename+'.pdf';
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  globalThis.JReportPDF=Object.freeze({bytes,download});
})();
