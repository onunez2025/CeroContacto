# Observaciones de usuario sobre el formulario - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los 5 puntos confirmados de las observaciones de usuario sobre el formulario (validacion de documento/telefono con bloqueo duro, mensaje de validacion en rojo, busqueda de modelo por codigo, y requisitos de instalacion en el Paso 4).

**Architecture:** Backend/shared primero (Tasks 1-2, cambio de formato de telefono y busqueda de catalogo, con tests reales via vitest), despues frontend (Tasks 3-7, todas en `App.tsx`/`styles.css`, sin test runner - verificacion via typecheck + navegador). Las tareas de frontend se ejecutan en secuencia, no en paralelo, porque todas tocan `App.tsx` y/o `styles.css` y correrlas en paralelo arriesgaria conflictos de git (mismo patron que el plan anterior de mejoras UX).

**Tech Stack:** React + TypeScript (frontend, sin test runner), Express + Zod (backend), Vitest (tests de `shared` y `backend`).

## Global Constraints

- Telefono: exactamente 9 digitos, sin `+51` ni ningun otro caracter (confirmado con el usuario - el celular peruano real tiene 9 digitos, no 8 como decia el documento original).
- DNI: exactamente 8 digitos. RUC: exactamente 11 digitos. CE: alfanumerico, 6-12 caracteres (sin cambios - no se pidio tocar CE mas alla de un `maxLength` de 12).
- Los campos de documento (DNI/RUC) y telefono deben usar bloqueo duro (no dejan escribir un caracter invalido o de mas) - no un aviso posterior.
- El boton "Siguiente" del Paso 1 se deshabilita (no solo se avisa) si hay un error de formato visible en documento, telefono o email. No se agrega validacion de "campo obligatorio vacio" - fuera de alcance.
- Los requisitos de instalacion del Paso 4 van siempre visibles (no colapsables), texto verbatim del documento de observaciones.
- No se toca la lista de categorias de "Tipo de equipo" ni el autocompletado de codigo postal por Distrito - ambos bloqueados por falta de datos de negocio (ver spec).
- No se ejecuta ningun cambio contra produccion en este plan - todo se prueba localmente (vitest + navegador con `npm run dev`) antes de considerar un deploy.

---

### Task 1: Telefono a 9 digitos exactos (shared + fixtures de backend)

**Files:**
- Modify: `packages/shared/src/schemas/serviceRequestDto.ts:43`
- Modify: `packages/shared/src/schemas/serviceRequestDto.test.ts`
- Modify: `packages/backend/src/app.test.ts:56`
- Modify: `packages/backend/src/handlers/submitServiceRequest.test.ts:33`
- Test: los 3 archivos `.test.ts` de arriba (ya existentes, se agregan/ajustan casos)

**Interfaces:**
- Produces: `PHONE_REGEX` en `serviceRequestDto.ts` pasa a `/^\d{9}$/` (antes `/^\+?\d{7,15}$/`). Task 3 (frontend) usa este mismo valor en su propia constante duplicada `PHONE_FORMAT_REGEX` - no hay export compartido, es el patron ya existente en el proyecto (ver comentario en `App.tsx:307-310`).

No se investigo (ni se toca) `customerLookup.test.ts` ni `customerResolution.test.ts`: ambos usan `telefono: "+51942568111"` pero como dato mockeado que VIENE de C4C (lectura), nunca pasa por `ServiceRequestSubmissionSchema` - no se rompen con este cambio.

- [ ] **Step 1: Escribir el test que falla (rechazar formato viejo con `+51`)**

En `packages/shared/src/schemas/serviceRequestDto.test.ts`, agregar estos 2 casos dentro del `describe("ServiceRequestSubmissionSchema", ...)`, despues del test `"rechaza un RUC con digito verificador invalido"`:

```ts
  it("acepta un telefono de 9 digitos sin prefijo", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      telefono: "942568111",
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un telefono con prefijo +51 (formato viejo, ya no se acepta)", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      telefono: "+51942568111",
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(false);
  });
```

- [ ] **Step 2: Correr los tests y verificar que el segundo falla**

Run: `npx vitest run serviceRequestDto.test.ts` (dentro de `packages/shared`)
Expected: el test `"rechaza un telefono con prefijo +51..."` FALLA (hoy `result.success` es `true` porque el regex viejo acepta el `+` y 11 digitos). El primer test nuevo ya pasa (no es una regresion, solo confirma el caso de aceptacion).

- [ ] **Step 3: Cambiar `PHONE_REGEX`**

