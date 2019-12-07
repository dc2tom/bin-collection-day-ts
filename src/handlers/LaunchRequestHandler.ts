import { HandlerInput, RequestHandler, ResponseBuilder } from "ask-sdk";
import { Response, services } from "ask-sdk-model";
import Address = services.deviceAddress.Address;
import { DynamoDB } from "aws-sdk";
import * as moment from 'moment';
import { PropertyData } from '../models/PropertyData';
import { BinCollectionData } from '../models/BinCollectionData';
import { CheshireEastClient } from "./business-logic/CheshireEastClient";

const PERMISSIONS = ['read::alexa:device:all:address'];

const BIN_DATE_FORMAT = "dd/MM/yyyy";

const dynamoDB = new DynamoDB.DocumentClient();

const cheshireEastClient = new CheshireEastClient();

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

        const address: Address = await findDeviceAddress(handlerInput);
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

    async function findDeviceAddress(handlerInput: HandlerInput): Promise<Address> {
        const deviceAddressServiceClient = handlerInput.serviceClientFactory.getDeviceAddressServiceClient();
        const deviceId: string = handlerInput.requestEnvelope.context.System.device.deviceId;
        const address: Address = await deviceAddressServiceClient.getFullAddress(deviceId);

        if (address.addressLine1 === null || address.postalCode === null) {
            console.log("Address is not complete. Line 1: " + address.addressLine1 + " Postcode: " + address.postalCode);
            throw new Error("Sorry, we were unable to find your bin collection details. " +
            "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
        }

        return address;
    }

    async function obtainPropertyData(address: Address): Promise<PropertyData> {
        const urlEncodedAddressLine1: string = encodeURIComponent(address.addressLine1);

        let propertyData: PropertyData = null;

        try {
            propertyData = await getPropertyDataFromDatabase(urlEncodedAddressLine1);
        } catch(err) {
            console.error("Error attempting to obtain data from database", err);
        }

        if (propertyData === null) {
            propertyData = await cheshireEastClient.getPropertyDataFromWebservice(address);
            if (propertyData !== null) {
                putPropertyDataInDatabase(propertyData);
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

        const returnString: string = "Your " + binType + " bin is due on " + binCollectionData[0].collectionDay + ".";
        console.info("Responding with:" + returnString);

        return returnString;
    }

    function createBinCollectionException(): Error {
        return new Error("Sorry, we were unable to find your bin collection details. " +
                "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
    }

    async function getPropertyDataFromDatabase(addressLine1: string): Promise<PropertyData> {
        const params = {
            Key: {
                'addressLine1': addressLine1,
            },
            TableName: process.env.DYNAMODB_TABLE
        };

        console.log('Trying database lookup using params: ' + JSON.stringify(params));

        let data = null;

        try {
            data = await dynamoDB.get(params).promise();
        } catch (err) {
            console.error("Dynamo DB client error.", err);
        }

        let propertyDataToReturn: PropertyData = null;

        if (data && data.propertyId) {
            console.log("Found propertyId in database: " + data.propertyId);
            if (data.binCollectionData !== null) {
                console.log("Found bin collection data in database.");
                const binCollectionDataList: BinCollectionData[] = JSON.parse(data.binCollectionData.S);

                propertyDataToReturn = new PropertyData(addressLine1, data.propertyId.S, binCollectionDataList);
            }
        }

        if (propertyDataToReturn === null) {
            console.log("No data found in database for this property.");
        }

        return propertyDataToReturn;
    }

    function putPropertyDataInDatabase(propertyData: PropertyData) {
        console.log("Writing bin data to database.");

        const params = {
            Item: {
                'addressLine1': propertyData.addressLine1,
                'binCollectionData': JSON.stringify(propertyData.binCollectionData),
                'propertyId': propertyData.propertyId,
            },
            TableName: process.env.DYNAMODB_TABLE
          };

          dynamoDB.put(params, (err) => {
            if (err) {
                console.log("Error", err);
            } else {
                console.log("Bin data written to database.");
            }
        });
    }

    function findNextBinCollectionData(propertyData: PropertyData): BinCollectionData[] {
        let counter = 1;
        let refreshed = false;
        
        const nextCollectionData: BinCollectionData[] = [];

        for (const item of propertyData.binCollectionData) {
            if (moment(item.collectionDate).isAfter(moment())) {
                if (propertyData.binCollectionData.length - counter <= 3 && !refreshed) {
                    refreshBinData(propertyData);
                    refreshed = true;
                }
                if (nextCollectionData.length === 1) {
                    // Does next bin in the collection belong with the one we are returning?
                    if (matchesExistingDate(nextCollectionData[0].collectionDate, item.collectionDate)) {
                        nextCollectionData.push(item);
                        break;
                    } else {
                        // We only have one bin to return
                        break;
                    }
                }
                if (nextCollectionData.length === 0) {
                    // Black bins are only ever collected alone.
                    if ("Black" === (item.binType)) {
                        nextCollectionData.push(item);
                        break;
                    } else {
                        // Must be silver or green bin.
                        nextCollectionData.push(item);
                    }
                }
                counter++;
            }
        }

        if (nextCollectionData.length === 0) {
            console.error("No valid stored bin collection data found for this property.");
            //TODO we have terrible data..
        }

        return nextCollectionData;
    }

    function matchesExistingDate(existingDate: string, newDate: string): boolean {
        return moment(existingDate, BIN_DATE_FORMAT).isSame(moment(newDate, BIN_DATE_FORMAT));
    }

    async function refreshBinData(propertyData: PropertyData): Promise<void> {
        const binCollectionData: BinCollectionData[] = await cheshireEastClient.getBinDataFromWebService(propertyData.propertyId);
        putPropertyDataInDatabase(new PropertyData(propertyData.addressLine1, propertyData.propertyId, binCollectionData));
    }