# Integridad del producto registrado y resultado parcial en combos - Design

## Contexto y problema

Se encontraron dos fallas de integridad de datos en la creación de servicios
en C4C, ambas confirmadas contra producción (`my361897`) el 2026-08-10.

### Crítico 1: productos registrados duplicados y huérfanos

El orden de la orquestación es cliente → `POST RegisteredProduct` →
`POST ServiceRequest`. Si falla la creación del ticket, el producto registrado
**ya quedó creado**. No hay rollback ni idempotencia, así que cada reintento
del cliente genera otro duplicado.

Agrava el problema que `numeroSerie` es opcional: cuando viene vacío,
`resolveRegisteredProduct` se salta la búsqueda previa por completo
(`input.numeroSerie ? ... : undefined`) y **siempre** crea uno nuevo.

Evidencia en producción, cliente `1125569` (el del incidente del 2026-08-03,
donde el ticket falló con "Inconsistencia en gestión de estados"):

| ID | ProductID | Serie | Dirección | Creado |
|---|---|---|---|---|
| 686025 | 10033522 | (vacía) | CALLE UNIVERSO MZ W LT 6D | 20:01:00 |
| 689472 | 10033522 | (vacía) | CALLE UNIVERSO MZ W LT 6D | 20:01:59 |
| 689533 | 10033522 | (vacía) | CALLE UNIVERSO MZ W LT 6D | 20:24:12 |

Los tres idénticos y huérfanos: ninguno tiene ticket asociado, porque el
`POST` del ticket falló las tres veces. Ese cliente acumula 18 productos
registrados en total, ~13 de ellos creados por el formulario entre el 30/07 y
el 03/08.

### Crítico 2: la búsqueda por serie es global, sin filtrar por cliente

Cuando el cliente **sí** escribe una serie, el código busca
`zaIDdeSerieFSM_KUT eq <serie>` en todo C4C y toma la primera coincidencia,
sin verificar que el producto le pertenezca ni que sea el modelo elegido.

Verificado en producción: la serie `"123"` coincide con más de 10 productos
distintos, de modelos distintos (`10033484`, `10012605`, `10031493`…) y dueños
distintos. Lo mismo con `"1"`.

Consecuencia: si un cliente escribe `123`, su ticket se crea con un
`InstallationPointID` que apunta al **equipo de otra persona**, y se ignora el
modelo que realmente seleccionó. El propio código ya documenta que este campo
viene "inconsistentemente poblado", pero la búsqueda no se protege contra eso.

### Problema asociado: éxito parcial reportado como fallo total

En combos se crea un ticket por producto dentro de un bucle. Si el segundo
falla, el primero **ya existe en C4C**, pero el cliente ve "No pudimos
completar tu solicitud" y sus datos se conservan para reintentar. Al
reintentar se duplica el ticket que sí se había creado.

## Investigación que definió este diseño

Todo verificado en vivo contra producción, solo lectura:

- `RegisteredProduct.ProductID`, `Street`, `PostalCode`, `House` y `State` son
  `sap:filterable="true"`. `District` **no** es filtrable.
- Una sola consulta por `ProductID + Street + PostalCode` devuelve exactamente
  los 3 duplicados del cliente `1125569`, con un filtro corto. El diseño agrega
  además `House` para distinguir departamentos o lotes distintos en una misma
  calle.
- El filtro de `Street` es **insensible a mayúsculas**: buscar
  `'calle universo mz w lt 6d la campiña'` devuelve el registro guardado como
  `'CALLE UNIVERSO MZ W LT 6D LA CAMPIÑA'`. No hace falta normalizar el texto
  que escribe el cliente.
- `RegisteredProductPartyInformationCollection` se puede filtrar por `PartyID`
  y devuelve `ParentObjectID`, lo que permite confirmar la propiedad de un
  conjunto de candidatos.
- Se evaluó la alternativa de listar todos los productos del cliente y filtrar
  en memoria: funciona, pero el filtro crece con el historial (926 caracteres
  con 18 productos; un cliente con 100 daría ~5.000). Se descarta por frágil
  sin ganar precisión.
- `RegisteredProductCollection` está declarado `sap:deletable="true"`, así que
  un rollback por `DELETE` sería posible. Se descarta: acotar bien la búsqueda
  hace que el reintento **reutilice** el huérfano, lo que resuelve el mismo
  problema sin borrar nada en producción.

## Decisiones (confirmadas con el usuario)

1. **Identidad del equipo**: dos registros son "el mismo equipo" si coinciden
   dueño + modelo + dirección de instalación. Si el cliente instala el mismo
   modelo en otra dirección, se crea uno nuevo.