En `packages/shared/src/schemas/serviceRequestDto.ts:43`, cambiar:

```ts
const PHONE_REGEX = /^\+?\d{7,15}$/;
```

por:

```ts
const PHONE_REGEX = /^\d{9}$/;
```

- [ ] **Step 4: Correr los tests de `shared` y confirmar que ahora fallan los que usaban el fixture viejo**

Run: `npx vitest run` (dentro de `packages/shared`)
Expected: FALLAN todos los tests de `serviceRequestDto.test.ts` que usan `baseCommon` (su `telefono: "+51942568111"` ya no matchea `/^\d{9}$/`) - esto es esperado, se corrige en el siguiente step.

- [ ] **Step 5: Corregir el fixture `baseCommon` y correr de nuevo**

En `packages/shared/src/schemas/serviceRequestDto.test.ts`, dentro de `baseCommon` (linea ~19), cambiar:

```ts
  telefono: "+51942568111",
```

por:

```ts
  telefono: "942568111",
```

Run: `npx vitest run` (dentro de `packages/shared`)
Expected: TODOS los tests de `serviceRequestDto.test.ts` pasan (incluidos los 2 nuevos del Step 1).

- [ ] **Step 6: Corregir los fixtures equivalentes en `backend` (mismo `telefono`, mismo motivo)**

En `packages/backend/src/app.test.ts:56`, dentro de `validBody`, cambiar:

```ts
  telefono: "+51942568111",
```

por:

```ts
  telefono: "942568111",
```

En `packages/backend/src/handlers/submitServiceRequest.test.ts:33`, dentro de `validBody`, cambiar exactamente igual:

```ts
  telefono: "+51942568111",
```

por:

```ts
  telefono: "942568111",
```

(No tocar `packages/backend/src/domain/customerLookup/customerLookup.test.ts` ni `packages/backend/src/domain/customerResolution/customerResolution.test.ts` ni `packages/backend/src/orchestrators/serviceRequestOrchestrator.test.ts` - ninguno de los tres pasa por `ServiceRequestSubmissionSchema.safeParse`, sus fixtures de telefono no se validan contra el regex y no necesitan cambiar.)

- [ ] **Step 7: Rebuild de `shared` y correr toda la suite de `backend`**

`shared` se consume compilado desde `backend` - hay que reconstruirlo antes de correr los tests de `backend`.

