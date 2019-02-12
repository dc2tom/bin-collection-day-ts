export class BinCollectionData {
    collectionDay: string;
    collectionDate: string;
    binType: string;

    constructor(collectionDay: string, collectionDate: string, binType: string) {
        this.collectionDay = collectionDay;
        this.collectionDate = collectionDate;
        this.binType = binType;
    }
}