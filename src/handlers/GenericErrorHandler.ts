import { HandlerInput, ErrorHandler } from "ask-sdk";
import { Response } from "ask-sdk-model"

export class GenericErrorHandler implements ErrorHandler {
    canHandle(handlerInput: HandlerInput): boolean {
        return true;
    }

    handle(handlerInput: HandlerInput, error: Error): Response {
        const request = handlerInput.requestEnvelope.request;

        console.log(`Error handled: ${error.message}`);
        console.log(`Original Request was: ${JSON.stringify(request, null, 2)}`);

        return handlerInput.responseBuilder
            .speak('Something went wrong. ' + error.message)
            .withSimpleCard('Bin Collection Cheshire East', error.message)
            .withShouldEndSession(true)
            .getResponse();
    }   
}