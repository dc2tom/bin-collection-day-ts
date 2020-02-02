import { HandlerInput, RequestHandler, ResponseBuilder } from "ask-sdk";
import { Response, services } from "ask-sdk-model";
import * as moment from 'moment';
import { PropertyData } from '../models/PropertyData';
import { BinCollectionData } from '../models/BinCollectionData';
import { CheshireEastClient } from "./business-logic/CheshireEastClient";
import { DynamoDBDao } from "./dao/DynamoDBDao";
import { ShortAddress } from "../models/ShortAddress";

const PERMISSIONS = ['read::alexa:device:all:address'];

const BIN_DATE_FORMAT = "DD/MM/YYYY";

const cheshireEastClient = new CheshireEastClient();

const dao = new DynamoDBDao();

export class LaunchRequestHandler implements RequestHandler {
    canHandle(handlerInput: HandlerInput): boolean {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'LaunchRequest';
    }

    async handle(handlerInput: HandlerInput): Promise<Response> {
        const consentToken = handlerInput.requestEnvelope.context.System.user.permissions
            && handlerInput.requestEnvelope.context.System.user.permissions.consentToken;
        
        if (!consentToken) {
            return handlerInput.responseBuilder
                .speak("No Permissions found. If you want me to be able to tell you when your bins are due please grant this skill access to full address information in the Amazon Alexa App.")
                .withAskForPermissionsConsentCard(PERMISSIONS)
                .getResponse();
        }

        const address: ShortAddress = await findDeviceAddress(handlerInput);
        console.log("Address obtained from device successfully.");

        const propertyData: PropertyData = await obtainPropertyData(address);

        const speechString: string = buildBinString(propertyData);
        
        const responseBuilder: ResponseBuilder = handlerInput.responseBuilder;
        return responseBuilder.speak(speechString)
            .withSimpleCard("Next Bin Collection", speechString)
            .withShouldEndSession(true)
            .getResponse();
    }
}

    async function findDeviceAddress(handlerInput: HandlerInput): Promise<ShortAddress> {
        const deviceAddressServiceClient = handlerInput.serviceClientFactory.getDeviceAddressServiceClient();
        const deviceId: string = handlerInput.requestEnvelope.context.System.device.deviceId;
        const address: services.deviceAddress.Address = await deviceAddressServiceClient.getFullAddress(deviceId);

        if (address.addressLine1 === null || address.postalCode === null) {
            console.log("Address is not complete. Line 1: " + address.addressLine1 + " Postcode: " + address.postalCode);
            throw new Error("Sorry, we were unable to find your bin collection details. " +
            "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
        }

        const shortAddress = new ShortAddress(address.addressLine1.toUpperCase(), address.postalCode.toUpperCase());

        return shortAddress;
    }

    async function obtainPropertyData(address: ShortAddress): Promise<PropertyData> {
        const urlEncodedAddressLine1: string = encodeURIComponent(address.addressLine1);

        let propertyData: PropertyData = null;

        try {
            propertyData = await dao.getPropertyDataFromDatabase(urlEncodedAddressLine1, address.postCode);
        } catch(err) {
            console.error("Error attempting to obtain data from database", err);
        }

        if (propertyData === null) {
            console.log("No valid bin data found in database for this property, trying webservice");
            propertyData = await cheshireEastClient.getPropertyDataFromWebservice(address);
            if (propertyData !== null) {
                await dao.putPropertyDataInDatabase(propertyData);
            } else {
                throw createBinCollectionException();
            }
        }

        return propertyData;
    }

    function buildBinString(propertyData: PropertyData): string {
        const binCollectionData: BinCollectionData[] = findNextBinCollectionData(propertyData);

        let binType: string;
        if (binCollectionData.length === 2) {
            binType = binCollectionData[0].binType + " and " + binCollectionData[1].binType;
        } else {
            binType = binCollectionData[0].binType;
        }

        const returnString: string = "Your " + binType + " bin is due " + findCollectionDay(binCollectionData[0]) + ".";
        console.info("Responding with:" + returnString);

        return returnString;
    }

    function findCollectionDay(binCollectionData: BinCollectionData) {
        const date = moment(binCollectionData.collectionDate, BIN_DATE_FORMAT);
        const now = moment();

        if (now.isSame(date, 'day')) {
            return "Today";
        }

        if (now.add(1, 'day').isSame(date, 'day')) {
            return "Tomorrow";
        }

        return "on " + binCollectionData.collectionDay;
    }

    function createBinCollectionException(): Error {
        return new Error("Sorry, we were unable to find your bin collection details. " +
                "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
    }

    function findNextBinCollectionData(propertyData: PropertyData): BinCollectionData[] {
        console.log("Finding next bin collection date");
        
        const nextCollectionData: BinCollectionData[] = [];

        const now = moment();

        for (const item of propertyData.binCollectionData) {
            if (moment(item.collectionDate, BIN_DATE_FORMAT).isSameOrAfter(now, 'day')) {
                if (nextCollectionData.length === 1) {
                    // Does next bin in the collection belong with the one we are returning?
                    if (matchesExistingDate(nextCollectionData[0].collectionDate, item.collectionDate)) {
                        console.log("Adding: " + item.binType + " bin");
                        nextCollectionData.push(item);
                        break;
                    } else {
                        // We only have one bin to return. 
                        // This happens in the winter when the Green bin isn't collected.
                        break;
                    }
                }
                if (nextCollectionData.length === 0) {
                    // Black bins are only ever collected alone.
                    if ("Black" === (item.binType)) {
                        console.log("Adding Black bin");
                        nextCollectionData.push(item);
                        break;
                    } else {
                        // Must be silver or green bin.
                        console.log("Adding: " + item.binType + " bin");
                        nextCollectionData.push(item);
                    }
                }
            }
        }

        if (nextCollectionData.length === 0) {
            console.error("No valid stored bin collection data found for this property.");
            createBinCollectionException();
        }

        return nextCollectionData;
    }

    function matchesExistingDate(existingDate: string, newDate: string): boolean {
        return moment(existingDate, BIN_DATE_FORMAT).isSame(moment(newDate, BIN_DATE_FORMAT));
    }