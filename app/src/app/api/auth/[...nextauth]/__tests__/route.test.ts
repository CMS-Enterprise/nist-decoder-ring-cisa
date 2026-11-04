import { describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));
vi.mock("~/server/auth", () => ({ handlers }));

import { GET, POST } from "../route";

describe("the Auth.js route handler", () => {
  it("serves GET and POST with Auth.js's own handlers", () => {
    expect(GET).toBe(handlers.GET);
    expect(POST).toBe(handlers.POST);
  });
});
