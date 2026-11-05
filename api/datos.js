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

const LISTAS = ['retiros', 'gastos', 'comisiones', 'inversiones', 'cheques', 'cuenta', 'cocos', 'movs'];
const totalRegistros = d => LISTAS.reduce((a, k) => a + (d && Array.isArray(d[k]) ? d[k].length : 0), 0);
const OPTS = { access: 'private', addRandomSuffix: false, contentType: 'application/json' };

// Devuelve {doc, txt, etag} o null si el archivo no existe. Cualquier otra respuesta rara es un error:
// nunca se confunde "no pude leer" con "no hay datos", porque eso haria arrancar la app en blanco.
async function leer() {
  let r;
  try {
    r = await get(PATH, { access: 'private', useCache: false });
  } catch (e) {
    if (e && (e.name === 'BlobNotFoundError' || /not.?found/i.test(String(e.message)))) return null;
    throw e;
  }
  if (!r) return null;
  if (r.statusCode !== 200) throw new Error('respuesta inesperada del Blob (' + r.statusCode + ')');
  const txt = await new Response(r.stream).text();
  return { doc: JSON.parse(txt), txt };
}

// Copia del dia: nunca pisa una existente. Se mira con get (null = no existe) porque un put que falla
// tambien cuenta como operacion avanzada del Blob y un get es una operacion simple (mucho mas barata).
async function copiaUnica(ruta, txt) {
  const previa = await get(ruta, { access: 'private', useCache: false });
  if (previa) { try { await previa.stream.cancel(); } catch {} return; }
  await put(ruta, txt, { ...OPTS, allowOverwrite: false });
}

export async function GET(request) {
  const err = control(request);
  if (err) return err;
  try {
    const actual = await leer();
    return actual ? json(actual.doc) : json({ vacio: true, rev: 0 });
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
  for (const k of ['inversiones', 'cheques', 'cuenta', 'cocos', 'movs']) {
    if (data[k] !== undefined && !Array.isArray(data[k])) return json({ error: 'Formato de datos invalido: ' + k }, 400);
  }
  try {
    const actual = await leer();
    const revCliente = +body.rev || 0;
    if (!actual && revCliente > 0) {
      // El cliente vio datos en el servidor y ahora no hay nada: no se guarda encima.
      return json({ error: 'El servidor no encuentra los datos guardados. No se sobrescribio nada: baja un respaldo desde Ajustes.', code: 'sin_base' }, 503);
    }
    const revActual = actual ? +actual.doc.rev || 0 : 0;
    if (actual && revCliente < revActual) return json(actual.doc, 409);

    const antes = actual ? totalRegistros(actual.doc.data) : 0, despues = totalRegistros(data);
    if (body.forzar !== true && antes >= 10 && despues < antes * 0.5) {
      return json({ error: 'Este guardado borraria ' + (antes - despues) + ' de ' + antes + ' registros.', code: 'caida', antes, despues }, 422);
    }

    const ahora = new Date().toISOString();
    if (actual) {
      // Estado previo a este guardado. El primero del dia queda como copia del dia (no se pisa): si el documento
      // ya se guardo hoy (updatedAt de hoy) la copia ya existe y se evita el get extra; solo se consulta una vez por dia.
      if (String(actual.doc.updatedAt || '').slice(0, 10) !== ahora.slice(0, 10)) {
        await copiaUnica('mayor-rossi/historial/' + ahora.slice(0, 10) + '.json', actual.txt);
      }
      // Si el guardado reduce registros (o fuerza un reemplazo) va ademas una copia puntual. El nombre lleva
      // milisegundos, asi que es siempre un archivo nuevo: put directo, sin get previo.
      if (despues < antes || body.forzar === true) {
        await put('mayor-rossi/historial/' + ahora.replace(/[:.]/g, '-') + '-antes-de-borrar.json', actual.txt, { ...OPTS, allowOverwrite: false });
      }
    }
    const doc = { rev: Math.max(revActual, revCliente) + 1, updatedAt: ahora, data };
    // Sin ifMatch: el control de concurrencia es solo por rev (arriba, 409 si el cliente quedo atras).
    // Cualquier error del put sube al catch de abajo y sale como 500, nunca como 409: el cliente tomaria un
    // 409 por "otro dispositivo guardo" y reintentaria.
    await put(PATH, JSON.stringify(doc), { ...OPTS, allowOverwrite: actual ? true : false });
    return json({ rev: doc.rev, updatedAt: doc.updatedAt });
  } catch (e) {
    return json({ error: 'No se pudieron guardar los datos: ' + detalle(e) }, 500);
  }
}
