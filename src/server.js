require('dotenv').config({ quiet: true });
const app = require('./app');
const { init } = require('../db/init');

const PORT = Number(process.env.PORT || 3000);

// Al arrancar aplica el esquema (idempotente): no hay que correr migraciones a mano.
init()
  .then(() => app.listen(PORT, () => console.log(`Canchas Control escuchando en http://localhost:${PORT}`)))
  .catch((e) => { console.error('No se pudo inicializar la base de datos:', e.message); process.exit(1); });
