import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { PUBLIC_GAME_URL_BASE } from '$env/static/public';
import { PutObjectCommand } from '@aws-sdk/client-s3'; // S3Client is imported from lib now
// Buffer no longer needed for fflate/S3 Body
// import { Buffer } from 'buffer';
import { unzipSync } from 'fflate'; // Import fflate unzipSync
// import { lookup } from 'mime-types'; // No longer using mime-types
import { s3Client, R2_BUCKET_NAME } from '$lib/server/r2'; // Import shared client

// Environment variables needed:
// - UPLOAD_PASSWORD: The secret password required for uploads.
// - R2_ACCOUNT_ID: Cloudflare Account ID.
// - R2_ACCESS_KEY_ID: R2 Access Key ID.
// - R2_SECRET_ACCESS_KEY: R2 Secret Access Key.
// - R2_BUCKET_NAME: Name of the R2 bucket.
// - PUBLIC_GAME_URL_BASE: Required - Public URL base for accessing games.
// - R2_PUBLIC_ORIGIN: (No longer primary) Optional fallback or alternative base.

// Validate required environment variables for S3
if (
	!env.R2_ACCOUNT_ID ||
	!env.R2_ACCESS_KEY_ID ||
	!env.R2_SECRET_ACCESS_KEY ||
	!env.R2_BUCKET_NAME ||
	!PUBLIC_GAME_URL_BASE
) {
	throw new Error(
		'Missing required R2 environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, PUBLIC_GAME_URL_BASE'
	);
}

// Use the imported bucket name
const bucketName = R2_BUCKET_NAME;
if (!bucketName) {
	// If R2_BUCKET_NAME check wasn't done in r2.ts, do it here or handle error
	throw new Error('Missing required environment variable: R2_BUCKET_NAME');
}

// --- Helper Function for Content Type ---
function getContentType(filename: string): string {
	const lowerFilename = filename.toLowerCase();
	if (lowerFilename.endsWith('.html')) return 'text/html';
	if (lowerFilename.endsWith('.css')) return 'text/css';
	if (lowerFilename.endsWith('.js')) return 'application/javascript';
	if (lowerFilename.endsWith('.json')) return 'application/json';
	if (lowerFilename.endsWith('.wasm')) return 'application/wasm';
	if (lowerFilename.endsWith('.data')) return 'application/octet-stream'; // Common for Unity data files
	if (lowerFilename.endsWith('.unityweb')) return 'application/octet-stream'; // Unity binary format
	if (lowerFilename.endsWith('.png')) return 'image/png';
	if (lowerFilename.endsWith('.jpg') || lowerFilename.endsWith('.jpeg')) return 'image/jpeg';
	if (lowerFilename.endsWith('.svg')) return 'image/svg+xml';
	if (lowerFilename.endsWith('.gif')) return 'image/gif';
	if (lowerFilename.endsWith('.ico')) return 'image/x-icon';
	// Add more types as needed
	return 'application/octet-stream'; // Default
}

