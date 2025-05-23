// camera/model.js
let tfModel = null;

async function loadModel() {
  try {
    // tf is expected to be a global object from the TensorFlow.js CDN script
    tfModel = await tf.loadGraphModel('tfjs_model/model.json');
  } catch (error) {
    console.error('Failed to load TensorFlow.js model:', error);
    // It might be useful to re-throw the error if the calling code needs to react to failure
    // throw error;
  }
}
