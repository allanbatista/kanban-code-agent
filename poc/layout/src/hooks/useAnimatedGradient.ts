import { useState, useRef, useEffect } from 'react';

export interface AnimatedGradientState {
  x: number;
  y: number;
}

export function useAnimatedGradient(lerpFactor = 0.055): AnimatedGradientState {
  const targetRef = useRef({ x: 50, y: 50 });
  const currentRef = useRef({ x: 50, y: 50 });
  const rafRef = useRef<number>(0);
  const [value, setValue] = useState<AnimatedGradientState>({ x: 50, y: 50 });

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      targetRef.current = {
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
    };

    window.addEventListener('pointermove', onPointerMove);

    const animate = () => {
      const current = currentRef.current;
      const target = targetRef.current;

      current.x += (target.x - current.x) * lerpFactor;
      current.y += (target.y - current.y) * lerpFactor;

      setValue({ x: current.x, y: current.y });
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [lerpFactor]);

  return value;
}
