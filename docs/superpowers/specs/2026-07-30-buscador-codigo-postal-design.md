# Buscador de código postal contra la cobertura real de SOLE

## Contexto y problema

El campo "Código postal" del paso 2 (Dirección) es hoy un campo de texto libre: el cliente lo escribe a mano, sin ninguna relación con el Departamento/Provincia/Distrito que ya eligió antes en el mismo paso. Esto se descubrió como la causa más probable de un error real visto en producción: al enviar un ticket, C4C rechazó la solicitud con `"C4C: No se encontró una región activa para el Código Postal ingresado."` — un código postal escrito a mano que no coincidía con ninguna zona de cobertura real de SOLE.

## Investigación que definió este diseño

Se investigó en vivo, contra C4C producción (solo lectura), qué tabla valida realmente esa regla de negocio:

- El BO de distritos que ya usa la plataforma (`cust/v1/distritos`, fuente de `PERU_DISTRITOS`) tiene un campo `zCodigoPostal`, pero **solo 72 de 1835 distritos lo tienen cargado, todos en Lima** — y ese código no es el que valida la regla de negocio real.
- La regla real corre contra `cust/v1/regionxdepartamento` (`BO_RegionRootCollection`), que **no es una tabla genérica de geografía de Perú** — es la tabla de **zonas de cobertura de servicio de SOLE** (`zRegRegin` tiene valores como `"SOLE-LIMA"`). De 15,209 registros, solo 2,599 tienen `zRegactivo = true`.
- Esta tabla usa códigos postales mucho más finos que a nivel distrito: un mismo distrito (ej. "Lurigancho") aparece varias veces con códigos postales distintos (`15461`, `15464`, `15468`, `15472`...), cada uno cubriendo una zona más chica dentro del distrito. No hay una relación de "1 distrito = 1 código postal".
- Por lo anterior, autocompletar el código postal solo a partir del distrito elegido (sin que el cliente intervenga) **no es viable** — hace falta que el cliente indique su zona específica dentro del distrito.
- Se evaluó un selector visual con mapa de Google como alternativa (idea original de este proyecto) — se descarta por ahora: ni Google ni SOLE tienen los límites geográficos de estas zonas de cobertura, así que un mapa no permitiría resolver automáticamente cuál código postal aplica a un punto marcado. Queda documentado como una Fase 2 posible, pendiente de ese hueco de datos.

## Decisión de diseño

Reemplazar el campo de texto libre por un buscador tipo autocompletar (mismo patrón visual y técnico que `ProductoPicker`) contra `regionxdepartamento`, filtrado por el Departamento que el cliente ya eligió y solo mostrando zonas con `zRegactivo = true`.

### Manejo de "sin resultados" (dos niveles, no confundir)

1. **Sin cobertura real en todo el departamento elegido** (cero registros activos): se oculta el buscador y se muestra un aviso fuerte — "No tenemos cobertura en tu zona todavía" + el botón de WhatsApp que ya existe en el panel lateral — mismo tratamiento que ya usa el calendario de cupos cuando no hay fechas disponibles. Se determina una sola vez, al llegar al campo (no depende de lo que el cliente escriba).
2. **Sin resultados para una búsqueda puntual** (el departamento sí tiene cobertura, pero el texto escrito no matchea nada): mensaje suave, tipo "Sin resultados para 'X', intenta con otro nombre" — invita a seguir intentando, no bloquea ni muestra el aviso fuerte. Puede ser solo un error de tecleo o una forma distinta de escribir el nombre de la zona.

## Backend

### Nuevo módulo: `postalCodeLookup`

Ubicación: `packages/backend/src/domain/postalCodeLookup/index.ts` — mismo patrón que `productCatalog` (namespace `cust/v1/regionxdepartamento`, no `v1/c4codataapi`).

