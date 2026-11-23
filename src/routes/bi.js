// Exportación para Power BI / Excel / cualquier herramienta BI.
// Autenticación: token de admin (Bearer) o API key (header X-API-Key o ?api_key=) definida en BI_API_KEY.
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { wrap, HttpError, validarFecha } = require('../util');
const { SECRET, compararSeguro } = require('../auth');

const r = express.Router();

// dataset -> [vista, columna de fecha para filtrar]
const DATASETS = {
  reservas: ['bi.reservas', 'fecha'],
  ventas: ['bi.ventas_detalle', 'fecha'],
  inventario: ['bi.inventario_actual', null],
  movimientos: ['bi.movimientos_inventario', 'fecha'],
  canchas: ['bi.canchas', null],
};

function autorizar(req, _res, next) {
  const key = req.get('x-api-key') || req.query.api_key;
  if (key && process.env.BI_API_KEY && compararSeguro(key, process.env.BI_API_KEY)) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const u = jwt.verify(h.slice(7), SECRET);
      if (u.rol === 'admin') return next();
    } catch { /* cae al error */ }
  }
  next(new HttpError(401, 'Se requiere API key de BI o sesión de administrador'));
}

const csvCelda = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

r.get('/', autorizar, (_req, res) => res.json({ datasets: Object.keys(DATASETS), formatos: ['json', 'csv'] }));

r.get('/:dataset', autorizar, wrap(async (req, res) => {
  const ds = DATASETS[req.params.dataset];
  if (!ds) throw new HttpError(404, `Dataset no existe. Opciones: ${Object.keys(DATASETS).join(', ')}`);
  const [vista, colFecha] = ds;
  const where = []; const params = [];
  if (colFecha && req.query.desde) { params.push(validarFecha(req.query.desde, 'desde')); where.push(`${colFecha} >= $${params.length}`); }
  if (colFecha && req.query.hasta) { params.push(validarFecha(req.query.hasta, 'hasta')); where.push(`${colFecha} <= $${params.length}`); }
  if (req.query.sede_id) { params.push(Number(req.query.sede_id) || 0); where.push(`sede_id = $${params.length}`); }
  const { rows, fields } = await db.query(
    `SELECT * FROM ${vista} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY 1`, params
  );
  if (req.query.format === 'csv') {
    const lines = [fields.map((f) => f.name).join(',')];
    for (const row of rows) lines.push(fields.map((f) => csvCelda(row[f.name])).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.dataset}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  res.json(rows);
}));

module.exports = r;
