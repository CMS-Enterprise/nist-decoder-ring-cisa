import { type Metadata } from "next";
import { Suspense } from "react";

import ExportPage from "../_components/export/ExportPage";
import { product } from "~/config/product";

export const metadata: Metadata = {
  title: `Export · ${product.metadataTitle}`,
};

// The page reads its selection from the URL through nuqs, which needs a Suspense boundary
// for Next's static prerender, as on the home page.
export default function Export() {
  return (
    <Suspense fallback={null}>
      <ExportPage />
    </Suspense>
  );
}
