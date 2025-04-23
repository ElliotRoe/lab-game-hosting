import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Client, R2_BUCKET_NAME } from '$lib/server/r2';

// Ensure the bucket name is available (it should be, due to check in r2.ts or upload.ts)
if (!R2_BUCKET_NAME) {
	throw new Error('Configuration error: R2_BUCKET_NAME is not available.');
}

export const POST: RequestHandler = async ({ request }) => {
	let gameName: string;

	try {
		const body = await request.json();
		gameName = body.gameName;

		if (!gameName || typeof gameName !== 'string') {
			return json({ exists: false, message: 'Invalid game name provided.' }, { status: 400 });
		}

		// Basic validation check (should match frontend)
		if (!/^[a-zA-Z0-9-_]+$/.test(gameName)) {
			return json(
				{ exists: false, message: 'Game name contains invalid characters.' },
				{ status: 400 }
			);
		}
	} catch (error) {
		console.error('Error parsing request body for game name check:', error);
		return json({ exists: false, message: 'Invalid request format.' }, { status: 400 });
	}

	// Check if any object exists with the gameName as a prefix in R2
	try {
		const listParams = {
			Bucket: R2_BUCKET_NAME,
			Prefix: `${gameName}/`,
			MaxKeys: 1
		};

		const listCommand = new ListObjectsV2Command(listParams);
		const listResult = await s3Client.send(listCommand);

		// If KeyCount is greater than 0, it means objects exist under this prefix
		const gameExists = (listResult.KeyCount ?? 0) > 0;

		return json({ exists: gameExists });
	} catch (error: any) {
		console.error(`Error checking R2 prefix existence for ${gameName}:`, error);
		// Avoid exposing internal error details unless necessary
		return json(
			{ exists: false, message: 'Server error checking game name availability.' },
			{ status: 500 }
		);
	}
};
