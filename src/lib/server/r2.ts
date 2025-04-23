import { S3Client } from '@aws-sdk/client-s3';
import { env } from '$env/dynamic/private';

// Validate essential environment variables
if (!env.R2_ACCOUNT_ID) {
	throw new Error('Missing required environment variable: R2_ACCOUNT_ID');
}
if (!env.R2_ACCESS_KEY_ID) {
	throw new Error('Missing required environment variable: R2_ACCESS_KEY_ID');
}
if (!env.R2_SECRET_ACCESS_KEY) {
	throw new Error('Missing required environment variable: R2_SECRET_ACCESS_KEY');
}
// Optional: Add check for R2_BUCKET_NAME if it's always needed by consumers
// if (!env.R2_BUCKET_NAME) {
// 	throw new Error('Missing required environment variable: R2_BUCKET_NAME');
// }

const R2_ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Initialize S3 Client for R2 - Singleton instance
const s3Client = new S3Client({
	region: 'auto',
	endpoint: R2_ENDPOINT,
	credentials: {
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY
	}
});

// Export the initialized client
export { s3Client };

// Optionally export bucket name if needed frequently
export const R2_BUCKET_NAME = env.R2_BUCKET_NAME;
