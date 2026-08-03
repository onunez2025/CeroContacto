# Mejoras de UX/UI del frontend - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar la experiencia de usuario del formulario en 4 frentes: pulido visual (bienvenida + estados de carga + responsive), progreso/confianza (barra de progreso + pantalla de exito), datos/validacion (guardado en localStorage + validacion onBlur), y accesibilidad (ARIA + teclado en los buscadores).

**Architecture:** Todo el trabajo es frontend puro (`packages/frontend/src/`), sin cambios de backend. Se agregan 2 componentes chicos (`Spinner.tsx`, reutilizado en 4 lugares), se extiende `App.tsx` (estado nuevo, un componente `StepHeader` con barra de progreso, persistencia en `localStorage`, validacion `onBlur`), se agrega CSS nuevo en `styles.css`, y se agregan roles ARIA + manejo de teclado en `ProductoPicker.tsx` y el buscador de codigo postal (dentro de `App.tsx`).

**Tech Stack:** React, CSS puro (sin librerias nuevas). El paquete `frontend` no tiene test runner - toda verificacion es manual en navegador (typecheck + revision visual/funcional).

## Global Constraints

- No se toca `packages/backend` ni `packages/shared` en ningun task de este plan.
- `localStorage`: guarda TODOS los campos de texto del formulario, EXCLUYE `productos[].fotos` (se guardan como `[]`). Se borra al enviar exitosamente o si el guardado tiene mas de 24 horas.
- Validacion `onBlur` (telefono, email, numeroDocumento): NO en cada tecla. El error se limpia en el siguiente `onChange` de ese mismo campo.
- La pantalla de exito (`.result-card`) NO se toca en el Task de bienvenida - cada una tiene su propia clase CSS.
- Toda lectura/escritura de `localStorage` va envuelta en `try/catch` silencioso - nunca debe romper el render ni bloquear el uso del formulario.
- `App.tsx` lo tocan los Tasks 1, 3, 4 y 5 en secuencia - los numeros de linea citados en cada task son una referencia aproximada de DONDE ESTABA el codigo al escribir este plan, no una garantia exacta despues de que tasks anteriores ya editaron el archivo. Cada implementador debe ubicar el bloque exacto por su CONTENIDO (el codigo citado textualmente en el step), no confiar ciegamente en el numero de linea.

---

### Task 1: Bienvenida menos vacia + spinners en estados de carga

