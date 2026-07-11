import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Suite geral: arquivos rodam em paralelo (comportamento padrao).
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: ["src/__tests__/validation/**"],
        },
      },
      {
        // ponytail: os live tests de validation disputam o mesmo recurso (pi-docker)
        // e flakam 1-em-4 quando rodam em paralelo entre si; fileParallelism false
        // serializa os arquivos desta pasta.
        test: {
          name: "validation",
          include: ["src/__tests__/validation/**/*.test.ts", "src/__tests__/validation/**/*.spec.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
