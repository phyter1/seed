import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ControlDB } from "./db";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/seed-control-test.db";

let db: ControlDB;

beforeEach(() => {
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
  db = new ControlDB(TEST_DB);
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

// --- Machine Registry ---

describe("machine registry", () => {
  test("register creates a pending machine", () => {
    const machine = db.registerMachine("ren1", "Ren 1");
    expect(machine.id).toBe("ren1");
    expect(machine.display_name).toBe("Ren 1");
    expect(machine.status).toBe("pending");
    expect(machine.token_hash).toBeNull();
  });

  test("approve transitions pending → accepted with token hash", () => {
    db.registerMachine("ren1");
    const approved = db.approveMachine("ren1", "hash_abc123");
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("accepted");
    expect(approved!.token_hash).toBe("hash_abc123");
  });

  test("approve fails for non-pending machine", () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash_1");
    // Try to approve again — already accepted
    const result = db.approveMachine("ren1", "hash_2");
    expect(result).toBeNull();
  });

  test("revoke transitions accepted → revoked and clears token", () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash_abc");
    const revoked = db.revokeMachine("ren1");
    expect(revoked).not.toBeNull();
    expect(revoked!.status).toBe("revoked");
    expect(revoked!.token_hash).toBeNull();
  });

  test("revoke fails for non-accepted machine", () => {
    db.registerMachine("ren1");
    const result = db.revokeMachine("ren1");
    expect(result).toBeNull();
  });

  test("full lifecycle: pending → accepted → revoked", () => {
    db.registerMachine("ren1");
    expect(db.getMachine("ren1")!.status).toBe("pending");

    db.approveMachine("ren1", "hash_1");
    expect(db.getMachine("ren1")!.status).toBe("accepted");

    db.revokeMachine("ren1");
    expect(db.getMachine("ren1")!.status).toBe("revoked");
  });

  test("validateToken returns machine for valid token hash", () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "correct_hash");
    const machine = db.validateToken("ren1", "correct_hash");
    expect(machine).not.toBeNull();
    expect(machine!.id).toBe("ren1");
  });

  test("validateToken returns null for wrong hash", () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "correct_hash");
    const machine = db.validateToken("ren1", "wrong_hash");
    expect(machine).toBeNull();
  });

  test("validateToken returns null for revoked machine", () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash_1");
    db.revokeMachine("ren1");
    const machine = db.validateToken("ren1", "hash_1");
    expect(machine).toBeNull();
  });

  test("listMachines returns all machines", () => {
    db.registerMachine("ren1");
    db.registerMachine("ren2");
    db.registerMachine("ren3");
    const machines = db.listMachines();
    expect(machines.length).toBe(3);
  });

  test("listMachines filters by status", () => {
    db.registerMachine("ren1");
    db.registerMachine("ren2");
    db.approveMachine("ren2", "hash_2");
    const pending = db.listMachines("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe("ren1");
    const accepted = db.listMachines("accepted");
    expect(accepted.length).toBe(1);
    expect(accepted[0].id).toBe("ren2");
  });

  test("updateMachineInfo sets arch, platform, etc.", () => {
    db.registerMachine("ren1");
    db.updateMachineInfo("ren1", {
      arch: "arm64",
      platform: "darwin",
      memory_gb: 16,
      agent_version: "0.1.0",
      config_version: 3,
    });
    const machine = db.getMachine("ren1")!;
    expect(machine.arch).toBe("arm64");
    expect(machine.platform).toBe("darwin");
    expect(machine.memory_gb).toBe(16);
    expect(machine.agent_version).toBe("0.1.0");
    expect(machine.config_version).toBe(3);
    // First time we set agent_version — agent_updated_at should be populated.
    expect(machine.agent_updated_at).not.toBeNull();
  });

  test("updateMachineInfo bumps agent_updated_at only when version changes", async () => {
    db.registerMachine("ren1");
    db.updateMachineInfo("ren1", { agent_version: "0.1.0" });
    const first = db.getMachine("ren1")!;
    const firstStamp = first.agent_updated_at;
    expect(firstStamp).not.toBeNull();

    // Same version re-reported: stamp should not move.
    await new Promise((r) => setTimeout(r, 1100));
    db.updateMachineInfo("ren1", { agent_version: "0.1.0" });
    const second = db.getMachine("ren1")!;
    expect(second.agent_updated_at).toBe(firstStamp);

    // New version: stamp advances.
    db.updateMachineInfo("ren1", { agent_version: "0.2.0" });
    const third = db.getMachine("ren1")!;
    expect(third.agent_version).toBe("0.2.0");
    expect(third.agent_updated_at).not.toBe(firstStamp);
  });

  test("updateLastHealth stores and retrieves health JSON", () => {
    db.registerMachine("ren1");
    const health = {
      machine_id: "ren1",
      timestamp: new Date().toISOString(),
      system: { cpu_percent: 15, memory_used_gb: 8, memory_total_gb: 32, disk_free_gb: 100 },
      services: [],
      models: [],
    };
    db.updateLastHealth("ren1", health);
    const machine = db.getMachine("ren1")!;
    expect(machine.last_health).not.toBeNull();
    expect(machine.last_health!.system.cpu_percent).toBe(15);
  });
});

