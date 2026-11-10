"use client";

import { useEffect, useRef, useState } from "react";

const RESPONSE = 0.4; // seconds, critically damped
const SETTLE = 0.6;

const toNear = (yocto: string) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;
const format = (n: number) => n.toFixed(3).replace(/\.?0+$/, "") || "0";

/**
 * Shows a NEAR amount that springs to each new value. The first render shows
 * the value as is, and every change starts from what is on screen, so a new
 * value mid-count redirects smoothly instead of jumping.
 */
export function CountUp({ yocto }: { yocto: string }) {
  const target = toNear(yocto);
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const start = current.current;
    if (start === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setShown(target);
      return;
    }
    const w = (2 * Math.PI) / RESPONSE;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      const x = t >= SETTLE ? 1 : 1 - (1 + w * t) * Math.exp(-w * t);
      current.current = start + (target - start) * x;
      setShown(current.current);
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return <>{format(shown)}</>;
}
