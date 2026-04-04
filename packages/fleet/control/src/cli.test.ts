import { describe, test, expect } from "bun:test";
import { runJoin } from "./cli";
import { hashToken } from "./auth";

describe("runJoin", () => {
  test("hashes token client-side and posts only the hash", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    let capturedHeaders: any = null;

    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ status: "pending", machine_id: "ren3" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const writes: Record<string, string> = {};
    const mkdirs: string[] = [];
    const logs: string[] = [];

    const fixedToken = "a".repeat(64);
    const result = await runJoin({
      controlUrl: "ws://control.example:4310",
      machineId: "ren3",
      displayName: "Ren 3",
      configPath: "/tmp/seed-cli-test/agent.json",
      fetchImpl: fakeFetch,
      writeFile: (p, c) => {
        writes[p] = c;
      },
      mkdirp: (d) => {
        mkdirs.push(d);
      },
      log: (m) => logs.push(m),
      nowToken: () => fixedToken,
    });

    // URL is normalized ws → http, register path appended
    expect(capturedUrl).toBe("http://control.example:4310/v1/fleet/register");
    // Body contains machine_id, display_name, and hash — NOT the raw token
    expect(capturedBody.machine_id).toBe("ren3");
    expect(capturedBody.display_name).toBe("Ren 3");
    expect(capturedBody.token_hash).toBe(await hashToken(fixedToken));
    expect(capturedBody.token).toBeUndefined();
    // Agent config is persisted with the raw token for the agent daemon
    expect(writes["/tmp/seed-cli-test/agent.json"]).toBeTruthy();
    const saved = JSON.parse(writes["/tmp/seed-cli-test/agent.json"]);
    expect(saved.machine_id).toBe("ren3");
    expect(saved.control_url).toBe("ws://control.example:4310");
    expect(saved.token).toBe(fixedToken);
    // Parent directory is created before write
    expect(mkdirs).toContain("/tmp/seed-cli-test");
    // Return value reflects what was saved
    expect(result.machineId).toBe("ren3");
    expect(result.configPath).toBe("/tmp/seed-cli-test/agent.json");
    expect(logs.some((l) => l.includes("seed fleet approve ren3"))).toBe(true);
  });

  test("normalizes wss:// to https://", async () => {
    let capturedUrl = "";
    const fakeFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;

    await runJoin({
      controlUrl: "wss://control.phytertek.com/",
      machineId: "ren3",
      fetchImpl: fakeFetch,
      writeFile: () => {},
      mkdirp: () => {},
      log: () => {},
      nowToken: () => "b".repeat(64),
    });

    expect(capturedUrl).toBe("https://control.phytertek.com/v1/fleet/register");
  });

  test("leaves http(s) URLs unchanged", async () => {
    let capturedUrl = "";
    const fakeFetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;

    await runJoin({
      controlUrl: "http://localhost:4310",
      machineId: "ren3",
      fetchImpl: fakeFetch,
      writeFile: () => {},
      mkdirp: () => {},
      log: () => {},
      nowToken: () => "c".repeat(64),
    });

    expect(capturedUrl).toBe("http://localhost:4310/v1/fleet/register");
  });

  test("throws on non-2xx response with server error body", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ error: "machine 'ren3' already registered" }),
        { status: 409 }
      )) as unknown as typeof fetch;

    await expect(
      runJoin({
        controlUrl: "http://localhost:4310",
        machineId: "ren3",
        fetchImpl: fakeFetch,
        writeFile: () => {},
        mkdirp: () => {},
        log: () => {},
        nowToken: () => "d".repeat(64),
      })
    ).rejects.toThrow(/409/);
  });

  test("does not write config if registration fails", async () => {
    const fakeFetch = (async () =>
      new Response("server blew up", { status: 500 })) as unknown as typeof fetch;

    let wrote = false;
    await expect(
      runJoin({
        controlUrl: "http://localhost:4310",
        machineId: "ren3",
        fetchImpl: fakeFetch,
        writeFile: () => {
          wrote = true;
        },
        mkdirp: () => {},
        log: () => {},
        nowToken: () => "e".repeat(64),
      })
    ).rejects.toThrow();
    expect(wrote).toBe(false);
  });

  test("generates a fresh random token by default", async () => {
    const tokens = new Set<string>();
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      tokens.add(body.token_hash);
      return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;

    for (let i = 0; i < 3; i++) {
      await runJoin({
        controlUrl: "http://localhost:4310",
        machineId: `ren${i}`,
        fetchImpl: fakeFetch,
        writeFile: () => {},
        mkdirp: () => {},
        log: () => {},
      });
    }
    // Three distinct token hashes
    expect(tokens.size).toBe(3);
    // And each is a 64-char hex SHA-256 digest
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects missing control_url or machine_id", async () => {
    await expect(
      runJoin({
        controlUrl: "",
        machineId: "ren3",
        fetchImpl: (async () => new Response()) as unknown as typeof fetch,
        writeFile: () => {},
        mkdirp: () => {},
        log: () => {},
      })
    ).rejects.toThrow(/control_url/);
    await expect(
      runJoin({
        controlUrl: "http://localhost:4310",
        machineId: "",
        fetchImpl: (async () => new Response()) as unknown as typeof fetch,
        writeFile: () => {},
        mkdirp: () => {},
        log: () => {},
      })
    ).rejects.toThrow(/machine_id/);
  });
});
