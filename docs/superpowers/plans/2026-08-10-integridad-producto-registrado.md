# Integridad del producto registrado y resultado parcial en combos - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que un ticket apunte al equipo de otro cliente, y que los reintentos generen productos registrados duplicados en C4C.

**Architecture:** La búsqueda de producto registrado deja de filtrar por número de serie (que no es único ni propio) y pasa a identificar el equipo por dueño + modelo + dirección, verificando la propiedad contra `RegisteredProductPartyInformationCollection`. Como efecto, un reintento reutiliza el producto huérfano del intento anterior en vez de crear otro. Además, el orquestador deja de abortar el combo al primer ticket fallido y reporta un resultado parcial.

**Tech Stack:** TypeScript, Node, Vitest, Zod, React 18, SAP C4C OData v2.

## Global Constraints

- El número de serie **nunca** se usa como criterio de búsqueda; solo desempata entre candidatos ya filtrados por dueño + modelo + dirección.
- Identidad del equipo = `buyerPartyId` + `ProductID` + `Street` + `PostalCode` + `House`.
- Solo los errores de regla de negocio (`C4CError` con `isBusinessRuleFailure`) se capturan por producto. Un error de conectividad se propaga y aborta todo.
- `RoleCode` del propietario del producto registrado es `"60"`.
- No se tocan `SubmissionStatusEnum` ni `SubmissionStatusResponseSchema` en `packages/shared` — son código muerto verificado, no están en el flujo real.
- No se borra ni modifica ningún registro existente en producción.
- Comentarios de código en español **sin tildes** (estilo del repo). Texto visible al usuario en español **con tildes**.
- Todos los comandos de test se corren desde `packages/backend`, salvo el typecheck del frontend.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `packages/backend/src/domain/registeredProduct/types.ts` | Tipo de la fila de propiedad | 1 |
| `packages/backend/src/domain/registeredProduct/index.ts` | Búsqueda acotada + reutilización | 1 |
| `packages/backend/src/domain/registeredProduct/registeredProduct.test.ts` | Pruebas de identidad del producto | 1 |
| `packages/backend/src/orchestrators/types.ts` | Estado `Partial` | 2 |
| `packages/backend/src/orchestrators/serviceRequestOrchestrator.ts` | Captura de fallo por producto | 2 |
| `packages/backend/src/orchestrators/serviceRequestOrchestrator.test.ts` | Pruebas de resultado parcial | 2 |
| `packages/backend/src/infra/auditLog.ts` | Estado `Partial` en bitácora | 3 |
| `packages/backend/src/handlers/submitServiceRequest.ts` | Respuesta HTTP de `Partial` | 3 |
| `packages/backend/src/handlers/submitServiceRequest.test.ts` | Prueba del handler | 3 |
| `packages/frontend/src/api.ts` | Tipo y parseo de `Partial` | 4 |
| `packages/frontend/src/App.tsx` | Pantalla de resultado parcial | 4 |

---

### Task 1: Búsqueda acotada del producto registrado

Este es el arreglo central: cierra los dos críticos a la vez.

**Files:**
- Modify: `packages/backend/src/domain/registeredProduct/types.ts`
- Modify: `packages/backend/src/domain/registeredProduct/index.ts`
- Test: `packages/backend/src/domain/registeredProduct/registeredProduct.test.ts`

**Interfaces:**
- Consumes: `RegisteredProductInput` (ya existe, sin cambios), `and`/`eq` de `@cerocontacto/c4c-client`.
- Produces: `resolveRegisteredProduct(input, client): Promise<RegisteredProductResult>` — misma firma y misma forma de retorno que hoy (`{ installationPointId, objectId, wasCreated }`). Los llamadores no cambian.

- [ ] **Step 1: Agregar el tipo de la fila de propiedad**

En `types.ts`, al final del archivo:

```ts
/**
 * Fila de RegisteredProductPartyInformationCollection. Se consulta para
 * confirmar que un producto candidato pertenece de verdad al cliente actual
 * antes de reutilizarlo.
 */
export interface RegisteredProductPartyRecord {
  ParentObjectID: string;
}
```

- [ ] **Step 2: Escribir las pruebas que fallan**

