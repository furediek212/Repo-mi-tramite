const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { wrap, HttpError, texto } = require('../util');
const { firmar, requiereLogin } = require('../auth');

const r = express.Router();
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Demasiados intentos, espera unos minutos' } });

r.post('/login', limiteLogin, wrap(async (req, res) => {
  const email = texto(req.body?.email, 'email').toLowerCase();
  const { rows } = await db.query(
    `SELECT u.*, s.nombre AS sede FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.email = $1`, [email]
  );
  const u = rows[0];
  if (!u || !u.activo || !(await bcrypt.compare(String(req.body?.password || ''), u.password_hash))) {
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }
  res.json({ token: firmar(u), usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, sede_id: u.sede_id, sede: u.sede } });
}));

r.get('/me', requiereLogin, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.sede_id, s.nombre AS sede FROM usuarios u
     LEFT JOIN sedes s ON s.id = u.sede_id WHERE u.id = $1 AND u.activo`, [req.user.id]
  );
  if (!rows[0]) throw new HttpError(401, 'Usuario inactivo');
  res.json(rows[0]);
}));

r.post('/password', requiereLogin, wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!nueva || String(nueva).length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(String(actual || ''), rows[0].password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta');
  }
  await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(nueva), 10), req.user.id]);
  res.json({ ok: true });
}));

module.exports = r;
