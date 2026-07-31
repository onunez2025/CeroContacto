# Pantalla de bienvenida antes del formulario - Design

## Contexto

El formulario hoy entra directo al paso 1 ("Datos personales") apenas se
carga la pagina - sin ningun saludo o contexto previo. El usuario lo
sintio poco amigable ("eso de mostrar de frente el formulario no lo
siento muy amigable") y pidio una pantalla de bienvenida antes del paso 1,
mas ideas generales para mejorar la experiencia de usuario/frontend.

## Alcance

Solo la pantalla de bienvenida. Las otras ideas mencionadas en la
conversacion (guardar progreso del formulario en el navegador, navegacion
por teclado en los buscadores, barra de progreso mas visual) quedan
fuera de alcance - se ofrecieron como lista para considerar despues, no
se pidio implementarlas ahora.

## Decisiones (confirmadas con el usuario)

1. **Contenido**: simple - saludo + boton "Comenzar". Sin repetir los
   puntos de confianza del panel lateral (garantia/tecnicos/repuestos,
   ya visibles ahi) ni personalizacion por nombre (eso requeriria pedir
   el documento antes del paso 1, cambiando el orden actual - descartado).
2. **Persistencia**: ninguna. Se muestra una vez por carga de pagina,
   igual que el resto del estado del formulario (que ya se reinicia si
   se recarga). No hay manera de "volver" a la bienvenida una vez que se
   hace clic en Comenzar, salvo recargar la pagina.
3. **No es un paso del stepper**: el stepper (1-4) sigue arrancando en
   "1 Datos personales" - la bienvenida es una pantalla previa,
   completamente fuera de esa numeracion.

## Arquitectura

- **Estado nuevo**: `const [showWelcome, setShowWelcome] = useState(true);`
  en el componente `App` (`packages/frontend/src/App.tsx`), junto a los
  demas `useState` ya declarados ahi (`form`, `fieldErrors`, `phase`, etc.).
- **Render condicional**: se agrega un chequeo `if (showWelcome) { return (...) }`
  ANTES del chequeo existente `if (phase === "done" && result) { ... }`
  (linea 488) - la bienvenida es la primera pantalla posible, antes que
  cualquier otra.
- **Reuso de layout existente**: mismo esqueleto que ya usa la pantalla
  de exito (linea 490): `<main className="page"><HeroPanel /><div className="card"><div className="card__inner result-card"> ... </div></div></main>`.
  Se reutiliza la clase CSS `.result-card` ya existente (`text-align:
  center; padding-top: 4rem;` en `styles.css:391`) - mismo estilo
  centrado, sin necesidad de CSS nuevo.
- **Contenido de la pantalla**:
  ```
  <h1>¡Hola! Bienvenido a Cero Contacto</h1>
  <p>Programa la instalacion de tu equipo en 4 pasos rapidos.</p>
  <button type="button" className="btn-primary" onClick={() => setShowWelcome(false)}>
    Comenzar
  </button>
  ```
- **Sin cambios en ningun otro archivo**: no toca backend, no toca
  `FormState`, no toca la logica de submit ni de steps existente.

## Testing

- El paquete `frontend` no tiene test runner (confirmado en features
  anteriores de este proyecto) - la verificacion es manual en el
  navegador: la bienvenida aparece al cargar, el boton "Comenzar" lleva
  al paso 1 con el formulario intacto (sin ningun campo pre-llenado por
  el cambio), y recargar la pagina vuelve a mostrar la bienvenida.