En `registeredProduct.test.ts`, **reemplazar** la prueba `"devuelve el producto existente sin crear nada si el serial ya matchea"` (ya no describe el comportamiento deseado) y la prueba `"sube fotos tambien cuando el producto ya existia"` (su mock ya no sirve), y agregar las nuevas.

Primero, agregar este helper justo debajo de `mockClient`:

```ts
/**
 * Cliente con enrutado por path: la busqueda de candidatos y la de propiedad
 * son dos consultas distintas, asi que un unico mockResolvedValue ya no basta.
 */
function clientFromRouter(
  router: (path: string) => unknown[],
  postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" }),
): IC4CODataClient {
  return {
    getCollection: vi.fn(async (path: string) => router(path)) as unknown as IC4CODataClient["getCollection"],
    postEntity,
    patch: vi.fn(),
  };
}

/** Router de un candidato propio: misma direccion+modelo y del mismo cliente. */
function routerCandidatoPropio(candidato: Record<string, unknown>) {
  return (path: string): unknown[] =>
    path.includes("PartyInformation") ? [{ ParentObjectID: candidato.ObjectID }] : [candidato];
}
```

Ahora las pruebas nuevas, dentro del mismo `describe("resolveRegisteredProduct", ...)`:

```ts
it("busca por modelo y direccion, nunca por la serie sola", async () => {
  const getCollection = vi.fn().mockResolvedValue([]);
  const client = mockClient({ getCollection });

  await resolveRegisteredProduct(input, client);

  const decoded = decodeURIComponent((getCollection.mock.calls[0] as [string])[0]);
  expect(decoded).toContain("ProductID eq '10054511'");
  expect(decoded).toContain("Street eq 'AV. EL SOL'");
  expect(decoded).toContain("PostalCode eq '07021'");
  expect(decoded).toContain("House eq '555'");
  expect(decoded).not.toContain("zaIDdeSerieFSM_KUT eq");
});

it("crea uno nuevo sin consultar la propiedad cuando no hay candidatos en esa direccion", async () => {
  const getCollection = vi.fn().mockResolvedValue([]);
  const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
  const client = mockClient({ getCollection, postEntity });

  const result = await resolveRegisteredProduct(input, client);

  expect(result.wasCreated).toBe(true);
  expect(getCollection).toHaveBeenCalledTimes(1);
});

it("NO reutiliza un producto que pertenece a otro cliente", async () => {
  // Reproduce el bug real: la serie "123" existe en C4C pero es de otro dueño.
  const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
  const client = clientFromRouter(
    (path) =>
      path.includes("PartyInformation")
        ? [{ ParentObjectID: "OBJ-DE-OTRO-CLIENTE" }]
        : [{ ObjectID: "OBJ-AJENO", ID: "506202", zaIDdeSerieFSM_KUT: "123" }],
    postEntity,
  );

  const result = await resolveRegisteredProduct({ ...input, numeroSerie: "123" }, client);

  expect(result).toEqual({ installationPointId: "420999", objectId: "NEWOBJ", wasCreated: true });
});

it("reutiliza el producto propio cuando ambas series estan vacias", async () => {
  // Regresion del bug de produccion: 3 productos identicos creados por
  // reintentos, todos con serie vacia (cliente 1125569, 2026-08-03).
  const postEntity = vi.fn();
  const client = clientFromRouter(
    routerCandidatoPropio({ ObjectID: "PROPIO", ID: "689472", zaIDdeSerieFSM_KUT: "" }),
    postEntity,
  );

  const result = await resolveRegisteredProduct({ ...input, numeroSerie: undefined }, client);

  expect(result).toEqual({ installationPointId: "689472", objectId: "PROPIO", wasCreated: false });
  expect(postEntity).not.toHaveBeenCalled();
});

it("crea uno nuevo si el candidato propio tiene una serie distinta a la ingresada", async () => {
  const postEntity = vi.fn().mockResolvedValue({ ObjectID: "NEWOBJ", ID: "420999" });
  const client = clientFromRouter(
    routerCandidatoPropio({ ObjectID: "PROPIO", ID: "111", zaIDdeSerieFSM_KUT: "SERIE-VIEJA" }),
    postEntity,
  );

  const result = await resolveRegisteredProduct({ ...input, numeroSerie: "SERIE-NUEVA" }, client);

  expect(result.wasCreated).toBe(true);
});

it("prefiere el candidato propio cuya serie coincide exactamente", async () => {
  const candidatos = [
    { ObjectID: "P1", ID: "111", zaIDdeSerieFSM_KUT: "" },
    { ObjectID: "P2", ID: "222", zaIDdeSerieFSM_KUT: "TDM5524083854" },
  ];
  const client = clientFromRouter((path) =>
    path.includes("PartyInformation") ? [{ ParentObjectID: "P1" }, { ParentObjectID: "P2" }] : candidatos,
  );

  const result = await resolveRegisteredProduct(input, client);

  expect(result.installationPointId).toBe("222");
});

it("sube fotos tambien cuando reutiliza un producto existente", async () => {
  const postEntity = vi.fn().mockResolvedValue({});
  const client = clientFromRouter(
    routerCandidatoPropio({ ObjectID: "PROPIO", ID: "420434", zaIDdeSerieFSM_KUT: "TDM5524083854" }),
    postEntity,
  );

  await resolveRegisteredProduct({ ...input, fotos: [fakeFoto1] }, client);

  expect(postEntity).toHaveBeenCalledTimes(1);
  const [url, body] = postEntity.mock.calls[0] as [string, Record<string, unknown>];
  expect(url).toContain("RegisteredProductAttachmentFolderCollection");
  expect(body.RegisteredProductID).toBe("420434");
});
```

