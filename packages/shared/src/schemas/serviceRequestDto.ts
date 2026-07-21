import { z } from "zod";
import { isValidCe, isValidDni, isValidRuc } from "../validators/peru.js";

/**
 * Direccion compartida entre alta de cliente (Empresa/Individual) y
 * producto registrado en C4C. Los nombres de campo son "humanos"; el
 * backend los mapea a los campos tecnicos de C4C (StateCode, Street, etc.).
 */
export const AddressSchema = z.object({
  departamento: z.string().min(1, "Departamento requerido"),
  provincia: z.string().min(1, "Provincia requerida"),
  distrito: z.string().min(1, "Distrito requerido"),
  codigoPostal: z
    .string()
    .regex(/^\d{4,6}$/, "Codigo postal invalido"),
  direccion: z.string().min(3, "Direccion requerida").max(120),
  numero: z.string().min(1).max(20),
  /**
   * Obligatoria: confirmado en el formulario real de C4C ("Nuevo cliente
   * individual" en Fiori) - Referencia tiene asterisco rojo (*), a
   * diferencia de Referencia Adicional que si es opcional.
   */
  referencia: z.string().min(1, "Referencia requerida").max(200),
  referenciaAdicional: z.string().max(200).optional(),
  piso: z.string().max(20).optional(),
});
export type Address = z.infer<typeof AddressSchema>;

const PHONE_REGEX = /^\+?\d{7,15}$/;

/**
 * `numeroSerie` mapea a zaIDdeSerieFSM_KUT en C4C (MaxLength 120,
 * confirmado via $metadata de QA). Ojo: en datos reales este campo esta
 * inconsistentemente poblado (a veces vacio, a veces una descripcion en
 * vez de un serial real) - ver seccion B del cuestionario tecnico.
 */
const ProductoSchema = z.object({
  numeroSerie: z.string().min(1, "Numero de serie requerido").max(120),
  productId: z.string().min(1, "Modelo de producto requerido").max(60),
});

/**
 * 1 a 4 productos por solicitud (1 principal + hasta 3 adicionales, igual
 * que la plataforma actual). El motor de cupos corre UNA sola vez para
 * toda la solicitud (mismo contratista/fecha para todos); se crea un
 * Service Request independiente por producto, todos ligados al mismo
 * cliente y cupo reservado.
 */
const ProductosSchema = z
  .array(ProductoSchema)
  .min(1, "Agrega al menos un producto")
  .max(4, "Maximo 4 productos por solicitud (1 principal + 3 adicionales)");

const BaseFieldsSchema = z.object({
  telefono: z.string().regex(PHONE_REGEX, "Telefono invalido"),
  /**
   * "Telefono de contacto (linea 2)" - opcional, igual que en el
   * formulario actual (servicio-tecnico.sole.com.pe tiene 2 campos de
   * telefono). Mapea a IndividualCustomer/CorporateAccount.Mobile
   * (telefono va a .Phone), confirmado via $metadata de C4C.
   */
  telefono2: z.string().regex(PHONE_REGEX, "Telefono invalido").optional(),
  email: z.string().email("Email invalido"),
  direccion: AddressSchema,
  productos: ProductosSchema,
  /**
   * "Cuentanos mas sobre el estado de tu producto y el servicio que
   * requieres" - mapea a ServiceRequestTextCollection con
   * TypeCode "10004" (Case Description), confirmado en vivo contra QA
   * (ticket 138374: texto de prueba "prueba QA" se guardo con ese TypeCode
   * exacto). Distinto de TypeCode "10071" (Work Description).
   */
  comentario: z.string().max(2000).optional(),
  /**
   * "¿Por que medio desea ser contactado?" - sin campo confirmado en C4C
   * todavia, asi que se anexa como texto al mismo comentario (TypeCode
   * "10004") en vez de bloquear hasta confirmar un mapeo dedicado.
   */
  medioContacto: z.enum(["whatsapp", "email", "celular"], {
    errorMap: () => ({ message: "Selecciona un medio de contacto" }),
  }),
  /**
   * "¿Donde compraste tus productos?" - el campo real en C4C es
   * zIDLugarCompra_SDK (ServiceRequest) / zID_IP_LugarCompra_SDK
   * (RegisteredProduct), respaldado por el BO custom "lugardecompra"
   * (cust/v1/lugardecompra). _SYSODATA todavia no tiene permiso para leer
   * esa tabla (pedido en curso), asi que por ahora el nombre elegido se
   * anexa como texto al comentario en vez de mapearse al codigo real -
   * evita meter un codigo adivinado en un campo real de C4C.
   */
  lugarCompra: z.string().min(1, "Selecciona donde compraste tu producto").max(255),
  fechaVisita: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha de visita invalida")
    .refine((v) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(v) >= today;
    }, "La fecha de visita no puede estar en el pasado"),
  consentimiento: z.literal(true, {
    errorMap: () => ({ message: "Debe aceptar el tratamiento de datos" }),
  }),
  captchaToken: z.string().min(1, "Captcha requerido"),
});

