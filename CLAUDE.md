# Mayor Rossi — finanzas personales

App para llevar las finanzas personales de Santi: retiros de la pinturería a cuenta de sueldo, gastos por categoría, facturación en ARCA, Monotributo y cobros con comisión del 5%. Reemplaza la planilla "MAYOR TRF MUTUAL BILLETERA".
Se publica sola en Vercel con cada git push a main.

## Estructura
- index.html: toda la app (HTML, CSS y JS en un solo archivo).
- api/datos.js: función de Vercel. GET y PUT de los datos en un Vercel Blob privado, protegida con el header x-clave contra la variable MAYOR_CLAVE.
- package.json: dependencia @vercel/blob.

## Datos
- Blob privado, archivo mayor-rossi/datos.json con {rev, updatedAt, data: {retiros, gastos, comisiones, inversiones, cheques, cuenta, config}}. Copia diaria en mayor-rossi/historial/.
- Control de concurrencia por rev (409 devuelve la versión del servidor). Copia local en localStorage "mayor_rossi_v1"; la clave en "mayor_rossi_clave".
- Variables en Vercel: MAYOR_CLAVE, BLOB_READ_WRITE_TOKEN (la crea Vercel al conectar el Blob). Nunca escribir la clave en el código ni en el repo.
- Los nombres de clientes nunca van al repo: la carga inicial se hace importando un respaldo .json desde Ajustes.
- Modo demo con datos inventados: botón en la pantalla de acceso o la URL con #demo. Sirve para mostrar la app en el portfolio.

## Reglas de negocio
- Montos guardados en pesos. La vista se muestra en USD o ARS. Lo impositivo (ARCA, Monotributo) siempre en pesos.
- Cotización: dólar oficial BNA, venta, de cada día (api.argentinadatos.com histórico + dolarapi.com para hoy), cacheada en localStorage "mayor_rossi_tc" por 6 horas. Cada operación se convierte con el valor de su fecha (fin de semana = último hábil anterior). config.tcManual[mes] fija un mes a mano; config.tc es el respaldo viejo y solo se usa sin conexión.
- Sueldo a retirar: objetivo mensual (hoy $ 1.500.000). Libro de retiros: subtotal del mes, diferencia contra el objetivo y diferencia acumulada. El acumulado negativo es lo que queda por retirar.
- Plan de retiro: en el mes en curso, lo que falta (incluido el arrastre) dividido por las semanas que quedan, y el ritmo parejo esperado a hoy.
- ARCA en lote: selección múltiple de transferencias pendientes, copiar lista (fecha, cliente, importe separados por tab) y marcar facturadas juntas.
- Resumen PDF: botón en el encabezado; arma la vista #print del período elegido y abre la impresión del navegador.
- Los retiros en efectivo cuentan como sueldo pero no se facturan.
- Gastos con importe negativo = ingresos o reintegros (intereses, comisiones cobradas).
- Pestaña Cartera: agrupa Inversiones, Cheques y Papá como subsecciones (vistas inversiones/cheques/papa, la última abierta queda en localStorage "mr:csub").
- Inversiones (data.inversiones): posiciones {broker, tipo cedear/accion/cripto/lecap/fci/efectivo/otro, ticker, cantidad, costo USD, precio manual}. Precios online: cripto en Binance (USDT), CEDEARs y acciones en data912 en pesos ÷ MEP de dolarapi; cache en localStorage "mayor_rossi_px" 15 min. LECAP/FCI/otro se valúan con el valor manual. Falta: importar el CSV de operaciones de Cocos.
- Cheques (data.cheques): {fecha compra, librador, pagado, nominal, vencimiento, cobrado}. TNA = (nominal/pagado − 1) × 365 / días. Alerta y badge si vence en 7 días o está vencido sin cobrar.
- Cuenta con papá (data.cuenta): {fecha, tipo cargo/pago, concepto, importe, moneda ARS/USD}. Saldo por moneda; total con el oficial de hoy. No cuenta como gasto.
- Monotributo: escala vigente desde agosto 2026 en la constante MONO de index.html; actualizarla en cada ajuste semestral.

## Estilo visual
Lenguaje Nike (getdesign.md/nike): blanco y negro (#111111 / #FFFFFF) con un solo gris de superficie (#F5F5F5) y líneas #CACACB. Rojo #D30005 solo para lo negativo o pendiente, verde #007D48 solo para lo positivo. Títulos cartel en Anton mayúsculas (reemplazo libre de Futura) y UI en Inter. Barra utilitaria gris arriba, navegación horizontal con subrayado en la sección activa, botones píldora (negro el principal), tarjetas planas sin sombra ni bordes redondeados, filtros que se invierten a negro. Sin fotos: el bloque de campaña negro con el número gigante (cuánto falta retirar) hace de imagen.
Marca visible: "Santiago Rossi" con el escudo SMR (img/logo-smr.png; img/logo-smr-180.png para la barra, el ícono de iPhone y el PDF; img/favicon.png). El escudo es el único elemento a color fuera de las señales rojo/verde.
Modo claro y oscuro con tokens CSS (:root, prefers-color-scheme y data-theme); en oscuro se invierte todo. Preferencia en Ajustes › Apariencia, guardada en localStorage "mr:theme". Los gráficos SVG toman los colores del tema desde el objeto K (readK al renderizar). El PDF siempre sale en fondo blanco.

## Forma de trabajo
- Windows y PowerShell. Las carpetas de usuario están en F:\Users\Usuario, no en C:.
- Hablar en español rioplatense, informal.
- Probar los cambios antes de proponer el push. Pedir confirmación antes de cualquier git push, porque publica en producción.
