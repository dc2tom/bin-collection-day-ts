import { HandlerInput, RequestHandler, ResponseBuilder } from "ask-sdk";
import { Response, services } from "ask-sdk-model";
import Address = services.deviceAddress.Address;
import { DynamoDB } from "aws-sdk";
import * as moment from 'moment';
import * as requestPromise from 'request-promise-native';
import { PropertyData } from '../models/PropertyData';
import { BinCollectionData } from '../models/BinCollectionData';
import { ResponseRequest } from "request";

const PERMISSIONS = ['read::alexa:device:all:address'];

const PROPERTY_ID_PATTERN: RegExp = new RegExp("data-uprn=\"[\\d+]");

const BIN_COLLECTION_DETAIL_PATTERN: RegExp = new RegExp("label for=\"\\w*\">[.+?]<","g");

const BIN_DATE_FORMAT = "dd/MM/yyyy";

const dynamoDB = new DynamoDB.DocumentClient();

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
            propertyData = await getPropertyDataFromWebservice(address);
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

    async function getPropertyDataFromWebservice(address: Address): Promise<PropertyData> {
        const propertyId: string = await getPropertyIdFromWebservice(address);
        const binCollectionData: BinCollectionData[] = await getBinDataFromWebService(propertyId);
        
        return new PropertyData(encodeURIComponent(address.addressLine1), propertyId, binCollectionData);
    }

    async function getPropertyIdFromWebservice(address: Address): Promise<string> {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/Search?postcode=' + encodeURIComponent(address.postalCode) + '&propertyname=' + address.addressLine1.split(" ")[0]
        };
        console.log("Calling cheshire east for property id: " + options.uri);
        let response: requestPromise.FullResponse = null;

        try {
            response = await requestPromise.get(options);
        } catch(err) {
            console.error(err.getMessage(), err);
        }

        console.log("Response from cheshire east: " + response.body);

        let propertyId: string = null;
        
        if (response.statusCode !== 200) {
            console.error("Http error: " + response.statusMessage);
        } else {
            console.log("Got propertyId response from cheshire east, parsing it");
            if (PROPERTY_ID_PATTERN.test(response.body)) {
                const match = PROPERTY_ID_PATTERN.exec(response.body);
                console.log("Property ID is :" + match);
                propertyId = match[0];
            } else {
                console.error("Unable to parse response from Cheshire east.");
                throw createBinCollectionException();
            }
        }

        return propertyId;

    }

    async function getBinDataFromWebService(propertyId: string): Promise<BinCollectionData[]> {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/GetBartecJobList?uprn=' + propertyId
        };

        console.log("Calling cheshire east for bin collection days with propertyId: " + propertyId);
        let binCollectionData: BinCollectionData[] = [];

        await requestPromise.get(options, (error, response) => {
            if (error) {
                console.error(error.getMessage(), error);
            } else {
                if (response.statusCode !== 200) {
                    console.error("Http error: " + response.statusMessage);
                } else {
                    console.log("Got bin data response from cheshire east, parsing it.");
                    binCollectionData = parseBinResponse(response.body);
                }
            }
        });

        return binCollectionData;
    }

    function parseBinResponse(response: string): BinCollectionData[] {
        console.log("Parsing bin response from cheshire east: " + response);
        const matches: string[] = [];
        while (BIN_COLLECTION_DETAIL_PATTERN.test(response)) {
            matches.push(BIN_COLLECTION_DETAIL_PATTERN.exec(response).input);
            console.log("Matches: " + matches);
        }

        if (matches.length === 0) {
            console.error("Unable to parse response from Cheshire east.");
            throw createBinCollectionException();
        }

        const binCollectionData: BinCollectionData[] = [];
        let i = 0;

        while (i < matches.length) {
            binCollectionData.push(new BinCollectionData(matches[i++], matches[i++], parseBinType(matches[i++])));
        }

        return binCollectionData;
    }

    function parseBinType(binTypeString: string): string {
        switch (binTypeString.replace("Empty Standard ", "")) {
            case "Garden Waste":
                return "Green";
            case "Mixed Recycling":
                return "Silver";
            default:
                return "Black";
        }
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
        const binCollectionData: BinCollectionData[] = await getBinDataFromWebService(propertyData.propertyId);
        putPropertyDataInDatabase(new PropertyData(propertyData.addressLine1, propertyData.propertyId, binCollectionData));
    }