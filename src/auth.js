const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { HttpError } = require('./util');

const SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET es obligatorio en producción');
  return 'dev-secret-cambiar';
})();

function firmar(u) {
  return jwt.sign({ id: u.id, rol: u.rol, sede_id: u.sede_id, nombre: u.nombre }, SECRET, { expiresIn: '12h' });
}

function requiereLogin(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Debes iniciar sesión'));
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(new HttpError(401, 'Sesión expirada, ingresa de nuevo'));
  }
}

function requiereAdmin(req, _res, next) {
  if (req.user?.rol !== 'admin') return next(new HttpError(403, 'Solo administradores'));
  next();
}

/**
 * Determina la sede sobre la que opera la petición.
 * - operador: siempre su sede (si pide otra -> 403).
 * - admin: la sede pedida, o null = todas.
 */
function sedeDe(req, valor, { requerida = false } = {}) {
  const pedida = valor === undefined || valor === null || valor === '' ? null : Number(valor);
  if (pedida !== null && !Number.isInteger(pedida)) throw new HttpError(400, 'sede_id inválido');
  if (req.user.rol === 'operador') {
    if (pedida !== null && pedida !== req.user.sede_id) throw new HttpError(403, 'No tienes acceso a esa sede');
    return req.user.sede_id;
  }
  if (requerida && pedida === null) throw new HttpError(400, 'sede_id es obligatorio');
  return pedida;
}

function compararSeguro(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { firmar, requiereLogin, requiereAdmin, sedeDe, compararSeguro, SECRET };
