import { useEffect, useRef, useState } from "react";
import type { ServiceRequestSubmission } from "@cerocontacto/shared";
import { ServiceRequestSubmissionSchema, isValidCe, isValidDni, isValidRuc } from "@cerocontacto/shared";
import { PERU_DISTRITOS } from "@cerocontacto/shared";
import { ApiError, lookupCustomer, submitServiceRequest, type SubmitResult } from "./api.js";
import { FieldError } from "./FieldError.js";
import { PERU_DEPARTAMENTOS } from "./peruDepartamentos.js";
import { PERU_PROVINCIAS } from "./peruProvincias.js";
import { LUGARES_COMPRA } from "./lugaresCompra.js";
import { ProductoPicker } from "./ProductoPicker.js";

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
  );
}

/** A que paso pertenece cada campo, para saltar al primero con error si falla la validacion final. */
function stepForField(path: string): number {
  if (path.startsWith("direccion.")) return 2;
  if (path.startsWith("productos")) return 3;
  if (path === "fechaVisita" || path === "comentario" || path === "medioContacto" || path === "consentimiento") return 4;
  return 1;
}

export default function App() {
  const [form, setForm] = useState<FormState>(initialState);
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

  const DOCUMENT_VALIDATORS: Record<FormState["tipoDocumento"], (v: string) => boolean> = {
    DNI: isValidDni,
    CE: isValidCe,
    RUC: isValidRuc,
  };

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

  async function handleDocumentoBlur() {
    const numeroDocumento = form.numeroDocumento.trim();
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
    if (lookedUpDocumento !== null && value !== lookedUpDocumento) {
      clearAutofilledFields();
      setLookedUpDocumento(null);
      setCustomerLookupStatus("idle");
    }
    update("numeroDocumento", value);
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
      setPhase("done");
    } catch (err) {
      setPhase("editing");
      setSubmitError(err instanceof ApiError ? err.message : "No pudimos conectarnos con el servidor.");
    }
  }

  if (phase === "done" && result) {
    return (
      <main className="page">
        <HeroPanel />
        <div className="card">
        <div className="card__inner result-card">
          {result.status === "Completed" ? (
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
            </>
          ) : (
            <>
              <h1>No pudimos completar tu solicitud</h1>
              <p>{result.errorMessage}</p>
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
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
                value={form.numeroDocumento}
                onChange={(e) => handleDocumentoChange(e.target.value)}
                onBlur={handleDocumentoBlur}
              />
              <FieldError message={fieldErrors.numeroDocumento} />
              {customerLookupStatus === "loading" && <p className="hint">Buscando...</p>}
              {customerLookupStatus === "found" && <p className="hint">Datos encontrados, puedes corregirlos si cambiaron.</p>}
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
                  placeholder="+51 9XXXXXXXX"
                  value={form.telefono}
                  onChange={(e) => update("telefono", e.target.value)}
                />
                <FieldError message={fieldErrors.telefono} />
              </div>
              <div className="field">
                <label htmlFor="telefono2">Teléfono de contacto (línea 2, opcional)</label>
                <input
                  id="telefono2"
                  type="text"
                  placeholder="+51 9XXXXXXXX"
                  value={form.telefono2}
                  onChange={(e) => update("telefono2", e.target.value)}
                />
                <FieldError message={fieldErrors.telefono2} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
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
              <button type="button" className="btn-primary" onClick={() => goToStep(2)}>
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
              <select
                id="departamento"
                value={form.departamento}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, departamento: e.target.value, provincia: "", distrito: "" }))
                }
              >
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
                  onChange={(e) => update("distrito", e.target.value)}
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
                <input
                  id="codigoPostal"
                  type="text"
                  value={form.codigoPostal}
                  onChange={(e) => update("codigoPostal", e.target.value)}
                />
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
              {/*
                Calendario con fechas reales deshabilitado temporalmente:
                produccion todavia no tiene desplegados los servicios de C4C
                que necesita (cupoporarea/cust_producto). Vuelve a un campo
                de fecha libre - el asesor confirma la capacidad manualmente
                despues, igual que hace hoy. Para reactivar, restaurar el
                <FechaDisponibleCalendar /> que se uso aca (ver historial de
                git) en cuanto esos servicios esten en produccion.
              */}
              <label htmlFor="fechaVisita">Fecha deseada</label>
              <input
                id="fechaVisita"
                type="date"
                value={form.fechaVisita}
                onChange={(e) => update("fechaVisita", e.target.value)}
              />
              <FieldError message={fieldErrors.fechaVisita} />
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
              <button type="submit" className="btn-primary" disabled={phase === "submitting"}>
                {phase === "submitting" ? "Enviando… esto puede tardar unos segundos" : "Enviar solicitud"}
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