Nota: `fakeFoto1` ya está declarado en el archivo; la última prueba debe quedar **después** de esa declaración.

- [ ] **Step 3: Correr las pruebas para verificar que fallan**

```bash
cd packages/backend && npx vitest run src/domain/registeredProduct/registeredProduct.test.ts
```

Esperado: FAIL. Las pruebas de reutilización fallan porque hoy, con serie vacía, ni siquiera se busca; y la de "otro cliente" falla porque hoy se reutiliza el ajeno.

- [ ] **Step 4: Implementar la búsqueda acotada**

En `index.ts`, agregar el import del tipo nuevo y `and`:

```ts
import { and, eq } from "@cerocontacto/c4c-client";
import type {
  RegisteredProductInput,
  RegisteredProductPartyRecord,
  RegisteredProductRecord,
  RegisteredProductResult,
} from "./types.js";
```

Agregar la constante junto a `PHOTO_CATEGORY_CODE`:

```ts
/** RoleCode del propietario del producto registrado. */
const OWNER_ROLE_CODE = "60";
```

Agregar esta función justo antes de `resolveRegisteredProduct`:

```ts
/**
 * Busca un producto registrado que represente EL MISMO equipo fisico que el
 * que se esta registrando: mismo dueño, mismo modelo y misma direccion de
 * instalacion.
 *
 * La serie NO se usa como criterio de busqueda. Hacerlo era un bug real
 * confirmado en produccion (2026-08-10): "zaIDdeSerieFSM_KUT eq '123'"
 * matchea mas de 10 equipos de modelos y dueños distintos, y el ticket
 * terminaba apuntando al equipo de otra persona. La serie solo desempata
 * entre candidatos que ya pasaron el filtro de dueño+modelo+direccion.
 *
 * Como efecto secundario buscado, esto tambien corta los duplicados por
 * reintento: si el ticket fallo pero el producto quedo creado, el siguiente
 * intento lo encuentra y lo reutiliza en vez de crear otro.
 */
async function findReusableProduct(
  input: RegisteredProductInput,
  client: IC4CODataClient,
): Promise<RegisteredProductRecord | undefined> {
  const filter = and(
    eq("ProductID", input.productId),
    eq("Street", input.direccion.direccion),
    eq("PostalCode", input.direccion.codigoPostal),
    eq("House", input.direccion.numero),
  );
  const candidates = await client.getCollection<RegisteredProductRecord>(
    `${NS}/RegisteredProductCollection?$filter=${encodeURIComponent(filter)}&$select=ObjectID,ID,zaIDdeSerieFSM_KUT`,
  );
  if (candidates.length === 0) return undefined;

  const partyFilter = and(eq("PartyID", input.buyerPartyId), eq("RoleCode", OWNER_ROLE_CODE));
  const ownerRows = await client.getCollection<RegisteredProductPartyRecord>(
    `${NS}/RegisteredProductPartyInformationCollection?$filter=${encodeURIComponent(partyFilter)}&$select=ParentObjectID`,
  );
  const ownedIds = new Set(ownerRows.map((row) => row.ParentObjectID));

  const serie = input.numeroSerie?.trim() ?? "";
  // Un candidato es incompatible solo si AMBAS series estan presentes y
  // difieren: eso prueba que son unidades fisicas distintas. Cualquier otra
  // combinacion (alguna vacia, o iguales) se considera el mismo equipo.
  const compatibles = candidates.filter((candidate) => {
    if (!ownedIds.has(candidate.ObjectID)) return false;
    const candidateSerie = candidate.zaIDdeSerieFSM_KUT?.trim() ?? "";
    return serie === "" || candidateSerie === "" || serie === candidateSerie;
  });

  const exacto = compatibles.find(
    (candidate) => serie !== "" && (candidate.zaIDdeSerieFSM_KUT?.trim() ?? "") === serie,
  );
  return exacto ?? compatibles[0];
}
```

