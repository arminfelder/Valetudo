import React from "react";
import {
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Chip,
    Stack,
    TextField,
    Typography
} from "@mui/material";
import {Layers as FloorMapsIcon} from "@mui/icons-material";
import {
    FloorMap,
    useMultiFloorMapMutation,
    useMultiFloorMapPropertiesQuery,
    useMultiFloorMapQuery
} from "../api";
import ConfirmationDialog from "../components/ConfirmationDialog";
import {ListMenu} from "../components/list_menu/ListMenu";
import {ToggleSwitchListMenuItem} from "../components/list_menu/ToggleSwitchListMenuItem";
import PaperContainer from "../components/PaperContainer";

type PendingAction =
    | { kind: "select", map: FloorMap }
    | { kind: "delete", map: FloorMap }
    | { kind: "rename", map: FloorMap };

const mapLabel = (map: FloorMap): string => {
    return map.name ?? `Map ${map.id}`;
};

const segmentSummary = (map: FloorMap): string => {
    if (map.segments.length === 0) {
        return "No segments";
    }

    const names = map.segments.map(s => {
        return s.name;
    }).filter(Boolean);

    return names.length > 0 ?
        `${map.segments.length} segments: ${names.join(", ")}` :
        `${map.segments.length} segments`;
};

const FloorMapCard = ({map, multiFloorEnabled, busy, onAction}: {
    map: FloorMap,
    multiFloorEnabled: boolean,
    busy: boolean,
    onAction: (action: PendingAction) => void
}): React.ReactElement => {
    return (
        <Card variant="outlined">
            <CardContent>
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6">{mapLabel(map)}</Typography>
                    {map.active && <Chip size="small" color="success" label="Active"/>}
                </Stack>
                <Typography variant="body2" color="textSecondary">
                    {segmentSummary(map)}
                </Typography>
            </CardContent>
            <CardActions>
                <Button
                    size="small"
                    disabled={busy || map.active || !multiFloorEnabled}
                    onClick={() => {
                        onAction({kind: "select", map: map});
                    }}
                >
                    Use this map
                </Button>
                <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                        onAction({kind: "rename", map: map});
                    }}
                >
                    Rename
                </Button>
                <Button
                    size="small"
                    color="error"
                    disabled={busy || map.active || !multiFloorEnabled}
                    onClick={() => {
                        onAction({kind: "delete", map: map});
                    }}
                >
                    Delete
                </Button>
            </CardActions>
        </Card>
    );
};

const FloorMaps = (): React.ReactElement => {
    const {data: state, isFetching, isError, error} = useMultiFloorMapQuery();
    const {data: properties} = useMultiFloorMapPropertiesQuery();
    const {mutate: sendAction, isPending} = useMultiFloorMapMutation();

    const [pending, setPending] = React.useState<PendingAction | null>(null);
    const [newName, setNewName] = React.useState("");

    const maxNameLength = properties?.maxNameLength ?? 32;
    const busy = isFetching || isPending;

    const closeDialog = () => {
        setPending(null);
    };

    return (
        <PaperContainer>
            <ListMenu
                primaryHeader={"Floor Maps"}
                secondaryHeader={"Maps for several floors, stored by the robot"}
                listItems={[
                    <ToggleSwitchListMenuItem
                        key="multiFloorSwitch"
                        value={state?.enabled ?? false}
                        setValue={(value) => {
                            sendAction({action: "set_enabled", enabled: value});
                        }}
                        disabled={busy || isError}
                        loadError={isError}
                        primaryLabel={"Multi-floor maps"}
                        secondaryLabel={"Let the robot store more than one map"}
                        icon={<FloorMapsIcon/>}
                    />
                ]}
            />
            <Box sx={{mt: 2}}>
                {isError && (
                    <Typography color="error">
                        Error loading the stored maps: {error instanceof Error ? error.message : String(error)}
                    </Typography>
                )}
                <Stack spacing={2}>
                    {(state?.maps ?? []).map(map => {
                        return (
                            <FloorMapCard
                                key={map.id}
                                map={map}
                                multiFloorEnabled={state?.enabled === true}
                                busy={busy}
                                onAction={(action) => {
                                    setNewName(action.map.name ?? "");
                                    setPending(action);
                                }}
                            />
                        );
                    })}
                </Stack>
                {state && !state.enabled && (
                    <Typography variant="body2" color="textSecondary" sx={{mt: 2}}>
                        Enable multi-floor maps to switch between or delete stored maps.
                        To add a map for another floor, enable multi-floor maps,
                        carry the robot and its dock to that floor and start a mapping pass.
                    </Typography>
                )}
            </Box>

            <ConfirmationDialog
                title={`Use "${pending ? mapLabel(pending.map) : ""}"?`}
                text={"Move the robot and its dock to this floor first. If the robot is not on the floor of the selected map, it can get lost."}
                open={pending?.kind === "select"}
                onClose={closeDialog}
                onAccept={() => {
                    if (pending) {
                        sendAction({action: "select", id: pending.map.id});
                    }
                    closeDialog();
                }}
            />
            <ConfirmationDialog
                title={`Delete "${pending ? mapLabel(pending.map) : ""}"?`}
                text={"The robot deletes this stored map. This cannot be undone."}
                open={pending?.kind === "delete"}
                onClose={closeDialog}
                onAccept={() => {
                    if (pending) {
                        sendAction({action: "delete", id: pending.map.id});
                    }
                    closeDialog();
                }}
            />
            <ConfirmationDialog
                title={`Rename "${pending ? mapLabel(pending.map) : ""}"`}
                open={pending?.kind === "rename"}
                onClose={closeDialog}
                onAccept={() => {
                    if (pending && newName.length <= maxNameLength) {
                        sendAction({action: "rename", id: pending.map.id, name: newName.trim()});
                    }
                    closeDialog();
                }}
            >
                <TextField
                    autoFocus
                    fullWidth
                    margin="dense"
                    label="Name"
                    helperText={"Leave empty to remove the name"}
                    value={newName}
                    slotProps={{htmlInput: {maxLength: maxNameLength}}}
                    onChange={(e) => {
                        setNewName(e.target.value);
                    }}
                />
            </ConfirmationDialog>
        </PaperContainer>
    );
};

export default FloorMaps;
