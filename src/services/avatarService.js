const sharp = require('sharp');
const { createHttpError } = require('../http/errors');

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE_PX = 512;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png']);

async function processAvatarImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw createHttpError(400, 'AVATAR_FILE_REQUIRED', 'No image file was received.');
    }

    let metadata;
    try {
        metadata = await sharp(buffer).metadata();
    } catch (_error) {
        throw createHttpError(400, 'AVATAR_TYPE_INVALID', 'The uploaded file is not a valid image.');
    }

    if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
        throw createHttpError(400, 'AVATAR_TYPE_INVALID', 'Only JPG and PNG images are accepted.');
    }

    let processed;
    try {
        processed = await sharp(buffer)
            .rotate()
            .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'center' })
            .webp({ quality: 85 })
            .toBuffer();
    } catch (_error) {
        throw createHttpError(500, 'AVATAR_PROCESSING_FAILED', 'The image could not be processed.');
    }

    return { buffer: processed, extension: 'webp' };
}

module.exports = {
    processAvatarImage,
    AVATAR_MAX_BYTES,
    AVATAR_SIZE_PX,
};
