# Observaciones de usuario sobre el formulario - Design

## Contexto

Los usuarios que pidieron la creacion de este proyecto enviaron un
documento (`Revision formulario Auto.docx`) con 6 observaciones + 1 nota
general sobre el formulario en produccion. De esas 6, 2 quedaron
bloqueadas por falta de datos de negocio y se descartan de este spec:

- **Lista ampliada de "Tipo de equipo"**: el documento pide agregar 9
  categorias nuevas (Hornos de empotrar y microondas, Purificadores/
  Filtros, Vineras, Aire acondicionado portatil/split, Cocinas
  sobreponer electrica/gas, Refrigeracion, Lavavajillas,
  Calientaplatos) que no existen hoy en `PRODUCT_CATEGORIES`. Cada
  categoria necesita su `ProductCategoryID` real de SAP C4C - inventar
  un codigo haria que la busqueda de modelos para esas categorias
  siempre devuelva vacio. Pendiente de que el usuario consiga esos
  codigos con quien administra el catalogo en C4C.
- **Codigo postal automatico al elegir el Distrito**: en Peru un
  distrito no tiene un unico codigo postal (puede tener decenas segun
  zona/urbanizacion) - por eso ya existe un buscador con lista de
  resultados en vez de un autocompletado 1:1. Pendiente de confirmar
  con el usuario si lo que piden es reforzar el autocompletado existente
  o si hay un malentendido sobre el formato de codigo postal peruano.

Este spec cubre los 5 puntos restantes, confirmados como implementables
sin dependencias externas.

## Alcance

**1. Validacion de Documento y Telefono (bloqueo duro + gating de "Siguiente")**

- Los campos de Numero de documento (cuando el tipo es DNI o RUC) y
  Telefono/Telefono2 pasan a aceptar solo digitos mientras se escribe,
  con un tope duro de longitud: DNI=8, RUC=11, telefono=9 (formato
  celular peruano real, sin `+51` - confirmado con el usuario que el
  "8 digitos" del documento original era un error, el celular peruano
  tiene 9). El campo nunca permite llegar a un estado invalido por
  longitud o por caracter no numerico.
- Para CE (Carne de Extranjeria, alfanumerico) no se aplica el filtro de
  solo-numeros - se agrega `maxLength=12` para respetar el limite
  superior ya validado en `isValidCe`.
- El boton "Siguiente" del Paso 1 se deshabilita mientras `fieldErrors`
  tenga una entrada para `numeroDocumento`, `telefono` o `email`. No se
  agregan checks de "campo obligatorio vacio" (confirmado con el
  usuario, fuera de alcance - el documento solo pidio bloquear por
  formato invalido, no por campos vacios).

**2. Mensaje "Estamos validando..." en rojo**

- El texto "Buscando..." que se muestra mientras se busca un cliente por
  documento cambia a "Estamos validando el numero de documento." y se
  muestra en rojo.

**3. Busqueda de modelo por codigo o descripcion + mensaje bajo "Tus equipos"**

- La busqueda de productos hoy solo filtra por coincidencia parcial de
  `Description`. Se agrega el mismo tipo de coincidencia parcial sobre
  `ProductID`, con un OR entre ambos criterios - buscar "078" debe
  encontrar tanto un producto cuyo codigo contiene "078" como uno cuya
  descripcion lo contiene.
- El texto de ayuda bajo "Tus equipos" cambia al texto exacto pedido por
  el usuario: "Agrega cada producto que deseas instalar. Si compraste
  varios productos, registralos uno por uno."

**4. Requisitos de instalacion en Paso 4**

- Se agrega una lista estatica (titulo + 7 items numerados, texto
  verbatim del documento) antes del calendario de fechas en el Paso 4,
  siempre visible (no colapsable).

## Decisiones (confirmadas con el usuario)

1. **Telefono: 9 digitos, sin `+51`** - el "8 digitos" del documento
   original no coincide con el formato real de celulares peruanos; se
   usa 9 (el formato que el propio formulario ya sugiere en su
   placeholder).
2. **Bloqueo duro, no solo aviso** - los campos de documento y telefono
   no dejan escribir un caracter invalido o de mas, en vez de dejar
   escribir cualquier cosa y avisar recien al salir del campo.
3. **"Siguiente" se deshabilita, no se deja clickear sin avanzar** - UX
   mas clara que un boton que no hace nada al presionarlo.
4. **El gating de "Siguiente" solo cubre formato invalido, no campos
   vacios** - alcance minimo, tal como lo pidio el documento original;
   agregar validacion de "obligatorio" es un cambio mas grande que no
   se pidio explicitamente.
5. **Requisitos de instalacion siempre visibles, no colapsables** -
   igual de simple que en la imagen de referencia del documento.

## Arquitectura

### Punto 1 - Validacion Documento/Telefono

- `packages/frontend/src/App.tsx`:
  - Nueva funcion `sanitizeDigits(value: string, maxLen: number): string`
    que remueve todo caracter no-digito y trunca a `maxLen`. Se usa en el
    `onChange` de `numeroDocumento` (solo si `tipoDocumento !== "CE"`),
    `telefono` y `telefono2`, con el maximo segun el campo/tipo
    (DNI=8, RUC=11, telefono=9).
  - El `<input>` de `numeroDocumento` agrega `maxLength={12}` cuando
    `tipoDocumento === "CE"` (unico caso donde no se filtra a solo
    digitos).
  - `PHONE_FORMAT_REGEX` (validacion de formato en `onBlur`) cambia de
    `/^\+?\d{7,15}$/` a `/^\d{9}$/`.
  - El `placeholder` de ambos campos de telefono cambia de
    `"+51 9XXXXXXXX"` a `"9XXXXXXXX"` - el campo ya no acepta el
    caracter `+`, dejar el placeholder viejo mostraria un formato que el
    propio campo rechaza.
  - Los 3 botones "Siguiente" (uno por paso, `App.tsx:847`, `:1034`,
    `:1093`) - solo el del Paso 1 (`:847`) agrega `disabled={Boolean(
    fieldErrors.numeroDocumento || fieldErrors.telefono ||
    fieldErrors.email)}`. Los otros pasos no tienen campos con
    validacion de formato onBlur hoy, asi que no cambian.