Reemplazar el bloque de búsqueda al inicio de `resolveRegisteredProduct` (el `const existing = input.numeroSerie ? (...) : undefined;`) por:

```ts
  const existing = await findReusableProduct(input, client);
```

Y en el `postEntity` de creación, usar la constante en vez del literal:

```ts
    RegisteredProductPartyInformation: [{ RoleCode: OWNER_ROLE_CODE, PartyID: input.buyerPartyId }],
```

Por último, actualizar el comentario de bloque de `resolveRegisteredProduct` — el actual describe la lógica vieja (`2.1 Consulta por zaIDdeSerieFSM_KUT ...`). Reemplazarlo por:

```ts
/**
 * Modulo Producto Registrado (comun a los 4 casos de cliente): reutiliza el
 * producto si ya existe uno del mismo dueño, modelo y direccion (ver
 * findReusableProduct); si no, lo crea y lo asocia al cliente.
 */
```

- [ ] **Step 5: Correr las pruebas del módulo**

```bash
cd packages/backend && npx vitest run src/domain/registeredProduct/registeredProduct.test.ts
```

Esperado: PASS, todas.

- [ ] **Step 6: Ajustar el router del test del orquestador**

`serviceRequestOrchestrator.test.ts` va a fallar hasta hacer este cambio, y el
motivo no es obvio: `"RegisteredProductPartyInformationCollection"` **no**
contiene la subcadena `"RegisteredProductCollection"` (después de
`RegisteredProduct` viene `Party`, no `Collection`), así que la consulta de
propiedad cae al `return []` final del router. Sin filas de propiedad, el
producto existente deja de considerarse propio y el caso feliz pasa a crear uno
nuevo, rompiendo `expect(ticketBody.InstallationPointID).toBe("420434")`.

En `happyPathRouter`, agregar esta rama **antes** de la de `RegisteredProductCollection`:

```ts
  if (path.includes("RegisteredProductPartyInformationCollection")) {
    return Promise.resolve([{ ParentObjectID: "PRODOBJ" }]);
  }
```

El resto del router queda igual.

- [ ] **Step 7: Correr la suite completa y el typecheck**

```bash
cd packages/backend && npx vitest run && npx tsc --noEmit
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/domain/registeredProduct packages/backend/src/orchestrators/serviceRequestOrchestrator.test.ts
git commit -m "Identificar el producto registrado por dueño, modelo y direccion, no por serie"
```

---

### Task 2: Resultado parcial en combos

**Files:**
- Modify: `packages/backend/src/orchestrators/types.ts`
- Modify: `packages/backend/src/orchestrators/serviceRequestOrchestrator.ts`
- Test: `packages/backend/src/orchestrators/serviceRequestOrchestrator.test.ts`

**Interfaces:**
- Consumes: `resolveRegisteredProduct` de Task 1 (firma sin cambios).
- Produces: `OrchestrationResult` ahora incluye `OrchestrationPartial` con `{ status: "Partial"; ticketIds: string[]; productosFallidos: string[]; errorMessage: string }`. Task 3 consume esto.