Run: `npm run build --workspace=@cerocontacto/shared` (desde la raiz del repo)
Run: `npx vitest run` (dentro de `packages/backend`)
Expected: los 101 tests existentes pasan (ninguna regresion), incluidos los 2 archivos tocados en este step.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas/serviceRequestDto.ts packages/shared/src/schemas/serviceRequestDto.test.ts packages/backend/src/app.test.ts packages/backend/src/handlers/submitServiceRequest.test.ts
git commit -m "Restringir telefono a 9 digitos exactos, sin prefijo +51"
```

---

### Task 2: Buscar productos por codigo o descripcion

**Files:**
- Modify: `packages/backend/src/domain/productCatalog/index.ts:48-52`
- Test: `packages/backend/src/domain/productCatalog/productCatalog.test.ts`

**Interfaces:**
- No cambia la firma de `searchProducts(categoriaId: string, query: string, client: IC4CODataClient): Promise<ProductCatalogItem[]>` - mismo consumidor (`packages/backend/src/app.ts`, ruta `GET /api/productos`), mismo `ProductCatalogItem { productId: string; nombre: string }`.

- [ ] **Step 1: Escribir el test que falla (busqueda por codigo de producto)**

En `packages/backend/src/domain/productCatalog/productCatalog.test.ts`, agregar este caso dentro del `describe("searchProducts", ...)`, despues del ultimo test existente:

```ts
  it("tambien matchea por ProductID (busqueda por codigo, no solo por descripcion)", async () => {
    const client = clientReturning([{ ProductID: "10008026", Description: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" }]);

    const result = await searchProducts("SCP000000", "10008026", client);

    expect(result).toEqual([{ productId: "10008026", nombre: "COCINA PIE GLP SOLE CLASSIC DUBAI 76CM" }]);
    const [path] = (client.getCollection as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toContain("substringof('10008026',ProductID)".replace(/[()',]/g, (c) => encodeURIComponent(c)));
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run productCatalog.test.ts` (dentro de `packages/backend`)
Expected: FALLA - el filtro OData actual no incluye ningun `substringof(...,ProductID)`, la asercion del `path` no encuentra ese substring.

- [ ] **Step 3: Agregar el OR sobre `ProductID` al filtro**

En `packages/backend/src/domain/productCatalog/index.ts:48-52`, cambiar:

```ts
  const filter = [
    `ProductCategoryID eq '${escapeODataString(categoriaId)}'`,
    `Status eq '2'`,
    `substringof('${escapeODataString(trimmed.toUpperCase())}',Description)`,
  ].join(" and ");
```

por:

```ts
  const texto = escapeODataString(trimmed.toUpperCase());
  const filter = [
    `ProductCategoryID eq '${escapeODataString(categoriaId)}'`,
    `Status eq '2'`,
    `(substringof('${texto}',Description) or substringof('${texto}',ProductID))`,
  ].join(" and ");
```

- [ ] **Step 4: Correr los tests y confirmar que todos pasan**

Run: `npx vitest run productCatalog.test.ts` (dentro de `packages/backend`)
Expected: PASS (4 tests: los 3 existentes + el nuevo). El test existente `"mapea ProductID/Description..."` sigue pasando porque `substringof('DUBAI',Description)` sigue apareciendo tal cual dentro del filtro mas grande, solo que ahora envuelto en un OR.

- [ ] **Step 5: Correr la suite completa de `backend`**

Run: `npx vitest run` (dentro de `packages/backend`)
Expected: 102 tests pasan (101 anteriores + el nuevo de este task), sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/domain/productCatalog/index.ts packages/backend/src/domain/productCatalog/productCatalog.test.ts
git commit -m "Buscar productos por codigo o descripcion, no solo por descripcion"
```

---

### Task 3: Bloqueo duro de digitos en Documento y Telefono (frontend)

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Produces: `sanitizeDigits(value: string, maxLen: number): string`, funcion pura a nivel de modulo (fuera del componente `App`), sin dependencias de estado - filtra caracteres no numericos y trunca a `maxLen`.
- Consume: nada nuevo - usa `form.tipoDocumento`, `update`, `clearFieldError`, `lookedUpDocumento`, `setLookedUpDocumento`, `setCustomerLookupStatus`, `clearAutofilledFields` ya existentes en `App.tsx`.

- [ ] **Step 1: Agregar `sanitizeDigits` a nivel de modulo**

En `packages/frontend/src/App.tsx`, agregar esta funcion antes de `export default function App()` (junto a otras funciones puras a nivel de modulo como `loadStoredProgress`/`saveProgress`):

```tsx
function sanitizeDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}
```

- [ ] **Step 2: Sanitizar `numeroDocumento` para DNI/RUC (no para CE)**

En `packages/frontend/src/App.tsx:410-418`, reemplazar `handleDocumentoChange` completo:

```tsx
  function handleDocumentoChange(value: string) {
    const maxLen = form.tipoDocumento === "DNI" ? 8 : form.tipoDocumento === "RUC" ? 11 : null;
    const sanitized = maxLen !== null ? sanitizeDigits(value, maxLen) : value;
    if (lookedUpDocumento !== null && sanitized !== lookedUpDocumento) {
      clearAutofilledFields();
      setLookedUpDocumento(null);
      setCustomerLookupStatus("idle");
    }
    update("numeroDocumento", sanitized);
    clearFieldError("numeroDocumento");
  }
```

En el `<input id="numeroDocumento">` (linea ~743-749), agregar `maxLength` solo para CE (unico tipo alfanumerico, el resto ya queda truncado por `sanitizeDigits`):

```tsx
              <input
                id="numeroDocumento"
                type="text"
                maxLength={form.tipoDocumento === "CE" ? 12 : undefined}
                value={form.numeroDocumento}
                onChange={(e) => handleDocumentoChange(e.target.value)}
                onBlur={handleDocumentoBlur}
              />
```

- [ ] **Step 3: Sanitizar Telefono/Telefono2 a 9 digitos y actualizar el regex de formato**

En `packages/frontend/src/App.tsx:311`, cambiar:

```tsx
  const PHONE_FORMAT_REGEX = /^\+?\d{7,15}$/;
```

por:

```tsx
  const PHONE_FORMAT_REGEX = /^\d{9}$/;
```

En el `<input id="telefono">` (lineas ~790-801), cambiar el `placeholder` y el `onChange`:

```tsx
                <input
                  id="telefono"
                  type="text"
                  placeholder="9XXXXXXXX"
                  value={form.telefono}
                  onChange={(e) => {
                    update("telefono", sanitizeDigits(e.target.value, 9));
                    clearFieldError("telefono");
                  }}
                  onBlur={() => validateOnBlur("telefono", form.telefono, (v) => PHONE_FORMAT_REGEX.test(v), "Teléfono inválido")}
                />
```

En el `<input id="telefono2">` (lineas ~805-812), igual:

```tsx
                <input
                  id="telefono2"
                  type="text"
                  placeholder="9XXXXXXXX"
                  value={form.telefono2}
                  onChange={(e) => update("telefono2", sanitizeDigits(e.target.value, 9))}
                />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` (dentro de `packages/frontend`)
Expected: sin errores.

- [ ] **Step 5: Verificacion manual en el navegador**

Con el servidor de desarrollo corriendo (`npm run dev` en `packages/frontend`):
- Con tipo de documento DNI: intentar escribir letras en Numero de documento - no deben aparecer. Escribir mas de 8 digitos - el noveno digito no debe entrar.
- Cambiar a RUC: repetir la prueba, esta vez el limite es 11 digitos.
- Cambiar a CE: confirmar que SI se pueden escribir letras (ej. "AB123456"), hasta 12 caracteres.
- En Telefono (linea 1 y linea 2): intentar escribir letras o el caracter `+` - no deben aparecer. Escribir mas de 9 digitos - el decimo no debe entrar. Confirmar que el placeholder ahora dice "9XXXXXXXX" (sin "+51 ").

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Bloquear digitos invalidos y limitar longitud en Documento y Telefono"
```

---

### Task 4: Deshabilitar "Siguiente" del Paso 1 si hay error de formato

**Files:**
- Modify: `packages/frontend/src/App.tsx:845-849`

**Interfaces:**
- Consume: `fieldErrors` (ya existe, `Record<string, string>`), sin cambios de tipo.

- [ ] **Step 1: Agregar `disabled` al boton "Siguiente" del Paso 1**

En `packages/frontend/src/App.tsx:845-849`, cambiar:

```tsx
            <div className="step-actions">
              <button type="button" className="btn-primary" onClick={() => goToStep(2)}>
                Siguiente
              </button>
            </div>
          </fieldset>
          )}

          {step === 2 && (
```

por:

```tsx
            <div className="step-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={Boolean(fieldErrors.numeroDocumento || fieldErrors.telefono || fieldErrors.email)}
                onClick={() => goToStep(2)}
              >
                Siguiente
              </button>
            </div>
          </fieldset>
          )}

          {step === 2 && (
```

(No se toca el CSS - `.btn-primary:disabled` ya existe en `styles.css` con `opacity: 0.6; cursor: wait;`, mismo estilo que otros botones deshabilitados del proyecto.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (dentro de `packages/frontend`)
Expected: sin errores.

- [ ] **Step 3: Verificacion manual en el navegador**

- Escribir un DNI de menos de 8 digitos y salir del campo (Tab) - debe aparecer "DNI inválido" Y el boton "Siguiente" debe verse atenuado/no clickeable.
- Corregir el DNI a 8 digitos validos y salir del campo - el boton "Siguiente" debe reactivarse inmediatamente.
- Repetir la misma prueba con un telefono invalido (menos de 9 digitos) y con un email sin `@`.
- Confirmar que avanzar al Paso 2 funciona normalmente cuando no hay errores.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Deshabilitar Siguiente del Paso 1 mientras haya un error de formato"
```

---

### Task 5: Mensaje "Estamos validando..." en rojo

**Files:**
- Modify: `packages/frontend/src/App.tsx:751`
- Modify: `packages/frontend/src/styles.css`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva.

- [ ] **Step 1: Cambiar el texto y la clase del mensaje de carga**

En `packages/frontend/src/App.tsx:751`, cambiar:

```tsx
              {customerLookupStatus === "loading" && <p className="hint"><Spinner />Buscando...</p>}
```

por:

```tsx
              {customerLookupStatus === "loading" && <p className="hint hint-validating"><Spinner />Estamos validando el número de documento.</p>}
```

- [ ] **Step 2: Agregar el CSS de `.hint-validating`**

En `packages/frontend/src/styles.css`, agregar inmediatamente despues del bloque `.hint` (lineas 292-296):

```css
.hint-validating {
  color: var(--error);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (dentro de `packages/frontend`)
Expected: sin errores.

- [ ] **Step 4: Verificacion manual en el navegador**

Escribir un DNI valido en el Paso 1 y confirmar que mientras busca al cliente aparece "Estamos validando el número de documento." en color rojo (no gris como antes), junto al spinner.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/styles.css
git commit -m "Mostrar mensaje de validacion de documento en rojo"
```

---

### Task 6: Simplificar el mensaje bajo "Tus equipos"

**Files:**
- Modify: `packages/frontend/src/App.tsx:1043-1046`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva.

- [ ] **Step 1: Reemplazar el texto de ayuda**

En `packages/frontend/src/App.tsx:1043-1046`, cambiar:

```tsx
            <p className="hint">
              Agrega un producto por cada equipo que necesites instalar (ej. cocina, horno y campana del mismo combo) —
              se agenda una sola visita y se genera un ticket por equipo.
            </p>
```

por:

```tsx
            <p className="hint">Agrega cada producto que deseas instalar. Si compraste varios productos, regístralos uno por uno.</p>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (dentro de `packages/frontend`)
Expected: sin errores.

- [ ] **Step 3: Verificacion manual en el navegador**

Ir al Paso 3 (Equipos) y confirmar que el texto bajo "Tus equipos" es el nuevo, mas simple.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Simplificar el mensaje de ayuda bajo Tus equipos"
```

---

### Task 7: Requisitos de instalacion en el Paso 4

**Files:**
- Modify: `packages/frontend/src/App.tsx:1099-1101`
- Modify: `packages/frontend/src/styles.css`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva - bloque estatico, sin estado ni props.

- [ ] **Step 1: Agregar el bloque de requisitos antes del calendario**

En `packages/frontend/src/App.tsx`, dentro de `step === 4` (linea ~1099-1101), cambiar:

```tsx
          {step === 4 && (
          <fieldset>
            <legend>Fecha de visita</legend>
            <div className="field">
```

por:

```tsx
          {step === 4 && (
          <fieldset>
            <legend>Fecha de visita</legend>
            <div className="requisitos-instalacion">
              <p className="requisitos-instalacion__titulo">Para la instalación de tu producto ten en cuenta</p>
              <ol>
                <li>Debes contar con una pared sólida de concreto. En paredes verticales solo se instalará el producto hasta los 2 metros de altura, medidos desde el piso hacia el punto de perforación.</li>
                <li>En paredes de materiales como el adobe drywall, fierro, acero, quincha, ladrillo hueco no se podrá realizar el servicio.</li>
                <li>El producto se debe encontrar en la zona de instalación.</li>
                <li>Contar con el área despejada, de fácil acceso y pared con las medidas adecuadas para el funcionamiento del producto.</li>
                <li>Todos nuestros productos cuentan con un Kit de instalación básico. En caso se requieran accesorios específicos consultar con nuestros especialistas.</li>
                <li>Se requiere la presencia de una persona mayor de edad responsable de dar conformidad del servicio.</li>
                <li>Algunos servicios podrían generar costos adicionales. Ejemplo: Movilidad, Perforaciones u otros servicios.</li>
              </ol>
            </div>
            <div className="field">
```

(El resto del bloque `step === 4` - el `<FechaDisponibleCalendar>`, el hint de fecha tentativa, el comentario - no cambia.)

- [ ] **Step 2: Agregar el CSS de `.requisitos-instalacion`**

En `packages/frontend/src/styles.css`, agregar al final del archivo:

```css
.requisitos-instalacion {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 1rem 1.2rem;
  margin-bottom: 1.2rem;
  background: var(--bg-sunken);
}

.requisitos-instalacion__titulo {
  margin: 0 0 0.6rem;
  font-weight: 600;
}

.requisitos-instalacion ol {
  margin: 0;
  padding-left: 1.2rem;
}

.requisitos-instalacion li {
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.requisitos-instalacion li:last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (dentro de `packages/frontend`)
Expected: sin errores.

- [ ] **Step 4: Verificacion manual en el navegador**

Ir al Paso 4 (Fecha) y confirmar que el bloque de requisitos aparece completo, arriba del calendario, con los 7 items numerados y legibles (sin desbordar en viewport movil 375px).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/styles.css
git commit -m "Agregar requisitos de instalacion al Paso 4"
```

---

## Verificacion final (despues de Task 7)

- [ ] Run: `npx tsc --noEmit` en `packages/frontend`, `packages/backend` y `packages/shared` - sin errores en ninguno.
- [ ] Run: `npx vitest run` en `packages/backend` - todos los tests pasan (101 + 3 nuevos de este plan = 104).
- [ ] Recorrido manual completo del formulario en el navegador (los 4 pasos + pantalla de exito), confirmando los 5 puntos de este plan en conjunto, no solo aislados.
