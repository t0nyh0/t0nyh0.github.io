const { createApp, computed, ref, onMounted } = Vue;
let track = null;
let specs = [];

createApp({
  setup() {
    const video = ref(null);
    const pane = ref('permissions');
    const cameraCntr = ref(null);
    const predictedLabel = ref([]);
    const exposure = ref(0);
    const angle = ref(null);
    const captureOffscreenCanvas = new OffscreenCanvas(1, 1);

    let frameProcessorControls = null;

    const hasDetected = computed(() => predictedLabel.value.includes('STRAIGHT') || predictedLabel.value.includes('OVERHEAD') || predictedLabel.value.includes('ANGLED'));

    const currentSpecAngle = computed(() => {
      if (specs && predictedLabel.value && predictedLabel.value.length > 0) {
        for (const label of predictedLabel.value) {
          const spec = specs.find(s => s.label === label);
          if (spec && spec.angle && typeof spec.angle.min === 'number' && typeof spec.angle.max === 'number') {
            return spec.angle;
          }
        }
      }
      return { min: 40, max: 50 };
    });

    const currentGuidelines = computed(() => {
      if (specs && predictedLabel.value && predictedLabel.value.length > 0) {
        for (const label of predictedLabel.value) {
          const spec = specs.find(s => s.label === label);
          if (spec && spec.instructions) {
            return {
              title: label,
              instructions: spec.instructions
            };
          }
        }
        const defaultSpec = specs?.find(s => s.label === null);
        if (defaultSpec && defaultSpec.instructions) {
          return {
            instructions: defaultSpec.instructions
          };
        }
      }
      return null;
    });

    const isValidAngle = computed(() => {
      if (angle.value === null) return true;
      const { min, max } = currentSpecAngle.value;
      return angle.value >= min && angle.value <= max;
    });

    const isValid = computed(() => {
      const isGoodExposure = exposure.value >= 30 && exposure.value <= 70;
      return isValidAngle.value && isGoodExposure;
    });

    const onLoadStream = async () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const targetHeight = viewportHeight * (2 / 5);
      const targetAspectRatio = viewportWidth / targetHeight;

      const idealCameraHeight = 1080; // Aim for 1080p height
      const idealCameraWidth = Math.round(idealCameraHeight * targetAspectRatio);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          exact: targetAspectRatio,
          aspectRatio: { exact: targetAspectRatio },
          width: { ideal: idealCameraWidth },
          height: { ideal: idealCameraHeight },
          advanced: [{
            zoom: 1
          }],
          focusMode: 'continuous'
        }
      });

      video.value.srcObject = mediaStream;
      video.value.addEventListener('loadedmetadata', () => {
        if (frameProcessorControls) {
          frameProcessorControls.startProcessing();
        }
      });
      track = mediaStream.getVideoTracks()[0];
    };

    const calculateVisibleArea = () => {
      const viewportWidth = cameraCntr.value.clientWidth;
      const viewportHeight = cameraCntr.value.clientHeight;

      return {
        width: viewportWidth * 0.8,
        height: viewportHeight * 0.8,
        offsetX: viewportWidth * 0.1,
        offsetY: viewportHeight * 0.1
      };
    };

    const captureImage = async () => {
      if (!video.value || video.value.readyState < video.value.HAVE_METADATA || !video.value.videoWidth || !video.value.videoHeight) {
        alert("Video is not ready. Please wait a moment and try again.");
        return;
      }

      captureOffscreenCanvas.width = video.value.videoWidth;
      captureOffscreenCanvas.height = video.value.videoHeight;

      const ctx = captureOffscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!ctx) {
        alert("Failed to prepare image for capture. Please try again.");
        return;
      }

      ctx.drawImage(video.value, 0, 0, video.value.videoWidth, video.value.videoHeight);

      // Calculate centered crop based on browser width and 2/5 of screen height
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const targetViewHeight = viewportHeight * (2 / 5);
      const targetAspectRatio = viewportWidth / targetViewHeight;

      const vidWidth = video.value.videoWidth;
      const vidHeight = video.value.videoHeight;
      let sx = 0, sy = 0, sWidth = vidWidth, sHeight = vidHeight;
      const currentAspectRatio = vidWidth / vidHeight;

      if (currentAspectRatio > targetAspectRatio) {
        // Video is wider than target aspect ratio. Crop sides.
        sWidth = Math.round(vidHeight * targetAspectRatio);
        sx = Math.round((vidWidth - sWidth) / 2);
      } else if (currentAspectRatio < targetAspectRatio) {
        // Video is taller than target aspect ratio. Crop top/bottom.
        sHeight = Math.round(vidWidth / targetAspectRatio);
        sy = Math.round((vidHeight - sHeight) / 2);
      }
      // Ensure sx, sy, sWidth, sHeight are within bounds
      sx = Math.max(0, sx);
      sy = Math.max(0, sy);
      sWidth = Math.max(0, Math.min(sWidth, vidWidth - sx));
      sHeight = Math.max(0, Math.min(sHeight, vidHeight - sy));

      // If sWidth or sHeight ended up as 0 (e.g. if video dimensions were 0 initially)
      // attempt to use the full video dimensions, or default to a small canvas to avoid errors.
      if (sWidth === 0 || sHeight === 0) {
        console.warn('Calculated crop dimensions are zero. Using full video frame for capture or defaulting to small canvas.');
        sWidth = vidWidth > 0 ? vidWidth : 100; // Default to 100 if vidWidth is 0
        sHeight = vidHeight > 0 ? vidHeight : 100; // Default to 100 if vidHeight is 0
        sx = 0;
        sy = 0;
      }

      const croppedCanvas = new OffscreenCanvas(sWidth, sHeight);
      const croppedCtx = croppedCanvas.getContext('2d');
      if (!croppedCtx) {
        alert("Failed to create cropped canvas context. Please try again.");
        return;
      }
      croppedCtx.drawImage(
        captureOffscreenCanvas,
        sx, sy, sWidth, sHeight, // Source rectangle from original capture
        0, 0, sWidth, sHeight    // Destination rectangle on croppedCanvas
      );

      try {
        const blob = await croppedCanvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
        if (!blob) {
          alert("Failed to generate image data (blob is null). Please try again.");
          return;
        }

        const imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        if (!imageData || imageData === "data:," || imageData.length < 100) {
          alert("Failed to generate image data from blob. The canvas might be blank or an error occurred.");
          return;
        }

        const a = document.createElement('a');
        a.href = imageData;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `capture-${timestamp}.jpg`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        console.error("Error during image capture:", e);
        alert(`An error occurred while capturing the image: ${e.message}`);
      }
    };

    const onRequestPermissions = async () => {
      try {
        if (DeviceMotionEvent?.requestPermission) await DeviceMotionEvent.requestPermission();
        window.addEventListener("deviceorientation", (event) => {
          if (event.beta !== null) angle.value = 90 - event.beta;
        });

        try {
          const response = await fetch('specs.json');
          specs = await response.json();
        } catch (error) {
          console.error('Failed to load specs.json:', error);
        }

        await loadModel();

        const vueRefsForFrameProcessor = { video, exposure, predictedLabel, angle };
        const externalDepsForFrameProcessor = {
          getSpecs: () => specs,
          getTfModel: () => tfModel,
          lodash: _
        };
        frameProcessorControls = initializeFrameProcessor(vueRefsForFrameProcessor, externalDepsForFrameProcessor);

        pane.value = 'camera';
        onLoadStream();
      } catch (error) {
        alert("Camera or motion sensor permissions are required to use this feature.");
      }
    };

    return {
      video,
      captureImage,
      angle,
      exposure,
      isValidAngle,
      isValid,
      pane,
      cameraCntr,
      predictedLabel,
      currentGuidelines,
      onRequestPermissions,
      hasDetected
    };
  }
}).mount('#app');