export const POST = async ({ request }: RequestEvent) => {
	try {
		// --- Authentication & Basic Checks ---
		let uploadPassword = '';
		let gameName = '';
		let zipFile: File | null = null;

		// Only accept multipart/form-data
		if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
			console.error('[UPLOAD] Invalid Content-Type. Expected multipart/form-data.');
			return json(
				{ error: 'Invalid request type. Expected multipart/form-data.' },
				{ status: 415 }
			);
		}

		const formData = await request.formData();
		uploadPassword = formData.get('uploadPassword')?.toString() || '';
		gameName = formData.get('gameName')?.toString() || ''; // Expect gameName in form data

		// Password Check
		const expectedPassword = env.UPLOAD_PASSWORD;
		if (!uploadPassword || uploadPassword !== expectedPassword) {
			console.error('[UPLOAD] Password mismatch or missing.');
			return json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
		}

		// Game Name Check
		if (!gameName) {
			console.error('[UPLOAD] Bad Request: Missing gameName field in FormData.');
			return json({ error: 'Bad Request: Missing gameName field.' }, { status: 400 });
		}
		// Basic sanitization for gameName to use in paths
		const safeGameName = gameName.replace(/[^a-zA-Z0-9-_]/g, '_');

		// --- Get Zip File ---
		// Expect the zip file in a field named 'gameZip'
		const fileEntry = formData.get('gameZip');
		if (!fileEntry || !(fileEntry instanceof File)) {
			console.error('[UPLOAD] Bad Request: Missing or invalid gameZip file field in FormData.');
			return json({ error: 'Bad Request: Missing gameZip file field.' }, { status: 400 });
		}
		zipFile = fileEntry;

		// --- Validate File Type (Basic Check) ---
		if (
			!zipFile.name.toLowerCase().endsWith('.zip') &&
			zipFile.type !== 'application/zip' &&
			zipFile.type !== 'application/x-zip-compressed'
		) {
			console.warn(`[UPLOAD] Received non-zip file: ${zipFile.name} (${zipFile.type})`);
			return json({ error: 'Invalid file type. Please upload a .zip file.' }, { status: 400 });
		}

		console.log(
			`[UPLOAD] Received zip file: ${zipFile.name}, Size: ${zipFile.size}, Target Game: ${safeGameName}`
		);

		// --- Read Zip Data ---
		// Use Uint8Array which is compatible with fflate and S3 Body
		const zipData = new Uint8Array(await zipFile.arrayBuffer());
		// const buffer = Buffer.from(fileData); // No longer needed

		// --- Process Zip and Upload to R2 ---
		let unzipped: Record<string, Uint8Array>;
		try {
			unzipped = unzipSync(zipData);
		} catch (err: any) {
			console.error('[UPLOAD] Failed to unzip file:', err);
			return json({ error: `Failed to process zip file: ${err.message}` }, { status: 400 });
		}

		const uploadPromises: Promise<any>[] = [];
		const relevantEntries: { path: string; data: Uint8Array }[] = [];

		// Filter out directories and macOS resource forks
		for (const entryPath in unzipped) {
			// fflate uses paths ending in / for directories
			if (
				entryPath.endsWith('/') ||
				entryPath.startsWith('__MACOSX/') ||
				/\/\._/.test(entryPath) || // Files starting with ._ within subdirs
				entryPath.startsWith('._') // Files starting with ._ at root
			) {
				continue;
			}
			relevantEntries.push({ path: entryPath, data: unzipped[entryPath] });
		}

		if (relevantEntries.length === 0) {
			console.warn(
				`[UPLOAD] Zip file ${zipFile.name} contained no relevant files after filtering.`
			);
			return json({ error: 'Invalid zip file: Contains no usable files.' }, { status: 400 });
		}

		// Determine common root path prefix
		let commonPathPrefix = '';
		const firstPath = relevantEntries[0].path;
		const firstSlashIndex = firstPath.indexOf('/');
		if (firstSlashIndex > 0) {
			const potentialPrefix = firstPath.substring(0, firstSlashIndex + 1);
			if (relevantEntries.every((entry) => entry.path.startsWith(potentialPrefix))) {
				commonPathPrefix = potentialPrefix;
				console.log(`[UPLOAD] Detected common root folder in zip: ${commonPathPrefix}`);
			}
		}

		let entryCount = 0;
		let foundRootIndexHtml = false;

		console.log(
			`[UPLOAD] Extracting ${Object.keys(unzipped).length} entries from ${zipFile.name}` + // Use Object.keys(unzipped).length for total
				(commonPathPrefix ? ` (stripping prefix '${commonPathPrefix}')` : '') +
				'...'
		);

		// Iterate through the filtered entries from fflate's output
		for (const entry of relevantEntries) {
			entryCount++;
			let relativePath = entry.path;
			if (commonPathPrefix && relativePath.startsWith(commonPathPrefix)) {
				relativePath = relativePath.substring(commonPathPrefix.length);
			}

			// Skip if relative path is now empty
			if (!relativePath) {
				entryCount--;
				continue;
			}

			// Sanitize entry path
			const safeEntryPath = relativePath.replace(/\.\./g, '_'); // Basic path traversal prevention
			const fullPath = `${safeGameName}/${safeEntryPath}`;
			const entryData = entry.data; // Already a Uint8Array

			// Determine Content-Type using the helper function
			const contentType = getContentType(relativePath);

			// Check if this is the index.html at the *effective* root
			if (relativePath.toLowerCase() === 'index.html') {
				foundRootIndexHtml = true;
			}

			console.log(`[UPLOAD] -> Uploading ${fullPath}`);
			const putCommand = new PutObjectCommand({
				Bucket: bucketName,
				Key: fullPath,
				Body: entryData, // Pass Uint8Array directly
				ContentType: contentType
			});
			uploadPromises.push(s3Client.send(putCommand));
		}

		if (entryCount === 0) {
			console.warn(
				`[UPLOAD] Zip file ${zipFile.name} contained no files to upload after filtering.`
			);
			return json({ error: 'Invalid zip file: Contains no files to upload.' }, { status: 400 });
		}

		// Check if index.html was found at the root
		if (!foundRootIndexHtml) {
			console.error(
				`[UPLOAD] Error: No index.html found at the root level of the zip for game '${safeGameName}'${commonPathPrefix ? ` (after unwrapping folder '${commonPathPrefix}')` : ''}.`
			);
			return json(
				{
					error:
						'Invalid zip structure: index.html not found at the root level after potential unwrapping.'
				},
				{ status: 400 }
			);
		}

		// Wait for all uploads to complete
		await Promise.all(uploadPromises);
		console.log(
			`[UPLOAD] Successfully extracted and uploaded ${entryCount} files for game ${safeGameName}.`
		);

		// --- Construct Public URL for the Game Root ---
		let gameUrl = '';
		if (PUBLIC_GAME_URL_BASE) {
			// Ensure no double slashes if base already has trailing slash
			const base = PUBLIC_GAME_URL_BASE.endsWith('/')
				? PUBLIC_GAME_URL_BASE.slice(0, -1)
				: PUBLIC_GAME_URL_BASE;
			gameUrl = `${base}/${safeGameName}/`; // URL to the game's root directory
			// We already validated index.html exists, so this URL should work.
		} // Optional: Add fallback logic here if needed, e.g., check R2_PUBLIC_ORIGIN
		// else if (env.R2_PUBLIC_ORIGIN) { ... }
		else {
			// Since we validated PUBLIC_GAME_URL_BASE at startup, this block shouldn't be reached.
			// If it were possible to reach here, handle the error.
			console.error(
				'Server configuration error: PUBLIC_GAME_URL_BASE is missing, cannot construct game URL.'
			);
			gameUrl = 'URL_Construction_Failed_Check_Logs';
		}

		console.log(`[UPLOAD] Game URL: ${gameUrl}`);

		// --- Return Success Response ---
		return json({
			message: `Successfully uploaded and extracted game '${safeGameName}'.`,
			gameName: safeGameName,
			gameUrl: gameUrl,
			isIndexHtml: foundRootIndexHtml,
			uploadedFiles: entryCount
		});
	} catch (error: any) {
		console.error('[UPLOAD] Unhandled error during zip upload:', error);
		// Log the stack trace if available
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		return json({ error: `Internal Server Error: ${error.message || error}` }, { status: 500 });
	}
};

// Handle OPTIONS for CORS preflight
export const OPTIONS = async ({ request }: RequestEvent) => {
	// Handle CORS preflight requests
	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': '*', // Adjust for specific origins if needed
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			// Adjust allowed headers if form field names changed (e.g., remove x-filename)
			'Access-Control-Allow-Headers': 'x-upload-password, Content-Type'
		}
	});
};
