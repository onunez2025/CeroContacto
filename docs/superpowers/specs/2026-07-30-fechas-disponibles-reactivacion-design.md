# Reactivacion del calendario de fechas disponibles (cupos reales) - Design

## Contexto

El 24 de julio de 2026 (commit `7dadceb`) se deshabilito temporalmente el
motor de cupos (`packages/backend/src/domain/cuposEngine/`) porque,
confirmado en vivo contra C4C produccion (`my361897`), los servicios custom
de los que dependia (`cupoporarea`, `cust_producto`) no estaban
implementados ("No implementation for service"). Desde entonces el
formulario usa un campo de fecha libre sin restriccion
(`packages/frontend/src/App.tsx:884-902`), y el asesor confirma la
capacidad manualmente en C4C despues de creado el ticket.

El 30 de julio de 2026, revisando un ticket real en C4C, se encontro que:

1. El area del ticket (`zTicketArea_SDK`) usa el codigo `4` = **"GENERAL"**
   (no "Instalacion" como decia un comentario desactualizado en
   `cuposEngine/types.ts:11`).
2. La pantalla nativa de C4C "Cupos Por Area" muestra datos reales de
   capacidad (1418+ registros), lo que probaba que el dato SI existe en
   produccion aunque el servicio OData `cupoporarea` seguia fallando.
3. Revisando el Acuerdo de comunicacion "CEROCONTACTO" (Datos tecnicos >
   Servicios utilizados), se encontraron los nombres tecnicos REALES de los
   servicios custom, distintos a los que asumia el codigo original:
   - `cupos_empresa` (ya estaba marcado/habilitado)
   - `cupos_x_empresa_x_fecha` (ya estaba marcado/habilitado)
   - `plantilla_cuposarea` (encontrado sin marcar, el usuario lo activo y
     guardo el acuerdo)
4. Confirmado en vivo contra produccion, con el usuario, el significado de
   los campos de cantidad (ver "Hallazgos confirmados" abajo).

Este documento describe como reconectar el calendario de fechas
disponibles (`getFechasDisponibles` / `/api/fechas-disponibles` /
`FechaDisponibleCalendar`) contra los servicios reales. **La asignacion
automatica de contratista (`assignCupo`) queda fuera de alcance** — sigue
deshabilitada, porque todavia faltan `cust_producto` (grupo de material del
producto) y el chequeo de "tipo de servicio habilitado" por empresa, que
esa funcion si necesita.

## Hallazgos confirmados (en vivo, contra produccion my361897)

- **`plantilla_cuposarea`** (`BO_CupoPorAreaRoot`, coleccion
  `BO_CupoPorAreaRootCollection`): cupo **planificado/teorico inicial**
  por Area + Empresa + Fecha, SIN desglose por departamento. Campos
  relevantes: `Area` (string, ej. `"4"`), `zIdEmpresa`, `zFecha`
  (Edm.DateTime), `zCantidadPlanificada` (Edm.Decimal), `zActivo`
  (boolean). No tiene campo de departamento.
- **`cupos_x_empresa_x_fecha`** (`BO_CuposPorEmpresaPorFechaRoot`,
  coleccion `BO_CuposPorEmpresaPorFechaRootCollection`): cupo **real
  disponible ahora mismo**, por Empresa + Departamento + Fecha, ya
  descontando reservas. Campos relevantes: `zIdEmpresa`, `zEmpresa`,
  `zDepartamento`, `zFecha` (Edm.DateTime), `zCantidadReal` (Edm.Int32),
  `zActivo` (boolean). Verificado con datos reales: coincide exactamente
  con `zCantidadPlanificada` de `plantilla_cuposarea` en la fecha mas
  temprana sin reservas, y baja en fechas posteriores a medida que se
  consumen cupos - confirma que es el saldo real, no un duplicado del
  planificado.
- **`cupos_empresa`** (`BO_CuposEmpresaRoot` + hijos
  `BO_CuposEmpresaCuposGrupoMaterial` y `BO_CuposEmpresaCuposEmpresaFecha`):
  coincide con lo que ya asumia el codigo (`zCupIdEmpresa`, `zCupDepart`,
  `zCupactivo`, `zCupPrioridadNEw`, dias habilitados
  `zCupFechLunes`..`zCupFechDomingo` + `zCupFechDepartamento` +
  `zCupFechRegin`). Sin cambios necesarios aqui.
- **`BO_CuposEmpresaCuposTipoServicio`** (hijo de `cupos_empresa` que
  usaba `isTipoServicioHabilitado`): confirmado que NO existe en
  produccion ("Ressource fur das Segment ... nicht gefunden").
- **`cust_producto`** (usado por `getProductGroup`): confirmado que sigue
  sin implementarse en produccion ("No implementation for service"),
  igual que el 24 de julio.
