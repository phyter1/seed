import { describe, test, expect, afterEach } from "bun:test";
import { startStageServer } from "./stage-server";
import { writeFileSync, mkdtempSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cleanup: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanup) {
    try { fn(); } catch {}
  }
  cleanup = [];
});

function makeTempTarball(content = "fake-tarball-content"): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-test-"));
  const filePath = join(dir, "test-artifact-0.1.0.tar.gz");
  writeFileSync(filePath, content);
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return filePath;
}

describe("startStageServer", () => {
  test("serves the file at the returned URL", async () => {
    const filePath = makeTempTarball("hello-artifact");
    const server = await startStageServer(filePath);
    cleanup.push(() => server.close());

    const res = await fetch(server.url);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("hello-artifact");
  });

  test("returns a URL containing the filename", async () => {
    const filePath = makeTempTarball();
    const server = await startStageServer(filePath);
    cleanup.push(() => server.close());

    expect(server.url).toContain("test-artifact-0.1.0.tar.gz");
  });

  test("returns a URL with a non-loopback IP", async () => {
    const filePath = makeTempTarball();
    const server = await startStageServer(filePath);
    cleanup.push(() => server.close());

    // Should not be localhost/127.0.0.1
    const url = new URL(server.url);
    expect(url.hostname).not.toBe("127.0.0.1");
    expect(url.hostname).not.toBe("localhost");
  });

  test("404 for wrong paths", async () => {
    const filePath = makeTempTarball();
    const server = await startStageServer(filePath);
    cleanup.push(() => server.close());

    const base = server.url.replace(/\/[^/]+$/, "");
    const res = await fetch(`${base}/wrong-file.tar.gz`);
    expect(res.status).toBe(404);
  });

  test("close() stops the server", async () => {
    const filePath = makeTempTarball();
    const server = await startStageServer(filePath);
    server.close();

    // Give a moment for the port to unbind
    await new Promise((r) => setTimeout(r, 50));

    let threw = false;
    try {
      await fetch(server.url);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("throws if file does not exist", async () => {
    await expect(
      startStageServer("/nonexistent/path/artifact.tar.gz")
    ).rejects.toThrow();
  });

  test("serves with content-type application/gzip", async () => {
    const filePath = makeTempTarball();
    const server = await startStageServer(filePath);
    cleanup.push(() => server.close());

    const res = await fetch(server.url);
    expect(res.headers.get("content-type")).toBe("application/gzip");
  });
});
