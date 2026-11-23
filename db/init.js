// Inicializa/actualiza la base de datos: esquema, admin inicial, rol BI y datos demo opcionales.
// Uso: npm run db:init   |   npm run db:demo  (agrega sedes, canchas y productos de ejemplo)
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

async function init({ demo = false, silent = false } = {}) {
  const log = silent ? () => {} : console.log;
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const tz = (process.env.APP_TZ || 'America/Bogota').replace(/'/g, '');
  await pool.query(`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), '${tz}'); END $$;`);
  log(`✔ Esquema aplicado (zona horaria ${tz})`);

  const email = (process.env.ADMIN_EMAIL || 'admin@canchas.local').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || 'admin1234';
  const { rowCount } = await pool.query('SELECT 1 FROM usuarios WHERE rol = $1 LIMIT 1', ['admin']);
  if (!rowCount) {
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1,$2,$3,'admin')`,
      ['Administrador', email, await bcrypt.hash(pass, 10)]
    );
    log(`✔ Admin creado: ${email}  (cambia la contraseña al ingresar)`);
  }

  // Usuario de solo lectura para Power BI (conexión directa a PostgreSQL).
  if (process.env.BI_DB_PASSWORD) {
    const pw = process.env.BI_DB_PASSWORD.replace(/'/g, "''");
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
        CREATE ROLE powerbi_reader LOGIN PASSWORD '${pw}';
      ELSE
        ALTER ROLE powerbi_reader WITH LOGIN PASSWORD '${pw}';
      END IF; END $$;`);
    await pool.query(`GRANT USAGE ON SCHEMA bi TO powerbi_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader;
      ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader;`);
    log('✔ Rol de solo lectura "powerbi_reader" listo (esquema bi)');
  }

  if (demo) {
    await seedDemo();
    log('✔ Datos demo cargados');
  }
}

async function seedDemo() {
  const sedes = [
    ['Sede Norte', 'Calle 140 # 10-20', '3000000001'],
    ['Sede Sur', 'Av. Primera de Mayo # 30-15', '3000000002'],
  ];
  for (const [nombre, dir, tel] of sedes) {
    await pool.query(
      `INSERT INTO sedes (nombre, direccion, telefono) VALUES ($1,$2,$3) ON CONFLICT (nombre) DO NOTHING`,
      [nombre, dir, tel]
    );
  }
  const { rows: ss } = await pool.query('SELECT id, nombre FROM sedes ORDER BY id');
  for (const s of ss) {
    for (const [n, t, p] of [['Cancha 1', 'F5', 90000], ['Cancha 2', 'F5', 90000], ['Cancha 3', 'F8', 160000]]) {
      await pool.query(
        `INSERT INTO canchas (sede_id, nombre, tipo, precio_hora) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [s.id, n, t, p]
      );
    }
  }
  const productos = [
    ['AGUA-600', 'Agua 600ml', 'Bebidas', 3000, 1200],
    ['GATORADE-500', 'Bebida hidratante 500ml', 'Bebidas', 6000, 3500],
    ['GASEOSA-400', 'Gaseosa 400ml', 'Bebidas', 4000, 2000],
    ['CERVEZA-330', 'Cerveza 330ml', 'Bebidas', 6000, 3000],
    ['PAPAS-45', 'Papas fritas 45g', 'Snacks', 3500, 1800],
    ['BALON-5', 'Balón fútbol #5', 'Accesorios', 85000, 50000],
    ['PETO', 'Alquiler de petos (juego)', 'Servicios', 10000, 0],
  ];
  for (const [sku, n, c, pv, co] of productos) {
    await pool.query(
      `INSERT INTO productos (sku, nombre, categoria, precio_venta, costo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sku) DO NOTHING`,
      [sku, n, c, pv, co]
    );
  }
  await pool.query(
    `INSERT INTO inventario (sede_id, producto_id, stock, stock_minimo)
     SELECT s.id, p.id, 24, 6 FROM sedes s CROSS JOIN productos p ON CONFLICT DO NOTHING`
  );
  const bcryptHash = await bcrypt.hash('operador1234', 10);
  for (const s of ss) {
    const email = `operador.${s.nombre.split(' ').pop().toLowerCase()}@canchas.local`;
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, sede_id) VALUES ($1,$2,$3,'operador',$4) ON CONFLICT (email) DO NOTHING`,
      [`Operador ${s.nombre}`, email, bcryptHash, s.id]
    );
  }
}

module.exports = { init };

if (require.main === module) {
  init({ demo: process.argv.includes('--demo') })
    .then(() => pool.end())
    .catch((e) => { console.error(e); process.exit(1); });
}
