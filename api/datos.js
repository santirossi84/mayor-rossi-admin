import { createHash, timingSafeEqual } from 'node:crypto';
import { obtenerDoc, guardarDoc, guardarHistorial, detalleError } from './_db.js';

// Datos en Postgres (Neon), esquema apps: app "mayor-rossi", documento "datos".
// El Blob viejo (mayor-rossi/datos.json) solo se lee para rescatar la copia previa a la migración.
const APP = 'mayor-rossi', DOC = 'datos', BLOB = 'mayor-rossi/datos.json';

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

const LISTAS = ['retiros', 'gastos', 'comisiones', 'inversiones', 'cheques', 'cuenta', 'cocos', 'movs'];
const totalRegistros = d => LISTAS.reduce((a, k) => a + (d && Array.isArray(d[k]) ? d[k].length : 0), 0);

export async function GET(request) {
  const err = control(request);
  if (err) return err;
  try {
    return json(await obtenerDoc(APP, DOC, { blobRuta: BLOB }));
  } catch (e) {
    return json({ error: 'No se pudieron leer los datos: ' + detalleError(e) }, 500);
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
    const forzar = body.forzar === true;
    const r = await guardarDoc(APP, DOC, {
      revCliente: +body.rev || 0,
      data,
      // Con la base vacía no hay nada que proteger: el primer guardado (la migración desde la copia local) entra directo.
      revisar: async (actual, nueva) => {
        if (!actual) return null;
        const antes = totalRegistros(actual.data), despues = totalRegistros(nueva);
        if (!forzar && antes >= 10 && despues < antes * 0.5) {
          return { status: 422, body: { error: 'Este guardado borraria ' + (antes - despues) + ' de ' + antes + ' registros.', code: 'caida', antes, despues } };
        }
        // Si el guardado reduce registros (o fuerza un reemplazo) queda además una copia puntual del estado previo.
        if (despues < antes || forzar) {
          await guardarHistorial(APP, DOC, 'antes-de-borrar-' + new Date().toISOString(), actual);
        }
        return null;
      },
    });
    // Cualquier error sale como 500, nunca como 409: el cliente toma un 409 como "otro dispositivo guardó".
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: 'No se pudieron guardar los datos: ' + detalleError(e) }, 500);
  }
}
