// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}

		// Define types for process.env (used by $env/dynamic/private)
		interface PrivateEnv {
			UPLOAD_PASSWORD?: string;
			R2_ACCOUNT_ID?: string;
			R2_ACCESS_KEY_ID?: string;
			R2_SECRET_ACCESS_KEY?: string;
			R2_BUCKET_NAME?: string;
			PUBLIC_GAME_URL_BASE?: string;
			R2_PUBLIC_ORIGIN?: string; // Keep this if it might still be used as fallback
		}

		// Augment the Platform interface (if needed for other platform context)
		// interface Platform {}
	}
}

export {};
