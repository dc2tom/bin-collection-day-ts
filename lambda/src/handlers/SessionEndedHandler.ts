import { HandlerInput, RequestHandler } from "ask-sdk";
import { Response } from "ask-sdk-model";

export class SessionEndedHandler implements RequestHandler {
    canHandle(handlerInput: HandlerInput): boolean {
        const request = handlerInput.requestEnvelope.request;
        return request.type !== 'LaunchRequest';
    }

    handle(handlerInput: HandlerInput): Response {
        const responseBuilder = handlerInput.responseBuilder;

        return responseBuilder.speak("Unknown bin collection command. Chow.")
            .withShouldEndSession(true)
            .getResponse();
    }   
}