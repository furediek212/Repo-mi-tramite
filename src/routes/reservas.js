const express = require('express');
const db = require('../db');
const { wrap, HttpError, entero, validarFecha, texto, ahoraLocal } = require('../util');
const { sedeDe } = require('../auth');
const { crearReserva, disponibilidad } = require('../services/reservas');

const r = express.Router();
const ESTADOS = ['pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistio'];

async function verificarAccesoCancha(req, canchaId) {
  const { rows } = await db.query('SELECT sede_id FROM canchas WHERE id = $1', [canchaId]);
  if (!rows[0]) throw new HttpError(404, 'Cancha no encontrada');
  sedeDe(req, rows[0].sede_id);
}

// Lista de reservas por rango de fechas (por defecto hoy) y sede.
r.get('/', wrap(async (req, res) => {
  const sede = sedeDe(req, req.query.sede_id);
  const desde = validarFecha(req.query.desde || req.query.fecha || ahoraLocal().fecha, 'desde');
  const hasta = validarFecha(req.query.hasta || desde, 'hasta');
  const estado = req.query.estado && ESTADOS.includes(req.query.estado) ? req.query.estado : null;
  const q = req.query.q ? `%${String(req.query.q).trim()}%` : null;
  const { rows } = await db.query(
    `SELECT r.*, c.nombre AS cancha, c.tipo AS tipo_cancha, c.sede_id, s.nombre AS sede,
            cl.nombre AS cliente, cl.telefono AS cliente_telefono, cl.email AS cliente_email
     FROM reservas r JOIN canchas c ON c.id = r.cancha_id JOIN sedes s ON s.id = c.sede_id
     JOIN clientes cl ON cl.id = r.cliente_id
     WHERE r.inicio >= $1::date AND r.inicio < ($2::date + 1)
       AND ($3::int IS NULL OR c.sede_id = $3) AND ($4::text IS NULL OR r.estado = $4)
       AND ($5::text IS NULL OR cl.nombre ILIKE $5 OR cl.telefono ILIKE $5 OR r.codigo ILIKE $5)
     ORDER BY r.inicio, c.nombre LIMIT 2000`,
    [desde, hasta, sede, estado, q]
  );
  res.json(rows);
}));

r.get('/disponibilidad', wrap(async (req, res) => {
  const canchaId = entero(req.query.cancha_id, 'cancha_id');
  await verificarAccesoCancha(req, canchaId);
  res.json(await disponibilidad(canchaId, req.query.fecha));
}));

r.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const canchaId = entero(b.cancha_id, 'cancha_id');
  await verificarAccesoCancha(req, canchaId);
  const origen = ['mostrador', 'telefono'].includes(b.origen) ? b.origen : 'mostrador';
  const reserva = await crearReserva({
    cancha_id: canchaId, fecha: b.fecha, hora: b.hora, duracion: b.duracion,
    cliente: { nombre: b.nombre, telefono: b.telefono, email: b.email },
    origen, estado: 'confirmada', creado_por: req.user.id, notas: b.notas,
    permitirPasado: req.user.rol === 'admin' && b.permitir_pasado === true,
  });
  if (b.pagado === true) await db.query('UPDATE reservas SET pagado = true WHERE id = $1', [reserva.id]);
  res.status(201).json({ ...reserva, pagado: b.pagado === true });
}));

// Cambiar estado / pago / notas.
r.patch('/:id', wrap(async (req, res) => {
  const id = entero(req.params.id, 'id');
  const { rows: act } = await db.query(
    'SELECT r.*, c.sede_id FROM reservas r JOIN canchas c ON c.id = r.cancha_id WHERE r.id = $1', [id]
  );
  if (!act[0]) throw new HttpError(404, 'Reserva no encontrada');
  sedeDe(req, act[0].sede_id);
  const b = req.body || {};
  if (b.estado !== undefined && !ESTADOS.includes(b.estado)) throw new HttpError(400, 'estado inválido');
  try {
    const { rows } = await db.query(
      `UPDATE reservas SET estado = COALESCE($1, estado), pagado = COALESCE($2, pagado),
         notas = CASE WHEN $3::boolean THEN $4 ELSE notas END, actualizado_en = now()
       WHERE id = $5 RETURNING *`,
      [b.estado ?? null, typeof b.pagado === 'boolean' ? b.pagado : null, b.notas !== undefined,
        b.notas !== undefined ? texto(b.notas, 'notas', { requerido: false, max: 500 }) : null, id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23P01') throw new HttpError(409, 'Ese horario ya está ocupado por otra reserva');
    throw e;
  }
}));

module.exports = r;
