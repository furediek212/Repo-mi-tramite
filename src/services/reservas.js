const db = require('../db');
const {
  HttpError, validarFecha, validarHora, sumarHoras, minutosDelDia, codigoReserva, texto, numero, ahoraLocal,
} = require('../util');

const DURACIONES = [1, 1.5, 2, 2.5, 3];

async function obtenerCancha(client, canchaId) {
  const { rows } = await client.query(
    `SELECT c.*, s.hora_apertura, s.hora_cierre, s.activa AS sede_activa, s.nombre AS sede
     FROM canchas c JOIN sedes s ON s.id = c.sede_id WHERE c.id = $1`,
    [canchaId]
  );
  if (!rows[0]) throw new HttpError(404, 'Cancha no encontrada');
  return rows[0];
}

async function upsertCliente(client, { nombre, telefono, email }) {
  const tel = texto(telefono, 'teléfono', { max: 30 }).replace(/[^\d+]/g, '');
  if (tel.length < 7) throw new HttpError(400, 'teléfono inválido');
  const nom = texto(nombre, 'nombre', { max: 120 });
  const mail = texto(email, 'email', { requerido: false, max: 160 });
  const { rows } = await client.query(
    `INSERT INTO clientes (nombre, telefono, email) VALUES ($1,$2,$3)
     ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre, email = COALESCE(EXCLUDED.email, clientes.email)
     RETURNING id`,
    [nom, tel, mail]
  );
  return rows[0].id;
}

/** Disponibilidad de una cancha en un día: bloques de 30 min con ocupado true/false. */
async function disponibilidad(canchaId, fecha) {
  validarFecha(fecha);
  const cancha = await obtenerCancha(db, canchaId);
  const { rows } = await db.query(
    `SELECT inicio, fin FROM reservas
     WHERE cancha_id = $1 AND estado NOT IN ('cancelada','no_asistio')
       AND inicio < ($2::date + 1) AND fin > $2::date`,
    [canchaId, fecha]
  );
  const ahora = ahoraLocal();
  const bloques = [];
  for (let m = cancha.hora_apertura * 60; m < cancha.hora_cierre * 60; m += 30) {
    const hora = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const ocupado = rows.some((r) => {
      const ini = r.inicio.slice(0, 10) < fecha ? 0 : minutosDelDia(r.inicio);
      const fin = r.fin.slice(0, 10) > fecha ? 24 * 60 : minutosDelDia(r.fin);
      return m < fin && m + 30 > ini;
    });
    const pasado = fecha < ahora.fecha || (fecha === ahora.fecha && hora <= ahora.hora);
    bloques.push({ hora, ocupado, pasado });
  }
  return {
    cancha: { id: cancha.id, nombre: cancha.nombre, tipo: cancha.tipo, precio_hora: cancha.precio_hora, sede: cancha.sede },
    fecha, bloques,
  };
}

/**
 * Crea una reserva validando horario de la sede y solapes (la BD también los bloquea).
 * opts: { cancha_id, fecha, hora, duracion, cliente:{nombre,telefono,email}, origen, estado, creado_por, notas, permitirPasado }
 */
async function crearReserva(opts) {
  const fecha = validarFecha(opts.fecha);
  const hora = validarHora(opts.hora);
  const duracion = numero(opts.duracion ?? 1, 'duración');
  if (!DURACIONES.includes(duracion)) throw new HttpError(400, `duración debe ser una de: ${DURACIONES.join(', ')} horas`);

  return db.tx(async (client) => {
    const cancha = await obtenerCancha(client, opts.cancha_id);
    if (!cancha.activa || !cancha.sede_activa) throw new HttpError(400, 'La cancha no está disponible');

    const [H, M] = hora.split(':').map(Number);
    const ini = H * 60 + M;
    if (ini < cancha.hora_apertura * 60 || ini + duracion * 60 > cancha.hora_cierre * 60) {
      throw new HttpError(400, `Fuera del horario de la sede (${cancha.hora_apertura}:00 a ${cancha.hora_cierre}:00)`);
    }
    const inicio = `${fecha} ${hora}:00`;
    const fin = sumarHoras(fecha, hora, duracion);
    if (!opts.permitirPasado && inicio <= ahoraLocal().ts) throw new HttpError(400, 'No se puede reservar en el pasado');

    const clienteId = await upsertCliente(client, opts.cliente || {});
    const precio = Math.round(cancha.precio_hora * duracion * 100) / 100;
    try {
      const { rows } = await client.query(
        `INSERT INTO reservas (codigo, cancha_id, cliente_id, inicio, fin, estado, precio, origen, notas, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [codigoReserva(), cancha.id, clienteId, inicio, fin, opts.estado || 'pendiente', precio,
          opts.origen || 'mostrador', texto(opts.notas, 'notas', { requerido: false, max: 500 }), opts.creado_por || null]
      );
      return { ...rows[0], cancha: cancha.nombre, tipo_cancha: cancha.tipo, sede: cancha.sede };
    } catch (e) {
      if (e.code === '23P01') throw new HttpError(409, 'Ese horario ya está reservado en esta cancha');
      throw e;
    }
  });
}

module.exports = { disponibilidad, crearReserva, upsertCliente, DURACIONES };