**Files:**
- Create: `packages/frontend/src/Spinner.tsx`
- Modify: `packages/frontend/src/styles.css`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/ProductoPicker.tsx`
- Modify: `packages/frontend/src/FechaDisponibleCalendar.tsx`

**Interfaces:**
- Produces: `export function Spinner(): JSX.Element` en `Spinner.tsx` (sin props) - un `<span className="spinner" aria-hidden="true" />`. Consumida por los otros 3 archivos modificados en este mismo task.

- [ ] **Step 1: Crear el componente `Spinner`**

Crear `packages/frontend/src/Spinner.tsx` con este contenido exacto:

```tsx
/** Spinner CSS puro (sin dependencias) para estados de carga cortos. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
```

- [ ] **Step 2: Agregar el CSS del spinner y de `.welcome-card`**

En `packages/frontend/src/styles.css`, agregar lo siguiente inmediatamente despues del bloque `.result-card` (lineas 391-394):

```css
.welcome-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding-top: 0;
}

.spinner {
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  margin-right: 0.4em;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  vertical-align: -0.15em;
  animation: spinner-spin 0.7s linear infinite;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}
```

(`.welcome-card` pone `padding-top: 0` para anular el `padding-top: 4rem` que heredaria de `.result-card` si ambas clases coexistieran alguna vez - en este plan no coexisten en el mismo elemento, pero se deja explicito para que el centrado vertical por flexbox no compita con ese padding.)

- [ ] **Step 3: Usar `.welcome-card` en vez de `.result-card` en la bienvenida**

En `packages/frontend/src/App.tsx`, buscar el bloque `if (showWelcome) { ... }` (agregado en la feature anterior, cerca de la linea 489) y cambiar la clase del `card__inner` de `result-card` a `welcome-card`:

```tsx
  if (showWelcome) {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner welcome-card">
          <h1>¡Hola! Bienvenido a Cero Contacto</h1>
          <p>Programa la instalación de tu equipo en 4 pasos rápidos.</p>
          <button type="button" className="btn-primary" onClick={() => setShowWelcome(false)}>
            Comenzar
          </button>
        </div>
        </div>
      </main>
    );
  }
```

No tocar el bloque `if (phase === "done" && result) { ... }` que viene justo despues - ese sigue usando `result-card` sin cambios.

- [ ] **Step 4: Importar y usar `Spinner` en los 4 lugares con texto de carga**

En `packages/frontend/src/App.tsx`, agregar el import (junto a los demas imports locales, despues de `import { FechaDisponibleCalendar } from "./FechaDisponibleCalendar.js";`):

```tsx
import { Spinner } from "./Spinner.js";
```

Reemplazar la linea 591 (`{customerLookupStatus === "loading" && <p className="hint">Buscando...</p>}`) por:

```tsx
              {customerLookupStatus === "loading" && <p className="hint"><Spinner />Buscando...</p>}
```

Reemplazar la linea 790 (`<li className="autocomplete-loading">Buscando...</li>`, dentro del buscador de codigo postal) por:

```tsx
                            <li className="autocomplete-loading"><Spinner />Buscando...</li>
```

En `packages/frontend/src/ProductoPicker.tsx`, agregar el import:

```tsx
import { Spinner } from "./Spinner.js";
```

Y reemplazar la linea 157 (`<li className="autocomplete-loading">Buscando...</li>`) por:

```tsx
              {loading ? (
                <li className="autocomplete-loading"><Spinner />Buscando...</li>
```

(Ojo: solo cambia el contenido del `<li>` de esa rama `loading ?`, no toca las demas ramas del mismo ternario.)

En `packages/frontend/src/FechaDisponibleCalendar.tsx`, agregar el import:

```tsx
import { Spinner } from "./Spinner.js";
```

Y reemplazar la linea 118 (`return <p className="hint">Buscando fechas disponibles...</p>;`) por:

```tsx
    return <p className="hint"><Spinner />Buscando fechas disponibles...</p>;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 6: Verificacion manual en el navegador**

Con el servidor de desarrollo corriendo:
- La bienvenida ya no debe verse con tanto espacio vacio - el saludo, la linea, y el boton deben estar centrados verticalmente en el panel.
- Escribir un DNI valido y ver el spinner junto a "Buscando..." mientras busca el cliente.
- En el paso de direccion, escribir en el buscador de codigo postal y ver el spinner junto a "Buscando...".
- En el paso de equipos, escribir en el buscador de modelo y ver el spinner junto a "Buscando...".
- En el paso de fecha, ver el spinner junto a "Buscando fechas disponibles..." mientras carga el calendario.
- La pantalla de exito (enviar una solicitud de prueba) debe verse exactamente igual que antes (sigue usando `.result-card`, no `.welcome-card`).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/Spinner.tsx packages/frontend/src/styles.css packages/frontend/src/App.tsx packages/frontend/src/ProductoPicker.tsx packages/frontend/src/FechaDisponibleCalendar.tsx
git commit -m "Agregar spinner a estados de carga y centrar la pantalla de bienvenida"
```

---

### Task 2: Verificacion y pulido responsive (movil)

**Files:**
- Modify: `packages/frontend/src/styles.css` (solo si se encuentran problemas reales)

**Interfaces:**
- No produce ni consume ninguna interfaz nueva.

Este task es una AUDITORIA manual, no una lista de cambios predefinidos - el responsive de fondo ya existe (`.page` se apila en `@media (max-width: 850px)`, `.card__inner` tiene padding fluido). El trabajo es encontrar y corregir lo que realmente este roto, no rediseñar nada.

- [ ] **Step 1: Recorrer todo el flujo en viewport movil (375x812, iPhone SE/estandar chico)**

Con el servidor de desarrollo corriendo y el viewport del navegador en 375x812:
- Pantalla de bienvenida (Task 1): el texto y el boton deben verse completos, sin cortarse ni desbordar horizontalmente.
- Paso 1 (Datos personales): todos los campos y el selector de tienda deben ser usables sin scroll horizontal.
- Paso 2 (Direccion): los `field-row` de dos columnas (Provincia/Distrito, Numero/Codigo postal) - confirmar que no se compriman de forma ilegible; el dropdown del buscador de codigo postal no debe desbordar la pantalla.
- Paso 3 (Equipos): el selector de fotos y la grilla de miniaturas (`.foto-grid`) no deben desbordar.
- Paso 4 (Fecha): la grilla del calendario (7 columnas) debe verse completa sin scroll horizontal.
- Pantalla de exito: texto centrado, sin desbordes.

- [ ] **Step 2: Corregir cualquier problema real encontrado**

Si algo se desborda, se corta, o obliga a hacer scroll horizontal, corregirlo en `styles.css` con el minimo cambio necesario (ej. un `@media (max-width: ...)` puntual, ajustar un `grid-template-columns`, etc.) - no rediseñar bloques que ya funcionan bien.

Si NO se encuentra ningun problema real, no hacer ningun cambio de codigo - documentar en el reporte que se verifico y esta correcto tal como esta.

- [ ] **Step 3: Typecheck (solo si hubo cambios)**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 4: Commit (solo si hubo cambios)**

```bash
git add packages/frontend/src/styles.css
git commit -m "Corregir detalles de responsive en movil"
```

Si no hubo cambios, no hacer commit - reportar como DONE sin cambios de codigo.

---

### Task 3: Barra de progreso en el stepper + linea adicional en la pantalla de exito

**Files:**
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/styles.css`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva - usa el `current`/`step` que `StepHeader` ya recibe.

- [ ] **Step 1: Agregar la barra de progreso dentro de `StepHeader`**

En `packages/frontend/src/App.tsx`, reemplazar la funcion `StepHeader` completa (lineas 162-175) por:

```tsx
function StepHeader({ current, onSelect }: { current: number; onSelect: (step: number) => void }) {
  return (
    <>
      <ol className="steps">
        {STEPS.map((s) => (
          <li key={s.n} className={`steps__item ${s.n === current ? "is-current" : ""} ${s.n < current ? "is-done" : ""}`}>
            <button type="button" className="steps__button" onClick={() => onSelect(s.n)}>
              <span className="steps__circle">{s.n}</span>
              <span className="steps__label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="steps__progress">
        <div className="steps__progress-fill" style={{ width: `${(current / STEPS.length) * 100}%` }} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Agregar el CSS de la barra de progreso**

En `packages/frontend/src/styles.css`, cambiar el margen inferior de `.steps` (linea 118-123) de `2rem` a `0.75rem`:

```css
.steps {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
}
```

Y agregar, inmediatamente despues del bloque `.steps__item.is-done .steps__circle` (lineas 189-192):

```css
.steps__progress {
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin: 0 0 2rem;
  overflow: hidden;
}

.steps__progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}
```

- [ ] **Step 3: Agregar la linea de "que sigue" en la pantalla de exito**

En `packages/frontend/src/App.tsx`, dentro del bloque `if (phase === "done" && result)`, en la rama `result.status === "Completed"` (cerca de la linea 531), agregar una linea despues de la existente `<p className="muted">Nos pondremos en contacto contigo para confirmar la fecha de instalación.</p>`:

```tsx
              <p className="muted">Nos pondremos en contacto contigo para confirmar la fecha de instalación.</p>
              <p className="muted">Un asesor te contactará por WhatsApp o email en las próximas horas para confirmar la fecha y el técnico asignado.</p>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 5: Verificacion manual en el navegador**

- La barra de progreso debe verse debajo de los circulos numerados, llenandose 25% en el paso 1, 50% en el paso 2, 75% en el paso 3, 100% en el paso 4.
- Enviar una solicitud de prueba y confirmar que la pantalla de exito muestra las dos lineas de texto (la original + la nueva).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/src/styles.css
git commit -m "Agregar barra de progreso al stepper y linea de seguimiento a la pantalla de exito"
```

---

### Task 4: Guardar progreso en localStorage + validacion onBlur

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva - es interno a `App.tsx`.

- [ ] **Step 1: Agregar la clave, el tipo, y las funciones de carga/guardado de `localStorage`**

En `packages/frontend/src/App.tsx`, agregar lo siguiente inmediatamente despues de la definicion de `initialState` (despues del cierre `};` de ese objeto, antes de `function buildSubmission`):

```tsx
const FORM_PROGRESS_KEY = "cerocontacto:form-progress";
const FORM_PROGRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredProgress {
  savedAt: number;
  form: FormState;
}

/**
 * Lee el progreso guardado en localStorage, si existe, no tiene mas de
 * 24h, y tiene la forma esperada. Cualquier fallo (JSON invalido,
 * localStorage deshabilitado, forma inesperada) se descarta en
 * silencio y se usa initialState - un dato corrupto o viejo nunca debe
 * romper la carga del formulario.
 */