- `packages/shared/src/schemas/serviceRequestDto.ts`: `PHONE_REGEX`
  cambia de `/^\+?\d{7,15}$/` a `/^\d{9}$/` para que el backend acepte
  exactamente el mismo formato que ahora produce el frontend - si no se
  actualiza en paralelo, un telefono valido segun el frontend nuevo
  seria rechazado por el schema Zod del backend al enviar.

### Punto 2 - Mensaje en rojo

- `packages/frontend/src/App.tsx:751`: cambiar el texto a "Estamos
  validando el numero de documento."
- `packages/frontend/src/styles.css`: nueva clase `.hint-validating`
  (mismo tamaño de fuente que `.hint`, `color` rojo) aplicada solo a
  este `<p>` especifico - no se toca `.hint` en si (los otros 3 usos de
  "Buscando..." con `.hint` simple no cambian de color).

### Punto 3 - Busqueda por codigo + mensaje

- `packages/backend/src/domain/productCatalog/index.ts:48-52`: el
  filtro OData pasa de:
  ```
  ProductCategoryID eq '...' and Status eq '2' and substringof('...',Description)
  ```
  a:
  ```
  ProductCategoryID eq '...' and Status eq '2' and (substringof('...',Description) or substringof('...',ProductID))
  ```
  Mismo texto de busqueda (`trimmed.toUpperCase()`) usado para ambos
  lados del OR - sin normalizacion adicional especifica para codigos.
- `packages/frontend/src/App.tsx` (texto bajo "Tus equipos"): reemplazar
  por el texto exacto acordado.

### Punto 4 - Requisitos de instalacion

- `packages/frontend/src/App.tsx`, dentro del bloque `step === 4`, antes
  de `<FechaDisponibleCalendar>`: nuevo bloque con un titulo ("Para la
  instalacion de tu producto ten en cuenta") y una `<ol>` con los 7
  items verbatim del documento (pared solida de concreto, materiales no
  aptos, presencia del producto en zona de instalacion, area despejada,
  kit de instalacion basico, persona mayor de edad presente, costos
  adicionales posibles).
- `packages/frontend/src/styles.css`: clase nueva `.requisitos-instalacion`
  para el numerado con circulos (mismo tratamiento visual que la imagen
  de referencia - numero en circulo a la izquierda, texto a la derecha),
  sin logica ni estado, solo CSS.

## Manejo de errores

- `sanitizeDigits` es una funcion pura sin fallos posibles (regex +
  slice) - no requiere manejo de errores.
- El cambio de `PHONE_REGEX` en `shared` es compartido por frontend y
  backend - si solo se cambiara en un lado, un telefono de 9 digitos
  (nuevo formato) enviado desde un frontend viejo en cache del navegador
  seguiria siendo aceptado por un backend viejo (no es un problema real
  para este deploy, pero se documenta la dependencia entre ambos
  cambios para no aplicarlos por separado).
- El filtro OData con dos `substringof` no cambia el manejo de errores
  existente de `searchProducts` (sigue devolviendo `[]` si la categoria
  no es valida o el texto tiene menos de 2 caracteres).

## Testing

- **Backend**: nuevo test en `packages/backend/src/domain/productCatalog`
  (si existe archivo de test para este modulo, o se crea uno) que
  confirma que un query numerico que coincide con un `ProductID` (no con
  la `Description`) devuelve resultados - mockeando el cliente OData y
  verificando el filtro generado incluye el OR.
- **Backend**: test en `serviceRequestDto.test.ts` (si existe) o
  agregar un caso confirmando que `PHONE_REGEX` acepta exactamente 9
  digitos y rechaza 8 o 10.
- **Frontend**: el paquete no tiene test runner (confirmado en features
  anteriores) - verificacion manual en navegador: escribir mas de 8/11/9
  digitos y confirmar que el campo no los acepta; provocar un error de
  formato y confirmar que "Siguiente" queda deshabilitado y se reactiva
  al corregir; confirmar el mensaje rojo durante la busqueda de cliente;
  buscar un producto por su codigo exacto o parcial y confirmar que
  aparece en resultados; revisar visualmente el bloque de requisitos en
  el Paso 4.
- Ademas: `npx tsc --noEmit` en `frontend`, `backend` y `shared`, y
  `npx vitest run` en `backend` (suite completa, no solo los tests
  nuevos) antes de dar cada tarea por terminada.

## Fuera de alcance (explicito)

- La lista ampliada de "Tipo de equipo" (9 categorias nuevas) - bloqueada
  por falta de `ProductCategoryID` reales de C4C.
- Codigo postal automatico 1:1 por Distrito - bloqueado por
  incompatibilidad con el formato real de codigos postales peruanos,
  pendiente de aclarar con el usuario.
- Validacion de "campo obligatorio vacio" para bloquear "Siguiente" -
  el documento solo pidio bloquear por formato invalido.
- Cambios al Paso 2 (Direccion) o Paso 3 (Equipos) mas alla del mensaje
  bajo "Tus equipos" y la busqueda por codigo.
