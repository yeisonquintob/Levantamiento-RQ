import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserUuid } from "../../apps/web/src/app/browser-uuid";

test("usa randomUUID cuando existe", () => {
  const expected = "12345678-1234-4234-9234-123456789abc";
  const cryptoApi = {
    randomUUID: () => expected,
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => array,
  } as unknown as Crypto;
  assert.equal(createBrowserUuid(cryptoApi), expected);
});

test("usa getRandomValues en HTTP LAN", () => {
  const bytes = [0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x08,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff];
  const cryptoApi = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!array || !(array instanceof Uint8Array)) throw new Error("Uint8Array esperado");
      for (let i=0;i<array.length;i+=1) array[i]=bytes[i % bytes.length] ?? 0;
      return array as T;
    },
  } as unknown as Crypto;
  const uuid=createBrowserUuid(cryptoApi);
  assert.equal(uuid,"00112233-4455-4677-8899-aabbccddeeff");
  assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test("falla seguro si Web Crypto no dispone de getRandomValues", () => {
  const cryptoApi = {} as Crypto;
  assert.throws(
    () => createBrowserUuid(cryptoApi),
    /generador criptográfico seguro/u,
  );
});
