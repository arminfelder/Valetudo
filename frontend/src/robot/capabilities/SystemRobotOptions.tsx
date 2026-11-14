import React from "react";
import Speaker from "./Speaker";
import VoicePackManagement from "./VoicePackManagement";
import DoNotDisturb from "./DoNotDisturb";
import DoNotDisturbSchedule from "./DoNotDisturbSchedule";
import {CapabilityContainer} from "./CapabilityLayout";
import PaperContainer from "../../components/PaperContainer";

const SystemRobotOptions = (): React.ReactElement => {
    const components = [
        Speaker,
        VoicePackManagement,
        DoNotDisturb,
        DoNotDisturbSchedule,
    ];

    return (
        <PaperContainer>
            <CapabilityContainer>
                {components.map((Component, idx) => {
                    return <Component key={idx}/>;
                })}
            </CapabilityContainer>
        </PaperContainer>
    );
};

export default SystemRobotOptions;