/**
 * RUC -> C4C CorporateAccount (TaxTypeCode "1", confirmado via $metadata).
 * `razonSocial` mapea a CorporateAccount.Name, MaxLength 40 (confirmado en
 * QA - un valor mas largo lo rechaza C4C con un error generico "Property
 * 'Name' ... is invalid" que no explica el motivo real).
 */
const EmpresaSchema = BaseFieldsSchema.extend({
  tipoDocumento: z.literal("RUC"),
  numeroDocumento: z.string().refine(isValidRuc, "RUC invalido"),
  razonSocial: z.string().min(1, "Razon social requerida").max(40),
});

/** FirstName/LastName de IndividualCustomer, MaxLength 40 (confirmado via $metadata de QA). */
const IndividualNameFields = {
  nombres: z.string().min(1, "Nombres requeridos").max(40),
  apellidos: z.string().min(1, "Apellidos requeridos").max(40),
};

/** DNI -> C4C IndividualCustomer (TaxTypeCode "2"). */
const DniSchema = BaseFieldsSchema.extend({
  tipoDocumento: z.literal("DNI"),
  numeroDocumento: z.string().refine(isValidDni, "DNI invalido"),
  ...IndividualNameFields,
});

/**
 * CE (Carne de Extranjeria) -> C4C IndividualCustomer, TaxTypeCode "5"
 * ("ID extranjero"). Confirmado en vivo contra CorporateAccountTaxNumber-
 * TaxTypeCodeCollection / IndividualCustomerTaxNumberTaxTypeCodeCollection
 * (Context 'PE') - no estaba documentado en el spec del proveedor.
 */
const CeSchema = BaseFieldsSchema.extend({
  tipoDocumento: z.literal("CE"),
  numeroDocumento: z.string().refine(isValidCe, "Carne de extranjeria invalido"),
  ...IndividualNameFields,
});

/** DTO que envia el formulario web a POST /api/service-requests. */
export const ServiceRequestSubmissionSchema = z.discriminatedUnion("tipoDocumento", [
  EmpresaSchema,
  DniSchema,
  CeSchema,
]);
export type ServiceRequestSubmission = z.infer<typeof ServiceRequestSubmissionSchema>;

export const SubmissionAcceptedSchema = z.object({
  trackingId: z.string().uuid(),
  status: z.literal("Processing"),
});
export type SubmissionAccepted = z.infer<typeof SubmissionAcceptedSchema>;

export const SubmissionStatusEnum = z.enum(["Processing", "Completed", "Failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusEnum>;

export const SubmissionStatusResponseSchema = z.object({
  trackingId: z.string().uuid(),
  status: SubmissionStatusEnum,
  /** Un ticket por producto de la solicitud. */
  ticketIds: z.array(z.string()).optional(),
  errorMessage: z.string().optional(),
});
export type SubmissionStatusResponse = z.infer<typeof SubmissionStatusResponseSchema>;
