// Panel de empleados: admin y operador.
let sesion = { token: null, usuario: null };
const ui = { vista: 'inicio', sedeId: null, sedes: [], fecha: null };
const esAdmin = () => sesion.usuario?.rol === 'admin';
const hoyLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

try { sesion = JSON.parse(localStorage.getItem('sesion')) || sesion; } catch { /* sin almacenamiento */ }
const guardarSesion = () => { try { localStorage.setItem('sesion', JSON.stringify(sesion)); } catch { /* */ } };

// ---------------- Modal genérico ----------------
function abrirModal(html) { $('#modalCuerpo').innerHTML = html; $('#modal').classList.remove('oculto'); }
function cerrarModal() { $('#modal').classList.add('oculto'); $('#modalCuerpo').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

/**
 * Formulario en modal. campos: [{k, label, type, opts:[[valor,texto]], req, min, step, ayuda}]
 * onGuardar(valores) -> promesa; si lanza error se muestra y el modal sigue abierto.
 */
function formModal(titulo, campos, valores = {}, onGuardar, textoBoton = 'Guardar') {
  const input = (c) => {
    const v = valores[c.k] ?? c.def ?? '';
    const id = 'f_' + c.k;
    if (c.type === 'select') return `<select id="${id}">${c.opts.map(([o, t]) => `<option value="${esc(o)}" ${String(o) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    if (c.type === 'checkbox') return `<input type="checkbox" id="${id}" style="width:auto" ${v === true || v === '' && c.def !== false ? 'checked' : ''}>`;
    if (c.type === 'textarea') return `<textarea id="${id}" rows="2">${esc(v)}</textarea>`;
    return `<input id="${id}" type="${c.type || 'text'}" value="${esc(v)}" ${c.req ? 'required' : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.step ? `step="${c.step}"` : ''}>`;
  };
  abrirModal(`<h2>${esc(titulo)}</h2><form id="fModal">
    ${campos.map((c) => `<div style="margin-bottom:10px"><label for="f_${c.k}">${esc(c.label)}</label>${input(c)}${c.ayuda ? `<small class="suave">${esc(c.ayuda)}</small>` : ''}</div>`).join('')}
    <div id="fMsg"></div>
    <div class="acciones"><button type="button" class="sec" id="fCancelar">Cancelar</button><button>${esc(textoBoton)}</button></div></form>`);
  $('#fCancelar').onclick = cerrarModal;
  $('#fModal').onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const c of campos) {
      const el = $('#f_' + c.k);
      out[c.k] = c.type === 'checkbox' ? el.checked : c.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
    }
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { await onGuardar(out); cerrarModal(); render(); } catch (err) { aviso($('#fMsg'), err.message); if (btn) btn.disabled = false; }
  };
}

// ---------------- Sesión ----------------
async function iniciar() {
  if (!sesion.token) return mostrarLogin();
  try { sesion.usuario = await api('/api/auth/me'); guardarSesion(); } catch { return mostrarLogin(); }
  $('#vistaLogin').classList.add('oculto'); $('#vistaApp').classList.remove('oculto');
  $('#usuarioInfo').textContent = `${sesion.usuario.nombre} · ${esAdmin() ? 'Admin' : 'Operador'}`;
  document.querySelectorAll('.solo-admin').forEach((el) => el.classList.toggle('oculto', !esAdmin()));
  ui.sedes = await api('/api/sedes');
  ui.fecha = hoyLocal();
  const sel = $('#selSede');
  sel.innerHTML = (esAdmin() ? '<option value="">Todas las sedes</option>' : '') + ui.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('');
  sel.disabled = !esAdmin();
  ui.sedeId = esAdmin() ? null : sesion.usuario.sede_id;
  if (ui.sedeId) sel.value = ui.sedeId;
  ir(location.hash.slice(1) || 'inicio');
}
function mostrarLogin() { $('#vistaApp').classList.add('oculto'); $('#vistaLogin').classList.remove('oculto'); }

$('#formLogin').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#lEmail').value, password: $('#lPass').value }, token: '' });
    sesion = { token: r.token, usuario: r.usuario }; guardarSesion(); iniciar();
  } catch (err) { aviso($('#lMsg'), err.message); }
};
$('#btnSalir').onclick = () => { sesion = { token: null, usuario: null }; guardarSesion(); location.hash = ''; mostrarLogin(); };
$('#btnPass').onclick = () => formModal('Cambiar contraseña', [
  { k: 'actual', label: 'Contraseña actual', type: 'password', req: true },
  { k: 'nueva', label: 'Nueva contraseña (mín. 8)', type: 'password', req: true },
], {}, (v) => api('/api/auth/password', { method: 'POST', body: v }).then(() => alert('Contraseña actualizada')));
$('#selSede').onchange = (e) => { ui.sedeId = e.target.value ? Number(e.target.value) : null; render(); };
$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) ir(b.dataset.v); };

