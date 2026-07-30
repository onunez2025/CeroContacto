export interface PostalCodeMatch {
  distrito: string;
  codigoPostal: string;
}

export interface PostalCodeSearchResult {
  resultados: PostalCodeMatch[];
  /** true si la busqueda encontro mas de 20 coincidencias (se recortan a 20). */
  hayMasResultados: boolean;
}
