export default {
	extensions: ['ts'],
	nodeArguments: ['--import=tsx', '--no-warnings'],
	files: ['source/**/*.acp.ts'],
	workerThreads: false,
	serial: true,
	environmentVariables: {
		NODE_ENV: 'test',
	},
};