2. **Serie ajena**: si la serie ingresada coincide con un equipo de otro
   cliente, se ignora — se crea el producto del cliente actual guardando la
   serie tal como la escribió. Nunca se toca el equipo ajeno y no se bloquea
   al cliente.
3. **Alcance**: se incluye el manejo de éxito parcial en combos.
4. **Fuera de alcance**: limpiar los ~13 productos huérfanos que ya existen en
   producción. Requiere borrado manual en C4C por alguien con permisos.

## Arquitectura

### `packages/backend/src/domain/registeredProduct/index.ts`

`resolveRegisteredProduct` cambia su criterio de búsqueda. La serie **deja de
ser criterio de búsqueda** y pasa a ser solo un desempate.

**Paso 1 — Candidatos por modelo y ubicación** (una consulta):

```
RegisteredProductCollection?$filter=
  ProductID eq '<productId>' and Street eq '<direccion>'
  and PostalCode eq '<codigoPostal>' and House eq '<numero>'
&$select=ObjectID,ID,zaIDdeSerieFSM_KUT
```

Si no hay candidatos, se crea un producto nuevo y termina (no se hace la
segunda consulta).

**Paso 2 — Confirmar propiedad** (solo si hubo candidatos):

```
RegisteredProductPartyInformationCollection?$filter=
  PartyID eq '<buyerPartyId>' and RoleCode eq '60'
&$select=ParentObjectID
```

Se cruzan los `ParentObjectID` devueltos con los `ObjectID` de los candidatos.
Los candidatos que no pertenezcan al cliente se descartan.

**Paso 3 — Desempate por serie**, aplicado en este orden exacto sobre los
candidatos propios:

1. **Descartar los incompatibles**: un candidato es incompatible si su serie y
   la ingresada están **ambas presentes y difieren** — eso prueba que son
   unidades físicas distintas.
2. De los que queden, **preferir** el que tenga la serie exactamente igual a la
   ingresada.
3. Si ninguno coincide en serie, tomar el primero de los compatibles.
4. Si no queda ningún compatible, crear uno nuevo.

Compatibilidad de un candidato, caso por caso:

| Serie del candidato | Serie ingresada | ¿Compatible? |
|---|---|---|
| vacía | vacía | sí (caso real de producción) |
| vacía | `XYZ` | sí |
| `ABC` | vacía | sí |
| `ABC` | `ABC` | sí, y tiene prioridad |
| `ABC` | `XYZ` | no |

El resto del comportamiento no cambia: al reutilizar, se suben las fotos al
producto existente; al crear, se sube después de crear. `RegisteredProductResult`
mantiene su forma actual (`installationPointId`, `objectId`, `wasCreated`).

Esto cierra los dos críticos: nunca se emite una consulta filtrando solo por
serie (imposible enganchar un equipo ajeno), y un reintento encuentra el
huérfano del intento anterior y lo reutiliza en vez de crear otro.

### `packages/backend/src/orchestrators/types.ts` y `serviceRequestOrchestrator.ts`

`OrchestrationResult` gana un estado intermedio:

```ts
| { status: "Completed"; ticketIds: string[] }
| { status: "Partial"; ticketIds: string[]; productosFallidos: string[]; errorMessage: string }
| { status: "Failed"; errorMessage: string }
```

El bucle que crea un ticket por producto deja de abortar al primer fallo:

- Se intentan **todos** los productos, acumulando los tickets creados y los
  productos que fallaron (identificados por su `productId`).
- Solo se capturan por producto los **errores de regla de negocio**
  (`C4CError` con `isBusinessRuleFailure`). Un error de conectividad (5xx,
  timeout) sigue propagándose y aborta todo, porque ahí reintentar sí tiene
  sentido.
- Todos OK → `Completed`. Ninguno OK → `Failed` (igual que hoy). Algunos OK →
  `Partial`.

La resolución de cliente y de productos registrados (antes del bucle) mantiene
el comportamiento actual: un fallo ahí devuelve `Failed`.

### `packages/backend/src/handlers/submitServiceRequest.ts` e `infra/auditLog.ts`

`Partial` se responde con HTTP 201 (sí se creó algo) y se registra en la
bitácora con su propio estado, distinguible de `Completed` y de `Failed`. Para
eso, `SubmissionOutcome.status` pasa de `"Completed" | "Failed" | "Error"` a
incluir `"Partial"`. La columna `Status` de `CEROCONTACTO.FormSubmissions` es
`VarChar(20)`, así que no requiere cambio de esquema en SQL.

