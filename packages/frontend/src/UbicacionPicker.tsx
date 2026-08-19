import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FieldError } from "./FieldError.js";
import { vistaInicial, ZOOM_PUNTO_MARCADO } from "./centrosDepartamento.js";

/**
 * Servidor de tiles. Por defecto OpenStreetMap, que no pide clave ni cuenta -
 * de ahi que este mapa no tenga costo, a diferencia de Google Maps
 * (observacion 14). Se deja configurable porque la politica de uso de los
 * tiles publicos de OSM desaconseja el trafico comercial alto: si el volumen
 * crece, se cambia por un proveedor con plan sin tocar codigo.
 */
const TILES_URL =
  import.meta.env.VITE_MAPA_TILES_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILES_ATRIBUCION = "&copy; colaboradores de OpenStreetMap";

/**
 * Icono dibujado con CSS en vez del PNG por defecto de Leaflet: sus imagenes
 * se referencian por ruta relativa y se rompen al empaquetar con Vite. Un
 * divIcon no depende de ningun archivo.
 */
const ICONO_PIN = L.divIcon({
  className: "mapa__pin",
  html: '<span class="mapa__pin-punto"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

interface UbicacionPickerProps {
  latitud?: number;
  longitud?: number;
  /**
   * Departamento ya elegido en el paso, para abrir el mapa sobre esa zona.
   * Solo afecta la vista inicial: la ubicacion enviada sale siempre del pin.
   */
  departamento?: string;
  onChange: (latitud: number, longitud: number) => void;
  error?: string;
}

/**
 * Selector de ubicacion en un mapa (pedido de Daisy y Ronny, 2026-08-18).
 *
 * C4C guarda latitud/longitud de la direccion - la plataforma actual ya las
 * envia - pero los tickets creados por este formulario llegaban vacios,
 * dejando al tecnico sin forma de ubicar la casa. Los campos destino son
 * zLatitud_SDK/zLongitud_SDK del ticket y zaLatitudFSM_KUT/zaLongitudFSM_KUT
 * del producto registrado.
 *
 * La direccion escrita y el codigo postal NO se reemplazan: el codigo postal
 * es lo que alimenta el motor de cupos y la cobertura. El mapa solo agrega la
 * precision que el texto no da.
 */
export function UbicacionPicker({ latitud, longitud, departamento, onChange, error }: UbicacionPickerProps) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadorRef = useRef<L.Marker | null>(null);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);

  // El callback se guarda en una ref para que los handlers de Leaflet, que se
  // registran una sola vez, no queden apuntando a una version vieja.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!contenedorRef.current || mapaRef.current) return;

    // Un punto ya marcado (progreso restaurado) manda sobre el departamento.
    const vista = vistaInicial(departamento);
    const hayPunto = latitud !== undefined && longitud !== undefined;
    const inicio: [number, number] = hayPunto ? [latitud, longitud] : vista.centro;

    const mapa = L.map(contenedorRef.current, {
      center: inicio,
      zoom: hayPunto ? ZOOM_PUNTO_MARCADO : vista.zoom,
    });
    L.tileLayer(TILES_URL, { attribution: TILES_ATRIBUCION, maxZoom: 19 }).addTo(mapa);

    // El pin NO se muestra hasta que el cliente marque su punto: un pin visible
    // en el centro del departamento se lee como "ya esta elegido", justo cuando
    // el formulario dice que todavia no y no deja avanzar.
    const marcador = L.marker(inicio, { draggable: true, icon: ICONO_PIN });
    if (hayPunto) marcador.addTo(mapa);
    marcador.on("dragend", () => {
      const { lat, lng } = marcador.getLatLng();
      onChangeRef.current(lat, lng);
    });
    // Tocar el mapa tambien mueve el pin: en celular arrastrar un pin chico
    // es incomodo, y tocar donde uno vive es el gesto natural.
    mapa.on("click", (e: L.LeafletMouseEvent) => {
      marcador.setLatLng(e.latlng).addTo(mapa);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapaRef.current = mapa;
    marcadorRef.current = marcador;

    return () => {
      mapa.remove();
      mapaRef.current = null;
      marcadorRef.current = null;
    };
    // Solo al montar: las actualizaciones posteriores van por el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sincroniza el pin con el valor de afuera, en las dos direcciones:
   *
   * - Con punto (progreso restaurado, o "usar mi ubicacion"): lo coloca y lo
   *   muestra.
   * - Sin punto (recien entra, o cambio de departamento y se descarto el
   *   anterior): lo oculta y recentra la vista sobre el departamento elegido.
   *   Recentrar solo cuando NO hay punto es deliberado: mover el mapa despues
   *   de que el cliente puso el pin le haria perder de vista lo que eligio.
   */
  useEffect(() => {
    const mapa = mapaRef.current;
    const marcador = marcadorRef.current;
    if (!mapa || !marcador) return;

    if (latitud !== undefined && longitud !== undefined) {
      marcador.setLatLng([latitud, longitud]).addTo(mapa);
      return;
    }

    marcador.remove();
    const vista = vistaInicial(departamento);
    mapa.setView(vista.centro, vista.zoom);
  }, [departamento, latitud, longitud]);

  function usarMiUbicacion() {
    if (!navigator.geolocation) {
      setAvisoUbicacion("Tu navegador no permite obtener la ubicación. Marca el punto en el mapa.");
      return;
    }
    setBuscandoUbicacion(true);
    setAvisoUbicacion(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoUbicacion(false);
        const { latitude, longitude } = pos.coords;
        mapaRef.current?.setView([latitude, longitude], 17);
        onChangeRef.current(latitude, longitude);
      },
      () => {
        // Denegar el permiso es una respuesta valida, no un error: se sigue
        // pudiendo marcar el punto a mano, que es el camino obligatorio para
        // quien registra una direccion donde no esta parado.
        setBuscandoUbicacion(false);
        setAvisoUbicacion("No pudimos obtener tu ubicación. Busca tu casa en el mapa y toca para marcarla.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const tienePunto = latitud !== undefined && longitud !== undefined;

  return (
    <div className="field">
      <label htmlFor="mapa-ubicacion">Ubicación exacta en el mapa</label>
      <p className="hint">
        Marca dónde debe llegar el técnico. Toca el mapa o arrastra el pin hasta la entrada de tu casa.
      </p>
      <button type="button" className="btn-secondary mapa__boton" onClick={usarMiUbicacion} disabled={buscandoUbicacion}>
        {buscandoUbicacion ? "Buscando tu ubicación..." : "Usar mi ubicación actual"}
      </button>
      {avisoUbicacion ? <p className="hint">{avisoUbicacion}</p> : null}
      <div className="mapa" id="mapa-ubicacion" ref={contenedorRef} />
      <p className="hint mapa__coordenadas">
        {tienePunto ? `Punto marcado: ${latitud.toFixed(6)}, ${longitud.toFixed(6)}` : "Todavía no marcaste tu ubicación."}
      </p>
      <FieldError message={error} />
    </div>
  );
}
