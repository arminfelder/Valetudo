const DoNotDisturbScheduleCapability = require("../../../core/capabilities/DoNotDisturbScheduleCapability");
const DreameMiotServices = require("../DreameMiotServices");
const ValetudoDNDWindow = require("../../../entities/core/ValetudoDNDWindow");

/**
 * Uses the task list of the DND service (siid 5 piid 4, Dreame X50 fw 4.3.9_2199).
 * Task 0 is the window of piids 1 to 3, which the DoNotDisturbCapability owns. This capability never touches it.
 *
 * @extends DoNotDisturbScheduleCapability<import("../DreameValetudoRobot")>
 */
class DreameDoNotDisturbScheduleCapability extends DoNotDisturbScheduleCapability {
    /**
     * @returns {Promise<Array<ValetudoDNDWindow>>}
     */
    async getWindows() {
        return (await this.readTasks())
            .filter(task => {
                return task.id !== DreameDoNotDisturbScheduleCapability.SINGLE_WINDOW_TASK_ID;
            })
            .map(task => {
                return new ValetudoDNDWindow({
                    id: task.id,
                    enabled: task.en === true,
                    start: DreameDoNotDisturbScheduleCapability.CONVERT_FROM_TIME_STRING(task.st),
                    end: DreameDoNotDisturbScheduleCapability.CONVERT_FROM_TIME_STRING(task.et),
                    dow: DreameDoNotDisturbScheduleCapability.CONVERT_FROM_WEEKDAY_MASK(task.wk ?? DreameDoNotDisturbScheduleCapability.ALL_DAYS_MASK)
                });
            })
            .sort((a, b) => {
                return a.id - b.id;
            });
    }

    /**
     * @param {Array<ValetudoDNDWindow>} windows
     * @returns {Promise<void>}
     */
    async setWindows(windows) {
        if (windows.length > this.getProperties().maxWindows) {
            throw new Error(`At most ${this.getProperties().maxWindows} windows are supported`);
        }

        const existingIds = (await this.readTasks()).map(task => {
            return task.id;
        }).filter(id => {
            return id !== DreameDoNotDisturbScheduleCapability.SINGLE_WINDOW_TASK_ID;
        });

        let nextId = Math.max(0, ...existingIds, ...windows.map(w => {
            return w.id ?? 0;
        })) + 1;

        const tasks = windows.map(window => {
            if (window.id === DreameDoNotDisturbScheduleCapability.SINGLE_WINDOW_TASK_ID) {
                throw new Error("Window id 0 is reserved for the single do-not-disturb window");
            }

            return {
                id: window.id ?? nextId++,
                en: window.enabled === true,
                st: DreameDoNotDisturbScheduleCapability.CONVERT_TO_TIME_STRING(window.start),
                et: DreameDoNotDisturbScheduleCapability.CONVERT_TO_TIME_STRING(window.end),
                wk: DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK(window.dow)
            };
        });

        const removedIds = existingIds.filter(id => {
            return !tasks.some(task => {
                return task.id === id;
            });
        });

        if (removedIds.length > 0) {
            await this.robot.miotHelper.executeAction(
                DreameMiotServices["GEN2"].DND.SIID,
                DreameMiotServices["GEN2"].DND.ACTIONS.DELETE_TASKS.AIID,
                [{
                    piid: DreameMiotServices["GEN2"].DND.PROPERTIES.TASKS.PIID,
                    value: removedIds.join(",")
                }]
            );
        }

        if (tasks.length > 0) {
            // The firmware merges by id. It never removes a task on a write.
            await this.robot.miotHelper.writeProperty(
                DreameMiotServices["GEN2"].DND.SIID,
                DreameMiotServices["GEN2"].DND.PROPERTIES.TASKS.PIID,
                JSON.stringify(tasks)
            );
        }
    }

    /**
     * @private
     * @returns {Promise<Array<{id: number, en: boolean, st: string, et: string, wk?: number}>>}
     */
    async readTasks() {
        const res = await this.robot.miotHelper.readProperty(
            DreameMiotServices["GEN2"].DND.SIID,
            DreameMiotServices["GEN2"].DND.PROPERTIES.TASKS.PIID
        );

        let tasks = res;
        if (typeof res === "string") {
            tasks = res.length > 0 ? JSON.parse(res) : [];
        }

        if (!Array.isArray(tasks)) {
            throw new Error("Received invalid DND task list");
        }

        return tasks.filter(task => {
            return (
                typeof task?.id === "number" &&
                typeof task.st === "string" &&
                typeof task.et === "string"
            );
        });
    }

    /**
     * @param {string} time "HH:MM"
     * @returns {{hour: number, minute: number}}
     */
    static CONVERT_FROM_TIME_STRING(time) {
        const splitTime = time.split(":");

        return {
            hour: parseInt(splitTime[0]),
            minute: parseInt(splitTime[1])
        };
    }

    /**
     * @param {{hour: number, minute: number}} time
     * @returns {string} "HH:MM"
     */
    static CONVERT_TO_TIME_STRING(time) {
        return `${time.hour.toString().padStart(2, "0")}:${time.minute.toString().padStart(2, "0")}`;
    }

    /**
     * Bit (6 - dow) is set for each day. Bit 6 is Sunday and bit 0 is Saturday. 0 means "once".
     *
     * @param {Array<number>} dow
     * @returns {number}
     */
    static CONVERT_TO_WEEKDAY_MASK(dow) {
        return [...new Set(dow)].reduce((mask, day) => {
            return mask | (1 << (6 - day));
        }, 0);
    }

    /**
     * @param {number} mask
     * @returns {Array<number>}
     */
    static CONVERT_FROM_WEEKDAY_MASK(mask) {
        return [0, 1, 2, 3, 4, 5, 6].filter(day => {
            return (mask & (1 << (6 - day))) !== 0;
        });
    }
}

DreameDoNotDisturbScheduleCapability.SINGLE_WINDOW_TASK_ID = 0;
DreameDoNotDisturbScheduleCapability.ALL_DAYS_MASK = 0x7f;

module.exports = DreameDoNotDisturbScheduleCapability;
