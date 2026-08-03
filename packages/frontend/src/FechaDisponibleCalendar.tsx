import { useEffect, useState } from "react";
import { ApiError, getFechasDisponibles } from "./api.js";
import { FieldError } from "./FieldError.js";
import { Spinner } from "./Spinner.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Lunes=0..Domingo=6, para alinear la grilla con semana empezando en lunes. */
function mondayIndex(isoDate: string): number {
  const jsDay = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0=Domingo..6=Sabado
  return (jsDay + 6) % 7;
}

interface MonthCell {
  iso: string;
  inMonth: boolean;
}

function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstOfMonth = toIsoDate(new Date(Date.UTC(year, month, 1)));
  const leadingBlanks = mondayIndex(firstOfMonth);
  const gridStart = addDaysIso(firstOfMonth, -leadingBlanks);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, i) => {
    const iso = addDaysIso(gridStart, i);
    return { iso, inMonth: new Date(`${iso}T00:00:00Z`).getUTCMonth() === month };
  });
}

interface MesVisible {
  year: number;
  month: number;
}

interface FechaDisponibleCalendarProps {
  departamento: string;
  codigoPostal: string;
  value: string;
  onChange: (fecha: string) => void;
  whatsappUrl: string;
  error?: string;
}

type Estado = "incompleto" | "cargando" | "error" | "vacio" | "listo";

export function FechaDisponibleCalendar({
  departamento,
  codigoPostal,
  value,
  onChange,
  whatsappUrl,
  error,
}: FechaDisponibleCalendarProps) {
  const [fechas, setFechas] = useState<Set<string>>(new Set());
  const [estado, setEstado] = useState<Estado>("cargando");
  const [visibleMonth, setVisibleMonth] = useState<MesVisible | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    // El usuario puede llegar a este paso sin haber completado departamento
    // o codigo postal (navegacion libre entre pasos, ver StepHeader/goToStep
    // en App.tsx - no valida el paso anterior). Sin esta guarda, se consulta
    // el backend con parametros vacios/invalidos (200, {fechas: []}) y se
    // muestra el mensaje de "no tenemos fechas disponibles", que es enganoso:
    // el problema real es que falta completar la direccion, no que no haya
    // cupos (confirmado en vivo, 2026-07-31, ticket con codigoPostal vacio
    // en la solicitud real a /api/fechas-disponibles).
    if (!departamento || !codigoPostal) {
      setEstado("incompleto");
      return;
    }

    let cancelado = false;
    setEstado("cargando");

    getFechasDisponibles(departamento, codigoPostal)
      .then((lista) => {
        if (cancelado) return;
        setFechas(new Set(lista));
        setEstado(lista.length > 0 ? "listo" : "vacio");
        if (lista.length > 0) {
          const primera = new Date(`${lista[0]}T00:00:00Z`);
          setVisibleMonth({ year: primera.getUTCFullYear(), month: primera.getUTCMonth() });
        }
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setEstado("error");
        if (!(err instanceof ApiError)) console.error("fechas_disponibles_fetch_failed", err);
      });

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departamento, codigoPostal, retryToken]);

  if (estado === "incompleto") {
    return <p className="hint">Completa el departamento y el codigo postal en el paso anterior para ver las fechas disponibles.</p>;
  }

  if (estado === "cargando") {
    return <p className="hint"><Spinner />Buscando fechas disponibles...</p>;
  }

  if (estado === "error") {
    return (
      <div className="calendar-error">
        <p className="field-error">No pudimos cargar las fechas disponibles.</p>
        <button type="button" className="btn-link" onClick={() => setRetryToken((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  if (estado === "vacio") {
    return (
      <div className="calendar-empty">
        <p>No tenemos fechas disponibles por el momento.</p>
        <a className="btn-secondary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Escríbenos por WhatsApp
        </a>
      </div>
    );
  }

  if (!visibleMonth) return null;

  const fechasOrdenadas = [...fechas].sort();
  const primeraFecha = new Date(`${fechasOrdenadas[0]}T00:00:00Z`);
  const ultimaFecha = new Date(`${fechasOrdenadas[fechasOrdenadas.length - 1]}T00:00:00Z`);
  const minMes: MesVisible = { year: primeraFecha.getUTCFullYear(), month: primeraFecha.getUTCMonth() };
  const maxMes: MesVisible = { year: ultimaFecha.getUTCFullYear(), month: ultimaFecha.getUTCMonth() };

  const puedeRetroceder =
    visibleMonth.year > minMes.year || (visibleMonth.year === minMes.year && visibleMonth.month > minMes.month);
  const puedeAvanzar =
    visibleMonth.year < maxMes.year || (visibleMonth.year === maxMes.year && visibleMonth.month < maxMes.month);

  const celdas = buildMonthGrid(visibleMonth.year, visibleMonth.month);

  return (
    <div className="calendar">
      <div className="calendar__header">
        <button
          type="button"
          className="calendar__nav"
          disabled={!puedeRetroceder}
          onClick={() => setVisibleMonth((m) => (m ? { year: m.month === 0 ? m.year - 1 : m.year, month: (m.month + 11) % 12 } : m))}
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="calendar__month-label">
          {MESES[visibleMonth.month]} {visibleMonth.year}
        </span>
        <button
          type="button"
          className="calendar__nav"
          disabled={!puedeAvanzar}
          onClick={() => setVisibleMonth((m) => (m ? { year: m.month === 11 ? m.year + 1 : m.year, month: (m.month + 1) % 12 } : m))}
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>
      <div className="calendar__weekdays">
        {DIAS_SEMANA.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className="calendar__grid">
        {celdas.map((cell) => {
          const disponible = cell.inMonth && fechas.has(cell.iso);
          const seleccionada = cell.iso === value;
          return (
            <button
              type="button"
              key={cell.iso}
              disabled={!disponible}
              className={`calendar__day${seleccionada ? " is-selected" : ""}${!cell.inMonth ? " is-outside" : ""}`}
              onClick={() => onChange(cell.iso)}
            >
              {Number(cell.iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <FieldError message={error} />
    </div>
  );
}