### `packages/frontend/src/api.ts`

El contrato HTTP del formulario vive acá, **no** en `shared`: `api.ts` define
sus propios `SubmitSuccess`/`SubmitFailure` y parsea la respuesta a mano. Se
suma un tercer caso:

```ts
export interface SubmitPartial {
  status: "Partial";
  ticketIds: string[];
  productosFallidos: string[];
  errorMessage: string;
}
export type SubmitResult = SubmitSuccess | SubmitPartial | SubmitFailure;
```

`submitServiceRequest` reconoce `body.status === "Partial"` antes de su
fallback actual a `Failed`.

Nota: `SubmissionStatusEnum` y `SubmissionStatusResponseSchema` en
`packages/shared/src/schemas/serviceRequestDto.ts` **no se tocan**. Se verificó
que no los usa nadie: son restos del diseño asíncrono original (`Processing`,
`trackingId`) que la implementación síncrona v1 nunca adoptó. Agregarles
`"Partial"` no tendría efecto sobre el flujo real.

### `packages/frontend/src/App.tsx`

La pantalla de resultado maneja el caso `Partial`: muestra qué equipos quedaron
agendados con su número de ticket y cuáles no, e invita a contactar por
WhatsApp para los faltantes.

`productosFallidos` llega como lista de `productId`, que no es legible para el
cliente. Se traduce al nombre del modelo con el estado del formulario, que
sigue intacto en memoria cuando se renderiza esta pantalla (`clearStoredProgress()`
solo limpia `localStorage`; `setForm(initialState)` recién ocurre al pulsar
"Volver al formulario"):

```ts
form.productos.find((p) => p.productId === id)?.productNombre ?? id
```

`Partial` **limpia el formulario**, igual que `Completed` — porque reenviarlo
duplicaría los tickets que sí se crearon. Esto aplica tanto al
`clearStoredProgress()` del envío como al `setForm(initialState)` del botón
"Volver al formulario", cuya condición pasa de `result.status === "Completed"`
a `result.status !== "Failed"`.

## Manejo de errores

- **Fallo de conectividad con C4C** en cualquier punto: se propaga como hoy,
  el handler devuelve 502 y el cliente ve el mensaje de reintentar. No se
  convierte en `Partial`.
- **Regla de negocio al crear un ticket**: se captura por producto. Si otros
  productos sí lograron ticket, el resultado es `Partial`; si ninguno, `Failed`.
- **Regla de negocio antes del bucle** (cliente o producto registrado):
  `Failed`, sin cambios.
- **Fallo del `PATCH` de estado inicial del ticket**: sigue sin abortar nada,
  como quedó tras el arreglo del 2026-08-03.

## Testing

`packages/backend/src/domain/registeredProduct/registeredProduct.test.ts`:

- Sin candidatos en la dirección → crea uno nuevo, y no consulta
  `RegisteredProductPartyInformationCollection`.
- Candidato existe pero pertenece a otro cliente → **no** se reutiliza, se crea
  uno nuevo.
- Candidato propio con ambas series vacías → **se reutiliza** (regresión
  directa del bug de producción).
- Candidato propio con serie distinta a la ingresada (ambas presentes) → crea
  uno nuevo.
- Varios candidatos propios y la serie ingresada coincide con uno → se elige ese.
- Ninguna consulta emitida filtra únicamente por `zaIDdeSerieFSM_KUT`.

`packages/backend/src/orchestrators/serviceRequestOrchestrator.test.ts`:

- Combo de 3 productos con fallo de regla de negocio en el 2do → `Partial` con
  2 `ticketIds` y 1 `productosFallidos`, habiendo intentado los 3.
- Todos los productos fallan → `Failed`.
- Error de conectividad a mitad del bucle → se propaga, no devuelve `Partial`.
- El caso feliz existente sigue devolviendo `Completed`.

`packages/backend/src/handlers/submitServiceRequest.test.ts`:

- `Partial` responde 201 y registra su estado en la bitácora.

Frontend sin pruebas automatizadas, consistente con el resto del paquete. La
verificación en vivo la hace el implementador: envío con un combo donde un
producto falla, confirmando que se listan los tickets creados y los equipos
faltantes, y que el formulario queda limpio.

## Fuera de alcance

- Limpiar los ~13 productos registrados huérfanos ya existentes en producción.
- Actualizar en C4C los datos personales que el cliente corrige en el
  formulario (hoy se descartan para clientes existentes) — es un problema real
  y confirmado, pero independiente de estos dos críticos.
- El selector de ubicación con mapa.
- Revalidar la disponibilidad de cupo al momento de enviar.
