# Lab Game Hosting

A Svelte-based web application for uploading and hosting Unity WebGL game builds on Cloudflare Pages with R2 storage.

## Features

- Password-protected upload interface
- WebGL build validation
- Drag-and-drop file/folder upload with [Uppy](https://uppy.io/)
- Cloudflare R2 storage for game files
- Modern UI with Tailwind CSS
- TypeScript for type safety

## Project Structure

- `src/` - SvelteKit frontend application
- `modal/` - Modal serverless backend functions
  - Handles large file uploads (up to 4GB)
  - Processes and stores game files in Cloudflare R2
  - See `modal/README.md` for setup instructions

## Development

### Frontend (SvelteKit)

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

### Backend (Modal)

```bash
cd modal
pip install modal
modal serve upload.py
```

See `modal/README.md` for complete Modal setup instructions.

## Deployment

### Frontend

Deploy to Cloudflare Pages as usual.

### Backend

Deploy the Modal functions:

```bash
cd modal
modal deploy upload.py
```

Update the frontend environment variables to point to your Modal endpoint.

## How It Works

1. Users enter the upload password to access the uploader interface
2. Files/folders are validated to ensure they contain a valid Unity WebGL build
3. Files are uploaded to Cloudflare R2 storage via the `/api/upload` endpoint
4. A public URL is returned for accessing the uploaded game
