// Almacenamiento de los datos de la app en Postgres (Neon), en el esquema "apps".
// Reemplaza al Vercel Blob: un documento JSON {rev, updatedAt, data} por fila, con historial en otra tabla.
// Este archivo empieza con "_" para que Vercel no lo publique como ruta de la API.
//
// Migración desde el Blob (noviembre 2026): el Blob quedó bloqueado por cupo. Mientras siga conectado al proyecto
// (BLOB_READ_WRITE_TOKEN), cada documento intenta leer su copia vieja del Blob como mucho una vez por día, la guarda
// en el historial ("blob-original") y, si la app lo pide (fusionar), la mezcla con lo que ya hay en la base.
// Una vez importada no se vuelve a consultar el Blob.
import { neon } from '@neondatabase/serverless';

const ESPERA_BLOB_MS = 24 * 60 * 60 * 1000; // entre intentos de leer el Blob viejo
const DIAS_HISTORIAL = 90; // copias diarias que se conservan

let consultar = null;
let listo = null;

// Solo para pruebas: permite usar otra base (por ejemplo PGlite) con la misma firma (texto, parámetros) => filas.
export function usarConsulta(fn) {
  consultar = fn;
  listo = null;
}

function q(texto, params = []) {
  if (!consultar) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('falta DATABASE_URL: hay que conectar la base Neon al proyecto en Vercel (Storage)');
    const sql = neon(url);
    consultar = (t, p) => sql.query(t, p);
  }
  return consultar(texto, params);
}

async function crearTablas() {
  await q('create schema if not exists apps');
  await q(`create table if not exists apps.docs (
    app text not null,
    doc text not null,
    rev integer not null,
    updated_at text not null,
    data jsonb not null,
    meta jsonb not null default '{}'::jsonb,
    primary key (app, doc)
  )`);
  await q(`create table if not exists apps.historial (
    id bigserial primary key,
    app text not null,
    doc text not null,
    motivo text not null,
    creado timestamptz not null default now(),
    contenido jsonb not null,
    unique (app, doc, motivo)
  )`);
}

async function preparar() {
  if (!listo) {
    // Dos funciones arrancando a la vez pueden chocar al crear el esquema: se reintenta una vez.
    listo = crearTablas().catch(() => crearTablas());
    listo.catch(() => { listo = null; });
  }
  return listo;
}

const publico = (f) => ({ rev: f.rev, updatedAt: f.updatedAt, data: f.data });

// Ids que el rescate del Blob sumó a cada lista (solo listas de objetos con id). Se guardan en el historial
// ("blob-agregados") para que la app pueda reconocer a un dispositivo que nunca vio lo rescatado.
function idsAgregados(antes, despues) {
  const out = {};
  for (const k of Object.keys(despues || {})) {
    if (!Array.isArray(despues[k])) continue;
    const previos = new Set((antes && Array.isArray(antes[k]) ? antes[k] : []).map((x) => x && x.id));
    out[k] = despues[k].filter((x) => x && x.id != null && !previos.has(x.id)).map((x) => x.id);
  }
  return out;
}
const hoy = (iso) => String(iso || '').slice(0, 10);

async function leerFila(app, doc) {
  const filas = await q('select rev, updated_at, data, meta from apps.docs where app = $1 and doc = $2', [app, doc]);
  if (!filas.length) return null;
  const f = filas[0];
  return { rev: +f.rev, updatedAt: f.updated_at, data: f.data, meta: f.meta || {} };
}

async function crearFila(app, doc, nuevo, meta = {}) {
  const r = await q(
    `insert into apps.docs (app, doc, rev, updated_at, data, meta) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     on conflict (app, doc) do nothing returning rev`,
    [app, doc, nuevo.rev, nuevo.updatedAt, JSON.stringify(nuevo.data), JSON.stringify(meta)],
  );
  return r.length > 0;
}

// Escritura condicionada a la rev leída: si otro guardado se metió en el medio, no escribe y devuelve false.
async function actualizarFila(app, doc, revLeida, nuevo) {
  const r = await q(
    `update apps.docs set rev = $4, updated_at = $5, data = $6::jsonb
     where app = $1 and doc = $2 and rev = $3 returning rev`,
    [app, doc, revLeida, nuevo.rev, nuevo.updatedAt, JSON.stringify(nuevo.data)],
  );
  return r.length > 0;
}

async function sumarMeta(app, doc, meta) {
  await q('update apps.docs set meta = meta || $3::jsonb where app = $1 and doc = $2', [app, doc, JSON.stringify(meta)]);
}

// Guarda una copia con un nombre (motivo). Si ya existe una con ese motivo no la pisa.
export async function guardarHistorial(app, doc, motivo, contenido) {
  await preparar();
  await q(
    `insert into apps.historial (app, doc, motivo, contenido) values ($1, $2, $3, $4::jsonb)
     on conflict (app, doc, motivo) do nothing`,
    [app, doc, motivo, JSON.stringify(contenido)],
  );
}

// Devuelve el contenido de una copia del historial o null si no existe.
export async function leerHistorial(app, doc, motivo) {
  await preparar();
  const r = await q('select contenido from apps.historial where app = $1 and doc = $2 and motivo = $3', [app, doc, motivo]);
  return r.length ? r[0].contenido : null;
}

async function podarHistorial(app, doc) {
  await q(
    `delete from apps.historial where app = $1 and doc = $2 and motivo like 'dia-%'
     and creado < now() - make_interval(days => $3)`,
    [app, doc, DIAS_HISTORIAL],
  );
}

