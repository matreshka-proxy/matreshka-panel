import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HttpApplication } from "../src/server/http";
import { JournalService } from "../src/server/services/journal";
import { database } from "./helpers";
import { seedDemo } from "../src/server/demo";

describe("typed journal", () => {
  let fixture: ReturnType<typeof database>;
  beforeEach(() => { fixture = database(); });
  afterEach(() => fixture.close());

  test("uses a clean typed schema from the first migration", () => {
    const eventColumns = fixture.db.raw.query<{ name: string }, []>("PRAGMA table_info(events)").all().map((row) => row.name);
    const deviceColumns = fixture.db.raw.query<{ name: string }, []>("PRAGMA table_info(devices)").all().map((row) => row.name);
    for (const column of ["type", "category", "kind", "severity", "outcome", "data_json", "occurred_at"]) expect(eventColumns).toContain(column);
    expect(eventColumns).not.toContain("message");
    expect(eventColumns).not.toContain("level");
    expect(deviceColumns).toContain("activated_at");
    expect(deviceColumns).not.toContain("connected_at");
    expect(fixture.db.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations").get()?.count).toBe(2);
  });

  test("links a typed event to audit details and redacts secrets", () => {
    const journal = new JournalService(fixture.db);
    const auditId = fixture.db.audit({
      actor: "owner",
      action: "people.update",
      resource: "person",
      resourceId: "person-1",
      before: { name: "Мама", password: "before-secret", clientIp: "192.0.2.4" },
      after: { name: "Мария", accessToken: "after-secret", destinationDomain: "example.test" },
    });
    journal.record("person.updated", {
      actor: "owner",
      auditId,
      subjectType: "person",
      subjectId: "person-1",
      data: { personName: "Мария", passphrase: "phrase", nested: { credentialId: "credential" } },
    });

    const event = journal.latest(1)[0]!;
    expect(event).toMatchObject({ type: "person.updated", category: "people", kind: "change", audit_id: auditId });
    expect(JSON.stringify(event)).not.toContain("before-secret");
    expect(JSON.stringify(event)).not.toContain("after-secret");
    expect(JSON.stringify(event)).not.toContain("192.0.2.4");
    expect(JSON.stringify(event)).not.toContain("example.test");
    expect(fixture.db.raw.query<{ data_json: string }, []>("SELECT data_json FROM events LIMIT 1").get()?.data_json).toBe('{"personName":"Мария","nested":{}}');
  });

  test("renders owner and subjects with human-readable labels", () => {
    const journal = new JournalService(fixture.db);
    const ownerId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    fixture.db.raw.query("INSERT INTO owners (id, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(ownerId, "Федор", "Europe/Moscow", timestamp, timestamp);
    journal.record("engine.config_applied", {
      actor: ownerId,
      source: "xray",
      subjectType: "engine",
      subjectId: "xray",
      data: { engine: "xray", version: 7 },
    });

    const event = journal.latest(1)[0]!;
    expect(event.actor?.label).toBe("Федор");
    expect(event.subject?.label).toBe("Xray");
  });

  test("filters, searches and paginates through the HTTP API", async () => {
    const app = new HttpApplication(fixture.db);
    const token = app.auth.createApiToken("tests", ["system:read"]).token;
    const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    app.journal.record("person.created", { occurredAt: future(1), data: { personName: "Мама" } });
    app.journal.record("routes.published", { occurredAt: future(2), data: { version: 4, rulesCount: 8 } });
    app.journal.record("backup.failed", { occurredAt: future(3) });
    const headers = { authorization: `Bearer ${token}` };

    const firstResponse = await app.fetch(new Request("http://localhost/api/v1/system/events?scope=all&limit=1", { headers }));
    const first = await firstResponse.json() as { events: Array<{ id: number; type: string }>; total: number; next: number | null };
    expect(first).toMatchObject({ total: 4 });
    expect(first.events[0]?.type).toBe("backup.failed");
    expect(first.next).not.toBeNull();

    const secondResponse = await app.fetch(new Request(`http://localhost/api/v1/system/events?scope=all&limit=1&before=${first.next}`, { headers }));
    const second = await secondResponse.json() as typeof first;
    expect(second.events[0]?.type).toBe("routes.published");

    const errorsResponse = await app.fetch(new Request("http://localhost/api/v1/system/events?scope=errors", { headers }));
    const errors = await errorsResponse.json() as typeof first;
    expect(errors.events.map((event) => event.type)).toEqual(["backup.failed"]);

    const searchResponse = await app.fetch(new Request("http://localhost/api/v1/system/events?category=routes&q=%D1%80%D0%B5%D0%B2%D0%B8%D0%B7%D0%B8%D1%8F", { headers }));
    const search = await searchResponse.json() as typeof first;
    expect(search.events.map((event) => event.type)).toEqual(["routes.published"]);

    app.journal.record("backup.created");
    app.journal.record("system.disk_warning");
    const systemResponse = await app.fetch(new Request("http://localhost/api/v1/system/events?category=system,maintenance", { headers }));
    const system = await systemResponse.json() as typeof first;
    expect(system.events.map((event) => event.type).sort()).toEqual(["backup.created", "backup.failed", "system.disk_warning"]);
  });

  test("demo data is served as typed events and real presence rows", async () => {
    const app = new HttpApplication(fixture.db, {
      async add() { return { ok: true }; },
      async revoke() { return { ok: true }; },
    });
    await seedDemo(app);
    expect(app.journal.list({ q: "Резервная копия создана" }).events[0]?.type).toBe("backup.created");
    expect(fixture.db.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM device_presence").get()?.count).toBeGreaterThan(0);
    expect(app.people.list().flatMap((person) => person.devices).every((device) => Boolean(device.presence))).toBeTrue();
  }, 15_000);
});
