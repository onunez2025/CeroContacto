# Autocompletado de datos cuando el cliente ya existe en C4C

## Contexto y problema

Hoy, cada vez que alguien llena el formulario público de CeroContacto, escribe sus datos personales (nombre/razón social, teléfono, email) y su dirección completa desde cero — incluso si esa misma persona/empresa ya está registrada en C4C porque compró un producto antes. El backend ya resuelve esto internamente al momento de crear el ticket (`customerResolution/individual.ts` y `empresa.ts` buscan al cliente por documento y lo reutilizan en vez de duplicarlo), pero esa búsqueda solo ocurre al final del flujo y solo trae los campos mínimos que esas funciones necesitan (`StateCode`/`StreetPostalCode`) — nunca se le muestra nada al cliente antes de que termine de escribir todo de nuevo.

El objetivo: si el cliente ya existe en C4C, autocompletar sus datos personales y dirección apenas escribe su número de documento, para ahorrarle tecleo.

## Decisiones de diseño (confirmadas con el usuario)

1. **Disparo de la búsqueda**: automático al salir del campo "Número de documento" (evento `blur`), no requiere un botón "Buscar" aparte.
2. **Campos autocompletados quedan editables**, no de solo lectura — el cliente puede corregir un teléfono/email desactualizado sin fricción, igual que ya puede hacerlo hoy con la dirección al crear un ticket.
3. **Alcance**: cubre tanto personas naturales (DNI/CE) como empresas (RUC), reutilizando el mismo patrón que ya existe por separado para cada caso en `customerResolution/`.
4. **Campos a autocompletar**: datos personales (nombre o razón social, teléfono, email) **y** dirección completa (departamento/provincia/distrito/dirección/número/piso/referencia/código postal), cuando C4C los tenga registrados.
5. **Privacidad**: el endpoint nuevo revela datos personales a partir de un número de documento, así que lleva **rate-limit por IP** (10 solicitudes/minuto) para frenar scraping automatizado. No se exige CAPTCHA en esta etapa temprana del formulario — el CAPTCHA existente se mantiene solo al envío final.

## Por qué no se reutiliza `resolveIndividual`/`resolveEmpresa` tal cual

Esas funciones, cuando no encuentran al cliente, **lo crean** en C4C — es su trabajo correcto en el contexto de creación de tickets. Dispararlas cada vez que alguien sale del campo de documento (antes de completar o siquiera confirmar el resto del formulario) crearía clientes fantasma en C4C por cada visita abandonada. Se necesita una función nueva, de solo lectura, que nunca escribe nada.

## Backend

### Nueva función de dominio: `customerLookup`

Ubicación: `packages/backend/src/domain/customerLookup/` (carpeta separada de `customerResolution`, para dejar explícito que esta nunca crea nada).

```ts
interface CustomerLookupResult {
  found: boolean;
  datos?: {
    nombres?: string;       // DNI/CE
    apellidos?: string;     // DNI/CE
    razonSocial?: string;   // RUC
    telefono: string;
    email: string;
    direccion: Partial<Address>; // solo los campos que C4C tenga registrados
  };
}

async function lookupCustomer(
  tipoDocumento: "DNI" | "CE" | "RUC",
  numeroDocumento: string,
  client: IC4CODataClient,
): Promise<CustomerLookupResult>
```

Internamente despacha a `lookupIndividual` (DNI/CE) o `lookupEmpresa` (RUC), cada una con el mismo patrón de dos consultas secuenciales que ya usan `individual.ts`/`empresa.ts`:

1. Buscar en `IndividualCustomerTaxNumberCollection` / `CorporateAccountTaxNumberCollection` por documento. Si no hay match → `{ found: false }`.
2. Con el ID encontrado, consultar `IndividualCustomerCollection` / `CorporateAccountCollection` (trae `FirstName`/`LastName`/`Name`, `Phone`, `Mobile`, `Email`, `StateCode`, `StreetPostalCode`) y su sub-colección de dirección (`IndividualCustomerAddress` / `CorporateAccountAddress`, mismos campos custom que ya se usan al crear: `zIDProvinciacontent_SDK`, `zIDDistritocontent_SDK`, `Street`, `HouseNumber`, `Floor`, `AddressLine5`, `zaReferenciaAdicional_KUT`).

