# Modal Game Upload Function

This directory contains a Modal application that handles game uploads to Cloudflare R2. It replaces the SvelteKit server endpoint while maintaining the same functionality.

## Setup

1. Install Modal:

```bash
pip install modal
```

2. Log in to Modal:

```bash
modal token new
```

3. Create a Modal secret for R2 credentials:

```bash
modal secret create r2-credentials \
  --env R2_ACCOUNT_ID=your_account_id \
  --env R2_ACCESS_KEY_ID=your_access_key \
  --env R2_SECRET_ACCESS_KEY=your_secret_key \
  --env R2_BUCKET_NAME=your_bucket_name \
  --env UPLOAD_PASSWORD=your_upload_password \
  --env PUBLIC_GAME_URL_BASE=your_public_url
```

## Deployment

Deploy the application:

```bash
modal deploy modal/upload.py
```

The function will be available at the URL provided by Modal after deployment.

## Usage

Update your frontend code to point to the new Modal endpoint. The API remains the same:

```typescript
// Example frontend code
const response = await fetch('your_modal_endpoint', {
	method: 'POST',
	body: formData // Contains uploadPassword, gameName, and gameZip
});
```

## Benefits

- No CPU time limits (Modal has much more generous limits than Cloudflare Workers)
- Handles large files (up to 4GB)
- Pay only for actual compute time used
- Automatic scaling
- Keeps your code in the same repo

## Development

For local testing:

```bash
modal serve modal/upload.py
```

## Environment Variables

Make sure these are set in your Modal secret:

- `R2_ACCOUNT_ID`: Your Cloudflare account ID
- `R2_ACCESS_KEY_ID`: R2 access key
- `R2_SECRET_ACCESS_KEY`: R2 secret key
- `R2_BUCKET_NAME`: R2 bucket name
- `UPLOAD_PASSWORD`: Upload authentication password
- `PUBLIC_GAME_URL_BASE`: Public URL base for accessing games