- **Limitacion de OData ya conocida, sigue vigente en el nuevo servicio**:
  un filtro con `zFecha ge ... and zFecha le ...` combinado con otros
  campos (departamento, empresa, activo, cantidad) produce error 500
  ("Ausdruck kann nicht in ABAP-Selektionsoptionen umgewandelt werden").
  Un solo lado (`ge`) combinado con el resto SI funciona (confirmado en
  vivo). El limite superior (`hasta`) se sigue filtrando del lado del
  backend, igual que antes.

## Decisiones (confirmadas con el usuario)

1. **Semantica de cantidades**: `zCantidadPlanificada`
   (`plantilla_cuposarea`) = cupo teorico/inicial por empresa+fecha, sin
   desglose por departamento. `zCantidadReal`
   (`cupos_x_empresa_x_fecha`) = lo que realmente queda disponible ahora,
   por empresa+departamento+fecha, ya descontando reservas. **La
   disponibilidad para el calendario se calcula sobre `zCantidadReal`**,
   no sobre `zCantidadPlanificada` (que no tiene granularidad de
   departamento y no refleja consumo).
2. **Alcance de esta iteracion**: solo se reactiva el calendario de
   fechas disponibles (lectura, no reserva nada). La asignacion
   automatica de contratista (`assignCupo`) sigue deshabilitada hasta que
   `cust_producto` y el chequeo de tipo de servicio existan en
   produccion.
3. **Umbral de disponibilidad**: una fecha se muestra como disponible si
   alguna empresa candidata elegible tiene `zCantidadReal > 10` ese dia
   (mismo colchon que el diseno original de QA, no `> 0`).
4. **Filtro de grupo de material / tipo de servicio**: se elimina de
   `getFechasDisponibles` (no se puede evaluar sin `cust_producto` /
   `BO_CuposEmpresaCuposTipoServicio`). El parametro `productIds` se
   elimina de esa funcion, de la ruta `/api/fechas-disponibles`, del
   cliente `api.ts` y del componente `FechaDisponibleCalendar` - ya no se
   usa para nada en esta iteracion. Si `cust_producto` se despliega mas
   adelante, se puede reintroducir ese filtro como un cambio incremental
   separado.
5. **Rate limiter en `/api/fechas-disponibles`**: correccion sobre una
   suposicion incorrecta de este documento - la ruta HOY NO TIENE rate
   limiter (a diferencia de `/api/codigos-postales`, que si tiene uno de
   60/min). Como hasta ahora el motor de cupos estaba deshabilitado, la
   ruta nunca se ejecutaba de verdad y el problema no era visible. Al
   reactivarla se le agrega el mismo patron ya establecido:
   `createRateLimiter({ windowMs: 60_000, max: 60 })`.

## Arquitectura

### Backend: `packages/backend/src/domain/cuposEngine/`

- **`steps.ts`**:
  - `checkCapacidadRango` (unica funcion usada por `getFechasDisponibles`):
    deja de consultar `cust/v1/cupoporarea/BO_CupoPorAreaRootCollection` y
    pasa a consultar
    `cust/v1/cupos_x_empresa_x_fecha/BO_CuposPorEmpresaPorFechaRootCollection`,
    filtrando por `zDepartamento eq <regionCode>`, `zActivo eq true`,
    `zCantidadReal gt 10`, la lista de empresas candidatas (`or` de
    `zIdEmpresa eq`), y `zFecha ge <desde>` (el limite `hasta` se sigue
    aplicando en memoria despues de parsear `/Date(ms)/`, igual que antes
    via `parseODataJsonDate`).
  - `checkCapacidad` (usada solo por `assignCupo`, fuera de alcance): NO
    se toca en esta iteracion - sigue apuntando al servicio inexistente,
    pero no se ejecuta en ningun flujo activo.
  - `getCandidateCompanies`, `getDiasHabilitados`, `isDiaHabilitado`: sin
    cambios, ya apuntan a `cupos_empresa` con los campos correctos.
  - `getProductGroup`, `isTipoServicioHabilitado`,
    `isGrupoMaterialHabilitado`: sin cambios en su implementacion (siguen
    existiendo para cuando `assignCupo` se reactive), pero
    `getFechasDisponibles` deja de llamarlas.
- **`index.ts`**: `getFechasDisponibles` elimina el paso de calcular
  `productGroups`/`distinctGroups` y las llamadas a
  `isTipoServicioHabilitado`/`isGrupoMaterialHabilitado` sobre cada
  candidata - las candidatas elegibles pasan a ser directamente el
  resultado de `getCandidateCompanies` (departamento + activo), sin
  filtro adicional de servicio/material. El resto de la logica (dias
  habilitados por candidata, interseccion con fechas con capacidad real)
  no cambia de forma.
