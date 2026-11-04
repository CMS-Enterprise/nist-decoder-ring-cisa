import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { NuqsAdapter } from "nuqs/adapters/next/app";

import { TRPCReactProvider } from "~/trpc/react";
import { product } from "~/config/product";

export const metadata: Metadata = {
  title: product.metadataTitle,
  description: product.metadataDescription,
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

// `modal` is the @modal parallel route: an in-app open of /control/[id] renders the
// control's modal there, over the cake that the (cake) layout draws in `children`, which
// stays mounted.
export default function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>
        <NuqsAdapter>
          <TRPCReactProvider>
            {children}
            {modal}
          </TRPCReactProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
