import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Endpoint to validate the upload password
export const POST = async ({ request }: RequestEvent) => {
  try {
    // Get the password from the request body
    const data = await request.json();
    const password = data.password;

    if (!password) {
      return json({ valid: false, message: 'Password is required' }, { status: 400 });
    }

    // Get the expected password from environment variables
    const expectedPassword = env.UPLOAD_PASSWORD;

    if (!expectedPassword) {
      console.error('Server configuration error: UPLOAD_PASSWORD environment variable not set');
      return json(
        { valid: false, message: 'Server configuration error: Password not configured' },
        { status: 500 }
      );
    }

    // Validate the password
    const isValid = password === expectedPassword;

    if (isValid) {
      console.log('Password validation successful');
      return json({ valid: true, message: 'Password is valid' });
    } else {
      console.log('Password validation failed: Incorrect password');
      return json({ valid: false, message: 'Incorrect password' }, { status: 401 });
    }
  } catch (error: any) {
    console.error('Error validating password:', error);
    return json(
      { valid: false, message: `Error validating password: ${error.message || error}` },
      { status: 500 }
    );
  }
};

// Handle OPTIONS for CORS preflight
export const OPTIONS = async () => {
  // Handle CORS preflight requests
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*', // Adjust for specific origins if needed
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type' // Allow Content-Type header
    }
  });
};
