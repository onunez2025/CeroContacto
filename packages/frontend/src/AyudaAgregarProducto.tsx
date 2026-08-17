import { useState } from "react";

interface AyudaAgregarProductoProps {
  /** Tope de productos por solicitud, para no repetir el numero a mano en el texto. */
  maxProductos: number;
  whatsappUrl: string;
}

/**
 * Boton de ayuda del paso de productos: explica paso a paso como registrar
 * un producto (observacion 6 del usuario).
 *
 * Es un panel desplegable EN LINEA y no un modal a proposito: la ayuda
 * describe los campos que estan inmediatamente debajo, asi que el cliente
 * puede leer "elige el tipo de producto" y ver ese mismo campo al lado. Un
 * modal taparia justo lo que se esta explicando, y ademas obligaria a
 * manejar foco atrapado, bloqueo de scroll y cierre con Escape.
 */
export function AyudaAgregarProducto({ maxProductos, whatsappUrl }: AyudaAgregarProductoProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="ayuda">
      <button
        type="button"
        className="ayuda__toggle"
        aria-expanded={abierto}
        aria-controls="ayuda-agregar-producto"
        onClick={() => setAbierto((v) => !v)}
      >
        <span className="ayuda__icono" aria-hidden="true">
          ?
        </span>
        ¿Cómo agrego un producto?
      </button>

      {abierto ? (
        <div className="ayuda__panel" id="ayuda-agregar-producto">
          <ol className="ayuda__lista">
            <li>
              Elige el <strong>tipo de producto</strong> que vas a instalar: cocina, terma, campana o ducha.
            </li>
            <li>
              En <strong>Modelo</strong>, escribe el código o el nombre que figura en tu boleta o en la etiqueta del
              producto, y elígelo de la lista que aparece.
            </li>
            <li>
              Si quieres, agrega <strong>fotos</strong> del producto y su <strong>número de serie</strong>. Los dos son
              opcionales, pero las fotos nos ayudan a preparar mejor la visita.
            </li>
            <li>
              ¿Compraste más de uno? Toca <strong>“+ Agregar otro producto”</strong> y repite estos pasos. Puedes
              registrar hasta {maxProductos} en una misma solicitud y los instalamos en la misma visita.
            </li>
          </ol>
          <p className="ayuda__cierre">
            Si no encuentras tu modelo en la lista,{" "}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              escríbenos por WhatsApp
            </a>{" "}
            y te ayudamos a ubicarlo.
          </p>
        </div>
      ) : null}
    </div>
  );
}
