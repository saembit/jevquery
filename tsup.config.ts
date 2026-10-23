import { defineConfig } from 'tsup';

export default defineConfig({
	// The core and the two adapters as separate entries, orm packages stay external
	entry: { index: 'src/index.ts', 'adapters/drizzle': 'src/adapters/drizzle.ts', 'adapters/prisma': 'src/adapters/prisma.ts' },
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	external: ['drizzle-orm', '@prisma/client'],
});
