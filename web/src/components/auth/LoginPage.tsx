import { useSearchParams } from 'react-router-dom';
import { Github, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const login = useAuthStore((s) => s.login);

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Github className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle>Kanban Code Agent</CardTitle>
          <CardDescription>Faça login para gerenciar suas tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button
            variant="default"
            size="lg"
            className="w-full gap-2"
            onClick={() => login('github')}
          >
            <Github className="h-5 w-5" />
            Entrar com GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
