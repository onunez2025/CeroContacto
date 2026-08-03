# Mejoras de UX/UI del frontend - Design

## Contexto

Tras agregar la pantalla de bienvenida, el usuario pidio una lista de
mejoras de UX/UI para el resto del formulario y luego confirmo avanzar
con un grupo de ellas, agrupadas para ejecutarse rapido con agentes
secuenciales (no en paralelo, porque casi todas tocan `App.tsx` y/o
`styles.css` y correrlas en paralelo arriesgaria conflictos de git).

Se descarto correr esto con git worktrees paralelos: la mayoria de los
items no son archivo-disjuntos entre si, asi que el ahorro de tiempo
real habria sido chico frente al riesgo de conflictos al fusionar.

## Alcance

4 grupos, en este orden de ejecucion (cada uno es 1-2 tareas del plan):

**Grupo A - Pulido visual**
1. Bienvenida menos vacia (clase nueva, no reusar `.result-card`).
2. Spinner + texto en los 4 lugares que hoy solo muestran texto plano de
   carga (`App.tsx:591` lookup de cliente, `App.tsx:790` buscador de
   codigo postal, `ProductoPicker.tsx:157` buscador de producto,
   `FechaDisponibleCalendar.tsx:118` calendario de fechas).
3. Verificacion manual en viewport movil (375px) de bienvenida + 4 pasos
   + pantalla de exito - el responsive de fondo (`styles.css:32-95`) ya
   existe (breakpoints en 850px y 500px, padding fluido con `clamp()`);
   esto es pulir detalles que aparezcan, no construir desde cero.

**Grupo B - Progreso y confianza**
4. Barra de progreso visual bajo el `StepHeader` existente (circulos
   numerados 1-4), que se llena 25/50/75/100% segun `step` actual.
5. Pantalla de exito (`App.tsx:488-535`): agregar una linea explicando
   que sigue despues de enviar la solicitud.

**Grupo C - Datos y validacion**
6. Guardar el progreso del formulario en `localStorage` mientras se
   llena, para no perderlo si se recarga la pagina por error.
7. Validar telefono/email/documento en `onBlur` (al salir del campo),
   no en cada tecla.

**Grupo D - Accesibilidad**
8. Roles ARIA (`combobox`/`listbox`/`option`) y navegacion por teclado
   (flechas, Enter, Escape) en los 2 buscadores tipo autocomplete
   (producto en `ProductoPicker.tsx`, codigo postal en `App.tsx`). El
   dropdown nativo de distrito ya es accesible por defecto (es un
   `<select>` real).

## Decisiones (confirmadas con el usuario)

1. **Alcance del guardado en `localStorage` (Grupo C, item 6)**: se
   guardan TODOS los campos de texto del formulario (incluido
   documento/telefono/direccion) - NO se guardan las fotos de producto
   (pesan mucho en base64, se tendrian que volver a subir si se pierde
   el progreso). El guardado se borra automaticamente: (a) al enviar la
   solicitud exitosamente, o (b) si el guardado tiene mas de 24 horas
   (se ignora y se descarta al cargar la pagina, evita que datos viejos
   de una visita anterior reaparezcan sin que el usuario lo espere).
2. **Momento de validacion (Grupo C, item 7)**: `onBlur`, no por cada
   tecla - evita marcar un campo como invalido mientras el usuario
   todavia esta escribiendo.
3. **Orden de ejecucion**: A -> B -> C -> D. Los primeros 3 grupos son
   independientes entre si en terminos de riesgo (A y B son bajo riesgo/
   visual, C toca logica de datos real, D es un patron nuevo puntual).
   D se deja al final porque toca un patron de accesibilidad que no
   existe todavia en el proyecto (el resto de componentes reutiliza
   convenciones ya establecidas).

## Arquitectura

### Grupo A

- **Bienvenida** (`App.tsx`, el bloque `if (showWelcome)` agregado en la
  feature anterior): nueva clase CSS `.welcome-card` en `styles.css`
  (basada en `.card__inner` pero con `display: flex; flex-direction:
  column; justify-content: center; min-height: ...` en vez del
  `padding-top: 4rem` fijo de `.result-card`) para centrar el contenido
  verticalmente sin dejar tanto espacio vacio. `.result-card` (pantalla
  de exito) NO se toca - sigue con su propio estilo, para no arriesgar
  una regresion ahi.
- **Spinner**: nuevo componente `packages/frontend/src/Spinner.tsx`,
  un `<span>` con una clase CSS que dibuja un circulo girando (animacion
  `@keyframes` pura, sin dependencias nuevas). Se usa en los 4 lugares
  listados arriba, junto al texto que ya existe (ej. `<Spinner />
  Buscando...` en vez de solo `Buscando...`).
- **Responsive**: sin cambios de arquitectura - es una pasada de
  verificacion manual (Task de este grupo) usando el resize de viewport
  del navegador, documentando y corrigiendo lo que se encuentre.

