import { useEffect, useRef } from "react";

/**
 * A burst of confetti, fired by bumping `trigger`.
 *
 * Hand-rolled on a canvas — a dependency for eight seconds of celebration a
 * year would be a poor trade, and the whole of it is a hundred lines of
 * gravity.
 *
 * The canvas covers the window and ignores the pointer, so the app underneath
 * stays usable while it falls: the point is to notice the worklog landed, not
 * to wait for an animation.
 */
export default function Confetti({
  trigger,
  pieces = 90,
}: {
  trigger: number;
  /** How much of it — see `confettiFor` in App. */
  pieces?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Nothing on mount — only on a real burst.
    if (trigger === 0) return;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    // Somebody who has asked for less motion has asked for less motion.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    el.width = width * dpr;
    el.height = height * dpr;
    ctx.scale(dpr, dpr);

    const confetti = Array.from({ length: Math.max(1, pieces) }, () => ({
      // Thrown from the middle of the top edge, as if something popped.
      x: width * (0.35 + Math.random() * 0.3),
      y: height * 0.25 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * -9 - 3,
      size: 4 + Math.random() * 5,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      hue: Math.floor(Math.random() * 360),
    }));

    let frame = 0;
    let raf = 0;
    const DURATION = 110; // frames — a little under two seconds at 60fps

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      // Fades out over the last third rather than vanishing mid-air.
      const fade = Math.min(1, ((DURATION - frame) / DURATION) * 3);
      for (const p of confetti) {
        p.vy += 0.28; // gravity
        p.vx *= 0.99; // air
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = fade;
        ctx.fillStyle = `hsl(${p.hue} 90% 60%)`;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      frame += 1;
      if (frame < DURATION) {
        raf = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, width, height);
    };
    // `pieces` is read at the moment of a burst; changing it alone must not
    // fire one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
