import {BinCollectionData} from './BinCollectionData';

export class PropertyData {
    addressLine1: string;
    propertyId: string;
    binCollectionData: BinCollectionData[];

    constructor(addressLine1: string, propertyId: string, binCollectionData: BinCollectionData[]) {
        this.addressLine1 = addressLine1;
        this.propertyId = propertyId;
        this.binCollectionData = binCollectionData;
    }
}