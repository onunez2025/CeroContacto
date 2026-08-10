export interface OrchestrationSuccess {
  status: "Completed";
  /** Un ticket (Service Request) por producto de la solicitud. */
  ticketIds: string[];
}

export interface OrchestrationPartial {
  status: "Partial";
  /** Tickets que si se crearon. */
  ticketIds: string[];
  /** productId de cada equipo que no logro ticket. */
  productosFallidos: string[];
  /** Mensaje ya saneado para el usuario final. */
  errorMessage: string;
}

export interface OrchestrationFailure {
  status: "Failed";
  /** Mensaje ya traducido/saneado para mostrar al usuario final - nunca el error crudo de C4C. */
  errorMessage: string;
}

export type OrchestrationResult = OrchestrationSuccess | OrchestrationPartial | OrchestrationFailure;
