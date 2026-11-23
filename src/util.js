const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const TZ = process.env.APP_TZ || 'America/Bogota';

/** Fecha/hora actual en la zona horaria del negocio: { fecha: 'YYYY-MM-DD', hora: 'HH:MM', ts: 'YYYY-MM-DD HH:MM:SS' } */
function ahoraLocal() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  const fecha = `${p.year}-${p.month}-${p.day}`;
  return { fecha, hora: `${p.hour}:${p.minute}`, ts: `${fecha} ${p.hour}:${p.minute}:${p.second}` };
}

const reFecha = /^\d{4}-\d{2}-\d{2}$/;
const reHora = /^([01]\d|2[0-3]):(00|30)$/;

function validarFecha(f, campo = 'fecha') {
  if (!reFecha.test(f || '') || isNaN(Date.parse(f))) throw new HttpError(400, `${campo} inválida (YYYY-MM-DD)`);
  return f;
}
function validarHora(h) {
  if (!reHora.test(h || '')) throw new HttpError(400, 'hora inválida (HH:00 o HH:30)');
  return h;
}
function sumarHoras(fecha, hora, horas) {
  const [H, M] = hora.split(':').map(Number);
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCMinutes(H * 60 + M + Math.round(horas * 60));
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function minutosDelDia(ts) {
  // ts 'YYYY-MM-DD HH:MM:SS'
  const [h, m] = ts.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

function codigoReserva() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(6), (b) => abc[b % abc.length]).join('');
}

function entero(v, campo, { min = -Infinity } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${campo} inválido`);
  return n;
}
function numero(v, campo, { min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${campo} inválido`);
  return n;
}
function texto(v, campo, { requerido = true, max = 200 } = {}) {
  const s = (v ?? '').toString().trim();
  if (requerido && !s) throw new HttpError(400, `${campo} es obligatorio`);
  if (s.length > max) throw new HttpError(400, `${campo} es demasiado largo`);
  return s || null;
}

module.exports = {
  HttpError, wrap, ahoraLocal, validarFecha, validarHora, sumarHoras, minutosDelDia,
  codigoReserva, entero, numero, texto, TZ,
};
