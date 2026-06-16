import { useAnimatedGradient } from '@/hooks/useAnimatedGradient';

const layerGradients = [
  [
    'radial-gradient(circle at 18% 25%, rgba(124, 58, 237, 0.24), transparent 38%)',
    'radial-gradient(circle at 82% 20%, rgba(37, 99, 235, 0.2), transparent 40%)',
    'radial-gradient(circle at 60% 82%, rgba(6, 182, 212, 0.14), transparent 36%)',
    'radial-gradient(circle at 28% 74%, rgba(236, 72, 153, 0.16), transparent 42%)',
  ],
  [
    'radial-gradient(circle at 72% 28%, rgba(37, 99, 235, 0.22), transparent 40%)',
    'radial-gradient(circle at 12% 62%, rgba(124, 58, 237, 0.18), transparent 38%)',
    'radial-gradient(circle at 46% 88%, rgba(249, 115, 22, 0.1), transparent 36%)',
    'radial-gradient(circle at 88% 46%, rgba(6, 182, 212, 0.14), transparent 42%)',
  ],
  [
    'radial-gradient(circle at 38% 42%, rgba(6, 182, 212, 0.18), transparent 40%)',
    'radial-gradient(circle at 64% 14%, rgba(236, 72, 153, 0.14), transparent 38%)',
    'radial-gradient(circle at 14% 78%, rgba(124, 58, 237, 0.2), transparent 42%)',
    'radial-gradient(circle at 76% 64%, rgba(37, 99, 235, 0.14), transparent 36%)',
  ],
  [
    'radial-gradient(circle at 44% 16%, rgba(236, 72, 153, 0.18), transparent 40%)',
    'radial-gradient(circle at 86% 54%, rgba(124, 58, 237, 0.16), transparent 38%)',
    'radial-gradient(circle at 22% 68%, rgba(37, 99, 235, 0.14), transparent 42%)',
    'radial-gradient(circle at 54% 90%, rgba(249, 115, 22, 0.1), transparent 36%)',
  ],
];

const animations = [
  'driftOne 11s ease-in-out infinite',
  'driftTwo 14s ease-in-out infinite',
  'driftThree 12s ease-in-out infinite',
  'driftFour 16s ease-in-out infinite',
];

export function AnimatedGradientBackground() {
  const { x, y } = useAnimatedGradient();

  return (
    <div
      className="background"
      style={{
        ['--mouse-x' as string]: `${x}%`,
        ['--mouse-y' as string]: `${y}%`,
      }}
    >
      {layerGradients.map((gradients, i) => (
        <div
          key={i}
          className="bg-gradient-layer"
          style={{
            background: gradients.join(', '),
            animation: animations[i],
          }}
        />
      ))}
      <div className="bg-vignette" />
      <div className="bg-grain" />
    </div>
  );
}
