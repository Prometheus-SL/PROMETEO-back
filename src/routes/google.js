const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../http/asyncHandler');
const { createHttpError } = require('../http/errors');
const { ok } = require('../http/responses');
const {
    completeGoogleTask,
    getGoogleWorkspaceSummary,
    rescheduleGoogleTask,
} = require('../services/googleIntegration');

const router = express.Router();

router.get('/summary', authenticateToken, asyncHandler(async (req, res) => {
    const summary = await getGoogleWorkspaceSummary(req.user, {
        calendar: {
            limit: req.query.calendarLimit,
            horizonDays: req.query.horizonDays,
        },
        tasks: {
            taskListsLimit: req.query.taskListsLimit,
            itemsLimit: req.query.tasksLimit,
        },
        inbox: {
            itemsLimit: req.query.messagesLimit,
        },
    });

    return ok(res, summary);
}));

router.post('/tasks/:taskListId/:taskId/complete', authenticateToken, asyncHandler(async (req, res) => {
    const task = await completeGoogleTask(req.user, req.params.taskListId, req.params.taskId);
    return ok(res, { task }, { message: 'Task marked as completed.' });
}));

router.post('/tasks/:taskListId/:taskId/reschedule', authenticateToken, asyncHandler(async (req, res) => {
    const due = String(req.body?.due || '').trim();
    if (!due) {
        throw createHttpError(400, 'GOOGLE_TASK_DUE_REQUIRED', 'A due date is required to reschedule the task.');
    }

    const task = await rescheduleGoogleTask(req.user, req.params.taskListId, req.params.taskId, due);
    return ok(res, { task }, { message: 'Task rescheduled.' });
}));

module.exports = router;
