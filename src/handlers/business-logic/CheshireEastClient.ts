import { services } from "ask-sdk-model";
import * as requestPromise from 'request-promise-native';
import { BinCollectionData } from "../../models/BinCollectionData";
import { PropertyData } from "../../models/PropertyData";
import Address = services.deviceAddress.Address;

const PROPERTY_ID_PATTERN: RegExp = new RegExp("data-uprn=\"[\\d+]");

const BIN_COLLECTION_DETAIL_PATTERN: RegExp = new RegExp("label for=\"\\w*\">[.+?]<","g");

export class CheshireEastClient {

    async getPropertyDataFromWebservice(address: Address): Promise<PropertyData> {
        const propertyId: string = await this.getPropertyIdFromWebservice(address);
        const binCollectionData: BinCollectionData[] = await this.getBinDataFromWebService(propertyId);
        
        return new PropertyData(encodeURIComponent(address.addressLine1), propertyId, binCollectionData);
    }
    
    async getPropertyIdFromWebservice(address: Address): Promise<string> {
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
    
    async getBinDataFromWebService(propertyId: string): Promise<BinCollectionData[]> {
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
                    binCollectionData = this.parseBinResponse(response.body);
                }
            }
        });
    
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