// camera/image-processor.js

function calculateExposure(frameData) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < frameData.length; i += 4) {
    const grayscale = Math.round(0.299 * frameData[i] + 0.587 * frameData[i + 1] + 0.114 * frameData[i + 2]);
    histogram[grayscale]++;
  }
  let totalBrightness = 0;
  for (let i = 0; i < histogram.length; i++) totalBrightness += histogram[i] * i;
  const totalPixels = frameData.length / 4;
  const averageBrightness = totalBrightness / totalPixels;
  return Math.round((averageBrightness / 255) * 100);
}

function initializeFrameProcessor(vueRefs, externalDeps) {
  const { video, exposure, predictedLabel } = vueRefs;
  const { getSpecs, getTfModel, lodash } = externalDeps;

  const frameProcessorInternal = {
    scaleRatio: 4,
    offscreenCanvas: new OffscreenCanvas(1, 1),
    ctx: null,
    aiCanvas: new OffscreenCanvas(1, 1),
    aiCtx: null,
    modelInputShape: null,
    predictionHistory: [],
    stablePredictionCount: 0,
    lastConfirmedPrediction: []
  };

  const STABILITY_THRESHOLD = 3;

  const throttledProcessFrameLocal = lodash.throttle(async () => {
    const currentTfModel = getTfModel();
    if (!video.value || video.value.readyState < video.value.HAVE_METADATA || !currentTfModel) {
      return;
    }

    if (!frameProcessorInternal.ctx) {
      frameProcessorInternal.ctx = frameProcessorInternal.offscreenCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    const scaledWidth = Math.floor(video.value.videoWidth / frameProcessorInternal.scaleRatio);
    const scaledHeight = Math.floor(video.value.videoHeight / frameProcessorInternal.scaleRatio);

    if (frameProcessorInternal.offscreenCanvas.width !== scaledWidth || frameProcessorInternal.offscreenCanvas.height !== scaledHeight) {
      frameProcessorInternal.offscreenCanvas.width = scaledWidth;
      frameProcessorInternal.offscreenCanvas.height = scaledHeight;
    }
    frameProcessorInternal.ctx.drawImage(video.value, 0, 0, scaledWidth, scaledHeight);
    const imageDataForExposure = frameProcessorInternal.ctx.getImageData(0, 0, scaledWidth, scaledHeight);
    exposure.value = calculateExposure(imageDataForExposure.data);

    if (!frameProcessorInternal.modelInputShape) {
      frameProcessorInternal.modelInputShape = currentTfModel.inputs[0].shape.slice(1);
      frameProcessorInternal.aiCanvas.width = frameProcessorInternal.modelInputShape[1];
      frameProcessorInternal.aiCanvas.height = frameProcessorInternal.modelInputShape[0];
      frameProcessorInternal.aiCtx = frameProcessorInternal.aiCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }

    const [inputHeight, inputWidth] = frameProcessorInternal.modelInputShape;

    const videoElement = video.value;
    const vidWidth = videoElement.videoWidth;
    const vidHeight = videoElement.videoHeight;

    let sx = 0, sy = 0, sWidth = 0, sHeight = 0; // Initialize crop parameters

    if (vidWidth > 0 && vidHeight > 0) {
      // Calculate aspect ratio based on browser width and 3/5 of screen height
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const targetViewHeight = viewportHeight * (2 / 5);
      const targetAspectRatio = viewportWidth / targetViewHeight;

      const currentAspectRatio = vidWidth / vidHeight;

      if (currentAspectRatio > targetAspectRatio) {
        // Video is wider than 16:9. Crop sides. Use full height.
        sHeight = vidHeight;
        sWidth = Math.round(sHeight * targetAspectRatio);
        sx = Math.round((vidWidth - sWidth) / 2);
        sy = 0;
      } else { // currentAspectRatio <= targetAspectRatio
        // Video is taller than 16:9 or is exactly 16:9. Crop top/bottom. Use full width.
        sWidth = vidWidth;
        sHeight = Math.round(sWidth / targetAspectRatio);
        sx = 0;
        sy = Math.round((vidHeight - sHeight) / 2);
      }

      // Clamp coordinates to be non-negative
      sx = Math.max(0, sx);
      sy = Math.max(0, sy);

      // Adjust sWidth and sHeight to fit within the video frame from sx, sy,
      // and ensure they are not negative.
      sWidth = Math.max(0, Math.min(sWidth, vidWidth - sx));
      sHeight = Math.max(0, Math.min(sHeight, vidHeight - sy));

      // If sWidth or sHeight ended up as 0 (e.g. if video dimensions were 0 initially)
      // we will fill with black later, so no need to adjust them here for drawing.
      if (sWidth === 0 || sHeight === 0) {
        console.warn('Calculated crop dimensions for AI are zero.');
      }
    }

    // Ensure aiCtx is available (it should be if modelInputShape is set)
    if (frameProcessorInternal.aiCtx) {
      if (sWidth > 0 && sHeight > 0) {
        // Draw the cropped and centered portion of the video onto the aiCanvas,
        // scaling it to the model's input dimensions.
        frameProcessorInternal.aiCtx.drawImage(
          videoElement,
          sx, sy, sWidth, sHeight,       // Source rectangle from video
          0, 0, inputWidth, inputHeight  // Destination rectangle on aiCanvas
        );
      } else {
        // If calculated crop dimensions are invalid (e.g., video dimensions are zero, or calculation error),
        // fill the AI canvas with black to provide a consistent input to the model.
        frameProcessorInternal.aiCtx.fillStyle = 'black';
        frameProcessorInternal.aiCtx.fillRect(0, 0, inputWidth, inputHeight);
      }
    }
    const frameImageDataForAI = frameProcessorInternal.aiCtx.getImageData(0, 0, inputWidth, inputHeight);

    const inputTensor = tf.tidy(() => {
      const tensor = tf.browser.fromPixels(frameImageDataForAI);
      const floatTensor = tensor.cast('float32');
      return floatTensor.expandDims(0);
    });

    let rawPredictions = [];
    try {
      const outputTensor = currentTfModel.execute(inputTensor);
      const outputData = outputTensor.dataSync();
      const confidenceThreshold = 0.90;
      const labels = ['OVERHEAD', 'ANGLED', 'BADCROP', 'STRAIGHT']; // Make sure this matches dict.txt

      if (outputData.length > 0) {
        for (let i = 0; i < outputData.length; i++) {
          if (outputData[i] > confidenceThreshold) {
            const label = labels[i];
            rawPredictions.push(label);
          }
        }
      }
      tf.dispose(outputTensor);
    } catch (error) {
      console.error("Error during model prediction:", error);
    } finally {
      tf.dispose(inputTensor);
    }

    // Stabilize predictions
    let currentPredictionString = rawPredictions.slice().sort().join(',');
    let lastPredictionInHistoryString = frameProcessorInternal.predictionHistory.length > 0 ?
      frameProcessorInternal.predictionHistory[frameProcessorInternal.predictionHistory.length - 1].slice().sort().join(',') :
      null;

    if (currentPredictionString === lastPredictionInHistoryString) {
      frameProcessorInternal.stablePredictionCount++;
    } else {
      frameProcessorInternal.stablePredictionCount = 1;
    }
    frameProcessorInternal.predictionHistory.push(rawPredictions);
    if (frameProcessorInternal.predictionHistory.length > STABILITY_THRESHOLD + 2) {
      frameProcessorInternal.predictionHistory.shift();
    }

    let finalPredictionsToDisplay = frameProcessorInternal.lastConfirmedPrediction;

    if (frameProcessorInternal.stablePredictionCount >= STABILITY_THRESHOLD) {
      finalPredictionsToDisplay = rawPredictions;
      frameProcessorInternal.lastConfirmedPrediction = rawPredictions;
    }

    const displayWithExposure = [...finalPredictionsToDisplay];
    if (exposure.value < 30) displayWithExposure.push('TOODARK');
    else if (exposure.value > 70) displayWithExposure.push('TOOLIGHT');

    if (lodash.xor(predictedLabel.value, displayWithExposure).length > 0) {
      predictedLabel.value = displayWithExposure;
    }

  }, 200);

  function processFrameLocal() {
    throttledProcessFrameLocal();
    requestAnimationFrame(processFrameLocal);
  }

  return { startProcessing: processFrameLocal };
}
