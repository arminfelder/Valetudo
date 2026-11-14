import React, {FunctionComponent} from "react";
import {
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from "@mui/material";
import {Delete as DeleteIcon} from "@mui/icons-material";
import {
    Capability,
    DoNotDisturbTime,
    DoNotDisturbWindow,
    useDoNotDisturbScheduleMutation,
    useDoNotDisturbSchedulePropertiesQuery,
    useDoNotDisturbScheduleQuery
} from "../../api";
import {useCapabilitiesSupported} from "../../CapabilitiesProvider";
import {deepCopy} from "../../utils";
import {weekdays} from "../../valetudo/timers/TimerCard";
import {CapabilityItem} from "./CapabilityLayout";

const DAY_IN_MINUTES = 24 * 60;

const shiftTime = (time: DoNotDisturbTime, offset: number): { time: DoNotDisturbTime, dayShift: number } => {
    const minutes = time.hour * 60 + time.minute + offset;
    const dayShift = minutes < 0 ? -1 : (minutes >= DAY_IN_MINUTES ? 1 : 0);
    const wrapped = ((minutes % DAY_IN_MINUTES) + DAY_IN_MINUTES) % DAY_IN_MINUTES;

    return {
        time: {hour: Math.floor(wrapped / 60), minute: wrapped % 60},
        dayShift: dayShift
    };
};

// The days follow the start time, because the robot checks the day of the start time.
export const convertWindow = (window: DoNotDisturbWindow, offset: number): DoNotDisturbWindow => {
    const newWindow = deepCopy(window);
    const start = shiftTime(window.start, offset);

    newWindow.start = start.time;
    newWindow.end = shiftTime(window.end, offset).time;
    newWindow.dow = window.dow.map(day => {
        return (day + start.dayShift + 7) % 7;
    }).sort();

    return newWindow;
};

const localOffset = (): number => {
    return new Date().getTimezoneOffset() * -1;
};

const formatTime = (time: DoNotDisturbTime): string => {
    return `${time.hour.toString().padStart(2, "0")}:${time.minute.toString().padStart(2, "0")}`;
};

const parseTime = (value: string): DoNotDisturbTime | null => {
    const [hour, minute] = value.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
        return null;
    }

    return {hour: hour, minute: minute};
};

const WindowEditor: FunctionComponent<{
    window: DoNotDisturbWindow,
    onChange: (window: DoNotDisturbWindow) => void,
    onDelete: () => void
}> = ({window, onChange, onDelete}) => {
    return (
        <Stack spacing={1} sx={{mb: 2}}>
            <Stack direction="row" spacing={1} alignItems="center">
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={window.enabled}
                            onChange={(e) => {
                                onChange({...window, enabled: e.target.checked});
                            }}
                        />
                    }
                    label="Enabled"
                />
                <TextField
                    label="Start time"
                    type="time"
                    size="small"
                    value={formatTime(window.start)}
                    InputLabelProps={{shrink: true}}
                    onChange={(e) => {
                        const time = parseTime(e.target.value);
                        if (time) {
                            onChange({...window, start: time});
                        }
                    }}
                />
                <TextField
                    label="End time"
                    type="time"
                    size="small"
                    value={formatTime(window.end)}
                    InputLabelProps={{shrink: true}}
                    onChange={(e) => {
                        const time = parseTime(e.target.value);
                        if (time) {
                            onChange({...window, end: time});
                        }
                    }}
                />
                <IconButton aria-label="Delete window" onClick={onDelete}>
                    <DeleteIcon/>
                </IconButton>
            </Stack>
            <ToggleButtonGroup
                size="small"
                value={window.dow}
                onChange={(_, newDays: Array<number>) => {
                    onChange({...window, dow: [...newDays].sort()});
                }}
            >
                {weekdays.map(day => {
                    return (
                        <ToggleButton key={day.dow} value={day.dow} aria-label={day.label}>
                            {day.label.slice(0, 2)}
                        </ToggleButton>
                    );
                })}
            </ToggleButtonGroup>
            {window.dow.length === 0 && (
                <Typography variant="caption" color="textSecondary">
                    No day selected: the window runs once and then turns itself off.
                </Typography>
            )}
        </Stack>
    );
};

const DoNotDisturbScheduleControl: FunctionComponent = () => {
    const {
        data: schedule,
        isFetching: scheduleFetching,
        isError: scheduleError,
    } = useDoNotDisturbScheduleQuery();
    const {data: properties} = useDoNotDisturbSchedulePropertiesQuery();
    const {
        mutate: updateSchedule,
        isPending: scheduleUpdating
    } = useDoNotDisturbScheduleMutation();

    // Edited in local time, sent in UTC
    const [editWindows, setEditWindows] = React.useState<Array<DoNotDisturbWindow> | null>(null);
    React.useEffect(() => {
        if (schedule) {
            setEditWindows(schedule.windows.map(w => {
                return convertWindow(w, localOffset());
            }));
        }
    }, [schedule]);

    const maxWindows = properties?.maxWindows ?? 0;

    const content = React.useMemo(() => {
        if (scheduleError) {
            return (
                <Typography color="error">
                    Error loading the do-not-disturb schedule.
                </Typography>
            );
        }

        const windows = editWindows ?? [];

        return (
            <>
                {windows.length === 0 && (
                    <Typography color="textSecondary" sx={{mb: 2}}>
                        No additional windows.
                    </Typography>
                )}
                {windows.map((window, idx) => {
                    return (
                        <WindowEditor
                            key={window.id ?? `new-${idx}`}
                            window={window}
                            onChange={(newWindow) => {
                                const newWindows = deepCopy(windows);
                                newWindows[idx] = newWindow;
                                setEditWindows(newWindows);
                            }}
                            onDelete={() => {
                                setEditWindows(windows.filter((_, i) => {
                                    return i !== idx;
                                }));
                            }}
                        />
                    );
                })}
                <Stack direction="row" spacing={1}>
                    <Button
                        variant="outlined"
                        disabled={windows.length >= maxWindows}
                        onClick={() => {
                            setEditWindows([
                                ...windows,
                                {
                                    enabled: true,
                                    start: {hour: 22, minute: 0},
                                    end: {hour: 7, minute: 0},
                                    dow: [0, 1, 2, 3, 4, 5, 6]
                                }
                            ]);
                        }}
                    >
                        Add window
                    </Button>
                    <Button
                        loading={scheduleUpdating}
                        variant="outlined"
                        color="success"
                        onClick={() => {
                            updateSchedule({
                                windows: windows.map(w => {
                                    return convertWindow(w, -localOffset());
                                })
                            });
                        }}
                    >
                        Apply
                    </Button>
                </Stack>
            </>
        );
    }, [editWindows, maxWindows, scheduleError, scheduleUpdating, updateSchedule]);

    return (
        <CapabilityItem
            title={"Do not disturb schedule"}
            loading={scheduleUpdating || scheduleFetching || !schedule}
        >
            {content}
        </CapabilityItem>
    );
};

const DoNotDisturbSchedule: FunctionComponent = () => {
    const [supported] = useCapabilitiesSupported(Capability.DoNotDisturbSchedule);
    if (!supported) {
        return null;
    }

    return <DoNotDisturbScheduleControl/>;
};

export default DoNotDisturbSchedule;
