// Configuración: sedes, canchas, usuarios y catálogo de productos.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { wrap, HttpError, texto, numero, entero } = require('../util');
const { requiereAdmin, sedeDe } = require('../auth');

const r = express.Router();
const bool = (v, def = true) => (v === undefined ? def : v === true || v === 'true');

function conflicto(e, msg) {
  if (e.code === '23505') throw new HttpError(409, msg);
  if (e.code === '23514') throw new HttpError(400, 'Datos inválidos');
  if (e.code === '23503') throw new HttpError(400, 'Referencia inválida');
  throw e;
}

// ---------------- Sedes ----------------
r.get('/sedes', wrap(async (req, res) => {
  const sede = req.user.rol === 'operador' ? req.user.sede_id : null;
  const { rows } = await db.query(
    `SELECT * FROM sedes WHERE ($1::int IS NULL OR id = $1) ORDER BY nombre`, [sede]
  );
  res.json(rows);
}));

function datosSede(b) {
  return [texto(b.nombre, 'nombre', { max: 80 }), texto(b.direccion, 'dirección', { requerido: false }),
    texto(b.telefono, 'teléfono', { requerido: false, max: 30 }), entero(b.hora_apertura ?? 8, 'hora_apertura', { min: 0 }),
    entero(b.hora_cierre ?? 23, 'hora_cierre', { min: 1 }), bool(b.activa)];
}

r.post('/sedes', requiereAdmin, wrap(async (req, res) => {
  try {
    const sede = await db.tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO sedes (nombre, direccion, telefono, hora_apertura, hora_cierre, activa)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, datosSede(req.body || {})
      );
      // Al abrir una sede, se crea su inventario con todos los productos del catálogo en 0.
      await c.query(`INSERT INTO inventario (sede_id, producto_id) SELECT $1, id FROM productos ON CONFLICT DO NOTHING`, [rows[0].id]);
      return rows[0];
    });
    res.status(201).json(sede);
  } catch (e) { conflicto(e, 'Ya existe una sede con ese nombre'); }
}));

r.put('/sedes/:id', requiereAdmin, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE sedes SET nombre=$1, direccion=$2, telefono=$3, hora_apertura=$4, hora_cierre=$5, activa=$6
       WHERE id=$7 RETURNING *`, [...datosSede(req.body || {}), entero(req.params.id, 'id')]
    );
    if (!rows[0]) throw new HttpError(404, 'Sede no encontrada');
    res.json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe una sede con ese nombre'); }
}));

// ---------------- Canchas ----------------
r.get('/canchas', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const { rows } = await db.query(
    `SELECT c.*, s.nombre AS sede FROM canchas c JOIN sedes s ON s.id = c.sede_id
     WHERE ($1::int IS NULL OR c.sede_id = $1) ORDER BY s.nombre, c.nombre`, [sede]
  );
  res.json(rows);
}));

function datosCancha(b) {
  const tipo = String(b.tipo || '').toUpperCase();
  if (!['F5', 'F8'].includes(tipo)) throw new HttpError(400, 'tipo debe ser F5 o F8');
  return [entero(b.sede_id, 'sede_id'), texto(b.nombre, 'nombre', { max: 60 }), tipo,
    numero(b.precio_hora, 'precio_hora'), bool(b.activa)];
}

r.post('/canchas', requiereAdmin, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `INSERT INTO canchas (sede_id, nombre, tipo, precio_hora, activa) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      datosCancha(req.body || {})
    );
    res.status(201).json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe una cancha con ese nombre en la sede'); }
}));

r.put('/canchas/:id', requiereAdmin, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE canchas SET sede_id=$1, nombre=$2, tipo=$3, precio_hora=$4, activa=$5 WHERE id=$6 RETURNING *`,
      [...datosCancha(req.body || {}), entero(req.params.id, 'id')]
    );
    if (!rows[0]) throw new HttpError(404, 'Cancha no encontrada');
    res.json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe una cancha con ese nombre en la sede'); }
}));

// ---------------- Usuarios ----------------
r.get('/usuarios', requiereAdmin, wrap(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.sede_id, s.nombre AS sede, u.activo, u.creado_en
     FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id ORDER BY u.nombre`
  );
  res.json(rows);
}));

