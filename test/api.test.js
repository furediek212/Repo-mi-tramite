// Pruebas de integración contra PostgreSQL real.
// Requiere TEST_DATABASE_URL (por defecto postgres://postgres@localhost:5432/canchas_test). ¡Se borra todo!
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/canchas_test';
process.env.BI_API_KEY = 'clave-bi-test';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin12345';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../src/db');
const { init } = require('../db/init');
const app = require('../src/app');
const { ahoraLocal } = require('../src/util');

let base, server;
const manana = (() => { const d = new Date(ahoraLocal().fecha + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

async function api(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const login = async (email, password) => (await api('POST', '/api/auth/login', { body: { email, password } })).data.token;

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS bi CASCADE;');
  await init({ demo: true, silent: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

let admin, opNorte, sedes, canchaNorte, canchaSur, reservaCodigo;

test('login y roles', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'admin@test.com', password: 'mala' } })).status, 401);
  admin = await login('admin@test.com', 'admin12345');
  opNorte = await login('operador.norte@canchas.local', 'operador1234');
  assert.ok(admin && opNorte);
  sedes = (await api('GET', '/api/sedes', { token: admin })).data;
  assert.equal(sedes.length, 2);
  const visibles = (await api('GET', '/api/sedes', { token: opNorte })).data;
  assert.equal(visibles.length, 1);
  assert.equal((await api('GET', '/api/usuarios', { token: opNorte })).status, 403);
  assert.equal((await api('GET', '/api/reservas')).status, 401);
  const canchas = (await api('GET', '/api/canchas', { token: admin })).data;
  canchaNorte = canchas.find((c) => c.sede === 'Sede Norte' && c.tipo === 'F5');
  canchaSur = canchas.find((c) => c.sede === 'Sede Sur');
});

test('reserva pública, disponibilidad y bloqueo de solapes', async () => {
  const pub = (await api('GET', '/api/public/sedes')).data;
  assert.equal(pub.sedes.length, 2);
  const r1 = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: manana, hora: '19:00', duracion: 1, nombre: 'Juan Pérez', telefono: '300 123 4567' },
  });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.equal(r1.data.estado, 'pendiente');
  assert.equal(r1.data.precio, 90000);
  reservaCodigo = r1.data.codigo;

  const choque = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: manana, hora: '19:30', duracion: 1, nombre: 'Otro', telefono: '3110000000' },
  });
  assert.equal(choque.status, 409);
  const contigua = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: manana, hora: '20:00', duracion: 1.5, nombre: 'Otro', telefono: '3110000000' },
  });
  assert.equal(contigua.status, 201);
  const fuera = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: manana, hora: '22:30', duracion: 1, nombre: 'Otro', telefono: '3110000000' },
  });
  assert.equal(fuera.status, 400);
  const pasado = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: '2020-01-01', hora: '10:00', duracion: 1, nombre: 'X', telefono: '3110000000' },
  });
  assert.equal(pasado.status, 400);

  const disp = (await api('GET', `/api/public/disponibilidad?cancha_id=${canchaNorte.id}&fecha=${manana}`)).data;
  const b = Object.fromEntries(disp.bloques.map((x) => [x.hora, x.ocupado]));
  assert.equal(b['18:30'], false);
  assert.equal(b['19:00'], true);
  assert.equal(b['21:00'], true);
  assert.equal(b['21:30'], false);

  const consulta = await api('GET', `/api/public/reservas/${reservaCodigo}?telefono=3001234567`);
  assert.equal(consulta.status, 200);
  assert.equal((await api('GET', `/api/public/reservas/${reservaCodigo}?telefono=999999999`)).status, 404);
});

test('operador gestiona reservas solo de su sede', async () => {
  const lista = (await api('GET', `/api/reservas?fecha=${manana}`, { token: opNorte })).data;
  assert.equal(lista.length, 2);
  const r = lista.find((x) => x.codigo === reservaCodigo);
  const conf = await api('PATCH', `/api/reservas/${r.id}`, { token: opNorte, body: { estado: 'confirmada', pagado: true } });
  assert.equal(conf.data.estado, 'confirmada');
  assert.equal(conf.data.pagado, true);
  const ajena = await api('POST', '/api/reservas', {
    token: opNorte, body: { cancha_id: canchaSur.id, fecha: manana, hora: '10:00', nombre: 'A', telefono: '3001111111' },
  });
  assert.equal(ajena.status, 403);
  assert.equal((await api('GET', `/api/reservas?sede_id=${canchaSur.sede_id}`, { token: opNorte })).status, 403);
  const mostrador = await api('POST', '/api/reservas', {
    token: opNorte, body: { cancha_id: canchaNorte.id, fecha: manana, hora: '10:00', duracion: 2, nombre: 'Equipo Los Pibes', telefono: '3002222222', origen: 'telefono' },
  });
  assert.equal(mostrador.status, 201);
  assert.equal(mostrador.data.estado, 'confirmada');
  assert.equal(mostrador.data.precio, 180000);
});

test('cancelación pública libera el horario', async () => {
  const c = await api('POST', `/api/public/reservas/${reservaCodigo}/cancelar`, { body: { telefono: '3001234567' } });
  assert.equal(c.status, 200);
  const otra = await api('POST', '/api/public/reservas', {
    body: { cancha_id: canchaNorte.id, fecha: manana, hora: '19:00', duracion: 1, nombre: 'Nuevo', telefono: '3003333333' },
  });
  assert.equal(otra.status, 201);
});

