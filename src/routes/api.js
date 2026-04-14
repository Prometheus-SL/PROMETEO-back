const express = require('express');

const router = express.Router();

router.use(require('./api/agents'));
router.use(require('./api/data'));
router.use(require('./api/users'));

module.exports = router;
