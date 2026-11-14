const CapabilityRouter = require("./CapabilityRouter");

class MultiFloorMapCapabilityRouter extends CapabilityRouter {
    initRoutes() {
        this.router.get("/", async (req, res) => {
            try {
                res.json({
                    enabled: await this.capability.isEnabled(),
                    maps: await this.capability.getMaps()
                });
            } catch (e) {
                this.sendErrorResponse(req, res, e);
            }
        });

        this.router.put("/", this.validator, async (req, res) => {
            const body = req.body ?? {};
            const hasValidId = Number.isInteger(body.id);

            try {
                switch (body.action) {
                    case "set_enabled":
                        if (typeof body.enabled !== "boolean") {
                            return res.sendStatus(400);
                        }
                        await this.capability.setEnabled(body.enabled);
                        break;
                    case "select":
                        if (!hasValidId) {
                            return res.sendStatus(400);
                        }
                        await this.capability.selectMap(body.id);
                        break;
                    case "rename":
                        if (!hasValidId || typeof body.name !== "string") {
                            return res.sendStatus(400);
                        }
                        await this.capability.renameMap(body.id, body.name);
                        break;
                    case "delete":
                        if (!hasValidId) {
                            return res.sendStatus(400);
                        }
                        await this.capability.deleteMap(body.id);
                        break;
                    default:
                        return res.sendStatus(400);
                }

                res.sendStatus(200);
            } catch (e) {
                this.sendErrorResponse(req, res, e);
            }
        });
    }
}

module.exports = MultiFloorMapCapabilityRouter;
