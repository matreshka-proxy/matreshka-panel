import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAgent } from "../src/server/services/operations";

describe("root-agent transport", () => {
  test("keeps the socket readable until a delayed response arrives", async () => {
    const directory = await mkdtemp(join(tmpdir(), "matreshka-agent-"));
    const socketPath = join(directory, "agent.sock");
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      let request = "";
      socket.on("data", (chunk) => {
        request += chunk.toString("utf8");
        if (request.endsWith("\n")) setTimeout(() => socket.end('{"ok":true,"output":"done"}\n'), 20);
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      const response = await callAgent({ action: "nginx.reload", payload: {} }, socketPath);
      expect(response).toMatchObject({ ok: true, output: "done" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
