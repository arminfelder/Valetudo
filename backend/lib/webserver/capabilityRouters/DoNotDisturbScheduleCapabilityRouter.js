const CapabilityRouter = require("./CapabilityRouter");
const ValetudoDNDWindow = require("../../entities/core/ValetudoDNDWindow");

class DoNotDisturbScheduleCapabilityRouter extends CapabilityRouter {
    initRoutes() {
        this.router.get("/", async (req, res) => {
            try {
                res.json({windows: await this.capability.getWindows()});
            } catch (e) {
                this.sendErrorResponse(req, res, e);
            }
        });

        this.router.put("/", this.validator, async (req, res) => {
            const windows = req.body?.windows;

            if (!Array.isArray(windows) || !windows.every(DoNotDisturbScheduleCapabilityRouter.IS_VALID_WINDOW)) {
                return res.sendStatus(400);
            }

            try {
                await this.capability.setWindows(windows.map(w => {
                    return new ValetudoDNDWindow({
                        id: w.id,
                        enabled: w.enabled,
                        start: {hour: w.start.hour, minute: w.start.minute},
                        end: {hour: w.end.hour, minute: w.end.minute},
                        dow: w.dow
                    });
                }));

                res.sendStatus(200);
            } catch (e) {
                this.sendErrorResponse(req, res, e);
            }
        });
    }

    /**
     * @param {any} w
     * @returns {boolean}
     */
    static IS_VALID_WINDOW(w) {
        const isValidTime = (t) => {
            return (
                Number.isInteger(t?.hour) && t.hour >= 0 && t.hour <= 23 &&
                Number.isInteger(t.minute) && t.minute >= 0 && t.minute <= 59
            );
        };

        return (
            typeof w === "object" && w !== null &&
            (w.id === undefined || (Number.isInteger(w.id) && w.id > 0)) &&
            typeof w.enabled === "boolean" &&
            isValidTime(w.start) &&
            isValidTime(w.end) &&
            Array.isArray(w.dow) &&
            w.dow.every(d => {
                return Number.isInteger(d) && d >= 0 && d <= 6;
            })
        );
    }
}

module.exports = DoNotDisturbScheduleCapabilityRouter;