function ir(v) {
  if (!VISTAS[v] || (['catalogo', 'config', 'bi'].includes(v) && !esAdmin())) v = 'inicio';
  ui.vista = v; location.hash = v;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.v === v));
  render();
}
async function render() {
  const cont = $('#vista');
  try { await VISTAS[ui.vista](cont); } catch (err) {
    if (err.status === 401) return mostrarLogin();
    cont.innerHTML = `<div class="aviso error">${esc(err.message)}</div>`;
  }
}
const qsSede = () => (ui.sedeId ? `sede_id=${ui.sedeId}` : '');
const nombreSede = (id) => ui.sedes.find((s) => s.id === id)?.nombre || '';
const opcionesSedes = () => ui.sedes.map((s) => [s.id, s.nombre]);
function selectorFecha(id = 'selFecha') {
  return `<div style="flex:0 1 auto"><label for="${id}">Fecha</label><div style="display:flex;gap:4px">
    <button class="sec chico" data-dia="-1">◀</button><input type="date" id="${id}" value="${ui.fecha}" style="width:auto">
    <button class="sec chico" data-dia="1">▶</button><button class="sec chico" data-dia="0">Hoy</button></div></div>`;
}
function enlazarFecha(cont) {
  cont.querySelector('#selFecha').onchange = (e) => { ui.fecha = e.target.value || hoyLocal(); render(); };
  cont.querySelectorAll('[data-dia]').forEach((b) => { b.onclick = () => { const n = Number(b.dataset.dia); ui.fecha = n ? sumarDias(ui.fecha, n) : hoyLocal(); render(); }; });
}

// ================= VISTAS =================
const VISTAS = {};

