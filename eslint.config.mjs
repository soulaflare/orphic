import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    // js/ is the dependency-free classic-script renderer — out of scope here;
    // .claude/ holds agent tooling that isn't part of the app
    ignores: ['node_modules/**', 'out/**', 'release/**', 'js/**', '**/*.d.ts', '.claude/**'],
  },
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
