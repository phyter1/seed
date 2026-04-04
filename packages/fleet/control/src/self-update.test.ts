import { describe, test, expect } from "bun:test";
import {
  parseChecksums,
  detectBinaryName,
  detectTargetTriple,
} from "./self-update";

describe("parseChecksums", () => {
  test("parses shasum-style output", () => {
    const text = [
      "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234  seed-agent-darwin-arm64",
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  seed-cli-darwin-arm64",
    ].join("\n");
    const map = parseChecksums(text);
    expect(map.size).toBe(2);
    expect(map.get("seed-agent-darwin-arm64")).toBe(
      "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
    );
    expect(map.get("seed-cli-darwin-arm64")).toBe(
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    );
  });

  test("tolerates blank lines and sha256sum binary-mode asterisk", () => {
    const text = [
      "",
      "0000000000000000000000000000000000000000000000000000000000000000  seed-agent-linux-x64",
      "",
      "1111111111111111111111111111111111111111111111111111111111111111 *seed-cli-linux-x64",
      "",
    ].join("\n");
    const map = parseChecksums(text);
    expect(map.size).toBe(2);
    expect(map.get("seed-agent-linux-x64")).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(map.get("seed-cli-linux-x64")).toBe(
      "1111111111111111111111111111111111111111111111111111111111111111"
    );
  });

  test("ignores malformed lines", () => {
    const text = [
      "not a checksum line at all",
      "abcd  seed-agent-darwin-arm64", // hash too short
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  ok-file",
    ].join("\n");
    const map = parseChecksums(text);
    expect(map.size).toBe(1);
    expect(map.get("ok-file")).toBe(
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    );
  });
});

describe("detectBinaryName", () => {
  test("recognises known binary names", () => {
    expect(detectBinaryName("/usr/local/bin/seed-agent")).toBe("seed-agent");
    expect(detectBinaryName("/home/x/seed-cli")).toBe("seed-cli");
    expect(detectBinaryName("./seed-control-plane")).toBe("seed-control-plane");
  });

  test("returns null for unknown binaries", () => {
    expect(detectBinaryName("/usr/bin/bun")).toBeNull();
    expect(detectBinaryName("/some/path/seed-unknown")).toBeNull();
    expect(detectBinaryName("")).toBeNull();
  });
});

describe("detectTargetTriple", () => {
  test("returns a supported triple on this host", () => {
    // The host running tests must be one of the supported targets.
    const triple = detectTargetTriple();
    expect(["darwin-arm64", "darwin-x64", "linux-x64"]).toContain(triple);
  });
});
