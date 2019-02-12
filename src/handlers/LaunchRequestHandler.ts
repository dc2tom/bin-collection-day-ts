import { HandlerInput, RequestHandler, ResponseBuilder } from "ask-sdk";
import { Response, services } from "ask-sdk-model";
import Address = services.deviceAddress.Address;
import { DynamoDB } from "aws-sdk";
import * as moment from 'moment';
import * as requestPromise from 'request-promise-native'
import { PropertyData } from '../models/PropertyData'
import { BinCollectionData } from '../models/BinCollectionData'

const PERMISSIONS: string = "['read::alexa:device:all:address']";

const PROPERTY_ID_PATTERN: RegExp = new RegExp("data-uprn=\"(\\d+)");

const BIN_COLLECTION_DETAIL_PATTERN: RegExp = new RegExp("label for=\"\\w*\">(.+?)<");

const BIN_DATE_FORMAT: string = "dd/MM/yyyy";

const dynamoDB = new DynamoDB.DocumentClient();

export class LaunchRequestHandler implements RequestHandler {
    canHandle(handlerInput: HandlerInput): boolean {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'LaunchRequest';
    }

    async handle(handlerInput: HandlerInput): Promise<Response> {
        if (handlerInput.requestEnvelope.context.System.user.permissions !== null &&
            handlerInput.requestEnvelope.context.System.user.permissions.consentToken !== null) {

            const address: Address = await this.findDeviceAddress(handlerInput);
            console.log("Address obtained from device successfully.");

            const propertyData: PropertyData = this.obtainPropertyData(address);

            const speechString: string = this.buildBinString(propertyData);
            
            const responseBuilder: ResponseBuilder = handlerInput.responseBuilder;
            return responseBuilder.speak(speechString)
                .withSimpleCard("Next Bin Collection", speechString)
                .withShouldEndSession(true)
                .getResponse();
            } 
        
        return handlerInput.responseBuilder
            .speak("No Permissions found. If you want me to be able to tell you when your bins are due please grant this skill access to full address information in the Amazon Alexa App.")
            .withAskForPermissionsConsentCard(new Array(PERMISSIONS))
            .getResponse();
    }

