import { DynamoDB } from "aws-sdk";
import * as moment from 'moment';
import { PropertyData } from '../../models/PropertyData';
import { BinCollectionData } from '../../models/BinCollectionData';

const BIN_DATE_FORMAT = "DD/MM/YYYY";

const dynamoDB = new DynamoDB.DocumentClient();

export class DynamoDBDao {

    async getPropertyDataFromDatabase(addressLine1: string, postalCode: string): Promise<PropertyData> {
        const params = {
            Key: {
                'addressLine1': addressLine1 + ":" + postalCode,
            },
            TableName: process.env.DYNAMODB_TABLE
        };

        console.log('Trying database lookup using params: ' + JSON.stringify(params));

        let data = null;

        try {
            data = await dynamoDB.get(params).promise();
            console.log("data from database: " + JSON.stringify(data));
        } catch (err) {
            console.error("Dynamo DB client error.", err);
        }

        let propertyDataToReturn: PropertyData = null;

        if (data.Item && data.Item.propertyId) {
            console.log("Found propertyId in database: " + data.Item.propertyId);
            if (data.Item.binCollectionData !== null) {
                console.log("Found bin collection data in database.");
                const binCollectionDataList: BinCollectionData[] = JSON.parse(data.Item.binCollectionData);

                propertyDataToReturn = new PropertyData(addressLine1, data.Item.propertyId, binCollectionDataList);
            }
        }

        if (propertyDataToReturn === null) {
            console.log("No data found in database for this property.");
        }

        if (this.isBinDataStale(propertyDataToReturn.binCollectionData)) {
            console.log("Stored bin collection data is stale for this property, refreshing.");
            propertyDataToReturn = null;
        }

        return propertyDataToReturn;
    }

    isBinDataStale(binCollectionData: BinCollectionData[]): boolean {
        const now = moment();

        const filteredCollectionData: BinCollectionData[] = binCollectionData.filter(item => {
            this.collectionIsTodayOrLater(now, item);
        });

        if (filteredCollectionData.length <= 3) {
            return true;
        }

        return false;
    }

    collectionIsTodayOrLater(today: moment.Moment, binCollectionData: BinCollectionData): boolean {
        return (moment(binCollectionData.collectionDate, BIN_DATE_FORMAT).isSameOrAfter(today, 'day'));
    }

    async putPropertyDataInDatabase(propertyData: PropertyData) {
        console.log("Writing bin data to database.");

        const params = {
            Item: {
                'addressLine1': propertyData.addressLine1,
                'binCollectionData': JSON.stringify(propertyData.binCollectionData),
                'propertyId': propertyData.propertyId,
            },
            TableName: process.env.DYNAMODB_TABLE
          };

        try {
            await dynamoDB.put(params).promise();
            console.log("Bin data written to database");
        } catch (err) {
            console.error("Dynamo DB client error.", err);
        }
    }
}