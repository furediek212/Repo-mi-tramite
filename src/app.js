const path = require('path');
const express = require('express');
const { requiereLogin } = require('./auth');
const { HttpError } = require('./util');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/public', require('./routes/publico'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bi', require('./routes/bi'));

// Todo lo siguiente requiere sesión de empleado.
app.use('/api', requiereLogin, require('./routes/config'));
app.use('/api/reservas', requiereLogin, require('./routes/reservas'));
app.use('/api/inventario', requiereLogin, require('./routes/inventario').router);
app.use('/api/ventas', requiereLogin, require('./routes/ventas'));
app.use('/api/dashboard', requiereLogin, require('./routes/dashboard'));
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub, { extensions: ['html'] }));

// Manejo de errores uniforme: { error: "mensaje" }
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

module.exports = app;
