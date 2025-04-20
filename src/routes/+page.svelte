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
	let uploadLog: HTMLElement;
	let gameNameInput: HTMLInputElement;
	let uploadPassword = '';
	let gameName = '';
	let uppyInstance: any = null;
	let isValidatingPassword = false;
	let showUploader = false;

	function logMessage(message: string) {
		console.log(message);
		if (uploadLog) {
			uploadLog.textContent += message + '\n';
		}
	}

	// --- WebGL Build Validation Logic ---
	function looksLikeWebGLBuild(files: any[]) {
		logMessage('Validating file structure...');
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
			logMessage('Validation Failed: Missing index.html');
			return false;
		}
		if (!hasBuildDir) {
			logMessage('Validation Failed: Missing Build/ directory contents');
			return false;
		}
		if (!hasWasm) {
			logMessage('Validation Failed: Missing .wasm file (usually in Build/)');
			return false;
		}
		if (!hasJsInBuild) {
			logMessage('Validation Failed: Missing .js file in Build/');
			return false;
		}

		logMessage('Validation Passed: Structure looks like a Unity WebGL build.');
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
			onBeforeFileAdded: (currentFile: any, files: any) => {
				// This allows adding folders properly
				if (currentFile.isFolder) {
					logMessage(`Processing folder: ${currentFile.name}`);
				}
				return true; // Allow the file/folder
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
				canSelectFolders: true
			})
			.use(XHRUpload, {
				endpoint: '/api/upload', // Endpoint handled by our SvelteKit API route
				method: 'POST',
				formData: true, // Send raw file body
				fieldName: 'file', // Default field name, not strictly used if formData is false
				limit: 5, // Number of concurrent uploads
				bundle: true, // Bundle files with their directories
				// @ts-ignore - preservePath is available but not in types
				preservePath: true, // Preserve the full path
				headers: {
					// Password will be added here dynamically just before upload
				},
				allowedMetaFields: ['name', 'uploadPassword', 'gameName'] // Ensure custom fields are sent
			});

		// --- Uppy Event Listeners ---
		uppyInstance.on('files-added', (files: any[]) => {
			logMessage(`${files.length} file(s)/folder(s) added. Running validation...`);
			// Clear previous logs slightly delayed to allow reading them
			setTimeout(() => {
				if (uploadLog) {
					uploadLog.textContent = '';
				}
			}, 2000);

			// Extract all individual files even if a folder was added
			const allFiles = uppyInstance.getFiles();

			// Start validation and upload process
			startUpload(allFiles);
		});

		uppyInstance.on('upload-success', (file: any, response: any) => {
			logMessage(`✅ Upload successful: ${file.name}`);

			// For index.html files, show the game URL more prominently
			if (response.body.isIndexHtml) {
				const gameUrl = response.body.url;
				logMessage(`🎮 Game URL: ${gameUrl}`);

				// Add to the game URLs list if it exists
				const gameUrlsList = document.getElementById('game-urls-list');
				if (gameUrlsList) {
					const listItem = document.createElement('li');
					listItem.className = 'mb-2';

					const gameLink = document.createElement('a');
					gameLink.href = gameUrl;
					gameLink.target = '_blank';
					gameLink.className = 'text-blue-600 hover:underline';
					gameLink.textContent = `${response.body.gameName} - ${new Date().toLocaleString()}`;

					listItem.appendChild(gameLink);
					gameUrlsList.appendChild(listItem);

					// Show the game URLs section
					const gameUrlsSection = document.getElementById('game-urls-section');
					if (gameUrlsSection) {
						gameUrlsSection.style.display = 'block';
					}
				}

				toast.success(
					`✅ Game Upload Successful!\n\nGame: ${response.body.gameName}\nURL: ${gameUrl}\n\nYou can access your game at the URL above.`
				);
			} else {
				// Regular file upload
				logMessage(`🔗 File URL: ${response.body.url}`);
			}
		});

		uppyInstance.on('upload-error', (file: any, error: any, response: any) => {
			logMessage(`❌ Error uploading ${file?.name || 'file'}: ${error}`);
			if (response) {
				logMessage(`Server responded with: ${response.status} ${response.body}`);
				toast.error(
					`Upload Failed for ${file?.name}:\n${error}\nServer Status: ${response.status}`
				);
			} else {
				toast.error(`Upload Failed for ${file?.name}:\n${error}`);
			}
		});

		uppyInstance.on('complete', (result: any) => {
			logMessage('--- Upload process complete ---');
			logMessage(`Successful: ${result.successful.length}, Failed: ${result.failed.length}`);
		});
	}

	$: if (uploadPassword && gameName && uppyInstance) {
		uppyInstance.setMeta({ uploadPassword, gameName });
	}

	// --- Password Handling ---
	function handlePasswordSubmit() {
		isValidatingPassword = true;
		uploadPassword = passwordInput.value;
		if (!uploadPassword) {
			toast.error('Please enter the upload password.');
			isValidatingPassword = false;
			return;
		}

		// Validate password with the server
		logMessage('Validating password...');

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
					await tick(); // Wait for DOM update before initializing Uppy
					initUppy();
				} else {
					logMessage('Password validation failed: ' + data.message);
					toast.error('Invalid password. Please try again.');
					passwordInput.value = '';
					passwordInput.focus();
				}
			})
			.catch((error) => {
				logMessage('Error validating password: ' + error);
				toast.error('Error validating password. Please try again.');
			})
			.finally(() => {
				isValidatingPassword = false;
			});
	}

	function validateGameName() {
		gameName = gameNameInput.value.trim();
		if (!gameName) {
			toast.error('Please enter a game name.');
			return false;
		}

		// Sanitize game name - only allow alphanumeric, dash, and underscore
		const sanitizedName = gameName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
		if (sanitizedName !== gameName) {
			gameName = sanitizedName;
			gameNameInput.value = sanitizedName;
			logMessage(`Game name sanitized to: ${sanitizedName}`);
		}

		return true;
	}

	// Start upload after validation
	function startUpload(files: any[]) {
		if (!validateGameName()) {
			return;
		}

		logMessage(`Game name set to: ${gameName}`);

		if (looksLikeWebGLBuild(files)) {
			// If validation passes, ask for confirmation
			toast(
				`✅ Files look like a valid Unity WebGL build.\n\nGame Name: ${gameName}\n\nFiles detected:\n${files
					.map((f: any) => `- ${f.name || f.relativePath}`)
					.join('\n')}\n\nProceed with upload?`,
				{
					action: {
						label: 'Upload',
						onClick: () => {
							logMessage('User confirmed. Starting upload...');
							uppyInstance.upload();
						}
					},
					description: 'Click Upload to proceed or dismiss to cancel.'
				}
			);
			return;
		} else {
			// If validation fails
			toast.error(
				'⚠️ Validation Failed! The selected files/folder do not seem to form a correct Unity WebGL build. Please check the required files (index.html, Build/*.js, Build/*.wasm etc.) and try again.'
			);
			logMessage('Upload aborted due to validation failure.');
			uppyInstance.reset(); // Clear the selected files
		}
	}

	onMount(() => {
		passwordInput = document.getElementById('upload-password') as HTMLInputElement;
		uploadLog = document.getElementById('upload-log') as HTMLElement;
		gameNameInput = document.getElementById('game-name') as HTMLInputElement;
	});
