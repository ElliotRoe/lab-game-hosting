import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { PUBLIC_GAME_URL_BASE } from '$env/static/public';
import { PutObjectCommand } from '@aws-sdk/client-s3'; // S3Client is imported from lib now
import { Buffer } from 'buffer'; // Need Buffer for S3 Body
import AdmZip from 'adm-zip'; // Import AdmZip
import { lookup } from 'mime-types'; // Import mime-types lookup
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
		const fileData = await zipFile.arrayBuffer();
		const buffer = Buffer.from(fileData);

		// --- Process Zip and Upload to R2 ---
		const zip = new AdmZip(buffer);
		const zipEntries = zip.getEntries();
		const uploadPromises: Promise<any>[] = [];

		// Filter out directories and macOS resource forks to analyze structure
		const relevantEntries = zipEntries.filter(
			(entry) =>
				!entry.isDirectory &&
				!entry.entryName.startsWith('__MACOSX/') &&
				!/\/\._/.test(entry.entryName) && // Files starting with ._ within subdirs
				!entry.entryName.startsWith('._') // Files starting with ._ at root
		);

		if (relevantEntries.length === 0) {
			console.warn(
				`[UPLOAD] Zip file ${zipFile.name} contained no relevant files after filtering.`
			);
			return json({ error: 'Invalid zip file: Contains no usable files.' }, { status: 400 });
		}

		// Determine common root path prefix
		let commonPathPrefix = '';
		const firstPath = relevantEntries[0].entryName;
		const firstSlashIndex = firstPath.indexOf('/');
		if (firstSlashIndex > 0) {
			const potentialPrefix = firstPath.substring(0, firstSlashIndex + 1);
			if (relevantEntries.every((entry) => entry.entryName.startsWith(potentialPrefix))) {
				commonPathPrefix = potentialPrefix;
				console.log(`[UPLOAD] Detected common root folder in zip: ${commonPathPrefix}`);
			}
		}

		let entryCount = 0;
		let foundRootIndexHtml = false;

		console.log(
			`[UPLOAD] Extracting ${zipEntries.length} entries from ${zipFile.name}` +
				(commonPathPrefix ? ` (stripping prefix '${commonPathPrefix}')` : '') +
				'...'
		);

		for (const entry of zipEntries) {
			// Skip directories and macOS specific files
			if (
				entry.isDirectory ||
				entry.entryName.startsWith('__MACOSX/') ||
				/\/\._/.test(entry.entryName) ||
				entry.entryName.startsWith('._')
			) {
				continue;
			}

			entryCount++;
			let relativePath = entry.entryName;
			if (commonPathPrefix && relativePath.startsWith(commonPathPrefix)) {
				relativePath = relativePath.substring(commonPathPrefix.length);
			}

			// Skip if relative path is now empty (e.g., it was just the common prefix folder itself)
			if (!relativePath) {
				entryCount--; // Don't count this as an uploaded file
				continue;
			}

			// Sanitize entry path just in case, although AdmZip usually handles this well
			const safeEntryPath = relativePath.replace(/\.\./g, ''); // Basic path traversal prevention
			const fullPath = `${safeGameName}/${safeEntryPath}`;
			const entryData = entry.getData(); // Gets entry data as a Buffer

			// Determine Content-Type
			const contentType = lookup(relativePath) || 'application/octet-stream';

			// Check if this is the index.html at the *effective* root
			if (relativePath.toLowerCase() === 'index.html') {
				foundRootIndexHtml = true;
			}

			console.log(`[UPLOAD] -> Uploading ${fullPath}`);
			const putCommand = new PutObjectCommand({
				Bucket: bucketName,
				Key: fullPath,
				Body: entryData,
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
		// Check for AdmZip specific errors if needed
		if (error.code === 'ERR_BAD_ARCHIVE') {
			return json(
				{ error: 'Failed to process zip file. It might be corrupted or invalid.' },
				{ status: 400 }
			);
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
