import { Suspense, lazy, useEffect, useRef, useState } from "react";

import type { EChartsLiteProps } from "./EChartsLite";

const LazyDashboardECharts = lazy(() => import("./EChartsLite"));
const LazyEvalECharts = lazy(() => import("./EChartsEvalLite"));

type Props = EChartsLiteProps & {
  variant?: "dashboard" | "eval";
  intersectionRootMargin?: string;
  placeholderHeight?: number;
};

export default function DeferredEChart({
  variant = "dashboard",
  intersectionRootMargin = "220px",
  placeholderHeight = 220,
  className,
  ...chartProps
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (active) return;
    if (
      typeof window === "undefined" ||
      typeof window.IntersectionObserver === "undefined"
    ) {
      return;
    }
    const node = hostRef.current;
    if (!node) return;

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: intersectionRootMargin,
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [active, intersectionRootMargin]);

  const LazyECharts = variant === "eval" ? LazyEvalECharts : LazyDashboardECharts;

  return (
    <div ref={hostRef}>
      {active ? (
        <Suspense
          fallback={
            <div
              className={className}
              style={{ minHeight: placeholderHeight }}
              aria-hidden="true"
            />
          }
        >
          <LazyECharts className={className} {...chartProps} />
        </Suspense>
      ) : (
        <div
          className={className}
          style={{ minHeight: placeholderHeight }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
