import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { ServiceRequestSubmissionSchema, isValidCe, isValidDni, isValidRuc } from "@cerocontacto/shared";
import { PERU_DISTRITOS, PERU_DEPARTAMENTOS, PERU_PROVINCIAS } from "@cerocontacto/shared";
import {
  ApiError,
  hasActiveCoverage,
  lookupCustomer,
  searchPostalCodes,
  submitServiceRequest,
  validatePostalCode,
  type PostalCodeMatch,
  type SubmitResult,
} from "./api.js";
import { FieldError } from "./FieldError.js";
import { LUGARES_COMPRA } from "./lugaresCompra.js";
import { ProductoPicker } from "./ProductoPicker.js";
import { FechaDisponibleCalendar } from "./FechaDisponibleCalendar.js";
import { Spinner } from "./Spinner.js";
interface ProductoForm {
  numeroSerie: string;
  productId: string;
  /** Solo para filtrar la busqueda en el frontend - no se envia al backend. */
  categoria: string;
  productNombre: string;
  /** Data URLs (redimensionadas) - hasta 6 por producto. */
  fotos: string[];
}
const MAX_PRODUCTOS = 4;
interface FormState {
  tipoDocumento: "RUC" | "DNI" | "CE";
  numeroDocumento: string;
  razonSocial: string;
  nombres: string;
  apellidos: string;
  telefono: string;
  telefono2: string;
  email: string;
  lugarCompra: string;
  departamento: string;
  provincia: string;
  distrito: string;
  codigoPostal: string;
  direccion: string;
  numero: string;
  referencia: string;
  piso: string;
  /** 1 producto principal + hasta 3 adicionales (combo cocina+horno+campana, etc). */
  productos: ProductoForm[];
  fechaVisita: string;
  comentario: string;
  medioContacto: "whatsapp" | "email" | "celular";
  consentimiento: boolean;
}
const initialState: FormState = {
  tipoDocumento: "DNI",
  numeroDocumento: "",
  razonSocial: "",
  nombres: "",
  apellidos: "",
  telefono: "",
  telefono2: "",
  email: "",
  lugarCompra: "",
  departamento: "",
  provincia: "",
  distrito: "",
  codigoPostal: "",
  direccion: "",
  numero: "",
  referencia: "",
  piso: "",
  productos: [{ numeroSerie: "", productId: "", categoria: "", productNombre: "", fotos: [] }],
  fechaVisita: "",
  comentario: "",
  medioContacto: "whatsapp",
  consentimiento: false,
};
const FORM_PROGRESS_KEY = "cerocontacto:form-progress";
const FORM_PROGRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
interface StoredProgress {
  savedAt: number;
  form: FormState;
}
/**
 * Valida que un item de productos guardado tenga la forma minima
 * esperada de ProductoForm - sin esto, un item con forma inesperada
 * (ej. `fotos` ausente/no-array de una version anterior del formulario)
 * pasaria el chequeo de "es un array" pero rompería el render en cuanto
 * el usuario llegue al paso de Equipos (ProductoPicker hace
 * `fotos.length`, que lanza si `fotos` es `undefined`).
 */
function isValidStoredProducto(item: unknown): item is ProductoForm {
  if (!item || typeof item !== "object") return false;
  const p = item as Record<string, unknown>;
  return (
    typeof p.numeroSerie === "string" &&
    typeof p.productId === "string" &&
    typeof p.categoria === "string" &&
    typeof p.productNombre === "string" &&
    Array.isArray(p.fotos)
  );
}
/**
 * Lee el progreso guardado en localStorage, si existe, no tiene mas de
 * 24h, y tiene la forma esperada. Cualquier fallo (JSON invalido,
 * localStorage deshabilitado, forma inesperada) se descarta en
 * silencio y se usa initialState - un dato corrupto o viejo nunca debe
 * romper la carga del formulario.
 */
