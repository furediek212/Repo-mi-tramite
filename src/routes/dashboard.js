const express = require('express');
const db = require('../db');
const { wrap, validarFecha, ahoraLocal } = require('../util');
const { sedeDe } = require('../auth');

const r = express.Router();

r.get('/', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const fecha = validarFecha(req.query.fecha || ahoraLocal().fecha);
  const [reservas, ventas, bajo, porSede, topProductos] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE r.estado NOT IN ('cancelada','no_asistio'))::int AS activas,
              count(*) FILTER (WHERE r.estado = 'pendiente')::int AS pendientes,
              count(*) FILTER (WHERE r.estado = 'cancelada')::int AS canceladas,
              COALESCE(sum(r.precio) FILTER (WHERE r.estado NOT IN ('cancelada','no_asistio')), 0) AS ingreso_canchas,
              COALESCE(sum(EXTRACT(EPOCH FROM r.fin - r.inicio)/3600) FILTER (WHERE r.estado NOT IN ('cancelada','no_asistio')), 0)::float AS horas_reservadas
       FROM reservas r JOIN canchas c ON c.id = r.cancha_id
       WHERE r.inicio >= $1::date AND r.inicio < $1::date + 1 AND ($2::int IS NULL OR c.sede_id = $2)`, [fecha, sede]),
    db.query(
      `SELECT count(*)::int AS ventas, COALESCE(sum(total),0) AS total
       FROM ventas WHERE NOT anulada AND creado_en >= $1::date AND creado_en < $1::date + 1 AND ($2::int IS NULL OR sede_id = $2)`, [fecha, sede]),
    db.query(
      `SELECT s.nombre AS sede, p.nombre, i.stock, i.stock_minimo FROM inventario i
       JOIN productos p ON p.id = i.producto_id JOIN sedes s ON s.id = i.sede_id
       WHERE p.activo AND i.stock <= i.stock_minimo AND ($1::int IS NULL OR i.sede_id = $1) ORDER BY i.stock LIMIT 20`, [sede]),
    db.query(
      `SELECT s.id, s.nombre,
         (SELECT count(*) FROM reservas r JOIN canchas c ON c.id = r.cancha_id WHERE c.sede_id = s.id
            AND r.inicio >= $1::date AND r.inicio < $1::date + 1 AND r.estado NOT IN ('cancelada','no_asistio'))::int AS reservas,
         (SELECT COALESCE(sum(r.precio),0) FROM reservas r JOIN canchas c ON c.id = r.cancha_id WHERE c.sede_id = s.id
            AND r.inicio >= $1::date AND r.inicio < $1::date + 1 AND r.estado NOT IN ('cancelada','no_asistio')) AS ingreso_canchas,
         (SELECT COALESCE(sum(v.total),0) FROM ventas v WHERE v.sede_id = s.id AND NOT v.anulada
            AND v.creado_en >= $1::date AND v.creado_en < $1::date + 1) AS ventas
       FROM sedes s WHERE s.activa AND ($2::int IS NULL OR s.id = $2) ORDER BY s.nombre`, [fecha, sede]),
    db.query(
      `SELECT p.nombre, sum(vi.cantidad)::int AS unidades, sum(vi.subtotal) AS total
       FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.id = vi.producto_id
       WHERE NOT v.anulada AND v.creado_en >= $1::date AND v.creado_en < $1::date + 1 AND ($2::int IS NULL OR v.sede_id = $2)
       GROUP BY p.nombre ORDER BY unidades DESC LIMIT 5`, [fecha, sede]),
  ]);
  res.json({
    fecha, reservas: reservas.rows[0], ventas: ventas.rows[0], bajo_minimo: bajo.rows,
    por_sede: porSede.rows, top_productos: topProductos.rows,
  });
}));

module.exports = r;
