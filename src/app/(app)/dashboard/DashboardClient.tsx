"use client";

import { RevealScope, dirAware } from "@/components/landing/motion";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

export { RevealScope };

/** Index row with a direction-aware ink fill (Home "guardrails" pattern). */
export function IndexRow({ children, href }: { children: ReactNode; href?: string }) {
  const on = (e: ReactPointerEvent<HTMLElement>) => dirAware(e);
  if (href) {
    return (
      <a className="dx-row" href={href} onPointerEnter={on} onPointerLeave={on} data-reveal="up">
        {children}
      </a>
    );
  }
  return (
    <div className="dx-row" tabIndex={0} onPointerEnter={on} onPointerLeave={on} data-reveal="up">
      {children}
    </div>
  );
}