// ---------- Inicio ----------
VISTAS.inicio = async (cont) => {
  const d = await api(`/api/dashboard?fecha=${ui.fecha}&${qsSede()}`);
  cont.innerHTML = `<div class="fila" style="margin-bottom:12px">${selectorFecha()}</div>
    <div class="kpis">
      <div class="kpi"><div class="t">Reservas activas</div><div class="v">${d.reservas.activas}</div></div>
      <div class="kpi"><div class="t">Pendientes por confirmar</div><div class="v">${d.reservas.pendientes}</div></div>
      <div class="kpi"><div class="t">Horas reservadas</div><div class="v">${Number(d.reservas.horas_reservadas).toLocaleString('es-CO')}</div></div>
      <div class="kpi"><div class="t">Ingreso canchas</div><div class="v">${dinero(d.reservas.ingreso_canchas)}</div></div>
      <div class="kpi"><div class="t">Ventas productos (${d.ventas.ventas})</div><div class="v">${dinero(d.ventas.total)}</div></div>
    </div>
    <div class="fila" style="align-items:start">
      <div class="tarjeta"><h3>Por sede</h3><table><tr><th>Sede</th><th class="num">Reservas</th><th class="num">Canchas</th><th class="num">Productos</th></tr>
        ${d.por_sede.map((s) => `<tr><td>${esc(s.nombre)}</td><td class="num">${s.reservas}</td><td class="num">${dinero(s.ingreso_canchas)}</td><td class="num">${dinero(s.ventas)}</td></tr>`).join('')}</table></div>
      <div class="tarjeta"><h3>Más vendidos</h3>${d.top_productos.length ? `<table>${d.top_productos.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="num">${p.unidades} u.</td><td class="num">${dinero(p.total)}</td></tr>`).join('')}</table>` : '<p class="suave">Sin ventas este día.</p>'}</div>
      <div class="tarjeta"><h3>⚠️ Stock bajo el mínimo</h3>${d.bajo_minimo.length ? `<table>${d.bajo_minimo.map((p) => `<tr><td>${esc(p.nombre)}<br><small class="suave">${esc(p.sede)}</small></td><td class="num"><b>${p.stock}</b> / mín ${p.stock_minimo}</td></tr>`).join('')}</table>` : '<p class="suave">Todo en orden.</p>'}</div>
    </div>`;
  enlazarFecha(cont);
};

// ---------- Reservas ----------
VISTAS.reservas = async (cont) => {
  const sedeGrilla = ui.sedeId || ui.sedes[0]?.id;
  const sede = ui.sedes.find((s) => s.id === sedeGrilla);
  if (!sede) { cont.innerHTML = '<p class="aviso info">Crea primero una sede en "Sedes y usuarios".</p>'; return; }
  const [canchas, reservas] = await Promise.all([
    api(`/api/canchas?sede_id=${sedeGrilla}`),
    api(`/api/reservas?fecha=${ui.fecha}&sede_id=${sedeGrilla}`),
  ]);
  const activas = canchas.filter((c) => c.activa);
  const vivas = reservas.filter((r) => !['cancelada', 'no_asistio'].includes(r.estado));
  const filas = [];
  for (let m = sede.hora_apertura * 60; m < sede.hora_cierre * 60; m += 30) {
    const h = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const celdas = activas.map((c) => {
      const r = vivas.find((x) => x.cancha_id === c.id && hora(x.inicio) <= h && (x.fin.slice(0, 10) > ui.fecha || hora(x.fin) > h));
      if (r) {
        const aMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
        const ini = Math.max(r.inicio.slice(0, 10) < ui.fecha ? 0 : aMin(hora(r.inicio)), sede.hora_apertura * 60);
        if (ini !== m) return ''; // celda cubierta por el rowspan de la reserva
        const fin = Math.min(r.fin.slice(0, 10) > ui.fecha ? 1440 : aMin(hora(r.fin)), sede.hora_cierre * 60);
        const n = Math.max(1, Math.ceil((fin - m) / 30));
        return `<td class="celda" rowspan="${n}" data-r="${r.id}"><div class="bloque e-${r.estado}">${hora(r.inicio)}–${hora(r.fin)} ${esc(r.cliente)}${r.pagado ? ' 💵' : ''}</div></td>`;
      }
      return `<td class="celda" data-c="${c.id}" data-h="${h}" title="Nueva reserva ${h}"></td>`;
    }).join('');
    filas.push(`<tr><th>${h}</th>${celdas}</tr>`);
  }
  cont.innerHTML = `<div class="fila" style="margin-bottom:12px">${selectorFecha()}
      <div style="flex:0 1 auto"><button id="btnNuevaReserva">+ Nueva reserva</button></div></div>
    ${!ui.sedeId && esAdmin() ? `<div class="aviso info">Mostrando <b>${esc(sede.nombre)}</b>. Elige una sede arriba para ver otra.</div>` : ''}
    <div class="tarjeta grilla"><h3>${esc(sede.nombre)} · ${fechaLarga(ui.fecha)}</h3>
      ${activas.length ? `<table><tr><th></th>${activas.map((c) => `<th>${esc(c.nombre)}<br><small>${c.tipo === 'F5' ? 'Fútbol 5' : 'Fútbol 8'}</small></th>`).join('')}</tr>${filas.join('')}</table>` : '<p class="suave">Esta sede no tiene canchas activas.</p>'}
      <p class="suave"><small>Haz clic en un espacio vacío para reservar, o en una reserva para gestionarla. 💵 = pagada.</small></p></div>
    <div class="tarjeta tabla-scroll"><h3>Listado del día (${reservas.length})</h3>
      <table><tr><th>Hora</th><th>Cancha</th><th>Cliente</th><th>Origen</th><th>Estado</th><th class="num">Precio</th><th>Pago</th><th>Código</th></tr>
      ${reservas.map((r) => `<tr data-r="${r.id}" style="cursor:pointer"><td>${hora(r.inicio)}–${hora(r.fin)}</td><td>${esc(r.cancha)}</td>
        <td>${esc(r.cliente)}<br><small class="suave">${esc(r.cliente_telefono)}</small></td><td>${esc(r.origen)}</td><td>${estadoTag(r.estado)}</td>
        <td class="num">${dinero(r.precio)}</td><td>${r.pagado ? '✅' : '—'}</td><td><code>${esc(r.codigo)}</code></td></tr>`).join('') || '<tr><td colspan="8" class="suave">Sin reservas.</td></tr>'}
      </table></div>`;
  enlazarFecha(cont);
  const nueva = (canchaId, h) => formModal('Nueva reserva', [
    { k: 'cancha_id', label: 'Cancha', type: 'select', opts: activas.map((c) => [c.id, `${c.nombre} (${c.tipo}) · ${dinero(c.precio_hora)}/h`]) },
    { k: 'fecha', label: 'Fecha', type: 'date', req: true },
    { k: 'hora', label: 'Hora inicio', type: 'select', opts: filas.map((_, i) => { const m = sede.hora_apertura * 60 + i * 30; const x = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; return [x, x]; }) },
    { k: 'duracion', label: 'Duración', type: 'select', opts: [[1, '1 hora'], [1.5, '1 ½ horas'], [2, '2 horas'], [2.5, '2 ½ horas'], [3, '3 horas']] },
    { k: 'nombre', label: 'Nombre del cliente', req: true },
    { k: 'telefono', label: 'Celular', type: 'tel', req: true },
    { k: 'email', label: 'Email (opcional)', type: 'email' },
    { k: 'origen', label: 'Origen', type: 'select', opts: [['mostrador', 'Mostrador'], ['telefono', 'Teléfono / WhatsApp']] },
    { k: 'pagado', label: 'Ya pagó', type: 'checkbox', def: false },
    { k: 'notas', label: 'Notas', type: 'textarea' },
  ], { cancha_id: canchaId, fecha: ui.fecha, hora: h, duracion: 1 }, (v) => api('/api/reservas', { method: 'POST', body: { ...v, duracion: Number(v.duracion) } }), 'Reservar');
  $('#btnNuevaReserva').onclick = () => nueva(activas[0]?.id, null);
  cont.querySelectorAll('[data-c]').forEach((td) => { td.onclick = () => nueva(Number(td.dataset.c), td.dataset.h); });
  cont.querySelectorAll('[data-r]').forEach((el) => { el.onclick = () => detalleReserva(reservas.find((r) => r.id === Number(el.dataset.r))); });
};

function detalleReserva(r) {
  const acciones = [];
  if (r.estado === 'pendiente') acciones.push(['confirmada', 'Confirmar', '']);
  if (['pendiente', 'confirmada'].includes(r.estado)) acciones.push(['completada', 'Marcar jugada', ''], ['no_asistio', 'No asistió', 'sec'], ['cancelada', 'Cancelar', 'peligro']);
  if (['cancelada', 'no_asistio'].includes(r.estado)) acciones.push(['confirmada', 'Reactivar', 'sec']);
  abrirModal(`<h2>Reserva <code>${esc(r.codigo)}</code></h2>
    <p>${estadoTag(r.estado)} ${r.pagado ? '<span class="etiqueta e-completada">Pagada</span>' : '<span class="etiqueta">Sin pagar</span>'}</p>
    <table>
      <tr><th>Sede / cancha</th><td>${esc(r.sede)} · ${esc(r.cancha)} (${r.tipo_cancha})</td></tr>
      <tr><th>Horario</th><td>${fechaLarga(r.inicio)} · ${hora(r.inicio)}–${hora(r.fin)}</td></tr>
      <tr><th>Cliente</th><td>${esc(r.cliente)}<br><a href="tel:${esc(r.cliente_telefono)}">${esc(r.cliente_telefono)}</a>
        · <a target="_blank" rel="noopener" href="https://wa.me/${esc(r.cliente_telefono.replace(/\D/g, ''))}">WhatsApp</a>${r.cliente_email ? `<br>${esc(r.cliente_email)}` : ''}</td></tr>
      <tr><th>Precio</th><td>${dinero(r.precio)}</td></tr>
      <tr><th>Origen</th><td>${esc(r.origen)}</td></tr>
      ${r.notas ? `<tr><th>Notas</th><td>${esc(r.notas)}</td></tr>` : ''}
    </table><div id="rMsg"></div>
    <div class="acciones">
      <button class="sec" id="rCerrar">Cerrar</button>
      <button class="sec" id="rPago">${r.pagado ? 'Marcar sin pagar' : '💵 Marcar pagada'}</button>
      ${acciones.map(([e, t, c]) => `<button class="${c}" data-e="${e}">${t}</button>`).join('')}
    </div>`);
  const cambiar = async (body) => {
    try { await api(`/api/reservas/${r.id}`, { method: 'PATCH', body }); cerrarModal(); render(); } catch (err) { aviso($('#rMsg'), err.message); }
  };
  $('#rCerrar').onclick = cerrarModal;
  $('#rPago').onclick = () => cambiar({ pagado: !r.pagado });
  $('#modalCuerpo').querySelectorAll('[data-e]').forEach((b) => {
    b.onclick = () => { if (b.dataset.e !== 'cancelada' || confirm('¿Cancelar esta reserva?')) cambiar({ estado: b.dataset.e }); };
  });
}

// ---------- Ventas (punto de venta) ----------
const carrito = new Map();
VISTAS.ventas = async (cont) => {
  if (!ui.sedeId) {
    cont.innerHTML = `<div class="aviso info">Elige una sede en la parte superior para registrar ventas.</div>
      <div class="fila" style="margin-bottom:12px">${selectorFecha()}</div><div id="listaVentas"></div>`;
    enlazarFecha(cont);
    return pintarVentas($('#listaVentas'));
  }
  const inv = await api(`/api/inventario?sede_id=${ui.sedeId}`);
  const porId = new Map(inv.map((p) => [p.producto_id, p]));
  for (const id of carrito.keys()) if (!porId.has(id)) carrito.delete(id);
  const total = [...carrito].reduce((s, [id, n]) => s + porId.get(id).precio_venta * n, 0);
  const cats = [...new Set(inv.map((p) => p.categoria))];
  cont.innerHTML = `<div class="fila" style="align-items:start">
    <div class="tarjeta" style="flex:2 1 400px"><h3>Productos · ${esc(nombreSede(ui.sedeId))}</h3>
      <input id="buscarProd" placeholder="Buscar producto o SKU…" style="margin-bottom:10px">
      <div id="gridProd">${cats.map((cat) => `<h4 style="margin:10px 0 6px" class="suave">${esc(cat)}</h4><div class="opciones">
        ${inv.filter((p) => p.categoria === cat).map((p) => `<button class="opcion" data-p="${p.producto_id}" data-n="${esc((p.nombre + ' ' + p.sku).toLowerCase())}" ${p.stock <= 0 ? 'disabled' : ''}>
          ${esc(p.nombre)}<br><small>${dinero(p.precio_venta)} · stock ${p.stock}</small></button>`).join('')}</div>`).join('')}</div>
    </div>
    <div class="tarjeta" style="flex:1 1 300px"><h3>Venta actual</h3>
      ${carrito.size ? `<table class="carrito">${[...carrito].map(([id, n]) => { const p = porId.get(id); return `<tr><td>${esc(p.nombre)}</td>
        <td><input type="number" min="0" max="${p.stock}" value="${n}" data-q="${id}"></td><td class="num">${dinero(p.precio_venta * n)}</td></tr>`; }).join('')}
        <tr><th colspan="2">Total</th><th class="num" style="font-size:18px">${dinero(total)}</th></tr></table>
        <label for="metodo" style="margin-top:10px">Método de pago</label>
        <select id="metodo"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia / Nequi / Daviplata</option><option value="otro">Otro</option></select>
        <div id="vMsg"></div>
        <div class="acciones" style="display:flex;gap:8px;margin-top:12px"><button class="sec" id="vVaciar">Vaciar</button><button id="vCobrar" style="flex:1">Cobrar ${dinero(total)}</button></div>`
        : '<p class="suave">Toca un producto para agregarlo.</p>'}
    </div></div>
    <div class="fila" style="margin-bottom:12px">${selectorFecha()}</div><div id="listaVentas"></div>`;
  enlazarFecha(cont);
  $('#buscarProd').oninput = (e) => { const q = e.target.value.toLowerCase(); cont.querySelectorAll('[data-n]').forEach((b) => b.classList.toggle('oculto', !b.dataset.n.includes(q))); };
  cont.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => {
    const id = Number(b.dataset.p); const n = (carrito.get(id) || 0) + 1;
    if (n > porId.get(id).stock) return alert('No hay más stock de este producto');
    carrito.set(id, n); render(); }; });
  cont.querySelectorAll('[data-q]').forEach((i) => { i.onchange = () => {
    const id = Number(i.dataset.q); const n = Math.max(0, Math.min(Number(i.value) || 0, porId.get(id).stock));
    if (n) carrito.set(id, n); else carrito.delete(id); render(); }; });
  if (carrito.size) {
    $('#vVaciar').onclick = () => { carrito.clear(); render(); };
    $('#vCobrar').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await api('/api/ventas', { method: 'POST', body: { sede_id: ui.sedeId, metodo_pago: $('#metodo').value, items: [...carrito].map(([producto_id, cantidad]) => ({ producto_id, cantidad })) } });
        carrito.clear(); render();
      } catch (err) { aviso($('#vMsg'), err.message); e.target.disabled = false; }
    };
  }
  pintarVentas($('#listaVentas'));
};

async function pintarVentas(el) {
  const ventas = await api(`/api/ventas?desde=${ui.fecha}&${qsSede()}`);
  const validas = ventas.filter((v) => !v.anulada);
  el.innerHTML = `<div class="tarjeta tabla-scroll"><h3>Ventas del ${fechaLarga(ui.fecha)} · ${validas.length} · ${dinero(validas.reduce((s, v) => s + v.total, 0))}</h3>
    <table><tr><th>#</th><th>Hora</th>${ui.sedeId ? '' : '<th>Sede</th>'}<th>Productos</th><th>Pago</th><th>Vendedor</th><th class="num">Total</th>${esAdmin() ? '<th></th>' : ''}</tr>
    ${ventas.map((v) => `<tr style="${v.anulada ? 'text-decoration:line-through;color:#94a3b8' : ''}"><td>${v.id}</td><td>${fechaHora(v.creado_en).split(' ').pop()}</td>
      ${ui.sedeId ? '' : `<td>${esc(v.sede)}</td>`}<td>${v.items.map((i) => `${i.cantidad}× ${esc(i.producto)}`).join(', ')}</td><td>${esc(v.metodo_pago)}</td>
      <td>${esc(v.vendedor)}</td><td class="num">${dinero(v.total)}</td>
      ${esAdmin() ? `<td>${v.anulada ? 'Anulada' : `<button class="sec chico" data-anular="${v.id}">Anular</button>`}</td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="suave">Sin ventas.</td></tr>'}
    </table></div>`;
  el.querySelectorAll('[data-anular]').forEach((b) => { b.onclick = async () => {
    if (!confirm(`¿Anular la venta #${b.dataset.anular}? El stock se devolverá al inventario.`)) return;
    try { await api(`/api/ventas/${b.dataset.anular}/anular`, { method: 'POST' }); render(); } catch (err) { alert(err.message); }
  }; });
}

