function calculateExposureFromFrameData(frameData) {
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

function calculateExposure(videoElement) {
  const tempCanvas = new OffscreenCanvas(videoElement.videoWidth, videoElement.videoHeight);
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
  const imageData = tempCtx.getImageData(0, 0, videoElement.videoWidth, videoElement.videoHeight);
  const frameData = imageData.data;
  return calculateExposureFromFrameData(frameData);
}
