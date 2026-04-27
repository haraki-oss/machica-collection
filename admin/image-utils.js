/**
 * machica Admin - Image Utilities
 */

const ImageUtils = {
    /**
     * 画像を圧縮・リサイズする
     * @param {string} base64 - 元の画像(data:image/...)
     * @param {number} maxWidth - 最大幅 (デフォルト: 1200)
     * @param {number} quality - 画質 0.0〜1.0 (デフォルト: 0.7)
     * @returns {Promise<string>} 圧縮後の base64
     */
    async compress(base64, maxWidth = 1200, quality = 0.75) {
        if (!base64 || !base64.startsWith('data:image')) return base64;

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = base64;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // サイズ調整
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // JPEG 形式で圧縮
                const compressedBase64 = canvas.toDataURL('image/jpeg', quality);

                // 元のサイズと比較して、小さくなった場合のみ返す
                if (compressedBase64.length < base64.length) {
                    resolve(compressedBase64);
                } else {
                    resolve(base64);
                }
            };
            img.onerror = (e) => reject(e);
        });
    }
};
