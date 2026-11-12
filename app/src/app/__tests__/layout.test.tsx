/**
 * The root layout puts the theme script in <head>, ahead of the body, so a stored theme
 * is applied before the page paints.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist" }),
}));
vi.mock("nuqs/adapters/next/app", () => ({
  NuqsAdapter: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/trpc/react", () => ({
  TRPCReactProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import RootLayout from "../layout";
import { themeScript } from "~/app/_components/theme/theme";

describe("RootLayout", () => {
  it("runs the theme script in <head>, before the body", () => {
    const html = renderToStaticMarkup(
      <RootLayout modal={null}>
        <main>page</main>
      </RootLayout>,
    );
    const head = html.slice(0, html.indexOf("<body"));
    expect(head).toContain(`<script>${themeScript}</script>`);
  });
});
