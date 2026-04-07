const fs = require('fs/promises');
const path = require('path');
const WhatsAppSession = require('../../models/WhatsAppSession');
const WhatsAppSessionChunk = require('../../models/WhatsAppSessionChunk');

const CHUNK_SIZE_BYTES = 1024 * 1024; // 1 MB por chunk para evitar límite de BSON

class WhatsAppMongoStore {
    constructor(defaultSessionId, options = {}) {
        this.defaultSessionId = defaultSessionId;
        this.logger = options.logger ?? null;
    }

    resolveSessionId(input) {
        if (!input) return this.defaultSessionId;
        if (typeof input === 'string') return input;
        if (typeof input === 'object' && input !== null) {
            if (typeof input.session === 'string') return input.session;
            if (typeof input.sessionId === 'string') return input.sessionId;
            if (typeof input.id === 'string') return input.id;
        }
        return this.defaultSessionId;
    }

    archivePath(sessionId) {
        return path.resolve(`${sessionId}.zip`);
    }

    async sessionExists(ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) return false;
        const exists = await WhatsAppSession.exists({ sessionId });
        return Boolean(exists);
    }

    async save(ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) throw new Error('sessionId es requerido');

        const explicitPath = (typeof ref === 'object' && ref !== null && ref.path) ? path.resolve(ref.path) : null;
        const archivePath = explicitPath ?? this.archivePath(sessionId);
        let archive;
        try {
            archive = await fs.readFile(archivePath);
        } catch (error) {
            if (this.logger) {
                this.logger.error?.('WhatsAppMongoStore: no se pudo leer el archivo de sesión', error);
            }
            throw error;
        }

        const chunks = [];
        for (let offset = 0, index = 0; offset < archive.length; offset += CHUNK_SIZE_BYTES, index += 1) {
            const slice = archive.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, archive.length));
            chunks.push({ index, data: slice });
        }

        await WhatsAppSessionChunk.deleteMany({ sessionId });
        if (chunks.length) {
            await WhatsAppSessionChunk.bulkWrite(
                chunks.map(({ index, data }) => ({
                    insertOne: {
                        document: {
                            sessionId,
                            index,
                            data,
                        },
                    },
                }))
            );
        }

        await WhatsAppSession.findOneAndUpdate(
            { sessionId },
            {
                sessionId,
                archiveSize: archive.length,
                chunkCount: chunks.length,
                lastSyncedAt: new Date(),
            },
            { upsert: true, setDefaultsOnInsert: true }
        );

        return true;
    }

    async extract(ref) {
        const sessionId = this.resolveSessionId(ref);
        const targetPath = ref?.path ?? ref?.filePath;
        if (!sessionId) throw new Error('sessionId es requerido');
        if (!targetPath) throw new Error('path es requerido para extraer la sesión');

        const metadata = await WhatsAppSession.findOne({ sessionId }, { chunkCount: 1 }).lean();
        if (!metadata || metadata.chunkCount === 0) {
            throw new Error(`No se encontró una sesión almacenada para ${sessionId}`);
        }

        const chunks = await WhatsAppSessionChunk.find({ sessionId }).sort({ index: 1 }).lean();
        if (!chunks.length) {
            throw new Error(`No se encontró ninguna parte de la sesión para ${sessionId}`);
        }

        const buffers = chunks.map((chunk) => {
            const raw = chunk?.data;
            if (!raw) return Buffer.alloc(0);
            if (Buffer.isBuffer(raw)) return raw;
            if (Array.isArray(raw?.data)) return Buffer.from(raw.data);
            if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
            if (typeof raw === 'string') return Buffer.from(raw, 'base64');
            if (Array.isArray(raw)) return Buffer.from(raw);
            return Buffer.from(raw);
        });
        const archive = Buffer.concat(buffers);

        const resolvedPath = path.resolve(targetPath);
        const dirPath = path.dirname(resolvedPath);
        if (dirPath && dirPath !== '.' && dirPath !== '') {
            await fs.mkdir(dirPath, { recursive: true });
        }
        await fs.writeFile(resolvedPath, archive);
        return resolvedPath;
    }

    async delete(ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) return;
        await WhatsAppSession.deleteOne({ sessionId });
        await WhatsAppSessionChunk.deleteMany({ sessionId });
    }

    async clear(ref) {
        return this.delete(ref);
    }

    async getState(ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) return null;
        const doc = await WhatsAppSession.findOne({ sessionId }, { state: 1 }).lean();
        return doc?.state ?? null;
    }

    async saveState(state, ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) throw new Error('sessionId es requerido');
        await WhatsAppSession.findOneAndUpdate(
            { sessionId },
            {
                sessionId,
                state,
            },
            { upsert: true, setDefaultsOnInsert: true }
        );
        return state;
    }

    async removeState(ref) {
        const sessionId = this.resolveSessionId(ref);
        if (!sessionId) return;
        await WhatsAppSession.updateOne({ sessionId }, { $unset: { state: 1 } });
    }
}

module.exports = { WhatsAppMongoStore };
