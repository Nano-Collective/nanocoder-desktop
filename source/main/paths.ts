import {realpath, realpathSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

export const canonicalPathSync = (file: string): string =>
	realpathSync.native(file);

export const canonicalPath = promisify(realpath.native);

// Filesystem callers use native realpath to resolve symlinks and case aliases.
export function isInside(
	child: string,
	roots: readonly string[],
	platform: NodeJS.Platform = process.platform,
): boolean {
	const flavour = platform === 'win32' ? path.win32 : path.posix;
	const normalise = (value: string) => {
		const normal = flavour.normalize(value);
		return platform === 'win32' ? normal.toLowerCase() : normal;
	};
	if (!flavour.isAbsolute(child)) return false;
	const target = normalise(child);
	return roots.some(root => {
		if (!flavour.isAbsolute(root)) return false;
		const parent = normalise(root);
		if (flavour.parse(parent).root !== flavour.parse(target).root) return false;
		const relative = flavour.relative(parent, target);
		return (
			relative !== '..' &&
			!relative.startsWith(`..${flavour.sep}`) &&
			!flavour.isAbsolute(relative)
		);
	});
}
