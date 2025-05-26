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
  const { video, exposure, predictedLabel, maskMargins } = vueRefs;
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
    const scaledWidth = Math.floor((video.value.videoWidth * (calculateVisibleArea().width / cameraCntr.value.clientWidth)) / frameProcessorInternal.scaleRatio);
    const scaledHeight = Math.floor((video.value.videoHeight * (calculateVisibleArea().height / cameraCntr.value.clientHeight)) / frameProcessorInternal.scaleRatio);

    if (frameProcessorInternal.offscreenCanvas.width !== scaledWidth || frameProcessorInternal.offscreenCanvas.height !== scaledHeight) {
      frameProcessorInternal.offscreenCanvas.width = scaledWidth;
      frameProcessorInternal.offscreenCanvas.height = scaledHeight;
    }

    const { offsetX, offsetY } = calculateVisibleArea();
    const cropX = (offsetX / cameraCntr.value.clientWidth) * video.value.videoWidth;
    const cropY = (offsetY / cameraCntr.value.clientHeight) * video.value.videoHeight;

    frameProcessorInternal.ctx.drawImage(
      video.value,
      cropX, cropY, scaledWidth * frameProcessorInternal.scaleRatio, scaledHeight * frameProcessorInternal.scaleRatio, // Source rectangle
      0, 0, scaledWidth, scaledHeight // Destination rectangle
    );

    const imageDataForExposure = frameProcessorInternal.ctx.getImageData(0, 0, scaledWidth, scaledHeight);
    exposure.value = calculateExposure(imageDataForExposure.data);

    if (!frameProcessorInternal.modelInputShape) {
      frameProcessorInternal.modelInputShape = currentTfModel.inputs[0].shape.slice(1);
      frameProcessorInternal.aiCanvas.width = frameProcessorInternal.modelInputShape[1];
      frameProcessorInternal.aiCanvas.height = frameProcessorInternal.modelInputShape[0];
      frameProcessorInternal.aiCtx = frameProcessorInternal.aiCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }

    const [inputHeight, inputWidth] = frameProcessorInternal.modelInputShape;
    frameProcessorInternal.aiCtx.drawImage(
      frameProcessorInternal.offscreenCanvas,
      0, 0, scaledWidth, scaledHeight, // Source rectangle
      0, 0, inputWidth, inputHeight // Destination rectangle
    );

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
      const confidenceThreshold = 0.95;
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