- **`types.ts`**:
  - `SERVICE_AREA_ID` se mantiene (`"4"`), pero su comentario se corrige:
    es el area **"GENERAL"**, no "Instalacion" (confirmado en el ticket
    real 1394128).
  - `CupoPorAreaConFecha` se ajusta a los campos reales de
    `cupos_x_empresa_x_fecha`: `{ zIdEmpresa: string; zDepartamento:
    string; zFecha: string; zCantidadReal: number }` (se quita
    `zCantidadDisponible`, que no existe en ningun servicio real).
  - `FechasDisponiblesInput` elimina el campo `productIds`.
  - `CuposEngineInput` (usado solo por `assignCupo`) no se toca.

### Backend: ruta HTTP

- `packages/backend/src/app.ts`, `/api/fechas-disponibles`: se elimina la
  lectura y validacion de `req.query.productos`. La ruta ya no devuelve
  `{ fechas: [] }` tempranamente por falta de productos - solo por falta
  de `departamento` o `codigoPostal`. Se le agrega un rate limiter nuevo
  (`createRateLimiter({ windowMs: 60_000, max: 60 })`, mismo patron que
  `/api/codigos-postales`) que hoy no tiene. El resto (ventana de fechas
  manana..+41 dias, manejo de error 502) no cambia.

### Frontend

- `packages/frontend/src/api.ts`: `getFechasDisponibles(departamento,
  codigoPostal)` - se elimina el parametro `productIds` y el query param
  `productos`.
- `packages/frontend/src/FechaDisponibleCalendar.tsx`: se elimina la prop
  `productIds` y su uso en el `useEffect` (deja de estar en la lista de
  dependencias). El resto del componente (estados cargando/error/vacio/
  listo, grilla de mes, navegacion, boton de reintentar, link de
  WhatsApp) no cambia.
- `packages/frontend/src/App.tsx` (paso 4, "Fecha de visita"): se
  reemplaza el `<input type="date">` libre (lineas 884-902) por
  `<FechaDisponibleCalendar departamento={form.direccion.departamento}
  codigoPostal={form.direccion.codigoPostal} value={form.fechaVisita}
  onChange={(fecha) => update("fechaVisita", fecha)}
  whatsappUrl={WHATSAPP_URL} error={fieldErrors.fechaVisita} />`. Se
  elimina el comentario que documentaba por que estaba deshabilitado.

## Manejo de errores

- Fallo del backend (502, red caida, etc.): el calendario ya maneja esto
  con el estado `"error"` (mensaje + boton "Reintentar") - sin cambios.
- Departamento sin candidatas activas, o candidatas sin capacidad en el
  rango: estado `"vacio"` (mensaje + link de WhatsApp) - sin cambios.
- Cambio de departamento/codigo postal a mitad de una consulta en vuelo:
  el `useEffect` ya cancela la respuesta obsolete via el flag
  `cancelado` - sin cambios.

## Testing

- `cuposEngine.test.ts`: actualizar los mocks/asserts de
  `checkCapacidadRango` para el nuevo servicio/campos
  (`cupos_x_empresa_x_fecha`, `zDepartamento`, `zCantidadReal`, umbral
  `gt 10`); quitar los tests de `getFechasDisponibles` que dependian de
  `getProductGroup`/`isTipoServicioHabilitado`/`isGrupoMaterialHabilitado`
  (ya no se llaman desde ahi); agregar/actualizar un test que confirme
  que las candidatas elegibles ahora son directamente el resultado de
  `getCandidateCompanies` sin filtro adicional.
- `app.test.ts`: actualizar el test de `/api/fechas-disponibles` para no
  exigir `productos` en el query string, y confirmar que solo
  `departamento`/`codigoPostal` son obligatorios.
- No se agregan tests de integracion en vivo (consistente con el resto
  del proyecto) - la verificacion en vivo contra produccion la hace el
  controller/implementador manualmente antes de cerrar la tarea, como se
  hizo con el buscador de codigo postal.

## Fuera de alcance (explicito)

- Reactivar `assignCupo` (asignacion automatica de contratista/region al
  crear el ticket) - bloqueado por `cust_producto` y el chequeo de tipo
  de servicio, ninguno desplegado en produccion todavia.
- Reintroducir el filtro por grupo de material/tipo de servicio en el
  calendario de fechas disponibles - se puede hacer como iteracion
  separada si esos servicios se despliegan mas adelante.
- Cualquier cambio a `checkCapacidad` (version de un solo dia usada por
  `assignCupo`) - queda intacta apuntando al servicio inexistente, sin
  impacto porque no se ejecuta.
