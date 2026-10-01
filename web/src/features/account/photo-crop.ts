export type CropState = { zoom: number; offsetX: number; offsetY: number };
export type CropRect = { sx: number; sy: number; size: number };

/** Returns the source square covered by a circular preview of viewportSize. */
export function cropRect(imageWidth: number, imageHeight: number, viewportSize: number, state: CropState): CropRect {
  const base = Math.max(viewportSize / imageWidth, viewportSize / imageHeight);
  const scale = base * Math.max(1, state.zoom);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const maxX = Math.max(0, (renderedWidth - viewportSize) / 2);
  const maxY = Math.max(0, (renderedHeight - viewportSize) / 2);
  const x = Math.min(maxX, Math.max(-maxX, state.offsetX));
  const y = Math.min(maxY, Math.max(-maxY, state.offsetY));
  return { sx: Math.max(0, Math.min(imageWidth - viewportSize / scale, (-x + (renderedWidth - viewportSize) / 2) / scale)), sy: Math.max(0, Math.min(imageHeight - viewportSize / scale, (-y + (renderedHeight - viewportSize) / 2) / scale)), size: viewportSize / scale };
}

export function outputSize(size = 512): number { return Math.max(1, Math.round(size)); }
