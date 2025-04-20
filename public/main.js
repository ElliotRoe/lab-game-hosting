// Import Uppy bundle using ES Modules syntax (v4.13.3)
import { Uppy } from "https://releases.transloadit.com/uppy/v4.13.3/uppy.min.mjs";

const passwordSection = document.getElementById("password-section");
const uploaderSection = document.getElementById("uploader-section");
const passwordSubmitButton = document.getElementById("password-submit");
const passwordInput = document.getElementById("upload-password");
const uploadLog = document.getElementById("upload-log");

let uppyInstance = null;
let uploadPassword = "";

function logMessage(message) {
  console.log(message);
  uploadLog.textContent += message + "\n";
}

// --- WebGL Build Validation Logic ---
function looksLikeWebGLBuild(files) {
  logMessage("Validating file structure...");
  const fileNames = files.map((file) => file.name || file.relativePath); // relativePath useful for folders

  // Basic checks: Does it contain key files/folders?
  const hasIndexHtml = fileNames.some(
    (name) => name === "index.html" || name.endsWith("/index.html")
  );
  const hasBuildDir = fileNames.some(
    (name) => name.startsWith("Build/") || name.includes("/Build/")
  );
  const hasWasm = fileNames.some((name) => name.endsWith(".wasm"));
  const hasData = fileNames.some((name) => name.endsWith(".data")); // Unity often has a .data file
  const hasJsInBuild = fileNames.some(
    (name) =>
      (name.startsWith("Build/") || name.includes("/Build/")) &&
      name.endsWith(".js")
  );

  if (!hasIndexHtml) {
    logMessage("Validation Failed: Missing index.html");
    return false;
  }
  if (!hasBuildDir) {
    logMessage("Validation Failed: Missing Build/ directory contents");
    return false;
  }
  if (!hasWasm) {
    logMessage("Validation Failed: Missing .wasm file (usually in Build/)");
    return false;
  }
  if (!hasJsInBuild) {
    logMessage("Validation Failed: Missing .js file in Build/");
    return false;
  }
  // .data file is common but maybe not strictly required for all versions/configs
  // if (!hasData) {
  //   logMessage('Validation Warning: Missing .data file (often needed)');
  // }

  logMessage("Validation Passed: Structure looks like a Unity WebGL build.");
  return true;
}

// --- Uppy Initialization ---
function initUppy() {
  if (uppyInstance) {
    uppyInstance.close(); // Close previous instance if any
  }

  uppyInstance = new Uppy({
    debug: true,
    autoProceed: false, // We want validation before proceeding
    restrictions: {
      // You might want to restrict file types further if needed
      // allowedFileTypes: ['.html', '.js', '.wasm', '.data', '.json', '.png', '.jpg'],
    },
    onBeforeFileAdded: (currentFile, files) => {
      // This allows adding folders properly
      if (currentFile.isFolder) {
        logMessage(`Processing folder: ${currentFile.name}`);
      }
      return true; // Allow the file/folder
    },
  })
    .use(Uppy.Dashboard, {
      inline: true,
      target: "#drag-drop-area",
      proudlyDisplayPoweredByUppy: true,
      note: "Upload WebGL build files/folder. Validation will run before upload.",
      showProgressDetails: true,
      hideRetryButton: false,
      hidePauseResumeButton: false,
      // Allow users to add folders
      // Note: browser support for folder selection varies
      canSelectFolders: true,
    })
    .use(Uppy.XHRUpload, {
      endpoint: "/upload", // Endpoint handled by our Cloudflare Function
      method: "POST",
      formData: false, // Send raw file body
      fieldName: "file", // Default field name, not strictly used if formData is false
      limit: 5, // Number of concurrent uploads
      headers: {
        // Password will be added here dynamically just before upload
      },
      // Add filename to header as backend expects it
      getChunkName(file) {
        return file.name; // Used for XHRUpload internals with tus, but we can leverage it
      },
      // Send filename in a custom header
      metaFields: ["name"], // Ensure name is available
      onBeforeSend: (files, xhr) => {
        // Set essential headers just before sending
        const firstFile = files[Object.keys(files)[0]]; // Get the first file object
        xhr.setRequestHeader("X-Upload-Password", uploadPassword);
        xhr.setRequestHeader("X-Filename", firstFile.name); // Send the filename
        logMessage(`Uploading ${firstFile.name}...`);
      },
    });

  // --- Uppy Event Listeners ---
  uppyInstance.on("files-added", (files) => {
    logMessage(
      `${files.length} file(s)/folder(s) added. Running validation...`
    );
    // Clear previous logs slightly delayed to allow reading them
    setTimeout(() => {
      uploadLog.textContent = "";
    }, 2000);

    // Extract all individual files even if a folder was added
    const allFiles = uppyInstance.getFiles();

    if (looksLikeWebGLBuild(allFiles)) {
      // If validation passes, ask for confirmation
      const userConfirmation = confirm(
        `✅ Files look like a valid Unity WebGL build.\n\nFiles detected:\n${allFiles
          .map((f) => `- ${f.name || f.relativePath}`)
          .join("\n")}\n\nProceed with upload?`
      );

      if (userConfirmation) {
        logMessage("User confirmed. Starting upload...");
        uppyInstance.upload(); // Start the upload process
      } else {
        logMessage("Upload cancelled by user.");
        uppyInstance.reset(); // Clear the selected files
      }
    } else {
      // If validation fails
      alert(
        "⚠️ Validation Failed! The selected files/folder do not seem to form a correct Unity WebGL build. Please check the required files (index.html, Build/*.js, Build/*.wasm etc.) and try again."
      );
      logMessage("Upload aborted due to validation failure.");
      uppyInstance.reset(); // Clear the selected files
    }
  });

  uppyInstance.on("upload-success", (file, response) => {
    logMessage(`✅ Upload successful: ${file.name}`);
    logMessage(`🔗 Access URL: ${response.body.url}`);
    // Maybe display the URL more prominently or add to a list
    alert(`Upload successful!\nFile: ${file.name}\nURL: ${response.body.url}`);
  });

  uppyInstance.on("upload-error", (file, error, response) => {
    logMessage(`❌ Error uploading ${file?.name || "file"}: ${error}`);
    if (response) {
      logMessage(`Server responded with: ${response.status} ${response.body}`);
      alert(
        `Upload Failed for ${file?.name}:\n${error}\nServer Status: ${response.status}`
      );
    } else {
      alert(`Upload Failed for ${file?.name}:\n${error}`);
    }
  });

  uppyInstance.on("complete", (result) => {
    logMessage("--- Upload process complete ---");
    logMessage(
      `Successful: ${result.successful.length}, Failed: ${result.failed.length}`
    );
    // Optionally clear successful files after a delay
    // setTimeout(() => {
    //    result.successful.forEach(file => uppyInstance.removeFile(file.id));
    // }, 5000);
  });
}

// --- Password Handling ---
passwordSubmitButton.addEventListener("click", () => {
  uploadPassword = passwordInput.value;
  if (!uploadPassword) {
    alert("Please enter the upload password.");
    return;
  }

  logMessage("Password entered. Initializing uploader...");
  // Hide password section, show uploader
  passwordSection.style.display = "none";
  uploaderSection.style.display = "block";

  // Initialize Uppy *after* password is confirmed
  initUppy();
});

// Initial log message
logMessage("Awaiting password...");
