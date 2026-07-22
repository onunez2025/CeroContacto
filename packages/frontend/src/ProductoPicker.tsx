import { useEffect, useRef, useState } from "react";
import { searchProducts, type ProductCatalogItem } from "./api.js";
import { FieldError } from "./FieldError.js";
import { resizeImageToDataUrl } from "./imageResize.js";
import { PRODUCT_CATEGORIES } from "./productCategories.js";

const MAX_FOTOS = 6;

interface ProductoPickerProps {
  idPrefix: string;
  categoria: string;
  productId: string;
  productNombre: string;
  fotos: string[];
  onCategoriaChange: (categoria: string) => void;
  onProductoChange: (productId: string, nombre: string) => void;
  onFotosChange: (fotos: string[]) => void;
  categoriaError?: string;
  productoError?: string;
  fotosError?: string;
}

/**
 * Selector de equipo en 2 pasos: categoria (fija, 9 tipos vendibles) y
 * luego autocompletado por nombre contra el catalogo real de C4C
 * (produccion, solo lectura) - reemplaza el campo libre de "codigo de
 * producto" para que el cliente no tenga que saber el codigo exacto.
 */
export function ProductoPicker({
  idPrefix,
  categoria,
  productId,
  productNombre,
  fotos,
  onCategoriaChange,
  onProductoChange,
  onFotosChange,
  categoriaError,
  productoError,
  fotosError,
}: ProductoPickerProps) {
  const [query, setQuery] = useState(productNombre);
  const [results, setResults] = useState<ProductCatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingFotos, setProcessingFotos] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setQuery(productNombre);
  }, [productNombre]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (productId) onProductoChange("", "");
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!categoria || value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchProducts(categoria, value)
        .then((items) => {
          setResults(items);
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, 300);
  }

  function selectItem(item: ProductCatalogItem) {
    onProductoChange(item.productId, item.nombre);
    setQuery(item.nombre);
    setResults([]);
    setOpen(false);
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
        <label htmlFor={`${idPrefix}-categoria`}>Tipo de equipo</label>
        <select
          id={`${idPrefix}-categoria`}
          value={categoria}
          onChange={(e) => {
            onCategoriaChange(e.target.value);
            onProductoChange("", "");
            setQuery("");
            setResults([]);
          }}
        >
          <option value="">Selecciona el tipo de equipo</option>
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
            placeholder={categoria ? "Escribe el nombre del modelo..." : "Primero selecciona el tipo de equipo"}
            disabled={!categoria}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {productId ? (
            <span className="autocomplete-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
          {open ? (
            <ul className="autocomplete-list">
              {loading ? (
                <li className="autocomplete-loading">Buscando...</li>
              ) : results.length === 0 ? (
                <li className="autocomplete-loading">Sin resultados para "{query}"</li>
              ) : (
                results.map((item) => (
                  <li key={item.productId}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectItem(item)}>
                      {item.nombre}
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
        <label htmlFor={`${idPrefix}-fotos`}>Fotos del equipo (opcional)</label>
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
        <p className="hint">Hasta {MAX_FOTOS} fotos. Sirven para documentar el estado del equipo al instalarlo.</p>
        <FieldError message={fotosError} />
      </div>
    </>
  );
}
