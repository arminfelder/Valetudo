const path = require("path");
const RateLimit = require("express-rate-limit");

const EGG_TERM_AUTHORIZATION = "Basic Y3lwaGVycHVua3M6Y3lwaGVycHVua3M=";

/**
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function isEggTermRequest(req) {
    return req.headers.authorization === EGG_TERM_AUTHORIZATION;
}

const eggTermLimiter = RateLimit.rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: () => "global",
    skip: (req) => {
        return !isEggTermRequest(req);
    }
});

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function eggTermHandler(req, res, next) {
    if (isEggTermRequest(req)) {
        if (req.url === "/") {
            return res.status(418).sendFile(path.join(__dirname, "res", "egg_term.html"));
        } else {
            return res.sendStatus(404);
        }
    }

    next();
}

module.exports = {
    eggTermHandler: eggTermHandler,
    eggTermLimiter: eggTermLimiter
};
