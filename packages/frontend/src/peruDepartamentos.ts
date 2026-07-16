/**
 * Codigo de departamento (StateCode de C4C) segun ubigeo INEI estandar de
 * 2 digitos - confirmado contra datos reales de C4C QA: "15"=Lima,
 * "13"=La Libertad, "07"=Callao. El orden coincide con el select de
 * departamento de la plataforma actual (servicio-tecnico.sole.com.pe).
 */
export const PERU_DEPARTAMENTOS: Array<{ code: string; label: string }> = [
  { code: "01", label: "Amazonas" },
  { code: "02", label: "Áncash" },
  { code: "03", label: "Apurímac" },
  { code: "04", label: "Arequipa" },
  { code: "05", label: "Ayacucho" },
  { code: "06", label: "Cajamarca" },
  { code: "07", label: "Callao" },
  { code: "08", label: "Cusco" },
  { code: "09", label: "Huancavelica" },
  { code: "10", label: "Huánuco" },
  { code: "11", label: "Ica" },
  { code: "12", label: "Junín" },
  { code: "13", label: "La Libertad" },
  { code: "14", label: "Lambayeque" },
  { code: "15", label: "Lima" },
  { code: "16", label: "Loreto" },
  { code: "17", label: "Madre de Dios" },
  { code: "18", label: "Moquegua" },
  { code: "19", label: "Pasco" },
  { code: "20", label: "Piura" },
  { code: "21", label: "Puno" },
  { code: "22", label: "San Martín" },
  { code: "23", label: "Tacna" },
  { code: "24", label: "Tumbes" },
  { code: "25", label: "Ucayali" },
];