function loadStoredProgress(): FormState {
  try {
    const raw = localStorage.getItem(FORM_PROGRESS_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<StoredProgress>;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > FORM_PROGRESS_MAX_AGE_MS) {
      return initialState;
    }
    if (!parsed.form || typeof parsed.form !== "object" || Array.isArray(parsed.form)) return initialState;
    const productos = Array.isArray(parsed.form.productos) &&
      parsed.form.productos.length > 0 &&
      parsed.form.productos.every(isValidStoredProducto)
      ? parsed.form.productos
      : initialState.productos;
    return { ...initialState, ...parsed.form, productos };
  } catch {
    return initialState;
  }
}
function saveProgress(form: FormState): void {
  try {
    const toStore: StoredProgress = {
      savedAt: Date.now(),
      form: { ...form, productos: form.productos.map((p) => ({ ...p, fotos: [] })) },
    };
    localStorage.setItem(FORM_PROGRESS_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage puede fallar (modo incognito, cuota excedida) - no bloquea el uso del formulario.
  }
}
function clearStoredProgress(): void {
  try {
    localStorage.removeItem(FORM_PROGRESS_KEY);
  } catch {
    // no-op
  }
}
function buildSubmission(form: FormState): unknown {
  const common = {
    telefono: form.telefono.trim(),
    ...(form.telefono2.trim() ? { telefono2: form.telefono2.trim() } : {}),
    email: form.email.trim(),
    lugarCompra: form.lugarCompra,
    direccion: {
      departamento: form.departamento,
      provincia: form.provincia.trim(),
      distrito: form.distrito.trim(),
      codigoPostal: form.codigoPostal.trim(),
      direccion: form.direccion.trim(),
      numero: form.numero.trim(),
      referencia: form.referencia.trim(),
      ...(form.piso.trim() ? { piso: form.piso.trim() } : {}),
    },
    productos: form.productos.map((p) => ({
      ...(p.numeroSerie.trim() ? { numeroSerie: p.numeroSerie.trim() } : {}),
      productId: p.productId.trim(),
      ...(p.fotos.length ? { fotos: p.fotos } : {}),
    })),
    fechaVisita: form.fechaVisita,
    ...(form.comentario.trim() ? { comentario: form.comentario.trim() } : {}),
    medioContacto: form.medioContacto,
    consentimiento: form.consentimiento,
    captchaToken: "pending-captcha-integration",
  };
  if (form.tipoDocumento === "RUC") {
    return {
      ...common,
      tipoDocumento: "RUC",
      numeroDocumento: form.numeroDocumento.trim(),
      razonSocial: form.razonSocial.trim(),
    };
  }
  return {
    ...common,
    tipoDocumento: form.tipoDocumento,
    numeroDocumento: form.numeroDocumento.trim(),
    nombres: form.nombres.trim(),
    apellidos: form.apellidos.trim(),
  };
}
type Phase = "editing" | "submitting" | "done";
const WHATSAPP_URL = "https://api.whatsapp.com/send/?phone=5116190500&text&type=phone_number&app_absent=0";
function HeroPanel() {
  return (
    <aside className="hero">
      <img className="hero__image" src="/hero.png" alt="Grupo Sole - Rinnal Corporation. Asegura la vida útil de tus equipos y garantiza su eficiente funcionamiento. Garantía de fabricante, técnicos expertos, repuestos propios." />
      <a
        className="hero__whatsapp-bar"
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Comunícate a nuestro WhatsApp oficial (01) 6190500"
      />
    </aside>
  );
}
interface StepDef {
  n: 1 | 2 | 3 | 4;
  label: string;
}
const STEPS: StepDef[] = [
  { n: 1, label: "Datos personales" },
  { n: 2, label: "Dirección" },
  { n: 3, label: "Equipos" },
  { n: 4, label: "Fecha" },
];
function StepHeader({ current, onSelect }: { current: number; onSelect: (step: number) => void }) {
  return (
    <>
      <ol className="steps">
        {STEPS.map((s) => (
          <li key={s.n} className={`steps__item ${s.n === current ? "is-current" : ""} ${s.n < current ? "is-done" : ""}`}>
            <button type="button" className="steps__button" onClick={() => onSelect(s.n)}>
              <span className="steps__circle">{s.n}</span>
              <span className="steps__label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="steps__progress">
        <div className="steps__progress-fill" style={{ width: `${(current / STEPS.length) * 100}%` }} />
      </div>
    </>
  );
}
/** A que paso pertenece cada campo, para saltar al primero con error si falla la validacion final. */
function stepForField(path: string): number {
  if (path.startsWith("direccion.")) return 2;
  if (path.startsWith("productos")) return 3;
  if (path === "fechaVisita" || path === "comentario" || path === "medioContacto" || path === "consentimiento") return 4;
  return 1;
}
function sanitizeDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}
export default function App() {
  const [form, setForm] = useState<FormState>(loadStoredProgress);
  const [showWelcome, setShowWelcome] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("editing");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [customerLookupStatus, setCustomerLookupStatus] = useState<"idle" | "loading" | "found">("idle");
  const [lookedUpDocumento, setLookedUpDocumento] = useState<string | null>(null);
  const numeroDocumentoRef = useRef(form.numeroDocumento);
  useEffect(() => {
    numeroDocumentoRef.current = form.numeroDocumento;
  }, [form.numeroDocumento]);
  // No guardar en el primer render: ese "cambio" es solo el progreso que
  // ya se acaba de leer de localStorage (o el estado inicial vacio), no
  // una edicion real - guardarlo re-marcaria savedAt con datos que ya
  // podian tener horas o dias, haciendo que la expiracion de 24h nunca
  // se cumpla para un visitante que entra a diario (hallazgo de revision
  // final, 2026-08-03). Se compara por IDENTIDAD contra el `form` con el
  // que arranco el componente (no un booleano) para que el guard siga
  // funcionando bien incluso bajo el doble-invocado de efectos de
  // StrictMode en desarrollo (confirmado en vivo: con un booleano simple,
  // la segunda invocacion de StrictMode ya lo encontraba en `false` y
  // guardaba de todos modos - solo se notaba en `npm run dev`, no en un
  // build de produccion real).
  const initialFormRef = useRef(form);
  useEffect(() => {
    if (form === initialFormRef.current) return;
    saveProgress(form);
  }, [form]);
  const DOCUMENT_VALIDATORS: Record<FormState["tipoDocumento"], (v: string) => boolean> = {
    DNI: isValidDni,
    CE: isValidCe,
    RUC: isValidRuc,
  };
  // Mismo patron que PHONE_REGEX en shared/schemas/serviceRequestDto.ts -
  // duplicado a proposito (validacion temprana en el frontend, no
  // autoritativa) para no depender de un export interno de shared solo
  // para esto. La validacion final sigue siendo el schema Zod al enviar.
  const PHONE_FORMAT_REGEX = /^\d{9}$/;
  const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function clearAutofilledFields() {
    setForm((prev) => ({
      ...prev,
      nombres: "",
      apellidos: "",
      razonSocial: "",
      telefono: "",
      email: "",
      departamento: "",
      provincia: "",
      distrito: "",
      direccion: "",
      numero: "",
      piso: "",
      referencia: "",
      codigoPostal: "",
    }));
  }
  function validateOnBlur(key: string, value: string, isValid: (v: string) => boolean, message: string) {
    const trimmed = value.trim();
    if (!trimmed || isValid(trimmed)) return;
    setFieldErrors((prev) => ({ ...prev, [key]: message }));
  }
  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  async function handleDocumentoBlur() {
    const numeroDocumento = form.numeroDocumento.trim();
    const tipoLabel = form.tipoDocumento === "RUC" ? "RUC" : form.tipoDocumento === "CE" ? "Carné de extranjería" : "DNI";
    validateOnBlur("numeroDocumento", numeroDocumento, DOCUMENT_VALIDATORS[form.tipoDocumento], `${tipoLabel} inválido`);
    if (!DOCUMENT_VALIDATORS[form.tipoDocumento](numeroDocumento)) return;
    setCustomerLookupStatus("loading");
    try {
      const result = await lookupCustomer(form.tipoDocumento, numeroDocumento);
      if (!result.found || !result.datos) {
        setCustomerLookupStatus("idle");
        return;
      }
      // Descartar respuestas obsoletas: si el usuario ya corrigio el numero de
      // documento y desenfoco de nuevo mientras esta busqueda seguia en vuelo,
      // no debemos autocompletar el formulario con los datos de otra persona.
      if (numeroDocumentoRef.current !== numeroDocumento) return;
      const d = result.datos;
      setForm((prev) => ({
        ...prev,
        ...(d.nombres ? { nombres: d.nombres } : {}),
        ...(d.apellidos ? { apellidos: d.apellidos } : {}),
        ...(d.razonSocial ? { razonSocial: d.razonSocial } : {}),
        ...(d.telefono ? { telefono: d.telefono } : {}),
        ...(d.email ? { email: d.email } : {}),
        ...(d.direccion.departamento ? { departamento: d.direccion.departamento } : {}),
        ...(d.direccion.provincia ? { provincia: d.direccion.provincia } : {}),
        ...(d.direccion.distrito ? { distrito: d.direccion.distrito } : {}),
        ...(d.direccion.direccion ? { direccion: d.direccion.direccion } : {}),
        ...(d.direccion.numero ? { numero: d.direccion.numero } : {}),
        ...(d.direccion.piso ? { piso: d.direccion.piso } : {}),
        ...(d.direccion.referencia ? { referencia: d.direccion.referencia } : {}),
        ...(d.direccion.codigoPostal ? { codigoPostal: d.direccion.codigoPostal } : {}),
      }));
      setLookedUpDocumento(numeroDocumento);
      setCustomerLookupStatus("found");
      // El codigoPostal guardado del cliente nunca paso por
      // regionxdepartamento (no se valido contra zonas de cobertura activas
      // al momento de guardarse) - revalidarlo en segundo plano, sin
      // bloquear el resto de este flujo, y limpiarlo si ya no es valido para
      // forzar que el cliente elija uno real de la lista.
      if (d.direccion.codigoPostal && d.direccion.departamento) {
        const departamentoAutofill = d.direccion.departamento;
        const codigoPostalAutofill = d.direccion.codigoPostal;
        validatePostalCode(departamentoAutofill, codigoPostalAutofill).then((valido) => {
          if (valido) return;
          setForm((prev) => (prev.codigoPostal === codigoPostalAutofill ? { ...prev, codigoPostal: "" } : prev));
          setPostalQuery((prev) => (prev === codigoPostalAutofill ? "" : prev));
        });
      }
    } catch (err) {
      console.error("customer_lookup_failed", err);
      // Si mientras esta busqueda estaba en vuelo el usuario ya corrigio el
      // numero de documento (y potencialmente una busqueda mas nueva ya
      // encontro datos), no pisar ese estado con un "idle" de esta respuesta
      // obsoleta.
      if (numeroDocumentoRef.current !== numeroDocumento) return;
      setCustomerLookupStatus("idle");
    }
  }
  function handleDocumentoChange(value: string) {
    const maxLen = form.tipoDocumento === "DNI" ? 8 : form.tipoDocumento === "RUC" ? 11 : null;
    const sanitized = maxLen !== null ? sanitizeDigits(value, maxLen) : value;
    if (lookedUpDocumento !== null && sanitized !== lookedUpDocumento) {
      clearAutofilledFields();
      setLookedUpDocumento(null);
      setCustomerLookupStatus("idle");
    }
    update("numeroDocumento", sanitized);
    clearFieldError("numeroDocumento");
  }
  const [coverageStatus, setCoverageStatus] = useState<"idle" | "checking" | "covered" | "not-covered" | "error">(
    "idle",
  );
  const [postalQuery, setPostalQuery] = useState("");
  const [postalResults, setPostalResults] = useState<PostalCodeMatch[]>([]);
  const [postalHasMore, setPostalHasMore] = useState(false);
  const [postalOpen, setPostalOpen] = useState(false);
  const [postalHighlightedIndex, setPostalHighlightedIndex] = useState(-1);
  const [postalLoading, setPostalLoading] = useState(false);
  const [postalSearchError, setPostalSearchError] = useState<string | null>(null);
  const postalDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const postalRequestIdRef = useRef(0);
  useEffect(() => {
    if (form.codigoPostal && !postalQuery) {
      setPostalQuery(form.codigoPostal);
    }
  }, [form.codigoPostal]);
  useEffect(() => {
    if (!form.departamento) {
      setCoverageStatus("idle");
      return;
    }
    let cancelled = false;
    setCoverageStatus("checking");
    hasActiveCoverage(form.departamento)
      .then((covered) => {
        if (cancelled) return;
        setCoverageStatus(covered ? "covered" : "not-covered");
        if (!covered) {
          // Authoritative backstop: no matter which code path set `departamento`
          // (manual select, customer-lookup autofill, etc.), a department with
          // no active coverage must never leave a stale codigoPostal behind.
          setForm((prev) => ({ ...prev, codigoPostal: "" }));
          setPostalQuery("");
          setPostalResults([]);
          setPostalOpen(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("coverage_check_failed", err);
        // Fail OPEN: a transient error (network hiccup, 502) is NOT the same
        // as a confirmed "zero coverage" and must never be treated as one -
        // that would block address entry and wipe a real codigoPostal for a
        // reason that has nothing to do with actual coverage.
        setCoverageStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [form.departamento]);
  function handleDepartamentoChange(value: string) {
    // Cancelar cualquier busqueda debounced pendiente (aun no disparada) del
    // departamento anterior, y "invalidar" cualquier busqueda ya en vuelo
    // (dispatchada pero no resuelta) incrementando el id de solicitud - ver
    // handlePostalQueryChange, que descarta respuestas cuyo id ya no coincide.
    if (postalDebounceRef.current) clearTimeout(postalDebounceRef.current);
    postalRequestIdRef.current += 1;
    setForm((prev) => ({ ...prev, departamento: value, provincia: "", distrito: "", codigoPostal: "" }));
    setPostalQuery("");
    setPostalResults([]);
    setPostalHasMore(false);
    setPostalOpen(false);
  }
  function handlePostalQueryChange(value: string) {
    setPostalQuery(value);
    if (form.codigoPostal) update("codigoPostal", "");
    if (postalDebounceRef.current) clearTimeout(postalDebounceRef.current);
    if (value.trim().length < 2) {
      setPostalResults([]);
      setPostalHasMore(false);
      setPostalSearchError(null);
      setPostalOpen(false);
      setPostalHighlightedIndex(-1);
      return;
    }
    postalDebounceRef.current = setTimeout(() => {
      // Id monotonico capturado al momento de disparar la busqueda real (no
      // al tipear): si el departamento cambia mientras esta solicitud sigue
      // en vuelo, handleDepartamentoChange incrementa postalRequestIdRef, y
      // la respuesta (de otro departamento) se descarta en silencio en vez
      // de repoblar el dropdown con resultados del departamento incorrecto.
      const requestId = ++postalRequestIdRef.current;
      setPostalLoading(true);
      setPostalSearchError(null);
      setPostalOpen(true);
      searchPostalCodes(form.departamento, value)
        .then(({ resultados, hayMasResultados }) => {
          if (requestId !== postalRequestIdRef.current) return;
          setPostalResults(resultados);
          setPostalHasMore(hayMasResultados);
          setPostalHighlightedIndex(-1);
        })
        .catch((err: unknown) => {
          if (requestId !== postalRequestIdRef.current) return;
          setPostalSearchError(
            err instanceof ApiError ? err.message : "No pudimos buscar codigos postales. Intenta de nuevo.",
          );
          setPostalResults([]);
          setPostalHasMore(false);
          setPostalHighlightedIndex(-1);
        })
        .finally(() => {
          if (requestId !== postalRequestIdRef.current) return;
          setPostalLoading(false);
        });
    }, 300);
  }
  /**
   * El dropdown de Distrito (UBIGEO estatico) y el buscador de codigo
   * postal (contra cobertura real de C4C) son independientes - elegir un
   * distrito arriba no le da al cliente ninguna pista de que escribir en
   * el buscador. Se dispara la busqueda automaticamente con el nombre del
   * distrito elegido, para que los resultados aparezcan sin que el
   * cliente tenga que volver a escribir lo mismo (confirmado como
   * confusion real, 2026-07-31).
   */
  function handleDistritoChange(value: string) {
    update("distrito", value);
    const distrito = PERU_DISTRITOS.find((d) => d.id === value);
    if (distrito) handlePostalQueryChange(distrito.nombre);
  }
  function selectPostalMatch(item: PostalCodeMatch) {
    update("codigoPostal", item.codigoPostal);
    setPostalQuery(`${item.distrito} — ${item.codigoPostal}`);
    setPostalResults([]);
    setPostalHasMore(false);
    setPostalOpen(false);
  }
  function handlePostalInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!postalOpen || postalResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPostalHighlightedIndex((i) => (i + 1) % postalResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPostalHighlightedIndex((i) => (i <= 0 ? postalResults.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const highlighted = postalHighlightedIndex >= 0 ? postalResults[postalHighlightedIndex] : undefined;
      if (highlighted) {
        e.preventDefault();
        selectPostalMatch(highlighted);
      }
    } else if (e.key === "Escape") {
      setPostalOpen(false);
      setPostalHighlightedIndex(-1);
    }
  }
  function goToStep(next: number) {
    setStep(next);
    document.querySelector(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function patchProducto(index: number, patch: Partial<ProductoForm>) {
    setForm((prev) => ({
      ...prev,
      productos: prev.productos.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  }
  function addProducto() {
    setForm((prev) =>
      prev.productos.length >= MAX_PRODUCTOS
        ? prev
        : { ...prev, productos: [...prev.productos, { numeroSerie: "", productId: "", categoria: "", productNombre: "", fotos: [] }] },
    );
  }
  function removeProducto(index: number) {
    setForm((prev) => ({ ...prev, productos: prev.productos.filter((_, i) => i !== index) }));
  }
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const candidate = buildSubmission(form);
    const parsed = ServiceRequestSubmissionSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.join(".")] = issue.message;
      }
      setFieldErrors(errors);
      const firstErrorStep = Math.min(...Object.keys(errors).map(stepForField));
      goToStep(firstErrorStep);
      return;
    }
    setFieldErrors({});
    setPhase("submitting");
    try {
      const submission: ServiceRequestSubmission = parsed.data;
      const res = await submitServiceRequest(submission);
      setResult(res);
      clearStoredProgress();
      setPhase("done");
    } catch (err) {
      setPhase("editing");
      setSubmitError(err instanceof ApiError ? err.message : "No pudimos conectarnos con el servidor.");
    }
  }
  if (showWelcome) {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner welcome-card">
          <h1>¡Hola! Bienvenido a Cero Contacto</h1>
          <p>Programa la instalación de tu equipo en 4 pasos rápidos.</p>
          <button type="button" className="btn-primary" onClick={() => setShowWelcome(false)}>
            Comenzar
          </button>
        </div>
        </div>
      </main>
    );
  }
  /**
   * Pantalla de espera dedicada, en vez de dejar el boton "Enviando..."
   * girando. El envio tarda ~20s reales contra C4C (medido en produccion),
   * y con solo el boton deshabilitado el cliente cree que se colgo: vuelve
   * a hacer clic o cierra la pestaña. Si cierra, el ticket igual se crea
   * pero nunca ve su numero, y suele reenviar - duplicandolo. Por eso el
   * texto insiste en no cerrar y anticipa el correo de confirmacion.
   */
  if (phase === "submitting") {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner welcome-card">
          <Spinner large />
          <h1>Estamos registrando tu solicitud</h1>
          <p>Esto puede tomar hasta un minuto. Te enviaremos la confirmación a {form.email.trim() || "tu correo"}.</p>
          <p className="muted">
            <strong>No cierres esta ventana</strong> — tu número de ticket aparecerá aquí.
          </p>
        </div>
        </div>
      </main>
    );
  }
  if (phase === "done" && result) {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner result-card">
          {result.status === "Completed" && (
            <>
              <h1>¡Listo! Tu solicitud fue registrada</h1>
              {result.ticketIds.length === 1 ? (
                <p>
                  Número de ticket: <strong>{result.ticketIds[0]}</strong>
                </p>
              ) : (
                <>
                  <p>Se generó un ticket por cada equipo:</p>
                  <ul className="ticket-list">
                    {result.ticketIds.map((id) => (
                      <li key={id}>
                        <strong>{id}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted">Nos pondremos en contacto contigo para confirmar la fecha de instalación.</p>
              <p className="muted">Un asesor te contactará por WhatsApp o email en las próximas horas para confirmar la fecha y el técnico asignado.</p>
            </>
          )}
          {result.status === "Partial" && (
            <>
              <h1>Agendamos parte de tu solicitud</h1>
              <p>Estos equipos quedaron agendados:</p>
              <ul className="ticket-list">
                {result.ticketIds.map((id) => (
                  <li key={id}>
                    <strong>{id}</strong>
                  </li>
                ))}
              </ul>
              <p>No pudimos agendar estos equipos:</p>
              <ul className="ticket-list">
                {result.productosFallidos.map((id, index) => (
                  // Dos equipos del mismo combo pueden compartir productId (ej.
                  // 2 campanas identicas) - se agrega el indice para evitar
                  // keys duplicadas en React cuando ambos fallan.
                  <li key={`${id}-${index}`}>{form.productos.find((p) => p.productId === id)?.productNombre ?? id}</li>
                ))}
              </ul>
              <p className="muted">{result.errorMessage}</p>
              <p className="muted">
                Comunícate con nosotros por WhatsApp para agendar los equipos que faltaron.
              </p>
            </>
          )}
          {result.status === "Failed" && (
            <>
              <h1>No pudimos completar tu solicitud</h1>
              <p>{result.errorMessage}</p>
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              // Si se creo algun ticket (Completed o Partial), no dejar los
              // datos ya enviados en el formulario: reenviarlos duplicaria
              // los tickets que si existen. Si fallo todo, el cliente vuelve
              // a ver sus datos tal como los dejo, para poder reintentar sin
              // volver a escribir todo.
              if (result.status !== "Failed") {
                setForm(initialState);
              }
              setPhase("editing");
              setResult(null);
              setStep(1);
            }}
          >
            Volver al formulario
          </button>
        </div>
        </div>
      </main>
    );
  }
  return (
    <main className="page">
      <HeroPanel />
      <div className="card">
      <div className="card__inner">
        <h1 className="form-title">Programa tu servicio</h1>
        <StepHeader current={step} onSelect={goToStep} />
        <form onSubmit={handleSubmit} noValidate>
          {step === 1 && (
          <fieldset>
            <legend>Datos personales</legend>
            <div className="field">
              <label htmlFor="tipoDocumento">Tipo de documento</label>
              <select
                id="tipoDocumento"
                value={form.tipoDocumento}
                onChange={(e) => update("tipoDocumento", e.target.value as FormState["tipoDocumento"])}
              >
                <option value="DNI">DNI</option>
                <option value="RUC">RUC</option>
                <option value="CE">Carné de Extranjería</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="numeroDocumento">Número de documento</label>
              <input
                id="numeroDocumento"
                type="text"
                maxLength={form.tipoDocumento === "CE" ? 12 : undefined}
                value={form.numeroDocumento}
                onChange={(e) => handleDocumentoChange(e.target.value)}
                onBlur={handleDocumentoBlur}
              />
              <FieldError message={fieldErrors.numeroDocumento} />
              {customerLookupStatus === "loading" && <p className="hint hint-validating"><Spinner />Estamos validando el número de documento.</p>}
              {customerLookupStatus === "found" && <p className="hint hint-validating">Datos encontrados, puedes corregirlos si cambiaron.</p>}
            </div>
            {form.tipoDocumento === "RUC" ? (
              <div className="field">
                <label htmlFor="razonSocial">Razón social</label>
                <input
                  id="razonSocial"
                  type="text"
                  maxLength={40}
                  value={form.razonSocial}
                  onChange={(e) => update("razonSocial", e.target.value)}
                />
                <FieldError message={fieldErrors.razonSocial} />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="nombres">Nombres</label>
                  <input id="nombres" type="text" maxLength={40} value={form.nombres} onChange={(e) => update("nombres", e.target.value)} />
                  <FieldError message={fieldErrors.nombres} />
                </div>
                <div className="field">
                  <label htmlFor="apellidos">Apellidos</label>
                  <input
                    id="apellidos"
                    type="text"
                    maxLength={40}
                    value={form.apellidos}
                    onChange={(e) => update("apellidos", e.target.value)}
                  />
                  <FieldError message={fieldErrors.apellidos} />
                </div>
              </>
            )}
            <div className="field-row">
              <div className="field">
                <label htmlFor="telefono">Teléfono de contacto (línea 1)</label>
                <input
                  id="telefono"
                  type="text"
                  placeholder="9XXXXXXXX"
                  value={form.telefono}
                  onChange={(e) => {
                    update("telefono", sanitizeDigits(e.target.value, 9));
                    clearFieldError("telefono");
                  }}
                  onBlur={() => validateOnBlur("telefono", form.telefono, (v) => PHONE_FORMAT_REGEX.test(v), "Teléfono inválido")}
                />
                <FieldError message={fieldErrors.telefono} />
              </div>
              <div className="field">
                <label htmlFor="telefono2">Teléfono de contacto (línea 2, opcional)</label>
                <input
                  id="telefono2"
                  type="text"
                  placeholder="9XXXXXXXX"
                  value={form.telefono2}
                  onChange={(e) => update("telefono2", sanitizeDigits(e.target.value, 9))}
                />
                <FieldError message={fieldErrors.telefono2} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => {
                  update("email", e.target.value);
                  clearFieldError("email");
                }}
                onBlur={() => validateOnBlur("email", form.email, (v) => EMAIL_FORMAT_REGEX.test(v), "Email inválido")}
              />
              <FieldError message={fieldErrors.email} />
            </div>
            <div className="field">
              <label htmlFor="lugarCompra">¿Dónde compraste tus productos?</label>
              <select id="lugarCompra" value={form.lugarCompra} onChange={(e) => update("lugarCompra", e.target.value)}>
                <option value="">Selecciona una tienda</option>
                {LUGARES_COMPRA.map((nombre) => (
                  <option key={nombre} value={nombre}>
                    {nombre}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.lugarCompra} />
            </div>
            <div className="step-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={Boolean(fieldErrors.numeroDocumento || fieldErrors.telefono || fieldErrors.email)}
                onClick={() => goToStep(2)}
              >
                Siguiente
              </button>
            </div>
          </fieldset>
          )}
          {step === 2 && (
          <fieldset>
            <legend>Dirección de instalación</legend>
            <div className="field">
              <label htmlFor="departamento">Departamento</label>
              <select id="departamento" value={form.departamento} onChange={(e) => handleDepartamentoChange(e.target.value)}>
                <option value="">Selecciona un departamento</option>
                {PERU_DEPARTAMENTOS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors["direccion.departamento"]} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="provincia">Provincia</label>
                <select
                  id="provincia"
                  value={form.provincia}
                  disabled={!form.departamento}
                  onChange={(e) => setForm((prev) => ({ ...prev, provincia: e.target.value, distrito: "" }))}
                >
                  <option value="">{form.departamento ? "Selecciona una provincia" : "Primero elige un departamento"}</option>
                  {PERU_PROVINCIAS.filter((p) => p.departamentoId === form.departamento).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors["direccion.provincia"]} />
              </div>
              <div className="field">
                <label htmlFor="distrito">Distrito</label>
                <select
                  id="distrito"
                  value={form.distrito}
                  disabled={!form.provincia}
                  onChange={(e) => handleDistritoChange(e.target.value)}
                >
                  <option value="">{form.provincia ? "Selecciona un distrito" : "Primero elige una provincia"}</option>
                  {PERU_DISTRITOS.filter((d) => d.provinciaId === form.provincia).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors["direccion.distrito"]} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="direccion">Dirección</label>
              <input
                id="direccion"
                type="text"
                maxLength={60}
                value={form.direccion}
                onChange={(e) => update("direccion", e.target.value)}
              />
              <FieldError message={fieldErrors["direccion.direccion"]} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="numero">Número</label>
                <input
                  id="numero"
                  type="text"
                  maxLength={10}
                  value={form.numero}
                  onChange={(e) => update("numero", e.target.value)}
                />
                <FieldError message={fieldErrors["direccion.numero"]} />
              </div>
              <div className="field">
                <label htmlFor="codigoPostal">Código postal</label>
                {coverageStatus === "not-covered" ? (
                  <p className="hint">
                    No tenemos cobertura en tu zona todavía.{" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                      Escríbenos por WhatsApp
                    </a>{" "}
                    para coordinar manualmente.
                  </p>
                ) : (
                  <>
                    <div className="autocomplete">
                      <input
                        id="codigoPostal"
                        type="text"
                        autoComplete="off"
                        placeholder={form.departamento ? "Escribe tu distrito o zona..." : "Primero elige un departamento"}
                        disabled={!form.departamento || (coverageStatus !== "covered" && coverageStatus !== "error")}
                        value={postalQuery}
                        onChange={(e) => handlePostalQueryChange(e.target.value)}
                        onFocus={() => postalResults.length > 0 && setPostalOpen(true)}
                        onBlur={() => setTimeout(() => setPostalOpen(false), 150)}
                        onKeyDown={handlePostalInputKeyDown}
                        role="combobox"
                        aria-expanded={postalOpen}
                        aria-controls="codigoPostal-listbox"
                        aria-activedescendant={postalHighlightedIndex >= 0 ? `codigoPostal-option-${postalHighlightedIndex}` : undefined}
                      />
                      {form.codigoPostal ? (
                        <span className="autocomplete-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                      {postalOpen ? (
                        <ul className="autocomplete-list" id="codigoPostal-listbox" role="listbox">
                          {postalLoading ? (
                            <li className="autocomplete-loading"><Spinner />Buscando...</li>
                          ) : postalSearchError ? (
                            <li className="autocomplete-loading autocomplete-error">{postalSearchError}</li>
                          ) : postalResults.length === 0 ? (
                            <li className="autocomplete-loading">Sin resultados para "{postalQuery}", intenta con otro nombre</li>
                          ) : (
                            <>
                              {postalResults.map((item, index) => (
                                <li
                                  key={`${item.distrito}-${item.codigoPostal}`}
                                  id={`codigoPostal-option-${index}`}
                                  role="option"
                                  aria-selected={index === postalHighlightedIndex}
                                  className={index === postalHighlightedIndex ? "is-highlighted" : undefined}
                                >
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => selectPostalMatch(item)}
                                  >
                                    {item.distrito} — {item.codigoPostal}
                                  </button>
                                </li>
                              ))}
                              {postalHasMore ? (
                                <li className="autocomplete-loading">
                                  Hay más resultados — sigue escribiendo para acotar la búsqueda.
                                </li>
                              ) : null}
                            </>
                          )}
                        </ul>
                      ) : null}
                    </div>
                    {coverageStatus === "error" ? (
                      <p className="hint">
                        No pudimos verificar la cobertura de tu zona, pero puedes buscar de todas formas.
                      </p>
                    ) : null}
                  </>
                )}
                <FieldError message={fieldErrors["direccion.codigoPostal"]} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="referencia">Referencia</label>
              <input
                id="referencia"
                type="text"
                maxLength={40}
                value={form.referencia}
                onChange={(e) => update("referencia", e.target.value)}
              />
              <FieldError message={fieldErrors["direccion.referencia"]} />
            </div>
            <div className="field">
              <label htmlFor="piso">Piso / dpto. (opcional)</label>
              <input id="piso" type="text" maxLength={10} value={form.piso} onChange={(e) => update("piso", e.target.value)} />
            </div>
            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => goToStep(1)}>
                Anterior
              </button>
              <button type="button" className="btn-primary" onClick={() => goToStep(3)}>
                Siguiente
              </button>
            </div>
          </fieldset>
          )}
          {step === 3 && (
          <fieldset>
            <legend>Tus equipos</legend>
            <p className="hint">
              Agrega un producto por cada equipo que necesites instalar (ej. cocina, horno y campana del mismo combo) —
              se agenda una sola visita y se genera un ticket por equipo.
            </p>
            {form.productos.map((producto, index) => (
              <div className="producto-row" key={index}>
                <p className="producto-label">{index === 0 ? "Producto principal" : `Producto adicional ${index}`}</p>
                <ProductoPicker
                  idPrefix={`producto-${index}`}
                  categoria={producto.categoria}
                  productId={producto.productId}
                  productNombre={producto.productNombre}
                  fotos={producto.fotos}
                  onCategoriaChange={(categoria) => patchProducto(index, { categoria })}
                  onProductoChange={(productId, productNombre) => patchProducto(index, { productId, productNombre })}
                  onFotosChange={(fotos) => patchProducto(index, { fotos })}
                  productoError={fieldErrors[`productos.${index}.productId`]}
                  fotosError={fieldErrors[`productos.${index}.fotos`]}
                />
                <div className="field">
                  <label htmlFor={`numeroSerie-${index}`}>Número de serie (opcional)</label>
                  <input
                    id={`numeroSerie-${index}`}
                    type="text"
                    value={producto.numeroSerie}
                    onChange={(e) => patchProducto(index, { numeroSerie: e.target.value })}
                  />
                  <FieldError message={fieldErrors[`productos.${index}.numeroSerie`]} />
                </div>
                {form.productos.length > 1 ? (
                  <button type="button" className="btn-link" onClick={() => removeProducto(index)}>
                    Quitar este producto
                  </button>
                ) : null}
              </div>
            ))}
            {form.productos.length < MAX_PRODUCTOS ? (
              <button type="button" className="btn-secondary" onClick={addProducto}>
                + Agregar otro producto
              </button>
            ) : null}
            <FieldError message={fieldErrors.productos} />
            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => goToStep(2)}>
                Anterior
              </button>
              <button type="button" className="btn-primary" onClick={() => goToStep(4)}>
                Siguiente
              </button>
            </div>
          </fieldset>
          )}
          {step === 4 && (
          <fieldset>
            <legend>Fecha de visita</legend>
            <div className="field">
              <label>Fecha deseada</label>
              <FechaDisponibleCalendar
                departamento={form.departamento}
                codigoPostal={form.codigoPostal}
                value={form.fechaVisita}
                onChange={(fecha) => update("fechaVisita", fecha)}
                whatsappUrl={WHATSAPP_URL}
                error={fieldErrors.fechaVisita}
              />
              <p className="hint">Fecha tentativa, sujeta a disponibilidad de cupos - un asesor confirmara la fecha y el tecnico asignado por WhatsApp o email.</p>
            </div>
            <div className="field">
              <label htmlFor="comentario">Cuéntanos más sobre el estado de tu producto y el servicio que requieres (opcional)</label>
              <textarea
                id="comentario"
                rows={4}
                value={form.comentario}
                onChange={(e) => update("comentario", e.target.value)}
              />
            </div>
            <div className="field">
              <label>¿Por qué medio deseas ser contactado?</label>
              <div className="choice-row">
                <label className="choice-pill">
                  <input
                    type="radio"
                    name="medioContacto"
                    checked={form.medioContacto === "whatsapp"}
                    onChange={() => update("medioContacto", "whatsapp")}
                  />
                  WhatsApp
                </label>
                <label className="choice-pill">
                  <input
                    type="radio"
                    name="medioContacto"
                    checked={form.medioContacto === "email"}
                    onChange={() => update("medioContacto", "email")}
                  />
                  Email
                </label>
                <label className="choice-pill">
                  <input
                    type="radio"
                    name="medioContacto"
                    checked={form.medioContacto === "celular"}
                    onChange={() => update("medioContacto", "celular")}
                  />
                  Celular
                </label>
              </div>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.consentimiento} onChange={(e) => update("consentimiento", e.target.checked)} />
              <span>He leído y acepto la política de privacidad.</span>
            </label>
            <FieldError message={fieldErrors.consentimiento} />
            {submitError ? <p className="error-banner">{submitError}</p> : null}
            <div className="step-actions">
              <button type="button" className="btn-secondary" onClick={() => goToStep(3)}>
                Anterior
              </button>
              {/* El estado "enviando" ya no vive aca: mientras dura el envio se
                  muestra la pantalla de espera completa, que retorna antes. */}
              <button type="submit" className="btn-primary">
                Enviar solicitud
              </button>
            </div>
          </fieldset>
          )}
        </form>
      </div>
      </div>
    </main>
  );
}
