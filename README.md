# ⚽ Canchas Control

Plataforma web para administrar un negocio de canchas de **fútbol 5 y fútbol 8** con **varias sedes**:

| Necesidad | Cómo la resuelve |
|---|---|
| Reserva de canchas por clientes | Página pública `/` donde el cliente elige sede, tipo (F5/F8), cancha, fecha y hora, y recibe un **código de reserva**. Puede consultar o cancelar con código + celular. |
| Control de reservas | Agenda visual por sede y día (`/app` → Reservas). Confirmar, marcar pagada, jugada, no asistió o cancelar. La base de datos **impide reservas dobles**. |
| Ventas | Punto de venta simple: tocar productos → cobrar. **Descuenta el inventario automáticamente**. |
| Inventario | Stock por sede, entradas (compras), salidas (daños, consumo), conteo físico (ajuste), alertas de stock mínimo y kardex de movimientos con usuario y hora. |
| Información centralizada | Una sola base de datos para todas las sedes. Todos los empleados ven la misma información en tiempo real. |
| Roles | **Admin**: todas las sedes, catálogo, usuarios, reportes, anular ventas. **Operador**: solo su sede (reservas, ventas, inventario). |
| Crecer a más sedes | Abrir una sede es un formulario: se crea con su inventario listo. No hay que instalar nada nuevo. |
| Power BI | Vistas SQL listas (`bi.*`) + usuario de solo lectura, o URLs CSV/JSON con API key. |

---

## 1. Instalación rápida (Docker – recomendado)

