/**
 * Captures an image from the provided video element
 * Crops the image to match the target aspect ratio
 * @param {HTMLVideoElement} videoElement - The video element to capture from
 * @param {OffscreenCanvas} captureOffscreenCanvas - Canvas used for capturing
 * @returns {Promise<string>} - A data URL for the captured image
 */
async function captureImage(videoElement, captureOffscreenCanvas) {
  if (!videoElement || videoElement.readyState < videoElement.HAVE_METADATA ||
    !videoElement.videoWidth || !videoElement.videoHeight) {
    throw new Error("Video is not ready. Please wait a moment and try again.");
  }

  captureOffscreenCanvas.width = videoElement.videoWidth;
  captureOffscreenCanvas.height = videoElement.videoHeight;

  const ctx = captureOffscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) {
    throw new Error("Failed to prepare image for capture. Please try again.");
  }

  ctx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const targetViewHeight = viewportHeight * (2 / 5);
  const targetAspectRatio = viewportWidth / targetViewHeight;

  const vidWidth = videoElement.videoWidth;
  const vidHeight = videoElement.videoHeight;
  let sx = 0, sy = 0, sWidth = vidWidth, sHeight = vidHeight;
  const currentAspectRatio = vidWidth / vidHeight;

  if (currentAspectRatio > targetAspectRatio) {
    sWidth = Math.round(vidHeight * targetAspectRatio);
    sx = Math.round((vidWidth - sWidth) / 2);
  } else if (currentAspectRatio < targetAspectRatio) {
    sHeight = Math.round(vidWidth / targetAspectRatio);
    sy = Math.round((vidHeight - sHeight) / 2);
  }

  sx = Math.max(0, sx);
  sy = Math.max(0, sy);
  sWidth = Math.max(0, Math.min(sWidth, vidWidth - sx));
  sHeight = Math.max(0, Math.min(sHeight, vidHeight - sy));

  if (sWidth === 0 || sHeight === 0) {
    console.warn('Calculated crop dimensions are zero. Using full video frame for capture or defaulting to small canvas.');
    sWidth = vidWidth > 0 ? vidWidth : 100;
    sHeight = vidHeight > 0 ? vidHeight : 100;
    sx = 0;
    sy = 0;
  }

  const croppedCanvas = new OffscreenCanvas(sWidth, sHeight);
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) {
    throw new Error("Failed to create cropped canvas context. Please try again.");
  }

  croppedCtx.drawImage(
    captureOffscreenCanvas,
    sx, sy, sWidth, sHeight,
    0, 0, sWidth, sHeight
  );

  try {
    const blob = await croppedCanvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
    if (!blob) {
      throw new Error("Failed to generate image data (blob is null). Please try again.");
    }

    const imageData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    if (!imageData || imageData === "data:," || imageData.length < 100) {
      throw new Error("Failed to generate image data from blob. The canvas might be blank or an error occurred.");
    }

    return imageData;
  } catch (e) {
    console.error("Error during image capture:", e);
    throw e;
  }
}

/**
 * Downloads an image from a data URL
 * @param {string} imageData - The image data URL
 * @param {string} [prefix='capture'] - Prefix for the downloaded filename
 */
function downloadImage(imageData, prefix = 'capture') {
  const a = document.createElement('a');
  a.href = imageData;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.download = `${prefix}-${timestamp}.jpg`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
