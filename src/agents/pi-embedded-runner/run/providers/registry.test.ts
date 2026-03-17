import { describe, expect, it, beforeEach } from "vitest";
import {
  registerStreamProvider,
  resolveFromStreamProviderRegistry,
  clearStreamProviderRegistry,
  getStreamProviderRegistry,
} from "./registry.js";

function makeStreamFn() {
  return () => ({ [Symbol.asyncIterator]: () => (async function* () {})() }) as never;
}

describe("provider registry", () => {
  beforeEach(() => {
    clearStreamProviderRegistry();
  });

  describe("registerStreamProvider", () => {
    it("registers a resolver and returns an unregister function", () => {
      const resolver = () => null;
      const unregister = registerStreamProvider(resolver);
      expect(getStreamProviderRegistry()).toContain(resolver);

      unregister();
      expect(getStreamProviderRegistry()).not.toContain(resolver);
    });

    it("registers multiple resolvers", () => {
      const r1 = () => null;
      const r2 = () => null;
      registerStreamProvider(r1);
      registerStreamProvider(r2);
      expect(getStreamProviderRegistry()).toHaveLength(2);
    });

    it("unregister is idempotent — calling twice does not throw", () => {
      const resolver = () => null;
      const unregister = registerStreamProvider(resolver);
      unregister();
      expect(() => unregister()).not.toThrow();
    });
  });

  describe("resolveFromStreamProviderRegistry", () => {
    it("returns null when registry is empty", async () => {
      const result = await resolveFromStreamProviderRegistry({});
      expect(result).toBeNull();
    });

    it("returns null when all resolvers return null", async () => {
      registerStreamProvider(() => null);
      registerStreamProvider(() => null);
      const result = await resolveFromStreamProviderRegistry({});
      expect(result).toBeNull();
    });

    it("returns the StreamFn from the first matching resolver", async () => {
      const fn1 = makeStreamFn();
      registerStreamProvider(() => fn1);
      registerStreamProvider(() => makeStreamFn());

      const result = await resolveFromStreamProviderRegistry({});
      expect(result).toBe(fn1);
    });

    it("skips null-returning resolvers and returns the first non-null result", async () => {
      const fn2 = makeStreamFn();
      registerStreamProvider(() => null);
      registerStreamProvider(() => fn2);

      const result = await resolveFromStreamProviderRegistry({});
      expect(result).toBe(fn2);
    });

    it("resolvers are called in registration order", async () => {
      const callOrder: number[] = [];
      registerStreamProvider(() => {
        callOrder.push(1);
        return null;
      });
      registerStreamProvider(() => {
        callOrder.push(2);
        return null;
      });

      await resolveFromStreamProviderRegistry({});
      expect(callOrder).toEqual([1, 2]);
    });

    it("stops iterating after the first match", async () => {
      let secondCalled = false;
      registerStreamProvider(() => makeStreamFn());
      registerStreamProvider(() => {
        secondCalled = true;
        return makeStreamFn();
      });

      await resolveFromStreamProviderRegistry({});
      expect(secondCalled).toBe(false);
    });

    it("supports async (Promise-returning) resolvers", async () => {
      const fn = makeStreamFn();
      registerStreamProvider(async () => fn);

      const result = await resolveFromStreamProviderRegistry({});
      expect(result).toBe(fn);
    });

    it("passes params to every resolver", async () => {
      const receivedParams: unknown[] = [];
      const params = { provider: "my-llm", model: { id: "foo" } };

      registerStreamProvider((p) => {
        receivedParams.push(p);
        return null;
      });

      await resolveFromStreamProviderRegistry(params);
      expect(receivedParams[0]).toBe(params);
    });
  });

  describe("clearStreamProviderRegistry", () => {
    it("empties the registry", () => {
      registerStreamProvider(() => null);
      registerStreamProvider(() => null);
      clearStreamProviderRegistry();
      expect(getStreamProviderRegistry()).toHaveLength(0);
    });
  });

  describe("getStreamProviderRegistry", () => {
    it("returns a snapshot of the current registry", () => {
      const r = () => null;
      registerStreamProvider(r);
      const snapshot = getStreamProviderRegistry();
      expect(snapshot).toContain(r);
    });
  });
});
