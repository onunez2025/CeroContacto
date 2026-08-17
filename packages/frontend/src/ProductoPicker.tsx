import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ApiError, searchProducts, type ProductCatalogItem } from "./api.js";
import { FieldError } from "./FieldError.js";
import { resizeImageToDataUrl } from "./imageResize.js";
import { PRODUCT_CATEGORIES } from "./productCategories.js";
import { Spinner } from "./Spinner.js";

const MAX_FOTOS = 6;

interface ProductoPickerProps {
  idPrefix: string;
  categoria: string;
  productId: string;
  productCodigo: string;
  productNombre: string;
  fotos: string[];
  onCategoriaChange: (categoria: string) => void;
  onProductoChange: (productId: string, codigo: string, nombre: string) => void;
  onFotosChange: (fotos: string[]) => void;
  categoriaError?: string;
  productoError?: string;
  fotosError?: string;
}

/**
 * Etiqueta visible de un producto del catalogo: "codigo - descripcion".
 * El codigo se muestra junto a la descripcion porque el cliente suele
 * tenerlo a mano en la boleta o en la etiqueta del producto, y sin el no
 * puede distinguir dos modelos con descripciones casi identicas
 * (observacion 13 del usuario).
 *
 * `codigo` es el ExternalID de C4C ("3121SOLRD5500V3C"), NO el ProductID
 * interno ("10018698") que se envia al crear el ticket - mostrar ese
 * correlativo no le decia nada al cliente.
 */
function formatProductLabel(codigo: string, nombre: string): string {
  return codigo ? `${codigo} - ${nombre}` : nombre;
}

/**
 * Selector de producto en 2 pasos: categoria (fija, 9 tipos vendibles) y
 * luego autocompletado por descripcion o codigo contra el catalogo real de
 * C4C (produccion, solo lectura) - reemplaza el campo libre de "codigo de
 * producto" para que el cliente no tenga que saber el codigo exacto.
 */
export function ProductoPicker({
  idPrefix,
  categoria,
  productId,
  productCodigo,
  productNombre,
  fotos,
  onCategoriaChange,
  onProductoChange,
  onFotosChange,
  categoriaError,
  productoError,
  fotosError,
}: ProductoPickerProps) {
  const [query, setQuery] = useState(() => formatProductLabel(productCodigo, productNombre));
  const [results, setResults] = useState<ProductCatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [processingFotos, setProcessingFotos] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setQuery(formatProductLabel(productCodigo, productNombre));
  }, [productCodigo, productNombre]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (productId) onProductoChange("", "", "");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!categoria || value.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setSearchError(null);
      setOpen(true);
      searchProducts(categoria, value)
        .then((items) => {
          setResults(items);
          setOpen(true);
          setHighlightedIndex(-1);
        })
        .catch((err: unknown) => {
          setSearchError(err instanceof ApiError ? err.message : "No pudimos buscar productos. Intenta de nuevo.");
          setResults([]);
          setOpen(true);
          setHighlightedIndex(-1);
        })
        .finally(() => setLoading(false));
    }, 300);
  }

  function selectItem(item: ProductCatalogItem) {
    onProductoChange(item.productId, item.codigo, item.nombre);
    setQuery(formatProductLabel(item.codigo, item.nombre));
    setResults([]);
    setOpen(false);
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const highlighted = highlightedIndex >= 0 ? results[highlightedIndex] : undefined;
      if (highlighted) {
        e.preventDefault();
        selectItem(highlighted);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  async function handleFotosSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_FOTOS - fotos.length));

    setProcessingFotos(true);
    try {
      const resized = await Promise.all(files.map((file) => resizeImageToDataUrl(file)));
      onFotosChange([...fotos, ...resized]);
    } catch {
      // Si una foto no se pudo procesar, se ignora silenciosamente - el
      // cliente puede intentar tomarla de nuevo, no bloquea el resto del formulario.
    } finally {
      setProcessingFotos(false);
    }
  }

  function removeFoto(index: number) {
    onFotosChange(fotos.filter((_, i) => i !== index));
  }

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-categoria`}>Tipo de producto</label>
        <select
          id={`${idPrefix}-categoria`}
          value={categoria}
          onChange={(e) => {
            onCategoriaChange(e.target.value);
            onProductoChange("", "", "");
            setQuery("");
            setResults([]);
          }}
        >
          <option value="">Selecciona el tipo de producto</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <FieldError message={categoriaError} />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-modelo`}>Modelo</label>
        <div className="autocomplete">
          <input
            id={`${idPrefix}-modelo`}
            type="text"
            autoComplete="off"
            placeholder={categoria ? "Escribe el código o la descripción del modelo..." : "Primero selecciona el tipo de producto"}
            disabled={!categoria}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={handleInputKeyDown}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${idPrefix}-modelo-listbox`}
            aria-activedescendant={highlightedIndex >= 0 ? `${idPrefix}-modelo-option-${highlightedIndex}` : undefined}
          />
          {productId ? (
            <span className="autocomplete-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
          {open ? (
            <ul className="autocomplete-list" id={`${idPrefix}-modelo-listbox`} role="listbox">
              {loading ? (
                <li className="autocomplete-loading"><Spinner />Buscando...</li>
              ) : searchError ? (
                <li className="autocomplete-loading autocomplete-error">{searchError}</li>
              ) : results.length === 0 ? (
                <li className="autocomplete-loading">Sin resultados para "{query}"</li>
              ) : (
                results.map((item, index) => (
                  <li
                    key={item.productId}
                    id={`${idPrefix}-modelo-option-${index}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    className={index === highlightedIndex ? "is-highlighted" : undefined}
                  >
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectItem(item)}>
                      {formatProductLabel(item.codigo, item.nombre)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
        <FieldError message={productoError} />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-fotos`}>Fotos del producto (opcional)</label>
        {fotos.length > 0 ? (
          <div className="foto-grid">
            {fotos.map((foto, index) => (
              <div className="foto-thumb" key={index}>
                <img src={foto} alt={`Foto ${index + 1}`} />
                <button type="button" className="foto-remove" aria-label="Quitar foto" onClick={() => removeFoto(index)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {fotos.length < MAX_FOTOS ? (
          <input
            id={`${idPrefix}-fotos`}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={processingFotos}
            onChange={(e) => {
              void handleFotosSelected(e.target.files);
              e.target.value = "";
            }}
          />
        ) : null}
        {processingFotos ? <p className="hint">Procesando fotos...</p> : null}
        <p className="hint">Hasta {MAX_FOTOS} fotos. Sirven para documentar el estado del producto al instalarlo.</p>
        <FieldError message={fotosError} />
      </div>
    </>
  );
}