- [ ] **Step 1: Agregar el tipo `OrchestrationPartial`**

En `orchestrators/types.ts`, entre `OrchestrationSuccess` y `OrchestrationFailure`:

```ts
export interface OrchestrationPartial {
  status: "Partial";
  /** Tickets que si se crearon. */
  ticketIds: string[];
  /** productId de cada equipo que no logro ticket. */
  productosFallidos: string[];
  /** Mensaje ya saneado para el usuario final. */
  errorMessage: string;
}
```

Y cambiar la union del final:

```ts
export type OrchestrationResult = OrchestrationSuccess | OrchestrationPartial | OrchestrationFailure;
```

- [ ] **Step 2: Escribir las pruebas que fallan**

En `serviceRequestOrchestrator.test.ts`, agregar dentro del `describe`:

```ts
it("devuelve Partial cuando un producto del combo falla por regla de negocio", async () => {
  const comboSubmission: ServiceRequestSubmission = {
    ...submission,
    productos: [
      { numeroSerie: "SERIE-A", productId: "PROD-A" },
      { numeroSerie: "SERIE-B", productId: "PROD-B" },
      { numeroSerie: "SERIE-C", productId: "PROD-C" },
    ],
  };

  const postEntity = vi.fn(async (path: string, body: unknown) => {
    const b = body as Record<string, unknown>;
    if (path.includes("RegisteredProductCollection")) {
      const serie = b.zaIDdeSerieFSM_KUT as string;
      return { ObjectID: `OBJ-${serie}`, ID: `IP-${serie}` };
    }
    if (path.includes("ServiceRequestCollection")) {
      if (b.ProductID === "PROD-B") {
        throw new C4CError("Cupos agotados para los valores seleccionados", 400, {
          businessMessage: "Cupos agotados para los valores seleccionados",
        });
      }
      return { ObjectID: `TICKETOBJ-${b.ProductID}`, ID: `TICKET-${b.ProductID}` };
    }
    throw new Error(`POST inesperado en el test: ${path}`);
  });

  const client = clientFromRouter((path) => {
    if (path.includes("RegisteredProductCollection")) return Promise.resolve([]);
    return happyPathRouter(path);
  }, postEntity);

  const result = await runServiceRequestOrchestration(comboSubmission, client);

  expect(result).toEqual({
    status: "Partial",
    ticketIds: ["TICKET-PROD-A", "TICKET-PROD-C"],
    productosFallidos: ["PROD-B"],
    errorMessage: "No pudimos completar tu solicitud: Cupos agotados para los valores seleccionados",
  });
});

it("devuelve Failed cuando fallan todos los productos del combo", async () => {
  const postEntity = vi.fn(async (path: string) => {
    if (path.includes("RegisteredProductCollection")) return { ObjectID: "OBJ", ID: "IP" };
    throw new C4CError("Cupos agotados", 400, { businessMessage: "Cupos agotados" });
  });
  const client = clientFromRouter((path) => {
    if (path.includes("RegisteredProductCollection")) return Promise.resolve([]);
    return happyPathRouter(path);
  }, postEntity);

  const result = await runServiceRequestOrchestration(submission, client);

  expect(result.status).toBe("Failed");
});

it("propaga un error de conectividad a mitad del combo en vez de devolver Partial", async () => {
  const comboSubmission: ServiceRequestSubmission = {
    ...submission,
    productos: [
      { numeroSerie: "SERIE-A", productId: "PROD-A" },
      { numeroSerie: "SERIE-B", productId: "PROD-B" },
    ],
  };

  const postEntity = vi.fn(async (path: string, body: unknown) => {
    const b = body as Record<string, unknown>;
    if (path.includes("RegisteredProductCollection")) {
      return { ObjectID: "OBJ", ID: `IP-${b.zaIDdeSerieFSM_KUT as string}` };
    }
    if (b.ProductID === "PROD-B") throw new C4CError("Timeout", 504, { isTransient: true });
    return { ObjectID: "TICKETOBJ", ID: "TICKET-A" };
  });

  const client = clientFromRouter((path) => {
    if (path.includes("RegisteredProductCollection")) return Promise.resolve([]);
    return happyPathRouter(path);
  }, postEntity);

  await expect(runServiceRequestOrchestration(comboSubmission, client)).rejects.toThrow("Timeout");
});
```

