import { Suspense } from "react";

import { SignInControl } from "~/app/_components/SignInControl";
import DecoderRing from "~/app/_components/decoder-ring/DecoderRing";

// The cake, drawn once for "/" and "/control/[id]". Next keeps a layout mounted across
// navigations between the pages under it, so closing a control opened from a shared
// link ("/control/AC-02" to "/") keeps the cake as it was, zoom and pan included,
// rather than swapping one page's cake for another's.
//
// DecoderRing reads filter/search state from the URL via nuqs (useSearchParams under
// the hood). Next's static prerender requires that read to sit behind a Suspense
// boundary; DecoderRing renders its own loading state once mounted, so a null fallback
// is sufficient here. `children` stays outside it, so a page's redirect or 404 is
// decided before the response starts and keeps its status.
export default function CakeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <DecoderRing headerAccessory={<SignInControl />} />
      </Suspense>
      {children}
    </>
  );
}
