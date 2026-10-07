# Mayor Rossi — finanzas personales

App para llevar las finanzas personales de Santi: retiros de la pinturería a cuenta de sueldo, gastos por categoría, facturación en ARCA, Monotributo y cobros con comisión del 5%. Reemplaza la planilla "MAYOR TRF MUTUAL BILLETERA".
Se publica sola en Vercel con cada git push a main.

## Estructura
- index.html: toda la app (HTML, CSS y JS en un solo archivo).
- api/datos.js: función de Vercel. GET y PUT de los datos en un Vercel Blob privado, protegida con el header x-clave contra la variable MAYOR_CLAVE.
- package.json: dependencia @vercel/blob.

## Datos
- Blob privado, archivo mayor-rossi/datos.json con {rev, updatedAt, data: {retiros, gastos, comisiones, config}}. Copia diaria en mayor-rossi/historial/.
- Control de concurrencia por rev (409 devuelve la versión del servidor). Copia local en localStorage "mayor_rossi_v1"; la clave en "mayor_rossi_clave".
- Variables en Vercel: MAYOR_CLAVE, BLOB_READ_WRITE_TOKEN (la crea Vercel al conectar el Blob). Nunca escribir la clave en el código ni en el repo.
- Los nombres de clientes nunca van al repo: la carga inicial se hace importando un respaldo .json desde Ajustes.
- Modo demo con datos inventados: botón en la pantalla de acceso o la URL con #demo. Sirve para mostrar la app en el portfolio.

## Reglas de negocio
- Montos guardados en pesos. La vista se muestra en USD o ARS con el TC mensual cargado en Ajustes (BNA vendedor). Lo impositivo (ARCA, Monotributo) siempre en pesos.
- Sueldo a retirar: objetivo mensual (hoy $ 1.500.000). Libro de retiros: subtotal del mes, diferencia contra el objetivo y diferencia acumulada. El acumulado negativo es lo que queda por retirar.
- Los retiros en efectivo cuentan como sueldo pero no se facturan.
- Gastos con importe negativo = ingresos o reintegros (intereses, comisiones cobradas).
- Monotributo: escala vigente desde agosto 2026 en la constante MONO de index.html; actualizarla en cada ajuste semestral.

## Estilo visual
Pautas de interfaz de Apple: tipografía del sistema (SF Pro), colores del sistema, tarjetas blancas sobre #F5F5F7, barra lateral translúcida que en el teléfono pasa a barra de pestañas flotante, anillo estilo Actividad para el sueldo del mes.

## Forma de trabajo
- Windows y PowerShell. Las carpetas de usuario están en F:\Users\Usuario, no en C:.
- Hablar en español rioplatense, informal.
- Probar los cambios antes de proponer el push. Pedir confirmación antes de cualquier git push, porque publica en producción.
