// Environment variables provided by Cloudflare Pages:
// - UPLOAD_PASSWORD: The secret password required for uploads.
// - R2_BUCKET: Binding to the R2 bucket.
// - R2_ACCOUNT_ID: Cloudflare Account ID (used for URL construction if needed).
// - R2_PUBLIC_ORIGIN: Optional - Preferred public URL base for R2 bucket.

// Handle POST requests for the /upload route
export async function onRequestPost(context) {
  try {
    // --- Authentication ---
    const requestPassword = context.request.headers.get("x-upload-password");
    const expectedPassword = context.env.UPLOAD_PASSWORD;

    if (!requestPassword || requestPassword !== expectedPassword) {
      console.error(
        "Unauthorized upload attempt: Incorrect or missing password."
      );
      return new Response("Unauthorized: Incorrect password.", { status: 401 });
    }

    // --- Get Filename ---
    // We expect the filename in a custom header because we send raw body
    const filename = context.request.headers.get("x-filename");
    if (!filename) {
      console.error("Bad request: Missing X-Filename header.");
      return new Response("Bad Request: Missing X-Filename header.", {
        status: 400,
      });
    }

    // Sanitize filename (optional but recommended)
    // Replace potentially problematic characters. Adjust as needed.
    const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_/]/g, "_");
    console.log(`Received request to upload: ${safeFilename}`);

    // --- Read File Data ---
    // Check if body exists
    if (!context.request.body) {
      console.error("Bad request: No request body found.");
      return new Response("Bad Request: No file data received.", {
        status: 400,
      });
    }
    const fileData = await context.request.arrayBuffer();
    if (!fileData || fileData.byteLength === 0) {
      console.error("Bad request: Empty file data received.");
      return new Response("Bad Request: Empty file received.", { status: 400 });
    }
    console.log(`File size: ${fileData.byteLength} bytes`);

    // --- Upload to R2 ---
    const r2Bucket = context.env.R2_BUCKET;
    if (!r2Bucket) {
      console.error("Server configuration error: R2_BUCKET binding missing.");
      return new Response("Server Error: R2 bucket not configured.", {
        status: 500,
      });
    }

    console.log(`Uploading ${safeFilename} to R2 bucket...`);
    await r2Bucket.put(safeFilename, fileData, {
      // You can add httpMetadata here if needed, e.g., ContentType
      // httpMetadata: { contentType: context.request.headers.get('content-type') || 'application/octet-stream' },
    });
    console.log(`Successfully uploaded ${safeFilename} to R2.`);

    // --- Construct Public URL ---
    let publicUrl = "";
    // Prefer explicitly set public origin if available
    if (context.env.R2_PUBLIC_ORIGIN) {
      // Ensure no double slashes if origin already has trailing slash
      const origin = context.env.R2_PUBLIC_ORIGIN.endsWith("/")
        ? context.env.R2_PUBLIC_ORIGIN.slice(0, -1)
        : context.env.R2_PUBLIC_ORIGIN;
      publicUrl = `${origin}/${safeFilename}`;
    } else {
      // Fallback: Construct manually (requires R2 bucket to be publicly accessible)
      // Note: This pattern might change, using R2_PUBLIC_ORIGIN is more robust.
      const bucketName = context.env.R2_BUCKET_NAME; // Requires this env var too if building manually
      const accountId = context.env.R2_ACCOUNT_ID;
      if (bucketName && accountId) {
        publicUrl = `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${safeFilename}`;
        console.warn(
          "Constructed R2 URL manually. Setting R2_PUBLIC_ORIGIN env variable is recommended."
        );
      } else {
        console.error(
          "Server configuration error: Cannot construct public URL. Missing R2_PUBLIC_ORIGIN, R2_BUCKET_NAME, or R2_ACCOUNT_ID."
        );
        // Return success but without a URL, or handle as error? Let's return success but log error.
        publicUrl = "URL_Construction_Failed_Check_Logs";
      }
    }

    console.log(`Public URL: ${publicUrl}`);

    // --- Return Success Response ---
    return new Response(JSON.stringify({ url: publicUrl }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Unhandled error during upload:", error);
    // Log the stack trace if available
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return new Response(`Internal Server Error: ${error.message || error}`, {
      status: 500,
    });
  }
}

// Optional: Handle other methods if needed (e.g., OPTIONS for CORS preflight)
export async function onRequestOptions(context) {
  // Handle CORS preflight requests
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*", // Adjust for specific origins if needed
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "x-upload-password, x-filename, Content-Type", // Allow custom headers
    },
  });
}

// Optional: Default handler for other methods or root path if placed at /functions/index.js
// export async function onRequest(context) {
//    // Default response or handle GET requests differently
//    return new Response("Function endpoint is active. Use POST for uploads.", { status: 200 });
// }
