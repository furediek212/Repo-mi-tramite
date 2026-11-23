const express = require('express');
const db = require('../db');
const { wrap, HttpError, entero, texto, validarFecha } = require('../util');
const { sedeDe, requiereAdmin } = require('../auth');

const r = express.Router();

/** Aplica un movimiento de stock dentro de una transacción. Devuelve el stock resultante. */
async function moverStock(c, { sede_id, producto_id, cantidad, tipo, motivo, usuario_id, venta_id = null }) {
  await c.query(`INSERT INTO inventario (sede_id, producto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sede_id, producto_id]);
  const { rows } = await c.query(
    `UPDATE inventario SET stock = stock + $3 WHERE sede_id = $1 AND producto_id = $2 AND stock + $3 >= 0 RETURNING stock`,
    [sede_id, producto_id, cantidad]
  );
  if (!rows[0]) {
    const { rows: p } = await c.query(
      `SELECT p.nombre, i.stock FROM productos p JOIN inventario i ON i.producto_id = p.id AND i.sede_id = $1 WHERE p.id = $2`,
      [sede_id, producto_id]
    );
    if (!p[0]) throw new HttpError(404, 'Producto no encontrado');
    throw new HttpError(409, `Stock insuficiente de "${p[0].nombre}" (disponible: ${p[0].stock})`);
  }
  await c.query(
    `INSERT INTO movimientos_inventario (sede_id, producto_id, tipo, cantidad, stock_resultante, motivo, venta_id, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sede_id, producto_id, tipo, cantidad, rows[0].stock, motivo, venta_id, usuario_id]
  );
  return rows[0].stock;
}

// Stock actual por sede.
r.get('/', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const { rows } = await db.query(
    `SELECT i.sede_id, s.nombre AS sede, p.id AS producto_id, p.sku, p.nombre, p.categoria, p.precio_venta, p.costo,
            i.stock, i.stock_minimo, (i.stock <= i.stock_minimo) AS bajo_minimo
     FROM inventario i JOIN productos p ON p.id = i.producto_id JOIN sedes s ON s.id = i.sede_id
     WHERE p.activo AND ($1::int IS NULL OR i.sede_id = $1) ORDER BY s.nombre, p.categoria, p.nombre`, [sede]
  );
  res.json(rows);
}));

// Registrar entrada (compra / reposición), salida (merma, consumo interno) o ajuste (conteo físico).
r.post('/movimientos', wrap(async (req, res) => {
  const b = req.body || {};
  const sede_id = sedeDe(req, b.sede_id, { requerida: true });
  const producto_id = entero(b.producto_id, 'producto_id');
  const tipo = b.tipo;
  let motivo = texto(b.motivo, 'motivo', { requerido: tipo !== 'entrada', max: 300 });
  const out = await db.tx(async (c) => {
    let cantidad;
    if (tipo === 'entrada') cantidad = entero(b.cantidad, 'cantidad', { min: 1 });
    else if (tipo === 'salida') cantidad = -entero(b.cantidad, 'cantidad', { min: 1 });
    else if (tipo === 'ajuste') {
      // En ajuste se envía el conteo físico real; se calcula la diferencia.
      const real = entero(b.stock_real, 'stock_real', { min: 0 });
      const { rows } = await c.query('SELECT stock FROM inventario WHERE sede_id=$1 AND producto_id=$2 FOR UPDATE', [sede_id, producto_id]);
      cantidad = real - (rows[0]?.stock ?? 0);
      if (cantidad === 0) return { stock: real, sin_cambios: true };
      motivo = `${motivo} (conteo físico: ${real})`;
    } else throw new HttpError(400, 'tipo debe ser entrada, salida o ajuste');
    const stock = await moverStock(c, { sede_id, producto_id, cantidad, tipo, motivo, usuario_id: req.user.id });
    return { stock, cantidad };
  });
  res.status(201).json(out);
}));

r.get('/movimientos', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const desde = validarFecha(req.query.desde, 'desde');
  const hasta = validarFecha(req.query.hasta || desde, 'hasta');
  const { rows } = await db.query(
    `SELECT m.*, p.nombre AS producto, p.sku, s.nombre AS sede, u.nombre AS usuario
     FROM movimientos_inventario m JOIN productos p ON p.id = m.producto_id JOIN sedes s ON s.id = m.sede_id
     JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.creado_en >= $1::date AND m.creado_en < ($2::date + 1) AND ($3::int IS NULL OR m.sede_id = $3)
       AND ($4::int IS NULL OR m.producto_id = $4)
     ORDER BY m.creado_en DESC LIMIT 2000`,
    [desde, hasta, sede, req.query.producto_id ? entero(req.query.producto_id, 'producto_id') : null]
  );
  res.json(rows);
}));

r.put('/minimo', requiereAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const { rowCount } = await db.query(
    `UPDATE inventario SET stock_minimo = $3 WHERE sede_id = $1 AND producto_id = $2`,
    [entero(b.sede_id, 'sede_id'), entero(b.producto_id, 'producto_id'), entero(b.stock_minimo, 'stock_minimo', { min: 0 })]
  );
  if (!rowCount) throw new HttpError(404, 'Registro de inventario no encontrado');
  res.json({ ok: true });
}));

module.exports = { router: r, moverStock };
