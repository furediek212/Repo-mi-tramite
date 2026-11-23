// API pública para que los clientes reserven sin cuenta.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { wrap, HttpError, entero, ahoraLocal } = require('../util');
const { disponibilidad, crearReserva, DURACIONES } = require('../services/reservas');

const r = express.Router();
const limiteReservas = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta más tarde' } });

r.get('/sedes', wrap(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.nombre, s.direccion, s.telefono, s.hora_apertura, s.hora_cierre,
       COALESCE(json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'precio_hora', c.precio_hora)
         ORDER BY c.nombre) FILTER (WHERE c.id IS NOT NULL), '[]') AS canchas
     FROM sedes s LEFT JOIN canchas c ON c.sede_id = s.id AND c.activa
     WHERE s.activa GROUP BY s.id ORDER BY s.nombre`
  );
  res.json({ sedes: rows, duraciones: DURACIONES, hoy: ahoraLocal().fecha });
}));

r.get('/disponibilidad', wrap(async (req, res) => {
  res.json(await disponibilidad(entero(req.query.cancha_id, 'cancha_id'), req.query.fecha));
}));

r.post('/reservas', limiteReservas, wrap(async (req, res) => {
  const b = req.body || {};
  const reserva = await crearReserva({
    cancha_id: entero(b.cancha_id, 'cancha_id'), fecha: b.fecha, hora: b.hora, duracion: b.duracion,
    cliente: { nombre: b.nombre, telefono: b.telefono, email: b.email },
    origen: 'web', estado: process.env.AUTO_CONFIRMAR_WEB === 'true' ? 'confirmada' : 'pendiente', notas: b.notas,
  });
  res.status(201).json({
    codigo: reserva.codigo, estado: reserva.estado, inicio: reserva.inicio, fin: reserva.fin,
    precio: reserva.precio, cancha: reserva.cancha, sede: reserva.sede,
  });
}));

// Consultar / cancelar con código + teléfono (sin cuenta).
async function buscar(codigo, telefono) {
  const tel = String(telefono || '').replace(/[^\d+]/g, '');
  const { rows } = await db.query(
    `SELECT r.id, r.codigo, r.estado, r.inicio, r.fin, r.precio, c.nombre AS cancha, c.tipo AS tipo_cancha, s.nombre AS sede
     FROM reservas r JOIN canchas c ON c.id = r.cancha_id JOIN sedes s ON s.id = c.sede_id
     JOIN clientes cl ON cl.id = r.cliente_id WHERE r.codigo = $1 AND cl.telefono = $2`,
    [String(codigo || '').toUpperCase(), tel]
  );
  if (!rows[0]) throw new HttpError(404, 'Reserva no encontrada');
  return rows[0];
}

r.get('/reservas/:codigo', limiteReservas, wrap(async (req, res) => {
  const { id, ...resto } = await buscar(req.params.codigo, req.query.telefono);
  res.json(resto);
}));

r.post('/reservas/:codigo/cancelar', limiteReservas, wrap(async (req, res) => {
  const rv = await buscar(req.params.codigo, req.body?.telefono);
  if (!['pendiente', 'confirmada'].includes(rv.estado)) throw new HttpError(400, 'La reserva ya no se puede cancelar');
  const horas = Number(process.env.HORAS_MIN_CANCELACION || 2);
  const limite = new Date(rv.inicio.replace(' ', 'T') + 'Z').getTime() - horas * 3600e3;
  const ahora = new Date(ahoraLocal().ts.replace(' ', 'T') + 'Z').getTime();
  if (ahora > limite) throw new HttpError(400, `Solo se puede cancelar con ${horas} horas de anticipación. Llama a la sede.`);
  await db.query(`UPDATE reservas SET estado = 'cancelada', actualizado_en = now() WHERE id = $1`, [rv.id]);
  res.json({ ok: true, codigo: rv.codigo, estado: 'cancelada' });
}));

module.exports = r;
