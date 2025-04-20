import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Environment variables needed:
// - UPLOAD_PASSWORD: The secret password required for uploads.
// - R2_BUCKET: Binding to the R2 bucket.
// - R2_ACCOUNT_ID: Cloudflare Account ID (used for URL construction if needed).
// - R2_PUBLIC_ORIGIN: Optional - Preferred public URL base for R2 bucket.

// Define Cloudflare platform type for R2 bindings
interface CloudflarePlatform {
	env?: {
		R2_BUCKET?: {
			put: (key: string, value: ArrayBuffer | ArrayBufferView, options?: any) => Promise<any>;
		};
	};
}

export const POST = async ({
	request,
	platform
}: RequestEvent & { platform?: CloudflarePlatform }) => {
	try {
		// --- Get Form Data (for bundled uploads) ---
		let uploadPassword = '';
		let gameName = '';
		let files = [];
		let formData;
		let filename = '';
		let relativePath = '';
		let fileData: ArrayBuffer | null = null;
		if (request.headers.get('content-type')?.includes('multipart/form-data')) {
			formData = await request.formData();
			uploadPassword = formData.get('uploadPassword')?.toString() || '';
			gameName = formData.get('gameName')?.toString() || '';
			console.log('[UPLOAD] Received from formData:', { uploadPassword, gameName });
			// Print all formData keys/values
			for (const [key, value] of formData.entries()) {
				if (value instanceof File) {
					console.log(`[UPLOAD] formData file field: ${key}, filename: ${value.name}, size: ${value.size}`);
				} else {
					console.log(`[UPLOAD] formData field: ${key} = ${value}`);
				}
			}
			// Only parse files from this formData instance
			for (const entry of formData.entries()) {
				if (entry[1] instanceof File) {
					const file = entry[1] as File;
					filename = file.name;
					fileData = await file.arrayBuffer();
					// Try to get relative path if available (Uppy may provide it as meta or field)
					relativePath = gameName; // fallback to gameName as folder
					break; // Only handle one file for now
				}
			}
		} else {
			uploadPassword = request.headers.get('x-upload-password') || '';
			gameName = request.headers.get('x-game-name') || '';
			filename = request.headers.get('x-filename') || '';
			relativePath = request.headers.get('x-relativepath') || gameName || '';
			console.log('[UPLOAD] Received from headers:', { uploadPassword, gameName, filename, relativePath });
		}

		// Print all received headers
		console.log('[UPLOAD] Received headers:', Object.fromEntries(request.headers));

		const expectedPassword = env.UPLOAD_PASSWORD;
		console.log('[UPLOAD] Expected password from env:', expectedPassword);
		console.log('[UPLOAD] Comparing received password:', uploadPassword, 'to expected:', expectedPassword);
		if (!uploadPassword || uploadPassword !== expectedPassword) {
			console.error('[UPLOAD] Password mismatch or missing. Received:', uploadPassword, 'Expected:', expectedPassword);
			return json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
		}

		// --- Get Filename ---
		// For bundled uploads, files will be in formData
		// For single uploads, use header
		if (!filename) {
			console.error('Bad request: Missing X-Filename header.');
			return new Response('Bad Request: Missing X-Filename header.', {
				status: 400
			});
		}
		if (!request.body && !fileData) {
			console.error('Bad request: No request body found.');
			return new Response('Bad Request: No file data received.', {
				status: 400
			});
		}
		if (!fileData) {
			fileData = await request.arrayBuffer();
		}

		// Sanitize filename (optional but recommended)
		const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_/]/g, '_');
		const fullPath = relativePath ? `${relativePath}/${safeFilename}` : safeFilename;

		console.log(`Received request to upload: ${fullPath}`);

		// --- Read File Data ---
		// Check if body exists
		if (!fileData) {
			console.error('Bad request: No file data found.');
			return new Response('Bad Request: No file data received.', {
				status: 400
			});
		}
		console.log(`File size: ${fileData.byteLength} bytes`);

		// --- Upload to R2 ---
		// R2 bucket is a binding that comes from platform.env, not a regular env variable
		const r2Bucket = platform?.env?.R2_BUCKET;
		if (!r2Bucket) {
			console.error('Server configuration error: R2_BUCKET binding missing.');
			return new Response('Server Error: R2 bucket not configured.', {
				status: 500
			});
		}

		console.log(`Uploading ${fullPath} to R2 bucket...`);
		await r2Bucket.put(fullPath, fileData, {
			// You can add httpMetadata here if needed, e.g., ContentType
			// httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
		});
		console.log(`Successfully uploaded ${fullPath} to R2.`);

		// --- Construct Public URL ---
		let publicUrl = '';
		// Prefer explicitly set public origin if available
		if (env.R2_PUBLIC_ORIGIN) {
			// Ensure no double slashes if origin already has trailing slash
			const origin = env.R2_PUBLIC_ORIGIN.endsWith('/')
				? env.R2_PUBLIC_ORIGIN.slice(0, -1)
				: env.R2_PUBLIC_ORIGIN;
			publicUrl = `${origin}/${fullPath}`;
		} else {
			// Fallback: Construct manually (requires R2 bucket to be publicly accessible)
			// Note: This pattern might change, using R2_PUBLIC_ORIGIN is more robust.
			const bucketName = env.R2_BUCKET_NAME; // Requires this env var too if building manually
			const accountId = env.R2_ACCOUNT_ID;
			if (bucketName && accountId) {
				publicUrl = `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${fullPath}`;
				console.warn(
					'Constructed R2 URL manually. Setting R2_PUBLIC_ORIGIN env variable is recommended.'
				);
			} else {
				console.error(
					'Server configuration error: Cannot construct public URL. Missing R2_PUBLIC_ORIGIN, R2_BUCKET_NAME, or R2_ACCOUNT_ID.'
				);
				// Return success but without a URL, or handle as error? Let's return success but log error.
				publicUrl = 'URL_Construction_Failed_Check_Logs';
			}
		}

		console.log(`Public URL: ${publicUrl}`);

		// --- Return Success Response ---
		// Extract the game name from the path (first segment)
		const gameNameFromPath = relativePath.split('/')[0];

		// For WebGL builds, if the file is index.html, return the game URL instead of the file URL
		let returnUrl = publicUrl;
		if (safeFilename === 'index.html') {
			// Construct the game URL (without the index.html)
			const gameUrl = publicUrl.replace(/\/index\.html$/, '');
			returnUrl = gameUrl;
			console.log(`Game URL (for access): ${gameUrl}`);
		}

		return json({
			url: returnUrl,
			gameName: gameNameFromPath,
			isIndexHtml: safeFilename === 'index.html'
		});
	} catch (error: any) {
		console.error('Unhandled error during upload:', error);
		// Log the stack trace if available
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		return new Response(`Internal Server Error: ${error.message || error}`, {
			status: 500
		});
	}
};

// Handle OPTIONS for CORS preflight
export const OPTIONS = async ({ request }: RequestEvent) => {
	// Handle CORS preflight requests
	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': '*', // Adjust for specific origins if needed
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'x-upload-password, x-filename, x-relativepath, Content-Type' // Allow custom headers
		}
	});
};
