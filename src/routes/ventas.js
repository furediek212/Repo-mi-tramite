const express = require('express');
const db = require('../db');
const { wrap, HttpError, entero, validarFecha, ahoraLocal } = require('../util');
const { sedeDe, requiereAdmin } = require('../auth');
const { moverStock } = require('./inventario');

const r = express.Router();
const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

// Registrar venta: descuenta inventario automáticamente.
r.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const sede_id = sedeDe(req, b.sede_id, { requerida: true });
  if (!METODOS.includes(b.metodo_pago)) throw new HttpError(400, `metodo_pago debe ser: ${METODOS.join(', ')}`);
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'La venta no tiene productos');
  // Agrupar por producto
  const items = new Map();
  for (const it of b.items) {
    const pid = entero(it.producto_id, 'producto_id');
    items.set(pid, (items.get(pid) || 0) + entero(it.cantidad, 'cantidad', { min: 1 }));
  }
  const reservaId = b.reserva_id ? entero(b.reserva_id, 'reserva_id') : null;

  const venta = await db.tx(async (c) => {
    const { rows: prods } = await c.query(
      'SELECT id, nombre, precio_venta, costo, activo FROM productos WHERE id = ANY($1)', [[...items.keys()]]
    );
    if (prods.length !== items.size || prods.some((p) => !p.activo)) throw new HttpError(400, 'Hay productos inválidos o inactivos');
    let total = 0;
    const lineas = prods.map((p) => {
      const cantidad = items.get(p.id);
      const subtotal = Math.round(p.precio_venta * cantidad * 100) / 100;
      total += subtotal;
      return { ...p, cantidad, subtotal };
    });
    let clienteId = null;
    if (reservaId) {
      const { rows } = await c.query(
        'SELECT r.cliente_id, c.sede_id FROM reservas r JOIN canchas c ON c.id = r.cancha_id WHERE r.id = $1', [reservaId]
      );
      if (!rows[0] || rows[0].sede_id !== sede_id) throw new HttpError(400, 'Reserva inválida para esta sede');
      clienteId = rows[0].cliente_id;
    }
    const { rows: [v] } = await c.query(
      `INSERT INTO ventas (sede_id, usuario_id, cliente_id, reserva_id, total, metodo_pago) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sede_id, req.user.id, clienteId, reservaId, Math.round(total * 100) / 100, b.metodo_pago]
    );
    for (const l of lineas.sort((a, b2) => a.id - b2.id)) { // orden fijo evita bloqueos cruzados
      await c.query(
        `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal) VALUES ($1,$2,$3,$4,$5,$6)`,
        [v.id, l.id, l.cantidad, l.precio_venta, l.costo, l.subtotal]
      );
      await moverStock(c, { sede_id, producto_id: l.id, cantidad: -l.cantidad, tipo: 'venta', motivo: `Venta #${v.id}`, usuario_id: req.user.id, venta_id: v.id });
    }
    return { ...v, items: lineas.map(({ id, nombre, cantidad, precio_venta, subtotal }) => ({ producto_id: id, nombre, cantidad, precio_unitario: precio_venta, subtotal })) };
  });
  res.status(201).json(venta);
}));

r.get('/', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const desde = validarFecha(req.query.desde || ahoraLocal().fecha, 'desde');
  const hasta = validarFecha(req.query.hasta || desde, 'hasta');
  const { rows } = await db.query(
    `SELECT v.*, s.nombre AS sede, u.nombre AS vendedor,
       json_agg(json_build_object('producto', p.nombre, 'cantidad', vi.cantidad, 'subtotal', vi.subtotal) ORDER BY vi.id) AS items
     FROM ventas v JOIN sedes s ON s.id = v.sede_id JOIN usuarios u ON u.id = v.usuario_id
     JOIN venta_items vi ON vi.venta_id = v.id JOIN productos p ON p.id = vi.producto_id
     WHERE v.creado_en >= $1::date AND v.creado_en < ($2::date + 1) AND ($3::int IS NULL OR v.sede_id = $3)
     GROUP BY v.id, s.nombre, u.nombre ORDER BY v.creado_en DESC LIMIT 2000`,
    [desde, hasta, sede]
  );
  res.json(rows);
}));

// Anular venta (solo admin): devuelve el stock.
r.post('/:id/anular', requiereAdmin, wrap(async (req, res) => {
  const id = entero(req.params.id, 'id');
  await db.tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM ventas WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Venta no encontrada');
    if (rows[0].anulada) throw new HttpError(400, 'La venta ya está anulada');
    await c.query('UPDATE ventas SET anulada = true WHERE id = $1', [id]);
    const { rows: items } = await c.query('SELECT producto_id, cantidad FROM venta_items WHERE venta_id = $1 ORDER BY producto_id', [id]);
    for (const it of items) {
      await moverStock(c, { sede_id: rows[0].sede_id, producto_id: it.producto_id, cantidad: it.cantidad, tipo: 'anulacion',
        motivo: `Anulación venta #${id}`, usuario_id: req.user.id, venta_id: id });
    }
  });
  res.json({ ok: true });
}));

module.exports = r;
