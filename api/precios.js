// Precios para la cartera, pedidos desde el servidor para no depender del CORS de cada fuente.
// Cripto: Binance (data-api.binance.vision funciona desde servidores en EE.UU.; api.binance.com de respaldo).
// CEDEARs y acciones: data912 (precios en pesos de BYMA). MEP: dolarapi.
// No devuelve datos del usuario: solo cotizaciones públicas.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=120, stale-while-revalidate=300',
    },
  });

async function j(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (mayor-rossi-admin)', accept: 'application/json' } });
  if (!r.ok) throw new Error(url.split('/')[2] + ' ' + r.status);
  return r.json();
}

export async function GET(request) {
  const u = new URL(request.url);
  const cripto = [...new Set((u.searchParams.get('cripto') || '').toUpperCase().split(',').filter((x) => /^[A-Z0-9]{2,12}$/.test(x)))].slice(0, 40);
  const ar = (u.searchParams.get('ar') || '').toUpperCase();
  const tick = new Set((u.searchParams.get('t') || '').toUpperCase().split(',').filter((x) => /^[A-Z0-9.]{1,12}$/.test(x)));
  const out = { cripto: {}, cedears: {}, acciones: {}, mep: 0, errores: [] };
  const jobs = [];

  if (cripto.length) {
    const base = ['https://data-api.binance.vision', 'https://api.binance.com'];
    const one = async (path) => { let e0; for (const h of base) { try { return await j(h + path); } catch (e) { e0 = e; } } throw e0; };
    const put = (x) => { if (+x.price > 0) out.cripto[x.symbol.replace(/USDT$/, '')] = +x.price; };
    jobs.push(
      one('/api/v3/ticker/price?symbols=' + encodeURIComponent(JSON.stringify(cripto.map((t) => t + 'USDT'))))
        .then((a) => a.forEach(put))
        // si un ticker no existe, Binance rechaza todo el lote: se piden de a uno
        .catch(() => Promise.all(cripto.map((t) => one('/api/v3/ticker/price?symbol=' + t + 'USDT').then(put).catch(() => out.errores.push('cripto: ' + t)))))
    );
  }
  const pull = (path, dest) =>
    j('https://data912.com/live/' + path)
      .then((a) => a.forEach((x) => { const v = +(x.c || x.px_ask || x.px_bid); if (x.symbol && v > 0 && (!tick.size || tick.has(String(x.symbol).toUpperCase()))) out[dest][x.symbol] = v; }))
      .catch((e) => out.errores.push(dest + ': ' + e.message));
  if (ar.includes('D')) jobs.push(pull('arg_cedears', 'cedears'));
  if (ar.includes('A')) jobs.push(pull('arg_stocks', 'acciones'));
  jobs.push(
    j('https://dolarapi.com/v1/dolares/bolsa')
      .then((o) => { if (+o.venta > 0) out.mep = +o.venta; })
      .catch((e) => out.errores.push('mep: ' + e.message))
  );

  await Promise.all(jobs);
  return json(out);
}
