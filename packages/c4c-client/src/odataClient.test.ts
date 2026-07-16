import { afterEach, describe, expect, it, vi } from "vitest";
import { C4CError } from "./errors.js";
import { C4CODataClient } from "./odataClient.js";
import { noopLogger } from "./logger.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  return new C4CODataClient({
    baseUrl: "https://qa.example.com/sap/c4c/odata",
    username: "_SYSODATA",
    password: "secret",
    logger: noopLogger,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C4CODataClient", () => {
  it("envia Basic Auth correctamente codificado", async () => {
    let capturedAuth: string | undefined;
    const client = makeClient(async (_url, init) => {
      capturedAuth = (init?.headers as Record<string, string>).Authorization;
      return jsonResponse(200, { d: { results: [] } });
    });

    await client.getCollection("v1/c4codataapi/CorporateAccountCollection");

    const expected = `Basic ${Buffer.from("_SYSODATA:secret").toString("base64")}`;
    expect(capturedAuth).toBe(expected);
  });

  it("getCollection devuelve [] cuando no hay resultados", async () => {
    const client = makeClient(async () => jsonResponse(200, { d: { results: [] } }));
    const result = await client.getCollection("v1/c4codataapi/CorporateAccountCollection");
    expect(result).toEqual([]);
  });

  it("postEntity devuelve la entidad creada desde d.results", async () => {
    const client = makeClient(async () =>
      jsonResponse(201, { d: { results: { ObjectID: "abc123", AccountID: "1038018" } } }),
    );
    const entity = await client.postEntity<{ ObjectID: string; AccountID: string }>(
      "v1/c4codataapi/CorporateAccountCollection",
      { Name: "Test" },
    );
    expect(entity.ObjectID).toBe("abc123");
  });

  it("lanza C4CError con el mensaje de negocio ABSL en un 400", async () => {
    const client = makeClient(async () =>
      jsonResponse(400, { error: { code: "ABSL_1", message: { value: "Cupos agotados" } } }),
    );

    await expect(client.getCollection("cust/v1/cupoporarea/BO_CupoPorAreaRootCollection")).rejects.toMatchObject({
      httpStatus: 400,
      businessMessage: "Cupos agotados",
    } satisfies Partial<C4CError>);
  });

  it("reintenta un GET en 500 y tiene exito en el segundo intento", async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(500, {});
      return jsonResponse(200, { d: { results: [{ ID: "1" }] } });
    });

    const result = await client.getCollection("v1/c4codataapi/ServiceRequestCollection");
    expect(calls).toBe(2);
    expect(result).toEqual([{ ID: "1" }]);
  });

  it("no reintenta un POST aunque el error sea transitorio", async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return jsonResponse(500, {});
    });

    await expect(client.postEntity("v1/c4codataapi/CorporateAccountCollection", {})).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
