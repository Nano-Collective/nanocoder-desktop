import {defineConfig} from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	reporter: 'list',
	workers: 1,
	timeout: 30_000,
});
