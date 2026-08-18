/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Servidor de tiles del mapa. Sin definir se usa OpenStreetMap, que no
   * requiere clave. Ver la nota en UbicacionPicker.tsx sobre por que conviene
   * poder cambiarlo si crece el volumen.
   */
  readonly VITE_MAPA_TILES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