function loadStoredProgress(): FormState {
  try {
    const raw = localStorage.getItem(FORM_PROGRESS_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<StoredProgress>;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > FORM_PROGRESS_MAX_AGE_MS) {
      return initialState;
    }
    if (!parsed.form || typeof parsed.form !== "object") return initialState;
    const productos = Array.isArray(parsed.form.productos) && parsed.form.productos.length > 0
      ? parsed.form.productos
      : initialState.productos;
    return { ...initialState, ...parsed.form, productos };
  } catch {
    return initialState;
  }
}

function saveProgress(form: FormState): void {
  try {
    const toStore: StoredProgress = {
      savedAt: Date.now(),
      form: { ...form, productos: form.productos.map((p) => ({ ...p, fotos: [] })) },
    };
    localStorage.setItem(FORM_PROGRESS_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage puede fallar (modo incognito, cuota excedida) - no bloquea el uso del formulario.
  }
}

function clearStoredProgress(): void {
  try {
    localStorage.removeItem(FORM_PROGRESS_KEY);
  } catch {
    // no-op
  }
}
```

- [ ] **Step 2: Usar `loadStoredProgress` como inicializador perezoso de `form`, y guardar en cada cambio**

En `packages/frontend/src/App.tsx`, dentro de `export default function App()`, cambiar:

```tsx
  const [form, setForm] = useState<FormState>(initialState);
```

por:

```tsx
  const [form, setForm] = useState<FormState>(loadStoredProgress);
```

Y agregar, junto a los demas `useEffect` ya existentes en el componente (por ejemplo, despues del `useEffect` que sincroniza `numeroDocumentoRef`):

```tsx
  useEffect(() => {
    saveProgress(form);
  }, [form]);
```

- [ ] **Step 3: Borrar el progreso guardado al enviar exitosamente**

En `packages/frontend/src/App.tsx`, dentro de `handleSubmit`, en el bloque `try` donde se llama a `submitServiceRequest` (cerca de la linea 480), agregar la limpieza justo despues de `setResult(res);`:

```tsx
      const res = await submitServiceRequest(submission);
      setResult(res);
      clearStoredProgress();
      setPhase("done");
```

- [ ] **Step 4: Agregar validacion `onBlur` para telefono, email, y numeroDocumento**

En `packages/frontend/src/App.tsx`, agregar estas dos funciones auxiliares junto a `clearAutofilledFields` (antes o despues, en el mismo nivel dentro de `App`):

```tsx
  function validateOnBlur(key: string, value: string, isValid: (v: string) => boolean, message: string) {
    const trimmed = value.trim();
    if (!trimmed || isValid(trimmed)) return;
    setFieldErrors((prev) => ({ ...prev, [key]: message }));
  }

  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
```

Agregar estas dos constantes de formato junto a `DOCUMENT_VALIDATORS` (mismo nivel, antes o despues):

```tsx
  // Mismo patron que PHONE_REGEX en shared/schemas/serviceRequestDto.ts -
  // duplicado a proposito (validacion temprana en el frontend, no
  // autoritativa) para no depender de un export interno de shared solo
  // para esto. La validacion final sigue siendo el schema Zod al enviar.
  const PHONE_FORMAT_REGEX = /^\+?\d{7,15}$/;
  const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

Modificar `handleDocumentoBlur` (cerca de la linea 226) agregando la validacion de formato al principio, antes del `if` que ya existe:

```tsx
  async function handleDocumentoBlur() {
    const numeroDocumento = form.numeroDocumento.trim();
    const tipoLabel = form.tipoDocumento === "RUC" ? "RUC" : form.tipoDocumento === "CE" ? "Carné de extranjería" : "DNI";
    validateOnBlur("numeroDocumento", numeroDocumento, DOCUMENT_VALIDATORS[form.tipoDocumento], `${tipoLabel} inválido`);
    if (!DOCUMENT_VALIDATORS[form.tipoDocumento](numeroDocumento)) return;
```

(El resto del cuerpo de `handleDocumentoBlur`, desde ese `if` en adelante, no cambia.)

Modificar `handleDocumentoChange` (cerca de la linea 286) agregando la limpieza del error al final:

```tsx
  function handleDocumentoChange(value: string) {
    if (lookedUpDocumento !== null && value !== lookedUpDocumento) {
      clearAutofilledFields();
      setLookedUpDocumento(null);
      setCustomerLookupStatus("idle");
    }
    update("numeroDocumento", value);
    clearFieldError("numeroDocumento");
  }
```

Modificar el `<input id="telefono">` (cerca de la linea 630-638) para agregar `onBlur` y limpiar el error en `onChange`:

```tsx
                <input
                  id="telefono"
                  type="text"
                  placeholder="+51 9XXXXXXXX"
                  value={form.telefono}
                  onChange={(e) => {
                    update("telefono", e.target.value);
                    clearFieldError("telefono");
                  }}
                  onBlur={() => validateOnBlur("telefono", form.telefono, (v) => PHONE_FORMAT_REGEX.test(v), "Teléfono inválido")}
                />
```

Modificar el `<input id="email">` (cerca de la linea 655) de la misma forma:

```tsx
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => {
                  update("email", e.target.value);
                  clearFieldError("email");
                }}
                onBlur={() => validateOnBlur("email", form.email, (v) => EMAIL_FORMAT_REGEX.test(v), "Email inválido")}
              />
```

No modificar `telefono2` (opcional, fuera de alcance de este task).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 6: Verificacion manual en el navegador**

- Llenar algunos campos del paso 1, recargar la pagina (F5) SIN enviar, y confirmar que el formulario vuelve a mostrar esos mismos datos (despues de pasar la bienvenida).
- Escribir un telefono invalido (ej. "abc") y salir del campo (Tab o clic afuera) - debe aparecer "Teléfono inválido" debajo del campo.
- Volver a escribir en el campo de telefono - el error debe desaparecer inmediatamente (sin esperar a salir del campo de nuevo).
- Repetir lo mismo para email (ej. "no-es-un-email") y para numero de documento (ej. un DNI de menos de 8 digitos).
- Enviar una solicitud de prueba completa y exitosa - despues de ver la pantalla de exito, recargar la pagina (F5) y confirmar que el formulario aparece VACIO (no con los datos ya enviados) - esto prueba que `clearStoredProgress()` se ejecuto.
- (Opcional, si es facil de simular) Verificar en las DevTools -> Application -> Local Storage que la clave `cerocontacto:form-progress` desaparece justo despues de un envio exitoso.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Guardar progreso del formulario en localStorage y validar telefono/email/documento en blur"
```

---

### Task 5: Accesibilidad (ARIA + teclado) en los buscadores de producto y codigo postal

**Files:**
- Modify: `packages/frontend/src/ProductoPicker.tsx`
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva - mismo patron aplicado de forma independiente en ambos archivos (no se extrae un hook compartido, ver Fuera de Alcance en la spec).

- [ ] **Step 1: Agregar roles ARIA y navegacion por teclado en `ProductoPicker.tsx`**

En `packages/frontend/src/ProductoPicker.tsx`, agregar un estado para el indice resaltado, justo despues de `const [searchError, setSearchError] = useState<string | null>(null);`:

```tsx
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
```

Reiniciar ese indice cada vez que cambian los resultados - en `handleQueryChange`, agregar `setHighlightedIndex(-1);` en cada rama que llama a `setResults(...)` (tanto en el corte temprano por longitud como en el `.then`/`.catch` del debounce). El cuerpo completo de `handleQueryChange` queda:

```tsx
  function handleQueryChange(value: string) {
    setQuery(value);
    if (productId) onProductoChange("", "");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!categoria || value.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setSearchError(null);
      setOpen(true);
      searchProducts(categoria, value)
        .then((items) => {
          setResults(items);
          setOpen(true);
          setHighlightedIndex(-1);
        })
        .catch((err: unknown) => {
          setSearchError(err instanceof ApiError ? err.message : "No pudimos buscar productos. Intenta de nuevo.");
          setResults([]);
          setOpen(true);
          setHighlightedIndex(-1);
        })
        .finally(() => setLoading(false));
    }, 300);
  }
