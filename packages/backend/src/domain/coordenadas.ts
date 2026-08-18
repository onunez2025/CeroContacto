/**
 * Formatea una coordenada como la espera C4C: texto con punto decimal y 7
 * decimales, igual que los valores que ya trae la plataforma actual
 * ("-12.0280400"). Se fija la cantidad de decimales para no depender de como
 * JavaScript serialice el numero (12.028 saldria como "12.028").
 *
 * ~7 decimales son unos 11 cm: mas precision de la que aporta un pin puesto
 * con el dedo, pero es el formato que ya usan los demas registros.
 */
export function formatearCoordenada(valor: number): string {
  return valor.toFixed(7);
}
