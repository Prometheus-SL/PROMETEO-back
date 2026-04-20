const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const {
    getSpotifyPlaybackState,
    getSpotifyPlaylistTracks,
    getSpotifyPlaylists,
    getSpotifyQueue,
    getSpotifyStatus,
    getSpotifyWebPlaybackToken,
    nextSpotifyTrack,
    pauseSpotify,
    playSpotify,
    playSpotifyTrack,
    previousSpotifyTrack,
    searchSpotify,
    seekSpotify,
    setSpotifyRepeat,
    setSpotifyShuffle,
    setSpotifyVolume,
    transferSpotifyPlayback,
} = require('../services/spotifyIntegration');

const router = express.Router();

router.get('/status', authenticateToken, asyncHandler(async (req, res) => {
    const spotify = await getSpotifyStatus(req.user);
    return ok(res, { spotify });
}));

router.get('/player', authenticateToken, asyncHandler(async (req, res) => {
    const playbackState = await getSpotifyPlaybackState(req.user);
    return ok(res, { playbackState });
}));

router.get('/player/queue', authenticateToken, asyncHandler(async (req, res) => {
    const queue = await getSpotifyQueue(req.user);
    return ok(res, { queue });
}));

router.get('/player/web-token', authenticateToken, asyncHandler(async (req, res) => {
    const token = await getSpotifyWebPlaybackToken(req.user);
    return ok(res, token);
}));

router.put('/player/transfer', authenticateToken, asyncHandler(async (req, res) => {
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!deviceId) {
        throw createHttpError(400, 'SPOTIFY_DEVICE_ID_REQUIRED', 'deviceId is required to transfer playback.');
    }

    await transferSpotifyPlayback(req.user, deviceId, { play: req.body?.play !== false });
    return ok(res, null, { message: 'Playback transferred.' });
}));

router.put('/player/play-track', authenticateToken, asyncHandler(async (req, res) => {
    const uri = String(req.body?.uri || '').trim();
    if (!uri) {
        throw createHttpError(400, 'SPOTIFY_URI_REQUIRED', 'uri is required to play a track.');
    }

    await playSpotifyTrack(req.user, uri);
    return ok(res, null, { message: 'Playback updated.' });
}));

router.put('/player/play', authenticateToken, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : undefined;
    await playSpotify(req.user, body);
    return ok(res, null, { message: 'Playback started.' });
}));

router.put('/player/pause', authenticateToken, asyncHandler(async (req, res) => {
    await pauseSpotify(req.user);
    return ok(res, null, { message: 'Playback paused.' });
}));

router.post('/player/next', authenticateToken, asyncHandler(async (req, res) => {
    await nextSpotifyTrack(req.user);
    return ok(res, null, { message: 'Skipping to the next track.' });
}));

router.post('/player/previous', authenticateToken, asyncHandler(async (req, res) => {
    await previousSpotifyTrack(req.user);
    return ok(res, null, { message: 'Returning to the previous track.' });
}));

router.put('/player/seek', authenticateToken, asyncHandler(async (req, res) => {
    const positionMs = Number(req.body?.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw createHttpError(400, 'SPOTIFY_POSITION_INVALID', 'positionMs must be a number greater than or equal to 0.');
    }

    await seekSpotify(req.user, positionMs);
    return ok(res, null, { message: 'Playback position updated.' });
}));

router.put('/player/volume', authenticateToken, asyncHandler(async (req, res) => {
    const volumePercent = Number(req.body?.volumePercent);
    if (!Number.isFinite(volumePercent)) {
        throw createHttpError(400, 'SPOTIFY_VOLUME_INVALID', 'volumePercent must be a number between 0 and 100.');
    }

    await setSpotifyVolume(req.user, volumePercent);
    return ok(res, null, { message: 'Volume updated.' });
}));

router.put('/player/shuffle', authenticateToken, asyncHandler(async (req, res) => {
    if (typeof req.body?.state !== 'boolean') {
        throw createHttpError(400, 'SPOTIFY_SHUFFLE_INVALID', 'state must be a boolean for shuffle.');
    }

    await setSpotifyShuffle(req.user, req.body.state);
    return ok(res, null, { message: 'Shuffle updated.' });
}));

router.put('/player/repeat', authenticateToken, asyncHandler(async (req, res) => {
    const state = String(req.body?.state || '').trim();
    if (!['off', 'track', 'context'].includes(state)) {
        throw createHttpError(400, 'SPOTIFY_REPEAT_INVALID', 'state must be off, track, or context.');
    }

    await setSpotifyRepeat(req.user, state);
    return ok(res, null, { message: 'Repeat updated.' });
}));

router.get('/search', authenticateToken, asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) throw createHttpError(400, 'SPOTIFY_SEARCH_QUERY_REQUIRED', 'q is required.');
    const types = String(req.query.type || 'track');
    const results = await searchSpotify(req.user, q, types, req.query.limit, req.query.offset);
    return ok(res, results);
}));

router.get('/playlists', authenticateToken, asyncHandler(async (req, res) => {
    const playlists = await getSpotifyPlaylists(req.user, req.query.limit, req.query.offset);
    return ok(res, playlists);
}));

router.get('/playlists/:playlistId/tracks', authenticateToken, asyncHandler(async (req, res) => {
    const tracks = await getSpotifyPlaylistTracks(req.user, req.params.playlistId, req.query.limit, req.query.offset);
    return ok(res, tracks);
}));

module.exports = router;
