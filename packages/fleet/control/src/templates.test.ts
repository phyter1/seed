import { describe, test, expect } from "bun:test";
import {
  renderTemplate,
  expandEnvValue,
  resolveEnv,
  renderPlistEnvDict,
} from "./templates";

describe("renderTemplate", () => {
  test("replaces known tokens", () => {
    const out = renderTemplate("hello @@NAME@@ from @@PLACE@@", {
      NAME: "ren",
      PLACE: "ren1",
    });
    expect(out).toBe("hello ren from ren1");
  });

  test("leaves unknown tokens untouched", () => {
    const out = renderTemplate("@@KNOWN@@ and @@UNKNOWN@@", { KNOWN: "ok" });
    expect(out).toBe("ok and @@UNKNOWN@@");
  });

  test("tokens are case-sensitive (only uppercase)", () => {
    // @@name@@ (lowercase) should not match — regex is [A-Z0-9_]
    const out = renderTemplate("@@name@@", { name: "nope" });
    expect(out).toBe("@@name@@");
  });

  test("handles same token appearing multiple times", () => {
    const out = renderTemplate("@@X@@ and @@X@@ and @@X@@", { X: "foo" });
    expect(out).toBe("foo and foo and foo");
  });
});

describe("expandEnvValue", () => {
  test("expands {{install_dir}}-style placeholders", () => {
    const out = expandEnvValue("{{install_dir}}/lib/vec0.dylib", {
      INSTALL_DIR: "/home/ren/workloads/memory-0.1.0",
    });
    expect(out).toBe("/home/ren/workloads/memory-0.1.0/lib/vec0.dylib");
  });

  test("leaves unknown {{foo}} placeholders untouched", () => {
    const out = expandEnvValue("{{unknown}}/x", { INSTALL_DIR: "/x" });
    expect(out).toBe("{{unknown}}/x");
  });
});

describe("resolveEnv", () => {
  test("declaration env overrides manifest env", () => {
    const out = resolveEnv(
      { A: "manifest", B: "manifest" },
      { A: "override" },
      {}
    );
    expect(out.A).toBe("override");
    expect(out.B).toBe("manifest");
  });

  test("expands tokens in both manifest and declaration values", () => {
    const out = resolveEnv(
      { VEC: "{{install_dir}}/lib/vec.dylib" },
      { DB: "{{install_dir}}/memory.db" },
      { INSTALL_DIR: "/opt/memory" }
    );
    expect(out.VEC).toBe("/opt/memory/lib/vec.dylib");
    expect(out.DB).toBe("/opt/memory/memory.db");
  });
});

describe("renderPlistEnvDict", () => {
  test("renders a plist-compatible env fragment", () => {
    const out = renderPlistEnvDict({ FOO: "bar", BAZ: "qux" });
    expect(out).toContain("<key>FOO</key>");
    expect(out).toContain("<string>bar</string>");
    expect(out).toContain("<key>BAZ</key>");
    expect(out).toContain("<string>qux</string>");
  });

  test("escapes XML special characters in values", () => {
    const out = renderPlistEnvDict({ X: "<script>&" });
    expect(out).toContain("<string>&lt;script&gt;&amp;</string>");
  });
});
