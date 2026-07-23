# Calendario con fechas disponibles según cupos reales

## Contexto y problema

El campo "Fecha de visita" (paso 4 del formulario) es hoy un `<input type="date">` sin ninguna restricción: el cliente puede elegir cualquier fecha, incluidas fechas sin cupos reales cargados en C4C. El único momento en que se detecta la falta de cupos es al enviar la solicitud completa, cuando el motor de cupos (`assignCupo`) ya intentó reservar y falla con "No hay cupos disponibles para la fecha solicitada" — después de que el cliente ya llenó los 4 pasos del formulario.

El objetivo es que el cliente solo pueda seleccionar, desde el calendario mismo, fechas donde exista disponibilidad real: al menos una empresa contratista candidata para su región y sus productos con más de 10 cupos disponibles ese día.

**Riesgo operativo confirmado durante el diseño**: en C4C QA, al día de hoy (2026-07-23) el último registro de cupos cargado es del 2026-07-11 — no hay ningún cupo futuro cargado. Si esta funcionalidad se despliega sin que el equipo de C4C cargue cupos vigentes, el calendario mostrará "sin fechas disponibles" para todos los clientes. Esto no bloquea la construcción de la funcionalidad (el manejo de "sin fechas disponibles" es parte del diseño), pero es una dependencia operativa real que debe resolverse en paralelo del lado de C4C para que la funcionalidad sea útil en producción.

## Decisiones de diseño (confirmadas con el usuario)

1. **Umbral de "más de 10 cupos"**: se evalúa por empresa candidata individual (no la suma de todas las empresas de la región). Una fecha se habilita si, siguiendo el mismo orden de prioridad que usa la reserva real, la primera empresa candidata con datos ese día tiene más de 10 cupos disponibles (`zCantidadDisponible > 10`, estrictamente mayor, 10 no cuenta).
2. **UI del calendario**: componente de calendario propio en React (grilla de mes), sin agregar una librería externa de date-picker — consistente con el resto del proyecto, que no tiene dependencias de UI más allá de React.
3. **Rango de búsqueda**: 6 semanas (42 días), empezando desde **mañana** (no desde hoy — agendar una visita de instalación el mismo día no es una opción realista, igual que ya asume el mensaje actual "Fecha tentativa, sujeta a disponibilidad de cupos").
4. **Sin fechas disponibles**: en vez de un calendario vacío, se oculta el calendario y se muestra un aviso ("No tenemos fechas disponibles por el momento") junto con el botón de WhatsApp ya existente en el panel lateral, para que el cliente pueda coordinar manualmente.

## Enfoque técnico elegido: una consulta por rango, no día por día

Se evaluaron dos enfoques:

- **Día por día** (descartado): repetir la lógica de `assignCupo` para cada uno de los ~42 días del rango. Cada día implica varias llamadas a C4C (~700-900ms cada una medido en vivo contra QA), lo que llevaría a decenas de segundos de carga para el cliente. Simple de programar, pero UX inaceptable.
- **Consulta por rango** (elegido): resolver una sola vez (no por día) qué empresas candidatas califican para la región y los productos elegidos, y hacer **una sola consulta** a C4C pidiendo todos los registros de capacidad de esas empresas en las 6 semanas de una vez. La intersección con "fecha por fecha" se calcula en memoria, sin llamadas adicionales a C4C.

## Backend

### Nueva función: `getFechasDisponibles`

Ubicación: `packages/backend/src/domain/cuposEngine/` (junto al resto del motor de cupos existente, reutilizando sus funciones de `steps.ts` donde aplique).

```ts
interface FechasDisponiblesInput {
  productIds: string[];
  postalCode: string;
  regionCode: string;
  desde: string; // ISO date, por defecto manana
  hasta: string; // ISO date, por defecto manana + 41 dias (42 dias en total)
}

// Devuelve las fechas ISO que califican, ordenadas ascendente.
// Nunca lanza excepcion por falta de datos de negocio (grupo de
// material, region, empresas candidatas) - esos casos devuelven []
// igual que "no hay cupos", ya que el frontend maneja ambos casos
// con el mismo estado vacio + CTA de WhatsApp.
async function getFechasDisponibles(input: FechasDisponiblesInput, client: IC4CODataClient): Promise<string[]>
```

Pasos internos:

1. Resolver el grupo de material de cada `productId` (reutiliza `getProductGroup`, igual que `assignCupo`). Si algún producto no tiene grupo → devolver `[]`.
2. Resolver metadata de región desde `postalCode` (reutiliza `getRegionMeta`). Si no hay región activa → devolver `[]`.
3. Obtener empresas candidatas de `regionCode` en orden de prioridad (reutiliza `getCandidateCompanies`). Si no hay ninguna → devolver `[]`.
4. Para cada candidata, en orden: verificar tipo de servicio habilitado y **todos** los grupos de material de la solicitud habilitados (reutiliza `isTipoServicioHabilitado` e `isGrupoMaterialHabilitado`, ambas sin dependencia de fecha). Filtrar a la lista de "empresas elegibles", preservando el orden de prioridad.
   - Si la lista de elegibles queda vacía → devolver `[]`.
