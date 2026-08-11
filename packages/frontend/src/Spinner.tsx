interface SpinnerProps {
  /** Variante grande, para la pantalla de espera del envio. */
  large?: boolean;
}

/** Spinner CSS puro (sin dependencias) para estados de carga. */
export function Spinner({ large = false }: SpinnerProps) {
  return <span className={large ? "spinner spinner-lg" : "spinner"} aria-hidden="true" />;
}
