import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navbar } from '@/components/layout/Navbar';

export function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-transparent text-foreground antialiased">
        <Navbar />
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
