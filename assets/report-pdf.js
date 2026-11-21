/* Informe A4 generado en el navegador. El contenido se dibuja como texto seleccionable.
   pdf-lib y sus avisos de licencia se distribuyen en assets/vendor/. */
(() => {
  'use strict';

  const PAGE = { width: 595.276, height: 841.89, margin: 38, bottom: 783 };
  const COLORS = {
    navy: '#102F40', text: '#253E49', muted: '#526976', teal: '#006E69',
    line: '#CDDADC', tint: '#EFF6F4', head: '#E3F0ED', brandMint: '#9AE4D2', brandDark: '#07444A', white: '#FFFFFF'
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
      rect(x,top,23,23,'brandMint');
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
        page.drawSvgPath(path,{x,y:PAGE.height-top,scale,color:palette[i===2?'teal':'brandDark']});
      }
      write('Work Hub', x+31,top+4,16,true,'navy');
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
        if (stripe) rect(PAGE.margin,y,2,part.length*leading,'teal');
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
          rect(x,y,box,h,'tint'); rect(x,y,box,2,'teal');
          writeLines(metric.label,x+8,y+9,9.2,11.5,true,'muted');
          writeLines(metric.value,x+8,y+labelHeight+13,16.5,18,true,'navy');
          writeLines(metric.note,x+8,y+labelHeight+valueHeight+17,8.5,10.7,false,'muted');
        });
        y+=h+12;
      }
    }

    function table(section) {
      const columns=section.columns || [];
      const rows=section.rows || [];
      if (!columns.length) return;
      const widths=columnWidths(section);
      const xs=widths.map((w,i) => PAGE.margin+widths.slice(0,i).reduce((s,v)=>s+v,0));
      const padding=7, textSize=9.4, leading=12.2, rowPad=8;
      const numeric=columns.map(c=>/^(tiempo|%|actividades$|plan cumplido|imprevistos|duración|minutos)/i.test(c));
      const headerLines=columns.map((c,i)=>wrap(c,widths[i]-padding*2,8.8,true));
      const headerH=Math.max(...headerLines.map(h=>h.length))*11.1+9;
      function sectionHead(continued) {
        const title=section.title+(continued?' · continuación':'');
        const lines=wrap(title,mainWidth,14,true);
        writeLines(lines,PAGE.margin,y,14,17,true,'navy');
        y+=lines.length*17+3;
        if (!continued && rows.length && section.subtitle) {
          const sub=wrap(section.subtitle,mainWidth,9.1);
          writeLines(sub,PAGE.margin,y,9.1,12,false,'muted');
          y+=sub.length*12+4;
        }
        if (!rows.length) return;
        rect(PAGE.margin,y,mainWidth,headerH,'head');
        columns.forEach((k,i)=>{
          const right=numeric[i] && i>0;
          writeLines(headerLines[i],xs[i]+(right?widths[i]-padding:padding),y+4.8,
            8.8,11.1,true,'teal',right?'right':'left');
        });
        y+=headerH;
      }
      const titleH=wrap(section.title,mainWidth,14,true).length*17+3;
      const subH=rows.length && section.subtitle?wrap(section.subtitle,mainWidth,9.1).length*12+4:0;
      const rowLines=row=>columns.map((c,i)=>wrap(row[i],widths[i]-padding*2,textSize,i===0));
      const rowHeight=lines=>Math.max(...lines.map(cell=>cell.length))*leading+rowPad;
      const first=rows.length?rowLines(rows[0]):null;
      let bodyNeed=rows.length?headerH+Math.min(rowHeight(first),155):24;
      if (rows.length>1 && rows.length<=5) {
        const allRows=rows.reduce((h,row,i)=>h+rowHeight(i===0?first:rowLines(row)),0);
        // Un cuadro breve se lee mejor completo que con una sola fila al pie de la página.
        if (allRows+headerH<=210) bodyNeed=headerH+allRows;
      }
      room(titleH+subH+bodyNeed);
      sectionHead(false);
      if (!rows.length) { flowing(section.empty || 'Sin registros en este período.',9.6,13,false,'muted'); y+=15; return; }
      function continueTable() { nextPage(); sectionHead(true); }
      for (const [i,row] of rows.entries()) {
        const cells=i===0?first:rowLines(row);
        const count=Math.max(...cells.map(c=>c.length));
        // Se conserva la fila completa cuando cabe en la página siguiente. Los comentarios
        // de más de una página fluyen por líneas, repitiendo título y encabezados de la tabla.
        const fresh=bodyEnd-83-40-headerH;
        if (i>0 && rowHeight(cells)>bodyEnd-y && rowHeight(cells)<=fresh) continueTable();
        let offset=0;
        while (offset<count) {
          if (bodyEnd-y<leading+rowPad) continueTable();
          const n=Math.min(count-offset,Math.floor((bodyEnd-y-rowPad)/leading));
          const h=n*leading+rowPad;
          if (i%2===1) rect(PAGE.margin,y,mainWidth,h,'tint');
          cells.forEach((cell,j)=>{
            const right=numeric[j] && j>0;
            writeLines(cell.slice(offset,offset+n),xs[j]+(right?widths[j]-padding:padding),y+rowPad/2,
              textSize,leading,j===0,j===0?'navy':'text',right?'right':'left');
          });
          y+=h; rule(PAGE.margin,y,PAGE.width-PAGE.margin);
          offset+=n;
          if (offset<count) continueTable();
        }
      }
      y+=15;
    }

    nextPage();
    flowing(report.title || 'Informe de gestión',26,31,true,'navy');
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
