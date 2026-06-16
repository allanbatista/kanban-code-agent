import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navbar } from '@/components/layout/Navbar';
import { AnimatedGradientBackground } from '@/components/background/AnimatedGradientBackground';

export function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-transparent text-foreground antialiased">
        <AnimatedGradientBackground />
        <Navbar />
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