```ts
export interface PostalCodeMatch {
  distrito: string;       // zIDDistrito (texto tal cual esta en C4C, sin normalizar)
  codigoPostal: string;   // zPostalCodigo
}

/** Busca zonas de cobertura activas por coincidencia parcial de nombre, dentro de un departamento. */
export async function searchPostalCodes(
  departamento: string,
  query: string,
  client: IC4CODataClient,
): Promise<PostalCodeMatch[]>;

/** true si el departamento tiene al menos una zona de cobertura activa (sin depender de texto de busqueda). */
export async function hasActiveCoverage(departamento: string, client: IC4CODataClient): Promise<boolean>;
```

- `searchPostalCodes`: `$filter=zRegDepart eq '<departamento>' and zRegactivo eq true and substringof('<QUERY EN MAYUSCULAS>',zIDDistrito)`, `$top=20`, `$select=zIDDistrito,zPostalCodigo`. Si `departamento` esta vacio o `query.trim().length < 2`, devuelve `[]` sin llamar a C4C (mismo criterio que `searchProducts`).
- `hasActiveCoverage`: mismo filtro sin el `substringof`, `$top=1`. Si `departamento` esta vacio, devuelve `false` sin llamar a C4C.
- Usa el mismo cliente de catálogo de solo lectura que ya usa `productCatalog` (`buildProductCatalogClientFromEnv` — producción, confirmado que `oscar.nunez` ya tiene acceso de lectura a este BO).

### Endpoints nuevos en `app.ts`

- `GET /api/codigos-postales?departamento=15&q=san+juan` → `{ resultados: PostalCodeMatch[] }` (`[]` si faltan parámetros o no hay match, nunca error 4xx por falta de datos de negocio).
- `GET /api/codigos-postales/cobertura?departamento=15` → `{ tieneCobertura: boolean }` (`false` si falta el parámetro).

Errores de conectividad con C4C se propagan como 502, igual que el resto de endpoints existentes.

## Frontend

En el paso 2 (Dirección), al elegir/tener ya un Departamento:

1. Se consulta `tieneCobertura` una sola vez (al entrar al campo o cuando cambia el departamento).
2. Si `false`: se oculta el campo de código postal y se muestra el aviso fuerte + WhatsApp. El resto del formulario permanece usable, pero el cliente no puede avanzar sin un código postal válido (igual que hoy es un campo requerido).
3. Si `true`: se muestra un buscador (mismo patrón que `ProductoPicker` — input + lista desplegable, debounce, loading, error), mostrando cada resultado como `"<distrito> — <codigoPostal>"`. Al seleccionar uno, se guarda `codigoPostal` en el formulario.
4. Si cambia el Departamento después de haber elegido un código postal, se limpia la selección y se vuelve a evaluar la cobertura desde cero.

## Testing

- **Backend**: pruebas unitarias de `searchPostalCodes` y `hasActiveCoverage` con cliente C4C simulado (mismo patrón que `productCatalog.test.ts`). Casos: coincidencia encontrada, sin coincidencia, departamento sin cobertura activa, parámetros faltantes (no llama a C4C), respeta `zRegactivo eq true` en el filtro.
- **Frontend**: sin pruebas automatizadas (consistente con el resto del paquete). Verificación manual: departamento con cobertura (Lima) y búsqueda exitosa, departamento sin cobertura activa (aviso + WhatsApp), búsqueda puntual sin resultados (mensaje suave), cambio de departamento limpia la selección, envío completo del formulario con un código postal real de `regionxdepartamento`.

## Fuera de alcance

- El selector visual con mapa de Google (Fase 2 original de este pedido) — no se descarta, pero requiere resolver primero cómo obtener límites geográficos de las zonas de cobertura de SOLE (no existen hoy ni en C4C ni en una fuente externa evidente). Se documenta aquí como posible trabajo futuro, sin plan concreto todavía.
- Cambios a `PERU_DISTRITOS`/`PERU_PROVINCIAS`/`PERU_DEPARTAMENTOS` o a los campos `distrito`/`provincia` que ya se envían en el ticket — usan un esquema de códigos completamente independiente de `regionxdepartamento`, y no se tocan.
- Investigar o resolver por qué la cobertura de SOLE es tan limitada (2,599 de 15,209 registros activos) — es una decisión de negocio/operaciones de SOLE, no algo que este cambio de código deba resolver.
