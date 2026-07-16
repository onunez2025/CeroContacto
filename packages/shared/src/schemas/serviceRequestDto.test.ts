import { describe, expect, it } from "vitest";
import { ServiceRequestSubmissionSchema } from "./serviceRequestDto.js";

const direccion = {
  departamento: "15",
  provincia: "128",
  distrito: "1254",
  codigoPostal: "07021",
  direccion: "AV. EL SOL",
  numero: "555",
  referencia: "Frente al parque",
};

const productos = [{ numeroSerie: "TDM5524083854", productId: "10054511" }];

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const baseCommon = {
  telefono: "+51942568111",
  email: "cliente@example.com",
  direccion,
  productos,
  fechaVisita: tomorrow,
  medioContacto: "whatsapp" as const,
  lugarCompra: "SODIMAC PERU S.A.",
  consentimiento: true as const,
  captchaToken: "token-123",
};

describe("ServiceRequestSubmissionSchema", () => {
  it("acepta una solicitud Empresa (RUC) valida", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      tipoDocumento: "RUC",
      numeroDocumento: "20525512348",
      razonSocial: "SERVICIOS MEDICOS M'VAPE S.A.C.",
    });
    expect(result.success).toBe(true);
  });

  it("acepta una solicitud Individual DNI valida", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(true);
  });

  it("acepta una solicitud Individual CE valida", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      tipoDocumento: "CE",
      numeroDocumento: "AB123456",
      nombres: "JOHN",
      apellidos: "SMITH",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un RUC con digito verificador invalido", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      tipoDocumento: "RUC",
      numeroDocumento: "20525512340",
      razonSocial: "SERVICIOS MEDICOS M'VAPE S.A.C.",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una fecha de visita en el pasado", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      fechaVisita: "2020-01-01",
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(false);
  });

  it("acepta un combo de hasta 4 productos (1 principal + 3 adicionales)", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      productos: [
        { numeroSerie: "SERIE-COCINA", productId: "10054511" },
        { numeroSerie: "SERIE-HORNO", productId: "10054512" },
        { numeroSerie: "SERIE-CAMPANA", productId: "10054513" },
      ],
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza mas de 4 productos", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      productos: Array.from({ length: 5 }, (_, i) => ({ numeroSerie: `SERIE-${i}`, productId: "10054511" })),
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una solicitud sin productos", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      productos: [],
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza sin consentimiento", () => {
    const result = ServiceRequestSubmissionSchema.safeParse({
      ...baseCommon,
      consentimiento: false,
      tipoDocumento: "DNI",
      numeroDocumento: "15619884",
      nombres: "ALVARO MIGUEL",
      apellidos: "SEBASTIANI RUBIO",
    });
    expect(result.success).toBe(false);
  });
});
