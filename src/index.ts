import { SkillBuilders } from "ask-sdk";
import { LambdaHandler } from "ask-sdk-core/dist/skill/factory/BaseSkillFactory";

import { LaunchRequestHandler } from "./handlers/LaunchRequestHandler";
import { SessionEndedHandler } from "./handlers/SessionEndedHandler";
import { GenericErrorHandler } from "./handlers/GenericErrorHandler";


function buildLambdaSkill(): LambdaHandler {
    return SkillBuilders.standard()
    .addRequestHandlers(
        new LaunchRequestHandler(),
        new SessionEndedHandler()
    )
    .addErrorHandlers(new GenericErrorHandler())
    .lambda();
 }

 // Lambda handler - entry point for skill
 export let handler = buildLambdaSkill();