function datosUsuario(b) {
  if (!['admin', 'operador'].includes(b.rol)) throw new HttpError(400, 'rol debe ser admin u operador');
  const sede = b.sede_id ? entero(b.sede_id, 'sede_id') : null;
  if (b.rol === 'operador' && !sede) throw new HttpError(400, 'Un operador debe tener una sede asignada');
  const email = texto(b.email, 'email', { max: 160 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'email inválido');
  return { nombre: texto(b.nombre, 'nombre', { max: 120 }), email, rol: b.rol, sede_id: b.rol === 'admin' ? null : sede, activo: bool(b.activo) };
}

r.post('/usuarios', requiereAdmin, wrap(async (req, res) => {
  const d = datosUsuario(req.body || {});
  const pass = String(req.body?.password || '');
  if (pass.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  try {
    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sede_id, activo) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nombre, email, rol, sede_id, activo`,
      [d.nombre, d.email, await bcrypt.hash(pass, 10), d.rol, d.sede_id, d.activo]
    );
    res.status(201).json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe un usuario con ese email'); }
}));

r.put('/usuarios/:id', requiereAdmin, wrap(async (req, res) => {
  const id = entero(req.params.id, 'id');
  const d = datosUsuario(req.body || {});
  if (id === req.user.id && (d.rol !== 'admin' || !d.activo)) throw new HttpError(400, 'No puedes quitarte el rol de admin ni desactivarte');
  const pass = req.body?.password ? String(req.body.password) : null;
  if (pass !== null && pass.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  try {
    const { rows } = await db.query(
      `UPDATE usuarios SET nombre=$1, email=$2, rol=$3, sede_id=$4, activo=$5,
         password_hash = COALESCE($6, password_hash) WHERE id=$7
       RETURNING id, nombre, email, rol, sede_id, activo`,
      [d.nombre, d.email, d.rol, d.sede_id, d.activo, pass ? await bcrypt.hash(pass, 10) : null, id]
    );
    if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado');
    res.json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe un usuario con ese email'); }
}));

// ---------------- Productos ----------------
r.get('/productos', wrap(async (req, res) => {
  const soloActivos = req.query.todos !== 'true';
  const { rows } = await db.query(
    `SELECT * FROM productos WHERE ($1::boolean = false OR activo) ORDER BY categoria, nombre`, [soloActivos]
  );
  res.json(rows);
}));

function datosProducto(b) {
  return [texto(b.sku, 'SKU', { max: 40 }).toUpperCase(), texto(b.nombre, 'nombre', { max: 120 }),
    texto(b.categoria, 'categoría', { requerido: false, max: 60 }) || 'General',
    numero(b.precio_venta, 'precio_venta'), numero(b.costo ?? 0, 'costo'), bool(b.activo)];
}

r.post('/productos', requiereAdmin, wrap(async (req, res) => {
  try {
    const p = await db.tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO productos (sku, nombre, categoria, precio_venta, costo, activo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        datosProducto(req.body || {})
      );
      // El producto queda disponible en el inventario de todas las sedes (stock 0).
      await c.query(`INSERT INTO inventario (sede_id, producto_id, stock_minimo) SELECT id, $1, $2 FROM sedes ON CONFLICT DO NOTHING`,
        [rows[0].id, entero(req.body?.stock_minimo ?? 0, 'stock_minimo', { min: 0 })]);
      return rows[0];
    });
    res.status(201).json(p);
  } catch (e) { conflicto(e, 'Ya existe un producto con ese SKU'); }
}));

r.put('/productos/:id', requiereAdmin, wrap(async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE productos SET sku=$1, nombre=$2, categoria=$3, precio_venta=$4, costo=$5, activo=$6 WHERE id=$7 RETURNING *`,
      [...datosProducto(req.body || {}), entero(req.params.id, 'id')]
    );
    if (!rows[0]) throw new HttpError(404, 'Producto no encontrado');
    res.json(rows[0]);
  } catch (e) { conflicto(e, 'Ya existe un producto con ese SKU'); }
}));

module.exports = r;
