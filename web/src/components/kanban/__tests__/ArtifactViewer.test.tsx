import { describe, expect, it } from 'vitest';
import { artifactRenderKind } from '../ArtifactViewer';
import type { Artifact } from '@/types/task';

function artifact(file_type: string, path: string): Artifact {
  return { description: 'artifact', file_type, path, sizeBytes: 1 };
}

describe('ArtifactViewer', () => {
  it('classifies renderable artifacts', () => {
    expect(artifactRenderKind(artifact('markdown', '/artifacts/spec.md'))).toBe('markdown');
    expect(artifactRenderKind(artifact('typescript', '/artifacts/index.ts'))).toBe('text');
    expect(artifactRenderKind(artifact('png', '/artifacts/chart.png'))).toBe('image');
    expect(artifactRenderKind(artifact('pdf', '/artifacts/report.pdf'))).toBe('pdf');
    expect(artifactRenderKind(artifact('zip', '/artifacts/out.zip'))).toBe('download');
  });
});
