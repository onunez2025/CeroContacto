import { useEffect, useRef, useState } from "react";
import { searchProducts, type ProductCatalogItem } from "./api.js";
import { FieldError } from "./FieldError.js";
import { PRODUCT_CATEGORIES } from "./productCategories.js";

interface ProductoPickerProps {
  idPrefix: string;
  categoria: string;
  productId: string;
  productNombre: string;
  onCategoriaChange: (categoria: string) => void;
  onProductoChange: (productId: string, nombre: string) => void;
  categoriaError?: string;
  productoError?: string;
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
  onCategoriaChange,
  onProductoChange,
  categoriaError,
  productoError,
}: ProductoPickerProps) {
  const [query, setQuery] = useState(productNombre);
  const [results, setResults] = useState<ProductCatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
    </>
  );
}