Se evaluó consultar todo en una sola llamada con `$expand` en vez de dos secuenciales — se descarta: el proyecto no usa `$expand` en ningún lado hoy, sería sintaxis nueva sin probar contra este C4C específico (que ya nos sorprendió con diferencias entre QA y producción), y el ahorro es de milisegundos en un endpoint que no es parte del flujo crítico de creación de tickets.

Cualquier campo que C4C no tenga registrado se omite de `datos.direccion` (no se envía como cadena vacía) — el frontend simplemente deja ese campo del formulario vacío para que el usuario lo complete.

### Nuevo endpoint

`GET /api/clientes/lookup?tipoDocumento=DNI|CE|RUC&numeroDocumento=...`

- Query params inválidos (documento vacío, tipo no reconocido) → `400`, validado con zod igual que el resto de endpoints.
- Encontrado → `200 { found: true, datos: {...} }`.
- No encontrado → `200 { found: false }` (caso normal, no es un error).
- Errores de C4C (timeout, credenciales) → se propagan como error HTTP genérico, igual que el resto de endpoints existentes.
- Más de 10 solicitudes/minuto de la misma IP → `429`.

### Rate limiting

Middleware propio en memoria (`Map<ip, timestamps[]>`), aplicado solo a esta ruta — no se agrega `express-rate-limit` como dependencia nueva por ser una función pequeña y fácil de auditar. Limitación conocida y aceptada: el conteo es por instancia del proceso, no global — si el backend llegara a correr en más de una instancia a la vez, el límite efectivo se multiplicaría. No es un problema con el despliegue actual en Dokploy (una sola instancia).

## Frontend

En el paso 1 del formulario (documento + nombre), el campo "Número de documento" agrega un handler `onBlur`:

- Se dispara solo si el documento ya tiene el largo válido para su tipo (misma validación que ya existe antes de habilitar avanzar de paso).
- Mientras responde: indicador breve "Buscando..." junto al campo, no bloquea el formulario.
- `found: true`: autocompleta nombre/apellidos (o razón social), teléfono, email y los campos de dirección disponibles — todos quedan editables. Se muestra un texto breve ("Datos encontrados, puedes corregirlos si cambiaron") para que quede claro por qué aparecieron solos.
- `found: false` o error de red: no pasa nada visible, el formulario sigue como si la función no existiera. Nunca bloquea ni muestra error al usuario por esto — es una mejora silenciosa, no una validación crítica.
- Si el usuario cambia el número de documento después de un autofill exitoso, se limpian los campos que se habían autocompletado (para no dejar datos de otra persona) y la búsqueda se vuelve a disparar en el siguiente `blur`.

## Qué NO cambia

- `customerResolution/individual.ts` y `empresa.ts` no se tocan — siguen siendo la única fuente de verdad al crear el ticket, incluyendo su propia lógica de resolución/creación. El lookup nuevo es una vista previa de solo lectura; si los datos cambiaron entre que se autocompletaron y que el cliente envía el formulario, se envía lo que el cliente haya dejado en el formulario al final, como siempre.
- No se agrega CAPTCHA a esta etapa temprana del formulario.

## Testing

- **Backend**: pruebas unitarias de `lookupIndividual`/`lookupEmpresa` con el mismo patrón de cliente C4C simulado que usa `customerResolution.test.ts`. Casos: encontrado con dirección completa, encontrado con dirección parcial/faltante, no encontrado, error de C4C. Prueba del rate-limiter: la solicitud número 11 en la misma ventana de un minuto devuelve `429`.
- **Frontend**: sin pruebas automatizadas, consistente con el estado actual del paquete `frontend` (ningún componente existente las tiene). Verificación manual en el navegador: autofill visible, edición posterior de los campos, limpieza al cambiar el documento, comportamiento silencioso cuando no se encuentra al cliente.

## Fuera de alcance

- Autocompletar datos del producto (número de serie, etc.) — el pedido original del usuario fue específicamente sobre datos del cliente, no del producto.
- Cambiar la lógica de creación/resolución de clientes al enviar el ticket.
- Persistir o cachear resultados de búsquedas entre sesiones.
