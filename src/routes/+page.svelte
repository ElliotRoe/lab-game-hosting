<script lang="ts">
	import { onMount } from 'svelte';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import XHRUpload from '@uppy/xhr-upload';
	import '@uppy/core/dist/style.min.css';
	import '@uppy/dashboard/dist/style.min.css';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card } from '$lib/components/ui/card/index.js';
	import { CardHeader } from '$lib/components/ui/card/index.js';
	import { CardTitle } from '$lib/components/ui/card/index.js';
	import { CardContent } from '$lib/components/ui/card/index.js';
	import { CardFooter } from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { tick } from 'svelte';

	let passwordSection: HTMLElement;
	let uploaderSection: HTMLElement;
	let passwordInput: HTMLInputElement;
	let uploadPassword = '';
	let gameName = '';
	let uppyInstance: any = null;
	let isValidatingPassword = false;
	let showUploader = false;
	let isGameNameValid: boolean | null = null; // null: unchecked, true: valid, false: invalid
	let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
	let gameNameError = ''; // New state for error message
	let showProcessingNotice = false; // State for the processing notice

	// --- WebGL Build Validation Logic ---
	function looksLikeWebGLBuild(files: any[]) {
		console.log('Validating file structure...');
		const fileNames = files.map((file) => file.name || file.relativePath); // relativePath useful for folders

		// Basic checks: Does it contain key files/folders?
		const hasIndexHtml = fileNames.some(
			(name) => name === 'index.html' || name.endsWith('/index.html')
		);
		const hasBuildDir = fileNames.some(
			(name) => name.startsWith('Build/') || name.includes('/Build/')
		);
		const hasWasm = fileNames.some((name) => name.endsWith('.wasm'));
		const hasData = fileNames.some((name) => name.endsWith('.data')); // Unity often has a .data file
		const hasJsInBuild = fileNames.some(
			(name) => (name.startsWith('Build/') || name.includes('/Build/')) && name.endsWith('.js')
		);

		if (!hasIndexHtml) {
			toast.error('Missing index.html file');
			return false;
		}
		if (!hasBuildDir) {
			toast.error('Missing Build/ directory contents');
			return false;
		}
		if (!hasWasm) {
			toast.error('Missing .wasm file (usually in Build/)');
			return false;
		}
		if (!hasJsInBuild) {
			toast.error('Missing .js file in Build/');
			return false;
		}

		toast.success('File structure looks valid!');
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
				maxNumberOfFiles: 1, // Only allow one zip file at a time
				allowedFileTypes: ['.zip', 'application/zip', 'application/x-zip-compressed']
			},
			onBeforeFileAdded: (currentFile: any, files: any) => {
				// Since we only allow zip files, reject folders directly
				if (currentFile.isFolder) {
					toast.error('Folder uploads are not allowed. Please upload a single .zip file.');
					console.log(`Folder rejected: ${currentFile.name}`);
					return false;
				}
				// The file type check is handled by restrictions.allowedFileTypes
				// Uppy will show an error message automatically if the type is wrong.
				console.log(`File added: ${currentFile.name}`);
				return true; // Allow the file if it passed type check
			}
		})
			.use(Dashboard, {
				inline: true,
				target: '#drag-drop-area',
				proudlyDisplayPoweredByUppy: true,
				note: 'Upload WebGL build files/folder. Validation will run before upload.',
				showProgressDetails: true,
				hideRetryButton: false,
				hidePauseResumeButton: false,
				// Allow users to add folders
				// Note: browser support for folder selection varies
				// @ts-ignore - canSelectFolders is available but not in types
				canSelectFolders: false // Disable folder selection as we only accept zips
			})
			.use(XHRUpload, {
				endpoint: 'https://elliotroe--game-upload-upload.modal.run',
				method: 'POST',
				formData: true,
				fieldName: 'gameZip',
				limit: 1,
				// Send metadata as headers using a function
				headers: () => {
					console.log(`Generating XHR headers: gameName=${gameName}, pw set=${!!uploadPassword}`);
					return {
						'X-Upload-Password': uploadPassword,
						'X-Game-Name': gameName
					};
				},
				allowedMetaFields: ['name'] // Only need name now
			});

		// --- Uppy Event Listeners ---

		uppyInstance.on('files-added', (files: any[]) => {
			console.log(`${files.length} file(s) added. Triggering validation flow...`);
			// Extract all individual files even if a folder was added
			const allFiles = uppyInstance.getFiles();
			// Don't start upload immediately, wait for user confirmation
			// startUpload(allFiles); // Moved logic into confirmation step
			if (allFiles.length === 1) {
				// Trigger the pre-upload checks and confirmation toast
				startUpload(allFiles);
			} else if (allFiles.length > 1) {
				toast.error('Please upload only one .zip file at a time.');
				uppyInstance.reset();
			}
		});

		// Added progress listener for the notice
		uppyInstance.on('progress', (progress: { bytesUploaded: number; bytesTotal: number }) => {
			if (progress.bytesUploaded === progress.bytesTotal && progress.bytesTotal > 0) {
				console.log('Upload reached 100%, showing processing notice.');
				showProcessingNotice = true;
			} else {
				// Hide notice if progress resets or goes below 100 (e.g., during retry)
				if (showProcessingNotice && progress.bytesUploaded < progress.bytesTotal) {
					showProcessingNotice = false;
				}
			}
		});

		uppyInstance.on('upload-success', (file: any, response: any) => {
			showProcessingNotice = false; // Hide notice on success
			console.log(`✅ Upload successful: ${file.name}`);
			// Ensure response.body exists and has expected fields
			if (response && response.body && response.body.gameUrl) {
				console.log('Received upload-success response:', response.body);
				const gameUrl = response.body.gameUrl; // Direct URL from Modal
				console.log(`🎮 Game URL from server: ${gameUrl}`);

				// Add to the game URLs list
				const gameUrlsList = document.getElementById('game-urls-list');
				if (gameUrlsList) {
					const listItem = document.createElement('li');
					listItem.className = 'mb-2';

					const gameLink = document.createElement('a');
					gameLink.href = gameUrl;
					gameLink.target = '_blank';
					gameLink.className = 'text-blue-600 hover:underline';
					gameLink.textContent = `${response.body.gameName || file.meta.name} - ${new Date().toLocaleString()}`;

					listItem.appendChild(gameLink);
					gameUrlsList.appendChild(listItem);
					console.log('Added link to list:', gameLink.outerHTML);

					// Show the game URLs section
					const gameUrlsSection = document.getElementById('game-urls-section');
					if (gameUrlsSection) {
						gameUrlsSection.classList.remove('hidden');
						console.log('Made gameUrlsSection visible');
					}
				}

				toast.success(
					`✅ Game Upload Successful!\n\nGame: ${response.body.gameName || file.meta.name}\nURL: ${gameUrl}`
				);
			} else {
				console.error('Upload success response missing body or gameUrl:', response);
				toast.error(`Upload OK for ${file?.name}, but couldn't get game URL.`);
			}
		});

		uppyInstance.on('upload-error', (file: any, error: any, response: any) => {
			showProcessingNotice = false; // Hide notice on error
			console.log(`❌ Error uploading ${file?.name || 'file'}: ${error}`);
			if (response) {
				console.log(`Server responded with: ${response.status} ${response.body}`);
				toast.error(
					`Upload Failed for ${file?.name}:\n${error}\nServer Status: ${response.status}`
				);
			} else {
				toast.error(`Upload Failed for ${file?.name}:\n${error}`);
			}
		});

		uppyInstance.on('cancel-all', () => {
			showProcessingNotice = false; // Hide notice on cancel
		});

		uppyInstance.on('reset', () => {
			showProcessingNotice = false; // Hide notice on reset
		});

		uppyInstance.on('complete', (result: any) => {
			showProcessingNotice = false; // Hide notice on completion (covers success/error)
			console.log('--- Upload process complete ---');
			console.log(`Successful: ${result.successful.length}, Failed: ${result.failed.length}`);
		});
	}

	// --- Password Handling ---
	async function handlePasswordSubmit() {
		isValidatingPassword = true;
		uploadPassword = passwordInput.value;
		if (!uploadPassword) {
			toast.error('Please enter the upload password.');
			isValidatingPassword = false;
			return;
		}

		// Validate password with the server
		console.log('Validating password...');

		fetch('/api/validate-password', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ password: uploadPassword })
		})
			.then(async (response) => {
				const data = await response.json();
				if (data.valid) {
					showUploader = true;
				} else {
					console.log('Password validation failed: ' + data.message);
					toast.error('Invalid password. Please try again.');
					passwordInput.value = '';
					passwordInput.focus();
				}
			})
			.catch((error) => {
				console.log('Error validating password: ' + error);
				toast.error('Error validating password. Please try again.');
			})
			.finally(() => {
				isValidatingPassword = false;
			});
	}

	function validateGameName() {
		const inputElement = document.getElementById('game-name') as HTMLInputElement;
		if (!inputElement) {
			toast.error('Game Name input element not found.');
			console.log('Error: #game-name input not found in DOM.');
			gameNameError = 'Internal error: Input field missing.'; // Set error
			isGameNameValid = false;
			return false;
		}

		gameName = inputElement.value.trim();
		if (!gameName) {
			// toast.error('Please enter a game name.'); // Toast can be annoying here
			gameNameError = 'Game name cannot be empty.'; // Set error
			isGameNameValid = false;
			return false;
		}

		// Sanitize game name - only allow alphanumeric, dash, and underscore
		const sanitizedName = gameName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
		if (sanitizedName !== gameName) {
			// Provide feedback about sanitization without blocking if it results in a valid name
			console.log(`Game name sanitized to: ${sanitizedName}`);
			// Check if the original had invalid chars, not just case changes
			if (gameName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') !== sanitizedName) {
				gameNameError = `Invalid characters detected. Sanitized to: ${sanitizedName}`; // Informative error
				gameName = sanitizedName; // Update gameName state
				inputElement.value = sanitizedName; // Update input visually
				isGameNameValid = false; // Mark as invalid due to chars
				return false; // Prevent checkUniqueness for now
			} else {
				// Only case difference, allow it but update state
				gameName = sanitizedName;
				inputElement.value = sanitizedName;
				// Don't set error here if only case changed
			}
		}

		// If validation passes so far
		gameNameError = ''; // Clear error if format is okay
		// Don't set isGameNameValid here, uniqueness check will do that
		return true;
	}

	// Start upload after validation
	async function startUpload(files: any[]) {
		if (!validateGameName()) {
			return;
		}

		console.log(`Game name set to: ${gameName}`);

		// Check if game name exists on the server
		try {
			const response = await fetch('/api/check-game-name', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameName })
			});
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.message || 'Failed to check game name');
			}

			if (data.exists) {
				toast.error(`Game name "${gameName}" already exists. Please choose a different name.`);
				console.log(`Game name check failed: "${gameName}" already exists.`);
				// Optionally focus the input again
				const inputElement = document.getElementById('game-name') as HTMLInputElement;
				inputElement?.focus();
				inputElement?.select();
				gameNameError = 'This name is already taken.'; // Set error message
				// Instead of returning, set the validity state
				isGameNameValid = false;
				// We still return here because startUpload was triggered by Uppy adding files,
				// and we need to clear the selected files
				if (uppyInstance) {
					uppyInstance.reset();
				}
				return; // Stop the upload process
			}
			console.log(`Game name "${gameName}" is available.`);
			isGameNameValid = true; // Mark as valid after check
			gameNameError = ''; // Clear error message
		} catch (error) {
			console.log(`Error checking game name: ${error}`);
			toast.error('Could not verify game name. Please try again.');
			isGameNameValid = false; // Treat check errors as invalid
			gameNameError = 'Could not verify name uniqueness.'; // Set error message
			return; // Stop the upload process
		}

		// Basic check: Ensure there is exactly one file (which should be the zip)
		if (files.length === 1 && uppyInstance) {
			const theFile = files[0];

			// Explicitly check validity state before showing confirmation
			toast(
				`Ready to upload zip file:\n\nGame Name: ${gameName}\nFile: ${theFile.name}\n\nProceed?`,
				{
					action: {
						label: 'Upload',
						onClick: () => {
							// Meta is already set on the file
							// Ensure meta is set right before upload
							if (uppyInstance) {
								console.log(`Set global meta: gameName=${gameName}`);
							}
							console.log('User confirmed. Starting upload...');
							uppyInstance.upload();
						}
					},
					duration: 10000
				}
			);
		} else {
			// If validation fails or uppyInstance is null
			if (files.length !== 1) {
				toast.error('⚠️ Error: Please select exactly one .zip file to upload.');
				console.log('Upload aborted. Incorrect file selection.');
			} else {
				toast.error('⚠️ Error: Uppy instance not ready.');
				console.log('Upload aborted. Uppy not initialized.');
			}
			if (uppyInstance) {
				uppyInstance.reset(); // Clear the selected files
			}
		}
	}

	// --- Debounced Game Name Check ---
	async function checkGameNameUniqueness() {
		const currentName = gameName; // Capture current name
		if (!currentName) {
			isGameNameValid = null; // Reset if empty
			return;
		}

		console.log(`Checking uniqueness for: ${currentName}...`);
		try {
			const response = await fetch('/api/check-game-name', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameName: currentName })
			});
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.message || 'Failed to check game name');
			}

			if (data.exists) {
				isGameNameValid = false;
				console.log(`Game name "${currentName}" is NOT available.`);
				toast.error(`"${currentName}" is already taken.`, { duration: 2000 });
				gameNameError = 'This game name is already taken.'; // Set error message
			} else {
				isGameNameValid = true;
				console.log(`Game name "${currentName}" is available.`);
				gameNameError = ''; // Clear error message
				// Optional: show temporary success indicator?
			}
		} catch (error) {
			console.log(`Error checking game name uniqueness: ${error}`);
			toast.error('Could not verify game name uniqueness.');
			isGameNameValid = null; // Set to null on error, as we don't know the status
			gameNameError = 'Error checking name uniqueness.'; // Set error message
		}
	}

	function handleGameNameInput(event: Event) {
		// Update gameName based on input
		const inputElement = event.target as HTMLInputElement;
		gameName = inputElement.value.trim(); // Keep gameName updated
		isGameNameValid = null; // Reset validation state on new input
		gameNameError = ''; // Reset error message on input

		// Clear existing timeout
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
		}

		// Set new timeout
		debounceTimeout = setTimeout(() => {
			// Validate format first
			if (validateGameName()) {
				// Only check uniqueness if format is valid and name is not empty
				if (gameName) {
					checkGameNameUniqueness();
				}
			} // If validateGameName is false, it already set the error message
		}, 500); // Adjust debounce delay (milliseconds)
	}

	// --- Reactive Uppy Initialization ---
	$: if (showUploader && isGameNameValid === true) {
		// Wait a tick just to be absolutely sure DOM is ready for Uppy target
		tick().then(() => {
			// Double check state after tick, ensure DOM element exists
			if (showUploader && isGameNameValid === true && document.getElementById('drag-drop-area')) {
				console.log('Conditions met (isGameNameValid=true), ensuring Uppy is initialized...');
				initUppy();
			} else if (showUploader && isGameNameValid === true) {
				console.log(
					'Conditions met (isGameNameValid=true), but #drag-drop-area not found in DOM after tick.'
				);
			}
		});
	}

	// --- Reactive Uppy Handling for Invalid Name ---
	$: if (showUploader && isGameNameValid !== true && uppyInstance) {
		console.log(
			`Game name is no longer valid (isGameNameValid=${isGameNameValid}), closing Uppy instance.`
		);
		uppyInstance.close();
		uppyInstance = null;
	}

	// --- Reactive Uppy Cleanup (when hiding the whole uploader section) ---
	$: if (!showUploader && uppyInstance) {
		console.log('Hiding uploader section, closing Uppy instance.');
		uppyInstance.close();
		uppyInstance = null;
		isGameNameValid = null; // Reset game name validity
		gameNameError = ''; // Clear game name error
		// Optionally clear the game name input field itself
		const inputElement = document.getElementById('game-name') as HTMLInputElement;
		if (inputElement) inputElement.value = '';
		gameName = '';
	}

	onMount(() => {
		passwordInput = document.getElementById('upload-password') as HTMLInputElement;
	});