</script>

<svelte:head>
	<title>Lab WebGL Uploader</title>
</svelte:head>

<Card class="container mx-auto p-8">
	<CardHeader>
		<CardTitle>Lab WebGL Uploader</CardTitle>
	</CardHeader>
	<CardContent>
		<Card class="mb-6">
			{#if !showUploader}
				<div bind:this={passwordSection}>
					<CardHeader>
						<CardTitle>Enter Upload Password</CardTitle>
					</CardHeader>
					<CardContent>
						<div class="mb-4">
							<Label for="upload-password">Password:</Label>
							<Input type="password" id="upload-password" placeholder="Enter the upload password" />
						</div>
						<CardFooter class="p-0">
							<Button onclick={handlePasswordSubmit} disabled={isValidatingPassword}>
								{isValidatingPassword ? 'Validating...' : 'Submit'}
							</Button>
						</CardFooter>
					</CardContent>
				</div>
			{/if}
		</Card>

		<Card id="uploader-section" class="mb-6">
			{#if showUploader}
				<div bind:this={uploaderSection}>
					<CardHeader>
						<CardTitle>Upload WebGL Build</CardTitle>
					</CardHeader>
					<CardContent>
						<div class="mb-4">
							<Label for="game-name">Game Name (required):</Label>
							<Input
								type="text"
								id="game-name"
								placeholder="Enter a unique name for this game (e.g. my-awesome-game)"
							/>
							<p class="mt-1 text-xs text-gray-500">
								Only use letters, numbers, dashes, and underscores. This will be used in the URL.
							</p>
						</div>
						<p class="mb-4 text-gray-700">
							Upload a Unity WebGL build folder. The files will be validated before uploading.
						</p>
						<div
							id="drag-drop-area"
							class="mb-4 rounded-lg border-2 border-dashed border-gray-300 p-6"
						></div>
					</CardContent>
				</div>
			{/if}
		</Card>

		<Card id="game-urls-section" class="mb-6 hidden">
			<CardHeader>
				<CardTitle>Your Uploaded Games</CardTitle>
			</CardHeader>
			<CardContent>
				<p class="mb-2 text-gray-700">Click on a game link to play:</p>
				<ul id="game-urls-list" class="list-disc pl-5"></ul>
			</CardContent>
		</Card>

		<Card class="rounded-lg bg-gray-100">
			<CardHeader>
				<CardTitle>Upload Log</CardTitle>
			</CardHeader>
			<CardContent>
				<pre
					id="upload-log"
					class="h-48 overflow-y-auto rounded-md bg-gray-800 p-4 font-mono text-sm text-green-400"></pre>
			</CardContent>
		</Card>
	</CardContent>
</Card>
