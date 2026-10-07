import { put, get } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const PATH = 'mayor-rossi/datos.json';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function autorizado(request) {
  const secreto = process.env.MAYOR_CLAVE || '';
  const enviada = request.headers.get('x-clave') || '';
  if (!secreto) return false;
  const a = createHash('sha256').update(enviada).digest();
  const b = createHash('sha256').update(secreto).digest();
  return timingSafeEqual(a, b);
}

function control(request) {
  if (!process.env.MAYOR_CLAVE) return json({ error: 'Falta configurar MAYOR_CLAVE en Vercel' }, 500);
  if (!autorizado(request)) return json({ error: 'Clave incorrecta' }, 401);
  return null;
}

function detalle(e) {
  const m = String((e && e.message) || e || 'error desconocido');
  if (/token|credential|oidc|unauthori|store/i.test(m)) return 'no se encuentra el almacenamiento Blob conectado al proyecto (' + m.slice(0, 160) + ')';
  return m.slice(0, 200);
}

async function leer() {
  let r;
  try {
    r = await get(PATH, { access: 'private', useCache: false });
  } catch (e) {
    if (e && (e.name === 'BlobNotFoundError' || /not.?found/i.test(String(e.message)))) return null;
    throw e;
  }
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

export async function GET(request) {
  const err = control(request);
  if (err) return err;
  try {
    const doc = await leer();
    return doc ? json(doc) : json({ vacio: true, rev: 0 });
  } catch (e) {
    return json({ error: 'No se pudieron leer los datos: ' + detalle(e) }, 500);
  }
}

export async function PUT(request) {
  const err = control(request);
  if (err) return err;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'El contenido no es JSON valido' }, 400); }
  const data = body && body.data;
  if (!data || !Array.isArray(data.retiros) || !Array.isArray(data.gastos) || !Array.isArray(data.comisiones)) {
    return json({ error: 'Formato de datos invalido' }, 400);
  }
  try {
    const actual = await leer();
    const revActual = actual ? +actual.rev || 0 : 0;
    const revCliente = +body.rev || 0;
    if (actual && revCliente < revActual) return json(actual, 409);
    const doc = { rev: Math.max(revActual, revCliente) + 1, updatedAt: new Date().toISOString(), data };
    const txt = JSON.stringify(doc);
    const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' };
    await put(PATH, txt, opts);
    await put('mayor-rossi/historial/' + doc.updatedAt.slice(0, 10) + '.json', txt, opts);
    return json({ rev: doc.rev, updatedAt: doc.updatedAt });
  } catch (e) {
    return json({ error: 'No se pudieron guardar los datos: ' + detalle(e) }, 500);
  }
}
