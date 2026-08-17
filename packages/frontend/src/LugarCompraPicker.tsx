import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { FieldError } from "./FieldError.js";
import { LUGARES_COMPRA } from "./lugaresCompra.js";
import { acomodarParaDesplegable, convieneAbrirHaciaArriba, soltarEspacioDesplegable } from "./mobileScroll.js";

/** Maximo de sugerencias en pantalla, igual que los otros buscadores. */
const MAX_RESULTADOS = 20;

/**
 * Normaliza para comparar: sin tildes y en minusculas, para que "PERU"
 * encuentre "PERÚ" y al reves. Los nombres vienen de la plataforma actual y
 * mezclan ambas formas.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function filtrar(query: string): string[] {
  const aguja = normalizar(query.trim());
  if (!aguja) return LUGARES_COMPRA.slice(0, MAX_RESULTADOS);
  return LUGARES_COMPRA.filter((t) => normalizar(t).includes(aguja)).slice(0, MAX_RESULTADOS);
}

interface LugarCompraPickerProps {
  value: string;
  onChange: (lugar: string) => void;
  error?: string;
}

/**
 * Buscador de tienda de compra. Reemplaza al <select> nativo de 119 opciones,
 * que en celular es una rueda interminable: el cliente tenia que recorrerla
 * a ciegas hasta dar con su tienda. Mismo patron que ya usan el codigo postal
 * y el modelo de producto, con la diferencia de que aca la lista es estatica
 * y local, asi que el filtrado es en memoria y no hace falta debounce ni
 * manejo de errores de red.
 */
export function LugarCompraPicker({ value, onChange, error }: LugarCompraPickerProps) {
  const [query, setQuery] = useState(value);
  const [abierto, setAbierto] = useState(false);
  const [abreArriba, setAbreArriba] = useState(false);
  const [resaltado, setResaltado] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const resultados = filtrar(query === value ? "" : query);

  function abrirLista(): void {
    setAbreArriba(convieneAbrirHaciaArriba(inputRef.current));
    setAbierto(true);
  }

  function elegir(lugar: string): void {
    onChange(lugar);
    setQuery(lugar);
    setAbierto(false);
    setResaltado(-1);
    soltarEspacioDesplegable();
  }

  function handleCambio(texto: string): void {
    setQuery(texto);
    // Mientras escribe, la seleccion previa deja de ser valida: el campo es
    // obligatorio y no debe quedar una tienda elegida que ya no se ve.
    if (value) onChange("");
    setResaltado(-1);
    abrirLista();
  }

  function handleTeclas(e: KeyboardEvent<HTMLInputElement>): void {
    if (!abierto || resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((i) => (i + 1) % resultados.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => (i <= 0 ? resultados.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const elegido = resaltado >= 0 ? resultados[resaltado] : undefined;
      if (elegido) {
        e.preventDefault();
        elegir(elegido);
      }
    } else if (e.key === "Escape") {
      setAbierto(false);
      setResaltado(-1);
    }
  }

  return (
    <div className="field">
      <label htmlFor="lugarCompra">¿Dónde compraste tus productos?</label>
      <div className={`autocomplete${abreArriba ? " abre-arriba" : ""}`}>
        <input
          ref={inputRef}
          id="lugarCompra"
          type="text"
          autoComplete="off"
          placeholder="Escribe el nombre de la tienda..."
          value={query}
          onChange={(e) => handleCambio(e.target.value)}
          onFocus={() => {
            acomodarParaDesplegable(inputRef.current);
            abrirLista();
          }}
          onBlur={() => {
            soltarEspacioDesplegable();
            setTimeout(() => setAbierto(false), 150);
          }}
          onKeyDown={handleTeclas}
          role="combobox"
          aria-expanded={abierto}
          aria-controls="lugarCompra-listbox"
          aria-activedescendant={resaltado >= 0 ? `lugarCompra-option-${resaltado}` : undefined}
        />
        {value ? (
          <span className="autocomplete-check" aria-hidden="true">
            ✓
          </span>
        ) : null}
        {abierto ? (
          <ul className="autocomplete-list" id="lugarCompra-listbox" role="listbox">
            {resultados.length === 0 ? (
              <li className="autocomplete-loading">
                Sin resultados para "{query}" — elige <strong>OTRAS TIENDAS</strong> si no la encuentras
              </li>
            ) : (
              resultados.map((lugar, index) => (
                <li
                  key={lugar}
                  id={`lugarCompra-option-${index}`}
                  role="option"
                  aria-selected={index === resaltado}
                  className={index === resaltado ? "is-highlighted" : undefined}
                >
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(lugar)}>
                    {lugar}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <FieldError message={error} />
    </div>
  );
}