Requisitos: un servidor o PC con [Docker](https://docs.docker.com/get-docker/).

```bash
cp .env.example .env
```

Edita `.env` (como mínimo `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_TZ`) y luego:

```bash
docker compose up -d
```

Listo:

- Clientes reservan en: `http://TU-SERVIDOR:3000/`
- Empleados ingresan en: `http://TU-SERVIDOR:3000/app`

Al arrancar, la app crea/actualiza las tablas sola. No hay migraciones manuales.

> **¿Quieres probar con datos de ejemplo?** (2 sedes, 3 canchas c/u, productos y 2 operadores):
>
> ```bash
> docker compose exec app node db/init.js --demo
> ```
>
> Operadores demo: `operador.norte@canchas.local` / `operador.sur@canchas.local`, clave `operador1234`.

## 2. Instalación en la nube (sin servidor propio)

### Render con un clic (recomendado)

El archivo `render.yaml` crea la app y la base de datos ya conectadas:

1. Crea una cuenta en [render.com](https://render.com) y conecta tu GitHub.
2. **New + → Blueprint** → elige este repositorio (rama `main`).
3. Escribe `ADMIN_EMAIL` y `ADMIN_PASSWORD` cuando te los pida → **Apply**.
4. En unos minutos tendrás una URL tipo `https://canchas-control.onrender.com`. Puedes conectar tu propio dominio en *Settings → Custom Domains*.

La clave `BI_API_KEY` para Power BI se genera sola: la ves en *Environment* del servicio.

### Otros proveedores

Funciona en cualquier servicio que corra Node.js + PostgreSQL. Ejemplo sencillo:

1. Crea una base PostgreSQL administrada (Supabase, Neon, Render, Railway, Azure Database for PostgreSQL…) y copia su URL de conexión.
2. Crea un servicio web Node.js desde este repositorio (Render, Railway, Azure App Service…).
   - Comando de inicio: `npm start`
   - Variables de entorno: las de `.env.example`, con `DATABASE_URL` de tu base y `DATABASE_SSL=true`.
3. Comparte con tus clientes la URL pública (puedes ponerla en Instagram, WhatsApp Business o Google Maps).

## 3. Instalación manual (desarrollo)

Requisitos: Node.js 20+ y PostgreSQL 13+.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run db:demo
```

```bash
npm run dev
```

Pruebas automáticas (usan una base aparte que **se borra**: `TEST_DATABASE_URL`, por defecto `canchas_test`):

```bash
npm test
```

---

## 4. Uso diario

### Primer ingreso (admin)
1. Entra a `/app` con `ADMIN_EMAIL` / `ADMIN_PASSWORD` y cambia la contraseña (botón *Contraseña*).
2. **Sedes y usuarios** → crea tus sedes (horario de apertura/cierre), sus canchas (F5/F8, precio por hora) y los usuarios de tus empleados.
3. **Productos** → crea el catálogo (bebidas, snacks, alquiler de petos, balones…). Queda disponible en todas las sedes.
4. **Inventario** → registra la *Entrada* inicial de cada producto en cada sede.

### Operador (turno en la sede)
- **Reservas**: ver la agenda del día, confirmar las reservas web pendientes, crear reservas de mostrador/teléfono haciendo clic en un espacio libre, marcar pagos.
- **Ventas**: tocar productos, elegir método de pago, *Cobrar*. El stock baja solo.
- **Inventario**: *+ Entrada* cuando llega mercancía, *− Salida* para daños/vencidos/consumo interno, *Conteo* al cierre para cuadrar con lo físico (el sistema registra la diferencia).

### Admin
- Ve **todas las sedes** o filtra una en el selector superior.
- **Inicio**: reservas, horas, ingresos por canchas y productos, top de ventas, alertas de stock.
- Puede **anular ventas** (el stock se devuelve) y definir el **stock mínimo** de alerta por sede.

---

## 5. Conectar Power BI

### Opción A — Conexión directa a PostgreSQL (recomendada)

1. En `.env` define `BI_DB_PASSWORD=una-clave` y reinicia la app: se crea el usuario **`powerbi_reader`**, que **solo puede leer** las vistas del esquema `bi`.
2. Power BI Desktop → **Obtener datos → Base de datos PostgreSQL**.
   - Servidor: `TU-SERVIDOR:5432` · Base de datos: `canchas`
   - Usuario: `powerbi_reader` · Contraseña: la de `BI_DB_PASSWORD`
3. Selecciona las vistas:

| Vista | Contenido |
|---|---|
| `bi.reservas` | Una fila por reserva: sede, cancha, tipo F5/F8, fecha, hora, día de la semana, horas, estado, precio, pagado, origen (web/mostrador/teléfono), cliente. |
| `bi.ventas_detalle` | Una fila por producto vendido: fecha, sede, producto, categoría, cantidad, precio, costo, **margen**, método de pago, vendedor, anulada. |
| `bi.inventario_actual` | Stock por sede y producto, mínimo, bajo mínimo, valor del inventario a costo. |
| `bi.movimientos_inventario` | Kardex: entradas, salidas, ventas, ajustes y anulaciones con usuario y hora. |
| `bi.canchas` | Catálogo de canchas por sede con precio y horario. |

Ideas de tableros: ocupación por cancha/hora/día, ingresos por sede, F5 vs F8, % reservas web, no-shows, margen por categoría, rotación de inventario.

### Opción B — Conector Web (sin exponer la base de datos)

1. Define `BI_API_KEY` en `.env`.
2. Power BI → **Obtener datos → Web** y pega:

```
https://TU-SERVIDOR/api/bi/reservas?format=csv&api_key=TU_BI_API_KEY
```

Datasets: `reservas`, `ventas`, `inventario`, `movimientos`, `canchas`.
Filtros opcionales: `desde=YYYY-MM-DD`, `hasta=YYYY-MM-DD`, `sede_id=N`. Sin `format=csv` devuelve JSON.
También puedes enviar la clave en el encabezado `X-API-Key`.

Desde el panel (`/app` → **Reportes / BI**) el admin puede descargar los mismos datos en CSV para Excel.

---

## 6. Arquitectura

```
Clientes (navegador/celular) ──► /            Página pública de reservas
Empleados (admin/operador)   ──► /app         Panel (reservas, ventas, inventario, config)
                                   │
                         Node.js + Express (API REST /api/...)
                                   │
                              PostgreSQL ◄──── Power BI (vistas bi.*, usuario solo lectura)
```

- `src/` API: `routes/publico.js` (reservas clientes), `routes/reservas.js`, `routes/ventas.js`, `routes/inventario.js`, `routes/config.js` (sedes, canchas, usuarios, productos), `routes/dashboard.js`, `routes/bi.js`.
- `db/schema.sql` esquema completo e idempotente (incluye las vistas BI). `db/init.js` lo aplica al arrancar.
- `public/` interfaz web sin dependencias ni compilación.
- Multi-sede: todas las tablas operativas llevan `sede_id`; el operador queda restringido a su sede en el servidor (no solo en la pantalla).
- Seguridad: contraseñas con bcrypt, sesiones JWT (12 h), límite de intentos en login y reservas públicas, restricción `EXCLUDE` en PostgreSQL contra reservas solapadas, stock nunca negativo.

### API principal

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/public/sedes` · `/api/public/disponibilidad?cancha_id&fecha` | Público |
| POST | `/api/public/reservas` · `/api/public/reservas/:codigo/cancelar` | Público |
| POST | `/api/auth/login` | Empleados |
| GET/POST/PATCH | `/api/reservas` | Admin, operador (su sede) |
| GET/POST | `/api/ventas` · POST `/api/ventas/:id/anular` (admin) | Admin, operador |
| GET | `/api/inventario` · GET/POST `/api/inventario/movimientos` | Admin, operador |
| GET/POST/PUT | `/api/sedes` `/api/canchas` `/api/usuarios` `/api/productos` | Admin (lectura para operador) |
| GET | `/api/dashboard` | Admin, operador |
| GET | `/api/bi/:dataset` | Admin o `BI_API_KEY` |

## 7. Respaldos

Con Docker:

```bash
docker compose exec db pg_dump -U canchas canchas > respaldo-$(date +%F).sql
```

Programa ese comando a diario (cron / Programador de tareas). Las bases administradas en la nube suelen incluir respaldos automáticos.