// --- Config Store ---

describe("config store", () => {
  test("set and get config", () => {
    const entry = db.setConfig("fleet", { name: "ren-fleet" }, "operator:ryan");
    expect(entry.key).toBe("fleet");
    expect(entry.value).toEqual({ name: "ren-fleet" });
    expect(entry.version).toBe(1);

    const retrieved = db.getConfig("fleet");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toEqual({ name: "ren-fleet" });
  });

  test("set increments version", () => {
    db.setConfig("fleet", { v: 1 }, "system");
    db.setConfig("fleet", { v: 2 }, "system");
    const entry = db.getConfig("fleet")!;
    expect(entry.version).toBe(2);
    expect(entry.value).toEqual({ v: 2 });
  });

  test("getConfigVersion returns max version across keys", () => {
    db.setConfig("a", 1, "system");
    db.setConfig("b", 2, "system");
    db.setConfig("a", 3, "system"); // a is now version 2
    expect(db.getConfigVersion()).toBe(2);
  });

  test("getAllConfig returns all entries", () => {
    db.setConfig("fleet", { name: "test" }, "system");
    db.setConfig("machines.ren1", { services: [] }, "operator");
    const all = db.getAllConfig();
    expect(all.length).toBe(2);
  });

  test("config history tracks changes", () => {
    db.setConfig("fleet", { v: 1 }, "system");
    db.setConfig("fleet", { v: 2 }, "operator");
    const history = db.getConfigHistory("fleet");
    expect(history.length).toBe(2);
    expect(history[0].new_value).toEqual({ v: 2 });
    expect(history[0].old_value).toEqual({ v: 1 });
    expect(history[1].old_value).toBeNull();
  });
});

// --- Audit Log ---

describe("audit log", () => {
  test("audit writes and retrieves entries", () => {
    db.audit({
      event_type: "machine_join",
      machine_id: "ren1",
      result: "pending",
      details: "new machine",
    });
    const entries = db.getAuditLog();
    expect(entries.length).toBe(1);
    expect(entries[0].event_type).toBe("machine_join");
    expect(entries[0].machine_id).toBe("ren1");
  });

  test("audit filters by machine_id", () => {
    db.audit({ event_type: "machine_join", machine_id: "ren1" });
    db.audit({ event_type: "machine_join", machine_id: "ren2" });
    db.audit({ event_type: "command", machine_id: "ren1" });

    const ren1 = db.getAuditLog({ machine_id: "ren1" });
    expect(ren1.length).toBe(2);
  });

  test("audit filters by event_type", () => {
    db.audit({ event_type: "command", machine_id: "ren1", action: "service.restart" });
    db.audit({ event_type: "machine_join", machine_id: "ren1" });

    const commands = db.getAuditLog({ event_type: "command" });
    expect(commands.length).toBe(1);
    expect(commands[0].action).toBe("service.restart");
  });

  test("audit respects limit", () => {
    for (let i = 0; i < 10; i++) {
      db.audit({ event_type: "command", machine_id: "ren1" });
    }
    const limited = db.getAuditLog({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  test("install tables exist and accept rows", () => {
    // Verify migration created install_sessions and install_events
    const session = db.createInstallSession({
      install_id: "test-install-1",
      target: "agent",
      os: "darwin",
      arch: "arm64",
    });
    expect(session.install_id).toBe("test-install-1");
    expect(session.status).toBe("in_progress");
    expect(session.steps_completed).toBe(0);

    const event = db.recordInstallEvent({
      install_id: "test-install-1",
      step: "download.binary",
      status: "ok",
      details: { size_bytes: 1024 },
    });
    expect(event.id).toBeGreaterThan(0);
    expect(event.step).toBe("download.binary");
    expect(event.details).toEqual({ size_bytes: 1024 });
  });

  test("audit stores command_id for correlation", () => {
    const commandId = crypto.randomUUID();
    db.audit({
      event_type: "command",
      machine_id: "ren1",
      action: "service.restart",
      command_id: commandId,
      result: "dispatched",
    });
    const entries = db.getAuditLog();
    expect(entries[0].command_id).toBe(commandId);
  });
});
