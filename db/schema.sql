-- =====================================================================
-- Canchas Control - Esquema de base de datos (PostgreSQL 13+)
-- Idempotente: se puede ejecutar varias veces sin perder datos.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- Sedes ----------
CREATE TABLE IF NOT EXISTS sedes (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL UNIQUE,
  direccion       TEXT,
  telefono        TEXT,
  hora_apertura   SMALLINT NOT NULL DEFAULT 8  CHECK (hora_apertura BETWEEN 0 AND 23),
  hora_cierre     SMALLINT NOT NULL DEFAULT 23 CHECK (hora_cierre BETWEEN 1 AND 24),
  activa          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hora_cierre > hora_apertura)
);

-- ---------- Canchas ----------
CREATE TABLE IF NOT EXISTS canchas (
  id            SERIAL PRIMARY KEY,
  sede_id       INT NOT NULL REFERENCES sedes(id),
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('F5','F8')),
  precio_hora   NUMERIC(12,2) NOT NULL CHECK (precio_hora >= 0),
  activa        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (sede_id, nombre)
);

-- ---------- Usuarios (empleados) ----------
-- rol admin: acceso total a todas las sedes.
-- rol operador: opera la sede asignada (reservas, ventas, inventario).
CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  rol            TEXT NOT NULL CHECK (rol IN ('admin','operador')),
  sede_id        INT REFERENCES sedes(id),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rol = 'admin' OR sede_id IS NOT NULL)
);