test('inventario: entradas, salidas, ajuste y ventas', async () => {
  const sedeNorte = canchaNorte.sede_id;
  const inv = (await api('GET', '/api/inventario', { token: opNorte })).data;
  const agua = inv.find((p) => p.sku === 'AGUA-600');
  assert.equal(agua.stock, 24);

  let m = await api('POST', '/api/inventario/movimientos', { token: opNorte, body: { sede_id: sedeNorte, producto_id: agua.producto_id, tipo: 'entrada', cantidad: 10, motivo: 'Compra proveedor' } });
  assert.equal(m.data.stock, 34);
  m = await api('POST', '/api/inventario/movimientos', { token: opNorte, body: { producto_id: agua.producto_id, tipo: 'salida', cantidad: 4, motivo: 'Botellas rotas' } });
  assert.equal(m.data.stock, 30);
  m = await api('POST', '/api/inventario/movimientos', { token: opNorte, body: { producto_id: agua.producto_id, tipo: 'salida', cantidad: 400, motivo: 'x' } });
  assert.equal(m.status, 409);
  m = await api('POST', '/api/inventario/movimientos', { token: opNorte, body: { producto_id: agua.producto_id, tipo: 'ajuste', stock_real: 28, motivo: 'Conteo cierre' } });
  assert.equal(m.data.stock, 28);
  assert.equal(m.data.cantidad, -2);

  const v = await api('POST', '/api/ventas', { token: opNorte, body: { metodo_pago: 'efectivo', items: [{ producto_id: agua.producto_id, cantidad: 3 }, { producto_id: agua.producto_id, cantidad: 2 }] } });
  assert.equal(v.status, 201, JSON.stringify(v.data));
  assert.equal(v.data.total, 15000);
  const sinStock = await api('POST', '/api/ventas', { token: opNorte, body: { metodo_pago: 'efectivo', items: [{ producto_id: agua.producto_id, cantidad: 999 }] } });
  assert.equal(sinStock.status, 409);
  let inv2 = (await api('GET', '/api/inventario', { token: opNorte })).data;
  assert.equal(inv2.find((p) => p.sku === 'AGUA-600').stock, 23);

  assert.equal((await api('POST', `/api/ventas/${v.data.id}/anular`, { token: opNorte })).status, 403);
  assert.equal((await api('POST', `/api/ventas/${v.data.id}/anular`, { token: admin })).status, 200);
  inv2 = (await api('GET', `/api/inventario?sede_id=${sedeNorte}`, { token: admin })).data;
  assert.equal(inv2.find((p) => p.sku === 'AGUA-600').stock, 28);

  const movs = (await api('GET', `/api/inventario/movimientos?desde=${ahoraLocal().fecha}`, { token: opNorte })).data;
  assert.equal(movs.length, 5);

  // Sede Sur no se afectó
  const sur = (await api('GET', `/api/inventario?sede_id=${canchaSur.sede_id}`, { token: admin })).data;
  assert.equal(sur.find((p) => p.sku === 'AGUA-600').stock, 24);
});

test('admin: nueva sede y producto se propagan al inventario', async () => {
  const s = await api('POST', '/api/sedes', { token: admin, body: { nombre: 'Sede Centro', hora_apertura: 7, hora_cierre: 24 } });
  assert.equal(s.status, 201);
  const p = await api('POST', '/api/productos', { token: admin, body: { sku: 'guantes', nombre: 'Guantes arquero', precio_venta: 50000, costo: 30000, stock_minimo: 2 } });
  assert.equal(p.status, 201);
  assert.equal(p.data.sku, 'GUANTES');
  const inv = (await api('GET', `/api/inventario?sede_id=${s.data.id}`, { token: admin })).data;
  assert.equal(inv.length, 8);
  const u = await api('POST', '/api/usuarios', { token: admin, body: { nombre: 'Ana', email: 'ana@test.com', password: 'clave12345', rol: 'operador', sede_id: s.data.id } });
  assert.equal(u.status, 201);
  const sinSede = await api('POST', '/api/usuarios', { token: admin, body: { nombre: 'B', email: 'b@test.com', password: 'clave12345', rol: 'operador' } });
  assert.equal(sinSede.status, 400);
  assert.equal((await api('POST', '/api/productos', { token: opNorte, body: { sku: 'x', nombre: 'x', precio_venta: 1 } })).status, 403);
});

test('dashboard y exportación BI', async () => {
  const d = (await api('GET', `/api/dashboard?fecha=${manana}`, { token: admin })).data;
  assert.ok(d.reservas.activas >= 3);
  assert.equal(d.por_sede.length, 3);

  assert.equal((await api('GET', '/api/bi/reservas')).status, 401);
  assert.equal((await api('GET', '/api/bi/reservas', { token: opNorte })).status, 401);
  const j = await api('GET', '/api/bi/reservas', { headers: { 'x-api-key': 'clave-bi-test' } });
  assert.equal(j.status, 200);
  assert.ok(j.data.length >= 4);
  assert.ok('sede' in j.data[0] && 'tipo_cancha' in j.data[0]);
  const csv = await api('GET', `/api/bi/ventas?format=csv&api_key=clave-bi-test&desde=${ahoraLocal().fecha}`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /venta_id,item_id,fecha_hora/);
  const inv = await api('GET', '/api/bi/inventario', { token: admin });
  assert.equal(inv.status, 200);
  assert.equal((await api('GET', '/api/bi/nada', { token: admin })).status, 404);
});