- [ ] **Step 3: Correr las pruebas para verificar que fallan**

```bash
cd packages/backend && npx vitest run src/orchestrators/serviceRequestOrchestrator.test.ts
```

Esperado: FAIL — hoy el primer fallo de negocio aborta todo y devuelve `Failed`, nunca `Partial`.

- [ ] **Step 4: Implementar la captura por producto**

En `serviceRequestOrchestrator.ts`, reemplazar el bloque del bucle de tickets (desde `const ticketIds: string[] = [];` hasta el `return { status: "Completed", ticketIds };`) por:

```ts
    const ticketIds: string[] = [];
    const productosFallidos: string[] = [];
    let primerErrorDeNegocio: string | undefined;

    for (const product of products) {
      try {
        const ticket = await createTicket(
          {
            buyerPartyId: customer.buyerPartyId,
            productId: product.productId,
            installationPointId: product.installationPointId,
            fechaVisita: submission.fechaVisita,
            provincia: submission.direccion.provincia,
            distrito: submission.direccion.distrito,
            comentario: comentarioParaC4C,
          },
          client,
        );
        ticketIds.push(ticket.ticketId);
      } catch (err) {
        // Solo las reglas de negocio se capturan por producto. Un fallo de
        // conectividad (5xx/timeout) se propaga y aborta todo, porque ahi
        // reintentar la solicitud completa si tiene sentido.
        if (!(err instanceof C4CError && err.isBusinessRuleFailure)) throw err;
        productosFallidos.push(product.productId);
        primerErrorDeNegocio ??= err.businessMessage ?? "error de validacion en SAP.";
      }
    }

    if (productosFallidos.length === 0) {
      return { status: "Completed", ticketIds };
    }

    const errorMessage = `No pudimos completar tu solicitud: ${primerErrorDeNegocio}`;
    // Sin ningun ticket creado es un fallo total, igual que antes de este
    // cambio. Con algunos creados, informar el resultado real: reenviar el
    // formulario duplicaria los tickets que si existen.
    if (ticketIds.length === 0) {
      return { status: "Failed", errorMessage };
    }
    return { status: "Partial", ticketIds, productosFallidos, errorMessage };
```

- [ ] **Step 5: Correr las pruebas del orquestador**

```bash
cd packages/backend && npx vitest run src/orchestrators/serviceRequestOrchestrator.test.ts
```

Esperado: PASS, todas.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/orchestrators
git commit -m "Reportar resultado parcial cuando solo algunos equipos del combo logran ticket"
```

---

### Task 3: Propagar `Partial` por el handler y la bitácora

**Files:**
- Modify: `packages/backend/src/infra/auditLog.ts`
- Modify: `packages/backend/src/handlers/submitServiceRequest.ts`
- Test: `packages/backend/src/handlers/submitServiceRequest.test.ts`

**Interfaces:**
- Consumes: `OrchestrationPartial` de Task 2.
- Produces: respuesta HTTP `201` con body `{ status: "Partial", ticketIds: string[], productosFallidos: string[], errorMessage: string }`. Task 4 consume esta forma exacta.

- [ ] **Step 1: Escribir la prueba que falla**

En `submitServiceRequest.test.ts`, agregar dentro del `describe`:

```ts
it("devuelve 201 con tickets y productos fallidos cuando la orquestacion es parcial", async () => {
  mockOrchestration.mockResolvedValue({
    status: "Partial",
    ticketIds: ["138401"],
    productosFallidos: ["10054512"],
    errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
  });

  const res = await handleSubmitServiceRequest(validBody, fakeLog());

  expect(res.httpStatus).toBe(201);
  expect(res.body).toEqual({
    status: "Partial",
    ticketIds: ["138401"],
    productosFallidos: ["10054512"],
    errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
  });
  expect(mockRecordSubmission).toHaveBeenCalledWith(expect.anything(), {
    status: "Partial",
    ticketIds: ["138401"],
    errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
  });
});
```

- [ ] **Step 2: Correr la prueba para verificar que falla**

```bash
cd packages/backend && npx vitest run src/handlers/submitServiceRequest.test.ts
```

Esperado: FAIL — hoy `Partial` cae en la rama de `Failed` y responde 200.

- [ ] **Step 3: Agregar `Partial` a la bitácora**

En `auditLog.ts`, cambiar el campo `status` de `SubmissionOutcome`:

```ts
export interface SubmissionOutcome {
  /** "Completed" | "Partial" (algunos equipos sin ticket) | "Failed" (regla de negocio) | "Error" (excepcion no controlada, ej. C4C caido). */
  status: "Completed" | "Partial" | "Failed" | "Error";
  ticketIds?: string[];
  errorMessage?: string;
  /** Detalle tecnico (mensaje/stack crudo) - nunca se muestra al cliente, solo para diagnostico. */
  errorDetail?: string;
}
```

La columna `Status` de `CEROCONTACTO.FormSubmissions` es `VarChar(20)`, así que no hace falta ningún cambio de esquema en SQL.

- [ ] **Step 4: Manejar `Partial` en el handler**

En `submitServiceRequest.ts`, insertar este bloque justo después del `if (result.status === "Completed") { ... }`:

```ts
    if (result.status === "Partial") {
      await recordSubmissionSafely(
        parsed.data,
        { status: "Partial", ticketIds: result.ticketIds, errorMessage: result.errorMessage },
        log,
      );
      return {
        httpStatus: 201,
        body: {
          status: "Partial",
          ticketIds: result.ticketIds,
          productosFallidos: result.productosFallidos,
          errorMessage: result.errorMessage,
        },
      };
    }
