import { FixtureAgentDriver } from "../src/agent";
import type { GenerateRequest, ImproveRequest } from "../src/types";

const input = await new Response(Bun.stdin).text();
const request = JSON.parse(input) as { kind: "generate" | "improve" } & Record<string, unknown>;
const driver = new FixtureAgentDriver();
const response = request.kind === "generate"
  ? await driver.generate(request as GenerateRequest)
  : await driver.improve(request as ImproveRequest);

console.log(JSON.stringify(response));
