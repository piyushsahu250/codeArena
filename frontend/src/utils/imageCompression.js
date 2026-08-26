// Client-side resize/compress for profile photos before they're sent as a data: URL — this
// platform stores profilePhotoUrl directly as a data URL with no separate file storage (see
// backend/src/routes/profile.js's comment), so an uncompressed phone photo (often 3-8MB) would
// bloat that column and blow past the backend's 2MB data-URL cap. Downscales to a max square
// (photos are displayed as circular avatars, so cropping to square first avoids a squashed oval)
// and re-encodes as JPEG at a moderate quality — plenty for a small avatar.
export function compressImageToDataUrl(file, { maxSize = 320, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Could not read the selected image."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
