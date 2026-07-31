# Pantalla de bienvenida antes del formulario - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar una pantalla de bienvenida simple (saludo + boton "Comenzar") antes del paso 1 del formulario, para que la primera impresion no sea el formulario de frente.

**Architecture:** Un solo estado booleano nuevo (`showWelcome`) en `App.tsx`, con un `return` condicional temprano que reutiliza el mismo esqueleto visual (`HeroPanel` + `.card` + `.result-card`) que ya usa la pantalla de exito al final del flujo. Ningun otro archivo cambia.

**Tech Stack:** React (sin cambios de stack, sin backend).

## Global Constraints

- La pantalla de bienvenida NO es un paso del stepper (1-4) - el stepper sigue arrancando en "1 Datos personales".
- No se persiste entre recargas (se muestra una vez por carga de pagina, igual que el resto del formulario).
- Reutilizar la clase CSS `.result-card` ya existente (`styles.css:391`) - no se agrega CSS nuevo.
- El paquete `frontend` no tiene test runner - la verificacion es manual en el navegador (typecheck + revision visual), no tests automatizados.

---

### Task 1: Agregar la pantalla de bienvenida en App.tsx

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- No produce ni consume ninguna interfaz nueva - es un cambio autocontenido dentro del componente `App`.

- [ ] **Step 1: Agregar el estado `showWelcome`**

En `packages/frontend/src/App.tsx`, dentro de `export default function App()`, agregar una linea nueva justo despues de la declaracion de `form` (linea 186):

```tsx
export default function App() {
  const [form, setForm] = useState<FormState>(initialState);
  const [showWelcome, setShowWelcome] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Agregar el return condicional de la bienvenida**

En el mismo archivo, buscar el bloque que empieza con `if (phase === "done" && result) {` (cerca de la linea 488, justo antes de `return (` en la linea 489). Agregar el siguiente bloque INMEDIATAMENTE ANTES de ese `if`, como la primera verificacion condicional del componente (antes de cualquier otro `return` temprano):

```tsx
  if (showWelcome) {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner result-card">
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

  if (phase === "done" && result) {
```

No modificar nada dentro del bloque `if (phase === "done" && result) { ... }` ni nada despues de el - siguen exactamente igual.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` dentro de `packages/frontend`
Expected: sin errores.

- [ ] **Step 4: Verificacion manual en el navegador**

Iniciar el servidor de desarrollo del frontend (`npm run dev --workspace=@cerocontacto/frontend` o el launch config `frontend-dev`) y confirmar:
- Al cargar la pagina, se ve la pantalla de bienvenida (saludo + boton "Comenzar"), NO el formulario.
- El stepper (1 Datos personales / 2 Dirección / 3 Equipos / 4 Fecha) NO es visible en la pantalla de bienvenida.
- Al hacer clic en "Comenzar", aparece el formulario en el paso 1, con el stepper mostrando "1" como paso actual y todos los campos vacios (sin datos pre-llenados).
- Recargar la pagina (F5) despues de haber hecho clic en "Comenzar" vuelve a mostrar la pantalla de bienvenida.
- El panel lateral (`HeroPanel`: imagen + barra de WhatsApp) se ve igual que en el resto del formulario.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "Agregar pantalla de bienvenida antes del paso 1 del formulario"
```
