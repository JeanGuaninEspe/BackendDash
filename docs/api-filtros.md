# Endpoints y filtros disponibles

## Uso sugerido de rangos
| Filtro              | Uso                     |
| ------------------- | ----------------------- |
| Últimos 7 / 30 días | Operativo / monitoreo   |
| Mes actual          | Seguimiento en curso    |
| Último mes completo | Reportes / comparativos |
| Rango personalizado | Análisis (hasta 90 días) |

## Reporte Estadístico (VW_REPORTE_ESTADISTICO_CATVALOR)
- Ruta JSON: GET /api/r-estadistico
- Ruta PDF: POST /api/r-estadistico/pdf (mismos query params + body con charts/KPIs)
- Filtros:
  - rango: ultimos7d | ultimos15d | ultimos90d | mesActual | ultimoMes
  - fechaInicio / fechaFin (rango personalizado, máximo 90 días)
  - idConcesion, idPeaje, cabina (número)
  - formaDePago (texto)
  - mes (1-12), anio (YYYY)
  - paginación: take (default 200, max 30000), skip (default 0)
- Body PDF (ejemplo):
  ```json
  {
    "charts": [
      { "title": "Ingreso por Categoría (EFEC)", "dataUrl": "data:image/png;base64,..." },
      { "title": "Vehículos por Categoría (EFEC)", "dataUrl": "data:image/png;base64,..." }
    ],
    "peaje": "Congoma y Los Angeles",
    "timeRange": "Últimos 7 días",
    "kpis": {
      "ingresoTotal": 834721,
      "vehiculosEfec": 15000,
      "vehiculosExentos": 500,
      "vehiculosRfid100": 200,
      "porcentajeExentos": 3.2
    }
  }
  ```
- Notas:
  - Siempre se limita a datos desde 2025-01-01.
  - Si no se envía rango/fechas, usa ultimos7d por defecto.
  - Los rangos personalizados mayores a 90 días responden 400.
  - El PDF usa los KPIs enviados en el body; si no llegan, calcula con los datos.
  - Los charts se embeben desde los `dataUrl` recibidos.

## Ventas Tag
- Ruta: GET /api/ventas-tag
- Orden: FECHA_FACTURA desc
- Ventana por defecto: últimos 90 días (para evitar respuestas muy grandes)
- Filtros opcionales:
  - fechaInicio (ISO string)
  - fechaFin (ISO string)
  - rango (ultimos7d | ultimos15d | ultimos90d | ultimoMes | ultimos7dAnterior | ultimos15dAnterior | ultimos90dAnterior | ultimoMesAnterior). Si se envía, calcula fechaInicio/fechaFin automáticamente y, con valores *Anterior, devuelve periodo actual y anterior con variación.
  - mes (number 1-12)
  - anio (number)
  - idConcesion (number)
  - idPeaje (number)
  - cliente (substring match)
  - numeroDocumentoCliente (substring match)
  - numeroFactura (substring match)
  - notaCredito (substring match)
  - formaPago (substring match)
- Paginacion:
  - take (default 200, max 10000)
  - skip (default 0)

## Facturacion (FACTURACION_COSAD)
- Ruta: GET /api/facturacion
- Orden: FECHA_FACTURA desc
- Ventana por defecto: ultimo mes (mes calendario anterior) si no se envian fechas, mes o año
- Filtros opcionales:
  - fechaInicio (ISO string)
  - fechaFin (ISO string)
  - rango (ultimos7d | ultimos15d | ultimoMes | ultimos7dAnterior | ultimos15dAnterior | ultimoMesAnterior). Si se envía, calcula fechaInicio/fechaFin automáticamente y, con valores *Anterior, devuelve periodo actual y anterior con variación.
  - mes (number 1-12)
  - anio (number; si no se envía, se limita por defecto a YEAR >= 2025)
  - numeroDocumento (substring match)
  - numeroFactura (substring match)
  - razonSocial (substring match)
  - nombrePeaje (substring match)
  - placa (substring match)
  - tipo (equals)
- Paginacion:
  - take (default 200, max 10000)
  - skip (default 0)

## Transitos (VISTA_TRANSITOS)
- Ruta: GET /api/transitos
- Orden: FECHA desc
- Ventana por defecto: ultimo mes (mes calendario anterior) si no se envian fechas, mes, año o semana
- Filtros opcionales:
  - peajeNombre (CONGOMA | LOS ANGELES; prioridad sobre peaje)
  - nombrePeaje (substring match; prioridad sobre peaje)
  - peaje (substring match)
  - cabina (number, exact)
  - turno (number, exact)
  - noFactura (substring match)
  - numeroParte (substring match)
  - nombreCajero (substring match)
  - placa (substring match)
  - categoria (substring match)
  - tipo1 (substring match)
  - tipo2 (substring match)
  - semana (number)
  - mes (number 1-12 o nombre de mes en ingles: January-December)
  - anio (number)
  - rango (ultimos7d | ultimos15d | ultimos90d | ultimoMes | ultimos7dAnterior | ultimos15dAnterior | ultimos90dAnterior | ultimoMesAnterior). Si se envía, calcula fechaInicio/fechaFin automáticamente y, con valores *Anterior, devuelve periodo actual y anterior con variación.
- Paginacion:
  - take (default 200, max 10000)
  - skip (default 0)
  - Respuesta: `[...]`
