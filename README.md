# Lab Game Hosting

A Svelte-based web application for uploading and hosting Unity WebGL game builds on Cloudflare Pages with R2 storage.

## Features

- Password-protected upload interface
- WebGL build validation
- Drag-and-drop file/folder upload with [Uppy](https://uppy.io/)
- Cloudflare R2 storage for game files
- Modern UI with Tailwind CSS
- TypeScript for type safety

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

This project is designed to be deployed to Cloudflare Pages with the following environment variables:

- `UPLOAD_PASSWORD`: The secret password required for uploads
- `R2_BUCKET`: Binding to the R2 bucket
- `R2_ACCOUNT_ID`: Cloudflare Account ID (used for URL construction if needed)
- `R2_PUBLIC_ORIGIN`: Optional - Preferred public URL base for R2 bucket

## How It Works

1. Users enter the upload password to access the uploader interface
2. Files/folders are validated to ensure they contain a valid Unity WebGL build
3. Files are uploaded to Cloudflare R2 storage via the `/api/upload` endpoint
4. A public URL is returned for accessing the uploaded game
