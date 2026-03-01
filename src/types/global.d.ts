// Type declarations for APIs not yet in TypeScript's lib
// ImageCapture is a Web API supported in Chromium browsers (including Teams desktop)

interface ImageCapture {
  grabFrame(): Promise<ImageBitmap>;
  takePhoto(photoSettings?: PhotoSettings): Promise<Blob>;
}

interface PhotoSettings {
  fillLightMode?: string;
  imageHeight?: number;
  imageWidth?: number;
  redEyeReduction?: boolean;
}

declare var ImageCapture: {
  prototype: ImageCapture;
  new (track: MediaStreamTrack): ImageCapture;
};