```

- [ ] **Step 5: Correr la suite completa y el typecheck**

```bash
cd packages/backend && npx vitest run && npx tsc --noEmit
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/infra/auditLog.ts packages/backend/src/handlers
git commit -m "Responder 201 y registrar en bitacora el resultado parcial"
```

---

### Task 4: Pantalla de resultado parcial

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: la respuesta `201` con `{ status: "Partial", ticketIds, productosFallidos, errorMessage }` de Task 3.
- Produces: nada que consuman tareas posteriores (última tarea).

- [ ] **Step 1: Agregar el tipo `SubmitPartial` en `api.ts`**

Después de `SubmitFailure`:

```ts
export interface SubmitPartial {
  status: "Partial";
  ticketIds: string[];
  /** productId de cada equipo que no logro ticket. */
  productosFallidos: string[];
  errorMessage: string;
}
```

Y cambiar la union:

```ts
export type SubmitResult = SubmitSuccess | SubmitPartial | SubmitFailure;
```

- [ ] **Step 2: Parsear `Partial` en `submitServiceRequest`**

Ampliar el tipo del body parseado para incluir el campo nuevo:

```ts
  const body = (await res.json().catch(() => undefined)) as
    | {
        status?: string;
        ticketIds?: string[];
        productosFallidos?: string[];
        errorMessage?: string;
        error?: string;
        details?: unknown;
      }
    | undefined;
```

E insertar esta rama justo después del `if (body?.status === "Completed" ...)`:

```ts
  if (body?.status === "Partial" && body.ticketIds?.length) {
    return {
      status: "Partial",
      ticketIds: body.ticketIds,
      productosFallidos: body.productosFallidos ?? [],
      errorMessage: body.errorMessage ?? "Algunos equipos no pudieron agendarse.",
    };
  }
