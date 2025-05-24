const { createApp, computed, ref, onMounted } = Vue;
let track = null;
let specs = [];

createApp({
  setup() {
    const video = ref(null);
    const pane = ref('permissions');
    const maskAspectRatio = ref("4/3");
    const maskMargins = ref(null);
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
      return { min: 35, max: 45 };
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

    const calculateMaskMargins = () => {
      setTimeout(() => {
        const maskAspectRatioStr = maskAspectRatio.value.split('/').map(Number);
        const maskAspectRatioNum = maskAspectRatioStr[0] / maskAspectRatioStr[1];
        const viewportWidth = cameraCntr.value.clientWidth;
        const viewportHeight = cameraCntr.value.clientHeight;
        const viewportAspectRatio = viewportWidth / viewportHeight;
        let horizontalMargin = 0;
        let verticalMargin = 0;

        if (viewportAspectRatio > maskAspectRatioNum) {
          const maskHeight = viewportHeight * 0.8;
          const maskWidth = maskHeight * maskAspectRatioNum;
          horizontalMargin = (viewportWidth - maskWidth) / 2;
          verticalMargin = viewportHeight * 0.05;
        } else {
          const maskWidth = viewportWidth * 0.8;
          const maskHeight = maskWidth / maskAspectRatioNum;
          horizontalMargin = viewportWidth * 0.05;
          verticalMargin = (viewportHeight - maskHeight) / 2;
        }

        maskMargins.value = {
          top: `${verticalMargin}px`,
          bottom: `${verticalMargin}px`,
          left: `${horizontalMargin}px`,
          right: `${horizontalMargin}px`
        };
      }, 100);
    };

    const isValidAngle = computed(() => {
      if (angle.value === null) return true;
      const { min, max } = currentSpecAngle.value;
      return angle.value >= min && angle.value <= max;
    });

    const isValidMask = computed(() => {
      const isGoodAngle = isValidAngle.value;
      const isGoodExposure = exposure.value >= 30 && exposure.value <= 70;
      return isGoodAngle && isGoodExposure;
    });

    const onLoadStream = async () => {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          aspectRatio: { exact: 16 / 9 },
          width: { ideal: 5120 / 2 },
          height: { ideal: 2880 / 2 },
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

    const captureImage = async () => { // Make the function async
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

      try {
        const blob = await captureOffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
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
        console.error("Error during image capture:", e); // Log the full error for better debugging
        alert(`An error occurred while capturing the image: ${e.message}`);
      }
    };

    const onToggleMask = () => {
      switch (maskAspectRatio.value) {
        case "4/3":
          maskAspectRatio.value = "5/4";
          break;
        case "5/4":
          maskAspectRatio.value = "16/9";
          break;
        case "16/9":
          maskAspectRatio.value = "4/3";
          break;
        default:
          maskAspectRatio.value = "4/3";
      }
      calculateMaskMargins();
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
          console.error('Failed to load specs.json:', error); // Keep this error for now
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
        calculateMaskMargins();
      } catch (error) {
        alert("Camera or motion sensor permissions are required to use this feature.");
      }
    };

    return {
      video,
      captureImage,
      angle,
      maskMargins,
      maskAspectRatio,
      onToggleMask,
      exposure,
      isValidAngle,
      isValidMask,
      pane,
      cameraCntr,
      predictedLabel,
      currentGuidelines,
      onRequestPermissions,
      hasDetected
    };
  }
}).mount('#app');