// Lee el archivo viejo del Blob. Nunca toma un "no está" como definitivo: un store suspendido puede responder raro.
export async function leerBlob(ruta, ms = 4000) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { estado: 'sin_token' };
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ms);
  try {
    const { get } = await import('@vercel/blob');
    const r = await get(ruta, { access: 'private', useCache: false, abortSignal: corte.signal });
    if (!r) return { estado: 'no_esta' };
    if (r.statusCode !== 200) return { estado: 'error', error: 'respuesta ' + r.statusCode };
    const txt = await new Response(r.stream).text();
    return { estado: 'ok', doc: JSON.parse(txt) };
  } catch (e) {
    return { estado: 'error', error: String((e && (e.name + ': ' + e.message)) || e).slice(0, 200) };
  } finally {
    clearTimeout(reloj);
  }
}

// Intenta traer la copia vieja del Blob de un documento que ya está en la base (como mucho una vez por día).
async function importarBlobPendiente(app, doc, fila, opts) {
  const { blobRuta, desdeBlob, fusionar, leer = leerBlob } = opts;
  const m = fila.meta || {};
  if (!blobRuta || m.blob === 'importado' || m.blob === 'sin_token') return fila;
  if (m.blobIntento && Date.now() - Date.parse(m.blobIntento) < ESPERA_BLOB_MS) return fila;
  const b = await leer(blobRuta);
  const ahora = new Date().toISOString();
  if (b.estado === 'sin_token') { await sumarMeta(app, doc, { blob: 'sin_token' }); return fila; }
  if (b.estado !== 'ok') { await sumarMeta(app, doc, { blobIntento: ahora, blobUltimo: b.error || b.estado }); return fila; }
  await guardarHistorial(app, doc, 'blob-original', b.doc);
  if (fusionar) {
    const viejo = desdeBlob(b.doc);
    const data = fusionar(fila.data, viejo.data);
    if (JSON.stringify(data) !== JSON.stringify(fila.data)) {
      const ok = await actualizarFila(app, doc, fila.rev, { rev: fila.rev + 1, updatedAt: ahora, data });
      if (ok) await guardarHistorial(app, doc, 'blob-agregados', idsAgregados(fila.data, data));
      if (!ok) { // otro guardado se metió en el medio: se reintenta la fusión en el próximo intento
        await sumarMeta(app, doc, { blobIntento: ahora, blobUltimo: 'fusion postergada' });
        return (await leerFila(app, doc)) || fila;
      }
    }
  }
  await sumarMeta(app, doc, { blob: 'importado', blobFecha: ahora });
  return (await leerFila(app, doc)) || fila;
}

/**
 * Lectura de un documento. Devuelve {rev, updatedAt, data} o, si la base todavía no lo tiene y el Blob viejo
 * no está disponible, {vacio: true, rev: 0, migracion: true}: el cliente que tenga una copia local la sube.
 * opts: blobRuta (archivo viejo en el Blob), desdeBlob(docBlob) => {rev, updatedAt, data}, fusionar(base, viejo) => data.
 */
export async function obtenerDoc(app, doc, opts = {}) {
  await preparar();
  const desdeBlob = opts.desdeBlob || ((d) => ({ rev: +d.rev || 0, updatedAt: d.updatedAt || new Date().toISOString(), data: d.data }));
  const o = { ...opts, desdeBlob };
  let fila = await leerFila(app, doc);
  if (!fila) {
    const b = o.blobRuta ? await (o.leer || leerBlob)(o.blobRuta) : { estado: 'sin_ruta' };
    if (b.estado !== 'ok') return { vacio: true, rev: 0, migracion: true };
    await guardarHistorial(app, doc, 'blob-original', b.doc);
    const inicial = desdeBlob(b.doc);
    if (o.fusionar) await guardarHistorial(app, doc, 'blob-agregados', idsAgregados(null, inicial.data));
    await crearFila(app, doc, inicial, { blob: 'importado', blobFecha: new Date().toISOString() });
    fila = await leerFila(app, doc);
  } else {
    fila = await importarBlobPendiente(app, doc, fila, o);
  }
  return publico(fila);
}

/**
 * Guardado con control por rev: si la rev del cliente es menor que la de la base responde 409 con la versión de la base.
 * revisar(actual, data) puede devolver {status, body} para cortar (ej. 422 si el guardado borra demasiado) y
 * puede guardar copias extra con guardarHistorial. Antes del primer guardado de cada día se copia el estado previo
 * ("dia-AAAA-MM-DD") y se borran las copias diarias de más de 90 días.
 * Devuelve {status, body}.
 */
export async function guardarDoc(app, doc, { revCliente = 0, data, revisar } = {}) {
  await preparar();
  for (let intento = 0; intento < 3; intento++) {
    const actual = await leerFila(app, doc);
    const revActual = actual ? actual.rev : 0;
    if (actual && revCliente < revActual) return { status: 409, body: publico(actual) };
    if (revisar) {
      const corte = await revisar(actual ? publico(actual) : null, data);
      if (corte) return corte;
    }
    const ahora = new Date().toISOString();
    const nuevo = { rev: Math.max(revActual, revCliente) + 1, updatedAt: ahora, data };
    if (actual && hoy(actual.updatedAt) !== hoy(ahora)) {
      await guardarHistorial(app, doc, 'dia-' + hoy(ahora), publico(actual));
      await podarHistorial(app, doc);
    }
    const ok = actual ? await actualizarFila(app, doc, revActual, nuevo) : await crearFila(app, doc, nuevo);
    if (ok) return { status: 200, body: { rev: nuevo.rev, updatedAt: nuevo.updatedAt } };
    // Otro guardado entró entre la lectura y la escritura: se vuelve a leer y el chequeo de rev decide.
  }
  const actual = await leerFila(app, doc);
  return { status: 409, body: actual ? publico(actual) : { vacio: true, rev: 0 } };
}

export function detalleError(e) {
  return String((e && e.message) || e || 'error desconocido').slice(0, 200);
}
