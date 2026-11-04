import { describe, it, expect } from "vitest";
import { GET } from "./route";

interface HealthResponse {
  status: string;
  timestamp: string;
}

describe("Health Check API", () => {
  it("should return 200 status with ok message", async () => {
    const response = await GET();
    const data = (await response.json()) as HealthResponse;

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("timestamp");
  });

  it("should return valid ISO timestamp", async () => {
    const response = await GET();
    const data = (await response.json()) as HealthResponse;

    const timestamp = new Date(data.timestamp);
    expect(timestamp.toString()).not.toBe("Invalid Date");
  });
});