```

- [ ] **Step 3: Renderizar el caso parcial en `App.tsx`**

En la pantalla de resultado (`if (phase === "done" && result)`), reemplazar el ternario `{result.status === "Completed" ? (...) : (...)}` por tres bloques independientes. El contenido del caso `Completed` y del caso `Failed` se mantiene textualmente igual; solo cambia la estructura para dar lugar al tercero:

```tsx
          {result.status === "Completed" && (
            <>
              <h1>¡Listo! Tu solicitud fue registrada</h1>
              {result.ticketIds.length === 1 ? (
                <p>
                  Número de ticket: <strong>{result.ticketIds[0]}</strong>
                </p>
              ) : (
                <>
                  <p>Se generó un ticket por cada equipo:</p>
                  <ul className="ticket-list">
                    {result.ticketIds.map((id) => (
                      <li key={id}>
                        <strong>{id}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted">Nos pondremos en contacto contigo para confirmar la fecha de instalación.</p>
              <p className="muted">Un asesor te contactará por WhatsApp o email en las próximas horas para confirmar la fecha y el técnico asignado.</p>
            </>
          )}
          {result.status === "Partial" && (
            <>
              <h1>Agendamos parte de tu solicitud</h1>
              <p>Estos equipos quedaron agendados:</p>
              <ul className="ticket-list">
                {result.ticketIds.map((id) => (
                  <li key={id}>
                    <strong>{id}</strong>
                  </li>
                ))}
              </ul>
              <p>No pudimos agendar estos equipos:</p>
              <ul className="ticket-list">
                {result.productosFallidos.map((id) => (
                  <li key={id}>{form.productos.find((p) => p.productId === id)?.productNombre ?? id}</li>
                ))}
              </ul>
              <p className="muted">{result.errorMessage}</p>
              <p className="muted">
                Comunícate con nosotros por WhatsApp para agendar los equipos que faltaron.
              </p>
            </>
          )}
          {result.status === "Failed" && (
            <>
              <h1>No pudimos completar tu solicitud</h1>
              <p>{result.errorMessage}</p>
            </>
          )}
```

`form.productos` sigue intacto en memoria en este punto: `clearStoredProgress()` solo limpia `localStorage`, y `setForm(initialState)` recién ocurre al pulsar "Volver al formulario". No se necesita CSS nuevo — `.ticket-list` y `.muted` ya existen.

- [ ] **Step 4: Limpiar el formulario también en el caso parcial**

En el `onClick` del botón "Volver al formulario", cambiar la condición y su comentario:

```tsx
              // Si se creo algun ticket (Completed o Partial), no dejar los
              // datos ya enviados en el formulario: reenviarlos duplicaria
              // los tickets que si existen. Si fallo todo, el cliente vuelve
              // a ver sus datos tal como los dejo, para poder reintentar sin
              // volver a escribir todo.
              if (result.status !== "Failed") {
                setForm(initialState);
              }
```

`clearStoredProgress()` en `handleSubmit` ya se llama de forma incondicional, así que no requiere cambio.

- [ ] **Step 5: Verificar el typecheck del frontend**

```bash
cd packages/frontend && npx tsc --noEmit
```

Esperado: PASS. Si TypeScript se queja de que `result.productosFallidos` no existe en algún punto, es porque falta un `result.status === "Partial"` que lo estreche.

- [ ] **Step 6: Verificar en vivo la pantalla parcial**

El caso parcial no se puede producir a voluntad contra C4C real, así que se fuerza en el navegador:

1. Arrancar el frontend y abrirlo.
2. En la consola del navegador, forzar el estado sin tocar el código:
   ```js
   // Con el formulario abierto, interceptar la respuesta del envio:
   const orig = window.fetch;
   window.fetch = async (...args) => {
     if (String(args[0]).includes("/api/service-requests")) {
       return new Response(JSON.stringify({
         status: "Partial",
         ticketIds: ["138401"],
         productosFallidos: ["10054512"],
         errorMessage: "No pudimos completar tu solicitud: Cupos agotados",
       }), { status: 201, headers: { "Content-Type": "application/json" } });
     }
     return orig(...args);
   };
   ```
3. Completar y enviar el formulario con dos equipos, donde el segundo tenga `productId` `10054512`.
4. Confirmar que se ve el ticket `138401` en la lista de agendados, el **nombre** del modelo (no el código) en la lista de faltantes, y el mensaje de WhatsApp.
5. Pulsar "Volver al formulario" y confirmar que los campos quedaron vacíos.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src
git commit -m "Mostrar el resultado parcial con los equipos agendados y los faltantes"
```

---

## Verificación final

- [ ] Suite completa del backend y typecheck de ambos paquetes:

```bash
cd packages/backend && npx vitest run && npx tsc --noEmit
```

```bash
cd packages/frontend && npx tsc --noEmit
```

- [ ] Envío real de punta a punta contra C4C con un solo equipo, confirmando que el ticket se crea y que **no** aparece un producto registrado nuevo si se reenvía el mismo formulario dos veces (esa es la prueba directa del arreglo de duplicados).
