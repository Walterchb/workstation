const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {window:{}};
for (const name of ['ui.js','chat-format.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets',name),'utf8'),sandbox);
}
const {render} = sandbox.window.JChatFormat;
const citation = n => n === 2 ? '<button type="button">[2]</button>' : '';

test('Ordena títulos, numeración y viñetas anidadas manteniendo el comentario y su cita',()=>{
  const html = render('## Avances\n3. **Informe** listo para revisar. [2]\n   - Validación *parcial*\n     Falta el cierre.\n   - Archivo `estado_final`\n4. Pendiente [19]\n\n### Próxima revisión\r\nLunes.\nLuego, seguimiento.',{citation});
  assert.match(html,/^<h3>Avances<\/h3><ol start="3"><li>/);
  assert.match(html,/<strong>Informe<\/strong> listo para revisar\. <button type="button">\[2\]<\/button>/);
  assert.match(html,/<ul><li><p>Validación <em>parcial<\/em><br>Falta el cierre\.<\/p><\/li><li><p>Archivo <code>estado_final<\/code>/);
  assert.match(html,/<\/ul><\/li><li><p>Pendiente \[19\]<\/p><\/li><\/ol>/);
  assert.match(html,/<h4>Próxima revisión<\/h4><p>Lunes\.<br>Luego, seguimiento\.<\/p>$/);
});

test('La tabla permite navegar el desborde, usa encabezados reales y conserva separadores escapados',()=>{
  const html = render('| Fecha | Avance | Registro |\n| :--- | --- | ---: |\n| 24 nov | **Revisión** A \\| B | [2] |\n| 25 nov | Falta confirmación | — |\n\nFuera de tabla.',{citation});
  assert.match(html,/class="jchat-table-wrap"[^>]+tabindex="0"><table><thead><tr><th scope="col">Fecha<\/th>/);
  assert.match(html,/<td><strong>Revisión<\/strong> A \| B<\/td><td><button type="button">\[2\]<\/button><\/td>/);
  assert.match(html,/<\/tbody><\/table><\/div><p>Fuera de tabla\.<\/p>$/);
  assert.match(render('A | B\n--- | ---\nA | B | C'),/<\/table><\/div><p>A \| B \| C<\/p>/);
});

test('Escapa HTML incluso en tablas, citas o código; botones reservados a registros verificados',()=>{
  const html = render('## <svg onload="x">\n> <script>alert(1)</script> [2]\n\n[Visitar](javascript:alert(1)) ![Foto](https://example.com/pixel) [1](https://example.com)\n\nC | D\n--- | ---\n<img src=x onerror=x> | `</code><iframe>`\n\n```html\n<script>[2] **texto**</script>\n```',{citation});
  assert.doesNotMatch(html,/<(?:svg|img|script|iframe|a|input)\b| href=|javascript:|https:\/\//i);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/<pre><code>&lt;script&gt;\[2\] \*\*texto\*\*&lt;\/script&gt;<\/code><\/pre>/);
  assert.equal(html.match(/<button/g).length,1);
  assert.match(html,/<h3>&lt;svg onload=&quot;x&quot;&gt;<\/h3>/);
});

test('Mantiene legibles texto simple, marcadores incompletos y referencias literales',()=>{
  assert.equal(render(''), '');
  assert.equal(render('Una respuesta breve.'),'<p>Una respuesta breve.</p>');
  assert.equal(render('a_b_c, **sin cerrar y \\[2]'),'<p>a_b_c, **sin cerrar y [2]</p>');
  assert.equal(render('> 3 & 4\n\n---'),'<blockquote><p>3 &amp; 4</p></blockquote><hr>');
  assert.match(render('- Uno\n\n  Segundo párrafo.\n\n- Dos\n\nFuera.'),/<li><p>Uno<\/p><p>Segundo párrafo\.<\/p><\/li><li><p>Dos<\/p><\/li><\/ul><p>Fuera\.<\/p>/);
  assert.match(render('```\n[4]\n\nLínea 2'),/<pre><code>\[4\]\n\nLínea 2<\/code><\/pre>/);
});
