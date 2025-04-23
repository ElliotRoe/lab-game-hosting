import modal
import os
from typing import Dict, Any, Annotated
from io import BytesIO
import zipfile
from fastapi import UploadFile, File, Request, Header

# Create a Modal app (previously Stub)
app = modal.App("game-upload")

# Create a Modal image with required dependencies, specifying Python 3.12
image = modal.Image.debian_slim(python_version="3.12").pip_install([
    "boto3",
    "fastapi"
])

# Create a Modal volume for temporary storage
volume = modal.Volume.from_name("game-upload-vol", create_if_missing=True)

@app.function(
    image=image,
    volumes={"/data": volume},
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=600
)
@modal.concurrent(max_inputs=10)
@modal.fastapi_endpoint(method="POST")
async def upload(
    request: Request,
    gameZip: Annotated[UploadFile, File()]
) -> Dict[str, Any]:
    import boto3
    from botocore.config import Config

    print("--- New Upload Request (Headers Method) ---")
    headers = dict(request.headers)
    print(f"Request Headers: {headers}")

    # --- Get Metadata from Headers --- 
    uploadPassword = headers.get('x-upload-password')
    gameName = headers.get('x-game-name')

    print(f"Received Game Name (Header): {gameName}")
    print(f"Received Upload Password (Header exists): {uploadPassword is not None}")
    print(f"Received File Name: {gameZip.filename}")
    print(f"Received File Content-Type: {gameZip.content_type}")
    
    print(f"ENV - R2_ACCOUNT_ID: {os.environ.get('R2_ACCOUNT_ID')}")
    print(f"ENV - R2_ACCESS_KEY_ID: {os.environ.get('R2_ACCESS_KEY_ID', 'Not Set')[:5]}...")
    print(f"ENV - R2_BUCKET_NAME: {os.environ.get('R2_BUCKET_NAME')}")
    print(f"ENV - UPLOAD_PASSWORD set: {bool(os.environ.get('UPLOAD_PASSWORD'))}")
    print(f"ENV - PUBLIC_GAME_URL_BASE: {os.environ.get('PUBLIC_GAME_URL_BASE')}")

    if gameName is None:
        print("Validation Error: X-Game-Name header was not received.")
        return {"error": "Bad Request: Missing X-Game-Name header."}, 400
        
    if uploadPassword is None:
        print("Validation Error: X-Upload-Password header was not received.")
        return {"error": "Bad Request: Missing X-Upload-Password header."}, 400

    expected_password = os.environ.get("UPLOAD_PASSWORD")
    if not expected_password:
        print("CRITICAL ERROR: UPLOAD_PASSWORD environment variable not set in Modal secret!")
        return {"error": "Server configuration error: Missing upload credential."}, 500
    if not uploadPassword or uploadPassword != expected_password:
        print(f"Password validation failed. Provided length: {len(uploadPassword)}, Expected set: True")
        return {"error": "Unauthorized: Invalid password."}, 401
    print("Password validation successful.")

    if not gameName:
        print("Game name validation failed: Missing name")
        return {"error": "Bad Request: Missing gameName field."}, 400
    safe_game_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in gameName)
    if safe_game_name != gameName:
        print(f"Game name sanitized from '{gameName}' to '{safe_game_name}'")
    else:
        print(f"Using game name as provided: {safe_game_name}")

    print(f"Attempting to read zip file: {gameZip.filename} ({gameZip.content_type}) ...")
    try:
        zip_content = await gameZip.read()
        print(f"Successfully read {len(zip_content)} bytes from zip file.")
    except Exception as e:
        print(f"ERROR reading zip file content: {str(e)}")
        return {"error": f"Failed to read uploaded file: {str(e)}"}, 400
    
    zip_buffer = BytesIO(zip_content)

    valid_files = []
    try:
        print("Validating zip structure...")
        with zipfile.ZipFile(zip_buffer) as zf:
            all_names = zf.namelist()
            print(f"Zip contains {len(all_names)} total entries.")
            valid_files = [name for name in all_names if not name.startswith("__MACOSX/") and not name.startswith("._") and not name.endswith("/")]
            print(f"Found {len(valid_files)} potentially valid file entries.")
            if not valid_files:
                 print("Zip validation failed: No valid files found after filtering.")
                 return {"error": "Invalid zip file: Contains no usable files."}, 400

            has_index = any(
                name.lower().endswith("index.html")
                for name in valid_files
            )
            if not has_index:
                print("Zip validation failed: index.html not found among valid files:")
                for fname in valid_files:
                    print(f"  - {fname}")
                return {"error": "Invalid zip structure: index.html not found at the root level."}, 400
            print("Zip structure validated successfully (found index.html)." )
    except zipfile.BadZipFile as e:
        print(f"Zip validation failed: BadZipFile - {str(e)}")
        return {"error": f"Invalid zip file format: {str(e)}"}, 400
    except Exception as e:
        print(f"Zip validation failed: Unexpected error - {str(e)}")
        return {"error": f"Error validating zip file: {str(e)}"}, 500
    finally:
        zip_buffer.seek(0)

    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(region_name="auto"),
        )
        print("R2 client initialized successfully.")
    except KeyError as e:
        print(f"CRITICAL ERROR: Missing R2 credential environment variable: {str(e)}")
        return {"error": f"Server configuration error: Missing R2 credential ({str(e)})"}, 500
    except Exception as e:
        print(f"ERROR initializing R2 client: {str(e)}")
        return {"error": f"Failed to initialize storage client: {str(e)}"}, 500

    uploaded_count = 0
    print("Starting file processing and upload loop...")
    try:
        with zipfile.ZipFile(zip_buffer) as zf:
            for info in zf.infolist():
                if (
                    info.filename.startswith("__MACOSX/")
                    or info.filename.startswith("._")
                    or info.is_dir()
                ):
                    continue

                entry_path = info.filename
                if '/' in entry_path:
                     first_part = entry_path.split('/', 1)[0]
                     if all(f.startswith(first_part + '/') for f in valid_files):
                         entry_path = entry_path.split('/', 1)[1]
                         if not entry_path:
                            continue

                with zf.open(info) as file:
                    content = file.read()

                content_type = "application/octet-stream"
                lower_name = entry_path.lower()
                if lower_name.endswith(".html"): content_type = "text/html"
                elif lower_name.endswith(".css"): content_type = "text/css"
                elif lower_name.endswith(".js"): content_type = "application/javascript"
                elif lower_name.endswith(".json"): content_type = "application/json"
                elif lower_name.endswith(".wasm"): content_type = "application/wasm"
                elif lower_name.endswith(".png"): content_type = "image/png"
                elif lower_name.endswith(".jpg"): content_type = "image/jpeg"
                elif lower_name.endswith(".jpeg"): content_type = "image/jpeg"
                elif lower_name.endswith(".svg"): content_type = "image/svg+xml"
                elif lower_name.endswith(".gif"): content_type = "image/gif"
                elif lower_name.endswith(".ico"): content_type = "image/x-icon"

                key = f"{safe_game_name}/{entry_path}"
                print(f"Uploading {entry_path} to R2 key {key} with type {content_type}")
                s3.put_object(
                    Bucket=os.environ["R2_BUCKET_NAME"],
                    Key=key,
                    Body=content,
                    ContentType=content_type
                )
                uploaded_count += 1

        print(f"Successfully uploaded {uploaded_count} files.")

    except Exception as e:
        print(f"Error during R2 upload process: {str(e)}")
        return {"error": f"Error processing zip file: {str(e)}"}, 500

    game_url = f"{os.environ['PUBLIC_GAME_URL_BASE'].rstrip('/')}/{safe_game_name}/index.html"

    print(f"Upload complete. Game URL: {game_url}")
    return {
        "message": f"Successfully uploaded game '{safe_game_name}'.",
        "gameName": safe_game_name,
        "gameUrl": game_url,
        "status": "complete"
    }

# For local development
if __name__ == "__main__":
    modal.serve(app) 