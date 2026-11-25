/* Las respuestas admiten texto con formato y citas verificadas, sin HTML del modelo. */
(() => {
  'use strict';
  const esc = value => window.JUI.esc(value);
  const listMarker = /^( *)([-+*]|\d{1,9}[.)])( +)(\S.*)$/;
  const heading = /^ {0,3}(#{1,6})\s+(\S.*)$/;
  const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
  const quote = /^ {0,3}> ?/;
  const rule = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

  function inline(line, citation, depth = 0) {
    if (depth > 4) return esc(line);
    // Se reconoce el marcado antes de escapar cada fragmento de texto. Sólo citation produce botones.
    const tokens = /\\[\\`*_\[\]|]|(`+)([^`\n]+)\1|!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)|\[\d{1,15}\]|\*\*(?=\S)[^\n]*?\S\*\*|__(?=\S)[^\n]*?\S__|\*(?=[^\s*])[^*\n]*?[^\s*]\*|_(?=[^\s_])[^_\n]*?[^\s_]_/g;
    let html = '', end = 0;
    for (const match of line.matchAll(tokens)) {
      const token = match[0];
      html += esc(line.slice(end, match.index));
      end = match.index + token.length;
      if (token.startsWith('\\')) html += esc(token.slice(1));
      else if (match[1]) html += '<code>'+esc(match[2])+'</code>';
      else if (token.includes('](') && /^[!\[]/.test(token)) {
        const label = token.slice(token.indexOf('[')+1,token.indexOf(']('));
        html += esc(label || token);
      } else if (token.startsWith('[')) {
        html += citation?.(Number(token.slice(1,-1))) || esc(token);
      } else if (token.startsWith('_') && (/\w/.test(line[match.index-1] || '') || /\w/.test(line[end] || ''))) {
        html += esc(token);
      } else {
        const strong = token.startsWith('**') || token.startsWith('__');
        const markerSize = strong ? 2 : 1;
        const tag = strong ? 'strong' : 'em';
        html += '<'+tag+'>'+inline(token.slice(markerSize,-markerSize),citation,depth+1)+'</'+tag+'>';
      }
    }
    return html+esc(line.slice(end));
  }

  function cells(line) {
    const text = line.trim();
    const columns = [];
    let cell = '';
    for (let i = text.startsWith('|') ? 1 : 0; i < text.length; i++) {
      const char = text[i];
      if (char === '\\' && i+1 < text.length) cell += char+text[++i];
      else if (char === '|') { columns.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    if (cell || !text.endsWith('|')) columns.push(cell.trim());
    return columns;
  }

  function tableHeader(lines, at) {
    const separator = lines[at+1];
    if (!separator || !separator.includes('|') || !lines[at].includes('|')) return null;
    const columns = cells(separator), labels = cells(lines[at]);
    return columns.length && columns.length === labels.length && columns.every(s=>/^:?-{3,}:?$/.test(s)) ? labels : null;
  }

  function startsBlock(lines, at) {
    const line = lines[at];
    return heading.test(line) || listMarker.test(line) || quote.test(line) || fence.test(line) || rule.test(line) || tableHeader(lines,at);
  }

  function list(lines, start, citation, depth) {
    const first = listMarker.exec(lines[start]);
    const indent = first[1].length, ordered = /^\d/.test(first[2]), firstNumber = parseInt(first[2],10);
    const tag = ordered ? 'ol' : 'ul';
    let html = '<'+tag+(ordered && firstNumber !== 1 ? ' start="'+firstNumber+'"' : '')+'>', at = start;
    while (at < lines.length) {
      const marker = listMarker.exec(lines[at]);
      if (!marker || marker[1].length !== indent || /^\d/.test(marker[2]) !== ordered) break;
      const body = [marker[4]];
      const contentIndent = marker[0].length-marker[4].length;
      at++;
      while (at < lines.length) {
        const line = lines[at];
        if (!line.trim()) {
          let next = at+1;
          while (next < lines.length && !lines[next].trim()) next++;
          if (next === lines.length || lines[next].search(/\S/) <= indent) { at = next; break; }
          body.push(''); at = next; continue;
        }
        const spaces = line.search(/\S/);
        if (spaces < indent || (spaces === indent && startsBlock(lines,at))) break;
        body.push(line.slice(Math.min(spaces,contentIndent)));
        at++;
      }
      html += '<li>'+blocks(body,citation,depth+1)+'</li>';
    }
    return {html:html+'</'+tag+'>',at};
  }

  function blocks(lines, citation, depth = 0) {
    if (depth > 12) return '<p>'+esc(lines.join('\n'))+'</p>';
    let html = '', at = 0;
    while (at < lines.length) {
      const line = lines[at];
      if (!line.trim()) { at++; continue; }
      const fenced = fence.exec(line), title = heading.exec(line);
      if (fenced) {
        const content = [], marker = fenced[1];
        at++;
        while (at < lines.length) {
          const close = lines[at].trim();
          if (close.startsWith(marker) && [...close].every(char=>char === marker[0])) { at++; break; }
          content.push(lines[at++]);
        }
        html += '<pre><code>'+esc(content.join('\n'))+'</code></pre>';
      } else if (title) {
        const level = Math.max(3,Math.min(5,title[1].length+1));
        html += '<h'+level+'>'+inline(title[2].replace(/\s+#+\s*$/,''),citation)+'</h'+level+'>';
        at++;
      } else if (rule.test(line)) {
        html += '<hr>'; at++;
      } else if (quote.test(line)) {
        const content = [];
        while (at < lines.length && quote.test(lines[at])) content.push(lines[at++].replace(quote,''));
        html += '<blockquote>'+blocks(content,citation,depth+1)+'</blockquote>';
      } else if (listMarker.test(line)) {
        const result = list(lines,at,citation,depth);
        html += result.html; at = result.at;
      } else {
        const labels = tableHeader(lines,at);
        if (labels) {
          at += 2;
          const headers = labels.map(s=>'<th scope="col">'+inline(s,citation)+'</th>').join('');
          let body = '';
          while (at < lines.length && lines[at].includes('|')) {
            const row = cells(lines[at]);
            if (row.length !== labels.length) break;
            body += '<tr>'+row.map(s=>'<td>'+inline(s,citation)+'</td>').join('')+'</tr>'; at++;
          }
          html += '<div class="jchat-table-wrap" role="region" aria-label="Tabla de la respuesta" tabindex="0"><table><thead><tr>'+headers+'</tr></thead><tbody>'+body+'</tbody></table></div>';
        } else {
          const content = [inline(line.trim(),citation)]; at++;
          while (at < lines.length && lines[at].trim() && !startsBlock(lines,at)) content.push(inline(lines[at++].trim(),citation));
          html += '<p>'+content.join('<br>')+'</p>';
        }
      }
    }
    return html;
  }

  function render(text, {citation} = {}) {
    const lines = String(text ?? '').replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/^\t+/,tabs=>'    '.repeat(tabs.length)));
    return blocks(lines,citation);
  }
  window.JChatFormat = Object.freeze({render});
})();
