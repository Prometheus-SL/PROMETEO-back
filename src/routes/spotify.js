const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
    getSpotifyPlaybackState,
    getSpotifyQueue,
    getSpotifyStatus,
    nextSpotifyTrack,
    pauseSpotify,
    playSpotify,
    playSpotifyTrack,
    previousSpotifyTrack,
    seekSpotify,
    setSpotifyRepeat,
    setSpotifyShuffle,
    setSpotifyVolume,
} = require('../services/spotifyIntegration');

const router = express.Router();

router.get('/status', authenticateToken, async (req, res, next) => {
    try {
        const spotify = await getSpotifyStatus(req.user);
        res.json({
            success: true,
            data: {
                spotify,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get('/player', authenticateToken, async (req, res, next) => {
    try {
        const playbackState = await getSpotifyPlaybackState(req.user);
        res.json({
            success: true,
            data: {
                playbackState,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get('/player/queue', authenticateToken, async (req, res, next) => {
    try {
        const queue = await getSpotifyQueue(req.user);
        res.json({
            success: true,
            data: {
                queue,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/play-track', authenticateToken, async (req, res, next) => {
    try {
        const uri = String(req.body?.uri || '').trim();
        if (!uri) {
            throw Object.assign(new Error('uri es requerido para reproducir una pista.'), {
                status: 400,
                code: 'SPOTIFY_URI_REQUIRED',
            });
        }

        await playSpotifyTrack(req.user, uri);
        res.json({
            success: true,
            message: 'Reproduccion actualizada.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/play', authenticateToken, async (req, res, next) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : undefined;
        await playSpotify(req.user, body);
        res.json({
            success: true,
            message: 'Reproduccion iniciada.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/pause', authenticateToken, async (req, res, next) => {
    try {
        await pauseSpotify(req.user);
        res.json({
            success: true,
            message: 'Reproduccion pausada.',
        });
    } catch (error) {
        next(error);
    }
});

router.post('/player/next', authenticateToken, async (req, res, next) => {
    try {
        await nextSpotifyTrack(req.user);
        res.json({
            success: true,
            message: 'Saltando a la siguiente pista.',
        });
    } catch (error) {
        next(error);
    }
});

router.post('/player/previous', authenticateToken, async (req, res, next) => {
    try {
        await previousSpotifyTrack(req.user);
        res.json({
            success: true,
            message: 'Volviendo a la pista anterior.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/seek', authenticateToken, async (req, res, next) => {
    try {
        const positionMs = Number(req.body?.positionMs);
        if (!Number.isFinite(positionMs) || positionMs < 0) {
            throw Object.assign(new Error('positionMs debe ser un numero mayor o igual a 0.'), {
                status: 400,
                code: 'SPOTIFY_POSITION_INVALID',
            });
        }

        await seekSpotify(req.user, positionMs);
        res.json({
            success: true,
            message: 'Posicion de reproduccion actualizada.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/volume', authenticateToken, async (req, res, next) => {
    try {
        const volumePercent = Number(req.body?.volumePercent);
        if (!Number.isFinite(volumePercent)) {
            throw Object.assign(new Error('volumePercent debe ser un numero entre 0 y 100.'), {
                status: 400,
                code: 'SPOTIFY_VOLUME_INVALID',
            });
        }

        await setSpotifyVolume(req.user, volumePercent);
        res.json({
            success: true,
            message: 'Volumen actualizado.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/shuffle', authenticateToken, async (req, res, next) => {
    try {
        if (typeof req.body?.state !== 'boolean') {
            throw Object.assign(new Error('state debe ser booleano para shuffle.'), {
                status: 400,
                code: 'SPOTIFY_SHUFFLE_INVALID',
            });
        }

        await setSpotifyShuffle(req.user, req.body.state);
        res.json({
            success: true,
            message: 'Shuffle actualizado.',
        });
    } catch (error) {
        next(error);
    }
});

router.put('/player/repeat', authenticateToken, async (req, res, next) => {
    try {
        const state = String(req.body?.state || '').trim();
        if (!['off', 'track', 'context'].includes(state)) {
            throw Object.assign(new Error('state debe ser off, track o context.'), {
                status: 400,
                code: 'SPOTIFY_REPEAT_INVALID',
            });
        }

        await setSpotifyRepeat(req.user, state);
        res.json({
            success: true,
            message: 'Repeat actualizado.',
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
