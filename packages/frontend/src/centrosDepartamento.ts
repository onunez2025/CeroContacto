/**
 * Centro APROXIMADO de cada departamento, para abrir el mapa cerca de donde
 * vive el cliente en vez de siempre en Lima.
 *
 * Antes el mapa arrancaba siempre en la Plaza de Armas de Lima: alguien de
 * Arequipa o Piura tenia que alejar el zoom y arrastrar media pantalla hasta
 * su ciudad antes de poder marcar nada.
 *
 * Son valores APROXIMADOS a proposito - la capital de cada departamento, con 2
 * decimales - y eso alcanza porque solo definen la VISTA INICIAL: el cliente
 * igual tiene que mover el pin hasta su casa, y el formulario no lo deja
 * avanzar sin hacerlo. Nunca se envian a C4C como ubicacion; eso sale siempre
 * del pin que el cliente marco.
 *
 * Se resuelve con una tabla estatica y no geocodificando: geocodificar exige un
 * servicio externo (Google cobra por consulta; el de OpenStreetMap desaconseja
 * el uso comercial) y esto cubre la mayor parte de la molestia sin costo ni
 * dependencia nueva. Ver la conversacion de la observacion 14.
 *
 * Las claves son los `code` de PERU_DEPARTAMENTOS en @cerocontacto/shared.
 */
export const CENTROS_DEPARTAMENTO: Record<string, [number, number]> = {
  "01": [-6.23, -77.87], // Amazonas (Chachapoyas)
  "02": [-9.53, -77.53], // Ancash (Huaraz)
  "03": [-13.64, -72.88], // Apurimac (Abancay)
  "04": [-16.41, -71.54], // Arequipa
  "05": [-13.16, -74.22], // Ayacucho
  "06": [-7.16, -78.51], // Cajamarca
  "07": [-12.06, -77.13], // Callao
  "08": [-13.53, -71.97], // Cusco
  "09": [-12.79, -74.97], // Huancavelica
  "10": [-9.93, -76.24], // Huanuco
  "11": [-14.07, -75.73], // Ica
  "12": [-12.07, -75.21], // Junin (Huancayo)
  "13": [-8.11, -79.03], // La Libertad (Trujillo)
  "14": [-6.77, -79.84], // Lambayeque (Chiclayo)
  "15": [-12.05, -77.04], // Lima
  "16": [-3.75, -73.25], // Loreto (Iquitos)
  "17": [-12.6, -69.19], // Madre de Dios (Puerto Maldonado)
  "18": [-17.19, -70.94], // Moquegua
  "19": [-10.68, -76.26], // Pasco (Cerro de Pasco)
  "20": [-5.19, -80.63], // Piura
  "21": [-15.84, -70.03], // Puno
  "22": [-6.49, -76.36], // San Martin (Moyobamba)
  "23": [-18.01, -70.25], // Tacna
  "24": [-3.57, -80.46], // Tumbes
  "25": [-8.38, -74.55], // Ucayali (Pucallpa)
};

/**
 * Vista de reserva cuando todavia no se eligio departamento: Lima, con zoom
 * alejado para que se entienda que hay que acercar.
 */
export const CENTRO_DE_RESERVA: [number, number] = [-12.0464, -77.0428];

/** Zoom con el que se abre el mapa segun cuanta precision tenemos. */
export const ZOOM_PUNTO_MARCADO = 17;
export const ZOOM_DEPARTAMENTO = 12;
export const ZOOM_SIN_REFERENCIA = 10;

/** Centro y zoom con el que abrir el mapa para un departamento dado. */
export function vistaInicial(departamento: string | undefined): {
  centro: [number, number];
  zoom: number;
} {
  const centro = departamento ? CENTROS_DEPARTAMENTO[departamento] : undefined;
  return centro
    ? { centro, zoom: ZOOM_DEPARTAMENTO }
    : { centro: CENTRO_DE_RESERVA, zoom: ZOOM_SIN_REFERENCIA };
}