```

Agregar un manejador de teclado, junto a `selectItem`:

```tsx
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < results.length) {
        e.preventDefault();
        selectItem(results[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }
```

Agregar el import de `type React` al principio del archivo (linea 1):

```tsx
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
```

Y usar `KeyboardEvent<HTMLInputElement>` en vez de `React.KeyboardEvent<HTMLInputElement>` en la firma de `handleInputKeyDown` (ya que no hay un import de `React` como namespace en este archivo):

```tsx
  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
```

Modificar el `<input>` del buscador de modelo (cerca de la linea 138-148) para agregar los atributos ARIA y el manejador de teclado:

```tsx
          <input
            id={`${idPrefix}-modelo`}
            type="text"
            autoComplete="off"
            placeholder={categoria ? "Escribe el nombre del modelo..." : "Primero selecciona el tipo de equipo"}
            disabled={!categoria}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={handleInputKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${idPrefix}-modelo-listbox`}
            aria-activedescendant={highlightedIndex >= 0 ? `${idPrefix}-modelo-option-${highlightedIndex}` : undefined}
          />
```

Modificar el `<ul>`/`<li>` de resultados (cerca de la linea 154-171) para agregar los roles:

```tsx
          {open ? (
            <ul className="autocomplete-list" id={`${idPrefix}-modelo-listbox`} role="listbox">
              {loading ? (
                <li className="autocomplete-loading"><Spinner />Buscando...</li>
              ) : searchError ? (
                <li className="autocomplete-loading autocomplete-error">{searchError}</li>
              ) : results.length === 0 ? (
                <li className="autocomplete-loading">Sin resultados para "{query}"</li>
              ) : (
                results.map((item, index) => (
                  <li
                    key={item.productId}
                    id={`${idPrefix}-modelo-option-${index}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    className={index === highlightedIndex ? "is-highlighted" : undefined}
                  >
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectItem(item)}>
                      {item.nombre}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
```

- [ ] **Step 2: Agregar el CSS de `.is-highlighted`**

En `packages/frontend/src/styles.css`, buscar el bloque de estilos de `.autocomplete-list`/`.autocomplete-loading` (buscar con `grep -n "autocomplete-list\|autocomplete-loading" packages/frontend/src/styles.css` si no es visible de inmediato) y agregar, inmediatamente despues de ese bloque:

```css
.autocomplete-list li.is-highlighted,
.autocomplete-list li.is-highlighted button {
  background: var(--bg-sunken);
}
```

- [ ] **Step 3: Aplicar el mismo patron en el buscador de codigo postal (`App.tsx`)**

En `packages/frontend/src/App.tsx`, agregar un estado para el indice resaltado junto a los demas estados `postal*` (cerca de la linea 302-303):

```tsx
  const [postalHighlightedIndex, setPostalHighlightedIndex] = useState(-1);
```

En `handlePostalQueryChange`, reiniciar ese indice en los mismos puntos donde se llama a `setPostalResults(...)` (el corte temprano por longitud, y dentro del `.then`/`.catch` del debounce) - agregar `setPostalHighlightedIndex(-1);` en cada uno de esos 3 lugares.

Agregar un manejador de teclado, junto a `selectPostalMatch`:

```tsx
  function handlePostalInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!postalOpen || postalResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPostalHighlightedIndex((i) => (i + 1) % postalResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPostalHighlightedIndex((i) => (i <= 0 ? postalResults.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (postalHighlightedIndex >= 0 && postalHighlightedIndex < postalResults.length) {
        e.preventDefault();
        selectPostalMatch(postalResults[postalHighlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setPostalOpen(false);
      setPostalHighlightedIndex(-1);
    }
  }
```

Agregar el import de `KeyboardEvent` al principio de `App.tsx` (junto al import existente de React):

```tsx
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
```

Modificar el `<input id="codigoPostal">` (cerca de la linea 771-781) para agregar los atributos ARIA y el manejador de teclado:

```tsx
                      <input
                        id="codigoPostal"
                        type="text"
                        autoComplete="off"
                        placeholder={form.departamento ? "Escribe tu distrito o zona..." : "Primero elige un departamento"}
                        disabled={!form.departamento || (coverageStatus !== "covered" && coverageStatus !== "error")}
                        value={postalQuery}
                        onChange={(e) => handlePostalQueryChange(e.target.value)}
                        onFocus={() => postalResults.length > 0 && setPostalOpen(true)}
                        onBlur={() => setTimeout(() => setPostalOpen(false), 150)}
                        onKeyDown={handlePostalInputKeyDown}
                        role="combobox"
                        aria-expanded={postalOpen}
                        aria-controls="codigoPostal-listbox"
                        aria-activedescendant={postalHighlightedIndex >= 0 ? `codigoPostal-option-${postalHighlightedIndex}` : undefined}
                      />
```

Modificar el `<ul>`/`<li>` de resultados (cerca de la linea 787-816) para agregar los roles:

```tsx
                      {postalOpen ? (
                        <ul className="autocomplete-list" id="codigoPostal-listbox" role="listbox">
                          {postalLoading ? (
                            <li className="autocomplete-loading"><Spinner />Buscando...</li>
                          ) : postalSearchError ? (
                            <li className="autocomplete-loading autocomplete-error">{postalSearchError}</li>
                          ) : postalResults.length === 0 ? (
                            <li className="autocomplete-loading">Sin resultados para "{postalQuery}", intenta con otro nombre</li>
                          ) : (
                            <>
                              {postalResults.map((item, index) => (
                                <li
                                  key={`${item.distrito}-${item.codigoPostal}`}
                                  id={`codigoPostal-option-${index}`}
                                  role="option"
                                  aria-selected={index === postalHighlightedIndex}
                                  className={index === postalHighlightedIndex ? "is-highlighted" : undefined}
                                >
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => selectPostalMatch(item)}
                                  >
                                    {item.distrito} — {item.codigoPostal}
                                  </button>
                                </li>
                              ))}
                              {postalHasMore ? (
                                <li className="autocomplete-loading">
                                  Hay más resultados — sigue escribiendo para acotar la búsqueda.
                                </li>
                              ) : null}
                            </>
                          )}
                        </ul>
                      ) : null}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 5: Verificacion manual en el navegador**

- En el buscador de producto: escribir 2+ letras, usar flecha abajo/arriba para recorrer resultados (debe verse un resaltado visual), Enter para seleccionar el resaltado, Escape para cerrar el dropdown sin seleccionar.
- Repetir lo mismo en el buscador de codigo postal.
- Confirmar con las DevTools (inspeccionar elemento) que el `<input>` tiene `role="combobox"` y `aria-expanded` cambia a `true`/`false` segun el dropdown este abierto o cerrado, en ambos buscadores.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/ProductoPicker.tsx packages/frontend/src/App.tsx packages/frontend/src/styles.css
git commit -m "Agregar roles ARIA y navegacion por teclado a los buscadores de producto y codigo postal"
```
