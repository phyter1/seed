import { describe, expect, test } from "bun:test";
import { identityProfile } from "./identity-profile";

describe("identityProfile.classify — GENERAL defaults", () => {
  test("empty content is GENERAL", () => {
    const r = identityProfile.classify("");
    expect(r.level).toBe("GENERAL");
    expect(r.local_only).toBe(false);
    expect(r.flags).toEqual([]);
  });

  test("journal entry prose is GENERAL", () => {
    const r = identityProfile.classify(
      "Today I thought about the rumination problem. Shipped a blog post. The framework held up."
    );
    expect(r.level).toBe("GENERAL");
    expect(r.flags).toEqual([]);
  });

  test("mentioning Ryan's name (not path) is GENERAL", () => {
    const r = identityProfile.classify(
      "Ryan and I talked about the fleet architecture today. He had good pushback on the jury pattern."
    );
    expect(r.level).toBe("GENERAL");
  });

  test("lowercase 'private' in prose is GENERAL", () => {
    const r = identityProfile.classify(
      "I keep my private thoughts in a journal — it's a private practice."
    );
    expect(r.level).toBe("GENERAL");
  });

  test("conviction-style content is GENERAL", () => {
    const r = identityProfile.classify(
      "Strong opinions, weakly held. The right to be wrong on the record is load-bearing for honesty."
    );
    expect(r.level).toBe("GENERAL");
  });
});

