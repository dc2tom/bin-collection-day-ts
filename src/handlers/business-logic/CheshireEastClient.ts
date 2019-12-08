import * as requestPromise from 'request-promise-native';
import { BinCollectionData } from "../../models/BinCollectionData";
import { PropertyData } from "../../models/PropertyData";
import { ShortAddress } from "../../models/ShortAddress";

const PROPERTY_ID_PATTERN: RegExp = new RegExp("data-uprn=\"(\d+)");

const BIN_COLLECTION_DETAIL_PATTERN: RegExp = new RegExp("label for=\"\\w*\">[.+?]<","g");

export class CheshireEastClient {

    async getPropertyDataFromWebservice(address: ShortAddress): Promise<PropertyData> {
        const propertyId: string = await this.getPropertyIdFromWebservice(address);
        const binCollectionData: BinCollectionData[] = await this.getBinDataFromWebService(propertyId);
        
        return new PropertyData(encodeURIComponent(address.addressLine1), propertyId, binCollectionData);
    }
    
    async getPropertyIdFromWebservice(address: ShortAddress): Promise<string> {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/Search?postcode=' + encodeURIComponent(address.postCode) + '&propertyname=' + address.addressLine1.split(" ")[0]
        };
        console.log("Calling cheshire east for property id: " + options.uri);
    
        const serviceResponse = await requestPromise.get(options, (error, response) => {
            if (error) {
                console.error(error.getMessage(), error);
                createBinCollectionException();
            } else {
                if (response.statusCode !== 200) {
                    console.error("Http error: " + response.statusMessage);
                    createBinCollectionException();
                } else {
                    return response.body;
                }
            }
        });
    
        console.log("Response from cheshire east: " + serviceResponse);
    
        let propertyId: string = null;
        
        console.log("Got propertyId response from cheshire east, parsing it");
        if (PROPERTY_ID_PATTERN.test(serviceResponse)) {
            const match = PROPERTY_ID_PATTERN.exec(serviceResponse);
            console.log("Property ID is :" + match);
            propertyId = match[0];
        } else {
            console.error("Unable to parse response from Cheshire east.");
            throw createBinCollectionException();
        }
    
        return propertyId;
    }
    
    async getBinDataFromWebService(propertyId: string): Promise<BinCollectionData[]> {
        const options = {
            uri: 'https://online.cheshireeast.gov.uk/MyCollectionDay/SearchByAjax/GetBartecJobList?uprn=' + propertyId
        };
    
        console.log("Calling cheshire east for bin collection days with propertyId: " + propertyId);
        let binCollectionData: BinCollectionData[] = [];
    
        const serviceResponse = await requestPromise.get(options, (error, response) => {
            if (error) {
                console.error(error.getMessage(), error);
                createBinCollectionException();
            } else {
                if (response.statusCode !== 200) {
                    console.error("Http error: " + response.statusMessage);
                    createBinCollectionException();
                } else {
                    return response.body;
                }
            }
        });
        
        console.log("Got bin data response from cheshire east, parsing it.");
        binCollectionData = this.parseBinResponse(serviceResponse);

        return binCollectionData;
    }

    parseBinResponse(response: string): BinCollectionData[] {
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
}

function createBinCollectionException(): Error {
    return new Error("Sorry, we were unable to find your bin collection details. " +
            "Please check the address assigned to your Alexa device is a valid Cheshire East address.");
}