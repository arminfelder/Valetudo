import {Route} from "react-router";
import {Navigate, Routes} from "react-router-dom";
import MapManagement from "./MapManagement";
import EditMapPage from "../map/EditMapPage";
import {useCapabilitiesSupported} from "../CapabilitiesProvider";
import {Capability, useDuststreamingConfigurationQuery} from "../api";
import React from "react";
import RobotCoverageMapPage from "../map/RobotCoverageMapPage";
import SpectatorMapPage from "../map/SpectatorMapPage";
import FloorMaps from "./FloorMaps";

const OptionsRouter = (): React.ReactElement => {
    const [
        combinedVirtualRestrictionsCapabilitySupported,

        mapSegmentEditCapabilitySupported,
        mapSegmentRenameCapabilitySupported,

        mapAnnotationsCapabilitySupported,

        duststreamingSupported,

        multiFloorMapSupported,
    ] = useCapabilitiesSupported(
        Capability.CombinedVirtualRestrictions,

        Capability.MapSegmentEdit,
        Capability.MapSegmentRename,

        Capability.MapAnnotations,

        Capability.Duststreaming,

        Capability.MultiFloorMap
    );

    const {data: duststreamingConfiguration} = useDuststreamingConfigurationQuery({
        enabled: duststreamingSupported
    });
    const duststreamingPossible = duststreamingSupported && duststreamingConfiguration?.enabled !== false;

    return (
        <Routes>
            <Route path={""} element={<MapManagement />}/>

            {
                (mapSegmentEditCapabilitySupported || mapSegmentRenameCapabilitySupported) &&
                <Route
                    path={"segments"}
                    element={
                        <EditMapPage
                            mode={"segments"}
                        />
                    }
                />
            }
            {
                combinedVirtualRestrictionsCapabilitySupported &&
                <Route
                    path={"virtual_restrictions"}
                    element={
                        <EditMapPage
                            mode={"virtual_restrictions"}
                        />
                    }
                />
            }
            {
                mapAnnotationsCapabilitySupported &&
                <Route
                    path={"annotations"}
                    element={
                        <EditMapPage
                            mode={"annotations"}
                        />
                    }
                />
            }

            {
                multiFloorMapSupported &&
                <Route path={"floor_maps"} element={<FloorMaps/>}/>
            }

            <Route path={"robot_coverage"} element={<RobotCoverageMapPage/>}/>

            <Route path={"spectator"} element={duststreamingPossible ? <SpectatorMapPage/> : <Navigate to="/" />}/>

            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
    );
};

export default OptionsRouter;