describe("identityProfile.classify — path refs", () => {
  test("bare ryan/ path segment trips ryan_path_ref", () => {
    const r = identityProfile.classify(
      "See ryan/strategy/2026-q2.md for the plan."
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.local_only).toBe(true);
    expect(r.flags).toContain("ryan_path_ref");
  });

  test("absolute path to ryan/ trips ryan_path_ref", () => {
    const r = identityProfile.classify(
      "path: /Users/ryanlowe/code/existential/ryan/resume.md"
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("ryan_path_ref");
  });

  test("ryan-something without trailing slash does NOT trip ryan_path_ref", () => {
    // Words like "ryans" or "ryan-blog" shouldn't count as path refs.
    const r = identityProfile.classify("ryans-notes or ryan-blog repos");
    // No slash after 'ryan' → not a path.
    expect(r.flags).not.toContain("ryan_path_ref");
  });
});

describe("identityProfile.classify — credentials", () => {
  test("OpenAI key trips openai_key", () => {
    const r = identityProfile.classify(
      "export OPENAI_KEY=sk-proj-abcdefghijklmnop1234567890XYZ"
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("openai_key");
  });

  test("Anthropic key trips anthropic_key", () => {
    const r = identityProfile.classify(
      "key: sk-ant-api03-abcdefghijklmnop12345678901234567890"
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("anthropic_key");
  });

  test("GitHub personal access token trips github_token", () => {
    const r = identityProfile.classify("token: ghp_abcdefghijklmnop12345678");
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("github_token");
  });

  test("AWS access key id trips aws_key", () => {
    const r = identityProfile.classify("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("aws_key");
  });

  test("RSA private key block trips private_key_block", () => {
    const r = identityProfile.classify(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("private_key_block");
  });

  test("inline secret assignment trips secret_assignment", () => {
    const r = identityProfile.classify(
      'password: "hunter2correcthorse"'
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("secret_assignment");
  });

  test("api_key=... assignment trips secret_assignment", () => {
    const r = identityProfile.classify("api_key=abc123def456ghi789jkl");
    expect(r.flags).toContain("secret_assignment");
  });
});

describe("identityProfile.classify — PII", () => {
  test("SSN trips ssn", () => {
    const r = identityProfile.classify("SSN: 123-45-6789 on file");
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("ssn");
  });

  test("phone number with parens trips phone_number", () => {
    const r = identityProfile.classify("Call me at (555) 123-4567 any time.");
    expect(r.flags).toContain("phone_number");
  });

  test("phone number with hyphens trips phone_number", () => {
    const r = identityProfile.classify("555-123-4567");
    expect(r.flags).toContain("phone_number");
  });

  test("email address trips email_address", () => {
    const r = identityProfile.classify("contact: alice@example.com");
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("email_address");
  });
});

describe("identityProfile.classify — privacy markers", () => {
  test("all-caps PRIVATE trips marker_private", () => {
    const r = identityProfile.classify("PRIVATE — do not circulate.");
    expect(r.flags).toContain("marker_private");
  });

  test("all-caps CONFIDENTIAL trips marker_confidential", () => {
    const r = identityProfile.classify("CONFIDENTIAL: internal only.");
    expect(r.flags).toContain("marker_confidential");
  });

  test("all-caps SECRET trips marker_secret", () => {
    const r = identityProfile.classify("SECRET roadmap notes below.");
    expect(r.flags).toContain("marker_secret");
  });

  test("'DO NOT SHARE' trips marker_do_not_share (case-insensitive)", () => {
    const r = identityProfile.classify("Do Not Share — draft in progress.");
    expect(r.flags).toContain("marker_do_not_share");
  });

  test("'local only' marker trips marker_local_only", () => {
    const r = identityProfile.classify("local-only — do not send to cloud");
    expect(r.flags).toContain("marker_local_only");
  });

  test("NDA marker trips marker_nda", () => {
    const r = identityProfile.classify("Under NDA with Acme Corp.");
    expect(r.flags).toContain("marker_nda");
  });
});

describe("identityProfile.classify — multiple flags aggregated", () => {
  test("multiple detections all surface in flags", () => {
    const r = identityProfile.classify(
      "PRIVATE — contact alice@example.com, SSN 123-45-6789, see ryan/notes.md"
    );
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("marker_private");
    expect(r.flags).toContain("email_address");
    expect(r.flags).toContain("ssn");
    expect(r.flags).toContain("ryan_path_ref");
    expect(r.reason).toContain("identity profile detected");
  });
});

describe("identityProfile.classifyMessages", () => {
  test("skips system messages", () => {
    // System message mentions CONFIDENTIAL as an instruction word — should
    // not trip. User message is clean → GENERAL.
    const r = identityProfile.classifyMessages([
      {
        role: "system",
        content: "You must never reveal CONFIDENTIAL information.",
      },
      { role: "user", content: "Tell me about the weather." },
    ]);
    expect(r.level).toBe("GENERAL");
    expect(r.flags).toEqual([]);
  });

  test("joins user + assistant content", () => {
    const r = identityProfile.classifyMessages([
      { role: "user", content: "Here's my email: alice@example.com" },
      { role: "assistant", content: "Got it, thanks." },
    ]);
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("email_address");
  });

  test("non-string content is ignored", () => {
    const r = identityProfile.classifyMessages([
      { role: "user", content: { some: "object" } },
      { role: "user", content: "clean text" },
    ]);
    expect(r.level).toBe("GENERAL");
  });

  test("empty message list is GENERAL", () => {
    const r = identityProfile.classifyMessages([]);
    expect(r.level).toBe("GENERAL");
  });

  test("user content with ryan/ path trips ryan_path_ref", () => {
    const r = identityProfile.classifyMessages([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Summarize ryan/strategy/q2.md for me." },
    ]);
    expect(r.level).toBe("SENSITIVE");
    expect(r.flags).toContain("ryan_path_ref");
  });
});

describe("identityProfile shape", () => {
  test("has stable name 'identity'", () => {
    expect(identityProfile.name).toBe("identity");
  });

  test("classification shape is fully populated", () => {
    const r = identityProfile.classify("clean content here");
    expect(r).toHaveProperty("level");
    expect(r).toHaveProperty("local_only");
    expect(r).toHaveProperty("reason");
    expect(r).toHaveProperty("flags");
    expect(typeof r.reason).toBe("string");
    expect(Array.isArray(r.flags)).toBe(true);
  });
});