5. Para cada empresa elegible, obtener **una sola vez** (no por fecha) el registro de días de la semana habilitados — nueva función `getDiasHabilitados(objectId, regionCode, cabRegion, client)` que reutiliza el mismo filtro que `isDiaHabilitado` pero devuelve el registro completo (los 7 flags) en vez de evaluar un solo día.
6. Consultar `BO_CupoPorAreaRootCollection` **una sola vez** con filtro: `zIdArea eq '4'` (constante `SERVICE_AREA_ID` ya existente), `zDepartamento eq regionCode`, `zActivo eq true`, `zCantidadDisponible gt 10`, `zFecha ge datetime'{desde}T00:00:00' and zFecha le datetime'{hasta}T00:00:00'`, y una condición OR de `zIdEmpresa eq '<id>'` por cada empresa elegible (típicamente pocas, 2-6 empresas).
7. Agrupar los resultados por fecha. Para cada fecha en el rango, recorrer las empresas elegibles en orden de prioridad; la fecha califica si la primera empresa con un registro de capacidad ese día también tiene habilitado ese día de la semana (según el resultado del paso 5). Esto replica exactamente la semántica de "primera candidata que califica" que ya usa `assignCupo`.
8. Devolver las fechas que califican, ordenadas.

### Nuevo endpoint

`GET /api/fechas-disponibles?departamento=<regionCode>&codigoPostal=<postalCode>&productos=<id1,id2,...>`

Respuesta: `{ "fechas": ["2026-08-03", "2026-08-04", ...] }` (array vacío si no hay disponibilidad, nunca error 4xx/5xx por falta de datos de negocio).

Errores de configuración/conectividad con C4C (credenciales, timeout) sí deben propagarse como error HTTP, igual que el resto de endpoints existentes (`/api/productos`), para no confundir "no hay cupos" con "el servidor esta caido".

## Frontend

### Nuevo componente de calendario

Reemplaza el `<input type="date">` del paso 4 ("Fecha de visita"). Grilla de mes construida en React, sin librería externa:

- Al llegar al paso 4 (con dirección y al menos un producto ya completos en los pasos 2 y 3), se dispara la consulta a `/api/fechas-disponibles` con los datos ya presentes en el formulario.
- Estados de UI:
  - **Cargando**: indicador simple mientras se resuelve la consulta.
  - **Error de red/servidor**: mensaje con opción de reintentar (mismo patrón que el estado de error ya usado en `ProductoPicker` para la búsqueda de modelos).
  - **Vacío** (`fechas: []`): se oculta la grilla del calendario y se muestra el aviso "No tenemos fechas disponibles por el momento" junto con el enlace de WhatsApp ya existente.
  - **Con fechas**: grilla de mes donde solo los días presentes en `fechas` son seleccionables; el resto se muestra deshabilitado/gris. Navegación entre meses limitada al rango de 6 semanas consultado.
- Si el cliente retrocede y cambia la dirección o los productos, la consulta se vuelve a disparar al reingresar al paso 4 con datos distintos.

## Qué NO cambia

El motor de cupos real (`assignCupo`), usado al enviar la solicitud (`runServiceRequestOrchestration`), sigue siendo la única fuente de verdad para reservar un cupo. El calendario nuevo es una vista previa de solo lectura: si entre que el cliente vio el calendario y envió el formulario otra persona ocupó ese cupo, el mensaje de error actual ("No hay cupos disponibles para la fecha solicitada") sigue funcionando como respaldo — no se elimina ni se debilita esa validación.

## Testing

- **Backend**: pruebas unitarias nuevas para `getFechasDisponibles` en `packages/backend/src/domain/cuposEngine/`, con el mismo patrón de cliente C4C simulado que ya usan las pruebas existentes del motor de cupos (`cuposEngine.test.ts`). Casos a cubrir: fechas disponibles con una sola empresa elegible, sin grupo de material, sin región, sin empresas candidatas, empresa elegible sin ese día de la semana habilitado, y el límite exacto del umbral (10 cupos no habilita la fecha, 11 sí).
- **Frontend**: sin pruebas automatizadas — el paquete `frontend` no tiene suite de tests configurada actualmente (ninguno de sus componentes existentes la tiene), así que esto es consistente con el estado actual del proyecto, no una omisión nueva. La verificación del calendario se hace manualmente en el navegador (dev server), como se ha hecho con el resto de cambios de este paquete.

## Fuera de alcance

- Resolver que C4C tenga cupos futuros cargados (dependencia operativa mencionada arriba, no es parte de este cambio de código).
- Cualquier cambio a la lógica de asignación real de cupos (`assignCupo`) — se reutiliza tal cual, sin modificarla.
- Soporte para "Mantenimiento" como tipo de servicio (sigue fuera de alcance del proyecto completo).
