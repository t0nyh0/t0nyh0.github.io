const { createApp, computed, ref, onMounted } = Vue;
let track = null;

createApp({
  setup() {
    const video = ref(null);
    const pane = ref('selectType');
    const cameraCntr = ref(null);
    const exposure = ref(50);
    const angle = ref(null);
    const captureOffscreenCanvas = new OffscreenCanvas(1, 1);
    const options = ref([]);
    const selectedOption = ref(null);

    // Dynamically validate angle based on selected option
    const isValidAngle = computed(() => {
      if (angle.value === null || !selectedOption.value) return true;
      const min = selectedOption.value.angle.min;
      const max = selectedOption.value.angle.max;
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

      const idealCameraHeight = 1080;
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
      track = mediaStream.getVideoTracks()[0];
    };

    const handleCapture = async () => {
      try {
        const imageData = await captureImage(video.value, captureOffscreenCanvas);
        downloadImage(imageData);
      } catch (e) {
        alert(`An error occurred while capturing the image: ${e.message}`);
      }
    };

    // Load options from options.json
    onMounted(async () => {
      try {
        const resp = await fetch('options.json');
        options.value = await resp.json();
      } catch (e) {
        alert('Failed to load options.');
      }
    });

    const onSelectType = async (option) => {
      selectedOption.value = option;
      pane.value = 'camera';

      if (DeviceMotionEvent?.requestPermission) await DeviceMotionEvent.requestPermission();
      window.addEventListener("deviceorientation", (event) => {
        if (event.beta !== null) angle.value = 90 - event.beta;
      });

      onLoadStream();
      setInterval(() => {
        if (video.value && video.value.readyState >= video.value.HAVE_CURRENT_DATA) {
          exposure.value = calculateExposure(video.value);
        }
      }, 500);
    };

    return {
      video,
      captureImage: handleCapture,
      angle,
      exposure,
      isValidAngle,
      isValid,
      pane,
      cameraCntr,
      options,
      onSelectType,
      selectedOption
    };
  }
}).mount('#app');