### Grupo B

- **Barra de progreso**: se agrega dentro de `StepHeader` (o como
  hermano directo, debajo de el) un `<div className="steps__progress">`
  con una barra de fondo fijo y una barra interior cuyo `width` se
  calcula como `${(current / STEPS.length) * 100}%` - reutiliza el
  `current` que `StepHeader` ya recibe como prop, sin estado nuevo.
- **Pantalla de exito**: agregar un `<p>` adicional despues de la linea
  existente ("Nos pondremos en contacto contigo para confirmar la fecha
  de instalacion.") con el texto acordado sobre que sigue (mismo tono,
  una sola linea mas - no se rediseña toda la pantalla).

### Grupo C

- **`localStorage` (progreso del formulario)**:
  - Clave fija, ej. `"cerocontacto:form-progress"`.
  - Al montar `App`, ANTES de usar `initialState` como valor inicial de
    `form`, se intenta leer y parsear esa clave; si existe, no tiene mas
    de 24h (se guarda un campo `savedAt: number` junto a los datos), y
    tiene la forma esperada (validacion basica, no un parse ciego), se
    usa como estado inicial en vez de `initialState`. Si falla cualquier
    chequeo (JSON invalido, expirado, forma inesperada), se descarta en
    silencio y se usa `initialState` normal - un error de parseo NUNCA
    debe romper la carga del formulario.
  - En cada cambio de `form` (via un `useEffect` con `[form]` como
    dependencia), se escribe `{ ...form, savedAt: Date.now() }` a esa
    clave - excluyendo el array `productos[].fotos` de cada producto
    (se guarda el resto de cada producto, pero `fotos: []` al persistir,
    para no guardar los data URLs pesados).
  - Al enviar exitosamente (`phase` pasa a `"done"` con
    `result.status === "Completed"`), se borra la clave
    (`localStorage.removeItem(...)`).
  - La pantalla de bienvenida (`showWelcome`) NO se ve afectada por
    esto - sigue mostrandose siempre al cargar, independientemente de si
    hay un progreso guardado. Si el usuario hace clic en "Comenzar" y
    hay un progreso guardado valido, lo va a ver ya cargado en el
    formulario.
- **Validacion en `onBlur`**: los campos de telefono, email y numero de
  documento agregan un manejador `onBlur` que corre el mismo validador
  que ya se usa en la validacion final (`DOCUMENT_VALIDATORS`,
  regex/formato de telefono y email ya existentes en el proyecto) y
  escribe en `fieldErrors` si el valor no esta vacio y no pasa el
  validador. El error se limpia (`delete fieldErrors[campo]`) tan pronto
  el usuario vuelve a escribir en el campo (ya existe un patron similar
  para limpiar errores al editar, se sigue el mismo).

### Grupo D

- **Roles ARIA + teclado**: en `ProductoPicker.tsx` y en el bloque del
  buscador de codigo postal en `App.tsx`, el `<input>` de busqueda pasa
  a tener `role="combobox"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant` (apuntando al `id` de la opcion resaltada por
  teclado); el `<ul>` de resultados pasa a `role="listbox"`; cada `<li>`
  resultado pasa a `role="option"` con un `id` unico. Se agrega manejo
  de `ArrowDown`/`ArrowUp` (mover el indice resaltado), `Enter`
  (seleccionar el resaltado) y `Escape` (cerrar el dropdown) en el
  `onKeyDown` del input. Mismo patron aplicado en ambos componentes de
  forma independiente (no se extrae un hook compartido en esta pasada -
  ver "Fuera de alcance").

## Manejo de errores

- `localStorage` puede fallar (modo incognito con storage deshabilitado,
  cuota excedida): toda lectura/escritura se envuelve en `try/catch`,
  silenciosa (no bloquea el uso del formulario si falla - es una mejora
  de conveniencia, no un requisito funcional).
- El parseo de datos guardados nunca debe lanzar una excepcion no
  capturada que rompa el render inicial de `App` - cualquier dato con
  forma inesperada se descarta.

## Testing

- El paquete `frontend` no tiene test runner (confirmado en features
  anteriores) - la verificacion de todos los grupos es manual en el
  navegador (typecheck + revision visual/funcional), igual que el resto
  del frontend de este proyecto.

## Fuera de alcance (explicito)

- Extraer un hook compartido `useAutocomplete` para no duplicar la
  logica de teclado entre `ProductoPicker` y el buscador de codigo
  postal - se implementa el mismo patron dos veces por ahora; extraerlo
  es un refactor futuro si hace falta un tercer buscador.
- Cualquier cambio a `FechaDisponibleCalendar`'s propio manejo de
  teclado (sus dias son botones nativos, ya navegables por Tab -
  mejorar eso a un grid de teclado tipo calendario real no se pidio).
- Analitica/telemetria de cuantos usuarios recuperan progreso guardado.
