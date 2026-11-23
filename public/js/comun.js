// Utilidades compartidas por las páginas.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
const hora = (ts) => String(ts || '').slice(11, 16);
const fechaLarga = (f) => new Date(f.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
const fechaHora = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ESTADOS = { pendiente: 'Pendiente', confirmada: 'Confirmada', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió' };
const estadoTag = (e) => `<span class="etiqueta e-${esc(e)}">${ESTADOS[e] || esc(e)}</span>`;

async function api(url, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  const t = token ?? (typeof sesion !== 'undefined' ? sesion.token : null);
  if (t) headers.authorization = 'Bearer ' + t;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || 'Error ' + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

function aviso(el, msg, tipo = 'error') {
  el.innerHTML = msg ? `<div class="aviso ${tipo}">${esc(msg)}</div>` : '';
}
