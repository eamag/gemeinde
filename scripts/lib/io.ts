import { rm, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writes a file atomically: content goes to a temp file in the same directory
 * (same filesystem, so `rename` is atomic) and is then moved over the target.
 * A kill during the write can never leave invalid JSON behind.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
	const tempPath = join(
		dirname(filePath),
		`.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`
	);

	try {
		await writeFile(tempPath, content, 'utf8');
		await rename(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw error;
	}
}