    async findDeviceAddress(handlerInput: HandlerInput): Promise<Address> {
        const deviceAddressServiceClient = handlerInput.serviceClientFactory.getDeviceAddressServiceClient();
        const deviceId: string = handlerInput.requestEnvelope.context.System.device.deviceId;
        const address: Address =  await deviceAddressServiceClient.getFullAddress(deviceId);

        if (address.addressLine1 === null || address.postalCode === null) {
            console.log("Address is not complete. Line 1: " + address.addressLine1 + " Postcode: " + address.postalCode);
            throw new Error("Sorry, we were unable to find your bin collection details. " +
            "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
        }

        return address;
    }

    obtainPropertyData(address: Address): PropertyData {
        const urlEncodedAddressLine1: string = encodeURIComponent(address.addressLine1);

        let propertyData = this.getPropertyDataFromDatabase(urlEncodedAddressLine1);

        if (propertyData === null) {
            propertyData = this.getPropertyDataFromWebservice(address);
            if (propertyData !== null) {
                this.putPropertyDataInDatabase(propertyData);
            } else {
                throw this.createBinCollectionException();
            }
        }

        return propertyData;
    }

    buildBinString(propertyData: PropertyData): string {
        let binCollectionData: BinCollectionData[] = this.findNextBinCollectionData(propertyData);

        let binType: string;
        if (binCollectionData.length === 2) {
            binType = binCollectionData[0].binType + " and " + binCollectionData[1].binType;
        } else {
            binType = binCollectionData[0].binType;
        }

        let returnString: string = "Your " + binType + " bin is due on " + binCollectionData[0].collectionDay + ".";
        console.info("Responding with:" + returnString);

        return returnString;
    }

    createBinCollectionException(): Error {
        return new Error("Sorry, we were unable to find your bin collection details. " +
                "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
    }

    getPropertyDataFromDatabase(addressLine1: string): PropertyData {
        let params = {
            Key: {
                'addressLine1': {S: addressLine1},
            },
            TableName: process.env.DYNAMODB_TABLE
          };
        
        console.log('Trying database lookup using params: ' + JSON.stringify(params));
        let propertyDataToReturn: PropertyData = null;
        dynamoDB.get(params, function(err, data) {
            if (err) {
                console.log("Error", err);
            } else {
                if (data.Item.propertyId.S !== null) {
                    console.log("Found propertyId in database: " + data.Item.propertyId.S);
                    if (data.Item.binCollectionData !== null) {
                        console.log("Found bin collection data in database.");
                        let binCollectionDataList: BinCollectionData[] = JSON.parse(data.Item.binCollectionData.S);

                        propertyDataToReturn = new PropertyData(addressLine1, data.Item.propertyId.S, binCollectionDataList);
                    }
                }
            }
        });

        if (propertyDataToReturn === null) {
            console.log("No data found in database for this property.");
        }
        
        return propertyDataToReturn;
    }

    putPropertyDataInDatabase(propertyData: PropertyData) {
        console.log("Writing bin data to database.")

        let params = {
            Item: {
                'addressLine1': {S: propertyData.addressLine1},
                'propertyId': {S: propertyData.propertyId},
                'binCollectionData': {S: JSON.stringify(propertyData.binCollectionData)},
            },
            TableName: process.env.DYNAMODB_TABLE
          };

          dynamoDB.put(params, function(err, data) {
            if (err) {
                console.log("Error", err);
            } else {
                console.log("Bin data written to database.")
            }
        });
    }

    getPropertyDataFromWebservice(address: Address): PropertyData {
        let propertyId: string = this.getPropertyIdFromWebservice(address);
        let binCollectionData: BinCollectionData[] = this.getBinDataFromWebService(propertyId);

        return new PropertyData(encodeURIComponent(address.addressLine1), propertyId, binCollectionData);
    }

    getPropertyIdFromWebservice(address: Address): string {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/Search?postcode=' + encodeURIComponent(address.postalCode) + '&propertyname=' + address.addressLine1.split(" ")[0]
        };

        console.log("Calling cheshire east for property id.");
        let propertyId: string;

        requestPromise.get(options, (error, response) => {
            if (error) {
                console.error(error.getMessage(), error);
            } else {
                if (response.statusCode !== 200) {
                    console.error("Http error: " + response.statusMessage);
                } else {
                    console.log("Got propertyId response from cheshire east, parsing it");
                    if (PROPERTY_ID_PATTERN.test(response.body)) {
                        propertyId = PROPERTY_ID_PATTERN.exec(response.body)[1];
                        console.log("PropertyId is: " + propertyId);
                    } else {
                        console.error("Unable to parse response from Cheshire east.");
                        throw this.createBinCollectionException();
                    }
                }
            }
        });

        return propertyId;
    }

    getBinDataFromWebService(propertyId: string): BinCollectionData[] {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/GetBartecJobList?uprn=' + propertyId
        };

        console.log("Calling cheshire east for bin collection days.");
        let binCollectionData: BinCollectionData[]

        requestPromise.get(options, (error, response) => {
            if (error) {
                console.error(error.getMessage(), error);
            } else {
                if (response.statusCode !== 200) {
                    console.error("Http error: " + response.statusMessage);
                } else {
                    console.log("Got bin data response from cheshire east, parsing it.");
                    binCollectionData = this.parseBinResponse(response.body);
                }
            }
        });

        return binCollectionData;
    }

    parseBinResponse(response: string): BinCollectionData[] {
        let matches: string[];
        if (BIN_COLLECTION_DETAIL_PATTERN.test(response)) {
            matches = BIN_COLLECTION_DETAIL_PATTERN.exec(response);
        } else {
            console.error("Unable to parse response from Cheshire east.");
            throw this.createBinCollectionException();
        }

        let binCollectionData: BinCollectionData[];
        let i: number = 0;

        while (i < matches.length) {
            binCollectionData.push(new BinCollectionData(matches[i++], matches[i++], this.parseBinType(matches[i++])));
        }

        return binCollectionData;
    }

    parseBinType(binTypeString: string): string {
        switch (binTypeString.replace("Empty Standard ", "")) {
            case "Garden Waste":
                return "Green";
            case "Mixed Recycling":
                return "Silver";
            default:
                return "Black";
        }
    }

    findNextBinCollectionData(propertyData: PropertyData): BinCollectionData[] {
        let counter: number = 1;
        let refreshed: boolean = false;
        
        let nextCollectionData: BinCollectionData[];

        for (let item of propertyData.binCollectionData) {
            if (moment(item.collectionDate).isAfter(moment())) {
                if (propertyData.binCollectionData.length - counter <= 3 && !refreshed) {
                    //this.refreshBinData(propertyData);
                    refreshed = true;
                }
                if (nextCollectionData.length === 1) {
                    // Does next bin in the collection belong with the one we are returning?
                    if (this.matchesExistingDate(nextCollectionData[0].collectionDate, item.collectionDate)) {
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

    matchesExistingDate(existingDate: string, newDate: string): boolean {
        return moment(existingDate, BIN_DATE_FORMAT).isSame(moment(newDate, BIN_DATE_FORMAT));
    }

    refreshBinData(propertyData: PropertyData): void {
        let binCollectionData: BinCollectionData[] = this.getBinDataFromWebService(propertyData.propertyId);
        this.putPropertyDataInDatabase(new PropertyData(propertyData.addressLine1, propertyData.propertyId, binCollectionData));
    }

}