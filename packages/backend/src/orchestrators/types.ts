export interface OrchestrationSuccess {
  status: "Completed";
  /** Un ticket (Service Request) por producto de la solicitud. */
  ticketIds: string[];
}

export interface OrchestrationFailure {
  status: "Failed";
  /** Mensaje ya traducido/saneado para mostrar al usuario final - nunca el error crudo de C4C. */
  errorMessage: string;
}

export type OrchestrationResult = OrchestrationSuccess | OrchestrationFailure;