</script>

<svelte:head>
	<title>Lab WebGL Uploader</title>
	<meta name="description" content="Upload your Unity WebGL game builds easily." />
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-blue-100 to-indigo-100 p-4 sm:p-8">
	<Card class="container mx-auto max-w-3xl overflow-hidden rounded-xl shadow-lg">
		<CardHeader class="p-6">
			<CardTitle class="text-center text-3xl font-bold tracking-tight">
				🚀 Lab WebGL Uploader 🚀
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-8 p-6">
			{#if !showUploader}
				<div bind:this={passwordSection}>
					<Card class="rounded-lg border border-gray-200">
						<CardHeader>
							<CardTitle class="text-xl font-semibold text-gray-700"
								>Enter Upload Password</CardTitle
							>
						</CardHeader>
						<CardContent>
							<div class="mb-4 space-y-2">
								<Label for="upload-password" class="text-sm font-medium text-gray-600"
									>Password:</Label
								>
								<Input
									type="password"
									id="upload-password"
									placeholder="Enter the upload password"
									class="w-full"
								/>
							</div>
						</CardContent>
						<CardFooter class="border-t bg-gray-50 p-4">
							<Button
								onclick={handlePasswordSubmit}
								disabled={isValidatingPassword}
								class="bg-blue-600 text-white hover:bg-blue-700"
							>
								{isValidatingPassword ? 'Validating...' : 'Submit'}
							</Button>
						</CardFooter>
					</Card>
				</div>
			{/if}

			{#if showUploader}
				<div id="uploader-section-wrapper" bind:this={uploaderSection}>
					<Card id="uploader-section" class="rounded-lg border border-gray-200">
						<CardHeader>
							<CardTitle class="text-xl font-semibold text-gray-700">Upload Your Game</CardTitle>
						</CardHeader>
						<CardContent class="space-y-4">
							<div>
								<Label for="game-name" class="text-sm font-medium text-gray-600">
									Game Name <span class="text-red-500">*</span>
								</Label>
								<Input
									type="text"
									id="game-name"
									placeholder="my-awesome-game"
									class="mt-1 w-full {gameNameError
										? 'border-red-500 focus:border-red-500 focus:ring-red-500'
										: isGameNameValid === true
											? 'border-green-500 focus:border-green-500 focus:ring-green-500'
											: ''}"
									oninput={handleGameNameInput}
									onblur={checkGameNameUniqueness}
								/>
								{#if gameNameError}
									<p class="mt-1 text-xs text-red-600">{gameNameError}</p>
								{/if}
								<p class="mt-1 text-xs text-gray-500">
									Use letters, numbers, dashes (-), underscores (_). This determines the game's URL.
								</p>
							</div>
							<div class="mt-4 border-t border-gray-200 pt-4">
								<Label class="text-sm font-medium text-gray-600">WebGL Build (.zip)</Label>
								<p class="mb-2 text-sm text-gray-600">
									Upload a single <code class="rounded bg-gray-100 px-1">.zip</code> file containing
									your Unity WebGL build.
								</p>
								<div
									id="drag-drop-area"
									class="rounded-lg border-2 border-dashed border-gray-300 p-6 transition-colors hover:border-blue-400 {isGameNameValid !==
									true
										? 'pointer-events-none opacity-50'
										: ''}"
									title={isGameNameValid !== true
										? 'Enter a valid and unique game name first'
										: 'Drag & drop your .zip file here or click to browse'}
								>
									<!-- Uppy Dashboard injects here -->
									{#if isGameNameValid !== true}
										<p class="text-center text-gray-500">
											Enter a valid and unique game name above to enable upload.
										</p>
									{/if}
								</div>
								<!-- Processing Notice -->
								{#if showProcessingNotice}
									<div
										class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-800"
									>
										<p class="font-medium">Upload complete, processing on server...</p>
										<p>This may take a minute or two for large files. Please wait.</p>
										<p>Do not retry unless it takes longer than 2 minutes.</p>
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>
				</div>

				<Card id="game-urls-section" class="hidden rounded-lg border border-green-200 bg-green-50">
					<CardHeader class="border-b border-green-200">
						<CardTitle class="text-xl font-semibold text-green-800"
							>🎮 Your Uploaded Games</CardTitle
						>
					</CardHeader>
					<CardContent class="p-4">
						<p class="mb-3 text-sm text-green-700">Click a link below to play your game:</p>
						<ul id="game-urls-list" class="list-disc space-y-2 pl-5">
							<!-- Game links will be added here -->
						</ul>
					</CardContent>
				</Card>
			{/if}
		</CardContent>
	</Card>
</div>
