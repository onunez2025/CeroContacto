/** Ancho a partir del cual dejamos de considerar la vista "de celular". */
const ANCHO_MAXIMO_CELULAR = 768;

/**
 * Distancia desde el borde superior a la que dejamos el campo. Alcanza para
 * que su etiqueta siga visible, sin gastar pantalla que necesita la lista.
 */
const MARGEN_SUPERIOR = 72;

/**
 * El teclado del celular tarda en aparecer y el navegador hace su propio
 * desplazamiento al enfocar; si nos adelantamos, peleamos con el y el campo
 * termina en cualquier lado.
 */
const ESPERA_TECLADO_MS = 300;

/**
 * Sube el campo cerca del tope de la pantalla cuando esta por abrirse su
 * lista de resultados.
 *
 * En celular el teclado tapa aproximadamente la mitad inferior. Medido en
 * produccion sobre un iPhone de 812px: al escribir en el buscador de codigo
 * postal, la lista quedaba 311px por DEBAJO del teclado y el cliente no veia
 * ni una sola opcion - escribia, no pasaba nada visible, y concluia que su
 * distrito no estaba. Afectaba igual al buscador de modelos del paso 3.
 *
 * No hace nada en escritorio, donde no hay teclado que tape y mover la
 * pagina sola seria desconcertante.
 */
/**
 * Clase que agrega espacio extra al final del formulario. Sin ella, un campo
 * que esta al FINAL de su paso no se puede subir: la pagina ya llego a su
 * tope de scroll y no hay contenido debajo que desplazar. Es exactamente el
 * caso del buscador de tienda, ultimo campo del paso 1 - medido: le faltaban
 * 576px de recorrido y quedaba clavado bajo el teclado.
 */
const CLASE_ESPACIO = "desplegable-abierto";

export function acomodarParaDesplegable(campo: HTMLElement | null): void {
  if (!campo || window.innerWidth > ANCHO_MAXIMO_CELULAR) return;

  // El espacio se agrega ANTES de desplazar; si no, el scroll se topa con el
  // final del documento y se queda a medio camino.
  document.body.classList.add(CLASE_ESPACIO);

  window.setTimeout(() => {
    const rect = campo.getBoundingClientRect();
    const desplazamiento = rect.top - MARGEN_SUPERIOR;
    // Ya esta arriba: moverlo igual solo produciria un salto sin motivo.
    if (Math.abs(desplazamiento) < 8) return;
    window.scrollBy({ top: desplazamiento, behavior: "smooth" });
  }, ESPERA_TECLADO_MS);
}

/** Devuelve el formulario a su alto normal al cerrarse el desplegable. */
export function soltarEspacioDesplegable(): void {
  document.body.classList.remove(CLASE_ESPACIO);
}

/** Alto maximo de la lista (max-height de .autocomplete-list) mas un respiro. */
const ALTO_NECESARIO_LISTA = 240;

/**
 * ¿Conviene abrir la lista hacia ARRIBA del campo?
 *
 * Subir el campo no siempre alcanza: cuando el buscador esta cerca del final
 * del formulario, la pagina no tiene mas contenido debajo y no se puede
 * desplazar mas, asi que la lista sigue cayendo bajo el teclado. En ese caso
 * la unica salida es abrirla hacia arriba, donde el espacio SI esta libre.
 *
 * Se mide contra `visualViewport`, que en celular se encoge cuando el teclado
 * aparece; es la unica forma de saber cuanta pantalla queda realmente usable.
 * Donde no exista (escritorio, navegadores viejos) se cae a innerHeight, que
 * en la practica devuelve siempre "hay espacio" y deja el comportamiento de
 * antes.
 */
export function convieneAbrirHaciaArriba(campo: HTMLElement | null): boolean {
  if (!campo) return false;
  const altoUtil = window.visualViewport?.height ?? window.innerHeight;
  const rect = campo.getBoundingClientRect();
  const espacioAbajo = altoUtil - rect.bottom;
  const espacioArriba = rect.top;
  // Solo se voltea si arriba hay MAS espacio: si no cabe en ningun lado,
  // dejarla abajo es lo esperable y el usuario puede desplazar.
  return espacioAbajo < ALTO_NECESARIO_LISTA && espacioArriba > espacioAbajo;
}
