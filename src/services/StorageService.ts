export class StorageService {
  /**
   * Compresses a base64 image down to ~100-150KB JPEG
   * @param base64Str The original base64 image string
   * @param quality Starting quality factor (0 to 1)
   */
  static async compressImage(base64Str: string, quality: number = 0.7): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        // Calculate new dimensions (max 800px width/height)
        const MAX_DIM = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(base64Str); // Fallback
        }

        ctx.drawImage(img, 0, 0, width, height);
        
        // Output as JPEG to save space
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        
        // If still too large, we could recursively compress, but 800px @ 0.7 JPEG is usually <150KB
        resolve(compressedBase64);
      };
      img.onerror = (error) => {
        reject(error);
      };
    });
  }

  /**
   * Helper to check if a string is a valid base64 image
   */
  static isValidBase64Image(str: string): boolean {
    if (!str) return false;
    return str.startsWith('data:image/');
  }
}