// ---------- Inventario ----------
VISTAS.inventario = async (cont) => {
  const [inv, movs] = await Promise.all([
    api(`/api/inventario?${qsSede()}`),
    api(`/api/inventario/movimientos?desde=${ui.fecha}&${qsSede()}`),
  ]);
  const varias = !ui.sedeId;
  cont.innerHTML = `<div class="tarjeta tabla-scroll"><h3>Stock actual${varias ? ' · todas las sedes' : ' · ' + esc(nombreSede(ui.sedeId))}</h3>
    <input id="buscarInv" placeholder="Buscar…" style="margin-bottom:10px;max-width:300px">
    <table><tr>${varias ? '<th>Sede</th>' : ''}<th>SKU</th><th>Producto</th><th>Categoría</th><th class="num">Stock</th><th class="num">Mínimo</th><th></th></tr>
    ${inv.map((p) => `<tr data-n="${esc((p.nombre + ' ' + p.sku + ' ' + p.categoria).toLowerCase())}">${varias ? `<td>${esc(p.sede)}</td>` : ''}<td><code>${esc(p.sku)}</code></td>
      <td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td>
      <td class="num"><b>${p.stock}</b> ${p.bajo_minimo ? '<span class="etiqueta e-cancelada">Bajo</span>' : ''}</td><td class="num">${p.stock_minimo}</td>
      <td style="white-space:nowrap"><button class="chico" data-mov="entrada" data-s="${p.sede_id}" data-p="${p.producto_id}">+ Entrada</button>
        <button class="sec chico" data-mov="salida" data-s="${p.sede_id}" data-p="${p.producto_id}">− Salida</button>
        <button class="sec chico" data-mov="ajuste" data-s="${p.sede_id}" data-p="${p.producto_id}">Conteo</button>
        ${esAdmin() ? `<button class="sec chico" data-min="1" data-s="${p.sede_id}" data-p="${p.producto_id}">Mín.</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="suave">No hay productos. Créalos en "Productos".</td></tr>'}
    </table></div>
    <div class="fila" style="margin-bottom:12px">${selectorFecha()}</div>
    <div class="tarjeta tabla-scroll"><h3>Movimientos del ${fechaLarga(ui.fecha)}</h3>
    <table><tr><th>Hora</th>${varias ? '<th>Sede</th>' : ''}<th>Producto</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Stock final</th><th>Motivo</th><th>Usuario</th></tr>
    ${movs.map((m) => `<tr><td>${fechaHora(m.creado_en).split(' ').pop()}</td>${varias ? `<td>${esc(m.sede)}</td>` : ''}<td>${esc(m.producto)}</td><td>${esc(m.tipo)}</td>
      <td class="num" style="color:${m.cantidad > 0 ? 'var(--verde)' : 'var(--rojo)'}">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td class="num">${m.stock_resultante}</td>
      <td>${esc(m.motivo || '')}</td><td>${esc(m.usuario)}</td></tr>`).join('') || '<tr><td colspan="8" class="suave">Sin movimientos.</td></tr>'}
    </table></div>`;
  enlazarFecha(cont);
  $('#buscarInv').oninput = (e) => { const q = e.target.value.toLowerCase(); cont.querySelectorAll('tr[data-n]').forEach((tr) => tr.classList.toggle('oculto', !tr.dataset.n.includes(q))); };
  cont.querySelectorAll('[data-mov]').forEach((b) => { b.onclick = () => {
    const tipo = b.dataset.mov; const p = inv.find((x) => x.producto_id === Number(b.dataset.p) && x.sede_id === Number(b.dataset.s));
    const titulos = { entrada: 'Entrada de inventario', salida: 'Salida de inventario', ajuste: 'Conteo físico (ajuste)' };
    const campos = tipo === 'ajuste'
      ? [{ k: 'stock_real', label: `Cantidad contada (sistema: ${p.stock})`, type: 'number', min: 0, req: true }, { k: 'motivo', label: 'Motivo', req: true, def: 'Conteo de cierre' }]
      : [{ k: 'cantidad', label: 'Cantidad', type: 'number', min: 1, req: true },
        { k: 'motivo', label: 'Motivo', req: tipo === 'salida', def: tipo === 'entrada' ? 'Compra a proveedor' : '', ayuda: tipo === 'salida' ? 'Ej.: producto dañado, vencido, consumo interno. Las ventas se descuentan solas.' : '' }];
    formModal(`${titulos[tipo]} · ${p.nombre}`, campos, {}, (v) => api('/api/inventario/movimientos', { method: 'POST', body: { ...v, tipo, sede_id: p.sede_id, producto_id: p.producto_id } }), 'Registrar');
  }; });
  cont.querySelectorAll('[data-min]').forEach((b) => { b.onclick = () => {
    const p = inv.find((x) => x.producto_id === Number(b.dataset.p) && x.sede_id === Number(b.dataset.s));
    formModal(`Stock mínimo · ${p.nombre} · ${p.sede}`, [{ k: 'stock_minimo', label: 'Mínimo (alerta)', type: 'number', min: 0, req: true }], { stock_minimo: p.stock_minimo },
      (v) => api('/api/inventario/minimo', { method: 'PUT', body: { ...v, sede_id: p.sede_id, producto_id: p.producto_id } }));
  }; });
};

// ---------- Productos (admin) ----------
VISTAS.catalogo = async (cont) => {
  const prods = await api('/api/productos?todos=true');
  const campos = (nuevo) => [
    { k: 'sku', label: 'SKU / código', req: true }, { k: 'nombre', label: 'Nombre', req: true },
    { k: 'categoria', label: 'Categoría', def: 'Bebidas' },
    { k: 'precio_venta', label: 'Precio de venta', type: 'number', min: 0, step: 'any', req: true },
    { k: 'costo', label: 'Costo', type: 'number', min: 0, step: 'any', def: 0 },
    ...(nuevo ? [{ k: 'stock_minimo', label: 'Stock mínimo por sede', type: 'number', min: 0, def: 0 }] : []),
    { k: 'activo', label: 'Activo', type: 'checkbox' },
  ];
  cont.innerHTML = `<div class="tarjeta tabla-scroll"><div class="fila"><h3 style="flex:1">Catálogo de productos (todas las sedes)</h3>
    <div style="flex:0"><button id="btnNuevoProd">+ Producto</button></div></div>
    <p class="suave">Al crear un producto queda disponible en todas las sedes con stock 0. Luego registra la entrada en Inventario.</p>
    <table><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th class="num">Precio</th><th class="num">Costo</th><th class="num">Margen</th><th>Estado</th><th></th></tr>
    ${prods.map((p) => `<tr><td><code>${esc(p.sku)}</code></td><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td><td class="num">${dinero(p.precio_venta)}</td>
      <td class="num">${dinero(p.costo)}</td><td class="num">${p.precio_venta ? Math.round((1 - p.costo / p.precio_venta) * 100) + '%' : '-'}</td>
      <td>${p.activo ? 'Activo' : '<span class="suave">Inactivo</span>'}</td><td><button class="sec chico" data-e="${p.id}">Editar</button></td></tr>`).join('')}
    </table></div>`;
  $('#btnNuevoProd').onclick = () => formModal('Nuevo producto', campos(true), {}, (v) => api('/api/productos', { method: 'POST', body: v }));
  cont.querySelectorAll('[data-e]').forEach((b) => { b.onclick = () => {
    const p = prods.find((x) => x.id === Number(b.dataset.e));
    formModal('Editar producto', campos(false), p, (v) => api(`/api/productos/${p.id}`, { method: 'PUT', body: v }));
  }; });
};

// ---------- Sedes, canchas y usuarios (admin) ----------
VISTAS.config = async (cont) => {
  const [sedes, canchas, usuarios] = await Promise.all([api('/api/sedes'), api('/api/canchas'), api('/api/usuarios')]);
  ui.sedes = sedes;
  const horas = Array.from({ length: 25 }, (_, i) => [i, `${i}:00`]);
  const camposSede = [{ k: 'nombre', label: 'Nombre', req: true }, { k: 'direccion', label: 'Dirección' }, { k: 'telefono', label: 'Teléfono' },
    { k: 'hora_apertura', label: 'Abre', type: 'select', opts: horas.slice(0, 24) }, { k: 'hora_cierre', label: 'Cierra', type: 'select', opts: horas.slice(1) },
    { k: 'activa', label: 'Activa', type: 'checkbox' }];
  const camposCancha = [{ k: 'sede_id', label: 'Sede', type: 'select', opts: opcionesSedes() }, { k: 'nombre', label: 'Nombre', req: true },
    { k: 'tipo', label: 'Tipo', type: 'select', opts: [['F5', 'Fútbol 5'], ['F8', 'Fútbol 8']] },
    { k: 'precio_hora', label: 'Precio por hora', type: 'number', min: 0, step: 'any', req: true }, { k: 'activa', label: 'Activa', type: 'checkbox' }];
  const camposUsuario = (nuevo) => [{ k: 'nombre', label: 'Nombre', req: true }, { k: 'email', label: 'Email (usuario de ingreso)', type: 'email', req: true },
    { k: 'rol', label: 'Rol', type: 'select', opts: [['operador', 'Operador (una sede)'], ['admin', 'Administrador (todas las sedes)']] },
    { k: 'sede_id', label: 'Sede (para operador)', type: 'select', opts: [['', '—'], ...opcionesSedes()] },
    { k: 'password', label: nuevo ? 'Contraseña (mín. 8)' : 'Nueva contraseña (vacío = no cambiar)', type: 'password', req: nuevo },
    { k: 'activo', label: 'Activo', type: 'checkbox' }];
  const fixNum = (v) => ({ ...v, hora_apertura: Number(v.hora_apertura), hora_cierre: Number(v.hora_cierre) });
  cont.innerHTML = `
    <div class="tarjeta tabla-scroll"><div class="fila"><h3 style="flex:1">Sedes</h3><div style="flex:0"><button id="nSede">+ Sede</button></div></div>
      <table><tr><th>Nombre</th><th>Dirección</th><th>Teléfono</th><th>Horario</th><th>Canchas</th><th>Estado</th><th></th></tr>
      ${sedes.map((s) => `<tr><td>${esc(s.nombre)}</td><td>${esc(s.direccion || '')}</td><td>${esc(s.telefono || '')}</td><td>${s.hora_apertura}:00–${s.hora_cierre}:00</td>
        <td>${canchas.filter((c) => c.sede_id === s.id).length}</td><td>${s.activa ? 'Activa' : 'Inactiva'}</td><td><button class="sec chico" data-s="${s.id}">Editar</button></td></tr>`).join('')}</table></div>
    <div class="tarjeta tabla-scroll"><div class="fila"><h3 style="flex:1">Canchas</h3><div style="flex:0"><button id="nCancha" ${sedes.length ? '' : 'disabled'}>+ Cancha</button></div></div>
      <table><tr><th>Sede</th><th>Cancha</th><th>Tipo</th><th class="num">Precio/hora</th><th>Estado</th><th></th></tr>
      ${canchas.map((c) => `<tr><td>${esc(c.sede)}</td><td>${esc(c.nombre)}</td><td>${c.tipo === 'F5' ? 'Fútbol 5' : 'Fútbol 8'}</td><td class="num">${dinero(c.precio_hora)}</td>
        <td>${c.activa ? 'Activa' : 'Inactiva'}</td><td><button class="sec chico" data-c="${c.id}">Editar</button></td></tr>`).join('')}</table></div>
    <div class="tarjeta tabla-scroll"><div class="fila"><h3 style="flex:1">Usuarios (empleados)</h3><div style="flex:0"><button id="nUsuario">+ Usuario</button></div></div>
      <table><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Sede</th><th>Estado</th><th></th></tr>
      ${usuarios.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${u.rol === 'admin' ? 'Admin' : 'Operador'}</td><td>${esc(u.sede || 'Todas')}</td>
        <td>${u.activo ? 'Activo' : '<span class="suave">Inactivo</span>'}</td><td><button class="sec chico" data-u="${u.id}">Editar</button></td></tr>`).join('')}</table></div>`;
  $('#nSede').onclick = () => formModal('Nueva sede', camposSede, { hora_apertura: 8, hora_cierre: 23 }, (v) => api('/api/sedes', { method: 'POST', body: fixNum(v) }).then(recargarSedes));
  $('#nCancha').onclick = () => formModal('Nueva cancha', camposCancha, { sede_id: ui.sedeId || sedes[0]?.id }, (v) => api('/api/canchas', { method: 'POST', body: v }));
  $('#nUsuario').onclick = () => formModal('Nuevo usuario', camposUsuario(true), {}, (v) => api('/api/usuarios', { method: 'POST', body: v }));
  cont.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { const s = sedes.find((x) => x.id === Number(b.dataset.s));
    formModal('Editar sede', camposSede, s, (v) => api(`/api/sedes/${s.id}`, { method: 'PUT', body: fixNum(v) }).then(recargarSedes)); }; });
  cont.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { const c = canchas.find((x) => x.id === Number(b.dataset.c));
    formModal('Editar cancha', camposCancha, c, (v) => api(`/api/canchas/${c.id}`, { method: 'PUT', body: v })); }; });
  cont.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => { const u = usuarios.find((x) => x.id === Number(b.dataset.u));
    formModal('Editar usuario', camposUsuario(false), u, (v) => api(`/api/usuarios/${u.id}`, { method: 'PUT', body: v })); }; });
};
async function recargarSedes() {
  ui.sedes = await api('/api/sedes');
  $('#selSede').innerHTML = '<option value="">Todas las sedes</option>' + ui.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('');
  $('#selSede').value = ui.sedeId || '';
}

// ---------- Reportes / BI (admin) ----------
VISTAS.bi = async (cont) => {
  const desde = sumarDias(ui.fecha, -30);
  const ds = [['reservas', 'Reservas (sede, cancha, tipo, hora, estado, precio, cliente)'], ['ventas', 'Ventas detalle por producto (cantidad, precio, costo, margen)'],
    ['inventario', 'Inventario actual por sede (stock, mínimo, valor)'], ['movimientos', 'Movimientos de inventario (kardex)'], ['canchas', 'Catálogo de canchas']];
  const origen = location.origin;
  cont.innerHTML = `<div class="tarjeta"><h3>Descargar datos (CSV para Excel / Power BI)</h3>
    <div class="fila"><div><label for="biDesde">Desde</label><input type="date" id="biDesde" value="${desde}"></div>
      <div><label for="biHasta">Hasta</label><input type="date" id="biHasta" value="${ui.fecha}"></div></div>
    <table style="margin-top:10px">${ds.map(([k, t]) => `<tr><td><b>${k}</b><br><small class="suave">${t}</small></td>
      <td style="white-space:nowrap"><button class="chico" data-csv="${k}">⬇ CSV</button></td></tr>`).join('')}</table></div>
    <div class="tarjeta"><h3>Conectar Power BI</h3>
      <p><b>Opción A – Conexión directa a la base de datos (recomendada):</b> en Power BI Desktop → <i>Obtener datos → Base de datos PostgreSQL</i>.
      Usa el usuario de solo lectura <code>powerbi_reader</code> y selecciona las vistas del esquema <code>bi</code>
      (<code>bi.reservas</code>, <code>bi.ventas_detalle</code>, <code>bi.inventario_actual</code>, <code>bi.movimientos_inventario</code>, <code>bi.canchas</code>).</p>
      <p><b>Opción B – Conector Web (sin abrir la base de datos):</b> <i>Obtener datos → Web</i> y pega una URL como:</p>
      <p><code>${esc(origen)}/api/bi/reservas?format=csv&amp;api_key=TU_BI_API_KEY</code></p>
      <p class="suave">Datasets: ${ds.map(([k]) => `<code>${k}</code>`).join(' ')} · filtros opcionales: <code>desde</code>, <code>hasta</code> (YYYY-MM-DD), <code>sede_id</code>.
      La clave se define en la variable de entorno <code>BI_API_KEY</code> del servidor. Ver README.</p></div>`;
  cont.querySelectorAll('[data-csv]').forEach((b) => { b.onclick = async () => {
    const url = `/api/bi/${b.dataset.csv}?format=csv&desde=${$('#biDesde').value}&hasta=${$('#biHasta').value}&${qsSede()}`;
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + sesion.token } });
    if (!res.ok) return alert('No se pudo descargar');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `${b.dataset.csv}.csv`; a.click();
  }; });
};

iniciar();
