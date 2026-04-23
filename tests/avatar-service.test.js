const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');

const { processAvatarImage, AVATAR_MAX_BYTES } = require('../src/services/avatarService');

async function makeImage({ format, width = 800, height = 600 }) {
    const base = sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 200, g: 40, b: 40 },
        },
    });
    if (format === 'jpeg') return base.jpeg().toBuffer();
    if (format === 'png') return base.png().toBuffer();
    if (format === 'webp') return base.webp().toBuffer();
    throw new Error(`unknown format ${format}`);
}

test('processAvatarImage accepts a JPEG and returns a 512x512 webp buffer', async () => {
    const input = await makeImage({ format: 'jpeg' });

    const output = await processAvatarImage(input);

    assert.ok(Buffer.isBuffer(output.buffer));
    assert.equal(output.extension, 'webp');
    const meta = await sharp(output.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
});

test('processAvatarImage accepts a PNG and returns a 512x512 webp buffer', async () => {
    const input = await makeImage({ format: 'png' });

    const output = await processAvatarImage(input);

    const meta = await sharp(output.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
});

test('processAvatarImage rejects a WebP upload with AVATAR_TYPE_INVALID', async () => {
    const input = await makeImage({ format: 'webp' });

    await assert.rejects(
        () => processAvatarImage(input),
        (err) => err.code === 'AVATAR_TYPE_INVALID' && err.status === 400,
    );
});

test('processAvatarImage rejects a non-image buffer with AVATAR_TYPE_INVALID', async () => {
    const input = Buffer.from('not an image', 'utf8');

    await assert.rejects(
        () => processAvatarImage(input),
        (err) => err.code === 'AVATAR_TYPE_INVALID' && err.status === 400,
    );
});

test('AVATAR_MAX_BYTES is 5 MB', () => {
    assert.equal(AVATAR_MAX_BYTES, 5 * 1024 * 1024);
});
