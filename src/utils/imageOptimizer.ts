/**
 * Utility to compress, resize, auto-rotate, and optimize images to WebP format client-side.
 * Target file size: 100–150 KB
 */
export async function optimizeImage(
  base64OrFile: string | File,
  quality = 0.75,
  maxDimension = 1024
): Promise<string> {
  let file: Blob;

  if (typeof base64OrFile === 'string') {
    if (base64OrFile.startsWith('data:')) {
      file = base64ToBlob(base64OrFile);
    } else {
      return base64OrFile; // not a base64 image path
    }
  } else {
    file = base64OrFile;
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  let { width, height } = bitmap;

  // Enforce maximum dimensions while maintaining aspect ratio
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(bitmap, 0, 0, width, height);

  // Progressive recursive compression down to 100-150KB
  let currentQuality = quality;
  let compressedBase64 = canvas.toDataURL('image/webp', currentQuality);
  let sizeKB = getBase64SizeKB(compressedBase64);

  let iterations = 0;
  // If it exceeds 150KB, recursively scale down dimensions and quality
  while (sizeKB > 150 && currentQuality > 0.3 && iterations < 5) {
    currentQuality -= 0.1;
    width = Math.round(width * 0.9);
    height = Math.round(height * 0.9);
    
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(bitmap, 0, 0, width, height);
    
    compressedBase64 = canvas.toDataURL('image/webp', currentQuality);
    sizeKB = getBase64SizeKB(compressedBase64);
    iterations++;
  }

  return compressedBase64;
}

// Helpers
function base64ToBlob(base64: string): Blob {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  
  return new Blob([uInt8Array], { type: contentType });
}

function getBase64SizeKB(base64: string): number {
  const base64String = base64.split(',')[1];
  const stringLength = base64String.length;
  const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383812; // approximate size
  return sizeInBytes / 1024;
}