-- ---------- Clientes (quienes reservan / compran) ----------
CREATE TABLE IF NOT EXISTS clientes (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  telefono   TEXT NOT NULL UNIQUE,
  email      TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Reservas ----------
-- inicio/fin en hora local de la sede. La restricción EXCLUDE impide
-- reservas solapadas en la misma cancha (salvo canceladas).
CREATE TABLE IF NOT EXISTS reservas (
  id           SERIAL PRIMARY KEY,
  codigo       TEXT NOT NULL UNIQUE,
  cancha_id    INT NOT NULL REFERENCES canchas(id),
  cliente_id   INT NOT NULL REFERENCES clientes(id),
  inicio       TIMESTAMP NOT NULL,
  fin          TIMESTAMP NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente'
               CHECK (estado IN ('pendiente','confirmada','completada','cancelada','no_asistio')),
  precio       NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
  pagado       BOOLEAN NOT NULL DEFAULT FALSE,
  origen       TEXT NOT NULL DEFAULT 'mostrador' CHECK (origen IN ('web','mostrador','telefono')),
  notas        TEXT,
  creado_por   INT REFERENCES usuarios(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fin > inicio)
);
DO $$ BEGIN
  ALTER TABLE reservas ADD CONSTRAINT reservas_sin_solape
    EXCLUDE USING gist (cancha_id WITH =, tsrange(inicio, fin, '[)') WITH &&)
    WHERE (estado NOT IN ('cancelada','no_asistio'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS reservas_inicio_idx ON reservas (inicio);

-- ---------- Catálogo de productos (global para todas las sedes) ----------
CREATE TABLE IF NOT EXISTS productos (
  id            SERIAL PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  categoria     TEXT NOT NULL DEFAULT 'General',
  precio_venta  NUMERIC(12,2) NOT NULL CHECK (precio_venta >= 0),
  costo         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Stock por sede ----------
CREATE TABLE IF NOT EXISTS inventario (
  sede_id       INT NOT NULL REFERENCES sedes(id),
  producto_id   INT NOT NULL REFERENCES productos(id),
  stock         INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo  INT NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  PRIMARY KEY (sede_id, producto_id)
);

-- ---------- Ventas ----------
CREATE TABLE IF NOT EXISTS ventas (
  id           SERIAL PRIMARY KEY,
  sede_id      INT NOT NULL REFERENCES sedes(id),
  usuario_id   INT NOT NULL REFERENCES usuarios(id),
  cliente_id   INT REFERENCES clientes(id),
  reserva_id   INT REFERENCES reservas(id),
  total        NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  metodo_pago  TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia','otro')),
  anulada      BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_fecha_idx ON ventas (creado_en);

CREATE TABLE IF NOT EXISTS venta_items (
  id               SERIAL PRIMARY KEY,
  venta_id         INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id      INT NOT NULL REFERENCES productos(id),
  cantidad         INT NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(12,2) NOT NULL,
  costo_unitario   NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal         NUMERIC(12,2) NOT NULL
);

-- ---------- Movimientos de inventario (kardex) ----------
-- cantidad es con signo: positiva = entra, negativa = sale.
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id            SERIAL PRIMARY KEY,
  sede_id       INT NOT NULL REFERENCES sedes(id),
  producto_id   INT NOT NULL REFERENCES productos(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','salida','venta','ajuste','anulacion')),
  cantidad      INT NOT NULL CHECK (cantidad <> 0),
  stock_resultante INT NOT NULL,
  motivo        TEXT,
  venta_id      INT REFERENCES ventas(id),
  usuario_id    INT NOT NULL REFERENCES usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movimientos_fecha_idx ON movimientos_inventario (creado_en);

-- =====================================================================
-- Capa BI: vistas planas listas para Power BI / Excel / Looker, etc.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS bi;

CREATE OR REPLACE VIEW bi.reservas AS
SELECT r.id AS reserva_id, r.codigo, s.id AS sede_id, s.nombre AS sede,
       c.id AS cancha_id, c.nombre AS cancha, c.tipo AS tipo_cancha,
       r.inicio::date AS fecha, r.inicio, r.fin,
       EXTRACT(HOUR FROM r.inicio)::int AS hora,
       EXTRACT(ISODOW FROM r.inicio)::int AS dia_semana,
       ROUND(EXTRACT(EPOCH FROM (r.fin - r.inicio)) / 3600.0, 2) AS horas,
       r.estado, r.precio, r.pagado, r.origen,
       cl.id AS cliente_id, cl.nombre AS cliente, cl.telefono AS cliente_telefono,
       u.nombre AS creado_por, r.creado_en
FROM reservas r
JOIN canchas c ON c.id = r.cancha_id
JOIN sedes s ON s.id = c.sede_id
JOIN clientes cl ON cl.id = r.cliente_id
LEFT JOIN usuarios u ON u.id = r.creado_por;

CREATE OR REPLACE VIEW bi.ventas_detalle AS
SELECT v.id AS venta_id, vi.id AS item_id, v.creado_en AS fecha_hora,
       v.creado_en::date AS fecha, s.id AS sede_id, s.nombre AS sede,
       p.id AS producto_id, p.sku, p.nombre AS producto, p.categoria,
       vi.cantidad, vi.precio_unitario, vi.costo_unitario, vi.subtotal,
       vi.subtotal - vi.cantidad * vi.costo_unitario AS margen,
       v.metodo_pago, v.anulada, u.nombre AS vendedor, v.reserva_id
FROM ventas v
JOIN venta_items vi ON vi.venta_id = v.id
JOIN productos p ON p.id = vi.producto_id
JOIN sedes s ON s.id = v.sede_id
JOIN usuarios u ON u.id = v.usuario_id;

CREATE OR REPLACE VIEW bi.inventario_actual AS
SELECT s.id AS sede_id, s.nombre AS sede, p.id AS producto_id, p.sku,
       p.nombre AS producto, p.categoria, i.stock, i.stock_minimo,
       (i.stock <= i.stock_minimo) AS bajo_minimo,
       p.costo, p.precio_venta, i.stock * p.costo AS valor_costo
FROM inventario i
JOIN sedes s ON s.id = i.sede_id
JOIN productos p ON p.id = i.producto_id;

CREATE OR REPLACE VIEW bi.movimientos_inventario AS
SELECT m.id AS movimiento_id, m.creado_en AS fecha_hora, m.creado_en::date AS fecha,
       s.id AS sede_id, s.nombre AS sede, p.id AS producto_id, p.sku,
       p.nombre AS producto, p.categoria, m.tipo, m.cantidad, m.stock_resultante,
       m.motivo, m.venta_id, u.nombre AS usuario
FROM movimientos_inventario m
JOIN sedes s ON s.id = m.sede_id
JOIN productos p ON p.id = m.producto_id
JOIN usuarios u ON u.id = m.usuario_id;

CREATE OR REPLACE VIEW bi.canchas AS
SELECT c.id AS cancha_id, c.nombre AS cancha, c.tipo AS tipo_cancha, c.precio_hora, c.activa,
       s.id AS sede_id, s.nombre AS sede, s.hora_apertura, s.hora_cierre
FROM canchas c JOIN sedes s ON s.id = c.sede_id;
